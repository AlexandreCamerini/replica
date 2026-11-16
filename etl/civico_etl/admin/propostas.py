"""Propostas de mudança (Parte B): entrada com recusa do que vem sem evidência, abertura e reabertura de pendências.

Cada proposta carrega: chave do registro, campo, valor vigente, valor candidato, URL, trecho (ou caminho no documento), hash do conteúdo, data de leitura,
data declarada pela fonte e alcance (do registro, ou regra compartilhada com critério e lista de ids). `valor_vigente` NÃO é informado por quem propõe: é lido da
tabela de domínio no momento do registro (`classes.valor_vigente`), assim ninguém inventa o vigente. Em página de diretório o bloco do registro é obrigatório
para `contato_mandato` (contato de rodapé é da Casa, não do parlamentar).

TRANSAÇÃO: nenhuma função deste módulo comita nem faz rollback por conta própria; quem chama decide (a CLI usa um savepoint por proposta e comita no fim).
NADA é aplicado às tabelas de domínio: este módulo só LÊ `sapl_houses`, `data_coverage`, `mandate_contacts`, `identity_match_queue` e vizinhas, e só ESCREVE em
`adm_propostas`, `adm_pendencias` e `adm_pendencia_propostas`.

Entrada (`validar`): recusa com `PropostaRecusada(motivo)` ANTES de qualquer escrita (nem proposta, nem pendência: é "antes da fila") quando faltar URL http(s), trecho,
hash de 64 hexadecimais ou data de leitura; quando classe, campo ou registro forem inválidos; quando o valor candidato for nulo ou fora do domínio do campo;
quando o alcance 'regra' vier sem critério, sem lista de ids, com id inexistente ou sem o próprio registro; quando faltar o bloco em `contato_mandato`; quando a data
declarada pela fonte estiver no futuro; e quando `rodada_id` não existir (a chave estrangeira exigiria). O candidato nulo é recusado: ausência de valor não se propõe.

Regras de decisão em `registrar` (uma pendência por classe+registro+campo; unique da 0150):
 1. candidato = vigente (e vigente não nulo) e nenhuma pendência do campo: só a proposta ("campo confirmado pela fonte"); nenhuma pendência.
 2. sem pendência e candidato diferente do vigente (ou vigente nulo): cria pendência `aberta`, tipo `mudanca` (`confirmacao` quando o campo não aceita override:
    `base_url` de Assembleia), com a pergunta da classe, `evidencia_sha` = hash da proposta, `vigente_sha`, `vence_em` = agora + prazo da classe. Também liga as
    propostas mais recentes, de OUTRAS URLs, que confirmam o vigente de agora: fonte A confirma o vigente e fonte B difere é divergência (dois valores), não mudança.
 3. pendência `aberta`: liga a proposta e recalcula. Se a última proposta de cada URL traz candidatos diferentes entre si, o tipo vira `divergencia` e a pergunta cita
    todos os valores com as datas de leitura (uma pendência, dois valores, nenhum aplicado); se não, o tipo volta ao básico (`mudanca` ou `confirmacao`; `duplicata` fica).
    `evidencia_sha` passa a ser o hash da proposta mais recente ligada; `vigente_sha` acompanha o vigente lido agora.
 4. pendência `decidida`: reabre (`aberta`, `reaberta = true`) SE o hash da proposta difere de `evidencia_sha` (motivo `evidencia_mudou`) ou se o vigente lido agora
    difere de `vigente_sha` (motivo `registro_mudou`); atualiza os dois sha, o tipo, a pergunta e `vence_em`. Hash ou sha desconhecido (nulo) conta como mudou: nunca se
    presume que nada mudou. Se nada mudou, só liga a proposta e a pendência continua decidida.
`reavaliar` cobre o caso de o job regravar a tabela sem nova proposta (`registro_mudou`).

Idempotência: `chave_idem` = sha256 de (classe, registro, campo, candidato canônico, url, hash); repetir a proposta (inclusive de outra rodada) não cria nem altera nada.
Consequência: a repetição de uma rodada não cria proposta nova, então as propostas dela continuam com o `rodada_id` da rodada de origem.

`cobertura_recorte`: ao criar ou reabrir pendência a partir de proposta com `rodada_id`, grava alcançados/elegíveis do painel da coleta (`relatorio.relatorio`); nulo quando
o denominador é nulo ou zero (rodada sem lista de elegíveis, coletor sem tentativas registradas).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field, fields
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Jsonb

from ..util import sha256_text
from . import relatorio as rel
from .classes import CLASSES, ORDEM_CLASSES, canonico, http
from .saida import ErroAdmin

_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
_OBRIGATORIOS = ("classe", "registro_chave", "campo", "valor_candidato", "url", "trecho", "conteudo_sha256", "lida_em")


class PropostaRecusada(ErroAdmin):
    """A proposta não entra: o motivo é a mensagem. Nada foi gravado."""


@dataclass
class Proposta:
    classe: str
    registro_chave: str
    campo: str
    valor_candidato: Any
    url: str
    trecho: str
    conteudo_sha256: str
    lida_em: datetime | str | None
    fonte_declarada_em: datetime | str | None = None
    fonte_slug: str | None = None
    alcance: str = "registro"
    regra_criterio: str | None = None
    regra_ids: list[str] | None = None
    bloco: str | None = None
    rodada_id: str | None = None

    @classmethod
    def de_dict(cls, d: Any) -> "Proposta":
        """Objeto JSON -> Proposta. Chave desconhecida é recusada (erro de digitação não passa em silêncio); chave obrigatória ausente também."""
        if not isinstance(d, dict):
            raise PropostaRecusada(f"a proposta tem de ser um objeto JSON (veio {type(d).__name__})")
        nomes = {f.name for f in fields(cls)}
        extra = sorted(set(d) - nomes)
        if extra:
            raise PropostaRecusada(f"campo desconhecido na proposta: {', '.join(extra)}")
        falta = [k for k in _OBRIGATORIOS if k not in d]
        if falta:
            raise PropostaRecusada(f"campo obrigatório ausente: {', '.join(falta)}")
        return cls(**d)


@dataclass
class Resultado:
    nova: bool
    proposta_id: str
    pendencia_id: str | None = None
    pendencia_acao: str = "nenhuma"  # nenhuma | criada | ligada | reaberta | ligada_decidida
    tipo: str | None = None
    motivo_reabertura: str | None = None
    confirmada_pela_fonte: bool = False

    def para_dict(self) -> dict[str, Any]:
        return {"nova": self.nova, "proposta_id": self.proposta_id, "pendencia": {"id": self.pendencia_id, "acao": self.pendencia_acao, "tipo": self.tipo,
                                                                                "motivo_reabertura": self.motivo_reabertura},
                "confirmada_pela_fonte": self.confirmada_pela_fonte}


@dataclass
class _Pronta:
    """Proposta validada e normalizada (hash em minúsculas, datas com fuso, lista de ids ordenada)."""
    p: Proposta
    lida_em: datetime
    declarada_em: datetime | None
    sha: str
    regra_ids: list[str] | None = field(default=None)


# ------------------------------------------------------------------ validação


def _texto(v: Any) -> str | None:
    return v if isinstance(v, str) and v.strip() else None


def _data(v: Any, nome: str, *, obrigatoria: bool) -> datetime | None:
    if v is None or v == "":
        if obrigatoria:
            raise PropostaRecusada(f"{nome} ausente: a data de leitura da evidência é obrigatória")
        return None
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            raise PropostaRecusada(f"{nome} não é uma data ISO 8601: {v!r}") from None
    if not isinstance(v, datetime):
        raise PropostaRecusada(f"{nome} não é uma data: {v!r}")
    return v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)  # sem fuso: lido como UTC


def _preparar(conn: Any, p: Proposta, agora: datetime) -> _Pronta:
    """Todas as recusas, só com leitura. Levanta `PropostaRecusada`."""
    c = CLASSES.get(p.classe) if isinstance(p.classe, str) else None
    if c is None:
        raise PropostaRecusada(f"classe inválida: {p.classe!r} (esperado uma de {', '.join(ORDEM_CLASSES)})")
    if not isinstance(p.campo, str) or not c.campos_validos(p.campo):
        raise PropostaRecusada(f"campo inválido para a classe {p.classe}: {p.campo!r} (esperado {c.campos})")
    if not _texto(p.registro_chave):
        raise PropostaRecusada("registro_chave vazia")
    if not http(p.url):
        raise PropostaRecusada(f"url ausente ou que não é http(s): {p.url!r}")
    if not _texto(p.trecho):
        raise PropostaRecusada("trecho ausente: a proposta precisa do trecho (ou caminho no documento) que sustenta o valor")
    if not isinstance(p.conteudo_sha256, str) or not _HEX64.match(p.conteudo_sha256):
        raise PropostaRecusada("conteudo_sha256 ausente ou malformado (esperado 64 caracteres hexadecimais)")
    lida = _data(p.lida_em, "lida_em", obrigatoria=True)
    declarada = _data(p.fonte_declarada_em, "fonte_declarada_em", obrigatoria=False)
    if declarada is not None and declarada > agora:
        raise PropostaRecusada(f"fonte_declarada_em está no futuro ({declarada.isoformat()}): a fonte não pode declarar data que ainda não chegou")
    if p.alcance not in ("registro", "regra"):
        raise PropostaRecusada(f"alcance inválido: {p.alcance!r} (esperado 'registro' ou 'regra')")
    if p.classe == "contato_mandato" and not _texto(p.bloco):
        raise PropostaRecusada("contato_mandato exige `bloco`: o delimitador do bloco do parlamentar na página (contato de rodapé é da Casa, não do parlamentar)")
    if p.bloco is not None and not isinstance(p.bloco, str):
        raise PropostaRecusada("bloco tem de ser texto")
    if p.valor_candidato is None:
        raise PropostaRecusada("valor_candidato nulo: ausência de valor não se propõe (a proposta traz o valor que a fonte mostra)")
    erro = c.valida_candidato(p.campo, p.valor_candidato)
    if erro:
        raise PropostaRecusada(erro)
    if not c.registro_existe(conn, p.registro_chave):
        raise PropostaRecusada(f"registro inexistente: {p.classe}:{p.registro_chave}")
    if not c.campo_existe(conn, p.registro_chave, p.campo):
        raise PropostaRecusada(f"campo inexistente neste registro: {p.campo!r} (para contato que ainda não existe use novo:<tipo>:<valor>)")
    ids = None
    if p.alcance == "regra":
        if not _texto(p.regra_criterio):
            raise PropostaRecusada("alcance 'regra' exige regra_criterio (o critério que define a regra compartilhada)")
        if not isinstance(p.regra_ids, (list, tuple)) or not p.regra_ids or not all(_texto(i) for i in p.regra_ids):
            raise PropostaRecusada("alcance 'regra' exige regra_ids: a lista dos ids de registro a que a regra se aplica")
        ids = sorted({str(i) for i in p.regra_ids})
        if p.registro_chave not in ids:
            raise PropostaRecusada("regra_ids tem de incluir o próprio registro da proposta")
        for i in ids:
            if not c.registro_existe(conn, i):
                raise PropostaRecusada(f"regra_ids cita registro inexistente: {p.classe}:{i}")
    elif p.regra_criterio is not None or p.regra_ids is not None:
        raise PropostaRecusada("regra_criterio e regra_ids só valem com alcance 'regra'")
    if p.rodada_id is not None:
        try:
            rid = str(uuid.UUID(str(p.rodada_id)))
        except ValueError:
            raise PropostaRecusada(f"rodada_id inválido: {p.rodada_id!r}") from None
        if not conn.execute("select 1 from adm_rodadas where id = %s", (rid,)).fetchone():
            raise PropostaRecusada(f"rodada inexistente: {rid}")
    return _Pronta(p, lida, declarada, p.conteudo_sha256.lower(), ids)


def validar(conn: Any, p: Proposta, *, agora: datetime | None = None) -> None:
    """Levanta `PropostaRecusada(motivo)` se a proposta não pode entrar. Só lê; nunca grava."""
    _preparar(conn, p, agora or datetime.now(timezone.utc))


def chave_idem(classe: str, chave: str, campo: str, candidato: Any, url: str, sha: str) -> str:
    return sha256_text(canonico([classe, chave, campo, canonico(candidato), url, sha.lower()]))


# ------------------------------------------------------------------ pendência


def _sha_vigente(v: Any) -> str:
    return sha256_text(canonico(v))


sha_vigente = _sha_vigente  # público: quem aplica uma decisão atualiza `vigente_sha` com a mesma função (senão `reavaliar` reabriria a pendência recém-aplicada)


def _ultimas_por_url(linhas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A leitura mais recente de cada URL (lida_em, depois criada_em, depois a que entrou por último na lista), em ordem de leitura."""
    por_url: dict[str, tuple[Any, dict[str, Any]]] = {}
    for i, l in enumerate(linhas):
        k = (l["lida_em"] or datetime.min.replace(tzinfo=timezone.utc), l.get("criada_em") or datetime.min.replace(tzinfo=timezone.utc), i)
        if l["url"] not in por_url or k >= por_url[l["url"]][0]:
            por_url[l["url"]] = (k, l)
    return [l for _, l in sorted(por_url.values(), key=lambda x: x[0])]


def _tipo_e_pergunta(conn: Any, classe: str, chave: str, campo: str, tipo_atual: str | None, vigente: Any, ligadas: list[dict[str, Any]]) -> tuple[str, str]:
    c = CLASSES[classe]
    ultimas = _ultimas_por_url(ligadas)
    distintos = {canonico(l["candidato"]) for l in ultimas}
    base = "duplicata" if tipo_atual == "duplicata" else ("mudanca" if c.aceita_override(conn, chave, campo) else "confirmacao")
    if len(distintos) > 1:
        return "divergencia", c.pergunta_divergencia(campo, vigente, ultimas)
    return base, c.pergunta(campo, vigente, ultimas[-1]["candidato"])


def _ligadas(conn: Any, pendencia_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "select pr.id, pr.url, pr.valor_candidato as candidato, pr.lida_em, pr.criada_em, pr.conteudo_sha256 from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id "
        "where pp.pendencia_id = %s order by pr.lida_em nulls first, pr.criada_em, pr.id", (pendencia_id,)).fetchall()
    return [dict(r) for r in rows]


def _cobertura_recorte(conn: Any, rodada_id: str | None, cache: dict[str, Any] | None) -> float | None:
    """alcançados / elegíveis do painel da coleta da rodada; None quando o denominador é nulo ou zero (ou o relatório não fecha)."""
    if rodada_id is None:
        return None
    rid = str(rodada_id)
    if cache is not None and rid in cache:
        return cache[rid]
    try:
        alc = rel.relatorio(conn, rid)["coleta"]["registros_alcancados"]
        v = None if alc["valor"] is None or not alc["de"] else round(alc["valor"] / alc["de"], 6)
    except ErroAdmin:
        v = None
    if cache is not None:
        cache[rid] = v
    return v


def _vence(classe: str, agora: datetime) -> datetime | None:
    dias = CLASSES[classe].revalidacao_dias
    return None if dias is None else agora + timedelta(days=dias)


def _pendencia_do_campo(conn: Any, classe: str, chave: str, campo: str) -> dict[str, Any] | None:
    return conn.execute("select * from adm_pendencias where classe = %s and registro_chave = %s and campo = %s for update", (classe, chave, campo)).fetchone()


def _reabrir(conn: Any, pend: dict[str, Any], motivo: str, tipo: str, pergunta: str, evidencia_sha: str | None, vigente: Any, agora: datetime,
             recorte: float | None, *, com_recorte: bool) -> None:
    conn.execute(
        "update adm_pendencias set status = 'aberta', reaberta = true, motivo_reabertura = %s, tipo = %s, pergunta = %s, evidencia_sha = %s, vigente_sha = %s, vence_em = %s, "
        "cobertura_recorte = case when %s then %s else cobertura_recorte end where id = %s",
        (motivo, tipo, pergunta, evidencia_sha, _sha_vigente(vigente), _vence(pend["classe"], agora), com_recorte, recorte, pend["id"]))


def registrar(conn: Any, p: Proposta, *, agora: datetime | None = None, cache_recorte: dict[str, Any] | None = None) -> Resultado:
    """Valida e grava a proposta e resolve a pendência do campo (regras 1 a 4 no docstring do módulo). NÃO comita.

    Repetir a mesma proposta (mesma chave de idempotência) devolve a existente com `nova=False` e não cria nem altera nada. `cache_recorte` (opcional) guarda
    a cobertura por rodada entre chamadas de um mesmo lote."""
    agora = agora or datetime.now(timezone.utc)
    n = _preparar(conn, p, agora)
    c = CLASSES[p.classe]
    conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"adm_propostas:{p.classe}:{p.registro_chave}:{p.campo}",))
    idem = chave_idem(p.classe, p.registro_chave, p.campo, p.valor_candidato, p.url, n.sha)
    ja = conn.execute("select id from adm_propostas where chave_idem = %s", (idem,)).fetchone()
    if ja:
        lig = conn.execute("select pendencia_id from adm_pendencia_propostas where proposta_id = %s limit 1", (ja["id"],)).fetchone()
        return Resultado(nova=False, proposta_id=str(ja["id"]), pendencia_id=str(lig["pendencia_id"]) if lig else None)

    vigente = c.valor_vigente(conn, p.registro_chave, p.campo)
    pid = str(conn.execute(
        "insert into adm_propostas (classe, registro_chave, campo, valor_vigente, valor_candidato, url, trecho, conteudo_sha256, lida_em, fonte_declarada_em, alcance, "
        "regra_criterio, regra_ids, fonte_slug, bloco, rodada_id, chave_idem) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (p.classe, p.registro_chave, p.campo, None if vigente is None else Jsonb(vigente), Jsonb(p.valor_candidato), p.url, p.trecho, n.sha, n.lida_em, n.declarada_em,
         p.alcance, p.regra_criterio if p.alcance == "regra" else None, Jsonb(n.regra_ids) if n.regra_ids is not None else None, p.fonte_slug, p.bloco,
         str(p.rodada_id) if p.rodada_id is not None else None, idem)).fetchone()["id"])
    nova_linha = {"id": pid, "url": p.url, "candidato": p.valor_candidato, "lida_em": n.lida_em, "criada_em": agora, "conteudo_sha256": n.sha}
    confirma = vigente is not None and canonico(p.valor_candidato) == canonico(vigente)
    pend = _pendencia_do_campo(conn, p.classe, p.registro_chave, p.campo)

    if pend is None:
        if confirma:
            return Resultado(nova=True, proposta_id=pid, confirmada_pela_fonte=True)
        # Fonte A confirma o vigente e fonte B difere: dois valores. Liga a leitura mais recente das OUTRAS URLs que confirma o vigente de agora.
        outras = [dict(r) for r in conn.execute(
            "select id, url, valor_candidato as candidato, lida_em, criada_em, conteudo_sha256 from adm_propostas where classe = %s and registro_chave = %s and campo = %s and id <> %s and url <> %s "
            "order by lida_em nulls first, criada_em, id", (p.classe, p.registro_chave, p.campo, pid, p.url)).fetchall()]
        confirmam = [l for l in _ultimas_por_url(outras) if vigente is not None and canonico(l["candidato"]) == canonico(vigente)]
        ligadas = confirmam + [nova_linha]
        tipo, pergunta = _tipo_e_pergunta(conn, p.classe, p.registro_chave, p.campo, None, vigente, ligadas)
        recorte = _cobertura_recorte(conn, p.rodada_id, cache_recorte)
        penid = str(conn.execute(
            "insert into adm_pendencias (classe, registro_chave, campo, pergunta, tipo, evidencia_sha, vigente_sha, vence_em, cobertura_recorte) values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (p.classe, p.registro_chave, p.campo, pergunta, tipo, n.sha, _sha_vigente(vigente), _vence(p.classe, agora), recorte)).fetchone()["id"])
        for l in ligadas:
            conn.execute("insert into adm_pendencia_propostas (pendencia_id, proposta_id) values (%s, %s)", (penid, l["id"]))
        return Resultado(nova=True, proposta_id=pid, pendencia_id=penid, pendencia_acao="criada", tipo=tipo)

    penid = str(pend["id"])
    ligadas = _ligadas(conn, penid) + [nova_linha]
    conn.execute("insert into adm_pendencia_propostas (pendencia_id, proposta_id) values (%s, %s)", (penid, pid))
    if pend["status"] == "aberta":
        tipo, pergunta = _tipo_e_pergunta(conn, p.classe, p.registro_chave, p.campo, pend["tipo"], vigente, ligadas)
        conn.execute("update adm_pendencias set tipo = %s, pergunta = %s, evidencia_sha = %s, vigente_sha = %s where id = %s", (tipo, pergunta, n.sha, _sha_vigente(vigente), penid))
        return Resultado(nova=True, proposta_id=pid, pendencia_id=penid, pendencia_acao="ligada", tipo=tipo)

    motivo = "evidencia_mudou" if pend["evidencia_sha"] != n.sha else ("registro_mudou" if pend["vigente_sha"] != _sha_vigente(vigente) else None)
    if motivo is None:
        return Resultado(nova=True, proposta_id=pid, pendencia_id=penid, pendencia_acao="ligada_decidida", tipo=pend["tipo"])
    tipo, pergunta = _tipo_e_pergunta(conn, p.classe, p.registro_chave, p.campo, pend["tipo"], vigente, ligadas)
    _reabrir(conn, pend, motivo, tipo, pergunta, n.sha, vigente, agora, _cobertura_recorte(conn, p.rodada_id, cache_recorte), com_recorte=p.rodada_id is not None)
    return Resultado(nova=True, proposta_id=pid, pendencia_id=penid, pendencia_acao="reaberta", tipo=tipo, motivo_reabertura=motivo)


def reavaliar(conn: Any, *, classe: str | None = None, agora: datetime | None = None) -> list[dict[str, Any]]:
    """Reabre (`registro_mudou`) as pendências `decidida` cujo valor vigente no banco difere do `vigente_sha` guardado: o job regravou a tabela sem nova proposta.
    `vigente_sha` nulo (valor de partida desconhecido) conta como mudou. NÃO comita. Devolve as pendências reabertas [{id, classe, registro_chave, campo, tipo}].

    Quem decide e aplica (próxima tarefa) tem de atualizar `vigente_sha` ao aplicar; senão a pendência recém-aplicada é reaberta aqui."""
    if classe is not None and classe not in CLASSES:
        raise ErroAdmin(f"classe inválida: {classe!r} (esperado uma de {', '.join(ORDEM_CLASSES)})")
    agora = agora or datetime.now(timezone.utc)
    rows = conn.execute(
        "select * from adm_pendencias where status = 'decidida' and (%(c)s::text is null or classe = %(c)s::text) order by classe, registro_chave, campo for update", {"c": classe}).fetchall()
    out: list[dict[str, Any]] = []
    for pend in rows:
        c = CLASSES[pend["classe"]]
        vigente = c.valor_vigente(conn, pend["registro_chave"], pend["campo"])
        if pend["vigente_sha"] == _sha_vigente(vigente):
            continue
        ligadas = _ligadas(conn, str(pend["id"]))
        if ligadas:
            tipo, pergunta = _tipo_e_pergunta(conn, pend["classe"], pend["registro_chave"], pend["campo"], pend["tipo"], vigente, ligadas)
        else:
            tipo = pend["tipo"]
            d = c.descricao_campo(pend['campo'])
            pergunta = f"{d[:1].upper() + d[1:]} passou a {'sem valor' if vigente is None else repr(vigente)} depois da decisão; a decisão anterior ainda vale?"
        _reabrir(conn, pend, "registro_mudou", tipo, pergunta, pend["evidencia_sha"], vigente, agora, None, com_recorte=False)
        out.append({"id": str(pend["id"]), "classe": pend["classe"], "registro_chave": pend["registro_chave"], "campo": pend["campo"], "tipo": tipo})
    return out
