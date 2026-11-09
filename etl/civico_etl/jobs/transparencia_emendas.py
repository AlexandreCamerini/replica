"""transparencia.emendas (catálogo D02): emendas parlamentares do Portal da Transparência, ano a ano (2023+), em `amendments` (0001 + 0082).

Fonte: GET api.portaldatransparencia.gov.br/api-de-dados/emendas?ano=&pagina= (ConsultaEmendasDTO do OpenAPI v3, lido em 08/11/2026).
Campos reais (todos string, exceto `ano`): codigoEmenda, ano, tipoEmenda, autor, nomeAutor, numeroEmenda, localidadeDoGasto, funcao,
subfuncao, valorEmpenhado, valorLiquidado, valorPago, valorRestoInscrito, valorRestoCancelado, valorRestoPago.
O que a API NÃO tem: código do autor, código IBGE do município, objeto da emenda. Daí:
  * autor: casamento só por nome parlamentar (D132 adaptado, ver match_author) com `people.display_name`;
  * município: só por "NOME - UF" da `localidadeDoGasto`; o que não for município inequívoco fica sem place, com motivo;
  * estágios: empenhado, liquidado e pago do ano da emenda (valorPago, NUNCA valorRestoPago, que vai em coluna própria).
Nada é inventado: valor ausente fica NULL. Linha que a fonte deixou de devolver NÃO é apagada (só contada na nota do run).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Iterable

import psycopg

from .. import transparencia as T
from ..db import SkipUnchanged, run, upsert
from ..util import cents, fold

log = logging.getLogger("etl.emendas")
FIRST_YEAR = 2023
MATCH_METHOD = "nome_parlamentar_mandato"
COLLECTIVE = {"bancada", "comissao", "relator"}
COLS = ["person_id", "author_label", "year", "kind", "area", "budget_action", "beneficiary_place_id", "committed_cents", "paid_cents", "currency",
        "source_key", "liquidated_cents", "resto_inscrito_cents", "resto_cancelado_cents", "resto_pago_cents", "api_code", "number", "kind_label",
        "subfunction", "locality_label", "beneficiary_uf", "place_note", "match_method", "match_confidence", "match_note"]


def kind_of(tipo: str | None) -> str:
    """tipoEmenda é texto livre no OpenAPI: o mapeamento é por palavra-chave (SUPOSIÇÃO não provada contra a fonte); o resto vira 'outro'."""
    t = fold(tipo)
    if "relator" in t:
        return "relator"
    if "bancada" in t:
        return "bancada"
    if "comiss" in t:
        return "comissao"
    if "individual" in t:
        return "individual_pix" if ("especia" in t or "pix" in t) else "individual"
    return "outro"


_LOC = re.compile(r"^(?P<name>.+?)\s+-\s+(?P<uf>[A-Za-z]{2})$")
_PREFIX = re.compile(r"^(municipio|cidade)\s+de\s+")


def parse_locality(raw: str | None) -> tuple[str | None, str | None, str | None]:
    """'CAMPINAS - SP' -> ('campinas', 'SP', None). Sem formato 'NOME - UF' (nacional, múltiplo, exterior, estado): (None, None, motivo)."""
    s = (raw or "").strip()
    if not s:
        return None, None, "localidade vazia na fonte"
    m = _LOC.match(s)
    if not m:
        return None, None, f"localidade sem 'NOME - UF' ({s[:60]}): nacional, múltipla, exterior ou esfera estadual"
    name = _PREFIX.sub("", fold(m["name"]))
    if re.match(r"^(estado|governo|distrito federal)\b", name):
        return None, m["uf"].upper(), "gasto de esfera estadual, sem município"
    return name, m["uf"].upper(), None


def parse_emenda(it: dict[str, Any]) -> dict[str, Any] | None:
    """Um item do DTO -> linha neutra. None = rejeitar (sem código ou ano)."""
    code = str(it.get("codigoEmenda") or "").strip()
    year = it.get("ano")
    if not code or not isinstance(year, int):
        return None
    loc = (it.get("localidadeDoGasto") or "").strip()
    fn, sub = (it.get("funcao") or "").strip(), (it.get("subfuncao") or "").strip()
    return {
        "code": code, "year": year, "number": (it.get("numeroEmenda") or "").strip() or None,
        "kind_label": (it.get("tipoEmenda") or "").strip() or None, "kind": kind_of(it.get("tipoEmenda")),
        "author": (it.get("nomeAutor") or it.get("autor") or "").strip(),
        # ufAutor: ausente no ConsultaEmendasDTO v3; usado se a fonte passar a trazer
        "author_uf": (str(it.get("ufAutor") or "").strip().upper() or None),
        "locality": loc or None, "function": fn or None, "subfunction": sub or None,
        "committed": cents(it.get("valorEmpenhado")), "liquidated": cents(it.get("valorLiquidado")), "paid": cents(it.get("valorPago")),
        "resto_inscrito": cents(it.get("valorRestoInscrito")), "resto_cancelado": cents(it.get("valorRestoCancelado")), "resto_pago": cents(it.get("valorRestoPago")),
        # chave natural: a fonte não garante um item por código (uma emenda pode ter várias localidades/funções)
        "source_key": f"tr:{code}|{fold(loc)}|{fold(fn)}|{fold(sub)}",
    }


class ShiftedPages(RuntimeError):
    """A mesma chave natural apareceu com valores diferentes em páginas diferentes: paginação deslocada (a fonte mudou entre as chamadas).
    Somar dobraria o empenhado; a leitura do ano é descartada."""


def merge_rows(parsed: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    """Une linhas com a mesma chave natural. Item idêntico a um já visto (página repetida) é descartado. Item DIFERENTE com a mesma chave
    SOMA os valores só se vier da MESMA página (partes da mesma emenda na mesma localidade e função; `db.upsert` descartaria um deles em
    silêncio). Se vier de outra página, levanta ShiftedPages: é paginação deslocada, não parte legítima. A página vem em `_page`
    (ausente = tudo na mesma página). Devolve (linhas, repetidas, somadas); `_page` não sai nas linhas."""
    out: dict[str, dict[str, Any]] = {}
    pages_of: dict[str, set[Any]] = {}
    seen: set[str] = set()
    dup = summed = 0
    money = ("committed", "liquidated", "paid", "resto_inscrito", "resto_cancelado", "resto_pago")
    for p in parsed:
        page = p.get("_page")
        q = {k: v for k, v in p.items() if k != "_page"}
        fp = json.dumps(q, sort_keys=True, default=str)
        if fp in seen:
            dup += 1
            continue
        seen.add(fp)
        cur = out.get(q["source_key"])
        if cur is None:
            out[q["source_key"]] = dict(q)
            pages_of[q["source_key"]] = {page}
            continue
        if page not in pages_of[q["source_key"]]:
            raise ShiftedPages(f"a chave {q['source_key'][:80]} repete com valores diferentes em páginas diferentes ({sorted(pages_of[q['source_key']], key=str)} e {page}): "
                               "paginação deslocada; leitura do ano descartada, nada gravado")
        summed += 1
        for k in money:
            if q[k] is not None:
                cur[k] = (cur[k] or 0) + q[k]
    return list(out.values()), dup, summed


@dataclass
class PeopleIndex:
    """Nome parlamentar (sem acento/caixa) -> pessoas do banco, e mandatos federais por pessoa."""

    by_name: dict[str, list[str]] = field(default_factory=dict)
    federal: dict[str, list[tuple[date, date]]] = field(default_factory=dict)
    ufs: dict[str, set[str]] = field(default_factory=dict)  # S3-5/D254: UFs dos mandatos federais da pessoa

    @classmethod
    def load(cls, conn: psycopg.Connection) -> "PeopleIndex":
        idx = cls()
        for r in conn.execute("select id, display_name from people"):
            idx.by_name.setdefault(fold(r["display_name"]), []).append(str(r["id"]))
        for r in conn.execute(
            "select m.person_id, m.started_on, m.ends_on, p.uf from mandates m join offices o on o.id = m.office_id join places p on p.id = m.place_id where o.slug in ('deputado_federal', 'senador')"
        ):
            idx.federal.setdefault(str(r["person_id"]), []).append((r["started_on"], r["ends_on"]))
            if r["uf"]:
                idx.ufs.setdefault(str(r["person_id"]), set()).add(str(r["uf"]).upper())
        return idx


_TITLE = re.compile(r"^(deputad[oa]|senador[a]?|dep\.?|sen\.?)\s+(federal\s+)?")


LINK_MIN_CONFIDENCE = 0.9  # D132: abaixo disto o fato fica sem person_id (com o motivo)


def match_author(author: str, kind: str, year: int, idx: PeopleIndex, author_uf: str | None = None) -> tuple[str | None, float | None, str]:
    """(person_id, confiança, motivo). Conservador como o D132: só vincula se o nome parlamentar é igual (sem acento/caixa),
    único entre TODAS as pessoas do banco, e a pessoa tem mandato de deputado federal ou senador que cobre algum dia do ano da emenda.
    `author_uf` (UF do autor, quando a fonte trouxer) precisa ser a de um mandato federal da pessoa; sem ela o nome sozinho não basta
    (homônimo fora do banco ou nome comum): confiança 0,8 < 0,9, sem vínculo, com o motivo (S3-5/D254).
    Qualquer dúvida: sem vínculo, com o motivo. Emenda coletiva (bancada, comissão, relator) nunca tem pessoa."""
    if kind in COLLECTIVE:
        return None, None, f"emenda de {kind}: sem autor individual"
    if not author:
        return None, None, "fonte sem nome de autor"
    name = _TITLE.sub("", fold(author))
    ids = idx.by_name.get(name, [])
    if not ids:
        return None, None, "nenhuma pessoa no banco com este nome parlamentar"
    if len(ids) > 1:
        return None, None, f"{len(ids)} pessoas no banco com este nome parlamentar (homônimo)"
    lo, hi = date(year, 1, 1), date(year, 12, 31)
    if not any(s <= hi and e > lo for s, e in idx.federal.get(ids[0], [])):
        return None, None, "nome único, mas a pessoa não tem mandato de deputado federal ou senador no ano da emenda"
    uf = (author_uf or "").strip().upper()
    if not uf:
        return None, 0.8, "nome único com mandato federal no ano, mas a fonte não traz a UF do autor: sem como excluir homônimo; sem vínculo (confiança 0,8 < 0,9)"
    if uf not in idx.ufs.get(ids[0], set()):
        return None, None, f"nome único com mandato federal, mas a UF do autor na fonte ({uf}) não é a do mandato"
    return ids[0], LINK_MIN_CONFIDENCE, "nome parlamentar igual, único no banco, com mandato federal no ano da emenda e UF do autor compatível"


def build_rows(rows: list[dict[str, Any]], idx: PeopleIndex, place_of: Callable[[str, str], str | None]) -> tuple[list[tuple], dict[str, int]]:
    out, stats = [], {"com_pessoa": 0, "sem_pessoa": 0, "com_municipio": 0, "sem_municipio": 0}
    for p in rows:
        pid, conf, note = match_author(p["author"], p["kind"], p["year"], idx, p.get("author_uf"))
        name, uf, loc_note = parse_locality(p["locality"])
        place = None
        if name and uf:
            place = place_of(uf, name)
            if place is None:
                loc_note = f"município '{name}' ({uf}) sem correspondência única no IBGE"
        stats["com_pessoa" if pid else "sem_pessoa"] += 1
        stats["com_municipio" if place else "sem_municipio"] += 1
        out.append((pid, p["author"] or "(sem autor)", p["year"], p["kind"], p["function"], p["subfunction"], place, p["committed"], p["paid"], "BRL",
                    p["source_key"], p["liquidated"], p["resto_inscrito"], p["resto_cancelado"], p["resto_pago"], p["code"], p["number"], p["kind_label"],
                    p["subfunction"], p["locality"], uf, None if place else loc_note, MATCH_METHOD if pid else None, conf, note))
    return out, stats


def _place_lookup(conn: psycopg.Connection) -> Callable[[str, str], str | None]:
    """Município inequívoco por UF + nome; nome de município igual ao da UF ('SÃO PAULO - SP') é ambíguo com gasto estadual: sem vínculo."""
    from .tse_votos_contas import _muni_map

    look = _muni_map(conn)
    ufs = {fold(r["name"]) for r in conn.execute("select name from places where kind = 'uf'")}

    def place_of(uf: str, name: str) -> str | None:
        if name in ufs:
            return None
        return look(uf, name)

    return place_of


def run_emendas(conn: psycopg.Connection, *, years: list[int] | None = None, key: str | None = None, force: bool = False,
                gate: T.Gate | None = None, pages: Callable[[int], Iterable[list[dict[str, Any]]]] | None = None) -> None:
    """`pages(year)` é injetável (teste/fixture); por padrão pagina a API. A leitura do ano é inteira antes de gravar: erro no meio não grava nem carimba.
    Paginação deslocada (ShiftedPages) descarta só aquele ano: os outros seguem e, no fim, o run falha com a lista dos anos descartados."""
    years = years or list(range(FIRST_YEAR, date.today().year + 1))
    gate = gate or T.Gate()
    aborted: list[str] = []
    for year in years:
        state = T.PageRead()
        src = pages(year) if pages else T.iter_pages("emendas", {"ano": year}, key=key, gate=gate, state=state)
        paged = [(n, x) for n, page in enumerate(src) for x in page]
        items = [x for _, x in paged]
        checksum = hashlib.sha256(json.dumps(items, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        log.info("emendas %d: %d itens lidos da API", year, len(items))
        try:
            with run(conn, f"transparencia.emendas.{year}", "transparencia", input_checksum=checksum, force=force) as r:
                parsed = [dict(p, _page=n) for n, i in paged if (p := parse_emenda(i))]
                if len(items) > len(parsed):
                    r.reject(len(items) - len(parsed), "item sem codigoEmenda ou ano")
                if state.truncated:
                    r.notes.append(f"leitura possivelmente truncada ({state.note}); gravado o que veio, nada apagado")
                merged, dup, summed = merge_rows(parsed)
                if dup or summed:
                    r.notes.append(f"{dup} itens idênticos descartados (página repetida), {summed} itens somados por repetirem a chave emenda+localidade+função na mesma página")
                rows, stats = build_rows(merged, PeopleIndex.load(conn), _place_lookup(conn))
                r.add(len(upsert(conn, "amendments", COLS, rows, ["source_key"], returning=["id"])))
                keys = [x["source_key"] for x in merged]
                gone = conn.execute("select count(*) as n from amendments where year = %s and source_key like 'tr:%%' and source_key <> all(%s)", (year, keys)).fetchone()["n"]
                if gone:
                    r.notes.append(f"{gone} emendas de {year} já gravadas não vieram nesta leitura (mantidas, não apagadas)")
                r.notes.append(f"vínculo com pessoa: {stats['com_pessoa']} sim, {stats['sem_pessoa']} não; município: {stats['com_municipio']} sim, {stats['sem_municipio']} não")
                log.info("emendas %d: %s", year, stats)
        except SkipUnchanged:
            continue
        except ShiftedPages as e:
            log.error("emendas %d descartado: %s", year, e)
            aborted.append(f"{year}: {e}")
    if aborted:
        raise ShiftedPages("; ".join(aborted))
