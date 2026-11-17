"""F3-T1: `rede_segura.url_publica` (anti-SSRF da decisão que grava `base_url`; AC-23). Função pura: o resolvedor é injetado, nenhum teste toca a rede."""

from __future__ import annotations

import socket

import pytest

from civico_etl.admin.rede_segura import url_publica


def dns(**tabela: list[str]):
    """Resolvedor falso: `nome=['ip', ...]` (o ponto do nome vira `_` no argumento). Nome ausente: falha como o DNS."""
    def resolver(host, porta=None, *a, **k):
        chave = host.replace(".", "_").replace("-", "__")
        if chave not in tabela:
            raise socket.gaierror(-2, "Name or service not known")
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in tabela[chave]]
    return resolver


def sem_dns(host, *a, **k):
    raise AssertionError(f"não devia resolver {host}")


PUBLICO = dns(sapl_camara_example=["93.184.216.34"], v6_example=["2606:2800:220:1:248:1893:25c8:1946"])


@pytest.mark.parametrize("url", [
    "https://sapl.camara.example", "https://sapl.camara.example/", "https://sapl.camara.example:443/api/", "https://SAPL.camara.example/x?y=1#z", "https://v6.example/",
])
def test_https_publico_passa(url):
    assert url_publica(url, PUBLICO) is None


@pytest.mark.parametrize("url,trecho", [
    ("http://sapl.camara.example/", "https"),
    ("ftp://sapl.camara.example/", "https"),
    ("//sapl.camara.example/", "https"),
    ("sapl.camara.example", "https"),
    ("https://", "host"),
    ("https:///x", "host"),
    ("https://usuario@sapl.camara.example/", "usuário"),
    ("https://usuario:senha@sapl.camara.example/", "usuário"),
    ("https://:senha@sapl.camara.example/", "usuário"),
    ("https://sapl.camara.example:8443/", "443"),
    ("https://sapl.camara.example:80/", "443"),
    ("https://sapl.camara.example:99999/", "inválido"),
    ("https://sapl.camara.example /", "espaço"),
    (" https://sapl.camara.example/", "espaço"),
    ("", "vazio"),
    ("   ", "vazio"),
])
def test_recusa_por_forma(url, trecho):
    motivo = url_publica(url, sem_dns)  # recusa antes de resolver
    assert motivo and trecho in motivo, motivo


@pytest.mark.parametrize("valor", [None, 5, ["https://x"], {"a": 1}])
def test_valor_que_nao_e_texto_e_recusado(valor):
    assert url_publica(valor, sem_dns)


@pytest.mark.parametrize("url,rotulo", [
    ("https://127.0.0.1/", "loopback"),
    ("https://127.1.2.3/", "loopback"),
    ("https://10.0.0.5/", "privado"),
    ("https://172.16.0.1/", "privado"),
    ("https://192.168.1.1/", "privado"),
    ("https://169.254.169.254/latest/meta-data/", "link-local"),
    ("https://0.0.0.0/", "não especificado"),
    ("https://224.0.0.1/", "multicast"),
    ("https://240.0.0.1/", "reservado"),
    ("https://100.64.0.1/", "não público"),
    ("https://[::1]/", "loopback"),
    ("https://[::]/", "não especificado"),
    ("https://[fe80::1]/", "link-local"),
    ("https://[fc00::1]/", "privado"),
    ("https://[ff02::1]/", "multicast"),
    ("https://[::ffff:10.0.0.1]/", "privado"),
    ("https://[::ffff:127.0.0.1]/", "loopback"),
    ("https://[::ffff:169.254.169.254]/", "link-local"),
])
def test_ip_literal_nao_publico_e_recusado_sem_resolver(url, rotulo):
    motivo = url_publica(url, sem_dns)
    assert motivo and rotulo in motivo, motivo


def test_ip_literal_publico_passa():
    assert url_publica("https://93.184.216.34/", sem_dns) is None
    assert url_publica("https://[2606:2800:220:1:248:1893:25c8:1946]/", sem_dns) is None


@pytest.mark.parametrize("ip,rotulo", [
    ("127.0.0.1", "loopback"), ("10.1.1.1", "privado"), ("169.254.169.254", "link-local"), ("::1", "loopback"), ("fe80::1", "link-local"), ("::ffff:10.0.0.1", "privado"),
])
def test_nome_que_resolve_para_endereco_nao_publico_e_recusado(ip, rotulo):
    motivo = url_publica("https://interno.example/", dns(interno_example=[ip]))
    assert motivo and rotulo in motivo and ip in motivo and "interno.example" in motivo, motivo


@pytest.mark.parametrize("ips", [["93.184.216.34", "10.0.0.1"], ["10.0.0.1", "93.184.216.34"], ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "fe80::1"]])
def test_nome_com_um_publico_e_um_privado_e_recusado(ips):
    """Todo endereço resolvido tem de ser público: um só privado basta para recusar (o cliente HTTP poderia escolher esse)."""
    assert url_publica("https://misto.example/", dns(misto_example=ips))


def test_nome_que_nao_resolve_ou_resolve_para_nada_e_recusado():
    assert "não resolve" in url_publica("https://fantasma.example/", dns())
    assert "não resolve" in url_publica("https://vazio.example/", lambda *a, **k: [])


def test_escopo_ipv6_na_resposta_do_resolvedor_nao_confunde():
    assert url_publica("https://x.example/", dns(x_example=["fe80::1%eth0"]))


def test_resolve_porta_443_e_usa_getaddrinfo_por_padrao(monkeypatch):
    vistos = []

    def falso(host, porta, *a, **k):
        vistos.append((host, porta))
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", falso)
    assert url_publica("https://sapl.camara.example/") is None and vistos == [("sapl.camara.example", 443)]
