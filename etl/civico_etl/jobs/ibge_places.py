"""etl.ibge.places: país, regiões, UFs e municípios da API de Localidades do IBGE. Também cria as casas legislativas.

Fonte: https://servicodados.ibge.gov.br/api/v1/localidades (CC BY 4.0). ~5.571 linhas (inclui Fernando de Noronha).
"""

from __future__ import annotations

import logging

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch
from ..util import slugify

log = logging.getLogger("etl.ibge")
API = "https://servicodados.ibge.gov.br/api/v1/localidades"


def run_places(conn: psycopg.Connection, *, force: bool = False) -> None:
    estados = fetch(f"{API}/estados?orderBy=nome")
    municipios = fetch(f"{API}/municipios?view=nivelado&orderBy=nome")
    checksum = estados.checksum + municipios.checksum
    try:
        with run(conn, "ibge.places", "ibge", input_checksum=checksum, force=force) as r:
            ufs = estados.json()
            munis = municipios.json()
            rows = [("BR", "pais", "Brasil", "brasil", None, None)]
            regions = {}
            for u in ufs:
                reg = u["regiao"]
                regions[str(reg["id"])] = reg["nome"]
            for rid, rname in sorted(regions.items()):
                rows.append((rid, "regiao", rname, slugify(rname), None, rid))
            for u in ufs:
                rows.append((str(u["id"]), "uf", u["nome"], slugify(u["nome"]), u["sigla"], str(u["regiao"]["id"])))
            for m in munis:
                uf = m["UF-sigla"]
                rows.append((str(m["municipio-id"]), "municipio", m["municipio-nome"], f"{slugify(m['municipio-nome'])}-{uf.lower()}", uf, str(m["UF-id"])))
            # slug de município pode colidir (homônimos na mesma UF não existem no IBGE, mas o slug normalizado pode): sufixo pelo código
            seen: dict[str, int] = {}
            fixed = []
            for ibge, kind, name, slug, uf, parent in rows:
                if slug in seen:
                    slug = f"{slug}-{ibge}"
                seen[slug] = 1
                fixed.append((ibge, kind, name, slug, uf, parent))
            # parent_id resolve em duas passadas: primeiro insere sem pai, depois liga
            upsert(conn, "places", ["ibge_code", "kind", "name", "slug", "uf"], [(a, b, c, d, e) for a, b, c, d, e, _ in fixed], ["ibge_code"], update=["kind", "name", "uf"])
            conn.cursor().executemany(
                """update places p set parent_id = q.id from places q
                   where p.ibge_code = %s and q.ibge_code = %s and p.parent_id is distinct from q.id""",
                [(a, p) for a, _, _, _, _, p in fixed if p],
            )
            conn.execute("update places set parent_id = (select id from places where ibge_code = 'BR') where kind = 'regiao' and parent_id is null")
            r.add(len(fixed))

            # casas legislativas: Câmara e Senado (BR), uma assembleia por UF, uma câmara por município
            pid = {row["ibge_code"]: row["id"] for row in conn.execute("select ibge_code, id from places")}
            bodies = [
                ("camara_deputados", pid["BR"], "Câmara dos Deputados", "camara_api", "https://dadosabertos.camara.leg.br/"),
                ("senado", pid["BR"], "Senado Federal", "senado_api", "https://www12.senado.leg.br/dados-abertos"),
            ]
            for u in ufs:
                if u["sigla"] == "DF":
                    bodies.append(("camara_legislativa_df", pid[str(u["id"])], "Câmara Legislativa do Distrito Federal", "none", None))
                else:
                    bodies.append(("assembleia", pid[str(u["id"])], f"Assembleia Legislativa de {u['nome']}", "none", None))
            for m in munis:
                bodies.append(("camara_municipal", pid[str(m["municipio-id"])], f"Câmara Municipal de {m['municipio-nome']}", "none", None))
            upsert(conn, "legislative_bodies", ["kind", "place_id", "name", "adapter", "open_data_url"], bodies, ["kind", "place_id"], update=["name"])
            r.add(len(bodies))
    except SkipUnchanged:
        return
