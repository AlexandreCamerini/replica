"""etl.pauta: pauta do plenário e das comissões da Câmara e do Senado, de hoje até hoje + 14 dias.

Fontes (testadas em 03/11/2026, ver canvas "No seu bolso" › B2):
  Câmara  /api/v2/eventos?dataInicio&dataFim        -> reuniões deliberativas (PLEN = plenário)
          /api/v2/eventos/{id}/pauta                -> itens; parecer (PRL/PAR) sobe para a proposição relacionada
          /api/v2/proposicoes/{id}/temas            -> temas oficiais, para a Regra 1 (pocket_rules)
  Senado  /dadosabertos/plenario/agenda/mes/{AAAAMMDD} -> sessões e matérias com ementa
          /dadosabertos/comissao/agenda/{ini}/{fim}    -> itens de comissão (sem ementa; fora do número, D1)
A pauta da Câmara falha com frequência (504, leitura incompleta). Cada evento que não carrega depois das
retentativas de http.fetch entra em pauta_reads.failed_refs; a tela mostra "pelo menos N" (D5). Nada é inventado.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import psycopg

from ..db import run, upsert
from ..http import fetch_json, paginate_camara
from ..util import nz, parse_ts
from .camara_diario import LAW_TYPES

log = logging.getLogger("etl.pauta")
CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
SENADO = "https://legis.senado.leg.br/dadosabertos"
BRT = ZoneInfo("America/Sao_Paulo")
WINDOW_DAYS = 14
CAMARA_SKIP = ("Cancelada", "Encerrada", "Encerrada (Termo)", "Encerrada (Final)")
SENADO_SKIP = ("Cancelada", "Realizada", "Encerrada")
NAME_RE = re.compile(r"^\s*(?:\d+\s*-\s*)?([A-Z]{2,4})\s+(\d+)/(\d{4})\b")


def _list(x: Any) -> list[Any]:
    return x if isinstance(x, list) else ([x] if x else [])


def _brt(ts: datetime | None) -> datetime | None:
    return ts.replace(tzinfo=BRT) if ts and ts.tzinfo is None else ts


def resolve_camara_item(it: dict[str, Any]) -> dict[str, Any] | None:
    """Item de pauta -> a proposição que vira lei. Parecer (PRL, PAR) e requerimento sobre lei sobem para a relacionada."""
    for k in ("proposicao_", "proposicaoRelacionada_"):
        p = it.get(k) or {}
        if p.get("siglaTipo") in LAW_TYPES:
            return p
    return None


def parse_senado_name(name: str | None) -> tuple[str, int, int] | None:
    """'6 - PL 5861/2025' -> ('PL', 5861, 2025). Outros formatos (REQ com comissão, ofícios) -> None se não for lei."""
    m = NAME_RE.match(name or "")
    if not m or m.group(1) not in LAW_TYPES:
        return None
    return m.group(1), int(m.group(2)), int(m.group(3))


def run_pauta(conn: psycopg.Connection, *, today: date | None = None) -> None:
    today = today or datetime.now(BRT).date()
    end = today + timedelta(days=WINDOW_DAYS)
    bodies = {r["kind"]: str(r["id"]) for r in conn.execute("select kind, id from legislative_bodies where kind in ('camara_deputados','senado')")}
    _camara(conn, bodies["camara_deputados"], today, end)
    _senado(conn, bodies["senado"], today, end)


def _save(conn: psycopg.Connection, r, body_id: str, start: date, end: date, total: int, failed: list[str], items: list[dict[str, Any]]) -> None:
    read_id = str(
        conn.execute(
            """insert into pauta_reads (body_id, run_id, window_start, window_end, events_total, events_failed, failed_refs)
               values (%s, %s, %s, %s, %s, %s, %s) returning id""",
            (body_id, r.id, start, end, total, len(failed), failed),
        ).fetchone()["id"]
    )
    props = {
        (x["type"], x["number"], x["year"]): str(x["id"])
        for x in conn.execute("select type, number, year, id from proposals where body_id = %s", (body_id,))
    }
    rows = [
        (
            read_id, body_id, props.get((i["prop_type"], i["prop_number"], i["prop_year"])), i["prop_type"], i["prop_number"], i["prop_year"],
            i.get("summary"), i.get("themes") or [], i["stage"], i.get("committee"), i["scheduled_for"], i.get("regime"),
            i.get("rapporteur"), i["event_ref"], i.get("url"),
        )
        for i in items
    ]
    upsert(
        conn, "pauta_items",
        ["read_id", "body_id", "proposal_id", "prop_type", "prop_number", "prop_year", "summary_official", "official_themes", "stage",
         "committee", "scheduled_for", "regime", "rapporteur", "event_ref", "official_url"],
        rows, ["read_id", "prop_type", "prop_number", "prop_year", "event_ref"],
    )
    r.add(len(rows))
    if failed:
        r.notes.append(f"{len(failed)} de {total} pautas não carregaram: {', '.join(failed[:20])}")


def _camara(conn: psycopg.Connection, body_id: str, start: date, end: date) -> None:
    with run(conn, "pauta.camara", "camara") as r:
        events = [
            e for e in paginate_camara(f"{CAMARA}/eventos?dataInicio={start}&dataFim={end}&itens=100&ordem=ASC&ordenarPor=dataHoraInicio")
            if "Deliberativa" in (e.get("descricaoTipo") or "") and "Não Deliberativa" not in e["descricaoTipo"] and e.get("situacao") not in CAMARA_SKIP
        ]
        failed: list[str] = []
        items: list[dict[str, Any]] = []
        themes: dict[int, list[str]] = {}
        for e in events:
            try:
                pauta = fetch_json(f"{CAMARA}/eventos/{e['id']}/pauta").get("dados", [])
            except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
                log.warning("pauta do evento %s não carregou: %s", e["id"], x)
                failed.append(str(e["id"]))
                continue
            orgs = [o.get("sigla") for o in e.get("orgaos") or []]
            plen = "PLEN" in orgs
            for it in pauta:
                p = resolve_camara_item(it)
                if not p:
                    continue
                pid = int(p["id"])
                if pid not in themes:
                    try:
                        themes[pid] = [t["tema"] for t in fetch_json(f"{CAMARA}/proposicoes/{pid}/temas", max_age=7 * 86400).get("dados", [])]
                    except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
                        log.warning("temas da proposição %s não carregaram: %s", pid, x)
                        themes[pid] = []
                items.append({
                    "prop_type": p["siglaTipo"], "prop_number": int(p["numero"]), "prop_year": int(p["ano"]),
                    "summary": nz(p.get("ementa")), "themes": themes[pid],
                    "stage": "plenario" if plen else "comissao", "committee": None if plen else (orgs[0] if orgs else None),
                    "scheduled_for": _brt(parse_ts(e["dataHoraInicio"])), "regime": nz(it.get("regime")),
                    "rapporteur": (it.get("relator") or {}).get("nome"), "event_ref": str(e["id"]),
                    "url": f"https://www.camara.leg.br/evento-legislativo/{e['id']}",
                })
        _save(conn, r, body_id, start, end, len(events), failed, items)


def _senado(conn: psycopg.Connection, body_id: str, start: date, end: date) -> None:
    with run(conn, "pauta.senado", "senado") as r:
        failed: list[str] = []
        items: list[dict[str, Any]] = []
        total = 0
        months = sorted({start.replace(day=1), end.replace(day=1)})
        for m in months:
            try:
                sess = _list((fetch_json(f"{SENADO}/plenario/agenda/mes/{m:%Y%m%d}.json").get("AgendaPlenario") or {}).get("Sessoes", {}).get("Sessao"))
            except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
                log.warning("agenda do plenário %s não carregou: %s", m, x)
                failed.append(f"plenario:{m:%Y-%m}")
                continue
            for s in sess:
                d = date.fromisoformat(s["Data"])
                if not (start <= d <= end) or "DELIBERATIVA" not in (s.get("TipoSessao") or "") or "NÃO DELIBERATIVA" in s["TipoSessao"]:
                    continue
                total += 1
                when = _brt(datetime.fromisoformat(f"{s['Data']}T{(s.get('Hora') or '00:00').strip()}"))
                for mt in _list((s.get("Materias") or {}).get("Materia")):
                    if mt.get("SiglaMateria") not in LAW_TYPES:
                        continue
                    items.append({
                        "prop_type": mt["SiglaMateria"], "prop_number": int(mt["NumeroMateria"]), "prop_year": int(mt["AnoMateria"]),
                        "summary": nz(mt.get("Ementa")), "stage": "plenario", "scheduled_for": when,
                        "regime": nz(mt.get("Apreciacao")), "event_ref": str(s["CodigoSessao"]),
                        "url": f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{mt['CodigoMateria']}",
                    })
        try:
            reunioes = _list((fetch_json(f"{SENADO}/comissao/agenda/{start:%Y%m%d}/{end:%Y%m%d}.json").get("AgendaReuniao") or {}).get("reunioes", {}).get("reuniao"))
        except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
            log.warning("agenda das comissões não carregou: %s", x)
            failed.append("comissoes")
            reunioes = []
        for re_ in reunioes:
            if re_.get("situacao") in SENADO_SKIP:
                continue
            total += 1
            sigla = (re_.get("colegiadoCriador") or {}).get("sigla")
            when = _brt(parse_ts(re_.get("dataInicio")))
            for pt in _list(re_.get("partes")):
                for it in _list(pt.get("itens") if isinstance(pt, dict) else None):
                    key = parse_senado_name(it.get("nome")) if isinstance(it, dict) else None
                    if not key or not when:
                        continue
                    items.append({
                        "prop_type": key[0], "prop_number": key[1], "prop_year": key[2], "stage": "comissao", "committee": sigla,
                        "scheduled_for": when, "event_ref": f"reuniao:{re_['codigo']}",
                    })
        _save(conn, r, body_id, start, end, total, failed, items)
