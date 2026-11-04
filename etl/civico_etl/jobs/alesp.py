"""ale.sp: Assembleia Legislativa de São Paulo (ALESP), portal de dados abertos (www.al.sp.gov.br/dados-abertos).

Fontes (arquivos completos, atualização diária, sem chave):
  repositorioDados/deputados/deputados.xml                     -> deputados em exercício (IdSPL, Matricula, nome, partido, aniversário)
  repositorioDados/deputados/despesas_gabinetes_{ano}.xml      -> verba de gabinete por mês (matrícula, tipo, fornecedor, CNPJ, valor)
  repositorioDados/processo_legislativo/proposituras.zip       -> proposituras (natureza, número, ano, ementa, publicação)
  repositorioDados/processo_legislativo/documento_autor.zip    -> autores de cada documento (IdAutor = IdSPL)
  repositorioDados/processo_legislativo/naturezasSpl.xml       -> natureza -> sigla

Não lido (D102): presença e votos em plenário. O catálogo lista um serviço /deputadoPresenca que responde 404; em dado aberto só
há presença e votação de reuniões de comissão (comissoes_permanentes_presencas/votacoes.xml), que não são a mesma medida
da Câmara (sessão deliberativa do plenário) e não entram como "presença" nem como "votos em plenário".

Autoria (D103): o arquivo não traz ordem de assinatura. Documento com um autor só -> autor principal; com mais de um,
todos entram como coautoria (não dá para dizer quem encabeçou).
"""

from __future__ import annotations

import logging
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date

import psycopg

from ..db import SkipUnchanged, run
from ..util import cents, parse_date, sha256_text
from .assembleias import Assembly, AssemblyMatcher, PropRow, category_label, ensure_assembly, polite_fetch, set_coverage, supplier, write_expenses, write_proposals

log = logging.getLogger("etl.alesp")
BASE = "https://www.al.sp.gov.br/repositorioDados"
ASSEMBLY = Assembly("SP", "alesp", "ALESP · Dados Abertos", "https://www.al.sp.gov.br/dados-abertos/", "dados abertos da ALESP (uso livre com citação da fonte)")
TYPES = {"1": "PL", "2": "PLC", "3": "PR", "4": "PDL", "5": "PEC", "104": "PEC"}
DAY = 86400


def _iter(path, tag: str, member: str | None = None):
    src = zipfile.ZipFile(path).open(member) if member else open(path, "rb")
    with src as f:
        for _, el in ET.iterparse(f):
            if el.tag == tag:
                yield {c.tag: (c.text or "").strip() for c in el}
                el.clear()


def run_alesp(conn: psycopg.Connection, *, years: list[int], force: bool) -> list[str]:
    a = ensure_assembly(conn, ASSEMBLY)
    m = AssemblyMatcher(conn, "SP", a.source_slug)
    f_dep = polite_fetch(f"{BASE}/deputados/deputados.xml")
    # 1) deputados em exercício: partido e aniversário confirmam o nome (IdSPL e matrícula apontam para a mesma pessoa)
    current = list(_iter(f_dep.path, "Deputado"))
    for d in current:
        bday = d.get("Aniversario") if d.get("Aniversario") and "null" not in d.get("Aniversario", "") else None
        pid = m.match(f"spl:{d['IdSPL']}", d["NomeParlamentar"], d.get("Partido"), birthday=bday)
        if pid and d.get("Matricula"):
            m.match(f"mat:{d['Matricula']}", d["NomeParlamentar"], d.get("Partido"), birthday=bday)
    m.flush()
    conn.commit()
    notes: list[str] = []

    # 2) verba de gabinete por ano
    for y in years:
        try:
            f = polite_fetch(f"{BASE}/deputados/despesas_gabinetes_{y}.xml")
        except FileNotFoundError:
            log.warning("ALESP ainda não publicou despesas de %d", y)
            continue
        try:
            with run(conn, f"alesp.despesas.{y}", a.source_slug, input_checksum=f.checksum + ":r1", force=force) as r:
                rows, seen, skipped = [], defaultdict(int), defaultdict(int)
                for x in _iter(f.path, "despesa"):
                    mes, ano = int(x.get("Mes") or 0), int(x.get("Ano") or 0)
                    if ano != y or not 1 <= mes <= 12:
                        r.reject(1, f"linha fora do ano/mês: {x}")
                        continue
                    when = date(ano, mes, 1)
                    pid = m.match(f"mat:{x['Matricula']}", x.get("Deputado") or "", when=when)
                    if not pid:
                        skipped[x.get("Deputado") or x["Matricula"]] += 1
                        continue
                    amount = cents(x.get("Valor"))
                    if amount is None:
                        r.reject(1, f"valor inválido: {x}")
                        continue
                    sname, sdoc = supplier(x.get("Fornecedor"), x.get("CNPJ"))
                    base_key = sha256_text("|".join([x["Matricula"], str(ano), str(mes), x.get("Tipo", ""), x.get("CNPJ", ""), x.get("Fornecedor", ""), x.get("Valor", "")]))[:24]
                    seen[base_key] += 1  # mesma linha repetida na fonte = lançamentos distintos
                    rows.append((pid, when, category_label(x.get("Tipo", "")), sname, sdoc, amount, None, f"{base_key}:{seen[base_key]}"))
                m.flush()
                r.add(write_expenses(conn, a, y, rows))
                if skipped:
                    r.notes.append(f"{sum(skipped.values())} lançamentos de {len(skipped)} deputado(s) sem crachá: " + ", ".join(sorted(skipped))[:400])
                log.info("ALESP despesas %d: %d lançamentos gravados, %d de deputados sem crachá", y, len(rows), sum(skipped.values()))
        except SkipUnchanged:
            continue

    # 3) proposituras e autores (arquivos únicos com toda a história; o recorte é por ano legislativo)
    f_nat = polite_fetch(f"{BASE}/processo_legislativo/naturezasSpl.xml", max_age=7 * DAY)
    f_pr = polite_fetch(f"{BASE}/processo_legislativo/proposituras.zip")
    f_au = polite_fetch(f"{BASE}/processo_legislativo/documento_autor.zip")
    nat = {d.get("idNatureza"): d.get("sgNatureza") for d in _iter(f_nat.path, "natureza")}
    assert nat.get("1") == "PL" and nat.get("2") == "PLC", f"naturezasSpl.xml mudou: {nat.get('1')}, {nat.get('2')}"
    want = {str(y) for y in years}
    docs: dict[str, dict] = {}
    for x in _iter(f_pr.path, "propositura", "proposituras.xml"):
        t = TYPES.get(x.get("IdNatureza", ""))
        if t and x.get("AnoLegislativo") in want and (x.get("NroLegislativo") or "").isdigit():
            docs[x["IdDocumento"]] = x | {"_type": t}
    authors: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for x in _iter(f_au.path, "DocumentoAutor", "documento_autor.xml"):
        if x.get("IdDocumento") in docs:
            authors[x["IdDocumento"]].append((x.get("IdAutor", ""), x.get("NomeAutor", "")))
    by_year: dict[int, list[PropRow]] = defaultdict(list)
    no_person: dict[str, int] = defaultdict(int)
    for doc_id, x in docs.items():
        au = authors.get(doc_id, [])
        role = "principal" if len(au) == 1 else "coautoria"
        when = parse_date(x.get("DtPublicacao"))
        people = []
        for aid, aname in au:
            pid = m.match(f"spl:{aid}", aname, when=when) if aid else None
            if pid:
                people.append((pid, role))
            else:
                no_person[aname] += 1
        y = int(x["AnoLegislativo"])
        by_year[y].append(PropRow(x["_type"], int(x["NroLegislativo"]), y, x.get("Ementa", "").strip(), None, when,
                                  f"https://www.al.sp.gov.br/propositura/?id={doc_id}", people))
    m.flush()
    conn.commit()
    checksum = f"{f_pr.checksum}:{f_au.checksum}:r1"
    for y in years:
        try:
            with run(conn, f"alesp.proposicoes.{y}", a.source_slug, input_checksum=f"{checksum}:{y}", force=force) as r:
                n_p, n_a = write_proposals(conn, a, y, by_year.get(y, []))
                r.add(n_a)
                log.info("ALESP proposituras %d: %d projetos com autor no diretório, %d autorias", y, n_p, n_a)
        except SkipUnchanged:
            continue
    if no_person:
        notes.append(f"autores sem crachá (Governador, Mesa, comissões, suplentes, legislaturas sem mandato no diretório): {len(no_person)} nomes")

    set_coverage(conn, a, {
        "propostas": ("no_site", "projetos de lei, de lei complementar, de resolução, de decreto legislativo e PECs, do portal de dados abertos da ALESP", f"{BASE}/processo_legislativo/proposituras.zip"),
        "gastos_gabinete": ("no_site", "verba de gabinete por mês, do portal de dados abertos da ALESP", f"{BASE}/deputados/despesas_gabinetes.xml"),
        "presenca": ("nao_publica", "a ALESP não publica em dado aberto a presença de cada deputado no plenário (só em reuniões de comissão)", "https://www.al.sp.gov.br/dados-abertos/catalogo"),
        "votos": ("nao_publica", "a ALESP não publica em dado aberto o voto de cada deputado no plenário (só em reuniões de comissão)", "https://www.al.sp.gov.br/dados-abertos/catalogo"),
    })
    return m.report() + notes
