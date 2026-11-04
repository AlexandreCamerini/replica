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

# Reverificação 3: BUG-033 a BUG-037 e a reconstrução das pessoas separadas (D221–D234), 2026-11-03

Branch `claude/replica-skill-diff-3e9942` em cf1dcde. O verificador não escreveu as correções (d328278, d6780ec, 9a2192c, 9b0c90b e cf1dcde).

Ambiente:
- Banco `civico` local. A única escrita foi `derive.stats`, 2 vezes.
- Dev server em 3101.
- Fontes:
  - API da Câmara (`/deputados/{id}`) e página `camara.leg.br/deputados/{id}?ano=`, lidas por curl em 03/11.
  - Do cache do ETL (`etl/.cache`): `deputados.csv`, `votacoesVotos`, `eventosPresencaDeputados` e `Ano-AAAA.csv.zip` da Câmara, e `consulta_cand` 2012–2026 do TSE.
- Base de comparação: as tabelas do pg_dump `.local/backup-pre-bug033-036_20261103_195050.dump`, lidas com `pg_restore -f` (sem restaurar). O dump é de 19:50, logo depois da Reverificação 2, que não registrou totais globais.

Nenhum código e nenhum dado foram corrigidos.

## Veredito: não entregável

Há 1 S2 novo (BUG-038) e 2 S3 (BUG-039 e BUG-040). Nenhum S1.

| # | Sev. | Resumo |
|---|---|---|
| BUG-038 | S2 | Fusão por nome civil + nascimento no TSE. 7 pessoas têm o título de quem concorreu na mesma eleição em outro município, e 4 mostram a candidatura do outro (repolhinho, joaozao, malufao, claudia-do-severino). Mais 4 prováveis. |
| BUG-039 | S3 | Divino/PA ficou com o registro INAPTO de 2012 e perdeu a candidatura eleita e o mandato 2013–2016. O "0 de 13.652" do BUG-036 é, na verdade, 1. |
| BUG-040 | S3 | e2e vermelho: FX-024 e B034-3 não acompanharam o D228 (Serafim criado). |

## Bug × veredito

| Bug | Veredito | Evidência |
|---|---|---|
| BUG-033 | confirmado | 6 ids contra a API: nome civil, nascimento e foto certos nos 5 crachás. Cota de 1 ano cada contra a página: 4 iguais (Geninho, +0,03); Eli 2019 difere só pela 55ª. Os 731 ids com cota estão cada um numa pessoa só. 6.939 votos e 2.882 presenças conferidos pelo id no arquivo, sem nenhum de outro id. A classe de fusão continua aberta no TSE: BUG-038. |
| BUG-034 | confirmado | 5 deputado-ano novos com glosa (Bia Kicis 2019, Orlando Silva 2019, Amaro Neto 2022, Hélio Leite 2023 e Murillo Gouvea 2024): meses da página = arquivo + regra. A regra não é ajuste de curva: a assinatura é exata e rara (12 linhas). Ressalva: a exceção do rateio tem n=1. |
| BUG-035 | confirmado | As 7 restaurações e o Mané batem com o CSV pelo título. A auditoria das 91 duplas foi reproduzida: 13 / 166 / 3 / 0. |
| BUG-036 | parcial | 10 de 10 na amostra. Recarga sem duplicata. Falta Divino (BUG-039). |
| BUG-037 | parcial (não é do clone) | 6 de 7 eram a tabela "Verba de gabinete" lida como cota. O único real, Isnaldo 03/2023, tem a assinatura 2 × (doc − líquido) sem glosa no arquivo. |

## BUG-033: os 5 crachás

| Crachá | Id | Nome civil e nascimento (API = banco) | Mandatos | Cota: página × banco |
|---|---|---|---|---|
| geninho-sp | 204527 | Eugenio José Zuliani, 13/01/1976 | prefeito 2013, dep. fed. 2019–2023, prefeito 2025 | 2022: 425.427,63 × 425.427,60 |
| eli-correa-filho | 160532 | Adriano Eli Corrêa, 13/01/1976 | dep. fed. 2015–2019 e 2019–2023 | 2019: 424.744,93 (só a 56ª) × 447.053,33. A diferença de 22.308,40 é janeiro da 55ª, com a complementação. |
| atila | 123086 | Átila de Melo Lira, 01/04/1980 | dep. fed. 2023–2027 | 2024: 580.149,83 = |
| atila-lira | 74459 | Átila Freitas Lira, 07/04/1947 | dep. fed. 2015–2019 e 2019–2023 | 2020: 309.626,32 = |
| joao-carlos-bacelar | 141458 | João Carlos Paolilo Bacelar Filho, 08/10/1972 | 2015 a 2027, e eleito para 2027 | 2020: 451.998,34 = |

- Votos de cada crachá × `votacoesVotos` pelo id: 0 fora do id. O banco tem menos votos que o arquivo porque não carrega votação de comissão: as que faltam têm de 36 a 55 votantes.
- Presença × `eventosPresencaDeputados`: todo "presente" está no arquivo, e nenhum "ausente" está. São 498 registros do Eli e 532 do Átila pai, como no D227.
- Os vínculos de 2014/2018 do TSE para Eli e Átila pai batem pelo título.

### Outras fusões, por critério fraco

- Câmara, todos os 752 vínculos contra `deputados.csv`: nenhum nome civil sem token em comum. Há 2 nascimentos divergentes (zezinho-barbary, 1964 × 1966, e andreia-siqueira, 1991 × 1992). Os dois são vínculos `exact_id`, e o TSE traz as duas datas para a mesma pessoa: é erro de cadastro, não fusão.
- TSE, pessoas com 2 ou mais nascimentos nas linhas ligadas: 1.319. Todas, salvo ze-galinha, têm o mesmo título, então são erro de digitação no TSE, e não fusão.
- TSE, pessoas com 2 ou mais títulos: 31. Em 7, os dois títulos concorrem na mesma eleição em municípios diferentes (fusão provada). 4 são prováveis. Os outros são a mesma pessoa, com título reemitido no mesmo município. Detalhes no BUG-038.
- Não auditei os 216 vínculos `name_birth_place` da ALESP nem os 24 da ALEMG (`assembleias.py`, nome de urna + partido, aniversário ou mandato, só entre quem tem mandato na UF). O fix033 também não os cobriu.

### `camara_diario.link_past_roster`

- Hoje há 104 vínculos da Câmara de ex-deputados (`idLegislaturaFinal` < 57): 91 `name_birth` e 11 `exact_id` de 02/11, e mais 2 `exact_id` de 03/11 (Eli e Átila pai, pelo `devolver`).
- O ramo por nome de urna grava `name_birth_place`, e não resta nenhum vínculo da Câmara com esse método: os 3 que havia eram as fusões do BUG-033, já separadas. O único log achado da rodada (02/11 23:37) diz "64 por nome civil + nascimento, 0 por nome de urna". O caminho por nome de urna continua no código e sem a trava do id único.
- Amostra de 10 dos 91 `name_birth`, com semente 33, contra a API (geninho-sp, magno-malta, rafafa, beto-faro, margarida-salomao, paula-belmonte, lucas-follador, haroldo-cathedral, wladimir-garotinho e laercio): nome civil e nascimento iguais em 10 de 10.

## BUG-034: glosa

| Deputado-ano | Linha com glosa | Página | Banco | Meses |
|---|---|---|---|---|
| Bia Kicis 2019 | 10/2019 rateio 993,90/72/849,90 (exceção) | 192.000,95 (sem dezembro) | 216.041,23 | fev–nov iguais. Dezembro (24.040,28) não aparece na página, como no Pastor Eurico. |
| Orlando Silva 2019 | 2/2019 8920/1035,20/8841,80 (outro padrão, fica como está) | 396.242,21 (56ª) | 426.989,42 (ano) | os 11 da 56ª iguais |
| Amaro Neto 2022 | 10/2022 30000/11998/11179,70 (outro padrão) | 448.341,54 | 448.341,55 | todos iguais |
| Hélio Leite 2023 | 12/2023 8500/3116,66/1842,66 (outro padrão) | 241.334,58 (57ª) | 284.479,15 (ano) | os 11 da 57ª iguais |
| Murillo Gouvea 2024 | 12/2024 16000/12287/2382,08 (outro padrão) | 493.442,93 | 493.442,92 | todos iguais |
| Liziane Bayer 2019 (fora do diretório) | 06/2019 d−2g 3266,67/1353,67/559,33 | 353.625,64 (sem dezembro) | — | jan–nov = arquivo + regra |

A regra se sustenta:
- A assinatura `líquido = documento − 2·glosa` é uma igualdade exata.
- Ela aparece em 12 das ~86 mil linhas com glosa de 2019–2026, e 11 batem com a página. A 12ª é o rateio.
- As linhas com glosa e outro padrão (~400/ano) não são tocadas, e a página concorda com elas nas 3 conferidas.

O que é ajuste:
- A exceção do rateio (n=1).
- O mecanismo da página é mais largo que a regra. Ela também soma 2 × um valor que não está em `vlrGlosa`: Isnaldo 03/2023 (2 × 9.257,00) e Félix 07/2024 (2 × 1.522,00). Nesses casos a regra não tem como agir.

Totais contra o backup: só 7 deputado-ano mudaram, cada um em exatamente 2 × glosa:

| Deputado | Diferença (R$) |
|---|---|
| Da Vitoria | +931,18 |
| Eduardo Bolsonaro | +7.668,00 |
| Eduardo da Fonte | +26.774,00 |
| Trzeciak | +2.431,62 |
| André Ferreira | +84,00 |
| Félix | +3.044,00 |
| Lafayette | +1.056,98 |

## BUG-035 e BUG-036: 2012

- Amostra de 10 entre os 13.652, com semente 20261103: 10 de 10 batem com o CSV em nome de urna, resultado, número, cargo, município e mandato de 2013. Lista no bugs.md.
- Divino: ver BUG-039.
- Duplicatas: 0 pessoas com duas candidaturas na mesma disputa em 2012.
- Duplicatas de outros anos, anteriores a esta correção e só observadas: 20 pessoas têm duas candidaturas na mesma suplementar de 2016–2024, uma delas com resultado vazio (dr-elio-da-mata, claudemir-borges, sabrina-do-bel e outras). Parece que o banco junta numa só eleição "suplementar" do ano duas suplementares distintas. Não abri bug.
- Também não há mandato em dobro por candidatura antes de 2017.

## BUG-037

Recorte certo da página (cota até "Verba de gabinete"):

| Caso | Cota na página | Arquivo | Verba de gabinete (o número do bug) |
|---|---|---|---|
| Santini 01/2021 | 30.620,57 | 30.620,57 | 86.467,45 |
| Marcelo Brum 03/2022 | 42.196,88 | 42.196,88 | 107.946,34 |
| Bia Cavassa 03/2022 | 35.719,58 | 35.719,58 | 105.904,67 |
| Pedro Dalua 03/2022 | 53.449,11 | 53.449,11 | 111.628,21 |
| Jhonatan de Jesus 02/2023 | 81.743,13 | 81.743,13 | 118.115,79 |
| Prof. Paulo Fernando 01/2024 | 3.671,33 | 3.671,33 | 11.060,25 |
| Isnaldo Bulhões Jr. 03/2023 | 44.926,63 | 26.412,63 | 117.714,21 |

Só o de Isnaldo é real: +18.514,00 = 2 × (10.985 − 1.728), na locação 10985/0/1728, sem glosa no arquivo, e a API não traz o mês. É divergência da fonte e da página, não do clone.

## Regressão

- `pytest` do ETL: 97 de 97.
- `civico-etl check`: 36 de 36 ok, nas 2 rodadas, cada uma depois de um `derive.stats` (20–24 s cada).
- `party_memberships`: md5 do conteúdo (pessoa, partido, de, até) 8856a6b4b17017127d72f7e40ecc91e9 nas 2 rodadas, com 139.143 linhas. Contra o backup (138.734), há +410 em pessoas que ganharam candidatura e −1 noutra.
- e2e completo contra o 3101, em 5,9 min (`--output test-results-reverify3`): 182 passed, 2 failed, 1 flaky (SH-H1, que passou no retry) e 1 skipped. As 2 falhas são o BUG-040.

### Números globais, backup × agora

| Medida | Backup 19:50 | Agora | Δ | Explicação |
|---|---|---|---|---|
| Pessoas | 71.599 | 71.602 | +3 | eli-correa-filho, atila-lira, serafim-correa |
| Mandatos em exercício | 70.833 | 70.834 | +1 | Serafim, vice-governador do AM |
| Mandatos encerrados | 70.018 | 71.051 | +1.033 | 1.027 de 2013 (recarga de 2012 e restaurações), 1 de 2014 (Professor Wander), 3 de 2015 (2 de Eli e Átila pai, e Alcir Costa), 2 de 2019 (Eli e Átila pai) |
| Candidaturas | 181.984 | 183.028 | +1.044 | 2012: +1.040; 2014 e 2018: +2 cada (Eli e Átila pai). Nenhuma removida; 1 movida (Mané) |
| Expenses por ano, linhas | iguais nos 8 anos | | 0 | 1.944 linhas mudaram de pessoa (atila → atila-lira 1.025, geninho-sp → eli-correa-filho 919) |
| Expenses por ano, valor | | | | 2019 +931,18; 2020 +7.668,00; 2021 +26.774,00; 2022 +2.515,62; 2024 +3.044,00; 2025 +1.056,98; 2023 e 2026: 0. É a regra do D230, linha a linha. |

## O que não conferi e por quê

- Autorias de Eli e Átila pai (174 + 321) contra `proposicoesAutores`. Votos e presença foram conferidos.
- Os vínculos `name_birth_place` da ALESP (216) e da ALEMG (24). É a mesma família de critério fraco, mas restrita à bancada da UF.
- A regra do D230 em 2026: o ano corrente muda todo mês.
- Se a página da Câmara corrige de fato o Isnaldo 03/2023: a consulta `cota-parlamentar/sumarizado` não foi aberta.
- O pai do Bacelar (74131) segue sem crachá, pela D34. Não conferi se alguma página do clone ainda o cita.

# Reverificação 4: BUG-038, BUG-039, BUG-040 e D235–D239, 2026-11-03

- Escopo: commits 6ab7fa8, 9656d8b e 3da7ef4, contra o build 3da7ef4 servido no 3101 e o Postgres local.
- Fontes:
  - `consulta_cand` 2012–2026 e `bem_candidato` do cache do ETL. Os 8 arquivos BRASIL viraram um índice SQLite de 2.110.710 linhas, só para leitura.
  - Resultados oficiais de 2024 em `resultados.tse.jus.br`.
  - Página do deputado na Câmara (`camara.leg.br/deputados/{id}?ano=2025`).
  - CEAPS do Senado (`adm.senado.gov.br`, cache do ETL).

Nenhum código e nenhum dado foram corrigidos. Rodei `derive.stats` 2 vezes, e ele é idempotente.

## Veredito: não entregável

Há 1 S2 aberto (BUG-041). Não achei S1.

| # | Sev. | Resumo |
|---|---|---|
| BUG-041 | S2 | willya-do-rampa (vereador em exercício) mostra a candidatura de 2012 e o PTB de 2012–2020 de Virginia Pereira de Oliveira. O TSE repetiu o título e o `resolve` casa pelo título antes de olhar nome e nascimento. |
| BUG-042 | S3 | Título reemitido no mesmo município com uma letra diferente no nome: o mandato eleito some sem passar pela fila (Eloisa Cardoso 2016, Nelson Gasperin 2012). |
| BUG-043 | S3 | 16 disputas com o registro INAPTO/#NULO# no lugar do APTO da mesma pessoa. Nenhum eleito perdido. |

## Bug × veredito

| Bug | Veredito | Evidência |
|---|---|---|
| BUG-038 | confirmado | 18 crachás × CSV: 35 candidaturas certas em nome, nascimento, título, município, cargo, partido e resultado. Os pares separados são pessoas diferentes pela fonte (mesma eleição, ou UF de nascimento diferente). Nenhuma separação errada. A mesma família segue aberta pelo título repetido: BUG-041. |
| BUG-039 | parcial | Divino certo. Na amostra de 5, 4 certas e 1 suplementar duplicada (já conhecida). Na varredura de 151 disputas, 16 ficaram com o registro inferior: BUG-043. |
| BUG-040 | confirmado | FX-024 e B034-3 passam nas 2 rodadas completas. O B034-3 ficou fraco: `getByText(/Vice-governador/)` genérico, sem a data de posse. |

## BUG-038

### Os 11 casos

| Dono (slug mantido) | Título do dono | Criado / removido | Fonte do criado |
|---|---|---|---|
| repolhinho | 009924220418 (Rio Grande/RS 2012–2024) | antonios-coiffeur, 000597921198 | MA 2012 São Luís (vereador, suplente), dep. est. MA 2014/2018. Nascido no PI |
| joaozao | 021510272704 (Bernardo Sayão/TO 2012–2024) | joao-batista-corretor, 020994100698 | Mauá da Serra/PR 2016 e 2020, suplente. A linha de 2016 diz 1956 e a de 2020 diz 1958 |
| malufao | 165845370167 (Gabriel Monteiro/SP 2016, 2024) | nego-bia, 040578540523 | Pojuca/BA 2012, 2016, 2020, suplente. 2012 não é carregado |
| claudia-do-severino | 102234550281 (Paineiras/MG 2024) | claudia-da-lagoa-nova, 072163270558 | Brejolândia/BA 2020 (INAPTO, não eleita) e 2024 |
| cida-da-saude-rn | 228178420183 | título 198317130116 removido | Jandira/SP 2020 e 2024 |
| luciano-dias | 023580461414 | título 133460340272 removido | São José da Varginha/MG 2024 (LUCIANO DIAS, sem o "da Silva Neto") |
| paulinho-do-rodolfo | 086808580230 | título 118317660213 removido | Carangola/MG 2024 |
| gordo | 052328560620 (nasc. PR) | moca-mg, 124118810205 | Bom Jardim de Minas/MG 2016 (nasc. MG) |
| joao-preto | 020752921309 (nasc. PR) | joao-do-marajoara, 078272520310 | Japeri/RJ 2020 (nasc. ES) |
| gato-da-corrida | 023409750248 | título 003788960124 removido | Itu/SP 2012 "Roberto Oluran". Mesmo nome e nascimento, a 250 km. Não há prova de que seja outra pessoa, mas também não havia fato no crachá. Sem efeito na tela |
| ze-galinha | 029985402747 e 037087402712 | piqueno-to, sem título | Araguacema/TO 2016: Manoel Juvenil Pereira de Sousa, 30/11/1983, com o título 037087402712 que o TSE também põe em Zé Galinha 2020 |

### Varredura de fusões que sobraram

Liguei cada candidatura do banco à linha da fonte por ano, SQ, tipo de eleição e município. Ficaram 442 sem par, por grafia de município (Camacan × Camacã, Espigão D'Oeste × do Oeste). O primeiro cruzamento, só por ano e SQ, dava 6 falsos positivos. Em 2012, o SQ de uma suplementar repete o de uma ordinária (alcir-costa × "Junior do Bacabal").

| Critério | Pessoas | Resultado |
|---|---|---|
| Candidaturas em UFs diferentes | 62 | Mesmo título em todas as linhas: mudança de domicílio |
| Títulos diferentes | 20 | Mesmo município, nome e nascimento: reemissão |
| Nascimento divergente | 1.313 | Mesmo título. Erros de digitação do TSE (dia, mês ou ano trocados) |
| Nome civil divergente | 2.906 | Mesmo título. Grafia, nome social e casamento |
| Nome sem nenhum token em comum | 5 | 4 são nome social ou grafia. 1 é fusão: willya-do-rampa (BUG-041) |
| Homônimos no banco | 7 pares | Só os do D236 |

### Regra nova (D235)

- Simulação do `resolve` sem gravar, contra o banco:
  - Eloisa 2016 e Nelson Gasperin 2012 (reemissão no mesmo município), com a grafia do banco: `queued`, como prometido.
  - As mesmas, com a grafia da fonte: `new`, e a linha é descartada (BUG-042).
  - Virginia 2012 (título repetido): `exact_id` na pessoa errada (BUG-041).
- Mandatos atuais: em 2022–2026, todo ELEITO da fonte está no banco, fora os 162 suplentes de senador (54 de 2022 e 108 de 2026). A regra não barrou nenhum mandato em curso.
- Caso real de pessoa legítima separada pela regra "título diferente sem lugar em comum": não achei. Os 26 grupos da fonte com mesmo nome e nascimento, títulos diferentes e nenhuma eleição em comum se dividem assim:
  - reemissão no mesmo município: ainda juntos;
  - pares do D236, com UF de nascimento diferente;
  - os 3 do BUG-042, que faltam mas não foram separados.

## BUG-039

- Divino: confere com o CSV (140000021364, APTO, ELEITO POR QP, nº 13233, mandato 2013–2016, bens de R$ 148.500,00).
- Varredura (título, disputa e número com mais de um SQ, ao menos um no banco), 151 disputas:
  - 116 com o maior posto;
  - 19 suplementares com os 2 registros (conhecidas);
  - 16 com o registro inferior (BUG-043).

## Varredura S1/S2 na tela

15 crachás, sorteados com `setseed(0.20261103)` entre mandatos em exercício:
- 3 deputados estaduais: alexandre-curi, veter-martins e prof-josemar;
- 3 deputados federais: yandra-de-andre, carlos-sampaio e covatti-filho;
- 1 governador: eduardo-riedel;
- 3 prefeitos: vidal-sc, silvinho-vaz e netto-donato;
- 2 senadores: paulo-paim e daniella-ribeiro;
- 3 vereadores: zelau, zoi-da-borracharia e emilio-da-ambulancia.

| Bloco | Conferido | Resultado |
|---|---|---|
| Mandato (cargo, lugar e período) | 15 × TSE e casa | 15 ok |
| "Eleito N vezes" | 15 × ELEITO da fonte pelo título | 15 ok |
| Candidaturas (cargo, UE, resultado) | 54 linhas × `consulta_cand` | 54 ok, exceto veter-martins 2014 (BUG-043). Partido: 6 linhas mostram a sigla atual da legenda (MDB × PMDB, PODE × PTN, SOLIDARIEDADE × SD, MOBILIZA × PMN), pelo alias, não a da época |
| Patrimônio declarado | 15 × `bem_candidato` | 15 ok, ao real |
| Votos | 6 prefeitos e vereadores de 2024 × `resultados.tse.jus.br` | 6 ok (2.656, 2.554, 68.178, 323, 659, 375) |
| Cota da Câmara | 3 deputado-ano 2025 × página da Câmara | 520.409,83, 567.816,43 e 567.656,08: 3 ok |
| Cota do Senado (CEAPS) | Paim e Daniella, 2024 e 2025 | 4 ok |

Home: 70.834 em exercício, igual ao banco. A soma dos cargos fecha: 596 em Brasília, 1.058 nos estados e 69.180 nas cidades.

/representantes de Porto Alegre (S), Recife (NE) e Manaus (N): os vereadores eleitos (35, 37 e 41) e o prefeito e o vice batem com o TSE 2024. Recife mostra Victor Marques prefeito e Manaus mostra Renato Junior, os 2 sem vice. Senadores: 3 em cada UF.

Duas observações, sem bug aberto:
- 4 senadores aparecem com o nome em caixa alta (LUIS CARLOS HEINZE, HUMBERTO COSTA, EDUARDO BRAGA e PLÍNIO VALÉRIO).
- Eduardo Leite aparece com PSDB, a última observação que o site tem (TSE 2022). O site não lê nenhuma fonte de filiação do governador (D32).

## Regressão

- `pytest` do ETL: 103 de 103.
- `derive.stats` + `check`, 2 rodadas: 38 de 38 ok nas 2. `party_memberships` tem 139.146 linhas e o mesmo md5 (pessoa, partido, de, até) nas 2 rodadas: 885862e019338c74d51184f472c03152.
- Totais contra o "Depois" do D239, todos iguais:
  - pessoas 71.609;
  - candidaturas 183.034;
  - mandatos em exercício 70.834 e encerrados 71.054;
  - bens 149.221;
  - `person_external_ids` 255.288;
  - fila 6.
- e2e completo contra o 3101:
  - 1ª rodada (`--output test-results-reverify4`), com o servidor dividindo carga com as minhas leituras de crachá: 157 passed, 5 failed, 24 flaky, em 29,5 min. Os erros foram timeout de 60 s, ERR_EMPTY_RESPONSE e "Request context disposed". Os 5 que falharam (F04-E5, S22-H2, W3A-H1, W3A-H2 e F01-E6) passaram isolados, 9 de 9.
  - 2ª rodada (`test-results-reverify4c`), com o servidor ocioso: 181 passed, 1 failed, 3 flaky e 1 skipped, em 13,4 min. A falha é SH-E2, timeout no `page.goto`: passou nas 3 repetições isoladas, só no retry. A suíte está mais lenta que na Reverificação 3 (5,9 min). Não é defeito de dado, mas a instabilidade cresceu.
- Paridade (`parity.py`): 86,8. Must 17 de 17.

## O que não conferi e por quê

- Votos de 2014–2022 e 2026: a fonte (`votacao_candidato_munzona`, cerca de 550 MB por ano) não está em cache. Conferi os 6 de 2024 pelos resultados oficiais.
- Arrecadação de campanha e salário: a prestação de contas não está em cache.
- Presença e propostas dos 3 deputados federais: a Reverificação 3 já conferiu presença pelo arquivo.
- Se "Roberto Oluran" (Itu 2012) é o Gato da Corrida: mesmo nome e nascimento, título de outra UF. O vínculo saiu e não havia fato na tela.
- As 2.906 divergências de nome civil uma a uma. Filtrei por tokens em comum (0 ou 1) e por nascimento.
- Os vice-governadores que aparecem como vagos (11 UFs) e os prefeitos em exercício de Recife e Manaus contra os atos de posse.

# Reverificação 5: BUG-041, BUG-042, BUG-043 e D240–D244, 2026-11-03

- Escopo: commits f49f969 e 616ec23, contra o Postgres local e o 3101 (`next dev`).
- Fontes: `consulta_cand` 2012–2026 (índice SQLite de 2.110.710 linhas) e `bem_candidato` do cache do ETL.

Nenhum código e nenhum dado foram corrigidos. Rodei `derive.stats` 2 vezes. A única escrita foi uma transação desfeita, para provar que o check do D240 dispara.

## Veredito: entregável

Não há S1 nem S2 aberto. Must 17 de 17 e paridade 86,8. Abri 2 S3:

| # | Sev. | Resumo |
|---|---|---|
| BUG-044 | S3 | O "E" do D240 deixa casar pelo título a linha de outra pessoa que tem 1 token em comum: Genilde × Renata Emily "Silva" (Cruzeiro do Sul/AC), Maria Isabel × Silvana Maria (Paty do Alferes 2012, mesma eleição), Djalmiro × Sarah Urbieta, Daora × Kotsario Kanamari. É latente: nenhuma dessas pessoas está no diretório e há 0 fusões no banco. |
| BUG-045 | S3 | `pg.ts` converte resultado nulo em "nao_eleito". As 513 candidaturas #NULO (491 em crachás de quem está em exercício) aparecem como "Não eleito". |

## Bug × veredito

| Bug | Veredito | Evidência |
|---|---|---|
| BUG-041 | confirmado | willya-do-rampa só com 2020/2024 PDT e o título, sem PTB. virginia-go com a 90000003345 (PTB 14222, renúncia, 26/08/1993). O check dá 0 e volta a 1 na transação desfeita. Das 1.680 linhas de nascimento divergente, só 2 são duas pessoas, e as 2 já foram separadas. Regra fraca para o futuro: BUG-044. |
| BUG-042 | confirmado | Eloisa 2016 (130000040058, PSDB 45666, ELEITO POR QP, R$ 83.500,00) e Nelson 2012 (240000003602, PP 11, ELEITO, R$ 1.694.000,00) batem com o CSV, com mandato e crachá. 5 de 13 itens novos da fila conferidos. A regra fonética não tem falso positivo achado e tem falsos negativos que só vão para a fila. |
| BUG-043 | confirmado | 6 de 16 trocas batem com o CSV (Ruty, Giovani, Cido, Terezinha, Gil e Veter) em número, situação, partido e bens. Removidos em `identity_repair_log`, sem mandato. |
| D244 / B034-3 | confirmado | Verde na suíte. |

## BUG-041: amostra dos nascimentos divergentes

Classifiquei as 1.680 linhas da fonte (título do diretório, nascimento diferente do da pessoa, 1.387 pessoas), todas, não por amostra:

| Nome da linha × pessoa | Linhas | Leitura |
|---|---|---|
| Nome civil igual | 1.577 | Digitação de data: dia 615, mês 394, ano 406, dia e mês trocados 22, outros 140 |
| Nome parecido (Jaccard ≥ 0,5) | 98 | Grafia (Edvan × Edivan, Valdecy × Valdecir), mesma pessoa |
| Nome fraco (0 a 1 token) | 5 | Willya × Virginia e José Carlos × Manoel Juvenil (2 pessoas, 0 token), e Edemar × Edmar, Paparico, Teresinha (mesma pessoa, 1 token) |

Taxa de duas pessoas: 2 em 1.680 (0,12%), as 2 sem token em comum e já separadas. No banco, o "E" não deixou passar nada. Na fonte inteira (12.398 títulos com mais de um nascimento), há pares de duas pessoas com 1 token em comum que o "E" casaria (BUG-044). Isso não acontece hoje, porque nenhuma delas está no diretório. Uma regra pelo primeiro nome (até 2 edições) rejeitaria esses pares. Nas 1.680 linhas, ela rejeita só as 2 fusões e dr-auri (hífen).

## BUG-042: regra fonética

- Falso positivo: nenhum achado. Na fonte, os 6 pares com mesmo município e nascimento, títulos diferentes e fonética igual parecem a mesma pessoa e nunca concorrem juntos: Vilson × Wilson Luiz Martins, Souza × Sousa Rezende, Geise × Geize Leppaus, Ferrreira × Ferreira, Elizabeth × Elisabeth e Cesar × Cezar Felicio. O risco teórico são gêmeos com nomes que só diferem em h, y/i ou letra dobrada (Tais × Thais, Ana × Hana dão a mesma forma).
- Falso negativo, real: Nei Cristiano Correa × Correia da Silva (UE 04634, 01/10/1976), Maria de Lourdes × Lurdes Dias (92150) e Erika Keinilia × Keinilla (04286). Teórico: Christiane × Cristiane ("ch" fica) e Felipe × Filipe. O custo é a fila, não a fusão.
- A cautela se justifica: dos 54 pares a até 2 edições com fonética diferente, 23 concorrem na mesma eleição (gêmeos: Diogo × Diego, Mayana × Mayara, Liliana × Liliane).
- Fila (19), 5 dos 13 novos conferidos na fonte: Evaldo × evandro-dd (provável mesma pessoa, fila justa), Carlinho de Chalé 1963 × carlin-maroba 1977, Fofão 1971 × carlos-da-saude-pe 1979, Zequinha 1960 × bepino 1955 (homônimos) e Caçula Muniz 2016 ('-4', sem nascimento) × cacula-muniz.
- Os 2 títulos anexados por reemissão ficaram com `match_method` 'exact_id' e confiança 1,000, e não 0,9. Sem efeito na tela.

## Regressão

- `pytest` do ETL: 111 de 111.
- `derive.stats` + `check`, 2 rodadas: 40 de 40 ok nas 2. `party_memberships` tem 139.147 linhas, com o mesmo md5 antes e depois das 2 rodadas (9aa016d9…, minha fórmula: pessoa, partido, `from_on` e `to_on`).
- Totais iguais ao "Depois" do D244: pessoas 71.610, candidaturas 183.036, em exercício 70.834. A home bate.
- e2e completo contra o 3101 com o servidor ocioso (`--output test-results-reverify5`): 181 passed, 4 flaky, 1 skipped e 0 failed, em 7,6 min (454 s de relógio). Os 4 flaky passaram no retry: F01-H1, S22-H2, S18-H3 e FX-AX mobile. Um deles é "Hydration failed", do modo dev.

### Desempenho: 5,9 → 13,4 → 7,6 min

Não é regressão:
- O código de dados do web não muda desde cf1dcde, o build da Reverificação 3.
- 5 páginas com o servidor ocioso, em 3 chamadas (TTFB da 1ª → 3ª): `/p/adriana-ventura` 0,76 → 0,30 s, `/representantes?cidade=3509502` 0,69 → 0,40 s, home 0,12 → 0,09 s, `/partidos` 3,96 → 0,52 s (1ª compila a rota) e `/comparar` 0,35 → 0,13 s.
- EXPLAIN ANALYZE, todas abaixo de 13 ms:
  - `HOLDER_SELECT` de Ribeirão Preto com `person_current_party`: 2,2 ms;
  - `listParties`: 13,0 ms, com seq scan paralelo em `mandates`, 70 mil linhas;
  - `getCandidacies`: 0,14 ms;
  - `person_current_party`: 0,01 ms;
  - lacunas de governador: 0,09 ms.
- O web não lê `tse_titulo_candidatura` nem os logs de identidade.

A diferença está no `next dev`. O worker do 3101 tinha sido reiniciado 1 h antes, e a 1ª visita de cada rota compila. Os testes mais lentos desta rodada são os primeiros a tocar cada rota (F01-H1 6,7 → 22,2 s, SHARE-H1 11,6 → 26,3 s), e a soma dos tempos por teste foi de 693 s para 895 s. Os 13,4 min da Reverificação 4 somam essa compilação a timeouts de 60 s com retry (SH-E2). Recomendação, sem bug aberto: medir a suíte contra `next start`, como o próprio `playwright.config.ts` já faz sem `E2E_BASE_URL`.

- Paridade (`parity.py`): 86,8. Must 17 de 17.

## O que não conferi e por quê

- As outras 10 trocas do BUG-043 e os outros 8 itens novos da fila: conferi 6 e 5.
- As 80 linhas não eleitas do BUG-042, que só entram na próxima carga `--all`, e as 2 suplementares ELEITO (Gelson, Davino Serrath), que ficaram só no relatório. Os mandatos encerrados delas seguem fora.
- Votos de Eloisa 2016 e Nelson 2012: `votacao_candidato_munzona` não está em cache.
- Se Evaldo × Evandro "DD" e Paulo Roberto × Paulette Roberta (Palmares, mesmo título) são a mesma pessoa: a fonte não basta.
- A filiação aberta de `virginia-go` (PTB desde 2012, sem fim) segue a regra geral do `derive`. Não avaliei se o crachá a mostra como vigente: a página não exibe partido para quem não tem mandato.
