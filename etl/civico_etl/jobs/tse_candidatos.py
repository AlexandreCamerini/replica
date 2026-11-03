"""etl.tse.candidatos: candidaturas, resultado, bens e mandatos dos eleitos, a partir dos arquivos do TSE.

Fontes (cdn.tse.jus.br/estatistica/sead/odsele):
  consulta_cand/consulta_cand_{ano}.zip        -> elections, contests, people, candidacies, mandates
  bem_candidato/bem_candidato_{ano}.zip        -> asset_declarations
  votacao_candidato_munzona/..._{ano}.zip      -> candidacies.votes (opcional, ~550 MB por eleição)
CSV latin-1, ';', aspas. Lido com DuckDB (all_varchar) e normalizado em Python.

Por padrão carrega só eleitos (e quem foi ao 2º turno). --all carrega todas as candidaturas (S14).
"""

from __future__ import annotations

import logging
import re
import zipfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import duckdb
import psycopg

from ..db import Run, SkipUnchanged, run, upsert
from ..http import CACHE_DIR, fetch
from ..identity import PersonResolver
from ..parties import PartyResolver
from ..util import cents, fold, nz, parse_date, titlecase_pt

log = logging.getLogger("etl.tse")
BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele"

CARGO = {
    "1": "presidente", "2": "vice_presidente", "3": "governador", "4": "vice_governador", "5": "senador",
    "6": "deputado_federal", "7": "deputado_estadual", "8": "deputado_distrital",
    "11": "prefeito", "12": "vice_prefeito", "13": "vereador",
}
RESULT = {
    "ELEITO": "eleito", "ELEITO POR QP": "eleito_qp", "ELEITO POR MÉDIA": "eleito_media",
    "SUPLENTE": "suplente", "NÃO ELEITO": "nao_eleito", "2º TURNO": "segundo_turno",
}
ELECTED = {"eleito", "eleito_qp", "eleito_media"}
GENDER = {"2": "m", "4": "f"}
BODY_KIND = {
    "deputado_federal": "camara_deputados", "senador": "senado", "deputado_estadual": "assembleia",
    "deputado_distrital": "camara_legislativa_df", "vereador": "camara_municipal",
}
# (UF, nome no TSE sem acento) -> nome no IBGE sem acento. Casos conhecidos da carga de 2024.
TSE_TO_IBGE = {
    ("PA", "santa isabel do para"): "santa izabel do para",
    ("BA", "camaca"): "camacan",
    ("PA", "eldorado dos carajas"): "eldorado do carajas",
    ("MT", "santo antonio do leverger"): "santo antonio de leverger",
    ("RO", "espigao do oeste"): "espigao d'oeste",
    ("RO", "alvorada do oeste"): "alvorada d'oeste",
    ("RR", "sao luiz"): "sao luiz do anaua",
    ("MG", "dona eusebia"): "dona euzebia",
    ("SP", "sao luis do paraitinga"): "sao luiz do paraitinga",
    ("SE", "amparo de sao francisco"): "amparo do sao francisco",
    ("MG", "sao thome das letras"): "sao tome das letras",
    ("RN", "boa saude"): "januario cicco",
    ("MG", "barao de monte alto"): "barao do monte alto",
}
COLS = [
    "ANO_ELEICAO", "NM_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO", "SG_UF", "SG_UE", "NM_UE", "CD_CARGO",
    "SQ_CANDIDATO", "NR_CANDIDATO", "NM_CANDIDATO", "NM_URNA_CANDIDATO", "NR_PARTIDO", "SG_PARTIDO", "NM_PARTIDO",
    "NM_COLIGACAO", "SG_UF_NASCIMENTO", "NM_MUNICIPIO_NASCIMENTO", "DT_NASCIMENTO", "NR_TITULO_ELEITORAL_CANDIDATO",
    "CD_GENERO", "DS_GRAU_INSTRUCAO", "DS_SIT_TOT_TURNO", "DS_DETALHE_SITUACAO_CAND",
]


def term_dates(office: str, year: int) -> tuple[date, date]:
    """Posse e fim previsto (exclusivo). EC 111/2021: a partir de 2027 presidente toma posse em 5/1 e governador em 6/1."""
    y = year + 1
    if office in ("presidente", "vice_presidente"):
        start = date(y, 1, 1) if year <= 2022 else date(y, 1, 5)
        end = date(y + 4, 1, 5)
    elif office in ("governador", "vice_governador"):
        start = date(y, 1, 1) if year <= 2022 else date(y, 1, 6)
        end = date(y + 4, 1, 6)
    elif office in ("prefeito", "vice_prefeito", "vereador"):
        start, end = date(y, 1, 1), date(y + 4, 1, 1)
    elif office == "senador":
        start, end = date(y, 2, 1), date(y + 8, 2, 1)
    else:
        start, end = date(y, 2, 1), date(y + 4, 2, 1)
    return start, end


def _extract(zip_path: Path, year: int, ufs: list[str] | None, prefix: str) -> list[Path]:
    out_dir = CACHE_DIR / "tse" / f"{prefix}_{year}"
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        want = [n for n in names if (ufs and any(n.upper().endswith(f"_{u.upper()}.CSV") for u in ufs)) or (not ufs and n.upper().endswith("_BRASIL.CSV"))]
        if not want and not ufs:  # alguns anos não têm o consolidado BRASIL
            want = [n for n in names if not n.upper().endswith("_BRASIL.CSV")]
        paths = []
        for n in want:
            p = out_dir / Path(n).name
            u = p.with_suffix(".utf8.csv")
            if not u.exists() or not p.exists() or p.stat().st_size != z.getinfo(n).file_size:
                z.extract(n, out_dir)
                # TSE publica em latin-1; DuckDB lê UTF-8. Transcodifica uma vez, em fluxo.
                with open(p, encoding="latin-1", newline="") as src, open(u, "w", encoding="utf-8", newline="") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
            paths.append(u)
    return paths


def _read(paths: list[Path], cols: list[str], where: str = "") -> list[dict[str, Any]]:
    con = duckdb.connect()
    out: list[dict[str, Any]] = []
    for p in paths:
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        have = set(rel.columns)
        sel = ", ".join(c if c in have else f"NULL as {c}" for c in cols)
        con.register("t", rel)
        rows = con.execute(f"select {sel} from t {where}").fetchall()
        out.extend(dict(zip(cols, r)) for r in rows)
        con.unregister("t")
    return out


def run_tse(conn: psycopg.Connection, *, years: list[int], ufs: list[str] | None, only_elected: bool, with_votes: bool, force: bool) -> None:
    for year in years:
        try:
            cand = fetch(f"{BASE}/consulta_cand/consulta_cand_{year}.zip")
        except FileNotFoundError:
            log.warning("TSE ainda não publicou consulta_cand_%d; pulando", year)
            continue
        try:
            bens = fetch(f"{BASE}/bem_candidato/bem_candidato_{year}.zip")
        except FileNotFoundError:
            bens = None
            log.warning("sem bem_candidato_%d", year)
        scope = ",".join(sorted(u.upper() for u in ufs)) if ufs else "BR"
        checksum = f"{cand.checksum}:{bens.checksum if bens else '-'}:{scope}:{'all' if not only_elected else 'eleitos'}"
        try:
            with run(conn, f"tse.candidatos.{year}", "tse", input_checksum=checksum, force=force) as r:
                _load_year(conn, r, year, cand.path, bens.path if bens else None, ufs, only_elected)
        except SkipUnchanged:
            continue
        if with_votes:
            _load_votes(conn, year, ufs, force)


def _load_year(conn: psycopg.Connection, r: Run, year: int, cand_zip: Path, bens_zip: Path | None, ufs: list[str] | None, only_elected: bool) -> None:
    where = ""
    if only_elected:
        where = "where DS_SIT_TOT_TURNO in ('ELEITO','ELEITO POR QP','ELEITO POR MÉDIA') or (NR_TURNO = '1' and DS_SIT_TOT_TURNO = '2º TURNO')"
    rows = _read(_extract(cand_zip, year, ufs, "consulta_cand"), COLS, where)
    log.info("tse %d: %d candidaturas lidas (%s)", year, len(rows), "eleitos" if only_elected else "todas")

    people = PersonResolver(conn)
    parties = PartyResolver(conn)
    offices = {o["slug"]: str(o["id"]) for o in conn.execute("select slug, id from offices")}
    places = {row["ibge_code"]: str(row["id"]) for row in conn.execute("select ibge_code, id from places")}
    by_uf = {row["uf"]: str(row["id"]) for row in conn.execute("select uf, id from places where kind = 'uf'")}
    muni = {(row["uf"], fold(row["name"])): str(row["id"]) for row in conn.execute("select uf, name, id from places where kind = 'municipio'")}
    # 2º critério: só letras e dígitos (hífen e apóstrofo variam: "Olhos-d'Água" x "OLHOS D'ÁGUA"); 3º: grafias que o TSE e o IBGE escrevem diferente
    muni_alnum = {(uf, re.sub(r"[^a-z0-9]", "", name)): pid for (uf, name), pid in muni.items()}

    def muni_lookup(uf: str, name: str | None) -> str | None:
        f = fold(name)
        return muni.get((uf, f)) or muni_alnum.get((uf, re.sub(r"[^a-z0-9]", "", f))) or muni.get((uf, TSE_TO_IBGE.get((uf, f), "")))

    bodies = {(row["kind"], str(row["place_id"])): str(row["id"]) for row in conn.execute("select kind, place_id, id from legislative_bodies")}
    today = date.today()

    # 1) eleições
    elections: dict[tuple[str, int, int, date], str] = {}
    el_rows = set()
    parsed: list[dict[str, Any]] = []
    unmatched_places: dict[str, int] = defaultdict(int)
    for x in rows:
        kind_src = (x["NM_TIPO_ELEICAO"] or "").upper()
        if "SUPLEMENTAR" in kind_src:
            kind = "suplementar"
        elif "ORDIN" in kind_src:
            kind = "geral" if year % 4 == 2 else "municipal"
        else:
            continue  # consulta popular etc.
        office = CARGO.get((x["CD_CARGO"] or "").strip())
        if not office:
            continue  # suplentes de senador não têm mandato próprio
        held = parse_date(x["DT_ELEICAO"])
        turno = int(x["NR_TURNO"] or 1)
        if not held:
            r.reject(1, "sem DT_ELEICAO")
            continue
        if office in ("presidente", "vice_presidente"):
            place = places.get("BR")
        elif office in ("governador", "vice_governador", "senador", "deputado_federal", "deputado_estadual", "deputado_distrital"):
            place = by_uf.get((x["SG_UE"] or "").strip().upper())
        else:
            place = muni_lookup((x["SG_UF"] or "").strip().upper(), x["NM_UE"])
        if not place:
            unmatched_places[f"{x['SG_UF']}/{x['NM_UE']}"] += 1
            r.reject(1)
            continue
        x.update(kind=kind, office=office, held=held, turno=turno, place=place)
        el_rows.add((kind, year, turno, held))
        parsed.append(x)
    if unmatched_places:
        top = sorted(unmatched_places.items(), key=lambda kv: -kv[1])[:20]
        r.notes.append("lugares sem correspondência IBGE: " + "; ".join(f"{k} ({v})" for k, v in top))
        log.warning("tse %d: %d lugares sem correspondência: %s", year, len(unmatched_places), top[:5])
    for row in upsert(conn, "elections", ["kind", "year", "round", "held_on"], sorted(el_rows), ["kind", "year", "round", "held_on"], returning=["id", "kind", "year", "round", "held_on"]):
        elections[(row["kind"], row["year"], row["round"], row["held_on"])] = str(row["id"])

    # 2) disputas
    contests: dict[tuple[str, str, str], str] = {}
    ct = {(elections[(x["kind"], year, x["turno"], x["held"])], offices[x["office"]], x["place"]) for x in parsed}
    for row in upsert(conn, "contests", ["election_id", "office_id", "place_id"], sorted(ct), ["election_id", "office_id", "place_id"], update=[], returning=["id", "election_id", "office_id", "place_id"]):
        contests[(str(row["election_id"]), str(row["office_id"]), str(row["place_id"]))] = str(row["id"])
    # DO NOTHING não devolve as já existentes: completa pelo banco
    if len(contests) < len(ct):
        for row in conn.execute("select id, election_id, office_id, place_id from contests where election_id = any(%s)", ([e for e in elections.values()],)):
            contests[(str(row["election_id"]), str(row["office_id"]), str(row["place_id"]))] = str(row["id"])

    # 3) pessoas e candidaturas
    cand_rows: list[tuple] = []
    seen_person_election: set[tuple[str, str]] = set()
    mandate_rows: list[tuple] = []
    supplementary: list[tuple[str, str, date]] = []  # (office_slug, place_id, data da eleição suplementar)
    sq_round1: dict[str, tuple[str, str]] = {}  # SQ -> (contest_id, person_id) do 1º turno, para bens
    not_in_dir = 0
    # mesma pessoa com duas candidaturas na mesma eleição (registro substituído, renúncia e novo registro): fica a que já está no
    # banco ou, no lote, a eleita primeiro
    db_person_election = {(str(r_["person_id"]), str(r_["election_id"])): str(r_["contest_id"]) for r_ in conn.execute(
        "select person_id, election_id, contest_id from candidacies where election_id = any(%s::uuid[])", (list(elections.values()),))}
    parsed.sort(key=lambda x: (x["DS_SIT_TOT_TURNO"] or "").upper() not in ("ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA", "2º TURNO"))
    for x in parsed:
        sq = nz(x["SQ_CANDIDATO"])
        if not sq:
            r.reject(1, "sem SQ_CANDIDATO")
            continue
        civil = titlecase_pt(x["NM_CANDIDATO"])
        urna = titlecase_pt(x["NM_URNA_CANDIDATO"]) or civil
        birth = parse_date(x["DT_NASCIMENTO"])
        birth_uf = (nz(x["SG_UF_NASCIMENTO"]) or "").upper() or None
        titulo = nz(x["NR_TITULO_ELEITORAL_CANDIDATO"])
        result = RESULT.get((x["DS_SIT_TOT_TURNO"] or "").strip().upper())
        detail = (x["DS_DETALHE_SITUACAO_CAND"] or "").upper()
        if result is None:
            result = "indeferido" if "INDEFERIDO" in detail else "renuncia" if "RENÚNCIA" in detail or "RENUNCIA" in detail else None
        # D07: só cria pessoa nova no diretório quem tem mandato atual ou a tomar posse; o resto (derrotados, eleições antigas)
        # só se liga a quem já está no diretório (histórico, patrimônio, campanhas). O diretório não vira lista de candidatos.
        s0, e0 = term_dates(x["office"], year)
        if x["kind"] == "suplementar":
            s0 = x["held"]
        may_create = result in ELECTED and e0 > today
        m = people.resolve(source="tse", external_id=sq, civil_name=civil, birth_date=birth, birth_uf=birth_uf, titulo=titulo,
                           raw={"ano": year, "nome": civil, "urna": urna, "cargo": x["office"], "uf": x["SG_UF"]})
        if m.method == "queued":
            r.reject(1)
            continue
        if m.person_id is None and not may_create:
            not_in_dir += 1
            continue
        pid = m.person_id or people.create(
            display_name=urna, civil_name=civil, gender=GENDER.get((x["CD_GENERO"] or "").strip()), birth_date=birth,
            birthplace_place_id=muni_lookup(birth_uf, x["NM_MUNICIPIO_NASCIMENTO"]) if birth_uf else None,
            education=(lambda e: e[0].upper() + e[1:].lower() if e else None)(nz(x["DS_GRAU_INSTRUCAO"]) or ""),
            slug_hints=((x["SG_UF"] or "").lower() or None, x["office"].replace("_", "-")),
            source="tse", external_id=sq, titulo=titulo,
        )
        el_id = elections[(x["kind"], year, x["turno"], x["held"])]
        contest_id = contests[(el_id, offices[x["office"]], x["place"])]
        if db_person_election.get((pid, el_id), contest_id) != contest_id:
            r.reject(1, f"outra candidatura da mesma pessoa na eleição: {civil} ({sq})")
            continue
        if (pid, el_id) in seen_person_election:
            r.reject(1, f"pessoa duplicada na mesma eleição: {civil} ({sq})")
            continue
        seen_person_election.add((pid, el_id))
        contest_id = contests[(el_id, offices[x["office"]], x["place"])]
        party_id = parties.get(x["SG_PARTIDO"], x["NM_PARTIDO"], x["NR_PARTIDO"])
        cand_rows.append((contest_id, el_id, pid, party_id, sq, urna, int(x["NR_CANDIDATO"]) if (x["NR_CANDIDATO"] or "").isdigit() else None,
                          nz(x["NM_COLIGACAO"]), result, "BRL"))
        if x["turno"] == 1:
            sq_round1[sq] = (contest_id, pid)
        if result in ELECTED:
            start, end = term_dates(x["office"], year)
            if x["kind"] == "suplementar":
                # eleição suplementar: entra no lugar de quem perdeu o mandato; posse logo após a eleição (aproximação: data da eleição)
                start = x["held"]
                supplementary.append((x["office"], x["place"], x["held"]))
            status = "encerrado" if end <= today else "em_exercicio" if start <= today else "eleito_aguardando_posse"
            body = bodies.get((BODY_KIND[x["office"]], x["place"])) if x["office"] in BODY_KIND else None
            mandate_rows.append((pid, offices[x["office"]], x["place"], body, party_id, "titular", status, start, end, f"TSE {year}", "tse", sq, contest_id))
    people.flush()
    if not_in_dir:
        r.notes.append(f"{not_in_dir} candidaturas de quem não está no diretório (sem mandato atual): não criam pessoa")
        log.info("tse %d: %d candidaturas sem pessoa no diretório, ignoradas", year, not_in_dir)
    upserted = upsert(
        conn, "candidacies",
        ["contest_id", "election_id", "person_id", "party_id", "tse_sequencial", "ballot_name", "ballot_number", "coalition_name", "result", "currency"],
        cand_rows, ["contest_id", "tse_sequencial"], update=["person_id", "party_id", "ballot_name", "ballot_number", "coalition_name", "result"],
        returning=["id", "tse_sequencial", "contest_id"],
    )
    r.add(len(upserted))
    cand_id = {(row["tse_sequencial"], str(row["contest_id"])): str(row["id"]) for row in upserted}

    # 4) mandatos dos eleitos: TSE só insere e só promove 'aguardando posse' -> 'em exercício'; a casa é dona do status depois
    if mandate_rows:
        # suplementar anula a eleição anterior daquela disputa: vale para todo cargo, menos senador (vaga única entre três)
        supp_by_seat = {(offices[o], pl): held for o, pl, held in supplementary if o != "senador"}
        rows_m = []
        for (a, b, c, d, e, g, h, i, j, k, l, sq, contest_id) in mandate_rows:
            held = supp_by_seat.get((b, c))
            if held and i < held < j:
                # mandato regular anulado: termina na data da suplementar (também quando a mesma pessoa venceu de novo)
                j, h = held, "encerrado"
            rows_m.append((a, b, c, d, e, cand_id.get((sq, contest_id)), g, h, i, j, k, l))
        if supp_by_seat:
            cur = conn.cursor()
            # linha errada de run anterior (posse regular para eleito em suplementar) sai antes do upsert
            cur.executemany(
                """delete from mandates m using candidacies c, elections e
                   where m.candidacy_id = c.id and c.election_id = e.id and e.kind = 'suplementar'
                     and m.office_id = %s and m.place_id = %s and m.started_on <> %s""",
                [(o, pl, held) for (o, pl), held in supp_by_seat.items()],
            )
            # quem estava no cargo perdeu o mandato: encerra na data da suplementar
            cur.executemany(
                """update mandates set status = 'encerrado', ends_on = %s, updated_at = now()
                   where office_id = %s and place_id = %s and started_on < %s and ends_on > %s and status = 'em_exercicio'""",
                [(held, o, pl, held, held) for (o, pl), held in supp_by_seat.items()],
            )
            r.notes.append(f"{len(supp_by_seat)} cadeira(s) com eleição suplementar")
        n = len(upsert(
            conn, "mandates",
            ["person_id", "office_id", "place_id", "body_id", "party_id", "candidacy_id", "role", "status", "started_on", "ends_on", "elected_by", "status_source"],
            rows_m, ["person_id", "office_id", "place_id", "started_on"],
            update=["status", "candidacy_id"], where="mandates.status = 'eleito_aguardando_posse'", returning=["id"],
        ))
        r.add(n)

    # 5) bens declarados (soma por candidatura do 1º turno)
    if bens_zip:
        brows = _read(_extract(bens_zip, year, ufs, "bem_candidato"), ["SQ_CANDIDATO", "VR_BEM_CANDIDATO"])
        total: dict[str, int] = defaultdict(int)
        for b in brows:
            v = cents(b["VR_BEM_CANDIDATO"])
            if b["SQ_CANDIDATO"] in sq_round1 and v is not None:
                total[b["SQ_CANDIDATO"]] += v
        decl = []
        for sq, tot in total.items():
            contest_id, pid = sq_round1[sq]
            cid = cand_id.get((sq, contest_id))
            if cid:
                decl.append((pid, cid, year, tot, "BRL"))
        r.add(len(upsert(conn, "asset_declarations", ["person_id", "candidacy_id", "year", "total_cents", "currency"], decl, ["candidacy_id"], returning=["id"])))
    log.info("tse %d: %d pessoas no resolver, %d candidaturas, %d mandatos", year, len(people.slugs), len(cand_rows), len(mandate_rows))


def _load_votes(conn: psycopg.Connection, year: int, ufs: list[str] | None, force: bool) -> None:
    try:
        f = fetch(f"{BASE}/votacao_candidato_munzona/votacao_candidato_munzona_{year}.zip")
    except FileNotFoundError:
        log.warning("sem votacao_candidato_munzona_%d", year)
        return
    scope = ",".join(sorted(u.upper() for u in ufs)) if ufs else "BR"
    try:
        with run(conn, f"tse.votos.{year}", "tse", input_checksum=f"{f.checksum}:{scope}", force=force) as r:
            paths = _extract(f.path, year, ufs, "votacao_candidato_munzona")
            con = duckdb.connect()
            agg: dict[tuple[str, int], int] = defaultdict(int)
            for p in paths:
                rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
                con.register("t", rel)
                for sq, turno, qt in con.execute("select SQ_CANDIDATO, NR_TURNO, sum(try_cast(QT_VOTOS_NOMINAIS as bigint)) from t group by 1, 2").fetchall():
                    agg[(sq, int(turno))] += int(qt or 0)
                con.unregister("t")
            cur = conn.cursor()
            cur.execute("create temp table tmp_votes (sq text, turno int, votes bigint) on commit drop")
            with cur.copy("copy tmp_votes (sq, turno, votes) from stdin") as cp:
                for (sq, turno), v in agg.items():
                    cp.write_row((sq, turno, v))
            cur.execute(
                """update candidacies c set votes = t.votes, updated_at = now()
                   from tmp_votes t, elections e
                   where c.tse_sequencial = t.sq and c.election_id = e.id and e.year = %s and e.round = t.turno and c.votes is distinct from t.votes""",
                (year,),
            )
            r.add(cur.rowcount)
    except SkipUnchanged:
        return
