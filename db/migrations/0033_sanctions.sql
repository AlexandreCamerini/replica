-- W3-B / D130–D132: sanções de órgãos de controle. Primeiro conjunto: TCU, inabilitados para função pública (Lei 8.443/92 art. 60).
-- CPF da fonte NÃO é gravado (o banco não tem CPF de ninguém para casar e a lista traz pessoas sem mandato): D131.
-- person_id só com casamento de alta confiança por nome civil completo + UF (D132); o resto fica sem vínculo.
create table sanctions (
  id bigint generated always as identity primary key,
  source text not null check (source in ('tcu_inabilitados')),
  source_key text not null,                 -- processo + deliberação + nome (a fonte não tem id próprio)
  name text not null,                       -- como a fonte escreve
  uf char(2), municipality text,
  process text, decision text,              -- "026.615/2020-7", "AC-000738/2022-PL"
  decided_on date,                          -- data do acórdão
  final_on date,                            -- trânsito em julgado (início da inabilitação)
  ends_on date,                             -- fim da inabilitação
  source_url text not null,
  person_id uuid references people(id) on delete set null,
  match_method text check (match_method in ('nome_civil_uf')),
  match_confidence numeric(4,3) check (match_confidence between 0 and 1),
  match_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_key)
);
create index on sanctions (person_id);

alter table sanctions enable row level security;
grant select on sanctions to web_reader;
create policy public_read on sanctions for select to web_reader using (true);
create trigger set_updated_at before update on sanctions for each row execute function set_updated_at();
