"""etl.camara.diario: deputados, mandatos, votações nominais do Plenário, orientações, proposições, temas e cota.

Fontes (dadosabertos.camara.leg.br, CC0):
  API v2  /deputados?idLegislatura=57, /deputados/{id}          -> people, mandates, party_memberships
  arquivos/votacoes|votacoesVotos|votacoesOrientacoes|votacoesProposicoes/csv/*-{ano}.csv
                                                                  -> sessions, voting_events, votes, party_orientations
  arquivos/proposicoes|proposicoesAutores|proposicoesTemas/csv/*-{ano}.csv -> proposals, proposal_authors, proposal_topics
  www.camara.leg.br/cotas/Ano-{ano}.csv.zip                       -> expenses
Presença NÃO sai daqui: vem da lista oficial de presença em sessões deliberativas (jobs/camara_presenca.py).
Sessões criadas a partir das votações nascem is_deliberative = false; o job de presença marca as deliberativas.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import psycopg

from ..db import Run, SkipUnchanged, run, upsert
from ..http import fetch, fetch_json, paginate_camara
from ..identity import PersonResolver
from ..parties import PartyResolver
from ..util import cents, fold, midnight_br, nz, parse_date, parse_ts_br, titlecase_pt

log = logging.getLogger("etl.camara")
API = "https://dadosabertos.camara.leg.br/api/v2"
FILES = "https://dadosabertos.camara.leg.br/arquivos"
LEGISLATURES = {56: (date(2019, 2, 1), date(2023, 2, 1)), 57: (date(2023, 2, 1), date(2027, 2, 1)), 58: (date(2027, 2, 1), date(2031, 2, 1))}
WEEK = 7 * 86400

STATUS = {
    "Exercício": "em_exercicio", "Convocado": "em_exercicio", "Licença": "licenciado", "Afastado": "afastado",
    "Suplência": "encerrado", "Fim de Mandato": "encerrado", "Vacância": "encerrado", "Falecimento": "encerrado",
    "Cassado": "cassado", "Renúncia": "renunciou",
}
VOTE = {"Sim": "sim", "Não": "nao", "Abstenção": "abstencao", "Obstrução": "obstrucao", "Artigo 17": "art17", "Branco": "nao_votou"}
ORIENT = {"Sim": "sim", "Não": "nao", "Liberado": "liberado", "Obstrução": "obstrucao", "Abstenção": "abstencao"}
ACTOR_KIND = {"governo": "governo", "maioria": "maioria", "minoria": "minoria", "oposição": "oposicao", "oposicao": "oposicao"}
LAW_TYPES = {"PL", "PLP", "PEC", "PDL", "MPV", "PLV"}
# D09: emendas entram como tipo próprio (EMC comissão, EMP plenário, EMR relator, ESB substitutiva); o original conta "pedidos e emendas"
EMENDA_TYPES = {"EMC", "EMP", "EMR", "ESB"}
KEEP_TYPES = LAW_TYPES | {"PRC", "REQ", "RIC", "INC", "PFC"} | EMENDA_TYPES



def upsert_sessions(conn, body: str, rows: list[tuple]) -> dict[str, str]:
    """Sessões do Plenário com votação. `starts_at` aqui é a hora do primeiro voto, que só preenche sessão sem horário:
    o início oficial vem de `camara.presenca` e não pode ser sobrescrito por esta (D173, ex-D163a). Sessão que já tinha
    horário não entra no RETURNING do upsert (o DO UPDATE tem `where`), então os ids vêm de um select."""
    upsert(conn, "sessions", ["body_id", "kind", "is_deliberative", "status", "starts_at", "official_url", "source_key"], rows,
           ["body_id", "source_key"], update=["starts_at"], where="sessions.starts_at is null")
    keys = [r[6] for r in rows]
    if not keys:
        return {}
    cur = conn.execute("select id, source_key from sessions where body_id = %s and source_key = any(%s)", (body, keys))
    return {r["source_key"]: str(r["id"]) for r in cur.fetchall()}

def _legislature_for(d: date) -> int:
    for n, (a, b) in LEGISLATURES.items():
        if a <= d < b:
            return n
    return 57


def _csv(text: str):
    return csv.DictReader(io.StringIO(text.lstrip("﻿")), delimiter=";")


def run_camara(conn: psycopg.Connection, *, years: list[int], limit: int | None, expenses: bool, force: bool) -> None:
    leg = _legislature_for(date.today())
    ctx = _Ctx(conn)
    _deputies(conn, ctx, leg, limit, force)
    for past in sorted({_legislature_for(date(y, 6, 1)) for y in years} - {leg}):
        link_past_roster(conn, ctx, past)
    for y in years:
        _votes(conn, ctx, y, force)
        _proposals(conn, ctx, y, force)
        if expenses:
            _expenses(conn, ctx, y, force)


class _Ctx:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.people = PersonResolver(conn)
        self.parties = PartyResolver(conn)
        self.office = str(conn.execute("select id from offices where slug = 'deputado_federal'").fetchone()["id"])
        self.body = str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])
        self.by_uf = {r["uf"]: str(r["id"]) for r in conn.execute("select uf, id from places where kind = 'uf'")}
        self.muni = {(r["uf"], fold(r["name"])): str(r["id"]) for r in conn.execute("select uf, name, id from places where kind = 'municipio'")}
        self.topic_by_theme: dict[str, str] = {}
        for r in conn.execute("select id, keywords from topics"):
            for k in r["keywords"]:
                self.topic_by_theme[k] = str(r["id"])
        self.actors: dict[str, str] = {r["label"]: str(r["id"]) for r in conn.execute("select label, id from orientation_actors where body_id = %s", (self.body,))}
        self.skip: set[str] = set()
        # fatos (voto, proposta, cota) nunca criam pessoa: só _deputies cria, a partir da lista da legislatura atual (D34).
        # Antes, voto de janeiro de 2023 (ainda legislatura 56) criava crachá para ex-deputado.

    def person_for_deputy(self, dep_id: str, create: bool = True) -> str | None:
        """create=False: só casa com quem já está no diretório (id da Câmara ou ligação feita por link_past_roster); não cria crachá (D34)."""
        pid = self.people.by_external("camara", dep_id)
        if pid:
            return pid
        if dep_id in self.skip:
            return None
        if not create:
            return None  # legislatura passada: só o vínculo feito por link_past_roster (sem detalhe por deputado: a API dá 504 em ids antigos)
        try:
            d = fetch_json(f"{API}/deputados/{dep_id}", max_age=WEEK)["dados"]
        except FileNotFoundError:
            return None
        except httpx.HTTPError as e:
            # a API devolve 504 persistente para alguns ids antigos: sem detalhe não há como casar; pula e registra
            log.warning("deputado %s sem detalhe na API (%s): fato ignorado nesta carga", dep_id, e)
            self.skip.add(dep_id)
            return None
        try:
            return self.ensure(d, create=create)
        except LookupError:
            self.skip.add(dep_id)
            return None

    def ensure(self, d: dict[str, Any], create: bool = True) -> str | None:
        """Cria ou casa a pessoa a partir do detalhe /deputados/{id}. Devolve person_id."""
        dep_id = str(d["id"])
        st = d.get("ultimoStatus") or {}
        civil = titlecase_pt(d.get("nomeCivil"))
        display = st.get("nomeEleitoral") or st.get("nome") or civil
        birth = parse_date(d.get("dataNascimento"))
        birth_uf = (d.get("ufNascimento") or "").upper() or None
        place = self.by_uf.get((st.get("siglaUf") or "").upper())
        m = self.people.resolve(source="camara", external_id=dep_id, civil_name=civil, birth_date=birth, birth_uf=birth_uf,
                                raw={"nome": display, "civil": civil, "nascimento": str(birth), "uf": st.get("siglaUf")},
                                seat=(self.office, place) if place else None, display_name=display)
        if m.method == "queued":
            raise LookupError(f"deputado {dep_id} ambíguo")
        if m.person_id:
            # a Câmara publica o nome parlamentar com grafia oficial e a foto com licença: atualiza
            self.conn.execute(
                "update people set display_name = %s, photo_source_url = coalesce(%s, photo_source_url), photo_license = coalesce(photo_license, 'Câmara dos Deputados'), updated_at = now() where id = %s and display_name is distinct from %s",
                (display, st.get("urlFoto"), m.person_id, display),
            )
            return m.person_id
        if not create:
            self.skip.add(dep_id)
            return None
        return self.people.create(
            display_name=display, civil_name=civil, gender={"M": "m", "F": "f"}.get(d.get("sexo") or ""), birth_date=birth,
            birthplace_place_id=self.muni.get((birth_uf, fold(d.get("municipioNascimento")))) if birth_uf else None,
            education=d.get("escolaridade"), slug_hints=((st.get("siglaUf") or "").lower() or None, "deputado-federal"),
            source="camara", external_id=dep_id, photo_source_url=st.get("urlFoto"),
        )


def link_past_roster(conn: psycopg.Connection, ctx: "_Ctx", leg: int) -> int:
    """Liga ids da Câmara de uma legislatura passada a quem já está no diretório (D34), sem criar pessoa e sem chamar a API
    por deputado (504 persistente em ids antigos). Fonte: arquivos/deputados/csv/deputados.csv (nome civil, nascimento,
    legislaturas). 1º critério: nome civil + nascimento (PersonResolver, casamento único); 2º: nome eleitoral = nome de urna
    de uma candidatura a deputado federal na eleição que formou a legislatura, só se único."""
    f = fetch(f"{FILES}/deputados/csv/deputados.csv", max_age=WEEK)
    start = LEGISLATURES[leg][0]
    rows = conn.execute(
        """select c.person_id, c.ballot_name, p.display_name from candidacies c join elections e on e.id = c.election_id
           join contests ct on ct.id = c.contest_id join offices o on o.id = ct.office_id join people p on p.id = c.person_id
           where o.slug = 'deputado_federal' and e.year = %s and e.kind = 'geral'""", (start.year - 1,)).fetchall()
    key = lambda s_: re.sub(r"[^a-z0-9]", "", fold(s_))  # noqa: E731
    by_ballot: dict[str, set[str]] = defaultdict(set)
    for r_ in rows:
        for n in (r_["ballot_name"], r_["display_name"]):
            if n:
                by_ballot[key(n)].add(str(r_["person_id"]))
    n_birth = n_name = 0
    with open(f.path, encoding="utf-8-sig", newline="") as fh:
        for x in csv.DictReader(fh, delimiter=";"):
            try:
                lo, hi = int(x["idLegislaturaInicial"] or 0), int(x["idLegislaturaFinal"] or 0)
            except ValueError:
                continue
            if not (lo <= leg <= hi):
                continue
            dep = x["uri"].rstrip("/").rsplit("/", 1)[-1]
            if ctx.people.by_external("camara", dep):
                continue
            m = ctx.people.resolve(source="camara", external_id=dep, civil_name=titlecase_pt(x["nomeCivil"]), birth_date=parse_date(x["dataNascimento"]),
                                   birth_uf=(x["ufNascimento"] or "").upper() or None, raw={"nome": x["nome"], "legislatura": leg})
            if m.person_id:
                n_birth += 1
                continue
            hits = by_ballot.get(key(x["nome"]), set())
            if len(hits) == 1:
                ctx.people.link(next(iter(hits)), "camara", dep, "name_birth_place", 0.9)
                n_name += 1
    ctx.people.flush()
    conn.commit()
    log.info("câmara legislatura %d: %d deputados ligados por nome civil + nascimento, %d por nome de urna", leg, n_birth, n_name)
    return n_birth + n_name


def _deputies(conn: psycopg.Connection, ctx: _Ctx, leg: int, limit: int | None, force: bool) -> None:
    listing = list(paginate_camara(f"{API}/deputados?idLegislatura={leg}&itens=100&ordem=ASC&ordenarPor=nome"))
    if limit:
        listing = listing[:limit]
    checksum = f"{leg}:{len(listing)}:{limit}:" + ",".join(str(d["id"]) for d in listing)
    try:
        with run(conn, "camara.deputados", "camara") as r:  # detalhes mudam sem a lista mudar: sempre roda
            start, end = LEGISLATURES[leg]
            mandates, memberships = [], []
            # mandatos já conhecidos do cargo (TSE ou run anterior): evita sobreposição e reconhece titular eleito
            existing: dict[tuple[str, str], list[tuple[date, date]]] = defaultdict(list)
            for row in conn.execute("select person_id, place_id, started_on, ends_on from mandates where office_id = %s", (ctx.office,)):
                existing[(str(row["person_id"]), str(row["place_id"]))].append((row["started_on"], row["ends_on"]))
            for d0 in listing:
                try:
                    d = fetch_json(f"{API}/deputados/{d0['id']}", max_age=86400)["dados"]
                    pid = ctx.ensure(d)
                except LookupError as e:
                    r.reject(1, str(e))
                    continue
                st = d.get("ultimoStatus") or {}
                situ = st.get("situacao") or ""
                status = STATUS.get(situ, "em_exercicio")
                place = ctx.by_uf.get((st.get("siglaUf") or "").upper())
                if not place:
                    r.reject(1, f"UF desconhecida para deputado {d['id']}")
                    continue
                party = ctx.parties.get(st.get("siglaPartido"))
                condicao = st.get("condicaoEleitoral") or "Titular"
                known = existing.get((pid, place), [])
                # "Titular" = eleito titular. "Suplente"/"Não Eleito" = entrou depois (ou perdeu o mandato: cassado vira "Não Eleito" + "Vacância").
                # Se o TSE já registrou posse de titular nesta legislatura, o status da Câmara atualiza esse mandato.
                titular = condicao == "Titular" or any(s == start for s, _ in known)
                if titular:
                    started = start
                else:
                    if status not in ("em_exercicio", "licenciado", "afastado"):
                        continue  # suplente que não está exercendo: sem mandato próprio
                    started = max(parse_date(st.get("data")) or start, start)
                    # já existe mandato que cobre a data (run anterior): reaproveita a chave para não sobrepor
                    for s, e in known:
                        if s <= started < e:
                            started = s
                            break
                mandates.append((pid, ctx.office, place, ctx.body, party, "titular" if titular else "suplente_em_exercicio", status, started, end, f"TSE {start.year - 1}", "camara"))
                if party:
                    # observação de partido (D05): mesma chave do /historico, que o job de presença também grava
                    seen = parse_date(st.get("data")) or start
                    memberships.append((pid, party, seen, "camara", f"camara:{d['id']}:{st.get('data') or start.isoformat()}"))
            # mandato: a Câmara é dona do status; não mexe em party_id (partido na posse vem do TSE)
            n = len(upsert(
                conn, "mandates",
                ["person_id", "office_id", "place_id", "body_id", "party_id", "role", "status", "started_on", "ends_on", "elected_by", "status_source"],
                mandates, ["person_id", "office_id", "place_id", "started_on"],
                update=["body_id", "role", "status", "status_source"], returning=["id"],
            ))
            # partido: observação datada; party_memberships é reconstruída no derive.stats (linha do tempo de todas as fontes)
            upsert(conn, "party_observations", ["person_id", "party_id", "observed_on", "source", "source_key"], memberships, ["source", "source_key"], update=["person_id", "party_id", "observed_on"])
            ctx.people.flush()
            if not limit:
                # eleito pelo TSE que a Câmara não lista na legislatura: não tomou posse (renúncia antes da posse, outro cargo)
                cur = conn.execute(
                    """update mandates m set status = 'encerrado', status_source = 'camara', updated_at = now()
                       where m.office_id = %s and m.started_on = %s and m.status_source = 'tse' and m.started_on <= current_date
                         and not exists (select 1 from person_external_ids e join sources s on s.id = e.source_id where e.person_id = m.person_id and s.slug = 'camara')""",
                    (ctx.office, start),
                )
                if cur.rowcount:
                    r.notes.append(f"{cur.rowcount} eleito(s) sem registro na Câmara marcados como encerrado")
            r.add(n)
            r.notes.append(f"checksum da lista: {checksum[:64]}…")
    except SkipUnchanged:
        return


def _votes(conn: psycopg.Connection, ctx: _Ctx, year: int, force: bool) -> None:
    try:
        f_ev = fetch(f"{FILES}/votacoes/csv/votacoes-{year}.csv")
        f_vt = fetch(f"{FILES}/votacoesVotos/csv/votacoesVotos-{year}.csv")
        f_or = fetch(f"{FILES}/votacoesOrientacoes/csv/votacoesOrientacoes-{year}.csv")
        f_pr = fetch(f"{FILES}/votacoesProposicoes/csv/votacoesProposicoes-{year}.csv")
    except FileNotFoundError as e:
        log.warning("Câmara ainda não publicou votações de %d (%s)", year, e)
        return
    checksum = ":".join(x.checksum for x in (f_ev, f_vt, f_or, f_pr))
    try:
        with run(conn, f"camara.votacoes.{year}", "camara", input_checksum=checksum, force=force) as r:
            # proposição objeto de cada votação (primeira)
            prop_of: dict[str, dict[str, str]] = {}
            for x in _csv(f_pr.text()):
                prop_of.setdefault(x["idVotacao"], x)
            # votos: agrupa por votação
            votes_by: dict[str, list[dict[str, str]]] = defaultdict(list)
            for x in _csv(f_vt.text()):
                votes_by[x["idVotacao"]].append(x)
            events = [x for x in _csv(f_ev.text()) if x["siglaOrgao"] == "PLEN"]
            log.info("câmara %d: %d votações do Plenário, %d com voto nominal", year, len(events), sum(1 for e in events if e["id"] in votes_by))

            # proposições mínimas (as votadas), para ligar o evento
            prop_rows = {}
            for ev in events:
                p = prop_of.get(ev["id"])
                if p and p.get("proposicao_siglaTipo") and p.get("proposicao_numero", "").isdigit():
                    key = (ctx.body, p["proposicao_siglaTipo"], int(p["proposicao_numero"]), int(p["proposicao_ano"] or year))
                    prop_rows[key] = (*key, (p.get("proposicao_ementa") or p.get("proposicao_titulo") or "")[:4000], p["proposicao_siglaTipo"] in LAW_TYPES,
                                      f"https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao={p['proposicao_id']}")
            prop_id: dict[tuple, str] = {}
            for row in upsert(conn, "proposals", ["body_id", "type", "number", "year", "summary_official", "can_become_law", "url"], list(prop_rows.values()),
                              ["body_id", "type", "number", "year"], update=[], returning=["id", "type", "number", "year"]):
                prop_id[(row["type"], row["number"], row["year"])] = str(row["id"])
            if len(prop_id) < len(prop_rows):
                for row in conn.execute("select id, type, number, year from proposals where body_id = %s", (ctx.body,)):
                    prop_id[(row["type"], row["number"], row["year"])] = str(row["id"])

            # sessões = eventos do Plenário com votação
            sess_rows = {}
            for ev in events:
                ts = parse_ts_br(ev["dataHoraRegistro"]) or midnight_br(parse_date(ev["data"]) or date(year, 1, 1))
                k = ev["idEvento"] or f"dia:{ev['data']}"
                cur = sess_rows.get(k)
                if cur is None or ts < cur[4]:
                    sess_rows[k] = (ctx.body, "plenario", False, "encerrada", ts, f"https://www.camara.leg.br/evento-legislativo/{ev['idEvento']}" if ev["idEvento"] else None, k)
            sess_id = upsert_sessions(conn, ctx.body, list(sess_rows.values()))

            # eventos de votação
            ev_rows = []
            for ev in events:
                nominal = ev["id"] in votes_by
                desc = (ev["descricao"] or "").strip() or (ev.get("ultimaApresentacaoProposicao_descricao") or "votação")
                low = desc.lower()
                kind = "urgencia" if "urgência" in low or "urgencia" in low else "destaque" if "destaque" in low else "requerimento" if "requerimento" in low else "texto"
                result = {"1": "aprovado", "0": "rejeitado"}.get(ev["aprovacao"] or "")
                p = prop_of.get(ev["id"])
                pid = prop_id.get((p["proposicao_siglaTipo"], int(p["proposicao_numero"]), int(p["proposicao_ano"] or year))) if p and p.get("proposicao_numero", "").isdigit() else None
                ts = parse_ts_br(ev["dataHoraRegistro"]) or midnight_br(parse_date(ev["data"]) or date(year, 1, 1))
                ys = int(ev["votosSim"] or 0) or None
                ns = int(ev["votosNao"] or 0) or None
                ev_rows.append((ctx.body, sess_id.get(ev["idEvento"] or f"dia:{ev['data']}"), pid, ts, kind, nominal, desc[:4000], result, ys, ns, None, ev["id"]))
            ev_id: dict[str, str] = {}
            for row in upsert(conn, "voting_events", ["body_id", "session_id", "proposal_id", "occurred_at", "kind", "is_nominal", "description", "result", "yes_count", "no_count", "abstain_count", "source_key"],
                              ev_rows, ["body_id", "source_key"], returning=["id", "source_key"]):
                ev_id[row["source_key"]] = str(row["id"])
            r.add(len(ev_id))

            # votos nominais
            vote_rows, unknown = [], set()
            counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
            for vid, vs in votes_by.items():
                eid = ev_id.get(vid)
                if not eid:
                    continue
                for v in vs:
                    if not (v["voto"] or "").strip():
                        continue  # a fonte lista a pessoa sem voto registrado: não é voto
                    val = VOTE.get(v["voto"])
                    if not val:
                        r.reject(1, f"voto desconhecido: {v['voto']}")
                        continue
                    pid = ctx.person_for_deputy(v["deputado_id"], create=False)
                    if not pid:
                        unknown.add(v["deputado_id"])
                        continue
                    vote_rows.append((eid, pid, ctx.parties.get(v["deputado_siglaPartido"]), val))
                    counts[eid][val] += 1
            ctx.people.flush()
            r.add(len(upsert(conn, "votes", ["voting_event_id", "person_id", "party_id", "value"], vote_rows, ["voting_event_id", "person_id"], update=["party_id", "value"], returning=["id"])))
            if unknown:
                r.notes.append(f"{len(unknown)} deputados sem cadastro na API: {sorted(unknown)[:10]}")
            # placar real a partir dos votos nominais
            conn.cursor().executemany(
                "update voting_events set yes_count = %s, no_count = %s, abstain_count = %s where id = %s",
                [(c["sim"], c["nao"], c["abstencao"], eid) for eid, c in counts.items()],
            )

            # orientações de partidos, blocos, governo, maioria, minoria e oposição
            actor_rows, orient_rows = {}, []
            for x in _csv(f_or.text()):
                eid = ev_id.get(x["idVotacao"])
                o = ORIENT.get((x["orientacao"] or "").strip())
                label = (x["siglaBancada"] or "").strip()
                if not eid or not o or not label:
                    continue
                kind = ACTOR_KIND.get(fold(label))
                party = None if kind else ctx.parties.get(label) if label.upper() == label or len(label) <= 6 else None
                if not kind:
                    kind = "partido" if party and party_key_like(label) else "bloco"
                    if kind == "bloco":
                        party = None
                actor_rows.setdefault(label, (kind, party, label, ctx.body))
                orient_rows.append((eid, label, o))
            for row in upsert(conn, "orientation_actors", ["kind", "party_id", "label", "body_id"], list(actor_rows.values()), ["body_id", "label"], update=[], returning=["id", "label"]):
                ctx.actors[row["label"]] = str(row["id"])
            if any(l not in ctx.actors for l in actor_rows):
                for row in conn.execute("select label, id from orientation_actors where body_id = %s", (ctx.body,)):
                    ctx.actors[row["label"]] = str(row["id"])
            upsert(conn, "party_orientations", ["voting_event_id", "actor_id", "orientation"], [(e, ctx.actors[l], o) for e, l, o in orient_rows if l in ctx.actors], ["voting_event_id", "actor_id"])

    except SkipUnchanged:
        return


def party_key_like(label: str) -> bool:
    """Siglas de partido são curtas e sem minúsculas no meio ('PT', 'PCdoB', 'UNIÃO'); blocos vêm em CamelCase ('PpPodeAvante')."""
    return bool(re.fullmatch(r"[A-ZÀ-Ü0-9]{2,15}|PCdoB|PTdoB|Podemos|Avante|Patriota|Cidadania|Republicanos|Novo|Rede|Solidariedade|Progressistas", label))


# só o despacho de transformação traz o número da norma; "projeto de lei 123/2023 sancionado" NÃO é o número da lei
LAW_RE = re.compile(r"Transformad[oa]\s+n[oa]\s+(Lei Complementar|Lei Ordinária|Emenda Constitucional|Decreto Legislativo|Resolução)\s*(?:n[ºo°.]*\s*)?([\d.]+)\s*/\s*(\d{4})", re.I)
DOU_RE = re.compile(r"DOU\s*(?:de\s*)?(\d{2})[/ ](\d{2})[/ ](\d{4})", re.I)
LAW_URL = {"lei ordinária": "lei", "lei": "lei", "lei complementar": "lcp", "emenda constitucional": "emc"}


def _parse_law(despacho: str, status_ts: str | None):
    """'Transformado na Lei Ordinária 15172/2025. DOU 23/07/2025' -> ('Lei 15.172/2025', date, url)."""
    m = LAW_RE.search(despacho)
    if not m:
        return None
    kind, num, year = m.group(1), m.group(2).replace(".", ""), m.group(3)
    label = {"lei ordinária": "Lei", "lei": "Lei"}.get(kind.lower(), kind.title().replace("Ordinária", "").strip())
    pretty = f"{int(num):,}".replace(",", ".") if num.isdigit() else num
    d = DOU_RE.search(despacho)
    day = parse_date(f"{d.group(1)}/{d.group(2)}/{d.group(3)}") if d else parse_date(status_ts)
    if not day:
        return None
    slug = LAW_URL.get(kind.lower())
    y = int(year)
    start = y - (y - 2003) % 4  # Planalto agrupa por mandato: _ato2019-2022, _ato2023-2026
    url = f"https://www.planalto.gov.br/ccivil_03/_ato{start}-{start + 3}/{year}/lei/L{num}.htm" if slug == "lei" else None
    return (f"{label} {pretty}/{year}", day, url)


def _proposals(conn: psycopg.Connection, ctx: _Ctx, year: int, force: bool) -> None:
    try:
        f_au = fetch(f"{FILES}/proposicoesAutores/csv/proposicoesAutores-{year}.csv")
        f_pr = fetch(f"{FILES}/proposicoes/csv/proposicoes-{year}.csv")
        f_tm = fetch(f"{FILES}/proposicoesTemas/csv/proposicoesTemas-{year}.csv")
    except FileNotFoundError as e:
        log.warning("Câmara ainda não publicou proposições de %d (%s)", year, e)
        return
    checksum = ":".join(x.checksum for x in (f_au, f_pr, f_tm))
    try:
        with run(conn, f"camara.proposicoes.{year}", "camara", input_checksum=checksum, force=force) as r:
            authors: dict[str, list[tuple[str, str, int, bool]]] = defaultdict(list)
            for x in _csv(f_au.text()):
                dep = (x["idDeputadoAutor"] or "").strip()
                if dep:
                    authors[x["idProposicao"]].append((dep, x["nomeAutor"], int(x["ordemAssinatura"] or 0) or None, x["proponente"] == "1"))
            # fluxo linha a linha: o arquivo tem dezenas de MB
            prop_rows, keep_ids, laws = {}, {}, {}
            with open(f_pr.path, encoding="utf-8-sig", newline="") as fh:
                for x in csv.DictReader(fh, delimiter=";"):
                    if x["id"] not in authors or x["siglaTipo"] not in KEEP_TYPES or not x["numero"].isdigit():
                        continue
                    key = (ctx.body, x["siglaTipo"], int(x["numero"]), int(x["ano"] or year))
                    prop_rows[key] = (*key, (x["ementa"] or "").strip()[:4000] or "(sem ementa)", x["siglaTipo"] in LAW_TYPES,
                                      (x.get("ultimoStatus_descricaoSituacao") or "").strip()[:200] or None, parse_date(x["dataApresentacao"]),
                                      x.get("urlInteiroTeor") or f"https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao={x['id']}")
                    keep_ids[x["id"]] = key[1:]
                    if "Norma Jur" in (x.get("ultimoStatus_descricaoSituacao") or ""):
                        law = _parse_law(x.get("ultimoStatus_despacho") or "", x.get("ultimoStatus_dataHora"))
                        if law:
                            laws[key[1:]] = (*law, (x["ementa"] or "").strip()[:4000] or "(sem ementa)")
            log.info("câmara %d: %d proposições de deputados", year, len(prop_rows))
            prop_id: dict[tuple, str] = {}
            for row in upsert(conn, "proposals", ["body_id", "type", "number", "year", "summary_official", "can_become_law", "status", "presented_on", "url"],
                              list(prop_rows.values()), ["body_id", "type", "number", "year"], update=["summary_official", "status", "presented_on", "url"],
                              returning=["id", "type", "number", "year"]):
                prop_id[(row["type"], row["number"], row["year"])] = str(row["id"])
            r.add(len(prop_id))
            if laws:
                br = str(conn.execute("select id from places where ibge_code = 'BR'").fetchone()["id"])
                law_id = {}
                for row in upsert(conn, "laws", ["sphere", "place_id", "number", "sanctioned_on", "summary", "url"],
                                  [("federal", br, num, day, summ, url) for num, day, url, summ in laws.values()],
                                  ["sphere", "place_id", "number"], update=["sanctioned_on", "summary", "url"], returning=["id", "number"]):
                    law_id[row["number"]] = str(row["id"])
                conn.cursor().executemany(
                    "update proposals set became_law_id = %s where id = %s and became_law_id is distinct from %s",
                    [(law_id[num], prop_id[k], law_id[num]) for k, (num, _d, _u, _s) in laws.items() if k in prop_id and num in law_id],
                )
                r.notes.append(f"{len(law_id)} leis vindas de proposições")
            au_rows, unknown = [], set()
            for raw_id, key in keep_ids.items():
                pid = prop_id.get(key)
                if not pid:
                    continue
                for dep, _name, order, proponente in authors[raw_id]:
                    person = ctx.person_for_deputy(dep, create=False)
                    if not person:
                        unknown.add(dep)
                        continue
                    role = "principal" if proponente and (order or 1) == 1 else "coautoria" if proponente else "apoio"
                    au_rows.append((pid, person, role, order))
            ctx.people.flush()
            upsert(conn, "proposal_authors", ["proposal_id", "person_id", "role", "sign_order"], au_rows, ["proposal_id", "person_id"], update=["role", "sign_order"])
            if unknown:
                r.notes.append(f"{len(unknown)} autores sem cadastro na API: {sorted(unknown)[:10]}")
            tp_rows, unknown_themes = set(), defaultdict(int)
            for x in _csv(f_tm.text()):
                raw_id = x["uriProposicao"].rsplit("/", 1)[-1]
                key = keep_ids.get(raw_id)
                if not key:
                    continue
                tid = ctx.topic_by_theme.get((x["tema"] or "").strip())
                if not tid:
                    unknown_themes[x["tema"]] += 1
                    continue
                pid = prop_id.get(key)
                if pid:
                    tp_rows.add((pid, tid, 1))
            upsert(conn, "proposal_topics", ["proposal_id", "topic_id", "rule_version"], sorted(tp_rows), ["proposal_id", "topic_id"], update=["rule_version"])
            if unknown_themes:
                r.notes.append("temas sem regra: " + "; ".join(f"{k} ({v})" for k, v in unknown_themes.items()))
    except SkipUnchanged:
        return


def _expenses(conn: psycopg.Connection, ctx: _Ctx, year: int, force: bool) -> None:
    try:
        f = fetch(f"https://www.camara.leg.br/cotas/Ano-{year}.csv.zip")
    except FileNotFoundError:
        log.warning("sem cota de %d", year)
        return
    try:
        with run(conn, f"camara.despesas.{year}", "camara", input_checksum=f.checksum, force=force) as r:
            with zipfile.ZipFile(f.path) as z:
                name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                with z.open(name) as fh:
                    reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), delimiter=";")
                    rows, unknown, batch = [], set(), 0
                    for x in reader:
                        dep = (x["ideCadastro"] or "").strip()
                        if not dep:
                            continue  # lideranças e órgãos: não são pessoa
                        pid = ctx.person_for_deputy(dep, create=False)
                        if not pid:
                            unknown.add(dep)
                            continue
                        amount = cents(x["vlrLiquido"])
                        occurred = parse_date(x["datEmissao"]) or (date(int(x["numAno"]), int(x["numMes"]), 1) if x["numMes"].isdigit() else None)
                        if amount is None or not occurred:
                            r.reject(1)
                            continue
                        cat = (x["txtDescricao"] or "").strip()
                        cat = cat[:1].upper() + cat[1:].lower()
                        key = (x["ideDocumento"] or "").strip() or f"{dep}:{x['numAno']}:{x['numMes']}:{x['txtNumero']}:{x['txtCNPJCPF']}"
                        rows.append((pid, ctx.body, occurred, cat, nz(x["txtFornecedor"]), nz(x["txtCNPJCPF"]), amount, "BRL", nz(x["urlDocumento"]), key))
                        if len(rows) >= 20000:
                            batch += len(upsert(conn, "expenses", ["person_id", "body_id", "occurred_on", "category", "supplier_name", "supplier_doc", "amount_cents", "currency", "receipt_url", "source_key"], rows, ["body_id", "source_key"], returning=["id"]))
                            rows = []
                    if rows:
                        batch += len(upsert(conn, "expenses", ["person_id", "body_id", "occurred_on", "category", "supplier_name", "supplier_doc", "amount_cents", "currency", "receipt_url", "source_key"], rows, ["body_id", "source_key"], returning=["id"]))
            ctx.people.flush()
            r.add(batch)
            if unknown:
                r.notes.append(f"{len(unknown)} deputados da cota sem cadastro: {sorted(unknown)[:10]}")
    except SkipUnchanged:
        return
