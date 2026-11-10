"""civico-etl ale.<uf> | ale.todas | ale.cobertura — Assembleias Legislativas (W3-A).

Exemplos:
  civico-etl ale.sp                      # ALESP: verba de gabinete e proposituras, 2019 até o ano corrente
  civico-etl ale.mg --year 2025          # ALMG: proposições do ano; verba indenizatória da legislatura atual (2023+)
  civico-etl ale.todas                   # todas as Assembleias com adaptador, uma de cada vez
  civico-etl ale.cobertura               # só reescreve o motivo de "—" nas UFs ainda não lidas
Depois de carregar, roda derive.stats (números do crachá). --force ignora o checksum.
"""

from __future__ import annotations

import argparse
import logging
from datetime import date

from .. import db

log = logging.getLogger("etl.ale")
ADAPTERS = ("sp", "mg")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=[f"ale.{u}" for u in ADAPTERS] + ["ale.todas", "ale.cobertura"])
    p.add_argument("--year", type=int, action="append", help="ano (repetível); padrão: 2019 até hoje")
    p.add_argument("--force", action="store_true", help="ignorar checksum e reprocessar")
    p.add_argument("--no-derive", action="store_true", help="não rodar derive.stats no fim")
    a = p.parse_args(argv)
    today = date.today()
    years = sorted(set(a.year or range(2019, today.year + 1)))
    ufs = list(ADAPTERS) if a.job == "ale.todas" else ([] if a.job == "ale.cobertura" else [a.job.split(".")[1]])
    conn = db.connect()
    try:
        notes: list[str] = []
        for uf in ufs:
            if uf == "sp":
                from .alesp import run_alesp

                notes += run_alesp(conn, years=years, force=a.force)
            elif uf == "mg":
                from .almg import run_almg

                # verba indenizatória vem por deputado da legislatura atual: anos antes de 2023 ficam sem carimbo ("—")
                notes += run_almg(conn, years=years, expense_years=[y for y in years if y >= 2023], force=a.force)
        from .assembleias import reword_unread_coverage

        n = reword_unread_coverage(conn)
        if n:
            log.info("cobertura: %d motivos de UF não lida reescritos", n)
        for line in notes:
            log.info("%s", line)
        if ufs and not a.no_derive:
            from .derive_stats import run_derive

            run_derive(conn)
    finally:
        conn.close()
    return 0
