"""`civico-etl admin <subcomando>`: administração de coleta (Parte A do plano; replica/admin-coleta-plano.md, seção 4.1).

Subcomandos nesta entrega: `inventario` e `vinculos`. Os próximos (previa, rodada, relatorio, fila, pendencia, decidir, aplicar, parecer,
candidata, executor) entram em `SUBCOMANDOS` com uma função `configurar` (opções do parser) e uma `executar` (devolve o documento e o texto).

Saída: `--json` imprime UM documento JSON em stdout (aceito antes ou depois do subcomando); sem ele, uma tabela. Diagnóstico vai para stderr.
Códigos: 0 sucesso; 2 erro de uso (argparse) ou subcomando ausente; 1 erro de execução, com a mensagem em stderr e sem traceback.
A conexão vem de `db.connect()` e é fechada no fim. Só `vinculos sincronizar` escreve, e só em `adm_vinculos`.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from typing import Any, Callable

from .. import db
from . import inventario as inv
from . import vinculos as vin
from .saida import ErroAdmin, lista_chave_valor, para_json, tabela

# (documento serializável para --json, texto para a tabela, gravou?) -- `gravou` decide o commit
Resultado = tuple[Any, str, bool]


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


class _Uso(Exception):
    """Combinação de opções inválida: sai com 2, como um erro do argparse."""


SUBCOMANDOS: dict[str, Subcomando] = {s.nome: s for s in (
    Subcomando("inventario", "uma linha por (coletor, fonte): datasets, tarefa, prazos, último run, última tentativa, frescor e estado", _cfg_inventario, _run_inventario),
    Subcomando("vinculos", "de onde vem cada registro e quais registros dependem de uma URL ou fonte", _cfg_vinculos, _run_vinculos),
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
        doc, texto, gravou = SUBCOMANDOS[a.subcomando].executar(conn, a)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
