"""Catálogo de coletores (R1, nível 3): a unidade de coleta, acionada por um ou mais comandos.

Nesta tarefa (R7) entram quatro entradas, conferidas no código: camara.equipe, sapl.camaras, camara.diario e camara.noturna. As demais
(R8, R9) estão em `comandos.COLETORES_PENDENTES`. Importar este módulo não importa nenhum job.

Lê-se `Coletor.entradas.urls` assim: `{ano}` é expandido pelo recorte; `{leg}`, `{id}` e `{ibge}` dependem de uma leitura (lista de
deputados, tabela `places`) e `descrever` não os expande.
"""

from __future__ import annotations

from .modelo import Ausentes, Coletor, Entradas, Fonte, Modo

# camara_diario.py:34-35
_API = "https://dadosabertos.camara.leg.br/api/v2"
_FILES = "https://dadosabertos.camara.leg.br/arquivos"
# camara_equipe.py:25
_URL_EQUIPE = f"{_FILES}/funcionarios/csv/funcionarios.csv"
# sapl.py:69
_REGISTRO_SAPL = "https://www12.senado.leg.br/interlegis/orgaosatendidos"

_ORQ_ACTIONS = "etl.yml:run-due"  # .github/workflows/etl.yml:60-61 (ETL_TASKS_EXCLUDE só tira sapl.todas)
_ORQ_LOCAL = "launchd-local:run-due"  # etl/deploy/launchd-install.sh -> run-due-local.sh:16 (roda todas as TASKS, sem filtro)
_ORQ_SAPL_MAC = "launchd-mac:run-due-sapl-prod"  # etl/deploy/launchd-sapl-prod.sh -> run-due-sapl-prod.sh:53 (ETL_TASKS_INCLUDE=sapl.todas)

_VOTACOES_ANO = (
    f"{_FILES}/votacoes/csv/votacoes-{{ano}}.csv",
    f"{_FILES}/votacoesVotos/csv/votacoesVotos-{{ano}}.csv",
    f"{_FILES}/votacoesOrientacoes/csv/votacoesOrientacoes-{{ano}}.csv",
    f"{_FILES}/votacoesProposicoes/csv/votacoesProposicoes-{{ano}}.csv",
)

COLETORES: tuple[Coletor, ...] = (
    Coletor(
        id="camara.equipe",
        modulos=("jobs/camara_equipe.py",),
        comandos=("camara.equipe",),
        tarefas=("camara.equipe",),
        fontes=(Fonte("camara", "seed"),),  # jobs/seed.py:21
        datasets=("camara.equipe",),
        acesso=("arquivo",),
        entradas=Entradas("estaticas", urls=(_URL_EQUIPE,)),
        recortes_aceitos=(),
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
        tabelas=("staff_members",),
        territorio="nenhuma",
        ausentes=Ausentes(
            "apaga",
            guarda="camara_equipe.py:52 apaga todo staff_members com source_key 'camara:%' que não veio no arquivo; sem guarda de arquivo "
                   "vazio (sem linhas aproveitáveis, apaga todos)",
        ),
        encadeados=(),
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "arquivo único, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=True,  # tests/test_caracterizacao.py (retrato camara_equipe.json)
        tentativas_registradas=True,
    ),
    Coletor(
        id="sapl.camaras",
        modulos=("jobs/sapl.py", "jobs/assembleias.py"),  # assembleias só pelo robots.txt (`allowed`, sapl.py:147)
        comandos=("sapl.descobrir", "sapl.carregar", "sapl.todas"),
        tarefas=("sapl.todas",),
        fontes=(Fonte("sapl", "seed"),),  # jobs/seed.py:28
        datasets=("sapl.descoberta", "sapl.{ibge}"),
        acesso=("api", "pagina"),  # a descoberta lê uma página HTML do registro do Interlegis (parse_registry, sapl.py:114); a carga lê a API REST
        entradas=Entradas(
            "dinamicas",
            urls=(_REGISTRO_SAPL,),
            depende_de=(
                "descoberta: uma página do registro do Interlegis por município (a URL leva ?uf=&municipio=, o nome vem de places); carga: "
                "base_url de cada casa em sapl_houses (preenchida pela descoberta), mais {base_url}/robots.txt e {base_url}/api/; as páginas da "
                "API só aparecem na leitura (paginação)"
            ),
        ),
        # --uf é aceito pelo parser (sapl.py:741) mas só é lido em sapl.ales (sapl.py:760-761); em descobrir/carregar/todas é ignorado
        recortes_aceitos=("ibge", "escopo"),
        recortes_nao_aceitos=("ano", "uf", "casa"),
        tabelas=("sapl_houses", "sapl_cursors", "sapl_parlamentares", "sapl_mandatos", "sapl_materias", "sapl_autorias", "sapl_sessoes",
                 "sapl_presencas", "sapl_votos", "data_coverage", "ingest_runs"),
        territorio="municipio",
        ausentes=Ausentes("nao_apaga"),  # sapl.py não tem delete
        encadeados=(),
        orquestradores=(_ORQ_SAPL_MAC, _ORQ_LOCAL),  # etl.yml exclui a tarefa (ETL_TASKS_EXCLUDE: "sapl.todas")
        env=None,
        modos={
            "descobrir": Modo(True, "sapl.descobrir"),
            "recoletar": Modo(True, "sapl.carregar"),
            "reprocessar": Modo(False, "a carga é incremental por cursor: reler o cache não reproduz a rodada"),
        },
        caracterizado=False,  # tests/test_sapl.py cobre funções puras (fila, cursor, registro), nenhum teste chama main/discover/load_house
        tentativas_registradas=True,
    ),
    Coletor(
        id="camara.diario",
        modulos=("jobs/camara_diario.py",),
        comandos=("camara.diario",),
        tarefas=("camara.diario",),
        fontes=(Fonte("camara", "seed"),),
        datasets=("camara.deputados", "camara.votacoes.{ano}", "camara.proposicoes.{ano}", "camara.despesas.{ano}",
                  "camara.despesasapi.{ano}"),  # despesasapi só para ano >= COTA_API_FROM (2025, camara_diario.py:717)
        acesso=("api", "arquivo"),
        entradas=Entradas(
            "dinamicas",
            urls=(
                f"{_API}/deputados?idLegislatura={{leg}}&itens=100&ordem=ASC&ordenarPor=nome",  # camara_diario.py:282; {leg} vem de LEGISLATURES (:36)
                *_VOTACOES_ANO,
                f"{_FILES}/proposicoes/csv/proposicoes-{{ano}}.csv",
                f"{_FILES}/proposicoesAutores/csv/proposicoesAutores-{{ano}}.csv",
                f"{_FILES}/proposicoesTemas/csv/proposicoesTemas-{{ano}}.csv",
                "https://www.camara.leg.br/cotas/Ano-{ano}.csv.zip",  # só sem --no-expenses
            ),
            depende_de=(
                f"{_API}/deputados/{{id}} (detalhe) sai da lista de deputados, que é paginada por cursor (links rel=next); "
                f"{_API}/deputados/{{id}}/despesas?idLegislatura&ano (só ano >= 2025) sai dos deputados com mandato no ano, lidos do banco; "
                f"{_FILES}/deputados/csv/deputados.csv só é lido quando um dos anos pertence a legislatura anterior à corrente (link_past_roster, "
                "camara_diario.py:84-86, :186)"
            ),
        ),
        recortes_aceitos=("ano",),
        recortes_nao_aceitos=("uf", "casa", "ibge"),
        tabelas=("sessions", "mandates", "party_observations", "proposals", "voting_events", "votes", "orientation_actors",
                 "party_orientations", "laws", "proposal_authors", "proposal_topics", "expenses",
                 "people", "person_external_ids", "identity_match_queue", "parties", "party_aliases"),
        territorio="pais",
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "expenses: apaga só chaves do mesmo prefixo (cota{ano}: ou cotaapi{ano}:) e do mesmo corpo que o arquivo/API do ano não trouxe "
                "(camara_diario.py:898), sem guarda para ano sem linhas aproveitáveis; e chaves de formato antigo vindas deste arquivo (:953). "
                "Não apaga mandato: o ausente da lista é encerrado, não apagado (suplente fora do exercício: close_suplentes, teto MAX_CLOSE=5 por "
                "rodada, acima disso nenhum é encerrado, :47 e :433; eleito pelo TSE sem registro na Câmara: marcado encerrado só sem --limit, :366)"
            ),
        ),
        encadeados=("identity.dedupe", "derive.stats"),  # cli.py:214 e :218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True, "desde que o cache tenha todas as URLs de entrada"),
        },
        caracterizado=True,  # tests/test_camara_mandato.py chama run_camara com dublês de conexão, de run e de rede
        tentativas_registradas=True,
    ),
    Coletor(
        id="camara.noturna",
        modulos=("jobs/camara_diario.py",),
        comandos=("camara.noturna",),
        tarefas=("camara.noturna",),
        fontes=(Fonte("camara", "seed"),),
        datasets=("camara.noturna.{ano}",),
        acesso=("arquivo",),
        # Os anos não vêm do recorte: são {ano da data - 3 dias, ano de hoje} em Brasília (run_camara_noturna, camara_diario.py:453-463)
        entradas=Entradas("estaticas", urls=_VOTACOES_ANO),
        recortes_aceitos=(),
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
        # parties e party_aliases: ctx.parties.get insere sigla nova (parties.py:60, :77) ao gravar o voto/orientação (camara_diario.py:553, :576)
        tabelas=("sessions", "proposals", "voting_events", "votes", "orientation_actors", "party_orientations", "parties", "party_aliases"),
        territorio="pais",
        ausentes=Ausentes("nao_apaga"),
        encadeados=(),  # a CLI não encadeia; a agenda roda derive.stats depois (Task.derives=False)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=False,  # nenhum teste chama run_camara_noturna nem _votes; test_schedule.py só cobre a janela da tarefa
        tentativas_registradas=True,
    ),
)


def _indice(chave) -> dict[str, Coletor]:
    out: dict[str, Coletor] = {}
    for c in COLETORES:
        for k in chave(c):
            if k in out:
                raise ValueError(f"catálogo de coletores: {k!r} aparece em {out[k].id} e em {c.id}")
            out[k] = c
    return out


_POR_ID = _indice(lambda c: (c.id,))
_POR_COMANDO = _indice(lambda c: c.comandos)
_POR_TAREFA = _indice(lambda c: c.tarefas)


def coletor(id: str) -> Coletor:
    try:
        return _POR_ID[id]
    except KeyError:
        raise KeyError(f"coletor sem entrada no catálogo: {id!r}") from None


def por_comando(nome: str) -> Coletor:
    try:
        return _POR_COMANDO[nome]
    except KeyError:
        raise KeyError(f"nenhum coletor com entrada no catálogo aciona o comando {nome!r}") from None


def por_tarefa(nome: str) -> Coletor:
    try:
        return _POR_TAREFA[nome]
    except KeyError:
        raise KeyError(f"nenhum coletor com entrada no catálogo tem a tarefa {nome!r}") from None
