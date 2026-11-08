-- W3-B / D125: agenda e pauta de plenário do Congresso (sem tela por enquanto).
-- Fontes: Câmara /api/v2/eventos?idOrgao=180 + /eventos/{id}/pauta; Senado /dadosabertos/plenario/agenda/mes/{AAAAMMDD} (SF e CN).
-- Tabelas próprias (não `sessions`): sessão agendada não pode entrar no denominador de presença; o vínculo com a sessão
-- realizada fica em session_id quando o código da fonte bate com sessions.source_key.
create table agenda_events (
  id bigint generated always as identity primary key,
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  house text not null check (house in ('camara', 'senado', 'congresso')),   -- congresso = sessão do CN listada pelo Senado
  source_key text not null,                 -- Câmara: id do evento; Senado: CodigoSessao
  session_id uuid references sessions(id) on delete set null,
  starts_at timestamptz not null,           -- horário de Brasília convertido
  kind text not null,                       -- tipo como a fonte escreve (Sessão Deliberativa, SESSÃO DELIBERATIVA ORDINÁRIA...)
  title text,
  status text not null,                     -- situação como a fonte escreve (Convocada, Encerrada, Sessão não realizada...)
  location text,
  official_url text,
  source_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (house, source_key)
);
create index on agenda_events (starts_at);
create index on agenda_events (body_id, starts_at desc);

create table agenda_items (
  id bigint generated always as identity primary key,
  agenda_event_id bigint not null references agenda_events(id) on delete cascade,
  position int not null,
  proposal_id uuid references proposals(id) on delete set null,   -- só quando a matéria já está em proposals
  proposal_type text, proposal_number int, proposal_year smallint,
  source_proposal_id text,                  -- Câmara: id da proposição; Senado: CodigoMateria
  title text not null,                      -- "PL 3099/2019" / identificação da fonte
  summary text,                             -- ementa
  topic text,                               -- Câmara: tópico; Senado: tipo de pauta (Ordem do Dia, Extrapauta)
  regime text,                              -- Câmara: regime de tramitação; Senado: apreciação
  rapporteur text,
  outcome_text text,                        -- situação do item como a fonte escreve; sem normalizar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agenda_event_id, position)
);
create index on agenda_items (proposal_id);

alter table agenda_events enable row level security;
alter table agenda_items enable row level security;
grant select on agenda_events, agenda_items to web_reader;
create policy public_read on agenda_events for select to web_reader using (true);
create policy public_read on agenda_items for select to web_reader using (true);
create trigger set_updated_at before update on agenda_events for each row execute function set_updated_at();
create trigger set_updated_at before update on agenda_items for each row execute function set_updated_at();
