"""Registro de decisões sobre pendências (Parte B, B2; replica/admin-coleta-plano.md, seções 2 e 3): `civico-etl admin decidir`.

Quatro ações sobre uma pendência `aberta`: `aprovar` (aceita o valor candidato, que tem de ser UM só), `corrigir` (o valor é informado e validado no domínio do campo),
`descartar` (não aplica nada; a trilha diz quem descartou e por quê) e `pedir_confirmacao` (a pendência continua aberta, com a pergunta acrescida do pedido).
Cada decisão grava quem decidiu (`pessoa` com nome, ou `agentes` com relatório e versão do verificador), quando (`criada_em`), a justificativa e os campos afetados.

Este módulo só REGISTRA: a decisão entra em `adm_decisoes` NÃO aplicada (o gatilho 0150 exige) e a pendência vai a `decidida`. Quem escreve nas tabelas de domínio é
`aplicar.py`. Nada aqui comita: quem chama decide (o subcomando comita).

Forma do valor da decisão (`adm_decisoes.valor`, jsonb):
  - `aprovar`: o candidato único das propostas ligadas (o sistema não escolhe: com fontes divergentes `aprovar` é recusado);
  - `corrigir`: o valor informado (texto, no domínio do campo). Em campo de contato EXISTENTE (`<kind>:<value>`) aceita também `{"remover": true}`: "o contato está errado e
    não há valor certo" (suprime e apaga, sem inserir). `corrigir` com valor nulo NÃO é aceito;
  - `aprovar` de pendência de `tipo = 'duplicata'` (classe identidade): `{"unir": {"de": "<people.id>", "para": "<people.id>"}}`, única forma de unir pessoas (via `merge_person`);
  - `descartar` e `pedir_confirmacao`: sem valor (nulo).
`campos_afetados` = lista de `classe:registro_chave:campo` (mais `people:<id>:merge_person` na união e o contato novo na correção de contato).

Identidade: só `aceito` e `rejeitado` são aplicáveis. `nova_pessoa` criaria pessoa e `pendente` não decide nada: ambos são recusados. `aceito` sem pessoa candidata na fila é recusado
já aqui (não há a quem ligar); `aplicar` confere de novo.
"""

from __future__ import annotations

import uuid
from typing import Any

from psycopg.types.json import Jsonb

from . import propostas as prop
from .classes import CLASSES, canonico, contato_partes
from .saida import ErroAdmin

ACOES = ("aprovar", "corrigir", "descartar", "pedir_confirmacao")
ACOES_QUE_APLICAM = ("aprovar", "corrigir")
POR_TIPOS = ("pessoa", "agentes")
IDENTIDADE_APLICAVEL = ("aceito", "rejeitado")
MSG_DIVERGENTE = "fontes divergentes: use corrigir com o valor escolhido e a justificativa"


class DecisaoRecusada(ErroAdmin):
    """A decisão não entra: o motivo é a mensagem. Nada foi gravado."""


def _uuid(v: Any, nome: str) -> str:
    try:
        return str(uuid.UUID(str(v)))
    except ValueError:
        raise DecisaoRecusada(f"{nome} inválido: {v!r}") from None


def _texto(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def candidato_unico(conn: Any, pendencia_id: str) -> Any:
    """O valor candidato da pendência: a leitura mais recente de cada URL ligada tem de trazer o MESMO valor. Recusa sem proposta ligada e com fontes divergentes."""
    ligadas = prop._ligadas(conn, pendencia_id)
    if not ligadas:
        raise DecisaoRecusada("a pendência não tem proposta ligada: não há valor candidato para aprovar (use corrigir com o valor e a justificativa)")
    ultimas = prop._ultimas_por_url(ligadas)
    if len({canonico(l["candidato"]) for l in ultimas}) > 1:
        raise DecisaoRecusada(MSG_DIVERGENTE)
    return ultimas[-1]["candidato"]


def _unir(conn: Any, valor: Any) -> dict[str, Any]:
    if not (isinstance(valor, dict) and set(valor) == {"unir"} and isinstance(valor["unir"], dict) and set(valor["unir"]) == {"de", "para"}):
        raise DecisaoRecusada('pendência de duplicata: o valor tem de ser {"unir": {"de": "<people.id>", "para": "<people.id>"}} (nenhuma outra forma é aceita)')
    de, para = _uuid(valor["unir"]["de"], "unir.de"), _uuid(valor["unir"]["para"], "unir.para")
    if de == para:
        raise DecisaoRecusada("unir: as duas pessoas são a mesma")
    for i in (de, para):
        if not conn.execute("select 1 from people where id = %s", (i,)).fetchone():
            raise DecisaoRecusada(f"unir: a pessoa {i} não existe")
    return {"unir": {"de": de, "para": para}}


def valida_valor(conn: Any, pend: dict[str, Any], acao: str, valor: Any) -> Any:
    """Valida o valor que a decisão vai aplicar (candidato único em `aprovar`; informado em `corrigir`) e o devolve normalizado. Levanta `DecisaoRecusada`."""
    c = CLASSES[pend["classe"]]
    campo = pend["campo"]
    if pend["tipo"] == "duplicata":
        if acao != "aprovar":
            raise DecisaoRecusada("pendência de duplicata: só `aprovar` com valor {\"unir\": ...}; corrigir não se aplica")
        return _unir(conn, valor)
    if isinstance(valor, dict) and "unir" in valor:
        raise DecisaoRecusada("`unir` só vale em pendência de tipo duplicata")
    if pend["classe"] == "contato_mandato" and isinstance(valor, dict):
        modo, _kind, _v = contato_partes(campo)
        if acao != "corrigir" or valor != {"remover": True}:
            raise DecisaoRecusada('contato: o único valor em objeto é {"remover": true}, e só em corrigir')
        if modo != "existente":
            raise DecisaoRecusada("remover só vale em contato que já existe (<tipo>:<valor>); contato novo que está errado se descarta")
        return {"remover": True}
    if valor is None:
        raise DecisaoRecusada("valor nulo não se decide: corrigir exige um valor (para tirar um contato errado use {\"remover\": true})")
    campo_validacao = campo
    if pend["classe"] == "contato_mandato" and isinstance(valor, str):
        modo, kind, _v = contato_partes(campo)
        if modo == "novo":  # corrigir um contato novo informa o valor certo: a igualdade com o campo vale só para a proposta (classes._contato_candidato)
            campo_validacao = f"novo:{kind}:{valor}"
    erro = c.valida_candidato(campo_validacao, valor)
    if erro:
        raise DecisaoRecusada(erro)
    if pend["classe"] == "identidade":
        if valor not in IDENTIDADE_APLICAVEL:
            raise DecisaoRecusada(f"identidade: só {' e '.join(IDENTIDADE_APLICAVEL)} se aplicam (nova_pessoa criaria pessoa e pendente não decide nada); veio {valor!r}")
        if valor == "aceito":
            q = conn.execute("select candidate_person_id from identity_match_queue where id = %s", (_uuid(pend["registro_chave"], "registro"),)).fetchone()
            if q is None:
                raise DecisaoRecusada("item da fila de identidade inexistente")
            if q["candidate_person_id"] is None:
                raise DecisaoRecusada("identidade: o item não tem pessoa candidata; 'aceito' não tem a quem ligar (rejeite, ou espere um candidato)")
    return valor


def _campos_afetados(pend: dict[str, Any], acao: str, valor: Any) -> list[str]:
    base = f"{pend['classe']}:{pend['registro_chave']}:{pend['campo']}"
    if acao not in ACOES_QUE_APLICAM:
        return [base]
    if pend["tipo"] == "duplicata":
        return [base, f"people:{valor['unir']['de']}:merge_person", f"people:{valor['unir']['para']}:merge_person"]
    if pend["classe"] == "contato_mandato":
        modo, kind, antigo = contato_partes(pend["campo"])
        if modo == "existente" and isinstance(valor, str):
            return [base, f"contato_mandato:{pend['registro_chave']}:{kind}:{valor}"]
    return [base]


def decidir(conn: Any, pendencia_id: Any, *, acao: str, por_tipo: str, por_nome: str | None = None, relatorio: Any = None, versao_verificador: int | None = None,
            justificativa: str, valor: Any = None) -> dict[str, Any]:
    """Registra a decisão e move a pendência (aprovar/corrigir/descartar -> `decidida`; pedir_confirmacao -> continua `aberta`, tipo `confirmacao`). NÃO aplica e NÃO comita.

    Valida ANTES de escrever (nenhuma linha em caso de recusa): pendência existe e está `aberta`; ação; justificativa; quem decidiu; valor (ver docstring do módulo)."""
    pid = _uuid(pendencia_id, "identificador de pendência")
    pend = conn.execute("select * from adm_pendencias where id = %s for update", (pid,)).fetchone()
    if pend is None:
        raise DecisaoRecusada(f"pendência inexistente: {pid}")
    if pend["status"] != "aberta":
        raise DecisaoRecusada(f"a pendência {pid} já está decidida; só pendência aberta (ou reaberta por mudança de evidência ou de registro) recebe decisão")
    if acao not in ACOES:
        raise DecisaoRecusada(f"ação inválida: {acao!r} (esperado uma de {', '.join(ACOES)})")
    just = _texto(justificativa)
    if just is None:
        raise DecisaoRecusada("justificativa vazia: toda decisão diz por quê")
    if por_tipo not in POR_TIPOS:
        raise DecisaoRecusada(f"decidido_por_tipo inválido: {por_tipo!r} (esperado pessoa ou agentes)")
    nome = _texto(por_nome)
    if por_tipo == "pessoa":
        if nome is None:
            raise DecisaoRecusada("decisão de pessoa exige o nome de quem decidiu")
        if relatorio is not None or versao_verificador is not None:
            raise DecisaoRecusada("relatório e versão do verificador são de decisão de agentes")
    else:
        if relatorio is None or versao_verificador is None or isinstance(versao_verificador, bool) or not isinstance(versao_verificador, int):
            raise DecisaoRecusada("decisão de agentes exige o relatório e a versão (inteira) do verificador")
    if acao in ("descartar", "pedir_confirmacao"):
        if valor is not None:
            raise DecisaoRecusada(f"{acao} não aceita valor")
        v = None
    elif acao == "aprovar":
        if pend["tipo"] == "duplicata":
            v = valida_valor(conn, pend, acao, valor)
        else:
            if valor is not None:
                raise DecisaoRecusada("aprovar aceita o valor candidato da pendência e nenhum outro; para outro valor use corrigir")
            v = valida_valor(conn, pend, acao, candidato_unico(conn, pid))
    else:
        v = valida_valor(conn, pend, acao, valor)

    d = conn.execute(
        "insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, decidido_por_nome, relatorio, versao_verificador, justificativa, campos_afetados, valor) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning *",
        (pid, acao, por_tipo, nome if por_tipo == "pessoa" else None, Jsonb(relatorio) if relatorio is not None else None, versao_verificador if por_tipo == "agentes" else None,
         just, Jsonb(_campos_afetados(pend, acao, v)), Jsonb(v) if v is not None else None)).fetchone()
    if acao == "pedir_confirmacao":
        quem = nome if por_tipo == "pessoa" else "agentes"
        # tipo `duplicata` não vira `confirmacao`: é ele que permite a união depois (e o B1 também o preserva ao recalcular)
        conn.execute("update adm_pendencias set tipo = case when tipo = 'duplicata' then tipo else 'confirmacao' end, pergunta = pergunta || %s where id = %s",
                     (f" Confirmação pedida por {quem}: {just}", pid))
    else:
        conn.execute("update adm_pendencias set status = 'decidida' where id = %s", (pid,))
    return dict(d)
