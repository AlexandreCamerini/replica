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

import json

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


def registration_rank(result: str | None) -> int:
    """Entre dois registros da mesma pessoa na mesma disputa (registro substituído), fica o de maior posto: eleito > foi à
    urna (suplente, não eleito, 2º turno) > sem resultado (#NULO#, INAPTO, indeferido, renúncia). BUG-039, D238."""
    if result in ELECTED:
        return 2
    if result in ("suplente", "nao_eleito", "segundo_turno"):
        return 1
    return 0


def row_result(x: dict[str, Any]) -> str | None:
    """Resultado da linha do consulta_cand no vocabulário de candidacies.result."""
    result = RESULT.get((x.get("DS_SIT_TOT_TURNO") or "").strip().upper())
    if result is None:
        detail = (x.get("DS_DETALHE_SITUACAO_CAND") or "").upper()
        result = "indeferido" if "INDEFERIDO" in detail else "renuncia" if "RENÚNCIA" in detail or "RENUNCIA" in detail else None
    return result
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
    # grafias do consulta_cand_2012 que o IBGE mudou depois (BUG-036, D226): sem isto a linha era rejeitada sem lugar
    ("RO", "machadinho do oeste"): "machadinho d'oeste",
    ("RO", "alta floresta do oeste"): "alta floresta d'oeste",
    ("RO", "nova brasilandia do oeste"): "nova brasilandia d'oeste",
    ("RO", "santa luzia do oeste"): "santa luzia d'oeste",
    ("RO", "sao felipe do oeste"): "sao felipe d'oeste",
    ("CE", "itapage"): "itapaje",
    ("RJ", "trajano de morais"): "trajano de moraes",
    ("TO", "couto de magalhaes"): "couto magalhaes",
    ("TO", "sao valerio da natividade"): "sao valerio",
    ("TO", "fortaleza do tabocao"): "tabocao",
    ("PE", "belem de sao francisco"): "belem do sao francisco",
    ("PE", "iguaraci"): "iguaracy",
    ("SC", "luis alves"): "luiz alves",
    ("SC", "presidente castelo branco"): "presidente castello branco",
    ("RN", "ares"): "arez",
    ("BA", "quinjingue"): "quijingue",
    ("PB", "sao domingos de pombal"): "sao domingos",
}
# Anos em que o SQ_CANDIDATO NÃO é único na eleição do arquivo: em 2012, 91 SQ aparecem numa linha da eleição ordinária e
# noutra de uma suplementar (2013-2015) de outro município, de pessoas diferentes (BUG-035, D224). Neles a chave leva a UE.
SQ_COM_UE = {2012}
COLS = [
    "ANO_ELEICAO", "NM_TIPO_ELEICAO", "NR_TURNO", "DT_ELEICAO", "SG_UF", "SG_UE", "NM_UE", "CD_CARGO",
    "SQ_CANDIDATO", "NR_CANDIDATO", "NM_CANDIDATO", "NM_URNA_CANDIDATO", "NR_PARTIDO", "SG_PARTIDO", "NM_PARTIDO",
    "NM_COLIGACAO", "SG_UF_NASCIMENTO", "NM_MUNICIPIO_NASCIMENTO", "DT_NASCIMENTO", "NR_TITULO_ELEITORAL_CANDIDATO",
    "CD_GENERO", "DS_GRAU_INSTRUCAO", "DS_SIT_TOT_TURNO", "DS_DETALHE_SITUACAO_CAND",
]


def tse_key(year: int, sq: str, ue: str | None = None) -> str:
    """Chave da pessoa no TSE em person_external_ids: (ano da eleição, SQ_CANDIDATO). O SQ só é único dentro da eleição e o TSE
    reaproveita os números entre anos (BUG-032: o "Dinelci" de Fonte Boa 2012 tem o mesmo SQ do Roberto Cidade em Manaus 2016).
    Candidaturas de anos diferentes só se ligam à mesma pessoa pelo título de eleitor ou por nome civil + nascimento (D210).
    Em 2012 o SQ se repete entre a eleição ordinária e as suplementares do mesmo arquivo: a chave é ANO:UE:SQ (D224)."""
    if int(year) in SQ_COM_UE:
        if not (ue or "").strip():
            raise ValueError(f"chave do TSE de {year} exige a UE (SQ {sq})")
        return f"{int(year)}:{ue.strip()}:{sq.strip()}"
    return f"{int(year)}:{sq.strip()}"


def muni_index(conn: psycopg.Connection):
    """(UF, nome do município no TSE) -> place_id, com as grafias do TSE que o IBGE escreve diferente."""
    muni = {(row["uf"], fold(row["name"])): str(row["id"]) for row in conn.execute("select uf, name, id from places where kind = 'municipio'")}
    # 2º critério: só letras e dígitos (hífen e apóstrofo variam: "Olhos-d'Água" x "OLHOS D'ÁGUA"); 3º: grafias que o TSE e o IBGE escrevem diferente
    muni_alnum = {(uf, re.sub(r"[^a-z0-9]", "", name)): pid for (uf, name), pid in muni.items()}

    def muni_lookup(uf: str, name: str | None) -> str | None:
        f = fold(name)
        return muni.get((uf, f)) or muni_alnum.get((uf, re.sub(r"[^a-z0-9]", "", f))) or muni.get((uf, TSE_TO_IBGE.get((uf, f), "")))

    return muni_lookup


def term_dates(office: str, year: int) -> tuple[date, date]:
    """Posse e fim previsto (exclusivo). EC 111/2021: a partir de 2027 presidente toma posse em 5/1 e governador em 6/1."""
    y = year + 1
    if office in ("presidente", "vice_presidente"):
        posse = lambda yy: date(yy, 1, 1) if yy <= 2023 else date(yy, 1, 5)  # noqa: E731 - EC 111/2021 vale a partir de 2027
        start, end = posse(y), posse(y + 4)
    elif office in ("governador", "vice_governador"):
        posse = lambda yy: date(yy, 1, 1) if yy <= 2023 else date(yy, 1, 6)  # noqa: E731
        start, end = posse(y), posse(y + 4)
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


def load_order(years: list[int]) -> list[int]:
    """Anos do mais novo para o mais antigo (D245). Pela D07 só a eleição com mandato atual ou a tomar posse cria pessoa; uma
    eleição antiga só liga a quem já está no diretório. Em ordem crescente, numa carga do zero, 2012-2020 rodam antes de
    existir a pessoa e a candidatura histórica dela não entra (o check do D238 acusa: título ELEITO sem candidatura eleita)."""
    return sorted(set(years), reverse=True)


def run_tse(conn: psycopg.Connection, *, years: list[int], ufs: list[str] | None, only_elected: bool, with_votes: bool, force: bool) -> None:
    for year in load_order(years):
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


def _load_year(conn: psycopg.Connection, r: Run, year: int, cand_zip: Path | None, bens_zip: Path | None, ufs: list[str] | None, only_elected: bool,
               *, cand_paths: list[Path] | None = None, bens_paths: list[Path] | None = None, only: set[tuple[str, str]] | None = None,
               bug: str = "BUG-039", owners: dict[tuple[str, str], str] | None = None) -> None:
    """Carga de um ano. `cand_paths`/`bens_paths`: CSVs já extraídos (reparos, sem rede). `only`: só as linhas (SG_UE, SQ)
    pedidas, com todas as situações (reparos BUG-042/BUG-043, identity.fix041). `bug`: rótulo do registro substituído no log.
    `owners` (passo `historico` do identity.repairs, BUG-053): (SG_UE, SQ) -> pessoa esperada. A linha só entra se o resolve,
    com todas as travas, casar nessa pessoa e não der o título como de outra; senão é rejeitada com nota. Nunca cria pessoa."""
    where = ""
    if only_elected and only is None:
        where = "where DS_SIT_TOT_TURNO in ('ELEITO','ELEITO POR QP','ELEITO POR MÉDIA') or (NR_TURNO = '1' and DS_SIT_TOT_TURNO = '2º TURNO')"
    paths = cand_paths or _extract(cand_zip, year, ufs, "consulta_cand")
    rows = _read(paths, COLS, where)
    shared_src = title_source_rows(paths, where, rows)
    if only is not None:
        rows = [x for x in rows if ((x["SG_UE"] or "").strip(), (x["SQ_CANDIDATO"] or "").strip()) in only]
    log.info("tse %d: %d candidaturas lidas (%s)", year, len(rows), "eleitos" if only_elected and only is None else "todas" if only is None else "pedidas")

    people = PersonResolver(conn)
    # BUG-044: títulos em 2 SQ da mesma eleição; a carga traz o ano antes de o passo `titulos` gravá-lo em tse_titulo_candidatura
    people.note_title_rows(title_rows(shared_src, None))
    parties = PartyResolver(conn)
    offices = {o["slug"]: str(o["id"]) for o in conn.execute("select slug, id from offices")}
    places = {row["ibge_code"]: str(row["id"]) for row in conn.execute("select ibge_code, id from places")}
    by_uf = {row["uf"]: str(row["id"]) for row in conn.execute("select uf, id from places where kind = 'uf'")}
    muni_lookup = muni_index(conn)

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
    sq_round1: dict[tuple[str, str], tuple[str, str]] = {}  # (SQ, UE) -> (contest_id, person_id) do 1º turno, para bens (SQ repete em 2012)
    not_in_dir = 0
    # mesma pessoa com duas candidaturas na mesma eleição (registro substituído, renúncia e novo registro): fica a que já está no
    # banco ou, no lote, a eleita primeiro
    # (a chave inclui o SQ: na mesma disputa, o registro substituído e o novo têm SQ diferentes; BUG-036, D226)
    # registro substituído na mesma disputa e com o mesmo número: fica o de maior posto (eleito > foi à urna > INAPTO/#NULO#),
    # e não o que chegou primeiro (BUG-039, D238). O que sai vai inteiro para identity_repair_log (bug BUG-039).
    db_person_election: dict[tuple[str, str], tuple[str, str]] = {}
    db_cand: dict[tuple[str, str], dict[str, Any]] = {}
    for r_ in conn.execute("select * from candidacies where election_id = any(%s::uuid[])", (list(elections.values()),)):
        db_person_election[(str(r_["person_id"]), str(r_["election_id"]))] = (str(r_["contest_id"]), r_["tse_sequencial"])
        db_cand[(str(r_["person_id"]), str(r_["election_id"]))] = r_
    superseded: list[dict[str, Any]] = []
    # maior posto primeiro (eleito > foi à urna > INAPTO/#NULO#): o registro substituído nunca chega antes do válido da mesma
    # disputa, senão o válido era rejeitado como "pessoa duplicada" (BUG-043, D242)
    parsed.sort(key=lambda x: -registration_rank(row_result(x)))
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
        titulo = titulo if titulo and titulo.isdigit() else None  # '-4': título não divulgável, não é id
        result = row_result(x)
        # D07: só cria pessoa nova no diretório quem tem mandato atual ou a tomar posse; o resto (derrotados, eleições antigas)
        # só se liga a quem já está no diretório (histórico, patrimônio, campanhas). O diretório não vira lista de candidatos.
        s0, e0 = term_dates(x["office"], year)
        if x["kind"] == "suplementar":
            s0 = x["held"]
        may_create = result in ELECTED and e0 > today
        m = people.resolve(source="tse", external_id=tse_key(year, sq, x["SG_UE"]), civil_name=civil, birth_date=birth, birth_uf=birth_uf, titulo=titulo,
                           uf=x["SG_UF"], place_id=x["place"], year=year,
                           raw={"ano": year, "nome": civil, "urna": urna, "cargo": x["office"], "uf": x["SG_UF"], "ue": x["NM_UE"], "sq": sq,
                                "titulo": titulo, "nascimento": str(birth) if birth else None, "situacao": x["DS_SIT_TOT_TURNO"]})
        if m.why:
            r.notes.append(f"{civil} ({sq}): {m.why}")
        if m.method == "queued":
            r.reject(1)
            continue
        if owners is not None:
            want = owners.get(((x["SG_UE"] or "").strip(), sq))
            if m.title_foreign or m.person_id is None or m.person_id != want:
                r.reject(1, f"histórico do título recusado: {civil} {birth} ({sq}) não casa na pessoa do título "
                            f"({'título de outra pessoa' if m.title_foreign else m.method})")
                continue
        if m.title_foreign:
            # BUG-041 (D240): o título é de outra pessoa do diretório; esta linha só entra como pessoa nova e sem o título
            titulo = None
            if m.person_id is None and not may_create:
                r.reject(1, f"título repetido pelo TSE na linha de outra pessoa, fora do diretório: {civil} {birth} ({sq})")
                continue
        if m.person_id is None and not may_create:
            not_in_dir += 1
            continue
        pid = m.person_id or people.create(
            display_name=urna, civil_name=civil, gender=GENDER.get((x["CD_GENERO"] or "").strip()), birth_date=birth,
            birthplace_place_id=muni_lookup(birth_uf, x["NM_MUNICIPIO_NASCIMENTO"]) if birth_uf else None,
            education=(lambda e: e[0].upper() + e[1:].lower() if e else None)(nz(x["DS_GRAU_INSTRUCAO"]) or ""),
            slug_hints=((x["SG_UF"] or "").lower() or None, x["office"].replace("_", "-")),
            source="tse", external_id=tse_key(year, sq, x["SG_UE"]), titulo=titulo, uf=x["SG_UF"], place_id=x["place"],
        )
        el_id = elections[(x["kind"], year, x["turno"], x["held"])]
        contest_id = contests[(el_id, offices[x["office"]], x["place"])]
        if db_person_election.get((pid, el_id), (contest_id, sq)) != (contest_id, sq):
            old_c = db_cand[(pid, el_id)]
            number = int(x["NR_CANDIDATO"]) if (x["NR_CANDIDATO"] or "").isdigit() else None
            if (str(old_c["contest_id"]) == contest_id and old_c["ballot_number"] == number
                    and registration_rank(result) > registration_rank(old_c["result"]) and (pid, el_id) not in seen_person_election):
                superseded.append(old_c)
                db_person_election[(pid, el_id)] = (contest_id, sq)
            else:
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
            sq_round1[(sq, (x["SG_UE"] or "").strip())] = (contest_id, pid)
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
    # BUG-038: a linha da fonte de cada título do diretório (inclusive as que não viram candidatura) para os checks de fusão
    known = {ext for (src_id, ext) in people.external if src_id == people.sources.get("tse-titulo")}
    write_title_rows(conn, title_rows(rows, known))
    if superseded:
        _drop_superseded(conn, r, superseded, year, bug)
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
        # mandato que a casa (ou outra carga) já registrou com outra data de início para a mesma pessoa e cargo: fica o existente
        # (ex.: senador eleito em suplementar que o Senado registra desde o início da legislatura)
        have: dict[tuple[str, str], list[tuple[date, date]]] = defaultdict(list)
        for row in conn.execute("select person_id, office_id, started_on, ends_on from mandates where person_id = any(%s::uuid[])", (list({x[0] for x in rows_m}),)):
            have[(str(row["person_id"]), str(row["office_id"]))].append((row["started_on"], row["ends_on"]))
        kept = []
        for row in rows_m:
            spans = have[(row[0], row[1])]
            if any(s_ != row[8] and s_ < row[9] and row[8] < e_ for s_, e_ in spans):
                r.reject(1, f"mandato sobreposto a um já registrado: pessoa {row[0]} desde {row[8]}")
                continue
            spans.append((row[8], row[9]))
            kept.append(row)
        rows_m = kept
        n = len(upsert(
            conn, "mandates",
            ["person_id", "office_id", "place_id", "body_id", "party_id", "candidacy_id", "role", "status", "started_on", "ends_on", "elected_by", "status_source"],
            rows_m, ["person_id", "office_id", "place_id", "started_on"],
            update=["status", "candidacy_id"], where="mandates.status = 'eleito_aguardando_posse'", returning=["id"],
        ))
        r.add(n)

    # 5) bens declarados (soma por candidatura do 1º turno)
    if bens_zip or bens_paths:
        brows = _read(bens_paths or _extract(bens_zip, year, ufs, "bem_candidato"), ["SQ_CANDIDATO", "SG_UE", "VR_BEM_CANDIDATO"])
        total: dict[tuple[str, str], int] = defaultdict(int)
        for b in brows:
            v = cents(b["VR_BEM_CANDIDATO"])
            k = (b["SQ_CANDIDATO"], (b["SG_UE"] or "").strip())
            if k in sq_round1 and v is not None:
                total[k] += v
        decl = []
        for (sq, _ue), tot in total.items():
            contest_id, pid = sq_round1[(sq, _ue)]
            cid = cand_id.get((sq, contest_id))
            if cid:
                decl.append((pid, cid, year, tot, "BRL"))
        r.add(len(upsert(conn, "asset_declarations", ["person_id", "candidacy_id", "year", "total_cents", "currency"], decl, ["candidacy_id"], returning=["id"])))
    log.info("tse %d: %d pessoas no resolver, %d candidaturas, %d mandatos", year, len(people.slugs), len(cand_rows), len(mandate_rows))


def title_source_rows(paths: list[Path], where: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Todas as linhas do arquivo com os títulos das linhas carregadas (BUG-044). O mesmo título em 2 SQ da mesma eleição com
    nomes diferentes não prova nenhuma das linhas; a carga padrão só lê eleitos, e o 2º SQ (não eleito) ficaria invisível.
    Sem filtro (`--all` ou reparo), as linhas carregadas já são todas. A busca é dentro dos arquivos da carga: numa carga
    `--uf`, o 2º SQ de outra UF só é visto se já estiver em tse_titulo_candidatura; senão vale `title_row_foreign`."""
    if not where:
        return rows
    return _read(paths, COLS, f"where NR_TITULO_ELEITORAL_CANDIDATO in (select NR_TITULO_ELEITORAL_CANDIDATO from t {where})")


def title_rows(rows: list[dict[str, Any]], known: set[str] | None) -> list[tuple]:
    """Linhas de tse_titulo_candidatura (migração 0065) dos títulos em `known` (None: todos). 2º turno é a mesma linha."""
    out = {}
    for x in rows:
        t = nz(x.get("NR_TITULO_ELEITORAL_CANDIDATO"))
        sq, ue = nz(x.get("SQ_CANDIDATO")), (x.get("SG_UE") or "").strip()
        tipo = (x.get("NM_TIPO_ELEICAO") or "").upper()
        kind = "suplementar" if "SUPLEMENTAR" in tipo else "ordinaria" if "ORDIN" in tipo else None
        if not (t and sq and ue and kind) or (known is not None and t not in known):
            continue
        k = (t, int(x["ANO_ELEICAO"]), ue, sq)
        if k in out and (x.get("NR_TURNO") or "1") != "1":
            continue
        nr = (x.get("NR_CANDIDATO") or "").strip()
        out[k] = (*k, kind, (x.get("SG_UF") or "").strip() or None, CARGO.get((x.get("CD_CARGO") or "").strip(), (x.get("CD_CARGO") or "").strip()),
                  (x.get("DS_SIT_TOT_TURNO") or "").strip() or None,
                  # BUG-041/043 (migração 0066): nome civil, nascimento e número da linha, para os checks de fusão e de registro substituído
                  nz(x.get("NM_CANDIDATO")), parse_date(x.get("DT_NASCIMENTO")), int(nr) if nr.isdigit() else None)
    return list(out.values())


def write_title_rows(conn: psycopg.Connection, trows: list[tuple]) -> int:
    if not trows:
        return 0
    return len(upsert(conn, "tse_titulo_candidatura",
                      ["titulo", "year", "ue", "tse_sequencial", "kind", "uf", "cargo", "result", "civil_name", "birth_date", "ballot_number"], trows,
                      ["titulo", "year", "ue", "tse_sequencial"], update=["kind", "uf", "cargo", "result", "civil_name", "birth_date", "ballot_number"],
                      returning=["titulo"]))


def _drop_superseded(conn: psycopg.Connection, r: Run, olds: list[dict[str, Any]], year: int, bug: str = "BUG-039") -> None:
    """Tira o registro substituído (INAPTO/#NULO#) que perdeu para o deferido/eleito da mesma disputa e número. Antes de sair,
    a candidatura, os mandatos e os bens vão inteiros para identity_repair_log (bug BUG-039, 'removido'/'substituido')."""
    for c in olds:
        ms = [dict(m) for m in conn.execute("select * from mandates where candidacy_id = %s", (c["id"],))]
        bens = [dict(b) for b in conn.execute("select * from asset_declarations where candidacy_id = %s", (c["id"],))]
        conn.execute(
            """insert into identity_repair_log (bug, candidacy_id, year, tse_sequencial, action, reason, from_person_id, mandates_removed, raw)
               values (%s, %s, %s, %s, 'removido', 'substituido', %s, %s, %s) on conflict (bug, candidacy_id) do nothing""",
            (bug, c["id"], year, c["tse_sequencial"], c["person_id"], len(ms),
             json.dumps({"candidacy": dict(c), "mandates": ms, "asset_declarations": bens}, ensure_ascii=False, default=str)))
        conn.execute("delete from asset_declarations where candidacy_id = %s", (c["id"],))
        conn.execute("delete from mandates where candidacy_id = %s", (c["id"],))
        conn.execute("delete from candidacies where id = %s", (c["id"],))
        r.notes.append(f"registro substituído {c['tse_sequencial']} saiu para o deferido/eleito da mesma disputa ({bug})")
        log.info("tse %d: registro substituído %s (%s) saiu para o deferido/eleito da mesma disputa", year, c["tse_sequencial"], c["result"])


def _load_votes_ue(conn: psycopg.Connection, con, paths: list[Path], year: int, r) -> int:
    """Votos por (SG_UE, SQ, turno) nos anos de SQ_COM_UE (BUG-048), com a mesma regra de tse_votos_contas: a candidatura é a
    da chave tse ANO:UE:SQ da própria pessoa (D224), uma por chave (`_cand_by_ue`: sem chave ou com 2 UEs fica de fora, com
    nota). Linha sem SG_UE (ou arquivo sem a coluna) não grava, e a contagem vai para as notas do run."""
    from .tse_votos_contas import _apply_ue, _note_sem_ue

    agg: dict[tuple[tuple[str, str], int], int] = defaultdict(int)
    for p in paths:
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        con.register("t", rel)
        ue = "SG_UE" if "SG_UE" in rel.columns else "NULL"
        for u, sq, turno, qt in con.execute(
                f"select {ue}, SQ_CANDIDATO, NR_TURNO, sum(try_cast(QT_VOTOS_NOMINAIS as bigint)) from t group by 1, 2, 3").fetchall():
            agg[(((u or "").strip(), sq), int(turno))] += int(qt or 0)
        con.unregister("t")
    _note_sem_ue(r, year, {k for k, _ in agg}, "votação")
    return _apply_ue(conn, year, "votes", {key: v for key, v in agg.items() if key[0][0]}, by_round=True, r=r)


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
            if int(year) in SQ_COM_UE:
                # BUG-048: o SQ se repete entre UEs (BUG-035); soma por (UE, SQ) e casa pela chave ANO:UE:SQ da pessoa
                r.add(_load_votes_ue(conn, con, paths, year, r))
                return
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
