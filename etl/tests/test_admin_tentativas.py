"""A2: registro de tentativas em `http.fetch` (ETL_ATTEMPT_LOG, ETL_HTTP_OFFLINE, ETL_HTTP_REFETCH) e `admin.tentativas.importar`.

Sem rede: `httpx.MockTransport` no lugar do cliente. Tudo que comita usa o banco isolado e limpa em `finally`;
nada é gravado no banco da suíte (os testes comparam as contagens de adm_tentativas e adm_evidencias antes e depois).
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from psycopg.rows import dict_row

from civico_etl import http as H
from civico_etl.admin import tentativas as T
from civico_etl.db import run
from civico_etl.util import sha256_text

URL = "https://fonte.example/dados.json"
ENV = ("ETL_ATTEMPT_LOG", "ETL_HTTP_OFFLINE", "ETL_HTTP_REFETCH")


@pytest.fixture(autouse=True)
def _sem_env(monkeypatch):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(H, "_refetch", None)
    monkeypatch.setattr(H, "_log_avisado", set())


class Rede:
    """Cliente falso com fila de respostas/exceções; cada `usar(dir)` começa do zero com um cache novo."""

    def __init__(self, monkeypatch):
        self.mp = monkeypatch
        self.calls: list[httpx.Request] = []
        self.sleeps: list[float] = []
        self.script: list = []
        monkeypatch.setattr(H.time, "sleep", self.sleeps.append)
        monkeypatch.setattr(H, "RATE", 1e9)

    def usar(self, cache_dir: Path) -> None:
        self.calls.clear()
        self.script.clear()
        self.sleeps.clear()

        def handler(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            nxt = self.script.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt

        self.mp.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
        self.mp.setattr(H, "CACHE_DIR", cache_dir)
        self.mp.setattr(H, "_last_call", {})


@pytest.fixture
def rede(monkeypatch, tmp_path):
    r = Rede(monkeypatch)
    r.usar(tmp_path / "cache")
    return r


# (nome, respostas do preparo [fetch sem log], respostas da chamada observada, kwargs, desfecho, motivo, http_status, retentativas)
R200 = lambda b=b"corpo": httpx.Response(200, content=b, headers={"etag": '"v1"'})  # noqa: E731
CASOS = [
    ("cache_frio", [], [R200()], {}, "baixada", None, 200, 0),
    ("cache_fresco", [R200()], [], {"max_age": 3600}, "cache_fresco", None, None, 0),
    ("revalidada_304", [R200()], [httpx.Response(304)], {}, "revalidada_304", None, 304, 0),
    ("404", [], [httpx.Response(404)], {}, "falha", "erro", 404, 0),
    ("403", [], [httpx.Response(403)] * 2, {"retries": 1}, "falha", "bloqueio", 403, 1),
    ("429_esgotado", [], [httpx.Response(429)] * 2, {"retries": 1}, "falha", "bloqueio", 429, 1),
    ("500_com_retentativa_e_sucesso", [], [httpx.Response(500), R200()], {}, "baixada", None, 200, 1),
    ("500_esgotado", [], [httpx.Response(503)] * 3, {"retries": 2}, "falha", "erro", 503, 2),
    ("timeout", [], [httpx.ReadTimeout("lento")] * 2, {"retries": 1}, "falha", "expiracao", None, 1),
    ("erro_de_rede", [], [httpx.ConnectError("caiu")], {"retries": 0}, "falha", "erro", None, 0),
    ("corpo_vazio", [], [httpx.Response(200, content=b"")], {}, "falha", "sem_conteudo", 200, 0),
]
IDS = [c[0] for c in CASOS]


def executar(rede: Rede, monkeypatch, cache_dir: Path, caso, log: Path | None):
    """Roda o caso num cache próprio. O preparo nunca tem log. Devolve ('ret', ...) ou ('exc', classe, texto) e os cálculos de chamadas."""
    _, preparo, script, kw, *_ = caso
    rede.usar(cache_dir)
    rede.script += preparo
    for _ in preparo:
        H.fetch(URL)
    rede.calls.clear()
    rede.sleeps.clear()
    rede.script += script
    if log is not None:
        monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))
    try:
        try:
            f = H.fetch(URL, **kw)
            out = ("ret", f.status, f.from_cache, f.checksum, f.text())
        except BaseException as e:  # noqa: BLE001
            out = ("exc", type(e).__name__, str(e))
    finally:
        monkeypatch.delenv("ETL_ATTEMPT_LOG", raising=False)
    return out, len(rede.calls), list(rede.sleeps)


def linhas(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text().splitlines()]


# ------------------------------------------------------------------ 1. sem as variáveis


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_sem_variaveis_nada_e_registrado_e_o_resultado_e_o_de_sempre(caso, rede, monkeypatch, tmp_path):
    def nao_deve_registrar(*a, **k):
        raise AssertionError("_registrar chamado sem ETL_ATTEMPT_LOG")

    monkeypatch.setattr(H, "_registrar", nao_deve_registrar)
    monkeypatch.chdir(tmp_path)
    out, n, _ = executar(rede, monkeypatch, tmp_path / "c1", caso, None)
    assert n == len(caso[2])  # toda resposta do roteiro foi consumida, nenhuma a mais
    assert not list(tmp_path.rglob("*.jsonl")) and not list(tmp_path.rglob("*.log"))
    _, _, _, _, desfecho, motivo, _, _ = caso
    esperado_ok = motivo is None or motivo == "sem_conteudo"
    assert (out[0] == "ret") == esperado_ok
    if out[0] == "exc":
        assert out[1] in {"FileNotFoundError", "HTTPStatusError", "ReadTimeout", "ConnectError"}
    assert H._refetch is None


def test_sem_variaveis_comportamento_de_cada_caso_conhecido(rede, monkeypatch, tmp_path):
    """Retornos e exceções de hoje, por caso (a referência contra a qual os testes com log comparam)."""
    obs = {c[0]: executar(rede, monkeypatch, tmp_path / c[0], c, None)[0] for c in CASOS}
    assert obs["cache_frio"][:3] == ("ret", 200, False)
    assert obs["cache_fresco"][:3] == ("ret", 304, True)
    assert obs["revalidada_304"][:3] == ("ret", 304, True)
    assert obs["404"][:2] == ("exc", "FileNotFoundError")
    assert obs["403"][:2] == ("exc", "HTTPStatusError")
    assert obs["timeout"][:2] == ("exc", "ReadTimeout")
    assert obs["500_esgotado"][:2] == ("exc", "HTTPStatusError")
    # corpo vazio: 2xx com corpo vazio é devolvido normalmente (e fica no cache)
    assert obs["corpo_vazio"][:3] == ("ret", 200, False) and obs["corpo_vazio"][4] == ""


# ------------------------------------------------------------------ 2. ETL_ATTEMPT_LOG


@pytest.mark.parametrize("caso", CASOS, ids=IDS)
def test_log_registra_desfecho_e_motivo_sem_mudar_o_retorno(caso, rede, monkeypatch, tmp_path):
    _, _, _, _, desfecho, motivo, status, retent = caso
    sem, n_sem, sl_sem = executar(rede, monkeypatch, tmp_path / "sem", caso, None)
    log = tmp_path / "t.jsonl"
    com, n_com, sl_com = executar(rede, monkeypatch, tmp_path / "com", caso, log)
    assert com == sem and n_com == n_sem and sl_com == sl_sem  # mesmo retorno/exceção, mesmas requisições e esperas
    (rec,) = linhas(log)  # uma chamada de fetch = uma linha, mesmo com retentativas
    assert rec["url"] == URL and rec["desfecho"] == desfecho and rec.get("motivo") == motivo
    assert rec["http_status"] == status and rec["retentativas"] == retent
    assert datetime.fromisoformat(rec["ts"]).utcoffset().total_seconds() == 0
    if desfecho == "falha":
        assert rec["detalhe"] and "http://" not in rec["detalhe"] and "corpo" not in rec["detalhe"].replace("corpo vazio", "")
    if desfecho in ("baixada", "cache_fresco", "revalidada_304"):
        assert rec["sha256"] == com[3] and rec["bytes"] == len(com[4].encode())
    else:
        assert rec["sha256"] is None


def test_log_que_nao_grava_nao_derruba_o_fetch(rede, monkeypatch, tmp_path):
    rede.script.append(R200())
    monkeypatch.setenv("ETL_ATTEMPT_LOG", str(tmp_path / "nao_existe" / "t.jsonl"))
    assert H.fetch(URL).status == 200
    rede.script.append(httpx.Response(404))
    with pytest.raises(FileNotFoundError):  # a exceção original sai intacta
        H.fetch(URL + "?x=1")


def test_escrita_concorrente_8_threads_x_50(rede, monkeypatch, tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 2000)

    monkeypatch.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))
    log = tmp_path / "t.jsonl"
    monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))
    erros: list[BaseException] = []

    def trabalho(t: int) -> None:
        try:
            for i in range(50):
                H.fetch(f"https://fonte.example/t{t}/{i}")
        except BaseException as e:  # noqa: BLE001
            erros.append(e)

    ths = [threading.Thread(target=trabalho, args=(t,)) for t in range(8)]
    [x.start() for x in ths]
    [x.join() for x in ths]
    assert not erros
    recs = linhas(log)
    assert len(recs) == 400 and len({r["url"] for r in recs}) == 400 and {r["desfecho"] for r in recs} == {"baixada"}


# ------------------------------------------------------------------ 3. ETL_HTTP_OFFLINE


def _transporte_proibido(monkeypatch):
    def handler(request):
        raise AssertionError(f"rede tocada em modo offline: {request.url}")

    monkeypatch.setattr(H, "_client", httpx.Client(transport=httpx.MockTransport(handler)))


def test_offline_serve_cache_velho_sem_tocar_a_rede(rede, monkeypatch, tmp_path):
    rede.script.append(R200(b"antigo"))
    a = H.fetch(URL)
    _, meta = H._paths(URL)
    m = json.loads(meta.read_text())
    m["fetched_at"] = 0  # velhíssimo
    meta.write_text(json.dumps(m))
    _transporte_proibido(monkeypatch)
    log = tmp_path / "t.jsonl"
    monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    f = H.fetch(URL, max_age=1)
    assert (f.from_cache, f.checksum, f.text()) == (True, a.checksum, "antigo")
    (rec,) = linhas(log)
    assert rec["desfecho"] == "cache_fresco" and rec["offline"] is True and rec["http_status"] is None and rec["sha256"] == a.checksum


def test_offline_url_ausente_levanta_sem_rede_sem_cache_que_e_systemexit(rede, monkeypatch, tmp_path):
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    with pytest.raises(H.SemRedeSemCache) as ei:
        H.fetch(URL)
    e = ei.value
    assert isinstance(e, SystemExit) and not isinstance(e, Exception) and e.code == 1 and URL in str(e)
    with pytest.raises(H.SemRedeSemCache):
        H.api_json(URL, headers={})
    with pytest.raises(H.SemRedeSemCache):
        H.fetch_json(URL)


def test_offline_com_log_registra_a_ausencia(rede, monkeypatch, tmp_path):
    _transporte_proibido(monkeypatch)
    log = tmp_path / "t.jsonl"
    monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    with pytest.raises(H.SemRedeSemCache):
        H.fetch(URL)
    (rec,) = linhas(log)
    assert (rec["desfecho"], rec["motivo"], rec["detalhe"], rec["offline"]) == ("falha", "erro", "SemRedeSemCache", True)


def test_offline_robots_ausente_levanta_file_not_found(rede, monkeypatch):
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    with pytest.raises(FileNotFoundError):
        H.fetch("https://camara.example/robots.txt", max_age=86400)
    with pytest.raises(H.SemRedeSemCache):
        H.fetch("https://camara.example/robots.txt.bak")


def test_offline_com_assembleias_allowed_igual_a_um_404_real(rede, monkeypatch):
    monkeypatch.setattr(H, "RATE", H.RATE)  # o import de assembleias pode mexer em RATE: o monkeypatch restaura no fim
    from civico_etl.jobs import assembleias as A

    monkeypatch.setattr(A, "_robots", {})
    alvo = "https://camara.example/sessoes/1"
    rede.script.append(httpx.Response(404))
    com_404 = A.allowed(alvo)
    monkeypatch.setattr(A, "_robots", {})
    rede.usar(H.CACHE_DIR.parent / "outro")  # cache novo, sem robots.txt
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    assert A.allowed(alvo) is com_404 is True
    # robots.txt em cache: offline respeita a regra
    monkeypatch.delenv("ETL_HTTP_OFFLINE")
    rede.usar(H.CACHE_DIR.parent / "terceiro")
    rede.script.append(httpx.Response(200, content=b"User-agent: *\nDisallow: /privado\n"))
    monkeypatch.setattr(A, "_robots", {})
    assert A.allowed("https://camara.example/publico") is True
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    monkeypatch.setattr(A, "_robots", {})
    assert A.allowed("https://camara.example/privado/x") is False


def _fonte(c) -> str:
    return c.execute("select slug from sources order by slug limit 1").fetchone()["slug"]


def test_offline_dentro_de_db_run_fecha_o_run_como_failed(rede, monkeypatch, banco_isolado):
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    dataset = "teste.a2.offline"
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    try:
        c.execute("set search_path = public, extensions")
        slug = _fonte(c)
        c.rollback()
        with pytest.raises(H.SemRedeSemCache):
            with run(c, dataset, slug):
                H.fetch(URL)
        rows = c.execute("select status, error from ingest_runs where dataset = %s", (dataset,)).fetchall()
        assert [r["status"] for r in rows] == ["failed"] and "SemRedeSemCache" in rows[0]["error"]
    finally:
        c.rollback()
        c.execute("delete from ingest_runs where dataset = %s", (dataset,))
        c.execute("delete from dataset_stamps where dataset = %s", (dataset,))
        c.commit()
        c.close()


# ------------------------------------------------------------------ 4. ETL_HTTP_REFETCH


def test_refetch_forca_so_as_urls_listadas(rede, monkeypatch, tmp_path):
    outra = "https://fonte.example/outra.json"
    rede.script += [R200(b"a1"), R200(b"b1")]
    H.fetch(URL)
    H.fetch(outra)
    rede.calls.clear()
    lista = tmp_path / "forcar.txt"
    lista.write_text(f"\n{URL}\n")
    monkeypatch.setenv("ETL_HTTP_REFETCH", str(lista))
    rede.script.append(httpx.Response(304))  # a revalidação por ETag continua valendo
    f = H.fetch(URL, max_age=3600)
    assert len(rede.calls) == 1 and rede.calls[0].headers["if-none-match"] == '"v1"' and f.text() == "a1"
    g = H.fetch(outra, max_age=3600)  # não listada: cache fresco, nem toca a rede (o roteiro vazio falharia)
    assert len(rede.calls) == 1 and g.from_cache and g.text() == "b1"


def test_refetch_com_offline_o_offline_vence_e_arquivo_e_relido_se_o_caminho_muda(rede, monkeypatch, tmp_path):
    rede.script.append(R200(b"a1"))
    H.fetch(URL)
    l1, l2 = tmp_path / "l1.txt", tmp_path / "l2.txt"
    l1.write_text("https://nada.example/\n")
    l2.write_text(URL + "\n")
    monkeypatch.setenv("ETL_HTTP_REFETCH", str(l1))
    assert H._refetch_urls() == {"https://nada.example/"}
    monkeypatch.setenv("ETL_HTTP_REFETCH", str(l2))
    assert H._refetch_urls() == {URL}
    _transporte_proibido(monkeypatch)
    monkeypatch.setenv("ETL_HTTP_OFFLINE", "1")
    assert H.fetch(URL, max_age=3600).text() == "a1"
    monkeypatch.setenv("ETL_HTTP_REFETCH", str(tmp_path / "nao_existe.txt"))
    assert H._refetch_urls() == frozenset()  # arquivo ilegível: nada forçado, sem exceção


# ------------------------------------------------------------------ 5 e 6. importar, critério 6


@pytest.fixture
def iso(banco_isolado):
    """Conexão no banco isolado; limpa o que o teste criou, em finally."""
    c = psycopg.connect(banco_isolado, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    c.commit()
    criadas: list[str] = []
    urls: list[str] = []

    def rodada() -> str:
        rid = str(c.execute("insert into adm_rodadas (coletor, modo) values ('teste_a2', 'recoletar') returning id").fetchone()["id"])
        c.commit()
        criadas.append(rid)
        return rid

    c.nova_rodada, c.urls_usadas = rodada, urls  # type: ignore[attr-defined]
    try:
        yield c
    finally:
        c.rollback()
        c.execute("delete from adm_rodadas where id = any(%s::uuid[])", (criadas,))  # cascata leva as tentativas
        c.execute("delete from adm_evidencias where url_sha = any(%s)", ([sha256_text(u) for u in urls],))
        c.commit()
        c.close()


def contagem(c) -> tuple[int, int]:
    r = c.execute("select (select count(*) from adm_tentativas) as t, (select count(*) from adm_evidencias) as e").fetchone()
    return r["t"], r["e"]


def evidencia(c, url: str):
    return c.execute("select * from adm_evidencias where url_sha = %s", (sha256_text(url),)).fetchone()


def tentativas_de(c, rodada: str):
    return c.execute("select * from adm_tentativas where rodada_id = %s order by tentada_em", (rodada,)).fetchall()


def test_criterio_6_falha_grava_motivo_e_nao_apaga_a_ultima_evidencia_valida(rede, monkeypatch, tmp_path, iso, conn):
    suite_antes = contagem(conn)
    url = "https://fonte.example/criterio6.json"
    iso.urls_usadas.append(url)
    r1, r2, r3 = iso.nova_rodada(), iso.nova_rodada(), iso.nova_rodada()
    log1, log2, log3 = (tmp_path / f"r{i}.jsonl" for i in (1, 2, 3))

    def com_log(log: Path):
        monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))

    # rodada 1: leitura com sucesso
    com_log(log1)
    rede.script.append(R200(b"conteudo um"))
    H.fetch(url)
    res1 = T.importar(iso, r1, log1, urls_entrada=[url])
    iso.commit()
    assert (res1.tentadas, res1.lidas, res1.urls_distintas, res1.linhas_ignoradas) == (1, 1, 1, 0)
    ev1 = evidencia(iso, url)
    assert ev1["conteudo_sha256"] == sha256_text("conteudo um") and ev1["rodada_id"].hex == r1.replace("-", "")
    h1, d1 = ev1["conteudo_sha256"], ev1["lida_em"]
    assert [t["entrada"] for t in tentativas_de(iso, r1)] == [True]

    # rodada 2: quatro falhas na mesma URL
    com_log(log2)
    rede.script.append(httpx.Response(403))
    with pytest.raises(httpx.HTTPStatusError):
        H.fetch(url, retries=0)
    rede.script.append(httpx.ReadTimeout("lento"))
    with pytest.raises(httpx.ReadTimeout):
        H.fetch(url, retries=0)
    rede.script.append(httpx.Response(200, content=b""))
    H.fetch(url, retries=0)  # corpo vazio volta normalmente; só o registro o marca como falha
    res2 = T.importar(iso, r2, log2)
    T.registrar_robots(iso, r2, url, datetime.now(timezone.utc))
    iso.commit()
    assert res2.falhas == {"bloqueio": 1, "expiracao": 1, "sem_conteudo": 1} and res2.lidas == res2.reaproveitadas == 0
    assert sorted(t["motivo"] for t in tentativas_de(iso, r2)) == ["bloqueio", "expiracao", "robots", "sem_conteudo"]
    assert {t["resultado"] for t in tentativas_de(iso, r2)} == {"falha"}
    ev2 = evidencia(iso, url)
    assert dict(ev2) == dict(ev1)  # H1, D1 e a rodada de origem, intactos

    # rodada 3: conteúdo novo
    com_log(log3)
    rede.script.append(httpx.Response(200, content=b"conteudo dois", headers={"etag": '"v2"'}))
    H.fetch(url)
    T.importar(iso, r3, log3)
    iso.commit()
    ev3 = evidencia(iso, url)
    assert ev3["conteudo_sha256"] == sha256_text("conteudo dois") != h1 and ev3["lida_em"] > d1 and ev3["rodada_id"].hex == r3.replace("-", "")
    assert [len(tentativas_de(iso, r)) for r in (r1, r2, r3)] == [1, 4, 1]  # histórico preservado
    assert contagem(conn) == suite_antes  # o banco da suíte não recebeu nada


def test_importar_duas_vezes_nao_duplica_e_linha_truncada_e_ignorada(rede, monkeypatch, tmp_path, iso):
    base = [("https://fonte.example/i/%d" % i) for i in range(3)]
    iso.urls_usadas.extend(base)
    rid = iso.nova_rodada()
    log = tmp_path / "t.jsonl"
    monkeypatch.setenv("ETL_ATTEMPT_LOG", str(log))
    rede.script += [R200(b"a"), httpx.Response(200, content=b"b"), httpx.Response(404)]
    for u in base:
        try:
            H.fetch(u)
        except FileNotFoundError:
            pass
    with open(log, "a") as f:
        f.write('{"url": "https://fonte.example/i/9", "ts": "2026-11-15T10:00')  # processo morreu no meio da linha
    antes = contagem(iso)
    r1 = T.importar(iso, rid, log)
    iso.commit()
    depois1 = contagem(iso)
    r2 = T.importar(iso, rid, log)
    iso.commit()
    assert r1 == r2 and (r1.tentadas, r1.lidas, r1.linhas_ignoradas, r1.falhas, r1.urls_distintas) == (3, 2, 1, {"erro": 1}, 3)
    assert depois1 == (antes[0] + 3, antes[1] + 2) and contagem(iso) == depois1  # a segunda importação não inseriu nada
    with pytest.raises(FileNotFoundError):
        T.importar(iso, rid, tmp_path / "ausente.jsonl")
    iso.rollback()


def _l(url, ts, desfecho, sha=None, **extra):
    d = {"url": url, "ts": ts, "desfecho": desfecho, "http_status": 200, "sha256": sha, "bytes": 1, "retentativas": 0, **extra}
    return json.dumps(d)


def test_lida_em_de_reaproveitada_e_importacao_fora_de_ordem(tmp_path, iso):
    url = "https://fonte.example/regra.json"
    iso.urls_usadas.append(url)
    ra, rb, rc = iso.nova_rodada(), iso.nova_rodada(), iso.nova_rodada()
    ha, hb = "a" * 64, "b" * 64

    def importa(rid, *ls):
        p = tmp_path / f"{rid}.jsonl"
        p.write_text("\n".join(ls) + "\n")
        T.importar(iso, rid, p)
        iso.commit()
        return evidencia(iso, url)

    e = importa(ra, _l(url, "2026-11-01T10:00:00+00:00", "baixada", ha))
    assert e["lida_em"] == datetime(2026, 11, 1, 10, tzinfo=timezone.utc)
    e = importa(rb, _l(url, "2026-11-02T10:00:00+00:00", "cache_fresco", ha, http_status=None))
    assert (e["lida_em"].day, e["rodada_id"].hex) == (1, ra.replace("-", ""))  # mesmo hash: mantém a data da leitura real
    e = importa(rc, _l(url, "2026-11-03T10:00:00+00:00", "revalidada_304", hb, http_status=304))
    assert (e["conteudo_sha256"], e["lida_em"].day) == (hb, 3)  # hash diferente: data da tentativa
    e = importa(ra, _l(url, "2026-11-01T10:00:00+00:00", "baixada", ha))  # reimportar a rodada antiga não regride
    assert (e["conteudo_sha256"], e["lida_em"].day) == (hb, 3)
