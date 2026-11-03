"""Sanções de órgãos de controle (W3-B, D130–D132). Sem tela por enquanto: grava em `sanctions` (migração 0033).

  civico-etl sancoes.tcu      TCU, inabilitados para o exercício de cargo em comissão ou função de confiança
                              (Lei 8.443/92 art. 60), API pública ORDS do TCU, sem chave

CGU (CEIS/CNEP): BLOQUEADO. O arquivo de download do Portal da Transparência está atrás de verificação humana
(AWS WAF "Human Verification") desde a primeira requisição; contornar é proibido e a API exige chave. Ver D130.

Casamento (D132): sem CPF no banco (D131), só nome civil completo (>= 3 palavras, sem acento/caixa) + UF da sanção igual à UF
de algum mandato ou candidatura da pessoa, e o nome civil é único no banco inteiro. Qualquer dúvida: sem vínculo, com motivo.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from typing import Any

import psycopg

from .. import db
from .. import http as H
from ..db import SkipUnchanged, run, upsert
from ..util import fold

log = logging.getLogger("etl.sancoes")
TCU_INABILITADOS = "https://contas.tcu.gov.br/ords/condenacao/consulta/inabilitados"
CRAWL_DELAY = 10.0  # robots.txt de contas.tcu.gov.br


def _d(s: str | None) -> date | None:
    """ORDS devolve meia-noite de Brasília em UTC ('2022-07-16T03:00:00Z'): a data é a parte local."""
    return date.fromisoformat(s[:10]) if s else None


def norm_name(s: str | None) -> str:
    return " ".join(fold(s).replace("-", " ").split())


def parse_tcu(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for it in items:
        nome = (it.get("nome") or "").strip()
        if not nome:
            continue
        out.append({
            "source_key": f"{it.get('processo')}|{it.get('deliberacao')}|{norm_name(nome)}",
            "name": nome,
            "uf": ((it.get("uf") or "").strip().upper() or None),
            "municipality": (it.get("municipio") or None),
            "process": it.get("processo"),
            "decision": it.get("deliberacao"),
            "decided_on": _d(it.get("data_acordao")),
            "final_on": _d(it.get("data_transito_julgado")),
            "ends_on": _d(it.get("data_final")),
            # CPF/CNPJ da fonte é descartado aqui de propósito (D131)
        })
    return out


def fetch_tcu() -> list[dict[str, Any]]:
    from .assembleias import allowed

    url, items = f"{TCU_INABILITADOS}?limit=1000", []
    old = H.RATE
    H.RATE = 1 / CRAWL_DELAY
    try:
        while url:
            if not allowed(url):
                raise RuntimeError(f"robots.txt bloqueia {url}")
            d = H.fetch_json(url, max_age=86400)
            items += d.get("items") or []
            url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None) if d.get("hasMore") else None
    finally:
        H.RATE = old
    return items


MATCH_SQL = """
with s as (
  select id, uf, %(norm)s as n from sanctions where source = %(source)s
), p as (
  select p.id, regexp_replace(f_unaccent(lower(p.civil_name)), '[^a-z ]', ' ', 'g') as raw from people p where p.civil_name is not null
), pn as (
  select id, array_to_string(array_remove(regexp_split_to_array(trim(raw), '\\s+'), ''), ' ') as n from p
), homonyms as (
  select n, count(*) as k from pn group by n
), uf_of as (
  select m.person_id, pl.uf from mandates m join places pl on pl.id = m.place_id where pl.uf is not null
  union
  select c.person_id, pl.uf from candidacies c join contests ct on ct.id = c.contest_id join places pl on pl.id = ct.place_id where pl.uf is not null
)
select s.id as sanction_id, pn.id as person_id, h.k as homonyms,
       exists (select 1 from uf_of u where u.person_id = pn.id and u.uf = s.uf) as same_uf
from s join pn on pn.n = s.n join homonyms h on h.n = pn.n
"""


def match(conn: psycopg.Connection, source: str) -> dict[str, int]:
    conn.execute("update sanctions set person_id = null, match_method = null, match_confidence = null, match_note = null where source = %s", (source,))
    norm = "array_to_string(array_remove(regexp_split_to_array(trim(regexp_replace(f_unaccent(lower(name)), '[^a-z ]', ' ', 'g')), '\\s+'), ''), ' ')"
    rows = conn.execute(MATCH_SQL.replace("%(norm)s", norm), {"source": source}).fetchall()
    stats = {"casado": 0, "homonimo": 0, "outra_uf": 0, "nome_curto": 0}
    by_s: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        by_s.setdefault(r["sanction_id"], []).append(r)
    names = {r["id"]: r["name"] for r in conn.execute("select id, name from sanctions where source = %s", (source,))}
    for sid, cands in by_s.items():
        nm = names[sid]
        if len(norm_name(nm).split()) < 3:
            note, key = "nome com menos de 3 palavras: não casa só por nome", "nome_curto"
            pid = None
        elif len(cands) != 1 or cands[0]["homonyms"] != 1:
            note, key, pid = "mais de uma pessoa no banco com o mesmo nome civil", "homonimo", None
        elif not cands[0]["same_uf"]:
            note, key, pid = "nome civil igual, mas sem mandato ou candidatura na UF da sanção", "outra_uf", None
        else:
            note, key, pid = "nome civil completo igual, único no banco, com mandato ou candidatura na UF da sanção", "casado", cands[0]["person_id"]
        stats[key] += 1
        conn.execute(
            "update sanctions set person_id = %s, match_method = %s, match_confidence = %s, match_note = %s where id = %s",
            (pid, "nome_civil_uf" if pid else None, 0.9 if pid else None, note, sid),
        )
        log.log(logging.INFO if pid else logging.WARNING, "TCU %s: %s (%s)", nm, key, note)
    return stats


def run_tcu(conn: psycopg.Connection, force: bool = False) -> dict[str, int]:
    items = fetch_tcu()
    rows = parse_tcu(items)
    with run(conn, "sancoes.tcu_inabilitados", "tcu", force=force) as r:
        cols = ["source", "source_key", "name", "uf", "municipality", "process", "decision", "decided_on", "final_on", "ends_on", "source_url"]
        upsert(conn, "sanctions", cols, [("tcu_inabilitados", x["source_key"], x["name"], x["uf"], x["municipality"], x["process"], x["decision"],
                                          x["decided_on"], x["final_on"], x["ends_on"], TCU_INABILITADOS) for x in rows], ["source", "source_key"])
        # some da lista = saiu da fonte (prazo vencido ou decisão revista): apaga, o dado é o que o TCU publica hoje
        keys = [x["source_key"] for x in rows]
        if keys:
            gone = conn.execute("delete from sanctions where source = 'tcu_inabilitados' and source_key <> all(%s)", (keys,)).rowcount
            if gone:
                r.notes.append(f"{gone} saíram da lista do TCU")
        r.add(len(rows))
        stats = match(conn, "tcu_inabilitados")
        stats["lista"] = len(rows)
        stats["sem_candidato"] = len(rows) - sum(v for k, v in stats.items() if k != "lista")
        log.info("TCU inabilitados: %s", stats)
    return stats


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl sancoes.*")
    p.add_argument("job", choices=["sancoes.tcu"])
    p.add_argument("--force", action="store_true")
    a = p.parse_args(argv)
    conn = db.connect()
    try:
        run_tcu(conn, force=a.force)
    except SkipUnchanged:
        pass
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
