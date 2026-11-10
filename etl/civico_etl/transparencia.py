"""Portal da Transparência (CGU), API de dados com chave: cliente comum, ping e jobs `transparencia.*` (catálogo D01 e D02).

  civico-etl transparencia.ping                      GET leve com o header `chave-api-dados`. exit 0 = chave aceita (HTTP 200);
                                                     1 = chave recusada (401/403); 2 = sem chave; 3 = inconclusivo (rede, 429, 5xx)
  civico-etl transparencia.emendas [--year 2024]     emendas parlamentares por ano (2023+), ver jobs/transparencia_emendas.py

Chave: variável TRANSPARENCIA_API_KEY (Actions e shell) ou, no Mac, o arquivo `~/.config/civico-etl/transparencia-key`
(uma linha, permissão 600, fora do repositório; etl/deploy/transparencia-key.sh grava os dois). A chave só trafega em header:
nunca em URL, log, cache em disco ou mensagem de erro.

Limite de taxa: a API limita por minuto, com teto maior de 00h às 06h (Brasília). Os números abaixo são conservadores e NÃO estão
no OpenAPI; ajuste por TRANSPARENCIA_RATE_DAY / TRANSPARENCIA_RATE_NIGHT (req/min) se a CGU publicar outro valor.
"""

from __future__ import annotations

import logging
import os
import stat
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlencode

import httpx

from . import http as H
from .util import BRT

log = logging.getLogger("etl.transparencia")

API = "https://api.portaldatransparencia.gov.br/api-de-dados"
HEADER = "chave-api-dados"
ENV_KEY = "TRANSPARENCIA_API_KEY"
KEY_FILE = Path(os.environ.get("TRANSPARENCIA_KEY_FILE", Path.home() / ".config" / "civico-etl" / "transparencia-key"))
RATE_DAY = float(os.environ.get("TRANSPARENCIA_RATE_DAY", "70"))  # req/min, 06h–24h de Brasília (suposição, abaixo do teto da CGU)
RATE_NIGHT = float(os.environ.get("TRANSPARENCIA_RATE_NIGHT", "200"))  # req/min, 00h–06h
MAX_PAGES = 20000  # trava contra paginação que nunca termina


class NoKey(Exception):
    """Sem chave configurada (exit 2)."""


def rate_per_min(now: datetime | None = None) -> float:
    h = (now or datetime.now(timezone.utc)).astimezone(BRT).hour
    return RATE_NIGHT if h < 6 else RATE_DAY


class Gate:
    """Espaça as chamadas conforme o limite por minuto da hora corrente. Relógio e sleep injetáveis (teste)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep, now: Callable[[], datetime] | None = None):
        self.clock, self.sleep, self.now, self._last = clock, sleep, now or (lambda: datetime.now(timezone.utc)), None

    def wait(self) -> None:
        gap = 60.0 / rate_per_min(self.now())
        t = self.clock()
        if self._last is not None and t - self._last < gap:
            self.sleep(gap - (t - self._last))
            t = self.clock()
        self._last = t


def api_key() -> str:
    key = (os.environ.get(ENV_KEY) or "").strip()
    if key:
        return key
    try:
        if KEY_FILE.exists():
            mode = stat.S_IMODE(KEY_FILE.stat().st_mode)
            if mode & 0o077:
                raise NoKey(f"{KEY_FILE} está legível por outros usuários (modo {mode:o}); rode: chmod 600 {KEY_FILE}")
            key = KEY_FILE.read_text().strip()
            if key:
                return key
    except OSError:
        pass
    raise NoKey(f"sem chave: defina {ENV_KEY} ou rode etl/deploy/transparencia-key.sh (cadastro gov.br em portaldatransparencia.gov.br/api-de-dados/cadastrar-email)")


def get_json(path: str, params: dict[str, Any], *, key: str | None = None, gate: Gate | None = None, retries: int = 3) -> Any:
    qs = urlencode({k: v for k, v in params.items() if v is not None})
    return H.api_json(f"{API}/{path}?{qs}", headers={HEADER: key or api_key()}, retries=retries, gate=gate)


@dataclass
class PageRead:
    """Estado de uma leitura paginada, preenchido por `iter_pages` enquanto o chamador consome. `truncated` = a leitura pode ter parado
    cedo demais (página vazia onde a fonte ainda deveria ter dados): quem chama NÃO pode remover nada com base nela."""

    pages: int = 0
    truncated: bool = False
    note: str | None = None


def iter_pages(path: str, params: dict[str, Any], *, key: str | None = None, gate: Gate | None = None, state: PageRead | None = None) -> Iterator[list[dict[str, Any]]]:
    """Páginas (`pagina=1..N`) até a primeira vazia. Erro no meio propaga: quem chama não grava nada de uma leitura incompleta.
    Página idêntica à anterior (API ignorando `pagina`) também encerra com erro, em vez de repetir para sempre.

    A API não informa total nem última página. Fim legítimo = página vazia depois de uma página INCOMPLETA (menor que a maior vista).
    Vazia na página 1 ou depois de uma página CHEIA é suspeita (falha transitória devolvendo [] com 200): relê a mesma página uma vez;
    se persistir vazia, encerra e marca `state.truncated` (a leitura vale para gravar, não para remover). Limite: uma lista cujo
    tamanho é exatamente múltiplo da página, ou de uma única página, também sai marcada; o custo é só não remover, nunca apagar a mais."""
    state = state if state is not None else PageRead()
    prev: list[dict[str, Any]] | None = None
    widest = 0

    def fetch(page: int) -> list[dict[str, Any]]:
        items = get_json(path, {**params, "pagina": page}, key=key, gate=gate)
        if not isinstance(items, list):
            raise RuntimeError(f"{path} página {page}: resposta não é lista ({type(items).__name__})")
        return items

    for page in range(1, MAX_PAGES + 1):
        items = fetch(page)
        if not items and (prev is None or len(prev) >= widest):
            log.warning("%s página %d vazia depois de %s; relendo uma vez", path, page, "nenhuma página" if prev is None else "página cheia")
            items = fetch(page)
            if not items:
                state.truncated = True
                state.note = f"{path}: página {page} vazia (relida) {'sem nenhuma página antes' if prev is None else 'logo após uma página cheia'}; leitura possivelmente truncada"
                return
        if not items:
            return
        if items == prev:
            raise RuntimeError(f"{path} página {page}: igual à anterior (a API ignorou `pagina`); abortando em vez de repetir")
        prev, widest = items, max(widest, len(items))
        state.pages = page
        yield items
    raise RuntimeError(f"{path}: mais de {MAX_PAGES} páginas; abortando")


def ping(key: str | None = None, *, year: int = 2023) -> tuple[int, str]:
    """(exit, mensagem). Uma página de emendas de um ano: resposta pequena, endpoint já usado pelo job."""
    try:
        key = key or api_key()
    except NoKey as e:
        return 2, str(e)
    try:
        get_json("emendas", {"ano": year, "pagina": 1}, key=key, retries=0)
    except H.ApiAuthError as e:
        return 1, f"chave recusada pela API (HTTP {e.status}): confira se foi copiada inteira e se o cadastro foi confirmado por e-mail"
    except (httpx.HTTPError, FileNotFoundError, ValueError) as e:
        return 3, f"inconclusivo ({type(e).__name__}): a API não respondeu como esperado; tente de novo mais tarde"
    return 0, "ok: a API aceitou a chave (HTTP 200)"


def main(argv: list[str]) -> int:
    import argparse

    p = argparse.ArgumentParser(prog="civico-etl transparencia.*")
    p.add_argument("job", choices=["transparencia.ping", "transparencia.emendas"])
    p.add_argument("--year", type=int, action="append", help="emendas: ano (repetível; padrão 2023 até o corrente)")
    p.add_argument("--force", action="store_true")
    a = p.parse_args(argv)
    if a.job == "transparencia.ping":
        code, msg = ping()
        print(msg, file=sys.stderr if code else sys.stdout)
        return code
    from . import db
    from .jobs.transparencia_emendas import run_emendas

    try:
        key = api_key()
    except NoKey as e:
        print(str(e), file=sys.stderr)
        return 2
    conn = db.connect()
    try:
        run_emendas(conn, years=a.year, key=key, force=a.force)
    except H.ApiAuthError as e:
        print(f"chave recusada pela API (HTTP {e.status}); rode transparencia.ping", file=sys.stderr)
        return 1
    except db.SkipUnchanged:
        pass
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
