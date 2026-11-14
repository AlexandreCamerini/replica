"""`.github/scripts/toca-web.sh` decide se o e2e do web roda no ci (D323). Pular nunca pode sair de uma falha do script."""
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "toca-web.sh"
NULO = "0" * 40
ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, env=ENV, check=True, capture_output=True, text=True).stdout.strip()


def grava(repo: Path, caminho: str, texto: str = "x") -> None:
    alvo = repo / caminho
    alvo.parent.mkdir(parents=True, exist_ok=True)
    alvo.write_text(texto)


def decide(repo: Path, *args: str) -> str:
    r = subprocess.run(["bash", str(SCRIPT), *args], cwd=repo, env=ENV, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q", "-b", "main")
    grava(tmp_path, "web/a.ts")
    grava(tmp_path, "replica/doc.md")
    grava(tmp_path, ".github/workflows/ci.yml")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "base")
    return tmp_path


def merge_de_pr(repo: Path, mudanca) -> None:
    """Deixa HEAD como o commit de merge que o checkout de pull_request entrega (primeiro pai = base)."""
    git(repo, "checkout", "-q", "-b", "pr")
    mudanca(repo)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "pr")
    git(repo, "checkout", "-q", "main")
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "pr")


@pytest.mark.parametrize(
    "caminho, esperado",
    [
        ("replica/outro.md", "false"),
        ("etl/x.py", "false"),
        ("website/x.ts", "false"),  # prefixo parecido não é web/
        (".github/workflows/etl.yml", "false"),
        ("web/b.ts", "true"),
        (".github/workflows/ci.yml", "true"),
        (".github/scripts/qualquer.sh", "true"),
    ],
)
def test_pr_por_caminho(repo, caminho, esperado):
    merge_de_pr(repo, lambda r: grava(r, caminho, "novo"))
    assert decide(repo, "pull_request") == esperado


def test_pr_que_apaga_arquivo_do_web_roda(repo):
    merge_de_pr(repo, lambda r: (r / "web/a.ts").unlink())
    assert decide(repo, "pull_request") == "true"


def test_pr_que_move_arquivo_para_fora_do_web_roda(repo):
    """Com detecção de renome o diff só mostraria o destino (replica/); a origem em web/ tem de contar."""
    merge_de_pr(repo, lambda r: git(r, "mv", "web/a.ts", "replica/a.ts"))
    assert decide(repo, "pull_request") == "true"


def test_pr_mista_roda(repo):
    def mudanca(r):
        grava(r, "replica/outro.md")
        grava(r, "web/b.ts")

    merge_de_pr(repo, mudanca)
    assert decide(repo, "pull_request") == "true"


def test_pr_sem_commit_de_merge_roda(repo):
    """HEAD sem segundo pai: não há como saber a base, então roda."""
    grava(repo, "replica/outro.md")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "só docs")
    assert decide(repo, "pull_request") == "true"


def test_push_compara_com_o_commit_anterior(repo):
    antes = git(repo, "rev-parse", "HEAD")
    grava(repo, "replica/outro.md")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "docs")
    assert decide(repo, "push", antes) == "false"
    grava(repo, "web/b.ts")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "web")
    assert decide(repo, "push", antes) == "true"  # push de dois commits: o diff cobre os dois


@pytest.mark.parametrize("antes", ["", NULO, "abc", "f" * 40, "HEAD; echo false"])
def test_push_sem_base_utilizavel_roda(repo, antes):
    assert decide(repo, "push", antes) == "true"


@pytest.mark.parametrize("args", [(), ("workflow_dispatch",), ("schedule", NULO)])
def test_evento_desconhecido_roda(repo, args):
    assert decide(repo, *args) == "true"


def test_fora_de_repositorio_git_roda(tmp_path):
    assert decide(tmp_path, "pull_request") == "true"
    assert decide(tmp_path, "push", "a" * 40) == "true"
