"""etl.governos.indicadores: indicadores nacionais ano a ano para /governos (S12), de fontes oficiais abertas e sem chave.

Um valor por indicador e ano em w4_yearly_indicators (migração 0040). Regra de cada série (a página publica as mesmas definições):
  pib_variacao        variação anual do PIB em volume (%). IBGE/SIDRA tabela 6784 var. 9810 (Contas Nacionais anuais, 1996–);
                      para os anos que a anual ainda não cobre, a taxa acumulada em quatro trimestres do 4º trimestre
                      (tabela 5932 var. 6562, PIB a preços de mercado), que é a mesma conta e pode ser revisada.
  ipca_acumulado      IPCA acumulado em 12 meses em dezembro (%). IBGE/SIDRA tabela 1737 var. 2265, período AAAA12.
  selic_meta_fim_ano  meta da taxa Selic (% a.a.) vigente em 31/12, última observação do mês de dezembro. BCB/SGS série 432 (desde mar/1999).
  desemprego_media    taxa de desocupação (%), média simples dos quatro trimestres. IBGE/PNAD Contínua, tabela 4099 var. 4099 (2012–).
Ano em andamento não entra (fica "—" na página com o motivo). Valor ausente na fonte não é gravado: nunca vira zero.
Validação embutida: confere valores conhecidos (PIB 2022 = 3,0; IPCA 2023 = 4,62; Selic 31/12/2022 = 13,75; desocupação 4T2022 = 7,9).
"""

from __future__ import annotations

import logging
from datetime import date

import psycopg

from ..db import SkipUnchanged, run, source_id, upsert
from ..http import fetch_json

log = logging.getLogger("etl.governos")
IBGE = "https://servicodados.ibge.gov.br/api/v3/agregados"
SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{}/dados?formato=json&dataInicial={}&dataFinal={}"
DAY = 86400


def _sidra(table: int, var: int, periods: str, classif: str = "") -> dict[str, float]:
    url = f"{IBGE}/{table}/periodos/{periods}/variaveis/{var}?localidades=N1%5Ball%5D{classif}"
    d = fetch_json(url, max_age=DAY)
    serie = d[0]["resultados"][0]["series"][0]["serie"]
    return {p: float(v) for p, v in serie.items() if v not in ("", "-", "...", "..")}


def _periods(first: int, last: int, suffix: str) -> str:
    return "%7C".join(f"{y}{suffix}" for y in range(first, last + 1))


def collect(today: date) -> tuple[dict[tuple[str, int], tuple[float, str, str, str]], list[str]]:
    """(indicador, ano) -> (valor, unidade, fonte, referência da série)."""
    out: dict[tuple[str, int], tuple[float, str, str, str]] = {}
    notes: list[str] = []
    last_full = today.year - 1

    # PIB: anual (1996–) e, onde falta, 4º trimestre acumulado em 4 trimestres
    pib_a = _sidra(6784, 9810, _periods(1996, last_full, ""))
    for p, v in pib_a.items():
        out[("pib_variacao", int(p))] = (v, "%", "ibge-sidra", "SIDRA 6784 v9810 (anual)")
    pib_q = _sidra(5932, 6562, _periods(1997, last_full, "04"), "&classificacao=11255%5B90707%5D")
    for p, v in pib_q.items():
        y = int(p[:4])
        if ("pib_variacao", y) not in out:
            out[("pib_variacao", y)] = (v, "%", "ibge-sidra", "SIDRA 5932 v6562 (4º trimestre, acumulado em 4 trimestres; sujeito a revisão)")
            notes.append(f"PIB {y}: tabela anual ainda sem o ano; usado o 4º trimestre acumulado")

    # IPCA acumulado em dezembro
    for p, v in _sidra(1737, 2265, _periods(1980, last_full, "12")).items():
        out[("ipca_acumulado", int(p[:4]))] = (v, "%", "ibge-sidra", "SIDRA 1737 v2265 (acumulado em 12 meses, dezembro)")

    # desocupação: média simples dos 4 trimestres, só com os 4
    q: dict[int, list[float]] = {}
    for p, v in _sidra(4099, 4099, "%7C".join(f"{y}0{t}" for y in range(2012, last_full + 1) for t in (1, 2, 3, 4))).items():
        q.setdefault(int(p[:4]), []).append(v)
    for y, vs in q.items():
        if len(vs) == 4:
            out[("desemprego_media", y)] = (round(sum(vs) / 4, 2), "%", "ibge-sidra", "SIDRA 4099 v4099 (média simples dos 4 trimestres)")
        else:
            notes.append(f"desocupação {y}: {len(vs)} de 4 trimestres, ano não gravado")

    # Selic meta no fim do ano: última observação de dezembro (SGS 432). Janela de 1 mês por ano: não esbarra no limite de 10 anos da SGS
    for y in range(1999, last_full + 1):
        rows = fetch_json(SGS.format(432, f"01/12/{y}", f"31/12/{y}"), max_age=DAY * 30)
        if not rows:
            notes.append(f"Selic {y}: sem observação em dezembro")
            continue
        last = max(rows, key=lambda r: tuple(reversed(r["data"].split("/"))))
        out[("selic_meta_fim_ano", y)] = (float(last["valor"]), "% a.a.", "bcb-sgs", "SGS 432 (meta Selic, última observação de dezembro)")
    return out, notes


KNOWN = {("pib_variacao", 2022): 3.0, ("ipca_acumulado", 2023): 4.62, ("selic_meta_fim_ano", 2022): 13.75}


def run_governos(conn: psycopg.Connection, *, force: bool = False) -> None:
    today = date.today()
    data, notes = collect(today)
    for k, expected in KNOWN.items():
        got = data.get(k)
        if got is None or abs(got[0] - expected) > 0.011:
            raise SystemExit(f"validação falhou: {k} = {got} (esperado {expected}); fonte mudou de formato?")
    checksum = f"{today.year}:{len(data)}:" + ",".join(f"{k[0]}{k[1]}={v[0]}" for k, v in sorted(data.items()))
    try:
        with run(conn, "governos.indicadores", "ibge-sidra", input_checksum=checksum, force=force) as r:
            src = {s: source_id(conn, s) for s in ("ibge-sidra", "bcb-sgs")}
            rows = [(ind, y, v, unit, src[s], ref) for (ind, y), (v, unit, s, ref) in sorted(data.items())]
            r.add(len(upsert(conn, "w4_yearly_indicators", ["indicator", "year", "value", "unit", "source_id", "series_ref"], rows, ["indicator", "year"], returning=["year"])))
            r.notes.extend(notes[:20])
            # o carimbo da série do BCB acompanha o do IBGE: mesmo run, duas fontes
            conn.execute(
                """insert into dataset_stamps (dataset, source_id, refreshed_at, last_run_id)
                   values ('governos.bcb', %s, now(), %s)
                   on conflict (dataset) do update set refreshed_at = excluded.refreshed_at, last_run_id = excluded.last_run_id""",
                (src["bcb-sgs"], r.id),
            )
    except SkipUnchanged:
        pass
