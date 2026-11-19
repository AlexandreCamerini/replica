"""FABRICADO. B3a: a rodada de coleta do SAPL gera sozinha as propostas de mudança (`admin.proponentes`), com evidência.

Rodadas REAIS em processo (`ADMIN_RUNNER=processo`) de `sapl.assembleias` e `sapl.camaras` sobre o transporte fabricado (`admin_fixtures.instalar`), no banco isolado (que aplica a
0151). Nada vai à rede (o runner de subprocesso levanta AssertionError) e nada é gravado no banco da suíte (contagens antes/depois). O que as rodadas e as decisões gravam no banco
isolado é desfeito em `finally` (`limpar_tudo`: as decisões só se apagam com `session_replication_role = replica`, a mesma técnica de test_admin_migracao.py).

Para que a segunda rodada RECARREGUE uma casa já carregada (e a cobertura dela possa mudar), os testes envelhecem `sapl_houses.loaded_at` em 10 dias antes dela: a fila de carga só relê
casa 'ok' com mais de 6 dias (`STALE_DAYS`); sem isso a rodada v2 só carregaria a PB (primeira carga).
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
from conftest import database_url
from psycopg.rows import dict_row

from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import proponentes as PRO
from civico_etl.admin import propostas as PR
from civico_etl.admin import relatorio as REL
from civico_etl.admin import rodadas as R
from civico_etl.catalogo import contrato
from civico_etl.catalogo.contrato import Recorte
from civico_etl.util import sha256_text

SUITE = ("adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "adm_propostas", "adm_pendencias", "adm_decisoes", "sapl_houses", "data_coverage", "ingest_runs", "dataset_stamps")
HOST = AF.ALE_HOSTS
API = {uf: f"{HOST[uf]}/api/" for uf in AF.UFS}
ROBOTS = {uf: f"{HOST[uf]}/robots.txt" for uf in AF.UFS}
POR = dict(por_tipo="pessoa", por_nome="Fulana de Teste", justificativa="conferi na página da casa")
IBGE_RO = "11"


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
    """Nada deste módulo grava no banco da suíte: as contagens de antes e depois são iguais."""
    def conta():
        return {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}

    antes = conta()
    yield
    assert conta() == antes, "o banco da suíte mudou"


@pytest.fixture(autouse=True)
def _ambiente(monkeypatch, banco_isolado):  # noqa: F811
    assert "_iso_" in banco_isolado and banco_isolado != database_url()
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.setenv(k, banco_isolado)
    monkeypatch.setenv("ADMIN_RUNNER", "processo")
    for k in ("ETL_INVOCATION", "ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH", "ADMIN_RODADA_TIMEOUT_S", "ADMIN_COLETA_AGENTES"):
        monkeypatch.delenv(k, raising=False)

    def sem_subprocesso(*a, **k):
        raise AssertionError("runner_subprocesso chamado: o coletor iria à rede de verdade")

    monkeypatch.setattr(contrato, "runner_subprocesso", sem_subprocesso)


def limpar_tudo(url: str) -> None:
    """Desfaz o que as rodadas e as decisões gravaram nas tabelas `adm_*` e em `corrections` (banco isolado; `adm_decisoes` não se apaga com a trava ligada)."""
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_overrides", "adm_vinculos", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "corrections", "adm_evidencias", "adm_tentativas", "adm_rodadas"):
            c.execute(f"delete from {t}")  # noqa: S608


@pytest.fixture
def sapl_base(banco_isolado):  # noqa: F811
    url = banco_isolado
    limpar_tudo(url)
    AF.limpar_base(url)
    AF.carregar_base(url)
    try:
        yield url
    finally:
        limpar_tudo(url)
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


# ------------------------------------------------------------------ apoio


def n(cx, sql: str, *p: Any) -> int:
    return cx.execute(sql, p).fetchone()["n"]


def rodada(cx, mp, cache: Path, cenario: str, *, coletor: str = "sapl.assembleias", recorte: Recorte | None = None, forcar: list[str] | None = None) -> tuple[str, dict, Any]:
    """Instala o cenário, abre (cache dado) e executa. Devolve (id, resultado, transporte)."""
    t = AF.instalar(mp, cenario, cache)
    rid = R.abrir(cx, coletor, recorte or Recorte(ufs=AF.UFS), forcar_urls=forcar or (), cache_dir=cache)
    cx.commit()
    res = R.executar(cx, rid)
    assert t.nao_previstos == []
    return rid, res, t


def envelhecer(cx) -> None:
    """Casa 'ok' já carregada entra de novo na fila de carga (mais de 6 dias)."""
    cx.execute("update sapl_houses set loaded_at = loaded_at - interval '10 days' where loaded_at is not null")
    cx.commit()


def casa(cx, uf: str) -> dict:
    return cx.execute("select h.* from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = %s", (uf,)).fetchone()


def props(cx, rid: str | None = None, **w: str) -> list[dict]:
    q = "select * from adm_propostas where true" + (" and rodada_id = %s" if rid else "")
    p: list[Any] = [rid] if rid else []
    for k, v in w.items():
        q += f" and {k} = %s"
        p.append(v)
    return cx.execute(q + " order by classe, registro_chave, campo, criada_em", p).fetchall()


def pend(cx, classe: str, chave: str, campo: str) -> dict | None:
    return cx.execute("select * from adm_pendencias where classe = %s and registro_chave = %s and campo = %s", (classe, chave, campo)).fetchone()


def estado_pendencias(cx) -> list[tuple]:
    return [tuple(r.values()) for r in cx.execute("select classe, registro_chave, campo, status, tipo, reaberta, motivo_reabertura, evidencia_sha, vigente_sha, pergunta from adm_pendencias order by 1, 2, 3").fetchall()]


def tentativa(cx, rid: str, url: str) -> dict:
    return cx.execute("select * from adm_tentativas where rodada_id = %s and url = %s order by tentada_em desc", (rid, url)).fetchone()


def decidir_e_aplicar(cx, pid: str, acao: str, **kw) -> dict:
    d = DEC.decidir(cx, pid, acao=acao, **{**POR, **kw})
    r = APL.aplicar(cx, d["id"])
    cx.commit()
    return r


# ------------------------------------------------------------------ 1. primeira rodada: tudo é primeiro preenchimento


def test_1_primeira_rodada_sobre_banco_vazio_nao_gera_proposta_e_conta_os_primeiros_preenchimentos(cx, monkeypatch, tmp_path):
    assert n(cx, "select count(*) as n from sapl_houses") == 0
    rid, res, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    assert res["status"] == "concluida"
    p = res["propostas"]
    assert p["executado"] is True and p["novas"] == 0 and p["recusadas"] == [] and p["sem_evidencia"] == [] and p["pendencias_abertas"] == [] and p["avisos"] == []
    # 5 casas x 2 campos; RO, AC e AM foram carregadas: 3 lugares x 3 datasets x 3 campos de cobertura
    assert p["primeiros_preenchimentos_por_classe"] == {"cobertura": 27, "vinculo_sapl": 10} and p["primeiros_preenchimentos"] == 37
    assert p["escopo"] == "UFs RO,AC,AM,PI,PB"
    assert n(cx, "select count(*) as n from adm_propostas") == 0 and n(cx, "select count(*) as n from adm_pendencias") == 0
    assert R.descrever_rodada(cx, rid)["resultado"]["propostas"] == p  # gravado na própria rodada
    assert REL.relatorio(cx, rid)["revisao"]["campos_com_proposta"]["valor"] == 0


# ------------------------------------------------------------------ 2. mudança de campo sem override


@pytest.fixture
def v1_v2(cx, monkeypatch, tmp_path):
    """Rodada v1 e, depois, rodada v2 com cache novo (e as casas carregadas envelhecidas). Devolve (rid1, rid2, resultado2, estado das casas depois de v1)."""
    rid1, res1, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    assert res1["propostas"]["novas"] == 0
    cx.rollback()
    antes = {uf: dict(casa(cx, uf)) for uf in AF.UFS}
    envelhecer(cx)
    rid2, res2, t = rodada(cx, monkeypatch, tmp_path / "c2", "v2")
    cx.rollback()
    return rid1, rid2, res2, antes


def test_2_status_que_mudou_gera_uma_proposta_com_vigente_de_antes_e_evidencia_da_rodada(cx, v1_v2):
    rid1, rid2, res2, antes = v1_v2
    assert res2["status"] == "concluida" and res2["propostas"]["executado"] is True
    assert antes["PB"]["status"] == "fora_do_ar" and antes["AM"]["status"] == "ok"
    pb, am = casa(cx, "PB"), casa(cx, "AM")
    assert (pb["status"], am["status"]) == ("ok", "robots_bloqueia")
    sv = props(cx, rid2, classe="vinculo_sapl")
    assert sorted((p["registro_chave"], p["campo"]) for p in sv) == sorted([(str(pb["id"]), "status"), (str(am["id"]), "status")])  # PB e AM, uma cada; base_url não mudou
    por = {p["registro_chave"]: p for p in sv}
    # PB: fora_do_ar -> ok, evidência = a /api/ lida
    p = por[str(pb["id"])]
    assert (p["valor_vigente"], p["valor_candidato"], p["url"], p["fonte_slug"], p["alcance"], p["fonte_declarada_em"]) == ("fora_do_ar", "ok", API["PB"], "sapl-ale", "registro", None)
    t = tentativa(cx, rid2, API["PB"])
    assert t["resultado"] == "lida" and p["conteudo_sha256"] == t["conteudo_sha256"] and p["lida_em"] == t["tentada_em"] and "índice da API REST do SAPL 3.x" in p["trecho"]
    ev = cx.execute("select conteudo_sha256 from adm_evidencias where url = %s", (API["PB"],)).fetchone()
    assert ev["conteudo_sha256"] == p["conteudo_sha256"]
    pe = pend(cx, "vinculo_sapl", str(pb["id"]), "status")
    assert (pe["status"], pe["tipo"], pe["reaberta"]) == ("aberta", "mudanca", False) and pe["evidencia_sha"] == p["conteudo_sha256"]
    assert pe["pergunta"] == "O status do SAPL desta casa mudou de 'fora_do_ar' para 'ok'?" and pe["pergunta"].count("?") == 1
    # AM: ok -> robots_bloqueia, evidência = o robots.txt lido
    a = por[str(am["id"])]
    assert (a["valor_vigente"], a["valor_candidato"], a["url"]) == ("ok", "robots_bloqueia", ROBOTS["AM"])
    t = tentativa(cx, rid2, ROBOTS["AM"])
    assert t["resultado"] == "lida" and a["conteudo_sha256"] == t["conteudo_sha256"] and a["trecho"].startswith("robots.txt de ") and "considerou" in a["trecho"]
    assert pend(cx, "vinculo_sapl", str(am["id"]), "status")["pergunta"] == "O status do SAPL desta casa mudou de 'ok' para 'robots_bloqueia'?"
    # as demais casas e campos que não mudaram não geram nada
    assert not [x for x in sv if x["registro_chave"] in {str(casa(cx, uf)["id"]) for uf in ("RO", "AC", "PI")}]
    assert not props(cx, rid2, classe="vinculo_sapl", campo="base_url")
    assert n(cx, "select count(*) as n from adm_propostas where rodada_id = %s", rid1) == 0


def test_2b_mudanca_so_de_reason_nao_vira_proposta_e_e_contada(cx, v1_v2):
    rid1, rid2, res2, _ = v1_v2
    assert props(cx, rid2, classe="cobertura") == []  # RO foi relida com a matéria 306: só o `reason` de 'propostas' mudou
    r = res2["propostas"]["reason_sem_proposta"]
    assert len(r) == 1 and r[0]["registro_chave"] == f"{IBGE_RO}:propostas" and r[0]["origem"] == "comparacao" and "(4)" in r[0]["de"] and "(5)" in r[0]["para"]
    assert pend(cx, "cobertura", f"{IBGE_RO}:propostas", "reason") is None
    # PB foi carregada pela primeira vez na v2: primeiro preenchimento, nenhuma proposta de cobertura para ela
    assert res2["propostas"]["primeiros_preenchimentos_por_classe"] == {"cobertura": 9}
    # o relatório da rodada mostra os campos pendentes (PB e AM) e nenhum "sem pendência aberta"
    rev = REL.relatorio(cx, rid2)["revisao"]
    assert rev["campos_com_proposta"]["valor"] == 2 and rev["pendentes"]["valor"] == 2 and rev["pendentes"]["sem_pendencia_aberta"]["valor"] == 0
    assert rev["conflitantes"]["valor"] == 0 and rev["confirmados"]["valor"] == 0
    txt = R.texto_resultado(res2)
    assert "propostas novas" in txt and "reason sem proposta" in txt and "pendências abertas" in txt and "primeiros preenchimentos" in txt


def test_2c_status_e_reason_que_mudam_juntos_viram_as_duas_propostas(cx, monkeypatch, tmp_path):
    rid, _, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    antes = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    depois = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    lin = next(v for (pid, ds), v in depois.cobertura.items() if ds == "propostas")
    assert lin["existia"] and lin["status"] == "carregando"
    lin["status"], lin["reason"] = "desconhecido", "o SAPL da Assembleia não tem mais nada"
    r = PRO.propor(cx, rid, "sapl.assembleias", antes, depois)
    assert r.reason_sem_proposta == [] and len(r.novas) == 2
    ps = props(cx, rid, classe="cobertura")
    assert sorted(p["campo"] for p in ps) == ["reason", "status"] and {p["valor_candidato"] for p in ps} == {"desconhecido", "o SAPL da Assembleia não tem mais nada"}
    assert all(p["url"].endswith("/api/parlamentares/legislatura/?page_size=100&page=1") for p in ps)


# ------------------------------------------------------------------ 3. critério 4: repetir pelo identificador


def test_3_repetir_a_rodada_nao_gera_proposta_nem_altera_pendencia(cx, monkeypatch, v1_v2):
    rid1, rid2, res2, _ = v1_v2
    antes = {t: n(cx, f"select count(*) as n from {t}") for t in ("adm_propostas", "adm_pendencias", "adm_pendencia_propostas", "adm_vinculos", "sapl_houses", "data_coverage", "adm_overrides")}
    est = estado_pendencias(cx)
    AF.instalar(monkeypatch, "v2", Path(R._carregar(cx, rid2)["cache_dir"]))  # o mesmo cenário e o mesmo cache
    rep = R.repetir(cx, rid2)
    cx.rollback()
    assert rep["repete_id"] == rid2 and rep["status"] == "concluida"
    p = rep["propostas"]
    assert p["executado"] is True and p["novas"] == 0 and p["pendencias_abertas"] == [] and p["pendencias_reabertas"] == [] and p["recusadas"] == [] and p["sem_evidencia"] == []
    assert p["primeiros_preenchimentos"] == 0 and p["inalterados"] > 0
    assert {t: n(cx, f"select count(*) as n from {t}") for t in antes} == antes  # zero linha nova em propostas e em vínculos (e nas demais)
    assert estado_pendencias(cx) == est
    assert {r["resultado"] for r in cx.execute("select resultado from adm_tentativas where rodada_id = %s", (rep["rodada_id"],)).fetchall()} >= {"reaproveitada"}
    # e uma proposta idêntica apresentada de novo é reconhecida pela chave de idempotência
    linha = props(cx, rid2, classe="vinculo_sapl", campo="status")[0]
    pr = PR.Proposta(classe=linha["classe"], registro_chave=linha["registro_chave"], campo=linha["campo"], valor_candidato=linha["valor_candidato"], url=linha["url"], trecho=linha["trecho"],
                     conteudo_sha256=linha["conteudo_sha256"], lida_em=linha["lida_em"], fonte_slug=linha["fonte_slug"], rodada_id=rid2)
    r = PR.registrar(cx, pr, vigente_antes=linha["valor_vigente"])
    assert r.nova is False and r.proposta_id == str(linha["id"])
    cx.rollback()
    assert n(cx, "select count(*) as n from adm_propostas") == antes["adm_propostas"]


# ------------------------------------------------------------------ 4. falha de leitura como evidência


def test_4_falha_de_leitura_vira_evidencia_sem_conteudo_lido_e_nao_toca_a_evidencia_valida(cx, monkeypatch, tmp_path):
    rid1, res1, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    ro = casa(cx, "RO")
    ev_antes = cx.execute("select * from adm_evidencias where url = %s", (API["RO"],)).fetchone()
    assert ro["status"] == "ok" and ev_antes is not None
    rid2, res2, _ = rodada(cx, monkeypatch, tmp_path / "c2", "falhas")
    cx.rollback()
    assert casa(cx, "RO")["status"] == "fora_do_ar" and casa(cx, "AC")["status"] == "fora_do_ar" and casa(cx, "AM")["status"] == "fora_do_ar"
    por = {p["registro_chave"]: p for p in props(cx, rid2, classe="vinculo_sapl", campo="status")}
    for uf, motivo, http in (("RO", "bloqueio", 403), ("AC", "expiracao", None), ("AM", "sem_conteudo", 200)):
        h = casa(cx, uf)
        p = por[str(h["id"])]
        t = tentativa(cx, rid2, API[uf])
        assert t["resultado"] == "falha" and t["motivo"] == motivo and t["http_status"] == http, (uf, dict(t))
        assert (p["valor_vigente"], p["valor_candidato"], p["url"]) == ("ok", "fora_do_ar", API[uf])
        assert p["trecho"].startswith("sem conteúdo lido: tentativa falha/" + motivo) and f"(HTTP {http if http is not None else 'sem resposta'})" in p["trecho"]
        assert "o hash é do registro da tentativa (URL, resultado, motivo e status), não de conteúdo da fonte" in p["trecho"]
        registro = {"url": API[uf], "resultado": "falha", "motivo": motivo, "http_status": http}  # sem horário
        assert p["conteudo_sha256"] == sha256_text(json.dumps(registro, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
        assert p["conteudo_sha256"] != (ev_antes["conteudo_sha256"] if uf == "RO" else None) and p["lida_em"] == t["tentada_em"]
        assert pend(cx, "vinculo_sapl", str(h["id"]), "status")["tipo"] == "mudanca"
    # a evidência válida anterior da URL continua intacta
    assert cx.execute("select * from adm_evidencias where url = %s", (API["RO"],)).fetchone() == ev_antes


# ------------------------------------------------------------------ 5. override e divergência


def test_5_override_decidido_sobrevive_e_a_divergencia_com_evidencia_nova_reabre_a_pendencia(cx, monkeypatch, v1_v2):
    rid1, rid2, res2, _ = v1_v2
    pb = casa(cx, "PB")
    chave = str(pb["id"])
    pe = pend(cx, "vinculo_sapl", chave, "status")
    sha_decisao = pe["evidencia_sha"]
    r = decidir_e_aplicar(cx, str(pe["id"]), "corrigir", valor="sem_api", justificativa="a página oficial diz que a casa não tem API")
    assert r["valor_anterior"] == "ok" and casa(cx, "PB")["status"] == "sem_api"
    assert pend(cx, "vinculo_sapl", chave, "status")["status"] == "decidida"
    ov = cx.execute("select * from adm_overrides where registro_chave = %s and campo = 'status' and vigente", (chave,)).fetchone()
    assert ov["valor"] == "sem_api" and ov["tentou_valor"] is None and ov["tentou_vezes"] == 0

    # o job volta a tentar 'fora_do_ar' para a PB (v1: /api/ responde 500), com releitura forçada: evidência NOVA (falha de leitura)
    urls = [i["url"] for i in R._carregar(cx, rid2)["previa"]["urls_entrada"]]
    AF.instalar(monkeypatch, "v1", Path(R._carregar(cx, rid2)["cache_dir"]))
    rep = R.repetir(cx, rid2, forcar_urls=urls)
    cx.rollback()
    rid3 = rep["rodada_id"]
    assert rep["status"] == "concluida"
    assert casa(cx, "PB")["status"] == "sem_api"  # o decidido continua na tabela
    ov = cx.execute("select * from adm_overrides where id = %s", (ov["id"],)).fetchone()
    assert (ov["tentou_valor"], ov["tentou_vezes"], ov["valor"]) == ("fora_do_ar", 1, "sem_api") and ov["tentou_em"] is not None
    sp = props(cx, rid3, registro_chave=chave, campo="status")
    assert len(sp) == 1
    p = sp[0]
    assert (p["valor_vigente"], p["valor_candidato"], p["url"]) == ("sem_api", "fora_do_ar", API["PB"]) and p["trecho"].startswith("sem conteúdo lido")
    assert p["conteudo_sha256"] != sha_decisao
    pe2 = pend(cx, "vinculo_sapl", chave, "status")
    assert (pe2["status"], pe2["reaberta"], pe2["motivo_reabertura"], pe2["tipo"]) == ("aberta", True, "evidencia_mudou", "mudanca")
    assert pe2["evidencia_sha"] == p["conteudo_sha256"] and str(pe2["id"]) in rep["propostas"]["pendencias_reabertas"]
    assert pe2["pergunta"] == "O status do SAPL desta casa mudou de 'sem_api' para 'fora_do_ar'?"

    # decide de novo (descartar) e repete a rodada sem mudança de evidência: nem reabre nem cria proposta
    DEC.decidir(cx, str(pe2["id"]), acao="descartar", **{**POR, "justificativa": "continua valendo a decisão anterior"})
    cx.commit()
    est, total = estado_pendencias(cx), n(cx, "select count(*) as n from adm_propostas")
    # releitura forçada de novo: o job tenta o MESMO 'fora_do_ar' e a falha persiste com o mesmo desfecho (500): mesmo hash (o horário não entra), proposta REPETIDA,
    # nada reabre
    rep2 = R.repetir(cx, rid3, forcar_urls=urls)
    cx.rollback()
    assert rep2["status"] == "concluida" and rep2["propostas"]["novas"] == 0 and rep2["propostas"]["repetidas"] == 1 and rep2["propostas"]["pendencias_reabertas"] == []
    assert n(cx, "select count(*) as n from adm_propostas") == total and estado_pendencias(cx) == est and casa(cx, "PB")["status"] == "sem_api"
    ov2 = cx.execute("select tentou_valor, tentou_vezes, tentou_em from adm_overrides where id = %s", (ov["id"],)).fetchone()
    assert (ov2["tentou_valor"], ov2["tentou_vezes"], ov2["tentou_em"]) == ("fora_do_ar", 1, ov["tentou_em"])  # o gatilho não regravou
    assert [x["registro_chave"] for x in rep2["propostas"]["anotadas_antes"]] == [chave]  # anotada antes desta execução

    # sem forçar, o cache (a /api/ 200 da v2, que a falha não substituiu) faz o job tentar 'ok': a anotação passa a 'ok', mas é a MESMA proposta de antes (mesma URL, mesmo
    # hash, mesmo candidato): a chave de idempotência a reconhece, e a pendência decidida não muda
    rep3 = R.repetir(cx, rep2["rodada_id"])
    cx.rollback()
    assert rep3["propostas"]["novas"] == 0 and rep3["propostas"]["repetidas"] == 1 and rep3["propostas"]["pendencias_reabertas"] == []
    assert estado_pendencias(cx) == est and n(cx, "select count(*) as n from adm_propostas") == total
    ov3 = cx.execute("select tentou_valor, tentou_vezes from adm_overrides where id = %s", (ov["id"],)).fetchone()
    assert (ov3["tentou_valor"], ov3["tentou_vezes"]) == ("ok", 2) and casa(cx, "PB")["status"] == "sem_api"

    # o caso que justifica a regra: a MESMA URL passa a falhar com OUTRO status HTTP (500 -> 403, motivo erro -> bloqueio): hash novo, proposta nova, pendência reabre
    interno = AF.transporte("v1")

    def handler(req):
        if str(req.url) == API["PB"]:
            return httpx.Response(403, content=b"proibido", headers={"content-type": "text/plain"})
        return interno.handle_request(req)

    AF.instalar(monkeypatch, "v1", Path(R._carregar(cx, rid2)["cache_dir"]), transport=httpx.MockTransport(handler))
    rep4 = R.repetir(cx, rep3["rodada_id"], forcar_urls=urls)
    cx.rollback()
    t4 = tentativa(cx, rep4["rodada_id"], API["PB"])
    assert (t4["resultado"], t4["motivo"], t4["http_status"]) == ("falha", "bloqueio", 403)
    assert rep4["propostas"]["novas"] == 1 and len(rep4["propostas"]["pendencias_reabertas"]) == 1
    p4 = props(cx, rep4["rodada_id"], registro_chave=chave, campo="status")[0]
    assert (p4["valor_vigente"], p4["valor_candidato"]) == ("sem_api", "fora_do_ar") and "tentativa falha/bloqueio (HTTP 403)" in p4["trecho"]
    pe4 = pend(cx, "vinculo_sapl", chave, "status")
    assert (pe4["status"], pe4["reaberta"], pe4["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou") and pe4["evidencia_sha"] == p4["conteudo_sha256"]


def test_5b_override_com_leitura_bem_sucedida_cita_a_evidencia_do_candidato_e_nao_a_do_valor_decidido(cx, monkeypatch, tmp_path):
    """O valor da tabela é o DECIDIDO; a evidência é a do que o job TENTOU gravar. AM: decidido 'sem_api' depois da v1; na v2 o robots.txt passa a bloquear e o job tenta
    'robots_bloqueia' SEM ler a /api/. Escolher a evidência pelo valor da tabela procuraria a /api/ (não tentada) e cairia em sem_evidencia."""
    rid1, _, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    am = casa(cx, "AM")
    chave = str(am["id"])
    assert am["status"] == "ok"
    r = PR.registrar(cx, PR.Proposta(classe="vinculo_sapl", registro_chave=chave, campo="status", valor_candidato="sem_api", url=API["AM"], trecho="$ sem a chave parlamentares",
                                     conteudo_sha256=sha256_text("a mão"), lida_em="2026-11-14T12:00:00Z", fonte_slug="sapl-ale"))
    cx.commit()
    decidir_e_aplicar(cx, r.pendencia_id, "aprovar")
    assert casa(cx, "AM")["status"] == "sem_api"
    rid2, res2, _ = rodada(cx, monkeypatch, tmp_path / "c2", "v2")
    cx.rollback()
    assert casa(cx, "AM")["status"] == "sem_api"  # o decidido continua
    ov = cx.execute("select tentou_valor, tentou_vezes from adm_overrides where registro_chave = %s and campo = 'status' and vigente", (chave,)).fetchone()
    assert (ov["tentou_valor"], ov["tentou_vezes"]) == ("robots_bloqueia", 1)
    assert [x for x in res2["propostas"]["sem_evidencia"] if x["registro_chave"] == chave] == []
    p = props(cx, rid2, registro_chave=chave, campo="status")[0]
    t = tentativa(cx, rid2, ROBOTS["AM"])
    assert (p["valor_vigente"], p["valor_candidato"], p["url"], p["conteudo_sha256"]) == ("sem_api", "robots_bloqueia", ROBOTS["AM"], t["conteudo_sha256"])
    assert p["trecho"].startswith("robots.txt de ") and "reconheceu" not in p["trecho"]
    # com override em `status` a tabela não reflete o bloqueio: a tentativa de robots vem do `tentou_valor`
    ta = tentativa(cx, rid2, API["AM"])
    assert ta is not None and (ta["resultado"], ta["motivo"], ta["entrada"]) == ("falha", "robots", True) and API["AM"] in res2["robots_registrados"]
    pe = pend(cx, "vinculo_sapl", chave, "status")
    assert (pe["status"], pe["reaberta"], pe["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou")


def test_5c_pendencia_descartada_nao_reabre_por_causa_do_valor_de_antes(cx, v1_v2):
    """`registrar(vigente_antes=...)` não pode vazar para o `vigente_sha`: o `reavaliar` compara com a tabela e não pode reabrir uma pendência só decidida."""
    rid1, rid2, _, _ = v1_v2
    pe = pend(cx, "vinculo_sapl", str(casa(cx, "PB")["id"]), "status")
    assert pe["vigente_sha"] == PR.sha_vigente("ok")  # o que está na tabela agora, não o 'fora_do_ar' de antes
    DEC.decidir(cx, str(pe["id"]), acao="descartar", **POR)
    cx.commit()
    assert PR.reavaliar(cx) == []
    cx.rollback()
    assert pend(cx, "vinculo_sapl", str(casa(cx, "PB")["id"]), "status")["status"] == "decidida"


def test_5d_job_que_tenta_gravar_null_no_campo_com_override_vai_para_recusadas(cx, monkeypatch, tmp_path):
    rid, _, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    antes = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    depois = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    chave = str(casa(cx, "RO")["id"])
    depois.overrides[("vinculo_sapl", chave, "status")] = {"valor": "sem_api", "tentou_valor": None, "tentou_marcado": True, "tentou_em": antes.tirada_em}  # jsonb 'null' chega como None
    r = PRO.propor(cx, rid, "sapl.assembleias", antes, depois)
    assert r.novas == [] and r.inalterados > 0
    assert len(r.recusadas) == 1 and r.recusadas[0]["campo"] == "status" and "tentou gravar NULL" in r.recusadas[0]["motivo"] and r.recusadas[0]["valor_candidato"] is None


def test_5e_divergencia_anotada_fora_de_rodada_vira_uma_proposta_quando_a_rodada_a_sustenta(cx, monkeypatch, tmp_path):
    """O job AGENDADO (upsert direto, sem rodada) anota a divergência; a rodada seguinte tenta o mesmo valor, o gatilho não regrava e `tentou_em` fica antigo. A rodada propõe mesmo
    assim, porque lê o robots.txt que sustenta o valor tentado; repetir a rodada não traz nada novo."""
    from datetime import datetime, timezone

    from civico_etl.db import upsert

    rid1, _, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    am = casa(cx, "AM")
    chave = str(am["id"])
    r = PR.registrar(cx, PR.Proposta(classe="vinculo_sapl", registro_chave=chave, campo="status", valor_candidato="sem_api", url=API["AM"], trecho="$ sem a chave parlamentares",
                                     conteudo_sha256=sha256_text("a mão"), lida_em="2026-11-14T12:00:00Z", fonte_slug="sapl-ale"))
    cx.commit()
    decidir_e_aplicar(cx, r.pendencia_id, "aprovar")
    # o "job agendado": upsert direto como discover_ales, FORA de qualquer rodada
    w = psycopg.connect(os.environ["ETL_DATABASE_URL"], row_factory=dict_row)  # o banco isolado (fixture autouse)
    try:
        upsert(w, "sapl_houses", ["place_id", "body_id", "base_url", "registry_url", "registry_status", "status", "note", "checked_at"],
               [(am["place_id"], am["body_id"], am["base_url"], am["registry_url"], am["registry_status"], "robots_bloqueia", "robots.txt bloqueia", datetime.now(timezone.utc))],
               ["place_id"], update=["body_id", "base_url", "status", "note", "checked_at"])
        w.commit()
    finally:
        w.close()
    cx.rollback()
    ov = cx.execute("select * from adm_overrides where registro_chave = %s and campo = 'status' and vigente", (chave,)).fetchone()
    assert (ov["tentou_valor"], ov["tentou_vezes"]) == ("robots_bloqueia", 1) and casa(cx, "AM")["status"] == "sem_api"
    anotada = ov["tentou_em"]
    rid2, res2, _ = rodada(cx, monkeypatch, tmp_path / "c2", "v2")
    cx.rollback()
    ov2 = cx.execute("select tentou_valor, tentou_vezes, tentou_em from adm_overrides where id = %s", (ov["id"],)).fetchone()
    assert (ov2["tentou_valor"], ov2["tentou_vezes"], ov2["tentou_em"]) == ("robots_bloqueia", 1, anotada)  # o gatilho não regravou
    ps = props(cx, rid2, registro_chave=chave, campo="status")
    assert len(ps) == 1 and (ps[0]["valor_vigente"], ps[0]["valor_candidato"], ps[0]["url"]) == ("sem_api", "robots_bloqueia", ROBOTS["AM"])
    assert [(x["registro_chave"], x["anotada_em"]) for x in res2["propostas"]["anotadas_antes"]] == [(chave, anotada.isoformat())]
    pe = pend(cx, "vinculo_sapl", chave, "status")
    assert (pe["status"], pe["reaberta"], pe["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou") and str(pe["id"]) in res2["propostas"]["pendencias_reabertas"]
    est, total = estado_pendencias(cx), n(cx, "select count(*) as n from adm_propostas")
    rep = R.repetir(cx, rid2)
    cx.rollback()
    assert rep["propostas"]["novas"] == 0 and rep["propostas"]["repetidas"] == 1 and rep["propostas"]["pendencias_reabertas"] == []
    assert estado_pendencias(cx) == est and n(cx, "select count(*) as n from adm_propostas") == total


# ------------------------------------------------------------------ 6. Câmara Municipal: base_url


def test_6_camara_registro_que_aponta_para_outro_endereco_gera_proposta_de_base_url(cx, monkeypatch, tmp_path):
    rec = Recorte(ibges=(AF.IBGE_MUNICIPIO,), modo="descobrir")
    rid1, res1, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1", coletor="sapl.camaras", recorte=rec)
    cx.rollback()
    assert res1["status"] == "concluida" and res1["propostas"]["novas"] == 0 and res1["propostas"]["primeiros_preenchimentos_por_classe"] == {"vinculo_sapl": 2}
    h = cx.execute("select h.* from sapl_houses h join places p on p.id = h.place_id where p.ibge_code = %s", (AF.IBGE_MUNICIPIO,)).fetchone()
    assert (h["base_url"], h["status"], h["registry_url"]) == (AF.HOST_MUNICIPIO, "ok", AF.URL_REGISTRO)
    rid2, res2, _ = rodada(cx, monkeypatch, tmp_path / "c2", "v2", coletor="sapl.camaras", recorte=rec)
    cx.rollback()
    assert res2["status"] == "concluida"
    h2 = cx.execute("select * from sapl_houses where id = %s", (h["id"],)).fetchone()
    assert (h2["base_url"], h2["status"]) == (AF.HOST_MUNICIPIO_V2, "ok")
    ps = props(cx, rid2)
    assert [(p["classe"], p["campo"]) for p in ps] == [("vinculo_sapl", "base_url")]  # o status continua ok: nada
    p = ps[0]
    assert (p["valor_vigente"], p["valor_candidato"], p["url"], p["fonte_slug"]) == (AF.HOST_MUNICIPIO, AF.HOST_MUNICIPIO_V2, AF.URL_REGISTRO, "sapl")
    t = tentativa(cx, rid2, AF.URL_REGISTRO)
    assert t["resultado"] == "lida" and p["conteudo_sha256"] == t["conteudo_sha256"] and AF.HOST_MUNICIPIO_V2 in p["trecho"] and "cartão da Câmara Municipal" in p["trecho"]
    pe = pend(cx, "vinculo_sapl", str(h["id"]), "base_url")
    assert (pe["status"], pe["tipo"]) == ("aberta", "mudanca")


# ------------------------------------------------------------------ 7. o valor de antes não entra pela CLI


def test_7_o_vigente_de_antes_so_vale_para_o_sistema_e_a_cli_recusa_a_chave(cx, monkeypatch, tmp_path, capsys):
    rid1, _, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    ro = casa(cx, "RO")
    boa = {"classe": "vinculo_sapl", "registro_chave": str(ro["id"]), "campo": "status", "valor_candidato": "fora_do_ar", "url": API["RO"], "trecho": "$.status",
           "conteudo_sha256": sha256_text("x1"), "lida_em": "2026-11-14T12:00:00Z"}
    assert "vigente_antes" not in {f.name for f in PR.fields(PR.Proposta)}
    arq = Path(tmp_path) / "p.json"
    arq.write_text(json.dumps([{**boa, "vigente_antes": "fora_do_ar"}]), encoding="utf-8")
    assert cli.main(["admin", "proposta", "registrar", "--arquivo", str(arq), "--json"]) == 1
    doc = json.loads(capsys.readouterr().out)
    assert doc["resultados"][0]["resultado"] == "recusada" and "vigente_antes" in doc["resultados"][0]["motivo"] and "campo desconhecido" in doc["resultados"][0]["motivo"]
    assert n(cx, "select count(*) as n from adm_propostas") == 0  # nada foi gravado
    # sem a chave, a CLI lê o vigente do banco: a proposta de 'ok' -> 'fora_do_ar' guarda o 'ok' que está na tabela
    arq.write_text(json.dumps([boa]), encoding="utf-8")
    assert cli.main(["admin", "proposta", "registrar", "--arquivo", str(arq), "--json"]) == 0
    capsys.readouterr()
    assert props(cx)[0]["valor_vigente"] == "ok"
    # o parâmetro de sistema substitui a leitura do banco; None é um vigente legítimo e diferente de "não informado"
    r = PR.registrar(cx, PR.Proposta(**{**boa, "valor_candidato": "sem_api", "conteudo_sha256": sha256_text("x2")}), vigente_antes=None)
    cx.commit()
    assert cx.execute("select valor_vigente from adm_propostas where id = %s", (r.proposta_id,)).fetchone()["valor_vigente"] is None


# ------------------------------------------------------------------ 8. o proponente falha e a rodada continua


def test_8a_proponente_que_falha_nao_derruba_a_rodada(cx, monkeypatch, tmp_path):
    def quebra(*a, **k):
        raise RuntimeError("proponente quebrou de propósito")

    monkeypatch.setattr(PRO, "propor", quebra)
    rid, res, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    assert res["status"] == "concluida" and res["codigo_saida"] == 0  # o status que teria sem o proponente
    assert res["propostas"]["executado"] is False and "proponente quebrou de propósito" in res["propostas"]["erro"]
    assert n(cx, "select count(*) as n from adm_tentativas where rodada_id = %s", rid) > 0 and n(cx, "select count(*) as n from adm_vinculos") >= 5  # o que coletou fica
    assert n(cx, "select count(*) as n from adm_propostas") == 0 and R.descrever_rodada(cx, rid)["resultado"]["propostas"]["erro"].startswith("RuntimeError")
    assert cx.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()["status"] == "concluida"


def test_8b_foto_de_antes_que_falha_tambem_nao_derruba_a_rodada(cx, monkeypatch, tmp_path):
    chamadas = {"n": 0}
    original = PRO.fotografar

    def foto_quebra_na_primeira(*a, **k):
        chamadas["n"] += 1
        if chamadas["n"] == 1:
            raise RuntimeError("foto quebrou")
        return original(*a, **k)

    monkeypatch.setattr(PRO, "fotografar", foto_quebra_na_primeira)
    rid, res, _ = rodada(cx, monkeypatch, tmp_path / "c1", "v1")
    cx.rollback()
    assert res["status"] == "concluida" and res["propostas"]["executado"] is False and "foto de antes: RuntimeError: foto quebrou" in res["propostas"]["erro"]
    assert n(cx, "select count(*) as n from adm_tentativas where rodada_id = %s", rid) > 0


# ------------------------------------------------------------------ coletor sem classe e banco sem a 0151


def test_coletor_sem_classe_revisavel_tem_foto_vazia_e_nao_propoe_nada(cx):
    f = PRO.fotografar(cx, "camara.equipe", None)
    assert f.vazia and f.overrides == {}
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=("RO",)))  # o coletor nomeado em `propor` é que decide; a rodada é só a de apoio
    cx.commit()
    r = PRO.propor(cx, rid, "camara.equipe", f, f)
    assert r.executado is False and r.novas == [] and "camara.equipe" in r.avisos[0]
    assert n(cx, "select count(*) as n from adm_propostas") == 0


def test_sem_a_0151_o_aviso_diz_que_a_divergencia_com_override_nao_e_detectada(cx, monkeypatch):
    monkeypatch.setattr(PRO, "_tem_anotacao", lambda conn: False)
    f = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    assert f.anotacao_disponivel is False
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=("RO",)))
    cx.commit()
    r = PRO.propor(cx, rid, "sapl.assembleias", f, f)
    assert r.executado is True and "0151" in r.avisos[0] and r.novas == []


def test_foto_de_registro_que_ainda_nao_existe_guarda_a_marca_existia_falso(cx):
    f = PRO.fotografar(cx, "sapl.assembleias", Recorte(ufs=("RO", "PB")))
    assert {c["uf"]: (c["existia"], c["status"], c["house_id"]) for c in f.casas.values()} == {"RO": (False, None, None), "PB": (False, None, None)}
    assert all(c["existia"] is False and c["status"] is None for c in f.cobertura.values()) and len(f.cobertura) == 6
