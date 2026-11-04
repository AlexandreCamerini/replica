"""civico-etl identity.fix038 [--apply]: separa pessoas do TSE fundidas por nome civil + nascimento sem lugar (BUG-038, D235-D237).

Causa: o ramo `name_birth` do identity.resolve casava nome civil (ou de exibição) + nascimento únicos no diretório inteiro, sem
UF nem município, e depois anexava o título de eleitor da linha (`tse-titulo`). Dois "José Antonio da Silva, 20/05/1963", um
de São Luís/MA e outro de Rio Grande/RS, viraram uma pessoa, e /p/repolhinho passou a mostrar as candidaturas do outro.

Casos (lista curada, cada um conferido no consulta_cand de todos os anos; ver `report`):
  - 7 provados: os dois títulos concorrem na mesma eleição ordinária em municípios diferentes;
  - 4 prováveis: títulos de UF diferentes e nomes de urna diferentes, sem a prova da mesma eleição; e ze-galinha, cuja
    candidatura de 2016 ("Piqueno") traz no CSV outro nome civil e outro nascimento, com o título dele repetido pelo TSE.

Separação (P = dono do crachá, que fica com o slug; T = título que não é dele):
  - candidatura de P cuja linha da fonte tem o título T (ou outro nome civil e outro nascimento): muda para a pessoa Q, com
    mandatos e bens (as despesas de campanha, os votos por lugar e o plano de governo seguem a candidatura pelo id);
  - Q é criada a partir da linha da fonte (D227: separar é mover, nunca apagar) e recebe T e as chaves `tse` das candidaturas;
  - sem candidatura a mover, não há fato a devolver: o vínculo T sai de P e nenhuma pessoa é criada (como o 74131 no D227).
Cada linha movida, criada ou removida vai inteira para identity_split_log (ações 'movido', 'criado', 'removido'; migração 0065).
Também preenche tse_titulo_candidatura (0065) com as linhas da fonte de todos os títulos do diretório, para os checks.
Sem --apply é dry-run. Idempotente. Um caso por transação. Depois: civico-etl derive.stats e civico-etl check.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

import duckdb
import psycopg

from ..identity import PersonResolver
from ..util import chunked, fold, nz, parse_date, titlecase_pt
from .tse_bug032 import _source_paths
from .tse_candidatos import CARGO, GENDER, muni_index, title_rows, tse_key, write_title_rows

log = logging.getLogger("etl.identity.bug038")
BUG = "BUG-038"
# eleições de 2012 até a mais recente (a deste ano entra quando o TSE publicar; 404 é tratado por quem lê)
YEARS = tuple(range(2012, date.today().year + 1, 2))
SRC_COLS = ["ANO_ELEICAO", "NM_TIPO_ELEICAO", "NR_TURNO", "SG_UF", "SG_UE", "NM_UE", "CD_CARGO", "SQ_CANDIDATO", "NR_CANDIDATO",
            "NM_CANDIDATO", "NM_URNA_CANDIDATO", "DT_NASCIMENTO", "NR_TITULO_ELEITORAL_CANDIDATO", "CD_GENERO", "DS_GRAU_INSTRUCAO",
            "SG_UF_NASCIMENTO", "NM_MUNICIPIO_NASCIMENTO", "DS_SIT_TOT_TURNO", "DS_SITUACAO_CANDIDATURA"]


@dataclass(frozen=True)
class Case:
    slug: str      # dono do crachá (fica com o slug)
    titulo: str | None  # título que não é dele (None: só a candidatura de outro nome/nascimento, ze-galinha)
    grade: str     # provado | provavel


CASES = [
    Case("repolhinho", "000597921198", "provado"),
    Case("joaozao", "020994100698", "provado"),
    Case("malufao", "040578540523", "provado"),
    Case("claudia-do-severino", "072163270558", "provado"),
    Case("cida-da-saude-rn", "198317130116", "provado"),
    Case("luciano-dias", "133460340272", "provado"),
    Case("paulinho-do-rodolfo", "118317660213", "provado"),
    Case("gordo", "124118810205", "provavel"),
    Case("joao-preto", "078272520310", "provavel"),
    Case("gato-da-corrida", "003788960124", "provavel"),
    Case("ze-galinha", None, "provavel"),
]


# ---------- fonte ----------

def source_by_titles(titles: set[str]) -> list[dict[str, Any]]:
    """Todas as linhas do consulta_cand 2012-2026 com um dos títulos (todas as situações, os dois turnos)."""
    con = duckdb.connect()
    con.execute("create table want (t varchar)")
    con.executemany("insert into want values (?)", [(t,) for t in titles])
    out = []
    for y in YEARS:
        try:
            paths = _source_paths(y)
        except FileNotFoundError:  # 404: o TSE ainda não publicou a eleição deste ano
            if y < date.today().year:
                raise
            log.info("consulta_cand_%s ainda não publicado; pulando", y)
            continue
        for p in paths:
            rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
            con.register("t", rel)
            cols = [c for c in SRC_COLS if c in rel.columns]
            q = f"select {', '.join(cols)} from t where NR_TITULO_ELEITORAL_CANDIDATO in (select t from want)"
            for r in con.execute(q).fetchall():
                x = dict(zip(cols, r))
                out.append(x)
            con.unregister("t")
    return out


def source_by_sq(wanted: set[tuple[int, str]]) -> dict[tuple[int, str], list[dict[str, Any]]]:
    """(ano, SQ) -> linhas do consulta_cand (2012 repete o SQ entre municípios; quem chama escolhe pela UE)."""
    con = duckdb.connect()
    out: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for y in sorted({y for y, _ in wanted}):
        sqs = [sq for yy, sq in wanted if yy == y]
        for p in _source_paths(y):
            rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
            con.register("t", rel)
            cols = [c for c in SRC_COLS if c in rel.columns]
            q = f"select {', '.join(cols)} from t where SQ_CANDIDATO in ({', '.join('?' for _ in sqs)})"
            for r in con.execute(q, sqs).fetchall():
                x = dict(zip(cols, r))
                out[(y, x["SQ_CANDIDATO"])].append(x)
            con.unregister("t")
    return out


def fmt(x: dict[str, Any]) -> str:
    return (f"{x['ANO_ELEICAO']} {x.get('NM_TIPO_ELEICAO', '')[:5]} {x['SG_UF']}/{x['NM_UE']} {CARGO.get(x['CD_CARGO'], x['CD_CARGO'])} "
            f"'{x['NM_URNA_CANDIDATO']}' {x['NM_CANDIDATO']} {x['DT_NASCIMENTO']} título {x['NR_TITULO_ELEITORAL_CANDIDATO']} "
            f"{x['DS_SIT_TOT_TURNO']} (SQ {x['SQ_CANDIDATO']})")


def same_election_elsewhere(rows: list[dict[str, Any]], t1: str, t2: str) -> list[str]:
    """Eleições ordinárias em que os dois títulos concorrem em UEs diferentes: prova de duas pessoas."""
    by: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for x in rows:
        if "ORDIN" in (x.get("NM_TIPO_ELEICAO") or "").upper():
            by[x["ANO_ELEICAO"]][x["NR_TITULO_ELEITORAL_CANDIDATO"]].add(f"{x['NM_UE']}/{x['SG_UF']}")
    return [f"{y}: {sorted(v[t1])} x {sorted(v[t2])}" for y, v in sorted(by.items()) if v.get(t1) and v.get(t2) and not (v[t1] & v[t2])]


# ---------- banco ----------

def person(conn: psycopg.Connection, slug: str) -> dict[str, Any] | None:
    return conn.execute("select * from people where slug = %s", (slug,)).fetchone()


def person_titles(conn: psycopg.Connection, pid: str) -> list[str]:
    return [r["external_id"] for r in conn.execute(
        """select x.external_id from person_external_ids x join sources s on s.id = x.source_id
           where s.slug = 'tse-titulo' and x.person_id = %s order by 1""", (pid,))]


def candidacies(conn: psycopg.Connection, pid: str) -> list[dict[str, Any]]:
    return conn.execute(
        """select c.*, e.year, e.kind, o.slug office, pl.name place_name, pl.uf place_uf, pl.ibge_code
           from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
           join offices o on o.id = ct.office_id join places pl on pl.id = ct.place_id where c.person_id = %s order by e.year""", (pid,)).fetchall()


def row_of(c: dict[str, Any], src: dict[tuple[int, str], list[dict[str, Any]]]) -> dict[str, Any] | None:
    """A linha da fonte da candidatura: (ano, SQ) e, se repetido (2012), a do município da disputa."""
    rows = src.get((c["year"], c["tse_sequencial"]), [])
    rows = [x for x in rows if (x.get("NR_TURNO") or "1") == "1"] or rows
    if len(rows) > 1:
        rows = [x for x in rows if fold(x["NM_UE"]) == fold(c["place_name"])] or rows
    return rows[0] if len({(x["SG_UE"], x["NR_TITULO_ELEITORAL_CANDIDATO"]) for x in rows}) == 1 else None


def is_other(x: dict[str, Any], p: dict[str, Any], case: Case) -> bool:
    if case.titulo:
        return x["NR_TITULO_ELEITORAL_CANDIDATO"] == case.titulo
    # sem título a separar: a linha é de outra pessoa se nome civil e nascimento diferem os dois (ze-galinha 2016)
    return fold(x["NM_CANDIDATO"]) != fold(p["civil_name"]) and parse_date(x["DT_NASCIMENTO"]) != p["birth_date"]


def split_log(conn: psycopg.Connection, case: Case, owner: str, table: str, action: str, key: str, raw: dict[str, Any], note: str) -> None:
    conn.execute(
        """insert into identity_split_log (bug, source, external_id, person_id, table_name, action, row_key, raw, note)
           values (%s, 'tse-titulo', %s, %s, %s, %s, %s, %s, %s) on conflict (bug, source, external_id, table_name, row_key) do nothing""",
        (BUG, case.titulo or f"{case.slug}:sem-titulo", owner, table, action, key, json.dumps(raw, ensure_ascii=False, default=str), note))


def plan(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Por caso: dono, candidaturas a mover (com a linha da fonte), linhas da fonte dos títulos e a prova."""
    items = []
    for case in CASES:
        p = person(conn, case.slug)
        if not p:
            log.error("%s: pessoa não existe", case.slug)
            continue
        cs = candidacies(conn, p["id"])
        items.append(dict(case=case, p=p, titles=person_titles(conn, p["id"]), cands=cs))
    src = source_by_sq({(c["year"], c["tse_sequencial"]) for it in items for c in it["cands"]})
    titles = {t for it in items for t in it["titles"]} | {it["case"].titulo for it in items if it["case"].titulo}
    by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for x in source_by_titles(titles):
        by_title[x["NR_TITULO_ELEITORAL_CANDIDATO"]].append(x)
    for it in items:
        case, p = it["case"], it["p"]
        it["move"] = []
        for c in it["cands"]:
            x = row_of(c, src)
            c["src"] = x
            if x is None:
                log.warning("%s: candidatura %s %s sem linha única na fonte; não mexe", case.slug, c["year"], c["tse_sequencial"])
            elif is_other(x, p, case):
                it["move"].append(c)
        it["src_rows"] = {t: sorted(by_title.get(t, []), key=lambda x: (x["ANO_ELEICAO"], x["NR_TURNO"])) for t in sorted(set(it["titles"]) | {case.titulo} - {None})}
        right = [t for t in it["titles"] if t != case.titulo]
        it["proof"] = [s for r in right for s in same_election_elsewhere(by_title.get(r, []) + by_title.get(case.titulo or "", []), r, case.titulo or "")] if case.titulo else []
        it["wrong_title_linked"] = bool(case.titulo and case.titulo in it["titles"])
    return items


def report(items: list[dict[str, Any]]) -> None:
    for it in items:
        case, p = it["case"], it["p"]
        log.info("== %s (%s, %s), %s; títulos no banco: %s; título a separar: %s", case.slug, p["civil_name"], p["birth_date"], case.grade,
                 it["titles"], case.titulo)
        for t, rows in it["src_rows"].items():
            for x in rows:
                if (x.get("NR_TURNO") or "1") == "1":
                    log.info("   fonte  %s", fmt(x))
        for s in it["proof"]:
            log.info("   prova (mesma eleição, municípios diferentes): %s", s)
        for c in it["cands"]:
            tag = "MOVER" if c in it["move"] else "fica "
            log.info("   %s %s %s %s/%s '%s' %s -> fonte: %s", tag, c["year"], c["office"], c["place_name"], c["place_uf"], c["ballot_name"],
                     c["result"], fmt(c["src"]) if c["src"] else "?")


def apply_case(conn: psycopg.Connection, resolver: PersonResolver, muni, it: dict[str, Any]) -> dict[str, Any]:
    case, p = it["case"], it["p"]
    owner = str(p["id"])
    out = dict(slug=case.slug, moved=0, mandates=0, assets=0, finance=0, keys=0, new_slug=None, title="mantido")
    if not it["move"] and not it["wrong_title_linked"]:
        return out  # já separado (idempotente)
    q = None
    if it["move"]:
        # a pessoa certa: a da linha mais recente que sai do crachá; se já existe pelo título (rodada anterior), reaproveita
        last = max(it["move"], key=lambda c: c["year"])["src"]
        q = resolver.by_external("tse-titulo", case.titulo) if case.titulo and resolver.by_external("tse-titulo", case.titulo) != owner else None
        if not q:
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
            split_log(conn, case, owner, "people", "criado", q, dict(row), f"pessoa criada para os fatos separados de {case.slug} (D236)")
            out["new_slug"] = slug
        else:
            out["new_slug"] = conn.execute("select slug from people where id = %s", (q,)).fetchone()["slug"]
        tse = str(conn.execute("select id from sources where slug = 'tse'").fetchone()["id"])
        for c in it["move"]:
            cid = str(c["id"])
            raw = {k: v for k, v in c.items() if k != "src"}
            split_log(conn, case, owner, "candidacies", "movido", cid, raw, f"-> {out['new_slug']}; fonte: {fmt(c['src'])}")
            conn.execute("update candidacies set person_id = %s, updated_at = now() where id = %s", (q, cid))
            out["moved"] += 1
            for m in conn.execute("select * from mandates where candidacy_id = %s and person_id = %s", (cid, owner)).fetchall():
                split_log(conn, case, owner, "mandates", "movido", str(m["id"]), dict(m), f"-> {out['new_slug']}")
                conn.execute("update mandates set person_id = %s, updated_at = now() where id = %s", (q, m["id"]))
                out["mandates"] += 1
            for a in conn.execute("select * from asset_declarations where candidacy_id = %s and person_id = %s", (cid, owner)).fetchall():
                split_log(conn, case, owner, "asset_declarations", "movido", str(a["id"]), dict(a), f"-> {out['new_slug']}")
                conn.execute("update asset_declarations set person_id = %s where id = %s", (q, a["id"]))
                out["assets"] += 1
            out["finance"] += conn.execute("select count(*) n from campaign_finance_entries where candidacy_id = %s", (cid,)).fetchone()["n"]
            key = tse_key(c["year"], c["tse_sequencial"], c["src"]["SG_UE"])
            for x in conn.execute("select * from person_external_ids where source_id = %s and external_id = %s and person_id = %s", (tse, key, owner)).fetchall():
                split_log(conn, case, owner, "person_external_ids", "movido", f"tse:{key}", dict(x), f"-> {out['new_slug']}")
                conn.execute("update person_external_ids set person_id = %s, match_method = 'exact_id', match_confidence = 1.0 where id = %s", (q, x["id"]))
                out["keys"] += 1
    if case.titulo and it["wrong_title_linked"]:
        x = conn.execute(
            """select x.* from person_external_ids x join sources s on s.id = x.source_id
               where s.slug = 'tse-titulo' and x.external_id = %s and x.person_id = %s""", (case.titulo, owner)).fetchone()
        if q:
            split_log(conn, case, owner, "person_external_ids", "movido", f"tse-titulo:{case.titulo}", dict(x), f"-> {out['new_slug']}")
            conn.execute("update person_external_ids set person_id = %s, match_method = 'exact_id', match_confidence = 1.0 where id = %s", (q, x["id"]))
            out["title"] = f"movido para {out['new_slug']}"
        else:
            split_log(conn, case, owner, "person_external_ids", "removido", f"tse-titulo:{case.titulo}", dict(x),
                      "título de outra pessoa sem fato no banco: o vínculo sai e nenhuma pessoa é criada (como o 74131, D227)")
            conn.execute("delete from person_external_ids where id = %s", (x["id"],))
            out["title"] = "removido (sem fato a mover)"
    return out


def backfill_titles(conn: psycopg.Connection) -> int:
    """tse_titulo_candidatura: as linhas da fonte de todos os títulos do diretório (migração 0065)."""
    titles = {r["external_id"] for r in conn.execute(
        "select x.external_id from person_external_ids x join sources s on s.id = x.source_id where s.slug = 'tse-titulo'")}
    rows = source_by_titles(titles)
    n = 0
    for chunk in chunked(title_rows(rows, titles), 20000):
        n += write_title_rows(conn, chunk)
        conn.commit()
    log.info("tse_titulo_candidatura: %d linhas de %d títulos", n, len(titles))
    return n


def run_fix(conn: psycopg.Connection, *, apply: bool) -> list[dict[str, Any]]:
    items = plan(conn)
    report(items)
    if not apply:
        log.info("dry-run: nada gravado. Use --apply.")
        return []
    resolver = PersonResolver(conn)
    muni = muni_index(conn)
    done = []
    for it in items:
        r = apply_case(conn, resolver, muni, it)
        conn.commit()
        log.info("aplicado %s", r)
        done.append(r)
    backfill_titles(conn)
    return done
