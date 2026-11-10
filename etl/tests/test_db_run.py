"""Contrato de run (db.run): lock, linha em ingest_runs, skip por checksum, carimbo. É o que todo job herda.

db.run faz commit, então não cabe em transação revertida: usa a conexão `rw` e apaga o que gravou (datasets `zz.teste.*`, fonte `zz-teste-run`).
"""

from __future__ import annotations

import uuid

import pytest

from civico_etl import db as D

SRC = "zz-teste-run"


@pytest.fixture
def ds(rw):
    """Nome de dataset único por teste, com a fonte de teste criada; limpa tudo no fim."""
    rw.execute("insert into sources (slug, name, url) values (%s, 'Teste do contrato de run', 'https://example.invalid/') on conflict (slug) do nothing", (SRC,))
    rw.commit()
    yield f"zz.teste.{uuid.uuid4().hex[:12]}"
    rw.rollback()
    rw.execute("delete from dataset_stamps where dataset like 'zz.teste.%'")
    rw.execute("delete from ingest_runs where dataset like 'zz.teste.%'")
    rw.execute("delete from sources where slug = %s", (SRC,))
    rw.commit()


def _runs(c, dataset):
    return c.execute("select * from ingest_runs where dataset = %s order by started_at, created_at", (dataset,)).fetchall()


def _stamp(c, dataset):
    return c.execute("select * from dataset_stamps where dataset = %s", (dataset,)).fetchone()


def test_sucesso_fecha_o_run_e_carimba(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a") as r:
        r.add(3)
        r.reject(2, "linha sem chave")
    (row,) = _runs(rw, ds)
    assert row["status"] == "succeeded" and row["finished_at"] is not None
    assert (row["rows_upserted"], row["rows_rejected"], row["input_checksum"]) == (3, 2, "a")
    assert "linha sem chave" in row["error"]  # hoje as notas de sucesso moram em `error` (auditoria M9; muda na Fase 1)
    st = _stamp(rw, ds)
    assert st is not None and str(st["last_run_id"]) == str(row["id"])


def test_falha_registra_propaga_e_mantem_o_carimbo_antigo(rw, ds):
    with D.run(rw, ds, SRC):
        pass
    antes = _stamp(rw, ds)
    with pytest.raises(ValueError, match="fonte fora do ar"):
        with D.run(rw, ds, SRC) as r:
            r.add(7)
            raise ValueError("fonte fora do ar")
    ok, falha = _runs(rw, ds)
    assert falha["status"] == "failed" and falha["error"] == "ValueError: fonte fora do ar" and falha["rows_upserted"] == 7
    depois = _stamp(rw, ds)
    # fonte falhou = dado e carimbo anteriores ficam (contrato, architecture.md)
    assert depois["refreshed_at"] == antes["refreshed_at"] and str(depois["last_run_id"]) == str(ok["id"])


def test_falha_desfaz_o_que_o_job_gravou(rw, ds):
    with pytest.raises(RuntimeError):
        with D.run(rw, ds, SRC):
            rw.execute("insert into sources (slug, name, url) values ('zz-teste-run-lixo', 'x', 'https://example.invalid/')")
            raise RuntimeError("no meio da carga")
    assert rw.execute("select 1 from sources where slug = 'zz-teste-run-lixo'").fetchone() is None


def test_checksum_igual_pula_e_carimba_mesmo_assim(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a"):
        pass
    antes = _stamp(rw, ds)
    entrou = False
    with pytest.raises(D.SkipUnchanged):
        with D.run(rw, ds, SRC, input_checksum="a"):
            entrou = True
    assert not entrou
    _, pulado = _runs(rw, ds)
    assert pulado["status"] == "skipped_unchanged" and pulado["finished_at"] is not None
    depois = _stamp(rw, ds)
    # D250: fonte lida e igual = dado em dia; o carimbo anda e aponta o run pulado
    assert depois["refreshed_at"] > antes["refreshed_at"] and str(depois["last_run_id"]) == str(pulado["id"])


def test_force_ignora_o_checksum(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a"):
        pass
    with D.run(rw, ds, SRC, input_checksum="a", force=True) as r:
        r.add(1)
    assert [x["status"] for x in _runs(rw, ds)] == ["succeeded", "succeeded"]


def test_sem_checksum_sempre_roda(rw, ds):
    for _ in range(2):
        with D.run(rw, ds, SRC):
            pass
    assert [x["status"] for x in _runs(rw, ds)] == ["succeeded", "succeeded"]


def test_compara_com_o_ultimo_sucesso_a_b_a_recarrega(rw, ds):
    for ck in ("a", "b", "a"):
        with D.run(rw, ds, SRC, input_checksum=ck):
            pass
    assert [x["status"] for x in _runs(rw, ds)] == ["succeeded"] * 3


def test_run_que_falhou_nao_vira_base_do_skip(rw, ds):
    with pytest.raises(ValueError):
        with D.run(rw, ds, SRC, input_checksum="a"):
            raise ValueError("carga pela metade")
    with D.run(rw, ds, SRC, input_checksum="a") as r:  # mesma entrada: precisa rodar de novo
        r.add(1)
    assert [x["status"] for x in _runs(rw, ds)] == ["failed", "succeeded"]


def test_skip_levantado_de_dentro_marca_pulado_e_carimba(rw, ds):
    with pytest.raises(D.SkipUnchanged):
        with D.run(rw, ds, SRC):
            raise D.SkipUnchanged(ds)
    (row,) = _runs(rw, ds)
    assert row["status"] == "skipped_unchanged" and _stamp(rw, ds) is not None


def test_lock_ocupado_aborta_sem_abrir_run(rw, ds, conn):
    conn.execute("select pg_advisory_lock(hashtext(%s))", (ds,))  # outra sessão segura o dataset
    try:
        with pytest.raises(SystemExit, match="advisory lock"):
            with D.run(rw, ds, SRC):
                pass
        rw.rollback()
        assert _runs(rw, ds) == []
    finally:
        conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


def test_lock_e_solto_no_sucesso_e_na_falha(rw, ds, conn):
    with D.run(rw, ds, SRC):
        pass
    with pytest.raises(ValueError):
        with D.run(rw, ds, SRC):
            raise ValueError("x")
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (ds,)).fetchone()["ok"]
    assert got, "db.run deixou o advisory lock preso"
    conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


def test_fonte_desconhecida_aborta(rw, ds):
    with pytest.raises(SystemExit, match="não existe"):
        with D.run(rw, ds, "zz-fonte-que-nao-existe"):
            pass
    rw.rollback()
    rw.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))  # hoje o lock fica preso neste caminho (sessão morre com o processo)
    rw.commit()
