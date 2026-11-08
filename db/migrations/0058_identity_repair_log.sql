-- BUG-032 / D210-D213: o ETL casava pessoa pelo SQ_CANDIDATO do TSE sem o ano, e o TSE reaproveita o número entre eleições.
-- Registro de cada candidatura conferida contra a fonte pelo reparo (civico-etl tse.fix032). Serve a três coisas:
--   1. trilha de auditoria: de quem para quem cada candidatura (e mandato) foi religada, ou por que saiu;
--   2. cópia da linha removida (raw), para refazer sem restaurar backup;
--   3. lista de confirmação usada pelo check "mesmo SQ em anos diferentes na mesma pessoa" (checks_identity.py):
--      só passa se a candidatura está aqui com basis 'titulo' ou 'nome_nasc'.
create table if not exists identity_repair_log (
  id            bigint generated always as identity primary key,
  bug           text not null,                 -- 'BUG-032'
  candidacy_id  uuid not null,                 -- sem FK: a linha pode ter sido removida
  year          int not null,
  tse_sequencial text not null,
  action        text not null check (action in ('confirmado', 'religado', 'removido')),
  basis         text check (basis in ('titulo', 'nome_nasc')),           -- prova usada (confirmado/religado)
  reason        text,                                                    -- removido: sem_pessoa | ambiguo | conflito
  from_person_id uuid,
  to_person_id  uuid,
  mandates_moved int not null default 0,
  mandates_removed int not null default 0,
  raw           jsonb,                         -- removido: candidatura + mandatos como estavam
  created_at    timestamptz not null default now(),
  unique (bug, candidacy_id)
);
create index if not exists identity_repair_log_year_sq_idx on identity_repair_log (year, tse_sequencial);
-- tabela interna do ETL: o app não lê (sem grant para web_reader)
alter table identity_repair_log enable row level security;
