"""etl.parlamento.extras: contato, comissões e discursos de deputados e senadores em exercício.

Fontes:
  Câmara  /deputados/{id} (gabinete, site, redes), /deputados/{id}/orgaos, /deputados/{id}/discursos
  Senado  /senador/lista/atual (e-mail, telefones), /senador/{cod}/comissoes, /senador/{cod}/discursos
Contato é por mandato em exercício (substitui o anterior da mesma fonte). Comissões guardam o histórico com datas.
Discursos: só o resumo oficial e o link; sem texto integral.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime

import psycopg

from ..db import run, upsert
from ..http import fetch_json, paginate_camara
from ..util import midnight_br, nz, parse_date, parse_ts_br

log = logging.getLogger("etl.extras")
CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
SENADO = "https://legis.senado.leg.br/dadosabertos"
DAY = 86400
TAGS = re.compile(r"<[^>]+>|&nbsp;")


def _list(x):
    return [] if x is None else x if isinstance(x, list) else [x]


def _clean(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"\s+", " ", TAGS.sub(" ", s)).strip()
    return s[:2000] or None


def run_extras(conn: psycopg.Connection, *, since: date, force: bool = False) -> None:
    src = {r["slug"]: str(r["id"]) for r in conn.execute("select slug, id from sources")}
    bodies = {r["kind"]: str(r["id"]) for r in conn.execute("select kind, id from legislative_bodies where kind in ('camara_deputados','senado')")}
    # mandatos em exercício com o id externo da casa
    rows = conn.execute(
        """select m.id as mandate_id, m.person_id, b.kind, e.external_id
           from mandates m join legislative_bodies b on b.id = m.body_id
           join person_external_ids e on e.person_id = m.person_id and e.source_id = (select id from sources where slug = case b.kind when 'senado' then 'senado' else 'camara' end)
           where m.status = 'em_exercicio' and b.kind in ('camara_deputados','senado')"""
    ).fetchall()
    log.info("extras: %d parlamentares em exercício", len(rows))
    with run(conn, "parlamento.extras", "camara", force=force) as r:
        contacts, comm_rows, memberships, speeches = [], {}, [], []
        senado_list = {}
        if any(x["kind"] == "senado" for x in rows):
            for p in _list(fetch_json(f"{SENADO}/senador/lista/atual.json", max_age=DAY)["ListaParlamentarEmExercicio"]["Parlamentares"]["Parlamentar"]):
                senado_list[str(p["IdentificacaoParlamentar"]["CodigoParlamentar"])] = p["IdentificacaoParlamentar"]
        for i, x in enumerate(rows):
            ext, pid, mid = x["external_id"], str(x["person_id"]), str(x["mandate_id"])
            try:
                if x["kind"] == "camara_deputados":
                    body = bodies["camara_deputados"]
                    d = fetch_json(f"{CAMARA}/deputados/{ext}", max_age=DAY)["dados"]
                    g = (d.get("ultimoStatus") or {}).get("gabinete") or {}
                    if g.get("email"):
                        contacts.append((mid, "email", g["email"].lower(), src["camara"]))
                    if g.get("telefone"):
                        contacts.append((mid, "telefone", f"(61) {g['telefone']}", src["camara"]))
                    if g.get("sala"):
                        parts = ["Câmara dos Deputados", f"anexo {g['predio']}" if g.get("predio") else None, f"{g['andar']}º andar" if g.get("andar") else None, f"gabinete {g['sala']}"]
                        contacts.append((mid, "gabinete", ", ".join(p for p in parts if p), src["camara"]))
                    if d.get("urlWebsite"):
                        contacts.append((mid, "site", d["urlWebsite"], src["camara"]))
                    for u in d.get("redeSocial") or []:
                        kind = next((k for k, pat in (("instagram", "instagram"), ("facebook", "facebook"), ("x", "twitter.com|x.com"), ("youtube", "youtube"), ("tiktok", "tiktok")) if re.search(pat, u)), "outra_rede")
                        contacts.append((mid, kind, u, src["camara"]))
                    for o in paginate_camara(f"{CAMARA}/deputados/{ext}/orgaos?dataInicio={since.isoformat()}&itens=100", max_age=DAY):
                        key = str(o["idOrgao"])
                        comm_rows[(body, key)] = (body, o.get("siglaOrgao"), o.get("nomePublicacao") or o.get("nomeOrgao") or key, key)
                        start = parse_date(o.get("dataInicio")) or since
                        memberships.append(((body, key), pid, o.get("titulo") or "Membro", start, parse_date(o.get("dataFim"))))
                    url = f"{CAMARA}/deputados/{ext}/discursos?dataInicio={since.isoformat()}&dataFim={date.today().isoformat()}&itens=100&ordenarPor=dataHoraInicio&ordem=DESC"
                    for s in paginate_camara(url, max_age=DAY):
                        ts = parse_ts_br(s.get("dataHoraInicio"))
                        if not ts:
                            continue
                        summary = _clean(s.get("sumario")) or _clean(s.get("transcricao", "")[:400] if s.get("transcricao") else None)
                        key = f"{ext}:{s['dataHoraInicio']}:{(s.get('tipoDiscurso') or '')[:20]}"
                        speeches.append((pid, body, ts, f"{s.get('tipoDiscurso') or 'Discurso'}: {summary}" if summary else s.get("tipoDiscurso"), s.get("urlTexto") or s.get("urlVideo"), key))
                else:
                    body = bodies["senado"]
                    ident = senado_list.get(ext) or {}
                    if ident.get("EmailParlamentar"):
                        contacts.append((mid, "email", ident["EmailParlamentar"].lower(), src["senado"]))
                    for t in _list((ident.get("Telefones") or {}).get("Telefone")):
                        if t.get("NumeroTelefone") and t.get("IndicadorFax") != "Sim":
                            contacts.append((mid, "telefone", f"(61) {t['NumeroTelefone']}", src["senado"]))
                    if ident.get("UrlPaginaParlamentar"):
                        contacts.append((mid, "site", ident["UrlPaginaParlamentar"], src["senado"]))
                    c = fetch_json(f"{SENADO}/senador/{ext}/comissoes.json", max_age=DAY)
                    for o in _list(((c.get("MembroComissaoParlamentar") or {}).get("Parlamentar") or {}).get("MembroComissoes", {}).get("Comissao")):
                        ic = o.get("IdentificacaoComissao") or {}
                        start = parse_date(o.get("DataInicio"))
                        if not ic.get("CodigoComissao") or not start or start < since.replace(year=since.year - 4):
                            continue
                        key = str(ic["CodigoComissao"])
                        comm_rows[(body, key)] = (body, ic.get("SiglaComissao"), ic.get("NomeComissao") or key, key)
                        memberships.append(((body, key), pid, o.get("DescricaoParticipacao") or "Membro", start, parse_date(o.get("DataFim"))))
                    ds = fetch_json(f"{SENADO}/senador/{ext}/discursos.json?dataInicio={since:%Y%m%d}&dataFim={date.today():%Y%m%d}", max_age=DAY)
                    for s in _list(((ds.get("DiscursosParlamentar") or {}).get("Parlamentar") or {}).get("Pronunciamentos", {}).get("Pronunciamento")):
                        day = parse_date(s.get("DataPronunciamento"))
                        if not day:
                            continue
                        kind = ((s.get("TipoUsoPalavra") or {}).get("Descricao")) or "Pronunciamento"
                        summary = _clean(s.get("TextoResumo"))
                        speeches.append((pid, body, midnight_br(day), f"{kind}: {summary}" if summary else kind,
                                         s.get("UrlTexto") or f"https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/pronunciamento/{s.get('CodigoPronunciamento')}", f"sf:{s.get('CodigoPronunciamento')}"))
            except FileNotFoundError:
                r.reject(1, f"{x['kind']} {ext}: fonte sem registro")
            if (i + 1) % 100 == 0:
                log.info("extras: %d/%d", i + 1, len(rows))

        # contato: o que a fonte publica hoje substitui o anterior (mesma fonte)
        mids = list({c[0] for c in contacts})
        if mids:
            conn.execute("delete from mandate_contacts where mandate_id = any(%s::uuid[]) and source_id in (select id from sources where slug in ('camara','senado'))", (mids,))
        r.add(len(upsert(conn, "mandate_contacts", ["mandate_id", "kind", "value", "source_id"], contacts, ["mandate_id", "kind", "value"], update=[], returning=["id"])))
        cid = {}
        for row in upsert(conn, "committees", ["body_id", "acronym", "name", "source_key"], list(comm_rows.values()), ["body_id", "source_key"], update=["acronym", "name"], returning=["id", "body_id", "source_key"]):
            cid[(str(row["body_id"]), row["source_key"])] = str(row["id"])
        mrows = [(cid[k], pid, role[:80], start, end) for k, pid, role, start, end in memberships if k in cid]
        r.add(len(upsert(conn, "committee_memberships", ["committee_id", "person_id", "role", "from_on", "to_on"], mrows, ["committee_id", "person_id", "role", "from_on"], update=["to_on"], returning=["id"])))
        r.add(len(upsert(conn, "speeches", ["person_id", "body_id", "occurred_at", "summary", "url", "source_key"], speeches, ["body_id", "source_key"], update=["summary", "url"], returning=["id"])))
        log.info("extras: %d contatos, %d comissões, %d participações, %d discursos", len(contacts), len(comm_rows), len(mrows), len(speeches))
