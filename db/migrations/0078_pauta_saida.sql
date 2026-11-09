-- Estado "saiu da pauta" (Regra 2 do canvas "No seu bolso"), corrigido em 03/11/2026.
-- A diferença simples entre leituras confundia proposta retirada com reunião que já aconteceu: o job descartava
-- reuniões encerradas e as propostas delas sumiam da leitura seguinte. Agora cada leitura guarda também os eventos
-- (inclusive encerrados e cancelados), e a saída de uma proposta é explicada pelo primeiro evento lido depois dela.

-- Evento (sessão ou reunião) visto numa leitura. Itens de pauta só vêm de eventos marcados ou em andamento.
create table pauta_events (
  id uuid primary key default gen_random_uuid(),
  read_id uuid not null references pauta_reads(id) on delete cascade,
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  event_ref text not null,                  -- mesmo formato de pauta_items.event_ref
  state text not null check (state in ('marcada', 'em_andamento', 'encerrada', 'cancelada')),
  official_status text,                     -- situação como a Casa publica (Convocada, Encerrada (Final)...); nunca vai para a tela
  pauta_loaded boolean not null,            -- false: a pauta não carregou (está em failed_refs) ou não foi pedida (encerrada/cancelada)
  stage text not null check (stage in ('plenario', 'comissao')),
  committee text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (read_id, event_ref)
);
create index on pauta_events (body_id, event_ref);

-- Proposta que estava numa leitura dos últimos 14 dias e não está na última leitura da Casa.
-- outcome:
--   saiu_da_pauta     a reunião seguiu marcada (ou sumiu da agenda) sem a proposta: retirada de verdade
--   reuniao_encerrada a reunião aconteceu; o resultado vem das votações, não deste estado
--   reuniao_cancelada a reunião foi cancelada
--   sem_leitura       a pauta da reunião não carregou desde então; não dá para afirmar nada
--   sem_registro      a reunião já passou e nenhuma leitura a viu de novo; não dá para afirmar nada
-- Só "saiu_da_pauta" vira o estado público "Saiu da pauta". Os dois "sem_" nunca aparecem como saída.
create view pauta_exits with (security_invoker = true) as
with latest as (
  select distinct on (body_id) id, body_id, read_at, window_start, failed_refs
  from pauta_reads order by body_id, read_at desc
), seen as (
  select i.body_id, i.prop_type, i.prop_number, i.prop_year, max(r.read_at) as last_seen_at
  from pauta_items i join pauta_reads r on r.id = i.read_id
  where r.read_at >= now() - interval '14 days'
  group by 1, 2, 3, 4
), gone as (
  select distinct on (s.body_id, s.prop_type, s.prop_number, s.prop_year, i.event_ref)
         i.*, s.last_seen_at, l.read_at as latest_read_at, l.window_start as latest_window_start,
         l.failed_refs as latest_failed_refs, l.id as latest_id
  from seen s
  join latest l on l.body_id = s.body_id and s.last_seen_at < l.read_at
  join pauta_reads r on r.body_id = s.body_id and r.read_at = s.last_seen_at
  join pauta_items i on i.read_id = r.id and (i.prop_type, i.prop_number, i.prop_year) = (s.prop_type, s.prop_number, s.prop_year)
)
select g.body_id, g.proposal_id, g.prop_type, g.prop_number, g.prop_year, g.summary_official, g.stage, g.committee,
       g.scheduled_for, g.event_ref, g.official_url, g.last_seen_at,
       coalesce(e.read_at, g.latest_read_at) as decided_at,
       case
         when e.state = 'encerrada' then 'reuniao_encerrada'
         when e.state = 'cancelada' then 'reuniao_cancelada'
         when e.state is not null then 'saiu_da_pauta'
         -- falha de um evento (Câmara) ou da agenda inteira do Senado ("plenario:AAAA-MM", "comissoes")
         when g.event_ref = any (g.latest_failed_refs)
           or (g.stage = 'comissao' and 'comissoes' = any (g.latest_failed_refs))
           or 'plenario:' || to_char(g.scheduled_for at time zone 'America/Sao_Paulo', 'YYYY-MM') = any (g.latest_failed_refs)
           then 'sem_leitura'
         when not exists (select 1 from pauta_events x where x.read_id = g.latest_id) then 'sem_leitura'
         when (g.scheduled_for at time zone 'America/Sao_Paulo')::date < g.latest_window_start then 'sem_registro'
         else 'saiu_da_pauta'
       end as outcome
from gone g
left join lateral (
  -- primeiro evento conclusivo depois da última vez que a proposta foi vista
  select e.state, r.read_at from pauta_events e join pauta_reads r on r.id = e.read_id
  where e.body_id = g.body_id and e.event_ref = g.event_ref and r.read_at > g.last_seen_at
    and (e.pauta_loaded or e.state in ('encerrada', 'cancelada'))
  order by r.read_at
  limit 1
) e on true;

alter table pauta_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'web_reader') then
    grant select on pauta_events, pauta_exits to web_reader;
    create policy public_read on pauta_events for select to web_reader using (true);
  end if;
end $$;
