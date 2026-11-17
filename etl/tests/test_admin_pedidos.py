"""FABRICADO. Parte C (C2): o executor da CLI que consome os pedidos gravados pela central (`admin_pedidos`, `adm_pedidos_decisao`) e os executa pelos mecanismos existentes.

Critérios que este arquivo prova: 20 ("clicar duas vezes em 'Recoletar fichas pendentes' gera um pedido só"), 22 pelo caminho do executor (pedido de parecer com as duas chaves desligadas
não altera nenhuma tabela de domínio) e a base do 21 (executor parado). Sem rede e sem skip: as rodadas são em processo (`ADMIN_RUNNER=processo`) sobre o transporte fabricado do SAPL
(`admin_fixtures.instalar`), o parecer é o motor de ensaio local e `anthropic.Anthropic` e `socket.socket.connect` falham se tocados. Tudo roda no banco isolado e é desfeito em `finally`;
nada é gravado no banco da suíte (contagens antes e depois). O que cada teste grava em `adm_decisoes` só se apaga com `session_replication_role = replica` (a técnica de
test_admin_proponentes.py).
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import admin_fixtures as AF
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg import errors as pe
from psycopg.rows import dict_row
from test_admin_parecer import retrato
from test_admin_proponentes import API, _ambiente, casa, envelhecer, limpar_tudo, rodada as rodar_rodada  # noqa: F401  (_ambiente é autouse: ADMIN_RUNNER=processo e URLs do banco isolado)
from test_admin_proponentes import sapl_base  # noqa: F401  (fixture)

from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import executor as EX
from civico_etl.admin import parecer as PAR
from civico_etl.admin import propostas as PR
from civico_etl.admin import rodadas as R
from civico_etl.admin.saida import ErroAdmin
from conftest import database_url

SUITE = ("adm_pedidos", "adm_pedidos_decisao", "adm_rodadas", "adm_pareceres", "adm_decisoes", "adm_pendencias", "adm_propostas", "sapl_houses", "data_coverage", "ingest_runs", "dataset_stamps")
NO_RETRATO_FORA = ("adm_pareceres", "adm_pedidos", "adm_pedidos_decisao")  # o executor escreve nestas três; o resto de `public` tem de ficar idêntico (critério 22)
# 0156 (F3-T1): todo pedido do admin_central traz o e-mail de um admin ativo, e o gatilho grava `por_nome` com o nome da tabela `adm_admins`. Os nomes que estes testes usam
# como `por_nome` ganham um admin cada (e-mail derivado); assim o nome gravado, a chave de idempotência e as asserções existentes continuam os mesmos.
ADMINS_TESTE = ("Fulana de Teste", "Outra Pessoa", "Beltrano", "Fulana")
EMAIL_PADRAO = "operador.local@segueovoto.invalid"  # o admin de db/local/post_0004_admin_local.sql


def email_de(nome: str) -> str:
    return "t-" + nome.lower().replace(" ", "-") + "@segueovoto.invalid"


def garantir_admins(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c:
        for nome in ADMINS_TESTE:
            c.execute("insert into adm_admins (email, nome) values (%s, %s) on conflict (email) do nothing", (email_de(nome), nome))


def com_email(sql: str, campo: str = "chave_idem") -> str:
    """Acrescenta `por_email` (último parâmetro) ao insert de SQL_INSERIR_PEDIDO / SQL_INSERIR_PEDIDO_DECISAO, que o admin_central usa como a central."""
    return sql.replace(f"{campo}) values (", f"{campo}, por_email) values (", 1).replace(") on conflict", ", %s) on conflict", 1)


UF_PB, UF_AM, UF_PI = "25", "13", "22"  # ibge_code dos lugares `uf` (a PB e a AM ganham pendência na v2; a PI não)


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
    def conta():
        return {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608

    antes = conta()
    yield
    assert conta() == antes, "o banco da suíte mudou"


@pytest.fixture(autouse=True)
def _sem_rede_nem_modelo(monkeypatch):
    """O parecer do executor é só o ensaio local: instanciar o cliente da API, ou abrir um socket Python, derruba o teste."""
    import anthropic

    vistos: list[str] = []

    def proibido(*a, **k):
        vistos.append("anthropic.Anthropic")
        raise AssertionError("anthropic.Anthropic foi instanciado em teste")

    def sem_socket(self, *a, **k):
        vistos.append("socket.connect")
        raise AssertionError("conexão de rede em teste")

    def cliente_proibido(*a, **k):
        vistos.append("parecer._cliente_real")
        raise AssertionError("cliente de modelo construído em teste")

    monkeypatch.setattr(anthropic, "Anthropic", proibido)
    monkeypatch.setattr(PAR, "_cliente_real", cliente_proibido)
    monkeypatch.setattr(socket.socket, "connect", sem_socket)
    for v in ("ADMIN_COLETA_AGENTES", "VERIFICACAO_AGENTICA"):
        monkeypatch.delenv(v, raising=False)
    # G2-1: chave FALSA presente. Sem ela, uma volta a `escolher_motor(real=True)` cairia no motor local em silêncio e o teste passaria sem pegar a regressão;
    # com ela, o motor real seria escolhido, tentaria construir o cliente e derrubaria o teste (as duas travas acima).
    monkeypatch.setenv("ANTHROPIC_API_KEY", "chave-falsa-de-teste")
    yield
    assert vistos == []


def limpar_pedidos(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_pareceres", "adm_pedidos_decisao", "adm_pedidos"):
            c.execute(f"delete from {t}")  # noqa: S608


@pytest.fixture
def base(sapl_base):  # noqa: F811
    limpar_pedidos(sapl_base)
    garantir_admins(sapl_base)
    try:
        yield sapl_base
    finally:
        limpar_pedidos(sapl_base)


@pytest.fixture
def cx(base):
    c = psycopg.connect(base, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    try:
        yield c
    finally:
        c.rollback()
        c.close()


@pytest.fixture
def v1_v2(cx, monkeypatch, tmp_path):
    """Rodada v1, depois v2 (cache novo, casas envelhecidas): a PB e a AM ganham pendência de `status`. Devolve (rid1, rid2). O transporte da v2 continua instalado."""
    rid1, res1, _ = rodar_rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    assert res1["status"] == "concluida"
    cx.rollback()
    envelhecer(cx)
    rid2, res2, _ = rodar_rodada(cx, monkeypatch, tmp_path / "c2", "v2")
    cx.rollback()
    assert res2["status"] == "concluida" and cx.execute("select count(*) as n from adm_pendencias where status = 'aberta'").fetchone()["n"] == 2
    return rid1, rid2


# ------------------------------------------------------------------ apoio


def n(c, tabela: str, onde: str = "true", *p) -> int:
    return c.execute(f"select count(*) as n from {tabela} where {onde}", p or None).fetchone()["n"]  # noqa: S608


def pend_de(c, uf: str) -> str:
    h = casa(c, uf)
    return str(c.execute("select id from adm_pendencias where classe = 'vinculo_sapl' and registro_chave = %s and campo = 'status'", (str(h["id"]),)).fetchone()["id"])


def pedido(c, id_: str, tabela: str = "adm_pedidos") -> dict:
    return c.execute(f"select * from {tabela} where id = %s", (id_,)).fetchone()  # noqa: S608


def pedir_e_comitar(c, tipo: str, par: dict) -> tuple[dict, bool]:
    r = EX.pedir(c, tipo, par)
    c.commit()
    return r


def recoleta(classe: str, ibge: str, nivel: str) -> dict:
    return {"classe": classe, "territorio": {"ibge": ibge, "nivel": nivel}}


def como_central(url: str, *, tcp: bool):
    """Conexão que age como `admin_central` (autocommit): por TCP com a senha local de db/local/post_0003_admin_central.sql, ou `set role` numa conexão de superusuário."""
    if tcp:
        p = urlparse(url)
        c = psycopg.connect(urlunparse(p._replace(netloc=f"admin_central:admin_central@{p.hostname}:{p.port}")), row_factory=dict_row, autocommit=True, connect_timeout=5)
    else:
        c = psycopg.connect(url, row_factory=dict_row, autocommit=True)
        c.execute("set role admin_central")
    assert c.execute("select current_user as u").fetchone()["u"] == "admin_central"
    return c


def inserir_cru(c, tabela: str, **col) -> str:
    """Pedido como a central ou um teste o escreveria, sem passar por `pedir` (colunas livres)."""
    cols = list(col)
    return str(c.execute(f"insert into {tabela} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id", [col[k] for k in cols]).fetchone()["id"])  # noqa: S608


# ------------------------------------------------------------------ parâmetros e chave


def test_chave_idem_vetores_de_ouro_e_normalizacao():
    for tipo, par, esperado in EX.VETORES_DE_OURO:
        assert EX.chave_idem(tipo, par) == esperado, tipo
    a = EX.chave_idem("rodada", EX.normalizar("rodada", {"coletor": "sapl.assembleias", "recorte": {"ufs": ["ro", "AC"], "anos": [2025, 2024]}}))
    b = EX.chave_idem("rodada", EX.normalizar("rodada", {"coletor": "sapl.assembleias", "modo": "recoletar", "recorte": {"ufs": ["AC", "RO", "ac"], "anos": [2024, 2025]}}))
    assert a == b
    assert EX.chave_idem("recoleta", EX.normalizar("recoleta", recoleta("cobertura", " 25 ", "uf"))) == EX.chave_idem("recoleta", EX.normalizar("recoleta", recoleta("cobertura", "25", "uf")))
    # tipos, classes, territórios e coletores diferentes não colidem
    chaves = {EX.chave_idem("recoleta", EX.normalizar("recoleta", recoleta(c, i, v))) for c, i, v in
              (("vinculo_sapl", "25", "uf"), ("cobertura", "25", "uf"), ("vinculo_sapl", "13", "uf"), ("vinculo_sapl", "25", "municipio"))}
    assert len(chaves) == 4
    # a justificativa não entra na chave da decisão; `aplicar` e `valor` entram
    d = dict(pendencia_id="0a1b2c3d-0000-4000-8000-000000000001", acao="corrigir", por_nome="Maria", valor="x")
    k = lambda **kw: EX.chave_idem("decisao", EX.parametros_decisao(**{**d, "justificativa": "j", "aplicar": False, **kw}))  # noqa: E731
    assert k() == k(justificativa="outra") and k() != k(aplicar=True) and k() != k(valor="y") and k() != k(por_nome="João") and k(por_nome=" Maria ") == k()


@pytest.mark.parametrize("tipo,par,trecho", [
    ("recoleta", {"classe": "inexistente", "territorio": {"ibge": "25", "nivel": "uf"}}, "classe inválida"),
    ("recoleta", {"classe": "cobertura", "territorio": {"ibge": "25", "nivel": "bairro"}}, "nivel"),
    ("recoleta", {"classe": "cobertura", "territorio": {"ibge": " ", "nivel": "uf"}}, "ibge"),
    ("recoleta", {"classe": "cobertura", "territorio": {"ibge": "25", "nivel": "uf", "x": 1}}, "chave desconhecida"),
    ("parecer", {}, "um só dos dois"),
    ("parecer", {"pendencia_id": "0a1b2c3d-0000-4000-8000-000000000001", "rodada_id": "0a1b2c3d-0000-4000-8000-000000000002"}, "um só dos dois"),
    ("parecer", {"pendencia_id": "nao-e-uuid"}, "inválido"),
    ("rodada", {}, "coletor"),
    ("rodada", {"coletor": "sapl.assembleias", "repetir": "0a1b2c3d-0000-4000-8000-000000000002"}, "não se combina"),
    ("rodada", {"coletor": "sapl.assembleias", "modo": "voar"}, "modo inválido"),
    ("rodada", {"coletor": "sapl.assembleias", "recorte": {"ibges": ["12"]}}, "recorte inválido"),
    ("rodada", "texto", "objeto JSON"),
    ("nada", {}, "tipo de pedido inválido"),
])
def test_parametros_invalidos_sao_recusados_antes_de_gravar(cx, tipo, par, trecho):
    with pytest.raises(ErroAdmin, match=trecho):
        EX.pedir(cx, tipo, par)
    assert n(cx, "adm_pedidos") == 0


# ------------------------------------------------------------------ 1. critério 20


def test_criterio_20_dois_cliques_na_recoleta_geram_um_pedido_so(cx):
    p1, novo1 = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    p2, novo2 = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    assert (novo1, novo2) == (True, False) and p1["id"] == p2["id"] and p1["chave_idem"] == p2["chave_idem"]
    assert n(cx, "adm_pedidos") == 1
    p3, novo3 = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_AM, "uf"))  # outro território: outro pedido
    assert novo3 and p3["id"] != p1["id"] and n(cx, "adm_pedidos") == 2
    # com o pedido em execução continua sendo o mesmo
    cx.execute("update adm_pedidos set status = 'em_execucao', iniciado_em = now(), batimento_em = now() where id = %s", (p1["id"],))
    cx.commit()
    p4, novo4 = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    assert not novo4 and p4["id"] == p1["id"] and p4["status"] == "em_execucao"
    # depois de terminar, um pedido igual é aceito (o índice é parcial)
    cx.execute("update adm_pedidos set status = 'concluido', finalizado_em = now() where id = %s", (p1["id"],))
    cx.commit()
    p5, novo5 = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    assert novo5 and p5["id"] != p1["id"] and n(cx, "adm_pedidos") == 3


@pytest.mark.parametrize("tcp", [True, False], ids=["tcp", "set_role"])
def test_criterio_20_a_central_insere_como_admin_central_e_o_segundo_e_recusado(cx, base, tcp):
    par = EX.normalizar("recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    k = EX.chave_idem("recoleta", par)
    ins = f"insert into adm_pedidos (tipo, parametros, chave_idem, por_email) values ('recoleta', %s, %s, '{EMAIL_PADRAO}')"
    sql_central = com_email(EX.SQL_INSERIR_PEDIDO)  # SQL_INSERIR_PEDIDO + por_email (0156)
    with como_central(base, tcp=tcp) as c:
        c.execute(ins, (json.dumps(par), k))
        with pytest.raises(pe.UniqueViolation):  # o segundo clique sem `on conflict`: o índice único parcial recusa
            c.execute(ins, (json.dumps(par), k))
        # a forma que a central usa (SQL_INSERIR_PEDIDO): `on conflict` infere o índice parcial; sem linha devolvida, lê o existente
        assert c.execute(sql_central, ("recoleta", json.dumps(par), k, EMAIL_PADRAO)).fetchone() is None
        existente = c.execute(EX.SQL_PEDIDO_ATIVO, (k,)).fetchall()
        assert len(existente) == 1 and existente[0]["status"] == "na_fila" and existente[0]["parametros"] == par
        # a policy continua valendo: a central não cria pedido já em execução, nem com andamento
        with pytest.raises(pe.InsufficientPrivilege):
            c.execute(f"insert into adm_pedidos (tipo, chave_idem, status, por_email) values ('recoleta', 'outra', 'em_execucao', '{EMAIL_PADRAO}')")
    assert n(cx, "adm_pedidos") == 1
    # `pedir` (superusuário, a CLI) reconhece o pedido que a central gravou
    p, novo = EX.pedir(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    assert not novo and str(p["id"]) == str(existente[0]["id"])
    # e depois de concluído o executor o libera: a central aceita outro igual
    cx.execute("update adm_pedidos set status = 'em_execucao' where id = %s", (p["id"],))
    cx.execute("update adm_pedidos set status = 'concluido', finalizado_em = now() where id = %s", (p["id"],))
    cx.commit()
    with como_central(base, tcp=tcp) as c:
        novo_id = c.execute(sql_central, ("recoleta", json.dumps(par), k, EMAIL_PADRAO)).fetchone()
    assert novo_id is not None and n(cx, "adm_pedidos") == 2


# ------------------------------------------------------------------ 2. rodada


def test_pedido_de_rodada_o_executor_abre_e_executa(cx, monkeypatch, tmp_path):
    t = AF.instalar(monkeypatch, "v1", tmp_path / "c1")
    p, _ = pedir_e_comitar(cx, "rodada", {"coletor": "sapl.assembleias", "recorte": {"ufs": list(AF.UFS)}})
    antes = {"rodadas": n(cx, "adm_rodadas")}
    r = EX.executar_um(cx)
    assert t.nao_previstos == []
    assert r["status"] == "concluido" and r["erro"] is None and r["tabela"] == "adm_pedidos" and r["finalizacao_perdida"] is False
    linha = pedido(cx, p["id"])
    assert linha["status"] == "concluido" and linha["rodada_id"] is not None and linha["iniciado_em"] and linha["batimento_em"] and linha["finalizado_em"] and linha["erro"] is None
    assert str(linha["rodada_id"]) == r["rodada_id"] and linha["andamento"]["etapa"] == "concluido" and linha["andamento"]["status_da_rodada"] == "concluida"
    rd = R._carregar(cx, linha["rodada_id"])
    assert rd["status"] == "concluida" and rd["coletor"] == "sapl.assembleias" and rd["recorte"]["ufs"] == sorted(AF.UFS) and rd["modo"] == "recoletar"
    assert n(cx, "adm_rodadas") == antes["rodadas"] + 1
    assert EX.executar_um(cx) is None  # fila vazia
    # repetir pelo identificador: rodada nova, `repete_id` apontando para a de origem
    p2, _ = pedir_e_comitar(cx, "rodada", {"repetir": str(linha["rodada_id"]), "so_pendencias": False})
    r2 = EX.executar_um(cx)
    assert r2["status"] == "concluido" and r2["rodada_id"] != str(linha["rodada_id"])
    assert str(R._carregar(cx, r2["rodada_id"])["repete_id"]) == str(linha["rodada_id"]) and str(pedido(cx, p2["id"])["rodada_id"]) == r2["rodada_id"]
    # repetir só o que falhou: na v1 a PB (500) e a PI (robots) falharam: a rodada nova leva só elas e `so_pendencias`
    p3, _ = pedir_e_comitar(cx, "rodada", {"repetir": r2["rodada_id"], "so_pendencias": True})
    r3 = EX.executar_um(cx)
    cx.rollback()
    assert r3["status"] == "concluido" and r3["rodada_id"] not in (None, r2["rodada_id"])
    rd3 = R._carregar(cx, r3["rodada_id"])
    assert rd3["so_pendencias"] is True and "PB" in rd3["recorte"]["ufs"] and "AC" not in rd3["recorte"]["ufs"] and str(rd3["repete_id"]) == r2["rodada_id"]


@pytest.mark.parametrize("par,motivo", [
    ({"coletor": "nao.existe", "modo": "recoletar", "recorte": {}}, "sem entrada no catálogo"),
    ({"coletor": "sapl.assembleias", "modo": "recoletar", "recorte": {"anos": [2024]}}, "rodada recusada"),  # recorte não suportado pelo catálogo
    ({"repetir": "0a1b2c3d-0000-4000-8000-0000000000ff"}, "rodada inexistente"),
    ({"coletor": 7}, "coletor"),
    ({"qualquer": "coisa"}, "chave desconhecida"),
])
def test_parametro_invalido_no_pedido_falha_com_o_motivo_sem_executar_nada(cx, par, motivo):
    try:  # C11: a chave tem de ser a dos parâmetros NORMALIZADOS (o executor a recalcula); o que não normaliza fica com a chave crua e falha no tipo
        chave = EX.chave_idem("rodada", EX.normalizar("rodada", par))
    except ErroAdmin:
        chave = EX.chave_idem("rodada", par)
    pid = inserir_cru(cx, "adm_pedidos", tipo="rodada", parametros=json.dumps(par), chave_idem=chave)
    cx.commit()
    nr = n(cx, "adm_rodadas")
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and motivo in r["erro"], r
    linha = pedido(cx, pid)
    assert linha["status"] == "falhou" and motivo in linha["erro"] and linha["finalizado_em"] and linha["rodada_id"] is None
    assert n(cx, "adm_rodadas") == nr and n(cx, "adm_tentativas") == 0


# ------------------------------------------------------------------ 3. recoleta


def test_recoleta_da_uf_abre_rodada_com_o_recorte_certo_e_forca_as_urls_de_evidencia(cx, monkeypatch, tmp_path, v1_v2):
    rid1, rid2 = v1_v2
    pb = pend_de(cx, "PB")
    evid = sorted(r["url"] for r in cx.execute("select distinct pr.url from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id where pp.pendencia_id = %s", (pb,)).fetchall())
    assert evid == [API["PB"]]
    t = AF.instalar(monkeypatch, "v2", tmp_path / "c3")
    p, _ = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    p_igual, novo = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    assert not novo
    nr = n(cx, "adm_rodadas")
    r = EX.executar_um(cx)
    cx.rollback()
    assert t.nao_previstos == []
    assert r["status"] == "concluido", r
    linha = pedido(cx, p["id"])
    rd = R._carregar(cx, linha["rodada_id"])
    assert n(cx, "adm_rodadas") == nr + 1 and str(rd["id"]) not in (rid1, rid2)
    assert rd["coletor"] == "sapl.assembleias" and rd["recorte"]["ufs"] == ["PB"] and rd["recorte"]["ibges"] == [] and rd["modo"] == "recoletar" and rd["status"] == "concluida"
    assert rd["forcar_urls"] == evid  # as URLs das evidências das propostas das pendências
    assert linha["andamento"]["etapa"] == "concluido" and linha["status"] == "concluido"
    # a releitura foi mesmo forçada: o /api/ da PB foi pedido na rede (fabricada) nesta rodada
    assert any(u == API["PB"] for u in t.pedidos)
    # território sem pendência aberta: concluído, sem rodada
    nr = n(cx, "adm_rodadas")
    p2, _ = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PI, "uf"))
    r2 = EX.executar_um(cx)
    cx.rollback()
    assert r2["status"] == "concluido" and r2["rodada_id"] is None and n(cx, "adm_rodadas") == nr
    assert pedido(cx, p2["id"])["andamento"]["mensagem"] == "nenhuma pendência aberta neste território e classe"
    # classe sem pendência naquele território também (a PB tem pendência de vinculo_sapl, não de cobertura)
    p3, _ = pedir_e_comitar(cx, "recoleta", recoleta("cobertura", UF_PB, "uf"))
    r3 = EX.executar_um(cx)
    assert r3["status"] == "concluido" and r3["rodada_id"] is None


def test_recoleta_de_identidade_falha_com_motivo_e_nivel_sem_coletor_tambem(cx, v1_v2):
    nr = n(cx, "adm_rodadas")
    p, _ = pedir_e_comitar(cx, "recoleta", recoleta("identidade", UF_PB, "uf"))
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and "identidade não tem território" in r["erro"] and pedido(cx, p["id"])["status"] == "falhou" and n(cx, "adm_rodadas") == nr
    # UF inexistente em places, com pendência no território: não há como (nenhum registro cai nele) -> concluído sem rodada
    p2, _ = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", "99", "uf"))
    assert EX.executar_um(cx)["rodada_id"] is None and n(cx, "adm_rodadas") == nr


# ------------------------------------------------------------------ 4. parecer (critério 22 pelo caminho do executor)


def test_criterio_22_pedido_de_parecer_nao_altera_tabela_de_dominio(cx, base, v1_v2, monkeypatch):
    rid1, rid2 = v1_v2
    assert os.environ.get("ANTHROPIC_API_KEY") == "chave-falsa-de-teste"  # G2-1: a trava de cliente (fixture autouse) está armada com a chave presente
    assert APL.chaves_dos_agentes(cx)["ligadas"] is False  # as duas chaves desligadas
    cx.rollback()
    pb, am = pend_de(cx, "PB"), pend_de(cx, "AM")
    comparadas = [t for t in retrato(cx, ()) if t not in NO_RETRATO_FORA]
    assert len(comparadas) > 60 and {"sapl_houses", "adm_pendencias", "adm_decisoes", "adm_overrides", "corrections", "people", "pipeline_switches", "adm_rodadas"} <= set(comparadas)
    cx.rollback()
    # (a) uma pendência
    p1, _ = pedir_e_comitar(cx, "parecer", {"pendencia_id": pb})
    antes = retrato(cx, NO_RETRATO_FORA)
    cx.rollback()
    r1 = EX.executar_um(cx)
    cx.rollback()
    assert r1["status"] == "concluido" and r1["erro"] is None
    assert retrato(cx, NO_RETRATO_FORA) == antes
    cx.rollback()
    assert n(cx, "adm_pareceres") == 1
    pr = cx.execute("select * from adm_pareceres").fetchone()
    assert (pr["modo"], pr["simulado"], pr["modelo"], str(pr["pendencia_id"]), str(pr["pedido_id"])) == ("ensaio", True, "ensaio-local", pb, str(p1["id"]))
    assert pedido(cx, p1["id"])["andamento"]["pareceres"] == 1
    # (b) a rodada inteira: um parecer por pendência aberta ligada a ela (PB e AM)
    p2, _ = pedir_e_comitar(cx, "parecer", {"rodada_id": rid2})
    antes = retrato(cx, NO_RETRATO_FORA)
    cx.rollback()
    r2 = EX.executar_um(cx)
    cx.rollback()
    assert r2["status"] == "concluido" and retrato(cx, NO_RETRATO_FORA) == antes
    cx.rollback()
    novos = cx.execute("select pendencia_id, simulado, modo from adm_pareceres where pedido_id = %s", (p2["id"],)).fetchall()
    assert sorted(str(x["pendencia_id"]) for x in novos) == sorted([pb, am]) and all(x["simulado"] and x["modo"] == "ensaio" for x in novos)
    assert n(cx, "adm_pareceres", "not simulado") == 0 and n(cx, "adm_decisoes") == 0
    # rodada sem pendência ligada, pendência inexistente: concluído vazio / falhou com o motivo
    p3, _ = pedir_e_comitar(cx, "parecer", {"rodada_id": rid1})
    assert EX.executar_um(cx)["status"] == "concluido" and n(cx, "adm_pareceres") == 3
    p4, _ = pedir_e_comitar(cx, "parecer", {"pendencia_id": "0a1b2c3d-0000-4000-8000-0000000000ff"})
    r4 = EX.executar_um(cx)
    assert r4["status"] == "falhou" and "inexistente" in r4["erro"] and n(cx, "adm_pareceres") == 3


# ------------------------------------------------------------------ 5. decisão


def _pedido_de_decisao(c, pendencia: str, *, acao: str = "aprovar", aplicar: bool = True, nome: str = "Fulana de Teste", just: str = "conferi na página da casa", valor=None) -> str:
    k = EX.chave_idem("decisao", EX.parametros_decisao(pendencia_id=pendencia, acao=acao, por_nome=nome, justificativa=just, valor=valor, aplicar=aplicar))
    return str(c.execute(com_email(EX.SQL_INSERIR_PEDIDO_DECISAO), (pendencia, acao, nome, just, json.dumps(valor) if valor is not None else None, aplicar, k, email_de(nome))).fetchone()["id"])


def test_decisao_pedida_pela_central_vira_decisao_de_pessoa_e_aplica(cx, base, v1_v2):
    pb = pend_de(cx, "PB")
    cx.rollback()
    with como_central(base, tcp=False) as c:
        pid = _pedido_de_decisao(c, pb)
        k = EX.chave_idem("decisao", EX.parametros_decisao(pendencia_id=pb, acao="aprovar", por_nome="Fulana de Teste", justificativa="x", aplicar=True))
        assert c.execute(com_email(EX.SQL_INSERIR_PEDIDO_DECISAO), (pb, "aprovar", "Fulana de Teste", "outra justificativa", None, True, k, email_de("Fulana de Teste"))).fetchone() is None  # segundo clique
        assert c.execute(EX.SQL_PEDIDO_DECISAO_ATIVO, (k,)).fetchone()["id"] == pedido(cx, pid, "adm_pedidos_decisao")["id"]
        with pytest.raises(pe.InsufficientPrivilege):
            c.execute("update adm_pedidos_decisao set status = 'concluido' where id = %s", (pid,))
    cx.rollback()
    assert n(cx, "adm_pedidos_decisao") == 1 and n(cx, "adm_decisoes") == 0
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "concluido" and r["tabela"] == "adm_pedidos_decisao" and r["tipo"] == "decisao" and r["decisao_id"]
    linha = pedido(cx, pid, "adm_pedidos_decisao")
    assert linha["status"] == "concluido" and str(linha["decisao_id"]) == r["decisao_id"] and linha["erro"] is None and linha["finalizado_em"] and linha["iniciado_em"]
    d = cx.execute("select * from adm_decisoes").fetchall()
    assert len(d) == 1 and str(d[0]["id"]) == r["decisao_id"]
    assert (d[0]["decidido_por_tipo"], d[0]["decidido_por_nome"], d[0]["acao"], d[0]["aplicada"], str(d[0]["pendencia_id"])) == ("pessoa", "Fulana de Teste", "aprovar", True, pb)
    assert d[0]["relatorio"] is None and d[0]["versao_verificador"] is None
    assert cx.execute("select status from adm_pendencias where id = %s", (pb,)).fetchone()["status"] == "decidida"
    # a pendência já decidida: o pedido seguinte falha com a mensagem de `decidir`, sem decisão nova
    with como_central(base, tcp=False) as c:
        pid2 = _pedido_de_decisao(c, pb, nome="Outra Pessoa")
    r2 = EX.executar_um(cx)
    assert r2["status"] == "falhou" and "já está decidida" in r2["erro"] and n(cx, "adm_decisoes") == 1
    assert n(cx, "adm_decisoes", "decidido_por_tipo <> 'pessoa'") == 0 and pedido(cx, pid2, "adm_pedidos_decisao")["decisao_id"] is None


def test_decisao_com_fontes_divergentes_falha_com_a_mensagem_de_decidir_e_nao_aplica_nada(cx, base, v1_v2):
    pi = str(casa(cx, "PI")["id"])
    for i, (url, valor) in enumerate((("https://fonte-a.example/pi", "fora_do_ar"), ("https://fonte-b.example/pi", "sem_api"))):
        PR.registrar(cx, PR.Proposta(classe="vinculo_sapl", registro_chave=pi, campo="status", valor_candidato=valor, url=url, trecho=f"a casa diz {valor}", conteudo_sha256=f"{i + 1}" * 64,
                                     lida_em=datetime(2026, 11, 15, 10, i, tzinfo=timezone.utc)), agora=datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc))
    cx.commit()
    p = cx.execute("select id, tipo, status from adm_pendencias where registro_chave = %s", (pi,)).fetchone()
    assert (p["tipo"], p["status"]) == ("divergencia", "aberta")
    overrides = n(cx, "adm_overrides")
    with como_central(base, tcp=False) as c:
        pid = _pedido_de_decisao(c, str(p["id"]))
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and "fontes divergentes" in r["erro"]
    linha = pedido(cx, pid, "adm_pedidos_decisao")
    assert linha["status"] == "falhou" and linha["decisao_id"] is None and "fontes divergentes" in linha["erro"]
    assert n(cx, "adm_decisoes") == 0 and n(cx, "adm_overrides") == overrides and cx.execute("select status from adm_pendencias where id = %s", (p["id"],)).fetchone()["status"] == "aberta"
    # corrigir com valor escolhido e `aplicar`: decisão de pessoa, aplicada; descartar com `aplicar` é recusado antes de qualquer escrita
    with como_central(base, tcp=False) as c:
        ok = _pedido_de_decisao(c, str(p["id"]), acao="corrigir", valor="sem_api", nome="Beltrano", just="a fonte B é a oficial")
        ruim = _pedido_de_decisao(c, str(p["id"]), acao="descartar", aplicar=True, nome="Beltrano")
    r_ok, r_ruim = EX.executar_um(cx), EX.executar_um(cx)
    assert (r_ok["status"], r_ruim["status"]) == ("concluido", "falhou") and "aplicar não vale com descartar" in r_ruim["erro"]
    d = cx.execute("select decidido_por_tipo, decidido_por_nome, aplicada, valor from adm_decisoes").fetchall()
    assert [(x["decidido_por_tipo"], x["decidido_por_nome"], x["aplicada"], x["valor"]) for x in d] == [("pessoa", "Beltrano", True, "sem_api")]
    assert n(cx, "adm_pedidos_decisao", "status = 'concluido'") == 1 and pedido(cx, ok, "adm_pedidos_decisao")["decisao_id"] is not None and ruim


# ------------------------------------------------------------------ 6. executor morto e executor parado


def test_executor_morto_o_proximo_marca_interrompido_e_recupera_a_rodada(cx, base):
    rid = str(cx.execute("insert into adm_rodadas (coletor, modo, status, invocation) values ('sapl.assembleias', 'recoletar', 'em_andamento', 'admin:x') returning id").fetchone()["id"])
    par = EX.normalizar("rodada", {"coletor": "sapl.assembleias"})
    morto = inserir_cru(cx, "adm_pedidos", tipo="rodada", parametros=json.dumps(par), chave_idem="k-morto", status="em_execucao", iniciado_em=datetime.now(timezone.utc) - timedelta(minutes=5),
                        batimento_em=datetime.now(timezone.utc) - timedelta(minutes=5), rodada_id=rid)
    vivo = inserir_cru(cx, "adm_pedidos", tipo="rodada", parametros=json.dumps(par), chave_idem="k-vivo", status="em_execucao", iniciado_em=datetime.now(timezone.utc) - timedelta(seconds=30),
                       batimento_em=datetime.now(timezone.utc) - timedelta(seconds=30))
    cx.commit()
    assert EX.executar_um(cx) is None  # nada na fila: só limpou
    cx.rollback()
    m = pedido(cx, morto)
    assert m["status"] == "interrompido" and "executor ausente" in m["erro"] and m["finalizado_em"]
    assert pedido(cx, vivo)["status"] == "em_execucao"  # batimento de 30 s: vivo
    rd = R._carregar(cx, rid)
    assert rd["status"] == "interrompida" and rd["previa"]["resultado"]["recuperada"] is True and "executor ausente" in rd["previa"]["resultado"]["motivo"]
    # a limpeza é idempotente e sem escrita quando nada venceu
    assert EX.limpar_orfaos(cx) == []


def test_executor_morto_com_a_trava_da_rodada_tomada_nao_a_recupera_e_diz_por_que(cx, base):
    rid = str(cx.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'em_andamento') returning id").fetchone()["id"])
    cx.commit()
    outro = psycopg.connect(base, row_factory=dict_row)
    try:
        assert R._tomar_trava(outro, rid)  # um executor VIVO segura a trava da rodada
        pid = inserir_cru(cx, "adm_pedidos", tipo="rodada", parametros="{}", chave_idem="k", status="em_execucao", iniciado_em=datetime.now(timezone.utc) - timedelta(minutes=9),
                          batimento_em=datetime.now(timezone.utc) - timedelta(minutes=9), rodada_id=rid)
        cx.commit()
        achados = EX.limpar_orfaos(cx)
        assert len(achados) == 1 and "não recuperada" in achados[0]["rodada"]
        cx.rollback()
        assert pedido(cx, pid)["status"] == "interrompido" and "sendo executada por outro processo" in pedido(cx, pid)["erro"] and R._carregar(cx, rid)["status"] == "em_andamento"
    finally:
        outro.close()


def test_executor_parado_pela_regra_do_plano(cx):
    agora = cx.execute("select clock_timestamp() as t").fetchone()["t"]
    ev = lambda seg: EX.estado_dos_pedidos(cx, agora=agora + timedelta(seconds=seg))["executor_parado"]  # noqa: E731
    cx.rollback()
    vazio = EX.estado_dos_pedidos(cx, agora=agora)
    assert vazio["executor_parado"]["sim"] is False and vazio["executor_parado"]["motivo"] is None and vazio["ativos"] == [] and vazio["contagens"] == {"adm_pedidos": {}, "adm_pedidos_decisao": {}}
    # fila recente: não está parado; fila com mais de 60 s: parado por fila velha, com o horário do pedido mais antigo
    p, _ = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    criado = pedido(cx, p["id"])["criado_em"]
    assert ev(30)["sim"] is False and ev(59)["sim"] is False
    e = ev(61)
    assert (e["sim"], e["motivo"], e["desde"]) == (True, "fila_velha", criado) and "na fila há mais de 60 s" in e["mensagem"] and e["n_fila_velha"] == 1 and e["n_batimento_vencido"] == 0
    # pedido de decisão na fila também conta (a regra vale para as duas tabelas)
    est = EX.estado_dos_pedidos(cx, agora=agora + timedelta(seconds=61))
    assert est["contagens"]["adm_pedidos"] == {"na_fila": 1} and [a["tipo"] for a in est["ativos"]] == ["recoleta"]
    # em execução: batimento em dia = não está parado; 120 s sem batimento = parado por batimento vencido (prevalece sobre a fila velha)
    cx.execute("update adm_pedidos set status = 'em_execucao', iniciado_em = %s, batimento_em = %s where id = %s", (agora, agora, p["id"]))
    cx.commit()
    assert ev(100)["sim"] is False and ev(119)["sim"] is False
    e = ev(121)
    assert (e["sim"], e["motivo"], e["desde"]) == (True, "batimento_vencido", agora) and "sem batimento há mais de 120 s" in e["mensagem"] and e["n_batimento_vencido"] == 1
    p2, _ = pedir_e_comitar(cx, "recoleta", recoleta("vinculo_sapl", UF_AM, "uf"))  # fila velha E batimento vencido: o motivo é o do executor morto
    e = ev(200)
    assert (e["motivo"], e["n_fila_velha"], e["n_batimento_vencido"]) == ("batimento_vencido", 1, 1)
    # fila velha com um pedido em execução de batimento em dia: pela regra é parado, mas diz que o executor está ocupado
    cx.execute("update adm_pedidos set batimento_em = %s where id = %s", (agora + timedelta(seconds=90), p["id"]))
    cx.commit()
    e = ev(100)
    assert e["sim"] is True and e["motivo"] == "fila_velha" and e["executor_ocupado"] is True and "ocupado" in e["mensagem"]
    # pedido terminado não conta
    cx.execute("update adm_pedidos set status = 'concluido' where id = %s", (p["id"],))
    cx.execute("update adm_pedidos set status = 'em_execucao' where id = %s", (p2["id"],))
    cx.execute("update adm_pedidos set status = 'falhou', erro = 'x' where id = %s", (p2["id"],))
    cx.commit()
    assert ev(10_000)["sim"] is False


# ------------------------------------------------------------------ 7. batimento


def test_o_batimento_avanca_enquanto_o_coletor_roda(cx, base):
    par = {"coletor": "sapl.assembleias", "recorte": {"ufs": ["RO"]}}
    p, _ = pedir_e_comitar(cx, "rodada", par)
    amostras: list = []

    with psycopg.connect(base, row_factory=dict_row, autocommit=True) as mon:
        def amostra() -> None:
            amostras.append(mon.execute("select batimento_em, status from adm_pedidos where id = %s", (p["id"],)).fetchone())

        def lento(argv: list[str]) -> int:  # o "coletor" demora 3 s sem devolver o controle: a thread principal está presa aqui
            amostra()
            for _ in range(5):
                time.sleep(0.6)
                amostra()
            return 0

        r = EX.executar_um(cx, runner=lento, batimento_s=0.5)
    assert r["status"] == "concluido" and r["batidas"] >= 4 and r["falhas_do_batimento"] == []
    vistos = [a["batimento_em"] for a in amostras]
    assert all(a["status"] == "em_execucao" for a in amostras)
    assert len(set(vistos)) >= 4 and vistos == sorted(vistos), vistos  # avançou durante a execução, não só no começo e no fim
    assert (max(vistos) - min(vistos)).total_seconds() >= 2.0
    # depois do fim a thread parou: o batimento não muda mais
    final = pedido(cx, p["id"])
    cx.rollback()
    time.sleep(1.2)
    assert pedido(cx, p["id"])["batimento_em"] == final["batimento_em"] and final["status"] == "concluido"


# ------------------------------------------------------------------ 8. dois executores


def test_dois_executores_nunca_pegam_o_mesmo_pedido(cx, base):
    ids = []
    for i in range(12):
        p, _ = pedir_e_comitar(cx, "parecer", {"pendencia_id": f"0a1b2c3d-0000-4000-8000-{i:012d}"})
        ids.append(str(p["id"]))
    a = psycopg.connect(base, row_factory=dict_row)
    b = psycopg.connect(base, row_factory=dict_row)
    try:
        # determinístico: A trava o mais antigo e segura o lock; B (skip locked) pega o SEGUNDO mais antigo, e A segue com o primeiro
        primeiro = EX.travar(a)
        segundo = EX.pegar(b)
        assert primeiro["id"] != segundo["id"] and segundo["status"] == "na_fila"
        assert str(primeiro["id"]) == ids[0] and str(segundo["id"]) == ids[1]  # ordem de criação
        EX.marcar(a, primeiro)
        assert {pedido(cx, str(primeiro["id"]))["status"], pedido(cx, str(segundo["id"]))["status"]} == {"em_execucao"}
        cx.rollback()
        # em corrida: duas conexões esvaziam a fila ao mesmo tempo
        pegos: dict[str, list[str]] = {"a": [], "b": []}
        barreira = threading.Barrier(2)

        def correr(nome: str, c) -> None:
            barreira.wait()
            while (p := EX.pegar(c)) is not None:
                pegos[nome].append(str(p["id"]))

        ts = [threading.Thread(target=correr, args=("a", a)), threading.Thread(target=correr, args=("b", b))]
        [t.start() for t in ts]
        [t.join(30) for t in ts]
    finally:
        a.close()
        b.close()
    todos = pegos["a"] + pegos["b"]
    assert len(todos) == len(set(todos)) == 10 and set(todos) | {str(primeiro["id"]), str(segundo["id"])} == set(ids)
    assert n(cx, "adm_pedidos", "status = 'na_fila'") == 0


def test_a_fila_e_por_ordem_de_criacao_nas_duas_tabelas(cx, base, v1_v2):
    pb = pend_de(cx, "PB")
    t0 = datetime.now(timezone.utc)
    p_dec = inserir_cru(cx, "adm_pedidos_decisao", pendencia_id=pb, acao="descartar", por_nome="Zé", justificativa="j", chave_idem="d1", criado_em=t0 - timedelta(seconds=30))
    p_rod = inserir_cru(cx, "adm_pedidos", tipo="parecer", parametros=json.dumps({"pendencia_id": pb}), chave_idem="p1", criado_em=t0 - timedelta(seconds=20))
    cx.commit()
    primeiro = EX.pegar(cx)
    segundo = EX.pegar(cx)
    assert (primeiro["tabela"], str(primeiro["id"])) == ("adm_pedidos_decisao", p_dec) and (segundo["tabela"], str(segundo["id"])) == ("adm_pedidos", p_rod)
    assert EX.pegar(cx) is None


def test_o_executor_nao_le_nem_liga_as_chaves_dos_agentes_e_nunca_usa_o_motor_real():
    """O módulo não menciona a variável da primeira chave, nem `pipeline_switches`, nem `real=`/`por_tipo='agentes'`/cliente de modelo."""
    src = Path(EX.__file__).read_text(encoding="utf-8")
    codigo = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    for proibido in ("pipeline_switches", "ADMIN_COLETA_AGENTES", "VARIAVEL_CHAVE_API", "real=True", "por_tipo=\"agentes\"", "por_tipo='agentes'", "escolher_motor", "motor_modelo", "_cliente_real", "anthropic"):
        assert proibido not in codigo.split('"""', 2)[2], proibido


# ------------------------------------------------------------------ 9. a CLI real


def test_cli_pedido_executor_e_estado(cx, base, capsys):
    argv = ["admin", "pedido", "recoleta", "--classe", "vinculo_sapl", "--ibge", UF_PB, "--nivel", "uf", "--json"]
    assert cli.main(argv) == 0
    a = json.loads(capsys.readouterr().out)
    assert cli.main(argv) == 0
    b = json.loads(capsys.readouterr().out)
    assert a["pedido_id"] == b["pedido_id"] and (a["novo"], b["novo"]) == (True, False) and a["tabela"] == "adm_pedidos" and a["status"] == "na_fila"
    assert n(cx, "adm_pedidos") == 1 and a["chave_idem"] == EX.chave_idem("recoleta", EX.normalizar("recoleta", recoleta("vinculo_sapl", UF_PB, "uf")))
    assert cli.main(["admin", "pedido", "estado", "--json"]) == 0
    est = json.loads(capsys.readouterr().out)
    assert est["contagens"]["adm_pedidos"] == {"na_fila": 1} and est["ativos"][0]["id"] == a["pedido_id"] and est["executor_parado"]["sim"] is False
    assert cli.main(["admin", "executor", "--uma-vez"]) == 0  # recoleta sem pendência: concluído, sem rodada
    capsys.readouterr()
    assert pedido(cx, a["pedido_id"])["status"] == "concluido"
    cx.rollback()
    assert cli.main(["admin", "executor", "--uma-vez"]) == 0 and "nenhum pedido" in capsys.readouterr().out
    assert cli.main(["admin", "pedido", "estado"]) == 0 and "executor em dia" in capsys.readouterr().out
    # pedido que falha: o executor sai com 1
    assert cli.main(["admin", "pedido", "recoleta", "--classe", "identidade", "--ibge", UF_PB, "--nivel", "uf"]) == 0
    capsys.readouterr()
    assert cli.main(["admin", "executor", "--uma-vez"]) == 1
    capsys.readouterr()
    # erros de uso e de validação
    assert cli.main(["admin", "pedido", "parecer"]) == 1 and "um só dos dois" in capsys.readouterr().err
    assert cli.main(["admin", "pedido", "rodada"]) == 2 and "--coletor" in capsys.readouterr().err
    assert cli.main(["admin", "pedido", "decidir", "0a1b2c3d-0000-4000-8000-0000000000ff", "--acao", "aprovar", "--por", "F", "--justificativa", "j"]) == 1
    assert "pendência inexistente" in capsys.readouterr().err
    assert n(cx, "adm_pedidos_decisao") == 0


def test_cli_pedido_de_decisao_e_de_parecer_e_idempotente(cx, base, v1_v2, capsys):
    pb = pend_de(cx, "PB")
    cx.rollback()
    argv = ["admin", "pedido", "decidir", pb, "--acao", "aprovar", "--por", "Fulana", "--justificativa", "conferi", "--aplicar", "--json"]
    assert cli.main(argv) == 0
    a = json.loads(capsys.readouterr().out)
    assert cli.main(argv) == 0
    b = json.loads(capsys.readouterr().out)
    assert a["tabela"] == "adm_pedidos_decisao" and a["pedido_id"] == b["pedido_id"] and (a["novo"], b["novo"]) == (True, False)
    assert cli.main(["admin", "executor", "--uma-vez"]) == 0
    capsys.readouterr()
    d = cx.execute("select decidido_por_tipo, decidido_por_nome, aplicada from adm_decisoes").fetchall()
    assert [(x["decidido_por_tipo"], x["decidido_por_nome"], x["aplicada"]) for x in d] == [("pessoa", "Fulana", True)]
    assert cli.main(["admin", "pedido", "parecer", "--rodada", v1_v2[1], "--json"]) == 0
    capsys.readouterr()
    assert cli.main(["admin", "executor", "--uma-vez"]) == 0  # a pendência da PB já foi decidida: só a da AM tem parecer
    capsys.readouterr()
    assert n(cx, "adm_pareceres") == 1 and n(cx, "adm_pareceres", "simulado") == 1


# ------------------------------------------------------------------ C11: `chave_idem` forjada e relógio do pedido (G4-1)


def test_chave_idem_forjada_pela_central_falha_no_executor_sem_efeito(cx, base):
    par = EX.normalizar("recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    # a central (admin_central) insere como quiser a chave: aqui, uma que não é a dos parâmetros
    with como_central(base, tcp=False) as c:
        pid = inserir_cru(c, "adm_pedidos", tipo="recoleta", parametros=json.dumps(par), chave_idem="forjada-0123", por_email=EMAIL_PADRAO)
    cx.commit()
    nr, nt = n(cx, "adm_rodadas"), n(cx, "adm_tentativas")
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and r["erro"] == "chave_idem não confere com os parâmetros", r
    linha = pedido(cx, pid)
    assert linha["status"] == "falhou" and linha["erro"] == "chave_idem não confere com os parâmetros" and linha["rodada_id"] is None
    assert n(cx, "adm_rodadas") == nr and n(cx, "adm_tentativas") == nt
    # com a chave certa, o mesmo pedido passa da checagem (não falha por chave)
    cx.execute("delete from adm_pedidos where id = %s", (pid,))
    cx.commit()
    chave = EX.chave_idem("recoleta", par)
    assert chave != "forjada-0123"


def test_chave_idem_forjada_em_pedido_de_decisao_falha_sem_decidir(cx, base, v1_v2):
    pend = pend_de(cx, "PB")
    cx.rollback()
    with como_central(base, tcp=False) as c:
        pid = inserir_cru(c, "adm_pedidos_decisao", pendencia_id=pend, acao="aprovar", por_nome="Fulana", justificativa="conferi", aplicar=False, chave_idem="forjada-decisao", por_email=email_de("Fulana"))
    nd = n(cx, "adm_decisoes")
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and r["erro"] == "chave_idem não confere com os parâmetros", r
    assert pedido(cx, pid, "adm_pedidos_decisao")["status"] == "falhou" and n(cx, "adm_decisoes") == nd


def test_pedido_de_rodada_com_chave_certa_nao_falha_por_chave(cx):
    par = {"coletor": "nao.existe", "modo": "recoletar", "recorte": {}}
    pid = inserir_cru(cx, "adm_pedidos", tipo="rodada", parametros=json.dumps(par), chave_idem=EX.chave_idem("rodada", EX.normalizar("rodada", par)))
    cx.commit()
    r = EX.executar_um(cx)
    cx.rollback()
    assert r["status"] == "falhou" and "chave_idem" not in r["erro"] and "sem entrada no catálogo" in r["erro"], r
    assert pedido(cx, pid)["status"] == "falhou"


def test_criado_em_antigo_pela_central_e_recusado_e_o_padrao_e_aceito(cx, base):
    par = EX.normalizar("recoleta", recoleta("vinculo_sapl", UF_PB, "uf"))
    k = EX.chave_idem("recoleta", par)
    with como_central(base, tcp=False) as c:
        with pytest.raises(pe.InsufficientPrivilege):
            c.execute(f"insert into adm_pedidos (tipo, parametros, chave_idem, criado_em, por_email) values ('recoleta', %s, %s, now() - interval '10 minutes', '{EMAIL_PADRAO}')", (json.dumps(par), k))
        assert c.execute(f"insert into adm_pedidos (tipo, parametros, chave_idem, por_email) values ('recoleta', %s, %s, '{EMAIL_PADRAO}') returning id", (json.dumps(par), k)).fetchone()
    assert n(cx, "adm_pedidos") == 1


# ------------------------------------------------------------------ F3-T1: anti-SSRF no pedido de decisão


def test_decisao_com_base_url_interno_termina_falhou_com_o_motivo_e_nao_grava(cx, base, v1_v2, monkeypatch):
    """`decisoes.decidir` recusa o `base_url` que não é https para host público (AC-23); o executor registra o motivo no pedido e não grava decisão nenhuma.
    O DNS é falso (sem rede): `interno.example` resolve para um IP privado, os outros `.example` para um público."""
    real = socket.getaddrinfo
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.9.8.7" if host == "interno.example" else "93.184.216.34", 443))]
                        if str(host).endswith(".example") else real(host, *a, **k))
    pi = str(casa(cx, "PI")["id"])
    PR.registrar(cx, PR.Proposta(classe="vinculo_sapl", registro_chave=pi, campo="base_url", valor_candidato="https://interno.example/sapl", url="https://fonte.example/pi",
                                 trecho="a casa publica em interno.example", conteudo_sha256="9" * 64, lida_em=datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)),
                 agora=datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc))
    cx.commit()
    pend = str(cx.execute("select id from adm_pendencias where registro_chave = %s and campo = 'base_url'", (pi,)).fetchone()["id"])
    nd, no = n(cx, "adm_decisoes"), n(cx, "adm_overrides")
    with como_central(base, tcp=False) as c:
        aprovar = _pedido_de_decisao(c, pend, acao="aprovar", aplicar=False)  # o candidato proposto é interno
        corrigir = _pedido_de_decisao(c, pend, acao="corrigir", aplicar=True, valor="https://127.0.0.1/sapl")
    r1, r2 = EX.executar_um(cx), EX.executar_um(cx)
    cx.rollback()
    assert (r1["status"], r2["status"]) == ("falhou", "falhou")
    for pid_, trecho in ((aprovar, "10.9.8.7"), (corrigir, "127.0.0.1")):
        linha = pedido(cx, pid_, "adm_pedidos_decisao")
        assert linha["status"] == "falhou" and linha["decisao_id"] is None and "base_url recusado" in linha["erro"] and trecho in linha["erro"], linha["erro"]
    assert n(cx, "adm_decisoes") == nd and n(cx, "adm_overrides") == no
    assert cx.execute("select status from adm_pendencias where id = %s", (pend,)).fetchone()["status"] == "aberta"
    # com um endereço público o mesmo caminho conclui
    with como_central(base, tcp=False) as c:
        ok = _pedido_de_decisao(c, pend, acao="corrigir", aplicar=False, valor="https://sapl.publico.example")
    r3 = EX.executar_um(cx)
    cx.rollback()
    assert r3["status"] == "concluido" and pedido(cx, ok, "adm_pedidos_decisao")["decisao_id"] is not None
    assert cx.execute("select decidido_por_nome, valor from adm_decisoes").fetchone() == {"decidido_por_nome": "Fulana de Teste", "valor": "https://sapl.publico.example"}
