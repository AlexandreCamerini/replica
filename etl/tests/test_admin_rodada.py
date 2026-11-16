"""FABRICADO. A5: rodada de coleta (`admin.rodadas`): abrir, executar, repetir, repetir só pendências, forçar releitura, reprocessar sem rede.

Critérios 4 e 5. O coletor roda EM PROCESSO (`ADMIN_RUNNER=processo`) sobre o transporte fabricado do SAPL (`admin_fixtures.instalar`); uma fixture autouse
faz `contrato.runner_subprocesso` levantar AssertionError (nada chega à rede por subprocesso). O coletor conecta por `db.connect()`, que lê o ambiente:
a fixture aponta ETL_DATABASE_URL e DATABASE_URL para o banco isolado. Nada é gravado no banco da suíte (contagens antes/depois), e tudo que as rodadas
gravam no banco isolado é desfeito em `finally` (`limpar_adm` e `limpar_base`).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import admin_fixtures as AF
import httpx
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row
from test_admin_fixture_sapl import CARGA_V1

from civico_etl import cli
from civico_etl import http as H
from civico_etl.admin import rodadas as R
from civico_etl.admin.saida import ErroAdmin
from civico_etl.catalogo import contrato
from civico_etl.catalogo.contrato import Recorte

TABELAS_SAPL = ("sapl_parlamentares", "sapl_mandatos", "sapl_materias", "sapl_autorias", "sapl_sessoes", "sapl_presencas", "sapl_votos", "sapl_cursors")
CHAVE_NATURAL = {"sapl_parlamentares": "house_id, sapl_id", "sapl_mandatos": "house_id, sapl_id", "sapl_materias": "house_id, sapl_id", "sapl_autorias": "house_id, materia_sapl_id, autor_sapl_id",
                 "sapl_sessoes": "house_id, sapl_id", "sapl_presencas": "house_id, sessao_sapl_id, parlamentar_sapl_id", "sapl_votos": "house_id, sapl_id", "sapl_cursors": "house_id, entity"}
SUITE = ("adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "sapl_houses", "ingest_runs", "dataset_stamps")
HOST = AF.ALE_HOSTS


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
    """Nada deste módulo grava no banco da suíte: as contagens de antes e depois são iguais."""
    def conta():
        return {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}

    antes = conta()
    yield
    assert conta() == antes


@pytest.fixture(autouse=True)
def _ambiente(monkeypatch, banco_isolado):  # noqa: F811
    url = banco_isolado
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.setenv(k, url)
    monkeypatch.setenv("ADMIN_RUNNER", "processo")
    for k in ("ETL_INVOCATION", "ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH", "ADMIN_RODADA_TIMEOUT_S"):
        monkeypatch.delenv(k, raising=False)

    def sem_subprocesso(*a, **k):
        raise AssertionError("runner_subprocesso chamado: o coletor iria à rede de verdade")

    monkeypatch.setattr(contrato, "runner_subprocesso", sem_subprocesso)


def limpar_adm(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("delete from adm_vinculos")
        c.execute("delete from adm_evidencias")
        c.execute("delete from adm_pendencias")
        c.execute("delete from adm_tentativas")
        c.execute("delete from adm_rodadas")


@pytest.fixture
def sapl_base(banco_isolado):  # noqa: F811
    url = banco_isolado
    limpar_adm(url)
    AF.limpar_base(url)
    AF.carregar_base(url)
    try:
        yield url
    finally:
        limpar_adm(url)
        AF.limpar_base(url)


@pytest.fixture
def cx(sapl_base):
    c = psycopg.connect(sapl_base, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    try:
        yield c
    finally:
        c.rollback()
        c.close()


@pytest.fixture
def cache(tmp_path) -> Path:
    return tmp_path / "cache"


# ------------------------------------------------------------------ apoio


def n(cx, sql: str, *p: Any) -> int:
    return cx.execute(sql, p).fetchone()["n"]


def rodada(cx, mp, cache: Path, cenario: str = "v1", *, ufs=AF.UFS, modo: str = "recoletar", recorte: Recorte | None = None, coletor: str = "sapl.assembleias") -> tuple[str, dict, Any]:
    """Instala o cenário, abre e executa. Devolve (id, resultado, transporte)."""
    t = AF.instalar(mp, cenario, cache)
    rid = R.abrir(cx, coletor, recorte or Recorte(ufs=ufs), modo=modo)
    cx.commit()
    res = R.executar(cx, rid)
    assert t.nao_previstos == []
    return rid, res, t


def tentativas(cx, rid: str) -> list[dict[str, Any]]:
    return cx.execute("select url, resultado, motivo, entrada, conteudo_sha256, tentada_em from adm_tentativas where rodada_id = %s order by tentada_em, url", (rid,)).fetchall()


def dominio(cx) -> dict[str, Any]:
    """Foto do que o coletor escreve: linhas inteiras das tabelas sapl_*, casas (sem os carimbos que a sondagem refaz a cada execução) e cobertura (chaves)."""
    out: dict[str, Any] = {t: sorted(json.dumps(r, default=str, sort_keys=True) for r in cx.execute(f"select * from {t}").fetchall()) for t in TABELAS_SAPL}
    out["sapl_houses"] = sorted(json.dumps({k: v for k, v in r.items() if k not in ("checked_at", "updated_at")}, default=str, sort_keys=True) for r in cx.execute("select * from sapl_houses").fetchall())
    out["data_coverage"] = cx.execute("select count(*) as n from data_coverage").fetchone()["n"]
    return out


def contagens(cx) -> dict[str, int]:
    c = {t: n(cx, f"select count(*) as n from {t}") for t in (*TABELAS_SAPL, "sapl_houses", "data_coverage", "adm_vinculos")}
    c["ids_houses"] = sorted(r["id"] for r in cx.execute("select id from sapl_houses").fetchall())  # type: ignore[assignment]
    return c


def sem_duplicata_por_chave_natural(cx) -> None:
    for t, chave in CHAVE_NATURAL.items():
        dup = cx.execute(f"select {chave}, count(*) as n from {t} group by {chave} having count(*) > 1").fetchall()
        assert dup == [], (t, dup)
    dup = cx.execute("select rodada_id, url_sha, tentada_em, count(*) as n from adm_tentativas group by 1, 2, 3 having count(*) > 1").fetchall()
    assert dup == [], dup


def _por_url(linhas: list[dict[str, Any]]) -> dict[str, list[tuple[str, str | None]]]:
    out: dict[str, list[tuple[str, str | None]]] = {}
    for l in linhas:
        out.setdefault(l["url"], []).append((l["resultado"], l["motivo"]))
    return out


ROBOTS = {uf: f"{HOST[uf]}/robots.txt" for uf in AF.UFS}
API = {uf: f"{HOST[uf]}/api/" for uf in AF.UFS}


# ------------------------------------------------------------------ 7: rodada recoletar


def test_7_rodada_recoletar_v1(cx, monkeypatch, cache):
    rid, res, t = rodada(cx, monkeypatch, cache)
    assert res["status"] == "concluida" and res["codigo_saida"] == 0 and res["executou_coletor"] is True and res["runner"] == "processo"
    row = cx.execute("select * from adm_rodadas where id = %s", (rid,)).fetchone()
    assert row["status"] == "concluida" and row["finalizada_em"] is not None and row["invocation"] == f"admin:{rid}" and row["modo"] == "recoletar"
    assert row["argv"] == ["sapl.ales", *[x for u in AF.UFS for x in ("--uf", u)]]
    assert R.recorte_de_json(row["recorte"]) == Recorte(ufs=AF.UFS)  # o JSON reconstrói o Recorte
    assert row["cache_dir"] == str(cache) and row["previa"]["n_urls_entrada"] == 10
    # tentativas: resultado e motivo por URL
    por_url = _por_url(tentativas(cx, rid))
    for uf in AF.UFS:
        assert por_url[ROBOTS[uf]] == [("lida", None)], uf
    for uf in ("RO", "AC", "AM"):
        assert por_url[API[uf]] == [("lida", None)], uf
    assert por_url[API["PB"]] == [("falha", "erro")]  # 500 esgotado
    assert por_url[API["PI"]] == [("falha", "robots")]  # bloqueio acontece antes de fetch: registrado pelo executor
    assert {l["url"] for l in tentativas(cx, rid) if l["entrada"]} == set(ROBOTS.values()) | set(API.values())
    # ingest_runs.invocation: os runs da rodada
    runs = cx.execute("select dataset, invocation from ingest_runs where dataset like 'sapl-ale.%%'").fetchall()
    assert {r["dataset"] for r in runs} == {"sapl-ale.descoberta", "sapl-ale.ro", "sapl-ale.ac", "sapl-ale.am"}
    assert {r["invocation"] for r in runs} == {f"admin:{rid}"}
    # evidências: uma por URL lida, com o hash da tentativa
    lidas = {l["url"]: l["conteudo_sha256"] for l in tentativas(cx, rid) if l["resultado"] == "lida"}
    ev = {e["url"]: e["conteudo_sha256"] for e in cx.execute("select url, conteudo_sha256 from adm_evidencias").fetchall()}
    assert lidas and all(ev.get(u) == h and h for u, h in lidas.items())
    assert API["PB"] not in ev and API["PI"] not in ev  # falha nunca vira evidência
    # vínculos das cinco casas
    chaves = {r["registro_chave"] for r in cx.execute("select registro_chave from adm_vinculos where classe = 'vinculo_sapl' and vigente").fetchall()}
    assert chaves == {str(r["id"]) for r in cx.execute("select id from sapl_houses").fetchall()} and len(chaves) == 5
    assert res["vinculos"]["criados"]["vinculo_sapl"] >= 5
    # o resultado fica na própria rodada, e o ambiente foi restaurado
    d = R.descrever_rodada(cx, rid)
    assert d["resultado"]["status"] == "concluida" and len(d["execucoes"]) == 1 and d["tentativas"]["falhas_por_motivo"] == {"erro": 1, "robots": 1}
    assert d["cadeia"] == {"origem": [], "repeticoes": []}
    assert all(k not in os.environ for k in ("ETL_ATTEMPT_LOG", "ETL_INVOCATION", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH")) and H.CACHE_DIR == cache
    # o arquivo de registro fica guardado (evidência bruta)
    assert (cache.parent / "admin-rodadas" / f"{rid}-1.jsonl").exists()
    assert contagens(cx)["sapl_parlamentares"] > 0 and {uf: n(cx, "select count(*) as n from sapl_parlamentares x join sapl_houses h on h.id = x.house_id join places p on p.id = h.place_id where p.uf = %s", uf) for uf in ("RO", "AC", "AM")} == {uf: CARGA_V1[uf]["sapl_parlamentares"] for uf in ("RO", "AC", "AM")}


# ------------------------------------------------------------------ 8: critério 4


def test_8_repetir_nao_cria_linha_e_marca_reaproveitada(cx, monkeypatch, cache):
    rid, res, t = rodada(cx, monkeypatch, cache)
    assert res["status"] == "concluida"
    antes, dom_antes = contagens(cx), dominio(cx)
    evid_antes = {e["url_sha"]: (e["conteudo_sha256"], e["lida_em"], e["rodada_id"]) for e in cx.execute("select * from adm_evidencias").fetchall()}
    pedidos = len(t.pedidos)
    rep = R.repetir(cx, rid)
    rid2 = rep["rodada_id"]
    assert rid2 != rid and rep["repete_id"] == rid and rep["status"] == "concluida"
    row = cx.execute("select repete_id, status from adm_rodadas where id = %s", (rid2,)).fetchone()
    assert str(row["repete_id"]) == rid and row["status"] == "concluida"
    assert n(cx, "select count(*) as n from adm_rodadas") == 2 and cx.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()["status"] == "concluida"  # o histórico fica
    # zero linha nova: vínculos, tabelas sapl_*, casas (mesmos ids), cobertura; e as linhas não mudaram
    assert contagens(cx) == antes
    assert dominio(cx) == dom_antes
    sem_duplicata_por_chave_natural(cx)
    # as tentativas: o que estava no cache vem `reaproveitada`; o que o coletor relê de verdade vem como o que é
    por_url = _por_url(tentativas(cx, rid2))
    for uf in AF.UFS:
        assert por_url[ROBOTS[uf]] == [("reaproveitada", None)], uf  # robots.txt vale 1 dia no cache
    for uf in ("RO", "AC", "AM"):
        assert por_url[API[uf]] == [("reaproveitada", None)], uf
    assert por_url[API["PB"]] == [("falha", "erro")]  # a /api/ da PB nunca entra no cache: o coletor a relê (5 pedidos, uma tentativa no registro)
    assert por_url[API["PI"]] == [("falha", "robots")]
    assert len(por_url) == 10 and not any(r == "lida" for v in por_url.values() for r, _ in v)
    assert [u for u in t.pedidos[pedidos:]] == [API["PB"]] * 5  # e é só isso que chega ao transporte
    # critério 3 na repetição: as 10 URLs de entrada firmes da prévia recalculada foram todas tentadas; as 3 condicionais (casas na fila) não
    u = rep["urls_entrada"]
    assert u["previstas"] == 10 and u["n_tentadas"] == 10 and u["firmes_nao_tentadas"] == [] and u["condicionais_tentadas"] == []
    pv = cx.execute("select previa from adm_rodadas where id = %s", (rid2,)).fetchone()["previa"]
    assert pv["n_urls_entrada"] == 10 and pv["n_urls_condicionais"] == 3
    # a evidência não regride: mesmo hash, mesma data de leitura, mesma rodada de origem
    evid_depois = {e["url_sha"]: (e["conteudo_sha256"], e["lida_em"], e["rodada_id"]) for e in cx.execute("select * from adm_evidencias").fetchall()}
    assert evid_depois == evid_antes
    assert {l["resultado"] for l in tentativas(cx, rid2)} == {"reaproveitada", "falha"}


# ------------------------------------------------------------------ 9: critério 5


def _transporte_que_interrompe(cenario: str, depois_de: int) -> httpx.MockTransport:
    """Responde `depois_de` pedidos e levanta KeyboardInterrupt em todos os seguintes (a carga de uma casa fica pela metade)."""
    interno = AF.transporte(cenario)
    cont = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        cont["n"] += 1
        if cont["n"] > depois_de:
            raise KeyboardInterrupt
        return interno.handle_request(req)

    t = httpx.MockTransport(handler)
    t.cont = cont  # type: ignore[attr-defined]
    t.interno = interno  # type: ignore[attr-defined]
    return t


def test_9_rodada_interrompida_e_repetida(cx, monkeypatch, cache):
    # (a) OUTRO recorte, carregado antes: o município fabricado (sapl.descobrir e sapl.carregar pela rodada de sapl.camaras); a fotografia dele
    t = AF.instalar(monkeypatch, "v1", cache)
    rd = R.abrir(cx, "sapl.camaras", Recorte(ibges=(AF.IBGE_MUNICIPIO,), modo="descobrir")); cx.commit()
    assert R.executar(cx, rd)["status"] == "concluida"
    rc = R.abrir(cx, "sapl.camaras", Recorte(ibges=(AF.IBGE_MUNICIPIO,))); cx.commit()
    assert R.executar(cx, rc)["status"] == "concluida" and t.nao_previstos == []
    casa_mun = n(cx, "select h.id as n from sapl_houses h join places p on p.id = h.place_id where p.ibge_code = %s", AF.IBGE_MUNICIPIO)
    foto_mun = {tb: sorted(json.dumps(r, default=str, sort_keys=True) for r in cx.execute(f"select * from {tb} where house_id = %s", (casa_mun,)).fetchall()) for tb in TABELAS_SAPL}
    foto_casa = json.dumps(cx.execute("select * from sapl_houses where id = %s", (casa_mun,)).fetchone(), default=str, sort_keys=True)
    assert sum(len(v) for v in foto_mun.values()) > 0
    # (b) rodada das cinco UFs interrompida no meio da carga de RO (13 pedidos de sondagem + 6 da carga)
    ti = _transporte_que_interrompe("v1", 19)
    AF.instalar(monkeypatch, "v1", cache, transport=ti)
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS)); cx.commit()
    res1 = R.executar(cx, rid)
    assert ti.cont["n"] > 19 and "KeyboardInterrupt" in res1["interrupcao"]  # type: ignore[attr-defined]
    assert res1["status"] == "interrompida" and res1["codigo_saida"] is None
    row = cx.execute("select status, finalizada_em from adm_rodadas where id = %s", (rid,)).fetchone()
    assert row["status"] == "interrompida" and row["finalizada_em"] is not None
    feitas = tentativas(cx, rid)
    assert len(feitas) == res1["tentativas"]["tentadas"] >= 13 and res1["robots_registrados"] == [API["PI"]] and any(l["resultado"] == "lida" for l in feitas)  # o que já tinha sido lido foi importado
    foto_meio = dominio(cx)
    assert n(cx, "select count(*) as n from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and h.loaded_at is not null") == 0  # nenhuma casa terminou
    sem_duplicata_por_chave_natural(cx)
    # (c) repete a MESMA rodada: volta a em_andamento e termina concluida
    AF.instalar(monkeypatch, "v1", cache)
    rep = R.repetir(cx, rid)
    assert rep["rodada_id"] == rid and rep["repete_id"] is None and rep["status"] == "concluida" and rep["codigo_saida"] == 0
    assert n(cx, "select count(*) as n from adm_rodadas where coletor = 'sapl.assembleias'") == 1  # nenhuma linha de rodada nova
    d = R.descrever_rodada(cx, rid)
    assert [e["status"] for e in d["execucoes"]] == ["interrompida", "concluida"] and d["resultado"]["execucao"] == 2
    assert (cache.parent / "admin-rodadas" / f"{rid}-1.jsonl").exists() and (cache.parent / "admin-rodadas" / f"{rid}-2.jsonl").exists()
    # nenhuma duplicata (chave natural e chave de idempotência) e a carga completa de cada casa
    sem_duplicata_por_chave_natural(cx)
    for uf in ("RO", "AC", "AM"):
        for tb in TABELAS_SAPL:
            assert n(cx, f"select count(*) as n from {tb} x join sapl_houses h on h.id = x.house_id join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = %s", uf) == CARGA_V1[uf][tb], (uf, tb)
    # o outro recorte ficou idêntico
    assert {tb: sorted(json.dumps(r, default=str, sort_keys=True) for r in cx.execute(f"select * from {tb} where house_id = %s", (casa_mun,)).fetchall()) for tb in TABELAS_SAPL} == foto_mun
    assert json.dumps(cx.execute("select * from sapl_houses where id = %s", (casa_mun,)).fetchone(), default=str, sort_keys=True) == foto_casa
    assert foto_meio != dominio(cx)  # a repetição de fato carregou o que faltava
    assert n(cx, "select count(distinct rodada_id) as n from adm_tentativas where rodada_id = %s", rid) == 1


# ------------------------------------------------------------------ 10: pendências


def test_10_repetir_so_pendencias(cx, monkeypatch, cache):
    rid, res, t = rodada(cx, monkeypatch, cache)
    assert res["status"] == "concluida"
    rep = R.repetir(cx, rid, so_pendencias=True)
    rid2 = rep["rodada_id"]
    row = cx.execute("select argv, recorte, so_pendencias, repete_id from adm_rodadas where id = %s", (rid2,)).fetchone()
    assert row["argv"] == ["sapl.ales", "--uf", "PI", "--uf", "PB"] and row["recorte"]["ufs"] == ["PI", "PB"] and row["so_pendencias"] is True and str(row["repete_id"]) == rid
    assert rep["status"] == "concluida" and sorted(_por_url(tentativas(cx, rid2))) == sorted([ROBOTS["PI"], ROBOTS["PB"], API["PI"], API["PB"]])
    # quando nada falhou: não abre rodada
    r_ok, res_ok, _ = rodada(cx, monkeypatch, cache, ufs=("RO", "AC"))
    assert res_ok["status"] == "concluida"
    total = n(cx, "select count(*) as n from adm_rodadas")
    vazio = R.repetir(cx, r_ok, so_pendencias=True)
    assert vazio["rodada_id"] is None and "nenhuma pendência" in vazio["mensagem"] and n(cx, "select count(*) as n from adm_rodadas") == total
    # pendência aberta em adm_pendencias de um lugar da rodada entra no recorte (a tabela está vazia fora deste teste)
    casa_ac = n(cx, "select h.id as n from sapl_houses h join places p on p.id = h.place_id where p.uf = 'AC'")
    cx.execute("insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo) values ('vinculo_sapl', %s, 'status', 'FABRICADO: confirmar?', 'confirmacao')", (str(casa_ac),))
    cx.commit()
    com_pend = R.repetir(cx, r_ok, so_pendencias=True, executar_agora=False)
    assert cx.execute("select argv from adm_rodadas where id = %s", (com_pend["rodada_id"],)).fetchone()["argv"] == ["sapl.ales", "--uf", "AC"]
    # coletor sem recorte que expresse pendência: recusa com o motivo
    with pytest.raises(ErroAdmin, match="não aceita recorte que expresse pendências"):
        rid_eq = R.abrir(cx, "camara.equipe", Recorte())
        cx.execute("update adm_rodadas set status = 'em_andamento' where id = %s", (rid_eq,))
        cx.execute("update adm_rodadas set status = 'concluida' where id = %s", (rid_eq,))
        R.repetir(cx, rid_eq, so_pendencias=True)
    cx.rollback()


# ------------------------------------------------------------------ 11: forçar releitura


def test_11_forcar_releitura(cx, monkeypatch, cache):
    rid, res, t = rodada(cx, monkeypatch, cache)  # v1: PB fora_do_ar, AM ok
    assert {r["uf"]: r["status"] for r in cx.execute("select p.uf, h.status from sapl_houses h join places p on p.id = h.place_id").fetchall()} == AF.STATUS_ALE["v1"]
    tent_a = len(tentativas(cx, rid))
    ev_am = cx.execute("select conteudo_sha256, lida_em, rodada_id from adm_evidencias where url = %s", (API["AM"],)).fetchone()
    assert ev_am is not None
    t2 = AF.instalar(monkeypatch, "v2", cache)  # o mesmo cache, no mesmo dia: sem forçar, ninguém enxerga a mudança
    forcadas = [ROBOTS["PB"], API["PB"], ROBOTS["AM"], API["AM"]]
    # URL que não pertence à rodada é recusada, sem abrir rodada
    total = n(cx, "select count(*) as n from adm_rodadas")
    with pytest.raises(ErroAdmin, match="não pertence"):
        R.repetir(cx, rid, forcar_urls=[*forcadas, "https://sapl.al.xx.leg.br/api/"])
    with pytest.raises(ErroAdmin, match="não pertence"):
        R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS), forcar_urls=["https://exemplo.invalid/x"])
    cx.rollback()
    assert n(cx, "select count(*) as n from adm_rodadas") == total
    rep = R.repetir(cx, rid, forcar_urls=forcadas)
    rid2 = rep["rodada_id"]
    assert rep["status"] == "concluida" and cx.execute("select forcar_urls from adm_rodadas where id = %s", (rid2,)).fetchone()["forcar_urls"] == forcadas
    st = {r["uf"]: r["status"] for r in cx.execute("select p.uf, h.status from sapl_houses h join places p on p.id = h.place_id").fetchall()}
    assert st["PB"] == "ok" and st["AM"] == "robots_bloqueia" and st["RO"] == "ok" and st["PI"] == "robots_bloqueia"
    # o histórico da rodada anterior continua, e a falha de robots da AM não apaga a evidência antiga
    assert len(tentativas(cx, rid)) == tent_a
    assert _por_url(tentativas(cx, rid2))[API["AM"]] == [("falha", "robots")]
    assert cx.execute("select conteudo_sha256, lida_em, rodada_id from adm_evidencias where url = %s", (API["AM"],)).fetchone() == ev_am
    # forçar leu de novo (revalidada ou baixada) as URLs forçadas; as não forçadas ficaram no cache
    por_url = _por_url(tentativas(cx, rid2))
    assert por_url[ROBOTS["PB"]][0][0] in ("lida", "reaproveitada") and por_url[API["PB"]] == [("lida", None)]
    assert por_url[ROBOTS["RO"]] == [("reaproveitada", None)] and por_url[API["RO"]] == [("reaproveitada", None)]
    # só o que foi forçado foi à rede: PB e AM (robots.txt e /api/ que o robots deixou pedir); RO, AC e PI vieram do cache
    assert t2.nao_previstos == [] and API["PB"] in t2.pedidos and ROBOTS["PB"] in t2.pedidos and ROBOTS["AM"] in t2.pedidos
    assert API["AM"] not in t2.pedidos and not any(u in t2.pedidos for u in (ROBOTS["RO"], API["RO"], ROBOTS["AC"], API["AC"], ROBOTS["PI"]))


# ------------------------------------------------------------------ 12: reprocessar sem rede


def test_12_reprocessar_sem_rede(cx, monkeypatch, cache):
    ufs = ("RO", "AC", "AM")  # a /api/ da PB nunca entra no cache e a do PI nunca é pedida: com elas a pré-condição sempre recusa (conservador)
    rid, res, t = rodada(cx, monkeypatch, cache, ufs=ufs)
    assert res["status"] == "concluida"
    pedidos, dom = len(t.pedidos), dominio(cx)
    rid2 = R.abrir(cx, "sapl.assembleias", Recorte(ufs=ufs), modo="reprocessar"); cx.commit()
    pv = cx.execute("select previa from adm_rodadas where id = %s", (rid2,)).fetchone()["previa"]
    assert pv["a_consultar"]["valor"] == 0 and pv["a_consultar"]["estimativa"] is False and pv["faltam_no_cache"] == []
    res2 = R.executar(cx, rid2)
    assert res2["status"] == "concluida" and res2["codigo_saida"] == 0 and len(t.pedidos) == pedidos  # o transporte não foi chamado nenhuma vez
    assert dominio(cx) == dom
    sem_duplicata_por_chave_natural(cx)
    tr = tentativas(cx, rid2)
    assert tr and {l["resultado"] for l in tr} == {"reaproveitada"} and len(tr) == 6  # robots.txt e /api/ de RO, AC e AM
    assert res2["urls_entrada"]["previstas"] == 6 and res2["urls_entrada"]["n_tentadas"] == 6
    assert "ETL_HTTP_OFFLINE" not in os.environ
    # uma URL de entrada removida do cache: a rodada não executa o coletor e termina falhou, com a lista do que falta
    body, meta = R.caminhos_cache(ROBOTS["RO"], cache)
    body.unlink()
    rid3 = R.abrir(cx, "sapl.assembleias", Recorte(ufs=ufs), modo="reprocessar"); cx.commit()
    assert cx.execute("select previa from adm_rodadas where id = %s", (rid3,)).fetchone()["previa"]["faltam_no_cache"] == [ROBOTS["RO"]]
    res3 = R.executar(cx, rid3)
    assert res3["status"] == "falhou" and res3["executou_coletor"] is False and res3["faltam_no_cache"] == [ROBOTS["RO"]] and len(t.pedidos) == pedidos
    assert n(cx, "select count(*) as n from adm_tentativas where rodada_id = %s", rid3) == 0
    assert cx.execute("select status, finalizada_em from adm_rodadas where id = %s", (rid3,)).fetchone()["status"] == "falhou"
    assert not (cache.parent / "admin-rodadas" / f"{rid3}-1.jsonl").exists()
    # SemRedeSemCache no meio da execução (URL some do cache depois da conferência): falhou, com a URL, vinda do registro
    body.write_bytes(b"x")  # restaura só o corpo; os metadados continuam lá
    rid4 = R.abrir(cx, "sapl.assembleias", Recorte(ufs=ufs), modo="reprocessar"); cx.commit()
    api_body, _ = R.caminhos_cache(API["AC"], cache)

    def some_do_cache(argv: list[str]) -> int:  # o cache muda entre a conferência e a leitura
        api_body.unlink()
        return contrato._runner_em_processo(argv)

    res4 = R.executar(cx, rid4, runner=some_do_cache)
    assert res4["status"] == "falhou" and res4["sem_cache"] == [API["AC"]] and res4["codigo_saida"] == 1 and res4["executou_coletor"] is True
    assert res4["motivo"] == R.REGRA_DESFECHO["sem_rede_sem_cache"] and len(t.pedidos) == pedidos


# ------------------------------------------------------------------ 13: transições


def test_13_transicoes_proibidas(cx, monkeypatch, cache):
    rid, res, _ = rodada(cx, monkeypatch, cache, ufs=("RO",))
    assert res["status"] == "concluida"
    antes = cx.execute("select * from adm_rodadas where id = %s", (rid,)).fetchone()
    with pytest.raises(ErroAdmin, match="só `aberta` ou `interrompida`"):
        R.executar(cx, rid)
    assert cx.execute("select * from adm_rodadas where id = %s", (rid,)).fetchone() == antes
    with pytest.raises(ErroAdmin, match="inexistente"):
        R.executar(cx, "00000000-0000-0000-0000-000000000000")
    with pytest.raises(ErroAdmin, match="inválido"):
        R.executar(cx, "não-é-uuid")
    cx.rollback()
    for novo in ("em_andamento", "aberta", "interrompida"):  # concluida é final: o gatilho do banco recusa
        with pytest.raises(psycopg.errors.RaiseException, match="não permitida"):
            cx.execute("update adm_rodadas set status = %s where id = %s", (novo, rid))
        cx.rollback()
    # repetir rodada que nunca rodou: recusa
    aberta = R.abrir(cx, "camara.equipe", Recorte()); cx.commit()
    with pytest.raises(ErroAdmin, match="ainda não terminou"):
        R.repetir(cx, aberta)
    cx.rollback()


# ------------------------------------------------------------------ 15: tabela de desfechos (runner injetado, sem job nem rede)


@pytest.mark.parametrize("comportamento,coletor,status,regra", [
    ("codigo0", "camara.equipe", "concluida", "codigo_0"),
    ("codigo1_com_leitura", "camara.equipe", "concluida", "codigo_com_leitura"),
    ("codigo1_sem_leitura", "camara.equipe", "falhou", "codigo_sem_leitura"),
    ("codigo124", "camara.equipe", "interrompida", "timeout"),
    ("ctrl_c", "camara.equipe", "interrompida", "excecao"),
    ("erro", "camara.equipe", "interrompida", "excecao"),
    ("codigo1", "tse.votos", "falhou", "codigo_sem_registro"),
    ("codigo0", "tse.votos", "concluida", "codigo_0"),
])
def test_15_desfecho_do_coletor_e_status_da_rodada(cx, tmp_path, comportamento, coletor, status, regra):
    visto: dict[str, Any] = {}

    def runner(argv: list[str]) -> int:
        visto.update({k: os.environ.get(k) for k in ("ETL_ATTEMPT_LOG", "ETL_INVOCATION", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH")}, argv=argv)
        if "leitura" in comportamento and coletor == "camara.equipe":
            linhas = [{"url": "https://exemplo.invalid/a", "ts": "2026-11-15T10:00:00.000000+00:00", "desfecho": "baixada", "http_status": 200, "sha256": "ab" * 32, "bytes": 3}] if "com" in comportamento else \
                     [{"url": "https://exemplo.invalid/a", "ts": "2026-11-15T10:00:00.000000+00:00", "desfecho": "falha", "motivo": "erro", "http_status": 500}]
            Path(os.environ["ETL_ATTEMPT_LOG"]).write_text("".join(json.dumps(l) + "\n" for l in linhas))
        if comportamento == "ctrl_c":
            raise KeyboardInterrupt
        if comportamento == "erro":
            raise RuntimeError("falha inesperada do runner")
        return {"codigo0": 0, "codigo124": 124}.get(comportamento, 1)

    rid = R.abrir(cx, coletor, Recorte(), cache_dir=tmp_path / "cache"); cx.commit()
    res = R.executar(cx, rid, runner=runner)
    assert res["status"] == status and res["motivo"] == R.REGRA_DESFECHO[regra]
    assert cx.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()["status"] == status
    assert visto["ETL_INVOCATION"] == f"admin:{rid}" and visto["ETL_ATTEMPT_LOG"].endswith(f"{rid}-1.jsonl") and visto["ETL_HTTP_OFFLINE"] == "" and visto["ETL_HTTP_REFETCH"] == ""
    assert all(k not in os.environ for k in ("ETL_ATTEMPT_LOG", "ETL_INVOCATION"))  # restaurado, inclusive em erro
    if comportamento in ("ctrl_c", "erro"):
        assert res["interrupcao"].startswith(("KeyboardInterrupt", "RuntimeError")) and res["codigo_saida"] is None
    if status == "interrompida":  # retomável: a mesma linha volta a em_andamento
        assert R.executar(cx, rid, runner=lambda argv: 0)["status"] == "concluida"
    else:
        with pytest.raises(ErroAdmin):
            R.executar(cx, rid, runner=lambda argv: 0)


def shutil_rm(p: Path) -> None:
    import shutil

    shutil.rmtree(p, ignore_errors=True)


# ------------------------------------------------------------------ 14: a CLI real


def _cli(capsys, *argv: str) -> tuple[int, str, str]:
    rc = cli.main(["admin", *argv])
    out = capsys.readouterr()
    return rc, out.out, out.err


def test_14_subcomandos_pela_cli_real(cx, sapl_base, monkeypatch, cache, capsys):
    AF.instalar(monkeypatch, "v1", cache)
    # previa
    rc, out, err = _cli(capsys, "previa", "--coletor", "sapl.assembleias", "--uf", "RO", "--uf", "AC", "--json")
    p = json.loads(out)
    assert rc == 0 and p["n_urls_entrada"] == 4 and p["a_consultar"]["estimativa"] is True and p["demais_urls"]["valor"] is None
    rc, out, err = _cli(capsys, "previa", "--coletor", "sapl.assembleias", "--uf", "RO")
    assert rc == 0 and "estimativa" in out and "desconhecido: nenhuma rodada anterior" in out
    # abrir sem executar: imprime só o id
    rc, out, err = _cli(capsys, "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "RO", "--uf", "AC")
    rid = out.strip()
    assert rc == 0 and len(rid) == 36 and cx.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()["status"] == "aberta"
    rc, out, err = _cli(capsys, "rodada", "executar", rid, "--json")
    assert rc == 0 and json.loads(out)["status"] == "concluida"
    # abrir --executar com falha parcial: concluída, código 0 (as falhas aparecem no resultado)
    rc, out, err = _cli(capsys, "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "PI", "--uf", "PB", "--executar", "--json")
    doc = json.loads(out)
    assert rc == 0 and doc["status"] == "concluida" and doc["tentativas"]["falhas"] == {"erro": 1, "robots": 1} and doc["urls_entrada"]["previstas"] == 4
    # repetir, ver, listar
    rc, out, err = _cli(capsys, "rodada", "repetir", rid)
    assert rc == 0 and "concluida" in out
    rid2 = cx.execute("select id from adm_rodadas where repete_id = %s", (rid,)).fetchone()["id"]
    rc, out, err = _cli(capsys, "rodada", "ver", str(rid2), "--json")
    ver = json.loads(out)
    assert rc == 0 and ver["repete_id"] == rid and ver["cadeia"]["origem"] == [rid] and ver["tentativas"]["por_resultado"]["reaproveitada"] == 4
    rc, out, err = _cli(capsys, "rodada", "ver", rid)
    assert rc == 0 and "repetições" in out and str(rid2) in out
    rc, out, err = _cli(capsys, "rodada", "listar", "--coletor", "sapl.assembleias", "--json")
    assert rc == 0 and len(json.loads(out)) == 3
    rc, out, err = _cli(capsys, "rodada", "repetir", rid, "--pendencias", "--json")
    assert rc == 0 and json.loads(out)["rodada_id"] is None  # RO e AC: nada falhou
    # rodada que termina falhou: código 1 e o documento é impresso
    rc, out, err = _cli(capsys, "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "RO", "--modo", "reprocessar", "--executar", "--json")
    assert rc == 0  # RO está no cache (rodada anterior): o reprocessar roda sem rede
    shutil_rm(cache)
    rc, out, err = _cli(capsys, "rodada", "abrir", "--coletor", "sapl.assembleias", "--uf", "RO", "--modo", "reprocessar", "--executar", "--json")
    assert rc == 1 and json.loads(out)["status"] == "falhou" and len(json.loads(out)["faltam_no_cache"]) == 2
    # erros de uso e de execução
    assert _cli(capsys, "rodada", "executar")[0] == 2
    assert _cli(capsys, "rodada", "abrir")[0] == 2
    assert _cli(capsys, "rodada", "ver", rid, "--pendencias")[0] == 2
    assert _cli(capsys, "previa", "--coletor", "sapl.assembleias", "--extra", "semigual")[0] == 2
    rc, out, err = _cli(capsys, "rodada", "executar", rid)
    assert rc == 1 and "só `aberta` ou `interrompida`" in err
    rc, out, err = _cli(capsys, "rodada", "abrir", "--coletor", "sapl.assembleias", "--ano", "2025")
    assert rc == 1 and "recusada" in err


# ------------------------------------------------------------------ 16: runner de subprocesso (sem rodar nenhum processo)


def test_16_runner_de_subprocesso_recebe_o_ambiente_da_rodada(cx, monkeypatch, tmp_path):
    monkeypatch.delenv("ADMIN_RUNNER", raising=False)
    monkeypatch.setenv("ADMIN_RODADA_TIMEOUT_S", "7")
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")  # herdado do ambiente: uma rodada que NÃO é reprocessar não pode rodar sem rede por acidente
    visto: dict[str, Any] = {}

    def falso(argv, *, env=None, timeout_s=None):
        visto.update(argv=argv, env=dict(env), timeout_s=timeout_s)
        return 124

    monkeypatch.setattr(contrato, "runner_subprocesso", falso)
    rid = R.abrir(cx, "camara.equipe", Recorte(), cache_dir=tmp_path / "cache"); cx.commit()
    res = R.executar(cx, rid)
    assert res["runner"] == "subprocesso" and res["status"] == "interrompida" and res["codigo_saida"] == 124 and res["motivo"] == R.REGRA_DESFECHO["timeout"]
    e = visto["env"]
    assert visto["argv"] == ["camara.equipe"] and visto["timeout_s"] == 7.0
    assert e["ETL_INVOCATION"] == f"admin:{rid}" and e["ETL_ATTEMPT_LOG"] == str(tmp_path / "admin-rodadas" / f"{rid}-1.jsonl") and e["ETL_CACHE_DIR"] == str(tmp_path / "cache")
    assert e["ETL_HTTP_OFFLINE"] == "" and e["ETL_HTTP_REFETCH"] == ""  # vazio vence o valor herdado (http só liga com valor)
    assert os.environ["ETL_HTTP_OFFLINE"] == "1" and "ETL_INVOCATION" not in os.environ  # o ambiente do processo não foi tocado
    # reprocessar liga o modo sem rede; forçar URL grava o arquivo de refetch
    url = R.previa(cx, "camara.equipe", Recorte())["urls_entrada"][0]["url"]
    body, meta = R.caminhos_cache(url, tmp_path / "cache")
    body.parent.mkdir(parents=True)
    body.write_bytes(b"x")
    meta.write_text(json.dumps({"sha256": "ab" * 32, "fetched_at": 1.0}))
    monkeypatch.setattr(contrato, "runner_subprocesso", lambda argv, *, env=None, timeout_s=None: visto.update(env=dict(env)) or 0)
    rid2 = R.abrir(cx, "camara.equipe", Recorte(modo="reprocessar"), cache_dir=tmp_path / "cache", forcar_urls=[url]); cx.commit()
    res2 = R.executar(cx, rid2)
    assert res2["status"] == "concluida" and visto["env"]["ETL_HTTP_OFFLINE"] == "1"
    assert Path(visto["env"]["ETL_HTTP_REFETCH"]).read_text() == url + "\n"
