"""Importa o registro de tentativas de `http.fetch` (ETL_ATTEMPT_LOG, JSONL) para `adm_tentativas` e `adm_evidencias`.

Transação: nenhuma função daqui chama `commit`. Quem chama decide (use conexão com autocommit desligado: com autocommit ligado
cada instrução comita sozinha e uma falha no meio deixa a importação pela metade).

Idempotência: a chave de uma tentativa é (rodada_id, url_sha, tentada_em). Importar o mesmo arquivo de novo para a mesma rodada não
insere nada (cada INSERT só entra se a chave ainda não existe, o que também elimina linha repetida dentro do arquivo). Sem constraint
nova: um advisory lock transacional por rodada serializa importadores concorrentes. A busca usa o índice adm_tentativas_url_idx.

Evidência (`adm_evidencias`, última leitura válida por URL): só tentativa `lida` ou `reaproveitada` com hash a toca; falha NUNCA.
- `lida`: lida_em = horário da tentativa (o conteúdo foi lido agora).
- `reaproveitada` (cache fresco ou 304): se a evidência existente tem o MESMO hash, mantém lida_em e rodada_id (o conteúdo não foi
  relido; a data de leitura continua sendo a da última leitura real). Se o hash difere ou não há evidência, lida_em = horário da
  tentativa: é a primeira data em que este sistema viu esse conteúdo; a data real da leitura anterior, se houve, é desconhecida.
- Importação fora de ordem não regride: evidência existente mais nova que a tentativa não é sobrescrita.
`fonte_declarada_em` não é tocada aqui.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from ..util import sha256_text

DESFECHO_PARA_RESULTADO = {"baixada": "lida", "cache_fresco": "reaproveitada", "revalidada_304": "reaproveitada", "falha": "falha"}
MOTIVOS = frozenset({"bloqueio", "robots", "expiracao", "erro", "sem_conteudo"})


@dataclass
class Resumo:
    tentadas: int = 0  # linhas válidas do arquivo (não o que foi inserido: reimportar dá o mesmo número)
    lidas: int = 0
    reaproveitadas: int = 0
    falhas: dict[str, int] = field(default_factory=dict)  # por motivo
    urls_distintas: int = 0
    linhas_ignoradas: int = 0  # JSON inválido (inclui a última linha truncada), campo obrigatório ausente ou valor fora do vocabulário


def _linha(raw: str) -> dict[str, Any] | None:
    """Tentativa normalizada ou None se a linha não presta."""
    try:
        d = json.loads(raw)
        url, resultado = d["url"], DESFECHO_PARA_RESULTADO[d["desfecho"]]
        ts = datetime.fromisoformat(d["ts"])
        if not isinstance(url, str) or not url.strip() or ts.tzinfo is None:
            return None
        motivo = d.get("motivo") if resultado == "falha" else None
        if (resultado == "falha") != (motivo in MOTIVOS):
            return None
        sha, n, st = d.get("sha256"), d.get("bytes"), d.get("http_status")
        if resultado == "falha":
            sha = None  # corpo vazio e erro não geram evidência; a coluna só carrega hash de conteúdo servido
        if sha is not None and not isinstance(sha, str):
            return None
        return {"url": url, "url_sha": sha256_text(url), "host": urlparse(url).netloc or None, "tentada_em": ts, "resultado": resultado,
                "http_status": st if isinstance(st, int) else None, "motivo": motivo, "conteudo_sha256": sha, "bytes": n if isinstance(n, int) else None}
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def _ler(caminho: Path) -> tuple[list[dict[str, Any]], int]:
    linhas: list[dict[str, Any]] = []
    ignoradas = 0
    with open(caminho, encoding="utf-8", errors="replace") as f:
        for raw in f:
            if not raw.strip():
                continue
            t = _linha(raw)
            if t is None:
                ignoradas += 1
            else:
                linhas.append(t)
    return linhas, ignoradas


_INSERT = """
insert into adm_tentativas (rodada_id, url, url_sha, host, tentada_em, resultado, http_status, motivo, conteudo_sha256, bytes, entrada)
select %(rodada)s, %(url)s, %(url_sha)s, %(host)s, %(tentada_em)s, %(resultado)s, %(http_status)s, %(motivo)s, %(conteudo_sha256)s, %(bytes)s, %(entrada)s
where not exists (select 1 from adm_tentativas t where t.rodada_id = %(rodada)s and t.url_sha = %(url_sha)s and t.tentada_em = %(tentada_em)s)
"""

# %(novo)s: o lida_em candidato veio de leitura real (lida ou mudança de hash), não de reaproveitamento do mesmo conteúdo
_UPSERT = """
insert into adm_evidencias (url_sha, url, conteudo_sha256, lida_em, rodada_id)
values (%(url_sha)s, %(url)s, %(conteudo_sha256)s, %(lida_em)s, %(rodada)s)
on conflict (url_sha) do update set
  conteudo_sha256 = excluded.conteudo_sha256,
  lida_em = case when adm_evidencias.conteudo_sha256 = excluded.conteudo_sha256 and not %(novo)s then adm_evidencias.lida_em else excluded.lida_em end,
  rodada_id = case when adm_evidencias.conteudo_sha256 = excluded.conteudo_sha256 and not %(novo)s then adm_evidencias.rodada_id else excluded.rodada_id end
where adm_evidencias.lida_em <= excluded.lida_em
"""


def _evidencias(linhas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Estado final por URL depois de percorrer as tentativas bem-sucedidas em ordem de horário."""
    est: dict[str, dict[str, Any]] = {}
    for t in sorted((x for x in linhas if x["resultado"] != "falha" and x["conteudo_sha256"]), key=lambda x: x["tentada_em"]):
        cur = est.get(t["url_sha"])
        if cur is None:
            est[t["url_sha"]] = {"url_sha": t["url_sha"], "url": t["url"], "conteudo_sha256": t["conteudo_sha256"], "lida_em": t["tentada_em"], "novo": t["resultado"] == "lida"}
        elif t["resultado"] == "lida" or t["conteudo_sha256"] != cur["conteudo_sha256"]:
            cur.update(conteudo_sha256=t["conteudo_sha256"], lida_em=t["tentada_em"], novo=True)
    return list(est.values())


def importar(conn: Any, rodada_id: str, caminho_log: str | Path, *, urls_entrada: Iterable[str] = ()) -> Resumo:
    """Importa o JSONL de ETL_ATTEMPT_LOG para a rodada. Não comita. Arquivo ausente: FileNotFoundError (nada é gravado)."""
    entrada = set(urls_entrada)
    linhas, ignoradas = _ler(Path(caminho_log))
    res = Resumo(linhas_ignoradas=ignoradas, tentadas=len(linhas), urls_distintas=len({t["url_sha"] for t in linhas}))
    res.lidas = sum(t["resultado"] == "lida" for t in linhas)
    res.reaproveitadas = sum(t["resultado"] == "reaproveitada" for t in linhas)
    res.falhas = dict(Counter(t["motivo"] for t in linhas if t["resultado"] == "falha"))
    if not linhas:
        return res
    with conn.cursor() as cur:
        cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"adm_tentativas:{rodada_id}",))
        cur.executemany(_INSERT, [{**t, "rodada": rodada_id, "entrada": t["url"] in entrada} for t in linhas])
        ev = _evidencias(linhas)
        if ev:
            cur.executemany(_UPSERT, [{**e, "rodada": rodada_id} for e in ev])
    return res


def registrar_robots(conn: Any, rodada_id: str, url: str, tentada_em: datetime) -> None:
    """Tentativa `falha`/`robots`: o bloqueio acontece em `assembleias.allowed`, antes de `fetch`, e não aparece no log. Não comita,
    não toca `adm_evidencias`. Repetir a chamada com a mesma (rodada, url, horário) não duplica."""
    if tentada_em.tzinfo is None:
        raise ValueError("tentada_em precisa de fuso horário")
    if not url.strip():
        raise ValueError("url vazia")
    t = {"rodada": rodada_id, "url": url, "url_sha": sha256_text(url), "host": urlparse(url).netloc or None, "tentada_em": tentada_em,
         "resultado": "falha", "http_status": None, "motivo": "robots", "conteudo_sha256": None, "bytes": None, "entrada": False}
    with conn.cursor() as cur:
        cur.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"adm_tentativas:{rodada_id}",))
        cur.execute(_INSERT, t)
