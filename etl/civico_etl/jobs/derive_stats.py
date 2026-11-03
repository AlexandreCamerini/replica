"""derive.stats: person_period_stats (carreira e por ano) e cobertura padrão de dados. Só SQL. Depois, revalida o site.

Regras (publicadas em replica/backend.md):
  * null = a casa da pessoa não tem adapter de dados abertos carregado. Nunca vira 0.
  * presença = lista oficial de presença em sessões deliberativas do Plenário (só Câmara; Senado não publica -> null).
  * partido atual = linha do tempo de observações datadas (Câmara /historico, Senado filiações, candidaturas TSE) -> party_memberships.
  * vacância: desincompatibilização (CF art. 14 §6) e posse em cargo incompatível encerram o mandato anterior (MANDATE_RULES).
  * fidelidade = votos sim/não iguais à orientação do partido na data do voto, entre votações com orientação.
  * temas = top 3 por proposições de autoria/coautoria.
"""

from __future__ import annotations

import logging
import os
from datetime import date

import httpx
import psycopg

log = logging.getLogger("etl.derive")

STATS_SQL = r"""
with periods as (
  select m.person_id, 'career' as period, null::int as year
  from mandates m group by m.person_id
  union
  select m.person_id, y::text, y
  from mandates m,
       generate_series(extract(year from m.started_on)::int, least(extract(year from m.ends_on - 1)::int, extract(year from current_date)::int)) y
  where m.status <> 'eleito_aguardando_posse'
),
-- o que já foi carregado, por fonte, tipo e ano (runs bem-sucedidos). Ano sem carga -> null, nunca 0.
-- presença: só a lista oficial (camara.presenca.AAAA). Senado não publica: nunca entra -> null ("—").
-- senado.autorias traz a carreira inteira de cada senador: cobre todos os anos.
loaded as (
  select distinct split_part(dataset, '.', 1) as src, split_part(dataset, '.', 2) as kind, split_part(dataset, '.', 3)::int as year
  from ingest_runs
  where status = 'succeeded' and dataset ~ '^(camara|senado)\.(votacoes|proposicoes|despesas|presenca)\.[0-9]{4}$'
  union
  select 'senado', 'proposicoes', y from generate_series(1980, extract(year from current_date)::int) y
  where exists (select 1 from ingest_runs where status = 'succeeded' and dataset = 'senado.autorias')
),
person_src as (
  select distinct m.person_id, case b.adapter when 'camara_api' then 'camara' when 'senado_api' then 'senado' end as src
  from mandates m join legislative_bodies b on b.id = m.body_id
  where b.adapter in ('camara_api', 'senado_api')
),
has_src as (
  select pe.person_id, pe.period,
         bool_or(exists (select 1 from loaded l where l.src = ps.src and l.kind = 'votacoes' and (pe.year is null or l.year = pe.year))) as votes_src,
         bool_or(exists (select 1 from loaded l where l.src = ps.src and l.kind = 'proposicoes' and (pe.year is null or l.year = pe.year))) as props_src,
         bool_or(exists (select 1 from loaded l where l.src = ps.src and l.kind = 'despesas' and (pe.year is null or l.year = pe.year))) as exp_src,
         bool_or(exists (select 1 from loaded l where l.src = ps.src and l.kind = 'presenca' and (pe.year is null or l.year = pe.year))) as pres_src
  from periods pe join person_src ps on ps.person_id = pe.person_id
  group by 1, 2
),
pres as (
  select a.person_id, extract(year from s.starts_at)::int as year,
         count(*) filter (where a.status = 'presente') present,
         count(*) filter (where a.status in ('presente','ausente','ausencia_justificada')) total
  from attendance a join sessions s on s.id = a.session_id
  group by 1, 2
),
props as (
  select pa.person_id, p.year,
         count(*) filter (where pa.role = 'principal') principal,
         count(*) filter (where pa.role <> 'principal') cosigned,
         count(*) filter (where p.can_become_law) law_eligible,
         count(*) filter (where p.became_law_id is not null) laws
  from proposal_authors pa join proposals p on p.id = pa.proposal_id
  group by 1, 2
),
-- uma orientação por (votação, partido): rótulos diferentes do mesmo partido ('PODE' e 'Podemos', 'PR' e 'PL' em 2019)
-- viram atores distintos e multiplicavam o voto no join (pego pelo check de carreira na carga 2019-2022)
porient as (
  select distinct on (po.voting_event_id, oa.party_id) po.voting_event_id, oa.party_id, po.orientation
  from party_orientations po join orientation_actors oa on oa.id = po.actor_id
  where oa.kind = 'partido' and oa.party_id is not null
  order by po.voting_event_id, oa.party_id, po.orientation
),
vt as (
  select v.person_id, extract(year from e.occurred_at)::int as year,
         count(*) filter (where v.value <> 'nao_votou') registered,
         count(*) filter (where v.value in ('sim','nao') and po.orientation in ('sim','nao') and v.value = po.orientation) aligned,
         count(*) filter (where v.value in ('sim','nao') and po.orientation in ('sim','nao')) alignment_total
  from votes v
  join voting_events e on e.id = v.voting_event_id
  left join porient po on po.voting_event_id = e.id and po.party_id = v.party_id
  group by 1, 2
),
exp as (
  select person_id, extract(year from occurred_on)::int as year, sum(amount_cents) cents from expenses group by 1, 2
),
topics as (
  select pa.person_id, p.year, t.slug, count(*) n
  from proposal_authors pa join proposals p on p.id = pa.proposal_id
  join proposal_topics pt on pt.proposal_id = p.id join topics t on t.id = pt.topic_id
  group by 1, 2, 3
),
-- cada métrica vira (pessoa, período) antes do join: sem isso 'career' multiplica as linhas dos anos (produto cartesiano)
pres2 as (
  select person_id, year::text as period, present, total from pres
  union all select person_id, 'career', sum(present), sum(total) from pres group by 1
),
props2 as (
  select person_id, year::text as period, principal, cosigned, law_eligible, laws from props
  union all select person_id, 'career', sum(principal), sum(cosigned), sum(law_eligible), sum(laws) from props group by 1
),
vt2 as (
  select person_id, year::text as period, registered, aligned, alignment_total from vt
  union all select person_id, 'career', sum(registered), sum(aligned), sum(alignment_total) from vt group by 1
),
speech2 as (
  select person_id, extract(year from occurred_at)::int::text as period, count(*) n from speeches group by 1, 2
  union all select person_id, 'career', count(*) from speeches group by 1
),
comm2 as (
  select person_id, count(distinct committee_id) n from committee_memberships where to_on is null or to_on >= current_date group by 1
),
exp2 as (
  select person_id, year::text as period, cents from exp
  union all select person_id, 'career', sum(cents) from exp group by 1
),
agg as (
  select pe.person_id, pe.period,
         coalesce(hs.votes_src, false) as votes_src, coalesce(hs.props_src, false) as props_src, coalesce(hs.exp_src, false) as exp_src, coalesce(hs.pres_src, false) as pres_src,
         pr.present, pr.total,
         pp.principal, pp.cosigned, pp.law_eligible, pp.laws,
         v.registered, v.aligned, v.alignment_total,
         ex.cents, sp.n as speeches_n, cm.n as committees_n
  from periods pe
  left join has_src hs on hs.person_id = pe.person_id and hs.period = pe.period
  left join pres2 pr on pr.person_id = pe.person_id and pr.period = pe.period
  left join props2 pp on pp.person_id = pe.person_id and pp.period = pe.period
  left join vt2 v on v.person_id = pe.person_id and v.period = pe.period
  left join exp2 ex on ex.person_id = pe.person_id and ex.period = pe.period
  left join speech2 sp on sp.person_id = pe.person_id and sp.period = pe.period
  left join comm2 cm on cm.person_id = pe.person_id
),
tops as (
  select pe.person_id, pe.period,
         coalesce((select jsonb_agg(jsonb_build_object('topic_slug', slug, 'proposals', n) order by n desc)
                   from (select t.slug, sum(t.n) n from topics t where t.person_id = pe.person_id and (pe.year is null or t.year = pe.year) group by 1 order by 2 desc limit 3) x), '[]'::jsonb) top
  from periods pe
)
insert into person_period_stats (person_id, period, presence_present, presence_total, proposals_principal, proposals_cosigned,
  proposals_law_eligible, laws_from_proposals, votes_registered, party_aligned, party_alignment_total, expenses_cents, speeches, committees, top_topics, missing_datasets, computed_at)
select a.person_id, a.period,
  case when a.pres_src and a.total > 0 then a.present end,
  case when a.pres_src and a.total > 0 then a.total end,
  case when a.props_src then coalesce(a.principal, 0) end,
  case when a.props_src then coalesce(a.cosigned, 0) end,
  case when a.props_src then coalesce(a.law_eligible, 0) end,
  case when a.props_src then coalesce(a.laws, 0) end,
  case when a.votes_src then coalesce(a.registered, 0) end,
  case when a.votes_src then coalesce(a.aligned, 0) end,
  case when a.votes_src then coalesce(a.alignment_total, 0) end,
  case when a.exp_src then coalesce(a.cents, 0) end,
  case when a.votes_src then coalesce(a.speeches_n, 0) end,
  case when a.votes_src then coalesce(a.committees_n, 0) end,
  t.top,
  array_remove(array[
    case when not a.pres_src then 'presenca' end, case when not a.votes_src then 'votos' end,
    case when not a.props_src then 'propostas' end, case when not a.exp_src then 'gastos_gabinete' end], null),
  now()
from agg a join tops t on t.person_id = a.person_id and t.period = a.period
on conflict (person_id, period) do update set
  presence_present = excluded.presence_present, presence_total = excluded.presence_total,
  proposals_principal = excluded.proposals_principal, proposals_cosigned = excluded.proposals_cosigned,
  proposals_law_eligible = excluded.proposals_law_eligible, laws_from_proposals = excluded.laws_from_proposals,
  votes_registered = excluded.votes_registered, party_aligned = excluded.party_aligned, party_alignment_total = excluded.party_alignment_total,
  expenses_cents = excluded.expenses_cents, speeches = excluded.speeches, committees = excluded.committees, top_topics = excluded.top_topics, missing_datasets = excluded.missing_datasets,
  computed_at = excluded.computed_at, updated_at = now()
"""


# D05: partido = linha do tempo. Observação mais recente vence; no mesmo dia, a casa (prio 1) vence o TSE (prio 0).
# Candidatura do TSE observa o partido na data do 1º turno (filiação exigida 6 meses antes: aproximação conservadora).
PARTY_SQL = r"""
with obs as (
  select person_id, party_id, observed_on, 1 as prio from party_observations
  union all
  select c.person_id, c.party_id, e.held_on, 0 from candidacies c join elections e on e.id = c.election_id
  where c.party_id is not null and e.held_on <= current_date
),
d as (select distinct on (person_id, observed_on) person_id, party_id, observed_on from obs where observed_on <= current_date order by person_id, observed_on, prio desc),
r as (select *, lag(party_id) over (partition by person_id order by observed_on) as prev from d),
s as (select person_id, party_id, observed_on as from_on from r where prev is distinct from party_id)
select person_id, party_id, from_on, lead(from_on) over (partition by person_id order by from_on) as to_on from s
"""

# D06: vacância que o TSE não publica como status, derivada de regra constitucional. Só mexe em mandato cujo status é do TSE
# (status_source = 'tse'); Câmara e Senado continuam donos do status dos seus. Idempotente.
MANDATE_RULES = [
    (
        "desincompatibilização: governador/prefeito candidato a outro cargo renuncia 6 meses antes do 1º turno (CF art. 14 §6)",
        r"""update mandates m set status = 'renunciou', ends_on = x.deadline, updated_at = now()
            from (
              select distinct on (m.id) m.id, (e.held_on - interval '6 months')::date as deadline
              from mandates m join offices o on o.id = m.office_id
              join candidacies c on c.person_id = m.person_id
              join elections e on e.id = c.election_id and e.kind = 'geral' and e.round = 1
              join contests ct on ct.id = c.contest_id
              where o.slug in ('governador','prefeito') and m.status = 'em_exercicio' and m.status_source = 'tse'
                and (ct.office_id <> m.office_id or ct.place_id <> m.place_id)
                and (e.held_on - interval '6 months')::date > m.started_on and (e.held_on - interval '6 months')::date < m.ends_on
                and (e.held_on - interval '6 months')::date <= current_date
              order by m.id, e.held_on) x
            where m.id = x.id""",
    ),
    (
        "sucessão: vice assume o cargo do titular que renunciou (mandato novo de titular; a vaga de vice fica vazia)",
        r"""insert into mandates (person_id, office_id, place_id, body_id, party_id, candidacy_id, role, status, started_on, ends_on, elected_by, status_source)
            select v.person_id, t.office_id, t.place_id, null, v.party_id, v.candidacy_id, 'titular', 'em_exercicio', t.ends_on, v.ends_on,
                   'sucessão: vice assumiu (titular renunciou para concorrer)', 'tse'
            from mandates t join offices o on o.id = t.office_id
            join offices ov on ov.slug = case o.slug when 'governador' then 'vice_governador' when 'prefeito' then 'vice_prefeito' end
            join mandates v on v.office_id = ov.id and v.place_id = t.place_id and v.started_on = t.started_on
                           and v.status = 'em_exercicio' and v.status_source = 'tse' and v.ends_on > t.ends_on
            where t.status = 'renunciou' and t.status_source = 'tse' and o.slug in ('governador','prefeito')
              and coalesce(t.elected_by, '') not like 'sucessão%%'
              -- vice que concorreu a um terceiro cargo na mesma eleição não assume nos 6 meses (CF art. 14 §6): não presume sucessor
              and not exists (select 1 from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
                              where c.person_id = v.person_id and e.kind = 'geral' and e.round = 1 and (e.held_on - interval '6 months')::date = t.ends_on
                                and ct.office_id not in (v.office_id, t.office_id))
            on conflict (person_id, office_id, place_id, started_on) do nothing""",
    ),
    (
        "vice que concorreu a terceiro cargo não pode suceder (ficaria inelegível): deixa o cargo na mesma data; o interino (presidente da casa) não está no TSE",
        r"""update mandates v set status = 'renunciou', ends_on = t.ends_on, updated_at = now()
            from mandates t join offices o on o.id = t.office_id
            join offices ov on ov.slug = case o.slug when 'governador' then 'vice_governador' when 'prefeito' then 'vice_prefeito' end
            where v.office_id = ov.id and v.place_id = t.place_id and v.started_on = t.started_on and v.status = 'em_exercicio' and v.status_source = 'tse'
              and v.ends_on > t.ends_on and t.status = 'renunciou' and t.status_source = 'tse' and o.slug in ('governador','prefeito')
              and coalesce(t.elected_by, '') not like 'sucessão%%'
              and not exists (select 1 from mandates s where s.elected_by like 'sucessão%%' and s.office_id = t.office_id and s.place_id = t.place_id and s.started_on = t.ends_on)
              and exists (select 1 from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
                          where c.person_id = v.person_id and e.kind = 'geral' and e.round = 1 and (e.held_on - interval '6 months')::date = t.ends_on
                            and ct.office_id not in (v.office_id, t.office_id))""",
    ),
    (
        "vaga de vice: o vice que assumiu deixa o cargo de vice na data da sucessão",
        r"""update mandates v set status = 'encerrado', ends_on = s.started_on, updated_at = now()
            from mandates s
            where s.elected_by like 'sucessão%%' and s.person_id = v.person_id and s.place_id = v.place_id and s.started_on > v.started_on
              and v.status = 'em_exercicio' and v.status_source = 'tse' and v.ends_on > s.started_on""",
    ),
    (
        "posse em cargo incompatível: o mandato anterior acaba na posse do novo (CF arts. 29, 38 e 54); casa legislativa federal fora",
        r"""update mandates a set status = 'renunciou', ends_on = b.started_on, updated_at = now()
            from mandates b
            where b.person_id = a.person_id and b.office_id <> a.office_id and b.started_on > a.started_on and b.started_on < a.ends_on
              and b.started_on <= current_date and b.status in ('em_exercicio','licenciado','afastado')
              and a.status = 'em_exercicio' and a.status_source = 'tse'
              and not (b.elected_by like 'sucessão%%')""",
    ),
]

# cobertura padrão: só insere o que ainda não foi auditado (on conflict do nothing)
COVERAGE_SQL = """
insert into data_coverage (place_id, dataset, status, reason, checked_on)
select p.id, d.dataset, d.status, d.reason, current_date
from places p
cross join lateral (
  select * from (values
    ('presenca', 'carregando', 'a Assembleia publica; a carga do nível estadual entra na próxima fase'),
    ('votos', 'carregando', 'a Assembleia publica; a carga do nível estadual entra na próxima fase'),
    ('propostas', 'carregando', 'a Assembleia publica; a carga do nível estadual entra na próxima fase'),
    ('gastos_gabinete', 'desconhecido', 'ainda não conferimos se a Assembleia publica em dado aberto'),
    ('salario_deputados_estaduais', 'desconhecido', 'ainda não conferimos onde a Assembleia publica')
  ) v(dataset, status, reason) where p.kind = 'uf'
  union all
  select * from (values
    ('salario_prefeito', 'desconhecido', 'ainda não conferimos onde a prefeitura publica'),
    ('salario_vereadores', 'desconhecido', 'ainda não conferimos onde a câmara publica'),
    ('presenca', 'desconhecido', 'ainda não conferimos se a câmara publica em dado aberto'),
    ('votos', 'desconhecido', 'ainda não conferimos se a câmara publica em dado aberto'),
    ('propostas', 'desconhecido', 'ainda não conferimos se a câmara publica em dado aberto'),
    ('gastos_gabinete', 'desconhecido', 'ainda não conferimos se a câmara publica em dado aberto')
  ) v(dataset, status, reason) where p.kind = 'municipio'
) d
on conflict (place_id, dataset) do nothing
"""


def run_derive(conn: psycopg.Connection) -> None:
    cur = conn.cursor()
    for name, q in MANDATE_RULES:
        cur.execute(q)
        if cur.rowcount:
            log.info("vacância: %s -> %d", name, cur.rowcount)
    # party_memberships é derivada: reconstrói inteira na mesma transação (o app lê person_current_party)
    cur.execute(f"create temp table tmp_pm on commit drop as {PARTY_SQL}")
    cur.execute("delete from party_memberships")
    cur.execute("insert into party_memberships (person_id, party_id, from_on, to_on) select person_id, party_id, from_on, to_on from tmp_pm")
    log.info("partidos: %d filiações na linha do tempo", cur.rowcount)
    cur.execute(STATS_SQL)
    n = cur.rowcount
    cur.execute(COVERAGE_SQL)
    c = cur.rowcount
    conn.commit()
    log.info("derive.stats: %d linhas de stats, %d linhas novas de cobertura", n, c)
    url, secret = os.environ.get("REVALIDATE_URL"), os.environ.get("REVALIDATE_SECRET")
    if url and secret:
        try:
            resp = httpx.post(url, json={"tags": ["data"]}, headers={"authorization": f"Bearer {secret}"}, timeout=30)
            log.info("revalidate: %s", resp.status_code)
        except httpx.HTTPError as e:
            log.warning("revalidate falhou (o dado novo aparece no próximo ISR): %s", e)
