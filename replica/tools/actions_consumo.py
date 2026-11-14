#!/usr/bin/env python3
"""Mede o consumo de minutos do GitHub Actions por workflow, a partir da lista de runs (S3-4 da revisão final de 14/11/2026).

A D313 e a revisão final estimaram o consumo por aritmética sobre os crons (4.000 a 8.000 min/mês). Isto troca a conta
pela medida, sem o escopo `user` do `gh`: a duração de cada run é dado do repositório. Só o total cobrado na conta
(Settings > Billing) pede aquele escopo, e segue sendo a conferência final do dono.

Uso (da raiz do repositório). Uma chamada por workflow, porque a lista corta em 1.000 runs:

    for w in etl.yml etl-pauta.yml etl-rascunho.yml ci.yml vigia.yml verificacao-eval.yml; do
      gh run list --workflow "$w" --limit 1000 --created ">=2026-10-15" \
        --json workflowName,event,createdAt,startedAt,updatedAt,conclusion,status,attempt,databaseId
    done > runs.json

    # detalhe por job, para os workflows em que o relógio do run engana (fila do `concurrency`, jobs paralelos):
    for w in etl.yml ci.yml; do
      gh run list --workflow "$w" --limit 1000 --created ">=2026-10-15" --json databaseId -q '.[].databaseId'
    done | while read -r id; do gh run view "$id" --json databaseId,jobs </dev/null; done > jobs.json

    python3 -I replica/tools/actions_consumo.py runs.json jobs.json --desde 2026-10-15

Entrada: valores JSON concatenados (stdin ou arquivos). Array = lista de runs (`gh run list`); objeto com `jobs` =
detalhe de um run (`gh run view`). O detalhe só conta para run que também está numa lista.
Saída: tabela por workflow e veredito contra as franquias de 2.000 (Free) e 3.000 (Pro) min/mês. Exit 0 sempre que a
entrada for válida; 2 se a entrada for inválida ou vazia.

Como a conta é feita, e onde ela erra:
- O GitHub cobra por JOB, arredondando cada job para cima ao minuto. Run COM detalhe: soma dos jobs, cada um
  arredondado (job pulado ou que não começou = 0). É a medida; coluna "jobs" da tabela.
- Run SEM detalhe: relógio do run (startedAt a updatedAt) arredondado para cima. É ESTIMATIVA, não piso nem teto:
  conta como minuto a espera na fila (o `concurrency` do etl segura um disparo atrás do run noturno, que dura horas)
  e não separa jobs paralelos. Com N jobs (lido de `.github/workflows/*.yml`) a tabela mostra a faixa relógio a
  N x relógio; workflow fora desse mapa tem N desconhecido.
- O veredito só é afirmado ("ACIMA", "dentro") quando todo run contado tem detalhe por job. Com algum run pelo
  relógio ele sai como "pela estimativa"; com N desconhecido ou lista cortada, "INDETERMINADO".
- Run reexecutado (attempt > 1): só a última tentativa é contada; a tabela diz quantos são.
- Run `skipped` (o `if:` do job deu falso) e run ainda em andamento não contam minuto.
- Lista com exatamente 1.000 runs de um workflow provavelmente foi cortada: a tabela avisa.
- Workflow de `.github/workflows` sem nenhum run na janela é listado como AUSENTE e o veredito vira INDETERMINADO:
  pode ser workflow parado, ou uma chamada esquecida no laço acima. Se for parado mesmo, o total vale como está.
- A projeção divide pela janela inteira. Workflow criado ou com cron alterado no meio dela sai diluído: a tabela
  mostra o primeiro e o último dia com run de cada um; para o ritmo atual, rode de novo com `--desde` recente.
- Runner Linux, multiplicador 1. Repositório público não paga; este é privado (D274, D313).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

FRANQUIAS = (("Free", 2000), ("Pro", 3000))
LIMITE_LISTA = 1000
CAMPOS = ("workflowName", "createdAt", "startedAt", "updatedAt", "conclusion", "status")
WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


class EntradaInvalida(ValueError):
    pass


def ler_entrada(texto: str) -> tuple[list[list[dict]], dict]:
    """Valores JSON concatenados: arrays de runs (`gh run list`) e objetos com `jobs` (`gh run view`), em qualquer ordem."""
    dec, pos, arrays, detalhes = json.JSONDecoder(), 0, [], {}
    while True:
        while pos < len(texto) and texto[pos].isspace():
            pos += 1
        if pos >= len(texto):
            break
        try:
            valor, pos = dec.raw_decode(texto, pos)
        except json.JSONDecodeError as e:
            raise EntradaInvalida(f"JSON inválido na posição {e.pos}: {e.msg}") from e
        if isinstance(valor, dict):
            if not isinstance(valor.get("jobs"), list) or "databaseId" not in valor or any(not isinstance(j, dict) for j in valor["jobs"]):
                raise EntradaInvalida("objeto sem `databaseId` e `jobs`: esperado a saída de `gh run view <id> --json databaseId,jobs`")
            detalhes[valor["databaseId"]] = valor["jobs"]
        elif isinstance(valor, list) and all(isinstance(r, dict) for r in valor):
            arrays.append(valor)
        else:
            raise EntradaInvalida("esperado um array de runs (`gh run list --json ...`) ou o detalhe de um run (`gh run view --json databaseId,jobs`)")
    if not any(arrays):
        raise EntradaInvalida("nenhum run na entrada (o detalhe por job sozinho não basta: falta a lista de runs)")
    for r in (r for a in arrays for r in a):
        falta = [c for c in CAMPOS if c not in r]
        if falta:
            raise EntradaInvalida(f"run {r.get('databaseId', '?')} sem os campos {', '.join(falta)}: confira o --json do comando")
    return arrays, detalhes


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def _minutos(inicio, fim, quem: str) -> int:
    try:
        i, f = _ts(inicio), _ts(fim)
    except (TypeError, ValueError, AttributeError) as e:
        raise EntradaInvalida(f"{quem}: data ilegível ({e})") from e
    # o `gh` devolve 0001-01-01 para o que não começou ou não terminou
    if i.year < 2000 or f.year < 2000:
        return 0
    seg = (f - i).total_seconds()
    return math.ceil(seg / 60) if seg > 0 else 0


def minutos_do_run(r: dict) -> int:
    """Relógio do run arredondado para cima ao minuto; 0 para o que não gasta (pulado, em andamento, sem início)."""
    if r.get("status") != "completed" or r.get("conclusion") == "skipped":
        return 0
    return _minutos(r.get("startedAt"), r.get("updatedAt"), f"run {r.get('databaseId', '?')}")


def minutos_dos_jobs(jobs: list[dict], run_id="?") -> int:
    """Como o GitHub cobra: cada job arredondado para cima ao minuto. Job pulado, sem início ou sem fim = 0."""
    total = 0
    for j in jobs:
        if j.get("conclusion") == "skipped" or not j.get("startedAt") or not j.get("completedAt"):
            continue
        total += _minutos(j["startedAt"], j["completedAt"], f"run {run_id}, job {j.get('name', '?')}")
    return total


def jobs_por_workflow(pasta: Path = WORKFLOWS) -> dict[str, int]:
    """`name:` do workflow -> número de jobs, lido do YAML sem biblioteca (chaves com 2 espaços sob `jobs:`)."""
    out: dict[str, int] = {}
    for f in sorted(pasta.glob("*.yml")):
        nome, dentro, n = None, False, 0
        for linha in f.read_text(encoding="utf-8").splitlines():
            if nome is None and (m := re.match(r"^name:\s*(.+?)\s*$", linha)):
                nome = m.group(1).strip("\"'")
            elif re.match(r"^jobs:\s*(#.*)?$", linha):
                dentro = True
            elif dentro and re.match(r"^\S", linha):
                dentro = False
            elif dentro and re.match(r"^  [A-Za-z0-9_-]+:\s*(#.*)?$", linha):
                n += 1
        if nome and n:
            out[nome] = n
    return out


def medir(arrays: list[list[dict]], desde: date, ate: date, jobs: dict[str, int], detalhes: dict | None = None) -> dict:
    """Soma por workflow dentro de [desde, ate] (datas UTC de criação do run) e projeta para 30 dias.

    `min`/`max` por workflow: iguais quando todo run tem detalhe por job. Run pelo relógio entra com relógio em `min`
    e N x relógio em `max`; com N desconhecido, `max` é None.
    """
    if ate < desde:
        raise EntradaInvalida("--ate anterior a --desde")
    detalhes = detalhes or {}
    dias = (ate - desde).days + 1
    cortados = {a[0]["workflowName"] or "?" for a in arrays if len(a) >= LIMITE_LISTA}
    vistos: set = set()
    linhas: dict[str, dict] = defaultdict(lambda: {"runs": 0, "cobrados": 0, "reexecutados": 0, "exato": 0, "relogio": 0, "runs_relogio": 0, "por_evento": defaultdict(int)})
    for r in (r for a in arrays for r in a):
        chave = r.get("databaseId", id(r))
        if chave in vistos:
            continue
        vistos.add(chave)
        try:
            criado = _ts(r["createdAt"]).date()
        except (TypeError, ValueError, AttributeError) as e:
            raise EntradaInvalida(f"run {r.get('databaseId', '?')}: createdAt ilegível ({e})") from e
        if not desde <= criado <= ate:
            continue
        w = linhas[r["workflowName"] or "?"]
        w["primeiro"], w["ultimo"] = min(w.get("primeiro", criado), criado), max(w.get("ultimo", criado), criado)
        if chave in detalhes:
            m = minutos_dos_jobs(detalhes[chave], chave)
            w["exato"] += m
        else:
            m = minutos_do_run(r)
            w["relogio"] += m
            w["runs_relogio"] += 1 if m else 0
        w["runs"] += 1
        w["cobrados"] += 1 if m else 0
        w["reexecutados"] += 1 if (r.get("attempt") or 1) > 1 else 0
        w["por_evento"][r.get("event") or "?"] += m
    fator = 30 / dias
    tabela = []
    for nome, w in linhas.items():
        n = jobs.get(nome)  # None = workflow fora do mapa: não se supõe 1 job
        mn = w["exato"] + w["relogio"]
        mx = mn if not w["relogio"] else (w["exato"] + w["relogio"] * n if n else None)
        tabela.append({
            "workflow": nome, "jobs": n, "runs": w["runs"], "cobrados": w["cobrados"], "reexecutados": w["reexecutados"],
            "runs_relogio": w["runs_relogio"], "min": mn, "max": mx, "min_30d": round(mn * fator), "max_30d": None if mx is None else round(mx * fator),
            "cortado": nome in cortados, "por_evento": dict(w["por_evento"]),
            "primeiro": w["primeiro"].isoformat(), "ultimo": w["ultimo"].isoformat(),
        })
    tabela.sort(key=lambda t: (-(t["max_30d"] if t["max_30d"] is not None else t["min_30d"]), t["workflow"]))
    desconhecido = any(t["max_30d"] is None for t in tabela)
    return {
        "desde": desde.isoformat(), "ate": ate.isoformat(), "dias": dias, "workflows": tabela,
        "min_30d": sum(t["min_30d"] for t in tabela), "max_30d": None if desconhecido else sum(t["max_30d"] for t in tabela),
        "runs_relogio": sum(t["runs_relogio"] for t in tabela), "algum_cortado": any(t["cortado"] for t in tabela),
        "ausentes": sorted(set(jobs) - set(linhas)),
    }


def veredito(total: dict) -> list[str]:
    out = []
    mn, mx, relogio = total["min_30d"], total["max_30d"], total["runs_relogio"]
    for nome, franquia in FRANQUIAS:
        if total["algum_cortado"]:
            estado = "INDETERMINADO (lista cortada em 1.000 runs: o consumo real é maior que o mostrado)"
        elif total.get("ausentes"):
            estado = "INDETERMINADO (workflow do repositório sem run na entrada: " + ", ".join(total["ausentes"]) + ")"
        elif mx is None:
            estado = "INDETERMINADO (workflow com número de jobs desconhecido: traga o detalhe por job)"
        elif not relogio:
            estado = "ACIMA" if mn > franquia else "dentro"
        elif mn > franquia:
            estado = f"ACIMA pela estimativa ({relogio} runs pelo relógio, que conta fila como minuto)"
        elif mx <= franquia:
            estado = f"dentro pela estimativa ({relogio} runs pelo relógio)"
        else:
            estado = f"INDETERMINADO ({relogio} runs pelo relógio: a faixa atravessa a franquia; traga o detalhe por job)"
        out.append(f"franquia {nome} ({franquia} min/mês): {estado}")
    return out


def _faixa(a: int, b: int | None) -> str:
    return f"{a}-?" if b is None else (f"{a}" if a == b else f"{a}-{b}")


def relatorio(total: dict) -> str:
    L = [f"Janela: {total['desde']} a {total['ate']} ({total['dias']} dias, UTC). Projeção = janela x 30/{total['dias']}.", ""]
    L.append(f"{'workflow':<28}{'jobs':>5}{'runs':>7}{'cobr.':>7}{'relógio':>9}{'min janela':>14}{'min/30 d':>14}  eventos (min)")
    for t in total["workflows"]:
        ev = ", ".join(f"{k} {v}" for k, v in sorted(t["por_evento"].items(), key=lambda kv: -kv[1]))
        marca = " [LISTA CORTADA]" if t["cortado"] else ""
        marca += f" [{t['reexecutados']} reexecutados]" if t["reexecutados"] else ""
        L.append(f"{t['workflow']:<28}{t['jobs'] or '?':>5}{t['runs']:>7}{t['cobrados']:>7}{t['runs_relogio']:>9}{_faixa(t['min'], t['max']):>14}{_faixa(t['min_30d'], t['max_30d']):>14}  {ev}{marca} · runs de {t['primeiro']} a {t['ultimo']}")
    for nome in total.get("ausentes", []):
        L.append(f"{nome:<28}  AUSENTE: nenhum run na janela (workflow parado, ou chamada esquecida na coleta)")
    L += ["", f"TOTAL projetado para 30 dias: {_faixa(total['min_30d'], total['max_30d'])} min"]
    if total["runs_relogio"]:
        L.append(f"  {total['runs_relogio']} runs medidos pelo relógio (coluna \"relógio\"): estimativa, inclui fila e não separa jobs paralelos.")
    L += veredito(total)
    L.append("Não medido aqui: tentativas anteriores de runs reexecutados e o total cobrado na conta (Settings > Billing).")
    return "\n".join(L)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Consumo de minutos do GitHub Actions por workflow, medido da lista de runs.")
    ap.add_argument("arquivos", nargs="*", help="saídas do `gh run list --json` e do `gh run view --json databaseId,jobs`; sem nenhum, lê o stdin")
    ap.add_argument("--desde", type=date.fromisoformat, help="primeiro dia da janela (UTC, AAAA-MM-DD); padrão: o run mais antigo")
    ap.add_argument("--ate", type=date.fromisoformat, help="último dia da janela (UTC); padrão: ontem, ou o run mais novo se for anterior")
    ap.add_argument("--workflows", type=Path, default=WORKFLOWS, help="pasta dos workflows, de onde sai o número de jobs")
    ap.add_argument("--json", action="store_true", help="saída em JSON")
    a = ap.parse_args(argv)
    try:
        texto = "\n".join(Path(f).read_text(encoding="utf-8") for f in a.arquivos) if a.arquivos else sys.stdin.read()
        arrays, detalhes = ler_entrada(texto)
        dias = [_ts(r["createdAt"]).date() for arr in arrays for r in arr]
        # padrão do fim: ontem, para não projetar um dia pela metade; se a lista acaba antes, o último dia dela
        ate = a.ate or min(max(dias), datetime.now(timezone.utc).date() - timedelta(days=1))
        total = medir(arrays, a.desde or min(dias), ate, jobs_por_workflow(a.workflows), detalhes)
    except (EntradaInvalida, OSError, TypeError, ValueError, AttributeError) as e:
        print(f"actions_consumo: {e}", file=sys.stderr)
        return 2
    print(json.dumps(total, ensure_ascii=False, indent=2) if a.json else relatorio(total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
