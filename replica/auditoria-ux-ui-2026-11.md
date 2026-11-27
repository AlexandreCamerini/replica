# Auditoria de UX e UI do site do eleitor, 26/11/2026

Base: branch de trabalho com o main até a #81 (F1–F9 e Fase 5). Dados: demonstração (`DATA_SOURCE` fake). Três lentes independentes (desenho, acessibilidade, conteúdo; subagentes de leitura, sem ver as conclusões uns dos outros) mais medição automática no navegador. Relatórios completos das lentes em `replica/prompts/evidencias/auditoria/`.

## 1. Medição automática (17 rotas × 390, 768 e 1280 px)
- axe (wcag2a, 2aa, 21a, 21aa, 22aa): **zero violações** nas 51 combinações.
- Rolagem lateral: nenhuma, inclusive a 320 px.
- Espaçamento de texto (WCAG 1.4.12) a 320 px: perda de conteúdo nenhuma; os links de voto em `/pessoa/<slug>` e `/votos` passam ~9 px da tela. **Não corrigido** (ver §4).
- Alvos < 44 px: só no mapa de estados de `/votacoes` e `/votacao/<id>` (DF mede 17×10 px a 1280 px). Pendência D343, tem lista equivalente ("Pular o mapa"). **Não corrigido.**
- Não medidos: ordem de Tab, CLS e tempo de carga, modo logado, forced-colors, leitor de tela.

## 2. Corrigido (com teste)
| Achado | Correção | Teste |
|---|---|---|
| Ementa cortada no meio da palavra ("23 d…", lente de conteúdo C13 e de desenho D18) | `clip()` recua ao último espaço, sem pontuação solta | `sv-fmt.test.ts` |
| Link de votação em `/acompanhando` com alvo de 24 px (D05) | `min-height: 44px` em `.sv-esc__vv-t a` | medição de alvos (§1) |
| Tabela mensal da F7 reutilizava classes de outra tabela (colisão `sv-gm`/`sv-g`, D11) | classe própria `sv-gser` | `sv-f7.spec.ts`, bateria A–Z de categorias |

| C02 (corrigido em texto) | 144 votos no perfil, 122 na lista "só leis" e 38 de procedimento não somam | Causa: o perfil usa `person_period_stats.votes_registered` (exclui "Sem voto", só mandato) e a lista conta todas as linhas de `votes`, inclusive "Sem voto". `/votos` agora explica a diferença. Não alterei SQL: unificar a base é decisão de produto |

## 3a. Segunda rodada (mesma data): colisões de classe e CSS morto
Medição de estilo calculado antes e depois, a 1280 px, nas telas afetadas (script no navegador embutido; a Início e `/acompanhando` com `sv_sigo` de duas pessoas):
- **D02 `.sv-vl`:** a lista de votos dentro do cartão da Início herdava a grade de 3 colunas da lista de votações (colunas de 40, 140 e 60 px). Agora `.sv-ivl`: coluna simples, como `sv-inicio.css` já pretendia.
- **D03 `.sv-esc__n`/`__c`:** o nome na Início saía com 34 px (regra de `/acompanhando`) em vez dos 24 px previstos. Agora `.sv-iesc__n`/`__c`.
- **D04 `.sv-vt`:** o link "Voltar a…" da pessoa herdava o bloco de votos da decisão. Agora `.sv-pvt` (pessoa) e `.sv-dvt` (decisão), com o visual atual preservado (conferido por estilo calculado; a decisão testada em `/decisao/camara-pl-9996-2026`).
- **D15 CSS morto:** 43 regras de `sv.css` cujas classes não aparecem em nenhum `.ts/.tsx` nem em e2e (script: classe sem uso literal nem prefixo dinâmico). Um `@media` vazio removido. Sobraram 0 pelo mesmo critério.
- Só a Início mudou de aparência (nome e lista de votos), no sentido pretendido. Pessoa, decisão, `/acompanhando` e `/votacoes` ficaram idênticos.
- axe zero e sem rolagem lateral em 6 rotas × 3 larguras; tsc e 418 testes de unidade ok. e2e atualizados: `d329` (`.sv-iesc__n`) e `v2-d2-aceite` (`.sv-dvt`). O Playwright só roda no CI.

## 3. Falsos positivos descartados
- C01 "Foi trabalhar?/Faltou" para o Senado: em produção o Senado não tem linha de presença (`mandato-dados.ts:140`), então a tela mostra lacuna; a contradição só existe nos dados de demonstração. O título "Foi trabalhar?" é decisão da D2.
- C18 "cinco perguntas": o quadro de escolhidos tem de fato cinco perguntas (q1–q5).
- C06, C12, C20 (fornecedor incompatível com a categoria, "Aprovada" com 249 Sim numa PEC, 32 senadores entram): dados inventados da demonstração, todos sob "Exemplo ilustrativo". Não são código.

## 4. Mensurável e NÃO corrigido nesta rodada (cada um vira fatia própria)
| id | Achado | Por que fica |
|---|---|---|
| C03, C08 | Total do ano corrente sem o intervalo de meses ("R$ 487 mil em 2026") | Cruza com D352/F7; precisa do `ate` da leitura |
| C04 | "Ficou fora da soma" sem lacuna nomeada; salário é valor × meses sem dizer | Texto de produto |
| C05 | Fonte do salário de senadora leva à home da Câmara | Verificar se é dado da demo ou código |
| C11 | Sessão de ontem listada como "Ainda não vale" | Regra de data da pauta; cruza com F6 |
| a11y média | Título igual em todas as `/votacao/<id>`; sem tratamento de forced-colors; botão de marcar troca de nome e usa aria-pressed (`follow.tsx:15`, `pessoas-lista.tsx:28`); thead/caption ocultos com `position:absolute` | O botão de marcar tem e2e que fixa o nome atual |
| 1.4.12 | Links de voto passam ~9 px a 320 px com espaçamento de texto | Achar o contêiner de grade |

## 5. Gosto (lista para o dono decidir)
- h1 de 14 px na Início e em `/temas`, menor que o h2 de 15 px: é o "fólio" da Direção 2 (`styles/sv.css:114`). Hierarquia fraca, mas é decisão de design.
- Duas cores de destaque (terracota e azul-petróleo) contra a regra "uma cor só" do DIRECAO.md; o código segue a Direção 2, não os tokens da v1.
- Rodapé aponta para o desenho anterior; data some abaixo de 900 px; proveniência em 13 px condensado; três nomes para a lista de escolhidos; selo "conferido por agentes de IA" sem o aviso de que nenhuma pessoa leu (C19).

## 6. Reauditoria
`tsc` e `eslint` limpos; `npm run test:unit` 418/418; `/pessoa/helena-siqueira/gastos` renderiza a série mensal com a classe nova (12 linhas, total igual ao das categorias). O Playwright só roda no CI.
