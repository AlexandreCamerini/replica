"""D173: `sessions.starts_at` da Câmara. `camara.presenca` grava o início oficial; `camara.diario` (hora do primeiro voto) só preenche quando está nulo."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from civico_etl.jobs.camara_diario import upsert_sessions

JOBS = Path(__file__).resolve().parents[1] / "civico_etl" / "jobs"
BRT = timezone(timedelta(hours=-3))
OFICIAL = datetime(2026, 10, 28, 13, 55, tzinfo=BRT)
PRIMEIRO_VOTO = datetime(2026, 10, 28, 14, 34, tzinfo=BRT)


class _Rollback(Exception):
    pass


def _row(body: str, key: str, ts: datetime):
    return (body, "plenario", False, "encerrada", ts, None, key)


def test_diario_nao_sobrescreve_horario_existente_e_ainda_devolve_o_id(conn):
    body = conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"]
    key = "teste-final-d173"
    with pytest.raises(_Rollback):
        with conn.transaction():
            # presenca grava o início oficial
            conn.execute("insert into sessions (body_id, kind, is_deliberative, status, starts_at, source_key) values (%s, 'plenario', true, 'encerrada', %s, %s)", (body, OFICIAL, key))
            ids = upsert_sessions(conn, str(body), [_row(str(body), key, PRIMEIRO_VOTO)])
            got = conn.execute("select id, starts_at, is_deliberative from sessions where body_id = %s and source_key = %s", (body, key)).fetchone()
            assert got["starts_at"] == OFICIAL  # o diário não rebaixa para 14:34
            assert got["is_deliberative"] is True
            assert ids == {key: str(got["id"])}  # mesmo sem UPDATE, o id volta (os votos dependem dele)
            raise _Rollback


def test_diario_preenche_quando_nao_existe(conn):
    body = conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"]
    key = "teste-final-d173-novo"
    with pytest.raises(_Rollback):
        with conn.transaction():
            ids = upsert_sessions(conn, str(body), [_row(str(body), key, PRIMEIRO_VOTO)])
            got = conn.execute("select id, starts_at from sessions where body_id = %s and source_key = %s", (body, key)).fetchone()
            assert got["starts_at"] == PRIMEIRO_VOTO
            assert ids == {key: str(got["id"])}
            raise _Rollback


def test_presenca_sobrescreve_starts_at_do_diario(conn):
    """Presença roda depois do diário e vence: o upsert dela atualiza starts_at sem condição."""
    src = (JOBS / "camara_presenca.py").read_text()
    m = re.search(r'update=\[[^\]]*"starts_at"[^\]]*\]', src)
    assert m, "camara.presenca precisa atualizar starts_at"
    assert "starts_at is null" not in src
    assert 'where="sessions.starts_at is null"' in (JOBS / "camara_diario.py").read_text()
