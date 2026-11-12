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
Cause (12/11/2026): o Next 15.5.28 vendoriza react-dom 19.2.0-canary-0bdb9206-20250818, que perde o cursor de hidratação quando um elemento HTML suspende durante a hidratação e é reexecutado (compatível com facebook/react#35494, corrigido no React 19.3.0; sem a correção no vendorizado). O perfil é longo (~330 KB); quando a hidratação começa antes do fim do HTML (JS em cache, HTML lento), dá #418, o React recria o documento e o `data-theme` some.
Evidência: build de produção, JS em cache, HTML a 200 KB/s, n=100: 29 #418 na main b095ba9; 0 com a correção; interatividade mediana 416 × 419 ms.
Status: fixed no perfil (PR #30, merge 150ac3b). `AguardaDocumento` (`app/p/[slug]/aguarda-documento.tsx`) faz a raiz hidratar só depois do `DOMContentLoaded`; o HTML do servidor fica na tela, e header e seletor de tema também só respondem depois que o documento termina de chegar (trade-off aceito). E2E de regressão `e2e/bug008-hidratacao-rede-lenta.spec.ts` (30 cargas, sem retry; falha em 9 de 10 execuções sem a correção). Pendências: retirar o contorno quando o Next vendorizar React >= 19.3.0; outras páginas longas do v1 não receberam o contorno (`/representantes?cidade=` deu 0 em 230 cargas em build de produção; a observação antiga era do dev server); se o e2e novo ficar intermitente no CI, investigar, não ignorar.

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
Cause: `react-aria-components` 1.22.1. O Popover adia a revelação até o teclado virtual abrir (`Popover.mjs`: `runAfterKeyboard` → `setIsOpen`, até 600 ms) e, enquanto isso, `useEnterAnimation` (`react-aria/dist/private/utils/animation.mjs:31`) grava inline `opacity:0`, `clip`, `clip-path:inset(50%)` e `mask-image`; `clip-path`/`mask-image` tiram o elemento do hit-testing. Sem toque, `runAfterKeyboard` executa na hora (por isso não reproduzia).
Status: fixed (PR #31, 12/11/2026). `search-combobox.tsx` anula o ocultamento com classes `!important` quando `data-placement` existe. Antes, 1º toque válido em ~460 ms (n=3); depois, 0–1 ms em 20 de 20. F01-E6 mobile toca sem espera e falha contra a main (5/5). Pendências: o mesmo atraso existe em `person-picker.tsx:69` (/comparar, ~635 ms, medido na revisão); em tela de 320 px a lista agora aparece abaixo do campo e pula para cima quando o teclado abre (~0,3 s), a conferir em aparelho real; o `!important` anula qualquer animação futura de entrada no Popover.

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
Correção 2026-11-03 (D220): o crachá agora diz a fonte e o início da filiação vigente, "Partido segundo o Senado, vigente desde 10/09/2026." (Romário, S/Partido), "desde 31/01/2023" (Eliziane, PSD), "segundo a Câmara" para deputado; sem dado, "—" com o motivo. Teste e2e `b022-partido-fonte.spec.ts`: 6 de 6 (desktop, 390 px sem rolagem, escuro, axe limpo). A data é o início do trecho no partido, não a última observação da casa (o `web_reader` não lê `party_observations`). Status: fixed (aguarda reverificação).

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

Reverificação 2026-11-03 (orquestrador, o verificador não tinha o navegador do Playwright): confirmado. ONB-H2 passou 8 de 8 com `--repeat-each 8` contra o dev server :3101.

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
Status: fixed (replica-backend, D200). A regra é a do dicionário de dados (`vlrLiquido = vlrDocumento − vlrGlosa`): quando a fonte publica o oposto exato, vale o devido. Isso pega a subcota 40 e também a 996 (missão oficial). Estorno com documento negativo continua negativo. O complemento da API também duplicava a missão oficial sem documento, e isso foi corrigido junto. 2019–2026 foram recarregados e o `derive.stats` rodado. Antes e depois contra a página: Luciano Vieira 2024 foi de 449.993,86 para 516.374,66 (página 516.374,69); Erika Hilton 2025, de 444.871,49 para 506.616,91 (igual); Socorro Neri (AC) 2024, de 489.824,30 para 584.552,30 (igual); Pastor Diniz (RR) 2025, de 529.871,20 para 621.105,20 (igual); 160541 2025, de 249.604,71 para 435.403,11 (página 435.403,01). São 22 deputado-ano conferidos (17 com complementação ou missão, 5 sem), todos até R$ 0,27. `COTA_REFERENCIA` passou de 10 para 17 pares. Novo `check`: complementação e missão oficial nunca negativas. Os testes estão em `etl/tests/test_cota.py`.
Reverificação 2 2026-11-03: confirmado. A regra só vira linha das subcotas 40 e 996: nos 8 arquivos (2019–2026), 4.345 linhas de complementação e 6 de missão oficial, e nenhuma linha de outra subcota tem líquido = −(documento − glosa). Não há estorno real dessas subcotas que a regra esteja somando: nenhuma linha 40/996 tem líquido positivo na fonte, e todos os negativos que sobram são SIGEPA/RPA com documento negativo, mais as 4 linhas de glosa. Banco = arquivo com a regra em 3.877 de 3.880 deputado-ano, de 2019 a 2026. As 3 diferenças são de R$ 1,00 em 2019, uma linha a menos, anterior a esta correção. Página `camara.leg.br/deputados/{id}?ano=`, fora da `COTA_REFERENCIA`, com moradia: Pedro Paulo (RJ) 2019 dá 384.025,11 contra 384.025,05 só na 56ª (a página não mostra a 55ª; o banco soma o ano, D183); Alan Rick (AC) 2020 432.237,78 =; Talíria Petrone (RJ) 2021 434.919,21 =; Glaustin da Fokus (GO) 2021 388.569,09 =; Geovania de Sá (SC) 2022 444.516,36 =; Duda Ramos (RR) 2023 556.418,59 =; Misael Varella (MG) 2024 498.473,33 contra 498.472,78 (+0,55, nenhuma linha da API); Fábio Teruel (SP) 2025 278.459,79 =. Sem moradia: Zeca Dirceu (PR) 2021 474.339,00 =; Leo Prates (BA) 2025 552.196,55 = (inclui 71.550,36 de SIGEPA da API); Aluisio Mendes (MA) 2023 467.920,35 contra 467.920,34 na 57ª; Pastor Eurico (PE) 2019: a página traz fevereiro a novembro, iguais ao centavo, e omite janeiro (55ª) e dezembro (101.220,69 no arquivo). O tile do crachá mostra o valor do banco arredondado. Ressalva: o D200 diz que as linhas 40/996 vêm "sem `ideDocumento` nem data", mas as da subcota 40 têm `ideDocumento` e as da 996 têm número e data. A regra não depende disso. As 4 linhas de glosa que ficaram sem conferência foram conferidas e divergem da página: ver BUG-034.
Ressalva do texto do D200 corrigida (D233): as linhas da subcota 40 têm `ideDocumento` e não têm número nem data; as da 996 têm número e data e não têm `ideDocumento`.

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
Status: fixed (replica-backend, D202/D203). Antes e depois:
- DF: Ibaneis em exercício → Celina Leão governadora desde 30/03/2026 (CLDF), vice "—" vaga.
- RJ: Castro e Pampolha → "—" nos dois cargos. Governo: "exercício interino pelo presidente do TJ-RJ, desembargador Ricardo Couto, desde 23/03/2026" (STF, Rcl 92644). Vice: vaga desde 21/05/2025 (Alerj).
- RR: Denarium e Damião → "—" nos dois cargos. Damião aparece como governador de 27/03 a 30/04/2026, cassado. Interino: o presidente da ALE-RR. A suplementar está sub judice, e a fonte oficial não confirma quem governa hoje.
- AL: o vice Lessa virou "—" com o motivo (renúncia só na imprensa).
- Sete sucessões ficaram com a data de posse da fonte oficial em vez de 04/04.

As 27 UFs foram conferidas em fonte oficial e estão em `GOVERNO_POR_UF`. O `check` agora confere a pessoa, e não a contagem: antes da correção acusava 21 divergências, depois 0. Teste em `etl/tests/test_governadores.py`. e2e FX-024 (home 25 de 27, RJ e RR nomeados) e FX-031 (Brasília, Rio e Boa Vista) verdes no 3101. O BUG-024 está fechado junto.
Reverificação 2 2026-11-03: confirmado. A tela no 3101 bate com a fonte nas 12 cidades abertas (AC, AL, AM, DF, RJ, RR, MA, PE, SP, RS, TO, RN). A home mostra "Governo do estado 25 de 27" e "Vice-governo 15 de 27". Os crachás de Castro, Ibaneis, Damião e Lessa trazem a saída com data e origem. As 27 UFs foram conferidas por pesquisa independente: nenhuma pessoa em exercício diverge. Pontos sensíveis: RJ, com Ricardo Couto interino, confere com o STF (Rcl 92644, notícia de 24/04/2026 aberta), e o STF tirou o caso de pauta em 19/08/2026 (imprensa). RR: a suplementar de 21/06/2026 segue sem proclamação; em 21/10 o TSE ainda não tinha declarado Arthur Henrique (imprensa, Folha BV), e o interino é Soldado Sampaio. O "—" com motivo nas duas UFs é honesto e claro: diz quem exerce, desde quando e por quê. AL: Dantas esteve licenciado de 14/10 a 30/10/2026 e reassumiu (imprensa); a renúncia de Lessa segue só na imprensa, que cita nota oficial, e a tela diz isso. MA: não há sinal de renúncia de Brandão (DOE-MA de 14/01/2026). PE: o TSE lista Raquel Lyra reeleita com Priscila Krause. Datas de posse oficiais conferem para ES (02/04), MG (22/03), MT (31/03, ALMT), PA (02/04, ALEPA) e PB (02/04, A União). Para AC (02/04) e GO (31/03), a data sai do texto do portal. Ressalvas S4, sem bug aberto: (1) AM: o motivo do vice diz que a eleição de Serafim Corrêa não tem fonte oficial, mas o TJAM (25/08/2026) o chama de vice-governador em exercício. (2) O crachá de Celina Leão diz que "o titular renunciou para disputar outro cargo". Ibaneis renunciou com esse fim, mas desistiu em 08/07/2026; o texto é fixo para toda sucessão.
Ressalvas S4 tratadas (replica-backend, D231 e D232). (1) AM: uma fonte oficial confirma o vice. A ALEAM, em 14/10/2026, cita "o vice-governador do Amazonas, Serafim Corrêa"; a página do TJAM não foi localizada. Ele não está no diretório, e criar a pessoa é trabalho de identidade, por isso o mandato não entrou. O motivo da vaga mudou de "não achamos o ato em fonte oficial" para "Serafim Corrêa é o vice-governador desde 04/05/2026, eleito pela Assembleia Legislativa com o governador (a Assembleia o chama de vice-governador em 14/10/2026); ele ainda não está no diretório do site". (2) O crachá lê o motivo do dado. Celina Leão: "era a vice; o governador renunciou em 28/03/2026, e a posse foi na Câmara Legislativa do DF em 30/03/2026". Mailza: "…o governador renunciou em 02/04/2026". Edilson Damião traz a renúncia e a cassação, com as datas. As 68 sucessões de prefeito da regra D06 dizem que a renúncia é deduzida da candidatura no TSE. e2e `b034-cota-sucessao` verde no 3101.

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

Status: fixed (fix ETL S1, D210 a D213). O loader passa a usar a chave `tse:ANO:SQ`. `civico-etl tse.fix032` conferiu as 196.744 candidaturas contra o `consulta_cand` do próprio ano, pelo título ou por nome + nascimento. 15.811 candidaturas de 2012, em 15.799 pessoas, estavam erradas. 1.051 foram religadas pelo título, com 743 mandatos. 14.760 saíram porque o dono não está no diretório (D34) ou porque a pessoa certa já tinha outra candidatura conferida na eleição, e com elas saíram 2.848 mandatos. Não houve caso ambíguo, e nenhum slug mudou. Depois do reparo, ninguém tem o mesmo SQ em anos diferentes. Roberto Cidade ficou só com 2016 a 2026, e /p/roberto-cidade no 3101 não mostra Fonte Boa. Trilha e cópia do que saiu estão em `identity_repair_log` (migração 0058). O backup pg_dump foi feito antes. Há 3 `check` novos em `checks_identity.py` e o teste `test_identity_bug032.py`.
Reverificação 2 2026-11-03: parcial. As 1.051 religações conferem todas: o título do `consulta_cand_2012` é o da pessoa de destino, nas 1.051. Numa amostra de 15, nome civil e nascimento também batem em 14; a 15ª tem o nome grafado diferente (Jaciberques/Jacibergues). Numa amostra de 15 remoções, o dono pelo título não está no diretório nem por nome + nascimento. Os 5 removidos por conflito são registros substituídos, e a pessoa certa ficou com a outra candidatura. Roberto Cidade e as 5 pessoas sorteadas eleitas em 2012 (Jô/MT, Béa/PE, Vanderlei/MG, Oziel/BA, Claudio Rodrigues/PR) mantêm 2012 e o mandato de 2013. Falha a premissa do D210, de que "o SQ só é único dentro da eleição": em 2012, 91 SQ_CANDIDATO pertencem a duas pessoas de municípios diferentes. Por isso o `tse.fix032` conferiu 8 candidaturas contra a linha errada e removeu do dono verdadeiro: Alcir Costa (prefeito eleito de Santa Maria do Pará), Professor Wander (vice-prefeito eleito de Jundiaí do Sul), Nei (vereador eleito de Salesópolis), Leonora Périco, Alceu Junior, Marcelo Cerrea, Dr. Eurípedes e mais uma de Nei. Com elas saíram 3 mandatos verdadeiros de 2013–2016 de pessoas com crachá. Ver BUG-035. Os 2.848 mandatos removidos incluem esses 3. Achado à parte, não causado pelo reparo: 1.002 prefeitos, vices e vereadores atuais, eleitos em 2012 pelo título, não têm a candidatura de 2012 no banco nem no `identity_repair_log` (BUG-036).

## Reverificação 2 (2026-11-03, reverify.md, seção "Reverificação 2")

### BUG-033: Eli Corrêa Filho (Câmara 160532) fundido em Geninho Zuliani: o prefeito de Olímpia aparece com o nome de outro deputado

- Severity: S1 (identidade errada publicada: nome, gastos e mandato de uma pessoa no crachá de outra)
- Flow / case: F03 / identidade · Screen: S05 · Build: e683a93. O vínculo é de 2026-11-02 23:45, anterior às correções desta noite.
- Browser / device: curl no 3101 e Postgres local

Steps
1. Abrir /p/geninho-sp. O `<title>` e o cabeçalho dizem "Eli Corrêa Filho".
2. `select display_name, civil_name, birth_date from people where slug = 'geninho-sp'` devolve "Eli Corrêa Filho", "Eugenio Jose Zuliani" e 1976-01-13.
3. `person_external_ids` da pessoa tem dois ids da Câmara: 204527 (`name_birth`, Geninho Zuliani) e 160532 (`name_birth_place`).
4. Na API da Câmara, o 160532 é ADRIANO ELI CORRÊA, nascido em 1976-01-13 em São Paulo. Os nomes civis não têm nenhum token em comum.

Expected: o 160532 cria outra pessoa ou vai para a fila. Duas pessoas com a mesma data de nascimento na mesma bancada não são a mesma pessoa.
Actual: a cota de 2019 a 2022 do Eli Corrêa (2021: R$ 335.460,97 no banco) está ligada ao crachá do Geninho, e o nome de exibição foi sobrescrito. O crachá do prefeito de Olímpia (mandato 2025–2029) mostra outro nome.
Cause: `identity.py::resolve`, no ramo `seat`, considera a mesma cadeira (deputado federal · SP) e aceita `display_name` igual **ou** `birth_date` igual. Com 70 cadeiras, uma coincidência de nascimento basta, e o vínculo é gravado como `name_birth_place`, 0,9. Outros dois vínculos por esse método (Átila Lira 74459 e João Carlos Bacelar 74131) não foram conferidos.
Fix sugerido: no ramo `seat`, exigir nascimento igual **e** algum token do nome civil em comum. Desfazer o 160532 e criar a pessoa. Reconferir os 3 `name_birth_place` da Câmara. Criar um `check` para nome civil da fonte sem token em comum com o da pessoa ligada.

Status: fixed (fix ETL S1, D221 a D223). No ramo da cadeira, o `identity.resolve` agora exige o mesmo nascimento **e** algum token do nome civil em comum. Quem já tem outro id da Câmara ou do Senado não é candidato a casar, e o caso ambíguo vai para a fila. O `civico-etl identity.fix033` conferiu contra a API os 12 vínculos `name_birth_place` da Câmara e do Senado. Os 9 do Senado conferem. Os 3 da Câmara eram fusões erradas e foram separados: 160532 (Adriano Eli Corrêa) saiu de `geninho-sp`, 74459 (Átila Freitas Lira, o pai) saiu de `atila` e 74131 (João Carlos Paolilo Bacelar, o pai) saiu de `joao-carlos-bacelar`. Os fatos de 160532 e 74459 foram para pessoas novas, `eli-correa-filho` e `atila-lira` (D227): 1.944 linhas de cota, 27 observações de partido, votos e autorias pelos arquivos, presença refeita e mandatos 2015–2023 pelo TSE. A cota de cada id é igual à do backup e bate com a página: Eli 2021 R$ 335.460,97; Átila pai 2022 R$ 466.379,13. O 74131 não tinha fatos e não ganhou crachá. As 45 presenças do Eli saíram do Geninho. Votos, autorias, comissões, discursos, contatos e equipe foram conferidos na fonte e não tinham linha dos outros. O nome e a foto voltaram aos da Câmara: "Geninho Zuliani" e o novo nome do Bacelar. Os slugs foram mantidos. Tudo está em `identity_split_log` (migração 0060) e no pg_dump `.local/backup-pre-bug033-036_20261103_195050.dump`. A página da Câmara bate com o banco em Geninho 2021 (R$ 449.016,06) e em Átila 2023 (R$ 498.637,76). Check novo: pessoa com mais de um id da Câmara ou do Senado. Teste: `etl/tests/test_identity_bug033.py`. Crachás que estavam publicados com dado de outra pessoa: /p/geninho-sp, /p/joao-carlos-bacelar (foto do pai) e /p/atila (cota e presença do pai de 2019 a 2022).

Reverificação 3 2026-11-03: confirmado. Os 6 ids conferem com a API (`/deputados/{id}`): 204527 Eugenio José Zuliani, 160532 Adriano Eli Corrêa (os dois de 13/01/1976), 123086 Átila de Melo Lira (01/04/1980), 74459 Átila Freitas Lira (07/04/1947), 141458 João Carlos Paolilo Bacelar Filho (08/10/1972) e 74131 o pai (03/12/1941), que não tem crachá. Nome civil, nascimento e foto (`bandep/{id}.jpg`) estão certos nos 5 crachás. Mandatos: Eli e Átila pai têm deputado federal 2015–2019 e 2019–2023, pelas linhas do TSE 2014/2018 com o título deles. Cota, 1 ano cada, contra `camara.leg.br/deputados/{id}?ano=`: Geninho 2022 dá 425.427,63 contra 425.427,60 no banco; Átila filho 2024, 580.149,83, igual; Bacelar filho 2020, 451.998,34, igual; Átila pai 2020, 309.626,32, igual; Eli 2019 dá 424.744,93 na página, só a 56ª, contra 447.053,33 no banco, e a diferença é exatamente janeiro da 55ª mais a complementação (22.308,40, D183/D200). Cada um dos 731 ids da Câmara com cota está numa pessoa só, a que tem esse id. Os 6.939 votos dos 5 estão todos em `votacoesVotos` sob o id da própria pessoa: 0 votos de outro id. A diferença para o arquivo é só de votação de comissão, que não é carregada. As 2.882 presenças também batem com `eventosPresencaDeputados` pelo id: todo 'presente' está no arquivo, e nenhum 'ausente' está. A correção vale para Câmara e Senado. A mesma classe de fusão, por nome civil + nascimento sem lugar, segue aberta no TSE: ver BUG-038.

### BUG-034: cota com glosa e líquido negativo (subcotas 3 e 120, 2020–2021) não bate com a página: banco R$ 7,7 mil a 26,8 mil abaixo

- Severity: S2 (número publicado errado em 3 deputado-ano, de 1,6% a 5,8%)
- Flow / case: F03 / dado contra fonte · Screen: S05 · Build: e683a93. São as 4 linhas que o D200 deixou de fora "não conferido na página".

Steps
1. `Ano-2020.csv`, Eduardo Bolsonaro (92346), fevereiro, subcota 120: `vlrDocumento` 6800, `vlrGlosa` 3834, `vlrLiquido` -868.
2. camara.leg.br/deputados/92346?ano=2020 mostra cota 318.370,74 e fevereiro 51.589,32. O banco e o crachá dão 310.702,74 (R$ 310.703), com fevereiro 43.921,32 no arquivo.
3. Mês a mês, a página bate com o arquivo em todos os meses, menos no mês da linha de glosa.

Expected: total igual ao da página.
Actual (página contra banco, diferença só no mês da linha):
| Deputado | Ano | Página | Banco | Diferença | Linha (doc / glosa / líquido) |
|---|---|---|---|---|---|
| Eduardo Bolsonaro (92346) | 2020 | 318.370,74 | 310.702,74 | +7.668,00 (fev) | 6800 / 3834 / -868 |
| Enio Verri (132504) | 2020 | 423.942,17 | 416.179,51 | +7.762,66 (out) | 6550 / 4431,33 / -1762,66 |
| Eduardo da Fonte (141421) | 2021 | 491.252,01 | 464.478,01 | +9.374,00 (ago) e +17.400,00 (set) | 8700 / 4687 / -674 e 8700 / 7683 / -6666 |
A página não subtrai o líquido negativo. Em três das quatro linhas, o mês da página é o do arquivo com a linha trocada por um valor positivo: 6.800 e 8.700 (`vlrDocumento`) e 6.000. A regra exata da página não foi deduzida.
Cause: `cota_liquido` só corrige o caso líquido = −(documento − glosa), e essas linhas são outro padrão. É provável que sejam ajustes de glosa publicados no líquido da mesma linha.
Fix sugerido: decidir a regra em decisions.md com mais casos da página. O candidato é contar `vlrDocumento` quando `vlrLiquido < 0` e `vlrDocumento > 0` fora das subcotas 998/999. Pôr um desses 3 pares na `COTA_REFERENCIA`.
Status: fixed, com 2 casos documentados sem correção (replica-backend, D230). A página soma `vlrDocumento` quando a linha tem glosa e `vlrLiquido = vlrDocumento − 2·vlrGlosa`, salvo no rateio em que a glosa aparece como líquido de outra linha do mesmo documento. Isso foi conferido em 11 de 11 linhas de 2019–2026: a diferença do mês é exatamente 2 × glosa. O candidato do bug, "documento quando o líquido é negativo", erraria o Enio Verri e não pegaria 8 linhas de líquido positivo. Antes e depois, contra `camara.leg.br/deputados/{id}?ano=`:
| Deputado | Ano | Página | Antes | Depois |
|---|---|---|---|---|
| Eduardo Bolsonaro (92346) | 2020 | 318.370,74 | 310.702,74 | 318.370,74 = |
| Eduardo da Fonte (141421) | 2021 | 491.252,01 | 464.478,01 | 491.252,01 = |
| Enio Verri (132504) | 2020 | 423.942,17 | 416.179,51 | 416.179,51 (sem mudança: a página soma 6.000,00 na linha 6550/4431,33/−1762,66, e nenhum campo explica isso) |
| Daniel Trzeciak (204409) | 2022 | 354.958,17 | 352.526,55 | 354.958,17 = |
| André Ferreira (204423) | 2022 | 488.548,22 | 488.464,22 | 488.548,22 = |
| Lafayette de Andrada (98057) | 2025 | 523.494,83 | 522.437,85 | 523.494,83 = |
| Félix Mendonça Júnior (160666) | 2024 | 458.510,22 | 452.422,22 | 455.466,22 (agosto fecha; julho, 9370/0/4804, fica 3.044,00 abaixo) |
| Da Vitoria (204355) | 2019 | só a 56ª, sem dezembro | 387.578,11 | 388.509,29 (setembro e outubro fecham com a página) |
`COTA_REFERENCIA` ganhou Bolsonaro 2020, Eduardo da Fonte 2021 e Trzeciak 2022. Testes em `etl/tests/test_cota.py` e e2e `web/e2e/b034-cota-sucessao.spec.ts`. Enio Verri 2020 e Félix Mendonça Júnior 07/2024 ficam com o valor da fonte, documentados no D230.

Reverificação 3 2026-11-03: confirmado. Conferi 5 deputado-ano com glosa fora do relatório, página contra banco: Bia Kicis 2019 (é o rateio da exceção), Orlando Silva 2019 (8920/1035,20/8841,80), Amaro Neto 2022 (30000/11998/11179,70), Hélio Leite 2023 e Murillo Gouvea 2024 (16000/12287/2382,08). Em todos, os meses da página batem com o arquivo mais a regra. Os totais também: Amaro 448.341,54 contra 448.341,55 e Murillo 493.442,93 contra 493.442,92. Os outros três diferem só pelo que a página não mostra: dezembro de 2019 (Bia Kicis) e o mês da outra legislatura. Liziane Bayer 06/2019, que é d−2g, fecha com a página pela regra, mas ela não está no diretório. A regra se sustenta. A assinatura `líquido = documento − 2·glosa` é aritmética exata e só aparece em 12 linhas de 2019–2026. As 11 batem com a página, e a 12ª é o rateio. As cerca de 400 linhas/ano com glosa e outro padrão ficam como a fonte publica, e a página concorda nas 3 conferidas. Ressalva: a exceção do rateio sai de um caso só (n=1). O mecanismo é mais largo que a regra, porque a página também soma 2 × um valor que o arquivo não traz como glosa (Isnaldo 03/2023, Félix 07/2024). Ver BUG-037. Banco contra o backup pré-correção: só 7 deputado-ano mudaram, e cada diferença é exatamente 2 × glosa.

### BUG-037: cota de 7 deputado-ano com meses da página muito acima do arquivo e da API, sem relação com nenhuma linha

- Severity: S3 (divergência contra a página, causa não determinada; pode ser da página)
- Flow / case: F03 / dado contra fonte · Screen: S05 · Build: achado na varredura do BUG-034 (D230)

Steps
1. camara.leg.br/deputados/90842?ano=2021 (Santini): janeiro 86.467,45, fevereiro 79.873,37 e março 98.648,54. No `Ano-2021.csv.zip`, esses meses somam 30.620,57, 27.795,14 e 37.693,44, e a API do mês 3 dá 37.689,01.
2. Mesmo padrão, um mês por caso: Marcelo Brum 03/2022 (+65.749,46), Bia Cavassa 03/2022 (+70.185,09), Pedro Dalua 03/2022 (+58.179,10), Jhonatan de Jesus 02/2023 (+36.372,66), Isnaldo Bulhões Jr. 03/2023 (+18.514,00), Prof. Paulo Fernando 01/2024 (+7.388,92; arquivo e API só têm 3.671,18 no mês).

Expected: total igual ao da página, ou uma explicação de onde vem o valor da página.
Actual: o banco fica com o valor do arquivo e da API, e a página mostra muito mais.
Cause: não determinada. São suplentes ou deputados com pouco tempo de mandato, e é provável que a página some outro período ou outro id. Não é o padrão da glosa.
Fix sugerido: abrir a consulta `cota-parlamentar/sumarizado` por tipo de despesa nesses meses e comparar com o arquivo, antes de decidir se é defeito nosso.

Reverificação 3 2026-11-03: parcial. Não é defeito do clone, e em 6 dos 7 casos não há divergência nenhuma. A página tem duas tabelas "Gasto mensal": a da cota e, logo abaixo, a da **verba de gabinete**. O script da varredura do D230 leu a segunda quando a da cota tinha poucos meses. Com o recorte certo, a cota da página é igual ao arquivo: Santini 01–03/2021 (30.620,57, 27.795,14 e 37.693,44), Marcelo Brum 03/2022 (42.196,88), Bia Cavassa 03/2022 (35.719,58), Pedro Dalua 03/2022 (53.449,11), Jhonatan de Jesus 02/2023 (81.743,13) e Prof. Paulo Fernando 01/2024 (3.671,33). Os números do bug (86.467,45 etc.) são a verba de gabinete. Só Isnaldo Bulhões Jr. 03/2023 diverge de verdade: a página dá 44.926,63, contra 26.412,63 no arquivo. A diferença, 18.514,00, é exatamente 2 × (10.985 − 1.728) na linha de locação 10985/0/1728. É a mesma assinatura "2 × glosa" do BUG-034, com a glosa ausente do arquivo (`vlrGlosa` = 0), e a API não traz o mês. É divergência da fonte e da página, e o clone segue o arquivo, como o D230 decidiu para Félix 07/2024. Proposta: fechar como "não é defeito do clone", com o caso Isnaldo documentado no D230. O D230 também se apoiou nessa varredura ("7 meses diferem de R$ 7 mil a 70 mil"), e o texto deve ser corrigido.

Status: closed, não é defeito do clone (D239). O texto do D230 foi corrigido: 6 dos 7 eram falso positivo, porque a varredura leu a "Verba de gabinete". Só Isnaldo 03/2023 é real, e é divergência da fonte (2 × glosa ausente do arquivo). O clone segue o arquivo.

### BUG-035: em 2012 o SQ_CANDIDATO não é único na eleição; o `tse.fix032` removeu 8 candidaturas do dono verdadeiro (3 mandatos)

- Severity: S2 (histórico eleitoral verdadeiro apagado de 8 crachás. Alcir Costa perde o mandato de prefeito 2013–2016, e Professor Wander o de vice-prefeito)
- Flow / case: F03 / identidade · Screen: S05 · Build: e683a93 (efeito do reparo do BUG-032)

Steps
1. `consulta_cand_2012_BRASIL.csv`: o SQ 140000001581 aparece em BOM JESUS DO TOCANTINS (vereador, Valmir Aguiar) e em SANTA MARIA DO PARÁ (prefeito ELEITO, Alcir Costa da Silva, título 020007371309).
2. `identity_repair_log` tem 140000001581 como `removido`/`sem_pessoa` de `alcir-costa`, com `raw.fonte` de outra linha. A pessoa `alcir-costa` tem esse título em `tse-titulo`.
3. /p/alcir-costa não mostra a candidatura a prefeito de 2012 nem o mandato de 2013–2016.

Expected: com SQ repetido, a candidatura casa pela linha do mesmo município/cargo (ou pelo título), e não por "a primeira linha com o SQ".
Actual: há 91 SQ de 2012 com duas pessoas, e em 2014 a 2026 nenhum. Eles levaram a 8 falsas remoções (todas `sem_pessoa`): 140000001606 marcelo-cerrea, 90000001360 dr-euripedes, 250000004507 nei-do-ze-do-anisio (2×, 1 mandato), 250000004379 leonora-perico, 140000001581 alcir-costa (1 mandato), 250000004509 alceu-junior, 160000001562 professor-wander-pr (1 mandato). Outras 11 pessoas do diretório não têm a candidatura de 2012 desses SQ, e a chave `tse:2012:SQ` não identifica a candidatura nesses 91 casos.
Cause: a premissa do D210 ("o SQ só é único dentro da eleição") não vale para 2012. O `fix032` busca a linha da fonte só por (ano, SQ).
Fix sugerido: em 2012, chave `tse:2012:UE:SQ`, ou conferência por (SQ, SG_UE, cargo). Restaurar as 8 de `identity_repair_log.raw` e os 3 mandatos. Criar um `check` para candidatura removida cujo `from_person` tem o título de alguma linha do SQ.

Status: fixed (fix ETL, D224 e D225). A chave de 2012 passa a ser `tse:2012:UE:SQ`, e a linha da fonte de uma candidatura é a do SQ + município da disputa + tipo de eleição (o `tse.fix032` usa a mesma regra). O `civico-etl tse.fix035` restaurou 7 candidaturas e os 3 mandatos: Alcir Costa, Professor Wander, Nei (Salesópolis), Leonora do Postinho, Alceu Junior, Marcelo Corrêa e Dr. Eurípedes. A 8ª remoção, a "segunda do Nei", é a suplementar de Canas de Gilberto da Laje, que é outra pessoa, e continua removida. Achado novo: o `fix032` também religou errado a candidatura e o mandato 2013–2016 de Mané da Ambulância (Salto do Itararé) para `joao-ardigo`. Isso foi corrigido. Resultado nas 91 duplas: 13 linhas no banco na pessoa certa, 166 de pessoas fora do diretório, 3 de suplentes do diretório que a carga, só de eleitos, não traz, e nenhuma na pessoa errada. Checks novos: formato da chave de 2012; chave sem candidatura da pessoa; candidatura sem chave; e mesma pessoa com o mesmo SQ em dois municípios. O check pedido, que precisa do CSV, não cabe em SQL; o último check é o sintoma equivalente. Teste: `etl/tests/test_identity_bug035.py`.

Reverificação 3 2026-11-03: confirmado. As 7 restaurações batem com o `consulta_cand_2012` em título, município, cargo, número e tipo de eleição: Alcir Costa (prefeito na suplementar de Santa Maria do Pará, mandato de 18/01/2015), Professor Wander (vice em Jundiaí do Sul, mandato de 07/12/2014), Nei (vereador em Salesópolis, 2013–2016), Leonora do Postinho, Alceu Junior, Marcelo Corrêa e Dr. Eurípedes. Mané da Ambulância está em `mane`, com o título 242839240108 e o mandato de 2013. `joao-ardigo` ficou só com a própria suplementar de Rolândia e a vereança de 2013. Reproduzi a auditoria das 91 duplas (182 linhas): 13 no banco na pessoa certa, 166 fora do diretório, 3 suplentes do diretório sem a candidatura e 0 na pessoa errada.

### BUG-036: 1.002 prefeitos, vices e vereadores atuais eleitos em 2012 não têm a candidatura de 2012 no banco

- Severity: S3 (histórico incompleto no crachá; não é dado errado)
- Flow / case: F03 / cobertura · Screen: S05 · Build: e683a93. Não foi causado pelo `fix032`: nenhuma dessas SQ está no `identity_repair_log`, exceto 4 (BUG-035).

Steps
1. Cruzar quem está em exercício como prefeito, vice ou vereador com as linhas ELEITO do `consulta_cand_2012` pelo título: 13.652 pessoas.
2. Dessas, 1.002 não têm a candidatura eleita de 2012 nem o mandato de 2013. Exemplos: davi-davino (vereador de Maceió), suzy-higino (prefeita de Olho d'Água Grande), paulinho-zaquette (Corbélia) e lauro-bandeira (Domingos Mourão).
3. Em 171 delas, o mesmo número de SQ é usado por outra candidatura do banco em outro ano, o que sugere a colisão antiga do BUG-032. Nas outras 831, o SQ está livre.

Expected: pela D34, quem tem mandato atual traz as eleições antigas.
Actual: o crachá começa em 2016 para essas pessoas.
Cause: não determinada. A hipótese é que a candidatura de 2012 colidiu antes do reparo e caiu na regra de registro substituído do loader, e o `fix032` só reconfere o que está no banco.
Fix sugerido: rodar `tse.candidatos 2012` de novo com a chave nova, para quem tem crachá, e conferir pela mesma contagem (meta: 0).

Status: fixed (fix ETL, D226). Causa, conferida contra o backup de antes do `fix032`: em 950 casos, a colisão do BUG-032 tinha posto na pessoa a candidatura de 2012 de outra pessoa, e a própria foi rejeitada na carga como "outra candidatura na mesma eleição". O `fix032` removeu a errada, mas não recarregou a certa. Mais 32 casos estão em municípios renomeados pelo IBGE, 18 tinham a chave SQ de outra pessoa e 2 são do BUG-035. 2012 foi recarregado por UF, com a chave `2012:UE:SQ` e 17 grafias novas no `TSE_TO_IBGE`. A regra de registro substituído do loader passou a comparar (disputa, SQ), porque o PA falhava com o caso do Divino. Resultado: de 1.002 sem candidatura para 0, entre 13.652. Amostra de 10 contra o CSV: 10 de 10 batem em nome de urna, resultado, cargo, município, número e mandato 2013–2016.

Reverificação 3 2026-11-03: parcial. Reproduzi a população: 13.652 em exercício eleitos em 2012 pelo título. Numa amostra de 10 com semente 20261103, a candidatura de 2012 e o mandato de 2013 batem com o CSV em 10 de 10 (Carlitinho/BA, Careca/MG, Balestrin/SC, Cleber/PB, Tõe Cepim/BA, Gerson do Gesso/PB, Ramon de Sena/BA, Dr. Alando Lima/AL, Chico/PR e Marcília do Neném/MG). Falta 1: `divino-pa`. O banco tem a candidatura INAPTO/#NULO# (140000018474), sem resultado e sem mandato. A eleita (140000021364), com o mandato de 2013–2016, foi removida pelo `fix032` como 'conflito' e não voltou (BUG-039). A recarga por UF não criou duplicata: 0 pessoas com duas candidaturas na mesma disputa (cargo, lugar, ano, tipo e turno) em 2012. Os 20 casos desse tipo no banco são suplementares de 2016–2024, anteriores a esta correção (ver reverify.md). Contra o backup, só entraram candidaturas (2012: +1.040; 2014/2018: +2 cada), nenhuma saiu, e 1 mudou de pessoa (Mané).

## Reverificação 3 (2026-11-03, reverify.md, seção "Reverificação 3")

### BUG-038: fusão por nome civil + nascimento no TSE: 7 pessoas têm o título de outra pessoa que concorreu na mesma eleição, 4 delas com a candidatura do outro no crachá

- Severity: S2. Candidatura e título de eleitor de outra pessoa no crachá. Não troca nome nem gasto, ao contrário do BUG-033, mas é identidade errada publicada.
- Flow / case: F03 / identidade · Screen: S05 · Build: cf1dcde. Os vínculos são de 2026-11-02 e 03, anteriores ao fix do BUG-033, que não cobriu o TSE.
- Browser / device: curl no 3101, Postgres local e `consulta_cand` 2012–2026 do cache do ETL

Steps
1. Listar quem tem 2 ou mais `tse-titulo`: 31 pessoas. Cruzar cada título com o `consulta_cand` de todos os anos.
2. Em 7 delas, os dois títulos aparecem como candidatos **na mesma eleição ordinária, em municípios diferentes**. Ninguém concorre em dois lugares na mesma eleição, então são duas pessoas com o mesmo nome civil e o mesmo nascimento.
3. /p/repolhinho (vereador de Rio Grande/RS) mostra "2018 Deputado estadual · Maranhão · PRTB · Suplente" e 2014 idem. Em 2012, os dois José Antonio da Silva (20/05/1963) concorreram, um em São Luís/MA (título 000597921198) e outro em Rio Grande/RS (009924220418).

Expected: um título de eleitor diferente é indício de outra pessoa. Com dois títulos na mesma eleição, é prova. O vínculo vai para a fila ou cria outra pessoa.
Actual:
| Crachá | Fato de outra pessoa no crachá | Prova |
|---|---|---|
| repolhinho (RS) | dep. estadual MA 2014 e 2018 (Antonio Na Moral / Antonios Coiffeur) | os dois concorreram em 2012 |
| joaozao (Bernardo Sayão/TO) | vereador Mauá da Serra/PR 2020 (João Batista Corretor) | os dois concorreram em 2016 e 2020 |
| malufao (Gabriel Monteiro/SP) | vereador Pojuca/BA 2020 (Nego Bia) | os dois concorreram em 2016 |
| claudia-do-severino (Paineiras/MG) | vereadora Brejolândia/BA 2020 | as duas concorreram em 2024 |
| cida-da-saude-rn, luciano-dias, paulinho-do-rodolfo | só o título do outro (sem candidatura no banco hoje) | os dois concorreram em 2020/2024 |
Prováveis, sem a prova da mesma eleição: gordo (Nova Laranjeiras/PR, com a candidatura "Moca" de Bom Jardim de Minas/MG 2016), joao-preto (Brasil Novo/PA, com Japeri/RJ 2020) e gato-da-corrida (título de Itu/SP). E ze-galinha tem a candidatura de 2016 "Piqueno", que no CSV traz outro nome civil (Manoel Juvenil Pereira de Sousa) e outro nascimento (30/11/1983). Ela foi ligada pelo título, que o TSE repete nessa linha.
Cause: `identity.resolve`, ramo `name_birth`. Nome civil (ou nome de exibição) + nascimento únicos no diretório inteiro bastam, sem UF nem município. O título novo é então anexado à pessoa (`link(..., "tse-titulo", ...)`). `tse-titulo` não está em `SINGLE_ID_SOURCES`, então a trava do D221 ("quem já tem outro id da casa não é candidato") não vale para o título. Os outros 18 casos de dois títulos são a mesma pessoa, no mesmo município, com título reemitido.
Fix sugerido: no `resolve` do TSE, quem já tem um título diferente do da linha não casa por nome + nascimento, e o caso vai para a fila (exceção: título reemitido no mesmo município). Separar as 7 com a trilha do `identity_split_log`. Check novo: pessoa com dois títulos que aparecem na mesma eleição (o CSV é necessário; dá para gravar o par título × ano de cada candidatura e checar em SQL).

Status: fixed (fix ETL, D235–D237).
- `resolve`: o título passa a ser id forte. Com título diferente, nunca casa. Nome civil + nascimento exige lugar em comum (UF da linha ou de nascimento na trajetória da pessoa). Sem prova, a linha vai para a fila.
- `link_past_roster`: o nome de urna também ganhou a trava do id único.
- `civico-etl identity.fix038` separou os 7 casos e os 4 prováveis, todos conferidos no `consulta_cand` 2012–2026. 8 candidaturas, com bens, despesas de campanha e votos por lugar, foram para 7 pessoas criadas a partir da fonte: `antonios-coiffeur`, `joao-batista-corretor`, `nego-bia`, `claudia-da-lagoa-nova`, `moca-mg`, `joao-do-marajoara` e `piqueno-to`. 4 títulos sem fato saíram (cida-da-saude-rn, luciano-dias, paulinho-do-rodolfo e gato-da-corrida). Os slugs dos donos foram mantidos, e tudo está em `identity_split_log`.
- As candidaturas próprias que a fusão bloqueava foram recarregadas: joaozao 2020, Nego Bia 2016, Corretor 2016 e Claudia de Brejolândia 2024.
- Check novo sobre `tse_titulo_candidatura` (migração 0065), com 0 hoje; ele pega a fusão do repolhinho de volta.
- Auditoria da ALESP (216 vínculos) e da ALEMG (24): 0 vínculos errados.
- Teste: `etl/tests/test_identity_bug038.py`.

Reverificação 4 2026-11-03: confirmado, com 1 fusão da mesma família aberta noutro caminho (BUG-041). Os 18 crachás (11 donos e 7 criados) batem com o `consulta_cand` 2012–2026, linha a linha. Conferi nome civil, nascimento, título, município, cargo, partido e resultado de cada uma das 35 candidaturas, e os mandatos seguem as candidaturas eleitas. Os pares separados são de pessoas diferentes pela fonte: 7 concorrem na mesma eleição ordinária em municípios diferentes. Nos 4 prováveis, Gordo e Moca nasceram no PR e em MG, João Preto e João do Marajoara no PR e no ES, e Gato da Corrida e "Roberto Oluran" (Itu) só perderam o vínculo. Corretor tem o nascimento 1956 na linha de 2016 e 1958 na de 2020, com o mesmo título, e o banco ficou com 1958. Ze-galinha manteve os 2 títulos (037087402712, que o TSE repete na linha do Piqueno 2016, e 029985402747). Varredura de fusões que sobraram, com as 183.034 candidaturas ligadas à linha da fonte por ano, SQ, tipo de eleição e município (442 sem par por grafia de município, todas conferidas por amostra):
- 62 pessoas com candidaturas em UFs diferentes. Todas têm o mesmo título em todas as linhas, ou seja, mudaram de domicílio. Nenhuma está sem ponte.
- 20 com títulos diferentes. Todas no mesmo município, com nome e nascimento iguais: reemissão.
- 1.313 com nascimento divergente e 2.906 com nome civil divergente entre linhas. Em todas, o título é o mesmo. São erros de digitação, nome social ou casamento, exceto 1 caso: `willya-do-rampa` (BUG-041).
- Homônimos no banco (nome civil e nascimento iguais em pessoas diferentes): só os 7 pares do D236. Nenhuma pessoa legítima foi separada pela regra "título diferente sem lugar em comum".
- Reemissão legítima no mesmo lugar: simulei o `resolve` sem gravar. Com a grafia do banco, Eloisa 2016 e Nelson Gasperin 2012 vão para a fila, como a D235 promete. Com a grafia da linha da fonte (ELOISA × Eloiza, GASPERIM × Gasperin), dão "new" e caem fora do diretório, sem fila nem aviso (BUG-042).
- 2022–2026: 0 eleitos fora do banco, fora suplentes de senador. A regra nova não barrou nenhum mandato atual.

### BUG-039: Divino (São João do Araguaia/PA) perdeu a candidatura eleita de 2012 e o mandato 2013–2016; o banco ficou com o registro INAPTO

- Severity: S3 (histórico errado num crachá: candidatura sem resultado no lugar da eleita)
- Flow / case: F03 / identidade · Screen: S05 · Build: cf1dcde (efeito do `fix032`; não corrigido pelo D226)

Steps
1. `consulta_cand_2012`, título 026251031350: SQ 140000018474 é VEREADOR, #NULO#, INAPTO; SQ 140000021364 é VEREADOR, ELEITO POR QP, APTO; os dois em São João do Araguaia, eleição ordinária, número 13233.
2. No banco, `divino-pa` tem só a 140000018474, sem resultado e sem mandato de 2013. A chave `2012:05495:140000021364` está na pessoa, mas não há candidatura com ela em ninguém.
3. `identity_repair_log` 9964: a 140000021364 foi `removido`/`conflito`, com 1 mandato removido.

Expected: entre um registro substituído e o deferido e eleito, fica o eleito, com o mandato.
Actual: o crachá mostra a vereança de 2012 sem resultado e começa os mandatos em 2021. A meta do BUG-036 ("0 sem a candidatura de 2012") fica em 1 de 13.652.
Cause: a regra de registro substituído (D211, loader e `fix032`) mantém a candidatura que já estava e descarta a outra, sem olhar situação nem resultado. O check novo "chave 2012:UE:SQ sem candidatura" só dispara quando a candidatura existe noutra pessoa, então não pega o caso. Nos outros 4 'conflito' do D211, ficou a certa: Felipe Pessoa, Arnaldo e Romualdo ficaram com a eleita, e Ricardo da Loja não está no diretório. Caso análogo em 2026: `chico-mendes` tem a candidatura #NULO a deputado estadual da PB, e a de 1º suplente de senador, ELEITO (150002549794), não foi carregada.
Fix sugerido: no registro substituído, preferir APTO/eleito. Restaurar a 140000021364 e o mandato a partir de `identity_repair_log.raw`. O check deve olhar também a chave sem candidatura em ninguém.

Status: fixed (fix ETL, D238). No loader e no `tse.fix032`, entre registros da mesma pessoa, da mesma disputa e com o mesmo número, fica o de maior posto (eleito > foi à urna > INAPTO/#NULO#). O inferior sai inteiro para `identity_repair_log` (BUG-039/`substituido`). A recarga de PA 2012 deixou `divino-pa` com a 140000021364 (ELEITO POR QP) e o mandato 2013–2016. O check novo ("título com linha ELEITO na fonte e pessoa sem candidatura eleita no ano") dava 3 (Divino, e Serafim Corrêa 2014 e 2018, carregados agora) e dá 0. Não tratado: chico-mendes 2026, que não é a mesma disputa (suplente de senador não é carregado).

Reverificação 4 2026-11-03: parcial. Divino está certo contra o CSV: 140000021364, APTO, ELEITO POR QP, nº 13233, mandato 2013–2016 e bens de R$ 148.500,00. A INAPTO 140000018474 saiu. Na amostra de 5 disputas com registro substituído (semente 20261103), 4 ficaram com o registro certo: Marcelo Coelho (Feira Nova/PE 2012, suplente), Cleudiomar (Barreirinhas/MA 2016, eleito), Lindomar Castro (Planaltina/GO 2016, eleito) e Emidinho Madeira (dep. fed. MG 2018, eleito). A 5ª é Dr. Elio da Mata (Itabirito/MG 2016, suplementar), que tem os 2 registros no banco: o INAPTO sem resultado e o ELEITO. A varredura completa, porém, não fecha. São 151 disputas da fonte com 2 ou mais registros da mesma pessoa (título, disputa e número) que estão no banco:
- 116 ficaram com o de maior posto.
- 19 têm os 2 registros no banco. As 19 são suplementares (conferido pelo tipo de eleição na fonte), do grupo dos 20 já anotados na Reverificação 3.
- 16 ficaram com o registro inferior: INAPTO/#NULO# no lugar de um APTO que foi à urna. Nenhuma perde eleito, e por isso o check do D238 não pega. Isso está no BUG-043.

A regra do D238 vale para o loader e o `fix032`, mas o que já estava no banco não foi varrido.

### BUG-040: e2e vermelho: FX-024 e B034-3 esperam o vice do AM como lacuna, mas o D228 criou Serafim Corrêa

- Severity: S3 (suíte de regressão quebrada; o produto está certo)
- Flow / case: e2e / governo estadual · Screen: S04 · Build: cf1dcde

Steps
1. `E2E_BASE_URL=http://localhost:3101 E2E_PG=1 npx playwright test --output test-results-reverify3`.
2. `fixui.spec.ts:30` (FX-024) e `b034-cota-sucessao.spec.ts:25` (B034-3) procuram `getByTestId('lacuna').filter({ hasText: /Vice-gov/ })` em /representantes?cidade=1302603 e não acham.
3. A página mostra "SC Serafim Corrêa Vice-governador", e /p/serafim-correa diz "situação segundo a Assembleia Legislativa do Amazonas".

Expected: os testes acompanham o dado (D228 e cf1dcde).
Actual: 2 falhas, nas 2 tentativas. O D229 só rodou pytest e `check`, e o D234 rodou o B034 antes do D228.
Fix sugerido: trocar as duas asserções para "vice-governador Serafim Corrêa, situação segundo a Assembleia Legislativa do Amazonas". A lacuna do vice pode ser exercitada em outra UF com vaga (DF ou RR).

Status: fixed (6ab7fa8, testes acompanham o D228)

Reverificação 4 2026-11-03: confirmado. Na suíte inteira contra o 3101, FX-024 (`fixui.spec.ts:31`) e B034-3 (`b034-cota-sucessao.spec.ts:26`) passaram nas 2 rodadas completas, sem retry. Os testes ainda servem para algo. O FX-024 prende o que o D228 mudou: Serafim Corrêa aparece em Manaus e não há lacuna de vice. A lacuna "—" do vice segue coberta pelo FX-031 (DF, "quem era vice assumiu o governo"). Ressalvas:
- O B034-3 ficou fraco. `getByText(/Vice-governador/).first()` passa com qualquer menção a vice-governador no crachá, e o teste não confere a posse de 04/05/2026 nem se é um mandato em exercício. O motivo da sucessão do AM saiu da suíte sem substituto.
- O B034-3 roda sem `test.skip(!PG)`, ao contrário do FX-024.
- O BUG-040 não recebeu linha de Status no 3da7ef4.

Ressalva do B034-3 tratada (fix ETL, D244): o teste agora prende o mandato em exercício de vice-governador do AM, com "de 04/05/2026" e a ALEAM como fonte, no item `li[data-status="em_exercicio"]` da seção de mandatos, e não qualquer menção a vice-governador. O `test.skip(!PG)` já valia para o B034-3, porque está no `describe`. Verde contra o 3101 (`--output test-results-b041`).

### BUG-041: fusão pelo título repetido do TSE: willya-do-rampa mostra a candidatura de 2012 e a filiação ao PTB de outra pessoa (Virginia Pereira de Oliveira)

- Severity: S2. Candidatura e partido de outra pessoa (outro nome civil, outro sexo, outro nascimento) no crachá de um vereador em exercício. É a mesma família do BUG-038 (caso ze-galinha), pelo caminho que a D235 deixou aberto de propósito.
- Flow / case: F03 / identidade · Screen: S05 · Build: 3da7ef4
- Browser / device: curl no 3101, Postgres local e `consulta_cand` 2012–2026 do cache do ETL

Steps
1. `consulta_cand_2012`, Cachoeira de Goiás/GO, vereador: SQ 90000003345, nº 14222, PTB, "VIRGINIA", VIRGINIA PEREIRA DE OLIVEIRA, 26/08/1993, INAPTO/#NULO#. O título é 025677851031.
2. `consulta_cand_2020` e `_2024`, mesmo município: "WILLYAN DO RAMPA" / "WILLYA DO RAMPA", WILLYA JOSÉ DA SILVA, 20/04/1972, PDT, com o mesmo título 025677851031.
3. /p/willya-do-rampa mostra "2012 Vereador · Cachoeira de Goiás · GO PTB Renunciou à candidatura". `party_memberships` dá PTB de 07/10/2012 a 15/11/2020. A chave `tse:2012:92835:90000003345` foi ligada em 2026-11-03 20:01, na recarga de 2012.

Expected: com nome civil, sexo e nascimento diferentes, a linha é de outra pessoa, mesmo com o título repetido. Ela não entra (D34) ou vai para a fila.
Actual: o `resolve` casa pelo título antes de olhar o nome (D235, "onde quebra"). A simulação sem gravar dá `exact_id` para a linha da Virginia.
Cause: título é tratado como prova suficiente. O TSE repete o título de outra pessoa em algumas linhas (ze-galinha × Piqueno 2016, e este caso). O D237 diz que não há check SQL porque o banco não guarda o nome civil de cada linha.
Como achei: liguei as 183.034 candidaturas à linha da fonte e procurei pessoas cujas linhas têm nomes civis sem nenhum token em comum. Saíram 5: 4 são nome social ou grafia (Erika Hilton, Benny Briolly, Sarita, Dionisio) e 1 é este. Em nascimento divergente com no máximo 1 token em comum, saíram mais 3, todos da mesma pessoa.
Fix sugerido: no ramo do título, exigir que nome civil ou nascimento batam com a pessoa (um dos dois). Sem isso, a linha vai para a fila. Mover a candidatura de 2012 e a filiação ao PTB para fora de willya-do-rampa, com trilha no `identity_split_log`. O check pode usar `tse_titulo_candidatura` se ela passar a guardar nome civil e nascimento da linha.

Status: fixed (fix ETL, D240 e D243).
- `resolve`: título igual com nascimento diferente E nome civil sem nenhum token em comum com a pessoa não casa. A linha segue sem o título pelos outros ramos e entra como pessoa nova só se for eleita para mandato atual (D34); fora isso, é rejeitada com o motivo no run. Um dos dois divergente continua casando (1.594 nascimentos e 6 nomes divergentes no banco, todos da mesma pessoa).
- `tse_titulo_candidatura` (migração 0066) guarda nome civil, nascimento e número de cada linha da fonte. Check novo: "candidatura cuja linha da fonte tem outro nascimento e nome civil sem token em comum com a pessoa". Antes dava 1 (Virginia), e agora dá 0. Volta a 1 numa transação desfeita que devolve a candidatura a willya-do-rampa (teste).
- `civico-etl identity.fix041` separou o caso no padrão do fix038: a candidatura 2012 (SQ 90000003345, nº 14222, PTB, #NULO#/renúncia) e a chave `tse:2012:92835:90000003345` foram para `virginia-go` (Virginia Pereira de Oliveira, 26/08/1993, criada da linha da fonte, sem o título). Não havia mandato, bens nem despesa de campanha. Tudo está em `identity_split_log` (BUG-041, 3 linhas). O título 025677851031 ficou com willya-do-rampa (2020 e 2024 na fonte).
- /p/willya-do-rampa: sem 2012 e sem PTB. Depois do `derive.stats`, o `party_memberships` dele tem só o PDT desde 15/11/2020.
- Varredura das 2.107.128 linhas do `consulta_cand` 2012–2026 com o resolve novo: nenhuma outra linha com título do diretório e identidade de outra pessoa. A classe tinha 1 caso.

Reverificação 5 2026-11-03: confirmado, com a regra fraca (BUG-044). Contra o `consulta_cand`: willya-do-rampa tem só 2020 (90000941318, nº 12222, PDT, SUPLENTE) e 2024 (90001956068, nº 12111, PDT, ELEITO POR MÉDIA), o título 025677851031 e o PDT desde 15/11/2020; o crachá não mostra 2012 nem PTB. virginia-go tem a 90000003345 (Cachoeira de Goiás 2012, nº 14222, PTB, renúncia), 26/08/1993, sexo f, sem título, sem mandato. O check novo dá 0 e volta a 1 numa transação desfeita que devolve a candidatura a willya-do-rampa. Amostra dos nascimentos divergentes: as 1.680 linhas de `tse_titulo_candidatura` com título do diretório e nascimento diferente do da pessoa (1.387 pessoas), todas classificadas. 1.577 têm o mesmo nome civil (dia 615, mês 394, ano 406, dia e mês trocados 22, outros 140), 98 têm nome com Jaccard ≥ 0,5 e 5 têm nome fraco. Só 2 são duas pessoas (Virginia e Manoel Juvenil × ze-galinha, as 2 sem token em comum, já separadas): 2 em 1.680, cerca de 0,1%. Nenhuma fusão com token em comum no banco hoje. Na fonte inteira, porém, o "E" deixa passar duas pessoas com o mesmo título e um token comum, como Genilde dos Santos Silva (1972) × Renata Emily da Silva Corrêa (1985), Cruzeiro do Sul/AC, título 004563082453. Ver BUG-044.

### BUG-042: título reemitido no mesmo município com grafia diferente do nome: mandato eleito some do crachá sem passar pela fila

- Severity: S3 (histórico incompleto: falta um mandato encerrado. Nada errado é mostrado)
- Flow / case: F03 / identidade · Screen: S05 · Build: 3da7ef4

Steps
1. `eloisa-cardoso` (Sericita/MG) tem 2012, 2020 e 2024 com o título 029550140299. Em `consulta_cand_2016`, ELOISA SARAIVA CARDOSO REIS, 20/01/1966, Sericita, ELEITO POR QP, tem o título 065899330248. No banco, ela é "Eloiza". O crachá pula 2017–2020.
2. `peixe-sc` (Nelson Gasperin Junior, prefeito de Vargem/SC em exercício): em `consulta_cand_2012`, prefeito de Vargem, ELEITO, NELSON GASPERIM JUNIOR, 25/08/1977, título 031866510949. Não está no banco, então faltam o mandato 2013–2016 e "Eleito em 2012".
3. `marcos-do-santa-clara` (Araguacema/TO): falta a de 2020 (suplente, título 036997012739, nascimento 07/07/1988 na linha, contra 1986 nas outras).
4. Simulação do `resolve` sem gravar: com a grafia da fonte, Eloisa e Nelson dão `new`, e o loader descarta a linha como fora do diretório (mandato encerrado não cria pessoa). Com a grafia do banco, as duas dão `queued`. Marcos dá `new` pelo nascimento da linha.

Expected: título reemitido no mesmo lugar vai para a fila (D235).
Actual: só vai para a fila quando o nome civil bate letra a letra. Uma letra diferente (S/Z, M/N) já faz a linha sumir sem rastro. O check "título com linha ELEITO e pessoa sem candidatura eleita" não vê esses casos, porque o título novo não está no diretório.
Fix sugerido: no `resolve`, com título desconhecido e mesmo município, comparar nome por tokens (como o `seat_match`) e não só a forma dobrada, e mandar o caso para a fila. Ou passar `seat` no loader do TSE. Reprocessar MG 2016 e SC 2012 depois.

Status: fixed (fix ETL, D241 e D243).
- `resolve`: com título desconhecido, mesmo município da trajetória, mesmo nascimento e nome civil a no máximo 2 edições, e com a diferença só de grafia (forma fonética igual: s/z, m/n final, y/i, letra dobrada, h mudo), a linha casa. O log e a nota do run dizem por quê. Mais fraco que isso vai para a fila: grafia a 2 edições que não é só fonética, só a mesma UF, ou mesmo município e mesmo nome com outro nascimento. Com um título da pessoa concorrendo na mesma eleição da linha, são duas pessoas, e a linha não casa nem vai para a fila.
- Desvio do pedido (distância ≤ 2 bastaria): a fonte tem pares no mesmo município, com o mesmo nascimento, a 2 edições, que são pessoas diferentes ou não dá para saber. Exemplos: Marcos × Márcio Pereira da Silva (Araranguá/SC, 18/01/1981, urna "Mano" nos dois), Eliseo × Elino Ferreira da Silva (Juruá/AM, títulos quase consecutivos) e Kassâmio × Kássio Leal Paraíba (Inhuma/PI, os dois concorreram em 2016). Com ≤ 2 puro, os dois primeiros seriam fundidos.
- `civico-etl identity.fix041` recuperou Eloisa Cardoso 2016 (SQ 130000040058, vereadora de Sericita/MG, ELEITO POR QP, PSDB 45666, mandato 2017–2020, bens R$ 83.500,00) e Nelson Gasperin 2012 (SQ 240000003602, prefeito de Vargem/SC, ELEITO, PP 11, mandato 2013–2016, bens R$ 1.694.000,00). Os títulos 065899330248 e 031866510949 foram anexados às pessoas. Tudo conferido no CSV.
- Classe inteira (varredura de toda a fonte com o resolve novo, sem gravar): 2 casam por reemissão (os 2 acima) e 95 linhas ficam entre "casa" e "outra pessoa", 15 delas ELEITO. As 13 ELEITO de eleição ordinária foram recarregadas e estão na fila (6 → 19), entre elas Evaldo × Evandro "DD" (prefeito de Flores do Piauí/PI 2012, provável mesma pessoa, que a regra fonética não prova), Carlinho de Chalé/MG (1963, homônimo de carlin-maroba, 1977) e 6 linhas sem título nem nascimento ("-4"). As 2 ELEITO de eleição suplementar (Gelson, Joaquim Távora/PR 2012, e Davino Serrath, Guajará-Mirim/RO 2016) ficaram só no relatório, porque a recarga de suplementar mexe no mandato da cadeira. As 80 não eleitas entram na fila na próxima carga `--all`.
- Marcos do Santa Clara 2020 (nascimento 1988 × 1986, título diferente) vai para a fila pela regra nova. A linha é suplente e não foi recarregada.
- Check: o do D238 ("título com linha ELEITO na fonte e pessoa sem candidatura eleita") passa a cobrir os 2, porque os títulos novos entraram no diretório e em `tse_titulo_candidatura`. Dá 0.
- `'-4'` (título não divulgável, 1.701 linhas na fonte) deixou de ser tratado como título no `resolve` e no loader. Antes, a primeira pessoa criada com ele receberia todas as outras linhas "-4" pelo título. Não havia nenhuma no banco.

Reverificação 5 2026-11-03: confirmado. Eloisa 2016 confere com o CSV: 130000040058, Sericita, nº 45666, PSDB, ELEITO POR QP, título 065899330248, bens R$ 83.500,00 (2 itens), mandato 2017–2021 no banco e "2016 Vereadora · Sericita · PSDB Eleita por quociente partidário" no crachá. Nelson 2012 confere com o CSV: 240000003602, Vargem, prefeito, nº 11, PP, ELEITO, NELSON GASPERIM JUNIOR, 25/08/1977, título 031866510949, bens R$ 1.694.000,00 (5 itens), mandato 2013–2017 no crachá. Fila: 5 dos 13 novos conferidos na fonte, com a pessoa candidata certa e a decisão de não casar justa. Evaldo × evandro-dd (Flores do Piauí, 17/04/1972, títulos diferentes, provável mesma pessoa). Carlinho (Chalé 1963) × carlin-maroba (1977). Fofão (Toritama 1971) × carlos-da-saude-pe (1979). Zequinha (Ermo 1960) × bepino (1955). Caçula Muniz 2016 (título '-4', sem nascimento) × cacula-muniz (mesmo nome). Os 3 homônimos são pessoas diferentes. A fila só os mostra a um humano e não funde nada. Regra fonética: nenhum falso positivo achado. Na fonte, os 6 pares com mesmo município e nascimento, títulos diferentes e forma fonética igual (Vilson × Wilson Luiz Martins, Souza × Sousa Rezende, Geise × Geize, Ferrreira, Elizabeth × Elisabeth, Cesar × Cezar) nunca concorrem juntos e parecem a mesma pessoa. Dos 54 pares a até 2 edições com fonética diferente, 23 concorrem na mesma eleição (gêmeos), o que confirma a cautela. Há falsos negativos (vão para a fila em vez de casar): Nei Cristiano Correa × Correia da Silva (04634, 1976), Maria de Lourdes × Lurdes Dias (92150, 1953), Erika Keinilia × Keinilla (04286). Teóricos: "ch" não vira "c" (Christiane ≠ Cristiane) e "e" ≠ "i" (Felipe ≠ Filipe). Custo: um mandato encerrado na fila, sem fusão errada. Observação: os 2 títulos anexados têm `match_method` 'exact_id' e confiança 1,000, embora venham da regra fonética (0,9). Sem efeito na tela.

### BUG-043: 16 disputas ficaram com o registro INAPTO/#NULO# e não com o registro APTO da mesma pessoa (resto do BUG-039)

- Severity: S3 (resultado errado no histórico: "indeferido" ou sem resultado no lugar de suplente ou não eleito. Nenhum eleito perdido)
- Flow / case: F03 / identidade · Screen: S05 · Build: 3da7ef4

Steps
1. Na fonte, agrupar por ano, tipo, UE, cargo, número e título as disputas com 2 ou mais SQ em que um deles está no banco: são 151.
2. Em 16, o banco tem o de posto menor:
   - Elisete Duarte (Limoeiro do Norte/CE 2012): fica 'indeferido'; a fonte também tem APTO/SUPLENTE.
   - Flauber Lima (Limoeiro do Norte 2012), Gedielson (Monte Sião/MG 2012) e Rodrigo Amorim (Sto. Antônio do Tauá/PA 2012).
   - Terezinha Salesse (Bento de Abreu/SP 2012).
   - Veter Martins (dep. est. GO 2014). Está na amostra de crachás: "2014 · sem resultado".
   - Gil Bobinho (Caruaru/PE 2016) e Cido Reis (dep. est. MG 2018).
   - Tião Peixoto (Goiânia 2020), Flavinho Sabiá (Paraú/RN 2020), Zenio Neves (Aroeiras do Itaim/PI 2020), Lari Hitz (Nova Santa Rosa/PR 2020), Normande Rocha (São Gabriel/BA 2020), Giovani Ratinho (São João de Meriti/RJ 2020) e Ruty Freitas (Mairiporã/SP 2020).
   - Doutor Leitão (dep. est. CE 2022).
3. Nas 16, o registro que falta é APTO e foi à urna (SUPLENTE ou NÃO ELEITO), ou é INAPTO com resultado contra #NULO#.

Expected: D238, fica o registro de maior posto.
Actual: a regra só vale para o que o loader ou o `fix032` processaram depois do D238. O check novo só olha ELEITO.
Fix sugerido: aplicar o `registration_rank` uma vez sobre o banco inteiro, a partir de `tse_titulo_candidatura` (ano, UE, cargo e título com mais de um SQ). Estender o check do D238 a "existe registro de posto maior na fonte para a mesma disputa".

Status: fixed (fix ETL, D242 e D243).
- Check novo, em SQL sobre `tse_titulo_candidatura` (número na urna da 0066): "registro substituído no banco com registro de posto maior na fonte para a mesma disputa e número". Antes dava 16 e agora dá 0.
- `civico-etl identity.fix041` refez a varredura das 151 disputas: 116 com o maior posto, 19 suplementares com os 2 registros e 16 com o inferior (os mesmos 16 da Reverificação 4). As 16 foram recarregadas só nas linhas das 2 SQ de cada disputa. O loader do D238 trocou o registro e mandou o inferior inteiro para `identity_repair_log` (BUG-043, `removido`/`substituido`, 16 linhas, com 14 declarações de bens e nenhum mandato).
- Conferido contra o CSV, 16 de 16 em número, resultado, partido e bens. Exemplos: Veter Martins 2014 é dep. estadual GO, PHS 31500, NÃO ELEITO (90000001316), bens R$ 416.400,00, e /p/veter-martins mostra "2014 Deputado estadual · Goiás PHS Não eleito". Elisete Duarte 2012 é suplente (60000016248). Doutor Leitão 2022 é suplente (60001723726).
- O loader ordenava as linhas por "eleito primeiro". Entre não eleitos, o INAPTO podia vir antes do APTO e barrar o APTO como "pessoa duplicada". Agora a ordem é pelo posto (`registration_rank`).
- Os bens do registro inferior e os do válido têm a mesma soma nas 14 disputas que tinham bens. O total de bens não mudou com esta parte.
- Não tratado: as 19 suplementares com os 2 registros no banco (Reverificação 3).

Reverificação 5 2026-11-03: confirmado. 6 das 16 trocas conferidas contra o CSV (número, situação, resultado, partido e bens), e o registro removido está em `identity_repair_log` (BUG-043, 16 linhas, 0 mandato):
- Ruty Freitas 2020: 250000648544, nº 10500, REPUBLICANOS, APTO/SUPLENTE no lugar do INAPTO/#NULO, bens R$ 14.000,00.
- Giovani Ratinho 2020: 190000920929, nº 90, PROS, prefeito, APTO/NÃO ELEITO, bens R$ 270.000,00.
- Cido Reis 2018: 130000627072, nº 40456, PSB, APTO/SUPLENTE, bens R$ 650.000,00, igual ao INAPTO.
- Terezinha Salesse 2012: 250000102946, nº 14, PTB, INAPTO/NÃO ELEITO (indeferido) contra o #NULO# (renúncia), bens R$ 589.157,51.
- Gil Bobinho 2016: 170000010867, nº 18018, REDE, INAPTO/NÃO ELEITO contra o #NULO#, bens R$ 22.000,00.
- Veter Martins 2014: 90000001316, nº 31500, PHS, INAPTO/NÃO ELEITO, bens R$ 416.400,00 (4 itens).

Nos 3 crachás abertos (veter-martins, ruty-freitas e gil-bobinho), a linha bate. O check novo dá 0 nas 2 rodadas. Achado lateral: no mesmo crachá, Veter 2020 (INAPTO/#NULO, resultado nulo no banco) aparece como "Não eleito". Ver BUG-045.

### BUG-044: título repetido pelo TSE com um token de nome em comum ainda casa (o "E" do D240)

- Severity: S3 (latente: nenhuma fusão no banco hoje, 0 de 1.680 linhas. Vira S2 quando uma das pessoas entrar no diretório e a outra linha vier na carga)
- Flow / case: F03 / identidade · Screen: S05 · Build: 616ec23
- Browser / device: `consulta_cand` 2012–2026 do cache do ETL (índice SQLite) e Postgres local

Steps
1. Na fonte, agrupar por título as linhas com nascimentos diferentes (12.398 títulos) e procurar pares com nome civil de token fraco (primeiro nome diferente e Jaccard < 0,5).
2. Pares que são duas pessoas e têm 1 token em comum:
   - 004563082453, Cruzeiro do Sul/AC: GENILDE DOS SANTOS SILVA, 22/10/1972 (2020) × RENATA EMILY DA SILVA CORRÊA, 27/06/1985 (2024). Token "silva".
   - 037966060353, Paty do Alferes/RJ 2012: MARIA ISABEL DE SA MAMEDIR, 1943 × SILVANA MARIA DA ROCHA MARQUES, 1970. Token "maria", e as duas na mesma eleição.
   - 049983051090, Itumbiara/GO: DJALMIRO ALVES URBIETA FILHO × SARAH MAGALHÃES URBIETA. Outro sexo, token "urbieta".
   - 030588382232, Itamarati/AM: DAORA KANAMARI, 1982 × KOTSARIO PEDRO KANAMARI, 1999. Token "kanamari".
3. `foreign_row` só rejeita com nascimento diferente E nenhum token em comum. Nos 4 casos há 1 token, e `resolve` daria `exact_id` à pessoa que já tivesse o título.

Expected: a linha de outra pessoa com o título repetido não casa pelo título (D240).
Actual: um sobrenome comum ou "Maria" basta para casar. Hoje nenhuma das 8 pessoas está no diretório, e por isso o check do D240 dá 0. Ele usa a mesma regra e também não veria o caso.
Cause: a regra trata "algum token em comum" como prova de compatibilidade. Silva, Santos, Maria e sobrenomes de família ou de etnia são compartilhados por pessoas diferentes.
Fix sugerido: no ramo do título, com nascimento diferente, exigir que o primeiro nome bata (ou distância ≤ 2) ou que a cobertura de tokens seja alta. Recusar sempre quando o mesmo título aparece em 2 SQ da mesma eleição para nomes diferentes (Paty do Alferes, Axixá, Campos dos Goytacazes, Caroebe). Simulei nas 1.680 linhas do banco a regra "primeiro nome a até 2 edições do primeiro nome civil ou do de exibição". Ela rejeita 3: as 2 fusões reais e dr-auri ("AURI-WULANGE"), que deixa de ser rejeitado se o hífen separar os tokens. Os 4 pares do passo 2 ficam a 3 ou mais edições no primeiro nome e seriam rejeitados.

### BUG-045: candidatura sem resultado (#NULO) aparece como "Não eleito" no crachá

- Severity: S3 (fato errado na tela: a candidatura não foi à urna, e o crachá diz que a pessoa perdeu)
- Flow / case: F03 / candidaturas · Screen: S05 · Build: 616ec23

Steps
1. /p/veter-martins: "2020 Prefeito · Aparecida de Goiânia · GO PSD Não eleito".
2. Fonte: `consulta_cand_2020`, SQ 90001177599, INAPTO, DS_SIT_TOT_TURNO "#NULO". No banco, `candidacies.result` é NULL.
3. `web/src/lib/data/pg.ts:553`: `result: (r.result as Candidacy["result"]) ?? "nao_eleito"`. O fallback "Sem resultado publicado" de `sections.tsx` nunca é usado.

Expected: "Sem resultado publicado", ou o motivo (indeferida, cancelada).
Actual: 513 candidaturas com resultado nulo, todas #NULO/#NULO# na fonte (322 e 191), em 507 pessoas, aparecem como "Não eleito/Não eleita". 491 estão em crachás de quem está em exercício. Desde e07184b.
Fix sugerido: não converter null em `nao_eleito` em `getCandidacies`, e deixar o rótulo "Sem resultado publicado" do componente aparecer.

Status: fixed (orquestrador). `Candidacy.result` aceita null; `pg.ts` não converte mais null em "nao_eleito"; a tabela mostra "Sem resultado publicado". Usos de `result.startsWith` passaram a `result?.`. e2e `b045-resultado-nulo.spec.ts` (Veter Martins 2020) verde.

## Agenda do ETL: reparos de identidade (2026-11-04, D245)

### BUG-046: identity.dedupe ainda fundia na mesma cadeira por "nascimento igual OU nome parlamentar igual" (a regra que o D221 tirou do resolve)

- Severity: S2 latente (0 pares no banco hoje; fusão de duas pessoas quando uma chega só pelo TSE e a outra só pela casa)
- Flow / case: F03 / identidade · Build: 50ed1d9
- Steps: duas pessoas com mandato de deputado federal por SP desde 01/02/2019, uma `status_source = 'tse'` e outra `'camara'`, 13/01/1976, nomes civis "Eugenio José Zuliani" e "Adriano Eli Corrêa" (ou "Átila Lira" pai e filho, com o mesmo nome parlamentar). `PAIRS_SQL` as pareia, e `run_dedupe` chama `merge_person`.
- Expected: só funde com nascimento igual e token do nome civil em comum (D221).
- Status: fixed (D245). `PAIRS_SQL` usa `identity_name_tokens`. Teste: `test_identity_repairs.py::test_dedupe_*`. Os testes falham com a regra antiga.

### BUG-047: carga do TSE em ordem crescente de ano perde o histórico numa carga do zero

- Severity: S3 (só em recarga do zero ou em banco novo; o `civico` foi carregado de 2026 para trás)
- Steps: banco vazio, `tse.candidatos --year 2012 --uf PA --all` e depois `--year 2024`. 2012 grava 0 candidaturas, porque pela D07 só a eleição com mandato atual cria pessoa. O check do D238 dá 1.857.
- Status: fixed (D245). `run_tse` carrega pelo `load_order`, do mais novo para o mais antigo. Recarga desc: 0 em 2012 e 2024 (sobram 1.512 de anos fora do recorte).

### BUG-048: votação e contas do TSE casam a candidatura pelo SQ sem a UE; em 2012 o SQ se repete (BUG-035)

- Severity: S4 latente (votação/contas de 2012 não são carregadas: o default é 2022+, e há 0 candidaturas de 2012 com voto)
- Onde: `tse_votos_contas.run_votes`/`_apply`/`_finance_entries` e `tse_candidatos._load_votes` agregam por (SQ, turno) e gravam em toda candidatura do ano com o SQ. Nas 91 duplas de 2012, a ordinária e a suplementar de outro município receberiam a soma das duas.
- Fix sugerido: em `SQ_COM_UE`, agregar por (SG_UE, SQ) e casar pela UE da disputa (como `pick_row`). Não corrigido: fora do escopo dos reparos de identidade.

### BUG-049: retotalização do TSE em Tapauá/AM deixa 14 vereadores em exercício para 11 cadeiras

- Severity: S2 (três crachás com mandato em exercício que a fonte não reconhece; câmara acima do teto constitucional)
- Flow / case: agenda `run-due --only tse.candidatos.recentes --force` · Build: 22f4206
- Steps: o TSE republica o `consulta_cand_2024` (04/11/2026) com a retotalização de Tapauá (UE 02798). A recarga `--all` cria os mandatos dos 3 eleitos novos e grava NÃO ELEITO em epaminondas, izaque-martins e nilson-am, mas os mandatos deles seguem `em_exercicio` (o TSE só promove `eleito_aguardando_posse`). O `check` deu 40/40, porque não havia invariante de cadeiras.
- Expected: os rebaixados saem do exercício, com motivo e sem apagar; Tapauá com 11.
- Status: fixed (D251). Passo `mandatos_tse` do `identity.repairs` (3 → 0) e check "vereador em exercício ≤ cadeiras da CF art. 29, IV" (falhava com 1, agora passa). Tapauá 11. Testes em `test_identity_repairs.py`.

## Execução de novembro (2026-11-11)

### BUG-050: suplente que saiu do exercício segue em exercício; Câmara com 514

- Severity: S2 (cadeira a mais na Câmara; invariantes "câmara: exatamente 513 em exercício" e "assembleia: titulares eleitos… CF art. 27" vermelhas, `etl.yml` com exit 2 em todo ciclo desde 09/11)
- Flow / case: agenda `camara.deputados` · leonardo-gadelha (PB, id Câmara 122195)
- Steps: o suplente assume em 2026-07-09 e o run grava `suplente_em_exercicio`/`em_exercicio` até 2027-02-01. Em 2026-11-06 o titular volta: a Câmara lista o suplente na legislatura 57 com `condicaoEleitoral` "Suplente", `situacao` "Suplência", `data` 2026-11-06. `_deputies` fazia `continue` nesse ramo e o upsert não toca `ends_on`: o mandato ficava em exercício para sempre.
- Expected: o mandato do suplente fecha na data da fonte, sem apagar a linha; Câmara com 513.
- Status: fixed (PR #25, D301). `close_suplentes`, em savepoint: suplente listado fora do exercício → status do mapa STATUS, `ends_on` = `ultimoStatus.data` (teto hoje); ausente da listagem, data anterior ao início e mandato de hoje só anotam; teto de 5 encerramentos por run (acima: nenhum, run parcial); falha → run parcial com o upsert preservado; encerrados em `log.warning` e no topo das notas. Testes em `test_camara_suplente_saiu.py` (21). Conferido em produção em 11/11/2026: 1 mandato encerrado (2026-07-09 → 2026-11-06), 513 em exercício, PB com 12, check sem falha.

### BUG-051: suplente que entrou no 1º dia da legislatura é tratado como titular

- Severity: S4 latente (achado nas revisões da PR #25; anterior a ela)
- Onde: `camara_diario._deputies`, `titular = condicao == "Titular" or any(s == start ...)`. Quando esse suplente sai, a linha vira `titular`/`encerrado` com `ends_on` no fim da legislatura e escapa do `close_suplentes`.
- Status: open.

### BUG-052: suplente efetivado como "Titular" pode derrubar o run da Câmara

- Severity: S3 latente (achado nas revisões da PR #25; anterior a ela)
- Onde: o ramo do titular insere `(início da legislatura, fim)` por cima do mandato de suplente aberto da mesma pessoa; a exclusão `no_overlapping_mandate` (por pessoa e cargo) estoura fora do savepoint e desfaz a carga de deputados do ciclo. O mesmo vale para mandato da mesma pessoa em outra UF (`known` é por UF, a exclusão é por cargo).
- Status: open. Em produção, 11/11/2026: nenhuma pessoa com titular do 1º dia e suplente aberto na legislatura (consulta de leitura).

### BUG-053: pessoa criada por carga recente fica sem as candidaturas de eleições antigas do próprio título

- Severity: S3 (crachá incompleto, sem fato errado; o check do BUG-039 acusa e o `etl.yml` fecha com exit 2 a cada ciclo)
- Flow / case: agenda `tse.candidatos.recentes` (2024, 2026) + `identity.repairs` · Build: main b095ba9
- Steps: em 11/11/2026 a retotalização de 2024 cria 10 vereadores novos no diretório (D07: só eleito com mandato atual cria pessoa, `tse_candidatos.py:336`). O passo `titulos` do reparo (`repairs.py:8-11`) grava as linhas 2012–2020 dos títulos deles, mas nenhum passo carrega essas candidaturas (`schedule.py:179` só recarrega 2024 e 2026). O check "título com linha ELEITO na fonte e pessoa sem candidatura eleita nesse ano" (`checks_identity.py:85`) dá 8: cosme-do-leite 2016; dudu-mg-vereador e lilo-da-bititinga 2012, 2016 e 2020; professor-moises-se 2020.
- Expected: o histórico do título (todas as situações) no crachá na mesma rodada.
- Actual: faltam 12 candidaturas de 5 pessoas (as 8 eleitas, 3 não eleitas dos mesmos 4 e 1 de nilson-chaves, 2016). No cache da fonte, todas têm o mesmo nascimento e a mesma UE da linha de 2024; uma tem o nome a 1 edição. É dado faltando, não fusão.
- Fix sugerido: passo `historico` em `repairs.STEPS`, depois de `titulos`: para título do diretório com linha de um ano sem candidatura da pessoa naquele ano, `_load_year(only={(UE, SQ)})` a partir do cache (mecanismo do `identity.fix041`). Paliativo manual, só pelo dono (escrita em produção fora da agenda): `civico-etl tse.candidatos --all --force --year 2020 --year 2016 --year 2012 --uf MG --uf BA --uf AL --uf SE`, depois `identity.repairs --apply` e `check`.
- Status: fixed (PR #32, merge 680ae3d; aplicado em produção em 12/11/2026, run 43310865469, D306). Passo `historico` do `identity.repairs` (o último): só entra linha que casa na pessoa do título com todas as travas de identidade, nascimento a menos de 1 ano e mandato já encerrado; não eleitas só de quem ainda não tem histórico; só eleição ordinária; bens por cache ou download (sem bens o ano não entra); teto de 200 candidaturas e 10 min por run; `ETL_REPAIRS_SKIP=historico` desliga. Em produção: universo 3.604, 39 candidaturas, 8 mandatos (todos encerrados), 24 declarações de bens, 0 recusas; check 8 → 0. Fica de fora o backlog do BUG-047: 3.439 não eleitas de quem já tem histórico (carga em massa, decisão do dono).

### BUG-054: cota de 2025–2026 em dobro pelo complemento da API

- Severity: S2 (o site mostra gasto a mais: ~R$ 4,04 mi em 2025, 182 deputados; ~R$ 4,49 mi em 2026, 95 deputados)
- Symptom: em 12/11/2026 o check `cota: amostra fixa…` falhou em 4 casos de 2025 (160541 +18,75%, 178975 +3,29%, 204534 +22,43%, 209787 +2,16% sobre a página da Câmara).
- Cause: em 12/11/2026 a API `/deputados/{id}/despesas` passou a devolver valores com centavos e o `valorLiquido` negado fora do SIGEPA; o `Ano-AAAA.csv.zip` segue com 6 dígitos significativos. O casamento (documento, valor) do complemento D181 falhou e o `cotaapi` regravou linhas que o arquivo já tem (ex.: 11892.53 × 11892.5 no documento 7896551; parcela 2500/0/−311,55 × +311,55 no 8022455). "Passagem aérea - SIGEPA" é legítima e a página a soma.
- Status: em correção (PR #35). Segunda passada por documento: 6 dígitos significativos e líquido negado. Os dados de produção se corrigem no próximo `camara.diario` (prune por prefixo `cotaapi`), sem DELETE manual.

### BUG-055: check de carimbo vencido cobra 48 h de tarefas semanais

- Severity: S4 (falso alarme; deixa o `etl.yml` vermelho)
- Cause: `camara.equipe` e `parlamento.extras` são semanais (`schedule.TASKS`, `7 * D`), mas o check cobrava 48 h de toda família camara/senado.
- Status: em correção (PR #35): régua = cadência da tarefa + 48 h para tarefas com cadência acima de 48 h; diárias seguem em 48 h.

