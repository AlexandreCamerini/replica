"""Conexão, contrato de run (lock, ingest_runs, checksum, stamp) e upsert em lote via COPY.

Contrato de todo job (architecture.md › Jobs):
  1. advisory lock por dataset  2. linha em ingest_runs  3. pula se o checksum não mudou
  4. staging + upsert pela chave natural  5. dataset_stamps  6. derive.stats + revalidate (feito pelo cli)
Se a fonte falhar, o dado anterior fica no ar com o stamp antigo. Nada é apagado.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from . import rawstore

log = logging.getLogger("etl.db")


def connect() -> psycopg.Connection:
    url = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("defina ETL_DATABASE_URL (role de escrita: service_role no Supabase)")
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    conn.execute("set search_path = public, extensions")
    conn.execute("set timezone = 'UTC'")
    return conn


class SkipUnchanged(Exception):
    """Entrada idêntica à do último run bem-sucedido."""


@dataclass
class Run:
    conn: psycopg.Connection
    dataset: str
    source_slug: str
    input_checksum: str | None = None
    rows_upserted: int = 0
    rows_rejected: int = 0
    notes: list[str] = field(default_factory=list)
    id: str | None = None

    def add(self, n: int) -> None:
        self.rows_upserted += n

    def reject(self, n: int = 1, why: str | None = None) -> None:
        self.rows_rejected += n
        if why and len(self.notes) < 50:
            self.notes.append(why)


@contextmanager
def run(conn: psycopg.Connection, dataset: str, source_slug: str, *, input_checksum: str | None = None, force: bool = False):
    """Abre um run. Levante SkipUnchanged de dentro para marcar skipped_unchanged."""
    cur = conn.cursor()
    cur.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (dataset,))
    if not cur.fetchone()["ok"]:
        raise SystemExit(f"outro run de {dataset} em andamento (advisory lock)")
    src = source_id(conn, source_slug)
    if input_checksum and not force:
        cur.execute(
            # compara com o ÚLTIMO run bem-sucedido: se a fonte foi de A para B e voltou para A, A precisa ser recarregada
            "select input_checksum = %s as same from ingest_runs where dataset = %s and status = 'succeeded' order by started_at desc limit 1",
            (input_checksum, dataset),
        )
        last = cur.fetchone()
        if last and last["same"]:
            cur.execute(
                "insert into ingest_runs (source_id, dataset, status, input_checksum, finished_at) values (%s, %s, 'skipped_unchanged', %s, now()) returning id",
                (src, dataset, input_checksum),
            )
            _stamp(conn, dataset, src, str(cur.fetchone()["id"]))
            conn.commit()
            cur.execute("select pg_advisory_unlock(hashtext(%s))", (dataset,))
            conn.commit()
            log.info("%s: entrada igual ao último run, pulando", dataset)
            raise SkipUnchanged(dataset)
    cur.execute(
        "insert into ingest_runs (source_id, dataset, input_checksum) values (%s, %s, %s) returning id",
        (src, dataset, input_checksum),
    )
    r = Run(conn, dataset, source_slug, input_checksum, id=str(cur.fetchone()["id"]))
    conn.commit()
    t0 = time.monotonic()
    try:
        yield r
    except SkipUnchanged:
        conn.rollback()
        conn.execute("update ingest_runs set status = 'skipped_unchanged', finished_at = now() where id = %s", (r.id,))
        _stamp(conn, dataset, src, r.id)
        conn.commit()
        raise
    except Exception as e:  # noqa: BLE001 - registra e propaga
        conn.rollback()
        conn.execute(
            "update ingest_runs set status = 'failed', finished_at = now(), error = %s, rows_upserted = %s, rows_rejected = %s where id = %s",
            (f"{type(e).__name__}: {e}"[:2000], r.rows_upserted, r.rows_rejected, r.id),
        )
        conn.commit()
        log.error("%s falhou após %.0fs: %s", dataset, time.monotonic() - t0, e)
        raise
    else:
        rawstore.finalize_run(conn, r)  # D12: cópia datada do bruto; nunca derruba a carga, só deixa nota em r.notes
        conn.execute(
            "update ingest_runs set status = 'succeeded', finished_at = now(), rows_upserted = %s, rows_rejected = %s, error = %s where id = %s",
            (r.rows_upserted, r.rows_rejected, "\n".join(r.notes) or None, r.id),
        )
        _stamp(conn, dataset, src, r.id)
        conn.commit()
        log.info("%s: ok em %.0fs, %d upserts, %d rejeitadas", dataset, time.monotonic() - t0, r.rows_upserted, r.rows_rejected)
    finally:
        rawstore.reset()
        conn.execute("select pg_advisory_unlock(hashtext(%s))", (dataset,))
        conn.commit()


def _stamp(conn: psycopg.Connection, dataset: str, src: str, run_id: str) -> None:
    """Carimbo = "conferido com a fonte em". Entrada igual (skipped_unchanged) também carimba: a fonte foi lida e não mudou,
    então o dado está em dia; sem isso uma fonte estável aparece "fora do prazo" para sempre (D250)."""
    conn.execute(
        """insert into dataset_stamps (dataset, source_id, refreshed_at, last_run_id)
           values (%s, %s, now(), %s)
           on conflict (dataset) do update set refreshed_at = excluded.refreshed_at, last_run_id = excluded.last_run_id, source_id = excluded.source_id""",
        (dataset, src, run_id),
    )


def source_id(conn: psycopg.Connection, slug: str) -> str:
    row = conn.execute("select id from sources where slug = %s", (slug,)).fetchone()
    if not row:
        raise SystemExit(f"source '{slug}' não existe: rode o job seed")
    return str(row["id"])


def upsert(
    conn: psycopg.Connection,
    table: str,
    cols: Sequence[str],
    rows: Iterable[Sequence[Any]],
    key: Sequence[str],
    *,
    update: Sequence[str] | None = None,
    where: str | None = None,
    returning: Sequence[str] | None = None,
) -> list[dict[str, Any]]:
    """COPY para tabela temporária + INSERT ... ON CONFLICT (key) DO UPDATE. Devolve `returning`, se pedido.

    `update=None` atualiza todas as colunas fora da chave; `update=[]` faz DO NOTHING.
    Linhas duplicadas pela chave dentro do mesmo lote ficam só com a última (DISTINCT ON).
    """
    rows = list(rows)
    if not rows:
        return []
    tmp = f"tmp_{table}_{int(time.time() * 1000) % 100000}"
    cur = conn.cursor()
    cur.execute(sql.SQL("create temp table {} (like {} including defaults) on commit drop").format(sql.Identifier(tmp), sql.Identifier(table)))
    # colunas identity não podem ser copiadas: remove da temp quando não vêm no lote
    cur.execute(
        "select column_name from information_schema.columns where table_name = %s and table_schema = 'public' and is_identity = 'YES'",
        (table,),
    )
    for r in cur.fetchall():
        if r["column_name"] not in cols:
            cur.execute(sql.SQL("alter table {} drop column {}").format(sql.Identifier(tmp), sql.Identifier(r["column_name"])))
    with cur.copy(sql.SQL("copy {} ({}) from stdin").format(sql.Identifier(tmp), sql.SQL(", ").join(map(sql.Identifier, cols)))) as cp:
        for row in rows:
            cp.write_row(row)
    upd = [c for c in cols if c not in key] if update is None else list(update)
    if update is None and not upd:
        # chave = todas as colunas: força DO UPDATE para que RETURNING devolva também as linhas já existentes
        action = sql.SQL("do update set updated_at = now()")
    elif upd:
        action = sql.SQL("do update set ") + sql.SQL(", ").join(sql.SQL("{0} = excluded.{0}").format(sql.Identifier(c)) for c in upd)
        if "updated_at" not in cols:
            action += sql.SQL(", updated_at = now()")
        if where:
            action += sql.SQL(" where ") + sql.SQL(where)
    else:
        action = sql.SQL("do nothing")
    q = sql.SQL("insert into {t} ({cols}) select distinct on ({key}) {cols} from {tmp} order by {key} {conflict} {action}").format(
        t=sql.Identifier(table),
        cols=sql.SQL(", ").join(map(sql.Identifier, cols)),
        key=sql.SQL(", ").join(map(sql.Identifier, key)),
        tmp=sql.Identifier(tmp),
        conflict=sql.SQL("on conflict ({})").format(sql.SQL(", ").join(map(sql.Identifier, key))),
        action=action,
    )
    if returning:
        q += sql.SQL(" returning {}").format(sql.SQL(", ").join(map(sql.Identifier, returning)))
        cur.execute(q)
        out = cur.fetchall()
    else:
        cur.execute(q)
        out = []
    cur.execute(sql.SQL("drop table {}").format(sql.Identifier(tmp)))
    return out


def lookup(conn: psycopg.Connection, q: str, params: Sequence[Any] = ()) -> dict[Any, Any]:
    """Primeira coluna -> segunda coluna."""
    cur = conn.execute(q, params)
    return {tuple(r.values())[0]: tuple(r.values())[1] for r in cur.fetchall()}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
