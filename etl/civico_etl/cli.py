"""civico-etl <job> [opções]. Jobs seguem o contrato de run (db.run). `all` roda a sequência do R0/R1.

Exemplos:
  civico-etl seed
  civico-etl ibge.places
  civico-etl tse.candidatos --year 2022 --year 2024 --uf SP            # só eleitos; --all para todos
  civico-etl camara.diario --year 2025 --limit 40                        # --limit: N deputados (desenvolvimento)
  civico-etl senado.diario --year 2025
  civico-etl derive.stats
  civico-etl pauta                                                   # pauta de hoje a +14 dias; rodar várias vezes ao dia
  civico-etl check                                                  # invariantes; exit 1 se alguma quebrar
  civico-etl rascunho --limit 5                                     # IA rascunha as respostas (custa API); nada publica
  civico-etl revisar [chave] [--aprovar|--reprovar] --revisor "Nome"  # fila, leitura e publicação por pessoa
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
    p = argparse.ArgumentParser(prog="civico-etl", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=["seed", "ibge.places", "ibge.malhas", "tse.candidatos", "tse.votos", "tse.contas", "camara.diario", "senado.diario", "parlamento.extras", "identity.dedupe", "derive.stats", "pauta", "rascunho", "revisar", "check", "all"])
    p.add_argument("key", nargs="?", help="rascunho/revisar: chave da proposta, ex. camara-pl-79-2020")
    p.add_argument("--year", type=int, action="append", help="ano (repetível)")
    p.add_argument("--uf", action="append", help="só esta UF (repetível; TSE e Câmara)")
    p.add_argument("--all", action="store_true", help="TSE: carregar todas as candidaturas, não só eleitos")
    p.add_argument("--votes", action="store_true", help="TSE: baixar votação por candidato (~550 MB por eleição)")
    p.add_argument("--limit", type=int, help="Câmara/Senado: no máximo N parlamentares (desenvolvimento)")
    p.add_argument("--no-expenses", action="store_true", help="Câmara: pular a cota parlamentar")
    p.add_argument("--force", action="store_true", help="ignorar checksum e reprocessar")
    p.add_argument("--model", help="rascunho: modelo (padrão claude-sonnet-5-5 ou RASCUNHO_MODEL)")
    p.add_argument("--aprovar", action="store_true", help="revisar: publica o último rascunho")
    p.add_argument("--reprovar", action="store_true", help="revisar: reprova o último rascunho")
    p.add_argument("--revisor", help="revisar: nome de quem revisou (aparece como 'Revisado por pessoa')")
    p.add_argument("--motivo", help="revisar: motivo da reprovação ou da correção")
    p.add_argument("--nao-diz", action="append", default=[], metavar="CAMPO", help="revisar: troca o campo por 'O texto não diz' (repetível)")
    p.add_argument("--frase", action="append", default=[], metavar='CAMPO="TEXTO"', help="revisar: reescreve a frase do campo; o trecho fica (repetível)")
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
        if a.job in ("camara.diario", "all"):
            from .jobs.camara_diario import run_camara

            run_camara(conn, years=a.year or [today.year - 1, today.year], limit=a.limit, expenses=not a.no_expenses, force=a.force)
        if a.job in ("senado.diario", "all"):
            from .jobs.senado_diario import run_senado

            run_senado(conn, years=a.year or [today.year - 1, today.year], limit=a.limit, force=a.force)
        if a.job in ("parlamento.extras", "all"):
            from .jobs.parlamento_extras import run_extras

            run_extras(conn, since=date(min(a.year) if a.year else today.year - 1, 1, 1), force=a.force)
        if a.job in ("identity.dedupe", "all", "camara.diario", "senado.diario"):
            from .jobs.identity_dedupe import run_dedupe

            run_dedupe(conn)
        if a.job in ("derive.stats", "all") or a.job in ("tse.candidatos", "tse.votos", "tse.contas", "camara.diario", "senado.diario", "parlamento.extras", "identity.dedupe"):
            from .jobs.derive_stats import run_derive

            run_derive(conn)
        if a.job in ("pauta", "all"):
            from .jobs.pauta import run_pauta

            run_pauta(conn)
        if a.job == "rascunho":
            from .jobs.rascunho import run_rascunho

            run_rascunho(conn, key=a.key, limit=a.limit or 5, model=a.model, force=a.force)
        if a.job == "revisar":
            from .jobs.revisar import run_revisar

            if a.aprovar and a.reprovar:
                p.error("use --aprovar ou --reprovar, não os dois")
            return run_revisar(conn, a.key, approve=a.aprovar, reject=a.reprovar, reviewer=a.revisor, note=a.motivo, not_said=a.nao_diz, phrases=a.frase)
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
