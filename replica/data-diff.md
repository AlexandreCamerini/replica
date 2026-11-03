# Auditoria de paridade de DADOS: clone × politicometro.org

Data da auditoria: 2026-11-02. Somente leitura de código e banco. Original lido pelo Browser pane (curl direto caiu no Vercel Security Checkpoint, HTTP 429, e não foi contornado), por `fetch` same-origin das próprias páginas e de `/api/galeria/indice`, `/sitemap/{0,1}.xml`, `/robots.txt`. Cerca de 20 requisições ao original. Clone: `localhost:3101` e Postgres `:54329`.

Premissas e limites:
- "Original" = o que o site mostra hoje. Não presumo que esteja certo; onde o clone segue a fonte oficial, está dito.
- Slugs de homônimos diferem entre os dois (`tarcisio` é o governador no clone e um vereador do AC no original; no original o governador é `tarcisio-sp`). Casei por nome, cargo e UF.
- Causa provável marcada "(hipótese)" não foi confirmada no ETL; as demais foram lidas no código ou no banco.
- Datas de carga. Original: TSE candidaturas 22/10, votos 21/10, contas 21/10, situação 30/10; Câmara, Senado e ALESP 02/11. Clone: tudo carregado em 02/11/2026 (TSE 13:43–14:19 e contas 17:36–17:44; Câmara 13:46–13:58; proposições 20:20). Divergência só por data de carga é S3.

## 1. Resumo por severidade

| Sev | Qtd | Itens |
| --- | --- | --- |
| S1 dado errado mostrado como certo | 6 | D01 presença derivada de voto; D02 "na carreira" com janela truncada; D03 zero/"nenhuma" no lugar de "não carregado"; D04 crachá de Executivo lista dados legislativos; D05 partido desatualizado; D06 contadores da home (+186 vagas não descontadas) |
| S2 dado que o clone tem na fonte e não carrega | 13 | D07 TSE só eleitos e só 2022/24/26; D08 Câmara só 2025–26 (votos, cota, presença); D09 proposições (escopo e anos); D10 Senado (proposições, CEAPS, votos, equipe); D11 equipe de gabinete; D12 emendas; D13 nível estadual (ALESP); D14 salários derivados (governador, estadual, vereador, prefeito); D15 "mais votados na cidade"; D16 contas do governo/prefeitura e "prometido × oficial"; D17 rotas só no original; D18 home sem "aguardando posse", população, eleitores; D19 motivos de dado ausente genéricos |
| S3 critério defensável | 5 | D20 gasto de campanha 2026 (pago × contratado); D21 escolaridade; D22 "votaram igual" (janela); D23 votações de 2026 (1.458 × 1.407); D24 datas de carga |
| S4 cosmético | 3 | D25 rótulo de fonte errado no Senado; D26 slugs de homônimos; D27 nome de urna do governador ("Tarcísio") |

Ponto a favor do clone: PCdoB normalizado (o filtro do original lista `PC do B`, `PCdoB` e `PCDOB` como três partidos), "aguardando posse" = 1.682, igual ao original, e contagens por cidade (Campinas 206, Borá 182) idênticas.

## 2. Contadores por cargo (home)

| Cargo | Original (30/10) | Clone home | Clone banco (em_exercicio) | Δ |
| --- | --- | --- | --- | --- |
| Presidência e vice | 2 | 2 | 2 | 0 |
| Senadores | 81 | 81 | 81 | 0 |
| Dep. federais | 513 | 513 | 513 | 0 |
| Governadores e vices | 42 | 54 (27+27) | 54 | +12 |
| Dep. estaduais e distritais | 1.015 | 1.059 (1.035+24) | 1.059 | +44 |
| Prefeitos e vices | 11.026 | 11.110 (5.555×2) | 11.110 | +84 |
| Vereadores | 58.119 | 58.165 | 58.165 | +46 |
| Total no cargo | 70.798 | 70.984 | 70.984 mandatos (70.913 pessoas distintas) | +186 |
| Aguardando posse 2026 | 1.682 | não mostra | 1.682 | 0 (dado existe, UI não mostra: D18) |
| Diretório | 71.649 (= `/p` no sitemap) | 71.592 `people` | | −57 |

Federal fecha exato porque o ETL da Câmara/Senado sobrescreve o status (há 8 deputados e 1 senador `licenciado`, 20 `encerrado`, 1 `renunciou`). Estadual e municipal não têm essa camada: `tse_candidatos.py:273` marca `em_exercicio` por data (`start <= today`) para todo eleito, e só descontam vagas as eleições suplementares (l.286–310; hoje 13 prefeitos, 13 vices, 9 vereadores `encerrado`). Cassação, renúncia, morte e vice que assumiu não entram. Hipótese: os 12 de governador/vice são governadores que renunciaram em 2026 (vice assume, vaga de vice some); não verifiquei qual fonte o original usa ("situação segundo o TSE e as casas legislativas").

## 3. Crachás (6 pessoas)

Legenda: O = original, C = clone. "—" = não mostra.

### 3.1 Adriana Ventura (dep. federal SP, NOVO). Slug igual nos dois.

| Item | O | C | Obs |
| --- | --- | --- | --- |
| Cargo/partido/UF | Dep. federal SP NOVO, 57 anos | idem | ok |
| Salário/mês | R$ 46.366 | R$ 46.366 | ok |
| Total recebido de salário | R$ 3.669.409, 94 meses desde 02/2019 | "Quanto custou na carreira": R$ 2.132.845, 46 meses | clone só vê mandato de 2023 (D02, D07) |
| Patrimônio por ano | 2018 R$ 1.074.617; 2022 R$ 1.203.189; 2026 R$ 1.339.517 | 2022 e 2026 iguais; falta 2018 | D07 |
| Votos recebidos | 69.083 (2026) | 69.083 | ok |
| Campanha total | R$ 3.590.142 (2018, 2022, 2026) | R$ 2.159.218 (só 2026) | 2018 falta; clone rotula "arrecadou na campanha" (D02, D07) |
| Campanha 2026 gasto | R$ 1,33 mi | R$ 985.476 | D20 |
| Eleita | 3 vezes (2018, 2022, 2026) | 2 vezes | D07 |
| Presença | 98% (911/932); 2026 99% (74/75) | 63% (113/178 "dias com votação"); 2026 59% (41/69) | D01 |
| Propostas | carreira 1.654 + 934 coautoria; 2026 279 + 52 | carreira 991 + 624; 2026 255 + 46 | D09 |
| Votos em plenário | carreira 2.994; 2026: 115 (52 sim, 61 não, 2 obstrução); 2025: 388 | carreira 500; 2026: 115; 2025: 385 | 2026 bate; 2025 −3; resto D08 |
| Cota | carreira R$ 517.773; 2026 R$ 42.070; 2025 R$ 92.986 | carreira R$ 131.940; 2026 R$ 42.069; 2025 R$ 89.594 | 2026 bate; 2025 −3,4 mil (hipótese: estornos); anos ≤2024 faltam (D08) |
| Leis | 9 (2022–2024) | 1 (Lei 14.917/2024) | D09 |
| Comissões | 2026 listadas; 79 em todos os anos (comparar) | 12 (2025–26) | janela, D08 |
| Falas | 2026: 143 | 143 (2025: 215 extra; o original só mostra 2026) | ok |
| Equipe de gabinete | 14 pessoas, R$ 115.434/mês (07/2026) | "entra na próxima fase" | D11 |
| Emendas | R$ 101,3 mi pagos 2023–26, 62 prefeituras | "chave do Portal da Transparência" | D12 |
| Contato/redes | gabinete, e-mail, IG, FB, X, TikTok, YouTube, LinkedIn, site | e-mail, telefone, gabinete, IG, FB, X, YouTube | falta TikTok, LinkedIn, site (redes do TSE 2026: D07) |
| Escolaridade | Doutorado | Superior completo | D21 |

### 3.2 Senador: Randolfe Rodrigues (AP, PT). Slug igual.

| Item | O | C |
| --- | --- | --- |
| Salário/mês | R$ 46.366; recebido R$ 6.572.743 (190 meses desde 2011) | R$ 46.366; R$ 4.358.422 (94 meses) |
| Patrimônio | R$ 1.083.915 (2026); 2010 e 2018 | "—, sem declaração publicada" |
| Votos recebidos | 163.857 (2026, não eleito) | "—" |
| Campanha | R$ 3.036.421 (2018, 2026) | "—" |
| Eleições | "Eleito 4 vezes", 6 candidaturas desde 1998 | "Eleições disputadas 0, nenhuma candidatura encontrada no TSE" (falso) |
| Presença | "—, o Senado não publica a lista de presença" | "100%, 21 de 21 dias com votação" (derivado) |
| Propostas | 1.246 + 843 coautoria | "0 / Nenhuma proposta registrada" |
| Votos | 2026: 62; 2025: 128; 2024: 95 ... | 23 na carreira (só 2025–26, 13 + 11 votações nominais do Senado) |
| Cota | R$ 6.685.791 | "—" |
| Equipe | 58 pessoas, R$ 559.722 | "—" |
| Emendas | R$ 207,7 mi | "—" |
| Contato | tel., e-mail, anexo, IG, FB, X, TikTok | tel., e-mail, página oficial |
| Comissões / falas | listadas | 20 / 97 (original: 2025 = 90, 2026 = 58) |

Causa: 38 dos 81 senadores não têm candidatura no banco (43/81 têm; 42 têm patrimônio). São os eleitos em 2018, ano nunca carregado (D07, D10).

### 3.3 Governador: Tarcísio (SP). Clone `tarcisio`, original `tarcisio-sp`.

| Item | O | C |
| --- | --- | --- |
| Cargo/partido | Governador SP, REPUBLICANOS | idem |
| Salário | R$ 36.302/mês | "—, ainda não conferimos onde a Assembleia publica" |
| Patrimônio | R$ 2.696.808 (2026), era R$ 2.342.162 (2022) | R$ 2.696.808 (2026) |
| Votos | 14.491.874 (2026) | 14.491.874 |
| Campanha | R$ 69.110.114 (2 campanhas) | R$ 30.501.925 (só 2026; o banco tem 2022 = R$ 38.608.188) |
| Lista "não está aqui" | n/a: "cargo do Executivo não tem presença, votos nem projetos" | 5 itens legislativos (gastos de gabinete, presença, propostas, votos, "salário dos deputados estaduais") |
| Contas do estado | despesa R$ 355,4 bi, saúde 11,9%, pessoal 42,3% | não tem |
| "Prometido × dado oficial" | por tema, plano 2022 × gastos | não tem |

### 3.4 Prefeito de capital: Ricardo Nunes (SP). Slug `ricardo-nunes-sp` nos dois (`ricardo-nunes` é o vereador de Magalhães de Almeida, MA, nos dois).

| Item | O | C |
| --- | --- | --- |
| Patrimônio | R$ 4.843.351 (2024), era R$ 4.248.354 (2012) | R$ 4.843.351 (2024); 2012 falta |
| Votos | 3.393.110 (2024, 2º turno) | idem |
| Campanha | R$ 54.645.245 (2 campanhas) | R$ 53.978.876 (só 2024) |
| Eleito | 4 vezes (2012, 2016, 2020, 2024) | "Eleito em 2024" |
| Salário | "—" (não publicado) | "—" |
| Lista ausente | "Prefeito é Executivo..."; contas da prefeitura (despesa R$ 106,1 bi, saúde 22,0%, educação 22,2%) | 6 itens legislativos (gastos de gabinete, presença, propostas, votos, "salário dos vereadores") |

### 3.5 Vereador de capital: Rubinho Nunes (SP, UNIÃO). Slug igual.

| Item | O | C |
| --- | --- | --- |
| Salário | "até R$ 26.081, teto" (75% do dep. estadual, porte da cidade) | "—" |
| Patrimônio | R$ 877.300 (2026, candidato a dep. federal), era R$ 131.517 em 2016 | R$ 572.210 (2024) |
| Votos na última eleição | 41.883 (2026, dep. federal, não eleito) | 101.549 (2024, vereador) |
| Campanha | R$ 5.114.600 (3 campanhas) | R$ 2.190.134 (2024) |
| Eleito | 2 vezes (2020, 2024), reeleito 1 vez | "Eleito em 2024" |
| Atividade | nada da Câmara de SP ("ainda não estão no site") | idem ("—") |

Original e clone coincidem em não ter dados da Câmara Municipal de SP.

### 3.6 Dep. estadual: Guto Zacarias (SP). Slug igual.

| Item | O | C |
| --- | --- | --- |
| Partido | MISSÃO (candidatura 2026) | UNIÃO (mandato 2022) |
| Salário | R$ 34.775/mês; R$ 1.462.891 recebidos (44 meses, estimativa) | "—" |
| Cota/verba | R$ 376.339 | "—" |
| Propostas | 389 | "—" |
| Patrimônio | R$ 162.000 (2026), era R$ 500 (2022) | R$ 500 (2022) |
| Votos | 41.423 (2026, dep. federal, suplente) | 152.481 (2022) |
| Campanha | R$ 957.663 (2 campanhas) | R$ 732.981 (só 2022) |
| Presença ALESP | mostrada nos cartões ("3/11 presenças") | não tem |

## 4. Representantes por cidade

Campinas (3509502): original 206 = clone 206. Níveis iguais: prefeitura 2, vereadores 33, governo 2, dep. estaduais 94, senado 3, dep. federais 70, presidência 2. Nomes de vereadores iguais.
Borá (3507209): 182 = 182 (prefeitura 2, vereadores 9, demais iguais).

Diferenças:
- Vice-governador de SP, Felicio Ramuth: original MDB, clone PSD (D05).
- "Mais votados na cidade (2022)" (10 por cargo, deputado federal e estadual, com "eleito"): clone não tem. `candidacy_place_votes` tem 0 linhas e nenhum job escreve nela (D15).
- Cabeçalho do original: "870.672 eleitores na eleição de 2026 (TSE) · 1.189.761 moradores em 2026 (IBGE)" (Borá: 1.094 / 935). Clone não mostra (D18).
- Original mostra presença da ALESP e da Câmara nos cartões ("74/75 presenças"); clone só nome, cargo e partido.
- Motivos de dado ausente: original específico ("a Câmara publica (SAPL), mas o sistema dela está fora do ar"); clone genérico ("ainda não conferimos se a câmara publica") para todas as cidades (D19). No banco 5.571 municípios têm status `desconhecido` para 4 datasets.

## 5. Comparar adriana-ventura × baleia-rossi

| Item | O (todos os anos) | C (carreira) |
| --- | --- | --- |
| Votaram igual | 57% (1.012 de 1.773) | 39% (118 de 303) |
| Pautas em comum | 1.773 votações; 400 divergentes | 303 votações |
| Presença | 98% × 83% | 63% × 54% |
| Propostas | 1.654 × 777 | 991 × 29 (Baleia: 10 principal em 2025) |
| Votos registrados | 2.994 × 2.511 | 500 × 326 |
| Cota | R$ 517.773 × R$ 6.055.355 | R$ 131.940 × R$ 614.636 |
| Comissões | 79 × 35 | não mostra |
| Eleito | 3 × 8 vezes (desde 2000) | só 2026 |

Conferi o cálculo do clone por SQL em `votes`: 303 votações em comum (2025: 252, 2026: 51), 118 iguais. A conta do clone está certa para a janela que ele tem; a diferença para o original é a janela (2019–2026 × 2025–2026) e não a fórmula. O clone mostra "39%" sob título "Carreira" sem avisar a janela (D02). Cruzamento: Adriana não × Baleia sim em 111 casos, sim × sim em 79, sim × não em 50, não × não em 39, e 24 casos de obstrução de Adriana.

## 6. Congresso

- Votações em 2026: original 1.458 (Câmara + Senado, inclui simbólicas: "Câmara 4 · Senado 1" por dia). Clone: 1.407 eventos de 2026 em `voting_events` (Câmara 1.396, 137 nominais no total; Senado 11); a tela mostra só "Votações nominais 555" (2025 + 2026) e nenhuma contagem de 2026. A diferença de 51 é provavelmente o Senado (11 votações em 2026 no clone, enquanto Randolfe sozinho tem 62 votos em 2026 no original). Hipótese não verificada.
- Composição da Câmara no clone (513): AVANTE 5, CIDADANIA 2, MDB 38, MISSÃO 1, NOVO 5, PCdoB 11, PDT 9, PL 98, PODE 27, PP 47, PRD 3, PSB 17, PSD 48, PSDB 17, PSOL 13, PT 66, PV 6, REDE 3, REPUBLICANOS 43, SOLIDARIEDADE 4, UNIÃO 50. O hemiciclo do original é renderizado no cliente; não consegui extrair a tabela para confrontar. Soma fecha em 513. Cuidado: o filtro de partido do original tem `PC do B`, `PCdoB` e `PCDOB` separados; o clone normaliza.
- Original tem filtro por casa, "só o que muda leis", 26 anos de histórico (2001–2026) e agenda mensal; clone tem 2025–2026.

## 7. Rotas

Só no original (sitemap tem 71.649 `/p/*`, 27 `/uf/{uf}`, 27 `/governos/{uf}`, mais as listadas):

| Rota | Clone |
| --- | --- |
| `/uf/{uf}` (27) | 404 |
| `/governos/{uf}` (27) e `/governos/marcos` | 404 |
| `/congresso/leis` | 404 (a aba "virou lei" existe na tela, sem rota própria) |
| `/stf/decisoes` | 404 |
| `/sitemap/0.xml`, `/sitemap/1.xml`, `/robots.txt` | 404 (sem sitemap nem robots) |
| `/instagram`, `/canal` (redirects de rastreio) | 404 |
| `/api/galeria/indice`, `/api/evento`, `/api/online`, `/api/conta/eu` | não existem (clone: `/api/me`, `/api/people/*`, `/api/places`, `/api/compare/agreement`) |

Só no clone: `/design`, `/votacoes/[id]`, `/cidades/[letra]`, `/api/revalidate`, `/api/people/[slug]/{votes,proposals,expenses}`. Em comum e com 200 no clone: `/`, `/quem`, `/representantes`, `/comparar`, `/congresso`, `/partidos`, `/governos`, `/eleicoes`, `/stf`, `/impostos`, `/propostas`, `/cargos`, `/dicionario`, `/mais-vistos`, `/dados-abertos`, `/sobre`, `/atualizacoes`, `/sugestoes`, `/ajudar`, `/mcp`, `/entrar`, `/acompanhando`.

## 8. Tabela por divergência

| ID | Sev | O mostra | C mostra | Causa provável | Correção (arquivo) |
| --- | --- | --- | --- | --- | --- |
| D01 | S1 | Presença oficial: 98% (Adriana, 911/932), 83% (Baleia); Senado: "—, não publica" | 63% e 54%; senador 100% (21/21) | `camara_diario.py:9,335` deriva presença de "registrou voto" em votação nominal; `senado_diario.py` igual, então senador nunca fica ausente; base = só dias com nominal (178 × 932) | Trocar a fonte pela frequência oficial da Câmara (confirmar endpoint/arquivo de presença em sessões deliberativas) e gravar em `attendance`. Até lá: não exibir % de presença quando derivada (usar "participou de X votações nominais"); Senado exibe "—" com a explicação. Arquivos: `etl/.../camara_diario.py`, `senado_diario.py`, `derive_stats.py`, `web/src/app/p/[slug]/page.tsx`, `web/src/app/comparar/page.tsx` |
| D02 | S1 | "Na carreira" = tudo desde o primeiro mandato (2019) | rótulo "carreira" sobre 2023–2026 (propostas), 2025–2026 (votos, cota, presença), 46 meses de salário, 1 eleição de campanha/votos | ETL carrega janela curta e a UI não declara a janela; `person_period_stats` career soma só o que existe | Mostrar a janela no rótulo ("desde 02/2025") enquanto D07/D08/D09 não fecham, ou esconder o card "carreira" quando `career` cobre menos que o mandato; `web/src/lib/data/pg.ts` (stats), `p/[slug]/page.tsx` |
| D03 | S1 | Dado não carregado = "—" ("nunca zero") | Senador: "Propostas 0 / Nenhuma proposta registrada", "Eleições disputadas 0 / Nenhuma candidatura encontrada no TSE" | Seções renderizam lista vazia como fato; contradiz o próprio banner "ainda não está aqui" | Renderizar "—/não carregado" quando `missing_datasets` contém o dataset; `p/[slug]/page.tsx` (seções Propostas, Eleições) |
| D04 | S1 | Executivo: "não tem presença, votos nem projetos"; mostra contas do governo/prefeitura | Governador/vice/prefeito/vice recebem a lista de dados legislativos faltando (gastos de gabinete, presença, propostas, votos, salário de dep. estadual/vereador) | `pg.ts:336-340`: `level !== "federal"` filtra só por prefixo `prefeito`/`vereador`/`estaduais`, não por tipo de cargo | Filtrar por `m.office` (executivo: só `salario_prefeito`/governador); trocar a lista pelo texto de Executivo; `web/src/lib/data/pg.ts` l.336, `p/[slug]/page.tsx` |
| D05 | S1 | Partido da candidatura 2026 / filiação atual (Guto Zacarias MISSÃO, Felicio Ramuth MDB) | Partido do mandato (UNIÃO, PSD) | `HOLDER_SELECT` (`pg.ts:137-148`) usa `person_current_party` (só alimentada por Câmara/Senado, 621 linhas) ou o partido na posse. Entre 1.249 em exercício com candidatura 2026, 420 divergem: dep. estadual 249/659, federal 93/330, vereador 37/148, prefeito 21/34, vice-governador 6/13, vice-prefeito 5/10 | `coalesce(cp.party_id, partido da candidatura mais recente com eleição ≥ posse, m.party_id)`; ou preencher `party_memberships` com a candidatura 2026; `pg.ts` HOLDER_SELECT, `etl/.../tse_candidatos.py` |
| D06 | S1 | 70.798 (gov+vices 42, estaduais 1.015, prefeitos+vices 11.026, vereadores 58.119) | 70.984 (54, 1.059, 11.110, 58.165) | Estadual/municipal: `em_exercicio` por data, sem vacância (renúncia, cassação, morte, vice que assumiu); só suplementar encerra | Camada de status para ALE/câmaras/prefeituras (TSE `DS_DETALHE_SITUACAO_CAND`, renúncias, diplomação) ou reconhecer que o número é "eleitos", não "no cargo"; `tse_candidatos.py:273`, `derive_stats.py`, texto da home |
| D07 | S2 | TSE 1998–2026, eleitos ou não: eleito N vezes, patrimônio por ano, campanhas (soma), "última eleição" mesmo derrotado, redes declaradas ao TSE | Só eleitos de 2022, 2024, 2026 (1.707/69.510/1.710 candidaturas); 2018 e 2020 nunca carregadas (não há `dataset_stamps`; o run de 2022 falhou uma vez); `candidacy_place_votes` vazia | `cli.py:58-59` roda `only_elected=not a.all`; `tse_candidatos.py:152` filtra eleitos | Rodar `--all` e anos 2018, 2020 (e 2014/2016 se couber); revisar `_load_year` para persistir derrotados; somar campanhas na carreira em `derive_stats.py`; redes do TSE em `mandate_contacts` |
| D08 | S2 | Câmara desde 2019: votos, cota, presença | `camara.votacoes` e `camara.despesas` só 2025, 2026 | Anos configurados no CLI/job | Ampliar anos em `cli.py` para 2019–2026 (volume de votos é o custo: hoje 134 mil sim + 88 mil não) |
| D09 | S2 | Adriana 2026: 279 + 52; 2025: 673; leis 9 | 255 + 46; 2025: 409; leis 1; anos ≤2022: 50 propostas no banco | `KEEP_TYPES` (`camara_diario.py:47`) exclui emendas e outros tipos (original diz "Pedidos e emendas"); proposições só 2023–2026; leis derivadas só do status "Norma Jurídica" dessas | Incluir tipos de emenda; carregar 2019–2022; revisar `_parse_law` com `proposicoesAutores` completo (hipótese quanto à causa dos −30 de 2026) |
| D10 | S2 | Senado: 1.246 propostas, CEAPS R$ 6,7 mi, 62 votos em 2026 | "próxima fase"; 24 votações nominais do Senado em 2025–26 | `senado_diario.py` só senadores e votações; sem matérias nem CEAPS | Adicionar jobs de matérias de autoria e CEAPS; revisar por que só 11 votações em 2026 |
| D11 | S2 | Equipe: Senado 58 pessoas, Câmara 14 com salário do mês | `staff_members` com 0 linhas | Não há job | Job Câmara (secretários parlamentares) e Senado (servidores + folha); `etl/.../parlamento_extras.py` |
| D12 | S2 | Emendas R$ 101,3 mi (Adriana), R$ 207,7 mi (Randolfe) | `amendments` com 0 linhas | Depende de chave do Portal da Transparência (bloqueio declarado em `decisions.md` D04) | Pedir a chave ao dono; job de emendas por favorecido |
| D13 | S2 | ALESP: salário, cota, propostas, presença (Guto: R$ 34.775, R$ 376.339, 389) | tudo "—", "próxima fase" | Nível estadual sem ETL | Job ALESP (dados abertos) e demais ALEs conforme cobertura |
| D14 | S2 | Salário: governador R$ 36.302 (SP), dep. estadual R$ 34.775 (= 75% do federal), teto de vereador por porte (SP R$ 26.081 = 75% do estadual; Feijó R$ 10.432 = 30%) | `salaries` só tem presidente, vice, senador, dep. federal | Teto constitucional é derivável, mas ninguém gravou | Seed em `salaries` (is_ceiling = true) com regra do art. 27 §2º e art. 29 VI da CF por faixa de população IBGE; governador por lei estadual; `etl/.../seed.py` |
| D15 | S2 | "Mais votados na cidade (2022)", 10 por cargo, com "eleito" | ausente | `candidacy_place_votes` vazia, sem job, sem consulta em `pg.ts` | Job lendo `votacao_candidato_munzona` (já usado em `tse_votos_contas.py`) agregando por município; query + bloco em `representantes/page.tsx` |
| D16 | S2 | Contas do governo/prefeitura, "Prometido × dado oficial" por tema | ausente | Sem fonte fiscal nem planos no crachá do Executivo (`gov_plan_excerpts` existe) | Fora do núcleo; registrar como backlog |
| D17 | S2 | `/uf/{uf}`, `/governos/{uf}`, `/governos/marcos`, `/congresso/leis`, `/stf/decisoes`, sitemap, robots | 404 | Rotas não construídas | `web/src/app/{uf/[uf],governos/[uf],congresso/leis,stf/decisoes}`, `app/sitemap.ts`, `app/robots.ts` |
| D18 | S2 | Home: "+1.682 eleitos em 2026 aguardando posse", população IBGE; cidade: eleitores TSE e moradores IBGE | ausentes (o banco tem 1.682) | UI | `web/src/app/page.tsx`, `representantes/page.tsx`; eleitorado exige novo dataset |
| D19 | S2 | Motivo específico por cidade (SAPL fora do ar, TCE não publica) | "ainda não conferimos..." para todas | `data_coverage` com 5.571 `desconhecido` por dataset | Rodada de curadoria por UF; sem isso a mensagem é honesta, mas pobre |
| D20 | S3 | Adriana 2026 gastou R$ 1,33 mi | R$ 985.476 | `tse_votos_contas.py` soma `VR_PAGTO_DESPESA` (despesa paga); o original parece usar contratada. 2022 bate (958 mil) | Decidir o critério e rotular ("pago"); opcional somar `despesas_contratadas` |
| D21 | S3 | Escolaridade Doutorado | Superior completo | Clone fixa a primeira leitura TSE (2022) | Usar o registro mais recente; `tse_candidatos.py` (`PersonResolver.create` só no primeiro insert) |
| D22 | S3 | 57% em 1.773 votações (2019–2026) | 39% em 303 (2025–2026) | Janela de dados (D08); fórmula do clone confere por SQL | Mostrar a janela no cartão; resolve com D08 |
| D23 | S3 | 1.458 votações em 2026, com simbólicas | 1.407 eventos; UI mostra 555 nominais | Critério de contagem e Senado incompleto | Exibir total de 2026 e separar nominal/simbólica; `congresso/page.tsx` |
| D24 | S3 | TSE de 21–30/10, Câmara de 02/11 | tudo 02/11 | Data de carga | Nenhuma |
| D25 | S4 | Fonte correta por casa | Bloco "Contato" e "Propostas" de senador citam "Câmara dos Deputados" | Rótulo fixo | Usar a casa do mandato; `p/[slug]/page.tsx` |
| D26 | S4 | `tarcisio` = vereador do AC; governador = `tarcisio-sp` | `tarcisio` = governador SP | Desempate de slug por ordem de carga; links externos para `/p/tarcisio` divergem | Aceitável; se a paridade de URL importar, fixar o desempate com sufixo de UF (o original usa `-sp`) |
| D27 | S4 | "Tarcísio" (nome de urna) | "Tarcísio" | Nome de urna, igual nos dois | Sem ação |

## 9. Corrigir agora (ordem)

1. D04: parar de listar dados legislativos como "faltando" para governador, vice e prefeito (S1, correção local em `pg.ts` + texto do crachá, sem ETL).
2. D03: trocar "0 / nenhuma candidatura / nenhuma proposta" por "—/não carregado" quando o dataset consta como faltando (S1, UI).
3. D01: retirar o percentual de presença derivado de voto (S1; vale para Câmara, Senado e `/comparar`); depois substituir pela frequência oficial.
4. D02: rotular a janela de cada número "na carreira" ou escondê-lo enquanto D07–D09 não fecham.
5. D07: recarregar TSE com `--all` para 2018, 2020 e 2022–2026 (maior ganho de paridade por esforço: patrimônio, campanhas, "eleito N vezes", 38 senadores sem nada, escolaridade e partido de 2026).
6. D05: partido exibido = candidatura 2026 mais recente quando a Câmara/Senado não fornece filiação.
7. D08/D09: Câmara 2019–2022 (votos, cota, proposições) e tipos de emenda em `KEEP_TYPES`.
8. D06: camada de vacância estadual/municipal, ou renomear o contador da home.
9. D14: seed de tetos salariais (dep. estadual, vereador, prefeito, governador).
10. D15: popular `candidacy_place_votes` e exibir "mais votados na cidade".
11. D10/D11/D13: Senado (matérias, CEAPS), equipes de gabinete, ALESP.
12. D17/D18: rotas `/uf`, `/governos/{uf}`, sitemap e robots; contador "aguardando posse" e população na home.
