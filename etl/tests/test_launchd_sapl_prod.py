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
        subprocess.run(["security", "delete-generic-password", "-s", service, "-a", "ETL_DATABASE_URL"], capture_output=True)
