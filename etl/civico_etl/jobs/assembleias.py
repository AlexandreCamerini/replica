"""Assembleias Legislativas (W3-A): núcleo comum dos adaptadores por UF (alesp.py, almg.py).

O que este módulo faz, igual para toda Assembleia:
  * crawler educado: User-Agent identificado (http.UA), 1 requisição por vez, intervalo >= 1 s por host,
    robots.txt respeitado (com curinga * e $, regra mais longa vence, Allow vence empate), cache em disco (http.fetch);
  * identidade: casa o deputado da Assembleia com a pessoa que o TSE já carregou (mandato de deputado estadual na UF).
    Nunca cria pessoa (D34/D42) e nunca chuta: sem casamento único e corroborado vai para identity_match_queue e log;
  * grava propostas (só projetos: lei, lei complementar, emenda à Constituição, resolução, decreto legislativo),
    autorias e verba/cota de gabinete; substitui o conjunto do ano (idempotente);
  * cobertura (data_coverage) da UF com o motivo de cada "—" e carimbo por conjunto (dataset_stamps via db.run).

Datasets: ale<uf>.proposicoes.AAAA e ale<uf>.despesas.AAAA (ex.: alesp.despesas.2025). O derive.stats lê esses
carimbos para saber que o ano foi carregado (ano sem carimbo -> null, nunca 0).
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable
from urllib.parse import urlparse

import psycopg

from .. import http as H
from ..db import upsert
from ..parties import RENAMES
from ..util import fold, party_key

log = logging.getLogger("etl.assembleias")

# 1 requisição por segundo por host, no máximo (pedido do dono: intervalo >= 1 s). Vale para o processo inteiro do job.
MIN_INTERVAL = 1.1
H.RATE = 1 / MIN_INTERVAL

# Só projetos que viram norma. Indicação, requerimento, moção e pedido de informação ficam fora (D101).
LAW_TYPES = {"PL", "PLC", "PEC"}
KEEP_TYPES = LAW_TYPES | {"PR", "PDL"}

# preposição de cada UF no nome da Assembleia ("a Assembleia da Bahia")
UF_NAME = {
    "AC": "do Acre", "AL": "de Alagoas", "AM": "do Amazonas", "AP": "do Amapá", "BA": "da Bahia", "CE": "do Ceará",
    "DF": "do Distrito Federal", "ES": "do Espírito Santo", "GO": "de Goiás", "MA": "do Maranhão", "MG": "de Minas Gerais",
    "MS": "de Mato Grosso do Sul", "MT": "de Mato Grosso", "PA": "do Pará", "PB": "da Paraíba", "PE": "de Pernambuco",
    "PI": "do Piauí", "PR": "do Paraná", "RJ": "do Rio de Janeiro", "RN": "do Rio Grande do Norte", "RO": "de Rondônia",
    "RR": "de Roraima", "RS": "do Rio Grande do Sul", "SC": "de Santa Catarina", "SE": "de Sergipe", "SP": "de São Paulo",
    "TO": "do Tocantins",
}


def not_read_reason(uf: str) -> str:
    casa = "a Câmara Legislativa do Distrito Federal" if uf == "DF" else f"a Assembleia Legislativa {UF_NAME.get(uf, uf)}"
    return f"{casa} ainda não é lida pelo site"


# ---------------------------------------------------------------- robots.txt

_robots: dict[str, list[tuple[bool, str]]] = {}


def _robots_rules(host_url: str) -> list[tuple[bool, str]]:
    p = urlparse(host_url)
    base = f"{p.scheme}://{p.netloc}"
    if base in _robots:
        return _robots[base]
    rules: list[tuple[bool, str]] = []
    try:
        txt = H.fetch(f"{base}/robots.txt", max_age=86400).text()
    except FileNotFoundError:
        txt = ""
    agents: list[str] = []
    in_rules = False
    groups: dict[str, list[tuple[bool, str]]] = defaultdict(list)
    for line in txt.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = (x.strip() for x in line.split(":", 1))
        k = k.lower()
        if k == "user-agent":
            if in_rules:
                agents, in_rules = [], False
            agents.append(v.lower())
        elif k in ("allow", "disallow"):
            in_rules = True
            if v:
                for a in agents:
                    groups[a].append((k == "allow", v))
    ua = "civico-etl"
    rules = groups.get(ua) or groups.get("*") or []
    _robots[base] = rules
    return rules


def _pattern(rule: str) -> re.Pattern[str]:
    end = rule.endswith("$")
    body = re.escape(rule[:-1] if end else rule).replace(r"\*", ".*")
    return re.compile("^" + body + ("$" if end else ""))


def allowed(url: str) -> bool:
    """robots.txt (RFC 9309): a regra mais longa que casa vence; empate, Allow vence. Sem regra: permitido."""
    p = urlparse(url)
    path = p.path + (f"?{p.query}" if p.query else "")
    best: tuple[int, bool] | None = None
    for allow, rule in _robots_rules(url):
        if _pattern(rule).match(path):
            cand = (len(rule), allow)
            if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                best = cand
    return True if best is None else best[1]


class Disallowed(Exception):
    pass


def polite_fetch(url: str, **kw: Any) -> H.Fetched:
    if not allowed(url):
        raise Disallowed(f"robots.txt não permite {url}")
    return H.fetch(url, **kw)


def polite_json(url: str, **kw: Any) -> Any:
    return polite_fetch(url, accept="application/json", **kw).json()


# ---------------------------------------------------------------- identidade

_STOP = {"de", "da", "do", "das", "dos", "e", "deputado", "deputada"}


def name_key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", fold(s))


def name_tokens(s: str | None) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9]+", fold(s)) if t and t not in _STOP and len(t) > 1}


def norm_party(s: str | None) -> str:
    k = party_key(s)
    return RENAMES.get(k, k)


@dataclass
class Cand:
    person_id: str
    display: str
    civil: str | None
    birth: date | None
    parties: set[str] = field(default_factory=set)
    spans: list[tuple[date, date]] = field(default_factory=list)  # mandatos de deputado estadual na UF


@dataclass
class MatchLog:
    matched: int = 0
    linked_new: int = 0
    queued: list[str] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)


class AssemblyMatcher:
    """Casa deputado da Assembleia -> pessoa com mandato de deputado estadual na UF (vindo do TSE).

    Ordem: (0) vínculo já gravado; (1) nome civil + nascimento, único; (2) nome de urna igual, único, corroborado por
    partido (qualquer partido que a pessoa teve: mandato, candidatura ou filiação), aniversário ou legislatura (a data do
    fato cai num mandato estadual dela na UF); (3) nomes que se
    contêm (ex.: "Alex Madureira" x "Alex de Madureira"), único, corroborado por aniversário quando a fonte publica,
    senão por partido. Qualquer outra coisa: fila + log. Nunca cria pessoa.
    """

    def __init__(self, conn: psycopg.Connection, uf: str, source_slug: str):
        self.conn, self.uf, self.source_slug = conn, uf, source_slug
        self.source_id = str(conn.execute("select id from sources where slug = %s", (source_slug,)).fetchone()["id"])
        self.links: dict[str, str] = {
            r["external_id"]: str(r["person_id"])
            for r in conn.execute("select external_id, person_id from person_external_ids where source_id = %s", (self.source_id,))
        }
        self.cands: dict[str, Cand] = {}
        for r in conn.execute(
            """select p.id, p.display_name, p.civil_name, p.birth_date, m.started_on, m.ends_on
               from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id join people p on p.id = m.person_id
               where o.slug in ('deputado_estadual', 'deputado_distrital') and pl.uf = %s and m.status <> 'eleito_aguardando_posse'""",
            (uf,),
        ):
            c = self.cands.setdefault(str(r["id"]), Cand(str(r["id"]), r["display_name"], r["civil_name"], r["birth_date"]))
            c.spans.append((r["started_on"], r["ends_on"]))
        ids = list(self.cands)
        for r in conn.execute(
            """select x.person_id, pa.acronym from (
                 select person_id, party_id from mandates where person_id = any(%s::uuid[])
                 union select person_id, party_id from candidacies where person_id = any(%s::uuid[])
                 union select person_id, party_id from party_memberships where person_id = any(%s::uuid[])) x
               join parties pa on pa.id = x.party_id""",
            (ids, ids, ids),
        ):
            self.cands[str(r["person_id"])].parties.add(norm_party(r["acronym"]))
        self.by_key: dict[str, set[str]] = defaultdict(set)
        for c in self.cands.values():
            self.by_key[name_key(c.display)].add(c.person_id)
        self.log = MatchLog()
        self._new: list[tuple[str, str, str, str, float]] = []
        self._queue: list[tuple[str, str, str, str | None, float | None]] = []
        self._decided: dict[str, str | None] = {}

    def _birthday_ok(self, c: Cand, birthday: str | None) -> bool:
        return bool(birthday and c.birth and c.birth.strftime("%d/%m") == birthday)

    def match(self, ext_id: str, name: str, party: str | None = None, *, civil: str | None = None,
              birth: date | None = None, birthday: str | None = None, when: date | None = None) -> str | None:
        ext_id = str(ext_id)
        if ext_id in self._decided:
            return self._decided[ext_id]
        pid = self._match(ext_id, name, party, civil=civil, birth=birth, birthday=birthday, when=when)
        self._decided[ext_id] = pid
        return pid

    def _match(self, ext_id: str, name: str, party: str | None, *, civil: str | None, birth: date | None, birthday: str | None, when: date | None) -> str | None:
        raw = {"nome": name, "partido": party, "uf": self.uf, "nome_civil": civil, "nascimento": birth, "aniversario": birthday}
        if ext_id in self.links:
            pid = self.links[ext_id]
            if pid in self.cands:  # vínculo antigo só vale se a pessoa ainda tem mandato estadual na UF (check cobre)
                self.log.matched += 1
                return pid
        if birthday and not re.match(r"^\d{2}/\d{2}$", birthday):
            birthday = None
        if birth and not birthday:
            birthday = birth.strftime("%d/%m")
        p = norm_party(party) if party else None
        # (1) nome civil + nascimento
        if civil and birth:
            hits = [c.person_id for c in self.cands.values() if c.birth == birth and c.civil and name_key(c.civil) == name_key(civil)]
            if len(hits) == 1:
                return self._link(ext_id, hits[0], "name_birth", 0.95)
        # (2) nome de urna igual, corroborado
        hits = list(self.by_key.get(name_key(name), ()))
        if len(hits) == 1:
            c = self.cands[hits[0]]
            in_term = bool(when and any(a <= when < b for a, b in c.spans))
            if (p and p in c.parties) or self._birthday_ok(c, birthday) or (birth and c.birth == birth) or in_term:
                return self._link(ext_id, c.person_id, "name_birth_place", 0.9)
            return self._enqueue(ext_id, raw, c.person_id, 0.6, "nome igual sem partido, aniversário nem legislatura que confirme")
        if len(hits) > 1:
            return self._enqueue(ext_id, raw, None, None, f"{len(hits)} pessoas com o mesmo nome na UF")
        # (3) nomes que se contêm
        toks = name_tokens(name)
        if len(toks) >= 2:
            # o nome da casa contém o de urna ("Fabiana Bolsonaro" x "Fabiana B."), ou o contrário, ou cabe no nome civil
            # ("Dirceu Dalben" x Antonio Dirceu Dalben); a confirmação abaixo é obrigatória
            near = [c for c in self.cands.values()
                    if (name_tokens(c.display) and (toks <= name_tokens(c.display) or name_tokens(c.display) <= toks))
                    or (c.civil and toks <= name_tokens(c.civil))]
            if civil:
                near += [c for c in self.cands.values() if c.civil and c not in near and name_tokens(civil) == name_tokens(c.civil)]
            if birthday:
                ok = [c for c in near if self._birthday_ok(c, birthday)]
            else:
                ok = [c for c in near if p and p in c.parties]
            if len(ok) == 1:
                return self._link(ext_id, ok[0].person_id, "name_birth_place", 0.85)
            if near:
                return self._enqueue(ext_id, raw, near[0].person_id if len(near) == 1 else None, 0.5,
                                     f"nome parecido com {len(near)} pessoa(s), sem confirmação única")
        self.log.unmatched.append(f"{name} ({party or 's/ partido'}): sem mandato de deputado estadual na UF no TSE (suplente ou fora do diretório)")
        return None

    def _link(self, ext_id: str, pid: str, method: str, conf: float) -> str:
        self.links[ext_id] = pid
        self._new.append((pid, self.source_id, ext_id, method, conf))
        self.log.matched += 1
        self.log.linked_new += 1
        return pid

    def _enqueue(self, ext_id: str, raw: dict, cand: str | None, conf: float | None, why: str) -> None:
        self._queue.append((self.source_id, ext_id, json.dumps(raw, ensure_ascii=False, default=str), cand, conf))
        self.log.queued.append(f"{raw['nome']} ({raw.get('partido') or 's/ partido'}): {why}")
        return None

    def flush(self) -> None:
        if self._new:
            upsert(self.conn, "person_external_ids", ["person_id", "source_id", "external_id", "match_method", "match_confidence"],
                   self._new, ["source_id", "external_id"], update=[])
            self._new = []
        if self._queue:
            upsert(self.conn, "identity_match_queue", ["source_id", "external_id", "raw", "candidate_person_id", "confidence"],
                   self._queue, ["source_id", "external_id"], update=["raw", "candidate_person_id", "confidence"],
                   where="identity_match_queue.status = 'pendente'")
            self._queue = []

    def report(self) -> list[str]:
        out = [f"identidade {self.uf}: {self.log.matched} casados ({self.log.linked_new} novos), {len(self.log.queued)} na fila, {len(self.log.unmatched)} sem crachá"]
        for q in sorted(set(self.log.queued)):
            log.warning("fila de identidade %s: %s", self.uf, q)
        for u in sorted(set(self.log.unmatched)):
            log.info("sem casamento %s: %s", self.uf, u)
        return out + [f"fila: {q}" for q in sorted(set(self.log.queued))][:20]


# ---------------------------------------------------------------- casa, fonte e cobertura

@dataclass
class Assembly:
    uf: str
    source_slug: str
    source_name: str
    source_url: str
    license: str | None
    body_id: str = ""
    place_id: str = ""


def ensure_assembly(conn: psycopg.Connection, a: Assembly) -> Assembly:
    upsert(conn, "sources", ["slug", "name", "url", "license"], [(a.source_slug, a.source_name, a.source_url, a.license)], ["slug"])
    row = conn.execute(
        """select b.id, b.place_id from legislative_bodies b join places p on p.id = b.place_id
           where p.kind = 'uf' and p.uf = %s and b.kind in ('assembleia', 'camara_legislativa_df')""",
        (a.uf,),
    ).fetchone()
    if not row:
        raise SystemExit(f"Assembleia de {a.uf} não existe em legislative_bodies: rode o seed")
    a.body_id, a.place_id = str(row["id"]), str(row["place_id"])
    conn.execute("update legislative_bodies set adapter = 'ale_custom', open_data_url = %s, updated_at = now() where id = %s and (adapter <> 'ale_custom' or open_data_url is distinct from %s)",
                 (a.source_url, a.body_id, a.source_url))
    conn.commit()
    return a


def set_coverage(conn: psycopg.Connection, a: Assembly, items: dict[str, tuple[str, str, str | None]]) -> None:
    """dataset -> (status, motivo, url de evidência). Só a UF desta Assembleia; checked_on = hoje."""
    rows = [(a.place_id, ds, st, why, url, date.today()) for ds, (st, why, url) in items.items()]
    upsert(conn, "data_coverage", ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"], rows, ["place_id", "dataset"])
    conn.commit()


# Texto padrão antigo do derive.stats ("a Assembleia publica; a carga ... próxima fase") afirmava sem conferir que a casa publica.
# Nas UFs ainda não lidas, troca só as linhas com esse texto padrão (linha conferida à mão nunca é tocada).
_OLD_DEFAULTS = (
    "a Assembleia publica; a carga do nível estadual entra na próxima fase",
    "ainda não conferimos se a Assembleia publica em dado aberto",
    "a Assembleia Legislativa ainda não é lida pelo site",
)


def reword_unread_coverage(conn: psycopg.Connection) -> int:
    n = 0
    for r in conn.execute(
        """select dc.id, p.uf from data_coverage dc join places p on p.id = dc.place_id
           join legislative_bodies b on b.place_id = p.id and b.kind in ('assembleia', 'camara_legislativa_df')
           where p.kind = 'uf' and b.adapter <> 'ale_custom' and dc.dataset in ('presenca','votos','propostas','gastos_gabinete')
             and dc.reason = any(%s)""",
        (list(_OLD_DEFAULTS),),
    ).fetchall():
        conn.execute("update data_coverage set reason = %s, checked_on = current_date where id = %s", (not_read_reason(r["uf"]), r["id"]))
        n += 1
    conn.commit()
    return n


# ---------------------------------------------------------------- escrita

@dataclass
class PropRow:
    type: str
    number: int
    year: int
    summary: str
    status: str | None
    presented_on: date | None
    url: str | None
    authors: list[tuple[str, str]]  # (person_id, role) já casados; role principal|coautoria


def write_proposals(conn: psycopg.Connection, a: Assembly, year: int, props: Iterable[PropRow]) -> tuple[int, int]:
    """Substitui as autorias do ano desta Assembleia (proposta fica; autoria some se a fonte tirou). Devolve (propostas, autorias)."""
    props = [p for p in props if p.type in KEEP_TYPES and p.authors]
    ids: dict[tuple[str, int, int], str] = {}
    for row in upsert(conn, "proposals", ["body_id", "type", "number", "year", "summary_official", "can_become_law", "status", "presented_on", "url"],
                      [(a.body_id, p.type, p.number, p.year, p.summary or "(sem ementa publicada)", p.type in LAW_TYPES, p.status, p.presented_on, p.url) for p in props],
                      ["body_id", "type", "number", "year"], returning=["id", "type", "number", "year"]):
        ids[(row["type"], int(row["number"]), int(row["year"]))] = str(row["id"])
    conn.execute(
        "delete from proposal_authors pa using proposals p where p.id = pa.proposal_id and p.body_id = %s and p.year = %s",
        (a.body_id, year),
    )
    au = []
    for p in props:
        pid = ids.get((p.type, p.number, p.year))
        seen: set[str] = set()
        for i, (person, role) in enumerate(p.authors):
            if pid and person not in seen:
                seen.add(person)
                au.append((pid, person, role, i + 1))
    upsert(conn, "proposal_authors", ["proposal_id", "person_id", "role", "sign_order"], au, ["proposal_id", "person_id"], update=["role", "sign_order"])
    return len(props), len(au)


def write_expenses(conn: psycopg.Connection, a: Assembly, year: int, rows: list[tuple]) -> int:
    """rows: (person_id, occurred_on, category, supplier_name, supplier_doc, amount_cents, receipt_url, source_key).
    Substitui o ano: o que a fonte tirou sai (só desta Assembleia e deste ano)."""
    keys = [r[7] for r in rows]
    conn.execute(
        "delete from expenses where body_id = %s and occurred_on >= %s and occurred_on < %s and not (source_key = any(%s))",
        (a.body_id, date(year, 1, 1), date(year + 1, 1, 1), keys),
    )
    out = upsert(conn, "expenses", ["person_id", "body_id", "occurred_on", "category", "supplier_name", "supplier_doc", "amount_cents", "currency", "receipt_url", "source_key"],
                 [(r[0], a.body_id, r[1], r[2], r[3], r[4], r[5], "BRL", r[6], r[7]) for r in rows], ["body_id", "source_key"], returning=["id"])
    return len(out)


def supplier(name: str | None, doc: str | None) -> tuple[str | None, str | None]:
    """D84: fornecedor só com CNPJ (14 dígitos, não zerado). CPF/MEI com CPF no nome: sem nome e sem documento."""
    d = re.sub(r"\D", "", doc or "")
    if len(d) != 14 or not d.strip("0"):
        return None, None
    n = (name or "").strip() or None
    if n and (re.search(r"\d{3}\.\d{3}\.\d{3}-\d{2}", n) or re.search(r"\d{11}", n)):
        return None, d
    return n, d


def category_label(s: str) -> str:
    """'D - MATERIAIS E SERVIÇOS GRÁFICOS' -> 'Materiais e serviços gráficos' (só a caixa; o texto é o da fonte)."""
    s = re.sub(r"^[A-Z]\s*-\s*", "", (s or "").strip())
    if s.isupper():
        s = s.lower()
        s = s[:1].upper() + s[1:]
    return s or "Sem categoria"


def sleep_between() -> None:
    time.sleep(MIN_INTERVAL)
