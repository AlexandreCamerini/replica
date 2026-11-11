# Runbook: aplicar as migrações 0130, 0131, 0140 e 0141 em produção

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
