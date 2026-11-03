-- Clone cívico (rebuild das features do Politicômetro) — migration 0001
-- Postgres 15+ (Supabase). Todo dado público vem de ETL das fontes oficiais.
--
-- Convenções:
--   * entidades: id uuid; tabelas-fato de alto volume (votes, attendance, expenses,
--     page_views, campaign_finance_entries, candidacy_place_votes, activity_events):
--     id bigint identity — dezenas de milhões de linhas, índice 2x menor que uuid.
--   * dinheiro: *_cents bigint + currency char(3) (sempre 'BRL' hoje, coluna existe p/ não migrar depois).
--   * datas civis (mandato, sessão sem hora, nota fiscal): date. Instantes: timestamptz UTC.
--   * status = text + check (evolui com ALTER sem recriar tipo).
--   * idempotência do ETL: toda linha vinda de fonte tem chave natural única (source_key ou
--     composta) para INSERT ... ON CONFLICT DO UPDATE.
--   * acesso: RLS. Dado público = leitura anon/authenticated, escrita só service_role (ETL).
--     Dado de usuário = dono via auth.uid(). Formulários públicos gravam via server action
--     com service_role após Turnstile + rate limit (sem policy de insert anon).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

-- ordenação alfabética pt-BR (neutralidade: listas sempre A–Z, "Á" junto de "A")
create collation if not exists pt_br (provider = icu, locale = 'pt-BR');

-- unaccent imutável para índices de busca
create or replace function f_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

create or replace function set_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- =====================================================================
-- Proveniência
-- =====================================================================
create table sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                -- 'tse', 'camara', 'senado', 'transparencia', 'sapl:3509502'...
  name text not null,
  url text not null,
  license text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  dataset text not null,                    -- 'camara.votos', 'tse.candidatos.2026'...
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','succeeded','failed','skipped_unchanged')),
  input_checksum text,                      -- hash do arquivo/página: pula se não mudou
  rows_upserted bigint not null default 0,
  rows_rejected bigint not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ingest_runs (source_id, dataset, started_at desc);

-- o "Fonte: X · atualizado em Y" de cada bloco
create table dataset_stamps (
  id uuid primary key default gen_random_uuid(),
  dataset text not null unique,
  source_id uuid not null references sources(id) on delete restrict,
  source_updated_at timestamptz,            -- data que a fonte declara
  refreshed_at timestamptz not null,        -- quando nosso ETL confirmou
  last_run_id uuid references ingest_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on dataset_stamps (source_id);
create index on dataset_stamps (last_run_id);

-- =====================================================================
-- Dimensões
-- =====================================================================
create table places (
  id uuid primary key default gen_random_uuid(),
  ibge_code text unique,                    -- '3509502' município, '35' UF, '1'..'5' região, 'BR'
  kind text not null check (kind in ('pais','regiao','uf','municipio')),
  name text not null collate pt_br,
  slug text not null unique,
  uf char(2),
  parent_id uuid references places(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uf_required check (kind in ('pais','regiao') or uf is not null)
);
create index on places (parent_id);
create index on places (kind, uf);
create index places_name_trgm on places using gin (f_unaccent(lower(name)) gin_trgm_ops);

create table parties (
  id uuid primary key default gen_random_uuid(),
  acronym text not null,                    -- forma canônica: 'PCdoB'; siglas são reutilizadas (PL 1985 ≠ PL 2006)
  name text not null,
  tse_number smallint,                      -- números também são reutilizados
  valid_from date not null,
  valid_to date,
  spectrum text check (spectrum in ('esquerda','centro','direita')),
  spectrum_order smallint,                  -- ordem no hemiciclo; fonte citada em spectrum_source_url
  spectrum_source_url text,
  president_name text,
  hq_place_id uuid references places(id) on delete set null,
  founded_on date,
  extinct_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on parties (hq_place_id);
create unique index parties_acronym_period on parties (acronym, valid_from);
alter table parties add constraint one_acronym_at_a_time exclude using gist (
  acronym with =, daterange(valid_from, valid_to, '[)') with &&);

create table party_aliases (                -- grafias da fonte ('PC do B', 'PCDOB') -> partido vigente na data; NÃO funde sucessoras
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  party_id uuid not null references parties(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on party_aliases (party_id);
alter table party_aliases add constraint one_alias_target_at_a_time exclude using gist (
  alias with =, daterange(valid_from, valid_to, '[)') with &&);

create table offices (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in (
    'presidente','vice_presidente','senador','deputado_federal','governador','vice_governador',
    'deputado_estadual','deputado_distrital','prefeito','vice_prefeito','vereador')),
  name_m text not null,
  name_f text not null,
  level text not null check (level in ('federal','estadual','municipal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table legislative_bodies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('camara_deputados','senado','assembleia','camara_legislativa_df','camara_municipal')),
  place_id uuid not null references places(id) on delete restrict,
  name text not null,
  adapter text not null default 'none'
    check (adapter in ('camara_api','senado_api','sapl','ale_custom','none')),
  open_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, place_id)
);
create index on legislative_bodies (place_id);

create table topics (                       -- 17 temas fixos, regra por palavra-chave versionada
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  keywords text[] not null,
  rule_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Pessoas e identidade
-- =====================================================================
create table people (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null collate pt_br,
  civil_name text,
  gender text check (gender in ('f','m')),  -- só para flexão do cargo (Deputada/Deputado); fonte: TSE
  birth_date date,
  birthplace_place_id uuid references places(id) on delete set null,
  education text,
  photo_path text,                          -- Storage; só fotos oficiais com licença
  photo_source_url text,
  photo_license text,
  deceased_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on people (birthplace_place_id);
create index people_name_trgm on people using gin (f_unaccent(lower(display_name)) gin_trgm_ops);
create index on people (display_name);

-- slug é permanente para quem compartilhou o link; mudança de nome/homônimo novo gera redirect 308
create table person_slug_redirects (
  id uuid primary key default gen_random_uuid(),
  old_slug text not null unique,
  person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on person_slug_redirects (person_id);

create table person_external_ids (          -- casamento TSE x Câmara x Senado x SAPL
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  source_id uuid not null references sources(id) on delete restrict,
  external_id text not null,
  match_method text not null check (match_method in ('exact_id','name_birth','name_birth_place','manual')),
  match_confidence numeric(4,3) not null check (match_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index on person_external_ids (person_id);

create table party_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  party_id uuid not null references parties(id) on delete restrict,
  from_on date not null,
  to_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_membership_order check (to_on is null or to_on >= from_on),
  constraint party_membership_key unique (person_id, from_on),
  constraint one_party_at_a_time exclude using gist (
    person_id with =, daterange(from_on, to_on, '[)') with &&)
);
create index on party_memberships (party_id);

-- =====================================================================
-- Eleições
-- =====================================================================
create table elections (
  id uuid primary key default gen_random_uuid(),
  year smallint not null,
  round smallint not null check (round in (1,2)),
  kind text not null check (kind in ('geral','municipal','suplementar')),
  held_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, year, round, held_on)
);

create table contests (                     -- uma disputa: cargo x lugar x eleição
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references elections(id) on delete cascade,
  office_id uuid not null references offices(id) on delete restrict,
  place_id uuid not null references places(id) on delete restrict,
  seats smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (election_id, office_id, place_id),
  unique (id, election_id)                  -- alvo da FK composta de candidacies
);
create index on contests (office_id);
create index on contests (place_id);

create table candidacies (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null,
  election_id uuid not null,                -- desnormalizado p/ garantir 1 cargo por pessoa por eleição
  person_id uuid not null references people(id) on delete restrict,
  party_id uuid references parties(id) on delete restrict,
  tse_sequencial text not null,             -- SQ_CANDIDATO
  ballot_name text not null,
  ballot_number int,
  coalition_name text,
  result text check (result in ('eleito','eleito_qp','eleito_media','suplente','nao_eleito','segundo_turno','indeferido','renuncia')),
  votes bigint check (votes >= 0),
  raised_cents bigint, spent_cents bigint,
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, person_id),
  unique (contest_id, tse_sequencial),
  unique (person_id, election_id),
  foreign key (contest_id, election_id) references contests(id, election_id) on delete cascade
);
create index on candidacies (person_id);
create index on candidacies (party_id);
create index on candidacies (contest_id, votes desc);

create table candidacy_place_votes (        -- "mais votados na sua cidade"; dezenas de milhões de linhas
  id bigint generated always as identity primary key,
  candidacy_id uuid not null references candidacies(id) on delete cascade,
  place_id uuid not null references places(id) on delete restrict,
  votes bigint not null check (votes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidacy_id, place_id)
);
create index on candidacy_place_votes (place_id, votes desc);

create table campaign_finance_entries (
  id bigint generated always as identity primary key,
  candidacy_id uuid not null references candidacies(id) on delete cascade,
  direction text not null check (direction in ('receita','despesa')),
  category text not null,                   -- fundo partidário, FEFC, pessoa física, ...
  counterpart_name text,
  counterpart_doc text,                     -- CNPJ ou CPF mascarado como a fonte publica
  amount_cents bigint not null,
  currency char(3) not null default 'BRL',
  occurred_on date,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campaign_finance_entries (candidacy_id, direction);

create table asset_declarations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  candidacy_id uuid not null unique references candidacies(id) on delete cascade,
  year smallint not null,
  total_cents bigint not null,
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on asset_declarations (person_id, year);

create table asset_items (
  id uuid primary key default gen_random_uuid(),
  declaration_id uuid not null references asset_declarations(id) on delete cascade,
  kind text not null,
  description text,
  value_cents bigint not null,
  currency char(3) not null default 'BRL',
  position smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (declaration_id, position)
);

create table gov_plan_excerpts (            -- trechos literais do plano registrado no TSE
  id uuid primary key default gen_random_uuid(),
  candidacy_id uuid not null references candidacies(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete restrict,
  excerpt text not null,
  page smallint,
  document_url text not null,
  source_key text not null unique,          -- hash(candidacy, página, trecho)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on gov_plan_excerpts (candidacy_id, topic_id);
create index on gov_plan_excerpts (topic_id);

create table live_count_snapshots (         -- apuração ao vivo
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references contests(id) on delete cascade,
  captured_at timestamptz not null,
  pct_counted numeric(5,2) not null check (pct_counted between 0 and 100),
  payload jsonb not null,                   -- [{candidacy_id, votes}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, captured_at)
);

-- =====================================================================
-- Mandatos e custo
-- =====================================================================
create table mandates (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  office_id uuid not null references offices(id) on delete restrict,
  place_id uuid not null references places(id) on delete restrict,
  body_id uuid references legislative_bodies(id) on delete restrict,
  party_id uuid references parties(id) on delete restrict,   -- partido no início do mandato
  candidacy_id uuid references candidacies(id) on delete set null,
  role text not null default 'titular' check (role in ('titular','suplente_em_exercicio')),
  status text not null check (status in ('em_exercicio','eleito_aguardando_posse','licenciado','afastado','encerrado','cassado','renunciou')),
                                            -- status ATUAL (cache do último mandate_period); histórico em mandate_periods
  started_on date not null,
  ends_on date not null,                    -- fim previsto do mandato
  elected_by text,
  status_source text not null,              -- 'tse' | 'camara' | ... (S05: "situação segundo o TSE")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mandate_order check (ends_on > started_on),
  constraint mandate_key unique (person_id, office_id, place_id, started_on),   -- alvo do upsert do ETL
  -- mesma pessoa não ocupa o mesmo cargo duas vezes no mesmo período
  constraint no_overlapping_mandate exclude using gist (
    person_id with =, office_id with =, daterange(started_on, ends_on, '[)') with &&)
);
create index on mandates (office_id, place_id, status);
create index on mandates (place_id, status);
create index on mandates (body_id);
create index on mandates (party_id);
create index on mandates (candidacy_id);
create index on mandates (person_id, started_on desc);

-- suplente que entra e sai várias vezes, titular que se licencia para ser ministro e volta
create table mandate_periods (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references mandates(id) on delete cascade,
  status text not null check (status in ('em_exercicio','licenciado','afastado','suspenso')),
  reason text,                              -- 'licença para cargo no Executivo', 'saúde', 'decisão judicial'...
  from_on date not null,
  to_on date,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, from_on),
  constraint period_order check (to_on is null or to_on >= from_on),
  constraint no_overlapping_period exclude using gist (
    mandate_id with =, daterange(from_on, to_on, '[)') with &&)
);
create index on mandate_periods (from_on, to_on);

create table mandate_contacts (             -- "Contato: telefone, e-mail, redes sociais" (S05)
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references mandates(id) on delete cascade,
  kind text not null check (kind in ('email','telefone','gabinete','site','instagram','facebook','x','youtube','tiktok','outra_rede')),
  value text not null,
  source_id uuid not null references sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, kind, value)
);
create index on mandate_contacts (source_id);

create table salaries (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references offices(id) on delete restrict,
  place_id uuid references places(id) on delete restrict,     -- null = nacional
  valid_from date not null,
  amount_cents bigint not null,
  currency char(3) not null default 'BRL',
  is_ceiling boolean not null default false, -- "teto pela Constituição" vs valor pago
  source_id uuid not null references sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (office_id, place_id, valid_from, is_ceiling)
);
create index on salaries (place_id);
create index on salaries (source_id);

-- =====================================================================
-- Atividade legislativa
-- =====================================================================
create table laws (
  id uuid primary key default gen_random_uuid(),
  sphere text not null check (sphere in ('federal','estadual','municipal')),
  place_id uuid not null references places(id) on delete restrict,
  number text not null,
  sanctioned_on date not null,
  summary text not null,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sphere, place_id, number)
);
create index on laws (sanctioned_on desc);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  type text not null,                       -- PL, PLP, PEC, PLS, REQ, INC, EMC...
  number int not null,
  year smallint not null,
  summary_official text not null,
  summary_plain text,                       -- reescrita determinística (regras), nunca opinião
  can_become_law boolean not null,
  status text,
  presented_on date,
  became_law_id uuid references laws(id) on delete set null,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, type, number, year)
);
create index on proposals (became_law_id);
create index on proposals (year);
create index proposals_summary_trgm on proposals using gin (f_unaccent(lower(summary_official)) gin_trgm_ops);

create table proposal_authors (
  proposal_id uuid not null references proposals(id) on delete cascade,
  person_id uuid not null references people(id) on delete restrict,
  role text not null check (role in ('principal','coautoria','apoio')),
  sign_order smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, person_id)
);
create index on proposal_authors (person_id, role);

create table proposal_topics (
  proposal_id uuid not null references proposals(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete restrict,
  rule_version int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, topic_id)
);
create index on proposal_topics (topic_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  kind text not null,                       -- deliberativa ordinária, extraordinária, solene...
  is_deliberative boolean not null,         -- só estas contam presença (/sobre)
  status text not null check (status in ('agendada','em_andamento','encerrada','cancelada')),
  starts_at timestamptz not null,
  video_url text,
  official_url text,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, source_key)
);
create index on sessions (body_id, starts_at desc);

create table session_agenda_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  proposal_id uuid references proposals(id) on delete set null,
  position smallint not null,
  title text not null,
  outcome text check (outcome in ('aprovado','rejeitado','nao_votado','retirado','adiado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, position)
);
create index on session_agenda_items (proposal_id);

create table attendance (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  person_id uuid not null references people(id) on delete restrict,
  status text not null check (status in ('presente','ausente','ausencia_justificada','fora_do_exercicio')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, person_id)
);
create index on attendance (person_id, session_id);

create table voting_events (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  session_id uuid references sessions(id) on delete set null,
  proposal_id uuid references proposals(id) on delete set null,
  occurred_at timestamptz not null,
  kind text not null check (kind in ('texto','destaque','urgencia','requerimento','outro')),
  is_nominal boolean not null,              -- votação simbólica não tem voto individual
  description text not null,
  result text check (result in ('aprovado','rejeitado')),
  yes_count int, no_count int, abstain_count int,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, source_key)
);
create index on voting_events (session_id);
create index on voting_events (proposal_id);
create index on voting_events (body_id, occurred_at desc);

create table orientation_actors (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('partido','bloco','governo','maioria','minoria','oposicao')),
  party_id uuid references parties(id) on delete restrict,
  label text not null,                      -- como a fonte escreve: 'Bloco PP, UNIÃO...', 'Governo'
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, label),
  constraint party_actor_has_party check ((kind = 'partido') = (party_id is not null))
);
create index on orientation_actors (party_id);

create table bloc_members (                 -- votação orientada por bloco -> partidos do bloco
  actor_id uuid not null references orientation_actors(id) on delete cascade,
  party_id uuid not null references parties(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, party_id)
);
create index on bloc_members (party_id);

create table party_orientations (
  voting_event_id uuid not null references voting_events(id) on delete cascade,
  actor_id uuid not null references orientation_actors(id) on delete restrict,
  orientation text not null check (orientation in ('sim','nao','abstencao','obstrucao','liberado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (voting_event_id, actor_id)
);
create index on party_orientations (actor_id);

create table votes (
  id bigint generated always as identity primary key,
  voting_event_id uuid not null references voting_events(id) on delete cascade,
  person_id uuid not null references people(id) on delete restrict,
  party_id uuid references parties(id) on delete restrict,             -- partido na data do voto
  value text not null check (value in ('sim','nao','abstencao','obstrucao','art17','nao_votou')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (voting_event_id, person_id)
);
create index on votes (person_id, voting_event_id);
create index on votes (party_id);

create table speeches (
  id bigint generated always as identity primary key,
  person_id uuid not null references people(id) on delete restrict,
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  occurred_at timestamptz not null,
  summary text,
  url text,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, source_key)
);
create index on speeches (person_id, occurred_at desc);

create table speech_topics (
  speech_id bigint not null references speeches(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete restrict,
  rule_version int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (speech_id, topic_id)
);
create index on speech_topics (topic_id);

create table committees (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete cascade,
  acronym text,
  name text not null,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, source_key)
);

create table committee_memberships (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references committees(id) on delete cascade,
  person_id uuid not null references people(id) on delete restrict,
  role text not null,                       -- titular, suplente, presidente, relator...
  from_on date not null,
  to_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (committee_id, person_id, role, from_on)
);
create index on committee_memberships (person_id, from_on desc);

-- =====================================================================
-- Dinheiro do mandato
-- =====================================================================
create table expenses (                     -- cota parlamentar / verba de gabinete
  id bigint generated always as identity primary key,
  person_id uuid not null references people(id) on delete restrict,
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  occurred_on date not null,
  category text not null,
  supplier_name text,
  supplier_doc text,
  amount_cents bigint not null,             -- pode ser negativo (estorno/glosa, como a fonte publica)
  currency char(3) not null default 'BRL',
  receipt_url text,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (body_id, source_key)
);
create index on expenses (person_id, occurred_on desc);
create index on expenses (supplier_doc);

create table amendments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete restrict,   -- null p/ emenda de bancada/comissão
  author_label text not null,
  year smallint not null,
  kind text not null check (kind in ('individual','individual_pix','bancada','comissao','relator')),
  area text,
  budget_action text,
  beneficiary_place_id uuid references places(id) on delete set null,
  beneficiary_kind text check (beneficiary_kind in ('prefeitura','governo_estadual','entidade','hospital','outro')),
  committed_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  currency char(3) not null default 'BRL',
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on amendments (person_id, year);
create index on amendments (beneficiary_place_id, year);

create table trips (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  destination text not null,
  purpose text,
  cost_cents bigint,
  currency char(3) not null default 'BRL',
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_order check (ends_on >= starts_on)
);
create index on trips (person_id, starts_on desc);

create table staff_members (                -- equipe do gabinete (nome e salário publicados pela casa)
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete restrict,
  name text not null,
  role text,
  monthly_salary_cents bigint,
  currency char(3) not null default 'BRL',
  as_of date not null,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on staff_members (person_id, as_of desc);

-- pré-agregado pelo ETL: tiles do crachá, resumo do ano e comparador leem só daqui
create table person_period_stats (
  person_id uuid not null references people(id) on delete cascade,
  period text not null check (period ~ '^(career|[0-9]{4})$'),
  presence_present int, presence_total int,           -- null = fonte não publica ("—", nunca 0)
  proposals_principal int, proposals_cosigned int,
  proposals_law_eligible int, laws_from_proposals int,
  votes_registered int,
  party_aligned int, party_alignment_total int,
  speeches int, committees int,
  expenses_cents bigint, amendments_paid_cents bigint, salary_received_cents bigint,
  currency char(3) not null default 'BRL',
  top_topics jsonb not null default '[]',   -- [{topic_slug, proposals, speeches}]
  missing_datasets text[] not null default '{}',      -- alimenta "faltam N dados · por quê"
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, period),
  constraint presence_sane check (presence_present is null or presence_present <= presence_total)
);

create table data_coverage (                -- "Quem publica e quem não publica" + MissingDataNote
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  dataset text not null check (dataset in (
    'salario_prefeito','salario_vereadores','salario_deputados_estaduais','presenca','votos','propostas',
    'gastos_gabinete','discursos','equipe','emendas','comissoes','viagens','contato')),
  status text not null check (status in ('no_site','carregando','so_portal','nao_publica','desconhecido')),
  reason text not null,
  evidence_url text,
  checked_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, dataset)
);
create index on data_coverage (dataset, status);

-- feed do "Monitorando": o ETL escreve um evento por fato novo de cada pessoa
create table activity_events (
  id bigint generated always as identity primary key,
  person_id uuid not null references people(id) on delete cascade,
  kind text not null check (kind in ('voto','proposta','lei','gasto','discurso','mandato','patrimonio','partido')),
  occurred_at timestamptz not null,
  title text not null,
  ref_table text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, ref_table, ref_id, person_id)
);
create index on activity_events (person_id, occurred_at desc);

-- casamento abaixo de 0,9: o fato fica em staging (sem person_id) e NÃO aparece no crachá
create table identity_match_queue (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  external_id text not null,
  raw jsonb not null,                       -- nome, nascimento, UF como a fonte publica
  candidate_person_id uuid references people(id) on delete set null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  status text not null default 'pendente' check (status in ('pendente','aceito','rejeitado','nova_pessoa')),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index on identity_match_queue (status, created_at);
create index on identity_match_queue (candidate_person_id);

-- =====================================================================
-- Governos, STF, Impostômetro
-- =====================================================================
create table government_terms (
  id uuid primary key default gen_random_uuid(),
  sphere text not null check (sphere in ('federal','estadual','municipal')),
  place_id uuid not null references places(id) on delete restrict,
  person_id uuid not null references people(id) on delete restrict,
  party_id uuid references parties(id) on delete restrict,
  role text not null default 'titular' check (role in ('titular','interino','em_exercicio')),
                                            -- interino: Temer 12/05–31/08/2016; em_exercicio: vice/pres. da Câmara durante viagem
  started_on date not null,
  ended_on date,
  interrupted boolean not null default false,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint government_term_key unique (sphere, place_id, person_id, role, started_on),
  constraint one_titular_at_a_time exclude using gist (
    place_id with =, sphere with =, daterange(started_on, ended_on, '[)') with &&) where (role = 'titular'),
  constraint one_acting_at_a_time exclude using gist (
    place_id with =, sphere with =, daterange(started_on, ended_on, '[)') with &&) where (role <> 'titular')
);
create index on government_terms (person_id);
create index on government_terms (party_id);

create table yearly_indicators (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  year smallint not null,
  indicator text not null,                  -- 'pib_real_var', 'ipca', 'desemprego'...
  value numeric not null,
  unit text not null,
  source_id uuid not null references sources(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, indicator, year)
);
create index on yearly_indicators (source_id);

create table corporate_card_expenses (
  id bigint generated always as identity primary key,
  government_term_id uuid references government_terms(id) on delete set null,
  occurred_on date not null,
  category text,
  supplier_name text,
  amount_cents bigint not null,
  currency char(3) not null default 'BRL',
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on corporate_card_expenses (government_term_id, occurred_on);

create table tax_revenues (
  id uuid primary key default gen_random_uuid(),
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  uf char(2),                               -- null = nacional
  tax text not null,
  amount_cents bigint not null,
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (year, month, uf, tax)
);

create table stf_ministers (
  id uuid primary key default gen_random_uuid(),
  name text not null collate pt_br,
  appointed_by_term_id uuid references government_terms(id) on delete set null,
  took_office_on date not null,
  left_on date,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, took_office_on)
);
create index on stf_ministers (appointed_by_term_id);

create table stf_cases (
  id uuid primary key default gen_random_uuid(),
  class text not null,                      -- ADI, ADPF, RE...
  number text not null,
  title text not null,
  rapporteur_id uuid references stf_ministers(id) on delete set null,
  status text not null check (status in ('pautado','em_julgamento','julgado','vista','destaque','adiado','sem_data')),
  last_event_on date,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class, number)
);
create index on stf_cases (rapporteur_id);
create index on stf_cases (status, last_event_on desc);

create table stf_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references stf_cases(id) on delete cascade,
  occurred_on date not null,
  kind text not null check (kind in ('pauta','julgamento','vista','destaque','adiamento','decisao')),
  description text not null,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on stf_case_events (case_id, occurred_on desc);
create index on stf_case_events (occurred_on);

-- =====================================================================
-- Usuários (único dado com dono)
-- =====================================================================
-- auth.users vem do Supabase Auth (OTP por e-mail, sem senha)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,   -- LGPD: apagar conta apaga tudo
  digest text not null default 'weekly' check (digest in ('daily','weekly','off')),
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, person_id)
);
create index on follows (person_id);

create table digest_deliveries (            -- idempotência: um digest por usuário por janela
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  events_count int not null,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, window_start)
);

create table suggestions (                  -- /sugestoes e "Reportar erro"
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ideia','informacao_faltando','algo_errado','fonte_de_dados','outro','direito_resposta')),
  body text not null check (length(body) between 5 and 5000),
  name text not null,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city text,
  person_id uuid references people(id) on delete set null,
  page_path text,
  status text not null default 'nova' check (status in ('nova','em_analise','corrigida','recusada','spam')),
  ip_hash text not null,                    -- hash com sal diário, só p/ rate limit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on suggestions (status, created_at desc);
create index on suggestions (person_id);

-- direito de resposta e correção: o que mudou, por quê, em resposta a quem (público em /atualizacoes e no crachá)
create table corrections (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) on delete set null,
  entity_table text not null,
  entity_ref text not null,
  field text not null,
  before_value text,
  after_value text,
  reason text not null,
  evidence_url text not null,               -- fonte oficial que justifica
  suggestion_id uuid references suggestions(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on corrections (person_id, published_at desc);
create index on corrections (suggestion_id);


-- =====================================================================
-- Analytics próprios (Mais vistos), sem PII
-- =====================================================================
create table page_views (                   -- bruto, retenção 7 dias
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  path text not null,
  entity_kind text check (entity_kind in ('person','place','party','compare','section')),
  entity_key text,                          -- slug, ibge, ou slugs ordenados do comparador
  referrer_host text,
  device text check (device in ('mobile','desktop','tablet')),
  uf char(2),                               -- geo do edge, nunca IP
  visitor_hash text not null,               -- hash(ip+ua+sal diário): conta únicos sem identificar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on page_views (occurred_at);
create index on page_views (entity_kind, entity_key, occurred_at);

create table page_view_hourly (
  hour timestamptz not null,
  entity_kind text not null,
  entity_key text not null,
  views int not null,
  visitors int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hour, entity_kind, entity_key)
);
create index on page_view_hourly (entity_kind, entity_key, hour desc);

-- =====================================================================
-- updated_at em todas as tabelas
-- =====================================================================
do $$
declare t text;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
-- O Next.js lê via conexão Postgres (pooler) como web_reader. A Data API (PostgREST) do Supabase
-- fica DESLIGADA para o schema public: anon key não varre votes/expenses. Toda escrita de usuário
-- passa por server action. As policies de dono abaixo são defesa em profundidade.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'web_reader') then
    create role web_reader nologin;
  end if;
end $$;
grant usage on schema public, extensions to web_reader;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I enable row level security', t);
    if t not in ('profiles','follows','digest_deliveries','suggestions','page_views','ingest_runs',
                 'person_external_ids','identity_match_queue') then
      execute format('grant select on %I to web_reader', t);
      execute format('create policy public_read on %I for select to web_reader using (true)', t);
    end if;
  end loop;
end $$;
-- sem policy = só service_role (bypass RLS): tabelas internas, PII e casamentos de identidade

create policy own_profile_select on profiles for select to authenticated using (id = auth.uid());
create policy own_profile_insert on profiles for insert to authenticated with check (id = auth.uid());
create policy own_profile_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy own_profile_delete on profiles for delete to authenticated using (id = auth.uid());

create policy own_follows_select on follows for select to authenticated using (user_id = auth.uid());
create policy own_follows_insert on follows for insert to authenticated with check (user_id = auth.uid());
create policy own_follows_delete on follows for delete to authenticated using (user_id = auth.uid());

-- limite de 200 monitorados por usuário (abuso do digest)
create or replace function follows_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from follows where user_id = new.user_id) >= 200 then
    raise exception 'follow_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger follows_limit before insert on follows for each row execute function follows_limit();

-- partido na data de hoje: S07, hemiciclo e crachá leem daqui, não de mandates.party_id
create view person_current_party with (security_invoker = true) as
  select pm.person_id, pm.party_id, pm.from_on
  from party_memberships pm
  where pm.from_on <= current_date and (pm.to_on is null or pm.to_on > current_date);
grant select on person_current_party to web_reader;

-- =====================================================================
-- Seeds fixos
-- =====================================================================
insert into offices (slug, name_m, name_f, level) values
  ('presidente','Presidente','Presidenta','federal'),
  ('vice_presidente','Vice-presidente','Vice-presidente','federal'),
  ('senador','Senador','Senadora','federal'),
  ('deputado_federal','Deputado federal','Deputada federal','federal'),
  ('governador','Governador','Governadora','estadual'),
  ('vice_governador','Vice-governador','Vice-governadora','estadual'),
  ('deputado_estadual','Deputado estadual','Deputada estadual','estadual'),
  ('deputado_distrital','Deputado distrital','Deputada distrital','estadual'),
  ('prefeito','Prefeito','Prefeita','municipal'),
  ('vice_prefeito','Vice-prefeito','Vice-prefeita','municipal'),
  ('vereador','Vereador','Vereadora','municipal');
