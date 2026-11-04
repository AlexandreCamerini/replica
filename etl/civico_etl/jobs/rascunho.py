"""etl.rascunho: para cada proposta da pauta que passa na Regra 1, lê o inteiro teor e pede ao modelo as respostas.

Fonte: Câmara /proposicoes/{id} -> urlInteiroTeor (PDF). O id sai de pauta_items.proposal_url (idProposicao=).
Senado fica de fora na v1: a agenda das comissões não traz o código da matéria (ver 0008).
Saída: uma linha em answer_drafts com status 'rascunho'. Nada aqui publica; publicar é `civico-etl revisar`.

Custo: uma chamada por proposta nova ou por PDF novo (o mesmo PDF na mesma PROMPT_VERSION não é refeito).
Degradação: PDF sem texto (escaneado), recusa do modelo ou resposta cortada viram nota no run, e a proposta segue
"Aguardando revisão" no site. Credencial: a do ambiente (ANTHROPIC_API_KEY ou perfil do `ant auth login`).
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
from typing import Any

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


def run_rascunho(conn: psycopg.Connection, *, key: str | None = None, limit: int = 5, model: str | None = None, force: bool = False) -> None:
    model = model or os.environ.get("RASCUNHO_MODEL", drafting.DEFAULT_MODEL)
    client = anthropic.Anthropic()
    with run(conn, "rascunho", "camara", force=True) as r:
        done = 0
        for c in candidates(conn, key):
            if done >= limit:
                r.notes.append(f"parou no limite de {limit}; rode de novo para o resto")
                break
            label = f"{c['prop_type']} {c['prop_number']}/{c['prop_year']}"
            try:
                url = fetch_json(f"{CAMARA}/proposicoes/{c['camara_id']}", max_age=86400)["dados"].get("urlInteiroTeor")
                if not url:
                    r.reject(why=f"{label}: a Câmara não publica o inteiro teor")
                    continue
                f = fetch(url, max_age=86400, accept="application/pdf")
            except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
                r.reject(why=f"{label}: inteiro teor não baixou ({x})")
                continue
            sha = f.checksum
            seen = conn.execute(
                """select 1 from answer_drafts where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s
                   and source_sha256 = %s and prompt_version = %s and status in ('rascunho', 'publicado')""",
                (c["body_id"], c["prop_type"], c["prop_number"], c["prop_year"], sha, drafting.PROMPT_VERSION),
            ).fetchone()
            if seen and not force:
                continue
            pages = _pages(f.path.read_bytes())
            if sum(len(p.strip()) for p in pages) < 200:
                r.reject(why=f"{label}: PDF sem texto extraível (escaneado?)")
                continue
            if len(pages) > MAX_PAGES:
                r.reject(why=f"{label}: {len(pages)} páginas, acima do limite de {MAX_PAGES}")
                continue
            try:
                answers, usage = draft(client, model, label, c["summary_official"], pages)
            except DraftError as x:
                r.reject(why=f"{label}: {x}")
                continue
            answers, checks = drafting.validate(answers, pages)
            # a fila mostra um rascunho por proposta: o anterior, ainda não revisado, sai com motivo
            conn.execute(
                """update answer_drafts set status = 'reprovado', review_note = 'trocado por rascunho mais novo'
                   where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s and status = 'rascunho'""",
                (c["body_id"], c["prop_type"], c["prop_number"], c["prop_year"]),
            )
            conn.execute(
                """insert into answer_drafts (body_id, prop_type, prop_number, prop_year, source_url, source_sha256, source_pages,
                                              model, prompt_version, answers, checks, input_tokens, output_tokens)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (c["body_id"], c["prop_type"], c["prop_number"], c["prop_year"], url, sha, len(pages), model, drafting.PROMPT_VERSION,
                 json.dumps(answers, ensure_ascii=False), json.dumps(checks, ensure_ascii=False), usage[0], usage[1]),
            )
            conn.commit()
            r.add(1)
            done += 1
            log.info("%s: rascunho salvo (%d páginas, %d avisos bloqueantes)", label, len(pages), len(drafting.blocking(checks, answers)))


class DraftError(Exception):
    pass


def draft(client: anthropic.Anthropic, model: str, label: str, summary: str | None, pages: list[str]) -> tuple[dict[str, Any], tuple[int, int]]:
    """Uma chamada, saída presa ao schema. Recusa e corte por tamanho viram DraftError, nunca resposta parcial."""
    try:
        resp = client.beta.messages.create(
            model=model,
            max_tokens=16000,
            system=drafting.SYSTEM,
            messages=[{"role": "user", "content": drafting.user_message(label, summary, pages)}],
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": drafting.SCHEMA}},
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
    if resp.stop_reason == "refusal":
        cat = resp.stop_details.category if resp.stop_details else None
        raise DraftError(f"o modelo recusou ({cat})")
    if resp.stop_reason == "max_tokens":
        raise DraftError("resposta cortada pelo limite de tokens")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as x:
        raise DraftError("resposta fora do formato") from x
    return data, (resp.usage.input_tokens, resp.usage.output_tokens)
