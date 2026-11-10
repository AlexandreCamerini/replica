# Parity: clone cívico × Politicômetro

Rodada final da noite de 2026-11-02 → 03. O diff full stack partiu de f03f5b6 (build 4, nota 62,4) e terminou em b272615. O plano anterior está no histórico do git deste arquivo. A verificação independente está em `replica/verify-final.md`, as decisões em `replica/decisions.md` (D10–D197) e os bugs em `replica/bugs.md` (até o BUG-029).

## Placar

| | agora | início da noite | observação |
| --- | --- | --- | --- |
| Features | **86,8 / 100** | 62,4 | 60 linhas pontuadas, matriz com as 13 linhas do diff |
| Must-haves | 17 de 17 | 17 de 17 | — |
| Layout | 32,2 / 100 | 32,4 (não recapturado) | recapturado: 12 telas, 1440×900 e 390×844 PNG, original × clone no mesmo estado |
| Geral (feature + layout) | 75,9 | 56,4 | o layout pesa contra por desenho: o clone tem identidade própria (ver abaixo) |

**Veredito: entregável.** Os 17 must estão feitos, a nota de feature é 86,8 (acima de 80) e não há S1 nem S2 abertos. O BUG-019 (voto e dinheiro de presidente em dobro) e o BUG-020 (cota subcontada em ~9–14% para todos os deputados federais) foram corrigidos e conferidos contra a fonte.

Ainda não é "melhor que o original". O clone ganha em neutralidade, MCP, "—" com motivo, votação secreta do Senado vinda da fonte, agenda com pauta e cota conferida contra a página da Câmara. Perde no fosso municipal e estadual: o original lê 937 câmaras e 29 Assembleias; o clone lê 6 câmaras e 2 Assembleias.

### Layout por tela (imgdiff, modo estrutural, cor ignorada)

| tela | 1440 | 390 |
| --- | --- | --- |
| home | 28,9 | 36,8 |
| crachá (`/p/adriana-ventura`) | 28,6 | 28,6 |
| representantes (Campinas) | 30,9 | 37,2 |
| comparar | 30,2 | 28,0 |
| congresso | 34,3 | 31,7 |
| sobre | 33,0 | 38,4 |

A nota baixa é esperada. O clone não copia a trade dress do original (ver replica-diff: "do not chase pixel parity"), e a informação está nos mesmos lugares por fluxo (tabela de fluxos abaixo). Não vale perseguir essa nota.

## Verificação

| item | resultado |
| --- | --- |
| pytest do ETL | 55/55 |
| `civico-etl check` | 26 invariantes ok, exit 0. Novos nesta noite: 1 prefeito por município, 1 governador por UF, cota contra referência da Câmara (10 pares), partido vigente = casa, 513/81 cadeiras, voto de presidente ≤ TSE, Assembleias |
| MCP | 33/33, 0 falha |
| tsc / eslint (web) | 0 / 0 |
| e2e contra :3101 (Postgres real) | 170 passed, 1 flaky (SH-E2, 390 px no dev), 1 skipped. As 2 falhas da 1ª passada (FX-024) eram teste preso ao dado antigo do AM; teste reescrito, 2/2 |
| dado contra fonte (verificador) | 16 números conferidos, 11 batiam. Os 4 que não batiam viraram BUG-020/022/023/028 e estão corrigidos (cota da Adriana em 2025 = R$ 104.693,75, igual à página da Câmara; Senado 81/81; desemprego 2024 = 6,6; presença rotulada) |

### Reverificações independentes (2026-11-03)

Depois desta rodada, cinco verificadores independentes (Opus, nenhum escreveu o código conferido) tentaram derrubar cada correção contra a fonte primária. Cada achado foi corrigido e reverificado na rodada seguinte. Detalhes em `replica/reverify.md` e `replica/bugs.md`.

| rodada | achou | o que era |
| --- | --- | --- |
| 1 | 3 S1 | cota com sinal errado no auxílio-moradia (BUG-030, até −31% em 84–96 deputados por ano); governadores que já tinham saído em DF, RJ e RR (BUG-031); SQ do TSE sem ano, com 15.769 pessoas carregando a candidatura de outra (BUG-032) |
| 2 | 1 S1, 2 S2 | fusão por "mesma cadeira + nascimento" sem nome em comum (BUG-033, Eli Corrêa no crachá do Geninho); glosa 2020–21 (BUG-034); reparo do 032 que apagou 8 candidaturas verdadeiras (BUG-035) |
| 3 | 1 S2, 2 S3 | fusão do TSE por nome + nascimento sem UF (BUG-038, 11 casos); Divino (BUG-039); testes do vice do AM (BUG-040) |
| 4 | 1 S2, 2 S3 | título repetido pelo TSE na linha de outra pessoa (BUG-041); título reemitido com uma letra diferente (BUG-042); 16 registros INAPTOS antigos (BUG-043) |
| 5 | 0 S1/S2, 2 S3 | regra do título deixa passar homônimos com token comum, latente, sem caso no banco (BUG-044); #NULO# exibido como "Não eleito" (BUG-045, corrigido em 732e3b5) |

Estado depois da 5ª rodada:
- pytest 111/111;
- `check` 40/40, duas vezes, com md5 estável;
- e2e 181 passed, 4 flaky (hidratação no `next dev`), 0 failed;
- totais globais explicados variação por variação.

A cota foi conferida contra a página da Câmara em mais de 40 deputado-ano, os 27 governadores contra fonte oficial e as fusões contra o `consulta_cand` do TSE.

Abertos:
- BUG-044 (S3 latente: vira S2 quando uma das pessoas entrar no diretório);
- fila de identidade com 19 itens para revisão humana;
- 2 eleitos de suplementar só no relatório (Gelson, Davino Serrath).

## O que entrou nesta noite

| onda | itens |
| --- | --- |
| W1a | /sobre, /atualizacoes, /dados-abertos, direito de resposta, busca global, copiar link no topo, onboarding |
| W1b/W2 | presença em gráfico e ano a ano, mais votados na cidade, divergências no comparar, salário acumulado, "Como cobrar", card OG, campanha por origem e gasto, equipe da Câmara, "o que virou lei" |
| Educativo/API | /cargos, /dicionario (122/213), servidor MCP (6 ferramentas, só leitura) e /mcp, /ajudar |
| W3-A | Assembleias SP e MG (propostas e verba), casadas com o TSE; vereadores SAPL no crachá |
| W3-B | subsídio federal desde 2015, `is_secret` do Senado (557 secretas, igual à fonte), agenda/pauta do Congresso, SAPL em 6 capitais, 847 inabilitados do TCU |
| W4 | /eleicoes, /governos, /impostos, /partidos (A–Z, sem espectro) |
| Correções de dado | prefeitos cassados "com recurso" (BUG-014), fuso das sessões (BUG-017), presidente em dobro (BUG-019), cota (BUG-020), partido dos senadores (BUG-022), governador do AM fora do TSE (D184/D197) |
| Acabamento | agenda em /congresso, MCP lê `is_secret`, um só dono para `sessions.starts_at`, fonte e data no comparar e no bloco "Números" |

## Comportamento por fluxo

| fluxo | original | clone | decisão |
| --- | --- | --- | --- |
| F01 quem me representa | campo → cidade → pessoa; mais votados | igual, sem JS funciona; mais votados; "N de M cadeiras" com motivo | manter |
| F03 crachá | ~25 blocos recolhíveis | presença/ano a ano, campanha, equipe, como cobrar, direito de resposta, Assembleia/SAPL; fonte e data por número | manter; viagens "—" |
| F04 comparar | votaram igual + divergências por tema | igual, filtro na URL; conta votações, não pautas (D59) | manter, revisar D59 |
| F05 monitorar | e-mail ou WhatsApp | e-mail → código → feed; sem envio do resumo | bloqueado: Resend + domínio (conta do dono) |
| F06 compartilhar | card + WhatsApp no topo | OG 1200×630 sem foto + topo | manter; `SITE_URL` na publicação (D62) |
| F07 congresso | sendo votado, virou lei, agenda, ao vivo | hemiciclo neutro, votações, virou lei, agenda com pauta | ao vivo fica fora |
| neutralidade | hemiciclo na cor do partido; partidos por espectro; "em alta" | cadeiras neutras, A–Z, sem espectro; coluna "orientação igual à do governo" sem ordenar nem colorir (D192) | manter; revisar D192 |

## Faltando, em ordem de construção

1. **Emendas parlamentares** (should): falta a chave do Portal da Transparência, que é do dono.
2. **Resumo por e-mail + descadastro** (should, F05): falta Resend + domínio, também do dono.
3. **Assembleias além de SP e MG** (should, partial): RJ não tem dado aberto e o DOCIGP proíbe robôs; RS sem catálogo; outras 23 UFs a mapear. Presença e votos de plenário: SP e MG não publicam em dado aberto (só comissão, D102).
4. **SAPL em escala** (should, partial): 6 de 937 câmaras carregadas hoje. Carga incremental (~30 s por câmara já lida) e fila diária na agenda (D250). A expansão avança sozinha quando a agenda for ligada: cerca de 15 câmaras novas por dia, a 1ª carga de cada uma é completa (~10 min).
5. **Matriz de quem publica** (should, partial): preenche à medida que 3 e 4 crescem.
6. Equipe do Senado e viagens (should, partial); folha mensal da Câmara para o salário da equipe.
7. Could: STF, Planos de governo, camadas do mapa, salário de prefeito/vereador pelos Tribunais de Contas, sanções no crachá (0 casados por regra estrita), CGU (bloqueada por verificação humana, D130), dicionário completo (213), apuração ao vivo, mais vistos.

## Decisões que o dono deve revisar

- **D55 → D114**: a votação secreta agora vem da fonte; a regra deduzida saiu.
- **D58**: "mais votados" usa a eleição de 2026, não a de 2022 como o original.
- **D59**: divergências contam votações (760), não pautas (400 no original).
- **D101**: proposta estadual = só projeto; no federal, requerimentos contam.
- **D107**: criar mandato de suplente a partir da Assembleia é decisão de produto.
- **D121**: o seed de salários apaga datas que não estão nos decretos.
- **D131/D132**: TCU sem CPF; casamento só por nome civil + UF único.
- **D148**: as datas dos mandatos presidenciais foram cruzadas com fonte secundária (o Planalto estava fora do ar). Conferir em `web/src/lib/governos.ts`.
- **D184/D197**: governador do AM por eleição indireta, fonte = página da Governadoria do AM; a ALEAM não publicou página localizável.
- **D192**: coluna "orientação igual à do governo" em /partidos; ainda pode ser lida como índice de governismo.
- **D195**: presença por sessão deliberativa, contra "por dia" da Câmara (108 × 110 na Adriana em 2025).

## Riscos

- O fosso continua sendo o dado municipal e estadual. Entregável não quer dizer competitivo onde o usuário mora.
- A agenda existe (`civico-etl run-due`, D250), testada e rodada de verdade no banco local, mas **está desligada**. Ligar é decisão do dono: `etl/deploy/launchd-install.sh install` (local) ou secret + variável no GitHub (produção). Antes de ligar o workflow: fixar actions por SHA e travar dependências com hash.
- Achado sem investigar: Roberto Cidade tem uma candidatura a vereador de 2012 com nome de urna "Dinelci", que parece casamento de identidade errado.
- O dev server :3101 teve 500 intermitente por recompilação concorrente (vários agentes); em produção, `next start`, não reproduz.

## Próximos cinco

1. Ligar a agenda do ETL (D250) onde o produto vai rodar e apontar `ETL_ALERT_WEBHOOK` para um canal do dono.
2. Acompanhar a expansão do SAPL pela fila (cobertura em /atualizacoes) e mapear as câmaras sem SAPL.
3. Assembleias: as próximas UFs com dado aberto, e presença/votação de comissão como bloco próprio em SP e MG.
4. As duas contas do dono: chave do Portal da Transparência (emendas, CGU) e Resend + domínio (resumo por e-mail).
5. Revisar a fila de identidade (19 itens) e fechar o BUG-044 antes que uma das pessoas entre no diretório. Medir a suíte contra `next start`, não `next dev`.

## Decisões de identidade e dado que o dono deve revisar (reverificações)

- D200 e D230: a cota segue a página da Câmara, inclusive somando o documento inteiro acima do teto legal quando há glosa dupla. Enio Verri 2020 e Félix Mendonça 2024 ficam com o valor da fonte, sem explicação.
- D202 e D203: lista curada de governadores por UF. Precisa de manutenção a cada renúncia; o check avisa quando ela fica para trás.
- D227, D236 e D240: crachás criados para pessoas sem mandato atual (Eli Corrêa Filho, Átila Lira pai e 8 separados), como exceção à D34.
- D241: a regra fonética de reemissão de título prefere mandar para a fila a fundir. Exemplo do custo: Evaldo × Evandro "DD".
