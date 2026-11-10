# Verificação final independente: 2026-11-03

Branch `claude/replica-skill-diff-3e9942` em 9391293 (83 commits desde 30485e3). O verificador não escreveu o código. Banco `civico` local, só leitura (`default_transaction_read_only=on`). Nenhum código de produto foi alterado.

## Veredito: não entregável

Pelos critérios do replica-diff, "entregável" exige todos os must, feature ≥ 80 e nenhum S1 ou S2 aberto. Os dois primeiros passam: 17 de 17 must e feature 86,8. O terceiro falha por um S1 aberto, o BUG-020.

- BUG-020 (S1): a cota parlamentar de todos os deputados federais está subcontada. O ETL guarda uma linha por `ideDocumento`, e a Câmara publica várias linhas com o mesmo documento: emissão de passagem, estorno e taxa. O crachá da Adriana Ventura mostra R$ 89.595 em 2025, contra R$ 104.680,79 na API e R$ 104.693,75 no site da Câmara. Na carreira, o clone mostra R$ 476.298 e o original, R$ 517.773. O defeito vem da primeira carga (e07184b), não desta noite. Dado errado publicado no crachá recebe a mesma classe do BUG-019.

Os outros defeitos são S3 e S4 (abaixo). A nota de paridade com layout é 75,9, com layout em 32,2; layout não entra no critério de entrega.

## 1. Suíte

| Item | Resultado | Observação |
|---|---|---|
| pytest ETL (`etl/tests`) | 48 passed, 0 failed | 9 arquivos de teste; 1,2 s |
| `civico-etl check` (role postgres; `web_reader` não lê `person_external_ids`) | exit 0, 21 invariantes ok | O check não pega o BUG-020 nem o BUG-024: ver bugs |
| mcp `npm test` | 33 passed, 0 failed | `tsc --noEmit` do mcp ok |
| web `tsc --noEmit` | 0 erros | |
| web `eslint` | `npx eslint src e2e` dá 0 problemas | `npx eslint` sem argumento acusa 1.823 erros, todos em `.next-e2e-w3a/` (BUG-029) |
| e2e contra o dev 3101 | 150 passed, 1 failed, 1 skipped, 0 flaky | Falhou a ONB-H2 nas duas tentativas. Isolada com `--repeat-each 3`, falhou 1 de 3. Já existia ("A conferir", build 6); virou o BUG-027 |
| e2e contra o build de produção 3301 (`.next-verify`, mesmo env da 3101) | 146 passed, 5 failed, 1 skipped | A ONB-H2 passou. As 5 falhas (F05-H1, F05-E2, F05-N1, F08-H1, RESP-H2) são de ambiente: em produção o `AUTH_PROVIDER=dev` é recusado e o formulário exige captcha ("Não deu para confirmar que você não é um robô"). Com `ALLOW_DEV_AUTH=1`, o captcha segue bloqueando. Não é regressão |

O skipped é F03-E2 @mobile, com `test.skip` no próprio spec. Nenhuma falha da suíte é regressão desta noite.

## 2. Dado contra fonte oficial

| # | Tela (clone) | Valor no clone | Fonte primária | Valor na fonte | Bate? |
|---|---|---|---|---|---|
| 1 | /eleicoes?ano=2022&cargo=presidente, 2º turno | Lula 60.345.999; Bolsonaro 58.206.354 | TSE, resultado 2022 (BUG-019 citava `votacao_candidato_munzona_2022_BR`) | 60.345.999 / 58.206.354 | sim |
| 2 | Mesma tela, 1º turno | Lula 57.259.504; Bolsonaro 51.072.345; Soraya 600.955 | TSE | 57.259.504 / 51.072.345 / 600.955 | sim |
| 3 | /p/adriana-ventura: salário por mês | R$ 46.366 | camara.leg.br/deputados/204528: "Salário mensal bruto R$ 46.366,19" | 46.366,19 | sim |
| 4 | /p/adriana-ventura: salário recebido desde 02/2019, 94 meses | R$ 3.669.409 | DL 276/2014 (33.763,00) e DL 172/2022 (39.293,32 / 41.650,92 / 44.008,52 / 46.366,19), mês a mês | 3.669.409,58 | sim; o original mostra o mesmo número |
| 5 | /p/adriana-ventura?ano=2025: cota | R$ 89.595 | API Câmara `despesas?idLegislatura=57&ano=2025`; página oficial | 104.680,79 / 104.693,75 | não (−14,4%, BUG-020) |
| 6 | Baleia Rossi 2025: cota (banco) | 343.601,05 | API Câmara | 377.188,69 | não (−8,9%, BUG-020) |
| 7 | /p/adriana-ventura?ano=2025: presença | 108 de 120 sessões (90%) | camara.leg.br, ano 2025 | 110 dias presentes, 11 ausências justificadas | não exato: unidade diferente, sessão contra dia (BUG-028) |
| 8 | /impostos?ano=2024: arrecadação federal | R$ 2.651,3 bi (jan R$ 280,6 bi; dez R$ 261,3 bi) | Receita Federal, resultado de 2024 | R$ 2.652,7 bi | sim, com diferença de 0,05% (soma por UF contra total nacional) |
| 9 | /governos: PIB 2022 | 3,0% | SIDRA 6784, v9810 | 3,0 (2021 4,8; 2023 3,2 também batem) | sim |
| 10 | /governos: IPCA 2022, 2023, 2024 | 5,79 / 4,62 / 4,83 | SIDRA 1737 | 5,79 / 4,62 / 4,83 | sim |
| 11 | /governos: Selic em 31/12/2022 | 13,75 | BCB SGS 432 | 13,75 | sim |
| 12 | /governos: desemprego 2024 e 2023 | 6,85 / 7,98 | IBGE, taxa média anual (Agência IBGE 42530/42531) | 6,6 / 7,8 | não (BUG-023); a média simples dos trimestres da SIDRA 4099 dá os números do clone |
| 13 | Votações secretas do Senado em 2025 (banco `voting_events.is_secret`, usado no crachá) | 72 secretas, 56 abertas | `legis.senado.leg.br/dadosabertos/votacao` 2025 | 72 S / 56 N (128) | sim |
| 14 | /partidos: cadeiras na Câmara | 20 partidos batem um a um; total 512; MISSÃO ausente | API Câmara `/deputados` | 513, MISSÃO 1 (Kim Kataguiri) | não (BUG-021) |
| 15 | /partidos: cadeiras no Senado | PT 10, PSD 13, PL 16 | Senado `senador/lista/atual` | PT 9, PSD 14, PL 15, S/Partido 1 | não (BUG-022) |
| 16 | /eleicoes?ano=2022: governadores eleitos no 1º turno / 2º turno | 15 / 12 | TSE 2022 | 15 / 12 | sim |

Resumo: 11 conferências batem, 1 tem diferença de unidade e 4 não batem. As 4 que não batem são cota, desemprego e cadeiras na Câmara e no Senado.

## 3. Regras de produto

A varredura cobriu 18 páginas: /, 6 crachás (deputada federal, senador, ALMG, vereador SAPL de Fortaleza, vereador, Kim), /comparar, /congresso e a aba agenda, /eleicoes (2022 presidente e 2024 prefeito), /governos, /impostos (2026 e 2024), /partidos, /sobre e /representantes?cidade=3509502. Cada uma rodou em 1440 e 390, claro e escuro: 72 cargas, contra o build de produção 3301.

| Regra | Resultado |
|---|---|
| Sem rolagem horizontal em 390 | ok nas 36 cargas (`scrollWidth` = 390) |
| axe WCAG 2.1 AA | 0 violações nas 54 cargas checadas (claro 1440, claro 390 e escuro 390; escuro 1440 só mediu largura) |
| Erros de console e `pageerror` | 0 |
| 0 onde deveria ser "—" | Nenhum caso indevido. Os zeros achados são legítimos: "0%" de categoria pequena de campanha, "0 como coautor", "0 eleitos" no 1º turno presidencial, "0 cadeiras" de partido sem bancada e o número de emenda "EMR 1/0" como a Câmara publica. Ano em andamento, Selic antes de 1999 e mês não publicado aparecem como "—" com motivo |
| Fonte e data em todo bloco | Falha em dois lugares (BUG-026). /comparar mostra presença, votos e cota da Câmara, mas só cita "TSE". O bloco "Números" do crachá não tem rodapé de fonte e data, e o salário acumulado não cita o decreto. Também falha o nível "Governo do estado" ausente em Manaus, sem "—" (BUG-024). Nas páginas novas (/impostos, /governos, /eleicoes, /partidos), um rodapé de fonte e data cobre a página inteira; aceitável |
| Neutralidade em /partidos | Ordem alfabética, 2 estilos de célula (sem cor por partido), sem nota e sem ranking. "esquerda/direita/espectro" só aparecem na frase "não classificamos em esquerda ou direita" e na nota de método. Ressalva sem bug aberto: a coluna "% votou com o governo" por partido é, na prática, um índice de governismo. Está bem rotulada e sem ordenação, mas é o dado mais perto de "nota" no site |

## 4. Layout

Capturas no mesmo estado: viewport fixo, onboarding fechado no X do original e pelo cookie `onb` no clone, tema claro. Arquivos: `replica/screens/final-*.png` (original) e `replica/clone-screens/final-*.png` (clone). Diffs em `replica/diffs/final-*.json`. No original não houve clique em formulário nem aceite de cookie.

| Tela | 1440×900 | 390×844 |
|---|---|---|
| home | 28,9 | 36,8 |
| /p/adriana-ventura | 28,6 | 28,6 |
| /representantes?cidade=3509502 | 30,9 | 37,2 |
| /comparar?p=adriana-ventura,baleia-rossi | 30,2 | 28,0 |
| /congresso | 34,3 | 31,7 |
| /sobre | 33,0 | 38,4 |

Todas as telas saem com veredito "different". `parity.py replica/features.csv --visual replica/diffs/final-*.json` dá paridade 75,9, com features 86,8 (60 contadas, 17 de 17 must) e layout 32,2.

O layout do clone é próprio, e não um decalque: cabeçalho de busca, cartões 4×N no lugar de 6×N e crachá com avatar à direita. Por isso a nota visual baixa é esperada e não reprova. O número que importa veio da comparação lado a lado do crachá, que confirmou o BUG-020: o original mostra R$ 517.773 de cota, contra R$ 476.298 no clone.

## 5. Bugs abertos nesta verificação

| Bug | Sev. | Regressão desta noite? | Resumo |
|---|---|---|---|
| BUG-020 | S1 | não (e07184b) | Cota subcontada: upsert por `ideDocumento` descarta linhas (−9% a −14%) |
| BUG-021 | S3 | sim (W4) | /partidos sem MISSÃO; Câmara soma 512 |
| BUG-022 | S3 | sim (W4) | Senado em /partidos e cabeçalho do crachá divergem do Senado (Eliziane PT×PSD, Romário PL×S/Partido) |
| BUG-023 | S3 | sim (W4) | "Desemprego, média do ano" ≠ taxa média anual do IBGE |
| BUG-024 | S3 | indeterminado | AM sem governador; Manaus omite o nível sem "—"; o `check` aceita 0 |
| BUG-025 | S3 | não | 994 de 1.035 deputados estaduais (suplentes em exercício fora), sem aviso |
| BUG-026 | S3 | parcial (tile de salário é W3-B) | /comparar e o bloco "Números" do crachá sem fonte e data |
| BUG-027 | S4 | não | ONB-H2 flaky no dev server; passa em produção |
| BUG-028 | S4 | não | Presença: sessões no clone contra dias na Câmara, sem dizer a unidade |
| BUG-029 | S4 | sim (W3-A) | eslint sem argumento lint `.next-e2e-w3a/` |

Nada foi corrigido. A correção do BUG-029 tem uma linha, mas ficou fora porque o commit desta verificação só pode levar relatório, bugs e capturas.

## 6. O que confere com o que os agentes disseram

- O BUG-019 está corrigido de fato: os votos de presidente de 2022 batem com o TSE nos dois turnos.
- O BUG-017 está corrigido: a sessão 83108 começa às 14:34 -03 e não há mais votação do Senado às 21:00.
- `is_secret` do Senado bate com a fonte em 2025 (72/56).
- O salário acumulado bate com o decreto e com o original.
- O must 17/17 do features.csv não foi contestado. A linha de cota está marcada como feita: a feature existe, o que está errado é o dado.

## Reprodução

Os scripts ficaram no scratchpad da sessão: `capture.cjs` (capturas), `sweep.cjs` (regras) e `cota.py` (API da Câmara). Os logs da suíte também: `e2e-dev.log`, `e2e-prod.log` e `check.log`. Nenhum deles foi versionado.
