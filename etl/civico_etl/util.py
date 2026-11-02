"""Funções puras usadas por todos os jobs: normalização de texto, datas, dinheiro."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable, Iterator, TypeVar

T = TypeVar("T")

# Partículas que ficam minúsculas em nome próprio pt-BR
_LOWER = {"de", "da", "do", "das", "dos", "e", "d", "di", "del", "della", "van", "von", "la", "le", "y"}
# Siglas/numerais romanos que ficam como estão
_KEEP_UPPER = re.compile(r"^(i{1,3}|iv|v|vi{0,3}|ix|x|jr|sr)$")


def fold(s: str | None) -> str:
    """Sem acento, minúsculo, espaços colapsados. Espelha f_unaccent(lower()) do Postgres."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def slugify(s: str) -> str:
    s = fold(s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:120] or "sem-nome"


def titlecase_pt(s: str | None) -> str:
    """'JOSÉ DA SILVA JR' -> 'José da Silva Jr'. Mantém apóstrofo e hífen ('D'Ávila', 'Sá-Pereira')."""
    if not s:
        return ""
    out: list[str] = []
    for i, w in enumerate(re.split(r"\s+", s.strip())):
        lw = w.lower()
        if i > 0 and lw in _LOWER:
            out.append(lw)
        elif _KEEP_UPPER.match(lw):
            out.append(lw.upper() if len(lw) <= 3 and lw not in {"jr", "sr"} else lw.capitalize())
        else:
            out.append(re.sub(r"(^|[-'’])(\w)", lambda m: m.group(1) + m.group(2).upper(), lw))
    return " ".join(out)


def party_key(sigla: str | None) -> str:
    """Chave de normalização de sigla: 'PC do B', 'PCdoB', 'PCDOB' -> 'PCDOB'."""
    return re.sub(r"[^A-Z0-9]", "", fold(sigla).upper())


def parse_date(s: str | None) -> date | None:
    """Aceita dd/mm/yyyy, yyyy-mm-dd, yyyy-mm-ddThh:mm:ss. Inválido ou vazio -> None, nunca exceção."""
    if not s or s.strip() in {"", "#NULO#", "#NE#", "-1", "-3"}:
        return None
    s = s.strip()
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        fmts: tuple[str, ...] = ("%d/%m/%Y",)
    else:
        s = s[:10]  # ignora hora: 'yyyy-mm-ddThh:mm:ss' -> 'yyyy-mm-dd'
        fmts = ("%Y-%m-%d",)
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    return None


def cents(v: str | float | int | Decimal | None) -> int | None:
    """'1.234,56' ou '1234.56' ou 1234.56 -> 123456. Vazio/#NULO# -> None."""
    if v is None:
        return None
    if isinstance(v, (int, float, Decimal)):
        return int(round(Decimal(str(v)) * 100))
    s = v.strip()
    if s in {"", "#NULO#", "#NE#", "-1"}:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return int(round(Decimal(s) * 100))
    except InvalidOperation:
        return None


def sha256_file(path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def chunked(it: Iterable[T], n: int) -> Iterator[list[T]]:
    buf: list[T] = []
    for x in it:
        buf.append(x)
        if len(buf) >= n:
            yield buf
            buf = []
    if buf:
        yield buf


def nz(s: str | None) -> str | None:
    """Vazio e sentinelas do TSE viram None."""
    if s is None:
        return None
    s = s.strip()
    return None if s in {"", "#NULO#", "#NE#", "-1", "-3", "NULO"} else s
