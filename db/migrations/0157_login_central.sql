-- Administração de coleta: login próprio da central em Postgres (D335; substitui o Supabase Auth e o MFA dele na central, que a D332 aposenta).
--
-- O que faz (schema `login`, criado pela 0143):
--   1. `login.central_codigos`: um código de e-mail ativo por admin (só o hash), tentativas e envios da última hora. Mesmo desenho de `login.codes` do site,
--      em tabela separada: o site (`web_writer`) não lê nem grava os códigos da central, e a central (`admin_central`) não toca nos do site.
--      `nonce_hash` amarra o código ao navegador que o pediu: tentativa sem o nonce certo não conta nem compara (ninguém queima as tentativas de outro).
--   2. `login.central_fatores`: o segundo fator (TOTP) de cada admin, um por e-mail. O segredo fica CIFRADO (AES-256-GCM com chave derivada do SESSION_SECRET
--      do projeto da central): um dump do banco não entrega o segredo. `ultimo_passo` impede reuso do mesmo código; `tentativas` e `tentativas_desde` freiam palpite.
--   3. Gatilho `central_fator_protege` (insert e update): só o DONO da tabela (ou superusuário) fica livre. Para qualquer outro role, a central inclusive:
--      fator nasce NÃO verificado; fator já VERIFICADO não troca de segredo, não volta a "não verificado" e não anda para trás em `ultimo_passo`;
--      `ultimo_passo` não passa do passo atual do relógio do banco mais uma folga (ninguém trava o fator jogando o passo para o futuro);
--      `sessoes_desde` não muda. Trocar o autenticador de alguém é ato do dono do banco: `delete from login.central_fatores where email = '...'`.
--      Derrubar as sessões de alguém sem trocar o fator: `update login.central_fatores set sessoes_desde = now() where email = '...'`.
--      A central só aceita sessão de nível 2 emitida depois de `verificado_em` e de `sessoes_desde`.
--      Limite: os contadores de tentativa são da central (ela precisa gravá-los); quem tiver a credencial do `admin_central` pode zerá-los.
--   4. Grants só para `admin_central`: `usage` no schema, `select, insert, update` nas duas tabelas. Sem `delete`.
--
-- Isto ALARGA o que o `admin_central` escreve: até a 0156 ele só inseria em `adm_pedidos` e `adm_pedidos_decisao`. É o custo de a central não depender de um
-- provedor de login externo. As duas tabelas não têm dado público nem de eleitor: só e-mail de admin, hash de código e segredo cifrado.
--
-- É aditiva: duas tabelas, uma função, um gatilho e grants. Nada existente muda. No Supabase é inofensiva (schema `login`, fora do PostgREST).
-- Para desfazer: `drop table login.central_fatores; drop table login.central_codigos; drop function login.central_fator_protege();`
--   `revoke usage on schema login from admin_central;`
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

create table login.central_codigos (
  email text primary key check (lower(email) = email and btrim(email) <> ''),
  code_hash text not null,
  nonce_hash text not null default '',
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz[] not null default '{}'
);
comment on table login.central_codigos is 'Código de e-mail da entrada da central (só o hash). Um por admin; só o admin_central lê e grava.';

create table login.central_fatores (
  email text primary key check (lower(email) = email and btrim(email) <> ''),
  segredo_cifrado text not null check (segredo_cifrado <> ''),
  verificado_em timestamptz,
  ultimo_passo bigint,
  tentativas int not null default 0,
  tentativas_desde timestamptz,
  sessoes_desde timestamptz,
  criado_em timestamptz not null default now()
);
comment on table login.central_fatores is 'Segundo fator (TOTP) dos admins da central, um por e-mail. Segredo cifrado pela aplicação. Trocar o fator de alguém: o dono apaga a linha.';
comment on column login.central_fatores.sessoes_desde is 'Sessões de nível 2 emitidas antes deste instante não valem. Só o dono do banco grava (revogação sem trocar o fator).';
comment on column login.central_fatores.ultimo_passo is 'Último passo de 30 s aceito: o mesmo código (ou um anterior) não vale duas vezes.';

create or replace function login.central_fator_protege() returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  v_livre boolean;
begin
  -- lista do que pode: só o dono da tabela e superusuário passam sem regra (não depende do nome do role da central)
  select pg_catalog.pg_get_userbyid(c.relowner) = current_user or (select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user)
    into v_livre from pg_catalog.pg_class c where c.oid = tg_relid;
  if v_livre then
    return new;
  end if;
  if new.ultimo_passo is not null and new.ultimo_passo > pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / 30)::bigint + 4 then
    raise exception 'ultimo_passo além do relógio' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.verificado_em is not null or new.ultimo_passo is not null or new.sessoes_desde is not null then
      raise exception 'fator nasce não verificado' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.sessoes_desde is distinct from old.sessoes_desde or new.email is distinct from old.email then
    raise exception 'sessoes_desde e email não mudam pela central' using errcode = '42501';
  end if;
  if old.verificado_em is null then
    return new;  -- fator ainda não verificado: o cadastro pode recomeçar ou concluir
  end if;
  if new.segredo_cifrado is distinct from old.segredo_cifrado or new.verificado_em is distinct from old.verificado_em then
    raise exception 'fator verificado não se altera pela central' using errcode = '42501';
  end if;
  if new.ultimo_passo is null or (old.ultimo_passo is not null and new.ultimo_passo < old.ultimo_passo) then
    raise exception 'ultimo_passo não anda para trás' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger central_fator_protege before insert or update on login.central_fatores for each row execute function login.central_fator_protege();

revoke all on login.central_codigos, login.central_fatores from public;
do $$
declare r text;
begin
  foreach r in array array['web_reader', 'web_writer', 'anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on login.central_codigos, login.central_fatores from %I', r);
    end if;
  end loop;
end $$;

grant usage on schema login to admin_central;
grant select, insert, update on login.central_codigos to admin_central;
grant select, insert, update on login.central_fatores to admin_central;
