"""FABRICADO. B5: a edição candidata (`admin candidata`): diferenças em relação à base vigente, as aplicadas, as pendências restantes, totais e a marca SIMULADO.

Banco isolado (`banco_isolado`), sem rede (transporte fabricado), sem skip e sem xfail; o que as rodadas e as decisões gravam é desfeito em `finally`. Nada é gravado no banco da suíte
(contagens antes e depois). A sequência reproduz em processo o que o roteiro da primeira rodada faz pela CLI:
  rodada v1 (cache novo) -> rodada v2 com releitura forçada das URLs de entrada (ADMIN_SIMULADO=v2) -> PB: decisão corrigir aplicada (candidato continua diferente do vigente)
  -> AC: aprovar aplicada (o candidato vira o vigente) -> AM: fica pendente -> RO: duas fontes que divergem (conflitante) -> PI: descartada -> cobertura: corrigir sem aplicar.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import admin_fixtures as AF
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row

from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import candidata as CAND
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import pendencias as PEN
from civico_etl.admin import propostas as PR
from civico_etl.admin import rodadas as R
from civico_etl.catalogo import contrato
from civico_etl.catalogo.contrato import Recorte
from civico_etl.util import sha256_text

SUITE = ("adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "adm_propostas", "adm_pendencias", "adm_decisoes", "sapl_houses", "data_coverage", "ingest_runs", "dataset_stamps")
POR = dict(por_tipo="pessoa", por_nome="Fulana de Teste", justificativa="conferi na página da casa")
HASH_A, HASH_B, HASH_C = (sha256_text(x) for x in ("a", "b", "c"))


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
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
    for k in ("ETL_INVOCATION", "ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH", "ADMIN_RODADA_TIMEOUT_S", "ADMIN_COLETA_AGENTES", "ADMIN_SIMULADO"):
        monkeypatch.delenv(k, raising=False)

    def sem_subprocesso(*a, **k):
        raise AssertionError("runner_subprocesso chamado: o coletor iria à rede de verdade")

    monkeypatch.setattr(contrato, "runner_subprocesso", sem_subprocesso)


def limpar_tudo(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_overrides", "adm_vinculos", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "corrections", "adm_evidencias", "adm_tentativas", "adm_rodadas"):
            c.execute(f"delete from {t}")  # noqa: S608


@pytest.fixture
def cx(banco_isolado):  # noqa: F811
    url = banco_isolado
    limpar_tudo(url)
    AF.limpar_base(url)
    AF.carregar_base(url)
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    try:
        yield c
    finally:
        c.rollback()
        c.close()
        limpar_tudo(url)
        AF.limpar_base(url)


def casa(cx, uf: str) -> dict:
    return cx.execute("select h.* from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = %s", (uf,)).fetchone()


def pend(cx, classe: str, chave: str, campo: str) -> dict:
    return cx.execute("select * from adm_pendencias where classe = %s and registro_chave = %s and campo = %s", (classe, chave, campo)).fetchone()


def propor(cx, chave: str, campo: str, candidato: Any, url: str, sha: str, *, classe: str = "vinculo_sapl", lida: str = "2026-11-14T12:00:00Z") -> Any:
    r = PR.registrar(cx, PR.Proposta(classe=classe, registro_chave=chave, campo=campo, valor_candidato=candidato, url=url, trecho=f"trecho de ensaio de {url}", conteudo_sha256=sha, lida_em=lida,
                                     fonte_slug="sapl-ale"))
    cx.commit()
    return r


@pytest.fixture
def seq(cx, monkeypatch, tmp_path):
    """A sequência curta. Devolve um dicionário com os ids e as linhas que os testes conferem."""
    cache = tmp_path / "cache"
    t = AF.instalar(monkeypatch, "v1", cache)
    rid1 = R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS), cache_dir=cache)
    cx.commit()
    res1 = R.executar(cx, rid1)
    assert res1["status"] == "concluida"
    cx.rollback()
    cx.execute("update sapl_houses set loaded_at = loaded_at - interval '10 days' where loaded_at is not null")  # a casa 'ok' já carregada volta à fila de carga
    cx.commit()
    entradas = [i["url"] for i in R.previa(cx, "sapl.assembleias", Recorte(ufs=AF.UFS), cache_dir=cache)["urls_entrada"]]
    monkeypatch.setenv("ADMIN_SIMULADO", "v2")  # só a segunda rodada é simulada: a marca vem do resultado gravado em cada rodada
    AF.instalar(monkeypatch, "v2", cache)
    rid2 = R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS), forcar_urls=entradas, cache_dir=cache)
    cx.commit()
    res2 = R.executar(cx, rid2)
    assert res2["status"] == "concluida" and res2["propostas"]["novas"] == 2
    monkeypatch.delenv("ADMIN_SIMULADO")
    cx.rollback()
    h = {uf: casa(cx, uf) for uf in AF.UFS}
    assert (h["PB"]["status"], h["AM"]["status"]) == ("ok", "robots_bloqueia")
    ids = {uf: str(h[uf]["id"]) for uf in AF.UFS}

    # PB: o candidato da fonte é 'ok'; a pessoa corrige para 'sem_api' e aplica: o vigente passa a diferir do candidato (aparece nas duas seções)
    pb = pend(cx, "vinculo_sapl", ids["PB"], "status")
    DEC.decidir(cx, str(pb["id"]), acao="corrigir", valor="sem_api", **{**POR, "justificativa": "a página oficial diz que a casa não tem API"})
    APL.aplicar_pendentes(cx)
    cx.commit()
    # AC: manual (sem rodada), candidato 'fora_do_ar'; aprovar e aplicar: o candidato vira o vigente (só em `aplicadas`)
    r = propor(cx, ids["AC"], "status", "fora_do_ar", "https://sapl.al.ac.leg.br/api/", HASH_A)
    DEC.decidir(cx, r.pendencia_id, acao="aprovar", **POR)
    APL.aplicar_pendentes(cx)
    cx.commit()
    # RO: duas fontes, dois candidatos: conflitante
    propor(cx, ids["RO"], "status", "robots_bloqueia", "https://sapl.al.ro.leg.br/robots.txt", HASH_A)
    propor(cx, ids["RO"], "status", "sem_api", "https://sapl.al.ro.leg.br/api/", HASH_B)
    # PI: descartada
    r = propor(cx, ids["PI"], "status", "ok", "https://sapl.al.pi.leg.br/api/", HASH_C)
    DEC.decidir(cx, r.pendencia_id, acao="descartar", **{**POR, "justificativa": "o robots.txt continua bloqueando"})
    cx.commit()
    # cobertura de RO (propostas.status): corrigir sem aplicar
    chave_cob = "11:propostas"
    vig_cob = cx.execute("select c.status from data_coverage c join places p on p.id = c.place_id where p.ibge_code = '11' and c.dataset = 'propostas'").fetchone()["status"]
    r = propor(cx, chave_cob, "status", "no_site", "https://sapl.al.ro.leg.br/api/materia/materialegislativa/?o=-id&page_size=1&page=1", HASH_B, classe="cobertura")
    DEC.decidir(cx, r.pendencia_id, acao="corrigir", valor="nao_publica", **{**POR, "justificativa": "decisão ainda não aplicada"})
    cx.commit()
    cx.rollback()
    return {"rid1": rid1, "rid2": rid2, "ids": ids, "vig_cob": vig_cob, "chave_cob": chave_cob, "pedidos": len(t.pedidos)}


def linha(secao: list[dict], chave: str, campo: str, classe: str = "vinculo_sapl") -> dict:
    achadas = [x for x in secao if (x["classe"], x["registro_chave"], x["campo"]) == (classe, chave, campo)]
    assert len(achadas) == 1, (chave, campo, [(x["classe"], x["registro_chave"], x["campo"]) for x in secao])
    return achadas[0]


# ------------------------------------------------------------------ testes


def test_diferencas_situacoes_e_evidencia(cx, seq):
    ids, doc = seq["ids"], CAND.candidata(cx)
    dif = doc["diferencas"]
    assert {(d["classe"], d["registro_chave"], d["campo"]): d["situacao"] for d in dif} == {
        ("vinculo_sapl", ids["PB"], "status"): "decidida_e_aplicada",  # corrigido para sem_api; o candidato da fonte (ok) ainda difere do vigente
        ("vinculo_sapl", ids["AM"], "status"): "pendente",
        ("vinculo_sapl", ids["RO"], "status"): "conflitante",
        ("vinculo_sapl", ids["PI"], "status"): "descartada",
        ("cobertura", seq["chave_cob"], "status"): "decidida_nao_aplicada",
    }
    am = linha(dif, ids["AM"], "status")
    assert am["valor_vigente"] == "robots_bloqueia" and [c["valor"] for c in am["candidatos"]] == ["robots_bloqueia"] and am["decisao"] is None
    # AM: o job já gravou 'robots_bloqueia' na tabela (sem override); a mudança espera decisão: o candidato já é o vigente e a diferença é contra o valor da leitura ('ok')
    assert am["candidatos"][0]["vigente_na_leitura"] == "ok" and am["candidatos"][0]["ja_e_o_vigente"] is True and am["pendencia_status"] == "aberta"
    assert am["rotulo"] and am["territorio"] == {"nivel": "uf", "ibge_code": AF.IBGE_UF["AM"]}
    # PB: evidência completa
    pb = linha(dif, ids["PB"], "status")
    c = pb["candidatos"][0]
    assert (pb["valor_vigente"], c["valor"], c["url"], c["fonte_slug"], c["rodada_id"]) == ("sem_api", "ok", f"{AF.ALE_HOSTS['PB']}/api/", "sapl-ale", seq["rid2"])
    assert len(c["conteudo_sha256"]) == 64 and c["trecho"] and c["lida_em"] is not None and "fonte_declarada_em" in c and "bloco" in c
    assert pb["decisao"]["acao"] == "corrigir" and pb["decisao"]["aplicada"] is True and pb["decisao"]["por_nome"] == "Fulana de Teste"
    ro = linha(dif, ids["RO"], "status")
    assert sorted(x["valor"] for x in ro["candidatos"]) == ["robots_bloqueia", "sem_api"] and ro["pendencia_status"] == "aberta"
    assert linha(dif, ids["PI"], "status")["decisao"]["acao"] == "descartar"
    cob = linha(dif, seq["chave_cob"], "status", "cobertura")
    assert cob["valor_vigente"] == seq["vig_cob"] and cob["decisao"]["aplicada"] is False and cob["decisao"]["acao"] == "corrigir"


def test_aplicadas_tem_valor_anterior_novo_e_decisao(cx, seq):
    ids, doc = seq["ids"], CAND.candidata(cx)
    ap = {(a["classe"], a["registro_chave"], a["campo"]): a for a in doc["aplicadas"]}
    assert set(ap) == {("vinculo_sapl", ids["PB"], "status"), ("vinculo_sapl", ids["AC"], "status")}
    pb, ac = ap[("vinculo_sapl", ids["PB"], "status")], ap[("vinculo_sapl", ids["AC"], "status")]
    assert (pb["valor_anterior"], pb["valor_novo"], pb["valor_vigente"]) == ("fora_do_ar", "sem_api", "sem_api") and pb["decisao"]["aplicada"] and pb["decisao"]["aplicada_em"] is not None
    assert (ac["valor_anterior"], ac["valor_novo"], ac["valor_vigente"]) == ("ok", "fora_do_ar", "fora_do_ar") and ac["decisao"]["acao"] == "aprovar"
    # AC: o candidato já é o vigente, então NÃO está em `diferencas`
    assert ("vinculo_sapl", ids["AC"], "status") not in {(d["classe"], d["registro_chave"], d["campo"]) for d in doc["diferencas"]}
    assert ac["candidatos"][0]["url"] == "https://sapl.al.ac.leg.br/api/" and ac["candidatos"][0]["rodada_id"] is None


def test_pendencias_restantes_seguem_a_fila_e_trazem_a_pergunta(cx, seq):
    doc = CAND.candidata(cx)
    fila = PEN.fila(cx)
    assert [p["id"] for p in doc["pendencias_restantes"]] == [p["id"] for p in fila] and len(fila) >= 2
    assert all(p["pergunta"].endswith("?") for p in doc["pendencias_restantes"])
    abertas = {(p["classe"], p["registro_chave"], p["campo"]) for p in doc["pendencias_restantes"]}
    assert ("vinculo_sapl", seq["ids"]["AM"], "status") in abertas and ("vinculo_sapl", seq["ids"]["RO"], "status") in abertas
    assert ("vinculo_sapl", seq["ids"]["PB"], "status") not in abertas and ("cobertura", seq["chave_cob"], "status") not in abertas  # decididas
    assert [p["posicao"] for p in doc["pendencias_restantes"]] == list(range(1, len(fila) + 1))
    assert doc["totais"]["pendencias_restantes"] == {"valor": len(fila), "de": cx.execute("select count(*) as n from adm_pendencias where status = 'aberta'").fetchone()["n"]}


def test_totais_com_denominador_batem_com_o_banco(cx, seq):
    doc = CAND.candidata(cx)
    t = doc["totais"]
    n_campos = cx.execute("select count(*) as n from (select distinct classe, registro_chave, campo from adm_propostas) x").fetchone()["n"]
    assert t["campos_com_proposta"] == {"valor": n_campos, "de": n_campos} and n_campos == 6  # PB, AM, AC, RO, PI e a cobertura de RO
    assert t["diferencas"] == {"valor": 5, "de": n_campos} and t["aplicadas"] == {"valor": 2, "de": n_campos}
    assert t["pendentes"] == {"valor": 1, "de": 5} and t["conflitantes"] == {"valor": 1, "de": 5}
    assert t["decididas_nao_aplicadas"] == {"valor": 1, "de": 5} and t["descartadas"] == {"valor": 1, "de": 5}
    assert len(doc["diferencas"]) == 5 and len(doc["aplicadas"]) == 2
    # todo campo com proposta ou está em `diferencas`, ou não tem diferença (confirmado pela fonte, ou resolvido por decisão): a conta fecha
    assert len(doc["diferencas"]) + t["confirmados_pela_fonte"]["valor"] + t["sem_diferenca_por_decisao"]["valor"] == n_campos and t["sem_diferenca_por_decisao"]["valor"] == 1  # AC


def test_escopo_por_rodada_e_marca_simulado(cx, seq):
    ids = seq["ids"]
    d2 = CAND.candidata(cx, [seq["rid2"]])
    assert d2["simulado"] == ["v2"] and d2["escopo"]["rodadas"] == [seq["rid2"]]
    assert {(d["registro_chave"], d["campo"]) for d in d2["diferencas"]} == {(ids["PB"], "status"), (ids["AM"], "status")}  # só as propostas da rodada
    assert {(a["registro_chave"]) for a in d2["aplicadas"]} == {ids["PB"]}
    assert d2["totais"]["campos_com_proposta"] == {"valor": 2, "de": 2} and d2["totais"]["pendentes"] == {"valor": 1, "de": 2}
    assert {(p["registro_chave"], p["campo"]) for p in d2["pendencias_restantes"]} == {(ids["AM"], "status")}
    assert "SIMULADO" in CAND.texto_candidata(d2).splitlines()[0]
    # a rodada v1 não é simulada e não teve proposta
    d1 = CAND.candidata(cx, [seq["rid1"]])
    assert d1["simulado"] is None and d1["diferencas"] == [] and d1["aplicadas"] == [] and d1["pendencias_restantes"] == [] and d1["mensagem"]
    assert d1["totais"]["campos_com_proposta"] == {"valor": 0, "de": 0}
    assert "SIMULADO" not in CAND.texto_candidata(d1)
    # sem filtro, as duas rodadas estão envolvidas e a marca vem da que é simulada
    tudo = CAND.candidata(cx)
    assert tudo["simulado"] == ["v2"] and tudo["escopo"]["todas_as_rodadas"] is True and tudo["escopo"]["rodadas_envolvidas"] == 2
    # duas rodadas repetidas no filtro contam uma vez
    assert CAND.candidata(cx, [seq["rid2"], seq["rid2"]])["escopo"]["rodadas"] == [seq["rid2"]]


def test_ordenacao_por_classe_e_chave_e_nunca_por_pessoa(cx, seq):
    doc = CAND.candidata(cx)
    ordem = [(d["classe"], d["registro_chave"], d["campo"]) for d in doc["diferencas"]]
    assert [c for c, _, _ in ordem] == ["vinculo_sapl"] * 4 + ["cobertura"]  # classe na ordem fixa
    chaves = [int(k) for c, k, _ in ordem if c == "vinculo_sapl"]
    assert chaves == sorted(chaves)  # chave numérica em ordem numérica
    fonte = Path(CAND.__file__).read_text(encoding="utf-8").lower()
    ordenacoes = [l for l in fonte.splitlines() if "sorted(" in l or ".sort(" in l]
    assert ordenacoes and not any(w in l for l in ordenacoes for w in ("person", "pessoa", "partido", "party", "popular", "nome"))


def test_so_leitura_nada_e_gravado(cx, seq):
    antes = {t: cx.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in ("adm_propostas", "adm_pendencias", "adm_decisoes", "adm_overrides", "sapl_houses", "data_coverage", "corrections")}
    CAND.candidata(cx)
    CAND.candidata(cx, [seq["rid1"]])
    assert {t: cx.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in antes} == antes


def test_cli_json_tabela_e_codigos(cx, seq, capsys):
    capsys.readouterr()
    rc = cli.main(["admin", "candidata", "--json"])
    out = capsys.readouterr()
    doc = json.loads(out.out)
    assert rc == 0 and doc["simulado"] == ["v2"] and len(doc["diferencas"]) == 5 and len(doc["aplicadas"]) == 2 and doc["totais"]["diferencas"] == {"valor": 5, "de": 6}
    assert out.out.lstrip().startswith("{")  # o JSON é o único conteúdo do stdout
    rc = cli.main(["admin", "candidata", "--rodada", seq["rid2"], "--json"])
    d2 = json.loads(capsys.readouterr().out)
    assert rc == 0 and d2["escopo"]["rodadas"] == [seq["rid2"]] and d2["totais"]["campos_com_proposta"]["valor"] == 2
    rc = cli.main(["admin", "candidata"])
    txt = capsys.readouterr().out
    assert rc == 0 and txt.splitlines()[0].startswith("SIMULADO:") and "diferenças em relação à base vigente" in txt and "pendências restantes" in txt and "aplicadas" in txt
    # rodada inexistente: código 1, mensagem em stderr, nada em stdout
    rc = cli.main(["admin", "candidata", "--rodada", "00000000-0000-0000-0000-000000000000"])
    out = capsys.readouterr()
    assert rc == 1 and out.out == "" and "rodada inexistente" in out.err and "Traceback" not in out.err
    rc = cli.main(["admin", "candidata", "--rodada", "nao-e-uuid", "--json"])
    out = capsys.readouterr()
    assert rc == 1 and out.out == "" and "inválido" in out.err
    # o argumento é repetível e um id inexistente entre os válidos também dá 1
    rc = cli.main(["admin", "candidata", "--rodada", seq["rid2"], "--rodada", "00000000-0000-0000-0000-000000000000"])
    assert rc == 1 and capsys.readouterr().out == ""


def test_banco_sem_proposta_devolve_zeros_conhecidos(cx, capsys):
    doc = CAND.candidata(cx)
    assert doc["diferencas"] == [] and doc["aplicadas"] == [] and doc["simulado"] is None and doc["mensagem"]
    assert doc["totais"]["campos_com_proposta"] == {"valor": 0, "de": 0} and doc["totais"]["pendencias_restantes"] == {"valor": 0, "de": 0}
    assert "nenhuma proposta registrada" in CAND.texto_candidata(doc)
