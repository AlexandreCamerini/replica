"""Rascunho das respostas da página da proposta (Regra 3 do canvas "No seu bolso"). Puro: sem banco, sem rede.

Contrato: o modelo devolve, para cada pergunta, uma frase curta e o trecho literal do texto oficial que a sustenta,
com a página. Sem trecho, `diz` = false ("O texto não diz"). Tudo o que o modelo devolve passa por `validate`,
que nunca confia nele: confere o trecho contra o texto extraído do PDF, o tamanho da frase, os termos proibidos e
os números. O que falha vira um aviso para a pessoa que revisa; publicar com aviso bloqueante é recusado.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
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
BLOCKING = {
    "trecho_nao_encontrado", "termo_proibido", "numero_sem_trecho", "frase_vazia", "trecho_vazio", "frase_longa",
    "trecho_curto", "caractere_estranho", "estimativa_sem_numero", "direcao_invalida",
}
MIN_QUOTE_WORDS = 5  # um trecho de 1 ou 2 palavras ("de", "a lei") está em qualquer PDF e não sustenta nada
# numeral por extenso também é número; "um/uma" ficam de fora (são artigo na maioria das frases)
NUMBER_WORDS = (
    "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze",
    "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "trinta", "quarenta", "cinquenta",
    "sessenta", "setenta", "oitenta", "noventa", "cem", "cento", "duzentos", "trezentos", "quinhentos", "mil", "milhao",
    "milhoes", "bilhao", "bilhoes", "trilhao", "trilhoes", "dobro", "triplo", "metade", "terco", "quarto", "por cento",
)

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
    digits = {re.sub(r"[.\s]", "", n) for n in re.findall(r"\d[\d.,]*\d|\d", s)}
    f = _fold(s)
    return digits | {w for w in NUMBER_WORDS if re.search(rf"\b{w}\b", f)}


def _words(s: str) -> list[str]:
    return re.findall(r"\w+", s)


def _odd_chars(s: str) -> bool:
    """Letra fora do alfabeto latino (ex.: "а" cirílico) escapa da lista proibida; não tem lugar numa frase em português."""
    return any(ch.isalpha() and "LATIN" not in unicodedata.name(ch, "") for ch in s)


def locate(quote: str, pages: list[str]) -> int | None:
    """Página (1..n) onde o trecho começa; None se não aparece em lugar nenhum."""
    q = _norm(quote)
    if not q:
        return None
    normed = [_norm(t) for t in pages]
    for i, t in enumerate(normed, 1):
        if q in t:
            return i
    joined = " ".join(normed)  # trecho que atravessa a quebra de página: vale a página onde ele começa
    at = joined.find(q)
    if at < 0:
        return None
    pos = 0
    for i, t in enumerate(normed, 1):
        pos += len(t) + 1
        if at < pos:
            return i
    return len(pages)


def check_phrase(field: str, frase: str, trecho: str) -> list[str]:
    """O que se confere só com a frase e o trecho. Usado no rascunho e de novo quando o revisor edita a frase."""
    frase, issues = frase.strip(), []
    if not frase:
        issues.append("frase_vazia")
    if not trecho.strip():
        issues.append("trecho_vazio")
    words = len(_words(frase))  # "a-b-c" conta como três
    if words > MAX_WORDS:
        issues.append(f"frase_longa:{words}")
    if trecho.strip() and len(_words(trecho)) < MIN_QUOTE_WORDS:
        issues.append("trecho_curto")
    if _odd_chars(frase):
        issues.append("caractere_estranho")
    ff = _fold(frase)
    # radical, não forma exata: "beneficiará", "prejudicam", "avanços" também contam; "benefício" (substantivo) não
    if any(re.search(rf"\b{re.escape(_fold(t))}\w*" if " " not in t else rf"\b{re.escape(_fold(t))}\b", ff) for t in FORBIDDEN):
        issues.append("termo_proibido")
    if field != "estimativa_impacto" and not any(re.search(rf"\b{_fold(v)}", ff) for v in VERBS):
        issues.append("sem_verbo_da_lista")
    if _numbers(frase) - _numbers(trecho):
        issues.append("numero_sem_trecho")
    if field == "estimativa_impacto" and not re.search(r"\d", trecho):
        issues.append("estimativa_sem_numero")
    # a frase precisa dividir ao menos uma palavra de conteúdo com o trecho; o resto é julgamento do revisor
    content = {w for w in _words(_fold(frase)) if len(w) >= 5}
    if content and trecho.strip() and not any(w[:5] in _fold(trecho) for w in content):
        issues.append("frase_longe_do_trecho")
    return issues


def shape_errors(answers: Any) -> list[str]:
    """Resposta do modelo sem um campo ou com tipo errado não é "O texto não diz": é resposta inválida."""
    if not isinstance(answers, dict):
        return ["resposta não é objeto"]
    errs = []
    for f in FIELDS:
        a = answers.get(f)
        if not isinstance(a, dict):
            errs.append(f"{f}: ausente")
            continue
        if not isinstance(a.get("diz"), bool) or not isinstance(a.get("frase"), str) or not isinstance(a.get("trecho"), str) or not isinstance(a.get("pagina"), int):
            errs.append(f"{f}: tipo errado")
        if f == "dinheiro" and a.get("direcao") not in ("entra", "sai", "dividido", "nao_diz"):
            errs.append("dinheiro: direcao fora da lista")
    return errs


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
                    a["pagina"] = 0  # nunca publicar página que o PDF não confirma
                elif page != a.get("pagina"):
                    issues.append(f"pagina_corrigida:{a.get('pagina')}->{page}")
                    a["pagina"] = page
            if f == "dinheiro" and a.get("direcao") not in ("entra", "sai", "dividido"):
                issues.append("direcao_invalida")
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


# --- chamada à API: bloco fixo com cache e custo estimado (D15). Puro: sem rede, sem SDK. -------------------------------

def system_blocks(ttl: str | None = None) -> list[dict[str, Any]]:
    """O bloco fixo (instruções, regras, formato) com `cache_control`. TTL 5 min por padrão; "1h" para o lote, que pode levar
    mais de 5 min entre uma requisição e outra. Texto idêntico a SYSTEM: mudar aqui sem subir PROMPT_VERSION reescreve o cache, não o rascunho."""
    cc: dict[str, str] = {"type": "ephemeral"}
    if ttl:
        cc["ttl"] = ttl
    return [{"type": "text", "text": SYSTEM, "cache_control": cc}]


def request_params(model: str, label: str, summary: str | None, pages: list[str], *, ttl: str | None = None) -> dict[str, Any]:
    """Corpo de uma requisição de rascunho. É o mesmo no modo síncrono e no lote (só o transporte muda)."""
    return {
        "model": model,
        "max_tokens": 16000,
        "system": system_blocks(ttl),
        "messages": [{"role": "user", "content": user_message(label, summary, pages)}],
        "output_config": {"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
    }


@dataclass(frozen=True)
class Usage:
    input: int = 0  # tokens de entrada sem cache (a API não inclui aqui o que veio do cache nem o que foi gravado nele)
    output: int = 0
    cache_read: int = 0
    cache_create: int = 0
    batch: bool = False
    cache_ttl: str = "5m"

    @classmethod
    def from_api(cls, u: Any, *, batch: bool = False, cache_ttl: str = "5m") -> "Usage":
        g = lambda n: int(getattr(u, n, 0) or 0)  # noqa: E731 - campos de cache vêm None quando o modelo não cacheia
        return cls(g("input_tokens"), g("output_tokens"), g("cache_read_input_tokens"), g("cache_creation_input_tokens"), batch, cache_ttl)


# US$ por 1M de tokens (tabela da skill claude-api, 2026-10-06): (entrada, saída, leitura de cache). Escrita de cache = 1,25x
# a entrada (TTL 5 min) ou 2x (1 h). Lote = 50% em tudo. Modelo fora da tabela => custo None (nunca inventar).
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-sonnet-5-5": (2.0, 10.0, 0.20),
    "claude-sonnet-5": (2.0, 10.0, 0.20),
    "claude-opus-5-5": (4.0, 20.0, 0.20),
    "claude-opus-5": (5.0, 25.0, 0.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),  # até 100 mil tokens de prompt; acima disso o preço sobe
}


def estimate_cost(model: str, u: Usage) -> float | None:
    """Custo estimado em US$ de uma chamada. Aproximação: o ID servido pode vir com sufixo, casa por prefixo mais longo."""
    hit = max((k for k in PRICES if model == k or model.startswith(k + "-")), key=len, default=None)
    if hit is None:
        return None
    pin, pout, pread = PRICES[hit]
    write = pin * (2.0 if u.cache_ttl == "1h" else 1.25)
    usd = (u.input * pin + u.output * pout + u.cache_read * pread + u.cache_create * write) / 1_000_000
    return round(usd * (0.5 if u.batch else 1.0), 6)
