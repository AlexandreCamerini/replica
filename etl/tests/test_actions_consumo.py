"""replica/tools/actions_consumo.py: a conta de minutos do Actions (S3-4 da revisão final de 14/11/2026). Puro, sem rede nem banco."""
import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("actions_consumo", RAIZ / "replica/tools/actions_consumo.py")
ac = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ac)


def run(wf, inicio, fim, *, id=None, dia="2026-11-10", conclusion="success", status="completed", event="schedule", attempt=1):
    return {
        "workflowName": wf, "event": event, "createdAt": f"{dia}T{inicio}Z", "startedAt": f"{dia}T{inicio}Z", "updatedAt": f"{dia}T{fim}Z",
        "conclusion": conclusion, "status": status, "attempt": attempt, "databaseId": id if id is not None else hash((wf, dia, inicio, fim)),
    }


def test_minuto_e_arredondado_para_cima_por_run():
    assert ac.minutos_do_run(run("etl", "10:00:00", "10:00:01")) == 1
    assert ac.minutos_do_run(run("etl", "10:00:00", "10:01:00")) == 1
    assert ac.minutos_do_run(run("etl", "10:00:00", "10:01:01")) == 2


def test_pulado_em_andamento_e_duracao_negativa_nao_contam():
    assert ac.minutos_do_run(run("etl", "10:00:00", "10:05:00", conclusion="skipped")) == 0
    assert ac.minutos_do_run(run("etl", "10:00:00", "10:05:00", status="in_progress", conclusion="")) == 0
    assert ac.minutos_do_run(run("etl", "10:05:00", "10:00:00")) == 0
    assert ac.minutos_do_run({**run("etl", "10:00:00", "10:05:00"), "startedAt": "0001-01-01T00:00:00Z"}) == 0


def job(inicio, fim, *, dia="2026-11-10", conclusion="success", name="j"):
    return {"name": name, "conclusion": conclusion, "startedAt": f"{dia}T{inicio}Z", "completedAt": f"{dia}T{fim}Z"}


D = date(2026, 11, 10)


def test_jobs_cada_um_arredondado_e_pulado_ou_nao_iniciado_vale_zero():
    jobs = [job("10:00:00", "10:00:05"), job("10:00:00", "10:02:01"), job("10:00:00", "10:09:00", conclusion="skipped"),
            {"name": "fila", "conclusion": "cancelled", "startedAt": "0001-01-01T00:00:00Z", "completedAt": "2026-11-10T10:00:00Z"},
            {"name": "sem fim", "conclusion": "", "startedAt": "2026-11-10T10:00:00Z", "completedAt": None}]
    assert ac.minutos_dos_jobs(jobs) == 1 + 3


def test_um_job_pelo_relogio_e_projecao_para_30_dias():
    arrays = [[run("etl · pauta", "10:00:00", "10:01:30", dia=f"2026-11-{d:02d}") for d in range(1, 11)]]
    t = ac.medir(arrays, date(2026, 11, 1), date(2026, 11, 10), {"etl · pauta": 1})
    (w,) = t["workflows"]
    assert (w["runs"], w["min"], w["max"], w["min_30d"], w["max_30d"], w["runs_relogio"]) == (10, 20, 20, 60, 60, 10)
    assert t["dias"] == 10 and t["min_30d"] == t["max_30d"] == 60 and t["runs_relogio"] == 10


def test_jobs_paralelos_pelo_relogio_dao_faixa_e_ordenam_pelo_maximo():
    arrays = [[run("ci", "10:00:00", "10:10:00", event="pull_request")], [run("etl", "11:00:00", "11:30:00")]]
    t = ac.medir(arrays, D, D, {"ci": 5, "etl": 1})
    assert [w["workflow"] for w in t["workflows"]] == ["ci", "etl"]
    ci = t["workflows"][0]
    assert (ci["min"], ci["max"], ci["por_evento"]) == (10, 50, {"pull_request": 10})
    assert (t["min_30d"], t["max_30d"]) == (1200, 2400)


def test_detalhe_por_job_substitui_o_relogio_e_fecha_a_faixa():
    """A fila do `concurrency` entra no relógio do run e não é cobrada: com o detalhe, vale a soma dos jobs."""
    arrays = [[run("etl", "10:00:00", "13:00:00", id=7), run("ci", "10:00:00", "10:10:00", id=8)]]
    detalhes = {7: [job("12:58:00", "13:00:00")], 8: [job("10:00:00", "10:09:30", name=n) for n in "abcde"]}
    t = ac.medir(arrays, D, D, {"ci": 5, "etl": 1}, detalhes)
    por = {w["workflow"]: w for w in t["workflows"]}
    assert (por["etl"]["min"], por["etl"]["max"], por["etl"]["runs_relogio"]) == (2, 2, 0)
    assert (por["ci"]["min"], por["ci"]["max"]) == (50, 50)
    assert t["ausentes"] == [] and t["runs_relogio"] == 0 and ac.veredito(t) == ["franquia Free (2000 min/mês): dentro", "franquia Pro (3000 min/mês): dentro"]


def test_workflow_do_repositorio_sem_run_na_entrada_rebaixa_o_veredito():
    """Uma chamada esquecida na coleta não pode virar "dentro"."""
    t = ac.medir([[run("etl", "10:00:00", "10:01:00", id=1)]], D, D, {"etl": 1, "ci": 5}, {1: [job("10:00:00", "10:01:00")]})
    assert t["ausentes"] == ["ci"]
    assert all("INDETERMINADO" in v and "ci" in v for v in ac.veredito(t))
    assert "AUSENTE" in ac.relatorio(t)


def test_mesmo_workflow_com_e_sem_detalhe_soma_exato_mais_faixa_do_relogio():
    arrays = [[run("ci", "10:00:00", "10:10:00", id=1), run("ci", "11:00:00", "11:10:00", id=2, dia="2026-11-09")]]
    t = ac.medir(arrays, date(2026, 11, 9), D, {"ci": 5}, {1: [job("10:00:00", "10:02:00"), job("10:00:00", "10:04:00")]})
    (w,) = t["workflows"]
    assert (w["min"], w["max"], w["runs_relogio"], w["primeiro"], w["ultimo"]) == (6 + 10, 6 + 50, 1, "2026-11-09", "2026-11-10")


def test_run_sem_nome_de_workflow_nao_derruba_a_conta():
    t = ac.medir([[{**run("x", "10:00:00", "10:01:00", id=1), "workflowName": None}, run("etl", "10:00:00", "10:01:00", id=2)]], D, D, {"etl": 1})
    assert {w["workflow"] for w in t["workflows"]} == {"?", "etl"} and t["max_30d"] is None


def test_detalhe_de_run_que_nao_esta_na_lista_e_ignorado():
    t = ac.medir([[run("etl", "10:00:00", "10:01:00", id=1)]], D, D, {"etl": 1}, {999: [job("10:00:00", "19:00:00")]})
    assert t["min_30d"] == 30


def test_numero_de_jobs_desconhecido_nunca_vira_um():
    t = ac.medir([[run("ci", "10:00:00", "10:10:00")]], D, D, {})
    (w,) = t["workflows"]
    assert (w["jobs"], w["min"], w["max"], t["max_30d"]) == (None, 10, None, None)
    assert all("INDETERMINADO" in v for v in ac.veredito(t))
    assert "300-?" in ac.relatorio(t)
    # com o detalhe por job o número de jobs do mapa deixa de importar
    t = ac.medir([[run("ci", "10:00:00", "10:10:00", id=1)]], D, D, {}, {1: [job("10:00:00", "10:03:00")]})
    assert (t["min_30d"], t["max_30d"]) == (90, 90)


def test_fora_da_janela_e_run_repetido_nao_contam():
    a = run("etl", "10:00:00", "10:10:00", id=1)
    fora = run("etl", "10:00:00", "10:10:00", id=2, dia="2026-11-09")
    t = ac.medir([[a, fora], [dict(a)]], D, D, {"etl": 1})
    assert t["workflows"][0]["runs"] == 1 and t["workflows"][0]["min"] == 10


def test_reexecutado_e_contado_e_sinalizado():
    t = ac.medir([[run("ci", "10:00:00", "10:10:00", attempt=3)]], D, D, {"ci": 5})
    assert t["workflows"][0]["reexecutados"] == 1
    assert "[1 reexecutados]" in ac.relatorio(t)


def test_veredito_so_e_afirmado_sem_run_pelo_relogio():
    exato = {"algum_cortado": False, "runs_relogio": 0}
    assert ac.veredito({**exato, "min_30d": 2000, "max_30d": 2000})[0].endswith("dentro")
    assert ac.veredito({**exato, "min_30d": 2001, "max_30d": 2001})[0].endswith(": ACIMA")
    est = {"algum_cortado": False, "runs_relogio": 4}
    v = ac.veredito({**est, "min_30d": 2500, "max_30d": 4000})
    assert "ACIMA pela estimativa" in v[0] and "INDETERMINADO" in v[1]
    assert "dentro pela estimativa" in ac.veredito({**est, "min_30d": 500, "max_30d": 1500})[0]


def test_lista_cortada_nunca_afirma_dentro_nem_acima():
    arrays = [[run("etl · pauta", "10:00:00", "10:01:00", id=i) for i in range(ac.LIMITE_LISTA)]]
    t = ac.medir(arrays, D, D, {"etl · pauta": 1})
    assert t["algum_cortado"] and t["workflows"][0]["cortado"]
    assert all("INDETERMINADO" in v for v in ac.veredito(t))
    assert "[LISTA CORTADA]" in ac.relatorio(t)


def test_entrada_concatenada_e_entrada_invalida():
    a, b = [run("etl", "10:00:00", "10:01:00", id=1)], [run("ci", "10:00:00", "10:01:00", id=2)]
    det = {"databaseId": 2, "jobs": [job("10:00:00", "10:01:00")]}
    assert ac.ler_entrada(json.dumps(a) + "\n" + json.dumps(det) + json.dumps(b)) == ([a, b], {2: det["jobs"]})
    for ruim in ("", "[]", "[]\n[]", "{", '{"a": 1}', "[1]", "3", json.dumps([{"workflowName": "etl"}]), json.dumps(det),
                 json.dumps(a) + '{"databaseId": 1, "jobs": [1]}', json.dumps(a) + '{"jobs": []}'):
        with pytest.raises(ac.EntradaInvalida):
            ac.ler_entrada(ruim)
    with pytest.raises(ac.EntradaInvalida):
        ac.medir([a], D, date(2026, 11, 9), {})
    with pytest.raises(ac.EntradaInvalida):
        ac.minutos_do_run({**a[0], "updatedAt": "ontem"})
    with pytest.raises(ac.EntradaInvalida):
        ac.minutos_dos_jobs([{"name": "x", "startedAt": "ontem", "completedAt": "hoje"}])


def test_jobs_lidos_dos_workflows_do_repositorio(tmp_path):
    jobs = ac.jobs_por_workflow()
    assert jobs["ci"] == 5
    assert jobs["etl"] == jobs["etl · pauta"] == jobs["etl · rascunho"] == 1
    assert ac.jobs_por_workflow(tmp_path / "nao-existe") == {}


def test_main_exit_2_em_entrada_invalida_e_0_com_json(tmp_path, capsys):
    ruim = tmp_path / "ruim.json"
    ruim.write_text("não é json", encoding="utf-8")
    assert ac.main([str(ruim)]) == 2
    assert ac.main([str(tmp_path / "nao-existe.json")]) == 2
    bom, det = tmp_path / "bom.json", tmp_path / "jobs.json"
    bom.write_text(json.dumps([run("ci", "10:00:00", "10:02:00", id=5)]), encoding="utf-8")
    det.write_text(json.dumps({"databaseId": 5, "jobs": [job("10:00:00", "10:01:10"), job("10:00:00", "10:00:20")]}), encoding="utf-8")
    capsys.readouterr()
    # pasta de workflows ausente: sem o detalhe o veredito não se afirma; com ele, a medida é exata
    assert ac.main([str(bom), "--workflows", str(tmp_path / "x")]) == 0
    assert "INDETERMINADO" in capsys.readouterr().out
    # sem --desde nem --ate a janela é o próprio dia do run (anterior a ontem)
    assert ac.main([str(bom), str(det), "--json", "--workflows", str(tmp_path / "x")]) == 0
    saida = json.loads(capsys.readouterr().out)
    assert saida["workflows"][0]["min"] == 3 and saida["dias"] == 1 and saida["runs_relogio"] == 0
