"""FABRICADO. F3-T4: SIGTERM/SIGINT no laço do executor (replica/reavaliacao-central-e-dominio.md, F5: "container morto -> pedido interrompido em até 120 s").

Sem rede e sem skip. O executor roda num SUBPROCESSO que o teste inicia, contra o banco isolado (`banco_isolado`); `_despachar` é trocado por uma espera longa (o "coletor lento"),
então o que se prova é o laço, o tratador e `executar_um` reais. Nada é gravado no banco da suíte; os pedidos são apagados em `finally`.
"""

from __future__ import annotations

import os
import select
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row

from civico_etl.admin import executor as EX

ETL_DIR = Path(__file__).resolve().parent.parent
LIMITE_SAIDA_S = 10.0  # o pedido tem de estar interrompido e o processo morto bem antes dos 120 s do órfão

FILHO = textwrap.dedent(
    """
    import sys, time
    from civico_etl import db
    from civico_etl.admin import executor as EX

    def lento(conn, tabela, pedido_id, runner):
        print("EXECUTANDO", flush=True)
        time.sleep(120)

    if sys.argv[1] == "lento":
        EX._despachar = lento
    print("PRONTO", flush=True)
    EX.laco(db.connect, intervalo=0.2, batimento_s=0.3, aviso=lambda m: print(m, file=sys.stderr, flush=True))
    print("SAIU", flush=True)
    """
)


def _limpar(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_pedidos_decisao", "adm_pedidos"):
            c.execute(f"delete from {t}")  # noqa: S608


@pytest.fixture
def url(banco_isolado):  # noqa: F811
    _limpar(banco_isolado)
    try:
        yield banco_isolado
    finally:
        _limpar(banco_isolado)


def _pedir(url: str, n: int) -> str:
    with psycopg.connect(url, row_factory=dict_row) as c:
        p, _ = EX.pedir(c, "parecer", {"pendencia_id": f"0a1b2c3d-0000-4000-8000-{n:012d}"})
        c.commit()
    return str(p["id"])


def _pedido(url: str, id_: str) -> dict:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return c.execute("select status, erro, batimento_em, finalizado_em from adm_pedidos where id = %s", (id_,)).fetchone()


def _iniciar(url: str, modo: str) -> subprocess.Popen:
    env = {**os.environ, "ETL_DATABASE_URL": url, "DATABASE_URL": url, "PYTHONUNBUFFERED": "1"}
    return subprocess.Popen([sys.executable, "-c", FILHO, modo], cwd=ETL_DIR, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def _esperar_linha(proc: subprocess.Popen, alvo: str, limite_s: float = 30.0) -> None:
    fim = time.monotonic() + limite_s
    while time.monotonic() < fim:
        pronto, _, _ = select.select([proc.stdout], [], [], 0.5)
        if pronto:
            linha = proc.stdout.readline()
            if alvo in linha:
                return
            if linha == "" and proc.poll() is not None:
                break
    proc.kill()
    pytest.fail(f"o subprocesso não imprimiu {alvo!r}: {proc.stderr.read()[-500:]}", pytrace=False)


def _esperar_status(url: str, id_: str, status: str, limite_s: float = 15.0) -> dict:
    fim = time.monotonic() + limite_s
    while time.monotonic() < fim:
        p = _pedido(url, id_)
        if p["status"] == status:
            return p
        time.sleep(0.1)
    pytest.fail(f"o pedido não chegou a {status!r}: {_pedido(url, id_)}", pytrace=False)


@pytest.mark.parametrize("sinal", [signal.SIGTERM, signal.SIGINT])
def test_sinal_com_pedido_em_execucao_marca_interrompido_e_sai_com_zero(url, sinal):
    em_execucao = _pedir(url, 1)
    na_fila = None
    proc = _iniciar(url, "lento")
    try:
        _esperar_linha(proc, "EXECUTANDO")
        na_fila = _pedir(url, 2)  # chega depois: o executor está ocupado e não pode pegá-lo
        antes = _esperar_status(url, em_execucao, "em_execucao")
        assert antes["batimento_em"] is not None
        t0 = time.monotonic()
        proc.send_signal(sinal)
        proc.wait(timeout=LIMITE_SAIDA_S)
        assert time.monotonic() - t0 < LIMITE_SAIDA_S
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    erros = proc.stderr.read()
    assert proc.returncode == 0, erros
    p = _pedido(url, em_execucao)
    assert p["status"] == "interrompido" and p["finalizado_em"] is not None
    assert p["erro"] == f"executor encerrado ({sinal.name})"
    assert _pedido(url, na_fila)["status"] == "na_fila"  # não pegou pedido novo
    # o batimento parou: o valor não muda depois da saída
    b = p["batimento_em"]
    time.sleep(0.8)
    assert _pedido(url, em_execucao)["batimento_em"] == b


def test_sinal_sem_pedido_em_execucao_sai_na_hora(url):
    proc = _iniciar(url, "ocioso")
    try:
        _esperar_linha(proc, "PRONTO")
        time.sleep(1.0)  # o laço está no `parar.wait`
        t0 = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=LIMITE_SAIDA_S)
        assert time.monotonic() - t0 < 3.0
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
    assert proc.returncode == 0, proc.stderr.read()


def test_tratadores_anteriores_voltam_ao_sair_do_laco(url):
    antes = (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT))
    with psycopg.connect(url, row_factory=dict_row) as c:
        assert EX.laco(lambda: c, uma_vez=True) is None  # fila vazia
    assert (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)) == antes
