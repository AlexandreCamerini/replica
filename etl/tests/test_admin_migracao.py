"""A1: migração 0150_admin_coleta.sql (modelo de dados da administração de coleta, replica/admin-coleta-plano.md seções 1 e 2).

Tudo roda em bancos que o próprio teste cria no mesmo servidor, nunca no banco da suíte:
  - `banco_isolado` (a fixture de sessão, que já aplica TODAS as migrações, seed e base.sql) para tabelas, travas e gatilhos;
  - `<banco da suíte>_zero_<pid>` e `<banco da suíte>_zero_<pid>_pre`, criados e apagados aqui, para o critério 1
    ("aplica do zero e uma segunda vez sem erro") e para a comparação de colunas antes e depois da 0150.
Só se apaga banco cujo nome casa exatamente com `<banco>_zero_<número>[_pre]` e que este processo criou (ou órfão de PID morto).

Medição do custo dos gatilhos de override: `pytest -s tests/test_admin_migracao.py -k medicao` imprime os tempos.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import pytest
from psycopg import sql
from banco_isolado import REPO, _com_banco, _pid_vivo, banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg import errors as pe
from psycopg.rows import dict_row

from civico_etl.db import upsert

TABELAS_ADM = (
    "adm_rodadas",
    "adm_tentativas",
    "adm_evidencias",
    "adm_vinculos",
    "adm_propostas",
    "adm_pendencias",
    "adm_pendencia_propostas",
    "adm_decisoes",
    "adm_overrides",
    "adm_pareceres",
    "adm_pedidos",
    "adm_pedidos_decisao",  # 0153: a constante segue o número real de tabelas adm_*
    "adm_admins",  # 0156 (F3-T1)
    "adm_admins_log",  # 0156: só acréscimo
)
ROLES_SEM_ACESSO = ("web_reader", "web_writer", "anon", "authenticated")
SHA = "a" * 64


# ------------------------------------------------------------------ bancos temporários


@contextmanager
def banco_temporario(sufixo: str = ""):
    """Cria `<banco da suíte>_zero_<pid><sufixo>` e o apaga no fim. Devolve a URL. Falha de criação derruba o teste."""
    suite = database_url()
    base = (urlparse(suite).path or "/").lstrip("/")
    assert base, "a URL da suíte não nomeia um banco"
    nome = f"{base}_zero_{os.getpid()}{sufixo}"
    padrao = re.compile(rf"^{re.escape(base)}_zero_(\d+)(?:_pre)?$")
    assert padrao.match(nome), nome
    adm_url = _com_banco(suite, "postgres")
    criado = False
    try:
        with psycopg.connect(adm_url, autocommit=True, connect_timeout=5) as adm:
            for (dn,) in adm.execute("select datname from pg_database where datname like %s", (base.replace("_", r"\_") + r"\_zero\_%",)).fetchall():
                m = padrao.match(dn)
                if m and (dn == nome or not _pid_vivo(int(m.group(1)))):  # só o próprio nome ou órfão de PID morto
                    adm.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(dn)))
            adm.execute(sql.SQL("create database {}").format(sql.Identifier(nome)))
            criado = True
        yield _com_banco(suite, nome)
    finally:
        if criado:
            with psycopg.connect(adm_url, autocommit=True, connect_timeout=5) as adm:
                adm.execute(sql.SQL("drop database if exists {} with (force)").format(sql.Identifier(nome)))


def migrar(url: str, db_dir: Path | None = None) -> subprocess.CompletedProcess:
    script = (db_dir or REPO / "db") / "migrate.sh"
    env = {**os.environ, "DATABASE_URL": url, "ETL_DATABASE_URL": url}
    return subprocess.run(["bash", str(script), "--local"], env=env, capture_output=True, text=True, timeout=600, cwd=REPO)


def n_migracoes(saida: str) -> int:
    m = re.search(r"ok: (\d+) migração", saida)
    assert m, saida[-500:]
    return int(m.group(1))


# ------------------------------------------------------------------ critério 1


def test_criterio_1_aplica_do_zero_e_uma_segunda_vez_sem_erro():
    """Com DATABASE_URL apontando para o banco local, `db/migrate.sh --local` aplica do zero e uma segunda vez sem erro."""
    with banco_temporario() as url:
        r1 = migrar(url)
        assert r1.returncode == 0, r1.stdout[-1500:] + r1.stderr[-1500:]
        assert "aplicando 0150_admin_coleta.sql" in r1.stdout
        r2 = migrar(url)
        assert r2.returncode == 0, r2.stdout[-1500:] + r2.stderr[-1500:]
        assert "aplicando" not in r2.stdout, "a segunda execução reaplicou migração"
        arquivos = len(list((REPO / "db" / "migrations").glob("*.sql")))
        assert n_migracoes(r1.stdout) == n_migracoes(r2.stdout) == arquivos
        with psycopg.connect(url, autocommit=True) as c:
            assert c.execute("select count(*) from pg_tables where schemaname = 'public' and tablename like 'adm\\_%'").fetchone()[0] == len(TABELAS_ADM)


def test_colunas_existentes_nao_mudam(db):
    """Compara information_schema.columns das tabelas que a 0150 só consulta, num banco com as migrações < 0150 (aplicadas pelo mesmo
    migrate.sh sobre uma cópia de db/) e no banco isolado (todas). Escolha: aplicar de verdade custa uns segundos e dispensa uma lista
    escrita à mão que envelheceria. Se uma migração futura alterar uma destas tabelas, o teste pede que a diferença seja declarada aqui."""
    tabelas = ("sapl_houses", "data_coverage", "mandate_contacts", "identity_match_queue", "sources", "pipeline_switches", "ingest_runs")
    q = (
        "select table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, is_identity, "
        "character_maximum_length, numeric_precision from information_schema.columns "
        "where table_schema = 'public' and table_name = any(%s) order by 1, 3"
    )
    with tempfile.TemporaryDirectory() as tmp:
        copia = Path(tmp) / "db"
        shutil.copytree(REPO / "db", copia)
        for f in (copia / "migrations").glob("*.sql"):
            if f.name >= "0150":
                f.unlink()
        with banco_temporario("_pre") as url_pre:
            r = migrar(url_pre, copia)
            assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
            with psycopg.connect(url_pre, autocommit=True) as c:
                antes = c.execute(q, (list(tabelas),)).fetchall()
                assert {x[0] for x in antes} == set(tabelas)
                assert not c.execute("select 1 from pg_tables where tablename like 'adm\\_%'").fetchall()
    depois = db.x(q, (list(tabelas),)).fetchall()
    assert [tuple(r.values()) for r in depois] == [tuple(r) for r in antes]


# ------------------------------------------------------------------ fixture de trabalho no banco isolado


class Db:
    def __init__(self, url: str):
        self.url = url
        self.c = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        self.c.execute("set search_path = public, extensions")
        self.c.execute("set timezone = 'UTC'")

    def x(self, q: str, params=None):
        return self.c.execute(q, params)

    def one(self, q: str, params=None):
        return self.c.execute(q, params).fetchone()

    def rw(self):
        """Conexão como a de db.connect (sem autocommit), para `civico_etl.db.upsert`."""
        c = psycopg.connect(self.url, row_factory=dict_row, autocommit=False)
        c.execute("set search_path = public, extensions")
        c.execute("set timezone = 'UTC'")
        c.commit()
        return c

    def limpar(self):
        with self.c.transaction():
            self.c.execute("set local session_replication_role = replica")  # pula as travas de estado e a FK; o banco é isolado
            for t in ("adm_pareceres", "adm_overrides", "adm_vinculos", "adm_pendencia_propostas", "adm_propostas", "adm_decisoes",
                      "adm_pendencias", "adm_pedidos", "adm_tentativas", "adm_evidencias", "adm_rodadas"):
                self.c.execute(f"delete from {t}")
            self.c.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
            self.c.execute("delete from mandate_contacts where mandate_id in (select m.id from mandates m join people p on p.id = m.person_id where p.slug like 'zt-%')")
            self.c.execute("delete from mandates where person_id in (select id from people where slug like 'zt-%')")
            self.c.execute("delete from people where slug like 'zt-%'")
            self.c.execute("delete from data_coverage where place_id in (select id from places where ibge_code like 'ZT%')")
            self.c.execute("delete from sapl_houses where place_id in (select id from places where ibge_code like 'ZT%')")
            self.c.execute("delete from places where ibge_code like 'ZT%'")
        self.c.execute("alter table data_coverage enable trigger adm_override")

    # ---- fábricas
    def lugar(self, ibge: str | None = None) -> dict:
        ibge = ibge or "ZT" + uuid.uuid4().hex[:8]
        return self.one(
            "insert into places (ibge_code, kind, name, slug, uf) values (%s, 'municipio', %s, %s, 'SP') returning id, ibge_code",
            (ibge, "Teste " + ibge, "zt-" + ibge.lower()),
        )

    def rodada(self, status: str = "aberta") -> str:
        return self.one("insert into adm_rodadas (coletor, modo, status) values ('sapl', 'descobrir', %s) returning id", (status,))["id"]

    def pedido(self, status: str = "na_fila", chave: str | None = None) -> str:
        return self.one("insert into adm_pedidos (tipo, chave_idem, status) values ('rodada', %s, %s) returning id", (chave or uuid.uuid4().hex, status))["id"]

    def pendencia(self, status: str = "aberta", classe: str = "cobertura") -> str:
        return self.one(
            "insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo, status) values (%s, %s, 'reason', 'Qual é o valor?', 'mudanca', %s) returning id",
            (classe, uuid.uuid4().hex, status),
        )["id"]

    def decisao(self, tipo: str = "pessoa") -> str:
        pid = self.pendencia()
        if tipo == "pessoa":
            return self.one(
                "insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa) values (%s, 'aprovar', 'pessoa', 'Fulana', 'conferi na página') returning id", (pid,)
            )["id"]
        return self.one(
            "insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, relatorio, versao_verificador, justificativa) "
            "values (%s, 'aprovar', 'agentes', '{\"ok\": true}', 1, 'verificado') returning id", (pid,)
        )["id"]

    def override(self, classe: str, chave: str, campo: str, valor=None, suprimir: bool = False, vigente: bool = True) -> str:
        return self.one(
            "insert into adm_overrides (classe, registro_chave, campo, valor, suprimir, decisao_id, vigente) values (%s, %s, %s, %s::jsonb, %s, %s, %s) returning id",
            (classe, chave, campo, None if valor is None else json.dumps(valor), suprimir, self.decisao(), vigente),
        )["id"]

    def fecha(self):
        self.c.close()


@pytest.fixture
def db(banco_isolado):  # noqa: F811
    d = Db(banco_isolado)
    d.limpar()
    try:
        yield d
    finally:
        try:
            d.limpar()
        finally:
            d.fecha()


# ------------------------------------------------------------------ tabelas, RLS, privilégios


def test_onze_tabelas_com_rls_sem_policy_e_sem_privilegio(db):
    existentes = {r["tablename"] for r in db.x("select tablename from pg_tables where schemaname = 'public' and tablename like 'adm\\_%'").fetchall()}
    assert existentes == set(TABELAS_ADM)
    for t in TABELAS_ADM:
        assert db.one("select relrowsecurity as r from pg_class where oid = %s::regclass", (f"public.{t}",))["r"], f"{t} sem RLS"
    # a 0153 cria só as policies do admin_central; qualquer policy de outro role (ou `to public`) continua falhando aqui (as do admin_central: test_admin_grants.py)
    assert db.x("select tablename, policyname from pg_policies where tablename like 'adm\\_%' and roles <> '{admin_central}'").fetchall() == []
    roles = [r["rolname"] for r in db.x("select rolname from pg_roles where rolname = any(%s)", (list(ROLES_SEM_ACESSO),)).fetchall()]
    assert {"web_reader", "anon", "authenticated"} <= set(roles), roles  # os que a migração local cria
    for role in roles:
        for t in TABELAS_ADM:
            for priv in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"):
                assert not db.one("select has_table_privilege(%s, %s, %s) as p", (role, f"public.{t}", priv))["p"], f"{role} tem {priv} em {t}"
            assert not db.one("select has_any_column_privilege(%s, %s, 'select,insert,update,references') as p", (role, f"public.{t}"))["p"], f"{role} tem privilégio de coluna em {t}"


def test_fonte_curadoria_existe(db):
    r = db.one("select slug, name, url, license from sources where slug = 'curadoria'")
    assert r and r["url"] and r["license"]


# ------------------------------------------------------------------ check


def test_proposta_sem_url_trecho_ou_hash_e_recusada(db):
    base = dict(classe="cobertura", registro_chave="3509502:presenca", campo="reason", url="https://x.gov.br/a", trecho="texto", conteudo_sha256=SHA)

    def ins(**kw):
        d = {**base, "chave_idem": uuid.uuid4().hex, **kw}
        cols = [k for k, v in d.items() if v is not ...]
        db.x(f"insert into adm_propostas ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})", [d[k] for k in cols])

    ins()  # o válido entra
    for kw in ({"url": None}, {"url": "  "}, {"trecho": None}, {"trecho": ""}, {"conteudo_sha256": None}, {"conteudo_sha256": " "}, {"conteudo_sha256": "abc"}, {"conteudo_sha256": "z" * 64}):
        with pytest.raises((pe.NotNullViolation, pe.CheckViolation)):
            ins(**kw)
    with pytest.raises(pe.UniqueViolation):
        ins(chave_idem="repetida")
        ins(chave_idem="repetida")
    # alcance de regra exige critério e ids
    with pytest.raises(pe.CheckViolation):
        ins(alcance="regra")
    with pytest.raises(pe.CheckViolation):
        ins(alcance="regra", regra_criterio="mesmo prefixo")
    db.x("insert into adm_propostas (classe, registro_chave, campo, url, trecho, conteudo_sha256, chave_idem, alcance, regra_criterio, regra_ids) values ('cobertura','a:b','reason','u','t',%s,%s,'regra','mesmo prefixo','[1,2]')", (SHA, uuid.uuid4().hex))
    with pytest.raises(pe.CheckViolation):
        ins(classe="outra")


def test_decisao_sem_justificativa_e_recusada(db):
    pid = db.pendencia()
    for j in (None, "", "   "):
        with pytest.raises((pe.NotNullViolation, pe.CheckViolation)):
            db.x("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa) values (%s,'aprovar','pessoa','Fulana',%s)", (pid, j))
    with pytest.raises(pe.CheckViolation):  # pessoa sem nome
        db.x("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, justificativa) values (%s,'aprovar','pessoa','x')", (pid,))
    with pytest.raises(pe.CheckViolation):  # agentes sem relatório
        db.x("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, justificativa) values (%s,'aprovar','agentes','x')", (pid,))
    with pytest.raises(pe.CheckViolation):  # ação fora da lista
        db.x("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa) values (%s,'apagar','pessoa','F','x')", (pid,))


def test_pedido_duplicado_so_depois_de_terminar(db):
    db.x("insert into adm_pedidos (tipo, chave_idem) values ('recoleta', 'k1')")
    with pytest.raises(pe.UniqueViolation):
        db.x("insert into adm_pedidos (tipo, chave_idem) values ('recoleta', 'k1')")
    db.x("update adm_pedidos set status = 'em_execucao' where chave_idem = 'k1'")
    with pytest.raises(pe.UniqueViolation):  # em execução também ocupa a chave
        db.x("insert into adm_pedidos (tipo, chave_idem) values ('recoleta', 'k1')")
    db.x("update adm_pedidos set status = 'concluido' where chave_idem = 'k1'")
    db.x("insert into adm_pedidos (tipo, chave_idem) values ('recoleta', 'k1')")  # agora entra
    assert db.one("select count(*) as n from adm_pedidos where chave_idem = 'k1'")["n"] == 2


def test_demais_checks_de_valor_fechado(db):
    rid = db.rodada()
    with pytest.raises(pe.CheckViolation):
        db.x("insert into adm_rodadas (coletor, modo) values ('sapl', 'inventar')")
    with pytest.raises(pe.CheckViolation):  # falha exige motivo
        db.x("insert into adm_tentativas (rodada_id, url, url_sha, resultado) values (%s, 'u', 's', 'falha')", (rid,))
    with pytest.raises(pe.CheckViolation):  # motivo só em falha
        db.x("insert into adm_tentativas (rodada_id, url, url_sha, resultado, motivo) values (%s, 'u', 's', 'lida', 'erro')", (rid,))
    db.x("insert into adm_tentativas (rodada_id, url, url_sha, resultado, motivo) values (%s, 'u', 's', 'falha', 'robots')", (rid,))
    db.x("insert into adm_tentativas (rodada_id, url, url_sha, resultado) values (%s, 'u', 's', 'lida')", (rid,))
    assert db.one("select entrada from adm_tentativas limit 1")["entrada"] is False
    with pytest.raises(pe.CheckViolation):
        db.x("insert into adm_pareceres (pendencia_id, modelo, modo, simulado) values (%s, 'm', 'real', false)", (db.pendencia(),))
    db.x("insert into adm_pareceres (pendencia_id, modelo, modo, simulado) values (%s, 'm', 'ensaio', true)", (db.pendencia(),))
    with pytest.raises(pe.CheckViolation):  # pendência reaberta exige motivo
        db.x("insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo, reaberta) values ('cobertura','a','b','p','mudanca', true)")
    with pytest.raises(pe.UniqueViolation):  # uma pendência por (classe, registro, campo)
        db.x("insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo) values ('cobertura','u','c','p','mudanca')")
        db.x("insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo) values ('cobertura','u','c','p','duplicata')")
    # override vigente único por (classe, registro, campo); histórico não vigente pode repetir
    db.override("cobertura", "k:x", "reason", "a")
    with pytest.raises(pe.UniqueViolation):
        db.override("cobertura", "k:x", "reason", "b")
    db.override("cobertura", "k:x", "reason", "c", vigente=False)
    with pytest.raises(pe.CheckViolation):  # sem valor e sem suprimir
        db.override("cobertura", "k:y", "reason")
    # vínculo vigente único
    d = db.decisao()
    for _ in range(2):
        try:
            db.x("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem, decisao_id) values ('vinculo_sapl','1','u','s','correcao_manual',%s)", (d,))
        except pe.UniqueViolation:
            break
    else:
        pytest.fail("vínculo vigente repetido foi aceito")


def test_indice_da_fila_serve_a_ordenacao_sem_pessoa_partido_ou_popularidade(db):
    cols = {r["column_name"] for r in db.x("select column_name from information_schema.columns where table_name = 'adm_pendencias'").fetchall()}
    assert not [c for c in cols if re.search(r"pessoa|person|partido|party|popular|follow|seguid|visit|view", c)], cols
    ddl = db.one("select indexdef from pg_indexes where indexname = 'adm_pendencias_fila_idx'")["indexdef"]
    assert "(classe, tipo, vence_em, cobertura_recorte, id)" in ddl and "status = 'aberta'" in ddl


# ------------------------------------------------------------------ transições


RODADA = {("aberta", "em_andamento"), ("em_andamento", "concluida"), ("em_andamento", "interrompida"), ("em_andamento", "falhou"), ("interrompida", "em_andamento")}
PEDIDO = {("na_fila", "em_execucao"), ("em_execucao", "concluido"), ("em_execucao", "falhou"), ("em_execucao", "interrompido")}


def _matriz(db, tabela, estados, permitidas, criar):
    for de in estados:
        for para in estados:
            if de == para:
                continue
            i = criar(de)
            if (de, para) in permitidas:
                db.x(f"update {tabela} set status = %s where id = %s", (para, i))
                assert db.one(f"select status from {tabela} where id = %s", (i,))["status"] == para
            else:
                with pytest.raises(pe.RaiseException, match="não permitida"):
                    db.x(f"update {tabela} set status = %s where id = %s", (para, i))
                assert db.one(f"select status from {tabela} where id = %s", (i,))["status"] == de


def test_transicoes_da_rodada(db):
    _matriz(db, "adm_rodadas", ("aberta", "em_andamento", "concluida", "interrompida", "falhou"), RODADA, db.rodada)
    i = db.rodada("concluida")
    db.x("update adm_rodadas set finalizada_em = now() where id = %s", (i,))  # mudar outra coluna não é transição


def test_transicoes_do_pedido(db):
    _matriz(db, "adm_pedidos", ("na_fila", "em_execucao", "concluido", "falhou", "interrompido"), PEDIDO, db.pedido)


def test_transicoes_da_pendencia(db):
    a = db.pendencia("aberta")
    db.x("update adm_pendencias set status = 'decidida' where id = %s", (a,))
    with pytest.raises(pe.RaiseException, match="reaberta"):
        db.x("update adm_pendencias set status = 'aberta' where id = %s", (a,))
    with pytest.raises(pe.RaiseException, match="reaberta"):  # reaberta sem motivo
        db.x("update adm_pendencias set status = 'aberta', reaberta = true where id = %s", (a,))
    with pytest.raises(pe.RaiseException, match="reaberta"):  # motivo sem reaberta
        db.x("update adm_pendencias set status = 'aberta', motivo_reabertura = 'evidencia_mudou' where id = %s", (a,))
    db.x("update adm_pendencias set status = 'aberta', reaberta = true, motivo_reabertura = 'evidencia_mudou' where id = %s", (a,))
    assert db.one("select status, reaberta from adm_pendencias where id = %s", (a,)) == {"status": "aberta", "reaberta": True}
    db.x("update adm_pendencias set status = 'decidida' where id = %s", (a,))  # decide de novo


def test_decisao_e_imutavel(db):
    d = db.decisao()
    with pytest.raises(pe.RaiseException, match="trilha"):
        db.x("delete from adm_decisoes where id = %s", (d,))
    for set_ in ("justificativa = 'outra'", "acao = 'descartar'", "decidido_por_nome = 'Beltrano'", "valor = '1'", "pendencia_id = gen_random_uuid()"):
        with pytest.raises(pe.RaiseException, match="não se altera"):
            db.x(f"update adm_decisoes set {set_} where id = %s", (d,))
    with pytest.raises(pe.RaiseException, match="entra não aplicada"):
        db.x("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa, aplicada, aplicada_em) values (%s,'aprovar','pessoa','F','x',true,now())", (db.pendencia(),))
    with pytest.raises(pe.RaiseException, match="aplicada_em"):
        db.x("update adm_decisoes set aplicada_em = now() where id = %s", (d,))
    db.x("update adm_decisoes set aplicada = true where id = %s", (d,))
    r = db.one("select aplicada, aplicada_em from adm_decisoes where id = %s", (d,))
    assert r["aplicada"] and r["aplicada_em"] is not None
    with pytest.raises(pe.RaiseException, match="não volta atrás"):
        db.x("update adm_decisoes set aplicada = false, aplicada_em = null where id = %s", (d,))
    with pytest.raises(pe.RaiseException, match="não volta atrás"):
        db.x("update adm_decisoes set aplicada_em = now() + interval '1 day' where id = %s", (d,))
    assert db.one("select count(*) as n from adm_decisoes where id = %s", (d,))["n"] == 1


def test_segunda_chave_das_decisoes_de_agentes(db):
    ag, pessoa = db.decisao("agentes"), db.decisao("pessoa")
    assert db.one("select count(*) as n from pipeline_switches where name = 'admin_coleta_agentes'")["n"] == 0  # a migração não insere a linha
    with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
        db.x("update adm_decisoes set aplicada = true where id = %s", (ag,))
    db.x("insert into pipeline_switches (name, value, note) values ('admin_coleta_agentes', 'off', 'teste A1')")
    try:
        with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
            db.x("update adm_decisoes set aplicada = true where id = %s", (ag,))
        assert db.one("select aplicada from adm_decisoes where id = %s", (ag,))["aplicada"] is False
        db.x("update pipeline_switches set value = 'on' where name = 'admin_coleta_agentes'")
        db.x("update adm_decisoes set aplicada = true where id = %s", (ag,))
        assert db.one("select aplicada, aplicada_em is not null as em from adm_decisoes where id = %s", (ag,)) == {"aplicada": True, "em": True}
    finally:
        db.x("delete from pipeline_switches where name = 'admin_coleta_agentes'")
    # decisão de pessoa passa sem a linha
    db.x("update adm_decisoes set aplicada = true where id = %s", (pessoa,))
    assert db.one("select aplicada from adm_decisoes where id = %s", (pessoa,))["aplicada"] is True


# ------------------------------------------------------------------ gatilhos de override, com a função real civico_etl.db.upsert

HOJE = date(2026, 11, 15)


def _casa(db, lugar, status, base_url, note="nota do job"):
    cx = db.rw()
    try:
        upsert(
            cx, "sapl_houses", ["place_id", "registry_url", "status", "base_url", "note", "checked_at"],
            [(lugar["id"], "https://registro/x", status, base_url, note, datetime.now(timezone.utc))], ["place_id"],
            update=["base_url", "status", "note", "checked_at"],  # como discover_ales (sapl.py:672)
        )
        cx.commit()
    finally:
        cx.close()
    return db.one("select id, status, base_url, note from sapl_houses where place_id = %s", (lugar["id"],))


def test_override_em_sapl_houses(db):
    lugar = db.lugar()
    h = _casa(db, lugar, "ok", "https://job/sapl")
    assert (h["status"], h["base_url"]) == ("ok", "https://job/sapl")  # sem override: o valor do job
    ov = db.override("vinculo_sapl", str(h["id"]), "status", "fora_do_ar")
    h2 = _casa(db, lugar, "sem_api", "https://job/sapl2", note="nota nova")
    assert h2["status"] == "fora_do_ar"  # o override vence o job
    assert (h2["base_url"], h2["note"]) == ("https://job/sapl2", "nota nova")  # o resto da linha continua sendo atualizado
    db.override("vinculo_sapl", str(h["id"]), "base_url", "https://curadoria/sapl")
    h3 = _casa(db, lugar, "ok", "https://job/sapl3", note="n3")
    assert (h3["status"], h3["base_url"], h3["note"]) == ("fora_do_ar", "https://curadoria/sapl", "n3")
    # override desligado não tem efeito
    db.x("update adm_overrides set vigente = false where classe = 'vinculo_sapl'")
    h4 = _casa(db, lugar, "sem_api", "https://job/sapl4")
    assert (h4["status"], h4["base_url"]) == ("sem_api", "https://job/sapl4")
    # override de outra casa não vaza
    outro = db.lugar()
    h5 = _casa(db, outro, "ok", "https://job/outra")
    db.override("vinculo_sapl", str(h["id"]), "status", "robots_bloqueia")
    assert _casa(db, outro, "ok", "https://job/outra")["status"] == "ok"
    assert ov


def test_override_em_data_coverage(db):
    lugar = db.lugar()
    ibge = lugar["ibge_code"]
    cols = ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"]

    def job(status, reason, ev="https://job/ev"):
        cx = db.rw()
        try:
            upsert(cx, "data_coverage", cols, [(lugar["id"], "presenca", status, reason, ev, HOJE)], ["place_id", "dataset"])  # como set_coverage (sapl.py:639)
            cx.commit()
        finally:
            cx.close()
        return db.one("select status, reason, evidence_url from data_coverage where place_id = %s and dataset = 'presenca'", (lugar["id"],))

    assert job("carregando", "job 1") == {"status": "carregando", "reason": "job 1", "evidence_url": "https://job/ev"}
    db.override("cobertura", f"{ibge}:presenca", "reason", "texto da curadoria")
    assert job("desconhecido", "job 2", "https://job/ev2") == {"status": "desconhecido", "reason": "texto da curadoria", "evidence_url": "https://job/ev2"}
    # update direto, como assembleias.py:376
    db.x("update data_coverage set status = 'so_portal', reason = 'direto' where place_id = %s and dataset = 'presenca'", (lugar["id"],))
    assert db.one("select status, reason from data_coverage where place_id = %s and dataset = 'presenca'", (lugar["id"],)) == {"status": "so_portal", "reason": "texto da curadoria"}
    # linha apagada e recriada (derive_stats): o override vale também no insert
    db.x("delete from data_coverage where place_id = %s", (lugar["id"],))
    db.x("insert into data_coverage (place_id, dataset, status, reason, checked_on) values (%s, 'presenca', 'desconhecido', 'padrão', %s) on conflict (place_id, dataset) do nothing", (lugar["id"], HOJE))
    assert db.one("select reason from data_coverage where place_id = %s", (lugar["id"],))["reason"] == "texto da curadoria"
    # outro dataset do mesmo lugar não é afetado; evidence_url e status também têm override
    assert job("carregando", "x") ["reason"] == "texto da curadoria"
    db.x("insert into data_coverage (place_id, dataset, status, reason, checked_on) values (%s, 'votos', 'desconhecido', 'padrão', %s)", (lugar["id"], HOJE))
    assert db.one("select reason from data_coverage where place_id = %s and dataset = 'votos'", (lugar["id"],))["reason"] == "padrão"
    db.override("cobertura", f"{ibge}:presenca", "status", "nao_publica")
    db.override("cobertura", f"{ibge}:presenca", "evidence_url", "https://curadoria/ev")
    r = job("carregando", "y", "https://job/ev3")
    assert (r["status"], r["evidence_url"]) == ("nao_publica", "https://curadoria/ev")
    # sem override vigente a linha volta a seguir o job
    db.x("update adm_overrides set vigente = false where classe = 'cobertura'")
    assert job("carregando", "z", "https://job/ev4") == {"status": "carregando", "reason": "z", "evidence_url": "https://job/ev4"}


def test_override_suprime_contato_do_mandato(db):
    lugar = db.lugar()
    pessoa = db.one("insert into people (slug, display_name) values (%s, 'Fulano de Teste') returning id", ("zt-" + uuid.uuid4().hex[:8],))["id"]
    office = db.one("select id from offices limit 1")["id"]
    mandato = db.one(
        "insert into mandates (person_id, office_id, place_id, status, started_on, ends_on, status_source) values (%s,%s,%s,'em_exercicio','2023-02-01','2027-01-31','teste') returning id",
        (pessoa, office, lugar["id"]),
    )["id"]
    fonte = db.one("select id from sources where slug = 'curadoria'")["id"]

    def job(*contatos):
        cx = db.rw()
        try:
            upsert(cx, "mandate_contacts", ["mandate_id", "kind", "value", "source_id"], [(mandato, k, v, fonte) for k, v in contatos],
                   ["mandate_id", "kind", "value"], update=[], returning=["id"])  # como parlamento_extras.py:126
            cx.commit()
        finally:
            cx.close()
        return {(r["kind"], r["value"]) for r in db.x("select kind, value from mandate_contacts where mandate_id = %s", (mandato,)).fetchall()}

    assert job(("email", "a@x.gov.br")) == {("email", "a@x.gov.br")}
    db.x("delete from mandate_contacts where mandate_id = %s", (mandato,))  # sem gatilho de delete: apagar continua possível
    db.override("contato_mandato", str(mandato), "email:a@x.gov.br", suprimir=True)
    assert job(("email", "a@x.gov.br")) == set()  # suprimido: não cria linha
    assert job(("email", "b@x.gov.br"), ("telefone", "a@x.gov.br")) == {("email", "b@x.gov.br"), ("telefone", "a@x.gov.br")}  # outro valor e outro tipo entram
    db.x("update adm_overrides set vigente = false where classe = 'contato_mandato'")
    assert ("email", "a@x.gov.br") in job(("email", "a@x.gov.br"))  # override desligado: entra
    db.x("delete from mandates where id = %s", (mandato,))  # cascata do mandato segue funcionando com override ligado
    db.override("contato_mandato", str(mandato), "email:c@x.gov.br", suprimir=True)
    assert db.one("select count(*) as n from mandate_contacts where mandate_id = %s", (mandato,))["n"] == 0


# ------------------------------------------------------------------ medição do custo dos gatilhos

DATASETS = ("salario_prefeito", "salario_vereadores", "salario_deputados_estaduais", "presenca", "votos", "propostas", "gastos_gabinete", "discursos", "equipe", "emendas", "comissoes", "viagens", "contato")
N_LINHAS = 33_000


def test_medicao_do_custo_dos_gatilhos_em_data_coverage(db):
    """Insere ~33 mil linhas (o tamanho do COVERAGE_SQL de derive_stats) com `on conflict do nothing`, com o gatilho ligado e desligado.
    Dois cenários: linhas novas, e todas já existentes (o caso comum do derive.stats, em que o gatilho dispara e o insert cai em do nothing)."""
    db.x("insert into places (ibge_code, kind, name, slug, uf) select 'ZT'||lpad(g::text, 5, '0'), 'municipio', 'Teste '||g, 'zt-med-'||g, 'SP' from generate_series(1, 2600) g")
    db.x(
        "create temp table zt_prop as select p.id as place_id, d as dataset from places p cross join unnest(%s::text[]) d where p.ibge_code like 'ZT%%' order by p.ibge_code, d limit %s",
        (list(DATASETS), N_LINHAS),
    )
    assert db.one("select count(*) as n from zt_prop")["n"] == N_LINHAS
    ins = ("insert into data_coverage (place_id, dataset, status, reason, checked_on) select place_id, dataset, 'desconhecido', 'medição', current_date from zt_prop "
           "on conflict (place_id, dataset) do nothing")

    def tempo(ligado: bool, existentes: bool, vezes: int = 3) -> float:
        db.x(f"alter table data_coverage {'enable' if ligado else 'disable'} trigger adm_override")
        melhor = float("inf")
        for _ in range(vezes):
            db.x("delete from data_coverage where place_id in (select id from places where ibge_code like 'ZT%')")
            if existentes:
                db.x(ins)
            t0 = time.perf_counter()
            db.x(ins)
            melhor = min(melhor, time.perf_counter() - t0)
        return melhor

    linhas = []
    resultado = {}
    for rotulo, preparo in (("0 override", None), ("1 override de outra linha", True)):
        if preparo:
            db.override("cobertura", "ZZ9999999:presenca", "reason", "nunca casa")
        for existentes in (False, True):
            sem = tempo(False, existentes)
            com = tempo(True, existentes)
            resultado[(rotulo, existentes)] = (sem, com)
            cen = "linhas já existentes (do nothing)" if existentes else "linhas novas"
            linhas.append(f"  {rotulo:27s} {cen:34s} sem gatilho {sem*1000:8.1f} ms | com gatilho {com*1000:8.1f} ms | acréscimo {100*(com-sem)/sem:+7.1f}% | {1e6*(com-sem)/N_LINHAS:6.2f} µs/linha")
    db.x("alter table data_coverage enable trigger adm_override")
    print(f"\nMEDIÇÃO data_coverage, {N_LINHAS} linhas propostas, melhor de 3:\n" + "\n".join(linhas))
    for (rotulo, existentes), (sem, com) in resultado.items():
        teto = max(5 * sem, sem + 1.0) if rotulo == "0 override" else max(15 * sem, sem + 3.0)
        assert com < teto, f"{rotulo}, existentes={existentes}: {com:.3f}s com gatilho contra {sem:.3f}s sem"


# ------------------------------------------------------------------ 0151: anotação do que o job tentou gravar (B3a)


def _ov(db, oid):
    return db.one("select valor, tentou_valor, tentou_em, tentou_vezes from adm_overrides where id = %s", (oid,))


def test_0151_colunas_novas_nulas_ou_com_default(db):
    cols = {r["column_name"]: r for r in db.x(
        "select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name = 'adm_overrides' and column_name like 'tentou%%'").fetchall()}
    assert set(cols) == {"tentou_valor", "tentou_em", "tentou_vezes"}
    assert (cols["tentou_valor"]["data_type"], cols["tentou_valor"]["is_nullable"]) == ("jsonb", "YES")
    assert (cols["tentou_em"]["data_type"], cols["tentou_em"]["is_nullable"]) == ("timestamp with time zone", "YES")
    assert (cols["tentou_vezes"]["is_nullable"], cols["tentou_vezes"]["column_default"]) == ("NO", "0")
    assert db.one("select relrowsecurity, (select count(*) from pg_policies where tablename = 'adm_overrides' and roles <> '{admin_central}') as pol from pg_class where relname = 'adm_overrides'") == {"relrowsecurity": True, "pol": 0}
    assert db.one("select count(*) as n from pg_trigger where tgrelid = 'sapl_houses'::regclass and tgname = 'adm_override'")["n"] == 1  # o gatilho da 0150 não foi recriado nem duplicado


def test_0151_sapl_houses_anota_o_que_o_job_tentou_e_mantem_o_decidido(db):
    lugar = db.lugar()
    h = _casa(db, lugar, "ok", "https://job/sapl")
    oid = db.override("vinculo_sapl", str(h["id"]), "status", "sem_api")
    assert _ov(db, oid)["tentou_valor"] is None and _ov(db, oid)["tentou_vezes"] == 0
    h2 = _casa(db, lugar, "fora_do_ar", "https://job/sapl", note="n1")
    assert h2["status"] == "sem_api"  # o decidido continua
    a = _ov(db, oid)
    assert a["tentou_valor"] == "fora_do_ar" and a["tentou_vezes"] == 1 and a["tentou_em"] is not None and a["valor"] == "sem_api"
    # segundo upsert idêntico: não conta de novo e não mexe no horário
    _casa(db, lugar, "fora_do_ar", "https://job/sapl", note="n2")
    b = _ov(db, oid)
    assert (b["tentou_valor"], b["tentou_vezes"], b["tentou_em"]) == ("fora_do_ar", 1, a["tentou_em"])
    # valor novo diferente do decidido e do anotado: conta
    _casa(db, lugar, "robots_bloqueia", "https://job/sapl", note="n3")
    c = _ov(db, oid)
    assert (c["tentou_valor"], c["tentou_vezes"]) == ("robots_bloqueia", 2) and c["tentou_em"] >= a["tentou_em"]
    # a fonte concorda com o decidido: limpa o valor, mantém contador e horário
    h4 = _casa(db, lugar, "sem_api", "https://job/sapl", note="n4")
    d = _ov(db, oid)
    assert h4["status"] == "sem_api" and d["tentou_valor"] is None and d["tentou_vezes"] == 2 and d["tentou_em"] == c["tentou_em"]
    # NULL tentado fica anotado como o jsonb 'null' (não confunde com "nunca divergiu")
    oid2 = db.override("vinculo_sapl", str(h["id"]), "base_url", "https://curadoria/sapl")
    cx = db.rw()
    try:
        cx.execute("update sapl_houses set base_url = null where id = %s", (h["id"],))
        cx.commit()
    finally:
        cx.close()
    assert db.one("select base_url from sapl_houses where id = %s", (h["id"],))["base_url"] == "https://curadoria/sapl"
    assert _ov(db, oid2)["tentou_valor"] is None and db.one("select tentou_valor is not null as marcado, tentou_valor = 'null'::jsonb as e_null from adm_overrides where id = %s", (oid2,)) == {"marcado": True, "e_null": True}


def test_0151_sapl_houses_sem_override_nada_e_anotado_e_o_resultado_e_o_mesmo(db):
    lugar = db.lugar()
    h = _casa(db, lugar, "ok", "https://job/sapl")
    outra = db.lugar()
    ho = _casa(db, outra, "ok", "https://job/outra")
    oid = db.override("vinculo_sapl", str(ho["id"]), "status", "sem_api")  # override de OUTRA casa
    h2 = _casa(db, lugar, "fora_do_ar", "https://job/sapl2", note="n")
    assert (h2["status"], h2["base_url"], h2["note"]) == ("fora_do_ar", "https://job/sapl2", "n")  # idêntico ao que o job gravou
    assert _ov(db, oid)["tentou_valor"] is None and _ov(db, oid)["tentou_vezes"] == 0  # a anotação não vaza para o override de outra casa
    db.x("update adm_overrides set vigente = false where id = %s", (oid,))
    _casa(db, outra, "fora_do_ar", "https://job/outra")
    assert _ov(db, oid)["tentou_vezes"] == 0  # override desligado não anota


def _cob(db, lugar, status, reason, ev="https://job/ev", ds="presenca", checked=HOJE):
    cx = db.rw()
    try:
        upsert(cx, "data_coverage", ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"], [(lugar["id"], ds, status, reason, ev, checked)], ["place_id", "dataset"])
        cx.commit()
    finally:
        cx.close()
    return db.one("select status, reason, evidence_url from data_coverage where place_id = %s and dataset = %s", (lugar["id"], ds))


def test_0151_data_coverage_upsert_e_update_direto(db):
    lugar = db.lugar()
    ibge = lugar["ibge_code"]
    _cob(db, lugar, "carregando", "job 1")
    o_reason = db.override("cobertura", f"{ibge}:presenca", "reason", "texto da curadoria")
    o_status = db.override("cobertura", f"{ibge}:presenca", "status", "nao_publica")
    # upsert: o job tenta outro status e outro motivo
    r = _cob(db, lugar, "desconhecido", "job 2", checked=date(2026, 11, 16))
    assert (r["status"], r["reason"]) == ("nao_publica", "texto da curadoria") and r["evidence_url"] == "https://job/ev"
    a, b = _ov(db, o_reason), _ov(db, o_status)
    assert (a["tentou_valor"], a["tentou_vezes"]) == ("job 2", 1) and (b["tentou_valor"], b["tentou_vezes"]) == ("desconhecido", 1)  # UMA vez cada (INSERT e UPDATE do upsert não contam em dobro)
    # idêntico: não conta (a data muda para o UPDATE acontecer)
    _cob(db, lugar, "desconhecido", "job 2", checked=date(2026, 11, 17))
    assert (_ov(db, o_reason)["tentou_vezes"], _ov(db, o_status)["tentou_vezes"], _ov(db, o_reason)["tentou_em"]) == (1, 1, a["tentou_em"])
    # a fonte concorda no motivo (e discorda no status): só o motivo é limpo
    _cob(db, lugar, "desconhecido", "texto da curadoria", checked=date(2026, 11, 18))
    assert _ov(db, o_reason)["tentou_valor"] is None and _ov(db, o_status)["tentou_valor"] == "desconhecido"
    # update direto (como assembleias.py:376)
    db.x("update data_coverage set status = 'so_portal', reason = 'direto' where place_id = %s and dataset = 'presenca'", (lugar["id"],))
    assert db.one("select status, reason from data_coverage where place_id = %s and dataset = 'presenca'", (lugar["id"],)) == {"status": "nao_publica", "reason": "texto da curadoria"}
    assert (_ov(db, o_status)["tentou_valor"], _ov(db, o_status)["tentou_vezes"]) == ("so_portal", 2) and (_ov(db, o_reason)["tentou_valor"], _ov(db, o_reason)["tentou_vezes"]) == ("direto", 2)
    db.x("update data_coverage set status = 'nao_publica', reason = 'texto da curadoria' where place_id = %s and dataset = 'presenca'", (lugar["id"],))
    assert _ov(db, o_status)["tentou_valor"] is None and _ov(db, o_reason)["tentou_valor"] is None  # o update direto igual ao decidido limpa
    # outro dataset do mesmo lugar e lugar sem override: nada anotado
    _cob(db, lugar, "carregando", "x", ds="votos")
    assert _ov(db, o_reason)["tentou_vezes"] == 2


def test_0151_data_coverage_insert_on_conflict_do_nothing_nao_anota_mas_insert_que_cria_anota(db):
    """Decisão: `insert ... on conflict do nothing` sobre chave que já existe NÃO é "o job tentou gravar" (a linha proposta é descartada: é o derive.stats). O INSERT que
    efetivamente cria a linha (chave ausente) anota, como o UPDATE. Ver regra 3 no cabeçalho da 0151."""
    lugar = db.lugar()
    ibge = lugar["ibge_code"]
    cols = "(place_id, dataset, status, reason, checked_on)"
    nada = f"insert into data_coverage {cols} values (%s, 'presenca', 'desconhecido', 'padrão do derive', %s) on conflict (place_id, dataset) do nothing"
    oid = db.override("cobertura", f"{ibge}:presenca", "reason", "texto da curadoria")
    db.x(nada, (lugar["id"], HOJE))  # a linha não existe: o insert a cria; o override vale e a tentativa é anotada
    assert db.one("select reason from data_coverage where place_id = %s", (lugar["id"],))["reason"] == "texto da curadoria"
    assert (_ov(db, oid)["tentou_valor"], _ov(db, oid)["tentou_vezes"]) == ("padrão do derive", 1)
    db.x("update adm_overrides set tentou_valor = null, tentou_vezes = 0 where id = %s", (oid,))
    db.x(nada, (lugar["id"], HOJE))  # a linha existe: do nothing; nada é anotado e a tabela não muda
    assert db.one("select reason from data_coverage where place_id = %s", (lugar["id"],))["reason"] == "texto da curadoria"
    assert (_ov(db, oid)["tentou_valor"], _ov(db, oid)["tentou_vezes"]) == (None, 0)
    # com a linha existente, o mesmo insert em forma de do update (set_coverage via db.upsert) anota UMA vez (ver teste do upsert)
    _cob(db, lugar, "carregando", "do update")
    assert (_ov(db, oid)["tentou_valor"], _ov(db, oid)["tentou_vezes"]) == ("do update", 1)


def test_0151_anotacao_da_mesma_transacao_nao_e_desfeita(db):
    lugar = db.lugar()
    ibge = lugar["ibge_code"]
    _cob(db, lugar, "carregando", "job 1")
    oid = db.override("cobertura", f"{ibge}:presenca", "reason", "decidido")
    cx = db.rw()
    try:
        cx.execute("update data_coverage set reason = 'tentativa' where place_id = %s and dataset = 'presenca'", (lugar["id"],))
        cx.execute("update data_coverage set reason = 'decidido' where place_id = %s and dataset = 'presenca'", (lugar["id"],))  # mesma transação: não desfaz
        cx.commit()
    finally:
        cx.close()
    assert _ov(db, oid)["tentou_valor"] == "tentativa"
    db.x("update data_coverage set reason = 'decidido' where place_id = %s and dataset = 'presenca'", (lugar["id"],))  # outra transação: limpa
    assert _ov(db, oid)["tentou_valor"] is None
