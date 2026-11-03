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
  where status = 'succeeded' and dataset ~ '^(camara|senado|ale[a-z]{2})\.(votacoes|proposicoes|despesas|presenca)\.[0-9]{4}$'
  union
  select 'senado', 'proposicoes', y from generate_series(1980, extract(year from current_date)::int) y
  where exists (select 1 from ingest_runs where status = 'succeeded' and dataset = 'senado.autorias')
),
-- Assembleia com adaptador (W3-A): carimbos ale<uf>.* (alesp, alemg...). Só o mandato daquela casa conta.
person_src as (
  select distinct m.person_id, case b.adapter when 'camara_api' then 'camara' when 'senado_api' then 'senado' when 'ale_custom' then 'ale' || lower(bp.uf) end as src
  from mandates m join legislative_bodies b on b.id = m.body_id join places bp on bp.id = b.place_id
  where b.adapter in ('camara_api', 'senado_api', 'ale_custom')
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
# BUG-022 / D182: quem está em exercício na Câmara ou no Senado tem o partido que a casa publica hoje. Candidatura do TSE
# posterior à última observação da casa não vence enquanto o mandato está em exercício (Eliziane Gama: PT na candidatura de
# 2026, PSD no Senado). Ao sair da casa, a candidatura volta a contar. "S/Partido" do Senado é observação (Romário, 2026).
# D201: desempate determinístico entre observações de partido do mesmo dia. A Câmara registra a posse e a troca de partido no
# mesmo dia (Bebeto, 01/02/2023: posse PTB 12:05, "Alteração de partido" PP 13:22), e a chave guarda a hora do /historico
# (`camara:{id}:{dataHora}`). Vale o último evento do dia; a chave só com data (`ultimoStatus`, o estado atual da pessoa)
# conta como fim do dia. Depois, o maior id. O `check` usa a mesma expressão (checks.py importa daqui).
def party_obs_tiebreak(alias: str) -> str:
    return (f"coalesce(substring({alias}.source_key from 'T([0-9:]+)$'), "
            f"case when {alias}.source_key ~ '[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}$' then '99' else '' end) collate \"C\" desc, {alias}.id desc")


PARTY_SQL = r"""
with house as (
  select po.person_id, max(po.observed_on) as last_house
  from party_observations po
  join mandates m on m.person_id = po.person_id and m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date
  join legislative_bodies b on b.id = m.body_id and b.kind = case po.source when 'camara' then 'camara_deputados' when 'senado' then 'senado' end
  where po.observed_on <= current_date
  group by 1
),
obs as (
  select po.person_id, po.party_id, po.observed_on, 1 as prio, row_number() over (partition by po.person_id, po.observed_on order by __TB__) as rk
  from party_observations po
  union all
  select c.person_id, c.party_id, e.held_on, 0, 1 from candidacies c join elections e on e.id = c.election_id
  where c.party_id is not null and e.held_on <= current_date
    and not exists (select 1 from house h where h.person_id = c.person_id and e.held_on > h.last_house)
),
d as (select distinct on (person_id, observed_on) person_id, party_id, observed_on from obs where observed_on <= current_date order by person_id, observed_on, prio desc, rk, party_id),
r as (select *, lag(party_id) over (partition by person_id order by observed_on) as prev from d),
s as (select person_id, party_id, observed_on as from_on from r where prev is distinct from party_id)
select person_id, party_id, from_on, lead(from_on) over (partition by person_id order by from_on) as to_on from s
""".replace("__TB__", party_obs_tiebreak("po"))

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

# BUG-024 / D184 e BUG-031 / D202: executivo estadual que o TSE não publica. Lista curta, curada, cada linha com a fonte que a
# sustenta (oficial sempre que achada; quando só a imprensa publica, a linha diz isso e a tela mostra "—" com o motivo).
# Ações (idempotentes, aplicadas antes das regras D06; uma saída com status_source <> 'tse' tira o mandato das regras):
#   posse  -> mandato novo (upsert pela chave natural): eleição indireta, sucessão fora da regra D06, sucessor depois cassado.
#   saida  -> fecha um mandato existente (chave: pessoa, cargo, UF, início) com status, data e origem da fonte.
#   inicio -> corrige a data de início do mandato de sucessor criado pela regra D06 (que usa o prazo de 04/04, não a posse).
# `vacancy_note` vai para a tela no lugar do motivo genérico quando o cargo fica sem ninguém do diretório em exercício
# (interino de outro Poder, vaga, fonte oficial que não confirma). Saída de status_source <> 'tse' tira o mandato das regras D06.
_FIM = "2027-01-06"  # EC 111/2021: posse dos governadores eleitos em 2026


def _sucessao(uf: str, titular: str, vice: str, d: str, src: str, fonte: str, dmy: str) -> list[dict[str, str]]:
    """Vice que assumiu: a regra D06 já cria o sucessor; aqui só entram as datas da fonte oficial, o motivo da vaga de vice e o
    motivo da sucessão que o crachá mostra (D232: o fato com a data, sem supor por que o titular saiu)."""
    return [
        {"acao": "saida", "slug": titular, "office": "governador", "uf": uf, "started_on": "2023-01-01", "status": "renunciou", "ends_on": d,
         "status_source": src, "fonte": fonte},
        {"acao": "saida", "slug": vice, "office": "vice_governador", "uf": uf, "started_on": "2023-01-01", "status": "encerrado", "ends_on": d,
         "status_source": src, "fonte": fonte, "vacancy_note": f"cargo vago desde {dmy}: quem era vice assumiu o governo, e não houve eleição de novo vice"},
        # o sucessor que a regra D06 criou com início em 04/04 passa para a data da posse; num banco novo (a saída acima tira o
        # titular das regras) a posse cria o mandato. Com o "inicio" antes, a posse não sobrepõe o mandato que já existe.
        {"acao": "inicio", "slug": vice, "office": "governador", "uf": uf, "started_on": d, "ends_on": _FIM, "status_source": src, "fonte": fonte},
        {"acao": "posse", "slug": vice, "civil": None, "office": "governador", "uf": uf, "started_on": d, "ends_on": _FIM, "status": "em_exercicio",
         "status_source": src, "elected_by": f"sucessão: o governador renunciou em {dmy}", "fonte": fonte},
    ]


EXECUTIVO_FORA_DO_TSE: list[dict[str, str]] = [
    {
        "acao": "posse", "slug": "roberto-cidade", "civil": "Roberto Maia Cidade Filho", "office": "governador", "uf": "AM",
        "started_on": "2026-05-04", "ends_on": _FIM, "status": "em_exercicio", "status_source": "governo-am",
        "elected_by": "eleição indireta na Assembleia Legislativa do Amazonas em 04/05/2026 (mandato-tampão após a renúncia do governador e do vice)",
        # D197: oficial = Governadoria do AM (nomeia o governador, página de 08/05/2026). DOE-AM e ALEAM procurados de novo em
        # 03/11/2026 (D202): nenhuma página localizável com a eleição indireta ou a posse; a data de 04/05 segue da Agência Brasil:
        # https://agenciabrasil.ebc.com.br/justica/noticia/2026-05/roberto-cidade-e-eleito-governador-do-amazonas-em-eleicao-indireta
        "fonte": "https://www.amazonas.am.gov.br/orgaos_entidades/governadoria/",
    },
    {
        "acao": "saida", "slug": "tadeu-de-souza", "office": "vice_governador", "uf": "AM", "started_on": "2023-01-01",
        # D231: o vice de 2023 saiu; quem exerce a vice é Serafim Corrêa (posse abaixo). Sem nota de vaga: o cargo está ocupado.
        "fonte": "https://www.aleam.gov.br/presidente-da-aleam-adjuto-afonso-acompanha-balanco-das-acoes-estaduais-de-combate-as-queimadas-no-amazonas/",
    },
    {
        # D228: a ALEAM (14/10/2026) chama Serafim Corrêa de vice-governador do Amazonas; a eleição indireta foi em 04/05/2026,
        # junto com a do governador (Agência Brasil, D197). Pessoa criada pelo TSE 2026 (vice na chapa de Roberto Cidade, SQ
        # 40002541740, título e nascimento da fonte).
        "acao": "posse", "slug": "serafim-correa", "civil": "Serafim Fernandes Corrêa", "office": "vice_governador", "uf": "AM",
        "started_on": "2026-05-04", "ends_on": _FIM, "status": "em_exercicio", "status_source": "aleam",
        "elected_by": "eleição indireta na Assembleia Legislativa do Amazonas em 04/05/2026 (mandato-tampão após a renúncia do governador e do vice)",
        "fonte": "https://www.aleam.gov.br/presidente-da-aleam-adjuto-afonso-acompanha-balanco-das-acoes-estaduais-de-combate-as-queimadas-no-amazonas/",
    },
    # DF: Ibaneis renunciou em 28/03/2026 (data da imprensa: Jornal de Brasília, Poder360) sem candidatura no TSE, então a regra D06
    # não dispara. A CLDF deu posse a Celina Leão em 30/03/2026.
    {"acao": "saida", "slug": "ibaneis-rocha", "office": "governador", "uf": "DF", "started_on": "2023-01-01", "status": "renunciou",
     "ends_on": "2026-03-28", "status_source": "cldf", "fonte": "https://www.cl.df.gov.br/-/celina-leao-toma-posse-como-governadora-do-distrito-federal"},
    {"acao": "saida", "slug": "celina-leao", "office": "vice_governador", "uf": "DF", "started_on": "2023-01-01", "status": "encerrado",
     "ends_on": "2026-03-30", "status_source": "cldf", "vacancy_note": "cargo vago desde 30/03/2026: quem era vice assumiu o governo, e não houve eleição de novo vice",
     "fonte": "https://www.cl.df.gov.br/-/celina-leao-toma-posse-como-governadora-do-distrito-federal"},
    {"acao": "posse", "slug": "celina-leao", "civil": None, "office": "governador", "uf": "DF", "started_on": "2026-03-30", "ends_on": _FIM,
     "status": "em_exercicio", "status_source": "cldf",
     "elected_by": "sucessão: o governador renunciou em 28/03/2026, e a posse foi na Câmara Legislativa do DF em 30/03/2026",
     "fonte": "https://www.cl.df.gov.br/-/celina-leao-toma-posse-como-governadora-do-distrito-federal"},
    # RJ: Castro renunciou em 23/03/2026 (Agência Brasil); o RJ não tinha vice (Pampolha renunciou em 21/05/2025 ao ser aprovado
    # para o TCE-RJ, Alerj). O presidente do TJ-RJ governa como interino; o STF (Rcl 92644) o manteve "até nova deliberação".
    # O interino não é pessoa do diretório e o modelo não tem papel de interino: a tela mostra "—" com o motivo.
    {"acao": "saida", "slug": "claudio-castro", "office": "governador", "uf": "RJ", "started_on": "2023-01-01", "status": "renunciou",
     "ends_on": "2026-03-23", "status_source": "stf",
     "vacancy_note": "exercício interino pelo presidente do TJ-RJ, desembargador Ricardo Couto, desde 23/03/2026; o STF o manteve no cargo "
                     "até decidir o mandato-tampão (Rcl 92644, 24/04/2026)",
     "fonte": "https://noticias.stf.jus.br/postsnoticias/stf-decide-que-presidente-do-tj-deve-ser-mantido-como-governador-do-rio-de-janeiro/"},
    {"acao": "saida", "slug": "thiago-pampolha", "office": "vice_governador", "uf": "RJ", "started_on": "2023-01-01", "status": "renunciou",
     "ends_on": "2025-05-21", "status_source": "alerj",
     "vacancy_note": "cargo vago desde 21/05/2025: o vice renunciou ao ser aprovado para conselheiro do TCE-RJ",
     "fonte": "https://www.alerj.rj.gov.br/Visualizar/Noticia/76016"},
    # RR: Denarium renunciou e Edilson Damião tomou posse na ALE-RR em 27/03/2026; o TSE cassou a chapa de 2022 e, em 30/04/2026,
    # a ALE-RR deu o governo, interino, ao seu presidente (Soldado Sampaio). A suplementar de 21/06/2026 ficou sub judice e nenhuma
    # fonte oficial lida depois de 23/06/2026 confirma quem governa hoje: "—" com o motivo.
    {"acao": "saida", "slug": "antonio-denarium", "office": "governador", "uf": "RR", "started_on": "2023-01-01", "status": "renunciou",
     "ends_on": "2026-03-27", "status_source": "ale-rr",
     "fonte": "https://al.rr.leg.br/2026/04/30/apos-decisao-do-tse-alerr-oficializa-troca-de-comando-interina-nos-poderes-executivo-e-legislativo/"},
    {"acao": "saida", "slug": "edilson-damiao", "office": "vice_governador", "uf": "RR", "started_on": "2023-01-01", "status": "encerrado",
     "ends_on": "2026-03-27", "status_source": "ale-rr",
     "vacancy_note": "cargo vago desde 27/03/2026: quem era vice assumiu o governo, e a chapa eleita em 2022 foi cassada pelo TSE",
     "fonte": "https://al.rr.leg.br/2026/04/30/apos-decisao-do-tse-alerr-oficializa-troca-de-comando-interina-nos-poderes-executivo-e-legislativo/"},
    {"acao": "posse", "slug": "edilson-damiao", "civil": None, "office": "governador", "uf": "RR", "started_on": "2026-03-27", "ends_on": "2026-04-30",
     "status": "cassado", "status_source": "ale-rr",
     "elected_by": "sucessão: o governador renunciou em 27/03/2026; o mandato acabou em 30/04/2026 com a cassação da chapa eleita em 2022 pelo TSE",
     "vacancy_note": "exercício interino pelo presidente da Assembleia Legislativa de Roraima (Soldado Sampaio) desde 30/04/2026; a eleição "
                     "suplementar de 21/06/2026 ficou sub judice e nenhuma fonte oficial que lemos confirma quem governa hoje",
     "fonte": "https://al.rr.leg.br/2026/04/30/apos-decisao-do-tse-alerr-oficializa-troca-de-comando-interina-nos-poderes-executivo-e-legislativo/"},
    # AL: a renúncia do vice em 09/10/2026 só está na imprensa (TNH1, Congresso em Foco, citando nota do governo); o DOE-AL não foi
    # localizado e a página oficial do governo ainda o lista. Não afirmamos nem um nem outro: "—" com o motivo.
    {"acao": "saida", "slug": "ronaldo-lessa", "office": "vice_governador", "uf": "AL", "started_on": "2023-01-01", "status": "renunciou",
     "ends_on": "2026-10-09", "status_source": "imprensa",
     "vacancy_note": "a imprensa noticiou a renúncia do vice Ronaldo Lessa em 09/10/2026, citando nota do Governo de Alagoas; não achamos o "
                     "ato no Diário Oficial e a página do governo ainda o lista",
     "fonte": "https://www.tnh1.com.br/noticia/nid/ronaldo-lessa-renuncia-ao-mandato-de-vice-governador-do-estado-de-alagoas/"},
    # Sucessões que a regra D06 já faz, com a data de posse da fonte oficial (a regra usa o prazo de desincompatibilização, 04/04).
    *_sucessao("AC", "gladson-cameli", "mailza", "2026-04-02", "governo-ac", "https://agencia.ac.gov.br/gladson-cameli-transmite-governo-do-acre-para-mailza-assis-que-define-saude-emprego-e-seguranca-como-prioridades-um-tempo-de-trabalho-uniao-e-avanco/", "02/04/2026"),
    *_sucessao("ES", "renato-casagrande", "ricardo-ferraco", "2026-04-02", "governo-es", "https://www.es.gov.br/Noticia/ricardo-ferraco-toma-posse-como-governador-do-espirito-santo", "02/04/2026"),
    *_sucessao("GO", "ronaldo-caiado", "daniel-vilela", "2026-03-31", "governo-go", "https://goias.gov.br/abc/daniel-vilela-toma-posse-como-governador-de-goias/", "31/03/2026"),
    *_sucessao("MG", "zema", "professor-mateus", "2026-03-22", "governo-mg", "https://www.agenciaminas.mg.gov.br/noticia/mateus-simoes-e-empossado-governador-e-reforca-projeto-de-desenvolvimento-de-minas-gerais-129430", "22/03/2026"),
    *_sucessao("MT", "mauro-mendes", "otaviano-pivetta", "2026-03-31", "almt", "https://www.al.mt.gov.br/midia/texto/almt-da-posse-a-otaviano-pivetta-como-governador-apos-renuncia-de-mauro-mendes/visualizar", "31/03/2026"),
    *_sucessao("PA", "helder", "hana", "2026-04-02", "alepa", "https://www.alepa.pa.gov.br/Comunicacao/Noticia/11627/mensagem-de-renuncia-de-helder-e-entregue-ao-legislativo-e-marca-transicao-no-governo-do-para", "02/04/2026"),
    *_sucessao("PB", "joao", "lucas-ribeiro", "2026-04-02", "governo-pb", "https://auniao.pb.gov.br/noticias/caderno_politicas/lucas-ribeiro-assume-governo-da-pb", "02/04/2026"),
]

_KEY = """from people p, offices o, places pl
          where p.slug = %(slug)s and (%(civil)s::text is null or p.civil_name = %(civil)s) and o.slug = %(office)s and pl.kind = 'uf' and pl.uf = %(uf)s"""


def apply_executivo_fora_do_tse(conn: psycopg.Connection) -> int:
    n = 0
    for raw in EXECUTIVO_FORA_DO_TSE:
        x = {"civil": None, "status": None, "ends_on": None, "status_source": None, "vacancy_note": None, "elected_by": None, **raw}
        if x["acao"] == "posse":
            row = conn.execute(
                f"""insert into mandates (person_id, office_id, place_id, body_id, party_id, role, status, started_on, ends_on, elected_by, status_source, vacancy_note)
                   select p.id, o.id, pl.id, null, null, 'titular', %(status)s, %(started_on)s, %(ends_on)s, %(elected_by)s, %(status_source)s, %(vacancy_note)s
                   {_KEY}
                   on conflict (person_id, office_id, place_id, started_on) do update
                     set ends_on = excluded.ends_on, elected_by = excluded.elected_by, status_source = excluded.status_source, status = excluded.status,
                         vacancy_note = excluded.vacancy_note, updated_at = now()
                     where (mandates.ends_on, mandates.elected_by, mandates.status_source, mandates.status, mandates.vacancy_note)
                           is distinct from (excluded.ends_on, excluded.elected_by, excluded.status_source, excluded.status, excluded.vacancy_note)
                   returning id""",
                x,
            ).fetchone()
            found = row or conn.execute(f"select m.id from mandates m, ({'select p.id pid, o.id oid, pl.id plid ' + _KEY}) k "
                                        "where m.person_id = k.pid and m.office_id = k.oid and m.place_id = k.plid and m.started_on = %(started_on)s", x).fetchone()
        elif x["acao"] == "saida":
            row = conn.execute(
                f"""update mandates m set status = coalesce(%(status)s, m.status), ends_on = coalesce(%(ends_on)s::date, m.ends_on),
                          status_source = coalesce(%(status_source)s, m.status_source), vacancy_note = %(vacancy_note)s, updated_at = now()
                   from ({'select p.id pid, o.id oid, pl.id plid ' + _KEY}) k
                   where m.person_id = k.pid and m.office_id = k.oid and m.place_id = k.plid and m.started_on = %(started_on)s
                     and (m.status, m.ends_on, m.status_source, m.vacancy_note) is distinct from
                         (coalesce(%(status)s, m.status), coalesce(%(ends_on)s::date, m.ends_on), coalesce(%(status_source)s, m.status_source), %(vacancy_note)s)
                   returning m.id""",
                x,
            ).fetchone()
            found = row or conn.execute(f"select m.id from mandates m, ({'select p.id pid, o.id oid, pl.id plid ' + _KEY}) k "
                                        "where m.person_id = k.pid and m.office_id = k.oid and m.place_id = k.plid and m.started_on = %(started_on)s", x).fetchone()
        elif x["acao"] == "inicio":
            # mandato de sucessor (regra D06) que termina em ends_on: a data de início passa a ser a da posse na fonte
            row = conn.execute(
                f"""update mandates m set started_on = %(started_on)s, status_source = %(status_source)s, updated_at = now()
                   from ({'select p.id pid, o.id oid, pl.id plid ' + _KEY}) k
                   where m.person_id = k.pid and m.office_id = k.oid and m.place_id = k.plid and m.ends_on = %(ends_on)s
                     and m.elected_by like 'sucessão%%' and (m.started_on, m.status_source) is distinct from (%(started_on)s::date, %(status_source)s)
                   returning m.id""",
                x,
            ).fetchone()
            found = True  # num banco novo o sucessor ainda não existe: a "posse" seguinte cria
        else:
            raise ValueError(f"EXECUTIVO_FORA_DO_TSE: ação desconhecida {x['acao']!r}")
        if row:
            n += 1
        if not found:
            log.warning("executivo fora do TSE: %s de %s (%s/%s) não encontrado", x["acao"], x["slug"], x["office"], x["uf"])
    return n


# cobertura padrão: só insere o que ainda não foi auditado (on conflict do nothing)
COVERAGE_SQL = """
insert into data_coverage (place_id, dataset, status, reason, checked_on)
select p.id, d.dataset, d.status, d.reason, current_date
from places p
cross join lateral (
  select * from (values
    -- W3-A: não afirma que a casa publica sem conferir; o job ale.* troca pelo motivo conferido de cada UF lida
    ('presenca', 'carregando', 'a Assembleia Legislativa ainda não é lida pelo site'),
    ('votos', 'carregando', 'a Assembleia Legislativa ainda não é lida pelo site'),
    ('propostas', 'carregando', 'a Assembleia Legislativa ainda não é lida pelo site'),
    ('gastos_gabinete', 'desconhecido', 'a Assembleia Legislativa ainda não é lida pelo site'),
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
    k = apply_executivo_fora_do_tse(conn)
    for name, q in MANDATE_RULES:
        cur.execute(q)
        if cur.rowcount:
            log.info("vacância: %s -> %d", name, cur.rowcount)
    if k:
        log.info("executivo fora do TSE: %d mandato(s) gravado(s)", k)
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
