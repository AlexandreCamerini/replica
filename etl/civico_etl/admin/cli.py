"""`civico-etl admin <subcomando>`: administração de coleta (Parte A do plano; replica/admin-coleta-plano.md, seção 4.1).

Subcomandos nesta entrega: `inventario`, `vinculos`, `previa`, `rodada` (abrir, executar, repetir, ver, listar), `relatorio` e, da Parte B, `proposta registrar`,
`fila` e `pendencia` (detalhe e `reavaliar`; `proposta registrar` e `pendencia reavaliar` gravam só em `adm_propostas`, `adm_pendencias` e `adm_pendencia_propostas`),
`decidir` (grava `adm_decisoes`; só decisão de PESSOA, a de agentes não tem opção de linha de comando) e `aplicar` (escreve nas tabelas de domínio, em `adm_overrides`, `adm_vinculos` e `corrections`). Os próximos (parecer, candidata, executor) entram em `SUBCOMANDOS` com uma função `configurar` (opções do parser) e uma `executar` (devolve o documento e o texto).

Saída: `--json` imprime UM documento JSON em stdout (aceito antes ou depois do subcomando); sem ele, uma tabela. Diagnóstico vai para stderr.
Códigos: 0 sucesso; 2 erro de uso (argparse) ou subcomando ausente; 1 erro de execução, com a mensagem em stderr e sem traceback. Um subcomando pode
devolver um 4º elemento com o código (previa de recorte não suportado; rodada que termina `falhou` ou `interrompida`): o documento é impresso e a saída é esse código.
A conexão vem de `db.connect()` e é fechada no fim. Escrevem: `vinculos sincronizar` (só `adm_vinculos`) e `rodada` (`adm_rodadas`, `adm_tentativas`,
`adm_evidencias`, `adm_vinculos`; `rodada` comita sozinho nos pontos em que o coletor precisa ver o estado gravado).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
from dataclasses import dataclass
from typing import Any, Callable

import psycopg

from .. import db
from ..catalogo.contrato import Recorte
from . import aplicar as apl
from . import decisoes as dec
from . import inventario as inv
from . import pendencias as pen
from . import proponentes as pro
from . import propostas as prop
from . import relatorio as rel
from . import rodadas as rod
from . import vinculos as vin
from .saida import ErroAdmin, lista_chave_valor, para_json, tabela

# (documento serializável para --json, texto para a tabela, gravou?) -- `gravou` decide o commit; 4º elemento opcional: código de saída (padrão 0)
Resultado = tuple[Any, str, bool] | tuple[Any, str, bool, int]


@dataclass(frozen=True)
class Subcomando:
    nome: str
    ajuda: str
    configurar: Callable[[argparse.ArgumentParser], None]
    executar: Callable[[Any, argparse.Namespace], Resultado]


# ------------------------------------------------------------------ inventario


def _cfg_inventario(p: argparse.ArgumentParser) -> None:
    p.add_argument("--coletor", metavar="ID", help="só este coletor (id do catálogo)")
    p.add_argument("--fonte", metavar="SLUG", help="só esta fonte (slug)")


def _run_inventario(conn: Any, a: argparse.Namespace) -> Resultado:
    linhas = inv.filtrar(inv.inventario(conn), coletor=a.coletor, fonte=a.fonte)
    return linhas, tabela(inv.COLUNAS, inv.linhas_da_tabela(linhas), formatos=inv.FORMATOS, total=inv.total(linhas)), False


# ------------------------------------------------------------------ vinculos


def _cfg_vinculos(p: argparse.ArgumentParser) -> None:
    p.add_argument("acao", nargs="?", choices=["sincronizar"], help="sincronizar: materializa em adm_vinculos o que as tabelas já contêm (idempotente)")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--url", help="registros que dependem desta URL")
    g.add_argument("--fonte", metavar="SLUG", help="registros ligados a esta fonte")
    g.add_argument("--registro", metavar="CLASSE:CHAVE", help="de quais fontes, URLs e runs vem o registro (classes: " + ", ".join(vin.CLASSES) + ")")


COLUNAS_VINCULOS = (("classe", "CLASSE"), ("registro_chave", "CHAVE"), ("rotulo", "REGISTRO"), ("fonte_slug", "FONTE"), ("origem", "ORIGEM"), ("vigente", "VIGENTE"),
                    ("desde", "DESDE"), ("url", "URL"), ("evidencia", "EVIDÊNCIA"), ("ultima_tentativa", "ÚLTIMA TENTATIVA"))
FORMATOS_VINCULOS = {
    "evidencia": lambda e: f"{e['conteudo_sha256'][:12]} {e['lida_em']:%Y-%m-%d %H:%MZ}",
    "ultima_tentativa": lambda t: f"{t['resultado']}{'/' + t['motivo'] if t['motivo'] else ''} {t['tentada_em']:%Y-%m-%d %H:%MZ}",
    "desde": lambda d: f"{d:%Y-%m-%d %H:%MZ}",
}


def _tabela_vinculos(conn: Any, linhas: list[dict[str, Any]]) -> str:
    vig, tot = vin.contagem(conn)
    n_vig = sum(1 for l in linhas if l["vigente"])
    return tabela(COLUNAS_VINCULOS, linhas, formatos=FORMATOS_VINCULOS, total=f"{len(linhas)} vínculos listados ({n_vig} vigentes); {vig} vigentes de {tot} em adm_vinculos")


def _texto_runs(r: dict[str, Any]) -> str:
    out = [f"determinação: {r['determinacao']}"]
    if r["determinacao"] == "nao_determinavel":
        out.append(r["motivo"])
        out += [f"  candidato: {c.get('coletor')} {c.get('dataset', '')}".rstrip() for c in r["candidatos"]]
    for d in r["datasets"]:
        out.append(f"dataset {d['dataset']}" + (f"  ({d['observacao']})" if d["observacao"] else ""))
        c = d["ultimo_carimbo_do_dataset"]
        out.append("  último carimbo do dataset: " + (f"{c['refreshed_at']:%Y-%m-%d %H:%MZ} (run {c['last_run_id'] or 'desconhecido: carimbo sem run'})" if c else "desconhecido: nenhum carimbo"))
        out += [f"  run {x['id']}  {x['iniciado_em']:%Y-%m-%d %H:%MZ}  {x['status']}  fonte {x['fonte']}  lidas {x['linhas_lidas'] if x['linhas_lidas'] is not None else 'desconhecido'}  gravadas {x['linhas_gravadas']}" for x in d["ultimos_runs"]]
        if not d["ultimos_runs"]:
            out.append("  desconhecido: nenhum run deste dataset em ingest_runs")
    out.append("run exato do registro: " + (r["run_exato"] if r["run_exato"] else f"desconhecido: {r['run_exato_motivo']}"))
    return "\n".join(out)


def _run_vinculos(conn: Any, a: argparse.Namespace) -> Resultado:
    escolhas = [x for x in (a.acao, a.url, a.fonte, a.registro) if x]
    if len(escolhas) != 1:
        raise _Uso("vinculos: informe exatamente um entre `sincronizar`, --url, --fonte e --registro")
    if a.acao == "sincronizar":
        r = vin.sincronizar(conn)
        linhas = [{"classe": c, "criados": r.criados[c], "desativados": r.desativados[c], "mantidos": r.mantidos[c]} for c in vin.CLASSES]
        txt = tabela((("classe", "CLASSE"), ("criados", "CRIADOS"), ("desativados", "DESATIVADOS"), ("mantidos", "MANTIDOS")), linhas,
                     total=f"{sum(r.criados.values())} criados, {sum(r.desativados.values())} desativados, {sum(r.mantidos.values())} mantidos; {r.manuais_preservados} manuais preservados; "
                           f"{sum(i['n'] for i in r.ignorados)} registros ignorados")
        if r.ignorados:
            txt += "\nignorados:\n" + "\n".join(f"  {i['classe']}: {i['n']} x {i['motivo']}" for i in r.ignorados)
        return r.para_dict(), txt, True
    if a.url:
        doc = vin.por_url(conn, a.url)
        return doc, _tabela_vinculos(conn, doc["vinculos"]), False
    if a.fonte:
        doc = vin.por_fonte(conn, a.fonte)
        return doc, _tabela_vinculos(conn, doc["vinculos"]), False
    classe, sep, chave = a.registro.partition(":")
    if not sep:
        raise ErroAdmin(f"--registro espera CLASSE:CHAVE (veio {a.registro!r})")
    doc = vin.do_registro(conn, classe, chave)
    cab = lista_chave_valor([("registro", f"{classe}:{chave}"), ("rótulo", doc["rotulo"]), ("fontes", ", ".join(doc["fontes"]) or "desconhecido: nenhum vínculo com fonte_slug")])
    cadeias = "\n".join("troca: " + " -> ".join(c) for c in doc["cadeias_de_troca"] if len(c) > 1)
    partes = [cab, "", _tabela_vinculos(conn, doc["vinculos"])] + ([cadeias] if cadeias else []) + ["", "runs:", _texto_runs(doc["runs"])]
    return doc, "\n".join(partes), False


# ------------------------------------------------------------------ previa e rodada


def _cfg_recorte(p: argparse.ArgumentParser) -> None:
    p.add_argument("--modo", choices=["descobrir", "recoletar", "reprocessar"], default="recoletar", help="descobrir fontes, recoletar conhecidas ou reprocessar sem rede (padrão: recoletar)")
    p.add_argument("--ano", type=int, action="append", metavar="N", help="ano (repetível)")
    p.add_argument("--uf", action="append", metavar="UF", help="UF (repetível)")
    p.add_argument("--casa", action="append", metavar="X", help="casa legislativa (repetível)")
    p.add_argument("--ibge", action="append", metavar="COD", help="código IBGE de 7 dígitos (repetível)")
    p.add_argument("--extra", action="append", metavar="CHAVE=VALOR", help="argumento próprio do coletor, ex.: escopo=capitais (repetível)")


def _recorte(a: argparse.Namespace) -> Recorte:
    extras: dict[str, str] = {}
    for x in a.extra or []:
        k, sep, v = x.partition("=")
        if not sep or not k:
            raise _Uso(f"--extra espera CHAVE=VALOR (veio {x!r})")
        extras[k] = v
    try:
        return Recorte(anos=tuple(a.ano or ()), ufs=tuple(a.uf or ()), casas=tuple(a.casa or ()), ibges=tuple(a.ibge or ()), extras=extras, modo=a.modo)
    except ValueError as e:
        raise _Uso(str(e)) from None


def _cfg_previa(p: argparse.ArgumentParser) -> None:
    p.add_argument("--coletor", metavar="ID", required=True, help="id do coletor no catálogo (veja `admin inventario`)")
    _cfg_recorte(p)


def _run_previa(conn: Any, a: argparse.Namespace) -> Resultado:
    p = rod.previa(conn, a.coletor, _recorte(a))
    return p, rod.texto_previa(p), False, 1 if p["nao_suportado"] else 0


@contextlib.contextmanager
def _stdout_em_stderr(ativo: bool):
    """Com --json o stdout é só o documento: o que o coletor imprimir (em processo ou em subprocesso) vai para stderr."""
    if not ativo:
        yield
        return
    sys.stdout.flush()
    salvo = None
    try:
        salvo = os.dup(1)
        os.dup2(2, 1)
    except OSError:
        salvo = None
    try:
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        if salvo is not None:
            sys.stdout.flush()
            os.dup2(salvo, 1)
            os.close(salvo)


def _cfg_rodada(p: argparse.ArgumentParser) -> None:
    p.add_argument("acao", choices=["abrir", "executar", "repetir", "ver", "listar"], help="abrir: grava a rodada (com --executar, também a executa); executar ID; repetir ID; ver ID; listar")
    p.add_argument("id", nargs="?", help="identificador da rodada (executar, repetir, ver)")
    p.add_argument("--coletor", metavar="ID", help="abrir: coletor do catálogo (obrigatório); listar: só este coletor")
    _cfg_recorte(p)
    p.add_argument("--forcar-url", action="append", metavar="URL", help="abrir/repetir: ignora o cache desta URL (só URL de entrada da rodada ou tentativa registrada dela; repetível)")
    p.add_argument("--executar", action="store_true", help="abrir: executa em seguida")
    p.add_argument("--pendencias", action="store_true", help="repetir: só o que falhou ou ficou pendente na rodada de origem")


def _codigo(res: dict[str, Any]) -> int:
    return 0 if res.get("status") in ("concluida", None) else 1


def _run_rodada(conn: Any, a: argparse.Namespace) -> Resultado:
    if a.acao in ("executar", "repetir", "ver") and not a.id:
        raise _Uso(f"rodada {a.acao}: informe o identificador da rodada")
    if a.acao in ("abrir", "listar") and a.id:
        raise _Uso(f"rodada {a.acao}: não leva identificador")
    if a.acao != "abrir" and (a.executar or a.forcar_url and a.acao != "repetir"):
        raise _Uso("--executar só vale em `rodada abrir`; --forcar-url só em `abrir` e `repetir`")
    if a.acao != "repetir" and a.pendencias:
        raise _Uso("--pendencias só vale em `rodada repetir`")
    if a.acao == "abrir":
        if not a.coletor:
            raise _Uso("rodada abrir: --coletor é obrigatório")
        rid = rod.abrir(conn, a.coletor, _recorte(a), forcar_urls=a.forcar_url or ())
        conn.commit()
        if not a.executar:
            return {"rodada_id": rid}, rid, False
        with _stdout_em_stderr(a.json):
            res = rod.executar(conn, rid)
        return res, rod.texto_resultado(res), False, _codigo(res)
    if a.acao == "executar":
        with _stdout_em_stderr(a.json):
            res = rod.executar(conn, a.id)
        return res, rod.texto_resultado(res), False, _codigo(res)
    if a.acao == "repetir":
        with _stdout_em_stderr(a.json):
            res = rod.repetir(conn, a.id, so_pendencias=a.pendencias, forcar_urls=a.forcar_url or ())
        return res, rod.texto_resultado(res), False, _codigo(res)
    if a.acao == "ver":
        d = rod.descrever_rodada(conn, a.id)
        return d, rod.texto_rodada(d), False
    linhas = rod.listar(conn, a.coletor)
    return linhas, rod.texto_lista(linhas), False


def _cfg_relatorio(p: argparse.ArgumentParser) -> None:
    p.add_argument("id", help="identificador da rodada")
    p.add_argument("--ids", action="store_true", help="tabela: lista todos os identificadores de cada total (padrão: até 20 e \"e mais N\"); o JSON sempre traz a lista inteira")


def _run_relatorio(conn: Any, a: argparse.Namespace) -> Resultado:
    doc = rel.relatorio(conn, a.id)
    return doc, rel.texto_relatorio(doc, ids=a.ids), False


# ------------------------------------------------------------------ proposta, fila e pendencia (Parte B)


def _cfg_proposta(p: argparse.ArgumentParser) -> None:
    p.add_argument("acao", choices=["registrar"], help="registrar: grava as propostas do arquivo e abre ou reabre as pendências (recusa a que vem sem URL, trecho ou hash)")
    p.add_argument("--arquivo", required=True, metavar="ARQ.json", help="um objeto ou uma lista de objetos com os campos de Proposta (classe, registro_chave, campo, valor_candidato, url, trecho, conteudo_sha256, lida_em, ...)")


def _ler_propostas(caminho: str) -> list[Any]:
    try:
        with open(caminho, encoding="utf-8") as f:
            doc = json.load(f)
    except OSError as e:
        raise ErroAdmin(f"não foi possível ler {caminho}: {e.strerror or e}") from None
    except ValueError as e:
        raise ErroAdmin(f"{caminho} não é JSON válido: {e}") from None
    if isinstance(doc, dict):
        return [doc]
    if isinstance(doc, list):
        return doc
    raise ErroAdmin(f"{caminho}: esperado um objeto ou uma lista de objetos")


def _run_proposta(conn: Any, a: argparse.Namespace) -> Resultado:
    itens = _ler_propostas(a.arquivo)
    cache: dict[str, Any] = {}
    res: list[dict[str, Any]] = []
    for i, d in enumerate(itens, 1):
        base = {"indice": i, "registro": f"{d.get('classe')}:{d.get('registro_chave')}:{d.get('campo')}" if isinstance(d, dict) else None}
        try:
            p = prop.Proposta.de_dict(d)
            with conn.transaction():  # savepoint: um erro de banco numa proposta não derruba as outras
                r = prop.registrar(conn, p, cache_recorte=cache)
            res.append({**base, "resultado": "nova" if r.nova else "repetida", "motivo": None, **r.para_dict()})
        except prop.PropostaRecusada as e:
            res.append({**base, "resultado": "recusada", "motivo": str(e)})
        except psycopg.Error as e:
            res.append({**base, "resultado": "erro", "motivo": f"erro de banco: {e}"})
    tot = {k: sum(1 for r in res if r["resultado"] == k) for k in ("nova", "repetida", "recusada", "erro")}
    falhas = tot["recusada"] + tot["erro"]
    aviso = (f"{falhas} proposta(s) não entraram; as {tot['nova']} aceitas FORAM gravadas mesmo assim (uma recusa não desfaz as outras)" if falhas and tot["nova"] else None)
    doc = {"arquivo": a.arquivo, "totais": tot, "resultados": res, "aviso": aviso}
    linhas = [{**r, "pendencia": (f"{r['pendencia']['acao']} {r['pendencia']['tipo'] or ''}".strip() if r["resultado"] in ("nova", "repetida") else None),
               "motivo": r["motivo"] or ("campo confirmado pela fonte (sem pendência)" if r.get("confirmada_pela_fonte") else None)} for r in res]
    txt = tabela((("indice", "#"), ("resultado", "RESULTADO"), ("registro", "REGISTRO:CAMPO"), ("pendencia", "PENDÊNCIA"), ("motivo", "MOTIVO")), linhas,
                 total=f"{tot['nova']} novas, {tot['repetida']} repetidas, {tot['recusada']} recusadas, {tot['erro']} com erro de banco de {len(res)}" + (f"\n{aviso}" if aviso else ""))
    return doc, txt, tot["nova"] > 0, 1 if falhas else 0


def _cfg_fila(p: argparse.ArgumentParser) -> None:
    p.add_argument("--classe", choices=list(vin.CLASSES), help="só esta classe de campo")
    p.add_argument("--limite", type=int, metavar="N", help="só as N primeiras da fila")


def _run_fila(conn: Any, a: argparse.Namespace) -> Resultado:
    if a.limite is not None and a.limite < 1:
        raise _Uso("--limite espera um inteiro maior que zero")
    itens = pen.fila(conn, classe=a.classe, limite=a.limite)
    return itens, pen.texto_fila(itens), False


def _cfg_pendencia(p: argparse.ArgumentParser) -> None:
    p.add_argument("alvo", metavar="ID|reavaliar", help="identificador da pendência (detalhe) ou `reavaliar` (reabre as decididas cujo valor vigente mudou no banco)")
    p.add_argument("--classe", choices=list(vin.CLASSES), help="reavaliar: só esta classe")


def _run_pendencia(conn: Any, a: argparse.Namespace) -> Resultado:
    if a.alvo != "reavaliar":
        if a.classe:
            raise _Uso("--classe só vale em `pendencia reavaliar`")
        d = pen.detalhe(conn, a.alvo)
        return d, pen.texto_detalhe(d), False
    reabertas = prop.reavaliar(conn, classe=a.classe)
    txt = tabela((("id", "PENDÊNCIA"), ("classe", "CLASSE"), ("registro_chave", "REGISTRO"), ("campo", "CAMPO"), ("tipo", "TIPO")), reabertas,
                 total=f"{len(reabertas)} pendências reabertas (registro_mudou)")
    return {"reabertas": reabertas, "total": len(reabertas)}, txt, bool(reabertas)


# ------------------------------------------------------------------ decidir e aplicar (Parte B, B2)


def _cfg_decidir(p: argparse.ArgumentParser) -> None:
    p.add_argument("id", metavar="PENDENCIA", help="identificador da pendência (veja `admin fila`)")
    p.add_argument("--acao", required=True, choices=list(dec.ACOES), help="aprovar (o candidato único), corrigir (--valor), descartar ou pedir_confirmacao")
    p.add_argument("--por", required=True, metavar="NOME", help="nome de quem decide (decisão de pessoa)")
    p.add_argument("--justificativa", required=True, metavar="TEXTO", help="por que (obrigatória)")
    p.add_argument("--valor", metavar="JSON", help='corrigir: o valor, em JSON (texto entre aspas; em contato, {"remover": true}); aprovar de duplicata: {"unir": {"de": "ID", "para": "ID"}}')
    p.add_argument("--aplicar", action="store_true", help="aprovar/corrigir: aplica em seguida (tudo ou nada: se a aplicação falhar, a decisão também não fica registrada)")


def _texto_aplicacao(r: dict[str, Any]) -> str:
    esc = "; ".join(f"{t}: {v}" for t, v in r["escreveu"].items()) or "nenhuma tabela"
    c = r["corrections"]
    corr = f"corrections {c['id']}" if c["gravou"] else f"sem corrections ({c['motivo']})"
    return "\n".join(filter(None, [f"aplicada: {r['classe']}:{r['registro_chave']}:{r['campo']}  {fmt_v(r['valor_anterior'])} -> {fmt_v(r['valor_novo'])}", f"escreveu: {esc}", corr,
                                  f"observação: {r['observacao']}" if r["observacao"] else None]))


def fmt_v(v: Any) -> str:
    return "sem valor" if v is None else repr(v)


def _run_decidir(conn: Any, a: argparse.Namespace) -> Resultado:
    valor = None
    if a.valor is not None:
        try:
            valor = json.loads(a.valor)
        except ValueError as e:
            raise _Uso(f"--valor não é JSON válido: {e}") from None
    if a.aplicar and a.acao not in dec.ACOES_QUE_APLICAM:
        raise _Uso(f"--aplicar não vale com {a.acao}: só aprovar e corrigir aplicam")
    d = dec.decidir(conn, a.id, acao=a.acao, por_tipo="pessoa", por_nome=a.por, justificativa=a.justificativa, valor=valor)
    doc: dict[str, Any] = {"decisao": {k: d[k] for k in ("id", "pendencia_id", "acao", "decidido_por_tipo", "decidido_por_nome", "justificativa", "campos_afetados", "valor", "aplicada", "criada_em")},
                           "aplicacao": None}
    estado = "pendência continua aberta (confirmação pedida)" if a.acao == "pedir_confirmacao" else "pendência decidida"
    txt = lista_chave_valor([("decisão", str(d["id"])), ("pendência", str(d["pendencia_id"])), ("ação", d["acao"]), ("por", d["decidido_por_nome"]), ("campos afetados", ", ".join(d["campos_afetados"])),
                             ("valor", fmt_v(d["valor"])), ("efeito", estado), ("aplicada", "não (use `admin aplicar`)" if a.acao in dec.ACOES_QUE_APLICAM and not a.aplicar else "não se aplica" if a.acao not in dec.ACOES_QUE_APLICAM else "sim")])
    if a.aplicar:
        r = apl.aplicar(conn, d["id"])
        doc["aplicacao"] = r
        doc["decisao"]["aplicada"] = True
        txt += "\n" + _texto_aplicacao(r)
    return doc, txt, True


def _cfg_aplicar(p: argparse.ArgumentParser) -> None:
    p.add_argument("--decisao", metavar="ID", help="só esta decisão (padrão: todas as não aplicadas de aprovar e corrigir, em ordem de criação)")


def _run_aplicar(conn: Any, a: argparse.Namespace) -> Resultado:
    itens = apl.aplicar_pendentes(conn, decisao_id=a.decisao)
    if a.decisao and not itens:
        d = conn.execute("select acao, aplicada from adm_decisoes where id::text = %s", (a.decisao,)).fetchone()
        raise ErroAdmin(f"decisão inexistente: {a.decisao}" if d is None else f"a decisão {a.decisao} é {d['acao']} e {'já foi aplicada' if d['aplicada'] else 'não se aplica a tabela nenhuma'}")
    linhas = [{"decisao": i["decisao_id"], "estado": i["estado"], "alvo": (f"{i['resultado']['classe']}:{i['resultado']['registro_chave']}:{i['resultado']['campo']}" if i["resultado"] else None),
               "detalhe": (i["resultado"]["observacao"] or "") if i["resultado"] else i["erro"]} for i in itens]
    ap = sum(1 for i in itens if i["estado"] == "aplicada")
    ruins = len(itens) - ap
    txt = tabela((("decisao", "DECISÃO"), ("estado", "ESTADO"), ("alvo", "REGISTRO:CAMPO"), ("detalhe", "OBSERVAÇÃO / ERRO")), linhas, total=f"{ap} aplicadas, {ruins} não aplicadas de {len(itens)}")
    return {"decisoes": itens, "totais": {"aplicadas": ap, "nao_aplicadas": ruins}}, txt, ap > 0, 1 if ruins else 0


# ------------------------------------------------------------------ identidade (B3b): o executor da fila de identidade


def _cfg_identidade(p: argparse.ArgumentParser) -> None:
    p.add_argument("acao", choices=["propor"], help="propor: leva à revisão os itens pendentes de identity_match_queue que têm pessoa candidata (grava só em adm_propostas e adm_pendencias)")
    p.add_argument("--limite", type=int, metavar="N", help="só os N itens pendentes mais antigos")


def _run_identidade(conn: Any, a: argparse.Namespace) -> Resultado:
    if a.limite is not None and a.limite < 1:
        raise _Uso("--limite espera um inteiro maior que zero")
    r = pro.propor_identidade(conn, limite=a.limite)
    d = r.para_dict()
    txt = lista_chave_valor([("novas", len(r.novas)), ("repetidas", r.repetidas), ("sem candidato", len(r.identidade_sem_candidato)), ("sem evidência", len(r.sem_evidencia)),
                             ("recusadas", len(r.recusadas)), ("pendências abertas", len(r.pendencias_abertas)), ("pendências reabertas", len(r.pendencias_reabertas)),
                             ("duplicatas abertas", r.duplicatas["abertas"]), ("pares na regra de duplicata (não abertos)", r.duplicatas["pares_na_regra_existente"])])
    return d, txt, True, 1 if r.recusadas else 0


class _Uso(Exception):
    """Combinação de opções inválida: sai com 2, como um erro do argparse."""


SUBCOMANDOS: dict[str, Subcomando] = {s.nome: s for s in (
    Subcomando("inventario", "uma linha por (coletor, fonte): datasets, tarefa, prazos, último run, última tentativa, frescor e estado", _cfg_inventario, _run_inventario),
    Subcomando("vinculos", "de onde vem cada registro e quais registros dependem de uma URL ou fonte", _cfg_vinculos, _run_vinculos),
    Subcomando("previa", "recorte, registros elegíveis, URLs de entrada e quantas serão consultadas, sem rede (estimativas marcadas)", _cfg_previa, _run_previa),
    Subcomando("rodada", "abrir, executar, repetir, ver e listar rodadas de coleta (identificador, parâmetros gravados, repetível)", _cfg_rodada, _run_rodada),
    Subcomando("relatorio", "relatório de uma rodada: estado da coleta e estado da revisão (painéis separados), com denominador e identificadores", _cfg_relatorio, _run_relatorio),
    Subcomando("proposta", "registrar propostas de mudança de um arquivo JSON (recusa o que vem sem URL, trecho ou hash; abre ou reabre pendência)", _cfg_proposta, _run_proposta),
    Subcomando("fila", "pendências abertas na ordem da fila: classe, tipo, vencimento, cobertura do recorte (nunca por pessoa ou partido)", _cfg_fila, _run_fila),
    Subcomando("pendencia", "detalhe de uma pendência (ID) ou `reavaliar` as decididas cujo valor vigente mudou", _cfg_pendencia, _run_pendencia),
    Subcomando("decidir", "registra a decisão de uma pessoa sobre uma pendência (aprovar, corrigir, descartar, pedir_confirmacao); --aplicar aplica em seguida", _cfg_decidir, _run_decidir),
    Subcomando("identidade", "leva à revisão os itens pendentes da fila de identidade que têm pessoa candidata (`identidade propor`); a decisão e a aplicação são `decidir` e `aplicar`", _cfg_identidade, _run_identidade),
    Subcomando("aplicar", "aplica às tabelas de domínio as decisões aprovadas e ainda não aplicadas (agentes só com as duas chaves ligadas)", _cfg_aplicar, _run_aplicar),
)}


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="civico-etl admin", description="Administração de coleta: leitura do inventário e dos vínculos.")
    p.add_argument("--json", action="store_true", help="saída em um documento JSON (aceito também depois do subcomando)")
    sub = p.add_subparsers(dest="subcomando", metavar="SUBCOMANDO")
    for s in SUBCOMANDOS.values():
        sp = sub.add_parser(s.nome, help=s.ajuda, description=s.ajuda)
        sp.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="saída em um documento JSON")
        s.configurar(sp)
    return p


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    p = _parser()
    try:
        a = p.parse_args(argv)
    except SystemExit as e:  # argparse: 2 em erro de uso, 0 em --help
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 2)
    if not a.subcomando:
        p.print_help(sys.stderr)
        return 2
    import psycopg

    try:
        conn = db.connect()
    except SystemExit as e:  # db.connect sem variável de ambiente
        print(e.code, file=sys.stderr)
        return 1
    except psycopg.Error as e:
        print(f"erro: sem conexão com o banco: {e}", file=sys.stderr)
        return 1
    try:
        res = SUBCOMANDOS[a.subcomando].executar(conn, a)
        doc, texto, gravou = res[:3]
        codigo = res[3] if len(res) > 3 else 0
        if gravou:
            conn.commit()
        else:
            conn.rollback()
    except _Uso as e:
        conn.rollback()
        print(f"civico-etl admin: erro: {e}", file=sys.stderr)
        return 2
    except ErroAdmin as e:
        conn.rollback()
        print(f"erro: {e}", file=sys.stderr)
        return 1
    except psycopg.Error as e:
        conn.rollback()
        print(f"erro de banco: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()
    print(para_json(doc) if a.json else texto)
    return codigo


if __name__ == "__main__":
    sys.exit(main())
