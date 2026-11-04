"""Dados de referência que não vêm de ETL: fontes, cargos, temas (regra v1), salários (norma citada), cobertura padrão.

Idempotente. Roda antes de qualquer outro job.
"""

from __future__ import annotations

from datetime import date

import logging

import psycopg

from ..db import upsert

log = logging.getLogger("etl.seed")

SOURCES = [
    ("tse", "TSE · Dados Abertos", "https://dadosabertos.tse.jus.br/", "ODbL / Lei 12.527"),
    ("tse-titulo", "TSE · título de eleitor (chave interna de identidade)", "https://dadosabertos.tse.jus.br/", None),
    ("camara", "Câmara dos Deputados · Dados Abertos", "https://dadosabertos.camara.leg.br/", "CC0"),
    ("senado", "Senado Federal · Dados Abertos", "https://www12.senado.leg.br/dados-abertos", "Lei 12.527"),
    ("ibge", "IBGE · API de Localidades", "https://servicodados.ibge.gov.br/api/docs/localidades", "CC BY 4.0"),
    ("norma", "Norma publicada (DOU)", "https://www.in.gov.br/", None),
    ("tcu", "TCU · Dados abertos (inabilitados para função pública)", "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/", None),
    ("sapl", "SAPL das Câmaras Municipais (Interlegis/Senado Federal)", "https://www12.senado.leg.br/interlegis/produtos/sapl", None),
    ("constituicao", "Constituição Federal: art. 27 §2º (deputado estadual), art. 32 §3º (distrital), art. 29 VI (vereador)",
     "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm", None),
]

OFFICES = [
    ("presidente", "Presidente da República", "Presidenta da República", "federal"),
    ("vice_presidente", "Vice-presidente da República", "Vice-presidenta da República", "federal"),
    ("senador", "Senador", "Senadora", "federal"),
    ("deputado_federal", "Deputado federal", "Deputada federal", "federal"),
    ("governador", "Governador", "Governadora", "estadual"),
    ("vice_governador", "Vice-governador", "Vice-governadora", "estadual"),
    ("deputado_estadual", "Deputado estadual", "Deputada estadual", "estadual"),
    ("deputado_distrital", "Deputado distrital", "Deputada distrital", "estadual"),
    ("prefeito", "Prefeito", "Prefeita", "municipal"),
    ("vice_prefeito", "Vice-prefeito", "Vice-prefeita", "municipal"),
    ("vereador", "Vereador", "Vereadora", "municipal"),
]

# Regra v1: cada tema oficial da Câmara (proposicoesTemas) cai em exatamente um dos 17 temas do produto.
# Determinística e citável; mudar a regra = rule_version 2 e reprocessar proposal_topics.
TOPICS: list[tuple[str, str, list[str]]] = [
    ("saude", "Saúde", ["Saúde"]),
    ("educacao", "Educação", ["Educação"]),
    ("seguranca", "Segurança pública", ["Defesa e Segurança"]),
    ("economia", "Economia e tributos", ["Economia", "Finanças Públicas e Orçamento", "Indústria, Comércio e Serviços", "Direito e Defesa do Consumidor"]),
    ("trabalho", "Trabalho e previdência", ["Trabalho e Emprego"]),
    ("meio-ambiente", "Meio ambiente", ["Meio Ambiente e Desenvolvimento Sustentável"]),
    ("agro", "Agricultura e alimentos", ["Agricultura, Pecuária, Pesca e Extrativismo", "Estrutura Fundiária"]),
    ("cidades", "Cidades e transporte", ["Cidades e Desenvolvimento Urbano", "Viação, Transporte e Mobilidade"]),
    ("direitos", "Direitos humanos", ["Direitos Humanos e Minorias"]),
    ("cultura", "Cultura e esporte", ["Arte, Cultura e Religião", "Esporte e Lazer", "Turismo", "Homenagens e Datas Comemorativas"]),
    ("ciencia", "Ciência e tecnologia", ["Ciência, Tecnologia e Inovação", "Ciências Exatas e da Terra", "Ciências Sociais e Humanas"]),
    ("energia", "Energia e mineração", ["Energia, Recursos Hídricos e Minerais"]),
    ("assistencia", "Assistência social", ["Previdência e Assistência Social"]),
    ("gestao", "Gestão pública", ["Administração Pública", "Política, Partidos e Eleições", "Processo Legislativo e Atuação Parlamentar"]),
    ("justica", "Justiça", ["Direito e Justiça", "Direito Civil e Processual Civil", "Direito Penal e Processual Penal", "Direito Constitucional"]),
    ("defesa", "Defesa e relações exteriores", ["Relações Internacionais e Comércio Exterior"]),
    ("comunicacao", "Comunicação", ["Comunicações"]),
]

# Subsídio federal (CF art. 49 VII e VIII), valores brutos mensais em centavos, conferidos no texto publicado (D120):
#   DL 276/2014 (DOU 19/12/2014): membros do Congresso, R$ 33.763,00 com efeitos financeiros a partir de 01/02/2015.
#   DL 277/2014 (DOU 19/12/2014): Presidente, Vice e Ministros, R$ 30.934,70 a partir de 01/01/2015.
#   DL 172/2022 (DOU 22/12/2022): os dois grupos, escalonado em 01/01/2023, 01/04/2023, 01/02/2024 e 01/02/2025.
# Antes da W3-B o seed dizia "DL 7/2022" e datas 02/2023 e 04/2024: estava errado (D121).
SALARY_NORMS = [
    ("dl-276-2014", "Decreto Legislativo nº 276/2014 (subsídio dos membros do Congresso Nacional)",
     "https://www2.camara.leg.br/legin/fed/decleg/2014/decretolegislativo-276-18-dezembro-2014-779806-publicacaooriginal-145682-pl.html", None),
    ("dl-277-2014", "Decreto Legislativo nº 277/2014 (subsídio de Presidente, Vice-Presidente e Ministros)",
     "https://www2.camara.leg.br/legin/fed/decleg/2014/decretolegislativo-277-18-dezembro-2014-779807-publicacaooriginal-145683-pl.html", None),
    ("dl-172-2022", "Decreto Legislativo nº 172/2022 (subsídios federais escalonados 2023–2025)",
     "https://www2.camara.leg.br/legin/fed/decleg/2022/decretolegislativo-172-21-dezembro-2022-793529-publicacaooriginal-166604-pl.html", None),
]
_DL172 = [(date(2023, 1, 1), 3_929_332), (date(2023, 4, 1), 4_165_092), (date(2024, 2, 1), 4_400_852), (date(2025, 2, 1), 4_636_619)]
SALARIES: list[tuple[str, date, int, str]] = (
    [(o, date(2015, 2, 1), 3_376_300, "dl-276-2014") for o in ("deputado_federal", "senador")]
    + [(o, date(2015, 1, 1), 3_093_470, "dl-277-2014") for o in ("presidente", "vice_presidente")]
    + [(o, d, c, "dl-172-2022") for o in ("deputado_federal", "senador", "presidente", "vice_presidente") for d, c in _DL172]
)
FEDERAL_OFFICES = ("deputado_federal", "senador", "presidente", "vice_presidente")


# D14: tetos constitucionais (is_ceiling = true; a casa pode pagar menos). Derivados do subsídio federal acima, na mesma data.
#   deputado estadual e distrital: até 75% do deputado federal (CF art. 27 §2º; art. 32 §3º)
#   vereador: % do deputado estadual pela população do município (CF art. 29 VI, EC 25/2000):
#     até 10 mil 20%; até 50 mil 30%; até 100 mil 40%; até 300 mil 50%; até 500 mil 60%; acima 75%
#   governador e prefeito: lei estadual/municipal, sem teto constitucional fixo -> não semeado ("—" até a carga das leis)
STATE_SHARE = 0.75

CEILINGS_SQL = """
insert into salaries (office_id, place_id, valid_from, amount_cents, is_ceiling, source_id)
select o.id, p.id, s.valid_from,
       round(s.amount_cents * 0.75 * case when p.population <= 10000 then 0.20 when p.population <= 50000 then 0.30
                                          when p.population <= 100000 then 0.40 when p.population <= 300000 then 0.50
                                          when p.population <= 500000 then 0.60 else 0.75 end)::bigint,
       true, (select id from sources where slug = 'constituicao')
from salaries s join offices f on f.id = s.office_id and f.slug = 'deputado_federal'
cross join places p join offices o on o.slug = 'vereador'
where s.place_id is null and not s.is_ceiling and p.kind = 'municipio' and p.population is not null
on conflict (office_id, place_id, valid_from, is_ceiling) do update set amount_cents = excluded.amount_cents, source_id = excluded.source_id, updated_at = now()
"""


def _drop_stale_federal(conn: psycopg.Connection, offices: dict[str, object]) -> None:
    """Apaga valores nacionais e tetos derivados em datas que não constam de SALARIES (D121: datas erradas do seed antigo).

    Só toca linhas com place_id nulo dos cargos federais e tetos (estadual/distrital/vereador) em datas fora da tabela
    do deputado federal; valor pago municipal/estadual (is_ceiling = false com place_id) nunca é apagado aqui.
    """
    fed_dates = sorted({d for o, d, _, _ in SALARIES if o == "deputado_federal"})
    keep = [(offices[o], d) for o, d, _, _ in SALARIES]
    cur = conn.execute(
        """delete from salaries s using offices o
           where o.id = s.office_id and s.place_id is null and not s.is_ceiling and o.slug = any(%s)
             and (s.office_id, s.valid_from) not in (select * from unnest(%s::uuid[], %s::date[]))""",
        (list(FEDERAL_OFFICES), [k[0] for k in keep], [k[1] for k in keep]),
    )
    n1 = cur.rowcount
    cur = conn.execute(
        """delete from salaries s using offices o
           where o.id = s.office_id and s.is_ceiling and o.slug in ('deputado_estadual', 'deputado_distrital', 'vereador')
             and s.source_id = (select id from sources where slug = 'constituicao') and s.valid_from <> all(%s::date[])""",
        (fed_dates,),
    )
    if n1 or cur.rowcount:
        log.info("seed: %d subsídios federais e %d tetos derivados em datas fora da norma removidos", n1, cur.rowcount)


def run_seed(conn: psycopg.Connection) -> None:
    upsert(conn, "sources", ["slug", "name", "url", "license"], SOURCES + SALARY_NORMS, ["slug"])
    upsert(conn, "offices", ["slug", "name_m", "name_f", "level"], OFFICES, ["slug"])
    upsert(conn, "topics", ["slug", "name", "keywords", "rule_version"], [(s, n, k, 1) for s, n, k in TOPICS], ["slug"])
    offices = {r["slug"]: r["id"] for r in conn.execute("select slug, id from offices")}
    src = {r["slug"]: r["id"] for r in conn.execute("select slug, id from sources")}
    upsert(
        conn,
        "salaries",
        ["office_id", "place_id", "valid_from", "amount_cents", "is_ceiling", "source_id"],
        [(offices[o], None, d, c, False, src[n]) for o, d, c, n in SALARIES],
        ["office_id", "place_id", "valid_from", "is_ceiling"],
    )
    _drop_stale_federal(conn, offices)
    cf = conn.execute("select id from sources where slug = 'constituicao'").fetchone()["id"]
    upsert(
        conn,
        "salaries",
        ["office_id", "place_id", "valid_from", "amount_cents", "is_ceiling", "source_id"],
        [(offices[o], None, d, round(c * STATE_SHARE), True, cf) for o in ("deputado_estadual", "deputado_distrital") for fo, d, c, _ in SALARIES if fo == "deputado_federal"],
        ["office_id", "place_id", "valid_from", "is_ceiling"],
    )
    # vereador: só onde há população do IBGE (job ibge.populacao); sem população -> sem teto ("—")
    if conn.execute("select 1 from information_schema.columns where table_name = 'places' and column_name = 'population'").fetchone():
        conn.execute(CEILINGS_SQL)
    conn.commit()
