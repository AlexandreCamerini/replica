"""Catálogo de coletores, lote A (R8a): tse.candidatos, tse.votos, tse.contas, sancoes.tcu, sancoes.cgu, transparencia.emendas, ale.custom e
sapl.assembleias. Cada campo foi conferido no código do job; `arquivo:linha` onde não é óbvio.

Este módulo importa só `.modelo` (nada de `civico_etl.jobs.*`, `civico_etl.cli` nem `.coletores`): `coletores.py` vai importar `COLETORES_A`
na integração, e importar `.coletores` daqui seria ciclo. As três constantes `_ORQ_*` são cópia das de `coletores.py` (o teste confere).
As URLs e dicionários copiados dos jobs (BASE, API, ALE_SAPL, LISTS...) são conferidos por AST em tests/test_catalogo_lote_a.py.

`ale.custom` e `sapl.assembleias` são ids propostos (comandos.COLETORES_PENDENTES: "o id é uma proposta, a confirmar na R8").
"""

from __future__ import annotations

from .modelo import Ausentes, Coletor, Entradas, Fonte, Modo

# ---------------------------------------------------------------- orquestradores (cópia de coletores.py:21-23; conferida por teste)
_ORQ_ACTIONS = "etl.yml:run-due"  # .github/workflows/etl.yml:60-61 (ETL_TASKS_EXCLUDE, :55, só tira sapl.todas)
_ORQ_LOCAL = "launchd-local:run-due"  # etl/deploy/launchd-install.sh -> run-due-local.sh:16 (roda todas as TASKS, sem filtro)
# run-due-sapl-prod.sh (ETL_TASKS_INCLUDE=sapl.todas) NÃO roda nenhuma tarefa deste lote: sapl.ales fica no Actions e no local (etl.yml:16).

# ---------------------------------------------------------------- URLs (copiadas dos jobs; conferidas por AST em teste)
_TSE = "https://cdn.tse.jus.br/estatistica/sead/odsele"  # tse_candidatos.py:34 e tse_votos_contas.py:32
_TSE_CAND = f"{_TSE}/consulta_cand/consulta_cand_{{ano}}.zip"  # tse_candidatos.py:204
_TSE_BENS = f"{_TSE}/bem_candidato/bem_candidato_{{ano}}.zip"  # tse_candidatos.py:209 (404 vira aviso, :210-212)
_TSE_VOTACAO = f"{_TSE}/votacao_candidato_munzona/votacao_candidato_munzona_{{ano}}.zip"  # tse_candidatos.py:570 (só com --votes) e tse_votos_contas.py:368
_TSE_CONTAS = f"{_TSE}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{{ano}}.zip"  # tse_votos_contas.py:446

_TCU = "https://contas.tcu.gov.br/ords/condenacao/consulta/inabilitados"  # sancoes.py:39
_TCU_ROBOTS = "https://contas.tcu.gov.br/robots.txt"  # allowed(url) -> assembleias._robots_rules -> H.fetch({base}/robots.txt) (assembleias.py:73; sancoes.py:81)

_TRANSP = "https://api.portaldatransparencia.gov.br/api-de-dados"  # transparencia.py:35

_ALESP = "https://www.al.sp.gov.br/repositorioDados"  # alesp.py:33
_ALESP_ROBOTS = "https://www.al.sp.gov.br/robots.txt"  # polite_fetch -> allowed (assembleias.py:123-126)
_ALMG = "https://dadosabertos.almg.gov.br/api/v2"  # almg.py:34
_ALMG_ROBOTS = "https://dadosabertos.almg.gov.br/robots.txt"
_ALMG_LISTAS = ("em_exercicio", "que_exerceram_mandato", "que_se_afastaram", "que_renunciaram", "que_perderam_mandato")  # almg.py:38, lidas em :161
_ALMG_TIPOS = ("PL", "PLC", "PEC", "PRE")  # chaves de almg.TYPES (:36); o total do ano por tipo é lido em :220

# sapl.py:80-86 (ALE_SAPL). Conferido por AST em teste: se uma ALE entrar no dicionário, o teste falha.
_ALE_SAPL = (
    ("RO", "https://sapl.al.ro.leg.br"),
    ("AC", "https://sapl.al.ac.leg.br"),
    ("AM", "https://sapl.al.am.leg.br"),
    ("PI", "https://sapl.al.pi.leg.br"),
    ("PB", "https://sapl.al.pb.leg.br"),
)

COLETORES_A: tuple[Coletor, ...] = (
    Coletor(
        id="tse.candidatos",
        modulos=("jobs/tse_candidatos.py",),  # importa tse_votos_contas só dentro de função, em SQ_COM_UE com --votes (tse_candidatos.py:553)
        comandos=("tse.candidatos",),
        tarefas=("tse.candidatos.recentes",),  # schedule.py:185: argv = tse.candidatos --all --year {ano-2} --year {ano}
        fontes=(
            Fonte("tse", "seed"),  # jobs/seed.py:19; é a fonte dos runs (tse_candidatos.py:216, :576)
            Fonte("tse-titulo", "seed"),  # jobs/seed.py:20; PersonResolver.create grava person_external_ids com ela (identity.py:572)
        ),
        datasets=(
            "tse.candidatos.{ano}",  # tse_candidatos.py:216
            "tse.votos.{ano}",  # tse_candidatos.py:576, só com --votes; o mesmo dataset de tse.votos (a tarefa agendada não passa --votes)
        ),
        acesso=("arquivo",),  # http.fetch do zip inteiro (tse_candidatos.py:204, :209); a extração é local, em CACHE_DIR/tse (:158-177)
        entradas=Entradas("estaticas", urls=(_TSE_CAND, _TSE_BENS, _TSE_VOTACAO)),  # a 3ª só com --votes; os anos vêm do recorte (ou do padrão da CLI)
        # --year e --uf são lidos (cli.py:135-136). --uf só escolhe os CSVs por UF dentro do zip nacional (_extract, :158-166): o zip é baixado inteiro.
        # --all, --votes e --force também são lidos, mas não são recorte (modo da carga).
        recortes_aceitos=("ano", "uf"),
        recortes_nao_aceitos=("casa", "ibge"),
        tabelas=(
            "elections", "contests", "candidacies", "mandates", "asset_declarations", "tse_titulo_candidatura",  # tse_candidatos.py:291, :297, :414, :464, :487, :525
            "identity_repair_log",  # só em registro substituído (:538)
            "people", "person_external_ids", "identity_match_queue",  # PersonResolver (:241): create identity.py:553; flush :583, :594
            "parties", "party_aliases",  # PartyResolver (:244): parties.py:60, :77
        ),
        # O lugar da disputa é BR (presidente), UF (governador, senador, deputados) ou município (prefeito, vereador): tse_candidatos.py:274-279.
        # O conjunto fechado não expressa isso; fica o nível mais fino.
        territorio="municipio",
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "candidatura que sumiu do arquivo NÃO é apagada. Só dois deletes, ambos por evento da própria carga: (1) registro substituído "
                "(INAPTO/#NULO#) que perdeu para o deferido ou eleito da mesma disputa e número: _drop_superseded apaga asset_declarations, mandates e "
                "candidacies dele (tse_candidatos.py:542-544) depois de gravar a cópia inteira em identity_repair_log (:538); (2) mandato regular de eleito "
                "numa eleição suplementar, com started_on diferente da data da suplementar (:438-442). Sem guarda de arquivo vazio, mas só age sobre o que "
                "a carga acabou de ler"
            ),
        ),
        encadeados=("derive.stats",),  # cli.py:218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),  # tarefa com needs_repairs: só roda se identity.repairs existir (schedule.py:540-542)
        env=None,
        modos={
            "descobrir": Modo(False, "um zip por ano em URL fixa (tse_candidatos.py:204); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True, "relê o zip do cache de disco e os CSVs já extraídos (CACHE_DIR); http.fetch ainda revalida por ETag, então não é sem rede"),
        },
        # Nenhum teste chama run_tse. test_identity_bug053.py:257 chama _load_year e test_tse_bug048.py:218, :234, :327, :343 chamam _load_votes (internas).
        caracterizado=False,
        tentativas_registradas=True,  # http.fetch (tse_candidatos.py:204, :209, :570)
    ),
    Coletor(
        id="tse.votos",
        modulos=("jobs/tse_votos_contas.py", "remotezip.py"),
        comandos=("tse.votos",),
        tarefas=("tse.votos",),  # schedule.py:186
        fontes=(Fonte("tse", "seed"),),  # jobs/seed.py:19; run(conn, "tse.votos.{ano}", "tse") em tse_votos_contas.py:376
        datasets=("tse.votos.{ano}",),
        acesso=("zip_remoto_por_faixa",),  # open_remote: HEAD + GET com Range na mesma URL, buffer de 8 MB, sem cópia local (remotezip.py:23, :56, :70-71)
        entradas=Entradas("estaticas", urls=(_TSE_VOTACAO,)),
        # Só --year e --force são lidos (cli.py:140). --uf é aceito pelo parser principal e ignorado (cli.py:136 só o passa a run_tse).
        recortes_aceitos=("ano",),
        recortes_nao_aceitos=("uf", "casa", "ibge"),
        tabelas=("candidacies", "candidacy_place_votes", "mandates"),  # update votes (:117, :133); upsert (:183); cassação: update status (:208, :219)
        territorio="municipio",  # candidacy_place_votes grava voto por (candidatura, município) (:183); candidacies.votes não tem place próprio
        ausentes=Ausentes("nao_apaga"),  # run_votes não tem delete; candidatura fora do arquivo fica com o valor que tinha
        encadeados=("derive.stats",),  # cli.py:218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "um zip por ano em URL fixa (tse_votos_contas.py:368); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(False, "lê o zip por HTTP Range e não guarda cópia em disco (remotezip.py:70-71): não há cache para reler"),
        },
        caracterizado=False,  # test_tse_bug048.py:161-168 monta o fluxo com aggregate_votes/_apply/_place_votes/_mark_cassados; nenhum chama run_votes
        tentativas_registradas=False,  # remotezip chama client().head/get direto (remotezip.py:23, :56), fora de http.fetch
    ),
    Coletor(
        id="tse.contas",
        modulos=("jobs/tse_votos_contas.py", "remotezip.py"),
        comandos=("tse.contas",),
        tarefas=("tse.contas",),  # schedule.py:187
        fontes=(Fonte("tse", "seed"),),  # jobs/seed.py:19; run(conn, "tse.contas.{ano}", "tse") em tse_votos_contas.py:456
        datasets=("tse.contas.{ano}",),
        acesso=("zip_remoto_por_faixa",),
        entradas=Entradas("estaticas", urls=(_TSE_CONTAS,)),
        recortes_aceitos=("ano",),  # cli.py:144; --uf aceito pelo parser e ignorado, como em tse.votos
        recortes_nao_aceitos=("uf", "casa", "ibge"),
        tabelas=("candidacies", "campaign_finance_entries", "campaign_finance_by_origin", "campaign_finance_donors"),  # :117/:133 (raised/spent), :408, :434, :435
        territorio="nenhuma",  # tudo pendurado em candidacy_id; nenhuma linha traz place (a receita/despesa não tem município nem UF)
        ausentes=Ausentes(
            "apaga",
            guarda=(
                "_origin_entries apaga de campaign_finance_by_origin e campaign_finance_donors as linhas com source_key 'tse:{ano}:%' que esta leitura não "
                "trouxe (tse_votos_contas.py:438), com nota do total. Só do ano lido. Única trava: o run falha, sem gravar nada, se as origens não somam o "
                "total arrecadado (:418-421); não há trava para leitura vazia (com `rows_` vazio o delete leva todo o ano). campaign_finance_entries não é apagada"
            ),
        ),
        encadeados=("derive.stats",),  # cli.py:218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "um zip por ano em URL fixa (tse_votos_contas.py:446); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(False, "lê o zip por HTTP Range e não guarda cópia em disco (remotezip.py:70-71): não há cache para reler"),
        },
        caracterizado=False,  # test_tse_bug048.py:171-178 usa aggregate_finance/_apply/_finance_entries/_origin_entries; nenhum chama run_finance
        tentativas_registradas=False,  # remotezip (ver tse.votos)
    ),
    Coletor(
        id="sancoes.tcu",
        modulos=("jobs/sancoes.py", "jobs/assembleias.py"),  # assembleias só por `allowed` (robots.txt, sancoes.py:74); o import altera http.RATE (assembleias.py:39)
        comandos=("sancoes.tcu",),
        tarefas=("sancoes.tcu",),  # schedule.py:204
        fontes=(Fonte("tcu", "seed"),),  # jobs/seed.py:25; run(conn, "sancoes.tcu_inabilitados", "tcu") em sancoes.py:169
        datasets=("sancoes.tcu_inabilitados",),
        acesso=("api",),  # API pública ORDS do TCU, sem chave, via http.fetch_json (sancoes.py:83)
        entradas=Entradas(
            "dinamicas",
            urls=(f"{_TCU}?limit=1000", _TCU_ROBOTS),  # sancoes.py:76; robots.txt lido por allowed (sancoes.py:81)
            depende_de=(
                "as páginas seguintes são o link rel=next de cada resposta, enquanto hasMore (sancoes.py:83-84); o número de páginas só se sabe lendo. "
                "Entre uma página e a próxima o job troca http.RATE por 1/CRAWL_DELAY (10 s, robots.txt do TCU; sancoes.py:77-87)"
            ),
        ),
        recortes_aceitos=(),  # o parser (sancoes.py:299) só tem --force; --year não existe nele
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
        tabelas=("sanctions",),  # upsert (sancoes.py:171); match() atualiza person_id e a nota (:131, :156, :161)
        territorio="nenhuma",  # sanctions guarda uf/municipality como texto da fonte, sem place; a chave é (source, source_key)
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "o que sumiu da lista do TCU é apagado (sancoes.py:176), só se a leitura trouxe ao menos uma linha (`if keys`, :175). "
                "Sem trava contra leitura truncada ou parcial (sem comparação com o que estava gravado, ao contrário de sancoes.cgu)"
            ),
        ),
        encadeados=(),  # sem encadeamento no main (sancoes.py:297-326); a agenda roda derive.stats depois (Task.derives=False)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única (um endpoint ORDS)"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True, "http.fetch_json com max_age de 1 dia (sancoes.py:83): dentro dele relê o cache; depois disso vai à rede"),
        },
        caracterizado=False,  # test_sancoes.py cobre parse_tcu e match; nenhum teste chama run_tcu
        tentativas_registradas=True,  # H.fetch_json -> fetch (sancoes.py:83) e robots via H.fetch (assembleias.py:73)
    ),
    Coletor(
        id="sancoes.cgu",
        modulos=("jobs/sancoes.py", "transparencia.py"),
        comandos=("sancoes.cgu",),
        tarefas=("sancoes.cgu",),  # schedule.py:207
        # Em dois lugares: jobs/seed.py:27 e db/migrations/0082_amendments_stages.sql:35-39 (on conflict do nothing). A migração diz por quê: "a produção não roda o
        # seed". Fica a migração, que é onde a linha nasce num banco só migrado.
        fontes=(Fonte("cgu", "migracao"),),
        datasets=("cgu.ceis", "cgu.cnep"),  # sancoes.py:265 (f"cgu.{kind}")
        acesso=("api",),  # API de dados do Portal da Transparência, com chave em header (transparencia.get_json -> http.api_json)
        entradas=Entradas(
            "dinamicas",
            urls=(f"{_TRANSP}/ceis?pagina=1", f"{_TRANSP}/cnep?pagina=1"),  # transparencia.get_json (:85-87): urlencode de {pagina}
            depende_de=(
                "páginas pagina=2..N até a primeira vazia (transparencia.iter_pages, :100-134); a API não informa total nem última página. "
                "Limite de taxa por minuto, maior de 00h às 06h (Brasília), em transparencia.rate_per_min"
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
        tabelas=("sanctions",),  # upsert (sancoes.py:270); match() (:131, :156, :161)
        territorio="nenhuma",  # a UF do DTO é a do órgão sancionador, texto sem place (sancoes.py:15-17, :222)
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "apaga o que não veio na leitura (sancoes.py:281) só com leitura NÃO truncada (state.truncated, :274), com ao menos uma pessoa física lida "
                "(:276) e com o lido (antes do filtro LGPD) pelo menos metade do que estava gravado (`len(parsed) * 2 < have`, :278); fora disso nada é apagado "
                "e o run leva a nota. Também sai o que o filtro LGPD deixou de aceitar (pessoa física sem nome civil igual ao de alguém em people)"
            ),
        ),
        encadeados=(),  # a agenda roda derive.stats depois (Task.derives=False)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),  # Actions: secrets.TRANSPARENCIA_API_KEY (etl.yml:54); local: variável ou arquivo de chave (schedule.py:491-501)
        env="TRANSPARENCIA_API_KEY",  # Task.needs_env (schedule.py:207) e SOURCE_ENV["cgu"] (:84). Sem a chave: exit 2 antes de abrir o banco (sancoes.py:306-309)
        modos={
            "descobrir": Modo(False, "dois endpoints fixos (ceis e cnep); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(False, "http.api_json não tem cache em disco (a resposta depende da chave e a paginação muda entre chamadas): não há o que reler"),
        },
        caracterizado=True,  # tests/test_sancoes.py:139-146 (_run_cgu chama S.run_cgu com dublê de run e de páginas)
        tentativas_registradas=False,  # http.api_json (transparencia.py:87), fora de http.fetch
    ),
    Coletor(
        id="transparencia.emendas",
        modulos=("jobs/transparencia_emendas.py", "transparencia.py"),
        comandos=("transparencia.emendas",),
        tarefas=("transparencia.emendas",),  # schedule.py:206
        fontes=(Fonte("transparencia", "migracao"),),  # db/migrations/0082_amendments_stages.sql:36 (e jobs/seed.py:26); ver a nota de sancoes.cgu
        datasets=("transparencia.emendas.{ano}",),  # transparencia_emendas.py:233
        acesso=("api",),  # transparencia.iter_pages("emendas", ...) -> get_json -> http.api_json (transparencia_emendas.py:227)
        entradas=Entradas(
            "dinamicas",
            urls=(f"{_TRANSP}/emendas?ano={{ano}}&pagina=1",),
            depende_de=(
                "páginas pagina=2..N de cada ano até a primeira vazia (transparencia.iter_pages); a API não informa total nem última página"
            ),
        ),
        recortes_aceitos=("ano",),  # transparencia.py:157 e transparencia_emendas.py:222 (padrão: FIRST_YEAR = 2023 até o ano corrente)
        recortes_nao_aceitos=("uf", "casa", "ibge"),
        tabelas=("amendments",),  # transparencia_emendas.py:243
        territorio="municipio",  # beneficiary_place_id (nulo quando a localidade não é um município inequívoco, build_rows) e beneficiary_uf
        ausentes=Ausentes("nao_apaga"),  # emenda que a fonte deixou de devolver é só contada na nota (transparencia_emendas.py:245-247); não há delete
        encadeados=(),  # a agenda roda derive.stats depois (Task.derives=False)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),  # ver sancoes.cgu: roda onde a chave existe
        env="TRANSPARENCIA_API_KEY",  # Task.needs_env (schedule.py:206) e SOURCE_ENV["transparencia"] (:84)
        modos={
            "descobrir": Modo(False, "um endpoint fixo (emendas) por ano; não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(False, "http.api_json não tem cache em disco (a resposta depende da chave e a paginação muda entre chamadas): não há o que reler"),
        },
        caracterizado=True,  # tests/test_emendas.py:170 e :216 (E.run_emendas com dublê de run e de páginas)
        tentativas_registradas=False,  # http.api_json
    ),
    Coletor(
        id="ale.custom",
        modulos=("jobs/ale_cli.py", "jobs/alesp.py", "jobs/almg.py", "jobs/assembleias.py"),  # o import de assembleias altera http.RATE (assembleias.py:39)
        comandos=("ale.sp", "ale.mg", "ale.todas"),
        tarefas=("ale.todas",),  # schedule.py:195: ale.todas --no-derive
        fontes=(
            Fonte("alesp", "job"),  # nasce em ensure_assembly (assembleias.py:320); ASSEMBLY em alesp.py:34. Não está no seed nem nas migrações
            Fonte("alemg", "job"),  # idem; almg.py:35
        ),
        datasets=("alesp.despesas.{ano}", "alesp.proposicoes.{ano}", "alemg.despesas.{ano}", "alemg.proposicoes.{ano}"),  # alesp.py:71, :136; almg.py:204, :247
        acesso=("arquivo", "api"),  # ALESP: XML e zip em repositorioDados (alesp.py:51, :66, :100-102); ALMG: API v2 JSON (almg.py)
        entradas=Entradas(
            "dinamicas",
            urls=(
                f"{_ALESP}/deputados/deputados.xml",  # alesp.py:51
                f"{_ALESP}/deputados/despesas_gabinetes_{{ano}}.xml",  # alesp.py:66
                f"{_ALESP}/processo_legislativo/naturezasSpl.xml",  # alesp.py:100
                f"{_ALESP}/processo_legislativo/proposituras.zip",  # alesp.py:101
                f"{_ALESP}/processo_legislativo/documento_autor.zip",  # alesp.py:102
                _ALESP_ROBOTS,
                *(f"{_ALMG}/deputados/{k}?formato=json" for k in _ALMG_LISTAS),  # almg.py:161
                *(f"{_ALMG}/proposicoes/pesquisa/direcionada?tipo={t}&ano={{ano}}&formato=json" for t in _ALMG_TIPOS),  # almg.py:220 (total do ano por tipo)
                _ALMG_ROBOTS,
            ),
            depende_de=(
                "ALESP (ale.sp) é totalmente listável: os 5 arquivos, a verba de cada ano e o robots.txt. ALMG (ale.mg, ale.todas) não: "
                f"{_ALMG}/deputados/{{id}} (almg.py:75), /prestacao_contas/verbas_indenizatorias/deputados/{{id}}/datas e .../{{ano}}/{{mes}} (:178, :189; ids vêm "
                "das cinco listas e só para anos >= 2023, ale_cli.py:45) e as consultas de proposições com janela de datas (ini/fim) dividida ao meio até caber em 20 "
                "resultados, mais &num= para dia com mais de 20 (almg.py:95-146, _window e _fill), cujo número depende das respostas"
            ),
        ),
        # O comando escolhe a UF (ale.sp, ale.mg, ale.todas); não há --uf (ale_cli.py:26-30). --year é lido (padrão 2019 até o ano corrente, :31).
        recortes_aceitos=("ano", "uf"),
        recortes_nao_aceitos=("casa", "ibge"),
        tabelas=(
            "expenses", "proposals", "proposal_authors",  # write_expenses (assembleias.py:432), write_proposals (:404, :420)
            "person_external_ids", "identity_match_queue",  # AssemblyMatcher.flush (:288, :292)
            "data_coverage",  # set_coverage (:338); reword_unread_coverage (:376), só em ale_cli
            "legislative_bodies",  # ensure_assembly: adapter = 'ale_custom' e open_data_url (:329)
            "sources",  # ensure_assembly: upsert da fonte (:320)
        ),
        territorio="uf",  # a casa é a Assembleia da UF (legislative_bodies.place_id = UF, assembleias.py:322-326)
        ausentes=Ausentes(
            "apaga",
            guarda=(
                "write_expenses apaga as despesas da casa e do ano que não vieram nesta leitura (assembleias.py:429) e write_proposals apaga todas as "
                "autorias da casa no ano antes de regravar (:409). Escopo: casa e ano. Sem guarda para leitura vazia: com lista vazia, o delete de "
                "despesas leva o ano inteiro da casa (`not (source_key = any('{}'))`)"
            ),
        ),
        encadeados=("derive.stats",),  # ale_cli.py:53-56, salvo --no-derive (a tarefa agendada passa --no-derive, schedule.py:195, e a agenda roda derive.stats depois)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "as duas casas são fixas (ADAPTERS = ('sp', 'mg'), ale_cli.py:20); não há descoberta"),
            "recoletar": Modo(True),
            "reprocessar": Modo(True, "http.fetch com cache de disco (ALMG usa max_age de 6 h a 30 dias, ALESP revalida por ETag); não é sem rede"),
        },
        caracterizado=False,  # test_assembleias.py cobre robots, fornecedor e rótulos; só ale.cobertura passa pela CLI (test_caracterizacao.py:1004); nenhum chama run_alesp/run_almg
        tentativas_registradas=True,  # polite_fetch/polite_json -> H.fetch (assembleias.py:126, :130)
    ),
    Coletor(
        id="sapl.assembleias",
        modulos=("jobs/sapl.py", "jobs/assembleias.py"),  # assembleias só pelo robots.txt (`allowed`, sapl.py:147)
        comandos=("sapl.ales",),
        tarefas=("sapl.ales",),  # schedule.py:199: sapl.ales --workers 5 --casa-max-min 40 (source="sapl-ale")
        fontes=(Fonte("sapl-ale", "job"),),  # nasce em discover_ales (sapl.py:650); ALE_SOURCE (:87). Não está no seed nem nas migrações
        datasets=("sapl-ale.descoberta", "sapl-ale.{uf}"),  # sapl.py:652 e house_ids (:103-107, uf em minúscula); {uf} é padrão novo, além de {ano} e {ibge}
        acesso=("api",),  # API REST do SAPL 3.x (DRF) de cada casa
        entradas=Entradas(
            "dinamicas",
            urls=tuple(u for uf, base in _ALE_SAPL for u in (f"{base}/api/", f"{base}/robots.txt")),  # sondagem (sapl.py:664) e robots (_get, :146-149)
            depende_de=(
                "as páginas da carga: {base}/api/{entidade}/?page_size=100&page=N (sapl.pages, :154-175), entidades parlamentares/legislatura, "
                "parlamentares/parlamentar, parlamentares/mandato, materia/materialegislativa, materia/autoria, base/autor, sessao/sessaoplenaria, "
                "sessao/sessaoplenariapresenca, sessao/votoparlamentar; filtros e número de páginas dependem do cursor em sapl_cursors, da legislatura "
                "vigente e das respostas. A casa só é carregada se a sondagem de {base}/api/ voltar 'ok' naquela execução"
            ),
        ),
        # --uf é lido (sapl.py:761). --ibge e --escopo são aceitos pelo parser; em sapl.ales o escopo vem só de --uf, e --ibge troca a fila de carga por todas as casas 'ok' do escopo, ignorando a idade mínima de recarga e o backoff (sapl.py:781-782).
        recortes_aceitos=("uf",),
        recortes_nao_aceitos=("ano", "casa", "ibge"),
        tabelas=(
            "sapl_houses", "sapl_cursors", "sapl_parlamentares", "sapl_mandatos", "sapl_materias", "sapl_autorias", "sapl_sessoes", "sapl_presencas",
            "sapl_votos", "data_coverage",  # sapl.py:362, :398, :449-558, :639
            "ingest_runs",  # insert direto, sem db.run (sapl.py:424)
            "legislative_bodies",  # discover_ales: adapter = 'sapl' e open_data_url (sapl.py:675)
            "sources",  # discover_ales: upsert (sapl.py:650)
        ),
        territorio="uf",  # sapl_houses.place_id = UF (sapl.py:648)
        ausentes=Ausentes("nao_apaga"),  # sapl.py não tem delete
        encadeados=(),  # sapl.py não roda derive.stats (a Task tem derives=True, schedule.py:199, sem que o job o chame)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),  # etl.yml:16: "sapl.ales (5 Assembleias, leve) continua aqui"; run-due-sapl-prod.sh só inclui sapl.todas
        env=None,
        modos={
            # sapl.ales sempre sonda /api/ das UFs do escopo (discover_ales, sapl.py:762) e em seguida carrega as casas 'ok' (:778). Nenhum comando só sonda
            # as Assembleias: sapl.descobrir cobre municípios (a lista de UF não passa por ele). Logo, "descobrir" e "recoletar" não são separáveis.
            "descobrir": Modo(False, "sapl.ales sempre sonda /api/ e carrega a casa na mesma execução (sapl.py:762, :778); não há comando que só sonde as Assembleias"),
            "recoletar": Modo(True, "sapl.ales: sonda /api/ e robots.txt das UFs do escopo e carrega as casas 'ok' (a fila, load_queue, decide quais)"),
            "reprocessar": Modo(True, "sem rede, refaz só a sondagem das casas (status e cobertura) a partir do cache de robots.txt e /api/; a carga de parlamentares, matérias e sessões só se refaz para casa fora do prazo de recarga de 6 dias (STALE_DAYS) e, nesse caso, depende de as páginas estarem no cache (as consultas incrementais por data mudam a cada dia); URL ausente do cache aborta a execução (SemRedeSemCache); reler o cache não reproduz a rodada original"),
        },
        caracterizado=False,  # test_sapl.py:282-289 só confere house_ids e ALE_SAPL; nenhum teste chama main, discover_ales ou load_house
        tentativas_registradas=True,  # _get -> H.fetch_json -> fetch (sapl.py:146-149)
    ),
)
