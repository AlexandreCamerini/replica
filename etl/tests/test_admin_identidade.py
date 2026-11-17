"""F3-T1 (migração 0156; AC-23): identidade de admin nos pedidos da central, `adm_admins`, `adm_admins_log` e `identity_match_queue.raw`.

Tudo no banco isolado, como o `admin_central` (TCP e `set role`, as duas conexões de `test_admin_grants.py`) ou como o dono. Cada caso do role roda em transação desfeita
(`tentar`/`force_rollback`); as linhas confirmadas (admins de teste, pedidos antigos do caso do limite) são apagadas ao fim.
"""

from __future__ import annotations

import subprocess
import uuid

import psycopg
import pytest
from psycopg import errors as pe
from test_admin_grants import ADMIN_EMAIL, REPO, ADMIN_NOME, banco_isolado, central, com_admin, deve_negar, deve_passar, pendencia, su, tentar  # noqa: F401  (fixtures de test_admin_grants)


POST_0004 = REPO / "db" / "local" / "post_0004_admin_local.sql"
MIGRACAO_0156 = REPO / "db" / "migrations" / "0156_admin_admins.sql"
USER_ID = "0a1b2c3d-0000-4000-8000-0000000000aa"
OUTRO_USER_ID = "0a1b2c3d-0000-4000-8000-0000000000bb"
E_ATIVO, N_ATIVO = "t-ativo@segueovoto.invalid", "Admin Ativo de Teste"
E_INATIVO, N_INATIVO = "t-inativo-id@segueovoto.invalid", "Admin Inativo de Teste"
E_USER, N_USER = "t-com-user@segueovoto.invalid", "Admin Com User de Teste"

PED = "insert into adm_pedidos (tipo, chave_idem, por_email, por_user_id) values ('rodada', %s, %s, %s) returning id, por_email"
DEC = ("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem, por_email, por_user_id) "
       "values (%s, 'aprovar', %s, 'conferi', %s, %s, %s) returning id, por_nome, por_email")


@pytest.fixture(scope="module")
def admins(su):  # noqa: F811
    with su.transaction():
        su.execute("insert into adm_admins (email, nome) values (%s, %s) on conflict (email) do nothing", (E_ATIVO, N_ATIVO))
        su.execute("insert into adm_admins (email, nome, ativo) values (%s, %s, false) on conflict (email) do nothing", (E_INATIVO, N_INATIVO))
        su.execute("insert into adm_admins (email, nome, user_id) values (%s, %s, %s) on conflict (email) do nothing", (E_USER, N_USER, USER_ID))
    yield
    with su.transaction():
        su.execute("set local session_replication_role = replica")  # o log de admins é só de acréscimo; o banco é isolado
        su.execute("delete from adm_pedidos where por_email like 't-%@segueovoto.invalid'")
        su.execute("delete from adm_pedidos_decisao where por_email like 't-%@segueovoto.invalid'")
        su.execute("delete from adm_admins where email like 't-%@segueovoto.invalid'")


def ped(c, email, user_id=None, chave=None):
    return tentar(c, PED, (chave or uuid.uuid4().hex, email, user_id))


def dec(c, pendencia_id, email, user_id=None, nome="Nome Forjado", chave=None):
    return tentar(c, DEC, (pendencia_id, nome, chave or uuid.uuid4().hex, email, user_id))


def recusado(e, trecho, tipo=pe.InsufficientPrivilege):
    assert isinstance(e, tipo) and "pedido recusado" in str(e) and trecho in str(e), f"{type(e).__name__}: {e}"


# ------------------------------------------------------------------ gatilho de identidade


def test_pedido_sem_por_email_e_recusado_nas_duas_tabelas(central, pendencia, admins):  # noqa: F811
    for q, p in (("insert into adm_pedidos (tipo, chave_idem) values ('rodada', %s)", (uuid.uuid4().hex,)),
                 ("insert into adm_pedidos (tipo, chave_idem, por_email) values ('rodada', %s, '  ')", (uuid.uuid4().hex,)),
                 ("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem) values (%s, 'aprovar', 'F', 'j', %s)", (pendencia, uuid.uuid4().hex)),
                 ("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, chave_idem, por_email) values (%s, 'aprovar', 'F', 'j', %s, null)", (pendencia, uuid.uuid4().hex))):
        e, _ = tentar(central, q, p)
        recusado(e, "falta o e-mail")


def test_e_mail_de_nao_admin_e_de_admin_inativo_sao_recusados(central, pendencia, admins):  # noqa: F811
    recusado(ped(central, "ninguem@segueovoto.invalid")[0], "não consta em adm_admins")
    recusado(ped(central, E_INATIVO)[0], "inativo")
    recusado(dec(central, pendencia, "ninguem@segueovoto.invalid")[0], "não consta em adm_admins")
    recusado(dec(central, pendencia, E_INATIVO)[0], "inativo")


def test_por_user_id_divergente_ou_ausente_e_recusado_quando_o_admin_tem_user_id(central, pendencia, admins):  # noqa: F811
    for uid in (OUTRO_USER_ID, None):
        recusado(ped(central, E_USER, uid)[0], "por_user_id não confere")
        recusado(dec(central, pendencia, E_USER, uid)[0], "por_user_id não confere")
    e, linhas = ped(central, E_USER, USER_ID)
    assert e is None and linhas[0]["por_email"] == E_USER
    e, linhas = dec(central, pendencia, E_USER, USER_ID)
    assert e is None and linhas[0]["por_nome"] == N_USER


def test_admin_ativo_e_aceito_e_o_por_nome_da_decisao_e_sobrescrito(central, pendencia, admins):  # noqa: F811
    e, linhas = ped(central, E_ATIVO)
    assert e is None and linhas[0]["por_email"] == E_ATIVO
    e, linhas = dec(central, pendencia, E_ATIVO, nome="Nome Forjado")
    assert e is None and (linhas[0]["por_nome"], linhas[0]["por_email"]) == (N_ATIVO, E_ATIVO)
    # o admin local de db/local/post_0004 (modo local da central) também passa
    e, linhas = dec(central, pendencia, ADMIN_EMAIL, nome="Qualquer")
    assert e is None and linhas[0]["por_nome"] == ADMIN_NOME


def test_e_mail_em_maiusculas_e_aceito_e_gravado_em_minusculas(central, pendencia, admins):  # noqa: F811
    e, linhas = ped(central, E_ATIVO.upper())
    assert e is None and linhas[0]["por_email"] == E_ATIVO
    e, linhas = dec(central, pendencia, E_ATIVO.title())
    assert e is None and linhas[0]["por_email"] == E_ATIVO and linhas[0]["por_nome"] == N_ATIVO


def test_por_nome_em_pedido_que_nao_e_de_decisao_nao_existe_e_o_gatilho_nao_quebra(central, admins):  # noqa: F811
    assert ped(central, E_ATIVO)[0] is None  # adm_pedidos não tem por_nome: o ramo da decisão não roda


def test_limite_de_20_pedidos_por_60_s_por_admin_em_cada_tabela(central, pendencia, admins):  # noqa: F811
    with central.transaction(force_rollback=True):
        for _ in range(20):
            central.execute(PED, (uuid.uuid4().hex, E_ATIVO, None))
        with pytest.raises(pe.ProgramLimitExceeded, match="pedido recusado") as ei:
            with central.transaction():
                central.execute(PED, (uuid.uuid4().hex, E_ATIVO, None))
        assert "limite: 20" in str(ei.value) and "adm_pedidos" in str(ei.value)
        # outro admin não é afetado, e a outra tabela tem a sua contagem
        central.execute(PED, (uuid.uuid4().hex, E_USER, USER_ID))
        central.execute(DEC, (pendencia, "x", uuid.uuid4().hex, E_ATIVO, None))
    with central.transaction(force_rollback=True):
        for _ in range(20):
            central.execute(DEC, (pendencia, "x", uuid.uuid4().hex, E_ATIVO, None))
        with pytest.raises(pe.ProgramLimitExceeded, match="adm_pedidos_decisao"):
            with central.transaction():
                central.execute(DEC, (pendencia, "x", uuid.uuid4().hex, E_ATIVO, None))
        with pytest.raises(pe.ProgramLimitExceeded):  # o limite vale para o e-mail em maiúsculas também
            with central.transaction():
                central.execute(DEC, (pendencia, "x", uuid.uuid4().hex, E_ATIVO.upper(), None))


def test_pedidos_com_mais_de_60_s_nao_contam_para_o_limite(central, su, pendencia, admins):  # noqa: F811
    with su.transaction():
        for _ in range(25):
            su.execute("insert into adm_pedidos (tipo, chave_idem, por_email, criado_em) values ('rodada', %s, %s, clock_timestamp() - interval '2 minutes')", (uuid.uuid4().hex, E_ATIVO))
    try:
        assert ped(central, E_ATIVO)[0] is None
    finally:
        with su.transaction():
            su.execute("delete from adm_pedidos where por_email = %s", (E_ATIVO,))


def test_gatilho_nao_age_para_o_dono_nem_para_outros_roles(su, pendencia, admins):  # noqa: F811
    with su.transaction(force_rollback=True):
        r = su.execute(DEC, (pendencia, "Nome da CLI", uuid.uuid4().hex, None, None)).fetchone()
        assert (r["por_nome"], r["por_email"]) == ("Nome da CLI", None)
        su.execute("insert into adm_pedidos (tipo, chave_idem) values ('rodada', %s)", (uuid.uuid4().hex,))  # sem por_email: passa
        for _ in range(30):  # sem limite de ritmo fora do admin_central
            su.execute("insert into adm_pedidos (tipo, chave_idem, por_email) values ('rodada', %s, %s)", (uuid.uuid4().hex, E_ATIVO))


def test_funcao_do_gatilho_fixa_o_search_path(su):  # noqa: F811
    for fn in ("adm_pedido_identidade", "adm_admins_registra", "adm_admins_log_imutavel", "adm_admins_toca"):
        cfg = su.execute("select proconfig, prosecdef from pg_proc where proname = %s and pronamespace = 'public'::regnamespace", (fn,)).fetchone()
        assert cfg["proconfig"] == ["search_path=pg_catalog, public"] and cfg["prosecdef"] is False, (fn, cfg)


# ------------------------------------------------------------------ adm_admins e adm_admins_log


def test_adm_admins_o_admin_central_so_le(central, admins):  # noqa: F811
    assert {r["email"] for r in deve_passar(central, "select email from adm_admins")} >= {E_ATIVO, E_INATIVO, E_USER, ADMIN_EMAIL}
    deve_negar(central, "insert into adm_admins (email, nome) values ('x@segueovoto.invalid', 'X')")
    deve_negar(central, "update adm_admins set ativo = false")
    deve_negar(central, "update adm_admins set nome = 'Eu' where email = %s", (ADMIN_EMAIL,))
    deve_negar(central, "delete from adm_admins")
    deve_negar(central, "truncate adm_admins")


def test_adm_admins_log_sem_nenhum_acesso_do_admin_central_e_dos_roles_do_site(central, su, admins):  # noqa: F811
    deve_negar(central, "select * from adm_admins_log")
    deve_negar(central, "select count(*) from adm_admins_log")
    deve_negar(central, "insert into adm_admins_log (operacao, por_role) values ('INSERT', 'admin_central')")
    for role in ("web_reader", "web_writer", "anon", "authenticated"):
        if su.execute("select 1 from pg_roles where rolname = %s", (role,)).fetchone():
            assert not su.execute("select has_any_column_privilege(%s, 'public.adm_admins', 'select,insert,update,references') as p", (role,)).fetchone()["p"], role
            assert not su.execute("select has_any_column_privilege(%s, 'public.adm_admins_log', 'select,insert,update,references') as p", (role,)).fetchone()["p"], role


def test_adm_admins_checks_de_dominio(su):  # noqa: F811
    for email, nome in (("Maiuscula@segueovoto.invalid", "N"), ("  ", "N"), ("", "N"), ("ok@segueovoto.invalid", " ")):
        with pytest.raises(pe.CheckViolation):
            with su.transaction(force_rollback=True):
                su.execute("insert into adm_admins (email, nome) values (%s, %s)", (email, nome))
    with pytest.raises(pe.UniqueViolation):
        with su.transaction(force_rollback=True):
            su.execute("insert into adm_admins (email, nome) values (%s, 'dup')", (ADMIN_EMAIL,))
    with pytest.raises(pe.UniqueViolation):  # um user_id é de um admin só
        with su.transaction(force_rollback=True):
            su.execute("insert into adm_admins (email, nome, user_id) values ('a1@segueovoto.invalid', 'A', %s), ('a2@segueovoto.invalid', 'B', %s)", (USER_ID, USER_ID))


def test_log_de_admins_e_alimentado_por_insert_update_e_delete_e_nao_se_altera(su):  # noqa: F811
    with su.transaction(force_rollback=True):
        n0 = su.execute("select count(*) as n from adm_admins_log").fetchone()["n"]
        su.execute("insert into adm_admins (email, nome) values ('log1@segueovoto.invalid', 'Log Um')")
        su.execute("update adm_admins set ativo = false, nome = 'Log Um B' where email = 'log1@segueovoto.invalid'")
        su.execute("delete from adm_admins where email = 'log1@segueovoto.invalid'")
        linhas = su.execute("select * from adm_admins_log order by em, ctid offset %s", (n0,)).fetchall()
        assert [l["operacao"] for l in linhas] == ["INSERT", "UPDATE", "DELETE"]
        ins, upd, dele = linhas
        assert ins["antes"] is None and ins["depois"]["email"] == "log1@segueovoto.invalid" and ins["depois"]["ativo"] is True
        assert upd["antes"]["nome"] == "Log Um" and upd["depois"]["nome"] == "Log Um B" and upd["antes"]["ativo"] is True and upd["depois"]["ativo"] is False
        assert dele["antes"]["nome"] == "Log Um B" and dele["depois"] is None
        assert {l["por_role"] for l in linhas} == {su.execute("select current_user as u").fetchone()["u"]}
        assert all(l["em"] is not None for l in linhas)
        # atualizado_em acompanha o update (gatilho adm_admins_toca)
    with su.transaction(force_rollback=True):
        su.execute("insert into adm_admins (email, nome, criado_em, atualizado_em) values ('log2@segueovoto.invalid', 'Log Dois', now() - interval '1 day', now() - interval '1 day')")
        su.execute("update adm_admins set nome = 'Log Dois B' where email = 'log2@segueovoto.invalid'")
        r = su.execute("select atualizado_em > now() - interval '1 hour' as novo, criado_em < now() - interval '1 hour' as velho from adm_admins where email = 'log2@segueovoto.invalid'").fetchone()
        assert r == {"novo": True, "velho": True}
    # imutável: nem o dono altera ou apaga
    with su.transaction(force_rollback=True):
        su.execute("insert into adm_admins (email, nome) values ('log3@segueovoto.invalid', 'Log Três')")
        for q in ("update adm_admins_log set por_role = 'x'", "delete from adm_admins_log", "update adm_admins_log set antes = null where operacao = 'INSERT'"):
            with pytest.raises(psycopg.Error, match="só de acréscimo"):
                with su.transaction():
                    su.execute(q)


def test_post_local_cadastra_o_admin_local_de_forma_idempotente(su, banco_isolado):  # noqa: F811
    r = su.execute("select nome, ativo, user_id from adm_admins where email = %s", (ADMIN_EMAIL,)).fetchone()
    assert r == {"nome": ADMIN_NOME, "ativo": True, "user_id": None}
    contar = "select (select count(*) from adm_admins where email = %s) as a, (select count(*) from adm_admins_log where depois->>'email' = %s) as l"
    antes = su.execute(contar, (ADMIN_EMAIL, ADMIN_EMAIL)).fetchone()
    for _ in range(2):  # `migrate.sh --local` roda o post a cada execução
        p = subprocess.run(["psql", banco_isolado, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", str(POST_0004)], capture_output=True, text=True, timeout=60)
        assert p.returncode == 0, p.stderr
    assert su.execute(contar, (ADMIN_EMAIL, ADMIN_EMAIL)).fetchone() == antes and antes["a"] == 1
    # só local: a migração (que vai a produção) não cadastra ninguém; quem cadastra é o post `--local`
    codigo = "\n".join(l.split("--")[0] for l in MIGRACAO_0156.read_text().splitlines()).lower()
    assert "insert into adm_admins " not in codigo and "insert into public.adm_admins " not in codigo
    assert "operador.local" not in codigo


# ------------------------------------------------------------------ identity_match_queue.raw

COLUNAS_LIDAS = ("id", "source_id", "external_id", "candidate_person_id", "confidence", "status", "resolved_by", "resolved_at", "created_at", "updated_at")


def test_admin_central_nao_le_raw_da_fila_de_identidade_e_le_as_outras_colunas(central, su):  # noqa: F811
    cols = [r["column_name"] for r in su.execute("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'identity_match_queue' order by ordinal_position").fetchall()]
    assert "raw" in cols and set(cols) - {"raw"} == set(COLUNAS_LIDAS), cols  # se a tabela ganhar coluna, a decisão de expô-la ao admin_central é explícita
    for q in ("select raw from identity_match_queue", "select * from identity_match_queue", "select i.raw from identity_match_queue i", "select count(raw) from identity_match_queue",
              "select id from identity_match_queue where raw is not null", "select id from identity_match_queue order by raw", "select to_jsonb(i) from identity_match_queue i"):
        deve_negar(central, q)
    deve_passar(central, f"select {', '.join(COLUNAS_LIDAS)} from identity_match_queue limit 5")
    deve_passar(central, "select count(*) from identity_match_queue where status = 'pendente'")
    deve_passar(central, "select q.id, s.slug from identity_match_queue q join sources s on s.id = q.source_id limit 5")  # a forma da central (web/src/lib/admin/sql.ts)
    assert deve_passar(central, "select has_column_privilege('admin_central', 'public.identity_match_queue', 'raw', 'select') as p")[0]["p"] is False
