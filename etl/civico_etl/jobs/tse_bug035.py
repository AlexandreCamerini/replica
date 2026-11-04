"""civico-etl tse.fix035 [--apply]: SQ_CANDIDATO repetido dentro do consulta_cand_2012 (BUG-035, D224-D225).

Causa: o arquivo de 2012 traz a eleição ordinária (07/10/2012) e as suplementares de 2013 a 2015. Em 91 SQ, o mesmo número
aparece numa linha da ordinária e noutra de uma suplementar de outro município, de pessoas diferentes (título diferente nas
91). A premissa do D210 ("o SQ é único dentro da eleição") vale para a eleição do banco, mas não para o arquivo. O
`tse.fix032` lia "a primeira linha com o SQ" e conferiu 8 candidaturas contra a linha da outra pessoa: removeu-as do dono.

Reparo:
  1. Cada candidatura de 2012 do banco acha a SUA linha da fonte pelo SQ + município da disputa (o place da UE).
  2. Chave: `tse:2012:SQ` vira `tse:2012:UE:SQ` (tse_candidatos.tse_key), uma por candidatura.
  3. As candidaturas removidas pelo BUG-032 com SQ repetido são reconferidas contra a linha do município delas. As que são
     da pessoa de origem (título ou nome civil + nascimento) voltam de identity_repair_log.raw, com os mandatos, e ganham
     a linha 'restaurado' (bug BUG-035) no log.
  4. Relatório das 91 duplas: para cada linha, se a candidatura está no banco e na pessoa do título.
Sem --apply é dry-run. Idempotente. Lotes com commit.
"""

from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

import duckdb
import psycopg

from ..util import chunked, fold, parse_date
from .tse_bug032 import Pessoa, Src, _load_people, _source_paths, norm_titulo, same_person
from .tse_candidatos import muni_index, tse_key

log = logging.getLogger("etl.tse.bug035")
BUG = "BUG-035"
YEAR = 2012
BATCH = 1000
COLS = ["SQ_CANDIDATO", "SG_UF", "SG_UE", "NM_UE", "NM_TIPO_ELEICAO", "DT_ELEICAO", "CD_CARGO", "NR_TITULO_ELEITORAL_CANDIDATO",
        "NM_CANDIDATO", "NM_URNA_CANDIDATO", "DT_NASCIMENTO", "DS_SIT_TOT_TURNO"]


@dataclass(frozen=True)
class Row:
    sq: str
    ue: str
    place: str | None
    kind: str  # municipal | suplementar
    held: date | None
    cargo: str
    src: Src
    sit: str


def load_rows(conn: psycopg.Connection, year: int = YEAR) -> dict[str, list[Row]]:
    """SQ -> todas as linhas do consulta_cand do ano (sem repetir turno), com o município do IBGE."""
    muni = muni_index(conn)
    con = duckdb.connect()
    out: dict[str, list[Row]] = defaultdict(list)
    seen = set()
    for p in _source_paths(year):
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        con.register("t", rel)
        for r in con.execute(f"select distinct {', '.join(COLS)} from t").fetchall():
            x = dict(zip(COLS, r))
            sq, ue = (x["SQ_CANDIDATO"] or "").strip(), (x["SG_UE"] or "").strip()
            if not sq or (sq, ue) in seen:
                continue
            seen.add((sq, ue))
            kind = "suplementar" if "SUPLEMENTAR" in (x["NM_TIPO_ELEICAO"] or "").upper() else "municipal"
            out[sq].append(Row(sq, ue, muni((x["SG_UF"] or "").strip().upper(), x["NM_UE"]), kind, parse_date(x["DT_ELEICAO"]),
                               (x["CD_CARGO"] or "").strip(),
                               Src(norm_titulo(x["NR_TITULO_ELEITORAL_CANDIDATO"]), fold(x["NM_CANDIDATO"]), parse_date(x["DT_NASCIMENTO"]),
                                   x["NM_URNA_CANDIDATO"] or "", f"{x['NM_UE']}/{x['SG_UF']}"), x["DS_SIT_TOT_TURNO"] or ""))
        con.unregister("t")
    return out


def pick_row(rows: list[Row], place_id: str | None, kind: str | None = None) -> Row | None:
    """A linha da fonte de uma candidatura: o SQ basta quando é único; repetido, decide o município da disputa (e o tipo de
    eleição). Sem uma linha só, devolve None (não chuta)."""
    if len(rows) == 1:
        return rows[0]
    hit = [r for r in rows if r.place == place_id and (kind is None or r.kind == kind)]
    return hit[0] if len(hit) == 1 else None


def _cands(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return conn.execute(
        """select c.id::text, c.tse_sequencial sq, c.person_id::text, ct.place_id::text, e.kind
           from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
           where e.year = %s""", (YEAR,)).fetchall()


def rekey(conn: psycopg.Connection, rows: dict[str, list[Row]], apply: bool) -> Counter:
    """`tse:2012:SQ` -> `tse:2012:UE:SQ`, uma chave por candidatura de 2012 (a pessoa da candidatura)."""
    st: Counter = Counter()
    want: dict[str, str] = {}
    for c in _cands(conn):
        r = pick_row(rows.get(c["sq"], []), c["place_id"], c["kind"])
        if not r:
            st["sem_linha_unica"] += 1
            log.warning("candidatura %s (SQ %s) sem linha única da fonte: chave não gravada", c["id"], c["sq"])
            continue
        want[tse_key(YEAR, c["sq"], r.ue)] = c["person_id"]
    src = str(conn.execute("select id from sources where slug = 'tse'").fetchone()["id"])
    have = {r["external_id"]: str(r["person_id"]) for r in conn.execute(
        "select external_id, person_id from person_external_ids where source_id = %s and external_id like %s", (src, f"{YEAR}:%"))}
    old = [k for k in have if k.count(":") == 1]
    new = [(pid, src, k) for k, pid in want.items() if have.get(k) != pid]
    st.update(chaves_antigas=len(old), chaves_novas=len(new), chaves_por_candidatura=len(want))
    if apply:
        for chunk in chunked(new, BATCH):
            conn.cursor().executemany(
                """insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                   select %s, %s, %s, coalesce(o.match_method, 'exact_id'), coalesce(o.match_confidence, 1.0)
                   from (select 1) one left join person_external_ids o on o.source_id = %s and o.external_id = %s
                   on conflict (source_id, external_id) do update set person_id = excluded.person_id""",
                [(pid, s, k, s, f"{YEAR}:{k.rsplit(':', 1)[1]}") for pid, s, k in chunk])
            conn.commit()
        for chunk in chunked(old, BATCH):
            conn.execute("delete from person_external_ids where source_id = %s and external_id = any(%s)", (src, chunk))
            conn.commit()
    return st


def restore(conn: psycopg.Connection, rows: dict[str, list[Row]], apply: bool) -> list[dict[str, Any]]:
    """Candidaturas removidas pelo BUG-032 com SQ repetido em 2012: volta a que é da pessoa de origem pela linha do município."""
    people, _, _ = _load_people(conn)
    dup = {sq for sq, rs in rows.items() if len(rs) > 1}
    logs = conn.execute(
        """select l.* from identity_repair_log l where l.bug = 'BUG-032' and l.year = %s and l.action = 'removido'
             and l.tse_sequencial = any(%s)
             and not exists (select 1 from identity_repair_log r where r.bug = %s and r.candidacy_id = l.candidacy_id)""",
        (YEAR, sorted(dup), BUG)).fetchall()
    places = {str(r["id"]): str(r["place_id"]) for r in conn.execute("select id, place_id from contests where id = any(%s::uuid[])",
                                                                      ([l["raw"]["candidacy"]["contest_id"] for l in logs],))}
    kinds = {str(r["id"]): r["kind"] for r in conn.execute("select id, kind from elections where year = %s", (YEAR,))}
    out = []
    for l in logs:
        cand = l["raw"]["candidacy"]
        pid = str(l["from_person_id"])
        r = pick_row(rows[l["tse_sequencial"]], places.get(cand["contest_id"]), kinds.get(cand["election_id"]))
        basis = same_person(r.src, people[pid]) if r and pid in people else None
        out.append(dict(log=l, row=r, basis=basis, pid=pid))
        log.info("removida %s SQ %s de %s: linha do município = %s (%s) -> %s", l["candidacy_id"], l["tse_sequencial"], pid,
                 r.src.lugar if r else None, r.src.urna if r else None, f"restaurar ({basis})" if basis else "fica removida")
    todo = [x for x in out if x["basis"]]
    if not apply:
        return out
    cur = conn.cursor()
    for x in todo:
        l, cand = x["log"], x["log"]["raw"]["candidacy"]
        with conn.transaction():
            busy = cur.execute("select id from candidacies where person_id = %s and election_id = %s", (x["pid"], cand["election_id"])).fetchone()
            if busy:
                log.error("pessoa já tem candidatura na eleição, não restaurei %s", l["candidacy_id"])
                continue
            cols = [k for k in cand if k not in ("created_at", "updated_at")]
            cur.execute(f"insert into candidacies ({', '.join(cols)}) select {', '.join(cols)} from jsonb_populate_record(null::candidacies, %s::jsonb) "
                        "on conflict do nothing", (json.dumps(cand),))
            n_m = 0
            for m in l["raw"]["mandates"]:
                if m["status_source"] != "tse":
                    continue  # mandato da casa ficou na pessoa (só perdeu o vínculo): religa
                clash = cur.execute(
                    """select id from mandates where person_id = %s and office_id = %s
                         and daterange(started_on, ends_on, '[)') && daterange(%s, %s, '[)')""",
                    (m["person_id"], m["office_id"], m["started_on"], m["ends_on"])).fetchone()
                if clash:
                    cur.execute("update mandates set candidacy_id = %s where id = %s and candidacy_id is null", (cand["id"], clash["id"]))
                    continue
                mc = [k for k in m if k not in ("created_at", "updated_at")]
                cur.execute(f"insert into mandates ({', '.join(mc)}) select {', '.join(mc)} from jsonb_populate_record(null::mandates, %s::jsonb)",
                            (json.dumps(m, default=str),))
                n_m += 1
            cur.execute("update mandates set candidacy_id = %s where person_id = %s and candidacy_id is null and id = any(%s::uuid[])",
                        (cand["id"], x["pid"], [m["id"] for m in l["raw"]["mandates"]]))
            cur.execute(
                """insert into identity_repair_log (bug, candidacy_id, year, tse_sequencial, action, basis, from_person_id, to_person_id,
                                                    mandates_moved, raw)
                   values (%s, %s, %s, %s, 'restaurado', %s, %s, %s, %s, %s) on conflict (bug, candidacy_id) do nothing""",
                (BUG, l["candidacy_id"], YEAR, l["tse_sequencial"], x["basis"], x["pid"], x["pid"], n_m,
                 json.dumps({"fonte": {"urna": x["row"].src.urna, "lugar": x["row"].src.lugar}}, ensure_ascii=False)))
            src = str(cur.execute("select id from sources where slug = 'tse'").fetchone()["id"])
            cur.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                           values (%s, %s, %s, %s, %s) on conflict (source_id, external_id) do nothing""",
                        (x["pid"], src, tse_key(YEAR, l["tse_sequencial"], x["row"].ue), "exact_id" if x["basis"] == "titulo" else "name_birth",
                         1.0 if x["basis"] == "titulo" else 0.95))
    conn.commit()
    return out


def audit_pairs(conn: psycopg.Connection, rows: dict[str, list[Row]]) -> Counter:
    """As 91 duplas: cada linha está no banco, na pessoa certa? 'fora_do_diretorio' = ninguém do diretório tem o título."""
    people, by_titulo, by_nb = _load_people(conn)
    db: dict[tuple[str, str | None], list[str]] = defaultdict(list)
    for c in _cands(conn):
        db[(c["sq"], c["place_id"])].append(c["person_id"])
    st: Counter = Counter()
    for sq, rs in sorted(rows.items()):
        if len(rs) < 2:
            continue
        st["sq_repetidos"] += 1
        for r in rs:
            owners = db.get((sq, r.place), [])
            dono = (by_titulo.get(r.src.titulo, set()) if r.src.titulo else set()) or (by_nb.get((r.src.nome, r.src.nasc), set()) if r.src.nasc else set())
            if owners:
                ok = all(same_person(r.src, people[p]) for p in owners)
                k = "no_banco_pessoa_certa" if ok else "no_banco_pessoa_errada"
            elif dono:
                k = "dono_no_diretorio_sem_candidatura"
            else:
                k = "fora_do_diretorio"
            st[k] += 1
            if k in ("no_banco_pessoa_errada", "dono_no_diretorio_sem_candidatura"):
                log.warning("dupla %s %s %s (%s, %s): %s", sq, r.kind, r.src.lugar, r.src.urna, r.sit, k)
    return st


def run_fix(conn: psycopg.Connection, apply: bool) -> None:
    rows = load_rows(conn)
    log.info("fonte %d: %d SQ, %d repetidos", YEAR, len(rows), sum(1 for r in rows.values() if len(r) > 1))
    log.info("antes, duplas: %s", dict(audit_pairs(conn, rows)))
    res = restore(conn, rows, apply)
    log.info("removidas pelo BUG-032 com SQ repetido: %d, da pessoa de origem: %d", len(res), sum(1 for x in res if x["basis"]))
    log.info("chaves: %s", dict(rekey(conn, rows, apply)))
    if apply:
        log.info("depois, duplas: %s", dict(audit_pairs(conn, rows)))
    else:
        log.info("dry-run (use --apply)")
