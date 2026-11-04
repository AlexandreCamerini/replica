"""Item 4 da W3-B: SAPL das Câmaras Municipais (D126–D129)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from civico_etl.jobs import sapl
from civico_etl.jobs.sapl import (
    _desc_until, entity_plan, is_sapl_api, load_queue, match_names, no_legislature_reason, parse_registry, pick_legislature,
    scan_desc, to_discover, updated_since, window,
)

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


def test_cobertura_nao_diz_mais_ainda_sem_tela(monkeypatch):
    """D115: o crachá de vereador já mostra o SAPL; o texto da cobertura não pode dizer o contrário."""
    from civico_etl.jobs import sapl

    capturado = {}

    class _Conn:
        def commit(self):
            pass

    def fake_upsert(conn, table, cols, rows, conflict):
        capturado["rows"] = rows

    monkeypatch.setattr(sapl, "upsert", fake_upsert)
    sapl.set_coverage(_Conn(), {"place_id": "p", "base_url": "https://sapl.exemplo.leg.br"}, {"materias": 3, "presencas": 5, "votos": 7})
    textos = {r[1]: r[3] for r in capturado["rows"]}
    assert set(textos) == {"propostas", "presenca", "votos"}
    for t in textos.values():
        assert "ainda sem tela" not in t
        assert "crachá de vereador" in t


# ------------------------------------------------------------------ incremental (W3-B)

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def _cur(**kw):
    base = {"last_id": 5000, "last_updated": NOW - timedelta(days=1), "legislature_number": 20, "full_at": NOW - timedelta(days=3)}
    return {**base, **kw}


def test_cursor_incremental_com_margem():
    p = entity_plan(_cur(), 20, NOW, full=False, margin=300)
    assert (p.mode, p.floor) == ("incremental", 4700)
    assert p.since == (NOW - timedelta(days=1)).date() - timedelta(days=2)
    assert entity_plan(_cur(last_id=100), 20, NOW, full=False, margin=300).floor == 0  # nunca negativo


def test_cursor_vira_carga_completa():
    assert entity_plan(None, 20, NOW, full=False, margin=300).mode == "full"
    assert entity_plan(_cur(), 20, NOW, full=True, margin=300).why == "--full"
    assert entity_plan(_cur(legislature_number=19), 20, NOW, full=False, margin=300).why == "legislatura mudou"
    assert entity_plan(_cur(full_at=NOW - timedelta(days=31)), 20, NOW, full=False, margin=300).mode == "full"


def _fake_get(monkeypatch, tabela, chamadas):
    """tabela: ids existentes na fonte. Responde o=-id paginado como o DRF."""

    def fake(url, max_age=86400):
        from urllib.parse import parse_qs, urlparse

        q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
        chamadas.append((url, max_age))
        size, n = int(q["page_size"]), int(q["page"])
        ids = sorted(tabela, reverse=True)
        res = [{"id": i} for i in ids[(n - 1) * size : n * size]]
        return {"results": res, "pagination": {"next_page": n + 1 if n * size < len(ids) else None}}

    monkeypatch.setattr(sapl, "_get", fake)


def test_varredura_incremental_para_no_cursor_e_nao_cacheia(monkeypatch):
    ch = []
    _fake_get(monkeypatch, range(1, 1001), ch)
    itens, mx = scan_desc("https://x", "materia/autoria", 950)
    # para na primeira página inteira abaixo do piso: lê a página com 950 e mais uma (margem natural)
    assert mx == 1000 and len(ch) == 2 and len(itens) == 200
    assert all(m == 0 for _, m in ch)  # sempre revalida na rede
    ch.clear()
    itens, mx = scan_desc("https://x", "materia/autoria", 0)  # completa
    assert len(itens) == 1000 and len(ch) == 10


def test_varredura_sem_nada_novo_custa_uma_pagina(monkeypatch):
    ch = []
    _fake_get(monkeypatch, range(1, 1001), ch)
    itens, mx = scan_desc("https://x", "sessao/votoparlamentar", 1001)
    assert mx == 1000 and len(ch) == 1


def test_filtro_de_atualizacao_ignorado_pela_fonte_e_detectado(monkeypatch):
    def fake(url, max_age=0):  # ignora o filtro: devolve itens antigos
        return {"results": [{"id": 1, "data_ultima_atualizacao": "2020-01-01T00:00:00-03:00"}], "pagination": {"next_page": 2}}

    monkeypatch.setattr(sapl, "_get", fake)
    itens, ok = updated_since("https://x", "materia/materialegislativa", date(2026, 11, 1))
    assert not ok and itens == []

    def fake_ok(url, max_age=0):
        return {"results": [{"id": 2, "data_ultima_atualizacao": "2026-11-03T10:00:00-03:00"}], "pagination": {"next_page": None}}

    monkeypatch.setattr(sapl, "_get", fake_ok)
    itens, ok = updated_since("https://x", "materia/materialegislativa", date(2026, 11, 1))
    assert ok and [i["id"] for i in itens] == [2]


def _st(status="ok", attempt=None, checked=NOW):
    return {"status": status, "last_attempt_at": attempt, "checked_at": checked}


def test_fila_nunca_tentada_primeiro_depois_a_mais_antiga():
    state = {
        "1": _st(attempt=NOW - timedelta(days=1)),
        "2": _st(attempt=None),
        "3": _st(attempt=NOW - timedelta(days=9)),
        "4": _st(status="sem_sapl_no_registro"),
        "5": _st(attempt=NOW - timedelta(days=9)),
    }
    assert load_queue(["1", "2", "3", "4", "5", "6"], state, None) == ["2", "3", "5", "1"]  # 4 não é ok, 6 não descoberta
    assert load_queue(["1", "2", "3", "4", "5"], state, 2) == ["2", "3"]


def test_descoberta_so_do_que_falta_ou_esta_velho():
    state = {"1": _st(), "2": _st(status="fora_do_ar", checked=NOW - timedelta(days=8)), "3": _st(status="fora_do_ar", checked=NOW - timedelta(days=1))}
    assert to_discover(["1", "2", "3", "4", "5"], state, NOW, None) == ["2", "4", "5"]
    assert to_discover(["1", "2", "3", "4", "5"], state, NOW, 2) == ["2", "4"]


def test_janela_lote_offset():
    escopo = [str(i) for i in range(10)]
    assert window(escopo, 3, 0) == ["0", "1", "2"]
    assert window(escopo, 3, 9) == ["9"]
    assert window(escopo, None, 8) == ["8", "9"]
    assert window(escopo, 3, 20) == []


def test_sem_legislatura_vigente_e_condicao_da_fonte():
    legs = [{"numero": 17, "data_inicio": "2017-01-01", "data_fim": "2020-12-31"}, {"numero": 18, "data_inicio": "2021-01-01", "data_fim": "2024-12-31"}]
    assert pick_legislature(legs, date(2026, 11, 4)) is None
    assert pick_legislature(legs + [{"numero": 19, "data_inicio": "2025-01-01", "data_fim": "2028-12-31"}], date(2026, 11, 4))["numero"] == 19
    motivo = no_legislature_reason(legs, date(2026, 11, 4))
    assert "não tem legislatura vigente" in motivo and "18ª" in motivo and "04/11/2026" in motivo
    assert "nenhuma legislatura cadastrada" in no_legislature_reason([], date(2026, 11, 4))
