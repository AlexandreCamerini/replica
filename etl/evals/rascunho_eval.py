"""Avaliação do rascunho (D13: 30 propostas conferidas por pessoa). Mede o prompt, não o site.

  uv run python -m evals.rascunho_eval semear --n 30          # escreve evals/rascunho_casos.jsonl com propostas da pauta, sem rótulo
  (uma pessoa preenche "rotulos" em cada linha: para cada campo, diz true/false; opcional "deve_citar": trecho esperado)
  uv run python -m evals.rascunho_eval rodar --confirmo-custo # chama a API uma vez por caso rotulado e grava o relatório

Métricas (todas por campo com diz=true no rascunho, salvo onde dito):
  trecho_achado      o trecho existe no PDF                        barra: 100% (abaixo disso, o prompt inventa citação)
  sem_bloqueio       nenhum aviso bloqueante                       barra: >= 90%
  acordo_diz         rascunho e rótulo concordam sobre diz/não diz barra: >= 85%, sobre todos os campos rotulados
  falso_diz          rascunho diz, rótulo diz "não diz"            barra: <= 5% (o erro mais caro: afirmação sem apoio)
  cita_esperado      quando há deve_citar, o trecho o contém       informativo
Custo: impresso no fim, com os tokens de cada caso. Rodar custa dinheiro; por isso --confirmo-custo.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import anthropic

from civico_etl import db, drafting
from civico_etl.http import fetch, fetch_json
from civico_etl.jobs.rascunho import CAMARA, DraftError, _pages, draft

HERE = Path(__file__).parent
CASES = HERE / "rascunho_casos.jsonl"
PRICE = {"claude-sonnet-5-5": (2.0, 10.0), "claude-opus-5-5": (4.0, 20.0), "claude-haiku-5-5": (0.10, 0.50)}  # US$ por milhão


def semear(n: int) -> None:
    """Propostas da Câmara que já passaram na Regra 1 em qualquer leitura, mais recentes primeiro. Não sobrescreve rótulos."""
    have = {json.loads(l)["chave"]: json.loads(l) for l in CASES.read_text().splitlines() if l.strip()} if CASES.exists() else {}
    conn = db.connect()
    rows = conn.execute(
        """with rule as (select * from pocket_rules order by version desc limit 1)
           select distinct on (i.prop_type, i.prop_number, i.prop_year) i.prop_type, i.prop_number, i.prop_year, i.proposal_url
           from pauta_items i join legislative_bodies b on b.id = i.body_id cross join rule r
           where b.kind = 'camara_deputados'
             and f_unaccent(lower(coalesce(i.summary_official, ''))) ~ r.term_pattern
             and exists (select 1 from topics t, unnest(i.official_themes) th where t.slug = any (r.topic_slugs) and th = any (t.keywords))
           order by i.prop_type, i.prop_number, i.prop_year, i.created_at desc"""
    ).fetchall()
    conn.close()
    for r in rows:
        if len(have) >= n:
            break
        k = f"camara-{r['prop_type'].lower()}-{r['prop_number']}-{r['prop_year']}"
        if k in have:
            continue
        if r["proposal_url"]:
            cid = int(r["proposal_url"].split("idProposicao=")[1])
        else:  # leituras anteriores à 0008 não guardavam o link: busca o id pela sigla, número e ano
            found = fetch_json(f"{CAMARA}/proposicoes?siglaTipo={r['prop_type']}&numero={r['prop_number']}&ano={r['prop_year']}", max_age=7 * 86400)["dados"]
            if not found:
                continue
            cid = int(found[0]["id"])
        have[k] = {"chave": k, "camara_id": cid, "rotulos": {}}
    CASES.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in have.values()))
    print(f"{len(have)} casos em {CASES}. Rotulados: {sum(1 for c in have.values() if c['rotulos'])}.")


def rodar(model: str) -> int:
    cases = [json.loads(l) for l in CASES.read_text().splitlines() if l.strip()] if CASES.exists() else []
    cases = [c for c in cases if c.get("rotulos")]
    if not cases:
        print("Nenhum caso rotulado. Rode `semear` e preencha 'rotulos'.")
        return 1
    client = anthropic.Anthropic()
    out, tin, tout = [], 0, 0
    for c in cases:
        try:
            d = fetch_json(f"{CAMARA}/proposicoes/{c['camara_id']}", max_age=86400)["dados"]
            pages = _pages(fetch(d["urlInteiroTeor"], max_age=86400, accept="application/pdf").path.read_bytes())
            ans, (i, o) = draft(client, model, c["chave"], d.get("ementa"), pages)
        except (DraftError, KeyError, FileNotFoundError) as x:
            out.append({"chave": c["chave"], "erro": str(x)})
            continue
        tin, tout = tin + i, tout + o
        ans, checks = drafting.validate(ans, pages)
        out.append({"chave": c["chave"], "respostas": ans, "avisos": checks, "rotulos": c["rotulos"]})
    rep = score(out)
    pin, pout = PRICE.get(model, (0, 0))
    rep["custo_usd"] = round(tin / 1e6 * pin + tout / 1e6 * pout, 4)
    rep["modelo"], rep["prompt_version"] = model, drafting.PROMPT_VERSION
    (HERE / f"rascunho_resultado_v{drafting.PROMPT_VERSION}.json").write_text(json.dumps({"resumo": rep, "casos": out}, ensure_ascii=False, indent=2))
    print(json.dumps(rep, ensure_ascii=False, indent=2))
    return 0 if rep["passou"] else 1


def score(out: list[dict]) -> dict:
    said = found = clean = agree = labeled = false_said = expected = cited = 0
    for c in out:
        if "erro" in c:
            continue
        for f in drafting.FIELDS:
            a, chk, lab = c["respostas"][f], c["avisos"].get(f, []), c["rotulos"].get(f)
            if a["diz"]:
                said += 1
                found += "trecho_nao_encontrado" not in chk
                clean += not any(i.split(":")[0] in drafting.BLOCKING for i in chk)
            if lab is not None:
                labeled += 1
                agree += a["diz"] == lab.get("diz")
                false_said += a["diz"] and not lab.get("diz")
                if lab.get("deve_citar"):
                    expected += 1
                    cited += lab["deve_citar"].lower() in a["trecho"].lower()
    pct = lambda a, b: round(100 * a / b, 1) if b else None  # noqa: E731
    rep = {
        "casos": len(out),
        "erros": sum(1 for c in out if "erro" in c),
        "trecho_achado": pct(found, said),
        "sem_bloqueio": pct(clean, said),
        "acordo_diz": pct(agree, labeled),
        "falso_diz": pct(false_said, labeled),
        "cita_esperado": pct(cited, expected),
    }
    rep["passou"] = bool(
        said and labeled and rep["trecho_achado"] == 100 and rep["sem_bloqueio"] >= 90 and rep["acordo_diz"] >= 85 and rep["falso_diz"] <= 5
    )
    return rep


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("semear").add_argument("--n", type=int, default=30)
    r = s.add_parser("rodar")
    r.add_argument("--confirmo-custo", action="store_true")
    r.add_argument("--model", default=os.environ.get("RASCUNHO_MODEL", drafting.DEFAULT_MODEL))
    a = p.parse_args()
    if a.cmd == "semear":
        semear(a.n)
        return 0
    if not a.confirmo_custo:
        print("Rodar chama a API uma vez por caso rotulado e custa dinheiro. Repita com --confirmo-custo.")
        return 2
    return rodar(a.model)


if __name__ == "__main__":
    sys.exit(main())
