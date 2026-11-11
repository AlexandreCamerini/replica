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
catálogo D11: receitas também por TIPO DE FONTE (campaign_finance_by_origin, 7 origens fechadas, ver bucket_receita) e, só para partido e pessoa
jurídica, o nome do doador (campaign_finance_donors). Pessoa física existe apenas no agregado: nome e CPF dela nunca são gravados.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field

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


# BUG-048: nos anos de SQ_COM_UE (2012) o SQ se repete entre a ordinária de um município e a suplementar de outro (BUG-035,
# D224). Lá a candidatura da votação e das contas é (SG_UE, SQ), e a UE de uma candidatura do banco é a da chave tse
# ANO:UE:SQ da própria pessoa (uma por candidatura: 19.883 de 19.883 em 2012 no banco local, 2026-11-11). Nos outros anos a
# chave continua sendo o SQ, e as estruturas, os SQL e os source_key ficam como eram.
CAND_UE_SQL = """
select c.id::text id, c.tse_sequencial sq, e.round, split_part(x.external_id, ':', 2) ue
from candidacies c join elections e on e.id = c.election_id
join person_external_ids x on x.person_id = c.person_id
  and split_part(x.external_id, ':', 1) = e.year::text and split_part(x.external_id, ':', 3) = c.tse_sequencial
  and x.external_id ~ '^[0-9]{4}:[0-9A-Z]+:[0-9]+$'
join sources s on s.id = x.source_id and s.slug = 'tse'
where e.year = %s
"""


def _with_ue(year: int) -> bool:
    from .tse_candidatos import SQ_COM_UE

    return int(year) in SQ_COM_UE


def _skey(k) -> str:
    """Parte da candidatura no source_key: o SQ (como sempre foi); em SQ_COM_UE, 'UE:SQ', para as duas UEs não colidirem."""
    return k if isinstance(k, str) else f"{k[0]}:{k[1]}"


def _cand_by_ue(conn: psycopg.Connection, year: int) -> dict[tuple[tuple[str, str], int], str]:
    """((UE, SQ), turno) -> candidatura, nos anos de SQ_COM_UE. Candidatura com mais de uma UE (não deveria existir: check
    "mesma pessoa com o mesmo SQ em municípios diferentes") fica de fora: não chuta."""
    rows_ = conn.execute(CAND_UE_SQL, (year,)).fetchall()
    ues: dict[str, set[str]] = defaultdict(set)
    for r in rows_:
        ues[r["id"]].add(r["ue"])
    return {((r["ue"], r["sq"]), r["round"]): r["id"] for r in rows_ if len(ues[r["id"]]) == 1}


def _note_sem_ue(r, year: int, keys: set, what: str) -> None:
    """Em SQ_COM_UE, linha da fonte sem SG_UE não tem candidatura certa: não grava nada e fica a nota (layout não conferido)."""
    n = sum(1 for k in keys if not isinstance(k, str) and not k[0])
    if n:
        r.notes.append(f"{n} candidaturas da {what} de {year} sem SG_UE na fonte: não gravadas (SQ repete entre UEs, BUG-048)")
        log.warning("tse %d: %d candidaturas da %s sem SG_UE: não gravadas", year, n, what)


def _apply_ue(conn: psycopg.Connection, year: int, col: str, values: dict, by_round: bool) -> int:
    """_apply nos anos de SQ_COM_UE: casa (UE, SQ) pela chave da pessoa. Linha sem SG_UE na fonte não grava nada."""
    cand = _cand_by_ue(conn, year)
    upd: list[tuple[str, int]] = []
    for key, v in values.items():
        k, turno = key if by_round else (key, 0)
        if turno:
            cid = cand.get((k, turno))
            if cid:
                upd.append((cid, v))
        else:  # receita/despesa: toda candidatura (1º e 2º turno) da UE e SQ, como o SQL dos outros anos
            upd.extend((cid, v) for (kk, _), cid in cand.items() if kk == k)
    if not upd:
        return 0
    cur = conn.cursor()
    cur.execute("create temp table tmp_vu (id uuid, v bigint) on commit drop")
    with cur.copy("copy tmp_vu (id, v) from stdin") as cp:
        for row in upd:
            cp.write_row(row)
    cur.execute(f"update candidacies c set {col} = t.v, updated_at = now() from tmp_vu t where c.id = t.id and c.{col} is distinct from t.v")
    n = cur.rowcount
    cur.execute("drop table tmp_vu")
    return n


def _apply(conn: psycopg.Connection, year: int, col: str, values: dict[str, int], by_round: bool) -> int:
    if _with_ue(year):
        return _apply_ue(conn, year, col, values, by_round)
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
    cid = _cand_by_ue(conn, year) if _with_ue(year) else {(row["tse_sequencial"], row["round"]): str(row["id"]) for row in conn.execute(
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
    "com recurso", ou recurso provido) volta a 'em_exercicio' se o período ainda está correndo.
    Em SQ_COM_UE, `sqs` são chaves (UE, SQ) e o casamento é pela candidatura daquela UE (BUG-048)."""
    match, arg = "c.tse_sequencial = any(%s)", list(sqs)
    if _with_ue(year):
        match, arg = "c.id = any(%s::uuid[])", [cid for (k, _), cid in _cand_by_ue(conn, year).items() if k in sqs]
    cur = conn.execute(
        f"""update mandates m set status = case when m.ends_on <= current_date then 'encerrado' else 'em_exercicio' end, updated_at = now()
           from candidacies c join elections e on e.id = c.election_id
           where m.candidacy_id = c.id and e.year = %s and not ({match})
             and m.status = 'cassado' and m.status_source = 'tse' and m.started_on <= current_date""",
        (year, arg),
    )
    if cur.rowcount:
        log.info("tse %d: %d mandatos deixaram de constar como cassados (situação sem fato consumado)", year, cur.rowcount)
    if not sqs:
        return
    cur = conn.execute(
        f"""update mandates m set status = 'cassado', updated_at = now()
           from candidacies c join elections e on e.id = c.election_id
           where m.candidacy_id = c.id and e.year = %s and {match} and m.status = 'em_exercicio' and m.status_source = 'tse'""",
        (year, arg),
    )
    if cur.rowcount:
        log.info("tse %d: %d mandatos marcados como cassados", year, cur.rowcount)


@dataclass
class VotesAgg:
    agg: dict[tuple[str, int], int] = field(default_factory=lambda: defaultdict(int))  # (sq, turno) -> votos
    by_place: dict[tuple[str, int, str, str], int] = field(default_factory=lambda: defaultdict(int))  # (sq, turno, UF, município); D15
    cassados: set[str] = field(default_factory=set)
    com_recurso: set[str] = field(default_factory=set)  # D90: registrado, não aplicado
    lines: int = 0
    rejected: int = 0


def aggregate_votes(z, members, want: set[str], log_prefix: str = "tse votos", year: int | None = None) -> VotesAgg:
    """Soma a votação dos CSVs `members` (já escolhidos por pick_members: nunca BRASIL + BR juntos, BUG-019).
    Com `year` em SQ_COM_UE, a chave da candidatura é (SG_UE, SQ) em vez do SQ (BUG-048)."""
    out = VotesAgg()
    by_ue = year is not None and _with_ue(year)
    for m in members:
        log.info("%s: lendo %s (%.0f MB comprimidos)", log_prefix, m.filename, m.compress_size / 1e6)
        for sq, turno, valid, nominal, uf, mun, cargo, cass, ue in rows(z, m, ["SQ_CANDIDATO", "NR_TURNO", "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS", "SG_UF", "NM_MUNICIPIO", "CD_CARGO", "DS_SITUACAO_CASSACAO", "SG_UE"]):
            out.lines += 1
            if sq not in want:
                continue
            q = valid if valid not in ("", "-1", "#NULO") else nominal
            try:
                v = int(q)
            except ValueError:
                out.rejected += 1
                continue
            t = int(turno or 1)
            if by_ue:
                sq = (ue.strip(), sq)
            out.agg[(sq, t)] += v
            if cargo.strip() not in MUNICIPAL_CARGOS and uf not in ("ZZ", "BR", "VT"):
                out.by_place[(sq, t, uf, mun)] += v
            if cass and _is_cassado_definitivo(cass):
                out.cassados.add(sq)
            elif cass and "CASSAD" in cass.upper():
                out.com_recurso.add(sq)
    return out


ORIGINS = ("pessoa_fisica", "partido", "fefc", "fundo_partidario", "financiamento_coletivo", "recursos_proprios", "outros")


def bucket_receita(origem: str | None, fonte: str | None) -> str:
    """catálogo D11: uma receita cai em exatamente uma das 7 origens (função total: o que não se reconhece vai para 'outros', então a soma
    das origens é sempre o total arrecadado). Precedência: o FUNDO (DS_FONTE_RECEITA, e DS_ORIGEM_RECEITA nos layouts de 2018/2020)
    vence a origem, porque dinheiro de fundo público repassado por partido ou por outro candidato continua sendo do fundo."""
    o, f = fold(origem), fold(fonte)
    if "fundo especial" in f or "fundo especial" in o or "fefc" in o:
        return "fefc"
    if "fundo partidario" in f or "fundo partidario" in o:
        return "fundo_partidario"
    if "pessoas fisicas" in o or "pessoa fisica" in o:
        return "pessoa_fisica"
    if "partido politico" in o:
        return "partido"
    if "financiamento coletivo" in o:
        return "financiamento_coletivo"
    if "proprios" in o:
        return "recursos_proprios"
    return "outros"  # outros candidatos, rendimentos, doações pela internet, origem não identificada, #NULO


CAMPANHA_CNPJ = re.compile(r"^eleicao\s+\d{4}\b")  # razão social do CNPJ de campanha: "ELEICAO 2022 FULANO DE TAL DEPUTADO ESTADUAL"


def donor_of(origem: str | None, nome: str | None, doc: str | None, rfb: str | None = None, sigla: str | None = None) -> tuple[str, str, str | None] | None:
    """catálogo D11: doador com nome só quando é partido (origem 'Recursos de partido político') ou pessoa jurídica (CNPJ de 14 dígitos fora das origens
    de pessoa física, de outros candidatos e de recursos próprios). Devolve (tipo, nome, cnpj) ou None. Pessoa física: sempre None.
    Nome do partido: 'SIGLA · órgão' ('UNIÃO · Direção Nacional'), porque NM_DOADOR sozinho é só o nível ('Direção Nacional');
    de pessoa jurídica: o nome na Receita (NM_DOADOR_RFB), senão NM_DOADOR.
    CNPJ de campanha de candidato (nome "ELEICAO AAAA ..."): é um candidato, não pessoa jurídica. O schema (0084) só aceita partido e
    pessoa_juridica, então esse doador NÃO é gravado como nomeado; o valor continua na origem agregada."""
    o = fold(origem)
    digits = re.sub(r"\D", "", doc or "")
    nome, rfb, sigla = (" ".join((x or "").split()) for x in (nome, rfb, sigla))
    if "partido politico" in o:
        label = f"{sigla} · {nome}" if sigla and nome else (rfb or nome or sigla)
        return ("partido", label[:300], digits if len(digits) == 14 else None) if label else None
    if len(digits) == 14 and not any(k in o for k in ("pessoas fisicas", "pessoa fisica", "outros candidatos", "proprios")):
        if CAMPANHA_CNPJ.match(fold(nome)) or CAMPANHA_CNPJ.match(fold(rfb)):
            return None
        label = rfb or nome
        return ("pessoa_juridica", label[:300], digits) if label else None
    return None


@dataclass
class FinanceAgg:
    raised: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    spent: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    by_cat: dict[tuple[str, str, str], int] = field(default_factory=lambda: defaultdict(int))  # D07
    by_origin: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))  # catálogo D11: (sq, origem) -> centavos
    origin_lines: dict[tuple[str, str], int] = field(default_factory=lambda: defaultdict(int))
    donors: dict[tuple[str, str, str, str, str | None], int] = field(default_factory=lambda: defaultdict(int))  # catálogo D11: (sq, origem, tipo, nome, cnpj)
    donor_label: dict[tuple[str, str, str, str, str | None], str] = field(default_factory=dict)  # chave sem caixa/acento -> nome como a fonte escreveu


def aggregate_finance(z, rec, des, want: set[str], log_prefix: str = "tse contas", year: int | None = None) -> FinanceAgg:
    """Receita e despesa paga por candidatura (rec/des já escolhidos por pick_members, BUG-019).
    D07: origem do dinheiro e destino da despesa agregados por categoria oficial do TSE; nunca grava fornecedor nem doador pessoa física.
    Catálogo D11 (08/11): além disso, receita por tipo de fonte e doador nomeado só se for partido ou pessoa jurídica (`donor_of`).
    Com `year` em SQ_COM_UE, a chave da candidatura é (SG_UE, SQ) em vez do SQ; a despesa segue a receita pelo prestador (BUG-048)."""
    out = FinanceAgg()
    by_ue = year is not None and _with_ue(year)
    prestador: dict[str, str] = {}
    for m in rec:
        log.info("%s: lendo %s (%.0f MB)", log_prefix, m.filename, m.compress_size / 1e6)
        for sq, sp, v, origem, fonte, doc, nome, rfb, sigla, ue in rows(z, m, ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA", "DS_FONTE_RECEITA",
                                                                   "NR_CPF_CNPJ_DOADOR", "NM_DOADOR", "NM_DOADOR_RFB", "SG_PARTIDO_DOADOR", "SG_UE"]):
            if sq not in want:
                continue
            if by_ue:
                sq = (ue.strip(), sq)
            prestador[sp] = sq
            c = cents(v)
            if c is not None:
                out.raised[sq] += c
                out.by_cat[(sq, "receita", (origem or "Não informado").strip() or "Não informado")] += c
                b = bucket_receita(origem, fonte)
                out.by_origin[(sq, b)] += c
                out.origin_lines[(sq, b)] += 1
                d = donor_of(origem, nome, doc, rfb, sigla)  # nome/CPF de pessoa física morrem aqui: só partido e CNPJ passam
                if d:
                    k = (sq, b if b in ("partido", "fefc", "fundo_partidario") else "outros", d[0], fold(d[1]), d[2])  # 'DIREÇÃO NACIONAL' = 'Direção Nacional'
                    out.donors[k] += c
                    out.donor_label.setdefault(k, d[1])
    for m in des:
        log.info("%s: lendo %s (%.0f MB)", log_prefix, m.filename, m.compress_size / 1e6)
        for sp, v, origem in rows(z, m, ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA", "DS_ORIGEM_DESPESA"]):
            sq = prestador.get(sp)
            c = cents(v)
            if sq and c is not None:
                out.spent[sq] += c
                out.by_cat[(sq, "despesa", (origem or "Não informado").strip() or "Não informado")] += c
    return out


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
                t0 = time.monotonic()
                va = aggregate_votes(z, members, want, log_prefix=f"tse votos {year}", year=year)
                r.reject(va.rejected)
                _note_sem_ue(r, year, {k for k, _ in va.agg}, "votação")
                agg, by_place, cassados, com_recurso, n = va.agg, va.by_place, va.cassados, va.com_recurso, va.lines
                log.info("tse votos %d: %d linhas em %.0fs, %d candidaturas com voto", year, n, time.monotonic() - t0, len(agg))
                r.add(_apply(conn, year, "votes", agg, by_round=True))
                r.add(_place_votes(conn, r, year, by_place))
                r.notes.append(f"{len(cassados)} candidaturas com cassação definitiva e {len(com_recurso - cassados)} com recurso (não cassa) na votação (DS_SITUACAO_CASSACAO)")
                _mark_cassados(conn, year, cassados)
        except SkipUnchanged:
            continue


def _cand_first_round(conn: psycopg.Connection, year: int) -> dict:
    """Chave da candidatura -> candidatura do 1º turno, onde as contas ficam. Em SQ_COM_UE a chave é (UE, SQ) (BUG-048)."""
    if _with_ue(year):
        out: dict[tuple[str, str], tuple[int, str]] = {}
        for (k, rnd), cid in _cand_by_ue(conn, year).items():
            if k not in out or rnd < out[k][0]:
                out[k] = (rnd, cid)
        return {k: cid for k, (_, cid) in out.items()}
    return {row["tse_sequencial"]: str(row["id"]) for row in conn.execute(
        """select distinct on (c.tse_sequencial) c.id, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
           where e.year = %s order by c.tse_sequencial, e.round""", (year,))}


def _finance_entries(conn: psycopg.Connection, year: int, by_cat: dict) -> int:
    cid = _cand_first_round(conn, year)
    rows_ = [(cid[sq], d, cat[:200], None, None, v, "BRL", None, f"tse:{year}:{_skey(sq)}:{d}:{cat[:120]}") for (sq, d, cat), v in by_cat.items() if sq in cid]
    return len(upsert(conn, "campaign_finance_entries", ["candidacy_id", "direction", "category", "counterpart_name", "counterpart_doc", "amount_cents", "currency", "occurred_on", "source_key"],
                      rows_, ["source_key"], update=["candidacy_id", "amount_cents"], returning=["id"]))


def _origin_entries(conn: psycopg.Connection, year: int, fa: FinanceAgg, r) -> int:
    """catálogo D11: grava as origens e os doadores nomeáveis. A soma das origens de cada candidatura tem de ser o total arrecadado: se não for, o run
    falha (nada gravado). Origem que sumiu da fonte neste ano é apagada com nota (a classificação pode mudar entre cargas)."""
    sums: dict[str, int] = defaultdict(int)
    for (q, _), v in fa.by_origin.items():
        sums[q] += v
    for sq, total in fa.raised.items():
        got = sums.get(sq, 0)
        if got != total:
            raise RuntimeError(f"origens somam {got} e o total arrecadado é {total} para {sq} ({year})")
    cid = _cand_first_round(conn, year)
    o_rows = [(cid[sq], o, v, fa.origin_lines[(sq, o)], f"tse:{year}:{_skey(sq)}:{o}") for (sq, o), v in fa.by_origin.items() if sq in cid]
    # doador = documento (CNPJ) quando houver, senão nome: o mesmo CNPJ com razões sociais diferentes (NM_DOADOR_RFB vs NM_DOADOR, caixa) é uma linha só;
    # sem isso as duas dividiriam o source_key e o upsert descartaria uma em silêncio. Rótulo = o da maior parcela (empate: ordem alfabética).
    grouped: dict[tuple[str, str, str, str], list] = {}
    for (sq, o, k, n, doc), v in fa.donors.items():
        if sq not in cid:
            continue
        g = grouped.setdefault((sq, o, k, doc or n), [0, doc, []])
        g[0] += v
        g[2].append((-v, fa.donor_label[(sq, o, k, n, doc)]))
    d_rows = [(cid[sq], o, k, min(g[2])[1], g[1], g[0], f"tse:{year}:{_skey(sq)}:{o}:{k}:{ident}") for (sq, o, k, ident), g in grouped.items()]
    n = len(upsert(conn, "campaign_finance_by_origin", ["candidacy_id", "origin", "amount_cents", "lines", "source_key"], o_rows, ["source_key"], returning=["id"]))
    n += len(upsert(conn, "campaign_finance_donors", ["candidacy_id", "origin", "donor_kind", "donor_name", "donor_doc", "amount_cents", "source_key"], d_rows,
                    ["source_key"], returning=["id"]))
    for table, rows_ in (("campaign_finance_by_origin", o_rows), ("campaign_finance_donors", d_rows)):
        gone = conn.execute(f"delete from {table} where source_key like %s and source_key <> all(%s)", (f"tse:{year}:%", [x[-1] for x in rows_])).rowcount
        if gone:
            r.notes.append(f"{gone} linhas de {table} de {year} saíram (reclassificação na fonte)")
    return n


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
            # sufixo = versão da classificação por origem (catálogo D11): o zip não mudou, mas as tabelas novas precisam ser preenchidas uma vez
            with run(conn, f"tse.contas.{year}", "tse", input_checksum=checksum(rec + des) + ":origem1", force=force) as r:
                want = _known(conn, year)
                fa = aggregate_finance(z, rec, des, want, log_prefix=f"tse contas {year}", year=year)
                _note_sem_ue(r, year, set(fa.raised), "receita")
                raised, spent, by_cat = fa.raised, fa.spent, fa.by_cat
                log.info("tse contas %d: %d candidaturas com receita, %d com despesa paga", year, len(raised), len(spent))
                r.add(_apply(conn, year, "raised_cents", raised, by_round=False))
                r.add(_apply(conn, year, "spent_cents", spent, by_round=False))
                r.add(_finance_entries(conn, year, by_cat))
                r.add(_origin_entries(conn, year, fa, r))
        except SkipUnchanged:
            continue
