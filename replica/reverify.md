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
