"""civico-etl identity.fix033 [--apply]: separa pessoas fundidas pelo ramo "cadeira" do identity.resolve (BUG-033, D221-D223).

Causa: na mesma cadeira (cargo + UF), `resolve` aceitava nome parlamentar igual OU nascimento igual, sem olhar o nome civil.
Assim a Câmara 160532 (Adriano Eli Corrêa, nascido em 13/01/1976) caiu no crachá de Geninho Zuliani (Eugenio José Zuliani,
13/01/1976, Câmara 204527); a 74459 (Átila Freitas Lira, 1947) no do filho Átila de Melo Lira (123086); e a 74131 (João Carlos
Paolilo Bacelar, 1941) no do filho (141458).

Detecção: todo vínculo da Câmara/Senado gravado como `name_birth_place` e toda pessoa com mais de um id da mesma casa. Para cada
id, o detalhe da API (nome civil + nascimento) é conferido contra a pessoa com `identity.seat_match` (mesmo nascimento e token do
nome civil em comum). O id que não confere é separado. Se nenhum ou mais de um id confere, não mexe (relata).

Separação (pessoa P fica com o id certo R; o id errado W sai):
  - person_external_ids: o vínculo W sai. A pessoa W não está no diretório (D34: ex-deputado sem mandato atual não tem crachá),
    então os fatos dela saem de P em vez de mudar de dono; se W estiver no diretório como outra pessoa, eles vão para ela.
  - expenses (chave cota{ano}:{W}:...), party_observations (camara:{W}:...), speeches ({W}:...): pela chave da fonte.
  - votes: pelo votacoesVotos-{ano}.csv. Votação em que R votou fica com o voto e o partido de R; em que só W votou, sai.
  - proposal_authors: pelo proposicoesAutores-{ano}.csv. Autoria de R fica; só de W, sai.
  - attendance: refeita para R pela regra do camara.presenca (lista de presença + períodos de exercício do /historico de R).
  - committee_memberships: pelo /deputados/{W}/orgaos. Participação só de W sai.
  - mandate_contacts: contato publicado só no detalhe de W sai.
  - staff_members: lotação em /deputados/{W} no funcionarios.csv sai.
  - people: nome de exibição e foto voltam aos da casa para R (a carga gravava os de W por cima).
Cada linha removida ou alterada vai inteira para identity_split_log (migração 0060). Sem --apply é dry-run. Lotes com commit.
Depois: civico-etl derive.stats (person_period_stats e party_memberships) e civico-etl check.
"""

from __future__ import annotations

import csv
import json
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import psycopg

from ..http import fetch, fetch_json, paginate_camara
from ..identity import SINGLE_ID_SOURCES, seat_match
from ..parties import PartyResolver
from ..util import chunked, parse_date, titlecase_pt

log = logging.getLogger("etl.identity.bug033")
BUG = "BUG-033"
API = "https://dadosabertos.camara.leg.br/api/v2"
FILES = "https://dadosabertos.camara.leg.br/arquivos"
SENADO = "https://legis.senado.leg.br/dadosabertos"
CACHED = 10**9  # arquivos grandes: usa a cópia da carga (mesma versão que está no banco)
YEARS = range(2019, date.today().year + 1)
BATCH = 500


@dataclass
class Ident:
    source: str
    ext: str
    civil: str | None
    birth: date | None
    display: str | None
    photo: str | None
    detail: dict[str, Any] = field(default_factory=dict)


def fetch_ident(source: str, ext: str) -> Ident:
    if source == "camara":
        d = fetch_json(f"{API}/deputados/{ext}", max_age=7 * 86400)["dados"]
        st = d.get("ultimoStatus") or {}
        return Ident(source, ext, titlecase_pt(d.get("nomeCivil")), parse_date(d.get("dataNascimento")),
                     st.get("nomeEleitoral") or st.get("nome"), st.get("urlFoto"), d)
    d = fetch_json(f"{SENADO}/senador/{ext}.json", max_age=7 * 86400)["DetalheParlamentar"]["Parlamentar"]
    i, b = d["IdentificacaoParlamentar"], d.get("DadosBasicosParlamentar") or {}
    return Ident(source, ext, titlecase_pt(i.get("NomeCompletoParlamentar")), parse_date(b.get("DataNascimento")),
                 i.get("NomeParlamentar"), i.get("UrlFotoParlamentar"), d)


def suspects(conn: psycopg.Connection) -> dict[tuple[str, str], list[str]]:
    """(fonte, pessoa) -> ids externos a conferir: pessoa com 2+ ids da casa, ou vínculo gravado pelo ramo da cadeira."""
    rows = conn.execute(
        """select s.slug, e.person_id::text pid, e.external_id, e.match_method from person_external_ids e join sources s on s.id = e.source_id
           where s.slug = any(%s)""", (sorted(SINGLE_ID_SOURCES),)).fetchall()
    by: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        by[(r["slug"], r["pid"])].append(r)
    return {k: [x["external_id"] for x in v] for k, v in by.items() if len(v) > 1 or any(x["match_method"] == "name_birth_place" for x in v)}


def classify(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Uma entrada por (fonte, pessoa) suspeita: ids que conferem (right) e que não conferem (wrong)."""
    out = []
    for (source, pid), exts in sorted(suspects(conn).items()):
        p = conn.execute("select slug, display_name, civil_name, birth_date from people where id = %s", (pid,)).fetchone()
        ids = {x: fetch_ident(source, x) for x in exts}
        ok = [x for x, i in ids.items() if seat_match(i.civil, i.birth, p["civil_name"], None, p["birth_date"])]
        bad = [x for x in exts if x not in ok]
        verdict = "ok" if not bad else "separar" if len(ok) <= 1 else "ambiguo"
        out.append(dict(source=source, pid=pid, slug=p["slug"], person=dict(p), ids=ids, right=ok[0] if len(ok) == 1 else None,
                        wrong=bad, verdict=verdict))
        log.info("%s %s (%s, %s): conferem %s, não conferem %s -> %s", source, p["slug"], p["civil_name"], p["birth_date"],
                 [(x, ids[x].civil, str(ids[x].birth)) for x in ok], [(x, ids[x].civil, str(ids[x].birth)) for x in bad], verdict)
    return out


# ---------- fonte: quem fez o quê ----------

def _csv_rows(url: str):
    f = fetch(url, max_age=CACHED)
    with open(f.path, encoding="utf-8-sig", newline="") as fh:
        yield from csv.DictReader(fh, delimiter=";")


def votes_by_event(deps: set[str]) -> dict[str, dict[str, dict[str, str]]]:
    """idVotacao -> {deputado_id: linha} só dos deputados pedidos."""
    out: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for y in YEARS:
        try:
            for x in _csv_rows(f"{FILES}/votacoesVotos/csv/votacoesVotos-{y}.csv"):
                if x["deputado_id"] in deps:
                    out[x["idVotacao"]][x["deputado_id"]] = x
        except FileNotFoundError:
            continue
    return out


def authors_by_proposal(deps: set[str]) -> dict[tuple[str, int, int], set[str]]:
    """(tipo, número, ano) -> deputados autores (dos pedidos), pelos arquivos de proposições e autores."""
    by_id: dict[str, set[str]] = defaultdict(set)
    out: dict[tuple[str, int, int], set[str]] = defaultdict(set)
    for y in YEARS:
        try:
            for x in _csv_rows(f"{FILES}/proposicoesAutores/csv/proposicoesAutores-{y}.csv"):
                if (x["idDeputadoAutor"] or "").strip() in deps:
                    by_id[x["idProposicao"]].add(x["idDeputadoAutor"].strip())
            for x in _csv_rows(f"{FILES}/proposicoes/csv/proposicoes-{y}.csv"):
                if x["id"] in by_id and x["numero"].isdigit():
                    out[(x["siglaTipo"], int(x["numero"]), int(x["ano"] or y))] |= by_id[x["id"]]
        except FileNotFoundError:
            continue
    return out


def presence(deps: set[str]) -> dict[str, set[str]]:
    """idEvento -> deputados (dos pedidos) na lista de presença."""
    out: dict[str, set[str]] = defaultdict(set)
    for y in YEARS:
        try:
            for x in _csv_rows(f"{FILES}/eventosPresencaDeputados/csv/eventosPresencaDeputados-{y}.csv"):
                if x["idDeputado"] in deps:
                    out[x["idEvento"]].add(x["idDeputado"])
        except FileNotFoundError:
            continue
    return out


def staff_points(deps: set[str]) -> dict[str, str]:
    """ponto do secretário -> deputado da lotação (dos pedidos)."""
    out = {}
    for x in _csv_rows("https://dadosabertos.camara.leg.br/arquivos/funcionarios/csv/funcionarios.csv"):
        dep = (x.get("uriLotacao") or "").rstrip("/").rsplit("/", 1)[-1]
        if dep in deps and x.get("grupo") == "Secretário Parlamentar":
            out[f"camara:{x['ponto']}"] = dep
    return out


def orgaos(dep: str) -> set[tuple[str, date | None]]:
    return {(str(o["idOrgao"]), parse_date(o.get("dataInicio")))
            for o in paginate_camara(f"{API}/deputados/{dep}/orgaos?dataInicio=2019-01-01&itens=100", max_age=7 * 86400)}


def contact_values(i: Ident) -> set[str]:
    st = i.detail.get("ultimoStatus") or {}
    g = st.get("gabinete") or {}
    vals = {(g.get("email") or "").lower(), f"(61) {g['telefone']}" if g.get("telefone") else ""}
    vals |= set(i.detail.get("redeSocial") or [])
    if i.detail.get("urlWebsite"):
        vals.add(i.detail["urlWebsite"])
    return {v for v in vals if v}


# ---------- separação ----------

class Splitter:
    def __init__(self, conn: psycopg.Connection, apply: bool):
        self.conn, self.apply = conn, apply
        self.stats: Counter = Counter()
        self.log_rows: list[tuple] = []
        self.body = str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])

    def _log(self, it: dict, w: str, table: str, action: str, key: str, raw: dict, note: str | None = None) -> None:
        self.stats[(it["slug"], w, table, action)] += 1
        self.log_rows.append((BUG, it["source"], w, it["pid"], table, action, key, json.dumps(raw, default=str, ensure_ascii=False), note))

    def _flush_log(self) -> None:
        if self.apply and self.log_rows:
            cur = self.conn.cursor()
            cur.executemany(
                """insert into identity_split_log (bug, source, external_id, person_id, table_name, action, row_key, raw, note)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict (bug, source, external_id, table_name, row_key) do nothing""",
                self.log_rows)
        self.log_rows = []

    def _delete(self, it: dict, w: str, table: str, rows: list[dict], key_cols: tuple[str, ...], note: str | None = None) -> None:
        for chunk in chunked(rows, BATCH):
            for r in chunk:
                self._log(it, w, table, "removido", ":".join(str(r[k]) for k in key_cols), r, note)
            if self.apply:
                where = " and ".join(f"{k} = %s" for k in key_cols)
                self.conn.cursor().executemany(f"delete from {table} where {where}", [tuple(r[k] for k in key_cols) for r in chunk])
                self._flush_log()
                self.conn.commit()
        self._flush_log()

    def split(self, it: dict, src: dict[str, Any]) -> None:
        pid, R = it["pid"], it["right"]
        for W in it["wrong"]:
            if it["source"] != "camara":
                raise NotImplementedError(f"separação do Senado não implementada ({W}); nenhum caso hoje")
            c = self.conn
            # 1) chaves da fonte com o id
            self._delete(it, W, "expenses", c.execute(
                "select * from expenses where person_id = %s and source_key ~ %s", (pid, rf"^cota(api)?\d{{4}}:{W}:")).fetchall(), ("id",))
            self._delete(it, W, "party_observations", c.execute(
                "select * from party_observations where person_id = %s and source = 'camara' and source_key like %s", (pid, f"camara:{W}:%")).fetchall(), ("id",))
            self._delete(it, W, "speeches", c.execute(
                "select * from speeches where person_id = %s and body_id = %s and source_key like %s", (pid, self.body, f"{W}:%")).fetchall(), ("id",))
            # 2) votos
            vs = c.execute(
                """select v.*, e.source_key ev_key from votes v join voting_events e on e.id = v.voting_event_id
                   where v.person_id = %s and e.body_id = %s""", (pid, self.body)).fetchall()
            gone, fix = [], []
            for v in vs:
                who = src["votes"].get(v["ev_key"], {})
                if R and R in who:
                    from .camara_diario import VOTE  # só leitura do mapa de valores

                    val, party = VOTE.get(who[R]["voto"]), src["parties"].get(who[R]["deputado_siglaPartido"])
                    if val and (val != v["value"] or (party and str(party) != str(v["party_id"]))):
                        fix.append((v, val, party))
                elif W in who:
                    gone.append(v)
            self._delete(it, W, "votes", [{k: x for k, x in v.items() if k != "ev_key"} for v in gone], ("id",), "voto só do outro deputado")
            for v, val, party in fix:
                self._log(it, W, "votes", "alterado", str(v["id"]), v, f"voto de {R}: {val}")
                if self.apply:
                    c.execute("update votes set value = %s, party_id = coalesce(%s, party_id), updated_at = now() where id = %s", (val, party, v["id"]))
            # 3) autorias
            au = c.execute(
                """select a.*, p.type, p.number, p.year from proposal_authors a join proposals p on p.id = a.proposal_id
                   where a.person_id = %s and p.body_id = %s""", (pid, self.body)).fetchall()
            gone = [a for a in au if W in src["authors"].get((a["type"], a["number"], a["year"]), set())
                    and not (R and R in src["authors"].get((a["type"], a["number"], a["year"]), set()))]
            self._delete(it, W, "proposal_authors", [{k: x for k, x in a.items() if k not in ("type", "number", "year")} for a in gone],
                         ("proposal_id", "person_id"), "autoria só do outro deputado")
            # 4) presença refeita para R
            self._attendance(it, W, R, src)
            # 5) comissões, contatos, equipe
            wrong_org = orgaos(W)
            right_org = orgaos(R) if R else set()
            cm = c.execute(
                """select cm.*, k.source_key org from committee_memberships cm join committees k on k.id = cm.committee_id
                   where cm.person_id = %s and k.body_id = %s""", (pid, self.body)).fetchall()
            gone = [m for m in cm if (m["org"], m["from_on"]) in wrong_org and (m["org"], m["from_on"]) not in right_org]
            self._delete(it, W, "committee_memberships", [{k: x for k, x in m.items() if k != "org"} for m in gone], ("id",))
            wv = contact_values(it["ids"][W]) - (contact_values(it["ids"][R]) if R else set())
            mc = c.execute(
                """select mc.* from mandate_contacts mc join mandates m on m.id = mc.mandate_id join sources s on s.id = mc.source_id
                   where m.person_id = %s and s.slug = 'camara'""", (pid,)).fetchall()
            self._delete(it, W, "mandate_contacts", [m for m in mc if m["value"] in wv], ("id",))
            pts = {k for k, d in src["staff"].items() if d == W}
            self._delete(it, W, "staff_members", c.execute(
                "select * from staff_members where person_id = %s and source_key = any(%s)", (pid, list(pts))).fetchall(), ("id",))
            # 6) o vínculo
            self._delete(it, W, "person_external_ids", c.execute(
                """select e.* from person_external_ids e join sources s on s.id = e.source_id
                   where s.slug = %s and e.external_id = %s and e.person_id = %s""", (it["source"], W, pid)).fetchall(), ("id",))
        # 7) nome e foto da casa para R
        if R:
            i = it["ids"][R]
            p = c.execute("select id, display_name, photo_source_url from people where id = %s", (pid,)).fetchone()
            if (i.display and i.display != p["display_name"]) or (i.photo and i.photo != p["photo_source_url"]):
                self._log(it, ",".join(it["wrong"]), "people", "alterado", pid, dict(p), f"nome e foto de {it['source']} {R}: {i.display}")
                if self.apply:
                    c.execute("update people set display_name = coalesce(%s, display_name), photo_source_url = coalesce(%s, photo_source_url), updated_at = now() where id = %s",
                              (i.display, i.photo, pid))
        self._flush_log()
        if self.apply:
            c.commit()

    def _attendance(self, it: dict, W: str, R: str | None, src: dict[str, Any]) -> None:
        from .camara_presenca import LEG_START, exercise_intervals  # só leitura da regra

        c, pid = self.conn, it["pid"]
        rows = c.execute(
            """select a.*, s.source_key sess_key, s.starts_at from attendance a join sessions s on s.id = a.session_id
               where a.person_id = %s and s.body_id = %s""", (pid, self.body)).fetchall()
        intervals = exercise_intervals(R, set(LEG_START)) if R else []
        if intervals is None:
            raise RuntimeError(f"/historico de {R} indisponível: presença não refeita")
        gone, fix = [], []
        for a in rows:
            here = R in src["presence"].get(a["sess_key"], set()) if R else False
            in_ex = any(x <= a["starts_at"] and (y is None or a["starts_at"] < y) for x, y in intervals)
            want = "presente" if here else "ausente" if in_ex else None
            if want is None:
                gone.append(a)
            elif want != a["status"]:
                fix.append((a, want))
        self._delete(it, W, "attendance", [{k: x for k, x in a.items() if k not in ("sess_key", "starts_at")} for a in gone], ("id",),
                     f"{R or '-'} fora de exercício e fora da lista")
        for a, want in fix:
            self._log(it, W, "attendance", "alterado", str(a["id"]), {k: x for k, x in a.items() if k not in ("sess_key", "starts_at")}, f"{R}: {want}")
            if self.apply:
                c.execute("update attendance set status = %s, updated_at = now() where id = %s", (want, a["id"]))


def run_fix(conn: psycopg.Connection, apply: bool) -> list[dict[str, Any]]:
    items = classify(conn)
    todo = [it for it in items if it["verdict"] == "separar"]
    for it in items:
        if it["verdict"] == "ambiguo":
            log.error("ambíguo, não mexi: %s %s %s", it["source"], it["slug"], list(it["ids"]))
    if not todo:
        log.info("nada a separar")
        return items
    deps = {x for it in todo for x in [*it["wrong"], *([it["right"]] if it["right"] else [])]}
    log.info("lendo a fonte para %s", sorted(deps))
    src = dict(votes=votes_by_event(deps), authors=authors_by_proposal(deps), presence=presence(deps), staff=staff_points(deps),
               parties=PartyResolver(conn))
    sp = Splitter(conn, apply)
    for it in todo:
        sp.split(it, src)
    for k in sorted(sp.stats):
        log.info("%s %s %s %s: %d", *k, sp.stats[k])
    log.info("%s: %d pessoa(s) separada(s)%s", BUG, len(todo), "" if apply else " (dry-run: use --apply)")
    return items


# ---------- devolução (D227): o id separado vira pessoa própria e recebe os fatos dele ----------

RESTAURAR = ("160532", "74459")  # ids com fatos no banco; 74131 (Bacelar pai) não tinha nenhum e não ganha crachá


def run_restore(conn: psycopg.Connection, apply: bool, ids: tuple[str, ...] = RESTAURAR) -> dict[str, str]:
    """Cria a pessoa de cada id separado (detalhe da API da Câmara) e devolve a ela: cota e observações de partido de
    identity_split_log (as mesmas linhas, mesmo id), votos e autorias pelos arquivos da Câmara. A presença é refeita depois
    pelo civico-etl camara.presenca (regra oficial); candidaturas e mandatos, pelo civico-etl tse.candidatos (nome + nascimento)."""
    from ..identity import PersonResolver
    from .camara_diario import VOTE

    pr = PersonResolver(conn)
    parties = PartyResolver(conn)
    by_uf = {r["uf"]: str(r["id"]) for r in conn.execute("select uf, id from places where kind = 'uf'")}
    body = str(conn.execute("select id from legislative_bodies where kind = 'camara_deputados'").fetchone()["id"])
    out: dict[str, str] = {}
    for W in ids:
        pid = pr.by_external("camara", W)
        i = fetch_ident("camara", W)
        st = i.detail.get("ultimoStatus") or {}
        if not pid:
            log.info("criar pessoa para %s: %s (%s, %s)", W, i.display, i.civil, i.birth)
            if not apply:
                continue
            pid = pr.create(display_name=i.display or i.civil, civil_name=i.civil, gender={"M": "m", "F": "f"}.get(i.detail.get("sexo") or ""),
                            birth_date=i.birth, birthplace_place_id=None, education=i.detail.get("escolaridade"),
                            slug_hints=((st.get("siglaUf") or "").lower() or None, "deputado-federal"), source="camara", external_id=W,
                            photo_source_url=i.photo)
            pr.flush()
            conn.execute("update people set photo_license = 'Câmara dos Deputados' where id = %s", (pid,))
            conn.commit()
        out[W] = pid
        cur = conn.cursor()
        n = Counter()
        for table, cols in (("expenses", None), ("party_observations", None)):
            rows = conn.execute("select raw from identity_split_log where bug = %s and external_id = %s and table_name = %s and action = 'removido'",
                                (BUG, W, table)).fetchall()
            for chunk in chunked([r["raw"] for r in rows], BATCH):
                for raw in chunk:
                    raw = dict(raw, person_id=pid)
                    k = [c for c in raw if c not in ("created_at", "updated_at")]
                    if apply:
                        n[table] += cur.execute(f"insert into {table} ({', '.join(k)}) overriding system value select {', '.join(k)} from jsonb_populate_record(null::{table}, %s::jsonb) on conflict do nothing",
                                                (json.dumps(raw, default=str),)).rowcount
                    else:
                        n[table] += 1
                if apply:
                    conn.commit()
        # votos: mesma regra do loader (votacoesVotos, voto vazio não é voto)
        ev = {r["source_key"]: str(r["id"]) for r in conn.execute("select source_key, id from voting_events where body_id = %s", (body,))}
        vrows = []
        for vid, who in votes_by_event({W}).items():
            x = who.get(W)
            val = VOTE.get((x or {}).get("voto") or "")
            if x and val and vid in ev:
                vrows.append((ev[vid], pid, parties.get(x["deputado_siglaPartido"]), val))
        # autorias: mesma regra de papel do loader
        props = {(r["type"], r["number"], r["year"]): str(r["id"]) for r in conn.execute("select id, type, number, year from proposals where body_id = %s", (body,))}
        arows = []
        for y in YEARS:
            try:
                au = [x for x in _csv_rows(f"{FILES}/proposicoesAutores/csv/proposicoesAutores-{y}.csv") if (x["idDeputadoAutor"] or "").strip() == W]
            except FileNotFoundError:
                continue
            ids_ = {x["idProposicao"]: x for x in au}
            for x in _csv_rows(f"{FILES}/proposicoes/csv/proposicoes-{y}.csv"):
                a = ids_.get(x["id"])
                if a and x["numero"].isdigit():
                    p_ = props.get((x["siglaTipo"], int(x["numero"]), int(x["ano"] or y)))
                    if p_:
                        order = int(a["ordemAssinatura"] or 0) or None
                        prop = a["proponente"] == "1"
                        arows.append((p_, pid, "principal" if prop and (order or 1) == 1 else "coautoria" if prop else "apoio", order))
        if apply:
            for chunk in chunked(vrows, BATCH):
                n["votes"] += cur.executemany("insert into votes (voting_event_id, person_id, party_id, value) values (%s, %s, %s, %s) on conflict do nothing", chunk) or 0
                conn.commit()
            for chunk in chunked(arows, BATCH):
                cur.executemany("insert into proposal_authors (proposal_id, person_id, role, sign_order) values (%s, %s, %s, %s) on conflict do nothing", chunk)
                conn.commit()
        n["votes_fonte"], n["proposal_authors_fonte"] = len(vrows), len(arows)
        log.info("%s -> %s: %s%s", W, pid, dict(n), "" if apply else " (dry-run)")
    return out
