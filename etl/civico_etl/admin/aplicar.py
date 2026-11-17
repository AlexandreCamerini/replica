"""Aplicação das decisões às tabelas de domínio (Parte B, B2; replica/admin-coleta-plano.md, seções 2 e 3): `civico-etl admin aplicar`.

Só `aprovar` e `corrigir` aplicam. Cada aplicação roda num SAVEPOINT (`conn.transaction()`): se qualquer passo falhar, nada fica gravado (nem override, nem mudança na
tabela, nem a marca `aplicada`) e a decisão continua não aplicada. O `update` real na tabela de domínio é o que valida os `check` dela. Nada aqui comita.

DUAS CHAVES (D293). Decisão de `agentes` só se aplica com a variável de ambiente `ADMIN_COLETA_AGENTES=on` E a linha `admin_coleta_agentes = 'on'` em `public.pipeline_switches`.
As duas nascem desligadas. Com qualquer uma desligada, `aplicar` levanta `ChavesDesligadas` ANTES de qualquer escrita (falha fechada). O gatilho `adm_decisoes_guard`
(0150) confere a segunda chave outra vez no momento de marcar `aplicada`. Decisão de `pessoa` não depende das chaves.

O que cada classe escreve (campo -> escrita):
  vinculo_sapl  status, base_url de Câmara   desativa o override vigente do campo, grava `adm_overrides` vigente e faz `update sapl_houses`
  vinculo_sapl  base_url de Assembleia       NÃO grava override nem muda `sapl_houses` (o endereço sondado é o de `ALE_SAPL`, no código): grava em `adm_vinculos` um vínculo
                                             `correcao_manual` com a URL decidida (o anterior fica `vigente = false` e o novo aponta para ele em `substitui_id`)
  cobertura     status, reason, evidence_url override vigente + `update data_coverage` (chave `<ibge>:<dataset>`)
  contato       `<kind>:<value>` (existente) override `suprimir` do valor antigo + apaga a linha antiga + insere o novo com a fonte `curadoria` (ou só apaga, com {"remover": true})
  contato       `novo:<kind>:<value>`        insere com a fonte `curadoria`
  identidade    status aceito                `update identity_match_queue` (status, resolved_by, resolved_at) + vínculo em `person_external_ids` (match_method `manual`); NUNCA cria pessoa
  identidade    status rejeitado             só o `update identity_match_queue`
  duplicata     {"unir": {de, para}}         `select merge_person(de, para)` (única forma de unir pessoas)
Depois de aplicar: marca `adm_decisoes.aplicada` e atualiza `adm_pendencias.vigente_sha` com o valor vigente lido AGORA (`propostas.sha_vigente`), para `reavaliar` não reabrir a pendência.

`corrections` é PÚBLICA. Uma linha só quando as três condições valem (plano, seção 3): aplicada; trocou um valor que já existia (anterior não nulo e diferente do novo); e o campo
tem leitor no site (`LEITORES`, abaixo). `evidence_url` é NOT NULL e é "a fonte oficial que justifica": a decisão não tem URL própria, então a linha só é gravada quando uma proposta
ligada à pendência traz exatamente o valor decidido, e a URL é a dela. Sem essa proposta (ex.: `corrigir` para um valor que nenhuma fonte trouxe, remoção de contato), NÃO grava e o
resultado diz que coluna impede. `person_id` é o dono do mandato nos contatos e nulo nas demais classes; `entity_ref` é `sapl_houses.id`, `<ibge>:<dataset>` ou `mandates.id`.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from ..util import sha256_text
from . import propostas as prop
from .classes import CLASSES, canonico, contato_partes
from .decisoes import ACOES_QUE_APLICAM
from .saida import ErroAdmin

VARIAVEL = "ADMIN_COLETA_AGENTES"
CHAVE_BANCO = "admin_coleta_agentes"
PG = "web/src/lib/data/pg.ts"

# Leitores do site público por campo (conferidos em web/src/lib/data/pg.ts; o teste abre o arquivo e confere que a linha existe e contém o trecho).
# `escopo`: "camara" = casa de município; "uf" = Assembleia; "municipio"/"uf" também para cobertura (nível do lugar); None = todos. `datasets`: só esses datasets (None = todos).
# Campo sem entrada aqui não tem leitor no site e não gera linha em `corrections`.
LEITORES: dict[tuple[str, str], list[dict[str, Any]]] = {
    ("vinculo_sapl", "status"): [
        {"metodo": "getCouncilSite", "arquivo": PG, "linha": 424, "contem": "from sapl_houses h join places p", "escopo": "camara"},
        {"metodo": "getAssembly", "arquivo": PG, "linha": 436, "contem": "left join sapl_houses h on b.adapter = 'sapl'", "escopo": "uf"},
        {"metodo": "getCityCouncil", "arquivo": PG, "linha": 479, "contem": "h.status = 'ok'", "escopo": None},
        {"metodo": "getPeopleCoverage", "arquivo": PG, "linha": 807, "contem": "h.status = 'ok'", "escopo": None},
    ],
    ("vinculo_sapl", "base_url"): [
        {"metodo": "getCouncilSite", "arquivo": PG, "linha": 423, "contem": "select h.status, h.base_url, h.note", "escopo": "camara"},
        {"metodo": "getCityCouncil", "arquivo": PG, "linha": 477, "contem": "h.base_url", "escopo": None},
        {"metodo": "getPeopleCoverage", "arquivo": PG, "linha": 804, "contem": "h.base_url", "escopo": None},
    ],
    ("cobertura", "status"): [
        {"metodo": "getCoverage", "arquivo": PG, "linha": 411, "contem": "from data_coverage dc join places p", "escopo": "municipio"},
        {"metodo": "getAssembly", "arquivo": PG, "linha": 441, "contem": "from data_coverage where place_id", "escopo": "uf", "datasets": ("presenca", "votos", "propostas", "gastos_gabinete")},
        {"metodo": "statsForPeople", "arquivo": PG, "linha": 1755, "contem": "select place_id, dataset, status, reason from data_coverage", "escopo": None},
        {"metodo": "getPeopleCoverage", "arquivo": PG, "linha": 821, "contem": "from data_coverage where place_id = any(", "escopo": "municipio"},
        {"metodo": "getCoverageMatrix", "arquivo": PG, "linha": 1487, "contem": "from data_coverage dc join places p on p.id = dc.place_id", "escopo": "municipio"},
    ],
    ("cobertura", "reason"): [
        {"metodo": "getCoverage", "arquivo": PG, "linha": 411, "contem": "from data_coverage dc join places p", "escopo": "municipio"},
        {"metodo": "getAssembly", "arquivo": PG, "linha": 441, "contem": "from data_coverage where place_id", "escopo": "uf", "datasets": ("presenca", "votos", "propostas", "gastos_gabinete")},
        {"metodo": "statsForPeople", "arquivo": PG, "linha": 1755, "contem": "select place_id, dataset, status, reason from data_coverage", "escopo": None},
        {"metodo": "getPeopleCoverage", "arquivo": PG, "linha": 821, "contem": "from data_coverage where place_id = any(", "escopo": "municipio"},
    ],
    ("cobertura", "evidence_url"): [
        {"metodo": "getCoverage", "arquivo": PG, "linha": 411, "contem": "evidence_url", "escopo": "municipio"},
        {"metodo": "getAssembly", "arquivo": PG, "linha": 441, "contem": "evidence_url", "escopo": "uf", "datasets": ("presenca", "votos", "propostas", "gastos_gabinete")},
        {"metodo": "getPeopleCoverage", "arquivo": PG, "linha": 821, "contem": "from data_coverage where place_id = any(", "escopo": "municipio"},
    ],
    ("contato_mandato", "contato"): [
        {"metodo": "getContacts", "arquivo": PG, "linha": 1435, "contem": "from mandate_contacts mc join mandates m", "escopo": None},
    ],
}
SEM_LEITOR_NO_SITE = ("identidade", "status")  # fila de identidade e person_external_ids: nada do site público lê (decisão de identidade não gera `corrections`)


class ChavesDesligadas(ErroAdmin):
    """Decisão de agentes com alguma das duas chaves desligada: nada foi gravado."""


class AplicacaoRecusada(ErroAdmin):
    """A decisão não pôde ser aplicada: o motivo é a mensagem; nada foi gravado."""


def chaves_dos_agentes(conn: Any) -> dict[str, bool]:
    """Estado das duas chaves: `variavel` (ADMIN_COLETA_AGENTES == 'on' em `os.environ`, lida AGORA) e `linha` (public.pipeline_switches.admin_coleta_agentes.value == 'on').
    `ligadas` = as duas. Não há parâmetro que substitua a variável (critério de segurança 9: nenhuma porta de serviço); a tabela vai com o esquema `public` para que uma
    tabela temporária de mesmo nome na sessão não a sombreie."""
    var = os.environ.get(VARIAVEL) == "on"
    r = conn.execute("select value from public.pipeline_switches where name = %s", (CHAVE_BANCO,)).fetchone()
    linha = bool(r and r["value"] == "on")
    return {"variavel": var, "linha": linha, "ligadas": var and linha}


def leitores_de(classe: str, campo: str, escopo: str | None, dataset: str | None = None) -> list[dict[str, Any]]:
    """Leitores do site público para o campo. `escopo`: 'camara' | 'uf' (casa) ou 'municipio' | 'uf' (lugar da cobertura); `dataset` só para cobertura."""
    chave = (classe, "contato" if classe == "contato_mandato" else campo)
    out = []
    for l in LEITORES.get(chave, []):
        if l["escopo"] not in (None, escopo):
            continue
        if l.get("datasets") and dataset not in l["datasets"]:
            continue
        out.append(l)
    return out


# ------------------------------------------------------------------ apoio


def _decisao(conn: Any, decisao_id: Any, *, travar: bool = False) -> dict[str, Any]:
    try:
        did = str(uuid.UUID(str(decisao_id)))
    except ValueError:
        raise ErroAdmin(f"identificador de decisão inválido: {decisao_id!r}") from None
    r = conn.execute(
        "select d.*, p.classe, p.registro_chave, p.campo, p.tipo as pendencia_tipo from adm_decisoes d join adm_pendencias p on p.id = d.pendencia_id where d.id = %s"
        + (" for update of d" if travar else ""), (did,)).fetchone()
    if r is None:
        raise ErroAdmin(f"decisão inexistente: {did}")
    return dict(r)


def _override(conn: Any, classe: str, chave: str, campo: str, valor: Any, decisao_id: Any, *, suprimir: bool = False) -> str:
    """Desativa o override vigente do campo (fica como histórico) e grava o novo vigente. Devolve o id."""
    conn.execute("update adm_overrides set vigente = false where classe = %s and registro_chave = %s and campo = %s and vigente", (classe, chave, campo))
    return str(conn.execute(
        "insert into adm_overrides (classe, registro_chave, campo, valor, suprimir, decisao_id) values (%s, %s, %s, %s, %s, %s) returning id",
        (classe, chave, campo, None if suprimir else Jsonb(valor), suprimir, decisao_id)).fetchone()["id"])


def _curadoria(conn: Any) -> str:
    r = conn.execute("select id from sources where slug = 'curadoria'").fetchone()
    if r is None:
        raise AplicacaoRecusada("a fonte `curadoria` não existe em sources (migração 0150)")
    return str(r["id"])


# ------------------------------------------------------------------ por classe (cada uma devolve o que escreveu e o par antes/depois)


def _sapl(conn: Any, d: dict[str, Any], valor: Any) -> dict[str, Any]:
    chave, campo = d["registro_chave"], d["campo"]
    if campo not in ("base_url", "status") or not chave.isdigit():
        raise AplicacaoRecusada(f"vinculo_sapl: registro ou campo inválido ({chave}:{campo})")
    casa = conn.execute("select h.id, h.base_url, h.status, p.kind from sapl_houses h join places p on p.id = h.place_id where h.id = %s for update of h", (int(chave),)).fetchone()
    if casa is None:
        raise AplicacaoRecusada(f"sapl_houses {chave} não existe")
    antes = casa[campo]
    nivel = "uf" if casa["kind"] == "uf" else "camara"
    if not CLASSES["vinculo_sapl"].aceita_override(conn, chave, campo):
        url_sha = sha256_text(valor)
        velhos = [dict(r) for r in conn.execute(
            "select id, url, fonte_slug, origem from adm_vinculos where classe = 'vinculo_sapl' and registro_chave = %s and vigente and (origem = 'correcao_manual' or url = %s or url_sha = %s) "
            "order by (origem = 'correcao_manual') desc, criada_em", (chave, antes, url_sha)).fetchall()]
        if velhos:
            conn.execute("update adm_vinculos set vigente = false where id = any(%s::uuid[])", ([str(v["id"]) for v in velhos],))
        novo = str(conn.execute(
            "insert into adm_vinculos (classe, registro_chave, fonte_slug, url, url_sha, origem, substitui_id, decisao_id) values ('vinculo_sapl', %s, %s, %s, %s, 'correcao_manual', %s, %s) returning id",
            (chave, velhos[0]["fonte_slug"] if velhos else None, valor, url_sha, velhos[0]["id"] if velhos else None, d["id"])).fetchone()["id"])
        return {"escreveu": {"adm_vinculos": {"novo": novo, "desativados": [str(v["id"]) for v in velhos]}}, "antes": antes, "depois": antes,
                "observacao": "base_url de Assembleia não aceita override: sapl_houses NÃO foi alterada e o endereço sondado continua sendo o de ALE_SAPL (jobs/sapl.py); a URL decidida ficou em adm_vinculos como correcao_manual",
                "corr": None}
    oid = _override(conn, "vinculo_sapl", chave, campo, valor, d["id"])
    conn.execute(f"update sapl_houses set {campo} = %s, updated_at = now() where id = %s", (valor, casa["id"]))  # noqa: S608 (campo conferido acima)
    return {"escreveu": {"adm_overrides": [oid], "sapl_houses": [casa["id"]]}, "antes": antes, "depois": valor, "observacao": None,
            "corr": {"tabela": "sapl_houses", "ref": str(casa["id"]), "campo": campo, "pessoa": None, "leitores": leitores_de("vinculo_sapl", campo, nivel)}}


def _cobertura(conn: Any, d: dict[str, Any], valor: Any) -> dict[str, Any]:
    chave, campo = d["registro_chave"], d["campo"]
    ibge, _, ds = chave.partition(":")
    if campo not in ("status", "reason", "evidence_url"):
        raise AplicacaoRecusada(f"cobertura: campo inválido {campo!r}")
    r = conn.execute(f"select c.id, c.{campo} as v, p.kind from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = %s for update of c", (ibge, ds)).fetchone()  # noqa: S608
    if r is None:
        raise AplicacaoRecusada(f"cobertura {chave} não existe em data_coverage")
    oid = _override(conn, "cobertura", chave, campo, valor, d["id"])
    conn.execute(f"update data_coverage set {campo} = %s, updated_at = now() where id = %s", (valor, r["id"]))  # noqa: S608
    return {"escreveu": {"adm_overrides": [oid], "data_coverage": [str(r["id"])]}, "antes": r["v"], "depois": valor, "observacao": None,
            "corr": {"tabela": "data_coverage", "ref": chave, "campo": campo, "pessoa": None, "leitores": leitores_de("cobertura", campo, "uf" if r["kind"] == "uf" else "municipio", ds)}}


def _contato(conn: Any, d: dict[str, Any], valor: Any) -> dict[str, Any]:
    chave, campo = d["registro_chave"], d["campo"]
    modo, kind, antigo = contato_partes(campo)
    try:
        mid = str(uuid.UUID(chave))
    except ValueError:
        raise AplicacaoRecusada(f"contato_mandato: registro inválido {chave!r}") from None
    m = conn.execute("select person_id from mandates where id = %s", (mid,)).fetchone()
    if m is None:
        raise AplicacaoRecusada(f"mandato {mid} não existe")
    esc: dict[str, Any] = {}
    obs: list[str] = []
    remover = isinstance(valor, dict)
    novo = None if remover else valor
    existia = None
    if modo == "existente":
        existia = conn.execute("select id from mandate_contacts where mandate_id = %s and kind = %s and value = %s for update", (mid, kind, antigo)).fetchone()
        if novo == antigo:
            return {"escreveu": {}, "antes": antigo, "depois": novo, "corr": None,
                    "observacao": "o valor decidido é o que o contato já tem: nada a suprimir nem a inserir"}
        esc["adm_overrides"] = [_override(conn, "contato_mandato", mid, campo, None, d["id"], suprimir=True)]
        apagados = conn.execute("delete from mandate_contacts where mandate_id = %s and kind = %s and value = %s returning id", (mid, kind, antigo)).fetchall()
        esc["mandate_contacts_apagados"] = [str(r["id"]) for r in apagados]
        if not existia:
            obs.append("o contato antigo não estava mais em mandate_contacts (o job pode tê-lo tirado): só o override de supressão foi gravado")
    if novo is not None:
        k = kind
        ins = conn.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, %s, %s, %s) on conflict (mandate_id, kind, value) do nothing returning id",
                           (mid, k, novo, _curadoria(conn))).fetchone()
        if ins:
            esc["mandate_contacts_inseridos"] = [str(ins["id"])]
        else:
            ex = conn.execute("select mc.id, s.slug from mandate_contacts mc join sources s on s.id = mc.source_id where mc.mandate_id = %s and mc.kind = %s and mc.value = %s", (mid, k, novo)).fetchone()
            if ex is None:  # o gatilho de override descartou o insert: o valor está suprimido por decisão anterior
                raise AplicacaoRecusada(f"o contato {k}:{novo} está suprimido por um override vigente de decisão anterior; o insert foi descartado pelo gatilho e nada foi gravado")
            esc["mandate_contacts_ja_existia"] = [str(ex["id"])]
            obs.append(f"o contato {k}:{novo} já existia (fonte {ex['slug']}): não foi duplicado e segue com essa fonte (se ela deixar de publicá-lo, sai do banco)")
    return {"escreveu": esc, "antes": antigo if modo == "existente" and existia else None, "depois": novo, "observacao": "; ".join(obs) or None,
            "corr": {"tabela": "mandate_contacts", "ref": mid, "campo": kind, "pessoa": str(m["person_id"]), "leitores": leitores_de("contato_mandato", kind, None)}}


def _identidade(conn: Any, d: dict[str, Any], valor: Any) -> dict[str, Any]:
    qid = d["registro_chave"]
    q = conn.execute("select id, source_id, external_id, candidate_person_id, status from identity_match_queue where id = %s for update", (qid,)).fetchone()
    if q is None:
        raise AplicacaoRecusada(f"item da fila de identidade {qid} não existe")
    if valor not in ("aceito", "rejeitado"):
        raise AplicacaoRecusada(f"identidade: só aceito e rejeitado se aplicam (veio {valor!r}); nunca se cria pessoa aqui")
    esc: dict[str, Any] = {}
    if valor == "aceito":
        if q["candidate_person_id"] is None:
            raise AplicacaoRecusada("o item não tem pessoa candidata: 'aceito' não tem a quem ligar")
        ex = conn.execute("select id, person_id from person_external_ids where source_id = %s and external_id = %s for update", (q["source_id"], q["external_id"])).fetchone()
        if ex is not None and ex["person_id"] != q["candidate_person_id"]:
            raise AplicacaoRecusada(f"o identificador {q['external_id']!r} desta fonte já está ligado a OUTRA pessoa ({ex['person_id']}); não se troca vínculo em silêncio")
        if ex is None:
            esc["person_external_ids"] = [str(conn.execute(
                "insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, %s, 'manual', 1) returning id",
                (q["candidate_person_id"], q["source_id"], q["external_id"])).fetchone()["id"])]
    quem = d["decidido_por_nome"] if d["decidido_por_tipo"] == "pessoa" else "agentes"
    conn.execute("update identity_match_queue set status = %s, resolved_by = %s, resolved_at = now(), updated_at = now() where id = %s", (valor, quem, q["id"]))
    esc["identity_match_queue"] = [str(q["id"])]
    return {"escreveu": esc, "antes": q["status"], "depois": valor, "observacao": None, "corr": None}


def _duplicata(conn: Any, d: dict[str, Any], valor: Any) -> dict[str, Any]:
    u = valor["unir"]
    for i in (u["de"], u["para"]):
        if not conn.execute("select 1 from people where id = %s", (i,)).fetchone():
            raise AplicacaoRecusada(f"unir: a pessoa {i} não existe")
    if u["de"] == u["para"]:
        raise AplicacaoRecusada("unir: as duas pessoas são a mesma")
    conn.execute("select merge_person(%s::uuid, %s::uuid)", (u["de"], u["para"]))
    return {"escreveu": {"merge_person": {"de": u["de"], "para": u["para"]}}, "antes": None, "depois": None,
            "observacao": "pessoas unidas por merge_person (a pessoa `de` deixa de existir; o slug dela vira redirect)", "corr": None}


# ------------------------------------------------------------------ corrections


def _corrections(conn: Any, d: dict[str, Any], r: dict[str, Any], valor: Any) -> dict[str, Any]:
    c = r.get("corr")
    antes, depois = r["antes"], r["depois"]
    if c is None:
        return {"gravou": False, "motivo": "a decisão não troca valor publicado (primeiro preenchimento, identidade, união ou sem escrita na tabela de domínio)"}
    if antes is None:
        return {"gravou": False, "motivo": "primeiro preenchimento: não havia valor anterior"}
    if antes == depois:
        return {"gravou": False, "motivo": "o valor anterior é igual ao novo"}
    if not c["leitores"]:
        return {"gravou": False, "motivo": f"o campo {c['tabela']}.{c['campo']} não tem leitor no site público (LEITORES)"}
    alvo = canonico(depois) if depois is not None else None
    lig = [l for l in prop._ultimas_por_url(prop._ligadas(conn, str(d["pendencia_id"]))) if alvo is not None and canonico(l["candidato"]) == alvo]
    if not lig:
        return {"gravou": False, "motivo": "corrections.evidence_url é NOT NULL (a fonte oficial que justifica) e nenhuma proposta ligada à pendência traz o valor decidido: não há URL de fonte para gravar"}
    url = lig[-1]["url"]
    row = conn.execute(
        "insert into corrections (person_id, entity_table, entity_ref, field, before_value, after_value, reason, evidence_url) values (%s, %s, %s, %s, %s, %s, %s, %s) returning id",
        (c["pessoa"], c["tabela"], c["ref"], c["campo"], str(antes), None if depois is None else str(depois), d["justificativa"], url)).fetchone()
    return {"gravou": True, "id": str(row["id"]), "evidence_url": url, "leitores": [f"{l['arquivo']}:{l['linha']} ({l['metodo']})" for l in c["leitores"]]}


# ------------------------------------------------------------------ aplicar


def aplicar(conn: Any, decisao_id: Any) -> dict[str, Any]:
    """Aplica UMA decisão (aprovar ou corrigir) às tabelas de domínio, atomicamente. NÃO comita.

    Falha fechada: decisão de agentes com qualquer das duas chaves desligada levanta `ChavesDesligadas` antes de qualquer escrita. Decisão já aplicada, descartar e
    pedir_confirmacao levantam `AplicacaoRecusada`. Qualquer erro dentro da aplicação desfaz tudo (savepoint) e se propaga."""
    d = _decisao(conn, decisao_id)
    if d["aplicada"]:
        raise AplicacaoRecusada(f"a decisão {d['id']} já foi aplicada em {d['aplicada_em']}; aplicar duas vezes não se faz (decida de novo, depois de reaberta a pendência)")
    if d["acao"] not in ACOES_QUE_APLICAM:
        raise AplicacaoRecusada(f"a decisão {d['id']} é {d['acao']}: não há nada a aplicar às tabelas (só aprovar e corrigir aplicam)")
    if d["decidido_por_tipo"] == "agentes":
        ch = chaves_dos_agentes(conn)
        if not ch["ligadas"]:
            raise ChavesDesligadas(
                f"decisão de agentes não se aplica: variável {VARIAVEL}={'on' if ch['variavel'] else 'desligada'} e public.pipeline_switches.{CHAVE_BANCO}={'on' if ch['linha'] else 'desligada'} "
                "(as duas têm de estar ligadas); nada foi gravado")
    with conn.transaction():
        d = _decisao(conn, d["id"], travar=True)
        if d["aplicada"]:
            raise AplicacaoRecusada(f"a decisão {d['id']} já foi aplicada")
        valor = d["valor"]
        if valor is None:
            raise AplicacaoRecusada("a decisão não tem valor a aplicar")
        if d["pendencia_tipo"] == "duplicata" or (isinstance(valor, dict) and "unir" in valor):
            if not (d["classe"] == "identidade" and d["pendencia_tipo"] == "duplicata" and isinstance(valor, dict) and "unir" in valor):
                raise AplicacaoRecusada("`unir` só se aplica em pendência de duplicata da classe identidade")
            r = _duplicata(conn, d, valor)
        else:
            lidor = {"vinculo_sapl": _sapl, "cobertura": _cobertura, "contato_mandato": _contato, "identidade": _identidade}[d["classe"]]
            r = lidor(conn, d, valor)
        corr = _corrections(conn, d, r, valor)
        conn.execute("update adm_decisoes set aplicada = true where id = %s", (d["id"],))  # o gatilho preenche aplicada_em e confere a segunda chave
        vig = CLASSES[d["classe"]].valor_vigente(conn, d["registro_chave"], d["campo"])
        sha = prop.sha_vigente(vig)
        conn.execute("update adm_pendencias set vigente_sha = %s where id = %s", (sha, d["pendencia_id"]))
        em = conn.execute("select aplicada_em from adm_decisoes where id = %s", (d["id"],)).fetchone()["aplicada_em"]
    return {"decisao_id": str(d["id"]), "pendencia_id": str(d["pendencia_id"]), "classe": d["classe"], "registro_chave": d["registro_chave"], "campo": d["campo"], "acao": d["acao"],
            "decidido_por": d["decidido_por_nome"] if d["decidido_por_tipo"] == "pessoa" else "agentes", "valor_anterior": r["antes"], "valor_novo": r["depois"], "escreveu": r["escreveu"],
            "corrections": corr, "observacao": r["observacao"], "vigente_sha": sha, "aplicada_em": em}


def aplicar_pendentes(conn: Any, *, decisao_id: Any = None) -> list[dict[str, Any]]:
    """Aplica as decisões não aplicadas de aprovar/corrigir, em ordem de criação, cada uma no seu savepoint. Falha de uma não impede as outras: devolve um item por
    decisão, `{decisao_id, estado, ...}`: estado `aplicada` (com o resultado), `bloqueada_chaves` (agentes com chave desligada) ou `falhou` (com o motivo). NÃO comita."""
    filtro = ""
    params: tuple[Any, ...] = ()
    if decisao_id is not None:
        filtro, params = " and id = %s", (str(decisao_id),)
    ids = [str(r["id"]) for r in conn.execute(
        "select id from adm_decisoes where not aplicada and acao in ('aprovar', 'corrigir')" + filtro + " order by criada_em, id", params).fetchall()]
    out: list[dict[str, Any]] = []
    for i in ids:
        try:
            out.append({"decisao_id": i, "estado": "aplicada", "resultado": aplicar(conn, i), "erro": None})
        except ChavesDesligadas as e:
            out.append({"decisao_id": i, "estado": "bloqueada_chaves", "resultado": None, "erro": str(e)})
        except (ErroAdmin, psycopg.Error) as e:
            out.append({"decisao_id": i, "estado": "falhou", "resultado": None, "erro": str(e).strip()})
    return out
