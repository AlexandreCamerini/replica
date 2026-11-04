-- Agenda do ETL (D250): última tentativa por tarefa, mesmo quando a fonte falha antes de abrir um run em ingest_runs.
-- Interno do ETL: não é lido pelo site (RLS ligada, sem policy pública).
create table if not exists etl_schedule_attempts (
  task text primary key,                  -- nome em schedule.TASKS; '__run_due__' = início da última chamada da agenda
  attempted_at timestamptz not null,
  finished_at timestamptz,
  exit_code int,
  tail text
);
alter table etl_schedule_attempts enable row level security;
