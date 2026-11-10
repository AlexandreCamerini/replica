"""D201: observações de partido no mesmo dia têm desempate determinístico, igual no derive.stats e no check."""

from __future__ import annotations

from civico_etl.jobs.checks import CHECKS
from civico_etl.jobs.derive_stats import PARTY_SQL, party_obs_tiebreak


def test_mesma_expressao_no_derive_e_no_check():
    tb = party_obs_tiebreak("po")
    assert tb in PARTY_SQL
    assert any(tb in q for n, q in CHECKS if "própria casa" in n)


def test_ultimo_evento_do_dia_vence(conn, carga):
    # Câmara, /historico de 220612 (Bebeto): 01/02/2023 12:05 posse pelo PTB; 13:22 "Alteração de partido" para PP
    rows = conn.execute(
        f"""select pa.acronym from party_observations po join people p on p.id = po.person_id join parties pa on pa.id = po.party_id
            where p.slug = %s and po.observed_on = '2023-02-01' and po.source = 'camara' order by {party_obs_tiebreak('po')} limit 1""",
        ("bebeto",),
    ).fetchall()
    assert rows and rows[0]["acronym"] == "PP"


def test_partido_vigente_bate_com_a_casa(conn):
    q = next(q for n, q in CHECKS if "própria casa" in n)
    assert list(conn.execute(q).fetchone().values())[0] == 0
