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
from ..util import BRT, cents, fold, midnight_br, nz, parse_date, parse_ts_br, sha256_text, titlecase_pt

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
OPEN = ("em_exercicio", "licenciado", "afastado")  # mandato aberto: ocupa (ou guarda) a cadeira
# teto do BUG-050: numa rodada normal sai um suplente ou outro (nov/2026: 26 abertos, 1 a fechar); acima disso é a fonte que
# mudou, e nenhum é encerrado
MAX_CLOSE = 5
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
    falhas: list[str] = []
    for y in years:
        _votes(conn, ctx, y, force)
        _proposals(conn, ctx, y, force)
        if expenses:
            # a cota de um ano que falha (API da cota fora do ar) não tira do ciclo as votações e proposições do ano seguinte;
            # o job ainda sai com erro no fim, para a agenda alertar e tentar de novo
            try:
                _expenses(conn, ctx, y, force)
            except Exception as e:  # noqa: BLE001
                log.error("câmara: cota de %d falhou, seguindo para o próximo ano", y, exc_info=True)
                falhas.append(f"{y}: {type(e).__name__}: {e}"[:300])
                try:
                    conn.rollback()  # falha fora de um run deixaria a sessão em transação abortada para o próximo ano
                except Exception as e2:  # noqa: BLE001  conexão caída: não há próximo ano, mas o motivo da cota não se perde
                    raise RuntimeError("cota da Câmara falhou em " + "; ".join(falhas) + f"; e a conexão não voltou ({type(e2).__name__})") from e2
    if falhas:
        raise RuntimeError("cota da Câmara falhou em " + "; ".join(falhas))


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
                                seat=(self.office, place) if place else None, display_name=display, uf=st.get("siglaUf"))
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
            if m.method == "queued":
                continue  # nome civil + nascimento ambíguo (D235): não tenta o nome de urna por cima da fila
            # trava do id único (D221, BUG-038): o nome de urna tem de ser único, e quem já tem outro id da Câmara não é candidato
            all_hits = by_ballot.get(key(x["nome"]), set())
            hits = ctx.people.free(all_hits, "camara")
            if len(all_hits) == 1 and len(hits) == 1:
                ctx.people.link(next(iter(hits)), "camara", dep, "name_birth_place", 0.9)
                n_name += 1
    ctx.people.flush()
    conn.commit()
    log.info("câmara legislatura %d: %d deputados ligados por nome civil + nascimento, %d por nome de urna", leg, n_birth, n_name)
    return n_birth + n_name


def mandato_da_camara(*, titular_na_fonte: bool, em_exercicio: bool, data: date | None, start: date, end: date,
                      aqui: list[tuple[date, date, str]], fora: list[tuple[date, date]]) -> tuple[str, Any, Any]:
    """Decide a linha de mandato de um deputado listado na legislatura [start, end). Pura (testada sem banco).

    `aqui`: mandatos de deputado federal já conhecidos da pessoa NESTA UF, (início, fim, papel). `fora`: os de OUTRAS UFs, (início, fim).
    A exclusão `no_overlapping_mandate` é por pessoa e cargo, sem a UF: a checagem aqui tem de olhar os dois.
    Devolve ("gravar", papel, início) | ("saiu", None, None) | ("recusar", motivo, None).

    - Titular: a fonte diz "Titular", ou o TSE já gravou o mandato de titular no início da legislatura (cassado vira "Não Eleito" na Câmara e
      segue sendo aquele mandato). Um mandato de SUPLENTE que começou no 1º dia não faz da pessoa titular (BUG-051).
    - Titular sem linha no início da legislatura e com mandato conhecido que cruza o período é suplente efetivado (BUG-052): segue a regra do
      suplente (reaproveita a chave do mandato aberto; depois de um encerrado, começa no fim dele ou na data da fonte, o que for mais tarde).
      O upsert troca o papel da linha para titular. Antes, isso inseria (início da legislatura, fim) por cima do mandato de suplente e a
      exclusão derrubava a carga inteira da Câmara.
    - Suplente fora do exercício não ganha mandato: "saiu" (close_suplentes encerra o que um run anterior abriu, BUG-050). Vale também
      para o efetivado que a fonte volta a chamar de suplente: a linha dele é `titular` com início depois do da legislatura, e o
      close_suplentes a alcança por isso.
    - Efetivado que sai com a fonte ainda dizendo "Titular" (renúncia, cassação) segue a convenção dos titulares: o status muda, o fim
      continua no fim da legislatura e a data de saída não é gravada.
    - Mandato do mesmo cargo em outra UF cruzando o período: a chave do upsert (pessoa, cargo, UF, início) não tem como reaproveitar
      a linha, e inserir estouraria a exclusão. Recusa o deputado, com o motivo, e a carga segue.
    """
    titular = titular_na_fonte or any(s == start and papel == "titular" for s, _, papel in aqui)
    # a linha do início da legislatura só é reaproveitada se for de titular ou estiver aberta: a de um suplente do 1º dia já encerrado
    # (fim no passado) fica como histórico, e a volta dele ganha linha nova pela regra de baixo
    no_inicio = any(s == start and (papel == "titular" or e >= end) for s, e, papel in aqui)
    if titular and (no_inicio or not any(s < end and e > start for s, e, _ in aqui)):
        started = start  # eleito titular: a linha do TSE (ou nenhuma ainda) no início da legislatura
    else:
        if not titular and not em_exercicio:
            return "saiu", None, None
        started = max(data or start, start)
        # mandato conhecido (run anterior) que cruza [started, end): reaproveita a chave do aberto (fim = fim da
        # legislatura) para não sobrepor; um já encerrado guarda o histórico e o novo começa no fim dele. Cobre a
        # volta com data antiga ou sem data (started = início da legislatura), que antes sobreporia o encerrado
        while True:
            over = [(s, e) for s, e, _ in aqui if s < end and e > started]
            opened = [s for s, e in over if e >= end]
            if opened:
                started = min(opened)
                break
            if not over:
                break
            started = max(e for _, e in over)
        if started >= end:
            return "recusar", "data da fonte no fim da legislatura ou depois: não há período a gravar", None
    # chave que já existe nesta UF vira só update (o fim não muda): a linha já convive com a de fora, não há o que estourar
    if not any(s == started for s, _, _ in aqui) and any(s < end and e > started for s, e in fora):
        return "recusar", "mandato do mesmo cargo em outra UF cruza o período", None
    return "gravar", "titular" if titular else "suplente_em_exercicio", started


def _deputies(conn: psycopg.Connection, ctx: _Ctx, leg: int, limit: int | None, force: bool) -> None:
    listing = list(paginate_camara(f"{API}/deputados?idLegislatura={leg}&itens=100&ordem=ASC&ordenarPor=nome"))
    if limit:
        listing = listing[:limit]
    checksum = f"{leg}:{len(listing)}:{limit}:" + ",".join(str(d["id"]) for d in listing)
    try:
        with run(conn, "camara.deputados", "camara") as r:  # detalhes mudam sem a lista mudar: sempre roda
            start, end = LEGISLATURES[leg]
            mandates, memberships = [], []
            gone: dict[str, tuple[date | None, str]] = {}  # suplente listado que deixou o exercício: pid -> (data da Câmara, status)
            # mandatos já conhecidos do cargo (TSE ou run anterior), por pessoa: evita sobreposição (a exclusão é por pessoa e cargo,
            # em qualquer UF) e reconhece titular eleito
            existing: dict[str, list[tuple[str, date, date, str]]] = defaultdict(list)
            for row in conn.execute("select person_id, place_id, started_on, ends_on, role from mandates where office_id = %s", (ctx.office,)):
                existing[str(row["person_id"])].append((str(row["place_id"]), row["started_on"], row["ends_on"], row["role"]))
            aceitos: set[str] = set()  # pessoas com linha neste lote: dois ids da Câmara na mesma pessoa não gravam duas linhas
            recusados: dict[str, list[str]] = defaultdict(list)  # motivo -> ids da Câmara
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
                known = existing.get(pid, [])
                # "Titular" = eleito titular. "Suplente"/"Não Eleito" = entrou depois (ou perdeu o mandato: cassado vira "Não Eleito" + "Vacância").
                # Se o TSE já registrou posse de titular nesta legislatura, o status da Câmara atualiza esse mandato.
                oque, papel, started = mandato_da_camara(
                    titular_na_fonte=condicao == "Titular", em_exercicio=status in OPEN, data=parse_date(st.get("data")), start=start, end=end,
                    aqui=[(s, e, role) for pl, s, e, role in known if pl == place], fora=[(s, e) for pl, s, e, _ in known if pl != place])
                if oque == "saiu":
                    # suplente que não está exercendo: sem mandato novo. Se um run anterior abriu o mandato de suplente,
                    # ele é encerrado depois do upsert (BUG-050: o titular voltou e o suplente ficava em exercício para sempre)
                    gone[pid] = (parse_date(st.get("data")), status)
                    continue
                if oque == "gravar" and pid in aceitos:
                    oque, papel = "recusar", "segundo id da Câmara para a mesma pessoa nesta listagem"
                if oque == "recusar":
                    # BUG-052: o que estouraria a exclusão no_overlapping_mandate sai do lote com o motivo; a carga dos outros segue
                    recusados[papel].append(str(d["id"]))
                    r.reject(1)
                    continue
                aceitos.add(pid)
                mandates.append((pid, ctx.office, place, ctx.body, party, papel, status, started, end, f"TSE {start.year - 1}", "camara"))
                if party:
                    # observação de partido (D05): mesma chave do /historico, que o job de presença também grava
                    seen = parse_date(st.get("data")) or start
                    memberships.append((pid, party, seen, "camara", f"camara:{d['id']}:{st.get('data') or start.isoformat()}"))
            # dois ids da Câmara na mesma pessoa, um fora do exercício e outro gravado: quem tem linha neste lote não saiu
            for pid in aceitos:
                gone.pop(pid, None)
            for motivo, ids in recusados.items():
                msg = f"{len(ids)} deputado(s) sem mandato gravado ({motivo}): camara {', '.join(sorted(ids))}"
                log.warning("câmara: %s", msg)
                r.partial(msg[:500])  # dado de mandato incoerente pede conferência: fecha parcial (alerta), não derruba a carga
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
            listed = {str(d0["id"]) for d0 in listing}
            # savepoint: se o encerramento falhar, o upsert acima fica e o run fecha como parcial em vez de cair inteiro.
            # Encerrados não entram em rows_upserted (contagem do upsert); vão na nota própria
            notes_before = list(r.notes)
            try:
                with conn.transaction():
                    close_suplentes(conn, ctx, r, gone, listed, start, end)
            except Exception as e:  # noqa: BLE001
                log.exception("câmara: encerramento de suplentes (BUG-050) falhou")
                r.notes = notes_before  # o savepoint desfez os encerramentos: a nota deles não vale
                r.partial(f"encerramento de suplentes (BUG-050) falhou, nenhum encerrado: {type(e).__name__}: {e}"[:500])
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


def _today() -> date:
    """Hoje do encerramento de suplente; função própria para o teste congelar a data (a legislatura 57 acaba em 2027-02-01)."""
    return date.today()


def close_suplentes(conn: psycopg.Connection, ctx: _Ctx, r: Run, gone: dict[str, tuple[date | None, str]], listed: set[str],
                    start: date, end: date) -> int:
    """BUG-050: encerra o mandato `suplente_em_exercicio` aberto de quem a Câmara lista na legislatura com situação fora do
    exercício (`gone`, ex.: "Suplência"). Entra também o `titular` com início depois do da legislatura: é o suplente efetivado
    (D320), que a fonte pode voltar a chamar de suplente; titular eleito começa no início da legislatura e nunca entra. Nunca apaga linha. Fim = `ultimoStatus.data`, com teto em hoje (check `mandate_order`).

    Não encerra (só anota no run):
    - suplente aberto ausente da listagem: a listagem da legislatura traz todo mundo que passou por ela, então ausência é
      anomalia da fonte (paginação curta, outra legislatura), não saída; encerrar gravaria uma data fabricada;
    - data da fonte anterior ao início do mandato (`ultimoStatus.data` também muda com troca de partido): seria um mandato inventado;
    - mandato iniciado hoje (fim > início não cabe até hoje);
    - tudo, se a rodada encerraria mais de MAX_CLOSE de uma vez (teto de segurança: conferir a fonte).
    Sem data na fonte: encerra com a data de hoje e anota que a data não veio da fonte."""
    today = _today()
    rows = conn.execute(
        """select m.id, m.person_id, m.started_on, m.ends_on, p.slug,
                  array(select e.external_id from person_external_ids e join sources s on s.id = e.source_id
                        where e.person_id = m.person_id and s.slug = 'camara') as camara_ids
           from mandates m join people p on p.id = m.person_id
           where m.office_id = %s and m.status = any(%s) and m.started_on >= %s and m.started_on < %s
             and (m.role = 'suplente_em_exercicio' or (m.role = 'titular' and m.started_on > %s))""",
        (ctx.office, list(OPEN), start, end, start),
    ).fetchall()
    # uma nota por motivo (MAX_NOTES): motivo -> "slug [id Câmara]"
    why: dict[str, list[str]] = defaultdict(list)
    plan: list[tuple[Any, str, date, str]] = []  # (mandate id, status, fim, rótulo)
    for row in sorted(rows, key=lambda x: x["slug"]):
        pid = str(row["person_id"])
        tag = f"{row['slug']} [camara {','.join(sorted(row['camara_ids'])) or '?'}]"
        if pid not in gone:
            if row["camara_ids"] and not set(row["camara_ids"]) & listed:
                why["suplente(s) com mandato aberto ausente(s) da listagem da legislatura: não encerrado(s)"].append(tag)
            continue
        data, status = gone[pid]
        if data is None:
            data = today
            why["suplente(s) fora do exercício sem ultimoStatus.data na Câmara: fim = data de hoje, que NÃO veio da fonte"].append(tag)
        elif data < row["started_on"]:
            why["suplente(s) fora do exercício com data da fonte anterior ao início do mandato: não encerrado(s)"].append(
                f"{tag} (fonte {data}, início {row['started_on']})")
            continue
        fim = min(data, today, row["ends_on"])
        if fim <= row["started_on"]:
            why["suplente(s) fora do exercício com mandato iniciado hoje: não encerrado(s)"].append(tag)
            continue
        plan.append((row["id"], status, fim, f"{tag} ({status}, {fim})"))
    if len(plan) > MAX_CLOSE:
        msg = f"{len(plan)} suplentes a encerrar acima do teto de {MAX_CLOSE}: nenhum encerrado; conferir a fonte: " + ", ".join(p[3] for p in plan)
        log.warning("câmara: %s", msg)
        r.partial(msg[:2000])
        plan = []
    for mid, status, fim, _ in plan:
        conn.execute(
            "update mandates set status = %s, ends_on = %s, status_source = 'camara', updated_at = now() where id = %s",
            (status, fim, mid),
        )
    if plan:
        # quem foi encerrado vai para o log do Actions e para o topo das notas, fora do limite MAX_NOTES de r.note
        msg = f"{len(plan)} suplente(s) fora do exercício encerrado(s) (fora de rows_upserted): {', '.join(p[3] for p in plan)}"
        log.warning("câmara: %s", msg)
        r.notes.insert(0, msg)
    for k, v in why.items():
        r.note(f"{len(v)} {k}: {', '.join(v)}")
    return len(plan)


def run_camara_noturna(conn: psycopg.Connection, *, days: int = 3, force: bool = False) -> None:
    """catálogo D06: segunda leitura, só das votações do Plenário dos últimos `days` dias (BRT). Lê os mesmos CSVs anuais (304 se não mudaram) e
    grava só os eventos recentes. Dataset próprio (`camara.noturna.ANO`): o checksum dos CSVs não pode fazer a carga completa
    (`camara.votacoes.ANO`) concluir "entrada igual" e pular correção de sessão mais antiga que o recorte.
    O CSV anual da Câmara é regerado entre 03:50 e 04:45 de Brasília: antes disso esta leitura vê o arquivo do dia anterior."""
    today = datetime.now(BRT).date()
    since = today - timedelta(days=days)
    ctx = _Ctx(conn)
    for y in sorted({since.year, today.year}):
        _votes(conn, ctx, y, force, since=since, dataset=f"camara.noturna.{y}")


def _votes(conn: psycopg.Connection, ctx: _Ctx, year: int, force: bool, *, since: date | None = None, dataset: str | None = None) -> None:
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
        with run(conn, dataset or f"camara.votacoes.{year}", "camara", input_checksum=checksum, force=force) as r:
            # proposição objeto de cada votação (primeira)
            prop_of: dict[str, dict[str, str]] = {}
            for x in _csv(f_pr.text()):
                prop_of.setdefault(x["idVotacao"], x)
            # votos: agrupa por votação
            votes_by: dict[str, list[dict[str, str]]] = defaultdict(list)
            for x in _csv(f_vt.text()):
                votes_by[x["idVotacao"]].append(x)
            events = [x for x in _csv(f_ev.text()) if x["siglaOrgao"] == "PLEN" and (since is None or (parse_date(x["data"]) or date.min) >= since)]
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


# BUG-020 / D180: a cota da Câmara publica VÁRIAS linhas por `ideDocumento` (emissão de passagem, estorno negativo, taxa de
# remarcação; e `ideDocumento = 0` em milhares de linhas sem documento, como telefonia). A chave antiga era só o ideDocumento:
# no upsert, só a última linha de cada documento sobrevivia (Adriana Ventura 2025: 89.595 no banco contra 104.693,75 na Câmara).
# Chave nova, por linha da fonte: arquivo do ano + deputado + documento + hash dos campos que distinguem a linha + ordinal entre
# linhas idênticas nesses campos. Não depende da ordem do arquivo (o ordinal só separa linhas indistinguíveis), então a
# recarga do mesmo arquivo grava as mesmas chaves; o que sumiu da fonte é apagado no mesmo run (prune por arquivo).
COTA_FIELDS = ("numSubCota", "numEspecificacaoSubCota", "txtCNPJCPF", "txtNumero", "indTipoDocumento", "datEmissao", "vlrDocumento",
               "vlrGlosa", "vlrLiquido", "numMes", "numParcela", "txtPassageiro", "txtTrecho", "numLote", "numRessarcimento", "vlrRestituicao")
# D181: desde 2025 a Câmara publica as passagens do SIGEPA novo (codDocumento UUID) só na API /deputados/{id}/despesas; o
# arquivo Ano-AAAA.csv.zip não traz essas linhas. A partir deste ano, o que a API tem e o arquivo não tem entra como complemento.
COTA_API_FROM = 2025


def cota_occurred(dat_emissao: str | None, ano: str | int | None, mes: str | int | None) -> date | None:
    """Data do lançamento. O ano que a Câmara usa nos totais é o da competência (numAno/numMes, o arquivo do ano); se a
    data de emissão cai em outro ano (nota emitida em dezembro e lançada em janeiro, data digitada errada), usa o 1º dia
    do mês de competência para o lançamento contar no ano em que a Câmara conta (D180)."""
    d = parse_date(dat_emissao) if dat_emissao else None
    try:
        a, m = int(str(ano).strip()), int(str(mes).strip())
    except (TypeError, ValueError):
        return d
    if not (1 <= m <= 12):
        return d if d and d.year == a else None
    if d and d.year == a:
        return d
    return date(a, m, 1)


def cota_liquido(vlr_documento: Any, vlr_glosa: Any, vlr_liquido: Any, glosa_em_outra_linha: bool = False) -> int | None:
    """Valor debitado da cota, em centavos (BUG-030 / D200, BUG-034 / D230).

    O dicionário de dados da Câmara (dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html) define
    `vlrLiquido = vlrDocumento - vlrGlosa`, e estorno legítimo (bilhete de compensação) vem com `vlrDocumento` negativo.
    Duas exceções publicadas na fonte, conferidas contra a página camara.leg.br/deputados/{id}?ano=:

    1. D200: lançamento administrativo ("COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA", subcota 40, e "PASSAGEM AÉREA - MISSÃO
       OFICIAL", subcota 996) vem com `vlrLiquido` = -(documento - glosa). A página soma (documento - glosa).
    2. D230: linha com glosa e `vlrLiquido` = documento - 2 x glosa (a glosa descontada duas vezes; 12 linhas em 2019–2026,
       subcotas 3, 14 e 120). A página soma `vlrDocumento` nas 11 linhas conferidas. A exceção é o rateio: quando a glosa
       foi lançada como linha própria do mesmo documento em outra subcota (`glosa_em_outra_linha`), o líquido bate com a
       página como está.

    O resto fica como a fonte publica, inclusive o líquido negativo que nenhuma das duas regras explica (D230: Enio Verri,
    10/2020, a página mostra um valor que não sai dos campos da linha).
    """
    liq = cents(vlr_liquido)
    doc = cents(vlr_documento)
    if liq is None or doc is None:
        return liq
    glosa = cents(vlr_glosa) or 0
    devido = doc - glosa
    if devido > 0 and liq == -devido:
        return devido
    if glosa > 0 and doc > 0 and liq == doc - 2 * glosa and not glosa_em_outra_linha:
        return doc
    return liq


def cota_glosa_em_outra_linha(rows: list[tuple[str, str, Any, Any]]) -> list[bool]:
    """Para cada linha (deputado, documento, vlrGlosa, vlrLiquido): outra linha do mesmo documento tem líquido igual à glosa
    desta (rateio do documento entre subcotas, com a glosa lançada na outra linha; D230). Documento vazio não agrupa."""
    by_doc: dict[tuple[str, str], list[tuple[int, int | None]]] = defaultdict(list)
    for i, (dep, doc, _gl, liq) in enumerate(rows):
        if _cota_doc(doc):
            by_doc[(dep, _cota_doc(doc))].append((i, cents(liq)))
    out = []
    for i, (dep, doc, gl, _liq) in enumerate(rows):
        g = cents(gl) or 0
        sib = by_doc.get((dep, _cota_doc(doc)), []) if _cota_doc(doc) else []
        out.append(g > 0 and any(j != i and liq == g for j, liq in sib))
    return out


def cota_keys(rows: list[tuple[str, str, tuple]], prefix: str) -> list[str]:
    """(deputado, documento, campos) -> chave estável por linha: prefixo:dep:doc:hash[#n]. n conta só linhas idênticas nos campos."""
    seen: dict[str, int] = defaultdict(int)
    out = []
    for dep, doc, fields in rows:
        base = f"{prefix}:{dep}:{doc or '-'}:{sha256_text(chr(31).join(str(f or '') for f in fields))[:16]}"
        n = seen[base]
        seen[base] += 1
        out.append(base if n == 0 else f"{base}#{n}")
    return out


def _cota_doc(doc: Any) -> str:
    d = "" if doc is None else str(doc).strip()
    return "" if d == "-" else d


def cota_api_liquido(x: dict, glosa_em_outra_linha: bool = False) -> int | None:
    """Mesma regra de `cota_liquido` para um item da API /deputados/{id}/despesas."""
    return cota_liquido(x.get("valorDocumento"), x.get("valorGlosa"), x.get("valorLiquido"), glosa_em_outra_linha)


def cota_api_amounts(api_rows: list[dict]) -> list[int | None]:
    """Valor de cada item da API com a regra de `cota_liquido`, com o rateio calculado entre os itens do mesmo deputado."""
    flags = cota_glosa_em_outra_linha([("", str(x.get("codDocumento") or ""), x.get("valorGlosa"), x.get("valorLiquido")) for x in api_rows])
    return [cota_api_liquido(x, f) for x, f in zip(api_rows, flags)]


def cota_seis_digitos(api_cents: int, file_cents: int) -> bool:
    """BUG-054: o arquivo Ano-AAAA.csv.zip traz os valores com 6 dígitos significativos (formato %g: 11892.53 -> "11892.5",
    290386.82 -> "290387"; nenhum valor >= 10.000 de cota2023 a cota2026 no banco tem centavos). Até 11/11/2026 a API
    devolvia o mesmo valor arredondado (160541/2025, missão oficial: 61932.8 nos dois); desde 12/11/2026 devolve o valor
    com centavos (61932.76), e o casamento exato deixou de achar o par. O valor do arquivo é o da API nessa precisão:
    diferença de até meia unidade do 6º dígito do valor da API (5 centavos de 10.000 a 99.999,99, 50 centavos de 100.000 a
    999.999,99) e o arquivo com os zeros finais dessa precisão. Abaixo de 10.000 só o valor exato casa. Se o arquivo
    passar a ter centavos, a regra não casa nada novo."""
    a = abs(api_cents)
    if a < 1_000_000 or (api_cents < 0) != (file_cents < 0):
        return False
    unit = 10 ** (len(str(a)) - 6)  # unidade do 6º dígito significativo, em centavos
    return file_cents % unit == 0 and abs(api_cents - file_cents) * 2 <= unit


def cota_api_extra(file_rows: list[tuple[str, int]], api_rows: list[dict]) -> list[dict]:
    """Linhas da API que o arquivo não tem: diferença de multiconjunto por (documento, valor líquido em centavos).
    Linhas do arquivo que a API não tem (telefonia sem documento) ficam: o arquivo é a fonte principal.

    Documento vazio: o arquivo traz `ideDocumento` vazio (gravado como "-" na chave) e a API traz `codDocumento` null; os dois
    são o mesmo "sem documento" (BUG-030: a passagem de missão oficial entrava duas vezes). O valor da API passa pela mesma
    regra de sinal do arquivo (`cota_liquido`).

    BUG-054: depois do casamento exato, uma segunda passada casa, no mesmo documento, o que sobrou nas duas mudanças da API
    vistas em 12/11/2026: (1) a API com centavos contra o arquivo com 6 dígitos significativos (`cota_seis_digitos`); (2) o
    `valorLiquido` negado nas linhas fora do SIGEPA (11892.53 / -11892.53; a regra D200 de `cota_liquido` já desfaz o caso
    líquido = -documento, mas não a parcela, 2500 / 0 / -311.55 contra +311.55 no arquivo): o valor da API com documento
    positivo e líquido negativo casa com a linha do arquivo de valor oposto. Estorno de verdade (documento negativo) não
    troca de sinal. Sem as duas passadas, a linha que o arquivo já tem entra de novo como complemento (cota em dobro).
    A passada (1) roda inteira antes da (2), para o resultado não depender da ordem da API; depois, (3) o documento que a
    API divide em várias linhas casa pela soma."""
    left: dict[tuple[str, int], int] = defaultdict(int)
    for doc, amount in file_rows:
        left[(_cota_doc(doc), amount)] += 1
    pending = []
    for x, amount in zip(api_rows, cota_api_amounts(api_rows)):
        k = (_cota_doc(x.get("codDocumento")), amount or 0)
        if left.get(k, 0) > 0:
            left[k] -= 1
        else:
            pending.append((x, amount or 0))
    by_doc: dict[str, list[int]] = defaultdict(list)
    for (doc, amount), n in left.items():
        by_doc[doc] += [amount] * n
    def take(t: int, cands: list[int]) -> bool:
        hit = next((f for f in cands if f == t or cota_seis_digitos(t, f)), None)
        if hit is None:
            return False
        cands.remove(hit)
        return True

    # 2a: todas as pendentes, só com o próprio valor (6 dígitos). Antes da negação, para a ordem da API não decidir quem casa.
    rest = [(x, a) for x, a in pending if not take(a, by_doc.get(_cota_doc(x.get("codDocumento")), []))]
    # 2b: o que sobrou, com o líquido negado pela API (documento > 0 e líquido < 0)
    rest2 = []
    for x, amount in rest:
        doc_value = cents(x.get("valorDocumento"))
        negado = amount < 0 and doc_value is not None and doc_value > 0
        if not (negado and take(-amount, by_doc.get(_cota_doc(x.get("codDocumento")), []))):
            rest2.append((x, amount))
    # 3: documento que a API divide em outras linhas (D230 em duas: 98057/7877201, arquivo 6805.82/528.49/5748.84 vale o
    # documento; a API traz -6277.33 e +528.49). Se a soma das pendentes da API no documento é a soma das linhas que sobraram
    # do arquivo nele (exata ou pelos 6 dígitos), o documento está coberto. Documento vazio fica de fora.
    by_api: dict[str, list[tuple[dict, int]]] = defaultdict(list)
    for x, amount in rest2:
        by_api[_cota_doc(x.get("codDocumento"))].append((x, amount))
    extra = []
    for doc, items in by_api.items():
        cands = by_doc.get(doc, [])
        if doc and cands:
            s_api, s_file = sum(a for _, a in items), sum(cands)
            if s_api == s_file or cota_seis_digitos(s_api, s_file):
                cands.clear()
                continue
        extra += [x for x, _ in items]
    order = {id(x): i for i, x in enumerate(api_rows)}
    return sorted(extra, key=lambda x: order[id(x)])


EXP_COLS = ["person_id", "body_id", "occurred_on", "category", "supplier_name", "supplier_doc", "amount_cents", "currency", "receipt_url", "source_key"]


def _write_year(conn: psycopg.Connection, body: str, prefix: str, rows: list[tuple]) -> int:
    """Grava em lotes e apaga o que o arquivo/API do ano não traz mais (mesmo prefixo). Uma transação por run."""
    n = 0
    for i in range(0, len(rows), 20000):
        n += len(upsert(conn, "expenses", EXP_COLS, rows[i:i + 20000], ["body_id", "source_key"], returning=["id"]))
    keys = [r[-1] for r in rows]
    gone = conn.execute(
        "delete from expenses where body_id = %s and source_key like %s and not (source_key = any(%s))",
        (body, prefix + ":%", keys),
    ).rowcount
    if gone:
        log.info("%s: %d lançamentos que a fonte não traz mais apagados", prefix, gone)
    return n


def _cat(s: str | None) -> str:
    s = (s or "").strip()
    return s[:1].upper() + s[1:].lower()


def _expenses(conn: psycopg.Connection, ctx: _Ctx, year: int, force: bool) -> None:
    try:
        f = fetch(f"https://www.camara.leg.br/cotas/Ano-{year}.csv.zip")
    except FileNotFoundError:
        log.warning("sem cota de %d", year)
        return
    prefix = f"cota{year}"
    # A API é consultada ANTES de gravar o arquivo (D321). O arquivo e o complemento da API fecham em commits separados; se o arquivo
    # entrasse primeiro e a API falhasse depois, as linhas que o arquivo passou a trazer ficariam em dobro com o complemento antigo
    # (BUG-054) até a API responder para todos os deputados. Sem a resposta de todos, nada deste ano é gravado: a cota fica como
    # estava (atrasada, não em dobro) e o job falha.
    api = _expenses_api_fetch(conn, year) if year >= COTA_API_FROM else None
    try:
        with run(conn, f"camara.despesas.{year}", "camara", input_checksum=f.checksum, force=force) as r:
            with zipfile.ZipFile(f.path) as z:
                name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                with z.open(name) as fh:
                    reader = list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), delimiter=";"))
                    realocada = cota_glosa_em_outra_linha([((x["ideCadastro"] or "").strip(), x["ideDocumento"], x["vlrGlosa"], x["vlrLiquido"]) for x in reader])
                    pending, ident, unknown, legacy_docs, legacy_fallback = [], [], set(), set(), []
                    for x, glosa_fora in zip(reader, realocada):
                        dep = (x["ideCadastro"] or "").strip()
                        if not dep:
                            continue  # lideranças e órgãos: não são pessoa
                        doc = (x["ideDocumento"] or "").strip()
                        legacy_docs.add(doc)
                        legacy_fallback.append(f"{dep}:{x['numAno']}:{x['numMes']}:{x['txtNumero']}:{x['txtCNPJCPF']}")
                        pid = ctx.person_for_deputy(dep, create=False)
                        if not pid:
                            unknown.add(dep)
                            continue
                        amount = cota_liquido(x["vlrDocumento"], x["vlrGlosa"], x["vlrLiquido"], glosa_fora)
                        occurred = cota_occurred(x["datEmissao"], x["numAno"], x["numMes"])
                        if amount is None or not occurred:
                            r.reject(1)
                            continue
                        ident.append((dep, doc, tuple(x.get(k) for k in COTA_FIELDS)))
                        pending.append((pid, ctx.body, occurred, _cat(x["txtDescricao"]), nz(x["txtFornecedor"]), nz(x["txtCNPJCPF"]), amount, "BRL", nz(x["urlDocumento"])))
            rows = [p + (k,) for p, k in zip(pending, cota_keys(ident, prefix))]
            r.add(_write_year(conn, ctx.body, prefix, rows))
            # chaves do formato antigo (só ideDocumento, ou o fallback dep:ano:mes:numero:cnpj) que vieram deste arquivo
            old = conn.execute(
                "delete from expenses where body_id = %s and source_key not like 'cota%%' and (source_key = any(%s) or source_key = any(%s))",
                (ctx.body, [d for d in legacy_docs if d], legacy_fallback),
            ).rowcount
            if old:
                r.notes.append(f"{old} lançamentos com chave antiga (só ideDocumento, BUG-020) substituídos")
            ctx.people.flush()
            if unknown:
                r.notes.append(f"{len(unknown)} deputados da cota sem cadastro: {sorted(unknown)[:10]}")
    except SkipUnchanged:
        pass
    if api is not None:
        _expenses_api(conn, ctx, year, api)


def _expenses_api_fetch(conn: psycopg.Connection, year: int) -> dict[tuple[str, str], list[dict]]:
    """Passada de rede do complemento da cota: (pessoa, id da Câmara) -> itens de /deputados/{id}/despesas no ano. Não grava dado.
    Se algum deputado ficar sem resposta, registra um run `camara.despesasapi.ANO` falho e levanta: quem chama ainda não gravou nada."""
    legs = sorted({n for n, (a, b) in LEGISLATURES.items() if a <= date(year, 12, 31) and b > date(year, 1, 1)})
    # deputados com mandato no ano (id da Câmara já ligado no diretório)
    deps = defaultdict(set)
    for row in conn.execute(
        """select distinct e.external_id, e.person_id from person_external_ids e join sources s on s.id = e.source_id and s.slug = 'camara'
           join mandates m on m.person_id = e.person_id join offices o on o.id = m.office_id and o.slug = 'deputado_federal'
           where m.started_on <= %s and m.ends_on > %s and m.status <> 'eleito_aguardando_posse'""",
        (date(year, 12, 31), date(year, 1, 1)),
    ):
        deps[str(row["person_id"])].add(row["external_id"])
    conn.commit()  # fecha a transação da leitura antes dos minutos de rede (o `run` que abria logo em seguida já fazia este commit)
    out: dict[tuple[str, str], list[dict]] = {}
    failed: list[str] = []
    for pid, ext_ids in sorted(deps.items()):
        for dep in sorted(ext_ids):
            items: list[dict] = []
            try:
                for leg in legs:
                    items += list(paginate_camara(f"{API}/deputados/{dep}/despesas?idLegislatura={leg}&ano={year}&itens=100&ordem=ASC&ordenarPor=dataDocumento", max_age=86400))
            except (httpx.HTTPError, OSError, ValueError) as e:
                # OSError cobre o 404 (FileNotFoundError) e o cache em disco; ValueError, corpo que não é JSON com HTTP 200.
                # Todos viram deputado sem resposta, para a falha ficar em ingest_runs em vez de escapar fora de um run
                failed.append(dep)
                log.warning("cota pela API: deputado %s %d sem resposta (%s)", dep, year, e)
                continue
            out[(pid, dep)] = items
    if failed:
        # sem a resposta de um deputado, o prune apagaria o complemento dele; e gravar o arquivo sem podar o complemento deixaria
        # a cota em dobro. Nada é gravado. O run existe só para a falha ficar em ingest_runs
        with run(conn, f"camara.despesasapi.{year}", "camara"):
            raise RuntimeError(f"API da cota sem resposta para {len(failed)} deputado(s) em {year}: {failed[:10]}; arquivo e complemento de {year} não gravados")
    return out


def _expenses_api(conn: psycopg.Connection, ctx: _Ctx, year: int, api: dict[tuple[str, str], list[dict]]) -> None:
    """D181: complemento da API para o que o arquivo não traz (passagens SIGEPA com codDocumento UUID). Sempre roda (a API
    muda sem o arquivo mudar); o prefixo próprio (cotaapi) faz o prune não tocar nas linhas do arquivo.
    `api` vem de _expenses_api_fetch, lida antes de o arquivo ser gravado e completa (todo deputado respondeu); a diferença contra o
    arquivo é calculada aqui, depois do commit dele."""
    prefix = f"cotaapi{year}"
    # linhas do arquivo de cada deputado, por (documento, valor)
    file_rows: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for row in conn.execute("select source_key, amount_cents from expenses where body_id = %s and source_key like %s", (ctx.body, f"cota{year}:%")):
        _, dep, doc, _h = row["source_key"].split(":", 3)
        file_rows[dep].append((doc, row["amount_cents"]))
    with run(conn, f"camara.despesasapi.{year}", "camara") as r:
        rows, ident = [], []
        for pid, dep in sorted(api):
            items = api[(pid, dep)]
            amounts = {id(x): a for x, a in zip(items, cota_api_amounts(items))}
            for x in cota_api_extra(file_rows.get(dep, []), items):
                amount = amounts[id(x)]
                occurred = cota_occurred(x.get("dataDocumento"), x.get("ano"), x.get("mes"))
                if amount is None or not occurred:
                    r.reject(1)
                    continue
                fields = (x.get("tipoDespesa"), x.get("numDocumento"), x.get("dataDocumento"), x.get("valorDocumento"), x.get("valorGlosa"),
                          x.get("valorLiquido"), x.get("mes"), x.get("parcela"), x.get("numRessarcimento"), x.get("codLote"), x.get("cnpjCpfFornecedor"))
                ident.append((dep, str(x.get("codDocumento") or ""), fields))
                rows.append((pid, ctx.body, occurred, _cat(x.get("tipoDespesa")), nz(x.get("nomeFornecedor")), nz(x.get("cnpjCpfFornecedor")), amount, "BRL", nz(x.get("urlDocumento"))))
        rows = [p + (k,) for p, k in zip(rows, cota_keys(ident, prefix))]
        r.add(_write_year(conn, ctx.body, prefix, rows))
        r.notes.append(f"{len(rows)} lançamentos só na API (fora do arquivo Ano-{year}.csv.zip)")
