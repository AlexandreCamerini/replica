"""FABRICADO. A6: relatório de rodada (`admin.relatorio`): estado da coleta separado do estado da revisão, denominador em todo total, ids por trás de cada total.

Sem rede, sem skip. A rodada de verdade roda EM PROCESSO sobre o transporte fabricado do SAPL (cenário `v1`, como em test_admin_rodada.py). Propostas,
pendências, decisões e vínculos são fabricados direto nas tabelas `adm_*` DENTRO da transação da conexão `cx` (banco isolado) e revertidos no fim, sem
commit: o gatilho de `adm_decisoes` proíbe apagar decisão, então nada disso pode ser comitado. Nada é gravado no banco da suíte (contagens antes/depois).
"""

from __future__ import annotations

import json
import re
import uuid
from types import SimpleNamespace
from typing import Any

import admin_fixtures as AF
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from test_admin_rodada import limpar_adm

from civico_etl import cli
from civico_etl.admin import relatorio as REL
from civico_etl.admin import rodadas as R
from civico_etl.admin.saida import ErroAdmin, para_json
from civico_etl.catalogo import contrato
from civico_etl.catalogo.contrato import Recorte

SUITE = ("adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "adm_propostas", "adm_pendencias", "adm_pendencia_propostas", "adm_decisoes",
         "adm_overrides", "sapl_houses", "ingest_runs", "dataset_stamps", "sources")
HOST = AF.ALE_HOSTS
API = {uf: f"{HOST[uf]}/api/" for uf in AF.UFS}
ROBOTS = {uf: f"{HOST[uf]}/robots.txt" for uf in AF.UFS}
SHA = "a" * 64


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
    """Nada deste módulo grava no banco da suíte: as contagens de antes e depois são iguais."""
    def conta():
        return {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}

    antes = conta()
    yield
    assert conta() == antes


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module")
def mundo(banco_isolado, tmp_path_factory):  # noqa: F811
    """Uma carga só por módulo: rodada real v1 (cinco UFs; executada com ADMIN_SIMULADO=v1), sua repetição (sem a variável) e uma rodada só com RO, AC e AM.
    Tudo comitado no banco isolado e desfeito no fim; cada teste fabrica o que precisa dentro de uma transação que reverte."""
    url = banco_isolado
    mp = pytest.MonkeyPatch()
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        mp.setenv(k, url)
    mp.setenv("ADMIN_RUNNER", "processo")
    for k in ("ETL_INVOCATION", "ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH", "ADMIN_RODADA_TIMEOUT_S", "ADMIN_SIMULADO"):
        mp.delenv(k, raising=False)

    def sem_subprocesso(*a, **k):
        raise AssertionError("runner_subprocesso chamado: o coletor iria à rede de verdade")

    mp.setattr(contrato, "runner_subprocesso", sem_subprocesso)
    limpar_adm(url)
    AF.limpar_base(url)
    AF.carregar_base(url)
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    try:
        cache = tmp_path_factory.mktemp("cache") / "cache"
        t = AF.instalar(mp, "v1", cache)
        mp.setenv("ADMIN_SIMULADO", "v1")  # a marca é gravada pela execução
        rid = R.abrir(c, "sapl.assembleias", Recorte(ufs=AF.UFS), modo="recoletar")
        c.commit()
        res = R.executar(c, rid)
        mp.delenv("ADMIN_SIMULADO")
        assert res["status"] == "concluida" and t.nao_previstos == []
        original = json.loads(para_json(REL.relatorio(c, rid)))
        rep = R.repetir(c, rid)
        assert rep["status"] == "concluida" and t.nao_previstos == []
        t = AF.instalar(mp, "v1", tmp_path_factory.mktemp("cache3") / "cache")  # cache vazio: a leitura é de verdade (lida), não reaproveitada
        rid3 = R.abrir(c, "sapl.assembleias", Recorte(ufs=("RO", "AC", "AM")), modo="recoletar")
        c.commit()
        assert R.executar(c, rid3)["status"] == "concluida" and t.nao_previstos == []
        yield SimpleNamespace(url=url, rid=rid, rid2=rep["rodada_id"], rid3=rid3, original=original)
    finally:
        c.rollback()
        c.close()
        limpar_adm(url)
        AF.limpar_base(url)
        mp.undo()


@pytest.fixture
def cx(mundo):
    """Conexão do teste: o que ele fabrica vive nesta transação e é revertido (o gatilho de adm_decisoes proíbe apagar decisão)."""
    c = psycopg.connect(mundo.url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    try:
        yield c
    finally:
        c.rollback()
        c.close()


# ------------------------------------------------------------------ apoio


def sha_de(url: str) -> str:
    from civico_etl.util import sha256_text
    return sha256_text(url)


def casas(cx) -> dict[str, str]:
    """uf -> id (texto) da casa em sapl_houses."""
    return {r["uf"]: str(r["id"]) for r in cx.execute("select h.id, p.uf from sapl_houses h join places p on p.id = h.place_id").fetchall()}


class Fab:
    """Fabrica propostas, pendências e decisões no banco isolado (na transação de `cx`)."""

    def __init__(self, cx, rid: str):
        self.cx, self.rid, self.n = cx, rid, 0

    def outra_rodada(self) -> str:
        return str(self.cx.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"])

    def proposta(self, classe: str, chave: str, campo: str, vigente: Any, candidato: Any, *, rodada: str | None, fonte: str = "sapl-ale") -> str:
        self.n += 1
        return str(self.cx.execute(
            "insert into adm_propostas (classe, registro_chave, campo, valor_vigente, valor_candidato, url, trecho, conteudo_sha256, fonte_slug, rodada_id, chave_idem) "
            "values (%s, %s, %s, %s, %s, 'https://exemplo.invalid/p', 'trecho', %s, %s, %s, %s) returning id",
            (classe, chave, campo, None if vigente is None else Jsonb(vigente), Jsonb(candidato), SHA, fonte, rodada, f"fab-{uuid.uuid4()}")).fetchone()["id"])

    def pendencia(self, classe: str, chave: str, campo: str, tipo: str, propostas: list[str], *, status: str = "aberta", reaberta: bool = False) -> str:
        pid = str(self.cx.execute(
            "insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo, status, reaberta, motivo_reabertura) values (%s, %s, %s, 'pergunta?', %s, %s, %s, %s) returning id",
            (classe, chave, campo, tipo, status, reaberta, "evidencia_mudou" if reaberta else None)).fetchone()["id"])
        for p in propostas:
            self.cx.execute("insert into adm_pendencia_propostas (pendencia_id, proposta_id) values (%s, %s)", (pid, p))
        return pid

    def decisao(self, pendencia: str, acao: str, *, por: str = "pessoa", aplicada: bool = False) -> str:
        if por == "pessoa":
            did = self.cx.execute("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa) values (%s, %s, 'pessoa', 'Fulana de Tal', 'j') returning id", (pendencia, acao)).fetchone()["id"]
        else:
            did = self.cx.execute("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, relatorio, versao_verificador, justificativa) values (%s, %s, 'agentes', '{}'::jsonb, 1, 'j') returning id", (pendencia, acao)).fetchone()["id"]
        if aplicada:
            self.cx.execute("update adm_decisoes set aplicada = true, aplicada_em = now() where id = %s", (did,))
        return str(did)


def cenario_revisao(cx, rid: str) -> dict[str, Any]:
    """Cobre todos os ramos da revisão sobre a rodada `rid`. Devolve os ids esperados por total."""
    c = casas(cx)
    h1, h2, h3, h4, h5 = (c[u] for u in ("RO", "AC", "AM", "PI", "PB"))
    f = Fab(cx, rid)
    outra = f.outra_rodada()
    # A: a fonte confirmou o vigente, sem pendência
    f.proposta("vinculo_sapl", h1, "base_url", "https://a.invalid", "https://a.invalid", rodada=rid)
    # B: pendência `mudanca` aberta; decisão corrigir NÃO aplicada
    pb = f.proposta("vinculo_sapl", h2, "status", "ok", "fora", rodada=rid)
    pend_b = f.pendencia("vinculo_sapl", h2, "status", "mudanca", [pb])
    d_b = f.decisao(pend_b, "corrigir")
    # C: divergência aberta, duas propostas de fontes diferentes; decisão de agentes não aplicada
    pc1 = f.proposta("vinculo_sapl", h3, "base_url", "https://c.invalid", "https://c1.invalid", rodada=rid, fonte="sapl-ale")
    pc2 = f.proposta("vinculo_sapl", h3, "base_url", "https://c.invalid", "https://c2.invalid", rodada=rid, fonte="curadoria")
    pend_c = f.pendencia("vinculo_sapl", h3, "base_url", "divergencia", [pc1, pc2])
    d_c = f.decisao(pend_c, "pedir_confirmacao", por="agentes")
    # D: pendência decidida por aprovar, aplicada
    pd = f.proposta("vinculo_sapl", h4, "base_url", "https://d.invalid", "https://d2.invalid", rodada=rid)
    pend_d = f.pendencia("vinculo_sapl", h4, "base_url", "mudanca", [pd], status="decidida")
    d_d = f.decisao(pend_d, "aprovar", aplicada=True)
    # E: pendência decidida por descartar (não aplicada)
    pe = f.proposta("vinculo_sapl", h5, "status", "ok", "fora", rodada=rid)
    pend_e = f.pendencia("vinculo_sapl", h5, "status", "mudanca", [pe], status="decidida")
    d_e = f.decisao(pend_e, "descartar")
    # F: pendência reaberta
    pf = f.proposta("cobertura", "11:presenca", "status", "ok", "parcial", rodada=rid)
    f.pendencia("cobertura", "11:presenca", "status", "confirmacao", [pf], reaberta=True)
    # H: sem pendência e a proposta não confirma o vigente
    f.proposta("vinculo_sapl", h2, "base_url", "https://h.invalid", "https://h2.invalid", rodada=rid)
    # G: proposta, pendência e decisão de OUTRA rodada: não podem entrar
    pg = f.proposta("contato_mandato", "999", "email:x@y.invalid", None, "x@y.invalid", rodada=outra)
    pend_g = f.pendencia("contato_mandato", "999", "email:x@y.invalid", "mudanca", [pg], status="decidida")
    f.decisao(pend_g, "aprovar", aplicada=True)
    # proposta sem rodada (rodada_id nulo) também não entra
    f.proposta("contato_mandato", "998", "email:z@y.invalid", None, "z@y.invalid", rodada=None)
    return {
        "campos": sorted([f"vinculo_sapl:{h1}:base_url", f"vinculo_sapl:{h2}:status", f"vinculo_sapl:{h3}:base_url", f"vinculo_sapl:{h4}:base_url", f"vinculo_sapl:{h5}:status",
                          "cobertura:11:presenca:status", f"vinculo_sapl:{h2}:base_url"]),
        "conflitantes": [f"vinculo_sapl:{h3}:base_url"],
        "pendentes": sorted([f"vinculo_sapl:{h2}:status", "cobertura:11:presenca:status", f"vinculo_sapl:{h2}:base_url"]),
        "sem_pendencia": [f"vinculo_sapl:{h2}:base_url"],
        "pela_fonte": [f"vinculo_sapl:{h1}:base_url"],
        "por_decisao": sorted([f"vinculo_sapl:{h4}:base_url", f"vinculo_sapl:{h5}:status"]),
        "reabertas": ["cobertura:11:presenca:status"],
        "registros": sorted([f"vinculo_sapl:{h}" for h in (h1, h2, h3, h4, h5)] + ["cobertura:11:presenca"]),
        "alterados": [f"vinculo_sapl:{h4}"],
        "decisoes": sorted([d_b, d_c, d_d, d_e]),
        "aplicadas": [d_d],
        "pendencias": sorted([pend_b, pend_c, pend_d, pend_e, str(cx.execute("select id from adm_pendencias where classe = 'cobertura'").fetchone()["id"])]),
        "d": {"corrigir": d_b, "pedir_confirmacao": d_c, "aprovar": d_d, "descartar": d_e},
    }


def sem_soma(doc: dict[str, Any]) -> None:
    """Dois painéis, nada que os una: três chaves de primeiro nível e nenhum identificador da coleta dentro da revisão (nem o contrário)."""
    assert set(doc) == {"simulado", "rodada", "coleta", "revisao"}
    assert not {"urls_tentadas", "urls_lidas", "campos_com_proposta", "total", "geral"} & (set(doc) | set(doc["rodada"]))
    assert "url_sha" not in json.dumps(doc["revisao"], default=str)
    assert "campos_com_proposta" not in json.dumps(doc["coleta"], default=str)


# ------------------------------------------------------------------ 1: rodada real, sem revisão


def test_1_rodada_real_painel_coleta_e_revisao_vazia(mundo, cx, monkeypatch):
    rid = mundo.rid
    antes = {tb: cx.execute(f"select count(*) as n from {tb}").fetchone()["n"] for tb in SUITE}
    doc = REL.relatorio(cx, rid)
    assert {tb: cx.execute(f"select count(*) as n from {tb}").fetchone()["n"] for tb in SUITE} == antes  # só leitura
    sem_soma(doc)
    c, v = doc["coleta"], doc["revisao"]
    assert doc["rodada"]["id"] == rid and doc["rodada"]["coletor"] == "sapl.assembleias" and doc["rodada"]["modo"] == "recoletar" and doc["rodada"]["status"] == "concluida"
    assert doc["rodada"]["repete_id"] is None and doc["rodada"]["finalizada_em"] is not None and doc["simulado"] == "v1"
    distintas = cx.execute("select count(distinct url_sha) as n from adm_tentativas where rodada_id = %s", (rid,)).fetchone()["n"]
    assert c["urls_tentadas"]["valor"] == c["urls_tentadas"]["de"] == distintas > 20
    assert [i["url_sha"] for i in c["urls_tentadas"]["ids"]] == sorted(i["url_sha"] for i in c["urls_tentadas"]["ids"])
    # as três classes são disjuntas e somam as tentadas; o denominador é o mesmo
    l, rp, fl = c["urls_lidas"], c["urls_reaproveitadas"], c["urls_com_falha"]
    assert (l["de"], rp["de"], fl["de"]) == (distintas,) * 3 and l["valor"] + rp["valor"] + fl["valor"] == distintas and rp["valor"] == 0
    assert {i["url"] for i in fl["ids"]} == {API["PB"], API["PI"]} and fl["valor"] == 2
    assert {m: x["valor"] for m, x in fl["por_motivo"].items()} == {"bloqueio": 0, "robots": 1, "expiracao": 0, "erro": 1, "sem_conteudo": 0}
    assert [i["url"] for i in fl["por_motivo"]["erro"]["ids"]] == [API["PB"]] and [i["url"] for i in fl["por_motivo"]["robots"]["ids"]] == [API["PI"]]
    assert all(x["de"] == 2 for x in fl["por_motivo"].values())
    assert all(i["url_sha"] == sha_de(i["url"]) for i in c["urls_tentadas"]["ids"])
    # URLs de entrada: 10 declaradas, 10 tentadas, nenhuma declarada sem tentativa
    ue = c["urls_entrada"]
    assert (ue["declaradas"]["valor"], ue["declaradas"]["de"]) == (10, 10) and (ue["tentadas"]["valor"], ue["tentadas"]["de"]) == (10, 10)
    assert (ue["declaradas_nao_tentadas"]["valor"], ue["declaradas_nao_tentadas"]["de"], ue["declaradas_nao_tentadas"]["ids"]) == (0, 10, [])
    assert {i["url"] for i in ue["tentadas"]["ids"]} == set(API.values()) | set(ROBOTS.values()) and ue["tentadas"]["ids"] == ue["declaradas"]["ids"]
    # registros: cinco elegíveis (casas criadas durante a rodada: a prévia as tinha sem chave); RO, AC e AM têm URL lida sob a base (/api/ e páginas seguidas;
    # o robots.txt não conta); PI e PB só têm falha sob a base
    h = casas(cx)
    el = c["registros_elegiveis"]
    assert (el["valor"], el["de"]) == (5, 5) and el["ids"] == sorted(f"vinculo_sapl:{x}" for x in h.values())
    ra = c["registros_alcancados"]
    assert (ra["valor"], ra["de"], ra["ids"]) == (3, 5, sorted(f"vinculo_sapl:{h[u]}" for u in ("RO", "AC", "AM")))
    na = c["registros_elegiveis_nao_alcancados"]
    assert (na["valor"], na["de"], na["ids"]) == (2, 5, sorted(f"vinculo_sapl:{h[u]}" for u in ("PI", "PB")))
    por_uf = {i["id"]: i for i in na["itens"]}
    assert por_uf[f"vinculo_sapl:{h['PI']}"]["motivo_falha"] == "robots" and por_uf[f"vinculo_sapl:{h['PB']}"]["motivo_falha"] == "erro"
    assert all("no_mesmo_host" not in i and "nenhuma lida" in i["situacao"] for i in na["itens"])
    # revisão: nenhuma proposta, e isso é zero conhecido (não desconhecido)
    assert v["mensagem"] == "nenhuma proposta registrada nesta rodada"
    for k in ("campos_com_proposta", "conflitantes", "pendentes", "confirmados", "pendencias_reabertas", "registros_alterados", "decisoes"):
        assert (v[k]["valor"], v[k]["ids"]) == (0, []) and v[k]["de"] is not None, k
    assert v["campos_com_proposta"]["de"] == 0 and v["registros_alterados"]["de"] == 0
    assert "nenhuma proposta registrada nesta rodada" in REL.texto_relatorio(doc)


def test_1b_regra_de_alcance(mundo, cx):
    """Vínculos fabricados (na transação): base com barra final, prefixo que não é de caminho, só robots.txt, igualdade com URL que falhou, não vigente e outra classe."""
    rid = mundo.rid
    h = casas(cx)

    def vinc(uf: str, url: str, vigente: bool = True) -> None:
        cx.execute("update adm_vinculos set vigente = false where classe = 'vinculo_sapl' and registro_chave = %s", (h[uf],))
        cx.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem, vigente) values ('vinculo_sapl', %s, %s, %s, 'registro_oficial', %s)", (h[uf], url, sha_de(url), vigente))

    vinc("AM", HOST["AM"] + "/")                 # base com barra final: casa por prefixo (b) com a normalização
    vinc("RO", HOST["RO"] + "/ap")               # "/ap" não é prefixo de caminho de "/api/": não casa
    vinc("AC", ROBOTS["AC"])                     # só o robots.txt (igualdade): ler o robots não alcança o registro
    vinc("PB", API["PB"])                        # igualdade exata (a), mas a URL falhou
    vinc("PI", API["PI"], vigente=False)         # sem vínculo vigente (o de base ficou desativado)
    cx.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem, vigente) values ('cobertura', '11:presenca', %s, %s, 'descoberta_automatica', true)", (API["RO"], sha_de(API["RO"])))
    c = REL.relatorio(cx, rid)["coleta"]
    assert (c["registros_alcancados"]["valor"], c["registros_alcancados"]["de"], c["registros_alcancados"]["ids"]) == (1, 5, [f"vinculo_sapl:{h['AM']}"])  # cobertura não é elegível
    por = {i["id"]: i for i in c["registros_elegiveis_nao_alcancados"]["itens"]}
    assert c["registros_elegiveis_nao_alcancados"]["valor"] == 4 and set(por) == {f"vinculo_sapl:{h[u]}" for u in ("RO", "AC", "PI", "PB")}
    assert por[f"vinculo_sapl:{h['PB']}"]["motivo_falha"] == "erro" and "nenhuma lida" in por[f"vinculo_sapl:{h['PB']}"]["situacao"]
    assert por[f"vinculo_sapl:{h['RO']}"]["situacao"] == por[f"vinculo_sapl:{h['AC']}"]["situacao"] == "nenhuma URL do registro foi tentada nesta rodada"
    assert por[f"vinculo_sapl:{h['RO']}"]["motivo_falha"] is None and por[f"vinculo_sapl:{h['AC']}"]["motivo_falha"] is None
    assert por[f"vinculo_sapl:{h['PI']}"]["situacao"] == "sem vínculo vigente com URL"


# ------------------------------------------------------------------ 2: todos os ramos da revisão


def test_2_revisao_todos_os_ramos(mundo, cx, monkeypatch):
    rid = mundo.rid
    e = cenario_revisao(cx, rid)
    doc = REL.relatorio(cx, rid)
    sem_soma(doc)
    v = doc["revisao"]
    assert v["mensagem"] is None
    assert (v["campos_com_proposta"]["valor"], v["campos_com_proposta"]["de"], v["campos_com_proposta"]["ids"]) == (7, 7, e["campos"])
    assert (v["conflitantes"]["valor"], v["conflitantes"]["de"], v["conflitantes"]["ids"]) == (1, 7, e["conflitantes"])
    assert (v["pendentes"]["valor"], v["pendentes"]["de"], v["pendentes"]["ids"]) == (3, 7, e["pendentes"])
    assert (v["pendentes"]["sem_pendencia_aberta"]["valor"], v["pendentes"]["sem_pendencia_aberta"]["ids"]) == (1, e["sem_pendencia"])
    cf = v["confirmados"]
    assert (cf["valor"], cf["de"]) == (3, 7) and cf["ids"] == sorted(e["pela_fonte"] + e["por_decisao"])
    assert (cf["pela_fonte"]["valor"], cf["pela_fonte"]["de"], cf["pela_fonte"]["ids"]) == (1, 7, e["pela_fonte"])
    assert (cf["por_decisao"]["valor"], cf["por_decisao"]["de"], cf["por_decisao"]["ids"]) == (2, 7, e["por_decisao"])
    # confirmados + conflitantes + pendentes = campos com proposta, e as listas são disjuntas
    assert cf["valor"] + v["conflitantes"]["valor"] + v["pendentes"]["valor"] == v["campos_com_proposta"]["valor"]
    assert sorted(cf["ids"] + v["conflitantes"]["ids"] + v["pendentes"]["ids"]) == v["campos_com_proposta"]["ids"]
    # reabertas: das conflitantes e pendentes (1 + 3 = 4)
    ra = v["pendencias_reabertas"]
    assert (ra["valor"], ra["de"], ra["ids"]) == (1, 4, e["reabertas"]) and ra["por_motivo"]["evidencia_mudou"]["ids"] == e["reabertas"] and ra["por_motivo"]["evidencia_mudou"]["de"] == 4
    # registros: só a decisão aprovar aplicada altera (corrigir não aplicada, descartar e pedir_confirmacao não)
    assert (v["registros_com_proposta"]["valor"], v["registros_com_proposta"]["ids"]) == (6, e["registros"])
    assert (v["registros_alterados"]["valor"], v["registros_alterados"]["de"], v["registros_alterados"]["ids"]) == (1, 6, e["alterados"])
    # decisões da rodada (a de G, de outra rodada, fica de fora), por ação, por tipo e por aplicação
    d = v["decisoes"]
    assert (d["valor"], d["de"], d["ids"]) == (4, 5, e["decisoes"]) and v["pendencias_ligadas"]["ids"] == e["pendencias"]
    assert {k: (x["valor"], x["de"], x["ids"]) for k, x in d["por_acao"].items()} == {k: (1, 4, [i]) for k, i in e["d"].items()}
    assert {k: x["valor"] for k, x in d["por_decidido_por_tipo"].items()} == {"pessoa": 3, "agentes": 1} and all(x["de"] == 4 for x in d["por_decidido_por_tipo"].values())
    assert (d["aplicadas"]["valor"], d["aplicadas"]["de"], d["aplicadas"]["ids"]) == (1, 4, e["aplicadas"])
    assert (d["nao_aplicadas"]["valor"], d["nao_aplicadas"]["ids"]) == (3, sorted(set(e["decisoes"]) - set(e["aplicadas"])))
    # a coleta não se mexe com a revisão
    assert doc["coleta"] == REL.relatorio(cx, rid)["coleta"] and doc["coleta"]["urls_tentadas"]["valor"] > 0
    txt = REL.texto_relatorio(doc)
    assert "Campos com proposta" in txt and "7 de 7" in txt and "1 de 6" in txt and "1 de 4" in txt and "sem pendência aberta" in txt
    print("\n" + txt)


# ------------------------------------------------------------------ 3: leitura 100% e revisão 0 confirmados


def test_3_leitura_perfeita_e_todos_os_campos_pendentes(mundo, cx, monkeypatch):
    rid = mundo.rid3
    h = casas(cx)
    f = Fab(cx, rid)
    for uf in ("RO", "AC", "AM"):
        for campo in ("base_url", "status"):
            p = f.proposta("vinculo_sapl", h[uf], campo, "x", "y", rodada=rid)
            f.pendencia("vinculo_sapl", h[uf], campo, "mudanca", [p])
    doc = REL.relatorio(cx, rid)
    sem_soma(doc)
    c, v = doc["coleta"], doc["revisao"]
    n = c["urls_tentadas"]["valor"]
    assert n > 0 and (c["urls_lidas"]["valor"], c["urls_lidas"]["de"]) == (n, n) and c["urls_com_falha"]["valor"] == 0 and c["urls_reaproveitadas"]["valor"] == 0
    assert (c["urls_entrada"]["tentadas"]["valor"], c["urls_entrada"]["tentadas"]["de"]) == (6, 6)
    assert (c["registros_alcancados"]["valor"], c["registros_alcancados"]["de"]) == (3, 3) and c["registros_elegiveis_nao_alcancados"]["valor"] == 0
    assert (v["campos_com_proposta"]["valor"], v["pendentes"]["valor"], v["pendentes"]["de"]) == (6, 6, 6)
    assert (v["confirmados"]["valor"], v["confirmados"]["de"], v["confirmados"]["ids"]) == (0, 6, []) and v["conflitantes"]["valor"] == 0 and v["registros_alterados"]["valor"] == 0
    txt = REL.texto_relatorio(doc)
    cab_c, cab_r = txt.index("COLETA"), txt.index("REVISÃO")
    assert cab_c < cab_r and f"{n} de {n}" in txt[cab_c:cab_r]
    assert "6 de 6" in txt[cab_r:] and "0 de 6" in txt[cab_r:]  # pendentes 6 de 6; confirmados 0 de 6
    # nenhum número da revisão aparece como soma da coleta: o relatório não tem total que junte os dois
    assert "geral" not in json.dumps(doc, default=str).lower() and "total" not in json.dumps(doc, default=str)


# ------------------------------------------------------------------ 4: repetição


def test_4_repeticao_tem_relatorio_proprio(mundo, cx, monkeypatch):
    rid, rid2 = mundo.rid, mundo.rid2
    d2 = REL.relatorio(cx, rid2)
    assert json.loads(para_json(REL.relatorio(cx, rid))) == mundo.original  # o da original não mudou depois da repetição
    assert d2["rodada"]["id"] == rid2 and d2["rodada"]["repete_id"] == rid
    c1, c2 = mundo.original["coleta"], d2["coleta"]
    n = c2["urls_tentadas"]["valor"]
    assert c2["urls_lidas"]["valor"] == 0 and c2["urls_reaproveitadas"]["valor"] > 0 and c1["urls_lidas"]["valor"] > 0 and c1["urls_reaproveitadas"]["valor"] == 0
    assert c2["urls_lidas"]["valor"] + c2["urls_reaproveitadas"]["valor"] + c2["urls_com_falha"]["valor"] == n == c2["urls_tentadas"]["de"]
    assert {i["url"] for i in c2["urls_com_falha"]["ids"]} == {API["PB"], API["PI"]}  # as duas continuam falhando
    assert (c2["urls_entrada"]["declaradas"]["valor"], c2["urls_entrada"]["tentadas"]["valor"]) == (10, 10)
    # na repetição as casas já existem: a prévia traz a chave de cada uma; o alcance repete o da original (reaproveitada conta como alcançada)
    prev = cx.execute("select previa from adm_rodadas where id = %s", (rid2,)).fetchone()["previa"]
    assert all(x["sapl_houses_id"] is not None for x in prev["registros_elegiveis"]["chaves"]) and c2["registros_elegiveis"]["ids"] == c1["registros_elegiveis"]["ids"]
    assert c2["registros_alcancados"]["ids"] == c1["registros_alcancados"]["ids"] and c2["registros_alcancados"]["valor"] == 3


def test_4b_marca_simulado(mundo, cx, monkeypatch, capsys):
    """Rodada executada com ADMIN_SIMULADO marcada; a repetição, sem a variável, não. O relatório lê a marca da rodada, não do ambiente de quem consulta."""
    marcada, limpa = REL.relatorio(cx, mundo.rid), REL.relatorio(cx, mundo.rid2)
    pv = cx.execute("select previa from adm_rodadas where id = %s", (mundo.rid,)).fetchone()["previa"]
    assert pv["resultado"]["simulado"] == "v1" and [e["simulado"] for e in pv["execucoes"]] == ["v1"]
    assert marcada["simulado"] == "v1" and limpa["simulado"] is None
    assert REL.texto_relatorio(marcada).startswith("SIMULADO: respostas fabricadas (cenário v1); nenhum número abaixo foi lido da fonte\n")
    assert "SIMULADO" not in REL.texto_relatorio(limpa)
    monkeypatch.setenv("ADMIN_SIMULADO", "outro")  # ambiente de quem consulta não conta
    assert REL.relatorio(cx, mundo.rid2)["simulado"] is None and REL.relatorio(cx, mundo.rid)["simulado"] == "v1"
    capsys.readouterr()
    assert cli.main(["admin", "relatorio", mundo.rid, "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["simulado"] == "v1"
    assert cli.main(["admin", "relatorio", mundo.rid2]) == 0
    assert "SIMULADO" not in capsys.readouterr().out
    # rodada sem o campo (antiga): nulo, sem aviso
    antiga = str(cx.execute("insert into adm_rodadas (coletor, modo, status, previa) values ('sapl.assembleias', 'recoletar', 'concluida', %s) returning id", (Jsonb({"resultado": {"status": "concluida"}}),)).fetchone()["id"])
    assert REL.relatorio(cx, antiga)["simulado"] is None


# ------------------------------------------------------------------ 5: cada consulta roda sozinha e bate com o valor


def test_5_consultas_sql_reusaveis(mundo, cx, monkeypatch):
    rid = mundo.rid
    cenario_revisao(cx, rid)
    h = casas(cx)
    cx.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem, vigente) values ('vinculo_sapl', %s, %s, %s, 'registro_oficial', true)", (h["RO"], API["RO"], sha_de(API["RO"])))
    doc = REL.relatorio(cx, rid)
    c, v = doc["coleta"], doc["revisao"]
    esperado = {
        "SQL_URLS_TENTADAS": c["urls_tentadas"], "SQL_URLS_LIDAS": c["urls_lidas"], "SQL_URLS_REAPROVEITADAS": c["urls_reaproveitadas"], "SQL_URLS_COM_FALHA": c["urls_com_falha"],
        "SQL_URLS_ENTRADA_DECLARADAS": c["urls_entrada"]["declaradas"], "SQL_URLS_ENTRADA_TENTADAS": c["urls_entrada"]["tentadas"],
        "SQL_URLS_ENTRADA_NAO_TENTADAS": c["urls_entrada"]["declaradas_nao_tentadas"], "SQL_REGISTROS_ELEGIVEIS": c["registros_elegiveis"],
        "SQL_REGISTROS_ALCANCADOS": c["registros_alcancados"], "SQL_REGISTROS_NAO_ALCANCADOS": c["registros_elegiveis_nao_alcancados"],
        "SQL_CAMPOS_COM_PROPOSTA": v["campos_com_proposta"], "SQL_CAMPOS_SITUACAO": v["campos_com_proposta"], "SQL_CAMPOS_CONFLITANTES": v["conflitantes"],
        "SQL_CAMPOS_PENDENTES": v["pendentes"], "SQL_CAMPOS_SEM_PENDENCIA": v["pendentes"]["sem_pendencia_aberta"],
        "SQL_CAMPOS_CONFIRMADOS_PELA_FONTE": v["confirmados"]["pela_fonte"], "SQL_CAMPOS_CONFIRMADOS_POR_DECISAO": v["confirmados"]["por_decisao"],
        "SQL_PENDENCIAS_REABERTAS": v["pendencias_reabertas"], "SQL_REGISTROS_COM_PROPOSTA": v["registros_com_proposta"], "SQL_REGISTROS_ALTERADOS": v["registros_alterados"],
        "SQL_PENDENCIAS_LIGADAS": v["pendencias_ligadas"], "SQL_DECISOES": v["decisoes"],
    }
    assert set(esperado) == set(REL.CONSULTAS), set(esperado) ^ set(REL.CONSULTAS)  # constante nova sem teste não passa
    for nome, total in esperado.items():
        linhas = cx.execute(REL.CONSULTAS[nome], {"rodada": rid}).fetchall()
        assert len(linhas) == total["valor"], nome
        assert "%(rodada)s" in REL.CONSULTAS[nome] and "search_path" not in REL.CONSULTAS[nome]
    assert c["registros_alcancados"]["valor"] == 3 and v["campos_com_proposta"]["valor"] == 7 and c["urls_com_falha"]["valor"] == 2  # os números não são todos zero
    # outra rodada, outro resultado, pela mesma consulta
    outra = cx.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"]
    assert cx.execute(REL.SQL_CAMPOS_COM_PROPOSTA, {"rodada": str(outra)}).fetchall() == []


def test_5b_invariante_de_soma_levanta_erro(mundo, cx, monkeypatch):
    rid = mundo.rid
    monkeypatch.setattr(REL, "SQL_URLS_LIDAS", "select 'x' as url_sha, 'http://x.invalid/' as url")
    with pytest.raises(ErroAdmin, match="invariante violada"):
        REL.relatorio(cx, rid)


# ------------------------------------------------------------------ 6: CLI


def test_6_cli_json_tabela_e_inexistente(mundo, cx, monkeypatch, capsys):
    rid = mundo.rid
    capsys.readouterr()
    assert cli.main(["admin", "relatorio", rid, "--json"]) == 0
    saida = capsys.readouterr()
    doc = json.loads(saida.out)  # stdout é só o documento
    assert set(doc) == {"simulado", "rodada", "coleta", "revisao"} and doc["rodada"]["id"] == rid and doc["simulado"] == "v1"
    assert doc["coleta"]["urls_entrada"]["declaradas"]["valor"] == 10 and doc["revisao"]["campos_com_proposta"] == {"valor": 0, "de": 0, "ids": []}
    n = doc["coleta"]["urls_tentadas"]["valor"]
    assert n > 20 and len(doc["coleta"]["urls_tentadas"]["ids"]) == n  # no JSON a lista vem inteira
    assert doc == json.loads(para_json(REL.relatorio(cx, rid)))  # CLI e módulo dão o mesmo número (critério 19)
    # `--json` depois do subcomando também vale; tabela: denominador em todo total, 20 ids e "e mais N"
    assert cli.main(["admin", "relatorio", rid]) == 0
    txt = capsys.readouterr().out
    assert f"URLs tentadas" in txt and f"{n} de {n}" in txt and "10 de 10" in txt and "5 de 5" in txt and "3 de 5" in txt and "2 de 5" in txt and f"e mais {n - 20}" in txt
    for rot in ("URLs tentadas", "  lidas", "  com falha", "URLs de entrada declaradas", "Registros elegíveis", "Registros alcançados", "Campos com proposta", "Registros alterados"):
        assert re.search(rf"^  {re.escape(rot)}\s+\d+ de \d+$", txt, re.M), rot
    assert "COLETA" in txt and "REVISÃO" in txt and txt.index("COLETA") < txt.index("REVISÃO")
    assert cli.main(["admin", "relatorio", rid, "--ids"]) == 0
    completo = capsys.readouterr().out
    assert "e mais" not in completo.split("REVISÃO")[0] and all(i["url"] in completo for i in doc["coleta"]["urls_tentadas"]["ids"])
    # rodada inexistente e identificador inválido: código 1, mensagem em stderr, nada em stdout
    assert cli.main(["admin", "relatorio", str(uuid.uuid4())]) == 1
    o = capsys.readouterr()
    assert "rodada inexistente" in o.err and o.out == ""
    assert cli.main(["admin", "relatorio", "nao-e-uuid", "--json"]) == 1
    o = capsys.readouterr()
    assert "identificador de rodada inválido" in o.err and o.out == ""


# ------------------------------------------------------------------ 7: coletor sem tentativas registradas


def test_7_coletor_sem_tentativas_registradas(mundo, cx, monkeypatch):
    from civico_etl.catalogo import coletor
    assert coletor("tse.votos").tentativas_registradas is False
    rid = str(cx.execute("insert into adm_rodadas (coletor, modo, status) values ('tse.votos', 'recoletar', 'concluida') returning id").fetchone()["id"])
    doc = REL.relatorio(cx, rid)
    c = doc["coleta"]
    nulos = [c["urls_tentadas"], c["urls_lidas"], c["urls_reaproveitadas"], c["urls_com_falha"], c["urls_entrada"]["tentadas"], c["urls_entrada"]["declaradas_nao_tentadas"],
             c["registros_elegiveis"], c["registros_alcancados"], c["registros_elegiveis_nao_alcancados"]]
    for t in nulos:
        assert t["valor"] is None and t["de"] is None and t["ids"] is None and t["motivo"] == "tentativas não registradas para este coletor"
    assert c["urls_com_falha"]["por_motivo"] is None
    assert c["urls_entrada"]["declaradas"]["valor"] is None  # prévia nula: não há lista de entrada, e isso é dito
    txt = REL.texto_relatorio(doc)
    assert "desconhecido: tentativas não registradas para este coletor" in txt and "0 de" not in txt.split("REVISÃO")[0]
    assert doc["revisao"]["campos_com_proposta"]["valor"] == 0 and doc["revisao"]["mensagem"] == REL.SEM_PROPOSTA  # a revisão não depende da coleta
    # coletor fora do catálogo: também desconhecido, com o motivo próprio
    rid2 = str(cx.execute("insert into adm_rodadas (coletor, modo, status) values ('fantasma.x', 'recoletar', 'concluida') returning id").fetchone()["id"])
    c2 = REL.relatorio(cx, rid2)["coleta"]
    assert c2["urls_tentadas"]["valor"] is None and "fora do catálogo" in c2["urls_tentadas"]["motivo"]
