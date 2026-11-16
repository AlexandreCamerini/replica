"""Lote B do catálogo de coletores (R8b): os sete coletores do Congresso, conferidos no código.

senado.diario, senado.noturna, senado.secretas, agenda.congresso, pauta, parlamento.extras e camara.presenca. A integração em `COLETORES`
(coletores.py) e em `ADAPTADORES` é feita fora deste arquivo. Importar este módulo não importa nenhum job.

Placeholders das URLs de entrada (lidos pelos adaptadores de adaptadores_b.py; `{ano}` é o do recorte):
  {fim}                 dataFim de /votacao: o menor entre 31/12 do ano e hoje (senado_diario.py:74, :244)
  {inicio}              data ISO de início da janela (noturna, agenda, pauta)
  {mes}                 primeiro dia do mês, AAAAMMDD (agenda do plenário do Senado)
  {inicioAAAAMMDD}, {fimAAAAMMDD}   datas compactas da agenda de comissões do Senado (pauta)
  {cod}, {id}           dependem de uma leitura (lista de senadores/deputados); `descrever` não os expande
  {leg}                 camara.presenca: função pura do ano (_legs_for_year), expandida pelo adaptador; senado.diario: vem da lista atual (leitura)
"""

from __future__ import annotations

from .modelo import Ausentes, Coletor, Entradas, Fonte, Modo

# senado_diario.py:27, senado_extras.py:22-23, agenda_congresso.py:27-28, pauta.py:32-33, parlamento_extras.py:23-24, camara_presenca.py:33-34
SEN_API = "https://legis.senado.leg.br/dadosabertos"
SEN_ADM = "https://adm.senado.gov.br/adm-dadosabertos/api/v1"
CAM_API = "https://dadosabertos.camara.leg.br/api/v2"
CAM_FILES = "https://dadosabertos.camara.leg.br/arquivos"

URL_SEN_LISTA_ATUAL = f"{SEN_API}/senador/lista/atual.json"  # senado_diario.py:109; parlamento_extras.py:55
URL_SEN_VOTACAO_ANO = f"{SEN_API}/votacao?dataInicio={{ano}}-01-01&dataFim={{fim}}"  # senado_diario.py:76 (secretas) e :247 (diário, sem since)
URL_SEN_VOTACAO_JANELA = f"{SEN_API}/votacao?dataInicio={{inicio}}&dataFim={{fim}}"  # senado_diario.py:247 (noturna, com since)
URL_SEN_CEAPS = f"{SEN_ADM}/senadores/despesas_ceaps/{{ano}}"  # senado_extras.py:102
URL_AGENDA_CAMARA = f"{CAM_API}/eventos?idOrgao=180&dataInicio={{inicio}}&dataFim={{fim}}&itens=100"  # agenda_congresso.py:199 (PLEN_CAMARA = 180, :29)
URL_AGENDA_SENADO_MES = f"{SEN_API}/plenario/agenda/mes/{{mes}}.json"  # agenda_congresso.py:221
URL_PAUTA_CAMARA = f"{CAM_API}/eventos?dataInicio={{inicio}}&dataFim={{fim}}&itens=100&ordem=ASC&ordenarPor=dataHoraInicio"  # pauta.py:134
URL_PAUTA_SENADO_MES = URL_AGENDA_SENADO_MES  # pauta.py:186 (mesma rota da agenda do plenário)
URL_PAUTA_SENADO_COMISSOES = f"{SEN_API}/comissao/agenda/{{inicioAAAAMMDD}}/{{fimAAAAMMDD}}.json"  # pauta.py:211
URL_PRESENCA_EVENTOS = f"{CAM_FILES}/eventos/csv/eventos-{{ano}}.csv"  # camara_presenca.py:104
URL_PRESENCA_ORGAOS = f"{CAM_FILES}/eventosOrgaos/csv/eventosOrgaos-{{ano}}.csv"  # camara_presenca.py:105
URL_PRESENCA_LISTA = f"{CAM_FILES}/eventosPresencaDeputados/csv/eventosPresencaDeputados-{{ano}}.csv"  # camara_presenca.py:106
URL_PRESENCA_ROSTER = f"{CAM_API}/deputados?idLegislatura={{leg}}&itens=100&ordem=ASC&ordenarPor=nome"  # camara_presenca.py:99

# Mesmos valores de coletores._ORQ_ACTIONS e _ORQ_LOCAL, repetidos aqui para este módulo não importar coletores.py (a integração fará coletores.py importar
# este módulo; importar nos dois sentidos seria circular). test_catalogo_lote_b.py confere a igualdade.
_ORQ_ACTIONS = "etl.yml:run-due"  # .github/workflows/etl.yml:60-61 (ETL_TASKS_EXCLUDE só tira sapl.todas)
_ORQ_LOCAL = "launchd-local:run-due"  # etl/deploy/launchd-install.sh -> run-due-local.sh:16 (roda todas as TASKS, sem filtro)

# Orquestradores da pauta: fora do run-due (sem tarefa em schedule.TASKS). O `all` da CLI também a roda (cli.py:222), mas `all` não é orquestrador.
_ORQ_PAUTA_ACTIONS = "etl-pauta.yml:pauta"  # .github/workflows/etl-pauta.yml:63 (`civico-etl pauta`, a cada 30 min em horário comercial)
_ORQ_PAUTA_LOCAL = "agendar-local.sh:pauta"  # etl/agenda/agendar-local.sh:67 (launchd, StartInterval 1800 s)

# Os seis módulos só lêem por http.fetch/fetch_json/paginate_camara. `httpx` aparece apenas em `except` (pauta.py:151, :163, :187, :212;
# camara_presenca.py:58); nenhum usa http.api_json, remotezip, urllib nem client() direto.

COLETORES_B: tuple[Coletor, ...] = (
    Coletor(
        id="senado.diario",
        modulos=("jobs/senado_diario.py", "jobs/senado_extras.py"),  # run_senado (:101) chama sx.drop_derived_attendance, filiacoes, autorias, ceaps (:207-213)
        comandos=("senado.diario",),
        tarefas=("senado.diario",),
        fontes=(Fonte("senado", "seed"),),  # jobs/seed.py:22; o CEAPS (adm.senado.gov.br) também grava com a fonte 'senado' (senado_extras.py:107)
        datasets=("senado.senadores", "senado.votacoes.{ano}", "senado.autorias", "senado.despesas.{ano}"),  # :113, :202, senado_extras.py:64, :107
        acesso=("api",),
        entradas=Entradas(
            "dinamicas",
            urls=(URL_SEN_LISTA_ATUAL, URL_SEN_VOTACAO_ANO, URL_SEN_CEAPS),
            depende_de=(
                f"{SEN_API}/senador/{{cod}}.json (detalhe, :118), /senador/{{cod}}/filiacoes.json (senado_extras.py:44) e /senador/{{cod}}/autorias.json "
                "(senado_extras.py:68) saem de {cod}, que vem da lista atual (os dois últimos só sem --limit, :210); "
                f"{SEN_API}/senador/lista/legislatura/{{leg}}.json (:159) depende de {{leg}}, tirado da lista atual (_current_legislature), só sem --limit; "
                "dentro dela, /senador/{cod}.json (:179) de titular fora de exercício sem pessoa já ligada no banco. "
                "O CEAPS do ano que ainda não existe (404) é pulado com aviso (senado_extras.py:103-105)"
            ),
        ),
        # --uf e --no-expenses são aceitos pelo parser principal (cli.py:87-) e ignorados por este comando (cli.py:201 só lê year, limit e force);
        # --limit não é recorte: corta a lista de senadores (:110) e, quando dado, também pula legislatura, filiações e autorias (:158, :210)
        recortes_aceitos=("ano",),
        recortes_nao_aceitos=("uf", "casa", "ibge"),
        # people, person_external_ids e identity_match_queue: PersonResolver (:102, :125-135, :193; identity.py:553, :581, :592); parties e party_aliases:
        # PartyResolver (:103, :139; parties.py:60, :77); attendance só sofre delete (senado_extras.py:33)
        tabelas=("people", "person_external_ids", "identity_match_queue", "parties", "party_aliases", "mandates", "party_observations", "sessions",
                 "proposals", "voting_events", "votes", "proposal_authors", "expenses", "attendance"),
        # território: mesmo critério de camara.diario (casa federal = país), embora o mandato do senador leve o lugar da UF (:124, :151)
        territorio="pais",
        ausentes=Ausentes(
            "apaga",
            guarda=(
                "senado_extras.py:33 (chamado em senado_diario.py:209, a cada rodada e também com --limit) apaga TODA a presença (attendance) de TODAS as "
                "sessões do Senado e zera sessions.is_deliberative (:34), com commit logo depois (:35), fora de qualquer db.run; não depende do que a fonte "
                "trouxe (resíduo da presença derivada de voto, D01). Nenhum outro delete nos dois módulos: mandato, voto, despesa e autoria que somem da "
                "fonte ficam no banco. Titular fora da lista de exercício não é apagado: recebe status (renunciou, cassado, encerrado, licenciado ou "
                "afastado) pela lista da legislatura, só sem --limit (:158-192); o que acontece com suplente que sai da lista não está nestes módulos"
            ),
        ),
        encadeados=("identity.dedupe", "derive.stats"),  # cli.py:214 e :218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "a lista de senadores em exercício é lida a cada rodada; não há fase de descoberta separada"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar. Só o run do CEAPS leva checksum (senado_extras.py:107): com a mesma entrada ele pula; senadores, votações e "
                "autorias abrem run sem checksum (:113, :202, senado_extras.py:64) e regravam sempre. --force só atua no CEAPS (nem senadores nem "
                "votações recebem force) e não entra no argv do adaptador",
            ),
        },
        caracterizado=False,  # nenhum teste chama run_senado: test_senado_secretas.py só chama _is_secret; test_camara_fuso.py lê o fonte
        tentativas_registradas=True,
    ),
    Coletor(
        id="senado.noturna",
        modulos=("jobs/senado_diario.py",),
        comandos=("senado.noturna",),
        tarefas=("senado.noturna",),  # janela ter-sáb 00:30-02:00 BRT (schedule.py:180); nenhum campo da tarefa é duplicado aqui
        fontes=(Fonte("senado", "seed"),),
        datasets=("senado.noturna.{ano}",),  # senado_diario.py:229; dataset próprio, como a Câmara (docstring :216-219)
        acesso=("api",),
        # Os anos e as datas vêm do relógio, não do recorte: since = hoje (BRT, :225) - 3 dias; um ano por ano de since e de hoje (:227); dataInicio =
        # max(since, 1º/1) (:230); dataFim = min(31/12, date.today()) (:244). Listável sem rede e sem banco a partir da data.
        entradas=Entradas("estaticas", urls=(URL_SEN_VOTACAO_JANELA,)),
        recortes_aceitos=(),
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),  # cli.py:197 só lê force; --year, --uf e --limit são aceitos pelo parser e ignorados
        # sem PersonResolver nem PartyResolver: senadores e partido atual vêm do banco (:222-224); party_id do voto = person_current_party
        tabelas=("sessions", "proposals", "voting_events", "votes"),
        territorio="pais",
        ausentes=Ausentes("nao_apaga"),  # nenhum delete em run_senado_noturna nem em _votes_year
        encadeados=(),  # a CLI não encadeia; a agenda roda derive.stats depois (Task.derives=False)
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única (/votacao); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar. O run não leva checksum (:229): sempre regrava; a janela é relativa a hoje (últimos 3 dias) e a leitura do recorte "
                "noturno não usa cache de 1 dia (max_age=None, :247), então não há como reler uma rodada passada",
            ),
        },
        caracterizado=False,  # nenhum teste chama run_senado_noturna nem _votes_year; test_schedule.py só cobre a janela da tarefa
        tentativas_registradas=True,
    ),
    Coletor(
        id="senado.secretas",
        modulos=("jobs/senado_diario.py",),
        comandos=("senado.secretas",),
        tarefas=("senado.secretas",),  # a tarefa passa --year do ano corrente (schedule.py:192)
        fontes=(Fonte("senado", "seed"),),
        datasets=("senado.secretas.{ano}",),  # senado_diario.py:80
        acesso=("api",),
        # /votacao do ano inteiro, com dataFim = min(31/12, hoje) (:74, :76): função do ano e da data, listável sem rede e sem banco
        entradas=Entradas("estaticas", urls=(URL_SEN_VOTACAO_ANO,)),
        # --year repetível (cli.py:205); sem --year a CLI usa range(2019, ano+1) (cli.py:205), diferente do que a tarefa roda (só o ano corrente)
        recortes_aceitos=("ano",),
        recortes_nao_aceitos=("uf", "casa", "ibge"),  # --uf e --limit são aceitos pelo parser e ignorados (cli.py:205 só lê year e force)
        tabelas=("voting_events",),  # só UPDATE de is_secret por source_key (:83-88); não regrava votos
        territorio="pais",
        ausentes=Ausentes("nao_apaga"),  # sem delete; evento da fonte que não está no banco vira rejeição anotada, não é criado (:92-94)
        encadeados=(),
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "fonte única (/votacao); não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar. O run não leva checksum (:80): sempre refaz o UPDATE (idempotente) e nunca fecha como skipped_unchanged; "
                "a leitura usa cache de 1 dia (max_age=86400, :76)",
            ),
        },
        caracterizado=False,  # test_senado_secretas.py chama só _is_secret e confere contagem no banco; nenhum teste chama run_secretas
        tentativas_registradas=True,
    ),
    Coletor(
        id="agenda.congresso",
        modulos=("jobs/agenda_congresso.py",),
        comandos=("agenda.congresso",),
        tarefas=("agenda.congresso",),
        fontes=(Fonte("camara", "seed"), Fonte("senado", "seed")),  # run_camara_agenda abre run em 'camara' (:197), run_senado_agenda em 'senado' (:220)
        datasets=("agenda.camara.{YYYYMMDD}-{YYYYMMDD}", "agenda.senado.{YYYYMM}"),  # :197 (um por janela) e :220 (um por mês da janela)
        acesso=("api",),
        entradas=Entradas(
            "dinamicas",
            urls=(URL_AGENDA_CAMARA, URL_AGENDA_SENADO_MES),
            depende_de=(
                "a janela vem do recorte (--year: 1/1 a 31/12 de cada ano) ou, sem --year, da data de hoje: 1º dia do mês passado até o fim do mês seguinte "
                "(window, :55-61); a 1ª página dos eventos da Câmara e os meses do Senado são listáveis a partir dela, mas as páginas seguintes (links rel=next, "
                f"paginate_camara) e {CAM_API}/eventos/{{id}}/pauta (:202, um por evento lido) só existem depois de ler a lista de eventos"
            ),
        ),
        recortes_aceitos=("ano",),  # run_agenda(years=a.year) (cli.py:209); --year repetível: uma janela anual por ano (:57)
        recortes_nao_aceitos=("uf", "casa", "ibge"),  # --uf, --limit e --no-expenses são aceitos pelo parser e ignorados
        tabelas=("agenda_events", "agenda_items"),  # agenda_events.session_id também é atualizado (:166-170)
        territorio="pais",
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "agenda_congresso.py:190 apaga os agenda_items de um evento que somem da pauta publicada agora, só de evento relido com sucesso "
                "(items None = pauta com erro mantém a anterior, :176-177 e :206-208; a lista 'refreshed' vale só para eles, :184-189). A guarda não cobre o "
                "404 da pauta da Câmara (:204-205): vira items=[] e apaga todos os itens do evento; nem sessão do Senado sem matérias (senado_items vazio). "
                "agenda_events nunca é apagado"
            ),
        ),
        encadeados=(),
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "janela de datas sobre duas APIs; não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar. Os runs não levam checksum (:197, :220): sempre regravam, mesmo com a mesma entrada; sem --year a janela é relativa a hoje, "
                "então reprocessar uma janela passada exige --year",
            ),
        },
        caracterizado=False,  # test_agenda.py cobre só funções puras (window, months, camara_event, ...); nenhum teste chama run_agenda
        tentativas_registradas=True,
    ),
    Coletor(
        id="pauta",
        modulos=("jobs/pauta.py",),
        comandos=("pauta",),
        tarefas=(),  # sem tarefa em schedule.TASKS: roda no workflow etl-pauta.yml e em etl/agenda/agendar-local.sh, fora do run-due
        fontes=(Fonte("camara", "seed"), Fonte("senado", "seed")),  # _camara abre run em 'camara' (:132), _senado em 'senado' (:179)
        datasets=("pauta.camara", "pauta.senado"),
        acesso=("api",),
        entradas=Entradas(
            "dinamicas",
            urls=(URL_PAUTA_CAMARA, URL_PAUTA_SENADO_MES, URL_PAUTA_SENADO_COMISSOES),
            depende_de=(
                "a janela é hoje (BRT, :84) até hoje + 14 dias (WINDOW_DAYS, :35); {mes} = 1º dia do mês de cada ponta da janela (:183). Dependem de leituras: "
                f"as páginas seguintes dos eventos da Câmara (paginate_camara), {CAM_API}/eventos/{{id}}/pauta (:150, só evento deliberativo marcado ou em andamento) e "
                f"{CAM_API}/proposicoes/{{id}}/temas (:162, uma por proposição de lei)"
            ),
        ),
        recortes_aceitos=(),
        recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),  # cli.py:225 chama run_pauta(conn) sem argumento: --year, --uf, --limit e --force são ignorados
        tabelas=("pauta_reads", "pauta_events", "pauta_items"),  # uma linha nova em pauta_reads por casa a cada rodada (:94-99)
        territorio="pais",
        ausentes=Ausentes("nao_apaga"),  # sem delete: cada rodada acrescenta uma leitura; o que sai da pauta é visto pela comparação entre leituras
        encadeados=(),
        orquestradores=(_ORQ_PAUTA_ACTIONS, _ORQ_PAUTA_LOCAL),  # não está no run-due (nem no Actions nem no launchd-local run-due)
        env=None,
        modos={
            "descobrir": Modo(False, "janela de datas sobre duas APIs; não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                False,
                "repetir o comando é uma leitura nova (insert em pauta_reads, :94-99, a cada rodada; run sem checksum, :132 e :179), nunca o reprocessamento de uma "
                "leitura anterior; a janela é hoje..hoje+14 sem argumento de data (a CLI não passa today a run_pauta) e o dado lido não fica reaproveitável",
            ),
        },
        caracterizado=False,  # test_pauta.py cobre só funções puras (resolve_camara_item, parse_senado_name, event_state); nenhum teste chama run_pauta
        tentativas_registradas=True,
    ),
    Coletor(
        id="parlamento.extras",
        modulos=("jobs/parlamento_extras.py",),
        comandos=("parlamento.extras",),
        tarefas=("parlamento.extras",),
        # o run é aberto na fonte 'camara' (:51), mas o job grava contato com o source_id do senado (:93-98) e lê a API do Senado; as duas fontes ficam
        # declaradas (a confirmar pelo dono: o carimbo do dataset vai só para 'camara')
        fontes=(Fonte("camara", "seed"), Fonte("senado", "seed")),
        datasets=("parlamento.extras",),
        acesso=("api",),
        entradas=Entradas(
            "dinamicas",
            urls=(URL_SEN_LISTA_ATUAL,),
            depende_de=(
                "lista dos mandatos em exercício no banco (parlamento_extras.py:44-49: mandates.status = 'em_exercicio' nas casas camara_deputados e senado, com o id "
                f"externo da casa); por deputado: {CAM_API}/deputados/{{id}}, /deputados/{{id}}/orgaos?dataInicio={{since}}&itens=100 (paginada) e "
                "/deputados/{id}/discursos?dataInicio={since}&dataFim={hoje}&itens=100&ordenarPor=dataHoraInicio&ordem=DESC (paginada); "
                f"por senador: {SEN_API}/senador/{{cod}}/comissoes.json e /senador/{{cod}}/discursos.json?dataInicio={{since}}&dataFim={{hoje}}; "
                "{since} = 1/1 do MENOR --year ou, sem --year, 1/1 do ano anterior. A lista atual do Senado só é lida se há senador na lista do banco (:54)"
            ),
        ),
        # --year é aceito, mas só o MENOR vale: since = date(min(year), 1, 1) (cli.py:213); os demais anos são ignorados sem aviso. O adaptador recusa 2 ou mais anos
        recortes_aceitos=("ano",),
        recortes_nao_aceitos=("uf", "casa", "ibge"),  # --uf e --limit são aceitos pelo parser e ignorados (cli.py:213 só lê year e force)
        tabelas=("mandate_contacts", "committees", "committee_memberships", "speeches"),
        territorio="pais",
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "parlamento_extras.py:125 apaga os contatos (mandate_contacts) de fonte camara OU senado de todo mandato que teve ao menos um contato na rodada "
                "(mids, :123-124): a guarda é 'mandato com contato novo', não a fonte do contato (contato do senado de um mandato com contato novo da câmara também sai). "
                "Contato de outra fonte e de mandato sem contato na rodada sobrevive. O 404 de um parlamentar vira rejeição (:117-118), mas o try cobre o bloco inteiro: só o 404 do "
                "detalhe do deputado (:62) acontece antes de qualquer contato e não apaga nada; 404 em órgãos, discursos ou comissões (:76, :82, :99, :108) vem depois de os contatos "
                "do mandato entrarem em `contacts` (:64-75, :92-98), e o delete de :125 roda para ele. "
                "Comissão, participação e discurso que somem da entrada continuam no banco (sem delete)"
            ),
        ),
        encadeados=("derive.stats",),  # cli.py:218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "a lista de parlamentares vem dos mandatos em exercício do banco; não há fase de descoberta"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar. O run abre sem checksum (:51): não existe 'entrada inalterada', todo run fecha succeeded e regrava; as leituras usam cache de "
                "1 dia (max_age=86400) e a data de hoje entra nas URLs de discursos (dataFim)",
            ),
        },
        caracterizado=True,  # tests/test_caracterizacao.py::test_parlamento_extras roda `parlamento.extras --year 2025` pela CLI (run_extras) com dublê de rede
        tentativas_registradas=True,
    ),
    Coletor(
        id="camara.presenca",
        modulos=("jobs/camara_presenca.py",),
        comandos=("camara.presenca",),
        tarefas=("camara.presenca",),
        fontes=(Fonte("camara", "seed"),),
        datasets=("camara.presenca.{ano}",),  # camara_presenca.py:113
        acesso=("arquivo", "api"),  # três CSV anuais (arquivos) mais a API v2 de deputados (lista por legislatura e /historico)
        entradas=Entradas(
            "dinamicas",
            urls=(URL_PRESENCA_EVENTOS, URL_PRESENCA_ORGAOS, URL_PRESENCA_LISTA, URL_PRESENCA_ROSTER),
            depende_de=(
                "{leg} = _legs_for_year(ano) sobre LEG_START (:36-43): função pura do ano, expandida pelo adaptador (só a 1ª página da lista, paginate_camara); "
                f"dependem de leitura: as páginas seguintes dessa lista e {CAM_API}/deputados/{{id}}/historico (:55), lido por deputado, com {{id}} tirado da lista por "
                "legislatura e do CSV de presença do ano, restritos aos que existem em person_external_ids (:130-131), ou seja, do conteúdo dos CSV e do banco; "
                "ano ainda sem os três CSV (404) é pulado (:107-109)"
            ),
        ),
        recortes_aceitos=("ano",),  # run_presenca(years=a.year or [ano-1, ano]) (cli.py:185)
        recortes_nao_aceitos=("uf", "casa", "ibge"),  # --uf e --limit são aceitos pelo parser e ignorados (cli.py:185 só lê year e force)
        tabelas=("sessions", "attendance", "party_observations", "parties", "party_aliases"),  # parties e party_aliases: parties.get no /historico (:66)
        territorio="pais",
        ausentes=Ausentes(
            "apaga_com_guarda",
            guarda=(
                "camara_presenca.py:153-156 apaga TODA a presença (attendance) das sessões da Câmara do ano e regrava na mesma transação do run (:157): só chega ao delete "
                "quem tem os três CSV do ano (404 -> continue, :107-109) e entrada com checksum diferente do último run succeeded (:111-113). Sem guarda para lista vazia "
                "(sem linhas, o ano fica sem presença) nem para deputado cujo /historico falhou (intervals None, :58-60 e :144-145): o registro anterior dele no ano sai e "
                "não volta nesta rodada (com checksum igual, a seguinte pula; volta quando o checksum mudar e o /historico responder). :159-162 também zera is_deliberative das sessões do ano que não são deliberativas do Plenário"
            ),
        ),
        encadeados=("derive.stats",),  # cli.py:218
        orquestradores=(_ORQ_ACTIONS, _ORQ_LOCAL),
        env=None,
        modos={
            "descobrir": Modo(False, "arquivos anuais e API de deputados por ano; não há o que descobrir"),
            "recoletar": Modo(True),
            "reprocessar": Modo(
                True,
                "mesmo argv de recoletar, desde que o cache tenha os três CSV do ano e o /historico de cada deputado. O run leva checksum dos três CSV + ':regra2' (:111): "
                "com a mesma entrada o db.run pula (skipped_unchanged); o que não pula é --force, que não entra no argv do adaptador",
            ),
        },
        caracterizado=False,  # test_camara_starts_at.py e test_camara_fuso.py leem o fonte; nenhum teste chama run_presenca
        tentativas_registradas=True,
    ),
)
