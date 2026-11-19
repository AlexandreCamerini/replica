"""FABRICADO. Gera as respostas fabricadas do SAPL (cenários v1, v2 e falhas) e o LEIA-ME.md desta pasta.

Nada aqui foi lido de fonte alguma: nomes, números e textos são inventados e dizem que são. Os cinco hosts das Assembleias são as constantes
`ALE_SAPL` de civico_etl/jobs/sapl.py (o código os exige); o município e a segunda URL dele usam o TLD reservado `.invalid` (RFC 2606).

Uso (a partir de etl/):  uv run --frozen python tests/fixtures/sapl_ale/_gerar.py
Reescreve v1/, v2/, falhas/ e LEIA-ME.md. Os testes (test_admin_fixture_sapl.py) conferem os hosts contra `ALE_SAPL` e as URLs contra o job.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse

import httpx

AQUI = Path(__file__).resolve().parent
MARCA = "FABRICADO"
ALE = {
    "RO": "https://sapl.al.ro.leg.br",
    "AC": "https://sapl.al.ac.leg.br",
    "AM": "https://sapl.al.am.leg.br",
    "PI": "https://sapl.al.pi.leg.br",
    "PB": "https://sapl.al.pb.leg.br",
}
REGISTRO = "https://www12.senado.leg.br/interlegis/orgaosatendidos"
IBGE_MUN, NOME_MUN, UF_MUN = "1190099", "Município Fabricado (teste)", "RO"
HOST_MUN_V1 = "https://sapl.camara-fabricada.invalid"
HOST_MUN_V2 = "https://sapl.camara-fabricada-nova.invalid"
CABECALHO_ROBOTS = f"# {MARCA}: robots.txt de teste; nao veio do servidor real.\n"


def norm(u: str) -> str:
    return str(httpx.URL(u))


def api(base: str, path: str, params: dict | None = None, page: int = 1, page_size: int = 100) -> str:
    """A mesma montagem de `pages()` em jobs/sapl.py: parâmetros, page_size, page."""
    q = dict(params or {})
    q.setdefault("page_size", page_size)
    q["page"] = page
    return norm(f"{base}/api/{path}/?{urlencode(q)}")


def envelope(results: list, page: int = 1, total_pages: int = 1, total: int | None = None) -> dict:
    n = len(results) if total is None else total
    return {
        "_origem": MARCA,
        "pagination": {
            "links": {"previous": None, "next": None},
            "previous_page": page - 1 if page > 1 else None,
            "next_page": page + 1 if page < total_pages else None,
            "start_index": 1 if results else 0,
            "end_index": len(results),
            "total_entries": n,
            "total_pages": total_pages,
            "page": page,
        },
        "results": results,
    }


def dados(rot: str, rotulo_parl: str, *, v2: bool = False, sem_mat: tuple[int, ...] = ()) -> dict:
    L = rot
    leg = {"id": 7, "numero": 20, "data_inicio": "2023-02-01", "data_fim": "2030-12-31"}
    parl = [
        {"id": 101 + i, "nome_parlamentar": f"{rotulo_parl} Fabricado {i + 1} ({L})", "nome_completo": f"Nome Completo Fabricado {i + 1} ({L})",
         "sexo": "F" if i % 2 == 0 else "M", "ativo": True, "fotografia": None}
        for i in range(4)
    ]
    if v2:
        parl[1]["nome_parlamentar"] += " [alterado]"
        parl[1]["ativo"] = False
    mand = [{"id": 201 + i, "parlamentar": 101 + i, "data_inicio_mandato": "2023-02-01", "data_fim_mandato": "2027-01-31", "titular": True} for i in range(3)]
    tipos = [
        {"id": 1, "sigla": "PL", "descricao": "Projeto de Lei (fabricado)"},
        {"id": 2, "sigla": "PR", "descricao": "Projeto de Resolução (fabricado)"},
        {"id": 3, "sigla": "REQ", "descricao": "Requerimento (fabricado)"},
    ]

    def mat(i: int, tipo: int, numero: int, ano: int, dia: str) -> dict:
        return {"id": i, "tipo": tipo, "numero": numero, "ano": ano, "data_apresentacao": f"{ano}-{dia}", "ementa": f"Matéria fabricada {numero}/{ano} ({L})",
                "em_tramitacao": True, "texto_original": None, "data_ultima_atualizacao": f"{ano}-{dia}T09:00:00-04:00"}

    mats = [mat(301, 1, 12, 2025, "03-10"), mat(302, 1, 13, 2025, "03-11"), mat(303, 2, 1, 2025, "04-02"), mat(304, 1, 2, 2026, "02-20"), mat(305, 3, 7, 2026, "02-21")]
    if v2:
        mats.append(mat(306, 1, 3, 2026, "03-05"))
    mats = [m for m in mats if m["id"] not in sem_mat]
    aut = [{"id": 401 + k, "materia": m["id"], "autor": 501 + (k % 2), "primeiro_autor": True} for k, m in enumerate(x for x in mats if x["tipo"] in (1, 2) and x["id"] != 306)]
    aut.append({"id": 410, "materia": 301, "autor": 503, "primeiro_autor": False})
    if v2:
        aut.append({"id": 411, "materia": 306, "autor": 501, "primeiro_autor": True})
    aut = [a for a in aut if a["materia"] not in sem_mat]
    autores = [
        {"id": 501, "nome": f"{rotulo_parl} Fabricado 1 ({L})", "content_type": 11, "object_id": 101},
        {"id": 502, "nome": f"{rotulo_parl} Fabricado 2 ({L})", "content_type": 11, "object_id": 102},
        {"id": 503, "nome": "Mesa Diretora (fabricada)", "content_type": 12, "object_id": 1},
    ]
    sess = [{"id": 601 + i, "data_inicio": d, "hora_inicio": "10:00", "__str__": f"{i + 1}ª Sessão Ordinária (fabricada) ({L})", "tipo": 1, "finalizada": True}
            for i, d in enumerate(("2025-03-04", "2025-03-11"))]
    pres = [{"id": 701 + k, "sessao_plenaria": s, "parlamentar": p} for k, (s, p) in enumerate([(601, 101), (601, 102), (601, 103), (602, 101), (602, 102)])]
    votos = [{"id": 801 + k, "votacao": vt, "parlamentar": p, "voto": v, "data_hora": f"2025-03-{4 if vt == 901 else 11:02d}T11:00:00-04:00", "__str__": f"Voto fabricado {801 + k} ({L})"}
             for k, (vt, p, v) in enumerate([(901, 101, "Sim"), (901, 102, "Não"), (901, 103, "Abstenção"), (902, 101, "Sim"), (902, 102, "Sim")])]
    return dict(leg=leg, parl=parl, mand=mand, tipos=tipos, mats=mats, aut=aut, autores=autores, sess=sess, pres=pres, votos=votos)


def robots(bloqueia_api: bool) -> str:
    return CABECALHO_ROBOTS + "User-agent: *\n" + ("Disallow: /api/\n" if bloqueia_api else "Disallow: /admin/\n")


def indice(base: str) -> dict:
    nomes = ["parlamentares/legislatura", "parlamentares/parlamentar", "parlamentares/mandato", "materia/tipomaterialegislativa", "materia/materialegislativa",
             "materia/autoria", "base/autor", "contenttypes/contenttype", "sessao/sessaoplenaria", "sessao/sessaoplenariapresenca", "sessao/votoparlamentar"]
    return {"_origem": MARCA, **{n: f"{base}/api/{n}/" for n in nomes}}


def desc(rs: list) -> list:
    return sorted(rs, key=lambda x: -x["id"])


def casa(base: str, d: dict, *, robots_bloqueia: bool = False, api_status: int = 200, so_robots: bool = False) -> dict[str, dict]:
    """url -> especificação da resposta, na ordem em que o job as pede. Corpo `bytes` ou `{"fixo": nome}`/`{"excecao": nome}`."""
    S: dict[str, dict] = {}

    def js(url: str, obj) -> None:
        S[url] = {"corpo": (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode(), "tipo": "application/json", "status": 200}

    S[norm(f"{base}/robots.txt")] = {"corpo": robots(robots_bloqueia).encode(), "tipo": "text/plain", "status": 200}
    if so_robots:
        return S
    if api_status == 500:
        S[norm(f"{base}/api/")] = {"fixo": "erro_500.json", "status": 500}
        return S
    js(norm(f"{base}/api/"), indice(base))
    if d is None:
        return S
    lid = d["leg"]["id"]
    js(api(base, "parlamentares/legislatura"), envelope([d["leg"]]))
    js(api(base, "parlamentares/parlamentar", page=1), envelope(d["parl"][:2], 1, 2, len(d["parl"])))  # duas páginas
    js(api(base, "parlamentares/parlamentar", page=2), envelope(d["parl"][2:], 2, 2, len(d["parl"])))
    js(api(base, "parlamentares/mandato", {"legislatura": lid}), envelope(d["mand"]))
    js(api(base, "materia/tipomaterialegislativa"), envelope(d["tipos"]))
    js(api(base, "materia/materialegislativa", {"o": "-id"}, page_size=1), envelope(desc(d["mats"])[:1], 1, 2, len(d["mats"])))
    js(api(base, "materia/materialegislativa", {"o": "-id"}), envelope(desc(d["mats"])))
    for tid in (1, 2):
        for ano in (2023, 2024, 2025, 2026):
            rs = [m for m in d["mats"] if m["tipo"] == tid and m["ano"] == ano]
            if rs:
                js(api(base, "materia/materialegislativa", {"tipo": tid, "ano": ano}), envelope(rs))
    js(api(base, "materia/autoria", {"o": "-id"}, page_size=1), envelope(desc(d["aut"])[:1], 1, 2, len(d["aut"])))
    js(api(base, "materia/autoria", {"o": "-id"}), envelope(desc(d["aut"])))
    js(api(base, "base/autor"), envelope(d["autores"]))
    js(api(base, "contenttypes/contenttype", {"model": "parlamentar"}), envelope([{"id": 11, "app_label": "parlamentares", "model": "parlamentar"}]))
    js(api(base, "sessao/sessaoplenaria", {"legislatura": lid}), envelope(d["sess"]))
    for path, chave in (("sessao/sessaoplenariapresenca", "pres"), ("sessao/votoparlamentar", "votos")):
        js(api(base, path, {"o": "-id"}, page_size=1), envelope(desc(d[chave])[:1], 1, 2, len(d[chave])))
        js(api(base, path, {"o": "-id"}), envelope(desc(d[chave])))
    return S


def curingas(base: str) -> list[dict]:
    h = re.escape(base)
    return [
        {"regex": rf"^{h}/api/materia/materialegislativa/\?tipo=\d+&ano=\d+&page_size=100&page=1$", "fixo": "pagina_vazia.json", "status": 200,
         "motivo": "tipo/ano sem matéria: a carga completa pede um ano a mais a cada janeiro (y0..ano corrente)"},
        {"regex": rf"^{h}/api/materia/materialegislativa/\?data_ultima_atualizacao__gte=\d{{4}}-\d{{2}}-\d{{2}}&o=-data_ultima_atualizacao&page_size=100&page=1$",
         "fixo": "pagina_vazia.json", "status": 200, "motivo": "edições desde a última leitura: a data do pedido é a de hoje menos 2 dias"},
    ]


FIXOS = {
    "pagina_vazia.json": (json.dumps(envelope([]), indent=1) + "\n").encode(),
    "erro_500.json": (json.dumps({"_origem": MARCA, "detail": "erro fabricado (500)"}) + "\n").encode(),
    "erro_403.json": (json.dumps({"_origem": MARCA, "detail": "proibido, fabricado (403)"}) + "\n").encode(),
    "corpo_vazio.txt": b"",
}


def registro_url() -> str:
    return norm(f"{REGISTRO}?{urlencode({'uf': UF_MUN, 'municipio': NOME_MUN}, quote_via=quote)}")


def registro_html(href: str) -> bytes:
    return (f"<!-- {MARCA}: pagina de teste; nao e do Interlegis -->\n"
            '<div class="orgao-atendido">\n'
            f'<div style="font-weight:bold;margin-bottom:3px;">Câmara Municipal de {NOME_MUN}</div>\n'
            f'<table><tr><td>SAPL</td><td>01/01/2020</td><td><a href="{href}">{href}</a></td><td>-</td><td>Funcionando</td><td>-</td></tr></table>\n</div>\n').encode()


def nome_arquivo(url: str) -> tuple[str, str]:
    p = urlparse(url)
    ext = ".json" if "/api/" in p.path else ("" if p.path.endswith("robots.txt") else ".html")
    base = (p.path.strip("/") or "raiz") + ("--" + p.query if p.query else "")
    base = re.sub(r"[^A-Za-z0-9._=-]+", "_", base.replace("/", "__"))
    if len(base) > 110:
        base = base[:100] + "_" + hashlib.sha1(url.encode()).hexdigest()[:8]
    return p.netloc, base + ext


def build() -> dict[str, dict]:
    ro, ac, am, pi, pb = (ALE[u] for u in ("RO", "AC", "AM", "PI", "PB"))
    d_ro, d_ac, d_am, d_pb, d_mun = dados("RO", "Parlamentar"), dados("AC", "Parlamentar", sem_mat=(304,)), dados("AM", "Parlamentar"), dados("PB", "Parlamentar"), dados("MUN", "Vereador")

    v1: dict[str, dict] = {}
    for base, d in ((ro, d_ro), (ac, d_ac), (am, d_am)):
        v1.update(casa(base, d))
    v1.update(casa(pi, None, robots_bloqueia=True, so_robots=True))
    v1.update(casa(pb, None, api_status=500))
    v1[registro_url()] = {"corpo": registro_html(HOST_MUN_V1 + "/"), "tipo": "text/html", "status": 200}
    v1.update(casa(HOST_MUN_V1, d_mun))

    v2: dict[str, dict] = {}
    v2.update(casa(ro, dados("RO", "Parlamentar", v2=True)))
    v2.update(casa(ac, d_ac))
    v2.update(casa(am, None, robots_bloqueia=True, so_robots=True))
    v2.update(casa(pi, None, robots_bloqueia=True, so_robots=True))
    v2.update(casa(pb, d_pb))
    v2[registro_url()] = {"corpo": registro_html(HOST_MUN_V2.replace("https://", "http://") + "/"), "tipo": "text/html", "status": 200}
    v2.update(casa(HOST_MUN_V1, d_mun))
    v2.update(casa(HOST_MUN_V2, d_mun))

    f: dict[str, dict] = {}
    f.update(casa(ro, None, api_status=403))
    f[norm(f"{ro}/api/")] = {"fixo": "erro_403.json", "status": 403}
    f.update(casa(ac, None))
    f[norm(f"{ac}/api/")] = {"excecao": "ReadTimeout", "status": None}
    f.update(casa(am, None))
    f[norm(f"{am}/api/")] = {"fixo": "corpo_vazio.txt", "status": 200, "tipo": "text/plain"}
    f.update(casa(pi, d_pb))  # PI: /api/ responde; a carga falha na primeira leitura (legislatura 500)
    f[api(pi, "parlamentares/legislatura")] = {"fixo": "erro_500.json", "status": 500}
    for u in [u for u in f if u.startswith(pi) and "/api/" in u and u not in (norm(f"{pi}/api/"), api(pi, "parlamentares/legislatura"))]:
        del f[u]
    f.update(casa(pb, d_pb))
    return {"v1": v1, "v2": v2, "falhas": f}


def escreve(cenarios: dict[str, dict[str, dict]]) -> dict[str, dict]:
    for c in cenarios:
        if (AQUI / c).exists():
            shutil.rmtree(AQUI / c)
    for nome, corpo in FIXOS.items():
        (AQUI / "v1" / "_comum").mkdir(parents=True, exist_ok=True)
        (AQUI / "v1" / "_comum" / nome).write_bytes(corpo)
    escritos: dict[str, dict[str, str]] = {}  # cenário -> url -> caminho relativo ao diretório do cenário (mesmo conteúdo)
    mapas: dict[str, dict] = {}
    anteriores: list[str] = []
    for c, spec in cenarios.items():
        resp: dict[str, dict] = {}
        escritos[c] = {}
        for url, e in spec.items():
            ent: dict = {}
            if "excecao" in e:
                ent["excecao"] = e["excecao"]
            else:
                ent["status"] = e["status"]
                if "fixo" in e:
                    ent["arquivo"] = ("" if c == "v1" else "../v1/") + "_comum/" + e["fixo"]
                    ent["tipo"] = e.get("tipo", "application/json")
                    corpo = FIXOS[e["fixo"]]
                else:
                    corpo = e["corpo"]
                    ent["tipo"] = e["tipo"]
                    host, arq = nome_arquivo(url)
                    rel = None
                    for ant in anteriores:  # mesmo URL e mesmos bytes numa rodada anterior: aponta para lá
                        pr = escritos[ant].get(url)
                        if pr and (AQUI / ant / pr).read_bytes() == corpo:
                            rel = f"../{ant}/{pr}"
                            break
                    if rel is None:
                        rel = f"{host}/{arq}"
                        (AQUI / c / host).mkdir(parents=True, exist_ok=True)
                        (AQUI / c / rel).write_bytes(corpo)
                        escritos[c][url] = rel
                    else:
                        escritos[c][url] = rel
                    ent["arquivo"] = rel
                if ent["status"] == 200 and corpo:
                    ent["etag"] = '"' + hashlib.sha256(corpo).hexdigest()[:16] + '"'
            resp[url] = ent
        cur = []
        hosts = sorted({urlparse(u).scheme + "://" + urlparse(u).netloc for u in spec if "/api/" in u})
        for h in hosts:
            cur += [{k: v for k, v in x.items()} for x in curingas(h)]
        for x in cur:
            x["arquivo"] = ("" if c == "v1" else "../v1/") + "_comum/" + x.pop("fixo")
            x["tipo"] = "application/json"
        mapas[c] = {"_origem": MARCA, "cenario": c, "respostas": resp, "curingas": cur}
        lin = lambda o: json.dumps(o, ensure_ascii=False, separators=(", ", ": "))  # noqa: E731 - uma linha por entrada
        txt = ('{\n "_origem": "%s",\n "cenario": "%s",\n "respostas": {\n' % (MARCA, c)
               + ",\n".join(f"  {lin(u)}: {lin(e)}" for u, e in resp.items())
               + '\n },\n "curingas": [\n' + ",\n".join(f"  {lin(x)}" for x in cur) + "\n ]\n}\n")
        assert json.loads(txt) == mapas[c]
        (AQUI / c / "mapa.json").write_text(txt, encoding="utf-8")
        anteriores.append(c)
    return mapas


DESCRICAO = {
    "v1": "Estado inicial. RO, AC e AM: robots permissivo e API respondendo (carga completa possível). PI: robots.txt bloqueia /api/ (status robots_bloqueia). "
          "PB: robots permissivo e /api/ responde 500 (status fora_do_ar). Município fabricado: registro lista o SAPL em HOST_MUN_V1, robots e API ok.",
    "v2": "O mesmo tempo depois. PB volta (ok). AM passa a ter robots que bloqueia /api/ (robots_bloqueia). RO: matéria 306 (3/2026) com autoria 411 nova e o parlamentar 102 "
          "com nome e `ativo` alterados. Município: o registro aponta para HOST_MUN_V2 (base_url muda; as respostas dos dois hosts existem). Só o que mudou tem ETag nova.",
    "falhas": "Erros: RO /api/ 403; AC /api/ ReadTimeout; AM /api/ 200 com corpo vazio; PI /api/ ok mas a primeira leitura da carga (legislatura) dá 500; PB ok (igual ao v2).",
}


def leia_me(mapas: dict[str, dict]) -> str:
    out = [f"# Respostas FABRICADAS do SAPL ({MARCA})\n",
           f"Tudo nesta pasta é {MARCA}: nada foi lido do SAPL de nenhuma casa. Nomes (\"Parlamentar Fabricado 1 (RO)\"), números e textos são inventados. Os cinco hosts das "
           "Assembleias são as constantes `ALE_SAPL` do código (RO, AC, AM, PI, PB); o município é o IBGE `1190099`, \"Município Fabricado (teste)\" (UF RO), com hosts `.invalid` "
           "(TLD reservado, não resolve). Nunca apresente isto como dado lido da fonte; todo relatório que usar esta pasta marca SIMULADO.\n",
           "## Quem lê\n",
           "`civico_etl/jobs/sapl.py` (comandos `sapl.ales`, `sapl.descobrir --ibge`, `sapl.carregar --ibge`), pelo transporte `httpx.MockTransport` de "
           "`etl/tests/admin_fixtures.py` (`transporte`, `instalar`) ou pelo lançador `etl/tests/simulado.py`. Nada sai para a rede.\n",
           "## Formato\n",
           "`<cenário>/mapa.json` liga cada URL exata (com query string, na ordem em que o job a monta) a `{arquivo, status, tipo, etag}` ou `{excecao}`. `arquivo` é relativo ao "
           "diretório do cenário; o que não mudou aponta para `../v1/...` (mesmo arquivo, mesma ETag, para exercitar 304). `curingas` (regex) cobrem duas famílias de URL que "
           "dependem da data de hoje (`?tipo=T&ano=Y` de cada ano até o corrente; `data_ultima_atualizacao__gte=<hoje-2>`) e devolvem página vazia. "
           "A legislatura fabricada vai de 2023-02-01 a 2030-12-31, para conter \"hoje\". Gerado por `_gerar.py` (nesta pasta); regere em vez de editar à mão.\n",
           "## Cenários\n"]
    for c, m in mapas.items():
        out.append(f"- `{c}`: {DESCRICAO[c]}")
    out.append("")
    for c, m in mapas.items():
        out.append(f"## URLs do cenário `{c}` ({len(m['respostas'])} exatas + {len(m['curingas'])} curingas)\n")
        por_host: dict[str, list[str]] = {}
        for u, e in m["respostas"].items():
            p = urlparse(u)
            marca = "" if e.get("excecao") else f" -> {e['status']}"
            if e.get("excecao"):
                marca = f" -> {e['excecao']}"
            por_host.setdefault(p.scheme + "://" + p.netloc, []).append(f"{p.path}{'?' + p.query if p.query else ''}{marca}" + ("" if not str(e.get('arquivo', '')).startswith('../') else " (= " + e['arquivo'].split('/')[1] + ")"))
        for h, us in por_host.items():
            out.append(f"### {h}\n")
            out += [f"- `{x}`" for x in us]
            out.append("")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    mapas = escreve(build())
    (AQUI / "LEIA-ME.md").write_text(leia_me(mapas), encoding="utf-8")
    print({c: len(m["respostas"]) for c, m in mapas.items()})
