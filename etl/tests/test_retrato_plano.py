"""R-6: retrato do plano da agenda. `schedule.plan()` com `now` fixo, filtros fixos e o mesmo estado de carimbos dá o mesmo plano.

O estado é fabricado dentro de uma transação que reverte (fixture `rw`): apaga dataset_stamps e etl_schedule_attempts da própria
transação, cria uma fonte de teste e insere os carimbos e tentativas abaixo. `plan` lê pela mesma conexão, então vê esse estado e
nenhum outro; last_stamp, last_attempt e is_due rodam de verdade. O que depende da máquina é fixado: env_ok devolve False (sem chave de
API, nem a do arquivo local) e as variáveis ETL_TASKS_* só entram pelo dicionário passado a task_filter.

O retrato (etl/tests/retratos/plano.json) foi gravado uma vez a partir do código de antes da reorganização e este teste só compara.
Para cada instante e cenário: tarefas na ordem em que `plan` as devolve (due, depois skipped), a situação, o motivo normalizado
(números e horas viram marcador) e o motivo bruto (determinístico, porque `now` é fixo); mais as tarefas ausentes do plano.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from civico_etl import schedule as S

RETRATO = Path(__file__).parent / "retratos" / "plano.json"

# quarta-feira 04/11/2026
INSTANTES = {
    "janela_camara_aberta": datetime(2026, 11, 4, 8, 30, tzinfo=timezone.utc),  # 05:30 BRT: janela da Câmara aberta, a do Senado já fechou
    "fora_de_janela": datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc),  # 12:00 BRT: as duas fechadas (reposição)
    "domingo": datetime(2026, 11, 8, 8, 30, tzinfo=timezone.utc),  # dia fora de TER_A_SAB
}
REF = INSTANTES["janela_camara_aberta"]  # os carimbos são fixados em relação a este instante


def h(horas: float) -> datetime:
    return REF - timedelta(hours=horas)


# dataset -> carimbo (família recente, vencida e ausente; as ausentes não aparecem aqui)
CARIMBOS = {
    "camara.deputados": h(5),
    "camara.votacoes.2026": h(30),  # vencida (camara.diario: 20 h)
    "camara.proposicoes.2026": h(6),
    "camara.despesas.2026": h(7),
    "camara.presenca.2026": h(2),  # em dia
    "camara.equipe": h(8 * 24),  # vencida (7 dias)
    "camara.noturna.2026": h(24),  # de ontem: janela de hoje ainda sem leitura
    "senado.noturna.2026": h(60),  # janela do Senado de hoje fechou sem leitura (reposição)
    "ibge.places": h(10 * 24),  # em dia (365 dias)
    "tse.candidatos.2024": h(30 * 24),  # vencida (7 dias); a de 2026 não existe (missing_ok)
    "tse.contas.2024": h(24),  # em dia (30 dias)
    "alesp.deputados": h(24),
    "alemg.deputados": h(8 * 24),  # vencida: família mais atrasada (6 dias)
    "sapl.camaras": h(24),
    "sapl.descoberta": h(1),  # NOT_FRESHNESS: não conta
    "sapl-ale.casas": h(30),  # vencida, mas com tentativa recente (espera o retry)
    "sancoes.tcu": h(10 * 24),  # em dia (28 dias)
    "governos.ibge": h(100 * 24),  # vencida (80 dias)
    "parlamento.extras": h(24),
}
# tarefa -> início da última tentativa
TENTATIVAS = {
    "camara.noturna": REF - timedelta(minutes=20),  # janela aberta, tentativa recente: espera
    "sapl.ales": h(1),
    "senado.diario": h(1),  # nunca carimbada, tentativa recente: espera
    "governos.indicadores": h(50),  # tentativa antiga: não segura
}

CENARIOS = {
    "sem_filtro": dict(env={}, only=None, force=False, has_repairs=True),
    "include_sapl_todas": dict(env={"ETL_TASKS_INCLUDE": "sapl.todas"}, only=None, force=False, has_repairs=True),
    "exclude_sapl_todas": dict(env={"ETL_TASKS_EXCLUDE": "sapl.todas"}, only=None, force=False, has_repairs=True),
    "include_e_exclude": dict(env={"ETL_TASKS_INCLUDE": "sapl.todas,sapl.ales,ale.todas", "ETL_TASKS_EXCLUDE": "sapl.todas"}, only=None, force=False, has_repairs=True),
    "only_camara_diario": dict(env={}, only=["camara.diario"], force=False, has_repairs=True),
    "only_camara_diario_force": dict(env={}, only=["camara.diario"], force=True, has_repairs=True),
    "only_tse_force_sem_repairs": dict(env={}, only=["tse.votos", "camara.equipe"], force=True, has_repairs=False),
    "sem_repairs": dict(env={}, only=None, force=False, has_repairs=False),
}

_DATA_HORA = re.compile(r"\d{2}/\d{2} \d{2}:\d{2}")
_HORA = re.compile(r"\d{2}:\d{2}")
_NUM = re.compile(r"\d+(?:\.\d+)?")


def normaliza(motivo: str) -> str:
    """Troca data/hora e números por marcador: o motivo continua distinguível (qual regra), mas não depende de quando roda."""
    return _NUM.sub("<n>", _HORA.sub("<hora>", _DATA_HORA.sub("<data-hora>", motivo)))


def monta_estado(c) -> None:
    c.execute("delete from dataset_stamps")
    c.execute("delete from etl_schedule_attempts")
    src = c.execute("insert into sources (slug, name, url) values ('r6.teste', 'R-6 teste', 'https://r6.invalid') returning id").fetchone()["id"]
    for dataset, at in CARIMBOS.items():
        c.execute("insert into dataset_stamps (dataset, source_id, refreshed_at) values (%s, %s, %s)", (dataset, src, at))
    for task, at in TENTATIVAS.items():
        c.execute("insert into etl_schedule_attempts (task, attempted_at) values (%s, %s)", (task, at))


def retrato(c, monkeypatch) -> dict:
    monkeypatch.setattr(S, "env_ok", lambda name: False)
    out = {}
    for inst, now in INSTANTES.items():
        for nome, cen in CENARIOS.items():
            include, exclude = S.task_filter(cen["env"])
            due, skipped = S.plan(c, now, cen["only"], cen["force"], cen["has_repairs"], include, exclude)
            itens = [{"tarefa": t.name, "situacao": "due", "motivo": normaliza(why), "motivo_bruto": why} for t, why in due]
            itens += [{"tarefa": s["task"], "situacao": "skipped", "motivo": normaliza(s["why"]), "motivo_bruto": s["why"]} for s in skipped]
            presentes = {i["tarefa"] for i in itens}
            out[f"{inst} | {nome}"] = {"plano": itens, "ausentes": [t.name for t in S.TASKS if t.name not in presentes]}
    return out


def contagens(conn) -> tuple[int, int, int]:
    return tuple(conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in ("dataset_stamps", "etl_schedule_attempts", "sources"))


def test_plano_igual_ao_retrato(conn, rw, monkeypatch):
    antes = contagens(conn)
    monta_estado(rw)
    atual = retrato(rw, monkeypatch)
    rw.rollback()
    assert contagens(conn) == antes  # outra conexão: nada vazou do estado fabricado
    esperado = json.loads(RETRATO.read_text())
    assert atual == esperado


def test_retrato_cobre_o_estado_variado(conn, rw, monkeypatch):
    """Guarda do próprio retrato: o estado fabricado exercita due, skipped, ausente, reposição, janela aberta e tentativa que bloqueia."""
    monta_estado(rw)
    atual = retrato(rw, monkeypatch)
    rw.rollback()
    sem = atual["janela_camara_aberta | sem_filtro"]
    por = {i["tarefa"]: i for i in sem["plano"]}
    assert por["camara.diario"]["situacao"] == "due" and por["camara.diario"]["motivo"] == "carimbo há <n> h (>= <n> h)"
    assert por["camara.presenca"]["motivo"] == "em dia (carimbo há <n> h)"
    assert por["camara.noturna"]["motivo"].startswith("última tentativa há <n> h")  # janela aberta + tentativa recente
    assert por["senado.noturna"]["motivo"].startswith("reposição:")
    assert por["senado.diario"]["motivo"] == "última tentativa há <n> h (< <n> h)"
    assert por["tse.votos"]["motivo"] == "nunca carregada"
    assert por["transparencia.emendas"]["situacao"] == "skipped" and "TRANSPARENCIA_API_KEY" in por["transparencia.emendas"]["motivo"]
    assert atual["janela_camara_aberta | only_camara_diario"]["ausentes"] and len(atual["janela_camara_aberta | include_sapl_todas"]["plano"]) == 1
    assert {i["situacao"] for i in sem["plano"]} == {"due", "skipped"}
    assert S.TASKS and len(sem["plano"]) + len(sem["ausentes"]) == len(S.TASKS)
