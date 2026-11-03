"""civico-etl tse.fix032 [--year Y ...] [--apply]: desfaz os casamentos de identidade feitos pelo SQ_CANDIDATO sem o ano (BUG-032).

Causa: tse_candidatos chamava people.resolve(source="tse", external_id=SQ). O SQ_CANDIDATO só é único dentro da eleição, e o
TSE reaproveita os números entre 2012, 2014 e 2016. A 1ª carga (2016) gravava `tse:SQ` na pessoa certa; a de 2012 achava o
mesmo `tse:SQ` e ligava a candidatura de outra pessoa por `exact_id` (ex.: "Dinelci", Fonte Boa 2012, no Roberto Cidade).

Reparo (D210-D213). Cada candidatura do banco é conferida contra a linha da fonte do PRÓPRIO ano (consulta_cand_{ano}, chave
(ano, SQ)). Ela é da pessoa a que está ligada se:
  - o título de eleitor da linha está entre os títulos da pessoa (fonte 'tse-titulo'); ou
  - nome civil + data de nascimento da linha = os da pessoa (o título muda em transferência: 31 pessoas têm dois).
CPF não é usado: o banco não guarda CPF (D131) e o título resolve sem ele (D210).
Se não for dela, procura a pessoa certa: dono do título; senão nome civil + nascimento com um único candidato.
  - achou -> 'religado' (candidatura, mandatos dela e patrimônio declarado passam para a pessoa certa);
  - nenhum -> 'removido/sem_pessoa' (D34: eleição antiga de quem não está no diretório não cria pessoa);
  - mais de um -> 'removido/ambiguo' (ambíguo não casa);
  - a pessoa certa já tem outra candidatura na eleição -> 'removido/conflito' (mesma regra do loader).
A linha removida vai inteira para identity_repair_log.raw (candidatura + mandatos), além do backup pg_dump.
Por fim, troca a chave `tse:SQ` por `tse:ANO:SQ` em person_external_ids (a que o loader passa a usar) e registra como
'confirmado' as candidaturas de quem tem o mesmo SQ em anos diferentes com prova da fonte (é o que o check aceita).
Sem --apply é dry-run. Escrita em lotes com commit (o dev server lê o banco). Idempotente.
"""

from __future__ import annotations

import json
import logging
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import duckdb
import psycopg

from ..http import CACHE_DIR
from ..util import chunked, fold, parse_date

log = logging.getLogger("etl.tse.bug032")
BUG = "BUG-032"
BATCH = 1000
SRC_COLS = ["SQ_CANDIDATO", "NR_TITULO_ELEITORAL_CANDIDATO", "NM_CANDIDATO", "NM_URNA_CANDIDATO", "DT_NASCIMENTO", "SG_UF", "NM_UE"]


def norm_titulo(s: str | None) -> str | None:
    """Só dígitos, sem zero à esquerda. '#NULO#', '-4' (não divulgável), vazio -> None."""
    if not s:
        return None
    d = re.sub(r"\D", "", s).lstrip("0")
    return d if len(d) >= 6 and not s.strip().startswith("-") else None


@dataclass(frozen=True)
class Src:
    titulo: str | None
    nome: str  # fold
    nasc: date | None
    urna: str
    lugar: str


@dataclass
class Pessoa:
    titulos: set[str]
    nomes: set[str]  # fold do nome civil e do nome de exibição
    nasc: date | None


def same_person(src: Src, p: Pessoa) -> str | None:
    """'titulo' ou 'nome_nasc' quando a linha da fonte é desta pessoa; None quando não há prova."""
    if src.titulo and src.titulo in p.titulos:
        return "titulo"
    if src.nome and src.nasc and p.nasc == src.nasc and src.nome in p.nomes:
        return "nome_nasc"
    return None


def find_owner(src: Src, by_titulo: dict[str, set[str]], by_name_birth: dict[tuple[str, date], set[str]], exclude: str) -> tuple[str | None, str]:
    """Pessoa certa para a linha da fonte: (person_id, 'titulo'|'nome_nasc') ou (None, 'sem_pessoa'|'ambiguo')."""
    if src.titulo:
        owners = by_titulo.get(src.titulo, set()) - {exclude}
        if len(owners) == 1:
            return next(iter(owners)), "titulo"
        if len(owners) > 1:
            return None, "ambiguo"
    if src.nome and src.nasc:
        cands = by_name_birth.get((src.nome, src.nasc), set()) - {exclude}
        if len(cands) == 1:
            return next(iter(cands)), "nome_nasc"
        if len(cands) > 1:
            return None, "ambiguo"
    return None, "sem_pessoa"


def _source_paths(year: int) -> list[Path]:
    d = CACHE_DIR / "tse" / f"consulta_cand_{year}"
    brasil = sorted(d.glob("*_BRASIL.utf8.csv"))
    if brasil:
        return brasil
    paths = sorted(d.glob("*.utf8.csv"))
    if paths:
        return paths
    from ..http import fetch
    from .tse_candidatos import BASE, _extract

    return _extract(fetch(f"{BASE}/consulta_cand/consulta_cand_{year}.zip").path, year, None, "consulta_cand")


def load_source(year: int, wanted: set[str]) -> dict[str, Src]:
    con = duckdb.connect()
    out: dict[str, Src] = {}
    for p in _source_paths(year):
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        have = set(rel.columns)
        con.register("t", rel)
        sel = ", ".join(c if c in have else f"NULL as {c}" for c in SRC_COLS)
        for sq, tit, nome, urna, nasc, uf, ue in con.execute(f"select distinct {sel} from t").fetchall():
            sq = (sq or "").strip()
            if sq in wanted and sq not in out:
                out[sq] = Src(norm_titulo(tit), fold(nome), parse_date(nasc), urna or "", f"{ue}/{uf}")
        con.unregister("t")
    return out


def _load_people(conn: psycopg.Connection) -> tuple[dict[str, Pessoa], dict[str, set[str]], dict[tuple[str, date], set[str]]]:
    people: dict[str, Pessoa] = {}
    by_name_birth: dict[tuple[str, date], set[str]] = defaultdict(set)
    for r in conn.execute("select id, civil_name, display_name, birth_date from people"):
        pid = str(r["id"])
        nomes = {n for n in (fold(r["civil_name"]), fold(r["display_name"])) if n}
        people[pid] = Pessoa(set(), nomes, r["birth_date"])
        if r["birth_date"]:
            for n in nomes:
                by_name_birth[(n, r["birth_date"])].add(pid)
    by_titulo: dict[str, set[str]] = defaultdict(set)
    for r in conn.execute("select e.person_id, e.external_id from person_external_ids e join sources s on s.id = e.source_id where s.slug = 'tse-titulo'"):
        t = norm_titulo(r["external_id"])
        if t:
            people[str(r["person_id"])].titulos.add(t)
            by_titulo[t].add(str(r["person_id"]))
    return people, by_titulo, by_name_birth


def classify_all(conn: psycopg.Connection, years: list[int] | None) -> tuple[list[dict[str, Any]], Counter]:
    """Uma entrada por candidatura do banco: verdict ok | religar | remover | sem_fonte."""
    people, by_titulo, by_name_birth = _load_people(conn)
    cands = conn.execute(
        """select c.id, e.year, c.tse_sequencial sq, c.person_id, c.election_id, c.contest_id, c.ballot_name, ct.place_id::text, e.kind
           from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
           where %s::int[] is null or e.year = any(%s::int[])""", (years, years)).fetchall()
    by_year: dict[int, set[str]] = defaultdict(set)
    for c in cands:
        by_year[c["year"]].add(c["sq"])
    src: dict[tuple[int, str], Src] = {}
    for y, sqs in sorted(by_year.items()):
        got = load_source(y, sqs)
        log.info("fonte %d: %d de %d SQ do banco achados no consulta_cand", y, len(got), len(sqs))
        src.update({(y, sq): s for sq, s in got.items()})

    # BUG-035: em 2012 o SQ se repete entre a eleição ordinária e as suplementares do arquivo; a linha é a do município da disputa
    from .tse_bug035 import load_rows, pick_row
    from .tse_candidatos import SQ_COM_UE

    rows_ue = {y: load_rows(conn, y) for y in by_year if y in SQ_COM_UE}
    out: list[dict[str, Any]] = []
    stats: Counter = Counter()
    for c in cands:
        pid = str(c["person_id"])
        if c["year"] in rows_ue:
            r = pick_row(rows_ue[c["year"]].get(c["sq"], []), c["place_id"], c["kind"])
            s = r.src if r else None
        else:
            s = src.get((c["year"], c["sq"]))
        item = dict(id=str(c["id"]), year=c["year"], sq=c["sq"], person_id=pid, election_id=str(c["election_id"]),
                    contest_id=str(c["contest_id"]), ballot_name=c["ballot_name"], src=s, target=None, basis=None, reason=None)
        if s is None:
            item["verdict"] = "sem_fonte"
        elif basis := same_person(s, people[pid]):
            item.update(verdict="ok", basis=basis)
        else:
            owner, how = find_owner(s, by_titulo, by_name_birth, pid)
            if owner:
                item.update(verdict="religar", target=owner, basis=how)
            else:
                item.update(verdict="remover", reason=how)
        stats[(c["year"], item["verdict"], item["basis"] or item["reason"])] += 1
        out.append(item)

    # a pessoa certa não pode ficar com duas candidaturas na mesma eleição (nem na mesma disputa): sai a que chega
    final: dict[tuple[str, str], str] = {}
    for it in out:
        if it["verdict"] in ("ok", "sem_fonte"):
            final[(it["person_id"], it["election_id"])] = it["id"]
    for it in out:
        if it["verdict"] == "religar":
            k = (it["target"], it["election_id"])
            if k in final:
                stats[(it["year"], "religar", it["basis"])] -= 1
                it.update(verdict="remover", reason="conflito")
                stats[(it["year"], "remover", "conflito")] += 1
            else:
                final[k] = it["id"]
    return out, stats


def _mandates(conn: psycopg.Connection, cand_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in chunked(cand_ids, 5000):
        for m in conn.execute("select * from mandates where candidacy_id = any(%s::uuid[])", (chunk,)):
            out[str(m["candidacy_id"])].append(m)
    return out


def _jsonable(row: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(row, default=str))


class _Defer(Exception):
    """A pessoa certa ainda segura uma candidatura/mandato que sai dela mais adiante neste reparo: tenta na próxima passada."""


def _apply_one(cur: psycopg.Cursor, it: dict[str, Any], ms: list[dict[str, Any]], pending: set[str]) -> tuple[str, int, int] | None:
    cid, wrong = it["id"], it["person_id"]
    moved = removed = 0
    if it["verdict"] == "remover":
        raw = cur.execute("select to_jsonb(c) j from candidacies c where id = %s and person_id = %s", (cid, wrong)).fetchone()
        if not raw:
            return None  # já tratada
        for m in ms:
            if m["status_source"] == "tse":
                cur.execute("delete from mandates where id = %s", (m["id"],))
                removed += 1
            else:  # mandato da casa: é da pessoa, só perde o vínculo com a candidatura errada
                cur.execute("update mandates set candidacy_id = null where id = %s", (m["id"],))
        cur.execute("delete from candidacies where id = %s and person_id = %s", (cid, wrong))
        cur.execute(
            """insert into identity_repair_log (bug, candidacy_id, year, tse_sequencial, action, reason, from_person_id,
                                                mandates_removed, raw)
               values (%s, %s, %s, %s, 'removido', %s, %s, %s, %s) on conflict (bug, candidacy_id) do nothing""",
            (BUG, cid, it["year"], it["sq"], it["reason"], wrong, removed,
             json.dumps({"candidacy": raw["j"], "mandates": [_jsonable(m) for m in ms],
                         "fonte": {"urna": it["src"].urna, "lugar": it["src"].lugar} if it["src"] else None}, ensure_ascii=False)))
        return f"removido:{it['reason']}", moved, removed
    target = it["target"]
    busy = cur.execute("select id from candidacies where person_id = %s and election_id = %s", (target, it["election_id"])).fetchone()
    if busy:
        if str(busy["id"]) in pending:
            raise _Defer
        raise RuntimeError(f"(pessoa, eleição) ocupada por candidatura conferida: {target} {it['election_id']}")  # classify_all evita
    n = cur.execute("update candidacies set person_id = %s where id = %s and person_id = %s", (target, cid, wrong)).rowcount
    if not n:
        return None
    cur.execute("update asset_declarations set person_id = %s where candidacy_id = %s and person_id = %s", (target, cid, wrong))
    for m in ms:
        clash = cur.execute(
            """select id, candidacy_id from mandates where person_id = %s and office_id = %s
                 and daterange(started_on, ends_on, '[)') && daterange(%s, %s, '[)')""",
            (target, m["office_id"], m["started_on"], m["ends_on"])).fetchone()
        if clash and clash["candidacy_id"] is not None and str(clash["candidacy_id"]) in pending:
            raise _Defer
        if clash:  # a pessoa certa já tem esse mandato (de outra fonte): fica o dela, ligado à candidatura
            cur.execute("delete from mandates where id = %s", (m["id"],))
            if clash["candidacy_id"] is None:
                cur.execute("update mandates set candidacy_id = %s where id = %s", (cid, clash["id"]))
            removed += 1
        else:
            cur.execute("update mandates set person_id = %s where id = %s", (target, m["id"]))
            moved += 1
    cur.execute(
        """insert into identity_repair_log (bug, candidacy_id, year, tse_sequencial, action, basis, from_person_id, to_person_id,
                                            mandates_moved, mandates_removed, raw)
           values (%s, %s, %s, %s, 'religado', %s, %s, %s, %s, %s, %s) on conflict (bug, candidacy_id) do nothing""",
        (BUG, cid, it["year"], it["sq"], it["basis"], wrong, target, moved, removed,
         json.dumps({"mandates": [_jsonable(m) for m in ms]}, ensure_ascii=False) if removed else None))
    return f"religado:{it['basis']}", moved, removed


def apply_fix(conn: psycopg.Connection, items: list[dict[str, Any]]) -> Counter:
    done: Counter = Counter()
    todo = [it for it in items if it["verdict"] in ("religar", "remover")]
    by_cand = _mandates(conn, [it["id"] for it in todo])
    # remoções antes das religações: libera (pessoa, eleição) e cadeiras. Religação que esbarra em algo que ainda vai sair da
    # pessoa certa fica para a passada seguinte; se uma passada inteira não avança (troca circular), para e relata.
    todo.sort(key=lambda it: it["verdict"] != "remover")
    pending = {it["id"] for it in todo}
    passada = 0
    while todo:
        passada += 1
        deferred: list[dict[str, Any]] = []
        for chunk in chunked(todo, BATCH):
            cur = conn.cursor()
            for it in chunk:
                ms = [m for m in by_cand.get(it["id"], []) if str(m["person_id"]) == it["person_id"]]
                try:
                    with conn.transaction():
                        res = _apply_one(cur, it, ms, pending)
                except _Defer:
                    deferred.append(it)
                    continue
                pending.discard(it["id"])
                if res:
                    kind, moved, removed = res
                    done[kind] += 1
                    done["mandatos_movidos"] += moved
                    done["mandatos_removidos"] += removed
            conn.commit()
            log.info("passada %d, lote gravado: %s", passada, dict(done))
        if len(deferred) == len(todo):
            log.error("%d religações em troca circular, não gravadas: %s", len(deferred), [(d["year"], d["sq"]) for d in deferred][:20])
            done["nao_gravado_circular"] = len(deferred)
            break
        todo = deferred
    return done


def rekey_external_ids(conn: psycopg.Connection, items: list[dict[str, Any]]) -> tuple[int, int]:
    """`tse:SQ` -> `tse:ANO:SQ`, a partir das candidaturas (já reparadas). Vínculo sem candidatura (registro rejeitado) sai:
    sem o ano não dá para saber de que eleição era, e a próxima carga casa de novo pelo título."""
    from .tse_candidatos import SQ_COM_UE

    how = {it["id"]: it["basis"] for it in items if it["verdict"] == "religar"}
    cur = conn.cursor()
    cur.execute("create temp table tmp_basis (candidacy_id uuid, basis text) on commit drop")
    with cur.copy("copy tmp_basis from stdin") as cp:
        for k, v in how.items():
            cp.write_row((k, v))
    ins = cur.execute(
        """insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
           select distinct on (e.year, c.tse_sequencial) c.person_id, s.id, e.year || ':' || c.tse_sequencial,
                  case when b.basis = 'nome_nasc' then 'name_birth' when b.basis = 'titulo' then 'exact_id' else coalesce(o.match_method, 'exact_id') end,
                  case when b.basis = 'nome_nasc' then 0.95 when b.basis = 'titulo' then 1.0 else coalesce(o.match_confidence, 1.0) end
           from candidacies c join elections e on e.id = c.election_id cross join sources s
           left join tmp_basis b on b.candidacy_id = c.id
           left join person_external_ids o on o.source_id = s.id and o.external_id = c.tse_sequencial and o.person_id = c.person_id
           where s.slug = 'tse' and e.year <> all(%s::int[])  -- 2012: chave ANO:UE:SQ, gravada pelo tse.fix035 (BUG-035)
           order by e.year, c.tse_sequencial, e.round
           on conflict (source_id, external_id) do update set person_id = excluded.person_id, match_method = excluded.match_method,
             match_confidence = excluded.match_confidence where person_external_ids.person_id <> excluded.person_id""",
        (sorted(SQ_COM_UE),)).rowcount
    dele = cur.execute(
        """delete from person_external_ids e using sources s
           where s.id = e.source_id and s.slug = 'tse' and e.external_id !~ '^[0-9]{4}:'""").rowcount
    conn.commit()
    return ins, dele


def log_confirmed(conn: psycopg.Connection, items: list[dict[str, Any]]) -> int:
    """Mesma pessoa com o mesmo SQ em anos diferentes, depois do reparo: registra a prova da fonte de cada candidatura."""
    proof = {it["id"]: it["basis"] for it in items if it["verdict"] in ("ok", "religar")}
    rows = conn.execute(
        """select c.id, e.year, c.tse_sequencial, c.person_id from candidacies c join elections e on e.id = c.election_id
           where (c.person_id, c.tse_sequencial) in (
             select c2.person_id, c2.tse_sequencial from candidacies c2 join elections e2 on e2.id = c2.election_id
             group by 1, 2 having count(distinct e2.year) > 1)""").fetchall()
    n = 0
    cur = conn.cursor()
    for r in rows:
        b = proof.get(str(r["id"]))
        if b:
            n += cur.execute(
                """insert into identity_repair_log (bug, candidacy_id, year, tse_sequencial, action, basis, from_person_id, to_person_id)
                   values (%s, %s, %s, %s, 'confirmado', %s, %s, %s) on conflict (bug, candidacy_id) do nothing""",
                (BUG, r["id"], r["year"], r["tse_sequencial"], b, r["person_id"], r["person_id"])).rowcount
    conn.commit()
    return n


def before_numbers(conn: psycopg.Connection) -> dict[str, int]:
    q = """with x as (select c.person_id, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
                      group by 1, 2 having count(distinct e.year) > 1)
           select (select count(distinct person_id) from x) pessoas,
                  (select count(*) from candidacies c join x using (person_id, tse_sequencial)) candidaturas,
                  (select count(*) from mandates m join candidacies c on c.id = m.candidacy_id and c.person_id = m.person_id
                     join x on x.person_id = c.person_id and x.tse_sequencial = c.tse_sequencial) mandatos"""
    return dict(conn.execute(q).fetchone())


def run_fix(conn: psycopg.Connection, years: list[int] | None, apply: bool, sample: int = 10) -> None:
    log.info("antes (mesmo SQ em anos diferentes na mesma pessoa): %s", before_numbers(conn))
    items, stats = classify_all(conn, years)
    for k in sorted(stats, key=str):
        if stats[k]:
            log.info("%s: %d", k, stats[k])
    bad = [it for it in items if it["verdict"] in ("religar", "remover")]
    rnd = random.Random(32)
    for it in rnd.sample(bad, min(sample, len(bad))):
        log.info("amostra: %s %s %s urna=%r lugar=%s -> %s %s", it["year"], it["sq"], it["ballot_name"], it["src"].urna,
                 it["src"].lugar, it["verdict"], it["target"] or it["reason"])
    if not apply:
        log.info("dry-run: %d candidaturas a corrigir (use --apply)", len(bad))
        return
    conn.commit()
    done = apply_fix(conn, items)
    log.info("gravado: %s", dict(done))
    ins, dele = rekey_external_ids(conn, items)
    log.info("person_external_ids tse: %d chaves ANO:SQ gravadas/corrigidas, %d chaves sem ano removidas", ins, dele)
    log.info("confirmados (mesmo SQ em anos diferentes, com prova): %d", log_confirmed(conn, items))
    log.info("depois: %s", before_numbers(conn))
