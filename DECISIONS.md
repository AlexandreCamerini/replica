# Decisões e pendências da sessão autônoma (19/11/2026)

Regra desta sessão, definida por um hook:

- não perguntar ao dono;
- escolher a opção mais conservadora e reversível;
- registrar a decisão aqui;
- ação irreversível (apagar, publicar, push, gasto) não é executada: vira pendência.

Plano aprovado: `~/.claude/plans/criar-um-plano-para-fluffy-thimble.md`.

Branch: `claude/pendencias-autonomas`, local, a partir de `claude/go-live-www` (#61). Nada foi enviado ao GitHub.

## Decisões

| # | Decisão | Opção escolhida | Motivo | Como desfazer |
|---|---|---|---|---|
| D-A1 | Corte do banco para o Railway | Não executar; deixar pré-voo e roteiro prontos | Escreve em produção e é a ação de maior risco; a regra manda não executar | n/a |
| D-A2 | Troca de DNS no registro.br | Não executar; runbook pronto | Mexe em conta de terceiro e publica o site no domínio | n/a |
| D-A3 | Segredos (Resend, `SESSION_SECRET` da central, senhas de roles) | Ficam com o dono | Segredo não passa pelo chat; gerar e gravar é ação em produção | n/a |
| D-A4 | Push, merge, deleção de branches, env de produção na Vercel | Não executar; comandos prontos nas pendências | Irreversíveis ou publicam | n/a |
| D-A5 | Base da branch de trabalho | `claude/go-live-www`, não o `main` | Os runbooks e o código desta sessão continuam o que está na #61; partir do `main` daria conflito | rebase sobre o `main` depois do merge da #61 |
| D-A6 | Modo manutenção | `MAINTENANCE=1` só por variável de ambiente, só nas server actions que escrevem e com aviso no topo | Reversível sem código. A leitura continua no ar. O pool de escrita do site só é usado nesses pontos (teste garante) | apagar a variável e fazer redeploy |
| D-A7 | Checagem de escritores (runbook §8, a) | Pela lista de nomes, só a sessão que não está ociosa; qualquer role com transação de escrita aberta (`backend_xid`); mais uma medida de escrita concluída em 15 s (`public`, `login` e `auth.users`). `web_reader` saiu da lista | Pega o GoTrue e o ETL sem `application_name` no meio de uma escrita, sem travar por conexão ociosa. Limite: escrita concluída pouco antes da janela pode passar; a pausa do §3 continua sendo a barreira principal | `ESCRITORES_JANELA_S=0`, que só vale com destino local |
| D-A8 | Guarda de roles (runbook §8, g) | Recusar role nosso com `createrole`, `createdb`, `replication` ou `bypassrls` (exceto `service_role`) e membro de role de outra app | O bootstrap é rodado como superusuário num cluster compartilhado com outras apps | reverter o trecho em `db/railway/bootstrap.sql` |
| D-A9 | Provas sem navegador (`sem-navegador.mjs`, `sem-rede-externa.mjs`) | Não rodar | Apagam e recriam o banco `admin_coleta_c7`, fixo no código (`BANCOS_PERMITIDOS`); apagar é irreversível pela regra | n/a: pendência B17 |
| D-A10 | Regra de firewall | Documento pronto (`replica/firewall-regras.md`), sem aplicar | Mexe no tráfego real, e a API de firewall não está liberada para a conexão do Claude | n/a |
| D-A11 | Memória do Postgres do Railway no teto (1,97 de 2 GB) | Registrar como no-go do corte; não aumentar | Aumentar é gasto | n/a |
| D-A12 | Revisão independente do lote (subagente Opus) | Corrigir tudo, sem pendência nova | 2 altos e 13 menores, todos baratos e reversíveis: ordem das pendências (o modo manutenção tem de estar no `main` antes do ensaio: B12b), checagem por nome sem travar por conexão ociosa e pegando transação de escrita aberta de qualquer role, `auth.users` como único alvo em `auth`, aviso também no desenho anterior, `REVALIDATE_URL` como secret, firewall por cabeçalho `Next-Action` em qualquer caminho, DNSSEC, aceites mais precisos, LOGIN proibido nos papéis do PostgREST, trava da janela de 15 s fora do local | reverter o commit |
| D339 | Veredito do comparativo v1 x sv | sv como base de navegação e movimentação; da v1 vêm custo do mandato, salário, emendas e mapa; impacto segue lacuna honesta | Nenhuma versão liga decisão à vida do eleitor; sem resposta conferida a personalização só reorganizaria lacunas (`replica/comparativo-v1-sv.md`) | Reverter o commit do documento; nada implementado |
| D340 | Base do mapa de votos na sv | Sim entre os votos registrados, legenda "X de Y registrados"; voto nunca por cor; enchimento em tinta | Mantém a regra da v1, não trata ausente como contrário e respeita a DIRECAO (uma cor de quantidade) | Remover `components/sv/mapa-votos.tsx`; a lista por UF continua |
| D341 | Visão consolidada do mandato | Painel no topo de `/pessoa/[slug]` e página `/pessoa/[slug]/mandato`; janela "desde AAAA"; deputado federal e senador, demais com lacuna | `career` mistura mandatos e `mandate_periods` não é lida; nunca "total do mandato" quando o mandato começou antes do primeiro ano carregado | Remover painel, rota e consultas novas; sem mudança de banco |
| D342 | Média da casa como referência de gasto | Não comparar; só valores absolutos com "desde AAAA" e fonte | D82 e U04: comparar com a média é ranking implícito | Só por decisão nova do dono |
| D340/D341 (adendos) | Mapa só leitura visual; janela e escopo do mandato | Mapa `aria-hidden` sem link por estado (rota = `nav.sv-ufs` e tabela oculta; link no SVG exige exceção no aceite D2); mandato "desde AAAA" a partir da primeira nota de cota, pendências de ETL registradas | Links no SVG quebram o gate D2 (alvos 44 px, texto 13 px); `mandate_periods` não é lida | Exceção no aceite D2 (dono); correção do ETL |
| D343 | Mapa de votos interativo | Mapa de votos interativo por decisão do dono em 21/11/2026; reverte o adendo da D340 (só visual); exceção ao alvo de 44 px só para os links do mapa; lista e tabela oculta continuam; painel de leitura com o % e a contagem; também em /votacoes | O dono quer ver e usar o mapa; os estados pequenos não cabem em 44 px, e a lista `nav.sv-ufs` de 44 px é o equivalente de toque | Voltar o mapa a `aria-hidden` sem link, apagar a ilha cliente e o quadro de `/votacoes`, tirar a exceção do aceite D2 |

## Leituras de produção feitas (só leitura)

- **Supabase `bigdata`:**
  - `schema_migrations` vai até a `0143` (39 aplicadas);
  - o índice da 0142 não existe;
  - schema `login` presente;
  - 0 e-mails duplicados por caixa, 1 usuário, nenhuma carga rodando, 4,3 GB.
- **Railway `mydata`, serviço `Postgres` (imagem `postgres-ssl:18`):**
  - volume com 12,9 de 50 GB;
  - memória com 1,97 de 2,0 GB.
  - À parte: o `mydata-cron` (outro projeto) está CRASHED desde 18/11. Não é do Segue o Voto; não mexi.
- **Vercel:**
  - #61 com 6 checks verdes;
  - domínio `misconfigured: true`;
  - zona da Vercel pronta com ALIAS no apex e no `*`.

## Pendências do dono, em ordem

Cada uma traz o comando, o aceite e a volta. O que vem antes desbloqueia o que vem depois.

| # | O quê | Comando ou onde | Aceite | Volta | Desbloqueia |
|---|---|---|---|---|---|
| B1 | `SITE_URL` de produção | Vercel, Production: `SITE_URL=https://www.segueovoto.com.br`, depois redeploy | valor conferido no painel; depois do B2, `/robots.txt` mostra `Sitemap: https://www.segueovoto.com.br/sitemap.xml` | valor anterior | merge da #61 |
| B2 | Merge da #61 | `gh pr merge 61 --repo AlexandreCamerini/replica --merge` | CI do `main` verde; `/robots.txt` com 200 | Instant Rollback na Vercel | B18 |
| B3 | DNS | registro.br, Alterar servidores DNS: `ns1.vercel-dns.com` e `ns2.vercel-dns.com` (`replica/runbook-dominio.md`) | `get_domain_config` com `misconfigured: false`; `www` com 200 e certificado | voltar aos servidores do Registro.br | site no domínio; B5; B8 |
| B4 | Supabase Auth | Site URL e Redirect URLs com o `www` | login completo no `www` | valores anteriores | login no domínio |
| B5 | Turnstile | hostnames `www.segueovoto.com.br` e `segueovoto.com.br` na chave de produção | widget carrega em `/entrar` | tirar os hostnames | login no domínio |
| B6 | `REVALIDATE_URL` (é **secret**, não variável: `etl.yml` e `etl-pauta.yml` leem `secrets.REVALIDATE_URL`) | `gh secret set REVALIDATE_URL --repo AlexandreCamerini/replica --body https://www.segueovoto.com.br/api/revalidate` | `gh secret list` mostra a data nova; a próxima carga revalida sem erro | valor anterior | |
| B7 | 0142 e 0144 no Supabase | `MIGRATE_ATE=0144 bash etl/deploy/prod-migrate.sh` (pendentes listadas: só 0142 e 0144) | `select count(*) from schema_migrations where filename in ('0142_drop_expenses_supplier_doc_idx.sql','0143_login_pg.sql','0144_login_codes_nonce.sql')` = 3 | `alter table login.codes drop column nonce_hash; delete from schema_migrations where filename = '0144_login_codes_nonce.sql';` | corte |
| B8 | Resend | criar o domínio no Resend; gravar os registros SPF, DKIM e DMARC na zona da Vercel (pelo painel, ou eu gravo pelo MCP com o seu "vai"); chave só de envio | domínio verificado no Resend | apagar os registros | B9 |
| B9 | Env de e-mail | `AUTH_PROVIDER_ALVO=pg bash etl/deploy/config-producao.sh` (`RESEND_API_KEY`, `AUTH_EMAIL_FROM`) | variáveis presentes em Production | `vercel env rm` | corte |
| B10 | Roles no Railway | `bash db/railway/configurar-dono.sh` | `psql` como cada role funciona | runbook §1 | ensaio |
| B11 | Firewall | `replica/firewall-regras.md`, regra 1 | o 21º pedido seguido com `Next-Action` é recusado, em qualquer caminho | desligar a regra | corte |
| B12 | Memória do Postgres do Railway | subir o limite (custo) ou provar no ensaio que 2 GB bastam sob carga | pré-voo 4 = sim | voltar o limite | corte |
| B12b | Push, PR e merge desta branch (antes do ensaio) | depois do B2: `git -C /Users/acamerini/replica push -u origin claude/pendencias-autonomas`, PR com base no `main`, merge com o CI verde | CI verde; com `MAINTENANCE=1` num Preview, aviso em `/` e em `/entrar` | fechar o PR, ou reverter o merge | B13 e B14: sem isto, `MAINTENANCE=1` em produção não faz nada e a cópia roda sem a checagem por atividade |
| B13 | Ensaio P2 | `railway-copy.sh --db civico_ensaio --refazer` e `ensaio-validar.sh` (runbook §2); `MAINTENANCE=1` num Preview | critérios do §2 e pré-voo 3 e 9 | `--refazer` de novo | corte |
| B14 | Corte P3 | `replica/runbook-railway.md` §7 (pré-voo, 9 passos, volta) | os 9 passos e 24 h de observação | volta do §7 | B15 a B17 |
| B15 | 0150 a 0158 no Railway | `replica/runbook-migracoes-producao.md`, Momento B | aceite do Momento B | coluna "Volta" | B16 |
| B16 | Executor e central `admin.` | `etl/executor-container.md`; projeto Vercel `admin.` (`replica/admin-coleta.md`, subseção 6); CNAME `admin` na zona; regra 2 do firewall | central abre em `admin.segueovoto.com.br` com TOTP | apagar o projeto e o registro | |
| B17 | Provas sem navegador | `cd web && node e2e-admin/sem-navegador.mjs` e `node e2e-admin/sem-rede-externa.mjs` (recriam `admin_coleta_c7`, que é local e sintético) | "RESULTADO: tudo passou" | n/a | evidências da central atualizadas |
| B19 | Arrumação local | primeiro atualizar o `main` do checkout principal (`git -C /Users/acamerini/replica switch main && git -C /Users/acamerini/replica pull`); depois o comando abaixo. `-d` compara com o `main` local (ou o upstream de cada branch) e recusa a que não estiver contida nele | as 61 branches da lista somem; as 20 presas a worktree continuam, de propósito | as branches continuam no remoto até apagar lá | |

## Branches locais já contidas no `origin/main`

Levantadas em 19/11/2026, sem apagar nada. Ver o fim deste arquivo, gerado na Etapa 7.

61 branches locais contidas no `origin/main` e sem worktree em uso (das 81 mergeadas, 20 estão abertas em algum worktree e ficam fora). Comando de B19, só com `-d` (recusa o que não estiver mergeado):

```bash
git -C /Users/acamerini/replica branch -d claude/actions-consumo-medido claude/amazing-ramanujan-2df536 claude/authorize-session-outside-sandbox-e8fdd9 claude/backend-audit-etl-3ab95d claude/backlog-u06-u15-ops claude/brave-elbakyan-2ad8ee claude/ci-e2e-so-web claude/crons-noturnos-inicio-janela claude/decisao-autores-lista claude/design-consent-63af20 claude/drop-indice-supplier-doc claude/epic-kowalevski-b579af claude/escolha-por-partido-d330 claude/etl-bug-052-cota-transacao claude/etl-fase1-run-record claude/etl-reposicao-janela-noturna claude/fase1-auditoria-design claude/fase1-dividas-d324 claude/fase1-jornada-eleitor claude/fase1-nav-390 claude/fase2-atos-repetidos claude/fase3-ordem-nomes claude/fase4-carregamento claude/handoff-entra-project-c08691 claude/mensagem-sessao-7d8244 claude/pacote-c-municipal-6be164 claude/pacote-d-congresso-51c417 claude/pacote-e-prova-fd3846 claude/pendencias-ab-c16c18 claude/perf-testes-upsert claude/politicometro-replica-update-5c4162 claude/prod-restore claude/promove-direcao-2 claude/promover-direcao-2 claude/quem-representa-redesign-e001f1 claude/registro-execucao-2026-11 claude/replica-data-flow-addb49 claude/replica-skill-diff-3e9942 claude/revisao-final-5f4bd0 claude/segue-o-voto-d2 claude/segue-voto-plano-execucao-7a85ac claude/sv-sigo-httponly claude/topo-desktop claude/topo-desktop-fecho claude/vanity-engineering-review-pr-merge-85a26a claude/vigia-fora-do-actions fix33-datas worktree-agent-a374d0e188a5e00db worktree-agent-a380f7810cc9e7034 worktree-agent-a419c630b3beb4e26 worktree-agent-a74bbb4072e08d880 worktree-agent-a7ee4bba60429e725 worktree-agent-a8a285e5a64fc3dfd worktree-agent-aa31e4e49ccf16b2c worktree-agent-aa57ad2412582ed9b worktree-agent-ab8523fcf50d2b95f worktree-agent-aba6ec04f9dac57a7 worktree-agent-abfc4485f06ed84ae worktree-agent-ad59b78fab5803ba7 worktree-agent-ad6bc5fe6d724eed3 worktree-agent-aeb1ab1b172749a46 
```

## Execução do roteiro do eleitor (26/11/2026)

Plano aprovado: `~/.claude/plans/peaceful-finding-yeti-of-729cfe37-b397-4402-ac11-716d46e7fe0e.md`. Roteiro: `replica/roteiro-eleitor-2026-11.md`. O hook de sessão autônoma bloqueou a pergunta ao dono; cada ponto abaixo seguiu a opção mais conservadora e reversível.

| # | Decisão | Opção escolhida | Motivo | Como desfazer |
|---|---|---|---|---|
| D-P1 | Onde rodar a execução | Neste sandbox, com `scripts/entregar-fatia.sh` e `scripts/entregar-lote.sh` (um comando por lote no Mac do dono). Sessão na nuvem fica como alternativa pronta | O sandbox não tem push, `gh` nem leitura de CI; abrir sessão na nuvem é ação do dono | Dizer "nuvem": o prompt da §8 do plano sobe como sessão em nuvem |
| D-P2 | Merge em produção | O agente nunca mescla. Os scripts só mesclam com `--baixo-risco` **e** `--mesclar` (fatia) ou `--mesclar-baixo-risco` (lote), ambos desligados por padrão e escolhidos pelo dono | Mesclar em `main` publica no site; é ação irreversível pela regra da sessão | O dono roda o script sem as flags |
| D-P3 | Dado novo (F7 teto da cota, F9 tabela de status real, F10 custo das casas) | Só estrutura e lacuna nomeada; o dado entra depois, conferido contra a fonte. Consultas de leitura ficam prontas para o dono | Sem credencial de banco autorizada, e valor sem conferência seria desinformação com selo de oficial | Autorizar leitura do `civico_ensaio` e de fontes públicas oficiais |
| D-P4 | Auditoria de UX/UI | Corrige o que é mensurável (contraste, alvo de toque, foco, ordem, rótulo, texto fora do padrão de neutralidade); o que é gosto vira lista para o dono | Cada correção é um commit pequeno e reversível | Pedir só o relatório |
| D-P5 | Scripts de entrega | Idempotentes (pulam o que já foi feito, limpam cherry-pick vazio), sem `--force`, sem segredo, sem apagar branch, com modo seco (`ENTREGA_SECO=1`) | A repetição de comandos no celular gerou PRs duplicadas (#68) e cherry-picks vazios | Apagar `scripts/entregar-*.sh` |

Pendências do dono desta execução (não bloqueiam o resto): autorizar leitura do `civico_ensaio` e de fontes oficiais (F7, F9, F10); domínio no Resend e revisão da D316/D317 (F13); decisão aberta da lista de 44 px em `/votacoes` (D343); rodar o script de entrega e, se quiser, mesclar.

## D359 · fatia 2 (27/11/2026): 301 de /p/, /votacoes/:id e /quem

O hook de sessão autônoma bloqueou a pergunta ao dono; o ponto abaixo seguiu a opção mais conservadora e reversível.

| # | Decisão | Opção escolhida | Motivo | Como desfazer |
|---|---|---|---|---|
| D359-1 | 301 de `/p/:slug → /pessoa/:slug` e remoção de `(v1)/p` | NÃO executada; fica pendente do dono | `replica/comparativo-v1-sv.md` mostra funções só do perfil antigo (custo do mandato, salário acumulado, emendas de todos os anos, assembleias, cota por sucessão, comparar). Cerca de 25 specs e2e testam esse conteúdo. Redirecionar apaga função até migrá-la, e reescrever os specs exige Playwright, que não abre neste sandbox | Dizer "301 de /p/": migro as funções ou aceito perdê-las, e reescrevo os specs com Playwright pelo terminal |
| D359-2 | 301 de `/votacoes/:id` e `/quem` | Também pendente: mesmo risco de paridade (os specs `f07`, `d-congresso`, `w3a-sapl-secretas` e 9 sobre `/quem` testam o conteúdo antigo) | Sem verificar o `(sv)` equivalente por spec, o ganho (poucos robôs nessas rotas) não paga o risco | Idem |
| D359-3 | O que já cobre a carga medida | Fatia 1 (commit d77eabc): robots, noindex em `*.vercel.app`, rodapé `nofollow` | Reversível por revert e sem perda de função | `git revert d77eabc` |

Pendências do dono: regra de limite para robôs no firewall da Vercel (o lugar certo para segurar `/p/<slug>` sem apagar função); conferir na aba Firewall quem são os robôs; decidir entre migrar as funções do perfil antigo para o `(sv)` ou aceitar perdê-las; `pool_size` no Supabase (pode ter custo).

## D359 · custo zero e atualização no máximo diária (27/11/2026, pedido do dono)

| # | Decisão | Opção escolhida | Motivo | Como desfazer |
|---|---|---|---|---|
| D359-4 | Robô declarado em `/p/*` e `/sugestoes` | 308 por user agent no `next.config.ts` (`redirects()` com `has: user-agent`) para `/pessoa/:slug` e `/`. Não pega WhatsApp, X, Telegram, Facebook, Slack, LinkedIn nem Discord (cards de link) | O roteador da Vercel responde sem acionar função nem banco; pessoas continuam no perfil antigo; sem plano pago nem firewall | `git revert` do commit |
| D359-5 | Cache | `CACHE_TTL_S` 1 h → 24 h; `revalidate` de `/no-seu-bolso`, `/proposta/[key]` e `/pauta` 10 min → 24 h; `s-maxage` das APIs `people` 1 h/10 min → 24 h | Menos regeneração, menos leitura de banco e menos função. A ETL revalida por tag, o TTL é só rede de segurança | Voltar os valores |
| D359-6 | Agenda da pauta | `etl-pauta.yml` de ~45 disparos por dia útil para 1 por dia (08:00 BRT); aviso de pauta velha de 24 h para 36 h (`web/src/lib/pauta.ts`) | Minutos do Actions em repositório privado são pagos (D274); 36 h evita aviso falso por atraso do agendador | Restaurar os 3 crons |
| D359-7 | Rascunho por IA | `etl-rascunho.yml` fica com o disparo das 08:30 (lote, 50% do preço); o das 14:30 (síncrono) saiu. Teto de 20 para 10 chamadas por dia | Cada chamada à API da Anthropic custa dinheiro | Restaurar o cron `30 17 * * 1-5` |
| D359-8 | `etl.yml` (a cada 3 h mais as 2 janelas de Senado e Câmara) | NÃO alterado; pendente do dono | A cadência de 3 h está amarrada a `schedule.py` (`TICK_*`), `web/src/lib/sources.ts` e `test_schedule.py`, e às réguas de prazo do alerta (20 h Câmara/Senado, 36 h site). Mudar só o cron geraria alerta falso. Cortar para 1x/dia pede mudar as 3 constantes e o teste juntos | Dizer "ETL 1x por dia": altero cron, `TICK_*`, `sources.ts` e o teste |
| D359-9 | `vercel.json` cron `/api/cron/vigia` | Já é 1x/dia (00:45 UTC); mantido | Dentro do pedido | n/a |

Não medido: efeito do redirect por user agent (robô que finge ser navegador não é pego; o regex usa lookahead e só foi validado por teste unitário e pelo `routes-manifest`); custo real de cada item (a fatura da Vercel e do GitHub Actions é do dono).
Conferir no Preview: `curl -sI -A "Googlebot" https://<preview>/p/algum-slug` deve dar 308 para `/pessoa/algum-slug`; com `-A "Mozilla/5.0 Safari"` e com `-A "WhatsApp/2.0"` deve dar 200.

## D359 · ETL principal 1x por dia (27/11/2026, autorizado pelo dono; substitui o D359-8 "pendente")

| # | Decisão | Opção escolhida | Motivo | Como desfazer |
|---|---|---|---|---|
| D359-10 | Cron do `etl.yml` | Uma linha só: `1 8 * * *` (08:01 UTC = 05:01 BRT, todos os dias). Saíram `17 */3 * * *`, `31 3 * * 2-6` e `1 8 * * 2-6` | Corta de ~10 disparos por dia para 1. Domingo e segunda entram porque o prazo do site é 60 h e a janela de sábado a terça já passaria disso | Restaurar os 3 crons e as constantes abaixo |
| D359-11 | Constantes da agenda | `TICK_HOUR=8`, `TICK_MINUTE=1`, `TICK_EVERY_H=24` em `schedule.py`; `SCHEDULER_HOUR/MINUTE/EVERY_HOURS` iguais em `web/src/lib/sources.ts`; `next_tick` e `nextSchedulerTick` passaram a respeitar a hora-base | A "próxima leitura prevista" do rodapé continua certa (valor diário às 05h BRT) | Voltar a `TICK_MINUTE=17`, `TICK_EVERY_H=3`, hora-base 0 |
| D359-12 | Prazo do site para Câmara e Senado | `maxAge` 36 h → 60 h (`schedule.MAX_AGE_H`, `sources.ts`, retrato `agenda.json`). `everyHours` fica 20 | Com 1 chamada por dia, 60 h = um dia mais uma chamada perdida (o cron do GitHub pula disparos). 36 h daria alerta falso a cada atraso | Voltar a 36 |
| D359-13 | Janela noturna do Senado (00:30–02:00 BRT) | Sem disparo próprio: às 05:01 BRT ela já fechou e a leitura entra como reposição (D318), sem alerta. A janela da Câmara (05:00–07:00) segue coberta | Não há como ler às 00:31 e às 05:01 com 1 chamada por dia | Restaurar o cron `31 3 * * 2-6` |

Verificado: `chk` das constantes, do cron e de 120 pares carimbo×cadência contra o `sources.ts` real (node) e contra `schedule.next_read`; retrato `agenda.json` igual ao vivo; testes unitários do site 422/422.
Não verificado: o `pytest` de `etl/tests` não rodou (sem pytest no `.venv` e sem rede para o PyPI neste sandbox); o CI roda. Efeito real nos minutos do GitHub Actions e no frescor medido: só depois de alguns dias.
Risco aceito: se o GitHub pular o disparo de um dia, a fonte envelhece até 48 h e o site continua "no prazo" (limite 60 h); duas perdas seguidas acendem o alerta.
