"""Catálogo de coletores, lote C (R9): ibge.places, ibge.populacao, ibge.malhas, governos.indicadores e receita.arrecadacao.

Entradas no formato de `camara.equipe` (coletores.py). Conferidas no código: cada comentário diz arquivo:linha. Importar este módulo
não importa nenhum job nem `civico_etl.cli`. Integração em `coletores.COLETORES` é de outra tarefa.

Lê-se `Entradas.urls` como em coletores.py: `{ano}` é expandido pelo recorte; o que depende de leitura anterior fica em `depende_de`.
"""

from __future__ import annotations

from .modelo import Ausentes, Coletor, Entradas, Fonte, Modo

# Mesmos valores de coletores._ORQ_ACTIONS e _ORQ_LOCAL, repetidos aqui porque coletores.py importa este módulo (integração).
_ORQ_ACTIONS = "etl.yml:run-due"  # .github/workflows/etl.yml:60-61 (ETL_TASKS_EXCLUDE só tira sapl.todas)
_ORQ_LOCAL = "launchd-local:run-due"  # etl/deploy/launchd-install.sh -> run-due-local.sh:16 (roda todas as TASKS, sem filtro)

# ibge_places.py:17
_IBGE_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades"
# ibge_populacao.py:17
_IBGE_POP = "https://servicodados.ibge.gov.br/api/v3/agregados/6579"
# ibge_malhas.py:23
_IBGE_MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas"
# governos_indicadores.py:26-27
_IBGE_AGREGADOS = "https://servicodados.ibge.gov.br/api/v3/agregados"
_BCB_SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{}/dados?formato=json&dataInicial={}&dataFinal={}"
# receita_arrecadacao.py:33
_URL_RECEITA = "https://www.gov.br/receitafederal/dados/arrecadacao-estado.csv"

_NAO_RECORTA = ("ano", "uf", "casa", "ibge")

COLETORES_C: tuple[Coletor, ...] = (
    Coletor(
        id="ibge.places",
        modulos=("jobs/ibge_places.py",),
        comandos=("ibge.places",),
        tarefas=("ibge.places",),
        fontes=(Fonte("ibge", "seed"),),  # jobs/seed.py:23
        datasets=("ibge.places",),  # ibge_places.py:25
        acesso=("api",),  # JSON da API de Localidades (ibge_places.py:21-22)
        entradas=Entradas(
            "estaticas",
            urls=(
                f"{_IBGE_LOCALIDADES}/estados?orderBy=nome",  # ibge_places.py:21
                f"{_IBGE_LOCALIDADES}/municipios?view=nivelado&orderBy=nome",  # ibge_places.py:22
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=_NAO_RECORTA,  # cli.py:118-120: só --force
        tabelas=("places", "legislative_bodies"),  # ibge_places.py:49 (places), :71 (legislative_bodies)
        # ibge_places.py:28, :36, :39: as linhas gravadas têm chave ibge_code de pais (BR), regiões, UFs e municípios;
        # o orquestrador decidiu "municipio" (grão mais fino) para o campo único do modelo
        territorio="municipio",
        ausentes=Ausentes("nao_apaga"),  # ibge_places.py: só upsert e update, sem delete
        encadeados=(),  # cli.py:118-120 não encadeia
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=True,  # test_caracterizacao.py: test_ibge_places
        tentativas_registradas=True,  # ibge_places.py:13 importa fetch de ..http
    ),
    Coletor(
        id="ibge.populacao",
        modulos=("jobs/ibge_populacao.py",),
        comandos=("ibge.populacao",),
        tarefas=("ibge.populacao",),
        fontes=(Fonte("ibge", "seed"),),  # jobs/seed.py:23
        datasets=("ibge.populacao",),  # ibge_populacao.py:34
        acesso=("api",),  # JSON da API de Agregados (ibge_populacao.py:22, :26)
        entradas=Entradas(
            "dinamicas",
            urls=(f"{_IBGE_POP}/periodos",),  # ibge_populacao.py:22
            depende_de=(
                f"{_IBGE_POP}/periodos/{{ano}}/variaveis/9324?localidades={{nivel}}[all] para nivel em N1, N3 e N6 (ibge_populacao.py:25-26), "
                "com {ano} = max(id) da lista de períodos (ibge_populacao.py:23); só aparecem depois da primeira leitura"
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=_NAO_RECORTA,  # cli.py:122-127: só --force
        tabelas=("places",),  # ibge_populacao.py:40-45 (update em places)
        # ibge_populacao.py:31, :39: a chave é BR (N1), a UF (N3) e o município (N6) em places.ibge_code; o orquestrador decidiu "municipio"
        territorio="municipio",
        ausentes=Ausentes("nao_apaga"),  # só update, sem delete
        encadeados=("seed",),  # cli.py:127-128: _seed(conn) depois de run_populacao
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=True,  # test_caracterizacao.py: test_ibge_populacao
        tentativas_registradas=True,  # ibge_populacao.py:14 importa fetch_json de ..http
    ),
    Coletor(
        id="ibge.malhas",
        modulos=("jobs/ibge_malhas.py",),
        comandos=("ibge.malhas",),
        tarefas=("ibge.malhas",),
        fontes=(Fonte("ibge", "seed"),),  # jobs/seed.py:23
        datasets=("ibge.malhas",),  # ibge_malhas.py:66 (run sem input_checksum)
        acesso=("api",),  # GeoJSON da API de Malhas (ibge_malhas.py:69, :77)
        entradas=Entradas(
            "dinamicas",
            urls=(f"{_IBGE_MALHAS}/paises/BR?formato=application/vnd.geo%2Bjson&intrarregiao=UF&qualidade=minima",),  # ibge_malhas.py:69
            depende_de=(
                f"{_IBGE_MALHAS}/estados/{{uf}}?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima por UF, com "
                "{uf} = codigo IBGE de cada linha de places com kind='uf' (lida do banco, ibge_malhas.py:64); ibge_malhas.py:77"
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=_NAO_RECORTA,  # cli.py:128-130: só --force
        tabelas=(),  # não grava tabela: grava web/public/geo/br.json e uf/{ibge}.json (ibge_malhas.py:3-5, :74, :84)
        territorio="nenhuma",  # a saída é arquivo, sem linha de banco
        ausentes=Ausentes("nao_apaga"),  # os arquivos são reescritos inteiros; não há delete no banco
        encadeados=(),
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=False,  # nenhum teste em test_caracterizacao.py chama run_malhas
        tentativas_registradas=True,  # ibge_malhas.py:20 importa fetch de ..http
    ),
    Coletor(
        id="governos.indicadores",
        modulos=("jobs/governos_indicadores.py",),
        comandos=("governos.indicadores",),
        tarefas=("governos.indicadores",),
        fontes=(Fonte("ibge-sidra", "migracao"), Fonte("bcb-sgs", "migracao")),  # db/migrations/0040_w4_indicators_taxes.sql:8 e :9
        datasets=("governos.indicadores", "governos.bcb"),  # governos_indicadores.py:90 e :97-100 (carimbo de dataset_stamps à mão)
        acesso=("api",),  # JSON das APIs do IBGE (SIDRA) e do BCB (SGS) (governos_indicadores.py:32-33, :69)
        entradas=Entradas(
            "dinamicas",
            urls=(),  # nenhuma URL é listável sem o ano corrente (orquestrador: lista vazia com depende_de)
            depende_de=(
                f"duas famílias, ambas dependentes do ano de execução (last_full = ano corrente - 1, governos_indicadores.py:46). "
                f"(1) SIDRA: {_IBGE_AGREGADOS}/<tabela>/periodos/<faixa de anos até last_full>/variaveis/<var>?localidades=N1[all] "
                "(governos_indicadores.py:49 pib anual 6784/9810; :52 pib trimestral 5932/6562 com classificação; :60 ipca 1737/2265; "
                ":64 desocupação 10379/4099); a faixa é uma única URL com todos os anos (_periods, :39). "
                f"(2) SGS: {_BCB_SGS} com uma URL por ano de 1999 até last_full (governos_indicadores.py:68-69; série 432)"
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=_NAO_RECORTA,  # cli.py:242-245: só --force
        tabelas=("w4_yearly_indicators",),  # governos_indicadores.py:93 (upsert)
        territorio="pais",  # localidades=N1[all] em todas as séries; a chave é indicador e ano (governos_indicadores.py:93)
        ausentes=Ausentes("nao_apaga"),  # só upsert, sem delete
        encadeados=(),  # cli.py:242-245 não encadeia
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=True,  # test_caracterizacao.py: test_governos_indicadores
        tentativas_registradas=True,  # governos_indicadores.py:23 importa fetch_json de ..http
    ),
    Coletor(
        id="receita.arrecadacao",
        modulos=("jobs/receita_arrecadacao.py",),
        comandos=("receita.arrecadacao",),
        tarefas=("receita.arrecadacao",),
        fontes=(Fonte("receita-federal", "migracao"),),  # db/migrations/0040_w4_indicators_taxes.sql:10
        datasets=("receita.arrecadacao",),  # receita_arrecadacao.py:103
        acesso=("arquivo",),  # CSV baixado (receita_arrecadacao.py:33, :99-100)
        entradas=Entradas("estaticas", urls=(_URL_RECEITA,)),  # receita_arrecadacao.py:33
        recortes_aceitos=(),
        recortes_nao_aceitos=_NAO_RECORTA,  # cli.py:246-248: só --force
        tabelas=("w4_tax_revenue",),  # receita_arrecadacao.py:105 (upsert)
        territorio="uf",  # chave year, month, uf, tax (receita_arrecadacao.py:105)
        ausentes=Ausentes("nao_apaga"),  # só upsert, sem delete
        encadeados=(),  # cli.py:246-248 não encadeia
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única, não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True),
        },
        caracterizado=True,  # test_caracterizacao.py: test_receita_arrecadacao
        tentativas_registradas=True,  # receita_arrecadacao.py:30 importa fetch de ..http
    ),
)
