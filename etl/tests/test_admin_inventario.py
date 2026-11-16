"""A3: `civico-etl admin inventario` (e o despacho `admin` em cli.py) e a saída em tabela/JSON.

Sem rede, sem skip. O inventário só lê: os testes de estado fabricam runs, carimbos e tentativas numa transação do banco isolado
(`banco_isolado`) e a revertem; o teste pelo despacho real da CLI aponta ETL_DATABASE_URL para o banco isolado, nunca para o da suíte.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row

from civico_etl import cli, schedule as S
from civico_etl.admin import inventario as I
from civico_etl.admin import saida
from civico_etl.admin.cli import SUBCOMANDOS
from civico_etl.catalogo import COLETORES

AGORA = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
H = timedelta(hours=1)
TAREFAS = {t.name: t for t in S.TASKS}


@pytest.fixture
def iso(banco_isolado):
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    yield c
    c.rollback()
    c.close()


@pytest.fixture
def vazio(iso):
    """O banco isolado sem run, carimbo nem tentativa (dentro da transação, revertida no fim)."""
    iso.execute("delete from dataset_stamps")
    iso.execute("delete from ingest_runs")
    iso.execute("delete from etl_schedule_attempts")
    return iso


def _fonte(c, slug):
    return c.execute("select id from sources where slug = %s", (slug,)).fetchone()["id"]


def run(c, slug, dataset, inicio, status, fim=None):
    return c.execute(
        "insert into ingest_runs (source_id, dataset, started_at, finished_at, status, rows_upserted, rows_rejected) values (%s, %s, %s, %s, %s, 7, 0) returning id",
        (_fonte(c, slug), dataset, inicio, fim or inicio + H / 4, status),
    ).fetchone()["id"]


def carimbo(c, slug, dataset, em, run_id=None):
    c.execute("insert into dataset_stamps (dataset, source_id, refreshed_at, last_run_id) values (%s, %s, %s, %s)", (dataset, _fonte(c, slug), em, run_id))


def tentativa(c, tarefa, inicio, exit_code):
    c.execute("insert into etl_schedule_attempts (task, attempted_at, finished_at, exit_code, tail) values (%s, %s, %s, %s, 'fim')", (tarefa, inicio, inicio + H / 4, exit_code))


def por_par(linhas):
    return {(l["coletor"], l["fonte"]): l for l in linhas}


# ------------------------------------------------------------------ despacho e códigos de saída


def test_admin_sem_subcomando_imprime_ajuda_e_sai_com_2(capsys):
    assert cli.main(["admin"]) == 2
    saida_ = capsys.readouterr()
    assert saida_.out == "" and "inventario" in saida_.err and "vinculos" in saida_.err


def test_subcomando_desconhecido_e_uso_invalido_saem_com_2(capsys):
    assert cli.main(["admin", "nao-existe"]) == 2
    assert cli.main(["admin", "inventario", "--nao-existe"]) == 2
    assert cli.main(["admin", "vinculos", "--url", "x", "--fonte", "y"]) == 2  # opções mutuamente exclusivas (argparse)
    assert capsys.readouterr().out == ""


def test_registro_de_subcomandos_nesta_entrega():
    assert set(SUBCOMANDOS) == {"inventario", "vinculos"}


def test_despacho_real_da_cli_devolve_um_item_por_coletor_e_fonte(banco_isolado, monkeypatch, capsys):
    monkeypatch.setenv("ETL_DATABASE_URL", banco_isolado)
    monkeypatch.setenv("DATABASE_URL", banco_isolado)
    assert cli.main(["admin", "inventario", "--json"]) == 0
    out = capsys.readouterr().out
    doc = json.loads(out)  # um único documento, sem texto extra
    esperado = [(c.id, f.slug) for c in COLETORES for f in c.fontes]
    assert [(l["coletor"], l["fonte"]) for l in doc] == esperado
    assert len({l["coletor"] for l in doc}) == len(COLETORES) == 24
    assert {l["estado"] for l in doc} <= set(I.ESTADOS)
    # --json antes do subcomando dá o mesmo documento
    assert cli.main(["admin", "--json", "inventario"]) == 0
    assert json.loads(capsys.readouterr().out) == doc


def test_filtros_e_erro_de_filtro_desconhecido(banco_isolado, monkeypatch, capsys):
    monkeypatch.setenv("ETL_DATABASE_URL", banco_isolado)
    assert cli.main(["admin", "inventario", "--coletor", "pauta", "--fonte", "camara", "--json"]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert [(l["coletor"], l["fonte"]) for l in doc] == [("pauta", "camara")]
    assert cli.main(["admin", "inventario", "--coletor", "nao.existe"]) == 1
    cap = capsys.readouterr()
    assert cap.out == "" and "coletor desconhecido" in cap.err and "Traceback" not in cap.err
    assert cli.main(["admin", "inventario", "--fonte", "nao-existe"]) == 1
    assert "fonte desconhecida" in capsys.readouterr().err


def test_sem_variavel_de_banco_sai_com_1_e_mensagem(monkeypatch, capsys):
    monkeypatch.delenv("ETL_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert cli.main(["admin", "inventario"]) == 1
    cap = capsys.readouterr()
    assert cap.out == "" and "ETL_DATABASE_URL" in cap.err


def test_demais_comandos_da_cli_continuam_despachando(monkeypatch):
    chamado = []

    class Conn:
        def close(self):
            chamado.append("close")

    monkeypatch.setattr(cli.db, "connect", lambda: Conn())
    monkeypatch.setattr("civico_etl.jobs.checks.run_checks", lambda conn: chamado.append("run_checks") or False)
    assert cli.main(["check"]) == 0
    assert chamado == ["run_checks", "close"]


# ------------------------------------------------------------------ inventário: conteúdo


def test_banco_sem_run_todo_coletor_com_tarefa_e_nunca_carregado_e_nulo_nao_e_zero(vazio):
    linhas = I.inventario(vazio, agora=AGORA, ambiente={})
    assert [(l["coletor"], l["fonte"]) for l in linhas] == [(c.id, f.slug) for c in COLETORES for f in c.fontes]
    por_coletor = {c.id: c for c in COLETORES}
    for l in linhas:
        c = por_coletor[l["coletor"]]
        if not c.tarefas:
            assert l["estado"] == "sem_agenda"
        elif c.env:
            assert l["estado"] == "aguardando_chave", l["coletor"]
        else:
            assert l["estado"] == "nunca_carregado", l["coletor"]
        # desconhecido é null com motivo, nunca zero
        assert l["ultimo_run"] is None and l["ultima_tentativa"] is None and l["carimbo_em"] is None and l["idade_h"] is None
        assert l["dentro_do_prazo"] is None
        for campo in ("ultimo_run", "ultima_tentativa", "carimbo_em", "idade_h", "dentro_do_prazo"):
            assert l["desconhecidos"].get(campo), (l["coletor"], campo)
        assert l["datasets"]["conhecidos_total"] == 0 and l["datasets"]["conhecidos"] == []
        assert all(k in l["desconhecidos"] for k, v in l.items() if v is None and k not in {"desconhecidos", "tarefa", "prazo_revalidacao_h"})
        assert l["tem_tarefa"] is bool(c.tarefas) and (l["tem_tarefa"] or ("tarefa" not in l["desconhecidos"] and "prazo_revalidacao_h" not in l["desconhecidos"]))
    assert {l["coletor"] for l in linhas if l["estado"] == "aguardando_chave"} == {"sancoes.cgu", "transparencia.emendas"}
    assert {l["coletor"] for l in linhas if l["estado"] == "sem_agenda"} == {"pauta"}
    # com a chave no ambiente (valor qualquer; nada é lido de arquivo), o mesmo coletor é "nunca carregado"
    com = por_par(I.inventario(vazio, agora=AGORA, ambiente={"TRANSPARENCIA_API_KEY": "x"}))
    assert com[("sancoes.cgu", "cgu")]["estado"] == "nunca_carregado"
    assert vazio.execute("select txid_current_if_assigned() as t").fetchone()["t"] is None  # nenhuma escrita


def test_prazos_vem_da_agenda_e_da_regua_do_site(vazio):
    l = por_par(I.inventario(vazio, agora=AGORA, ambiente={}))
    assert l[("camara.equipe", "camara")]["prazo_revalidacao_h"] == TAREFAS["camara.equipe"].every_h == 7 * 24
    assert l[("camara.equipe", "camara")]["prazo_frescor_site_h"] == S.MAX_AGE_H["camara"]
    assert l[("tse.candidatos", "tse-titulo")]["prazo_frescor_site_h"] is None
    assert "MAX_AGE_H" in l[("tse.candidatos", "tse-titulo")]["desconhecidos"]["prazo_frescor_site_h"]
    p = l[("pauta", "camara")]
    assert p["tem_tarefa"] is False and p["tarefa"] is None and p["prazo_revalidacao_h"] is None and p["tarefas"] == []
    assert I.linhas_da_tabela([p])[0]["prazo_revalidacao_h"] == "sem tarefa na agenda" == I.linhas_da_tabela([p])[0]["tarefa"]
    assert "etl-pauta.yml:pauta" in p["orquestradores"]
    assert l[("sapl.camaras", "sapl")]["tarefas"][0]["every_h"] == TAREFAS["sapl.todas"].every_h
    assert l[("camara.noturna", "camara")]["tarefas"][0]["janela"].startswith("05:00-07:00 BRT")


def test_estados_com_carimbos_runs_e_tentativas_fabricados(vazio):
    c = vazio
    # em_dia: camara.equipe carimbada há 48 h (prazo 168 h)
    r1 = run(c, "camara", "camara.equipe", AGORA - 48 * H, "succeeded")
    carimbo(c, "camara", "camara.equipe", AGORA - 48 * H, r1)
    tentativa(c, "camara.equipe", AGORA - 48 * H, 0)
    # vencido: ibge.places carimbada há 400 dias (prazo 365 dias)
    r2 = run(c, "ibge", "ibge.places", AGORA - 400 * 24 * H, "succeeded")
    carimbo(c, "ibge", "ibge.places", AGORA - 400 * 24 * H, r2)
    # ultima_falhou: camara.presenca com carimbo recente (5 h, prazo 20 h) e o último run failed (1 h)
    r3 = run(c, "camara", "camara.presenca.2026", AGORA - 6 * H, "succeeded")
    carimbo(c, "camara", "camara.presenca.2026", AGORA - 5 * H, r3)
    run(c, "camara", "camara.presenca.2026", AGORA - 1 * H, "failed")
    tentativa(c, "camara.presenca", AGORA - 1 * H, 1)
    # vencido com carimbo parcial: o carimbo existe, mas o run que o deixou é `partial` (a agenda ignora esse carimbo ao decidir)
    r4 = run(c, "ibge", "ibge.malhas", AGORA - 1 * H, "partial")
    carimbo(c, "ibge", "ibge.malhas", AGORA - 1 * H, r4)
    # sem agenda, com o último run falho
    run(c, "camara", "pauta.camara", AGORA - 2 * H, "failed")
    l = por_par(I.inventario(c, agora=AGORA, ambiente={}))

    eq = l[("camara.equipe", "camara")]
    assert eq["estado"] == "em_dia" and eq["dentro_do_prazo"] is True and eq["idade_h"] == 48.0
    assert eq["ultimo_run"]["status"] == "succeeded" and eq["ultimo_run"]["linhas_gravadas"] == 7 and eq["ultimo_run"]["linhas_rejeitadas"] == 0
    assert eq["ultimo_run"]["dataset"] == "camara.equipe" and eq["ultimo_run"]["id"] == str(r1)
    assert eq["ultimo_run"]["desconhecidos"]["rows_read"]  # o job não informou: null com motivo
    assert eq["ultimo_run"]["linhas_lidas"] is None
    assert eq["ultima_tentativa"]["desfecho"] == "ok" and eq["ultima_tentativa"]["exit_code"] == 0 and eq["ultima_tentativa"]["tarefa"] == "camara.equipe"
    assert eq["datasets"]["conhecidos_total"] == 1 and eq["datasets"]["conhecidos"][0] == {"dataset": "camara.equipe", "runs": 1, "carimbo_em": AGORA - 48 * H}

    pl = l[("ibge.places", "ibge")]
    assert pl["estado"] == "vencido" and pl["dentro_do_prazo"] is False and "carimbo há" in pl["estado_motivo"]
    assert pl["ultima_tentativa"] is None and pl["desconhecidos"]["ultima_tentativa"]

    pr = l[("camara.presenca", "camara")]
    assert pr["estado"] == "ultima_falhou" and pr["ultimo_run"]["status"] == "failed" and pr["ultima_tentativa"]["desfecho"] == "falhou"
    assert pr["dentro_do_prazo"] is True  # o carimbo (5 h) está dentro do prazo (20 h): o estado vem da falha, não do prazo

    ml = l[("ibge.malhas", "ibge")]
    assert ml["estado"] == "vencido" and ml["carimbo_em"] == AGORA - 1 * H and ml["dentro_do_prazo"] is False

    pa = l[("pauta", "camara")]
    assert pa["estado"] == "sem_agenda" and pa["ultimo_run"]["status"] == "failed"  # o último run falho aparece, o estado continua sem_agenda

    assert l[("senado.diario", "senado")]["estado"] == "nunca_carregado"
    assert l[("camara.diario", "camara")]["estado"] == "nunca_carregado"
    # o run de uma fonte não aparece na linha de outra do mesmo coletor
    assert l[("pauta", "senado")]["ultimo_run"] is None


def test_frescor_coincide_com_o_que_a_agenda_diz(vazio):
    c = vazio
    r = run(c, "camara", "camara.equipe", AGORA - 48 * H, "succeeded")
    carimbo(c, "camara", "camara.equipe", AGORA - 48 * H, r)
    r = run(c, "ibge", "ibge.places", AGORA - 400 * 24 * H, "succeeded")
    carimbo(c, "ibge", "ibge.places", AGORA - 400 * 24 * H, r)
    r = run(c, "ibge", "ibge.malhas", AGORA - 1 * H, "partial")
    carimbo(c, "ibge", "ibge.malhas", AGORA - 1 * H, r)
    l = por_par(I.inventario(c, agora=AGORA, ambiente={}))
    for nome, (coletor, fonte) in {"camara.equipe": ("camara.equipe", "camara"), "ibge.places": ("ibge.places", "ibge"), "ibge.malhas": ("ibge.malhas", "ibge"),
                                   "camara.diario": ("camara.diario", "camara")}.items():
        t = TAREFAS[nome]
        stamp = S.last_stamp(c, t, AGORA.date())
        due, _ = S.is_due(t, S.last_stamp(c, t, AGORA.date(), clean=True), None, AGORA)
        row = l[(coletor, fonte)]
        assert row["carimbo_em"] == stamp, nome
        if stamp is None:
            assert row["dentro_do_prazo"] is None and row["idade_h"] is None
        else:
            assert row["dentro_do_prazo"] is (not due), nome
            assert row["idade_h"] == round((AGORA - stamp).total_seconds() / 3600, 2)
        assert row["prazo_revalidacao_h"] == t.every_h


# ------------------------------------------------------------------ tabela e utilidades


def test_tabela_tem_cabecalho_largura_fixa_e_total_com_denominador(banco_isolado, monkeypatch, capsys):
    monkeypatch.setenv("ETL_DATABASE_URL", banco_isolado)
    assert cli.main(["admin", "inventario"]) == 0
    linhas = capsys.readouterr().out.rstrip("\n").split("\n")
    assert linhas[0].startswith("COLETOR") and set(linhas[1].replace(" ", "")) == {"-"}
    assert linhas[-2] == "" and linhas[-1].startswith("24 de 24 coletores (30 linha(s) coletor/fonte); ") and " nunca carregados" in linhas[-1]
    corpo = linhas[2:-2]
    assert len(corpo) == 30
    assert max(len(x) for x in linhas[:-2]) <= len(linhas[1])  # nenhuma linha passa do separador: largura fixa por coluna
    assert all("\x1b[" not in x for x in linhas)  # sem cor
    assert "desconhecido: " in "\n".join(corpo)
    pauta = [x for x in corpo if x.startswith("pauta ")]
    assert len(pauta) == 2 and all(x.count("sem tarefa na agenda") == 2 and "desconhecido: sem tarefa na agenda" not in x for x in pauta)
    assert all(h in linhas[0] for h in ("ORIGEM", "DATASETS", "NO PRAZO")) and "0 conhecidos; 2 padrões" in "\n".join(pauta)


def test_total_com_filtro_mostra_denominador_do_catalogo():
    linhas = [{"coletor": "pauta", "fonte": "camara", "estado": "sem_agenda"}, {"coletor": "pauta", "fonte": "senado", "estado": "sem_agenda"}]
    assert I.total(linhas) == "1 de 24 coletores (2 linha(s) coletor/fonte); 0 nunca carregados; 1 sem agenda"


def test_saida_nulo_vira_desconhecido_com_motivo_e_json_e_iso():
    assert saida.celula({"x": None, "desconhecidos": {"x": "sem run"}}, "x") == "desconhecido: sem run"
    assert saida.celula({"x": None}, "x") == "desconhecido"
    assert saida.celula({"x": 0}, "x") == "0"  # zero é zero, não desconhecido
    doc = json.loads(saida.para_json({"quando": datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc), "n": None}))
    assert doc == {"quando": "2026-11-15T12:00:00+00:00", "n": None}
    t = saida.tabela([("a", "A"), ("b", "B")], [{"a": "x" * 80, "b": 1}], largura_max=10, total="1 de 1")
    assert "xxxxxxxxx…" in t and t.endswith("1 de 1")


def test_regex_dos_padroes_do_catalogo():
    import re

    assert re.match(I.regex_dataset("sapl.{ibge}"), "sapl.3509502") and not re.match(I.regex_dataset("sapl.{ibge}"), "sapl.descoberta")
    assert re.match(I.regex_dataset("camara.votacoes.{ano}"), "camara.votacoes.2026") and not re.match(I.regex_dataset("camara.votacoes.{ano}"), "camara.votacoes.2026x")
    assert re.match(I.regex_dataset("agenda.camara.{YYYYMMDD}-{YYYYMMDD}"), "agenda.camara.20261101-20261215")
    assert re.match(I.regex_dataset("sapl-ale.{uf}"), "sapl-ale.ro") and not re.match(I.regex_dataset("sapl-ale.{uf}"), "sapl-ale.descoberta")
    assert not re.match(I.regex_dataset("sapl.descoberta"), "saplXdescoberta")
