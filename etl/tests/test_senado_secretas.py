"""Item 2 da W3-B: votação secreta do Senado pelo campo da fonte (D123)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from civico_etl.jobs.senado_diario import _is_secret


def test_campo_da_fonte():
    assert _is_secret({"votacaoSecreta": "S"}) is True
    assert _is_secret({"votacaoSecreta": "N"}) is False
    assert _is_secret({"votacaoSecreta": " s "}) is True
    assert _is_secret({}) is None  # fonte não informa: nunca deduzir dos votos


def test_aberta_sem_voto_nao_vira_secreta():
    # 2019-06-25, votação 5981: aberta na fonte e sem votos individuais; D55 a chamaria de secreta
    assert _is_secret({"votacaoSecreta": "N", "votos": []}) is False


def test_contagem_bate_com_a_fonte(conn):
    """Contagem de secretas por ano no banco = contagem do /votacao em cache (quando o cache existe)."""
    from civico_etl.http import CACHE_DIR

    d = CACHE_DIR / "legis.senado.leg.br"
    metas = [m for m in d.glob("*.meta.json") if "votacao?dataInicio=" in json.loads(m.read_text()).get("url", "")] if d.exists() else []
    if not metas:
        pytest.skip("sem /votacao em cache")
    for m in metas:
        url = json.loads(m.read_text())["url"]
        year = int(url.split("dataInicio=")[1][:4])
        body = json.loads(m.with_name(m.name.replace(".meta.json", ".body")).read_text())
        fonte = sum(1 for v in body if v.get("votacaoSecreta") == "S" and (v.get("casaSessao") or "SF") == "SF")
        banco = conn.execute(
            """select count(*) as n from voting_events e join legislative_bodies b on b.id = e.body_id and b.kind = 'senado'
               where e.is_secret and extract(year from e.occurred_at) = %s""",
            (year,),
        ).fetchone()["n"]
        assert banco == fonte, (year, banco, fonte)
