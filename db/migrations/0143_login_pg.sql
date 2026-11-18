-- Login próprio em Postgres (provedor `pg`): códigos de acesso e revogação de sessões.
-- Só aditiva e inofensiva no Supabase (schema novo `login`, sem tocar em auth nem em public). Quem usa é o web_writer.
-- Sem FK para auth.users: a linha de revogação sobrevive à exclusão da conta (deleteUser grava antes de apagar).
create schema if not exists login;
revoke all on schema login from public;

-- Um código ativo por e-mail. Guarda só o hash (HMAC com SESSION_SECRET); sent_at = envios da última hora (limite 3/h).
create table if not exists login.codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz[] not null default '{}'
);

-- Sessões revogáveis: cookie com iat anterior a valido_desde (os dois no segundo) é recusado.
create table if not exists login.sessoes_validas_desde (
  user_id uuid primary key,
  valido_desde timestamptz not null
);

revoke all on all tables in schema login from public;
grant usage on schema login to web_writer;
grant select, insert, update, delete on login.codes to web_writer;
grant select, insert, update on login.sessoes_validas_desde to web_writer;
