"""civico-etl check: invariantes do banco depois de uma carga. Falha (exit 1) se alguma quebrar.

É o teste de regressão do ETL: BUG-001 (carreira multiplicada), BUG-002 (zero onde a fonte não carregou),
duplicatas de pessoa por cadeira e neutralidade estrutural (nenhuma ordenação por métrica é feita aqui, só checagem).
"""

from __future__ import annotations

import logging

import psycopg

from .. import schedule  # BUG-055: a régua do carimbo vem da cadência de cada tarefa
from .checks_identity import run_identity_checks  # BUG-032 (D212)
from .derive_stats import party_obs_tiebreak  # D201: mesmo desempate do PARTY_SQL

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

# BUG-024 / D185 e BUG-031 / D203: UF sem governador titular em exercício só com motivo conferido na fonte.
GOVERNADOR_EXCECOES: dict[str, str] = {
    "RJ": "exercício interino pelo presidente do TJ-RJ desde 23/03/2026 (STF, Rcl 92644); o interino não é pessoa do diretório",
    "RR": "exercício interino pelo presidente da ALE-RR desde 30/04/2026 (chapa de 2022 cassada); suplementar de 21/06/2026 sub judice",
}
_GOV_EXC = ", ".join(f"'{k}'" for k in sorted(GOVERNADOR_EXCECOES)) or "''"
_GOVERNADORES_POR_UF = """
    select pl.uf, (select count(*) from mandates m join offices o on o.id = m.office_id
                   where m.place_id = pl.id and o.slug = 'governador' and m.role = 'titular' and m.status = 'em_exercicio'
                     and m.started_on <= current_date and m.ends_on > current_date) as n
    from places pl where pl.kind = 'uf'"""

# BUG-031 / D203: quem exerce hoje governo e vice em cada UF, conferido em fonte oficial em 03/11/2026 (portal do governo, diário
# oficial, Assembleia, tribunal ou TSE). O check exige que o banco tenha exatamente estas pessoas em exercício. None = ninguém do
# diretório em exercício (interino de outro Poder, cargo vago ou fonte oficial que não confirma), e o último mandato que deixou o
# cargo tem de trazer o motivo (`vacancy_note`) para a tela mostrar "—" com ele. Mudou na fonte: atualizar aqui e na lista
# EXECUTIVO_FORA_DO_TSE (derive_stats). (UF) -> (governador, vice, fonte do governador)
GOVERNO_POR_UF: dict[str, tuple[str | None, str | None, str]] = {
    "AC": ("mailza", None, "https://agencia.ac.gov.br/gladson-cameli-transmite-governo-do-acre-para-mailza-assis-que-define-saude-emprego-e-seguranca-como-prioridades-um-tempo-de-trabalho-uniao-e-avanco/"),
    "AL": ("paulo-dantas", None, "https://alagoas.al.gov.br/governo/governador-de-alagoas"),
    "AM": ("roberto-cidade", "serafim-correa", "https://www.amazonas.am.gov.br/orgaos_entidades/governadoria/"),  # vice: ALEAM 14/10/2026 (D228)
    "AP": ("clecio", "teles-jr", "https://diofe.portal.ap.gov.br/portal/edicoes/download/10141"),
    "BA": ("jeronimo", "geraldo-junior", "https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/jeronimo-rodrigues-pt-e-reeleito-governador-da-bahia-no-1o-turno"),
    "CE": ("elmano-de-freitas", "jade-romero", "https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/elmano-de-freitas-e-reeleito-governador-do-ceara"),
    "DF": ("celina-leao", None, "https://www.cl.df.gov.br/-/celina-leao-toma-posse-como-governadora-do-distrito-federal"),
    "ES": ("ricardo-ferraco", None, "https://www.es.gov.br/Noticia/ricardo-ferraco-toma-posse-como-governador-do-espirito-santo"),
    "GO": ("daniel-vilela", None, "https://goias.gov.br/abc/daniel-vilela-toma-posse-como-governador-de-goias/"),
    "MA": ("carlos-brandao", "felipe-camarao", "https://egma.ma.gov.br/noticias/brandao-recebe-novo-presidente-da-famem-no-palacio-dos-leoes-e-celebra-a-unidade-entre-os-prefeitos-maranhenses"),
    "MG": ("professor-mateus", None, "https://www.mg.gov.br/governador/mateus-simoes-de-almeida"),
    "MS": ("eduardo-riedel", "barbosinha", "https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/eduardo-riedel-pp-e-eleito-governador-de-mato-grosso-do-sul"),
    "MT": ("otaviano-pivetta", None, "https://www.al.mt.gov.br/midia/texto/almt-da-posse-a-otaviano-pivetta-como-governador-apos-renuncia-de-mauro-mendes/visualizar"),
    "PA": ("hana", None, "https://www.seplad.pa.gov.br/2026/04/07/governadora-do-para-hana-ghassan-destaca-avancos-e-projeto-proximos-passos-do-estado/"),
    "PB": ("lucas-ribeiro", None, "https://auniao.pb.gov.br/noticias/caderno_politicas/lucas-ribeiro-assume-governo-da-pb"),
    "PE": ("raquel-lyra", "priscila-krause", "https://portal.tjpe.jus.br/-/presidente-do-tjpe-retransmite-governo-do-estado-a-raquel-lyra"),
    "PI": ("rafael-fonteles", "themistocles-filho", "https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/rafael-fonteles-pt-e-reeleito-governador-do-piaui"),
    "PR": ("carlos-massa-ratinho-junior", "darci-piana", "https://www.parana.pr.gov.br/aen/Noticia/Ratinho-Junior-assina-decreto-que-estabelece-regras-da-transicao-para-governador-eleito"),
    "RJ": (None, None, "https://noticias.stf.jus.br/postsnoticias/stf-decide-que-presidente-do-tj-deve-ser-mantido-como-governador-do-rio-de-janeiro/"),
    "RN": ("fatima-bezerra", "walter-alves", "https://webdisk.diariooficial.rn.gov.br/Jornal/12026-10-30.pdf"),
    "RO": ("coronel-marcos-rocha", "sergio-goncalves", "https://rondonia.ro.gov.br/encontro-de-catadores-de-materiais-reciclaveis-de-rondonia-aponta-a-consolidacao-da-politica-publica-de-reciclagem/"),
    "RR": (None, None, "https://al.rr.leg.br/2026/04/30/apos-decisao-do-tse-alerr-oficializa-troca-de-comando-interina-nos-poderes-executivo-e-legislativo/"),
    "RS": ("eduardo-leite", "gabriel-souza", "https://www.estado.rs.gov.br/vice-governador"),
    "SC": ("jorginho-mello", "delegada-marilisa", "https://portal.doe.sea.sc.gov.br/repositorio/2026/20261016/Jornal/22862.pdf"),
    "SE": ("fabio", "zezinho", "https://www.tse.jus.br/comunicacao/noticias/2026/Outubro/em-sergipe-fabio-mitidieri-psd-e-reeleito-governador-do-estado"),
    "SP": ("tarcisio", "felicio-ramuth", "https://www.sp.gov.br/sp/institucional/estrutura/governador"),
    "TO": ("wanderlei-barbosa", "laurez-moreira", "https://www.to.gov.br/secom/noticias/governador-wanderlei-barbosa-entrega-veiculos-e-fortalece-a-rede-de-assistencia-social-em-17-municipios/74pk0974rl81"),
}
def _sql_slug(x: str | None) -> str:
    return f"'{x}'" if x else "null"


_GOV_VALUES = ", ".join(
    f"('{uf}', 'governador', {_sql_slug(g)}), ('{uf}', 'vice_governador', {_sql_slug(v)})" for uf, (g, v, _) in sorted(GOVERNO_POR_UF.items())
)

# BUG-020 / D183: cota parlamentar de uma amostra fixa contra o total da Câmara (arquivo Ano-AAAA.csv.zip + linhas que só a API
# tem, D181), conferido em 03/11/2026 na API /deputados/{id}/despesas e na página camara.leg.br/deputados/{id}?ano=AAAA.
# (id da Câmara, ano) -> centavos. Tolerância de 0,5% para republicação da fonte; o defeito do BUG-020 era -9% a -14%.
COTA_REFERENCIA: dict[tuple[str, int], int] = {
    ("204528", 2024): 6_712_529, ("204528", 2025): 10_469_375,    # Adriana Ventura (2025: 104.693,75; antes da correção 89.595,04)
    ("178975", 2024): 31_139_916, ("178975", 2025): 37_720_507,   # Baleia Rossi (2025 antes: 343.601,05)
    ("204534", 2024): 51_872_520, ("204534", 2025): 53_151_883,   # Tabata Amaral
    ("204536", 2024): 16_236_521, ("204536", 2025): 15_175_134,   # Kim Kataguiri
    ("209787", 2024): 41_202_602, ("209787", 2025): 46_343_464,   # Nikolas Ferreira
    # BUG-030 / D200: deputados com "complementação do auxílio-moradia" (subcota 40), que a Câmara soma e o banco subtraía.
    # Página camara.leg.br/deputados/{id}?ano=AAAA lida em 03/11/2026; entre parênteses, o banco antes da correção.
    ("220616", 2024): 51_637_469,   # Luciano Vieira (PL-RJ): 516.374,69 (antes 449.993,86)
    ("220645", 2025): 50_661_691,   # Erika Hilton (PSOL-SP): 506.616,91 (antes 444.871,49)
    ("104552", 2024): 58_455_230,   # Socorro Neri (AC, Norte): 584.552,30 (antes 489.824,30)
    ("180214", 2025): 62_110_520,   # Pastor Diniz (RR, Norte): 621.105,20 (antes 529.871,20)
    ("141464", 2024): 56_585_432,   # José Airton Félix Cirilo (CE, Nordeste): 565.854,32 (antes 476.820,32)
    ("204431", 2025): 57_080_589,   # Marcos Aurélio Sampaio (PI, Nordeste): 570.805,89 (antes 528.877,89)
    # "passagem aérea - missão oficial" (subcota 996): mesmo sinal invertido, e a API repetia a linha sem documento
    ("160541", 2025): 43_540_301,   # 435.403,01 (antes 249.604,71)
    # BUG-034 / D230: linha com glosa e líquido = documento - 2 x glosa; a página soma o documento.
    ("92346", 2020): 31_837_074,    # Eduardo Bolsonaro: 318.370,74 (antes 310.702,74; fev 6800/3834/-868)
    ("141421", 2021): 49_125_201,   # Eduardo da Fonte: 491.252,01 (antes 464.478,01; ago e set, 3 linhas)
    ("204409", 2022): 35_495_817,   # Daniel Trzeciak: 354.958,17 (antes 352.526,55; mesmo documento duas vezes na subcota 3)
    # Enio Verri 2020 (132504) fica fora: a página dá 423.942,17 e a linha 6550/4431.33/-1762.66 não tem regra que a
    # explique (D230); o banco mantém o valor da fonte, 416.179,51.
}
def stamp_regua_h(tasks=None) -> dict[str, int]:
    """BUG-055: prefixo de dataset -> horas até o carimbo vencer, para as tarefas com cadência maior que 48 h (cadência +
    STAMP_FOLGA_H). Só prefixos fixos (as famílias por ano do TSE têm a régua própria de 60 dias). O resto fica em 48 h."""
    out: dict[str, int] = {}
    for t in schedule.TASKS if tasks is None else tasks:
        if t.every_h > STAMP_DIARIO_H and not callable(t.prefixes):
            for p in t.prefixes:
                out[p] = max(out.get(p, 0), t.every_h + STAMP_FOLGA_H)
    return out


STAMP_DIARIO_H = 48  # régua das famílias diárias (votações, deputados, presença, despesas): não muda
STAMP_FOLGA_H = 48  # folga sobre a cadência da tarefa: uma falha, a nova tentativa (retry de 24 h) e a próxima chamada
_STAMP_REGUA_VALUES = ", ".join(f"('{p}', {h})" for p, h in sorted(stamp_regua_h().items())) or "(null, null)"

_COTA_VALUES = ", ".join(f"('{d}', {y}, {c})" for (d, y), c in sorted(COTA_REFERENCIA.items())) or "(null, null, null)"

_PREFEITOS_POR_MUNICIPIO = f"""
    select pl.ibge_code, (select count(*) from mandates m join offices o on o.id = m.office_id
                          where m.place_id = pl.id and o.slug = 'prefeito' and m.role = 'titular' and m.status = 'em_exercicio'
                            and m.started_on <= current_date and m.ends_on > current_date) as n
    from places pl where pl.kind = 'municipio'"""

# BUG-049 / D251: vereadores em exercício por município <= cadeiras da CF art. 29, IV (EC 58/2009), pela população do IBGE.
# O teto é calculado com a população de hoje (places.population); a Câmara fixa as cadeiras pela Lei Orgânica com a população
# da época da eleição, então município que encolheu de faixa elege mais do que o teto de hoje. Esses ficam aqui, com o número
# de eleitos do TSE como teto deles (não passa sem limite) e o motivo. Conferido em 04/11/2026: os 25 têm exatamente os
# eleitos do TSE 2024 em exercício. Manacapuru (21) está acima do teto da CF até pela população do Censo; é o que o TSE publicou.
VEREADOR_FAIXAS: list[tuple[int, int]] = [
    (15_000, 9), (30_000, 11), (50_000, 13), (80_000, 15), (120_000, 17), (160_000, 19), (300_000, 21), (450_000, 23), (600_000, 25),
    (750_000, 27), (900_000, 29), (1_050_000, 31), (1_200_000, 33), (1_350_000, 35), (1_500_000, 37), (1_800_000, 39), (2_400_000, 41),
    (3_000_000, 43), (4_000_000, 45), (5_000_000, 47), (6_000_000, 49), (7_000_000, 51), (8_000_000, 53), (2_147_483_647, 55),
]
VEREADOR_EXCECOES: dict[str, tuple[int, str]] = {
    "1302504": (21, "Manacapuru/AM: o TSE elegeu 21 em 2024; IBGE 2026 = 113.042 hab."),
    "1303569": (13, "Rio Preto da Eva/AM: o TSE elegeu 13 em 2024; IBGE 2026 = 25.342 hab."),
    "1303601": (11, "Santa Isabel do Rio Negro/AM: o TSE elegeu 11 em 2024; IBGE 2026 = 13.724 hab."),
    "1503457": (13, "Ipixuna do Pará/PA: o TSE elegeu 13 em 2024; IBGE 2026 = 28.403 hab."),
    "1506708": (13, "Santana do Araguaia/PA: o TSE elegeu 13 em 2024; IBGE 2026 = 29.273 hab."),
    "2100477": (13, "Alto Alegre do Pindaré/MA: o TSE elegeu 13 em 2024; IBGE 2026 = 26.241 hab."),
    "2102077": (11, "Bom Lugar/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 12.333 hab."),
    "2102358": (11, "Buritirana/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 13.098 hab."),
    "2102408": (11, "Cajapió/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 10.331 hab."),
    "2103307": (19, "Codó/MA: o TSE elegeu 19 em 2024; IBGE 2026 = 118.272 hab."),
    "2106300": (11, "Magalhães de Almeida/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 13.873 hab."),
    "2106904": (13, "Monção/MA: o TSE elegeu 13 em 2024; IBGE 2026 = 28.526 hab."),
    "2110278": (11, "Santo Amaro do Maranhão/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 14.294 hab."),
    "2111029": (11, "São João do Carú/MA: o TSE elegeu 11 em 2024; IBGE 2026 = 12.305 hab."),
    "2112704": (15, "Vargem Grande/MA: o TSE elegeu 15 em 2024; IBGE 2026 = 44.359 hab."),
    "2114007": (15, "Zé Doca/MA: o TSE elegeu 15 em 2024; IBGE 2026 = 41.704 hab."),
    "2300705": (11, "Alto Santo/CE: o TSE elegeu 11 em 2024; IBGE 2026 = 14.327 hab."),
    "2801504": (11, "Carmópolis/SE: o TSE elegeu 11 em 2024; IBGE 2026 = 14.226 hab."),
    "2804201": (11, "Monte Alegre de Sergipe/SE: o TSE elegeu 11 em 2024; IBGE 2026 = 14.829 hab."),
    "2805406": (13, "Poço Redondo/SE: o TSE elegeu 13 em 2024; IBGE 2026 = 29.352 hab."),
    "2905156": (11, "Caetanos/BA: o TSE elegeu 11 em 2024; IBGE 2026 = 11.370 hab."),
    "3134004": (11, "Itinga/MG: o TSE elegeu 11 em 2024; IBGE 2026 = 13.928 hab."),
    "3145307": (13, "Novo Cruzeiro/MG: o TSE elegeu 13 em 2024; IBGE 2026 = 27.094 hab."),
    "5007935": (11, "Sonora/MS: o TSE elegeu 11 em 2024; IBGE 2026 = 14.804 hab."),
    "5107701": (11, "Rosário Oeste/MT: o TSE elegeu 11 em 2024; IBGE 2026 = 14.848 hab."),
}


def vereador_seats(population: int) -> int:
    """Cadeiras máximas de vereador pela população (CF art. 29, IV)."""
    return next(s for lim, s in VEREADOR_FAIXAS if population <= lim)


_VER_FAIXAS = ", ".join(f"({l}, {s})" for l, s in VEREADOR_FAIXAS)
_VER_EXC = ", ".join(f"('{k}', {n})" for k, (n, _) in sorted(VEREADOR_EXCECOES.items()))
VEREADORES_ACIMA_DO_TETO = f"""
    with f(lim, seats) as (values {_VER_FAIXAS}),
         exc(ibge_code, seats) as (values {_VER_EXC}),
         cad as (select pl.id, pl.ibge_code, coalesce(x.seats, (select min(f.seats) from f where pl.population <= f.lim)) seats
                 from places pl left join exc x on x.ibge_code = pl.ibge_code where pl.kind = 'municipio' and pl.population is not null),
         ex as (select m.place_id, count(*) n from mandates m join offices o on o.id = m.office_id and o.slug = 'vereador'
                where m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date group by 1)
    select cad.ibge_code, cad.seats, ex.n from cad join ex on ex.place_id = cad.id where ex.n > cad.seats"""

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
             order by m.person_id, po.observed_on desc, """ + party_obs_tiebreak("po") + """)
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
        # BUG-030 / D200: lançamento administrativo sem documento fiscal (complementação do auxílio-moradia, missão oficial) é
        # gasto: a Câmara publica o líquido com sinal trocado e a página soma. Estorno legítimo tem documento e outra subcota.
        "cota: complementação do auxílio-moradia e passagem de missão oficial nunca negativas",
        """select count(*) from expenses x join legislative_bodies b on b.id = x.body_id and b.kind = 'camara_deputados'
           where x.amount_cents < 0 and (x.category ilike 'complementação do auxílio-moradia%' or x.category ilike 'passagem aérea - missão oficial%')""",
    ),
    (
        # BUG-020: chave por linha da fonte; o formato antigo (só ideDocumento) não pode voltar
        "cota da Câmara: toda linha com chave por linha da fonte (cotaAAAA: ou cotaapiAAAA:)",
        """select count(*) from expenses x join legislative_bodies b on b.id = x.body_id and b.kind = 'camara_deputados'
           where x.source_key !~ '^cota(api)?[0-9]{4}:'""",
    ),
    (
        # BUG-025 / D186: deputados estaduais. Os titulares eleitos da legislatura têm de fechar com as cadeiras da CF art. 27
        # (3x a bancada federal até 36; acima, +1 por deputado federal além de 12), e em exercício nunca passa das cadeiras.
        # Em exercício abaixo das cadeiras é esperado: suplente que assumiu não está em fonte aberta lida (ver D186).
        "assembleia: titulares eleitos da legislatura = cadeiras da CF art. 27, e em exercício <= cadeiras (por UF)",
        """with fed as (select pl.uf, count(*) n from mandates m join offices o on o.id = m.office_id and o.slug = 'deputado_federal'
                        join places pl on pl.id = m.place_id where m.status = 'em_exercicio' group by 1),
           cad as (select uf, case when n * 3 <= 36 then n * 3 else 36 + (n - 12) end as seats from fed where uf <> 'DF'),
           ini as (select max(m.started_on) d from mandates m join offices o on o.id = m.office_id and o.slug = 'deputado_estadual'
                   where m.role = 'titular' and m.started_on <= current_date and to_char(m.started_on, 'MM-DD') = '02-01'),
           leg as (select pl.uf,
                          count(distinct m.person_id) filter (where m.role = 'titular' and m.started_on = (select d from ini)) as tit,
                          count(*) filter (where m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date) as ex
                   from mandates m join offices o on o.id = m.office_id and o.slug = 'deputado_estadual' join places pl on pl.id = m.place_id
                   group by 1)
           select count(*) from cad c left join leg l using (uf) where l.tit is distinct from c.seats or coalesce(l.ex, 0) > c.seats""",
    ),
    (
        "UF: exatamente 1 governador titular em exercício (salvo exceção listada com motivo)",
        f"select count(*) from ({_GOVERNADORES_POR_UF}) x where x.n <> 1 and x.uf not in ({_GOV_EXC})",
    ),
    (
        # BUG-031 / D203: contar linhas não basta (DF, RJ e RR passavam com quem já tinha saído). Cada UF: a pessoa em exercício
        # é a da lista conferida na fonte (GOVERNO_POR_UF), para governador e para vice; sem ninguém, o último mandato que deixou
        # o cargo explica a vaga (vacancy_note), e a UF sem governador tem de estar em GOVERNADOR_EXCECOES.
        "UF: governador e vice em exercício = lista conferida na fonte oficial (GOVERNO_POR_UF), e vaga com motivo",
        f"""with ref (uf, cargo, slug) as (values {_GOV_VALUES}),
           ex as (select pl.uf, o.slug as cargo, string_agg(p.slug, ',' order by p.slug) as slugs
                  from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id join people p on p.id = m.person_id
                  where pl.kind = 'uf' and o.slug in ('governador', 'vice_governador') and m.status = 'em_exercicio'
                    and m.started_on <= current_date and m.ends_on > current_date
                  group by 1, 2),
           ult as (select distinct on (pl.uf, o.slug) pl.uf, o.slug as cargo, m.vacancy_note
                   from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
                   where pl.kind = 'uf' and o.slug in ('governador', 'vice_governador') and m.status not in ('em_exercicio', 'eleito_aguardando_posse')
                   order by pl.uf, o.slug, m.started_on desc)
           select (select count(*) from ref r left join ex e using (uf, cargo) where e.slugs is distinct from r.slug)
                + (select count(*) from ref r left join ult u using (uf, cargo) where r.slug is null and u.vacancy_note is null)
                + (select count(*) from ref r where r.cargo = 'governador' and r.slug is null and r.uf not in ({_GOV_EXC}))
                + (select count(*) from (select distinct uf from ref) u where u.uf not in (select uf from places where kind = 'uf'))
                + abs((select count(*) from places where kind = 'uf') - (select count(distinct uf) from ref))""",
    ),
    (
        # BUG-031 / D203: quem renunciou, foi cassado ou encerrou não segue no cargo: mandato fechado acaba até hoje, e a mesma
        # pessoa não fica em exercício no mesmo cargo e lugar depois da própria saída
        "executivo: mandato com renúncia/cassação/encerramento termina até hoje e a pessoa não segue em exercício no mesmo cargo",
        """select (select count(*) from mandates m join offices o on o.id = m.office_id
                   where o.slug in ('presidente','vice_presidente','governador','vice_governador','prefeito','vice_prefeito')
                     and m.status in ('renunciou','cassado','encerrado') and m.ends_on > current_date)
                + (select count(*) from mandates a join mandates b on b.person_id = a.person_id and b.office_id = a.office_id and b.place_id = a.place_id
                   join offices o on o.id = a.office_id
                   where o.slug in ('governador','vice_governador') and a.status in ('renunciou','cassado')
                     and b.status = 'em_exercicio' and b.started_on >= a.ends_on and b.started_on <= current_date and b.ends_on > current_date)""",
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
        # catálogo D03: CGU (CEIS/CNEP) só vincula com órgão estadual/municipal (a UF do DTO é a do órgão) e todo não-vínculo tem motivo
        "sanções CGU: vínculo com órgão federal, ou não-vínculo sem motivo gravado",
        """select count(*) from sanctions where left(source, 4) = 'cgu_'
             and ((person_id is not null and lower(coalesce(body_sphere, '')) not in ('estadual', 'municipal'))
               or (person_id is null and match_note is null))""",
    ),
    (
        # catálogo D02 / D290: o Portal publica pago do ano acima do empenhado do ano quando há resto a pagar inscrito (Bancada do PR 2024,
        # 202471170016: empenhado 408 mil, pago 2,76 mi, inscrito 6,85 mi). Número da fonte, não erro de carga: a régua passa a ser
        # pago <= empenhado + resto inscrito. Acima disso o número não tem explicação na própria linha e o check quebra.
        "emendas: pago maior que empenhado mais resto a pagar inscrito",
        """select count(*) from amendments where paid_cents is not null and committed_cents is not null
             and paid_cents > committed_cents + coalesce(resto_inscrito_cents, 0)""",
    ),
    (
        # catálogo D02: emenda coletiva não tem autor individual; vínculo com pessoa só com método e confiança registrados
        "emendas: vínculo com pessoa sem método de casamento, ou emenda de bancada/comissão/relator ligada a uma pessoa",
        """select count(*) from amendments where person_id is not null
             and (match_method is null or match_confidence is null or kind in ('bancada', 'comissao', 'relator'))""",
    ),
    (
        # catálogo D11: a soma das origens de campanha é o total arrecadado do TSE (por construção; aqui, conferido no banco)
        "contas de campanha: soma das origens diferente do total arrecadado",
        """select count(*) from (select o.candidacy_id from campaign_finance_by_origin o join candidacies c on c.id = o.candidacy_id
                                 where c.raised_cents is not null group by o.candidacy_id, c.raised_cents
                                 having sum(o.amount_cents) <> c.raised_cents) x""",
    ),
    (
        # D128: vereador do SAPL casado só com pessoa que tem mandato de vereador naquele município.
        # D09: parlamentar de Assembleia com SAPL (casa = UF) casado só com deputado estadual da mesma UF.
        "SAPL: parlamentar casado com pessoa sem mandato do cargo certo na casa (vereador no município; deputado estadual na UF)",
        """select count(*) from sapl_parlamentares sp join sapl_houses h on h.id = sp.house_id join places hp on hp.id = h.place_id
           where sp.person_id is not null and (sp.match_status <> 'casado' or not exists (
             select 1 from mandates m join offices o on o.id = m.office_id join places mp on mp.id = m.place_id
             where m.person_id = sp.person_id
               and ((hp.kind = 'municipio' and o.slug = 'vereador' and m.place_id = h.place_id)
                 or (hp.kind = 'uf' and o.slug = 'deputado_estadual' and mp.uf = hp.uf))))""",
    ),
    (
        # D291: por família de dataset (sufixo de ano, mês ou período tirado). Ano/mês passado não é relido por desenho
        # (camara.votacoes.2019, agenda.senado.202501); cada um sozinho dava "vencido" para sempre (73 em 09/11/2026).
        # A família vence quando nem o carimbo mais novo dela está no prazo.
        # BUG-055: família de tarefa com cadência maior que 48 h (camara.equipe e parlamento.extras, semanais) vence na
        # cadência da própria tarefa + STAMP_FOLGA_H, tirada de schedule.TASKS (fonte única). As diárias seguem em 48 h.
        "stamp vencido: Câmara/Senado há mais de 48 h, TSE há mais de 60 dias (carimbo mais novo de cada família de dataset)",
        f"""select count(*) from (
             select s.slug, regexp_replace(ds.dataset, '\\.[0-9]{{4,8}}(-[0-9]{{8}})?$', '') as familia, max(ds.refreshed_at) as ultimo
               from dataset_stamps ds join sources s on s.id = ds.source_id
              where s.slug in ('camara', 'senado', 'tse')
                and ds.dataset not like '%.noturna%'  -- 2ª leitura só ter–sáb (D06): segunda de manhã já passa de 48 h
                and ds.dataset not like 'tse.fix%'    -- reparos pontuais, não são carga periódica
              group by 1, 2) f
           where (f.slug in ('camara','senado') and f.ultimo < now() - make_interval(hours => coalesce(
                    (select max(r.horas) from (values {_STAMP_REGUA_VALUES}) r(prefixo, horas)
                      where r.prefixo is not null and f.familia like r.prefixo || '%'), 48)))
              or (f.slug = 'tse' and f.ultimo < now() - interval '60 days')""",
    ),
    (
        "pauta: última leitura de cada Casa há mais de 24 h (o número da entrada estaria velho)",
        """select count(*) from (select distinct on (body_id) read_at from pauta_reads order by body_id, read_at desc) x
           where x.read_at < now() - interval '24 hours'""",
    ),
    (
        "pauta: regra vigente com tema que não existe em topics",
        """select count(*) from (select unnest(topic_slugs) s from pocket_rules order by version desc limit 1) r
           where not exists (select 1 from topics t where t.slug = r.s)""",
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
    (
        # BUG-049 / D251: retotalização do TSE rebaixou eleitos e o loader criou os novos sem encerrar os antigos (Tapauá: 14 de 11)
        "vereador: em exercício por município <= cadeiras da CF art. 29, IV (exceções em VEREADOR_EXCECOES, com motivo)",
        f"select count(*) from ({VEREADORES_ACIMA_DO_TETO}) x",
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
    sobra = [r["ibge_code"] for r in conn.execute(
        """select pl.ibge_code, pl.population, (select count(*) from mandates m join offices o on o.id = m.office_id and o.slug = 'vereador'
                  where m.place_id = pl.id and m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date) n
           from places pl where pl.kind = 'municipio' and pl.ibge_code = any(%s)""", (sorted(VEREADOR_EXCECOES),))
             if r["population"] is not None and r["n"] <= vereador_seats(r["population"])]
    if sobra:
        log.warning("exceção de vereador vencida (o município já cabe no teto pela população; tirar de VEREADOR_EXCECOES): %s", ", ".join(sorted(sobra)))
    failed += run_identity_checks(conn)
    if failed:
        log.error("%d invariante(s) quebrada(s)", failed)
    return failed
