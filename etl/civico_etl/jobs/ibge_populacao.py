"""etl.ibge.populacao: população residente estimada por município, UF e país (IBGE, agregado 6579, variável 9324).

Fonte: https://servicodados.ibge.gov.br/api/v3/agregados/6579 (CC BY 4.0). Usa o período mais recente publicado.
Alimenta places.population (migração 0015) e, por ela, o teto de subsídio de vereador (seed.ceilings; CF art. 29 VI).
"""

from __future__ import annotations

import logging

import psycopg

from ..db import SkipUnchanged, run
from ..http import fetch_json

log = logging.getLogger("etl.ibge.pop")
API = "https://servicodados.ibge.gov.br/api/v3/agregados/6579"
DAY = 86400


def run_populacao(conn: psycopg.Connection, *, force: bool = False) -> None:
    periods = fetch_json(f"{API}/periodos", max_age=DAY)
    year = max(int(p["id"]) for p in periods)
    data = {}
    for level in ("N1", "N3", "N6"):
        d = fetch_json(f"{API}/periodos/{year}/variaveis/9324?localidades={level}[all]", max_age=DAY)
        for s in d[0]["resultados"][0]["series"]:
            v = (s["serie"] or {}).get(str(year))
            if v and v.isdigit():
                code = s["localidade"]["id"]
                data["BR" if level == "N1" else code] = int(v)
    checksum = f"{year}:{len(data)}:{sum(data.values())}"
    try:
        with run(conn, "ibge.populacao", "ibge", input_checksum=checksum, force=force) as r:
            cur = conn.cursor()
            cur.execute("create temp table tmp_pop (code text, pop int) on commit drop")
            with cur.copy("copy tmp_pop (code, pop) from stdin") as cp:
                for k, v in data.items():
                    cp.write_row((k, v))
            cur.execute(
                """update places p set population = t.pop, population_year = %s, updated_at = now() from tmp_pop t
                   where p.ibge_code = t.code and (p.population is distinct from t.pop or p.population_year is distinct from %s)""",
                (year, year),
            )
            r.add(cur.rowcount)
            missing = conn.execute("select count(*) n from places where kind = 'municipio' and population is null").fetchone()["n"]
            if missing:
                r.notes.append(f"{missing} municípios sem estimativa de {year}")
            log.info("ibge população %d: %d lugares atualizados, %d municípios sem dado", year, cur.rowcount, missing)
    except SkipUnchanged:
        pass
