"""Proponentes (B3a): a rodada de coleta do SAPL gera sozinha as propostas de mudança das classes `vinculo_sapl` e `cobertura`, com evidência.

PROBLEMA DE DESENHO. O job do SAPL grava direto em `sapl_houses` e `data_coverage`; a administração não o impede nem o edita. Logo a proposta nasce da COMPARAÇÃO do
estado do registro ANTES e DEPOIS da execução do coletor (`fotografar` antes, `fotografar` depois, `propor` compara):
  - campo SEM override: o job já gravou o valor novo. Proposta com `valor_vigente` = o valor de antes da rodada (informado pelo sistema a `propostas.registrar`,
    parâmetro `vigente_antes`) e `valor_candidato` = o de depois. A pendência pergunta se a mudança procede (`mudanca`; `confirmacao` onde `aceita_override` é falso).
  - campo COM override vigente: o gatilho (migração 0151) repôs o decidido e ANOTOU em `adm_overrides.tentou_valor` o que o job tentou gravar. Proposta com
    `valor_vigente` = o decidido (lido do banco, como sempre) e `valor_candidato` = `tentou_valor`, só se a anotação é desta execução (`tentou_em` >= a foto de antes).
    Pela regra de `propostas.registrar`, a pendência decidida REABRE se o hash da evidência difere do da decisão; evidência igual = nada novo = não reabre.
    A anotação conta QUALQUER que seja o `tentou_em`: o job agendado (fora de rodada) pode tê-la feito, e como o gatilho não regrava valor idêntico a rodada seguinte não a renova.
    Condição: a rodada ter tentativa que sustente a proposta (mesma regra de evidência; sem ela, `sem_evidencia`). `Resumo.anotadas_antes` diz `anotada_em` quando foi antes desta
    execução. Idempotência: `chave_idem` (mesmo valor tentado + mesma evidência = proposta repetida, pendência não muda). Falha que persiste com o mesmo desfecho
    (mesma URL, motivo e status HTTP) tem o mesmo hash: proposta repetida, pendência não reabre. Outro motivo ou outro status = hash novo = proposta nova e reabertura.
  - `cobertura.reason` NÃO é proposto isoladamente: é texto gerado pelo job e embute contagens que mudam a cada carga; propor cada mudança encheria a fila sem pergunta útil.
    Só gera proposta quando, na MESMA linha de data_coverage, `status` ou `evidence_url` também mudou nesta rodada (ou, com override, o job também tentou outro valor neles). Mudança só de
    `reason` entra em `Resumo.reason_sem_proposta` (chave, texto de antes e de depois), sem proposta nem pendência. Proposta manual de `reason` pela CLI continua valendo.
  - registro que não existia antes e passou a existir: PRIMEIRO PREENCHIMENTO, não mudança: nenhuma proposta (o resumo conta).
  - campo que não mudou: nenhuma proposta. A rodada NÃO gera "confirmação pela fonte" para campo inalterado (decisão da tarefa; ver `Resumo.inalterados`).

EVIDÊNCIA de cada proposta vem da rodada (`adm_tentativas`, `adm_evidencias`), nunca é inventada. Sem NENHUMA tentativa da rodada que sustente a mudança (ex.: mudança causada
por outro processo) a proposta não é registrada: entra em `Resumo.sem_evidencia`, com o motivo.
  vinculo_sapl.status      ok e sem_api: `<base_url>/api/`. fora_do_ar: `<base_url>/api/` se foi tentada, senão a página do registro do Interlegis (Câmara; o job grava
                           fora_do_ar também quando o registro falha, jobs/sapl.py:338-340). robots_bloqueia: o `robots.txt` do host (que foi LIDO; o bloqueio vem dele,
                           jobs/sapl.py:149 e `assembleias.allowed`). sem_sapl_no_registro: a página do registro.
  vinculo_sapl.base_url    Câmara: a página do registro (`sapl_houses.registry_url`), de onde `parse_registry` tira o endereço (jobs/sapl.py:336). Assembleia: o endereço vem do
                           dicionário ALE_SAPL no código e nenhuma leitura o sustenta: sem evidência.
  cobertura.*              a `evidence_url` que o job gravou na linha SE a rodada a tentou (hoje nunca: são páginas HTML que o job não lê, jobs/sapl.py:635-638); senão a
                           primeira leitura da carga da casa, `<base_url>/api/parlamentares/legislatura/?page_size=100&page=1` (jobs/sapl.py:434: é ela que decide entre
                           `set_coverage` e `_no_legislature`), e, na falta dela, `<base_url>/api/`. O trecho diz que o valor resume a carga inteira e que só esta leitura tem hash aqui.
Tentativa `lida` ou `reaproveitada`: hash do conteúdo (`adm_tentativas`/`adm_evidencias`); `lida_em` = o horário da leitura (para `reaproveitada`, a data da leitura real em
`adm_evidencias` quando o hash é o mesmo, senão o da tentativa; `tentativas.py` explica). Tentativa `falha`: NÃO há conteúdo lido; o hash é o do REGISTRO DA TENTATIVA
(JSON canônico com url, resultado, motivo e http_status, SEM horário: falha que persiste com o mesmo desfecho tem o mesmo hash e não reabre pendência; o hash muda quando muda o motivo ou o status HTTP; o horário fica em `lida_em` e no trecho) e o trecho diz isso. `fonte_declarada_em`: só do cabeçalho `Last-Modified` que o cache em disco guarda para a URL, quando o
hash do cache é o da leitura; o SAPL das fixtures e (até onde o cache mostra) das respostas lidas não o declara: nulo.

Não decide nada sozinho: só registra proposta e deixa a pendência aberta ou reaberta. Não escreve em tabela de domínio. Nenhuma função daqui comita; `registrar` roda num
savepoint por proposta (uma recusa ou erro de uma não derruba as outras).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode, urlparse

from ..catalogo.adaptadores_a import _ale_sapl_bases
from ..catalogo.contrato import Recorte
from ..util import sha256_text
from . import propostas as prop
from .classes import canonico
from .propostas import Proposta, PropostaRecusada
from .saida import ErroAdmin

COLETORES = {"sapl.assembleias": "uf", "sapl.camaras": "municipio"}  # coletor -> nível dos lugares das casas (places.kind)
DATASETS = ("propostas", "presenca", "votos")  # datasets que o SAPL grava em data_coverage (jobs/sapl.py:625-640)
CAMPOS_CASA = ("status", "base_url")
CAMPOS_COBERTURA = ("status", "reason", "evidence_url")
PAGINA_LEGISLATURA = urlencode({"page_size": 100, "page": 1})  # a 1ª leitura de load_house (`pages`: page_size=PAGE, page=1)
LIMITE_VALOR_NO_TRECHO = 200


# ------------------------------------------------------------------ fotos


@dataclass
class Foto:
    """Estado dos registros elegíveis num instante. `casas`: place_id -> {existia, house_id, status, base_url, registry_url, note, kind, uf, ibge, nome}.
    `cobertura`: (place_id, dataset) -> {existia, ibge, status, reason, evidence_url}. `overrides`: (classe, registro_chave, campo) -> {valor, tentou_valor, tentou_marcado, tentou_em}
    (só override vigente que não suprime). Registro que ainda não existe entra com `existia = False` e valores None (valor de antes DESCONHECIDO, não "vazio")."""
    coletor_id: str
    tirada_em: datetime | None = None
    escopo: str = ""
    casas: dict[int, dict[str, Any]] = field(default_factory=dict)
    cobertura: dict[tuple[int, str], dict[str, Any]] = field(default_factory=dict)
    overrides: dict[tuple[str, str, str], dict[str, Any]] = field(default_factory=dict)
    anotacao_disponivel: bool = True  # False: a coluna `tentou_valor` não existe (migração 0151 não aplicada)

    @property
    def vazia(self) -> bool:
        return not self.casas and not self.cobertura


def _tem_anotacao(conn: Any) -> bool:
    return conn.execute("select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'adm_overrides' and column_name = 'tentou_valor'").fetchone() is not None


def fotografar(conn: Any, coletor_id: str, recorte: Recorte | None, elegiveis: dict[str, Any] | None = None) -> Foto:
    """Foto dos registros das classes que o coletor alimenta. Só lê. Coletor sem classe revisável (ou fora de COLETORES): foto vazia.
    Escopo: `sapl.assembleias` = as UFs do recorte (padrão: as de ALE_SAPL); `sapl.camaras` = os municípios de `--ibge`; sem `--ibge` a fila é decidida na execução
    (a prévia não a conhece: `registros_elegiveis.valor` nulo) e o escopo são TODAS as casas de município que existem no momento da foto (as que surgirem depois são primeiro preenchimento).
    `elegiveis` é `previa.registros_elegiveis`; só serve para registrar a contagem declarada na abertura."""
    foto = Foto(coletor_id=coletor_id)
    nivel = COLETORES.get(coletor_id)
    if nivel is None:
        return foto
    r = recorte or Recorte()
    foto.tirada_em = conn.execute("select clock_timestamp() as t").fetchone()["t"]
    foto.anotacao_disponivel = _tem_anotacao(conn)
    if nivel == "uf":
        ufs = list(dict.fromkeys(r.ufs)) or list(_ale_sapl_bases())
        foto.escopo = f"UFs {','.join(ufs)}"
        lugares = conn.execute("select p.id as place_id, p.kind, p.uf, p.ibge_code, p.name from places p where p.kind = 'uf' and p.uf = any(%s)", (ufs,)).fetchall()
    elif r.ibges:
        foto.escopo = f"municípios {','.join(r.ibges)}"
        lugares = conn.execute("select p.id as place_id, p.kind, p.uf, p.ibge_code, p.name from places p where p.kind = 'municipio' and p.ibge_code = any(%s)", (list(r.ibges),)).fetchall()
    else:
        foto.escopo = "todas as casas de município existentes"
        lugares = conn.execute("select p.id as place_id, p.kind, p.uf, p.ibge_code, p.name from places p join sapl_houses h on h.place_id = p.id where p.kind = 'municipio'").fetchall()
    ids = [x["place_id"] for x in lugares]
    por_lugar = {x["place_id"]: x for x in lugares}
    houses = {h["place_id"]: h for h in conn.execute(
        "select id, place_id, status, base_url, registry_url, note from sapl_houses where place_id = any(%s)", (ids,)).fetchall()}
    for pid, lug in por_lugar.items():
        h = houses.get(pid)
        foto.casas[pid] = {"existia": h is not None, "house_id": h["id"] if h else None, "status": h["status"] if h else None, "base_url": h["base_url"] if h else None,
                           "registry_url": h["registry_url"] if h else None, "note": h["note"] if h else None, "kind": lug["kind"], "uf": lug["uf"], "ibge": lug["ibge_code"], "nome": lug["name"]}
    existentes = {(c["place_id"], c["dataset"]): c for c in conn.execute(
        "select place_id, dataset, status, reason, evidence_url from data_coverage where place_id = any(%s) and dataset = any(%s)", (ids, list(DATASETS))).fetchall()}
    for pid, lug in por_lugar.items():
        if not lug["ibge_code"]:
            continue  # lugar sem ibge_code não tem chave de registro de cobertura
        for ds in DATASETS:
            c = existentes.get((pid, ds))
            foto.cobertura[(pid, ds)] = {"existia": c is not None, "ibge": lug["ibge_code"], "status": c["status"] if c else None, "reason": c["reason"] if c else None,
                                         "evidence_url": c["evidence_url"] if c else None}
    chaves = [str(c["house_id"]) for c in foto.casas.values() if c["house_id"] is not None] + [f"{c['ibge']}:{ds}" for (pid, ds), c in foto.cobertura.items()]
    # `tentou_marcado` distingue "o job tentou gravar NULL" (jsonb 'null', que o psycopg devolve como None) de "nunca divergiu" (SQL NULL)
    cols = ("classe, registro_chave, campo, valor, tentou_valor, tentou_valor is not null as tentou_marcado, tentou_em" if foto.anotacao_disponivel
            else "classe, registro_chave, campo, valor, null::jsonb as tentou_valor, false as tentou_marcado, null::timestamptz as tentou_em")
    for o in conn.execute(f"select {cols} from adm_overrides where vigente and not suprimir and classe in ('vinculo_sapl', 'cobertura') and registro_chave = any(%s)", (chaves,)).fetchall():  # noqa: S608
        foto.overrides[(o["classe"], o["registro_chave"], o["campo"])] = {"valor": o["valor"], "tentou_valor": o["tentou_valor"], "tentou_marcado": o["tentou_marcado"], "tentou_em": o["tentou_em"]}
    return foto


# ------------------------------------------------------------------ resumo


@dataclass
class Resumo:
    executado: bool = True
    escopo: str = ""
    novas: list[str] = field(default_factory=list)  # ids das propostas criadas
    repetidas: int = 0
    recusadas: list[dict[str, Any]] = field(default_factory=list)
    primeiros_preenchimentos: dict[str, int] = field(default_factory=dict)  # classe -> campos de registro que não existia antes
    inalterados: int = 0  # campos que não mudaram (nenhuma proposta; a rodada não propõe "confirmação pela fonte")
    sem_evidencia: list[dict[str, Any]] = field(default_factory=list)
    pendencias_abertas: list[str] = field(default_factory=list)
    pendencias_reabertas: list[str] = field(default_factory=list)
    pendencias_ligadas: list[str] = field(default_factory=list)  # a pendência já existia (aberta, ou decidida e sem mudança de evidência ou de vigente)
    reason_sem_proposta: list[dict[str, Any]] = field(default_factory=list)  # mudança só de `reason` (cobertura): contada, sem proposta nem pendência
    anotadas_antes: list[dict[str, Any]] = field(default_factory=list)  # divergência de override anotada ANTES desta execução (`anotada_em`) e ainda assim proposta/avaliada
    avisos: list[str] = field(default_factory=list)

    def para_dict(self) -> dict[str, Any]:
        return {"executado": self.executado, "escopo": self.escopo, "novas": len(self.novas), "ids_novas": list(self.novas), "repetidas": self.repetidas,
                "recusadas": list(self.recusadas), "primeiros_preenchimentos": sum(self.primeiros_preenchimentos.values()),
                "primeiros_preenchimentos_por_classe": dict(sorted(self.primeiros_preenchimentos.items())), "inalterados": self.inalterados,
                "sem_evidencia": list(self.sem_evidencia), "pendencias_abertas": list(self.pendencias_abertas), "pendencias_reabertas": list(self.pendencias_reabertas),
                "pendencias_ligadas": list(self.pendencias_ligadas), "reason_sem_proposta": list(self.reason_sem_proposta), "anotadas_antes": list(self.anotadas_antes),
                "avisos": list(self.avisos)}


# ------------------------------------------------------------------ evidência


@dataclass
class _Evid:
    url: str
    trecho: str
    sha: str
    lida_em: datetime
    declarada_em: datetime | None = None


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat()


def _curto(v: Any) -> str:
    t = v if isinstance(v, str) else canonico(v)
    return t if len(t) <= LIMITE_VALOR_NO_TRECHO else t[:LIMITE_VALOR_NO_TRECHO] + "…"


def _tentativa(conn: Any, rodada_id: str, url: str) -> dict[str, Any] | None:
    return conn.execute(
        "select resultado, motivo, http_status, tentada_em, conteudo_sha256 from adm_tentativas where rodada_id = %s and url_sha = %s order by tentada_em desc, id desc limit 1",
        (rodada_id, sha256_text(url))).fetchone()


def _declarada(url: str, cache_dir: str | None, sha: str) -> datetime | None:
    """Data que a fonte declara no cabeçalho `Last-Modified` guardado no cache em disco, só se o hash do cache é o do conteúdo lido. Nunca levanta."""
    if not cache_dir:
        return None
    try:
        from .rodadas import caminhos_cache  # import tardio: rodadas importa este módulo

        _, meta = caminhos_cache(url, cache_dir)
        m = json.loads(meta.read_text())
        if m.get("sha256") != sha or not m.get("last_modified"):
            return None
        d = parsedate_to_datetime(m["last_modified"])
        d = d if d.tzinfo is not None else d.replace(tzinfo=timezone.utc)
        return d if d <= datetime.now(timezone.utc) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _da_tentativa(conn: Any, rodada_id: str, cache_dir: str | None, url: str, descricao: str) -> _Evid | None:
    """Evidência da ÚLTIMA tentativa da URL na rodada, ou None se a rodada não a tentou. `descricao` diz o que o job leu e fez com o conteúdo."""
    t = _tentativa(conn, rodada_id, url)
    if t is None:
        return None
    quando = t["tentada_em"]
    if t["resultado"] == "falha" or not t["conteudo_sha256"]:
        registro = {"url": url, "resultado": t["resultado"], "motivo": t["motivo"], "http_status": t["http_status"]}  # sem horário: o hash só muda quando o desfecho muda
        st = t["http_status"] if t["http_status"] is not None else "sem resposta"
        trecho = (f"sem conteúdo lido: tentativa {t['resultado']}/{t['motivo']} (HTTP {st}) em {_iso(quando)}; o hash é do registro da tentativa (URL, resultado, motivo e status), não de conteúdo da fonte")
        return _Evid(url, trecho, sha256_text(canonico(registro)), quando)
    sha = t["conteudo_sha256"]
    lida = quando
    sufixo = f"lida em {_iso(quando)}"
    if t["resultado"] == "reaproveitada":
        ev = conn.execute("select conteudo_sha256, lida_em from adm_evidencias where url_sha = %s", (sha256_text(url),)).fetchone()
        if ev and ev["conteudo_sha256"] == sha:
            lida = ev["lida_em"]
        sufixo = f"conteúdo reaproveitado do cache em {_iso(quando)}; leitura real em {_iso(lida)}" + ("" if lida != quando else " (data da leitura real desconhecida: primeira vez que este sistema viu o conteúdo)")
    decl = _declarada(url, cache_dir, sha)
    extra = f"; data declarada pela fonte: cabeçalho Last-Modified do cache ({_iso(decl)})" if decl else ""
    http = f"HTTP {t['http_status']}; " if t["http_status"] is not None else ""
    return _Evid(url, f"{descricao} ({http}{sufixo}){extra}", sha, lida, decl)


def _evidencia_status(conn: Any, rodada_id: str, cache_dir: str | None, casa: dict[str, Any], status: str, base: str | None) -> _Evid | str:
    """Evidência do `status` CANDIDATO (o que o job gravou ou tentou gravar), com a `base` que o job sondou. No caminho de override a tabela guarda o valor DECIDIDO,
    então nem o status nem a base vêm da linha da tabela: vêm do candidato e do `base_url` que o job tentou."""
    nota = casa["note"]
    api = f"{base}/api/" if base else None
    robots = None
    if base:
        u = urlparse(base)
        robots = f"{u.scheme}://{u.netloc}/robots.txt"
    registro = casa["registry_url"] if casa["kind"] == "municipio" else None  # na Assembleia o `registry_url` é o próprio base_url (conferido à mão), não uma página lida
    nota_txt = f"; nota do job: {_curto(nota)}" if nota else ""
    if status in ("ok", "sem_api") and api:
        d = (f"resposta de {api}; o job a aceitou como índice da API REST do SAPL 3.x" if status == "ok"
             else f"resposta de {api}; o job não a reconheceu como índice da API REST do SAPL 3.x")
        ev = _da_tentativa(conn, rodada_id, cache_dir, api, d)
        if ev:
            return ev
    elif status == "robots_bloqueia" and robots:
        ev = _da_tentativa(conn, rodada_id, cache_dir, robots, f"robots.txt de {robots} lido; o job considerou {api} bloqueada")
        if ev:
            return ev
    elif status == "fora_do_ar":
        for u in (api, registro):
            if u:
                ev = _da_tentativa(conn, rodada_id, cache_dir, u, f"conteúdo lido de {u}, mas o job classificou a casa como fora_do_ar{nota_txt}")
                if ev:
                    return ev
    elif status == "sem_sapl_no_registro" and registro:
        ev = _da_tentativa(conn, rodada_id, cache_dir, registro, f"página do registro {registro} lida; o job não achou a linha SAPL no cartão da Câmara Municipal")
        if ev:
            return ev
    return f"nenhuma tentativa da rodada sustenta o status {status!r} (URLs procuradas: {', '.join(u for u in (api, robots, registro) if u) or 'nenhuma'})"


def _evidencia_base_url(conn: Any, rodada_id: str, cache_dir: str | None, casa: dict[str, Any], valor: Any) -> _Evid | str:
    if casa["kind"] != "municipio":
        return "o base_url de Assembleia vem do dicionário ALE_SAPL no código do job (jobs/sapl.py); nenhuma leitura da rodada o sustenta"
    reg = casa["registry_url"]
    if not reg:
        return "a casa não tem registry_url: não há página do registro a citar"
    ev = _da_tentativa(conn, rodada_id, cache_dir, reg, f"endereço do SAPL lido na linha SAPL do cartão da Câmara Municipal de {casa['nome']} na página do registro: {_curto(valor)}")
    return ev or f"a rodada não tentou a página do registro {reg}"


def _evidencia_cobertura(conn: Any, rodada_id: str, cache_dir: str | None, base: str | None, ev_url: str | None, chave: str, campo: str, valor: Any, verbo: str) -> _Evid | str:
    if ev_url:
        ev = _da_tentativa(conn, rodada_id, cache_dir, ev_url, f"evidence_url que o job {verbo} para {chave}")
        if ev:
            return ev
    if not base:
        return "a casa do lugar não tem base_url: não há leitura da carga a citar"
    o_que = f"o job {verbo} {campo} = {_curto(valor)!r} em data_coverage ({chave})"
    for u, qual in ((f"{base}/api/parlamentares/legislatura/?{PAGINA_LEGISLATURA}", "primeira leitura da carga da casa (a legislatura vigente decide entre a carga e o registro de 'sem legislatura')"), (f"{base}/api/", "sondagem da casa")):
        ev = _da_tentativa(conn, rodada_id, cache_dir, u, f"{o_que}; {qual}: {u}. O valor resume as leituras da carga inteira (contagens e legislatura); só esta leitura tem hash neste registro")
        if ev:
            return ev
    return f"a rodada não tentou nenhuma leitura que sustente a cobertura {chave} (procuradas: {base}/api/parlamentares/legislatura/ e {base}/api/)"


# ------------------------------------------------------------------ comparação


@dataclass
class _Mudanca:
    classe: str
    chave: str
    campo: str
    candidato: Any
    place_id: int
    dataset: str | None = None
    vigente_antes: Any = prop.NAO_INFORMADO  # NAO_INFORMADO: override (o vigente é o decidido, lido do banco)
    origem: str = "comparacao"  # comparacao | override
    referencia: Any = None  # o valor "de antes" para exibição: o de antes da rodada (comparacao) ou o decidido (override)
    anotada_em: Any = None  # override: quando o gatilho anotou a divergência


def _mudancas(antes: Foto, depois: Foto, res: Resumo) -> list[_Mudanca]:
    out: list[_Mudanca] = []

    def pp(classe: str) -> None:
        res.primeiros_preenchimentos[classe] = res.primeiros_preenchimentos.get(classe, 0) + 1

    def avalia(classe: str, chave: str, campo: str, valor_antes: Any, valor_depois: Any, existia: bool, place_id: int, dataset: str | None) -> None:
        if not existia:
            pp(classe)
            return
        ov = depois.overrides.get((classe, chave, campo))
        if ov is not None:
            t = ov["tentou_valor"]  # None + tentou_marcado = o job tentou gravar NULL (jsonb 'null')
            if ov["tentou_marcado"] and canonico(t) != canonico(ov["valor"]):  # QUALQUER `tentou_em`: a divergência pode ter sido anotada fora desta rodada (job agendado)
                out.append(_Mudanca(classe, chave, campo, t, place_id, dataset, origem="override", referencia=ov["valor"], anotada_em=ov["tentou_em"]))
            else:
                res.inalterados += 1
            return
        if canonico(valor_antes) == canonico(valor_depois):
            res.inalterados += 1
            return
        out.append(_Mudanca(classe, chave, campo, valor_depois, place_id, dataset, vigente_antes=valor_antes, referencia=valor_antes))

    for pid, d in sorted(depois.casas.items(), key=lambda kv: (kv[1]["house_id"] or 0, kv[0])):
        if d["house_id"] is None:
            continue  # não existe depois: nada a propor
        a = antes.casas.get(pid)
        existia = bool(a and a["existia"])
        for campo in CAMPOS_CASA:
            avalia("vinculo_sapl", str(d["house_id"]), campo, a[campo] if a else None, d[campo], existia, pid, None)
    for (pid, ds), d in sorted(depois.cobertura.items(), key=lambda kv: (kv[1]["ibge"], kv[0][1])):
        if not d["existia"]:
            continue
        a = antes.cobertura.get((pid, ds))
        existia = bool(a and a["existia"])
        for campo in CAMPOS_COBERTURA:
            avalia("cobertura", f"{d['ibge']}:{ds}", campo, a[campo] if a else None, d[campo], existia, pid, ds)
    # `reason` só gera proposta quando, na MESMA linha de data_coverage, `status` ou `evidence_url` também mudou (ou o job também tentou outro valor neles)
    com_outro = {m.chave for m in out if m.classe == "cobertura" and m.campo != "reason"}
    final: list[_Mudanca] = []
    for m in out:
        if m.classe == "cobertura" and m.campo == "reason" and m.chave not in com_outro:
            res.reason_sem_proposta.append({"registro_chave": m.chave, "de": m.referencia, "para": m.candidato, "origem": m.origem})
        else:
            final.append(m)
    return final


# ------------------------------------------------------------------ proposta


def _base_sondada(antes: Foto, depois: Foto, casa: dict[str, Any]) -> str | None:
    """O `base_url` que o JOB usou na rodada: o da tabela, ou, se `base_url` tem override e o job tentou outro nesta execução, o que ele tentou (a tabela guarda o decidido)."""
    ov = depois.overrides.get(("vinculo_sapl", str(casa["house_id"]), "base_url"))
    if ov and ov["tentou_marcado"] and ov["tentou_em"] is not None and antes.tirada_em is not None and ov["tentou_em"] >= antes.tirada_em and isinstance(ov["tentou_valor"], str):
        return ov["tentou_valor"]
    return casa["base_url"]


def propor(conn: Any, rodada_id: str, coletor_id: str, antes: Foto, depois: Foto, *, agora: datetime | None = None) -> Resumo:
    """Compara as fotos e registra as propostas (ver o docstring do módulo). NÃO comita. Coletor sem classe revisável: não faz nada (resumo `executado = False`)."""
    if coletor_id not in COLETORES:
        return Resumo(executado=False, avisos=[f"{coletor_id} não alimenta classe revisável: nenhuma proposta"])
    res = Resumo(escopo=depois.escopo or antes.escopo)
    if not depois.anotacao_disponivel:
        res.avisos.append("migração 0151 não aplicada neste banco: a divergência entre o job e um override não é detectada (só a mudança de campo sem override)")
    rod = conn.execute("select cache_dir from adm_rodadas where id = %s", (rodada_id,)).fetchone()
    if rod is None:
        raise ErroAdmin(f"rodada inexistente: {rodada_id}")
    cache_dir = rod["cache_dir"]
    cache_recorte: dict[str, Any] = {}
    casas_por_lugar = depois.casas
    for m in _mudancas(antes, depois, res):
        if m.origem == "override" and m.anotada_em is not None and antes.tirada_em is not None and m.anotada_em < antes.tirada_em:
            res.anotadas_antes.append({"classe": m.classe, "registro_chave": m.chave, "campo": m.campo, "anotada_em": m.anotada_em.isoformat()})
        casa = casas_por_lugar.get(m.place_id)
        if casa is None:
            res.sem_evidencia.append({"classe": m.classe, "registro_chave": m.chave, "campo": m.campo, "motivo": "lugar fora da foto de depois"})
            continue
        if m.candidato is None:
            quem = "o job tentou gravar NULL (o valor decidido foi mantido)" if m.origem == "override" else "o job gravou NULL"
            res.recusadas.append({"classe": m.classe, "registro_chave": m.chave, "campo": m.campo, "valor_candidato": None,
                                  "motivo": f"{quem}: ausência de valor não se propõe (valor_candidato nulo é recusado na entrada; o valor de antes era {_curto(m.vigente_antes) if m.origem != 'override' else 'o decidido'})"})
            continue
        base = _base_sondada(antes, depois, casa)
        verbo = "tentou gravar (o gatilho manteve o valor decidido)" if m.origem == "override" else "gravou"
        if m.classe == "vinculo_sapl":
            ev = _evidencia_status(conn, rodada_id, cache_dir, casa, m.candidato, base) if m.campo == "status" else _evidencia_base_url(conn, rodada_id, cache_dir, casa, m.candidato)
        else:
            linha = depois.cobertura[(m.place_id, m.dataset)]
            ev_url = linha["evidence_url"] if m.origem == "comparacao" else (m.candidato if m.campo == "evidence_url" else None)  # no override a tabela guarda o decidido, não o que o job gravou
            ev = _evidencia_cobertura(conn, rodada_id, cache_dir, base, ev_url, m.chave, m.campo, m.candidato, verbo)
        if isinstance(ev, str):
            res.sem_evidencia.append({"classe": m.classe, "registro_chave": m.chave, "campo": m.campo, "motivo": ev})
            continue
        p = Proposta(classe=m.classe, registro_chave=m.chave, campo=m.campo, valor_candidato=m.candidato, url=ev.url, trecho=ev.trecho, conteudo_sha256=ev.sha, lida_em=ev.lida_em,
                     fonte_declarada_em=ev.declarada_em, fonte_slug="sapl-ale" if casa["kind"] == "uf" else "sapl", alcance="registro", rodada_id=rodada_id)
        try:
            with conn.transaction():  # savepoint: uma recusa ou erro de banco numa proposta não derruba as outras
                r = prop.registrar(conn, p, agora=agora, cache_recorte=cache_recorte, vigente_antes=m.vigente_antes)
        except PropostaRecusada as e:
            res.recusadas.append({"classe": m.classe, "registro_chave": m.chave, "campo": m.campo, "valor_candidato": m.candidato, "motivo": str(e)})
            continue
        if not r.nova:
            res.repetidas += 1
            continue
        res.novas.append(r.proposta_id)
        if r.pendencia_acao == "criada":
            res.pendencias_abertas.append(r.pendencia_id)
        elif r.pendencia_acao == "reaberta":
            res.pendencias_reabertas.append(r.pendencia_id)
        elif r.pendencia_id:
            res.pendencias_ligadas.append(r.pendencia_id)
    return res

