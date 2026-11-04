"""Agenda do ETL (D250): `civico-etl run-due` roda o que venceu, na ordem certa, e alerta o que ficou fora do prazo.

Pensado para ser chamado de hora em hora (launchd, cron ou GitHub Actions; ver etl/deploy/). Cada chamada:
  1. pega o lock global `etl.scheduler` (duas chamadas sobrepostas: a segunda sai sem fazer nada);
  2. fecha runs órfãos: `running` há mais de 1 h cujo advisory lock do dataset está livre (o processo morreu);
  3. roda as tarefas vencidas, cada uma num subprocesso com timeout, na ordem de TASKS; falha de uma não para as outras;
  4. se rodou carga de pessoas (TSE, Câmara, Senado), roda `identity.repairs --apply` e depois `derive.stats`;
  5. roda `check` (invariantes) e calcula as fontes fora do prazo com a mesma régua do site (MAX_AGE_H = sources.ts);
  6. alerta: resumo no stdout, JSON em ETL_STATE_DIR/last-run.json e, se ETL_ALERT_WEBHOOK existir, POST {"text": ...}.
Saída: 0 tudo certo; 2 houve alerta (falha, check quebrado, fonte fora do prazo ou run órfão).

Vencida = o carimbo mais novo dos datasets da tarefa (dataset_stamps; skipped_unchanged também carimba) é mais velho que
`every_h`, e a última tentativa (qualquer status) é mais velha que `retry_h`, para não martelar uma fonte fora do ar.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import psycopg

from . import db

log = logging.getLogger("etl.schedule")

H = 1
D = 24
SCHEDULER_LOCK = "etl.scheduler"
ORPHAN_AFTER = timedelta(hours=1)

# Mesma régua de web/src/lib/sources.ts (SOURCE_META[*].maxAgeHours); test_schedule.py falha se divergir.
MAX_AGE_H: dict[str, int] = {
    "camara": 36,
    "senado": 36,
    "tse": 60 * D,
    "ibge": 400 * D,
    "alesp": 8 * D,
    "alemg": 8 * D,
    "sapl": 8 * D,
    "tcu": 35 * D,
    "ibge-sidra": 120 * D,
    "bcb-sgs": 120 * D,
    "receita-federal": 60 * D,
}


def _recent_election_years(today: date) -> list[int]:
    """Eleições cujo arquivo do TSE ainda muda (resultado, substituição, julgamento): a deste ano e a anterior."""
    last = today.year if today.year % 2 == 0 else today.year - 1
    return [last - 2, last]


def _years(flag: str, ys: list[int]) -> list[str]:
    return [x for y in ys for x in (flag, str(y))]


@dataclass(frozen=True)
class Task:
    name: str
    argv: Callable[[date], list[str]]
    prefixes: tuple[str, ...] | Callable[[date], tuple[str, ...]]  # datasets que a tarefa carimba (dataset like prefix || '%')
    every_h: int
    timeout_h: float
    people: bool = False  # mexe em pessoas/candidaturas/mandatos: pede identity.repairs depois
    needs_repairs: bool = False  # só roda se identity.repairs existir (a recarga do TSE depende dos reparos)
    retry_h: int = 0  # 0 = every_h / 4, entre 2 h e 24 h

    def families(self, today: date) -> tuple[str, ...]:
        return self.prefixes(today) if callable(self.prefixes) else self.prefixes

    def retry(self) -> int:
        return self.retry_h or min(24, max(2, self.every_h // 4))


# Ordem = ordem de execução. Cadência < maxAge do site, com folga para uma falha e uma nova tentativa.
TASKS: list[Task] = [
    Task("ibge.places", lambda t: ["ibge.places"], ("ibge.places",), 365 * D, 1),
    Task("ibge.populacao", lambda t: ["ibge.populacao"], ("ibge.populacao",), 365 * D, 1),
    Task("ibge.malhas", lambda t: ["ibge.malhas"], ("ibge.malhas",), 365 * D, 2),
    Task("tse.candidatos.recentes", lambda t: ["tse.candidatos", "--all", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.candidatos.{y}" for y in _recent_election_years(t)), 7 * D, 5, people=True, needs_repairs=True),
    Task("tse.votos", lambda t: ["tse.votos", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.votos.{y}" for y in _recent_election_years(t)), 30 * D, 4, people=True, needs_repairs=True),
    Task("tse.contas", lambda t: ["tse.contas", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.contas.{y}" for y in _recent_election_years(t)), 30 * D, 4, needs_repairs=True),
    Task("camara.diario", lambda t: ["camara.diario"], ("camara.deputados", "camara.votacoes.", "camara.proposicoes.", "camara.despesas."), 20 * H, 4, people=True),
    Task("camara.presenca", lambda t: ["camara.presenca"], ("camara.presenca.",), 20 * H, 2),
    Task("camara.equipe", lambda t: ["camara.equipe"], ("camara.equipe",), 7 * D, 2),
    Task("senado.diario", lambda t: ["senado.diario"], ("senado.senadores", "senado.votacoes.", "senado.despesas.", "senado.autorias"), 20 * H, 3, people=True),
    Task("senado.secretas", lambda t: ["senado.secretas", "--year", str(t.year)], ("senado.secretas.",), 20 * H, 1),
    Task("agenda.congresso", lambda t: ["agenda.congresso"], ("agenda.",), 20 * H, 1),
    Task("parlamento.extras", lambda t: ["parlamento.extras"], ("parlamento.extras",), 7 * D, 2),
    Task("ale.todas", lambda t: ["ale.todas", "--no-derive"], ("alesp.", "alemg."), 6 * D, 4),
    # SAPL: fila da própria job (nunca tentadas, depois a tentativa mais antiga); 150 por dia na descoberta e até 150 min de carga.
    # Incremental por cursor (~30 s por câmara já carregada); a 1ª carga de cada câmara é completa (~10 min).
    Task("sapl.todas", lambda t: ["sapl.todas", "--escopo", "todas", "--lote", "150", "--orcamento-min", "150"], ("sapl.",), 20 * H, 3),
    Task("sancoes.tcu", lambda t: ["sancoes.tcu"], ("sancoes.",), 28 * D, 1),
    Task("receita.arrecadacao", lambda t: ["receita.arrecadacao"], ("receita.",), 28 * D, 1),
    Task("governos.indicadores", lambda t: ["governos.indicadores"], ("governos.",), 80 * D, 1),
]


@dataclass
class Report:
    started_at: str
    ran: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    orphans: list[dict] = field(default_factory=list)
    overdue: list[dict] = field(default_factory=list)
    check_ok: bool | None = None
    finished_at: str | None = None

    @property
    def failed(self) -> list[dict]:
        return [r for r in self.ran if r["exit"] != 0]

    @property
    def alert(self) -> bool:
        return bool(self.failed or self.orphans or self.overdue or self.check_ok is False)

    def text(self) -> str:
        lines = [f"civico-etl run-due {self.started_at[:16]}Z: {len(self.ran)} tarefas, {len(self.failed)} falhas"]
        lines += [f"FALHOU {r['task']} (exit {r['exit']}, {r['secs']:.0f}s): {r['tail']}" for r in self.failed]
        lines += [f"RUN ÓRFÃO fechado: {o['dataset']} (iniciado {o['started_at'][:16]})" for o in self.orphans]
        lines += [f"FORA DO PRAZO {o['source']}: {o['age_h']:.0f} h > {o['max_h']} h" if o["age_h"] is not None else f"SEM CARGA {o['source']}" for o in self.overdue]
        if self.check_ok is False:
            lines.append("CHECK: invariantes quebradas (ver log)")
        return "\n".join(lines)


# ------------------------------------------------------------------ decisão (pura, testada)


def is_due(task: Task, last_stamp: datetime | None, last_attempt: datetime | None, now: datetime) -> tuple[bool, str]:
    if last_attempt and now - last_attempt < timedelta(hours=task.retry()):
        if not last_stamp or now - last_stamp >= timedelta(hours=task.every_h):
            return False, f"última tentativa há {(now - last_attempt).total_seconds() / 3600:.1f} h (< {task.retry()} h)"
    if last_stamp is None:
        return True, "nunca carregada"
    age = now - last_stamp
    if age >= timedelta(hours=task.every_h):
        return True, f"carimbo há {age.total_seconds() / 3600:.0f} h (>= {task.every_h} h)"
    return False, f"em dia (carimbo há {age.total_seconds() / 3600:.0f} h)"


def overdue_sources(stamps: dict[str, datetime | None], now: datetime) -> list[dict]:
    """Mesma regra de freshness() em sources.ts: sem carga é estado próprio; fora do prazo = idade > maxAge."""
    out = []
    for src, max_h in MAX_AGE_H.items():
        at = stamps.get(src)
        if at is None:
            out.append({"source": src, "age_h": None, "max_h": max_h})
            continue
        age_h = (now - at).total_seconds() / 3600
        if age_h > max_h:
            out.append({"source": src, "age_h": age_h, "max_h": max_h})
    return out


# ------------------------------------------------------------------ banco


def _like_any(prefixes: tuple[str, ...]) -> list[str]:
    return [p + "%" for p in prefixes]


def last_stamp(conn: psycopg.Connection, task: Task, today: date) -> datetime | None:
    """Carimbo da tarefa = o da família de datasets mais atrasada (cada prefixo pelo seu dataset mais novo).
    Com max() simples, a cota recém-carregada esconderia votações paradas há dias. Família sem carimbo = nunca carregada."""
    ats = []
    for p in task.families(today):
        r = conn.execute("select max(refreshed_at) as at from dataset_stamps where dataset like %s", (p + "%",)).fetchone()
        if r["at"] is None:
            return None
        ats.append(r["at"])
    return min(ats)


def last_attempt(conn: psycopg.Connection, task: Task, today: date) -> datetime | None:
    r = conn.execute("select max(started_at) as at from ingest_runs where dataset like any(%s)", (_like_any(task.families(today)),)).fetchone()
    return r["at"]


def source_stamps(conn: psycopg.Connection) -> dict[str, datetime | None]:
    rows = conn.execute("select s.slug, max(ds.refreshed_at) as at from sources s left join dataset_stamps ds on ds.source_id = s.id group by 1").fetchall()
    return {r["slug"]: r["at"] for r in rows}


def sweep_orphans(conn: psycopg.Connection, now: datetime) -> list[dict]:
    """Fecha como failed os runs `running` antigos cujo lock está livre. Lock ocupado = ainda rodando: não mexe."""
    rows = conn.execute(
        "select id, dataset, started_at from ingest_runs where status = 'running' and started_at < %s order by started_at", (now - ORPHAN_AFTER,)
    ).fetchall()
    closed = []
    for r in rows:
        got = conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (r["dataset"],)).fetchone()["ok"]
        if not got:
            continue
        conn.execute(
            "update ingest_runs set status = 'failed', finished_at = now(), error = coalesce(error || E'\\n', '') || 'run órfão: processo terminou sem fechar o run (fechado por run-due)' where id = %s and status = 'running'",
            (r["id"],),
        )
        conn.execute("select pg_advisory_unlock(hashtext(%s))", (r["dataset"],))
        closed.append({"id": str(r["id"]), "dataset": r["dataset"], "started_at": r["started_at"].isoformat()})
    return closed


def repairs_available() -> bool:
    try:
        from .jobs import repairs  # noqa: F401
    except ImportError:
        return False
    return hasattr(repairs, "run_identity_repairs")


# ------------------------------------------------------------------ execução


def _run_cli(args: list[str], timeout_h: float) -> dict:
    t0 = time.monotonic()
    cmd = [sys.executable, "-m", "civico_etl.cli", *args]
    log.info("→ %s", " ".join(args))
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_h * 3600)
        code, out = p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        code, out = 124, f"timeout após {timeout_h} h\n{(e.stdout or b'')!s}"[-4000:]
    sys.stdout.write(out)
    tail = " | ".join(l for l in out.strip().splitlines()[-3:])[:400]
    return {"args": args, "exit": code, "secs": time.monotonic() - t0, "tail": tail}


def notify(report: Report, state_dir: Path) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    payload = {**report.__dict__, "alert": report.alert, "failed": report.failed}
    (state_dir / "last-run.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    print(report.text())
    hook = os.environ.get("ETL_ALERT_WEBHOOK")
    if hook and report.alert:
        req = urllib.request.Request(hook, data=json.dumps({"text": report.text()}).encode(), headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=15).read()
        except Exception as e:  # noqa: BLE001 - alerta não derruba a rotina; fica no log e no last-run.json
            log.error("webhook de alerta falhou: %s", e)


def run_due(*, only: list[str] | None = None, dry_run: bool = False, force: bool = False, state_dir: Path | None = None) -> int:
    now = datetime.now(timezone.utc)
    rep = Report(started_at=now.isoformat())
    state_dir = state_dir or Path(os.environ.get("ETL_STATE_DIR", Path(__file__).resolve().parents[1] / ".state"))
    conn = db.connect()
    conn.commit()  # connect() abre transação com os SET; a agenda trabalha em autocommit (locks de sessão)
    conn.autocommit = True
    try:
        if not conn.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (SCHEDULER_LOCK,)).fetchone()["ok"]:
            log.warning("outro run-due em andamento; saindo")
            return 0
        if not dry_run:
            rep.orphans = sweep_orphans(conn, now)
        has_repairs = repairs_available()
        today = now.date()
        people_ran = any_ran = False
        for t in TASKS:
            if only and t.name not in only:
                continue
            if t.needs_repairs and not has_repairs:
                rep.skipped.append({"task": t.name, "why": "aguarda identity.repairs (a recarga do TSE depende dos reparos)"})
                continue
            due, why = (True, "forçada") if force else is_due(t, last_stamp(conn, t, today), last_attempt(conn, t, today), now)
            if not due:
                rep.skipped.append({"task": t.name, "why": why})
                continue
            if dry_run:
                rep.ran.append({"task": t.name, "args": t.argv(today), "exit": 0, "secs": 0, "tail": f"dry-run: {why}"})
                continue
            res = _run_cli(t.argv(today), t.timeout_h)
            rep.ran.append({"task": t.name, **res})
            any_ran = True
            people_ran |= t.people and res["exit"] == 0
        if not dry_run:
            if people_ran and has_repairs:
                rep.ran.append({"task": "identity.repairs", **_run_cli(["identity.repairs", "--apply"], 2)})
            if any_ran:
                rep.ran.append({"task": "derive.stats", **_run_cli(["derive.stats"], 2)})
            chk = _run_cli(["check"], 1)
            rep.check_ok = chk["exit"] == 0
            rep.overdue = overdue_sources(source_stamps(conn), datetime.now(timezone.utc))
    finally:
        conn.close()  # fecha a sessão e com ela o lock da agenda
    rep.finished_at = datetime.now(timezone.utc).isoformat()
    if dry_run:
        for r in rep.ran:
            print(f"rodaria {r['task']}: {' '.join(r['args'])}  ({r['tail']})")
        for s in rep.skipped:
            print(f"pula {s['task']}: {s['why']}")
        return 0
    notify(rep, state_dir)
    return 2 if rep.alert else 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl run-due", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=["run-due"])
    p.add_argument("--only", action="append", help="só esta tarefa (repetível); nomes em schedule.TASKS")
    p.add_argument("--dry-run", action="store_true", help="mostra o que rodaria e por quê; não roda nada nem fecha órfãos")
    p.add_argument("--force", action="store_true", help="roda as tarefas escolhidas mesmo em dia (use com --only)")
    a = p.parse_args(argv)
    if a.force and not a.only:
        p.error("--force exige --only")
    return run_due(only=a.only, dry_run=a.dry_run, force=a.force)
