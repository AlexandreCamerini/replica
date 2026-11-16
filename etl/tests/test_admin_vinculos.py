"""A3: `civico-etl admin vinculos` (sincronizar, --url, --fonte, --registro).

Sem rede, sem skip. Todo dado fabricado vive no banco isolado (`banco_isolado`): a maioria dos testes usa uma transação revertida no fim;
os que passam pela CLI (que abre a própria conexão e comita) gravam com commit e limpam em `finally`. Nada é gravado no banco da suíte: o
módulo compara as contagens de adm_vinculos, sapl_houses, data_coverage e mandate_contacts de `admin_coleta` antes e depois.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row

from civico_etl import cli
from civico_etl.admin import vinculos as V
from civico_etl.admin.saida import ErroAdmin
from civico_etl.util import sha256_text

AGORA = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
IBGE = "9999901"
REG_CAMARA = "https://registro.example/orgaos/cidade-teste"
BASE_CAMARA = "https://sapl.cidade-teste.example"
BASE_ALE = "https://sapl.al.teste.example"
EVID_PROP = f"{BASE_CAMARA}/materia/pesquisar-materia"
EVID_OUTRA = "https://outra-fonte.example/contato"
URL_CAMARA_FONTE = "https://dadosabertos.camara.leg.br/"
TABELAS_SUITE = ("adm_vinculos", "sapl_houses", "data_coverage", "mandate_contacts")


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in TABELAS_SUITE}  # noqa: S608 (nomes fixos)


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


def _um(c, sql, *p):
    return c.execute(sql, p).fetchone()


def mundo(c) -> dict:
    """1 Assembleia (RO) e 1 Câmara (município fabricado) em sapl_houses; 2 linhas de data_coverage com evidence_url; 1 mandato com 2 contatos
    (um da Câmara, um da `curadoria`); 1 item de identity_match_queue. Devolve os ids."""
    muni = _um(c, "insert into places (ibge_code, kind, name, slug, uf) values (%s, 'municipio', 'Cidade Teste', 'cidade-teste-adm', 'SP') returning id", IBGE)["id"]
    ro = _um(c, "select id from places where ibge_code = '11'")["id"]
    b_cam = _um(c, "insert into legislative_bodies (kind, place_id, name, adapter) values ('camara_municipal', %s, 'Câmara Municipal de Cidade Teste', 'none') returning id", muni)["id"]
    b_ale = _um(c, "insert into legislative_bodies (kind, place_id, name, adapter) values ('assembleia', %s, 'Assembleia Legislativa de Rondônia', 'none') returning id", ro)["id"]
    h_cam = _um(c, "insert into sapl_houses (place_id, body_id, base_url, registry_url, status) values (%s, %s, %s, %s, 'ok') returning id", muni, b_cam, BASE_CAMARA, REG_CAMARA)["id"]
    h_ale = _um(c, "insert into sapl_houses (place_id, body_id, base_url, registry_url, status) values (%s, %s, %s, %s, 'ok') returning id", ro, b_ale, BASE_ALE, BASE_ALE)["id"]
    c.execute("insert into data_coverage (place_id, dataset, status, reason, evidence_url, checked_on) values (%s, 'propostas', 'carregando', 'teste', %s, %s)", (muni, EVID_PROP, date(2026, 11, 1)))
    c.execute("insert into data_coverage (place_id, dataset, status, reason, evidence_url, checked_on) values (%s, 'contato', 'desconhecido', 'teste', %s, %s)", (muni, EVID_OUTRA, date(2026, 11, 1)))
    c.execute("insert into data_coverage (place_id, dataset, status, reason, checked_on) values (%s, 'votos', 'desconhecido', 'sem evidência', %s)", (muni, date(2026, 11, 1)))  # evidence_url nula: sem vínculo
    pessoa = _um(c, "insert into people (slug, display_name) values ('pessoa-teste-adm', 'Pessoa Teste') returning id")["id"]
    off = _um(c, "select id from offices where slug = 'vereador'")["id"]
    man = _um(
        c, "insert into mandates (person_id, office_id, place_id, body_id, role, status, started_on, ends_on, status_source) values (%s, %s, %s, %s, 'titular', 'em_exercicio', '2025-01-01', '2028-12-31', 'teste') returning id",
        pessoa, off, muni, b_cam)["id"]
    s_cam = _um(c, "select id from sources where slug = 'camara'")["id"]
    s_cur = _um(c, "select id from sources where slug = 'curadoria'")["id"]
    c.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, 'email', 'vereador@cidade-teste.example', %s)", (man, s_cam))
    c.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, 'telefone', '1100000000', %s)", (man, s_cur))
    q = _um(c, "insert into identity_match_queue (source_id, external_id, raw, status) values (%s, 'EXT-ADM-1', '{}'::jsonb, 'pendente') returning id", s_cam)["id"]
    return {"muni": muni, "ro": ro, "b_cam": b_cam, "b_ale": b_ale, "h_cam": h_cam, "h_ale": h_ale, "pessoa": pessoa, "man": man, "q": q}


def desfazer(c, m: dict) -> None:
    """Limpeza do que `mundo` gravou com commit (ordem das chaves estrangeiras)."""
    c.execute("delete from adm_vinculos")
    c.execute("delete from mandate_contacts where mandate_id = %s", (m["man"],))
    c.execute("delete from identity_match_queue where id = %s", (m["q"],))
    c.execute("delete from mandates where id = %s", (m["man"],))
    c.execute("delete from people where id = %s", (m["pessoa"],))
    c.execute("delete from data_coverage where place_id = %s", (m["muni"],))
    c.execute("delete from sapl_houses where id = any(%s)", ([m["h_cam"], m["h_ale"]],))
    c.execute("delete from legislative_bodies where id = any(%s)", ([m["b_cam"], m["b_ale"]],))
    c.execute("delete from places where id = %s", (m["muni"],))
    c.commit()


def todos(c) -> list[dict]:
    return c.execute("select * from adm_vinculos order by classe, registro_chave, url_sha, criada_em").fetchall()


def esperados(m: dict) -> dict[tuple[str, str, str], tuple[str, str | None]]:
    """(classe, chave, url) -> (origem, fonte_slug) para o `mundo`."""
    return {
        ("vinculo_sapl", str(m["h_cam"]), REG_CAMARA): ("registro_oficial", "sapl"),
        ("vinculo_sapl", str(m["h_cam"]), BASE_CAMARA): ("descoberta_automatica", "sapl"),
        ("vinculo_sapl", str(m["h_ale"]), BASE_ALE): ("registro_oficial", "sapl-ale"),  # registry_url == base_url: um vínculo só
        ("cobertura", f"{IBGE}:propostas", EVID_PROP): ("descoberta_automatica", "sapl"),
        ("cobertura", f"{IBGE}:contato", EVID_OUTRA): ("descoberta_automatica", None),  # evidência de outro site: a fonte não é certa
        ("contato_mandato", str(m["man"]), URL_CAMARA_FONTE): ("registro_oficial", "camara"),
        ("identidade", str(m["q"]), URL_CAMARA_FONTE): ("registro_oficial", "camara"),
    }


# ------------------------------------------------------------------ sincronizar


def test_sincronizar_cria_os_vinculos_esperados_com_as_origens_certas(iso):
    m = mundo(iso)
    r = V.sincronizar(iso)
    linhas = todos(iso)
    assert {(l["classe"], l["registro_chave"], l["url"]): (l["origem"], l["fonte_slug"]) for l in linhas} == esperados(m)
    assert all(l["vigente"] and l["substitui_id"] is None and l["url_sha"] == sha256_text(l["url"]) for l in linhas)
    assert r.criados == {"vinculo_sapl": 3, "cobertura": 2, "contato_mandato": 1, "identidade": 1} and not any(r.desativados.values()) and r.mudou()
    motivos = {(i["classe"], i["motivo"]): i["n"] for i in r.ignorados}
    assert any(c == "contato_mandato" and "curadoria" in mt and n == 1 for (c, mt), n in motivos.items())  # contato corrigido à mão: fonte sem URL
    assert iso.execute("select count(*) as n from adm_vinculos where url = 'replica/admin-coleta.md'").fetchone()["n"] == 0  # nenhuma URL fabricada


def test_sincronizar_e_idempotente_zero_linha_nova_e_nada_alterado(iso):
    mundo(iso)
    V.sincronizar(iso)
    antes = todos(iso)
    r = V.sincronizar(iso)
    assert todos(iso) == antes  # nem linha nova, nem coluna alterada
    assert not r.mudou() and r.criados == dict.fromkeys(V.CLASSES, 0) and r.desativados == dict.fromkeys(V.CLASSES, 0)
    assert sum(r.mantidos.values()) == len(antes) == 7


def test_troca_de_base_url_desativa_o_antigo_e_o_novo_aponta_para_ele(iso):
    m = mundo(iso)
    V.sincronizar(iso)
    antigo = _um(iso, "select id from adm_vinculos where url = %s", BASE_CAMARA)["id"]
    nova = "https://novo-sapl.cidade-teste.example"
    iso.execute("update sapl_houses set base_url = %s where id = %s", (nova, m["h_cam"]))
    r = V.sincronizar(iso)
    assert r.criados["vinculo_sapl"] == 1 and r.desativados["vinculo_sapl"] == 1 and sum(r.criados.values()) == 1
    v_antigo = _um(iso, "select * from adm_vinculos where id = %s", antigo)
    v_novo = _um(iso, "select * from adm_vinculos where url = %s", nova)
    assert v_antigo["vigente"] is False and v_novo["vigente"] is True and v_novo["substitui_id"] == antigo
    assert v_novo["origem"] == "descoberta_automatica" and v_novo["fonte_slug"] == "sapl"
    assert _um(iso, "select vigente from adm_vinculos where url = %s", REG_CAMARA)["vigente"] is True  # o registro oficial não mudou
    assert iso.execute("select count(*) as n from adm_vinculos").fetchone()["n"] == 8  # a linha antiga ficou
    # de novo: nada muda
    antes = todos(iso)
    assert not V.sincronizar(iso).mudou() and todos(iso) == antes
    # a cadeia de trocas aparece no registro e o histórico na URL antiga
    d = V.do_registro(iso, "vinculo_sapl", str(m["h_cam"]))
    assert [str(antigo), str(v_novo["id"])] in d["cadeias_de_troca"]
    h = V.por_url(iso, BASE_CAMARA)["vinculos"][0]
    assert h["vigente"] is False and h["substituido_por_id"] == str(v_novo["id"]) and h["substituido_em"] == v_novo["criada_em"]


def test_correcao_manual_nunca_e_desativada_pela_sincronizacao(iso):
    m = mundo(iso)
    manual = _um(
        iso, "insert into adm_vinculos (classe, registro_chave, fonte_slug, url, url_sha, origem) values ('contato_mandato', %s, 'camara', 'https://manual.example/contato', %s, 'correcao_manual') returning id",
        str(m["man"]), sha256_text("https://manual.example/contato"))["id"]
    V.sincronizar(iso)
    iso.execute("delete from mandate_contacts where mandate_id = %s", (m["man"],))  # a origem some: o vínculo da fonte sai, o manual fica
    r = V.sincronizar(iso)
    assert r.desativados["contato_mandato"] == 1 and r.manuais_preservados == 1
    assert _um(iso, "select vigente, origem from adm_vinculos where id = %s", manual) == {"vigente": True, "origem": "correcao_manual"}
    assert _um(iso, "select vigente from adm_vinculos where url = %s and classe = 'contato_mandato' and origem = 'registro_oficial'", URL_CAMARA_FONTE)["vigente"] is False
    # o manual também não é substituído por um vínculo novo da mesma origem automática
    assert _um(iso, "select count(*) as n from adm_vinculos where substitui_id = %s", manual)["n"] == 0
    assert not V.sincronizar(iso).mudou()


def test_sincronizar_nao_escreve_fora_de_adm_vinculos(iso):
    mundo(iso)
    ver = lambda: {t: iso.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in ("sapl_houses", "data_coverage", "mandate_contacts", "identity_match_queue", "sources", "places", "ingest_runs", "adm_tentativas", "adm_evidencias")}  # noqa: E731, S608
    antes = ver()
    V.sincronizar(iso)
    assert ver() == antes


# ------------------------------------------------------------------ consultas


def _evidencia(iso, url, hash_, lida, tentativas):
    rod = _um(iso, "insert into adm_rodadas (coletor, modo) values ('sapl.camaras', 'recoletar') returning id")["id"]
    iso.execute("insert into adm_evidencias (url_sha, url, conteudo_sha256, lida_em, rodada_id) values (%s, %s, %s, %s, %s)", (sha256_text(url), url, hash_, lida, rod))
    for quando, resultado, motivo in tentativas:
        iso.execute("insert into adm_tentativas (rodada_id, url, url_sha, tentada_em, resultado, motivo) values (%s, %s, %s, %s, %s, %s)", (rod, url, sha256_text(url), quando, resultado, motivo))


def test_por_url_por_fonte_e_do_registro_nos_dois_sentidos_com_ordenacao(iso):
    m = mundo(iso)
    V.sincronizar(iso)
    h1 = "a" * 64
    _evidencia(iso, BASE_CAMARA, h1, AGORA - timedelta(days=2), [(AGORA - timedelta(days=2), "lida", None), (AGORA - timedelta(hours=1), "falha", "expiracao")])

    # URL -> registros
    u = V.por_url(iso, BASE_CAMARA)
    assert u["consulta"]["url_sha"] == sha256_text(BASE_CAMARA)
    assert len(u["vinculos"]) == 1
    v = u["vinculos"][0]
    assert (v["classe"], v["registro_chave"], v["origem"], v["vigente"], v["fonte_slug"]) == ("vinculo_sapl", str(m["h_cam"]), "descoberta_automatica", True, "sapl")
    assert v["rotulo"] == "Câmara Municipal de Cidade Teste · Cidade Teste/SP"
    assert v["evidencia"]["conteudo_sha256"] == h1 and v["evidencia"]["lida_em"] == AGORA - timedelta(days=2)  # a última evidência VÁLIDA, não a falha
    assert v["ultima_tentativa"]["resultado"] == "falha" and v["ultima_tentativa"]["motivo"] == "expiracao"
    assert v["desde"] is not None
    sem = V.por_url(iso, REG_CAMARA)["vinculos"][0]
    assert sem["evidencia"] is None and sem["ultima_tentativa"] is None and sem["desconhecidos"]["evidencia"] and sem["desconhecidos"]["ultima_tentativa"]
    assert V.por_url(iso, "https://ninguem-usa.example/")["vinculos"] == []
    with pytest.raises(ErroAdmin):
        V.por_url(iso, "  ")

    # fonte -> registros, ordenados por classe e depois por chave
    f = V.por_fonte(iso, "camara")["vinculos"]
    assert [(x["classe"], x["registro_chave"]) for x in f] == sorted([("contato_mandato", str(m["man"])), ("identidade", str(m["q"]))])
    assert f[0]["rotulo"] == "mandato vereador · Câmara Municipal de Cidade Teste · Cidade Teste/SP"  # cargo e casa; sem pessoa nem partido
    assert f[1]["rotulo"] == "fila de identidade · camara · EXT-ADM-1 (pendente)"
    s = V.por_fonte(iso, "sapl")["vinculos"]
    chaves = [(x["classe"], x["registro_chave"]) for x in s]
    assert chaves == sorted(chaves) and chaves[0][0] == "cobertura" and {x["classe"] for x in s} == {"cobertura", "vinculo_sapl"}
    assert {x["url"] for x in s} == {REG_CAMARA, BASE_CAMARA, EVID_PROP}
    assert [x["rotulo"] for x in s if x["classe"] == "cobertura"] == ["cobertura propostas · Cidade Teste/SP"]
    assert V.por_fonte(iso, "sapl-ale")["vinculos"][0]["registro_chave"] == str(m["h_ale"])  # fonte do catálogo, ainda sem linha em sources
    with pytest.raises(ErroAdmin, match="fonte desconhecida"):
        V.por_fonte(iso, "nao-existe")

    # registro -> fontes, URLs e runs
    d = V.do_registro(iso, "vinculo_sapl", str(m["h_cam"]))
    assert d["fontes"] == ["sapl"] and {x["url"] for x in d["vinculos"]} == {REG_CAMARA, BASE_CAMARA}
    assert {x["origem"] for x in d["vinculos"]} == {"descoberta_automatica", "registro_oficial"}
    ch = [(x["classe"], x["registro_chave"], x["vigente"]) for x in d["vinculos"]]
    assert ch == sorted(ch, key=lambda t: (t[0], t[1], not t[2]))


def test_do_registro_runs_determinaveis_e_nao_determinaveis(iso):
    m = mundo(iso)
    V.sincronizar(iso)
    s_sapl = _um(iso, "select id from sources where slug = 'sapl'")["id"]
    s_cam = _um(iso, "select id from sources where slug = 'camara'")["id"]
    r_casa = _um(iso, "insert into ingest_runs (source_id, dataset, started_at, finished_at, status, rows_upserted) values (%s, %s, %s, %s, 'succeeded', 5) returning id", s_sapl, f"sapl.{IBGE}", AGORA - 3 * timedelta(hours=1), AGORA)["id"]
    iso.execute("insert into dataset_stamps (dataset, source_id, refreshed_at, last_run_id) values (%s, %s, %s, %s)", (f"sapl.{IBGE}", s_sapl, AGORA, r_casa))
    iso.execute("insert into ingest_runs (source_id, dataset, started_at, finished_at, status) values (%s, 'sapl.descoberta', %s, %s, 'succeeded')", (s_sapl, AGORA - timedelta(hours=9), AGORA - timedelta(hours=8)))
    r_extras = _um(iso, "insert into ingest_runs (source_id, dataset, started_at, finished_at, status) values (%s, 'parlamento.extras', %s, %s, 'partial') returning id", s_cam, AGORA - timedelta(days=1), AGORA)["id"]

    # Câmara: o dataset da casa e a descoberta (compartilhada); o run exato não existe na tabela
    r = V.do_registro(iso, "vinculo_sapl", str(m["h_cam"]))["runs"]
    assert r["determinacao"] == "dataset" and [d["dataset"] for d in r["datasets"]] == ["sapl.descoberta", f"sapl.{IBGE}"]  # ordem do catálogo
    casa, desc = r["datasets"][1], r["datasets"][0]
    assert casa["ultimos_runs"][0]["id"] == str(r_casa) and casa["ultimo_carimbo_do_dataset"]["last_run_id"] == str(r_casa)
    assert casa["observacao"] is None and "compartilhado" in desc["observacao"] and len(desc["ultimos_runs"]) == 1
    assert r["run_exato"] is None and "sapl_houses não tem run_id" in r["run_exato_motivo"]
    # Assembleia: sapl-ale.<uf> e sapl-ale.descoberta (a fonte ainda não tem linha em sources: sem runs, e isso aparece como lista vazia)
    a = V.do_registro(iso, "vinculo_sapl", str(m["h_ale"]))["runs"]
    assert [d["dataset"] for d in a["datasets"]] == ["sapl-ale.descoberta", "sapl-ale.ro"] and all(d["ultimos_runs"] == [] for d in a["datasets"])
    # cobertura com evidência do SAPL da casa: datasets da casa; com evidência de outro site: não determinável, com o motivo
    c1 = V.do_registro(iso, "cobertura", f"{IBGE}:propostas")
    assert c1["runs"]["determinacao"] == "dataset" and {d["dataset"] for d in c1["runs"]["datasets"]} == {f"sapl.{IBGE}", "sapl.descoberta"} and c1["rotulo"] == "cobertura propostas · Cidade Teste/SP"
    c2 = V.do_registro(iso, "cobertura", f"{IBGE}:contato")["runs"]
    assert c2["determinacao"] == "nao_determinavel" and c2["motivo"].startswith("não determinável: ") and c2["run_exato"] is None and c2["datasets"] == []
    # contato: o único coletor do catálogo que grava mandate_contacts; a fonte `curadoria` não conta
    ct = V.do_registro(iso, "contato_mandato", str(m["man"]))["runs"]
    assert ct["determinacao"] == "dataset" and ct["datasets"][0]["dataset"] == "parlamento.extras" and ct["datasets"][0]["ultimos_runs"][0]["id"] == str(r_extras)
    assert ct["run_exato"] is None and "mandate_contacts não tem run_id" in ct["run_exato_motivo"]
    # identidade: vários datasets candidatos no catálogo, a fila não guarda qual
    i = V.do_registro(iso, "identidade", str(m["q"]))["runs"]
    assert i["determinacao"] == "nao_determinavel" and i["candidatos"] and i["motivo"].startswith("não determinável: ") and i["datasets"] == []
    assert any(c["coletor"] == "camara.diario" for c in i["candidatos"])


def test_chave_inexistente_e_classe_invalida(iso):
    mundo(iso)
    for classe, chave, msg in [("nao_existe", "1", "classe inválida"), ("vinculo_sapl", "999999999", "registro inexistente"), ("vinculo_sapl", "abc", "registro inexistente"),
                               ("cobertura", "0000000:propostas", "registro inexistente"), ("cobertura", "semdoispontos", "registro inexistente"),
                               ("contato_mandato", "nao-e-uuid", "registro inexistente"), ("contato_mandato", "00000000-0000-0000-0000-000000000000", "registro inexistente"),
                               ("identidade", "00000000-0000-0000-0000-000000000000", "registro inexistente"), ("identidade", "", "vazia")]:
        with pytest.raises(ErroAdmin, match=msg):
            V.do_registro(iso, classe, chave)


def test_coluna_run_detecta_run_id_e_last_run_id_na_tabela(iso):
    iso.execute("create temp table t_com_run (id int, last_run_id uuid)")
    iso.execute("create temp table t_com_run2 (id int, run_id uuid)")
    iso.execute("create temp table t_sem_run (id int)")
    assert V.coluna_run(iso, "t_com_run") == "last_run_id" and V.coluna_run(iso, "t_com_run2") == "run_id" and V.coluna_run(iso, "t_sem_run") is None
    assert all(V.coluna_run(iso, t) is None for t in V.TABELA_DA_CLASSE.values())  # hoje nenhuma tabela de classe guarda o run


# ------------------------------------------------------------------ pela CLI (com commit, banco isolado, limpeza em finally)


def test_cli_sincronizar_comita_e_as_consultas_respondem_em_json(banco_isolado, monkeypatch, capsys):
    monkeypatch.setenv("ETL_DATABASE_URL", banco_isolado)
    monkeypatch.setenv("DATABASE_URL", banco_isolado)
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    m = None
    try:
        m = mundo(c)
        c.commit()
        assert cli.main(["admin", "vinculos"]) == 2  # sem ação nem consulta
        assert cli.main(["admin", "vinculos", "sincronizar", "--url", "x"]) == 2
        capsys.readouterr()
        assert cli.main(["admin", "vinculos", "sincronizar", "--json"]) == 0
        r = json.loads(capsys.readouterr().out)
        assert sum(r["criados"].values()) == 7 and r["mudou"] is True
        assert c.execute("select count(*) as n from adm_vinculos").fetchone()["n"] == 7  # comitou
        assert cli.main(["admin", "vinculos", "sincronizar", "--json"]) == 0
        assert json.loads(capsys.readouterr().out)["mudou"] is False
        assert cli.main(["admin", "vinculos", "--url", BASE_CAMARA, "--json"]) == 0
        assert [x["registro_chave"] for x in json.loads(capsys.readouterr().out)["vinculos"]] == [str(m["h_cam"])]
        assert cli.main(["admin", "vinculos", "--fonte", "camara", "--json"]) == 0
        assert [x["classe"] for x in json.loads(capsys.readouterr().out)["vinculos"]] == ["contato_mandato", "identidade"]
        assert cli.main(["admin", "vinculos", "--registro", f"cobertura:{IBGE}:propostas", "--json"]) == 0  # a chave da cobertura tem ':'
        assert json.loads(capsys.readouterr().out)["runs"]["determinacao"] == "dataset"
        # tabelas
        assert cli.main(["admin", "vinculos", "--fonte", "sapl"]) == 0
        t = capsys.readouterr().out.rstrip("\n").split("\n")
        assert t[0].startswith("CLASSE") and t[-1].startswith("3 vínculos listados (3 vigentes); 7 vigentes de 7 em adm_vinculos")
        assert cli.main(["admin", "vinculos", "--registro", f"vinculo_sapl:{m['h_cam']}"]) == 0
        assert "runs:" in capsys.readouterr().out
        # erros: código 1, mensagem em stderr, sem traceback
        for argv, msg in ([["admin", "vinculos", "--registro", "vinculo_sapl:999999999"], "registro inexistente"], [["admin", "vinculos", "--registro", "xx:1"], "classe inválida"],
                          [["admin", "vinculos", "--registro", "semseparador"], "CLASSE:CHAVE"], [["admin", "vinculos", "--fonte", "nao-existe"], "fonte desconhecida"]):
            assert cli.main(argv) == 1
            cap = capsys.readouterr()
            assert cap.out == "" and msg in cap.err and "Traceback" not in cap.err
    finally:
        c.rollback()
        if m is not None:
            desfazer(c, m)
        c.close()
    with psycopg.connect(banco_isolado, row_factory=dict_row) as c2:
        assert c2.execute("select (select count(*) from adm_vinculos) + (select count(*) from sapl_houses) + (select count(*) from mandate_contacts) + (select count(*) from data_coverage) as n").fetchone()["n"] == 0
