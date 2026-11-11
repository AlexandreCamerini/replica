"""Conexão, contrato de run (lock, ingest_runs, checksum, stamp) e upsert em lote via COPY.

Contrato de todo job (architecture.md › Jobs):
  1. advisory lock por dataset  2. linha em ingest_runs  3. pula se o checksum não mudou
  4. staging + upsert pela chave natural  5. dataset_stamps  6. derive.stats + revalidate (feito pelo cli)
Se a fonte falhar, o dado anterior fica no ar com o stamp antigo.
Status do run: succeeded, partial (gravou, mas algo ficou retido: Run.partial), skipped_unchanged, failed.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
import traceback
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
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
    rows_read: int | None = None  # None = o job não informou (zero é zero de verdade)
    rows_deleted: int | None = None
    partial_why: list[str] = field(default_factory=list)

    def add(self, n: int) -> None:
        self.rows_upserted += n

    def reject(self, n: int = 1, why: str | None = None) -> None:
        self.rows_rejected += n
        if why:
            self.note(why)

    def read(self, n: int) -> None:
        """Itens lidos da fonte, antes de filtro e de vínculo. É a base do contrato de volume."""
        self.rows_read = (self.rows_read or 0) + n

    def deleted(self, n: int) -> None:
        self.rows_deleted = (self.rows_deleted or 0) + n

    def note(self, msg: str) -> None:
        """Observação do run (vai para ingest_runs.notes). Não é erro e não alerta."""
        if len(self.notes) < MAX_NOTES:
            self.notes.append(msg)

    def partial(self, why: str) -> None:
        """O dado foi gravado, mas algo ficou retido ou incompleto. O run fecha como `partial`: carimba, entra no alerta da agenda
        e não serve de base para o skip por checksum (a próxima execução reprocessa)."""
        if len(self.partial_why) < MAX_NOTES:
            self.partial_why.append(why)


MAX_NOTES = 50


@lru_cache(maxsize=1)
def code_version() -> str | None:
    """Commit do código que rodou: ETL_CODE_VERSION, GITHUB_SHA (Actions) ou o HEAD do checkout (Mac). Nunca levanta."""
    v = os.environ.get("ETL_CODE_VERSION") or os.environ.get("GITHUB_SHA")
    if not v:
        try:
            v = subprocess.run(["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=5).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            v = ""
    return v[:12] or None


def invocation() -> str | None:
    """Id da chamada do run-due que disparou este processo (schedule.run_due põe em ETL_INVOCATION). É por ele que a agenda acha os
    runs `partial` da própria chamada, qualquer que seja o nome do dataset."""
    return os.environ.get("ETL_INVOCATION") or None


def _text(lines: list[str], limit: int) -> str | None:
    return "\n".join(lines)[:limit] or None


def _close(conn: psycopg.Connection, r: Run, status: str, t0: float, *, error: str | None = None, tb: str | None = None) -> None:
    conn.execute(
        """update ingest_runs set status = %s, finished_at = now(), rows_upserted = %s, rows_rejected = %s, rows_read = %s, rows_deleted = %s,
                  duration_ms = %s, error = %s, notes = %s, traceback = %s where id = %s""",
        (status, r.rows_upserted, r.rows_rejected, r.rows_read, r.rows_deleted, int((time.monotonic() - t0) * 1000), error, _text(r.notes, 20000), tb, r.id),
    )


def _keep_partial(r: Run) -> None:
    """Run que marcou partial e não fechou como partial (falhou ou pulou): o motivo fica nas notas em vez de se perder."""
    r.notes = [f"parcial antes de fechar: {w}" for w in r.partial_why] + r.notes


def _fail(conn: psycopg.Connection, r: Run, t0: float, e: BaseException) -> None:
    conn.rollback()
    _keep_partial(r)
    _close(conn, r, "failed", t0, error=f"{type(e).__name__}: {e}"[:2000], tb=traceback.format_exc()[-4000:])
    conn.commit()


@contextmanager
def run(conn: psycopg.Connection, dataset: str, source_slug: str, *, input_checksum: str | None = None, force: bool = False):
    """Abre um run. Levante SkipUnchanged de dentro para marcar skipped_unchanged.

    Fecha como succeeded, partial (Run.partial), skipped_unchanged ou failed. Em failed nada do que o job gravou depois do último
    commit fica, e o carimbo não anda. Notas vão para `notes`; `error` só tem erro (failed) ou o motivo do partial."""
    src = source_id(conn, source_slug)  # antes do lock: fonte desconhecida não deixa lock preso
    cur = conn.cursor()
    cur.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (dataset,))
    if not cur.fetchone()["ok"]:
        raise SystemExit(f"outro run de {dataset} em andamento (advisory lock)")
    try:
        if input_checksum and not force:
            cur.execute(
                # compara com a ÚLTIMA carga que gravou dado: se a fonte foi de A para B e voltou para A, A precisa ser recarregada.
                # partial também gravou dado, mas nunca é base de skip: A -> partial(B) -> A recarrega A, e partial(A) -> A roda de novo.
                """select status, input_checksum = %s as same from ingest_runs
                   where dataset = %s and status in ('succeeded', 'partial') order by started_at desc limit 1""",
                (input_checksum, dataset),
            )
            last = cur.fetchone()
            if last and last["status"] == "succeeded" and last["same"]:
                cur.execute(
                    """insert into ingest_runs (source_id, dataset, status, input_checksum, finished_at, duration_ms, code_version, invocation)
                       values (%s, %s, 'skipped_unchanged', %s, now(), 0, %s, %s) returning id""",
                    (src, dataset, input_checksum, code_version(), invocation()),
                )
                _stamp(conn, dataset, src, str(cur.fetchone()["id"]))
                conn.commit()
                log.info("%s: entrada igual ao último run, pulando", dataset)
                raise SkipUnchanged(dataset)
        cur.execute(
            "insert into ingest_runs (source_id, dataset, input_checksum, code_version, invocation) values (%s, %s, %s, %s, %s) returning id",
            (src, dataset, input_checksum, code_version(), invocation()),
        )
        r = Run(conn, dataset, source_slug, input_checksum, id=str(cur.fetchone()["id"]))
        conn.commit()
        t0 = time.monotonic()
        tag = f"{dataset} [{r.id[:8]}]"
        try:
            yield r
        except SkipUnchanged:
            conn.rollback()
            _keep_partial(r)
            _close(conn, r, "skipped_unchanged", t0)
            _stamp(conn, dataset, src, r.id)
            conn.commit()
            raise
        except (Exception, SystemExit, KeyboardInterrupt) as e:  # noqa: BLE001 - registra e propaga; SystemExit de dentro do job também é falha
            _fail(conn, r, t0, e)
            log.error("%s falhou após %.0fs: %s", tag, time.monotonic() - t0, e)  # o traceback fica em ingest_runs.traceback, não no log
            raise
        else:
            status = "partial" if r.partial_why else "succeeded"
            try:
                rawstore.finalize_run(conn, r)  # D12: cópia datada do bruto; nunca derruba a carga, só deixa nota em r.notes
                _close(conn, r, status, t0, error=_text(r.partial_why, 2000))
                _stamp(conn, dataset, src, r.id)
                conn.commit()
            except Exception as e:  # noqa: BLE001 - fechar falhou: a carga volta atrás e o run fica failed com o erro real, não `running` órfão
                _fail(conn, r, t0, e)
                log.error("%s falhou ao fechar após %.0fs: %s", tag, time.monotonic() - t0, e)
                raise
            if r.partial_why:
                log.warning("%s: PARCIAL em %.0fs, %d upserts: %s", tag, time.monotonic() - t0, r.rows_upserted, "; ".join(r.partial_why)[:500])
            else:
                log.info("%s: ok em %.0fs, %d upserts, %d rejeitadas", tag, time.monotonic() - t0, r.rows_upserted, r.rows_rejected)
        finally:
            rawstore.reset()
    finally:
        conn.rollback()  # nada pendente é confirmado pelo unlock; também tira a sessão de uma transação abortada
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
    if update is None and not upd and not returning:
        action = sql.SQL("do nothing")  # nada a mudar e ninguém pede as linhas de volta: não reescreve
    elif update is None and not upd:
        # chave = todas as colunas: força DO UPDATE para que RETURNING devolva também as linhas já existentes
        action = sql.SQL("do update set updated_at = now()")
    elif upd:
        action = sql.SQL("do update set ") + sql.SQL(", ").join(sql.SQL("{0} = excluded.{0}").format(sql.Identifier(c)) for c in upd)
        if "updated_at" not in cols:
            action += sql.SQL(", updated_at = now()")
        if where:
            action += sql.SQL(" where ") + sql.SQL(where)
        elif not returning:
            # Sem `where` e sem RETURNING: só reescreve a linha que mudou. Reescrever igual gerava de 3 a 128 versões
            # mortas por linha (votes, proposals, person_period_stats) e inchava tabela e índices. Com RETURNING o
            # DO UPDATE continua incondicional, porque o chamador espera todas as linhas de volta.
            cmp = [c for c in upd if c != "updated_at"]
            if cmp:
                lhs = sql.SQL(", ").join(sql.SQL("{}.{}").format(sql.Identifier(table), sql.Identifier(c)) for c in cmp)
                rhs = sql.SQL(", ").join(sql.SQL("excluded.{}").format(sql.Identifier(c)) for c in cmp)
                action += sql.SQL(" where ({}) is distinct from ({})").format(lhs, rhs)
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
