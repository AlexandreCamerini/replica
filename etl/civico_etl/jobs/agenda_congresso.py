"""etl agenda.congresso: agenda e pauta de plenário da Câmara e do Senado (D125). Sem tela por enquanto.

Fontes oficiais:
  Câmara  /api/v2/eventos?idOrgao=180&dataInicio=&dataFim=   -> eventos do Plenário (sessões deliberativas, solenes, debates)
          /api/v2/eventos/{id}/pauta                          -> itens da pauta (proposição, regime, relator, situação do item)
  Senado  /dadosabertos/plenario/agenda/mes/{AAAAMMDD}.json  -> sessões do mês (SF e CN) com as matérias da pauta

Janela padrão: do 1º dia do mês passado ao fim do mês seguinte (pauta muda até a sessão; o passado recente fixa o resultado).
`--year` carrega o ano inteiro (backfill). Itens de um evento relido são substituídos pelo que a fonte publica agora.
Nada é deduzido: tipo, situação e resultado do item ficam como a fonte escreve.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch_json, paginate_camara
from ..util import nz

log = logging.getLogger("etl.agenda")
CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
SENADO = "https://legis.senado.leg.br/dadosabertos"
PLEN_CAMARA = 180
BRT = ZoneInfo("America/Sao_Paulo")


def _list(x: Any) -> list[Any]:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _int(s: Any) -> int | None:
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return None


def brt(day: str, hhmm: str | None) -> datetime:
    """'2026-11-03' + '14:00' em horário de Brasília -> datetime com fuso (D125: a fonte publica hora local sem fuso)."""
    d = date.fromisoformat(day[:10])
    h, m = 0, 0
    if hhmm and ":" in hhmm:
        h, m = (int(x) for x in hhmm.strip()[:5].split(":"))
    return datetime(d.year, d.month, d.day, h, m, tzinfo=BRT)


def window(today: date, years: list[int] | None) -> list[tuple[date, date]]:
    if years:
        return [(date(y, 1, 1), date(y, 12, 31)) for y in sorted(years)]
    first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    end = (nxt.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return [(first, end)]


def months(a: date, b: date) -> list[date]:
    out, d = [], a.replace(day=1)
    while d <= b:
        out.append(d)
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


# ------------------------------------------------------------------ parsing (puro, testado)


def camara_event(e: dict[str, Any]) -> dict[str, Any]:
    local = e.get("localCamara") or {}
    return {
        "source_key": str(e["id"]),
        "starts_at": brt(e["dataHoraInicio"][:10], e["dataHoraInicio"][11:16]),
        "kind": (e.get("descricaoTipo") or "evento").strip(),
        "title": nz((e.get("descricao") or "").strip()),
        "status": (e.get("situacao") or "—").strip(),
        "location": nz(local.get("nome") or e.get("localExterno")),
        "official_url": nz(e.get("urlRegistro")),
        "source_url": f"{CAMARA}/eventos/{e['id']}",
    }


def camara_items(pauta: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out, seen = [], set()
    for it in pauta:
        p = it.get("proposicao_") or {}
        pos = _int(it.get("ordem")) or len(out) + 1
        while pos in seen:  # a fonte repete "ordem" em itens retirados e reincluídos
            pos += 1000
        seen.add(pos)
        rel = it.get("relator") or {}
        out.append({
            "position": pos,
            "proposal_type": nz(p.get("siglaTipo")),
            "proposal_number": _int(p.get("numero")),
            "proposal_year": _int(p.get("ano")),
            "source_proposal_id": str(p["id"]) if p.get("id") else None,
            "title": (it.get("titulo") or (f"{p.get('siglaTipo')} {p.get('numero')}/{p.get('ano')}" if p else "item")).strip(),
            "summary": nz(p.get("ementa")),
            "topic": nz(it.get("topico")),
            "regime": nz(it.get("regime")),
            "rapporteur": nz(rel.get("nome")) if isinstance(rel, dict) else None,
            "outcome_text": nz(it.get("situacaoItem")),
        })
    return out


def senado_session(s: dict[str, Any]) -> dict[str, Any]:
    casa = (s.get("Casa") or "SF").upper()
    num = (s.get("NumeroSessao") or "").strip()
    tipo = (s.get("TipoSessao") or "sessão").strip()
    evento = (s.get("Evento") or {}) if isinstance(s.get("Evento"), dict) else {}
    return {
        "house": "congresso" if casa == "CN" else "senado",
        "source_key": str(s["CodigoSessao"]),
        "starts_at": brt(s["Data"], s.get("Hora")),
        "kind": tipo,
        "title": nz(" · ".join(x for x in (num, nz(evento.get("DescricaoEvento"))) if x)),
        "status": (s.get("SituacaoSessao") or "—").strip(),
        "location": nz(s.get("LocalSessao")),
        "official_url": f"https://www25.senado.leg.br/web/atividade/sessao-plenaria/-/pauta/{s['CodigoSessao']}",
    }


def senado_items(s: dict[str, Any]) -> list[dict[str, Any]]:
    out, seen = [], set()
    for m in _list((s.get("Materias") or {}).get("Materia")):
        pos = _int(m.get("SequenciaOrdem")) or len(out) + 1
        while pos in seen:
            pos += 1000
        seen.add(pos)
        out.append({
            "position": pos,
            "proposal_type": nz(m.get("SiglaMateria")),
            "proposal_number": _int(m.get("NumeroMateria")),
            "proposal_year": _int(m.get("AnoMateria")),
            "source_proposal_id": nz(m.get("CodigoMateria")),
            "title": (m.get("DescricaoIdentificacaoMateria") or m.get("Identificacao") or "matéria").strip(),
            "summary": nz((m.get("Ementa") or "").strip()),
            "topic": nz(m.get("DescricaoTipoPauta")),
            "regime": nz((m.get("Apreciacao") or "").strip()),
            "rapporteur": nz(m.get("NomeRelator")),
            "outcome_text": nz(m.get("DescricaoResultado") or m.get("Resultado")),
        })
    return out


# ------------------------------------------------------------------ carga


def _save(conn: psycopg.Connection, r, body: str, house_default: str, events: list[tuple[dict[str, Any], list[dict[str, Any]] | None]]) -> None:
    if not events:
        return
    ev_cols = ["body_id", "house", "source_key", "starts_at", "kind", "title", "status", "location", "official_url", "source_url"]
    rows = [(body, e.get("house", house_default), e["source_key"], e["starts_at"], e["kind"], e["title"], e["status"], e["location"], e["official_url"], e["source_url"])
            for e, _ in events]
    ids = {(x["house"], x["source_key"]): x["id"] for x in upsert(conn, "agenda_events", ev_cols, rows, ["house", "source_key"], returning=["id", "house", "source_key"])}
    r.add(len(ids))
    # vínculo com a sessão realizada (mesmo código na fonte)
    conn.execute(
        """update agenda_events a set session_id = s.id from sessions s
           where s.body_id = a.body_id and s.source_key = a.source_key and a.id = any(%s) and a.session_id is distinct from s.id""",
        (list(ids.values()),),
    )
    props = {(row["type"], row["number"], row["year"]): row["id"] for row in conn.execute("select id, type, number, year from proposals where body_id = %s", (body,))}
    item_cols = ["agenda_event_id", "position", "proposal_id", "proposal_type", "proposal_number", "proposal_year", "source_proposal_id", "title", "summary",
                 "topic", "regime", "rapporteur", "outcome_text"]
    item_rows, refreshed = [], []
    for e, items in events:
        if items is None:  # pauta não lida (erro na fonte): mantém a que já havia
            continue
        eid = ids[(e.get("house", house_default), e["source_key"])]
        refreshed.append(eid)
        for it in items:
            pid = props.get((it["proposal_type"], it["proposal_number"], it["proposal_year"]))
            item_rows.append((eid, it["position"], pid, it["proposal_type"], it["proposal_number"], it["proposal_year"], it["source_proposal_id"], it["title"][:2000],
                              (it["summary"] or None) and it["summary"][:4000], it["topic"], it["regime"], it["rapporteur"], it["outcome_text"] and it["outcome_text"][:4000]))
    if refreshed:
        # a pauta publicada agora substitui a anterior (item retirado some); só eventos relidos com sucesso
        keep = {(row[0], row[1]) for row in item_rows}
        old = conn.execute("select id, agenda_event_id, position from agenda_items where agenda_event_id = any(%s)", (refreshed,)).fetchall()
        gone = [o["id"] for o in old if (o["agenda_event_id"], o["position"]) not in keep]
        if gone:
            conn.execute("delete from agenda_items where id = any(%s)", (gone,))
    r.add(len(upsert(conn, "agenda_items", item_cols, item_rows, ["agenda_event_id", "position"], returning=["id"])))


def run_camara_agenda(conn: psycopg.Connection, a: date, b: date, *, force: bool) -> None:
    body = str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])
    try:
        with run(conn, f"agenda.camara.{a:%Y%m%d}-{b:%Y%m%d}", "camara", force=force) as r:
            events = []
            for e in paginate_camara(f"{CAMARA}/eventos?idOrgao={PLEN_CAMARA}&dataInicio={a}&dataFim={b}&itens=100", max_age=3600):
                ev = camara_event(e)
                try:
                    pauta = fetch_json(f"{CAMARA}/eventos/{e['id']}/pauta", max_age=3600 if ev["starts_at"].date() >= date.today() - timedelta(days=7) else 30 * 86400)
                    items = camara_items(pauta.get("dados") or [])
                except FileNotFoundError:
                    items = []
                except Exception as err:  # noqa: BLE001 - pauta falhou: evento entra, itens antigos ficam
                    r.reject(1, f"pauta do evento {e['id']}: {err}")
                    items = None
                events.append((ev, items))
            _save(conn, r, body, "camara", events)
            log.info("agenda câmara %s–%s: %d eventos de plenário, %d itens", a, b, len(events), sum(len(i or []) for _, i in events))
    except SkipUnchanged:
        pass


def run_senado_agenda(conn: psycopg.Connection, a: date, b: date, *, force: bool) -> None:
    body = str(conn.execute("select id from legislative_bodies where kind = 'senado'").fetchone()["id"])
    for m in months(a, b):
        try:
            with run(conn, f"agenda.senado.{m:%Y%m}", "senado", force=force) as r:
                url = f"{SENADO}/plenario/agenda/mes/{m:%Y%m%d}.json"
                try:
                    data = fetch_json(url, max_age=3600 if m >= date.today().replace(day=1) - timedelta(days=40) else 30 * 86400)
                except FileNotFoundError:
                    data = {}
                sess = _list(((data.get("AgendaPlenario") or {}).get("Sessoes") or {}).get("Sessao"))
                events = []
                for s in sess:
                    if not s.get("CodigoSessao") or not s.get("Data"):
                        r.reject(1, "sessão sem código ou data")
                        continue
                    ev = senado_session(s)
                    ev["source_url"] = url
                    events.append((ev, senado_items(s)))
                _save(conn, r, body, "senado", events)
                log.info("agenda senado %s: %d sessões (SF+CN), %d matérias", f"{m:%Y-%m}", len(events), sum(len(i or []) for _, i in events))
        except SkipUnchanged:
            continue


def run_agenda(conn: psycopg.Connection, *, years: list[int] | None, force: bool) -> None:
    for a, b in window(date.today(), years):
        run_camara_agenda(conn, a, b, force=force)
        run_senado_agenda(conn, a, b, force=force)
