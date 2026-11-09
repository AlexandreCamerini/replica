"""etl.rascunho: para cada proposta da pauta que passa na Regra 1, lê o inteiro teor e pede ao modelo as respostas.

Fonte: Câmara /proposicoes/{id} -> urlInteiroTeor (PDF). O id sai de pauta_items.proposal_url (idProposicao=).
Senado fica de fora na v1: a agenda das comissões não traz o código da matéria (ver 0008).
Saída: uma linha em answer_drafts com status 'rascunho'. Nada aqui publica; publicar é `civico-etl revisar`.

Custo: uma chamada por proposta nova ou por PDF novo (o mesmo PDF na mesma PROMPT_VERSION não é refeito).
D15: o bloco fixo (SYSTEM) vai com `cache_control`; com --batch a fila vai num lote da Message Batches API (50% do preço),
o run espera até --batch-wait-min e, no prazo, cancela o lote e rascunha o que faltou em modo síncrono. O id do lote fica em
`rascunho_batches`, e todo run começa coletando lote de run anterior que terminou depois. Recusa dentro do lote refaz a
proposta no síncrono, onde vale o modelo de reserva (a API não aceita `fallbacks` em lote).
Degradação: PDF sem texto (escaneado), recusa do modelo ou resposta cortada viram nota no run, e a proposta segue
"Aguardando revisão" no site. Credencial: a do ambiente (ANTHROPIC_API_KEY ou perfil do `ant auth login`).
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

import anthropic
import httpx
import psycopg
from pypdf import PdfReader

from .. import drafting
from ..db import run
from ..http import fetch, fetch_json

log = logging.getLogger("etl.rascunho")
CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
MAX_PAGES = 80  # acima disso (orçamento, códigos inteiros) a revisão humana não fecha; fica para leitura manual


def candidates(conn: psycopg.Connection, key: str | None) -> list[dict[str, Any]]:
    """Propostas da pauta vigente que passam na regra, uma por proposição, com o id da Câmara."""
    rows = conn.execute(
        """select distinct on (p.prop_type, p.prop_number, p.prop_year)
                  p.body_id, p.prop_type, p.prop_number, p.prop_year, p.summary_official, i.proposal_url
           from pauta_bolso p join pauta_items i on i.id = p.id
           where p.is_camara and i.proposal_url like '%%idProposicao=%%'
           order by p.prop_type, p.prop_number, p.prop_year, p.scheduled_for"""
    ).fetchall()
    out = []
    for r in rows:
        k = f"camara-{r['prop_type'].lower()}-{r['prop_number']}-{r['prop_year']}"
        if key and k != key:
            continue
        r = dict(r, key=k, camara_id=int(re.search(r"idProposicao=(\d+)", r["proposal_url"]).group(1)))
        out.append(r)
    return out


def _pages(pdf: bytes) -> list[str]:
    return [(p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages]



@dataclass
class Prep:
    """Proposta pronta para ir ao modelo: PDF baixado, texto extraído, checagens baratas feitas."""

    key: str
    label: str
    summary: str | None
    url: str
    sha: str
    pages: list[str]
    meta: dict[str, Any]  # body_id, prop_type, prop_number, prop_year (serializável: vai para rascunho_batches.items)
    force: bool = False  # --force: o resultado pago não pode ser descartado por `seen` em _finish (S3-3)
    prompt_version: int | None = None  # versão do prompt que gerou o pedido; None = a atual. Lote de run antigo carrega a sua (S4)


class PgStore:
    """Tudo o que o rascunho lê e grava no banco. Separado para o fluxo de lote ser testável sem Postgres."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self._wide: bool | None = None

    def wide(self) -> bool:
        """A migração 0090 (colunas de uso/custo) já foi aplicada? Sem ela o rascunho grava só o que gravava antes."""
        if self._wide is None:
            self._wide = bool(self.conn.execute("select 1 from information_schema.columns where table_name = 'answer_drafts' and column_name = 'cost_usd'").fetchone())
        return self._wide

    def seen(self, m: dict[str, Any], sha: str, prompt_version: int | None = None) -> bool:
        return bool(self.conn.execute(
            """select 1 from answer_drafts where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s
               and source_sha256 = %s and prompt_version = %s and status in ('rascunho', 'publicado')""",
            (m["body_id"], m["prop_type"], m["prop_number"], m["prop_year"], sha, prompt_version or drafting.PROMPT_VERSION),
        ).fetchone())

    def save(self, p: Prep, answers: dict[str, Any], checks: dict[str, Any], served_by: str, u: drafting.Usage, cost: float | None) -> None:
        m = p.meta
        # a fila mostra um rascunho por proposta: o anterior, ainda não revisado, sai com motivo
        self.conn.execute(
            """update answer_drafts set status = 'reprovado', review_note = 'trocado por rascunho mais novo'
               where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s and status = 'rascunho'""",
            (m["body_id"], m["prop_type"], m["prop_number"], m["prop_year"]),
        )
        cols = "body_id, prop_type, prop_number, prop_year, source_url, source_sha256, source_pages, model, prompt_version, answers, checks, input_tokens, output_tokens"
        vals: list[Any] = [m["body_id"], m["prop_type"], m["prop_number"], m["prop_year"], p.url, p.sha, len(p.pages), served_by, p.prompt_version or drafting.PROMPT_VERSION,
                           json.dumps(answers, ensure_ascii=False), json.dumps(checks, ensure_ascii=False), u.input, u.output]
        if self.wide():
            cols += ", cache_read_tokens, cache_creation_tokens, cost_usd, via_batch"
            vals += [u.cache_read, u.cache_create, cost, u.batch]
        self.conn.execute(f"insert into answer_drafts ({cols}) values ({', '.join(['%s'] * len(vals))})", vals)
        self.conn.commit()

    def open_batches(self) -> list[dict[str, Any]]:
        try:
            return list(self.conn.execute("select batch_id, model, prompt_version, items, extract(epoch from now() - created_at) / 3600 as age_h from rascunho_batches where status = 'enviado' order by created_at").fetchall())
        except psycopg.errors.UndefinedTable:  # 0090 ainda não aplicada
            self.conn.rollback()
            return []

    def register_batch(self, batch_id: str, model: str, items: dict[str, Any]) -> None:
        try:
            self.conn.execute("insert into rascunho_batches (batch_id, model, prompt_version, items) values (%s, %s, %s, %s) on conflict do nothing",
                              (batch_id, model, drafting.PROMPT_VERSION, json.dumps(items, ensure_ascii=False)))
            self.conn.commit()
        except psycopg.errors.UndefinedTable:
            self.conn.rollback()

    def close_batch(self, batch_id: str, status: str, note: str | None = None) -> None:
        try:
            self.conn.execute("update rascunho_batches set status = %s, note = %s, closed_at = now() where batch_id = %s", (status, note, batch_id))
            self.conn.commit()
        except psycopg.errors.UndefinedTable:
            self.conn.rollback()


@dataclass
class Tally:
    """Soma de uso do run, para a nota final: o custo por proposta fica visível sem abrir o banco."""

    n: int = 0
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_create: int = 0
    cost: float = 0.0
    unpriced: int = 0
    batched: int = 0

    def add(self, u: drafting.Usage, cost: float | None) -> None:
        self.n += 1
        self.input += u.input
        self.output += u.output
        self.cache_read += u.cache_read
        self.cache_create += u.cache_create
        self.batched += int(u.batch)
        if cost is None:
            self.unpriced += 1
        else:
            self.cost += cost

    def note(self) -> str:
        if not self.n:
            return ""
        priced = self.n - self.unpriced
        cost = f"custo estimado US$ {self.cost:.4f} (US$ {self.cost / priced:.4f} por proposta)" if priced else "custo não estimado (modelo fora da tabela)"
        aviso = " | AVISO: nenhum token passou pelo cache; o bloco fixo está abaixo do mínimo ou mudou entre chamadas" if self.cache_read == 0 and self.cache_create == 0 else ""
        return (f"uso: {self.n} rascunho(s), {self.batched} via lote; entrada {self.input}, cache lido {self.cache_read}, cache gravado {self.cache_create}, "
                f"saída {self.output}; {cost}{aviso}")


def _prepare(store: PgStore, c: dict[str, Any], r: Any, force: bool) -> Prep | None:
    """Baixa o inteiro teor e faz as checagens que não custam API. None = nada a rascunhar (motivo já no run)."""
    label = f"{c['prop_type']} {c['prop_number']}/{c['prop_year']}"
    try:
        url = fetch_json(f"{CAMARA}/proposicoes/{c['camara_id']}", max_age=86400)["dados"].get("urlInteiroTeor")
        if not url:
            r.reject(why=f"{label}: a Câmara não publica o inteiro teor")
            return None
        f = fetch(url, max_age=86400, accept="application/pdf")
    except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
        r.reject(why=f"{label}: inteiro teor não baixou ({x})")
        return None
    meta = {"body_id": str(c["body_id"]), "prop_type": c["prop_type"], "prop_number": c["prop_number"], "prop_year": c["prop_year"]}
    if not force and store.seen(meta, f.checksum):
        return None
    pages = _pages(f.path.read_bytes())
    if sum(len(p.strip()) for p in pages) < 200:
        r.reject(why=f"{label}: PDF sem texto extraível (escaneado?)")
        return None
    if len(pages) > MAX_PAGES:
        r.reject(why=f"{label}: {len(pages)} páginas, acima do limite de {MAX_PAGES}")
        return None
    return Prep(c["key"], label, c["summary_official"], url, f.checksum, pages, meta, force=force)


def _finish(store: PgStore, r: Any, tally: Tally, p: Prep, answers: dict[str, Any], u: drafting.Usage, served_by: str) -> None:
    """Único caminho que grava rascunho, síncrono ou vindo de lote: valida, grava e registra uso."""
    # lote cancelado que terminou depois do síncrono: não duplica. Com --force o resultado já foi pago: grava (save troca o rascunho anterior)
    if not p.force and store.seen(p.meta, p.sha, p.prompt_version):
        return
    answers, checks = drafting.validate(answers, p.pages)
    cost = drafting.estimate_cost(served_by, u)
    store.save(p, answers, checks, served_by, u, cost)
    tally.add(u, cost)
    r.add(1)
    log.info("%s: rascunho salvo (%d páginas, %d avisos bloqueantes, %s)", p.label, len(p.pages), len(drafting.blocking(checks, answers)), "lote" if u.batch else "síncrono")


def _sync_one(store: PgStore, r: Any, tally: Tally, client: Any, model: str, p: Prep) -> None:
    try:
        answers, u, served_by = draft_full(client, model, p.label, p.summary, p.pages)
    except DraftError as x:
        r.reject(why=f"{p.label}: {x}")
        return
    _finish(store, r, tally, p, answers, u, served_by)


class BatchCollectError(Exception):
    """A API falhou lendo os resultados do lote. `retry` = chaves que ainda não têm rascunho; o lote NÃO deve ser fechado."""

    def __init__(self, batch_id: str, retry: set[str], cause: Exception):
        super().__init__(f"lote {batch_id}: resultados não lidos por inteiro ({type(cause).__name__})")
        self.retry = retry


def collect_batch(client: Any, store: PgStore, r: Any, tally: Tally, batch_id: str, preps: dict[str, Prep]) -> set[str]:
    """Lê os resultados de um lote que terminou e grava pelo mesmo caminho do síncrono.
    Devolve as chaves que ficaram sem rascunho e merecem nova tentativa no síncrono (recusa, erro, expirado, sem resultado)."""
    retry = set(preps)
    try:
        for res in client.messages.batches.results(batch_id):
            p = preps.get(res.custom_id)
            if p is None:
                continue
            kind = res.result.type
            if kind != "succeeded":
                log.info("%s: lote devolveu %s; vai para o síncrono", p.label, kind)
                continue
            try:
                answers, u, served_by = parse_message(res.result.message, batch=True, cache_ttl="1h")
            except Refusal:
                continue  # só o síncrono tem modelo de reserva
            except DraftError as x:
                retry.discard(p.key)  # corte por tamanho / formato: o síncrono repetiria o mesmo resultado
                r.reject(why=f"{p.label}: {x}")
                continue
            retry.discard(p.key)
            _finish(store, r, tally, p, answers, u, served_by)
    except anthropic.APIError as x:  # leitura dos resultados caiu no meio: o que já foi gravado fica; o lote segue aberto
        raise BatchCollectError(batch_id, retry, x) from x
    return retry


def _prep_from_item(key: str, it: dict[str, Any], r: Any, prompt_version: int | None = None) -> Prep | None:
    """Refaz o Prep de um item de lote antigo a partir do que ficou em rascunho_batches (run que caiu antes de coletar)."""
    try:
        f = fetch(it["url"], max_age=86400, accept="application/pdf")
    except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
        r.reject(why=f"{it['label']}: lote antigo, PDF não baixou ({x})")
        return None
    if f.checksum != it["sha"]:
        r.notes.append(f"{it['label']}: o PDF mudou depois do envio do lote; resultado descartado")
        return None
    meta = {k: it[k] for k in ("body_id", "prop_type", "prop_number", "prop_year")}
    return Prep(key, it["label"], None, it["url"], it["sha"], _pages(f.path.read_bytes()), meta, prompt_version=prompt_version)


def recover_open(client: Any, store: PgStore, r: Any, tally: Tally, *, max_age_h: float = 25) -> set[str]:
    """Coleta lotes de runs anteriores. Devolve as chaves ainda em andamento (não reenviar)."""
    busy: set[str] = set()
    for b in store.open_batches():
        try:
            st = client.messages.batches.retrieve(b["batch_id"])
        except anthropic.APIError as x:
            r.notes.append(f"lote {b['batch_id']}: não consegui consultar ({x})")
            busy |= set(b["items"])
            continue
        if st.processing_status != "ended":
            if b["age_h"] > max_age_h:
                try:
                    client.messages.batches.cancel(b["batch_id"])
                except anthropic.APIError as x:  # segue 'enviado': o próximo run tenta de novo
                    r.notes.append(f"lote {b['batch_id']}: passou de {max_age_h:.0f} h mas o cancelamento falhou ({type(x).__name__}); tento no próximo run")
                    busy |= set(b["items"])
                    continue
                store.close_batch(b["batch_id"], "expirado", f"não terminou em {max_age_h:.0f} h")
                r.notes.append(f"lote {b['batch_id']}: cancelado por passar de {max_age_h:.0f} h")
            else:
                busy |= set(b["items"])
            continue
        # o lote grava com o prompt de quando foi enviado, não com o PROMPT_VERSION de hoje
        preps = {k: p for k, it in b["items"].items() if (p := _prep_from_item(k, it, r, b.get("prompt_version")))}
        try:
            collect_batch(client, store, r, tally, b["batch_id"], preps)
        except BatchCollectError as x:
            r.notes.append(f"{x}; fica aberto para o próximo run")
            busy |= set(b["items"])
            continue
        store.close_batch(b["batch_id"], "coletado")
        r.notes.append(f"lote {b['batch_id']} de run anterior coletado ({len(preps)} proposta(s))")
    return busy


def run_batch(client: Any, store: PgStore, r: Any, tally: Tally, model: str, preps: list[Prep], *, wait_s: float, poll_s: float = 30,
              sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> list[Prep]:
    """Envia as propostas num lote, espera até wait_s e coleta. Devolve as propostas que precisam do síncrono."""
    reqs = [{"custom_id": p.key, "params": drafting.request_params(model, p.label, p.summary, p.pages, ttl="1h")} for p in preps]
    try:
        b = client.messages.batches.create(requests=reqs)
    except anthropic.APIError as x:  # lote fora do ar ou requisição recusada: a fila não pode parar por isso
        r.notes.append(f"lote não enviado ({type(x).__name__}); {len(preps)} proposta(s) no síncrono")
        return preps
    items = {p.key: {**p.meta, "label": p.label, "url": p.url, "sha": p.sha} for p in preps}
    store.register_batch(b.id, model, items)
    deadline = clock() + wait_s
    cancelled = False
    errors = 0
    st = None
    while True:
        try:
            st = client.messages.batches.retrieve(b.id)
            errors = 0
        except anthropic.APIError as x:  # falha transitória de consulta: tolera algumas seguidas, depois cai no síncrono
            errors += 1
            if errors >= 3:
                r.notes.append(f"lote {b.id}: consulta falhou {errors}x seguidas ({type(x).__name__}); {len(preps)} proposta(s) no síncrono, lote fica aberto para o próximo run")
                return preps
            sleep(min(poll_s, 5))
            continue
        if st.processing_status == "ended":
            break
        if clock() >= deadline:
            if cancelled:
                break  # cancelamento pedido e a API ainda não fechou o lote
            try:
                client.messages.batches.cancel(b.id)
            except anthropic.APIError as x:
                r.notes.append(f"lote {b.id}: não terminou em {wait_s / 60:.0f} min e o cancelamento falhou ({type(x).__name__}); {len(preps)} proposta(s) no síncrono, lote fica aberto")
                return preps
            cancelled = True
            r.notes.append(f"lote {b.id} não terminou em {wait_s / 60:.0f} min; cancelado, o que faltou vai para o síncrono")
            deadline = clock() + 60  # tempo curto para o cancelamento fechar e liberar o que já estava pronto
        sleep(poll_s if not cancelled else min(poll_s, 5))
    if st.processing_status != "ended":  # cancelamento ainda em curso: nada a coletar agora, o lote fica aberto para o próximo run
        return preps
    try:
        retry = collect_batch(client, store, r, tally, b.id, {p.key: p for p in preps})
    except BatchCollectError as x:  # o que já gravou fica; o resto vai ao síncrono e o lote fica aberto
        r.notes.append(f"{x}; {len(x.retry)} proposta(s) no síncrono, lote fica aberto")
        return [p for p in preps if p.key in x.retry]
    store.close_batch(b.id, "cancelado" if cancelled else "coletado")
    return [p for p in preps if p.key in retry]


def run_rascunho(conn: psycopg.Connection, *, key: str | None = None, limit: int = 5, model: str | None = None, force: bool = False,
                 batch: bool = False, batch_wait_min: float | None = None, coletar: bool = False) -> None:
    model = model or os.environ.get("RASCUNHO_MODEL") or drafting.DEFAULT_MODEL
    wait_min = batch_wait_min if batch_wait_min is not None else float(os.environ.get("RASCUNHO_BATCH_WAIT_MIN", "20"))
    client = anthropic.Anthropic()
    store = PgStore(conn)
    tally = Tally()
    with run(conn, "rascunho", "camara", force=True) as r:
        busy = recover_open(client, store, r, tally)  # lote que terminou depois do run que o enviou
        if coletar:
            if tally.n:
                r.notes.append(tally.note())
            return
        preps: list[Prep] = []
        for c in candidates(conn, key):
            if len(preps) >= limit:
                r.notes.append(f"parou no limite de {limit}; rode de novo para o resto")
                break
            if c["key"] in busy:
                r.notes.append(f"{c['prop_type']} {c['prop_number']}/{c['prop_year']}: já está num lote em andamento")
                continue
            p = _prepare(store, c, r, force)
            if p:
                preps.append(p)
        todo = run_batch(client, store, r, tally, model, preps, wait_s=wait_min * 60) if batch and preps else preps
        for p in todo:
            _sync_one(store, r, tally, client, model, p)
        if tally.n:
            r.notes.append(tally.note())
            log.info(tally.note())


class DraftError(Exception):
    pass


class Refusal(DraftError):
    """Recusa por política. No lote não há modelo de reserva; no síncrono a API já tentou o reserva antes de devolver isto."""


def parse_message(resp: Any, *, batch: bool = False, cache_ttl: str = "5m") -> tuple[dict[str, Any], drafting.Usage, str]:
    """Resposta (síncrona ou de lote) -> (respostas, uso, modelo servido). Recusa, corte e formato inválido viram DraftError."""
    if resp.stop_reason == "refusal":
        cat = resp.stop_details.category if getattr(resp, "stop_details", None) else None
        raise Refusal(f"o modelo recusou ({cat})")
    if resp.stop_reason == "max_tokens":
        raise DraftError("resposta cortada pelo limite de tokens")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as x:
        raise DraftError("resposta fora do formato") from x
    errs = drafting.shape_errors(data)
    if errs:
        raise DraftError(f"resposta incompleta: {'; '.join(errs[:6])}")
    return data, drafting.Usage.from_api(resp.usage, batch=batch, cache_ttl=cache_ttl), resp.model


def draft_full(client: Any, model: str, label: str, summary: str | None, pages: list[str]) -> tuple[dict[str, Any], drafting.Usage, str]:
    """Uma chamada síncrona, saída presa ao schema, bloco fixo em cache."""
    try:
        resp = client.beta.messages.create(
            **drafting.request_params(model, label, summary, pages),
            # recusa por política: a API refaz no modelo de reserva dentro da mesma chamada
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as x:
        raise DraftError(f"limite de taxa da API ({x.status_code}); tente mais tarde") from x
    except anthropic.APIStatusError as x:
        raise DraftError(f"API respondeu {x.status_code}: {x.message}") from x
    except anthropic.APIConnectionError as x:
        raise DraftError("sem conexão com a API") from x
    return parse_message(resp)


def draft(client: anthropic.Anthropic, model: str, label: str, summary: str | None, pages: list[str]) -> tuple[dict[str, Any], tuple[int, int], str]:
    """Compatível com evals/rascunho_eval.py: o uso sai como (entrada, saída). Entrada inclui o que veio e foi para o cache."""
    data, u, served = draft_full(client, model, label, summary, pages)
    return data, (u.input + u.cache_read + u.cache_create, u.output), served
