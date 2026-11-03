"""civico-etl check: invariantes do banco depois de uma carga. Falha (exit 1) se alguma quebrar.

É o teste de regressão do ETL: BUG-001 (carreira multiplicada), BUG-002 (zero onde a fonte não carregou),
duplicatas de pessoa por cadeira e neutralidade estrutural (nenhuma ordenação por métrica é feita aqui, só checagem).
"""

from __future__ import annotations

import logging

import psycopg

log = logging.getLogger("etl.check")

CHECKS: list[tuple[str, str]] = [
    (
        # BUG-001: carreira multiplicada pelo join com os anos. Compara com a contagem direta na fonte (não com a soma das linhas
        # de ano: a carreira inclui anos sem mandato no banco, p.ex. matérias de senador antes de 2019, e lançamentos com data fora do mandato)
        "carreira = total direto da fonte (propostas, votos, gastos) e nunca menor que a soma dos anos",
        """with d as (
             select c.person_id, c.proposals_principal, c.votes_registered, c.expenses_cents,
                    (select count(*) from proposal_authors pa where pa.person_id = c.person_id and pa.role = 'principal') as p_direct,
                    (select count(*) from votes v where v.person_id = c.person_id and v.value <> 'nao_votou') as v_direct,
                    (select sum(amount_cents) from expenses e where e.person_id = c.person_id) as e_direct,
                    (select sum(y.proposals_principal) from person_period_stats y where y.person_id = c.person_id and y.period <> 'career') as p_years,
                    (select sum(y.votes_registered) from person_period_stats y where y.person_id = c.person_id and y.period <> 'career') as v_years
             from person_period_stats c where c.period = 'career')
           select count(*) from d
           where (proposals_principal is not null and proposals_principal <> p_direct)
              or (votes_registered is not null and votes_registered <> v_direct)
              or (expenses_cents is not null and expenses_cents <> coalesce(e_direct, 0))
              or coalesce(proposals_principal, 0) < coalesce(p_years, 0)
              or coalesce(votes_registered, 0) < coalesce(v_years, 0)""",
    ),
    (
        "nenhum zero em ano sem carga da fonte",
        """select count(*) from person_period_stats s
           where s.period <> 'career' and 'propostas' = any (s.missing_datasets) and s.proposals_principal is not null""",
    ),
    (
        "câmara: no máximo 513 em exercício",
        """select greatest(count(*) - 513, 0) from mandates m join offices o on o.id = m.office_id
           where o.slug = 'deputado_federal' and m.status = 'em_exercicio'""",
    ),
    (
        "senado: no máximo 81 em exercício",
        """select greatest(count(*) - 81, 0) from mandates m join offices o on o.id = m.office_id
           where o.slug = 'senador' and m.status = 'em_exercicio'""",
    ),
    (
        "executivo: um titular em exercício por lugar e cargo",
        """select count(*) from (
             select m.office_id, m.place_id from mandates m join offices o on o.id = m.office_id
             where o.slug in ('presidente','governador','prefeito') and m.status = 'em_exercicio'
             group by 1, 2 having count(*) > 1) d""",
    ),
    (
        "mesma pessoa com dois mandatos sobrepostos no mesmo cargo (deveria ser impossível pela exclusão)",
        """select count(*) from mandates a join mandates b on b.person_id = a.person_id and b.office_id = a.office_id and b.id > a.id
           and daterange(a.started_on, a.ends_on, '[)') && daterange(b.started_on, b.ends_on, '[)')""",
    ),
    (
        "pessoa duplicada na mesma cadeira (nome parlamentar igual, TSE x casa)",
        """select count(*) from mandates ma join people a on a.id = ma.person_id
           join mandates mb on mb.office_id = ma.office_id and mb.place_id = ma.place_id and mb.started_on = ma.started_on and mb.person_id <> ma.person_id
           join people b on b.id = mb.person_id
           where ma.status_source = 'tse' and mb.status_source <> 'tse'
             and regexp_replace(f_unaccent(lower(a.display_name)), '[^a-z0-9]', '', 'g') = regexp_replace(f_unaccent(lower(b.display_name)), '[^a-z0-9]', '', 'g')""",
    ),
    (
        "voto sem evento nominal",
        "select count(*) from votes v join voting_events e on e.id = v.voting_event_id where not e.is_nominal",
    ),
    (
        "presença maior que o total",
        "select count(*) from person_period_stats where presence_present > presence_total",
    ),
    (
        "stamp vencido: Câmara/Senado há mais de 48 h, TSE há mais de 60 dias",
        """select count(*) from dataset_stamps ds join sources s on s.id = ds.source_id
           where (s.slug in ('camara','senado') and ds.refreshed_at < now() - interval '48 hours')
              or (s.slug = 'tse' and ds.refreshed_at < now() - interval '60 days')""",
    ),
]


def run_checks(conn: psycopg.Connection) -> int:
    failed = 0
    for name, q in CHECKS:
        n = list(conn.execute(q).fetchone().values())[0]
        if n:
            failed += 1
            log.error("FALHOU: %s (%s)", name, n)
        else:
            log.info("ok: %s", name)
    if failed:
        log.error("%d invariante(s) quebrada(s)", failed)
    return failed
