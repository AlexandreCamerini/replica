"""FABRICADO. B3b: o proponente de mudanças cobre as duas classes que faltavam, `contato_mandato` (rodada de `parlamento.extras`) e `identidade` (a fila `identity_match_queue`).

Rodadas REAIS em processo (`ADMIN_RUNNER=processo`) de `parlamento.extras` sobre entrada fabricada (`_ex_entrada` de test_caracterizacao, alterada aqui) e transporte HTTP falso, no banco
isolado. Nada vai à rede e nada é gravado no banco da suíte (contagens antes/depois). O que as rodadas e as decisões gravam no banco isolado é desfeito em `finally`.

Ficou FORA (e é afirmado como tal): a pendência de duplicata de pessoa (`identity_dedupe.PAIRS_SQL`), que o desenho atual não comporta sem mudar `classes.py`/`propostas.py` (ver o último
teste, que fixa a recusa real). O limite do proponente de contatos: valor suprimido por decisão que a fonte voltou a trazer só é CONTADO (`suprimidos_nao_conferidos`).
"""

from __future__ import annotations

import copy
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import admin_fixtures as AF
import httpx
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from test_admin_proponentes import envelhecer
from test_admin_proponentes import rodada as rodada_sapl
from test_admin_sobrevive import decidir_e_aplicar, propor
from test_caracterizacao import EX_A, EX_B, EX_C, _ex_contatos, _ex_entrada, _ex_limpar, _ex_preparar

from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import pendencias as PEN
from civico_etl.admin import proponentes as PRO
from civico_etl.admin import propostas as PR
from civico_etl.admin import relatorio as REL
from civico_etl.admin import rodadas as R
from civico_etl.catalogo import contrato
from civico_etl.catalogo.contrato import Recorte
from civico_etl.util import sha256_text

SUITE = ("adm_rodadas", "adm_tentativas", "adm_evidencias", "adm_vinculos", "adm_propostas", "adm_pendencias", "adm_decisoes", "adm_overrides", "corrections", "mandate_contacts", "mandates",
         "identity_match_queue", "person_external_ids", "people", "sources", "sapl_houses", "data_coverage", "ingest_runs", "dataset_stamps")
POR = dict(por_tipo="pessoa", por_nome="Fulana de Teste", justificativa="conferi na página da fonte")
CAM, SEN = "https://dadosabertos.camara.leg.br/api/v2", "https://legis.senado.leg.br/dadosabertos"
FONTE_SEM_URL = "fab-ident-semurl"


# ------------------------------------------------------------------ fixtures


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta(conn):
    def conta():
        return {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608

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
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_overrides", "adm_vinculos", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "corrections", "adm_evidencias", "adm_tentativas", "adm_rodadas"):
            c.execute(f"delete from {t}")  # noqa: S608


def conectar(url: str):
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    return c


def n(cx, sql: str, *p: Any) -> int:
    return cx.execute(sql, p).fetchone()["n"]


def pend(cx, classe: str, chave: str, campo: str) -> dict | None:
    return cx.execute("select * from adm_pendencias where classe = %s and registro_chave = %s and campo = %s", (classe, chave, campo)).fetchone()


def props(cx, **w: str) -> list[dict]:
    q, p = "select * from adm_propostas where true", []
    for k, v in w.items():
        q += f" and {k} = %s"
        p.append(v)
    return cx.execute(q + " order by classe, registro_chave, campo, criada_em", p).fetchall()


# ------------------------------------------------------------------ parlamento.extras: entrada, rodada, cenário


def entradas() -> tuple[dict, dict]:
    """(rodada 1, rodada 2). Parte de `_ex_entrada(1)`. Rodada 1: o deputado B NÃO tem contato. Rodada 2: A ganha uma rede (aparição) e perde o X/twitter (sumiço); B ganha o e-mail
    (primeiro preenchimento); C troca o e-mail (kind com um valor antes e um valor diferente depois) e perde o site."""
    e1 = _ex_entrada(1, CAM, SEN)
    e1[f"{CAM}/deputados/{EX_B}"] = {"dados": {"ultimoStatus": {"gabinete": {}}}}
    e2 = copy.deepcopy(e1)
    a = e2[f"{CAM}/deputados/{EX_A}"]["dados"]
    a["redeSocial"] = [u for u in a["redeSocial"] if "twitter" not in u] + ["https://t.me/fabA2"]
    e2[f"{CAM}/deputados/{EX_B}"] = {"dados": {"ultimoStatus": {"gabinete": {"email": "Dep.Fab.B@Camara.leg.br"}}}}
    ident = e2[f"{SEN}/senador/lista/atual.json"]["ListaParlamentarEmExercicio"]["Parlamentares"]["Parlamentar"][1]["IdentificacaoParlamentar"]
    ident["EmailParlamentar"] = "Sen.Fab.C.Novo@Senado.leg.br"
    ident.pop("UrlPaginaParlamentar")
    return e1, e2


class Ex:
    """Banco isolado com 2 deputados e 1 senador em exercício e o ferramental para rodar `parlamento.extras` em processo."""

    def __init__(self, url: str, cx, monkeypatch, tmp_path: Path, mand: dict[str, str]):
        self.url, self.cx, self.mp, self.tmp, self.mand = url, cx, monkeypatch, tmp_path, mand

    def rodar(self, nome: str, entrada: dict, *, cache: Path | None = None, nao_achados: tuple[str, ...] = ()) -> tuple[str, dict]:
        cache = cache or self.tmp / nome

        def handler(req: httpx.Request) -> httpx.Response:
            u = str(req.url)
            if u in nao_achados:
                return httpx.Response(404, content=b"")
            if u not in entrada:
                raise AssertionError(f"URL não prevista: {u}")
            return httpx.Response(200, headers={"content-type": "application/json"}, content=json.dumps(entrada[u], ensure_ascii=False).encode())

        AF.instalar(self.mp, "extras", cache, transport=httpx.MockTransport(handler))
        rid = R.abrir(self.cx, "parlamento.extras", Recorte(anos=(2025,)), cache_dir=cache)
        self.cx.commit()
        res = R.executar(self.cx, rid)
        self.cx.rollback()
        return rid, res

    def contatos(self, pessoa: str, fonte: str | None = None) -> set[tuple[str, str, str]]:
        return {(x["fonte"], x["kind"], x["value"]) for x in _ex_contatos(self.url) if x["pessoa"] == pessoa and (fonte is None or x["fonte"] == fonte)}


@pytest.fixture
def ex(banco_isolado, monkeypatch, tmp_path):  # noqa: F811
    import civico_etl.jobs.derive_stats as ds
    import civico_etl.jobs.parlamento_extras as pe

    class _Hoje(date):
        @classmethod
        def today(cls):
            return date(2026, 11, 15)

    monkeypatch.setattr(pe, "date", _Hoje)
    monkeypatch.setattr(ds, "run_derive", lambda c: None)  # o encadeamento do derive.stats não é o que se testa aqui
    url = banco_isolado
    limpar_tudo(url)
    mand = _ex_preparar(url)
    cx = conectar(url)
    try:
        yield Ex(url, cx, monkeypatch, tmp_path, mand)
    finally:
        cx.rollback()
        cx.close()
        limpar_tudo(url)
        _ex_limpar(url)


@pytest.fixture
def ex2(ex):
    """Rodada 1 (sem proposta) e rodada 2 (entrada alterada, cache novo)."""
    e1, e2 = entradas()
    ex.rid1, ex.res1 = ex.rodar("r1", e1)
    ex.c1 = _ex_contatos(ex.url)
    ex.e1, ex.e2 = e1, e2
    ex.rid2, ex.res2 = ex.rodar("r2", e2)
    return ex


def campo_pend(ex, mid: str, campo: str) -> dict:
    p = pend(ex.cx, "contato_mandato", mid, campo)
    assert p is not None, campo
    return p


# ------------------------------------------------------------------ D.1 primeira rodada de parlamento.extras


def test_1_primeira_rodada_e_primeiro_preenchimento_sem_proposta_e_a_previa_lista_os_mandatos(ex):
    cx, mand = ex.cx, ex.mand
    ids = set(mand.values())
    pv = R.previa(cx, "parlamento.extras", Recorte(anos=(2025,)), cache_dir=ex.tmp / "c")
    el = pv["registros_elegiveis"]
    assert el["classe"] == "contato_mandato" and el["valor"] == 3 and el["motivo"] is None and {c["mandate_id"] for c in el["chaves"]} == ids
    assert all(c["rotulo"].startswith("mandato ") and "Fabricad" not in c["rotulo"] for c in el["chaves"])  # cargo · casa · lugar; sem nome de pessoa
    assert R.texto_previa(pv) and json.dumps(pv)
    e1, _ = entradas()
    rid, res = ex.rodar("r1", e1)
    assert res["status"] == "concluida"
    p = res["propostas"]
    assert p["executado"] is True and p["novas"] == 0 and p["recusadas"] == [] and p["sem_evidencia"] == [] and p["pendencias_abertas"] == [] and p["avisos"] == []
    assert p["primeiros_preenchimentos_por_classe"] == {"contato_mandato": 2}  # A (10 contatos) e C (3); B não tem contato nenhum
    assert p["contatos_removidos_pela_fonte"] == [] and p["suprimidos_nao_conferidos"] == [] and p["inalterados"] == 0
    assert n(cx, "select count(*) as n from adm_propostas") == 0 and n(cx, "select count(*) as n from adm_pendencias") == 0
    assert R.descrever_rodada(cx, rid)["resultado"]["propostas"] == p
    # o relatório de coleta: cada mandato traz a URL que o job lê; alcançado = última tentativa dessa URL lida/reaproveitada (deputados: documento próprio; senador: a lista)
    assert {c["url"] for c in el["chaves"]} == {f"{CAM}/deputados/{EX_A}", f"{CAM}/deputados/{EX_B}", f"{SEN}/senador/lista/atual.json"}
    c = REL.relatorio(cx, rid)["coleta"]
    assert c["registros_elegiveis"]["valor"] == 3 and (c["registros_alcancados"]["valor"], c["registros_alcancados"]["de"]) == (3, 3)
    assert c["registros_alcancados"]["ids"] == sorted(f"contato_mandato:{m}" for m in mand.values()) and c["registros_elegiveis_nao_alcancados"]["valor"] == 0
    assert REL.relatorio(cx, rid)["revisao"]["campos_com_proposta"]["valor"] == 0


# ------------------------------------------------------------------ D.2 segunda rodada: aparição, sumiço, troca, inalterado


def test_2_segunda_rodada_propoe_so_o_que_apareceu_e_conta_o_que_sumiu(ex2):
    cx, mand, rid2 = ex2.cx, ex2.mand, ex2.rid2
    p = ex2.res2["propostas"]
    assert ex2.res2["status"] == "concluida" and p["executado"] is True and p["recusadas"] == [] and p["sem_evidencia"] == []
    a, b, c = mand["fab-extras-dep-a"], mand["fab-extras-dep-b"], mand["fab-extras-sen-c"]
    # só duas propostas: a aparição na A e a aparição na C (a troca do e-mail); B é primeiro preenchimento
    assert p["novas"] == 2 and len(p["pendencias_abertas"]) == 2 and p["primeiros_preenchimentos_por_classe"] == {"contato_mandato": 1} and p["inalterados"] == 0
    ps = props(cx, rodada_id=rid2)
    assert [(x["registro_chave"], x["campo"]) for x in ps] == sorted([(a, "novo:outra_rede:https://t.me/fabA2"), (c, "novo:email:sen.fab.c.novo@senado.leg.br")])
    assert props(cx, registro_chave=b) == []
    # --- A: deputado; URL do deputado, hash e data da tentativa da rodada, bloco e ponteiro do campo
    pa = next(x for x in ps if x["registro_chave"] == a)
    url_a = f"{CAM}/deputados/{EX_A}"
    t = cx.execute("select * from adm_tentativas where rodada_id = %s and url = %s order by tentada_em desc", (rid2, url_a)).fetchone()
    assert t["resultado"] == "lida" and t["conteudo_sha256"]
    assert (pa["classe"], pa["valor_candidato"], pa["valor_vigente"], pa["url"], pa["fonte_slug"], pa["alcance"], pa["bloco"]) == (
        "contato_mandato", "https://t.me/fabA2", None, url_a, "camara", "registro", "/dados")
    assert pa["conteudo_sha256"] == t["conteudo_sha256"] and pa["lida_em"] == t["tentada_em"] and pa["rodada_id"] == uuid.UUID(rid2)
    assert "/dados/redeSocial/*" in pa["trecho"] and "https://t.me/fabA2" in pa["trecho"] and "parlamento_extras.py:73-75" in pa["trecho"] and "não é relido aqui" in pa["trecho"]
    pe_a = campo_pend(ex2, a, "novo:outra_rede:https://t.me/fabA2")
    assert (pe_a["status"], pe_a["tipo"], pe_a["reaberta"]) == ("aberta", "mudanca", False)
    assert pe_a["pergunta"] == "O mandato passou a ter o contato outra_rede 'https://t.me/fabA2' na fonte; ele procede?" and pe_a["pergunta"].count("?") == 1
    assert pe_a["evidencia_sha"] == pa["conteudo_sha256"]
    # --- C: senador; a lista, o bloco é o item do senador por CodigoParlamentar, o campo é o e-mail
    pc = next(x for x in ps if x["registro_chave"] == c)
    url_c = f"{SEN}/senador/lista/atual.json"
    tc = cx.execute("select * from adm_tentativas where rodada_id = %s and url = %s order by tentada_em desc", (rid2, url_c)).fetchone()
    assert (pc["url"], pc["fonte_slug"], pc["valor_candidato"], pc["valor_vigente"]) == (url_c, "senado", "sen.fab.c.novo@senado.leg.br", None)
    assert pc["conteudo_sha256"] == tc["conteudo_sha256"] and pc["lida_em"] == tc["tentada_em"]
    assert f"IdentificacaoParlamentar/CodigoParlamentar = {EX_C}" in pc["bloco"] and "IdentificacaoParlamentar/EmailParlamentar" in pc["trecho"] and "em minúsculas" in pc["trecho"]
    # --- o que SUMIU: contado, sem proposta e sem pendência; o kind que trocou de valor é só sumiço + aparição, cada um por si
    rem = {(x["mandate_id"], x["kind"], x["value"]): x for x in p["contatos_removidos_pela_fonte"]}
    assert set(rem) == {(a, "x", "https://twitter.com/fabA"), (c, "email", "sen.fab.c@senado.leg.br"), (c, "site", "https://www25.senado.leg.br/web/senadores/senador/-/perfil/5801")}
    assert rem[(c, "email", "sen.fab.c@senado.leg.br")]["kind_trocou_de_valor"] is True and rem[(a, "x", "https://twitter.com/fabA")]["kind_trocou_de_valor"] is False
    assert all(x["motivo"] == "a fonte deixou de publicar; o módulo não propõe ausência" for x in rem.values())
    assert n(cx, "select count(*) as n from adm_pendencias") == 2 and n(cx, "select count(*) as n from adm_propostas") == 2
    # o banco reflete o job: o antigo saiu, o novo entrou, nada foi aplicado por este módulo
    assert ("camara", "outra_rede", "https://t.me/fabA2") in ex2.contatos("fab-extras-dep-a") and ("camara", "x", "https://twitter.com/fabA") not in ex2.contatos("fab-extras-dep-a")
    assert ex2.contatos("fab-extras-dep-b") == {("camara", "email", "dep.fab.b@camara.leg.br")}
    assert n(cx, "select count(*) as n from adm_overrides") == 0 and n(cx, "select count(*) as n from adm_decisoes") == 0 and n(cx, "select count(*) as n from corrections") == 0
    # relatório da rodada: duas propostas, duas pendências, sem quebrar
    rel = REL.relatorio(cx, rid2)
    assert rel["revisao"]["campos_com_proposta"]["valor"] == 2 and rel["coleta"]["registros_elegiveis"]["valor"] == 3


def test_1b_mandato_cuja_url_falha_nao_e_alcancado_e_o_motivo_e_o_da_url(ex):
    e1, _ = entradas()
    url_b = f"{CAM}/deputados/{EX_B}"
    rid, res = ex.rodar("r1", e1, nao_achados=(url_b,))
    assert res["status"] in ("concluida", "interrompida", "falhou")
    c = REL.relatorio(ex.cx, rid)["coleta"]
    b = ex.mand["fab-extras-dep-b"]
    assert (c["registros_alcancados"]["valor"], c["registros_alcancados"]["de"]) == (2, 3) and f"contato_mandato:{b}" not in c["registros_alcancados"]["ids"]
    it = c["registros_elegiveis_nao_alcancados"]["itens"]
    assert [i["id"] for i in it] == [f"contato_mandato:{b}"] and it[0]["situacao"] == "URL do registro tentada na rodada, nenhuma leitura" and it[0]["motivo_falha"]
    assert "casa não registrada" not in json.dumps(it, ensure_ascii=False)
    # URL que a rodada nem tentou: o motivo é dito
    ex.cx.execute("delete from adm_tentativas where rodada_id = %s and url = %s", (rid, url_b))
    ex.cx.commit()
    it = REL.relatorio(ex.cx, rid)["coleta"]["registros_elegiveis_nao_alcancados"]["itens"]
    assert it[0]["situacao"] == "URL do registro não tentada nesta rodada" and it[0]["motivo_falha"] is None


def test_2b_mandato_inalterado_nao_gera_nada(ex):
    e1, _ = entradas()
    ex.rodar("r1", e1)
    rid, res = ex.rodar("r2", e1)  # mesma entrada, cache novo
    p = res["propostas"]
    assert p["novas"] == 0 and p["inalterados"] == 2 and p["contatos_removidos_pela_fonte"] == [] and p["primeiros_preenchimentos"] == 0  # A e C inalterados; B segue sem contato
    assert n(ex.cx, "select count(*) as n from adm_propostas") == 0


# ------------------------------------------------------------------ D.3 repetir a rodada (critério 4)


def restaurar(url: str, contatos: list[dict], mand: dict[str, str]) -> None:
    """Devolve mandate_contacts ao estado `contatos` (o de antes da rodada 2), para repetir a rodada com a mesma entrada."""
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("delete from mandate_contacts where mandate_id = any(%s::uuid[])", (list(mand.values()),))
        for x in contatos:
            c.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) select %s, %s, %s, id from sources where slug = %s", (mand[x["pessoa"]], x["kind"], x["value"], x["fonte"]))


def test_3_repetir_a_rodada_com_o_mesmo_cache_nao_cria_proposta_nem_mexe_na_pendencia(ex2):
    cx = ex2.cx
    antes_p = cx.execute("select id, chave_idem from adm_propostas order by id").fetchall()
    antes_pe = cx.execute("select id, status, tipo, reaberta, evidencia_sha, vigente_sha, pergunta, vence_em from adm_pendencias order by id").fetchall()
    texto_da_classe = "Deve ser cadastrado, neste mandato, o contato do tipo email 'x'?"  # o que `reavaliar`/nova ligação deixariam
    cx.execute("update adm_pendencias set pergunta = %s", (texto_da_classe,))
    cx.commit()
    restaurar(ex2.url, ex2.c1, ex2.mand)  # o "antes" da rodada 2 de novo
    rid3, res3 = ex2.rodar("r3", ex2.e2, cache=ex2.tmp / "r2")  # mesma entrada, MESMO cache: as leituras são reaproveitadas
    p = res3["propostas"]
    t = cx.execute("select resultado from adm_tentativas where rodada_id = %s and url = %s", (rid3, f"{CAM}/deputados/{EX_A}")).fetchone()
    assert t["resultado"] == "reaproveitada"
    assert p["novas"] == 0 and p["repetidas"] == 2 and p["pendencias_abertas"] == [] and p["pendencias_reabertas"] == [] and p["recusadas"] == [] and p["sem_evidencia"] == []
    assert cx.execute("select id, chave_idem from adm_propostas order by id").fetchall() == antes_p
    # a proposta repetida reescreve a pergunta (que estava com o texto da classe); o resto da pendência é idêntico
    depois_pe = cx.execute("select id, status, tipo, reaberta, evidencia_sha, vigente_sha, pergunta, vence_em from adm_pendencias order by id").fetchall()
    assert depois_pe == antes_pe and all(x["pergunta"].startswith("O mandato passou a ter o contato ") and x["pergunta"].endswith("ele procede?") for x in depois_pe)
    assert len(p["contatos_removidos_pela_fonte"]) == 3  # o sumiço é contado de novo; ele nunca vira proposta


# ------------------------------------------------------------------ D.4 decisão sobre contato novo que o job já inseriu


def test_4_aprovar_e_descartar_contato_novo_que_o_job_ja_inseriu_nao_mudam_a_tabela(ex2):
    cx, mand = ex2.cx, ex2.mand
    a, c = mand["fab-extras-dep-a"], mand["fab-extras-sen-c"]
    antes = _ex_contatos(ex2.url)
    # APROVAR + aplicar: o valor já está em mandate_contacts com fonte camara; `aplicar` não duplica e não troca a fonte
    pid_a = campo_pend(ex2, a, "novo:outra_rede:https://t.me/fabA2")["id"]
    r = decidir_e_aplicar(cx, str(pid_a), "aprovar", justificativa="a página da deputada mostra a rede")
    assert list(r["escreveu"]) == ["mandate_contacts_ja_existia"] and "já existia (fonte camara)" in r["observacao"]
    assert r["corrections"]["gravou"] is False and "primeiro preenchimento" in r["corrections"]["motivo"]
    assert _ex_contatos(ex2.url) == antes  # tabela idêntica: o contato segue com a fonte `camara`
    assert n(cx, "select count(*) as n from adm_overrides") == 0
    assert pend(cx, "contato_mandato", a, "novo:outra_rede:https://t.me/fabA2")["status"] == "decidida"
    # DESCARTAR: a decisão fica registrada, a pendência decidida, e o contato que o job inseriu CONTINUA na tabela (descartar não remove nada)
    pid_c = campo_pend(ex2, c, "novo:email:sen.fab.c.novo@senado.leg.br")["id"]
    d = DEC.decidir(cx, str(pid_c), acao="descartar", **{**POR, "justificativa": "o e-mail novo não é do senador"})
    cx.commit()
    assert d["valor"] is None and pend(cx, "contato_mandato", c, "novo:email:sen.fab.c.novo@senado.leg.br")["status"] == "decidida"
    with pytest.raises(APL.AplicacaoRecusada, match="nada a aplicar"):
        APL.aplicar(cx, d["id"])
    cx.rollback()
    assert ("senado", "email", "sen.fab.c.novo@senado.leg.br") in ex2.contatos("fab-extras-sen-c") and _ex_contatos(ex2.url) == antes
    assert n(cx, "select count(*) as n from adm_overrides") == 0 and PR.reavaliar(cx) == []
    cx.rollback()
    # uma rodada seguinte (mesma entrada, cache da 2) não reabre nem propõe de novo: o contato é do banco
    rid3, res3 = ex2.rodar("r3", ex2.e2, cache=ex2.tmp / "r2")
    assert res3["propostas"]["novas"] == 0 and res3["propostas"]["inalterados"] == 3  # A, B e C
    assert {x["status"] for x in cx.execute("select status from adm_pendencias").fetchall()} == {"decidida"}


# ------------------------------------------------------------------ D.5 supressão vigente


def test_5_mandato_com_supressao_vigente_so_e_contado_como_nao_conferido(ex):
    cx, mid = ex.cx, ex.mand["fab-extras-dep-a"]
    e1, _ = entradas()
    ex.rodar("r1", e1)
    velho, novo = "dep.fab.a@camara.leg.br", "deputada.a.correto@camara.leg.br"
    pid = propor(cx, "contato_mandato", mid, f"email:{velho}", novo, "https://exemplo.fabricado/camara/dep-a", "ex1", bloco="<div id=dep-a>")
    decidir_e_aplicar(cx, pid, "aprovar", justificativa="a página da deputada mostra outro e-mail")
    assert n(cx, "select count(*) as n from adm_overrides where vigente and suprimir") == 1
    cx.rollback()
    rid, res = ex.rodar("r2", e1)  # o job tenta inserir o e-mail antigo de novo; o gatilho o descarta em silêncio
    p = res["propostas"]
    assert velho not in {v for _, k, v in ex.contatos("fab-extras-dep-a") if k == "email"} and ("curadoria", "email", novo) in ex.contatos("fab-extras-dep-a")
    assert p["suprimidos_nao_conferidos"] == [{"mandate_id": mid, "campos": [f"email:{velho}"], "motivo": "o job não registra o valor descartado pelo gatilho de supressão: não se sabe se a fonte voltou a trazê-lo"}]
    assert p["novas"] == 0 and p["contatos_removidos_pela_fonte"] == [] and p["inalterados"] == 2  # a correção de curadoria não conta como leitura da fonte


# ------------------------------------------------------------------ identidade: fila


@pytest.fixture
def fila(banco_isolado):  # noqa: F811
    """Itens da fila (fonte camara): Q1 e Q2 com candidato, Q3 sem candidato, Q4 de uma fonte sem URL http(s) com candidato. Devolve ids."""
    url = banco_isolado
    limpar_tudo(url)
    out: dict[str, Any] = {}
    base = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        cam = c.execute("select id, url from sources where slug = 'camara'").fetchone()
        out["src_url"] = cam["url"]
        sem = c.execute("insert into sources (slug, name, url) values (%s, 'fonte sem url http', 'sem-url') returning id", (FONTE_SEM_URL,)).fetchone()["id"]
        p1, p2 = (c.execute("insert into people (slug, display_name) values (%s, %s) returning id", (s, "Pessoa " + s)).fetchone()["id"] for s in ("fab-id-pessoa-1", "fab-id-pessoa-2"))
        out["p1"], out["p2"] = str(p1), str(p2)
        raws = {"Q1": {"nome": "Fulano Fabricado Um", "nascimento": "1970-01-02", "uf": "SP"}, "Q2": {"nome": "Fulana Fabricada Dois", "uf": "RJ"}, "Q3": {"nome": "Sem Candidata"},
                "Q4": {"nome": "Quarto Fabricado"}}
        spec = {"Q1": (cam["id"], "FAB-ID-1", p1, "0.800", 0), "Q2": (cam["id"], "FAB-ID-2", p2, "0.500", 1), "Q3": (cam["id"], "FAB-ID-3", None, "0.500", 2), "Q4": (sem, "FAB-ID-4", p1, "0.500", 3)}
        for k, (src, ext, cand, conf, i) in spec.items():
            out[k] = str(c.execute(
                "insert into identity_match_queue (source_id, external_id, raw, candidate_person_id, confidence, status, created_at, updated_at) values (%s, %s, %s, %s, %s, 'pendente', %s, %s) returning id",
                (src, ext, Jsonb(raws[k]), cand, conf, base + timedelta(minutes=i), base + timedelta(minutes=i, seconds=30))).fetchone()["id"])
        out["raws"], out["exts"] = raws, {k: v[1] for k, v in spec.items()}
    try:
        yield out
    finally:
        limpar_tudo(url)
        with psycopg.connect(url, autocommit=True) as c:
            c.execute("delete from person_external_ids where external_id like 'FAB-ID-%'")
            c.execute("delete from identity_match_queue where external_id like 'FAB-ID-%'")
            c.execute("delete from people where slug like 'fab-id-%'")
            c.execute("delete from sources where slug = %s", (FONTE_SEM_URL,))


@pytest.fixture
def cx(fila, banco_isolado):  # noqa: F811
    c = conectar(banco_isolado)
    try:
        yield c
    finally:
        c.rollback()
        c.close()


def pergunta_ident(fila, k: str, slug_pessoa: str, id_pessoa: str, fonte: str = "camara") -> str:
    return f"O registro {fila['exts'][k]} da fonte {fonte} é da pessoa {slug_pessoa} (id {id_pessoa})?"


def test_6_identidade_proposta_pergunta_evidencia_e_repeticao(cx, fila):
    r = PRO.propor_identidade(cx)
    cx.commit()
    assert len(r.novas) == 2 and r.repetidas == 0 and len(r.pendencias_abertas) == 2 and r.recusadas == []
    assert r.identidade_sem_candidato == [fila["Q3"]] and props(cx, registro_chave=fila["Q3"]) == [] and pend(cx, "identidade", fila["Q3"], "status") is None
    assert [x["registro_chave"] for x in r.sem_evidencia] == [fila["Q4"]] and "URL http(s)" in r.sem_evidencia[0]["motivo"] and props(cx, registro_chave=fila["Q4"]) == []
    assert r.duplicatas["abertas"] == 0 and r.duplicatas["pares_na_regra_existente"] == 0
    # Q1: o que a proposta carrega
    p = props(cx, registro_chave=fila["Q1"])[0]
    raw = fila["raws"]["Q1"]
    assert (p["classe"], p["campo"], p["valor_candidato"], p["valor_vigente"], p["url"], p["fonte_slug"], p["bloco"], p["rodada_id"], p["fonte_declarada_em"]) == (
        "identidade", "status", "aceito", "pendente", fila["src_url"], "camara", None, None, None)
    assert p["conteudo_sha256"] == sha256_text(json.dumps({"candidate_person_id": fila["p1"], "raw": raw}, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
    assert p["lida_em"] == datetime(2026, 11, 1, 12, 0, 30, tzinfo=timezone.utc)
    assert "hash do registro bruto guardado na fila (`raw`) e do candidato apontado pelo job, não de uma página" in p["trecho"] and f"pessoa {fila['p1']}" in p["trecho"] and "nome = Fulano Fabricado Um" in p["trecho"] and "uf = SP" in p["trecho"]
    assert p["trecho"].endswith("confiança registrada pelo job: 0.800")
    pe1 = pend(cx, "identidade", fila["Q1"], "status")
    assert (pe1["status"], pe1["tipo"], pe1["reaberta"], pe1["vence_em"]) == ("aberta", "mudanca", False, None)  # identidade não tem prazo de revalidação
    assert pe1["pergunta"] == pergunta_ident(fila, "Q1", "fab-id-pessoa-1", fila["p1"]) and pe1["pergunta"].count("?") == 1
    assert pend(cx, "identidade", fila["Q2"], "status")["pergunta"] == pergunta_ident(fila, "Q2", "fab-id-pessoa-2", fila["p2"])
    assert CLASSES_TERRITORIO(cx, fila["Q1"]) is None  # identidade nunca tem território
    # nada foi aplicado
    assert n(cx, "select count(*) as n from identity_match_queue where status <> 'pendente'") == 0 and n(cx, "select count(*) as n from person_external_ids where external_id like 'FAB-ID-%%'") == 0
    # rodar de novo: zero novas
    r2 = PRO.propor_identidade(cx)
    cx.commit()
    assert r2.novas == [] and r2.repetidas == 2 and r2.pendencias_abertas == [] and r2.pendencias_reabertas == [] and n(cx, "select count(*) as n from adm_propostas") == 2
    # limite e fontes
    assert PRO.propor_identidade(cx, limite=1).repetidas == 1 and PRO.propor_identidade(cx, fontes=[FONTE_SEM_URL]).sem_evidencia[0]["registro_chave"] == fila["Q4"]
    with pytest.raises(PRO.ErroAdmin):
        PRO.propor_identidade(cx, limite=0)
    cx.rollback()


def CLASSES_TERRITORIO(cx, q: str):
    from civico_etl.admin.classes import CLASSES

    return CLASSES["identidade"].territorio(cx, q)


def test_6b_raw_que_muda_reabre_a_pendencia_decidida_so_enquanto_o_item_esta_pendente(cx, fila):
    PRO.propor_identidade(cx)
    cx.commit()
    pid1 = pend(cx, "identidade", fila["Q1"], "status")["id"]
    d = DEC.decidir(cx, str(pid1), acao="descartar", **POR)
    cx.commit()
    assert pend(cx, "identidade", fila["Q1"], "status")["status"] == "decidida" and cx.execute("select status from identity_match_queue where id = %s", (fila["Q1"],)).fetchone()["status"] == "pendente"
    # nada mudou: a pendência decidida continua decidida
    r0 = PRO.propor_identidade(cx)
    assert r0.novas == [] and pend(cx, "identidade", fila["Q1"], "status")["status"] == "decidida"
    cx.commit()
    # nova carga (o job regrava `raw` e a confiança enquanto o item está pendente)
    cx.execute("update identity_match_queue set raw = %s, updated_at = now() where id = %s", (Jsonb({**fila["raws"]["Q1"], "uf": "MG"}), fila["Q1"]))
    cx.commit()
    r1 = PRO.propor_identidade(cx)
    cx.commit()
    pe1 = pend(cx, "identidade", fila["Q1"], "status")
    assert len(r1.novas) == 1 and r1.pendencias_reabertas == [str(pid1)] and r1.repetidas == 1
    assert (pe1["status"], pe1["reaberta"], pe1["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou") and "uf = MG" in props(cx, registro_chave=fila["Q1"])[-1]["trecho"]
    assert pe1["pergunta"] == pergunta_ident(fila, "Q1", "fab-id-pessoa-1", fila["p1"])
    assert d["acao"] == "descartar"
    # item decidido e aplicado (não está mais pendente): o job não o regrava e o proponente não o olha
    pid2 = pend(cx, "identidade", fila["Q2"], "status")["id"]
    d2 = DEC.decidir(cx, str(pid2), acao="aprovar", **POR)
    APL.aplicar(cx, d2["id"])
    cx.commit()
    cx.execute("update identity_match_queue set raw = %s where id = %s", (Jsonb({"nome": "mudou por baixo"}), fila["Q2"]))
    cx.commit()
    n_antes = n(cx, "select count(*) as n from adm_propostas")
    r2 = PRO.propor_identidade(cx)
    assert r2.novas == [] and r2.repetidas == 1 and n(cx, "select count(*) as n from adm_propostas") == n_antes  # só o Q1 (ainda pendente) passa, repetido
    assert pend(cx, "identidade", fila["Q2"], "status")["status"] == "decidida"
    cx.rollback()


def test_6d_candidato_trocado_com_o_mesmo_raw_gera_proposta_nova_e_reabre_a_decidida(cx, fila):
    PRO.propor_identidade(cx)
    cx.commit()
    q1, q2 = fila["Q1"], fila["Q2"]
    # --- pendência ABERTA (Q1): o job troca o candidato com o mesmo raw
    cx.execute("update identity_match_queue set candidate_person_id = %s where id = %s", (fila["p2"], q1))
    cx.commit()
    r = PRO.propor_identidade(cx)
    cx.commit()
    pe1 = pend(cx, "identidade", q1, "status")
    assert len(r.novas) == 1 and r.pendencias_ligadas == [str(pe1["id"])] and r.pendencias_reabertas == [] and r.repetidas == 1
    ligadas = cx.execute("select pr.valor_candidato, pr.conteudo_sha256 from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id where pp.pendencia_id = %s", (pe1["id"],)).fetchall()
    assert len(ligadas) == 2 and len({x["conteudo_sha256"] for x in ligadas}) == 2 and {x["valor_candidato"] for x in ligadas} == {"aceito"}
    # comportamento real: continua `mudanca` (mesmo valor "aceito", mesma URL: nenhuma divergência) e a pergunta cita o candidato ATUAL
    assert (pe1["status"], pe1["tipo"]) == ("aberta", "mudanca") and pe1["pergunta"] == pergunta_ident(fila, "Q1", "fab-id-pessoa-2", fila["p2"])
    assert pe1["evidencia_sha"] == props(cx, registro_chave=q1)[-1]["conteudo_sha256"]
    d = DEC.decidir(cx, str(pe1["id"]), acao="aprovar", **POR)  # `aprovar` aceita: o candidato único é "aceito" (as duas propostas dizem o mesmo)
    assert d["valor"] == "aceito"
    cx.commit()
    # --- pendência DECIDIDA (Q2, descartada): o job troca o candidato com o mesmo raw -> reabre por evidencia_mudou
    d2 = DEC.decidir(cx, str(pend(cx, "identidade", q2, "status")["id"]), acao="descartar", **POR)
    cx.commit()
    assert d2["acao"] == "descartar"
    cx.execute("update identity_match_queue set candidate_person_id = %s where id = %s", (fila["p1"], q2))
    cx.commit()
    r2 = PRO.propor_identidade(cx)
    cx.commit()
    pe2 = pend(cx, "identidade", q2, "status")
    assert r2.pendencias_reabertas == [str(pe2["id"])] and (pe2["status"], pe2["reaberta"], pe2["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou")
    assert pe2["pergunta"] == pergunta_ident(fila, "Q2", "fab-id-pessoa-1", fila["p1"])
    # repetida com a pergunta com o texto da classe: reescrita (pendência aberta)
    cx.execute("update adm_pendencias set pergunta = 'texto da classe' where id = %s", (pe2["id"],))
    cx.commit()
    PRO.propor_identidade(cx)
    cx.commit()
    assert pend(cx, "identidade", q2, "status")["pergunta"] == pergunta_ident(fila, "Q2", "fab-id-pessoa-1", fila["p1"])


def test_7_decidir_e_aplicar_aceito_cria_o_vinculo_em_person_external_ids(cx, fila):
    PRO.propor_identidade(cx)
    cx.commit()
    pid = pend(cx, "identidade", fila["Q1"], "status")["id"]
    assert n(cx, "select count(*) as n from person_external_ids where external_id = 'FAB-ID-1'") == 0
    d = DEC.decidir(cx, str(pid), acao="aprovar", **POR)
    assert d["valor"] == "aceito" and d["campos_afetados"] == [f"identidade:{fila['Q1']}:status"]
    r = APL.aplicar(cx, d["id"])
    cx.commit()
    assert list(r["escreveu"]) == ["person_external_ids", "identity_match_queue"] and r["valor_anterior"] == "pendente" and r["valor_novo"] == "aceito"
    v = cx.execute("select e.person_id, e.match_method, s.slug from person_external_ids e join sources s on s.id = e.source_id where e.external_id = 'FAB-ID-1'").fetchone()
    assert (str(v["person_id"]), v["match_method"], v["slug"]) == (fila["p1"], "manual", "camara")
    q = cx.execute("select status, resolved_by from identity_match_queue where id = %s", (fila["Q1"],)).fetchone()
    assert (q["status"], q["resolved_by"]) == ("aceito", "Fulana de Teste") and PR.reavaliar(cx) == []
    # rejeitar não cria vínculo: corrigir Q2 para `rejeitado`
    pid2 = pend(cx, "identidade", fila["Q2"], "status")["id"]
    DEC.decidir(cx, str(pid2), acao="corrigir", valor="rejeitado", **POR)
    APL.aplicar_pendentes(cx)
    cx.commit()
    assert n(cx, "select count(*) as n from person_external_ids where external_id = 'FAB-ID-2'") == 0 and cx.execute("select status from identity_match_queue where id = %s", (fila["Q2"],)).fetchone()["status"] == "rejeitado"


def test_6c_coletor_que_alimenta_a_fila_leva_so_as_fontes_dele_e_o_resto_nao_propoe(cx, fila):
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=("RO",)))  # rodada de apoio: só dá o `rodada_id`
    cx.commit()
    f = PRO.Foto(coletor_id="x")
    assert PRO._fontes_da_fila("camara.diario") == ["camara"] and PRO._fontes_da_fila("sapl.assembleias") == [] and PRO._fontes_da_fila("coletor-que-nao-existe") == []
    r = PRO.propor(cx, rid, "camara.diario", f, f)
    cx.commit()
    assert r.executado is True and len(r.novas) == 2 and all(x["rodada_id"] == uuid.UUID(rid) for x in props(cx, classe="identidade"))
    assert [x["registro_chave"] for x in r.sem_evidencia] == [] and r.identidade_sem_candidato == [fila["Q3"]]  # Q4 é de outra fonte: nem entra
    assert PRO.propor(cx, rid, "tse.candidatos", f, f).novas == []  # fonte `tse`: nenhum item
    sem = PRO.propor(cx, rid, "camara.equipe", f, f)
    assert sem.executado is False and "camara.equipe" in sem.avisos[0]
    cx.rollback()


# ------------------------------------------------------------------ D.9 a fila com as quatro classes


def test_9_fila_com_as_quatro_classes_segue_a_ordem_fixa_e_nao_depende_de_nome_de_pessoa(banco_isolado, monkeypatch, tmp_path, fila):  # noqa: F811
    url = banco_isolado
    cxs = conectar(url)
    try:
        AF.limpar_base(url)
        AF.carregar_base(url)
        # contato_mandato: proponente de parlamento.extras
        import civico_etl.jobs.derive_stats as ds
        import civico_etl.jobs.parlamento_extras as pe

        class _Hoje(date):
            @classmethod
            def today(cls):
                return date(2026, 11, 15)

        monkeypatch.setattr(pe, "date", _Hoje)
        monkeypatch.setattr(ds, "run_derive", lambda c: None)
        mand = _ex_preparar(url)
        e = Ex(url, cxs, monkeypatch, tmp_path, mand)
        e1, e2 = entradas()
        e.rodar("e1", e1)
        e.rodar("e2", e2)
        # vinculo_sapl e cobertura: proponente do SAPL (rodadas v1 e v2)
        rid_s1, _, _ = rodada_sapl(cxs, monkeypatch, tmp_path / "s1", "v1")
        cxs.rollback()
        antes_f = PRO.fotografar(cxs, "sapl.assembleias", Recorte(ufs=("RO",)))  # cobertura: a mesma técnica de test_admin_proponentes (status e reason mudam juntos)
        depois_f = PRO.fotografar(cxs, "sapl.assembleias", Recorte(ufs=("RO",)))
        lin = next(v for (pid, ds), v in depois_f.cobertura.items() if ds == "propostas")
        lin["status"], lin["reason"] = "desconhecido", "o SAPL da Assembleia não tem mais nada"
        assert len(PRO.propor(cxs, rid_s1, "sapl.assembleias", antes_f, depois_f).novas) == 2
        cxs.commit()
        envelhecer(cxs)
        rodada_sapl(cxs, monkeypatch, tmp_path / "s2", "v2")
        cxs.rollback()
        # identidade: o executor da fila
        PRO.propor_identidade(cxs)
        cxs.commit()
        pens = cxs.execute("select id, classe, tipo, vence_em, cobertura_recorte from adm_pendencias where status = 'aberta'").fetchall()
        assert {p["classe"] for p in pens} == {"vinculo_sapl", "cobertura", "contato_mandato", "identidade"}
        RC = {"vinculo_sapl": 0, "cobertura": 1, "contato_mandato": 2, "identidade": 3}  # a ordem do plano, escrita à mão
        RT = {"divergencia": 0, "mudanca": 1, "duplicata": 2, "confirmacao": 3}
        vazio = datetime.min.replace(tzinfo=timezone.utc)
        esperada = [str(p["id"]) for p in sorted(pens, key=lambda p: (RC[p["classe"]], RT[p["tipo"]], p["vence_em"] is None, p["vence_em"] or vazio, p["cobertura_recorte"] is None, p["cobertura_recorte"] or 0, str(p["id"])))]
        ordem = [i["id"] for i in PEN.fila(cxs)]
        assert ordem == esperada and len(ordem) == len(pens)
        classes = [i["classe"] for i in PEN.fila(cxs)]
        assert classes == sorted(classes, key=RC.get)
        # mudar nome e slug de TODAS as pessoas envolvidas (parlamentares e candidatas) não altera a ordem
        cxs.execute("update people set display_name = 'ZZZ ' || display_name, slug = 'zzz-' || slug where slug like 'fab-extras-%' or slug like 'fab-id-%'")
        cxs.commit()
        assert [i["id"] for i in PEN.fila(cxs)] == ordem
        cxs.execute("update people set display_name = 'AAA ' || display_name where slug like 'zzz-%'")
        cxs.commit()
        assert [i["id"] for i in PEN.fila(cxs)] == ordem
    finally:
        cxs.rollback()
        cxs.close()
        with psycopg.connect(url, autocommit=True) as c:
            c.execute("update people set slug = substr(slug, 5) where slug like 'zzz-fab-%'")  # devolve os slugs para a limpeza achar as pessoas
        limpar_tudo(url)
        _ex_limpar(url)
        AF.limpar_base(url)


# ------------------------------------------------------------------ D.10 a CLI real


def test_10_cli_admin_identidade_propor_json(cx, fila, capsys):
    cx.rollback()
    rc = cli.main(["admin", "identidade", "propor", "--json"])
    out = capsys.readouterr()
    assert rc == 0, out.err
    d = json.loads(out.out)
    assert d["executado"] is True and d["novas"] == 2 and d["repetidas"] == 0 and d["identidade_sem_candidato"] == [fila["Q3"]] and len(d["sem_evidencia"]) == 1
    assert d["duplicatas"]["abertas"] == 0 and len(d["pendencias_abertas"]) == 2
    assert n(cx, "select count(*) as n from adm_pendencias where classe = 'identidade' and status = 'aberta'") == 2  # comitado
    rc2 = cli.main(["admin", "identidade", "propor"])
    txt = capsys.readouterr().out
    assert rc2 == 0 and "repetidas" in txt and "duplicatas abertas" in txt and n(cx, "select count(*) as n from adm_propostas") == 2
    assert cli.main(["admin", "identidade", "propor", "--limite", "0"]) == 2
    assert cli.main(["admin", "identidade", "propor", "--limite", "1", "--json"]) == 0
    capsys.readouterr()


# ------------------------------------------------------------------ duplicata de pessoa: o desenho atual não a comporta (fixa a recusa real)


def test_duplicata_de_pessoa_nao_cabe_no_modelo_atual(cx, fila):
    a = fila["Q1"]
    # a classe não aceita o candidato `{"unir": ...}` (só os quatro status) e o registro tem de ser item da fila
    for cand in ({"unir": {"de": fila["p1"], "para": fila["p2"]}}, "duplicata"):
        with pytest.raises(PR.PropostaRecusada):
            PR.validar(cx, PR.Proposta(classe="identidade", registro_chave=a, campo="status", valor_candidato=cand, url="https://x.example/y", trecho="t", conteudo_sha256="a" * 64,
                                       lida_em=datetime.now(timezone.utc)))
    with pytest.raises(PR.PropostaRecusada, match="registro inexistente"):
        PR.validar(cx, PR.Proposta(classe="identidade", registro_chave=f"{fila['p1']}:{fila['p2']}", campo="status", valor_candidato="aceito", url="https://x.example/y", trecho="t",
                                   conteudo_sha256="a" * 64, lida_em=datetime.now(timezone.utc)))
    # e `registrar` nunca cria tipo `duplicata`
    PRO.propor_identidade(cx)
    assert {x["tipo"] for x in cx.execute("select tipo from adm_pendencias").fetchall()} == {"mudanca"}
    cx.rollback()
