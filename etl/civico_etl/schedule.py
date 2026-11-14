"""Agenda do ETL (D250): `civico-etl run-due` roda o que venceu, na ordem certa, e alerta o que ficou fora do prazo.

Pensado para ser chamado de hora em hora (launchd, cron ou GitHub Actions; ver etl/deploy/). Cada chamada:
  1. pega o lock global `etl.scheduler` (duas chamadas sobrepostas: a segunda sai sem fazer nada);
  2. fecha runs órfãos: `running` há mais de 1 h cujo advisory lock do dataset está livre (o processo morreu);
  3. roda as tarefas vencidas, cada uma num subprocesso com timeout, na ordem de TASKS; falha de uma não para as outras;
  4. se rodou carga de pessoas (TSE, Câmara, Senado), roda `identity.repairs --apply` e depois `derive.stats`;
  5. roda `check` (invariantes) e calcula as fontes fora do prazo com a mesma régua do site (MAX_AGE_H = sources.ts);
  6. alerta: resumo no stdout, JSON em ETL_STATE_DIR/last-run.json e, se ETL_ALERT_WEBHOOK existir, POST {"text": ...}.
     O alerta sai sempre, mesmo se a própria agenda quebrar no meio (finally).
ETL_DEADLINE_MIN (opcional): orçamento da chamada; tarefa que não cabe é adiada (reserva de RESERVE_MIN para o fim).
Saída de cada tarefa: ETL_STATE_DIR/logs/<job>.log (sobrevive a timeout).
Filtro por ambiente (D274): ETL_TASKS_EXCLUDE="a,b" tira tarefas desta chamada (o Actions não roda o SAPL das câmaras, que é do Mac); ETL_TASKS_INCLUDE="a,b"
roda só essas (o launchd do Mac roda só o SAPL das câmaras). Nome fora de TASKS é erro, não silêncio. A fonte (Task.source) de tarefa filtrada não
conta como "fora do prazo" no alerta daquela chamada: o frescor dela é de quem roda a tarefa, e o site e o vigia seguem acusando se envelhecer.
Saída: 0 tudo certo; 2 houve alerta (falha, check quebrado, fonte fora do prazo ou run órfão).

Janela horária (catálogo D06): tarefa com `window` vence dentro dela (hora de Brasília e dias da semana), e uma vez por janela: vencida =
janela aberta e sem carimbo da tarefa desde a abertura. Fora da janela `every_h` não vale. A única exceção é a reposição (D316): se a
janela mais recente fechou sem carimbo desde a abertura (o cron atrasou ou pulou o disparo), a tarefa vence na chamada seguinte. O carimbo
da reposição encerra; sem carimbo (fonte fora do ar, ou job que sai com 0 sem carimbar), tenta de novo só depois de REPOSICAO_RETRY_H.
A reposição só existe depois do fechamento, nunca antes da abertura (o CSV da Câmara ainda seria o da véspera). Quem decide se a janela
foi reposta é o carimbo, não o exit da tarefa: com carimbo novo ela sai do alerta e fica registrada ("JANELA REPOSTA"); sem ele, "JANELA PERDIDA" segue.
Chave de API ausente (`needs_env`): a tarefa é pulada com o motivo e a fonte sem carga não acusa "SEM CARGA" (aguarda a chave, catálogo D01).

Vencida = o carimbo mais novo dos datasets da tarefa (dataset_stamps; skipped_unchanged também carimba) é mais velho que
`every_h`, e a última tentativa (etl_schedule_attempts, qualquer desfecho) é mais velha que `retry_h`, para não martelar
uma fonte fora do ar.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .util import BRT

import psycopg
from psycopg.rows import dict_row

log = logging.getLogger("etl.schedule")

H = 1
D = 24
SCHEDULER_LOCK = "etl.scheduler"
DEDICATED_LOCK = "etl.scheduler.sapl"  # chamada dedicada (ETL_TASKS_INCLUDE): não disputa o lock do Actions, que não roda essas tarefas
ORPHAN_AFTER = timedelta(hours=1)
STUCK_AFTER = timedelta(hours=8)  # lock da agenda ocupado há mais que isso = agenda travada: alerta
REPOSICAO_RETRY_H = 6  # D316: nova tentativa de repor uma janela perdida. Mais largo que o tick (3 h): fonte fora do ar não vira uma tentativa por chamada
RESERVE_MIN = 45  # minutos guardados no fim para identity.repairs, derive.stats, check e alerta
# Datasets que carimbam sem trazer dado da casa (descoberta do SAPL): não contam como "fonte em dia".
NOT_FRESHNESS = ("sapl.descoberta", "sapl-ale.descoberta")

# Mesma régua de web/src/lib/sources.ts (SOURCE_META[*].maxAgeHours); test_schedule.py falha se divergir.
MAX_AGE_H: dict[str, int] = {
    "camara": 36,
    "senado": 36,
    "tse": 60 * D,
    "ibge": 400 * D,
    "alesp": 8 * D,
    "alemg": 8 * D,
    "sapl": 8 * D,
    "sapl-ale": 8 * D,  # catálogo D09
    "tcu": 35 * D,
    "ibge-sidra": 120 * D,
    "bcb-sgs": 120 * D,
    "receita-federal": 60 * D,
    "transparencia": 14 * D,  # catálogo D02: emendas, lidas toda semana
    "cgu": 14 * D,  # catálogo D03: CEIS e CNEP, lidos toda semana
}

# Fonte -> variável de ambiente sem a qual a carga não roda (catálogo D01). Sem a variável e sem carga alguma, a fonte "aguarda a chave" em vez de alertar.
SOURCE_ENV: dict[str, str] = {"transparencia": "TRANSPARENCIA_API_KEY", "cgu": "TRANSPARENCIA_API_KEY"}

# catálogo D13: de quanto em quanto tempo a agenda é chamada (cron do .github/workflows/etl.yml: minuto 17, a cada 3 h UTC). A "próxima leitura prevista"
# do site arredonda para o próximo desses momentos. web/src/lib/sources.ts repete as duas constantes; test_schedule.py confere as três réguas.
TICK_MINUTE = 17
TICK_EVERY_H = 3


def next_tick(t: datetime) -> datetime:
    """Primeiro momento de chamada da agenda em ou depois de `t` (UTC)."""
    c = t.astimezone(timezone.utc).replace(minute=TICK_MINUTE, second=0, microsecond=0)
    if c < t:
        c += timedelta(hours=1)
    while c.hour % TICK_EVERY_H:
        c += timedelta(hours=1)
    return c


def next_read(every_h: float, stamp: datetime, now: datetime) -> datetime:
    """Próxima leitura prevista de uma fonte de cadência `every_h` carimbada em `stamp`: carimbo + cadência, no próximo momento de
    chamada da agenda; se já passou, o próximo momento depois de agora. É um teto: tarefa que falha ou é adiada lê depois."""
    return next_tick(max(stamp + timedelta(hours=every_h), now))


@dataclass(frozen=True)
class Window:
    """Janela horária em Brasília [start, end), nos dias da semana `days` (0 = segunda). Sem horário de verão desde 2019."""

    start: dtime
    end: dtime
    days: tuple[int, ...]

    def opened_at(self, now: datetime) -> datetime | None:
        """Instante (UTC) em que a janela de agora abriu; None se agora está fora dela."""
        local = now.astimezone(BRT)
        if local.weekday() not in self.days:
            return None
        s, e = datetime.combine(local.date(), self.start, BRT), datetime.combine(local.date(), self.end, BRT)
        return s.astimezone(timezone.utc) if s <= local < e else None

    def last_closed(self, now: datetime) -> tuple[datetime, datetime] | None:
        """(abertura, fechamento) em UTC da janela mais recente que já fechou, olhando até 7 dias para trás (em Brasília); None se não houve.
        Sete dias cobrem qualquer conjunto de dias da semana: a janela de sábado segue visível no domingo e na segunda."""
        local = now.astimezone(BRT)
        for back in range(8):
            day = local.date() - timedelta(days=back)
            if day.weekday() not in self.days:
                continue
            s, e = datetime.combine(day, self.start, BRT), datetime.combine(day, self.end, BRT)
            if e <= local:
                return s.astimezone(timezone.utc), e.astimezone(timezone.utc)
        return None


TER_A_SAB = (1, 2, 3, 4, 5)


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
    missing_ok: bool = False  # família ainda sem carimbo não conta (arquivo da eleição deste ano ainda não publicado)
    derives: bool = False  # o próprio job já roda derive.stats (cli.py); a agenda não repete no fim
    window: Window | None = None  # catálogo D06: só vence dentro dela, uma vez por janela
    source: str | None = None  # chave de MAX_AGE_H que a tarefa alimenta (só onde é inequívoco); usada pelo filtro de tarefas (D274)
    needs_env: str | None = None  # catálogo D01: variável de ambiente (chave de API) sem a qual a tarefa é pulada, com o motivo

    def families(self, today: date) -> tuple[str, ...]:
        return self.prefixes(today) if callable(self.prefixes) else self.prefixes

    def retry(self) -> int:
        return self.retry_h or min(24, max(2, self.every_h // 4))


# Ordem = ordem de execução. Cadência < maxAge do site, com folga para uma falha e uma nova tentativa.
TASKS: list[Task] = [
    # catálogo D06: segunda leitura da noite, só das votações recentes (a agenda roda derive.stats depois). Primeiras da fila: uma chamada longa e
    # sobreposta (o lock global faz a seguinte sair sem fazer nada) é o risco que mais pode comê-las; elas são curtas.
    # Senado: API ao vivo, logo depois da meia-noite. Câmara: o CSV anual só é regerado entre 03:50 e 04:45 (Brasília; Last-Modified de
    # 04 e 08/11/2026), então a leitura da Câmara vem depois disso e antes das 07h.
    Task("senado.noturna", lambda t: ["senado.noturna"], ("senado.noturna.",), 24, 1, retry_h=1, window=Window(dtime(0, 30), dtime(2, 0), TER_A_SAB)),
    Task("camara.noturna", lambda t: ["camara.noturna"], ("camara.noturna.",), 24, 1, retry_h=1, window=Window(dtime(5, 0), dtime(7, 0), TER_A_SAB)),
    Task("ibge.places", lambda t: ["ibge.places"], ("ibge.places",), 365 * D, 1),
    Task("ibge.populacao", lambda t: ["ibge.populacao"], ("ibge.populacao",), 365 * D, 1),
    Task("ibge.malhas", lambda t: ["ibge.malhas"], ("ibge.malhas",), 365 * D, 2),
    Task("tse.candidatos.recentes", lambda t: ["tse.candidatos", "--all", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.candidatos.{y}" for y in _recent_election_years(t)), 7 * D, 5, people=True, needs_repairs=True, missing_ok=True, derives=True),
    Task("tse.votos", lambda t: ["tse.votos", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.votos.{y}" for y in _recent_election_years(t)), 30 * D, 4, people=True, needs_repairs=True, missing_ok=True, derives=True),
    Task("tse.contas", lambda t: ["tse.contas", *_years("--year", _recent_election_years(t))], lambda t: tuple(f"tse.contas.{y}" for y in _recent_election_years(t)), 30 * D, 4, needs_repairs=True, missing_ok=True, derives=True),
    Task("camara.diario", lambda t: ["camara.diario"], ("camara.deputados", "camara.votacoes.", "camara.proposicoes.", "camara.despesas."), 20 * H, 4, people=True, derives=True),
    Task("camara.presenca", lambda t: ["camara.presenca"], ("camara.presenca.",), 20 * H, 2, derives=True),
    Task("camara.equipe", lambda t: ["camara.equipe"], ("camara.equipe",), 7 * D, 2),
    Task("senado.diario", lambda t: ["senado.diario"], ("senado.senadores", "senado.votacoes.", "senado.despesas.", "senado.autorias"), 20 * H, 3, people=True, derives=True),
    Task("senado.secretas", lambda t: ["senado.secretas", "--year", str(t.year)], ("senado.secretas.",), 20 * H, 1),
    Task("agenda.congresso", lambda t: ["agenda.congresso"], ("agenda.",), 20 * H, 1),
    Task("parlamento.extras", lambda t: ["parlamento.extras"], ("parlamento.extras",), 7 * D, 2, derives=True),
    Task("ale.todas", lambda t: ["ale.todas", "--no-derive"], ("alesp.", "alemg."), 6 * D, 4),
    # SAPL só alimenta sapl_* e o site lê direto de lá: derive.stats não precisa rodar depois (derives=True), o que também deixa a chamada dedicada
    # do launchd (ETL_TASKS_INCLUDE, lock próprio) sem tocar em party_memberships enquanto o Actions roda (D274).
    # D09: 5 Assembleias com SAPL, uma tarefa própria (prefixo sapl-ale.) para a frescor não se misturar com a das câmaras. Cargas pequenas.
    Task("sapl.ales", lambda t: ["sapl.ales", "--workers", "5", "--casa-max-min", "40"], ("sapl-ale.",), 20 * H, 2, derives=True, source="sapl-ale"),
    # D08: SAPL das câmaras, fila da própria job (em dia primeiro, nunca tentadas depois; casa em backoff fica fora). Orçamento por chamada:
    # 150 min de carga, 4 câmaras em paralelo (hosts distintos; 1,1 s por host), prazo de 25 min por câmara, até 400 descobertas por dia e
    # até 300 câmaras "ok" ainda sem carga antes de pausar a descoberta. Incremental por cursor (~30 s por câmara já carregada); a 1ª carga é completa (~10 min).
    Task("sapl.todas", lambda t: ["sapl.todas", "--escopo", "todas", "--lote", "150", "--lote-descoberta", "400", "--max-pendentes", "300", "--orcamento-min", "150", "--workers", "4"], ("sapl.",), 20 * H, 3, derives=True, source="sapl"),
    Task("sancoes.tcu", lambda t: ["sancoes.tcu"], ("sancoes.",), 28 * D, 1),
    # catálogo D01–D03: API do Portal da Transparência com chave. Paginação inteira ao limite de requisições por minuto (transparencia.py).
    Task("transparencia.emendas", lambda t: ["transparencia.emendas"], ("transparencia.emendas.",), 7 * D, 3, needs_env="TRANSPARENCIA_API_KEY"),
    Task("sancoes.cgu", lambda t: ["sancoes.cgu"], ("cgu.ceis", "cgu.cnep"), 7 * D, 2, needs_env="TRANSPARENCIA_API_KEY"),
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

    missed: list[dict] = field(default_factory=list)  # S3-1/D257: janela fechou sem a tarefa rodar (e a reposição não leu)
    recovered: list[dict] = field(default_factory=list)  # D316: janela perdida que esta chamada leu fora de hora; registro, não alerta
    deferred: list[str] = field(default_factory=list)
    awaiting: list[str] = field(default_factory=list)  # fontes sem chave de API e sem carga: aguardam, não alertam
    partial: list[dict] = field(default_factory=list)  # runs que gravaram dado mas fecharam `partial` nesta chamada (db.Run.partial)
    error: str | None = None

    @property
    def alert(self) -> bool:
        return bool(self.failed or self.orphans or self.overdue or self.missed or self.partial or self.check_ok is False or self.error)

    def text(self) -> str:
        lines = [f"civico-etl run-due {self.started_at[:16]}Z: {len(self.ran)} tarefas, {len(self.failed)} falhas"]
        lines += [f"FALHOU {r['task']} (exit {r['exit']}, {r['secs']:.0f}s): {r['tail']}" for r in self.failed]
        lines += [f"PARCIAL {p['dataset']}: {p['why']}" for p in self.partial]
        lines += [f"RUN ÓRFÃO fechado: {o['dataset']} (iniciado {o['started_at'][:16]})" for o in self.orphans]
        lines += [f"FORA DO PRAZO {o['source']}: {o['age_h']:.0f} h > {o['max_h']} h" if o["age_h"] is not None else f"SEM CARGA {o['source']}" for o in self.overdue]
        lines += [f"JANELA PERDIDA {m['task']}: janela {m['opened'][:16]}Z-{m['closed'][:16]}Z fechou sem leitura" for m in self.missed]
        lines += [f"JANELA REPOSTA {m['task']}: janela {m['opened'][:16]}Z-{m['closed'][:16]}Z lida fora de hora nesta chamada (sem alerta)" for m in self.recovered]
        if self.awaiting:
            lines.append(f"aguardam chave de API (sem alerta): {', '.join(self.awaiting)}")
        if self.deferred:
            lines.append(f"adiadas por falta de tempo nesta chamada: {', '.join(self.deferred)}")
        if self.check_ok is False:
            lines.append("CHECK: invariantes quebradas (ver log)")
        if self.error:
            lines.append(f"ERRO DA AGENDA: {self.error}")
        return "\n".join(lines)


# ------------------------------------------------------------------ decisão (pura, testada)


def is_due(task: Task, last_stamp: datetime | None, last_attempt: datetime | None, now: datetime) -> tuple[bool, str]:
    if task.window:
        opened = task.window.opened_at(now)
        if opened is None:
            # reposição (D316): a janela mais recente fechou sem leitura; lê agora, fora de hora, em vez de esperar a próxima noite
            w = task.window.last_closed(now)
            if w is None or (last_stamp is not None and last_stamp >= w[0]):
                return False, "fora da janela horária"
            if last_attempt and last_attempt >= w[0] and now - last_attempt < timedelta(hours=REPOSICAO_RETRY_H):
                return False, f"reposição: última tentativa há {(now - last_attempt).total_seconds() / 3600:.1f} h (< {REPOSICAO_RETRY_H} h)"
            return True, f"reposição: a janela das {w[0].astimezone(BRT):%d/%m %H:%M} BRT fechou sem leitura"
        # "lida nesta janela" pede carimbo desde a abertura e, havendo tentativa registrada, que ela também tenha começado desde a abertura:
        # uma reposição da janela anterior que começa às 04:58 e carimba às 05:01 leu o CSV da véspera, não o desta janela
        if last_stamp and last_stamp >= opened and (last_attempt is None or last_attempt >= opened):
            return False, f"já lida nesta janela (carimbo {last_stamp.astimezone(BRT):%H:%M} BRT)"
        if last_attempt and last_attempt >= opened and now - last_attempt < timedelta(hours=task.retry()):
            return False, f"última tentativa há {(now - last_attempt).total_seconds() / 3600:.1f} h (< {task.retry()} h)"
        return True, f"janela aberta às {opened.astimezone(BRT):%H:%M} BRT e sem leitura nela"
    if last_attempt and now - last_attempt < timedelta(hours=task.retry()):
        if not last_stamp or now - last_stamp >= timedelta(hours=task.every_h):
            return False, f"última tentativa há {(now - last_attempt).total_seconds() / 3600:.1f} h (< {task.retry()} h)"
    if last_stamp is None:
        return True, "nunca carregada"
    age = now - last_stamp
    if age >= timedelta(hours=task.every_h):
        return True, f"carimbo há {age.total_seconds() / 3600:.0f} h (>= {task.every_h} h)"
    return False, f"em dia (carimbo há {age.total_seconds() / 3600:.0f} h)"


def missed_window(task: Task, last_stamp: datetime | None, now: datetime) -> dict | None:
    """Janela mais recente já fechada sem carimbo da tarefa dentro/depois dela (ex.: fila do Actions atrasou o run e a noite foi pulada)."""
    if not task.window:
        return None
    w = task.window.last_closed(now)
    if w is None or (last_stamp is not None and last_stamp >= w[0]):
        return None
    return {"task": task.name, "opened": w[0].isoformat(), "closed": w[1].isoformat()}


def settle_missed(missed: list[dict], still: set[str]) -> tuple[list[dict], list[dict]]:
    """(ainda perdidas, repostas). `missed` é calculada antes de as tarefas rodarem; `still` são as tarefas cuja janela continua sem carimbo
    depois delas (missed_window de novo, com o carimbo atual). Decide o carimbo, não o exit: job que sai com 0 sem carimbar (a Câmara devolve
    404 no CSV do ano em janeiro) não leu nada e segue em alerta. Reposta = lida nesta chamada, pela agenda ou por `--only … --force`."""
    return [m for m in missed if m["task"] in still], [m for m in missed if m["task"] not in still]


def filtered_sources(include: frozenset[str] | None, exclude: frozenset[str]) -> tuple[frozenset[str] | None, frozenset[str]]:
    """(só estas fontes | None, ignora estas) para o alerta de prazo, a partir do filtro de tarefas. Chamada dedicada (include) só responde
    pelas fontes das suas tarefas; tarefa excluída tira a própria fonte do alerta desta chamada."""
    only = None if include is None else frozenset(t.source for t in TASKS if t.name in include and t.source)
    return only, frozenset(t.source for t in TASKS if t.name in exclude and t.source)


def overdue_sources(stamps: dict[str, datetime | None], now: datetime, awaiting_key: frozenset[str] = frozenset(),
                    ignore: frozenset[str] = frozenset(), only: frozenset[str] | None = None) -> list[dict]:
    """Mesma regra de freshness() em sources.ts: sem carga é estado próprio; fora do prazo = idade > maxAge.
    `awaiting_key`: fontes sem chave de API configurada; sem carga nenhuma, não alertam (o `plan` já registra o motivo)."""
    out = []
    for src, max_h in MAX_AGE_H.items():
        if src in ignore or (only is not None and src not in only):
            continue
        at = stamps.get(src)
        if at is None:
            if src in awaiting_key:
                continue
            out.append({"source": src, "age_h": None, "max_h": max_h})
            continue
        age_h = (now - at).total_seconds() / 3600
        if age_h > max_h:
            out.append({"source": src, "age_h": age_h, "max_h": max_h})
    return out


# ------------------------------------------------------------------ banco


def _connect(url: str) -> psycopg.Connection:
    """Conexão curta, autocommit, com keepalive (a agenda passa horas esperando subprocessos)."""
    c = psycopg.connect(url, row_factory=dict_row, autocommit=True, keepalives=1, keepalives_idle=60, keepalives_interval=15, keepalives_count=4, connect_timeout=15)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    return c


def check_url(url: str) -> None:
    """Locks de sessão não valem atrás de pooler em modo transação (Supabase :6543): recusa em vez de rodar sem lock."""
    if re.search(r":6543(/|\?|$)", url) or "pgbouncer=true" in url:
        raise SystemExit("ETL_DATABASE_URL aponta para pooler em modo transação (porta 6543); use a conexão direta ou o pooler em modo sessão")


def last_stamp(conn: psycopg.Connection, task: Task, today: date, *, clean: bool = False) -> datetime | None:
    """Carimbo da tarefa = o da família de datasets mais atrasada (cada prefixo pelo seu dataset mais novo).
    `clean`: ignora carimbo deixado por run `partial`. É o que decide se a tarefa venceu: dado parcial não deixa a tarefa "em dia" pelo
    ciclo inteiro (até 80 dias), ela volta a rodar no intervalo de nova tentativa até fechar limpa. O frescor do site segue o carimbo real.
    Com max() simples, a cota recém-carregada esconderia votações paradas há dias. Família sem carimbo = nunca carregada,
    salvo `missing_ok` (eleição deste ano ainda sem arquivo no TSE), que só conta se nenhuma família tiver carimbo."""
    ats = []
    for p in task.families(today):
        r = conn.execute(
            "select max(s.refreshed_at) as at from dataset_stamps s where s.dataset like %s and s.dataset <> all(%s)"
            + (" and not exists (select 1 from ingest_runs r where r.id = s.last_run_id and r.status = 'partial')" if clean else ""),
            (p + "%", list(NOT_FRESHNESS)),
        ).fetchone()
        if r["at"] is None:
            if task.missing_ok:
                continue
            return None
        ats.append(r["at"])
    return min(ats) if ats else None


def last_attempt(conn: psycopg.Connection, task: Task) -> datetime | None:
    """Tentativa registrada pela própria agenda (vale mesmo se a fonte caiu antes de abrir run em ingest_runs)."""
    r = conn.execute("select attempted_at from etl_schedule_attempts where task = %s", (task.name,)).fetchone()
    return r["attempted_at"] if r else None


def mark_attempt(conn: psycopg.Connection, task: str, *, start: bool, exit_code: int | None = None, tail: str | None = None) -> None:
    if start:
        conn.execute(
            """insert into etl_schedule_attempts (task, attempted_at) values (%s, now())
               on conflict (task) do update set attempted_at = now(), finished_at = null, exit_code = null, tail = null""",
            (task,),
        )
    else:
        conn.execute("update etl_schedule_attempts set finished_at = now(), exit_code = %s, tail = %s where task = %s", (exit_code, tail, task))


def source_stamps(conn: psycopg.Connection) -> dict[str, datetime | None]:
    rows = conn.execute(
        "select s.slug, max(ds.refreshed_at) as at from sources s left join dataset_stamps ds on ds.source_id = s.id and ds.dataset <> all(%s) group by 1",
        (list(NOT_FRESHNESS),),
    ).fetchall()
    return {r["slug"]: r["at"] for r in rows}


def sweep_orphans(conn: psycopg.Connection, now: datetime) -> list[dict]:
    """Fecha como failed os runs `running` antigos cujo lock está livre. Lock ocupado = ainda rodando: não mexe.
    O job segura pg_advisory_lock(hashtext(dataset)) na própria sessão do começo ao fim do run (db.run)."""
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


def move_legacy_notes(conn: psycopg.Connection, like: str = "%") -> int:
    """Notas de run bem-sucedido que código anterior à migração 0131 ainda grava em `error` (o Mac do SAPL pode demorar a atualizar) passam
    para `notes`. Mesmo update do backfill da 0131; repetível. Sai quando nenhum processo antigo gravar mais."""
    return conn.execute(
        "update ingest_runs set notes = error, error = null where status = 'succeeded' and error is not null and notes is null and dataset like %s", (like,)
    ).rowcount


def partial_runs(conn: psycopg.Connection, invocation: str) -> list[dict]:
    """Runs `partial` abertos por esta chamada do run-due (ingest_runs.invocation). O subprocesso da tarefa sai com 0 (o dado entrou),
    então o alerta lê o banco. Pelo id da chamada entram todos os datasets que as tarefas gravaram, inclusive derive e reparos, e fica de
    fora o que outra chamada (Mac, D274) rodou no mesmo intervalo. Workflow fora do run-due (pauta, rascunho) não passa por aqui."""
    rows = conn.execute(
        "select dataset, error, started_at from ingest_runs where status = 'partial' and invocation = %s order by started_at", (invocation,)
    ).fetchall()
    return [{"dataset": r["dataset"], "why": (r["error"] or "sem motivo registrado").replace("\n", "; ")[:300], "started_at": r["started_at"].isoformat()} for r in rows]


def repairs_available() -> bool:
    try:
        from .jobs import repairs  # noqa: F401
    except ImportError:
        return False
    return hasattr(repairs, "run_identity_repairs")


# ------------------------------------------------------------------ execução


def task_timeout_h(task_h: float, elapsed_min: float, deadline_min: float | None) -> float | None:
    """Timeout efetivo: o da tarefa, cortado pelo que resta do prazo menos a reserva. None = não cabe, adiar."""
    if deadline_min is None:
        return task_h
    left = deadline_min - RESERVE_MIN - elapsed_min
    if left < 10:
        return None
    return min(task_h, left / 60)


def _run_cli(args: list[str], timeout_h: float, log_dir: Path) -> dict:
    """Subprocesso com saída em arquivo (sobrevive a timeout e à morte da agenda) e eco no stdout ao fim."""
    t0 = time.monotonic()
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"{args[0]}.log"
    log.info("→ %s (timeout %.1f h, log %s)", " ".join(args), timeout_h, path)
    with path.open("w") as fh:
        p = subprocess.Popen([sys.executable, "-m", "civico_etl.cli", *args], stdout=fh, stderr=subprocess.STDOUT)
        try:
            code = p.wait(timeout=timeout_h * 3600)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
            code = 124
    out = path.read_text(errors="replace")
    sys.stdout.write(out)
    lines = out.strip().splitlines()[-3:]
    if code == 124:
        lines = [f"timeout após {timeout_h:.1f} h"] + lines
    return {"args": args, "exit": code, "secs": time.monotonic() - t0, "tail": " | ".join(lines)[:400], "log": str(path)}


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


def env_ok(name: str) -> bool:
    """A chave existe no ambiente ou, para a do Portal da Transparência, no arquivo local fora do repositório (transparencia.api_key)."""
    if os.environ.get(name):
        return True
    if name == "TRANSPARENCIA_API_KEY":
        from . import transparencia

        try:
            transparencia.api_key()
            return True
        except transparencia.NoKey:
            return False
    return False


def awaiting_key_sources() -> frozenset[str]:
    return frozenset(src for src, env in SOURCE_ENV.items() if not env_ok(env))


def task_filter(env: dict[str, str] | None = None) -> tuple[frozenset[str] | None, frozenset[str]]:
    """(include, exclude) de ETL_TASKS_INCLUDE / ETL_TASKS_EXCLUDE (nomes separados por vírgula). include None = todas. Nome desconhecido: erro."""
    env = os.environ if env is None else env
    known = {t.name for t in TASKS}

    def parse(var: str) -> frozenset[str] | None:
        raw = (env.get(var) or "").strip()
        if not raw:
            return None
        names = frozenset(x.strip() for x in raw.split(",") if x.strip())
        bad = sorted(names - known)
        if bad:
            raise SystemExit(f"{var}: tarefa desconhecida {', '.join(bad)} (nomes em schedule.TASKS)")
        return names

    return parse("ETL_TASKS_INCLUDE"), parse("ETL_TASKS_EXCLUDE") or frozenset()


def plan(conn: psycopg.Connection, now: datetime, only: list[str] | None, force: bool, has_repairs: bool,
         include: frozenset[str] | None = None, exclude: frozenset[str] = frozenset()) -> tuple[list[tuple[Task, str]], list[dict]]:
    today = now.date()
    due, skipped = [], []
    for t in TASKS:
        if only and t.name not in only:
            continue
        if include is not None and t.name not in include:
            continue  # chamada dedicada a outras tarefas (launchd do SAPL): nem aparece como "pula"
        if t.name in exclude:
            skipped.append({"task": t.name, "why": "fora desta chamada (ETL_TASKS_EXCLUDE): roda em outro lugar"})
            continue
        if t.needs_repairs and not has_repairs:
            skipped.append({"task": t.name, "why": "aguarda identity.repairs (a recarga do TSE depende dos reparos)"})
            continue
        if t.needs_env and not env_ok(t.needs_env):
            skipped.append({"task": t.name, "why": f"aguarda {t.needs_env} (rode etl/deploy/transparencia-key.sh)"})
            continue
        ok, why = (True, "forçada") if force else is_due(t, last_stamp(conn, t, today, clean=True), last_attempt(conn, t), now)
        if ok:
            due.append((t, why))
        else:
            skipped.append({"task": t.name, "why": why})
    return due, skipped


def run_due(*, only: list[str] | None = None, dry_run: bool = False, force: bool = False, state_dir: Path | None = None) -> int:
    t0 = time.monotonic()
    now = datetime.now(timezone.utc)
    rep = Report(started_at=now.isoformat())
    state_dir = state_dir or Path(os.environ.get("ETL_STATE_DIR", Path(__file__).resolve().parents[1] / ".state"))
    log_dir = state_dir / "logs"
    deadline = float(os.environ["ETL_DEADLINE_MIN"]) if os.environ.get("ETL_DEADLINE_MIN") else None
    url = os.environ.get("ETL_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("defina ETL_DATABASE_URL")
    check_url(url)
    has_repairs = repairs_available()
    include, exclude = task_filter()
    only_src, ignore_src = filtered_sources(include, exclude)
    lock_name, attempt_key = (DEDICATED_LOCK, "__run_due__:dedicada") if include is not None else (SCHEDULER_LOCK, "__run_due__")

    if dry_run:  # sem lock: dá para olhar enquanto outra chamada roda
        with _connect(url) as c:
            due, skipped = plan(c, now, only, force, has_repairs, include, exclude)
        for t, why in due:
            print(f"rodaria {t.name}: {' '.join(t.argv(now.date()))}  ({why})")
        for s in skipped:
            print(f"pula {s['task']}: {s['why']}")
        return 0

    try:
        lock = _connect(url)  # sessão dedicada só ao lock da agenda; fechar a sessão solta o lock
    except psycopg.OperationalError as e:  # banco fora do ar também é alerta, não só traceback no log
        rep.error = f"banco inacessível: {e}"[:500]
        rep.finished_at = datetime.now(timezone.utc).isoformat()
        notify(rep, state_dir)
        return 2
    try:
        if not lock.execute("select pg_try_advisory_lock(hashtext(%s)) as ok", (lock_name,)).fetchone()["ok"]:
            r = lock.execute("select attempted_at from etl_schedule_attempts where task = %s", (attempt_key,)).fetchone()
            if r and now - r["attempted_at"] > STUCK_AFTER:
                rep.error = f"agenda travada: lock ocupado desde {r['attempted_at']:%d/%m %H:%M} UTC"
                notify(rep, state_dir)
                return 2
            log.warning("outro run-due em andamento; saindo")
            return 0
        people_ran = need_derive = False
        os.environ["ETL_INVOCATION"] = f"{now:%Y%m%dT%H%M%S}-{os.getpid()}"  # herdado pelos subprocessos das tarefas (db.invocation)
        try:
            with _connect(url) as c:
                mark_attempt(c, attempt_key, start=True)
                rep.orphans = sweep_orphans(c, now)
                try:
                    move_legacy_notes(c)
                except psycopg.Error as e:  # limpeza: não segura a agenda
                    log.warning("move_legacy_notes falhou: %s", e)
                due, rep.skipped = plan(c, now, only, force, has_repairs, include, exclude)
            today = now.date()
            for t in TASKS:
                if (not only or t.name in only) and (include is None or t.name in include) and t.name not in exclude and t.window and not (t.needs_env and not env_ok(t.needs_env)):
                    with _connect(url) as c:
                        m = missed_window(t, last_stamp(c, t, now.date()), now)
                    if m:
                        rep.missed.append(m)
            for t, why in due:
                to = task_timeout_h(t.timeout_h, (time.monotonic() - t0) / 60, deadline)
                if to is None:
                    rep.deferred.append(t.name)
                    continue
                with _connect(url) as c:
                    mark_attempt(c, t.name, start=True)
                res = _run_cli(t.argv(today), to, log_dir)
                with _connect(url) as c:
                    mark_attempt(c, t.name, start=False, exit_code=res["exit"], tail=res["tail"])
                rep.ran.append({"task": t.name, "why": why, **res})
                people_ran |= t.people and res["exit"] == 0
                need_derive |= not t.derives and res["exit"] == 0
            if rep.missed:  # depois das tarefas: o que ganhou carimbo desde a abertura da janela perdida deixa de ser alerta
                by = {t.name: t for t in TASKS}
                with _connect(url) as c:
                    still = {m["task"] for m in rep.missed if missed_window(by[m["task"]], last_stamp(c, by[m["task"]], today), now)}
                rep.missed, rep.recovered = settle_missed(rep.missed, still)
            if people_ran and has_repairs:
                rep.ran.append({"task": "identity.repairs", **_run_cli(["identity.repairs", "--apply"], 2, log_dir)})
                need_derive = True
            if need_derive:
                rep.ran.append({"task": "derive.stats", **_run_cli(["derive.stats"], 2, log_dir)})
            rep.check_ok = _run_cli(["check"], 1, log_dir)["exit"] == 0
            with _connect(url) as c:
                stamps, aw = source_stamps(c), awaiting_key_sources()
                rep.overdue = overdue_sources(stamps, datetime.now(timezone.utc), aw, ignore_src, only_src)
                rep.awaiting = sorted(src for src in aw if stamps.get(src) is None)
                rep.partial = partial_runs(c, os.environ["ETL_INVOCATION"])
                mark_attempt(c, attempt_key, start=False, exit_code=2 if rep.alert else 0)
        except Exception as e:  # noqa: BLE001 - a agenda sempre alerta, mesmo quando ela mesma quebra
            log.exception("run-due quebrou")
            rep.error = f"{type(e).__name__}: {e}"[:500]
        finally:
            rep.finished_at = datetime.now(timezone.utc).isoformat()
            notify(rep, state_dir)
    finally:
        lock.close()
    return 2 if rep.alert else 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="civico-etl run-due", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("job", choices=["run-due"])
    p.add_argument("--only", action="append", help="só esta tarefa (repetível); nomes em schedule.TASKS")
    p.add_argument("--dry-run", action="store_true", help="mostra o que rodaria e por quê; não roda nada, não pega lock nem fecha órfãos")
    p.add_argument("--force", action="store_true", help="roda as tarefas escolhidas mesmo em dia (use com --only)")
    a = p.parse_args(argv)
    if a.force and not a.only:
        p.error("--force exige --only")
    return run_due(only=a.only, dry_run=a.dry_run, force=a.force)
