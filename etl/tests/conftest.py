"""Fixtures do ETL. Testes de banco usam ETL_DATABASE_URL e são pulados se o Postgres local não responder."""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session")
def conn():
    psycopg = pytest.importorskip("psycopg")
    from psycopg.rows import dict_row

    url = os.environ.get("ETL_DATABASE_URL") or "postgres://postgres@localhost:54329/civico"
    try:
        c = psycopg.connect(url, row_factory=dict_row, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as e:  # sem banco: só os testes puros rodam
        pytest.skip(f"banco indisponível: {e}")
    c.execute("set search_path = public, extensions")
    yield c
    c.close()
