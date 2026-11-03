# Reverificação independente de BUG-020 a BUG-029: 2026-11-03

Branch `claude/replica-skill-diff-3e9942` em aa72e47. O verificador não escreveu as correções.

Ambiente:
- Banco `civico` em modo só leitura (`default_transaction_read_only=on`).
- Dev server em 3101, que não foi derrubado.
- O backup `pre-bug020-024.dump` foi restaurado num banco temporário (`civico_reverify_tmp`), só com `expenses`, `mandates`, `party_memberships`, `party_observations` e `person_period_stats`. O banco foi apagado no fim.

Nenhum código de produto e nenhum dado do `civico` foram alterados.

## Veredito: não entregável

Há 3 S1 novos e o BUG-024 foi reaberto.

| # | Sev. | Resumo |
|---|---|---|
| BUG-030 | S1 | A cota subtrai a complementação do auxílio-moradia, que a Câmara soma. Afeta 84 a 96 deputados por ano, com o pior caso em -31% (Luciano Vieira 2024: 449.994 no clone contra 516.374,69 na página). |
| BUG-031 (reabre BUG-024) | S1 | DF, RJ e RR mostram como governador quem já saiu: Ibaneis, Cláudio Castro e Denarium. O `check` "1 por UF" passa porque conta linhas e não confere a pessoa. |
| BUG-032 | S1 | Identidade casada pelo `SQ_CANDIDATO` sem o ano. 15.769 pessoas recebem uma candidatura de 2012 ou 2014 de outra pessoa, e 3.406 mandatos de 2012 estão ligados à pessoa errada. Origem do caso "Dinelci" do Roberto Cidade. |

## Bug × veredito

| Bug | Veredito | Evidência |
|---|---|---|
| BUG-020 | parcial | Chave por linha ok: 2024 no banco é igual ao `Ano-2024.csv` por deputado, nas 232.014 linhas e no centavo. Não há duplicata. Falha o critério "bate com a página" para quem tem auxílio-moradia (BUG-030). |
| BUG-021 | confirmado | 513 de 513, MISSÃO 1. Os 21 partidos e os 513 deputados batem com a API `/deputados`. |
| BUG-022 | parcial | Os 81 senadores batem com `senador/lista/atual`, sem nenhuma divergência. O crachá ainda não diz a fonte nem a data do partido, que o Expected pedia. |
| BUG-023 | confirmado | 2012 a 2025 iguais à SIDRA 10379 (2019 a 2025: 11,8 / 13,7 / 14,0 / 9,6 / 7,7 / 6,6 / 5,6). |
| BUG-024 | reaberto | O AM está ok. DF, RJ e RR estão errados (BUG-031). |
| BUG-025 | confirmado | 42 saídas: 39 em 01/01/2025, mais AP, CE e AM. Amostra de 5 confere. A tela mostra "65 de 70" com o motivo. |
| BUG-026 | confirmado | /comparar cita a fonte e a data por bloco. O crachá lista a fonte por número. |
| BUG-027 | não conferido | O Playwright não tem o chromium-headless-shell 1248 instalado. |
| BUG-028 | confirmado | A ajuda do tile e /sobre explicam sessão contra dia e o tratamento da ausência justificada. |
| BUG-029 | confirmado | `npx eslint` sai com código 0. |

## Números conferidos (tela ou banco × fonte)

### Cota da Câmara

Página de referência: `camara.leg.br/deputados/{id}?ano=`. São 6 deputados de partidos e UFs variados, fora da `COTA_REFERENCIA`.

| Deputado | 2023 página / banco | 2024 página / banco | 2025 página / banco |
|---|---|---|---|
| Erika Hilton (PSOL-SP) | 411.632,50 / 384.988,78 | 492.049,79 / 465.863,47 | 506.616,91 / 444.871,49 (tela R$ 444.871) |
| Luciano Vieira (PL-RJ) | 467.736,88 / 384.761,08 | 516.374,69 / 449.993,86 (tela R$ 449.994) | 495.275,83 / 410.066,44 |
| Jorge Solla (PT-BA) | 500.597,31 / 543.772,16 * | 531.145,88 / 523.811,88 | 538.934,40 / 523.406,40 |
| Deputado Dal (UNIÃO-BA) | 489.089,55 / 489.089,55 | 532.819,17 / 532.819,15 | 536.657,53 / 536.657,53 |
| Pedro Lupion (PP-PR) | 508.858,96 / 519.624,94 * | 529.523,91 / 512.065,91 | 538.164,45 / 538.164,45 |
| Átila Lira (PP-PI, id 123086) | 498.637,76 / 498.637,76 (só a chave 123086) | 580.149,83 / 580.149,83 | 567.666,92 / 567.666,92 |

\* Ano de troca de legislatura. A página mostra só a 57ª, e o banco soma o ano inteiro (D183).

Todas as diferenças restantes somem com o sinal da subcota 40 (moradia) trocado. Mais 14 deputados, sorteados para 2025, batem com a página até R$ 0,14; o único fora disso tem moradia (204486: -85.134,06, e +0,04 depois de corrigido).

### Senado (CEAPS)

- Contra a API `adm.senado.gov.br/.../despesas_ceaps`: 2019 com 58 de 58 senadores do banco e 2025 com 77 de 77, ao centavo.
- A fonte tem 127 senadores em 2019 e 83 em 2025. Os que faltam não estão no diretório; é cobertura, não defeito da correção.
- Rodrigo Pacheco 2025 está entre os conferidos.

### Partidos

- Senado: AVANTE 1, MDB 9, PDT 1, PL 15, PODE 3, PP 8, PSB 7, PSD 14, PSDB 4, PT 9, REPUBLICANOS 6, S/Partido 1, UNIÃO 3. Bate com a API na tela e senador por senador.
- Câmara: 513 deputados, partido a partido igual à API. 10 sorteados também batem por pessoa: Charles Fernandes, Dorinaldo Malafaia, Eduardo Bismarck, Filipe Martins, Dal Barreto, Bandeira de Mello, Jorge Goetten, Daniela do Waguinho, Fábio Macedo e Saulo Pedroso.

### Desemprego

/governos é igual à apisidra `t/10379/n1/all/v/4099`, linha Total, de 2012 a 2025.

### Governadores

- 24 UFs batem com as listas de renúncias de abril de 2026 publicadas na imprensa (IstoÉ, Congresso em Foco).
- DF, RJ e RR não batem (BUG-031).
- AM: a página da Governadoria (08/05/2026) nomeia Roberto Maia Cidade Filho. É suficiente para "quem", mas não para "desde quando" nem "como": não menciona posse nem eleição indireta. Para a data de 04/05/2026, a fonte oficial seria o DOE-AM ou a ALEAM.
- Ressalva: não conferi o portal oficial de cada uma das 27 UFs, só imprensa nacional e a Governadoria do AM.

## Efeitos colaterais procurados

| Hipótese | Resultado |
|---|---|
| A recarga de 2019 a 2026 apagou linha legítima ou mexeu em ano fechado | Não. O total por ano subiu em todos os anos da Câmara (2019: 138,4 mi → 144,3 mi). As 3 carreiras que caíram são estornos recuperados ou a regra do ano de competência: Alberto Mourão 2024 tem banco = arquivo, 153 linhas. |
| Ano de competência na CEAPS desloca valor entre anos | Sim, e de propósito. Davi Alcolumbre tem notas de 2021 com competência em 2020 (373.400 mudaram de ano). O total por senador bate com a API por ano de competência. |
| A CEAPS passou a ligar senadores novos | Sim, 9: Pacheco, Mecias, Jorginho Mello e outros. Todos são senadores com mandato desde 2019. É ganho de cobertura, mas não está documentado no D180. |
| "Partido da casa vence o TSE" errou para quem trocou de casa | Não. Contra o backup, só mudaram Eliziane e Romário. Os 81 senadores e os 513 deputados batem com as casas. |
| O `derive.stats` mudou totais de carreira fora da cota | Não. Em 506.624 linhas de `person_period_stats`, só a coluna `expenses_cents` mudou (4.232 linhas). |
| Recarga da cota agravou outro defeito | Sim. A subcota de moradia passou de saldo -2,71 mi (com 1.569 linhas positivas) para -7,36 mi (todas negativas). Ver BUG-030. |

## Achado solto: Roberto Cidade e "Dinelci"

É casamento de identidade errado.
- A candidatura de 2012 (Fonte Boa, PCdoB, "Dinelci") e a de 2016 (Manaus, "Roberto Cidade") têm o mesmo `tse_sequencial`, 40000001600.
- `person_external_ids` guarda `tse:40000001600` sem o ano, e `people.resolve` resolve por `exact_id` antes do título.

Casos parecidos:
- Detector exato ("mesmo sequencial em anos diferentes, mesma pessoa"): 15.769 pessoas.
- Heurística pedida (nome de urna sem token em comum com o nome civil): sozinha, marca 61.768 candidaturas, a maioria apelido legítimo. Cruzada com o detector exato, sobram 15.649 casos de 2012.

Tudo está registrado em BUG-032.

## O que não conferi e por quê

- BUG-027 (ONB-H2): falta o navegador do Playwright no cache, e baixar o binário ficou fora do escopo.
- Governador por portal oficial nas 27 UFs: usei imprensa nacional, mais a Governadoria do AM. Também não sei quem governa RR hoje: a suplementar estava sub judice nas últimas fontes achadas.
- Cota de 2026 (ano corrente) contra a página: não conferida, porque o total muda todo mês.
- 1 deputado da amostra (Afonso Florence, 160508): a página não trouxe o bloco de cota no formato esperado.

# Reverificação 2: BUG-030, BUG-031, BUG-032 e D201 (2026-11-03)

Branch `claude/replica-skill-diff-3e9942` em e683a93. O verificador não escreveu as correções (2c538ad, 1d16fcd, 49ea4f6 e e683a93).

Ambiente:
- Banco `civico` local. A única escrita foi `derive.stats` (2×, item 4).
- Dev server em 3101.
- Arquivos da Câmara (`Ano-2019..2026.csv`) e `consulta_cand` do TSE lidos do cache HTTP do ETL (`etl/.cache`, baixados em 03/11).
- Páginas da Câmara lidas por curl e WebFetch em 03/11.
- Governadores: duas pesquisas independentes, por subagentes, em portais oficiais e imprensa.

Nenhum código de produto e nenhum dado foram corrigidos.

## Veredito: não entregável

Há 1 S1 novo e 2 S2 novos.

| # | Sev. | Resumo |
|---|---|---|
| BUG-033 | S1 | Eli Corrêa Filho (Câmara 160532) foi fundido em Geninho Zuliani por "mesma cadeira + mesmo nascimento". O prefeito de Olímpia aparece como "Eli Corrêa Filho". É anterior a esta noite. |
| BUG-034 | S2 | As 4 linhas de glosa de 2020–2021 que o D200 não conferiu divergem da página: 3 deputado-ano entre R$ 7,7 mil e 26,8 mil abaixo. |
| BUG-035 | S2 | Em 2012 o SQ não é único na eleição (91 casos). O `fix032` removeu 8 candidaturas do dono verdadeiro, com 3 mandatos. |
| BUG-036 | S3 | 1.002 eleitos de 2012 com mandato atual sem a candidatura de 2012. Não foi causado pelo reparo. |

## Bug × veredito

| Bug | Veredito | Evidência |
|---|---|---|
| BUG-030 | confirmado | 12 deputado-ano fora da referência batem com a página: 8 com moradia (2019–2025, RJ, AC, GO, SC, RR, MG, SP) e 4 sem. Diferença máxima de R$ 0,55 (Misael 2024), salvo a troca de legislatura e um mês que a página omite (Pastor Eurico 2019). A regra só pega as subcotas 40 e 996, não há estorno real somado e nenhuma outra subcota tem o padrão. Banco = arquivo em 3.877 de 3.880 deputado-ano. |
| BUG-031 | confirmado | As 27 UFs foram conferidas, sem pessoa divergente. A tela bate em 12 cidades e na home (25 de 27, 15 de 27). O "—" de RJ e RR é honesto e claro: diz quem exerce, desde quando e por quê. Há duas ressalvas S4 (vice do AM e texto fixo da sucessão). |
| BUG-032 | parcial | 1.051 de 1.051 religações conferem pelo título. A amostra de 15 remoções está correta. Mas 8 remoções caíram no dono verdadeiro porque o SQ de 2012 se repete na eleição (BUG-035). |
| D201 | confirmado | Duas rodadas de `derive.stats` + `check`: 32 de 32 ok nas duas. O md5 do conteúdo de `party_memberships` (pessoa, partido, de, até) é 1923a9ec5508d090b3212ab71b3feadb antes, na primeira e na segunda rodada, com 138.734 linhas. O md5 da linha inteira muda a cada rodada porque o derive regrava id e timestamps; não é o mesmo critério do f2fbf70c… do D201. Bebeto (220612) está no PP desde 01/02/2023 e Toninho Wandscheer (178934) no PP desde 10/01/2023: igual ao `/historico` da API e ao crachá. |

## Números conferidos

### Cota (BUG-030), página × banco

| Deputado-ano | Moradia | Página | Banco | Obs. |
|---|---|---|---|---|
| Pedro Paulo (RJ) 2019 | sim | 384.025,11 | 384.025,05 na 56ª | O ano inteiro, 431.732,41, inclui a 55ª (D183) |
| Alan Rick (AC) 2020 | sim | 432.237,78 | 432.237,78 | |
| Talíria Petrone (RJ) 2021 | sim | 434.919,21 | 434.919,21 | |
| Glaustin da Fokus (GO) 2021 | sim | 388.569,09 | 388.569,09 | |
| Geovania de Sá (SC) 2022 | sim | 444.516,36 | 444.516,36 | |
| Duda Ramos (RR) 2023 | sim | 556.418,59 | 556.418,59 | |
| Misael Varella (MG) 2024 | sim | 498.473,33 | 498.472,78 | +0,55, sem linha da API |
| Fábio Teruel (SP) 2025 | sim | 278.459,79 | 278.459,79 | |
| Zeca Dirceu (PR) 2021 | não | 474.339,00 | 474.339,00 | |
| Leo Prates (BA) 2025 | não | 552.196,55 | 552.196,55 | Inclui 71.550,36 de SIGEPA da API |
| Aluisio Mendes (MA) 2023 | não | 467.920,35 | 467.920,34 na 57ª | Troca de legislatura |
| Pastor Eurico (PE) 2019 | não | 334.379,17 | 435.599,86 na 56ª | A página omite dezembro (101.220,69 no arquivo); fevereiro a novembro iguais ao centavo |
| Eduardo Bolsonaro 2020 | glosa | 318.370,74 | 310.702,74 | BUG-034 |
| Enio Verri 2020 | glosa | 423.942,17 | 416.179,51 | BUG-034 |
| Eduardo da Fonte 2021 | glosa | 491.252,01 | 464.478,01 | BUG-034 |

Sinal nos 8 arquivos:
- Linhas viradas: 4.345 da subcota 40 e 6 da 996; nenhuma de outra subcota.
- Negativos que sobram: SIGEPA/RPA com documento negativo (estorno) e as 4 linhas de glosa.
- Nenhuma linha 40/996 tem líquido positivo na fonte, então não há estorno real que a regra some.

### Governadores (BUG-031)

| UF | Fonte |
|---|---|
| DF | CLDF e df.gov.br |
| ES | es.gov.br, 02/04 |
| GO | goias.gov.br, 31/03 |
| MG | Agência Minas, 22/03 |
| MT | ALMT, 31/03 |
| PA | ALEPA, 02/04 |
| PB | A União, 02/04 |
| AC | agencia.ac.gov.br, 02/04 |
| AM | TJAM, 25/08/2026: Cidade governador, Serafim Corrêa vice |
| RJ | STF, notícia de 24/04/2026 (Rcl 92644) |
| RR | ALE-RR, 30/04 |

- Demais UFs: TSE (reeleições), DOE ou portal; MA no DOE-MA de 14/01/2026.
- RR: a suplementar segue sem proclamação até 21/10 (imprensa) e Sampaio é o interino. O motivo na tela está certo.
- AL: Dantas esteve licenciado de 14/10 a 30/10 e já reassumiu (imprensa). A renúncia de Lessa só aparece na imprensa, e a tela diz isso.
- Ressalvas S4:
  - O motivo do vice do AM ignora o TJAM, fonte oficial que já nomeia Serafim.
  - O crachá de Celina Leão diz que Ibaneis "renunciou para disputar outro cargo". Ele renunciou com esse fim, mas desistiu em 08/07; o texto é fixo para toda sucessão.

### Identidade (BUG-032)

- 15 religadas, sorteadas com semente 32: título igual em 15 de 15 e nome civil + nascimento em 14 (Jaciberques/Jacibergues). Varredura: título confere nas 1.051.
- 15 removidas: o dono pelo título ou por nome + nascimento não está no diretório.
- Varredura total das 14.760:
  - Os 5 `conflito` têm o dono no diretório, mas ele ficou com a candidatura do registro substituído (Felipe Pessoa, Arnaldo Aciole, Romualdo, Divino e Ricardo da Loja). Isso é correto pela D211.
  - Conferindo contra todas as linhas do SQ, e não só a primeira, 8 `sem_pessoa` são do próprio "de", por causa do SQ repetido em 2012 (BUG-035). As outras 14.747 não têm dono no diretório.
- Falso negativo (mesmo SQ, mesma pessoa, separado errado): só esses 8. Entre anos, nenhum: ninguém tem hoje o mesmo SQ em dois anos, e os 15.811 casos tinham título diferente, salvo os 8.
- 5 prefeitos e vereadores atuais eleitos em 2012 mantêm 2012 e o mandato de 2013: Jô (Santa Cruz do Xingu/MT), Béa (Triunfo/PE), Vanderlei (Coqueiral/MG), Oziel (Iraquara/BA) e Claudio Rodrigues (São Miguel do Iguaçu/PR).
- Os 2.848 mandatos removidos incluem 3 de quem tem crachá: Alcir Costa (prefeito 2013–2016), Professor Wander (vice-prefeito) e Nei (vereador de Salesópolis).

## Regressão

- `pytest` do ETL: 78 de 78.
- `civico-etl check`: 32 de 32 ok, nas 2 rodadas.
- e2e completo contra o 3101: 177 passed, 5 flaky (todos passaram no retry; o único erro registrado é `net::ERR_EMPTY_RESPONSE` do dev server em /cargos), 1 skipped e 0 failed, em 10,7 min (`--output test-results-reverify2`). FX-024, FX-030 e FX-031 estão verdes.

## O que não conferi e por quê

- Ano corrente de 2026 da cota contra a página: o total muda todo mês. Também não conferi a missão oficial de 2026 (5 linhas).
- A regra exata que a página da Câmara usa para as linhas de glosa (BUG-034). Com 3 casos, não deu para deduzir.
- A causa dos 1.002 sem 2012 (BUG-036). O backup anterior ao `fix032` não foi restaurado.
- Os vínculos `name_birth_place` de Átila Lira (74459) e João Carlos Bacelar (74131), mesma classe do BUG-033.
- Vice-governadores de BA, CE, MS, PI e TO: só há resultado eleitoral ou imprensa de 2026, sem ato oficial de exercício. Nada indica saída.
