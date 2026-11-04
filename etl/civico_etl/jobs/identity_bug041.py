"""civico-etl identity.fix041 [--apply]: título repetido pelo TSE, título reemitido e registro substituído (BUG-041, BUG-042 e
BUG-043; D240-D243).

Passos (cada um idempotente; sem --apply, só o relatório):
  1. tse_titulo_candidatura ganha nome civil, nascimento e número de cada linha (migração 0066), para todos os títulos do
     diretório. É o que deixa os checks novos rodarem em SQL.
  2. BUG-041: candidaturas cuja linha da fonte traz o título da pessoa com outro nascimento e nome civil sem token em comum
     (o check novo). Cada uma é conferida contra o consulta_cand e separada no padrão do fix038 (D236): a candidatura, com
     mandatos, bens e a chave `tse`, muda para uma pessoa criada a partir da linha da fonte, sem o título (que é do dono do
     crachá). Nada é apagado; tudo vai para identity_split_log (bug BUG-041).
  3. BUG-043: disputas da fonte (ano, tipo, UE, cargo, número e título) com mais de um registro, em que o banco ficou com o de
     posto menor. Recarga só dessas linhas pelo loader, que aplica o D238 (registration_rank) e manda o inferior inteiro para
     identity_repair_log (bug BUG-043).
  4. BUG-042: varre a fonte inteira com o resolve novo (sem gravar) e acha as linhas de título desconhecido que agora casam por
     reemissão no mesmo município (D241). Recarga só dessas linhas pelo loader. As linhas ELEITO que ficam no meio do caminho
     (grafia parecida sem a prova) são recarregadas também, e o loader as manda para a fila.
  5. tse_titulo_candidatura de novo, para os títulos que entraram no passo 4.
Escrita em lotes (um ano por transação no loader), porque o dev server lê o banco. Lê só o cache do ETL (sem rede).
Depois: civico-etl derive.stats e civico-etl check.
"""

from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import duckdb
import psycopg

from ..db import Run
from ..http import CACHE_DIR
from ..identity import PersonResolver
from ..util import nz, parse_date, titlecase_pt
from .checks_identity import IDENTITY_CHECKS
from .identity_bug038 import YEARS, backfill_titles, fmt, source_by_sq
from .tse_bug032 import _source_paths
from .tse_candidatos import CARGO, GENDER, ELECTED, _load_year, muni_index, registration_rank, row_result, tse_key

log = logging.getLogger("etl.identity.bug041")
FOREIGN_CHECK = next(q for n, q in IDENTITY_CHECKS if "outro nascimento e nome civil" in n)
SCAN_COLS = ["ANO_ELEICAO", "NM_TIPO_ELEICAO", "NR_TURNO", "SG_UF", "SG_UE", "NM_UE", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
             "NM_CANDIDATO", "NM_URNA_CANDIDATO", "DT_NASCIMENTO", "NR_TITULO_ELEITORAL_CANDIDATO", "SG_UF_NASCIMENTO",
             "DS_SIT_TOT_TURNO", "DS_DETALHE_SITUACAO_CAND"]


def bens_paths(year: int) -> list[Path]:
    d = CACHE_DIR / "tse" / f"bem_candidato_{year}"
    return sorted(d.glob("*_BRASIL.utf8.csv")) or sorted(d.glob("*.utf8.csv"))


def _kind(x: dict[str, Any]) -> str | None:
    t = (x.get("NM_TIPO_ELEICAO") or "").upper()
    return "suplementar" if "SUPLEMENTAR" in t else "ordinaria" if "ORDIN" in t else None


def iter_source(year: int):
    """Linhas do 1º turno do consulta_cand do ano (a 2ª linha do 2º turno é a mesma candidatura)."""
    con = duckdb.connect()
    for p in _source_paths(year):
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        con.register("t", rel)
        sel = ", ".join(c if c in rel.columns else f"NULL as {c}" for c in SCAN_COLS)
        cur = con.execute(f"select {sel} from t where coalesce(NR_TURNO, '1') = '1'")
        while batch := cur.fetchmany(50000):
            for r in batch:
                yield dict(zip(SCAN_COLS, r))
        con.unregister("t")


# ---------- BUG-041 ----------

def plan_041(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Candidaturas que o check do BUG-041 aponta, com a linha da fonte e todas as linhas do título."""
    q = FOREIGN_CHECK.replace("select count(distinct c.id) from", "select c.*, e.year, p.slug, p.civil_name p_civil, p.birth_date p_birth, x.external_id titulo from", 1)
    cands = [dict(r) for r in conn.execute(q)]
    if not cands:
        return []
    src = source_by_sq({(c["year"], c["tse_sequencial"]) for c in cands})
    out = []
    for c in cands:
        rows = [x for x in src.get((c["year"], c["tse_sequencial"]), []) if x["NR_TITULO_ELEITORAL_CANDIDATO"] == c["titulo"]]
        rows = [x for x in rows if (x.get("NR_TURNO") or "1") == "1"] or rows
        c["src"] = rows[0] if len({x["SG_UE"] for x in rows}) == 1 and rows else None
        out.append(c)
    return out


def report_041(conn: psycopg.Connection, items: list[dict[str, Any]]) -> None:
    log.info("BUG-041: %d candidatura(s) com a linha da fonte de outra pessoa", len(items))
    for c in items:
        log.info("  %s (%s, %s), título %s: candidatura %s %s '%s' %s", c["slug"], c["p_civil"], c["p_birth"], c["titulo"], c["year"],
                 c["tse_sequencial"], c["ballot_name"], c["result"])
        log.info("     fonte: %s", fmt(c["src"]) if c["src"] else "? (sem linha única)")
        for r in conn.execute("""select year, ue, tse_sequencial, cargo, result, civil_name, birth_date from tse_titulo_candidatura
                                 where titulo = %s order by year""", (c["titulo"],)):
            log.info("     título %s na fonte: %s %s SQ %s %s %s '%s' %s", c["titulo"], r["year"], r["ue"], r["tse_sequencial"], r["cargo"],
                     r["result"], r["civil_name"], r["birth_date"])


def _split_log(conn: psycopg.Connection, titulo: str, owner: str, table: str, action: str, key: str, raw: dict[str, Any], note: str) -> None:
    conn.execute(
        """insert into identity_split_log (bug, source, external_id, person_id, table_name, action, row_key, raw, note)
           values ('BUG-041', 'tse-titulo', %s, %s, %s, %s, %s, %s, %s) on conflict (bug, source, external_id, table_name, row_key) do nothing""",
        (titulo, owner, table, action, key, json.dumps(raw, ensure_ascii=False, default=str), note))


def apply_041(conn: psycopg.Connection, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resolver = PersonResolver(conn)
    muni = muni_index(conn)
    tse = str(conn.execute("select id from sources where slug = 'tse'").fetchone()["id"])
    done = []
    # uma pessoa nova por identidade da fonte (nome civil + nascimento), mesmo com mais de uma candidatura
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for c in items:
        if c["src"] is None:
            log.error("BUG-041: %s %s %s sem linha única na fonte; não mexe", c["slug"], c["year"], c["tse_sequencial"])
            continue
        groups[(str(c["person_id"]), c["src"]["NM_CANDIDATO"], c["src"]["DT_NASCIMENTO"])].append(c)
    for (owner, _nm, _dn), cs in groups.items():
        last = max(cs, key=lambda c: c["year"])["src"]
        titulo = cs[0]["titulo"]
        display = titlecase_pt(last["NM_URNA_CANDIDATO"]) or titlecase_pt(last["NM_CANDIDATO"])
        buf = (nz(last.get("SG_UF_NASCIMENTO")) or "").upper() or None
        slug = resolver.alloc_slug(display, (last["SG_UF"] or "").lower() or None, CARGO.get(last["CD_CARGO"], "").replace("_", "-") or None)
        row = conn.execute(
            """insert into people (slug, display_name, civil_name, gender, birth_date, birthplace_place_id, education)
               values (%s, %s, %s, %s, %s, %s, %s) returning *""",
            (slug, display, titlecase_pt(last["NM_CANDIDATO"]), GENDER.get((last.get("CD_GENERO") or "").strip()), parse_date(last["DT_NASCIMENTO"]),
             muni(buf, last.get("NM_MUNICIPIO_NASCIMENTO")) if buf else None,
             (lambda e: e[0].upper() + e[1:].lower() if e else None)(nz(last.get("DS_GRAU_INSTRUCAO")) or "")),
        ).fetchone()
        q = str(row["id"])
        _split_log(conn, titulo, owner, "people", "criado", q, dict(row),
                   f"pessoa criada a partir da linha da fonte, sem o título {titulo} (que o TSE repetiu; é de {cs[0]['slug']}) (D240)")
        out = dict(owner=cs[0]["slug"], new_slug=slug, moved=0, mandates=0, assets=0, keys=0, finance=0)
        for c in cs:
            cid = str(c["id"])
            raw = {k: v for k, v in c.items() if k not in ("src",)}
            _split_log(conn, titulo, owner, "candidacies", "movido", cid, raw, f"-> {slug}; fonte: {fmt(c['src'])}")
            conn.execute("update candidacies set person_id = %s, updated_at = now() where id = %s", (q, cid))
            out["moved"] += 1
            for m in conn.execute("select * from mandates where candidacy_id = %s and person_id = %s", (cid, owner)).fetchall():
                _split_log(conn, titulo, owner, "mandates", "movido", str(m["id"]), dict(m), f"-> {slug}")
                conn.execute("update mandates set person_id = %s, updated_at = now() where id = %s", (q, m["id"]))
                out["mandates"] += 1
            for a in conn.execute("select * from asset_declarations where candidacy_id = %s and person_id = %s", (cid, owner)).fetchall():
                _split_log(conn, titulo, owner, "asset_declarations", "movido", str(a["id"]), dict(a), f"-> {slug}")
                conn.execute("update asset_declarations set person_id = %s where id = %s", (q, a["id"]))
                out["assets"] += 1
            out["finance"] += conn.execute("select count(*) n from campaign_finance_entries where candidacy_id = %s", (cid,)).fetchone()["n"]
            key = tse_key(c["year"], c["tse_sequencial"], c["src"]["SG_UE"])
            for x in conn.execute("select * from person_external_ids where source_id = %s and external_id = %s and person_id = %s", (tse, key, owner)).fetchall():
                _split_log(conn, titulo, owner, "person_external_ids", "movido", f"tse:{key}", dict(x), f"-> {slug}")
                conn.execute("update person_external_ids set person_id = %s, match_method = 'exact_id', match_confidence = 1.0 where id = %s", (q, x["id"]))
                out["keys"] += 1
        conn.commit()
        log.info("BUG-041 aplicado: %s", out)
        done.append(out)
    return done


# ---------- BUG-043 ----------

def plan_043(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Disputas da fonte com 2+ registros da mesma pessoa (título, número), um deles no banco, e o banco com o de posto menor."""
    db: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for r in conn.execute("""select c.id, c.person_id, c.tse_sequencial, c.result, e.year, e.kind, p.slug, pl.uf, pl.name place_name
                             from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
                             join contests ct on ct.id = c.contest_id join places pl on pl.id = ct.place_id"""):
        db[(r["year"], r["tse_sequencial"])].append(dict(r))
    out = []
    stats = Counter()
    for y in YEARS:
        groups: dict[tuple, dict[str, dict[str, Any]]] = defaultdict(dict)
        for x in iter_source(y):
            t, k = nz(x["NR_TITULO_ELEITORAL_CANDIDATO"]), _kind(x)
            if t and k:
                groups[(y, k, x["SG_UE"], x["CD_CARGO"], x["NR_CANDIDATO"], t)][x["SQ_CANDIDATO"]] = x
        for key, sqs in groups.items():
            if len(sqs) < 2:
                continue
            # o registro no banco: mesmo ano e SQ, mesmo tipo de eleição e mesma UF (2012 repete SQ entre ordinária e suplementar)
            ind = {}
            for sq, x in sqs.items():
                for c in db.get((y, sq), []):
                    if (c["kind"] == "suplementar") == (key[1] == "suplementar") and c["uf"] == x["SG_UF"]:
                        ind[sq] = c
            if not ind:
                continue
            stats["disputas"] += 1
            best = max(sqs, key=lambda s: registration_rank(row_result(sqs[s])))
            if len(ind) > 1:
                stats["os 2 no banco"] += 1
                continue
            sq, c = next(iter(ind.items()))
            if registration_rank(row_result(sqs[sq])) >= registration_rank(row_result(sqs[best])):
                stats["com o de maior posto"] += 1
                continue
            stats["com o inferior"] += 1
            out.append(dict(year=y, key=key, db=c, db_row=sqs[sq], best=sqs[best], rows=list(sqs.values())))
    log.info("BUG-043: %s", dict(stats))
    for it in out:
        log.info("  %s %s: banco %s (%s) x fonte %s", it["db"]["slug"], it["year"], fmt(it["db_row"]), it["db"]["result"], fmt(it["best"]))
    return out


def reload_rows(conn: psycopg.Connection, wanted: dict[int, set[tuple[str, str]]], bug: str) -> None:
    """Recarga das linhas (SG_UE, SQ) pedidas pelo loader do TSE, ano a ano (uma transação por ano)."""
    for y, only in sorted(wanted.items()):
        if not only:
            continue
        # Run sem ingest_runs nem dataset_stamps: é reparo de linhas, não atualização da fonte (a página de fontes lê os stamps)
        r = Run(conn, f"identity.fix041.{bug}.{y}", "tse")
        try:
            _load_year(conn, r, y, None, None, None, False, cand_paths=_source_paths(y), bens_paths=bens_paths(y), only=only, bug=bug)
        except Exception:
            conn.rollback()
            raise
        conn.commit()
        log.info("%s %d: %d linha(s) pedida(s), %d upserts, %d rejeitada(s)", bug, y, len(only), r.rows_upserted, r.rows_rejected)
        for note in r.notes:
            log.info("   nota: %s", note)


# ---------- BUG-042 ----------

def scan_042(conn: psycopg.Connection) -> dict[str, Any]:
    """Resolve novo, sem gravar, sobre a fonte inteira: linhas que casam por reemissão (D241), que vão para a fila pela
    reemissão sem prova, e linhas de título repetido (D240)."""
    pr = PersonResolver(conn)
    muni_lookup = muni_index(conn)
    by_uf = {row["uf"]: str(row["id"]) for row in conn.execute("select uf, id from places where kind = 'uf'")}
    tit_src = pr.sources["tse-titulo"]
    known = {ext for (s, ext) in pr.external if s == tit_src}
    res: dict[str, list[dict[str, Any]]] = defaultdict(list)
    n = 0
    for y in YEARS:
        for x in iter_source(y):
            k, office = _kind(x), CARGO.get((x["CD_CARGO"] or "").strip())
            sq = nz(x["SQ_CANDIDATO"])
            if not (k and office and sq):
                continue
            n += 1
            t = nz(x["NR_TITULO_ELEITORAL_CANDIDATO"])
            key = tse_key(y, sq, x["SG_UE"])
            if pr.by_external("tse", key):
                continue
            if office in ("presidente", "vice_presidente"):
                place = None
            elif office in ("governador", "vice_governador", "senador", "deputado_federal", "deputado_estadual", "deputado_distrital"):
                place = by_uf.get((x["SG_UE"] or "").strip().upper())
            else:
                place = muni_lookup((x["SG_UF"] or "").strip().upper(), x["NM_UE"])
            civil, birth = titlecase_pt(x["NM_CANDIDATO"]), parse_date(x["DT_NASCIMENTO"])
            q0 = len(pr._pending_queue)
            m = pr.resolve(source="tse", external_id=key, civil_name=civil, birth_date=birth,
                           birth_uf=(nz(x["SG_UF_NASCIMENTO"]) or "").upper() or None, titulo=t, uf=x["SG_UF"], place_id=place, year=y)
            result = row_result(x)
            item = dict(year=y, ue=(x["SG_UE"] or "").strip(), sq=sq, elected=result in ELECTED, kind=k, row=x, person=m.person_id, why=m.why,
                        cand=pr._pending_queue[-1][3] if len(pr._pending_queue) > q0 else None)
            if m.title_foreign:
                res["titulo_repetido"].append(item)
            if m.why:
                res["reemissao"].append(item)
            elif m.method == "queued" and t not in known:
                res["fila"].append(item)
    pr._pending_ext, pr._pending_queue = [], []  # simulação: nada é gravado
    log.info("BUG-042 (varredura de %d linhas): reemissão %d (%d ELEITO), fila %d (%d ELEITO), título repetido %d", n,
             len(res["reemissao"]), sum(i["elected"] for i in res["reemissao"]), len(res["fila"]), sum(i["elected"] for i in res["fila"]),
             len(res["titulo_repetido"]))
    slug = {str(r["id"]): r["slug"] for r in conn.execute("select id, slug from people")}
    for tag in ("reemissao", "fila", "titulo_repetido"):
        for i in res[tag]:
            if tag != "fila" or i["elected"]:
                log.info("  %s %s -> %s: %s", tag, fmt(i["row"]), slug.get(i["person"] or i["cand"] or "", "-"), i["why"] or "")
    return res


def run_fix(conn: psycopg.Connection, *, apply: bool) -> None:
    if apply:
        backfill_titles(conn)
    items = plan_041(conn)
    report_041(conn, items)
    if apply and items:
        apply_041(conn, items)
    o43 = plan_043(conn)
    if apply and o43:
        wanted: dict[int, set[tuple[str, str]]] = defaultdict(set)
        for it in o43:
            for x in it["rows"]:
                wanted[it["year"]].add(((x["SG_UE"] or "").strip(), (x["SQ_CANDIDATO"] or "").strip()))
        reload_rows(conn, wanted, "BUG-043")
    s42 = scan_042(conn)
    if apply:
        wanted = defaultdict(set)
        for i in s42["reemissao"] + [i for i in s42["fila"] if i["elected"]]:
            if i["kind"] == "ordinaria":
                wanted[i["year"]].add((i["ue"], i["sq"]))
        reload_rows(conn, wanted, "BUG-042")
        backfill_titles(conn)
    if not apply:
        log.info("dry-run: nada gravado. Use --apply.")
