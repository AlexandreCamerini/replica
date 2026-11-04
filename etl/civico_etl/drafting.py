"""Rascunho das respostas da página da proposta (Regra 3 do canvas "No seu bolso"). Puro: sem banco, sem rede.

Contrato: o modelo devolve, para cada pergunta, uma frase curta e o trecho literal do texto oficial que a sustenta,
com a página. Sem trecho, `diz` = false ("O texto não diz"). Tudo o que o modelo devolve passa por `validate`,
que nunca confia nele: confere o trecho contra o texto extraído do PDF, o tamanho da frase, os termos proibidos e
os números. O que falha vira um aviso para a pessoa que revisa; publicar com aviso bloqueante é recusado.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

PROMPT_VERSION = 2  # v2: contagem explícita de palavras (v1 passava de 15 em 5 de 5 frases do PL 79/2020)
DEFAULT_MODEL = "claude-sonnet-5-5"  # D13: Sonnet para o rascunho; a pessoa que revisa é a barra de qualidade

FIELDS = ("o_que_propoe", "quem_recebe", "quem_paga", "o_que_muda", "dinheiro", "estimativa_impacto")
QUESTIONS = {
    "o_que_propoe": "O que a proposta faz, em palavras de todo dia?",
    "quem_recebe": "Quem passa a receber algo (dinheiro, direito, isenção, serviço)?",
    "quem_paga": "Quem passa a pagar algo ou perde algo?",
    "o_que_muda": "O que muda para quem mora no Brasil?",
    "dinheiro": "O dinheiro público entra, sai ou é dividido? Entre quem?",
    "estimativa_impacto": "O texto traz estimativa oficial de impacto (valor, prazo, número de pessoas)?",
}
VERBS = ("cria", "extingue", "aumenta", "reduz", "muda", "permite", "proíbe", "adia", "transfere", "obriga")
# lista da Regra editorial (canvas, artboard C); a comparação ignora acento
FORBIDDEN = (
    "beneficia", "prejudica", "polêmica", "ataque", "conquista", "retrocesso", "avanço", "pode afetar você negativamente",
    "vitória", "derrota", "absurdo", "histórico", "finalmente", "pressione", "cobre", "fique de olho",
)
MAX_WORDS = 15
# avisos que impedem publicar enquanto o campo não for trocado por "O texto não diz"
BLOCKING = {"trecho_nao_encontrado", "termo_proibido", "numero_sem_trecho", "frase_vazia", "trecho_vazio", "frase_longa"}

_CLAIM = {
    "type": "object",
    "properties": {
        "diz": {"type": "boolean", "description": "false quando nenhum trecho do texto responde a pergunta"},
        "frase": {"type": "string", "description": "até 15 palavras, verbo factual; vazio quando diz=false"},
        "trecho": {"type": "string", "description": "cópia literal do texto oficial; vazio quando diz=false"},
        "pagina": {"type": "integer", "description": "página do PDF onde está o trecho; 0 quando diz=false"},
    },
    "required": ["diz", "frase", "trecho", "pagina"],
    "additionalProperties": False,
}
SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        **{f: _CLAIM for f in FIELDS if f != "dinheiro"},
        "dinheiro": {
            "type": "object",
            "properties": {**_CLAIM["properties"], "direcao": {"type": "string", "enum": ["entra", "sai", "dividido", "nao_diz"]}},
            "required": [*_CLAIM["required"], "direcao"],
            "additionalProperties": False,
        },
    },
    "required": list(FIELDS),
    "additionalProperties": False,
}

SYSTEM = f"""Você lê o texto oficial de uma proposta do Congresso e responde perguntas para qualquer pessoa, sem opinião.

Regras, sem exceção:
- Cada resposta tem uma frase de no máximo {MAX_WORDS} palavras, em português de todo dia, e o trecho literal do texto que a sustenta.
  Conte as palavras antes de responder. Frase com {MAX_WORDS + 1} palavras ou mais é recusada. Prefira dizer menos.
- Uma frase diz uma coisa só. Se o trecho cita vários destinos ou grupos, fale do principal e deixe o resto para o texto oficial.
- O trecho é cópia exata de uma passagem do texto, com a mesma grafia, e a página é a do marcador [página N] onde ele está.
- Use só estes verbos para dizer o que a proposta faz: {", ".join(VERBS)}.
- Número, valor, prazo ou percentual só entram na frase se estiverem escritos no trecho citado.
- Se nenhum trecho responde a pergunta, marque diz=false e deixe frase e trecho vazios. Isso é melhor que uma frase sem apoio.
- Nunca diga se a proposta é boa ou ruim, nem para quem. Não use: {", ".join(FORBIDDEN)}.
- Não explique siglas com palpite: se a sigla não está definida no texto, use o nome por extenso só se ele estiver no texto.
- Em "dinheiro", direcao é entra (o governo passa a arrecadar), sai (o governo passa a gastar ou deixar de arrecadar),
  dividido (o dinheiro é repartido entre entes ou fundos) ou nao_diz.
- "estimativa_impacto" só é diz=true se o texto trouxer uma estimativa oficial com número."""


def document_text(pages: list[str]) -> str:
    return "\n\n".join(f"[página {i}]\n{t.strip()}" for i, t in enumerate(pages, 1))


def user_message(label: str, summary: str | None, pages: list[str]) -> str:
    qs = "\n".join(f"- {f}: {q}" for f, q in QUESTIONS.items())
    return f"""<proposta>{label}</proposta>
<resumo_oficial>{summary or "não informado"}</resumo_oficial>
<texto_oficial>
{document_text(pages)}
</texto_oficial>

Responda, para esta proposta, a cada pergunta abaixo, seguindo as regras:
{qs}"""


def _norm(s: str) -> str:
    """Compara trecho e PDF sem tropeçar em quebra de linha, hífen de fim de linha, aspas tipográficas e espaços duplos."""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("­", "").replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'").replace("–", "-").replace("—", "-")
    s = re.sub(r"-\s*\n\s*", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def _fold(s: str) -> str:
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()


def _numbers(s: str) -> set[str]:
    return {re.sub(r"[.\s]", "", n) for n in re.findall(r"\d[\d.,]*\d|\d", s)}


def locate(quote: str, pages: list[str]) -> int | None:
    """Página (1..n) onde o trecho aparece; None se não aparece em lugar nenhum."""
    q = _norm(quote)
    if not q:
        return None
    for i, t in enumerate(pages, 1):
        if q in _norm(t):
            return i
    joined = _norm(" ".join(pages))  # trecho que atravessa a quebra de página
    return 0 if q in joined else None


def check_phrase(field: str, frase: str, trecho: str) -> list[str]:
    """O que se confere só com a frase e o trecho. Usado no rascunho e de novo quando o revisor edita a frase."""
    frase, issues = frase.strip(), []
    if not frase:
        issues.append("frase_vazia")
    if not trecho.strip():
        issues.append("trecho_vazio")
    words = len(frase.split())
    if words > MAX_WORDS:
        issues.append(f"frase_longa:{words}")
    ff = _fold(frase)
    if any(re.search(rf"\b{re.escape(_fold(t))}\b", ff) for t in FORBIDDEN):
        issues.append("termo_proibido")
    if field != "estimativa_impacto" and not any(re.search(rf"\b{_fold(v)}", ff) for v in VERBS):
        issues.append("sem_verbo_da_lista")
    if _numbers(frase) - _numbers(trecho):
        issues.append("numero_sem_trecho")
    return issues


def validate(answers: dict[str, Any], pages: list[str]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Corrige o que é mecânico (página errada) e aponta o resto. Devolve (respostas, avisos por campo)."""
    out: dict[str, Any] = {}
    checks: dict[str, list[str]] = {}
    for f in FIELDS:
        a = dict(answers.get(f) or {"diz": False, "frase": "", "trecho": "", "pagina": 0})
        issues: list[str] = []
        if a.get("diz"):
            trecho = (a.get("trecho") or "").strip()
            issues += check_phrase(f, a.get("frase") or "", trecho)
            if trecho:
                page = locate(trecho, pages)
                if page is None:
                    issues.append("trecho_nao_encontrado")
                elif page and page != a.get("pagina"):
                    issues.append(f"pagina_corrigida:{a.get('pagina')}->{page}")
                    a["pagina"] = page
        else:
            a.update(frase="", trecho="", pagina=0)
            if f == "dinheiro":
                a["direcao"] = "nao_diz"
        out[f] = a
        if issues:
            checks[f] = issues
    return out, checks


def blocking(checks: dict[str, list[str]], answers: dict[str, Any]) -> dict[str, list[str]]:
    """Avisos que impedem publicar, só nos campos que ainda dizem algo."""
    return {
        f: [i for i in v if i.split(":")[0] in BLOCKING]
        for f, v in checks.items()
        if (answers.get(f) or {}).get("diz") and any(i.split(":")[0] in BLOCKING for i in v)
    }
