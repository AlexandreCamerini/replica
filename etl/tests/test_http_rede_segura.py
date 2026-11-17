"""F3-C2 (A2, A12): anti-SSRF do cliente HTTP dos coletores (`civico_etl.http`): gancho por requisição (inclui redirecionamentos) e backend de conexão. Sem rede:
`httpx.MockTransport`, DNS injetado por `socket.getaddrinfo` falso."""

from __future__ import annotations

import socket

import httpcore
import httpx
import pytest

from civico_etl import http as H
from civico_etl.admin.rede_segura import url_publica

PUBLICO = "93.184.216.34"


@pytest.fixture(autouse=True)
def dns(monkeypatch):
    monkeypatch.delenv("ETL_REDE_SEGURA", raising=False)
    tabela: dict[str, list[str]] = {"publico.example": [PUBLICO], "publico2.example": ["93.184.216.35"], "interno.example": ["10.0.0.7"], "misto.example": [PUBLICO, "127.0.0.1"]}

    def falso(host, *a, **k):
        if host not in tabela:
            raise socket.gaierror(-2, "Name or service not known")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in tabela[host]]

    monkeypatch.setattr(socket, "getaddrinfo", falso)
    return tabela


def cliente(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True, event_hooks={"request": [H._gancho_destino_publico()]})


def redireciona(destino: str):
    vistos: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        vistos.append(str(req.url))
        if req.url.host == "publico.example":
            return httpx.Response(302, headers={"location": destino})
        return httpx.Response(200, json={"vazou": True})

    return handler, vistos


@pytest.mark.parametrize("destino", ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:5432/", "http://[::1]/", "http://interno.example/", "https://misto.example/", "http://localhost.invalid/"])
def test_redirecionamento_para_destino_interno_e_recusado(destino, dns):
    dns["localhost.invalid"] = ["127.0.0.1"]
    handler, vistos = redireciona(destino)
    with pytest.raises(H.DestinoInterno):
        cliente(handler).get("https://publico.example/api/")
    assert vistos == ["https://publico.example/api/"]  # o destino interno nunca chegou ao transporte


def test_redirecionamento_publico_para_publico_e_aceito():
    handler, vistos = redireciona("https://publico2.example/ok")
    r = cliente(handler).get("https://publico.example/api/")
    assert r.json() == {"vazou": True} and vistos == ["https://publico.example/api/", "https://publico2.example/ok"]


def test_http_simples_para_host_publico_continua_valendo():
    assert cliente(lambda req: httpx.Response(200)).get("http://publico.example/").status_code == 200


def test_ip_literal_interno_na_primeira_requisicao_e_recusado():
    with pytest.raises(H.DestinoInterno, match="loopback"):
        cliente(lambda req: httpx.Response(200)).get("http://127.0.0.1/")


def test_nome_que_nao_resolve_passa_o_erro_e_do_transporte():
    assert cliente(lambda req: httpx.Response(200)).get("https://nao-resolve.example/").status_code == 200


def test_resolucao_e_cacheada_por_host_na_vida_do_cliente(monkeypatch):
    n = []
    real = socket.getaddrinfo

    def conta(host, *a, **k):
        n.append(host)
        return real(host, *a, **k)

    monkeypatch.setattr(socket, "getaddrinfo", conta)
    c = cliente(lambda req: httpx.Response(200))
    for _ in range(3):
        c.get("https://publico.example/x")
    assert n == ["publico.example"]


def test_desligavel_so_por_etl_rede_segura_zero(monkeypatch):
    handler, vistos = redireciona("http://127.0.0.1/")
    monkeypatch.setenv("ETL_REDE_SEGURA", "0")
    assert cliente(handler).get("https://publico.example/api/").json() == {"vazou": True}
    for valor in ("", "false", "off", "1"):  # só o literal "0" desliga
        monkeypatch.setenv("ETL_REDE_SEGURA", valor)
        with pytest.raises(H.DestinoInterno):
            cliente(handler).get("https://publico.example/api/")


def test_destino_interno_nao_e_erro_de_transporte_nem_e_retentado(monkeypatch, tmp_path):
    handler, vistos = redireciona("http://127.0.0.1/")
    dormiu: list[float] = []
    monkeypatch.setattr(H, "_client", cliente(handler))
    monkeypatch.setattr(H, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(H, "_last_call", {})
    monkeypatch.setattr(H, "RATE", 1e9)
    monkeypatch.setattr(H.time, "sleep", dormiu.append)
    assert not issubclass(H.DestinoInterno, (httpx.TransportError, httpx.HTTPStatusError))
    with pytest.raises(H.DestinoInterno):
        H.fetch_json("https://publico.example/api/")
    assert dormiu == [] and len(vistos) == 1


def test_coletor_sapl_recebe_a_recusa_como_falha_de_leitura(monkeypatch, tmp_path):
    from civico_etl.jobs import assembleias, sapl

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"}) if req.url.host == "publico.example" else httpx.Response(200, json={})

    monkeypatch.setattr(H, "_client", cliente(handler))
    monkeypatch.setattr(H, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(H, "_last_call", {})
    monkeypatch.setattr(H, "RATE", 1e9)
    monkeypatch.setattr(assembleias, "_robots", {})
    # o `discover` e o `_load_one` tratam `except Exception` como "fora_do_ar"/falha da casa: aqui, a mesma exceção que eles capturam
    with pytest.raises(Exception) as ei:
        sapl._get("https://publico.example/api/")
    assert isinstance(ei.value, H.DestinoInterno) and "link-local" in str(ei.value)
    assert not isinstance(ei.value, (SystemExit, KeyboardInterrupt))


# ---- backend de conexão (fecha o rebinding entre a checagem e a conexão)


class Interno(httpcore.NetworkBackend):
    def __init__(self):
        self.conexoes: list[tuple[str, int]] = []

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.conexoes.append((host, port))
        return "stream"

    def connect_unix_socket(self, path, timeout=None, socket_options=None):
        return "unix"

    def sleep(self, seconds):
        pass


def test_backend_conecta_no_ip_conferido_e_nao_resolve_de_novo(monkeypatch):
    chamadas = []

    def resolver(host, port, **k):
        chamadas.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLICO, port))]

    i = Interno()
    assert H._BackendSeguro(i, resolver).connect_tcp("publico.example", 443) == "stream"
    assert i.conexoes == [(PUBLICO, 443)] and chamadas == ["publico.example"]


def test_backend_recusa_se_algum_ip_resolvido_e_interno():
    def resolver(host, port, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (PUBLICO, port)), (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", port))]

    i = Interno()
    with pytest.raises(H.DestinoInterno, match="link-local"):
        H._BackendSeguro(i, resolver).connect_tcp("rebind.example", 443)
    assert i.conexoes == []


def test_backend_nome_que_nao_resolve_vira_connect_error_e_desligado_delega(monkeypatch):
    def resolver(host, port, **k):
        raise socket.gaierror(-2, "x")

    i = Interno()
    with pytest.raises(httpcore.ConnectError):
        H._BackendSeguro(i, resolver).connect_tcp("x.example", 443)
    monkeypatch.setenv("ETL_REDE_SEGURA", "0")
    assert H._BackendSeguro(i, resolver).connect_tcp("127.0.0.1", 80) == "stream" and i.conexoes == [("127.0.0.1", 80)]


def test_o_cliente_real_do_modulo_traz_gancho_e_backend(monkeypatch):
    import ssl

    import httpx._transports.default as dflt

    monkeypatch.setattr(dflt, "create_ssl_context", lambda *a, **k: ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT))  # o sandbox não deixa ler o bundle de CAs
    monkeypatch.setattr(H, "_client", None)
    c = H.client()
    try:
        assert c.event_hooks["request"] and isinstance(c._transport._pool._network_backend, H._BackendSeguro)
        with pytest.raises(H.DestinoInterno):
            c.get("http://127.0.0.1:9/")
    finally:
        c.close()


# ---- A12: forma numérica não canônica em `url_publica`


@pytest.mark.parametrize("host", ["0177.0.0.1", "0x7f.1", "2130706433", "127.1", "0x7f000001", "017700000001", "10.1", "0300.0250.0.1"])
def test_url_publica_recusa_host_numerico_fora_da_forma_canonica(host):
    def sem_dns(*a, **k):
        raise AssertionError("não devia resolver")

    motivo = url_publica(f"https://{host}/", sem_dns)
    assert motivo and "numérico" in motivo or "loopback" in (motivo or "") or "privado" in (motivo or ""), motivo


@pytest.mark.parametrize("host", ["0177.0.0.1", "0x7f.1", "2130706433", "127.1"])
def test_forma_numerica_recusada_ainda_que_o_resolvedor_a_aceitasse(host):
    motivo = url_publica(f"https://{host}/", lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))])
    assert motivo is not None and "numérico" in motivo


def test_nomes_com_digitos_e_ipv4_canonico_publico_continuam_passando():
    ok = lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]  # noqa: E731
    assert url_publica("https://123.example/", ok) is None and url_publica("https://sapl2.camara.example/", ok) is None
    assert url_publica("https://93.184.216.34/") is None
