"""HTTP com cache em disco, requisição condicional, limite de taxa e retentativa.

Só fontes oficiais. Nada aqui conhece o site original.
Cache em etl/.cache/<host>/<sha>.{body,meta.json}; ETag/Last-Modified evitam baixar de novo o que não mudou.

Três recursos opcionais de `fetch`, lidos do ambiente a cada chamada e sem efeito com a variável ausente ou vazia
(a administração de coleta os liga; sem eles o módulo se comporta como sempre):
- ETL_ATTEMPT_LOG=<arquivo>: acrescenta uma linha JSON por chamada de `fetch` (um `os.write` com O_APPEND: vale com threads e processos).
  Campos: url, ts (UTC), desfecho (cache_fresco | revalidada_304 | baixada | falha), http_status, sha256, bytes, retentativas e, em falha,
  motivo + detalhe. Motivo: bloqueio (HTTP 401/403/429/451), expiracao (timeout), sem_conteudo (2xx com corpo vazio: `fetch` devolve
  normalmente, só o log marca) ou erro (o resto, inclusive 404 e 5xx esgotado). Falha ao gravar o log nunca derruba o `fetch`.
  Ficam fora: `client()` (remotezip), `api_json` e o bloqueio por robots.txt (decidido em jobs/assembleias antes de chamar `fetch`).
- ETL_HTTP_OFFLINE=1: sem rede; serve do cache de qualquer idade. Ausente do cache: SemRedeSemCache (SystemExit, código 1), exceto
  `/robots.txt`, que levanta FileNotFoundError como um 404 real. `api_json` levanta SemRedeSemCache. `client()` não muda: remotezip ignora o modo.
- ETL_HTTP_REFETCH=<arquivo com uma URL por linha>: para essas URLs `max_age` é ignorado (vai à rede; ETag continua valendo). Offline vence.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpcore
import httpx

from . import rawstore
from .util import sha256_file, sha256_text

log = logging.getLogger("etl.http")

CACHE_DIR = Path(os.environ.get("ETL_CACHE_DIR", Path(__file__).resolve().parent.parent / ".cache"))
RATE = float(os.environ.get("ETL_RATE_LIMIT", "5"))  # req/s por host; Câmara e Senado não documentam limite
UA = "civico-etl/0.1 (+dados abertos; contato no repositorio do projeto)"
_last_call: dict[str, float] = {}


@dataclass
class Fetched:
    path: Path
    checksum: str
    from_cache: bool
    status: int

    def text(self, encoding: str = "utf-8") -> str:
        return self.path.read_text(encoding=encoding, errors="replace")

    def json(self) -> Any:
        return json.loads(self.path.read_text(encoding="utf-8"))


def _throttle(host: str) -> None:
    now = time.monotonic()
    wait = _last_call.get(host, 0) + 1.0 / RATE - now
    if wait > 0:
        time.sleep(wait)
    _last_call[host] = time.monotonic()


def _paths(url: str) -> tuple[Path, Path]:
    host = urlparse(url).netloc.replace(":", "_")
    d = CACHE_DIR / host
    d.mkdir(parents=True, exist_ok=True)
    key = sha256_text(url)[:32]
    return d / f"{key}.body", d / f"{key}.meta.json"


class DestinoInterno(Exception):
    """Anti-SSRF (A2): o destino da requisição, ou de um redirecionamento, é IP não público (ou nome que resolve para um). Não é erro de transporte:
    não é retentada (a recusa é permanente). Os coletores a tratam como qualquer falha de leitura (`except Exception`). Mensagem: o motivo."""


def _rede_segura() -> bool:
    return _env("ETL_REDE_SEGURA") != "0"  # ligada por padrão; só o valor literal "0" desliga (testes que sobem servidor local)


def _gancho_destino_publico(resolver: Any = None):
    """Gancho de requisição do httpx (`event_hooks["request"]`), chamado para CADA requisição, inclusive as de redirecionamento: recusa host IP não público
    ou nome que resolve para IP não público (regra de admin/rede_segura.py; sem exigir https: há coletores de sites http legítimos). Resolução em cache por
    host durante a vida do cliente. Nome que não resolve passa: o transporte falha sozinho com o erro de rede de sempre.
    O rebinding é fechado pelo `_BackendSeguro` (confere e conecta no mesmo resultado de DNS). Com o transporte explícito, o httpx 0.28 IGNORA HTTP(S)_PROXY do ambiente (achado N5): nenhum coletor usa proxy hoje; se um dia usar, o proxy terá de ser configurado no transporte. Fora desta checagem o comportamento é byte a byte o de antes.
    Desligável só por ETL_REDE_SEGURA=0."""
    from .admin.rede_segura import motivo_host

    cache: dict[str, str | None] = {}

    def gancho(request: httpx.Request) -> None:
        if not _rede_segura():
            return
        host = request.url.host
        if host not in cache:
            cache[host] = motivo_host(host, resolver, nao_resolve_ok=True)
        if cache[host]:
            raise DestinoInterno(f"destino recusado ({request.url.scheme}://{host}): {cache[host]}")

    return gancho


class _BackendSeguro(httpcore.NetworkBackend):
    """Confere NA CONEXÃO (fecha o DNS rebinding entre checagem e conexão): resolve o host, exige que TODOS os endereços sejam públicos (regra de
    admin/rede_segura.py) e conecta num dos endereços conferidos. TLS/SNI e cabeçalho Host seguem o nome (o httpcore os tira da origem da requisição,
    não do argumento de `connect_tcp`). Desligado por ETL_REDE_SEGURA=0 (delega direto)."""

    def __init__(self, inner: httpcore.NetworkBackend, resolver: Any = None):
        self._inner, self._resolver = inner, resolver

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if not _rede_segura():
            return self._inner.connect_tcp(host, port, timeout=timeout, local_address=local_address, socket_options=socket_options)
        from .admin.rede_segura import motivo_enderecos

        try:
            infos = (self._resolver or socket.getaddrinfo)(host, port, type=socket.SOCK_STREAM)
        except (OSError, UnicodeError) as e:
            raise httpcore.ConnectError(f"{host} não resolve ({e})") from e
        motivo = motivo_enderecos(host, infos)
        if motivo:
            raise DestinoInterno(f"destino recusado ({host}): {motivo}")
        erro: Exception | None = None
        for info in infos:
            try:
                return self._inner.connect_tcp(str(info[4][0]), port, timeout=timeout, local_address=local_address, socket_options=socket_options)
            except httpcore.ConnectError as e:
                erro = e
        raise erro or httpcore.ConnectError(f"{host}: nenhum endereço")

    def connect_unix_socket(self, path, timeout=None, socket_options=None):
        return self._inner.connect_unix_socket(path, timeout=timeout, socket_options=socket_options)

    def sleep(self, seconds):
        return self._inner.sleep(seconds)


def _transporte_seguro(resolver: Any = None) -> httpx.HTTPTransport:
    """HTTPTransport padrão com o backend de rede seguro no pool do httpcore. Usa `_pool._network_backend` (API privada do httpcore; versões travadas
    no uv.lock: httpcore 1.0.9 / httpx 0.28.1). Se o formato do pool mudar, não troca nada: fica só o gancho por requisição. Proxy do ambiente não é usado com transporte explícito (httpx 0.28)."""
    t = httpx.HTTPTransport()
    pool = getattr(t, "_pool", None)
    if type(pool) is httpcore.ConnectionPool and hasattr(pool, "_network_backend"):
        pool._network_backend = _BackendSeguro(pool._network_backend, resolver)
    else:  # pragma: no cover - só com versões novas
        log.warning("transporte seguro: pool inesperado; só o gancho por requisição vale")
    return t


def _novo_cliente(**extra: Any) -> httpx.Client:
    extra.setdefault("transport", _transporte_seguro())
    return httpx.Client(
        headers={"User-Agent": UA, "Accept": "application/json, text/csv, */*"},
        timeout=httpx.Timeout(60.0, read=600.0),
        follow_redirects=True,
        event_hooks={"request": [_gancho_destino_publico()]},
        **extra,
    )


_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = _novo_cliente()
    return _client


def _fetch(url: str, *, max_age: float | None, retries: int, accept: str | None, trace: dict[str, Any]) -> Fetched:
    body, meta = _paths(url)
    m: dict[str, Any] = json.loads(meta.read_text()) if meta.exists() and body.exists() else {}
    if m and max_age is not None and time.time() - m.get("fetched_at", 0) < max_age:
        rawstore.note(url, body, m["sha256"])
        trace["desfecho"] = "cache_fresco"
        return Fetched(body, m["sha256"], True, 304)
    headers: dict[str, str] = {}
    if accept:
        headers["Accept"] = accept
    if m.get("etag"):
        headers["If-None-Match"] = m["etag"]
    if m.get("last_modified"):
        headers["If-Modified-Since"] = m["last_modified"]
    host = urlparse(url).netloc
    delay = 2.0
    for attempt in range(retries + 1):
        trace["retentativas"] = attempt
        _throttle(host)
        try:
            with client().stream("GET", url, headers=headers) as r:
                if r.status_code == 304 and body.exists():
                    m["fetched_at"] = time.time()
                    meta.write_text(json.dumps(m))
                    rawstore.note(url, body, m["sha256"])
                    trace["desfecho"] = "revalidada_304"
                    return Fetched(body, m["sha256"], True, 304)
                if r.status_code == 404:
                    raise FileNotFoundError(url)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                tmp = body.with_suffix(".part")
                with open(tmp, "wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
                tmp.replace(body)
                sha = sha256_file(body)
                meta.write_text(
                    json.dumps(
                        {
                            "url": url,
                            "etag": r.headers.get("etag"),
                            "last_modified": r.headers.get("last-modified"),
                            "sha256": sha,
                            "fetched_at": time.time(),
                            "content_type": r.headers.get("content-type"),
                        }
                    )
                )
                rawstore.note(url, body, sha)
                trace["desfecho"] = "baixada"
                return Fetched(body, sha, False, r.status_code)
        except FileNotFoundError:
            raise
        except (httpx.HTTPStatusError, httpx.TransportError) as e:
            if attempt >= retries:
                raise
            log.warning("tentativa %d falhou em %s: %s; aguardando %.0fs", attempt + 1, url, e, delay)
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise RuntimeError("unreachable")


class SemRedeSemCache(SystemExit):
    """ETL_HTTP_OFFLINE: URL fora do cache. SystemExit (código 1) de propósito: `except Exception` dos coletores não a engole
    e `db.run` fecha o run como failed. Mensagem em args[0]."""

    def __init__(self, url: str):
        super().__init__(f"sem rede (ETL_HTTP_OFFLINE) e sem cache para {url}")
        self.code = 1
        self.url = url


_BLOQUEIO = frozenset({401, 403, 429, 451})  # a fonte recusou: não autorizado, proibido, limite de taxa, bloqueio legal
_refetch: tuple[str, frozenset[str]] | None = None
_log_avisado: set[str] = set()


def _env(nome: str) -> str:
    return (os.environ.get(nome) or "").strip()


def _offline() -> bool:
    return _env("ETL_HTTP_OFFLINE").lower() not in ("", "0", "false", "no", "off")


def _refetch_urls() -> frozenset[str]:
    """URLs de ETL_HTTP_REFETCH; o arquivo é lido uma vez por processo e relido se o caminho mudar."""
    global _refetch
    p = _env("ETL_HTTP_REFETCH")
    if not p:
        return frozenset()
    if _refetch is None or _refetch[0] != p:
        try:
            urls = frozenset(x.strip() for x in Path(p).read_text(encoding="utf-8").splitlines() if x.strip())
        except OSError as e:
            log.warning("ETL_HTTP_REFETCH ilegível (%s); nenhuma URL forçada", e)
            urls = frozenset()
        _refetch = (p, urls)
    return _refetch[1]


def _fetch_offline(url: str) -> Fetched:
    body, meta = _paths(url)
    m: dict[str, Any] = json.loads(meta.read_text()) if meta.exists() and body.exists() else {}
    if not m:
        if urlparse(url).path.endswith("/robots.txt"):
            raise FileNotFoundError(url)  # o que um 404 real levanta; _robots_rules trata como "sem robots.txt"
        raise SemRedeSemCache(url)
    rawstore.note(url, body, m["sha256"])
    return Fetched(body, m["sha256"], True, 304)


def _registrar(caminho: str, url: str, ts: str, trace: dict[str, Any], f: Fetched | None, e: BaseException | None) -> None:
    """Uma linha JSON em `caminho`. Nunca levanta."""
    try:
        rec: dict[str, Any] = {"url": url, "ts": ts, "retentativas": trace.get("retentativas", 0), "sha256": None, "bytes": None, "http_status": None}
        if trace.get("offline"):
            rec["offline"] = True
        if f is not None:
            des = trace.get("desfecho", "baixada")
            n = f.path.stat().st_size
            rec.update(desfecho=des, http_status=None if des == "cache_fresco" else f.status, bytes=n)
            if n:
                rec["sha256"] = f.checksum
            else:  # 2xx de corpo vazio: `fetch` devolve como sempre; só o registro o trata como falha
                rec.update(desfecho="falha", motivo="sem_conteudo", detalhe="corpo vazio")
        else:
            resp = getattr(e, "response", None)
            status = resp.status_code if resp is not None else (404 if isinstance(e, FileNotFoundError) and not trace.get("offline") else None)
            motivo = "expiracao" if isinstance(e, httpx.TimeoutException) else "bloqueio" if status in _BLOQUEIO else "erro"
            rec.update(desfecho="falha", http_status=status, motivo=motivo, detalhe=type(e).__name__ + (f" http_status={status}" if status is not None else ""))
        linha = (json.dumps(rec, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")
        fd = os.open(caminho, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o644)
        try:
            os.write(fd, linha)  # uma chamada só: com O_APPEND as linhas de threads e processos não se misturam
        finally:
            os.close(fd)
    except Exception as ex:  # noqa: BLE001 - o registro nunca derruba a leitura
        if caminho not in _log_avisado:
            _log_avisado.add(caminho)
            log.warning("ETL_ATTEMPT_LOG: não consegui gravar em %s (%s: %s)", caminho, type(ex).__name__, ex)


def fetch(url: str, *, max_age: float | None = None, retries: int = 4, accept: str | None = None) -> Fetched:
    """GET com cache. `max_age` em segundos: dentro dele nem consulta a rede (útil para detalhes estáveis).

    404 vira FileNotFoundError (fonte ainda não publicou). 5xx/429/timeout: retenta com backoff.
    ETL_ATTEMPT_LOG, ETL_HTTP_OFFLINE e ETL_HTTP_REFETCH: ver a docstring do módulo.
    """
    caminho = _env("ETL_ATTEMPT_LOG")
    offline = _offline()
    if max_age is not None and not offline and url in _refetch_urls():
        max_age = None
    trace: dict[str, Any] = {"offline": True} if offline else {}
    ts = datetime.now(timezone.utc).isoformat(timespec="microseconds") if caminho else ""
    try:
        f = _fetch_offline(url) if offline else _fetch(url, max_age=max_age, retries=retries, accept=accept, trace=trace)
    except (Exception, SemRedeSemCache) as e:
        if caminho:
            _registrar(caminho, url, ts, trace, None, e)
        raise
    if caminho:
        if offline:
            trace["desfecho"] = "cache_fresco"
        _registrar(caminho, url, ts, trace, f, None)
    return f


def fetch_json(url: str, **kw: Any) -> Any:
    return fetch(url, accept="application/json", **kw).json()


def paginate_camara(url: str, **kw: Any):
    """Segue links rel=next da API da Câmara, devolvendo cada item de `dados`."""
    while url:
        d = fetch_json(url, **kw)
        yield from d.get("dados", [])
        url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)


class ApiRedirectError(ValueError):
    """3xx de API com chave em header: não seguimos (o header `chave-api-dados` não pode ir a outro host). ValueError para os chamadores
    que já tratam 'resposta fora do esperado' (ex.: ping -> inconclusivo)."""


class ApiAuthError(Exception):
    """401/403 de API com chave: chave ausente, inválida ou sem permissão. Nunca é retentada (cada tentativa gasta limite)."""

    def __init__(self, status: int):
        super().__init__(f"HTTP {status}: chave recusada")
        self.status = status


def api_json(url: str, *, headers: dict[str, str], retries: int = 3, gate: Any = None, sleep: Any = time.sleep) -> Any:
    """GET JSON de API que exige chave em header (Portal da Transparência). Sem cache em disco e sem requisição condicional:
    a resposta depende da chave, e a paginação muda entre chamadas. A chave vive só em `headers`; nada aqui a loga.

    401/403 -> ApiAuthError, sem retentar. 3xx -> ApiRedirectError (follow_redirects=False), sem retentar. 404 -> FileNotFoundError. 429/5xx/rede: retenta com backoff e respeita Retry-After
    (até 120 s); esgotadas as tentativas, propaga HTTPStatusError/TransportError. `gate.wait()` (opcional) é o limite de taxa."""
    if _offline():
        raise SemRedeSemCache(url)
    delay = 5.0
    for attempt in range(retries + 1):
        if gate is not None:
            gate.wait()
        try:
            r = client().get(url, headers={**headers, "Accept": "application/json"}, follow_redirects=False)
            if 300 <= r.status_code < 400:
                dest = urlparse(r.headers.get("location") or "").netloc or "(mesmo host)"
                raise ApiRedirectError(f"{url.split('?')[0]}: HTTP {r.status_code} redireciona para {dest}; não seguimos redirect em chamada com chave")
            if r.status_code in (401, 403):
                raise ApiAuthError(r.status_code)
            if r.status_code == 404:
                raise FileNotFoundError(url)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except (ApiAuthError, ApiRedirectError, FileNotFoundError):
            raise
        except (httpx.HTTPStatusError, httpx.TransportError) as e:
            if attempt >= retries:
                raise
            wait = delay
            resp = getattr(e, "response", None)
            ra = resp.headers.get("retry-after") if resp is not None else None
            if ra and ra.strip().isdigit():
                wait = min(float(ra), 120.0)
            elif resp is not None and resp.status_code == 429:
                wait = 60.0  # limite por minuto: espera a janela virar
            log.warning("tentativa %d falhou em %s (%s); aguardando %.0fs", attempt + 1, url.split("?")[0], getattr(resp, "status_code", type(e).__name__), wait)
            sleep(wait)
            delay = min(delay * 2, 60)
    raise RuntimeError("unreachable")
