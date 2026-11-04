"""D245: identity.repairs (rotina) roda só os reparos que a carga ainda não faz, em ordem fixa, idempotente e sem apagar fato.
Também cobre o que a análise levou para a carga: o identity.dedupe não funde mais por nascimento igual sem nome em comum
(Eli Corrêa x Geninho, BUG-033) e o TSE carrega do ano mais novo para o mais antigo."""

from __future__ import annotations

import re
from datetime import date

import pytest

from civico_etl.jobs import repairs
from civico_etl.jobs.identity_dedupe import PAIRS_SQL
from civico_etl.jobs.tse_candidatos import load_order


# ---------- ordem e contrato ----------

def test_ordem_fixa_e_documentada():
    names = [n for n, _ in repairs.STEPS]
    assert names == ["titulos"]
    # o docstring numera os passos na mesma ordem
    doc = [m for m in re.findall(r"^\s+\d+\. `([a-z_]+)`", repairs.__doc__, re.M)]
    assert doc == names


def test_legado_nao_entra_na_rotina():
    names = {n for n, _ in repairs.STEPS}
    for job in repairs.legacy():
        assert job not in names
    assert set(repairs.legacy()) == {"tse.fix019", "tse.fix032", "tse.fix035", "identity.fix033", "identity.fix038", "identity.fix041"}


class _FakeConn:
    def __init__(self):
        self.rollbacks = 0

    def rollback(self):
        self.rollbacks += 1


def test_roda_em_ordem_e_repassa_apply(monkeypatch):
    calls = []

    def mk(name, n):
        def step(conn, *, apply):
            calls.append((name, apply))
            return n
        return step

    monkeypatch.setattr(repairs, "STEPS", (("a", mk("a", 3)), ("b", mk("b", 0)), ("c", mk("c", 1))))
    assert repairs.run_identity_repairs(_FakeConn(), apply=False) == {"a": 3, "b": 0, "c": 1}
    assert calls == [("a", False), ("b", False), ("c", False)]
    calls.clear()
    repairs.run_identity_repairs(_FakeConn(), apply=True)
    assert calls == [("a", True), ("b", True), ("c", True)]


def test_falha_para_os_passos_seguintes(monkeypatch):
    calls = []

    def ok(conn, *, apply):
        calls.append("ok")
        return 0

    def boom(conn, *, apply):
        calls.append("boom")
        raise RuntimeError("fonte indisponível")

    def depois(conn, *, apply):
        calls.append("depois")
        return 0

    monkeypatch.setattr(repairs, "STEPS", (("ok", ok), ("boom", boom), ("depois", depois)))
    c = _FakeConn()
    with pytest.raises(RuntimeError):
        repairs.run_identity_repairs(c, apply=True)
    assert calls == ["ok", "boom"] and c.rollbacks == 1


def test_carga_do_tse_do_ano_mais_novo_para_o_mais_antigo():
    assert load_order([2018, 2026, 2012, 2026, 2020]) == [2026, 2020, 2018, 2012]


# ---------- banco (transação desfeita) ----------

TIT = "999999999917"  # título fictício, fora de qualquer fonte


def _row(sq: str, result: str = "ELEITO", year: int = 2024) -> tuple:
    return (TIT, year, "99999", sq, "ordinaria", "SP", "vereador", result, "TESTE REPARO DA SILVA", date(1980, 1, 1), 12345)


def _person(conn, slug: str, civil: str, display: str, birth: date) -> str:
    return str(conn.execute("insert into people (slug, display_name, civil_name, birth_date) values (%s, %s, %s, %s) returning id",
                            (slug, display, civil, birth)).fetchone()["id"])


def test_titulos_idempotente_e_nao_destrutivo(conn):
    src = {"rows": [_row("1"), _row("2", "SUPLENTE")]}

    def source(titles):
        assert TIT in titles
        return [r for r in src["rows"] if r[0] in titles]

    def n_rows():
        return conn.execute("select count(*) n from tse_titulo_candidatura where titulo = %s", (TIT,)).fetchone()["n"]

    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-reparo-titulos", "Teste Reparo da Silva", "Teste Reparo", date(1980, 1, 1))
        conn.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                        select %s, id, %s, 'exact_id', 1.0 from sources where slug = 'tse-titulo'""", (pid, TIT))
        run = lambda apply: repairs.sync_titles(conn, apply=apply, source=source, commit=False)  # noqa: E731
        assert run(False) == 2 and n_rows() == 0  # dry-run não grava
        assert run(True) == 2 and n_rows() == 2
        assert run(True) == 0 and run(False) == 0  # segunda execução: 0 mudanças
        src["rows"][1] = _row("2", "ELEITO POR QP")  # a fonte mudou uma coluna
        assert run(False) == 1 and run(True) == 1 and run(True) == 0
        src["rows"] = src["rows"][:1]  # a fonte não tem mais a linha 2: fica no banco
        assert run(True) == 0 and n_rows() == 2


def _seat(conn) -> tuple[str, str]:
    o = conn.execute("select id from offices where slug = 'deputado_federal'").fetchone()["id"]
    p = conn.execute("select id from places where kind = 'uf' and uf = 'SP'").fetchone()["id"]
    return str(o), str(p)


def _mandate(conn, pid: str, seat: tuple[str, str], source: str) -> None:
    conn.execute("""insert into mandates (person_id, office_id, place_id, status, started_on, ends_on, status_source)
                    values (%s, %s, %s, 'encerrado', '2019-02-01', '2023-02-01', %s)""", (pid, *seat, source))


def _pairs(conn, ids: set[str]) -> set[tuple[str, str]]:
    return {(str(r["keep"]), str(r["drop_"])) for r in conn.execute(PAIRS_SQL) if {str(r["keep"]), str(r["drop_"])} & ids}


def test_dedupe_nao_funde_nascimento_igual_sem_nome_em_comum(conn):
    """Eli Corrêa Filho e Geninho Zuliani: 13/01/1976, deputados por SP desde 01/02/2019. Pela regra antiga do dedupe
    (nascimento igual OU nome parlamentar igual) virariam uma pessoa se chegassem separados (TSE x Câmara)."""
    with conn.transaction(force_rollback=True):
        seat = _seat(conn)
        a = _person(conn, "teste-dedupe-geninho", "Eugenio José Zuliani", "Geninho Zuliani", date(1976, 1, 13))
        b = _person(conn, "teste-dedupe-eli", "Adriano Eli Corrêa", "Eli Corrêa Filho", date(1976, 1, 13))
        _mandate(conn, a, seat, "tse")
        _mandate(conn, b, seat, "camara")
        assert _pairs(conn, {a, b}) == set()


def test_dedupe_nao_funde_pai_e_filho_de_mesmo_nome(conn):
    with conn.transaction(force_rollback=True):
        seat = _seat(conn)
        a = _person(conn, "teste-dedupe-atila-filho", "Átila de Melo Lira", "Átila Lira", date(1975, 5, 5))
        b = _person(conn, "teste-dedupe-atila-pai", "Átila Freitas Lira", "Átila Lira", date(1947, 4, 7))
        _mandate(conn, a, seat, "tse")
        _mandate(conn, b, seat, "camara")
        assert _pairs(conn, {a, b}) == set()


def test_dedupe_funde_a_mesma_pessoa(conn):
    with conn.transaction(force_rollback=True):
        seat = _seat(conn)
        a = _person(conn, "teste-dedupe-tse", "Fulano Beltrano de Tal", "Fulano Beltrano", date(1970, 3, 3))
        b = _person(conn, "teste-dedupe-casa", "Fulano Beltrano de Tal", "Fulano do Povo", date(1970, 3, 3))
        _mandate(conn, a, seat, "tse")
        _mandate(conn, b, seat, "camara")
        assert _pairs(conn, {a, b}) == {(a, b)}
