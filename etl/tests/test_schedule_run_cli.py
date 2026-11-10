"""schedule._run_cli: subprocesso por tarefa com timeout. O comando real é trocado por um script curto; o resto do caminho é o de produção."""

from __future__ import annotations

import subprocess
import sys

import pytest

from civico_etl import schedule as S


@pytest.fixture
def fake_cli(monkeypatch):
    """Faz _run_cli rodar `python -c <código>` no lugar de `python -m civico_etl.cli <args>`."""
    real = subprocess.Popen
    code: dict[str, str] = {}

    def popen(cmd, **kw):
        assert cmd[:3] == [sys.executable, "-m", "civico_etl.cli"], cmd
        return real([sys.executable, "-c", code["src"]], **kw)

    monkeypatch.setattr(S.subprocess, "Popen", popen)
    return code


def test_timeout_mata_o_processo_e_vira_exit_124(fake_cli, tmp_path, capsys):
    fake_cli["src"] = "import time; print('começou', flush=True); time.sleep(60)"
    res = S._run_cli(["tarefa.lenta", "--x"], timeout_h=3 / 3600, log_dir=tmp_path)  # 3 s: folga para o Python filho subir em runner lento
    assert res["exit"] == 124 and res["secs"] < 20
    assert res["tail"].startswith("timeout após") and "começou" in res["tail"]
    assert (tmp_path / "tarefa.lenta.log").read_text().strip() == "começou"  # a saída sobrevive ao timeout


def test_exit_code_e_cauda_de_tres_linhas(fake_cli, tmp_path, capsys):
    fake_cli["src"] = "import sys; [print('linha', i, flush=True) for i in range(5)]; print('erro final', file=sys.stderr); sys.exit(3)"
    res = S._run_cli(["tarefa.ruim"], timeout_h=1, log_dir=tmp_path)
    assert res["exit"] == 3 and res["args"] == ["tarefa.ruim"]
    assert res["tail"] == "linha 3 | linha 4 | erro final"  # stderr vai junto no mesmo arquivo
    assert "linha 0" in capsys.readouterr().out  # eco completo no stdout da agenda


def test_sucesso_devolve_zero(fake_cli, tmp_path):
    fake_cli["src"] = "print('ok')"
    assert S._run_cli(["tarefa.boa"], timeout_h=1, log_dir=tmp_path)["exit"] == 0


def test_cauda_e_cortada_em_400_caracteres(fake_cli, tmp_path):
    fake_cli["src"] = "print('x' * 1000)"
    assert len(S._run_cli(["tarefa.tagarela"], timeout_h=1, log_dir=tmp_path)["tail"]) == 400
