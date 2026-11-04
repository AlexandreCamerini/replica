"""W3-A: Assembleias. Regras puras (robots, fornecedor, rótulos) e o invariante de identidade contra o banco (com rollback)."""

from __future__ import annotations

import pytest

from civico_etl.jobs import assembleias as A


def test_robots_almg_bloqueia_paginacao_e_arquivo():
    base = "https://dadosabertos.almg.gov.br"
    A._robots[base] = [(True, "/documentacao/"), (True, "/api/ajuda/"), (True, "/api/v2/"),
                       (False, "/api/v2/*?*p="), (False, "/api/v2/*?*ord="), (False, "/api/v2/*?*tp="), (False, "/api/v2/*?*ordenacao="), (False, "/")]
    assert A.allowed(f"{base}/api/v2/deputados/em_exercicio?formato=json")
    assert A.allowed(f"{base}/api/v2/proposicoes/pesquisa/direcionada?tipo=PL&ano=2026&ini=20260101&fim=20260131&formato=json")
    assert not A.allowed(f"{base}/api/v2/proposicoes/pesquisa/direcionada?tipo=PL&ano=2026&p=2")
    assert not A.allowed(f"{base}/api/v2/proposicoes/pesquisa/avancada?tp=10&expr=greve")
    assert not A.allowed(f"{base}/arquivo/verbas-indenizatorias/download")


def test_robots_alesp_permite_repositorio():
    base = "https://www.al.sp.gov.br"
    A._robots[base] = [(False, "/web"), (False, "/StaticFile"), (False, "/repositorio/contratos")]
    assert A.allowed(f"{base}/repositorioDados/deputados/deputados.xml")
    assert not A.allowed(f"{base}/repositorio/contratos/x.pdf")


def test_fornecedor_so_com_cnpj():
    assert A.supplier("Posto X Ltda.", "04.775.850/0001-12") == ("Posto X Ltda.", "04775850000112")
    assert A.supplier("Maria da Silva", "123.456.789-01") == (None, None)  # CPF: nem nome nem documento
    assert A.supplier("12345678901 JOAO", "12345678000199") == (None, "12345678000199")  # MEI com CPF no nome
    assert A.supplier("Sem doc", "00000000000000") == (None, None)


def test_rotulos():
    assert A.category_label("D - MATERIAIS E SERVIÇOS GRÁFICOS") == "Materiais e serviços gráficos"
    assert A.category_label("Combustível e lubrificante") == "Combustível e lubrificante"
    assert A.not_read_reason("BA") == "a Assembleia Legislativa da Bahia ainda não é lida pelo site"
    assert A.not_read_reason("DF").startswith("a Câmara Legislativa do Distrito Federal")
    assert A.name_tokens("Deputada Fabiana Bolsonaro") == {"fabiana", "bolsonaro"}
    assert A.norm_party("PODEMOS") == A.norm_party("PODE")


def test_check_pega_vinculo_fora_da_uf(conn):
    """Um vínculo da ALESP para alguém sem mandato estadual em SP precisa quebrar o invariante."""
    from civico_etl.jobs.checks import CHECKS

    q = next(sql for name, sql in CHECKS if name.startswith("assembleia: todo vínculo"))
    src = conn.execute("select id from sources where slug = 'alesp'").fetchone()
    if not src:
        pytest.skip("ale.sp ainda não rodou")
    other = conn.execute(
        """select p.id from people p where not exists (select 1 from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
           where m.person_id = p.id and o.slug = 'deputado_estadual' and pl.uf = 'SP') limit 1""").fetchone()
    with conn.transaction(force_rollback=True):
        assert list(conn.execute(q).fetchone().values())[0] == 0
        conn.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, 'spl:teste', 'manual', 1)",
                     (other["id"], src["id"]))
        assert list(conn.execute(q).fetchone().values())[0] == 1
