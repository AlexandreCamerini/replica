-- D15: rascunho por IA com Message Batches e prompt caching.
-- (1) uso e custo por rascunho; (2) estado dos lotes enviados, para o lote sobreviver a um run que caiu.
-- Número 0090 de propósito: 0082+ são de outras frentes em paralelo.

alter table answer_drafts
  add column cache_read_tokens int,
  add column cache_creation_tokens int,
  add column cost_usd numeric(10, 6),          -- estimativa (tabela de preços em drafting.PRICES); null = modelo fora da tabela
  add column via_batch boolean not null default false;

create table rascunho_batches (
  batch_id text primary key,                   -- id do lote na API da Anthropic (msgbatch_...)
  model text not null,
  prompt_version int not null,
  items jsonb not null,                        -- {custom_id: {body_id, prop_type, prop_number, prop_year, label, url, sha}}
  status text not null default 'enviado' check (status in ('enviado', 'coletado', 'cancelado', 'expirado')),
  note text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index on rascunho_batches (status, created_at);
-- só o ETL (service role) mexe aqui; o site não lê
alter table rascunho_batches enable row level security;
