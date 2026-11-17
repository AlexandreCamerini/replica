"""Executor dos pedidos da central de administração (Parte C, C2; replica/admin-coleta-plano.md, seções C3, C5 e 4.3): `civico-etl admin executor` e `admin pedido`.

A tela NÃO executa coleta nem chama modelo: grava um pedido; este módulo o consome e executa pelos mecanismos que já existem (`rodadas.abrir/executar/repetir/recuperar`,
`parecer.gerar`, `decisoes.decidir`, `aplicar.aplicar`). Nada aqui reescreve esses mecanismos.

TABELAS DE PEDIDO (migrações 0150 e 0153)
  adm_pedidos          tipo `rodada` | `recoleta` | `parecer`; colunas `parametros`, `andamento`, `rodada_id`, `erro`.
  adm_pedidos_decisao  a decisão pela tela (AC-19): `pendencia_id`, `acao`, `por_nome`, `justificativa`, `valor`, `aplicar`, `decisao_id`, `erro`. Não tem `andamento` nem `rodada_id`.
  Ciclo: na_fila -> em_execucao -> concluido | falhou | interrompido (o gatilho de estado só permite isso: para RECUSAR um pedido o executor passa por `em_execucao`).

PARÂMETROS E `chave_idem` (critério 20: "clicar duas vezes em 'Recoletar fichas pendentes' gera um pedido só")
  `chave_idem` = sha256 hexadecimal do JSON canônico de `{"tipo": <tipo>, "parametros": <parâmetros normalizados>}`. JSON canônico = chaves ordenadas (recursivamente), separadores `,` e `:`
  sem espaço, `ensure_ascii=False`, UTF-8. Uma implementação em outra linguagem tem de produzir os mesmos bytes (os testes fixam vetores de ouro em `VETORES_DE_OURO`).
    rodada    `{"coletor": str, "modo": "descobrir|recoletar|reprocessar", "recorte": {"anos": [int], "ufs": [UF], "casas": [str], "ibges": [str], "extras": {str: str}}}`
              ou `{"repetir": "<uuid da rodada>", "so_pendencias": bool}`. Listas ordenadas e sem repetição (normalização de `parametros_rodada`).
    recoleta  `{"classe": "vinculo_sapl|cobertura|contato_mandato|identidade", "territorio": {"ibge": str, "nivel": "municipio|uf|pais"}}` (`ibge` = `places.ibge_code`: 7 dígitos no município, 2 na UF).
    parecer   `{"pendencia_id": "<uuid>"}` ou `{"rodada_id": "<uuid>"}` (um só dos dois).
    decisao   (tabela `adm_pedidos_decisao`; `tipo` = "decisao" só para a chave) `{"pendencia_id", "acao", "valor", "por_nome", "aplicar"}`: a justificativa NÃO entra na chave (duas
              justificativas para a mesma decisão ainda são um clique repetido), mas `aplicar` entra: um pedido que só decide não pode engolir um que também aplica.
  `pedir` grava um pedido na fila e devolve `(pedido, novo)`; se já existe um igual `na_fila` ou `em_execucao` devolve ESSE com `novo=False` (dois cliques = um pedido). Depois de
  `concluido`/`falhou`/`interrompido` o mesmo pedido pode entrar de novo (o índice único é parcial).

O QUE A CENTRAL WEB REPETE (insere como `admin_central`: só `insert` e `select`, sem update e sem função com privilégio): `SQL_INSERIR_PEDIDO`, `SQL_INSERIR_PEDIDO_DECISAO`, `SQL_PEDIDO_ATIVO`,
`SQL_PEDIDO_DECISAO_ATIVO` e `SQL_EXECUTOR_PARADO`. `on conflict (chave_idem) where <o predicado do índice parcial> do nothing` infere o índice parcial `adm_pedidos_idem_uq`; sem linha devolvida
o pedido igual já existe e a central lê o existente com `SQL_PEDIDO_ATIVO` (se ele terminou entre as duas consultas, repete o `insert`: `pedir` repete até 3 vezes).

EXECUÇÃO (`executar_um`)
  1. `limpar_orfaos`: pedido `em_execucao` com `batimento_em` (ou, sem ele, `iniciado_em`) mais velho que `LIMITE_BATIMENTO_S` (120 s) vira `interrompido` ("executor ausente") e a rodada ligada, se
     ainda `em_andamento`, vai a `interrompida` por `rodadas.recuperar` (que só age com a trava consultiva livre; se a trava está tomada o motivo é gravado em `erro`). Sem nada vencido não escreve nada.
  2. `pegar`: o pedido `na_fila` mais antigo das DUAS tabelas (`criado_em, id`; nunca por pessoa, partido ou popularidade), travado com `for update skip locked` (um lock por candidato: não há
     `for update` sobre `union`), marcado `em_execucao` com `iniciado_em` e `batimento_em` e COMITADO antes de qualquer trabalho. Dois executores nunca pegam o mesmo pedido.
  3. BATIMENTO: uma thread com CONEXÃO PRÓPRIA (autocommit) atualiza `batimento_em` a cada `BATIMENTO_S` (15 s) enquanto o pedido roda, inclusive durante o coletor (que bloqueia a thread principal e
     faz commit/rollback na conexão de trabalho: por isso o batimento não pode usar essa conexão). A conexão do batimento vem de `conn_factory` ou do DSN da conexão de trabalho.
  4. `andamento` (só `adm_pedidos`) é gravado e comitado a cada etapa; o desfecho grava `status`, `finalizado_em`, `erro`, `rodada_id`/`decisao_id` com `where status = 'em_execucao'` (se outro
     executor já o declarou `interrompido`, a gravação não faz nada e o resultado traz `finalizacao_perdida`).
  Desfecho da rodada -> pedido: `concluida` -> `concluido`; `falhou` -> `falhou` (erro = o motivo da rodada); `interrompida` -> `interrompido` (o pedido espelha a rodada: ela é retomável por
  `rodada repetir`/`rodada executar`).
  Parâmetro inválido (coletor fora do catálogo, recorte não suportado, pendência inexistente, classe sem território, ação que não aplica com `aplicar`) -> `falhou` com o motivo, sem executar nada.

PARECER: só o motor de ENSAIO local (`parecer.motor_ensaio_local`, passado explicitamente): o executor nunca passa `real`, nunca constrói cliente de modelo, não lê a chave da API nem as duas chaves dos
agentes. Escreve só em `adm_pareceres` (e no próprio pedido).
DECISÃO: `decisoes.decidir(..., por_tipo='pessoa', por_nome=<o nome do pedido>)` e, se `aplicar`, `aplicar.aplicar`, tudo na MESMA transação (como `admin decidir --aplicar`: se a aplicação falha a
decisão também não fica) que grava `decisao_id` e `concluido`. NUNCA `por_tipo='agentes'`.

EXECUTOR PARADO (C5): `estado_dos_pedidos(...)["executor_parado"]` pela regra do plano: algum pedido `na_fila` há mais de `LIMITE_FILA_S` (60 s) ou `em_execucao` com batimento vencido (> 120 s).
Fila velha com um pedido `em_execucao` de batimento em dia (executor ocupado com uma rodada longa) também conta como parado pela regra, mas `executor_ocupado` vem `true` e a mensagem diz isso.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import signal
import threading
import uuid
from typing import Any, Callable

import psycopg
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb

from ..catalogo.contrato import Recorte
from ..catalogo.coletores import coletor as _coletor
from . import aplicar as apl
from . import decisoes as dec
from . import parecer as par
from . import rodadas as rod
from .classes import CLASSES
from .saida import ErroAdmin, para_json

TIPOS = ("rodada", "recoleta", "parecer")  # tipos de `adm_pedidos`
TIPO_DECISAO = "decisao"  # pedido de `adm_pedidos_decisao`
TABELA = {**{t: "adm_pedidos" for t in TIPOS}, TIPO_DECISAO: "adm_pedidos_decisao"}
TABELAS = ("adm_pedidos", "adm_pedidos_decisao")
BATIMENTO_S = 15.0
LIMITE_BATIMENTO_S = 120.0
LIMITE_FILA_S = 60.0
NIVEIS = ("municipio", "uf", "pais")
MODOS = ("descobrir", "recoletar", "reprocessar")
CHAVE_DECISAO = ("pendencia_id", "acao", "valor", "por_nome", "aplicar")
CANDIDATOS = 10  # quantos pedidos antigos o `pegar` tenta travar antes de desistir (os travados por outro executor são pulados)

PREDICADO_ATIVO = "status in ('na_fila', 'em_execucao')"  # o predicado do índice único parcial (0150 e 0153)
SQL_INSERIR_PEDIDO = ("insert into adm_pedidos (tipo, parametros, chave_idem) values (%s, %s, %s) "
                      f"on conflict (chave_idem) where {PREDICADO_ATIVO} do nothing returning id, tipo, parametros, chave_idem, status, criado_em")
SQL_PEDIDO_ATIVO = f"select id, tipo, parametros, chave_idem, status, criado_em, rodada_id, andamento, erro from adm_pedidos where chave_idem = %s and {PREDICADO_ATIVO}"
SQL_INSERIR_PEDIDO_DECISAO = ("insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, valor, aplicar, chave_idem) values (%s, %s, %s, %s, %s, %s, %s) "
                              f"on conflict (chave_idem) where {PREDICADO_ATIVO} do nothing returning id, pendencia_id, acao, por_nome, justificativa, valor, aplicar, chave_idem, status, criado_em")
SQL_PEDIDO_DECISAO_ATIVO = ("select id, pendencia_id, acao, por_nome, justificativa, valor, aplicar, chave_idem, status, criado_em, decisao_id, erro from adm_pedidos_decisao "
                            f"where chave_idem = %s and {PREDICADO_ATIVO}")

# Uma consulta só (a central a reproduz). Parâmetros nomeados: `agora` (nulo = relógio do banco), `fila_s` (60) e `batimento_s` (120).
# `sim` = há pedido na fila há mais que `fila_s` ou em execução com batimento (ou, sem ele, início) mais velho que `batimento_s`. `motivo` = `batimento_vencido` (prevalece: é executor morto)
# ou `fila_velha`; `desde` = o horário mais antigo do motivo escolhido (criação do pedido na fila; último batimento). `executor_ocupado` = há pedido `em_execucao` com batimento em dia.
SQL_EXECUTOR_PARADO = f"""with ativos as (
  select 'adm_pedidos' as tabela, id, status, criado_em, iniciado_em, batimento_em from adm_pedidos where {PREDICADO_ATIVO}
  union all
  select 'adm_pedidos_decisao', id, status, criado_em, iniciado_em, batimento_em from adm_pedidos_decisao where {PREDICADO_ATIVO}
), t as (select coalesce(%(agora)s::timestamptz, clock_timestamp()) as agora),
ult as (select a.*, coalesce(a.batimento_em, a.iniciado_em, a.criado_em) as ultimo_sinal from ativos a),
vencidos as (
  select u.tabela, u.id,
         case when u.status = 'na_fila' then 'fila_velha' else 'batimento_vencido' end as motivo,
         case when u.status = 'na_fila' then u.criado_em else u.ultimo_sinal end as desde
  from ult u cross join t
  where (u.status = 'na_fila' and u.criado_em < t.agora - make_interval(secs => %(fila_s)s::double precision))
     or (u.status = 'em_execucao' and u.ultimo_sinal < t.agora - make_interval(secs => %(batimento_s)s::double precision))
)
select count(*) > 0 as sim,
       case when count(*) filter (where motivo = 'batimento_vencido') > 0 then 'batimento_vencido' when count(*) > 0 then 'fila_velha' end as motivo,
       case when count(*) filter (where motivo = 'batimento_vencido') > 0 then min(desde) filter (where motivo = 'batimento_vencido') else min(desde) end as desde,
       count(*) filter (where motivo = 'fila_velha') as n_fila_velha,
       count(*) filter (where motivo = 'batimento_vencido') as n_batimento_vencido,
       exists (select 1 from ult u cross join t where u.status = 'em_execucao' and u.ultimo_sinal >= t.agora - make_interval(secs => %(batimento_s)s::double precision)) as executor_ocupado,
       (select agora from t) as agora
from vencidos
"""

SQL_ATIVOS = f"""select 'adm_pedidos' as tabela, id, tipo, status, criado_em, iniciado_em, batimento_em, rodada_id, null::uuid as decisao_id, andamento, erro from adm_pedidos where {PREDICADO_ATIVO}
union all
select 'adm_pedidos_decisao', id, 'decisao', status, criado_em, iniciado_em, batimento_em, null::uuid, decisao_id, null::jsonb, erro from adm_pedidos_decisao where {PREDICADO_ATIVO}
order by criado_em, id"""

# vetores de ouro da `chave_idem` (os testes os conferem; quem reimplementar em outra linguagem deve reproduzi-los)
VETORES_DE_OURO = (
    ("recoleta", {"classe": "vinculo_sapl", "territorio": {"ibge": "11", "nivel": "uf"}}, "6b276886cd0c741fb732cb53d09643fc8f20fbbda6744fac12280dce3e43fce9"),
    ("parecer", {"pendencia_id": "0a1b2c3d-0000-4000-8000-000000000001"}, "46eb5f9e2f55670c464f227168e637401b9e225b9eb5870ae344d2a7f54ae953"),
    ("rodada", {"coletor": "sapl.assembleias", "modo": "recoletar", "recorte": {"anos": [], "casas": [], "extras": {}, "ibges": [], "ufs": ["AC", "RO"]}},
     "cccf3f45b0b24de626d3570f2c10e734b69b7bf833d74b90a7cbdaf3d7248270"),
    ("decisao", {"pendencia_id": "0a1b2c3d-0000-4000-8000-000000000001", "acao": "corrigir", "valor": "São João", "por_nome": "Maria", "aplicar": True},
     "67c059df8cb2dfea16a5768cb7006727e3d569d07694e1a944062279bf4300d4"),
)


# ------------------------------------------------------------------ parâmetros e chave


MOTIVO_CHAVE = "chave_idem não confere com os parâmetros"


def _json_canonico(o: Any) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _json(o: Any) -> Any:
    """Documento serializável (datas em ISO, UUID em texto) para gravar em jsonb."""
    return json.loads(para_json(o))


def _uuid(v: Any, nome: str) -> str:
    try:
        return str(uuid.UUID(str(v)))
    except ValueError:
        raise ErroAdmin(f"{nome} inválido: {v!r}") from None


def _chaves(d: Any, permitidas: set[str], tipo: str) -> dict[str, Any]:
    if not isinstance(d, dict):
        raise ErroAdmin(f"parâmetros de {tipo}: esperado um objeto JSON, veio {type(d).__name__}")
    estranhas = sorted(set(d) - permitidas)
    if estranhas:
        raise ErroAdmin(f"parâmetros de {tipo}: chave desconhecida {', '.join(estranhas)} (aceitas: {', '.join(sorted(permitidas))})")
    return d


def parametros_rodada(*, coletor: str | None = None, modo: str = "recoletar", recorte: dict[str, Any] | None = None, repetir: str | None = None, so_pendencias: bool = False) -> dict[str, Any]:
    """Parâmetros normalizados do pedido `rodada`: `{coletor, modo, recorte}` ou `{repetir, so_pendencias}`. Levanta `ErroAdmin` para o que é malformado (o catálogo só é consultado na execução)."""
    if repetir is not None:
        if coletor is not None or recorte:
            raise ErroAdmin("pedido de rodada: `repetir` não se combina com coletor nem recorte")
        if not isinstance(so_pendencias, bool):
            raise ErroAdmin(f"so_pendencias: esperado booleano, veio {so_pendencias!r}")
        return {"repetir": _uuid(repetir, "identificador de rodada"), "so_pendencias": so_pendencias}
    if not isinstance(coletor, str) or not coletor.strip():
        raise ErroAdmin("pedido de rodada: informe `coletor` (id do catálogo) ou `repetir` (id de rodada)")
    if modo not in MODOS:
        raise ErroAdmin(f"modo inválido: {modo!r} (esperado um de {', '.join(MODOS)})")
    rc = _chaves(recorte or {}, {"anos", "ufs", "casas", "ibges", "extras", "modo"}, "recorte")
    if "modo" in rc and rc["modo"] != modo:
        raise ErroAdmin(f"o modo do recorte ({rc['modo']!r}) difere do modo do pedido ({modo!r})")
    try:
        r = Recorte(anos=tuple(rc.get("anos") or ()), ufs=tuple(rc.get("ufs") or ()), casas=tuple(rc.get("casas") or ()), ibges=tuple(rc.get("ibges") or ()),
                    extras=dict(rc.get("extras") or {}), modo=modo)
    except (ValueError, TypeError) as e:
        raise ErroAdmin(f"recorte inválido: {e}") from None
    return {"coletor": coletor.strip(), "modo": modo,
            "recorte": {"anos": sorted(r.anos), "ufs": sorted(r.ufs), "casas": sorted(r.casas), "ibges": sorted(r.ibges), "extras": dict(sorted(r.extras.items()))}}


def parametros_recoleta(*, classe: str, territorio: dict[str, Any]) -> dict[str, Any]:
    """Parâmetros normalizados de `recoleta`: `{classe, territorio: {ibge, nivel}}`."""
    if classe not in CLASSES:
        raise ErroAdmin(f"classe inválida: {classe!r} (esperado uma de {', '.join(CLASSES)})")
    t = _chaves(territorio, {"ibge", "nivel"}, "território")
    ibge = t.get("ibge")
    if not isinstance(ibge, str) or not ibge.strip():
        raise ErroAdmin("território: `ibge` é obrigatório (texto)")
    if t.get("nivel") not in NIVEIS:
        raise ErroAdmin(f"território: `nivel` inválido: {t.get('nivel')!r} (esperado um de {', '.join(NIVEIS)})")
    return {"classe": classe, "territorio": {"ibge": ibge.strip(), "nivel": t["nivel"]}}


def parametros_parecer(*, pendencia_id: str | None = None, rodada_id: str | None = None) -> dict[str, Any]:
    """Parâmetros normalizados de `parecer`: `{pendencia_id}` ou `{rodada_id}` (um só)."""
    if (pendencia_id is None) == (rodada_id is None):
        raise ErroAdmin("pedido de parecer: informe `pendencia_id` ou `rodada_id` (um só dos dois)")
    return {"pendencia_id": _uuid(pendencia_id, "identificador de pendência")} if pendencia_id is not None else {"rodada_id": _uuid(rodada_id, "identificador de rodada")}


def parametros_decisao(*, pendencia_id: str, acao: str, por_nome: str, justificativa: str, valor: Any = None, aplicar: bool = False) -> dict[str, Any]:
    """Colunas normalizadas de `adm_pedidos_decisao` (sem a chave). `por_nome` e `justificativa` sem espaço nas pontas."""
    if acao not in dec.ACOES:
        raise ErroAdmin(f"ação inválida: {acao!r} (esperado uma de {', '.join(dec.ACOES)})")
    nome, just = (por_nome or "").strip(), (justificativa or "").strip()
    if not nome:
        raise ErroAdmin("decisão de pessoa exige o nome de quem decidiu")
    if not just:
        raise ErroAdmin("justificativa vazia: toda decisão diz por quê")
    if not isinstance(aplicar, bool):
        raise ErroAdmin(f"aplicar: esperado booleano, veio {aplicar!r}")
    return {"pendencia_id": _uuid(pendencia_id, "identificador de pendência"), "acao": acao, "por_nome": nome, "justificativa": just, "valor": valor, "aplicar": aplicar}


def normalizar(tipo: str, parametros: Any) -> dict[str, Any]:
    """Normaliza os parâmetros de um tipo de `adm_pedidos`. Serve a `pedir` e ao executor (a central insere o JSON como quiser: o que não bate com o formato é recusado na execução)."""
    if tipo == "rodada":
        p = _chaves(parametros, {"coletor", "modo", "recorte", "repetir", "so_pendencias"}, tipo)
        return parametros_rodada(**p)
    if tipo == "recoleta":
        p = _chaves(parametros, {"classe", "territorio"}, tipo)
        return parametros_recoleta(classe=p.get("classe"), territorio=p.get("territorio") or {})  # type: ignore[arg-type]
    if tipo == "parecer":
        return parametros_parecer(**_chaves(parametros, {"pendencia_id", "rodada_id"}, tipo))
    raise ErroAdmin(f"tipo de pedido inválido: {tipo!r} (esperado um de {', '.join((*TIPOS, TIPO_DECISAO))})")


def chave_idem(tipo: str, parametros: dict[str, Any]) -> str:
    """sha256 hexadecimal do JSON canônico de `{"tipo", "parametros"}` (ver o docstring do módulo). `parametros` já normalizados; para `decisao`, só `CHAVE_DECISAO` entra."""
    if tipo == TIPO_DECISAO:
        parametros = {k: parametros.get(k) for k in CHAVE_DECISAO}
    return hashlib.sha256(_json_canonico({"tipo": tipo, "parametros": parametros}).encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ pedir


def _pedido_dict(tabela: str, row: dict[str, Any]) -> dict[str, Any]:
    return {"tabela": tabela, **{k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in row.items()}}


def pedir(conn: Any, tipo: str, parametros: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Grava o pedido na fila e devolve `(pedido, novo)`. Pedido igual `na_fila` ou `em_execucao`: devolve ESSE, `novo=False`, sem erro. NÃO comita (a CLI comita).
    `tipo` = rodada | recoleta | parecer (`adm_pedidos`) ou `decisao` (`adm_pedidos_decisao`, com `parametros_decisao`: pendencia_id, acao, por_nome, justificativa, valor, aplicar)."""
    if tipo not in TABELA:
        raise ErroAdmin(f"tipo de pedido inválido: {tipo!r} (esperado um de {', '.join(TABELA)})")
    if tipo == TIPO_DECISAO:
        p = parametros_decisao(**_chaves(parametros, {"pendencia_id", "acao", "por_nome", "justificativa", "valor", "aplicar"}, tipo))
        if conn.execute("select 1 from adm_pendencias where id = %s", (p["pendencia_id"],)).fetchone() is None:
            raise ErroAdmin(f"pendência inexistente: {p['pendencia_id']}")
        chave = chave_idem(tipo, p)
        ins = (SQL_INSERIR_PEDIDO_DECISAO, (p["pendencia_id"], p["acao"], p["por_nome"], p["justificativa"], Jsonb(p["valor"]) if p["valor"] is not None else None, p["aplicar"], chave))
        sel = (SQL_PEDIDO_DECISAO_ATIVO, (chave,))
    else:
        p = normalizar(tipo, parametros)
        chave = chave_idem(tipo, p)
        ins, sel = (SQL_INSERIR_PEDIDO, (tipo, Jsonb(p), chave)), (SQL_PEDIDO_ATIVO, (chave,))
    for _ in range(3):  # o pedido igual pode terminar entre o insert e o select: tenta de novo
        row = conn.execute(*ins).fetchone()
        if row is not None:
            return _pedido_dict(TABELA[tipo], row), True
        row = conn.execute(*sel).fetchone()
        if row is not None:
            return _pedido_dict(TABELA[tipo], row), False
    raise ErroAdmin("não consegui gravar nem encontrar o pedido (concorrência): tente de novo")


# ------------------------------------------------------------------ pegar (um lock por candidato, sem `for update` sobre union)

SQL_CANDIDATOS = """select 'adm_pedidos' as tabela, id, criado_em from adm_pedidos where status = 'na_fila'
union all select 'adm_pedidos_decisao', id, criado_em from adm_pedidos_decisao where status = 'na_fila'
order by criado_em, id limit %s"""


def travar(conn: Any) -> dict[str, Any] | None:
    """Trava (`for update skip locked`) o pedido `na_fila` mais antigo que nenhum outro executor segura. NÃO marca e NÃO comita: o lock vale até o commit/rollback de `conn`.
    Devolve a linha inteira com `tabela`, ou None."""
    for c in conn.execute(SQL_CANDIDATOS, (CANDIDATOS,)).fetchall():
        tabela = c["tabela"]
        assert tabela in TABELAS
        row = conn.execute(f"select * from {tabela} where id = %s and status = 'na_fila' for update skip locked", (c["id"],)).fetchone()  # noqa: S608 (nome fixo)
        if row is not None:
            return {"tabela": tabela, **row}
    return None


def marcar(conn: Any, p: dict[str, Any]) -> dict[str, Any]:
    """Marca o pedido travado como `em_execucao` (com `iniciado_em` e o primeiro `batimento_em`) e COMITA (solta o lock; o pedido já está visível como em execução)."""
    t = p["tabela"]
    conn.execute(f"update {t} set status = 'em_execucao', iniciado_em = clock_timestamp(), batimento_em = clock_timestamp() where id = %s and status = 'na_fila'", (p["id"],))  # noqa: S608
    conn.commit()
    return p


def pegar(conn: Any) -> dict[str, Any] | None:
    """`travar` + `marcar`: o próximo pedido, já `em_execucao` e comitado; None se não há."""
    p = travar(conn)
    if p is None:
        conn.rollback()
        return None
    return marcar(conn, p)


# ------------------------------------------------------------------ órfãos


def limpar_orfaos(conn: Any, *, agora: Any = None, limite_s: float = LIMITE_BATIMENTO_S) -> list[dict[str, Any]]:
    """Pedido `em_execucao` com o último sinal (`batimento_em`, senão `iniciado_em`) mais velho que `limite_s` vira `interrompido`; a rodada ligada, se `em_andamento`, vira `interrompida`
    por `rodadas.recuperar` (só com a trava livre). Sem pedido vencido, não escreve nada. Comita. Devolve um item por pedido: `{tabela, id, rodada_id, rodada}`."""
    achados: list[dict[str, Any]] = []
    for t in TABELAS:
        col = "rodada_id" if t == "adm_pedidos" else "null::uuid as rodada_id"
        rows = conn.execute(
            f"select id, {col}, coalesce(batimento_em, iniciado_em, criado_em) as ultimo from {t} where status = 'em_execucao' "  # noqa: S608
            "and coalesce(batimento_em, iniciado_em, criado_em) < coalesce(%s::timestamptz, clock_timestamp()) - make_interval(secs => %s::double precision) "
            "order by criado_em, id for update skip locked", (agora, limite_s)).fetchall()
        for r in rows:
            erro = f"executor ausente: o pedido estava em execução sem batimento desde {r['ultimo']:%Y-%m-%d %H:%M:%S}Z (limite {limite_s:g} s)"
            conn.execute(f"update {t} set status = 'interrompido', finalizado_em = clock_timestamp(), erro = %s where id = %s and status = 'em_execucao'", (erro, r["id"]))  # noqa: S608
            achados.append({"tabela": t, "id": str(r["id"]), "rodada_id": str(r["rodada_id"]) if r["rodada_id"] else None, "rodada": None})
    conn.commit()
    for a in achados:
        if not a["rodada_id"]:
            continue
        st = conn.execute("select status from adm_rodadas where id = %s", (a["rodada_id"],)).fetchone()
        conn.rollback()
        if st is None or st["status"] != "em_andamento":
            a["rodada"] = f"rodada {st['status'] if st else 'inexistente'}: nada a recuperar"
            continue
        try:
            a["rodada"] = rod.recuperar(conn, a["rodada_id"])["status"]
        except ErroAdmin as e:  # trava consultiva tomada: há executor vivo da rodada; o motivo fica no pedido
            conn.rollback()
            a["rodada"] = f"não recuperada: {e}"
            conn.execute("update adm_pedidos set erro = erro || %s where id = %s", (f"; a rodada {a['rodada_id']} {a['rodada']}", a["id"]))
            conn.commit()
    return achados


# ------------------------------------------------------------------ batimento


def _fabrica_de(conn: Any) -> Callable[[], Any]:
    """Conexão nova (autocommit) para o mesmo banco e usuário de `conn`."""
    info = conn.info
    dsn = make_conninfo(info.dsn, password=info.password) if info.password else info.dsn
    return lambda: psycopg.connect(dsn, autocommit=True)


class Batimento(threading.Thread):
    """Thread que atualiza `batimento_em` do pedido a cada `intervalo` segundos, em conexão própria. Falha de conexão não derruba o executor: é contada em `falhas` e tentada de novo."""

    def __init__(self, fabrica: Callable[[], Any], tabela: str, pedido_id: Any, intervalo: float):
        super().__init__(name=f"batimento-{pedido_id}", daemon=True)
        assert tabela in TABELAS
        self.fabrica, self.tabela, self.pedido_id, self.intervalo = fabrica, tabela, pedido_id, intervalo
        self._parar = threading.Event()
        self.batidas = 0
        self.falhas: list[str] = []

    def run(self) -> None:
        c = None
        while not self._parar.wait(self.intervalo):
            try:
                if c is None:
                    c = self.fabrica()
                c.execute(f"update {self.tabela} set batimento_em = clock_timestamp() where id = %s and status = 'em_execucao'", (self.pedido_id,))  # noqa: S608
                self.batidas += 1
            except Exception as e:  # noqa: BLE001
                self.falhas.append(f"{type(e).__name__}: {e}"[:200])
                with contextlib.suppress(Exception):
                    c.close()  # type: ignore[union-attr]
                c = None
        if c is not None:
            with contextlib.suppress(Exception):
                c.close()

    def parar(self) -> None:
        self._parar.set()
        if self.is_alive():
            self.join(timeout=10)


# ------------------------------------------------------------------ desfecho e andamento


def _andamento(conn: Any, p: dict[str, Any], etapa: str, mensagem: str, **mais: Any) -> dict[str, Any]:
    """Grava e comita o andamento do pedido (só `adm_pedidos` tem a coluna). Devolve o documento."""
    doc = _json({"etapa": etapa, "mensagem": mensagem, **mais})
    if p["tabela"] == "adm_pedidos":
        conn.execute("update adm_pedidos set andamento = %s where id = %s and status = 'em_execucao'", (Jsonb(doc), p["id"]))
        conn.commit()
    return doc


def _finalizar(conn: Any, p: dict[str, Any], status: str, erro: str | None, *, rodada_id: Any = None, decisao_id: Any = None, andamento: dict[str, Any] | None = None) -> bool:
    """Estado final do pedido. False se o pedido já não estava `em_execucao` (outro executor o declarou `interrompido`). Não comita."""
    if p["tabela"] == "adm_pedidos":
        r = conn.execute("update adm_pedidos set status = %s, erro = %s, finalizado_em = clock_timestamp(), rodada_id = coalesce(%s, rodada_id), andamento = coalesce(%s, andamento) "
                         "where id = %s and status = 'em_execucao' returning id", (status, erro, rodada_id, Jsonb(andamento) if andamento is not None else None, p["id"]))
    else:
        r = conn.execute("update adm_pedidos_decisao set status = %s, erro = %s, finalizado_em = clock_timestamp(), decisao_id = coalesce(%s, decisao_id) "
                         "where id = %s and status = 'em_execucao' returning id", (status, erro, decisao_id, p["id"]))
    return r.fetchone() is not None


def _saida(status: str, erro: str | None = None, **mais: Any) -> dict[str, Any]:
    return {"status": status, "erro": erro, "rodada_id": None, "decisao_id": None, "andamento": None, **mais}


def _falhou(erro: str, **mais: Any) -> dict[str, Any]:
    return _saida("falhou", erro, **mais)


# ------------------------------------------------------------------ tipos de pedido


def _do_resultado_da_rodada(res: dict[str, Any], rid: str) -> dict[str, Any]:
    st = res.get("status")
    prop = res.get("propostas") or {}
    resumo = {"rodada_id": rid, "status_da_rodada": st, "motivo": res.get("motivo"), "codigo_saida": res.get("codigo_saida"),
              "propostas": {k: (len(prop[k]) if isinstance(prop.get(k), list) else prop.get(k)) for k in ("executado", "novas", "pendencias_abertas", "pendencias_reabertas", "erro") if k in prop}}
    if st == "concluida":
        return _saida("concluido", rodada_id=rid, andamento=_json({"etapa": "concluido", "mensagem": "rodada concluída", **resumo}))
    status, erro = ("interrompido", f"rodada interrompida: {res.get('motivo') or res.get('interrupcao') or 'sem motivo registrado'}") if st == "interrompida" \
        else ("falhou", f"rodada {st}: {res.get('motivo') or 'sem motivo registrado'}")
    return _saida(status, erro, rodada_id=rid, andamento=_json({"etapa": status, "mensagem": erro, **resumo}))


def _executar_rodada(conn: Any, p: dict[str, Any], rid: str, runner: Callable[[list[str]], int] | None) -> dict[str, Any]:
    _andamento(conn, p, "executando_rodada", f"executando a rodada {rid}", rodada_id=rid)
    try:
        res = rod.executar(conn, rid, runner=runner)
    except ErroAdmin as e:  # trava tomada, rodada em estado que não se executa
        conn.rollback()
        return _falhou(str(e), rodada_id=rid)
    return _do_resultado_da_rodada(res, rid)


def _ligar_rodada(conn: Any, p: dict[str, Any], rid: str) -> None:
    conn.execute("update adm_pedidos set rodada_id = %s where id = %s and status = 'em_execucao'", (rid, p["id"]))
    conn.commit()


def _rodada(conn: Any, p: dict[str, Any], runner: Callable[[list[str]], int] | None) -> dict[str, Any]:
    try:
        par_ = normalizar("rodada", p["parametros"])
    except ErroAdmin as e:
        return _falhou(str(e))
    if "repetir" in par_:
        _andamento(conn, p, "abrindo_rodada", f"repetindo a rodada {par_['repetir']}")
        try:
            r = rod.repetir(conn, par_["repetir"], so_pendencias=par_["so_pendencias"], executar_agora=False)  # comita
        except ErroAdmin as e:
            conn.rollback()
            return _falhou(str(e))
        if r.get("rodada_id") is None:
            return _saida("concluido", andamento=_json({"etapa": "concluido", "mensagem": r.get("mensagem") or "nenhuma pendência: nenhuma rodada aberta"}))
        rid = str(r["rodada_id"])
    else:
        try:
            _coletor(par_["coletor"])
        except KeyError as e:
            return _falhou(str(e.args[0]))
        _andamento(conn, p, "abrindo_rodada", f"abrindo a rodada de {par_['coletor']}")
        rc = par_["recorte"]
        try:
            rid = rod.abrir(conn, par_["coletor"], Recorte(**rc, modo=par_["modo"]))
        except ErroAdmin as e:
            conn.rollback()
            return _falhou(str(e))
        conn.commit()
    _ligar_rodada(conn, p, rid)
    return _executar_rodada(conn, p, rid, runner)


def _pendencias_do_territorio(conn: Any, classe: str, ibge: str, nivel: str) -> list[dict[str, Any]]:
    """Pendências ABERTAS da classe cujo registro cai no território pedido, pela regra de território da classe (`classes.py`), na ordem de criação."""
    c = CLASSES[classe]
    rows = conn.execute("select id, registro_chave, campo from adm_pendencias where classe = %s and status = 'aberta' order by criada_em, id", (classe,)).fetchall()
    return [r for r in rows if c.territorio(conn, r["registro_chave"]) == {"ibge_code": ibge, "nivel": nivel}]


def _recoleta(conn: Any, p: dict[str, Any], runner: Callable[[list[str]], int] | None) -> dict[str, Any]:
    try:
        par_ = normalizar("recoleta", p["parametros"])
    except ErroAdmin as e:
        return _falhou(str(e))
    classe, ibge, nivel = par_["classe"], par_["territorio"]["ibge"], par_["territorio"]["nivel"]
    if classe == "identidade":
        return _falhou("a classe identidade não tem território de coleta: a fila de identidade não nasce de uma coleta por território (decida a pendência ou peça o parecer)")
    _andamento(conn, p, "procurando_pendencias", f"pendências abertas de {classe} no território {nivel} {ibge}")
    pend = _pendencias_do_territorio(conn, classe, ibge, nivel)
    if not pend:
        return _saida("concluido", andamento=_json({"etapa": "concluido", "mensagem": "nenhuma pendência aberta neste território e classe", "classe": classe, "territorio": par_["territorio"]}))
    if classe == "contato_mandato":
        coletor, recorte = "parlamento.extras", Recorte()  # o coletor só aceita `ano`: não há recorte territorial (a rodada relê todos os mandatos que ele cobre)
    elif nivel == "municipio":
        coletor = "sapl.camaras"
        try:
            recorte = Recorte(ibges=(ibge,), modo="recoletar")
        except ValueError as e:
            return _falhou(f"território inválido: {e}")
    elif nivel == "uf":
        uf = conn.execute("select uf from places where kind = 'uf' and ibge_code = %s", (ibge,)).fetchone()
        if uf is None or not uf["uf"]:
            return _falhou(f"território inválido: nenhuma UF com ibge_code {ibge!r} em places")
        coletor, recorte = "sapl.assembleias", Recorte(ufs=(uf["uf"],), modo="recoletar")
    else:
        return _falhou(f"nenhum coletor recoleta {classe} no nível {nivel}: só município (sapl.camaras) e UF (sapl.assembleias)")
    evid = [r["url"] for r in conn.execute(
        "select distinct pr.url from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id where pp.pendencia_id = any(%s::uuid[]) order by pr.url",
        ([str(x["id"]) for x in pend],)).fetchall()]
    try:
        entradas = {i["url"] for i in rod.previa(conn, coletor, recorte).get("urls_entrada") or []}
    except (ErroAdmin, KeyError, ValueError) as e:
        conn.rollback()
        return _falhou(f"recorte recusado: {e}")
    conn.rollback()
    forcar = [u for u in evid if u in entradas]
    fora = [u for u in evid if u not in entradas]
    _andamento(conn, p, "abrindo_rodada", f"{len(pend)} pendências abertas; abrindo a rodada de {coletor}", coletor=coletor, pendencias=[str(x["id"]) for x in pend], forcar_urls=forcar,
                     forcar_urls_fora_da_entrada=({"urls": fora, "motivo": "a releitura forçada só vale para URL de entrada da rodada; estas ficam no cache comum"} if fora else None))
    try:
        rid = rod.abrir(conn, coletor, recorte, forcar_urls=forcar)
    except ErroAdmin as e:
        conn.rollback()
        return _falhou(str(e))
    conn.commit()
    _ligar_rodada(conn, p, rid)
    return _executar_rodada(conn, p, rid, runner)


def _parecer(conn: Any, p: dict[str, Any]) -> dict[str, Any]:
    try:
        par_ = normalizar("parecer", p["parametros"])
    except ErroAdmin as e:
        return _falhou(str(e))
    pid = str(p["id"])
    try:
        if "pendencia_id" in par_:
            ids = [par_["pendencia_id"]]
        else:
            ids = par.pendencias_da_rodada(conn, par_["rodada_id"])
        conn.rollback()
        if not ids:
            return _saida("concluido", andamento=_json({"etapa": "concluido", "mensagem": "nenhuma pendência aberta ligada a propostas da rodada", "pareceres": 0}))
        feitos: list[str] = []
        for i, pendencia in enumerate(ids, 1):
            _andamento(conn, p, "parecer", f"parecer {i} de {len(ids)} (ensaio local)", n=i, de=len(ids), pendencia_id=pendencia)
            g = par.gerar(conn, pendencia, pedido_id=pid, motor=par.motor_ensaio_local)  # só o motor de ensaio local: nunca real, nunca cliente de modelo
            conn.commit()
            feitos.append(g["id"])
    except ErroAdmin as e:
        conn.rollback()
        return _falhou(str(e))
    return _saida("concluido", andamento=_json({"etapa": "concluido", "mensagem": f"{len(feitos)} pareceres em modo ensaio (simulado); nada foi aplicado", "pareceres": len(feitos), "ids": feitos}))


def _decisao(conn: Any, pedido_id: str) -> dict[str, Any]:
    # Recebe só o id e relê a linha do banco: nenhuma função do caminho até `aplicar` (e daí a `chaves_dos_agentes`) aceita mapeamento como
    # parâmetro (critério 9; test_admin_chaves.py::test_A). A linha é a do pedido já marcado `em_execucao` por este executor.
    row = conn.execute("select * from adm_pedidos_decisao where id = %s and status = 'em_execucao'", (pedido_id,)).fetchone()
    if row is None:
        return _falhou(f"pedido de decisão {pedido_id} não está em execução")
    p = _pedido_dict("adm_pedidos_decisao", row)
    if chave_idem(TIPO_DECISAO, p) != p["chave_idem"]:  # a central escolhe a chave ao inserir: o executor não confia nela (G4-1)
        return _falhou(MOTIVO_CHAVE)
    acao, aplicar = p["acao"], bool(p["aplicar"])
    if aplicar and acao not in dec.ACOES_QUE_APLICAM:
        return _falhou(f"aplicar não vale com {acao}: só aprovar e corrigir aplicam")
    try:
        with conn.transaction():  # decisão + aplicação + estado final: tudo ou nada
            d = dec.decidir(conn, p["pendencia_id"], acao=acao, por_tipo="pessoa", por_nome=p["por_nome"], justificativa=p["justificativa"], valor=p["valor"])
            if aplicar:
                apl.aplicar(conn, d["id"])
            if not _finalizar(conn, p, "concluido", None, decisao_id=d["id"]):
                raise _Perdido()
    except _Perdido:
        return _saida("concluido", None, decisao_id=None, finalizado=True, finalizacao_perdida=True)
    except (ErroAdmin, psycopg.Error) as e:
        conn.rollback()
        return _falhou(str(e).strip())
    return _saida("concluido", None, decisao_id=str(d["id"]), finalizado=True)


class _Perdido(Exception):
    """O pedido deixou de estar `em_execucao` (outro executor o declarou interrompido): a decisão não pode ficar gravada."""


def _despachar(conn: Any, tabela: str, pedido_id: str, runner: Callable[[list[str]], int] | None) -> dict[str, Any]:
    # Só tabela e id (escalares): o caminho até `aplicar` não aceita mapeamento como parâmetro (critério 9). A linha é relida do banco.
    if tabela == "adm_pedidos_decisao":
        return _decisao(conn, pedido_id)
    if tabela != "adm_pedidos":
        return _falhou(f"tabela de pedido desconhecida: {tabela!r}")
    row = conn.execute("select * from adm_pedidos where id = %s and status = 'em_execucao'", (pedido_id,)).fetchone()
    if row is None:
        return _falhou(f"pedido {pedido_id} não está em execução")
    p = _pedido_dict("adm_pedidos", row)
    t = p["tipo"]
    if t in TIPOS:
        try:
            normalizados = normalizar(t, p["parametros"])
        except ErroAdmin:
            normalizados = None  # parâmetros que não normalizam falham no tipo, com a própria mensagem
        if normalizados is not None and chave_idem(t, normalizados) != p["chave_idem"]:
            return _falhou(MOTIVO_CHAVE)
    if t == "rodada":
        return _rodada(conn, p, runner)
    if t == "recoleta":
        return _recoleta(conn, p, runner)
    if t == "parecer":
        return _parecer(conn, p)
    return _falhou(f"tipo de pedido desconhecido: {t!r}")


# ------------------------------------------------------------------ encerramento por sinal


class ExecutorEncerrado(BaseException):
    """Lançada pelo tratador de SIGTERM/SIGINT na thread principal enquanto há pedido em execução. BaseException: `except Exception` do código de coleta não a engole."""

    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo


class Encerramento:
    """Estado do encerramento pedido por sinal. `parar` é o evento do laço; `interrompivel` só é verdadeiro enquanto há pedido `em_execucao` com batimento ligado (é aí, e só aí, que o tratador
    interrompe a thread principal; fora disso apenas pede a saída, e o pedido nunca fica `em_execucao` sem desfecho)."""

    def __init__(self, parar: threading.Event):
        self.parar = parar
        self.motivo = ""
        self.interrompivel = False

    def pedir(self, nome: str) -> None:
        self.motivo = f"executor encerrado ({nome})"
        self.parar.set()

    def tratador(self, signum: int, _frame: Any) -> None:
        self.pedir(signal.Signals(signum).name)
        if self.interrompivel:
            self.interrompivel = False
            raise ExecutorEncerrado(self.motivo)


# ------------------------------------------------------------------ executar um pedido


def executar_um(conn: Any, *, agora: Any = None, runner: Callable[[list[str]], int] | None = None, batimento_s: float = BATIMENTO_S,
                conn_factory: Callable[[], Any] | None = None, encerramento: Encerramento | None = None) -> dict[str, Any] | None:
    """Limpa órfãos, pega o pedido mais antigo (das duas tabelas), executa e grava o desfecho. None se não há pedido `na_fila`. Comita sozinho.
    `agora` (relógio do banco por padrão) só vale para o limite de órfãos (teste); `runner` é repassado a `rodadas.executar` (teste); `batimento_s` é o intervalo do batimento (teste)."""
    conn.rollback()
    orfaos = limpar_orfaos(conn, agora=agora)
    p = pegar(conn)
    if p is None:
        return None
    bat = Batimento(conn_factory or _fabrica_de(conn), p["tabela"], p["id"], batimento_s)
    bat.start()
    try:
        try:
            if encerramento is not None:
                encerramento.interrompivel = True
                if encerramento.parar.is_set():  # o sinal chegou entre pegar o pedido e ligar o batimento: não se perde
                    raise ExecutorEncerrado(encerramento.motivo)
            s = _despachar(conn, p["tabela"], str(p["id"]), runner)
        except Exception as e:  # noqa: BLE001 - bug ou erro de infraestrutura: o pedido falha com o motivo e o laço continua
            with contextlib.suppress(Exception):
                conn.rollback()
            s = _falhou(f"erro inesperado: {type(e).__name__}: {e}"[:500])
        except BaseException as e:
            if encerramento is not None:
                encerramento.interrompivel = False
            bat.parar()
            with contextlib.suppress(Exception):
                conn.rollback()
                _finalizar(conn, p, "interrompido", e.motivo if isinstance(e, ExecutorEncerrado) else f"executor interrompido: {type(e).__name__}")
                conn.commit()
            raise
    finally:
        if encerramento is not None:
            encerramento.interrompivel = False
        bat.parar()
    perdida = bool(s.get("finalizacao_perdida"))
    if not s.get("finalizado"):
        conn.rollback()
        perdida = not _finalizar(conn, p, s["status"], s["erro"], rodada_id=s["rodada_id"], decisao_id=s["decisao_id"], andamento=s["andamento"])
    conn.commit()
    return {"tabela": p["tabela"], "id": str(p["id"]), "tipo": p.get("tipo") or TIPO_DECISAO, "status": s["status"], "erro": s["erro"], "rodada_id": s["rodada_id"], "decisao_id": s["decisao_id"],
            "andamento": s["andamento"], "batidas": bat.batidas, "falhas_do_batimento": bat.falhas, "finalizacao_perdida": perdida, "orfaos": orfaos}


def laco(conn_factory: Callable[[], Any], *, intervalo: float = 2.0, uma_vez: bool = False, runner: Callable[[list[str]], int] | None = None, batimento_s: float = BATIMENTO_S,
         parar: threading.Event | None = None, aviso: Callable[[str], None] | None = None) -> dict[str, Any] | None:
    """O laço do executor. `uma_vez`: processa no máximo um pedido e devolve o resultado (ou None). Sem `uma_vez` roda até `parar` ser sinalizado ou até SIGTERM/SIGINT e devolve None.
    SIGTERM/SIGINT (instalados só na thread principal; os tratadores anteriores voltam ao sair): para de pegar pedido; sem pedido em execução sai na hora; com pedido em execução o batimento
    para e o pedido vira `interrompido` com o motivo "executor encerrado (SIGTERM)" antes de sair (a tela não espera os 120 s). Saída normal (código 0).
    Conexão perdida: reabre no ciclo seguinte (o pedido em execução fica sem batimento e é interrompido pelo próximo executor)."""
    parar = parar or threading.Event()
    enc = Encerramento(parar)
    dizer = aviso or (lambda _m: None)
    anteriores: dict[int, Any] = {}
    if threading.current_thread() is threading.main_thread():
        for sg in (signal.SIGTERM, signal.SIGINT):
            anteriores[sg] = signal.signal(sg, enc.tratador)
    conn = None
    try:
        while not parar.is_set():
            try:
                if conn is None:
                    conn = conn_factory()
                r = executar_um(conn, runner=runner, batimento_s=batimento_s, encerramento=enc)
            except psycopg.OperationalError as e:
                dizer(f"executor: banco indisponível ({e}); tento de novo em {intervalo:g} s")
                with contextlib.suppress(Exception):
                    conn.close()  # type: ignore[union-attr]
                conn = None
                if uma_vez:
                    raise ErroAdmin(f"sem conexão com o banco: {e}") from None
                parar.wait(intervalo)
                continue
            if r is not None:
                dizer(f"pedido {r['tipo']} {r['id']}: {r['status']}" + (f" ({r['erro']})" if r["erro"] else ""))
            if uma_vez:
                return r
            if r is None:
                parar.wait(intervalo)
        dizer(f"{enc.motivo or 'executor: parada pedida'}")
    except ExecutorEncerrado as e:
        dizer(f"{e.motivo}: pedido em execução marcado como interrompido")
    except KeyboardInterrupt:
        dizer("executor: interrompido")
    finally:
        for sg, h in anteriores.items():
            signal.signal(sg, h)
        if conn is not None:
            with contextlib.suppress(Exception):
                conn.close()
    return None


# ------------------------------------------------------------------ estado (o que a central lê)


def estado_dos_pedidos(conn: Any, *, agora: Any = None, fila_s: float = LIMITE_FILA_S, batimento_s: float = LIMITE_BATIMENTO_S) -> dict[str, Any]:
    """Contagens por estado, os pedidos ativos e `executor_parado: {sim, motivo, desde, mensagem, ...}` (`SQL_EXECUTOR_PARADO`, uma consulta só). Só lê."""
    contagens: dict[str, dict[str, int]] = {}
    for t in TABELAS:
        contagens[t] = {r["status"]: r["n"] for r in conn.execute(f"select status, count(*) as n from {t} group by status order by status").fetchall()}  # noqa: S608
    ativos = [_pedido_dict(r["tabela"], {k: v for k, v in r.items() if k != "tabela"}) for r in conn.execute(SQL_ATIVOS).fetchall()]
    e = conn.execute(SQL_EXECUTOR_PARADO, {"agora": agora, "fila_s": fila_s, "batimento_s": batimento_s}).fetchone()
    if e["sim"]:
        if e["motivo"] == "batimento_vencido":
            msg = f"executor parado: pedido em execução sem batimento há mais de {batimento_s:g} s (último sinal em {e['desde']:%Y-%m-%d %H:%M:%S}Z)"
        else:
            msg = f"executor parado: pedido na fila há mais de {fila_s:g} s sem ser pego (o mais antigo entrou em {e['desde']:%Y-%m-%d %H:%M:%S}Z)"
            if e["executor_ocupado"]:
                msg += "; há outro pedido em execução com batimento em dia (o executor pode estar ocupado com uma rodada longa)"
    else:
        msg = "executor em dia: nenhum pedido na fila há mais de %g s nem em execução sem batimento" % fila_s
    parado = {"sim": bool(e["sim"]), "motivo": e["motivo"], "desde": e["desde"], "mensagem": msg, "executor_ocupado": bool(e["executor_ocupado"]),
              "n_fila_velha": e["n_fila_velha"], "n_batimento_vencido": e["n_batimento_vencido"], "limites": {"fila_s": fila_s, "batimento_s": batimento_s}}
    return {"contagens": contagens, "ativos": ativos, "executor_parado": parado, "em": e["agora"]}
