"""etl.receita.arrecadacao: arrecadação federal por UF, mês e tributo (Receita Federal, dados abertos) para /impostos (S16).

Fonte: https://www.gov.br/receitafederal/dados/arrecadacao-estado.csv (latin-1, ';'), uma linha por ano × mês × UF e uma coluna por tributo.
Grava em w4_tax_revenue (migração 0040) o nome da coluna da Receita sem alterar, em centavos de real, valor nominal (sem correção por inflação).

Formato numérico do arquivo, o que foi observado e a regra adotada:
  * 2013 em diante (2008–2012 traz o formato certo mas não traz a RECEITA PREVIDENCIÁRIA: 2012 soma 727 bi contra 1,1 tri de 2013, então o
    total não é comparável e esses anos não são gravados): vírgula decimal ("133165371,2"); em jun/2023–2024 algumas células vêm com ponto de milhar ("91.155.798"): o ponto é removido.
  * 2000–2007: sem vírgula (inteiro) ou, em 2001, 2002 e 2005, vírgula de milhar misturada com decimal. Não dá para separar uma coisa da outra
    sem adivinhar, então esses anos NÃO são gravados (a página diz "a partir de 2008" e o motivo). Nada de valor adivinhado.
Validações (falham o run se quebrarem): (1) COFINS, PIS/PASEP, CSLL e Receita Previdenciária nunca têm o total e as partes preenchidos ao mesmo
tempo na mesma linha, senão a soma contaria em dobro; (2) cada UF de cada mês aparece uma vez; (3) o total nacional de um mês fica entre 1/3 e 3x a
mediana dos meses do mesmo ano (pega erro de escala de milhar).
Coluna vazia = a Receita não informa: não é gravada, nunca vira zero.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import statistics
from collections import defaultdict
from decimal import Decimal, InvalidOperation

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch

log = logging.getLogger("etl.receita")
URL = "https://www.gov.br/receitafederal/dados/arrecadacao-estado.csv"
FIRST_YEAR = 2013  # antes disso o arquivo não traz a receita previdenciária: o total não é comparável com os anos seguintes
MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
PARENT_CHILDREN = {
    "COFINS": ["COFINS - FINANCEIRAS", "COFINS - DEMAIS"],
    "CONTRIBUIÇÃO PARA O PIS/PASEP": ["CONTRIBUIÇÃO PARA O PIS/PASEP - FINANCEIRAS", "CONTRIBUIÇÃO PARA O PIS/PASEP - DEMAIS"],
    "CSLL": ["CSLL - FINANCEIRAS", "CSLL - DEMAIS"],
    "RECEITA PREVIDENCIÁRIA": ["RECEITA PREVIDENCIÁRIA - PRÓPRIA", "RECEITA PREVIDENCIÁRIA - DEMAIS"],
}


def parse_reais(s: str) -> int | None:
    """Reais do arquivo -> centavos. Vazio -> None."""
    s = s.strip()
    if not s:
        return None
    if "." in s and not re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):
        raise ValueError(f"ponto que não é de milhar: {s!r}")
    s = s.replace(".", "").replace(",", ".")
    try:
        return int((Decimal(s) * 100).to_integral_value())
    except InvalidOperation as e:
        raise ValueError(f"valor ilegível: {s!r}") from e


def parse(text: str) -> tuple[dict[tuple[int, int, str, str], int], list[str]]:
    rd = csv.reader(io.StringIO(text), delimiter=";")
    header = next(rd)
    taxes = header[3:]
    out: dict[tuple[int, int, str, str], int] = {}
    seen: set[tuple[int, int, str]] = set()
    notes: list[str] = []
    for row in rd:
        if len(row) < 4 or not row[0].strip().isdigit():
            continue
        year, mes, uf = int(row[0]), row[1].strip().lower(), row[2].strip().upper()
        if year < FIRST_YEAR:
            continue
        month = MONTHS.index(mes) + 1
        if (year, month, uf) in seen:
            raise SystemExit(f"linha duplicada {year}-{month} {uf}")
        seen.add((year, month, uf))
        vals = {t: parse_reais(v) for t, v in zip(taxes, row[3:])}
        for parent, kids in PARENT_CHILDREN.items():
            if (vals.get(parent) or 0) != 0 and any((vals.get(k) or 0) != 0 for k in kids):
                raise SystemExit(f"{year}-{month} {uf}: {parent} e suas partes preenchidos juntos (soma em dobro)")
        for t, v in vals.items():
            if v is not None:
                out[(year, month, uf, t)] = v
    # total nacional por mês: pega erro de escala
    month_total: dict[tuple[int, int], int] = defaultdict(int)
    for (y, m, _uf, _t), v in out.items():
        month_total[(y, m)] += v
    by_year: dict[int, list[int]] = defaultdict(list)
    for (y, _m), v in month_total.items():
        by_year[y].append(v)
    for (y, m), v in month_total.items():
        med = statistics.median(by_year[y])
        if len(by_year[y]) >= 6 and not (med / 3 <= v <= med * 3):
            raise SystemExit(f"{y}-{m:02d}: total nacional {v/100:,.0f} fora de 1/3–3x a mediana do ano ({med/100:,.0f}); erro de escala?")
    for y in sorted(by_year):
        notes.append(f"{y}: {sum(by_year[y]) / 100 / 1e9:,.1f} bi em {len(by_year[y])} meses")
    return out, notes


def run_arrecadacao(conn: psycopg.Connection, *, force: bool = False) -> None:
    f = fetch(URL, max_age=86400)
    text = f.text("latin-1")
    data, notes = parse(text)
    try:
        with run(conn, "receita.arrecadacao", "receita-federal", input_checksum=f.checksum, force=force) as r:
            rows = [(y, m, uf, t, v) for (y, m, uf, t), v in sorted(data.items())]
            r.add(len(upsert(conn, "w4_tax_revenue", ["year", "month", "uf", "tax", "amount_cents"], rows, ["year", "month", "uf", "tax"], returning=["year"])))
            r.notes.extend(notes[-24:])
            log.info("receita: %d valores, %s", len(rows), notes[-1] if notes else "")
    except SkipUnchanged:
        pass
