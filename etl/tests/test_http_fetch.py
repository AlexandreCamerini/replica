"""http.fetch: cache condicional, retry com backoff e 404. Sem rede: httpx.MockTransport no lugar do cliente."""

from __future__ import annotations

import httpx
import pytest

from civico_etl import http as H

URL = "https://fonte.example/dados.json"


@pytest.fixture
def net(monkeypatch, tmp_path):
    """Troca o cliente por um falso. Devolve (calls, sleeps, script): `script` é a fila de respostas ou exceções."""
    calls: list[httpx.Request] = []
    sleeps: list[float] = []
    script: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        nxt = script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    monkeypatch.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(H, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(H, "_last_call", {})
    monkeypatch.setattr(H, "RATE", 1e9)  # sem espera de rate no teste
    monkeypatch.setattr(H.time, "sleep", sleeps.append)
    return calls, sleeps, script


def test_200_grava_o_corpo_e_o_checksum(net):
    calls, sleeps, script = net
    script.append(httpx.Response(200, content=b'{"a": 1}', headers={"etag": '"v1"'}))
    f = H.fetch(URL)
    assert (f.status, f.from_cache, f.json()) == (200, False, {"a": 1})
    assert f.checksum == H.sha256_file(f.path) and len(calls) == 1 and sleeps == []


def test_5xx_retenta_com_backoff_dobrando(net):
    calls, sleeps, script = net
    script += [httpx.Response(503), httpx.Response(502), httpx.Response(200, content=b"ok")]
    f = H.fetch(URL)
    assert f.status == 200 and len(calls) == 3
    assert sleeps == [2.0, 4.0]


def test_429_e_erro_de_transporte_tambem_retentam(net):
    calls, sleeps, script = net
    script += [httpx.Response(429), httpx.ConnectError("caiu"), httpx.Response(200, content=b"ok")]
    assert H.fetch(URL).status == 200 and len(calls) == 3 and sleeps == [2.0, 4.0]


def test_5xx_persistente_esgota_as_tentativas_e_propaga(net):
    calls, sleeps, script = net
    script += [httpx.Response(504)] * 3
    with pytest.raises(httpx.HTTPStatusError):
        H.fetch(URL, retries=2)
    assert len(calls) == 3 and sleeps == [2.0, 4.0]  # retries + 1 tentativas; não dorme depois da última


def test_backoff_tem_teto_de_60s(net):
    calls, sleeps, script = net
    script += [httpx.Response(500)] * 7 + [httpx.Response(200, content=b"ok")]
    H.fetch(URL, retries=7)
    assert sleeps == [2.0, 4.0, 8.0, 16.0, 32.0, 60.0, 60.0]


def test_404_vira_file_not_found_sem_retry(net):
    calls, sleeps, script = net
    script.append(httpx.Response(404))
    with pytest.raises(FileNotFoundError):
        H.fetch(URL)
    assert len(calls) == 1 and sleeps == []


def test_erro_4xx_que_nao_e_404_nem_429_nao_e_mascarado(net):
    calls, sleeps, script = net
    script += [httpx.Response(403)] * 2
    with pytest.raises(httpx.HTTPStatusError):
        H.fetch(URL, retries=1)
    assert len(calls) == 2


def test_segunda_leitura_manda_etag_e_304_devolve_o_cache(net):
    calls, sleeps, script = net
    script += [httpx.Response(200, content=b"corpo", headers={"etag": '"v1"', "last-modified": "Mon, 09 Nov 2026 10:00:00 GMT"}), httpx.Response(304)]
    a = H.fetch(URL)
    b = H.fetch(URL)
    assert calls[1].headers["if-none-match"] == '"v1"' and calls[1].headers["if-modified-since"] == "Mon, 09 Nov 2026 10:00:00 GMT"
    assert (b.status, b.from_cache, b.checksum, b.text()) == (304, True, a.checksum, "corpo")


def test_dentro_do_max_age_nem_consulta_a_rede(net):
    calls, sleeps, script = net
    script.append(httpx.Response(200, content=b"corpo"))
    H.fetch(URL)
    f = H.fetch(URL, max_age=3600)
    assert len(calls) == 1 and f.from_cache and f.text() == "corpo"


def test_falha_no_meio_nao_troca_o_corpo_em_cache(net):
    calls, sleeps, script = net
    script += [httpx.Response(200, content=b"bom"), httpx.Response(500), httpx.Response(500)]
    a = H.fetch(URL)
    with pytest.raises(httpx.HTTPStatusError):
        H.fetch(URL, retries=1)
    assert a.path.read_bytes() == b"bom"
