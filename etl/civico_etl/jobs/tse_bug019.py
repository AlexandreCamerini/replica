"""civico-etl tse.fix019 --year Y [--apply]: corrige no banco a contagem dupla de presidente (BUG-019, D166) sem rebaixar o BRASIL.

Causa: pick_members lia …_BRASIL.csv + …_BR.csv, e o BRASIL já contém o BR (eleição presidencial). Tudo que vem do BR entrou
duas vezes: candidacies.votes, candidacy_place_votes, candidacies.raised_cents/spent_cents e campaign_finance_entries.

Reparo: baixa só os …_BR.csv (2 a 250 MB, contra ~4 GB do BRASIL), recalcula a contribuição deles com as MESMAS funções do job
(aggregate_votes / aggregate_finance / mapa de municípios) e, linha a linha, grava o valor da fonte só onde o banco tem
exatamente 2x esse valor (duplicação provada). Linha com 1x já está certa (idempotente: rodar de novo não muda nada).
Qualquer outro valor é divergência: não é tocada e sai no log/notes para investigação.
Sem --apply é dry-run (só relata). Escrita em lotes curtos com commit, para não segurar lock sobre o dev server.
"""

from __future__ import annotations

import logging
from collections import defaultdict

import psycopg

from ..db import run
from ..remotezip import open_remote
from ..util import chunked
from .tse_votos_contas import BASE, _known, _muni_map, aggregate_finance, aggregate_votes

log = logging.getLogger("etl.tse.bug019")
BATCH = 2000


def classify(db_value: int | None, source_value: int) -> str:
    """'dobro' (banco = 2x fonte: corrigir), 'ok' (= fonte), 'divergente' (qualquer outra coisa: não tocar)."""
    if db_value is None:
        return "divergente"
    if source_value != 0 and db_value == 2 * source_value:
        return "dobro"
    if db_value == source_value:
        return "ok"
    return "divergente"


def _br(z, prefix: str):
    return [i for i in z.infolist() if i.filename.startswith(prefix) and i.filename.upper().endswith("_BR.CSV")]


def _write(conn: psycopg.Connection, sql_tmp: str, cols: str, update_sql: str, rows_: list[tuple]) -> int:
    n = 0
    for chunk in chunked(rows_, BATCH):
        cur = conn.cursor()
        cur.execute(f"create temp table tmp_fix ({sql_tmp}) on commit drop")
        with cur.copy(f"copy tmp_fix ({cols}) from stdin") as cp:
            for r in chunk:
                cp.write_row(r)
        cur.execute(update_sql)
        n += cur.rowcount
        conn.commit()
    return n


def fix_year(conn: psycopg.Connection, year: int, apply: bool) -> dict[str, dict[str, int]]:
    stats: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    want = _known(conn, year)

    # 1) votos por candidatura e turno
    zv = open_remote(f"{BASE}/votacao_candidato_munzona/votacao_candidato_munzona_{year}.zip")
    br = _br(zv, f"votacao_candidato_munzona_{year}")
    if not br:
        log.info("%d: sem …_BR.csv de votação; nada a corrigir", year)
        return stats
    va = aggregate_votes(zv, br, want, log_prefix=f"bug019 votos {year}")
    cand = {(r["tse_sequencial"], r["round"]): (str(r["id"]), r["votes"]) for r in conn.execute(
        "select c.id, c.tse_sequencial, e.round, c.votes from candidacies c join elections e on e.id = c.election_id where e.year = %s", (year,))}
    fix_votes, diverg = [], []
    for (sq, t), v in va.agg.items():
        if (sq, t) not in cand:
            continue
        cid, dbv = cand[(sq, t)]
        k = classify(dbv, v)
        stats["candidacies.votes"][k] += 1
        if k == "dobro":
            fix_votes.append((cid, dbv, v))
        elif k == "divergente":
            diverg.append(("votes", sq, t, dbv, v))

    # 2) votos por município (mesmo mapa do job, D15)
    look = _muni_map(conn)
    place: dict[tuple[str, str], int] = defaultdict(int)
    for (sq, t, uf, mun), v in va.by_place.items():
        pl = look(uf, mun)
        if pl and (sq, t) in cand:
            place[(cand[(sq, t)][0], pl)] += v
    cids = sorted({c for c, _ in place})
    dbp = {(str(r["candidacy_id"]), str(r["place_id"])): r["votes"] for r in conn.execute(
        "select candidacy_id, place_id, votes from candidacy_place_votes where candidacy_id = any(%s::uuid[])", (cids,))} if cids else {}
    fix_place = []
    for key, v in place.items():
        k = classify(dbp.get(key), v)
        stats["candidacy_place_votes"][k] += 1
        if k == "dobro":
            fix_place.append((key[0], key[1], dbp[key], v))
        elif k == "divergente" and len(diverg) < 200:
            diverg.append(("place", key, dbp.get(key), v))

    # 3) dinheiro de campanha (receita, despesa paga e categorias)
    zc = open_remote(f"{BASE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{year}.zip")
    fa = aggregate_finance(zc, _br(zc, f"receitas_candidatos_{year}"), _br(zc, f"despesas_pagas_candidatos_{year}"), want, log_prefix=f"bug019 contas {year}")
    money = {r["tse_sequencial"]: (r["raised"], r["spent"]) for r in conn.execute(
        """select c.tse_sequencial, max(c.raised_cents) raised, max(c.spent_cents) spent, count(distinct c.raised_cents) nr, count(distinct c.spent_cents) ns
           from candidacies c join elections e on e.id = c.election_id where e.year = %s group by 1 having count(distinct c.raised_cents) <= 1 and count(distinct c.spent_cents) <= 1""", (year,))}
    fix_money: list[tuple[str, str, int, int]] = []
    for col, src, idx in (("raised_cents", fa.raised, 0), ("spent_cents", fa.spent, 1)):
        for sq, v in src.items():
            if sq not in money:
                continue
            k = classify(money[sq][idx], v)
            stats[f"candidacies.{col}"][k] += 1
            if k == "dobro":
                fix_money.append((col, sq, money[sq][idx], v))
            elif k == "divergente":
                diverg.append((col, sq, money[sq][idx], v))
    keys = {f"tse:{year}:{sq}:{d}:{cat[:120]}": v for (sq, d, cat), v in fa.by_cat.items()}
    dbe = {r["source_key"]: r["amount_cents"] for r in conn.execute(
        "select source_key, amount_cents from campaign_finance_entries where source_key = any(%s)", (list(keys),))} if keys else {}
    fix_entries = []
    for sk, v in keys.items():
        if sk not in dbe:
            continue
        k = classify(dbe[sk], v)
        stats["campaign_finance_entries"][k] += 1
        if k == "dobro":
            fix_entries.append((sk, dbe[sk], v))
        elif k == "divergente":
            diverg.append(("entry", sk, dbe[sk], v))

    for d in diverg[:50]:
        log.warning("%d divergente (não tocado): %s", year, d)
    if not apply:
        return stats

    with run(conn, f"tse.fix019.{year}", "tse") as r:
        # where com o valor antigo: só troca se o banco ainda tem exatamente o dobro lido agora (sem corrida com outra carga)
        r.add(_write(conn, "id uuid, old bigint, v bigint", "id, old, v",
                     "update candidacies c set votes = t.v, updated_at = now() from tmp_fix t where c.id = t.id and c.votes = t.old", fix_votes))
        r.add(_write(conn, "cid uuid, pid uuid, old bigint, v bigint", "cid, pid, old, v",
                     """update candidacy_place_votes p set votes = t.v, updated_at = now() from tmp_fix t
                        where p.candidacy_id = t.cid and p.place_id = t.pid and p.votes = t.old""", fix_place))
        for col in ("raised_cents", "spent_cents"):
            r.add(_write(conn, "sq text, old bigint, v bigint", "sq, old, v",
                         f"""update candidacies c set {col} = t.v, updated_at = now() from tmp_fix t, elections e
                             where c.tse_sequencial = t.sq and c.election_id = e.id and e.year = {int(year)} and c.{col} = t.old""",
                         [(sq, old, v) for (c, sq, old, v) in fix_money if c == col]))
        r.add(_write(conn, "sk text, old bigint, v bigint", "sk, old, v",
                     "update campaign_finance_entries f set amount_cents = t.v, updated_at = now() from tmp_fix t where f.source_key = t.sk and f.amount_cents = t.old", fix_entries))
        r.notes.append(f"BUG-019: {dict((k, dict(v)) for k, v in stats.items())}; divergentes não tocados: {len(diverg)}")
    return stats


def run_fix(conn: psycopg.Connection, years: list[int], apply: bool) -> None:
    for y in years:
        st = fix_year(conn, y, apply)
        log.info("BUG-019 %d (%s): %s", y, "aplicado" if apply else "dry-run", {k: dict(v) for k, v in st.items()})
