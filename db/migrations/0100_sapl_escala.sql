-- D08/D09 (pacote C): SAPL em escala e ALEs com SAPL. Faixa 0100–0109.
-- (1) backoff por casa instável: fail_count consecutivo e retry_after (a fila pula a casa até lá);
-- (2) duração da última carga, para dimensionar orçamento e lote com dado e não com palpite;
-- (3) sapl_houses também guarda Assembleias (place_id = UF): casa 'assembleia' tem registry_url = a própria URL do SAPL.
alter table sapl_houses
  add column if not exists fail_count int not null default 0,
  add column if not exists retry_after timestamptz,
  add column if not exists last_duration_s int;

create index if not exists sapl_houses_fila on sapl_houses (status, retry_after) where status = 'ok';
