"""D274: launchd do SAPL das câmaras contra produção. A URI de produção só pode existir no Keychain e no ambiente do processo filho.

Testes estáticos rodam sempre. O de ponta a ponta usa o Keychain de verdade com um SERVIÇO DE TESTE e uma URI falsa
(CIVICO_TEST_KEYCHAIN=1, só macOS); nunca toca o serviço civico-etl-prod nem produção.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[1] / "deploy"
INSTALL, WRAP = DEPLOY / "launchd-sapl-prod.sh", DEPLOY / "run-due-sapl-prod.sh"
FAKE_PASS = "S3nh4Falsa9X"
FAKE_URI = f"postgres://etl_writer:{FAKE_PASS}@127.0.0.1:1/postgres"


def test_scripts_validos_e_executaveis():
    for f in (INSTALL, WRAP):
        assert os.access(f, os.X_OK), f
        subprocess.run(["bash", "-n", str(f)], check=True)


def test_plist_nao_tem_uri_nem_segredo():
    out = subprocess.run(["bash", str(INSTALL), "print-plist"], capture_output=True, text=True, check=True).stdout
    assert "org.civico.etl.sapl-prod" in out and "StartCalendarInterval" in out and "run-due-sapl-prod.sh" in out
    assert not re.search(r"postgres(ql)?://|ETL_DATABASE_URL|password|senha", out, re.I)


def test_uri_nunca_vai_para_argv_nos_scripts():
    src = INSTALL.read_text() + WRAP.read_text()
    # security add-generic-password termina em `-w` sem valor (prompt interativo); nenhum -w com valor, exceto o `-w` de leitura (find)
    assert re.search(r"add-generic-password -U -s \"\$SERVICE\" -a \"\$ACCOUNT\" -w\s*$", src, re.M)
    assert not re.search(r"add-generic-password[^\n]*-w[ \t]+[\"$'a-zA-Z]", src)
    assert "--force" not in WRAP.read_text().replace("sem --force", "")  # o wrapper nunca força


def test_wrapper_roda_so_o_sapl_das_camaras_e_respeita_prazo():
    w = WRAP.read_text()
    assert "ETL_TASKS_INCLUDE=sapl.todas" in w and "ETL_DEADLINE_MIN" in w and "civico_etl.cli run-due" in w


def test_deadline_padrao_cobre_timeout_da_tarefa_mais_reserva():
    """Se o prazo for menor que timeout_h + RESERVE_MIN, task_timeout_h corta a tarefa e a agenda a mata com exit 124 (achado M16)."""
    from civico_etl import schedule as S

    m = re.search(r"ETL_DEADLINE_MIN:-(\d+)", WRAP.read_text())
    assert m
    deadline = int(m.group(1))
    task = next(t for t in S.TASKS if t.name == "sapl.todas")
    assert deadline >= task.timeout_h * 60 + S.RESERVE_MIN
    assert S.task_timeout_h(task.timeout_h, 0, deadline) == task.timeout_h  # a tarefa recebe o timeout inteiro, não um cortado
    argv = task.argv(date.today())
    orcamento = int(argv[argv.index("--orcamento-min") + 1])
    assert orcamento + 25 <= task.timeout_h * 60  # orçamento + prazo de uma câmara (HOUSE_MAX_MIN) cabem no timeout


# --- pré-condições e alerta, sem Keychain real: `security` e `curl` falsos no PATH -------------------------------------------------------
needs_mac = pytest.mark.skipif(sys.platform != "darwin", reason="o wrapper usa stat -f (macOS)")


def _stub_env(tmp_path, items: dict[str, str], py_ok: bool = True):
    """security falso lê <dir>/<conta>; curl falso grava argv e stdin em curl.rec. Retorna (env, log, curl_rec)."""
    bin_, kc = tmp_path / "bin", tmp_path / "kc"
    bin_.mkdir(), kc.mkdir()
    for k, v in items.items():
        (kc / k).write_text(v)
    (bin_ / "security").write_text(f'#!/bin/bash\nwhile [ "$1" != "-a" ] && [ $# -gt 0 ]; do shift; done\nf="{kc}/$2"\n[ -f "$f" ] && cat "$f" || exit 44\n')
    rec = tmp_path / "curl.rec"
    (bin_ / "curl").write_text(f'#!/bin/bash\necho "ARGV: $*" >> "{rec}"\ncat >> "{rec}"\n')
    py = tmp_path / "py"
    py.write_text('#!/bin/bash\necho "PYTHON RODOU hook=${ETL_ALERT_WEBHOOK:+set} deadline=$ETL_DEADLINE_MIN"\nexit 0\n')
    for f in (bin_ / "security", bin_ / "curl", py):
        f.chmod(f.stat().st_mode | stat.S_IXUSR)
    log = tmp_path / "sapl.log"
    env = {**os.environ, "PATH": f"{bin_}:{os.environ['PATH']}", "CIVICO_ETL_PYTHON": str(py if py_ok else tmp_path / "nao-existe"),
           "CIVICO_SAPL_LOG": str(log), "CIVICO_SAPL_STATE": str(tmp_path / "state")}
    return env, log, rec


HOOK_URL = "https://hooks.exemplo.test/T000/SEGREDO-DO-HOOK"


@needs_mac
def test_sem_webhook_avisa_no_log_e_segue_rodando(tmp_path):
    """Compatibilidade com o launchd do dono: item do webhook ausente NÃO pode parar o SAPL (nada de exit 78)."""
    env, log, rec = _stub_env(tmp_path, {"ETL_DATABASE_URL": FAKE_URI})
    r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
    assert r.returncode == 0
    text = log.read_text()
    assert "sem ETL_ALERT_WEBHOOK no Keychain: falha deste run não será avisada; o vigia do site acusa em até 8 dias" in text
    assert "PYTHON RODOU hook= deadline=225" in text  # o run-due rodou, sem webhook no ambiente
    assert not rec.exists()  # sem webhook, nenhum curl


@needs_mac
def test_sem_webhook_precondicao_falha_sem_alerta_e_sem_rodar(tmp_path):
    env, log, rec = _stub_env(tmp_path, {})  # sem URI e sem webhook
    r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
    assert r.returncode == 1
    text = log.read_text()
    assert "sem a URI no Keychain" in text and "PYTHON RODOU" not in text and not rec.exists()


@needs_mac
def test_sem_webhook_exit_do_run_due_e_propagado(tmp_path):
    env, log, rec = _stub_env(tmp_path, {"ETL_DATABASE_URL": FAKE_URI})
    (tmp_path / "py").write_text('#!/bin/bash\necho "erro com a URI: $ETL_DATABASE_URL"\nexit 3\n')
    r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
    text = log.read_text()
    assert r.returncode == 3 and "exit 3" in text and FAKE_URI not in text and FAKE_PASS not in text and "<URI>" in text


@needs_mac
@pytest.mark.parametrize("items, py_ok, msg", [
    ({}, True, "sem a URI no Keychain"),
    ({"ETL_DATABASE_URL": "mysql://x"}, True, "não parece uma URI"),
    ({"ETL_DATABASE_URL": FAKE_URI}, False, "falta "),
])
def test_precondicao_falha_dispara_webhook_antes_do_python(tmp_path, items, py_ok, msg):
    env, log, rec = _stub_env(tmp_path, {**items, "ETL_ALERT_WEBHOOK": HOOK_URL}, py_ok)
    r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
    assert r.returncode == 1
    text = log.read_text()
    assert msg in text and "PYTHON RODOU" not in text and HOOK_URL not in text and FAKE_PASS not in text
    sent = rec.read_text()
    assert msg in sent and "sapl.todas" in sent and "ARGV: " in sent
    assert HOOK_URL in sent.split("\n", 1)[1] and HOOK_URL not in sent.split("\n", 1)[0]  # a URL vai por stdin (-K -), nunca em argv


@needs_mac
def test_caminho_feliz_repassa_webhook_e_prazo_ao_python(tmp_path):
    env, log, rec = _stub_env(tmp_path, {"ETL_DATABASE_URL": FAKE_URI, "ETL_ALERT_WEBHOOK": HOOK_URL})
    r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
    assert r.returncode == 0
    assert "PYTHON RODOU hook=set deadline=225" in log.read_text() and not rec.exists()  # sem falha, o wrapper não alerta


@pytest.mark.skipif(sys.platform != "darwin" or not shutil.which("security") or os.environ.get("CIVICO_TEST_KEYCHAIN") != "1",
                    reason="usa o Keychain real com serviço de teste: CIVICO_TEST_KEYCHAIN=1 no macOS")
def test_ponta_a_ponta_keychain_de_teste(tmp_path):
    service = f"civico-etl-test-{uuid.uuid4().hex[:8]}"
    stub = tmp_path / "py"
    stub.write_text(
        "#!/bin/bash\n"
        'echo "TASKS=$ETL_TASKS_INCLUDE URI_LEN=${#ETL_DATABASE_URL} DEADLINE=$ETL_DEADLINE_MIN"\n'
        'echo "erro simulado com a URI: $ETL_DATABASE_URL e só a senha: ' + FAKE_PASS + '"\n'
        "exit 2\n")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
    log, state = tmp_path / "sapl.log", tmp_path / "state"
    env = {**os.environ, "CIVICO_KEYCHAIN_SERVICE": service, "CIVICO_ETL_PYTHON": str(stub), "CIVICO_SAPL_LOG": str(log), "CIVICO_SAPL_STATE": str(state)}
    add = ["security", "add-generic-password", "-U", "-s", service, "-a", "ETL_DATABASE_URL", "-w", FAKE_URI]  # URI FALSA de teste
    try:
        subprocess.run(add, check=True, capture_output=True)
        subprocess.run(["security", "add-generic-password", "-U", "-s", service, "-a", "ETL_ALERT_WEBHOOK", "-w", "http://127.0.0.1:1/hook"], check=True, capture_output=True)  # webhook presente (opcional no wrapper); porta fechada: o alerta falha rápido
        r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
        assert r.returncode == 2  # o exit do run-due é propagado pelo pipe de redação
        text = log.read_text()
        assert "TASKS=sapl.todas" in text and f"URI_LEN={len(FAKE_URI)}" in text  # o filho recebeu a URI inteira
        assert FAKE_PASS not in text and FAKE_URI not in text and "<URI>" in text and "<senha>" in text  # e o log não a guarda
        assert "exit 2" in text and FAKE_PASS not in r.stdout + r.stderr
        st = subprocess.run(["bash", str(INSTALL), "status"], env=env, capture_output=True, text=True)
        assert "URI presente" in st.stdout and "etl_writer:***@127.0.0.1:1/postgres" in st.stdout and FAKE_PASS not in st.stdout
        # URI em modo transação (6543) é apontada
        subprocess.run(["security", "add-generic-password", "-U", "-s", service, "-a", "ETL_DATABASE_URL", "-w", FAKE_URI.replace(":1/", ":6543/")], check=True, capture_output=True)
        assert "PROBLEMA" in subprocess.run(["bash", str(INSTALL), "status"], env=env, capture_output=True, text=True).stdout
        # sem item: o wrapper falha com mensagem, sem rodar nada
        subprocess.run(["security", "delete-generic-password", "-s", service, "-a", "ETL_DATABASE_URL"], check=True, capture_output=True)
        r = subprocess.run(["bash", str(WRAP)], env=env, capture_output=True, text=True)
        assert r.returncode == 1 and "sem a URI no Keychain" in log.read_text()
    finally:
        for acct in ("ETL_DATABASE_URL", "ETL_ALERT_WEBHOOK"):
            subprocess.run(["security", "delete-generic-password", "-s", service, "-a", acct], capture_output=True)
