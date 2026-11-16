"""FABRICADO. A fixture do SAPL (etl/tests/fixtures/sapl_ale/) lida pelo job REAL, pela CLI real, sem rede, num banco isolado.

Fixa o comportamento REAL de `sapl.ales`, `sapl.descobrir --ibge` e `sapl.carregar --ibge` sobre os cenários v1, v2 e falhas, e o lançador
`tests/simulado.py`. Nada de skip/xfail; o banco da suíte nunca é tocado (só o banco da fixture `banco_isolado`), e o recorte é desfeito em `finally`.

Comportamentos do job que estes testes fixam (todos de jobs/sapl.py, sem alteração):
- código de saída de `sapl.ales`/`sapl.carregar`: 1 só se alguma casa da FILA terminou `falhou` (exceção dentro de `_load_one`). Casa que a descoberta marca
  `robots_bloqueia`/`fora_do_ar`/`sem_api` não entra na fila e NÃO conta como falha: sai 0.
- `load_queue`: casa `ok` carregada há menos de STALE_DAYS (6 dias) fica de fora; `--full` só muda o modo de quem já está na fila e NÃO força nada;
  `--uf` só restringe o escopo. O único modo de forçar em `sapl.ales` é o efeito colateral de `--ibge <qualquer>` (`if a.ibge:` refaz a fila com
  todas as casas `ok` do escopo, mesmo em sapl.ales, onde o escopo são siglas de UF).
- cache: robots.txt e /api/ valem 1 dia (7 dias o /api/ e o registro de município), em disco e (robots) em memória. A segunda rodada no mesmo dia só enxerga
  mudança com ETL_HTTP_REFETCH; falha (5xx, timeout, 403) nunca é gravada no cache, mas 200 com corpo vazio é (e o job lê JSONDecodeError).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import admin_fixtures as AF
import httpx
import psycopg
import pytest
import simulado
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row

from civico_etl import cli
from civico_etl.jobs import sapl

ETL_DIR = Path(__file__).resolve().parent.parent
TABELAS = ("sapl_parlamentares", "sapl_mandatos", "sapl_materias", "sapl_autorias", "sapl_sessoes", "sapl_presencas", "sapl_votos", "sapl_cursors")
SEM_FILA = ("--workers", "1", "--casa-max-min", "5")
FORCA = ("--ibge", "0000000")  # efeito colateral de --ibge em sapl.ales: força a fila (ver docstring do módulo)

# contagens por casa depois de UMA carga completa do cenário v1 (ver o gerador: 4 parlamentares, 3 mandatos, matérias de projeto, ...)
CARGA_RO = {"sapl_parlamentares": 4, "sapl_mandatos": 3, "sapl_materias": 4, "sapl_autorias": 5, "sapl_sessoes": 2, "sapl_presencas": 5, "sapl_votos": 5, "sapl_cursors": 4}
CARGA_AC = {**CARGA_RO, "sapl_materias": 3, "sapl_autorias": 4}  # AC não tem a matéria 304
CARGA_V1 = {"RO": CARGA_RO, "AC": CARGA_AC, "AM": CARGA_RO}
CARGA_MUN = CARGA_RO


# ------------------------------------------------------------------ apoio


def foto(url: str) -> dict[str, Any]:
    """O que o recorte tem no banco: casas, contagens por casa e tabela, cobertura, runs, carimbos, fontes."""
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        c.execute("set timezone = 'UTC'")
        casas = {r["k"]: dict(r) for r in c.execute(
            """select (case when p.kind = 'uf' then p.uf else p.ibge_code end) k, p.kind, h.id, h.status, h.base_url, h.registry_url, h.registry_status, h.last_outcome, h.fail_count,
                      h.loaded_at::text loaded_at, h.retry_after is not null tem_retry, h.note
               from sapl_houses h join places p on p.id = h.place_id order by 1""")}
        cont: dict[str, dict[str, int]] = {}
        for t in TABELAS:
            for r in c.execute(f"select (case when p.kind = 'uf' then p.uf else p.ibge_code end) k, count(*) n from {t} x join sapl_houses h on h.id = x.house_id join places p on p.id = h.place_id group by 1"):
                cont.setdefault(r["k"], {})[t] = r["n"]
        cob: dict[str, dict[str, str]] = {}
        for r in c.execute("select (case when p.kind = 'uf' then p.uf else p.ibge_code end) k, dataset, status from data_coverage d join places p on p.id = d.place_id where dataset in ('propostas', 'presenca', 'votos') and (p.kind = 'uf' or p.ibge_code = %s)", (AF.IBGE_MUNICIPIO,)):
            cob.setdefault(r["k"], {})[r["dataset"]] = r["status"]
        runs = [dict(r) for r in c.execute("select dataset, status, rows_upserted, rows_rejected from ingest_runs where dataset like 'sapl%' order by started_at, created_at")]
        stamps = sorted(r["dataset"] for r in c.execute("select dataset from dataset_stamps where dataset like 'sapl%'"))
        fontes = sorted(r["slug"] for r in c.execute("select slug from sources where slug like 'sapl%'"))
    return dict(casas=casas, cont=cont, cob=cob, runs=runs, stamps=stamps, fontes=fontes)


def log_contagem(caminho: Path) -> dict[str, int]:
    """Desfechos do ETL_ATTEMPT_LOG: baixada, revalidada_304, cache_fresco e falha/<motivo> (um por chamada de `fetch`, retentativas à parte)."""
    out: dict[str, int] = {}
    if caminho.exists():
        for linha in caminho.read_text().splitlines():
            r = json.loads(linha)
            k = r["desfecho"] + ("/" + r["motivo"] if r.get("motivo") else "")
            out[k] = out.get(k, 0) + 1
    return out


@dataclass
class Rodada:
    rc: int
    pedidos: list[str]
    respostas: list[tuple[str, Any]]
    nao_previstos: list[str]
    log: dict[str, int]
    foto: dict[str, Any] = field(default_factory=dict)


def rodar(url: str, cenario: str, cache: Path, tmp: Path, nome: str, argv: list[str], *, refetch: list[str] | None = None) -> Rodada:
    """Roda `civico_etl.cli.main(argv)` com o transporte fabricado do cenário. `refetch`: URLs que ignoram o max_age (ETL_HTTP_REFETCH)."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("ETL_DATABASE_URL", url)
        mp.setenv("DATABASE_URL", url)
        mp.delenv("ETL_INVOCATION", raising=False)
        t = AF.instalar(mp, cenario, cache)
        log = tmp / f"{nome}.jsonl"
        mp.setenv("ETL_ATTEMPT_LOG", str(log))
        if refetch:
            f = tmp / f"{nome}.refetch"
            f.write_text("\n".join(refetch) + "\n")
            mp.setenv("ETL_HTTP_REFETCH", str(f))
        rc = cli.main(argv)
    return Rodada(rc, list(t.pedidos), list(t.respostas), list(t.nao_previstos), log_contagem(log), foto(url))


def todas_as_entradas_ale() -> list[str]:
    return [u for uf in AF.UFS for u in (f"{AF.ALE_HOSTS[uf]}/robots.txt", f"{AF.ALE_HOSTS[uf]}/api/")]


@contextmanager
def base(url: str):
    AF.limpar_base(url)
    AF.carregar_base(url)
    try:
        yield
    finally:
        AF.limpar_base(url)


# ------------------------------------------------------------------ fluxo 1 -> 2 -> 3 de sapl.ales


@pytest.fixture(scope="module")
def fluxo(banco_isolado, tmp_path_factory):  # noqa: F811
    """v1 (carga) -> v1 de novo -> v1 --full -> v2 (descoberta com refetch) -> v2 forçado. Um único cache, como na rodada real de dias seguidos."""
    url = banco_isolado
    tmp = tmp_path_factory.mktemp("fluxo_ales")
    cache = tmp / "cache"
    AF.limpar_base(url)
    AF.carregar_base(url)
    try:
        r: dict[str, Rodada] = {}
        r["v1"] = rodar(url, "v1", cache, tmp, "v1", ["sapl.ales", *SEM_FILA])
        r["v1b"] = rodar(url, "v1", cache, tmp, "v1b", ["sapl.ales", *SEM_FILA])
        r["v1full"] = rodar(url, "v1", cache, tmp, "v1full", ["sapl.ales", *SEM_FILA, "--full"])
        r["v2"] = rodar(url, "v2", cache, tmp, "v2", ["sapl.ales", *SEM_FILA], refetch=todas_as_entradas_ale())
        r["v2forca"] = rodar(url, "v2", cache, tmp, "v2forca", ["sapl.ales", *SEM_FILA, *FORCA], refetch=todas_as_entradas_ale())
    finally:
        AF.limpar_base(url)
    return r


def status_das_casas(f: dict[str, Any]) -> dict[str, str]:
    return {uf: c["status"] for uf, c in f["casas"].items() if c["kind"] == "uf"}


def contagens(f: dict[str, Any], ufs: tuple[str, ...]) -> dict[str, dict[str, int]]:
    return {uf: f["cont"].get(uf, {}) for uf in ufs}


def test_1_sapl_ales_v1_pela_cli_real(fluxo):
    r = fluxo["v1"]
    # Código de saída: 0. O main devolve 1 só se `_load_one` devolver 'falhou' (exceção na carga de uma casa da fila). PI (robots_bloqueia) e PB
    # (fora_do_ar, /api/ 500) são resultados da DESCOBERTA, não entram em `load_queue` (só status 'ok') e não contam como falha.
    assert r.rc == 0
    assert r.nao_previstos == [] and not any(s == "nao_previsto" for _u, s in r.respostas)
    f = r.foto
    assert status_das_casas(f) == AF.STATUS_ALE["v1"] == {"RO": "ok", "AC": "ok", "AM": "ok", "PI": "robots_bloqueia", "PB": "fora_do_ar"}
    assert f["casas"]["PB"]["note"] == "HTTPStatusError: 500"  # 500 é retentado (5 tentativas) e vira fora_do_ar; 404 viraria sem_api
    assert "robots.txt bloqueia https://sapl.al.pi.leg.br/api/" in f["casas"]["PI"]["note"]
    assert contagens(f, ("RO", "AC", "AM")) == CARGA_V1
    assert contagens(f, ("PI", "PB")) == {"PI": {}, "PB": {}}  # nada carregado onde a descoberta barrou
    for uf in ("RO", "AC", "AM"):
        assert f["casas"][uf]["last_outcome"] == "carregada" and f["casas"][uf]["loaded_at"]
        assert f["cob"][uf] == {"propostas": "carregando", "presenca": "carregando", "votos": "carregando"}
    assert "PI" not in f["cob"] and "PB" not in f["cob"]
    assert "sapl-ale" in f["fontes"]  # criada por discover_ales
    esperados = {"sapl-ale.descoberta", "sapl-ale.ro", "sapl-ale.ac", "sapl-ale.am"}
    assert {x["dataset"] for x in f["runs"]} == set(f["stamps"]) == esperados
    assert all(x["status"] == "succeeded" for x in f["runs"])
    assert all(x["rows_rejected"] == 3 for x in f["runs"] if x["dataset"] != "sapl-ale.descoberta")  # 3 parlamentares sem pessoa do TSE (fixture sem mandatos)
    # paginação: o endpoint de parlamentares tem DUAS páginas e as duas foram lidas
    p = AF.ALE_HOSTS["RO"] + "/api/parlamentares/parlamentar/?page_size=100&page="
    assert p + "1" in r.pedidos and p + "2" in r.pedidos
    # a PB retentada: 5 pedidos ao /api/ (http.fetch retries=4), todos 500
    assert [s for u, s in r.respostas if u == AF.ALE_HOSTS["PB"] + "/api/"] == [500] * 5
    assert r.log["baixada"] == len(r.pedidos) - 5 and r.log["falha/erro"] == 1  # uma chamada de fetch falha (as 5 tentativas contam uma vez no log)


def test_2_segunda_rodada_v1_reaproveita_e_nao_duplica(fluxo):
    a, b, c = fluxo["v1"], fluxo["v1b"], fluxo["v1full"]
    assert b.rc == 0 and c.rc == 0
    assert b.nao_previstos == [] and c.nao_previstos == []
    assert b.foto["cont"] == a.foto["cont"]  # nenhuma linha duplicada em nenhuma tabela sapl_*
    assert status_das_casas(b.foto) == status_das_casas(a.foto)
    for uf in ("RO", "AC", "AM"):  # nem foi recarregada: load_queue deixa de fora casa 'ok' carregada há menos de STALE_DAYS
        assert b.foto["casas"][uf]["loaded_at"] == a.foto["casas"][uf]["loaded_at"]
    # o que a segunda rodada pede: só o /api/ da PB (fora_do_ar nunca vai para o cache; 5 tentativas). Robots e /api/ das demais vêm do cache (1 dia);
    # nenhum 304, nenhuma leitura da carga.
    assert b.pedidos == [AF.ALE_HOSTS["PB"] + "/api/"] * 5
    assert b.log == {"cache_fresco": 8, "falha/erro": 1}  # 5 robots + /api/ de RO, AC, AM em cache fresco; PB falha de novo
    # --full NÃO força nada: a fila continua vazia, só muda o modo de quem estivesse nela
    assert c.pedidos == b.pedidos and c.foto["cont"] == a.foto["cont"]
    assert c.foto["casas"]["RO"]["loaded_at"] == a.foto["casas"]["RO"]["loaded_at"]
    ds = [x["dataset"] for x in c.foto["runs"]]
    assert ds.count("sapl-ale.ro") == ds.count("sapl-ale.ac") == ds.count("sapl-ale.am") == 1  # nenhum run de carga novo
    assert ds.count("sapl-ale.descoberta") == 3  # a descoberta, essa sim, grava um run a cada rodada (v1, v1 de novo, v1 --full)


def test_3_sapl_ales_v2_muda_status_e_nada_e_apagado(fluxo):
    v1, v2, forca = fluxo["v1"], fluxo["v2"], fluxo["v2forca"]
    # (a) rodada v2 comum, com robots e /api/ relidos (ETL_HTTP_REFETCH): descoberta enxerga a mudança; a fila só leva a PB (nunca carregada)
    assert v2.rc == 0 and v2.nao_previstos == []
    assert status_das_casas(v2.foto) == AF.STATUS_ALE["v2"] == {"RO": "ok", "AC": "ok", "AM": "robots_bloqueia", "PI": "robots_bloqueia", "PB": "ok"}
    assert "robots.txt bloqueia https://sapl.al.am.leg.br/api/" in v2.foto["casas"]["AM"]["note"]
    assert v2.foto["casas"]["PB"]["last_outcome"] == "carregada" and v2.foto["cont"]["PB"] == CARGA_RO
    assert v2.foto["cont"]["RO"] == CARGA_RO  # RO NÃO foi recarregada: a matéria nova ainda não está (STALE_DAYS)
    assert v2.log["revalidada_304"] == 6  # robots de RO, AC, PI, PB e /api/ de RO e AC: ETag igual, 304; só o robots da AM mudou
    assert not any("/api/parlamentares" in u for u in v2.pedidos if "sapl.al.ro" in u or "sapl.al.ac" in u)
    # (b) rodada forçada (--ibge qualquer): RO e AC e PB relidas em modo incremental
    assert forca.rc == 0 and forca.nao_previstos == []
    assert not any("&ano=" in u for u in forca.pedidos)  # sem varredura por tipo/ano: incremental, não completa
    assert not any("sapl.al.am" in u and "/api/" in u for u in forca.pedidos)  # AM não é 'ok': nem sondada nem carregada
    assert forca.log["revalidada_304"] > forca.log["baixada"]  # o que não mudou volta como 304 (ETag igual ao do v1)
    ro_antes, ro_depois = v1.foto["cont"]["RO"], forca.foto["cont"]["RO"]
    assert ro_depois == {**ro_antes, "sapl_materias": 5, "sapl_autorias": 6}
    # nada apagado: cada contagem de cada casa só cresce (AM e AC ficam iguais)
    for uf in ("RO", "AC", "AM"):
        assert all(forca.foto["cont"][uf][t] >= v1.foto["cont"][uf][t] for t in TABELAS)
    assert forca.foto["cont"]["AM"] == v1.foto["cont"]["AM"] and forca.foto["cont"]["AC"] == v1.foto["cont"]["AC"]
    assert forca.foto["casas"]["AM"]["loaded_at"] == v1.foto["casas"]["AM"]["loaded_at"]


def test_3b_campo_alterado_chega_ao_banco(banco_isolado, tmp_path):
    """Os valores da matéria nova e do parlamentar alterado (v2) vêm do cenário: v1 e depois v2 forçado, só RO, e lê as linhas."""
    url = banco_isolado
    with base(url):
        rodar(url, "v1", tmp_path / "c", tmp_path, "a", ["sapl.ales", *SEM_FILA, "--uf", "RO"])
        r = rodar(url, "v2", tmp_path / "c", tmp_path, "b", ["sapl.ales", *SEM_FILA, "--uf", "RO", *FORCA], refetch=todas_as_entradas_ale())
        assert r.rc == 0 and r.nao_previstos == []
        with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
            mats = {m["sapl_id"]: m["summary"] for m in c.execute("select m.sapl_id, m.summary from sapl_materias m join sapl_houses h on h.id = m.house_id join places p on p.id = h.place_id where p.uf = 'RO'")}
            par = {m["sapl_id"]: (m["nome_parlamentar"], m["ativo"]) for m in c.execute("select m.sapl_id, m.nome_parlamentar, m.ativo from sapl_parlamentares m join sapl_houses h on h.id = m.house_id join places p on p.id = h.place_id where p.uf = 'RO'")}
        assert mats[306] == "Matéria fabricada 3/2026 (RO)" and set(mats) == {301, 302, 303, 304, 306}  # 305 é requerimento: o job só guarda projeto
        assert par[102] == ("Parlamentar Fabricado 2 (RO) [alterado]", False) and par[101] == ("Parlamentar Fabricado 1 (RO)", True)


# ------------------------------------------------------------------ município: descobrir e carregar


def test_4_municipio_descobrir_e_carregar(banco_isolado, tmp_path):
    url, m = banco_isolado, AF.IBGE_MUNICIPIO
    with base(url):
        cache = tmp_path / "c"
        d1 = rodar(url, "v1", cache, tmp_path, "d1", ["sapl.descobrir", "--ibge", m])
        assert d1.rc == 0 and d1.nao_previstos == []
        casa = d1.foto["casas"][m]
        assert (casa["status"], casa["base_url"], casa["registry_status"], casa["registry_url"]) == ("ok", AF.HOST_MUNICIPIO, "Funcionando", AF.URL_REGISTRO)
        assert list(d1.foto["casas"]) == [m] and d1.foto["cont"] == {} and d1.foto["cob"] == {}  # descobrir não carrega
        c1 = rodar(url, "v1", cache, tmp_path, "c1", ["sapl.carregar", "--ibge", m])
        assert c1.rc == 0 and c1.nao_previstos == []
        f = c1.foto
        assert f["casas"][m]["last_outcome"] == "carregada" and f["cont"][m] == CARGA_MUN
        assert f["cob"][m] == {"propostas": "carregando", "presenca": "carregando", "votos": "carregando"}
        assert {x["dataset"] for x in f["runs"]} == set(f["stamps"]) == {"sapl.descoberta", f"sapl.{m}"}
        assert f["fontes"] == ["sapl"]  # a fonte do município é a do seed; `sapl-ale` não nasce sem sapl.ales
        # v2: a página do registro passa a apontar outro SAPL (http:// no HTML; o job troca por https://); base_url muda, o id da casa não
        id_casa = f["casas"][m]["id"]
        d2 = rodar(url, "v2", cache, tmp_path, "d2", ["sapl.descobrir", "--ibge", m], refetch=[AF.URL_REGISTRO])
        assert d2.rc == 0 and d2.nao_previstos == []
        assert d2.foto["casas"][m]["base_url"] == AF.HOST_MUNICIPIO_V2 and d2.foto["casas"][m]["status"] == "ok" and d2.foto["casas"][m]["id"] == id_casa
        assert d2.foto["cont"][m] == CARGA_MUN  # trocar a URL não apaga o que foi carregado
        # e carregar de novo, agora do endereço novo (as respostas dos dois hosts existem no v2): incremental, mesmas contagens
        c2 = rodar(url, "v2", cache, tmp_path, "c2", ["sapl.carregar", "--ibge", m])
        assert c2.rc == 0 and c2.nao_previstos == [] and c2.foto["cont"][m] == CARGA_MUN
        assert all(u.startswith(AF.HOST_MUNICIPIO_V2) for u in c2.pedidos)


# ------------------------------------------------------------------ falhas


def test_5_cenario_falhas(banco_isolado, tmp_path):
    url = banco_isolado
    with base(url):
        cache = tmp_path / "c"
        a = rodar(url, "falhas", cache, tmp_path, "a", ["sapl.ales", *SEM_FILA])
        assert a.nao_previstos == []
        casas = a.foto["casas"]
        assert status_das_casas(a.foto) == AF.STATUS_ALE["falhas"]
        # RO: 403 em /api/ -> HTTPStatusError (http.fetch retenta 4xx também, 5 tentativas) -> fora_do_ar
        assert casas["RO"]["note"].startswith("HTTPStatusError: Client error '403 Forbidden'")
        # AC: ReadTimeout (5 tentativas) -> fora_do_ar
        assert casas["AC"]["note"].startswith("ReadTimeout")
        # AM: 200 com corpo vazio -> JSONDecodeError -> fora_do_ar (e o corpo vazio FICA no cache)
        assert casas["AM"]["note"].startswith("JSONDecodeError")
        for uf, resp in (("RO", 403), ("AC", "ReadTimeout")):
            assert [s for u, s in a.respostas if u == AF.ALE_HOSTS[uf] + "/api/"] == [resp] * 5
        # PI: descoberta ok, mas a primeira leitura da carga (legislatura) dá 500 -> `falhou`, fail_count 1, retry_after, saída 1
        assert (casas["PI"]["last_outcome"], casas["PI"]["fail_count"], casas["PI"]["tem_retry"], casas["PI"]["loaded_at"]) == ("falhou", 1, True, None)
        assert casas["PI"]["note"].startswith("carga falhou em ") and "(falha 1 seguida): 500" in casas["PI"]["note"]
        assert a.rc == 1
        assert [x["dataset"] for x in a.foto["runs"] if x["dataset"] != "sapl-ale.descoberta"] == ["sapl-ale.pb"]  # a falha da PI ocorre antes de abrir run
        assert a.foto["cont"]["PB"] == CARGA_RO and "PI" not in a.foto["cont"]
        # motivos no registro de tentativas: 403 bloqueio, timeout expiracao, corpo vazio sem_conteudo, 500 erro
        assert {k: v for k, v in a.log.items() if k.startswith("falha")} == {"falha/bloqueio": 1, "falha/expiracao": 1, "falha/sem_conteudo": 1, "falha/erro": 1}
        # segunda rodada: PI está em backoff (retry_after no futuro), AM sai do cache vazio, RO e AC são sondadas de novo; saída 0
        b = rodar(url, "falhas", cache, tmp_path, "b", ["sapl.ales", *SEM_FILA])
        assert b.rc == 0 and b.nao_previstos == []
        assert b.pedidos == [AF.ALE_HOSTS["RO"] + "/api/"] * 5 + [AF.ALE_HOSTS["AC"] + "/api/"] * 5
        assert b.foto["casas"]["PI"]["fail_count"] == 1 and b.foto["casas"]["PI"]["last_outcome"] == "falhou"
        assert status_das_casas(b.foto) == AF.STATUS_ALE["falhas"]


# ------------------------------------------------------------------ lançador


def _env_sub(url: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in ("ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH", "ADMIN_RUNNER")}
    env.update(ETL_DATABASE_URL=url, DATABASE_URL=url, PYTHONPATH=str(ETL_DIR), ETL_RAW_STORE="off")
    return env


def _simulado(argv: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "tests/simulado.py", *argv], cwd=ETL_DIR, env=env, capture_output=True, text=True, timeout=120)


def test_6_lancador_em_subprocesso(banco_isolado, tmp_path):
    url = banco_isolado
    banner = simulado.banner("v1")
    assert banner == "SIMULADO: respostas fabricadas de etl/tests/fixtures/sapl_ale/v1 (nenhuma requisição de rede)"
    with base(url):
        p = _simulado(["--cenario", "v1", "--cache-dir", str(tmp_path / "c"), "--", "sapl.ales", *SEM_FILA], _env_sub(url))
        assert p.returncode == 0, p.stderr[-2000:]
        assert p.stdout.splitlines()[0] == banner and p.stderr.splitlines()[0] == banner
        assert re.search(r"^SIMULADO: \d+ URLs pedidas, 0 não previstas$", p.stderr, re.M)
        f = foto(url)
        assert status_das_casas(f) == AF.STATUS_ALE["v1"] and contagens(f, ("RO", "AC", "AM")) == CARGA_V1  # as mesmas tabelas do caso 1
        # a CLI real de administração roda no mesmo processo (ADMIN_RUNNER=processo), sobre o que acabou de ser carregado
        q = _simulado(["--cenario", "v1", "--cache-dir", str(tmp_path / "c"), "--", "admin", "inventario", "--json"], _env_sub(url))
        assert q.returncode == 0, q.stderr[-2000:]
        assert q.stdout.splitlines()[0] == banner
        doc = json.loads("\n".join(q.stdout.splitlines()[1:]))
        assert isinstance(doc, list) and doc
        # URL fora do mapa: sem --tolerante a execução cai com 3 no fim (o job engole o AssertionError); com --tolerante responde 404 e segue
        r = _simulado(["--cenario", "falhas", "--cache-dir", str(tmp_path / "d"), "--", "sapl.descobrir", "--ibge", AF.IBGE_MUNICIPIO], _env_sub(url))
        assert r.returncode == 3 and "não prevista no mapa" in r.stderr and AF.URL_REGISTRO in r.stderr
        s = _simulado(["--cenario", "falhas", "--cache-dir", str(tmp_path / "e"), "--tolerante", "--", "sapl.descobrir", "--ibge", AF.IBGE_MUNICIPIO], _env_sub(url))
        assert s.returncode == 0 and re.search(r"^SIMULADO: 1 URLs pedidas, 1 não previstas$", s.stderr, re.M)


def test_6b_lancador_recusa_sem_conectar(tmp_path):
    banner = simulado.banner("v1")
    casos = {
        "banco civico": ("postgres://postgres@localhost:1/civico", "civico"),  # porta 1: nada escuta; se tentasse conectar, o erro seria outro
        "host nao local": ("postgres://usuario@db.fabricado.invalid:1/banco_x", "não é local"),
        "sem nome de banco": ("postgres://postgres@localhost:1/", "não nomeia um banco"),
    }
    for nome, (u, trecho) in casos.items():
        p = _simulado(["--cenario", "v1", "--cache-dir", str(tmp_path / "c"), "--", "sapl.ales"], _env_sub(u))
        assert p.returncode == 2, (nome, p.stderr)
        assert p.stdout.splitlines()[0] == banner and p.stderr.splitlines()[0] == banner
        assert "recusado" in p.stderr and trecho in p.stderr, (nome, p.stderr)
        assert "connection" not in p.stderr.lower() and "SIMULADO:" in p.stderr and "URLs pedidas" not in p.stderr  # recusou antes de qualquer pedido ou conexão
    env = _env_sub("x")
    env.pop("ETL_DATABASE_URL")
    p = _simulado(["--cenario", "v1", "--", "sapl.ales"], env)
    assert p.returncode == 2 and "ETL_DATABASE_URL não está definida" in p.stderr
    assert simulado.recusa_banco("postgres:///banco_x?host=/tmp/socket") is None and simulado.recusa_banco("postgres://u@[::1]:5432/banco_x") is None
    assert "não é local" in simulado.recusa_banco("postgres:///banco_x?host=db.remoto.invalid")


# ------------------------------------------------------------------ URLs de entrada


def test_7_entradas_declaradas_batem_com_o_job(banco_isolado, tmp_path):
    url = banco_isolado
    for cen in ("v1", "v2", "falhas"):
        with base(url):
            r = rodar(url, cen, tmp_path / f"ales-{cen}", tmp_path, f"ales-{cen}", ["sapl.ales", *SEM_FILA])
            esp = AF.entradas("sapl.ales", cen)
            assert AF.sem_repeticao(r.pedidos)[: len(esp)] == esp, cen
            assert r.nao_previstos == []
    m = AF.IBGE_MUNICIPIO
    for cen in ("v1", "v2"):
        with base(url):
            d = rodar(url, cen, tmp_path / f"d-{cen}", tmp_path, f"d-{cen}", ["sapl.descobrir", "--ibge", m])
            esp = AF.entradas("sapl.descobrir", cen)
            assert AF.sem_repeticao(d.pedidos)[: len(esp)] == esp and d.pedidos == esp, cen
            c = rodar(url, cen, tmp_path / f"c-{cen}", tmp_path, f"c-{cen}", ["sapl.carregar", "--ibge", m])  # cache vazio: robots.txt volta a ser pedido
            esp = AF.entradas("sapl.carregar", cen)
            assert c.pedidos[: len(esp)] == esp and c.nao_previstos == [], cen


# ------------------------------------------------------------------ a fixture em si


def test_8_constantes_e_marcas(tmp_path):
    assert AF.ALE_HOSTS == sapl.ALE_SAPL and tuple(sapl.ALE_SAPL) == AF.UFS  # a ordem de ALE_SAPL é a ordem em que sapl.ales sonda
    assert AF.REGISTRO == sapl.REGISTRY
    for cen in AF.CENARIOS:
        pasta = AF.SAPL_ALE / cen
        mapa = json.loads((pasta / "mapa.json").read_text(encoding="utf-8"))
        assert mapa["_origem"] == AF.MARCA and mapa["cenario"] == cen
        for u, e in mapa["respostas"].items():
            if "arquivo" in e:
                assert (pasta / e["arquivo"]).resolve().is_file(), (cen, u)
        for c in mapa["curingas"]:
            assert (pasta / c["arquivo"]).resolve().is_file()
    for arq in AF.SAPL_ALE.rglob("*"):
        if arq.is_file() and arq.name not in ("mapa.json", "corpo_vazio.txt", "_gerar.py", "LEIA-ME.md"):
            texto = arq.read_text(encoding="utf-8")
            if arq.suffix == ".json":
                assert json.loads(texto)["_origem"] == AF.MARCA, arq
            else:
                assert AF.MARCA in texto, arq
    leia = (AF.SAPL_ALE / "LEIA-ME.md").read_text(encoding="utf-8")
    assert AF.MARCA in leia.splitlines()[0] and "simulado" in leia.lower()
    # o município não colide com nenhum código real conhecido do repositório
    geo = ETL_DIR.parent / "web" / "public" / "geo" / "uf"
    assert geo.is_dir() and not any(AF.IBGE_MUNICIPIO in g.read_text(encoding="utf-8") for g in geo.glob("*.json"))
    # tamanho: dezenas de KB de resposta, no máximo
    assert sum(f.stat().st_size for f in AF.SAPL_ALE.rglob("*") if f.is_file()) < 400_000


def test_8b_base_idempotente_e_reversivel(banco_isolado):
    url = banco_isolado

    def n() -> tuple:
        with psycopg.connect(url, autocommit=True) as c:
            return tuple(c.execute(f"select count(*) from {t}").fetchone()[0] for t in ("places", "legislative_bodies", "sources", "ingest_runs", "dataset_stamps", "sapl_houses", "data_coverage"))

    AF.limpar_base(url)
    inicio = n()
    try:
        AF.carregar_base(url)
        depois = n()
        AF.carregar_base(url)  # idempotente
        assert n() == depois
        assert depois[0] == inicio[0] + 1 and depois[1] == inicio[1] + 6  # o município; cinco Assembleias e a Câmara Municipal
    finally:
        AF.limpar_base(url)
    assert n() == inicio


# ------------------------------------------------------------------ o transporte


def _cliente(cen: str, estrito: bool = True):
    t = AF.transporte(cen, estrito=estrito)
    return t, httpx.Client(transport=t, trust_env=False)


def test_9_transporte_etag_304_excecao_e_url_nao_prevista():
    t, c = _cliente("v1")
    u = AF.ALE_HOSTS["RO"] + "/api/"
    r = c.get(u)
    assert r.status_code == 200 and r.headers["etag"] and r.json()["_origem"] == AF.MARCA
    r2 = c.get(u, headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304 and r2.content == b""
    assert c.get(u, headers={"If-None-Match": '"outra"'}).status_code == 200
    assert c.get(AF.ALE_HOSTS["PB"] + "/api/").status_code == 500
    # curinga: ano sem matéria devolve página vazia, em qualquer ano
    for ano in (2023, 2031):
        assert c.get(f"{AF.ALE_HOSTS['RO']}/api/materia/materialegislativa/?tipo=2&ano={ano}&page_size=100&page=1").json()["results"] == []
    with pytest.raises(AssertionError, match="https://sapl.al.ro.leg.br/api/outra/"):
        c.get(AF.ALE_HOSTS["RO"] + "/api/outra/")
    assert t.nao_previstos == [AF.ALE_HOSTS["RO"] + "/api/outra/"] and t.pedidos[0] == u and len(t.pedidos) == len(t.respostas)
    tf, cf = _cliente("falhas")
    with pytest.raises(httpx.ReadTimeout):
        cf.get(AF.ALE_HOSTS["AC"] + "/api/")
    assert cf.get(AF.ALE_HOSTS["AM"] + "/api/").content == b""
    assert cf.get(AF.ALE_HOSTS["RO"] + "/api/").status_code == 403
    tt, ct = _cliente("v1", estrito=False)
    assert ct.get("https://nao.previsto.invalid/x").status_code == 404 and tt.nao_previstos == ["https://nao.previsto.invalid/x"]
    with pytest.raises(AssertionError, match="só GET"):
        c.post(u)


def test_9b_instalar_isola_o_estado(tmp_path):
    from civico_etl import http as H
    from civico_etl.jobs import assembleias

    antes = (H._client, H.CACHE_DIR, H.RATE, H.time, assembleias._robots)
    with pytest.MonkeyPatch.context() as mp:
        t = AF.instalar(mp, "v1", tmp_path / "c")
        assert H.CACHE_DIR == tmp_path / "c" and H.RATE == 1e9 and H.time is not antes[3] and assembleias._robots == {}
        H.time.sleep(3600)  # sem espera
        assert H.fetch(AF.ALE_HOSTS["RO"] + "/robots.txt").text().startswith("# FABRICADO")
        assert t.pedidos == [AF.ALE_HOSTS["RO"] + "/robots.txt"]
        with pytest.raises(AssertionError, match="rede bloqueada"):
            httpx.Client(trust_env=False, verify=False).get("https://example.invalid/")  # verify=False: nem carrega o certifi
    assert (H._client, H.CACHE_DIR, H.RATE, H.time, assembleias._robots) == antes
