"""Câmaras Municipais pelo SAPL (Interlegis), W3-B. Sem tela por enquanto: grava em sapl_* (migração 0032).

  civico-etl sapl.descobrir [--ibge CODIGO ...]     registro oficial do Interlegis -> URL do SAPL -> /api/ responde?
  civico-etl sapl.carregar  [--ibge CODIGO ...]     por câmara "ok": vereadores, mandatos, projetos, autorias, sessões,
                                                    presença e votos nominais da legislatura atual; casa vereador com o TSE
  civico-etl sapl.todas                             descobrir + carregar (padrão: capitais)
  civico-etl sapl.ales [--uf RO ...]                Assembleias com SAPL 3.x (RO, AC, AM, PI, PB; D09): mesmo adaptador, casa = UF
  Opções: --full (recarrega tudo), --escopo capitais|todas, --lote N [--offset K] (janela de N câmaras), --orcamento-min M,
          --workers W (câmaras em paralelo; hosts distintos, 1,1 s por host continua valendo), --casa-max-min M (prazo de uma câmara),
          --lote-descoberta N, --max-pendentes N (D08: escala; ver replica/decisions.md D269–D272).

Descoberta (D126): a fonte da URL é a página "Órgãos atendidos" do Interlegis
(www12.senado.leg.br/interlegis/orgaosatendidos?uf=..&municipio=..; com &servico= a página dá 500), cartão "Câmara Municipal", linha "SAPL".
Não se chuta domínio. Depois, GET {url}/api/ precisa devolver o índice da API REST do SAPL 3.x.

Crawler educado: User-Agent identificado (http.UA), uma câmara por vez, >= 1,1 s entre requisições ao mesmo host,
robots.txt respeitado (assembleias.allowed), cache em disco (http.fetch; páginas valem 1 dia -> rodar de novo retoma
de onde parou sem bater na rede). Escopo: só a legislatura atual (D127).
Carga incremental (padrão): por câmara e entidade (matérias, autorias, presença, votos) fica um cursor em sapl_cursors (maior id
da fonte visto no início da leitura). A próxima só pede o que veio depois (o=-id até cruzar o cursor menos uma margem) e,
para matérias, o que foi editado desde a última leitura (data_ultima_atualizacao__gte; se a fonte ignorar o filtro, é detectado
e só vale o cursor de id). Reabertura: margem de ids relidos abaixo do cursor, sessões plenárias sempre relidas por inteiro
(poucas páginas; pega `finalizada`), presença/voto lançados depois entram com id novo e por isso caem acima do cursor.
Carga completa automática se: sem cursor, legislatura mudou, última completa há mais de FULL_EVERY_DAYS, ou --full.
Sem legislatura vigente cadastrada no SAPL é condição da fonte: vira data_coverage ("desconhecido" + motivo), run skipped_unchanged.
Matérias: só projetos (tipo cujo nome começa com "Projeto": PL, PLC, PR, PDL, emenda à Lei Orgânica...);
indicação, requerimento, moção e ofício ficam fora (mesma régua da D101 das Assembleias).
Casamento (D128): vereador do SAPL -> pessoa do TSE com mandato de vereador no mesmo município e legislatura, por nome
de urna (= nome parlamentar) ou nome civil completo, sem acento/caixa. Só casa se houver exatamente 1 candidato;
ambíguo ou sem candidato fica sem person_id, com motivo em match_note e no log. Nunca cria pessoa.
"""

from __future__ import annotations

import argparse
import html as htmllib
import logging
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterator, NamedTuple
from urllib.parse import quote, urlencode

import psycopg

from .. import db
from .. import http as H
from ..db import SkipUnchanged, run, upsert
from ..util import fold

log = logging.getLogger("etl.sapl")

MIN_INTERVAL = 1.1
H.RATE = 1 / MIN_INTERVAL
PAGE = 100
DAY = 86400
FULL_EVERY_DAYS = 30  # rede de segurança: recarga completa de cada entidade a cada 30 dias
UPDATED_MARGIN_DAYS = 2  # matérias editadas: relê de (última leitura - 2 dias) em diante
STALE_DAYS = 6  # câmara carregada há mais que isso volta à fila (incremental, barata) antes de qualquer câmara nova
MAX_PENDING_OK = 60  # não descobre mais enquanto houver tantas câmaras "ok" ainda nunca carregadas (cada uma custa ~10 min)
MARGIN = {"materias": 300, "autorias": 300, "presencas": 300, "votos": 1000}  # ids relidos abaixo do cursor
BACKOFF_BASE_H = 6  # câmara que falhou: 6 h, 12 h, 24 h... até BACKOFF_MAX_H (D270)
BACKOFF_MAX_H = 7 * 24
NO_LEGISLATURE_RETRY_H = 48  # sem legislatura vigente no SAPL: tenta de novo em 2 dias, não a cada lote
HOUSE_MAX_MIN = 25  # prazo de uma câmara (carga completa típica ~10 min): estourou = instável, entra em backoff
REGISTRY = "https://www12.senado.leg.br/interlegis/orgaosatendidos"

# Capitais com câmara municipal (Brasília não tem: CF art. 32). IBGE.
CAPITAIS = [
    "1200401", "2704302", "1600303", "1302603", "2927408", "2304400", "3205309", "5208707", "2111300", "5103403",
    "5002704", "3106200", "1501402", "2507507", "4106902", "2611606", "2211001", "3304557", "2408102", "4314902",
    "1100205", "1400100", "4205407", "3550308", "2800308", "1721000",
]

# Assembleias Legislativas com SAPL 3.x aberto (D09). URL conferida em 09/11/2026: /api/ devolve o índice 3.x, robots.txt só barra
# crawlers de SEO, legislatura vigente e presença/votos nominais publicados. Não se chuta domínio: uma ALE nova entra aqui depois de sondada.
ALE_SAPL = {
    "RO": "https://sapl.al.ro.leg.br",
    "AC": "https://sapl.al.ac.leg.br",
    "AM": "https://sapl.al.am.leg.br",
    "PI": "https://sapl.al.pi.leg.br",
    "PB": "https://sapl.al.pb.leg.br",
}
ALE_SOURCE = "sapl-ale"

# prazo da câmara em curso, por thread (cada worker carrega uma câmara)
_local = threading.local()


class HouseTimeout(Exception):
    pass


def _check_deadline() -> None:
    d = getattr(_local, "deadline", None)
    if d is not None and time.monotonic() > d:
        raise HouseTimeout(f"passou do prazo de {getattr(_local, 'limit_min', HOUSE_MAX_MIN):.0f} min por câmara")


def house_ids(house: dict[str, Any]) -> tuple[str, str, str]:
    """(dataset do run, slug da fonte, nome da casa). Câmara: sapl.<IBGE>; Assembleia (place = UF): sapl-ale.<uf>, fonte própria para
    a frescor de uma não esconder a da outra (prefixo diferente de 'sapl.')."""
    if house.get("kind") == "uf":
        return f"{ALE_SOURCE}.{house['uf'].lower()}", ALE_SOURCE, "Assembleia Legislativa"
    return f"sapl.{house.get('ibge_code')}", "sapl", "Câmara Municipal"


# ------------------------------------------------------------------ registro do Interlegis (puro, testado)


def parse_registry(page: str, municipio: str) -> tuple[str | None, str | None]:
    """Do HTML de "órgãos atendidos", acha o cartão da Câmara Municipal do município e devolve (url do SAPL, resultado
    da última verificação). (None, None) se a câmara não tem SAPL no registro."""
    cards = re.split(r'<div class="orgao-atendido">', page)
    alvo = fold(f"Câmara Municipal de {municipio}")
    for card in cards:
        m = re.search(r'font-weight:bold;margin-bottom:3px;">\s*([^<]+?)\s*</div>', card)
        if not m or fold(htmllib.unescape(m.group(1))) != alvo:
            continue
        for row in re.findall(r"<tr>(.*?)</tr>", card, re.S):
            cells = [htmllib.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if cells and cells[0].upper() == "SAPL":
                href = re.search(r'href="([^"]+)"', row)
                url = href.group(1).strip().rstrip("/") if href else None
                if url and url.startswith("http://"):
                    url = "https://" + url[len("http://"):]
                return url, (cells[4] if len(cells) > 4 else None)
        return None, None
    return None, None


def is_sapl_api(index: Any) -> bool:
    return isinstance(index, dict) and "parlamentares/parlamentar" in index and "materia/materialegislativa" in index


# ------------------------------------------------------------------ HTTP educado


class Blocked(Exception):
    pass


def _get(url: str, max_age: float = DAY) -> Any:
    from .assembleias import allowed  # robots.txt (RFC 9309) já implementado na W3-A

    if not allowed(url):
        raise Blocked(f"robots.txt bloqueia {url}")
    return H.fetch_json(url, max_age=max_age)


def pages(base: str, path: str, params: dict[str, Any] | None = None, *, stop=None, max_pages: int = 2000, max_age: float = DAY) -> Iterator[dict[str, Any]]:
    """Itera resultados paginados da API do SAPL (DRF). `stop(page_results) -> True` encerra após a página (varredura por id
    decrescente com o=-id). Monta a URL da página (os links `next` da fonte vêm em http://)."""
    q = dict(params or {})
    q.setdefault("page_size", PAGE)
    for n in range(1, max_pages + 1):
        _check_deadline()
        q["page"] = n
        try:
            d = _get(f"{base}/api/{path}/?{urlencode(q)}", max_age=max_age)
        except FileNotFoundError:
            if n == 1:
                raise
            # a contagem mudou durante a varredura (registro apagado na fonte): a página anunciada sumiu = fim
            log.warning("%s/%s: página %d sumiu durante a varredura; encerrando nela", base, path, n)
            return
        res = d.get("results") or []
        yield from res
        if stop and stop(res):
            return
        if not (d.get("pagination") or {}).get("next_page"):
            return
    log.warning("%s/%s: parou em %d páginas (limite)", base, path, max_pages)


def _desc_until(key: str, floor: int):
    """Parada para varredura com o=-id: página inteira abaixo do piso (com o campo `key`) encerra."""

    def stop(res: list[dict[str, Any]]) -> bool:
        vals = [r.get(key) for r in res if isinstance(r.get(key), int)]
        return bool(vals) and max(vals) < floor

    return stop


# ------------------------------------------------------------------ incremental (puro, testado)


class Plan(NamedTuple):
    mode: str  # 'full' | 'incremental'
    floor: int  # incremental: relê ids >= floor
    since: date | None  # matérias editadas desde
    why: str


def entity_plan(cur: dict[str, Any] | None, leg_number: Any, now: datetime, *, full: bool, margin: int, full_every: int = FULL_EVERY_DAYS) -> Plan:
    """Decide carga completa ou incremental de uma entidade, a partir do cursor guardado (ou None)."""
    if full:
        return Plan("full", 0, None, "--full")
    if not cur:
        return Plan("full", 0, None, "sem cursor")
    if cur.get("legislature_number") != leg_number:
        return Plan("full", 0, None, "legislatura mudou")
    if cur.get("full_at") and now - cur["full_at"] > timedelta(days=full_every):
        return Plan("full", 0, None, f"completa há mais de {full_every} dias")
    lu = cur.get("last_updated")
    since = (lu.date() - timedelta(days=UPDATED_MARGIN_DAYS)) if lu else None
    return Plan("incremental", max(int(cur["last_id"]) - margin, 0), since, "cursor")


def pick_legislature(legs: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    cur = [x for x in legs if x.get("data_inicio") and x.get("data_fim") and x["data_inicio"] <= today.isoformat() <= x["data_fim"]]
    return max(cur, key=lambda x: x["data_inicio"]) if cur else None


def no_legislature_reason(legs: list[dict[str, Any]], today: date) -> str:
    """Motivo legível (vai para data_coverage.reason e ingest_runs.error) quando o SAPL não tem legislatura vigente."""
    if not legs:
        quando = "nenhuma legislatura cadastrada"
    else:
        ult = max(legs, key=lambda x: x.get("data_fim") or "")
        quando = f"última cadastrada: {ult.get('numero')}ª, {ult.get('data_inicio')} a {ult.get('data_fim')}"
    return f"o SAPL da Câmara Municipal não tem legislatura vigente cadastrada em {today:%d/%m/%Y} ({quando}); condição da fonte, ainda sem carga"


def window(scope: list[str], lote: int | None, offset: int | None) -> list[str]:
    """Janela fixa [offset, offset+lote) do escopo ordenado."""
    k = offset or 0
    return scope[k : k + lote] if lote else scope[k:]


def to_discover(scope: list[str], state: dict[str, dict[str, Any]], now: datetime, limit: int | None, retry_days: int = 7) -> list[str]:
    """Códigos ainda não descobertos, mais os que ficaram fora do ar/sem API há mais de `retry_days`. Ordem do escopo."""
    out = []
    for c in scope:
        st = state.get(c)
        if st is None or (st["status"] in ("fora_do_ar", "sem_api") and now - st["checked_at"] > timedelta(days=retry_days)):
            out.append(c)
    return out[:limit] if limit else out


def backoff_until(fail_count: int, now: datetime) -> datetime:
    """retry_after de uma câmara com `fail_count` falhas seguidas (>= 1): 6 h, 12 h, 24 h... teto de 7 dias."""
    hours = min(BACKOFF_BASE_H * 2 ** max(fail_count - 1, 0), BACKOFF_MAX_H)
    return now + timedelta(hours=hours)


def load_queue(scope: list[str], state: dict[str, dict[str, Any]], limit: int | None, now: datetime | None = None) -> list[str]:
    """Fila de carga. 1º: câmaras 'ok' já carregadas com loaded_at mais velho que STALE_DAYS (incrementais, baratas), rodízio pela
    tentativa mais antiga (uma que estourou o tempo vai para o fim); 2º: as nunca carregadas (cargas completas), nunca tentadas primeiro.
    Câmara em backoff (retry_after no futuro, D270) fica fora até vencer: instável não come o orçamento todo lote."""
    now = now or datetime.now(timezone.utc)
    floor = datetime.min.replace(tzinfo=timezone.utc)
    ok = [c for c in scope if (state.get(c) or {}).get("status") == "ok" and not ((state[c].get("retry_after")) and state[c]["retry_after"] > now)]
    stale = [c for c in ok if state[c].get("loaded_at") and now - state[c]["loaded_at"] > timedelta(days=STALE_DAYS)]
    new = [c for c in ok if not state[c].get("loaded_at")]
    stale.sort(key=lambda c: (state[c]["last_attempt_at"] or floor, state[c]["loaded_at"], c))
    new.sort(key=lambda c: (state[c]["last_attempt_at"] is not None, state[c]["last_attempt_at"] or floor, c))
    out = stale + new
    return out[:limit] if limit else out


def discover_budget(limit: int | None, state: dict[str, dict[str, Any]], max_pending: int = MAX_PENDING_OK) -> int | None:
    """Quantas câmaras ainda podem ser descobertas: o acúmulo de 'ok' nunca carregadas não passa de max_pending."""
    pending = sum(1 for st in state.values() if st["status"] == "ok" and not st.get("loaded_at"))
    room = max(max_pending - pending, 0)
    return room if limit is None else min(limit, room)


def min_discarded(items: list[dict[str, Any]], known: set[int], key: str, boundary: int | None) -> int | None:
    """Menor id de item descartado por ainda não conhecermos o pai (`key` fora de `known`) E o pai ser mais novo que `boundary`
    (criado durante o run). O cursor não pode passar dele. Pai desconhecido mais antigo (tipo que não carregamos) não conta."""
    if boundary is None:
        return None
    ids = [int(i["id"]) for i in items if i.get(key) not in known and isinstance(i.get(key), int) and i[key] > boundary and isinstance(i.get("id"), int)]
    return min(ids) if ids else None


def cap_cursor(last_id: int | None, discarded: int | None) -> int | None:
    return last_id if discarded is None or last_id is None else min(last_id, discarded)


def scan_desc(base: str, path: str, floor: int, params: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], int | None]:
    """Varredura por id decrescente (o=-id) sempre na rede, parando na primeira página inteira abaixo de `floor`.
    Devolve (itens lidos, maior id visto). floor 0 = tudo."""
    items, mx = [], None
    for it in pages(base, path, {"o": "-id", **(params or {})}, stop=_desc_until("id", floor) if floor > 0 else None, max_age=0):
        items.append(it)
        if isinstance(it.get("id"), int):
            mx = it["id"] if mx is None else max(mx, it["id"])
    return items, mx


def head_id(base: str, path: str) -> int | None:
    for it in pages(base, path, {"o": "-id", "page_size": 1}, max_pages=1, max_age=0):
        return int(it["id"])
    return None


def updated_since(base: str, path: str, since: date, max_pages: int = 50) -> tuple[list[dict[str, Any]], bool]:
    """Itens editados desde `since` (data_ultima_atualizacao__gte). (itens, completo). completo=False se a fonte ignora o filtro ou se bateu em max_pages. Se a fonte ignora o filtro, a primeira página
    traz itens bem mais antigos que `since`: para na hora e devolve filtro_ok=False (vale só o cursor de id)."""
    guard = (since - timedelta(days=1)).isoformat()  # tolera fuso
    bad = {"v": False}
    n = {"pages": 0}

    def stop(res: list[dict[str, Any]]) -> bool:
        n["pages"] += 1
        if any((r.get("data_ultima_atualizacao") or "9999")[:10] < guard for r in res):
            bad["v"] = True
        return bad["v"]

    out = [it for it in pages(base, path, {"data_ultima_atualizacao__gte": since.isoformat(), "o": "-data_ultima_atualizacao"}, stop=stop, max_pages=max_pages, max_age=0)
           if (it.get("data_ultima_atualizacao") or "9999")[:10] >= guard]
    truncated = n["pages"] >= max_pages and not bad["v"]
    if truncated:
        log.warning("%s: edições de matéria truncadas em %d páginas; last_updated não avança (a próxima relê a janela)", base, max_pages)
    return out, not bad["v"] and not truncated


# ------------------------------------------------------------------ descoberta


def discover(conn: psycopg.Connection, codes: list[str]) -> list[dict[str, Any]]:
    places = {r["ibge_code"]: r for r in conn.execute(
        "select id, ibge_code, name, uf from places where kind = 'municipio' and ibge_code = any(%s)", (codes,))}
    bodies = {str(r["place_id"]): str(r["id"]) for r in conn.execute(
        "select id, place_id from legislative_bodies where kind = 'camara_municipal' and place_id = any(%s)", ([p["id"] for p in places.values()],))}
    out = []
    with run(conn, "sapl.descoberta", "sapl") as r:
        for code in codes:
            p = places.get(code)
            if not p:
                r.reject(1, f"IBGE {code} não está em places")
                continue
            reg = f"{REGISTRY}?{urlencode({'uf': p['uf'], 'municipio': p['name']}, quote_via=quote)}"
            row = {"place_id": str(p["id"]), "body_id": bodies.get(str(p["id"])), "registry_url": reg, "base_url": None, "registry_status": None,
                   "status": "sem_sapl_no_registro", "note": None, "name": p["name"], "uf": p["uf"], "ibge": code}
            try:
                url, st = parse_registry(H.fetch(reg, max_age=7 * DAY).text(), p["name"])
            except Exception as e:  # noqa: BLE001
                row["status"], row["note"] = "fora_do_ar", f"registro do Interlegis falhou: {e}"[:500]
                url, st = None, None
            row["base_url"], row["registry_status"] = url, st
            if url:
                try:
                    idx = _get(f"{url}/api/", max_age=7 * DAY)
                    row["status"] = "ok" if is_sapl_api(idx) else "sem_api"
                    if row["status"] == "sem_api":
                        row["note"] = "a URL responde, mas sem a API REST do SAPL 3.x"
                except Blocked as e:
                    row["status"], row["note"] = "robots_bloqueia", str(e)[:500]
                except Exception as e:  # noqa: BLE001 - SAPL 2.5 (sem /api), DNS, TLS, 5xx
                    row["status"], row["note"] = ("sem_api" if isinstance(e, FileNotFoundError) else "fora_do_ar"), f"{type(e).__name__}: {e}"[:500]
            elif row["status"] == "sem_sapl_no_registro":
                row["note"] = "o registro do Interlegis não lista SAPL para a Câmara Municipal"
            log.info("SAPL %s-%s: %s %s %s", p["name"], p["uf"], row["status"], url or "", row["note"] or "")
            out.append(row)
        upsert(conn, "sapl_houses", ["place_id", "body_id", "base_url", "registry_url", "registry_status", "status", "note", "checked_at"],
               [(x["place_id"], x["body_id"], x["base_url"], x["registry_url"], x["registry_status"], x["status"], x["note"], db.now_utc()) for x in out], ["place_id"])
        r.add(len(out))
    return out


# ------------------------------------------------------------------ carga de uma câmara


def _project_types(base: str) -> dict[int, tuple[str, str]]:
    out = {}
    for t in pages(base, "materia/tipomaterialegislativa"):
        name = (t.get("descricao") or "").strip()
        if fold(name).startswith("projeto"):
            out[int(t["id"])] = ((t.get("sigla") or name[:10]).strip(), name)
    return out


def _mat_row(hid: int, base: str, m: dict[str, Any], types: dict[int, tuple[str, str]], tid: int | None = None) -> tuple | None:
    tid = tid if tid is not None else m.get("tipo")
    if tid not in types or not (m.get("numero") and m.get("ano")):
        return None
    sig, name = types[tid]
    return (hid, int(m["id"]), sig, name, int(m["numero"]), int(m["ano"]), m.get("data_apresentacao"),
            (m.get("ementa") or "(sem ementa)").strip()[:4000], m.get("em_tramitacao"), f"{base}/materia/{m['id']}", m.get("texto_original"))


def _cursors(conn: psycopg.Connection, hid: int) -> dict[str, dict[str, Any]]:
    return {r["entity"]: dict(r) for r in conn.execute("select entity, last_id, last_updated, legislature_number, full_at from sapl_cursors where house_id = %s", (hid,))}


def _save_cursor(conn: psycopg.Connection, hid: int, entity: str, last_id: int | None, last_updated: datetime | None, leg_number: Any, plan: Plan, now: datetime) -> None:
    """Grava o cursor na mesma transação das linhas (run() faz o commit). Sem id visto (entidade vazia) não grava: próxima é completa."""
    if last_id is None:
        return
    conn.execute(
        """insert into sapl_cursors (house_id, entity, last_id, last_updated, legislature_number, full_at) values (%s, %s, %s, %s, %s, %s)
           on conflict (house_id, entity) do update set last_id = excluded.last_id, last_updated = coalesce(excluded.last_updated, sapl_cursors.last_updated),
             legislature_number = excluded.legislature_number,
             full_at = case when %s then excluded.full_at else sapl_cursors.full_at end""",
        (hid, entity, last_id, last_updated, leg_number, now, plan.mode == "full"))


def house_totals(conn: psycopg.Connection, hid: int) -> dict[str, int]:
    """Totais no banco (a cobertura descreve o que está guardado, não o que este run leu)."""
    return {k: conn.execute(f"select count(*) as n from {t} where house_id = %s", (hid,)).fetchone()["n"]
            for k, t in (("materias", "sapl_materias"), ("presencas", "sapl_presencas"), ("votos", "sapl_votos"))}


def _no_legislature(conn: psycopg.Connection, house: dict[str, Any], legs: list[dict[str, Any]], today: date) -> None:
    """Condição da fonte, não falha: motivo em data_coverage (se nunca carregou) e em sapl_houses.note. O run é gravado direto em
    ingest_runs como skipped_unchanged (com o motivo) SEM passar por db.run: não carimba dataset_stamps (não há dado por trás)."""
    why = no_legislature_reason(legs, today)
    ds, src, casa = house_ids(house)
    if casa != "Câmara Municipal":
        why = why.replace("Câmara Municipal", casa)
    log.info("SAPL %s: %s", house["name"], why)
    conn.execute("update sapl_houses set note = %s, last_attempt_at = now(), last_outcome = 'sem_legislatura', retry_after = now() + make_interval(hours => %s) where id = %s",
                 (why[:500], NO_LEGISLATURE_RETRY_H, house["id"]))
    if not house.get("loaded_at"):  # já carregada antes: não rebaixa a cobertura do que está guardado
        upsert(conn, "data_coverage", ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"],
               [(house["place_id"], ds, "desconhecido", why, f"{house['base_url']}/parlamentar/", date.today()) for ds in ("propostas", "presenca", "votos")], ["place_id", "dataset"])
    conn.execute("insert into ingest_runs (source_id, dataset, status, finished_at, error) values (%s, %s, 'skipped_unchanged', now(), %s)",
                 (db.source_id(conn, src), ds, why[:2000]))
    conn.commit()


def load_house(conn: psycopg.Connection, house: dict[str, Any], today: date | None = None, *, full: bool = False) -> dict[str, int]:
    today = today or date.today()
    base, hid = house["base_url"], house["id"]
    stats: dict[str, int] = {}
    now = datetime.now(timezone.utc)
    legs = list(pages(base, "parlamentares/legislatura", max_age=0))
    leg = pick_legislature(legs, today)
    if not leg:
        _no_legislature(conn, house, legs, today)
        return stats
    ds, src, _casa = house_ids(house)
    with run(conn, ds, src) as r:
        y0 = int(leg["data_inicio"][:4])
        ln = leg.get("numero")
        conn.execute("update sapl_houses set legislature_number = %s, legislature_start = %s, legislature_end = %s where id = %s",
                     (ln, leg["data_inicio"], leg["data_fim"], hid))
        cur = _cursors(conn, hid)
        plans = {e: entity_plan(cur.get(e), ln, now, full=full, margin=MARGIN[e]) for e in MARGIN}

        parl = list(pages(base, "parlamentares/parlamentar", max_age=0))
        upsert(conn, "sapl_parlamentares", ["house_id", "sapl_id", "nome_parlamentar", "nome_completo", "sexo", "ativo", "foto_url"],
               [(hid, int(p["id"]), (p.get("nome_parlamentar") or p.get("nome_completo") or "?").strip(), (p.get("nome_completo") or "").strip() or None,
                 (p.get("sexo") or None) and p["sexo"][:1], p.get("ativo"), p.get("fotografia")) for p in parl], ["house_id", "sapl_id"],
               update=["nome_parlamentar", "nome_completo", "sexo", "ativo", "foto_url"])
        mand = list(pages(base, "parlamentares/mandato", {"legislatura": leg["id"]}, max_age=0))
        upsert(conn, "sapl_mandatos", ["house_id", "sapl_id", "parlamentar_sapl_id", "legislature_number", "started_on", "ended_on", "titular"],
               [(hid, int(m["id"]), int(m["parlamentar"]), ln, m.get("data_inicio_mandato"), m.get("data_fim_mandato"), m.get("titular")) for m in mand],
               ["house_id", "sapl_id"])
        stats.update(parlamentares=len(parl), mandatos=len(mand))

        # ---- matérias
        types = _project_types(base)
        pl = plans["materias"]
        mats: list[tuple] = []
        keep_updated = False
        new_cur: dict[str, tuple[int | None, datetime | None]] = {}
        if pl.mode == "full":
            head = head_id(base, "materia/materialegislativa")
            for tid, (sig, name) in sorted(types.items()):
                for y in range(y0, today.year + 1):
                    for m in pages(base, "materia/materialegislativa", {"tipo": tid, "ano": y}, max_age=0):
                        row = _mat_row(hid, base, m, types, tid)
                        if row:
                            mats.append(row)
            new_cur["materias"] = (head, now)
        else:
            items, mx = scan_desc(base, "materia/materialegislativa", pl.floor)
            seen = {m["id"]: m for m in items}
            if pl.since:
                upd, ok = updated_since(base, "materia/materialegislativa", pl.since)
                if not ok:
                    log.warning("SAPL %s: edições de matéria incompletas (filtro ignorado ou truncado); last_updated não avança", house["name"])
                    keep_updated = True
                for m in upd:
                    seen.setdefault(m["id"], m)
            mats = [row for m in seen.values() if int(m.get("ano") or 0) >= y0 and (row := _mat_row(hid, base, m, types))]
            new_cur["materias"] = (mx if mx is not None else cur["materias"]["last_id"], None if keep_updated else now)
        upsert(conn, "sapl_materias", ["house_id", "sapl_id", "type_sigla", "type_name", "number", "year", "presented_on", "summary", "in_progress", "url", "text_url"],
               mats, ["house_id", "sapl_id"])
        stats["materias"] = len(mats)

        # ---- autorias (completa se as matérias foram completas: matéria antiga nova no banco precisa das suas autorias)
        pa = plans["autorias"] if pl.mode == "incremental" else Plan("full", 0, None, "matérias completas")
        known_mat = {x["sapl_id"] for x in conn.execute("select sapl_id from sapl_materias where house_id = %s", (hid,))}  # já inclui as de agora (mesma transação)
        if pa.mode == "full":
            head = head_id(base, "materia/autoria")
            aut_raw = list(pages(base, "materia/autoria", {"o": "-id"}, stop=_desc_until("materia", min(known_mat)), max_age=0)) if known_mat else []
            new_cur["autorias"] = (head, None)
        else:
            aut_raw, mx = scan_desc(base, "materia/autoria", pa.floor)
            new_cur["autorias"] = (mx if mx is not None else cur["autorias"]["last_id"], None)
        aut_rows = []
        lost = min_discarded(aut_raw, known_mat, "materia", new_cur["materias"][0])  # autoria de matéria criada durante o run
        if lost is not None:
            log.warning("SAPL %s: autoria %d de matéria criada durante o run; cursor de autorias não passa dela", house["name"], lost)
            new_cur["autorias"] = (cap_cursor(new_cur["autorias"][0], lost), None)
        aut_raw = [a for a in aut_raw if a.get("materia") in known_mat]
        if aut_raw:
            autores = {int(a["id"]): a for a in pages(base, "base/autor", max_age=0)}
            parl_ct = {int(t["id"]) for t in pages(base, "contenttypes/contenttype", {"model": "parlamentar"})}
            for a in aut_raw:
                au = autores.get(int(a["autor"])) or {}
                pid = au.get("object_id") if au.get("content_type") in parl_ct else None
                aut_rows.append((hid, int(a["materia"]), int(a["autor"]), (au.get("nome") or "").strip() or None, pid, a.get("primeiro_autor")))
        upsert(conn, "sapl_autorias", ["house_id", "materia_sapl_id", "autor_sapl_id", "autor_nome", "parlamentar_sapl_id", "primeiro_autor"], aut_rows,
               ["house_id", "materia_sapl_id", "autor_sapl_id"])
        stats["autorias"] = len(aut_rows)

        # ---- sessões (sempre inteiras: poucas páginas, pega `finalizada`) e presença
        known_sess = {x["sapl_id"] for x in conn.execute("select sapl_id from sapl_sessoes where house_id = %s", (hid,))}
        sess = list(pages(base, "sessao/sessaoplenaria", {"legislatura": leg["id"]}, max_age=0))
        upsert(conn, "sapl_sessoes", ["house_id", "sapl_id", "starts_on", "starts_time", "name", "type_id", "finished", "url"],
               [(hid, int(s["id"]), s["data_inicio"], s.get("hora_inicio") or None, (s.get("__str__") or "sessão").strip(), s.get("tipo"), s.get("finalizada"), f"{base}/sessao/{s['id']}")
                for s in sess if s.get("data_inicio")], ["house_id", "sapl_id"])
        stats["sessoes"] = len(sess)
        sess_ids = {int(s["id"]) for s in sess} | known_sess
        pp = plans["presencas"]
        if pp.mode == "incremental" and known_sess and any(int(s["id"]) < max(known_sess) for s in sess if int(s["id"]) not in known_sess):
            pp = Plan("full", 0, None, "sessão antiga cadastrada depois")  # backfill: presença dela tem id baixo
        pres = []
        if pp.mode == "full":
            head = head_id(base, "sessao/sessaoplenariapresenca")
            pres_raw = list(pages(base, "sessao/sessaoplenariapresenca", {"o": "-id"}, stop=_desc_until("sessao_plenaria", min(sess_ids)), max_age=0)) if sess_ids else []
            new_cur["presencas"] = (head, None)
        else:
            pres_raw, mx = scan_desc(base, "sessao/sessaoplenariapresenca", pp.floor)
            new_cur["presencas"] = (mx if mx is not None else cur["presencas"]["last_id"], None)
        lost = min_discarded(pres_raw, sess_ids, "sessao_plenaria", max(sess_ids) if sess_ids else None)  # sessão criada durante o run
        if lost is not None:
            log.warning("SAPL %s: presença %d de sessão criada durante o run; cursor de presenças não passa dela", house["name"], lost)
            new_cur["presencas"] = (cap_cursor(new_cur["presencas"][0], lost), None)
        for p in pres_raw:
            if p.get("sessao_plenaria") in sess_ids and p.get("parlamentar"):
                pres.append((hid, int(p["sessao_plenaria"]), int(p["parlamentar"])))
        upsert(conn, "sapl_presencas", ["house_id", "sessao_sapl_id", "parlamentar_sapl_id"], pres, ["house_id", "sessao_sapl_id", "parlamentar_sapl_id"], update=[])
        stats["presencas"] = len(pres)

        # ---- votos nominais
        pv = plans["votos"]
        if pv.mode == "full":
            head = head_id(base, "sessao/votoparlamentar")
            votos_raw = list(pages(base, "sessao/votoparlamentar", {"o": "-id"}, max_age=0,
                                   stop=lambda res: bool(res) and all((x.get("data_hora") or "9999") < leg["data_inicio"] for x in res)))
            new_cur["votos"] = (head, None)
        else:
            votos_raw, mx = scan_desc(base, "sessao/votoparlamentar", pv.floor)
            new_cur["votos"] = (mx if mx is not None else cur["votos"]["last_id"], None)
        votos = [(hid, int(v["id"]), int(v["votacao"]), int(v["parlamentar"]), (v.get("voto") or "?").strip(), v.get("data_hora"), (v.get("__str__") or "")[:2000] or None)
                 for v in votos_raw if (v.get("data_hora") or "") >= leg["data_inicio"] and v.get("parlamentar") and v.get("votacao")]
        upsert(conn, "sapl_votos", ["house_id", "sapl_id", "votacao_sapl_id", "parlamentar_sapl_id", "voto", "voted_at", "description"], votos, ["house_id", "sapl_id"])
        stats["votos"] = len(votos)

        final = {"materias": pl, "autorias": pa, "presencas": pp, "votos": pv}
        for e, (lid, lu) in new_cur.items():
            _save_cursor(conn, hid, e, lid, lu, ln, final[e], now)
        log.info("SAPL %s: modos %s", house["name"], {e: f"{p.mode} ({p.why})" for e, p in final.items()})

        stats.update(match_vereadores(conn, house, leg))
        conn.execute("update sapl_houses set loaded_at = now(), last_attempt_at = now(), last_outcome = 'carregada', note = null, fail_count = 0, retry_after = null where id = %s", (hid,))
        r.add(sum(stats.values()))
        if stats.get("ambiguo") or stats.get("sem_candidato"):
            r.reject(stats.get("ambiguo", 0) + stats.get("sem_candidato", 0), "vereadores sem casamento único com o TSE (ver sapl_parlamentares.match_note)")
    set_coverage(conn, house, {**stats, **house_totals(conn, hid)})
    return stats


# ------------------------------------------------------------------ casamento com o TSE


def match_names(sapl: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[str, str | None, str]:
    """(status, person_id, nota). Candidatos = pessoas com mandato de vereador no município na legislatura."""
    np_, nc = fold(sapl.get("nome_parlamentar")), fold(sapl.get("nome_completo"))
    hits = {c["person_id"] for c in candidates
            if (np_ and fold(c.get("display_name")) == np_) or (nc and fold(c.get("civil_name")) == nc)}
    if len(hits) == 1:
        return "casado", next(iter(hits)), "nome de urna ou nome civil igual, mesmo município e legislatura"
    if len(hits) > 1:
        return "ambiguo", None, f"{len(hits)} pessoas do TSE com o mesmo nome no município e legislatura"
    return "sem_candidato", None, "nenhum vereador eleito do TSE com esse nome no município e legislatura (suplente? nome diferente?)"


def match_vereadores(conn: psycopg.Connection, house: dict[str, Any], leg: dict[str, Any]) -> dict[str, int]:
    """Casa parlamentar do SAPL com pessoa do TSE. Câmara: vereador do município. Assembleia (place = UF, D09): deputado estadual da UF."""
    hid = house["id"]
    if house.get("kind") == "uf":
        cands = [dict(r) for r in conn.execute(
            """select distinct m.person_id::text as person_id, p.display_name, p.civil_name
               from mandates m join offices o on o.id = m.office_id and o.slug = 'deputado_estadual' join people p on p.id = m.person_id
               join places pl on pl.id = m.place_id
               where pl.uf = %s and m.status <> 'eleito_aguardando_posse' and m.started_on < %s::date and m.ends_on > %s::date""",
            (house["uf"], leg["data_fim"], leg["data_inicio"]))]
    else:
        cands = [dict(r) for r in conn.execute(
            """select distinct m.person_id::text as person_id, p.display_name, p.civil_name
               from mandates m join offices o on o.id = m.office_id and o.slug = 'vereador' join people p on p.id = m.person_id
               where m.place_id = %s and m.started_on < %s::date and m.ends_on > %s::date""",
            (house["place_id"], leg["data_fim"], leg["data_inicio"]))]
    in_leg = {r["parlamentar_sapl_id"] for r in conn.execute("select distinct parlamentar_sapl_id from sapl_mandatos where house_id = %s and legislature_number = %s",
                                                              (hid, leg.get("numero")))}
    count: dict[str, int] = {}
    for p in conn.execute("select sapl_id, nome_parlamentar, nome_completo from sapl_parlamentares where house_id = %s", (hid,)).fetchall():
        if p["sapl_id"] in in_leg:
            st, pid, note = match_names(p, cands)
        else:
            st, pid, note = "fora_da_legislatura", None, "sem mandato na legislatura atual no SAPL; não casado"
        conn.execute("update sapl_parlamentares set person_id = %s, match_status = %s, match_note = %s where house_id = %s and sapl_id = %s",
                     (pid, st, note, hid, p["sapl_id"]))
        count[st] = count.get(st, 0) + 1
        if st in ("ambiguo", "sem_candidato"):
            log.warning("SAPL %s: %s (%s) %s: %s", house["name"], p["nome_parlamentar"], p["sapl_id"], st, note)
    return count


# ------------------------------------------------------------------ cobertura


def set_coverage(conn: psycopg.Connection, house: dict[str, Any], stats: dict[str, int]) -> None:
    """data_coverage da cidade (D129) ou da UF (D09): 'carregando' = lido pelo ETL e guardado; aparece no crachá do parlamentar. Sem linha na fonte
    não vira 'nao_publica' (a casa pode publicar fora do SAPL): fica 'desconhecido' com o motivo."""
    url = house["base_url"]
    today = date.today()
    _ds, _src, casa = house_ids(house)
    onde = "crachá de vereador (bloco da Câmara Municipal)" if casa == "Câmara Municipal" else "crachá de deputado estadual (bloco da Assembleia)"
    sets = {
        "propostas": ("carregando", f"projetos da legislatura atual lidos do SAPL da {casa} ({stats.get('materias', 0)}); aparece no {onde}", f"{url}/materia/pesquisar-materia"),
        "presenca": (("carregando", f"presença em sessão plenária lida do SAPL ({stats.get('presencas', 0)} registros); aparece no {onde}") if stats.get("presencas")
                     else ("desconhecido", f"o SAPL da {casa} não tem presença registrada nesta legislatura")) + (f"{url}/sessao/pesquisar-sessao",),
        "votos": (("carregando", f"votos nominais lidos do SAPL ({stats.get('votos', 0)}); aparece no {onde}") if stats.get("votos")
                  else ("desconhecido", f"o SAPL da {casa} não tem voto nominal registrado nesta legislatura")) + (f"{url}/sessao/pesquisar-sessao",),
    }
    upsert(conn, "data_coverage", ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"],
           [(house["place_id"], ds, st, reason, ev, today) for ds, (st, reason, ev) in sets.items()], ["place_id", "dataset"])
    conn.commit()


# ------------------------------------------------------------------ Assembleias com SAPL (D09)


def discover_ales(conn: psycopg.Connection, ufs: list[str]) -> list[dict[str, Any]]:
    """Registra a casa de cada UF em sapl_houses (place_id = UF) depois de conferir que {url}/api/ é o índice do SAPL 3.x. A URL vem de ALE_SAPL."""
    out = []
    upsert(conn, "sources", ["slug", "name", "url", "license"],
           [(ALE_SOURCE, "SAPL das Assembleias Legislativas (Interlegis)", "https://www.interlegis.leg.br/produtos/sapl", None)], ["slug"])
    with run(conn, f"{ALE_SOURCE}.descoberta", ALE_SOURCE) as r:
        for uf in ufs:
            base = ALE_SAPL.get(uf)
            row = conn.execute(
                """select p.id as place_id, b.id as body_id from places p
                   left join legislative_bodies b on b.place_id = p.id and b.kind in ('assembleia', 'camara_legislativa_df')
                   where p.kind = 'uf' and p.uf = %s""", (uf,)).fetchone()
            if not base or not row or not row["body_id"]:
                r.reject(1, f"{uf}: sem URL de SAPL cadastrada em ALE_SAPL ou sem Assembleia em legislative_bodies")
                continue
            status, note = "ok", None
            try:
                status = "ok" if is_sapl_api(_get(f"{base}/api/", max_age=DAY)) else "sem_api"
                if status == "sem_api":
                    note = "a URL responde, mas sem a API REST do SAPL 3.x"
            except Blocked as e:
                status, note = "robots_bloqueia", str(e)[:500]
            except Exception as e:  # noqa: BLE001
                status, note = ("sem_api" if isinstance(e, FileNotFoundError) else "fora_do_ar"), f"{type(e).__name__}: {e}"[:500]
            log.info("SAPL Assembleia %s: %s %s", uf, status, note or "")
            upsert(conn, "sapl_houses", ["place_id", "body_id", "base_url", "registry_url", "registry_status", "status", "note", "checked_at"],
                   [(str(row["place_id"]), str(row["body_id"]), base, base, "conferido à mão em 09/11/2026", status, note, db.now_utc())], ["place_id"],
                   update=["body_id", "base_url", "status", "note", "checked_at"])
            conn.execute("update legislative_bodies set adapter = 'sapl', open_data_url = %s, updated_at = now() where id = %s and (adapter <> 'sapl' or open_data_url is distinct from %s)",
                         (base, row["body_id"], base))
            out.append({"uf": uf, "status": status})
        conn.commit()
        r.add(len(out))
    return out


# ------------------------------------------------------------------ CLI


def _scope(conn: psycopg.Connection, escopo: str) -> list[str]:
    if escopo == "capitais":
        return sorted(CAPITAIS)
    return [r["ibge_code"] for r in conn.execute("select ibge_code from places where kind = 'municipio' and ibge_code is not null order by ibge_code")]


_STATE_COLS = "h.status, h.checked_at, h.last_attempt_at, h.loaded_at, h.retry_after, h.fail_count"


def _state(conn: psycopg.Connection, codes: list[str], *, ales: bool = False) -> dict[str, dict[str, Any]]:
    """Estado das casas por código (IBGE do município; sigla da UF para Assembleia)."""
    key, where = ("pl.uf", "pl.kind = 'uf'") if ales else ("pl.ibge_code", "pl.kind = 'municipio'")
    return {r["code"]: dict(r) for r in conn.execute(
        f"select {key} as code, {_STATE_COLS} from sapl_houses h join places pl on pl.id = h.place_id where {where} and {key} = any(%s)", (codes,))}


def _load_one(code: str, ales: bool, full: bool, t0: float, orcamento_min: float | None, casa_max_min: float) -> str:
    """Carrega uma câmara numa conexão própria (roda em worker). Devolve 'ok' | 'falhou' | 'pulada' | 'adiada' (orçamento esgotado)."""
    if orcamento_min and (time.monotonic() - t0) / 60 > orcamento_min:
        return "adiada"
    conn = db.connect()
    key, kind = ("pl.uf", "uf") if ales else ("pl.ibge_code", "municipio")
    try:
        h = dict(conn.execute(f"select h.*, pl.ibge_code, pl.name, pl.uf, pl.kind from sapl_houses h join places pl on pl.id = h.place_id where pl.kind = %s and {key} = %s", (kind, code)).fetchone())
        t1 = time.monotonic()
        conn.execute("update sapl_houses set last_attempt_at = now() where id = %s", (h["id"],))
        conn.commit()  # se o processo for morto no timeout, a câmara vai para o fim da fila, não para a cabeça
        _local.deadline, _local.limit_min = t1 + casa_max_min * 60, casa_max_min
        try:
            s = load_house(conn, h, full=full)
            conn.execute("update sapl_houses set last_duration_s = %s where id = %s", (int(time.monotonic() - t1), h["id"]))
            conn.commit()
            log.info("SAPL %s em %.0fs: %s", h["name"], time.monotonic() - t1, s)
            return "ok"
        except SkipUnchanged:
            return "pulada"  # condição da fonte (ex.: sem legislatura vigente): já registrada como cobertura
        except Exception as e:  # noqa: BLE001 - uma câmara fora do ar não derruba as outras
            conn.rollback()
            log.error("SAPL %s falhou: %s", h["name"], e)
            n = int(h.get("fail_count") or 0) + 1
            conn.execute(
                "update sapl_houses set note = %s, last_attempt_at = now(), last_outcome = 'falhou', fail_count = %s, retry_after = %s, last_duration_s = %s where id = %s",
                (f"carga falhou em {date.today()} (falha {n} seguida): {e}"[:500], n, backoff_until(n, datetime.now(timezone.utc)), int(time.monotonic() - t1), h["id"]))
            conn.commit()
            return "falhou"
        finally:
            _local.deadline = None
    finally:
        conn.close()


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl sapl.*")
    p.add_argument("job", choices=["sapl.descobrir", "sapl.carregar", "sapl.todas", "sapl.ales"])
    p.add_argument("--ibge", action="append", help="código IBGE do município (repetível); padrão: o escopo")
    p.add_argument("--uf", action="append", help="sapl.ales: sigla da UF (repetível); padrão: todas em ALE_SAPL")
    p.add_argument("--escopo", choices=["capitais", "todas"], default="capitais", help="capitais (padrão) ou todos os municípios (descoberta em lotes)")
    p.add_argument("--lote", type=int, help="no máximo N câmaras por execução (carregar); sem --offset segue a fila (nunca tentadas, depois a tentativa mais antiga)")
    p.add_argument("--lote-descoberta", type=int, help="no máximo N câmaras novas descobertas por execução (padrão: --lote)")
    p.add_argument("--offset", type=int, help="com --lote: janela fixa [offset, offset+lote) do escopo ordenado por IBGE")
    p.add_argument("--max", type=int, default=10, help="carregar no máximo N câmaras 'ok' (padrão 10; --lote tem precedência)")
    p.add_argument("--max-pendentes", type=int, default=MAX_PENDING_OK, help="não descobre mais enquanto houver N câmaras 'ok' ainda nunca carregadas")
    p.add_argument("--full", action="store_true", help="carga completa (ignora os cursores)")
    p.add_argument("--orcamento-min", type=float, help="não começa nova câmara depois de M minutos")
    p.add_argument("--casa-max-min", type=float, default=HOUSE_MAX_MIN, help="prazo de uma câmara; estourou = falha com backoff (padrão 25)")
    p.add_argument("--workers", type=int, default=1, help="câmaras em paralelo (hosts distintos; o intervalo de 1,1 s por host continua valendo)")
    a = p.parse_args(argv)
    conn = db.connect()
    failed = 0
    t0 = time.monotonic()
    ales = a.job == "sapl.ales"
    try:
        limit = a.lote or a.max
        now = datetime.now(timezone.utc)
        if ales:
            scope = [u.upper() for u in (a.uf or ALE_SAPL)]
            discover_ales(conn, scope)
            todo_discover = []
        elif a.ibge:
            scope = list(a.ibge)
            todo_discover = scope
        else:
            scope = _scope(conn, a.escopo)
            if a.offset is not None:
                scope = window(scope, a.lote, a.offset)
            st0 = _state(conn, scope)
            dlim = a.lote_descoberta or a.lote
            todo_discover = to_discover(scope, st0, now, dlim if a.offset is not None else discover_budget(dlim, st0, a.max_pendentes))
            if not todo_discover and any(c not in st0 for c in scope):
                log.info("SAPL: descoberta pausada (>= %d câmaras 'ok' ainda sem carga); a fila de carga drena primeiro", a.max_pendentes)
        if a.job in ("sapl.descobrir", "sapl.todas") and todo_discover:
            discover(conn, todo_discover)
        if a.job in ("sapl.carregar", "sapl.todas", "sapl.ales"):
            state = _state(conn, scope, ales=ales)
            order = load_queue(scope, state, limit, now)
            if a.ibge:  # explícito: ordem por nome, como antes
                order = [c for c in scope if (state.get(c) or {}).get("status") == "ok"][:limit]
            if not order:
                log.info("SAPL: nenhuma câmara 'ok' na fila deste lote (em backoff ou já em dia)")
            conn.commit()
            with ThreadPoolExecutor(max_workers=max(a.workers, 1)) as ex:
                results = list(ex.map(lambda c: _load_one(c, ales, a.full, t0, a.orcamento_min, a.casa_max_min), order))
            failed = results.count("falhou")
            if "adiada" in results:
                log.info("SAPL: orçamento de %.0f min esgotado; %d câmaras ficam para o próximo lote", a.orcamento_min or 0, results.count("adiada"))
            log.info("SAPL: %s", {k: results.count(k) for k in sorted(set(results))})
    finally:
        conn.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
