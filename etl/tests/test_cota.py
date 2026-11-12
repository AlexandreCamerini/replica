"""BUG-020: cota parlamentar da Câmara. Várias linhas por `ideDocumento` (emissão, estorno, taxa) e `ideDocumento = 0` em
linhas sem documento: a chave antiga (só o documento) guardava a última linha de cada documento. D180-D183."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.camara_diario import (cota_api_amounts, cota_api_extra, cota_glosa_em_outra_linha, cota_keys, cota_liquido, cota_occurred,
                                           cota_seis_digitos)
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


def test_amostra_de_cota_bate_com_a_camara(conn, carga):
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
    assert cota_liquido("6550", "4431.33", "-1762.66") == -176266  # Enio Verri 10/2020: sem regra que explique a página (D230)
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


def test_luciano_vieira_2024_bate_com_a_pagina(conn, carga):
    row = conn.execute(
        """select sum(x.amount_cents) as s from expenses x where x.source_key ~ '^cota(api)?2024:220616:'"""
    ).fetchone()
    assert abs(row["s"] - 51_637_469) <= 100  # R$ 1 de tolerância (hoje: -0,03)


# BUG-034 / D230: glosa descontada duas vezes no líquido (vlrLiquido = documento - 2 x glosa). A página soma o documento.
# Linhas reais dos arquivos Ano-AAAA.csv.zip, com o mês da página camara.leg.br/deputados/{id}?ano= lido em 03/11/2026.
def test_glosa_descontada_duas_vezes_vale_o_documento():
    assert cota_liquido("6800", "3834", "-868") == 680000          # Eduardo Bolsonaro 02/2020 (página: +7.668,00 no mês)
    assert cota_liquido("8700", "4687", "-674") == 870000          # Eduardo da Fonte 08/2021 (+9.374,00)
    assert cota_liquido("8700", "7683", "-6666") == 870000         # Eduardo da Fonte 09/2021 (+15.366,00 desta linha)
    assert cota_liquido("2515", "1017", "481") == 251500           # mesma pessoa e mês (+2.034,00; total do mês +17.400,00)
    assert cota_liquido("9370", "1522", "6326") == 937000          # Félix Mendonça Júnior 08/2024 (+3.044,00)
    assert cota_liquido("8955", "42", "8871") == 895500            # André Ferreira 03/2022 (+84,00)


def test_glosa_simples_continua_liquido():
    assert cota_liquido("2495.16", "10", "2485.16") == 248516
    assert cota_liquido("30000", "11998", "11179.7") == 1117970   # Amaro Neto 12/2022: outro padrão; a página bate com a fonte


def test_rateio_com_glosa_em_outra_subcota_fica_como_a_fonte():
    # Bia Kicis 10/2019, documento 6939207 dividido: alimentação 993.9/0/72 e hospedagem 993.9/72/849.9. A página soma 849.9.
    linhas = [("204374", "6939207", "0", "72"), ("204374", "6939207", "72", "849.9")]
    assert cota_glosa_em_outra_linha(linhas) == [False, True]
    assert cota_liquido("993.9", "72", "849.9", True) == 84990
    # Daniel Trzeciak 03/2022: o mesmo documento duas vezes na subcota 3 (4542.04/1215.81/2110.42 e 4542.04/1215.81/0 com
    # restituição). A outra linha não traz a glosa como líquido; a página soma o documento (+2.431,62 no mês).
    linhas = [("204409", "7356870", "1215.81", "2110.42"), ("204409", "7356870", "1215.81", "0")]
    assert cota_glosa_em_outra_linha(linhas) == [False, False]
    assert cota_liquido("4542.04", "1215.81", "2110.42", False) == 454204
    # documento vazio não agrupa
    assert cota_glosa_em_outra_linha([("1", "", "5", "1"), ("1", "-", "0", "5")]) == [False, False]


def test_api_aplica_a_mesma_regra_e_casa_com_o_arquivo():
    # Lafayette de Andrada 01/2025 (98057): 6805.82 / 528.49 / 5748.84 no arquivo e na API
    api = [{"codDocumento": "7877201", "valorDocumento": 6805.82, "valorGlosa": 528.49, "valorLiquido": 5748.84}]
    assert cota_api_amounts(api) == [680582]
    assert cota_api_extra([("7877201", 680582)], api) == []


# BUG-054: o arquivo traz 6 dígitos significativos; desde 12/11/2026 a API traz os centavos e o líquido negado fora do
# SIGEPA. Linhas reais de Tabata Amaral (204534), arquivo Ano-2025.csv.zip e API /deputados/{id}/despesas?ano=2025 lidos
# em 12/11/2026, exceto onde o comentário diz que o caso é sintético.
def test_arquivo_com_seis_digitos_casa_com_a_api():
    api = [{"codDocumento": "7896551", "valorDocumento": 11892.53, "valorGlosa": 0.0, "valorLiquido": -11892.53},
           {"codDocumento": "7908965", "valorDocumento": 13848.35, "valorGlosa": 0.0, "valorLiquido": -13848.35}]
    assert cota_api_extra([("7896551", 1189250), ("7908965", 1384840)], api) == []  # arquivo: "11892.5" e "13848.4"


def test_missao_oficial_sem_documento_com_seis_digitos():
    # sintético, montado sobre 160541/2025 (BUG-030): arquivo "61932.8" sem ideDocumento (como até 11/11) contra a API de
    # hoje, codDocumento null e 61932.76. O arquivo de 12/11 não traz essa linha; a simulação a mantém como complemento.
    api = [{"codDocumento": None, "valorDocumento": 61932.76, "valorGlosa": None, "valorLiquido": 61932.76}]
    assert cota_api_extra([("-", 6193280)], api) == []


def test_parcela_com_liquido_negado_pela_api_casa_com_o_arquivo():
    # 204534, documento 8022455 (parcela): arquivo 2500 / 0 / 311.55; API 2500 / 0 / -311.55
    api = [{"codDocumento": "8022455", "valorDocumento": 2500.0, "valorGlosa": 0.0, "valorLiquido": -311.55}]
    assert cota_api_extra([("8022455", 31155)], api) == []


def test_estorno_e_valor_diferente_continuam_complemento():
    # estorno de verdade (documento negativo) não troca de sinal para casar com a emissão
    estorno = {"codDocumento": "349900", "valorDocumento": -624.10, "valorGlosa": 0.0, "valorLiquido": -624.10}
    assert cota_api_extra([("349900", 62410)], [estorno]) == [estorno]
    # abaixo de 10.000 o arquivo tem centavos: só o valor exato casa
    api = {"codDocumento": "7000001", "valorDocumento": 9999.53, "valorGlosa": 0.0, "valorLiquido": 9999.53}
    assert cota_api_extra([("7000001", 999950)], [api]) == [api]
    # acima de 10.000, diferença maior que meia unidade do 6º dígito, ou arquivo com centavos: não casa
    api = {"codDocumento": "7000002", "valorDocumento": 11892.53, "valorGlosa": 0.0, "valorLiquido": 11892.53}
    assert cota_api_extra([("7000002", 1189240)], [api]) == [api]
    assert cota_api_extra([("7000002", 1189251)], [api]) == [api]
    # outro documento não casa
    assert cota_api_extra([("7000003", 1189250)], [api]) == [api]
    # SIGEPA só na API continua complemento
    sigepa = {"codDocumento": "81E9F9E5-A37C-4240-854E-8CAF6BBC5182", "valorDocumento": 1234.56, "valorGlosa": 0.0, "valorLiquido": 1234.56}
    assert cota_api_extra([("7896551", 1189250)], [sigepa]) == [sigepa]


def test_resultado_nao_depende_da_ordem_da_api():
    # revisão A: a linha negada de outro valor não pode consumir a linha do arquivo antes da linha de valor próprio
    negada = {"codDocumento": "D", "valorDocumento": 20000.0, "valorGlosa": 0.0, "valorLiquido": -11892.53}
    propria = {"codDocumento": "D", "valorDocumento": 11892.53, "valorGlosa": 0.0, "valorLiquido": 11892.53}
    arquivo = [("D", 1189250)]
    assert cota_api_extra(arquivo, [negada, propria]) == [negada]
    assert cota_api_extra(arquivo, [propria, negada]) == [negada]


def test_documento_dividido_em_duas_linhas_na_api_casa_pela_soma():
    # Lafayette de Andrada (98057) 01/2025, documento 7877201: arquivo 6805.82 / 528.49 / 5748.84 (D230: vale 6805.82);
    # a API de 12/11/2026 traz duas linhas, -6277.33 (D200 -> +6277.33) e +528.49. Página 2025: 523.494,83.
    api = [{"codDocumento": "7877201", "valorDocumento": 6805.82, "valorGlosa": 528.49, "valorLiquido": -6277.33},
           {"codDocumento": "7877201", "valorDocumento": 6805.82, "valorGlosa": 528.49, "valorLiquido": 528.49}]
    assert cota_api_amounts(api) == [627733, 52849]
    assert cota_api_extra([("7877201", 680582)], api) == []
    # soma diferente: as duas continuam complemento
    assert cota_api_extra([("7877201", 680583)], api) == api


def test_liquido_negado_sem_par_no_arquivo_continua_complemento():
    so_api = {"codDocumento": "8099999", "valorDocumento": 2500.0, "valorGlosa": 0.0, "valorLiquido": -311.55}
    assert cota_api_extra([("8022455", 31155)], [so_api]) == [so_api]
    assert cota_api_extra([], [so_api]) == [so_api]


def test_seis_digitos_tem_a_unidade_certa():
    assert cota_seis_digitos(1189253, 1189250)          # 11892.53 -> 11892.5
    assert cota_seis_digitos(1384835, 1384840)          # 13848.35 -> 13848.4 (meia unidade, inclusivo)
    assert cota_seis_digitos(29038682, 29038700)        # 290386.82 -> 290387
    assert not cota_seis_digitos(29038682, 29038600)
    assert not cota_seis_digitos(999953, 999950)        # abaixo de 10.000
    assert not cota_seis_digitos(-1189253, 1189250)     # sinal diferente


def test_referencia_tem_casos_de_glosa_dupla():
    assert COTA_REFERENCIA[("92346", 2020)] == 31_837_074     # Eduardo Bolsonaro: 318.370,74 na página
    assert COTA_REFERENCIA[("141421", 2021)] == 49_125_201    # Eduardo da Fonte: 491.252,01
    assert ("132504", 2020) not in COTA_REFERENCIA            # Enio Verri: divergência documentada (D230)
