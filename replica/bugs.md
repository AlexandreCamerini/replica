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

## A conferir (não reproduzido como bug)

- Flaky sob carga (passam na repetição, 3/3 ok isoladamente em <1 s): F02-H1, F02-E1 (clique em link da home não navega em 15 s com 2 workers contra um único `next start`) e F01-E6 mobile. Config: `workers: 2`, `retries: 1`.

- 1 pessoa (de 71 mil) tem "carreira" maior que a soma dos anos: fato registrado fora do intervalo do mandato (ex.: voto antes da posse formal). Decidir se o ano do fato entra no período mesmo sem mandato.
- Senado: a API por senador marca 77 de 93 votações de 2025 como secretas. Conferir com outro endpoint antes de afirmar "16 votações nominais em 2025".
