"""Agenda (D250): decisão de vencimento, régua igual à do site e cadência dentro do prazo."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from civico_etl import schedule as S

NOW = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
T = S.Task("x", lambda t: ["x"], ("x.",), every_h=24, timeout_h=1)

# fonte -> tarefas que a carimbam
SOURCE_TASKS = {
    "camara": ["camara.diario", "camara.presenca"],
    "senado": ["senado.diario", "senado.secretas"],
    "tse": ["tse.candidatos.recentes"],
    "ibge": ["ibge.places"],
    "alesp": ["ale.todas"],
    "alemg": ["ale.todas"],
    "sapl": ["sapl.todas"],
    "tcu": ["sancoes.tcu"],
    "ibge-sidra": ["governos.indicadores"],
    "bcb-sgs": ["governos.indicadores"],
    "receita-federal": ["receita.arrecadacao"],
}


def test_max_age_igual_ao_site():
    ts = (Path(__file__).resolve().parents[2] / "web/src/lib/sources.ts").read_text()
    block = ts[ts.index("export const SOURCE_META") : ts.index("export const NOT_YET")]
    site = {}
    for m in re.finditer(r'^\s{2}("?)([a-z-]+)\1:\s*\{(.*?)maxAgeHours:\s*([\d\s*]+)', block, re.S | re.M):
        site[m.group(2)] = eval(m.group(4))  # noqa: S307 - literal numérico do próprio repo
    assert site == S.MAX_AGE_H


def test_cada_fonte_tem_tarefa_com_folga_para_uma_falha():
    by = {t.name: t for t in S.TASKS}
    for src, names in SOURCE_TASKS.items():
        for n in names:
            t = by[n]
            assert t.every_h + t.retry() <= S.MAX_AGE_H[src], (src, n)


def test_nomes_unicos_e_argv_valido():
    names = [t.name for t in S.TASKS]
    assert len(names) == len(set(names))
    for t in S.TASKS:
        assert t.argv(date(2026, 11, 4))


def test_anos_recentes():
    assert S._recent_election_years(date(2026, 11, 4)) == [2024, 2026]
    assert S._recent_election_years(date(2027, 3, 1)) == [2024, 2026]


def test_nunca_carregada_vence():
    assert S.is_due(T, None, None, NOW)[0]


def test_em_dia_nao_vence():
    assert not S.is_due(T, NOW - timedelta(hours=3), NOW - timedelta(hours=3), NOW)[0]


def test_vencida_vence():
    assert S.is_due(T, NOW - timedelta(hours=30), NOW - timedelta(hours=30), NOW)[0]


def test_tentativa_recente_que_falhou_espera_o_retry():
    due, why = S.is_due(T, NOW - timedelta(hours=30), NOW - timedelta(hours=1), NOW)
    assert not due and "tentativa" in why
    assert S.is_due(T, NOW - timedelta(hours=30), NOW - timedelta(hours=7), NOW)[0]


def test_fora_do_prazo_e_sem_carga():
    st = {k: NOW for k in S.MAX_AGE_H}
    st["camara"] = NOW - timedelta(hours=40)
    st["tcu"] = None
    out = {o["source"]: o for o in S.overdue_sources(st, NOW)}
    assert set(out) == {"camara", "tcu"}
    assert out["tcu"]["age_h"] is None


def test_relatorio_alerta():
    r = S.Report(started_at=NOW.isoformat())
    assert not r.alert
    r.ran.append({"task": "x", "args": [], "exit": 1, "secs": 3, "tail": "boom"})
    assert r.alert and "FALHOU x" in r.text()
