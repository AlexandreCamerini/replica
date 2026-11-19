"""FABRICADO. Parte B (B2): registro de decisões (`admin.decisoes`) e aplicação às tabelas de domínio (`admin.aplicar`); critérios 11 e 12 têm arquivos próprios
(`test_admin_sobrevive.py`, `test_admin_leitor.py`).

Sem rede, sem skip. Quase tudo roda no banco isolado, numa transação que reverte no fim (o gatilho de `adm_decisoes` proíbe apagar decisão). O que passa pela CLI real
(que abre a própria conexão e comita) grava com commit e é desfeito em `finally` com `session_replication_role = replica` (a mesma técnica de `test_admin_migracao.py`).
Nada é gravado no banco da suíte: o módulo compara as contagens de antes e depois (inclusive `corrections` e `pipeline_switches`).
"""

from __future__ import annotations

import json
import re
import socket
import uuid
from datetime import timedelta
from pathlib import Path

import psycopg
import pytest
from banco_isolado import REPO, banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg import errors as pe
from psycopg.rows import dict_row
from test_admin_propostas import AGORA, H, P, iso, ligadas, m, pendencia  # noqa: F401  (fixtures iso e m)
from test_admin_vinculos import BASE_CAMARA, IBGE, desfazer, mundo

from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import propostas as PR
from civico_etl.admin.aplicar import AplicacaoRecusada, ChavesDesligadas
from civico_etl.admin.decisoes import DecisaoRecusada
from civico_etl.admin.saida import ErroAdmin

POR = dict(por_tipo="pessoa", por_nome="Fulana de Teste", justificativa="conferi na página da casa")
SUITE = ("adm_decisoes", "adm_overrides", "adm_pendencias", "adm_vinculos", "corrections", "pipeline_switches", "sapl_houses", "data_coverage", "mandate_contacts", "mandates",
         "identity_match_queue", "person_external_ids", "people", "ingest_runs")


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


# F3-T1 (anti-SSRF em `decisoes.decidir`): a decisão que grava `base_url` resolve o nome no DNS. Os testes existentes usam hosts `.example` (que não resolvem); o DNS de teste os
# resolve para um IP público fixo, sem rede. Os nomes de `DNS_TESTE` resolvem para o que o teste quiser; o resto passa para o resolvedor real (localhost do banco).
DNS_TESTE: dict[str, list[str]] = {}


@pytest.fixture(autouse=True)
def _dns_de_teste(monkeypatch):
    real = socket.getaddrinfo

    def falso(host, *a, **k):
        if str(host) in DNS_TESTE or str(host).endswith(".example"):
            return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in DNS_TESTE.get(str(host), ["93.184.216.34"])]
        return real(host, *a, **k)

    monkeypatch.setattr(socket, "getaddrinfo", falso)
    DNS_TESTE.clear()
    yield
    DNS_TESTE.clear()


@pytest.fixture(scope="module", autouse=True)
def suite_intacta():
    """Nada deste módulo pode tocar o banco da suíte. Sem banco, falha (nenhum skip)."""
    antes = _contagens(database_url())
    yield
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


# ------------------------------------------------------------------ apoio


def n(c, tabela: str, onde: str = "true", *p) -> int:
    return c.execute(f"select count(*) as n from {tabela} where {onde}", p or None).fetchone()["n"]  # noqa: S608


def um(c, sql: str, *p):
    return c.execute(sql, p or None).fetchone()


def prop_status(iso, m, cand: str = "fora_do_ar", sha: str = "a1", url: str = "https://a.example/api/") -> str:
    """Pendência de `status` da Câmara de Cidade Teste (hoje 'ok')."""
    return PR.registrar(iso, P(m, valor_candidato=cand, conteudo_sha256=H(sha), url=url), agora=AGORA).pendencia_id


def prop_cob(iso, m, campo: str, cand: str, sha: str = "c1", url: str = "https://cob.example/x") -> str:
    return PR.registrar(iso, P(m, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo=campo, valor_candidato=cand, conteudo_sha256=H(sha), url=url), agora=AGORA).pendencia_id


def prop_contato(iso, m, campo: str, cand: str, sha: str = "k1", url: str = "https://c.example/v1") -> str:
    return PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo=campo, valor_candidato=cand, bloco="<li id=v1>", conteudo_sha256=H(sha), url=url),
                        agora=AGORA).pendencia_id


def decide(iso, pid, acao: str = "aprovar", **kw) -> dict:
    return DEC.decidir(iso, pid, acao=acao, **{**POR, **kw})


def sem_reabrir(iso) -> None:
    """Depois de aplicar, `reavaliar` NÃO pode reabrir nada: o `vigente_sha` foi atualizado."""
    assert PR.reavaliar(iso, agora=AGORA) == []


def pessoa(c, slug: str) -> str:
    return str(um(c, "insert into people (slug, display_name) values (%s, %s) returning id", slug, "Pessoa " + slug)["id"])


def fila_com_candidato(c, m, ext: str = "EXT-B2-1") -> tuple[str, str]:
    """Item de identity_match_queue (fonte camara) com pessoa candidata; devolve (id do item, id da pessoa)."""
    p = pessoa(c, "cand-" + ext.lower())
    src = um(c, "select id from sources where slug = 'camara'")["id"]
    q = um(c, "insert into identity_match_queue (source_id, external_id, raw, candidate_person_id, confidence, status) values (%s, %s, '{}'::jsonb, %s, 0.8, 'pendente') returning id", src, ext, p)["id"]
    return str(q), p


def prop_ident(iso, m, q: str, cand: str, sha: str = "i1") -> str:
    return PR.registrar(iso, P(m, classe="identidade", registro_chave=q, campo="status", valor_candidato=cand, conteudo_sha256=H(sha), url="https://i.example/x"), agora=AGORA).pendencia_id


# ------------------------------------------------------------------ 1. registro da decisão


def test_cada_acao_grava_quem_quando_justificativa_e_campos_afetados(iso, m):
    h = str(m["h_cam"])
    # aprovar
    pid = prop_status(iso, m)
    d = decide(iso, pid, "aprovar")
    r = um(iso, "select * from adm_decisoes where id = %s", d["id"])
    assert (r["acao"], r["decidido_por_tipo"], r["decidido_por_nome"], r["justificativa"]) == ("aprovar", "pessoa", "Fulana de Teste", "conferi na página da casa")
    assert r["campos_afetados"] == [f"vinculo_sapl:{h}:status"] and r["valor"] == "fora_do_ar" and r["aplicada"] is False and r["aplicada_em"] is None and r["criada_em"] is not None
    assert r["relatorio"] is None and r["versao_verificador"] is None
    assert pendencia(iso, "vinculo_sapl", h, "status")["status"] == "decidida"
    assert um(iso, "select status from sapl_houses where id = %s", h)["status"] == "ok"  # decidir não aplica

    # corrigir: o valor informado, não o candidato
    pid2 = prop_cob(iso, m, "status", "so_portal")
    d2 = decide(iso, pid2, "corrigir", valor="nao_publica", justificativa="a página diz que não publica")
    assert (d2["acao"], d2["valor"], d2["campos_afetados"]) == ("corrigir", "nao_publica", [f"cobertura:{IBGE}:propostas:status"])
    assert pendencia(iso, "cobertura", f"{IBGE}:propostas", "status")["status"] == "decidida"

    # descartar: grava a decisão (a trilha diz quem e por quê), sem valor
    pid3 = prop_cob(iso, m, "reason", "texto novo do motivo", sha="c3")
    d3 = decide(iso, pid3, "descartar", justificativa="o texto novo é pior que o atual")
    assert (d3["acao"], d3["valor"], d3["decidido_por_nome"], d3["justificativa"]) == ("descartar", None, "Fulana de Teste", "o texto novo é pior que o atual")
    assert pendencia(iso, "cobertura", f"{IBGE}:propostas", "reason")["status"] == "decidida"

    # pedir_confirmacao: a pendência continua aberta, com tipo `confirmacao` e a pergunta acrescida do pedido
    pid4 = prop_cob(iso, m, "evidence_url", "https://novo.example/evid", sha="c4")
    antes = pendencia(iso, "cobertura", f"{IBGE}:propostas", "evidence_url")
    d4 = decide(iso, pid4, "pedir_confirmacao", justificativa="falta segunda fonte")
    depois = pendencia(iso, "cobertura", f"{IBGE}:propostas", "evidence_url")
    assert d4["valor"] is None and depois["status"] == "aberta" and depois["tipo"] == "confirmacao" and antes["tipo"] == "mudanca"
    assert depois["pergunta"].startswith(antes["pergunta"]) and "falta segunda fonte" in depois["pergunta"] and "Fulana de Teste" in depois["pergunta"]
    # ... e continua recebendo decisão (agora de verdade)
    d5 = decide(iso, pid4, "aprovar")
    assert d5["valor"] == "https://novo.example/evid" and pendencia(iso, "cobertura", f"{IBGE}:propostas", "evidence_url")["status"] == "decidida"
    assert n(iso, "adm_decisoes") == 5


def test_decisao_de_agentes_grava_relatorio_e_versao_e_nao_grava_nome(iso, m):
    pid = prop_status(iso, m)
    d = DEC.decidir(iso, pid, acao="aprovar", por_tipo="agentes", relatorio={"veredito": "confere", "evidencias": 2}, versao_verificador=3, justificativa="verificadores concordam")
    r = um(iso, "select * from adm_decisoes where id = %s", d["id"])
    assert (r["decidido_por_tipo"], r["decidido_por_nome"], r["relatorio"], r["versao_verificador"], r["aplicada"]) == ("agentes", None, {"veredito": "confere", "evidencias": 2}, 3, False)


def test_recusas_acontecem_antes_de_qualquer_escrita(iso, m):
    pid = prop_status(iso, m)
    ident_ruim = prop_ident(iso, m, str(m["q"]), "aceito")  # o item não tem candidato
    cob_div = [prop_cob(iso, m, "status", c, sha=f"d{i}", url=f"https://d{i}.example/x") for i, c in enumerate(("so_portal", "nao_publica"))][-1]
    pc = prop_contato(iso, m, "email:vereador@cidade-teste.example", "outro@cidade-teste.example")
    pn = prop_contato(iso, m, "novo:site:https://v.example", "https://v.example", sha="k2")
    antes = (n(iso, "adm_decisoes"), um(iso, "select count(*) filter (where status = 'aberta') as a from adm_pendencias")["a"])
    casos = [
        ("justificativa vazia", pid, dict(acao="aprovar", justificativa="")),
        ("justificativa em branco", pid, dict(acao="aprovar", justificativa="  \n ")),
        ("justificativa nula", pid, dict(acao="aprovar", justificativa=None)),
        ("pessoa sem nome", pid, dict(acao="aprovar", por_nome=None)),
        ("pessoa com nome em branco", pid, dict(acao="aprovar", por_nome="   ")),
        ("agentes sem relatório", pid, dict(acao="aprovar", por_tipo="agentes", por_nome=None, versao_verificador=1)),
        ("agentes sem versão", pid, dict(acao="aprovar", por_tipo="agentes", por_nome=None, relatorio={"a": 1})),
        ("agentes com versão não inteira", pid, dict(acao="aprovar", por_tipo="agentes", por_nome=None, relatorio={"a": 1}, versao_verificador="1")),
        ("pessoa com relatório", pid, dict(acao="aprovar", relatorio={"a": 1})),
        ("tipo de decisor inválido", pid, dict(acao="aprovar", por_tipo="robo")),
        ("ação inválida", pid, dict(acao="apagar")),
        ("pendência inexistente", str(uuid.uuid4()), dict(acao="aprovar")),
        ("identificador malformado", "não-é-uuid", dict(acao="aprovar")),
        ("descartar com valor", pid, dict(acao="descartar", valor="ok")),
        ("pedir_confirmacao com valor", pid, dict(acao="pedir_confirmacao", valor="ok")),
        ("aprovar com valor", pid, dict(acao="aprovar", valor="sem_api")),
        ("corrigir sem valor", pid, dict(acao="corrigir")),
        ("corrigir com valor fora do domínio", pid, dict(acao="corrigir", valor="quebrado")),
        ("corrigir com valor de outro tipo", pid, dict(acao="corrigir", valor=7)),
        ("aprovar com fontes divergentes", cob_div, dict(acao="aprovar")),
        ("remover em contato novo", pn, dict(acao="corrigir", valor={"remover": True})),
        ("remover em aprovar", pc, dict(acao="aprovar", valor={"remover": True})),
        ("objeto que não é remover", pc, dict(acao="corrigir", valor={"apagar": True})),
        ("contato com espaço nas pontas", pc, dict(acao="corrigir", valor=" x@y.example ")),
        ("unir fora de duplicata", pid, dict(acao="corrigir", valor={"unir": {"de": str(uuid.uuid4()), "para": str(uuid.uuid4())}})),
        ("identidade aceito sem candidato", ident_ruim, dict(acao="aprovar")),
        ("identidade nova_pessoa", ident_ruim, dict(acao="corrigir", valor="nova_pessoa")),
        ("identidade pendente", ident_ruim, dict(acao="corrigir", valor="pendente")),
    ]
    for nome, alvo, kw in casos:
        with pytest.raises(DecisaoRecusada) as e:
            DEC.decidir(iso, alvo, **{**POR, **kw})
        assert str(e.value).strip(), nome
    assert (n(iso, "adm_decisoes"), um(iso, "select count(*) filter (where status = 'aberta') as a from adm_pendencias")["a"]) == antes  # nada gravado, nenhuma pendência mexeu
    # a mensagem das fontes divergentes é a combinada
    with pytest.raises(DecisaoRecusada, match="fontes divergentes: use corrigir com o valor escolhido e a justificativa"):
        decide(iso, cob_div, "aprovar")
    # ... e corrigir com o valor escolhido funciona
    d = decide(iso, cob_div, "corrigir", valor="so_portal", justificativa="a segunda leitura é a da própria casa")
    assert d["valor"] == "so_portal" and pendencia(iso, "cobertura", f"{IBGE}:propostas", "status")["status"] == "decidida"
    # remover é aceito em contato existente
    d = decide(iso, pc, "corrigir", valor={"remover": True})
    assert d["valor"] == {"remover": True}


def test_decidir_pendencia_ja_decidida_e_recusado_e_so_reabre_com_mudanca(iso, m):
    pid = prop_status(iso, m)
    decide(iso, pid, "descartar")
    antes = n(iso, "adm_decisoes")
    with pytest.raises(DecisaoRecusada, match="já está decidida"):
        decide(iso, pid, "aprovar")
    assert n(iso, "adm_decisoes") == antes
    # evidência nova (hash diferente) reabre; aí recebe decisão de novo
    PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("outra-evidencia"), url="https://a.example/api/"), agora=AGORA)
    assert pendencia(iso, "vinculo_sapl", str(m["h_cam"]), "status")["status"] == "aberta"
    decide(iso, pid, "aprovar")
    assert n(iso, "adm_decisoes") == antes + 1


# ------------------------------------------------------------------ 2. aplicar por classe


def test_status_de_casa_camara_e_assembleia_override_update_decisao_e_vigente_sha(iso, m):
    h = str(m["h_cam"])
    pid = prop_status(iso, m, "fora_do_ar")
    d = decide(iso, pid, "aprovar")
    r = APL.aplicar(iso, d["id"])
    assert um(iso, "select status from sapl_houses where id = %s", h)["status"] == "fora_do_ar"
    ov = iso.execute("select * from adm_overrides where classe = 'vinculo_sapl' and registro_chave = %s", (h,)).fetchall()
    assert len(ov) == 1 and (ov[0]["campo"], ov[0]["valor"], ov[0]["suprimir"], ov[0]["vigente"], str(ov[0]["decisao_id"])) == ("status", "fora_do_ar", False, True, str(d["id"]))
    dec_ = um(iso, "select aplicada, aplicada_em from adm_decisoes where id = %s", d["id"])
    assert dec_["aplicada"] is True and dec_["aplicada_em"] is not None
    pend = pendencia(iso, "vinculo_sapl", h, "status")
    assert pend["vigente_sha"] == PR.sha_vigente("fora_do_ar") == H('"fora_do_ar"') and pend["status"] == "decidida"
    assert (r["valor_anterior"], r["valor_novo"], r["escreveu"]["sapl_houses"], r["escreveu"]["adm_overrides"]) == ("ok", "fora_do_ar", [m["h_cam"]], [str(ov[0]["id"])])
    sem_reabrir(iso)
    # Assembleia: corrigir o status (valor que nenhuma fonte trouxe) também usa override
    ha = str(m["h_ale"])
    pa = PR.registrar(iso, P(m, registro_chave=ha, valor_candidato="fora_do_ar", conteudo_sha256=H("ale1"), url="https://ale.example/api/"), agora=AGORA).pendencia_id
    da = decide(iso, pa, "corrigir", valor="sem_api")
    ra = APL.aplicar(iso, da["id"])
    assert um(iso, "select status from sapl_houses where id = %s", ha)["status"] == "sem_api" and ra["escreveu"]["adm_overrides"]
    sem_reabrir(iso)


def test_base_url_de_camara_usa_override_e_a_de_assembleia_vai_para_adm_vinculos_sem_tocar_sapl_houses(iso, m):
    hc, ha = str(m["h_cam"]), str(m["h_ale"])
    iso.execute("select 1")
    V = __import__("civico_etl.admin.vinculos", fromlist=["sincronizar"])
    V.sincronizar(iso)  # materializa os vínculos de origem (registro_oficial / descoberta_automatica) das duas casas
    pc = PR.registrar(iso, P(m, campo="base_url", valor_candidato="https://novo.cidade-teste.example", conteudo_sha256=H("b1"), url="https://b.example/x"), agora=AGORA).pendencia_id
    APL.aplicar(iso, decide(iso, pc, "aprovar")["id"])
    assert um(iso, "select base_url from sapl_houses where id = %s", hc)["base_url"] == "https://novo.cidade-teste.example"
    assert um(iso, "select valor from adm_overrides where registro_chave = %s and campo = 'base_url' and vigente", hc)["valor"] == "https://novo.cidade-teste.example"
    # Assembleia: pendência de confirmação; aprovar NÃO grava override nem altera sapl_houses
    antes_casa = dict(um(iso, "select * from sapl_houses where id = %s", ha))
    pa = PR.registrar(iso, P(m, registro_chave=ha, campo="base_url", valor_candidato="https://sapl.al.novo.example", conteudo_sha256=H("b2"), url="https://b2.example/x"), agora=AGORA).pendencia_id
    assert pendencia(iso, "vinculo_sapl", ha, "base_url")["tipo"] == "confirmacao"
    antes_vig = iso.execute("select id, url, origem, vigente from adm_vinculos where classe = 'vinculo_sapl' and registro_chave = %s and vigente", (ha,)).fetchall()
    assert antes_vig  # o vínculo automático da casa
    r = APL.aplicar(iso, decide(iso, pa, "aprovar")["id"])
    assert dict(um(iso, "select * from sapl_houses where id = %s", ha)) == antes_casa
    assert n(iso, "adm_overrides", "registro_chave = %s", ha) == 0
    novo = um(iso, "select * from adm_vinculos where classe = 'vinculo_sapl' and registro_chave = %s and origem = 'correcao_manual' and vigente", ha)
    assert novo["url"] == "https://sapl.al.novo.example" and novo["decisao_id"] is not None and str(novo["id"]) == r["escreveu"]["adm_vinculos"]["novo"]
    anterior = um(iso, "select vigente from adm_vinculos where id = %s", novo["substitui_id"])
    assert anterior is not None and anterior["vigente"] is False and novo["substitui_id"] in [v["id"] for v in antes_vig]
    assert "ALE_SAPL" in r["observacao"] and r["corrections"]["gravou"] is False
    assert um(iso, "select aplicada from adm_decisoes where id = %s", r["decisao_id"])["aplicada"] is True
    sem_reabrir(iso)
    # uma nova correção manual substitui a anterior (que fica como histórico)
    iso.execute("update adm_pendencias set status = 'aberta', reaberta = true, motivo_reabertura = 'evidencia_mudou' where id = %s", (pa,))
    r2 = APL.aplicar(iso, decide(iso, pa, "corrigir", valor="https://sapl.al.outro.example")["id"])
    vigentes = iso.execute("select url from adm_vinculos where classe = 'vinculo_sapl' and registro_chave = %s and origem = 'correcao_manual' and vigente", (ha,)).fetchall()
    assert [v["url"] for v in vigentes] == ["https://sapl.al.outro.example"]
    assert um(iso, "select substitui_id from adm_vinculos where id = %s", r2["escreveu"]["adm_vinculos"]["novo"])["substitui_id"] == novo["id"]


def test_cobertura_status_reason_e_evidence_url(iso, m):
    ch = f"{IBGE}:propostas"
    for campo, cand in (("status", "so_portal"), ("reason", "o motivo conferido na página da câmara"), ("evidence_url", "https://camara.example/transparencia")):
        pid = prop_cob(iso, m, campo, cand, sha=f"c-{campo}", url=f"https://{campo}.example/x")
        d = decide(iso, pid, "aprovar")
        r = APL.aplicar(iso, d["id"])
        col = um(iso, f"select {campo} as v from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = 'propostas'", IBGE)["v"]  # noqa: S608
        assert col == cand
        ov = um(iso, "select * from adm_overrides where classe = 'cobertura' and registro_chave = %s and campo = %s and vigente", ch, campo)
        assert ov["valor"] == cand and str(ov["decisao_id"]) == str(d["id"])
        assert pendencia(iso, "cobertura", ch, campo)["vigente_sha"] == PR.sha_vigente(cand) and r["escreveu"]["data_coverage"]
    # as outras colunas da linha ficaram como estavam
    row = um(iso, "select c.status, c.reason, c.evidence_url from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = 'propostas'", IBGE)
    assert row == {"status": "so_portal", "reason": "o motivo conferido na página da câmara", "evidence_url": "https://camara.example/transparencia"}
    sem_reabrir(iso)


def test_contato_corrigido_novo_e_removido(iso, m):
    mid, vel = str(m["man"]), "vereador@cidade-teste.example"
    cur = um(iso, "select id from sources where slug = 'curadoria'")["id"]
    # corrigido: o valor antigo sai, o novo entra com a fonte curadoria, e o antigo fica suprimido
    pid = prop_contato(iso, m, f"email:{vel}", "correto@cidade-teste.example")
    d = decide(iso, pid, "aprovar")
    r = APL.aplicar(iso, d["id"])
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = %s", mid, vel) == 0
    novo = um(iso, "select source_id from mandate_contacts where mandate_id = %s and kind = 'email' and value = 'correto@cidade-teste.example'", mid)
    assert novo["source_id"] == cur
    ov = um(iso, "select * from adm_overrides where classe = 'contato_mandato' and registro_chave = %s and campo = %s and vigente", mid, f"email:{vel}")
    assert ov["suprimir"] is True and ov["valor"] is None and (r["valor_anterior"], r["valor_novo"]) == (vel, "correto@cidade-teste.example")
    assert pendencia(iso, "contato_mandato", mid, f"email:{vel}")["vigente_sha"] == PR.sha_vigente(None)  # o contato antigo não existe mais
    # o telefone da curadoria (outro contato do mandato) ficou
    assert n(iso, "mandate_contacts", "mandate_id = %s and kind = 'telefone'", mid) == 1
    # suprimido: o job que tentar inserir o valor antigo de novo não consegue (gatilho)
    cam = um(iso, "select id from sources where slug = 'camara'")["id"]
    iso.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, 'email', %s, %s)", (mid, vel, cam))
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = %s", mid, vel) == 0
    sem_reabrir(iso)

    # novo: cadastra com a fonte curadoria; dois e-mails novos diferentes são duas pendências independentes
    p1 = prop_contato(iso, m, "novo:email:a@cidade-teste.example", "a@cidade-teste.example", sha="n1")
    p2 = prop_contato(iso, m, "novo:email:b@cidade-teste.example", "b@cidade-teste.example", sha="n2")
    assert p1 != p2
    r1 = APL.aplicar(iso, decide(iso, p1, "aprovar")["id"])
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = 'a@cidade-teste.example' and source_id = %s", mid, cur) == 1
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = 'b@cidade-teste.example'", mid) == 0  # a outra pendência continua só proposta
    assert r1["valor_anterior"] is None and r1["corrections"]["gravou"] is False  # primeiro preenchimento
    # respeita a unique: contato novo igual a um que já existe não duplica
    p3 = prop_contato(iso, m, "novo:telefone:1100000000", "1100000000", sha="n3")
    r3 = APL.aplicar(iso, decide(iso, p3, "aprovar")["id"])
    assert n(iso, "mandate_contacts", "mandate_id = %s and kind = 'telefone' and value = '1100000000'", mid) == 1 and "já existia" in r3["observacao"]
    sem_reabrir(iso)

    # removido: suprime e apaga sem inserir nada
    antes = n(iso, "mandate_contacts", "mandate_id = %s", mid)
    p4 = prop_contato(iso, m, "email:a@cidade-teste.example", "c@cidade-teste.example", sha="n4")
    r4 = APL.aplicar(iso, decide(iso, p4, "corrigir", valor={"remover": True})["id"])
    assert n(iso, "mandate_contacts", "mandate_id = %s", mid) == antes - 1 and n(iso, "mandate_contacts", "mandate_id = %s and value = 'a@cidade-teste.example'", mid) == 0
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = 'c@cidade-teste.example'", mid) == 0
    assert um(iso, "select suprimir from adm_overrides where registro_chave = %s and campo = 'email:a@cidade-teste.example' and vigente", mid)["suprimir"] is True
    assert r4["valor_novo"] is None and "mandate_contacts_inseridos" not in r4["escreveu"]
    sem_reabrir(iso)


def test_identidade_aceita_com_candidato_rejeitada_sem_candidato_e_identificador_de_outra_pessoa(iso, m):
    # aceito, com candidato: vínculo em person_external_ids, status e quem resolveu; nenhuma pessoa criada
    q, p = fila_com_candidato(iso, m)
    pessoas = n(iso, "people")
    d = decide(iso, prop_ident(iso, m, q, "aceito"), "aprovar")
    r = APL.aplicar(iso, d["id"])
    src = um(iso, "select id from sources where slug = 'camara'")["id"]
    ext = um(iso, "select * from person_external_ids where source_id = %s and external_id = 'EXT-B2-1'", src)
    assert str(ext["person_id"]) == p and ext["match_method"] == "manual"
    fila = um(iso, "select status, resolved_by, resolved_at from identity_match_queue where id = %s", q)
    assert fila["status"] == "aceito" and fila["resolved_by"] == "Fulana de Teste" and fila["resolved_at"] is not None
    assert n(iso, "people") == pessoas and r["corrections"]["gravou"] is False and "merge_person" not in r["escreveu"]
    assert pendencia(iso, "identidade", q, "status")["vigente_sha"] == PR.sha_vigente("aceito")
    sem_reabrir(iso)

    # rejeitado: só o status e quem resolveu
    q2, p2 = fila_com_candidato(iso, m, "EXT-B2-2")
    r2 = APL.aplicar(iso, decide(iso, prop_ident(iso, m, q2, "aceito", sha="i2"), "corrigir", valor="rejeitado")["id"])
    assert n(iso, "person_external_ids", "external_id = 'EXT-B2-2'") == 0
    assert um(iso, "select status, resolved_by from identity_match_queue where id = %s", q2) == {"status": "rejeitado", "resolved_by": "Fulana de Teste"} and r2["escreveu"].keys() == {"identity_match_queue"}
    sem_reabrir(iso)

    # sem candidato: a decisão de 'aceito' é recusada na entrada; e, se o candidato some depois, a aplicação recusa e nada fica gravado
    q3, p3 = fila_com_candidato(iso, m, "EXT-B2-3")
    pid3 = prop_ident(iso, m, q3, "aceito", sha="i3")
    d3 = decide(iso, pid3, "aprovar")
    iso.execute("update identity_match_queue set candidate_person_id = null where id = %s", (q3,))
    antes = (n(iso, "person_external_ids"), n(iso, "adm_overrides"))
    with pytest.raises(AplicacaoRecusada, match="não tem pessoa candidata"):
        APL.aplicar(iso, d3["id"])
    assert (n(iso, "person_external_ids"), n(iso, "adm_overrides")) == antes
    assert um(iso, "select status, resolved_by from identity_match_queue where id = %s", q3) == {"status": "pendente", "resolved_by": None}
    assert um(iso, "select aplicada from adm_decisoes where id = %s", d3["id"])["aplicada"] is False

    # identificador já ligado a OUTRA pessoa: a aplicação falha com mensagem clara e nada é gravado
    q4, p4 = fila_com_candidato(iso, m, "EXT-B2-4")
    outra = pessoa(iso, "outra-pessoa-b2")
    iso.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, 'EXT-B2-4', 'exact_id', 1)", (outra, src))
    d4 = decide(iso, prop_ident(iso, m, q4, "aceito", sha="i4"), "aprovar")
    with pytest.raises(AplicacaoRecusada, match="OUTRA pessoa"):
        APL.aplicar(iso, d4["id"])
    assert str(um(iso, "select person_id from person_external_ids where source_id = %s and external_id = 'EXT-B2-4'", src)["person_id"]) == outra  # o vínculo existente não foi trocado
    assert um(iso, "select status from identity_match_queue where id = %s", q4)["status"] == "pendente" and um(iso, "select aplicada from adm_decisoes where id = %s", d4["id"])["aplicada"] is False


def test_duplicata_so_une_por_merge_person_com_valor_unir(iso, m):
    a, b = pessoa(iso, "dup-a-b2"), pessoa(iso, "dup-b-b2")
    pid = str(um(iso, "insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo) values ('identidade', %s, 'status', 'As duas pessoas são a mesma?', 'duplicata') returning id", str(m["q"]))["id"])
    for ruim in (None, "sim", {"unir": {"de": a}}, {"unir": {"de": a, "para": a}}, {"unir": {"de": a, "para": str(uuid.uuid4())}}, {"unir": {"de": a, "para": b}, "extra": 1}, {"fundir": {"de": a, "para": b}}):
        with pytest.raises(DecisaoRecusada):
            decide(iso, pid, "aprovar", valor=ruim)
    with pytest.raises(DecisaoRecusada):
        decide(iso, pid, "corrigir", valor={"unir": {"de": a, "para": b}})
    assert n(iso, "adm_decisoes") == 0 and n(iso, "people", "id = any(%s)", [a, b]) == 2
    d = decide(iso, pid, "aprovar", valor={"unir": {"de": a, "para": b}})
    assert d["valor"] == {"unir": {"de": a, "para": b}} and f"people:{a}:merge_person" in d["campos_afetados"]
    assert n(iso, "people", "id = any(%s)", [a, b]) == 2
    r = APL.aplicar(iso, d["id"])
    assert n(iso, "people", "id = %s", a) == 0 and n(iso, "people", "id = %s", b) == 1
    assert n(iso, "person_slug_redirects", "old_slug = 'dup-a-b2' and person_id = %s", b) == 1
    assert r["escreveu"] == {"merge_person": {"de": a, "para": b}} and um(iso, "select aplicada from adm_decisoes where id = %s", d["id"])["aplicada"] is True
    assert pendencia(iso, "identidade", str(m["q"]), "status")["vigente_sha"] == PR.sha_vigente("pendente")
    sem_reabrir(iso)


# ------------------------------------------------------------------ 3. atomicidade


def test_falha_no_meio_da_aplicacao_desfaz_tudo_e_a_decisao_continua_nao_aplicada(iso, m):
    h = str(m["h_cam"])
    pid = prop_status(iso, m, "fora_do_ar")
    d = decide(iso, pid, "aprovar")
    # valor que viola o `check` da tabela de domínio, trocado por baixo (a validação de entrada já passou)
    iso.execute("alter table adm_decisoes disable trigger adm_decisoes_guard")
    iso.execute("update adm_decisoes set valor = to_jsonb('quebrado'::text) where id = %s", (d["id"],))
    iso.execute("alter table adm_decisoes enable trigger adm_decisoes_guard")
    sha0 = pendencia(iso, "vinculo_sapl", h, "status")["vigente_sha"]
    with pytest.raises(pe.CheckViolation):
        APL.aplicar(iso, d["id"])
    assert n(iso, "adm_overrides") == 0 and n(iso, "corrections") == 0
    assert um(iso, "select status from sapl_houses where id = %s", h)["status"] == "ok"
    assert um(iso, "select aplicada, aplicada_em from adm_decisoes where id = %s", d["id"]) == {"aplicada": False, "aplicada_em": None}
    assert pendencia(iso, "vinculo_sapl", h, "status")["vigente_sha"] == sha0
    # a transação continua utilizável (o savepoint foi desfeito): uma decisão boa depois aplica
    iso.execute("alter table adm_decisoes disable trigger adm_decisoes_guard")
    iso.execute("update adm_decisoes set valor = to_jsonb('sem_api'::text) where id = %s", (d["id"],))
    iso.execute("alter table adm_decisoes enable trigger adm_decisoes_guard")
    APL.aplicar(iso, d["id"])
    assert um(iso, "select status from sapl_houses where id = %s", h)["status"] == "sem_api"


def test_falha_depois_de_apagar_o_contato_restaura_a_linha_e_nao_deixa_override(iso, m):
    """O contato antigo é apagado e o override de supressão gravado ANTES do insert do novo; se o insert é descartado pelo gatilho (valor suprimido por decisão anterior),
    a aplicação inteira é desfeita: o contato antigo volta e nenhum override novo fica."""
    mid = str(m["man"])
    cur = um(iso, "select id from sources where slug = 'curadoria'")["id"]
    # decisão anterior: o valor `suprimido@x` está suprimido (override vigente de uma decisão qualquer)
    p0 = prop_contato(iso, m, "novo:email:suprimido@cidade-teste.example", "suprimido@cidade-teste.example", sha="s0")
    d0 = decide(iso, p0, "aprovar")
    iso.execute("insert into adm_overrides (classe, registro_chave, campo, suprimir, decisao_id) values ('contato_mandato', %s, 'email:suprimido@cidade-teste.example', true, %s)", (mid, d0["id"]))
    pid = prop_contato(iso, m, "email:vereador@cidade-teste.example", "suprimido@cidade-teste.example", sha="s1")
    d = decide(iso, pid, "aprovar")
    overrides = n(iso, "adm_overrides")
    with pytest.raises(AplicacaoRecusada, match="suprimido"):
        APL.aplicar(iso, d["id"])
    assert n(iso, "adm_overrides") == overrides
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = 'vereador@cidade-teste.example'", mid) == 1  # a linha apagada voltou
    assert n(iso, "mandate_contacts", "mandate_id = %s and value = 'suprimido@cidade-teste.example'", mid) == 0
    assert um(iso, "select aplicada from adm_decisoes where id = %s", d["id"])["aplicada"] is False and cur


# ------------------------------------------------------------------ 4. duas chaves (mínimo; a matriz completa é da próxima tarefa)


def _estado_dominio(iso) -> tuple:
    return (iso.execute("select id, status, base_url from sapl_houses order by id").fetchall(), n(iso, "adm_overrides"), n(iso, "corrections"),
            iso.execute("select id, aplicada, aplicada_em from adm_decisoes order by id").fetchall(), iso.execute("select id, status, vigente_sha from adm_pendencias order by id").fetchall())


def _poe_ambiente(monkeypatch, amb: dict) -> None:
    """B6: o ambiente das duas chaves é o `os.environ` real; o teste o põe com `monkeypatch` (antes passava `ambiente=`)."""
    if "ADMIN_COLETA_AGENTES" in amb:
        monkeypatch.setenv("ADMIN_COLETA_AGENTES", amb["ADMIN_COLETA_AGENTES"])
    else:
        monkeypatch.delenv("ADMIN_COLETA_AGENTES", raising=False)


def test_decisao_de_agentes_com_chave_desligada_falha_fechado_sem_gravar_nada(iso, m, monkeypatch):
    pid = prop_status(iso, m, "fora_do_ar")
    d = DEC.decidir(iso, pid, acao="aprovar", por_tipo="agentes", relatorio={"v": 1}, versao_verificador=1, justificativa="verificadores concordam")
    assert n(iso, "pipeline_switches", "name = 'admin_coleta_agentes'") == 0  # nascem desligadas
    monkeypatch.delenv("ADMIN_COLETA_AGENTES", raising=False)  # B6: o parâmetro `ambiente=` saiu; o ambiente é o real, posto aqui por monkeypatch
    assert APL.chaves_dos_agentes(iso) == {"variavel": False, "linha": False, "ligadas": False}
    antes = _estado_dominio(iso)
    for amb in ({}, {"ADMIN_COLETA_AGENTES": "on"}, {"ADMIN_COLETA_AGENTES": "off"}, {"ADMIN_COLETA_AGENTES": "ON"}):  # variável ausente, ligada sem a linha, desligada, valor fora do contrato
        _poe_ambiente(monkeypatch, amb)
        with pytest.raises(ChavesDesligadas):
            APL.aplicar(iso, d["id"])
        assert _estado_dominio(iso) == antes
    # só a linha, sem a variável
    iso.execute("insert into pipeline_switches (name, value, note) values ('admin_coleta_agentes', 'on', 'teste B2')")
    _poe_ambiente(monkeypatch, {})
    assert APL.chaves_dos_agentes(iso) == {"variavel": False, "linha": True, "ligadas": False}
    antes = _estado_dominio(iso)
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d["id"])
    assert _estado_dominio(iso) == antes
    # em lote: a decisão fica `bloqueada_chaves`, não aplicada, e as de pessoa seguem
    pp = prop_cob(iso, m, "status", "so_portal")
    dp = decide(iso, pp, "aprovar")
    lote = APL.aplicar_pendentes(iso)
    assert {i["decisao_id"]: i["estado"] for i in lote} == {str(d["id"]): "bloqueada_chaves", str(dp["id"]): "aplicada"}
    assert um(iso, "select status from sapl_houses where id = %s", m["h_cam"])["status"] == "ok"
    # as duas ligadas: aplica
    _poe_ambiente(monkeypatch, {"ADMIN_COLETA_AGENTES": "on"})
    assert APL.chaves_dos_agentes(iso)["ligadas"] is True
    APL.aplicar(iso, d["id"])
    assert um(iso, "select status from sapl_houses where id = %s", m["h_cam"])["status"] == "fora_do_ar"


def test_as_duas_chaves_nascem_desligadas_no_banco_da_suite_e_no_ambiente(conn, monkeypatch):
    monkeypatch.delenv("ADMIN_COLETA_AGENTES", raising=False)
    assert APL.chaves_dos_agentes(conn) == {"variavel": False, "linha": False, "ligadas": False}
    monkeypatch.setenv("ADMIN_COLETA_AGENTES", "on")
    assert APL.chaves_dos_agentes(conn) == {"variavel": True, "linha": False, "ligadas": False}


def test_o_codigo_confere_as_duas_chaves_antes_de_qualquer_escrita():
    """Garantia estrutural: `aplicar` confere as chaves antes de abrir o savepoint que escreve."""
    import inspect

    src = inspect.getsource(APL.aplicar)
    assert src.index("chaves_dos_agentes") < src.index("conn.transaction()")


# ------------------------------------------------------------------ 5. corrections


def test_corrections_uma_linha_quando_aplicada_troca_valor_existente_e_o_campo_tem_leitor(iso, m):
    h = str(m["h_cam"])
    d = decide(iso, prop_status(iso, m, "fora_do_ar", url="https://a.example/api/"), "aprovar", justificativa="a API não responde")
    r = APL.aplicar(iso, d["id"])
    assert r["corrections"]["gravou"] is True and n(iso, "corrections") == 1
    c = um(iso, "select * from corrections where id = %s", r["corrections"]["id"])
    assert (c["entity_table"], c["entity_ref"], c["field"], c["before_value"], c["after_value"], c["reason"], c["evidence_url"], c["person_id"]) == (
        "sapl_houses", h, "status", "ok", "fora_do_ar", "a API não responde", "https://a.example/api/", None)
    assert c["published_at"] is not None and any("getCouncilSite" in x for x in r["corrections"]["leitores"])
    # contato: person_id é o dono do mandato; o evidence_url é o da proposta que traz o valor
    pc = prop_contato(iso, m, "email:vereador@cidade-teste.example", "correto@cidade-teste.example", url="https://camara.example/vereadores/1")
    rc = APL.aplicar(iso, decide(iso, pc, "aprovar")["id"])
    cc = um(iso, "select * from corrections where id = %s", rc["corrections"]["id"])
    assert (cc["entity_table"], cc["entity_ref"], cc["field"], cc["before_value"], cc["after_value"], str(cc["person_id"]), cc["evidence_url"]) == (
        "mandate_contacts", str(m["man"]), "email", "vereador@cidade-teste.example", "correto@cidade-teste.example", str(m["pessoa"]), "https://camara.example/vereadores/1")
    # cobertura de município com leitor (getCoverage)
    pk = prop_cob(iso, m, "status", "so_portal", url="https://cob.example/x")
    rk = APL.aplicar(iso, decide(iso, pk, "aprovar")["id"])
    ck = um(iso, "select * from corrections where id = %s", rk["corrections"]["id"])
    assert (ck["entity_table"], ck["entity_ref"], ck["field"], ck["before_value"], ck["after_value"]) == ("data_coverage", f"{IBGE}:propostas", "status", "carregando", "so_portal")
    assert n(iso, "corrections") == 3


def test_corrections_nao_grava_em_descarte_primeiro_preenchimento_identidade_sem_leitor_e_sem_fonte(iso, m):
    base = n(iso, "corrections")
    # descarte e pedido de confirmação: nada a aplicar
    pd = prop_status(iso, m, "fora_do_ar")
    dd = decide(iso, pd, "descartar")
    with pytest.raises(AplicacaoRecusada, match="descartar"):
        APL.aplicar(iso, dd["id"])
    pp = prop_cob(iso, m, "reason", "outro motivo", sha="r1")
    dp = decide(iso, pp, "pedir_confirmacao")
    with pytest.raises(AplicacaoRecusada, match="pedir_confirmacao"):
        APL.aplicar(iso, dp["id"])
    # primeiro preenchimento: linha de cobertura cujo evidence_url era nulo (a de 'votos')
    ch = f"{IBGE}:votos"
    pf = PR.registrar(iso, P(m, classe="cobertura", registro_chave=ch, campo="evidence_url", valor_candidato="https://votos.example/x", conteudo_sha256=H("v1"), url="https://votos.example/x"), agora=AGORA).pendencia_id
    rf = APL.aplicar(iso, decide(iso, pf, "aprovar")["id"])
    assert rf["valor_anterior"] is None and rf["corrections"] == {"gravou": False, "motivo": "primeiro preenchimento: não havia valor anterior"}
    # identidade
    q, _ = fila_com_candidato(iso, m)
    ri = APL.aplicar(iso, decide(iso, prop_ident(iso, m, q, "aceito"), "aprovar")["id"])
    assert ri["corrections"]["gravou"] is False
    # corrigir para um valor que nenhuma fonte trouxe: não há evidence_url verdadeiro (coluna NOT NULL)
    pc = prop_cob(iso, m, "reason", "texto da proposta", sha="r2", url="https://r2.example/x")
    rc = APL.aplicar(iso, decide(iso, pc, "corrigir", valor="texto escrito pela pessoa que decidiu")["id"])
    assert rc["corrections"]["gravou"] is False and "evidence_url" in rc["corrections"]["motivo"] and rc["valor_anterior"] == "teste"
    # remover contato: também sem fonte
    pr = prop_contato(iso, m, "email:vereador@cidade-teste.example", "x@cidade-teste.example", sha="k9")
    rr = APL.aplicar(iso, decide(iso, pr, "corrigir", valor={"remover": True})["id"])
    assert rr["corrections"]["gravou"] is False and "evidence_url" in rr["corrections"]["motivo"]
    # campo sem leitor no site: sem entrada em LEITORES (o escopo da Assembleia em vinculo_sapl/base_url não muda sapl_houses, então nem chega aqui)
    assert APL.leitores_de("identidade", "status", None) == [] and APL.leitores_de("cobertura", "nome", "municipio") == []
    assert n(iso, "corrections") == base


def test_a_constante_de_leitores_cita_arquivo_e_linha_que_existem_e_contem_o_trecho():
    total = 0
    for (classe, campo), lista in APL.LEITORES.items():
        assert lista, (classe, campo)
        for l in lista:
            linhas = (REPO / l["arquivo"]).read_text(encoding="utf-8").splitlines()
            assert 1 <= l["linha"] <= len(linhas), l
            assert l["contem"] in linhas[l["linha"] - 1], (l, linhas[l["linha"] - 1])
            total += 1
    assert total >= 10


# ------------------------------------------------------------------ 6. reaplicar e nova decisão sobre o mesmo campo


def test_reaplicar_e_recusado_e_nova_decisao_depois_de_reaberta_substitui_o_override_e_guarda_o_historico(iso, m):
    h = str(m["h_cam"])
    d1 = decide(iso, prop_status(iso, m, "fora_do_ar"), "aprovar")
    APL.aplicar(iso, d1["id"])
    with pytest.raises(AplicacaoRecusada, match="já foi aplicada"):
        APL.aplicar(iso, d1["id"])
    assert n(iso, "adm_overrides") == 1
    # reabre (evidência nova) e decide outro valor
    PR.registrar(iso, P(m, valor_candidato="sem_api", conteudo_sha256=H("nova"), url="https://nova.example/api/"), agora=AGORA)
    pend = pendencia(iso, "vinculo_sapl", h, "status")
    assert pend["status"] == "aberta" and pend["reaberta"] is True
    d2 = decide(iso, pend["id"], "corrigir", valor="robots_bloqueia", justificativa="o robots.txt passou a bloquear")
    r2 = APL.aplicar(iso, d2["id"])
    assert (r2["valor_anterior"], r2["valor_novo"]) == ("fora_do_ar", "robots_bloqueia")
    ovs = {o["valor"]: o for o in iso.execute("select valor, vigente, decisao_id from adm_overrides where classe = 'vinculo_sapl' and registro_chave = %s and campo = 'status'", (h,)).fetchall()}
    assert {k: v["vigente"] for k, v in ovs.items()} == {"fora_do_ar": False, "robots_bloqueia": True}  # o anterior fica como histórico; só um vigente (índice único parcial)
    assert ovs["fora_do_ar"]["decisao_id"] == d1["id"] and ovs["robots_bloqueia"]["decisao_id"] == d2["id"]
    assert um(iso, "select status from sapl_houses where id = %s", h)["status"] == "robots_bloqueia"
    assert um(iso, "select count(*) as n from adm_decisoes where aplicada")["n"] == 2
    sem_reabrir(iso)


def test_aplicar_pendentes_aplica_em_ordem_de_criacao_cada_uma_no_seu_savepoint_e_uma_falha_nao_impede_as_outras(iso, m, monkeypatch):
    monkeypatch.delenv("ADMIN_COLETA_AGENTES", raising=False)  # B6: era `ambiente={}`; agora o ambiente real, sem a variável
    d1 = decide(iso, prop_status(iso, m, "fora_do_ar"), "aprovar")
    pq, _ = fila_com_candidato(iso, m)
    q_ruim = prop_ident(iso, m, str(m["q"]), "rejeitado", sha="ir")
    d_ruim = decide(iso, q_ruim, "aprovar")  # válida; vamos estragar a aplicação por baixo
    iso.execute("delete from identity_match_queue where id = %s", (str(m["q"]),))
    d3 = decide(iso, prop_cob(iso, m, "status", "so_portal"), "aprovar")
    dd = decide(iso, prop_cob(iso, m, "reason", "x", sha="rx"), "descartar")  # descartar não entra no lote
    # numa transação só, `now()` é o mesmo para todas: escalona criada_em na ordem de inserção (em produção cada decisão nasce na sua transação)
    iso.execute("alter table adm_decisoes disable trigger adm_decisoes_guard")
    iso.execute("update adm_decisoes d set criada_em = now() + x.rn * interval '1 second' from (select id, row_number() over (order by ctid) as rn from adm_decisoes) x where x.id = d.id")
    iso.execute("alter table adm_decisoes enable trigger adm_decisoes_guard")
    lote = APL.aplicar_pendentes(iso)
    estados = [(i["decisao_id"], i["estado"]) for i in lote]
    assert estados == [(str(d1["id"]), "aplicada"), (str(d_ruim["id"]), "falhou"), (str(d3["id"]), "aplicada")] and str(dd["id"]) not in {e[0] for e in estados}
    assert "não existe" in lote[1]["erro"] and um(iso, "select status from sapl_houses where id = %s", m["h_cam"])["status"] == "fora_do_ar"
    assert APL.aplicar_pendentes(iso)[0]["estado"] == "falhou"  # a que falhou continua pendente; as aplicadas não voltam
    assert len(APL.aplicar_pendentes(iso)) == 1 and pq


# ------------------------------------------------------------------ 7. pela CLI real


@pytest.fixture
def mundo_commit(banco_isolado, monkeypatch):
    """O `mundo` gravado com commit (a CLI abre a própria conexão), apontando o ambiente para o banco isolado; desfeito em `finally`."""
    url = banco_isolado
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.setenv(k, url)
    monkeypatch.delenv("ADMIN_COLETA_AGENTES", raising=False)
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    assert n(c, "corrections") == 0 and n(c, "adm_decisoes") == 0 and n(c, "adm_pendencias") == 0  # o banco isolado parte limpo
    mm = mundo(c)
    # 0156: `admin decidir --por` exige admin ativo em adm_admins; a linha fica (o log de admins é só de acréscimo; o banco é isolado e some no fim da sessão)
    c.execute("insert into adm_admins (email, nome) values ('t-fulana-de-teste@segueovoto.invalid', 'Fulana de Teste') on conflict (email) do nothing")
    c.commit()
    try:
        yield c, mm
    finally:
        c.rollback()
        with c.transaction():
            c.execute("set local session_replication_role = replica")  # pula a trava que impede apagar decisão; o banco é isolado
            for t in ("adm_overrides", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "corrections"):
                c.execute(f"delete from {t}")  # noqa: S608
            c.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
        c.execute("delete from people where slug like 'cand-%' or slug = 'outra-pessoa-b2'")
        c.commit()
        desfazer(c, mm)
        c.close()


def _cli(capsys, *argv: str) -> tuple[int, str, str]:
    capsys.readouterr()
    rc = cli.main(["admin", *argv])
    o = capsys.readouterr()
    return rc, o.out, o.err


def test_cli_decidir_com_aplicar_e_aplicar_pelo_main_real(mundo_commit, capsys):
    c, mm = mundo_commit
    h = str(mm["h_cam"])
    p1 = PR.registrar(c, P(mm, valor_candidato="fora_do_ar", conteudo_sha256=H("cli1")), agora=AGORA).pendencia_id
    p2 = PR.registrar(c, P(mm, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato="so_portal", conteudo_sha256=H("cli2"), url="https://cob.example/x"), agora=AGORA).pendencia_id
    c.commit()
    # decidir --aplicar --json
    rc, out, err = _cli(capsys, "decidir", p1, "--acao", "aprovar", "--por", "Fulana de Teste", "--justificativa", "conferi na página", "--aplicar", "--json")
    assert rc == 0, err
    doc = json.loads(out)
    assert doc["decisao"]["acao"] == "aprovar" and doc["decisao"]["aplicada"] is True and doc["aplicacao"]["valor_novo"] == "fora_do_ar" and doc["aplicacao"]["corrections"]["gravou"] is True
    assert um(c, "select status from sapl_houses where id = %s", h)["status"] == "fora_do_ar"
    assert um(c, "select aplicada, decidido_por_nome from adm_decisoes where pendencia_id = %s", p1) == {"aplicada": True, "decidido_por_nome": "Fulana de Teste"}
    # decidir sem --aplicar; depois `aplicar` aplica as de pessoa
    rc, out, err = _cli(capsys, "decidir", p2, "--acao", "corrigir", "--valor", '"nao_publica"', "--por", "Fulana de Teste", "--justificativa", "a página diz que não publica", "--json")
    assert rc == 0, err
    assert json.loads(out)["decisao"]["aplicada"] is False and json.loads(out)["aplicacao"] is None
    assert um(c, "select aplicada from adm_decisoes where pendencia_id = %s", p2)["aplicada"] is False
    rc, out, err = _cli(capsys, "aplicar", "--json")
    assert rc == 0, err
    doc = json.loads(out)
    assert doc["totais"] == {"aplicadas": 1, "nao_aplicadas": 0} and doc["decisoes"][0]["resultado"]["valor_novo"] == "nao_publica"
    assert um(c, "select status from data_coverage dc join places p on p.id = dc.place_id where p.ibge_code = %s and dc.dataset = 'propostas'", IBGE)["status"] == "nao_publica"
    # nada mais a aplicar: tabela vazia, sai 0
    rc, out, err = _cli(capsys, "aplicar")
    assert rc == 0 and "0 aplicadas" in out
    # texto (sem --json)
    p3 = PR.registrar(c, P(mm, classe="cobertura", registro_chave=f"{IBGE}:contato", campo="reason", valor_candidato="texto novo", conteudo_sha256=H("cli3"), url="https://z.example/x"), agora=AGORA).pendencia_id
    c.commit()
    rc, out, err = _cli(capsys, "decidir", p3, "--acao", "aprovar", "--por", "Fulana de Teste", "--justificativa", "ok", "--aplicar")
    assert rc == 0 and "aplicada: cobertura" in out and "escreveu:" in out


def test_cli_codigos_de_saida_uso_erro_de_execucao_e_chaves_desligadas(mundo_commit, capsys):
    c, mm = mundo_commit
    p1 = PR.registrar(c, P(mm, valor_candidato="fora_do_ar", conteudo_sha256=H("cod1")), agora=AGORA).pendencia_id
    c.commit()
    base = ("decidir", p1, "--por", "Fulana de Teste")
    # erro de uso: 2
    assert _cli(capsys, "decidir", p1, "--acao", "aprovar", "--por", "F")[0] == 2  # falta --justificativa
    assert _cli(capsys, *base, "--acao", "descartar", "--justificativa", "x", "--aplicar")[0] == 2
    assert _cli(capsys, *base, "--acao", "corrigir", "--justificativa", "x", "--valor", "{não é json")[0] == 2
    assert _cli(capsys, *base, "--acao", "voar", "--justificativa", "x")[0] == 2
    # erro de execução: 1 (recusa de domínio), sem gravar
    rc, out, err = _cli(capsys, *base, "--acao", "aprovar", "--justificativa", "   ")
    assert rc == 1 and "justificativa" in err and "Traceback" not in err and out == ""
    rc, out, err = _cli(capsys, *base, "--acao", "corrigir", "--justificativa", "x", "--valor", '"quebrado"')
    assert rc == 1 and "inválido" in err
    assert n(c, "adm_decisoes") == 0 and pendencia(c, "vinculo_sapl", str(mm["h_cam"]), "status")["status"] == "aberta"
    # decisão de agentes pendente (só por código) e chaves desligadas: `aplicar` sai 1 e não grava
    d = DEC.decidir(c, p1, acao="aprovar", por_tipo="agentes", relatorio={"v": 1}, versao_verificador=1, justificativa="verificadores concordam")
    c.commit()
    rc, out, err = _cli(capsys, "aplicar", "--json")
    assert rc == 1, err
    doc = json.loads(out)
    assert doc["decisoes"][0]["estado"] == "bloqueada_chaves" and doc["totais"] == {"aplicadas": 0, "nao_aplicadas": 1}
    assert um(c, "select status from sapl_houses where id = %s", mm["h_cam"])["status"] == "ok" and um(c, "select aplicada from adm_decisoes where id = %s", d["id"])["aplicada"] is False
    rc, out, err = _cli(capsys, "aplicar", "--decisao", str(d["id"]))
    assert rc == 1 and "bloqueada_chaves" in out
    rc, out, err = _cli(capsys, "aplicar", "--decisao", str(uuid.uuid4()))
    assert rc == 1 and "inexistente" in err
    # só a variável: continua desligado (a linha falta)
    import os

    os.environ["ADMIN_COLETA_AGENTES"] = "on"
    try:
        rc, out, err = _cli(capsys, "aplicar", "--json")
        assert rc == 1 and json.loads(out)["decisoes"][0]["estado"] == "bloqueada_chaves"
    finally:
        os.environ.pop("ADMIN_COLETA_AGENTES", None)
    assert um(c, "select status from sapl_houses where id = %s", mm["h_cam"])["status"] == "ok"


# ------------------------------------------------------------------ 8. F3-T1: anti-SSRF no base_url e admin ativo em `--por`


def _pend_base_url(iso, m, valor: str, sha: str) -> str:
    return PR.registrar(iso, P(m, campo="base_url", valor_candidato=valor, conteudo_sha256=H(sha), url="https://b.example/x"), agora=AGORA).pendencia_id


def test_decidir_base_url_interno_e_recusado_sem_gravar_nada(iso, m):
    DNS_TESTE["interno.example"] = ["10.0.0.7"]
    DNS_TESTE["misto.example"] = ["93.184.216.34", "169.254.169.254"]
    h = str(m["h_cam"])
    antes = (n(iso, "adm_decisoes"), n(iso, "adm_overrides"), um(iso, "select base_url from sapl_houses where id = %s", h)["base_url"])
    ruins = ("https://127.0.0.1/sapl", "https://10.1.2.3/sapl", "https://169.254.169.254/latest", "https://[::1]/sapl", "http://sapl.publico.example/api", "https://usuario:senha@sapl.publico.example/",
             "https://sapl.publico.example:8443/", "https://interno.example/sapl", "https://misto.example/sapl")
    for i, v in enumerate(ruins):
        pid = _pend_base_url(iso, m, v, f"ssrf{i}")
        # corrigir (valor informado)
        with pytest.raises(DecisaoRecusada, match="base_url recusado"):
            decide(iso, pid, "corrigir", valor=v)
        # aprovar (o candidato proposto é o próprio valor ruim)
        with pytest.raises(DecisaoRecusada, match="base_url recusado"):
            decide(iso, pid)
        assert pendencia(iso, "vinculo_sapl", h, "base_url")["status"] == "aberta"
    assert (n(iso, "adm_decisoes"), n(iso, "adm_overrides"), um(iso, "select base_url from sapl_houses where id = %s", h)["base_url"]) == antes
    # o motivo diz o que houve
    with pytest.raises(DecisaoRecusada, match=r"10\.0\.0\.7"):
        decide(iso, pendencia(iso, "vinculo_sapl", h, "base_url")["id"], "corrigir", valor="https://interno.example/sapl")


def test_decidir_base_url_publico_passa_e_o_status_nao_passa_pela_checagem(iso, m):
    pid = _pend_base_url(iso, m, "https://sapl.publico.example", "ssrf-ok")
    d = decide(iso, pid, "corrigir", valor="https://sapl.publico.example")
    assert d["valor"] == "https://sapl.publico.example" and n(iso, "adm_decisoes") == 1
    # descartar não grava valor: a checagem não se aplica; `status` nunca é URL
    pid2 = prop_status(iso, m, sha="ssrf-st")
    assert decide(iso, pid2, "aprovar")["valor"] == "fora_do_ar"


def test_cli_por_de_nao_admin_e_de_admin_inativo_sai_2_sem_gravar(mundo_commit, capsys):
    c, mm = mundo_commit
    p1 = PR.registrar(c, P(mm, valor_candidato="fora_do_ar", conteudo_sha256=H("por1")), agora=AGORA).pendencia_id
    c.execute("insert into adm_admins (email, nome, ativo) values ('t-inativo@segueovoto.invalid', 'Inativo da Silva', false) on conflict (email) do nothing")
    c.commit()
    base = ("decidir", p1, "--acao", "aprovar", "--justificativa", "conferi")
    for por in ("Qualquer Pessoa", "ninguem@segueovoto.invalid", "Inativo da Silva", "t-inativo@segueovoto.invalid", "  "):
        rc, out, err = _cli(capsys, *base, "--por", por)
        assert rc == 2 and "adm_admins" in err and out == "", (por, rc, err)
    assert n(c, "adm_decisoes") == 0 and pendencia(c, "vinculo_sapl", str(mm["h_cam"]), "status")["status"] == "aberta"


def test_cli_por_de_admin_ativo_grava_o_nome_da_tabela(mundo_commit, capsys):
    c, mm = mundo_commit
    p1 = PR.registrar(c, P(mm, valor_candidato="fora_do_ar", conteudo_sha256=H("por2")), agora=AGORA).pendencia_id
    p2 = PR.registrar(c, P(mm, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato="so_portal", conteudo_sha256=H("por3"), url="https://cob.example/x"), agora=AGORA).pendencia_id
    c.execute("insert into adm_admins (email, nome) values ('t-beltrana@segueovoto.invalid', 'Beltrana de Souza') on conflict (email) do nothing")
    c.commit()
    # por e-mail, em maiúsculas: o nome gravado é o da tabela, não o que veio
    rc, out, err = _cli(capsys, "decidir", p1, "--acao", "aprovar", "--por", "T-Beltrana@SeguEoVoto.invalid", "--justificativa", "conferi", "--json")
    assert rc == 0, err
    assert json.loads(out)["decisao"]["decidido_por_nome"] == "Beltrana de Souza"
    assert um(c, "select decidido_por_nome from adm_decisoes where pendencia_id = %s", p1)["decidido_por_nome"] == "Beltrana de Souza"
    # por nome
    rc, out, err = _cli(capsys, "decidir", p2, "--acao", "descartar", "--por", "Fulana de Teste", "--justificativa", "não vale", "--json")
    assert rc == 0, err
    assert um(c, "select decidido_por_nome from adm_decisoes where pendencia_id = %s", p2)["decidido_por_nome"] == "Fulana de Teste"
    c.execute("delete from adm_admins where email = 't-beltrana@segueovoto.invalid'")  # o log de admins guarda o acréscimo; a linha some para não vazar para outros testes
    c.commit()


def test_cli_decidir_base_url_interno_sai_1_sem_gravar(mundo_commit, capsys):
    c, mm = mundo_commit
    DNS_TESTE["interno.example"] = ["192.168.0.9"]
    p1 = PR.registrar(c, P(mm, campo="base_url", valor_candidato="https://interno.example/sapl", conteudo_sha256=H("ssrf-cli"), url="https://b.example/x"), agora=AGORA).pendencia_id
    c.commit()
    rc, out, err = _cli(capsys, "decidir", p1, "--acao", "aprovar", "--por", "Fulana de Teste", "--justificativa", "parece certo")
    assert rc == 1 and "base_url recusado" in err and "192.168.0.9" in err and out == ""
    assert n(c, "adm_decisoes") == 0 and pendencia(c, "vinculo_sapl", str(mm["h_cam"]), "base_url")["status"] == "aberta"
