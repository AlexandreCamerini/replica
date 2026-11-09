-- Pauta do Congresso e a contagem "mexe no bolso" (proposta "No seu bolso", decisões D1, D2, D3, D5 de 03/11/2026).
-- Cada leitura da pauta é guardada inteira: o número na tela sai sempre da última leitura de cada Casa,
-- e a diferença entre duas leituras dá o estado "saiu da pauta".

-- Regra 1, versionada e pública (/como-escolhemos lê daqui). Mudar a regra = nova linha, nunca update.
create table pocket_rules (
  version int primary key,
  topic_slugs text[] not null,              -- temas do produto (topics.slug) cujos temas oficiais da Câmara contam
  terms text[] not null,                    -- termos exibidos ao público, com acento
  term_pattern text not null,               -- regex sobre f_unaccent(lower(ementa)); espelha `terms`
  published_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into pocket_rules (version, topic_slugs, terms, term_pattern, published_on) values (
  1,
  array['economia', 'trabalho', 'assistencia'],
  array['tributo', 'imposto', 'alíquota', 'contribuição', 'salário', 'benefício', 'aposentadoria', 'pensão',
        'tarifa', 'preço', 'juros', 'crédito', 'FGTS', 'renda', 'dívida'],
  '\m(tribut|impost|aliquot|contribuic|salari|benefici|aposentad|pensao|pensoes|tarifa|preco|juros|credito|fgts|renda|divida)',
  date '2026-11-03'
);

-- Uma leitura da pauta de uma Casa. events_failed > 0 => a tela mostra "pelo menos N" (D5).
create table pauta_reads (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  run_id uuid references ingest_runs(id) on delete set null,
  read_at timestamptz not null default now(),
  window_start date not null,
  window_end date not null,
  events_total int not null,
  events_failed int not null,
  failed_refs text[] not null default '{}',  -- ids de evento/reunião cuja pauta não carregou
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on pauta_reads (body_id, read_at desc);

-- Um item de pauta já resolvido para a proposição (parecer PRL/PAR sobe para a proposição relacionada).
create table pauta_items (
  id uuid primary key default gen_random_uuid(),
  read_id uuid not null references pauta_reads(id) on delete cascade,
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  proposal_id uuid references proposals(id) on delete set null,
  prop_type text not null,
  prop_number int not null,
  prop_year smallint not null,
  summary_official text,                    -- ementa; null quando a pauta não traz (comissões do Senado)
  official_themes text[] not null default '{}', -- temas oficiais da Câmara; vazio no Senado
  stage text not null check (stage in ('plenario', 'comissao')),
  committee text,                           -- sigla da comissão quando stage = 'comissao'
  scheduled_for timestamptz not null,
  regime text,
  rapporteur text,
  event_ref text not null,
  official_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (read_id, prop_type, prop_number, prop_year, event_ref)
);
create index on pauta_items (body_id, prop_type, prop_number, prop_year);
create index on pauta_items (proposal_id);

-- Itens da última leitura de cada Casa, com o motivo de entrada pela regra vigente.
create view pauta_current with (security_invoker = true) as
with latest as (
  select distinct on (body_id) id, body_id, read_at, events_failed
  from pauta_reads order by body_id, read_at desc
), rule as (
  select * from pocket_rules order by version desc limit 1
)
select i.*, l.read_at, l.events_failed > 0 as read_incomplete, r.version as rule_version,
       (select array_agg(distinct th) from topics t, unnest(i.official_themes) th
         where t.slug = any (r.topic_slugs) and th = any (t.keywords)) as matched_themes,
       substring(f_unaccent(lower(coalesce(i.summary_official, ''))) from r.term_pattern) as matched_term,
       b.kind = 'camara_deputados' as is_camara
from pauta_items i
join latest l on l.id = i.read_id
join legislative_bodies b on b.id = i.body_id
cross join rule r;

-- Passa na Regra 1 (D2: tema econômico E termo na ementa; D3: Senado só termo, sem tema oficial).
create view pauta_bolso with (security_invoker = true) as
select * from pauta_current
where matched_term is not null
  and (not is_camara or matched_themes is not null);

-- O número da entrada (D1): plenário, semana corrente (segunda a domingo, horário de Brasília), uma vez por proposição.
create view pocket_week_count with (security_invoker = true) as
with wk as (
  select (date_trunc('week', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo' as starts,
         (date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '7 days') at time zone 'America/Sao_Paulo' as ends
)
select count(distinct (p.body_id, p.prop_type, p.prop_number, p.prop_year)) as total,
       bool_or(p.read_incomplete) or exists (select 1 from pauta_reads ar
         where ar.id in (select distinct on (body_id) id from pauta_reads order by body_id, read_at desc) and ar.events_failed > 0) as at_least,
       (select min(read_at) from (select distinct on (body_id) read_at from pauta_reads order by body_id, read_at desc) x) as read_at,
       (select starts from wk) as week_starts,
       (select ends from wk) as week_ends
from pauta_bolso p, wk
where p.stage = 'plenario' and p.scheduled_for >= wk.starts and p.scheduled_for < wk.ends;

-- Leitura pública, como o resto do schema (0001 › web_reader).
do $$
declare t text;
begin
  foreach t in array array['pocket_rules', 'pauta_reads', 'pauta_items'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'web_reader') then
      execute format('grant select on %I to web_reader', t);
      execute format('create policy public_read on %I for select to web_reader using (true)', t);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'web_reader') then
    grant select on pauta_current, pauta_bolso, pocket_week_count to web_reader;
  end if;
end $$;
