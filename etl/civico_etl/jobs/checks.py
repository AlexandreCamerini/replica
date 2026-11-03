"""civico-etl check: invariantes do banco depois de uma carga. Falha (exit 1) se alguma quebrar.

É o teste de regressão do ETL: BUG-001 (carreira multiplicada), BUG-002 (zero onde a fonte não carregou),
duplicatas de pessoa por cadeira e neutralidade estrutural (nenhuma ordenação por métrica é feita aqui, só checagem).
"""

from __future__ import annotations

import logging

import psycopg

log = logging.getLogger("etl.check")

# D92: municípios sem prefeito titular em exercício com motivo conferido na fonte (consulta_cand_2024 do TSE, 03/11/2026).
# Exceção sai da lista quando a fonte resolver (o check avisa quando uma exceção já tem prefeito: exceção vencida).
SEM_ELEITO_2024 = "TSE: eleição de 2024 sem eleito válido (totalização #NULO/NÃO ELEITO após cassação ou anulação); interino (presidente da Câmara) não está em fonte aberta"
PREFEITO_EXCECOES: dict[str, str] = {
    "5300108": "Brasília: o DF não tem município nem prefeito (CF art. 32)",
    "2605459": "Fernando de Noronha: distrito estadual administrado por PE, sem prefeito eleito",
    "5200852": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "5210208": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2100709": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2104909": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2110237": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "3141603": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2403400": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2800605": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2801603": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "2804805": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "3551207": SEM_ELEITO_2024 + "; suplementar ainda não publicada",
    "1508100": SEM_ELEITO_2024 + "; suplementar de 03/08/2025 publicada sem totalização (#NULO)",
    "3532207": SEM_ELEITO_2024 + "; suplementar de 25/10/2026 ainda sem eleito totalizado",
    "2412559": SEM_ELEITO_2024 + "; suplementar marcada para 06/12/2026",
}
_EXC = ", ".join(f"'{k}'" for k in sorted(PREFEITO_EXCECOES))
_PREFEITOS_POR_MUNICIPIO = f"""
    select pl.ibge_code, (select count(*) from mandates m join offices o on o.id = m.office_id
                          where m.place_id = pl.id and o.slug = 'prefeito' and m.role = 'titular' and m.status = 'em_exercicio'
                            and m.started_on <= current_date and m.ends_on > current_date) as n
    from places pl where pl.kind = 'municipio'"""

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
        # D92 / BUG-014: a regressão de cassação "com recurso" tirou o prefeito de 7 cidades e nenhum check pegou
        "município: exatamente 1 prefeito titular em exercício (salvo exceção listada com motivo)",
        f"select count(*) from ({_PREFEITOS_POR_MUNICIPIO}) x where x.n <> 1 and x.ibge_code not in ({_EXC})",
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
    stale = [r["ibge_code"] for r in conn.execute(f"select ibge_code from ({_PREFEITOS_POR_MUNICIPIO}) x where x.n = 1 and x.ibge_code in ({_EXC})")]
    if stale:
        log.warning("exceção vencida (o município já tem prefeito; tirar de PREFEITO_EXCECOES): %s", ", ".join(sorted(stale)))
    log.info("prefeito: %d município(s) em exceção listada (PREFEITO_EXCECOES, com motivo)", len(PREFEITO_EXCECOES))
    if failed:
        log.error("%d invariante(s) quebrada(s)", failed)
    return failed
