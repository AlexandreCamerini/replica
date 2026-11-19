"""Utilitários de teste de caracterização de coletores (critério R-2).

Um teste de caracterização roda o comando do coletor PELA CLI (`civico_etl.cli.main`) sobre entrada FABRICADA (transporte HTTP
falso, nunca rede) num banco isolado (`banco_isolado.py`) e compara as tabelas de destino com um retrato versionado em
etl/tests/retratos/<nome>.json. O retrato é gravado uma vez, no commit de partida, e o teste só compara.

Regravar o retrato (caminho explícito, nunca silencioso):
    REGRAVAR_RETRATOS=1 pytest tests/test_caracterizacao.py -k <caso>
grava o arquivo e FALHA o teste de propósito ("retrato regravado; rode de novo sem a variável"). Regravar muda o que o coletor
"deve" fazer: o diff do .json precisa de revisão.

Colunas ignoradas na comparação (`IGNORAR`): ver a constante abaixo. Entrada fabricada leva a marca `FABRICADO`.
"""

from __future__ import annotations

import difflib
import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Mapping
from uuid import UUID

import httpx
import pytest

from civico_etl import cli
from civico_etl import http as H

RETRATOS = Path(__file__).resolve().parent / "retratos"
MARCA = "FABRICADO"

#: identidade e auditoria do banco: mudam a cada execução sem mudar o que o coletor faz
IDENTIDADE = ("id", "created_at", "updated_at")
#: referência a run
RUN = ("run_id", "last_run_id")
#: horário de execução (existem no schema: dataset_stamps.refreshed_at, ingest_runs.started_at/finished_at/duration_ms/code_version/invocation,
#: person_period_stats.computed_at). `as_of` NÃO entra por padrão: em várias tabelas é data da fonte e precisa ser comparada;
#: quem sabe que o `as_of` da sua tabela é a data da carga (staff_members) passa em Tabela.ignorar.
HORARIO_EXECUCAO = ("refreshed_at", "fetched_at", "checked_at", "started_at", "finished_at", "duration_ms", "computed_at", "code_version", "invocation")
IGNORAR = IDENTIDADE + RUN + HORARIO_EXECUCAO

Resposta = tuple[int, Mapping[str, str], bytes]


@dataclass
class Tabela:
    """Uma tabela de destino no retrato.

    ordem: expressão `order by` ESTÁVEL (chave natural, nunca id/horário). colunas: lista branca opcional (None = todas menos IGNORAR).
    fk: coluna -> (tabela_ref, coluna_ref, coluna_estavel); troca o UUID por um valor estável (ex.: slug da pessoa).
    ignorar: colunas a ignorar além de IGNORAR (documente o motivo no teste). onde: filtro SQL opcional."""

    ordem: str
    colunas: tuple[str, ...] | None = None
    fk: dict[str, tuple[str, str, str]] = field(default_factory=dict)
    ignorar: tuple[str, ...] = ()
    onde: str | None = None


def _json(v: Any) -> Any:
    if isinstance(v, (datetime, date, dtime)):
        return v.isoformat()
    if isinstance(v, (Decimal, UUID)):
        return str(v)
    if isinstance(v, memoryview):
        return v.hex()
    return v


def retrato_tabelas(url_banco: str, tabelas: Mapping[str, Tabela]) -> dict[str, list[dict[str, Any]]]:
    """Lê as tabelas de destino do banco `url_banco` e devolve estrutura serializável e determinística (linhas ordenadas por `Tabela.ordem`,
    colunas por nome), sem as colunas ignoradas e com as FKs trocadas por valor estável."""
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    out: dict[str, list[dict[str, Any]]] = {}
    with psycopg.connect(url_banco, row_factory=dict_row, autocommit=True) as c:
        c.execute("set timezone = 'UTC'")
        for nome, t in tabelas.items():
            q = sql.SQL("select * from {}").format(sql.Identifier(nome))
            if t.onde:
                q += sql.SQL(" where " + t.onde)
            q += sql.SQL(" order by " + t.ordem)
            fora = set(IGNORAR) | set(t.ignorar)
            linhas = []
            for r in c.execute(q).fetchall():
                d = {}
                for k, v in r.items():
                    if k in t.fk:
                        tab, col, estavel = t.fk[k]
                        v = None if v is None else c.execute(sql.SQL("select {} as v from {} where {} = %s").format(sql.Identifier(estavel), sql.Identifier(tab), sql.Identifier(col)), (v,)).fetchone()["v"]
                    elif k in fora:
                        continue
                    if t.colunas is not None and k not in t.colunas:
                        continue
                    d[k] = _json(v)
                linhas.append(dict(sorted(d.items())))
            out[nome] = linhas
    return out


def _dump(x: Any) -> str:
    return json.dumps(x, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def compara_com_retrato(nome: str, atual: Mapping[str, Any]) -> None:
    """Compara `atual` com etl/tests/retratos/<nome>.json por igualdade. NUNCA regrava sozinho: só com REGRAVAR_RETRATOS=1, e então falha o teste."""
    if atual.get("_origem") != MARCA:
        pytest.fail(f"retrato {nome}: toda entrada fabricada leva `_origem: {MARCA}`", pytrace=False)
    path = RETRATOS / f"{nome}.json"
    texto = _dump(json.loads(json.dumps(atual, default=_json)))
    if os.environ.get("REGRAVAR_RETRATOS") == "1":
        path.write_text(texto, encoding="utf-8")
        pytest.fail(f"retrato regravado; rode de novo sem a variável ({path.name})", pytrace=False)
    if not path.exists():
        pytest.fail(f"retrato {path} não existe; gere com REGRAVAR_RETRATOS=1 e revise o diff", pytrace=False)
    esperado = path.read_text(encoding="utf-8")
    if esperado != texto:
        diff = "".join(difflib.unified_diff(esperado.splitlines(True), texto.splitlines(True), "retrato (versionado)", "atual", n=2))
        pytest.fail(f"retrato {path.name} difere do comportamento atual:\n{diff[:6000]}", pytrace=False)


def rodar_cli(argv: list[str], *, url_banco: str, respostas: Mapping[str, Resposta] | Callable[[httpx.Request], Resposta], monkeypatch, tmp_path: Path) -> int:
    """Roda `civico_etl.cli.main(argv)` contra `url_banco` com HTTP fabricado e devolve o código de saída.

    `respostas`: URL completa -> (status, headers, corpo em bytes), ou função(request) -> (status, headers, corpo). URL não prevista
    FALHA o teste (AssertionError com a URL), nunca vai à rede. O cache de http fica em tmp_path e a espera de limite de taxa é neutralizada.
    `db.connect` lê ETL_DATABASE_URL/DATABASE_URL a cada chamada; ambas apontam para `url_banco`."""
    monkeypatch.setenv("ETL_DATABASE_URL", url_banco)
    monkeypatch.setenv("DATABASE_URL", url_banco)
    monkeypatch.setenv("ETL_RAW_STORE", "off")  # sem cópia do bruto fora do tmp_path
    monkeypatch.delenv("ETL_INVOCATION", raising=False)

    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if callable(respostas):
            status, headers, corpo = respostas(req)
        elif url in respostas:
            status, headers, corpo = respostas[url]
        else:
            raise AssertionError(f"caracterização: URL não prevista nas respostas fabricadas (nunca vai à rede): {req.method} {url}")
        return httpx.Response(status, headers=dict(headers), content=corpo)

    monkeypatch.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(H, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(H, "RATE", 1e9)  # _throttle não espera
    monkeypatch.setattr(H, "_last_call", {})
    monkeypatch.setattr(H.time, "sleep", lambda s: None)  # backoff de retentativa também (desfeito pelo monkeypatch)
    return cli.main(argv)
