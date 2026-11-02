"""etl.ibge.malhas: contornos do Brasil por UF e de cada UF por município, em SVG pronto para o app.

Fonte: API de Malhas do IBGE v3 (CC BY 4.0), qualidade mínima. Saída: arquivos estáticos em web/public/geo/
  br.json            {viewBox, items: [{ibge, uf, name, region, d}]}
  uf/{ibge}.json     {viewBox, items: [{ibge, name, d}]}
Projeção: equiretangular com correção de cos(latitude média) por arquivo; coordenadas arredondadas a 0,01 do
viewBox (~1 km na escala de UF). Nada vai para o banco: o mapa é desenho, não dado.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

import psycopg

from ..db import run
from ..http import fetch

log = logging.getLogger("etl.malhas")
API = "https://servicodados.ibge.gov.br/api/v3/malhas"
OUT = Path(__file__).resolve().parents[3] / "web" / "public" / "geo"
WIDTH = 1000.0


def _rings(geom: dict) -> list[list[list[float]]]:
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [ring for poly in geom["coordinates"] for ring in poly]
    return []


def _project(features: list[dict]) -> tuple[str, list[str]]:
    pts = [p for f in features for ring in _rings(f["geometry"]) for p in ring]
    min_x, max_x = min(p[0] for p in pts), max(p[0] for p in pts)
    min_y, max_y = min(p[1] for p in pts), max(p[1] for p in pts)
    k = math.cos(math.radians((min_y + max_y) / 2))
    scale = WIDTH / ((max_x - min_x) * k)
    height = (max_y - min_y) * scale

    def xy(p: list[float]) -> tuple[float, float]:
        return round((p[0] - min_x) * k * scale, 1), round((max_y - p[1]) * scale, 1)

    paths = []
    for f in features:
        parts = []
        for ring in _rings(f["geometry"]):
            seq, last = [], None
            for p in ring:
                q = xy(p)
                if q != last:
                    seq.append(q)
                    last = q
            if len(seq) >= 3:
                parts.append("M" + "L".join(f"{x:g},{y:g}" for x, y in seq) + "Z")
        paths.append("".join(parts))
    return f"0 0 {WIDTH:g} {round(height, 1):g}", paths


def run_malhas(conn: psycopg.Connection, *, force: bool = False) -> None:
    ufs = {r["ibge_code"]: r for r in conn.execute("select p.ibge_code, p.name, p.uf, r.name as region from places p join places r on r.id = p.parent_id where p.kind = 'uf'")}
    names = {r["ibge_code"]: r["name"] for r in conn.execute("select ibge_code, name from places where kind = 'municipio'")}
    with run(conn, "ibge.malhas", "ibge", force=force) as r:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "uf").mkdir(exist_ok=True)
        br = fetch(f"{API}/paises/BR?formato=application/vnd.geo%2Bjson&intrarregiao=UF&qualidade=minima", accept="application/vnd.geo+json").json()
        feats = [f for f in br["features"] if f["properties"]["codarea"] in ufs]
        vb, paths = _project(feats)
        items = [{"ibge": f["properties"]["codarea"], "uf": ufs[f["properties"]["codarea"]]["uf"], "name": ufs[f["properties"]["codarea"]]["name"],
                  "region": ufs[f["properties"]["codarea"]]["region"], "d": d} for f, d in zip(feats, paths)]
        (OUT / "br.json").write_text(json.dumps({"viewBox": vb, "source": "IBGE, malhas territoriais (CC BY 4.0)", "items": items}, ensure_ascii=False, separators=(",", ":")))
        r.add(len(items))
        for code in sorted(ufs):
            g = fetch(f"{API}/estados/{code}?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima", accept="application/vnd.geo+json", max_age=30 * 86400).json()
            feats = [f for f in g["features"] if f["properties"]["codarea"] in names]
            missing = len(g["features"]) - len(feats)
            if missing:
                r.reject(missing, f"{ufs[code]['uf']}: {missing} municípios da malha sem cadastro")
            vb, paths = _project(feats)
            items = sorted(({"ibge": f["properties"]["codarea"], "name": names[f["properties"]["codarea"]], "d": d} for f, d in zip(feats, paths)), key=lambda x: x["name"])
            (OUT / "uf" / f"{code}.json").write_text(json.dumps({"viewBox": vb, "uf": ufs[code]["uf"], "name": ufs[code]["name"], "items": items}, ensure_ascii=False, separators=(",", ":")))
            r.add(len(items))
        size = sum(p.stat().st_size for p in OUT.rglob("*.json"))
        log.info("malhas: %d arquivos, %.1f MB", len(list(OUT.rglob("*.json"))), size / 1e6)
