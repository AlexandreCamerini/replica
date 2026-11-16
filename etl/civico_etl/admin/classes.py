"""As quatro classes de campo da revisão (Parte B; replica/admin-coleta-plano.md, seção 1, "Classes de campo"): registro declarativo.

Cada classe declara: significado, fonte aceita, prazo de revalidação, chave estável do registro e as funções que o resto da revisão usa
(`campos_validos`, `campo_existe`, `registro_existe`, `valor_vigente`, `territorio`, `rotulo`, `pergunta`, `aceita_override`). Só LEITURA: nada aqui grava em
tabela de domínio nem em `adm_*`. A chave do registro e o nome do `campo` seguem o cabeçalho da migração 0150 (`registro_chave` sempre em texto).

Território (restrição 10): a posição de um registro é o território dele (`places.ibge_code`: município, UF ou país). `vinculo_sapl` e `cobertura` usam o lugar da
casa/da linha; `contato_mandato` usa o lugar do mandato; `identidade` NUNCA tem território (o local de nascimento da pessoa não é território do registro e não é
lido em lugar nenhum deste módulo): vai para a lista, não para o mapa. Lugar de tipo região, ou sem `ibge_code`, também devolve None, com o motivo.

Rótulo e existência do registro reusam `vinculos._rotulos` (via `vinculos._existe`): as mesmas regras de chave que o resto da administração, sem nome de pessoa nem partido.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlparse

from . import vinculos as vin

# Ordem FIXA das classes e dos tipos na fila (restrição 7). Não é alfabética: `SQL_FILA` gera o `order by` a partir destas tuplas.
ORDEM_CLASSES = ("vinculo_sapl", "cobertura", "contato_mandato", "identidade")
ORDEM_TIPOS = ("divergencia", "mudanca", "duplicata", "confirmacao")
assert ORDEM_CLASSES == tuple(vin.CLASSES), "a ordem declarada aqui tem de ser a das classes de vinculos.py"

SAPL_STATUS = ("ok", "sem_sapl_no_registro", "sem_api", "fora_do_ar", "robots_bloqueia")  # check de sapl_houses.status
SAPL_CAMPOS = ("base_url", "status")
COBERTURA_STATUS = ("no_site", "carregando", "so_portal", "nao_publica", "desconhecido")  # check de data_coverage.status
COBERTURA_CAMPOS = ("status", "reason", "evidence_url")
COBERTURA_DATASETS = ("salario_prefeito", "salario_vereadores", "salario_deputados_estaduais", "presenca", "votos", "propostas", "gastos_gabinete", "discursos",
                      "equipe", "emendas", "comissoes", "viagens", "contato")  # check de data_coverage.dataset
CONTATO_KINDS = ("email", "telefone", "gabinete", "site", "instagram", "facebook", "x", "youtube", "tiktok", "outra_rede")  # check de mandate_contacts.kind
CONTATO_NOVO = "novo"  # campo `novo:<kind>`: contato que ainda não existe em mandate_contacts
IDENTIDADE_STATUS = ("pendente", "aceito", "rejeitado", "nova_pessoa")  # check de identity_match_queue.status
IDENTIDADE_CAMPOS = ("status",)

_NIVEL = {"municipio": "municipio", "uf": "uf", "pais": "pais"}


def http(u: Any) -> bool:
    """URL http(s) com host e sem espaço."""
    if not isinstance(u, str) or not u or u != u.strip() or any(c.isspace() for c in u):
        return False
    p = urlparse(u)
    return p.scheme in ("http", "https") and bool(p.netloc)


def canonico(v: Any) -> str:
    """JSON canônico (chaves ordenadas, sem espaço): base do `vigente_sha` e da comparação candidato x vigente."""
    return json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def fmt(v: Any) -> str:
    if v is None:
        return "sem valor"
    return f"'{v}'" if isinstance(v, str) else canonico(v)


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _data(d: Any) -> str:
    return f"{d:%Y-%m-%d}" if isinstance(d, datetime) else "data desconhecida"


def _host(url: str) -> str:
    return urlparse(url).netloc or url


def _inteiro(chave: str) -> int | None:
    return int(chave) if isinstance(chave, str) and chave.isdigit() and len(chave) < 18 else None


def _uuid(chave: str) -> str | None:
    return vin._uuid(chave) if isinstance(chave, str) else None


def _contato(campo: str) -> tuple[str, str]:
    """`<kind>:<value>` separado no PRIMEIRO `:` (o valor pode ter outros, como em `site:https://...`)."""
    kind, _, valor = campo.partition(":")
    return kind, valor


# ------------------------------------------------------------------ pergunta (uma frase, terminada em "?")


def _pergunta_padrao(desc: str, vigente: Any, candidato: Any) -> str:
    if vigente is None:
        return f"{_cap(desc)}, hoje sem valor vigente registrado, deve passar a {fmt(candidato)}?"
    if vigente == candidato:
        return f"A leitura mais recente confirma que {desc} continua {fmt(vigente)}?"
    return f"{_cap(desc)} mudou de {fmt(vigente)} para {fmt(candidato)}?"


def _pergunta_divergencia(desc: str, vigente: Any, leituras: list[dict[str, Any]]) -> str:
    """`leituras`: [{candidato, url, lida_em}] (a última de cada URL), em ordem de leitura. Cita cada valor com a data de leitura e o host."""
    partes = [f"{fmt(l['candidato'])} (lido em {_data(l['lida_em'])} em {_host(l['url'])})" for l in leituras]
    return f"Qual é {desc} (hoje consta {fmt(vigente)}): " + " ou ".join(partes) + "?"


# ------------------------------------------------------------------ vinculo_sapl


def _sapl_campos_validos(campo: str) -> bool:
    return campo in SAPL_CAMPOS


def _sapl_campo_existe(conn: Any, chave: str, campo: str) -> bool:
    return True


def _sapl_vigente(conn: Any, chave: str, campo: str) -> Any:
    i = _inteiro(chave)
    if i is None or campo not in SAPL_CAMPOS:
        return None
    r = conn.execute({"base_url": "select base_url as v from sapl_houses where id = %s", "status": "select status as v from sapl_houses where id = %s"}[campo], (i,)).fetchone()
    return r["v"] if r else None


def _sapl_territorio(conn: Any, chave: str) -> tuple[dict[str, str] | None, str | None]:
    i = _inteiro(chave)
    r = conn.execute("select p.ibge_code, p.kind from sapl_houses h join places p on p.id = h.place_id where h.id = %s", (i,)).fetchone() if i is not None else None
    return _territorio_de(r)


def _sapl_candidato(campo: str, v: Any) -> str | None:
    if campo == "status":
        return None if v in SAPL_STATUS else f"status de SAPL inválido: {v!r} (esperado um de {', '.join(SAPL_STATUS)})"
    return None if http(v) else f"base_url do SAPL tem de ser uma URL http(s) (veio {v!r})"


def _sapl_desc(campo: str) -> str:
    return {"base_url": "o endereço do SAPL desta casa", "status": "o status do SAPL desta casa"}[campo]


def _sapl_aceita_override(conn: Any, chave: str, campo: str) -> bool:
    """Falso para o `base_url` de Assembleia (casa de UF): o endereço sondado vem de um dicionário fixo do código (`ALE_SAPL`, jobs/sapl.py) e não aceita override;
    a proposta vale, mas a pendência é de `confirmacao`."""
    if campo != "base_url":
        return True
    i = _inteiro(chave)
    r = conn.execute("select p.kind from sapl_houses h join places p on p.id = h.place_id where h.id = %s", (i,)).fetchone() if i is not None else None
    return not (r and r["kind"] == "uf")


# ------------------------------------------------------------------ cobertura


def _cob_campos_validos(campo: str) -> bool:
    return campo in COBERTURA_CAMPOS


def _cob_chave(chave: str) -> tuple[str, str] | None:
    ibge, sep, ds = chave.partition(":") if isinstance(chave, str) else ("", "", "")
    return (ibge, ds) if sep and ibge and ds in COBERTURA_DATASETS else None


def _cob_vigente(conn: Any, chave: str, campo: str) -> Any:
    k = _cob_chave(chave)
    if k is None or campo not in COBERTURA_CAMPOS:
        return None
    sql = {"status": "select c.status as v", "reason": "select c.reason as v", "evidence_url": "select c.evidence_url as v"}[campo]
    r = conn.execute(sql + " from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = %s", k).fetchone()
    return r["v"] if r else None


def _cob_territorio(conn: Any, chave: str) -> tuple[dict[str, str] | None, str | None]:
    k = _cob_chave(chave)
    r = conn.execute("select p.ibge_code, p.kind from data_coverage c join places p on p.id = c.place_id where p.ibge_code = %s and c.dataset = %s", k).fetchone() if k else None
    return _territorio_de(r)


def _cob_candidato(campo: str, v: Any) -> str | None:
    if campo == "status":
        return None if v in COBERTURA_STATUS else f"status de cobertura inválido: {v!r} (esperado um de {', '.join(COBERTURA_STATUS)})"
    if campo == "reason":
        return None if isinstance(v, str) and v.strip() else "reason de cobertura tem de ser texto não vazio"
    return None if http(v) else f"evidence_url de cobertura tem de ser uma URL http(s) (veio {v!r})"


def _cob_desc(campo: str) -> str:
    return {"status": "o status de cobertura deste dado neste lugar", "reason": "o motivo da cobertura deste dado neste lugar",
            "evidence_url": "o endereço da evidência da cobertura deste dado neste lugar"}[campo]


# ------------------------------------------------------------------ contato_mandato


def _contato_campos_validos(campo: str) -> bool:
    if not isinstance(campo, str):
        return False
    kind, valor = _contato(campo)
    if kind == CONTATO_NOVO:
        return valor in CONTATO_KINDS
    return kind in CONTATO_KINDS and bool(valor.strip()) and valor == valor.strip()


def _contato_campo_existe(conn: Any, chave: str, campo: str) -> bool:
    kind, valor = _contato(campo)
    if kind == CONTATO_NOVO:
        return True
    m = _uuid(chave)
    return bool(m and conn.execute("select 1 from mandate_contacts where mandate_id = %s and kind = %s and value = %s", (m, kind, valor)).fetchone())


def _contato_vigente(conn: Any, chave: str, campo: str) -> Any:
    """Contato existente: o valor vigente é o próprio `value` (se a linha existe). `novo:<kind>`: None."""
    if not _contato_campos_validos(campo):
        return None
    kind, valor = _contato(campo)
    return valor if kind != CONTATO_NOVO and _contato_campo_existe(conn, chave, campo) else None


def _contato_territorio(conn: Any, chave: str) -> tuple[dict[str, str] | None, str | None]:
    m = _uuid(chave)
    r = conn.execute("select p.ibge_code, p.kind from mandates m join places p on p.id = m.place_id where m.id = %s", (m,)).fetchone() if m else None
    return _territorio_de(r)


def _contato_candidato(campo: str, v: Any) -> str | None:
    return None if isinstance(v, str) and v.strip() and v == v.strip() else "valor de contato tem de ser texto não vazio, sem espaço nas pontas"


def _contato_desc(campo: str) -> str:
    kind, _ = _contato(campo)
    return f"o contato do tipo {kind} que ainda não consta neste mandato" if kind == CONTATO_NOVO else f"o valor do contato do tipo {kind} deste mandato"


def _contato_desc_real(campo: str) -> str:
    kind, valor = _contato(campo)
    return f"o contato do tipo {valor} deste mandato" if kind == CONTATO_NOVO else _contato_desc(campo)


def _contato_pergunta(campo: str, vigente: Any, candidato: Any) -> str:
    kind, valor = _contato(campo)
    if kind == CONTATO_NOVO:
        return f"Deve ser cadastrado, neste mandato, o contato do tipo {valor} {fmt(candidato)}?"
    return _pergunta_padrao(_contato_desc(campo), vigente, candidato)


# ------------------------------------------------------------------ identidade


def _ident_campos_validos(campo: str) -> bool:
    return campo in IDENTIDADE_CAMPOS


def _ident_vigente(conn: Any, chave: str, campo: str) -> Any:
    q = _uuid(chave)
    if not q or campo not in IDENTIDADE_CAMPOS:
        return None
    r = conn.execute("select status as v from identity_match_queue where id = %s", (q,)).fetchone()
    return r["v"] if r else None


def _ident_territorio(conn: Any, chave: str) -> tuple[dict[str, str] | None, str | None]:
    return None, "casamento de identidade não tem território: o item da fila não guarda lugar, e o local de nascimento da pessoa não é território do registro"


def _ident_candidato(campo: str, v: Any) -> str | None:
    return None if v in IDENTIDADE_STATUS else f"status de identidade inválido: {v!r} (esperado um de {', '.join(IDENTIDADE_STATUS)})"


def _ident_desc(campo: str) -> str:
    return "o status do casamento deste item da fila de identidade"


# ------------------------------------------------------------------ comuns


def _territorio_de(r: dict[str, Any] | None) -> tuple[dict[str, str] | None, str | None]:
    if r is None:
        return None, "registro inexistente"
    if not r["ibge_code"]:
        return None, "o lugar do registro não tem ibge_code"
    nivel = _NIVEL.get(r["kind"])
    if nivel is None:
        return None, f"o lugar do registro é do tipo {r['kind']!r}, que não é município, UF nem país"
    return {"ibge_code": r["ibge_code"], "nivel": nivel}, None


def _sempre(conn: Any, chave: str, campo: str) -> bool:
    return True


def _sempre_override(conn: Any, chave: str, campo: str) -> bool:
    return True


@dataclass(frozen=True)
class ClasseDeCampo:
    id: str
    significado: str
    fontes_aceitas: str
    revalidacao_dias: int | None  # None = sem prazo (reabre quando a evidência ou o valor vigente muda)
    chave_estavel: str
    campos: str  # descrição dos campos válidos, para mensagens
    campos_validos: Callable[[str], bool]
    campo_existe: Callable[[Any, str, str], bool]
    valor_vigente_: Callable[[Any, str, str], Any]
    territorio_com_motivo: Callable[[Any, str], tuple[dict[str, str] | None, str | None]]
    valida_candidato: Callable[[str, Any], str | None]
    descricao_campo: Callable[[str], str]
    aceita_override_: Callable[[Any, str, str], bool]
    pergunta_: Callable[[str, Any, Any], str]

    def registro_existe(self, conn: Any, chave: str) -> bool:
        return isinstance(chave, str) and vin._existe(conn, self.id, chave) is not None

    def rotulo(self, conn: Any, chave: str) -> str | None:
        return vin._rotulos(conn, self.id, [chave]).get(chave) if isinstance(chave, str) and chave.strip() else None

    def valor_vigente(self, conn: Any, chave: str, campo: str) -> Any:
        """Lê a tabela de domínio AGORA. None = sem valor (ou registro/campo inexistente)."""
        return self.valor_vigente_(conn, chave, campo)

    def territorio(self, conn: Any, chave: str) -> dict[str, str] | None:
        return self.territorio_com_motivo(conn, chave)[0]

    def motivo_sem_territorio(self, conn: Any, chave: str) -> str | None:
        return self.territorio_com_motivo(conn, chave)[1]

    def pergunta(self, campo: str, vigente: Any, candidato: Any) -> str:
        """UMA frase, em português, terminada em "?", que cita o campo e os dois valores."""
        return self.pergunta_(campo, vigente, candidato)

    def pergunta_divergencia(self, campo: str, vigente: Any, leituras: list[dict[str, Any]]) -> str:
        return _pergunta_divergencia(self.descricao_campo(campo), vigente, leituras)

    def aceita_override(self, conn: Any, chave: str, campo: str) -> bool:
        return self.aceita_override_(conn, chave, campo)


CLASSES: dict[str, ClasseDeCampo] = {c.id: c for c in (
    ClasseDeCampo(
        id="vinculo_sapl",
        significado="sapl_houses.base_url e status: em que endereço a casa publica o SAPL e se ele responde",
        fontes_aceitas="registro do Interlegis; resposta de /api/ da própria instalação; robots.txt",
        revalidacao_dias=7, chave_estavel="sapl_houses.id",
        campos="base_url | status",
        campos_validos=_sapl_campos_validos, campo_existe=_sapl_campo_existe, valor_vigente_=_sapl_vigente, territorio_com_motivo=_sapl_territorio,
        valida_candidato=_sapl_candidato, descricao_campo=_sapl_desc, aceita_override_=_sapl_aceita_override,
        pergunta_=lambda campo, v, c: _pergunta_padrao(_sapl_desc(campo), v, c)),
    ClasseDeCampo(
        id="cobertura",
        significado="data_coverage.status, reason e evidence_url: o que o site diz ter ou não ter de um lugar",
        fontes_aceitas="a página ou API da própria casa que comprova o estado",
        revalidacao_dias=8, chave_estavel="places.ibge_code + data_coverage.dataset (<ibge_code>:<dataset>)",
        campos="status | reason | evidence_url",
        campos_validos=_cob_campos_validos, campo_existe=_sempre, valor_vigente_=_cob_vigente, territorio_com_motivo=_cob_territorio,
        valida_candidato=_cob_candidato, descricao_campo=_cob_desc, aceita_override_=_sempre_override,
        pergunta_=lambda campo, v, c: _pergunta_padrao(_cob_desc(campo), v, c)),
    ClasseDeCampo(
        id="contato_mandato",
        significado="mandate_contacts: canal oficial do mandato (um campo por contato, <kind>:<value>; novo:<kind> para contato que ainda não existe)",
        fontes_aceitas="página ou API oficial da casa, no bloco do parlamentar (contato de rodapé é da Casa, não do parlamentar)",
        revalidacao_dias=7, chave_estavel="mandates.id",
        campos="<kind>:<value> de mandate_contacts existente | novo:<kind> (kind em " + ", ".join(CONTATO_KINDS) + ")",
        campos_validos=_contato_campos_validos, campo_existe=_contato_campo_existe, valor_vigente_=_contato_vigente, territorio_com_motivo=_contato_territorio,
        valida_candidato=_contato_candidato, descricao_campo=_contato_desc_real, aceita_override_=_sempre_override,
        pergunta_=_contato_pergunta),
    ClasseDeCampo(
        id="identidade",
        significado="identity_match_queue: se o registro da fonte é a pessoa candidata (casamento ambíguo de pessoa)",
        fontes_aceitas="o registro da fonte (raw) e os identificadores de person_external_ids",
        revalidacao_dias=None, chave_estavel="identity_match_queue.id (com o id da pessoa candidata e person_external_ids)",
        campos="status",
        campos_validos=_ident_campos_validos, campo_existe=_sempre, valor_vigente_=_ident_vigente, territorio_com_motivo=_ident_territorio,
        valida_candidato=_ident_candidato, descricao_campo=_ident_desc, aceita_override_=_sempre_override,
        pergunta_=lambda campo, v, c: _pergunta_padrao(_ident_desc(campo), v, c)),
)}
assert tuple(CLASSES) == ORDEM_CLASSES
