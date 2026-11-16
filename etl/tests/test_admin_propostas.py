"""FABRICADO. Parte B (B1): propostas de mudança, recusa na entrada (critério 10), abertura e reabertura de pendências (critérios 4, 7 e 8).

Sem rede, sem skip. Todo dado fabricado vive no banco isolado (`banco_isolado`): a maioria dos testes usa uma transação revertida no fim (o gatilho de
`adm_decisoes` proíbe apagar decisão, então decisão só existe em transação que reverte); os que passam pela CLI (que abre a própria conexão e comita) gravam com
commit e limpam em `finally`, sem criar decisão. Nada é gravado no banco da suíte: o módulo compara as contagens de antes e depois.
"""

from __future__ import annotations

import inspect
import json
import uuid
from dataclasses import fields, replace
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row
from test_admin_vinculos import BASE_ALE, BASE_CAMARA, IBGE, desfazer, mundo

from civico_etl import cli
from civico_etl.admin import classes as CL
from civico_etl.admin import propostas as PR
from civico_etl.admin import relatorio as REL
from civico_etl.admin.propostas import Proposta, PropostaRecusada
from civico_etl.admin.saida import ErroAdmin
from civico_etl.util import sha256_text

AGORA = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
TRES = ("adm_propostas", "adm_pendencias", "adm_pendencia_propostas")
SUITE = TRES + ("adm_decisoes", "adm_rodadas", "adm_vinculos", "adm_tentativas", "sapl_houses", "data_coverage", "mandate_contacts", "mandates", "identity_match_queue", "people", "ingest_runs")


def H(s: str) -> str:
    return sha256_text(s)


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


@pytest.fixture(scope="module", autouse=True)
def suite_intacta():
    """Nada deste módulo pode tocar o banco da suíte. Sem banco, falha (nenhum skip)."""
    antes = _contagens(database_url())
    yield
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


@pytest.fixture
def iso(banco_isolado):
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    yield c
    c.rollback()
    c.close()


@pytest.fixture
def m(iso):
    return mundo(iso)


def tres(c) -> tuple[int, ...]:
    return tuple(c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in TRES)  # noqa: S608


def P(m: dict, **kw) -> Proposta:
    """Proposta válida (status do SAPL da Câmara de Cidade Teste, hoje 'ok', proposto 'fora_do_ar'); `kw` sobrescreve."""
    base = dict(classe="vinculo_sapl", registro_chave=str(m["h_cam"]), campo="status", valor_candidato="fora_do_ar", url="https://a.example/api/",
                trecho="$.status == 'fora_do_ar'", conteudo_sha256=H("a1"), lida_em=AGORA - timedelta(days=1))
    base.update(kw)
    return Proposta(**base)


def pendencia(c, classe: str, chave: str, campo: str) -> dict | None:
    return c.execute("select * from adm_pendencias where classe = %s and registro_chave = %s and campo = %s", (classe, chave, campo)).fetchone()


def ligadas(c, pid) -> int:
    return c.execute("select count(*) as n from adm_pendencia_propostas where pendencia_id = %s", (pid,)).fetchone()["n"]


def decidir(c, pid) -> None:
    """Decisão fabricada (só em transação que reverte) e transição aberta -> decidida, como a próxima tarefa fará."""
    c.execute("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, justificativa) values (%s, 'aprovar', 'pessoa', 'Fulana', 'conferi na página')", (pid,))
    c.execute("update adm_pendencias set status = 'decidida' where id = %s", (pid,))


# ------------------------------------------------------------------ critério 10: recusa na entrada, antes da fila


def _recusadas(m: dict) -> list[tuple[str, Proposta]]:
    ok = P(m)
    ctt = dict(classe="contato_mandato", registro_chave=str(m["man"]), campo="email:vereador@cidade-teste.example", valor_candidato="novo@cidade-teste.example", bloco="<div id=vereador-1>")
    return [
        ("url nula", replace(ok, url=None)), ("url vazia", replace(ok, url="")), ("url em branco", replace(ok, url="   ")), ("url ftp", replace(ok, url="ftp://a.example/x")),
        ("url javascript", replace(ok, url="javascript:alert(1)")), ("url sem esquema", replace(ok, url="a.example/api/")), ("url sem host", replace(ok, url="https://")),
        ("url com espaço", replace(ok, url="https://a.example/a b")),
        ("trecho nulo", replace(ok, trecho=None)), ("trecho vazio", replace(ok, trecho="")), ("trecho em branco", replace(ok, trecho="  \n ")),
        ("hash nulo", replace(ok, conteudo_sha256=None)), ("hash vazio", replace(ok, conteudo_sha256="")), ("hash curto", replace(ok, conteudo_sha256="abc")),
        ("hash 63", replace(ok, conteudo_sha256="a" * 63)), ("hash 65", replace(ok, conteudo_sha256="a" * 65)), ("hash não hexa", replace(ok, conteudo_sha256="g" * 64)),
        ("classe inválida", replace(ok, classe="pessoa")), ("classe nula", replace(ok, classe=None)),
        ("campo inválido", replace(ok, campo="nome")), ("campo de outra classe", replace(ok, campo="reason")), ("campo nulo", replace(ok, campo=None)),
        ("identidade com campo de SAPL", replace(ok, classe="identidade", registro_chave=str(m["q"]), campo="base_url", valor_candidato="https://a.example")),
        ("registro inexistente", replace(ok, registro_chave="999999999")), ("registro malformado", replace(ok, registro_chave="abc")), ("registro vazio", replace(ok, registro_chave="")),
        ("cobertura de lugar inexistente", replace(ok, classe="cobertura", registro_chave="ZZ99:presenca", campo="status", valor_candidato="so_portal")),
        ("cobertura de dataset inexistente", replace(ok, classe="cobertura", registro_chave=f"{IBGE}:xyz", campo="status", valor_candidato="so_portal")),
        ("mandato inexistente", Proposta(**{**ctt, "registro_chave": str(uuid.uuid4()), "url": "https://a.example/v", "trecho": "t", "conteudo_sha256": H("c"), "lida_em": AGORA})),
        ("mandato malformado", Proposta(**{**ctt, "registro_chave": "x", "url": "https://a.example/v", "trecho": "t", "conteudo_sha256": H("c"), "lida_em": AGORA})),
        ("contato sem bloco", Proposta(**{**ctt, "bloco": None, "url": "https://a.example/v", "trecho": "t", "conteudo_sha256": H("c"), "lida_em": AGORA})),
        ("contato com bloco em branco", Proposta(**{**ctt, "bloco": "  ", "url": "https://a.example/v", "trecho": "t", "conteudo_sha256": H("c"), "lida_em": AGORA})),
        ("contato que não existe (sem novo:)", Proposta(**{**ctt, "campo": "email:fantasma@x.example", "url": "https://a.example/v", "trecho": "t", "conteudo_sha256": H("c"), "lida_em": AGORA})),
        ("lida_em ausente", replace(ok, lida_em=None)), ("lida_em lixo", replace(ok, lida_em="ontem")),
        ("fonte_declarada_em no futuro", replace(ok, fonte_declarada_em=AGORA + timedelta(days=1))),
        ("candidato nulo", replace(ok, valor_candidato=None)), ("status de SAPL fora do domínio", replace(ok, valor_candidato="quebrado")),
        ("base_url que não é URL", replace(ok, campo="base_url", valor_candidato="não é url")),
        ("regra sem critério", replace(ok, alcance="regra", regra_ids=[str(m["h_cam"])])), ("regra com critério em branco", replace(ok, alcance="regra", regra_criterio=" ", regra_ids=[str(m["h_cam"])])),
        ("regra sem ids", replace(ok, alcance="regra", regra_criterio="mesma instalação")), ("regra com lista vazia", replace(ok, alcance="regra", regra_criterio="x", regra_ids=[])),
        ("regra sem o próprio registro", replace(ok, alcance="regra", regra_criterio="x", regra_ids=[str(m["h_ale"])])),
        ("regra com id inexistente", replace(ok, alcance="regra", regra_criterio="x", regra_ids=[str(m["h_cam"]), "999999999"])),
        ("critério sem alcance regra", replace(ok, regra_criterio="x")), ("alcance desconhecido", replace(ok, alcance="mundo")),
        ("rodada inexistente", replace(ok, rodada_id=str(uuid.uuid4()))), ("rodada malformada", replace(ok, rodada_id="não-é-uuid")),
    ]


def test_criterio_10_proposta_sem_evidencia_e_recusada_antes_da_fila_e_nada_e_gravado(iso, m):
    validar_ok = P(m)
    PR.validar(iso, validar_ok, agora=AGORA)  # a base das variantes é válida
    antes = tres(iso)
    casos = _recusadas(m)
    assert len(casos) >= 40
    for nome, p in casos:
        with pytest.raises(PropostaRecusada) as e:
            PR.registrar(iso, p, agora=AGORA)
        assert str(e.value).strip(), nome
        with pytest.raises(PropostaRecusada):
            PR.validar(iso, p, agora=AGORA)
        assert tres(iso) == antes, f"{nome}: a recusa gravou linha"
    assert antes == (0, 0, 0)


def test_criterio_10_o_proprio_banco_tambem_recusa_o_insert_direto_sem_url_trecho_ou_hash(iso):
    base = "insert into adm_propostas (classe, registro_chave, campo, url, trecho, conteudo_sha256, chave_idem) values ('vinculo_sapl', '1', 'status', %s, %s, %s, %s)"
    ok = ("https://a.example", "t", H("x"))
    for i, (args, erro) in enumerate((
        (("", ok[1], ok[2]), psycopg.errors.CheckViolation), (("   ", ok[1], ok[2]), psycopg.errors.CheckViolation),
        ((ok[0], "", ok[2]), psycopg.errors.CheckViolation), ((ok[0], "  ", ok[2]), psycopg.errors.CheckViolation),
        ((ok[0], ok[1], ""), psycopg.errors.CheckViolation), ((ok[0], ok[1], "xyz"), psycopg.errors.CheckViolation), ((ok[0], ok[1], "g" * 64), psycopg.errors.CheckViolation),
        ((None, ok[1], ok[2]), psycopg.errors.NotNullViolation), ((ok[0], None, ok[2]), psycopg.errors.NotNullViolation), ((ok[0], ok[1], None), psycopg.errors.NotNullViolation),
    )):
        with pytest.raises(erro):
            with iso.transaction():  # savepoint
                iso.execute(base, (*args, f"k{i}"))
    assert tres(iso) == (0, 0, 0)
    iso.execute(base, (*ok, "k-ok"))  # o insert válido passa: a recusa era dos check
    assert tres(iso)[0] == 1


def test_de_dict_recusa_campo_desconhecido_e_obrigatorio_ausente(iso, m):
    with pytest.raises(PropostaRecusada, match="valor_vigente"):
        Proposta.de_dict({**P(m).__dict__, "valor_vigente": "ok"})  # ninguém informa o vigente
    with pytest.raises(PropostaRecusada, match="ausente.*trecho"):
        Proposta.de_dict({k: v for k, v in P(m).__dict__.items() if k != "trecho"})
    with pytest.raises(PropostaRecusada, match="objeto"):
        Proposta.de_dict(["x"])
    assert "valor_vigente" not in {f.name for f in fields(Proposta)}


# ------------------------------------------------------------------ valor vigente, pendência e pergunta


def test_valor_vigente_gravado_e_o_do_banco_na_hora(iso, m):
    r = PR.registrar(iso, P(m), agora=AGORA)
    assert iso.execute("select valor_vigente from adm_propostas where id = %s", (r.proposta_id,)).fetchone()["valor_vigente"] == "ok"
    iso.execute("update sapl_houses set status = 'sem_api' where id = %s", (m["h_cam"],))  # o job regravou
    r2 = PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b1")), agora=AGORA)
    assert iso.execute("select valor_vigente from adm_propostas where id = %s", (r2.proposta_id,)).fetchone()["valor_vigente"] == "sem_api"
    # contato existente: o valor vigente é o próprio value; contato novo: nulo (SQL NULL, não o JSON 'null')
    c1 = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="email:vereador@cidade-teste.example", valor_candidato="outro@cidade-teste.example",
                             bloco="<li id=v1>", url="https://c.example/v1", conteudo_sha256=H("c1")), agora=AGORA)
    c2 = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="novo:site:https://vereador.example", valor_candidato="https://vereador.example", bloco="<li id=v1>",
                             url="https://c.example/v1", conteudo_sha256=H("c1")), agora=AGORA)
    assert iso.execute("select valor_vigente from adm_propostas where id = %s", (c1.proposta_id,)).fetchone()["valor_vigente"] == "vereador@cidade-teste.example"
    assert iso.execute("select valor_vigente is null as n from adm_propostas where id = %s", (c2.proposta_id,)).fetchone()["n"] is True


def test_candidato_igual_ao_vigente_nao_abre_pendencia_e_diferente_abre_uma_com_pergunta_de_uma_frase(iso, m):
    r = PR.registrar(iso, P(m, valor_candidato="ok"), agora=AGORA)
    assert r.nova and r.confirmada_pela_fonte and r.pendencia_id is None and tres(iso) == (1, 0, 0)

    r = PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("a2")), agora=AGORA)
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert (r.pendencia_acao, r.tipo) == ("criada", "mudanca") and str(pend["id"]) == r.pendencia_id
    assert pend["status"] == "aberta" and pend["tipo"] == "mudanca" and pend["reaberta"] is False and pend["motivo_reabertura"] is None
    assert pend["pergunta"] == "O status do SAPL desta casa mudou de 'ok' para 'fora_do_ar'?"
    assert pend["pergunta"].count("?") == 1 and pend["pergunta"].endswith("?") and "\n" not in pend["pergunta"]
    assert pend["evidencia_sha"] == H("a2") and pend["vigente_sha"] == H('"ok"') and pend["vence_em"] == AGORA + timedelta(days=7)
    assert ligadas(iso, pend["id"]) == 1 and tres(iso) == (2, 1, 1)
    assert iso.execute("select count(*) as n from sapl_houses where id = %s and status = 'ok'", (m["h_cam"],)).fetchone()["n"] == 1  # nada aplicado


def test_prazo_pergunta_e_tipo_de_cada_classe(iso, m):
    casos = [
        (P(m, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato="so_portal"), 8, "carregando", "so_portal"),
        (P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="telefone:1100000000", valor_candidato="1199999999", bloco="<li id=v1>"), 7, "1100000000", "1199999999"),
        (P(m, classe="identidade", registro_chave=str(m["q"]), campo="status", valor_candidato="aceito"), None, "pendente", "aceito"),
        (P(m, classe="vinculo_sapl", campo="base_url", valor_candidato="https://novo.cidade-teste.example"), 7, BASE_CAMARA, "https://novo.cidade-teste.example"),
    ]
    for i, (p, dias, vig, cand) in enumerate(casos):
        r = PR.registrar(iso, replace(p, url=f"https://f{i}.example/x", conteudo_sha256=H(f"h{i}")), agora=AGORA)
        pend = pendencia(iso, p.classe, p.registro_chave, p.campo)
        assert r.pendencia_acao == "criada" and pend["tipo"] == "mudanca"
        assert pend["vence_em"] == (None if dias is None else AGORA + timedelta(days=dias)), p.classe
        assert vig in pend["pergunta"] and cand in pend["pergunta"] and pend["pergunta"].endswith("?") and pend["pergunta"].count("?") == 1
    # contato que ainda não existe: a pergunta é de cadastro
    PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="novo:email:novo@cidade-teste.example", valor_candidato="novo@cidade-teste.example", bloco="<li>", url="https://f9.example/x",
                        conteudo_sha256=H("h9")), agora=AGORA)
    pend = pendencia(iso, "contato_mandato", str(m["man"]), "novo:email:novo@cidade-teste.example")
    assert "novo@cidade-teste.example" in pend["pergunta"] and pend["pergunta"].endswith("?") and pend["tipo"] == "mudanca"


# ------------------------------------------------------------------ critério 4 (parte de propostas): repetir não cria nada


def test_criterio_4_repetir_a_mesma_proposta_cria_zero_linha_e_nao_altera_nada(iso, m):
    rod = iso.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"]
    rod2 = iso.execute("insert into adm_rodadas (coletor, modo, status, repete_id) values ('sapl.assembleias', 'recoletar', 'concluida', %s) returning id", (rod,)).fetchone()["id"]
    p = P(m, rodada_id=str(rod))
    r1 = PR.registrar(iso, p, agora=AGORA)
    snap = (iso.execute("select * from adm_propostas order by id").fetchall(), iso.execute("select * from adm_pendencias order by id").fetchall(),
            iso.execute("select * from adm_pendencia_propostas order by proposta_id").fetchall())
    for repetida in (p, replace(p, conteudo_sha256=p.conteudo_sha256.upper()), replace(p, rodada_id=str(rod2), lida_em=AGORA), replace(p, trecho="outro trecho")):
        r2 = PR.registrar(iso, repetida, agora=AGORA + timedelta(days=3))
        assert r2.nova is False and r2.proposta_id == r1.proposta_id and r2.pendencia_id == r1.pendencia_id
        assert (iso.execute("select * from adm_propostas order by id").fetchall(), iso.execute("select * from adm_pendencias order by id").fetchall(),
                iso.execute("select * from adm_pendencia_propostas order by proposta_id").fetchall()) == snap
    # outra URL confirma o vigente com a pendência aberta: liga (divergência) e, repetida, também não cria nada
    q = P(m, valor_candidato="ok", url="https://z.example/api/", conteudo_sha256=H("z"))
    a = PR.registrar(iso, q, agora=AGORA)
    b = PR.registrar(iso, q, agora=AGORA)
    assert a.nova and not b.nova and b.proposta_id == a.proposta_id and tres(iso) == (2, 1, 2) and a.tipo == "divergencia"
    # campo confirmado pela fonte, sem pendência (outro campo), também é idempotente
    q2 = P(m, campo="base_url", valor_candidato=BASE_CAMARA, url="https://z.example/api/", conteudo_sha256=H("z"))
    a, b = PR.registrar(iso, q2, agora=AGORA), PR.registrar(iso, q2, agora=AGORA)
    assert a.nova and a.confirmada_pela_fonte and not b.nova and b.proposta_id == a.proposta_id and tres(iso) == (3, 1, 2)


# ------------------------------------------------------------------ critério 7: fontes divergentes


def test_criterio_7_duas_fontes_valores_diferentes_uma_pendencia_dois_valores_nenhum_aplicado(iso, m):
    a = PR.registrar(iso, P(m, url="https://a.example/api/", conteudo_sha256=H("a"), valor_candidato="fora_do_ar", lida_em=AGORA - timedelta(days=1)), agora=AGORA)
    b = PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b"), valor_candidato="sem_api", lida_em=AGORA), agora=AGORA)
    assert a.tipo == "mudanca" and (b.pendencia_acao, b.tipo) == ("ligada", "divergencia") and a.pendencia_id == b.pendencia_id
    assert iso.execute("select count(*) as n from adm_pendencias").fetchone()["n"] == 1
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert pend["tipo"] == "divergencia" and pend["status"] == "aberta" and ligadas(iso, pend["id"]) == 2
    cands = {r["valor_candidato"] for r in iso.execute("select valor_candidato from adm_propostas").fetchall()}
    assert cands == {"fora_do_ar", "sem_api"}
    p = pend["pergunta"]
    assert "'fora_do_ar'" in p and "'sem_api'" in p and "2026-11-14" in p and "2026-11-15" in p and "a.example" in p and "b.example" in p and p.endswith("?") and p.count("?") == 1
    assert iso.execute("select status from sapl_houses where id = %s", (m["h_cam"],)).fetchone()["status"] == "ok"  # nenhum aplicado


def test_duas_urls_com_o_mesmo_candidato_nao_viram_divergencia(iso, m):
    PR.registrar(iso, P(m, url="https://a.example/api/", conteudo_sha256=H("a")), agora=AGORA)
    r = PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b")), agora=AGORA)
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert r.tipo == "mudanca" and pend["tipo"] == "mudanca" and ligadas(iso, pend["id"]) == 2


def test_fonte_que_confirma_o_vigente_e_outra_que_difere_sao_divergencia_com_as_duas_ligadas(iso, m):
    a = PR.registrar(iso, P(m, url="https://a.example/api/", conteudo_sha256=H("a"), valor_candidato="ok", lida_em=AGORA - timedelta(days=1)), agora=AGORA)
    assert a.pendencia_id is None
    b = PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b"), valor_candidato="fora_do_ar", lida_em=AGORA), agora=AGORA)
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert (b.pendencia_acao, b.tipo, pend["tipo"]) == ("criada", "divergencia", "divergencia") and ligadas(iso, pend["id"]) == 2
    assert "'ok'" in pend["pergunta"] and "'fora_do_ar'" in pend["pergunta"]


def test_divergencia_some_quando_a_mesma_url_corrige_o_valor_e_a_ultima_leitura_de_cada_url_vale(iso, m):
    PR.registrar(iso, P(m, url="https://a.example/api/", conteudo_sha256=H("a"), valor_candidato="fora_do_ar", lida_em=AGORA - timedelta(days=2)), agora=AGORA)
    PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b"), valor_candidato="sem_api", lida_em=AGORA - timedelta(days=1)), agora=AGORA)
    assert pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")["tipo"] == "divergencia"
    PR.registrar(iso, P(m, url="https://b.example/api/", conteudo_sha256=H("b2"), valor_candidato="fora_do_ar", lida_em=AGORA), agora=AGORA)  # b releu e agora concorda
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert pend["tipo"] == "mudanca" and ligadas(iso, pend["id"]) == 3 and "sem_api" not in pend["pergunta"] and pend["evidencia_sha"] == H("b2")


# ------------------------------------------------------------------ critério 8: reabertura


def _decidida(iso, m, **kw):
    r = PR.registrar(iso, P(m, **kw), agora=AGORA)
    decidir(iso, r.pendencia_id)
    return r.pendencia_id


def test_criterio_8_hash_da_evidencia_mudou_reabre_pendencia_ja_decidida(iso, m):
    pid = _decidida(iso, m, conteudo_sha256=H("a1"))
    assert pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")["status"] == "decidida"
    depois = AGORA + timedelta(days=2)
    r = PR.registrar(iso, P(m, conteudo_sha256=H("a2"), lida_em=depois), agora=depois)
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert r.pendencia_acao == "reaberta" and r.motivo_reabertura == "evidencia_mudou" and str(pend["id"]) == pid
    assert (pend["status"], pend["reaberta"], pend["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou")
    assert pend["evidencia_sha"] == H("a2") and pend["vigente_sha"] == H('"ok"') and pend["vence_em"] == depois + timedelta(days=7) and ligadas(iso, pid) == 2


def test_criterio_8_mesmo_hash_e_mesmo_vigente_continua_decidida(iso, m):
    pid = _decidida(iso, m, conteudo_sha256=H("a1"))
    antes = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    # repetição exata: nem proposta nova
    r = PR.registrar(iso, P(m, conteudo_sha256=H("a1")), agora=AGORA + timedelta(days=1))
    assert r.nova is False and pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status") == antes
    # outra URL com o MESMO hash: proposta nova, ligada, mas nada mudou: continua decidida
    r = PR.registrar(iso, P(m, conteudo_sha256=H("a1"), url="https://outra.example/api/"), agora=AGORA + timedelta(days=1))
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert r.nova and r.pendencia_acao == "ligada_decidida" and pend["status"] == "decidida" and pend["reaberta"] is False and ligadas(iso, pid) == 2
    assert {k: v for k, v in pend.items() if k != "pergunta"} == {k: v for k, v in antes.items() if k != "pergunta"}


def test_valor_vigente_mudou_e_chega_proposta_com_o_mesmo_hash_reabre_por_registro_mudou(iso, m):
    pid = _decidida(iso, m, conteudo_sha256=H("a1"))
    iso.execute("update sapl_houses set status = 'sem_api' where id = %s", (m["h_cam"],))
    r = PR.registrar(iso, P(m, conteudo_sha256=H("a1"), url="https://outra.example/api/"), agora=AGORA)
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert (r.pendencia_acao, r.motivo_reabertura) == ("reaberta", "registro_mudou") and (pend["status"], pend["reaberta"], pend["motivo_reabertura"]) == ("aberta", True, "registro_mudou")
    assert pend["vigente_sha"] == H('"sem_api"') and str(pend["id"]) == pid


def test_reavaliar_reabre_so_o_que_mudou_no_banco_desde_a_decisao(iso, m):
    pid = _decidida(iso, m, conteudo_sha256=H("a1"))
    pid_cob = PR.registrar(iso, P(m, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato="so_portal", url="https://f.example/x", conteudo_sha256=H("f")),
                           agora=AGORA).pendencia_id
    decidir(iso, pid_cob)
    assert PR.reavaliar(iso, agora=AGORA) == []  # nada mudou: nada reabre
    assert pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")["status"] == "decidida"
    iso.execute("update sapl_houses set status = 'fora_do_ar' where id = %s", (m["h_cam"],))  # o job regravou a tabela, sem nova proposta
    assert PR.reavaliar(iso, classe="cobertura", agora=AGORA) == []  # filtro por classe
    r = PR.reavaliar(iso, agora=AGORA + timedelta(days=1))
    assert [(x["id"], x["classe"]) for x in r] == [(pid, "vinculo_sapl")]
    pend = pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")
    assert (pend["status"], pend["reaberta"], pend["motivo_reabertura"]) == ("aberta", True, "registro_mudou") and pend["vigente_sha"] == H('"fora_do_ar"')
    assert pend["vence_em"] == AGORA + timedelta(days=8) and pend["pergunta"].endswith("?") and "'fora_do_ar'" in pend["pergunta"]
    assert pendencia(iso, "cobertura", f"{IBGE}:propostas", "status")["status"] == "decidida"
    assert PR.reavaliar(iso, agora=AGORA) == []  # a segunda passada não reabre de novo
    with pytest.raises(ErroAdmin):
        PR.reavaliar(iso, classe="pessoa")


def test_contato_que_deixou_de_existir_conta_como_registro_mudado(iso, m):
    pid = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="email:vereador@cidade-teste.example", valor_candidato="outro@cidade-teste.example",
                              bloco="<li id=v1>", url="https://c.example/v1", conteudo_sha256=H("c1")), agora=AGORA).pendencia_id
    decidir(iso, pid)
    iso.execute("delete from mandate_contacts where mandate_id = %s and kind = 'email'", (m["man"],))
    assert [x["id"] for x in PR.reavaliar(iso, classe="contato_mandato", agora=AGORA)] == [pid]


# ------------------------------------------------------------------ Assembleia, territorio, regra


def test_assembleia_base_url_gera_confirmacao_e_status_gera_mudanca(iso, m):
    h = str(m["h_ale"])
    assert CL.CLASSES["vinculo_sapl"].aceita_override(iso, h, "base_url") is False
    assert CL.CLASSES["vinculo_sapl"].aceita_override(iso, h, "status") is True
    assert CL.CLASSES["vinculo_sapl"].aceita_override(iso, str(m["h_cam"]), "base_url") is True
    assert all(CL.CLASSES[c].aceita_override(iso, "x", "y") for c in ("cobertura", "contato_mandato", "identidade"))
    r = PR.registrar(iso, P(m, registro_chave=h, campo="base_url", valor_candidato="https://sapl.al.novo.example", url="https://a.example/x"), agora=AGORA)
    assert r.tipo == "confirmacao" and pendencia(iso, "vinculo_sapl", h, "base_url")["tipo"] == "confirmacao"
    r = PR.registrar(iso, P(m, registro_chave=h, campo="status", valor_candidato="fora_do_ar", url="https://a.example/x"), agora=AGORA)
    assert r.tipo == "mudanca" and pendencia(iso, "vinculo_sapl", h, "status")["tipo"] == "mudanca"
    assert BASE_ALE in pendencia(iso, "vinculo_sapl", h, "base_url")["pergunta"]
    # divergência vence o tipo básico
    r = PR.registrar(iso, P(m, registro_chave=h, campo="base_url", valor_candidato="https://sapl.al.outro.example", url="https://b.example/x", conteudo_sha256=H("b")), agora=AGORA)
    assert r.tipo == "divergencia"


def test_territorio_por_classe_e_identidade_sem_territorio_sem_ler_local_de_nascimento(iso, m):
    C = CL.CLASSES
    assert C["vinculo_sapl"].territorio(iso, str(m["h_cam"])) == {"ibge_code": IBGE, "nivel": "municipio"}
    assert C["vinculo_sapl"].territorio(iso, str(m["h_ale"])) == {"ibge_code": "11", "nivel": "uf"}
    assert C["cobertura"].territorio(iso, f"{IBGE}:propostas") == {"ibge_code": IBGE, "nivel": "municipio"}
    assert C["contato_mandato"].territorio(iso, str(m["man"])) == {"ibge_code": IBGE, "nivel": "municipio"}
    assert C["identidade"].territorio(iso, str(m["q"])) is None
    assert "território" in C["identidade"].motivo_sem_territorio(iso, str(m["q"]))
    # mesmo com a pessoa do mandato nascida em um lugar, o território do contato é o do mandato e o da identidade segue nulo
    iso.execute("update people set birthplace_place_id = %s where id = %s", (m["ro"], m["pessoa"]))
    assert C["contato_mandato"].territorio(iso, str(m["man"])) == {"ibge_code": IBGE, "nivel": "municipio"}
    assert C["identidade"].territorio(iso, str(m["q"])) is None
    fonte = inspect.getsource(CL).lower()
    assert "birthplace" not in fonte and "nascimento" in fonte  # nenhuma leitura de people.birthplace_place_id


def test_alcance_regra_exige_criterio_e_ids_e_grava_a_lista(iso, m):
    base = dict(alcance="regra", regra_criterio="mesma instalação SAPL para as duas casas")
    for kw in (dict(), dict(regra_ids=[]), dict(regra_ids=[str(m["h_ale"])]), dict(regra_ids=[str(m["h_cam"]), "999999999"])):
        with pytest.raises(PropostaRecusada):
            PR.registrar(iso, P(m, **base, **kw), agora=AGORA)
    with pytest.raises(PropostaRecusada):
        PR.registrar(iso, P(m, alcance="regra", regra_ids=[str(m["h_cam"])]), agora=AGORA)
    assert tres(iso) == (0, 0, 0)
    r = PR.registrar(iso, P(m, **base, regra_ids=[str(m["h_ale"]), str(m["h_cam"])]), agora=AGORA)
    row = iso.execute("select alcance, regra_criterio, regra_ids from adm_propostas where id = %s", (r.proposta_id,)).fetchone()
    assert row == {"alcance": "regra", "regra_criterio": base["regra_criterio"], "regra_ids": sorted([str(m["h_ale"]), str(m["h_cam"])])}
    r2 = PR.registrar(iso, P(m, url="https://z.example/api/", conteudo_sha256=H("z")), agora=AGORA)  # alcance do registro: sem critério nem ids
    assert iso.execute("select alcance, regra_criterio, regra_ids from adm_propostas where id = %s", (r2.proposta_id,)).fetchone() == {"alcance": "registro", "regra_criterio": None, "regra_ids": None}


# ------------------------------------------------------------------ coerência com o relatório e cobertura do recorte


def test_relatorio_da_rodada_com_propostas_de_registrar_tem_zero_sem_pendencia_aberta_e_totais_coerentes(iso, m):
    rod = str(iso.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"])
    h = str(m["h_cam"])
    PR.registrar(iso, P(m, campo="base_url", valor_candidato=BASE_CAMARA, rodada_id=rod, url="https://a.example/x", conteudo_sha256=H("1")), agora=AGORA)  # confirma o vigente
    PR.registrar(iso, P(m, campo="status", valor_candidato="fora_do_ar", rodada_id=rod, url="https://a.example/x", conteudo_sha256=H("2")), agora=AGORA)  # mudanca
    for i, cand in enumerate(("so_portal", "nao_publica")):  # divergencia
        PR.registrar(iso, P(m, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato=cand, rodada_id=rod, url=f"https://c{i}.example/x",
                            conteudo_sha256=H(f"3{i}")), agora=AGORA)
    PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="novo:email:x@cidade-teste.example", valor_candidato="x@cidade-teste.example", bloco="<li>", rodada_id=rod,
                        url="https://d.example/x", conteudo_sha256=H("4")), agora=AGORA)  # vigente nulo: pendente
    rev = REL.relatorio(iso, rod)["revisao"]
    assert rev["campos_com_proposta"]["valor"] == 4
    assert rev["pendentes"]["sem_pendencia_aberta"]["valor"] == 0 and rev["pendentes"]["sem_pendencia_aberta"]["ids"] == []
    assert rev["confirmados"]["pela_fonte"]["ids"] == [f"vinculo_sapl:{h}:base_url"] and rev["confirmados"]["por_decisao"]["valor"] == 0
    assert rev["conflitantes"]["ids"] == [f"cobertura:{IBGE}:propostas:status"]
    assert rev["pendentes"]["ids"] == sorted([f"vinculo_sapl:{h}:status", f"contato_mandato:{m['man']}:novo:email:x@cidade-teste.example"])
    assert rev["pendencias_reabertas"]["valor"] == 0


def test_cobertura_recorte_e_alcancados_sobre_elegiveis_e_nulo_sem_lista(iso, m):
    h1, h2 = str(m["h_cam"]), str(m["h_ale"])
    previa = {"registros_elegiveis": {"classe": "vinculo_sapl", "valor": 2, "chaves": [{"sapl_houses_id": h1}, {"sapl_houses_id": h2}], "motivo": None}}
    rod = str(iso.execute("insert into adm_rodadas (coletor, modo, status, previa) values ('sapl.assembleias', 'recoletar', 'concluida', %s::jsonb) returning id", (json.dumps(previa),)).fetchone()["id"])
    iso.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem) values ('vinculo_sapl', %s, %s, %s, 'descoberta_automatica')", (h1, BASE_CAMARA, H(BASE_CAMARA)))
    lida = BASE_CAMARA + "/api/"
    iso.execute("insert into adm_tentativas (rodada_id, url, url_sha, resultado, entrada) values (%s, %s, %s, 'lida', true)", (rod, lida, H(lida)))
    assert REL.relatorio(iso, rod)["coleta"]["registros_alcancados"]["valor"] == 1  # 1 de 2
    cache: dict = {}
    PR.registrar(iso, P(m, rodada_id=rod), agora=AGORA, cache_recorte=cache)
    assert float(pendencia(iso, "vinculo_sapl", h1, "status")["cobertura_recorte"]) == 0.5 and cache == {rod: 0.5}
    # rodada sem lista de elegíveis: denominador nulo, cobertura nula (nunca zero no lugar de desconhecido)
    sem = str(iso.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"])
    PR.registrar(iso, P(m, campo="base_url", valor_candidato="https://outra.cidade-teste.example", rodada_id=sem, url="https://q.example/x", conteudo_sha256=H("q")), agora=AGORA)
    assert pendencia(iso, "vinculo_sapl", h1, "base_url")["cobertura_recorte"] is None
    # proposta sem rodada: nulo
    PR.registrar(iso, P(m, campo="base_url", valor_candidato="https://terceira.cidade-teste.example", url="https://r.example/x", conteudo_sha256=H("r")), agora=AGORA)
    assert pendencia(iso, "vinculo_sapl", h1, "base_url")["cobertura_recorte"] is None


# ------------------------------------------------------------------ pela CLI real (comita; banco isolado; limpeza em finally)


def test_cli_proposta_fila_e_pendencia_codigos_e_json(banco_isolado, monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("ETL_DATABASE_URL", banco_isolado)
    monkeypatch.setenv("DATABASE_URL", banco_isolado)
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    m = None
    try:
        m = mundo(c)
        c.commit()
        boa = {"classe": "vinculo_sapl", "registro_chave": str(m["h_cam"]), "campo": "status", "valor_candidato": "fora_do_ar", "url": "https://a.example/api/",
               "trecho": "$.status", "conteudo_sha256": H("a1"), "lida_em": "2026-11-14T12:00:00Z", "fonte_declarada_em": "2026-11-10T00:00:00Z", "fonte_slug": "sapl"}
        ruim = {**boa, "campo": "base_url", "valor_candidato": "https://x.example", "trecho": ""}
        arq = tmp_path / "propostas.json"
        arq.write_text(json.dumps([boa, ruim]), encoding="utf-8")
        capsys.readouterr()

        assert cli.main(["admin", "proposta", "registrar", "--arquivo", str(arq), "--json"]) == 1  # uma recusada
        doc = json.loads(capsys.readouterr().out)
        assert [r["resultado"] for r in doc["resultados"]] == ["nova", "recusada"] and "trecho" in doc["resultados"][1]["motivo"]
        assert doc["totais"] == {"nova": 1, "repetida": 0, "recusada": 1, "erro": 0} and "FORAM gravadas" in doc["aviso"]
        assert c.execute("select (select count(*) from adm_propostas) as p, (select count(*) from adm_pendencias) as d").fetchone() == {"p": 1, "d": 1}  # a boa foi gravada, a ruim não
        pid = doc["resultados"][0]["pendencia"]["id"]

        assert cli.main(["admin", "proposta", "registrar", "--arquivo", str(arq)]) == 1  # tabela: repetida e recusada
        txt = capsys.readouterr().out
        assert "repetida" in txt and "recusada" in txt and "trecho" in txt
        arq.write_text(json.dumps(boa), encoding="utf-8")  # um objeto só
        assert cli.main(["admin", "proposta", "registrar", "--arquivo", str(arq), "--json"]) == 0
        assert json.loads(capsys.readouterr().out)["totais"]["repetida"] == 1
        assert c.execute("select count(*) as n from adm_propostas").fetchone()["n"] == 1

        assert cli.main(["admin", "fila", "--json"]) == 0
        fila = json.loads(capsys.readouterr().out)
        assert [i["id"] for i in fila] == [pid] and fila[0]["territorio"] == {"ibge_code": IBGE, "nivel": "municipio"} and fila[0]["valor_vigente"] == "ok"
        assert cli.main(["admin", "fila", "--classe", "cobertura", "--json"]) == 0 and json.loads(capsys.readouterr().out) == []
        assert cli.main(["admin", "fila"]) == 0 and "1 pendências abertas" in capsys.readouterr().out
        assert cli.main(["admin", "pendencia", pid, "--json"]) == 0
        det = json.loads(capsys.readouterr().out)
        assert det["id"] == pid and det["decisoes"] == [] and len(det["propostas"]) == 1 and det["propostas"][0]["conteudo_sha256"] == H("a1") and len(det["historico"]) == 1
        assert cli.main(["admin", "pendencia", pid]) == 0 and "propostas ligadas" in capsys.readouterr().out
        assert cli.main(["admin", "pendencia", "reavaliar", "--json"]) == 0 and json.loads(capsys.readouterr().out) == {"reabertas": [], "total": 0}

        # erros: código, mensagem em stderr, sem traceback
        arq.write_text("{não é json", encoding="utf-8")
        for argv, cod, msg in ((["admin", "proposta", "registrar", "--arquivo", str(arq)], 1, "JSON válido"), (["admin", "proposta", "registrar", "--arquivo", str(tmp_path / "nao.json")], 1, "não foi possível ler"),
                               (["admin", "proposta", "registrar"], 2, "--arquivo"), (["admin", "pendencia", "xyz"], 1, "inválido"), (["admin", "pendencia", str(uuid.uuid4())], 1, "inexistente"),
                               (["admin", "pendencia", pid, "--classe", "cobertura"], 2, "reavaliar"), (["admin", "fila", "--limite", "0"], 2, "maior que zero")):
            assert cli.main(argv) == cod
            cap = capsys.readouterr()
            assert cap.out == "" and msg in cap.err and "Traceback" not in cap.err
    finally:
        c.rollback()
        c.execute("delete from adm_pendencias")
        c.execute("delete from adm_propostas")
        if m is not None:
            desfazer(c, m)
        else:
            c.commit()
        c.close()
    with psycopg.connect(banco_isolado, row_factory=dict_row) as c2:
        assert c2.execute("select (select count(*) from adm_propostas) + (select count(*) from adm_pendencias) + (select count(*) from sapl_houses) as n").fetchone()["n"] == 0


# ------------------------------------------------------------------ B2, ponto F: contato novo leva o valor no campo (`novo:<kind>:<value>`)


def test_dois_contatos_novos_do_mesmo_tipo_sao_duas_pendencias_independentes_e_nao_divergencia(iso, m):
    man = str(m["man"])
    r1 = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=man, campo="novo:email:a@cidade-teste.example", valor_candidato="a@cidade-teste.example", bloco="<li id=v1>",
                             url="https://c.example/v1", conteudo_sha256=H("c1")), agora=AGORA)
    r2 = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=man, campo="novo:email:b@cidade-teste.example", valor_candidato="b@cidade-teste.example", bloco="<li id=v1>",
                             url="https://c.example/v1", conteudo_sha256=H("c1")), agora=AGORA)
    assert r1.pendencia_id != r2.pendencia_id and (r1.tipo, r2.tipo) == ("mudanca", "mudanca")
    assert "a@cidade-teste.example" in pendencia(iso, "contato_mandato", man, "novo:email:a@cidade-teste.example")["pergunta"]
    assert iso.execute("select count(*) as n from adm_pendencias where classe = 'contato_mandato' and tipo = 'divergencia'").fetchone()["n"] == 0
    # o formato antigo (sem valor no campo) e o candidato que não é o do campo são recusados
    for campo, cand in (("novo:email", "a@cidade-teste.example"), ("novo:email:a@cidade-teste.example", "b@cidade-teste.example"), ("novo:fax:123", "123"), ("novo:email:", "x")):
        with pytest.raises(PropostaRecusada):
            PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=man, campo=campo, valor_candidato=cand, bloco="<li>", url="https://c.example/v2", conteudo_sha256=H("c2")), agora=AGORA)
