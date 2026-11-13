"""Monta o conjunto de referência da avaliação da verificação agêntica (§10 de replica/verificacao-agentica.md).

  uv run python -m evals.verificacao_construir checar [--pdfs DIR] [--bases ARQ]   # confere as bases, não grava nada
  uv run python -m evals.verificacao_construir montar [--pdfs DIR]                 # grava armadilhas.jsonl, injecao.jsonl e divisao.json

Entradas (versionadas em evals/verificacao/):
  fontes.jsonl  uma proposição real da Câmara por linha: camara_id, chave, url do inteiro teor, sha256, páginas, caracteres.
                O PDF NÃO é guardado: o harness baixa pela URL e confere o sha256 (fonte mudou = caso não medido).
  bases.jsonl   para cada proposição usada em armadilha: um rascunho-base CORRETO (escrito por agente, campo a campo, com o trecho
                oficial ao lado) e as "plantas": o texto de cada defeito a plantar. Formato no fim deste docstring.

Saídas (versionadas):
  armadilhas.jsonl  um caso por defeito plantado (um defeito por caso) + um caso-controle por base (rascunho-base sem defeito).
                    Rótulo por campo, `rotulado_por: "construcao"` no campo plantado.
  injecao.jsonl     20 PDFs de injeção montados à mão (evals/verificacao_pdf.py) + 4 gêmeos limpos (controle).
  divisao.json      semente e a divisão AJUSTE x MEDIDA, por proposição (nunca por caso: o mesmo texto não pode estar dos dois lados).

Defeitos (rótulo do campo plantado):
  sem_sustentacao    frase afirma o que o trecho não diz (grupo, alcance, prazo, causa)              -> quem deve pegar: sustentação
  contradito         frase diz o contrário de um dispositivo do texto                                -> contraditor (e sustentação)
  condicionado       frase omite condição, prazo ou exceção que o texto impõe ao ponto              -> contraditor deve dizer "condiciona"
  direcao_errada     direção do dinheiro invertida (mecânico, a partir da base)                      -> sustentação (direcao_confere)
  nao_diz_falso      campo que o texto trata marcado como "não trata" (mecânico, a partir da base)  -> contraditor (trata=true)
  justificacao       trecho tirado da Justificação do autor                                         -> classificador em código
  lei_vigente        o_que_propoe redigido como se a proposta já fosse lei                          -> leitor leigo (ja_vale)
Rótulos dos campos não plantados: os da base ("correto" ou "nao_diz_correto"), escritos por agente: rótulo de autor, não de construção.

Formato de uma linha de bases.jsonl:
  {"camara_id": 123, "autor_rotulo": "agente", "rascunho": {<os seis campos no formato de drafting.SCHEMA>},
   "rotulos_base": {"<campo>": "correto" | "nao_diz_correto"},
   "plantas": {
     "sem_sustentacao": {"campo": "...", "frase": "...", "explicacao": "..."},           # mesmo trecho da base
     "contradito":      {"campo": "...", "frase": "...", "onde": "Art. N", "explicacao": "..."},
     "condicionado":    {"campo": "...", "frase": "...", "trecho": "...", "pagina": N, "condicao": "...", "onde": "Art. N"},
     "justificacao":    {"campo": "...", "frase": "...", "trecho": "...", "pagina": N},
     "lei_vigente":     {"campo": "o_que_propoe", "frase": "..."}}}
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import random
import sys
from pathlib import Path
from typing import Any

from pypdf import PdfReader

from civico_etl import drafting, verification as V

HERE = Path(__file__).parent / "verificacao"
SEMENTE = 20261111
PARTE_AJUSTE = 0.2  # 20% das proposições para ajuste; o resto é medida
DEFEITOS = ("sem_sustentacao", "contradito", "condicionado", "direcao_errada", "nao_diz_falso", "justificacao", "lei_vigente")
INVERTE = {"entra": "sai", "sai": "entra", "dividido": "entra"}


def ler(p: Path) -> list[dict[str, Any]]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def gravar(p: Path, linhas: list[dict[str, Any]]) -> None:
    p.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in linhas))


def paginas(pdf: bytes) -> list[str]:
    """A mesma extração do verificador (jobs/verificar._pages)."""
    return [(p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages]


def obter_pdf(fonte: dict[str, Any], pdfs: Path | None) -> bytes:
    """PDF local (pasta com <camara_id>.pdf) ou baixado pela URL oficial; o sha256 tem de bater com o registrado."""
    if pdfs is not None:
        b = (pdfs / f"{fonte['camara_id']}.pdf").read_bytes()
    else:
        from civico_etl.http import fetch
        b = fetch(fonte["url"], max_age=30 * 86400, accept="application/pdf").path.read_bytes()
    sha = hashlib.sha256(b).hexdigest()
    if sha != fonte["sha256"]:
        raise ValueError(f"{fonte['chave']}: o PDF mudou (sha {sha[:12]} != {fonte['sha256'][:12]})")
    return b


def divisao(ids: list[int]) -> dict[str, str]:
    """Proposição -> 'ajuste' | 'medida'. Determinística pela semente; registrada em divisao.json."""
    ordem = sorted(ids)
    random.Random(SEMENTE).shuffle(ordem)
    n = max(1, round(len(ordem) * PARTE_AJUSTE))
    return {str(i): ("ajuste" if k < n else "medida") for k, i in enumerate(ordem)}


# --- conferência ----------------------------------------------------------------------------------------------------

def problemas(answers: dict[str, Any], pages: list[str], *, planta: str | None = None, campo: str | None = None) -> list[str]:
    """O caso tem de passar no portão mecânico (senão mede-se a expressão regular, não os agentes) e cair no articulado,
    salvo o que o defeito pede de propósito."""
    out: list[str] = []
    errs = drafting.shape_errors(answers)
    if errs:
        return [f"formato: {e}" for e in errs]
    fixed, checks = drafting.validate(answers, pages)
    for f, v in drafting.blocking(checks, fixed).items():
        out.append(f"{f}: aviso bloqueante {v}")
    for f in V.said(fixed):
        cls = V.classify_quote(fixed[f]["trecho"], pages)
        want = "justificacao" if (planta == "justificacao" and f == campo) else "articulado"
        if cls != want:
            out.append(f"{f}: trecho classificado como {cls}, esperado {want}")
    if not fixed["o_que_propoe"]["diz"]:
        out.append("o_que_propoe precisa estar em diz")
    return out


def plantar(base: dict[str, Any], defeito: str) -> tuple[dict[str, Any], str, dict[str, Any]] | None:
    """(rascunho com o defeito, campo plantado, detalhes). None = a base não comporta este defeito."""
    ans = copy.deepcopy(base["rascunho"])
    p = (base.get("plantas") or {}).get(defeito)
    if defeito == "direcao_errada":
        d = ans["dinheiro"]
        if not d["diz"] or d.get("direcao") not in INVERTE:
            return None
        d["direcao"] = INVERTE[d["direcao"]]
        return ans, "dinheiro", {"direcao_certa": base["rascunho"]["dinheiro"]["direcao"], "direcao_plantada": d["direcao"]}
    if defeito == "nao_diz_falso":
        for f in ("quem_paga", "quem_recebe", "o_que_muda", "dinheiro", "estimativa_impacto"):
            if ans[f]["diz"] and base.get("rotulos_base", {}).get(f) == "correto":
                ans[f] = {"diz": False, "frase": "", "trecho": "", "pagina": 0, **({"direcao": "nao_diz"} if f == "dinheiro" else {})}
                return ans, f, {"trecho_que_trata": base["rascunho"][f]["trecho"]}
        return None
    if not p:
        return None
    f = p["campo"]
    a = dict(ans[f])
    a["diz"] = True
    a["frase"] = p["frase"]
    if defeito in ("condicionado", "justificacao"):
        a["trecho"], a["pagina"] = p["trecho"], p["pagina"]
    if f == "dinheiro" and a.get("direcao") not in ("entra", "sai", "dividido"):
        a["direcao"] = p.get("direcao", "sai")
    ans[f] = a
    return ans, f, {k: v for k, v in p.items() if k not in ("campo", "frase")}


def casos_de(base: dict[str, Any], fonte: dict[str, Any], pages: list[str], conjunto: str) -> tuple[list[dict[str, Any]], list[str]]:
    casos, erros = [], []
    rot = dict(base["rotulos_base"])
    pb = problemas(base["rascunho"], pages)
    if pb:
        return [], [f"{fonte['chave']} base: {x}" for x in pb]
    comum = {"conjunto": conjunto, "fonte": {k: fonte[k] for k in ("camara_id", "chave", "url", "sha256")}, "modelo_redator": drafting.DEFAULT_MODEL}
    casos.append({**comum, "id": f"arm-{fonte['camara_id']}-controle", "tipo": "controle", "defeito": None, "campo_plantado": None,
                  "rascunho": base["rascunho"], "rotulos": rot, "rotulado_por": {f: "autor_agente" for f in rot}})
    for d in DEFEITOS:
        r = plantar(base, d)
        if r is None:
            continue
        ans, campo, det = r
        pb = problemas(ans, pages, planta=d, campo=campo)
        if pb:
            erros += [f"{fonte['chave']} {d}: {x}" for x in pb]
            continue
        rotulos = {**rot, campo: d}
        casos.append({**comum, "id": f"arm-{fonte['camara_id']}-{d}", "tipo": "armadilha", "defeito": d, "campo_plantado": campo, "detalhe": det,
                      "rascunho": ans, "rotulos": rotulos, "rotulado_por": {f: ("construcao" if f == campo else "autor_agente") for f in rotulos}})
    return casos, erros


def checar(bases: list[dict[str, Any]], fontes: dict[int, dict[str, Any]], pdfs: Path | None) -> tuple[list[dict[str, Any]], list[str]]:
    div = divisao(list(fontes))
    todos, erros = [], []
    for b in bases:
        f = fontes.get(b["camara_id"])
        if not f:
            erros.append(f"{b['camara_id']}: fora de fontes.jsonl")
            continue
        try:
            pages = paginas(obter_pdf(f, pdfs))
        except (OSError, ValueError) as x:
            erros.append(f"{f['chave']}: {x}")
            continue
        c, e = casos_de(b, f, pages, div[str(f["camara_id"])])
        todos += c
        erros += e
    return todos, erros


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["checar", "montar"])
    ap.add_argument("--pdfs", type=Path, help="pasta com <camara_id>.pdf (sem ela, baixa pela URL oficial)")
    ap.add_argument("--bases", type=Path, default=HERE / "bases.jsonl")
    a = ap.parse_args()
    fontes = {f["camara_id"]: f for f in ler(HERE / "fontes.jsonl")}
    casos, erros = checar(ler(a.bases), fontes, a.pdfs)
    for e in erros:
        print("PROBLEMA", e)
    por = {}
    for c in casos:
        por[c["defeito"] or "controle"] = por.get(c["defeito"] or "controle", 0) + 1
    print(f"{len(casos)} casos válidos: {json.dumps(por, ensure_ascii=False)}; {len(erros)} problema(s)")
    if a.cmd == "montar":
        from evals import verificacao_pdf as P
        gravar(HERE / "armadilhas.jsonl", casos)
        inj = P.casos_injecao(divisao(list(fontes)))
        gravar(HERE / "injecao.jsonl", inj)
        div = divisao(list(fontes))
        (HERE / "divisao.json").write_text(json.dumps({"semente": SEMENTE, "parte_ajuste": PARTE_AJUSTE, "por_proposicao": div,
                                                       "regra": "divisão por proposição; nada do conjunto de medida foi usado para ajustar prompt "
                                                                "(nenhum prompt do verificador foi ajustado nesta rodada)"},
                                                      ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        print(f"gravado: {len(casos)} armadilhas/controles, {len(inj)} casos de injeção")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
