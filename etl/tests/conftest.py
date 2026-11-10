"""Fixtures da suite.

`conn`: banco de teste. Sem banco, só os testes puros rodam (skip "banco indisponível"); o CI trata esse skip como falha.
`carga`: para regressões que conferem dado real (governadores, cota, identidade). Num banco só migrado (CI) pulam com "banco sem carga".
`rw`: conexão própria, com commit de verdade, para o que não cabe em transação revertida (db.run faz commit). Quem usa limpa o que gravou.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import pytest

LOCAL_URL = "postgres://postgres@localhost:54329/civico"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}  # "" = socket Unix


def database_url() -> str:
    """URL do banco de teste. Host que não é local só com ETL_TEST_ALLOW_REMOTE=1: a suite grava e apaga linhas."""
    url = os.environ.get("ETL_DATABASE_URL") or LOCAL_URL
    host = urlparse(url).hostname or ""
    if host not in LOCAL_HOSTS and os.environ.get("ETL_TEST_ALLOW_REMOTE") != "1":
        pytest.exit(f"ETL_DATABASE_URL aponta para {host}, que não é local; a suite não roda contra banco remoto (ETL_TEST_ALLOW_REMOTE=1 libera)", returncode=2)
    return url


@pytest.fixture(scope="session")
def conn():
    psycopg = pytest.importorskip("psycopg")
    from psycopg.rows import dict_row

    try:
        c = psycopg.connect(database_url(), row_factory=dict_row, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as e:  # sem banco: só os testes puros rodam
        pytest.skip(f"banco indisponível: {e}")
    c.execute("set search_path = public, extensions")
    yield c
    c.close()


@pytest.fixture(scope="session")
def carga(conn):
    if not conn.execute("select 1 from places where kind = 'municipio' limit 1").fetchone():
        pytest.skip("banco sem carga: regressão sobre dado real")


@pytest.fixture
def rw(conn):
    """Conexão como a de db.connect (autocommit desligado). `conn` vem primeiro só para herdar o skip sem banco."""
    import psycopg
    from psycopg.rows import dict_row

    c = psycopg.connect(database_url(), row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    yield c
    c.rollback()
    c.close()
