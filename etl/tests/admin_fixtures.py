"""FABRICADO. Utilitários para rodar os coletores do SAPL sobre respostas fabricadas (etl/tests/fixtures/sapl_ale/), sem rede.

- `transporte(cenario)`: `httpx.MockTransport` que serve o `mapa.json` do cenário (v1, v2, falhas). URL fora do mapa: `AssertionError` com a URL
  E registro em `transporte.nao_previstos`. ATENÇÃO: os jobs capturam `Exception` (discover_ales, discover, _load_one), então o AssertionError
  vira status `fora_do_ar`/`falhou` em vez de derrubar o job; quem testa precisa afirmar `nao_previstos == []` depois da execução.
- `instalar(monkeypatch_ou_None, cenario, cache_dir)`: instala o transporte em `civico_etl.http._client` e neutraliza espera de taxa/retentativa.
- `carregar_base(url)` / `limpar_base(url)`: aplicam/desfazem fixtures/admin_base.sql e o que os comandos SAPL gravam para esse recorte.
- `entradas(comando, cenario)`: as URLs de entrada de cada comando (as que não dependem de leitura anterior), na ordem em que o job as pede.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import quote, urlencode

import httpx

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAPL_ALE = FIXTURES / "sapl_ale"
ADMIN_BASE_SQL = FIXTURES / "admin_base.sql"
MARCA = "FABRICADO"
CENARIOS = ("v1", "v2", "falhas")

UFS = ("RO", "AC", "AM", "PI", "PB")  # a ordem de ALE_SAPL, que é a ordem em que sapl.ales sonda
IBGE_UF = {"RO": "11", "AC": "12", "AM": "13", "PI": "22", "PB": "25"}
ALE_HOSTS = {uf: f"https://sapl.al.{uf.lower()}.leg.br" for uf in UFS}  # conferidos contra jobs.sapl.ALE_SAPL no teste
IBGE_MUNICIPIO = "1190099"
UF_MUNICIPIO = "RO"
NOME_MUNICIPIO = "Município Fabricado (teste)"
HOST_MUNICIPIO = "https://sapl.camara-fabricada.invalid"  # v1 e falhas
HOST_MUNICIPIO_V2 = "https://sapl.camara-fabricada-nova.invalid"  # base_url depois da mudança do registro (v2)
REGISTRO = "https://www12.senado.leg.br/interlegis/orgaosatendidos"
URL_REGISTRO = f"{REGISTRO}?{urlencode({'uf': UF_MUNICIPIO, 'municipio': NOME_MUNICIPIO}, quote_via=quote)}"  # a mesma montagem de discover()

#: status esperado de sapl.ales na descoberta, por cenário (ver LEIA-ME.md)
STATUS_ALE = {
    "v1": {"RO": "ok", "AC": "ok", "AM": "ok", "PI": "robots_bloqueia", "PB": "fora_do_ar"},
    "v2": {"RO": "ok", "AC": "ok", "AM": "robots_bloqueia", "PI": "robots_bloqueia", "PB": "ok"},
    "falhas": {"RO": "fora_do_ar", "AC": "fora_do_ar", "AM": "fora_do_ar", "PI": "ok", "PB": "ok"},
}

_DATASETS_COBERTURA = ("propostas", "presenca", "votos")


def _n(u: str) -> str:
    return str(httpx.URL(u))


# ------------------------------------------------------------------ transporte


def transporte(cenario: str, *, estrito: bool = True) -> httpx.MockTransport:
    """Serve as respostas fabricadas de `fixtures/sapl_ale/<cenario>/mapa.json` (só GET).

    Atributos do objeto devolvido: `pedidos` (todas as URLs pedidas, em ordem, inclusive as respondidas com 304), `respostas` (url, status enviado ou nome da
    exceção), `nao_previstos` (URLs fora do mapa). ETag: se o pedido traz If-None-Match igual à ETag do mapa, responde 304 sem corpo.
    `estrito=False`: URL não prevista responde 404 em vez de levantar AssertionError."""
    pasta = SAPL_ALE / cenario
    mapa = json.loads((pasta / "mapa.json").read_text(encoding="utf-8"))
    exatas = {_n(u): e for u, e in mapa["respostas"].items()}
    curingas = [(re.compile(c["regex"]), c) for c in mapa.get("curingas", [])]
    cache_corpos: dict[str, bytes] = {}

    def corpo(e: dict[str, Any]) -> bytes:
        a = e["arquivo"]
        if a not in cache_corpos:
            cache_corpos[a] = (pasta / a).resolve().read_bytes()
        return cache_corpos[a]

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        t.pedidos.append(url)
        e = exatas.get(url)
        if e is None:
            for rx, c in curingas:
                if rx.match(url):
                    e = c
                    break
        if e is None:
            t.nao_previstos.append(url)
            t.respostas.append((url, "nao_previsto"))
            if estrito:
                raise AssertionError(f"fixture sapl_ale/{cenario}: URL não prevista (nunca vai à rede): {req.method} {url}")
            return httpx.Response(404, content=b"", headers={"content-type": "text/plain"})
        if req.method != "GET":
            raise AssertionError(f"fixture sapl_ale/{cenario}: só GET ({req.method} {url})")
        if "excecao" in e:
            t.respostas.append((url, e["excecao"]))
            raise getattr(httpx, e["excecao"])(f"{MARCA}: {e['excecao']} fabricado", request=req)
        headers = {"content-type": e.get("tipo", "application/json")}
        etag = e.get("etag")
        if etag:
            headers["etag"] = etag
            if req.headers.get("if-none-match") == etag:
                t.respostas.append((url, 304))
                return httpx.Response(304, headers={"etag": etag})
        t.respostas.append((url, e["status"]))
        return httpx.Response(e["status"], headers=headers, content=corpo(e))

    t = httpx.MockTransport(handler)
    t.cenario, t.estrito = cenario, estrito  # type: ignore[attr-defined]
    t.pedidos, t.respostas, t.nao_previstos = [], [], []  # type: ignore[attr-defined]
    return t


def instalar(monkeypatch: Any, cenario: str, cache_dir: str | Path, *, estrito: bool = True, transport: httpx.MockTransport | None = None) -> httpx.MockTransport:
    """Põe o transporte fabricado em `civico_etl.http._client`, aponta `CACHE_DIR` e tira a espera (taxa e retentativa) sem tocar na lógica.

    Com `monkeypatch` (pytest), tudo é desfeito no fim do teste. Com `None` (lançador), vale pelo resto do processo; `transporte.desfazer()` restaura.
    Importa `jobs.sapl` e `jobs.assembleias` ANTES de ajustar `H.RATE`, porque os dois reescrevem `H.RATE` no import. Zera o estado em memória que
    esconde o cenário novo (`assembleias._robots`, `H._last_call`). Remove do ambiente ETL_HTTP_OFFLINE e ETL_ATTEMPT_LOG herdados (os testes
    que querem o registro de tentativas definem a variável depois) e desliga ETL_RAW_STORE. Bloqueia qualquer outro transporte httpx real."""
    from civico_etl import http as H
    from civico_etl.jobs import assembleias, sapl  # noqa: F401  (o import reescreve H.RATE)

    t = transport or transporte(cenario, estrito=estrito)
    pasta = Path(cache_dir)
    pasta.mkdir(parents=True, exist_ok=True)
    sem_espera = SimpleNamespace(sleep=lambda s: None, monotonic=time.monotonic, time=time.time)

    def sem_rede(self, request):  # qualquer cliente httpx que não use o transporte fabricado
        raise AssertionError(f"rede bloqueada pela fixture: {request.method} {request.url}")

    trocas: list[tuple[Any, str, Any]] = [
        (H, "_client", httpx.Client(transport=t, trust_env=False)),
        (H, "CACHE_DIR", pasta),
        (H, "RATE", 1e9),
        (H, "_last_call", {}),
        (H, "time", sem_espera),  # só o módulo http: o sleep de retentativa e de taxa; `time.sleep` global fica intacto
        (assembleias, "_robots", {}),
        (httpx.HTTPTransport, "handle_request", sem_rede),
    ]
    envs = {"ETL_RAW_STORE": "off", "ETL_HTTP_OFFLINE": None, "ETL_ATTEMPT_LOG": None}
    if monkeypatch is not None:
        for obj, nome, valor in trocas:
            monkeypatch.setattr(obj, nome, valor)
        for k, v in envs.items():
            monkeypatch.delenv(k, raising=False) if v is None else monkeypatch.setenv(k, v)
        t.desfazer = lambda: None  # type: ignore[attr-defined]
    else:
        antes = [(obj, nome, getattr(obj, nome)) for obj, nome, _ in trocas]
        env_antes = {k: os.environ.get(k) for k in envs}
        for obj, nome, valor in trocas:
            setattr(obj, nome, valor)
        for k, v in envs.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

        def desfazer() -> None:
            for obj, nome, valor in antes:
                setattr(obj, nome, valor)
            for k, v in env_antes.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

        t.desfazer = desfazer  # type: ignore[attr-defined]
    return t


# ------------------------------------------------------------------ banco


def carregar_base(url_banco: str) -> None:
    """Aplica fixtures/admin_base.sql (cinco Assembleias + município fabricado com a Câmara). Idempotente."""
    import psycopg

    with psycopg.connect(url_banco, autocommit=True) as c:
        c.execute(ADMIN_BASE_SQL.read_text(encoding="utf-8"))


_LIMPEZA = """
create temp table _lugares on commit drop as
  select id from places where (kind = 'uf' and uf in ('RO', 'AC', 'AM', 'PI', 'PB')) or ibge_code = '1190099';
delete from dataset_stamps where dataset like 'sapl-ale.%' or dataset like 'sapl.%';
delete from ingest_runs where dataset like 'sapl-ale.%' or dataset like 'sapl.%';
delete from sapl_houses where place_id in (select id from _lugares);
delete from data_coverage where place_id in (select id from _lugares) and dataset in ('propostas', 'presenca', 'votos');
delete from legislative_bodies where place_id in (select id from _lugares) and kind in ('assembleia', 'camara_municipal');
delete from places where ibge_code = '1190099';
delete from sources where slug = 'sapl-ale';
"""


def limpar_base(url_banco: str) -> None:
    """Desfaz admin_base.sql e apaga o que sapl.ales/sapl.descobrir/sapl.carregar gravaram para o recorte: dataset_stamps e ingest_runs de `sapl-ale.%` e
    `sapl.%`, sapl_houses (a cascata leva sapl_parlamentares, _mandatos, _materias, _autorias, _sessoes, _presencas, _votos e sapl_cursors), data_coverage das UFs
    e do município, as casas legislativas do recorte, o município e a fonte `sapl-ale`. Numa transação; não toca em mais nada (a fonte `sapl` é do seed)."""
    import psycopg

    with psycopg.connect(url_banco) as c:
        c.execute(_LIMPEZA)
        c.commit()


# ------------------------------------------------------------------ entradas por comando


def _ales(cenario: str) -> list[str]:
    out: list[str] = []
    for uf in UFS:
        h = ALE_HOSTS[uf]
        out.append(f"{h}/robots.txt")
        if STATUS_ALE[cenario][uf] != "robots_bloqueia":
            out.append(f"{h}/api/")
    return out


def entradas(comando: str, cenario: str) -> list[str]:
    """URLs de entrada do comando no cenário, na ordem de primeiro pedido (retentativas e cache fora). Não dependem de leitura anterior, exceto
    `sapl.carregar`, cuja base vem de sapl_houses (a que `sapl.descobrir` gravou antes). Pedem-se de um cache vazio.
    - sapl.ales: robots.txt e /api/ de cada casa (sem /api/ onde o robots bloqueia);
    - sapl.descobrir --ibge <fabricado>: a página do registro, depois robots.txt e /api/ do endereço que ela lista;
    - sapl.carregar --ibge <fabricado>: robots.txt e a primeira leitura da carga (legislatura)."""
    if comando == "sapl.ales":
        return _ales(cenario)
    host = HOST_MUNICIPIO_V2 if cenario == "v2" else HOST_MUNICIPIO
    if comando == "sapl.descobrir":
        return [URL_REGISTRO, f"{host}/robots.txt", f"{host}/api/"]
    if comando == "sapl.carregar":
        return [f"{host}/robots.txt", f"{host}/api/parlamentares/legislatura/?page_size=100&page=1"]
    raise KeyError(comando)


def sem_repeticao(urls: list[str]) -> list[str]:
    """Ordem de primeiro aparecimento (descarta as retentativas do mesmo GET)."""
    vistos: dict[str, None] = {}
    for u in urls:
        vistos.setdefault(u, None)
    return list(vistos)


Contagem = Callable[[list[tuple[str, Any]]], dict[str, int]]


def contagem(respostas: list[tuple[str, Any]]) -> dict[str, int]:
    """Quantas respostas por status (ou nome de exceção)."""
    out: dict[str, int] = {}
    for _u, s in respostas:
        out[str(s)] = out.get(str(s), 0) + 1
    return out
