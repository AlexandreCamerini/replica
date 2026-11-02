-- Só local: login por código sem Supabase. Códigos com hash, expiração e tentativas; usuários em auth.users (stub).
create schema if not exists devauth;
create table if not exists devauth.codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz[] not null default '{}'
);
grant usage on schema devauth to web_writer;
grant select, insert, update, delete on devauth.codes to web_writer;
grant usage on schema auth to web_writer;
grant select, insert, update (email), delete on auth.users to web_writer;
alter role web_writer login password 'web_writer';
