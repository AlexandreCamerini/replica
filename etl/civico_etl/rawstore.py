"""Cópia datada do bruto de cada carga (catálogo D12, D280).

Cada download feito por `http.fetch` / `remotezip.open_remote` é anotado aqui; ao fechar um run com sucesso, `archive_run` grava
os arquivos (comprimidos) e um manifesto JSON no armazenamento configurado, e o caminho do manifesto vai em `ingest_runs.raw_uri`.

Desligado por padrão (ETL_RAW_STORE=off). Backends: local (disco), supabase (Storage via HTTP), r2 (S3 via boto3, import tardio).
A cópia NUNCA derruba a carga: qualquer erro aqui vira nota do run.

Retenção: 90 dias para os diários; permanente (expires=None) para os arquivos de eleição do TSE (dataset `tse.*`).
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

import httpx

log = logging.getLogger("etl.rawstore")

RETENTION_DAYS = 90
_COMPRESSED_EXT = (".zip", ".gz", ".xz", ".bz2")


@dataclass
class Artifact:
    url: str
    path: Path | None  # None: lido por Range (zip remoto), sem cópia local
    sha256: str | None


_noted: list[Artifact] = []


def note(url: str, path: Path | None, sha256: str | None) -> None:
    """Chamado pelos downloads. Fica em memória até o run fechar."""
    if not any(a.url == url for a in _noted):
        _noted.append(Artifact(url, path, sha256))


def reset() -> None:
    _noted.clear()


def pending() -> list[Artifact]:
    return list(_noted)


class Store(Protocol):
    def put(self, key: str, path: Path, content_type: str) -> str: ...
    def delete(self, uri: str) -> None: ...
    def get_text(self, uri: str) -> str: ...


class LocalStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def put(self, key: str, path: Path, content_type: str) -> str:
        dest = self.root / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)
        return f"file://{dest}"

    def delete(self, uri: str) -> None:
        Path(uri.removeprefix("file://")).unlink(missing_ok=True)

    def get_text(self, uri: str) -> str:
        return Path(uri.removeprefix("file://")).read_text()


class SupabaseStore:
    """Supabase Storage. Bucket privado, criado pelo dono (ver replica/runbook-raw-storage.md)."""

    def __init__(self, url: str, key: str, bucket: str):
        self.base, self.key, self.bucket = url.rstrip("/"), key, bucket

    def put(self, key: str, path: Path, content_type: str) -> str:
        with open(path, "rb") as f:
            r = httpx.post(
                f"{self.base}/storage/v1/object/{self.bucket}/{key}",
                headers={"Authorization": f"Bearer {self.key}", "Content-Type": content_type, "x-upsert": "true"},
                content=f,
                timeout=httpx.Timeout(60.0, read=900.0),
            )
        r.raise_for_status()
        return f"supabase://{self.bucket}/{key}"

    def delete(self, uri: str) -> None:
        key = uri.removeprefix(f"supabase://{self.bucket}/")
        r = httpx.request("DELETE", f"{self.base}/storage/v1/object/{self.bucket}", headers={"Authorization": f"Bearer {self.key}"}, json={"prefixes": [key]}, timeout=60)
        r.raise_for_status()

    def get_text(self, uri: str) -> str:
        key = uri.removeprefix(f"supabase://{self.bucket}/")
        r = httpx.get(f"{self.base}/storage/v1/object/{self.bucket}/{key}", headers={"Authorization": f"Bearer {self.key}"}, timeout=60)
        r.raise_for_status()
        return r.text


class R2Store:
    def __init__(self, endpoint: str, key_id: str, secret: str, bucket: str):
        import boto3  # noqa: PLC0415 - dependência opcional, só em produção com R2

        self.bucket = bucket
        self.s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=key_id, aws_secret_access_key=secret, region_name="auto")

    def put(self, key: str, path: Path, content_type: str) -> str:
        self.s3.upload_file(str(path), self.bucket, key, ExtraArgs={"ContentType": content_type})
        return f"r2://{self.bucket}/{key}"

    def delete(self, uri: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=uri.removeprefix(f"r2://{self.bucket}/"))

    def get_text(self, uri: str) -> str:
        return self.s3.get_object(Bucket=self.bucket, Key=uri.removeprefix(f"r2://{self.bucket}/"))["Body"].read().decode()


def store_from_env(env: dict[str, str] | None = None) -> Store | None:
    """None = desligado (padrão). Configuração incompleta também desliga, com aviso, em vez de derrubar a carga."""
    e = os.environ if env is None else env
    mode = (e.get("ETL_RAW_STORE") or "off").lower()
    try:
        if mode == "local":
            return LocalStore(e.get("ETL_RAW_DIR") or Path(__file__).resolve().parent.parent / ".raw")
        if mode == "supabase":
            return SupabaseStore(e["ETL_RAW_SUPABASE_URL"], e["ETL_RAW_SUPABASE_KEY"], e.get("ETL_RAW_BUCKET", "raw-dumps"))
        if mode == "r2":
            return R2Store(e["ETL_RAW_R2_ENDPOINT"], e["ETL_RAW_R2_KEY_ID"], e["ETL_RAW_R2_SECRET"], e.get("ETL_RAW_BUCKET", "raw-dumps"))
    except Exception as ex:  # noqa: BLE001
        log.warning("ETL_RAW_STORE=%s mal configurado (%s: %s); cópia do bruto desligada", mode, type(ex).__name__, ex)
        return None
    if mode != "off":
        log.warning("ETL_RAW_STORE=%r desconhecido; cópia do bruto desligada", mode)
    return None


def expires_for(dataset: str, now: datetime) -> datetime | None:
    """Arquivos de eleição do TSE: permanente. Demais: 90 dias."""
    return None if dataset.startswith("tse.") else now + timedelta(days=RETENTION_DAYS)


def _key(dataset: str, run_id: str, now: datetime, name: str) -> str:
    return f"{dataset}/{now:%Y/%m/%d}/{run_id}/{name}"


def archive_run(
    store: Store, dataset: str, run_id: str, artifacts: list[Artifact], *, now: datetime | None = None
) -> tuple[str, datetime | None, int, list[str]]:
    """Grava os arquivos e o manifesto. Devolve (raw_uri do manifesto, expira_em, bytes, notas).

    Falha de upload de um arquivo vira nota e o artefato entra no manifesto sem `stored_uri`; só falha do manifesto levanta."""
    now = now or datetime.now(timezone.utc)
    notes: list[str] = []
    total = 0
    items: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as tmp:
        for a in artifacts:
            item: dict[str, Any] = {"url": a.url, "sha256": a.sha256, "stored_uri": None, "bytes": None, "encoding": None}
            if a.path is None or not a.path.exists():
                item["why_not_stored"] = "lido por Range (zip remoto) ou sem arquivo local"
            else:
                try:
                    name = a.path.name
                    src = a.path
                    if not name.lower().endswith(_COMPRESSED_EXT) and not a.url.lower().endswith(_COMPRESSED_EXT):
                        src = Path(tmp) / (name + ".gz")
                        with open(a.path, "rb") as fi, gzip.open(src, "wb", compresslevel=6) as fo:
                            shutil.copyfileobj(fi, fo)
                        item["encoding"] = "gzip"
                        name += ".gz"
                    item["stored_uri"] = store.put(_key(dataset, run_id, now, name), src, "application/octet-stream")
                    item["bytes"] = src.stat().st_size
                    total += item["bytes"]
                except Exception as ex:  # noqa: BLE001 - cópia nunca derruba a carga
                    item["why_not_stored"] = f"{type(ex).__name__}: {ex}"[:300]
                    notes.append(f"raw: upload falhou para {a.url.split('?')[0]}: {type(ex).__name__}")
            items.append(item)
        manifest = {"dataset": dataset, "run_id": run_id, "archived_at": now.isoformat(), "retention": "permanent" if expires_for(dataset, now) is None else f"{RETENTION_DAYS}d", "artifacts": items}
        mp = Path(tmp) / "manifest.json"
        mp.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
        uri = store.put(_key(dataset, run_id, now, "manifest.json"), mp, "application/json")
    return uri, expires_for(dataset, now), total, notes


def finalize_run(conn: Any, run: Any, store: Store | None = None) -> None:
    """Chamado ao fechar um run com sucesso. Nunca levanta."""
    try:
        store = store if store is not None else store_from_env()
        if store is None:
            return
        uri, exp, size, notes = archive_run(store, run.dataset, run.id, pending())
        for n in notes:
            if len(run.notes) < 50:
                run.notes.append(n)
        with conn.transaction():  # savepoint: falha do UPDATE não aborta a transação do run
            conn.execute("update ingest_runs set raw_uri = %s, raw_expires_at = %s, raw_bytes = %s where id = %s", (uri, exp, size, run.id))
    except Exception as ex:  # noqa: BLE001
        log.warning("cópia do bruto falhou (%s: %s); a carga segue", type(ex).__name__, ex)
        if len(run.notes) < 50:
            run.notes.append(f"raw: cópia do bruto falhou ({type(ex).__name__})")


def purge_expired(conn: Any, store: Store, now: datetime | None = None) -> int:
    """Apaga arquivos e manifesto dos runs vencidos (raw_expires_at < now). Mantém raw_uri e marca raw_purged_at."""
    now = now or datetime.now(timezone.utc)
    rows = conn.execute("select id, raw_uri from ingest_runs where raw_expires_at < %s and raw_purged_at is null and raw_uri is not null", (now,)).fetchall()
    n = 0
    for r in rows:
        try:
            manifest = json.loads(store.get_text(r["raw_uri"]))
            for it in manifest.get("artifacts", []):
                if it.get("stored_uri"):
                    store.delete(it["stored_uri"])
            store.delete(r["raw_uri"])
        except Exception as ex:  # noqa: BLE001
            log.warning("purge de %s falhou: %s", r["id"], ex)
            continue
        conn.execute("update ingest_runs set raw_purged_at = %s where id = %s", (now, r["id"]))
        n += 1
    return n
