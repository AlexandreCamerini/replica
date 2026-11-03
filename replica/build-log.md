# Build log

Uma linha por tela. Camada de dados = demo (`web/src/lib/data/fake.ts`, contrato `DataSource`): pessoas, partidos e números são fictícios e determinísticos; lugares (UFs, 12 capitais + Campinas) e tamanho das bancadas são reais. Trocar pela implementação Postgres não muda tela.

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| shell | 2026-11-02 | done | busca global (S03, R2) | stubs para as 19 telas fora do R0/R1, cada uma com S-ID e release; skip link, landmarks, bandeja de comparação persistente |
| S06 | 2026-11-02 | done | — | homônimos: sem JS a busca cai em `?q=` e lista as cidades com UF (Bom Jesus × 4) |
| S07 | 2026-11-02 | done | "mais votados na cidade" (R2) | grupos grandes (94 deputados estaduais em SP): 12 visíveis + `<details>` sem JS; atalhos por nível |
| S05 | 2026-11-02 | partial | seções R2 (resumo do ano, leis, emendas, campanhas detalhadas, comissões, falas, viagens, equipe, contato); link da nota fiscal; imagem OG | filtros de propostas, votos e gastos na URL coexistindo (cada form preserva os outros); presença só para Câmara, Senado "não publica"; gênero na flexão de cargo e resultado |
| S04 | 2026-11-02 | done | — | — |
| S08 | 2026-11-02 | partial | lista de divergências em "Votaram igual?" | cargos diferentes na mesma tabela: "—" por não aplicável vs não publicado ainda usam o mesmo símbolo |
| S01 | 2026-11-02 | partial | mapa com contorno IBGE (drill-down até cidade), camadas (R5), "ao vivo" | mapa real precisa da malha IBGE (CC BY 4.0) simplificada; ficou a grade por UF como alternativa acessível |

## Verificação desta rodada

- `tsc` e `eslint` limpos; `next build` ok.
- axe-core 4.10: 0 violações em S01, S04, S05, S06, S07 e S08, tema claro e escuro.
- 390 px: sem rolagem horizontal (tabelas largas rolam dentro de região focável).
- Só teclado: F01 completo (digitar cidade → Enter → Tab até a pessoa → Enter) = 3 ações.
- Rotas: slug antigo → 308; slug, IBGE ou UF inválidos → 404; APIs validam parâmetros e respondem 400.

## Dívida registrada

- "—" mistura "não publicado" com "não se aplica ao cargo" no S08. Separar em R2 com legenda.
- A camada demo gera votos com orientação por partido sorteada; a concordância entre pessoas é plausível, não real.
- Tabela de `features.csv`: o ETL (must) segue `no`, é o `/replica-backend`.

## 2026-11-02 · backend (replica-backend)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| dados | 2026-11-02 | done | votos por candidato e prestação de contas do TSE (arquivos grandes, flags prontas); Supabase/auth/e-mail (R2) | identidade entre fontes: TSE e Câmara divergem em nome civil e até em data de nascimento para a mesma pessoa; precisou de regra por cadeira + `merge_person()`; Câmara marca cassado como "Não Eleito + Vacância" e suplente em exercício como "Não Eleito + Exercício"; a lista "atual" do Senado omite titulares afastados (lista por legislatura resolve); 16 municípios com grafia diferente entre TSE e IBGE |

Verificação: cadeiras batem (513 deputados, 81 senadores); RLS testada (anon nega, web_reader só lê público); rotas 404/400 nos inválidos; axe 0 violações no crachá com dado real; `npm audit` com 2 avisos no Next (registrados).

## 2026-11-02 · testes (replica-test)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| e2e | 2026-11-02 | done | F05/F07/F08 reais (R2); card OG; mapa com contorno | servidor de teste precisa de build próprio (`NEXT_DIST_DIR=.next-e2e`) e da flag `ALLOW_DEMO_DATA=1`; o estado vazio do ListBox tem `role=option`; rolar a página fecha o popover do React Aria (achou BUG-007); Playwright na sandbox não baixa o headless shell |

Resultado: 38 casos automatizados (Playwright + axe em cada tela, falha em erro de console e 5xx), 34 de primeira, 3 na repetição, 1 corrigido no teste; 10 invariantes do banco verdes; 8 bugs registrados, 7 corrigidos (2 S2 no ETL: carreira multiplicada e eleição suplementar), 1 aberto (S3, intermitente). Nenhum S1.

## 2026-11-02 · build 2 (itens 1–4 do parity.md)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| dados TSE | 2026-11-02 | done | origem do dinheiro por fonte e lista de despesas da campanha | arquivos de 0,5 a 1,3 GB: leitura por HTTP Range só do CSV necessário (votos 2022 = 9,5 mi de linhas em 4 min); despesas pagas não trazem SQ_CANDIDATO, o vínculo vem do prestador nas receitas |
| S01 mapa | 2026-11-02 | done | camadas do mapa (could) | malhas IBGE convertidas em SVG estático (1,9 MB, 27 UFs); 600+ municípios por UF como links exigiu "Pular o mapa" e devolução de foco no Esc; home não pode listar 5.570 cidades → índice por letra (/cidades/[letra]) |
| S09 | 2026-11-02 | partial | agenda, pauta e sessão ao vivo (ETL de agenda) | hemiciclo de 513 cadeiras precisou de raio menor; orientações da Câmara misturam blocos com nomes em CamelCase |
| S10 | 2026-11-02 | done | — | — |
| S05 | 2026-11-02 | done | seções R2 restantes (leis, emendas, comissões, falas, viagens, equipe, contato) | — |

## 2026-11-02 · build 4 (seções do crachá)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| S05 R2 | 2026-11-02 | partial | emendas (precisa de chave do Portal da Transparência), viagens, equipe do gabinete, leis vindas do Senado | o último despacho da Câmara nem sempre traz o número da lei ("recebido ofício… sancionado"): o primeiro parser pegou o número do projeto e foi descartado; só o despacho "Transformado na Lei…" vale (31 de 39 casos) |

## build 5 · dados (agente de ETL, 2026-11-02 → 03)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| D01 presença | 2026-11-03 | done | justificativa de ausência (não está no dado aberto) | sessão certa: só "Sessão Deliberativa" do PLEN (o CN usa o mesmo arquivo); períodos de exercício pelo `/historico` |
| D05 partido | 2026-11-03 | done | data real de filiação para quem só tem TSE | `party_memberships` tem exclusão de sobreposição: virou tabela derivada, reconstruída inteira |
| D06 contadores | 2026-11-03 | partial | licença/morte/cassação pela casa estadual e municipal | vice que concorre a terceiro cargo não pode suceder (AM) |
| D07 TSE | 2026-11-03 | partial | suplentes de senador sem candidatura própria; contas < 2018 | não deixar o diretório virar lista de 1 milhão de candidatos |
| D08/D09 Câmara | 2026-11-03 | partial | leis (1 × 9 da Adriana), colisão de número de REQ entre comissões | API devolve 504 persistente no detalhe de deputados antigos; voto de janeiro/2023 criava crachá de ex-deputado |
| D10 Senado | 2026-11-03 | done | voto individual em votação secreta (a fonte não publica) | a API por senador escondia votações abertas |
| D11 equipe | 2026-11-03 | partial | salário por nível; Senado | — |
| D14 tetos | 2026-11-03 | partial | governador e prefeito (lei local) | — |
| D15 cidade | 2026-11-03 | partial | consulta + bloco na tela; derrotados sem crachá | — |

Backup lógico antes de mexer: `.local/backup-2301.dump` (74 MB) e `.local/backup-0008.dump` (302 MB, antes de apagar os 163 crachás criados por engano).

Números de aceite (SQL, banco local :54329, 2026-11-03 00:10):

- Presença Adriana Ventura: 2026 **74/75** (original 74/75); carreira **912/926 = 98%** (original 911/932 = 98%). Baleia Rossi carreira 814/926 = 88% (original 83%: diferença não explicada; hipótese: o original desconta licenças de outra forma). Senadores: presença null em 81 de 81.
- Comparar Adriana × Baleia: **1.015 iguais em 1.775** votações em comum = 57% (original 1.012 de 1.773 = 57%).
- Adriana carreira: votos 2.966 (original 2.994), propostas 1.581 + 926 (1.654 + 934), cota R$ 476.297 (R$ 517.773), equipe 14 (14).
- Partido: divergentes entre 3.112 em exercício com candidatura 2026: 420 → **0**. Guto Zacarias MISSÃO, Felicio Ramuth MDB.
- Contadores (em exercício): total **70.823** (original 70.798; antes 70.984). Gov+vices 45 (42), estaduais 1.018 (1.015), prefeitos+vices 11.035 (11.026), vereadores 58.129 (58.119), federais e senado exatos.
- TSE: senadores em exercício com candidatura 43 → 75 de 81 (6 suplentes). Adriana campanhas R$ 3.590.142 e patrimônio 2018 R$ 1.074.617; Randolfe R$ 3.036.421; Rubinho Nunes R$ 5.114.600; Ricardo Nunes eleito 4×. Iguais ao original.
- Senado votações 2026/2025/2024: 62/128/95 (= original). CEAPS 2019–2026: 117.800 lançamentos. Autorias: 25.117 matérias.
- Tetos: vereador SP R$ 26.080,98 e Feijó R$ 10.432,39; dep. estadual R$ 34.774,64 (= original). População Campinas 1.189.761 (= original).
- `candidacy_place_votes` 3.111.403 linhas; `campaign_finance_entries` 779.660 linhas (0 com doador ou fornecedor); `staff_members` 10.332; `people` 71.599 (antes 71.592: +7 senadores eleitos em 2018 que o Senado lista como licenciados/afastados).
- `civico-etl check`: 10 de 10 verdes (o de carreira agora compara com o total direto e pegou a multiplicação por orientação duplicada).

Tempo de carga (relógio, rede de casa, cache HTTP do checkout principal):

| job | anos | tempo |
| --- | --- | --- |
| camara.diario `--force` | 2019–2026 | 25 min 30 s (504 da API no detalhe de deputados) |
| camara.presenca | 2019–2026 | 5 min 26 s (histórico de ~600 deputados) |
| senado.diario | 2019–2026 | 2 min 19 s (1ª), 20 s (cache) |
| tse.candidatos `--all` | 2026 / 2018 / 2020+2024 / 2012+2014+2016 | 17 s / 15 s / 2 min 34 s / 5 min 8 s |
| tse.votos (com município) | 2018–2026 | ~6 min (2022: 9,5 mi linhas por Range em 50 s) |
| tse.contas | 2018–2026 | ~3 min |
| camara.equipe, ibge.populacao | — | 5 s, 2 s |
| derive.stats / check | — | 25 s / 3 s |

Revalidação: `REVALIDATE_URL` não está no ambiente do ETL; o app pega o dado novo no próximo ISR.

## 2026-11-03 · build 5 · W1a (itens 1, 2, 3, 4, 7, 9 e 11a do parity.md)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| S22 `/sobre` | 2026-11-03 | done | lista de provedores de dado pessoal (quando houver endereço público) | escrever a política de resposta sem prometer o que não existe: a nota da própria pessoa publicada junto ao dado ainda não foi construída e o texto diz isso |
| S24 `/atualizacoes` | 2026-11-03 | done | agendamento diário; status de falha de carga (`ingest_runs` não é público) | "fora do prazo" é honesto e vai aparecer amanhã: sem agendador, Câmara e Senado passam de 36 h; o teste do prazo é de função pura + coerência da tabela, porque forçar um carimbo velho no banco compartilhado seria invasivo |
| S23 `/dados-abertos` | 2026-11-03 | partial | dados: nenhuma cidade foi conferida (só `desconhecido`), então a matriz real é toda "—" | decidir entre "0%" e "—" (D15); o `sr-only` dentro da tabela estourou a largura da página no celular (BUG-011) |
| direito de resposta + S25 | 2026-11-03 | done | publicar a nota da pessoa junto ao dado | CHECK de `kind` precisou de migração (0005); "exige pessoa" no app para não quebrar o `SET NULL` |
| S03 busca global | 2026-11-03 | done | — | o ComboBox engole o Enter com a lista aberta (precisou de handler); axe com lista aberta acusa 4 regras que são artefato do `aria-hidden` do React Aria (desligadas só nessa checagem); colisão de nomes acessíveis com 6 testes antigos |
| copiar link + WhatsApp | 2026-11-03 | done | — | decidir onde não aparece (D13) |
| S02 onboarding | 2026-11-03 | done | "Como cobrar" (metade do item 11, fica para o próximo lote) | cookie injetado por `storageState` para os 50+ testes antigos não serem bloqueados pelo modal |

Entregas: 7 commits `build5 W1a`, 1 migração (`0005`), 8 specs novos `web/e2e/w1a-*.spec.ts`. Capturas em `replica/clone-screens/` (S22, S23, S24, S03, S02, S05-direito-resposta; 1440 e 390 px, claro e escuro). Nota de feature: 62,4 → 71,4 (`tools/parity.py`).

Pendências desta rodada (front): (1) job de anonimização das sugestões após 12 meses (`/sobre#s-priv` já diz que não é automático); (2) lista de provedores de dado pessoal em `/sobre` quando houver endereço público; (3) "Como cobrar" (metade do item 11); (4) matriz S23 só tem informação quando o ETL municipal conferir cidades; (5) header fixo de 390 px ocupa ~150 px (busca + abas): avaliar recolher as abas ao rolar.

## 2026-11-03 · build 6 (correções de front do ETL, W1 5/6/8/10/11b, W2 12–15)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| A1 presença | 2026-11-03 | done | — | — |
| A2 renúncia/cassação/sucessão | 2026-11-03 | done | licença e morte em estadual/municipal (sem fonte, D33) | `StatusBadge` não conhecia os status novos (rótulo vazio) |
| A3 campanha por ano | 2026-11-03 | done | — | — |
| A4 tabelas novas | 2026-11-03 | done | — | lidas em W1-6 (votos por município, população), W2-13 (campanha), W2-14 (equipe) |
| A5 teto × não conferido | 2026-11-03 | done | — | — |
| A6 Senado | 2026-11-03 | done | o banco não marca "secreta": deduzido de "sem voto individual" (D55) | — |
| A7 D02/D03/D04 | 2026-11-03 | done | janela anterior a 2019 | per-número: presença, propostas, votos e cota começam em anos diferentes |
| W1-5 ano a ano | 2026-11-03 | done | — | tabela `sr-only` e select da cota estouravam 390 px (BUG-015, BUG-016) |
| W1-6 mais votados | 2026-11-03 | done | derrotados sem crachá (D35) | — |
| W1-8 divergências | 2026-11-03 | done | agrupar por pauta como o original (hoje por votação, D59) | texto vazio colidiu com F04-E4 |
| W1-10 salário recebido | 2026-11-03 | partial | subsídio anterior a 02/2023 em `salaries` (ETL) | — |
| W1-11b como cobrar | 2026-11-03 | done | ouvidorias estaduais/municipais | — |
| W2-12 card OG | 2026-11-03 | done | `SITE_URL` na publicação; fonte própria no card | — |
| W2-13 campanha origem/gastos | 2026-11-03 | done | — | — |
| W2-14 equipe/viagens | 2026-11-03 | partial | salário (folha mensal), Senado, viagens | — |
| W2-15 virou lei | 2026-11-03 | done (aba) | rota `/congresso/leis`; leis fora das propostas carregadas | — |

Verificação: `tsc` e `eslint` limpos; `next build` ok (`NEXT_DIST_DIR=.next-e2e`, dados demo); suíte inteira contra 3101 (`E2E_PG=1`): 112 passed, 2 failed, 1 flaky, 1 skipped na 1ª passada; corrigido F04-E4 (colisão de texto) e repetidos os 4 arquivos afetados: 21 passed, 2 flaky (dev server recompilando); specs novos `b6-*` 17/17 sem retry. ONB-H2 é o flaky conhecido do foco do onboarding. Specs novos: `web/e2e/b6-etl-front.spec.ts` (A1–A7), `b6-w1.spec.ts` (W5, W6, W8, W10, W11b), `b6-w2.spec.ts` (W12–W15). Capturas PNG em `replica/clone-screens/png/b6-*` (1440 e 390, claro; crachá e S07 também no escuro; card OG). Toda página capturada mede `scrollWidth` = 390 no celular. Nota de feature: 71,4 → 78,2 (`tools/parity.py`, sem as linhas de /cargos e /dicionario do outro agente). Decisões D50–D65.

Pendências (front/ETL): (1) semear o subsídio federal anterior a 02/2023 em `salaries` (fecha o "salário recebido"); (2) folha mensal da Câmara para salário da equipe; (3) marcar votação secreta no ETL do Senado em vez de deduzir; (4) `SITE_URL` na publicação para o og:image; (5) ouvidorias de Assembleias e Câmaras Municipais; (6) rotas `/congresso/leis`, `/uf/{uf}`, sitemap e robots (D17).
