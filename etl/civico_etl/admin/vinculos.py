"""`civico-etl admin vinculos` (A3): de onde vem cada registro (URL, fonte, run) e quais registros dependem de cada URL ou fonte.

`adm_vinculos` guarda, por registro, as URLs/fontes de que ele depende, a origem de cada uma (registro_oficial, descoberta_automatica,
correcao_manual) e o histórico de trocas (`vigente = false` + `substitui_id` na linha nova). `sincronizar` materializa o que as tabelas
existentes JÁ contêm; nada é inventado e nenhuma URL é fabricada.

Origem de cada vínculo, com as colunas reais usadas (chave do registro: cabeçalho da migração 0150):
  vinculo_sapl     registro = sapl_houses.id.
                   registry_url  -> registro_oficial (a página do Interlegis, ou, nas Assembleias, a URL conferida à mão: `jobs/sapl.py` grava
                                    registry_url = base_url a partir do dicionário fixo ALE_SAPL).
                   base_url      -> descoberta_automatica se o lugar da casa é município (o job descobriu a URL a partir do registro);
                                    registro_oficial se é UF (Assembleia: a URL vem do ALE_SAPL, que está no código). A distinção usa
                                    places.kind do sapl_houses.place_id, a mesma regra de `sapl.house_ids`. Kind diferente de município/UF: base_url
                                    não vira vínculo (não se sabe a origem) e entra em `ignorados`.
                   fonte_slug    -> `sapl` (município) ou `sapl-ale` (UF).
  cobertura        registro = <places.ibge_code>:<data_coverage.dataset>; url = data_coverage.evidence_url (só quando não nula); origem
                   descoberta_automatica (o job gravou). fonte_slug só quando dá para saber com certeza: dataset em (propostas, presenca, votos),
                   o lugar tem casa em sapl_houses e a evidência começa com `{base_url}/` (a regra de `sapl.set_coverage`); senão fica nulo.
                   Lugar sem ibge_code não tem chave: entra em `ignorados`.
  contato_mandato  registro = mandates.id. `mandate_contacts` guarda `source_id`, não URL: o vínculo é com a FONTE (url = sources.url,
                   fonte_slug = sources.slug, origem registro_oficial). Fonte sem URL http(s) (a `curadoria`, cujo url é um caminho de arquivo,
                   e que marca contato corrigido à mão) não vira vínculo.
  identidade       registro = identity_match_queue.id; vínculo com a fonte do item (source_id -> sources.slug/url), registro_oficial. Mesma regra
                   da URL http(s).

Troca de URL: o vínculo que deixou de existir na origem fica `vigente = false` (nunca é apagado); o novo aponta para ele em `substitui_id`
(pareamento dentro do mesmo registro e da mesma origem, em ordem de URL; o que sobrar fica sem `substitui_id`). Origem `correcao_manual` nunca
é desativada pela sincronização, e a sincronização não cria um vínculo vigente igual (classe, registro, url) a um manual já vigente.

Ligação registro -> run. Nenhuma das quatro tabelas de classe tem `run_id`/`last_run_id`, então o run exato do registro NÃO é determinável hoje;
o que se determina, quando o catálogo permite, é o DATASET (e os últimos runs dele). O caso é dinâmico: se a tabela ganhar a coluna, o run exato sai.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from ..catalogo import COLETORES
from ..util import sha256_text
from .inventario import regex_dataset
from .saida import ErroAdmin

CLASSES = ("vinculo_sapl", "cobertura", "contato_mandato", "identidade")
ORIGENS = ("registro_oficial", "descoberta_automatica", "correcao_manual")
TABELA_DA_CLASSE = {"vinculo_sapl": "sapl_houses", "cobertura": "data_coverage", "contato_mandato": "mandate_contacts", "identidade": "identity_match_queue"}
DATASETS_SAPL_COBERTURA = ("propostas", "presenca", "votos")
RUNS_POR_DATASET = 5
FONTE_SEM_URL = "curadoria"

_Chave = tuple[str, str, str]  # (classe, registro_chave, url_sha)


@dataclass
class Resumo:
    criados: dict[str, int] = field(default_factory=lambda: dict.fromkeys(CLASSES, 0))
    desativados: dict[str, int] = field(default_factory=lambda: dict.fromkeys(CLASSES, 0))
    mantidos: dict[str, int] = field(default_factory=lambda: dict.fromkeys(CLASSES, 0))
    manuais_preservados: int = 0
    ignorados: list[dict[str, Any]] = field(default_factory=list)  # [{classe, motivo, n}]

    def mudou(self) -> bool:
        return any(self.criados.values()) or any(self.desativados.values())

    def para_dict(self) -> dict[str, Any]:
        return {"criados": self.criados, "desativados": self.desativados, "mantidos": self.mantidos,
                "manuais_preservados": self.manuais_preservados, "ignorados": self.ignorados, "mudou": self.mudou()}


# ------------------------------------------------------------------ sincronização


def _http(u: str | None) -> bool:
    return bool(u) and u.strip().lower().startswith(("http://", "https://"))


def _desejados(conn: Any, ign: dict[tuple[str, str], int]) -> dict[_Chave, dict[str, Any]]:
    """Os vínculos que as tabelas de origem sustentam agora. Chave (classe, registro, url_sha); em caso de URL repetida no mesmo registro vence a
    origem mais forte (registro_oficial)."""
    out: dict[_Chave, dict[str, Any]] = {}

    def add(classe: str, chave: str, url: str | None, origem: str, fonte: str | None) -> None:
        if not url or not url.strip():
            return
        k = (classe, chave, sha256_text(url))
        atual = out.get(k)
        if atual is None or (atual["origem"] != "registro_oficial" and origem == "registro_oficial"):
            out[k] = {"classe": classe, "chave": chave, "url": url, "origem": origem, "fonte": fonte}

    for h in conn.execute("select h.id, h.registry_url, h.base_url, p.kind from sapl_houses h join places p on p.id = h.place_id").fetchall():
        slug = {"uf": "sapl-ale", "municipio": "sapl"}.get(h["kind"])
        add("vinculo_sapl", str(h["id"]), h["registry_url"], "registro_oficial", slug)
        if slug is None:
            if h["base_url"]:
                ign[("vinculo_sapl", f"base_url de casa em lugar de kind {h['kind']!r}: origem desconhecida")] += 1
            continue
        add("vinculo_sapl", str(h["id"]), h["base_url"], "registro_oficial" if slug == "sapl-ale" else "descoberta_automatica", slug)

    cob = conn.execute(
        """select p.ibge_code, c.dataset, c.evidence_url, h.base_url, hp.kind as house_kind
           from data_coverage c join places p on p.id = c.place_id
           left join sapl_houses h on h.place_id = c.place_id left join places hp on hp.id = h.place_id
           where c.evidence_url is not null and btrim(c.evidence_url) <> ''"""
    ).fetchall()
    for c in cob:
        if not c["ibge_code"]:
            ign[("cobertura", "lugar sem ibge_code: não há chave estável <ibge>:<dataset>")] += 1
            continue
        fonte = None
        if c["dataset"] in DATASETS_SAPL_COBERTURA and c["base_url"] and c["evidence_url"].startswith(c["base_url"].rstrip("/") + "/"):
            fonte = {"uf": "sapl-ale", "municipio": "sapl"}.get(c["house_kind"])
        add("cobertura", f"{c['ibge_code']}:{c['dataset']}", c["evidence_url"], "descoberta_automatica", fonte)

    for classe, sql in (("contato_mandato", "select distinct mc.mandate_id::text as chave, s.slug, s.url from mandate_contacts mc join sources s on s.id = mc.source_id"),
                        ("identidade", "select q.id::text as chave, s.slug, s.url from identity_match_queue q join sources s on s.id = q.source_id")):
        for r in conn.execute(sql).fetchall():
            if not _http(r["url"]):
                ign[(classe, f"fonte {r['slug']!r} sem URL http(s) em sources.url" + (" (contato corrigido à mão)" if r["slug"] == FONTE_SEM_URL else ""))] += 1
                continue
            add(classe, r["chave"], r["url"], "registro_oficial", r["slug"])
    return out


def sincronizar(conn: Any) -> Resumo:
    """Materializa em adm_vinculos o que as tabelas existentes já contêm. Idempotente. NÃO comita (quem chama decide)."""
    conn.execute("select pg_advisory_xact_lock(hashtext('adm_vinculos:sincronizar'))")
    ign: dict[tuple[str, str], int] = defaultdict(int)
    desejados = _desejados(conn, ign)
    existentes = {(r["classe"], r["registro_chave"], r["url_sha"]): r
                  for r in conn.execute("select id, classe, registro_chave, url_sha, url, origem from adm_vinculos where vigente").fetchall()}
    res = Resumo(ignorados=[{"classe": c, "motivo": m, "n": n} for (c, m), n in sorted(ign.items())])

    sair = [r for k, r in existentes.items() if k not in desejados and r["origem"] != "correcao_manual"]
    res.manuais_preservados = sum(1 for k, r in existentes.items() if k not in desejados and r["origem"] == "correcao_manual")
    entrar = [d for k, d in desejados.items() if k not in existentes]
    for k, r in existentes.items():
        if k in desejados:
            res.mantidos[k[0]] += 1

    # pareamento da troca: mesmo (classe, registro), mesma origem, em ordem de URL
    velhos: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in sorted(sair, key=lambda r: r["url"]):
        velhos[(r["classe"], r["registro_chave"], r["origem"])].append(r)
    for d in sorted(entrar, key=lambda d: d["url"]):
        fila = velhos.get((d["classe"], d["chave"], d["origem"]))
        d["substitui_id"] = fila.pop(0)["id"] if fila else None

    if sair:
        conn.execute("update adm_vinculos set vigente = false where id = any(%s::uuid[]) and vigente", ([str(r["id"]) for r in sair],))
        for r in sair:
            res.desativados[r["classe"]] += 1
    if entrar:
        with conn.cursor() as cur:
            cur.executemany(
                "insert into adm_vinculos (classe, registro_chave, fonte_slug, url, url_sha, origem, substitui_id) values (%s, %s, %s, %s, %s, %s, %s)",
                [(d["classe"], d["chave"], d["fonte"], d["url"], sha256_text(d["url"]), d["origem"], d["substitui_id"]) for d in entrar],
            )
        for d in entrar:
            res.criados[d["classe"]] += 1
    return res


# ------------------------------------------------------------------ rótulos


def _uuid(s: str) -> str | None:
    try:
        return str(UUID(s))
    except (ValueError, AttributeError):
        return None


def _rotulos(conn: Any, classe: str, chaves: list[str]) -> dict[str, str]:
    """Rótulo legível por chave; chave inexistente (ou malformada) não aparece no resultado. Sem nome de pessoa nem partido."""
    out: dict[str, str] = {}
    if not chaves:
        return out
    if classe == "vinculo_sapl":
        ids = [int(c) for c in chaves if c.isdigit() and len(c) < 18]
        for r in conn.execute("select h.id, b.name as body, p.name, p.uf from sapl_houses h join places p on p.id = h.place_id left join legislative_bodies b on b.id = h.body_id where h.id = any(%s)", (ids,)).fetchall():
            out[str(r["id"])] = f"{r['body'] or 'casa sem órgão cadastrado'} · {r['name']}/{r['uf'] or '?'}"
    elif classe == "cobertura":
        for ch in chaves:
            ibge, _, ds = ch.partition(":")
            r = conn.execute("select p.name, p.uf from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = %s", (ibge, ds)).fetchone() if ds else None
            if r:
                out[ch] = f"cobertura {ds} · {r['name']}/{r['uf'] or '?'}"
    elif classe == "contato_mandato":
        ids = [u for u in (_uuid(c) for c in chaves) if u]
        for r in conn.execute(
            "select m.id, o.slug as cargo, b.name as body, p.name, p.uf from mandates m join offices o on o.id = m.office_id join places p on p.id = m.place_id left join legislative_bodies b on b.id = m.body_id where m.id = any(%s::uuid[])", (ids,)
        ).fetchall():
            out[str(r["id"])] = f"mandato {r['cargo']} · {r['body'] or 'casa não cadastrada'} · {r['name']}/{r['uf'] or '?'}"
    else:
        ids = [u for u in (_uuid(c) for c in chaves) if u]
        for r in conn.execute("select q.id, q.external_id, q.status, s.slug from identity_match_queue q join sources s on s.id = q.source_id where q.id = any(%s::uuid[])", (ids,)).fetchall():
            out[str(r["id"])] = f"fila de identidade · {r['slug']} · {r['external_id']} ({r['status']})"
    return out


# ------------------------------------------------------------------ consultas


def _enriquecer(conn: Any, linhas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    por_classe: dict[str, set[str]] = defaultdict(set)
    for l in linhas:
        por_classe[l["classe"]].add(l["registro_chave"])
    rot = {c: _rotulos(conn, c, sorted(ch)) for c, ch in por_classe.items()}
    shas = sorted({l["url_sha"] for l in linhas})
    evid = {r["url_sha"]: r for r in conn.execute("select url_sha, conteudo_sha256, lida_em, fonte_declarada_em from adm_evidencias where url_sha = any(%s)", (shas,)).fetchall()}
    tent = {r["url_sha"]: r for r in conn.execute(
        "select distinct on (url_sha) url_sha, tentada_em, resultado, motivo, http_status from adm_tentativas where url_sha = any(%s) order by url_sha, tentada_em desc", (shas,)).fetchall()}
    ids = [str(l["id"]) for l in linhas]
    subst = {str(r["substitui_id"]): r for r in conn.execute("select id, substitui_id, criada_em from adm_vinculos where substitui_id = any(%s::uuid[])", (ids,)).fetchall()}
    out = []
    for l in sorted(linhas, key=lambda l: (l["classe"], l["registro_chave"], not l["vigente"], l["criada_em"], str(l["id"]))):
        nulos: dict[str, str] = {}
        rotulo = rot.get(l["classe"], {}).get(l["registro_chave"])
        if rotulo is None:
            nulos["rotulo"] = "o registro não existe mais na tabela de origem"
        e, t, s = evid.get(l["url_sha"]), tent.get(l["url_sha"]), subst.get(str(l["id"]))
        if e is None:
            nulos["evidencia"] = "nenhuma leitura bem-sucedida desta URL em adm_evidencias"
        if t is None:
            nulos["ultima_tentativa"] = "nenhuma tentativa desta URL em adm_tentativas"
        if l["fonte_slug"] is None:
            nulos["fonte_slug"] = "não dá para saber com certeza qual fonte originou a URL"
        if not l["vigente"] and s is None:
            nulos["substituido_em"] = "vínculo desativado sem vínculo novo que o substitua (o registro deixou de usar a URL)"
        out.append({
            "id": str(l["id"]), "classe": l["classe"], "registro_chave": l["registro_chave"], "rotulo": rotulo, "url": l["url"], "url_sha": l["url_sha"],
            "fonte_slug": l["fonte_slug"], "origem": l["origem"], "vigente": l["vigente"], "desde": l["criada_em"],
            "substitui_id": str(l["substitui_id"]) if l["substitui_id"] else None,
            "substituido_por_id": str(s["id"]) if s else None, "substituido_em": s["criada_em"] if s else None,
            "evidencia": {"conteudo_sha256": e["conteudo_sha256"], "lida_em": e["lida_em"], "fonte_declarada_em": e["fonte_declarada_em"]} if e else None,
            "ultima_tentativa": {"tentada_em": t["tentada_em"], "resultado": t["resultado"], "motivo": t["motivo"], "http_status": t["http_status"]} if t else None,
            "desconhecidos": nulos,
        })
    return out


_SQL_V = "select id, classe, registro_chave, fonte_slug, url, url_sha, origem, vigente, substitui_id, criada_em from adm_vinculos"


def por_url(conn: Any, url: str) -> dict[str, Any]:
    """Registros que dependem desta URL (vigentes e históricos). Ordem: classe, registro_chave."""
    if not url or not url.strip():
        raise ErroAdmin("URL vazia")
    linhas = _enriquecer(conn, conn.execute(_SQL_V + " where url_sha = %s", (sha256_text(url),)).fetchall())
    return {"consulta": {"url": url, "url_sha": sha256_text(url)}, "vinculos": linhas}


def fontes_conhecidas(conn: Any) -> set[str]:
    return {r["slug"] for r in conn.execute("select slug from sources").fetchall()} | {f.slug for c in COLETORES for f in c.fontes}


def por_fonte(conn: Any, slug: str) -> dict[str, Any]:
    """Registros ligados a esta fonte (adm_vinculos.fonte_slug). Fonte que não existe em sources nem no catálogo é erro."""
    if slug not in fontes_conhecidas(conn):
        raise ErroAdmin(f"fonte desconhecida: {slug!r} (nem em sources nem no catálogo de coletores)")
    return {"consulta": {"fonte": slug}, "vinculos": _enriquecer(conn, conn.execute(_SQL_V + " where fonte_slug = %s", (slug,)).fetchall())}


def coluna_run(conn: Any, tabela: str) -> str | None:
    """Nome da coluna `run_id` ou `last_run_id` da tabela, se existir (também vale para tabela temporária)."""
    r = conn.execute(
        "select a.attname from pg_attribute a where a.attrelid = to_regclass(%s) and a.attname in ('run_id', 'last_run_id') and not a.attisdropped order by a.attname limit 1", (tabela,)
    ).fetchone()
    return r["attname"] if r else None


def _runs(conn: Any, slugs: list[str], dataset: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    carimbo = conn.execute(
        "select ds.refreshed_at, ds.last_run_id from dataset_stamps ds join sources s on s.id = ds.source_id where s.slug = any(%s) and ds.dataset = %s order by ds.refreshed_at desc limit 1",
        (slugs, dataset)).fetchone()
    runs = conn.execute(
        """select r.id, r.dataset, r.started_at, r.finished_at, r.status, r.rows_read, r.rows_upserted, r.rows_rejected, r.rows_deleted, r.invocation, s.slug
           from ingest_runs r join sources s on s.id = r.source_id where s.slug = any(%s) and r.dataset = %s order by r.started_at desc, r.id limit %s""",
        (slugs, dataset, RUNS_POR_DATASET)).fetchall()
    c = {"refreshed_at": carimbo["refreshed_at"], "last_run_id": str(carimbo["last_run_id"]) if carimbo["last_run_id"] else None} if carimbo else None
    return c, [{"id": str(r["id"]), "fonte": r["slug"], "iniciado_em": r["started_at"], "finalizado_em": r["finished_at"], "status": r["status"], "linhas_lidas": r["rows_read"],
                "linhas_gravadas": r["rows_upserted"], "linhas_rejeitadas": r["rows_rejected"], "linhas_apagadas": r["rows_deleted"], "invocation": r["invocation"]} for r in runs]


def _resolver(padrao: str, valores: dict[str, str | None]) -> str | None:
    """Troca `{ibge}`/`{uf}` pelo valor do registro; None se sobrar marcador sem valor."""
    out = padrao
    for k, v in valores.items():
        out = out.replace("{" + k + "}", v) if v else out
    return None if "{" in out else out


def _candidatos(tabela: str, slugs: list[str]) -> list[tuple[Any, str]]:
    """(coletor, padrão de dataset) do catálogo cujos coletores escrevem `tabela` e leem de alguma das fontes."""
    return [(c, p) for c in COLETORES if tabela in c.tabelas and any(f.slug in slugs for f in c.fontes) for p in c.datasets]


def _bloco_runs(conn: Any, tabela: str, slugs: list[str], datasets: list[tuple[str, str | None]], motivo_exato: str, *, coluna: str | None, run_exato: str | None) -> dict[str, Any]:
    """`datasets`: [(nome, observação)]. Monta o bloco `runs` quando o dataset é determinável."""
    itens = []
    for nome, obs in datasets:
        carimbo, runs = _runs(conn, slugs, nome)
        itens.append({"dataset": nome, "observacao": obs, "ultimo_carimbo_do_dataset": carimbo, "ultimos_runs": runs})
    return {"determinacao": "dataset", "datasets": itens, "run_exato": run_exato,
            "run_exato_motivo": None if run_exato else (motivo_exato if coluna is None else f"{tabela}.{coluna} existe mas está vazio para este registro")}


def _nao_determinavel(motivo: str, candidatos: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"determinacao": "nao_determinavel", "motivo": f"não determinável: {motivo}", "candidatos": candidatos or [], "datasets": [], "run_exato": None, "run_exato_motivo": f"não determinável: {motivo}"}


def _run_exato(conn: Any, tabela: str, where: str, params: tuple[Any, ...]) -> tuple[str | None, str | None]:
    col = coluna_run(conn, tabela)
    if col is None:
        return None, None
    r = conn.execute(f"select {col} as v from {tabela} where {where}", params).fetchone()  # noqa: S608 (tabela e coluna vêm de constantes/catálogo do próprio banco)
    return col, (str(r["v"]) if r and r["v"] else None)


def _runs_do_registro(conn: Any, classe: str, chave: str) -> dict[str, Any]:
    tabela = TABELA_DA_CLASSE[classe]
    sem_col = f"{tabela} não tem run_id nem last_run_id: só o dataset é determinável, não o run que gravou este registro"
    if classe == "vinculo_sapl":
        h = conn.execute("select h.id, p.kind, p.ibge_code, p.uf from sapl_houses h join places p on p.id = h.place_id where h.id = %s", (int(chave),)).fetchone()
        return _runs_da_casa(conn, h, tabela, sem_col, True)
    if classe == "cobertura":
        ibge, _, ds = chave.partition(":")
        c = conn.execute(
            """select c.dataset, c.evidence_url, h.id as house_id, hp.kind as house_kind, hp.ibge_code, hp.uf, h.base_url
               from data_coverage c join places p on p.id = c.place_id left join sapl_houses h on h.place_id = c.place_id left join places hp on hp.id = h.place_id
               where p.ibge_code = %s and c.dataset = %s""", (ibge, ds)).fetchone()
        if c["house_id"] and ds in DATASETS_SAPL_COBERTURA and c["evidence_url"] and c["base_url"] and c["evidence_url"].startswith(c["base_url"].rstrip("/") + "/"):
            h = {"id": c["house_id"], "kind": c["house_kind"], "ibge_code": c["ibge_code"], "uf": c["uf"]}
            col, exato = _run_exato(conn, tabela, "place_id = (select id from places where ibge_code = %s) and dataset = %s", (ibge, ds))
            b = _runs_da_casa(conn, h, tabela, sem_col, False)
            if col:
                b["run_exato"], b["run_exato_motivo"] = exato, None if exato else f"{tabela}.{col} existe mas está vazio"
            b["observacao"] = "a evidência desta linha é uma página do SAPL da casa do lugar (regra de sapl.set_coverage): os datasets são os da casa"
            return b
        quem = sorted({c2.id for c2, _ in _candidatos("data_coverage", ["sapl", "sapl-ale", "alesp", "alemg"])})
        return _nao_determinavel(f"a cobertura {ds!r} deste lugar é gravada por mais de um coletor ({', '.join(quem)}, e pelo derive.stats, fora do catálogo de coletores) e a linha não guarda qual",
                                 [{"coletor": x, "datasets": []} for x in quem])
    if classe == "contato_mandato":
        slugs = [r["slug"] for r in conn.execute("select distinct s.slug from mandate_contacts mc join sources s on s.id = mc.source_id where mc.mandate_id = %s order by 1", (chave,)).fetchall()]
        reais = [s for s in slugs if s != FONTE_SEM_URL]
        cands = _candidatos(tabela, reais)
        nomes = sorted({p for _, p in cands})
        if not reais or len({c.id for c, _ in cands}) != 1 or len(nomes) != 1 or "{" in nomes[0]:
            return _nao_determinavel("o mandato não tem contato de fonte coletada, ou o catálogo não aponta um único dataset que grave mandate_contacts"
                                     + (f" (fontes dos contatos: {', '.join(slugs)})" if slugs else ""), [{"coletor": c.id, "dataset": p} for c, p in cands])
        col, exato = _run_exato(conn, tabela, "mandate_id = %s", (chave,))
        return _bloco_runs(conn, tabela, reais, [(nomes[0], None)], sem_col, coluna=col, run_exato=exato)
    q = conn.execute("select s.slug from identity_match_queue q join sources s on s.id = q.source_id where q.id = %s", (chave,)).fetchone()
    cands = _candidatos(tabela, [q["slug"]])
    nomes = sorted({p for _, p in cands})
    cand_out = [{"coletor": c.id, "dataset": p} for c, p in cands]
    col, exato = _run_exato(conn, tabela, "id = %s", (chave,))
    if len({c.id for c, _ in cands}) == 1 and len(nomes) == 1 and "{" not in nomes[0]:
        return _bloco_runs(conn, tabela, [q["slug"]], [(nomes[0], None)], sem_col, coluna=col, run_exato=exato)
    b = _nao_determinavel(f"a fila de identidade não guarda o dataset nem o run; o catálogo lista {len(cands)} dataset(s) de {len({c.id for c, _ in cands})} coletor(es) da fonte {q['slug']!r} que a gravam", cand_out)
    if col:
        b["run_exato"], b["run_exato_motivo"] = exato, None if exato else f"{tabela}.{col} existe mas está vazio"
    return b


def _runs_da_casa(conn: Any, h: dict[str, Any], tabela: str, sem_col: str, run_exato_da_casa: bool) -> dict[str, Any]:
    slug = "sapl-ale" if h["kind"] == "uf" else "sapl" if h["kind"] == "municipio" else None
    if slug is None:
        return _nao_determinavel(f"o lugar da casa tem kind {h['kind']!r}, que o job SAPL não trata")
    valores = {"ibge": h["ibge_code"], "uf": (h["uf"] or "").lower() or None}
    col, exato = _run_exato(conn, "sapl_houses", "id = %s", (h["id"],)) if run_exato_da_casa else (None, None)
    dsets: list[tuple[str, str | None]] = []
    cands = _candidatos("sapl_houses", [slug])
    if len({c.id for c, _ in cands}) != 1:
        return _nao_determinavel(f"o catálogo não aponta um único coletor que grave sapl_houses para a fonte {slug!r}", [{"coletor": c.id, "dataset": p} for c, p in cands])
    for _, padrao in cands:
        nome = _resolver(padrao, valores)
        if nome is None:
            return _nao_determinavel(f"o dataset {padrao!r} depende de {{ibge}}/{{uf}} que o lugar da casa não tem")
        compartilhado = nome.endswith(".descoberta")
        if not re.match(regex_dataset(padrao), nome):  # defesa: o nome resolvido tem de casar com o padrão do catálogo
            return _nao_determinavel(f"o dataset resolvido {nome!r} não casa com o padrão {padrao!r}")
        dsets.append((nome, "dataset compartilhado por todas as casas: o run da descoberta não registra quais casas leu" if compartilhado else None))
    return _bloco_runs(conn, tabela, [slug], dsets, sem_col, coluna=col, run_exato=exato)


def _existe(conn: Any, classe: str, chave: str) -> str | None:
    return _rotulos(conn, classe, [chave]).get(chave)


def do_registro(conn: Any, classe: str, chave: str) -> dict[str, Any]:
    """De quais fontes e URLs o registro depende (vigentes e históricos, com origem e cadeia de trocas) e de quais runs ele veio."""
    if classe not in CLASSES:
        raise ErroAdmin(f"classe inválida: {classe!r} (esperado um de {', '.join(CLASSES)})")
    if not chave or not chave.strip():
        raise ErroAdmin("chave do registro vazia")
    rotulo = _existe(conn, classe, chave)
    if rotulo is None:
        raise ErroAdmin(f"registro inexistente: {classe}:{chave}")
    linhas = _enriquecer(conn, conn.execute(_SQL_V + " where classe = %s and registro_chave = %s", (classe, chave)).fetchall())
    por_id = {l["id"]: l for l in linhas}
    prox = {l["substitui_id"]: l["id"] for l in linhas if l["substitui_id"]}
    cadeias = []
    for l in sorted(linhas, key=lambda l: (l["desde"], l["id"])):
        if l["substitui_id"] in por_id:
            continue
        c, atual = [l["id"]], l["id"]
        while atual in prox and prox[atual] not in c:
            atual = prox[atual]
            c.append(atual)
        cadeias.append(c)
    return {"consulta": {"classe": classe, "registro_chave": chave}, "rotulo": rotulo, "vinculos": linhas, "cadeias_de_troca": cadeias,
            "fontes": sorted({l["fonte_slug"] for l in linhas if l["fonte_slug"]}), "runs": _runs_do_registro(conn, classe, chave)}


def contagem(conn: Any) -> tuple[int, int]:
    """(vínculos vigentes, vínculos no total) em adm_vinculos."""
    r = conn.execute("select count(*) filter (where vigente) as v, count(*) as t from adm_vinculos").fetchone()
    return r["v"], r["t"]
