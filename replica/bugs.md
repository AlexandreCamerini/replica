# Bugs

Só o que foi reproduzido. Severidade: S1 perda de dado / segurança / fluxo central bloqueado · S2 feature quebrada sem contorno · S3 quebrado com contorno ou visivelmente errado · S4 cosmético.

### BUG-001: "Toda a carreira" multiplica os números dos anos

- Severity: S2
- Flow / case: F03 / MAN-1 (dados reais)
- Screen: S05
- Build: e07184b  Browser / device: Chrome, 1440px, servidor 3101 (Postgres)

Steps
1. Abrir /p/adriana-ventura (dados reais) com "Toda a carreira".
2. Comparar "propostas na carreira" com a soma dos anos 2025 e 2026.

Expected: carreira = 282 + 254 = 536 propostas; 385 + 115 = 500 votos.
Actual: 6.432 propostas e 6.000 votos na carreira.
Evidence: `select period, proposals_principal from person_period_stats` → career 6432; query do derive fazia join de 4 CTEs por ano sem pré-agregar (produto cartesiano 3×3×3×3).
Suspected cause: `derive_stats.py`, CTE `agg` juntava presença, propostas, votos e gastos por ano para o período 'career'.
Status: fixed nesta rodada (pré-agregação por período em `pres2/props2/vt2/exp2`); verificado: carreira = soma dos anos.

### BUG-002: senador mostra "0 propostas" e "R$ 0 de gastos" em vez de "—"

- Severity: S2 (viola a regra "null nunca vira 0", que é regra de produto)
- Flow / case: F03 / NUL-1, F04 / MAN-1
- Screen: S05, S08
- Build: e07184b  Browser / device: Chrome, 1440px, servidor 3101

Steps
1. Abrir /comparar?p=adriana-ventura,alencar-santana,alan-rick&periodo=2025.
2. Ler a linha "Propostas como autor(a)" na coluna do senador.

Expected: "—", porque o ETL do Senado ainda não carrega matérias de autoria nem a CEAPS.
Actual: "0" (e R$ 0 em gastos).
Evidence: tabela da comparação; `person_period_stats.proposals_principal = 0` para senadores.
Suspected cause: `derive_stats.py` tratava "tem adapter" como "tem todos os datasets".
Status: fixed nesta rodada: disponibilidade por dataset, fonte e ano (`ingest_runs` bem-sucedidos); anos não carregados também viram `null` com lista "faltam N dados"; `pg.getStats` mostra o motivo para cargos federais.

### BUG-003: Playwright instalou só o Chromium, não o headless shell

- Severity: S3 (infra de teste)
- Flow / case: todos os e2e
- Build: e07184b

Steps
1. `npx playwright install chromium` dentro da sandbox.
2. `npx playwright test`.

Expected: suíte roda.
Actual: 40 testes falham em 2 ms com "Executable doesn't exist … chrome-headless-shell".
Evidence: `.local/e2e-run1.log`.
Suspected cause: o download do headless shell falhou silenciosamente na sandbox (sem permissão de escrita fora do projeto).
Status: fixed: `npx playwright install chromium-headless-shell` com `PLAYWRIGHT_BROWSERS_PATH` no projeto; documentado no test-plan.

### BUG-004: lista de resultados do combobox não abre de forma determinística

- Severity: S2 (bloqueia o fluxo central de forma intermitente; teclado e link direto continuam funcionando)
- Flow / case: F01 / F01-H1, F01-E6, F04 / F04-H2
- Screen: S06, S08
- Build: e07184b  Browser / device: Chromium headless (Playwright), 1440px e Pixel 7; reproduzido 3 de 5 vezes

Steps
1. Abrir /representantes, focar a busca e digitar "campi".
2. Esperar a resposta de /api/places (chega em ~0,5 s).

Expected: lista com "Campinas · SP" aberta.
Actual: `aria-expanded=false`, nenhuma opção, embora a API tenha respondido; mesmo comportamento em "Adicionar pessoa" na comparação.
Evidence: `.local/e2e-run2.log` (F01-E6 mobile, F04-H2); sonda `_debug2.mjs`: desktop fill expanded=false / 0 options com 1 chamada de API.
Suspected cause: o ComboBox do React Aria abre no evento de input, mas os itens chegam depois (fetch com debounce); dependendo do tempo, o estado interno já fechou e a chegada dos itens não reabre.
Status: fixed nesta rodada: `OpenWhenReady` (via `ComboBoxStateContext`) abre a lista quando a busca responde e o campo está focado; sonda 5/5 depois da correção, em todos os modos.

### BUG-005: eleição suplementar cria segundo titular em exercício

- Severity: S2 (13 cidades mostravam dois prefeitos em exercício; dado errado em S07)
- Flow / case: F01 / MAN-1 (dados reais)
- Screen: S07, S05
- Build: e07184b  Browser / device: servidor 3101

Steps
1. Rodar `civico-etl check` após a carga do TSE 2024.
2. Abrir /representantes?cidade=1600501 (Oiapoque · AP).

Expected: um prefeito em exercício (o eleito na suplementar); o anterior encerrado na data da nova eleição.
Actual: dois prefeitos "em exercício" (Breno e Delegado Inacio).
Evidence: `check` → "executivo: um titular em exercício por lugar e cargo (13)".
Suspected cause: `tse_candidatos.py` dava posse regular (1º de janeiro) a eleitos em eleição suplementar e não encerrava o mandato anulado; a mesma pessoa reeleita na suplementar (Ouro Branco · RN, vice) sobrepunha o próprio mandato.
Status: fixed nesta rodada: mandato suplementar começa na data da eleição; mandatos regulares da mesma disputa são encerrados nessa data (exceto senador, vaga única entre três); 82 disputas tratadas, `check` verde.

### BUG-006: quadrado do mapa tem nome acessível diferente do texto visível

- Severity: S3 (acessibilidade: usuário de comando de voz diz "SP" e o link se chama "São Paulo")
- Flow / case: F02 / F02-H1
- Screen: S01
- Build: e07184b

Steps
1. Abrir / e rodar o axe.

Expected: 0 violações.
Actual: `label-content-name-mismatch` em 27 links (texto "RR", nome "Roraima").
Evidence: `.local/e2e-run2.log` (F02-H1).
Status: fixed nesta rodada: `aria-label="SP: São Paulo"` mantém o texto visível no nome.

### BUG-007: cidade grande aparece depois de cidades pequenas na busca de lugar

- Severity: S3 (visível; contorno: digitar o nome inteiro)
- Flow / case: F01 / F01-E6 (celular)
- Screen: S06
- Build: e07184b  Browser / device: Pixel 7 (Playwright), dados reais

Steps
1. Abrir /representantes no celular e digitar "campi".

Expected: "Campinas · SP" entre as primeiras opções, visível sem rolar.
Actual: 9ª opção, atrás de Campina Grande, Campina Verde, Campinaçu…; fica abaixo da área visível da lista (320 px). Rolar a página para alcançá-la fecha o popover (React Aria fecha ao rolar fora da lista) e o campo é apagado.
Evidence: sonda `_debug11.mjs`: opção em y=735 com lista visível até y=695; eventos "scroll on document" seguidos do fechamento.
Suspected cause: `pg.searchPlaces` ordenava só por prefixo e nome.
Status: fixed nesta rodada: ordem por nome exato → prefixo → estado → tamanho da câmara (cadeiras em exercício) → A–Z. A demo já ordenava exato primeiro.

### BUG-008: erro de hidratação intermitente no crachá (React #418) em produção

- Severity: S3 (a página se recupera sozinha: o React regenera a árvore no cliente; sem efeito visível para o usuário)
- Flow / case: F03 / F03-H1, F03-E4
- Screen: S05
- Build: build de teste `.next-e2e` desta rodada  Browser / device: Chromium headless, 1440px, 2 workers

Steps
1. Rodar a suíte completa contra o build de produção (`E2E_BASE_URL=http://localhost:3200`).
2. Observar o console nos testes do crachá.

Expected: nenhum erro de console.
Actual: em 2 das 7 rodadas, `pageerror: Minified React error #418` numa carga do crachá; 4 cargas isoladas seguidas não reproduzem.
Evidence: `.local/e2e-run7.log` (F03-H1, F03-E4 flaky).
Suspected cause: diferença entre servidor e cliente em algo dependente de tempo ou de ambiente no crachá (formatação de data/moeda entre Node e Chromium, ou interação do teste antes da hidratação). Não isolado.
Status: open. Próximo passo: rodar o build de teste sem minificação (`next build` com `productionBrowserSourceMaps`) para ler o diff da hidratação; ou gravar `trace: on` e comparar o HTML do servidor com o da primeira renderização.

### BUG-009: em toque, a lista de lugares ignora toques nos primeiros ~0,5 s

- Severity: S4 (uma pessoa lê a lista antes de tocar; o toque seguinte funciona)
- Flow / case: F01 / F01-E6 (celular)
- Screen: S06
- Build: b284133 · Chromium com emulação de toque (Pixel 7); não reproduz sem toque

Steps
1. Abrir /representantes no celular, digitar "campi".
2. Tocar em "Campinas · SP" no instante em que a lista aparece.

Expected: o toque abre Campinas.
Actual: o toque cai no conteúdo atrás da lista até ~400–650 ms depois de ela aparecer; `elementFromPoint` no centro da opção devolve o contêiner da página nesse intervalo (sonda: hit=false até 325 ms, true a partir de 652 ms). Sem emulação de toque, hit=true desde 0 ms.
Evidence: `.local/e2e-run9.log` (F01-E6 mobile); sonda de 25 amostras a cada 80 ms.
Suspected cause: comportamento do Popover do React Aria em dispositivos de toque (posicionamento/visibilidade ajustados ao viewport visual depois de abrir). Não isolado no código da biblioteca.
Status: open (S4). O teste espera a opção ficar tocável antes de tocar e documenta o atraso. Reavaliar ao atualizar `react-aria-components`.

### BUG-010: presença derivada de voto mostrada como presença oficial

- Severity: S1 (dado errado mostrado como certo: Adriana Ventura 63% × 98% oficial; senador sempre 100%)
- Flow / case: data-diff D01
- Screen: S05, comparador
- Build: 178e39b · banco local :54329

Steps
1. `select presence_present, presence_total from person_period_stats` para adriana-ventura, período 2026.

Expected: 74 de 75 sessões deliberativas (lista oficial da Câmara).
Actual: 41 de 69 "dias com votação nominal".
Evidence: `replica/data-diff.md` §3.1.
Suspected cause: `camara_diario._derive_attendance` contava "registrou voto nominal" como presença; o Senado reaproveitava a mesma regra.
Status: fixed (build 5 · dados, f087d07): `camara.presenca` com `eventosPresencaDeputados`; Senado null. Adriana 2026 = 74/75.

### BUG-011: carga do TSE 2018 quebra na exclusão de mandato sobreposto (posse de governador)

- Severity: S2 (carga falha; nada gravado)
- Flow / case: ETL `tse.candidatos --year 2018`
- Build: f087d07

Steps
1. `civico-etl tse.candidatos --year 2018 --all`.

Expected: mandatos de governador 2019-01-01 → 2023-01-01.
Actual: `no_overlapping_mandate` ([2019-01-01, 2023-01-06) × [2023-01-01, 2027-01-06)).
Suspected cause: `term_dates` aplicava a posse de 6/1 (EC 111/2021, só a partir de 2027) ao fim de todo mandato.
Status: fixed (8c90cc5): posse em 1/1 até 2023, 5/1 (presidente) e 6/1 (governador) a partir de 2027. Mesma carga: senador eleito em suplementar (2020) que o Senado registra desde 2019 → fica o mandato da casa.

### BUG-012: senador falecido aparece como "licenciado"

- Severity: S3
- Flow / case: ETL `senado.diario` (titulares fora de exercício)
- Build: f087d07

Expected: Major Olímpio e Arolde de Oliveira (falecidos) com mandato encerrado.
Actual: `licenciado` (todo afastamento com exercício anterior virava licença).
Status: fixed (8c90cc5): causa FAL/TER → encerrado; L*/AFO → licenciado; REN → renunciou.

### BUG-013: API da Câmara devolve 504 persistente no detalhe de deputados antigos

- Severity: S3 (carga de 2019–2022 travava horas em retentativa)
- Flow / case: ETL `camara.diario --year 2019`
- Build: 6a01a27

Expected: votos e propostas de 2019–2022 ligados a quem está no diretório.
Actual: `/deputados/{id}` com 504 por ~20 s a cada tentativa para ids da legislatura 56.
Status: worked around: legislatura passada não consulta detalhe; os ids são ligados pela lista da legislatura (nome eleitoral + UF = candidatura a deputado federal na eleição que formou a legislatura, casamento único). Falha de `/historico` deixa a presença daquele deputado fora da carga (nem infla nem zera).

### BUG-010: crachá avisa "duas crianças com a mesma chave" em "Eleições disputadas"

- Severity: S4 (aviso de console; a tabela renderiza, mas React pode duplicar ou omitir linha)
- Flow / case: F03, F06 / testes que abrem o 1º vereador de Campinas (F05-E1, F06-H1, F06-H2)
- Screen: S05
- Build: 5c0e1e3 (build 4) · dados reais, dev server 3101

Steps
1. Abrir um crachá cuja pessoa tem duas candidaturas ao mesmo cargo no mesmo ano (ex.: vice-prefeito 2020, duas vezes).

Expected: nenhum aviso de console.
Actual: `Encountered two children with the same key ... 2020-vice_prefeito` (duas vezes por carga) e a suíte e2e falha pela regra "falha em erro de console".
Evidence: `e2e/f05-f08-stubs.spec.ts` contra `localhost:3101`.
Suspected cause: chave `${year}-${office}` em `Elections` (`components/profile/sections.tsx`); a dado real tem candidaturas repetidas (eleição suplementar ou duas zonas).
Status: fixed no build 5 (chave inclui lugar e posição).

### BUG-011: página de 390 px rola na horizontal por causa de texto `sr-only` dentro de tabela com rolagem própria

- Severity: S3 (rolagem horizontal da página inteira no celular; regra de produto)
- Flow / case: novo, W1a (S23, S24)
- Screen: S23, S24
- Build: build 5, antes da correção · Chromium 390 px

Steps
1. Abrir /atualizacoes ou /dados-abertos em 390 px (viewport simples, sem emulação de toque).
2. Ler `document.documentElement.scrollWidth`.

Expected: 390.
Actual: 515 (S24) e 673 (S23). Nenhum elemento visível passa da borda: os culpados são `<span class="sr-only">` (position: absolute) dentro das células; sem um ancestral posicionado, eles escapam do `overflow-x-auto` da região da tabela.
Evidence: sonda de `getBoundingClientRect` por elemento; os testes `@mobile` do projeto Pixel 7 passavam porque comparavam `scrollWidth` com `innerWidth`, e na emulação de celular o viewport se alarga junto com o conteúdo.
Suspected cause: `sr-only` absoluto fora do contêiner de rolagem.
Status: fixed (região da tabela é `relative`). Os specs `w1a-*` comparam `scrollWidth` com 390 fixo. Os specs antigos (SH-E2, F01-E6, F03) também passaram a comparar com 390 fixo e isso revelou o BUG-012.

### BUG-012: listas de pessoas e tabela de comparação estouram 390 px (rolagem horizontal da página)

- Severity: S3 (regra de produto "sem rolagem horizontal em 390 px" quebrada em telas centrais)
- Flow / case: F01, F04 / SH-E2, F01-E6 (passavam por checagem fraca)
- Screen: S04, S07, S08, S12 (lista de pessoas e comparação)
- Build: build 4 e anterior · Chromium 390 px, dados reais

Steps
1. Abrir /quem, /representantes?cidade=3509502 e /comparar?p=a,b em 390 px e ler `document.documentElement.scrollWidth`.

Expected: 390.
Actual: 541 (/quem), 456 (cidade), 446 e 437 (/comparar).
Evidence: sonda de `getBoundingClientRect`: itens `li` de `ul.grid` sem coluna base passam da borda; na comparação o culpado é `sr-only` absoluto dentro da região rolável (mesma causa do BUG-011).
Suspected cause: `ul class="grid gap-2 sm:grid-cols-2"` sem `grid-cols-1`: a coluna implícita é `auto` e cresce com o nome mais longo (`truncate` não corta sem `min-width: 0`). Os specs comparavam `scrollWidth` com `innerWidth`, que na emulação de celular se alarga junto com o conteúdo.
Status: fixed (`grid-cols-1` em 9 grades; `relative` nas 5 regiões roláveis restantes); SH-E2 agora também cobre /sobre, /atualizacoes, /dados-abertos e /congresso.

### BUG-014: prefeito eleito com recurso pendente aparece como cassado (Campinas sem prefeito)

- Severity: S1 (7 cidades sem prefeito no crachá, na lista de representantes, no MCP e nos contadores; Campinas entre elas)
- Flow / case: F01 / MAN-1 (dados reais)
- Screen: S05, S07, MCP `quem_me_representa`
- Build: 45b6940 · banco local 54329

Steps
1. Rodar `civico-etl tse.votos --year 2024`.
2. Abrir /representantes?cidade=3509502 (Campinas · SP).

Expected: Dário Saadi prefeito em exercício (o original e a Prefeitura mostram).
Actual: mandato `cassado`; Campinas sem prefeito. Mesma coisa em Senador Rui Palmeira (AL), Barroquinha (CE), Iconha (ES), Ewbank da Câmara (MG), Antonina (PR) e Ibirá (SP), e em 9 vereadores (Barroquinha ×3, Maurilândia, Tijucas, Cesário Lange ×2, Ibirá, Tabapuã).
Evidence: `votacao_candidato_munzona_2024_BRASIL.csv`: os 16 têm `DS_SITUACAO_CASSACAO = CASSADO COM RECURSO` e `DS_SIT_TOT_TURNO = ELEITO`/`ELEITO POR QP`/`ELEITO POR MÉDIA`. Nenhum `CASSADO` puro é eleito (6.132 linhas, todas `NÃO ELEITO`). Nenhum check pegou (só havia "no máximo 1 titular").
Suspected cause: filtro em `tse_votos_contas.run_votes` (`"CASSAD" in s and "NÃO" not in s and "SEM" not in s`) aceitava "com recurso"; `_mark_cassados` só marcava, nunca desfazia.
Status: fixed (D90–D92): só `CASSADO` puro cassa; a regra desfaz o que marcou; check novo "1 prefeito titular por município" com 16 exceções listadas. Recarga 2024 restaurou 16 mandatos; `check` verde.

### BUG-015: crachá de deputado federal rola na horizontal em 390 px (select da cota e cartões de número)

- Severity: S3 (layout; conteúdo acessível, página rola de lado)
- Flow / case: F03 / mobile
- Screen: S05
- Build: build 6 (pré-existente; revelado com a cota 2019–2026 carregada)

Steps
1. Abrir /p/adriana-ventura em 390 × 844.
2. Medir `document.documentElement.scrollWidth`.

Expected: 390. Actual: 470 (depois 413).
Evidence: sonda `getBoundingClientRect`: `select[name=gcat]` com 437 px (opção "Manutenção de escritório de apoio à atividade parlamentar…"); botão de ajuda dos cartões de patrimônio e campanha a 399 px (valor de 9 dígitos em `text-xl` + botão na meia coluna).
Suspected cause: `select` sem `max-width` cresce até a opção mais longa; valor do cartão sem `min-width: 0`.
Status: fixed (`SelectField` com `min-w-0 max-w-full`; valor do `StatTile` em `text-lg` no celular). Spec B6-W5 @mobile compara com 390 fixo.

### BUG-016: tabela `sr-only` atrás do gráfico de presença alarga a página no celular

- Severity: S3 · Screen: S05 · Build: build 6 (introduzido e corrigido no mesmo lote)
Expected: 390. Actual: 413.
Suspected cause: `sr-only` aplicado à `<table>`; tabela ignora `width: 1px` (mesma família do BUG-011).
Status: fixed (`sr-only` num `div` em volta da tabela).

### BUG-017: hora de sessão e votação da Câmara gravada 3 h adiantada (14:34 aparece 11:34); só-data do Senado aparece no dia anterior

- Severity: S2 (dado; o front só mostra dia e mês, então o efeito visível é data errada em fato de madrugada e balde de mês/ano) · Flow / case: F03 · Screen: S05 · Build: desde a primeira carga
Steps
1. `select starts_at from sessions where source_key = '83108'` (Câmara, 28/10/2026) -> `2026-10-28 11:34:00-03`; a API dá hora de Brasília sem fuso (`dataHoraRegistro` 14:34).
2. Senado: `select count(*) from voting_events` com `occurred_at at time zone 'America/Sao_Paulo'` às 21:00 -> 1.146 de 1.146.
Expected: 14:34 -03 (17:34 UTC); Senado 00:00 -03 do dia da sessão.
Actual: 14:34 UTC (11:34 -03); Senado 00:00 UTC (21:00 -03 do dia anterior).
Cause: `parse_ts` devolve datetime naive e a conexão do ETL roda em `timezone = 'UTC'` (db.py): o relógio local entrava como UTC. Mesma causa em `camara.presenca` (sessions), `camara.diario` (sessions, voting_events), `parlamento_extras` (speeches) e, para a data só, em `senado.diario`/`speeches` do Senado.
Status: fixed (D160-D163: `parse_ts_br`/`midnight_br`, migração 0050, `etl/tests/test_camara_fuso.py`). `camara_equipe.py` não grava hora; `agenda_events` já gravava com fuso.

### BUG-019: voto de presidente em dobro (Lula 2022 2º turno com 120.691.998); receita e despesa de campanha presidencial também

- Severity: S1 (dado errado publicado no crachá: votos, votos por município e dinheiro de campanha de todo candidato a presidente) · Flow / case: F04 · Screen: S05 (tile "votos recebidos", tabela "Eleições disputadas", "Dinheiro das campanhas") · Build: desde a primeira carga de `tse.votos`/`tse.contas`
Steps
1. `select c.votes from candidacies c join elections e on e.id = c.election_id where c.tse_sequencial = '280001607829' and e.round = 2` -> 120.691.998.
2. TSE, `votacao_candidato_munzona_2022_BR.csv` (cdn.tse.jus.br, dados abertos): SQ 280001607829, turno 2 = 60.345.999; `detalhe_votacao_munzona_2022_BR.csv`: válidos do 2º turno = 118.552.353 (o banco somava 237.104.706 só com os dois finalistas).
Expected: 1x a fonte. Actual: exatamente 2x em 18 de 18 candidaturas a presidente carregadas (2018, 2022, 2026, 1º e 2º turno) e em 99.720 linhas de `candidacy_place_votes`; receita, despesa e categorias de campanha das mesmas candidaturas também 2x.
Cause: `remotezip.pick_members` devolvia `…_BRASIL.csv + …_BR.csv`. O BRASIL é a concatenação das 27 UFs com o BR (tamanho do BRASIL = UFs + BR − 27 cabeçalhos, em votação, receitas e despesas de 2018, 2022 e 2026) e o BR só tem presidente (CD_CARGO 1). Governador, senador, deputados e cargos municipais não estão no BR: não foram afetados.
Status: fixed (D165–D169: `pick_members` só lê o BRASIL; dado corrigido por `civico-etl tse.fix019 --apply` e recarga de `tse.contas` 2026; invariante novo no `check`; `etl/tests/test_tse_bug019.py`).

## A conferir (não reproduzido como bug)

- build 6: na suíte inteira contra o dev server 3101, ONB-H2 (foco no campo de cidade) falhou uma vez e passou na repetição; S04-H1 flaky (passou no retry); B6-W5/W6 flaky uma vez por "Hydration failed" logo depois de uma edição de arquivo (recompilação do dev server), 17/17 sem retry na rodada seguinte.

- Flaky sob carga (passam na repetição, 3/3 ok isoladamente em <1 s): F02-H1, F02-E1 (clique em link da home não navega em 15 s com 2 workers contra um único `next start`) e F01-E6 mobile. Config: `workers: 2`, `retries: 1`.

- "Carreira" maior que a soma dos anos é esperado quando há fato fora dos anos de mandato no banco (matérias do senador antes de 2019, nota da cota com data fora do mandato). O `check` agora compara a carreira com o total direto da fonte (BUG-001 continua coberto).
- ~~Senado: a API por senador marca 77 de 93 votações de 2025 como secretas.~~ Resolvido (D39): `/votacao` traz 128 votações em 2025 (abertas e secretas).
- F01-E1 esperava exatamente 4 homônimos "Bom Jesus"; com os dados reais há 5 exatos (PI, PB, RN, RS, SC) mais "Bom Jesus da…". O teste passou a exigir pelo menos 4 e as 4 UFs; ajuste de teste, não de produto.
- Hidratação (React #418 / "Hydration failed") apareceu de novo em crachá e em /representantes?cidade= no dev server 3101, em 3 de ~25 cargas dos specs de F04/F05/F06. Mesmo padrão do BUG-008; não isolado (não rodei um controle sem as mudanças do build 5) (o diff aponta `Container`/`PageHeader` da lista de cidade). Segue aberto.

### BUG-018 (duplicado de BUG-019, fechado por ele): voto de presidente em dobro no banco (ETL `tse.votos`)

- Severity: S1 (número errado exibível)
- Flow / case: dado / conferência de /eleicoes
- Screen: S05 (tile de votos de quem foi candidato a presidente) e S14
- Build: w4  Browser / device: consulta direta ao Postgres local

Steps: `candidacies.votes` de presidente 2022: Lula 1º turno 114.519.008, 2º turno 120.691.998; Bolsonaro 2º turno 116.412.708. O TSE publica exatamente a metade (Lula 2º turno 60.345.999). 2018 e 2026 também em dobro; `candidacy_place_votes` de presidente herda.

Causa: `remotezip.pick_members` devolve `_BRASIL.csv` (todos os cargos) **e** `_BR.csv` (presidente); a eleição presidencial está nos dois. Os demais cargos estão corretos (Boulos dep. federal 2022 = 1.001.472).

Estado: o app não mostra voto de presidente/vice (`pg-w4.ts`). Correção: devolver só `_BRASIL.csv` e recarregar `tse.votos` 2018/2022/2026 (~4 GB por ano). Não corrigido aqui por tocar tabela compartilhada.

## Verificação final independente (2026-11-03, verify-final.md)

### BUG-020: cota parlamentar subcontada: o ETL descarta linhas que dividem o mesmo `ideDocumento` (passagem, estorno, taxa)

- Severity: S1 (perda de dado no ETL e número errado publicado no crachá, no comparar e no MCP; mesmo critério do BUG-019)
- Flow / case: F03 / dado contra fonte · Screen: S05 (tile "gastos do gabinete", seção Gastos), S08 · Build: desde e07184b (primeira carga), não é regressão desta noite
- Browser / device: consulta ao Postgres local e à API da Câmara; Chrome 1440 no 3301

Steps
1. `select sum(amount_cents)/100 from expenses where person_id = (Adriana Ventura) and extract(year from occurred_on) = 2025` -> 89.595,04 (crachá: "R$ 89.595" em 2025; carreira R$ 476.298).
2. API `GET /api/v2/deputados/204528/despesas?idLegislatura=57&ano=2025` (todas as páginas): 406 linhas, `valorLiquido` = 104.680,79. Página oficial camara.leg.br/deputados/204528?ano=2025: "Cota parlamentar 104.693,75".
3. Na API, 37 `codDocumento` aparecem em 2 a 4 linhas (passagem aérea SIGEPA: emissão, estorno negativo, taxa de remarcação).
4. Baleia Rossi 2025: API 377.188,69; banco 343.601,05 (−8,9%).
5. Original (politicometro.org/p/adriana-ventura, captura replica/screens/final-cracha-1440.png): "R$ 517.773 gastou de cota parlamentar somando todos os anos"; clone R$ 476.298.

Expected: soma de `vlrLiquido` de todas as linhas do arquivo `Ano-AAAA.csv.zip` (bate com a página da Câmara).
Actual: −14,4% (Adriana 2025), −8,9% (Baleia 2025); passagens aéreas da Adriana 2025: 12.721,27 no banco contra 27.532,19 na fonte.
Cause: `etl/civico_etl/jobs/camara_diario.py::_expenses` usa `key = ideDocumento` e faz `upsert(... ["body_id","source_key"])`: linhas diferentes do mesmo documento se sobrescrevem e só a última sobrevive. Valores negativos (estornos) sobrevivem ou somem conforme a ordem do arquivo.
Fix sugerido: chave composta (`ideDocumento` + `numParcela` + `txtPassageiro`/`numRessarcimento` + valor + ordem da linha no arquivo, ou o hash da linha inteira) e recarga de `camara.despesas` 2019–2026; invariante novo no `check`: soma por deputado e ano = soma de `vlrLiquido` do CSV.
Status: fixed (fix ETL, D180, D181 e D183). Chave por linha da fonte e prune por arquivo. Complemento pela API a partir de 2025 para as passagens SIGEPA com codDocumento UUID, que o arquivo não traz. Ano de competência no `occurred_on`, também na CEAPS. Recarga de 2019 a 2026: a Câmara passou de 1.258.789 para 1.475.785 linhas e 0 chaves antigas. Conferido contra a página da Câmara: Adriana 2025 dá 104.693,75 (antes 89.595,04) e Baleia Rossi 2025 dá 377.205,06 (antes 343.601,05; página 377.205,07). Também conferidos Tabata 2024 e 2025, Kim 2024 e 2025 e Nikolas 2024, 2025 e 2026, todos com diferença de no máximo R$ 0,10. Estornos batem com a API: Adriana 2025 tem 39 linhas, −12.247,87; Baleia 2025 tem 54, −51.967,93. CEAPS sem o defeito da chave (`id` único na fonte). Invariante novo no `check` (amostra de 10 deputado-ano) e `etl/tests/test_cota.py`. `derive.stats` rodado.
Reverificação 2026-11-03: parcial. A chave por linha funciona: 2024 do banco = soma de `vlrLiquido` do `Ano-2024.csv` por deputado, linha a linha e centavo a centavo (232.014 linhas, 581 deputados, 0 divergências; a única diferença é Marcelo Ramos, fora do diretório, R$ -38,56). Não há duplicata nem soma acima da página: 21 deputado-ano conferidos fora da `COTA_REFERENCIA` batem com a página quando o deputado não tem auxílio-moradia (até R$ 0,14). O critério "bate com a página da Câmara" falha para quem recebe complementação do auxílio-moradia: a Câmara publica `vlrLiquido` negativo nessas linhas, o banco subtrai e a página soma. Luciano Vieira 2024 aparece com R$ 449.994 no crachá, contra R$ 516.374,69 na página (-12,9%). Erika Hilton 2025 tem R$ 444.871 contra R$ 506.616,91 (-12,2%). São 84 a 96 deputados por ano desde 2023, com o pior caso em -31%. A amostra da `COTA_REFERENCIA` (5 deputados de SP e MG) não tinha nenhum caso. Detalhe em BUG-030 (S1). As correções colaterais conferem: anos fechados não perderam linha legítima (Alberto Mourão 2024: banco = arquivo, 153 linhas), CEAPS bate com a API do Senado em 2019 (58 senadores) e 2025 (77), e o `derive.stats` só mudou `expenses_cents` (506.624 linhas comparadas com o backup).

### BUG-021: /partidos some com o partido que só existe como partido atual (MISSÃO): Câmara soma 512 de 513

- Severity: S3 · Screen: S11 /partidos · Build: W4 (regressão desta noite, página nova)
Steps
1. Abrir /partidos; somar a coluna Câmara -> 512. Não há linha MISSÃO.
2. Abrir /p/kim-kataguiri -> cabeçalho "MISSÃO"; API da Câmara `deputados?siglaPartido=MISSÃO` -> Kim Kataguiri.
Expected: linha MISSÃO com 1 cadeira; total 513.
Cause: `pg-w4.ts::listPartyRows` lista partidos com `exists mandates.party_id = pa.id`, mas conta cadeiras por `coalesce(person_current_party, mandates.party_id)`. Quem trocou para um partido que não está em nenhum `mandates.party_id` some da tabela. features.csv já registrava "512/513" como se fosse aceitável.
Status: fixed (fixui, D191). A causa era do front: `listPartyRows` filtrava partidos por `mandates.party_id`, mas as cadeiras usam `person_current_party`. O filtro agora aceita as duas origens; MISSÃO volta com 1 cadeira e a soma é 513 de 513. Se algum mandato ficar sem partido, a nota sob a tabela diz "N deputado(s) sem partido vigente na fonte". Lado do dado (fix ETL, D187): não havia defeito. O banco tem 513 em exercício, todos com partido vigente, e MISSÃO em `parties`; batem com a Câmara partido a partido. O `check` passou a exigir exatamente 513, todos com partido vigente.
Reverificação 2026-11-03: confirmado. /partidos soma 513 de 513 e tem MISSÃO 1. Os 21 partidos batem com a API `/deputados` da Câmara (03/11/2026), e o partido de cada um dos 513 deputados bate com a API.

### BUG-022: bancada do Senado em /partidos diverge do Senado (PT 10 / PSD 13 / PL 16 contra 9 / 14 / 15)

- Severity: S3 · Screen: S11 /partidos e S05 (cabeçalho do crachá) · Build: W4 (contagem nova); a fonte do "partido atual" é anterior
Steps
1. /partidos: Senado PT 10, PSD 13, PL 16.
2. `https://legis.senado.leg.br/dadosabertos/senador/lista/atual`: PT 9, PSD 14, PL 15, S/Partido 1 (Romário).
3. /p/eliziane-gama mostra "PT"; o mandato no banco e o Senado dizem PSD. /p/romario mostra "PL"; o Senado diz "S/Partido".
Expected: a mesma regra de partido em todo o site, com a fonte e a data de onde veio a filiação.
Cause: `person_current_party` (filiação vinda do TSE/candidatura) vence o partido do mandato publicado pela casa; para Eliziane pode ser filiação para 2026 que o Senado ainda não refletiu, mas o site afirma "PT" sem dizer de onde.
Status: fixed (fix ETL, D182). A filiação vigente vem da casa: a candidatura do TSE posterior à última observação da casa não vence enquanto o mandato está em exercício, e o "S/Partido" do Senado virou observação. Antes, o banco tinha PT 10, PSD 13, PL 16. Agora tem AVANTE 1, MDB 9, PDT 1, PL 15, PODE 3, PP 8, PSB 7, PSD 14, PSDB 4, PT 9, REPUBLICANOS 6, S/Partido 1 e UNIÃO 3, o mesmo que `senador/lista/atual` traz em 03/11/2026: 81 de 81, sem nenhuma divergência por senador. A Câmara confere 513 de 513 por deputado contra `/deputados`. Nota para a tela: o cabeçalho do crachá ainda não diz de onde veio o partido ("segundo o Senado/Câmara"), e /partidos vai mostrar a linha "S/Partido" com 1 cadeira no Senado, como o próprio Senado faz.
Reverificação 2026-11-03: parcial. Dado confirmado: os 81 senadores batem um a um com `senador/lista/atual` (0 divergências), e /partidos mostra PT 9, PSD 14, PL 15 e S/Partido 1. A regra da casa não teve efeito colateral: contra o backup, só Eliziane (PT→PSD) e Romário (PL→S/Partido) mudaram de partido vigente, entre 71.594 pessoas. Fica aberto o que o próprio Expected pedia: o cabeçalho do crachá mostra "PSD" e "S/Partido" sem dizer a fonte nem a data da filiação. Também saiu da linha do tempo `party_memberships` a filiação PT de 2026 da Eliziane, que segue só na tabela de eleições.

### BUG-023: "Desemprego, média do ano" em /governos não é a taxa média anual do IBGE (2024: 6,85 contra 6,6)

- Severity: S3 (número diferente do oficial, com rótulo que sugere o oficial) · Screen: S12 /governos · Build: W4 (regressão desta noite)
Steps
1. /governos: 2023 = 7,98; 2024 = 6,85.
2. IBGE, Agência de Notícias 42530/42531: taxa média anual de desocupação 2023 = 7,8%, 2024 = 6,6%.
Cause: o ETL faz média simples dos quatro trimestres da SIDRA 4099; o IBGE publica a média anual por outro cálculo. A nota de método diz "média simples dos quatro trimestres", mas o cabeçalho diz "média do ano".
Fix sugerido: usar a série anual publicada pelo IBGE (ou renomear para "média dos 4 trimestres" e mostrar o valor oficial ao lado).
Status: fixed (fixui, D190). Job usa a taxa média anual do IBGE (SIDRA 10379 v4099, total): 2022 9,6; 2023 7,7; 2024 6,6; 2025 5,6. Rótulo e nota de método de /governos ajustados. Nota: a tabela dá 7,7 para 2023, a notícia do IBGE citada acima dizia 7,8; vale a tabela, que é a fonte primária.
Reverificação 2026-11-03: confirmado. /governos de 2019 a 2025 mostra 11,8 / 13,7 / 14,0 / 9,6 / 7,7 / 6,6 / 5,6, os mesmos números da SIDRA 10379 v4099 (Total), conferida na apisidra em 03/11/2026. A série de 2012 a 2018 também bate, e o rótulo diz "taxa média anual (IBGE)".

### BUG-024: Amazonas sem governador: home diz "Governo do estado 26" e Manaus omite o nível sem "—"

- Severity: S3 · Screen: S01, S07 · Build: dado de 02/11 23:13 (carga TSE); não determinado se é desta noite
Steps
1. Home: chip "Governo do estado 26", "Vice-governo 19".
2. /representantes?cidade=1302603 (Manaus): não existe seção "Governo do estado"; nenhum aviso.
3. Banco: Wilson Lima e Tadeu de Souza com `status = 'renunciou'` em 2026-04-04; nenhum titular `em_exercicio` no AM.
Expected: quem exerce o governo do AM hoje, ou "—" com o motivo (titular e vice renunciaram; fonte não publica o sucessor).
Cause: o `check` "um titular em exercício por lugar e cargo" testa no máximo 1, não exatamente 1, para governador.
Status: fixed na tela (fixui, D193). Cargo sem titular em exercício vira “—” com motivo: na home, “Governo do estado 26 de 27” e a linha “AM sem governador em exercício na fonte”; em /representantes o grupo Governo do estado não some e diz o motivo tirado do último mandato (AM: titular renunciou em 04/04/2026; há eleito aguardando posse; a fonte não publica quem exerce o cargo agora). Vice-governo faz o mesmo (MG, GO, PA, AC, AM, MT, PB, ES). A parte do `check` (exatamente 1 titular) é do agente de ETL e não foi tocada. Lado do dado (fix ETL, D184 e D185): a causa não era carga nem cassação. Houve dupla vacância por renúncia, que é real, e a sucessão por eleição indireta na ALEAM não está no TSE. Roberto Cidade (União) agora é governador em exercício desde 04/05/2026, até 06/01/2027, pela lista curada `EXECUTIVO_FORA_DO_TSE` com fonte da Agência Brasil. O crachá mostra "situação segundo o ALEAM", e /representantes?cidade=1302603 no 3101 já mostra o nome. A vaga de vice do AM segue vazia: o vice eleito, Serafim Corrêa, não está no diretório. `check` novo: exatamente 1 governador por UF, com lista de exceções (vazia); hoje dá 27 de 27.
Reverificação 2026-11-03: reaberto. O AM está certo: a página da Governadoria (08/05/2026) nomeia Roberto Maia Cidade Filho. Ela basta para dizer quem governa, mas não traz a data de posse nem a eleição indireta, que hoje só têm fonte na imprensa. Em compensação, 3 UFs mostram como governador quem não está no cargo. DF mostra Ibaneis Rocha, que renunciou em 28/03/2026, e quem governa é Celina Leão. RJ mostra Cláudio Castro, que renunciou em 23/03/2026; o governo está com o presidente do TJ-RJ, interino. RR mostra Antonio Denarium, que renunciou e foi cassado pelo TSE com o vice. O `check` "exatamente 1 governador por UF" passa com 27 de 27 porque conta linhas e não confere a pessoa. Ver BUG-031 (S1).

### BUG-025: deputados estaduais: 994 em exercício contra 1.035 cadeiras, sem aviso (SP 90 de 94, RJ 65 de 70)

- Severity: S3 · Screen: S01, S07 (Campinas: "Deputados estaduais 90") · Build: anterior a esta noite
Steps: `select uf, count(*) from mandates ... deputado_estadual em_exercicio` -> faltam 41 em 18 UFs (AP −1, BA −2, CE −4, ES −2, GO −1, MA −4, MG −3, MT −1, PA −2, PE −2, PI −2, PR −3, RJ −5, RO −1, RS −1, SC −2, SP −4, TO −1).
Expected: suplentes em exercício (ALESP e ALMG já são lidas desde W3-A) ou "—" com motivo dizendo que suplente em exercício não está carregado.
Status: fixed na tela (fixui, D193). Deputados estaduais abaixo das cadeiras (CF art. 27) mostram “N de M cadeiras carregadas” no título, chip e aviso com o motivo (suplente que assumiu ainda não está todo carregado); a home mostra “N de M” no chip e a linha do motivo. Carregar os suplentes que faltam (41 em 18 UFs) é trabalho de ETL e segue aberto. Lado do dado (fix ETL, D186): não é erro de carga. Os titulares eleitos fecham com as cadeiras da CF art. 27 nas 26 UFs. Os 41 que faltam são titulares que saíram: 39 viraram prefeito ou vice em 01/01/2025, um virou prefeito em 2026 (AP) e outro foi para o Senado (CE). Com o governador do AM (BUG-024), hoje são 993 de 1.035. O suplente que assumiu não está em fonte aberta lida: o TSE não publica posse de suplente, e ALESP e ALMG listam o suplente, mas criar crachá a partir da casa é trabalho novo. Segue aberto como carga de suplentes. `check` novo: titulares por UF iguais às cadeiras e em exercício menor ou igual às cadeiras.
Reverificação 2026-11-03: confirmado. O banco tem 42 titulares de 2022 que saíram: 39 em 01/01/2025, o AP, o CE e o AM (Roberto Cidade). A amostra de 5 confere com o resultado de 2024: Igor Normando, prefeito de Belém; Evandro Leitão, de Fortaleza; Tiago Amaral, de Londrina; Gerson Pessoa, de Osasco; e Egidio Ferrari, de Blumenau. Sargento Reginauro está em `senador/lista/atual` (CE). A tela do Rio mostra "65 de 70" com o motivo. A carga de suplentes segue aberta, como o próprio status declara.

### BUG-026: /comparar e o bloco "Números" do crachá sem fonte e data do que mostram

- Severity: S3 (regra de produto "fonte e data em todo bloco") · Screen: S08, S05 · Build: anterior; o tile de salário acumulado é desta noite (W3-B)
Steps
1. /comparar?p=adriana-ventura,baleia-rossi: presença, propostas, votos e cota são da Câmara; o único rodapé da página é "Fonte: TSE · Dados Abertos".
2. /p/adriana-ventura, bloco "Números desde 2019": nenhum "Fonte: … · atualizado em …"; o salário acumulado não cita o decreto legislativo nem a data (só o texto de ajuda "como a lei publica").
Status: fixed (fixui, D194). Bloco “Números” do crachá ganhou uma lista de fontes com “Fonte: … · atualizado em …” por número (salário: decreto ou Constituição; patrimônio e votos: TSE candidatos; campanha: TSE contas; presença, propostas, votos e gastos: Câmara, Senado, Assembleia ou SAPL conforme a casa). /comparar cita a fonte de cada bloco (TSE; Câmara ou Senado) com a data da carga.
Reverificação 2026-11-03: confirmado. /comparar cita a fonte por bloco: TSE para patrimônio e campanha e "Câmara dos Deputados · Dados Abertos · atualizado em 03/11/2026" para presença, propostas, votos e cota. O crachá lista uma fonte e uma data por número.

### BUG-027: ONB-H2 (foco no campo de cidade depois do onboarding) falha no dev server

- Severity: S4 · Screen: S02 · Build: anterior (já estava em "A conferir", build 6)
Steps: suíte contra 3101: falhou nas 2 tentativas; isolado com `--repeat-each 3`: 1 de 3 falhou. Contra o build de produção (3301): passou.
Cause provável: corrida entre a hidratação do combobox e o `focus()` disparado ao fechar o modal; em celular lento pode aparecer em produção.
Status: fixed (fixui, D196). Era bug real: o intervalo de foco parava no primeiro acerto e só esperava 3 s; no dev a rota /representantes compila em mais tempo e o modal devolve o foco depois do primeiro acerto. `first-visit.tsx` agora só age em /representantes, espera até 10 s, refaz o foco se ficar solto e para depois de 500 ms estável. ONB-H2 passou 5 de 5 com `--repeat-each 5` no dev.
Reverificação 2026-11-03: não conferido. O `playwright test -g ONB-H2` não abriu o navegador: falta o chromium-headless-shell 1248 no cache, e baixar o binário ficou fora do escopo. O código de `first-visit.tsx` não foi lido a fundo.

### BUG-028: presença do crachá não bate com a da Câmara (2025: 108 de 120 contra 110 + 11 justificadas)

- Severity: S4 · Screen: S05 · Build: anterior
Steps: /p/adriana-ventura?ano=2025 -> "90% (108 de 120)"; camara.leg.br/deputados/204528?ano=2025 -> 110 dias presentes, 11 ausências justificadas, 0 não justificadas. Carreira: clone 912 de 926; original 911 de 932.
Cause provável: o clone conta sessões deliberativas; a Câmara conta dias. Não está dito no tile.
Status: fixed por rótulo (fixui, D195). O tile continua “N de M sessões deliberativas”; a ajuda e /sobre#presenca explicam que a Câmara conta dias e separa justificadas, então o número pode diferir. Contagem por dia não é possível com a lista aberta (por sessão) e nem bateria: o clone teria menos dias que os 110 da Câmara.
Reverificação 2026-11-03: confirmado. A ajuda do tile e /sobre ("Por que o número pode diferir do da Câmara") dizem que o clone conta sessões deliberativas, que a Câmara conta dias e separa as justificadas, e que justificada conta como ausência aqui. Isso explica as duas direções da diferença: dia sem sessão deliberativa e ausência justificada. Ressalva: a frase "um dia pode ter mais de uma sessão" explica o caso contrário ao da Adriana (110 dias contra 108 sessões).

### BUG-029: `npx eslint` em web/ lint a saída de build `.next-e2e-w3a/` (1.823 erros)

- Severity: S4 (ferramenta) · Build: W3-A
Steps: `cd web && npx eslint` -> 10.937 problemas, todos em `.next-e2e-w3a/`; `npx eslint src e2e` -> 0.
Fix sugerido (uma linha): em `eslint.config.mjs`, trocar `".next-e2e/**"` por `".next*/**"`. Não aplicado: fora do escopo de commit desta verificação.
Status: fixed (fixui). `eslint.config.mjs` ignora `.next*/**`; `npx eslint` sem argumento agora dá 0 problemas.
Reverificação 2026-11-03: confirmado. `npx eslint` em web/ sai com código 0 e nenhum problema. `eslint.config.mjs` ignora `.next*/**`.

## Reverificação independente (2026-11-03, reverify.md)

### BUG-030: a cota subtrai a complementação do auxílio-moradia, que a Câmara soma: até -31% no crachá de 84 a 96 deputados por ano

- Severity: S1 (número errado publicado no crachá, no comparar e no MCP; mesma classe do BUG-020)
- Flow / case: F03 / dado contra fonte · Screen: S05, S08 · Build: aa72e47. O defeito é anterior, mas a recarga do BUG-020 o agravou. No backup pre-bug020-024, a subcota tinha 5.371 linhas, saldo de R$ -2,71 mi e 1.569 linhas positivas. Hoje tem 3.910 linhas, todas negativas, com saldo de R$ -7,36 mi.
- Browser / device: curl no 3101 e Postgres local, só leitura

Steps
1. Abrir /p/luciano-vieira?ano=2024. O tile mostra "R$ 449.994 gastos do gabinete em 2024".
2. Abrir camara.leg.br/deputados/220616?ano=2024. Cota Parlamentar Total: 516.374,69.
3. No `Ano-2024.csv` da Câmara, as linhas de "COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA" do deputado vêm com `vlrDocumento` 4148.8 e `vlrLiquido` -4148.8.
4. No banco, `select sum(amount_cents) from expenses where category ilike '%moradia%' and source_key like 'cota2024:220616:%'` dá -33.190,40.

Expected: o total do ano bate com a página da Câmara, que soma a complementação como gasto.
Actual: o banco subtrai o valor, e o erro sai em dobro (2 × |moradia|). Recalculado com o sinal trocado, o total bate com a página até o centavo em todos os casos conferidos:

| Deputado (id) | Ano | Página | Banco | Banco com o sinal da moradia trocado |
|---|---|---|---|---|
| Luciano Vieira (220616) | 2023 / 2024 / 2025 | 467.736,88 / 516.374,69 / 495.275,83 | 384.761,08 / 449.993,86 / 410.066,44 | 467.737,08 / 516.374,66 / 495.275,80 |
| Erika Hilton (220645) | 2023 / 2024 / 2025 | 411.632,50 / 492.049,79 / 506.616,91 | 384.988,78 / 465.863,47 / 444.871,49 | igual à página |
| Jorge Solla (178857) | 2024 / 2025 | 531.145,88 / 538.934,40 | 523.811,88 / 523.406,40 | igual à página |
| Pedro Lupion (204395) | 2024 | 529.523,91 | 512.065,91 | igual à página |
| 204486 | 2025 | 602.281,03 | 517.146,97 | 602.281,07 |

Alcance: 2019: 34 deputados; 2020: 28; 2021: 23; 2022: 24; 2023: 96; 2024: 88; 2025: 84; 2026: 77. Pior caso: -31% em 2025. Mediana dos afetados: -7% em 2025. Nenhuma linha de moradia é positiva no banco.
Cause: `camara_diario.py::_expenses` grava `cents(x["vlrLiquido"])` sem tratar a subcota 40 (complementação do auxílio-moradia), em que a fonte publica o líquido negativo. A API `/deputados/{id}/despesas` não traz essa subcota, então o complemento D181 não corrige nada.
Gap no teste: a `COTA_REFERENCIA` (D183) tem 5 deputados de SP e MG, todos sem complementação. A amostra não exercita o caso.
Fix sugerido: decidir a regra em decisions.md (a página da Câmara soma `vlrDocumento` dessas linhas). Usar valor absoluto ou `vlrDocumento` na subcota 40, recarregar 2019 a 2026 e pôr na referência um deputado com complementação, como Luciano Vieira 2024 (516.374,69).

### BUG-031: governador de DF, RJ e RR é quem já saiu do cargo; o `check` "1 por UF" passa assim mesmo

- Severity: S1 (dado errado publicado: a tela afirma quem governa 3 UFs, e erra)
- Flow / case: F02 / dado contra fonte · Screen: S07 (/representantes), S01 (contador da home), S05 (crachá do ex-governador) · Build: aa72e47. A lógica não é desta noite (regra D06 + TSE), mas o BUG-024 "fixed" afirmou 27 de 27.

Steps
1. /representantes?cidade=5300108 (Brasília) mostra "Ibaneis Rocha Governador · MDB" e "Celina Leão Vice-governadora".
2. /representantes?cidade=3304557 (Rio) mostra "Cláudio Castro Governador · PL" e "Thiago Pampolha Vice-governador".
3. /representantes?cidade=1400100 (Boa Vista) mostra "Antonio Denarium Governador · PP" e "Edilson Damião Vice-governador".
4. Banco: os três têm mandato `em_exercicio` até 2027-01-06 com `status_source = 'tse'`.

Expected: quem exerce o cargo hoje, ou "—" com motivo quando a fonte oficial lida não publica.
Actual e fontes (imprensa; o portal oficial de cada UF não foi conferido):
- DF: Ibaneis renunciou em 28/03/2026, e Celina Leão foi empossada pela CLDF em 30/03 (Jornal de Brasília, Poder360, IstoÉ). Ibaneis desistiu do Senado e não tem candidatura em 2026, por isso a regra D06 não dispara.
- RJ: Cláudio Castro renunciou em 23/03/2026, na véspera do julgamento no TSE. O RJ não tem vice, e o presidente do TJ-RJ, Ricardo Couto, governa interinamente enquanto o STF decide o formato do mandato-tampão (Poder360, SBT News, Correio da Manhã, 08/2026).
- RR: Denarium renunciou, e Edilson Damião assumiu em 27/03/2026. O TSE cassou a chapa de 2022 em 30/04/2026, e a eleição suplementar foi em 21/06/2026, com resultado sub judice até 01/07 (CNN Brasil, InfoMoney, Congresso em Foco). Quem governa hoje não foi confirmado.
Cause: a regra D06 só marca renúncia quando há candidatura a outro cargo no TSE. Renúncia sem candidatura (DF, RJ), cassação (RR) e interinidade de outro Poder ficam fora. O `check` D185 conta "exatamente 1 titular em exercício por UF" e não confere quem é.
Fix sugerido: estender `EXECUTIVO_FORA_DO_TSE` (DF: Celina Leão desde 30/03/2026; RJ e RR: "—" com motivo até haver fonte oficial) e criar um check de identidade do governador por UF contra uma lista curada com fonte e data. Rever as outras 24 UFs contra o portal de cada governo.

### BUG-032: o casamento de identidade pelo `SQ_CANDIDATO` sem o ano liga candidaturas de 2012 e 2014 a outras pessoas (15.769 pessoas, 3.406 mandatos)

- Severity: S1 (histórico eleitoral, mandatos e campanhas de outra pessoa publicados no crachá)
- Flow / case: F03 / identidade · Screen: S05 (Eleições, Mandatos, Dinheiro das campanhas) · Build: anterior a esta noite (carga TSE 2012/2014/2016)

Steps
1. /p/roberto-cidade, seção de eleições: "2012 Vereador · Fonte Boa · AM PCdoB Suplente". No banco, o nome de urna dessa candidatura é "Dinelci".
2. `select e.year, c.ballot_name, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id where p.slug = 'roberto-cidade'`: 2012 "Dinelci" (Fonte Boa) e 2016 "Roberto Cidade" (Manaus) têm o mesmo `tse_sequencial` 40000001600.
3. `person_external_ids` tem um único `tse:40000001600`, `exact_id`, confiança 1,000.

Expected: candidatura de 2012 só se liga à pessoa por título de eleitor, CPF ou nome + nascimento, nunca por um sequencial de outra eleição.
Actual: `tse_candidatos.py` chama `people.resolve(source="tse", external_id=sq, ...)`. O `SQ_CANDIDATO` é único só dentro da eleição, e a TSE repete números entre 2012, 2014 e 2016, então o `exact_id` vence o título.
Alcance:
- 15.769 pessoas têm o mesmo sequencial em mais de um ano.
- Candidaturas ligadas por colisão: 15.769 em 2012, 687 em 2014 e 15.082 em 2016. A de 2016 é a legítima na amostra.
- Das 15.769 de 2012, 15.649 (99%) têm nome de urna sem nenhum token em comum com o nome civil da pessoa.
- 3.573 eleitos de 2012 e 421 de 2014 estão na colisão, e 3.406 mandatos de 2012 apontam para a pessoa errada.
- Exemplos: Beth Sahão aparece com 2012 "Mauro Eugenio (Mauá/SP)"; Jair Lorenzon, com 2012 "Jair Borges (Salto do Jacuí/RS)"; Lela (PA), com 2012 "Ivaldo Reis".
Heurística pedida (nome de urna sem token em comum com o nome civil): sozinha, gera ruído. Ela marca 61.768 candidaturas, a maioria apelido legítimo ("Fuba", "Tilim", "Ferrugem"). O detector preciso é "mesmo `tse_sequencial` em anos diferentes para a mesma pessoa". Combinado com a heurística, dá 15.649 casos quase certos em 2012.
Fix sugerido: chave externa `tse:{ano}:{sq}` (ou `{eleição}:{sq}`), desligar `exact_id` entre eleições, reprocessar 2012, 2014 e 2016 com o título como chave de identidade, e criar um `check` que falhe se a mesma pessoa tiver o mesmo `tse_sequencial` em anos diferentes.
