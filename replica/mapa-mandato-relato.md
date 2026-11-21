# Relato: mapa e mandato na sv

| Frente | Entrega | Prova | Situação |
|---|---|---|---|
| Docs | D339 a D342 + adendos, comparativo v1 x sv | diff em `replica/decisions.md`, `DECISIONS.md` | feito |
| Mapa | Interativo (D343): 27 links `?uf=` no SVG, painel de leitura com % e contagem, ilha cliente de ~0,8 KB gzip; no quadro 3 de `/votacao/[id]` e no topo de `/votacoes`; `nav.sv-ufs` e tabela oculta continuam | build ok, HTML conferido por fetch, `elementFromPoint` e painel no navegador embutido, capturas 1280 e 390, testes unitários (352) | falta Playwright; Tab real e leitor de tela |
| Mandato | painel + `/pessoa/[slug]/mandato` | HTML da demo, captura 1280, unitários | falta Playwright e dado real |
| Integração | 3 merges sem conflito | tsc, eslint, test:unit (349), build | feito |

O dono precisa rodar:
- Playwright `sv-mapa.spec.ts` (agora com links, Tab, painel, sem JS, `/votacoes`) e conferir a exceção D2 nos links do mapa (`v2-d2-aceite.spec.ts`, só `[data-mapa-votos] svg`).
- Olhar o mapa em `/votacoes` e em `/votacao/camara-v2026-15` no Preview e decidir se os alvos dos estados pequenos servem.
- Ainda: Playwright `sv-mapa.spec.ts` e `sv-mandato.spec.ts`.
- `v2-d2-aceite.spec.ts` completo (agora inclui `/pessoa/helena-siqueira/mandato`; o "—" isolado foi corrigido, confirmar).
- `d316-promocao.spec.ts`.
- Conferir os números do mandato no `civico_ensaio` contra a fonte oficial.
