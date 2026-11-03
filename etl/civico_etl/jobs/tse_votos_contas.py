"""etl.tse.votos e etl.tse.contas: votos por candidatura e dinheiro de campanha, lendo só os CSVs necessários dos zips.

Fontes (cdn.tse.jus.br/estatistica/sead/odsele):
  votacao_candidato_munzona/votacao_candidato_munzona_{ano}.zip        -> candidacies.votes (soma por candidatura e turno)
  prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{ano}.zip
      receitas_candidatos_{ano}_*.csv     -> candidacies.raised_cents (soma de VR_RECEITA) e mapa prestador→candidatura
      despesas_pagas_candidatos_{ano}_*.csv -> candidacies.spent_cents (soma de VR_PAGTO_DESPESA, via SQ_PRESTADOR_CONTAS)
Só atualiza candidaturas já carregadas (quem está no diretório). Valor ausente na fonte continua null, nunca 0.
Também: candidacy_place_votes (votos por município, cargos estaduais/federais; D15), campaign_finance_entries agregadas por
categoria oficial (origem da receita / da despesa; sem doador nem fornecedor; D07) e cassação publicada na votação (D06).
Votos: QT_VOTOS_NOMINAIS_VALIDOS quando a fonte publica (2024+); senão QT_VOTOS_NOMINAIS.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict

import psycopg

import re

from ..db import SkipUnchanged, run, upsert
from ..remotezip import checksum, open_remote, pick_members, rows
from ..util import cents, chunked, fold

log = logging.getLogger("etl.tse2")
BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele"


def _known(conn: psycopg.Connection, year: int) -> set[str]:
    return {r["tse_sequencial"] for r in conn.execute(
        "select c.tse_sequencial from candidacies c join elections e on e.id = c.election_id where e.year = %s", (year,))}


def _apply(conn: psycopg.Connection, year: int, col: str, values: dict[str, int], by_round: bool) -> int:
    cur = conn.cursor()
    cur.execute("create temp table tmp_v (sq text, turno int, v bigint) on commit drop")
    with cur.copy("copy tmp_v (sq, turno, v) from stdin") as cp:
        for key, v in values.items():
            sq, turno = key if by_round else (key, 0)
            cp.write_row((sq, turno, v))
    cur.execute(
        f"""update candidacies c set {col} = t.v, updated_at = now()
            from tmp_v t, elections e
            where c.tse_sequencial = t.sq and c.election_id = e.id and e.year = %s
              and (t.turno = 0 or e.round = t.turno) and c.{col} is distinct from t.v""",
        (year,),
    )
    n = cur.rowcount
    cur.execute("drop table tmp_v")
    return n


MUNICIPAL_CARGOS = {"11", "12", "13"}  # prefeito, vice, vereador: a cidade inteira é a disputa; "mais votados" usa candidacies.votes


def _muni_map(conn: psycopg.Connection):
    from .tse_candidatos import TSE_TO_IBGE

    muni = {(r["uf"], fold(r["name"])): str(r["id"]) for r in conn.execute("select uf, name, id from places where kind = 'municipio'")}
    alnum = {(uf, re.sub(r"[^a-z0-9]", "", n)): pid for (uf, n), pid in muni.items()}

    def look(uf: str, name: str) -> str | None:
        f = fold(name)
        return muni.get((uf, f)) or alnum.get((uf, re.sub(r"[^a-z0-9]", "", f))) or muni.get((uf, TSE_TO_IBGE.get((uf, f), "")))

    return look


def _place_votes(conn: psycopg.Connection, r, year: int, by_place: dict) -> int:
    """D15: votos por município (cargos estaduais e federais) da candidatura, para "mais votados na cidade".
    Só candidaturas do diretório (a tabela exige candidacy_id): o ranking é "entre quem tem crachá" (limitação registrada)."""
    if not by_place:
        return 0
    look = _muni_map(conn)
    cid = {(row["tse_sequencial"], row["round"]): str(row["id"]) for row in conn.execute(
        "select c.id, c.tse_sequencial, e.round from candidacies c join elections e on e.id = c.election_id where e.year = %s", (year,))}
    out: dict[tuple[str, str], int] = defaultdict(int)
    miss: set[tuple[str, str]] = set()
    for (sq, t, uf, mun), v in by_place.items():
        c = cid.get((sq, t))
        pl = look(uf, mun)
        if not pl:
            miss.add((uf, mun))
            continue
        if c:
            out[(c, pl)] += v
    if miss:
        r.notes.append(f"{len(miss)} municípios da votação sem correspondência IBGE: {sorted(miss)[:10]}")
    rows_ = [(c, pl, v) for (c, pl), v in out.items()]
    n = 0
    for chunk in chunked(rows_, 200_000):
        n += len(upsert(conn, "candidacy_place_votes", ["candidacy_id", "place_id", "votes"], chunk, ["candidacy_id", "place_id"], update=["votes"], returning=["id"]))
    log.info("tse votos %d: %d linhas candidatura x município", year, n)
    return n


def _is_cassado_definitivo(situacao: str) -> bool:
    """D90: só "CASSADO" puro é fato consumado. "CASSADO COM RECURSO" (e qualquer variante com recurso, sub judice,
    anulado, revertido) não cassa: o eleito segue no cargo até o trânsito, e a vaga só fica comprovada com nova
    totalização ou eleição suplementar (tratada em tse_candidatos, BUG-005)."""
    return " ".join(situacao.upper().split()) == "CASSADO"


def _mark_cassados(conn: psycopg.Connection, year: int, sqs: set[str]) -> None:
    """D06/D90: eleito com cassação definitiva publicada na votação vira 'cassado'. Idempotente nos dois sentidos:
    mandato que esta regra marcou e cuja candidatura deixou de constar como cassada (p.ex. regra antiga que aceitava
    "com recurso", ou recurso provido) volta a 'em_exercicio' se o período ainda está correndo."""
    cur = conn.execute(
        """update mandates m set status = case when m.ends_on <= current_date then 'encerrado' else 'em_exercicio' end, updated_at = now()
           from candidacies c join elections e on e.id = c.election_id
           where m.candidacy_id = c.id and e.year = %s and not (c.tse_sequencial = any(%s))
             and m.status = 'cassado' and m.status_source = 'tse' and m.started_on <= current_date""",
        (year, list(sqs)),
    )
    if cur.rowcount:
        log.info("tse %d: %d mandatos deixaram de constar como cassados (situação sem fato consumado)", year, cur.rowcount)
    if not sqs:
        return
    cur = conn.execute(
        """update mandates m set status = 'cassado', updated_at = now()
           from candidacies c join elections e on e.id = c.election_id
           where m.candidacy_id = c.id and e.year = %s and c.tse_sequencial = any(%s) and m.status = 'em_exercicio' and m.status_source = 'tse'""",
        (year, list(sqs)),
    )
    if cur.rowcount:
        log.info("tse %d: %d mandatos marcados como cassados", year, cur.rowcount)


def run_votes(conn: psycopg.Connection, years: list[int], force: bool) -> None:
    for year in years:
        url = f"{BASE}/votacao_candidato_munzona/votacao_candidato_munzona_{year}.zip"
        try:
            z = open_remote(url)
        except FileNotFoundError:
            log.warning("TSE ainda não publicou votação de %d", year)
            continue
        members = pick_members(z, f"votacao_candidato_munzona_{year}")
        try:
            with run(conn, f"tse.votos.{year}", "tse", input_checksum=checksum(members), force=force) as r:
                want = _known(conn, year)
                agg: dict[tuple[str, int], int] = defaultdict(int)
                by_place: dict[tuple[str, int, str, str], int] = defaultdict(int)  # (sq, turno, UF, município) -> votos; D15
                cassados: set[str] = set()
                com_recurso: set[str] = set()  # D90: registrado, não aplicado
                t0, n = time.monotonic(), 0
                for m in members:
                    log.info("tse votos %d: lendo %s (%.0f MB comprimidos)", year, m.filename, m.compress_size / 1e6)
                    for sq, turno, valid, nominal, uf, mun, cargo, cass in rows(z, m, ["SQ_CANDIDATO", "NR_TURNO", "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS", "SG_UF", "NM_MUNICIPIO", "CD_CARGO", "DS_SITUACAO_CASSACAO"]):
                        n += 1
                        if sq not in want:
                            continue
                        q = valid if valid not in ("", "-1", "#NULO") else nominal
                        try:
                            v = int(q)
                        except ValueError:
                            r.reject(1)
                            continue
                        t = int(turno or 1)
                        agg[(sq, t)] += v
                        if cargo.strip() not in MUNICIPAL_CARGOS and uf not in ("ZZ", "BR", "VT"):
                            by_place[(sq, t, uf, mun)] += v
                        if cass and _is_cassado_definitivo(cass):
                            cassados.add(sq)
                        elif cass and "CASSAD" in cass.upper():
                            com_recurso.add(sq)
                log.info("tse votos %d: %d linhas em %.0fs, %d candidaturas com voto", year, n, time.monotonic() - t0, len(agg))
                r.add(_apply(conn, year, "votes", agg, by_round=True))
                r.add(_place_votes(conn, r, year, by_place))
                r.notes.append(f"{len(cassados)} candidaturas com cassação definitiva e {len(com_recurso - cassados)} com recurso (não cassa) na votação (DS_SITUACAO_CASSACAO)")
                _mark_cassados(conn, year, cassados)
        except SkipUnchanged:
            continue


def _finance_entries(conn: psycopg.Connection, year: int, by_cat: dict) -> int:
    cid = {row["tse_sequencial"]: str(row["id"]) for row in conn.execute(
        """select distinct on (c.tse_sequencial) c.id, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
           where e.year = %s order by c.tse_sequencial, e.round""", (year,))}
    rows_ = [(cid[sq], d, cat[:200], None, None, v, "BRL", None, f"tse:{year}:{sq}:{d}:{cat[:120]}") for (sq, d, cat), v in by_cat.items() if sq in cid]
    return len(upsert(conn, "campaign_finance_entries", ["candidacy_id", "direction", "category", "counterpart_name", "counterpart_doc", "amount_cents", "currency", "occurred_on", "source_key"],
                      rows_, ["source_key"], update=["candidacy_id", "amount_cents"], returning=["id"]))


def run_finance(conn: psycopg.Connection, years: list[int], force: bool) -> None:
    for year in years:
        url = f"{BASE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{year}.zip"
        try:
            z = open_remote(url)
        except FileNotFoundError:
            log.warning("TSE ainda não publicou prestação de contas de %d", year)
            continue
        rec = pick_members(z, f"receitas_candidatos_{year}")
        des = pick_members(z, f"despesas_pagas_candidatos_{year}")
        try:
            with run(conn, f"tse.contas.{year}", "tse", input_checksum=checksum(rec + des), force=force) as r:
                want = _known(conn, year)
                raised: dict[str, int] = defaultdict(int)
                prestador: dict[str, str] = {}
                # D07: origem do dinheiro e destino da despesa por candidatura, agregados por categoria oficial do TSE.
                # Nunca grava doador nem fornecedor (nome ou documento): pessoa física doadora não aparece em lugar nenhum.
                by_cat: dict[tuple[str, str, str], int] = defaultdict(int)
                for m in rec:
                    log.info("tse contas %d: lendo %s (%.0f MB)", year, m.filename, m.compress_size / 1e6)
                    for sq, sp, v, origem in rows(z, m, ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA"]):
                        if sq not in want:
                            continue
                        prestador[sp] = sq
                        c = cents(v)
                        if c is not None:
                            raised[sq] += c
                            by_cat[(sq, "receita", (origem or "Não informado").strip() or "Não informado")] += c
                spent: dict[str, int] = defaultdict(int)
                for m in des:
                    log.info("tse contas %d: lendo %s (%.0f MB)", year, m.filename, m.compress_size / 1e6)
                    for sp, v, origem in rows(z, m, ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA", "DS_ORIGEM_DESPESA"]):
                        sq = prestador.get(sp)
                        c = cents(v)
                        if sq and c is not None:
                            spent[sq] += c
                            by_cat[(sq, "despesa", (origem or "Não informado").strip() or "Não informado")] += c
                log.info("tse contas %d: %d candidaturas com receita, %d com despesa paga", year, len(raised), len(spent))
                r.add(_apply(conn, year, "raised_cents", raised, by_round=False))
                r.add(_apply(conn, year, "spent_cents", spent, by_round=False))
                r.add(_finance_entries(conn, year, by_cat))
        except SkipUnchanged:
            continue
