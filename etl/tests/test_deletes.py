"""Caminhos de DELETE dos jobs de rotina (auditoria A6): o que sai, o que fica e o que hoje sai sem guarda.

Tudo em transação revertida, em escopo que a carga real não usa (ano 1901, prefixo `cotazz`). Os testes marcados "HOJE" fixam o
comportamento atual sem guarda de volume (auditoria M1); a política de exclusão do módulo de ETL (Run.replace_scope) vai invertê-los.
"""

from __future__ import annotations

from datetime import date

from civico_etl.db import Run
from civico_etl.jobs import assembleias as A
from civico_etl.jobs import camara_diario as C
from civico_etl.jobs import tse_candidatos as T

ANO = 1901


def _person(conn, tag: str) -> str:
    return str(conn.execute("insert into people (slug, display_name) values (%s, %s) returning id", (f"zz-teste-del-{tag}", f"Teste Delete {tag}")).fetchone()["id"])


def _camara(conn) -> str:
    return str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])


def _keys(conn, body: str, like: str) -> set[str]:
    return {r["source_key"] for r in conn.execute("select source_key from expenses where body_id = %s and source_key like %s", (body, like))}


# ---- camara_diario._write_year (cota): apaga o que o arquivo do ano não traz mais, só do mesmo prefixo ----

def _cota(pid, body, key, cents=1000):
    return (pid, body, date(ANO, 3, 1), "Teste", "Fornecedor", None, cents, "BRL", None, key)


def test_cota_tira_o_que_saiu_do_arquivo_e_nao_toca_outro_prefixo(conn):
    with conn.transaction(force_rollback=True):
        body, pid = _camara(conn), _person(conn, "cota")
        C._write_year(conn, body, "cotazz1902", [_cota(pid, body, "cotazz1902:1:a")])
        assert C._write_year(conn, body, "cotazz1901", [_cota(pid, body, f"cotazz1901:1:{k}") for k in "abc"]) == 3
        C._write_year(conn, body, "cotazz1901", [_cota(pid, body, f"cotazz1901:1:{k}", 2000) for k in "ab"])
        assert _keys(conn, body, "cotazz1901:%") == {"cotazz1901:1:a", "cotazz1901:1:b"}
        assert _keys(conn, body, "cotazz1902:%") == {"cotazz1902:1:a"}  # outro ano fica
        valores = {r["amount_cents"] for r in conn.execute("select amount_cents from expenses where body_id = %s and source_key like 'cotazz1901:%%'", (body,))}
        assert valores == {2000}  # o que ficou foi atualizado, não duplicado


def test_cota_HOJE_lote_vazio_apaga_o_ano_inteiro(conn):
    with conn.transaction(force_rollback=True):
        body, pid = _camara(conn), _person(conn, "cota-vazio")
        C._write_year(conn, body, "cotazz1901", [_cota(pid, body, f"cotazz1901:1:{k}") for k in "abc"])
        C._write_year(conn, body, "cotazz1901", [])
        assert _keys(conn, body, "cotazz1901:%") == set()


# ---- assembleias.write_expenses / write_proposals: substituem o ano da Assembleia ----

def _assembly(conn) -> A.Assembly:
    return A.Assembly("ZZ", "zz-teste-ale", "Teste", "https://example.invalid/", None, body_id=_camara(conn))


def _verba(pid, dia: date, key, cents=500):
    return (pid, dia, "Teste", "Fornecedor", None, cents, None, key)


def test_verba_substitui_o_ano_e_nao_toca_ano_vizinho_nem_outra_casa(conn):
    with conn.transaction(force_rollback=True):
        a, pid = _assembly(conn), _person(conn, "verba")
        senado = conn.execute("select id from legislative_bodies where kind = 'senado'").fetchone()["id"]
        conn.execute("insert into expenses (person_id, body_id, occurred_on, category, amount_cents, source_key) values (%s, %s, %s, 'Teste', 1, 'zzale:senado')", (pid, senado, date(ANO, 5, 1)))
        A.write_expenses(conn, a, ANO + 1, [_verba(pid, date(ANO + 1, 1, 1), "zzale:1902:a")])
        A.write_expenses(conn, a, ANO, [_verba(pid, date(ANO, m, 1), f"zzale:1901:{m}") for m in (1, 2, 12)])
        A.write_expenses(conn, a, ANO, [_verba(pid, date(ANO, 1, 1), "zzale:1901:1")])
        assert _keys(conn, a.body_id, "zzale:%") == {"zzale:1901:1", "zzale:1902:a"}
        assert conn.execute("select 1 from expenses where source_key = 'zzale:senado'").fetchone()  # mesma data, outra casa


def test_verba_HOJE_lote_vazio_apaga_o_ano_da_casa(conn):
    with conn.transaction(force_rollback=True):
        a, pid = _assembly(conn), _person(conn, "verba-vazio")
        A.write_expenses(conn, a, ANO, [_verba(pid, date(ANO, m, 1), f"zzale:1901:{m}") for m in (1, 2)])
        A.write_expenses(conn, a, ANO, [])
        assert _keys(conn, a.body_id, "zzale:1901:%") == set()


def _autores(conn, body: str, number: int) -> set[str]:
    q = """select pa.person_id from proposal_authors pa join proposals p on p.id = pa.proposal_id
           where p.body_id = %s and p.type = 'PL' and p.number = %s and p.year = %s"""
    return {str(r["person_id"]) for r in conn.execute(q, (body, number, ANO))}


def _prop(number: int, authors: list[str]) -> A.PropRow:
    return A.PropRow("PL", number, ANO, f"Projeto de teste {number}", None, date(ANO, 2, 1), None, [(p, "principal") for p in authors])


def test_autoria_que_a_fonte_tirou_sai_e_a_proposta_fica(conn):
    with conn.transaction(force_rollback=True):
        a, ana, bia = _assembly(conn), _person(conn, "ana"), _person(conn, "bia")
        assert A.write_proposals(conn, a, ANO, [_prop(990001, [ana, bia])]) == (1, 2)
        A.write_proposals(conn, a, ANO, [_prop(990001, [ana])])
        assert _autores(conn, a.body_id, 990001) == {ana}
        assert conn.execute("select count(*) as n from proposals where body_id = %s and number = 990001 and year = %s", (a.body_id, ANO)).fetchone()["n"] == 1


def test_autoria_HOJE_proposta_ausente_do_lote_perde_as_autorias(conn):
    # A leitura parcial da fonte (ALMG: proposições "não recuperadas") deixa a proposta no banco sem autor nenhum.
    with conn.transaction(force_rollback=True):
        a, ana, bia = _assembly(conn), _person(conn, "ana2"), _person(conn, "bia2")
        A.write_proposals(conn, a, ANO, [_prop(990001, [ana]), _prop(990002, [bia])])
        A.write_proposals(conn, a, ANO, [_prop(990001, [ana])])
        assert _autores(conn, a.body_id, 990001) == {ana}
        assert _autores(conn, a.body_id, 990002) == set()
        assert conn.execute("select 1 from proposals where body_id = %s and number = 990002 and year = %s", (a.body_id, ANO)).fetchone()


def test_autoria_nao_toca_outro_ano(conn):
    with conn.transaction(force_rollback=True):
        a, ana = _assembly(conn), _person(conn, "ana3")
        outro = A.PropRow("PL", 990003, ANO + 1, "Projeto de outro ano", None, None, None, [(ana, "principal")])
        A.write_proposals(conn, a, ANO + 1, [outro])
        A.write_proposals(conn, a, ANO, [])
        n = conn.execute("select count(*) as n from proposal_authors pa join proposals p on p.id = pa.proposal_id where p.body_id = %s and p.year = %s", (a.body_id, ANO + 1)).fetchone()["n"]
        assert n == 1


# ---- tse_candidatos._drop_superseded: registro substituído sai com cópia inteira no log de reparo ----

def _candidatura(conn, pid: str, seq: str, election: str, contest: str) -> dict:
    return dict(conn.execute(
        """insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name, result)
           values (%s, %s, %s, %s, 'Teste', 'indeferido') returning *""", (contest, election, pid, seq)).fetchone())


def test_registro_substituido_sai_com_mandato_e_bens_e_fica_no_log(conn):
    with conn.transaction(force_rollback=True):
        office = conn.execute("select id from offices where slug = 'governador'").fetchone()["id"]
        place = conn.execute("select id from places where kind = 'uf' and uf = 'SP'").fetchone()["id"]
        election = conn.execute("insert into elections (year, round, kind, held_on) values (%s, 1, 'geral', %s) returning id", (ANO, date(ANO, 10, 1))).fetchone()["id"]
        contest = conn.execute("insert into contests (election_id, office_id, place_id) values (%s, %s, %s) returning id", (election, office, place)).fetchone()["id"]
        sai, fica = _person(conn, "sai"), _person(conn, "fica")
        velho = _candidatura(conn, sai, "999999990001", election, contest)
        novo = _candidatura(conn, fica, "999999990002", election, contest)
        for c, pid in ((velho, sai), (novo, fica)):
            conn.execute("insert into asset_declarations (person_id, candidacy_id, year, total_cents) values (%s, %s, %s, 100)", (pid, c["id"], ANO))
            conn.execute("""insert into mandates (person_id, office_id, place_id, candidacy_id, status, started_on, ends_on, status_source)
                            values (%s, %s, %s, %s, 'encerrado', %s, %s, 'teste')""", (pid, office, place, c["id"], date(ANO + 1, 1, 1), date(ANO + 5, 1, 1)))
        r = Run(conn, "tse.candidatos.1901", "tse")

        T._drop_superseded(conn, r, [velho], ANO)

        def n(table: str, cid) -> int:
            col = "id" if table == "candidacies" else "candidacy_id"
            return conn.execute(f"select count(*) as n from {table} where {col} = %s", (cid,)).fetchone()["n"]

        assert [n(t, velho["id"]) for t in ("candidacies", "mandates", "asset_declarations")] == [0, 0, 0]
        assert [n(t, novo["id"]) for t in ("candidacies", "mandates", "asset_declarations")] == [1, 1, 1]  # só o substituído sai
        log = conn.execute("select * from identity_repair_log where candidacy_id = %s", (velho["id"],)).fetchone()
        assert (log["bug"], log["action"], log["reason"], log["mandates_removed"], log["tse_sequencial"]) == ("BUG-039", "removido", "substituido", 1, "999999990001")
        assert len(log["raw"]["mandates"]) == 1 and len(log["raw"]["asset_declarations"]) == 1  # dá para restaurar a partir do log
        assert any("999999990001" in x for x in r.notes)
        assert conn.execute("select 1 from people where id = %s", (sai,)).fetchone()  # a pessoa nunca é apagada
