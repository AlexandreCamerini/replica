-- SAPL incremental (W3-B): cursor por câmara e entidade + fila de tentativas.
-- Cursor interno do ETL: não é lido pelo site (RLS ligada, sem policy pública).
create table if not exists sapl_cursors (
  house_id bigint not null references sapl_houses(id) on delete cascade,
  entity text not null check (entity in ('materias','autorias','presencas','votos')),
  last_id bigint not null,                 -- maior id da fonte visto no INÍCIO do último run (pega o que chegar durante a carga na próxima)
  last_updated timestamptz,                -- maior data_ultima_atualizacao vista (só materias)
  legislature_number int,                  -- cursor só vale na mesma legislatura
  full_at timestamptz not null default now(), -- última carga completa desta entidade
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (house_id, entity)
);
alter table sapl_cursors enable row level security;
create trigger set_updated_at before update on sapl_cursors for each row execute function set_updated_at();

-- fila: a câmara com tentativa mais antiga (ou nunca tentada) vai primeiro; falha/sem legislatura não trava a fila.
alter table sapl_houses
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_outcome text check (last_outcome in ('carregada','sem_legislatura','falhou'));
