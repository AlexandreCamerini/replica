"""BUG-020: cota parlamentar da Câmara. Várias linhas por `ideDocumento` (emissão, estorno, taxa) e `ideDocumento = 0` em
linhas sem documento: a chave antiga (só o documento) guardava a última linha de cada documento. D180-D183."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.camara_diario import cota_api_extra, cota_keys, cota_liquido, cota_occurred
from civico_etl.jobs.checks import CHECKS, COTA_REFERENCIA

# Adriana Ventura (204528), passagem SIGEPA 2025-08-27: emissão e estorno no mesmo documento
EMISSAO = ("204528", "349900", ("998", "0", "09296295000160", "ABC123", "0", "2025-08-27T00:00:00", "624.10", "0", "624.10", "8", "0", "Fulana", "CGH/BSB", "0", "0", ""))
ESTORNO = ("204528", "349900", ("998", "0", "09296295000160", "ABC123", "0", "2025-08-27T00:00:00", "-624.10", "0", "-624.10", "8", "0", "Fulana", "CGH/BSB", "0", "0", ""))
TAXA = ("204528", "349900", ("998", "0", "09296295000160", "ABC123", "0", "2025-08-27T00:00:00", "105.00", "0", "105.00", "8", "0", "Fulana", "CGH/BSB", "0", "0", ""))
SEM_DOC = ("204528", "0", ("3", "0", "", "7801156", "0", "", "104.68", "0", "104.68", "2", "0", "", "", "0", "0", ""))


def test_linhas_do_mesmo_documento_tem_chaves_distintas():
    keys = cota_keys([EMISSAO, ESTORNO, TAXA, SEM_DOC, SEM_DOC], "cota2025")
    assert len(set(keys)) == 5
    assert all(k.startswith("cota2025:204528:") for k in keys)


def test_chave_nao_depende_da_ordem_do_arquivo():
    a = dict(zip([EMISSAO, ESTORNO, TAXA, SEM_DOC], cota_keys([EMISSAO, ESTORNO, TAXA, SEM_DOC], "cota2025")))
    b = dict(zip([SEM_DOC, TAXA, ESTORNO, EMISSAO], cota_keys([SEM_DOC, TAXA, ESTORNO, EMISSAO], "cota2025")))
    assert a == b


def test_recarga_do_mesmo_arquivo_gera_as_mesmas_chaves():
    rows = [EMISSAO, ESTORNO, TAXA, SEM_DOC, SEM_DOC]
    assert cota_keys(rows, "cota2025") == cota_keys(list(rows), "cota2025")


def test_complemento_da_api_e_diferenca_de_multiconjunto():
    arquivo = [("349900", 62410), ("349900", -62410), ("0", 10468)]
    api = [
        {"codDocumento": "349900", "valorLiquido": 624.10},
        {"codDocumento": "349900", "valorLiquido": -624.10},
        {"codDocumento": "349900", "valorLiquido": 624.10},  # segunda emissão: falta no arquivo
        {"codDocumento": "81E9F9E5-A37C-4240-854E-8CAF6BBC5182", "valorLiquido": 189.34},  # SIGEPA novo, só na API
    ]
    extra = cota_api_extra(arquivo, api)
    assert [(x["codDocumento"], x["valorLiquido"]) for x in extra] == [("349900", 624.10), ("81E9F9E5-A37C-4240-854E-8CAF6BBC5182", 189.34)]


def test_data_conta_no_ano_de_competencia():
    assert cota_occurred("2025-08-27T00:00:00", "2025", "8") == date(2025, 8, 27)
    assert cota_occurred("2024-12-30T00:00:00", "2025", "1") == date(2025, 1, 1)  # emitida em 2024, lançada em 01/2025
    assert cota_occurred("0023-05-02", 2023, 5) == date(2023, 5, 1)  # data digitada errada (CEAPS)
    assert cota_occurred("", "2025", "3") == date(2025, 3, 1)
    assert cota_occurred(None, None, None) is None


def _check(name_part: str) -> str:
    return next(q for n, q in CHECKS if name_part in n)


def test_amostra_de_cota_bate_com_a_camara(conn):
    assert len(COTA_REFERENCIA) >= 5
    assert list(conn.execute(_check("cota: amostra fixa")).fetchone().values())[0] == 0


def test_nenhuma_chave_antiga_de_cota(conn):
    assert list(conn.execute(_check("chave por linha da fonte")).fetchone().values())[0] == 0


# BUG-030 / D200: sinal do valor líquido. Linhas reais do Ano-2024.csv.zip e do Ano-2020.csv.zip.
def test_complementacao_do_auxilio_moradia_soma():
    # Luciano Vieira (220616), subcota 40: vlrDocumento 4148.8, vlrGlosa vazio, vlrLiquido -4148.8
    assert cota_liquido("4148.8", "", "-4148.8") == 414880
    # passagem de missão oficial (subcota 996), mesmo padrão
    assert cota_liquido("61932.8", "", "-61932.8") == 6193280


def test_estorno_legitimo_continua_negativo():
    # bilhete de compensação (subcota 998): documento negativo
    assert cota_liquido("-44.48", "0", "-44.48") == -4448
    assert cota_liquido("-3757.56", "0", "-3757.56") == -375756


def test_liquido_publicado_vale_quando_nao_e_o_oposto_exato():
    assert cota_liquido("6800", "3834", "-868") == -86800        # glosa maior que o líquido devido: fica como a fonte
    assert cota_liquido("624.10", "0", "624.10") == 62410
    assert cota_liquido("104.68", "104.68", "0") == 0            # telefonia coberta pela franquia
    assert cota_liquido("10", "", "") is None                    # sem líquido: rejeitada como antes


def test_api_sem_documento_casa_com_linha_do_arquivo_sem_documento():
    # 160541/2025: o arquivo grava a missão oficial com doc "-" e +61932.80; a API traz codDocumento null e -61932.8
    arquivo = [("-", 6193280)]
    api = [{"codDocumento": None, "valorDocumento": 61932.8, "valorGlosa": None, "valorLiquido": -61932.8}]
    assert cota_api_extra(arquivo, api) == []


def test_referencia_tem_casos_com_complementacao():
    assert COTA_REFERENCIA[("220616", 2024)] == 51_637_469  # Luciano Vieira: 516.374,69 na página da Câmara
    for k in [("220616", 2024), ("104552", 2024), ("180214", 2025), ("141464", 2024), ("204431", 2025)]:
        assert k in COTA_REFERENCIA


def test_nenhuma_complementacao_negativa_no_banco(conn):
    assert list(conn.execute(_check("nunca negativas")).fetchone().values())[0] == 0


def test_luciano_vieira_2024_bate_com_a_pagina(conn):
    row = conn.execute(
        """select sum(x.amount_cents) as s from expenses x where x.source_key ~ '^cota(api)?2024:220616:'"""
    ).fetchone()
    assert abs(row["s"] - 51_637_469) <= 100  # R$ 1 de tolerância (hoje: -0,03)
