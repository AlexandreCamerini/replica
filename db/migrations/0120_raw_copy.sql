-- D12 (D280): cópia datada do bruto de cada carga. Aditiva e nula por padrão: com ETL_RAW_STORE=off nada muda.
-- raw_uri aponta para o MANIFESTO (JSON com url, sha256 e stored_uri de cada arquivo da carga); raw_expires_at nulo = permanente.
alter table ingest_runs
  add column raw_uri text,
  add column raw_expires_at timestamptz,
  add column raw_purged_at timestamptz,
  add column raw_bytes bigint;
create index ingest_runs_raw_expiry_idx on ingest_runs (raw_expires_at) where raw_uri is not null and raw_purged_at is null;
