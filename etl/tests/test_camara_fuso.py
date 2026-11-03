"""BUG-017 / D160: hora da Câmara é de Brasília sem fuso; gravar como naive virava "relógio local = UTC" (14:34 aparecia 11:34)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from civico_etl.util import BRT, midnight_br, parse_ts, parse_ts_br

JOBS = Path(__file__).resolve().parents[1] / "civico_etl" / "jobs"


def test_hora_de_brasilia_vira_instante_correto():
    ts = parse_ts_br("2026-10-28T14:34:00")
    assert ts.utcoffset() == timedelta(hours=-3)
    assert ts.astimezone(timezone.utc) == datetime(2026, 10, 28, 17, 34, tzinfo=timezone.utc)


def test_formato_curto_da_api_de_eventos():
    assert parse_ts_br("2026-10-28T13:55").astimezone(timezone.utc).hour == 16


def test_horario_de_verao_ate_2019():
    # fev/2019 ainda tinha horário de verão (-02); o fuso nomeado acerta, um "-03" fixo erraria
    assert parse_ts_br("2019-02-12T10:00").utcoffset() == timedelta(hours=-2)
    assert parse_ts_br("2019-03-12T10:00").utcoffset() == timedelta(hours=-3)


def test_vazio_e_lixo():
    assert parse_ts_br(None) is None and parse_ts_br("") is None and parse_ts_br("n/a") is None


def test_parse_ts_continua_naive_para_quem_so_quer_a_data():
    assert parse_ts("2026-10-28T23:30:00").tzinfo is None


def test_so_data_vira_meia_noite_de_brasilia():
    assert midnight_br(date(2026, 10, 28)) == datetime(2026, 10, 28, 3, 0, tzinfo=timezone.utc)
    assert midnight_br(date(2026, 10, 28)).tzinfo is BRT


def test_aware_comparavel_com_intervalos_de_exercicio():
    """camara_presenca compara a sessão com os intervalos de exercício: os dois lados precisam ter fuso."""
    assert parse_ts_br("2023-02-01T00:00:00") <= parse_ts_br("2026-10-28T13:55") < midnight_br(date(2027, 1, 1))


def test_jobs_da_camara_nao_usam_parse_ts_naive_em_campo_de_hora():
    """Guarda estática: dataHora* da API da Câmara só passa por parse_ts_br."""
    for name in ("camara_presenca.py", "camara_diario.py", "parlamento_extras.py", "camara_equipe.py", "senado_diario.py"):
        src = (JOBS / name).read_text()
        assert not re.search(r"\bparse_ts\(", src), f"{name}: parse_ts naive em dado da Câmara (use parse_ts_br)"


def test_so_data_nunca_vira_meia_noite_naive():
    """Senado só publica a data: meia-noite UTC (naive) aparece como 21:00 do dia anterior em Brasília."""
    for name in ("senado_diario.py", "parlamento_extras.py", "camara_diario.py"):
        assert "datetime.min.time()" not in (JOBS / name).read_text(), f"{name}: use midnight_br(dia)"


def test_banco_so_data_do_senado_esta_na_meia_noite_de_brasilia(conn):
    """Invariante de dado: voto/sessão do Senado (só data) cai em 00:00 de Brasília, não 00:00 UTC."""
    n = conn.execute(
        """select (select count(*) from voting_events v join legislative_bodies b on b.id = v.body_id
                    where b.name like 'Senado%%' and (v.occurred_at at time zone 'America/Sao_Paulo')::time <> '00:00')
                + (select count(*) from sessions v join legislative_bodies b on b.id = v.body_id
                    where b.name like 'Senado%%' and (v.starts_at at time zone 'America/Sao_Paulo')::time <> '00:00')"""
    ).fetchone()["?column?"]
    assert n == 0
