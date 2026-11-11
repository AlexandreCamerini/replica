"""Regressão das otimizações de escrita (PR da revisão independente de 2026-11-10).

`db.upsert` só reescreve a linha que mudou quando ninguém pede RETURNING; `sync_party_memberships` só mexe no que difere.
Reescrever linha igual deixava de 3 a 128 versões mortas por linha (person_period_stats: 65 mi de updates para 510 mil linhas).
A prova é o ctid: linha reescrita ganha outro ctid dentro da mesma transação. Tudo roda em transação revertida.
"""

from __future__ import annotations

import pytest

from civico_etl.db import upsert
from civico_etl.jobs.derive_stats import sync_party_memberships

COLS = ["k", "a", "b"]


def _ctids(conn, table: str = "tu") -> list[str]:
    return [r["c"] for r in conn.execute(f"select ctid::text c from {table} order by k").fetchall()]


@pytest.fixture
def tu(conn):
    with conn.transaction(force_rollback=True):
        conn.execute("create temp table tu (k int primary key, a text, b int, tags text[], j jsonb, updated_at timestamptz default now())")
        yield conn


def test_linha_igual_nao_e_reescrita(tu):
    upsert(tu, "tu", COLS, [(1, "x", 1), (2, "y", None)], ["k"])
    antes = _ctids(tu)
    upsert(tu, "tu", COLS, [(1, "x", 1), (2, "y", None)], ["k"])
    assert _ctids(tu) == antes


def test_so_a_linha_que_mudou_e_reescrita(tu):
    upsert(tu, "tu", COLS, [(1, "x", 1), (2, "y", None)], ["k"])
    antes = _ctids(tu)
    upsert(tu, "tu", COLS, [(1, "x", 9), (2, "y", None)], ["k"])
    depois = _ctids(tu)
    assert depois[0] != antes[0] and depois[1] == antes[1]
    assert tu.execute("select b from tu where k = 1").fetchone()["b"] == 9


def test_null_para_valor_e_valor_para_null_sao_gravados(tu):
    upsert(tu, "tu", COLS, [(1, "x", None)], ["k"])
    upsert(tu, "tu", COLS, [(1, "x", 5)], ["k"])
    assert tu.execute("select b from tu").fetchone()["b"] == 5
    upsert(tu, "tu", COLS, [(1, "x", None)], ["k"])
    assert tu.execute("select b from tu").fetchone()["b"] is None


def test_array_e_jsonb_iguais_nao_reescrevem_e_diferentes_gravam(tu):
    cols = ["k", "tags", "j"]
    upsert(tu, "tu", cols, [(1, ["a", "b"], '{"x": 1, "y": 2}')], ["k"])
    antes = _ctids(tu)
    upsert(tu, "tu", cols, [(1, ["a", "b"], '{"y": 2, "x": 1}')], ["k"])  # jsonb não liga para a ordem das chaves
    assert _ctids(tu) == antes
    upsert(tu, "tu", cols, [(1, ["b", "a"], '{"y": 2, "x": 1}')], ["k"])  # a ordem do array conta
    assert _ctids(tu) != antes


def test_com_returning_devolve_todas_as_linhas_mesmo_sem_mudanca(tu):
    upsert(tu, "tu", COLS, [(1, "x", 1), (2, "y", 2)], ["k"])
    out = upsert(tu, "tu", COLS, [(1, "x", 1), (2, "y", 2)], ["k"], returning=["k"])
    assert sorted(r["k"] for r in out) == [1, 2]


def test_where_do_chamador_prevalece(tu):
    upsert(tu, "tu", COLS, [(1, "x", 1)], ["k"])
    antes = _ctids(tu)
    # valor novo, mas o where do chamador veta: não grava
    upsert(tu, "tu", COLS, [(1, "x", 7)], ["k"], where="tu.b is null")
    assert _ctids(tu) == antes and tu.execute("select b from tu").fetchone()["b"] == 1


def test_chave_igual_a_todas_as_colunas_sem_returning_nao_reescreve(tu):
    upsert(tu, "tu", ["k"], [(1,), (2,)], ["k"])
    antes = _ctids(tu)
    upsert(tu, "tu", ["k"], [(1,), (2,)], ["k"])
    assert _ctids(tu) == antes
    out = upsert(tu, "tu", ["k"], [(1,), (2,)], ["k"], returning=["k"])  # com returning continua devolvendo
    assert len(out) == 2


def test_sync_party_memberships_so_mexe_no_que_difere(conn):
    n = conn.execute("select count(*) n from party_memberships").fetchone()["n"]
    if n < 10:
        pytest.skip("banco sem carga")
    with conn.transaction(force_rollback=True):
        conn.execute("create temp table tmp_pm on commit drop as select person_id, party_id, from_on, to_on from party_memberships")
        cur = conn.cursor()
        assert sync_party_memberships(cur) == (n, 0, 0)  # já igual: nada a fazer

        # uma pessoa troca de partido: a filiação aberta ganha to_on e nasce outra a partir daí
        r = conn.execute("select person_id, party_id, from_on from party_memberships where to_on is null order by person_id limit 1").fetchone()
        outro = conn.execute("select id from parties where id <> %s limit 1", (r["party_id"],)).fetchone()["id"]
        conn.execute("update tmp_pm set to_on = from_on + 10 where person_id = %s and from_on = %s", (r["person_id"], r["from_on"]))
        conn.execute("insert into tmp_pm values (%s, %s, %s::date + 10, null)", (r["person_id"], outro, r["from_on"]))
        assert sync_party_memberships(cur) == (n + 1, 2, 1)  # 1 removida (a aberta) e 2 novas (a fechada e a nova): 3 linhas tocadas de 139 mil

        # o resultado é exatamente tmp_pm
        dif = conn.execute("""select count(*) n from ((select person_id, party_id, from_on, to_on from party_memberships except select * from tmp_pm)
                              union all (select * from tmp_pm except select person_id, party_id, from_on, to_on from party_memberships)) x""").fetchone()["n"]
        assert dif == 0
        assert sync_party_memberships(cur) == (n + 1, 0, 0)  # idempotente
