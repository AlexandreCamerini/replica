# Revisão final independente: 2026-11-14

Premissa: "revisão final" = revisão independente de toda a execução de novembro, `98645f3..3510eff` (PRs #20 a #39; 160 arquivos, +19.051 −1.630).

Critérios: a §3 de `backlog-execucao-2026-11.md` dá o aceite por PR, mas para a #22 só aponta "critérios 1–7", que não estão definidos em nenhum arquivo do repo. A lista da seção 4 foi montada pelo orquestrador a partir da §3, das mensagens de commit das revisões (A a F), das decisões D293 a D315 e dos comentários do próprio código. Onde o critério é meu e não do backlog, a tabela diz.

Método: quatro revisores com contexto limpo, por área disjunta (web dados/servidor, web telas/e2e, ETL, CI/migração/docs). Receberam o código e os critérios, não as conclusões da §5. O orquestrador reabriu na fonte os dois S2 e os S3 marcados C; o resto vale pela leitura do revisor (R) ou é mecanismo lido sem reprodução (P). Só leitura: nenhum código, `decisions.md` ou backlog foi alterado; nada foi escrito em produção; nenhum workflow disparado.

Severidade pela escala de `bugs.md`: S1 perda de dado, segurança ou fluxo central bloqueado; S2 feature quebrada sem contorno; S3 quebrado com contorno ou visivelmente errado; S4 cosmético. Risco latente fica na classe em que `bugs.md` já o registra, com nota do que vira quando disparar.

## Veredito: não fecha

Pelo critério de `verify-final.md` (nenhum S1 ou S2 aberto), a execução não fecha: 0 S1, 2 S2 confirmados, 24 S3.

1. **S2-1, introduzido nesta execução.** Banco fora ou grant perdido derruba `/v2/pessoa` (e as três subrotas), `/v2/decisao` e `/v2/temas` com 500. A revisão D (`39fcaf0`) corrigiu exatamente isso em Votação e Tema; nas outras três rotas ficou sem guarda.
2. **S2-2, herdado e já materializado.** Toda a vigilância (ETL, vigia, webhook) mora no GitHub Actions. Quando o Actions parou em 13/11, ninguém foi avisado. Não tem bug nem item de backlog.

Abaixo do corte, mas com o mesmo peso prático: o Senado tem um único disparo dentro da janela noturna (S3-1), e se o cron de hoje (primeiro dia da D315) disparou **não foi conferido** (ver seção 2). E o BUG-052 (S3-2) está registrado como latente, mas quando disparar bloqueia a carga inteira da Câmara, que é classe S1.

Nenhum achado é dado errado publicado hoje.

**Adendo, mesma data:** o S2-1 foi corrigido neste worktree, a pedido do dono, depois da revisão (guarda nas seis páginas, `web/src/app/v2/error.tsx`, simulação `?simular=erro_pagina` e teste em `e2e/v2-d2-aceite.spec.ts`). Conferido no navegador com a fonte demo e por um revisor independente (sem S2 nem S3). O teste e2e novo não rodou aqui (o sandbox não abre o Chromium); fica para o CI. Enquanto a correção não estiver na main, o veredito acima vale.

## 1. Suíte

| Item | Resultado | Observação |
|---|---|---|
| web `eslint src e2e` | exit 0, 0 problemas | |
| web `npm run test:unit` | 70 de 70 | |
| web `tsc --noEmit` | exit 1, 2 erros TS2307 | Os dois em `.next/types/validator.ts`, artefato local de 10/11 que ainda aponta para `/stf` e `/mais-vistos`. Não é defeito do código; some com `rm -rf web/.next`. O CI gera `.next` novo |
| web `npm run contrast` | 64 pares, 0 reprovados em AA | |
| pytest ETL | 473 passaram, 256 pulados, 4 xfail | Rodado pelo revisor com o venv de outro worktree (versões podem divergir do `uv.lock`). Os 256 pulos são "banco indisponível": o sandbox nega TCP local. Os 4 xfail são dívidas declaradas do BUG-044 |
| `python3 -I replica/tools/fluxo_confere.py` | FALHA, 5 problemas | Não cita `verificacao-eval.yml`, `lib/data/{cadeiras,cobertura,lista}.ts` nem `v2/ajustes/actions.ts`. O aceite da #21 ("verificador = OK") deixou de valer depois das #28, #29, #33 e #34 |
| mcp `npm test` | não rodou | sem `node_modules` no worktree; `mcp/` não mudou no intervalo |
| build, Playwright | não rodaram | sandbox (porta local); o último número é o do CI |
| `gh run list` | não rodou | TLS barrado no sandbox. Estado do CI e dos crons de hoje não conferido por aqui |

## 2. Produção (leitura, 14/11, 03:26Z a 03:48Z)

- `/api/health/fontes`: `ok:true`, nenhuma essencial com problema. Câmara 13/11 20:03Z, Senado 13/11 17:46Z, pauta 13/11 23:49Z, SAPL 11/11 17:04Z.
- `/stf` e `/mais-vistos`: 404. `/v2`: `noindex, nofollow`. `/v2`, `/v2/decisoes`, `/v2/votacoes`, `/v2/pessoas`, `/v2/acompanhando`: 200. Rodapé do v1 com o texto novo.
- `/robots.txt`: 404 (não existe robots nem sitemap).
- **Cron do Senado de hoje (`31 3`, primeiro dia da D315): não conferido.** Correção de uma versão anterior deste relatório, que tirava do carimbo do Senado em `/api/health/fontes` (parado em 13/11 17:46Z) a conclusão de que a leitura noturna não tinha acontecido: essa régua exclui de propósito os datasets `.noturna.` (`web/src/lib/data/health.ts`, função `core`), então o carimbo não se move com a leitura noturna e não prova nada. A conferência que a D313 pediu continua aberta e só se faz pelo Actions: `gh run list --workflow etl.yml --limit 8 --json databaseId,event,createdAt,conclusion`, procurando um `schedule` criado entre 03:30Z e 05:00Z.

## 3. Achados

Conf.: C = reaberto na fonte pelo orquestrador; R = lido ou executado pelo revisor; P = mecanismo lido, cenário não reproduzido.
Origem: N = linha introduzida no intervalo (`git blame 98645f3..HEAD`); H = herdada, anterior a `98645f3`.

### S2

| # | Onde | Defeito e cenário | Origem | Conf. |
|---|---|---|---|---|
| S2-1 | `web/src/app/v2/pessoa/[slug]/page.tsx:43,72`; subrotas `gastos`, `equipe`, `votos`; `v2/decisao/[key]/page.tsx:36,148`; `v2/temas/page.tsx:101-106`; não existe `error.tsx` em `web/src/app` | A leitura principal não tem guarda. Postgres fora ou "permission denied" em `getPerson`, `getPautaProposal` ou `listTopics` → 500 com a página de erro do Next. O próprio `decisao/page.tsx:158` promete "nunca erro da página", e `39fcaf0` tratou o mesmo caso em `/v2/tema/[slug]` e `/v2/votacao/[id]` com `FalhaDeLeitura` | N (`6f7be32`, `bb7ae5e`) | C |
| S2-2 | `.github/workflows/vigia.yml`, `etl.yml` | Não há canal de aviso fora do Actions. Actions recusado ou sem cota → dado vencido em 36 h e ninguém é avisado. Aconteceu em 13/11 (D312). Sem item no backlog §2.2, sem bug | H | C |

### S3

| # | Onde | Defeito | Origem | Conf. |
|---|---|---|---|---|
| S3-1 | `.github/workflows/etl.yml:20-21`; `etl/civico_etl/schedule.py:119-129,252-257` | Senado: os ticks de 3 h caem em 03:17Z e 06:17Z, fora da janela 03:30–05:00Z; só o `31 3` serve. Atraso > 89 min ou disparo pulado = "JANELA PERDIDA"; tarefa com janela nunca vence fora dela, então não há reposição automática (contorno: disparo manual com `only=`). `last_closed` só olha hoje e ontem: janela de sábado perdida alerta no domingo e some na segunda. Perdeu em 12 e 13/11. A #39 ganhou 9 min, não resolveu | H (a #39 mexeu) | C |
| S3-2 | `etl/civico_etl/jobs/camara_diario.py:249,277-282`; `db/migrations/0001_init.sql:383` | BUG-052, aberto, "S3 latente" em `bugs.md`. Suplente efetivado vira "Titular" → insert com início na legislatura → viola `no_overlapping_mandate` → exceção em `_deputies`, primeiro passo de `run_camara`: caem votações, proposições e cota a cada run, até intervenção manual. Sem caso em produção em 11/11. **Quando disparar é S1** | H | C |
| S3-3 | `camara_diario.py:932-935`, com `:849,889,910` | O arquivo anual e o complemento da API são dois `run()` com commit próprio. Falha de API em 1 de ~520 deputados lança `RuntimeError` depois de o arquivo já estar gravado: o `cotaapi` não é podado e a cota fica em dobro enquanto a API estiver instável (a D308 falava em "um ciclo"). A exceção também aborta o laço de anos: falha em Y−1 deixa Y sem carga. Frequência não medida | H (`d5859bc`); interação com BUG-054 é nova | P |
| S3-4 | crons de `etl.yml`, `etl-pauta.yml`, `etl-rascunho.yml`, `ci.yml` | Consumo estimado de 4.000 a 8.000 min/mês em repositório privado, acima de 2.000 e provavelmente de 3.000. O maior consumidor provável é `etl-pauta.yml` (`*/30`, ~720 runs/mês), que a D313 não cita. Aritmética sobre os crons, não medição; a causa da recusa de 13/11 nunca foi apurada | H | P |
| S3-5 | `v2/decisao/[key]/page.tsx:287-301`; `web/src/lib/data/pg.ts:1638-1650` | "Quem propôs" lista `p.authors` (legado: ordem de assinatura, 20) sob uma nota que descreve `p.autores` (alfabética, com total). Com 35 coautores a nota mente sobre a ordem e os 20 podem ser outros. O fake iguala os dois campos; o e2e não vê | N (#28, `345067b`: nota nova sobre lista antiga) | C |
| S3-6 | `v2/decisao/[key]/page.tsx:168,336` | A prova das votações usa `p.readAt`, a hora de leitura da pauta. Mesmo defeito de data que o `dd1bccf` corrigiu em Decisões | N (`bb7ae5e`) | R |
| S3-7 | `v2/decisao/[key]/page.tsx:159,178` | Detalhe de votação que falha é filtrado e vira "Não lemos votação desta proposta"; `casaDoEvento` testa `id.startsWith("senado")`, mas no pg os ids são UUID: todo detalhe que falha vira Câmara | N (`6f7be32`) | C (l.178) |
| S3-8 | `pg.ts:1856-1861`; `.catch(() => null)` das telas e de `carregar.ts` | "Permission denied" é invisível: 42501 não é logado em `verifiedByOf`, os `catch` das telas descartam o erro e `health.ts` só mede frescor. Um REVOKE enche o `/v2` de lacunas com o vigia verde | N (`b4ac2be`) | C (pg.ts) |
| S3-9 | `pg.ts:1537-1540` | `latestRefresh()` é o `max` de qualquer dataset. Câmara parada há 3 dias com a pauta lida a cada 30 min → selo "Leitura das fontes: hoje" em Pessoa, Gastos, Equipe, Votos. Sem carimbo devolve 1970 | H; o uso nos selos do /v2 é novo | C |
| S3-10 | `e2e/v2-d2-aceite.spec.ts:1354-1357`; `fake.ts:1094,1110` | O teste do `dd1bccf` só distingue código antigo de novo no caso de uma Casa; no de duas, o fixture dá a mesma `readAt` (a D312 já admitia). A lógica do commit está correta por leitura | N | R |
| S3-11 | `web/playwright.config.ts:12` | `retries: 1` incondicional: teste instável passa na segunda tentativa. A P01 pedia "sem retry cego"; "0 flaky" depende de alguém ler o relatório | H | C |
| S3-12 | `.github/workflows/etl-pauta.yml:32,47,49,55` | `ETL_DATABASE_URL` (escrita em produção) no `env` do job inteiro, com `checkout@v4`, `setup-uv@v6` e `cache@v4` por tag. Os outros workflows fixam SHA e limitam o segredo ao passo | H | C |
| S3-13 | `components/people/person-picker.tsx:69`; `components/shell/global-search.tsx:138` | Correção do BUG-009 só em `ui/search-combobox.tsx:129`. Os outros dois `Popover` seguem com o toque ignorado por ~0,5 s (dívida da #31, sem destino) | H | C |
| S3-14 | `app/p/[slug]/aguarda-documento.tsx` | O contorno do BUG-008 é legítimo (sem `suppressHydrationWarning`, sem retry), mas vale só para `/p/[slug]`. `/v2/pessoa/[slug]` é igualmente longa e ninguém mediu | N | P |
| S3-15 | `components/pauta/ui.tsx:8` | O selo ainda exibe "Aguardando revisão"; a #36 mudou só a legenda. `e2e/pauta.spec.ts:25` exige o texto antigo | H | C |
| S3-16 | `camara_diario.py:47,363-367` | `MAX_CLOSE = 5` é tudo ou nada e não tem como liberar: 6 suplentes saindo juntos (ministros voltando) → ninguém é encerrado, Câmara > 513 todo dia, run `partial` em laço | N (#25, `cfaf57e`) | C |
| S3-17 | `camara_diario.py:249,281` | BUG-051 aberto: suplente do 1º dia vira `titular` no run seguinte e, ao sair, fica `encerrado` com `ends_on` em 2027 | H | R |
| S3-18 | `camara_diario.py:358` | Fim do mandato = `ultimoStatus.data`, que muda com troca de partido: pode publicar meses a mais de exercício | N (#25) | P |
| S3-19 | `camara_diario.py:917,937` | O prune `cotaapi{ano}` confia em qualquer 200: `dados: []` apaga o complemento legítimo sem nota. Sem piso de sanidade | H | P |
| S3-20 | `etl/civico_etl/jobs/repairs.py:390-410,509-517` | BUG-053: ano que sempre volta atrás (91 duplas de SQ em 2012 comparadas sem a UE) ocupa o teto de 200 e trava o resto da fila | N (#32, `7d9dbf2`) | P |
| S3-21 | `jobs/verificar.py:441-482`; `schedule.py:365-370` | `verificar` abortado fecha `succeeded` e carimba a fonte `camara` (D300 confirmada); com `rascunho` e `pauta`, mascara `camara.diario` parado no alerta de prazo | H | R |
| S3-22 | `replica/runbook-migracoes-producao.md:1-3` | Diz "não executado, produção na 0120" e manda parar se aparecer outra migração. Real: produção na 0141, pendente só a 0142. A linha "A18: feito" do backlog é falsa | H (era o item A18) | C |
| S3-23 | `replica/bugs.md` (BUG-044, BUG-048) | Sem estado de corrigido, embora a #27 os tenha corrigido com teste. BUG-048 ainda diz "Não corrigido" | N (omissão da #27) | R |
| S3-24 | `backlog-execucao-2026-11.md` §5 e "Dívidas" | Linhas que nunca fecharam: A9 "revisão em curso", A15 "6 correções em curso", BUG-051/052 "a abrir" (já existem), cookie `sv_sigo` "em revisão". Dívidas sem destino: PR de privacidade do `sv_sigo`, laço do `run_verificar`, tempestade de alertas do SAPL | N | R |

### S4

- `app/proposta/[key]/page.tsx:161` (H): "Uma pessoa confere cada resposta… antes de publicar". Verdadeiro hoje (publicação por agentes desligada), incoerente com a D293 no dia em que for ligada. (C)
- `components/sv/estados.ts:27`, `pauta/page.tsx:28`, `como-escolhemos/page.tsx:23`: "Revisado por pessoa em <data>" aparece quando `verified_by='pessoa'`. É verdadeiro para as respostas antigas; viola a regra só na leitura literal. Decisão do dono. (C)
- `/v2`: `header` e `footer` dentro de `<main>` perdem o papel de landmark (`app/layout.tsx:65`, `v2/layout.tsx`). (R)
- `components/sv/follow.tsx`: "acompanhar" exige JS; cookie `sv_sigo` gravado por script, sem `httpOnly` (dívida conhecida, sem destino). (R)
- `?pagina=abc`, `?pagina=0`, `?n=abc` em gastos, votos e votações são corrigidos em silêncio; só `/v2/pessoas` diz "entrada inválida". (R)
- Regex de UUID `/^[0-9a-f-]{36}$/` (`pg.ts:313,1228,1286`) aceita 36 hífens: o cast estoura e a tela diz "falha de leitura" em vez de 404. (R)
- N+1 fora de Escolhidos: Temas (~60 a 80 consultas com 12 acompanhados) e Decisão (~50), pool de 10. O caminho de Escolhidos já é em lote. (R)
- `MAX_VOTACOES = 5` e `MAX_AUTORES = 20` continuam cortando; o total é dito, o resto não é alcançável. (C)
- Casamento da cota depende da ordem da API com dois valores ≥ R$ 10 mil a até R$ 0,10 no mesmo documento (reproduzido pelo revisor); contradiz "independe da ordem" da D308. (R)
- BUG-055 só cobre famílias de `schedule.TASKS`: `rascunho` passa 66 h sem rodar no fim de semana e deve dar alarme falso de carimbo vencido. Hoje é o primeiro sábado depois da correção; ainda sem confirmação. (P)
- "JANELA PERDIDA" repete em todo disparo (~8 por dia) até a próxima janela. (R)
- 9 testes `@needs_mac` do wrapper do SAPL nunca rodam no CI. (R)
- Migração `0142` sem `lock_timeout` no arquivo (só na ação manual da D314); irrelevante em produção, onde o índice já saiu. `replica/schema.sql:671` ainda declara o índice. (C)
- `e2e/f05-f08-stubs.spec.ts`: `not.toContainText` sensível a caixa no teste do rodapé (`cd3933e`); a asserção positiva segura. (R)
- `verificacao-agentica.md:5` diz "nada disto está implementado", contra a §17 e a D305. A D295 fala em numeração a partir de `0150`; a D314 usou `0142`. (R)
- Não existe `robots.txt` nem sitemap. O 404 do v1 é o padrão do Next, em inglês. (C)

## 4. Critérios de aceite

| Critério | De onde vem | Resultado |
|---|---|---|
| Contrato de dados (cobertura, cadeiras, sem truncar, carimbo do salário, lacuna em vez de 0) | backlog §3, P06 e item A9 | Parcial: cobertura, cadeiras, carimbo e lacuna cumprem; o corte em 5 e 20 continua, e a lista de autores exibida não é a descrita (S3-5) |
| Falha vira lacuna; inválido é dito; teto 100 | commits das revisões A, D, E (`3cb3523`, `39fcaf0`, `df3212f`) | Não cumpre: S2-1 e a correção silenciosa de `pagina`/`n`. O teto de 100 cumpre |
| Sem link `/v2` → `/p/`; equipe em agregado; notas sem ordenar por valor | backlog §3, P11 | Cumpre |
| `noindex` e rotas aposentadas | D304, D309 | Cumpre (conferido em produção) |
| Texto não afirma revisão humana nem IA sem dado; IA só se `publicado` | D293, D309 | Cumpre com as ressalvas de S3-15 e dos dois primeiros S4 |
| Demo e `?simular=` fora de produção | D309, item 5 | Cumpre no código; configuração implantada não verificada |
| `dd1bccf` (datas de Decisões) | D312 (não revisto) | Lógica correta; teste só meio discriminante (S3-10) |
| `cd3933e` (legenda e rodapé) | D312 (não revisto) | Sem regressão; 3 arquivos, 4 linhas |
| BUG-050 | backlog §3, P02 | Cumpre; 051 e 052 abertos (S3-17, S3-2) |
| BUG-044/048, BUG-053, BUG-055 | backlog §3, P07; `bugs.md` | Cumprem, com S3-20 e o S4 do `rascunho` |
| BUG-054 | D308 | Não cumpre "independe da ordem"; riscos S3-3 e S3-19 |
| Publicação por agentes desligada | D305 | Cumpre no código: exige `VERIFICACAO_AGENTICA=on` e `pipeline_switches`; nenhum workflow define. A tabela de produção não foi lida |
| Harness de avaliação (separação medida × ajuste, teto, chave) | backlog §3, P12 | Cumpre |
| CI do web (SHAs, permissões, gatilho, `forbidOnly`, concorrência) | backlog §3, P01 | Cumpre, exceto S3-11 |
| Crons da #39 × janelas | D315 | Dias e horários corretos; robustez não (S3-1) |
| Migração `0142` | D314 | No-op seguro em produção; nenhum leitor perde o índice |
| Documentação coerente com o estado real | backlog, item A18 | Não cumpre: S3-22 a S3-24, `fluxo_confere` em falha |

Procurado e não achado: injeção de SQL em `pg.ts` (tudo parametrizado, sem `sql.unsafe`); redirecionamento aberto; cor por partido, ranking ou ordenação por popularidade; `test.only`/`fixme` nos specs alterados; vazamento entre conjunto de medida e de ajuste; segredo em argv ou log no wrapper do SAPL.

## 5. Ordem sugerida de correção

1. S2-1: `error.tsx` em `app/v2` mais guarda nas três leituras. Pequeno; fecha o único S2 de código.
2. S2-2 e S3-1 juntos: um vigia fora do Actions (Vercel Cron ou o launchd que já roda o SAPL) e um segundo disparo do Senado dentro da janela (por exemplo `15 4 * * 2-6`).
3. S3-4: medir o consumo real (precisa do escopo `user` no `gh`, é do dono) e, se confirmar, espaçar a pauta.
4. S3-2 e S3-17 (BUG-052 e 051) numa PR de ETL com revisão dupla; S3-3 e S3-19 na seguinte (arquivo e complemento no mesmo commit, piso de sanidade no prune).
5. S3-5 a S3-9: uma PR da tela de Decisão e do selo de leitura.
6. Docs: runbook, `bugs.md`, §5 do backlog, `fluxo-de-dados.md`. São do orquestrador.

## 6. Não coberto

- Nada contra Postgres: testes de integração pulados, contagem real de consultas, grants, `pipeline_switches` e o "513" de produção.
- Build, Playwright e mcp não rodaram aqui. Estado do CI e dos crons de 14/11 não conferido (`gh` barrado); a leitura noturna do Senado de hoje ficou sem desfecho.
- Leitura só por amostragem: `v2/page.tsx`, `como-funciona`, `sv/inicio/*`, `sv/escolhidos/*`, `fake.ts` inteiro, `pg-w4.ts`, `verificacao_pdf.py`, `verificacao_construir.py`, o diff de `derive_stats`, `app/api/**` (fora do diff).
- BUG-008 no `/v2` e o efeito real do `!important` do BUG-009 em navegador não foram medidos.
- O consumo de minutos é estimativa. Os itens P são mecanismo lido, não reproduzido.
- Os achados dos revisores não passaram por um segundo revisor adversarial; a conferência foi a do orquestrador, na fonte, nos itens marcados C.
- A origem (N/H) foi tirada por `git blame` na linha citada; num achado que é interação entre linha nova e antiga, a coluna diz qual é qual.
