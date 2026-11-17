-- Prepara um database do Postgres central do Railway (compartilhado com outras apps) para receber o Segue o Voto.
-- Roda no database de DESTINO, com um superusuário do cluster:
--   psql "$URL_DESTINO" -X -v ON_ERROR_STOP=1 [-v pooler_role=<role do pooler>] -f db/railway/bootstrap.sql
-- Idempotente. Uma transação só: se a guarda abortar, nada foi criado nem alterado.
-- NUNCA vai para db/migrations/: o stub de `auth` abaixo sobrescreveria o auth.uid() nativo do Supabase, que segue sendo produção até o corte.
--
-- Regras do cluster compartilhado:
--  * só toca nos roles do Segue o Voto (lista abaixo); nenhum é superusuário, todos nascem NOLOGIN e levam a marca 'segueovoto'
--    (comment on role). A senha e o LOGIN são dados fora deste arquivo (runbook-railway.md), nunca versionados.
--  * role da lista que já exista sem a marca é de outra app: aborta antes de mexer em qualquer coisa.
--  * nada usa o nome do database: tudo vale para current_database(), e config de role é sempre `in database`.
\set ON_ERROR_STOP on
begin;

-- 0) Guarda --------------------------------------------------------------------------------------------------------------
do $guarda$
declare
  r record;
  m text;
  nomes constant text[] := array['anon','authenticated','service_role','web_reader','web_writer','admin_central','civico_etl'];
  permitidos constant text[] := array['web_writer','civico_etl'];
begin
  if not (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'bootstrap: rode com um superusuário (cria extensões e troca o dono do database); current_user = %', current_user;
  end if;
  -- Supabase: o stub de auth sobrescreveria o auth.uid() de verdade
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','supabase_auth_admin'))
     or exists (select 1 from pg_namespace where nspname in ('supabase_functions','realtime','storage','graphql'))
     or exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    raise exception 'bootstrap: este database parece ser Supabase (auth nativo); este arquivo é só para o Postgres do Railway';
  end if;
  for r in select oid, rolname, rolsuper, shobj_description(oid, 'pg_authid') as marca from pg_roles where rolname = any (nomes) loop
    if r.marca is distinct from 'segueovoto' then
      raise exception 'bootstrap: o role % já existe sem a marca ''segueovoto'': é de outra app. Nada foi alterado. Confirme com o dono do cluster e marque-o (comment on role % is ''segueovoto'') só se for do Segue o Voto.', r.rolname, r.rolname;
    end if;
    if r.rolsuper then
      raise exception 'bootstrap: o role % é superusuário; nenhum role do Segue o Voto pode ser', r.rolname;
    end if;
    for m in select u.rolname from pg_auth_members a join pg_roles u on u.oid = a.member where a.roleid = r.oid loop
      if m <> all (permitidos) and m <> current_user then
        raise exception 'bootstrap: o role % tem o membro % fora da lista permitida (%). Nada foi alterado.', r.rolname, m, permitidos;
      end if;
    end loop;
  end loop;
end
$guarda$;

-- 1) Roles ---------------------------------------------------------------------------------------------------------------
do $roles$
declare n text;
begin
  foreach n in array array['anon','authenticated','web_reader','web_writer','admin_central','civico_etl'] loop
    if not exists (select 1 from pg_roles where rolname = n) then execute format('create role %I nologin', n); end if;
    execute format('comment on role %I is %L', n, 'segueovoto');
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  alter role service_role bypassrls;  -- como no Supabase
  comment on role service_role is 'segueovoto';
end
$roles$;
grant authenticated to web_writer;      -- asUser(): set_config('role','authenticated')

-- 2) Configurações do database corrente (herdadas do Supabase) -----------------------------------------------------------
do $config$
declare db text := current_database();
begin
  execute format('alter database %I owner to civico_etl', db);
  execute format('alter database %I set search_path = "$user", public, extensions', db);
  -- no Supabase o timeout só valia pelo PostgREST (anon/authenticated); aqui o site conecta como web_reader/web_writer e a troca
  -- de role por set_config não carrega configuração de role: o limite vai para os roles que conectam
  execute format('alter role web_reader in database %I set statement_timeout = %L', db, '3s');
  execute format('alter role web_writer in database %I set statement_timeout = %L', db, '8s');
  execute format('alter role web_reader in database %I set idle_in_transaction_session_timeout = %L', db, '30s');
  execute format('alter role web_writer in database %I set idle_in_transaction_session_timeout = %L', db, '30s');
  -- só os roles do app conectam: o PUBLIC perde o CONNECT e cada um recebe o seu
  execute format('revoke all on database %I from public', db);  -- CONNECT e TEMP
  execute format('grant connect on database %I to web_reader', db);
  execute format('grant connect on database %I to web_writer', db);
  execute format('grant connect on database %I to admin_central', db);
  execute format('grant connect on database %I to civico_etl', db);
end
$config$;
\if :{?pooler_role}
  select format('grant connect on database %I to %I', current_database(), :'pooler_role') \gexec
\endif

-- 3) Extensões, no schema extensions (como no Supabase) ---------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role, web_reader, web_writer, admin_central, civico_etl;

-- 4) schema public: do civico_etl --------------------------------------------------------------------------------------------
create schema if not exists public;
alter schema public owner to civico_etl;
revoke create on schema public from public;
grant usage on schema public to anon, authenticated, service_role, web_reader, web_writer, admin_central;

-- 5) Stub de auth (o do Supabase não existe aqui): usuários do login `pg` e auth.uid() para as policies -----------------------
create schema if not exists auth authorization civico_etl;
alter schema auth owner to civico_etl;
create table if not exists auth.users (id uuid primary key, email text unique, created_at timestamptz not null default now());
alter table auth.users owner to civico_etl;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
alter function auth.uid() owner to civico_etl;
grant usage on schema auth to authenticated, anon, web_writer;
grant select, insert, update (email), delete on auth.users to web_writer;

commit;
