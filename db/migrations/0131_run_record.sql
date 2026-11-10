-- Registro de run (módulo de ETL, Fase 1): separa nota de erro, mede o que foi lido e apagado, e cria o status `partial`.
--
-- Só adiciona colunas nulas e alarga o check de status: o código anterior a esta migração continua gravando sem erro
-- (o Mac do SAPL, D274, pode rodar versão antiga por um tempo). O código novo NÃO roda sem ela: aplicar antes do merge.
--
-- partial = o dado foi gravado, mas algo ficou retido ou incompleto (o motivo vai em `error`). Carimba, alerta e não é base de skip.
-- rows_read / rows_deleted nulos = o job não informou; zero é zero de verdade (a mediana de volume da Fase 2a depende disso).
-- O ALTER pede ACCESS EXCLUSIVE: se houver run no meio de uma transação, desiste em 5 s em vez de enfileirar todo o ETL atrás dele.
set local lock_timeout = '5s';

alter table ingest_runs
  add column rows_read bigint,
  add column rows_deleted bigint,
  add column duration_ms bigint,
  add column code_version text,
  add column notes text,
  add column invocation text,  -- id da chamada do run-due que abriu o run (nulo = rodado à mão ou por outro workflow)
  add column traceback text;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.ingest_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%skipped_unchanged%'
  loop
    execute format('alter table public.ingest_runs drop constraint %I', c);
  end loop;
end $$;
alter table ingest_runs add constraint ingest_runs_status_check
  check (status in ('running', 'succeeded', 'partial', 'failed', 'skipped_unchanged'));

-- Até aqui as notas de um run bem-sucedido moravam em `error`. Passam para `notes`; `error` fica só com erro.
-- A agenda repete este mesmo update a cada chamada (schedule.move_legacy_notes) enquanto houver código antigo gravando.
-- Trigger desligado: mover a nota não é atualização do run, updated_at histórico fica como está.
alter table ingest_runs disable trigger set_updated_at;
update ingest_runs set notes = error, error = null where status = 'succeeded' and error is not null and notes is null;
alter table ingest_runs enable trigger set_updated_at;
