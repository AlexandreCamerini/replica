"""Saída da administração de coleta (A3): JSON e tabela de largura fixa. Reutilizável pelos próximos subcomandos.

Regras:
- `--json`: UM documento JSON válido em stdout, datas em ISO 8601, nada além dele. Diagnóstico vai para stderr.
- Tabela: cabeçalho, linhas de largura fixa por coluna (cada coluna tem a largura do maior valor, até `LARGURA_MAX`; o excedente vira "…"),
  sem cor, e uma linha final de total com denominador.
- Valor desconhecido é `null` no JSON e "desconhecido: <motivo>" na tabela (restrição 6): o motivo mora em `desconhecidos`, um dicionário
  {campo: motivo} na própria linha. Nunca zero no lugar de desconhecido.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Sequence
from uuid import UUID

class ErroAdmin(Exception):
    """Erro de execução esperado (chave inexistente, filtro desconhecido): o subcomando imprime a mensagem em stderr e sai com 1, sem traceback."""


LARGURA_MAX = 34
CHAVE_DESCONHECIDOS = "desconhecidos"


def _padrao(o: Any) -> Any:
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, UUID):
        return str(o)
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    raise TypeError(f"não serializável em JSON: {type(o).__name__}")


def para_json(doc: Any) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=2, default=_padrao)


def celula(linha: dict[str, Any], campo: str, fmt: Callable[[Any], str] | None = None) -> str:
    """Texto de uma célula: valor formatado; nulo vira 'desconhecido: <motivo>' (ou 'desconhecido' se a linha não explicou)."""
    v = linha.get(campo)
    if v is None:
        motivo = (linha.get(CHAVE_DESCONHECIDOS) or {}).get(campo)
        return f"desconhecido: {motivo}" if motivo else "desconhecido"
    if fmt is not None:
        return fmt(v)
    if isinstance(v, bool):
        return "sim" if v else "não"
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%MZ") if v.utcoffset() is not None else v.isoformat()
    if isinstance(v, (list, tuple)):
        return ", ".join(str(x) for x in v)
    return str(v)


def _corta(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def tabela(colunas: Sequence[tuple[str, str]], linhas: Sequence[dict[str, Any]], *, formatos: dict[str, Callable[[Any], str]] | None = None,
           total: str | None = None, largura_max: int = LARGURA_MAX) -> str:
    """`colunas` = [(campo, cabeçalho)]. Devolve o texto inteiro (cabeçalho, separador, linhas, total)."""
    formatos = formatos or {}
    textos = [[_corta(celula(l, c, formatos.get(c)), largura_max) for c, _ in colunas] for l in linhas]
    larguras = [max([len(h)] + [len(t[i]) for t in textos]) for i, (_, h) in enumerate(colunas)]
    out = ["  ".join(h.ljust(w) for (_, h), w in zip(colunas, larguras)).rstrip(), "  ".join("-" * w for w in larguras)]
    out += ["  ".join(c.ljust(w) for c, w in zip(t, larguras)).rstrip() for t in textos]
    if total:
        out += ["", total]
    return "\n".join(out)


def lista_chave_valor(pares: Sequence[tuple[str, Any]]) -> str:
    """Bloco 'rótulo: valor' (um por linha) para registros de detalhe."""
    if not pares:
        return ""
    w = max(len(k) for k, _ in pares)
    return "\n".join(f"{k.ljust(w)}  {v}" for k, v in pares)
