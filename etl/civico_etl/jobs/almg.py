"""ale.mg: Assembleia Legislativa de Minas Gerais (ALMG), API de dados abertos v2 (dadosabertos.almg.gov.br/api/v2).

robots.txt da ALMG: só /api/v2/, /api/ajuda/ e /documentacao/ são permitidos, e a API não pode ser paginada nem reordenada
(p=, tp=, ord=, ordenacao= proibidos). Por isso (D104):
  * os arquivos CSV de /arquivo/... não são baixados (fora do Allow);
  * proposições vêm de /proposicoes/pesquisa/direcionada?tipo&ano&ini&fim (20 por resposta): a janela de datas é dividida
    ao meio até caber em 20; um dia com mais de 20 é completado número a número (&num=).

Fontes:
  /deputados/{em_exercicio,que_exerceram_mandato,que_se_afastaram,que_renunciaram,que_perderam_mandato}  -> legislatura atual
  /deputados/{id}                                                     -> nome civil e nascimento (casamento com o TSE)
  /prestacao_contas/verbas_indenizatorias/deputados/{id}/datas        -> meses com verba fechada
  /prestacao_contas/verbas_indenizatorias/deputados/{id}/{ano}/{mes}  -> itens (tipo, emitente, CNPJ/CPF, valor reembolsado)
  /proposicoes/pesquisa/direcionada                                   -> PL, PLC, PEC, PRE com autores estruturados (ordem = assinatura)

Não lido (D102): presença e votos em plenário. A API publica presença e votação só de reuniões de comissão; a reunião de
plenário traz pauta e resultado sem lista de presença nem voto nominal.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import psycopg

from ..db import SkipUnchanged, run
from ..util import cents, parse_date, sha256_text
from .assembleias import Assembly, AssemblyMatcher, Disallowed, PropRow, category_label, ensure_assembly, polite_json, set_coverage, supplier, write_expenses, write_proposals

log = logging.getLogger("etl.almg")
API = "https://dadosabertos.almg.gov.br/api/v2"
ASSEMBLY = Assembly("MG", "alemg", "ALMG · Dados Abertos", "https://dadosabertos.almg.gov.br/", "dados abertos da ALMG (uso livre com citação da fonte)")
TYPES = {"PL": "PL", "PLC": "PLC", "PEC": "PEC", "PRE": "PR"}
DAY = 86400
LISTS = ["em_exercicio", "que_exerceram_mandato", "que_se_afastaram", "que_renunciaram", "que_perderam_mandato"]


def _list(d: Any) -> list:
    if isinstance(d, list):
        return d
    if isinstance(d, dict):
        for v in d.values():
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                inner = _list(v)
                if inner:
                    return inner
    return []


def _ts(v: Any) -> date | None:
    if isinstance(v, dict):
        v = v.get("$")
    return parse_date(str(v)) if v else None


class _Deputies:
    """Cache de /deputados/{id}: nome parlamentar, nome civil, nascimento e partido; casa com o TSE na primeira vez."""

    def __init__(self, m: AssemblyMatcher):
        self.m = m
        self.info: dict[str, dict] = {}

    def person(self, dep_id: str | int, name_hint: str | None = None, party_hint: str | None = None) -> str | None:
        dep_id = str(dep_id)
        if f"dep:{dep_id}" in self.m.links:
            return self.m.match(f"dep:{dep_id}", name_hint or "")
        if dep_id not in self.info:
            d: dict = {}
            try:
                d = polite_json(f"{API}/deputados/{dep_id}?formato=json", max_age=30 * DAY).get("deputado") or {}
            except FileNotFoundError:
                pass
            self.info[dep_id] = d
        d = self.info[dep_id]
        return self.m.match(
            f"dep:{dep_id}",
            d.get("nome") or (name_hint or "").replace("Deputada ", "").replace("Deputado ", ""),
            d.get("partido") or party_hint,
            civil=d.get("nomeServidor"),
            birth=parse_date(d.get("dataNascimento")),
        )


def _search(tipo: str, ano: int, ini: date, fim: date, extra: str = "") -> dict:
    url = f"{API}/proposicoes/pesquisa/direcionada?tipo={tipo}&ano={ano}&ini={ini:%Y%m%d}&fim={fim:%Y%m%d}{extra}&formato=json"
    # janela inteira no passado não muda mais: cache de 30 dias; janela com dias recentes revalida
    return polite_json(url, max_age=30 * DAY if fim < date.today() - timedelta(days=60) else 6 * 3600)


def _window(tipo: str, ano: int, ini: date, fim: date, out: dict[tuple[str, int], dict], over: list[int]) -> None:
    """Janela de datas dividida ao meio até caber em 20. Dia com mais de 20 soma o excesso em `over` (resolvido por _fill)."""
    d = _search(tipo, ano, ini, fim)
    res = d[next(iter(d))] if isinstance(d, dict) and d else {}
    n = int((res or {}).get("noOcorrencias") or 0)
    items = _list(res)
    for x in items:
        out[(x.get("siglaTipoProjeto"), int(x.get("numero")))] = x
    if n <= len(items):
        return
    if ini < fim:
        mid = ini + (fim - ini) // 2
        _window(tipo, ano, ini, mid, out, over)
        _window(tipo, ano, mid + timedelta(days=1), fim, out, over)
        return
    over.append(n - len(items))


def _fill(tipo: str, ano: int, out: dict[tuple[str, int], dict], excess: int) -> int:
    """Completa dias com mais de 20 proposições sem paginar: a numeração é sequencial na legislatura, então os números
    que faltam entre o menor e o maior do ano (e logo abaixo/acima) são buscados um a um com &num=. Devolve o que sobrou."""
    nums = sorted(n for (t, n) in out if t == tipo)
    if not nums or excess <= 0:
        return excess
    ini, fim = date(ano, 1, 1), min(date(ano, 12, 31), date.today())

    def one(num: int) -> bool:
        # sem janela de datas: proposição sem data de publicação também volta
        r = polite_json(f"{API}/proposicoes/pesquisa/direcionada?tipo={tipo}&ano={ano}&num={num}&formato=json",
                        max_age=30 * DAY if fim < date.today() - timedelta(days=60) else 6 * 3600)
        rr = r[next(iter(r))] if isinstance(r, dict) and r else {}
        hit = False
        for x in _list(rr):
            key = (x.get("siglaTipoProjeto"), int(x.get("numero")))
            if key not in out:
                out[key] = x
                hit = True
        return hit

    have = set(nums)
    for num in range(nums[0] + 1, nums[-1]):
        if excess <= 0:
            return 0
        if num not in have and one(num):
            excess -= 1
    for step, start in ((-1, nums[0] - 1), (1, nums[-1] + 1)):
        num, empty = start, 0
        while excess > 0 and num >= 1 and empty < 5:
            if one(num):
                excess, empty = excess - 1, 0
            else:
                empty += 1
            num += step
    return excess


def run_almg(conn: psycopg.Connection, *, years: list[int], expense_years: list[int], force: bool) -> list[str]:
    a = ensure_assembly(conn, ASSEMBLY)
    m = AssemblyMatcher(conn, "MG", a.source_slug)
    deps = _Deputies(m)
    notes: list[str] = []

    # 1) deputados da legislatura atual (todas as situações): base da verba indenizatória
    roster: dict[str, dict] = {}
    for kind in LISTS:
        try:
            for d in _list(polite_json(f"{API}/deputados/{kind}?formato=json", max_age=DAY)):
                roster[str(d["id"])] = d
        except FileNotFoundError:
            continue
    for dep_id, d in roster.items():
        deps.person(dep_id, d.get("nome"), d.get("partido"))
    m.flush()
    conn.commit()

    # 2) verba indenizatória (mês de referência = mês do gasto)
    by_year: dict[int, list[tuple]] = defaultdict(list)
    sums: dict[int, list[str]] = defaultdict(list)
    skipped: dict[str, int] = defaultdict(int)
    want = set(expense_years)
    for dep_id, d in sorted(roster.items()):
        pid = deps.person(dep_id)
        try:
            months = _list(polite_json(f"{API}/prestacao_contas/verbas_indenizatorias/deputados/{dep_id}/datas?formato=json", max_age=DAY))
        except FileNotFoundError:
            continue
        for mo in months:
            ref = _ts(mo.get("dataReferencia"))
            if not ref or ref.year not in want:
                continue
            if not pid:
                skipped[d.get("nome") or dep_id] += 1
                continue
            old = ref < date.today().replace(day=1) - timedelta(days=95)
            f_items = _list(polite_json(f"{API}/prestacao_contas/verbas_indenizatorias/deputados/{dep_id}/{ref.year}/{ref.month}?formato=json",
                                        max_age=30 * DAY if old else 12 * 3600))
            for grp in f_items:
                for it in grp.get("listaDetalheVerba") or []:
                    amount = cents(it.get("valorReembolsado"))
                    if amount is None:
                        continue
                    sname, sdoc = supplier(it.get("nomeEmitente"), it.get("cpfCnpj"))
                    key = f"{dep_id}:{ref:%Y-%m}:{it.get('codTipoDespesa')}:{it.get('id')}"
                    by_year[ref.year].append((pid, ref, category_label(it.get("descTipoDespesa") or grp.get("descTipoDespesa") or ""), sname, sdoc, amount, None, key))
                    sums[ref.year].append(f"{key}={amount}")
    m.flush()
    conn.commit()
    for y in expense_years:
        try:
            with run(conn, f"alemg.despesas.{y}", a.source_slug, input_checksum=sha256_text("\n".join(sorted(sums[y]))) + ":r1", force=force) as r:
                r.add(write_expenses(conn, a, y, by_year[y]))
                if skipped:
                    r.notes.append(f"meses de verba de {len(skipped)} deputado(s) sem crachá (suplentes sem mandato no TSE): " + ", ".join(sorted(skipped))[:400])
                log.info("ALMG verbas %d: %d itens", y, len(by_year[y]))
        except SkipUnchanged:
            continue

    # 3) proposições (PL, PLC, PEC, PRE) com autores estruturados
    for y in years:
        found: dict[tuple[str, int], dict] = {}
        try:
            for t in TYPES:
                over: list[int] = []
                _window(t, y, date(y, 1, 1), min(date(y, 12, 31), date.today()), found, over)
                # o total do ano (sem janela) pega também proposição sem data de publicação, que nenhuma janela de datas devolve
                dt = polite_json(f"{API}/proposicoes/pesquisa/direcionada?tipo={t}&ano={y}&formato=json", max_age=6 * 3600)
                total = int((dt[next(iter(dt))] if isinstance(dt, dict) and dt else {}).get("noOcorrencias") or 0)
                have = sum(1 for (tt, _n) in found if tt == t)
                left = _fill(t, y, found, max(sum(over), total - have))
                if left:
                    log.warning("ALMG %s %d: %d proposições não recuperadas sem paginar", t, y, left)
                    notes.append(f"ALMG {t} {y}: {left} proposições não recuperadas sem paginar (robots.txt)")
        except Disallowed as e:
            raise SystemExit(str(e))
        rows: list[PropRow] = []
        no_person: set[str] = set()
        for (sig, num), x in found.items():
            people = []
            for i, au in enumerate(x.get("autoresEstruturados") or []):
                if not au.get("id"):
                    continue
                pid = deps.person(au["id"], au.get("nome"), au.get("partido"))
                if pid:
                    people.append((pid, "principal" if i == 0 else "coautoria"))
                else:
                    no_person.add(au.get("nome") or str(au["id"]))
            rows.append(PropRow(TYPES[sig], num, y, (x.get("ementa") or "").strip(), x.get("situacao"), parse_date(x.get("dataPublicacao")),
                                f"https://www.almg.gov.br/projetos-de-lei/{sig}/{num}/{y}", people))
        m.flush()
        conn.commit()
        checksum = sha256_text("\n".join(sorted(f"{r.type}{r.number}:{r.status}:{len(r.authors)}:{r.summary[:40]}" for r in rows))) + ":r1"
        try:
            with run(conn, f"alemg.proposicoes.{y}", a.source_slug, input_checksum=checksum, force=force) as r:
                n_p, n_a = write_proposals(conn, a, y, rows)
                r.add(n_a)
                if no_person:
                    r.notes.append(f"{len(no_person)} autores sem crachá (suplentes ou legislatura sem mandato no diretório)")
                log.info("ALMG proposições %d: %d encontradas, %d com autor no diretório, %d autorias", y, len(rows), n_p, n_a)
        except SkipUnchanged:
            continue

    set_coverage(conn, a, {
        "propostas": ("no_site", "projetos de lei, de lei complementar, de resolução e PECs, da API de dados abertos da ALMG", f"{API}/proposicoes/pesquisa/direcionada"),
        "gastos_gabinete": ("no_site", "verba indenizatória por mês (valor reembolsado), da API de dados abertos da ALMG", f"{API}/prestacao_contas/verbas_indenizatorias/deputados/{{id}}/{{ano}}/{{mes}}"),
        "presenca": ("nao_publica", "a ALMG não publica em dado aberto a presença de cada deputado no plenário (só em reuniões de comissão)", "https://dadosabertos.almg.gov.br/api/ajuda/swagger/view/lastest"),
        "votos": ("nao_publica", "a ALMG não publica em dado aberto o voto de cada deputado no plenário (só em reuniões de comissão)", "https://dadosabertos.almg.gov.br/api/ajuda/swagger/view/lastest"),
    })
    return m.report() + notes
