"""Anti-SSRF da decisão (F3-T1; AC-23): o endereço que uma decisão grava em `sapl_houses.base_url` tem de ser público.

`url_publica(url)` devolve o MOTIVO da recusa, ou `None` se a URL passa: só `https`, host presente, sem usuário/senha na URL, porta 443 (ou ausente) e TODO endereço
que o nome resolve tem de ser público (`ipaddress`: nada de privado, loopback, link-local, multicast, reservado, não especificado; IPv4 mapeado em IPv6 vale pelo IPv4).

Limite declarado: a resolução é a do momento da decisão. A busca posterior do coletor resolve de novo (DNS rebinding não é coberto aqui). Sem rede nos testes: o resolvedor é injetável (parâmetro `resolver`; sem ele vale `socket.getaddrinfo`, procurado na chamada).
"""

from __future__ import annotations

import ipaddress
import re
import socket
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

Resolvedor = Callable[..., Any]


def _proibido(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # ordem: o rótulo mais específico primeiro (loopback e link-local também são `is_private` no `ipaddress`)
    for nome, ruim in (("loopback", ip.is_loopback), ("link-local", ip.is_link_local), ("multicast", ip.is_multicast), ("não especificado", ip.is_unspecified),
                       ("reservado", ip.is_reserved), ("privado", ip.is_private)):
        if ruim:
            return nome
    if not ip.is_global:  # o que sobra (ex.: 100.64.0.0/10, documentação, 64:ff9b::/96)
        return "não público"
    return None


def url_publica(url: Any, resolver: Resolvedor | None = None) -> str | None:
    """None se a URL é `https` para host público; senão o motivo (texto para o operador)."""
    if not isinstance(url, str) or not url.strip():
        return "endereço vazio"
    if url != url.strip() or any(c.isspace() or ord(c) < 32 for c in url):
        return "o endereço tem espaço ou caractere de controle"
    try:
        p = urlsplit(url)
        porta = p.port
        host = p.hostname
    except ValueError as e:
        return f"endereço inválido ({e})"
    if p.scheme.lower() != "https":
        return f"só https é aceito (veio {p.scheme or 'sem esquema'!r})"
    if not host:
        return "o endereço não tem host"
    if p.username is not None or p.password is not None or "@" in p.netloc:
        return "o endereço não pode ter usuário ou senha"
    if porta not in (None, 443):
        return f"só a porta 443 é aceita (veio {porta})"
    return motivo_host(host, resolver)


# Forma "de endereço numérico" que o `ipaddress` não aceita como IPv4 canônico: octal (0177.0.0.1), hex (0x7f.1), inteiro (2130706433), abreviada (127.1).
# O resolvedor do sistema (inet_aton/glibc) as interpreta como IPv4 e o `ipaddress` não: recusa-se aqui em vez de deixar o resolvedor decidir (A12).
_PARECE_NUMERICO = re.compile(r"(?:0[xX][0-9a-fA-F]*|[0-9]+)(?:\.(?:0[xX][0-9a-fA-F]*|[0-9]+))*")


def motivo_host(host: str, resolver: Resolvedor | None = None, *, nao_resolve_ok: bool = False) -> str | None:
    """None se o host é um IP público ou um nome cujos endereços resolvidos são todos públicos; senão o motivo. Sem checar esquema nem porta.

    `nao_resolve_ok`: nome que não resolve devolve None (quem conecta falha sozinho com o próprio erro de rede); a decisão (`url_publica`) o recusa."""
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        motivo = _proibido(literal)
        return f"o endereço {literal} é {motivo}: só IP público" if motivo else None
    if _PARECE_NUMERICO.fullmatch(host):
        return f"o host {host} parece endereço numérico fora da forma canônica de quatro octetos decimais"
    try:
        infos = (resolver or socket.getaddrinfo)(host, 443, type=socket.SOCK_STREAM)  # procurado na chamada: o teste pode trocar `socket.getaddrinfo`
    except (OSError, UnicodeError) as e:
        return None if nao_resolve_ok else f"o host {host} não resolve ({e})"
    return motivo_enderecos(host, infos)


def motivo_enderecos(host: str, infos: Any) -> str | None:
    """None se TODOS os endereços de `infos` (formato do `getaddrinfo`) são públicos; senão o motivo. Separada para quem confere e conecta no mesmo resultado (sem 2ª resolução)."""
    ips = []
    for info in infos:
        try:
            ips.append(ipaddress.ip_address(str(info[4][0]).split("%")[0]))
        except (ValueError, IndexError, TypeError):
            return f"o host {host} resolveu para um endereço ilegível"
    if not ips:
        return f"o host {host} não resolve para nenhum endereço"
    for ip in ips:
        motivo = _proibido(ip)
        if motivo:
            # IPv4 mapeado em IPv6: o Python 3.12 escreve `::ffff:a00:1` e o 3.13+ `::ffff:10.0.0.1`; a mensagem usa sempre a forma com pontos (a que se lê e a que o teste confere)
            mapeado = getattr(ip, "ipv4_mapped", None)
            texto = f"::ffff:{mapeado}" if mapeado is not None else str(ip)
            return f"o host {host} resolve para {texto}, que é {motivo}: só IP público"
    return None
