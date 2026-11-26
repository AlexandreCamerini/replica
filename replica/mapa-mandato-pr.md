# Mapa de votos e visão do mandato na sv

## O que é
Duas frentes sobre a base sv (D339: a sv é a base; da v1 vêm custo do mandato, salário, emendas e mapa):
1. Mapa de votos por UF, INTERATIVO (D343, reverte o adendo da D340), em `/votacao/[id]` e no topo de `/votacoes`.
2. Painel do mandato no topo de `/pessoa/[slug]` e página `/pessoa/[slug]/mandato` (D341, D342: sem média nem comparação).

## Por quê
A sv não tinha mapa nem custo do mandato; a v1 tinha. Comparativo em `replica/comparativo-v1-sv.md`.

## O que muda
- Mapa: `components/sv/mapa-votos.tsx` (servidor), `lib/mapa-votos.ts`, `styles/sv-mapa.css`. Cada estado é um `<Link>` no SVG para `?uf=XX` (nome acessível com % e contagem, Tab alfabético, funciona sem JS) e um painel de leitura mostra "SP · 67% Sim · 324 de 477 registrados · Sim, Não, Abstenção" ao passar o mouse, focar ou tocar. O painel é só eco visual e NÃO tem `aria-live`: o link em foco já anuncia % e contagem, e o painel os repetiria. Ilha cliente `mapa-painel.tsx` (~1,6 KB, ~0,8 KB gzip) só copia o `data-txt` do DOM; `mapa-br.json` fica no servidor. Link "Pular o mapa" (visível só com foco) salta as 27 paradas de Tab. Rótulos de 17 px; a 760 px ou menos as etiquetas desenhadas somem e fica a lista. Lista `nav.sv-ufs` (44 px) e tabela oculta continuam; a lista agora também aparece em `/votacoes`. %: `(sim*100)/votantes` para baixo. `/votacoes`: quadro "Como votou cada estado na votação mais recente?" (a mais recente das 5 primeiras da lista com placar por UF). As 5 leituras de detalhe vão em paralelo e uma que falhe não derruba o quadro: o texto diz quantas foram lidas e quantas falharam, e o "mais recente" vale só entre as que conseguimos ler; lacuna nomeada se nenhuma tem placar.
- Mandato: `painel-mandato.tsx`, `mandato-blocos.tsx`, `mandato-dados.ts`, `lib/mandato-visao.ts`, rota `/mandato`, leituras novas em `pg.ts`/`fake.ts`/`types.ts`/`index.ts` (tag `person:<id>`), `styles/sv-mandato.css`.
- Docs: D339 a D342 e adendos em `replica/decisions.md` e `DECISIONS.md`.
- Sem migração, sem tabela nova.

## Atenção do revisor
- D343: EXCEÇÃO ao aceite D2, só para `[data-mapa-votos] svg` (comentário no teste); lista `nav.sv-ufs` e texto de 13 px continuam medidos. Os links dos estados pequenos têm menos de 44 px. DECISÃO ABERTA: a revisão pôs a lista de 44 px também em `/votacoes` (onde o mapa aparece sem lista abaixo); alternativas são restringir a exceção a `/votacao/[id]` ou aceitar a falha de WCAG 2.5.8 no registro da D343.
- Quadro de `/votacoes`: se a leitura de uma votação falha, a prova diz "entre as que conseguimos ler" em vez de afirmar "a mais recente".
- Segunda camada de rótulos (`a[tabindex=-1][aria-hidden]`) por cima dos estados: sem ela o desenho do MG cobria o rótulo do DF.
- Janela "desde AAAA" = max(posse, 1º de jan. do primeiro ano com nota de cota); nunca "total do mandato".
- `/pessoa/[slug]`: o painel agora parte em paralelo e só é aguardado no render; se falhar, aparece lacuna nomeada.
- Revisão Opus corrigiu: "—" isolado (acusado pelo D2) virou "— sem dado" no mesmo elemento; valores soltos sem soma ganham "desde AAAA"; rota `/mandato` entrou na bateria D2; falha do painel não some mais em silêncio; latência serializada.

## Verificação
tsc (src+e2e), eslint, test:unit (352 ok), `next build` com `ALLOW_DEMO_DATA=1` a partir de cópia limpa: ok. Conferido no navegador embutido (dados de demonstração) a 390, 768 e 1280 px após as correções da revisão (itens 1 a 7).

Números reais no `civico_ensaio` (25/11/2026), com `etl/deploy/conferir-ensaio.sh`:
- `civico-etl check` antigo (`c6eac57`) x novo (`ensaio/d338-passkey`) no mesmo banco: as mesmas 5 invariantes quebradas nos dois (cota amostra x total, emendas pago > empenhado, identidade ELEITO, pauta velha, carimbos vencidos); nenhuma introduzida pelo D338.
- Placar por UF da Câmara, votação `2236186-60` contra `dadosabertos.camara.leg.br`: totais idênticos (252 Sim, 176 Não, 1 artigo 17). Por UF, só 2 votos Sim divergem: o banco os põe em "sem estado" e a fonte em BA e SP, porque Paulo Soares e José Carlos Araujo não têm mandato da legislatura atual no banco. O site já declara isso ("N registros sem estado identificado"); não é erro de contagem. Correção é de ETL (mandato de suplente que votou e saiu antes da primeira coleta), fora desta PR. `mapa-br.json` fora do bundle do cliente (trecho do path: 0 acertos em `static`, 1 em `server`). Prévia integrada por fetch: mapa, lista de UFs, tabela oculta, 27 links `?uf=` no SVG, painel `aria-live`, `data-txt`, quadro novo em `/votacoes`; no navegador embutido, `elementFromPoint` em cada rótulo devolveu a própria UF e painel/inversão responderam a foco e mouse (eventos sintéticos); painel e página do mandato da demo; lacuna com motivo em `alvaro-coutinho-sp`. Capturas do mapa interativo (1280 em `/votacoes`, 390 em `?uf=SP`) e do painel em `replica/prompts/evidencias/mapa-mandato/`.

## Não verificado
Playwright (`sv-mapa.spec.ts`, `sv-mandato.spec.ts`, `v2-d2-aceite.spec.ts` completo, `d316-promocao.spec.ts`) não roda no sandbox; placar do Senado e cota total contra a fonte (no ensaio só 596 das 1.154 votações nominais do Senado têm votos); `axe` `target-size` e o contorno de foco em SVG no Firefox; falha parcial das leituras de `/votacoes` no navegador (coberta por teste de unidade e por `?simular=erro` no e2e, nunca executado); captura do mapa no branch integrado.

## Pendências
ETL: mandatos de suplentes que votaram e saíram antes da primeira coleta (2 casos na votação `2236186-60`; extensão desconhecida). DECISIONS.md D340/D341 ainda descreve o mapa como `aria-hidden`. Revisão: "–" x "—" em `textoPct`, contorno no hover, `prefers-reduced-motion` redundante, mensagem do painel para UF sem votos. D341 adendo (salário sem filtro de cargo; votos/propostas/presença por ano inteiro; `primeiraNotaEm` da pessoa; emendas e viagens fora; `?simular=erro_pagina`), rótulo "no mandato" nos números anuais, dois números de votos na mesma página (painel x quatro respostas), categoria nula vira "null" em `getMandateSpend`, `mapa-br.json` (~95 KB) no HTML de cada votação, hover real por Tab (o navegador embutido não dá foco de janela).
