# Runbook: migrações de produção

Este arquivo tem duas partes. A primeira, logo abaixo, cobre a **0142, a 0143 e a 0150 a 0157** (escrita em 18/11/2026; nada aplicado). A segunda, mais abaixo, é o runbook anterior, da 0130, 0131, 0140 e 0141 (10/11/2026), mantido como estava.

# Parte 1: 0142, 0143 e 0150 a 0157

Estado: **não executado**. Nenhuma destas foi aplicada em produção. Elas vão em **dois momentos**, em bancos diferentes:

| Momento | Banco | Migrações | Por quê |
|---|---|---|---|
| A. Antes do corte | Supabase (produção atual) | 0142 e 0143 | a 0143 cria o schema `login` que o provedor `pg` usa; precisa estar na origem para o dump levar `schema_migrations` coerente (`runbook-railway.md`, §1, item 4) |
| B. Depois do corte | Railway (`civico`) | 0150 a 0157 | o admin de coleta e a central; só fazem sentido no banco que fica |

`etl/deploy/prod-migrate.sh` aplica **todas** as pendentes de uma vez. Para o momento A, use `MIGRATE_ATE=0143`: o script lista e aplica só até a 0143, e as seguintes continuam pendentes.

## O que cada migração faz

| Migração | Efeito | Toca tabela existente? | Risco | Volta |
|---|---|---|---|---|
| `0142_drop_expenses_supplier_doc_idx` | `drop index if exists expenses_supplier_doc_idx` | `expenses` (só o índice) | Nenhum em produção: o índice já foi removido à mão (D314), vira no-op | `create index expenses_supplier_doc_idx on expenses (supplier_doc);` |
| `0143_login_pg` | schema `login` com `codes` e `sessoes_validas_desde`; grants só ao `web_writer` | não | Baixo: aditiva, fora do PostgREST | `drop schema login cascade;` (antes da 0157) |
| `0150_admin_coleta` | 11 tabelas `adm_*` com RLS sem policy; gatilhos de estado; **gatilhos de override em `sapl_houses`, `data_coverage` e `mandate_contacts`**; linha `curadoria` em `sources` | **sim, três tabelas que o ETL grava** | **Médio.** Sem linha em `adm_overrides` o gatilho sai na primeira instrução e nada muda, mas passa a rodar em toda escrita dessas tabelas. Os gatilhos não são `security definer`: o role que grava precisa ser dono ou ter `BYPASSRLS` (ver pré-checagem) | `drop trigger adm_override on sapl_houses;` (idem `data_coverage` e `mandate_contacts`) desliga o mecanismo; as tabelas `adm_*` podem ficar |
| `0151_admin_coleta_colisoes` | 3 colunas em `adm_overrides`; refaz as funções de override da 0150 | só `adm_*` | Baixo | refazer as funções com o corpo da 0150 |
| `0152_admin_coleta_endurece` | refaz `adm_decisoes_guard`; 2 gatilhos em `adm_*`; **gatilho `adm_reaponta_override` em `mandate_contacts`** (`after update of mandate_id`) | sim, `mandate_contacts` | Baixo: só dispara quando `merge_person` move contatos | ver cabeçalho do arquivo |
| `0153_admin_central` | **cria o role `admin_central`** (`nologin`) se não existir; tabela `adm_pedidos_decisao`; grants de leitura a ele em `adm_*` e em 11 tabelas de domínio; policies | só grants | Baixo. No Railway o `bootstrap.sql` já cria o role `nologin`: aqui vira no-op | `drop owned by admin_central; drop role admin_central;` e `drop table adm_pedidos_decisao;` |
| `0154_admin_central_criado_em` | policy restritiva de `criado_em` nos pedidos | não | Baixo | `drop policy admin_central_criado_agora on ...` (duas tabelas) |
| `0155_admin_central_criado_relogio` | idem, pelo relógio | não | Baixo | `drop policy admin_central_criado_relogio on ...` |
| `0156_admin_admins` | `adm_admins` e `adm_admins_log`; colunas `por_*` nos pedidos; gatilho de identidade; **`revoke select on identity_match_queue from admin_central`** e grant por coluna sem `raw` | só grant em `identity_match_queue` | Baixo | ver cabeçalho do arquivo |
| `0157_login_central` | `login.central_codigos` e `login.central_fatores`; gatilho `central_fator_protege`; grants só ao `admin_central` | não (schema `login` da 0143) | Baixo | `drop table login.central_fatores, login.central_codigos; drop function login.central_fator_protege();` |

## Momento A: 0142 e 0143 no Supabase (antes do corte)

Pré-checagem, na URI de escrita do Supabase:
```sql
select max(filename) from schema_migrations;          -- anotar; esperado 0141_drop_votes_index_duplicado.sql
select count(*) from ingest_runs where status = 'running';  -- esperado 0
select to_regclass('public.expenses_supplier_doc_idx');      -- esperado nulo (D314: já removido)
```
Se o `max(filename)` vier abaixo da `0141`, **pare**: a 0130 a 0141 estão pendentes e seguem a Parte 2 deste arquivo antes de tudo.

Execução:
```bash
MIGRATE_ATE=0143 bash etl/deploy/prod-migrate.sh
```
Na lista de pendentes devem aparecer só `0142` e `0143`. Qualquer outra: responda `N` e olhe antes.

Aceite:
```sql
select max(filename) from schema_migrations;                 -- 0143_login_pg.sql
select count(*) from pg_tables where schemaname = 'login';   -- 2
select has_table_privilege('web_writer', 'login.codes', 'INSERT');  -- true
```
O site continua com `AUTH_PROVIDER=supabase`: nada muda para o usuário.

## Momento B: 0150 a 0157 no Railway (depois do corte)

Pré-requisitos: corte feito e estável (`runbook-railway.md`, §7); backup lógico do `civico` tirado no mesmo dia (§6).

1. **Escritores pausados**, como no corte (`runbook-railway.md`, §3): workflows do ETL desligados e launchd do SAPL parado. Os gatilhos da 0150 entram em tabelas que o ETL grava.
2. **Quem é dono e quem grava** (conecte como `civico_etl`):
```sql
-- dono das tabelas que ganham gatilho e RLS: esperado civico_etl nas três
select c.relname, pg_get_userbyid(c.relowner) as dono from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relname in ('sapl_houses', 'data_coverage', 'mandate_contacts');
-- o role que o ETL usa no dia a dia é o mesmo dono, ou tem BYPASSRLS? (troque civico_etl pelo usuário da URI do ETL, se for outro)
select rolname, rolbypassrls from pg_roles where rolname = 'civico_etl';
-- já existe? (o bootstrap cria nologin)
select rolname, rolcanlogin from pg_roles where rolname = 'admin_central';
select max(filename) from schema_migrations;   -- esperado 0143_login_pg.sql
```
   Se o dono não for o role com que o ETL grava, e esse role não tiver `BYPASSRLS`, **pare**. Com a RLS da 0150 sem policy, os jobs falhariam com `permission denied` ou o override seria ignorado.
3. Execução (o script faz `SET ROLE civico_etl` fora do Supabase):
```bash
bash etl/deploy/prod-migrate.sh
```
   Pendentes esperadas: `0150` a `0157`, nessa ordem.
4. Aceite:
```sql
select max(filename) from schema_migrations;    -- 0157_login_central.sql
select count(*) from pg_tables where schemaname = 'public' and tablename like 'adm\_%';   -- 14
select count(*) from pg_trigger where tgname = 'adm_override' and not tgisinternal;      -- 3
select count(*) from adm_overrides;             -- 0 (sem override, o ETL grava como antes)
select has_table_privilege('admin_central', 'login.central_fatores', 'UPDATE'),
       has_table_privilege('web_writer', 'login.central_fatores', 'SELECT');           -- true, false
```
5. Reativar os escritores e esperar um `run-due` completo e um `derive.stats` sem erro. Conferir que `sapl_houses` e `data_coverage` foram atualizados (`max(updated_at)` ou o carimbo da carga).

Volta do momento B: os gatilhos de override (`drop trigger adm_override on ...`) desligam o único efeito sobre o ETL. O restante é aditivo e pode ficar; para desfazer por inteiro, siga a coluna "Volta" de trás para frente (0157 primeiro).

# Parte 2: aplicar as migrações 0130, 0131, 0140 e 0141 em produção (runbook anterior)

Estado: **não executado**. Produção (Supabase `bigdata`) está na `0120_raw_copy.sql`. Tudo abaixo foi conferido em leitura em 2026-11-10; nada foi escrito em produção.

## O que cada migração faz
| Migração | Efeito | Risco |
|---|---|---|
| `0130_verificacao_agentica` | colunas `verification`, `verifier_version`, `verified_by`, `withdrawn_note`; status `barrado` e `retirado`; constraints; gatilho `answer_drafts_guard` novo; tabela `pipeline_switches` (RLS, vazia); policy `public_read` passa a incluir `retirado` | Médio. Sem reversão simples (ver Reversão) |
| `0131_answer_drafts_grant_por_coluna` | `web_reader` deixa de ler as 26 colunas de `answer_drafts` e lê só 15 (sem `verification`, `model`, `reviewer`, custo, hash) | Baixo. Site atual só lê colunas que continuam permitidas |
| `0140_indices_fk` | 2 índices (`candidacies`, `party_observations`) | Baixo. Bloqueio de escrita nessas tabelas por poucos segundos |
| `0141_drop_votes_index_duplicado` | remove índice duplicado de `votes` (70 MB, 0 leituras) | Baixo. Existe cópia idêntica com 26.690 leituras |

## Fatos medidos em produção (somente leitura)
- `answer_drafts` tem 20 linhas, **todas `rascunho`**; nada publicado. O backfill `verified_by = 'pessoa'` da 0130 atinge 0 linhas.
- 92 tabelas em `public`, todas com RLS ligada. `anon` e `authenticated` têm grants de tabela (padrão do Supabase) mas a RLS os bloqueia: não é explorável hoje. Defesa em profundidade fica para depois (ver fim).
- Policy atual: `public_read` para `web_reader`, `status in ('publicado','substituido')`.
- Site lê de `answer_drafts` apenas: `id, body_id, prop_type, prop_number, prop_year, reviewed_at, answers, source_url, correction_note, replaces_id, status`.

## Ordem e regra de ouro
**Aplicar as migrações ANTES de fazer o merge do PR #18.** Motivos: o código novo de `revisar` grava `verified_by`, que só existe depois da 0130. E, entre a migração e o merge, **não rodar `civico-etl revisar`** com o código antigo: a 0130 exige `verified_by` em tudo que o público lê, e o código antigo não o grava.

## Pré-checagem (5 minutos)
1. Backup: confirmar PITR ativo no painel do Supabase (Database > Backups) e anotar o horário.
2. Nenhum job rodando e ETL pausado. Janela: seg a sex entre 23:00 e 08:00 (Brasília); ver `replica/runbook-pg-repack.md`. Pausar: `gh workflow disable etl-pauta.yml` (e `etl.yml`, `etl-rascunho.yml`).
```sql
select count(*) from ingest_runs where status = 'running';              -- esperado 0
select max(filename) from schema_migrations;                            -- esperado 0120_raw_copy.sql
select status, count(*) from answer_drafts group by 1;                  -- esperado só 'rascunho', 20
```
3. O PR #18 está verde no CI.

## Execução
```bash
bash etl/deploy/prod-migrate.sh
```
O script pede a URI de escrita (Session pooler, usuário `postgres`) com entrada oculta, lista as pendentes e pede confirmação. Esperado na lista: `0130`, `0131`, `0140`, `0141`, nessa ordem. Se aparecer qualquer outra, **pare e olhe antes de responder `y`**. Cada arquivo roda em transação própria; falha em um aborta e não aplica os seguintes.

## Verificação (aceite)
```sql
select max(filename), count(*) from schema_migrations;                  -- 0141_drop_votes_index_duplicado.sql
select count(*) from information_schema.columns where table_name='answer_drafts' and column_name in ('verification','verifier_version','verified_by','withdrawn_note');  -- 4
select count(*) from pg_trigger where tgname='set_updated_at' and tgrelid='answer_drafts'::regclass and tgenabled='O';  -- 1
select relrowsecurity from pg_class where relname='pipeline_switches';  -- true
select count(*) from pipeline_switches;                                 -- 0 (publicação por agentes desligada)
select pg_get_expr(polqual, polrelid) from pg_policy where polrelid='answer_drafts'::regclass;  -- inclui 'retirado'
select count(*) from pg_indexes where tablename='votes' and indexdef like '%(person_id, voting_event_id)%';  -- 1
```
Prova do grant por coluna (como `web_reader`, via a URI de leitura do site):
```sql
select id, answers, status from answer_drafts limit 1;   -- funciona
select verification from answer_drafts limit 1;           -- ERRO: permission denied
```
Site: `/`, uma página de político, `/comparar` e a página da pauta respondem 200; o bloco "Revisado por pessoa" não mudou. Reativar os workflows (`gh workflow enable ...`) e esperar um `derive.stats` completo sem erro.

## Reversão
- `0141`: `create index votes_person_id_voting_event_id_idx on votes (person_id, voting_event_id);`
- `0140`: `drop index candidacies_contest_election_idx, party_observations_party_id_idx;`
- `0131`: `grant select on answer_drafts to web_reader;`
- `0130`: **sem reversão de um comando.** Como `answer_drafts` só tem 20 rascunhos regeneráveis e nada publicado, o caminho seguro é restaurar o PITR para o horário anotado na pré-checagem. Não tentar desfazer constraint por constraint em produção.

## Depois (fora desta janela)
- Merge do PR #18 e deploy; só então rodar `civico-etl verificar` em ensaio (a publicação por agentes continua desligada: exige `VERIFICACAO_AGENTICA=on` **e** a linha em `pipeline_switches`, que fica vazia).
- Defesa em profundidade: `anon` e `authenticated` ainda têm grants de tabela em `answer_drafts` (e nas outras 91). A RLS os bloqueia hoje. Uma migração futura pode revogar com `revoke all on all tables in schema public from anon, authenticated` depois de confirmar que nenhum cliente usa a API REST do Supabase. Não incluída aqui por ser um escopo maior.
