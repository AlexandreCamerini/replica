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
Status: open (não corrigido: exige recarga de tabela compartilhada).

### BUG-021: /partidos some com o partido que só existe como partido atual (MISSÃO): Câmara soma 512 de 513

- Severity: S3 · Screen: S11 /partidos · Build: W4 (regressão desta noite, página nova)
Steps
1. Abrir /partidos; somar a coluna Câmara -> 512. Não há linha MISSÃO.
2. Abrir /p/kim-kataguiri -> cabeçalho "MISSÃO"; API da Câmara `deputados?siglaPartido=MISSÃO` -> Kim Kataguiri.
Expected: linha MISSÃO com 1 cadeira; total 513.
Cause: `pg-w4.ts::listPartyRows` lista partidos com `exists mandates.party_id = pa.id`, mas conta cadeiras por `coalesce(person_current_party, mandates.party_id)`. Quem trocou para um partido que não está em nenhum `mandates.party_id` some da tabela. features.csv já registrava "512/513" como se fosse aceitável.
Status: open.

### BUG-022: bancada do Senado em /partidos diverge do Senado (PT 10 / PSD 13 / PL 16 contra 9 / 14 / 15)

- Severity: S3 · Screen: S11 /partidos e S05 (cabeçalho do crachá) · Build: W4 (contagem nova); a fonte do "partido atual" é anterior
Steps
1. /partidos: Senado PT 10, PSD 13, PL 16.
2. `https://legis.senado.leg.br/dadosabertos/senador/lista/atual`: PT 9, PSD 14, PL 15, S/Partido 1 (Romário).
3. /p/eliziane-gama mostra "PT"; o mandato no banco e o Senado dizem PSD. /p/romario mostra "PL"; o Senado diz "S/Partido".
Expected: a mesma regra de partido em todo o site, com a fonte e a data de onde veio a filiação.
Cause: `person_current_party` (filiação vinda do TSE/candidatura) vence o partido do mandato publicado pela casa; para Eliziane pode ser filiação para 2026 que o Senado ainda não refletiu, mas o site afirma "PT" sem dizer de onde.
Status: open.

### BUG-023: "Desemprego, média do ano" em /governos não é a taxa média anual do IBGE (2024: 6,85 contra 6,6)

- Severity: S3 (número diferente do oficial, com rótulo que sugere o oficial) · Screen: S12 /governos · Build: W4 (regressão desta noite)
Steps
1. /governos: 2023 = 7,98; 2024 = 6,85.
2. IBGE, Agência de Notícias 42530/42531: taxa média anual de desocupação 2023 = 7,8%, 2024 = 6,6%.
Cause: o ETL faz média simples dos quatro trimestres da SIDRA 4099; o IBGE publica a média anual por outro cálculo. A nota de método diz "média simples dos quatro trimestres", mas o cabeçalho diz "média do ano".
Fix sugerido: usar a série anual publicada pelo IBGE (ou renomear para "média dos 4 trimestres" e mostrar o valor oficial ao lado).
Status: fixed (fixui, D190). Job usa a taxa média anual do IBGE (SIDRA 10379 v4099, total): 2022 9,6; 2023 7,7; 2024 6,6; 2025 5,6. Rótulo e nota de método de /governos ajustados. Nota: a tabela dá 7,7 para 2023, a notícia do IBGE citada acima dizia 7,8; vale a tabela, que é a fonte primária.

### BUG-024: Amazonas sem governador: home diz "Governo do estado 26" e Manaus omite o nível sem "—"

- Severity: S3 · Screen: S01, S07 · Build: dado de 02/11 23:13 (carga TSE); não determinado se é desta noite
Steps
1. Home: chip "Governo do estado 26", "Vice-governo 19".
2. /representantes?cidade=1302603 (Manaus): não existe seção "Governo do estado"; nenhum aviso.
3. Banco: Wilson Lima e Tadeu de Souza com `status = 'renunciou'` em 2026-04-04; nenhum titular `em_exercicio` no AM.
Expected: quem exerce o governo do AM hoje, ou "—" com o motivo (titular e vice renunciaram; fonte não publica o sucessor).
Cause: o `check` "um titular em exercício por lugar e cargo" testa no máximo 1, não exatamente 1, para governador.
Status: open.

### BUG-025: deputados estaduais: 994 em exercício contra 1.035 cadeiras, sem aviso (SP 90 de 94, RJ 65 de 70)

- Severity: S3 · Screen: S01, S07 (Campinas: "Deputados estaduais 90") · Build: anterior a esta noite
Steps: `select uf, count(*) from mandates ... deputado_estadual em_exercicio` -> faltam 41 em 18 UFs (AP −1, BA −2, CE −4, ES −2, GO −1, MA −4, MG −3, MT −1, PA −2, PE −2, PI −2, PR −3, RJ −5, RO −1, RS −1, SC −2, SP −4, TO −1).
Expected: suplentes em exercício (ALESP e ALMG já são lidas desde W3-A) ou "—" com motivo dizendo que suplente em exercício não está carregado.
Status: open.

### BUG-026: /comparar e o bloco "Números" do crachá sem fonte e data do que mostram

- Severity: S3 (regra de produto "fonte e data em todo bloco") · Screen: S08, S05 · Build: anterior; o tile de salário acumulado é desta noite (W3-B)
Steps
1. /comparar?p=adriana-ventura,baleia-rossi: presença, propostas, votos e cota são da Câmara; o único rodapé da página é "Fonte: TSE · Dados Abertos".
2. /p/adriana-ventura, bloco "Números desde 2019": nenhum "Fonte: … · atualizado em …"; o salário acumulado não cita o decreto legislativo nem a data (só o texto de ajuda "como a lei publica").
Status: open.

### BUG-027: ONB-H2 (foco no campo de cidade depois do onboarding) falha no dev server

- Severity: S4 · Screen: S02 · Build: anterior (já estava em "A conferir", build 6)
Steps: suíte contra 3101: falhou nas 2 tentativas; isolado com `--repeat-each 3`: 1 de 3 falhou. Contra o build de produção (3301): passou.
Cause provável: corrida entre a hidratação do combobox e o `focus()` disparado ao fechar o modal; em celular lento pode aparecer em produção.
Status: open.

### BUG-028: presença do crachá não bate com a da Câmara (2025: 108 de 120 contra 110 + 11 justificadas)

- Severity: S4 · Screen: S05 · Build: anterior
Steps: /p/adriana-ventura?ano=2025 -> "90% (108 de 120)"; camara.leg.br/deputados/204528?ano=2025 -> 110 dias presentes, 11 ausências justificadas, 0 não justificadas. Carreira: clone 912 de 926; original 911 de 932.
Cause provável: o clone conta sessões deliberativas; a Câmara conta dias. Não está dito no tile.
Status: open (a conferir a definição; não afirmo qual está certo).

### BUG-029: `npx eslint` em web/ lint a saída de build `.next-e2e-w3a/` (1.823 erros)

- Severity: S4 (ferramenta) · Build: W3-A
Steps: `cd web && npx eslint` -> 10.937 problemas, todos em `.next-e2e-w3a/`; `npx eslint src e2e` -> 0.
Fix sugerido (uma linha): em `eslint.config.mjs`, trocar `".next-e2e/**"` por `".next*/**"`. Não aplicado: fora do escopo de commit desta verificação.
Status: fixed (fixui). `eslint.config.mjs` ignora `.next*/**`; `npx eslint` sem argumento agora dá 0 problemas.
