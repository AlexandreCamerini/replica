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
    """Nome de dataset único por teste, com a fonte de teste criada; limpa tudo no fim (e sobra de execução interrompida, no começo)."""
    rw.execute("delete from sources where slug like 'zz-teste-run-%'")
    rw.execute("insert into sources (slug, name, url) values (%s, 'Teste do contrato de run', 'https://example.invalid/') on conflict (slug) do nothing", (SRC,))
    rw.commit()
    yield f"zz.teste.{uuid.uuid4().hex[:12]}"
    rw.rollback()
    rw.execute("delete from dataset_stamps where dataset like 'zz.teste.%'")
    rw.execute("delete from ingest_runs where dataset like 'zz.teste.%'")
    rw.execute("delete from sources where slug = %s or slug like 'zz-teste-run-%%'", (SRC,))
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
    assert row["error"] is None and row["notes"] == "linha sem chave" and row["traceback"] is None  # nota não é erro (auditoria M9)
    assert row["rows_read"] is None and row["rows_deleted"] is None  # o job não informou: nulo, não zero
    assert row["duration_ms"] >= 0 and row["code_version"] and row["code_version"] == D.code_version() and row["invocation"] is None
    st = _stamp(rw, ds)
    assert st is not None and str(st["last_run_id"]) == str(row["id"])


def test_falha_registra_propaga_e_mantem_o_carimbo_antigo(rw, ds):
    with D.run(rw, ds, SRC):
        pass
    antes = _stamp(rw, ds)
    with pytest.raises(ValueError, match="fonte fora do ar"):
        with D.run(rw, ds, SRC) as r:
            r.add(7)
            r.read(9)
            r.note("nota antes da falha")
            raise ValueError("fonte fora do ar")
    ok, falha = _runs(rw, ds)
    assert falha["status"] == "failed" and falha["error"] == "ValueError: fonte fora do ar" and falha["rows_upserted"] == 7
    assert falha["notes"] == "nota antes da falha" and (falha["rows_read"], falha["rows_deleted"]) == (9, None)
    assert "ValueError: fonte fora do ar" in falha["traceback"] and "test_db_run.py" in falha["traceback"]
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


def test_fonte_desconhecida_aborta_sem_prender_o_lock(rw, ds, conn):
    with pytest.raises(SystemExit, match="não existe"):
        with D.run(rw, ds, "zz-fonte-que-nao-existe"):
            pass
    rw.rollback()
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (ds,)).fetchone()["ok"]
    assert got, "fonte desconhecida deixou o advisory lock preso"
    conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


# ---- registro de run e status partial (migração 0131)

def test_partial_grava_carimba_e_guarda_o_motivo_em_error(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a") as r:
        r.add(4)
        r.read(10)
        r.deleted(0)
        r.note("3 sem vínculo")
        r.partial("exclusão retida: leitura menor que metade da gravada")
        rw.execute("insert into sources (slug, name, url) values ('zz-teste-run-parcial', 'x', 'https://example.invalid/')")
    try:
        (row,) = _runs(rw, ds)
        assert row["status"] == "partial" and row["error"] == "exclusão retida: leitura menor que metade da gravada"
        assert (row["notes"], row["rows_upserted"], row["rows_read"], row["rows_deleted"]) == ("3 sem vínculo", 4, 10, 0)
        assert str(_stamp(rw, ds)["last_run_id"]) == str(row["id"])  # o dado entrou: carimba
        assert rw.execute("select 1 from sources where slug = 'zz-teste-run-parcial'").fetchone()  # e o que o job gravou fica
    finally:
        rw.execute("delete from sources where slug = 'zz-teste-run-parcial'")
        rw.commit()


def test_partial_nunca_e_base_do_skip(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a") as r:
        r.partial("retido")
    with D.run(rw, ds, SRC, input_checksum="a"):  # mesma entrada depois de partial: roda de novo
        pass
    assert [x["status"] for x in _runs(rw, ds)] == ["partial", "succeeded"]


def test_a_partial_b_a_recarrega_a(rw, ds):
    # partial(B) gravou B por cima de A. Comparar só com o último `succeeded` (A) pularia a volta para A e deixaria B no ar.
    with D.run(rw, ds, SRC, input_checksum="a"):
        pass
    with D.run(rw, ds, SRC, input_checksum="b") as r:
        r.partial("retido")
    with D.run(rw, ds, SRC, input_checksum="a"):
        pass
    assert [x["status"] for x in _runs(rw, ds)] == ["succeeded", "partial", "succeeded"]


@pytest.mark.parametrize("exc", [SystemExit("validação falhou: fonte mudou de formato?"), KeyboardInterrupt()])
def test_systemexit_de_dentro_do_job_e_falha_com_rollback(rw, ds, conn, exc):
    with pytest.raises(type(exc)):
        with D.run(rw, ds, SRC):
            rw.execute("insert into sources (slug, name, url) values ('zz-teste-run-lixo', 'x', 'https://example.invalid/')")
            raise exc
    (row,) = _runs(rw, ds)
    assert row["status"] == "failed" and row["error"].startswith(type(exc).__name__) and row["finished_at"] is not None
    assert rw.execute("select 1 from sources where slug = 'zz-teste-run-lixo'").fetchone() is None  # antes o unlock confirmava a carga pela metade
    assert _stamp(rw, ds) is None
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (ds,)).fetchone()["ok"]
    assert got
    conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


def test_erro_de_sql_dentro_do_job_fecha_o_run_failed_e_solta_o_lock(rw, ds, conn):
    import psycopg

    with pytest.raises(psycopg.Error):
        with D.run(rw, ds, SRC):
            rw.execute("select * from zz_tabela_que_nao_existe")  # deixa a transação abortada
    (row,) = _runs(rw, ds)
    assert row["status"] == "failed"
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (ds,)).fetchone()["ok"]
    assert got
    conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


def test_notas_tem_teto(rw, ds):
    with D.run(rw, ds, SRC) as r:
        for i in range(D.MAX_NOTES + 20):
            r.note(f"n{i}")
            r.reject(1, f"r{i}")
    (row,) = _runs(rw, ds)
    assert len(row["notes"].split("\n")) == D.MAX_NOTES and row["rows_rejected"] == D.MAX_NOTES + 20


def test_skip_registra_versao_e_nao_tem_erro(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a"):
        pass
    with pytest.raises(D.SkipUnchanged):
        with D.run(rw, ds, SRC, input_checksum="a"):
            pass
    pulado = _runs(rw, ds)[1]
    assert pulado["error"] is None and pulado["code_version"] == D.code_version()


# ---- leitores de status: agenda e cobertura

def test_agenda_alerta_run_partial_so_da_propria_chamada(rw, ds, monkeypatch):
    from civico_etl import schedule as S

    monkeypatch.setenv("ETL_INVOCATION", "zz-chamada-1")
    with D.run(rw, ds + ".despesasapi", SRC) as r:  # nome fora de qualquer prefixo de tarefa: entra pelo id da chamada
        r.partial("retido A")
        r.partial("retido B")
    with D.run(rw, ds + ".ok", SRC):
        pass
    monkeypatch.setenv("ETL_INVOCATION", "zz-chamada-2")  # outra chamada (Mac) rodando ao mesmo tempo
    with D.run(rw, ds + ".mac", SRC) as r:
        r.partial("retido no Mac")
    monkeypatch.delenv("ETL_INVOCATION")
    with D.run(rw, ds + ".manual", SRC) as r:  # rodado à mão: de chamada nenhuma
        r.partial("retido à mão")
    (p,) = S.partial_runs(rw, "zz-chamada-1")
    assert (p["dataset"], p["why"]) == (ds + ".despesasapi", "retido A; retido B")
    assert S.partial_runs(rw, "zz-chamada-3") == []
    rep = S.Report(started_at="2026-01-01T00:00:00+00:00", partial=[p])
    assert rep.alert and f"PARCIAL {ds}.despesasapi: retido A; retido B" in rep.text()
    assert not S.Report(started_at="2026-01-01T00:00:00+00:00").alert


def test_carimbo_de_run_partial_nao_deixa_a_tarefa_em_dia(rw, ds):
    from datetime import date, datetime, timedelta, timezone

    from civico_etl import schedule as S

    task = S.Task("zz.tarefa", lambda d: ["zz"], (ds,), every_h=24 * 80, timeout_h=1)
    now = datetime.now(timezone.utc) + timedelta(seconds=5)
    with D.run(rw, ds, SRC):
        pass
    limpo = S.last_stamp(rw, task, date.today(), clean=True)
    assert limpo is not None and not S.is_due(task, limpo, None, now)[0]
    with D.run(rw, ds, SRC) as r:
        r.partial("retido")
    assert S.last_stamp(rw, task, date.today()) > limpo  # o site vê o carimbo real: o dado entrou
    assert S.last_stamp(rw, task, date.today(), clean=True) is None  # a agenda não: a tarefa venceu
    assert S.is_due(task, None, None, now)[0]
    assert not S.is_due(task, None, now - timedelta(minutes=5), now)[0]  # mas respeita o intervalo de nova tentativa
    with D.run(rw, ds, SRC):
        pass
    assert S.last_stamp(rw, task, date.today(), clean=True) is not None


def test_falha_ao_fechar_o_run_vira_failed_e_desfaz_a_carga(rw, ds, conn, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("carimbo falhou")

    monkeypatch.setattr(D, "_stamp", boom)
    with pytest.raises(RuntimeError, match="carimbo falhou"):
        with D.run(rw, ds, SRC) as r:
            r.add(2)
            rw.execute("insert into sources (slug, name, url) values ('zz-teste-run-lixo', 'x', 'https://example.invalid/')")
    (row,) = _runs(rw, ds)
    assert row["status"] == "failed" and row["error"] == "RuntimeError: carimbo falhou" and row["rows_upserted"] == 2
    assert rw.execute("select 1 from sources where slug = 'zz-teste-run-lixo'").fetchone() is None
    got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (ds,)).fetchone()["ok"]
    assert got
    conn.execute("select pg_advisory_unlock(hashtext(%s))", (ds,))


def test_partial_seguido_de_falha_guarda_o_motivo_nas_notas(rw, ds):
    with pytest.raises(ValueError):
        with D.run(rw, ds, SRC) as r:
            r.note("nota")
            r.partial("exclusão retida")
            raise ValueError("boom")
    (row,) = _runs(rw, ds)
    assert (row["status"], row["error"], row["notes"]) == ("failed", "ValueError: boom", "parcial antes de fechar: exclusão retida\nnota")


def test_force_depois_de_partial_roda(rw, ds):
    with D.run(rw, ds, SRC, input_checksum="a") as r:
        r.partial("retido")
    with D.run(rw, ds, SRC, input_checksum="a", force=True):
        pass
    assert [x["status"] for x in _runs(rw, ds)] == ["partial", "succeeded"]


def test_notas_gravadas_em_error_por_codigo_antigo_passam_para_notes(rw, ds):
    from civico_etl import schedule as S

    src = D.source_id(rw, SRC)
    for status, err in (("succeeded", "nota antiga"), ("failed", "ValueError: x"), ("skipped_unchanged", "sem legislatura vigente"), ("partial", "retido")):
        rw.execute("insert into ingest_runs (source_id, dataset, status, error, finished_at) values (%s, %s, %s, %s, now())", (src, ds, status, err))
    rw.commit()
    assert S.move_legacy_notes(rw, ds) == 1  # só este dataset: o teste não mexe em run alheio do banco compartilhado
    assert S.move_legacy_notes(rw, ds) == 0  # repetível
    rw.commit()
    got = {x["status"]: (x["error"], x["notes"]) for x in _runs(rw, ds)}
    assert got == {"succeeded": (None, "nota antiga"), "failed": ("ValueError: x", None), "skipped_unchanged": ("sem legislatura vigente", None), "partial": ("retido", None)}
