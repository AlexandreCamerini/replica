"""Sanções de órgãos de controle (W3-B, D130–D132). Sem tela por enquanto: grava em `sanctions` (migração 0033).

  civico-etl sancoes.tcu      TCU, inabilitados para o exercício de cargo em comissão ou função de confiança
                              (Lei 8.443/92 art. 60), API pública ORDS do TCU, sem chave

  civico-etl sancoes.cgu      CGU, CEIS (inidôneas e suspensas) e CNEP (Lei Anticorrupção), pela API do Portal da Transparência
                              (api-de-dados/ceis e /cnep) com chave `chave-api-dados` (TRANSPARENCIA_API_KEY, catálogo D01)

CGU (D130, reaberto pelo catálogo D03): o ARQUIVO de download do Portal continua atrás de verificação humana (AWS WAF "Human Verification")
e contornar é proibido; o que entra é a API com chave, o caminho legítimo. Só pessoa física é gravada (a que casa com `people`);
CPF/CNPJ/NIS da fonte são descartados no parse (D131). Na API, a UF do DTO é a do ÓRGÃO sancionador, não a da pessoa: por isso o casamento
por UF só vale quando o órgão é estadual ou municipal (esfera); sanção de órgão federal nunca casa, com o motivo gravado.

LGPD (S2-2): CEIS/CNEP de pessoa física trazem milhares de cidadãos comuns. Só é gravada a sanção cuja pessoa física tem nome civil
normalizado (a mesma normalização do D132, em SQL) igual ao de alguém em `people`; as demais são descartadas ANTES de gravar e só contadas
na nota do run. Linhas de pessoa física sem correspondente que uma carga anterior desta branch tenha gravado saem no próximo run de
`sancoes.cgu`, pela remoção "some da lista" (sujeita à trava contra leitura truncada). Logs nunca levam nome: só contagem por motivo.

Casamento (D132): sem CPF no banco (D131), só nome civil completo (>= 3 palavras, sem acento/caixa) + UF da sanção igual à UF
de algum mandato ou candidatura da pessoa, e o nome civil é único no banco inteiro. Qualquer dúvida: sem vínculo, com motivo.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from typing import Any, Callable, Iterable

import psycopg

from .. import db
from .. import http as H
from ..db import SkipUnchanged, run, upsert
from ..util import cents, fold, parse_date

log = logging.getLogger("etl.sancoes")
TCU_INABILITADOS = "https://contas.tcu.gov.br/ords/condenacao/consulta/inabilitados"
CRAWL_DELAY = 10.0  # robots.txt de contas.tcu.gov.br


def _d(s: str | None) -> date | None:
    """ORDS devolve meia-noite de Brasília em UTC ('2022-07-16T03:00:00Z'): a data é a parte local."""
    return date.fromisoformat(s[:10]) if s else None


def norm_name(s: str | None) -> str:
    return " ".join(fold(s).replace("-", " ").split())


def parse_tcu(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for it in items:
        nome = (it.get("nome") or "").strip()
        if not nome:
            continue
        out.append({
            "source_key": f"{it.get('processo')}|{it.get('deliberacao')}|{norm_name(nome)}",
            "name": nome,
            "uf": ((it.get("uf") or "").strip().upper() or None),
            "municipality": (it.get("municipio") or None),
            "process": it.get("processo"),
            "decision": it.get("deliberacao"),
            "decided_on": _d(it.get("data_acordao")),
            "final_on": _d(it.get("data_transito_julgado")),
            "ends_on": _d(it.get("data_final")),
            # CPF/CNPJ da fonte é descartado aqui de propósito (D131)
        })
    return out


def fetch_tcu() -> list[dict[str, Any]]:
    from .assembleias import allowed

    url, items = f"{TCU_INABILITADOS}?limit=1000", []
    old = H.RATE
    H.RATE = 1 / CRAWL_DELAY
    try:
        while url:
            if not allowed(url):
                raise RuntimeError(f"robots.txt bloqueia {url}")
            d = H.fetch_json(url, max_age=86400)
            items += d.get("items") or []
            url = next((l["href"] for l in d.get("links", []) if l.get("rel") == "next"), None) if d.get("hasMore") else None
    finally:
        H.RATE = old
    return items


def norm_sql(col: str) -> str:
    """Normalização do D132 em SQL (sem acento/caixa, só letras e espaço, espaços colapsados). Única definição: casamento e pré-filtro LGPD."""
    return f"array_to_string(array_remove(regexp_split_to_array(trim(regexp_replace(f_unaccent(lower({col})), '[^a-z ]', ' ', 'g')), '\\s+'), ''), ' ')"


def civil_names(conn: psycopg.Connection) -> set[str]:
    """Nomes civis normalizados de `people` (D132)."""
    return {r["n"] for r in conn.execute(f"select distinct {norm_sql('civil_name')} as n from people where civil_name is not null")}


def norm_many(conn: psycopg.Connection, names: list[str]) -> list[str]:
    """Normaliza em SQL, na mesma ordem de entrada: o pré-filtro tem de usar exatamente a função do casamento."""
    if not names:
        return []
    rows = conn.execute(f"select o as i, {norm_sql('t')} as n from unnest(%s::text[]) with ordinality as u(t, o) order by o", (names,)).fetchall()
    return [r["n"] for r in rows]


MATCH_SQL = """
with s as (
  select id, uf, %(norm)s as n from sanctions where source = %(source)s
), p as (
  select p.id, regexp_replace(f_unaccent(lower(p.civil_name)), '[^a-z ]', ' ', 'g') as raw from people p where p.civil_name is not null
), pn as (
  select id, array_to_string(array_remove(regexp_split_to_array(trim(raw), '\\s+'), ''), ' ') as n from p
), homonyms as (
  select n, count(*) as k from pn group by n
), uf_of as (
  select m.person_id, pl.uf from mandates m join places pl on pl.id = m.place_id where pl.uf is not null
  union
  select c.person_id, pl.uf from candidacies c join contests ct on ct.id = c.contest_id join places pl on pl.id = ct.place_id where pl.uf is not null
)
select s.id as sanction_id, pn.id as person_id, h.k as homonyms,
       exists (select 1 from uf_of u where u.person_id = pn.id and u.uf = s.uf) as same_uf
from s join pn on pn.n = s.n join homonyms h on h.n = pn.n
"""


def match(conn: psycopg.Connection, source: str) -> dict[str, int]:
    """D132 para qualquer fonte de `sanctions`. Todo não-vínculo termina com `match_note` (motivo); nenhum fica em branco."""
    conn.execute("update sanctions set person_id = null, match_method = null, match_confidence = null, match_note = null where source = %s", (source,))
    norm = norm_sql("name")
    rows = conn.execute(MATCH_SQL.replace("%(norm)s", norm), {"source": source}).fetchall()
    stats = {"casado": 0, "homonimo": 0, "outra_uf": 0, "nome_curto": 0, "orgao_sem_uf": 0}
    by_s: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        by_s.setdefault(r["sanction_id"], []).append(r)
    names = {r["id"]: r["name"] for r in conn.execute("select id, name from sanctions where source = %s", (source,))}
    sphere = {r["id"]: fold(r["body_sphere"]) for r in conn.execute("select id, body_sphere from sanctions where source = %s", (source,))}
    for sid, cands in by_s.items():
        nm = names[sid]
        if source.startswith("cgu_") and sphere.get(sid) not in ("estadual", "municipal"):
            # a UF do DTO da CGU é a do órgão: em órgão federal não diz onde a pessoa mora ou concorre
            note, key, pid = "órgão sancionador federal ou de esfera desconhecida: a UF do órgão não identifica a pessoa; sem vínculo", "orgao_sem_uf", None
        elif len(norm_name(nm).split()) < 3:
            note, key = "nome com menos de 3 palavras: não casa só por nome", "nome_curto"
            pid = None
        elif len(cands) != 1 or cands[0]["homonyms"] != 1:
            note, key, pid = "mais de uma pessoa no banco com o mesmo nome civil", "homonimo", None
        elif not cands[0]["same_uf"]:
            note, key, pid = "nome civil igual, mas sem mandato ou candidatura na UF da sanção", "outra_uf", None
        else:
            note, key, pid = "nome civil completo igual, único no banco, com mandato ou candidatura na UF da sanção", "casado", cands[0]["person_id"]
        stats[key] += 1
        conn.execute(
            "update sanctions set person_id = %s, match_method = %s, match_confidence = %s, match_note = %s where id = %s",
            (pid, "nome_civil_uf" if pid else None, 0.9 if pid else None, note, sid),
        )
    # sem nenhuma pessoa com o mesmo nome no banco: também é não-vínculo e também tem motivo
    stats["sem_candidato"] = conn.execute(
        "update sanctions set match_note = 'nenhuma pessoa no banco com este nome civil' where source = %s and person_id is null and match_note is null", (source,)
    ).rowcount
    return stats


def run_tcu(conn: psycopg.Connection, force: bool = False) -> dict[str, int]:
    items = fetch_tcu()
    rows = parse_tcu(items)
    with run(conn, "sancoes.tcu_inabilitados", "tcu", force=force) as r:
        cols = ["source", "source_key", "name", "uf", "municipality", "process", "decision", "decided_on", "final_on", "ends_on", "source_url"]
        upsert(conn, "sanctions", cols, [("tcu_inabilitados", x["source_key"], x["name"], x["uf"], x["municipality"], x["process"], x["decision"],
                                          x["decided_on"], x["final_on"], x["ends_on"], TCU_INABILITADOS) for x in rows], ["source", "source_key"])
        # some da lista = saiu da fonte (prazo vencido ou decisão revista): apaga, o dado é o que o TCU publica hoje
        keys = [x["source_key"] for x in rows]
        if keys:
            gone = conn.execute("delete from sanctions where source = 'tcu_inabilitados' and source_key <> all(%s)", (keys,)).rowcount
            if gone:
                r.notes.append(f"{gone} saíram da lista do TCU")
        r.add(len(rows))
        stats = match(conn, "tcu_inabilitados")
        stats["lista"] = len(rows)
        log.info("TCU inabilitados: %s", stats)
    return stats


CGU_SOURCES = {"ceis": "cgu_ceis", "cnep": "cgu_cnep"}
CGU_URL = {"ceis": "https://portaldatransparencia.gov.br/sancoes/ceis", "cnep": "https://portaldatransparencia.gov.br/sancoes/cnep"}


def _is_pf(it: dict[str, Any]) -> bool | None:
    """True = pessoa física, False = jurídica, None = a fonte não deixa claro. `pessoa.tipo` é texto livre no OpenAPI (valores NÃO
    provados contra a fonte); sem ele, só a presença de CPF formatado sem CNPJ indica pessoa física. O número em si é descartado."""
    pes = it.get("pessoa") or {}
    t = fold(pes.get("tipo"))
    if "fisic" in t:
        return True
    if "juridic" in t:
        return False
    cpf, cnpj = (pes.get("cpfFormatado") or "").strip(), (pes.get("cnpjFormatado") or "").strip()
    if cpf and not cnpj:
        return True
    if cnpj and not cpf:
        return False
    return None


def parse_cgu(items: list[dict[str, Any]], kind: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """CeisDTO/CnepDTO -> linhas de `sanctions`. Só pessoa física. Descartados de propósito (D131): sancionado.codigoFormatado,
    pessoa.cpfFormatado/cnpjFormatado/numeroInscricaoSocial. Datas da fonte em DD/MM/AAAA.
    Mapa: decided_on = publicação da sanção; final_on = início da sanção; ends_on = fim; decision = fundamentação legal."""
    out, skipped = [], {"pj": 0, "indefinido": 0, "sem_nome": 0}
    for it in items:
        pf = _is_pf(it)
        if pf is None:
            skipped["indefinido"] += 1
            continue
        if not pf:
            skipped["pj"] += 1
            continue
        nome = ((it.get("sancionado") or {}).get("nome") or (it.get("pessoa") or {}).get("nome") or "").strip()
        if not nome or it.get("id") is None:
            skipped["sem_nome"] += 1
            continue
        org = it.get("orgaoSancionador") or {}
        fund = [f.get("descricao") for f in (it.get("fundamentacao") or []) if f.get("descricao")]
        out.append({
            "source": CGU_SOURCES[kind], "source_key": str(it["id"]), "name": nome,
            "uf": ((org.get("siglaUf") or "").strip().upper() or None), "process": (it.get("numeroProcesso") or None),
            "decision": ("; ".join(fund)[:500] or None), "decided_on": parse_date(it.get("dataPublicacaoSancao")),
            "final_on": parse_date(it.get("dataInicioSancao")), "ends_on": parse_date(it.get("dataFimSancao")),
            "sanction_kind": ((it.get("tipoSancao") or {}).get("descricaoResumida") or None), "body": (org.get("nome") or None),
            "body_sphere": (org.get("esfera") or None), "fine_cents": cents(it.get("valorMulta")) if kind == "cnep" else None,
        })
    return out, skipped


def run_cgu(conn: psycopg.Connection, *, kinds: tuple[str, ...] = ("ceis", "cnep"), key: str | None = None, force: bool = False,
            gate: Any = None, pages: Callable[[str, Any], Iterable[list[dict[str, Any]]]] | None = None) -> dict[str, dict[str, int]]:
    """CEIS e CNEP completos (paginação inteira antes de gravar: erro no meio não grava nem carimba).

    LGPD: pessoa física sem nome civil igual ao de alguém em `people` não é gravada (contada na nota).
    Remoção (some da lista = saiu da fonte, ou saiu do filtro acima): só com leitura NÃO truncada e só se o que foi LIDO (pessoas físicas,
    antes do filtro LGPD) for pelo menos metade do que estava gravado ANTES do upsert; senão nada é apagado e o run leva a nota.
    `pages(kind, state)` é injetável (teste); `state` é o `T.PageRead` que a paginação real preenche."""
    import hashlib
    import json

    from .. import transparencia as T

    gate = gate or T.Gate()
    res: dict[str, dict[str, int]] = {}
    civil = civil_names(conn)
    for kind in kinds:
        src = CGU_SOURCES[kind]
        state = T.PageRead()
        raw = [x for page in (pages(kind, state) if pages else T.iter_pages(kind, {}, key=key, gate=gate, state=state)) for x in page]
        parsed, skipped = parse_cgu(raw, kind)
        norms = norm_many(conn, [x["name"] for x in parsed])
        rows = [x for x, n in zip(parsed, norms) if n in civil]
        no_person = len(parsed) - len(rows)
        # entrada = fonte + o que sobrou do filtro LGPD (depende de `people`) + versão do filtro: a carga que gravou pessoa física sem
        # correspondente tem checksum diferente e NÃO é pulada, então o próximo run a limpa
        checksum = hashlib.sha256(json.dumps([raw, sorted(x["source_key"] for x in rows), "lgpd1"], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        try:
            with run(conn, f"cgu.{kind}", "cgu", input_checksum=checksum, force=force) as r:
                # contagem ANTES do upsert: é o tamanho da fonte que a trava de leitura truncada compara
                have = conn.execute("select count(*) as n from sanctions where source = %s", (src,)).fetchone()["n"]
                cols = ["source", "source_key", "name", "uf", "process", "decision", "decided_on", "final_on", "ends_on", "source_url",
                        "sanction_kind", "body", "body_sphere", "fine_cents"]
                upsert(conn, "sanctions", cols, [(x["source"], x["source_key"], x["name"], x["uf"], x["process"], x["decision"], x["decided_on"], x["final_on"],
                                                  x["ends_on"], CGU_URL[kind], x["sanction_kind"], x["body"], x["body_sphere"], x["fine_cents"]) for x in rows],
                       ["source", "source_key"])
                keys = [x["source_key"] for x in rows]
                if state.truncated:
                    r.notes.append(f"leitura possivelmente truncada ({state.note}): nada apagado")
                elif not parsed:
                    r.notes.append(f"nenhuma pessoa física lida ({len(raw)} registros); {have} gravadas mantidas: nada apagado")
                elif len(parsed) * 2 < have:
                    r.notes.append(f"leitura ({len(parsed)} pessoas físicas) menor que metade da gravada ({have}): nada apagado; confira a fonte antes de forçar")
                else:
                    gone = conn.execute("delete from sanctions where source = %s and source_key <> all(%s)", (src, keys)).rowcount
                    if gone:
                        r.notes.append(f"{gone} saíram da lista da CGU ({kind}) ou não têm correspondente em `people`")
                r.notes.append(f"{len(raw)} registros lidos; fora da carga: {skipped['pj']} pessoas jurídicas, {skipped['indefinido']} sem tipo identificável, "
                               f"{skipped['sem_nome']} sem nome/id, {no_person} pessoas físicas sem nome civil igual ao de alguém em people (LGPD)")
                r.add(len(rows))
                stats = match(conn, src)
                stats["lista"] = len(rows)
                stats["sem_pessoa_lgpd"] = no_person
                res[kind] = stats
                log.info("CGU %s: %s", kind, stats)
        except SkipUnchanged:
            continue
    return res


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl sancoes.*")
    p.add_argument("job", choices=["sancoes.tcu", "sancoes.cgu"])
    p.add_argument("--force", action="store_true")
    a = p.parse_args(argv)
    if a.job == "sancoes.cgu":
        from .. import transparencia as T

        try:
            key = T.api_key()
        except T.NoKey as e:
            print(str(e), file=sys.stderr)
            return 2
        conn = db.connect()
        try:
            run_cgu(conn, key=key, force=a.force)
        except H.ApiAuthError as e:
            print(f"chave recusada pela API (HTTP {e.status}); rode transparencia.ping", file=sys.stderr)
            return 1
        finally:
            conn.close()
        return 0
    conn = db.connect()
    try:
        run_tcu(conn, force=a.force)
    except SkipUnchanged:
        pass
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
