"""R-8: códigos de saída de `check` (cli.main) e de `run-due` (schedule.main) fixados como estão.

check: 0 sem invariante quebrada, 1 com. run-due: 0 sem alerta (e quando outro run-due está em andamento), 2 com alerta.
Nada aqui executa subprocesso, toma lock de verdade, nem grava no banco ou em etl/.state: a conexão da agenda é um dublê e o
estado vai para tmp_path. O único teste que toca o banco (invariante quebrada de verdade) roda em transação revertida.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest

from civico_etl import cli
from civico_etl import schedule as S
from civico_etl.jobs import checks

# ------------------------------------------------------------------ check


class _ConnFalsa:
    """O que cli.main espera de db.connect(): só close() é chamado quando run_checks está trocado."""

    closed = False

    def close(self):
        self.closed = True


@pytest.fixture
def cli_sem_banco(monkeypatch):
    c = _ConnFalsa()
    monkeypatch.setattr(cli.db, "connect", lambda: c)
    return c


def test_check_sem_invariante_quebrada_sai_0(cli_sem_banco, monkeypatch):
    monkeypatch.setattr(checks, "run_checks", lambda conn: 0)
    assert cli.main(["check"]) == 0
    assert cli_sem_banco.closed


@pytest.mark.parametrize("falhas", [1, 5])
def test_check_com_invariante_quebrada_sai_1(cli_sem_banco, monkeypatch, falhas):
    monkeypatch.setattr(checks, "run_checks", lambda conn: falhas)
    assert cli.main(["check"]) == 1  # qualquer número de falhas vira 1, não o número
    assert cli_sem_banco.closed


def test_invariante_quebrada_de_verdade_conta_uma_falha(rw):
    """Quebra a regra "pauta: regra vigente com tema que não existe em topics" numa transação que reverte. O banco local tem
    outras invariantes quebradas (sem carga), então a prova é o delta: +1 sobre a linha de base."""
    nome = "pauta: regra vigente com tema que não existe em topics"
    sql = dict(checks.CHECKS)[nome]
    logging.getLogger("etl.check").setLevel(logging.CRITICAL)  # as falhas da linha de base não poluem o log
    assert list(rw.execute(sql).fetchone().values())[0] == 0, "pré-condição: a invariante passa antes de ser quebrada"
    base = checks.run_checks(rw)
    rw.execute(
        "insert into pocket_rules (version, topic_slugs, terms, term_pattern, published_on)"
        " select coalesce(max(version), 0) + 1000, array['__tema_inexistente_r8__'], array['x'], 'x', current_date from pocket_rules"
    )
    assert list(rw.execute(sql).fetchone().values())[0] == 1
    assert checks.run_checks(rw) == base + 1


# ------------------------------------------------------------------ run-due


class _Res:
    def __init__(self, row):
        self.row, self.rowcount = row, 0

    def fetchone(self):
        return self.row

    def fetchall(self):
        return []


class _AgendaConn:
    """Conexão da agenda sem banco: o lock responde `lock_ok`; a consulta da última chamada (lock ocupado) devolve `attempt_row`."""

    def __init__(self, lock_ok=True, attempt_row=None):
        self.lock_ok, self.attempt_row = lock_ok, attempt_row

    def execute(self, sql, params=None):
        return _Res({"ok": self.lock_ok} if "pg_try_advisory_lock" in sql else self.attempt_row)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def close(self):
        pass


@pytest.fixture
def agenda(monkeypatch, tmp_path):
    """run-due inteiro sem banco, sem subprocesso e sem escrever fora de tmp_path. Devolve o dublê para o teste ajustar."""
    s = type("Ctx", (), {})()
    s.conn = _AgendaConn()
    s.due = []  # [(Task, motivo)] que o plan devolve
    s.exits = {}  # nome da tarefa/"check" -> exit do subprocesso (padrão 0)
    s.stamps = {src: datetime.now(timezone.utc) for src in S.MAX_AGE_H}  # tudo em dia
    s.calls = []
    monkeypatch.delenv("ETL_ALERT_WEBHOOK", raising=False)
    monkeypatch.delenv("ETL_TASKS_INCLUDE", raising=False)
    monkeypatch.delenv("ETL_TASKS_EXCLUDE", raising=False)
    monkeypatch.delenv("ETL_DEADLINE_MIN", raising=False)
    monkeypatch.setenv("ETL_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("ETL_DATABASE_URL", "postgres://agenda-falsa@localhost:1/nada")
    monkeypatch.setenv("ETL_INVOCATION", "r8")  # run_due grava esta variável; o monkeypatch a restaura no fim

    def run_cli(args, timeout_h, log_dir):
        s.calls.append(args[0])
        return {"args": args, "exit": s.exits.get(args[0], 0), "secs": 0.0, "tail": "dublê", "log": str(log_dir / f"{args[0]}.log")}

    monkeypatch.setattr(S, "_connect", lambda url: s.conn)
    monkeypatch.setattr(S, "mark_attempt", lambda *a, **k: None)
    monkeypatch.setattr(S, "sweep_orphans", lambda c, now: [])
    monkeypatch.setattr(S, "move_legacy_notes", lambda c, like="%": 0)
    monkeypatch.setattr(S, "plan", lambda *a, **k: (s.due, []))
    monkeypatch.setattr(S, "repairs_available", lambda: False)
    monkeypatch.setattr(S, "_run_cli", run_cli)
    monkeypatch.setattr(S, "source_stamps", lambda c: s.stamps)
    monkeypatch.setattr(S, "awaiting_key_sources", lambda: frozenset())
    monkeypatch.setattr(S, "partial_runs", lambda c, inv: [])
    s.state = tmp_path / "state"
    return s


ARGV = ["run-due", "--only", "ibge.places"]  # --only: sem tarefa com janela, logo sem "janela perdida" no relatório


def test_run_due_sem_alerta_sai_0(agenda, capsys):
    agenda.due = [(next(t for t in S.TASKS if t.name == "ibge.places"), "nunca carregada")]
    assert cli.main(ARGV) == 0
    assert agenda.calls == ["ibge.places", "derive.stats", "check"]
    assert (agenda.state / "last-run.json").is_file()  # o alerta/relatório sai em tmp_path, não em etl/.state


def test_run_due_com_check_quebrado_sai_2(agenda):
    agenda.exits["check"] = 1
    assert S.main(ARGV) == 2


def test_run_due_com_tarefa_que_falha_sai_2(agenda):
    agenda.due = [(next(t for t in S.TASKS if t.name == "ibge.places"), "nunca carregada")]
    agenda.exits["ibge.places"] = 3
    assert S.main(ARGV) == 2


def test_run_due_com_fonte_fora_do_prazo_sai_2(agenda):
    agenda.stamps["camara"] = datetime.now(timezone.utc) - timedelta(hours=S.MAX_AGE_H["camara"] + 1)
    assert S.main(ARGV) == 2


def test_run_due_com_agenda_que_quebra_sai_2(agenda, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("quebrou")

    monkeypatch.setattr(S, "sweep_orphans", boom)
    assert S.main(ARGV) == 2  # a agenda sempre alerta, mesmo quebrando no meio


def test_run_due_com_outro_em_andamento_sai_0_sem_rodar_nada(agenda):
    agenda.conn = _AgendaConn(lock_ok=False, attempt_row=None)
    assert S.main(ARGV) == 0
    assert agenda.calls == []


def test_run_due_com_lock_travado_ha_mais_de_8h_sai_2(agenda):
    agenda.conn = _AgendaConn(lock_ok=False, attempt_row={"attempted_at": datetime.now(timezone.utc) - S.STUCK_AFTER - timedelta(hours=1)})
    assert S.main(ARGV) == 2
    assert agenda.calls == []


def test_run_due_dry_run_sai_0_mesmo_com_alerta_possivel(agenda, capsys):
    agenda.exits["check"] = 1  # dry-run nem chama check
    assert S.main(ARGV + ["--dry-run"]) == 0
    assert agenda.calls == []
