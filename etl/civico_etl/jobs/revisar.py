"""civico-etl revisar: a pessoa que revisa lê o rascunho, troca o que não se sustenta por "O texto não diz" e publica.

  civico-etl revisar                                            # fila: rascunhos esperando revisão
  civico-etl revisar camara-pl-79-2020                          # mostra o último rascunho, campo a campo, com os avisos
  civico-etl revisar camara-pl-79-2020 --aprovar --conferido <código> --revisor "Nome" [--nao-diz quem_paga ...] [--frase campo="nova frase" ...] [--motivo "..."]
  civico-etl revisar camara-pl-79-2020 --reprovar --revisor "Nome" --motivo "trecho não sustenta a frase"

Teste do revisor (Regra 3), por frase: o trecho existe e diz isso? Há termo proibido? Há número fora do trecho?
O sistema já confere o que é mecânico; publicar com aviso bloqueante é recusado até o campo virar "O texto não diz".
Se já houver versão publicada, aprovar a nova é uma correção: --motivo é obrigatório e vai para /correcoes.

Trava de leitura: aprovar exige o código de conferência que só aparece ao mostrar o rascunho; se o rascunho mudar
depois de lido, o código não bate. Com REVISORES="Nome 1,Nome 2" no ambiente, só esses nomes aprovam ou reprovam.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re

import psycopg

from .. import drafting

log = logging.getLogger("etl.revisar")
LABEL = {
    "o_que_propoe": "O que propõe?",
    "quem_recebe": "Quem recebe algo",
    "quem_paga": "Quem paga",
    "o_que_muda": "O que muda",
    "dinheiro": "O dinheiro entra, sai ou é dividido?",
    "estimativa_impacto": "Estimativa de impacto oficial",
}


def code(d: dict) -> str:
    """Código de conferência: muda se as respostas ou os avisos do rascunho mudarem."""
    raw = json.dumps([str(d["id"]), d["answers"], d["checks"]], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:8]


def _key(key: str) -> tuple[str, str, int, int]:
    m = re.fullmatch(r"(camara|senado)-([a-z]{2,4})-(\d+)-(\d{4})", key)
    if not m:
        raise SystemExit(f"chave inválida: {key} (formato: camara-pl-79-2020)")
    return ("camara_deputados" if m[1] == "camara" else "senado"), m[2].upper(), int(m[3]), int(m[4])


def run_revisar(conn: psycopg.Connection, key: str | None, *, approve: bool, reject: bool, reviewer: str | None,
                note: str | None, not_said: list[str], phrases: list[str] | None = None, checked: str | None = None) -> int:
    if not key:
        return _queue(conn)
    kind, t, n, y = _key(key)
    d = conn.execute(
        """select a.* from answer_drafts a join legislative_bodies b on b.id = a.body_id
           where b.kind = %s and a.prop_type = %s and a.prop_number = %s and a.prop_year = %s and a.status = 'rascunho'
           order by a.created_at desc limit 1
           for update of a""",
        (kind, t, n, y),
    ).fetchone()
    if not d:
        print(f"{key}: nenhum rascunho esperando revisão.")
        return 1
    if not (approve or reject):
        _show(key, d)
        return 0
    if not reviewer or not reviewer.strip():
        raise SystemExit("--revisor é obrigatório: o site mostra que uma pessoa revisou")
    allowed = [n.strip() for n in os.environ.get("REVISORES", "").split(",") if n.strip()]
    if allowed and reviewer.strip() not in allowed:
        raise SystemExit(f"{reviewer.strip()} não está em REVISORES")
    if reject:
        if not note:
            raise SystemExit("--motivo é obrigatório ao reprovar")
        _set(conn, "update answer_drafts set status = 'reprovado', reviewer = %s, reviewed_at = now(), review_note = %s where id = %s and status = 'rascunho'",
             (reviewer.strip(), note, d["id"]))
        conn.commit()
        print(f"{key}: reprovado. Rode `civico-etl rascunho --key {key} --force` para um rascunho novo.")
        return 0

    edits = dict(e.split("=", 1) for e in phrases or [] if "=" in e)
    if len(edits) != len(phrases or []):
        raise SystemExit('--frase usa o formato campo="nova frase"')
    if checked != code(d):
        raise SystemExit(f"{key}: código de conferência ausente ou diferente. Rode `civico-etl revisar {key}`, leia e use --conferido <código>.")
    bad = [f for f in [*not_said, *edits] if f not in drafting.FIELDS]
    if bad:
        raise SystemExit(f"campo desconhecido em --nao-diz: {', '.join(bad)} (válidos: {', '.join(drafting.FIELDS)})")
    answers = d["answers"]
    for f in not_said:
        answers[f] = {"diz": False, "frase": "", "trecho": "", "pagina": 0} | ({"direcao": "nao_diz"} if f == "dinheiro" else {})
    checks = dict(d["checks"])
    for f, frase in edits.items():
        if not answers[f].get("diz"):
            raise SystemExit(f"{f}: o rascunho diz 'O texto não diz'; não há trecho para sustentar uma frase nova")
        answers[f]["frase"] = frase.strip()
        # o trecho não muda; os avisos de trecho ficam, os de frase são refeitos
        kept = [i for i in checks.get(f, []) if i.split(":")[0] in ("trecho_nao_encontrado", "pagina_corrigida")]
        checks[f] = kept + drafting.check_phrase(f, frase, answers[f]["trecho"])
    block = drafting.blocking(checks, answers)
    if block:
        lines = "\n".join(f"  {f}: {', '.join(v)}" for f, v in block.items())
        raise SystemExit(f"{key}: não publicado. Estes campos ainda têm aviso bloqueante:\n{lines}\nUse --frase campo='...' para reescrever, --nao-diz <campo> ou reprove.")
    prev = conn.execute(
        "select id from answer_drafts where body_id = %s and prop_type = %s and prop_number = %s and prop_year = %s and status = 'publicado'",
        (d["body_id"], t, n, y),
    ).fetchone()
    if prev and not note:
        raise SystemExit(f"{key} já tem versão publicada: aprovar esta é uma correção. Informe --motivo (vai para /correcoes).")
    with conn.transaction():
        if prev:
            _set(conn, "update answer_drafts set status = 'substituido' where id = %s and status = 'publicado'", (prev["id"],))
        _set(
            conn,
            f"""update answer_drafts set status = 'publicado', answers = %s, checks = %s, reviewer = %s, reviewed_at = now(),
                      replaces_id = %s, correction_note = %s{_by_person(conn)} where id = %s and status = 'rascunho'""",
            (json.dumps(answers, ensure_ascii=False), json.dumps(checks, ensure_ascii=False), reviewer.strip(),
             prev["id"] if prev else None, note if prev else None, d["id"]),
        )
    conn.commit()
    print(f"{key}: publicado{' como correção' if prev else ''}. O site mostra em até 10 minutos.")
    return 0


def _by_person(conn: psycopg.Connection) -> str:
    """Depois da migração 0130: marca quem conferiu e não deixa o relatório de ensaio dos agentes congelado numa página de pessoa."""
    has = conn.execute("select 1 from information_schema.columns where table_name = 'answer_drafts' and column_name = 'verified_by'").fetchone()
    return ", verified_by = 'pessoa', verification = null, verifier_version = null" if has else ""


def _set(conn: psycopg.Connection, q: str, args: tuple) -> None:
    """Toda troca de status confere o status de origem: outro processo pode ter mexido entre a leitura e a escrita."""
    if conn.execute(q, args).rowcount != 1:
        conn.rollback()
        raise SystemExit("o rascunho mudou de estado enquanto você revisava; mostre de novo e repita")


def _queue(conn: psycopg.Connection) -> int:
    rows = conn.execute(
        """select b.kind, a.prop_type, a.prop_number, a.prop_year, a.created_at, a.checks, a.answers
           from answer_drafts a join legislative_bodies b on b.id = a.body_id
           where a.status = 'rascunho' order by a.created_at"""
    ).fetchall()
    if not rows:
        print("Fila vazia: nenhum rascunho esperando revisão.")
        return 0
    for r in rows:
        k = f"{'camara' if r['kind'] == 'camara_deputados' else 'senado'}-{r['prop_type'].lower()}-{r['prop_number']}-{r['prop_year']}"
        nb = len(drafting.blocking(r["checks"], r["answers"]))
        print(f"{k:<28} rascunho de {r['created_at']:%d/%m %H:%M}  {nb} campo(s) com aviso bloqueante")
    return 0


def _show(key: str, d: dict) -> None:
    print(f"{key} · rascunho de {d['created_at']:%d/%m/%Y %H:%M} · {d['model']} · prompt v{d['prompt_version']}")
    print(f"Texto oficial: {d['source_url']} ({d['source_pages']} páginas)\n")
    for f in drafting.FIELDS:
        a = d["answers"].get(f) or {}
        print(f"■ {LABEL[f]}  [{f}]")
        if not a.get("diz"):
            print("  O texto não diz.")
        else:
            extra = f" ({a['direcao']})" if f == "dinheiro" else ""
            print(f"  {a['frase']}{extra}")
            print(f"  trecho, p. {a['pagina']}: \"{a['trecho']}\"")
        for i in d["checks"].get(f, []):
            print(f"  ! {i}{' (bloqueia)' if i.split(':')[0] in drafting.BLOCKING else ''}")
        print()
    print("Confira cada frase: o trecho existe e diz isso? Há termo proibido? Há número fora do trecho?")
    print(f"Código de conferência: {code(d)}  (use --conferido {code(d)} para aprovar)")
