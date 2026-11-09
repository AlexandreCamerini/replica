-- catálogo D11: receitas de campanha por tipo de fonte (TSE, prestacao_de_contas_eleitorais_candidatos).
-- `campaign_finance_by_origin`: uma linha por candidatura e origem, em 7 origens fechadas; a soma das origens de uma candidatura
-- é, por construção, o total arrecadado (candidacies.raised_cents). Pessoa física só existe aqui como agregado.
-- `campaign_finance_donors`: nome de doador SÓ para partido e pessoa jurídica (CNPJ). Nunca nome nem CPF de pessoa física.
create table campaign_finance_by_origin (
  id bigint generated always as identity primary key,
  candidacy_id uuid not null references candidacies(id) on delete cascade,
  origin text not null check (origin in ('pessoa_fisica','partido','fefc','fundo_partidario','financiamento_coletivo','recursos_proprios','outros')),
  amount_cents bigint not null,
  lines int not null,                       -- quantas linhas de receita da fonte compõem a origem
  source_key text not null unique,          -- tse:ANO:SQ:origem
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campaign_finance_by_origin (candidacy_id);

create table campaign_finance_donors (
  id bigint generated always as identity primary key,
  candidacy_id uuid not null references candidacies(id) on delete cascade,
  origin text not null check (origin in ('partido','fefc','fundo_partidario','outros')),
  donor_kind text not null check (donor_kind in ('partido','pessoa_juridica')),
  donor_name text not null,
  donor_doc text check (donor_doc is null or donor_doc ~ '^[0-9]{14}$'),   -- só CNPJ
  amount_cents bigint not null,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campaign_finance_donors (candidacy_id);

alter table campaign_finance_by_origin enable row level security;
alter table campaign_finance_donors enable row level security;
grant select on campaign_finance_by_origin, campaign_finance_donors to web_reader;
create policy public_read on campaign_finance_by_origin for select to web_reader using (true);
create policy public_read on campaign_finance_donors for select to web_reader using (true);
create trigger set_updated_at before update on campaign_finance_by_origin for each row execute function set_updated_at();
create trigger set_updated_at before update on campaign_finance_donors for each row execute function set_updated_at();
