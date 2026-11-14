# Backlog de execução · novembro de 2026

Levantado em 11/11/2026, 01:20–02:00 BRT, pelo orquestrador, com o dono ausente. Base: `origin/main` em `98645f3`.
Fontes lidas: `catalogo-2026-11-08.md`, `decisions.md` (D250–D293), `bugs.md`, `verificacao-agentica.md` (§10, §13, §14, §17, §18), `runbook-migracoes-producao.md`, `runbook-raw-storage.md`, `hospedagem-sapl-2026-11-09.md`, descrições das PRs #20, #21 e #22, seção 10 de `fluxo-de-dados.md` (PR #21), branches locais sem PR, workflows e variáveis do GitHub, e produção em leitura (`schema_migrations`, `dataset_stamps`, `/api/health/fontes`, logs do `etl.yml`).

Só o orquestrador edita este arquivo e `decisions.md`. Estados: feito / em revisão / em execução / pendente / bloqueado / adiado.

## 1. Estado encontrado (diverge do que a tarefa supunha)

| Fato | Evidência | Consequência |
| --- | --- | --- |
| Produção já está na `0141`. As cinco pendentes (0130, as duas 0131, 0140, 0141) foram aplicadas em 11/11 00:27–00:28 UTC | `select filename, applied_at from schema_migrations where filename >= '0100'` (leitura) | Passos 2 e 3 do bloco ETL: nada a aplicar. O `runbook-migracoes-producao.md` está desatualizado ("não executado") |
| As duas `0131_*` convivem | `db/migrate.sh` usa o nome do arquivo como chave; as duas constam em `schema_migrations` | Sem colisão. Próxima migração: `0150` em diante |
| Carimbos `pauta.camara` e `pauta.senado` existem (11/11 04:18 UTC) | `dataset_stamps`; `etl · pauta` com sucesso às 04:18 UTC | Passo 4: já cumprido pela agenda da pauta |
| `ETL_ALERT_WEBHOOK` existe | `gh secret list` (só nomes) | Passo 5: ok |
| `ETL_SCHEDULE_ENABLED=true` desde 09/11 11:50 UTC | `gh variable list` | Passo 6: a agenda já está ligada |
| O `etl.yml` fecha vermelho em todos os 6 últimos ciclos (exit 2 = alerta, não falha de tarefa) | logs dos runs 42686968075 … 42903653590 | O aceite "um run concluído com sucesso" não se cumpre até corrigir a causa abaixo |
| Causa: a Câmara tem **514** em exercício. A PB tem 13 (são 12): `leonardo-gadelha`, suplente em exercício desde 09/07/2026, não foi encerrado quando o titular voltou. A API da Câmara lista 12 na PB, sem ele | consulta em produção por UF; `dadosabertos.camara.leg.br/api/v2/deputados?siglaUf=PB` | Quebra duas invariantes de uma vez: "câmara: exatamente 513" e "assembleia: cadeiras da CF art. 27" (a conta de cadeiras da ALPB deriva dos 13). Vira **BUG-050** e a PR P02 |
| "JANELA PERDIDA camara.noturna" (10/11) | mesmo log | Alerta de uma noite; some quando a próxima janela for lida. Acompanhar no primeiro ciclo verde |
| Vigia verde: `ok:true`, Câmara, Senado e pauta `em_dia` | `GET /api/health/fontes` às 04:23 UTC; `vigia.yml` com sucesso em 09 e 10/11 | Não desligar a agenda (D294) |
| Nenhum run agendado do `etl.yml` depois de 10/11 21:17 UTC, embora três disparos devessem ter ocorrido | `gh run list --workflow etl.yml` | A conferir no próximo tick (atraso do GitHub ou fila). Workflow `active` |
| `web_reader` lê `verified_by` em produção | `information_schema.column_privileges` | O `try/catch` da PR #22 não esconde "permission denied" |
| `prod-migrate.sh` pede a URI de escrita digitada | `etl/deploy/prod-migrate.sh:9` | **Toda migração nova fica bloqueada, depende do dono.** As PRs foram fatiadas sem migração; a que precisar fica isolada |
| O `ci.yml` só tem `etl` e `mcp` | `.github/workflows/ci.yml` | "CI verde" não mede nada do `web/` até a P01. Até lá, os critérios 1 a 4 rodam localmente |
| `claude/etl-fase2b-alerta-sapl` só existe local (1 commit, 7 arquivos) | `git log origin/main..` | Entra como P04, rebaseada |
| `claude/etl-fase2a-contrato`, `claude/design-consent-63af20` e `worktree-agent-a4484…` não têm commit além da main | idem | Nada a integrar |

## 2. Itens abertos

Classe: F = front, B = back/ETL, D = dados/contrato, O = operação.

### 2.1 Vão para PR nesta execução

| ID | Item | Classe | Origem | Depende de | PR |
| --- | --- | --- | --- | --- | --- |
| A1 | Mergear #20 (testes do upsert) | B | PR aberta | — | #20 |
| A2 | Mergear #21 (mapa do fluxo de dados) | O | PR aberta | — | #21 |
| A3 | Mergear #22 (Direção 2 no /v2, renome) | F | PR aberta | A1, A2 | #22 |
| A4 | CI do `web/`: lint, typecheck, unit, build, e2e na fonte demo | O | tarefa (a) | A3 | P01 |
| A5 | BUG-050: suplente que saiu segue em exercício (Câmara 514) | B | achado desta execução | A1 | P02 |
| A6 | BUG-008: React #418 intermitente em `/p/[slug]` | F | `bugs.md` | A3 | P03 |
| A7 | ETL Fase 2b: alerta de parada do SAPL | B/O | branch local | A1 | P04 |
| A8 | Teste de integração do laço `run_verificar` e do `PgStore` com banco | B | `verificacao-agentica.md` §17 | A1 | P05 |
| A9 | Contrato: cobertura por pessoa e por conjunto; cadeiras por UF; votações e autores sem truncar em 5 e 20; rótulo "atualizado em" do salário (aberto da #20) | D | tarefa (e), PR #22, PR #20 | A3 | P06 |
| A10 | BUG-044 e BUG-048, com teste de regressão | B | `bugs.md` | A1 | P07 |
| A11 | BUG-009: toque ignorado nos primeiros ~0,5 s da lista | F | `bugs.md` | A4 | P08 |
| A12 | /v2: redesenhar `votacoes`, `votacao/[id]`, `decisoes` | F | tarefa (c), PR #22 | A3, A4 | P09 |
| A13 | /v2: redesenhar `pessoas`, `tema/[slug]`, `como-funciona`, 404 | F | tarefa (c), PR #22 | P09 (mesmo `sv.css`) | P10 |
| A14 | /v2: rotas de notas fiscais, equipe e lista completa de votos; tirar os links para `/p/[slug]` | F | tarefa (d), PR #22 | P06, P10 | P11 |
| A15 | Verificação agêntica: conjunto de referência, ensaio, barra da §10 medida e registrada | B/O | tarefa (h), §17 | P05 | P12 |
| A16 | Itens "Talvez" e stubs `/mais-vistos` e `/stf`: decidir um a um | F/D | tarefa (j) | — | P13 |
| A17 | Promover a Direção 2: destino de cada página do v1, 308, fim do `noindex`, `como-escolhemos` coerente com D293 | F/O | tarefa (i) | P10, P11, P13 | P14 |
| A18 | Runbook de migrações e docs antigas coerentes com o estado real | O | §1 | — | R (registro) |

### 2.2 Abertos que NÃO entram (com motivo)

| Item | Classe | Origem | Estado | Motivo ou passo que falta |
| --- | --- | --- | --- | --- |
| Ligar a publicação por agentes | O | D293, §17 | bloqueado | Só com a barra da §10 atingida. A §10.1 pede rótulo "à mão" e a §14.5 deixa em aberto quem rotula; rótulo por agentes mede, mas não libera (ver P12) |
| Chave de desligar a publicação na web e leitor do estado `retirado` | F/B | fluxo 10.6 | adiado | Pré-requisito de ligar a publicação; sem publicação ligada não há o que retirar. Entra quando a barra passar |
| `check` não bloqueia publicação | B | fluxo 10.1 | adiado | Mudança de arquitetura do `run-due` (ordem check → revalidação). Merece PR própria com decisão do dono sobre "dado velho × dado com invariante quebrada" |
| Trava de proporção contra arquivo vazio da fonte | B | fluxo 10.3 | adiado | Alto, mas toca quatro jobs de escrita; fica como próxima PR de ETL depois de P02 e P07 |
| Alerta de prazo cego para Câmara e Senado enquanto a pauta carimba | B | fluxo 10.23 | adiado | O vigia e o check de 48 h cobrem hoje |
| Role próprio do ETL | B/O | fluxo 10.2 | bloqueado | Exige migração e troca do secret `ETL_DATABASE_URL` (dono) |
| Revogar grants de `anon`/`authenticated` | B | runbook, "Depois" | bloqueado | Migração nova: `prod-migrate.sh` pede a URI digitada |
| Cópia do bruto (D280) | O | `runbook-raw-storage.md` | bloqueado | Criar bucket e credenciais (conta/serviço). Passos no runbook |
| SAPL em Fly/Railway | O | `hospedagem-sapl` | encerrado | Dono escolheu launchd (D274). Não mexer |
| Suplentes estaduais que faltam (41 em 18 UFs) | B | BUG-025 | adiado | Carga de ETL por UF; tela já nomeia a lacuna |
| Paginação sem ordem em sessões e matérias do SAPL | B | D273 | adiado | Risco latente; totais batem hoje |
| Podar `sapl_votos.description` | D | D271 | bloqueado | Proposta ao dono; apaga dado |
| Emenda individual sem vínculo de pessoa | D | D287 | adiado | A fonte não traz a UF do autor |
| Conferir 3 casos de origem de campanha no DivulgaCandContas | D | D256 | adiado | Conferência manual contra a fonte; não bloqueia tela |
| Lote do rascunho nunca exercitado na API real | B | D260 | adiado | Roda sozinho no cron das 08:30; observar |
| Segunda leitura: ato do Senado "ainda não conferido" | D | D289 | adiado | Texto de tela já diz |
| Voto do cookie legível por script no tema v2 | F | fluxo 10.25 | em revisão | Conferir na revisão da #22; se confirmado, vira achado dela |
| Sugestões sem expurgo; `web_writer` lê todos os perfis; sal fixo sem `SESSION_SECRET` | B | fluxo 10.8, 10.12, 10.13 | adiado | Privacidade e conta: PR própria, com migração (bloqueada) nos dois primeiros |
| Blueprint v2.1; quem assina a responsabilidade editorial; teto de gasto; auditoria por amostra | O | §14, D293 | bloqueado | Decisão do dono |
| BUG-019 (arquivo `_BRASIL` do TSE) | B | `bugs.md` | adiado | O app não mostra voto de presidente; recarga de ~4 GB por ano |
| D04, D05, D07, D10, D16, U04, U07, U16, U18, U19 | — | catálogo | ver P13 | Decisão um a um na onda 4 |
| Resend, domínio, R2, INPI, WhatsApp | O | — | bloqueado | Conta ou gasto: fora da autorização |

## 3. Fatiamento em PRs

Uma PR = um tema. Ordem por dependência e risco. Revisor independente em todas; revisão dupla (opus) onde há escrita do ETL.

| PR | Branch | Tema | Arquivos permitidos | Critério de aceite | Modelo | Onda |
| --- | --- | --- | --- | --- | --- | --- |
| #20 | `claude/perf-testes-upsert` | testes do upsert | — | CI verde; pytest local | revisão opus | 0 |
| #21 | `claude/replica-data-flow-addb49` | mapa do fluxo | — | `python3 -I replica/tools/fluxo_confere.py` = OK | revisão sonnet | 0 |
| #22 | `claude/segue-o-voto-d2` | Direção 2 no /v2 | — | critérios 1–7; preview com banco real em 3 páginas | revisão opus | 0 |
| R | `claude/registro-execucao-2026-11` | este arquivo, `decisions.md` D294+, runbook | `replica/*.md` | coerente com a evidência | orquestrador | contínua |
| P01 | `claude/ci-web` | CI do web | `.github/workflows/ci.yml`, `web/playwright.config.ts` (só se preciso) | job `web` verde na própria PR: eslint, tsc, unit, build, e2e demo; sem segredo; BUG-008 não mascarado por retry cego | sonnet | 1 |
| P02 | `claude/etl-suplente-saiu` | BUG-050 | `etl/civico_etl/jobs/camara*.py`, `etl/tests/*`, `replica/bugs.md` (só a entrada nova) | teste que falha antes e passa depois; em Postgres local a Câmara volta a 513 sem apagar mandato (status e data de fim, com motivo); depois, em produção, `etl.yml` verde | opus + revisão dupla | 1 |
| P03 | `claude/bug-008-hidratacao` | BUG-008 | `web/src/app/p/**`, `web/src/components/**` do crachá, `web/e2e/f03-profile.spec.ts` (sem afrouxar) | causa isolada com diff de hidratação; `f03-profile` 20 de 20 isoladas | sonnet (opus se não isolar) | 1 |
| P04 | `claude/etl-fase2b-alerta-sapl` | alerta do SAPL | os 7 arquivos do commit `c1418e0` | pytest e `node --test` verdes; **não** quebrar o launchd do dono: o exit 78 sem webhook só vale se o Keychain tiver o item, senão avisa e segue (D a registrar) | sonnet + revisão opus | 1 |
| P05 | `claude/etl-verificar-integracao` | teste do `run_verificar` com banco | `etl/tests/test_verificar_integracao.py`, fixtures | roda no Postgres do CI com cliente de API simulado; cobre `PgStore`, laço, `Changed`, três marcas | sonnet + revisão opus | 1 |
| P06 | `claude/contrato-cobertura-cadeiras` | contrato de dados | `web/src/lib/data/*`, testes unitários, fake | sem migração; contagens reais do Postgres de produção (leitura) na descrição; lacuna nomeada quando o dado não existe | opus | 2 |
| P07 | `claude/identidade-bug-044-048` | identidade TSE | `etl/civico_etl/identity*.py`, `tse_votos_contas.py`, `tse_candidatos.py`, testes | os 4 pares do BUG-044 rejeitados; `dr-auri` não rejeitado; BUG-048 agrega por (UE, SQ); 0 mudança nas 1.680 linhas atuais além das 2 fusões reais | opus + revisão dupla | 2 |
| P08 | `claude/bug-009-toque` | BUG-009 | `web/package.json`, lock, componente do combobox, spec F01 | toque em 0 ms abre a cidade em emulação de toque, 10 de 10; se depender de versão da biblioteca que não resolve, fica aberto com a sonda registrada | sonnet | 2 |
| P09 | `claude/v2-votacoes-decisoes` | /v2 parte 1 | `web/src/app/v2/{votacoes,votacao,decisoes}/**`, `web/src/styles/sv.css`, `web/e2e/v2-d2-aceite.spec.ts` | telas no padrão das seis; entram na bateria de aceite e passam | sonnet + revisão opus | 2 |
| P10 | `claude/v2-pessoas-tema-404` | /v2 parte 2 | `web/src/app/v2/{pessoas,tema,como-funciona}/**`, `not-found`, `sv.css`, aceite | idem | sonnet + revisão opus | 3 |
| P11 | `claude/v2-notas-equipe-votos` | /v2 rotas novas | `web/src/app/v2/pessoa/[slug]/{notas,equipe,votos}/**`, aceite | nenhum link de /v2 para `/p/`; equipe só em agregado se o catálogo "Não adaptar" exigir (decisão a registrar); paginação sem ordenar por valor | sonnet + revisão opus | 3 |
| P12 | `claude/verificacao-ensaio` | ensaio e barra | `etl/evals/**`, workflow manual de ensaio, `replica/verificacao-agentica.md` | conjunto de medida separado do de ajuste; métricas da §10.3 e injeção da §10.4 com números; publicação continua desligada | opus | 3 |
| P13 | `claude/talvez-e-stubs` | decisões do catálogo | o que cada decisão "fazer" pedir | uma entrada D por item; só implementa o que não pede conta nem fonte bloqueada | sonnet | 4 |
| P14 | `claude/promover-direcao-2` | promoção | `web/src/app/**` (rotas), `next.config.ts` (redirects), `robots`, `como-escolhemos` | tabela de destino de cada rota do v1; 308 testados; sem `noindex`; e2e inteiro verde | opus | 5 (última) |

Regras de série: P06, P09, P10 e P11 não rodam juntas com outra PR que toque `web/src/lib/data/*` ou `sv.css`. P02, P07 e P04 tocam `etl/` em arquivos disjuntos e podem rodar juntas.

## 4. Proposta inicial para os "Talvez" (decisão final na P13)

| Item | Proposta | Motivo |
| --- | --- | --- |
| D04 SICONFI | adiar | M (2 a 5 dias), mapeamento de função por exercício; não serve às seis telas do /v2 |
| D05 salário pelos TCEs | adiar | G, 27 formatos |
| D07 STF e stub `/stf` | adiar o dado; aposentar o stub | fonte em HTML não confirmada; stub vazio afirma um módulo que não existe |
| D10 ALEs com fonte própria | adiar | G, cinco formatos |
| D16 MCP público | adiar | precisa de limite de taxa no WAF da Vercel (configuração de conta) |
| U04 resumo em frases | fazer no /v2, sem média | P; cabe na Pessoa |
| U07 barra inferior | aposentar no v1; reavaliar no /v2 | exige prancha; a Direção 2 já redesenhou a navegação |
| U16 matriz de cargos | adiar | conteúdo jurídico por célula precisa de conferência de fonte |
| U18 trajetória | fazer no /v2 se couber na P11 | P; dado já carregado |
| U19 canal de WhatsApp | bloqueado | conta e publicação manual |
| `/mais-vistos` | aposentar | popularidade como ordenação está em "Não adaptar" |

## 5. Andamento

Atualizado em 13/11/2026, fim da execução (ondas 0 a 5).

| Item | PR | Estado | Evidência |
| --- | --- | --- | --- |
| Fase 0 | R | feito | este arquivo |
| A1 testes do upsert | #20 | feito | merge `bb50a16`; revisão independente (opus): sem bloqueio; corrige `KeyError` no log de `party_memberships` que estava na main. Dívidas: `where="true"` só no primeiro upsert de `salaries` (tetos estaduais ficam de fora) e o teste de `sync_party_memberships` pula no CI por "banco sem carga" |
| A2 mapa do fluxo | #21 | feito | merge `6280598`; o verificador saía com 1 em checkout limpo (`etl/.cache`), corrigido em `a79fe58`; amostra da revisão: 17 corretas, 3 imprecisas, 0 falsas em 22 |
| A3 Direção 2 no /v2 | #22 | feito | merge `5c2bff3`. 1ª revisão (opus): **não mergear** (selo afirmava "agentes de IA, não pessoa" sem dado). Corrigido em `a79a26b`…`7dec00c` + `6a4807d`; re-revisão: mergear com dívida. Local: tsc, eslint, 35 unitários, build, e2e 464 passaram, 0 falharam, 74 pulados. Postgres local (dados reais): 12 páginas 200. Produção após o deploy: 15 páginas 200, sem erro visível (D296) |
| A7 alerta do SAPL (Fase 2b) | #23 | feito | merge `91f7c77`; webhook opcional (D299); re-revisão sem achado; pytest 52 passaram, 2 pulados; `health.test.ts` 7/7; carimbo `sapl.*` de produção com 16 h |
| A8 integração do `run_verificar` | #24 | feito | merge `eb77a09`; 97 testes novos, suíte 510 passaram, 32 pulados; 6 divergências código × especificação confirmadas (D300) |
| A5 BUG-050 | #25 | feito | merge `ead585e`; duas revisões (opus) e re-revisão do delta; 21 testes, suíte 434 passaram; em produção encerrou exatamente 1 mandato (D301) |
| A4 CI do web | #26 | feito | merge `b095ba9`; jobs `web-verificar` (1m16s), `web-build` (1m34s), `web-e2e` (8m03s; 464 passaram, 74 pulados por exigirem banco, 0 falhas, 0 flaky); SHAs das actions conferidos contra as tags; run da main não é mais cancelado; `forbidOnly` no CI |
| A6 BUG-008 | #30 | feito (merge `150ac3b`) | 29/100 → 0/100 cargas com #418 sob HTML lento; contorno até o Next vendorizar React >= 19.3.0 |
| ETL: migrações, pauta, webhook, agenda | — | feito antes desta execução | §1 |
| ETL: run verde | #25 | feito | run 43024305280 (11/11 09:53–10:00 BRT): `success`, 3 tarefas, 0 falhas, 0 invariantes quebradas; vigia 43025369561 `success`; `/api/health/fontes` `ok:true` (D301) |
| A10 identidade BUG-044/048 | #27 | feito (merge `99c5a19`) | duas revisões (opus): mergear com dívida; correções A1–A7 e B1–B5 aplicadas em `faf8630`; simulação no banco local: 1.680 linhas com nascimento diferente, 2 recusas antes e depois, 0 mudam; CI verde; delta em re-revisão |
| A9 contrato de dados | #28 | feito (merge `e189d78`) | CI verde; contagens reais do banco local na descrição; revisão independente em curso |
| A15 avaliação da verificação | #29 | feito (merge `1e825ff`); calibração disparada (run 43281434026, teto US$ 5) | harness, conjunto (117 armadilhas, 20 PDFs de injeção) e workflow manual; revisão: mergear com dívida, 6 correções em curso; NENHUMA chamada real à API; barra da §10 não medida |
| BUG-053 histórico de quem entra no diretório | #32 | feito (merge `680ae3d`) | aplicado em produção (D306): 39 candidaturas, 8 mandatos encerrados, 24 bens; check 8 → 0 |
| A11 BUG-009 | #31 | feito (merge `f79294b`) | revisão: mergear com dívida; antes ~460 ms, depois 0–1 ms em 20/20; dívida: `person-picker.tsx` com o mesmo atraso |
| ETL depois do BUG-050 | #32, #35 | invariantes verdes em 12/11; **agenda vermelha** (D312) | ficou vermelho por BUG-053 (11–12/11) e por BUG-054/055 (12/11); corrigidos em produção (D306, D308). Último run conferido: 43315021288 (12/11 18:55 BRT), `success`, 3 tarefas, 0 falhas, nenhuma invariante quebrada |
| BUG-054 cota em dobro e BUG-055 carimbo semanal | #35 | feito (merge `bf95500`) | revisão dupla; em produção o prune apagou 440 (2025) e 324 (2026) lançamentos duplicados; amostra × página da Câmara dentro de R$ 0,10 (D308) |
| A15 barra da §10 medida | #29 | medido; **barra não atingida** | D305: 0 de 9 controles limpos publicados; 27 de 28 armadilhas pegas, 1 escape; US$ 3,71. Publicação por agentes segue desligada |
| A16 "Talvez" e stubs | — | decidido (D304) | U04 e U18 feitos na #34; `/mais-vistos` e `/stf` aposentados na #36; U07 aposentado; U19 bloqueado; demais adiados |
| A14 rotas da Pessoa no /v2 (U04, U18) | #34 | feito (merge `1ec95b2`) | revisão independente + correções B1, C1–C3, N2/N6/N9; e2e local 448 de 448; CI verde; nenhum link do /v2 para `/p/`; equipe só em agregado |
| A12 e A13 sete telas do /v2 | #33 | feito (merge `0f237b2`) | revisão independente (A–F e notas) e rechecagem (datas de Decisões, `dd1bccf`); e2e local 597 de 597; CI verde |
| A17 promover a Direção 2 | #36 | **parcial** (D309; merge `909df11`) | nenhuma rota do v1 tem paridade comprovada no /v2: sem 308 e `/v2` segue `noindex`. Entregue: stubs aposentados, rodapé e legenda coerentes com a D293, `noindex` próprio nas páginas pessoais; e2e inteiro local 721 passaram, 74 pulados |
| CI e ETL em 13/11 | — | **bloqueado, depende do dono** (D312) | GitHub Actions recusa todo job por cobrança (CI da main, PR #37 e ETL manual); runs agendados vermelhos por "JANELA PERDIDA" das leituras noturnas de 12 e 13/11; produção e saúde das fontes conferidas `ok` em 13/11 13:03Z |
| CI e ETL em 13/11, tarde | — | **resolvido** (D313) | Actions voltou a aceitar jobs às 17:38Z; leituras noturnas repostas (`43474640993`, `43475524412`); agenda inteira verde (`43477425230`); CI da main e da PR #37 verdes; causa dos crons noturnos sem disparo segue em aberto |
| Promoção da Direção 2 | — | **feito em parte** (D316) | Direção 2 na raiz, `/v2` com 307, desenho anterior no ar onde não há paridade (`/no-seu-bolso`, `/conta`); seguem da D309: paridade de Decisão e Votação, perfil completo, unificar seguidos, aposentar o desenho anterior |

### Dívidas registradas nas revisões

| Origem | Dívida | Destino |
| --- | --- | --- |
| #22 | N+1 dos escolhidos (até ~130 consultas por request com 12 pessoas) | P06 |
| #22 | `sv_sigo` (voto declarado) gravado por script; falta server action com `httpOnly`; quem não clicar de novo fica com o cookie antigo em `path=/` | PR própria de privacidade, depois da P11 |
| #22 | `prefs.ufFalhou` e o erro de Ajustes com banco fora sem e2e; Temas ainda mostra "Escolha seu estado" quando a leitura das UFs falha; pessoa marcada que a fonte não encontra some sem aviso no Início | P10 |
| #22 | rodapé do v1 dizia "Temas lidos por IA, aguardando revisão por pessoa" | corrigido na #36 (D309) |
| #20 | `where="true"` também no upsert dos tetos estaduais; teste de `party_memberships` com fixture própria | P06 troca o rótulo por carimbo; o teste entra na próxima PR de ETL |
| #23 | tempestade de alertas de hora em hora; ponta a ponta com Keychain real não cobre "item ausente" | adiado |
| #24 | run de `verificar` abortado fecha como `succeeded` e carimba o dataset; `streak` só zera em sucesso; `reviewer` não identifica a execução; banco aceita `barrado` sem relatório | pré-requisito de ligar a publicação (D300) |
| #25 | suplente que entrou no 1º dia tratado como titular; suplente efetivado "Titular" colide com a exclusão e derruba o run | BUG-051 e BUG-052, a abrir |
