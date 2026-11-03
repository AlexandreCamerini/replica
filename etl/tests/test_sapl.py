"""Item 4 da W3-B: SAPL das Câmaras Municipais (D126–D129)."""

from __future__ import annotations

from civico_etl.jobs.sapl import _desc_until, is_sapl_api, match_names, parse_registry

CARD = """<div class="orgao-atendido">
<div class="col-md-10 col-sm-12 descricao-orgao">
    <div style="font-weight:bold;margin-bottom:3px;">Assembleia Legislativa do Rio Grande do Norte</div></div>
<table><tr><td>SAPL</td><td>01/01/2015</td><td><a href="https://sapl.al.rn.leg.br/">x</a></td><td>-</td><td>Funcionando</td><td>-</td></tr></table>
</div>
<div class="orgao-atendido">
    <div style="font-weight:bold;margin-bottom:3px;">Câmara Municipal de Natal</div>
<table>
    <tr><td>Portal Modelo</td><td>26/11/2013</td><td><a target="_blank" href="https://www.natal.rn.leg.br/">p</a></td><td>12/03/2024</td><td>Funcionando</td><td>-</td></tr>
    <tr><td>SAPL</td><td>30/09/2010</td><td><a target="_blank" href="http://sapl.natal.rn.leg.br/">http://sapl.natal.rn.leg.br/</a></td><td>24/02/2026</td><td>Funcionando</td><td>23/02/2026</td></tr>
</table></div>"""


def test_registro_pega_a_camara_e_nao_a_assembleia():
    assert parse_registry(CARD, "Natal") == ("https://sapl.natal.rn.leg.br", "Funcionando")


def test_registro_sem_sapl():
    sem = CARD.replace("<td>SAPL</td><td>30/09/2010</td>", "<td>Domínio .LEG.br</td><td>30/09/2010</td>")
    assert parse_registry(sem, "Natal") == (None, None)
    assert parse_registry(CARD, "Parnamirim") == (None, None)


def test_indice_da_api():
    assert is_sapl_api({"parlamentares/parlamentar": "u", "materia/materialegislativa": "u"})
    assert not is_sapl_api({"detail": "Not found"}) and not is_sapl_api([])


CANDS = [
    {"person_id": "a", "display_name": "Anne Lagartixa", "civil_name": "Wesliane Karen Castilho de Almeida"},
    {"person_id": "b", "display_name": "Brisa", "civil_name": "Brisa Silva Bracchi"},
    {"person_id": "c", "display_name": "Pedro Gomes", "civil_name": "Pedro Gomes da Silva"},
    {"person_id": "d", "display_name": "Pedro Gomes", "civil_name": "Pedro Gomes Neto"},
]


def test_casa_por_nome_de_urna_ou_civil():
    assert match_names({"nome_parlamentar": "ANNE LAGARTIXA", "nome_completo": "x"}, CANDS)[:2] == ("casado", "a")
    assert match_names({"nome_parlamentar": "Brisa Bracchi", "nome_completo": "Brisa Silva Bracchi"}, CANDS)[:2] == ("casado", "b")


def test_ambiguo_e_sem_candidato_nao_casam():
    assert match_names({"nome_parlamentar": "Pedro Gomes", "nome_completo": ""}, CANDS)[:2] == ("ambiguo", None)
    assert match_names({"nome_parlamentar": "Fulano", "nome_completo": "Fulano de Tal"}, CANDS)[:2] == ("sem_candidato", None)


def test_parada_da_varredura_decrescente():
    stop = _desc_until("materia", 1000)
    assert not stop([{"materia": 1500}, {"materia": 900}])  # ainda há item no escopo na página
    assert stop([{"materia": 999}, {"materia": 10}])
    assert not stop([])


def test_vinculo_sapl_so_casado(conn):
    r = conn.execute("select count(*) as n from sapl_parlamentares where person_id is not null and match_status <> 'casado'").fetchone()
    assert r["n"] == 0
