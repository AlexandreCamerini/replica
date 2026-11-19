"""Catálogo de comandos (R1, nível 1): TODO nome que a CLI aceita, classificado.

Fonte de verdade do que a CLI aceita: `choices=` de cada parser (cli.py:87; jobs/ale_cli.py:25; jobs/sapl.py:739; jobs/sancoes.py:299;
transparencia.py:156; schedule.py:656) mais `purge-raw` e `admin`, tratados antes do argparse (cli.py:54 e :67). test_catalogo_forma.py confere os 49 nomes
contra o código por AST (`comandos_da_cli()` de test_orquestradores.py).

`argumentos` é por comando (o que o bloco do comando lê), não por parser: o parser principal aceita `--year` para qualquer job, mas só
alguns o leem. `encadeia` sai das condições de cli.py:214 (identity.dedupe) e :218 (derive.stats), do `_seed` depois de
`run_populacao` (cli.py:127) e do `run_derive` de jobs/ale_cli.py:53-56.

Importar este módulo não importa nenhum job.
"""

from __future__ import annotations

from .modelo import Classe, Comando

C = Classe

_FORCE = ("--force",)
_ANO_FORCE = ("--year", "--force")
_DERIVE = ("derive.stats",)
_DEDUPE_DERIVE = ("identity.dedupe", "derive.stats")

# Flags do parser de jobs/sapl.py:738-751 que cada comando lê (as não listadas são aceitas pelo argparse e ignoradas pelo comando).
_SAPL_CARGA = ("--max", "--full", "--orcamento-min", "--casa-max-min", "--workers")

COMANDOS: tuple[Comando, ...] = (
    # ---- parser principal (cli.py:87), na ordem de `choices`
    Comando("seed", C.SEED, "jobs/seed.py", "cli", (), (), None),
    Comando("ibge.places", C.COLETOR, "jobs/ibge_places.py", "cli", _FORCE, (), "ibge.places"),
    Comando("ibge.populacao", C.COLETOR, "jobs/ibge_populacao.py", "cli", _FORCE, ("seed",), "ibge.populacao"),  # cli.py:127: tetos de vereador dependem da população
    Comando("ibge.malhas", C.COLETOR, "jobs/ibge_malhas.py", "cli", _FORCE, (), "ibge.malhas"),
    Comando("tse.candidatos", C.COLETOR, "jobs/tse_candidatos.py", "cli", ("--year", "--uf", "--all", "--votes", "--force"), _DERIVE, "tse.candidatos"),
    Comando("tse.votos", C.COLETOR, "jobs/tse_votos_contas.py", "cli", _ANO_FORCE, _DERIVE, "tse.votos"),
    Comando("tse.contas", C.COLETOR, "jobs/tse_votos_contas.py", "cli", _ANO_FORCE, _DERIVE, "tse.contas"),
    Comando("tse.fix019", C.REPARO_PONTUAL, "jobs/tse_bug019.py", "cli", ("--year", "--apply"), (), None),
    Comando("tse.fix032", C.REPARO_PONTUAL, "jobs/tse_bug032.py", "cli", ("--year", "--apply"), (), None),
    Comando("tse.fix035", C.REPARO_PONTUAL, "jobs/tse_bug035.py", "cli", ("--apply",), (), None),
    Comando("identity.fix038", C.REPARO_PONTUAL, "jobs/identity_bug038.py", "cli", ("--apply",), (), None),
    Comando("identity.fix041", C.REPARO_PONTUAL, "jobs/identity_bug041.py", "cli", ("--apply",), (), None),
    Comando("identity.fix033", C.REPARO_PONTUAL, "jobs/identity_bug033.py", "cli", ("--apply",), (), None),
    Comando("identity.fix033.devolver", C.REPARO_PONTUAL, "jobs/identity_bug033.py", "cli", ("--apply",), (), None),
    Comando("identity.repairs", C.ROTINA_DE_AGENDA, "jobs/repairs.py", "cli", ("--apply",), (), None),
    Comando("camara.diario", C.COLETOR, "jobs/camara_diario.py", "cli", ("--year", "--limit", "--no-expenses", "--force"), _DEDUPE_DERIVE, "camara.diario"),
    Comando("camara.noturna", C.COLETOR, "jobs/camara_diario.py", "cli", _FORCE, (), "camara.noturna"),  # a agenda roda derive.stats depois (Task.derives=False)
    Comando("camara.presenca", C.COLETOR, "jobs/camara_presenca.py", "cli", _ANO_FORCE, _DERIVE, "camara.presenca"),
    Comando("camara.equipe", C.COLETOR, "jobs/camara_equipe.py", "cli", _FORCE, (), "camara.equipe"),
    Comando("senado.diario", C.COLETOR, "jobs/senado_diario.py", "cli", ("--year", "--limit", "--force"), _DEDUPE_DERIVE, "senado.diario"),
    Comando("senado.noturna", C.COLETOR, "jobs/senado_diario.py", "cli", _FORCE, (), "senado.noturna"),
    Comando("senado.secretas", C.COLETOR, "jobs/senado_diario.py", "cli", _ANO_FORCE, (), "senado.secretas"),
    Comando("agenda.congresso", C.COLETOR, "jobs/agenda_congresso.py", "cli", _ANO_FORCE, (), "agenda.congresso"),
    Comando("parlamento.extras", C.COLETOR, "jobs/parlamento_extras.py", "cli", _ANO_FORCE, _DERIVE, "parlamento.extras"),  # só o MENOR --year vale (cli.py:213)
    Comando("identity.dedupe", C.DERIVACAO, "jobs/identity_dedupe.py", "cli", (), _DERIVE, None),
    Comando("derive.stats", C.DERIVACAO, "jobs/derive_stats.py", "cli", (), (), None),
    Comando("pauta", C.COLETOR, "jobs/pauta.py", "cli", (), (), "pauta"),
    Comando("rascunho", C.FLUXO_DE_IA, "jobs/rascunho.py", "cli", ("key", "--limit", "--model", "--force", "--batch", "--batch-wait-min", "--coletar"), (), None),
    Comando("revisar", C.FLUXO_DE_IA, "jobs/revisar.py", "cli", ("key", "--aprovar", "--reprovar", "--revisor", "--motivo", "--nao-diz", "--conferido", "--frase"), (), None),
    Comando("verificar", C.FLUXO_DE_IA, "jobs/verificar.py", "cli", ("key", "--limit", "--force"), (), None),
    Comando("check", C.CHECAGEM, "jobs/checks.py", "cli", (), (), None),
    # `all` é a sequência seed .. check (cli.py:113-253). As condições de cli.py:214 e :218 também valem para ele.
    Comando("all", C.DESPACHANTE, "cli.py", "cli", ("--year", "--uf", "--all", "--votes", "--limit", "--no-expenses", "--force"), _DEDUPE_DERIVE, None),
    Comando("governos.indicadores", C.COLETOR, "jobs/governos_indicadores.py", "cli", _FORCE, (), "governos.indicadores"),
    Comando("receita.arrecadacao", C.COLETOR, "jobs/receita_arrecadacao.py", "cli", _FORCE, (), "receita.arrecadacao"),
    # ---- jobs/ale_cli.py:25 (cli.py:70). Os três de coleta rodam derive.stats no fim, salvo --no-derive (ale_cli.py:53-56).
    Comando("ale.sp", C.COLETOR, "jobs/alesp.py", "ale_cli", ("--year", "--force", "--no-derive"), _DERIVE, "ale.custom"),
    Comando("ale.mg", C.COLETOR, "jobs/almg.py", "ale_cli", ("--year", "--force", "--no-derive"), _DERIVE, "ale.custom"),
    Comando("ale.todas", C.COLETOR, "jobs/ale_cli.py", "ale_cli", ("--year", "--force", "--no-derive"), _DERIVE, "ale.custom"),
    Comando("ale.cobertura", C.DESPACHANTE, "jobs/assembleias.py", "ale_cli", (), (), None),  # despacho sem coleta: só reword_unread_coverage; o parser aceita --year/--force/--no-derive mas com ufs=[] nenhum é lido
    # ---- jobs/sapl.py:739 (cli.py:82)
    Comando("sapl.descobrir", C.COLETOR, "jobs/sapl.py", "sapl", ("--ibge", "--escopo", "--lote", "--lote-descoberta", "--offset", "--max-pendentes"), (), "sapl.camaras"),
    Comando("sapl.carregar", C.COLETOR, "jobs/sapl.py", "sapl", ("--ibge", "--escopo", "--lote", "--offset", *_SAPL_CARGA), (), "sapl.camaras"),
    Comando("sapl.todas", C.COLETOR, "jobs/sapl.py", "sapl", ("--ibge", "--escopo", "--lote", "--lote-descoberta", "--offset", "--max-pendentes", *_SAPL_CARGA), (), "sapl.camaras"),
    Comando("sapl.ales", C.COLETOR, "jobs/sapl.py", "sapl", ("--uf", "--lote", *_SAPL_CARGA), (), "sapl.assembleias"),
    # ---- jobs/sancoes.py:299 (cli.py:74)
    Comando("sancoes.tcu", C.COLETOR, "jobs/sancoes.py", "sancoes", _FORCE, (), "sancoes.tcu"),
    Comando("sancoes.cgu", C.COLETOR, "jobs/sancoes.py", "sancoes", _FORCE, (), "sancoes.cgu"),
    # ---- transparencia.py:156 (cli.py:78)
    Comando("transparencia.ping", C.CHECAGEM, "transparencia.py", "transparencia", (), (), None),
    Comando("transparencia.emendas", C.COLETOR, "jobs/transparencia_emendas.py", "transparencia", _ANO_FORCE, (), "transparencia.emendas"),
    # ---- schedule.py:656 (cli.py:66) e comando inline (cli.py:53)
    Comando("run-due", C.ROTINA_DE_AGENDA, "schedule.py", "schedule", ("--only", "--dry-run", "--force"), (), None),
    Comando("purge-raw", C.MANUTENCAO, "cli.py", "inline", (), (), None),
    # desvio inline de cli.py (`args[0] == "admin"`) para civico_etl/admin/cli.py, que tem parser próprio (subparsers). O modelo não tem parser "admin":
    # "inline" é o mais próximo (sem conferência de flags) e MANUTENCAO a classe mais próxima (lê o banco e só grava em adm_*).
    Comando("admin", C.MANUTENCAO, "admin/cli.py", "inline", (), (), None),
)

# Coletores que o catálogo de comandos já cita e que ainda não têm entrada em coletores.py (tarefas R8 e R9). Os ids são os que o plano prevê;
# onde o plano não nomeia (ale.custom, sapl.assembleias) o id é uma proposta, a confirmar na R8.
COLETORES_PENDENTES: frozenset[str] = frozenset()  # vazio desde a integração dos lotes R8a, R8b e R9: todo comando de coleta tem coletor

_POR_NOME = {c.nome: c for c in COMANDOS}


def comando(nome: str) -> Comando:
    try:
        return _POR_NOME[nome]
    except KeyError:
        raise KeyError(f"comando desconhecido: {nome!r}") from None
