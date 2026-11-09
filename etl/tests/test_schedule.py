"""Agenda (D250): decisão de vencimento, régua igual à do site e cadência dentro do prazo."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

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
    "transparencia": ["transparencia.emendas"],
    "cgu": ["sancoes.cgu"],
}

SOURCES_TS = Path(__file__).resolve().parents[2] / "web/src/lib/sources.ts"
WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/etl.yml"


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


def test_prazo_global_corta_e_adia():
    assert S.task_timeout_h(5, 0, None) == 5
    assert S.task_timeout_h(2, 0, 320) == 2  # cabe inteiro
    assert abs(S.task_timeout_h(5, 0, 320) - 275 / 60) < 1e-9  # cortado ao que resta antes da reserva
    assert abs(S.task_timeout_h(5, 200, 320) - 75 / 60) < 1e-9  # resta 320-45-200 = 75 min
    assert S.task_timeout_h(1, 270, 320) is None  # sobram 5 min: adia


def test_recusa_pooler_em_modo_transacao():
    import pytest

    S.check_url("postgres://u@db.x.supabase.co:5432/postgres")
    for bad in ("postgres://u@aws-0.pooler.supabase.com:6543/postgres", "postgres://u@h:6543?sslmode=require", "postgres://u@h/db?pgbouncer=true"):
        with pytest.raises(SystemExit):
            S.check_url(bad)


def test_relatorio_alerta_quando_a_agenda_quebra_ou_adia():
    r = S.Report(started_at=NOW.isoformat())
    r.deferred.append("sapl.todas")
    assert not r.alert and "adiadas" in r.text()
    r.error = "OperationalError: conexão caiu"
    assert r.alert and "ERRO DA AGENDA" in r.text()


def test_descoberta_do_sapl_nao_conta_como_fonte_em_dia():
    assert "sapl.descoberta" in S.NOT_FRESHNESS


# ------------------------------------------------------------------ catálogo D13: a mesma régua no site e na agenda

def _site_field(field: str) -> dict[str, int]:
    block = SOURCES_TS.read_text()
    block = block[block.index("export const SOURCE_META") : block.index("export const NOT_YET")]
    out = {}
    for m in re.finditer(r'^\s{2}("?)([a-z-]+)\1:\s*\{(.*?)' + field + r':\s*([\d\s*]+)', block, re.S | re.M):
        out[m.group(2)] = eval(m.group(4))  # noqa: S307 - literal numérico do próprio repo
    return out


def test_cadencia_do_site_e_a_da_agenda():
    """everyHours (sources.ts) = a menor cadência (Task.every_h) entre as tarefas que carimbam a fonte."""
    by = {t.name: t for t in S.TASKS}
    site = _site_field("everyHours")
    assert set(site) == set(SOURCE_TASKS) == set(S.MAX_AGE_H)
    for src, names in SOURCE_TASKS.items():
        assert site[src] == min(by[n].every_h for n in names), src


def test_constantes_do_cron_iguais_no_workflow_na_agenda_e_no_site():
    ts = SOURCES_TS.read_text()
    assert int(re.search(r"SCHEDULER_MINUTE = (\d+)", ts).group(1)) == S.TICK_MINUTE
    assert int(re.search(r"SCHEDULER_EVERY_HOURS = (\d+)", ts).group(1)) == S.TICK_EVERY_H
    assert f'cron: "{S.TICK_MINUTE} */{S.TICK_EVERY_H} * * *"' in WORKFLOW.read_text()


def test_proxima_leitura():
    u = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731
    assert S.next_tick(u(2026, 11, 8, 12, 0)) == u(2026, 11, 8, 12, 17)
    assert S.next_tick(u(2026, 11, 8, 12, 18)) == u(2026, 11, 8, 15, 17)
    assert S.next_tick(u(2026, 11, 8, 23, 30)) == u(2026, 11, 9, 0, 17)
    # carimbo 11:00 + 20 h = 07:00 do dia seguinte -> próxima chamada às 09:17
    assert S.next_read(20, u(2026, 11, 8, 11), u(2026, 11, 8, 12)) == u(2026, 11, 9, 9, 17)
    # já vencida: a próxima chamada depois de agora
    assert S.next_read(20, u(2026, 11, 1), u(2026, 11, 8, 12)) == u(2026, 11, 8, 12, 17)


def _node_roda_ts() -> bool:
    """Node com type stripping (>= 22.18 / 23.6 por padrão): importa o .ts direto. Sem isso o teste pula em vez de falhar."""
    if shutil.which("node") is None:
        return False
    r = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", f"import {{ SCHEDULER_MINUTE }} from {json.dumps(str(SOURCES_TS))}; console.log(SCHEDULER_MINUTE)"],
                       capture_output=True, text=True, timeout=60)
    return r.returncode == 0 and r.stdout.strip() == str(S.TICK_MINUTE)


@pytest.mark.skipif(not _node_roda_ts(), reason="node sem type stripping")
def test_proxima_leitura_do_site_igual_a_da_agenda():
    """Roda o sources.ts de verdade (node faz type stripping) e compara com schedule.next_read em vários carimbos."""
    base = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
    cases = [(base - timedelta(hours=h, minutes=m), ev) for h in (0, 1, 5, 19, 20, 33, 90, 700) for m in (0, 13, 17, 18, 59) for ev in (20, 7 * 24, 6 * 24)]
    script = f"""import {{ nextExpectedRead }} from {json.dumps(str(SOURCES_TS))};
const now = {int(base.timestamp() * 1000)};
const cases = {json.dumps([[c.isoformat(), ev] for c, ev in cases])};
console.log(JSON.stringify(cases.map(([c, ev]) => nextExpectedRead(c, ev, now))));"""
    res = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr
    got = json.loads(res.stdout)
    want = [S.next_read(ev, c, base).strftime("%Y-%m-%dT%H:%M:%S.000Z") for c, ev in cases]
    assert got == want


# ------------------------------------------------------------------ catálogo D06: janela horária

BRT = timezone(timedelta(hours=-3))


def _at(day: int, h: int, m: int) -> datetime:
    """Nov/2026 em Brasília: dia 3 = terça, 7 = sábado, 8 = domingo, 9 = segunda."""
    return datetime(2026, 11, day, h, m, tzinfo=BRT)


def test_janela_do_senado_limites():
    w = S.Window(S.dtime(0, 30), S.dtime(2, 0), S.TER_A_SAB)
    assert w.opened_at(_at(3, 0, 29)) is None
    assert w.opened_at(_at(3, 0, 30)) == _at(3, 0, 30)
    assert w.opened_at(_at(3, 1, 59)) == _at(3, 0, 30)
    assert w.opened_at(_at(3, 2, 0)) is None and w.opened_at(_at(3, 2, 1)) is None
    assert w.opened_at(_at(7, 1, 0)) is not None  # sábado entra
    assert w.opened_at(_at(8, 1, 0)) is None  # domingo não
    assert w.opened_at(_at(9, 1, 0)) is None  # segunda não (a noite de domingo não tem sessão)
    assert w.opened_at(_at(3, 1, 0).astimezone(timezone.utc)) == _at(3, 0, 30)  # entrada em UTC, conta em Brasília


def test_tarefa_com_janela_vence_uma_vez_por_janela():
    t = S.Task("x.noturna", lambda d: ["x"], ("x.noturna.",), 24, 1, retry_h=1, window=S.Window(S.dtime(0, 30), S.dtime(2, 0), S.TER_A_SAB))
    now = _at(4, 0, 40)
    assert S.is_due(t, None, None, now)[0]  # nunca lida, janela aberta
    assert S.is_due(t, _at(3, 0, 50), _at(3, 0, 50), now)[0]  # carimbo da noite anterior: vence
    ok, why = S.is_due(t, _at(4, 0, 35), _at(4, 0, 35), now)
    assert not ok and "já lida nesta janela" in why  # carimbo (inclusive skipped_unchanged) desde a abertura
    ok, why = S.is_due(t, _at(3, 0, 50), _at(4, 0, 38), now)
    assert not ok and "tentativa" in why  # falhou há 2 min: espera o retry de 1 h
    assert S.is_due(t, _at(3, 0, 50), _at(4, 0, 38), _at(4, 1, 45))[0]  # ainda dentro da janela, passou 1 h
    ok, why = S.is_due(t, None, None, _at(4, 2, 5))
    assert not ok and "fora da janela" in why  # nem nunca lida vence fora da janela
    assert not S.is_due(t, None, None, _at(8, 1, 0))[0]  # domingo


def test_janelas_das_tarefas_noturnas_cabem_nos_crons_do_workflow():
    """Cada janela tem de conter pelo menos um disparo do cron, com 20 min de folga antes do fim (o GitHub atrasa)."""
    wf = WORKFLOW.read_text()
    crons = re.findall(r'- cron: "([^"]+)"', wf)
    assert len(crons) >= 3
    fires: list[tuple[int, int, int]] = []  # (dia da semana UTC no padrão cron 0=dom, hora, minuto)
    for c in crons:
        mi, hr, _, _, dow = c.split()
        hours = range(0, 24, int(hr[2:])) if hr.startswith("*/") else [int(hr)]
        days = range(7) if dow == "*" else range(int(dow.split("-")[0]), int(dow.split("-")[-1]) + 1)
        fires += [(d, h, int(mi)) for d in days for h in hours]
    by = {t.name: t for t in S.TASKS}
    for name in ("senado.noturna", "camara.noturna"):
        w = by[name].window
        assert w and w.days == S.TER_A_SAB
        hit = False
        for d, h, m in fires:
            # data de referência: 2026-11-03 é terça (cron dow 2); soma os dias até o dow do disparo
            utc = datetime(2026, 11, 1, h, m, tzinfo=timezone.utc) + timedelta(days=d)  # 01/11/2026 é domingo = dow 0
            opened = w.opened_at(utc)
            if opened and utc + timedelta(minutes=20) <= datetime.combine(utc.astimezone(BRT).date(), w.end, BRT):
                hit = True
        assert hit, f"nenhum disparo do cron cai (com folga) na janela de {name}"


def test_camara_noturna_so_depois_de_o_csv_ser_regerado():
    """Last-Modified dos CSVs de votações em 04 e 08/11/2026: entre 03:50 e 04:45 de Brasília (06:50 a 07:44 GMT)."""
    w = {t.name: t for t in S.TASKS}["camara.noturna"].window
    assert w.start >= S.dtime(4, 45) and w.end <= S.dtime(7, 0)  # antes das 07h (aceite do catálogo D06)


def test_noturnas_sao_as_primeiras_e_carimbam_familia_propria():
    names = [t.name for t in S.TASKS]
    assert names[:2] == ["senado.noturna", "camara.noturna"]
    by = {t.name: t for t in S.TASKS}
    # família própria: não pode mascarar o carimbo da carga completa (camara.votacoes. / senado.votacoes.)
    assert by["senado.noturna"].families(date(2026, 11, 4)) == ("senado.noturna.",)
    assert not any(p.startswith(("senado.noturna", "camara.noturna")) for n in ("camara.diario", "senado.diario") for p in by[n].families(date(2026, 11, 4)))


# ------------------------------------------------------------------ catálogo D01: chave de API ausente não é alarme permanente

def test_fonte_sem_chave_e_sem_carga_aguarda_em_vez_de_alertar():
    st = {k: NOW for k in S.MAX_AGE_H}
    st["transparencia"] = None
    assert {o["source"] for o in S.overdue_sources(st, NOW)} == {"transparencia"}
    assert S.overdue_sources(st, NOW, frozenset({"transparencia"})) == []
    st["transparencia"] = NOW - timedelta(days=30)  # já teve carga e passou do prazo: alerta mesmo sem chave
    assert [o["source"] for o in S.overdue_sources(st, NOW, frozenset({"transparencia"}))] == ["transparencia"]


def test_tarefa_com_chave_ausente_e_pulada_com_motivo(conn, monkeypatch):
    monkeypatch.delenv("TRANSPARENCIA_API_KEY", raising=False)
    monkeypatch.setattr(S, "env_ok", lambda name: False)
    due, skipped = S.plan(conn, NOW, ["transparencia.emendas", "sancoes.cgu"], False, True)
    assert due == [] and {s["task"] for s in skipped} == {"transparencia.emendas", "sancoes.cgu"}
    assert all("TRANSPARENCIA_API_KEY" in s["why"] for s in skipped)
    monkeypatch.setattr(S, "env_ok", lambda name: True)
    due, _ = S.plan(conn, NOW, ["transparencia.emendas"], False, True)
    assert [t.name for t, _ in due] == ["transparencia.emendas"]
    r = S.Report(started_at=NOW.isoformat())
    r.awaiting = ["cgu", "transparencia"]
    assert not r.alert and "aguardam chave" in r.text()
