-- Administração de coleta, C1: acesso da central (replica/admin-coleta-plano.md, seção 4a; decisão AC-19 em replica/admin-coleta-decisoes.md).
--
-- O que faz:
--   1. Cria o role `admin_central` (`nologin`, sem senha, sem membership em nenhum role, sem atributo especial). Login e senha locais ficam em
--      `db/local/post_0003_admin_central.sql`, que só `db/migrate.sh --local` roda. Role é do CLUSTER: se o cluster for compartilhado com outro banco, o role aparece lá também;
--      por isso `if not exists`, como em 0003_web_writer.sql.
--   2. Cria `adm_pedidos_decisao`: a decisão pela tela é um PEDIDO, nunca uma linha em `adm_decisoes`. A validação (justificativa, candidato único, domínio do valor)
--      e a mudança de estado da pendência vivem em etl/civico_etl/admin/decisoes.py; o executor da CLI consome o pedido com `decisoes.decidir` e, se `aplicar`, `aplicar.aplicar`.
--      `adm_pedidos` (0150) tem check de tipo que não admite 'decisao' e não se altera: por isso a tabela nova. Não existe `por_tipo`: pedido pela tela é sempre de pessoa.
--   3. Concede ao `admin_central` e a mais ninguém: `usage` nos schemas `public` e `extensions` (o segundo, porque a leitura de `places` o exige; ver abaixo); `select` em TODAS as `adm_*` e em onze tabelas de domínio que a central lê; `insert` SÓ em `adm_pedidos` e `adm_pedidos_decisao`.
--      Nada de update, delete, truncate, references, trigger; nada em `pipeline_switches`, `corrections`, `people`, `profiles`, `follows`; nenhum grant de função
--      (só o EXECUTE que o Postgres dá a PUBLIC; `merge_person` tem revoke from public e continua fechada) e nenhuma sequence (ids são uuid).
--      `people`: nenhum grant, nem por coluna: o rótulo de identidade vem de `identity_match_queue` e `sources` (admin/vinculos.py), não de `people`.
--   4. Policies (a RLS está ligada em todas): uma de leitura `admin_central_le` (`for select to admin_central using (true)`) por tabela com select; uma de inserção
--      em `adm_pedidos` e em `adm_pedidos_decisao`, que só deixa entrar pedido na fila, sem andamento, sem erro, sem horário de execução e sem ligação a rodada/decisão.
--      Nenhuma policy `to public`.
--
-- Gatilhos: o role só faz `insert` em `adm_pedidos` e `adm_pedidos_decisao`. `adm_pedidos_guard` e `adm_pedidos_decisao_guard` são `before update`: não disparam em insert e
-- não leem outra tabela. Os gatilhos que leem tabelas (`adm_override_*`, `adm_exige_chave_agentes`, `adm_decisoes_guard`) estão em tabelas onde o role não escreve. As chaves
-- estrangeiras das duas tabelas são conferidas com o privilégio do dono da tabela referenciada: não exigem select do role.
--
-- É aditiva: um role, uma tabela, índices, uma função, um gatilho, grants e policies. Nenhuma coluna, função ou migração existente muda.
-- Nada disso é aplicado em produção nesta entrega: a central só sobe em ambiente local (guarda de web/src/lib/admin/guarda.ts).
-- Para desfazer: `drop owned by admin_central; drop role admin_central;` e `drop table adm_pedidos_decisao;`.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

-- =====================================================================
-- 1. Role
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'admin_central') then
    create role admin_central nologin;
  end if;
end $$;
grant usage on schema public to admin_central;
-- `extensions` (unaccent, pg_trgm): `select` em `places` (e em outras com índice por f_unaccent) falha com "permission denied for schema extensions" quando o planejador
-- simplifica a expressão do índice; o web_reader recebe o mesmo `usage` na 0001. Só `usage` no schema: nenhum `create`, nenhum grant de função (as de extensions são EXECUTE de PUBLIC por padrão).
grant usage on schema extensions to admin_central;

-- =====================================================================
-- 2. adm_pedidos_decisao
-- =====================================================================
create table adm_pedidos_decisao (
  id uuid primary key default gen_random_uuid(),
  pendencia_id uuid not null references adm_pendencias(id),
  acao text not null check (acao in ('aprovar', 'corrigir', 'descartar', 'pedir_confirmacao')),
  por_nome text not null check (btrim(por_nome) <> ''),
  justificativa text not null check (btrim(justificativa) <> ''),
  valor jsonb,
  aplicar boolean not null default false,
  chave_idem text not null check (btrim(chave_idem) <> ''),
  status text not null default 'na_fila' check (status in ('na_fila', 'em_execucao', 'concluido', 'falhou', 'interrompido')),
  decisao_id uuid references adm_decisoes(id),
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  batimento_em timestamptz,
  finalizado_em timestamptz
);
-- dois cliques = um pedido: o segundo só entra depois de o primeiro terminar
create unique index adm_pedidos_decisao_idem_uq on adm_pedidos_decisao (chave_idem) where status in ('na_fila', 'em_execucao');
create index adm_pedidos_decisao_ativos_idx on adm_pedidos_decisao (criado_em) where status in ('na_fila', 'em_execucao');
create index adm_pedidos_decisao_pendencia_idx on adm_pedidos_decisao (pendencia_id);
create index adm_pedidos_decisao_decisao_idx on adm_pedidos_decisao (decisao_id) where decisao_id is not null;
alter table adm_pedidos_decisao enable row level security;
comment on table adm_pedidos_decisao is 'Pedido de decisão feito pela central. Não é a decisão: o executor valida e grava a decisão com decisoes.decidir (e aplica, se `aplicar`), e registra o resultado em `decisao_id`.';

-- na_fila -> em_execucao -> concluido | falhou | interrompido; concluido, falhou e interrompido são finais (igual a adm_pedidos_guard)
create or replace function adm_pedidos_decisao_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
      (old.status = 'na_fila' and new.status = 'em_execucao')
      or (old.status = 'em_execucao' and new.status in ('concluido', 'falhou', 'interrompido'))) then
    raise exception 'adm_pedidos_decisao: transição % -> % não permitida', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists adm_pedidos_decisao_guard on adm_pedidos_decisao;
create trigger adm_pedidos_decisao_guard before update on adm_pedidos_decisao for each row execute function adm_pedidos_decisao_guard();

-- Mesmo revoke da 0150: a tabela nasce sem grant (a 0001 só concede às tabelas que existiam), mas no Supabase os privilégios padrão do schema
-- podem alcançar anon e authenticated. Só toca em role que existe.
do $$
declare r text;
begin
  foreach r in array array['web_reader', 'web_writer', 'anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.adm_pedidos_decisao from %I', r);
    end if;
  end loop;
end $$;

-- =====================================================================
-- 3. Grants e policies do admin_central
-- =====================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'adm\_%'
           union select unnest(array['sapl_houses', 'data_coverage', 'mandate_contacts', 'mandates', 'places', 'legislative_bodies',
                                     'offices', 'identity_match_queue', 'sources', 'ingest_runs', 'dataset_stamps', 'etl_schedule_attempts'])
  loop
    execute format('grant select on public.%I to admin_central', t);
    execute format('create policy admin_central_le on public.%I for select to admin_central using (true)', t);
  end loop;
end $$;

grant insert on adm_pedidos, adm_pedidos_decisao to admin_central;
create policy admin_central_insere on adm_pedidos for insert to admin_central
  with check (status = 'na_fila' and iniciado_em is null and batimento_em is null and finalizado_em is null
              and rodada_id is null and andamento is null and erro is null);
create policy admin_central_insere on adm_pedidos_decisao for insert to admin_central
  with check (status = 'na_fila' and decisao_id is null and erro is null
              and iniciado_em is null and batimento_em is null and finalizado_em is null);
