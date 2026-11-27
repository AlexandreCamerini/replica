"""R-4: todo comando e toda tarefa citados nos orquestradores continuam existindo.

Orquestradores = .github/workflows/*.yml, etl/deploy/*.sh, etl/agenda/*.sh. O teste extrai os nomes desses arquivos
(`civico-etl X`, `civico_etl.cli X`, nomes em ETL_TASKS_INCLUDE/ETL_TASKS_EXCLUDE e `--only X`), descarta texto de log e
comentário e confere contra a CLI real (comandos extraídos do código por AST) e contra schedule.TASKS. NÃO confere contra o
catálogo de coletores: rascunho, revisar, seed, check e run-due são comandos legítimos fora dele.
Estático: sem banco, sem rede, não executa nenhum script.
"""

from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path

from civico_etl import schedule

ETL = Path(__file__).resolve().parents[1]
REPO = ETL.parent
PKG = ETL / "civico_etl"

# Citações que não dá para resolver estaticamente. Uma citação nova desse tipo derruba test_nao_resolvidos_sao_exatamente_os_conhecidos.
NAO_RESOLVIDOS = [
    (".github/workflows/etl.yml", 58, "--only", "$ONLY", "valor vem de inputs.only (texto livre do workflow_dispatch); o schedule.TASKS valida em tempo de execução"),
]


# ---------------------------------------------------------------- comandos da CLI (AST)

def _modulo(path: Path) -> str:
    return ".".join(("civico_etl", *path.relative_to(PKG).with_suffix("").parts))


def _is_job_add_argument(n: ast.AST) -> bool:
    return (
        isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "add_argument"
        and bool(n.args)
        and isinstance(n.args[0], ast.Constant)
        and n.args[0].value == "job"
    )


def comandos_da_cli() -> set[str]:
    """Todos os nomes que a CLI aceita: `choices=` de cada add_argument("job") do pacote + comandos tratados fora do argparse em cli.py."""
    nomes: set[str] = set()
    for py in sorted(PKG.rglob("*.py")):
        tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
        for n in ast.walk(tree):
            if not _is_job_add_argument(n):
                continue
            kw = next((k.value for k in n.keywords if k.arg == "choices"), None)
            if kw is None:
                continue
            try:
                valores = ast.literal_eval(kw)
            except (ValueError, SyntaxError):
                # não literal (ex.: compreensão sobre ADAPTERS): avalia no namespace do módulo
                mod = importlib.import_module(_modulo(py))
                valores = eval(compile(ast.Expression(kw), str(py), "eval"), vars(mod))  # noqa: S307
            nomes.update(str(v) for v in valores)
    # comandos tratados antes do argparse em cli.py: `args[0] == "purge-raw"`
    cli = ast.parse((PKG / "cli.py").read_text(encoding="utf-8"))
    for n in ast.walk(cli):
        if (
            isinstance(n, ast.Compare)
            and isinstance(n.left, ast.Subscript)
            and isinstance(n.left.value, ast.Name)
            and n.left.value.id == "args"
            and isinstance(n.left.slice, ast.Constant)
            and n.left.slice.value == 0
            and len(n.ops) == 1
            and isinstance(n.ops[0], ast.Eq)
            and isinstance(n.comparators[0], ast.Constant)
            and isinstance(n.comparators[0].value, str)
        ):
            nomes.add(n.comparators[0].value)
    return nomes


# ---------------------------------------------------------------- citações nos orquestradores

CONJUNTOS = {
    "workflows": sorted((REPO / ".github" / "workflows").glob("*.yml")),
    "deploy": sorted((ETL / "deploy").glob("*.sh")),
    "agenda": sorted((ETL / "agenda").glob("*.sh")),
}

# primeira palavra que marca a linha como texto de log/prompt (a linha inteira é descartada)
_LOG_WORDS = {"echo", "printf", "say", "die", "alert", "confirm", "log", "warn", "ok", "fail", "info"}
_YAML_TEXT_KEYS = re.compile(r"^\s*-?\s*(name|description|title|if)\s*:")
_RE_CMD = re.compile(r"(?:civico-etl|civico_etl\.cli)[ \t]+(\S+)")
_RE_ONLY = re.compile(r"(?<![\w-])--only[ \t]+(\S+)")
_RE_TASKS = re.compile(r"\bETL_TASKS_(INCLUDE|EXCLUDE)[ \t]*[:=][ \t]*(\"[^\"]*\"|'[^']*'|[^\s\"'#;]*)")
_PUNCT = "\"';)`&|>\\,"


def _sem_comentario(linha: str) -> str:
    """Remove `# ...` fora de aspas ('#' só abre comentário no início da linha ou depois de espaço)."""
    q = None
    for i, ch in enumerate(linha):
        if q:
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
        elif ch == "#" and (i == 0 or linha[i - 1] in " \t"):
            return linha[:i]
    return linha


def _eh_log(linha: str) -> bool:
    if _YAML_TEXT_KEYS.match(linha):
        return True
    palavras = re.sub(r"^\s*(?:(?:if|then|elif|else|do|run:|-)\s+)*", "", linha).split(None, 1)
    return bool(palavras) and palavras[0] in _LOG_WORDS


def _limpa(tok: str) -> str:
    return tok.strip(_PUNCT)


def _varre():
    """Devolve (comandos, tarefas, nao_resolvidos): listas de (conjunto, 'arquivo:linha', nome) e (arquivo, linha, forma, valor)."""
    cmds, tasks, nres = [], [], []
    for conj, arquivos in CONJUNTOS.items():
        for f in arquivos:
            rel = f.relative_to(REPO).as_posix()
            for no, bruta in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                linha = _sem_comentario(bruta)
                if not linha.strip() or _eh_log(linha):
                    continue
                onde = f"{rel}:{no}"
                for m in _RE_CMD.finditer(linha):
                    tok = _limpa(m.group(1))
                    if tok.startswith("$") or "${{" in m.group(1):
                        nres.append((rel, no, "comando", tok))
                    elif re.fullmatch(r"[A-Za-z][\w.\-]*", tok):
                        cmds.append((conj, onde, tok))
                for m in _RE_ONLY.finditer(linha):
                    tok = _limpa(m.group(1))
                    if tok.startswith("$") or "${{" in m.group(1):
                        nres.append((rel, no, "--only", tok))
                    else:
                        tasks.append((conj, onde, tok))
                for m in _RE_TASKS.finditer(linha):
                    val = m.group(2).strip("\"'")
                    for nome in filter(None, (p.strip() for p in val.split(","))):
                        if nome.startswith("$") or "${{" in nome:
                            nres.append((rel, no, f"ETL_TASKS_{m.group(1)}", nome))
                        else:
                            tasks.append((conj, onde, nome))
    return cmds, tasks, nres


def citados():
    """(comandos, tarefas, nao_resolvidos) citados nos orquestradores, cada item com arquivo:linha."""
    return _varre()


# ---------------------------------------------------------------- testes

def test_comandos_obrigatorios_fora_do_catalogo_existem():
    cli = comandos_da_cli()
    for nome in ("rascunho", "revisar", "seed", "check", "run-due"):
        assert nome in cli, f"{nome} sumiu da CLI"


def test_comandos_da_cli_tem_tamanho_esperado():
    cli = comandos_da_cli()
    assert len(cli) == 49, f"{len(cli)} comandos na CLI: {sorted(cli)}"
    assert {"purge-raw", "run-due", "ale.sp", "ale.todas", "sapl.ales", "sancoes.cgu", "transparencia.ping"} <= cli


def test_varredura_nao_esta_vazia():
    cmds, tasks, _ = citados()
    for conj in CONJUNTOS:
        assert CONJUNTOS[conj], f"nenhum arquivo em {conj}"
        assert any(c[0] == conj for c in cmds), f"nenhum comando achado em {conj}: a varredura quebrou"
    # tarefas só existem em workflows (ETL_TASKS_EXCLUDE) e deploy (ETL_TASKS_INCLUDE); a agenda local não cita nenhuma
    assert any(t[0] == "workflows" for t in tasks), "nenhuma tarefa achada em workflows"
    assert any(t[0] == "deploy" for t in tasks), "nenhuma tarefa achada em deploy"


def test_todo_comando_citado_existe_na_cli():
    cmds, _, _ = citados()
    cli = comandos_da_cli()
    orfaos = [f"{onde}: comando '{n}' não existe na CLI" for _, onde, n in cmds if n not in cli]
    assert not orfaos, "\n" + "\n".join(orfaos)


def test_toda_tarefa_citada_existe_em_tasks():
    _, tasks, _ = citados()
    existentes = {t.name for t in schedule.TASKS}
    orfaos = [f"{onde}: tarefa '{n}' não existe em schedule.TASKS" for _, onde, n in tasks if n not in existentes]
    assert not orfaos, "\n" + "\n".join(orfaos)


def test_nao_resolvidos_sao_exatamente_os_conhecidos():
    _, _, nres = citados()
    achados = sorted(nres)
    esperados = sorted((a, l, f, v) for a, l, f, v, _motivo in NAO_RESOLVIDOS)
    assert achados == esperados, f"citações não resolvidas mudaram.\nachadas:   {achados}\nesperadas: {esperados}"
