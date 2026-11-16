"""R8a: lote A do catálogo de coletores (tse.candidatos, tse.votos, tse.contas, sancoes.tcu, sancoes.cgu, transparencia.emendas, ale.custom,
sapl.assembleias) e os adaptadores do contrato. Sem banco (dublê de conexão), sem rede, sem skip.

O lote ainda não está ligado em `catalogo.COLETORES`/`ADAPTADORES`: os adaptadores são chamados direto (`_plano`), com a recusa do catálogo
(`contrato._nao_suportado`) aplicada antes, como faz `contrato.descrever`.
"""

from __future__ import annotations

import ast
import json
import re
import socket
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from civico_etl import http as H
from civico_etl import schedule as S
from civico_etl.catalogo import COLETORES, COLETORES_PENDENTES, ARQUIVOS, Classe, Coletor, Recorte, comando
from civico_etl.catalogo import adaptadores_a, coletores, coletores_a, contrato
from civico_etl.catalogo.adaptadores_a import EXPLICACOES_A
from civico_etl.catalogo.coletores_a import COLETORES_A
from civico_etl.catalogo.modelo import ACESSOS, MODOS

ETL = Path(__file__).resolve().parents[1]
PKG = ETL / "civico_etl"
REPO = ETL.parent
TESTS = ETL / "tests"
HOJE = date(2026, 11, 15)

IDS = ("tse.candidatos", "tse.votos", "tse.contas", "sancoes.tcu", "sancoes.cgu", "transparencia.emendas", "ale.custom", "sapl.assembleias")
POR_ID = {c.id: c for c in COLETORES_A}
COMANDOS = {
    "tse.candidatos": ("tse.candidatos",), "tse.votos": ("tse.votos",), "tse.contas": ("tse.contas",), "sancoes.tcu": ("sancoes.tcu",),
    "sancoes.cgu": ("sancoes.cgu",), "transparencia.emendas": ("transparencia.emendas",), "ale.custom": ("ale.sp", "ale.mg", "ale.todas"),
    "sapl.assembleias": ("sapl.ales",),
}
TAREFAS = {
    "tse.candidatos": ("tse.candidatos.recentes",), "tse.votos": ("tse.votos",), "tse.contas": ("tse.contas",), "sancoes.tcu": ("sancoes.tcu",),
    "sancoes.cgu": ("sancoes.cgu",), "transparencia.emendas": ("transparencia.emendas",), "ale.custom": ("ale.todas",), "sapl.assembleias": ("sapl.ales",),
}


# ---------------------------------------------------------------- utilitários


def _fonte(arquivo: str) -> str:
    return (PKG / arquivo).read_text(encoding="utf-8")


def _constante(arquivo: str, nome: str):
    """Valor literal de uma constante de módulo, por AST (sem importar o job: sapl.py e assembleias.py alteram http.RATE no import)."""
    for n in ast.parse(_fonte(arquivo)).body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            return ast.literal_eval(n.value)
    raise AssertionError(f"{nome} não encontrado em {arquivo}")


def _funcao(arquivo: str, nome: str) -> str:
    src = _fonte(arquivo)
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, ast.FunctionDef) and n.name == nome:
            return ast.get_source_segment(src, n) or ""
    raise AssertionError(f"{nome} não encontrada em {arquivo}")


def _flags(arquivo: str) -> set[str]:
    out: set[str] = set()
    for n in ast.walk(ast.parse(_fonte(arquivo))):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_argument":
            for a in n.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and a.value.startswith("--"):
                    out.add(a.value)
    return out


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class ConnFalsa:
    """Dublê de conexão só de leitura: devolve as linhas da primeira chave que aparece no SQL; recusa o que não for select."""

    def __init__(self, respostas: dict[str, list[dict]]):
        self.respostas, self.sqls = respostas, []

    def execute(self, sql, params=None):
        self.sqls.append(" ".join(sql.split()))
        assert sql.lstrip().lower().startswith("select"), f"escrita no banco: {sql[:80]}"
        for chave, rows in self.respostas.items():
            if chave in sql:
                return _Res(rows)
        raise AssertionError(f"consulta inesperada: {sql[:120]}")


def _plano(cid: str, recorte: Recorte | None = None, conn=None, hoje: date | None = HOJE):
    """O que `contrato.descrever` faria para o lote: recusa do catálogo, depois o adaptador. Devolve (comando, argv, urls, estimativa, obs, recusa)."""
    r = recorte or Recorte()
    c = POR_ID[cid]
    motivo = contrato._nao_suportado(c, r)
    if motivo:
        return "", [], (), False, "", motivo
    return contrato.ADAPTADORES[cid](c, r, conn, hoje)


# ---------------------------------------------------------------- entradas passam na validação e apontam de volta


def test_oito_entradas_validas_sem_colisao_com_o_que_ja_esta_ligado():
    assert tuple(c.id for c in COLETORES_A) == IDS
    assert all(isinstance(c, Coletor) for c in COLETORES_A)  # a validação do modelo roda no __post_init__
    assert not set(IDS) & COLETORES_PENDENTES  # integrado: nada do lote continua pendente
    # integrado: cada id do lote está em COLETORES exatamente uma vez, e é o mesmo objeto de COLETORES_A
    assert [c.id for c in COLETORES].count("camara.equipe") == 1
    for c in COLETORES_A:
        assert [x for x in COLETORES if x.id == c.id] == [c]
    resto = [c for c in COLETORES if c not in COLETORES_A]
    assert not {c.id for c in resto} & set(IDS)
    assert not {n for c in COLETORES_A for n in c.comandos} & {n for c in resto for n in c.comandos}
    assert not {n for c in COLETORES_A for n in c.tarefas} & {n for c in resto for n in c.tarefas}
    assert all(set(c.acesso) <= set(ACESSOS) and set(c.modos) == set(MODOS) for c in COLETORES_A)


def test_comandos_batem_com_comandos_py():
    for c in COLETORES_A:
        assert c.comandos == COMANDOS[c.id]
        for n in c.comandos:
            cmd = comando(n)
            assert cmd.classe is Classe.COLETOR and cmd.coletor == c.id, n
            assert cmd.encadeia == c.encadeados, f"{c.id}/{n}: encadeados {c.encadeados} x encadeia {cmd.encadeia}"
            assert cmd.modulo in c.modulos, f"{n}: {cmd.modulo} fora de {c.modulos}"
        for m in c.modulos:
            assert (PKG / m).is_file() and m in ARQUIVOS
    from civico_etl.catalogo import COMANDOS as TODOS

    for c in COLETORES_A:  # nenhum comando do código aponta para o id e ficou de fora da entrada
        assert {x.nome for x in TODOS if x.coletor == c.id} == set(c.comandos)


def test_argumentos_dos_comandos_existem_no_parser_real():
    parser = {"cli": "cli.py", "ale_cli": "jobs/ale_cli.py", "sapl": "jobs/sapl.py", "sancoes": "jobs/sancoes.py", "transparencia": "transparencia.py"}
    for c in COLETORES_A:
        for n in c.comandos:
            cmd = comando(n)
            assert set(cmd.argumentos) <= _flags(parser[cmd.parser]), n


def test_tarefas_existem_e_usam_comando_e_flags_do_coletor():
    tarefas = {t.name: t for t in S.TASKS}
    for c in COLETORES_A:
        assert c.tarefas == TAREFAS[c.id]
        for tn in c.tarefas:
            t = tarefas[tn]
            for dia in (HOJE, date(2026, 1, 2), date(2027, 6, 1)):
                argv = t.argv(dia)
                assert argv[0] in c.comandos, tn
                flags = {a for a in argv[1:] if a.startswith("--")}
                assert flags <= set(comando(argv[0]).argumentos), f"{tn}: {flags - set(comando(argv[0]).argumentos)}"
            if t.source:
                assert t.source in {f.slug for f in c.fontes}
    # nenhuma tarefa que roda um comando do lote ficou fora das tarefas do coletor
    dono = {n: c for c in COLETORES_A for n in c.comandos}
    for t in S.TASKS:
        c = dono.get(t.argv(HOJE)[0])
        if c:
            assert t.name in c.tarefas, f"{t.name} roda {t.argv(HOJE)[0]} e não está em {c.id}.tarefas"


def test_env_bate_com_a_agenda():
    tarefas = {t.name: t for t in S.TASKS}
    for c in COLETORES_A:
        assert {tarefas[tn].needs_env for tn in c.tarefas} == {c.env}, c.id
        da_fonte = {S.SOURCE_ENV[f.slug] for f in c.fontes if f.slug in S.SOURCE_ENV}
        assert da_fonte == ({c.env} if c.env else set()), c.id
    assert {c.id for c in COLETORES_A if c.env} == {"sancoes.cgu", "transparencia.emendas"}
    assert all(c.env == "TRANSPARENCIA_API_KEY" for c in COLETORES_A if c.env)


def test_datasets_cobrem_os_prefixos_das_tarefas():
    tarefas = {t.name: t for t in S.TASKS}
    for c in COLETORES_A:
        for tn in c.tarefas:
            for p in tarefas[tn].families(HOJE):
                anos = re.findall(r"\d{4}", p) or ["2024"]
                concretos = {d.replace("{ano}", y).replace("{uf}", "ro") for d in c.datasets for y in anos}
                assert any(d.startswith(p) for d in concretos), f"{tn}: prefixo {p!r} sem dataset em {c.datasets}"


def test_datasets_aparecem_no_codigo():
    esperado = {
        "tse.candidatos": [("jobs/tse_candidatos.py", 'f"tse.candidatos.{year}"'), ("jobs/tse_candidatos.py", 'f"tse.votos.{year}"')],
        "tse.votos": [("jobs/tse_votos_contas.py", 'f"tse.votos.{year}"')],
        "tse.contas": [("jobs/tse_votos_contas.py", 'f"tse.contas.{year}"')],
        "sancoes.tcu": [("jobs/sancoes.py", '"sancoes.tcu_inabilitados"')],
        "sancoes.cgu": [("jobs/sancoes.py", 'f"cgu.{kind}"')],
        "transparencia.emendas": [("jobs/transparencia_emendas.py", 'f"transparencia.emendas.{year}"')],
        "ale.custom": [("jobs/alesp.py", 'f"alesp.despesas.{y}"'), ("jobs/alesp.py", 'f"alesp.proposicoes.{y}"'),
                       ("jobs/almg.py", 'f"alemg.despesas.{y}"'), ("jobs/almg.py", 'f"alemg.proposicoes.{y}"')],
        "sapl.assembleias": [("jobs/sapl.py", 'f"{ALE_SOURCE}.descoberta"'), ("jobs/sapl.py", 'f"{ALE_SOURCE}.{house[\'uf\'].lower()}"')],
    }
    assert _constante("jobs/sapl.py", "ALE_SOURCE") == "sapl-ale"
    assert _constante("jobs/sancoes.py", "CGU_SOURCES") == {"ceis": "cgu_ceis", "cnep": "cgu_cnep"}
    for cid, pares in esperado.items():
        for arquivo, trecho in pares:
            assert trecho in _fonte(arquivo), f"{cid}: {trecho} fora de {arquivo}"
    assert POR_ID["sancoes.cgu"].datasets == ("cgu.ceis", "cgu.cnep") and 'kinds: tuple[str, ...] = ("ceis", "cnep")' in _fonte("jobs/sancoes.py")
    assert POR_ID["sapl.assembleias"].datasets == ("sapl-ale.descoberta", "sapl-ale.{uf}")
    assert POR_ID["ale.custom"].datasets == ("alesp.despesas.{ano}", "alesp.proposicoes.{ano}", "alemg.despesas.{ano}", "alemg.proposicoes.{ano}")


# ---------------------------------------------------------------- fontes, URLs e constantes copiadas do código


def test_origem_das_fontes_confere_com_seed_e_migracoes():
    seed = {s[0] for s in _constante("jobs/seed.py", "SOURCES")}
    mig: set[str] = set()
    for f in (REPO / "db" / "migrations").glob("*.sql"):
        for bloco in re.findall(r"insert into sources.*?;", f.read_text(encoding="utf-8"), re.S | re.I):
            mig |= set(re.findall(r"\(\s*'([^']+)'\s*,", bloco))
    for c in COLETORES_A:
        for f in c.fontes:
            if f.origem == "seed":
                assert f.slug in seed, f"{c.id}: {f.slug} fora do seed"
            elif f.origem == "migracao":
                assert f.slug in mig, f"{c.id}: {f.slug} fora das migrações"
            else:
                assert f.slug not in seed | mig, f"{c.id}: {f.slug} já nasce no seed/migração, não no job"
    assert {"cgu", "transparencia"} <= seed & mig  # nascem nos dois: o catálogo fica com a migração (comentado na entrada)
    assert 'upsert(conn, "sources"' in _fonte("jobs/assembleias.py") and 'upsert(conn, "sources"' in _fonte("jobs/sapl.py")
    assert _constante("jobs/alesp.py", "BASE") and '"alesp"' in _fonte("jobs/alesp.py") and '"alemg"' in _fonte("jobs/almg.py")


def test_urls_copiadas_conferem_com_o_codigo():
    assert coletores_a._TSE == _constante("jobs/tse_candidatos.py", "BASE") == _constante("jobs/tse_votos_contas.py", "BASE")
    for modelo, arquivo in ((coletores_a._TSE_CAND, "jobs/tse_candidatos.py"), (coletores_a._TSE_BENS, "jobs/tse_candidatos.py"),
                            (coletores_a._TSE_VOTACAO, "jobs/tse_candidatos.py"), (coletores_a._TSE_VOTACAO, "jobs/tse_votos_contas.py"),
                            (coletores_a._TSE_CONTAS, "jobs/tse_votos_contas.py")):
        assert 'f"' + modelo.replace(coletores_a._TSE, "{BASE}").replace("{ano}", "{year}") + '"' in _fonte(arquivo), modelo
    assert coletores_a._TCU == _constante("jobs/sancoes.py", "TCU_INABILITADOS")
    assert 'f"{TCU_INABILITADOS}?limit=1000"' in _fonte("jobs/sancoes.py")
    assert coletores_a._TRANSP == _constante("transparencia.py", "API")
    assert 'T.iter_pages(kind, {}' in _fonte("jobs/sancoes.py") and 'T.iter_pages("emendas", {"ano": year}' in _fonte("jobs/transparencia_emendas.py")
    assert 'urlencode({k: v for k, v in params.items() if v is not None})' in _fonte("transparencia.py")  # ?pagina=1 e ?ano=2024&pagina=1
    assert coletores_a._ALESP == _constante("jobs/alesp.py", "BASE")
    for u in POR_ID["ale.custom"].entradas.urls:
        if u.startswith(coletores_a._ALESP + "/"):
            assert 'f"' + u.replace(coletores_a._ALESP, "{BASE}").replace("{ano}", "{y}") + '"' in _fonte("jobs/alesp.py"), u
    assert coletores_a._ALMG == _constante("jobs/almg.py", "API")
    assert coletores_a._ALMG_LISTAS == tuple(_constante("jobs/almg.py", "LISTS"))
    assert coletores_a._ALMG_TIPOS == tuple(_constante("jobs/almg.py", "TYPES"))
    assert 'f"{API}/deputados/{kind}?formato=json"' in _fonte("jobs/almg.py")
    assert 'f"{API}/proposicoes/pesquisa/direcionada?tipo={t}&ano={y}&formato=json"' in _fonte("jobs/almg.py")
    for robots in (coletores_a._TCU_ROBOTS, coletores_a._ALESP_ROBOTS, coletores_a._ALMG_ROBOTS):
        assert robots.endswith("/robots.txt")
    assert 'f"{base}/robots.txt"' in _fonte("jobs/assembleias.py")  # allowed() lê {scheme}://{host}/robots.txt


def test_ale_sapl_copiado_e_igual_ao_dicionario_do_job():
    job = _constante("jobs/sapl.py", "ALE_SAPL")
    assert list(coletores_a._ALE_SAPL) == list(job.items())  # mesma ordem: sem --uf, scope = ALE_SAPL
    assert adaptadores_a._PAGINA_SAPL == _constante("jobs/sapl.py", "PAGE")
    urls = POR_ID["sapl.assembleias"].entradas.urls
    assert len(urls) == 2 * len(job) and all(u.endswith(("/api/", "/robots.txt")) for u in urls)
    assert "{base}/api/" not in urls and 'f"{base}/api/"' in _fonte("jobs/sapl.py")


def test_padroes_da_cli_conferem_com_os_adaptadores():
    cli = _fonte("cli.py")
    tuplas = [tuple(int(y) for y in re.findall(r"\d{4}", t)) for t in re.findall(r"for y in \(([\d, ]+)\) if y <= today\.year", cli)]
    assert tuplas == [adaptadores_a._ANOS_ELEICAO, adaptadores_a._ANOS_VOTOS_CONTAS, adaptadores_a._ANOS_VOTOS_CONTAS]
    assert "years = a.year or [y for y in (2018, 2020, 2022, 2024, 2026) if y <= today.year]" in cli
    assert "run_votes(conn, a.year or [y for y in (2022, 2024, 2026)" in cli and "run_finance(conn, a.year or [y for y in (2022, 2024, 2026)" in cli
    assert "run_tse(conn, years=years, ufs=a.uf, only_elected=not a.all, with_votes=a.votes, force=a.force)" in cli
    assert "a.uf" not in "".join(l for l in cli.splitlines() if "run_votes" in l or "run_finance" in l)
    ale = _fonte("jobs/ale_cli.py")
    assert f"range({adaptadores_a._PRIMEIRO_ANO_ALE}, today.year + 1)" in ale and f"y >= {adaptadores_a._ANO_VERBA_ALMG}" in ale
    assert tuple(_constante("jobs/ale_cli.py", "ADAPTERS")) == tuple(u.lower() for u in adaptadores_a._ALE_COMANDO)
    assert _constante("jobs/transparencia_emendas.py", "FIRST_YEAR") == adaptadores_a._PRIMEIRO_ANO_EMENDAS


# ---------------------------------------------------------------- tabelas, ausentes, recortes e acesso conferidos no código


def test_tabelas_aparecem_no_codigo_do_coletor():
    corpus = {
        "tse.candidatos": ["jobs/tse_candidatos.py", "identity.py", "parties.py"],
        "tse.votos": ["jobs/tse_votos_contas.py"], "tse.contas": ["jobs/tse_votos_contas.py"],
        "sancoes.tcu": ["jobs/sancoes.py"], "sancoes.cgu": ["jobs/sancoes.py"], "transparencia.emendas": ["jobs/transparencia_emendas.py"],
        "ale.custom": ["jobs/alesp.py", "jobs/almg.py", "jobs/assembleias.py"], "sapl.assembleias": ["jobs/sapl.py"],
    }
    for c in COLETORES_A:
        texto = "\n".join(_fonte(a) for a in corpus[c.id])
        for t in c.tabelas:
            assert re.search(rf"\b{t}\b", texto), f"{c.id}: tabela {t} não aparece em {corpus[c.id]}"


def test_politica_de_ausentes_confere_com_os_deletes_do_codigo():
    deletes = {
        "tse.candidatos": ("jobs/tse_candidatos.py", ("_load_year", "_drop_superseded")),
        "tse.contas": ("jobs/tse_votos_contas.py", ("_origin_entries",)),
        "sancoes.tcu": ("jobs/sancoes.py", ("run_tcu",)),
        "sancoes.cgu": ("jobs/sancoes.py", ("run_cgu",)),
        "ale.custom": ("jobs/assembleias.py", ("write_expenses", "write_proposals")),
    }
    for cid, (arq, funcs) in deletes.items():
        assert POR_ID[cid].ausentes.politica != "nao_apaga"
        assert all("delete from" in _funcao(arq, f).lower() for f in funcs), cid
    # sem delete: tse.votos (funções que ele chama), emendas e sapl.py inteiros
    for f in ("run_votes", "_apply", "_apply_ue", "_place_votes", "_mark_cassados", "aggregate_votes"):
        assert "delete from" not in _funcao("jobs/tse_votos_contas.py", f).lower()
    assert "delete from" not in _fonte("jobs/transparencia_emendas.py").lower() and "delete from" not in _fonte("jobs/sapl.py").lower()
    assert all(POR_ID[c].ausentes.politica == "nao_apaga" for c in ("tse.votos", "transparencia.emendas", "sapl.assembleias"))
    assert POR_ID["tse.contas"].ausentes.politica == "apaga" and POR_ID["ale.custom"].ausentes.politica == "apaga"
    # as guardas citadas
    assert "if keys:" in _funcao("jobs/sancoes.py", "run_tcu")
    cgu = _funcao("jobs/sancoes.py", "run_cgu")
    assert "state.truncated" in cgu and "elif not parsed" in cgu and "len(parsed) * 2 < have" in cgu
    assert "raise RuntimeError" in _funcao("jobs/tse_votos_contas.py", "_origin_entries")
    assert "delete from proposal_authors" in _funcao("jobs/assembleias.py", "write_proposals")
    assert "source_key = any" in _funcao("jobs/assembleias.py", "write_expenses")


def test_encadeados_e_derive_das_tarefas():
    tarefas = {t.name: t for t in S.TASKS}
    for cid in ("tse.candidatos", "tse.votos", "tse.contas"):
        assert POR_ID[cid].encadeados == ("derive.stats",) and tarefas[POR_ID[cid].tarefas[0]].derives
    for cid in ("sancoes.tcu", "sancoes.cgu", "transparencia.emendas", "sapl.assembleias"):
        assert POR_ID[cid].encadeados == ()
    # ale.*: derive.stats no fim, salvo --no-derive (que a tarefa agendada passa; a agenda roda derive depois)
    assert POR_ID["ale.custom"].encadeados == ("derive.stats",) and "--no-derive" in tarefas["ale.todas"].argv(HOJE) and not tarefas["ale.todas"].derives
    assert "run_derive" not in _fonte("jobs/sapl.py") and "run_derive" not in _fonte("jobs/sancoes.py") and "run_derive" not in _fonte("jobs/transparencia_emendas.py")


def test_recortes_aceitos_so_o_que_o_comando_le():
    assert POR_ID["tse.candidatos"].recortes_aceitos == ("ano", "uf") and POR_ID["tse.votos"].recortes_aceitos == ("ano",)
    assert POR_ID["tse.contas"].recortes_aceitos == ("ano",) and POR_ID["transparencia.emendas"].recortes_aceitos == ("ano",)
    assert POR_ID["sancoes.tcu"].recortes_aceitos == () and POR_ID["sancoes.cgu"].recortes_aceitos == ()
    assert POR_ID["sapl.assembleias"].recortes_aceitos == ("uf",) and POR_ID["ale.custom"].recortes_aceitos == ("ano", "uf")
    # "ano"/"uf" aceitos têm de ser argumentos do comando (ale.*: a UF é o próprio comando)
    for c in COLETORES_A:
        for n in c.comandos:
            args = set(comando(n).argumentos)
            assert ("ano" in c.recortes_aceitos) == ("--year" in args), n
            if c.id != "ale.custom":
                assert ("uf" in c.recortes_aceitos) == ("--uf" in args), n
    # aceito pelo parser e ignorado pelo comando: declarado como não aceito, com explicação
    for (cid, rec), texto in EXPLICACOES_A.items():
        assert rec in POR_ID[cid].recortes_nao_aceitos and texto


def test_acesso_e_tentativas_registradas_conferem_com_o_cliente_http_usado():
    tvc, sanc, trans = _fonte("jobs/tse_votos_contas.py"), _fonte("jobs/sancoes.py"), _fonte("transparencia.py")
    assert "open_remote(" in tvc and "fetch(" not in tvc.replace("def fetch", "") and "from ..remotezip import" in tvc
    assert "client().head(" in _fonte("remotezip.py") and "client().get(" in _fonte("remotezip.py") and "fetch(" not in _fonte("remotezip.py").replace("def fetch", "")
    assert "H.api_json(" in trans and "H.fetch(" not in trans and "H.fetch_json(" not in trans
    assert "H.fetch_json(" in sanc and "T.iter_pages" in sanc
    assert "from ..http import CACHE_DIR, fetch" in _fonte("jobs/tse_candidatos.py")
    assert "polite_fetch" in _fonte("jobs/alesp.py") and "polite_json" in _fonte("jobs/almg.py") and "H.fetch_json(url" in _fonte("jobs/sapl.py")
    assert POR_ID["tse.votos"].acesso == POR_ID["tse.contas"].acesso == ("zip_remoto_por_faixa",)
    for cid in IDS:
        remoto = cid in ("tse.votos", "tse.contas", "sancoes.cgu", "transparencia.emendas")
        assert POR_ID[cid].tentativas_registradas is (not remoto), cid


def test_caracterizado_so_onde_um_teste_chama_a_funcao_de_entrada():
    entradas = {
        "tse.candidatos": ("run_tse",), "tse.votos": ("run_votes",), "tse.contas": ("run_finance",), "sancoes.tcu": ("run_tcu",),
        "sancoes.cgu": ("run_cgu",), "transparencia.emendas": ("run_emendas",), "ale.custom": ("run_alesp", "run_almg", "ale_main"),
        "sapl.assembleias": ("discover_ales", "load_house"),
    }
    textos = {p.name: p.read_text(encoding="utf-8") for p in TESTS.glob("test_*.py") if not p.name.startswith("test_catalogo")}
    for cid, nomes in entradas.items():
        chamam = {a for a, t in textos.items() for n in nomes if re.search(rf"\b{n}\(", t)}
        # o mesmo comando acionado pela CLI em teste (rodar_cli / cli.main) também caracteriza
        cmds = "|".join(re.escape(x) for x in POR_ID[cid].comandos)
        chamam |= {a for a, t in textos.items() if re.search(rf"(rodar_cli|cli\.main|ale_main|sapl_main)\(\s*\[\s*[\"']({cmds})[\"']", t)}
        assert bool(chamam) == POR_ID[cid].caracterizado, f"{cid}: testes que chamam a entrada: {sorted(chamam)}"
    assert {a for a, t in textos.items() if re.search(r"\brun_cgu\(", t)} == {"test_sancoes.py"}
    assert {a for a, t in textos.items() if re.search(r"\brun_emendas\(", t)} == {"test_emendas.py"}


# ---------------------------------------------------------------- orquestradores


def test_orquestradores_conferem_com_os_arquivos():
    assert (coletores_a._ORQ_ACTIONS, coletores_a._ORQ_LOCAL) == (coletores._ORQ_ACTIONS, coletores._ORQ_LOCAL)
    etl_yml = (REPO / ".github" / "workflows" / "etl.yml").read_text(encoding="utf-8")
    local = (ETL / "deploy" / "run-due-local.sh").read_text(encoding="utf-8")
    sapl_prod = (ETL / "deploy" / "run-due-sapl-prod.sh").read_text(encoding="utf-8")
    assert re.findall(r'^\s+ETL_TASKS_EXCLUDE:\s*"([^"]*)"', etl_yml, re.M) == ["sapl.todas"]
    assert "ETL_TASKS_INCLUDE" not in etl_yml and "ETL_TASKS_INCLUDE" not in local and "ETL_TASKS_EXCLUDE" not in local and "--only" not in local
    assert re.findall(r"^export ETL_TASKS_INCLUDE=(\S+)", sapl_prod, re.M) == ["sapl.todas"]
    assert "TRANSPARENCIA_API_KEY: ${{ secrets.TRANSPARENCIA_API_KEY }}" in etl_yml
    for c in COLETORES_A:
        assert c.orquestradores == (coletores_a._ORQ_ACTIONS, coletores_a._ORQ_LOCAL), c.id
        assert "sapl.todas" not in c.tarefas


# ---------------------------------------------------------------- adaptadores


def test_adaptadores_registrados_e_explicacoes_em_dia():
    assert set(IDS) <= set(contrato.ADAPTADORES)
    assert all(contrato.ADAPTADORES[i].__module__.endswith("adaptadores_a") for i in IDS)


A = "https://cdn.tse.jus.br/estatistica/sead/odsele"


def test_tse_candidatos():
    cmd, argv, urls, est, obs, recusa = _plano("tse.candidatos")
    assert (cmd, argv, est, recusa) == ("tse.candidatos", ["tse.candidatos"], False, "")
    assert len(urls) == 10 and not any("votacao" in u for u in urls) and f"{A}/consulta_cand/consulta_cand_2018.zip" in urls
    assert f"{A}/bem_candidato/bem_candidato_2026.zip" in urls and not any("{" in u for u in urls)
    assert "--all" in obs and "--votes" in obs and "2018" in obs
    _, argv, urls, _, _, recusa = _plano("tse.candidatos", Recorte(anos=(2022,)))
    assert argv == ["tse.candidatos", "--year", "2022"] and recusa == ""
    assert urls == (f"{A}/consulta_cand/consulta_cand_2022.zip", f"{A}/bem_candidato/bem_candidato_2022.zip")
    _, argv, urls, _, obs, _ = _plano("tse.candidatos", Recorte(anos=(2024, 2022), ufs=("sp", "rj")))
    assert argv == ["tse.candidatos", "--year", "2024", "--year", "2022", "--uf", "SP", "--uf", "RJ"] and len(urls) == 4 and "inteiro" in obs
    assert len(_plano("tse.candidatos", hoje=date(2022, 3, 1))[2]) == 6  # 2018, 2020, 2022
    for ruim, fala in ((Recorte(ibges=("3550308",)), "'ibge'"), (Recorte(casas=("x",)), "'casa'"), (Recorte(modo="descobrir"), "um zip por ano")):
        assert fala in _plano("tse.candidatos", ruim)[5]
    assert _plano("tse.candidatos", Recorte(modo="reprocessar"))[1] == ["tse.candidatos"]


@pytest.mark.parametrize("cid,pasta,nome", [
    ("tse.votos", "votacao_candidato_munzona", "votacao_candidato_munzona_{}.zip"),
    ("tse.contas", "prestacao_contas", "prestacao_de_contas_eleitorais_candidatos_{}.zip"),
])
def test_tse_votos_e_contas(cid, pasta, nome):
    url = lambda a: f"{A}/{pasta}/{nome.format(a)}"  # noqa: E731
    cmd, argv, urls, est, obs, recusa = _plano(cid)
    assert (cmd, argv, est, recusa) == (cid, [cid], False, "")
    assert urls == (url(2022), url(2024), url(2026)) and "Range" in obs
    assert _plano(cid, Recorte(anos=(2022,)))[1:3] == ([cid, "--year", "2022"], (url(2022),))
    assert _plano(cid, Recorte(anos=(2024, 2022)))[1] == [cid, "--year", "2024", "--year", "2022"]
    assert _plano(cid, hoje=date(2023, 5, 1))[2] == (url(2022),)
    # integrado: a explicação de EXPLICACOES_A entra em contrato._EXPLICACOES e substitui a recusa genérica ("recorte 'uf' ... não aceito")
    uf = _plano(cid, Recorte(ufs=("SP",)))[5]
    assert EXPLICACOES_A[(cid, "uf")] in uf and contrato._EXPLICACOES[(cid, "uf")] == EXPLICACOES_A[(cid, "uf")] and "--uf" in uf
    assert "não suportado" in _plano(cid, Recorte(modo="reprocessar"))[5] and POR_ID[cid].modos["reprocessar"].motivo in _plano(cid, Recorte(modo="reprocessar"))[5]
    assert "'ibge'" in _plano(cid, Recorte(ibges=("3550308",)))[5]


def test_sancoes_tcu_e_cgu():
    cmd, argv, urls, est, obs, recusa = _plano("sancoes.tcu")
    assert (cmd, argv, est, recusa) == ("sancoes.tcu", ["sancoes.tcu"], True, "")
    assert urls == ("https://contas.tcu.gov.br/ords/condenacao/consulta/inabilitados?limit=1000", "https://contas.tcu.gov.br/robots.txt") and "rel=next" in obs
    for ruim in (Recorte(anos=(2024,)), Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("x",))):
        assert _plano("sancoes.tcu", ruim)[5] and _plano("sancoes.cgu", ruim)[5]
    assert "fonte única" in _plano("sancoes.tcu", Recorte(modo="descobrir"))[5]
    assert _plano("sancoes.tcu", Recorte(modo="reprocessar"))[1] == ["sancoes.tcu"]
    cmd, argv, urls, est, obs, recusa = _plano("sancoes.cgu")
    api = "https://api.portaldatransparencia.gov.br/api-de-dados"
    assert (cmd, argv, est, recusa) == ("sancoes.cgu", ["sancoes.cgu"], True, "") and urls == (f"{api}/ceis?pagina=1", f"{api}/cnep?pagina=1")
    assert "TRANSPARENCIA_API_KEY" in obs and "reprocessar" not in obs
    assert POR_ID["sancoes.cgu"].modos["reprocessar"].motivo in _plano("sancoes.cgu", Recorte(modo="reprocessar"))[5]


def test_transparencia_emendas():
    api = "https://api.portaldatransparencia.gov.br/api-de-dados"
    cmd, argv, urls, est, obs, recusa = _plano("transparencia.emendas")
    assert (cmd, argv, est, recusa) == ("transparencia.emendas", ["transparencia.emendas"], True, "")
    assert urls == tuple(f"{api}/emendas?ano={a}&pagina=1" for a in (2023, 2024, 2025, 2026)) and "TRANSPARENCIA_API_KEY" in obs
    assert _plano("transparencia.emendas", Recorte(anos=(2024,)))[1:3] == (["transparencia.emendas", "--year", "2024"], (f"{api}/emendas?ano=2024&pagina=1",))
    _, argv, urls, _, obs, _ = _plano("transparencia.emendas", Recorte(anos=(2025, 2022)))
    assert argv == ["transparencia.emendas", "--year", "2025", "--year", "2022"] and len(urls) == 2 and "sem validação" in obs
    assert _plano("transparencia.emendas", hoje=date(2024, 1, 1))[2] == (f"{api}/emendas?ano=2023&pagina=1", f"{api}/emendas?ano=2024&pagina=1")
    assert "'uf'" in _plano("transparencia.emendas", Recorte(ufs=("SP",)))[5]
    assert "reprocessar" in _plano("transparencia.emendas", Recorte(modo="reprocessar"))[5]


def test_ale_custom():
    sp, mg = "https://www.al.sp.gov.br/repositorioDados", "https://dadosabertos.almg.gov.br/api/v2"
    cmd, argv, urls, est, obs, recusa = _plano("ale.custom")
    assert (cmd, argv, est, recusa) == ("ale.todas", ["ale.todas"], True, "") and f"{sp}/deputados/despesas_gabinetes_2019.xml" in urls
    assert f"{mg}/deputados/em_exercicio?formato=json" in urls and "2019 a 2026" in obs and not any("{" in u for u in urls)
    cmd, argv, urls, est, obs, _ = _plano("ale.custom", Recorte(ufs=("sp",)))
    assert (cmd, argv, est) == ("ale.sp", ["ale.sp"], False) and not any("almg" in u for u in urls)
    assert urls == (f"{sp}/deputados/deputados.xml", *(f"{sp}/deputados/despesas_gabinetes_{a}.xml" for a in range(2019, 2027)),
                    f"{sp}/processo_legislativo/naturezasSpl.xml", f"{sp}/processo_legislativo/proposituras.zip",
                    f"{sp}/processo_legislativo/documento_autor.zip", "https://www.al.sp.gov.br/robots.txt")
    cmd, argv, urls, est, obs, _ = _plano("ale.custom", Recorte(ufs=("MG",), anos=(2025,)))
    assert (cmd, argv, est) == ("ale.mg", ["ale.mg", "--year", "2025"], True) and not any("al.sp" in u for u in urls) and len(urls) == 10
    assert f"{mg}/proposicoes/pesquisa/direcionada?tipo=PRE&ano=2025&formato=json" in urls and ">= 2023" in obs and "/deputados/{id}" in obs
    assert _plano("ale.custom", Recorte(ufs=("SP", "MG"), anos=(2024, 2025)))[:2] == ("ale.todas", ["ale.todas", "--year", "2024", "--year", "2025"])
    assert _plano("ale.custom", Recorte(ufs=("MG", "SP")))[0] == "ale.todas"
    rj = _plano("ale.custom", Recorte(ufs=("RJ",)))
    assert rj[0] == "" and rj[1] == [] and "RJ" in rj[5] and "SP e MG" in rj[5]
    assert _plano("ale.custom", Recorte(ufs=("SP", "RJ")))[5]
    assert "'ibge'" in _plano("ale.custom", Recorte(ibges=("3550308",)))[5] and "'casa'" in _plano("ale.custom", Recorte(casas=("x",)))[5]
    assert "descoberta" in _plano("ale.custom", Recorte(modo="descobrir"))[5]
    assert _plano("ale.custom", Recorte(ufs=("SP",), modo="reprocessar"))[1] == ["ale.sp"]


def test_sapl_assembleias():
    cmd, argv, urls, est, obs, recusa = _plano("sapl.assembleias")
    assert (cmd, argv, est, recusa) == ("sapl.ales", ["sapl.ales"], True, "") and len(urls) == 10
    assert "https://sapl.al.pb.leg.br/api/" in urls and "https://sapl.al.am.leg.br/robots.txt" in urls
    assert "load_queue" in obs and "não garante recarga" in obs and "sem banco" in obs
    _, argv, urls, _, _, _ = _plano("sapl.assembleias", Recorte(ufs=("ro",)))
    assert argv == ["sapl.ales", "--uf", "RO"] and urls == ("https://sapl.al.ro.leg.br/api/", "https://sapl.al.ro.leg.br/robots.txt")
    assert _plano("sapl.assembleias", Recorte(ufs=("PB", "AC")))[1] == ["sapl.ales", "--uf", "PB", "--uf", "AC"]
    sp = _plano("sapl.assembleias", Recorte(ufs=("SP",)))
    assert sp[1] == [] and "ALE_SAPL" in sp[5] and "RO, AC, AM, PI, PB" in sp[5]
    assert _plano("sapl.assembleias", Recorte(ufs=("RO", "SP")))[5]
    assert "'ano'" in _plano("sapl.assembleias", Recorte(anos=(2025,)))[5]
    # integrado: --ibge usa a explicação de EXPLICACOES_A (correta pelo código: sapl.py:761 define o escopo só por --uf; :781-782 trocam a fila de load_queue pelas câmaras ok do escopo, sem STALE_DAYS nem backoff)
    ibge = _plano("sapl.assembleias", Recorte(ibges=("1100205",)))[5]
    assert EXPLICACOES_A[("sapl.assembleias", "ibge")] in ibge and contrato._EXPLICACOES[("sapl.assembleias", "ibge")] in ibge
    desc = _plano("sapl.assembleias", Recorte(modo="descobrir"))
    assert desc[1] == [] and POR_ID["sapl.assembleias"].modos["descobrir"].motivo in desc[5] and "sempre sonda" in desc[5]
    assert POR_ID["sapl.assembleias"].modos["reprocessar"].motivo in _plano("sapl.assembleias", Recorte(modo="reprocessar"))[5]
    conn = ConnFalsa({"sapl_houses": [{"uf": "RO", "status": "ok"}, {"uf": "AC", "status": "sem_api"}]})
    _, argv, urls, est, obs, _ = _plano("sapl.assembleias", Recorte(ufs=("RO", "AC", "PI")), conn=conn)
    assert argv == ["sapl.ales", "--uf", "RO", "--uf", "AC", "--uf", "PI"] and est is True
    assert "https://sapl.al.ro.leg.br/api/parlamentares/legislatura/?page_size=100&page=1" in urls
    assert not any("al.ac.leg.br/api/parlamentares" in u for u in urls) and "AC=sem_api" in obs and "PI=sem registro" in obs
    assert len(conn.sqls) == 1 and conn.sqls[0].startswith("select")


def test_adaptadores_nao_fazem_rede_nem_escrevem_no_banco(monkeypatch):
    class _ClienteQueFalha:
        def __getattr__(self, nome):
            raise AssertionError(f"adaptador tocou o cliente HTTP ({nome})")

    def sem_socket(*a, **k):
        raise AssertionError("adaptador criou um socket")

    monkeypatch.setattr(H, "_client", _ClienteQueFalha())
    monkeypatch.setattr(socket, "socket", sem_socket)
    monkeypatch.setattr(socket, "create_connection", sem_socket)
    conn = ConnFalsa({"sapl_houses": [{"uf": "RO", "status": "ok"}]})
    recortes = [Recorte(), Recorte(anos=(2022, 2024)), Recorte(ufs=("SP",)), Recorte(ufs=("RO",)), Recorte(ufs=("MG",), anos=(2025,)), Recorte(ibges=("3550308",)),
                Recorte(modo="reprocessar"), Recorte(modo="descobrir")]
    for cid in IDS:
        for r in recortes:
            _plano(cid, r, hoje=HOJE)
            _plano(cid, r, conn=conn, hoje=HOJE)
        _plano(cid, hoje=None)  # sem `hoje`: usa date.today(), ainda sem rede
    with pytest.raises(AssertionError):  # o cerco funciona
        H.client().get("https://example.invalid")


def test_toda_url_listada_tem_padrao_conhecido_no_catalogo():
    """O que o adaptador devolve vem do catálogo (nada inventado): toda URL concreta casa com algum modelo de Entradas.urls."""
    for cid in IDS:
        modelos = [re.escape(u).replace(r"\{ano\}", r"\d{4}") for u in POR_ID[cid].entradas.urls]
        for r in (Recorte(), Recorte(anos=(2023,)), Recorte(ufs=("MG",))):
            urls = _plano(cid, r)[2]
            for u in urls:
                if "legislatura/?page_size" in u:
                    continue
                assert any(re.fullmatch(m, u) for m in modelos), f"{cid}: {u}"


# ---------------------------------------------------------------- isolamento de import


def test_importar_o_lote_nao_importa_job_cli_nem_altera_http_rate():
    codigo = """
import json, sys
import civico_etl.http as H
antes_rate, antes_mods = H.RATE, set(sys.modules)
import civico_etl.catalogo.coletores_a, civico_etl.catalogo.adaptadores_a
novos = sorted(m for m in sys.modules if m not in antes_mods)
print(json.dumps({"rate_igual": H.RATE == antes_rate, "novos": novos}))
"""
    p = subprocess.run([sys.executable, "-c", codigo], cwd=ETL, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    assert r["rate_igual"]
    assert [m for m in r["novos"] if m.startswith("civico_etl.jobs") or m in ("civico_etl.cli", "civico_etl.schedule", "civico_etl.db")] == []


def test_imports_dos_modulos_do_lote_sao_so_da_biblioteca_padrao_e_do_catalogo():
    permitido = {
        "coletores_a.py": {"__future__", ".modelo"},
        "adaptadores_a.py": {"__future__", "datetime", "typing", ".contrato", ".coletores_a", ".modelo"},
    }
    for arq, ok in permitido.items():
        tree = ast.parse((PKG / "catalogo" / arq).read_text(encoding="utf-8"))
        vistos = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                vistos |= {a.name for a in n.names}
            if isinstance(n, ast.ImportFrom):
                vistos.add("." * n.level + (n.module or ""))
        assert vistos <= ok, f"{arq}: {vistos - ok}"
