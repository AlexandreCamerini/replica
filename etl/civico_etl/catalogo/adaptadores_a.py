"""Adaptadores do contrato (R3) para o lote A (R8a): tse.candidatos, tse.votos, tse.contas, sancoes.tcu, sancoes.cgu, transparencia.emendas,
ale.custom e sapl.assembleias.

Mesma regra de `contrato.py`: `descrever` nunca usa rede; o argv é exatamente o que a CLI aceita hoje para o recorte; nada de `--force`,
`--no-derive`, `--all` nem `--votes` por conta própria (o argv da tarefa agendada é assunto de schedule.py). Só biblioteca padrão e o
próprio pacote `catalogo`: nenhum `civico_etl.jobs.*` nem `civico_etl.cli`.

Importar este módulo registra os oito adaptadores em `contrato.ADAPTADORES`. `catalogo/__init__.py` importa este módulo
e soma `EXPLICACOES_A` a `contrato._EXPLICACOES`.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from .contrato import _NOTA_REPROCESSAR, Plano, Recorte, _anos_flags, _expandir, _juntar, adaptador
from .coletores_a import _ALE_SAPL
from .modelo import Coletor

# Padrões da CLI quando não há --year (cli.py:135, :140, :144; ale_cli.py:31; transparencia_emendas.py:30, :222)
_ANOS_ELEICAO = (2018, 2020, 2022, 2024, 2026)
_ANOS_VOTOS_CONTAS = (2022, 2024, 2026)
_PRIMEIRO_ANO_ALE = 2019
_PRIMEIRO_ANO_EMENDAS = 2023
_ANO_VERBA_ALMG = 2023  # ale_cli.py:45: verba indenizatória da ALMG só de 2023 em diante
_PAGINA_SAPL = 100  # sapl.py:58 (PAGE)
_HOST_ALESP = "https://www.al.sp.gov.br/"
_ALE_COMANDO = {"SP": "ale.sp", "MG": "ale.mg"}  # ale_cli.py:20 (ADAPTERS = ("sp", "mg"))

# Explicações do que o parser aceita e o comando ignora (para `contrato._EXPLICACOES`, na integração). Chave: (id do coletor, recorte).
EXPLICACOES_A: dict[tuple[str, str], str] = {
    ("tse.votos", "uf"): "--uf é aceito pelo parser principal mas só é lido em tse.candidatos (cli.py:136); tse.votos o ignora (cli.py:140)",
    ("tse.contas", "uf"): "--uf é aceito pelo parser principal mas só é lido em tse.candidatos (cli.py:136); tse.contas o ignora (cli.py:144)",
    ("sapl.assembleias", "ibge"): "--ibge é aceito pelo parser do SAPL, mas em sapl.ales o escopo vem só de --uf (sapl.py:761) e --ibge não escolhe câmaras: com ele, a fila de carga deixa de ser a de load_queue e passa a ser todas as câmaras 'ok' do escopo, na ordem do escopo e cortadas por --lote/--max (sapl.py:781-782), o que ignora a idade mínima de recarga (STALE_DAYS, sapl.py:62) e o backoff (retry_after, sapl.py:257)",
}


def _reprocessar(r: Recorte) -> str:
    return _NOTA_REPROCESSAR if r.modo == "reprocessar" else ""


def _anos_padrao(anos_cli: tuple[int, ...], hoje: date) -> list[int]:
    return [y for y in anos_cli if y <= hoje.year]


# ---------------------------------------------------------------- tse


@adaptador("tse.candidatos")
def _tse_candidatos(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # run_tse(conn, years, ufs, only_elected=not --all, with_votes=--votes, force): cli.py:133-136
    dia = hoje or date.today()
    padrao = _anos_padrao(_ANOS_ELEICAO, dia)
    anos = list(r.anos) or padrao
    argv = ["tse.candidatos", *_anos_flags(r.anos), *[x for u in r.ufs for x in ("--uf", u)]]
    # a 3ª entrada (votação) só é lida com --votes, que não é recorte nem é acrescentado aqui
    urls, _ = _expandir([u for u in c.entradas.urls if "votacao_candidato_munzona" not in u], anos)
    obs = _juntar(
        "" if r.anos else f"anos padrão da CLI ({padrao}), pela data {dia}",
        "sem --all: só eleitos e quem foi ao 2º turno (padrão da CLI); a tarefa agendada passa --all",
        "sem --votes: o zip de votação não é lido (com --votes entraria votacao_candidato_munzona_{ano}.zip e o dataset tse.votos.{ano})",
        "--uf só escolhe os CSVs por UF dentro do zip nacional: o zip é baixado inteiro" if r.ufs else "",
        "ano ainda não publicado pelo TSE: consulta_cand 404 vira aviso e o ano é pulado; bem_candidato 404 só tira os bens (tse_candidatos.py:204-212)",
        _reprocessar(r),
    )
    return "tse.candidatos", argv, urls, False, obs, ""


def _tse_zip(c: Coletor, r: Recorte, hoje: date | None, comando: str, onde: str) -> Plano:
    dia = hoje or date.today()
    padrao = _anos_padrao(_ANOS_VOTOS_CONTAS, dia)
    anos = list(r.anos) or padrao
    urls, _ = _expandir(c.entradas.urls, anos)
    obs = _juntar(
        "" if r.anos else f"anos padrão da CLI ({padrao}), pela data {dia}",
        f"o zip é lido por HTTP Range (HEAD e GETs parciais na mesma URL), só os CSVs de {onde}; não é baixado inteiro",
        "ano ainda não publicado pelo TSE: 404 vira aviso e o ano é pulado",
        _reprocessar(r),
    )
    return comando, [comando, *_anos_flags(r.anos)], urls, False, obs, ""


@adaptador("tse.votos")
def _tse_votos(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    return _tse_zip(c, r, hoje, "tse.votos", "votação (votacao_candidato_munzona_{ano}_BRASIL.csv ou os de UF)")


@adaptador("tse.contas")
def _tse_contas(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    return _tse_zip(c, r, hoje, "tse.contas", "receitas e despesas pagas (receitas_candidatos_{ano} e despesas_pagas_candidatos_{ano})")


# ---------------------------------------------------------------- sancoes


@adaptador("sancoes.tcu")
def _sancoes_tcu(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # main(["sancoes.tcu"]) -> run_tcu(conn, force): nenhum recorte (sancoes.py:297-326)
    obs = _juntar(c.entradas.depende_de, "só a 1ª página e o robots.txt são listáveis sem ler", _reprocessar(r))
    return "sancoes.tcu", ["sancoes.tcu"], c.entradas.urls, True, obs, ""


@adaptador("sancoes.cgu")
def _sancoes_cgu(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # main(["sancoes.cgu"]) -> run_cgu(conn, key, force): CEIS e CNEP inteiros (sancoes.py:297-326)
    obs = _juntar(
        f"exige {c.env}: sem a chave o comando sai com 2 antes de abrir o banco (sancoes.py:306-309); este adaptador não lê a chave",
        "só a 1ª página de cada endpoint é listável sem ler; " + c.entradas.depende_de,
    )
    return "sancoes.cgu", ["sancoes.cgu"], c.entradas.urls, True, obs, ""


# ---------------------------------------------------------------- transparencia


@adaptador("transparencia.emendas")
def _transparencia_emendas(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # run_emendas(conn, years=--year ou None, key, force): padrão FIRST_YEAR até o ano corrente (transparencia_emendas.py:222)
    dia = hoje or date.today()
    padrao = list(range(_PRIMEIRO_ANO_EMENDAS, dia.year + 1))
    anos = list(r.anos) or padrao
    urls, _ = _expandir(c.entradas.urls, anos)
    obs = _juntar(
        "" if r.anos else f"anos padrão da CLI ({padrao[0]} a {padrao[-1]}), pela data {dia}",
        f"exige {c.env}: sem a chave o comando sai com 2 antes de abrir o banco (transparencia.py:169-171); este adaptador não lê a chave",
        "só a 1ª página de cada ano é listável sem ler; " + c.entradas.depende_de,
        f"o job documenta emendas de {_PRIMEIRO_ANO_EMENDAS} em diante; ano anterior seria enviado à API sem validação" if any(y < _PRIMEIRO_ANO_EMENDAS for y in anos) else "",
        _reprocessar(r),
    )
    return "transparencia.emendas", ["transparencia.emendas", *_anos_flags(r.anos)], urls, True, obs, ""


# ---------------------------------------------------------------- ale.custom


@adaptador("ale.custom")
def _ale_custom(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # ale_cli.main: o comando escolhe a UF (ale.sp, ale.mg, ale.todas); --year padrão 2019 até hoje (ale_cli.py:31-32)
    dia = hoje or date.today()
    ufs = tuple(dict.fromkeys(r.ufs))
    fora = [u for u in ufs if u not in _ALE_COMANDO]
    if fora:
        return "", [], (), False, "", f"UF {', '.join(fora)} sem coletor de Assembleia: ale.* só tem SP e MG (ale_cli.py:20)"
    # SP e MG juntas = as duas casas = ale.todas (mesma execução)
    comando = "ale.todas" if set(ufs) in (set(), set(_ALE_COMANDO)) else _ALE_COMANDO[ufs[0]]
    padrao = list(range(_PRIMEIRO_ANO_ALE, dia.year + 1))
    anos = sorted(set(r.anos)) or padrao
    com_sp = comando in ("ale.sp", "ale.todas")
    com_mg = comando in ("ale.mg", "ale.todas")
    modelos = [u for u in c.entradas.urls if (u.startswith(_HOST_ALESP) and com_sp) or (not u.startswith(_HOST_ALESP) and com_mg)]
    urls, _ = _expandir(modelos, anos)
    obs = _juntar(
        "" if r.anos else f"anos padrão da CLI ({padrao[0]} a {padrao[-1]}), pela data {dia}",
        "ale.todas roda ALESP e depois ALMG, uma de cada vez; erro na ALESP interrompe a ALMG (ale_cli.py:36-45, sem try)" if comando == "ale.todas" else "",
        "ALESP: lista completa (arquivos, verba de cada ano e robots.txt)" if comando == "ale.sp" else "",
        f"ALMG: só as 5 listas de deputados e o total de proposições por tipo e ano são listáveis; {c.entradas.depende_de}" if com_mg else "",
        f"ALMG: verba indenizatória só para anos >= {_ANO_VERBA_ALMG} (ale_cli.py:45)" if com_mg else "",
        "roda derive.stats no fim (a CLI faz, salvo --no-derive, que não é acrescentado aqui)",
        _reprocessar(r),
    )
    return comando, [comando, *_anos_flags(r.anos)], urls, com_mg, obs, ""


# ---------------------------------------------------------------- sapl.assembleias


def _ale_sapl_bases() -> dict[str, str]:
    """UF -> base do SAPL (cópia de sapl.ALE_SAPL em coletores_a, conferida por teste)."""
    return dict(_ALE_SAPL)


@adaptador("sapl.assembleias")
def _sapl_assembleias(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # main(["sapl.ales", --uf ...]): scope = --uf ou todas de ALE_SAPL (sapl.py:761); discover_ales e depois a carga (:762, :778)
    bases = _ale_sapl_bases()
    ufs = tuple(dict.fromkeys(r.ufs))
    fora = [u for u in ufs if u not in bases]
    if fora:
        return ("sapl.ales", [], (), False, "",
                f"UF {', '.join(fora)} fora de ALE_SAPL (sapl.py:80-86): o parser aceita e discover_ales rejeita com nota, sem carga; "
                f"as UFs cobertas são {', '.join(bases)}")
    alvo = ufs or tuple(bases)
    argv = ["sapl.ales", *[x for u in ufs for x in ("--uf", u)]]
    urls = tuple(u for u in c.entradas.urls if any(u.startswith(bases[uf] + "/") for uf in alvo))
    partes = [
        "" if ufs else f"sem --uf: todas as UFs de ALE_SAPL ({', '.join(bases)})",
        "sempre sonda {base}/api/ e robots.txt antes de carregar (discover_ales), na mesma execução",
        "a carga passa por load_queue: casa 'ok' carregada há menos de 6 dias (STALE_DAYS) ou em backoff fica fora da fila; --uf não garante recarga",
        "sem --lote, o limite de casas carregadas é --max (10), maior que as 5 UFs",
        "sapl.py não roda derive.stats",
    ]
    if conn is not None:
        rows = conn.execute(
            "select pl.uf, h.status from sapl_houses h join places pl on pl.id = h.place_id where pl.kind = 'uf' and pl.uf = any(%s)", (list(alvo),)).fetchall()
        status = {x["uf"]: x["status"] for x in rows}
        ok = [uf for uf in alvo if status.get(uf) == "ok"]
        urls += tuple(f"{bases[uf]}/api/parlamentares/legislatura/?page_size={_PAGINA_SAPL}&page=1" for uf in ok)
        partes.append("status no banco (a sondagem da execução o refaz): " + ", ".join(f"{uf}={status.get(uf, 'sem registro')}" for uf in alvo))
        partes.append("só a 1ª página de legislaturas de cada casa 'ok'; o resto depende das respostas")
    else:
        partes.append("as URLs da carga dependem do estado de sapl_houses e das respostas: sem banco, só a sondagem é listável")
    partes.append(_reprocessar(r))
    return "sapl.ales", argv, urls, True, _juntar(*partes), ""
