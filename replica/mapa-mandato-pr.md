# Mapa de votos e visão do mandato na sv

## O que é
Duas frentes sobre a base sv (D339: a sv é a base; da v1 vêm custo do mandato, salário, emendas e mapa):
1. Mapa de votos por UF em `/votacao/[id]` (D340 e adendos).
2. Painel do mandato no topo de `/pessoa/[slug]` e página `/pessoa/[slug]/mandato` (D341, D342: sem média nem comparação).

## Por quê
A sv não tinha mapa nem custo do mandato; a v1 tinha. Comparativo em `replica/comparativo-v1-sv.md`.

## O que muda
- Mapa: `components/sv/mapa-votos.tsx` (servidor), `lib/mapa-votos.ts`, `styles/sv-mapa.css`. SVG `aria-hidden`, sem links; rota de toque/teclado = `nav.sv-ufs`; leitor de tela = tabela oculta. %: `(sim*100)/votantes` para baixo.
- Mandato: `painel-mandato.tsx`, `mandato-blocos.tsx`, `mandato-dados.ts`, `lib/mandato-visao.ts`, rota `/mandato`, leituras novas em `pg.ts`/`fake.ts`/`types.ts`/`index.ts` (tag `person:<id>`), `styles/sv-mandato.css`.
- Docs: D339 a D342 e adendos em `replica/decisions.md` e `DECISIONS.md`.
- Sem migração, sem tabela nova.

## Atenção do revisor
- D340 adendo: links no SVG quebrariam o aceite D2 (alvos 44 px / texto 13 px).
- Janela "desde AAAA" = max(posse, 1º de jan. do primeiro ano com nota de cota); nunca "total do mandato".
- `/pessoa/[slug]`: o painel agora parte em paralelo e só é aguardado no render; se falhar, aparece lacuna nomeada.
- Revisão Opus corrigiu: "—" isolado (acusado pelo D2) virou "— sem dado" no mesmo elemento; valores soltos sem soma ganham "desde AAAA"; rota `/mandato` entrou na bateria D2; falha do painel não some mais em silêncio; latência serializada.

## Verificação
tsc (src+e2e), eslint, test:unit (349 ok), `next build` com `ALLOW_DEMO_DATA=1`: ok. `mapa-br.json` fora do bundle do cliente (trecho do path: 0 acertos em `static`, 1 em `server`). Prévia integrada por fetch: mapa, lista de UFs, tabela oculta, 0 links no SVG; painel e página do mandato da demo; lacuna com motivo em `alvaro-coutinho-sp`. Captura 1280 do painel em `replica/prompts/evidencias/mapa-mandato/`.

## Não verificado
Playwright (`sv-mapa.spec.ts`, `sv-mandato.spec.ts`, `v2-d2-aceite.spec.ts` completo, `d316-promocao.spec.ts`) não roda no sandbox; números reais no `civico_ensaio` contra a fonte oficial; texto do mapa a 390 px (~5 px, ver D340 adendo 2); captura do mapa no branch integrado (as de 3 larguras são do branch do mapa).

## Pendências
D341 adendo (salário sem filtro de cargo; votos/propostas/presença por ano inteiro; `primeiraNotaEm` da pessoa; emendas e viagens fora; `?simular=erro_pagina`), rótulo "no mandato" nos números anuais, dois números de votos na mesma página (painel x quatro respostas), categoria nula vira "null" em `getMandateSpend`, `mapa-br.json` (~95 KB) no HTML de cada votação.
