"""etl.senado (parte 2): filiações, matérias de autoria e CEAPS dos senadores em exercício. Chamado por senado_diario.run_senado.

Fontes:
  legis.senado.leg.br/dadosabertos/senador/{cod}/filiacoes   -> party_observations (data de filiação; D05)
  legis.senado.leg.br/dadosabertos/senador/{cod}/autorias    -> proposals + proposal_authors (carreira inteira; D10)
  adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/{ano} -> expenses (cota do Senado; D10)
Presença: o Senado não publica lista de presença por senador. A presença derivada de voto que existia é apagada aqui (D01).
"""

from __future__ import annotations

import logging

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch_json
from ..parties import PartyResolver
from ..util import cents, nz, parse_date

log = logging.getLogger("etl.senado.extras")
API = "https://legis.senado.leg.br/dadosabertos"
ADM = "https://adm.senado.gov.br/adm-dadosabertos/api/v1"
DAY, WEEK = 86400, 7 * 86400
LAW_TYPES = {"PL", "PLS", "PLC", "PLP", "PLV", "PEC", "PDL", "PDS", "MPV"}


def _list(x):
    return [] if x is None else x if isinstance(x, list) else [x]


def drop_derived_attendance(conn: psycopg.Connection, body: str) -> None:
    n = conn.execute("delete from attendance a using sessions s where s.id = a.session_id and s.body_id = %s", (body,)).rowcount
    conn.execute("update sessions set is_deliberative = false where body_id = %s and is_deliberative", (body,))
    conn.commit()
    if n:
        log.info("senado: %d registros de presença derivada de voto apagados (o Senado não publica presença)", n)


def filiacoes(conn: psycopg.Connection, senators: list[tuple[str, str, str | None]], parties: PartyResolver) -> None:
    obs = []
    for cod, pid, _ in senators:
        try:
            d = fetch_json(f"{API}/senador/{cod}/filiacoes.json", max_age=WEEK)
        except FileNotFoundError:
            continue
        for f in _list((((d.get("FiliacaoParlamentar") or {}).get("Parlamentar") or {}).get("Filiacoes") or {}).get("Filiacao")):
            sigla = ((f.get("Partido") or {}).get("SiglaPartido") or "").strip()
            day = parse_date(f.get("DataFiliacao"))
            if not day or not sigla:
                continue
            # BUG-022 / D182: "S/Partido" é observação (o Senado lista o senador sem partido); antes era pulada e a linha do
            # tempo mantinha o partido anterior (Romário aparecia PL depois de se desfiliar em 09/2026)
            party = parties.get(sigla, (f.get("Partido") or {}).get("NomePartido"))
            if party:
                obs.append((pid, party, day, "senado", f"senado:{cod}:{day.isoformat()}"))
    upsert(conn, "party_observations", ["person_id", "party_id", "observed_on", "source", "source_key"], obs, ["source", "source_key"], update=["person_id", "party_id", "observed_on"])
    conn.commit()
    log.info("senado: %d observações de partido (filiações)", len(obs))


def autorias(conn: psycopg.Connection, senators: list[tuple[str, str, str | None]], body: str, force: bool) -> None:
    try:
        with run(conn, "senado.autorias", "senado", force=force) as r:
            props, authors = {}, []
            for cod, pid, _ in senators:
                try:
                    d = fetch_json(f"{API}/senador/{cod}/autorias.json", max_age=DAY)
                except FileNotFoundError:
                    r.reject(1, f"senador {cod} sem autorias")
                    continue
                for a in _list(((((d.get("MateriasAutoriaParlamentar") or {}).get("Parlamentar") or {}).get("Autorias")) or {}).get("Autoria")):
                    m = a.get("Materia") or {}
                    num, ano = str(m.get("Numero") or ""), str(m.get("Ano") or "")
                    if not (m.get("Sigla") and num.isdigit() and ano.isdigit()):
                        r.reject(1)
                        continue
                    key = (body, m["Sigla"], int(num), int(ano))
                    props[key] = (*key, (m.get("Ementa") or m.get("DescricaoIdentificacao") or "(sem ementa)").strip()[:4000], m["Sigla"] in LAW_TYPES,
                                  parse_date(m.get("Data")), f"https://www25.senado.leg.br/web/atividade/materias/-/materia/{m.get('Codigo')}" if m.get("Codigo") else None)
                    authors.append((key, pid, "principal" if (a.get("IndicadorAutorPrincipal") or "") == "Sim" else "coautoria"))
            pid_of = {}
            for row in upsert(conn, "proposals", ["body_id", "type", "number", "year", "summary_official", "can_become_law", "presented_on", "url"], list(props.values()),
                              ["body_id", "type", "number", "year"], update=["summary_official", "presented_on", "url"], returning=["id", "type", "number", "year"]):
                pid_of[(body, row["type"], row["number"], row["year"])] = str(row["id"])
            r.add(len(pid_of))
            r.add(len(upsert(conn, "proposal_authors", ["proposal_id", "person_id", "role"], [(pid_of[k], p, role) for k, p, role in authors if k in pid_of],
                             ["proposal_id", "person_id"], update=["role"], returning=["proposal_id"])))
            log.info("senado: %d matérias de autoria, %d autorias", len(props), len(authors))
    except SkipUnchanged:
        pass


def ceaps(conn: psycopg.Connection, years: list[int], body: str, force: bool) -> None:
    src = str(conn.execute("select id from sources where slug = 'senado'").fetchone()["id"])
    ext = {r["external_id"]: str(r["person_id"]) for r in conn.execute("select external_id, person_id from person_external_ids where source_id = %s", (src,))}
    for year in years:
        try:
            from ..http import fetch
            from .camara_diario import cota_occurred

            f = fetch(f"{ADM}/senadores/despesas_ceaps/{year}", max_age=DAY)
        except FileNotFoundError:
            log.warning("CEAPS %d ainda não publicada", year)
            continue
        try:
            with run(conn, f"senado.despesas.{year}", "senado", input_checksum=f.checksum, force=force) as r:
                rows, unknown = [], set()
                for x in f.json():
                    pid = ext.get(str(x.get("codSenador")))
                    if not pid:
                        unknown.add(x.get("codSenador"))
                        continue
                    amount = cents(x.get("valorReembolsado"))
                    # D180: o ano do total é o da competência (ano/mes); data de emissão em outro ano (ou digitada "0023") vai para o mês de competência
                    day = cota_occurred(x.get("data"), x.get("ano"), x.get("mes"))
                    if amount is None or not day:
                        r.reject(1)
                        continue
                    cat = (x.get("tipoDespesa") or "Outros").strip()
                    rows.append((pid, body, day, cat[:1].upper() + cat[1:], nz(x.get("fornecedor")), nz(x.get("cpfCnpj")), amount, "BRL", None, f"ceaps:{x['id']}"))
                r.add(len(upsert(conn, "expenses", ["person_id", "body_id", "occurred_on", "category", "supplier_name", "supplier_doc", "amount_cents", "currency", "receipt_url", "source_key"],
                                 rows, ["body_id", "source_key"], returning=["id"])))
                if unknown:
                    r.notes.append(f"{len(unknown)} senadores da CEAPS fora do diretório (mandato encerrado antes da carga)")
                log.info("senado CEAPS %d: %d lançamentos, %d senadores fora do diretório", year, len(rows), len(unknown))
        except SkipUnchanged:
            continue
