"""HTTP com cache em disco, requisição condicional, limite de taxa e retentativa.

Só fontes oficiais. Nada aqui conhece o site original.
Cache em etl/.cache/<host>/<sha>.{body,meta.json}; ETag/Last-Modified evitam baixar de novo o que não mudou.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

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


_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            headers={"User-Agent": UA, "Accept": "application/json, text/csv, */*"},
            timeout=httpx.Timeout(60.0, read=600.0),
            follow_redirects=True,
        )
    return _client


def fetch(url: str, *, max_age: float | None = None, retries: int = 4, accept: str | None = None) -> Fetched:
    """GET com cache. `max_age` em segundos: dentro dele nem consulta a rede (útil para detalhes estáveis).

    404 vira FileNotFoundError (fonte ainda não publicou). 5xx/429/timeout: retenta com backoff.
    """
    body, meta = _paths(url)
    m: dict[str, Any] = json.loads(meta.read_text()) if meta.exists() and body.exists() else {}
    if m and max_age is not None and time.time() - m.get("fetched_at", 0) < max_age:
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
        _throttle(host)
        try:
            with client().stream("GET", url, headers=headers) as r:
                if r.status_code == 304 and body.exists():
                    m["fetched_at"] = time.time()
                    meta.write_text(json.dumps(m))
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


def fetch_json(url: str, **kw: Any) -> Any:
    return fetch(url, accept="application/json", **kw).json()


def paginate_camara(url: str, **kw: Any):
    """Segue links rel=next da API da Câmara, devolvendo cada item de `dados`."""
    while url:
        d = fetch_json(url, **kw)
        yield from d.get("dados", [])
        url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None)
