# Relato: mapa e mandato na sv

| Frente | Entrega | Prova | Situação |
|---|---|---|---|
| Docs | D339 a D342 + adendos, comparativo v1 x sv | diff em `replica/decisions.md`, `DECISIONS.md` | feito |
| Mapa | SVG somente leitura, `nav.sv-ufs`, tabela oculta | build ok, HTML: 1 svg `aria-hidden`, 0 links, tabela presente; testes unitários | falta Playwright e leitura a 390 px |
| Mandato | painel + `/pessoa/[slug]/mandato` | HTML da demo, captura 1280, unitários | falta Playwright e dado real |
| Integração | 3 merges sem conflito | tsc, eslint, test:unit (349), build | feito |

O dono precisa rodar:
- Playwright `sv-mapa.spec.ts` e `sv-mandato.spec.ts`.
- `v2-d2-aceite.spec.ts` completo (agora inclui `/pessoa/helena-siqueira/mandato`; o "—" isolado foi corrigido, confirmar).
- `d316-promocao.spec.ts`.
- Conferir os números do mandato no `civico_ensaio` contra a fonte oficial.
