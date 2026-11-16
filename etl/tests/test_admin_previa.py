"""FABRICADO. A5: prévia de rodada (`admin.rodadas.previa`, `civico-etl admin previa`). Critério 3.

A prévia não faz requisição (cliente HTTP que falha se usado e `socket.socket` que falha se criado), não escreve e não cria diretório de cache.
O número de URLs de entrada da prévia é igual ao da rodada executada em seguida; o que é estimativa vem marcado como estimativa.
Banco isolado, transporte fabricado do SAPL; o banco da suíte nunca é tocado (módulo `test_admin_rodada` traz as fixtures e a conferência por contagens).
"""

from __future__ import annotations

import json
import socket

import admin_fixtures as AF
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from test_admin_rodada import (  # noqa: F401  (fixtures: banco da suíte intacto, ambiente do coletor, base do SAPL, conexão e cache)
    API, ROBOTS, _ambiente, _suite_intacta, cache, cx, n, rodada, sapl_base, tentativas,
)

from civico_etl import cli
from civico_etl import http as H
from civico_etl.admin import rodadas as R
from civico_etl.catalogo.contrato import Recorte


class _ClienteQueFalha:
    def __getattr__(self, nome):
        raise AssertionError(f"a prévia usou o cliente HTTP ({nome})")


@pytest.fixture
def sem_rede(monkeypatch):
    def sem_socket(*a, **k):
        raise AssertionError("a prévia criou um socket")

    monkeypatch.setattr(H, "_client", _ClienteQueFalha())
    monkeypatch.setattr(socket, "socket", sem_socket)


# ------------------------------------------------------------------ 1


def test_1_previa_sem_nenhuma_requisicao(cx, sem_rede, cache):
    antes = n(cx, "select count(*) as n from adm_rodadas")
    p = R.previa(cx, "sapl.assembleias", Recorte(ufs=AF.UFS), cache_dir=cache)
    assert p["nao_suportado"] is None and p["comando"] == "sapl.ales" and p["modo"] == "recoletar"
    assert p["argv"] == ["sapl.ales", *[x for u in AF.UFS for x in ("--uf", u)]]
    assert p["fontes"] == ["sapl-ale"] and p["datasets"] == ["sapl-ale.descoberta", "sapl-ale.{uf}"]
    assert p["n_urls_entrada"] == 10 and p["n_urls_condicionais"] == 0 and p["lista_completa"] is False
    assert [i["url"] for i in p["urls_entrada"]] == list(dict.fromkeys(i["url"] for i in p["urls_entrada"]))  # únicas
    assert {i["url"] for i in p["urls_entrada"]} == set(ROBOTS.values()) | set(API.values())
    assert all(i["cache"] == {"estado": "fora_do_cache"} for i in p["urls_entrada"])
    # a consultar é ESTIMATIVA marcada, com a base declarada e o intervalo
    assert p["a_consultar"] == {"valor": 10, "estimativa": True, "base": R.BASE_A_CONSULTAR, "intervalo": [10, 10]}
    # demais URLs: desconhecido, com o motivo (nunca zero)
    assert p["demais_urls"]["valor"] is None and "nenhuma rodada anterior" in p["demais_urls"]["base"]
    # registros elegíveis: as cinco Assembleias, ainda sem registro em sapl_houses
    el = p["registros_elegiveis"]
    assert el["classe"] == "vinculo_sapl" and el["valor"] == 5 and [c["uf"] for c in el["chaves"]] == list(AF.UFS) and all(c["sapl_houses_id"] is None for c in el["chaves"])
    assert not cache.exists()  # nem o diretório do cache foi criado
    assert n(cx, "select count(*) as n from adm_rodadas") == antes
    json.dumps(p)  # serializável
    # recorte de uma UF
    assert R.previa(cx, "sapl.assembleias", Recorte(ufs=("RO",)), cache_dir=cache)["n_urls_entrada"] == 2


# ------------------------------------------------------------------ 2: critério 3 (igualdade)


def test_2_urls_de_entrada_da_previa_igual_a_da_rodada(cx, monkeypatch, cache):
    t = AF.instalar(monkeypatch, "v1", cache)
    p = R.previa(cx, "sapl.assembleias", Recorte(ufs=AF.UFS))
    assert p["n_urls_entrada"] == 10 and t.pedidos == []
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS)); cx.commit()
    assert t.pedidos == []  # abrir não vai à rede
    pv = cx.execute("select previa from adm_rodadas where id = %s", (rid,)).fetchone()["previa"]
    assert [i["url"] for i in pv["urls_entrada"]] == [i["url"] for i in p["urls_entrada"]]  # a prévia gravada é a prévia mostrada
    res = R.executar(cx, rid)
    assert res["status"] == "concluida" and t.nao_previstos == []
    entrada = {l["url"] for l in tentativas(cx, rid) if l["entrada"]}
    assert len(entrada) == p["n_urls_entrada"] == 10 == res["urls_entrada"]["previstas"] == res["urls_entrada"]["n_tentadas"]
    assert entrada == {i["url"] for i in p["urls_entrada"]}
    # nove passaram por `fetch` (as quatro /api/ lidas ou falhadas e as cinco robots.txt); a /api/ do PI foi bloqueada ANTES de fetch e entra pelo executor
    por_fetch = {u for u in t.pedidos}
    assert API["PI"] not in por_fetch and len(entrada & por_fetch) == 9 and res["robots_registrados"] == [API["PI"]]
    assert res["urls_entrada"]["firmes_nao_tentadas"] == [] and res["urls_entrada"]["condicionais_tentadas"] == []
    assert any(l["url"] == API["PI"] and l["motivo"] == "robots" and l["entrada"] for l in tentativas(cx, rid))


# ------------------------------------------------------------------ 3: depois da rodada


def test_3_previa_depois_da_rodada(cx, monkeypatch, cache, capsys):
    rid, res, t = rodada(cx, monkeypatch, cache)
    p = R.previa(cx, "sapl.assembleias", Recorte(ufs=AF.UFS))
    por = {i["url"]: i for i in p["urls_entrada"]}
    lidas = set(ROBOTS.values()) | {API[uf] for uf in ("RO", "AC", "AM")}
    for u in lidas:
        c = por[u]["cache"]
        assert c["estado"] == "em_cache" and c["idade_horas"] >= 0 and len(c["sha256"]) == 64, u
        assert c["sha256"] == json.loads(R.caminhos_cache(u, cache)[1].read_text())["sha256"]
    assert por[API["PB"]]["cache"]["estado"] == "fora_do_cache" and por[API["PI"]]["cache"]["estado"] == "fora_do_cache"  # 500 nunca entra; PI nunca é pedida
    # as páginas da carga que o banco já conhece entram como CONDICIONAIS (dependem da fila de carga): não contam nas firmes
    cond = [i for i in p["urls_entrada"] if i["condicional"]]
    assert p["n_urls_entrada"] == 10 and p["n_urls_condicionais"] == len(cond) == 3
    assert all("/api/parlamentares/legislatura/" in i["url"] and i["cache"]["estado"] == "em_cache" for i in cond)
    # a consultar: estimativa marcada com intervalo (o que está no cache pode ou não ir à rede, conforme o max_age de cada chamada)
    assert p["a_consultar"] == {"valor": 2, "estimativa": True, "base": R.BASE_A_CONSULTAR, "intervalo": [2, 10]}
    # demais URLs: estimativa a partir da rodada anterior, citada
    d = p["demais_urls"]
    esperado = n(cx, "select count(distinct url_sha) as n from adm_tentativas where rodada_id = %s and not entrada", rid)
    assert d["estimativa"] is True and d["valor"] == esperado > 0 and d["rodada_base"] == rid and d["base"].startswith(f"rodada {rid} de ")
    # a tabela diz "estimativa" ao lado de cada número estimado e nunca mostra um valor desconhecido como número
    txt = R.texto_previa(p)
    linhas = {l.split("  ")[0].strip(): l for l in txt.splitlines() if l.startswith(("a consultar", "demais URLs"))}
    assert "estimativa" in linhas["a consultar"] and "estimativa" in linhas["demais URLs"] and f"rodada {rid}" in linhas["demais URLs"]
    assert "em_cache" in txt and "fora_do_cache" in txt and "condicional" in txt
    outro = R.texto_previa(R.previa(cx, "sapl.assembleias", Recorte(ufs=("RO",)), cache_dir=cache.parent / "outro"))  # recorte sem rodada anterior
    assert "desconhecido: nenhuma rodada anterior deste recorte" in outro
    # a fórmula do caminho é a de http._paths (que cria o diretório): igualdade conferida
    for u in (ROBOTS["RO"], API["PB"], "https://exemplo.invalid:8443/a?b=1"):
        assert R.caminhos_cache(u, H.CACHE_DIR) == H._paths(u)


# ------------------------------------------------------------------ 4: reprocessar


def test_4_previa_reprocessar(cx, monkeypatch, cache):
    ufs = ("RO", "AC", "AM")
    rid, res, t = rodada(cx, monkeypatch, cache, ufs=ufs)
    p = R.previa(cx, "sapl.assembleias", Recorte(ufs=ufs, modo="reprocessar"))
    assert p["a_consultar"] == {"valor": 0, "estimativa": False, "base": p["a_consultar"]["base"]} and "sem rede" in p["a_consultar"]["base"]
    assert p["faltam_no_cache"] == [] and p["n_urls_entrada"] == 6
    assert "estimativa" not in R.texto_previa(p).split("a consultar")[1].splitlines()[0]
    # uma URL de entrada removida do cache: a prévia lista a que falta
    R.caminhos_cache(API["AC"], cache)[0].unlink()
    p2 = R.previa(cx, "sapl.assembleias", Recorte(ufs=ufs, modo="reprocessar"))
    assert p2["faltam_no_cache"] == [API["AC"]] and p2["a_consultar"]["valor"] == 0 and "faltam no cache" in R.texto_previa(p2) and API["AC"] in R.texto_previa(p2)
    # com as cinco UFs a pré-condição recusaria sempre: a /api/ da PB (500) nunca entra no cache e a do PI nunca é pedida (limite conservador, declarado)
    p5 = R.previa(cx, "sapl.assembleias", Recorte(ufs=AF.UFS, modo="reprocessar"))
    assert API["PB"] in p5["faltam_no_cache"] and API["PI"] in p5["faltam_no_cache"]


# ------------------------------------------------------------------ 5: não suportado e sem registro de tentativas


def test_5_recorte_nao_suportado_e_coletor_sem_tentativas(cx, capsys, cache):
    p = R.previa(cx, "sapl.assembleias", Recorte(anos=(2025,)))
    assert p["nao_suportado"] and "'ano'" in p["nao_suportado"] and "urls_entrada" not in p
    rc = cli.main(["admin", "previa", "--coletor", "sapl.assembleias", "--ano", "2025"])
    out = capsys.readouterr().out
    assert rc == 1 and "não suportado" in out and "'ano'" in out
    rc = cli.main(["admin", "previa", "--coletor", "camara.equipe", "--uf", "SP", "--json"])
    doc = json.loads(capsys.readouterr().out)
    assert rc == 1 and "'uf'" in doc["nao_suportado"]
    rc = cli.main(["admin", "previa", "--coletor", "sapl.assembleias", "--modo", "descobrir"])
    assert rc == 1 and "não suportado" in capsys.readouterr().out
    rc = cli.main(["admin", "previa", "--coletor", "nao.existe"])
    err = capsys.readouterr().err
    assert rc == 1 and "coletor desconhecido" in err
    with pytest.raises(R.ErroAdmin, match="recusada"):
        R.abrir(cx, "sapl.assembleias", Recorte(anos=(2025,)))
    assert n(cx, "select count(*) as n from adm_rodadas") == 0
    # tse.votos lê por remotezip: as tentativas não são registradas, e a prévia diz isso em vez de números
    p = R.previa(cx, "tse.votos", Recorte(anos=(2022,)), cache_dir=cache)
    assert p["tentativas_registradas"] is False and p["a_consultar"]["valor"] is None and p["a_consultar"]["base"] == "tentativas não registradas para este coletor"
    assert p["demais_urls"]["valor"] is None and p["n_urls_entrada"] == 1 and all(i["cache"] is None for i in p["urls_entrada"])
    txt = R.texto_previa(p)
    assert "tentativas não registradas para este coletor" in txt and "estimativa" not in txt and "desconhecido" in txt


# ------------------------------------------------------------------ 6: qualquer coletor do catálogo


def test_6_previa_de_coletores_de_familias_diferentes(cx, sem_rede, cache):
    casos = [("camara.equipe", Recorte()),  # estático
             ("sapl.camaras", Recorte()),  # dinâmico, sem URL listável sem banco
             ("camara.noturna", Recorte()),  # com {ano}
             ("camara.diario", Recorte(anos=(2025,))),  # com {ano} e URLs vindas do banco
             ("tse.candidatos", Recorte(anos=(2022,), ufs=("SP",))),
             ("sapl.camaras", Recorte(ibges=(AF.IBGE_MUNICIPIO,), modo="descobrir")),
             ("ibge.places", Recorte(modo="reprocessar"))]
    for coletor, r in casos:
        p = R.previa(cx, coletor, r, cache_dir=cache)
        assert p["nao_suportado"] is None, (coletor, p["nao_suportado"])
        assert p["a_consultar"]["base"] and p["demais_urls"]["base"], coletor
        assert (p["registros_elegiveis"]["valor"] is None) == bool(p["registros_elegiveis"]["motivo"]), coletor  # desconhecido sempre traz o motivo
        assert R.texto_previa(p) and json.dumps(p), coletor
        assert p["n_urls_entrada"] == len([i for i in p["urls_entrada"] if not i["condicional"]])
    eq = R.previa(cx, "camara.equipe", Recorte(), cache_dir=cache)
    assert eq["registros_elegiveis"]["valor"] is None and "classe revisável" in eq["registros_elegiveis"]["motivo"]
    assert eq["n_urls_entrada"] == 1 and eq["a_consultar"]["valor"] == 1 and eq["a_consultar"]["estimativa"] is True
    no = R.previa(cx, "camara.noturna", Recorte(), cache_dir=cache, agora=1_700_000_000.0)
    assert no["n_urls_entrada"] == 4 and no["gerada_em"].startswith("2023-11-14")
    mun = R.previa(cx, "sapl.camaras", Recorte(ibges=(AF.IBGE_MUNICIPIO,), modo="descobrir"), cache_dir=cache)
    assert mun["registros_elegiveis"]["valor"] == 1 and mun["registros_elegiveis"]["chaves"][0]["ibge"] == AF.IBGE_MUNICIPIO and mun["n_urls_entrada"] == 1
    assert R.previa(cx, "sapl.camaras", Recorte(), cache_dir=cache)["registros_elegiveis"]["valor"] is None
    assert not cache.exists()
