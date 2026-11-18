"""C1: role `admin_central` e a tabela `adm_pedidos_decisao` (migração 0153; replica/admin-coleta-plano.md, seção 4a).

O role da central é critério de segurança: o teste prova, contra o catálogo e por comportamento, que ele não tem nenhum privilégio a mais
que o declarado (EXPECTATIVA abaixo, escrita à mão: não deriva do que a migração concede).

Tudo roda no banco isolado da sessão (`banco_isolado`, nunca no banco da suíte). O comportamento é provado de duas formas: conectado como
`admin_central` por TCP em localhost com a senha local do `db/local/post_0003_admin_central.sql`, e por `set role admin_central` numa conexão
de superusuário. Linhas escritas pelos casos ficam em transação desfeita; a única linha confirmada (uma pendência, para a FK) é apagada no fim.

Limite declarado: role é do cluster. Como o role já existe (e com login, depois do post local) em qualquer cluster onde a suíte rodou antes, `nologin`
logo após a migração não se prova pelo catálogo: prova-se pelo texto da migração (cria `nologin`, sem senha). O atributo `login` depois do post é provado no catálogo.
"""

from __future__ import annotations

import re
import uuid
from contextlib import contextmanager
from urllib.parse import urlparse, urlunparse

import psycopg
import pytest
from banco_isolado import REPO, banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg import errors as pe
from psycopg.rows import dict_row

ROLE = "admin_central"
SENHA_LOCAL = "admin_central"  # a de db/local/post_0003_admin_central.sql (só local)
MIGRACAO = REPO / "db" / "migrations" / "0153_admin_central.sql"
POST = REPO / "db" / "local" / "post_0003_admin_central.sql"
ADMIN_EMAIL = "operador.local@segueovoto.invalid"  # o admin de db/local/post_0004_admin_local.sql: a 0156 exige admin ativo em todo pedido do admin_central
ADMIN_NOME = "Operador local"

ADM = {
    "adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "adm_propostas", "adm_pendencias",
    "adm_pendencia_propostas", "adm_decisoes", "adm_overrides", "adm_pareceres", "adm_pedidos", "adm_pedidos_decisao",
    "adm_admins",  # 0156: o admin_central só lê
}
ADM_SEM_ACESSO = {"adm_admins_log"}  # 0156: só o dono lê e acrescenta; nenhum grant, nenhuma policy
DOMINIO = {
    "sapl_houses", "data_coverage", "mandate_contacts", "mandates", "places", "legislative_bodies", "offices",
    "identity_match_queue", "sources", "ingest_runs", "dataset_stamps", "etl_schedule_attempts",
}
# EXPECTATIVA exata: tabela -> privilégios do admin_central. Toda tabela de `public` fora desta lista não tem nenhum.
SELECT_EM = ADM | DOMINIO  # tabelas com policy de leitura para o admin_central
COLUNAS_SEM_SELECT = {("identity_match_queue", "raw")}  # 0156: `select` por coluna em identity_match_queue, sem `raw`
SELECT_POR_COLUNA = {"identity_match_queue"}  # sem `select` de tabela inteira (has_table_privilege falso); o privilégio vive nas colunas
INSERT_EM = {"adm_pedidos", "adm_pedidos_decisao"}
PRIVS = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
ROLES_SEM_ACESSO = ("web_reader", "web_writer", "anon", "authenticated")


def esperado(tabela: str, priv: str) -> bool:
    return (priv == "SELECT" and tabela in SELECT_EM and tabela not in SELECT_POR_COLUNA) or (priv == "INSERT" and tabela in INSERT_EM)


def esperado_coluna(tabela: str, coluna: str, priv: str) -> bool:
    """Privilégio efetivo na coluna (tabela inteira ou grant por coluna)."""
    if priv == "SELECT" and tabela in SELECT_POR_COLUNA:
        return (tabela, coluna) not in COLUNAS_SEM_SELECT
    return esperado(tabela, priv)


def com_admin(q: str, email: str = ADMIN_EMAIL) -> str:
    """Acrescenta `por_email` a um `insert ... values (...)` literal: desde a 0156 o pedido do admin_central sem admin ativo é recusado."""
    m = re.match(r"^(insert into \w+) \(([^)]*)\) values \((.*)\)( returning .*)?$", q, re.S)
    assert m, q
    return f"{m.group(1)} ({m.group(2)}, por_email) values ({m.group(3)}, '{email}'){m.group(4) or ''}"


# ------------------------------------------------------------------ conexões


def _url_central(url: str) -> str:
    p = urlparse(url)
    host = p.hostname or "localhost"
    assert host in ("localhost", "127.0.0.1", "::1"), host
    return urlunparse(p._replace(netloc=f"{ROLE}:{SENHA_LOCAL}@{host}:{p.port or 5432}"))


@pytest.fixture(scope="module")
def su(banco_isolado):  # noqa: F811
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=True)
    try:
        yield c
    finally:
        c.close()


@pytest.fixture(scope="module")
def pendencia(su):
    """Pendência confirmada (a FK de adm_pedidos_decisao precisa dela); apagada no fim."""
    pid = su.execute(
        "insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo) values ('cobertura', %s, 'reason', 'Qual é o valor?', 'mudanca') returning id",
        ("zg-" + uuid.uuid4().hex,),
    ).fetchone()["id"]
    try:
        yield pid
    finally:
        with su.transaction():
            su.execute("set local session_replication_role = replica")
            su.execute("delete from adm_pedidos_decisao where pendencia_id = %s", (pid,))
            su.execute("delete from adm_pendencias where id = %s", (pid,))


@pytest.fixture(params=["tcp", "set_role"])
def central(request, banco_isolado, su):  # noqa: F811
    """Conexão que age como admin_central, sem autocommit (cada caso usa `tentar`, que sempre desfaz)."""
    if request.param == "tcp":
        c = psycopg.connect(_url_central(banco_isolado), row_factory=dict_row, connect_timeout=5)
    else:
        c = psycopg.connect(banco_isolado, row_factory=dict_row)
        c.execute(f"set role {ROLE}")
    try:
        assert c.execute("select current_user as u").fetchone()["u"] == ROLE
        yield c
    finally:
        c.close()


def tentar(c, q: str, params=None):
    """Executa `q` numa transação que SEMPRE é desfeita. Devolve (None, linhas) se passou ou (exceção, None) se falhou."""
    try:
        with c.transaction(force_rollback=True):
            cur = c.execute(q, params)
            return None, (cur.fetchall() if cur.description else [])
    except psycopg.Error as e:
        return e, None


def deve_passar(c, q, params=None):
    e, linhas = tentar(c, q, params)
    assert e is None, f"deveria passar: {q[:90]} -> {type(e).__name__}: {e}"
    return linhas


def deve_negar(c, q, params=None, tipo=pe.InsufficientPrivilege):
    e, _ = tentar(c, q, params)
    assert e is not None, f"deveria falhar: {q[:90]}"
    assert isinstance(e, tipo), f"{q[:90]} falhou com {type(e).__name__} ({e}), esperado {tipo.__name__}"


def _tabelas(su) -> list[str]:
    return [r["tablename"] for r in su.execute("select tablename from pg_tables where schemaname = 'public' order by 1").fetchall()]


# ------------------------------------------------------------------ 1. atributos do role


def test_texto_da_migracao_cria_nologin_sem_senha():
    sql = MIGRACAO.read_text()
    codigo = "\n".join(l.split("--")[0] for l in sql.splitlines())
    assert re.search(r"if not exists \(select 1 from pg_roles where rolname = 'admin_central'\)\s*then\s*create role admin_central nologin;", codigo)
    assert not re.search(r"password|\blogin\b(?!\s*;)", re.sub(r"nologin", "", codigo), re.I), "a migração não pode dar senha nem login"
    assert "revoke from public" not in codigo  # nada de mexer em PUBLIC
    assert re.search(r"Aplicar em produção é passo do dono: replica/runbook-migracoes-producao\.md", sql)
    post = POST.read_text()
    assert [l.strip() for l in post.splitlines() if l.strip() and not l.startswith("--")] == [f"alter role {ROLE} login password '{SENHA_LOCAL}';"]


def test_atributos_do_role_e_nenhuma_heranca(su):
    r = su.execute(
        "select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolinherit from pg_roles where rolname = %s", (ROLE,)
    ).fetchone()
    assert r is not None
    assert r["rolcanlogin"] is True, "depois do post local o role tem login"
    assert not (r["rolsuper"] or r["rolcreatedb"] or r["rolcreaterole"] or r["rolbypassrls"] or r["rolreplication"]), r
    membros = su.execute(
        "select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = %s", (ROLE,)
    ).fetchall()
    assert membros == [], f"o role herda de {membros}"
    assert su.execute("select count(*) as n from pg_roles where rolname = %s and rolvaliduntil is null", (ROLE,)).fetchone()["n"] == 1
    assert not su.execute("select 1 from pg_database where datdba = (select oid from pg_roles where rolname = %s)", (ROLE,)).fetchall()
    assert not su.execute("select 1 from pg_class where relowner = (select oid from pg_roles where rolname = %s)", (ROLE,)).fetchall(), "o role não é dono de nada"


# ------------------------------------------------------------------ 2. matriz de privilégios


def test_matriz_de_tabelas_exata(su):
    tabelas = _tabelas(su)
    assert ADM | DOMINIO <= set(tabelas), (ADM | DOMINIO) - set(tabelas)
    erros = []
    for t in tabelas:
        for priv in PRIVS:
            tem = su.execute("select has_table_privilege(%s, %s, %s) as p", (ROLE, f"public.{t}", priv)).fetchone()["p"]
            if tem != esperado(t, priv):
                erros.append(f"{t} {priv}: tem={tem} esperado={esperado(t, priv)}")
    assert not erros, "\n".join(erros)
    # views e demais relações: nada além das tabelas
    outras = su.execute("select relname, relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind in ('v','m','f','p','S')").fetchall()
    for o in outras:
        for priv in PRIVS:
            if o["relkind"] != "S":
                assert not su.execute("select has_table_privilege(%s, %s, %s) as p", (ROLE, f"public.{o['relname']}", priv)).fetchone()["p"], (o, priv)


def test_matriz_de_colunas_exata_e_sem_grant_por_coluna(su):
    erros = []
    cols = su.execute(
        "select c.relname t, a.attname col from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped order by 1, 2"
    ).fetchall()
    assert len(cols) > 500
    for r in cols:
        for priv in ("SELECT", "INSERT", "UPDATE", "REFERENCES"):
            tem = su.execute("select has_column_privilege(%s, %s::regclass, %s, %s) as p", (ROLE, f"public.{r['t']}", r["col"], priv)).fetchone()["p"]
            if tem != esperado_coluna(r["t"], r["col"], priv):
                erros.append(f"{r['t']}.{r['col']} {priv}: tem={tem}")
    assert not erros, "\n".join(erros[:30])
    # grant por coluna só existe onde a 0156 o declara: identity_match_queue, todas as colunas menos `raw`; nenhum outro attacl cita o role
    direto = su.execute(
        "select c.relname t, a.attname col from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace, "
        "lateral aclexplode(a.attacl) x where n.nspname = 'public' and a.attacl is not null and x.grantee = (select oid from pg_roles where rolname = %s)", (ROLE,)
    ).fetchall()
    esperado_direto = sorted(
        (r["t"], r["col"]) for r in cols if r["t"] in SELECT_POR_COLUNA and (r["t"], r["col"]) not in COLUNAS_SEM_SELECT
    )
    assert sorted((d["t"], d["col"]) for d in direto) == esperado_direto, direto
    assert all(d["t"] == "identity_match_queue" and d["col"] != "raw" for d in direto)


def test_funcoes_so_as_publicas_por_padrao_e_nenhum_grant_direto(su):
    fns = su.execute(
        "select p.oid, p.oid::regprocedure::text as sig, p.proname, "
        "(p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')) as publica, "
        "has_function_privilege(%s, p.oid, 'EXECUTE') as exec "
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 2", (ROLE,)
    ).fetchall()
    assert len(fns) > 5
    # esperado: executa exatamente o que é público por padrão (o Postgres concede EXECUTE a PUBLIC na criação)
    assert {f["sig"] for f in fns if f["exec"]} == {f["sig"] for f in fns if f["publica"]}
    # merge_person: revoke from public (0002), não concedo nada
    mp = [f for f in fns if f["proname"] == "merge_person"]
    assert mp and all(not f["exec"] and not f["publica"] for f in mp), mp
    # nenhum grant direto ao role em função (nem em procedimento, tipo ou linguagem)
    assert su.execute(
        "select 1 from pg_proc p, lateral aclexplode(p.proacl) x where p.proacl is not null and x.grantee = (select oid from pg_roles where rolname = %s)", (ROLE,)
    ).fetchall() == []
    for catalogo, col in (("pg_type", "typacl"), ("pg_language", "lanacl"), ("pg_foreign_data_wrapper", "fdwacl"), ("pg_foreign_server", "srvacl"), ("pg_largeobject_metadata", "lomacl")):
        assert su.execute(
            f"select 1 from {catalogo} t, lateral aclexplode(t.{col}) x where t.{col} is not null and x.grantee = (select oid from pg_roles where rolname = %s)", (ROLE,)
        ).fetchall() == [], catalogo


def test_schemas_sequences_e_banco(su):
    for r in su.execute("select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by 1").fetchall():
        n = r["nspname"]
        usage = su.execute("select has_schema_privilege(%s, %s, 'USAGE') as p", (ROLE, n)).fetchone()["p"]
        create = su.execute("select has_schema_privilege(%s, %s, 'CREATE') as p", (ROLE, n)).fetchone()["p"]
        # extensions: unaccent/pg_trgm nos índices que o planejador simplifica ao ler `places`; login: as duas tabelas do login próprio da central (0157, D335)
        assert usage == (n in ("public", "extensions", "login")), f"USAGE em {n}: {usage}"
        assert not create, f"CREATE em {n}"
    for r in su.execute("select c.oid::regclass::text s from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'").fetchall():
        for priv in ("USAGE", "SELECT", "UPDATE"):
            assert not su.execute("select has_sequence_privilege(%s, %s, %s) as p", (ROLE, r["s"], priv)).fetchone()["p"], (r, priv)
    db = su.execute("select current_database() d").fetchone()["d"]
    assert not su.execute("select has_database_privilege(%s, %s, 'CREATE') as p", (ROLE, db)).fetchone()["p"]
    # Residual declarado (não é desta migração): CONNECT e TEMPORARY no banco vêm de PUBLIC; só se tirariam revogando de PUBLIC, o que atingiria os outros roles.
    assert su.execute("select has_database_privilege(%s, %s, 'CONNECT') as p", (ROLE, db)).fetchone()["p"]


def test_schema_login_so_as_tabelas_da_central(su):
    """0157 (D335): no schema `login` o admin_central lê, insere e atualiza SÓ `central_codigos` e `central_fatores`; nunca apaga; nada nas tabelas do login do site."""
    tabelas = {r["relname"] for r in su.execute("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'login' and c.relkind in ('r', 'p', 'v', 'm')").fetchall()}
    assert {"central_codigos", "central_fatores", "codes", "sessoes_validas_desde"} <= tabelas
    esperado = {"central_codigos": {"SELECT", "INSERT", "UPDATE"}, "central_fatores": {"SELECT", "INSERT", "UPDATE"}}
    for t in sorted(tabelas):
        tem = {p for p in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER") if su.execute("select has_table_privilege(%s, %s, %s) as p", (ROLE, f"login.{t}", p)).fetchone()["p"]}
        assert tem == esperado.get(t, set()), (t, tem)
    # os roles do site não alcançam as tabelas da central
    for role in ("web_reader", "web_writer", "anon", "authenticated"):
        for t in esperado:
            for p in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert not su.execute("select has_table_privilege(%s, %s, %s) as p", (role, f"login.{t}", p)).fetchone()["p"], (role, t, p)
    # nenhuma função do schema login é executável por grant direto ao role (o gatilho roda como quem atualiza)
    assert su.execute(
        "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, lateral aclexplode(p.proacl) x "
        "where n.nspname = 'login' and p.proacl is not null and x.grantee = (select oid from pg_roles where rolname = %s)", (ROLE,)
    ).fetchall() == []


# ------------------------------------------------------------------ 3. comportamento


def test_le_uma_linha_de_cada_tabela_concedida(central):
    for t in sorted(SELECT_EM - SELECT_POR_COLUNA):
        deve_passar(central, f"select * from public.{t} limit 1")
    # identity_match_queue: as colunas menos `raw` (0156); `select *` e `select raw` são negados (identity_match_queue.raw: ver test_admin_identidade.py)
    deve_passar(central, "select id, source_id, external_id, candidate_person_id, confidence, status, resolved_by, resolved_at, created_at, updated_at from public.identity_match_queue limit 1")


def test_insert_em_adm_pedidos(central):
    ok = com_admin("insert into adm_pedidos (tipo, chave_idem, parametros) values ('rodada', %s, '{}') returning id, status")
    assert deve_passar(central, ok, (uuid.uuid4().hex,))[0]["status"] == "na_fila"
    assert deve_passar(central, com_admin("insert into adm_pedidos (tipo, chave_idem, parametros) values ('parecer', %s, '{\"a\": 1}') returning id"), (uuid.uuid4().hex,))
    ruins = {
        "status concluido": "insert into adm_pedidos (tipo, chave_idem, status) values ('rodada', %s, 'concluido')",
        "status em_execucao": "insert into adm_pedidos (tipo, chave_idem, status) values ('rodada', %s, 'em_execucao')",
        "rodada_id": "insert into adm_pedidos (tipo, chave_idem, rodada_id) values ('rodada', %s, gen_random_uuid())",
        "iniciado_em": "insert into adm_pedidos (tipo, chave_idem, iniciado_em) values ('rodada', %s, now())",
        "batimento_em": "insert into adm_pedidos (tipo, chave_idem, batimento_em) values ('rodada', %s, now())",
        "finalizado_em": "insert into adm_pedidos (tipo, chave_idem, finalizado_em) values ('rodada', %s, now())",
        "andamento": "insert into adm_pedidos (tipo, chave_idem, andamento) values ('rodada', %s, '{}')",
        "erro": "insert into adm_pedidos (tipo, chave_idem, erro) values ('rodada', %s, 'x')",
    }
    for rotulo, q in ruins.items():
        e, _ = tentar(central, com_admin(q), (uuid.uuid4().hex,))
        assert isinstance(e, pe.InsufficientPrivilege) and "row-level security" in str(e), f"{rotulo}: {type(e).__name__} {e}"


def test_insert_em_adm_pedidos_decisao(central, su, pendencia):
    ok = com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', 'Fulana', 'conferi', %s) returning status, aplicar")
    r = deve_passar(central, ok, (pendencia, uuid.uuid4().hex))[0]
    assert (r["status"], r["aplicar"]) == ("na_fila", False)
    base = "insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem, {c}) values (%s, 'aprovar', 'Fulana', 'conferi', %s, {v})"
    for coluna, valor in (("decisao_id", "gen_random_uuid()"), ("erro", "'x'"), ("status", "'concluido'"), ("iniciado_em", "now()"), ("batimento_em", "now()"), ("finalizado_em", "now()")):
        e, _ = tentar(central, com_admin(base.format(c=coluna, v=valor)), (pendencia, uuid.uuid4().hex))
        assert isinstance(e, pe.InsufficientPrivilege) and "row-level security" in str(e), f"{coluna}: {type(e).__name__} {e}"
    # checks de domínio da tabela continuam valendo para o role
    deve_negar(central, com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'apagar', 'F', 'j', %s)"), (pendencia, "k"), pe.CheckViolation)
    # 0156: `por_nome` do admin_central é SEMPRE sobrescrito pelo nome de adm_admins, então um `por_nome` em branco do cliente já não chega ao check (ele entra com o nome da tabela);
    # o check de `por_nome` em branco continua valendo para os outros roles (o dono, aqui o superusuário do banco isolado), provado logo abaixo.
    assert deve_passar(central, com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', ' ', 'j', %s) returning por_nome"), (pendencia, "k"))[0]["por_nome"] == ADMIN_NOME
    with pytest.raises(pe.CheckViolation):
        with su.transaction(force_rollback=True):
            su.execute("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', ' ', 'j', %s)", (pendencia, "k"))
    deve_negar(central, com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', 'F', '', %s)"), (pendencia, "k"), pe.CheckViolation)
    deve_negar(central, com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (gen_random_uuid(), 'aprovar', 'F', 'j', %s)"), ("k",), pe.ForeignKeyViolation)


def test_pedido_repetido_nao_abre_segundo_em_curso(central, pendencia):
    """Critério 20, no banco: a mesma chave_idem na fila ou em execução só entra uma vez."""
    k = uuid.uuid4().hex
    with central.transaction(force_rollback=True):
        central.execute(com_admin("insert into adm_pedidos (tipo, chave_idem) values ('rodada', %s)"), (k,))
        with pytest.raises(pe.UniqueViolation):
            with central.transaction():
                central.execute(com_admin("insert into adm_pedidos (tipo, chave_idem) values ('rodada', %s)"), (k,))
    q = com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'descartar', 'F', 'j', %s)")
    with central.transaction(force_rollback=True):
        central.execute(q, (pendencia, k))
        with pytest.raises(pe.UniqueViolation):
            with central.transaction():
                central.execute(q, (pendencia, k))


def test_chave_liberada_quando_o_pedido_termina(su, pendencia):
    k = uuid.uuid4().hex
    with su.transaction(force_rollback=True):
        i = su.execute("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'descartar', 'F', 'j', %s) returning id", (pendencia, k)).fetchone()["id"]
        su.execute("update adm_pedidos_decisao set status = 'em_execucao' where id = %s", (i,))
        with pytest.raises(pe.UniqueViolation):
            with su.transaction():
                su.execute("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'descartar', 'F', 'j', %s)", (pendencia, k))
        su.execute("update adm_pedidos_decisao set status = 'concluido' where id = %s", (i,))
        su.execute("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'descartar', 'F', 'j', %s)", (pendencia, k))


def test_update_delete_truncate_em_qualquer_tabela_falham(central, su):
    for t in _tabelas(su):
        col = su.execute(
            "select a.attname from pg_attribute a where a.attrelid = %s::regclass and a.attnum > 0 and not a.attisdropped and a.attidentity = '' and a.attgenerated = '' order by a.attnum limit 1", (f"public.{t}",)
        ).fetchone()["attname"]
        deve_negar(central, f'update public.{t} set "{col}" = "{col}" where false')
        deve_negar(central, f"delete from public.{t} where false")
        deve_negar(central, f"truncate public.{t}")


def test_insert_fora_dos_dois_pedidos_falha(central, su):
    for t in _tabelas(su):
        if t not in INSERT_EM:
            deve_negar(central, f"insert into public.{t} default values")
    for t in ("adm_decisoes", "adm_overrides", "sapl_houses", "pipeline_switches", "corrections"):  # os nomeados pela especificação
        deve_negar(central, f"insert into public.{t} default values")


def test_select_fora_da_lista_falha(central, su):
    for t in ("pipeline_switches", "corrections", "profiles", "follows", "people", "suggestions", "digest_deliveries", "page_views", "person_external_ids"):
        deve_negar(central, f"select 1 from public.{t} limit 1")
    for t in _tabelas(su):
        if t not in SELECT_EM:
            deve_negar(central, f"select 1 from public.{t} limit 1")


def test_nao_executa_merge_person_nem_troca_de_role(central):
    deve_negar(central, "select merge_person(gen_random_uuid(), gen_random_uuid())")
    if central.execute("select session_user as u").fetchone()["u"] == ROLE:  # por TCP; com `set role` a sessão é de superusuário e trocar de role é permitido a ela
        for r in ("postgres", "web_writer", "web_reader", "authenticated", "anon"):
            deve_negar(central, f"set role {r}")
        deve_negar(central, "set session authorization postgres")
    deve_negar(central, "create table public.zg_x (a int)")
    deve_negar(central, "alter table adm_pedidos disable trigger all")
    deve_negar(central, "alter table adm_pedidos disable row level security", tipo=pe.InsufficientPrivilege)
    deve_negar(central, "grant select on pipeline_switches to admin_central")
    deve_negar(central, "create policy zg on adm_pedidos for all to admin_central using (true)")


def test_rls_filtra_para_o_role(central):
    """Sem a policy, a RLS devolveria zero linhas: com ela, a leitura é real (a linha do seed de `sources` aparece)."""
    assert deve_passar(central, "select count(*) as n from sources")[0]["n"] > 0


# ------------------------------------------------------------------ 4. adm_pedidos_decisao e policies


def test_gatilho_de_transicao_do_pedido_de_decisao(su, pendencia):
    def novo():
        return su.execute(
            "insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', 'F', 'j', %s) returning id", (pendencia, uuid.uuid4().hex)
        ).fetchone()["id"]

    permitidas = [("na_fila", "em_execucao"), ("em_execucao", "concluido"), ("em_execucao", "falhou"), ("em_execucao", "interrompido")]
    todas = ["na_fila", "em_execucao", "concluido", "falhou", "interrompido"]
    for de in todas:
        for para in todas:
            if de == para:
                continue
            with su.transaction(force_rollback=True):
                i = novo()
                caminho = {"na_fila": [], "em_execucao": ["em_execucao"], "concluido": ["em_execucao", "concluido"], "falhou": ["em_execucao", "falhou"], "interrompido": ["em_execucao", "interrompido"]}[de]
                for s in caminho:
                    su.execute("update adm_pedidos_decisao set status = %s where id = %s", (s, i))
                if (de, para) in permitidas:
                    su.execute("update adm_pedidos_decisao set status = %s where id = %s", (para, i))
                else:
                    with pytest.raises(psycopg.Error, match="transição .* não permitida"):
                        with su.transaction():
                            su.execute("update adm_pedidos_decisao set status = %s where id = %s", (para, i))


def test_revoke_efetivo_para_os_roles_do_site(su):
    roles = [r["rolname"] for r in su.execute("select rolname from pg_roles where rolname = any(%s)", (list(ROLES_SEM_ACESSO),)).fetchall()]
    assert {"web_reader", "web_writer", "anon", "authenticated"} <= set(roles), roles
    for role in roles:
        for t in ADM | ADM_SEM_ACESSO:
            for priv in PRIVS:
                assert not su.execute("select has_table_privilege(%s, %s, %s) as p", (role, f"public.{t}", priv)).fetchone()["p"], f"{role} tem {priv} em {t}"
            assert not su.execute("select has_any_column_privilege(%s, %s, 'select,insert,update,references') as p", (role, f"public.{t}")).fetchone()["p"], f"{role}: coluna em {t}"


def test_rls_ligada_e_policies_exatas(su):
    for t in ADM | ADM_SEM_ACESSO:
        assert su.execute("select relrowsecurity as r from pg_class where oid = %s::regclass", (f"public.{t}",)).fetchone()["r"], f"{t} sem RLS"
    # nenhuma policy de adm_* para outro role que não o admin_central, nenhuma `to public`
    pol = su.execute("select tablename, policyname, roles::text[] as roles, cmd from pg_policies where tablename like 'adm\\_%' order by 1, 2").fetchall()
    for p in pol:
        assert p["roles"] == [ROLE], p
    # conjunto exato das policies do admin_central em todo o schema
    do_role = {(p["tablename"], p["policyname"], p["cmd"]) for p in su.execute("select tablename, policyname, roles::text[] as roles, cmd from pg_policies where %s = any(roles)", (ROLE,)).fetchall()}
    esperadas = {(t, "admin_central_le", "SELECT") for t in SELECT_EM} | {(t, "admin_central_insere", "INSERT") for t in INSERT_EM}
    esperadas |= {(t, "admin_central_criado_agora", "INSERT") for t in INSERT_EM}  # 0154 (C11, G4-1): restritiva, o cliente não escolhe o relógio do pedido
    esperadas |= {(t, "admin_central_criado_relogio", "INSERT") for t in INSERT_EM}  # 0155 (C12, N2): a mesma janela pelo relógio, não pelo início da transação
    assert do_role == esperadas, (do_role ^ esperadas)
    # nenhuma policy `to public` em tabela adm_*
    assert su.execute("select 1 from pg_policies where tablename like 'adm\\_%' and ('public' = any(roles) or roles = '{}')").fetchall() == []
    # as de leitura são `using (true)`; as de inserção só aceitam pedido na fila
    for p in su.execute("select tablename, qual, with_check from pg_policies where policyname = 'admin_central_le'").fetchall():
        assert p["qual"] == "true" and p["with_check"] is None, p
    for p in su.execute("select tablename, qual, with_check from pg_policies where policyname = 'admin_central_insere'").fetchall():
        assert p["qual"] is None and "status = 'na_fila'" in p["with_check"], p


def test_gatilhos_das_duas_tabelas_de_pedido_nao_disparam_em_insert(su):
    """O role só insere nelas: nenhum gatilho de insert (que poderia ler outra tabela) existe nessas duas."""
    rows = su.execute(
        "select c.relname t, t.tgname, t.tgtype from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('adm_pedidos', 'adm_pedidos_decisao') and not t.tgisinternal"
    ).fetchall()
    # 0156 (F3-T1): o gatilho `adm_pedido_identidade` (before insert, só age para o admin_central) entra nas duas; os de transição continuam sem disparar em insert.
    assert {(r["t"], r["tgname"]) for r in rows} == {("adm_pedidos", "adm_pedidos_guard"), ("adm_pedidos_decisao", "adm_pedidos_decisao_guard"),
                                                     ("adm_pedidos", "adm_pedido_identidade"), ("adm_pedidos_decisao", "adm_pedido_identidade")}
    for r in rows:
        if r["tgname"] == "adm_pedido_identidade":
            assert r["tgtype"] & 4 and r["tgtype"] & 2 and r["tgtype"] & 1, "adm_pedido_identidade tem de ser `before insert for each row`"  # bits: 1 = row, 2 = before, 4 = insert
        else:
            assert r["tgtype"] & 4 == 0, f"{r['tgname']} dispara em insert"  # bit 4 = INSERT


def test_criado_em_do_pedido_so_aceita_agora(central, pendencia):
    """0154 (G4-1): `criado_em` livre deixava o cliente furar a fila e acender "executor parado". Padrão passa; passado e futuro distantes não."""
    ped = "insert into adm_pedidos (tipo, chave_idem, criado_em) values ('rodada', %s, {v})"
    dec = "insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem, criado_em) values (%s, 'aprovar', 'Fulana', 'conferi', %s, {v})"
    assert deve_passar(central, com_admin(ped.format(v="default") + " returning id"), (uuid.uuid4().hex,))
    assert deve_passar(central, com_admin(dec.format(v="default") + " returning id"), (pendencia, uuid.uuid4().hex))
    assert deve_passar(central, com_admin(ped.format(v="now()") + " returning id"), (uuid.uuid4().hex,))
    for v in ("now() - interval '10 minutes'", "now() + interval '10 minutes'", "'2000-01-01'"):
        e, _ = tentar(central, com_admin(ped.format(v=v)), (uuid.uuid4().hex,))
        assert isinstance(e, pe.InsufficientPrivilege) and "row-level security" in str(e), f"adm_pedidos {v}: {type(e).__name__} {e}"
        e, _ = tentar(central, com_admin(dec.format(v=v)), (pendencia, uuid.uuid4().hex))
        assert isinstance(e, pe.InsufficientPrivilege) and "row-level security" in str(e), f"adm_pedidos_decisao {v}: {type(e).__name__} {e}"


def test_criado_em_pelo_relogio_e_nao_pelo_inicio_da_transacao(central, pendencia):
    """0155 (N2): `now()` é o início da transação; quem segura a transação e insere com o default grava `criado_em` retroagido. Com a policy pelo relógio,
    o default de uma transação de 6 s é recusado nas duas tabelas; o de uma transação curta passa."""
    ped = com_admin("insert into adm_pedidos (tipo, chave_idem) values ('rodada', %s) returning id")
    dec = com_admin("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', 'Fulana', 'conferi', %s) returning id")
    with central.transaction(force_rollback=True):
        central.execute("select pg_sleep(0.2)")
        assert deve_passar(central, ped, (uuid.uuid4().hex,))
        assert deve_passar(central, dec, (pendencia, uuid.uuid4().hex))
    with central.transaction(force_rollback=True):
        central.execute("select pg_sleep(6)")
        for q, p in ((ped, (uuid.uuid4().hex,)), (dec, (pendencia, uuid.uuid4().hex))):
            e, _ = tentar(central, q, p)
            assert isinstance(e, pe.InsufficientPrivilege) and "row-level security" in str(e), f"{q[:30]}: {type(e).__name__} {e}"
