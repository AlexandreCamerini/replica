# Mapa de votos e visão do mandato na sv

## O que é
Duas frentes sobre a base sv (D339: a sv é a base; da v1 vêm custo do mandato, salário, emendas e mapa):
1. Mapa de votos por UF, INTERATIVO (D343, reverte o adendo da D340), em `/votacao/[id]` e no topo de `/votacoes`.
2. Painel do mandato no topo de `/pessoa/[slug]` e página `/pessoa/[slug]/mandato` (D341, D342: sem média nem comparação).

## Por quê
A sv não tinha mapa nem custo do mandato; a v1 tinha. Comparativo em `replica/comparativo-v1-sv.md`.

## O que muda
- Mapa: `components/sv/mapa-votos.tsx` (servidor), `lib/mapa-votos.ts`, `styles/sv-mapa.css`. Cada estado é um `<Link>` no SVG para `?uf=XX` (nome acessível com % e contagem, Tab alfabético, funciona sem JS) e um painel de leitura (`aria-live`) mostra "SP · 67% Sim · 324 de 477 registrados · Sim, Não, Abstenção" ao passar o mouse, focar ou tocar. Ilha cliente `mapa-painel.tsx` (~1,6 KB, ~0,8 KB gzip) só copia o `data-txt` do DOM; `mapa-br.json` fica no servidor. Lista `nav.sv-ufs` (44 px) e tabela oculta continuam. %: `(sim*100)/votantes` para baixo. `/votacoes`: quadro "Como votou cada estado na votação mais recente?" (a mais recente das 5 primeiras da lista com placar por UF; lacuna nomeada se nenhuma; leitura de detalhe, sem consulta nova).
- Mandato: `painel-mandato.tsx`, `mandato-blocos.tsx`, `mandato-dados.ts`, `lib/mandato-visao.ts`, rota `/mandato`, leituras novas em `pg.ts`/`fake.ts`/`types.ts`/`index.ts` (tag `person:<id>`), `styles/sv-mandato.css`.
- Docs: D339 a D342 e adendos em `replica/decisions.md` e `DECISIONS.md`.
- Sem migração, sem tabela nova.

## Atenção do revisor
- D343: EXCEÇÃO ao aceite D2, só para `[data-mapa-votos] svg` (comentário no teste); lista `nav.sv-ufs` e texto de 13 px continuam medidos. Os links dos estados pequenos têm menos de 44 px.
- Segunda camada de rótulos (`a[tabindex=-1][aria-hidden]`) por cima dos estados: sem ela o desenho do MG cobria o rótulo do DF.
- Janela "desde AAAA" = max(posse, 1º de jan. do primeiro ano com nota de cota); nunca "total do mandato".
- `/pessoa/[slug]`: o painel agora parte em paralelo e só é aguardado no render; se falhar, aparece lacuna nomeada.
- Revisão Opus corrigiu: "—" isolado (acusado pelo D2) virou "— sem dado" no mesmo elemento; valores soltos sem soma ganham "desde AAAA"; rota `/mandato` entrou na bateria D2; falha do painel não some mais em silêncio; latência serializada.

## Verificação
tsc (src+e2e), eslint, test:unit (349 ok), `next build` com `ALLOW_DEMO_DATA=1`: ok. `mapa-br.json` fora do bundle do cliente (trecho do path: 0 acertos em `static`, 1 em `server`). Prévia integrada por fetch: mapa, lista de UFs, tabela oculta, 27 links `?uf=` no SVG, painel `aria-live`, `data-txt`, quadro novo em `/votacoes`; no navegador embutido, `elementFromPoint` em cada rótulo devolveu a própria UF e painel/inversão responderam a foco e mouse (eventos sintéticos); painel e página do mandato da demo; lacuna com motivo em `alvaro-coutinho-sp`. Capturas do mapa interativo (1280 em `/votacoes`, 390 em `?uf=SP`) e do painel em `replica/prompts/evidencias/mapa-mandato/`.

## Não verificado
Playwright (`sv-mapa.spec.ts`, `sv-mandato.spec.ts`, `v2-d2-aceite.spec.ts` completo, `d316-promocao.spec.ts`) não roda no sandbox; números reais no `civico_ensaio` contra a fonte oficial; texto do mapa a 390 px (~5 px, ver D340 adendo 2); captura do mapa no branch integrado (as de 3 larguras são do branch do mapa).

## Pendências
D341 adendo (salário sem filtro de cargo; votos/propostas/presença por ano inteiro; `primeiraNotaEm` da pessoa; emendas e viagens fora; `?simular=erro_pagina`), rótulo "no mandato" nos números anuais, dois números de votos na mesma página (painel x quatro respostas), categoria nula vira "null" em `getMandateSpend`, `mapa-br.json` (~95 KB) no HTML de cada votação, hover real por Tab (o navegador embutido não dá foco de janela).
