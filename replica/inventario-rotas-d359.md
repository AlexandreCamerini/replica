# Inventário de rotas · D359 (somente leitura) · 27/11/2026

Base: `main` @ 67e7c50. Método: grep de `"/rota"` em `web/src` (fora de `(v1)`), em `web/e2e` e em `(v1)`/`components`; leitura de banco/cookie por heurística (`cookies(`, `@/lib/data`, `force-dynamic`). Não verificado: tráfego real por rota (Observability Plus não está ligado), uso por MCP/ETL/central fora de `web/` (só `grep` em `web/`; falta varrer `mcp/`, `etl/`, `central`), links externos antigos.

## Achado que muda o plano
`(v1)` NÃO é só código morto atrás de um rodapé. Há 31 páginas, e:
- `/p/[slug]` (a rota que falha) é referenciada por 13 arquivos de `src/components`, `lib/data/pg.ts`, `fake.ts`, `account.ts`, `(sv)` carregar.ts e por ~24 specs e2e. Remover exige migrar ou apagar esses usos junto.
- `(sv)` ainda aponta para `/sugestoes` (`como-funciona/page.tsx:131`) e `/no-seu-bolso` (rodapé `sv/shell.tsx:96`, `nav-items.ts`, `header.tsx`).
- `votacoes` já está em `(sv)` (`/votacoes`, `/votacao/[id]`); `(v1)/votacoes/[id]` duplica `(sv)/votacao/[id]`.
- Muitas páginas `(v1)` (sobre, dados-abertos, como-escolhemos, ajudar, entrar, conta) são as ÚNICAS versões vivas: `(sv)` não tem equivalente. Remover = perder função.

## Matriz
Legenda de proposta: R301 = remover + redirecionar; M = manter; ND = não decidir sem o dono (uso fora de `web/`/sem equivalente).

| Rota (v1) | Lê banco/cookie | Equivalente em (sv) | Referências fora de (v1) | e2e | Proposta |
|---|---|---|---|---|---|
| `/p/[slug]` | banco, force-dynamic | `/pessoa/[slug]` | 13 componentes, pg.ts, fake.ts, account.ts, carregar.ts | ~24 specs | R301 `/p/:slug → /pessoa/:slug` (alvo principal; maior custo de migração de links/testes) |
| `/p/[slug]/opengraph-image` | banco | `/pessoa/[slug]` (conferir OG) | — | — | R301 junto; conferir que `(sv)/pessoa` tem OG |
| `/votacoes/[id]` | banco | `/votacao/[id]` | `(sv)` usa `/votacoes` (lista, não o item) | vários | R301 `/votacoes/:id → /votacao/:id` |
| `/proposta/[key]` | banco | `/decisao/[key]` (conferir mapeamento de chave) | `pauta/ui.tsx` | pauta, v2-d2 | ND: confirmar que `key` é a mesma; se for, R301 |
| `/quem` | banco | `/pessoas` | global-search | ~9 | R301 `/quem → /pessoas` (query string a conferir) |
| `/representantes` | banco | `/pessoas` (filtro por UF?) | 7 componentes, mapas | ~8 | ND: mapa/busca por local ainda dependem; manter até migrar |
| `/sugestoes` | banco | nenhum | `(sv)/como-funciona`, profile/sections, ask-source | 3 | ND: tem função (pedir fonte). Disallow no robots já corta robô; manter |
| `/no-seu-bolso` | banco | nenhum | `sv/shell.tsx` (rodapé), nav-items, header, account.ts | ~10 | M por ora; remover só o link do rodapé se o dono aprovar (corta a entrada dos robôs) |
| `/cidades/[letra]` | banco | nenhum | — | — | ND: entrada de rastreamento por letra; sem uso interno fora de v1 → candidata a remover (404) |
| `/partidos`, `/governos`, `/impostos`, `/eleicoes` | banco, force-dynamic | nenhum | — | w4-paginas | Candidatas a remover/ND: sem ligação de `(sv)`; confirmar tráfego |
| `/comparar` | banco | nenhum (comparar em `(sv)`? não achei) | compare.tsx, person-picker | 6 | M (função) |
| `/congresso`, `/pauta`, `/acervo`, `/correcoes`, `/atualizacoes` | banco | nenhum | nav-items/pauta | vários | M |
| `/ja-decidido`, `/quem-votei`, `/propostas` | estática | parcial (`/decisoes`) | nav-items | poucos | ND |
| `/sobre`, `/dados-abertos`, `/como-escolhemos`, `/ajudar`, `/mcp`, `/dicionario`, `/cargos` | estáticas ou leves | sobre/dados-abertos/como-escolhemos: o sitemap `(sv)` ainda lista `/sobre` e `/dados-abertos` | footer, seo.ts, glossary | vários | M (únicas versões; custo de função baixo, são estáticas) |
| `/entrar`, `/conta`, `/design` | cookie/auth, force-dynamic | nenhum | account.ts, auth, seo.ts | f05-f08 | M (auth/conta); `/design` ND (interno?) |

### API (`web/src/app/api/`)
| Rota | Proposta |
|---|---|
| `cron/vigia`, `revalidate` | M (regra fixa) |
| `people/[slug]/{expenses,proposals,votes}`, `people/search`, `places`, `compare/agreement`, `me`, `health/fontes` | M até provar que nenhum cliente do `(sv)`/MCP/central as chama (não verificado) |

## Leitura crítica da proposta do handoff
1. O custo real está nas rotas por-pessoa dinâmicas. `/p/:slug → /pessoa/:slug` troca uma função dinâmica por outra: o 301 sai do edge/config (barato), mas o robô que seguir o redirect cai em `/pessoa/<slug>`, que também lê banco. Os robôs só param de ler banco se `/pessoa/<slug>` ficar protegido (robots/ratelimit) ou cacheado. Hipótese não medida: o destino também é raspado.
2. O custo de migração é alto: 13 componentes e ~24 specs apontam para `/p/`. Troca mecânica de href para `/pessoa/` resolve os links internos (e elimina a rede de ~23 links `/p/` por página para robôs), mas o e2e inteiro precisa seguir.
3. Menos invasivo e já suficiente para a carga medida: (a) 301 de `/p/*`, `/votacoes/:id`, `/quem` no `next.config` `redirects()`; (b) `X-Robots-Tag: noindex` + `Disallow: /` quando o host != SITE_URL (domínio vercel.app); (c) `Disallow: /p/ /sugestoes /cidades/ /no-seu-bolso`; (d) tirar o link do rodapé. Remoção de páginas `(v1)` só depois, onde não há função.

## Decisões que preciso do dono antes de implementar
1. Aprova a lista R301 mínima (`/p/*`, `/votacoes/:id`, `/quem`) e a troca mecânica dos hrefs internos de `/p/` para `/pessoa/`?
2. `/partidos`, `/governos`, `/impostos`, `/eleicoes`, `/cidades/*`: remover (404) ou manter?
3. Remover o link "Páginas do desenho anterior" do rodapé?
4. Posso varrer `mcp/`, `etl/` e a central por usos de rotas `(v1)`/`/api/people/*` antes? (parada obrigatória do handoff.)
5. Confirmo a revogação da regra "não alterar `(v1)`" só para remover e redirecionar.

Pendência registrada: recolocar a D358 em `replica/decisions.md` com o motivo da reversão (#87) e corrigir `PG_POOL_MAX=3` em D356/D357.
