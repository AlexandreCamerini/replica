"""Item 4 da W3-B: SAPL das Câmaras Municipais (D126–D129)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from civico_etl.jobs import sapl
from civico_etl.jobs.sapl import (
    _desc_until, entity_plan, is_sapl_api, load_queue, match_names, no_legislature_reason, parse_registry, pick_legislature,
    scan_desc, to_discover, updated_since, window, discover_budget, min_discarded, cap_cursor,
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


def _st(status="ok", attempt=None, checked=NOW, loaded=None):
    return {"status": status, "last_attempt_at": attempt, "checked_at": checked, "loaded_at": loaded}


def test_fila_velhas_carregadas_primeiro_depois_novas():
    d = timedelta(days=1)
    state = {
        "1": _st(loaded=NOW - 2 * d, attempt=NOW - 2 * d),   # em dia (2 dias): fora da fila
        "2": _st(attempt=None),                               # nova, nunca tentada
        "3": _st(loaded=NOW - 30 * d, attempt=NOW - 9 * d),   # velha, tentada há mais tempo
        "4": _st(status="sem_sapl_no_registro"),
        "5": _st(loaded=NOW - 20 * d, attempt=NOW - 1 * d),   # velha, mas tentada ontem (estourou tempo?): vai depois da 3
        "6": _st(attempt=NOW - 3 * d),                        # nova já tentada
    }
    assert load_queue(["1", "2", "3", "4", "5", "6", "7"], state, None, NOW) == ["3", "5", "2", "6"]
    assert load_queue(["1", "2", "3", "4", "5", "6"], state, 2, NOW) == ["3", "5"]  # orçamento curto: as novas esperam


def test_descoberta_limitada_pelo_acumulo_de_ok_sem_carga():
    state = {str(i): _st() for i in range(55)}  # 55 ok nunca carregadas
    state["x"] = _st(loaded=NOW)
    assert discover_budget(150, state, max_pending=60) == 5
    assert discover_budget(3, state, max_pending=60) == 3
    assert discover_budget(150, {str(i): _st() for i in range(70)}, max_pending=60) == 0
    assert discover_budget(150, {}, max_pending=60) == 60


def test_cursor_nao_passa_de_autoria_descartada_por_materia_nova():
    aut = [{"id": 90, "materia": 500}, {"id": 80, "materia": 1005}, {"id": 70, "materia": 10}]  # 1005 criada depois do head 1000; 10 = tipo que não carregamos
    assert min_discarded(aut, {500}, "materia", 1000) == 80
    assert min_discarded(aut, {500, 1005}, "materia", 1000) is None
    assert min_discarded(aut, {500}, "materia", None) is None
    assert cap_cursor(90, 80) == 80 and cap_cursor(90, None) == 90 and cap_cursor(None, 80) is None


def test_atualizacao_truncada_em_max_pages_avisa_e_nao_e_completa(monkeypatch, caplog):
    def fake(url, max_age=0):
        return {"results": [{"id": 1, "data_ultima_atualizacao": "2026-11-03T10:00:00-03:00"}], "pagination": {"next_page": 2}}

    monkeypatch.setattr(sapl, "_get", fake)
    with caplog.at_level("WARNING", logger="etl.sapl"):
        itens, ok = updated_since("https://x", "materia/materialegislativa", date(2026, 11, 1), max_pages=3)
    assert not ok and len(itens) == 3 and "truncadas" in caplog.text


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


# ---------------------------------------------------------------- D08 escala / D09 Assembleias (pacote C)


def _cam(status="ok", loaded=None, attempt=None, retry=None):
    return {"status": status, "loaded_at": loaded, "last_attempt_at": attempt, "retry_after": retry, "checked_at": None}


def test_backoff_dobra_e_tem_teto():
    from civico_etl.jobs.sapl import BACKOFF_BASE_H, BACKOFF_MAX_H, backoff_until

    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    assert backoff_until(1, now) == now + timedelta(hours=BACKOFF_BASE_H)
    assert backoff_until(2, now) == now + timedelta(hours=2 * BACKOFF_BASE_H)
    assert backoff_until(3, now) == now + timedelta(hours=4 * BACKOFF_BASE_H)
    assert backoff_until(30, now) == now + timedelta(hours=BACKOFF_MAX_H)
    assert backoff_until(0, now) == now + timedelta(hours=BACKOFF_BASE_H)  # nunca antes de agora


def test_fila_pula_camara_em_backoff_e_volta_quando_vence():
    now = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)
    state = {
        "1": _cam(retry=now + timedelta(hours=3)),  # nunca carregada, em backoff
        "2": _cam(),  # nunca carregada, livre
        "3": _cam(loaded=now - timedelta(days=9), retry=now + timedelta(days=1)),  # velha, em backoff
        "4": _cam(loaded=now - timedelta(days=9), retry=now - timedelta(minutes=1)),  # velha, backoff vencido
    }
    assert load_queue(list(state), state, None, now) == ["4", "2"]
    state["1"]["retry_after"] = None
    assert "1" in load_queue(list(state), state, None, now)


def test_prazo_da_camara_interrompe_a_paginacao(monkeypatch):
    import pytest

    monkeypatch.setattr(sapl, "_get", lambda *a, **k: {"results": [{"id": 1}], "pagination": {"next_page": 2}})
    sapl._local.deadline, sapl._local.limit_min = -1.0, 25  # monotonic() > -1: já estourou
    try:
        with pytest.raises(sapl.HouseTimeout):
            list(sapl.pages("https://x", "p"))
    finally:
        sapl._local.deadline = None
    assert len(list(sapl.pages("https://x", "p", max_pages=2))) == 2  # sem prazo, segue


def test_dataset_da_assembleia_nao_comeca_com_sapl_ponto():
    """A frescor da tarefa das câmaras (prefixo 'sapl.') não pode ser alimentada nem escondida pela das Assembleias."""
    ds, src, casa = sapl.house_ids({"kind": "uf", "uf": "RO"})
    assert (ds, src, casa) == ("sapl-ale.ro", "sapl-ale", "Assembleia Legislativa") and not ds.startswith("sapl.")
    assert sapl.house_ids({"kind": "municipio", "ibge_code": "1100205"}) == ("sapl.1100205", "sapl", "Câmara Municipal")


def test_ales_com_sapl_sao_as_cinco_do_catalogo():
    assert set(sapl.ALE_SAPL) == {"RO", "AC", "AM", "PI", "PB"}
    assert all(u.startswith("https://sapl.") and not u.endswith("/") for u in sapl.ALE_SAPL.values())
