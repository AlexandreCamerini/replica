"""Item 5 da W3-B: sanções do TCU (D130–D132)."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.sancoes import norm_name, parse_tcu

AMOSTRA = {"nome": "ABDALA GOMES SANTOS", "cpf": "215.805.453-00", "processo": "026.615/2020-7", "deliberacao": "AC-000738/2022-PL",
           "data_transito_julgado": "2022-07-16T03:00:00Z", "data_final": "2027-07-16T03:00:00Z", "data_acordao": "2022-04-06T17:30:00Z",
           "uf": "MA", "municipio": "SANTA INES"}


def test_cpf_nunca_e_gravado():
    (row,) = parse_tcu([AMOSTRA])
    assert "215.805.453-00" not in repr(row) and "cpf" not in row
    assert row["final_on"] == date(2022, 7, 16) and row["ends_on"] == date(2027, 7, 16)
    assert row["uf"] == "MA" and row["source_key"] == "026.615/2020-7|AC-000738/2022-PL|abdala gomes santos"


def test_nome_normalizado():
    assert norm_name("  José  da Silva-Souza ") == "jose da silva souza"


def test_vinculo_so_com_metodo(conn):
    r = conn.execute("select count(*) as n from sanctions where person_id is not null and (match_method is null or match_confidence < 0.9)").fetchone()
    assert r["n"] == 0
