"""Contrato comum de coletor (R3), atendido por adaptador externo: `descrever` ("descreva seu recorte e suas URLs de entrada") e
`executar` ("execute este recorte").

- `descrever` NUNCA usa rede. Para URL estática devolve as URLs com os padrões expandidos; para dinâmica devolve só as conhecidas sem
  leitura e marca `estimativa=True`. Com `conn`, lê o banco (somente leitura) para concretizar o que o banco já sabe.
- `executar` monta o MESMO argv de `descrever` e o entrega ao `runner`. O runner padrão é `civico_etl.cli.main`: o despacho da CLI, com os
  passos encadeados (identity.dedupe, derive.stats). Nunca chama função `run_*` de job nem importa job.
- Recorte que o comando não aceita hoje vira `nao_suportado` (e `ValueError` em `executar`). Nenhum argumento novo em job.
- Coletor com entrada no catálogo e sem adaptador: `nao_suportado="adaptador ainda não escrito"`.

Importar este módulo não importa nenhum job nem `civico_etl.cli` (o import da CLI é feito dentro do runner padrão).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from types import MappingProxyType
from typing import Any, Callable, Mapping, Sequence
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from .coletores import coletor
from .modelo import MODOS, Coletor

BRT = ZoneInfo("America/Sao_Paulo")  # mesmo fuso de civico_etl.util.BRT, sem importar util

_RE_IBGE = re.compile(r"^\d{7}$")
_CAMPOS_RECORTE = (("anos", "ano"), ("ufs", "uf"), ("casas", "casa"), ("ibges", "ibge"))


# ---------------------------------------------------------------- tipos


def _unicos(valores: Sequence[Any]) -> tuple[Any, ...]:
    return tuple(dict.fromkeys(valores))


@dataclass(frozen=True)
class Recorte:
    """Recorte pedido ao coletor. Campos vazios = sem recorte (o comando usa o padrão dele). `modo`: descobrir, recoletar ou reprocessar."""

    anos: tuple[int, ...] = ()
    ufs: tuple[str, ...] = ()
    casas: tuple[str, ...] = ()
    ibges: tuple[str, ...] = ()
    extras: Mapping[str, str] = field(default_factory=dict)  # argumentos próprios de um coletor (ex.: escopo)
    modo: str = "recoletar"

    def __post_init__(self) -> None:
        anos = _unicos(tuple(self.anos))
        if not all(isinstance(a, int) and not isinstance(a, bool) and 1900 <= a <= 2100 for a in anos):
            raise ValueError(f"Recorte.anos: inteiros entre 1900 e 2100; veio {self.anos!r}")
        ufs = _unicos(tuple(u.upper() if isinstance(u, str) else u for u in self.ufs))
        if not all(isinstance(u, str) and len(u) == 2 and u.isalpha() for u in ufs):
            raise ValueError(f"Recorte.ufs: siglas de 2 letras; veio {self.ufs!r}")
        casas = _unicos(tuple(self.casas))
        if not all(isinstance(c, str) and c.strip() for c in casas):
            raise ValueError(f"Recorte.casas: textos não vazios; veio {self.casas!r}")
        ibges = _unicos(tuple(self.ibges))
        if not all(isinstance(i, str) and _RE_IBGE.match(i) for i in ibges):
            raise ValueError(f"Recorte.ibges: códigos IBGE de 7 dígitos (texto); veio {self.ibges!r}")
        if not isinstance(self.extras, Mapping) or not all(isinstance(k, str) and isinstance(v, str) for k, v in self.extras.items()):
            raise ValueError("Recorte.extras: mapeamento texto -> texto")
        if self.modo not in MODOS:
            raise ValueError(f"Recorte.modo inválido: {self.modo!r}; esperado um de {MODOS}")
        for nome, valor in (("anos", anos), ("ufs", ufs), ("casas", casas), ("ibges", ibges)):
            object.__setattr__(self, nome, valor)
        object.__setattr__(self, "extras", MappingProxyType(dict(self.extras)))


@dataclass(frozen=True)
class Descricao:
    coletor: str
    comando: str  # comando da CLI que a execução usaria ("" se não suportado antes de escolher)
    argv: list[str]  # o que seria passado à CLI (sem o nome do programa)
    urls_entrada: tuple[str, ...]  # URLs concretas, só as listáveis sem rede (com `conn`, as que o banco já concretiza)
    entradas_tipo: str  # "estaticas" | "dinamicas" (do catálogo)
    estimativa: bool  # True: a lista de URLs não é completa nem certa
    observacao: str  # do que a lista depende e o que é desconhecido
    nao_suportado: str  # "" se suportado; senão o motivo


# ---------------------------------------------------------------- expansão de URLs


def _expandir(modelos: Sequence[str], anos: Sequence[int]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(URLs concretas, modelos que continuam com placeholder depois de expandir {ano}). Só {ano} é expandido aqui."""
    concretas: list[str] = []
    pendentes: list[str] = []
    for m in modelos:
        candidatas = [m.replace("{ano}", str(a)) for a in anos] if "{ano}" in m else [m]
        for u in candidatas:
            if "{" in u:
                if m not in pendentes:
                    pendentes.append(m)
            elif u not in concretas:
                concretas.append(u)
    return tuple(concretas), tuple(pendentes)


def _juntar(*partes: str) -> str:
    return " | ".join(p for p in partes if p)


# ---------------------------------------------------------------- adaptadores (um por coletor)

# Resultado de um adaptador: (comando, argv, urls, estimativa, observacao, nao_suportado)
Plano = tuple[str, list[str], tuple[str, ...], bool, str, str]
Adaptador = Callable[[Coletor, Recorte, Any, "date | None"], Plano]
ADAPTADORES: dict[str, Adaptador] = {}

# Explicações do que o argparse aceita e o comando ignora (o catálogo só guarda os nomes em recortes_nao_aceitos).
_EXPLICACOES: dict[tuple[str, str], str] = {
    ("sapl.camaras", "uf"): "--uf é aceito pelo parser do SAPL mas só é lido em sapl.ales (sapl.py:760-761); sapl.descobrir, sapl.carregar e sapl.todas o ignoram",
}

_NOTA_REPROCESSAR = (
    "reprocessar usa o mesmo argv de recoletar: com a mesma entrada o db.run pula por checksum (a CLI não tem modo sem rede; "
    "ETL_HTTP_OFFLINE e --force não são decididos aqui)"
)


def adaptador(coletor_id: str) -> Callable[[Adaptador], Adaptador]:
    def reg(fn: Adaptador) -> Adaptador:
        ADAPTADORES[coletor_id] = fn
        return fn

    return reg


def _anos_flags(anos: Sequence[int]) -> list[str]:
    return [x for a in anos for x in ("--year", str(a))]


@adaptador("camara.equipe")
def _camara_equipe(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # run_equipe(conn, force): lê um arquivo único; nenhum recorte (cli.py:186-189)
    obs = _NOTA_REPROCESSAR if r.modo == "reprocessar" else ""
    return "camara.equipe", ["camara.equipe"], c.entradas.urls, False, obs, ""


@adaptador("camara.noturna")
def _camara_noturna(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # run_camara_noturna(conn, force): days=3; anos = {ano de (hoje - 3 dias), ano de hoje} em Brasília (camara_diario.py:459-463)
    dia = hoje or datetime.now(BRT).date()
    anos = sorted({(dia - timedelta(days=3)).year, dia.year})
    urls, _ = _expandir(c.entradas.urls, anos)
    obs = _juntar(f"anos {anos} derivados da data de execução ({dia}, Brasília) e da janela de 3 dias; outra data de execução muda os anos",
                  _NOTA_REPROCESSAR if r.modo == "reprocessar" else "")
    return "camara.noturna", ["camara.noturna"], urls, False, obs, ""


@adaptador("camara.diario")
def _camara_diario(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:178-181: anos padrão [ano-1, ano] com date.today(); --limit e --no-expenses não são recorte
    dia = hoje or date.today()
    anos = list(r.anos) or [dia.year - 1, dia.year]
    urls, pendentes = _expandir(c.entradas.urls, anos)
    urls = list(urls)
    partes = [
        "" if r.anos else f"anos padrão da CLI ({anos}), pela data {dia}",
        "não expandidas (dependem de leitura): " + ", ".join(pendentes) if pendentes else "",
        c.entradas.depende_de,
    ]
    if conn is not None:
        rows = conn.execute(
            """select distinct e.external_id from person_external_ids e
               join sources s on s.id = e.source_id and s.slug = 'camara'
               join mandates m on m.person_id = e.person_id
               join offices o on o.id = m.office_id and o.slug = 'deputado_federal'
               where m.status in ('em_exercicio', 'licenciado', 'afastado') order by e.external_id""").fetchall()
        ids = [str(x["external_id"]) for x in rows]
        urls += [f"https://dadosabertos.camara.leg.br/api/v2/deputados/{i}" for i in ids]
        partes.append(f"{len(ids)} URLs de detalhe vêm dos deputados com mandato aberto no banco, não da lista atual da API")
    if r.modo == "reprocessar":
        partes.append(_NOTA_REPROCESSAR)
    return "camara.diario", ["camara.diario", *_anos_flags(anos if r.anos else [])], tuple(urls), True, _juntar(*partes), ""


_PAGINA_SAPL = 100  # sapl.py:56 (PAGE)
_REGISTRO_SAPL = "https://www12.senado.leg.br/interlegis/orgaosatendidos"  # sapl.py:69


@adaptador("sapl.camaras")
def _sapl_camaras(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    comando = "sapl.descobrir" if r.modo == "descobrir" else "sapl.carregar"
    escopo = r.extras.get("escopo")
    if escopo is not None and escopo not in ("capitais", "todas"):
        return comando, [], (), False, "", f"escopo inválido: {escopo!r}; o parser aceita capitais ou todas"
    if escopo is not None and r.ibges:
        return comando, [], (), False, "", "escopo é ignorado quando há --ibge (sapl.py:764-766); peça um ou outro"
    argv = [comando]
    if r.ibges:
        argv += [x for i in r.ibges for x in ("--ibge", i)]
    elif escopo is not None:
        argv += ["--escopo", escopo]
    partes: list[str] = []
    urls: tuple[str, ...] = ()
    if not r.ibges:
        partes.append(f"escopo {escopo or 'capitais (padrão da CLI)'}: as câmaras processadas saem do estado em sapl_houses na hora da execução (fila)")
    if r.modo == "descobrir":
        urls = (_REGISTRO_SAPL,)
        partes.append("a descoberta lê uma página do registro por município; {base_url}/api/ só aparece depois de ler o registro")
        if conn is not None and r.ibges:
            rows = conn.execute("select ibge_code, name, uf from places where kind = 'municipio' and ibge_code = any(%s)", (list(r.ibges),)).fetchall()
            achados = {x["ibge_code"]: x for x in rows}
            urls = tuple(f"{_REGISTRO_SAPL}?{urlencode({'uf': achados[i]['uf'], 'municipio': achados[i]['name']}, quote_via=quote)}" for i in r.ibges if i in achados)
            ausentes = [i for i in r.ibges if i not in achados]
            partes.append(f"IBGE fora de places (rejeitado pela descoberta): {ausentes}" if ausentes else "")
    else:
        if r.ibges and len(r.ibges) > 10:
            partes.append(f"{len(r.ibges)} códigos IBGE: sem --lote/--max, sapl.carregar processa no máximo 10 câmaras 'ok' (sapl.py:746, :758, :782)")
        if conn is not None and r.ibges:
            rows = conn.execute(
                "select pl.ibge_code, h.base_url, h.status from sapl_houses h join places pl on pl.id = h.place_id "
                "where pl.kind = 'municipio' and pl.ibge_code = any(%s)", (list(r.ibges),)).fetchall()
            casas = {x["ibge_code"]: x for x in rows}
            ok = [i for i in r.ibges if casas.get(i, {}).get("status") == "ok"]
            urls = tuple(f"{casas[i]['base_url']}/api/parlamentares/legislatura/?{urlencode({'page_size': _PAGINA_SAPL, 'page': 1})}" for i in ok)
            fora = [i for i in r.ibges if i not in ok]
            if fora:
                partes.append(f"sem casa 'ok' em sapl_houses (não serão carregadas; rode a descoberta antes): {fora}")
            partes.append("só a 1ª página de cada casa; matérias, autorias, sessões, presenças e votos dependem das respostas")
        else:
            partes.append("as URLs da carga dependem de sapl_houses.base_url (preenchida pela descoberta): sem banco e sem --ibge, nenhuma é listável")
    if r.modo == "reprocessar":  # inatingível enquanto o catálogo disser que não suporta; mantido por consistência
        partes.append(_NOTA_REPROCESSAR)
    return comando, argv, urls, True, _juntar(*partes), ""


# ---------------------------------------------------------------- descrever e executar


def _nao_suportado(c: Coletor, r: Recorte) -> str:
    """Motivo pelo qual o catálogo recusa o recorte/modo, ou ''."""
    modo = c.modos[r.modo]
    if not modo.suporta:
        return f"modo {r.modo!r} não suportado por {c.id}: {modo.motivo}"
    problemas: list[str] = []
    for campo, nome in _CAMPOS_RECORTE:
        if getattr(r, campo) and nome not in c.recortes_aceitos:
            problemas.append(_EXPLICACOES.get((c.id, nome)) or f"recorte {nome!r} ({campo}) não aceito")
    for chave in r.extras:
        if chave not in c.recortes_aceitos:
            problemas.append(_EXPLICACOES.get((c.id, chave)) or f"recorte extra {chave!r} não aceito")
    if problemas:
        return f"{c.id}: " + "; ".join(problemas) + f" (aceitos: {', '.join(c.recortes_aceitos) or 'nenhum'})"
    return ""


def descrever(coletor_id: str, recorte: Recorte | None = None, *, conn: Any = None, hoje: date | None = None) -> Descricao:
    """Descreve o recorte e as URLs de entrada. Sem rede. `conn` (opcional) só lê. `hoje` fixa a data para o que depende dela (teste)."""
    r = recorte or Recorte()
    c = coletor(coletor_id)  # KeyError se o id não tem entrada no catálogo
    base = dict(coletor=c.id, entradas_tipo=c.entradas.tipo)
    adapt = ADAPTADORES.get(c.id)
    if adapt is None:
        return Descricao(comando="", argv=[], urls_entrada=(), estimativa=False, observacao="", nao_suportado="adaptador ainda não escrito", **base)
    motivo = _nao_suportado(c, r)
    if motivo:
        return Descricao(comando="", argv=[], urls_entrada=(), estimativa=False, observacao="", nao_suportado=motivo, **base)
    comando, argv, urls, estimativa, obs, recusa = adapt(c, r, conn, hoje)
    return Descricao(comando=comando, argv=argv, urls_entrada=urls, estimativa=estimativa, observacao=obs, nao_suportado=recusa, **base)


def _runner_em_processo(argv: list[str]) -> int:
    """`civico_etl.cli.main` (o despacho da CLI, com os passos encadeados). SystemExit vira código de saída, como no processo."""
    from civico_etl.cli import main  # dentro da função: importar o catálogo não importa a CLI

    try:
        return int(main(argv))
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)


def executar(coletor_id: str, recorte: Recorte | None = None, *, runner: Callable[[list[str]], int] | None = None) -> int:
    """Executa o recorte pelo despacho da CLI. `ValueError` se `descrever` marca o recorte como não suportado."""
    d = descrever(coletor_id, recorte)
    if d.nao_suportado:
        raise ValueError(f"recorte não suportado por {coletor_id}: {d.nao_suportado}")
    return int((runner or _runner_em_processo)(list(d.argv)))


def runner_subprocesso(argv: list[str], *, env: Mapping[str, str] | None = None, timeout_s: float | None = None) -> int:
    """Roda `python -m civico_etl.cli <argv>` (o mesmo que schedule._run_cli) e devolve o código de saída; 124 se estourar `timeout_s`.
    `env` é somado ao ambiente atual."""
    ambiente = {**os.environ, **env} if env else None
    try:
        return subprocess.run([sys.executable, "-m", "civico_etl.cli", *argv], env=ambiente, timeout=timeout_s, check=False).returncode
    except subprocess.TimeoutExpired:
        return 124
