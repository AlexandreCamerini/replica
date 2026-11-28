"""revalidar_cache: A1/M1 da auditoria de 11/2026. Nunca derruba o job, nunca é silencioso, nunca segue 3xx com o Bearer."""

from __future__ import annotations

import logging

import httpx
import pytest

from civico_etl import revalidate


def _resp(status: int, text: str = "", headers: dict | None = None) -> httpx.Response:
    return httpx.Response(status, text=text, headers=headers or {}, request=httpx.Request("POST", "https://www.exemplo.test/api/revalidate"))


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("REVALIDATE_URL", "https://www.exemplo.test/api/revalidate")
    monkeypatch.setenv("REVALIDATE_SECRET", "segredo-de-teste")


def test_200_invalida_a_tag_data_com_bearer_e_sem_seguir_redirecionamento(env, monkeypatch):
    visto = {}

    def post(url, json, headers, timeout, follow_redirects):
        visto.update(url=url, json=json, auth=headers["authorization"], follow=follow_redirects)
        return _resp(200, '{"revalidated":1}')

    monkeypatch.setattr(revalidate.httpx, "post", post)
    assert revalidate.revalidar_cache("pauta") is True
    assert visto == {"url": "https://www.exemplo.test/api/revalidate", "json": {"tags": ["data"]}, "auth": "Bearer segredo-de-teste", "follow": False}


@pytest.mark.parametrize("faltando", ["REVALIDATE_URL", "REVALIDATE_SECRET"])
def test_variavel_ausente_nao_chama_a_rede_e_avisa_qual_falta(faltando, env, monkeypatch, caplog):
    monkeypatch.delenv(faltando)
    monkeypatch.setattr(revalidate.httpx, "post", lambda *a, **k: pytest.fail("não podia chamar a rede"))
    with caplog.at_level(logging.WARNING, logger="civico_etl.revalidate"):
        assert revalidate.revalidar_cache("verificar") is False
    assert faltando in caplog.text and "PULADO" in caplog.text and "verificar" in caplog.text


def test_redirecionamento_308_vira_aviso_com_o_destino_e_nao_e_seguido(env, monkeypatch, caplog):
    monkeypatch.setattr(revalidate.httpx, "post", lambda *a, **k: _resp(308, headers={"location": "https://www.outro.test/api/revalidate"}))
    with caplog.at_level(logging.WARNING, logger="civico_etl.revalidate"):
        assert revalidate.revalidar_cache("pauta") is False
    assert "REDIRECIONADO" in caplog.text and "https://www.outro.test/api/revalidate" in caplog.text and "NÃO foi invalidado" in caplog.text


@pytest.mark.parametrize("status", [401, 500])
def test_erro_http_avisa_com_o_status_e_devolve_false(status, env, monkeypatch, caplog):
    monkeypatch.setattr(revalidate.httpx, "post", lambda *a, **k: _resp(status, "não autorizado"))
    with caplog.at_level(logging.WARNING, logger="civico_etl.revalidate"):
        assert revalidate.revalidar_cache("revisar") is False
    assert str(status) in caplog.text


def test_falha_de_rede_nao_levanta(env, monkeypatch, caplog):
    def post(*a, **k):
        raise httpx.ConnectError("sem rota")

    monkeypatch.setattr(revalidate.httpx, "post", post)
    with caplog.at_level(logging.WARNING, logger="civico_etl.revalidate"):
        assert revalidate.revalidar_cache("derive.stats") is False
    assert "falhou" in caplog.text
