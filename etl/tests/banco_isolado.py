"""Banco isolado por sessão para testes de caracterização (critério R-2).

Por que existe: `db.run` grava `ingest_runs` e `dataset_stamps` COM commit. Rodar um coletor pela CLI contra o banco da suíte
(`conftest.database_url()`) suja esse banco e muda o resultado de outros testes. Aqui cada sessão de pytest cria o seu banco,
`<banco da suíte>_iso_<pid>`, no mesmo servidor, e o apaga no fim.

Passos (qualquer falha derruba o teste com pytest.fail; esta fixture nunca faz skip):
  1. varre bancos órfãos `<banco>_iso_<n>` cujo PID `n` não existe mais (nunca toca em banco sem esse sufixo numérico);
  2. cria `<banco>_iso_<pid>` pelo banco de manutenção `postgres`;
  3. `db/migrate.sh --local` (precisa de `psql` e `shasum` no PATH), `run_seed` e `tests/fixtures/base.sql` (a mesma receita do job `etl` do CI);
  4. devolve a URL do banco novo; no `finally` fecha o que abriu e apaga o banco (`drop database ... with (force)`).

Uso (a fixture não está no conftest: importe-a no arquivo de teste):
    from banco_isolado import banco_isolado  # noqa: F401
"""

from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest
from conftest import database_url

ETL_DIR = Path(__file__).resolve().parent.parent
REPO = ETL_DIR.parent
MIGRATE = REPO / "db" / "migrate.sh"
BASE_SQL = Path(__file__).resolve().parent / "fixtures" / "base.sql"

#: segundos que a última criação do banco isolado levou (migração + seed + base.sql); None até a fixture rodar
TEMPO_CRIACAO_S: float | None = None


def _com_banco(url: str, nome: str) -> str:
    p = urlparse(url)
    return urlunparse(p._replace(path="/" + nome))


def _pid_vivo(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # existe, só não é nosso
    return True


def _rodar(cmd: list[str], url: str, etapa: str) -> None:
    env = {**os.environ, "DATABASE_URL": url, "ETL_DATABASE_URL": url}
    try:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=600, cwd=REPO)
    except FileNotFoundError as e:
        pytest.fail(f"banco isolado: {etapa} precisa de `{cmd[0]}` no PATH ({e})", pytrace=False)
    except subprocess.TimeoutExpired:
        pytest.fail(f"banco isolado: {etapa} passou de 600 s", pytrace=False)
    if r.returncode != 0:
        pytest.fail(f"banco isolado: {etapa} falhou (código {r.returncode})\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}", pytrace=False)


@pytest.fixture(scope="session")
def banco_isolado():
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    global TEMPO_CRIACAO_S
    suite = database_url()  # a guarda de host local continua valendo
    base = (urlparse(suite).path or "/").lstrip("/")
    if not base:
        pytest.fail("banco isolado: a URL da suíte não nomeia um banco", pytrace=False)
    nome = f"{base}_iso_{os.getpid()}"
    url = _com_banco(suite, nome)
    padrao = re.compile(rf"^{re.escape(base)}_iso_(\d+)$")
    t0 = time.monotonic()
    criado = False
    try:
        try:
            adm = psycopg.connect(_com_banco(suite, "postgres"), autocommit=True, connect_timeout=5)
        except psycopg.Error as e:
            pytest.fail(f"banco isolado: sem conexão com o banco de manutenção `postgres`: {e}", pytrace=False)
        with adm:
            for (dn,) in adm.execute("select datname from pg_database where datname like %s", (base.replace("_", r"\_") + r"\_iso\_%",)).fetchall():
                m = padrao.match(dn)
                # só apaga o que casa exatamente com <banco>_iso_<número> e cujo dono (PID) não existe mais; o do próprio PID é resto de um processo com PID reaproveitado
                if m and (int(m.group(1)) == os.getpid() or not _pid_vivo(int(m.group(1)))):
                    adm.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dn)))
            adm.execute(sql.SQL("create database {}").format(sql.Identifier(nome)))
            criado = True
        _rodar(["bash", str(MIGRATE), "--local"], url, "db/migrate.sh --local")
        try:
            from civico_etl.jobs.seed import run_seed

            with psycopg.connect(url, row_factory=dict_row, autocommit=False) as c:
                c.execute("set search_path = public, extensions")
                c.execute("set timezone = 'UTC'")
                run_seed(c)
        except Exception as e:  # noqa: BLE001
            pytest.fail(f"banco isolado: seed falhou: {type(e).__name__}: {e}", pytrace=False)
        _rodar(["psql", url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(BASE_SQL)], url, "etl/tests/fixtures/base.sql")
        TEMPO_CRIACAO_S = time.monotonic() - t0
        yield url
    finally:
        if criado:
            try:
                with psycopg.connect(_com_banco(suite, "postgres"), autocommit=True, connect_timeout=5) as adm:
                    adm.execute(sql.SQL("drop database if exists {} with (force)").format(sql.Identifier(nome)))
            except psycopg.Error as e:
                print(f"AVISO: não consegui apagar o banco isolado {nome}: {e}")
