# Runbook: sair do Supabase para o Postgres central do Railway (corte do Segue o Voto)

Estado: **não executado**. P1 (código, scripts e testes locais) entregue na D332; o ensaio (P2) e o corte (P3) são do dono. Nada aqui foi rodado contra Supabase, Railway ou Vercel: os scripts novos só foram exercitados em databases do Postgres local.

Premissas declaradas (corrija se alguma estiver errada):
- Destino: database próprio do Segue o Voto no Postgres 18 central do Railway, que também serve `mydata` e `casacheia`. O database do corte se chama `civico`; o do ensaio, `civico_ensaio` (`--db civico_ensaio`). Nenhum script grava o nome `civico` fixo: tudo vale para o database de `--db`.
- Origem: Supabase `bigdata` (Postgres 17, ~4,2 GB medidos em 10/11). Só leitura durante a cópia.
- Cliente: `pg_dump` e `pg_restore` **18** (`brew install postgresql@18` e `PATH=/opt/homebrew/opt/postgresql@18/bin:$PATH`). A cópia só exige ≥ 17 (origem), mas o backup do destino (§6) e qualquer `pg_dump` do Railway exigem ≥ 18: o `pg_dump` recusa servidor de versão principal mais nova. O `psql` padrão do Homebrew é o 16 (achado do ensaio P2).

## 0. O que existe agora
| Arquivo | Para quê |
|---|---|
| `db/migrations/0143_login_pg.sql` | schema `login`: `codes` (códigos de acesso) e `sessoes_validas_desde` (revogação de sessão). Só aditiva, inofensiva no Supabase |
| `web/src/lib/auth/pg.ts` (+ `pg-core.ts`, `pg-store.ts`) | provedor `AUTH_PROVIDER=pg` |
| `db/railway/bootstrap.sql` | prepara o database de destino (roles, config, extensões, stub de `auth`, grants). Idempotente, uma transação, com guarda contra colisão |
| `db/railway/railway-copy.sh` | dump, preparação, restore como `civico_etl`, ANALYZE, com o tempo de cada etapa |
| `db/railway/railway-verify.sql` | contagens exatas e objetos, para `diff` entre origem e destino; seção `ambiente` só no destino |
| `etl/civico_etl/schedule.py` | a trava contra pooler agora também detecta mudança de `pg_backend_pid()` entre transações |

O provedor `supabase` continua intacto: a volta do corte é trocar `AUTH_PROVIDER`.

## 1. Ações do dono antes do ensaio
`bash db/railway/configurar-dono.sh --db civico_ensaio` faz os itens 1, 2 e 4 abaixo de forma guiada (senhas dos roles geradas e guardadas em `~/.config/segueovoto/railway-roles.env`, 0600; precisa do database já com o bootstrap, ou seja, depois do primeiro `railway-copy.sh`). Não foi executado no P1.

1. **Roles com login e senha**, no Railway, fora de qualquer arquivo versionado. Depois do bootstrap os roles nascem `nologin`:
   ```sql
   alter role web_reader  login password '<gerada>';
   alter role web_writer  login password '<gerada>';
   alter role civico_etl  login password '<gerada>';
   alter role admin_central login password '<gerada>';  -- só quando a Central admin for ligada
   ```
   Se houver pooler (ver §4), o role dele entra por `--pooler-role <role>` no `railway-copy.sh` (CONNECT no database; nada mais).
2. **Resend**: domínio do remetente verificado; chave com permissão só de envio. Vercel (Production): `RESEND_API_KEY`, `AUTH_EMAIL_FROM`. `AUTH_PROVIDER_ALVO=pg bash etl/deploy/config-producao.sh` guia isso (e pula os estágios do Supabase Auth). `SESSION_SECRET` já tem 64 hex (mínimo do `pg` é 32).
3. **Turnstile continua em `account.ts`** (ver §8, ponto 1).
4. **`0143` no Supabase antes do corte** (`bash etl/deploy/prod-migrate.sh`). Sem ela o script cria o schema `login` no destino a partir do arquivo, mas `schema_migrations` do dump diria "pendente" e o `diff` do `verify` mostraria o `login.*` só no destino.
5. Cliente `railway` logado e ligado ao projeto (`railway login && railway link`). O script lê a URI com `railway variables --service "${RAILWAY_PG_SERVICE:-Postgres}" --kv` (`DATABASE_PUBLIC_URL`, senão `DATABASE_URL`), sem imprimir. A URI é de superusuário do cluster: o bootstrap precisa disso (cria extensões, troca o dono do database).

## 2. Ensaio (P2), repetível quantas vezes for preciso
```bash
# origem: URI de leitura do Supabase, pedida oculta (ou ORIGEM_URL no ambiente do shell, nunca em arquivo)
bash db/railway/railway-copy.sh --db civico_ensaio --refazer --aceitar-escritores 2>&1 | tee ensaio-$(date +%F-%H%M).log
```
`--aceitar-escritores` (P2): no ensaio os escritores de produção continuam ligados; a opção troca o aborto da trava S7 por aviso, imprime o início do dump e só vale para database com `ensaio` no nome (recusada para `civico`). No corte, sem ela.

Medições (S4, S13), só leitura: `bash db/railway/medir-conexoes.sh amostrar --db civico_ensaio` num terminal à parte durante login, e2e e `run-due` (Ctrl-C imprime o pico por database/usuário e o `max_connections`); `disco marcar antes.txt` e `disco comparar antes.txt` em volta do `run-due`.
`--refazer` apaga **só** o database `civico_ensaio` (confirmação digitada), recria, roda o `bootstrap.sql`, copia `auth.users`, restaura e roda ANALYZE. O script recusa se houver conexão de escritor conhecido na origem (roles `web_writer`, `web_reader`, `admin_central`, `civico_etl`, `application_name` com "civico", ou qualquer sessão com trava consultiva: a agenda do ETL segura uma) e lista as conexões. Sem `--refazer` ele reaproveita o database, mas apaga `public` e `login` antes (confirmação digitada).

Conferência (origem e destino com a mesma saída):
```bash
psql "$ORIGEM"  -X -At -f db/railway/railway-verify.sql > origem.txt
psql "$DESTINO" -X -At -f db/railway/railway-verify.sql > destino.txt
diff origem.txt destino.txt && echo IDÊNTICO
psql "$DESTINO" -X -At -v ambiente=on -f db/railway/railway-verify.sql   # config por database, datacl, dono
```
**Atalho:** `bash db/railway/ensaio-validar.sh snapshot antes.txt` **antes** da cópia e, depois dela, `bash db/railway/ensaio-validar.sh validar --db civico_ensaio --antes antes.txt` roda tudo abaixo (outras apps intactas, diff origem×destino, ambiente, testes por role com o timeout de 3 s de verdade, tamanho, conexões e tempo de consulta fria) e sai com 1 se algo falhar. O login ponta a ponta e o preview da Vercel continuam manuais.

Critérios de aceite do ensaio (todos):
- `diff` vazio, ou toda linha diferente explicada por escrito (ver §5);
- `ambiente`: `public_pode_conectar false`, `datacl` sem `=...` de PUBLIC, `search_path`, `statement_timeout` 3 s (`web_reader`) e 8 s (`web_writer`) e `idle_in_transaction_session_timeout` presentes, `dono_do_database civico_etl`, `objetos_de_public_com_outro_dono 0`;
- cópia de outra app intacta: comparar `pg_roles`, `pg_auth_members` e `pg_db_role_setting` dos roles que não são do Segue o Voto antes e depois (o bootstrap só toca nos seus roles);
- login ponta a ponta contra o destino (e-mail real, código, cookie, sair, apagar a conta de teste);
- site de preview da Vercel apontando para o destino (`DATABASE_URL` do Preview): páginas principais sem timeout de 3 s (ver §4, aquecimento).

### O que medir no ensaio (preencher as colunas)
| Item | Como | Medido |
|---|---|---|
| Tempo por etapa e total | a tabela que o script imprime no fim | |
| Tamanho do dump | linha do dump no log | |
| Conexões do site | durante carga (navegar 5 min, ou um teste de carga curto): `select usename, count(*) from pg_stat_activity where datname = current_database() group by 1` | |
| Crescimento de disco de um `run-due` completo | `select pg_database_size(current_database())` antes e depois de `civico-etl run-due` contra o `civico_ensaio`; some o WAL (volume do Railway) | |
| Folga de disco do volume | painel do Railway (volume compartilhado com as outras apps) | |

Regra para a janela do corte: reservar 2× o total medido, e abortar (voltar, ver §7) se o restore passar de 1,5× o medido.

## 3. Escritores a pausar e reativar
Pausar **antes** de rodar a cópia do corte; reativar **depois** de trocar as URLs (e, na volta, depois de reverter as URLs).

| Escritor | Pausar | Reativar |
|---|---|---|
| `etl.yml` | `gh workflow disable etl.yml` | `gh workflow enable etl.yml` |
| `etl-pauta.yml` (cron de 30 em 30 min, seg-sex 08:00-22:30 BRT) | `gh workflow disable etl-pauta.yml` | `gh workflow enable etl-pauta.yml` |
| `etl-rascunho.yml` | `gh workflow disable etl-rascunho.yml` | `gh workflow enable etl-rascunho.yml` |
| `vigia.yml` (não escreve, mas alarmaria com o banco em trânsito) | `gh workflow disable vigia.yml` | `gh workflow enable vigia.yml` |
| Variável `ETL_SCHEDULE_ENABLED` (cinto e suspensório) | `gh variable set ETL_SCHEDULE_ENABLED --body false` | `gh variable set ETL_SCHEDULE_ENABLED --body true` |
| **Site em modo manutenção / login desligado** (pendente: não há chave de manutenção no código; o mais simples é pausar o deploy de produção apontando a rota de login para erro, ou fazer a janela com tráfego mínimo). Sem isso, um cadastro ou login durante a cópia grava `auth.users`/`profiles` depois do dump e se perde | decisão do dono no P2 | religar ao fim do passo 5 do §7 |
| Cron da Vercel `/api/cron/vigia` (`45 0 * * *` = 21:45 BRT) | não há botão: fazer o corte **fora** desse horário (janela seg-sex 23:00-08:00 BRT, ver `runbook-pg-repack.md`) e conferir no painel da Vercel que não há execução em curso. Se cair dentro, ele lê `DATABASE_URL`, não escreve | nada |
| launchd `org.civico.etl.sapl-prod` (Mac, minuto 47 de hora em hora) | `launchctl bootout "gui/$(id -u)/org.civico.etl.sapl-prod"` | `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.civico.etl.sapl-prod.plist"` (ou `bash etl/deploy/launchd-sapl-prod.sh install` depois de trocar a URI do Keychain) |

Conferir: `gh run list --limit 5` sem execução em andamento; `launchctl list | grep civico` sem o `sapl-prod`. A trava do `railway-copy.sh` é a segunda barreira: ela olha as conexões na origem e para.

## 4. Conexões do site: pooler ou pool pequeno
Na Vercel cada função abre as suas conexões; sem pooler, o limite de conexões do Postgres central (dividido com as outras apps) é o teto. Duas saídas:
- **Pooler (PgBouncer) em modo transação para o site**: serve a `web_reader`/`web_writer` (o site usa `prepare: false`, compatível). O ETL **não** passa por ele (trava de sessão); o `schedule.py` agora recusa quando o `pg_backend_pid()` muda entre transações. O role do pooler entra com `--pooler-role`.
- **Sem pooler**: `PG_POOL_MAX` e `PG_WRITE_POOL_MAX` em 1 ou 2 por função (`PG_POOL_MAX=2 PG_WRITE_POOL_MAX=1 bash etl/deploy/vercel-env-fix.sh` grava em Production). Meça no ensaio o pico de `count(*)` em `pg_stat_activity` e multiplique pelo número de instâncias simultâneas da Vercel; compare com `show max_connections` menos o que as outras apps usam. O número vira a decisão.
- **Aquecimento**: depois do restore o cache está frio e `statement_timeout = 3s` em `web_reader` derruba consulta lenta. Antes de anunciar: abrir 2 vezes as páginas principais (home, lista de pessoas, uma página de pessoa, estados) e conferir ausência de erro 500; consultas que estourarem 3 s a frio são achado do ensaio.

## 5. A 94ª tabela (93 de 94 idênticas no ensaio de 17/11)
Pendente de explicação **antes** do corte. Não sei qual era: o ensaio externo não guardou o nome. Como achar com o que existe agora: `diff origem.txt destino.txt` aponta a linha `public.<tabela> <contagem>`. Hipóteses em ordem de probabilidade, todas escritas por processo vivo durante ou depois do dump:
1. `page_views` (o site grava a cada visita): é a mais provável; some do `diff` com o site em modo de manutenção ou, no corte, porque o dump é feito com os escritores parados;
2. `etl_schedule_attempts`, `ingest_runs` ou `dataset_stamps` (agenda do ETL ou o launchd do SAPL rodaram entre o dump e a contagem);
3. `suggestions` ou `digest_deliveries` (formulário público e digest).
Regra: contagem diferente em tabela que **nenhum escritor toca** é falha da cópia e bloqueia o corte; em tabela de escritor, só vale com a janela de escritores pausados provada (`railway-copy.sh` recusa se houver conexão) e o `diff` vazio no ensaio feito sob essa condição. Se a diferença for de **estrutura** (contagem igual, `indices`/`policies` com outro hash), compare as definições: PG 17 e PG 18 podem deparsear diferente; confirme que é só formatação.

## 6. Backup e disco (o backup do Railway é do volume inteiro)
Restaurar o backup do volume voltaria também `mydata` e `casacheia`. Por isso o seguro do Segue o Voto é **lógico, por database**:
```bash
pg_dump "$DESTINO_CIVICO" -Fc --no-owner -f civico-$(date +%F-%H%M).dump   # antes do corte, e todo dia depois
pg_restore --list civico-*.dump | head                                      # conferir que abre
```
- Antes do corte: um dump do `civico` de destino (ele tem de estar vazio ou ser o ensaio promovido) **e** a origem continua intacta no Supabase (não apagar por pelo menos 14 dias; Supabase Pro tem PITR).
- Diário depois do corte: agendar fora do Railway (Mac via launchd ou GitHub Actions com a URI em secret), guardar 7 dias em disco local e 1 por semana fora da máquina. Agendamento pronto: `bash db/railway/backup-launchd.sh install` (URI do `civico_etl` no Keychain, agente `org.civico.backup.railway` às 03:20, dumps em `~/Backups/segueovoto`, confere cada dump com `pg_restore --list`, rotação de 7 diários + 4 domingos, alerta pelo webhook do ETL; `status` e `run-now` para acompanhar). Ainda **não instalado**: instale depois do corte, com a URI de produção. Cópia semanal fora da máquina continua manual.
- Alerta de disco: alerta do Railway no volume em 70% e 85%. Medir no ensaio quanto um `run-due` completo cresce o banco e o WAL (tabela do §2). Fazer conta: `folga / crescimento por run-due completo` em runs; se for menos que um mês de runs, pedir mais volume antes do corte.
- Tabelas que mais crescem: `expenses`, `votes`, `raw_*` (`replica/runbook-raw-storage.md`) e o `identity_repair_log`.

## 7. Sequência do corte (P3) e a volta
Janela: dia útil, 23:00-08:00 BRT, fora de 21:45 BRT. Antes (véspera): `0143` aplicada no Supabase; ensaio final com tudo verde; dump lógico do Supabase fora do Supabase; Resend testado; senhas dos roles criadas; anotar a versão atual do deploy de produção (para o Instant Rollback) e **como restaurar cada variável antigas** (as URIs do Supabase ficam no gerenciador de senhas, não em arquivo).

| # | Passo | Tempo (preencher com o ensaio) |
|---|---|---|
| 1 | Pausar escritores (§3) e conferir | ~5 min |
| 2 | `bash db/railway/railway-copy.sh --db civico` (use `--refazer` só se `civico` for do Segue o Voto e estiver vazio ou for o do ensaio) | restore medido × 1,5 de teto |
| 3 | `railway-verify.sql` nos dois lados, `diff` vazio, seção `ambiente` ok | ~3 min |
| 4 | Senhas e `login` dos roles (§1); testar `psql` como `web_reader`, `web_writer`, `civico_etl`: `show statement_timeout` (3s, 8s, vazio) | ~5 min |
| 5 | `DB_URL=<web_reader> bash etl/deploy/vercel-env-fix.sh` e a URI de escrita do `web_writer` em `DATABASE_WRITE_URL`; `AUTH_PROVIDER=pg`; `PG_*_POOL_MAX` (§4); redeploy de produção | ~10 min |
| 6 | Verificação ao vivo: home e pessoa sem erro, aquecimento (§4), login real, seguir e deixar de seguir, sair, apagar conta de teste | ~15 min |
| 7 | ETL: `bash etl/deploy/etl-db-secret.sh` (URI do `civico_etl`, com `?sslmode=require`), `launchd-sapl-prod.sh install` (Keychain), `civico-etl run-due --dry-run` contra o destino | ~10 min |
| 8 | Reativar escritores (§3) | ~3 min |
| 9 | Observação: 24 h de `vigia`, `gh run list`, log do launchd, disco, conexões | 24 h |

**Volta** (decidir em até 1 h depois do passo 5; depois disso há escrita só no Railway):
1. **Escritores continuam pausados** durante toda a volta.
2. Vercel: Instant Rollback para o deploy anotado (ele leva a configuração com que foi construído), e **em seguida** reverter as variáveis (`DATABASE_URL`, `DATABASE_WRITE_URL`, `AUTH_PROVIDER=supabase`, pool max) para os valores do Supabase: sem isso o próximo deploy volta a apontar para o Railway.
3. GitHub: `etl-db-secret.sh` com a URI do Supabase. Mac: `launchd-sapl-prod.sh install` com a URI do Supabase (a do Keychain).
4. Só então reativar os escritores (§3), na ordem inversa da pausa.
5. O que foi escrito só no Railway **não volta**: contas criadas pelo provedor `pg` não existem no Supabase Auth (a FK de `profiles` para `auth.users` impediria copiar os perfis). Com 1 usuário que nunca entrou, o prejuízo esperado é nulo; se houver mais usuários na hora, avisar e pedir novo login. Dados do ETL entre o corte e a volta são refeitos pela agenda.
6. O Supabase não foi alterado em nenhum momento (a cópia só lê), então nada a desfazer lá.

## 8. Furos e dívidas conhecidos (expostos de propósito)
0. **Achados da revisão independente (subagente opus) e o que foi feito.** Corrigidos neste PR: guarda no nível do database (o bootstrap só aceita database vazio ou marcado `segueovoto`, recusa `postgres` e `railway`; `--refazer` só apaga database marcado; `--sim` só com destino local); `ALTER DEFAULT PRIVILEGES` do Supabase fora do restore (`pg_restore -L`), roles que só aparecem em `FOR ROLE` não contam e o teste de "é Supabase" é por objetos do database, não por role do cluster; senha fora do argv (`PGPASSFILE` 0600); `SESSION_SECRET` separado entre Production e Preview com `AUTH_PROVIDER_ALVO=pg`; `railway-verify.sql` agora compara RLS e grants de tabela e coluna; logout apaga o cookie `__Host-` com os atributos certos; `deleteUser` apaga também `login.codes`; `--manter-dump` em pasta 0700. **Abertos:** (a) a checagem de escritores é pontual: não vê `supabase_auth_admin` (GoTrue) nem o ETL que conecta como `postgres` sem `application_name`, e conexões ociosas do Supavisor como `web_*` podem deixá-la vermelha; use o modo manutenção do §3 e, se a checagem travar só por conexão ociosa, encerre-as (`pg_terminate_backend`) conscientemente; (b) sem teto global nem por IP de envio de e-mail (só 3/h por endereço): custo e reputação do Resend; (c) `attempts` zera a cada novo envio (≈15 palpites/h por e-mail) e o cookie `otp_email` não é assinado; (d) duas verificações concorrentes com o código certo logam as duas (`consumeCode` incondicional); (e) o stub `auth.users` tem `email unique`: e-mail duplicado ou com caixa diferente na origem só quebra no `COPY`, depois do drop de `public` (pré-checar `count(*) - count(distinct lower(email))` na origem); (f) a trava de pooler é detecção de melhor esforço: PgBouncer com cliente sequencial costuma devolver o mesmo backend, então o §4 não deve ser lido como garantia; a proteção real é não apontar o ETL para pooler; (g) a guarda de roles não olha `rolcanlogin`/`rolcreaterole`/`rolcreatedb` de role já marcado nem se os nossos roles são membros de roles de outras apps.
1. **Turnstile em dobro.** `account.ts` já chama `verifyCaptcha()` antes do provedor (e o token é de uso único; é por isso que o captcha do Supabase Auth está desligado, ver `config-producao.sh`). Chamar `verifyCaptcha` de novo dentro do `pg.sendCode`, como pediu o plano, daria `timeout-or-duplicate` em todo login. O `pg` faz só a falha fechada sem resgatar o token (`captchaPresente`: produção sem `TURNSTILE_SECRET_KEY` ou sem token recusa). Se você preferir a verificação dentro do provedor, o ajuste é de uma linha em `web/src/lib/account.ts` (fora do escopo do P1).
2. **Revogação no mesmo segundo.** `sessoes_validas_desde` compara no segundo: um cookie emitido no mesmo segundo da revogação continua valendo (pedido do plano, e é o que faz o login logo depois de "sair de todos" funcionar).
3. **`CONNECT` revogado de PUBLIC no database.** Qualquer role novo de outra app que precise acessar o `civico` precisa de `grant connect` explícito; é o desenho.
4. **Roles citados no dump e inexistentes no destino** abortam a cópia (`--criar-roles-do-dump` cria `nologin` com a marca `segueovoto:dump`). Não testado aqui: no cluster local todos existiam.
5. **Restore como `civico_etl`**: as migrações futuras também têm de rodar com esse role (`prod-migrate.sh` faz `SET ROLE civico_etl` em host que não é Supabase), senão os objetos novos nascem com dono diferente e o `verify` acusa.
6. **Extensões** `uuid-ossp`, `unaccent`, `pgcrypto`, `btree_gist`, `pg_trgm` precisam existir na imagem do Postgres 18 do Railway; o bootstrap aborta se faltar alguma.
7. **`idle_in_transaction_session_timeout`** ficou em 30 s para `web_reader` e `web_writer` (o plano não deu o valor).
8. **Guarda do bootstrap**: aceita como membro dos roles do Segue o Voto, além de `web_writer` e `civico_etl`, o próprio usuário que rodou o bootstrap (quem cria role sem ser superusuário ganha a pertença automaticamente).
