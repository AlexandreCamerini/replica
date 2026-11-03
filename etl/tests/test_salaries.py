"""Item 1 da W3-B: subsídio federal desde 2015 (D120/D121)."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.seed import SALARIES, SALARY_NORMS


def _vigente(office: str, d: date) -> int | None:
    rows = sorted((v, c) for o, v, c, _ in SALARIES if o == office and v <= d)
    return rows[-1][1] if rows else None


def test_valores_conferidos_nos_decretos():
    # DL 276/2014 e DL 172/2022 (texto publicado no DOU)
    assert _vigente("deputado_federal", date(2019, 2, 1)) == 3_376_300
    assert _vigente("deputado_federal", date(2023, 1, 1)) == 3_929_332
    assert _vigente("deputado_federal", date(2023, 3, 31)) == 3_929_332
    assert _vigente("deputado_federal", date(2023, 4, 1)) == 4_165_092
    assert _vigente("deputado_federal", date(2024, 2, 1)) == 4_400_852
    assert _vigente("senador", date(2025, 2, 1)) == 4_636_619
    assert _vigente("presidente", date(2019, 1, 1)) == 3_093_470  # DL 277/2014


def test_todo_mes_desde_2019_tem_valor():
    for office in ("deputado_federal", "senador", "presidente", "vice_presidente"):
        for y in range(2019, 2027):
            for m in range(1, 13):
                assert _vigente(office, date(y, m, 1)) is not None, (office, y, m)


def test_toda_linha_cita_norma_existente():
    slugs = {s for s, *_ in SALARY_NORMS}
    assert {n for *_, n in SALARIES} <= slugs
    assert all(u.startswith("https://www2.camara.leg.br/legin/") for _, _, u, _ in SALARY_NORMS)


def test_adriana_ventura_94_de_94_meses(conn):
    """Aceite: o acumulado (mesma consulta do front, getSalaryAccrued) cobre todos os meses de mandato."""
    r = conn.execute(
        """with ms as (
             select m.office_id, m.place_id, gs::date as mo from mandates m join people p on p.id = m.person_id,
                    generate_series(date_trunc('month', m.started_on), date_trunc('month', least(m.ends_on - 1, current_date)), interval '1 month') gs
             where p.display_name ilike 'Adriana Ventura%%' and m.status <> 'eleito_aguardando_posse')
           select count(*)::int as months, count(sa.amount_cents)::int as covered from ms
           left join lateral (select amount_cents from salaries s where s.office_id = ms.office_id and (s.place_id = ms.place_id or s.place_id is null)
                              and s.valid_from <= ms.mo and not s.is_ceiling order by s.place_id nulls last, s.valid_from desc limit 1) sa on true"""
    ).fetchone()
    if not r["months"]:
        import pytest

        pytest.skip("Adriana Ventura não está no banco")
    assert r["months"] >= 94
    assert r["covered"] == r["months"]
