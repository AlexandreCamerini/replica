"""Item 3 da W3-B: agenda/pauta de plenário (D125). Parsing puro com amostras no formato das fontes."""

from __future__ import annotations

from datetime import date, timedelta

from civico_etl.jobs.agenda_congresso import brt, camara_event, camara_items, months, senado_items, senado_session, window


def test_hora_de_brasilia():
    t = brt("2026-10-28", "14:34")
    assert t.utcoffset() == timedelta(hours=-3)
    assert (t.hour, t.minute) == (14, 34)


def test_camara_evento_e_pauta():
    e = camara_event({"id": 83108, "dataHoraInicio": "2026-10-28T14:34", "situacao": "Encerrada", "descricaoTipo": "Sessão Deliberativa",
                      "descricao": "Sessão Deliberativa Extraordinária", "localCamara": {"nome": "Plenário"}, "urlRegistro": None})
    assert e["source_key"] == "83108" and e["status"] == "Encerrada" and e["location"] == "Plenário"
    items = camara_items([
        {"ordem": 1, "topico": "Urgência", "regime": "Urgência", "titulo": "REQ 4194/2026",
         "proposicao_": {"id": 2645996, "siglaTipo": "REQ", "numero": 4194, "ano": 2026, "ementa": "Requer urgência"},
         "relator": None, "situacaoItem": "Aprovado"},
        {"ordem": 1, "titulo": "PL 5902/2023", "proposicao_": {"id": 1, "siglaTipo": "PL", "numero": "5902", "ano": "2023"}, "relator": {"nome": "Fulana"}},
    ])
    assert [i["position"] for i in items] == [1, 1001]  # "ordem" repetida não colide na chave
    assert items[0]["proposal_type"] == "REQ" and items[0]["outcome_text"] == "Aprovado"
    assert items[1]["proposal_number"] == 5902 and items[1]["rapporteur"] == "Fulana"


def test_senado_sessao_cn_e_materias():
    s = {"CodigoSessao": "590398", "Data": "2026-10-06", "Hora": "14:00", "Casa": "CN", "TipoSessao": "SESSÃO CONJUNTA ", "NumeroSessao": "12ª SESSÃO ",
         "SituacaoSessao": "Encerrada", "LocalSessao": "Plenário da Câmara",
         "Materias": {"Materia": {"CodigoMateria": "175914", "SiglaMateria": "REQ", "NumeroMateria": "00341", "AnoMateria": "2026",
                                  "DescricaoIdentificacaoMateria": "REQ 341/2026 - CDIR", "Ementa": "Requer licença.", "DescricaoTipoPauta": "Extrapauta",
                                  "Apreciacao": "Votação, em turno único", "SequenciaOrdem": "1"}}}
    ev = senado_session(s)
    assert ev["house"] == "congresso" and ev["kind"] == "SESSÃO CONJUNTA" and ev["title"] == "12ª SESSÃO"
    (it,) = senado_items(s)  # um item só vem como dict, não lista
    assert (it["proposal_type"], it["proposal_number"], it["proposal_year"]) == ("REQ", 341, 2026)
    assert it["topic"] == "Extrapauta"


def test_janela_padrao():
    ((a, b),) = window(date(2026, 11, 3), None)
    assert a == date(2026, 10, 1) and b == date(2026, 12, 31)
    assert window(date(2026, 1, 15), None) == [(date(2025, 12, 1), date(2026, 2, 28))]
    assert months(date(2025, 11, 1), date(2026, 2, 28)) == [date(2025, 11, 1), date(2025, 12, 1), date(2026, 1, 1), date(2026, 2, 1)]


def test_agenda_no_banco(conn):
    r = conn.execute("""select count(*) filter (where house = 'camara') c, count(*) filter (where house = 'senado') s,
                               (select count(*) from agenda_items) i from agenda_events""").fetchone()
    if not r["c"]:
        import pytest

        pytest.skip("agenda não carregada")
    assert r["s"] > 0 and r["i"] > 0
