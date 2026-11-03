"""BUG-020: cota parlamentar da Câmara. Várias linhas por `ideDocumento` (emissão, estorno, taxa) e `ideDocumento = 0` em
linhas sem documento: a chave antiga (só o documento) guardava a última linha de cada documento. D180-D183."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.camara_diario import cota_api_extra, cota_keys, cota_occurred
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
