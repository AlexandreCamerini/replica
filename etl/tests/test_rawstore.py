"""D12: cópia datada do bruto. Retenção, falha de upload e desligado por padrão (sem banco)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from civico_etl import rawstore
from civico_etl.rawstore import Artifact, LocalStore, archive_run, expires_for, finalize_run, purge_expired, store_from_env

NOW = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)


class FakeRun:
    def __init__(self, dataset="camara.votos", id="r1"):
        self.dataset, self.id, self.notes = dataset, id, []


class FakeConn:
    def __init__(self, rows=()):
        self.rows, self.calls = list(rows), []

    def execute(self, q, params=()):
        self.calls.append((q, params))
        return self

    def fetchall(self):
        return self.rows

    def transaction(self):
        import contextlib

        return contextlib.nullcontext()


def test_desligado_por_padrao():
    assert store_from_env({}) is None
    assert store_from_env({"ETL_RAW_STORE": "off"}) is None
    assert store_from_env({"ETL_RAW_STORE": "supabase"}) is None  # incompleto: desliga, não levanta


def test_retencao():
    assert expires_for("camara.votos", NOW) == NOW + timedelta(days=90)
    assert expires_for("tse.candidatos.2026", NOW) is None


def test_archive_grava_arquivo_e_manifesto(tmp_path):
    src = tmp_path / "a.body"
    src.write_text("x,y\n1,2\n")
    uri, exp, size, notes = archive_run(LocalStore(tmp_path / "st"), "camara.votos", "r1", [Artifact("https://x/a.csv", src, "abc"), Artifact("https://x/z.zip", None, None)], now=NOW)
    m = json.loads(Path(uri.removeprefix("file://")).read_text())
    assert exp == NOW + timedelta(days=90) and size > 0 and notes == []
    assert m["artifacts"][0]["stored_uri"] and m["artifacts"][0]["encoding"] == "gzip"
    assert m["artifacts"][1]["stored_uri"] is None and "Range" in m["artifacts"][1]["why_not_stored"]


class BoomStore(LocalStore):
    def put(self, key, path, content_type):
        if key.endswith("manifest.json"):
            return super().put(key, path, content_type)
        raise OSError("disco cheio")


def test_falha_de_upload_vira_nota_e_nao_levanta(tmp_path):
    src = tmp_path / "a.body"
    src.write_text("1")
    c, r = FakeConn(), FakeRun()
    rawstore.reset()
    rawstore.note("https://x/a.csv", src, "abc")
    finalize_run(c, r, BoomStore(tmp_path / "st"))
    rawstore.reset()
    assert any("upload falhou" in n for n in r.notes)
    assert c.calls and c.calls[0][1][0].startswith("file://")  # raw_uri do manifesto gravado mesmo assim


def test_falha_total_do_armazenamento_nao_derruba(tmp_path):
    class Dead(LocalStore):
        def put(self, *a, **k):
            raise OSError("fora do ar")

    r = FakeRun()
    finalize_run(FakeConn(), r, Dead(tmp_path))
    assert r.notes and "cópia do bruto falhou" in r.notes[0]


def test_purge_apaga_so_o_vencido(tmp_path):
    st = LocalStore(tmp_path / "st")
    src = tmp_path / "a.body"
    src.write_text("1")
    uri, exp, _, _ = archive_run(st, "camara.votos", "r1", [Artifact("https://x/a.csv", src, "a")], now=NOW - timedelta(days=100))
    m = json.loads(st.get_text(uri))
    stored = Path(m["artifacts"][0]["stored_uri"].removeprefix("file://"))
    assert stored.exists()
    c = FakeConn([{"id": "r1", "raw_uri": uri}])
    assert purge_expired(c, st, NOW) == 1
    assert not stored.exists() and not Path(uri.removeprefix("file://")).exists()
    assert "raw_expires_at < %s" in c.calls[0][0]  # permanentes têm raw_expires_at nulo: nunca entram


def test_toda_carga_com_sucesso_tem_raw_uri(tmp_path):
    c, r = FakeConn(), FakeRun("tse.candidatos.2026")
    rawstore.reset()
    finalize_run(c, r, LocalStore(tmp_path))  # run sem download anotado: manifesto vazio, ainda com raw_uri
    assert c.calls[0][1][0].startswith("file://") and c.calls[0][1][1] is None
