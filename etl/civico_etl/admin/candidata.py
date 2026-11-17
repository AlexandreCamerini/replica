"""Edição candidata (B5): `civico-etl admin candidata [--rodada ID ...] [--json]`. Só LEITURA (nada grava, nada comita).

A edição candidata é a diferença entre a base vigente e o que as propostas de coleta dizem, por registro e campo, com a evidência de cada candidato e o que ainda falta decidir.

Unidade: o CAMPO (`classe`, `registro_chave`, `campo`), a mesma do relatório da rodada. O valor vigente é lido AGORA da tabela de domínio (`classes.CLASSES[...].valor_vigente`),
nunca copiado da proposta (`valor_vigente` da proposta é o valor no instante da leitura e só aparece como `vigente_na_leitura`).

Seções do documento:
- `diferencas`: campo com ao menos uma proposta cujo candidato difere do vigente de agora. EXCEÇÃO declarada: campo com pendência ABERTA cujo candidato já é o vigente (o job gravou o novo
  valor direto na tabela e a mudança espera decisão) também entra, com `ja_e_o_vigente = true` no candidato; aí a diferença é contra `vigente_na_leitura` (o valor que a tabela tinha
  quando a proposta foi lida). Sem pendência aberta, candidato igual ao vigente é confirmação e não entra. Cada linha traz `candidatos` (só os que diferem; a evidência de cada um é a da proposta mais
  recente com aquele valor: URL, trecho, bloco, hash, lida_em, fonte_declarada_em, fonte, rodada), `confirmam_vigente` (quantas propostas do campo trazem o próprio vigente), a
  `situacao` e, quando existe, a `decisao` mais recente (ação, quem, quando, justificativa, aplicada).
  Situações: `conflitante` (pendência aberta do tipo divergência), `pendente` (pendência aberta de outro tipo; ou campo sem pendência cujo candidato difere, com `sem_pendencia_aberta`),
  `decidida_e_aplicada`, `decidida_nao_aplicada`, `descartada`.
- `aplicadas`: campo cuja pendência está decidida e cuja decisão mais recente (aprovar ou corrigir) foi aplicada. Depois de aplicada o candidato já é o vigente, por isso a seção é própria:
  `valor_anterior` (o vigente registrado na proposta no instante da leitura; a aplicação não guarda o valor anterior em tabela própria), `valor_novo` (o valor da decisão) e a decisão.
  Um campo corrigido para um valor diferente do candidato aparece nas duas seções.
- `pendencias_restantes`: as pendências abertas na ordem da fila (`pendencias.fila`: classe, tipo, vencimento, cobertura do recorte, id), cada uma com a pergunta, o vigente e as propostas.
- `totais`: cada um `{"valor": N, "de": D}`. `campos_com_proposta` (denominador de `diferencas`, `confirmados_pela_fonte` e `sem_diferenca_por_decisao`), `diferencas` (de = campos com proposta),
  `aplicadas` (de = campos com proposta), `pendentes`, `conflitantes`, `decididas_nao_aplicadas`, `descartadas` (cada um de = `diferencas`), `pendencias_restantes` (de = pendências abertas no banco).
- `simulado`: lista dos cenários (`ADMIN_SIMULADO`) gravados nas rodadas envolvidas, lida de `adm_rodadas.previa.resultado.simulado` (como o relatório), ou null se nenhuma é simulada.
  Rodadas envolvidas: as de `--rodada` ou, sem filtro, todas as do banco. Proposta sem rodada (registrada à mão) não conta para isso.

Escopo: sem `--rodada`, todas as propostas; com `--rodada` (repetível), só as propostas dessas rodadas, e `pendencias_restantes` só traz as pendências desses campos.
Ordem: classe na ordem fixa de `classes.ORDEM_CLASSES` e depois a chave do registro (trechos numéricos em ordem numérica) e o campo. Nunca por pessoa, partido ou popularidade.
Saída: tabela ou `--json`. Código 0; 1 se a rodada não existe (ou o identificador é inválido).
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Sequence

from . import pendencias as pen
from .classes import CLASSES, ORDEM_CLASSES, canonico
from .saida import ErroAdmin, lista_chave_valor, tabela

SITUACOES = ("conflitante", "pendente", "decidida_e_aplicada", "decidida_nao_aplicada", "descartada")
_COLS_PROPOSTA = ("id, classe, registro_chave, campo, valor_vigente, valor_candidato, url, trecho, bloco, conteudo_sha256, lida_em, fonte_declarada_em, fonte_slug, rodada_id, criada_em")


def _chave_ordem(classe: str, chave: str, campo: str) -> tuple[Any, ...]:
    partes = tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in re.split(r"(\d+)", chave) if p != "")
    return (ORDEM_CLASSES.index(classe), partes, campo)


def _uuid(x: Any) -> str:
    try:
        return str(uuid.UUID(str(x)))
    except ValueError:
        raise ErroAdmin(f"identificador de rodada inválido: {x!r}") from None


def _rodadas(conn: Any, ids: Sequence[Any] | None) -> list[dict[str, Any]]:
    """Rodadas envolvidas, com a marca `simulado` lida do resultado gravado. Rodada inexistente levanta ErroAdmin."""
    if ids:
        pedidas = list(dict.fromkeys(_uuid(i) for i in ids))
        rows = conn.execute("select id, previa->'resultado'->>'simulado' as simulado from adm_rodadas where id = any(%s::uuid[])", (pedidas,)).fetchall()
        achadas = {str(r["id"]) for r in rows}
        faltam = [i for i in pedidas if i not in achadas]
        if faltam:
            raise ErroAdmin(f"rodada inexistente: {', '.join(faltam)}")
        ordem = {i: n for n, i in enumerate(pedidas)}
        rows = sorted(rows, key=lambda r: ordem[str(r["id"])])
    else:
        rows = conn.execute("select id, previa->'resultado'->>'simulado' as simulado from adm_rodadas order by iniciada_em, id").fetchall()
    return [{"id": str(r["id"]), "simulado": r["simulado"] or None} for r in rows]


def _evidencia(p: dict[str, Any]) -> dict[str, Any]:
    return {"proposta_id": str(p["id"]), "url": p["url"], "trecho": p["trecho"], "bloco": p["bloco"], "conteudo_sha256": p["conteudo_sha256"], "lida_em": p["lida_em"],
            "fonte_declarada_em": p["fonte_declarada_em"], "fonte_slug": p["fonte_slug"], "rodada_id": str(p["rodada_id"]) if p["rodada_id"] else None}


def _decisao(d: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(d["id"]), "acao": d["acao"], "por_tipo": d["decidido_por_tipo"], "por_nome": d["decidido_por_nome"], "justificativa": d["justificativa"], "valor": d["valor"],
            "aplicada": d["aplicada"], "aplicada_em": d["aplicada_em"], "decidida_em": d["criada_em"]}


def _total(valor: int, de: int) -> dict[str, int]:
    return {"valor": valor, "de": de}


def candidata(conn: Any, rodadas: Sequence[Any] | None = None) -> dict[str, Any]:
    envolvidas = _rodadas(conn, rodadas)
    filtro = bool(rodadas)
    if filtro:
        props = conn.execute(f"select {_COLS_PROPOSTA} from adm_propostas where rodada_id = any(%s::uuid[]) order by lida_em nulls first, criada_em, id", ([r["id"] for r in envolvidas],)).fetchall()
    else:
        props = conn.execute(f"select {_COLS_PROPOSTA} from adm_propostas order by lida_em nulls first, criada_em, id").fetchall()
    campos: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for p in props:
        campos.setdefault((p["classe"], p["registro_chave"], p["campo"]), []).append(p)

    diferencas: list[dict[str, Any]] = []
    aplicadas: list[dict[str, Any]] = []
    confirmados = sem_dif_decisao = 0
    for (classe, chave, campo) in sorted(campos, key=lambda k: _chave_ordem(*k)):
        c = CLASSES[classe]
        vigente = c.valor_vigente(conn, chave, campo)
        ps = campos[(classe, chave, campo)]
        pend = conn.execute("select id, tipo, status, reaberta, motivo_reabertura, pergunta from adm_pendencias where classe = %s and registro_chave = %s and campo = %s", (classe, chave, campo)).fetchone()
        dec = conn.execute("select id, acao, decidido_por_tipo, decidido_por_nome, justificativa, valor, aplicada, aplicada_em, criada_em from adm_decisoes "
                           "where pendencia_id = %s order by criada_em desc, id desc limit 1", (pend["id"],)).fetchone() if pend else None
        rotulo = c.rotulo(conn, chave)
        terr = c.territorio(conn, chave)
        base = {"classe": classe, "registro_chave": chave, "rotulo": rotulo, "campo": campo, "valor_vigente": vigente, "territorio": terr,
                "pendencia_id": str(pend["id"]) if pend else None, "pendencia_status": pend["status"] if pend else None, "pendencia_reaberta": bool(pend and pend["reaberta"]),
                "pergunta": pend["pergunta"] if pend else None, "decisao": _decisao(dec) if dec else None, "desconhecidos": {} if rotulo else {"rotulo": "o registro não existe mais na tabela de origem"}}
        ultimo_aplicado = bool(pend and pend["status"] == "decidida" and dec and dec["aplicada"] and dec["acao"] in ("aprovar", "corrigir"))
        if ultimo_aplicado:
            aplicadas.append({**base, "valor_anterior": ps[-1]["valor_vigente"], "valor_anterior_origem": "vigente registrado na proposta no instante da leitura", "valor_novo": dec["valor"],
                              "candidatos": [{"valor": p["valor_candidato"], **_evidencia(p)} for p in ps if canonico(p["valor_candidato"]) == canonico(dec["valor"])][-1:]})
        por_valor: dict[str, dict[str, Any]] = {}
        confirmam = 0
        for p in ps:  # ordem de leitura: a última com o mesmo valor substitui a anterior
            igual = vigente is not None and canonico(p["valor_candidato"]) == canonico(vigente)
            if not igual:
                por_valor[canonico(p["valor_candidato"])] = {"valor": p["valor_candidato"], "ja_e_o_vigente": False, "vigente_na_leitura": p["valor_vigente"], **_evidencia(p)}
            elif pend and pend["status"] == "aberta" and canonico(p["valor_vigente"]) != canonico(p["valor_candidato"]):
                # o job já gravou o candidato na tabela (sem override) e a mudança espera decisão: a diferença é contra o valor que a tabela tinha na leitura
                por_valor[canonico(p["valor_candidato"])] = {"valor": p["valor_candidato"], "ja_e_o_vigente": True, "vigente_na_leitura": p["valor_vigente"], **_evidencia(p)}
            else:
                confirmam += 1
        if not por_valor:
            if ultimo_aplicado or (pend and pend["status"] == "decidida"):
                sem_dif_decisao += 1
            else:
                confirmados += 1
            continue
        if pend and pend["status"] == "aberta":
            situacao, extra = ("conflitante" if pend["tipo"] == "divergencia" else "pendente"), {}
        elif pend:
            situacao = "decidida_e_aplicada" if ultimo_aplicado else ("descartada" if dec and dec["acao"] == "descartar" else "decidida_nao_aplicada")
            extra = {}
        else:
            situacao, extra = "pendente", {"sem_pendencia_aberta": True}
        diferencas.append({**base, "situacao": situacao, **extra, "candidatos": list(por_valor.values()), "confirmam_vigente": confirmam})

    alvo_pend = {(d["classe"], d["registro_chave"], d["campo"]) for d in diferencas} | {(a["classe"], a["registro_chave"], a["campo"]) for a in aplicadas} | set(campos) if filtro else None
    fila = pen.fila(conn)
    restantes = [p for p in fila if alvo_pend is None or (p["classe"], p["registro_chave"], p["campo"]) in alvo_pend]
    for n, p in enumerate(restantes, 1):
        p["posicao"] = n
    n_abertas = conn.execute("select count(*) as n from adm_pendencias where status = 'aberta'").fetchone()["n"]
    n_campos = len(campos)
    cont = {s: sum(1 for d in diferencas if d["situacao"] == s) for s in SITUACOES}
    sims = sorted({r["simulado"] for r in envolvidas if r["simulado"]})
    return {
        "escopo": {"rodadas": [r["id"] for r in envolvidas] if filtro else None, "todas_as_rodadas": not filtro, "rodadas_envolvidas": len(envolvidas)},
        "simulado": sims or None,
        "rodadas": envolvidas,
        "diferencas": diferencas,
        "aplicadas": aplicadas,
        "pendencias_restantes": restantes,
        "totais": {
            "campos_com_proposta": _total(n_campos, n_campos),
            "diferencas": _total(len(diferencas), n_campos),
            "aplicadas": _total(len(aplicadas), n_campos),
            "confirmados_pela_fonte": _total(confirmados, n_campos),
            "sem_diferenca_por_decisao": _total(sem_dif_decisao, n_campos),
            "pendentes": _total(cont["pendente"], len(diferencas)),
            "conflitantes": _total(cont["conflitante"], len(diferencas)),
            "decididas_nao_aplicadas": _total(cont["decidida_nao_aplicada"], len(diferencas)),
            "descartadas": _total(cont["descartada"], len(diferencas)),
            "pendencias_restantes": _total(len(restantes), n_abertas),
        },
        "mensagem": None if campos else "nenhuma proposta registrada no escopo: a edição candidata não tem diferença a mostrar",
    }


# ------------------------------------------------------------------ texto


def _fv(v: Any) -> str:
    return "sem valor" if v is None else (v if isinstance(v, str) else canonico(v))


def _linha_evid(e: dict[str, Any]) -> str:
    return f"{e['url']}  hash {e['conteudo_sha256'][:12]}  lida {e['lida_em']:%Y-%m-%d %H:%MZ}" if e["lida_em"] else f"{e['url']}  hash {e['conteudo_sha256'][:12]}  leitura sem data"


def texto_candidata(doc: dict[str, Any]) -> str:
    out: list[str] = []
    if doc["simulado"]:
        out += [f"SIMULADO: respostas fabricadas (cenário {', '.join(doc['simulado'])}); nenhum número abaixo foi lido da fonte", ""]
    esc = doc["escopo"]
    out.append(f"escopo: {'todas as rodadas (' + str(esc['rodadas_envolvidas']) + ')' if esc['todas_as_rodadas'] else 'rodadas ' + ', '.join(esc['rodadas'])}")
    t = doc["totais"]

    def tt(k: str) -> str:
        return f"{t[k]['valor']} de {t[k]['de']}"

    out.append(lista_chave_valor([("campos com proposta", str(t["campos_com_proposta"]["valor"])), ("diferenças", tt("diferencas")), ("  pendentes", tt("pendentes")), ("  conflitantes", tt("conflitantes")),
                                   ("  decididas, não aplicadas", tt("decididas_nao_aplicadas")), ("  descartadas", tt("descartadas")), ("aplicadas", tt("aplicadas")),
                                   ("confirmados pela fonte", tt("confirmados_pela_fonte")), ("pendências restantes", tt("pendencias_restantes"))]))
    if doc["mensagem"]:
        out += ["", doc["mensagem"]]
    cols = (("classe", "CLASSE"), ("registro_chave", "CHAVE"), ("rotulo", "REGISTRO"), ("campo", "CAMPO"), ("valor_vigente", "VIGENTE"), ("candidatos", "CANDIDATO"), ("situacao", "SITUAÇÃO"),
            ("evidencia", "EVIDÊNCIA"), ("decisao", "DECISÃO"))
    linhas = []
    for d in doc["diferencas"]:
        dc = d["decisao"]
        linhas.append({**d, "valor_vigente": _fv(d["valor_vigente"]), "candidatos": " | ".join(_fv(c["valor"]) + (f" (já é o vigente; na leitura: {_fv(c['vigente_na_leitura'])})" if c.get("ja_e_o_vigente") else "") for c in d["candidatos"]),
                       "evidencia": " | ".join(_linha_evid(c) for c in d["candidatos"]),
                       "decisao": f"{dc['acao']} por {dc['por_nome'] or dc['por_tipo']} em {dc['decidida_em']:%Y-%m-%d %H:%MZ}, aplicada={'sim' if dc['aplicada'] else 'não'}: {dc['justificativa']}" if dc else "-"})
    out += ["", "diferenças em relação à base vigente:", tabela(cols, linhas, largura_max=110, total=f"{len(linhas)} diferenças em {t['campos_com_proposta']['valor']} campos com proposta") if linhas else "  nenhuma"]
    out += ["", "aplicadas (o candidato já é o vigente):"]
    if doc["aplicadas"]:
        la = [{**a, "antes": _fv(a["valor_anterior"]), "depois": _fv(a["valor_novo"]), "decisao": f"{a['decisao']['acao']} por {a['decisao']['por_nome'] or a['decisao']['por_tipo']} em {a['decisao']['aplicada_em']:%Y-%m-%d %H:%MZ}: {a['decisao']['justificativa']}",
               "evidencia": " | ".join(_linha_evid(c) for c in a["candidatos"]) or "-"} for a in doc["aplicadas"]]
        out.append(tabela((("classe", "CLASSE"), ("registro_chave", "CHAVE"), ("rotulo", "REGISTRO"), ("campo", "CAMPO"), ("antes", "ANTES"), ("depois", "DEPOIS"), ("decisao", "DECISÃO"), ("evidencia", "EVIDÊNCIA")),
                          la, largura_max=110, total=f"{len(la)} aplicadas"))
    else:
        out.append("  nenhuma")
    out += ["", "pendências restantes (ordem da fila):", pen.texto_fila(doc["pendencias_restantes"]) if doc["pendencias_restantes"] else "  nenhuma"]
    return "\n".join(out)
