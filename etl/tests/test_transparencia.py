"""catálogo D01: cliente da API do Portal da Transparência, ping, limite de taxa e paginação. Sem rede: httpx.MockTransport em H._client."""

from __future__ import annotations

import logging
import stat
from datetime import datetime, timezone

import httpx
import pytest

from civico_etl import http as H
from civico_etl import transparencia as T

KEY = "SENTINELA-chave-0123456789abcdef"


@pytest.fixture
def api(monkeypatch):
    """Instala um transporte falso; devolve (lista de requisições, define a resposta)."""
    seen: list[httpx.Request] = []
    plan: dict = {"handler": lambda req: httpx.Response(200, json=[])}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return plan["handler"](req)

    monkeypatch.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(H.time, "sleep", lambda s: None)
    monkeypatch.delenv(T.ENV_KEY, raising=False)
    monkeypatch.setattr(T, "KEY_FILE", T.Path("/nonexistent/key"))
    return seen, plan


def test_ping_ok_manda_a_chave_so_no_header(api):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(200, json=[{"codigoEmenda": "1"}])
    code, msg = T.ping(KEY)
    assert code == 0 and "200" in msg
    (req,) = seen
    assert req.headers["chave-api-dados"] == KEY
    assert KEY not in str(req.url) and "emendas" in req.url.path


@pytest.mark.parametrize("status", [401, 403])
def test_ping_chave_recusada_nao_retenta(api, status):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(status)
    code, msg = T.ping(KEY)
    assert code == 1 and "recusada" in msg
    assert len(seen) == 1  # 401/403 nunca é retentado
    assert KEY not in msg


def test_ping_sem_chave_exit_2_e_mensagem_clara(api):
    seen, _ = api
    code, msg = T.ping()
    assert code == 2 and "TRANSPARENCIA_API_KEY" in msg and "transparencia-key.sh" in msg
    assert seen == []  # nem chega a chamar a API


@pytest.mark.parametrize("status", [429, 500, 503])
def test_ping_inconclusivo_e_distinto_de_chave_ruim(api, status):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(status)
    code, _ = T.ping(KEY)
    assert code == 3


def test_ping_rede_fora_do_ar_e_inconclusivo(api):
    seen, plan = api

    def boom(req):
        raise httpx.ConnectError("sem rede")

    plan["handler"] = boom
    assert T.ping(KEY)[0] == 3


def test_api_json_429_respeita_retry_after_e_tenta_de_novo(api, monkeypatch):
    seen, plan = api
    waits: list[float] = []
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(429, headers={"retry-after": "7"}) if calls["n"] == 1 else httpx.Response(200, json=[1])

    plan["handler"] = h
    assert H.api_json("https://x.test/a", headers={"k": "v"}, retries=2, sleep=waits.append) == [1]
    assert waits == [7.0]


def test_chave_nunca_aparece_em_log(api, caplog):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(401)
    with caplog.at_level(logging.DEBUG):
        T.ping(KEY)
        plan["handler"] = lambda req: httpx.Response(503)
        T.ping(KEY)
    assert KEY not in caplog.text


def test_paginacao_ate_pagina_vazia(api):
    seen, plan = api
    pages = {"1": [{"a": 1}, {"a": 2}], "2": [{"a": 3}], "3": []}
    plan["handler"] = lambda req: httpx.Response(200, json=pages[req.url.params["pagina"]])
    got = [x for page in T.iter_pages("emendas", {"ano": 2024}, key=KEY) for x in page]
    assert [x["a"] for x in got] == [1, 2, 3]
    assert [r.url.params["pagina"] for r in seen] == ["1", "2", "3"]
    assert all(r.url.params["ano"] == "2024" for r in seen)


def test_paginacao_que_ignora_pagina_aborta(api):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(200, json=[{"a": 1}])
    with pytest.raises(RuntimeError, match="igual à anterior"):
        list(T.iter_pages("emendas", {"ano": 2024}, key=KEY))


def test_paginacao_erro_no_meio_propaga(api):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(200, json=[{"a": 1}]) if req.url.params["pagina"] == "1" else httpx.Response(401)
    it = T.iter_pages("emendas", {}, key=KEY)
    next(it)
    with pytest.raises(H.ApiAuthError):
        next(it)


def test_resposta_que_nao_e_lista_aborta(api):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(200, json={"erro": "x"})
    with pytest.raises(RuntimeError, match="não é lista"):
        list(T.iter_pages("emendas", {}, key=KEY))


def test_limite_de_taxa_diurno_e_noturno():
    dia = datetime(2026, 11, 4, 15, tzinfo=timezone.utc)  # 12h em Brasília
    noite = datetime(2026, 11, 4, 5, tzinfo=timezone.utc)  # 02h em Brasília
    assert T.rate_per_min(noite) == T.RATE_NIGHT > T.RATE_DAY == T.rate_per_min(dia)
    assert T.rate_per_min(datetime(2026, 11, 4, 8, 59, tzinfo=timezone.utc)) == T.RATE_NIGHT  # 05h59 BRT
    assert T.rate_per_min(datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)) == T.RATE_DAY  # 06h00 BRT


def test_gate_espaca_as_chamadas():
    t = {"now": 0.0}
    slept: list[float] = []

    def sleep(s):
        slept.append(s)
        t["now"] += s

    g = T.Gate(clock=lambda: t["now"], sleep=sleep, now=lambda: datetime(2026, 11, 4, 15, tzinfo=timezone.utc))
    for _ in range(3):
        g.wait()
    gap = 60.0 / T.RATE_DAY
    assert slept == [pytest.approx(gap), pytest.approx(gap)]  # a 1ª não espera


def test_chave_do_arquivo_exige_modo_600(tmp_path, monkeypatch):
    monkeypatch.delenv(T.ENV_KEY, raising=False)
    f = tmp_path / "key"
    f.write_text(KEY + "\n")
    monkeypatch.setattr(T, "KEY_FILE", f)
    f.chmod(0o644)
    with pytest.raises(T.NoKey, match="chmod 600"):
        T.api_key()
    f.chmod(0o600)
    assert T.api_key() == KEY
    assert stat.S_IMODE(f.stat().st_mode) == 0o600
    monkeypatch.setenv(T.ENV_KEY, "do-ambiente")
    assert T.api_key() == "do-ambiente"  # ambiente vence o arquivo


# ---- S2-1: página vazia não encerra em silêncio uma leitura que ainda deveria ter dados ----

def _pages_handler(plan, pages):
    """pages: pagina -> lista de respostas sucessivas (a última se repete)."""
    count: dict[str, int] = {}

    def h(req):
        p = req.url.params["pagina"]
        n = count.get(p, 0)
        count[p] = n + 1
        seq = pages[p]
        return httpx.Response(200, json=seq[min(n, len(seq) - 1)])

    plan["handler"] = h


def test_vazia_depois_de_pagina_incompleta_e_fim_legitimo_sem_reler(api):
    seen, plan = api
    _pages_handler(plan, {"1": [[{"a": 1}, {"a": 2}]], "2": [[{"a": 3}]], "3": [[]]})
    st = T.PageRead()
    assert [x["a"] for p in T.iter_pages("emendas", {}, key=KEY, state=st) for x in p] == [1, 2, 3]
    assert not st.truncated and len(seen) == 3


def test_vazia_depois_de_pagina_cheia_relê_uma_vez_e_aproveita_se_vier(api):
    seen, plan = api
    _pages_handler(plan, {"1": [[{"a": 1}, {"a": 2}]], "2": [[], [{"a": 3}, {"a": 4}]], "3": [[{"a": 5}]], "4": [[]]})
    st = T.PageRead()
    assert [x["a"] for p in T.iter_pages("emendas", {}, key=KEY, state=st) for x in p] == [1, 2, 3, 4, 5]
    assert not st.truncated and [r.url.params["pagina"] for r in seen] == ["1", "2", "2", "3", "4"]


def test_vazia_persistente_depois_de_pagina_cheia_marca_truncada(api):
    seen, plan = api
    _pages_handler(plan, {"1": [[{"a": 1}, {"a": 2}]], "2": [[]]})
    st = T.PageRead()
    assert [x["a"] for p in T.iter_pages("emendas", {}, key=KEY, state=st) for x in p] == [1, 2]
    assert st.truncated and "truncada" in st.note and [r.url.params["pagina"] for r in seen] == ["1", "2", "2"]


def test_primeira_pagina_vazia_persistente_tambem_marca_truncada(api):
    seen, plan = api
    _pages_handler(plan, {"1": [[]]})
    st = T.PageRead()
    assert list(T.iter_pages("emendas", {}, key=KEY, state=st)) == [] and st.truncated and len(seen) == 2


# ---- S4: api_json não segue redirect (a chave não pode ir a outro host) ----

def test_redirect_vira_erro_claro_e_a_chave_nao_vai_ao_destino(api):
    seen, plan = api
    plan["handler"] = lambda req: httpx.Response(302, headers={"location": "https://outro.example.com/roubo?x=1"})
    with pytest.raises(H.ApiRedirectError, match="outro.example.com"):
        T.get_json("emendas", {"ano": 2024}, key=KEY, retries=3)
    assert len(seen) == 1 and seen[0].url.host == "api.portaldatransparencia.gov.br"  # sem retentar nem seguir
    code, msg = T.ping(KEY)
    assert code == 3 and KEY not in msg
