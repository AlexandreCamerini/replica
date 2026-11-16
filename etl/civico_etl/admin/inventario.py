"""`civico-etl admin inventario` (A3): uma linha por (coletor, fonte) do catálogo, com o que o banco sabe de cada uma. Só leitura.

Fontes de cada coluna:
- catálogo (`civico_etl.catalogo.COLETORES`): fonte e origem, padrões de dataset, tarefas, orquestradores, variável de ambiente.
- `schedule.TASKS`: `Task.every_h` (prazo de revalidação), `retry_h`, janela. `schedule.MAX_AGE_H`: prazo de frescor do site.
- banco: `ingest_runs` (último run e datasets conhecidos, filtrados pela fonte da linha), `dataset_stamps` (carimbo), `etl_schedule_attempts`.
- frescor: `schedule.last_stamp` e `schedule.is_due`, as mesmas funções que `run-due` usa. A régua não é reimplementada aqui.

Estado (valor fechado; é do COLETOR e se repete nas linhas das suas fontes). Precedência, da primeira regra que vale:
  1. `sem_agenda`      o coletor não tem tarefa em `schedule.TASKS` (ex.: `pauta`, que roda em workflow próprio). A agenda não define prazo.
  2. `aguardando_chave` o coletor exige variável de ambiente (`Coletor.env`), ela está ausente e não há carimbo algum (mesma ideia de
                       `schedule.awaiting_key_sources`: sem chave e sem carga, aguarda em vez de alertar). A presença é lida SÓ do
                       ambiente; `schedule.env_ok` também lê o arquivo local de chave do Portal da Transparência, e este comando não lê
                       arquivo de chave. Logo, onde a chave só existe no arquivo, o inventário mostra `aguardando_chave` e a agenda não.
  3. `nunca_carregado` há tarefa e `last_stamp` não achou carimbo em nenhuma.
  4. `ultima_falhou`   o run mais recente (por `started_at`) entre os datasets do coletor, em qualquer fonte, tem status `failed`.
  5. `vencido`         alguma tarefa está vencida segundo `is_due(tarefa, last_stamp(clean=True), None, agora)`: ignora só o recuo por
                       tentativa recente, que é política de nova tentativa e não de frescor.
  6. `em_dia`          o resto.
`ultima_falhou` vem antes de `vencido` e de `em_dia` de propósito: dado velho com a última tentativa quebrada é o que pede olhar.

Valor desconhecido: `null` no JSON e a razão em `desconhecidos[campo]`; a tabela escreve "desconhecido: <razão>". Nunca zero.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

from .. import schedule
from ..catalogo import COLETORES, Coletor
from .saida import ErroAdmin

ESTADOS = ("sem_agenda", "aguardando_chave", "nunca_carregado", "ultima_falhou", "vencido", "em_dia")
LIMITE_DATASETS = 20  # datasets conhecidos listados por linha (o total vai em `conhecidos_total`)

_PLACEHOLDERS = {"ano": "[0-9]{4}", "ibge": "[0-9]{7}", "uf": "[a-z]{2}", "YYYYMMDD": "[0-9]{8}", "YYYYMM": "[0-9]{6}"}
_DIAS = ("seg", "ter", "qua", "qui", "sex", "sáb", "dom")


def regex_dataset(padrao: str) -> str:
    """Padrão do catálogo (`sapl.{ibge}`, `camara.votacoes.{ano}`) como regex ancorada, para `dataset ~ regex` no Postgres.
    Marcador desconhecido casa qualquer texto não vazio."""
    partes = re.split(r"(\{[^}]+\})", padrao)
    return "^" + "".join(_PLACEHOLDERS.get(p[1:-1], ".+") if p.startswith("{") else re.escape(p) for p in partes) + "$"


def regex_datasets(padroes: tuple[str, ...] | list[str]) -> str:
    return "^(" + "|".join(regex_dataset(p)[1:-1] for p in padroes) + ")$"


def _janela(t: schedule.Task) -> str | None:
    w = t.window
    if w is None:
        return None
    return f"{w.start:%H:%M}-{w.end:%H:%M} BRT ({','.join(_DIAS[d] for d in w.days)})"


def _tarefa(t: schedule.Task) -> dict[str, Any]:
    return {"nome": t.name, "every_h": t.every_h, "retry_h": t.retry(), "timeout_h": t.timeout_h, "janela": _janela(t), "needs_env": t.needs_env}


def _desfecho(r: dict[str, Any]) -> str:
    if r["finished_at"] is None:
        return "sem_fim_registrado"  # em andamento ou o processo morreu antes de fechar
    return "ok" if r["exit_code"] == 0 else "falhou"


def _datasets(conn: Any, slug: str, padroes: tuple[str, ...]) -> dict[str, Any]:
    rx = regex_datasets(padroes)
    runs = conn.execute(
        "select r.dataset, count(*) as runs from ingest_runs r join sources s on s.id = r.source_id where s.slug = %s and r.dataset ~ %s group by 1", (slug, rx)
    ).fetchall()
    stamps = conn.execute(
        "select ds.dataset, ds.refreshed_at from dataset_stamps ds join sources s on s.id = ds.source_id where s.slug = %s and ds.dataset ~ %s", (slug, rx)
    ).fetchall()
    por: dict[str, dict[str, Any]] = {r["dataset"]: {"dataset": r["dataset"], "runs": r["runs"], "carimbo_em": None} for r in runs}
    for s in stamps:
        por.setdefault(s["dataset"], {"dataset": s["dataset"], "runs": 0, "carimbo_em": None})["carimbo_em"] = s["refreshed_at"]
    todos = [por[k] for k in sorted(por)]
    return {"padroes": list(padroes), "conhecidos_total": len(todos), "conhecidos": todos[:LIMITE_DATASETS], "truncado": len(todos) > LIMITE_DATASETS}


def _ultimo_run(conn: Any, slug: str, padroes: tuple[str, ...]) -> dict[str, Any] | None:
    r = conn.execute(
        """select r.id, r.dataset, r.started_at, r.finished_at, r.status, r.rows_read, r.rows_upserted, r.rows_rejected, r.rows_deleted, r.invocation, r.error
           from ingest_runs r join sources s on s.id = r.source_id where s.slug = %s and r.dataset ~ %s order by r.started_at desc, r.id limit 1""",
        (slug, regex_datasets(padroes)),
    ).fetchone()
    if r is None:
        return None
    nulos = {}
    for campo in ("rows_read", "rows_deleted"):
        if r[campo] is None:
            nulos[campo] = "o job não informou"
    if r["invocation"] is None:
        nulos["invocation"] = "run aberto fora de uma chamada identificada"
    return {
        "id": str(r["id"]), "dataset": r["dataset"], "iniciado_em": r["started_at"], "finalizado_em": r["finished_at"], "status": r["status"],
        "linhas_lidas": r["rows_read"], "linhas_gravadas": r["rows_upserted"], "linhas_rejeitadas": r["rows_rejected"], "linhas_apagadas": r["rows_deleted"],
        "invocation": r["invocation"], "erro": (r["error"] or None) and r["error"][:300], "desconhecidos": nulos,
    }


def _tentativa(r: dict[str, Any] | None, tarefa: str) -> dict[str, Any] | None:
    if r is None:
        return None
    return {"tarefa": tarefa, "iniciada_em": r["attempted_at"], "finalizada_em": r["finished_at"], "exit_code": r["exit_code"], "desfecho": _desfecho(r), "tail": r["tail"]}


def _horas(a: datetime, b: datetime) -> float:
    return round((a - b).total_seconds() / 3600, 2)


def _base(conn: Any, c: Coletor, agora: datetime, ambiente: Any) -> dict[str, Any]:
    """Tudo que é do coletor (não da fonte): tarefas, carimbo, frescor, tentativa e estado SEM o último run (preenchido depois)."""
    por_nome = {t.name: t for t in schedule.TASKS}
    faltam = [n for n in c.tarefas if n not in por_nome]
    if faltam:
        raise ErroAdmin(f"coletor {c.id}: tarefa fora de schedule.TASKS: {faltam}")
    tarefas = [por_nome[n] for n in c.tarefas]
    today = agora.date()
    carimbos = [schedule.last_stamp(conn, t, today) for t in tarefas]
    limpos = [schedule.last_stamp(conn, t, today, clean=True) for t in tarefas]
    devidas = [(t, schedule.is_due(t, lp, None, agora)) for t, lp in zip(tarefas, limpos)]
    tent = {r["task"]: r for r in conn.execute("select task, attempted_at, finished_at, exit_code, tail from etl_schedule_attempts where task = any(%s)", (list(c.tarefas),)).fetchall()}
    tentativas = [_tentativa(tent.get(t.name), t.name) for t in tarefas]
    tentativa = max((x for x in tentativas if x), key=lambda x: x["iniciada_em"], default=None)
    presentes = [x for x in carimbos if x is not None]
    carimbo = min(presentes) if presentes else None  # a tarefa mais atrasada manda, como em last_stamp
    d: dict[str, Any] = {"nulos": {}}
    n = d["nulos"]
    d["tarefas"] = [_tarefa(t) for t in tarefas]
    d["tem_tarefa"] = bool(c.tarefas)
    d["tarefa"] = ", ".join(c.tarefas) if c.tarefas else None
    if not tarefas:
        d["prazo_revalidacao_h"] = None
        # nenhuma tarefa é um fato conhecido, não um valor desconhecido: `tem_tarefa` é false e a tabela escreve "sem tarefa na agenda"
        n["carimbo_em"] = n["idade_h"] = n["dentro_do_prazo"] = "sem tarefa: sem famílias de datasets"
        n["ultima_tentativa"] = "sem tarefa: a agenda não registra"
        d.update(carimbo_em=None, idade_h=None, dentro_do_prazo=None, ultima_tentativa=None)
    else:
        horas = sorted({t.every_h for t in tarefas})
        d["prazo_revalidacao_h"] = horas[0] if len(horas) == 1 else None
        if len(horas) > 1:
            n["prazo_revalidacao_h"] = "tarefas com prazos diferentes: ver `tarefas`"
        d["carimbo_em"] = carimbo
        d["idade_h"] = _horas(agora, carimbo) if carimbo else None
        if carimbo is None:
            n["carimbo_em"] = n["idade_h"] = "nenhum carimbo"
            d["dentro_do_prazo"] = None
            n["dentro_do_prazo"] = "sem carimbo"
        else:
            d["dentro_do_prazo"] = not any(due for _, (due, _) in devidas)
        d["ultima_tentativa"] = tentativa
        if tentativa is None:
            n["ultima_tentativa"] = "a agenda nunca tentou"
    d["devidas"] = [(t.name, why) for t, (due, why) in devidas if due]
    d["_carimbos"] = carimbos
    d["_tarefas"] = tarefas
    d["chave_ausente"] = bool(c.env) and not ambiente.get(c.env)
    return d


def _estado(c: Coletor, b: dict[str, Any], ultimo: dict[str, Any] | None) -> tuple[str, str]:
    if not c.tarefas:
        return "sem_agenda", f"sem tarefa em schedule.TASKS; orquestrador: {', '.join(c.orquestradores) or 'nenhum no catálogo'}"
    sem_carimbo = all(x is None for x in b["_carimbos"])
    if b["chave_ausente"] and sem_carimbo:
        return "aguardando_chave", f"{c.env} ausente do ambiente e nenhum carimbo (o arquivo local de chave não é lido por este comando)"
    if sem_carimbo:
        return "nunca_carregado", "nenhum carimbo em dataset_stamps para as famílias da tarefa"
    if ultimo is not None and ultimo["status"] == "failed":
        return "ultima_falhou", f"o run mais recente ({ultimo['dataset']}, {ultimo['iniciado_em'].isoformat()}) terminou failed"
    if b["devidas"]:
        return "vencido", "; ".join(f"{n}: {why}" for n, why in b["devidas"])
    return "em_dia", f"carimbo há {b['idade_h']:.0f} h, dentro do prazo de revalidação"


def inventario(conn: Any, *, agora: datetime | None = None, ambiente: Any = None) -> list[dict[str, Any]]:
    """Uma linha por (coletor, fonte) do catálogo, na ordem do catálogo. Só lê. `agora` e `ambiente` (padrão os.environ) são injetáveis."""
    agora = agora or datetime.now(timezone.utc)
    ambiente = os.environ if ambiente is None else ambiente
    fontes = {r["slug"]: r["url"] for r in conn.execute("select slug, url from sources").fetchall()}
    linhas: list[dict[str, Any]] = []
    for c in COLETORES:
        b = _base(conn, c, agora, ambiente)
        do_coletor: list[dict[str, Any]] = []
        for f in c.fontes:
            ultimo = _ultimo_run(conn, f.slug, c.datasets)
            nulos = dict(b["nulos"])
            maxh = schedule.MAX_AGE_H.get(f.slug)
            if maxh is None:
                nulos["prazo_frescor_site_h"] = "sem prazo em MAX_AGE_H"
            if ultimo is None:
                nulos["ultimo_run"] = "nenhum run nesta fonte"
            if f.slug not in fontes:
                nulos["fonte_url"] = "fonte ausente de sources"
            do_coletor.append({
                "coletor": c.id, "fonte": f.slug, "fonte_origem": f.origem, "fonte_url": fontes.get(f.slug),
                "datasets": _datasets(conn, f.slug, c.datasets),
                "tem_tarefa": b["tem_tarefa"], "tarefa": b["tarefa"], "tarefas": b["tarefas"], "prazo_revalidacao_h": b["prazo_revalidacao_h"], "prazo_frescor_site_h": maxh,
                "orquestradores": list(c.orquestradores), "chave_de_api": c.env or "nenhuma",  # nome da variável de ambiente exigida, ou "nenhuma" (valor conhecido, não nulo)
                "ultimo_run": ultimo, "ultima_tentativa": b["ultima_tentativa"],
                "carimbo_em": b["carimbo_em"], "idade_h": b["idade_h"], "dentro_do_prazo": b["dentro_do_prazo"],
                "estado": None, "estado_motivo": None, "desconhecidos": nulos,
            })
        runs = [l["ultimo_run"] for l in do_coletor if l["ultimo_run"]]
        ultimo_coletor = max(runs, key=lambda r: r["iniciado_em"], default=None)
        estado, motivo = _estado(c, b, ultimo_coletor)
        for l in do_coletor:
            l["estado"], l["estado_motivo"] = estado, motivo
        linhas += do_coletor
    return linhas


def filtrar(linhas: list[dict[str, Any]], *, coletor: str | None = None, fonte: str | None = None) -> list[dict[str, Any]]:
    ids = {c.id for c in COLETORES}
    slugs = {f.slug for c in COLETORES for f in c.fontes}
    if coletor and coletor not in ids:
        raise ErroAdmin(f"coletor desconhecido: {coletor!r} (conhecidos: {', '.join(sorted(ids))})")
    if fonte and fonte not in slugs:
        raise ErroAdmin(f"fonte desconhecida: {fonte!r} (conhecidas: {', '.join(sorted(slugs))})")
    return [l for l in linhas if (not coletor or l["coletor"] == coletor) and (not fonte or l["fonte"] == fonte)]


# ------------------------------------------------------------------ tabela

# Na tabela cada run aparece como status, horário e dataset; as contagens de linhas e a `invocation` ficam só no JSON (largura).
COLUNAS = (("coletor", "COLETOR"), ("fonte", "FONTE"), ("fonte_origem", "ORIGEM"), ("datasets", "DATASETS"), ("tarefa", "TAREFA"), ("prazo_revalidacao_h", "PRAZO_H"),
           ("prazo_frescor_site_h", "SITE_H"), ("orquestradores", "ORQUESTRADOR"), ("ultimo_run", "ÚLTIMO RUN"), ("ultima_tentativa", "ÚLTIMA TENTATIVA"),
           ("idade_h", "IDADE_H"), ("dentro_do_prazo", "NO PRAZO"), ("estado", "ESTADO"))


def _fmt_run(r: dict[str, Any]) -> str:
    return f"{r['status']} {r['iniciado_em']:%Y-%m-%d %H:%MZ} {r['dataset']}"


def _fmt_tentativa(t: dict[str, Any]) -> str:
    return f"{t['desfecho']} {t['iniciada_em']:%Y-%m-%d %H:%MZ}"


SEM_TAREFA = "sem tarefa na agenda"


def linhas_da_tabela(linhas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cópia das linhas para a tabela: onde não há tarefa, TAREFA e PRAZO_H dizem o fato ("sem tarefa na agenda"), não "desconhecido"."""
    return [{**l, "tarefa": SEM_TAREFA, "prazo_revalidacao_h": SEM_TAREFA} if not l["tem_tarefa"] else l for l in linhas]


def _fmt_datasets(d: dict[str, Any]) -> str:
    return f"{d['conhecidos_total']} conhecidos; {len(d['padroes'])} padrões"


FORMATOS = {"datasets": _fmt_datasets, "ultimo_run": _fmt_run, "ultima_tentativa": _fmt_tentativa, "idade_h": lambda v: f"{v:.0f}", "orquestradores": lambda v: ",".join(v)}


def total(linhas: list[dict[str, Any]]) -> str:
    """Linha final com denominador: coletores mostrados de todos os do catálogo, e a contagem por estado (por coletor, não por linha)."""
    por_coletor = {l["coletor"]: l["estado"] for l in linhas}
    cont = {e: sum(1 for s in por_coletor.values() if s == e) for e in ESTADOS}
    nomes = {"sem_agenda": "sem agenda", "aguardando_chave": "aguardando chave", "ultima_falhou": "com a última falha", "vencido": "vencidos", "em_dia": "em dia"}
    partes = [f"{cont['nunca_carregado']} nunca carregados"] + [f"{cont[e]} {nomes[e]}" for e in ESTADOS if e != "nunca_carregado" and cont[e]]
    return f"{len(por_coletor)} de {len(COLETORES)} coletores ({len(linhas)} linha(s) coletor/fonte); " + "; ".join(partes)
