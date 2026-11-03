"""etl.senado.diario: senadores em exercício, mandatos, votações nominais e matérias.

Fonte: https://legis.senado.leg.br/dadosabertos (JSON).
  /senador/lista/atual            -> 81 em exercício (titulares e suplentes convocados)
  /senador/{cod}                  -> nascimento, naturalidade
  /senador/{cod}/votacoes?ano=    -> votações nominais com o voto da pessoa (secretas são puladas)
Presença: o Senado não publica lista de presença por senador em dado aberto -> nenhuma presença é gravada (null, tela mostra "—").
A presença derivada de voto que existia foi apagada (D01): votar ou não numa votação nominal não é presença.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch_json
from ..identity import PersonResolver
from ..parties import PartyResolver
from ..util import fold, midnight_br, nz, parse_date, titlecase_pt

log = logging.getLogger("etl.senado")
API = "https://legis.senado.leg.br/dadosabertos"
WEEK = 7 * 86400
VOTE = {"Sim": "sim", "Não": "nao", "Abstenção": "abstencao", "P-NRV": "nao_votou"}


def _list(x: Any) -> list[Any]:
    """A API devolve dict quando há um item só e lista quando há vários."""
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _current_legislature(lista: list[dict[str, Any]]) -> str | None:
    """Número da legislatura em curso, pela primeira legislatura dos mandatos em exercício mais recente."""
    nums = []
    for p in lista:
        for k in ("PrimeiraLegislaturaDoMandato", "SegundaLegislaturaDoMandato"):
            leg = (p.get("Mandato") or {}).get(k) or {}
            if leg.get("NumeroLegislatura") and parse_date(leg.get("DataInicio")) and parse_date(leg["DataInicio"]) <= date.today():
                nums.append(int(leg["NumeroLegislatura"]))
    return str(max(nums)) if nums else None


def _vote_value(s: str | None) -> str | None:
    if not s:
        return None
    if s in VOTE:
        return VOTE[s]
    if s.lower().startswith("presidente"):
        return "art17"  # o presidente da sessão não vota (art. 51 RISF); rótulo genérico "não vota por presidir"
    if s == "Votou":
        return None  # votação secreta: sem voto individual
    return "nao_votou"  # LP, AP, MIS, NCom, LS, REP, NA...


def _is_secret(v: dict[str, Any]) -> bool | None:
    """D123: `votacaoSecreta` do /votacao ('S'/'N'). Ausente ou outro valor -> None (fonte não informa), nunca deduzido dos votos."""
    return {"S": True, "N": False}.get((v.get("votacaoSecreta") or "").strip().upper())


def run_secretas(conn: psycopg.Connection, *, years: list[int], force: bool) -> None:
    """etl senado.secretas: marca voting_events.is_secret pela fonte sem regravar votos (backfill e conferência da D123).

    Lê o mesmo /votacao do senado.diario e só faz UPDATE por source_key; evento ausente do banco vira rejeição anotada.
    """
    body = str(conn.execute("select id from legislative_bodies where kind = 'senado'").fetchone()["id"])
    for year in years:
        end = min(date(year, 12, 31), date.today())
        try:
            lst = _list(fetch_json(f"{API}/votacao?dataInicio={year}-01-01&dataFim={end.isoformat()}", max_age=86400))
        except FileNotFoundError:
            lst = []
        try:
            with run(conn, f"senado.secretas.{year}", "senado", force=force) as r:
                pairs = [(str(v["codigoSessaoVotacao"]), _is_secret(v)) for v in lst
                         if v.get("codigoSessaoVotacao") and (v.get("casaSessao") or "SF") == "SF"]
                cur = conn.execute(
                    """update voting_events e set is_secret = x.s, updated_at = now()
                       from unnest(%s::text[], %s::boolean[]) as x(k, s)
                       where e.body_id = %s and e.source_key = x.k and e.is_secret is distinct from x.s""",
                    ([k for k, _ in pairs], [s for _, s in pairs], body),
                )
                r.add(cur.rowcount)
                known = {row["source_key"] for row in conn.execute(
                    "select source_key from voting_events where body_id = %s and source_key = any(%s)", (body, [k for k, _ in pairs]))}
                for k, _ in pairs:
                    if k not in known:
                        r.reject(1, f"votação {k} da fonte não está no banco (rodar senado.diario --year {year})")
                n_s = sum(1 for _, s in pairs if s)
                log.info("senado %d: %d votações na fonte, %d secretas, %d atualizadas", year, len(pairs), n_s, cur.rowcount)
        except SkipUnchanged:
            continue


def run_senado(conn: psycopg.Connection, *, years: list[int], limit: int | None, force: bool, ceaps_years: list[int] | None = None) -> None:
    people = PersonResolver(conn)
    parties = PartyResolver(conn)
    office = str(conn.execute("select id from offices where slug = 'senador'").fetchone()["id"])
    body = str(conn.execute("select id from legislative_bodies where kind = 'senado'").fetchone()["id"])
    by_uf = {r["uf"]: str(r["id"]) for r in conn.execute("select uf, id from places where kind = 'uf'")}
    muni = {(r["uf"], fold(r["name"])): str(r["id"]) for r in conn.execute("select uf, name, id from places where kind = 'municipio'")}

    lista = fetch_json(f"{API}/senador/lista/atual.json")["ListaParlamentarEmExercicio"]["Parlamentares"]["Parlamentar"]
    lista = _list(lista)[: limit or None]
    senators: list[tuple[str, str, str | None]] = []  # (codigo, person_id, party_id)
    try:
        with run(conn, "senado.senadores", "senado") as r:
            mandates, memberships = [], []
            for p in lista:
                ident, mand = p["IdentificacaoParlamentar"], p.get("Mandato") or {}
                cod = str(ident["CodigoParlamentar"])
                det = fetch_json(f"{API}/senador/{cod}.json", max_age=WEEK)["DetalheParlamentar"]["Parlamentar"]
                basics = det.get("DadosBasicosParlamentar") or {}
                civil = titlecase_pt(ident.get("NomeCompletoParlamentar"))
                display = ident.get("NomeParlamentar") or civil
                birth = parse_date(basics.get("DataNascimento"))
                birth_uf = (basics.get("UfNaturalidade") or "").upper() or None
                seat_place = by_uf.get((mand.get("UfParlamentar") or ident.get("UfParlamentar") or "").upper())
                m = people.resolve(source="senado", external_id=cod, civil_name=civil, birth_date=birth, birth_uf=birth_uf, raw={"nome": display, "civil": civil},
                                   seat=(office, seat_place) if seat_place else None, display_name=display)
                if m.method == "queued":
                    r.reject(1, f"senador {cod} ambíguo")
                    continue
                pid = m.person_id or people.create(
                    display_name=display, civil_name=civil, gender={"Feminino": "f", "Masculino": "m"}.get(ident.get("SexoParlamentar") or ""),
                    birth_date=birth, birthplace_place_id=muni.get((birth_uf, fold(basics.get("Naturalidade")))) if birth_uf else None,
                    education=None, slug_hints=((ident.get("UfParlamentar") or "").lower() or None, "senador"),
                    source="senado", external_id=cod, photo_source_url=ident.get("UrlFotoParlamentar"),
                )
                if m.person_id:
                    conn.execute("update people set display_name = %s, photo_source_url = coalesce(%s, photo_source_url), photo_license = coalesce(photo_license, 'Senado Federal'), updated_at = now() where id = %s and display_name is distinct from %s",
                                 (display, ident.get("UrlFotoParlamentar"), pid, display))
                party = parties.get(ident.get("SiglaPartidoParlamentar"))
                place = by_uf.get((mand.get("UfParlamentar") or ident.get("UfParlamentar") or "").upper())
                leg1, leg2 = mand.get("PrimeiraLegislaturaDoMandato") or {}, mand.get("SegundaLegislaturaDoMandato") or {}
                start = parse_date(leg1.get("DataInicio"))
                end_incl = parse_date(leg2.get("DataFim")) or parse_date(leg1.get("DataFim"))
                if not (place and start and end_incl):
                    r.reject(1, f"mandato incompleto para senador {cod}")
                    continue
                titular = (mand.get("DescricaoParticipacao") or "Titular") == "Titular"
                if not titular:
                    ex = _list((mand.get("Exercicios") or {}).get("Exercicio"))
                    start = max([parse_date(e.get("DataInicio")) for e in ex if parse_date(e.get("DataInicio"))] or [start])
                mandates.append((pid, office, place, body, party, "titular" if titular else "suplente_em_exercicio", "em_exercicio", start, end_incl + timedelta(days=1), f"TSE {start.year - 1}", "senado"))
                if party:
                    memberships.append((pid, party, start))
                senators.append((cod, pid, party))
            # titulares da legislatura que NÃO estão em exercício (renúncia, afastamento para ministério): lista por legislatura traz a causa
            in_exercise = {cod for cod, _, _ in senators}
            leg = _current_legislature(lista)
            if leg and not limit:
                for p in _list(fetch_json(f"{API}/senador/lista/legislatura/{leg}.json")["ListaParlamentarLegislatura"]["Parlamentares"]["Parlamentar"]):
                    ident = p["IdentificacaoParlamentar"]
                    cod = str(ident["CodigoParlamentar"])
                    if cod in in_exercise:
                        continue
                    for mand in _list((p.get("Mandatos") or {}).get("Mandato")):
                        if (mand.get("DescricaoParticipacao") or "") != "Titular":
                            continue
                        leg1 = mand.get("PrimeiraLegislaturaDoMandato") or {}
                        start = parse_date(leg1.get("DataInicio"))
                        place = by_uf.get((mand.get("UfParlamentar") or "").upper())
                        if not (start and place and start <= date.today()):
                            continue
                        ex = sorted(_list((mand.get("Exercicios") or {}).get("Exercicio")), key=lambda e: e.get("DataInicio") or "")
                        cause = (ex[-1].get("SiglaCausaAfastamento") or "") if ex else ""
                        status = "renunciou" if cause == "REN" else "cassado" if cause in ("CAS", "PER") else "encerrado" if cause in ("FAL", "TER") else "licenciado" if cause.startswith("L") or cause == "AFO" else "afastado"
                        pid = people.by_external("senado", cod)
                        if not pid:
                            # nascimento do detalhe: casa com a pessoa que o TSE criou (nome de urna difere do parlamentar: "Leila do Vôlei" x "Leila Barros")
                            try:
                                det = fetch_json(f"{API}/senador/{cod}.json", max_age=WEEK)["DetalheParlamentar"]["Parlamentar"]
                                birth = parse_date((det.get("DadosBasicosParlamentar") or {}).get("DataNascimento"))
                            except FileNotFoundError:
                                birth = None
                            m = people.resolve(source="senado", external_id=cod, civil_name=titlecase_pt(ident.get("NomeCompletoParlamentar")), birth_date=birth,
                                               seat=(office, place), display_name=ident.get("NomeParlamentar"))
                            pid = m.person_id
                        if not pid:
                            continue
                        conn.execute(
                            """update mandates set status = %s, status_source = 'senado', updated_at = now()
                               where person_id = %s and office_id = %s and place_id = %s and started_on = %s and status is distinct from %s""",
                            (status, pid, office, place, start, status),
                        )
            people.flush()
            r.add(len(upsert(conn, "mandates", ["person_id", "office_id", "place_id", "body_id", "party_id", "role", "status", "started_on", "ends_on", "elected_by", "status_source"],
                             mandates, ["person_id", "office_id", "place_id", "started_on"], update=["body_id", "role", "status", "status_source"], returning=["id"])))
            # partido: vem das filiações datadas (senado_extras.filiacoes) -> party_observations -> derive.stats
    except SkipUnchanged:
        pass

    for year in years:
        try:
            with run(conn, f"senado.votacoes.{year}", "senado") as r:
                _votes_year(conn, r, year, senators, body, office)
        except SkipUnchanged:
            continue

    from . import senado_extras as sx

    sx.drop_derived_attendance(conn, body)
    if senators and not limit:
        sx.filiacoes(conn, senators, parties)
        sx.autorias(conn, senators, body, force)
    sx.ceaps(conn, ceaps_years or years, body, force)


def _votes_year(conn: psycopg.Connection, r, year: int, senators: list[tuple[str, str, str | None]], body: str, office: str) -> None:
    """Votações do Plenário do ano pelo endpoint /votacao (todas as nominais, abertas e secretas; D10).
    A API por senador (/senador/{cod}/votacoes) omitia boa parte das abertas (8 × 22 em 2026). Secreta: entra o evento, sem voto
    individual (a fonte só diz "Votou"). Senador fora do diretório (mandato encerrado antes da carga): voto não gravado."""
    prop_rows, sess_rows, ev_rows, vote_rows = {}, {}, {}, []
    by_cod = {cod: (pid, party) for cod, pid, party in senators}
    src = str(conn.execute("select id from sources where slug = 'senado'").fetchone()["id"])
    for row in conn.execute("select external_id, person_id from person_external_ids where source_id = %s", (src,)):
        by_cod.setdefault(row["external_id"], (str(row["person_id"]), None))
    end = min(date(year, 12, 31), date.today())
    try:
        lst = fetch_json(f"{API}/votacao?dataInicio={year}-01-01&dataFim={end.isoformat()}", max_age=86400)
    except FileNotFoundError:
        lst = []
    for v in _list(lst):
        key = str(v.get("codigoSessaoVotacao") or "")
        day = parse_date(v.get("dataSessao"))
        if not key or not day or (v.get("casaSessao") or "SF") != "SF":
            continue
        ts = midnight_br(day)
        skey = str(v.get("codigoSessao") or f"dia:{day}")
        sess_rows.setdefault(skey, (body, (v.get("siglaTipoSessao") or "plenario").lower(), False, "encerrada", ts, None, skey))
        pkey = None
        if v.get("sigla") and str(v.get("numero") or "").isdigit() and str(v.get("ano") or "").isdigit():
            pkey = (body, v["sigla"], int(v["numero"]), int(v["ano"]))
            prop_rows.setdefault(pkey, (*pkey, (v.get("ementa") or v.get("identificacao") or "(sem ementa)")[:4000],
                                        v["sigla"] in {"PL", "PLP", "PEC", "PLV", "MPV", "PDL", "PLS", "PLC"},
                                        f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{v.get('codigoMateria')}" if v.get("codigoMateria") else None))
        desc = (v.get("descricaoVotacao") or v.get("identificacao") or "votação").strip()
        low = desc.lower()
        kind = "urgencia" if "urgência" in low else "destaque" if "destaque" in low else "requerimento" if "requerimento" in low else "texto"
        result = {"A": "aprovado", "R": "rejeitado"}.get(v.get("resultadoVotacao") or "")
        secret = _is_secret(v)
        ev_rows.setdefault(key, (body, skey, pkey, ts, kind, True, desc[:4000], result, key, secret))
        if secret:
            continue
        for vv in _list(v.get("votos")):
            who = by_cod.get(str(vv.get("codigoParlamentar")))
            val = _vote_value(vv.get("siglaVotoParlamentar"))
            if who and val:
                vote_rows.append((key, who[0], who[1], val))
    log.info("senado %d: %d votações nominais, %d votos", year, len(ev_rows), len(vote_rows))
    prop_id: dict[tuple, str] = {}
    for row in upsert(conn, "proposals", ["body_id", "type", "number", "year", "summary_official", "can_become_law", "url"], list(prop_rows.values()),
                      ["body_id", "type", "number", "year"], update=[], returning=["id", "type", "number", "year"]):
        prop_id[(body, row["type"], row["number"], row["year"])] = str(row["id"])
    if len(prop_id) < len(prop_rows):
        for row in conn.execute("select id, type, number, year from proposals where body_id = %s", (body,)):
            prop_id[(body, row["type"], row["number"], row["year"])] = str(row["id"])
    sess_id: dict[str, str] = {}
    for row in upsert(conn, "sessions", ["body_id", "kind", "is_deliberative", "status", "starts_at", "official_url", "source_key"], list(sess_rows.values()),
                      ["body_id", "source_key"], update=["starts_at"], returning=["id", "source_key"]):
        sess_id[row["source_key"]] = str(row["id"])
    ev_id: dict[str, str] = {}
    rows = [(b, sess_id.get(sk), prop_id.get(pk) if pk else None, ts, k, nominal, d, res, key, sec) for (b, sk, pk, ts, k, nominal, d, res, key, sec) in ev_rows.values()]
    for row in upsert(conn, "voting_events", ["body_id", "session_id", "proposal_id", "occurred_at", "kind", "is_nominal", "description", "result", "source_key", "is_secret"], rows,
                      ["body_id", "source_key"], returning=["id", "source_key"]):
        ev_id[row["source_key"]] = str(row["id"])
    r.add(len(ev_id))
    r.add(len(upsert(conn, "votes", ["voting_event_id", "person_id", "party_id", "value"], [(ev_id[k], p, pa, v) for k, p, pa, v in vote_rows if k in ev_id],
                     ["voting_event_id", "person_id"], update=["party_id", "value"], returning=["id"])))
    conn.execute(
        """update voting_events e set yes_count = c.s, no_count = c.n, abstain_count = c.a from (
             select voting_event_id, count(*) filter (where value = 'sim') s, count(*) filter (where value = 'nao') n, count(*) filter (where value = 'abstencao') a
             from votes where voting_event_id = any(%s::uuid[]) group by 1) c where c.voting_event_id = e.id""",
        (list(ev_id.values()),),
    )
