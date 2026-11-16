"""FABRICADO. Critério 11 (B2): "Decisão aplicada sobrevive a uma nova execução do job de origem." Um caso por classe.

Cada caso aplica uma decisão de PESSOA e depois roda de novo o JOB REAL de origem, pela CLI real (ou, na fila de identidade, pela função real que grava a fila), sobre
entrada fabricada (nunca rede), e confere que o valor decidido continua, que o que o job regrava sem decisão foi regravado, e que `reavaliar` não reabre a pendência.

  8  sapl_houses.status de Assembleia  `sapl.ales` (discover_ales: upsert de base_url, status, note, checked_at) com cache NOVO sobre o mesmo cenário v1
  9  data_coverage                      `sapl.ales` forçado (set_coverage: insert on conflict) e `ale.cobertura` (reword_unread_coverage: update direto)
  10 mandate_contacts                   `parlamento.extras` (delete de contatos camara/senado do mandato + insert), mesma entrada
  11 identity_match_queue               `PersonResolver.flush` (identity.py) e `AssemblyMatcher.flush` (assembleias.py): upsert só enquanto `pendente`
  12 reabertura por mudança do registro  o que o job grava num campo SEM override reabre a pendência; o campo com override não muda

Sem rede, sem skip. Nada é gravado no banco da suíte (contagens antes/depois) e tudo que se grava no banco isolado é desfeito em `finally`.
"""

from __future__ import annotations

import json
from datetime import date
from types import SimpleNamespace
from typing import Any

import admin_fixtures as AF
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from caracterizacao import rodar_cli
from conftest import database_url
from psycopg.rows import dict_row
from test_admin_decisoes import POR, n, um
from test_admin_fixture_sapl import FORCA, SEM_FILA, rodar
from test_admin_propostas import AGORA, H
from test_caracterizacao import _ex_contatos, _ex_entrada, _ex_limpar, _ex_preparar

from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import propostas as PR

SUITE = ("adm_decisoes", "adm_overrides", "adm_pendencias", "corrections", "pipeline_switches", "sapl_houses", "data_coverage", "mandate_contacts", "identity_match_queue",
         "person_external_ids", "people", "ingest_runs", "dataset_stamps")


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


@pytest.fixture(scope="module", autouse=True)
def suite_intacta():
    antes = _contagens(database_url())
    yield
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


@pytest.fixture(autouse=True)
def _ambiente(monkeypatch, banco_isolado):  # noqa: F811
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.setenv(k, banco_isolado)
    for k in ("ADMIN_COLETA_AGENTES", "ETL_INVOCATION", "ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH"):
        monkeypatch.delenv(k, raising=False)


# ------------------------------------------------------------------ apoio


def conectar(url: str):
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    return c


def limpar_decisoes(url: str) -> None:
    """Desfaz o que as decisões gravaram nas tabelas `adm_*` e em `corrections` (banco isolado; `adm_decisoes` não se apaga com a trava ligada)."""
    with psycopg.connect(url, autocommit=True) as c, c.transaction():
        c.execute("set local session_replication_role = replica")
        for t in ("adm_overrides", "adm_vinculos", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "corrections"):
            c.execute(f"delete from {t}")  # noqa: S608


def propor(c, classe: str, chave: str, campo: str, cand: Any, url: str, sha: str, *, bloco: str | None = None) -> str:
    return PR.registrar(c, PR.Proposta(classe=classe, registro_chave=chave, campo=campo, valor_candidato=cand, url=url, trecho=f"$.{campo}", conteudo_sha256=H(sha), lida_em=AGORA,
                                       bloco=bloco), agora=AGORA).pendencia_id


def decidir_e_aplicar(c, pid: str, acao: str = "aprovar", **kw) -> dict:
    d = DEC.decidir(c, pid, acao=acao, **{**POR, **kw})
    r = APL.aplicar(c, d["id"])
    c.commit()
    return r


def casa(c, uf: str) -> dict:
    return um(c, "select h.* from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = %s", uf)


def cobertura(c, ibge: str, ds: str) -> dict:
    return um(c, "select c.* from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = %s", ibge, ds)


@pytest.fixture
def ales(banco_isolado, tmp_path):
    """Banco isolado com as cinco Assembleias e o município fabricado, depois de UMA rodada `sapl.ales` do cenário v1 (RO, AC, AM carregadas; PI robots_bloqueia; PB fora_do_ar)."""
    url = banco_isolado
    limpar_decisoes(url)
    AF.limpar_base(url)
    AF.carregar_base(url)
    try:
        r1 = rodar(url, "v1", tmp_path / "c1", tmp_path, "r1", ["sapl.ales", *SEM_FILA])
        assert r1.rc == 0 and r1.nao_previstos == []
        assert {uf: c["status"] for uf, c in r1.foto["casas"].items() if c["kind"] == "uf"} == AF.STATUS_ALE["v1"]
        yield SimpleNamespace(url=url, tmp=tmp_path, r1=r1)
    finally:
        limpar_decisoes(url)
        AF.limpar_base(url)


# ------------------------------------------------------------------ 8. sapl_houses.status de Assembleia


def test_8_status_de_assembleia_decidido_sobrevive_a_nova_rodada_de_sapl_ales(ales):
    c = conectar(ales.url)
    try:
        pb, pi = casa(c, "PB"), casa(c, "PI")
        assert pb["status"] == "fora_do_ar" and pi["status"] == "robots_bloqueia"
        pid = propor(c, "vinculo_sapl", str(pb["id"]), "status", "sem_api", "https://sapl.al.pb.leg.br/api/", "pb1")
        r = decidir_e_aplicar(c, pid, "corrigir", valor="sem_api", justificativa="a URL responde 500 há dias e a página oficial não tem API")
        c.execute("update sapl_houses set note = 'nota suja antes da segunda rodada' where id = any(%s)", ([pb["id"], pi["id"]],))
        c.commit()
        assert r["valor_anterior"] == "fora_do_ar" and casa(c, "PB")["status"] == "sem_api"

        # o job real de novo, com cache NOVO e o mesmo cenário v1: ele tenta gravar `fora_do_ar` outra vez (500 em /api/)
        r2 = rodar(ales.url, "v1", ales.tmp / "c2", ales.tmp, "r2", ["sapl.ales", *SEM_FILA])
        assert r2.rc == 0 and r2.nao_previstos == []
        assert [s for u, s in r2.respostas if u == AF.ALE_HOSTS["PB"] + "/api/"] == [500] * 5  # o job sondou a PB e viu o mesmo erro de antes
        c.rollback()
        pb2, pi2 = casa(c, "PB"), casa(c, "PI")
        assert pb2["status"] == "sem_api"  # a decisão sobreviveu à descoberta (status vem do override, no gatilho do update)
        assert pb2["note"] == "HTTPStatusError: 500" and pb2["checked_at"] > pb["checked_at"]  # o que o job regrava e não tem override foi regravado
        assert pi2["status"] == "robots_bloqueia" and pi2["checked_at"] > pi["checked_at"] and pi2["note"].startswith("robots.txt bloqueia")  # casa sem decisão: o job regrava normalmente
        assert n(c, "adm_overrides", "vigente") == 1 and um(c, "select valor from adm_overrides where vigente")["valor"] == "sem_api"
        assert PR.reavaliar(c, agora=AGORA) == []  # o registro não mudou desde a decisão: a pendência não reabre
        c.rollback()
        # as casas sem decisão que o job carregou continuam como antes (nenhuma coluna a mais mudou em RO)
        assert casa(c, "RO")["status"] == "ok"
    finally:
        c.close()


# ------------------------------------------------------------------ 9. data_coverage


def test_9a_cobertura_decidida_sobrevive_ao_insert_on_conflict_de_set_coverage(ales):
    c = conectar(ales.url)
    try:
        antes = cobertura(c, "11", "propostas")
        assert antes["status"] == "carregando" and antes["reason"].startswith("projetos da legislatura atual lidos do SAPL")
        decidido = {"status": "so_portal", "reason": "a página da Assembleia mostra as propostas só no portal; conferido à mão", "evidence_url": "https://exemplo.fabricado/al-ro/propostas"}
        for campo, valor in decidido.items():
            pid = propor(c, "cobertura", "11:propostas", campo, valor, f"https://exemplo.fabricado/al-ro/{campo}", f"ro-{campo}")
            decidir_e_aplicar(c, pid, "aprovar")
        c.rollback()
        dep = cobertura(c, "11", "propostas")
        assert {k: dep[k] for k in decidido} == decidido
        runs0 = n(c, "ingest_runs", "dataset = 'sapl-ale.ro'")
        ac0 = cobertura(c, "12", "propostas")

        # `sapl.ales` forçado (efeito de --ibge): recarrega RO, AC e AM e chama set_coverage (upsert de data_coverage: status, reason, evidence_url, checked_on)
        r2 = rodar(ales.url, "v1", ales.tmp / "c2", ales.tmp, "r2", ["sapl.ales", *SEM_FILA, *FORCA])
        assert r2.rc == 0 and r2.nao_previstos == []
        c.rollback()
        assert n(c, "ingest_runs", "dataset = 'sapl-ale.ro'") == runs0 + 1  # o job recarregou a RO (e, portanto, passou por set_coverage)
        pos = cobertura(c, "11", "propostas")
        assert {k: pos[k] for k in decidido} == decidido  # sobreviveu: status, reason e evidence_url
        # o que o job grava sem decisão foi regravado: a mesma recarga escreveu em AC o texto do job
        assert cobertura(c, "12", "propostas")["reason"].startswith("projetos da legislatura atual lidos do SAPL") and cobertura(c, "12", "propostas")["status"] == "carregando"
        assert ac0["updated_at"] <= cobertura(c, "12", "propostas")["updated_at"]
        # outros datasets da RO (sem decisão) são os do job
        assert cobertura(c, "11", "presenca")["status"] == "carregando" and cobertura(c, "11", "votos")["status"] == "carregando"
        assert PR.reavaliar(c, agora=AGORA) == []
    finally:
        c.close()


def test_9b_cobertura_decidida_sobrevive_ao_update_direto_de_reword_unread_coverage(banco_isolado, monkeypatch, tmp_path):
    """`ale.cobertura` (reword_unread_coverage) reescreve com `update` direto status, reason e evidence_url das UFs conferidas sem leitor (RJ). A decisão de pessoa
    fixa o `status` de uma linha e o `evidence_url` de outra; o job reescreve o resto e o decidido fica."""
    from civico_etl.jobs.assembleias import _OLD_DEFAULTS, VERIFIED_UNREAD

    url = banco_isolado
    limpar_decisoes(url)
    rj = VERIFIED_UNREAD["RJ"]
    c = None
    try:
        with psycopg.connect(url, autocommit=True) as a:
            assert a.execute("select count(*) from data_coverage").fetchone()[0] == 0 and a.execute("select count(*) from legislative_bodies where kind = 'assembleia'").fetchone()[0] == 0
            a.execute("insert into legislative_bodies (kind, place_id, name, adapter) select 'assembleia', id, 'Assembleia Fabricada RJ', 'none' from places where kind = 'uf' and uf = 'RJ'")
            for ds in ("presenca", "gastos_gabinete"):
                a.execute("insert into data_coverage (place_id, dataset, status, reason, evidence_url, checked_on) select id, %s, 'carregando', %s, null, '2026-01-01' from places where kind = 'uf' and uf = 'RJ'",
                          (ds, _OLD_DEFAULTS[0]))
        c = conectar(url)
        evid = "https://exemplo.fabricado/alerj/gastos"
        p1 = propor(c, "cobertura", "33:presenca", "status", "so_portal", "https://exemplo.fabricado/alerj/presenca", "rj1")
        decidir_e_aplicar(c, p1, "aprovar")
        p2 = propor(c, "cobertura", "33:gastos_gabinete", "evidence_url", "https://exemplo.fabricado/alerj/outra", "https://exemplo.fabricado/alerj/gastos", "rj2")
        decidir_e_aplicar(c, p2, "corrigir", valor=evid)
        c.rollback()
        assert cobertura(c, "33", "presenca")["status"] == "so_portal" and cobertura(c, "33", "presenca")["reason"] == _OLD_DEFAULTS[0]
        assert cobertura(c, "33", "gastos_gabinete")["evidence_url"] == evid

        chamadas: list[str] = []

        def respostas(req):
            chamadas.append(str(req.url))
            raise AssertionError(f"ale.cobertura não usa rede: {req.url}")

        assert rodar_cli(["ale.cobertura"], url_banco=url, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path) == 0 and chamadas == []
        pr, gg = cobertura(c, "33", "presenca"), cobertura(c, "33", "gastos_gabinete")
        # o que o job reescreveu (update direto): motivo, evidência e data; o que a decisão fixou ficou
        assert pr["reason"] == rj["presenca"][1] and pr["evidence_url"] == rj["presenca"][2] and pr["checked_on"] != date(2026, 1, 1)
        assert pr["status"] == "so_portal"  # o job tentou gravar 'desconhecido'
        assert gg["reason"] == rj["gastos_gabinete"][1] and gg["status"] == "so_portal" and gg["checked_on"] != date(2026, 1, 1)
        assert gg["evidence_url"] == evid  # o job tentou gravar a URL do DOCIGP
        assert PR.reavaliar(c, agora=AGORA) == []
    finally:
        if c is not None:
            c.rollback()
            c.close()  # antes da limpeza: um `for update` aberto travaria o delete
        limpar_decisoes(url)
        with psycopg.connect(url, autocommit=True) as a:
            a.execute("delete from data_coverage")
            a.execute("delete from legislative_bodies where kind = 'assembleia'")


# ------------------------------------------------------------------ 10. mandate_contacts


def test_10_contato_corrigido_e_contato_novo_sobrevivem_ao_delete_e_insert_de_parlamento_extras(banco_isolado, monkeypatch, tmp_path):
    import civico_etl.jobs.derive_stats as ds
    import civico_etl.jobs.parlamento_extras as pe

    class _Hoje(date):
        @classmethod
        def today(cls):
            return date(2026, 11, 15)

    monkeypatch.setattr(pe, "date", _Hoje)
    monkeypatch.setattr(ds, "run_derive", lambda c: None)  # o encadeamento do derive.stats não é o que se testa aqui (e grava cobertura das 27 UFs)
    url = banco_isolado
    limpar_decisoes(url)
    chamadas: list[str] = []
    entrada = _ex_entrada(1, pe.CAMARA, pe.SENADO)

    def respostas(req):
        u = str(req.url)
        chamadas.append(u)
        if u not in entrada:
            raise AssertionError(f"URL não prevista: {u}")
        return 200, {"content-type": "application/json"}, json.dumps(entrada[u], ensure_ascii=False).encode()

    def job(pasta: str) -> int:
        (tmp_path / pasta).mkdir()
        return rodar_cli(["parlamento.extras", "--year", "2025"], url_banco=url, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path / pasta)

    def contatos(pessoa: str, fonte: str | None = None) -> set[tuple[str, str, str]]:
        return {(x["fonte"], x["kind"], x["value"]) for x in _ex_contatos(url) if x["pessoa"] == pessoa and (fonte is None or x["fonte"] == fonte)}

    mand = _ex_preparar(url)
    c = None
    try:
        assert job("r1") == 0
        a1, b1, c1 = contatos("fab-extras-dep-a"), contatos("fab-extras-dep-b"), contatos("fab-extras-sen-c")
        velho = ("camara", "email", "dep.fab.a@camara.leg.br")
        assert velho in a1 and len(a1) == 10 and len(b1) == 1 and len(c1) == 3
        mid = mand["fab-extras-dep-a"]
        c = conectar(url)
        # (1) corrigir o e-mail da deputada A (valor novo, fonte `curadoria`)
        novo_email = "deputada.a.correto@camara.leg.br"
        pid = propor(c, "contato_mandato", mid, "email:dep.fab.a@camara.leg.br", novo_email, "https://exemplo.fabricado/camara/dep-a", "ex1", bloco="<div id=dep-a>")
        r = decidir_e_aplicar(c, pid, "aprovar", justificativa="a página da deputada mostra outro e-mail")
        assert r["escreveu"]["mandate_contacts_inseridos"] and ("curadoria", "email", novo_email) in contatos("fab-extras-dep-a") and velho not in contatos("fab-extras-dep-a")
        # (2) cadastrar um contato NOVO (fonte `curadoria`)
        site_novo = "https://aprovado.fab.example"
        pn = propor(c, "contato_mandato", mid, f"novo:site:{site_novo}", site_novo, "https://exemplo.fabricado/camara/dep-a-site", "ex2", bloco="<div id=dep-a>")
        decidir_e_aplicar(c, pn, "aprovar")
        antes_do_job = contatos("fab-extras-dep-a")
        assert ("curadoria", "site", site_novo) in antes_do_job

        # o job real de novo, com a MESMA entrada (que ainda traz o e-mail antigo) e cache novo
        n0 = len(chamadas)
        assert job("r2") == 0
        assert len(chamadas) - n0 == len(set(chamadas[:n0]))  # releu as mesmas URLs (cache novo)
        a2 = contatos("fab-extras-dep-a")
        assert velho not in a2  # o valor antigo NÃO voltou: suprimido (o job o tentou inserir; o gatilho descartou)
        assert ("curadoria", "email", novo_email) in a2 and ("curadoria", "site", site_novo) in a2  # a correção e o contato novo sobreviveram ao delete do job
        assert contatos("fab-extras-dep-a", "camara") == a1 - {velho} - {x for x in a1 if x[0] != "camara"}  # os outros contatos da fonte camara são os que o job traz
        assert contatos("fab-extras-dep-a", "curadoria") == {("curadoria", "email", novo_email), ("curadoria", "site", site_novo)}
        assert contatos("fab-extras-dep-b") == b1 and contatos("fab-extras-sen-c") == c1  # os outros mandatos, como o job os traz
        c.rollback()
        assert PR.reavaliar(c, agora=AGORA) == []
    finally:
        if c is not None:
            c.rollback()
            c.close()
        limpar_decisoes(url)
        _ex_limpar(url)


# ------------------------------------------------------------------ 11. identity_match_queue


def test_11_status_decidido_da_fila_de_identidade_nao_volta_a_pendente(banco_isolado):
    from civico_etl.identity import PersonResolver
    from civico_etl.jobs.assembleias import AssemblyMatcher

    url = banco_isolado
    limpar_decisoes(url)
    c = conectar(url)
    try:
        src = str(um(c, "select id from sources where slug = 'camara'")["id"])
        p1, p2 = (str(um(c, "insert into people (slug, display_name) values (%s, %s) returning id", s, "Pessoa " + s)["id"]) for s in ("cand-s11-a", "cand-s11-b"))
        raw0 = json.dumps({"nome": "Fulano S11", "uf": "RO"})
        resolver = PersonResolver(c)
        resolver._pending_queue = [(src, "EXT-S11-A", raw0, p1, 0.5), (src, "EXT-S11-B", raw0, p2, 0.5), (src, "EXT-S11-C", raw0, p1, 0.5)]
        resolver.flush()  # o caminho real que grava a fila (identity.py)
        c.commit()
        ids = {r["external_id"]: str(r["id"]) for r in c.execute("select id, external_id from identity_match_queue where external_id like 'EXT-S11-%'").fetchall()}
        assert len(ids) == 3
        # A: aceito (com vínculo); B: rejeitado; C: continua pendente
        decidir_e_aplicar(c, propor(c, "identidade", ids["EXT-S11-A"], "status", "aceito", "https://exemplo.fabricado/s11/a", "s11a"), "aprovar")
        decidir_e_aplicar(c, propor(c, "identidade", ids["EXT-S11-B"], "status", "aceito", "https://exemplo.fabricado/s11/b", "s11b"), "corrigir", valor="rejeitado")
        foto = {k: dict(um(c, "select status, resolved_by, resolved_at, candidate_person_id, confidence, raw from identity_match_queue where id = %s", v)) for k, v in ids.items()}
        assert foto["EXT-S11-A"]["status"] == "aceito" and foto["EXT-S11-B"]["status"] == "rejeitado" and foto["EXT-S11-C"]["status"] == "pendente"
        assert foto["EXT-S11-A"]["resolved_by"] == "Fulana de Teste" and foto["EXT-S11-A"]["resolved_at"] is not None

        # o MESMO registro de novo, com dados que o job traria (outro candidato, outra confiança, outro raw): a fila só atualiza o que está `pendente`
        raw1 = json.dumps({"nome": "Fulano S11 (nome atualizado pela fonte)", "uf": "RO"})
        resolver2 = PersonResolver(c)
        resolver2._pending_queue = [(src, "EXT-S11-A", raw1, p2, 0.9), (src, "EXT-S11-B", raw1, p1, 0.9), (src, "EXT-S11-C", raw1, p2, 0.9)]
        resolver2.flush()
        # e pelo outro caminho real (assembleias.py), que também faz upsert da fila só enquanto `pendente`
        m = AssemblyMatcher(c, "RO", "camara")
        m._enqueue("EXT-S11-A", json.loads(raw1), p2, 0.9, "mesmo registro")
        m._enqueue("EXT-S11-B", json.loads(raw1), p1, 0.9, "mesmo registro")
        m.flush()
        c.commit()
        depois = {k: dict(um(c, "select status, resolved_by, resolved_at, candidate_person_id, confidence, raw from identity_match_queue where id = %s", v)) for k, v in ids.items()}
        assert depois["EXT-S11-A"] == foto["EXT-S11-A"] and depois["EXT-S11-B"] == foto["EXT-S11-B"]  # status decidido, resolução, candidato, confiança e raw: nada voltou
        assert depois["EXT-S11-C"]["status"] == "pendente" and depois["EXT-S11-C"]["raw"] == json.loads(raw1) and str(depois["EXT-S11-C"]["candidate_person_id"]) == p2  # o job regrava o pendente
        assert n(c, "person_external_ids", "external_id = 'EXT-S11-A' and person_id = %s", p1) == 1  # o vínculo da decisão continua
        assert n(c, "identity_match_queue", "external_id like 'EXT-S11-%'") == 3
        assert PR.reavaliar(c, agora=AGORA) == []
        c.rollback()
    finally:
        c.rollback()
        c.close()
        limpar_decisoes(url)
        with psycopg.connect(url, autocommit=True) as a:
            a.execute("delete from identity_match_queue where external_id like 'EXT-S11-%'")
            a.execute("delete from people where slug like 'cand-s11-%'")  # person_external_ids cai em cascata


# ------------------------------------------------------------------ 12. reabertura por mudança do registro


def test_12_so_reabre_o_campo_sem_override_cujo_valor_o_job_mudou(ales):
    c = conectar(ales.url)
    try:
        pb, pi, ac = casa(c, "PB"), casa(c, "PI"), casa(c, "AC")
        # PB: decisão aplicada (override). PI e AC: pendências decididas por descarte (sem override, sem aplicação)
        decidir_e_aplicar(c, propor(c, "vinculo_sapl", str(pb["id"]), "status", "sem_api", "https://sapl.al.pb.leg.br/api/", "pb12"), "corrigir", valor="sem_api")
        for h, cand, sha in ((pi, "ok", "pi12"), (ac, "sem_api", "ac12")):
            pid = propor(c, "vinculo_sapl", str(h["id"]), "status", cand, f"https://exemplo.fabricado/{sha}", sha)
            DEC.decidir(c, pid, acao="descartar", **POR)
        c.commit()
        assert PR.reavaliar(c, agora=AGORA) == []
        c.commit()
        # o job grava outro valor em PI (campo sem override) e tenta mudar PB (com override: o gatilho segura)
        c.execute("update sapl_houses set status = 'sem_api' where id = %s", (pi["id"],))
        c.execute("update sapl_houses set status = 'fora_do_ar' where id = %s", (pb["id"],))
        assert casa(c, "PB")["status"] == "sem_api"
        reabertas = PR.reavaliar(c, agora=AGORA)
        assert [(x["classe"], x["registro_chave"], x["campo"]) for x in reabertas] == [("vinculo_sapl", str(pi["id"]), "status")]
        estados = {r["registro_chave"]: (r["status"], r["motivo_reabertura"]) for r in c.execute("select registro_chave, status, motivo_reabertura from adm_pendencias").fetchall()}
        assert estados[str(pi["id"])] == ("aberta", "registro_mudou") and estados[str(pb["id"])] == ("decidida", None) and estados[str(ac["id"])] == ("decidida", None)
        c.rollback()
    finally:
        c.rollback()
        c.close()
