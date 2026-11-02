# Recon map: Politicômetro (web, mobile-first)

Scope: núcleo cívico — mapa/busca → "quem me representa" → crachá do político → comparar → monitorar.
Congresso, STF, Governos, Eleições e Impostômetro entram como módulos should/could.
For: premissa (não declarada pelo usuário) — produto cívico próprio, não comercial, mesmo público (eleitor comum, leigo).
Date: 2026-11-01

Premissas assumidas:
- Plataforma: web responsiva (o original é web-only, sem app nas lojas).
- Recon feito só com páginas públicas, em velocidade humana, sem login. Não li bundles JS nem chamadas de rede.
- A conta do usuário não foi usada: `/acompanhando` redireciona para login por OTP e ficou como "visto só o gate".
- O site é não-comercial e não encontrei termos que proíbam uso; mesmo assim o clone **não** deve consumir dados do Politicômetro. Todo dado vem das fontes oficiais que ele cita (TSE, Câmara, Senado etc.).

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | home / mapa | https://www.politicometro.org/ | contadores, mapa com camadas, diretório A–Z |
| 2 | crachá (perfil) | https://www.politicometro.org/p/tabata-amaral | tela central; ~20 seções |
| 3 | crachá degradado | https://www.politicometro.org/p/fernanda-souto | vereadora: "faltam 3 dados", câmara sem carga |
| 4 | quem me representa | https://www.politicometro.org/representantes | busca de cidade/estado, diagrama de níveis |
| 5 | representantes da cidade | https://www.politicometro.org/representantes?cidade=3509502 | chave = código IBGE do município |
| 6 | comparar | https://www.politicometro.org/comparar?p=astronauta-marcos-pontes,giordano,mara-gabrilli | 2–5 pessoas, tabela + "votaram igual?" |
| 7 | metodologia e fontes | https://www.politicometro.org/sobre | regras de neutralidade, presença, temas, lacunas — spec de produto quase pronta |
| 8 | quem publica dados | https://www.politicometro.org/dados-abertos | matriz de cobertura por estado/cidade |
| 9 | MCP (em breve) | https://www.politicometro.org/mcp | lista de 10 ferramentas = superfície de API pública declarada |
| 10 | congresso | https://www.politicometro.org/congresso | hemiciclo, agenda, pauta, votações |
| 11 | partidos | https://www.politicometro.org/partidos | espectro esquerda–direita, governismo |
| 12 | governos | https://www.politicometro.org/governos | mandatos presidenciais lado a lado |
| 13 | planos de governo | https://www.politicometro.org/propostas | comparação de planos (TSE) por tema |
| 14 | eleições | https://www.politicometro.org/eleicoes | resultados 1994–2026, apuração ao vivo |
| 15 | STF | https://www.politicometro.org/stf | pauta, ministros, processos |
| 16 | impostômetro | https://www.politicometro.org/impostos | arrecadação federal (Receita) |
| 17 | mais vistos | https://www.politicometro.org/mais-vistos | analytics públicos em tempo real |
| 18 | cargos / dicionário | https://www.politicometro.org/cargos · https://www.politicometro.org/dicionario | conteúdo educativo (213 termos) |
| 19 | entrar | https://www.politicometro.org/entrar | login por código no e-mail, sem senha |
| 20 | sugestões / ajudar | https://www.politicometro.org/sugestoes · https://www.politicometro.org/ajudar | crowdsourcing de fontes e erros |
| 21 | fonte oficial: TSE dados abertos | https://dadosabertos.tse.jus.br/ | candidatos, bens, votação, prestação de contas, planos de governo |
| 22 | fonte oficial: Câmara | https://dadosabertos.camara.leg.br/swagger/api.html | deputados, presença, proposições, votos, cota, discursos, comissões |
| 23 | fonte oficial: Senado | https://legis.senado.leg.br/dadosabertos/docs/ | senadores, votações nominais, matérias |
| 24 | fonte oficial: Portal da Transparência | https://portaldatransparencia.gov.br/api-de-dados | emendas parlamentares, cartão corporativo |
| 25 | mapa base | https://github.com/VictorCazanave/svg-maps/tree/master/packages/brazil | SVG CC BY 4.0, reutilizável com atribuição |

Sem app store, sem changelog público além de `/atualizacoes` (não lido), sem pricing (gratuito).

## Core loop

Eleitor digita a cidade (ou toca no mapa), vê todo mundo que o representa do vereador ao presidente, e abre o crachá com salário, presença, votos, propostas e gastos — tudo com fonte e data, sem nota nem ranking.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home / Mapa | `/` | porta de entrada: contadores, mapa, diretório | HeroCounter, LivePresence, OfficeCountStrip, LayerTabs (Quem governa, Contas, Escolas, Obras, Dinheiro que chegou, Votações), BrazilMap (região→UF→cidade, Esc volta), RegionList, AZDirectory, SourceFooter | filled, dark |
| S02 | Onboarding | modal na 1ª visita (visto em `/representantes`) | explicar o loop em 3 passos | Modal, StepList, CTA "Achar minha cidade", "Pular" | first-visit |
| S03 | Busca global | lupa no header | achar político, cidade, estado ou cargo | Combobox "Político, cidade, estado ou cargo", ResultGroups | (não aberto; inferido do input) |
| S04 | Quem é quem | `/quem` | diretório filtrável de 71.649 pessoas | TextFilter, OfficeChips, StateSelect, PartySelect, AZIndex, PersonCard, "Ver todos N com X" | filled |
| S05 | Crachá | `/p/:slug` | tudo sobre uma pessoa | ProfileHeader (foto, cargo, partido, idade, naturalidade, badges de eleição), MandateCards (em exercício / eleito aguardando posse), StatTiles (salário, recebido, cota, patrimônio, votos, campanha, presença, propostas), YearSelector, YearSummary, ProposalList (filtros ano/tema/tipo/autoria + busca), LawsTimeline, VoteTimeline (Sim/Não/Abst./Não votou + tema), AmendmentsBreakdown, PresenceChart, YearByYearTable, ExpenseBreakdown (categoria, fornecedor), Committees, Speeches, Travels, StaffTable, CampaignFinance (origem/gastos por eleição), Contact, MandateTimeline, AssetsChart, MandateCost, CivilData, CoverageNote, Monitorar, CompartilharCard, ReportarErro, OuvirPagina | filled (deputada federal), degraded (vereadora: "faltam 3 dados", "teto do salário", câmara "carregando em breve"), empty-section ("nenhum registro") |
| S06 | Quem me representa | `/representantes` | escolher lugar | CityStateCombobox (autocomplete com "cidade · UF"/"estado inteiro"), ExampleChips, LevelDiagram (cidade/estado/Brasília), CompareSearch | empty, autocomplete open |
| S07 | Representantes do lugar | `/representantes?cidade=<IBGE>` | todos os que representam a cidade | HeadCount, ActionChips (Ver no mapa, Eleições, Ver UF inteiro), PersonGrid por nível (prefeito/vice, vereadores N, dep. estaduais, senadores, dep. federais, presidente), "+ Comparar", "Ver os outros N", MissingDataList ("não está no site · por quê"), MostVotedInCity | filled, missing-data |
| S08 | Comparar | `/comparar?p=slug,slug,…` | 2–5 lado a lado | PersonPicker (chips removíveis, máx 5), PeriodTabs (carreira / ano), CompareTable (Quem é, Eleições, Patrimônio, Atividade), "—" = não publicado, VoteAgreement ("Votaram igual?" + divergências), PresetPairs, HelpToast | empty (presets), filled |
| S09 | Congresso | `/congresso` | o que está sendo votado e como foi | ModeTabs (sendo votado / virou lei), Hemicycle (Câmara 513 / Senado 81, filtro partido), LiveSessionStatus, AgendaCalendar, PautaCard (última/próxima sessão, aprovado/não votado), VoteList (busca, ano) | filled, sem sessão agora |
| S10 | Detalhe de votação/proposição | toque em item de S09/S05 (rota não vista) | texto, placar, voto por partido | Scoreboard, PartyBreakdown, link oficial | guess |
| S11 | Partidos | `/partidos` (+ detalhe por partido, não visto) | espectro e bancadas | SpectrumBar (esq/centro/dir), StateFilter, GovAlignmentChart, PartyList A–Z | filled |
| S12 | Governos | `/governos` | mandatos lado a lado | GovTabs (Brasil/Estados/Cidades/Planos), MandateTimeline com "+" (até 4), YearlyIndicators chart, Milestones, CorporateCard | filled |
| S13 | Planos de governo | `/propostas` | comparar planos registrados no TSE | RaceSelector, CandidatePicker (até 4), TopicSections com trechos literais | filled |
| S14 | Eleições | `/eleicoes` | resultados oficiais | PlaceSearch, UFGrid, ResultCard (turno, votos), WinnersHistory, LiveCountArchive | filled, arquivo |
| S15 | STF | `/stf` | pauta e decisões | ModeTabs, Counters, AgendaCalendar, MinistersGrid, CaseSearch, Glossary | filled |
| S16 | Impostômetro | `/impostos` | arrecadação federal | YearTabs, BigNumber, ChoroplethUF, TaxBreakdown, MonthlyChart, LagNote | filled |
| S17 | Mais vistos | `/mais-vistos` | o que as pessoas estão olhando | Window tabs (24h/desde lançamento), Trending (× média), HourlyChart, TopProfiles, TopDuels, TopShared, GeoViews, TopCities, Referrers, Devices; auto-refresh 30 s | live |
| S18 | Entenda os cargos | `/cargos` | educativo | RelationshipDiagram, OfficeDetail, OfficeCostTable | static |
| S19 | Dicionário | `/dicionario` | 213 termos | TopicChips, AZIndex, TermCard com fonte | static |
| S20 | Entrar | `/entrar?volta=<rota>` | login sem senha | EmailInput, "Mandar código", OTPInput (inferido) | empty |
| S21 | Monitorando | `/acompanhando` (auth) | feed dos políticos seguidos | (não visto — gate de login) | auth-required |
| S22 | Sobre / metodologia | `/sobre` | neutralidade, regras de contagem, fontes, privacidade, direito de resposta | LongForm com âncoras | static |
| S23 | Quem publica | `/dados-abertos` | cobertura de dados por ente | CoverageMatrix UF×dado, CitySearch, CTA "se sua cidade não publica" | filled |
| S24 | Novidades | `/atualizacoes` | changelog de dados | (não lido) | guess |
| S25 | Sugestão | `/sugestoes` | feedback | TypeChips (Ideia, Informação que falta, Algo errado, Outro), Textarea, Nome, E-mail, Cidade opcional | empty |
| S26 | Como ajudar | `/ajudar` | crowdsourcing | 4 "jeitos" com CTA | static |
| S27 | Assistente (MCP) | `/mcp` | anúncio de servidor MCP | ToolList | coming-soon |
| S28 | Card compartilhável | botão "Compartilhar card" em S05 | imagem/OG do crachá para redes | ShareSheet, imagem gerada (inferido) | guess |

Shell global (todas as telas): Header (logo, busca, Entrar, Sugerir, link, WhatsApp, Instagram, tema claro/escuro), TopNav com 9 itens + "Mais" mega-menu, DataFreshnessBar ("Dados oficiais atualizados em …", "Como atualizamos"), "Ouvir esta página" (TTS), Footer.

## Flows

```
F01 Eleitor descobre quem representa a sua cidade (core loop)
    S01/S06 -> digita cidade -> autocomplete -> S07 -> toca na pessoa -> S05
    happy path clicks: 3 (focar campo+digitar, escolher cidade, abrir crachá)  — o site promete "no máximo três cliques"
    edge: homônimos de cidade (Campinas SP/RS/PI → mostra UF), cidade sem dados abertos (MissingDataList),
          eleito aguardando posse (2 MandateCards), vereador sem câmara carregada (degraded)

F02 Navegar pelo mapa
    S01 -> toca região -> toca UF -> digita/toca cidade -> S07 -> S05
    happy path clicks: 4
    edge: Esc/voltar um nível, troca de camada (Contas/Escolas/Obras…) mantém o lugar, mobile sem hover

F03 Ler o crachá a fundo
    S05 -> YearSelector -> filtra propostas por tema -> abre proposta (link oficial) -> volta -> VoteTimeline -> abre votação (S10)
    happy path clicks: 3 por pergunta
    edge: senador sem presença ("não disponível"), seção sem registro, ano sem mandato, dados divergentes entre fontes

F04 Comparar representantes
    S07 -> "+ Comparar" em 2–5 pessoas -> S08 (URL ?p=a,b,c) -> PeriodTabs -> "Votaram igual?"
    happy path clicks: 3 (+1 por pessoa extra)
    edge: 6ª pessoa bloqueada, cargos diferentes (campos não aplicáveis = "—"), pessoas sem votação em comum

F05 Monitorar um político
    S05 -> "Monitorar" -> S20 (e-mail) -> código -> volta para S05 (?volta=) -> S21 feed
    happy path clicks: 4 + digitar e-mail e código
    edge: código expirado/errado, e-mail já cadastrado, rate-limit de envio, desinscrição

F06 Compartilhar
    S05 -> "Compartilhar card" -> share sheet nativo / WhatsApp / copiar link
    happy path clicks: 2
    edge: desktop sem Web Share API → fallback copiar link; OG image por slug

F07 Acompanhar o Congresso
    S09 -> agenda/pauta -> votação (S10) -> partido no hemiciclo -> rosto -> S05
    happy path clicks: 3
    edge: sem sessão hoje, sessão marcada mas sem votos, votação simbólica (sem voto nominal)

F08 Reportar erro / mandar fonte
    S05 "Reportar erro" ou S26 -> S25 -> enviar
    happy path clicks: 3
    edge: spam, e-mail inválido, link não oficial
```

Número a bater: 3 cliques do zero ao crachá (F01).

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button / Chip | primary, outline, ghost, pill-tab | default, hover, focus, active/selected, disabled | todas |
| SegmentedTabs | rolagem horizontal com ‹ › | selected, overflow | S01, S04, S09, S12, S15, S16, S17 |
| Combobox (search) | cidade/estado, político, global | empty, typing, results, no-results | S01, S03, S06, S07, S08, S14, S23 |
| Select | estado, partido, ano | default, open | S04, S05, S11 |
| BigNumber / HeroCounter | página (número gigante + legenda), tile | static, live-updating | S01, S05, S09, S15, S16, S17 |
| StatTile | valor, subtexto, tooltip "?" | filled, "—" não publicado, teto (estimado) | S05, S08 |
| PersonCard | compacto (nome · cargo · UF · partido), com foto, com "+ Comparar" | default, selecionado p/ comparar | S01, S04, S07, S09 |
| BrazilMap (SVG) | região, UF, choropleth | hover, selected, drill-down | S01, S16 |
| Hemicycle | Câmara, Senado | filtro por partido, hover | S09, S11 |
| Timeline (ano › mês › dia) | votos, leis, mandatos, propostas | collapsed ("Ver mais N"), expanded | S05, S09 |
| VoteBadge | Sim ✓, Não ✗, Abstenção, Não votou, Art. 17; Aprovado/Rejeitado | — | S05, S09, S10 |
| TopicTag | 17 temas fixos | — | S05, S09 |
| BarBreakdown | gastos por categoria, emendas por área, origem de campanha | — | S05, S16 |
| CompareTable | 2–5 colunas, grupos de linhas | "—" com nota | S08 |
| CalendarMonth | agenda com contagem por dia | sessão marcada (contorno), com votos (número) | S09, S15 |
| SourceFooter | "Fonte: … · atualizado em …" | — | todo bloco de dados |
| MissingDataNote | "não está no site · por quê" | — | S05, S07 |
| Modal / Toast | onboarding, ajuda contextual | open, dismissed | S02, S08 |
| ListenButton (TTS) | — | idle, playing | todas |
| ThemeToggle | claro, escuro | — | header |
| Form (e-mail, OTP, textarea) | — | empty, invalid, sending, sent | S20, S25 |
| ShareButton | card, link, WhatsApp | — | S05, header |

## Inferred data model

```
Person      id, slug, display_name, civil_name, birth_date, birthplace_city_id, education, photo_url, gender (Deputado/Deputada)
            evidence: S05 header + "Dados" (nome civil, nascimento, escolaridade), /p/:slug
            confidence: high

Office      id, kind (presidente | vice | senador | dep_federal | governador | vice_gov | dep_estadual | prefeito | vice_pref | vereador),
            level (municipal | estadual | federal), seats_rule
            evidence: S01 contadores por cargo, S18
            confidence: high

Mandate     id, person_id, office_id, place_id, party_id, start_at, end_at, status (em_exercicio | eleito_aguardando_posse | licenciado | encerrado),
            role (titular | suplente), elected_by (média | quociente…)
            evidence: S05 MandateCards, "Linha do tempo de mandatos", vereadora "Eleita por média"
            confidence: high

Place       id (IBGE code), kind (pais | regiao | uf | municipio), name, uf, parent_id
            evidence: ?cidade=3509502 (IBGE de Campinas), drill-down de S01
            confidence: high

Party       id, sigla, name, spectrum (esquerda | centro | direita), spectrum_order, president, hq
            evidence: S11
            confidence: high (siglas duplicadas na fonte: PCdoB/PC do B/PCDOB → precisa normalização)

Candidacy   id, person_id, election_id, office_id, place_id, party_id, votes, result (eleito | não eleito | suplente), campaign_raised, campaign_spent
            evidence: S05 "Eleita 3 vezes", "Dinheiro das campanhas", S08 "Candidaturas eleitas ou não", S14
            confidence: high

Election    id, year, round, office_id, place_id
            evidence: S14
            confidence: high

AssetDeclaration  person_id, year, total, items(json)            evidence: S05 patrimônio, S08          confidence: high
CampaignFlow      candidacy_id, direction (receita | despesa), source_type, amount   evidence: S05 "De onde veio / Com o que gastou"   confidence: medium

Proposal    id, house, type (PL | PLP | PEC | REQ…), number, year, summary_official, summary_plain, topics[], can_become_law, became_law_id
            evidence: S05 "O que propôs" (PL 5498, "Podem virar lei" vs "Pedidos")
            confidence: high
Authorship  proposal_id, person_id, role (principal | coautoria | apoio)      evidence: S05 filtro de autoria   confidence: high
Law         id, number, sanctioned_at, proposal_id                          evidence: S05 "viraram lei"        confidence: high

VotingEvent id, house, date, proposal_id, kind (texto | destaque | urgência), result (aprovado | rejeitado), party_orientations(json)
            evidence: S05 VoteTimeline, S09
            confidence: high
Vote        voting_event_id, person_id, value (sim | nao | abstencao | obstrucao | art17 | nao_votou)   evidence: S05, S08 "Votaram igual?"   confidence: high

Session     id, house, date, kind (deliberativa…), status (agendada | encerrada), video_url, agenda_items[]   evidence: S09 pauta/agenda   confidence: high
Attendance  session_id, person_id, present (bool), excused_reason          evidence: S05 presença 878/932, /sobre regra   confidence: high
Expense     id, person_id, date, category, supplier_name, supplier_doc, amount, receipt_url   evidence: S05 cota, MCP listar_gastos   confidence: high
Amendment   id, person_id, year, type (individual | pix | bancada…), area, beneficiary_place_id, beneficiary_kind, budget_action, paid_amount
            evidence: S05 "Emendas que mandou"         confidence: high
Committee / CommitteeMembership, Speech (person_id, date, summary, topics), Trip, StaffMember (person_id, role, salary)
            evidence: S05 seções correspondentes       confidence: medium
Salary      office_id, place_id, valid_from, amount, is_ceiling          evidence: S05 "R$ 46.366", vereadora "teto"   confidence: medium

DataCoverage place_id, dataset (salário | presença | votos | gastos…), status (publica_aberto | só_portal | não_publica | carregando), note
            evidence: S07 MissingDataList, S23                confidence: high
SourceStamp  dataset, source_name, updated_at                evidence: SourceFooter em todo bloco   confidence: high

User         id, email, created_at                           evidence: S20 OTP                      confidence: high
Follow       user_id, person_id, created_at                  evidence: "Monitorar"                  confidence: medium (feed não visto)
Suggestion   id, type, text, name, email, city, status       evidence: S25                          confidence: high
PageView     path, entity_id, ts, referrer, device, geo_uf   evidence: S17                          confidence: medium (agregado)
GovernmentTerm, YearlyIndicator, TaxRevenue(uf, month, tax, amount), STFCase, Minister, GlossaryTerm, GovPlan(candidacy_id, topic, excerpt)
            evidence: S12, S16, S15, S19, S13          confidence: medium
```

Relationships: Person 1-n Mandate, Mandate n-1 Office/Place/Party; Person 1-n Candidacy n-1 Election; Proposal n-n Person via Authorship; VotingEvent 1-n Vote n-1 Person; Session 1-n Attendance; Person 1-n Expense/Amendment/AssetDeclaration; Place self-tree (país › região › UF › município); User n-n Person via Follow.

O ponto mais difícil do modelo não é o schema, é a **identidade**: casar a mesma pessoa entre TSE (CPF não é público; usa título/sequencial), Câmara (id), Senado (código) e câmaras municipais. Isso merece um `PersonExternalId(person_id, source, external_id, match_confidence)`.

## Feature matrix

See `features.csv`. Must: 17, should: 17, could: 13, skip: 5.

## Out of scope (cannot or should not be cloned)

- Os dados do Politicômetro em si: não raspar o site. O clone faz ETL próprio das fontes oficiais (TSE, Câmara, Senado, Portal da Transparência, ALEs, SAPL municipais).
- Textos editoriais próprios (metodologia, dicionário de 213 termos, explicações de cargos, resumos em linguagem simples): reescrever, não copiar.
- Marca, nome e identidade visual "Politicômetro", perfis @opoliticometro e canal de WhatsApp.
- A audiência e o tráfego (416 mil visitas, "mais vistos") — o S17 só faz sentido depois de ter usuários.
- O trabalho manual de curadoria municipal (portais sem dado aberto, links mandados por usuários) — é processo, não feature.
- Fotos oficiais: usar só as que as casas legislativas/TSE publicam com licença de reuso.

Riscos regulatórios a tratar desde a v1 (não são skip, são requisito):
- Resolução TSE 23.610/2019: nada de recomendação de voto, ranking, enquete ou "IA que indica candidato" — inclusive no futuro MCP.
- LGPD: dado de agente público é público, mas e-mails de usuários (OTP, monitorar, sugestões) e analytics exigem base legal e política.
- Direito de resposta/correção precisa de fluxo operacional.

## Size

Screens 28 (+ shell), flows 8, entities ~30. Hard parts:
1. ETL multi-fonte com cadência diferente por fonte (TSE por eleição, Câmara diário, Receita mensal com 3 meses de atraso) e carimbo de atualização por bloco.
2. Resolução de identidade de pessoas entre fontes + normalização de partidos.
3. Cobertura municipal: 5.570 câmaras heterogêneas (SAPL/Interlegis onde existe, nada em muitas) — por isso o "degraded state" é produto, não exceção.
4. Classificação de temas por palavras-chave no resumo oficial (regra fixa e auditável, não LLM opaco — exigência de neutralidade).
5. Volume: ~71 mil pessoas, milhões de votos/gastos → páginas estáticas/ISR por slug + busca com tolerância a acento.
6. Tempo real: apuração ao vivo, contador de presença, mais vistos (30 s).

Size: **XL.** Decisão do usuário (2026-11-01): **escopo completo**, sem recorte — todos os níveis (federal, estadual, municipal) e todos os módulos (Congresso, STF, Governos, Eleições, Impostômetro). A arquitetura deve faseá-lo em releases; a recomendação original fica registrada abaixo como alternativa rejeitada.
Recomendação original (rejeitada): v1 só federal (Presidência, Senado, Câmara) + TSE para todos os cargos (quem é, mandatos, patrimônio, campanha). Isso entrega F01, F03, F04 e F06 com dado completo para 596 pessoas e crachá "degradado honesto" para os ~70 mil municipais/estaduais. Tamanho dessa fatia: **L** (um trimestre). Estaduais, municipais, STF, Governos e Impostômetro entram depois como módulos.
