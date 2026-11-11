"""Verificação agêntica (D293) contra Postgres de verdade: PgStore, gatilho e constraints da 0130, laço run_verificar e seen().
O cliente da API Anthropic é simulado (nenhuma rede, nenhuma chave); o PDF, o portão de texto invisível e o fetch também.
Pendência declarada em replica/verificacao-agentica.md §17 e §18.

Isolamento (roda no banco do CI e em banco de dev com dado real):
- toda linha criada aqui tem `prop_type = 'ZZV'` e `prop_year = 2099`; o teste apaga o que é dele no começo e no fim;
- `PgStore.pending` lê TODO rascunho do banco: o laço roda com um PgStore filho que só enxerga as linhas ZZV (o SQL é o real);
- `db.run` e os métodos do store fazem commit: usa `rw` (commit de verdade) e limpa explicitamente. O run do laço é redirecionado
  para um dataset `zz.teste.*` (o laço tem de pedir ("verificar", "camara")), então ingest_runs/dataset_stamps reais não são tocados;
- a linha `verificacao_agentica` de pipeline_switches é salva, controlada pelo teste e restaurada no fim;
- VERIFICACAO_AGENTICA é removida do ambiente em todo teste e só ligada onde o teste pede.
Rodar: ETL_DATABASE_URL=... uv run pytest tests/test_verificar_integracao.py
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx
import psycopg
import pytest

from civico_etl import db as D
from civico_etl import drafting
from civico_etl import verification as V
from civico_etl.jobs import rascunho as R
from civico_etl.jobs import verificar as J
from civico_etl.jobs.verificar import PgStore  # a classe real; J.PgStore é trocada nos testes do laço
from tests.test_verificar_job import SHA, FakeClient, ROLE_BY_SYSTEM, _api_error, good
from tests.test_verification import PAGES, answers

TIPO, ANO = "ZZV", 2099
MIGRACAO = Path(__file__).resolve().parents[2] / "db" / "migrations" / "0130_verificacao_agentica.sql"
Err = psycopg.errors


# --- fixtures ----------------------------------------------------------------------------------------------------------

def _limpa(c) -> None:
    c.rollback()
    c.execute("delete from answer_drafts where prop_type = %s and prop_year = %s and replaces_id is not null", (TIPO, ANO))  # FK restrict: filhas primeiro
    c.execute("delete from answer_drafts where prop_type = %s and prop_year = %s", (TIPO, ANO))
    # sobra de execução morta: runs e carimbos do dataset de teste (o dataset real 'verificar' nunca é tocado)
    c.execute("delete from dataset_stamps where dataset like 'zz.teste.%'")
    c.execute("delete from ingest_runs where dataset like 'zz.teste.%'")
    c.commit()


@pytest.fixture
def banco(rw):
    """`rw` com as linhas ZZV apagadas antes e depois."""
    _limpa(rw)
    yield rw
    _limpa(rw)


def _corpo(c, kind: str = "camara_deputados"):
    row = c.execute("select id from legislative_bodies where kind = %s order by id limit 1", (kind,)).fetchone()
    assert row, f"banco sem legislative_bodies kind={kind}: rode o seed e tests/fixtures/base.sql"
    return row["id"]


def mk(c, n: int, *, ans=None, sha: str = SHA, pv: int | None = None, kind: str = "camara_deputados") -> str:
    """Insere um rascunho (commit) e devolve o id."""
    row = c.execute(
        """insert into answer_drafts (body_id, prop_type, prop_number, prop_year, source_url, source_sha256, source_pages, model, prompt_version, answers)
           values (%s, %s, %s, %s, 'http://x/pdf', %s, 2, 'claude-sonnet-5-5', %s, %s) returning id""",
        (_corpo(c, kind), TIPO, n, ANO, sha, pv or drafting.PROMPT_VERSION, json.dumps(ans or answers(), ensure_ascii=False))).fetchone()
    c.commit()
    return str(row["id"])


def key_of(n: int, casa: str = "camara") -> str:
    return f"{casa}-{TIPO.lower()}-{n}-{ANO}"


def get(c, id_: str) -> dict:
    c.rollback()
    return c.execute("select * from answer_drafts where id = %s", (id_,)).fetchone()


def upd(c, sql: str, *args) -> None:
    c.execute(sql, args)
    c.commit()


def por_pessoa(c, id_: str) -> None:
    upd(c, "update answer_drafts set status = 'publicado', reviewer = 'ana', reviewed_at = now(), verified_by = 'pessoa' where id = %s", id_)


def barra(c, id_: str, vv: int | None = None) -> None:
    upd(c, "update answer_drafts set status = 'barrado', verified_by = 'agentes', verification = '{\"b\": 1}', verifier_version = %s where id = %s",
        V.VERIFIER_VERSION if vv is None else vv, id_)


def recusa(c, exc, sql: str, *args):
    """O SQL tem de ser recusado pelo banco. Num savepoint: a transação não aborta e o que não foi commitado fica."""
    with pytest.raises(exc) as e:
        with c.transaction():
            c.execute(sql, args)
    return e.value


@pytest.fixture
def chave(rw):
    """Controla a linha 'verificacao_agentica' de pipeline_switches: set_(None) remove, set_('on') grava (com commit: o run do laço
    também commita, então não dá para manter o 'on' numa transação aberta). O teardown restaura a linha anterior exata.
    Segurança em banco compartilhado:
    - se a linha já está 'on', o teste pula sem mexer;
    - enquanto o teste mantém 'on', uma conexão própria segura o advisory lock do dataset real 'verificar' (a mesma chave de db.run):
      um `civico-etl verificar` real no mesmo banco aborta em "outro run" em vez de publicar com a chave que o teste ligou.
      O run do teste usa `zz.teste.*`, outra chave, e não é afetado."""
    from conftest import database_url

    rw.rollback()
    prev = rw.execute("select name, value, note, set_at from pipeline_switches where name = %s", (J.SWITCH,)).fetchone()
    if prev and str(prev["value"]).strip().lower() == "on":
        pytest.skip("pipeline_switches já está 'on' neste banco: não toco")
    trava: list = []

    def set_(value):
        if value == "on" and not trava:
            c = psycopg.connect(database_url(), autocommit=True)
            if not c.execute("select pg_try_advisory_lock(hashtext('verificar'))").fetchone()[0]:
                c.close()
                pytest.skip("há um run real de 'verificar' neste banco (advisory lock ocupado): não ligo a chave")
            trava.append(c)
        rw.rollback()
        rw.execute("delete from pipeline_switches where name = %s", (J.SWITCH,))
        if value is not None:
            rw.execute("insert into pipeline_switches (name, value, note) values (%s, %s, 'teste de integração: removida no fim')", (J.SWITCH, value))
        rw.commit()

    set_(None)
    try:
        yield set_
    finally:
        rw.rollback()
        rw.execute("delete from pipeline_switches where name = %s", (J.SWITCH,))
        if prev:
            rw.execute("insert into pipeline_switches (name, value, note, set_at) values (%s, %s, %s, %s)", (prev["name"], prev["value"], prev["note"], prev["set_at"]))
        rw.commit()
        for c in trava:  # a chave já voltou ao que era; só então o lock sai
            c.close()  # fechar a sessão solta o advisory lock


class Cliente(FakeClient):
    """FakeClient que responde por proposta, na ordem da fila: por[i] é o roteiro {papel: resposta|exceção} da i-ésima proposta.
    `antes(papel, i)` roda antes de cada chamada (para mudar o banco no meio, ou levantar SystemExit)."""

    def __init__(self, por=None, antes=None, served=None):
        super().__init__(served=served)
        self.por, self.antes, self.n = por or [], antes, -1

    def create(self, **kw):
        role = ROLE_BY_SYSTEM[kw["system"][0]["text"]]
        if role == "sustentacao":  # primeira chamada de cada proposta
            self.n += 1
        self.script = self.por[self.n] if 0 <= self.n < len(self.por) else {}
        if self.antes:
            self.antes(role, self.n)
        return super().create(**kw)

    def propostas(self) -> int:
        return sum(1 for r, _ in self.calls if r == "sustentacao")


class Amb:
    """O laço contra o banco real, com tudo o que é de fora trocado: API, PDF, fetch, portão de texto invisível, run e fila."""

    def __init__(self, c, mp, tmp_path):
        self.c, self.mp = c, mp
        self.ds = f"zz.teste.{uuid.uuid4().hex[:12]}"
        self.run_calls: list[tuple] = []
        self.pdf = tmp_path / "inteiro-teor.pdf"
        self.pdf.write_bytes(b"%PDF-1.4 conteudo qualquer; _pages e trocada")
        self.fetch = lambda url, **kw: SimpleNamespace(checksum=SHA, path=self.pdf)
        amb = self

        class Escopo(PgStore):
            def pending(self, key):  # o SQL é o real; só some o que não é do teste
                return [d for d in super().pending(key) if d["prop_type"] == TIPO]

        mp.setattr(J, "PgStore", Escopo)
        mp.setattr(J, "fetch", lambda url, **kw: amb.fetch(url, **kw))
        mp.setattr(J, "_pages", lambda pdf: PAGES)
        mp.setattr(J, "hidden_text", lambda pdf, pages: False)

        def run_zz(conn, dataset, source, **kw):
            amb.run_calls.append((dataset, source))
            return D.run(conn, amb.ds, source, **kw)

        mp.setattr(J, "run", run_zz)

    def rodar(self, client, **kw) -> int:
        self.mp.setattr(J.anthropic, "Anthropic", lambda: client)
        return J.run_verificar(self.c, **kw)

    def runs(self) -> list[dict]:
        self.c.rollback()
        return self.c.execute("select * from ingest_runs where dataset = %s order by started_at, created_at", (self.ds,)).fetchall()

    def run(self) -> dict:
        (r,) = self.runs()
        return r

    def limpa(self) -> None:
        self.c.rollback()
        self.c.execute("delete from dataset_stamps where dataset = %s", (self.ds,))
        self.c.execute("delete from ingest_runs where dataset = %s", (self.ds,))
        self.c.commit()


@pytest.fixture
def amb(banco, chave, monkeypatch, tmp_path):
    monkeypatch.delenv("VERIFICACAO_AGENTICA", raising=False)
    monkeypatch.delenv("ETL_RAW_STORE", raising=False)  # um shell com r2/supabase subiria manifesto para o bucket
    a = Amb(banco, monkeypatch, tmp_path)
    yield a
    a.limpa()


def ligar(amb, chave):
    """As duas chaves: variável no ambiente (revertida pelo monkeypatch) e linha em pipeline_switches (removida pela fixture)."""
    amb.mp.setenv("VERIFICACAO_AGENTICA", "on")
    chave("on")


def ruim(role: str, campo: str = "o_que_propoe", veredito: str = "nao_sustenta") -> dict:
    d = good(role)
    next(i for i in d["itens"] if i["campo"] == campo)["veredito"] = veredito
    return d


# --- 1. migração 0130 ----------------------------------------------------------------------------------------------------

def test_colunas_checks_e_gatilhos_da_0130_existem(banco):
    cols = {r["column_name"]: r["data_type"] for r in banco.execute("select column_name, data_type from information_schema.columns where table_name = 'answer_drafts'").fetchall()}
    assert (cols["verification"], cols["verifier_version"], cols["verified_by"], cols["withdrawn_note"]) == ("jsonb", "integer", "text", "text")
    st = banco.execute("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'answer_drafts_status_check'").fetchone()["d"]
    assert "barrado" in st and "retirado" in st
    trg = {r["tgname"]: r["tgenabled"] for r in banco.execute("select tgname, tgenabled from pg_trigger where tgrelid = 'answer_drafts'::regclass and not tgisinternal").fetchall()}
    assert trg.get("answer_drafts_guard") == "O" and trg.get("set_updated_at") == "O"
    assert banco.execute("select relrowsecurity from pg_class where relname = 'pipeline_switches'").fetchone()["relrowsecurity"]


def test_reaplicar_a_0130_nao_falha_e_religa_o_set_updated_at(banco):
    class Desfaz(Exception):
        pass

    try:
        with pytest.raises(Desfaz):
            with banco.transaction():
                banco.execute("set local lock_timeout = '2s'")  # DDL em banco compartilhado: não espera lock de outra sessão
                banco.execute("alter table answer_drafts disable trigger set_updated_at")
                q = "select tgenabled from pg_trigger where tgname = 'set_updated_at' and tgrelid = 'answer_drafts'::regclass"
                assert banco.execute(q).fetchone()["tgenabled"] == "D"  # precondição: desligado antes de reaplicar
                banco.execute(MIGRACAO.read_text())  # idempotente, e tudo dentro de uma transação que é desfeita
                assert banco.execute(q).fetchone()["tgenabled"] == "O"  # a 0130 religou
                raise Desfaz
    except Err.LockNotAvailable as e:
        pytest.skip(f"answer_drafts travada por outra sessão (lock_timeout 2s): {e}")


# --- 2. PgStore ------------------------------------------------------------------------------------------------------------

def test_ready_reflete_a_coluna_verifier_version(banco):
    class Desfaz(Exception):
        pass

    assert PgStore(banco).ready() is True
    try:
        with pytest.raises(Desfaz):
            with banco.transaction():
                banco.execute("set local lock_timeout = '2s'")  # DDL em banco compartilhado: não espera lock de outra sessão
                banco.execute("alter table answer_drafts rename column verifier_version to vv_tmp")
                assert PgStore(banco).ready() is False  # banco sem a 0130
                raise Desfaz
    except Err.LockNotAvailable as e:
        pytest.skip(f"answer_drafts travada por outra sessão (lock_timeout 2s): {e}")
    assert PgStore(banco).ready() is True


@pytest.mark.parametrize("valor,esperado", [(None, False), ("on", True), ("  ON ", True), ("off", False), ("", False), ("true", False), ("1", False)])
def test_switch_on_so_com_a_linha_em_on(banco, chave, valor, esperado):
    chave(valor)
    assert PgStore(banco).switch_on() is esperado


def test_pending_so_rascunho_o_mais_novo_por_proposta_e_a_chave_certa(banco):
    a1, a2 = mk(banco, 1), mk(banco, 1)  # mesma proposta: o mais novo vale
    b, c_ = mk(banco, 2), mk(banco, 3, kind="senado")
    upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'x' where id = %s", c_)
    mk(banco, 4, kind="senado")
    barra(banco, b)  # barrado não está na fila
    mine = {d["key"]: d for d in PgStore(banco).pending(None) if d["prop_type"] == TIPO}
    assert set(mine) == {key_of(1), key_of(4, "senado")}
    assert str(mine[key_of(1)]["id"]) == a2 and str(mine[key_of(1)]["id"]) != a1
    assert mine[key_of(1)]["body_kind"] == "camara_deputados" and mine[key_of(4, "senado")]["body_kind"] == "senado"
    assert [str(d["id"]) for d in PgStore(banco).pending(key_of(1))] == [a2]
    assert PgStore(banco).pending(key_of(99)) == []


def test_strike_soma_preserva_o_relatorio_e_nao_mexe_no_status(banco):
    i = mk(banco, 1)
    s = PgStore(banco)
    d = s.pending(key_of(1))[0]
    upd(banco, "update answer_drafts set verification = %s, verifier_version = 1 where id = %s", json.dumps({"verifier_version": 1, "x": "antigo"}), i)
    assert [s.strike(d), s.strike(d), s.strike(d)] == [1, 2, 3]
    r = get(banco, i)
    assert r["status"] == "rascunho" and r["verification"]["tentativas"] == 3 and r["verification"]["x"] == "antigo"
    assert J.strikes(r) == 3


def test_strike_em_rascunho_que_saiu_do_estado_devolve_zero_e_nao_grava(banco):
    i = mk(banco, 1)
    d = PgStore(banco).pending(key_of(1))[0]
    barra(banco, i)
    assert PgStore(banco).strike(d) == 0
    assert "tentativas" not in get(banco, i)["verification"]


def test_human_live_so_conta_publicacao_de_pessoa_da_mesma_proposta(banco):
    s = PgStore(banco)
    novo = mk(banco, 1)
    d = s.pending(key_of(1))[0]
    assert s.human_live(d) is False  # nada no ar
    outra = mk(banco, 2)
    por_pessoa(banco, outra)  # de outra proposta
    assert s.human_live(d) is False
    p = mk(banco, 1)
    por_pessoa(banco, p)
    d = {**d, "id": novo}
    assert s.human_live(d) is True
    upd(banco, "update answer_drafts set status = 'substituido' where id = %s", p)  # a de pessoa já saiu do ar
    assert s.human_live(d) is False
    q = mk(banco, 1)
    upd(banco, "update answer_drafts set status = 'publicado', reviewer = 'agentes:v1', reviewed_at = now(), verified_by = 'agentes', verification = '{\"r\": 1}', verifier_version = 1 where id = %s", q)
    assert s.human_live(d) is False  # no ar só por agentes: podem substituir


def test_rehearse_grava_o_relatorio_como_ensaio_e_mantem_o_rascunho(banco):
    i = mk(banco, 1)
    s = PgStore(banco)
    d = s.pending(key_of(1))[0]
    s.rehearse(d, {"verifier_version": V.VERIFIER_VERSION, "source_sha256": SHA, "decisao": {"publicar": True}})
    r = get(banco, i)
    assert r["status"] == "rascunho" and r["verified_by"] is None and r["reviewer"] is None and r["reviewed_at"] is None
    assert r["verification"]["modo"] == "ensaio" and r["verifier_version"] == V.VERIFIER_VERSION
    assert J.already_rehearsed(s.pending(key_of(1))[0])
    barra(banco, i)
    with pytest.raises(J.Changed):  # rascunho que já saiu do estado
        s.rehearse(d, {"x": 1})


def test_bar_barra_com_relatorio_e_corta_a_nota_em_500(banco):
    i = mk(banco, 1)
    s = PgStore(banco)
    d = s.pending(key_of(1))[0]
    s.bar(d, {"decisao": {"publicar": False}}, "m" * 900)
    r = get(banco, i)
    assert (r["status"], r["verified_by"], r["verifier_version"]) == ("barrado", "agentes", V.VERIFIER_VERSION)
    assert r["verification"]["decisao"] == {"publicar": False} and len(r["review_note"]) == 500
    assert r["reviewer"] is None and r["reviewed_at"] is None
    with pytest.raises(J.Changed):
        s.bar(d, {}, "de novo")


def test_publish_publica_como_agentes_com_relatorio_e_identificador(banco):
    i = mk(banco, 1)
    s = PgStore(banco)
    d = s.pending(key_of(1))[0]
    final = {**answers(), "o_que_propoe": {**answers()["o_que_propoe"], "estado": "diz"}}
    assert s.publish(d, final, {"decisao": {"publicar": True}}) is False
    r = get(banco, i)
    assert r["status"] == "publicado" and r["verified_by"] == "agentes" and r["reviewer"] == f"agentes:v{V.VERIFIER_VERSION}" and r["reviewed_at"] is not None
    assert r["answers"] == final and r["verification"] == {"decisao": {"publicar": True}} and r["verifier_version"] == V.VERIFIER_VERSION
    assert r["replaces_id"] is None and r["correction_note"] is None


def test_publish_substitui_o_que_os_agentes_publicaram_e_vira_correcao(banco):
    s = PgStore(banco)
    antes = mk(banco, 1)
    s.publish(s.pending(key_of(1))[0], answers(), {"r": 1})
    depois = mk(banco, 1)
    assert s.publish(s.pending(key_of(1))[0], answers(), {"r": 2}) is True
    a, b = get(banco, antes), get(banco, depois)
    assert a["status"] == "substituido" and b["status"] == "publicado"
    assert str(b["replaces_id"]) == antes and "Nova conferência por agentes" in b["correction_note"]


def test_publish_nao_substitui_pagina_de_pessoa_e_desfaz_tudo(banco):
    humana = mk(banco, 1)
    por_pessoa(banco, humana)
    novo = mk(banco, 1)
    d = PgStore(banco).pending(key_of(1))[0]
    with pytest.raises(J.Changed):
        PgStore(banco).publish(d, answers(), {"r": 1})
    assert get(banco, humana)["status"] == "publicado" and get(banco, novo)["status"] == "rascunho"


def test_publish_de_rascunho_que_mudou_desfaz_a_substituicao_da_anterior(banco):
    s = PgStore(banco)
    antes = mk(banco, 1)
    s.publish(s.pending(key_of(1))[0], answers(), {"r": 1})
    novo = mk(banco, 1)
    d = s.pending(key_of(1))[0]
    upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'x' where id = %s", novo)
    with pytest.raises(J.Changed):
        s.publish(d, answers(), {"r": 2})
    assert get(banco, antes)["status"] == "publicado"  # o `update ... substituido` da primeira etapa foi desfeito junto


# --- 3. gatilho answer_drafts_guard e constraints (0130) ----------------------------------------------------------------

def _publicado_por_agentes(c, n=1) -> str:
    i = mk(c, n)
    s = PgStore(c)
    s.publish(s.pending(key_of(n))[0], answers(), {"r": 1})
    return i


@pytest.mark.parametrize("coluna,valor", [
    ("answers", '{"x": 2}'), ("checks", '{"x": ["y"]}'), ("source_url", "http://outra"), ("source_sha256", "outro"),
    ("verification", '{"r": 2}'), ("verifier_version", 99), ("verified_by", "pessoa"), ("reviewer", "outro"),
    ("reviewed_at", "2020-01-01"), ("correction_note", "n"), ("review_note", "n"),
])
def test_conteudo_de_publicado_e_imutavel(banco, coluna, valor):
    i = _publicado_por_agentes(banco)
    e = recusa(banco, Err.RaiseException, f"update answer_drafts set {coluna} = %s where id = %s", valor, i)
    assert "não pode ter respostas, notas nem verificação alteradas" in str(e)


def test_replaces_id_de_publicado_e_imutavel(banco):
    i, outro = _publicado_por_agentes(banco), mk(banco, 2)
    assert "alteradas" in str(recusa(banco, Err.RaiseException, "update answer_drafts set replaces_id = %s where id = %s", outro, i))


def test_conteudo_de_barrado_tambem_e_imutavel(banco):
    i = mk(banco, 1)
    barra(banco, i)
    assert "alteradas" in str(recusa(banco, Err.RaiseException, "update answer_drafts set verification = '{\"b\": 2}' where id = %s", i))
    assert "transição barrado -> publicado" in str(recusa(banco, Err.RaiseException, "update answer_drafts set status = 'publicado' where id = %s", i))


def test_rascunho_ainda_e_editavel(banco):
    i = mk(banco, 1)
    upd(banco, "update answer_drafts set answers = '{\"novo\": 1}', verification = '{\"t\": 1}' where id = %s", i)
    assert get(banco, i)["answers"] == {"novo": 1}


@pytest.mark.parametrize("de,para", [("rascunho", "retirado"), ("rascunho", "substituido"), ("publicado", "rascunho"), ("publicado", "reprovado"),
                                      ("publicado", "barrado"), ("reprovado", "publicado"), ("substituido", "publicado"), ("retirado", "publicado")])
def test_transicoes_proibidas(banco, de, para):
    i = mk(banco, 1)
    if de == "reprovado":
        upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'x' where id = %s", i)
    elif de in ("publicado", "substituido", "retirado"):
        por_pessoa(banco, i)
        if de == "substituido":
            upd(banco, "update answer_drafts set status = 'substituido' where id = %s", i)
        if de == "retirado":
            upd(banco, "update answer_drafts set status = 'retirado', withdrawn_note = 'erro' where id = %s", i)
    e = recusa(banco, Err.RaiseException, "update answer_drafts set status = %s where id = %s", para, i)
    assert f"transição {de} -> {para} não permitida" in str(e)


def test_ciclo_publicar_retirar_com_motivo_e_final(banco):
    i = _publicado_por_agentes(banco)
    assert recusa(banco, Err.CheckViolation, "update answer_drafts set status = 'retirado' where id = %s", i).diag.constraint_name == "answer_drafts_withdrawn_note_check"
    assert "só é gravado no ato de retirar" in str(recusa(banco, Err.RaiseException, "update answer_drafts set withdrawn_note = 'x' where id = %s", i))
    upd(banco, "update answer_drafts set status = 'retirado', withdrawn_note = 'erro factual' where id = %s", i)
    r = get(banco, i)
    assert r["status"] == "retirado" and r["withdrawn_note"] == "erro factual" and r["verified_by"] == "agentes"
    assert "só é gravado no ato de retirar" in str(recusa(banco, Err.RaiseException, "update answer_drafts set withdrawn_note = 'outro' where id = %s", i))
    recusa(banco, Err.RaiseException, "update answer_drafts set status = 'publicado' where id = %s", i)


def test_insert_so_como_rascunho(banco):
    e = recusa(banco, Err.RaiseException,
               """insert into answer_drafts (body_id, prop_type, prop_number, prop_year, source_url, source_sha256, source_pages, model, prompt_version, answers,
                                             status, reviewer, reviewed_at, verified_by)
                  values (%s, %s, 1, %s, 'u', 's', 1, 'm', 1, '{}', 'publicado', 'x', now(), 'pessoa')""", _corpo(banco), TIPO, ANO)
    assert "nova linha só entra como rascunho" in str(e)


def test_checks_de_verified_by_e_de_relatorio(banco):
    i = mk(banco, 1)
    pub = "update answer_drafts set status = 'publicado', reviewer = 'x', reviewed_at = now(){} where id = %s"
    assert recusa(banco, Err.CheckViolation, "update answer_drafts set verified_by = 'robo' where id = %s", i).diag.constraint_name == "answer_drafts_verified_by_check"
    assert recusa(banco, Err.CheckViolation, pub.format(""), i).diag.constraint_name == "answer_drafts_public_verified_check"  # verified_by obrigatório no que o público lê
    assert recusa(banco, Err.CheckViolation, pub.format(", verified_by = 'agentes'"), i).diag.constraint_name == "answer_drafts_agent_report_check"
    assert recusa(banco, Err.CheckViolation, pub.format(", verified_by = 'agentes', verification = '{\"r\": 1}'"), i).diag.constraint_name == "answer_drafts_agent_report_check"
    assert recusa(banco, Err.CheckViolation, "update answer_drafts set status = 'barrado', verified_by = 'agentes' where id = %s", i).diag.constraint_name == "answer_drafts_agent_report_check"
    recusa(banco, Err.CheckViolation, "update answer_drafts set status = 'publicado', verified_by = 'pessoa' where id = %s", i)  # sem reviewer: check original da 0080
    assert get(banco, i)["status"] == "rascunho"
    por_pessoa(banco, i)  # o caminho de pessoa segue aberto
    assert get(banco, i)["verified_by"] == "pessoa"


def test_uma_so_versao_publicada_por_proposta(banco):
    _publicado_por_agentes(banco)
    outra = mk(banco, 1)
    recusa(banco, Err.UniqueViolation, "update answer_drafts set status = 'publicado', reviewer = 'ana', reviewed_at = now(), verified_by = 'pessoa' where id = %s", outra)


def test_set_updated_at_anda_em_update_de_rascunho(banco):
    i = mk(banco, 1)
    antes = get(banco, i)["updated_at"]
    upd(banco, "update answer_drafts set review_note = 'tocou' where id = %s", i)
    assert get(banco, i)["updated_at"] > antes


def test_site_le_publicado_substituido_e_retirado_so_nas_colunas_do_grant(banco):
    """RLS public_read (0130) + grant por coluna (0131): o relatório de verificação e as notas internas não chegam ao papel do site."""
    ids = {n: mk(banco, n) for n in range(1, 8)}
    por_pessoa(banco, ids[1])  # publicado
    por_pessoa(banco, ids[2])
    upd(banco, "update answer_drafts set status = 'substituido' where id = %s", ids[2])
    por_pessoa(banco, ids[3])
    upd(banco, "update answer_drafts set status = 'retirado', withdrawn_note = 'erro' where id = %s", ids[3])
    barra(banco, ids[4])
    upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'x' where id = %s", ids[5])  # 6 e 7 seguem rascunho
    with banco.transaction():
        banco.execute("set local role web_reader")
        vistos = {r["prop_number"]: r["status"] for r in banco.execute("select prop_number, status from answer_drafts where prop_type = %s", (TIPO,)).fetchall()}
        assert vistos == {1: "publicado", 2: "substituido", 3: "retirado"}
        banco.execute("select answers, verified_by, withdrawn_note, reviewed_at from answer_drafts where prop_type = %s", (TIPO,)).fetchall()
    for coluna in ("verification", "review_note", "source_sha256", "cost_usd"):
        with pytest.raises(Err.InsufficientPrivilege):
            with banco.transaction():
                banco.execute("set local role web_reader")
                banco.execute(f"select {coluna} from answer_drafts where prop_type = %s", (TIPO,)).fetchall()


# --- 4. laço em ensaio (padrão): grava o relatório e o status NÃO muda ----------------------------------------------------

def _intacto(r: dict) -> None:
    assert r["status"] == "rascunho" and r["verified_by"] is None and r["reviewer"] is None and r["reviewed_at"] is None and r["review_note"] is None


def test_ensaio_tudo_sustentado_grava_relatorio_e_nao_muda_o_status(amb, banco):
    i = mk(banco, 1)
    c = Cliente()
    assert amb.rodar(c, limit=5) == 0
    r = get(banco, i)
    _intacto(r)
    v = r["verification"]
    assert v["modo"] == "ensaio" and v["decisao"]["publicar"] is True and v["decisao"]["barrado_por"] == [] and r["verifier_version"] == V.VERIFIER_VERSION
    assert v["decisao"]["estados"]["o_que_propoe"] == "diz" and v["decisao"]["estados"]["quem_recebe"] == "nao_diz" and v["prova_de_leitura"]["ok"] is True
    assert v["source_sha256"] == SHA and v["falhas"] == {} and v["custo_usd"] is not None and v["agentes"]["sustentacao"]["itens"]
    assert amb.run_calls == [("verificar", "camara")]
    run = amb.run()
    assert run["status"] == "succeeded" and run["rows_upserted"] == 1 and "modo: ensaio" in run["notes"] and f"{key_of(1)}: ensaio:publicaria" in run["notes"]


def test_ensaio_ja_ensaiado_nao_e_refeito_sem_force(amb, banco):
    i = mk(banco, 1)
    amb.rodar(Cliente())
    c = Cliente()
    amb.rodar(c)
    assert c.calls == []
    c = Cliente()
    amb.rodar(c, force=True)
    assert c.propostas() == 1
    _intacto(get(banco, i))


def test_ensaio_campo_secundario_sem_sustentacao_fica_nao_conferido_e_status_nao_muda(amb, banco):
    i = mk(banco, 1)
    amb.rodar(Cliente([{"sustentacao": ruim("sustentacao", "quem_paga")}]))
    r = get(banco, i)
    _intacto(r)
    d = r["verification"]["decisao"]
    assert d["publicar"] is True and d["estados"]["quem_paga"] == "nao_conferido" and d["estados"]["o_que_propoe"] == "diz"
    assert "sustentacao:nao_sustenta" in d["motivos"]["quem_paga"]
    assert f"{key_of(1)}: ensaio:publicaria" in amb.run()["notes"]


def test_ensaio_o_que_propoe_sem_sustentacao_barraria_e_status_nao_muda(amb, banco):
    i = mk(banco, 1)
    amb.rodar(Cliente([{"sustentacao": ruim("sustentacao")}]))
    r = get(banco, i)
    _intacto(r)
    d = r["verification"]["decisao"]
    assert d["publicar"] is False and "o_que_propoe:nao_conferido" in d["barrado_por"] and d["estados"]["o_que_propoe"] == "nao_conferido"
    assert f"{key_of(1)}: ensaio:barraria" in amb.run()["notes"]


@pytest.mark.parametrize("role,resp", [
    ("contraditor", {"frases": [], "nao_diz": [], "instrucao_detectada": False}),  # faltam campos
    ("sustentacao", {"itens": [{"campo": "o_que_propoe", "veredito": "SUSTENTA", "sobra": "", "direcao_confere": "sim"}], "instrucao_detectada": False}),  # enum
    ("leitor", ("stop", "texto", "isto não é json")),
    ("juiz", ("stop", "refusal")),
])
def test_ensaio_resposta_fora_do_esquema_ou_recusa_barraria_e_status_nao_muda(amb, banco, role, resp):
    i = mk(banco, 1)
    amb.rodar(Cliente([{role: resp}]))
    r = get(banco, i)
    _intacto(r)
    v = r["verification"]
    assert role in v["falhas"] and v["decisao"]["publicar"] is False and f"agente_sem_resposta:{role}" in v["decisao"]["barrado_por"]
    assert f"{key_of(1)}: ensaio:barraria" in amb.run()["notes"]


def test_ensaio_com_pagina_de_pessoa_no_ar_barraria_mesmo_com_tudo_favoravel(amb, banco):
    humana = mk(banco, 1)
    por_pessoa(banco, humana)
    i = mk(banco, 1)
    amb.rodar(Cliente())
    _intacto(get(banco, i))
    assert f"{key_of(1)}: ensaio:barraria" in amb.run()["notes"] and get(banco, humana)["status"] == "publicado"


def test_variavel_diferente_de_on_continua_em_ensaio(amb, banco, chave):
    i = mk(banco, 1)
    chave("on")  # a linha do banco sozinha não publica
    for valor in ("off", "true", "1", ""):
        amb.mp.setenv("VERIFICACAO_AGENTICA", valor)
        amb.rodar(Cliente(), force=True)
        _intacto(get(banco, i))
    assert all("modo: ensaio" in r["notes"] for r in amb.runs()) and len(amb.runs()) == 4


# --- 5. as duas chaves (falha fechada) ------------------------------------------------------------------------------------

def test_variavel_on_sem_a_linha_em_pipeline_switches_nao_roda_nem_publica(amb, banco, chave):
    i = mk(banco, 1)
    amb.mp.setenv("VERIFICACAO_AGENTICA", "on")
    c = Cliente()
    with pytest.raises(SystemExit, match="pipeline_switches"):
        amb.rodar(c)
    assert c.calls == [] and amb.run_calls == [] and amb.runs() == []  # parou antes de abrir o run
    _intacto(get(banco, i))


@pytest.mark.parametrize("valor", ["off", "", "talvez"])
def test_variavel_on_com_a_linha_diferente_de_on_nao_roda(amb, banco, chave, valor):
    i = mk(banco, 1)
    amb.mp.setenv("VERIFICACAO_AGENTICA", "on")
    chave(valor)
    c = Cliente()
    with pytest.raises(SystemExit, match="pipeline_switches"):
        amb.rodar(c)
    assert c.calls == [] and amb.runs() == []
    _intacto(get(banco, i))


def test_linha_on_sem_a_variavel_nao_publica_mesmo_com_veredito_favoravel(amb, banco, chave):
    i = mk(banco, 1)
    chave("on")
    amb.rodar(Cliente())
    _intacto(get(banco, i))
    assert "modo: ensaio" in amb.run()["notes"]


def test_duas_chaves_ligadas_publicam_o_aprovado_e_barram_o_reprovado(amb, banco, chave):
    ok, mau = mk(banco, 1), mk(banco, 2)
    ligar(amb, chave)
    assert amb.rodar(Cliente([{}, {"sustentacao": ruim("sustentacao")}])) == 0
    a, b = get(banco, ok), get(banco, mau)
    assert a["status"] == "publicado" and a["verified_by"] == "agentes" and a["reviewer"] == f"agentes:v{V.VERIFIER_VERSION}" and a["reviewed_at"] is not None
    assert a["answers"]["o_que_propoe"]["estado"] == "diz" and a["answers"]["quem_recebe"]["estado"] == "nao_diz"
    assert a["verification"]["decisao"]["publicar"] is True and "modo" not in a["verification"] and a["verifier_version"] == V.VERIFIER_VERSION
    assert b["status"] == "barrado" and b["verified_by"] == "agentes" and "o_que_propoe:nao_conferido" in b["review_note"]
    assert b["verification"]["decisao"]["publicar"] is False and b["reviewer"] is None and b["reviewed_at"] is None
    run = amb.run()
    assert "modo: PUBLICA" in run["notes"] and f"{key_of(1)}: publicado" in run["notes"] and f"{key_of(2)}: barrado" in run["notes"] and run["rows_upserted"] == 2


def test_publicada_por_agentes_e_substituida_por_nova_conferencia(amb, banco, chave):
    ligar(amb, chave)
    um = mk(banco, 1)
    amb.rodar(Cliente())
    dois = mk(banco, 1)
    amb.rodar(Cliente())
    a, b = get(banco, um), get(banco, dois)
    assert a["status"] == "substituido" and b["status"] == "publicado" and str(b["replaces_id"]) == um and b["correction_note"]


def test_com_as_duas_chaves_pagina_de_pessoa_no_ar_nao_e_trocada(amb, banco, chave):
    humana = mk(banco, 1)
    por_pessoa(banco, humana)
    novo = mk(banco, 1)
    ligar(amb, chave)
    amb.rodar(Cliente())
    h, n = get(banco, humana), get(banco, novo)
    assert h["status"] == "publicado" and h["verified_by"] == "pessoa"
    assert n["status"] == "barrado" and n["review_note"].startswith("publicacao_de_pessoa_no_ar")


def test_portao_barra_com_as_duas_chaves_sem_gastar_chamada(amb, banco, chave):
    i = mk(banco, 1)
    ligar(amb, chave)
    amb.mp.setattr(J, "hidden_text", lambda pdf, pages: True)
    c = Cliente()
    amb.rodar(c)
    r = get(banco, i)
    assert c.calls == [] and r["status"] == "barrado" and r["review_note"] == "texto_invisivel" and r["verification"]["agentes"] is None


# --- 6. seen(): barrado conta como visto ----------------------------------------------------------------------------------

@pytest.fixture
def meta(banco):
    corpo = str(_corpo(banco))
    return lambda n: {"body_id": corpo, "prop_type": TIPO, "prop_number": n, "prop_year": ANO}


def _estado(c, i: str, st: str) -> None:
    if st == "barrado":
        barra(c, i)
    elif st == "reprovado":
        upd(c, "update answer_drafts set status = 'reprovado', review_note = 'x' where id = %s", i)
    elif st in ("publicado", "substituido", "retirado"):
        por_pessoa(c, i)
        if st == "substituido":
            upd(c, "update answer_drafts set status = 'substituido' where id = %s", i)
        if st == "retirado":
            upd(c, "update answer_drafts set status = 'retirado', withdrawn_note = 'erro' where id = %s", i)


@pytest.mark.parametrize("st,visto", [("rascunho", True), ("publicado", True), ("barrado", True), ("reprovado", False), ("substituido", False), ("retirado", False)])
def test_seen_por_status(banco, meta, st, visto):
    i = mk(banco, 1)
    _estado(banco, i, st)
    assert R.PgStore(banco).seen(meta(1), SHA) is visto


def test_seen_barrado_volta_com_pdf_novo_prompt_novo_ou_verificador_novo(banco, meta, monkeypatch):
    i = mk(banco, 1)
    barra(banco, i)
    s = R.PgStore(banco)
    assert s.seen(meta(1), SHA) is True
    assert s.seen(meta(1), "outro-sha") is False  # PDF novo
    assert s.seen(meta(1), SHA, drafting.PROMPT_VERSION + 1) is False  # prompt de rascunho novo
    monkeypatch.setattr(V, "VERIFIER_VERSION", V.VERIFIER_VERSION + 1)
    assert s.seen(meta(1), SHA) is False  # verificadores novos
    j = mk(banco, 2)
    barra(banco, j, vv=V.VERIFIER_VERSION)  # barrado já na versão nova: visto de novo
    assert s.seen(meta(2), SHA) is True


def test_force_do_rascunho_ignora_o_barrado_e_sem_force_o_pula(banco, meta, monkeypatch, tmp_path):
    """O `--force` do item 5 é o do `civico-etl rascunho`: `verificar --force` só relê rascunhos, nunca traz barrado de volta."""
    i = mk(banco, 1)
    barra(banco, i)
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF")
    monkeypatch.setattr(R, "fetch_json", lambda url, **kw: {"dados": {"urlInteiroTeor": "http://x/pdf"}})
    monkeypatch.setattr(R, "fetch", lambda url, **kw: SimpleNamespace(checksum=SHA, path=pdf))
    monkeypatch.setattr(R, "_pages", lambda b: PAGES)
    rej = []
    r = SimpleNamespace(reject=lambda **kw: rej.append(kw))
    c = {**meta(1), "camara_id": 1, "key": key_of(1), "summary_official": "x"}
    s = R.PgStore(banco)
    assert R._prepare(s, c, r, False) is None  # barrado: visto
    assert R._prepare(s, c, r, True) is not None  # --force
    monkeypatch.setattr(V, "VERIFIER_VERSION", V.VERIFIER_VERSION + 1)
    assert R._prepare(s, c, r, False) is not None  # verificador novo
    assert rej == []


def test_verificar_nao_tenta_de_novo_o_barrado_nem_com_force(amb, banco, chave):
    i = mk(banco, 1)
    ligar(amb, chave)
    amb.rodar(Cliente([{"sustentacao": ruim("sustentacao")}]))
    assert get(banco, i)["status"] == "barrado"
    for force in (False, True):
        c = Cliente()
        amb.rodar(c, force=force)
        assert c.calls == [] and get(banco, i)["status"] == "barrado"


# --- 7. degradação (§17) --------------------------------------------------------------------------------------------------

TRANSIENTE = {"contraditor": _api_error(anthropic.RateLimitError, 429)}


def test_falha_transitoria_marca_tentativa_e_deixa_na_fila(amb, banco):
    i = mk(banco, 1)
    assert amb.rodar(Cliente([TRANSIENTE])) == 0  # uma falha só não encerra o run
    r = get(banco, i)
    _intacto(r)
    assert r["verification"] == {"tentativas": 1} and r["verifier_version"] is None
    run = amb.run()
    assert "tentativa 1 de 3" in run["notes"] and run["rows_rejected"] == 1 and run["rows_upserted"] == 0


def test_tres_marcas_pulam_o_rascunho_ate_o_force(amb, banco):
    i = mk(banco, 1)
    for n in (1, 2, 3):
        amb.rodar(Cliente([TRANSIENTE]))
        assert get(banco, i)["verification"]["tentativas"] == n
    c = Cliente()
    amb.rodar(c)
    assert c.calls == [] and "pulados por 3 falhas da API (use --force)" in amb.runs()[-1]["notes"] and key_of(1) in amb.runs()[-1]["notes"]
    c = Cliente()
    amb.rodar(c, force=True)
    assert c.propostas() == 1
    r = get(banco, i)
    assert "tentativas" not in r["verification"] and r["verification"]["modo"] == "ensaio"  # o ensaio novo substitui o relatório e zera as marcas


def test_marcas_tambem_pulam_em_modo_que_publica(amb, banco, chave):
    i = mk(banco, 1)
    upd(banco, "update answer_drafts set verification = %s where id = %s", json.dumps({"tentativas": 3}), i)
    ligar(amb, chave)
    c = Cliente()
    amb.rodar(c)
    assert c.calls == [] and get(banco, i)["status"] == "rascunho"


def test_listagem_sem_limit_mostra_a_fila_e_o_pulado_e_em_modo_que_publica_o_ensaiado(amb, banco, chave, capsys):
    mk(banco, 1), mk(banco, 2)
    pulado = mk(banco, 3)
    s = PgStore(banco)
    s.rehearse(s.pending(key_of(2))[0], {"verifier_version": V.VERIFIER_VERSION, "source_sha256": SHA})
    upd(banco, "update answer_drafts set verification = %s where id = %s", json.dumps({"tentativas": 3}), pulado)
    c = Cliente()
    assert amb.rodar(c, limit=0) == 0
    out = capsys.readouterr().out
    assert c.calls == [] and amb.runs() == []  # só lista: nada de API, nada de run
    assert f"{key_of(1):<28}" in out and "a verificar" in out and f"{key_of(3)}" in out and "pulado: 3 falhas da API" in out
    assert key_of(2) not in out  # em ensaio o já ensaiado não volta à fila
    ligar(amb, chave)
    assert amb.rodar(c, limit=0) == 0
    assert "já ensaiado" in capsys.readouterr().out  # com as duas chaves, ensaio anterior não impede a decisão


def test_duas_falhas_seguidas_encerram_o_run(amb, banco):
    ids = [mk(banco, n) for n in (1, 2, 3)]
    c = Cliente([TRANSIENTE] * 3)
    assert amb.rodar(c) == 1
    assert c.propostas() == 2  # a terceira nem foi tentada
    assert [J.strikes(get(banco, i)) for i in ids] == [1, 1, 0]
    assert get(banco, ids[2])["verification"] is None
    run = amb.run()
    assert "duas falhas seguidas da API" in run["notes"] and run["status"] == "succeeded" and run["rows_rejected"] == 2  # DOCUMENTA O COMPORTAMENTO ATUAL (divergente da §17: run abortado deveria falhar/ficar parcial); inverter quando o código for corrigido


def test_sucesso_zera_a_sequencia_de_falhas(amb, banco):
    ids = [mk(banco, n) for n in (1, 2, 3)]
    c = Cliente([TRANSIENTE, {}, TRANSIENTE])
    assert amb.rodar(c) == 0
    assert c.propostas() == 3
    r1, r2, r3 = (get(banco, i) for i in ids)
    assert r1["verification"] == {"tentativas": 1} and r2["verification"]["modo"] == "ensaio" and r3["verification"] == {"tentativas": 1}


def test_mudanca_de_estado_no_meio_nao_zera_a_sequencia_de_falhas(amb, banco):
    """Achado: `streak` só zera em sucesso. Falha, Changed, falha encerra o run, embora o Changed não seja falha da API.
    O código decide o que é 'seguidas'; a especificação (§17) não distingue. Fixado aqui para quem mudar saber."""
    ids = [mk(banco, n) for n in (1, 2, 3, 4)]

    def antes(role, n):
        if n == 1 and role == "contraditor":
            upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'trocado' where id = %s", ids[1])

    c = Cliente([TRANSIENTE, {}, TRANSIENTE, {}], antes=antes)
    assert amb.rodar(c) == 1
    assert c.propostas() == 3 and get(banco, ids[3])["verification"] is None
    assert "duas falhas seguidas da API" in amb.run()["notes"]


@pytest.mark.parametrize("status,cls", [(401, anthropic.AuthenticationError), (403, anthropic.PermissionDeniedError), (404, anthropic.NotFoundError), (400, anthropic.BadRequestError)])
def test_4xx_de_configuracao_para_o_run_sem_gravar_nada(amb, banco, status, cls):
    ids = [mk(banco, n) for n in (1, 2)]
    c = Cliente([{"sustentacao": _api_error(cls, status)}])
    assert amb.rodar(c) == 1
    assert c.propostas() == 1  # a segunda proposta não foi tentada
    for i in ids:
        r = get(banco, i)
        _intacto(r)
        assert r["verification"] is None and r["verifier_version"] is None  # nem relatório nem marca de tentativa
    run = amb.run()
    assert "a API recusou a requisição" in run["notes"] and "Run encerrado; nada foi gravado" in run["notes"] and run["rows_upserted"] == 0
    # DOCUMENTA O COMPORTAMENTO ATUAL, divergente da §17 ("o run para"): o run fecha succeeded e carimba o dataset, só o retorno (1) sinaliza
    # o aborto. Esta asserção deve inverter quando o código de produção for corrigido.
    assert run["status"] == "succeeded"


def test_documento_grande_demais_barra_so_aquela_proposta_e_a_fila_segue(amb, banco, chave):
    grande, normal = mk(banco, 1), mk(banco, 2)
    ligar(amb, chave)
    c = Cliente([{"sustentacao": _api_error(anthropic.APIStatusError, 413)}])
    assert amb.rodar(c) == 0
    a, b = get(banco, grande), get(banco, normal)
    assert a["status"] == "barrado" and "agente_sem_resposta:sustentacao" in a["review_note"] and "demais para a API" in a["verification"]["falhas"]["sustentacao"]
    assert b["status"] == "publicado"


@pytest.mark.parametrize("modo", ["ensaio", "publica", "barra"])
def test_rascunho_que_muda_de_estado_no_meio_sai_do_run_e_a_fila_segue(amb, banco, chave, modo):
    um, dois = mk(banco, 1), mk(banco, 2)
    if modo != "ensaio":
        ligar(amb, chave)

    def antes(role, n):
        if n == 0 and role == "contraditor":  # outra pessoa reprova o rascunho enquanto os agentes leem
            upd(banco, "update answer_drafts set status = 'reprovado', review_note = 'reprovado à mão' where id = %s", um)

    por = [{"sustentacao": ruim("sustentacao")} if modo == "barra" else {}]
    c = Cliente(por, antes=antes)
    assert amb.rodar(c) == 0
    a, b = get(banco, um), get(banco, dois)
    assert a["status"] == "reprovado" and a["review_note"] == "reprovado à mão" and a["verified_by"] is None  # nada do laço foi gravado nele
    assert a["verification"] is None
    assert (b["verification"] or {}).get("modo") == "ensaio" if modo == "ensaio" else b["status"] == "publicado"
    run = amb.run()
    assert "o rascunho mudou de estado durante a verificação" in run["notes"] and run["rows_rejected"] == 1 and run["rows_upserted"] == 1


def test_limite_do_run_para_a_fila(amb, banco):
    ids = [mk(banco, n) for n in (1, 2, 3)]
    c = Cliente()
    amb.rodar(c, limit=2)
    assert c.propostas() == 2 and get(banco, ids[2])["verification"] is None
    assert "parou no limite de 2" in amb.run()["notes"]


def test_fetch_que_falha_ou_pdf_que_mudou_rejeita_a_proposta_e_segue(amb, banco):
    ids = [mk(banco, n) for n in (1, 2, 3)]

    def fetch(url, **kw):
        fetch.n += 1
        if fetch.n == 1:
            raise httpx.ConnectError("sem rede")
        if fetch.n == 2:
            return SimpleNamespace(checksum="sha-novo", path=amb.pdf)
        return SimpleNamespace(checksum=SHA, path=amb.pdf)

    fetch.n = 0
    amb.fetch = fetch
    c = Cliente()
    assert amb.rodar(c) == 0
    assert c.propostas() == 1
    assert get(banco, ids[0])["verification"] is None and get(banco, ids[1])["verification"] is None  # nenhuma das duas foi gravada
    assert get(banco, ids[2])["verification"]["modo"] == "ensaio"
    run = amb.run()
    assert "inteiro teor não baixou" in run["notes"] and "o PDF mudou desde o rascunho" in run["notes"] and run["rows_rejected"] == 2


def _levanta(exc):
    def antes(role, n):
        raise exc
    return antes


@pytest.mark.parametrize("exc", [SystemExit("disco cheio"), RuntimeError("bug inesperado")])
def test_run_nunca_fica_em_running_inclusive_em_systemexit(amb, banco, exc):
    i = mk(banco, 1)
    with pytest.raises(type(exc)):
        amb.rodar(Cliente(antes=_levanta(exc)))
    run = amb.run()
    assert run["status"] == "failed" and run["finished_at"] is not None and type(exc).__name__ in run["error"]
    assert not [r for r in amb.runs() if r["status"] == "running"]
    _intacto(get(banco, i))
    c = Cliente()  # o advisory lock foi solto: o próximo run abre normalmente
    assert amb.rodar(c) == 0 and c.propostas() == 1
    assert [r["status"] for r in amb.runs()] == ["failed", "succeeded"]


def test_systemexit_no_download_tambem_fecha_o_run(amb, banco):
    mk(banco, 1)

    def fetch(url, **kw):
        raise SystemExit("sem espaço em disco")

    amb.fetch = fetch
    with pytest.raises(SystemExit):
        amb.rodar(Cliente())
    assert [r["status"] for r in amb.runs()] == ["failed"]


def test_outro_run_em_andamento_aborta_antes_de_abrir_o_run(amb, banco, conn):
    i = mk(banco, 1)
    conn.execute("select pg_advisory_lock(hashtext(%s))", (amb.ds,))  # outra sessão segura o lock do dataset
    try:
        with pytest.raises(SystemExit, match="outro run"):
            amb.rodar(Cliente())
    finally:
        conn.execute("select pg_advisory_unlock(hashtext(%s))", (amb.ds,))
    assert amb.runs() == []
    _intacto(get(banco, i))
