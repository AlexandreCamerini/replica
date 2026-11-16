"""Fila de pendências e detalhe de uma pendência (Parte B): `civico-etl admin fila` e `civico-etl admin pendencia ID`. Só LEITURA.

ORDEM DA FILA (restrição 7; plano, seção 4.2): classe do campo, tipo de pendência, vencimento, cobertura do recorte, e `id` como desempate. NUNCA por pessoa, partido
ou popularidade: `SQL_FILA` lê só `adm_pendencias`, sem join com nenhuma tabela de pessoa, partido, mandato ou voto, e a ordenação é feita só nessa consulta (o Python
não reordena). Os rótulos legíveis, o território, o valor vigente e as propostas são buscados DEPOIS, em consultas separadas, e não influenciam a ordem.
  1. classe, na ordem FIXA declarada em `classes.ORDEM_CLASSES` (vinculo_sapl, cobertura, contato_mandato, identidade; não é alfabética);
  2. tipo, na ordem FIXA de `classes.ORDEM_TIPOS` (divergencia, mudanca, duplicata, confirmacao);
  3. `vence_em` crescente, nulos por último;
  4. `cobertura_recorte` crescente (o recorte menos coberto primeiro), nulos por último;
  5. `id`.
`SQL_FILA` é a constante que a central web reusa. Parâmetros nomeados: `%(classe)s` (texto ou nulo = todas) e `%(limite)s` (inteiro ou nulo = sem limite).
"""

from __future__ import annotations

import uuid
from typing import Any

from .classes import CLASSES, ORDEM_CLASSES, ORDEM_TIPOS
from .saida import ErroAdmin, lista_chave_valor, tabela


def _lista_sql(valores: tuple[str, ...]) -> str:
    return "array[" + ", ".join(f"'{v}'" for v in valores) + "]::text[]"


SQL_FILA = f"""select id, classe, registro_chave, campo, tipo, pergunta, reaberta, motivo_reabertura, evidencia_sha, vigente_sha, vence_em, cobertura_recorte, criada_em
from adm_pendencias
where status = 'aberta' and (%(classe)s::text is null or classe = %(classe)s::text)
order by array_position({_lista_sql(ORDEM_CLASSES)}, classe),
         array_position({_lista_sql(ORDEM_TIPOS)}, tipo),
         vence_em asc nulls last,
         cobertura_recorte asc nulls last,
         id
limit %(limite)s
"""

_COLS_PROPOSTA = ("pr.id, pr.classe, pr.registro_chave, pr.campo, pr.valor_vigente, pr.valor_candidato, pr.url, pr.trecho, pr.bloco, pr.conteudo_sha256, pr.lida_em, "
                  "pr.fonte_declarada_em, pr.fonte_slug, pr.rodada_id, pr.alcance, pr.regra_criterio, pr.regra_ids, pr.criada_em")


def _proposta(r: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(r["id"]), "valor_vigente_na_leitura": r["valor_vigente"], "valor_candidato": r["valor_candidato"], "url": r["url"], "trecho": r["trecho"], "bloco": r["bloco"],
            "conteudo_sha256": r["conteudo_sha256"], "lida_em": r["lida_em"], "fonte_declarada_em": r["fonte_declarada_em"], "fonte_slug": r["fonte_slug"],
            "rodada_id": str(r["rodada_id"]) if r["rodada_id"] else None, "alcance": r["alcance"], "regra_criterio": r["regra_criterio"], "regra_ids": r["regra_ids"]}


def _itens(conn: Any, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Enriquece as linhas NA ORDEM EM QUE VIERAM (nenhuma reordenação). Consultas separadas da ordenação."""
    ids = [str(r["id"]) for r in rows]
    prop: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
    if ids:
        for r in conn.execute(
            f"select pp.pendencia_id, {_COLS_PROPOSTA} from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id "
            "where pp.pendencia_id = any(%s::uuid[]) order by pr.lida_em nulls first, pr.criada_em, pr.id", (ids,)).fetchall():
            prop[str(r["pendencia_id"])].append(_proposta(r))
    out = []
    for pos, r in enumerate(rows, 1):
        c = CLASSES[r["classe"]]
        rotulo = c.rotulo(conn, r["registro_chave"])
        terr, motivo_terr = c.territorio_com_motivo(conn, r["registro_chave"])
        nulos: dict[str, str] = {}
        if rotulo is None:
            nulos["rotulo"] = "o registro não existe mais na tabela de origem"
        if terr is None:
            nulos["territorio"] = motivo_terr or "território desconhecido"
        if r["vence_em"] is None:
            nulos["vence_em"] = "a classe não tem prazo de revalidação" if c.revalidacao_dias is None else "vencimento não registrado"
        if r["cobertura_recorte"] is None:
            nulos["cobertura_recorte"] = "a proposta não veio de rodada com lista de registros elegíveis, ou o coletor não registra tentativas"
        out.append({
            "posicao": pos, "id": str(r["id"]), "classe": r["classe"], "registro_chave": r["registro_chave"], "campo": r["campo"], "tipo": r["tipo"], "pergunta": r["pergunta"],
            "reaberta": r["reaberta"], "motivo_reabertura": r["motivo_reabertura"], "vence_em": r["vence_em"],
            "cobertura_recorte": float(r["cobertura_recorte"]) if r["cobertura_recorte"] is not None else None,
            "rotulo": rotulo, "territorio": terr, "valor_vigente": c.valor_vigente(conn, r["registro_chave"], r["campo"]),
            "propostas": prop[str(r["id"])], "desconhecidos": nulos,
        })
    return out


def fila(conn: Any, *, classe: str | None = None, limite: int | None = None) -> list[dict[str, Any]]:
    """Pendências `aberta` na ordem da restrição 7. `classe` filtra; `limite` corta depois da ordenação (feito no SQL)."""
    if classe is not None and classe not in CLASSES:
        raise ErroAdmin(f"classe inválida: {classe!r} (esperado uma de {', '.join(ORDEM_CLASSES)})")
    if limite is not None and (not isinstance(limite, int) or isinstance(limite, bool) or limite < 1):
        raise ErroAdmin(f"limite inválido: {limite!r} (esperado inteiro maior que zero)")
    return _itens(conn, conn.execute(SQL_FILA, {"classe": classe, "limite": limite}).fetchall())


def detalhe(conn: Any, pendencia_id: Any) -> dict[str, Any]:
    """Uma pendência (qualquer status): o item da fila, as decisões já registradas (só leitura) e o histórico de propostas do campo em ordem de leitura."""
    try:
        pid = str(uuid.UUID(str(pendencia_id)))
    except ValueError:
        raise ErroAdmin(f"identificador de pendência inválido: {pendencia_id!r}") from None
    r = conn.execute("select id, classe, registro_chave, campo, tipo, pergunta, status, reaberta, motivo_reabertura, evidencia_sha, vigente_sha, vence_em, cobertura_recorte, criada_em "
                     "from adm_pendencias where id = %s", (pid,)).fetchone()
    if r is None:
        raise ErroAdmin(f"pendência inexistente: {pid}")
    item = _itens(conn, [r])[0]
    del item["posicao"]
    item.update({"status": r["status"], "evidencia_sha": r["evidencia_sha"], "vigente_sha": r["vigente_sha"], "criada_em": r["criada_em"]})
    item["decisoes"] = [
        {"id": str(d["id"]), "acao": d["acao"], "decidido_por_tipo": d["decidido_por_tipo"], "decidido_por_nome": d["decidido_por_nome"], "justificativa": d["justificativa"],
         "valor": d["valor"], "campos_afetados": d["campos_afetados"], "aplicada": d["aplicada"], "aplicada_em": d["aplicada_em"], "criada_em": d["criada_em"]}
        for d in conn.execute("select id, acao, decidido_por_tipo, decidido_por_nome, justificativa, valor, campos_afetados, aplicada, aplicada_em, criada_em from adm_decisoes "
                              "where pendencia_id = %s order by criada_em, id", (pid,)).fetchall()]
    ligadas = {p["id"] for p in item["propostas"]}
    item["historico"] = [{**_proposta(h), "ligada_a_esta_pendencia": str(h["id"]) in ligadas} for h in conn.execute(
        f"select {_COLS_PROPOSTA} from adm_propostas pr where pr.classe = %s and pr.registro_chave = %s and pr.campo = %s order by pr.lida_em nulls first, pr.criada_em, pr.id",
        (r["classe"], r["registro_chave"], r["campo"])).fetchall()]
    return item


# ------------------------------------------------------------------ texto

COLUNAS_FILA = (("posicao", "#"), ("classe", "CLASSE"), ("tipo", "TIPO"), ("rotulo", "REGISTRO"), ("campo", "CAMPO"), ("vence_em", "VENCE"), ("cobertura_recorte", "COBERTURA"),
                ("reaberta", "REABERTA"), ("pergunta", "PERGUNTA"))
FORMATOS_FILA = {"vence_em": lambda d: f"{d:%Y-%m-%d}", "cobertura_recorte": lambda v: f"{v:.0%}", "reaberta": lambda v: "sim" if v else "-"}


def texto_fila(itens: list[dict[str, Any]]) -> str:
    if not itens:
        return "nenhuma pendência aberta"
    reabertas = sum(1 for i in itens if i["reaberta"])
    return tabela(COLUNAS_FILA, itens, formatos=FORMATOS_FILA, total=f"{len(itens)} pendências abertas ({reabertas} reabertas); ordem: classe, tipo, vencimento, cobertura do recorte, id")


def texto_detalhe(d: dict[str, Any]) -> str:
    t = d["territorio"]
    cab = lista_chave_valor([
        ("pendência", d["id"]), ("status", d["status"] + (f" (reaberta: {d['motivo_reabertura']})" if d["reaberta"] else "")), ("classe", d["classe"]), ("tipo", d["tipo"]),
        ("registro", f"{d['registro_chave']}  {d['rotulo'] or 'desconhecido: ' + d['desconhecidos']['rotulo']}"), ("campo", d["campo"]),
        ("território", f"{t['nivel']} {t['ibge_code']}" if t else f"desconhecido: {d['desconhecidos']['territorio']}"),
        ("valor vigente", "sem valor" if d["valor_vigente"] is None else d["valor_vigente"]),
        ("vence em", f"{d['vence_em']:%Y-%m-%d}" if d["vence_em"] else f"desconhecido: {d['desconhecidos']['vence_em']}"),
        ("cobertura do recorte", f"{d['cobertura_recorte']:.0%}" if d["cobertura_recorte"] is not None else f"desconhecido: {d['desconhecidos']['cobertura_recorte']}"),
        ("pergunta", d["pergunta"])])
    cols = (("valor_candidato", "CANDIDATO"), ("url", "URL"), ("trecho", "TRECHO"), ("bloco", "BLOCO"), ("conteudo_sha256", "HASH"), ("lida_em", "LIDA"), ("fonte_declarada_em", "DECLARADA"))
    fm = {"conteudo_sha256": lambda h: h[:12], "lida_em": lambda x: f"{x:%Y-%m-%d %H:%MZ}", "fonte_declarada_em": lambda x: f"{x:%Y-%m-%d}"}
    out = [cab, "", "propostas ligadas:", tabela(cols, d["propostas"], formatos=fm), "", "histórico (ordem de leitura):",
           tabela(cols + (("ligada_a_esta_pendencia", "LIGADA"),), d["historico"], formatos=fm), "", "decisões:"]
    out += [f"  {x['criada_em']:%Y-%m-%d %H:%MZ}  {x['acao']}  {x['decidido_por_tipo']}  aplicada={'sim' if x['aplicada'] else 'não'}  {x['justificativa']}" for x in d["decisoes"]] or ["  nenhuma"]
    return "\n".join(out)
