"""Funções puras do job pauta. Rodar: uv run --with pytest pytest tests/"""

from civico_etl.jobs.pauta import parse_senado_name, resolve_camara_item


def test_parecer_sobe_para_a_proposicao_relacionada():
    it = {"proposicao_": {"siglaTipo": "PRL", "id": 1}, "proposicaoRelacionada_": {"siglaTipo": "PL", "id": 2, "numero": 195, "ano": 2024}}
    assert resolve_camara_item(it)["id"] == 2


def test_lei_direto_na_pauta():
    it = {"proposicao_": {"siglaTipo": "PLP", "id": 3}, "proposicaoRelacionada_": None}
    assert resolve_camara_item(it)["id"] == 3


def test_requerimento_sem_lei_relacionada_fica_de_fora():
    it = {"proposicao_": {"siglaTipo": "REQ", "id": 4}, "proposicaoRelacionada_": {"siglaTipo": "REQ", "id": 5}}
    assert resolve_camara_item(it) is None


def test_nome_do_item_no_senado():
    assert parse_senado_name("6 - PL 5861/2025") == ("PL", 5861, 2025)
    assert parse_senado_name("PEC 18/2025") == ("PEC", 18, 2025)


def test_senado_ignora_o_que_nao_e_lei():
    assert parse_senado_name("14 - REQ 133/2026 - CDH") is None
    assert parse_senado_name("1 - PFS 2/2026") is None
    assert parse_senado_name(None) is None


def test_situacao_oficial_vira_estado_do_evento():
    from civico_etl.jobs.pauta import event_state
    assert event_state("Convocada") == "marcada"
    assert event_state("Agendada") == "marcada"
    assert event_state(None) == "marcada"
    assert event_state("Em Andamento") == "em_andamento"
    assert event_state("Suspensa") == "em_andamento"
    assert event_state("Encerrada (Final)") == "encerrada"
    assert event_state("Realizada") == "encerrada"
    assert event_state("Cancelada") == "cancelada"
