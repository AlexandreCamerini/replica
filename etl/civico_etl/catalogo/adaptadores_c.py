"""Adaptadores de contrato do lote C (R9): ibge.places, ibge.populacao, ibge.malhas, governos.indicadores e receita.arrecadacao.

Mesmo formato de `_camara_equipe` (contrato.py). Só leem o catálogo e, quando recebem `conn`, leem `places` (somente leitura). Nenhum
job é importado. Registrados em `contrato.ADAPTADORES` pelo decorador `@adaptador`; a importação deste módulo é feita por quem integra.
"""

from __future__ import annotations

from typing import Any

from .contrato import _NOTA_REPROCESSAR, Plano, Recorte, _juntar, adaptador
from .modelo import Coletor

# ibge_malhas.py:23 e :77: estados/{código} por UF (o {uf} vem de places com kind='uf', ibge_malhas.py:64)
_MALHAS_ESTADO = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima"


def _nota(r: Recorte) -> str:
    return _NOTA_REPROCESSAR if r.modo == "reprocessar" else ""


@adaptador("ibge.places")
def _ibge_places(c: Coletor, r: Recorte, conn: Any, hoje: Any) -> Plano:
    # run_places(conn, force): duas leituras fixas, sem recorte (cli.py:118-120)
    return "ibge.places", ["ibge.places"], c.entradas.urls, False, _juntar(_nota(r)), ""


@adaptador("ibge.populacao")
def _ibge_populacao(c: Coletor, r: Recorte, conn: Any, hoje: Any) -> Plano:
    # run_populacao(conn, force): o ano vem da primeira leitura (ibge_populacao.py:22-23); só o periodos é listável
    obs = _juntar(c.entradas.depende_de, _nota(r))
    return "ibge.populacao", ["ibge.populacao"], c.entradas.urls, True, obs, ""


@adaptador("ibge.malhas")
def _ibge_malhas(c: Coletor, r: Recorte, conn: Any, hoje: Any) -> Plano:
    # run_malhas(conn, force): o país é fixo; as UFs vêm de places (ibge_malhas.py:64, :76). Sem conn, só a do país.
    urls = list(c.entradas.urls)
    partes = [c.entradas.depende_de]
    if conn is not None:
        rows = conn.execute("select ibge_code from places where kind = 'uf' order by ibge_code").fetchall()
        codigos = [str(x["ibge_code"]) for x in rows]
        urls += [_MALHAS_ESTADO.format(uf=uf) for uf in codigos]
        partes.append(f"{len(codigos)} UFs lidas do banco (places kind='uf') para as URLs estados/{{uf}}")
    if r.modo == "reprocessar":  # ibge.malhas abre run sem checksum (ibge_malhas.py:66): nunca pula, sempre regrava os arquivos
        partes.append("reprocessar usa o mesmo argv de recoletar; este coletor não tem checksum de entrada, então sempre regrava os arquivos de malha")
    return "ibge.malhas", ["ibge.malhas"], tuple(urls), True, _juntar(*partes), ""


@adaptador("governos.indicadores")
def _governos_indicadores(c: Coletor, r: Recorte, conn: Any, hoje: Any) -> Plano:
    # run_governos(conn, force): nenhuma URL é listável sem o ano de execução (last_full = ano corrente - 1, governos_indicadores.py:46)
    obs = _juntar(
        c.entradas.depende_de,
        "as URLs dependem do ano de execução: a faixa SIDRA e o laço SGS vão até o ano corrente - 1 (governos_indicadores.py:46)",
        _nota(r),
    )
    return "governos.indicadores", ["governos.indicadores"], (), True, obs, ""


@adaptador("receita.arrecadacao")
def _receita_arrecadacao(c: Coletor, r: Recorte, conn: Any, hoje: Any) -> Plano:
    # run_arrecadacao(conn, force): um CSV fixo, sem recorte (cli.py:246-248)
    return "receita.arrecadacao", ["receita.arrecadacao"], c.entradas.urls, False, _juntar(_nota(r)), ""
