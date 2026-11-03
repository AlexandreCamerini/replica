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

# BUG-019 / D168: votos válidos de presidente por turno publicados pelo TSE (detalhe_votacao_munzona_{ano}_BR.csv, soma de
# QT_TOTAL_VOTOS_VALIDOS e de QT_APTOS; cdn.tse.jus.br/estatistica/sead/odsele, conferido em 03/11/2026).
# (ano, turno) -> (votos válidos, eleitorado apto). Ano fora da tabela usa o maior eleitorado conhecido +10% como teto.
PRESIDENTE_TSE: dict[tuple[int, int], tuple[int, int]] = {
    (2018, 1): (107_050_749, 147_306_295), (2018, 2): (104_838_753, 147_306_294),
    (2022, 1): (118_229_719, 156_454_011), (2022, 2): (118_552_353, 156_454_011),
    (2026, 1): (119_300_788, 158_745_502), (2026, 2): (124_082_273, 158_745_502),
}
_PRES_VALUES = ", ".join(f"({y}, {t}, {v}, {a})" for (y, t), (v, a) in sorted(PRESIDENTE_TSE.items()))
_PRES_TETO = int(max(a for _, a in PRESIDENTE_TSE.values()) * 1.1)

# BUG-024 / D185: UF sem governador titular em exercício só com motivo conferido na fonte. Vazia hoje: o AM (dupla vacância
# de 04/2026) tem o governador eleito pela Assembleia em EXECUTIVO_FORA_DO_TSE (derive_stats).
GOVERNADOR_EXCECOES: dict[str, str] = {}
_GOV_EXC = ", ".join(f"'{k}'" for k in sorted(GOVERNADOR_EXCECOES)) or "''"
_GOVERNADORES_POR_UF = """
    select pl.uf, (select count(*) from mandates m join offices o on o.id = m.office_id
                   where m.place_id = pl.id and o.slug = 'governador' and m.role = 'titular' and m.status = 'em_exercicio'
                     and m.started_on <= current_date and m.ends_on > current_date) as n
    from places pl where pl.kind = 'uf'"""

# BUG-020 / D183: cota parlamentar de uma amostra fixa contra o total da Câmara (arquivo Ano-AAAA.csv.zip + linhas que só a API
# tem, D181), conferido em 03/11/2026 na API /deputados/{id}/despesas e na página camara.leg.br/deputados/{id}?ano=AAAA.
# (id da Câmara, ano) -> centavos. Tolerância de 0,5% para republicação da fonte; o defeito do BUG-020 era -9% a -14%.
COTA_REFERENCIA: dict[tuple[str, int], int] = {
    ("204528", 2024): 6_712_529, ("204528", 2025): 10_469_375,    # Adriana Ventura (2025: 104.693,75; antes da correção 89.595,04)
    ("178975", 2024): 31_139_916, ("178975", 2025): 37_720_507,   # Baleia Rossi (2025 antes: 343.601,05)
    ("204534", 2024): 51_872_520, ("204534", 2025): 53_151_883,   # Tabata Amaral
    ("204536", 2024): 16_236_521, ("204536", 2025): 15_175_134,   # Kim Kataguiri
    ("209787", 2024): 41_202_602, ("209787", 2025): 46_343_464,   # Nikolas Ferreira
}
_COTA_VALUES = ", ".join(f"('{d}', {y}, {c})" for (d, y), c in sorted(COTA_REFERENCIA.items())) or "(null, null, null)"

_PREFEITOS_POR_MUNICIPIO = f"""
    select pl.ibge_code, (select count(*) from mandates m join offices o on o.id = m.office_id
                          where m.place_id = pl.id and o.slug = 'prefeito' and m.role = 'titular' and m.status = 'em_exercicio'
                            and m.started_on <= current_date and m.ends_on > current_date) as n
    from places pl where pl.kind = 'municipio'"""

CHECKS: list[tuple[str, str]] = [
    (
        # BUG-019: presidente contado 2x (…_BRASIL.csv + …_BR.csv). O diretório tem só parte dos candidatos, então a soma
        # das candidaturas carregadas nunca passa do total de válidos do TSE (nem do eleitorado, em ano fora da tabela);
        # nenhuma candidatura passa do total; e a soma por município nunca passa do voto da candidatura (exterior fica fora).
        "presidente: votos por turno <= votos válidos do TSE (ou eleitorado) e votos por município <= total da candidatura",
        f"""with tse (year, round, validos, aptos) as (values {_PRES_VALUES}),
           s as (select e.year, e.round, sum(c.votes) as soma, max(c.votes) as maior
                 from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
                 join offices o on o.id = ct.office_id
                 where o.slug = 'presidente' and c.votes is not null group by 1, 2),
           p as (select c.id, c.votes, (select sum(v.votes) from candidacy_place_votes v where v.candidacy_id = c.id) as por_mun
                 from candidacies c join contests ct on ct.id = c.contest_id join offices o on o.id = ct.office_id
                 where o.slug = 'presidente' and c.votes is not null)
           select (select count(*) from s left join tse t using (year, round)
                   where s.soma > coalesce(t.validos, {_PRES_TETO}) or s.maior > coalesce(t.validos, {_PRES_TETO}))
                + (select count(*) from p where p.por_mun > p.votes)""",
    ),
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
        # BUG-021: /partidos somava 512; o banco tem de ter as 513 cadeiras (e cada uma com partido vigente)
        "câmara: exatamente 513 em exercício, todos com partido vigente",
        """select abs(count(*) - 513) + count(*) filter (where cp.party_id is null)
           from mandates m join offices o on o.id = m.office_id left join person_current_party cp on cp.person_id = m.person_id
           where o.slug = 'deputado_federal' and m.status = 'em_exercicio'""",
    ),
    (
        "senado: exatamente 81 em exercício, todos com partido vigente",
        """select abs(count(*) - 81) + count(*) filter (where cp.party_id is null)
           from mandates m join offices o on o.id = m.office_id left join person_current_party cp on cp.person_id = m.person_id
           where o.slug = 'senador' and m.status = 'em_exercicio'""",
    ),
    (
        # BUG-022 / D182: em exercício na casa, o partido vigente é o da última observação da casa (não a candidatura do TSE)
        "câmara/senado: partido vigente de quem está em exercício = última observação da própria casa",
        """with h as (
             select distinct on (m.person_id) m.person_id, po.party_id
             from mandates m join legislative_bodies b on b.id = m.body_id and b.kind in ('camara_deputados','senado')
             join party_observations po on po.person_id = m.person_id and po.observed_on <= current_date
                  and po.source = case b.kind when 'camara_deputados' then 'camara' else 'senado' end
             where m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date
             order by m.person_id, po.observed_on desc, po.id desc)
           select count(*) from h left join person_current_party cp on cp.person_id = h.person_id
           where cp.party_id is distinct from h.party_id""",
    ),
    (
        "cota: amostra fixa de deputados e anos = total da Câmara (±0,5%)",
        f"""with ref (dep, year, cents) as (values {_COTA_VALUES}),
           d as (select r.dep, r.year, r.cents,
                        (select coalesce(sum(x.amount_cents), 0) from expenses x
                         join legislative_bodies b on b.id = x.body_id and b.kind = 'camara_deputados'
                         where x.person_id = (select e.person_id from person_external_ids e join sources s on s.id = e.source_id and s.slug = 'camara'
                                              where e.external_id = r.dep)
                           and x.occurred_on >= make_date(r.year, 1, 1) and x.occurred_on < make_date(r.year + 1, 1, 1)) as banco
                 from ref r where r.dep is not null)
           select count(*) from d where abs(banco - cents) > abs(cents) * 0.005""",
    ),
    (
        # BUG-020: chave por linha da fonte; o formato antigo (só ideDocumento) não pode voltar
        "cota da Câmara: toda linha com chave por linha da fonte (cotaAAAA: ou cotaapiAAAA:)",
        """select count(*) from expenses x join legislative_bodies b on b.id = x.body_id and b.kind = 'camara_deputados'
           where x.source_key !~ '^cota(api)?[0-9]{4}:'""",
    ),
    (
        "UF: exatamente 1 governador titular em exercício (salvo exceção listada com motivo)",
        f"select count(*) from ({_GOVERNADORES_POR_UF}) x where x.n <> 1 and x.uf not in ({_GOV_EXC})",
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
        # W3-B / D120: salário acumulado do Congresso cobre todo mês de mandato desde 2015 (DL 276/2014 em diante)
        "salário: todo mês de mandato federal (deputado/senador) desde 02/2015 tem subsídio publicado vigente",
        """select count(*) from mandates m join offices o on o.id = m.office_id
           cross join lateral generate_series(date_trunc('month', greatest(m.started_on, date '2015-02-01')),
                                              date_trunc('month', least(m.ends_on - 1, current_date)), interval '1 month') gs
           where o.slug in ('deputado_federal', 'senador') and m.status <> 'eleito_aguardando_posse'
             and not exists (select 1 from salaries s where s.office_id = m.office_id and s.place_id is null and not s.is_ceiling
                             and s.valid_from <= gs::date)""",
    ),
    (
        # D123: secreta vem da fonte (votacaoSecreta); secreta nunca tem voto individual gravado
        "senado: votação sem is_secret da fonte, ou secreta com voto individual",
        """select count(*) from voting_events e join legislative_bodies b on b.id = e.body_id and b.kind = 'senado'
           where e.is_secret is null or (e.is_secret and exists (select 1 from votes v where v.voting_event_id = e.id))""",
    ),
    (
        # D125: pauta só liga proposta da mesma casa
        "agenda: item de pauta ligado a proposta de outra casa",
        """select count(*) from agenda_items i join agenda_events a on a.id = i.agenda_event_id join proposals p on p.id = i.proposal_id
           where p.body_id <> a.body_id""",
    ),
    (
        # D132: sanção só aponta para pessoa com método e confiança registrados
        "sanções: vínculo com pessoa sem método de casamento",
        "select count(*) from sanctions where person_id is not null and (match_method is null or match_confidence is null)",
    ),
    (
        # D128: vereador do SAPL casado só com pessoa que tem mandato de vereador naquele município
        "SAPL: vereador casado com pessoa sem mandato de vereador no município da câmara",
        """select count(*) from sapl_parlamentares sp join sapl_houses h on h.id = sp.house_id
           where sp.person_id is not null and (sp.match_status <> 'casado' or not exists (
             select 1 from mandates m join offices o on o.id = m.office_id and o.slug = 'vereador'
             where m.person_id = sp.person_id and m.place_id = h.place_id))""",
    ),
    (
        "stamp vencido: Câmara/Senado há mais de 48 h, TSE há mais de 60 dias",
        """select count(*) from dataset_stamps ds join sources s on s.id = ds.source_id
           where (s.slug in ('camara','senado') and ds.refreshed_at < now() - interval '48 hours')
              or (s.slug = 'tse' and ds.refreshed_at < now() - interval '60 days')""",
    ),
    # W3-A (Assembleias): o casamento com o TSE nunca põe dado de uma casa estadual no crachá de quem não tem mandato nela
    (
        "assembleia: todo vínculo de deputado estadual aponta para pessoa com mandato de deputado estadual/distrital na mesma UF",
        """select count(*) from person_external_ids e join sources s on s.id = e.source_id
           join legislative_bodies b on b.adapter = 'ale_custom' and b.open_data_url = s.url
           where not exists (select 1 from mandates m join offices o on o.id = m.office_id
                             where m.person_id = e.person_id and m.place_id = b.place_id and o.slug in ('deputado_estadual','deputado_distrital'))""",
    ),
    (
        "assembleia: um id da casa por pessoa e por tipo de id (ninguém casado com dois deputados da mesma Assembleia)",
        """select count(*) from (
             select e.person_id, e.source_id, split_part(e.external_id, ':', 1) from person_external_ids e
             join sources s on s.id = e.source_id join legislative_bodies b on b.adapter = 'ale_custom' and b.open_data_url = s.url
             group by 1, 2, 3 having count(*) > 1) d""",
    ),
    (
        "assembleia: autoria e gasto de Assembleia só em pessoa com mandato estadual/distrital naquela UF",
        """select (select count(*) from proposal_authors pa join proposals p on p.id = pa.proposal_id
                   join legislative_bodies b on b.id = p.body_id and b.kind in ('assembleia','camara_legislativa_df')
                   where not exists (select 1 from mandates m join offices o on o.id = m.office_id
                                     where m.person_id = pa.person_id and m.place_id = b.place_id and o.slug in ('deputado_estadual','deputado_distrital')))
                + (select count(*) from expenses x join legislative_bodies b on b.id = x.body_id and b.kind in ('assembleia','camara_legislativa_df')
                   where not exists (select 1 from mandates m join offices o on o.id = m.office_id
                                     where m.person_id = x.person_id and m.place_id = b.place_id and o.slug in ('deputado_estadual','deputado_distrital')))""",
    ),
    (
        "assembleia: deputado estadual de UF sem adaptador não tem número de propostas nem de gastos (\"—\", nunca 0)",
        """select count(*) from person_period_stats s
           where (s.proposals_principal is not null or s.expenses_cents is not null)
             and exists (select 1 from mandates m join offices o on o.id = m.office_id join legislative_bodies b on b.id = m.body_id
                         where m.person_id = s.person_id and o.slug in ('deputado_estadual','deputado_distrital') and b.adapter <> 'ale_custom')
             and not exists (select 1 from mandates m join legislative_bodies b on b.id = m.body_id
                             where m.person_id = s.person_id and b.adapter in ('camara_api','senado_api','ale_custom'))""",
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
