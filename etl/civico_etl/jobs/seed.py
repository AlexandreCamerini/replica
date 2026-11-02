"""Dados de referência que não vêm de ETL: fontes, cargos, temas (regra v1), salários (norma citada), cobertura padrão.

Idempotente. Roda antes de qualquer outro job.
"""

from __future__ import annotations

from datetime import date

import psycopg

from ..db import upsert

SOURCES = [
    ("tse", "TSE · Dados Abertos", "https://dadosabertos.tse.jus.br/", "ODbL / Lei 12.527"),
    ("tse-titulo", "TSE · título de eleitor (chave interna de identidade)", "https://dadosabertos.tse.jus.br/", None),
    ("camara", "Câmara dos Deputados · Dados Abertos", "https://dadosabertos.camara.leg.br/", "CC0"),
    ("senado", "Senado Federal · Dados Abertos", "https://www12.senado.leg.br/dados-abertos", "Lei 12.527"),
    ("ibge", "IBGE · API de Localidades", "https://servicodados.ibge.gov.br/api/docs/localidades", "CC BY 4.0"),
    ("norma", "Norma publicada (DOU)", "https://www.in.gov.br/", None),
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

# Subsídio de deputados federais e senadores: Decreto Legislativo nº 7/2022 (DOU 23/12/2022), escalonado.
# Presidente, vice e ministros: mesmo decreto. Valores brutos mensais em centavos.
SALARIES = [
    ("deputado_federal", date(2023, 2, 1), 4_165_092), ("deputado_federal", date(2024, 4, 1), 4_400_852), ("deputado_federal", date(2025, 2, 1), 4_636_619),
    ("senador", date(2023, 2, 1), 4_165_092), ("senador", date(2024, 4, 1), 4_400_852), ("senador", date(2025, 2, 1), 4_636_619),
    ("presidente", date(2023, 2, 1), 4_165_092), ("presidente", date(2024, 4, 1), 4_400_852), ("presidente", date(2025, 2, 1), 4_636_619),
    ("vice_presidente", date(2023, 2, 1), 4_165_092), ("vice_presidente", date(2024, 4, 1), 4_400_852), ("vice_presidente", date(2025, 2, 1), 4_636_619),
]


def run_seed(conn: psycopg.Connection) -> None:
    upsert(conn, "sources", ["slug", "name", "url", "license"], SOURCES, ["slug"])
    upsert(conn, "offices", ["slug", "name_m", "name_f", "level"], OFFICES, ["slug"])
    upsert(conn, "topics", ["slug", "name", "keywords", "rule_version"], [(s, n, k, 1) for s, n, k in TOPICS], ["slug"])
    offices = {r["slug"]: r["id"] for r in conn.execute("select slug, id from offices")}
    norma = conn.execute("select id from sources where slug = 'norma'").fetchone()["id"]
    upsert(
        conn,
        "salaries",
        ["office_id", "place_id", "valid_from", "amount_cents", "is_ceiling", "source_id"],
        [(offices[o], None, d, c, False, norma) for o, d, c in SALARIES],
        ["office_id", "place_id", "valid_from", "is_ceiling"],
    )
    conn.commit()
