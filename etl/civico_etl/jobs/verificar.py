"""etl.verificar: agentes independentes conferem o rascunho e o árbitro decide publicar, marcar campos ou barrar.

Substitui a aprovação humana do `civico-etl revisar` (D293, replica/verificacao-agentica.md v2).

  civico-etl verificar                    # fila: rascunhos esperando verificação
  civico-etl verificar --limit 5          # verifica até 5
  civico-etl verificar camara-pl-79-2020  # verifica uma proposta
  civico-etl verificar --force            # refaz mesmo o que já foi ensaiado nesta versão dos verificadores

DOIS MODOS. Por padrão roda em ENSAIO: chama os agentes, grava o relatório no rascunho e NÃO muda o status.
A decisão só é aplicada (publicado ou barrado) com DUAS chaves: VERIFICACAO_AGENTICA=on no ambiente E a linha
'verificacao_agentica' = 'on' em pipeline_switches. A linha do banco só deve ser gravada depois de:
  1. a migração 0130 aplicada;
  2. o site sabendo mostrar os três estados por campo (hoje ele mostraria "O texto não diz" para um campo não conferido);
  3. a barra de avaliação da seção 10 da especificação medida e registrada em replica/decisions.md.

Custo: por proposta, uma chamada de sustentação, uma do contraditor (lê o inteiro teor), uma do leitor e uma do juiz.
Degradação:
  - falha transitória (limite de taxa, conexão, 5xx, resposta cortada): a proposta fica na fila e ganha uma marca de
    tentativa; com MAX_TRIES marcas ela é pulada até alguém rodar com --force. Duas falhas seguidas encerram o run.
  - a API recusou a requisição (4xx: chave, crédito, modelo, tamanho): o run para e NADA é gravado. É problema nosso,
    não da proposta, e barrar a fila inteira por isso seria irreversível.
  - recusa do modelo ou resposta fora do esquema: agente sem resposta, a proposta é barrada.
Os verificadores rodam SEM modelo de reserva: um reserva poderia ser o mesmo modelo do redator, e a independência é regra do árbitro.
"""

from __future__ import annotations

import io
import re
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

import anthropic
import httpx
import psycopg
from pypdf import PdfReader

from .. import drafting, verification as V
from ..db import run
from ..http import fetch

log = logging.getLogger("etl.verificar")
MAX_PAGES = 80  # o mesmo teto do rascunho
MAX_TRIES = 3  # falhas transitórias por rascunho antes de ele ser pulado
SWITCH = "verificacao_agentica"


class AgentFailed(Exception):
    """O agente respondeu, mas a resposta não serve (recusa, corte, formato). Conta como agente sem resposta: barra."""


class Transient(Exception):
    """A API não respondeu agora (ou cortou a resposta). A proposta fica na fila, com uma marca de tentativa."""


class Changed(Exception):
    """O rascunho mudou de estado durante a verificação: esta proposta sai da fila deste run, o resto segue."""


class Fatal(Exception):
    """A API recusou a requisição (4xx). O defeito é da nossa configuração: o run para e nada é gravado."""


def _pages(pdf: bytes) -> list[str]:
    return [(p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages]


_WHITE = 0.85  # quase branco também some no papel; o erro seguro é barrar


def _blank_fill(op: str, args: list[Any]) -> bool | None:
    """A cor de preenchimento que este operador define é (quase) branca? None = o operador não define cor que saibamos ler."""
    try:
        v = [float(x) for x in args]
    except (TypeError, ValueError):
        return None  # padrão ou espaço de cor nomeado
    if op == "g" or (op in ("sc", "scn") and len(v) == 1):
        return v[0] >= _WHITE
    if op == "rg" or (op in ("sc", "scn") and len(v) == 3):
        return all(x >= _WHITE for x in v)
    if op == "k" or (op in ("sc", "scn") and len(v) == 4):
        return all(x <= 1 - _WHITE for x in v)
    return None


def _scan(pdf: bytes) -> tuple[list[str], int] | None:
    """(texto visível por página, quantas vezes o PDF escreve texto que o leitor não vê). None = não deu para medir.

    Invisível = corpo menor que 4 pt, fora da área da página (contando a matriz `cm`), modo de texto 3 ou 7 (sem tinta),
    ou preenchimento branco. Branco sobre fundo escuro também cai aqui: o erro seguro é barrar um PDF legítimo."""
    out: list[str] = []
    hidden = 0
    try:
        for page in PdfReader(io.BytesIO(pdf)).pages:
            box = page.mediabox
            x0, y0, x1, y1 = float(box.left), float(box.bottom), float(box.right), float(box.top)
            parts: list[str] = []
            state = {"white": False, "mode": 0, "tz": 100.0}
            try:
                gstates = page["/Resources"]["/ExtGState"]
            except Exception:  # noqa: BLE001 - página sem ExtGState
                gstates = {}
            stack: list[dict[str, Any]] = []
            n = [0]

            def before(op: Any, args: Any, cm: Any, tm: Any) -> None:
                o = op.decode() if isinstance(op, bytes) else str(op)
                if o == "q":
                    stack.append(dict(state))
                elif o == "Q" and stack:
                    state.update(stack.pop())
                elif o in ("g", "rg", "k", "sc", "scn"):
                    w = _blank_fill(o, list(args))
                    if w is not None:
                        state["white"] = w
                elif o == "cs":
                    state["white"] = False  # troca de espaço de cor volta ao preto
                elif o == "Tr":
                    state["mode"] = int(args[0])
                elif o == "Tz":
                    state["tz"] = float(args[0])
                elif o == "gs":  # transparência zero pelo ExtGState (/ca, /CA)
                    try:
                        g = gstates[args[0]].get_object()
                        if any(float(g[k]) < 0.1 for k in ("/ca", "/CA") if k in g):
                            state["white"] = True
                    except Exception:  # noqa: BLE001
                        pass
                elif o == "TJ" and isinstance(args[0], list) and sum(float(x) for x in args[0] if isinstance(x, (int, float))) < -50000:
                    n[0] += 1  # deslocamento que empurra o texto para fora da página
                elif o in ("Tj", "TJ", "'", '"') and (state["white"] or state["mode"] in (3, 7)):
                    n[0] += 1

            def visit(text: str, cm: Any, tm: Any, font: Any, size: Any) -> None:
                if not text.strip():
                    parts.append(text)
                    return
                a, b_, c, d, e, f = (float(v) for v in tm)
                ca, cb, cc, cd, ce, cf = (float(v) for v in cm)
                x, y = e * ca + f * cc + ce, e * cb + f * cd + cf
                scale = ((a * ca + b_ * cc) ** 2 + (a * cb + b_ * cd) ** 2) ** 0.5 or 1.0
                if float(size or 0) * scale < 4 or state["tz"] < 20 or not (x0 - 5 <= x <= x1 + 5 and y0 - 5 <= y <= y1 + 5):
                    n[0] += 1
                    return
                parts.append(text)

            page.extract_text(visitor_text=visit, visitor_operand_before=before)
            hidden += n[0]
            out.append("".join(parts))
    except Exception:  # noqa: BLE001 - PDF que quebra o visitante não prova nada: quem chama trata None como "não medido"
        return None
    return out, hidden


def hidden_text(pdf: bytes, pages: list[str]) -> bool | None:
    """O PDF tem texto que o pypdf extrai e o leitor não vê? Tolerância zero. None = não deu para medir."""
    r = _scan(pdf)
    if r is None or len(r[0]) != len(pages):
        return None
    vis, hidden = r
    full = sum(len(drafting._words(t)) for t in pages)
    seen = sum(len(drafting._words(t)) for t in vis)
    return hidden > 0 or full != seen


@dataclass
class Call:
    data: dict[str, Any]
    usage: drafting.Usage
    served_by: str


def call_agent(client: Any, role: str, system: str, user: str, schema: dict[str, Any]) -> Call:
    """Uma chamada, saída presa ao esquema. Sem `fallbacks`: o modelo que responde é o que foi pedido."""
    try:
        resp = client.messages.create(
            model=V.MODELS[role],
            max_tokens=16000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={"effort": V.EFFORT[role], "format": {"type": "json_schema", "schema": schema}},
        )
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.InternalServerError,
            anthropic.APIResponseValidationError) as x:
        raise Transient(f"{role}: {type(x).__name__}") from x
    except anthropic.APIStatusError as x:
        if x.status_code >= 500 or x.status_code in (408, 409):
            raise Transient(f"{role}: API respondeu {x.status_code}") from x
        if x.status_code == 413 or (x.status_code == 400 and re.search(r"too (?:long|large)|exceed|maximum", str(x), re.I)):
            # o problema é desta proposta (documento grande): barra só ela, não trava a fila inteira
            raise AgentFailed(f"{role}: documento grande demais para a API ({x.status_code})") from x
        raise Fatal(f"{role}: a API recusou a requisição ({x.status_code}); confira chave, crédito, ID do modelo e tamanho do documento") from x
    if resp.stop_reason == "refusal":
        raise AgentFailed(f"{role}: o modelo recusou")
    if resp.stop_reason == "max_tokens":
        raise Transient(f"{role}: resposta cortada no limite de tokens")
    if resp.stop_reason != "end_turn":
        raise AgentFailed(f"{role}: parou por {resp.stop_reason}")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as x:
        raise AgentFailed(f"{role}: resposta fora do formato") from x
    if not V.conforms(data, schema):
        raise AgentFailed(f"{role}: resposta fora do esquema")
    return Call(data, drafting.Usage.from_api(resp.usage), resp.model)


@dataclass
class Outcome:
    decision: V.Decision
    report: dict[str, Any]
    cost: float | None
    calls: int = 0


@dataclass
class _Run:
    served: dict[str, str] = field(default_factory=dict)
    failed: dict[str, str] = field(default_factory=dict)
    cost: float = 0.0
    unpriced: int = 0
    calls: int = 0

    def agent(self, client: Any, role: str, system: str, user: str, schema: dict[str, Any]) -> dict[str, Any] | None:
        try:
            c = call_agent(client, role, system, user, schema)
        except AgentFailed as x:
            self.failed[role] = str(x)
            return None
        self.calls += 1
        self.served[role] = c.served_by
        usd = drafting.estimate_cost(c.served_by, c.usage)
        if usd is None:
            self.unpriced += 1
        else:
            self.cost += usd
        return c.data


def verify(client: Any, draft: dict[str, Any], pdf: bytes) -> Outcome:
    """Roda as conferências sobre um rascunho e devolve a decisão. Não toca no banco. Transient e Fatal sobem para quem chama."""
    pages = _pages(pdf)
    # O portão mecânico roda de novo aqui: os avisos gravados no rascunho podem estar velhos (edição direta no banco).
    pregate: list[str] = []
    if drafting.shape_errors(draft["answers"]):  # editado no banco: não chega ao validador nem aos agentes
        pregate.append("rascunho_malformado")
        answers = {f: V._blank(f, "nao_conferido") for f in V.FIELDS}
        checks = {}
    else:
        answers, checks = drafting.validate(draft["answers"], pages)
    if len(pages) > MAX_PAGES:
        pregate.append(f"paginas:{len(pages)}>{MAX_PAGES}")
    if sum(len(p.strip()) for p in pages) < 200:
        pregate.append("pdf_sem_texto")
    short = V.extraction_short_lines(pages)
    if short > V.EXTRACTION_MAX_SHORT_LINES:
        pregate.append(f"extracao_ruim:{short:.2f}")
    hits = V.directive_hits(pages)
    if hits:
        pregate.append(f"instrucao_no_documento:{len(hits)}")
    hidden = hidden_text(pdf, pages)
    if hidden is None:
        pregate.append("texto_invisivel_nao_medido")
    elif hidden:
        pregate.append("texto_invisivel")

    said = V.said(answers)
    quote_class = {f: V.classify_quote(answers[f]["trecho"], pages) for f in said}
    r = _Run()
    sust = contra = reader = judge = None
    asked = V.proof_articles(pages, draft["source_sha256"])
    proof_ok = False
    if not pregate:  # com o documento reprovado no portão não se gasta chamada: o árbitro barra pelo motivo do portão
        if said:
            sust = r.agent(client, "sustentacao", V.SUST_SYSTEM, V.sust_message(answers, pages, said, checks), V.SUST_SCHEMA)
        contra = r.agent(client, "contraditor", V.CONTRA_SYSTEM, V.contra_message(answers, pages, asked), V.CONTRA_SCHEMA)
        proof_ok = contra is not None and V.check_proof(pages, asked, contra.get("prova"))
        if said:
            reader = r.agent(client, "leitor", V.READER_SYSTEM, V.reader_message(answers, said), V.READER_SCHEMA)
            if reader is not None:
                judge = r.agent(client, "juiz", V.JUDGE_SYSTEM, V.judge_message(answers, said, reader), V.JUDGE_SCHEMA)
        else:  # sem frase na página não há o que o leitor ler; a proposta já vai barrar por o_que_propoe
            reader, judge = {"ja_vale": "nao", "palavras_dificeis": []}, {}

    ev = V.Evidence(answers=answers, checks=checks, quote_class=quote_class, sust=sust, contra=contra, proof_ok=proof_ok,
                    reader=reader, judge=judge, drafter_model=draft["model"], served=r.served, pregate=pregate)
    d = V.decide(ev)
    soft = sorted(f for f, v in checks.items() if d.states.get(f) == "diz" and v)
    report = {
        "verifier_version": V.VERIFIER_VERSION,
        "source_sha256": draft["source_sha256"],
        "decisao": d.report(),
        "rascunho": draft["answers"],  # o que o redator escreveu, antes de o árbitro zerar campos: sem isso não há auditoria
        "avisos_do_portao": checks,
        "auditoria_prioritaria": soft,  # campos publicados com aviso não bloqueante: primeiros da auditoria por amostra
        "modelos": r.served,
        "falhas": r.failed,
        "portao": pregate,
        "trechos": quote_class,
        "prova_de_leitura": {"artigos": asked, "ok": proof_ok},
        "agentes": {"sustentacao": sust, "contraditor": contra, "leitor": reader, "juiz": judge} if not pregate else None,
        "custo_usd": None if r.unpriced else round(r.cost, 6),
    }
    return Outcome(d, report, None if r.unpriced else round(r.cost, 6), r.calls)


class PgStore:
    """Tudo o que a verificação lê e grava. Separado para o fluxo ser testável sem Postgres."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def ready(self) -> bool:
        return bool(self.conn.execute("select 1 from information_schema.columns where table_name = 'answer_drafts' and column_name = 'verifier_version'").fetchone())

    def switch_on(self) -> bool:
        """A segunda chave: quem liga a publicação por agentes grava esta linha, depois do site e da avaliação."""
        row = self.conn.execute("select value from pipeline_switches where name = %s", (SWITCH,)).fetchone()
        return bool(row) and str(row["value"]).strip().lower() == "on"

    def strike(self, d: dict[str, Any]) -> int:
        """Marca uma tentativa que falhou por causa da API. Devolve o total. Não muda status nem apaga relatório anterior."""
        row = self.conn.execute(
            """update answer_drafts
               set verification = coalesce(verification, '{}'::jsonb) || jsonb_build_object('tentativas', coalesce((verification->>'tentativas')::int, 0) + 1)
               where id = %s and status = 'rascunho' returning (verification->>'tentativas')::int as n""", (d["id"],)).fetchone()
        self.conn.commit()
        return int(row["n"]) if row else 0

    def human_live(self, d: dict[str, Any]) -> bool:
        """Há no ar uma versão que não foi publicada por agentes? Essa só uma pessoa substitui (`civico-etl revisar`)."""
        return bool(self.conn.execute(
            """select 1 from answer_drafts where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s
               and status = 'publicado' and verified_by is distinct from 'agentes'""",
            (d["body_id"], d["prop_type"], d["prop_number"], d["prop_year"])).fetchone())

    def pending(self, key: str | None) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """select distinct on (a.body_id, a.prop_type, a.prop_number, a.prop_year) a.*, b.kind as body_kind
               from answer_drafts a join legislative_bodies b on b.id = a.body_id
               where a.status = 'rascunho'
               order by a.body_id, a.prop_type, a.prop_number, a.prop_year, a.created_at desc"""
        ).fetchall()
        out = []
        for r in rows:
            k = f"{'camara' if r['body_kind'] == 'camara_deputados' else 'senado'}-{r['prop_type'].lower()}-{r['prop_number']}-{r['prop_year']}"
            if not key or k == key:
                out.append(dict(r, key=k))
        return out

    def rehearse(self, d: dict[str, Any], report: dict[str, Any]) -> None:
        self._one("update answer_drafts set verification = %s, verifier_version = %s where id = %s and status = 'rascunho'",
                  (json.dumps({**report, "modo": "ensaio"}, ensure_ascii=False), V.VERIFIER_VERSION, d["id"]))
        self.conn.commit()

    def bar(self, d: dict[str, Any], report: dict[str, Any], note: str) -> None:
        self._one("""update answer_drafts set status = 'barrado', verification = %s, verifier_version = %s, verified_by = 'agentes', review_note = %s
                     where id = %s and status = 'rascunho'""",
                  (json.dumps(report, ensure_ascii=False), V.VERIFIER_VERSION, note[:500], d["id"]))
        self.conn.commit()

    def publish(self, d: dict[str, Any], answers: dict[str, Any], report: dict[str, Any]) -> bool:
        """Publica. Devolve True quando substituiu uma versão que já estava no ar (vira correção, com motivo público)."""
        with self.conn.transaction():
            prev = self.conn.execute(
                """select id from answer_drafts where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s
                   and status = 'publicado' for update""",
                (d["body_id"], d["prop_type"], d["prop_number"], d["prop_year"]),
            ).fetchone()
            if prev:
                # só substitui o que os próprios agentes publicaram; a versão de pessoa foi barrada antes, em process()
                self._one("update answer_drafts set status = 'substituido' where id = %s and status = 'publicado' and verified_by = 'agentes'", (prev["id"],))
            self._one(
                """update answer_drafts set status = 'publicado', answers = %s, verification = %s, verifier_version = %s, verified_by = 'agentes',
                          reviewer = %s, reviewed_at = now(), replaces_id = %s, correction_note = %s
                   where id = %s and status = 'rascunho'""",
                (json.dumps(answers, ensure_ascii=False), json.dumps(report, ensure_ascii=False), V.VERIFIER_VERSION, f"agentes:v{V.VERIFIER_VERSION}",
                 prev["id"] if prev else None, f"Nova conferência por agentes (versão {V.VERIFIER_VERSION})." if prev else None, d["id"]),
            )
        self.conn.commit()
        return bool(prev)

    def _one(self, q: str, args: tuple) -> None:
        if self.conn.execute(q, args).rowcount != 1:  # dentro de transaction() a saída desfaz o bloco; fora, nada foi gravado
            raise Changed("o rascunho mudou de estado durante a verificação; rode de novo")


def strikes(d: dict[str, Any]) -> int:
    return int((d.get("verification") or {}).get("tentativas") or 0)


def already_rehearsed(d: dict[str, Any]) -> bool:
    v = d.get("verification") or {}
    return v.get("verifier_version") == V.VERIFIER_VERSION and v.get("source_sha256") == d["source_sha256"]


def process(store: Any, client: Any, d: dict[str, Any], pdf: bytes, *, live: bool) -> str:
    """Verifica um rascunho e grava o resultado. Devolve 'publicado', 'barrado' ou 'ensaio:publicaria' / 'ensaio:barraria'."""
    o = verify(client, d, pdf)
    if not live:
        store.rehearse(d, o.report)
        return "ensaio:publicaria" if o.decision.publish and not store.human_live(d) else "ensaio:barraria"
    if o.decision.publish:
        if store.human_live(d):
            # seção 9: página revisada por pessoa não é trocada por agentes. Fica registrado e sai da fila.
            store.bar(d, o.report, "publicacao_de_pessoa_no_ar: a página no ar é de pessoa; para trocá-la gere novo rascunho com `civico-etl rascunho --force` e revise com `civico-etl revisar`")
            return "barrado"
        store.publish(d, o.decision.answers, o.report)
        return "publicado"
    store.bar(d, o.report, "; ".join(o.decision.barred))
    return "barrado"


def run_verificar(conn: psycopg.Connection, *, key: str | None = None, limit: int = 5, force: bool = False) -> int:
    store = PgStore(conn)
    if not store.ready():
        raise SystemExit("answer_drafts ainda não tem as colunas de verificação: aplique a migração 0130 antes de `civico-etl verificar`")
    env_on = os.environ.get("VERIFICACAO_AGENTICA", "").strip().lower() == "on"
    if env_on and not store.switch_on():
        raise SystemExit(f"VERIFICACAO_AGENTICA=on, mas a chave '{SWITCH}' não está ligada em pipeline_switches. "
                         "Ela só é gravada depois do site com os três estados e da avaliação da seção 10. Sem a variável, o comando roda em ensaio.")
    live = env_on
    queue = [d for d in store.pending(key) if force or ((live or not already_rehearsed(d)) and strikes(d) < MAX_TRIES)]
    skipped = [d["key"] for d in store.pending(key) if not force and strikes(d) >= MAX_TRIES]
    if limit <= 0:
        for d in queue:
            print(f"{d['key']:<28} rascunho de {d['created_at']:%d/%m %H:%M}  {'já ensaiado' if already_rehearsed(d) else 'a verificar'}")
        for k in skipped:
            print(f"{k:<28} pulado: {MAX_TRIES} falhas da API; rode com --force")
        if not queue:
            print("Fila vazia: nenhum rascunho esperando verificação.")
        return 0

    client = anthropic.Anthropic()
    rc = 0
    with run(conn, "verificar", "camara", force=True) as r:
        r.notes.append("modo: PUBLICA (duas chaves ligadas)" if live else "modo: ensaio (nada muda de status)")
        if skipped:
            r.notes.append(f"pulados por {MAX_TRIES} falhas da API (use --force): {', '.join(skipped[:10])}")
        done = streak = 0
        for d in queue:
            if done >= limit:
                r.notes.append(f"parou no limite de {limit}; rode de novo para o resto")
                break
            try:
                f = fetch(d["source_url"], max_age=86400, accept="application/pdf")
            except (httpx.HTTPError, ValueError, FileNotFoundError) as x:
                r.reject(why=f"{d['key']}: inteiro teor não baixou ({x})")
                continue
            if f.checksum != d["source_sha256"]:
                # o texto oficial mudou depois do rascunho: conferir a frase contra outro documento não vale
                r.reject(why=f"{d['key']}: o PDF mudou desde o rascunho; rode `civico-etl rascunho --key {d['key']}`")
                continue
            try:
                result = process(store, client, d, f.path.read_bytes(), live=live)
            except Transient as x:
                n = store.strike(d)
                r.reject(why=f"{d['key']}: API indisponível ({x}); fica na fila, tentativa {n} de {MAX_TRIES}")
                streak += 1
                if streak >= 2:
                    r.notes.append("duas falhas seguidas da API: run encerrado para não gastar à toa")
                    rc = 1
                    break
                continue
            except Changed as x:
                r.reject(why=f"{d['key']}: {x}")
                continue
            except Fatal as x:
                r.reject(why=f"{d['key']}: {x}. Run encerrado; nada foi gravado para esta proposta.")
                rc = 1
                break
            streak = 0
            done += 1
            r.add(1)
            log.info("%s: %s", d["key"], result)
            r.notes.append(f"{d['key']}: {result}")
    return rc
