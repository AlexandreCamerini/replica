-- D05: partido atual pela fonte mais recente.
-- Cada fonte grava o que viu (pessoa, partido, data); o derive.stats reconstrói party_memberships como linha do tempo
-- (o partido vigente numa data = a observação mais recente até ela). Candidaturas do TSE entram direto do banco
-- (candidacies + elections), sem cópia aqui. person_current_party (view lida pelo app) não muda.
create table party_observations (
  id bigint generated always as identity primary key,
  person_id uuid not null references people(id) on delete cascade,
  party_id uuid not null references parties(id) on delete restrict,
  observed_on date not null,
  source text not null check (source in ('camara','senado')),
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_key)
);
create index on party_observations (person_id, observed_on);

alter table party_observations enable row level security;
-- sem policy para web_reader: tabela interna do ETL (o app lê person_current_party)
