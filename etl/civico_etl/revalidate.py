"""Invalida o cache de dados do site (tag `data`) depois que um job gravou dado que o eleitor vê.

Chamado por derive.stats, pauta, revisar e verificar. Falha nunca derruba o job (o dado já está gravado e o site se renova no TTL),
mas nunca é silenciosa: variável ausente, 3xx e 4xx/5xx saem como WARNING, com o motivo e o que ajustar.
"""

from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger(__name__)


def revalidar_cache(origem: str) -> bool:
    """POST na rota /api/revalidate do site. True só se o site respondeu 200. `origem` é o job, para o log."""
    url, secret = os.environ.get("REVALIDATE_URL"), os.environ.get("REVALIDATE_SECRET")
    if not url or not secret:
        faltam = [n for n, v in (("REVALIDATE_URL", url), ("REVALIDATE_SECRET", secret)) if not v]
        log.warning("revalidate (%s) PULADO: falta %s; o dado novo só aparece quando o cache do site vencer (até 24 h)", origem, ", ".join(faltam))
        return False
    try:
        # `data` é a tag de toda leitura da camada web (web/src/lib/data/index.ts); invalida tudo uma vez por run.
        # Sem seguir redirecionamento: o Bearer não pode acompanhar um 3xx para outro host.
        resp = httpx.post(url, json={"tags": ["data"]}, headers={"authorization": f"Bearer {secret}"}, timeout=30, follow_redirects=False)
    except httpx.HTTPError as e:
        log.warning("revalidate (%s) falhou (o dado novo aparece quando o cache do site vencer): %s", origem, e)
        return False
    if resp.status_code == 200:
        log.info("revalidate (%s): %s", origem, resp.text[:200])
        return True
    if 300 <= resp.status_code < 400:
        log.warning("revalidate (%s) REDIRECIONADO (%s) para %s: REVALIDATE_URL aponta para o host errado (use o host final, ex. www); o cache NÃO foi invalidado", origem, resp.status_code, resp.headers.get("location", "?"))
    else:
        log.warning("revalidate (%s) respondeu %s (o dado novo aparece quando o cache do site vencer): %s", origem, resp.status_code, resp.text[:200])
    return False
