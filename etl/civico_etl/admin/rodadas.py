"""Prévia de rodada e rodada de coleta (A5): `civico-etl admin previa` e `civico-etl admin rodada`.

PRÉVIA (`previa`): sem rede e sem escrita. Parte de `contrato.descrever(..., conn=conn)` e acrescenta o que o banco e o cache em disco de
`http.fetch` dizem. O que não se sabe sem rede aparece como `null` com motivo ou como ESTIMATIVA MARCADA (`{"valor": N, "estimativa": true,
"base": "..."}`); nunca como número seco. Limites que a prévia declara: as páginas seguintes da paginação só aparecem durante a leitura; o
`max_age` é argumento de cada chamada de `http.fetch` e não fica registrado, então "em cache" não quer dizer "não vai à rede".
O estado do cache é lido pela mesma fórmula de `http._paths` (host/sha256(url)[:32]) SEM criar diretório (`_paths` faz mkdir); um teste confere
que as duas dão o mesmo caminho.

URLs de entrada: `urls_entrada` é a lista da prévia, congelada em `adm_rodadas.previa` por `abrir`; a rodada nunca redescreve depois do coletor.
Cada URL traz `condicional` (nulo, ou o texto da condição). Só uma é condicional hoje: em `sapl.assembleias`, a 1ª página de legislaturas de
cada casa `ok` do banco (o adaptador as lista quando há `conn`), que só é pedida se a casa entra na fila de carga (`load_queue`: STALE_DAYS de 6
dias e backoff). `n_urls_entrada` conta só as firmes; é o número que a rodada afirma igual (ver `executar`: `urls_entrada.previstas`).

RODADA (`abrir`, `executar`, `repetir`, `descrever_rodada`, `listar`): linha em `adm_rodadas` com coletor, modo, argv, recorte (JSON
reconstruível em `Recorte`), prévia, `forcar_urls`, `so_pendencias`, `repete_id`, `cache_dir`, `invocation`. As funções recebem `conn` (autocommit
desligado); `executar` comita nos pontos em que o coletor, que conecta por conta própria (`db.connect()`, pelo ambiente), precisa ver o estado.

Execução (R3): `contrato.executar` -> `civico_etl.cli.main` (mesmo despacho da CLI, com os passos encadeados); nunca a função interna do job.
Ambiente do coletor, definido só durante a execução e restaurado depois (inclusive em erro):
  ETL_ATTEMPT_LOG   <cache_dir>/../admin-rodadas/<rodada>-<n>.jsonl, um arquivo por EXECUÇÃO (n = 1, 2, ... na mesma rodada, se ela foi
                    interrompida e retomada); preservado depois da importação (é a evidência bruta). Execuções anteriores sem importação são importadas
                    de novo na próxima (o importador é idempotente).
  ETL_INVOCATION    admin:<rodada_id> (a variável que `db.invocation()` lê; vai para `ingest_runs.invocation`) e `adm_rodadas.invocation`.
  ETL_HTTP_REFETCH  <...>/<rodada>-<n>.refetch, só quando há `forcar_urls`. Um arquivo por execução porque `http._refetch` guarda o conteúdo por caminho.
  ETL_HTTP_OFFLINE  "1" no modo `reprocessar`; vazio nos outros (o ambiente herdado não liga o modo sem rede por acidente).
  ETL_CACHE_DIR     `adm_rodadas.cache_dir` (subprocesso); em processo, `http.CACHE_DIR` é trocado e restaurado.
Runner: subprocesso (`contrato.runner_subprocesso`), salvo `ADMIN_RUNNER=processo` (necessário com o transporte fabricado de tests/simulado.py,
que não atravessa processo) ou `runner=` injetado. Em processo, `assembleias._robots` (cache em memória do robots.txt) é zerado antes: um processo
novo começaria sem ele, e sem isso a 2ª rodada no mesmo processo não pediria o robots.txt (e não o registraria). `ADMIN_RODADA_TIMEOUT_S`
(opcional) limita o subprocesso; estourar = código 124 = interrompida.

Desfecho do coletor -> status da rodada (a mesma tabela vai em `resultado.regra`):
  | desfecho                                                                             | status       |
  | pré-condição do `reprocessar` falha (URL de entrada fora do cache): coletor NÃO roda | falhou       |
  | recorte deixou de ser suportado entre abrir e executar: coletor NÃO roda             | falhou       |
  | código 0                                                                             | concluida    |
  | código 124 (timeout do subprocesso)                                                  | interrompida |
  | KeyboardInterrupt, SystemExit ou exceção do runner (BaseException)                   | interrompida |
  | SemRedeSemCache no registro (URL fora do cache em modo sem rede)                     | falhou       |
  | código != 0, nenhuma leitura (lida ou reaproveitada) no registro                     | falhou       |
  | código != 0, houve leitura (o coletor terminou por conta própria: falha parcial)     | concluida    |
  | código != 0, coletor sem registro de tentativas (não distingue parcial de total)     | falhou       |
`concluida` e `falhou` são finais (a repetição abre outra rodada); `interrompida` é retomada na MESMA linha. Em qualquer desfecho o que o
coletor já registrou é importado, as tentativas por robots são registradas e os vínculos são sincronizados.

Propostas (B3a, `proponentes.py`): `executar` tira uma foto dos registros das classes do coletor (`sapl_houses`, `data_coverage`, `adm_overrides`) logo antes de rodar o coletor
e outra depois de importar as tentativas e sincronizar os vínculos; `proponentes.propor` compara as duas e registra as propostas de mudança com evidência da rodada. O resumo vai em
`previa.resultado.propostas`. Se a foto ou o proponente falha, a rodada NÃO perde o que coletou (tentativas e vínculos já foram comitados): `resultado.propostas = {executado: false,
erro: ...}` e a rodada termina com o status que teria sem ele. Rodada `interrompida` propõe o que já mudou; a repetição completa o resto sem duplicar (`chave_idem`).

Onde fica o resultado: `adm_rodadas.previa` (JSON; não há coluna de erro e a migração não muda). `previa.resultado` = a última execução;
`previa.execucoes` = todas, em ordem (a rodada interrompida é reexecutada na mesma linha). O resto de `previa` é a prévia congelada.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sys
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import parse_qs, urlparse

from psycopg.types.json import Jsonb

from .. import http as H
from ..catalogo import contrato
from ..catalogo.adaptadores_a import _ale_sapl_bases
from ..catalogo.contrato import Recorte
from ..catalogo.coletores import coletor as _coletor
from ..util import sha256_text
from . import tentativas as T
from . import vinculos as V
from .saida import ErroAdmin, lista_chave_valor, tabela

STATUS_FINAIS = ("concluida", "falhou")
CLASSES_REVISAVEIS = {"vinculo_sapl": "sapl_houses", "cobertura": "data_coverage", "contato_mandato": "mandate_contacts", "identidade": "identity_match_queue"}
BASE_A_CONSULTAR = "fora do cache vai à rede; em cache depende do max_age de cada chamada (não registrado)"
SEM_TENTATIVAS = "tentativas não registradas para este coletor"
CONDICAO_FILA = "só é pedida se a casa entra na fila de carga (STALE_DAYS de 6 dias, backoff) e a sondagem a deixa 'ok'"
REGRA_DESFECHO = {
    "reprocessar_sem_cache": "pré-condição do reprocessar falha: coletor não roda -> falhou",
    "nao_suportado": "recorte deixou de ser suportado: coletor não roda -> falhou",
    "codigo_0": "código 0 -> concluida",
    "timeout": "código 124 (timeout) -> interrompida",
    "excecao": "KeyboardInterrupt, SystemExit ou exceção do runner -> interrompida",
    "sem_rede_sem_cache": "SemRedeSemCache no registro -> falhou",
    "codigo_sem_leitura": "código != 0 sem nenhuma leitura no registro -> falhou",
    "codigo_com_leitura": "código != 0 com leitura (falha parcial, o coletor terminou por conta própria) -> concluida",
    "codigo_sem_registro": "código != 0 em coletor sem registro de tentativas -> falhou",
}


# ---------------------------------------------------------------- recorte <-> JSON


def recorte_para_json(r: Recorte) -> dict[str, Any]:
    return {"anos": list(r.anos), "ufs": list(r.ufs), "casas": list(r.casas), "ibges": list(r.ibges), "extras": dict(r.extras), "modo": r.modo}


def recorte_de_json(d: dict[str, Any]) -> Recorte:
    return Recorte(anos=tuple(d.get("anos") or ()), ufs=tuple(d.get("ufs") or ()), casas=tuple(d.get("casas") or ()), ibges=tuple(d.get("ibges") or ()),
                   extras=dict(d.get("extras") or {}), modo=d.get("modo") or "recoletar")


def _texto_recorte(d: dict[str, Any]) -> str:
    partes = [f"{k}={','.join(str(x) for x in d[k])}" for k in ("anos", "ufs", "casas", "ibges") if d.get(k)]
    partes += [f"{k}={v}" for k, v in (d.get("extras") or {}).items()]
    return " ".join(partes) or "sem recorte (padrão do comando)"


# ---------------------------------------------------------------- cache em disco (sem criar diretório)


def caminhos_cache(url: str, cache_dir: Path | str) -> tuple[Path, Path]:
    """A fórmula de `http._paths`, sem o mkdir."""
    host = urlparse(url).netloc.replace(":", "_")
    chave = sha256_text(url)[:32]
    d = Path(cache_dir) / host
    return d / f"{chave}.body", d / f"{chave}.meta.json"


def estado_cache(url: str, cache_dir: Path | str, agora_s: float) -> dict[str, Any]:
    body, meta = caminhos_cache(url, cache_dir)
    if not (body.exists() and meta.exists()):  # a mesma condição de http._fetch
        return {"estado": "fora_do_cache"}
    try:
        m = json.loads(meta.read_text())
        return {"estado": "em_cache", "idade_horas": round((agora_s - float(m["fetched_at"])) / 3600, 2), "sha256": m.get("sha256")}
    except (OSError, ValueError, KeyError, TypeError):
        return {"estado": "fora_do_cache", "motivo": "metadados do cache ilegíveis"}


def _agora_s(agora: datetime | float | None) -> float:
    import time

    if agora is None:
        return time.time()
    return agora.timestamp() if isinstance(agora, datetime) else float(agora)


# ---------------------------------------------------------------- prévia


def _condicional(coletor_id: str, url: str) -> str | None:
    if coletor_id == "sapl.assembleias" and "/api/parlamentares/legislatura/" in url:
        return CONDICAO_FILA
    return None


def _elegiveis(conn: Any, c: Any, r: Recorte) -> dict[str, Any]:
    if c.id == "sapl.assembleias":
        bases = _ale_sapl_bases()
        alvo = list(dict.fromkeys(r.ufs)) or list(bases)
        rows = conn.execute(
            """select p.uf, b.name as orgao, h.id as house_id from places p
               join legislative_bodies b on b.place_id = p.id and b.kind in ('assembleia', 'camara_legislativa_df')
               left join sapl_houses h on h.place_id = p.id
               where p.kind = 'uf' and p.uf = any(%s) order by array_position(%s::text[], p.uf)""", (alvo, alvo)).fetchall()
        chaves = [{"uf": x["uf"], "orgao": x["orgao"], "sapl_houses_id": x["house_id"]} for x in rows]
        sem = [u for u in alvo if u not in {x["uf"] for x in rows}]
        return {"classe": "vinculo_sapl", "valor": len(chaves), "chaves": chaves, "motivo": None,
                "base": "Assembleias em legislative_bodies das UFs do recorte; sapl_houses_id nulo = casa ainda não registrada" + (f"; UF sem Assembleia no banco: {sem}" if sem else "")}
    if c.id == "sapl.camaras" and r.ibges:
        rows = conn.execute(
            "select pl.ibge_code, pl.name, h.id as house_id, h.status from places pl left join sapl_houses h on h.place_id = pl.id "
            "where pl.kind = 'municipio' and pl.ibge_code = any(%s) order by pl.ibge_code", (list(r.ibges),)).fetchall()
        chaves = [{"ibge": x["ibge_code"], "municipio": x["name"], "sapl_houses_id": x["house_id"], "status": x["status"]} for x in rows]
        sem = [i for i in r.ibges if i not in {x["ibge_code"] for x in rows}]
        return {"classe": "vinculo_sapl", "valor": len(chaves), "chaves": chaves, "motivo": None,
                "base": "municípios do recorte em places" + (f"; IBGE fora de places: {sem}" if sem else "")}
    if c.id == "sapl.camaras":
        return {"classe": "vinculo_sapl", "valor": None, "chaves": [], "motivo": "sem --ibge o escopo é a fila de câmaras na hora da execução; não é determinável sem rede"}
    if c.id == "parlamento.extras":  # os mandatos em exercício que o job cobre (consulta do próprio job, só banco: não depende de rede)
        from . import proponentes as PRO  # import tardio: proponentes -> propostas -> relatorio -> rodadas

        mand = conn.execute(PRO.MANDATOS_EXTRAS_SQL).fetchall()
        ids = [str(x["mandate_id"]) for x in mand]
        rot = V._rotulos(conn, "contato_mandato", ids)
        urls = {str(x["mandate_id"]): PRO.url_documento_do_mandato(x["kind"], str(x["external_id"])) for x in mand}  # a URL que o job lê: a mesma que o proponente cita como evidência
        return {"classe": "contato_mandato", "valor": len(ids), "chaves": [{"mandate_id": i, "rotulo": rot.get(i), "url": urls[i]} for i in ids], "motivo": None,
                "base": "mandatos em exercício da Câmara dos Deputados e do Senado com id externo da casa (a consulta de parlamento_extras.py:44-49); o rótulo é cargo · casa · lugar, sem pessoa nem partido"}
    tocadas = sorted(k for k, t in CLASSES_REVISAVEIS.items() if t in c.tabelas)
    if not tocadas:
        return {"classe": None, "valor": None, "chaves": [], "motivo": "o coletor não alimenta classe revisável (vinculo_sapl, cobertura, contato_mandato, identidade)"}
    return {"classe": None, "valor": None, "chaves": [], "motivo": f"o coletor grava em tabela de classe revisável ({', '.join(tocadas)}), mas os registros do recorte não são determináveis sem rede"}


def _rodada_base(conn: Any, coletor_id: str, recorte_json: dict[str, Any]) -> dict[str, Any] | None:
    sem_modo = {k: v for k, v in recorte_json.items() if k != "modo"}
    return conn.execute(
        "select id, coalesce(finalizada_em, iniciada_em) as quando from adm_rodadas where coletor = %s and status = 'concluida' and (recorte - 'modo') = %s::jsonb "
        "order by coalesce(finalizada_em, iniciada_em) desc limit 1", (coletor_id, Jsonb(sem_modo))).fetchone()


def previa(conn: Any, coletor_id: str, recorte: Recorte | None = None, *, cache_dir: Path | str | None = None, agora: datetime | float | None = None) -> dict[str, Any]:
    """Prévia da rodada. Sem rede e sem escrita (só lê o banco e o cache em disco). `nao_suportado` preenchido = a rodada seria recusada."""
    r = recorte or Recorte()
    try:
        c = _coletor(coletor_id)
    except KeyError:
        raise ErroAdmin(f"coletor desconhecido: {coletor_id!r} (veja `admin inventario`)") from None
    d = contrato.descrever(coletor_id, r, conn=conn)
    rj = recorte_para_json(r)
    out: dict[str, Any] = {"coletor": c.id, "modo": r.modo, "recorte": rj, "nao_suportado": d.nao_suportado or None, "comando": d.comando, "argv": list(d.argv),
                           "fontes": [f.slug for f in c.fontes], "datasets": list(c.datasets), "tentativas_registradas": c.tentativas_registradas}
    if d.nao_suportado:
        return out
    agora_s = _agora_s(agora)
    pasta = Path(cache_dir) if cache_dir is not None else Path(H.CACHE_DIR)
    out["cache_dir"] = str(pasta)
    out["gerada_em"] = datetime.fromtimestamp(agora_s, timezone.utc).isoformat()
    out["registros_elegiveis"] = _elegiveis(conn, c, r)
    itens: list[dict[str, Any]] = []
    for u in d.urls_entrada:
        item: dict[str, Any] = {"url": u, "condicional": _condicional(c.id, u)}
        item["cache"] = estado_cache(u, pasta, agora_s) if c.tentativas_registradas else None
        if item["cache"] is None:
            item["desconhecidos"] = {"cache": f"{c.id} não passa por http.fetch (sem cache em disco)"}
        itens.append(item)
    firmes = [i for i in itens if not i["condicional"]]
    out["urls_entrada"] = itens
    out["n_urls_entrada"] = len(firmes)
    out["n_urls_condicionais"] = len(itens) - len(firmes)
    out["lista_completa"] = not d.estimativa
    out["entradas_tipo"] = d.entradas_tipo
    out["observacao"] = d.observacao
    if not c.tentativas_registradas:
        out["a_consultar"] = {"valor": None, "estimativa": False, "base": SEM_TENTATIVAS}
        out["demais_urls"] = {"valor": None, "estimativa": False, "base": SEM_TENTATIVAS}
        return out
    fora = [i["url"] for i in firmes if i["cache"]["estado"] == "fora_do_cache"]
    if r.modo == "reprocessar":
        out["a_consultar"] = {"valor": 0, "estimativa": False, "base": "modo sem rede (ETL_HTTP_OFFLINE): nenhuma consulta; URL ausente do cache recusa a rodada"}
        out["faltam_no_cache"] = fora
        out["condicionais_fora_do_cache"] = [i["url"] for i in itens if i["condicional"] and i["cache"]["estado"] == "fora_do_cache"]
    else:
        out["a_consultar"] = {"valor": len(fora), "estimativa": True, "base": BASE_A_CONSULTAR, "intervalo": [len(fora), len(firmes)]}
    base = _rodada_base(conn, c.id, rj)
    if base is None:
        out["demais_urls"] = {"valor": None, "estimativa": False, "base": "desconhecido: nenhuma rodada anterior deste recorte"}
    else:
        n = conn.execute("select count(distinct url_sha) as n from adm_tentativas where rodada_id = %s and not entrada", (base["id"],)).fetchone()["n"]
        out["demais_urls"] = {"valor": n, "estimativa": True, "base": f"rodada {base['id']} de {base['quando']:%Y-%m-%d}", "rodada_base": str(base["id"])}
    return out


def _estim(x: dict[str, Any] | None) -> str:
    if x is None:
        return "desconhecido"
    if x.get("valor") is None:
        return x["base"] if x["base"].startswith("desconhecido") or x["base"] == SEM_TENTATIVAS else f"desconhecido: {x['base']}"
    sufixo = f" (estimativa; base: {x['base']}" + (f"; entre {x['intervalo'][0]} e {x['intervalo'][1]}" if x.get("intervalo") else "") + ")" if x.get("estimativa") else f" ({x['base']})"
    return f"{x['valor']}{sufixo}"


def texto_previa(p: dict[str, Any]) -> str:
    if p.get("nao_suportado"):
        return lista_chave_valor([("coletor", p["coletor"]), ("modo", p["modo"]), ("recorte", _texto_recorte(p["recorte"])), ("não suportado", p["nao_suportado"])])
    el = p["registros_elegiveis"]
    pares = [("coletor", p["coletor"]), ("modo", p["modo"]), ("recorte", _texto_recorte(p["recorte"])), ("comando", p["comando"]), ("argv", " ".join(p["argv"])),
             ("fontes", ", ".join(p["fontes"])), ("datasets", ", ".join(p["datasets"])),
             ("registros elegíveis", f"{el['valor']} ({el['classe']}; {el['base']})" if el["valor"] is not None else f"desconhecido: {el['motivo']}"),
             ("URLs de entrada", f"{p['n_urls_entrada']} firmes + {p['n_urls_condicionais']} condicionais" + ("" if p["lista_completa"] else "; lista incompleta: só as conhecidas sem leitura")),
             ("a consultar", _estim(p["a_consultar"])), ("demais URLs", _estim(p["demais_urls"]))]
    if p["tentativas_registradas"] is False:
        pares.append(("tentativas", SEM_TENTATIVAS))
    if p["modo"] == "reprocessar" and p["tentativas_registradas"]:
        pares.append(("faltam no cache", ", ".join(p["faltam_no_cache"]) or "nenhuma"))
    if p["observacao"]:
        pares.append(("observação", p["observacao"]))
    linhas = [{"url": i["url"], "condicao": "condicional: " + i["condicional"] if i["condicional"] else "firme", "estado": (i["cache"] or {}).get("estado"),
               "idade": (i["cache"] or {}).get("idade_horas"), "hash": ((i["cache"] or {}).get("sha256") or "")[:12] or None, "desconhecidos": i.get("desconhecidos", {})} for i in p["urls_entrada"]]
    for l in linhas:
        if l["estado"] == "fora_do_cache":
            l["idade"] = l["hash"] = "-"
        for k in ("estado", "idade", "hash"):
            if l[k] is None:
                l["desconhecidos"] = {**l["desconhecidos"], k: l["desconhecidos"].get("cache", "sem cache em disco")}
    tab = tabela((("url", "URL DE ENTRADA"), ("condicao", "CONDIÇÃO"), ("estado", "CACHE"), ("idade", "IDADE (h)"), ("hash", "HASH")), linhas,
                 total=f"{p['n_urls_entrada']} URLs de entrada firmes de {len(linhas)} listadas")
    return lista_chave_valor(pares) + "\n\n" + tab


# ---------------------------------------------------------------- linha de rodada


def _uuid(rodada_id: Any) -> str:
    try:
        return str(uuid.UUID(str(rodada_id)))
    except ValueError:
        raise ErroAdmin(f"identificador de rodada inválido: {rodada_id!r}") from None


def _carregar(conn: Any, rodada_id: Any, *, travar: bool = False) -> dict[str, Any]:
    rid = _uuid(rodada_id)
    row = conn.execute("select * from adm_rodadas where id = %s" + (" for update" if travar else ""), (rid,)).fetchone()
    if row is None:
        raise ErroAdmin(f"rodada inexistente: {rid}")
    return row


def _urls_da_previa(pv: dict[str, Any]) -> list[str]:
    return [i["url"] for i in (pv.get("urls_entrada") or [])]


def _abrir(conn: Any, coletor_id: str, recorte: Recorte | None, *, modo: str | None, forcar_urls: Sequence[str], so_pendencias: bool, repete_id: str | None,
           cache_dir: Path | str | None, permitidas: set[str] | None) -> str:
    r = recorte or Recorte()
    if modo is not None and modo != r.modo:
        r = replace(r, modo=modo)
    pv = previa(conn, coletor_id, r, cache_dir=cache_dir)
    if pv["nao_suportado"]:
        raise ErroAdmin(f"rodada recusada: {pv['nao_suportado']}")
    forcar = list(dict.fromkeys(forcar_urls))
    validas = permitidas if permitidas is not None else set(_urls_da_previa(pv))
    estranhas = [u for u in forcar if u not in validas]
    if estranhas:
        raise ErroAdmin("forçar releitura só vale para URL de entrada da rodada ou tentativa registrada dela; não pertence: " + ", ".join(estranhas))
    row = conn.execute(
        "insert into adm_rodadas (coletor, modo, argv, recorte, previa, repete_id, so_pendencias, forcar_urls, status, cache_dir) "
        "values (%s, %s, %s, %s, %s, %s, %s, %s, 'aberta', %s) returning id",
        (coletor_id, r.modo, Jsonb(pv["argv"]), Jsonb(pv["recorte"]), Jsonb(pv), repete_id, so_pendencias, Jsonb(forcar) if forcar else None, pv["cache_dir"])).fetchone()
    return str(row["id"])


def abrir(conn: Any, coletor_id: str, recorte: Recorte | None = None, *, modo: str | None = None, forcar_urls: Sequence[str] = (), so_pendencias: bool = False,
          repete_id: str | None = None, cache_dir: Path | str | None = None) -> str:
    """Abre a rodada (status `aberta`) com a prévia congelada. Recorte ou modo não suportado: `ErroAdmin`, nada é gravado. Não comita."""
    return _abrir(conn, coletor_id, recorte, modo=modo, forcar_urls=forcar_urls, so_pendencias=so_pendencias, repete_id=repete_id, cache_dir=cache_dir, permitidas=None)


# ---------------------------------------------------------------- execução


@contextlib.contextmanager
def _ambiente_em_processo(env: dict[str, str], cache_dir: str):
    """Põe `env` em os.environ e `http.CACHE_DIR`; restaura tudo no fim (inclusive em erro). Zera o cache de robots.txt em memória do job."""
    antes = {k: os.environ.get(k) for k in env}
    cache_antes = H.CACHE_DIR
    os.environ.update(env)
    H.CACHE_DIR = Path(cache_dir)
    mod = sys.modules.get("civico_etl.jobs.assembleias")
    if mod is not None:
        mod._robots.clear()
    try:
        yield
    finally:
        for k, v in antes.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        H.CACHE_DIR = cache_antes


def _runner(runner: Callable[[list[str]], int] | None, env: dict[str, str], cache_dir: str) -> tuple[Callable[[list[str]], int], str]:
    if runner is not None or os.environ.get("ADMIN_RUNNER") == "processo":
        base = runner or contrato._runner_em_processo

        def em_processo(argv: list[str]) -> int:
            with _ambiente_em_processo(env, cache_dir):
                return int(base(argv))

        return em_processo, "injetado" if runner is not None else "processo"
    limite = os.environ.get("ADMIN_RODADA_TIMEOUT_S")
    return (lambda argv: contrato.runner_subprocesso(argv, env={**env, "ETL_CACHE_DIR": cache_dir}, timeout_s=float(limite) if limite else None)), "subprocesso"


def _semcache(caminho: Path) -> list[str]:
    """URLs cuja leitura abortou por SemRedeSemCache (o registro as marca em `detalhe`)."""
    out: list[str] = []
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                d = json.loads(linha)
            except ValueError:
                continue
            if isinstance(d, dict) and str(d.get("detalhe", "")).startswith("SemRedeSemCache") and d.get("url") not in out:
                out.append(d["url"])
    return out


def _urls_do_log(caminho: Path) -> list[str]:
    out: list[str] = []
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                u = json.loads(linha).get("url")
            except (ValueError, AttributeError):
                continue
            if isinstance(u, str):
                out.append(u)
    return out


def _registrar_robots(conn: Any, rodada_id: str, coletor_id: str, urls_entrada: Sequence[str], inicio: datetime) -> list[str]:
    """Bloqueio por robots.txt acontece antes de `fetch` e não aparece no registro: sai de `sapl_houses.status = 'robots_bloqueia'`. Só conta
    casa cuja sondagem desta execução (`checked_at` >= início) deu o bloqueio, e só quando a `/api/` dela é URL de entrada. `tentada_em` = `checked_at`."""
    if not coletor_id.startswith("sapl."):
        return []
    apis = sorted({u for u in urls_entrada if u.endswith("/api/")})
    if not apis:
        return []
    feitos: list[str] = []
    # Com override em `status` a tabela guarda o DECIDIDO: o bloqueio que o job viu está em `adm_overrides.tentou_valor` (0151; anotado pelo gatilho). Casa com override vigente de
    # status vale pelo `tentou_valor`, não pelo `status` da tabela (um decidido 'robots_bloqueia' não prova que esta rodada foi bloqueada).
    from . import proponentes as PRO  # import tardio (ver `_foto`)

    com_anotacao = PRO._tem_anotacao(conn)
    ov = ("exists (select 1 from adm_overrides o where o.vigente and o.classe = 'vinculo_sapl' and o.registro_chave = h.id::text and o.campo = 'status')"
          if com_anotacao else "false")
    bloqueada = ("exists (select 1 from adm_overrides o where o.vigente and o.classe = 'vinculo_sapl' and o.registro_chave = h.id::text and o.campo = 'status' "
                 "and o.tentou_valor = '\"robots_bloqueia\"'::jsonb)" if com_anotacao else "false")
    sql = (f"select h.base_url, h.checked_at from sapl_houses h where case when {ov} then {bloqueada} else h.status = 'robots_bloqueia' end "  # noqa: S608 (fragmentos fixos)
           "and h.base_url || '/api/' = any(%s) and h.checked_at >= %s order by h.base_url")
    for h in conn.execute(sql, (apis, inicio)).fetchall():
        url = h["base_url"] + "/api/"
        if conn.execute("select 1 from adm_tentativas where rodada_id = %s and url_sha = %s and motivo is distinct from 'robots' limit 1", (rodada_id, sha256_text(url))).fetchone():
            continue  # a URL passou por fetch nesta rodada: não é bloqueio por robots
        T.registrar_robots(conn, rodada_id, url, h["checked_at"], entrada=True)
        feitos.append(url)
    return feitos


def _decidir(codigo: int | None, interrupcao: str | None, semcache: list[str], lidas: int | None) -> tuple[str, str]:
    """(status, chave de REGRA_DESFECHO). `lidas` = leituras (lida ou reaproveitada) no registro; None = coletor sem registro de tentativas."""
    if interrupcao:
        return "interrompida", "excecao"
    if codigo == 124:
        return "interrompida", "timeout"
    if codigo == 0:
        return "concluida", "codigo_0"
    if semcache:
        return "falhou", "sem_rede_sem_cache"
    if lidas is None:
        return "falhou", "codigo_sem_registro"
    if lidas == 0:
        return "falhou", "codigo_sem_leitura"
    return "concluida", "codigo_com_leitura"


def _finalizar(conn: Any, rodada_id: str, status: str, resultado: dict[str, Any]) -> None:
    pv = conn.execute("select previa from adm_rodadas where id = %s", (rodada_id,)).fetchone()["previa"] or {}
    pv["resultado"] = resultado
    pv["execucoes"] = [*(pv.get("execucoes") or []), resultado]
    conn.execute("update adm_rodadas set status = %s, finalizada_em = now(), previa = %s where id = %s", (status, Jsonb(pv), rodada_id))
    conn.commit()


def _entrada_tentadas(conn: Any, rodada_id: str) -> list[str]:
    return [x["url"] for x in conn.execute("select distinct url from adm_tentativas where rodada_id = %s and entrada order by url", (rodada_id,)).fetchall()]


def _foto(conn: Any, coletor_id: str, recorte: Recorte, elegiveis: Any) -> tuple[PRO.Foto | None, str | None]:
    """Foto de ANTES do coletor (proponentes.fotografar). Falha da foto não impede a rodada: devolve (None, erro) e `_propor` registra o erro."""
    try:
        from . import proponentes as PRO  # import tardio: proponentes -> propostas -> relatorio -> rodadas

        foto = PRO.fotografar(conn, coletor_id, recorte, elegiveis)
        conn.commit()  # só leu; não deixa transação aberta enquanto o coletor roda
        return foto, None
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        return None, f"foto de antes: {type(e).__name__}: {e}"[:500]


def _propor(conn: Any, rid: str, coletor_id: str, antes: PRO.Foto | None, erro_foto: str | None, recorte: Recorte, elegiveis: Any) -> dict[str, Any]:
    """Foto de DEPOIS e propostas (B3a). Roda num savepoint e comita sozinha: o que o coletor já coletou (tentativas, vínculos) JÁ foi comitado antes daqui e
    NUNCA se perde se o proponente falha. Falha = `{"executado": False, "erro": ...}` em `resultado.propostas`, e a rodada termina com o status que teria sem o proponente.
    Rodada `interrompida` também propõe o que já mudou (a repetição completa o resto; `chave_idem` impede duplicar)."""
    if antes is None and erro_foto is None:
        return {"executado": False, "erro": "sem foto de antes"}
    try:
        from . import proponentes as PRO  # import tardio (ver `_foto`)

        if erro_foto is not None:
            raise RuntimeError(erro_foto)
        if coletor_id not in PRO.COLETORES:
            return PRO.propor(conn, rid, coletor_id, antes, antes).para_dict()  # type: ignore[arg-type]
        with conn.transaction():
            depois = PRO.fotografar(conn, coletor_id, recorte, elegiveis)
            res = PRO.propor(conn, rid, coletor_id, antes, depois)  # type: ignore[arg-type]
        conn.commit()
        return res.para_dict()
    except Exception as e:  # noqa: BLE001 - o proponente nunca derruba a rodada
        conn.rollback()
        return {"executado": False, "erro": f"{type(e).__name__}: {e}"[:500]}


NAMESPACE_TRAVA = 0x41434F4C  # "ACOL": primeiro inteiro da trava consultiva de rodada (o segundo é derivado do id; ver `chave_da_trava`)


def chave_da_trava(rodada_id: str) -> tuple[int, int]:
    """Chave da trava consultiva de SESSÃO do executor de uma rodada: `(NAMESPACE_TRAVA, k)`, com `k` = os 4 primeiros bytes de sha256("admin.rodada:<uuid>") como inteiro de 32 bits
    COM sinal. A forma de dois `int4` de `pg_try_advisory_lock` tem espaço de chaves próprio, distinto da forma de um `bigint` (`hashtext(dataset)` em `db.run`): não colide com a trava
    dos jobs. Colisão entre duas rodadas (2^-32) só pode errar para o lado seguro: `executar` recusa e `recuperar` se recusa a agir, nunca o contrário."""
    k = int.from_bytes(hashlib.sha256(f"admin.rodada:{rodada_id}".encode()).digest()[:4], "big", signed=True)
    return NAMESPACE_TRAVA, k


def _tomar_trava(conn: Any, rodada_id: str) -> bool:
    a, b = chave_da_trava(rodada_id)
    return bool(conn.execute("select pg_try_advisory_lock(%s::int, %s::int) as ok", (a, b)).fetchone()["ok"])


def _soltar_trava(conn: Any, rodada_id: str) -> None:
    """Solta a trava da sessão de `conn`. Nunca levanta: se a conexão morreu, a trava já se foi com a sessão."""
    a, b = chave_da_trava(rodada_id)
    try:
        conn.rollback()
        conn.execute("select pg_advisory_unlock(%s::int, %s::int)", (a, b))
        conn.commit()
    except Exception:  # noqa: BLE001
        pass


def _interromper(conn: Any, rid: str, resultado: dict[str, Any], e: BaseException) -> dict[str, Any] | None:
    """Leva a rodada de `em_andamento` a `interrompida` depois de uma exceção, gravando o motivo no resultado. Só toca na rodada que ainda está `em_andamento` (se a exceção veio antes de
    o estado ser comitado, ou depois de um desfecho final, não há o que fazer). Devolve o resultado, ou None se não há o que gravar (a rodada não está `em_andamento`) ou não foi possível gravar (conexão
    morta): quem chama relança a exceção original e a rodada, se ficou `em_andamento`, sai de lá por `rodada recuperar`."""
    try:
        with contextlib.suppress(Exception):
            conn.rollback()
        atual = conn.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()
        if atual is None or atual["status"] != "em_andamento":
            return None  # nada a gravar (a exceção veio antes de `em_andamento` ser comitado): quem chama relança, e a exceção aparece
        erro = f"{type(e).__name__}: {e}"[:500]
        resultado.update(status="interrompida", motivo=REGRA_DESFECHO["excecao"], fim=datetime.now(timezone.utc).isoformat(), erro_execucao=erro)
        if not resultado.get("interrupcao"):
            resultado["interrupcao"] = erro
        _finalizar(conn, rid, "interrompida", resultado)
        return {"rodada_id": rid, **resultado}
    except Exception:  # noqa: BLE001
        with contextlib.suppress(Exception):
            conn.rollback()
        return None


def executar(conn: Any, rodada_id: str, *, runner: Callable[[list[str]], int] | None = None, env_extra: dict[str, str] | None = None) -> dict[str, Any]:
    """Executa a rodada (`aberta` ou `interrompida`). Comita: `em_andamento` antes do coletor e o estado final depois. Devolve o resultado
    (também gravado em `adm_rodadas.previa.resultado`), com `rodada_id` e `status`.

    O que é garantido (critério 5):
      - antes de a rodada ir a `em_andamento` o executor toma a trava consultiva de SESSÃO da rodada (`chave_da_trava`; `pg_try_advisory_lock`) na própria conexão `conn`, que fica
        aberta até o fim, e só a solta DEPOIS do estado final comitado. Trava já tomada = outro executor vivo: `ErroAdmin`, nada muda. `rodada recuperar` usa a trava para saber se o
        executor está vivo.
      - tudo o que vem depois de `em_andamento` roda sob `try/except BaseException`: qualquer exceção (a do runner, do registro, do proponente, KeyboardInterrupt, SystemExit) leva a
        rodada a `interrompida` com o motivo em `resultado` (`interrupcao`, `erro_execucao`). Exceção comum (`Exception`) é devolvida como resultado `interrompida`; KeyboardInterrupt e
        SystemExit são relançados depois de gravar. KeyboardInterrupt/SystemExit DO COLETOR (dentro do runner) continuam absorvidos: o que ele já leu é importado e a rodada fica retomável.
      - NÃO é garantido: `kill -9`, queda da máquina ou da conexão. Nesses casos a rodada fica `em_andamento` e a trava some com a sessão; `civico-etl admin rodada recuperar ID` a
        move para `interrompida` (só se a trava está livre), e `repetir` funciona como para qualquer rodada interrompida."""
    rod = _carregar(conn, rodada_id, travar=True)
    rid = str(rod["id"])
    if rod["status"] not in ("aberta", "interrompida"):
        conn.rollback()
        raise ErroAdmin(f"rodada {rid} está {rod['status']}: só `aberta` ou `interrompida` se executa (use `rodada repetir`)")
    c = _coletor(rod["coletor"])
    r = recorte_de_json(rod["recorte"])
    pv = rod["previa"] or {}
    n_exec = len(pv.get("execucoes") or []) + 1
    inicio = datetime.now(timezone.utc)
    invocation = f"admin:{rid}"
    resultado: dict[str, Any] = {"execucao": n_exec, "inicio": inicio.isoformat(), "invocation": invocation, "regra": REGRA_DESFECHO,
                                "simulado": os.environ.get("ADMIN_SIMULADO") or None}
    if not _tomar_trava(conn, rid):
        conn.rollback()
        raise ErroAdmin(f"a rodada está sendo executada por outro processo (rodada {rid}, trava consultiva tomada): nada foi alterado")
    try:
        conn.execute("update adm_rodadas set status = 'em_andamento', invocation = %s, finalizada_em = null where id = %s", (invocation, rid))
        conn.commit()
        return _executar_apos_inicio(conn, rid, rod, c, r, pv, n_exec, inicio, invocation, resultado, runner, env_extra)
    except BaseException as e:  # noqa: BLE001 - qualquer coisa depois de em_andamento leva a `interrompida` (ver o docstring)
        saida = _interromper(conn, rid, resultado, e)
        if saida is None or not isinstance(e, Exception):
            raise
        return saida
    finally:
        _soltar_trava(conn, rid)


def _executar_apos_inicio(conn: Any, rid: str, rod: dict[str, Any], c: Any, r: Recorte, pv: dict[str, Any], n_exec: int, inicio: datetime, invocation: str, resultado: dict[str, Any],
                          runner: Callable[[list[str]], int] | None, env_extra: dict[str, str] | None) -> dict[str, Any]:
    """O corpo de `executar` depois de a rodada estar `em_andamento` e com a trava tomada."""
    urls = _urls_da_previa(pv)
    firmes = [i["url"] for i in pv.get("urls_entrada", []) if not i["condicional"]]
    cache_dir = rod["cache_dir"] or str(H.CACHE_DIR)
    pasta = Path(cache_dir).parent / "admin-rodadas"
    forcar = list(rod["forcar_urls"] or [])

    def encerrar(status: str, regra: str, **mais: Any) -> dict[str, Any]:
        resultado.update(status=status, motivo=REGRA_DESFECHO[regra], fim=datetime.now(timezone.utc).isoformat(), **mais)
        _finalizar(conn, rid, status, resultado)
        return {"rodada_id": rid, **resultado}

    descricao = contrato.descrever(rod["coletor"], r)
    if descricao.nao_suportado:
        return encerrar("falhou", "nao_suportado", codigo_saida=None, executou_coletor=False, nao_suportado=descricao.nao_suportado)
    if r.modo == "reprocessar":
        faltam = [u for u in firmes if estado_cache(u, cache_dir, 0)["estado"] != "em_cache"]
        if faltam:
            return encerrar("falhou", "reprocessar_sem_cache", codigo_saida=None, executou_coletor=False, faltam_no_cache=faltam)

    pasta.mkdir(parents=True, exist_ok=True)
    log = pasta / f"{rid}-{n_exec}.jsonl"
    env: dict[str, str] = dict(env_extra or {})
    env.update(ETL_ATTEMPT_LOG=str(log), ETL_INVOCATION=invocation, ETL_HTTP_OFFLINE="1" if r.modo == "reprocessar" else "", ETL_HTTP_REFETCH="")
    if forcar:
        refetch = pasta / f"{rid}-{n_exec}.refetch"
        refetch.write_text("\n".join(forcar) + "\n", encoding="utf-8")
        env["ETL_HTTP_REFETCH"] = str(refetch)
    antes, erro_foto = _foto(conn, rod["coletor"], r, pv.get("registros_elegiveis"))  # estado dos registros ANTES do coletor (B3a)
    run, tipo_runner = _runner(runner, env, cache_dir)
    resultado["runner"] = tipo_runner
    codigo: int | None = None
    interrupcao: str | None = None
    try:
        codigo = contrato.executar(rod["coletor"], r, runner=run)
    except BaseException as e:  # noqa: BLE001 - KeyboardInterrupt, SystemExit e exceção do runner: o que já foi lido é importado e a rodada fica retomável
        interrupcao = f"{type(e).__name__}: {e}"[:500]
    resultado.update(codigo_saida=codigo, interrupcao=interrupcao, executou_coletor=True)

    try:
        resumo: T.Resumo | None = None
        if c.tentativas_registradas:
            resumo = T.Resumo()
            for arq in sorted(pasta.glob(f"{rid}-*.jsonl")):
                x = T.importar(conn, rid, arq, urls_entrada=urls)
                if arq == log:
                    resumo = x
        robots = _registrar_robots(conn, rid, rod["coletor"], urls, inicio) if c.tentativas_registradas else []
        vres = V.sincronizar(conn)
        tentadas = _entrada_tentadas(conn, rid) if c.tentativas_registradas else []
        semcache = _semcache(log) if r.modo == "reprocessar" else []
        status, regra = _decidir(codigo, interrupcao, semcache, None if resumo is None else resumo.lidas + resumo.reaproveitadas)
        conn.commit()
    except Exception as e:  # noqa: BLE001 - o registro falhou: a rodada não pode ficar em_andamento
        conn.rollback()
        return encerrar("interrompida", "excecao", erro_registro=f"{type(e).__name__}: {e}"[:500])
    propostas = _propor(conn, rid, rod["coletor"], antes, erro_foto, r, pv.get("registros_elegiveis"))
    return encerrar(
        status, regra, propostas=propostas,
        # registro do `fetch` + bloqueios por robots (que o `fetch` não vê): `tentadas` e `falhas` somam os dois
        tentativas=({"registradas": True, "tentadas": resumo.tentadas + len(robots), "lidas": resumo.lidas, "reaproveitadas": resumo.reaproveitadas,
                     "falhas": {**resumo.falhas, **({"robots": len(robots)} if robots else {})},
                     "urls_distintas": resumo.urls_distintas + len(set(robots) - set(_urls_do_log(log))), "linhas_ignoradas": resumo.linhas_ignoradas} if resumo is not None
                    else {"registradas": False, "motivo": SEM_TENTATIVAS}),
        urls_entrada={"previstas": len(firmes), "tentadas": tentadas, "n_tentadas": len(tentadas),
                      "firmes_nao_tentadas": [u for u in firmes if u not in tentadas],
                      "condicionais_tentadas": [u for u in tentadas if u not in firmes]} if c.tentativas_registradas else {"previstas": len(firmes), "tentadas": None, "motivo": SEM_TENTATIVAS},
        robots_registrados=robots, sem_cache=semcache, vinculos=vres.para_dict())


# ---------------------------------------------------------------- recuperar


def recuperar(conn: Any, rodada_id: Any, *, agora: datetime | None = None) -> dict[str, Any]:
    """`admin rodada recuperar ID`: tira de `em_andamento` uma rodada cujo executor morreu (`kill -9`, queda). Só age com as DUAS condições: a rodada está `em_andamento` E a trava
    consultiva de sessão dela (`chave_da_trava`) está livre, o que `pg_try_advisory_lock` prova tomando-a e soltando-a na hora (ninguém a segura = ninguém está executando).
    Então: importa o log de tentativas das execuções (os arquivos `<rodada>-<n>.jsonl`, se existirem; o importador é idempotente), grava a rodada como `interrompida` com o motivo
    "executor ausente (recuperada em <data>)" e comita. A rodada fica retomável por `repetir`, como qualquer interrompida.
    Recusas (`ErroAdmin`, a CLI devolve código 1, nada muda): rodada em outro estado (a mensagem diz qual) ou trava tomada ("a rodada está sendo executada por outro processo").
    Importante: a trava é de SESSÃO. Chamar `recuperar` na MESMA conexão que está executando a rodada não a vê tomada (a trava é reentrante na sessão); o subcomando abre a própria conexão."""
    rod = _carregar(conn, rodada_id, travar=True)
    rid = str(rod["id"])
    if rod["status"] != "em_andamento":
        conn.rollback()
        raise ErroAdmin(f"rodada {rid} está {rod['status']}: só `em_andamento` se recupera")
    if not _tomar_trava(conn, rid):
        conn.rollback()
        raise ErroAdmin(f"a rodada está sendo executada por outro processo (rodada {rid}, trava consultiva tomada): nada foi alterado")
    try:
        c = _coletor(rod["coletor"])
        pv = rod["previa"] or {}
        quando = (agora or datetime.now(timezone.utc)).astimezone(timezone.utc)
        n_exec = len(pv.get("execucoes") or []) + 1
        motivo = f"executor ausente (recuperada em {quando:%Y-%m-%d %H:%M}Z)"
        importados: list[str] = []
        if c.tentativas_registradas:
            pasta = Path(rod["cache_dir"] or str(H.CACHE_DIR)).parent / "admin-rodadas"
            for arq in sorted(pasta.glob(f"{rid}-*.jsonl")):
                T.importar(conn, rid, arq, urls_entrada=_urls_da_previa(pv))
                importados.append(arq.name)
        resultado: dict[str, Any] = {"execucao": n_exec, "invocation": rod["invocation"], "regra": REGRA_DESFECHO, "status": "interrompida", "motivo": motivo, "recuperada": True,
                                     "logs_importados": importados, "codigo_saida": None, "executou_coletor": None, "fim": quando.isoformat()}
        _finalizar(conn, rid, "interrompida", resultado)  # comita
        return {"rodada_id": rid, **resultado}
    except BaseException:
        conn.rollback()
        raise
    finally:
        _soltar_trava(conn, rid)


# ---------------------------------------------------------------- repetir


def _uf_da_url(url: str, bases: dict[str, str]) -> str | None:
    return next((uf for uf, b in bases.items() if url.startswith(b + "/")), None)


def _urls_falhas(conn: Any, rodada_id: str) -> list[str]:
    """URLs de entrada cuja ÚLTIMA tentativa na rodada foi falha (bloqueio por robots inclusive)."""
    rows = conn.execute("select distinct on (url_sha) url, resultado from adm_tentativas where rodada_id = %s and entrada order by url_sha, tentada_em desc", (rodada_id,)).fetchall()
    return sorted(x["url"] for x in rows if x["resultado"] == "falha")


def _recorte_pendencias(conn: Any, rod: dict[str, Any], r: Recorte) -> Recorte | None:
    """Recorte restrito ao que falhou ou ficou pendente na rodada de origem; None = nenhuma pendência."""
    rid = str(rod["id"])
    falhas = _urls_falhas(conn, rid)
    if rod["coletor"] == "sapl.assembleias":
        bases = _ale_sapl_bases()
        alvo = list(dict.fromkeys(r.ufs)) or list(bases)
        ufs = {u for u in (_uf_da_url(f, bases) for f in falhas) if u in alvo}
        for x in conn.execute(
                """select p.uf from adm_pendencias a join sapl_houses h on a.classe = 'vinculo_sapl' and a.registro_chave = h.id::text
                   join places p on p.id = h.place_id and p.kind = 'uf' where a.status = 'aberta' and p.uf = any(%s)
                   union
                   select p.uf from adm_pendencias a join places p on a.classe = 'cobertura' and split_part(a.registro_chave, ':', 1) = p.ibge_code and p.kind = 'uf'
                   where a.status = 'aberta' and p.uf = any(%s)""", (alvo, alvo)).fetchall():
            ufs.add(x["uf"])
        return replace(r, ufs=tuple(u for u in alvo if u in ufs)) if ufs else None
    if rod["coletor"] == "sapl.camaras":
        if not r.ibges:
            raise ErroAdmin("o recorte da rodada de origem não nomeia --ibge (a fila de câmaras é decidida na execução): as pendências não cabem num recorte")
        ibges: set[str] = set()
        for f in falhas:
            q = parse_qs(urlparse(f).query)
            if q.get("municipio") and q.get("uf"):  # página do registro por município (sapl.descobrir)
                row = conn.execute("select ibge_code from places where kind = 'municipio' and uf = %s and name = %s", (q["uf"][0], q["municipio"][0])).fetchone()
            else:  # {base_url}/... de uma casa (sapl.carregar)
                row = conn.execute("select pl.ibge_code from sapl_houses h join places pl on pl.id = h.place_id where pl.kind = 'municipio' and %s like h.base_url || '/%%' limit 1", (f,)).fetchone()
            if row:
                ibges.add(row["ibge_code"])
        for x in conn.execute(
                """select pl.ibge_code from adm_pendencias a join sapl_houses h on a.classe = 'vinculo_sapl' and a.registro_chave = h.id::text
                   join places pl on pl.id = h.place_id and pl.kind = 'municipio' where a.status = 'aberta' and pl.ibge_code = any(%s)
                   union
                   select pl.ibge_code from adm_pendencias a join places pl on a.classe = 'cobertura' and split_part(a.registro_chave, ':', 1) = pl.ibge_code
                   where a.status = 'aberta' and pl.ibge_code = any(%s)""", (list(r.ibges), list(r.ibges))).fetchall():
            ibges.add(x["ibge_code"])
        return replace(r, ibges=tuple(i for i in r.ibges if i in ibges)) if ibges & set(r.ibges) else None
    c = _coletor(rod["coletor"])
    raise ErroAdmin(f"{rod['coletor']}: o coletor não aceita recorte que expresse pendências (recortes aceitos: {', '.join(c.recortes_aceitos) or 'nenhum'})")


def repetir(conn: Any, rodada_id: str, *, so_pendencias: bool = False, forcar_urls: Sequence[str] = (), executar_agora: bool = True,
            runner: Callable[[list[str]], int] | None = None, env_extra: dict[str, str] | None = None) -> dict[str, Any]:
    """Repete a rodada pelo identificador e (por padrão) a executa. Comita.
    - `interrompida`: reexecuta a MESMA linha (mesmo id). `so_pendencias` não se aplica (ela é retomada inteira): `ErroAdmin`.
    - `concluida` ou `falhou`: abre rodada NOVA com os mesmos parâmetros gravados e `repete_id` = a de origem; o histórico fica como está.
      `forcar_urls` NÃO é herdado (é pedido por repetição); a prévia é recalculada.
    - `so_pendencias`: recorte restrito ao que falhou/ficou pendente; nenhuma pendência -> não abre rodada (`rodada_id` nulo, `mensagem`).
    - `forcar_urls`: precisam ser URL de entrada da rodada de origem ou URL de tentativa registrada dela; senão `ErroAdmin`."""
    rod = _carregar(conn, rodada_id)
    rid = str(rod["id"])
    if rod["status"] in ("aberta", "em_andamento"):
        raise ErroAdmin(f"rodada {rid} está {rod['status']}: ainda não terminou" + ("; use `rodada executar`" if rod["status"] == "aberta" else ""))
    forcar = list(dict.fromkeys(forcar_urls))
    permitidas = set(_urls_da_previa(rod["previa"] or {})) | {x["url"] for x in conn.execute("select distinct url from adm_tentativas where rodada_id = %s", (rid,)).fetchall()}
    estranhas = [u for u in forcar if u not in permitidas]
    if estranhas:
        raise ErroAdmin("forçar releitura só vale para URL de entrada da rodada ou tentativa registrada dela; não pertence: " + ", ".join(estranhas))
    if rod["status"] == "interrompida":
        if so_pendencias:
            raise ErroAdmin(f"rodada {rid} está interrompida: ela é retomada inteira na mesma linha; --pendencias vale para rodada concluída ou falhada")
        if forcar:
            conn.execute("update adm_rodadas set forcar_urls = %s where id = %s", (Jsonb(list(dict.fromkeys([*(rod["forcar_urls"] or []), *forcar]))), rid))
        novo = rid
    else:
        r = recorte_de_json(rod["recorte"])
        if so_pendencias:
            r2 = _recorte_pendencias(conn, rod, r)
            if r2 is None:
                conn.rollback()
                return {"rodada_id": None, "repete_id": rid, "status": None, "mensagem": "nenhuma pendência: nenhuma URL de entrada falhou ou foi bloqueada na rodada de origem, e não há pendência aberta nos lugares dela"}
            r = r2
        novo = _abrir(conn, rod["coletor"], r, modo=None, forcar_urls=forcar, so_pendencias=so_pendencias, repete_id=rid, cache_dir=rod["cache_dir"], permitidas=permitidas)
    conn.commit()
    if not executar_agora:
        return {"rodada_id": novo, "repete_id": None if novo == rid else rid, "status": "aberta" if novo != rid else "interrompida"}
    res = executar(conn, novo, runner=runner, env_extra=env_extra)
    return {**res, "repete_id": None if novo == rid else rid}


# ---------------------------------------------------------------- leitura


def descrever_rodada(conn: Any, rodada_id: str) -> dict[str, Any]:
    rod = _carregar(conn, rodada_id)
    rid = str(rod["id"])
    por_res = {x["resultado"]: x["n"] for x in conn.execute("select resultado, count(*) as n from adm_tentativas where rodada_id = %s group by 1", (rid,)).fetchall()}
    por_mot = {x["motivo"]: x["n"] for x in conn.execute("select motivo, count(*) as n from adm_tentativas where rodada_id = %s and motivo is not null group by 1", (rid,)).fetchall()}
    distintas = conn.execute("select count(distinct url_sha) as n from adm_tentativas where rodada_id = %s", (rid,)).fetchone()["n"]
    origem: list[str] = []
    cur = rod["repete_id"]
    while cur is not None and str(cur) not in origem:
        origem.append(str(cur))
        cur = conn.execute("select repete_id from adm_rodadas where id = %s", (cur,)).fetchone()["repete_id"]
    repeticoes = [str(x["id"]) for x in conn.execute(
        "with recursive d as (select id, iniciada_em from adm_rodadas where repete_id = %s union select r.id, r.iniciada_em from adm_rodadas r join d on r.repete_id = d.id) select id from d order by iniciada_em", (rid,)).fetchall()]
    pv = dict(rod["previa"] or {})
    resultado, execucoes = pv.pop("resultado", None), pv.pop("execucoes", [])
    return {"id": rid, "coletor": rod["coletor"], "modo": rod["modo"], "status": rod["status"], "recorte": rod["recorte"], "argv": rod["argv"], "forcar_urls": rod["forcar_urls"] or [],
            "so_pendencias": rod["so_pendencias"], "repete_id": str(rod["repete_id"]) if rod["repete_id"] else None, "invocation": rod["invocation"], "cache_dir": rod["cache_dir"],
            "iniciada_em": rod["iniciada_em"], "finalizada_em": rod["finalizada_em"], "previa": pv, "resultado": resultado, "execucoes": execucoes,
            "tentativas": {"total": sum(por_res.values()), "por_resultado": por_res, "falhas_por_motivo": por_mot, "urls_distintas": distintas},
            "cadeia": {"origem": origem, "repeticoes": repeticoes}}


def listar(conn: Any, coletor_id: str | None = None) -> list[dict[str, Any]]:
    rows = conn.execute(
        """select r.id, r.coletor, r.modo, r.status, r.iniciada_em, r.finalizada_em, r.repete_id, r.invocation,
                  (select count(*) from adm_tentativas t where t.rodada_id = r.id) as tentativas
           from adm_rodadas r where (%s::text is null or r.coletor = %s) order by r.iniciada_em desc, r.id""", (coletor_id, coletor_id)).fetchall()
    return [{**x, "id": str(x["id"]), "repete_id": str(x["repete_id"]) if x["repete_id"] else None} for x in rows]


def texto_resultado(res: dict[str, Any]) -> str:
    if res.get("rodada_id") is None:
        return res.get("mensagem", "")
    pares = [("rodada", res["rodada_id"]), ("status", res["status"]), ("motivo", res["motivo"]), ("código de saída", res.get("codigo_saida") if res.get("codigo_saida") is not None else "desconhecido: o executor morreu antes de registrar o desfecho (rodada recuperada)" if res.get("recuperada") else "desconhecido: o coletor não rodou" if not res.get("executou_coletor") else "desconhecido: interrompido antes de devolver")]
    if res.get("repete_id"):
        pares.append(("repete", res["repete_id"]))
    if res.get("interrupcao"):
        pares.append(("interrupção", res["interrupcao"]))
    if res.get("erro_registro"):
        pares.append(("erro ao registrar", res["erro_registro"]))
    if res.get("erro_execucao"):
        pares.append(("erro na execução", res["erro_execucao"]))
    if res.get("recuperada"):
        pares.append(("logs importados", ", ".join(res.get("logs_importados") or []) or "nenhum arquivo de registro encontrado"))
    if res.get("faltam_no_cache"):
        pares.append(("faltam no cache", ", ".join(res["faltam_no_cache"])))
    if res.get("sem_cache"):
        pares.append(("sem cache (SemRedeSemCache)", ", ".join(res["sem_cache"])))
    t = res.get("tentativas")
    if t is not None:
        pares.append(("tentativas", f"{t['tentadas']} (lidas {t['lidas']}, reaproveitadas {t['reaproveitadas']}, falhas {t['falhas'] or 0}); {t['urls_distintas']} URLs distintas" if t.get("registradas") else t["motivo"]))
    u = res.get("urls_entrada")
    if u is not None:
        pares.append(("URLs de entrada", f"{u['n_tentadas']} tentadas de {u['previstas']} firmes previstas" if u.get("tentadas") is not None else u["motivo"]))
        if u.get("firmes_nao_tentadas"):
            pares.append(("  firmes não tentadas", ", ".join(u["firmes_nao_tentadas"])))
    if res.get("robots_registrados"):
        pares.append(("bloqueadas por robots", ", ".join(res["robots_registrados"])))
    v = res.get("vinculos")
    if v is not None:
        pares.append(("vínculos", f"{sum(v['criados'].values())} criados, {sum(v['desativados'].values())} desativados, {sum(v['mantidos'].values())} mantidos"))
    pr = res.get("propostas")
    if pr is not None:
        if pr.get("erro"):
            pares.append(("propostas", f"não executado: {pr['erro']}"))
        elif pr.get("executado"):
            pares += [("propostas novas", pr["novas"]), ("propostas repetidas", pr["repetidas"]), ("propostas recusadas", len(pr["recusadas"])),
                      ("primeiros preenchimentos", pr["primeiros_preenchimentos"]), ("sem evidência", len(pr["sem_evidencia"])), ("reason sem proposta", len(pr["reason_sem_proposta"])),
                      ("pendências abertas", len(pr["pendencias_abertas"])), ("pendências reabertas", len(pr["pendencias_reabertas"]))]
    return lista_chave_valor(pares)


def texto_rodada(d: dict[str, Any]) -> str:
    pares = [("rodada", d["id"]), ("coletor", d["coletor"]), ("modo", d["modo"]), ("status", d["status"]), ("recorte", _texto_recorte(d["recorte"])), ("argv", " ".join(d["argv"] or [])),
             ("repete", d["repete_id"] or "-"), ("só pendências", "sim" if d["so_pendencias"] else "não"), ("forçar URLs", ", ".join(d["forcar_urls"]) or "-"),
             ("invocation", d["invocation"] or "desconhecido: ainda não executada"), ("cache", d["cache_dir"]), ("iniciada", f"{d['iniciada_em']:%Y-%m-%d %H:%MZ}"),
             ("finalizada", f"{d['finalizada_em']:%Y-%m-%d %H:%MZ}" if d["finalizada_em"] else "desconhecido: não terminou"),
             ("tentativas", f"{d['tentativas']['total']} (por resultado {d['tentativas']['por_resultado'] or 0}; falhas por motivo {d['tentativas']['falhas_por_motivo'] or 0}); {d['tentativas']['urls_distintas']} URLs distintas"),
             ("cadeia: origem", " -> ".join(d["cadeia"]["origem"]) or "-"), ("cadeia: repetições", ", ".join(d["cadeia"]["repeticoes"]) or "-"), ("execuções", len(d["execucoes"]))]
    txt = lista_chave_valor(pares)
    if d["resultado"]:
        txt += "\n\núltima execução:\n" + texto_resultado({"rodada_id": d["id"], **d["resultado"]})
    return txt + "\n\nprévia (congelada na abertura):\n" + texto_previa(d["previa"])


def texto_lista(linhas: list[dict[str, Any]]) -> str:
    return tabela((("id", "RODADA"), ("coletor", "COLETOR"), ("modo", "MODO"), ("status", "STATUS"), ("iniciada_em", "INICIADA"), ("repete_id", "REPETE"), ("tentativas", "TENTATIVAS")),
                  [{**l, "iniciada_em": f"{l['iniciada_em']:%Y-%m-%d %H:%MZ}"} for l in linhas], total=f"{len(linhas)} rodadas")
