-- Administração de coleta, F3-T1: identidade de admin nos pedidos da central (replica/reavaliacao-central-e-dominio.md, seções 2.3 e 6; AC-23 em replica/admin-coleta-decisoes.md).
--
-- O que faz:
--   1. `adm_admins`: quem pode operar a central (e-mail único em minúsculas, nome, `user_id` opcional do Supabase Auth, `ativo`). RLS ligada; o `admin_central` só lê
--      (grant `select` e policy `admin_central_le`); ninguém além do dono do banco escreve. Os roles do site não têm nada nela.
--   2. `adm_admins_log`: trilha só de acréscimo de toda mudança em `adm_admins` (quando, operação, linha antiga e nova em jsonb, `current_user`), alimentada por gatilho
--      `after insert or update or delete`; um gatilho `before update or delete` recusa qualquer alteração ou apagamento do log. RLS ligada e nenhum grant: só o dono lê e acrescenta.
--   3. `por_user_id` e `por_email` (nulos) em `adm_pedidos` e `adm_pedidos_decisao`: quem pediu, como o servidor da central o afirma.
--   4. Gatilho `before insert` nas duas tabelas de pedido, que só age quando `current_user = 'admin_central'` (o executor, a CLI e o dono passam sem efeito): exige `por_email`
--      de um admin ATIVO em `adm_admins` (comparação em minúsculas); se o admin tem `user_id`, exige `por_user_id` igual; na decisão, GRAVA `por_nome` com o nome da tabela de admins,
--      ignorando o que veio; recusa o pedido se o mesmo `por_email` já inseriu 20 ou mais pedidos na mesma tabela nos últimos 60 s (relógio, `clock_timestamp()`).
--      Erros: identidade recusada = SQLSTATE 42501 (insufficient_privilege); limite de ritmo = 54000 (program_limit_exceeded). Mensagens começam com "pedido recusado:".
--      A função roda com o privilégio de quem insere (não é SECURITY DEFINER): o `admin_central` já lê `adm_admins` e as tabelas de pedido (policy `admin_central_le`).
--   5. `identity_match_queue.raw`: o `admin_central` deixa de ler a coluna (a central não a usa). O `select` da tabela é trocado por `select` em todas as colunas menos `raw`.
--
-- Limite honesto: isto prova "o servidor da central afirmou este e-mail", não "o usuário provou"; identidade inforjável no banco exigiria escrita por RPC com o JWT do usuário (v2).
-- O limite de 20 por 60 s conta as linhas já confirmadas (duas transações simultâneas do mesmo admin podem passar juntas por poucas linhas): é freio de ritmo, não cota exata.
--
-- É aditiva: duas tabelas, duas funções de log mais uma de identidade, gatilhos, índices, quatro colunas nulas, policies e grants; o único `revoke` reduz o acesso do `admin_central`
-- (reversível com o `grant select` da tabela inteira). Nenhuma coluna, função, policy ou migração existente muda.
-- Nada disto é aplicado em produção nesta entrega.
-- Para desfazer: `drop trigger adm_pedido_identidade on adm_pedidos; drop trigger adm_pedido_identidade on adm_pedidos_decisao; drop function adm_pedido_identidade();`
--   `alter table adm_pedidos drop column por_user_id, drop column por_email;` (idem em adm_pedidos_decisao); `drop table adm_admins_log; drop table adm_admins;`
--   `drop function adm_admins_registra(); drop function adm_admins_log_imutavel();` e `grant select on identity_match_queue to admin_central;`.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

-- =====================================================================
-- 1. adm_admins
-- =====================================================================
create table adm_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (lower(email) = email and btrim(email) <> ''),
  nome text not null check (btrim(nome) <> ''),
  user_id uuid unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table adm_admins is 'Quem pode operar a central de administração. Escrita só pelo dono do banco; o admin_central só lê. Toda mudança fica em adm_admins_log.';
comment on column adm_admins.user_id is 'auth.users.id do admin no Supabase Auth, quando já se conhece; se preenchido, o pedido da central tem de trazer o mesmo por_user_id.';
alter table adm_admins enable row level security;

create or replace function adm_admins_toca() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.atualizado_em := pg_catalog.now();
  return new;
end $$;
drop trigger if exists adm_admins_toca on adm_admins;
create trigger adm_admins_toca before update on adm_admins for each row execute function adm_admins_toca();

-- =====================================================================
-- 2. adm_admins_log (só acréscimo)
-- =====================================================================
create table adm_admins_log (
  id uuid primary key default gen_random_uuid(),
  em timestamptz not null default clock_timestamp(),
  operacao text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  antes jsonb,
  depois jsonb,
  por_role text not null
);
comment on table adm_admins_log is 'Trilha só de acréscimo das mudanças em adm_admins (gatilho). Update e delete são recusados por gatilho.';
alter table adm_admins_log enable row level security;

create or replace function adm_admins_registra() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  insert into public.adm_admins_log (operacao, antes, depois, por_role)
  values (tg_op, case when tg_op in ('UPDATE', 'DELETE') then pg_catalog.to_jsonb(old) end, case when tg_op in ('INSERT', 'UPDATE') then pg_catalog.to_jsonb(new) end, current_user);
  return null;
end $$;
drop trigger if exists adm_admins_registra on adm_admins;
create trigger adm_admins_registra after insert or update or delete on adm_admins for each row execute function adm_admins_registra();

create or replace function adm_admins_log_imutavel() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'adm_admins_log é só de acréscimo: % recusado', tg_op;
end $$;
drop trigger if exists adm_admins_log_imutavel on adm_admins_log;
create trigger adm_admins_log_imutavel before update or delete on adm_admins_log for each row execute function adm_admins_log_imutavel();

-- As tabelas nascem sem grant, mas no Supabase os privilégios padrão do schema podem alcançar anon e authenticated (mesmo revoke da 0150 e da 0153).
do $$
declare r text; t text;
begin
  foreach r in array array['web_reader', 'web_writer', 'anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['adm_admins', 'adm_admins_log'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

grant select on adm_admins to admin_central;
create policy admin_central_le on adm_admins for select to admin_central using (true);

-- =====================================================================
-- 3. Identidade nos pedidos
-- =====================================================================
alter table adm_pedidos add column por_user_id uuid, add column por_email text;
alter table adm_pedidos_decisao add column por_user_id uuid, add column por_email text;
comment on column adm_pedidos.por_email is 'E-mail do admin que fez o pedido pela central, como o servidor o afirmou (o gatilho adm_pedido_identidade o confere em adm_admins). Nulo nos pedidos da CLI.';
comment on column adm_pedidos_decisao.por_email is 'E-mail do admin que fez o pedido pela central, como o servidor o afirmou (o gatilho adm_pedido_identidade o confere em adm_admins). Nulo nos pedidos da CLI.';
create index adm_pedidos_por_email_idx on adm_pedidos (por_email, criado_em) where por_email is not null;
create index adm_pedidos_decisao_por_email_idx on adm_pedidos_decisao (por_email, criado_em) where por_email is not null;

create or replace function adm_pedido_identidade() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  v_admin public.adm_admins%rowtype;
  v_recentes integer;
begin
  if current_user <> 'admin_central' then
    return new;  -- executor, CLI e dono: sem efeito
  end if;
  if new.por_email is null or pg_catalog.btrim(new.por_email) = '' then
    raise exception 'pedido recusado: falta o e-mail do admin (por_email)' using errcode = '42501';
  end if;
  new.por_email := pg_catalog.lower(new.por_email);
  select * into v_admin from public.adm_admins where email = new.por_email;
  if not found then
    raise exception 'pedido recusado: % não consta em adm_admins', new.por_email using errcode = '42501';
  end if;
  if not v_admin.ativo then
    raise exception 'pedido recusado: o admin % está inativo', new.por_email using errcode = '42501';
  end if;
  if v_admin.user_id is not null and new.por_user_id is distinct from v_admin.user_id then
    raise exception 'pedido recusado: por_user_id não confere com o admin %', new.por_email using errcode = '42501';
  end if;
  if tg_table_name = 'adm_pedidos_decisao' then
    new.por_nome := v_admin.nome;  -- o nome vem da tabela de admins, nunca do cliente
    select count(*) into v_recentes from public.adm_pedidos_decisao
      where por_email = new.por_email and criado_em > pg_catalog.clock_timestamp() - interval '60 seconds';
  else
    select count(*) into v_recentes from public.adm_pedidos
      where por_email = new.por_email and criado_em > pg_catalog.clock_timestamp() - interval '60 seconds';
  end if;
  if v_recentes >= 20 then
    raise exception 'pedido recusado: % já fez % pedidos em % nos últimos 60 s (limite: 20)', new.por_email, v_recentes, tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists adm_pedido_identidade on adm_pedidos;
create trigger adm_pedido_identidade before insert on adm_pedidos for each row execute function adm_pedido_identidade();
drop trigger if exists adm_pedido_identidade on adm_pedidos_decisao;
create trigger adm_pedido_identidade before insert on adm_pedidos_decisao for each row execute function adm_pedido_identidade();

-- =====================================================================
-- 4. identity_match_queue.raw fora do alcance do admin_central
-- =====================================================================
revoke select on public.identity_match_queue from admin_central;
grant select (id, source_id, external_id, candidate_person_id, confidence, status, resolved_by, resolved_at, created_at, updated_at) on public.identity_match_queue to admin_central;
