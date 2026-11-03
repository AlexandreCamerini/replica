"""civico-etl <job> [opções]. Jobs seguem o contrato de run (db.run). `all` roda a sequência do R0/R1.

Exemplos:
  civico-etl seed
  civico-etl ibge.places
  civico-etl tse.candidatos --year 2022 --year 2024 --uf SP            # só eleitos; --all para todos
  civico-etl camara.diario --year 2025 --limit 40                        # --limit: N deputados (desenvolvimento)
  civico-etl camara.presenca --year 2025 --year 2026                  # presença oficial em sessões deliberativas
  civico-etl senado.diario --year 2025
  civico-etl senado.secretas                                          # votação secreta do Senado pela fonte (D123)
  civico-etl agenda.congresso                                         # pauta de plenário Câmara/Senado (mês passado a mês que vem)
  civico-etl tse.fix019 --year 2022 [--apply]                        # BUG-019: corrige presidente contado 2x (dry-run sem --apply)
  civico-etl derive.stats
  civico-etl check                                                   # invariantes; exit 1 se alguma quebrar
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

from . import db

logging.basicConfig(level=os.environ.get("ETL_LOG", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("etl")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args and args[0].startswith("ale."):  # Assembleias Legislativas (W3-A): ale.sp, ale.mg, ale.todas, ale.cobertura
        from .jobs.ale_cli import main as ale_main

        return ale_main(args)
    if args and args[0].startswith("sancoes."):  # sanções de órgãos de controle (W3-B): sancoes.tcu
        from .jobs.sancoes import main as sancoes_main

        return sancoes_main(args)
    if args and args[0].startswith("sapl."):  # Câmaras Municipais via SAPL (W3-B): sapl.descobrir, sapl.carregar, sapl.todas
        from .jobs.sapl import main as sapl_main

        return sapl_main(args)
    p = argparse.ArgumentParser(prog="civico-etl", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=["seed", "ibge.places", "ibge.populacao", "ibge.malhas", "tse.candidatos", "tse.votos", "tse.contas", "tse.fix019", "camara.diario", "camara.presenca", "camara.equipe", "senado.diario", "senado.secretas", "agenda.congresso", "parlamento.extras", "identity.dedupe", "derive.stats", "check", "all", "governos.indicadores", "receita.arrecadacao"])
    p.add_argument("--year", type=int, action="append", help="ano (repetível)")
    p.add_argument("--uf", action="append", help="só esta UF (repetível; TSE e Câmara)")
    p.add_argument("--all", action="store_true", help="TSE: carregar todas as candidaturas, não só eleitos")
    p.add_argument("--votes", action="store_true", help="TSE: baixar votação por candidato (~550 MB por eleição)")
    p.add_argument("--limit", type=int, help="Câmara/Senado: no máximo N parlamentares (desenvolvimento)")
    p.add_argument("--no-expenses", action="store_true", help="Câmara: pular a cota parlamentar")
    p.add_argument("--force", action="store_true", help="ignorar checksum e reprocessar")
    p.add_argument("--apply", action="store_true", help="tse.fix019: gravar a correção (sem isto, dry-run)")
    a = p.parse_args(argv)

    conn = db.connect()
    today = date.today()
    try:
        if a.job in ("seed", "all"):
            from .jobs.seed import run_seed

            run_seed(conn)
            log.info("seed ok")
        if a.job in ("ibge.places", "all"):
            from .jobs.ibge_places import run_places

            run_places(conn, force=a.force)
        if a.job in ("ibge.populacao", "all"):
            from .jobs.ibge_populacao import run_populacao
            from .jobs.seed import run_seed as _seed

            run_populacao(conn, force=a.force)
            _seed(conn)  # tetos de vereador dependem da população
        if a.job in ("ibge.malhas", "all"):
            from .jobs.ibge_malhas import run_malhas

            run_malhas(conn, force=a.force)
        if a.job in ("tse.candidatos", "all"):
            from .jobs.tse_candidatos import run_tse

            years = a.year or [y for y in (2018, 2020, 2022, 2024, 2026) if y <= today.year]
            run_tse(conn, years=years, ufs=a.uf, only_elected=not a.all, with_votes=a.votes, force=a.force)
        if a.job in ("tse.votos", "all"):
            from .jobs.tse_votos_contas import run_votes

            run_votes(conn, a.year or [y for y in (2022, 2024, 2026) if y <= today.year], force=a.force)
        if a.job in ("tse.contas", "all"):
            from .jobs.tse_votos_contas import run_finance

            run_finance(conn, a.year or [y for y in (2022, 2024, 2026) if y <= today.year], force=a.force)
        if a.job == "tse.fix019":  # BUG-019: desfaz a contagem dupla de presidente (BRASIL + BR) sem rebaixar o BRASIL
            from .jobs.tse_bug019 import run_fix

            run_fix(conn, a.year or [2018, 2022, 2026], apply=a.apply)
        if a.job in ("camara.diario", "all"):
            from .jobs.camara_diario import run_camara

            run_camara(conn, years=a.year or [today.year - 1, today.year], limit=a.limit, expenses=not a.no_expenses, force=a.force)
        if a.job in ("camara.presenca", "all"):
            from .jobs.camara_presenca import run_presenca

            run_presenca(conn, years=a.year or [today.year - 1, today.year], force=a.force)
        if a.job in ("camara.equipe", "all"):
            from .jobs.camara_equipe import run_equipe

            run_equipe(conn, force=a.force)
        if a.job in ("senado.diario", "all"):
            from .jobs.senado_diario import run_senado

            run_senado(conn, years=a.year or [today.year - 1, today.year], limit=a.limit, force=a.force)
        if a.job in ("senado.secretas", "all"):
            from .jobs.senado_diario import run_secretas

            run_secretas(conn, years=a.year or list(range(2019, today.year + 1)), force=a.force)
        if a.job in ("agenda.congresso", "all"):
            from .jobs.agenda_congresso import run_agenda

            run_agenda(conn, years=a.year, force=a.force)
        if a.job in ("parlamento.extras", "all"):
            from .jobs.parlamento_extras import run_extras

            run_extras(conn, since=date(min(a.year) if a.year else today.year - 1, 1, 1), force=a.force)
        if a.job in ("identity.dedupe", "all", "camara.diario", "senado.diario"):
            from .jobs.identity_dedupe import run_dedupe

            run_dedupe(conn)
        if a.job in ("derive.stats", "all") or a.job in ("tse.candidatos", "tse.votos", "tse.contas", "camara.diario", "camara.presenca", "senado.diario", "parlamento.extras", "identity.dedupe"):
            from .jobs.derive_stats import run_derive

            run_derive(conn)
        # W4: fora do "all" (fontes novas, independentes das legislativas)
        if a.job == "governos.indicadores":
            from .jobs.governos_indicadores import run_governos

            run_governos(conn, force=a.force)
        if a.job == "receita.arrecadacao":
            from .jobs.receita_arrecadacao import run_arrecadacao

            run_arrecadacao(conn, force=a.force)
        if a.job in ("check", "all"):
            from .jobs.checks import run_checks

            if run_checks(conn):
                return 1
    except db.SkipUnchanged:
        pass
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
