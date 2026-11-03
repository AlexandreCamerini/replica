"""Câmaras Municipais pelo SAPL (Interlegis), W3-B. Sem tela por enquanto: grava em sapl_* (migração 0032).

  civico-etl sapl.descobrir [--ibge CODIGO ...]     registro oficial do Interlegis -> URL do SAPL -> /api/ responde?
  civico-etl sapl.carregar  [--ibge CODIGO ...]     por câmara "ok": vereadores, mandatos, projetos, autorias, sessões,
                                                    presença e votos nominais da legislatura atual; casa vereador com o TSE
  civico-etl sapl.todas                             descobrir + carregar (padrão: capitais)

Descoberta (D126): a fonte da URL é a página "Órgãos atendidos" do Interlegis
(www12.senado.leg.br/interlegis/orgaosatendidos?uf=..&municipio=..; com &servico= a página dá 500), cartão "Câmara Municipal", linha "SAPL".
Não se chuta domínio. Depois, GET {url}/api/ precisa devolver o índice da API REST do SAPL 3.x.

Crawler educado: User-Agent identificado (http.UA), uma câmara por vez, >= 1,1 s entre requisições ao mesmo host,
robots.txt respeitado (assembleias.allowed), cache em disco (http.fetch; páginas valem 1 dia -> rodar de novo retoma
de onde parou sem bater na rede). Escopo: só a legislatura atual (D127).
Matérias: só projetos (tipo cujo nome começa com "Projeto": PL, PLC, PR, PDL, emenda à Lei Orgânica...);
indicação, requerimento, moção e ofício ficam fora (mesma régua da D101 das Assembleias).
Casamento (D128): vereador do SAPL -> pessoa do TSE com mandato de vereador no mesmo município e legislatura, por nome
de urna (= nome parlamentar) ou nome civil completo, sem acento/caixa. Só casa se houver exatamente 1 candidato;
ambíguo ou sem candidato fica sem person_id, com motivo em match_note e no log. Nunca cria pessoa.
"""

from __future__ import annotations

import argparse
import html as htmllib
import logging
import re
import sys
from datetime import date, datetime
from typing import Any, Iterator
from urllib.parse import quote, urlencode

import psycopg

from .. import db
from .. import http as H
from ..db import SkipUnchanged, run, upsert
from ..util import fold

log = logging.getLogger("etl.sapl")

MIN_INTERVAL = 1.1
H.RATE = 1 / MIN_INTERVAL
PAGE = 100
DAY = 86400
REGISTRY = "https://www12.senado.leg.br/interlegis/orgaosatendidos"

# Capitais com câmara municipal (Brasília não tem: CF art. 32). IBGE.
CAPITAIS = [
    "1200401", "2704302", "1600303", "1302603", "2927408", "2304400", "3205309", "5208707", "2111300", "5103403",
    "5002704", "3106200", "1501402", "2507507", "4106902", "2611606", "2211001", "3304557", "2408102", "4314902",
    "1100205", "1400100", "4205407", "3550308", "2800308", "1721000",
]


# ------------------------------------------------------------------ registro do Interlegis (puro, testado)


def parse_registry(page: str, municipio: str) -> tuple[str | None, str | None]:
    """Do HTML de "órgãos atendidos", acha o cartão da Câmara Municipal do município e devolve (url do SAPL, resultado
    da última verificação). (None, None) se a câmara não tem SAPL no registro."""
    cards = re.split(r'<div class="orgao-atendido">', page)
    alvo = fold(f"Câmara Municipal de {municipio}")
    for card in cards:
        m = re.search(r'font-weight:bold;margin-bottom:3px;">\s*([^<]+?)\s*</div>', card)
        if not m or fold(htmllib.unescape(m.group(1))) != alvo:
            continue
        for row in re.findall(r"<tr>(.*?)</tr>", card, re.S):
            cells = [htmllib.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if cells and cells[0].upper() == "SAPL":
                href = re.search(r'href="([^"]+)"', row)
                url = href.group(1).strip().rstrip("/") if href else None
                if url and url.startswith("http://"):
                    url = "https://" + url[len("http://"):]
                return url, (cells[4] if len(cells) > 4 else None)
        return None, None
    return None, None


def is_sapl_api(index: Any) -> bool:
    return isinstance(index, dict) and "parlamentares/parlamentar" in index and "materia/materialegislativa" in index


# ------------------------------------------------------------------ HTTP educado


class Blocked(Exception):
    pass


def _get(url: str, max_age: float = DAY) -> Any:
    from .assembleias import allowed  # robots.txt (RFC 9309) já implementado na W3-A

    if not allowed(url):
        raise Blocked(f"robots.txt bloqueia {url}")
    return H.fetch_json(url, max_age=max_age)


def pages(base: str, path: str, params: dict[str, Any] | None = None, *, stop=None, max_pages: int = 2000) -> Iterator[dict[str, Any]]:
    """Itera resultados paginados da API do SAPL (DRF). `stop(page_results) -> True` encerra após a página (varredura por id
    decrescente com o=-id). Monta a URL da página (os links `next` da fonte vêm em http://)."""
    q = dict(params or {})
    q["page_size"] = PAGE
    for n in range(1, max_pages + 1):
        q["page"] = n
        d = _get(f"{base}/api/{path}/?{urlencode(q)}")
        res = d.get("results") or []
        yield from res
        if stop and stop(res):
            return
        if not (d.get("pagination") or {}).get("next_page"):
            return
    log.warning("%s/%s: parou em %d páginas (limite)", base, path, max_pages)


def _desc_until(key: str, floor: int):
    """Parada para varredura com o=-id: página inteira abaixo do piso (com o campo `key`) encerra."""

    def stop(res: list[dict[str, Any]]) -> bool:
        vals = [r.get(key) for r in res if isinstance(r.get(key), int)]
        return bool(vals) and max(vals) < floor

    return stop


# ------------------------------------------------------------------ descoberta


def discover(conn: psycopg.Connection, codes: list[str]) -> list[dict[str, Any]]:
    places = {r["ibge_code"]: r for r in conn.execute(
        "select id, ibge_code, name, uf from places where kind = 'municipio' and ibge_code = any(%s)", (codes,))}
    bodies = {str(r["place_id"]): str(r["id"]) for r in conn.execute(
        "select id, place_id from legislative_bodies where kind = 'camara_municipal' and place_id = any(%s)", ([p["id"] for p in places.values()],))}
    out = []
    with run(conn, "sapl.descoberta", "sapl") as r:
        for code in codes:
            p = places.get(code)
            if not p:
                r.reject(1, f"IBGE {code} não está em places")
                continue
            reg = f"{REGISTRY}?{urlencode({'uf': p['uf'], 'municipio': p['name']}, quote_via=quote)}"
            row = {"place_id": str(p["id"]), "body_id": bodies.get(str(p["id"])), "registry_url": reg, "base_url": None, "registry_status": None,
                   "status": "sem_sapl_no_registro", "note": None, "name": p["name"], "uf": p["uf"], "ibge": code}
            try:
                url, st = parse_registry(H.fetch(reg, max_age=7 * DAY).text(), p["name"])
            except Exception as e:  # noqa: BLE001
                row["status"], row["note"] = "fora_do_ar", f"registro do Interlegis falhou: {e}"[:500]
                url, st = None, None
            row["base_url"], row["registry_status"] = url, st
            if url:
                try:
                    idx = _get(f"{url}/api/", max_age=7 * DAY)
                    row["status"] = "ok" if is_sapl_api(idx) else "sem_api"
                    if row["status"] == "sem_api":
                        row["note"] = "a URL responde, mas sem a API REST do SAPL 3.x"
                except Blocked as e:
                    row["status"], row["note"] = "robots_bloqueia", str(e)[:500]
                except Exception as e:  # noqa: BLE001 - SAPL 2.5 (sem /api), DNS, TLS, 5xx
                    row["status"], row["note"] = ("sem_api" if isinstance(e, FileNotFoundError) else "fora_do_ar"), f"{type(e).__name__}: {e}"[:500]
            elif row["status"] == "sem_sapl_no_registro":
                row["note"] = "o registro do Interlegis não lista SAPL para a Câmara Municipal"
            log.info("SAPL %s-%s: %s %s %s", p["name"], p["uf"], row["status"], url or "", row["note"] or "")
            out.append(row)
        upsert(conn, "sapl_houses", ["place_id", "body_id", "base_url", "registry_url", "registry_status", "status", "note", "checked_at"],
               [(x["place_id"], x["body_id"], x["base_url"], x["registry_url"], x["registry_status"], x["status"], x["note"], db.now_utc()) for x in out], ["place_id"])
        r.add(len(out))
    return out


# ------------------------------------------------------------------ carga de uma câmara


def _current_legislature(base: str, today: date) -> dict[str, Any] | None:
    legs = list(pages(base, "parlamentares/legislatura"))
    cur = [x for x in legs if x.get("data_inicio") and x.get("data_fim") and x["data_inicio"] <= today.isoformat() <= x["data_fim"]]
    return max(cur, key=lambda x: x["data_inicio"]) if cur else None


def _project_types(base: str) -> dict[int, tuple[str, str]]:
    out = {}
    for t in pages(base, "materia/tipomaterialegislativa"):
        name = (t.get("descricao") or "").strip()
        if fold(name).startswith("projeto"):
            out[int(t["id"])] = ((t.get("sigla") or name[:10]).strip(), name)
    return out


def load_house(conn: psycopg.Connection, house: dict[str, Any], today: date | None = None) -> dict[str, int]:
    today = today or date.today()
    base, hid = house["base_url"], house["id"]
    stats: dict[str, int] = {}
    with run(conn, f"sapl.{house['ibge_code']}", "sapl") as r:
        leg = _current_legislature(base, today)
        if not leg:
            raise RuntimeError("SAPL sem legislatura vigente cadastrada")
        y0 = int(leg["data_inicio"][:4])
        conn.execute("update sapl_houses set legislature_number = %s, legislature_start = %s, legislature_end = %s where id = %s",
                     (leg.get("numero"), leg["data_inicio"], leg["data_fim"], hid))

        parl = list(pages(base, "parlamentares/parlamentar"))
        upsert(conn, "sapl_parlamentares", ["house_id", "sapl_id", "nome_parlamentar", "nome_completo", "sexo", "ativo", "foto_url"],
               [(hid, int(p["id"]), (p.get("nome_parlamentar") or p.get("nome_completo") or "?").strip(), (p.get("nome_completo") or "").strip() or None,
                 (p.get("sexo") or None) and p["sexo"][:1], p.get("ativo"), p.get("fotografia")) for p in parl], ["house_id", "sapl_id"],
               update=["nome_parlamentar", "nome_completo", "sexo", "ativo", "foto_url"])
        mand = list(pages(base, "parlamentares/mandato", {"legislatura": leg["id"]}))
        upsert(conn, "sapl_mandatos", ["house_id", "sapl_id", "parlamentar_sapl_id", "legislature_number", "started_on", "ended_on", "titular"],
               [(hid, int(m["id"]), int(m["parlamentar"]), leg.get("numero"), m.get("data_inicio_mandato"), m.get("data_fim_mandato"), m.get("titular")) for m in mand],
               ["house_id", "sapl_id"])
        stats.update(parlamentares=len(parl), mandatos=len(mand))

        types = _project_types(base)
        mats = []
        for tid, (sig, name) in sorted(types.items()):
            for y in range(y0, today.year + 1):
                for m in pages(base, "materia/materialegislativa", {"tipo": tid, "ano": y}):
                    if not (m.get("numero") and m.get("ano")):
                        continue
                    mats.append((hid, int(m["id"]), sig, name, int(m["numero"]), int(m["ano"]), m.get("data_apresentacao"),
                                 (m.get("ementa") or "(sem ementa)").strip()[:4000], m.get("em_tramitacao"), f"{base}/materia/{m['id']}", m.get("texto_original")))
        upsert(conn, "sapl_materias", ["house_id", "sapl_id", "type_sigla", "type_name", "number", "year", "presented_on", "summary", "in_progress", "url", "text_url"],
               mats, ["house_id", "sapl_id"])
        stats["materias"] = len(mats)

        mat_ids = {m[1] for m in mats}
        autores = {int(a["id"]): a for a in pages(base, "base/autor")}
        parl_ct = {int(t["id"]) for t in pages(base, "contenttypes/contenttype", {"model": "parlamentar"})}
        aut_rows = []
        if mat_ids:
            for a in pages(base, "materia/autoria", {"o": "-id"}, stop=_desc_until("materia", min(mat_ids))):
                if a.get("materia") not in mat_ids:
                    continue
                au = autores.get(int(a["autor"])) or {}
                pid = au.get("object_id") if au.get("content_type") in parl_ct else None
                aut_rows.append((hid, int(a["materia"]), int(a["autor"]), (au.get("nome") or "").strip() or None, pid, a.get("primeiro_autor")))
        upsert(conn, "sapl_autorias", ["house_id", "materia_sapl_id", "autor_sapl_id", "autor_nome", "parlamentar_sapl_id", "primeiro_autor"], aut_rows,
               ["house_id", "materia_sapl_id", "autor_sapl_id"])
        stats["autorias"] = len(aut_rows)

        sess = list(pages(base, "sessao/sessaoplenaria", {"legislatura": leg["id"]}))
        upsert(conn, "sapl_sessoes", ["house_id", "sapl_id", "starts_on", "starts_time", "name", "type_id", "finished", "url"],
               [(hid, int(s["id"]), s["data_inicio"], s.get("hora_inicio") or None, (s.get("__str__") or "sessão").strip(), s.get("tipo"), s.get("finalizada"), f"{base}/sessao/{s['id']}")
                for s in sess if s.get("data_inicio")], ["house_id", "sapl_id"])
        stats["sessoes"] = len(sess)
        sess_ids = {int(s["id"]) for s in sess}
        pres = []
        if sess_ids:
            for p in pages(base, "sessao/sessaoplenariapresenca", {"o": "-id"}, stop=_desc_until("sessao_plenaria", min(sess_ids))):
                if p.get("sessao_plenaria") in sess_ids and p.get("parlamentar"):
                    pres.append((hid, int(p["sessao_plenaria"]), int(p["parlamentar"])))
        upsert(conn, "sapl_presencas", ["house_id", "sessao_sapl_id", "parlamentar_sapl_id"], pres, ["house_id", "sessao_sapl_id", "parlamentar_sapl_id"], update=[])
        stats["presencas"] = len(pres)

        votos = []
        for v in pages(base, "sessao/votoparlamentar", {"o": "-id"},
                       stop=lambda res: bool(res) and all((x.get("data_hora") or "9999") < leg["data_inicio"] for x in res)):
            if (v.get("data_hora") or "") >= leg["data_inicio"] and v.get("parlamentar") and v.get("votacao"):
                votos.append((hid, int(v["id"]), int(v["votacao"]), int(v["parlamentar"]), (v.get("voto") or "?").strip(), v.get("data_hora"), (v.get("__str__") or "")[:2000] or None))
        upsert(conn, "sapl_votos", ["house_id", "sapl_id", "votacao_sapl_id", "parlamentar_sapl_id", "voto", "voted_at", "description"], votos, ["house_id", "sapl_id"])
        stats["votos"] = len(votos)

        stats.update(match_vereadores(conn, house, leg))
        conn.execute("update sapl_houses set loaded_at = now() where id = %s", (hid,))
        r.add(sum(stats.values()))
        if stats.get("ambiguo") or stats.get("sem_candidato"):
            r.reject(stats.get("ambiguo", 0) + stats.get("sem_candidato", 0), "vereadores sem casamento único com o TSE (ver sapl_parlamentares.match_note)")
    set_coverage(conn, house, stats)
    return stats


# ------------------------------------------------------------------ casamento com o TSE


def match_names(sapl: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[str, str | None, str]:
    """(status, person_id, nota). Candidatos = pessoas com mandato de vereador no município na legislatura."""
    np_, nc = fold(sapl.get("nome_parlamentar")), fold(sapl.get("nome_completo"))
    hits = {c["person_id"] for c in candidates
            if (np_ and fold(c.get("display_name")) == np_) or (nc and fold(c.get("civil_name")) == nc)}
    if len(hits) == 1:
        return "casado", next(iter(hits)), "nome de urna ou nome civil igual, mesmo município e legislatura"
    if len(hits) > 1:
        return "ambiguo", None, f"{len(hits)} pessoas do TSE com o mesmo nome no município e legislatura"
    return "sem_candidato", None, "nenhum vereador eleito do TSE com esse nome no município e legislatura (suplente? nome diferente?)"


def match_vereadores(conn: psycopg.Connection, house: dict[str, Any], leg: dict[str, Any]) -> dict[str, int]:
    hid = house["id"]
    cands = [dict(r) for r in conn.execute(
        """select distinct m.person_id::text as person_id, p.display_name, p.civil_name
           from mandates m join offices o on o.id = m.office_id and o.slug = 'vereador' join people p on p.id = m.person_id
           where m.place_id = %s and m.started_on < %s::date and m.ends_on > %s::date""",
        (house["place_id"], leg["data_fim"], leg["data_inicio"]))]
    in_leg = {r["parlamentar_sapl_id"] for r in conn.execute("select distinct parlamentar_sapl_id from sapl_mandatos where house_id = %s and legislature_number = %s",
                                                              (hid, leg.get("numero")))}
    count: dict[str, int] = {}
    for p in conn.execute("select sapl_id, nome_parlamentar, nome_completo from sapl_parlamentares where house_id = %s", (hid,)).fetchall():
        if p["sapl_id"] in in_leg:
            st, pid, note = match_names(p, cands)
        else:
            st, pid, note = "fora_da_legislatura", None, "sem mandato na legislatura atual no SAPL; não casado"
        conn.execute("update sapl_parlamentares set person_id = %s, match_status = %s, match_note = %s where house_id = %s and sapl_id = %s",
                     (pid, st, note, hid, p["sapl_id"]))
        count[st] = count.get(st, 0) + 1
        if st in ("ambiguo", "sem_candidato"):
            log.warning("SAPL %s: %s (%s) %s: %s", house["name"], p["nome_parlamentar"], p["sapl_id"], st, note)
    return count


# ------------------------------------------------------------------ cobertura


def set_coverage(conn: psycopg.Connection, house: dict[str, Any], stats: dict[str, int]) -> None:
    """data_coverage da cidade (D129): 'carregando' = lido pelo ETL e guardado, ainda sem tela. Sem linha na fonte não vira
    'nao_publica' (a câmara pode publicar fora do SAPL): fica 'desconhecido' com o motivo."""
    url = house["base_url"]
    today = date.today()
    sets = {
        "propostas": ("carregando", f"projetos da legislatura atual lidos do SAPL da Câmara Municipal ({stats.get('materias', 0)}); ainda sem tela", f"{url}/materia/pesquisar-materia"),
        "presenca": (("carregando", f"presença em sessão plenária lida do SAPL ({stats.get('presencas', 0)} registros); ainda sem tela") if stats.get("presencas")
                     else ("desconhecido", "o SAPL da Câmara Municipal não tem presença registrada nesta legislatura")) + (f"{url}/sessao/pesquisar-sessao",),
        "votos": (("carregando", f"votos nominais lidos do SAPL ({stats.get('votos', 0)}); ainda sem tela") if stats.get("votos")
                  else ("desconhecido", "o SAPL da Câmara Municipal não tem voto nominal registrado nesta legislatura")) + (f"{url}/sessao/pesquisar-sessao",),
    }
    upsert(conn, "data_coverage", ["place_id", "dataset", "status", "reason", "evidence_url", "checked_on"],
           [(house["place_id"], ds, st, reason, ev, today) for ds, (st, reason, ev) in sets.items()], ["place_id", "dataset"])
    conn.commit()


# ------------------------------------------------------------------ CLI


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl sapl.*")
    p.add_argument("job", choices=["sapl.descobrir", "sapl.carregar", "sapl.todas"])
    p.add_argument("--ibge", action="append", help="código IBGE do município (repetível); padrão: capitais")
    p.add_argument("--max", type=int, default=10, help="carregar no máximo N câmaras 'ok' (padrão 10)")
    a = p.parse_args(argv)
    codes = a.ibge or CAPITAIS
    conn = db.connect()
    failed = 0
    try:
        if a.job in ("sapl.descobrir", "sapl.todas"):
            discover(conn, codes)
        if a.job in ("sapl.carregar", "sapl.todas"):
            houses = conn.execute(
                """select h.*, pl.ibge_code, pl.name from sapl_houses h join places pl on pl.id = h.place_id
                   where h.status = 'ok' and pl.ibge_code = any(%s) order by pl.name""", (codes,)).fetchall()
            for h in houses[: a.max]:  # uma câmara por vez
                try:
                    s = load_house(conn, dict(h))
                    log.info("SAPL %s: %s", h["name"], s)
                except SkipUnchanged:
                    continue
                except Exception as e:  # noqa: BLE001 - uma câmara fora do ar não derruba as outras
                    failed += 1
                    conn.rollback()
                    log.error("SAPL %s falhou: %s", h["name"], e)
    finally:
        conn.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
