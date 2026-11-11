#!/usr/bin/env python3
"""Confere replica/fluxo-de-dados.md contra o repositório. Só stdlib, sem rede, sem banco.

Uso: python3 -I replica/tools/fluxo_confere.py
Sai com 1 e lista o que falta quando:
  - um job, workflow, script de deploy/agenda, módulo de lib/data, route handler, arquivo "use server"
    ou tool do MCP não aparece no documento;
  - uma tabela ou view viva ao fim das migrações não aparece entre crases na seção 4;
  - um caminho (ou caminho:linha) citado não existe;
  - um bloco mermaid está vazio, sem tipo ou com blocos desbalanceados;
  - falta uma das 10 seções.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "replica" / "fluxo-de-dados.md"
TOP = ("web/", "etl/", "db/", "mcp/", ".github/", "replica/", "design/")
MERMAID_TYPES = ("flowchart", "graph", "sequenceDiagram", "stateDiagram", "erDiagram", "classDiagram")
SEQ_OPENERS = ("loop", "alt", "opt", "par", "critical", "break", "rect", "box")


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def required_files() -> dict[str, list[str]]:
    web = ROOT / "web" / "src"
    use_server = []
    for p in sorted(web.rglob("*.ts*")):
        head = p.read_text(encoding="utf-8", errors="replace")[:400]
        if re.search(r"""^\s*["']use server["'];?\s*$""", head, re.M):
            use_server.append(rel(p))
    return {
        "job": [rel(p) for p in sorted((ROOT / "etl/civico_etl/jobs").glob("*.py")) if p.name != "__init__.py"],
        "workflow": [rel(p) for p in sorted((ROOT / ".github/workflows").glob("*.y*ml"))],
        "script": [rel(p) for d in ("etl/deploy", "etl/agenda") for p in sorted((ROOT / d).glob("*.sh"))],
        "lib/data": [rel(p) for p in sorted((web / "lib/data").glob("*.ts"))],
        "route": [rel(p) for p in sorted((web / "app").rglob("route.ts*"))],
        "use server": use_server,
    }


def mcp_tools() -> list[str]:
    names: list[str] = []
    for p in sorted((ROOT / "mcp/src").glob("*.ts")):
        names += re.findall(r"""registerTool\(\s*["']([\w-]+)["']""", p.read_text(encoding="utf-8"))
    return sorted(set(names))


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def live_relations() -> dict[str, str]:
    """Tabelas e views vivas ao fim de db/migrations, na ordem de nome do arquivo."""
    live: dict[str, str] = {}
    ident = r'(?:"?[\w]+"?\.)?"?([\w]+)"?'
    pat = re.compile(
        r"\bcreate\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:materialized\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?" + ident
        + r"|\bdrop\s+(?:materialized\s+)?(table|view)\s+(?:if\s+exists\s+)?" + ident
        + r"|\balter\s+(?:table|view)\s+(?:if\s+exists\s+)?" + ident + r"\s+rename\s+to\s+" + ident,
        re.I,
    )
    for f in sorted((ROOT / "db/migrations").glob("*.sql")):
        sql = strip_sql_comments(f.read_text(encoding="utf-8"))
        for m in pat.finditer(sql):
            if m.group(1):
                if re.search(r"\b(temp|temporary)\s+$", sql[max(0, m.start() - 12):m.start()] + " ", re.I):
                    continue
                live.setdefault(m.group(2).lower(), f.name)
            elif m.group(3):
                live.pop(m.group(4).lower(), None)
            else:
                old, new = m.group(5).lower(), m.group(6).lower()
                if old in live:
                    live[new] = live.pop(old)
    return live


def section(doc: str, n: int) -> str:
    m = re.search(rf"^## {n}\.[^\n]*\n(.*?)(?=^## \d+\.|\Z)", doc, re.M | re.S)
    return m.group(1) if m else ""


def check_paths(doc: str) -> list[str]:
    errs: list[str] = []
    seen: set[str] = set()
    cache: dict[str, int] = {}
    for tok in re.findall(r"`([^`\n]+)`", doc):
        tok = tok.strip()
        if not tok.startswith(TOP) or " " in tok or "*" in tok or "<" in tok or "{" in tok or "…" in tok:
            continue
        m = re.fullmatch(r"(.+?)(?::(\d+)(?:-(\d+))?)?", tok)
        path, a, b = m.group(1), m.group(2), m.group(3)
        if tok in seen:
            continue
        seen.add(tok)
        p = ROOT / path
        if not p.exists():
            errs.append(f"caminho inexistente: {tok}")
            continue
        if a and p.is_file():
            if path not in cache:
                cache[path] = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
            last = int(b or a)
            if int(a) < 1 or last > cache[path] or last < int(a):
                errs.append(f"linha fora do arquivo ({cache[path]} linhas): {tok}")
    return errs


def check_mermaid(doc: str) -> list[str]:
    errs: list[str] = []
    blocks = re.findall(r"^```mermaid[ \t]*\n(.*?)^```", doc, re.M | re.S)
    if not blocks:
        errs.append("nenhum bloco mermaid no documento")
    for i, body in enumerate(blocks, 1):
        lines = [ln.strip() for ln in body.splitlines() if ln.strip() and not ln.strip().startswith("%%")]
        if not lines:
            errs.append(f"mermaid #{i}: bloco vazio")
            continue
        if not lines[0].startswith(MERMAID_TYPES):
            errs.append(f"mermaid #{i}: primeira linha sem tipo de diagrama ({lines[0][:40]!r})")
            continue
        ends = sum(1 for ln in lines if ln == "end")
        if lines[0].startswith(("flowchart", "graph")):
            opens = sum(1 for ln in lines if re.match(r"subgraph\b", ln))
        elif lines[0].startswith("sequenceDiagram"):
            opens = sum(1 for ln in lines if re.match(rf"(?:{'|'.join(SEQ_OPENERS)})\b", ln))
            # em sequenceDiagram o ';' encerra o comando: mensagem com ';' quebra o parser
            errs += [f"mermaid #{i}: ';' em mensagem de sequenceDiagram ({ln[:50]!r})" for ln in lines if ";" in ln]
        else:
            opens, ends = body.count("{"), body.count("}")
        if opens != ends:
            errs.append(f"mermaid #{i} ({lines[0].split()[0]}): {opens} aberturas para {ends} fechamentos")
    return errs


def main() -> int:
    if not DOC.exists():
        print(f"FALHA: {rel(DOC)} não existe")
        return 1
    doc = DOC.read_text(encoding="utf-8")
    errs: list[str] = []
    counts: dict[str, int] = {}

    for n in range(1, 11):
        if not re.search(rf"^## {n}\. ", doc, re.M):
            errs.append(f"seção ausente: ## {n}.")

    req = required_files()
    for kind, files in req.items():
        counts[kind] = len(files)
        names = [Path(f).name for f in files]
        for f in files:
            name = Path(f).name
            unique = names.count(name) == 1 and kind not in ("route",)
            if f in doc or (unique and f"`{name}`" in doc):
                continue
            errs.append(f"{kind} não citado: {f}")

    tools = mcp_tools()
    counts["tool MCP"] = len(tools)
    if not tools:
        errs.append("nenhuma tool encontrada em mcp/src (registerTool): verificador cego para MCP")
    for t in tools:
        if f"`{t}`" not in doc:
            errs.append(f"tool MCP não citada entre crases: {t}")

    rels = live_relations()
    counts["tabela/view"] = len(rels)
    s4 = section(doc, 4)
    for name, mig in sorted(rels.items()):
        if f"`{name}`" not in s4:
            errs.append(f"tabela/view fora da seção 4: {name} (db/migrations/{mig})")

    path_errs = check_paths(doc)
    errs += path_errs
    errs += check_mermaid(doc)

    cited = len({t for t in re.findall(r"`([^`\n]+)`", doc) if t.startswith(TOP)})
    print("inventário: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    print(f"documento: {len(doc.splitlines())} linhas, {cited} caminhos distintos citados, "
          f"{len(re.findall(r'^```mermaid', doc, re.M))} diagramas")
    if errs:
        print(f"\nFALHA: {len(errs)} problema(s)")
        for e in errs:
            print("  - " + e)
        return 1
    print("\nOK: cobertura completa, caminhos válidos, diagramas balanceados, 10 seções.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
