"""etl.tse.votos e etl.tse.contas: votos por candidatura e dinheiro de campanha, lendo só os CSVs necessários dos zips.

Fontes (cdn.tse.jus.br/estatistica/sead/odsele):
  votacao_candidato_munzona/votacao_candidato_munzona_{ano}.zip        -> candidacies.votes (soma por candidatura e turno)
  prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{ano}.zip
      receitas_candidatos_{ano}_*.csv     -> candidacies.raised_cents (soma de VR_RECEITA) e mapa prestador→candidatura
      despesas_pagas_candidatos_{ano}_*.csv -> candidacies.spent_cents (soma de VR_PAGTO_DESPESA, via SQ_PRESTADOR_CONTAS)
Só atualiza candidaturas já carregadas (por padrão: eleitos). Valor ausente na fonte continua null, nunca 0.
Votos: QT_VOTOS_NOMINAIS_VALIDOS quando a fonte publica (2024+); senão QT_VOTOS_NOMINAIS.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict

import psycopg

from ..db import SkipUnchanged, run
from ..remotezip import checksum, open_remote, pick_members, rows
from ..util import cents

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
                t0, n = time.monotonic(), 0
                for m in members:
                    log.info("tse votos %d: lendo %s (%.0f MB comprimidos)", year, m.filename, m.compress_size / 1e6)
                    for sq, turno, valid, nominal in rows(z, m, ["SQ_CANDIDATO", "NR_TURNO", "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"]):
                        n += 1
                        if sq not in want:
                            continue
                        q = valid if valid not in ("", "-1", "#NULO") else nominal
                        try:
                            agg[(sq, int(turno or 1))] += int(q)
                        except ValueError:
                            r.reject(1)
                log.info("tse votos %d: %d linhas em %.0fs, %d candidaturas com voto", year, n, time.monotonic() - t0, len(agg))
                r.add(_apply(conn, year, "votes", agg, by_round=True))
        except SkipUnchanged:
            continue


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
                for m in rec:
                    log.info("tse contas %d: lendo %s (%.0f MB)", year, m.filename, m.compress_size / 1e6)
                    for sq, sp, v in rows(z, m, ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA"]):
                        if sq not in want:
                            continue
                        prestador[sp] = sq
                        c = cents(v)
                        if c is not None:
                            raised[sq] += c
                spent: dict[str, int] = defaultdict(int)
                for m in des:
                    log.info("tse contas %d: lendo %s (%.0f MB)", year, m.filename, m.compress_size / 1e6)
                    for sp, v in rows(z, m, ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA"]):
                        sq = prestador.get(sp)
                        c = cents(v)
                        if sq and c is not None:
                            spent[sq] += c
                log.info("tse contas %d: %d candidaturas com receita, %d com despesa paga", year, len(raised), len(spent))
                r.add(_apply(conn, year, "raised_cents", raised, by_round=False))
                r.add(_apply(conn, year, "spent_cents", spent, by_round=False))
        except SkipUnchanged:
            continue
