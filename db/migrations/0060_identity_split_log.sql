-- BUG-033 / D221-D222: o ramo "cadeira" do identity.resolve fundiu pessoas diferentes (mesmo nascimento ou mesmo nome
-- parlamentar na bancada). civico-etl identity.fix033 separa o id externo errado e tira da pessoa certa os fatos que eram
-- do outro deputado. Cada linha que sai (ou muda) fica aqui, inteira, para refazer sem restaurar backup.
create table if not exists identity_split_log (
  id             bigint generated always as identity primary key,
  bug            text not null,                 -- 'BUG-033'
  source         text not null,                 -- slug da fonte do id separado ('camara', 'senado')
  external_id    text not null,                 -- id que não é da pessoa
  person_id      uuid not null,                 -- pessoa que ficou (crachá certo)
  table_name     text not null,
  action         text not null check (action in ('removido', 'alterado')),
  row_key        text not null,                 -- chave da linha na tabela (id ou chave composta)
  raw            jsonb not null,                -- linha como estava
  note           text,
  created_at     timestamptz not null default now(),
  unique (bug, source, external_id, table_name, row_key)
);
alter table identity_split_log enable row level security;  -- interna do ETL: sem grant para web_reader

-- BUG-035 / D224: o reparo do BUG-032 removeu candidaturas do dono verdadeiro (SQ repetido em 2012). A restauração fica
-- registrada no mesmo log, com ação própria.
alter table identity_repair_log drop constraint if exists identity_repair_log_action_check;
alter table identity_repair_log add constraint identity_repair_log_action_check
  check (action in ('confirmado', 'religado', 'removido', 'restaurado'));
