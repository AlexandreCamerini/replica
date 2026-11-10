"""civico-etl <job> [opções]. Jobs seguem o contrato de run (db.run). `all` roda a sequência do R0/R1.

Exemplos:
  civico-etl seed
  civico-etl ibge.places
  civico-etl tse.candidatos --year 2022 --year 2024 --uf SP            # só eleitos; --all para todos
  civico-etl camara.diario --year 2025 --limit 40                        # --limit: N deputados (desenvolvimento)
  civico-etl camara.presenca --year 2025 --year 2026                  # presença oficial em sessões deliberativas
  civico-etl senado.diario --year 2025
  civico-etl senado.secretas                                          # votação secreta do Senado pela fonte (D123)
  civico-etl camara.noturna / senado.noturna                          # catálogo D06: só as votações dos últimos dias; a agenda roda derive.stats depois (à mão: civico-etl derive.stats)
  civico-etl transparencia.ping                                       # catálogo D01: testa a chave do Portal da Transparência (exit 0 ok, 1 recusada, 2 sem chave)
  civico-etl transparencia.emendas [--year 2024]                      # catálogo D02: emendas por ano (2023+), com chave
  civico-etl sancoes.cgu                                              # catálogo D03: CEIS e CNEP pela API, com chave
  civico-etl agenda.congresso                                         # pauta de plenário Câmara/Senado (mês passado a mês que vem)
  civico-etl tse.fix019 --year 2022 [--apply]                        # BUG-019: corrige presidente contado 2x (dry-run sem --apply)
  civico-etl tse.fix032 [--year 2012] [--apply]                    # BUG-032: identidade casada por SQ sem o ano (dry-run sem --apply)
  civico-etl identity.fix033 [--apply]                              # BUG-033: separa pessoas fundidas pela cadeira da casa
  civico-etl tse.fix035 [--apply]                                   # BUG-035: chave 2012 com a UE e restauração das candidaturas
  civico-etl identity.fix038 [--apply]                              # BUG-038: separa pessoas do TSE fundidas por nome + nascimento
  civico-etl identity.fix041 [--apply]                              # BUG-041/042/043: título repetido, reemitido e registro substituído
  civico-etl identity.repairs [--apply]                             # rotina: reparos ainda necessários depois das cargas (D245)

Os seis reparos de uma vez só acima (tse.fix019, tse.fix032, tse.fix035, identity.fix033[.devolver], identity.fix038 e
identity.fix041) são legado e NÃO rodam na rotina: a regra deles está na carga (D245) e o `check` acusa se o defeito voltar.
Ficam para resposta a incidente. A rotina roda `identity.repairs` depois de tse.candidatos e de camara/senado.diario.
  civico-etl derive.stats
  civico-etl pauta                                                   # pauta de hoje a +14 dias; rodar várias vezes ao dia
  civico-etl check                                                  # invariantes; exit 1 se alguma quebrar
  civico-etl rascunho --limit 5                                     # IA rascunha as respostas (custa API); nada publica
  civico-etl revisar [chave] [--aprovar|--reprovar] --revisor "Nome"  # fila, leitura e publicação por pessoa
  civico-etl check                                                   # invariantes; exit 1 se alguma quebrar
  civico-etl run-due [--dry-run] [--only TAREFA --force]             # agenda (D250): roda o que venceu, check e alerta; exit 2 = alerta
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date

from . import db

logging.basicConfig(level=os.environ.get("ETL_LOG", "INFO"), format="%(asctime)s %(name)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("etl")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args and args[0] == "purge-raw":  # D12: apaga o bruto vencido (90 dias dos diários); eleição do TSE é permanente
        from . import rawstore
        from .db import connect

        st = rawstore.store_from_env()
        if st is None:
            log.info("ETL_RAW_STORE desligado: nada a apagar")
            return 0
        c = connect()
        n = rawstore.purge_expired(c, st)
        c.commit()
        log.info("purge-raw: %d runs apagados", n)
        return 0
    if args and args[0] == "run-due":  # agenda (D250): roda o que venceu, repara identidade, check e alerta
        from .schedule import main as schedule_main

        return schedule_main(args)
    if args and args[0].startswith("ale."):  # Assembleias Legislativas (W3-A): ale.sp, ale.mg, ale.todas, ale.cobertura
        from .jobs.ale_cli import main as ale_main

        return ale_main(args)
    if args and args[0].startswith("sancoes."):  # sanções de órgãos de controle (W3-B, catálogo D03): sancoes.tcu, sancoes.cgu (API com chave)
        from .jobs.sancoes import main as sancoes_main

        return sancoes_main(args)
    if args and args[0].startswith("transparencia."):  # Portal da Transparência com chave (catálogo D01 e D02): transparencia.ping, transparencia.emendas
        from .transparencia import main as transparencia_main

        return transparencia_main(args)
    if args and args[0].startswith("sapl."):  # Câmaras Municipais via SAPL (W3-B): sapl.descobrir, sapl.carregar, sapl.todas
        from .jobs.sapl import main as sapl_main

        return sapl_main(args)
    p = argparse.ArgumentParser(prog="civico-etl", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=["seed", "ibge.places", "ibge.populacao", "ibge.malhas", "tse.candidatos", "tse.votos", "tse.contas", "tse.fix019", "tse.fix032", "tse.fix035", "identity.fix038", "identity.fix041", "identity.fix033", "identity.fix033.devolver", "identity.repairs", "camara.diario", "camara.noturna", "camara.presenca", "camara.equipe", "senado.diario", "senado.noturna", "senado.secretas", "agenda.congresso", "parlamento.extras", "identity.dedupe", "derive.stats", "pauta", "rascunho", "revisar", "check", "all", "governos.indicadores", "receita.arrecadacao"])
    p.add_argument("key", nargs="?", help="rascunho/revisar: chave da proposta, ex. camara-pl-79-2020")
    p.add_argument("--year", type=int, action="append", help="ano (repetível)")
    p.add_argument("--uf", action="append", help="só esta UF (repetível; TSE e Câmara)")
    p.add_argument("--all", action="store_true", help="TSE: carregar todas as candidaturas, não só eleitos")
    p.add_argument("--votes", action="store_true", help="TSE: baixar votação por candidato (~550 MB por eleição)")
    p.add_argument("--limit", type=int, help="Câmara/Senado: no máximo N parlamentares (desenvolvimento)")
    p.add_argument("--no-expenses", action="store_true", help="Câmara: pular a cota parlamentar")
    p.add_argument("--force", action="store_true", help="ignorar checksum e reprocessar")
    p.add_argument("--model", help="rascunho: modelo (padrão claude-sonnet-5-5 ou RASCUNHO_MODEL)")
    p.add_argument("--batch", action="store_true", help="rascunho: envia a fila num lote (50%% do preço) e espera até --batch-wait-min")
    p.add_argument("--batch-wait-min", type=float, help="rascunho --batch: espera máxima pelo lote antes de cair para o síncrono (padrão RASCUNHO_BATCH_WAIT_MIN ou 20)")
    p.add_argument("--coletar", action="store_true", help="rascunho: só coleta lotes de runs anteriores, sem enviar nada")
    p.add_argument("--aprovar", action="store_true", help="revisar: publica o último rascunho")
    p.add_argument("--reprovar", action="store_true", help="revisar: reprova o último rascunho")
    p.add_argument("--revisor", help="revisar: nome de quem revisou (aparece como 'Revisado por pessoa')")
    p.add_argument("--motivo", help="revisar: motivo da reprovação ou da correção")
    p.add_argument("--nao-diz", action="append", default=[], metavar="CAMPO", help="revisar: troca o campo por 'O texto não diz' (repetível)")
    p.add_argument("--conferido", metavar="CÓDIGO", help="revisar: código mostrado ao ler o rascunho; obrigatório para aprovar")
    p.add_argument("--frase", action="append", default=[], metavar='CAMPO="TEXTO"', help="revisar: reescreve a frase do campo; o trecho fica (repetível)")
    p.add_argument("--apply", action="store_true", help="tse.fix019/tse.fix032/tse.fix035/identity.fix033/identity.fix038/identity.fix041: gravar a correção (sem isto, dry-run)")
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
        if a.job == "tse.fix032":  # BUG-032: religa candidaturas/mandatos casados pelo SQ_CANDIDATO de outra eleição
            from .jobs.tse_bug032 import run_fix as run_fix032

            run_fix032(conn, a.year, apply=a.apply)
        if a.job == "identity.fix033":  # BUG-033: separa pessoas fundidas pela cadeira (mesmo nascimento ou nome parlamentar)
            from .jobs.identity_bug033 import run_fix as run_fix033

            run_fix033(conn, apply=a.apply)
        if a.job == "identity.fix033.devolver":  # BUG-033 / D227: o id separado vira pessoa e recebe cota, partido, votos e autorias
            from .jobs.identity_bug033 import run_restore

            run_restore(conn, apply=a.apply)
        if a.job == "tse.fix035":  # BUG-035: SQ repetido em 2012 (eleição ordinária x suplementar); chave ANO:UE:SQ e restauração
            from .jobs.tse_bug035 import run_fix as run_fix035

            run_fix035(conn, apply=a.apply)
        if a.job == "identity.fix038":  # BUG-038: TSE fundido por nome civil + nascimento sem lugar; título de outra pessoa
            from .jobs.identity_bug038 import run_fix as run_fix038

            run_fix038(conn, apply=a.apply)
        if a.job == "identity.fix041":  # BUG-041/042/043: título repetido pelo TSE, título reemitido e registro substituído no banco
            from .jobs.identity_bug041 import run_fix as run_fix041

            run_fix041(conn, apply=a.apply)
        if a.job == "identity.repairs":  # D245: só os reparos que a carga ainda não faz, em ordem fixa (jobs/repairs.py)
            from .jobs.repairs import run_identity_repairs

            res = run_identity_repairs(conn, apply=a.apply)
            log.info("identity.repairs (%s): %s", "aplicado" if a.apply else "dry-run", res)
        if a.job in ("camara.diario", "all"):
            from .jobs.camara_diario import run_camara

            run_camara(conn, years=a.year or [today.year - 1, today.year], limit=a.limit, expenses=not a.no_expenses, force=a.force)
        if a.job in ("camara.presenca", "all"):
            from .jobs.camara_presenca import run_presenca

            run_presenca(conn, years=a.year or [today.year - 1, today.year], force=a.force)
        if a.job in ("camara.equipe", "all"):
            from .jobs.camara_equipe import run_equipe

            run_equipe(conn, force=a.force)
        if a.job == "camara.noturna":
            from .jobs.camara_diario import run_camara_noturna

            run_camara_noturna(conn, force=a.force)
        if a.job == "senado.noturna":
            from .jobs.senado_diario import run_senado_noturna

            run_senado_noturna(conn, force=a.force)
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
        if a.job in ("pauta", "all"):
            from .jobs.pauta import run_pauta

            run_pauta(conn)
        if a.job == "rascunho":
            from .jobs.rascunho import run_rascunho

            run_rascunho(conn, key=a.key, limit=a.limit or 5, model=a.model, force=a.force, batch=a.batch, batch_wait_min=a.batch_wait_min, coletar=a.coletar)
        if a.job == "revisar":
            from .jobs.revisar import run_revisar

            if a.aprovar and a.reprovar:
                p.error("use --aprovar ou --reprovar, não os dois")
            return run_revisar(conn, a.key, approve=a.aprovar, reject=a.reprovar, reviewer=a.revisor, note=a.motivo, not_said=a.nao_diz, phrases=a.frase, checked=a.conferido)
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
