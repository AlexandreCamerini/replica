"""etl.camara.presenca: presença OFICIAL em sessões deliberativas do Plenário da Câmara (substitui a presença derivada de voto).

Fontes (dadosabertos.camara.leg.br/arquivos, CC0):
  eventos/csv/eventos-{ano}.csv                                  -> sessões (descricaoTipo = 'Sessão Deliberativa', situação encerrada)
  eventosOrgaos/csv/eventosOrgaos-{ano}.csv                      -> só eventos do órgão PLEN (exclui sessões do Congresso, CN)
  eventosPresencaDeputados/csv/eventosPresencaDeputados-{ano}.csv -> quem registrou presença em cada evento
  API v2 /deputados?idLegislatura=N e /deputados/{id}/historico   -> períodos de exercício (posse, licença, afastamento, saída)

Regra (publicada em replica/backend.md):
  sessão = Sessão Deliberativa do Plenário, encerrada (não conta solene, não deliberativa, reunião de comissão, sessão do Congresso);
  presente = está na lista de presença do evento; ausente = estava em exercício na hora da sessão e não está na lista;
  quem não estava em exercício (licença, suplente fora, antes da posse) não entra no total.
  A fonte não separa ausência justificada: ela conta como ausência (o site da Câmara mostra a justificativa; dado aberto não).
Também grava observações de partido do histórico (party_observations) para o partido atual (D05).
"""

from __future__ import annotations

import csv
import logging
from collections import defaultdict
from datetime import date, datetime

import httpx
import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch, fetch_json, paginate_camara
from ..parties import PartyResolver
from ..util import parse_ts

log = logging.getLogger("etl.camara.presenca")
API = "https://dadosabertos.camara.leg.br/api/v2"
FILES = "https://dadosabertos.camara.leg.br/arquivos"
WEEK = 7 * 86400
LEG_START = {56: date(2019, 2, 1), 57: date(2023, 2, 1), 58: date(2027, 2, 1)}


def _legs_for_year(year: int) -> list[int]:
    out = [n for n, s in LEG_START.items() if s.year <= year < s.year + 4]
    if year in (2019, 2023, 2027):  # janeiro ainda é da legislatura anterior
        out.append(out[0] - 1)
    return [n for n in out if n in LEG_START]


def _rows(path):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        yield from csv.DictReader(fh, delimiter=";")


def exercise_intervals(dep_id: str, legs: set[int], parties: PartyResolver | None = None, obs: list | None = None) -> list[tuple[datetime, datetime | None]] | None:
    """Intervalos [início, fim) em que o deputado esteve 'Exercício' nas legislaturas pedidas, pelo /historico.
    Se `obs` vier, acrescenta (dep_id, party_id, data, chave) de cada registro com partido (todas as legislaturas)."""
    try:
        hist = fetch_json(f"{API}/deputados/{dep_id}/historico", max_age=WEEK)["dados"]
    except FileNotFoundError:
        return []
    except httpx.HTTPError as e:
        log.warning("deputado %s: /historico indisponível (%s); presença dele fica fora desta carga (não infla nem zera)", dep_id, e)
        return None
    hist = sorted(hist, key=lambda h: h.get("dataHora") or "")
    if obs is not None and parties is not None:
        for h in hist:
            ts = parse_ts(h.get("dataHora"))
            if ts and h.get("siglaPartido") and h.get("situacao"):  # registros sem situação = "nome/partido no início da legislatura" (data fictícia)
                obs.append((dep_id, parties.get(h["siglaPartido"]), ts.date(), f"camara:{dep_id}:{h['dataHora']}"))
    out: list[tuple[datetime, datetime | None]] = []
    for leg in sorted(legs):
        cur: datetime | None = None
        for h in hist:
            if h.get("idLegislatura") != leg or not h.get("situacao"):
                continue
            ts = parse_ts(h.get("dataHora"))
            if not ts:
                continue
            if h["situacao"] in ("Exercício", "Convocado"):
                if cur is None:
                    cur = ts
            elif cur is not None:
                out.append((cur, ts))
                cur = None
        if cur is not None:
            out.append((cur, None))
    return out


def run_presenca(conn: psycopg.Connection, *, years: list[int], force: bool) -> None:
    body = str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])
    src_camara = str(conn.execute("select id from sources where slug = 'camara'").fetchone()["id"])
    parties = PartyResolver(conn)
    ext = {r["external_id"]: str(r["person_id"]) for r in conn.execute(
        "select e.external_id, e.person_id from person_external_ids e where e.source_id = %s", (src_camara,))}
    intervals_cache: dict[str, list] = {}
    party_obs: list = []
    roster_cache: dict[int, list[str]] = {}

    def roster(leg: int) -> list[str]:
        if leg not in roster_cache:
            roster_cache[leg] = [str(d["id"]) for d in paginate_camara(f"{API}/deputados?idLegislatura={leg}&itens=100&ordem=ASC&ordenarPor=nome", max_age=WEEK)]
        return roster_cache[leg]

    for year in years:
        try:
            f_ev = fetch(f"{FILES}/eventos/csv/eventos-{year}.csv")
            f_or = fetch(f"{FILES}/eventosOrgaos/csv/eventosOrgaos-{year}.csv")
            f_pr = fetch(f"{FILES}/eventosPresencaDeputados/csv/eventosPresencaDeputados-{year}.csv")
        except FileNotFoundError as e:
            log.warning("Câmara ainda não publicou eventos/presença de %d (%s)", year, e)
            continue
        legs = set(_legs_for_year(year))
        checksum = ":".join(x.checksum for x in (f_ev, f_or, f_pr)) + ":regra2"
        try:
            with run(conn, f"camara.presenca.{year}", "camara", input_checksum=checksum, force=force) as r:
                plen = {x["idEvento"] for x in _rows(f_or.path) if x["siglaOrgao"] == "PLEN"}
                sess = {}
                for x in _rows(f_ev.path):
                    if x["descricaoTipo"] == "Sessão Deliberativa" and x["id"] in plen and (x["situacao"] or "").startswith("Encerrada"):
                        ts = parse_ts(x["dataHoraInicio"])
                        if ts:
                            sess[x["id"]] = ts
                present: dict[str, set[str]] = defaultdict(set)
                for x in _rows(f_pr.path):
                    if x["idEvento"] in sess:
                        present[x["idEvento"]].add(x["idDeputado"])
                # sessão deliberativa sem lista publicada: não entra (não dá para dizer quem faltou)
                sess = {k: v for k, v in sess.items() if present.get(k)}
                deps = set().union(*present.values()) if present else set()
                for leg in legs:
                    deps.update(roster(leg))
                unknown = {d for d in deps if d not in ext}  # fora do diretório: sem crachá, não busca histórico nem grava
                deps -= unknown
                for d in deps:
                    if d not in intervals_cache:
                        intervals_cache[d] = exercise_intervals(d, set(LEG_START), parties, party_obs)
                # sessões: mesma chave (idEvento) das sessões criadas pelas votações; marca deliberativa
                sess_id = {}
                for row in upsert(conn, "sessions", ["body_id", "kind", "is_deliberative", "status", "starts_at", "official_url", "source_key"],
                                  [(body, "deliberativa", True, "encerrada", ts, f"https://www.camara.leg.br/evento-legislativo/{k}", k) for k, ts in sess.items()],
                                  ["body_id", "source_key"], update=["kind", "is_deliberative", "starts_at"], returning=["id", "source_key"]):
                    sess_id[row["source_key"]] = str(row["id"])
                rows = []
                for k, ts in sess.items():
                    for d in deps:
                        if intervals_cache.get(d) is None:
                            continue
                        here = d in present[k]
                        in_ex = any(a <= ts and (b is None or ts < b) for a, b in intervals_cache[d])
                        if not (here or in_ex):
                            continue
                        rows.append((sess_id[k], ext[d], "presente" if here else "ausente"))
                # substitui a presença do ano (a derivada de voto e a de runs anteriores) numa transação só
                y0, y1 = datetime(year, 1, 1), datetime(year + 1, 1, 1)
                conn.execute(
                    "delete from attendance a using sessions s where s.id = a.session_id and s.body_id = %s and s.starts_at >= %s and s.starts_at < %s",
                    (body, y0, y1),
                )
                r.add(len(upsert(conn, "attendance", ["session_id", "person_id", "status"], rows, ["session_id", "person_id"], update=["status"], returning=["id"])))
                # sessões de votação que não são deliberativas do Plenário deixam de contar como sessão de presença
                conn.execute(
                    "update sessions set is_deliberative = false where body_id = %s and starts_at >= %s and starts_at < %s and not (source_key = any(%s)) and is_deliberative",
                    (body, y0, y1, list(sess)),
                )
                if unknown:
                    r.notes.append(f"{len(unknown)} deputados sem crachá no diretório (legislatura passada): presença não gravada")
                log.info("câmara presença %d: %d sessões deliberativas, %d registros, %d deputados fora do diretório", year, len(sess), len(rows), len(unknown))
        except SkipUnchanged:
            continue
    if party_obs:
        obs = [(ext[d], p, day, "camara", key) for d, p, day, key in party_obs if p and d in ext]
        upsert(conn, "party_observations", ["person_id", "party_id", "observed_on", "source", "source_key"], obs, ["source", "source_key"], update=["person_id", "party_id", "observed_on"])
        conn.commit()
        log.info("câmara: %d observações de partido do histórico", len(obs))
