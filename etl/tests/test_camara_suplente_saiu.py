"""BUG-050: suplente que deixou o exercício tem o mandato `suplente_em_exercicio` encerrado (Câmara com 514 em exercício).

Caso real: Leonardo Gadelha (PB, id 122195) entrou em 2026-07-09; em 2026-11-06 a Câmara passou a listá-lo na legislatura 57 com
condicaoEleitoral "Suplente" e situacao "Suplência". O `_deputies` fazia `continue` nesse ramo e o mandato gravado num run
anterior ficava `em_exercicio` para sempre.

Roda `_deputies` de verdade com a API da Câmara e o `db.run` trocados por dublês (sem rede, sem commit), numa transação
revertida. Ids da Câmara falsos (99xxxxxxx) e pessoas `zz-teste-bug050-*`: não supõe banco vazio nem colide com carga.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

import pytest

from civico_etl.db import Run
from civico_etl.jobs import camara_diario as cd

LEG = 57
START, END = cd.LEGISLATURES[LEG]
ENTROU = date(2026, 7, 9)
SAIU = date(2026, 11, 6)
HOJE = date(2026, 11, 11)  # congelado (cd._today): o teste não quebra quando a legislatura 57 acabar


class _Rollback(Exception):
    pass


class Camara:
    """Dublê da API: listagem da legislatura + detalhe /deputados/{id}."""

    def __init__(self) -> None:
        self.listing: list[int] = []
        self.dados: dict[int, dict] = {}

    def status(self, dep: int, *, situacao: str, condicao: str, data: date | None, uf: str = "PB") -> None:
        self.dados[dep] = {"id": dep, "ultimoStatus": {"situacao": situacao, "condicaoEleitoral": condicao, "siglaUf": uf,
                                                       "siglaPartido": None, "data": data.isoformat() if data else None}}
        if dep not in self.listing:
            self.listing.append(dep)


@pytest.fixture
def h(conn, monkeypatch):
    """Ambiente do teste: transação revertida, dublês e atalhos."""
    api = Camara()
    runs: list[Run] = []

    @contextmanager
    def fake_run(c, dataset, source, **kw):
        r = Run(c, dataset, source)
        runs.append(r)
        yield r

    monkeypatch.setattr(cd, "run", fake_run)
    monkeypatch.setattr(cd, "_today", lambda: HOJE, raising=False)  # raising=False: a suite roda (e falha pelo comportamento) sem a correção
    monkeypatch.setattr(cd, "paginate_camara", lambda url, **kw: iter([{"id": i} for i in api.listing]))
    monkeypatch.setattr(cd, "fetch_json", lambda url, **kw: {"dados": api.dados[int(url.rstrip("/").rsplit("/", 1)[-1])]})

    class H:
        pass

    x = H()
    x.api, x.runs, x.conn, x.mp = api, runs, conn, monkeypatch
    x.falha = set()  # ids cujo detalhe dá LookupError (identidade ambígua)
    pids: dict[str, str] = {}
    src = conn.execute("select id from sources where slug = 'camara'").fetchone()["id"]

    def pessoa(dep: int, tag: str) -> str:
        pid = str(conn.execute("insert into people (slug, display_name) values (%s, %s) returning id",
                               (f"zz-teste-bug050-{tag}", f"Teste BUG-050 {tag}")).fetchone()["id"])
        conn.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, %s, 'exact_id', 1)",
                     (pid, src, str(dep)))
        pids[str(dep)] = pid
        return pid

    def ensure(d, create=True):
        if d["id"] in x.falha:
            raise LookupError(f"deputado {d['id']} ambíguo")
        return pids[str(d["id"])]

    def rodar(limit: int | None = None) -> Run:
        ctx = cd._Ctx(conn)
        ctx.ensure = ensure
        cd._deputies(conn, ctx, LEG, limit, force=False)
        return runs[-1]

    def mandatos(pid: str) -> list[dict]:
        return conn.execute("select role, status, status_source, started_on, ends_on from mandates where person_id = %s order by started_on", (pid,)).fetchall()

    x.pessoa, x.rodar, x.mandatos = pessoa, rodar, mandatos
    with pytest.raises(_Rollback):
        with conn.transaction():
            yield x
            raise _Rollback


def _so(r: Run, trecho: str) -> list[str]:
    return [n for n in r.notes if trecho in n]


def test_suplente_listado_fora_do_exercicio_e_encerrado_na_data_da_camara(h):
    """(a) Caso Gadelha: em exercício num run, "Suplência" no seguinte -> encerrado em ultimoStatus.data; a linha continua."""
    pid = h.pessoa(990000501, "a")
    h.api.status(990000501, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    assert [(m["role"], m["status"], m["started_on"], m["ends_on"]) for m in h.mandatos(pid)] == [("suplente_em_exercicio", "em_exercicio", ENTROU, END)]

    h.api.status(990000501, situacao="Suplência", condicao="Suplente", data=SAIU)
    r = h.rodar()
    ms = h.mandatos(pid)
    assert len(ms) == 1  # nunca apaga linha
    assert (ms[0]["status"], ms[0]["status_source"], ms[0]["started_on"], ms[0]["ends_on"]) == ("encerrado", "camara", ENTROU, SAIU)
    # observabilidade: quem foi encerrado, com id da Câmara, status e data, no topo das notas (fora do limite MAX_NOTES)
    assert r.notes[0] == "1 suplente(s) fora do exercício encerrado(s) (fora de rows_upserted): zz-teste-bug050-a [camara 990000501] (encerrado, 2026-11-06)"
    assert not r.partial_why

    h.rodar()  # idempotente: o fim não anda no run seguinte
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("encerrado", SAIU)]


def test_nota_de_encerrados_sobrevive_ao_limite_de_notas(h):
    pid = h.pessoa(990000507, "muitas-notas")
    h.api.status(990000507, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000507, situacao="Suplência", condicao="Suplente", data=SAIU)
    orig = cd.close_suplentes

    def cheio(conn, ctx, r, *a, **kw):
        for i in range(60):
            r.reject(1, f"rejeição {i}")  # 60 > MAX_NOTES: r.note passa a descartar
        return orig(conn, ctx, r, *a, **kw)

    h.mp.setattr(cd, "close_suplentes", cheio)
    r = h.rodar()
    assert [m["status"] for m in h.mandatos(pid)] == ["encerrado"]
    assert "zz-teste-bug050-muitas-notas [camara 990000507] (encerrado, 2026-11-06)" in r.notes[0]


@pytest.mark.parametrize("situacao, status", [("Fim de Mandato", "encerrado"), ("Vacância", "encerrado"), ("Renúncia", "renunciou"), ("Cassado", "cassado")])
def test_status_de_saida_segue_o_mapa_da_camara(h, situacao, status):
    """O encerramento usa o STATUS do módulo (mesmo mapa do titular): renúncia e cassação não viram "encerrado" genérico."""
    pid = h.pessoa(990000506, f"mapa-{status}-{situacao[:3]}")
    h.api.status(990000506, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000506, situacao=situacao, condicao="Suplente", data=SAIU)
    h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [(status, SAIU)]


def test_suplente_sem_data_na_fonte_encerra_hoje_e_anota_que_a_data_nao_veio_da_fonte(h):
    pid = h.pessoa(990000502, "sem-data")
    h.api.status(990000502, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000502, situacao="Suplência", condicao="Suplente", data=None)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("encerrado", HOJE)]
    assert _so(r, "sem ultimoStatus.data") == [
        "1 suplente(s) fora do exercício sem ultimoStatus.data na Câmara: fim = data de hoje, que NÃO veio da fonte: zz-teste-bug050-sem-data [camara 990000502]"]


def test_data_da_fonte_anterior_ao_inicio_nao_encerra_e_anota(h):
    """ultimoStatus.data também muda com troca de partido: data antes do início não vira mandato de um dia inventado."""
    pid = h.pessoa(990000503, "antes")
    h.api.status(990000503, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    antes = ENTROU - timedelta(days=30)
    h.api.status(990000503, situacao="Fim de Mandato", condicao="Suplente", data=antes)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    assert _so(r, "anterior ao início") == [
        f"1 suplente(s) fora do exercício com data da fonte anterior ao início do mandato: não encerrado(s): zz-teste-bug050-antes [camara 990000503] (fonte {antes}, início {ENTROU})"]


def test_data_da_fonte_depois_de_hoje_e_presa_em_hoje(h):
    pid = h.pessoa(990000504, "depois")
    h.api.status(990000504, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000504, situacao="Suplência", condicao="Suplente", data=HOJE + timedelta(days=30))
    h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("encerrado", HOJE)]


def test_mandato_que_comecou_hoje_nao_e_encerrado_e_anota(h):
    """fim > início e "nunca depois de hoje" não cabem juntos: não mexe e deixa nota no run."""
    pid = h.pessoa(990000505, "hoje")
    h.api.status(990000505, situacao="Exercício", condicao="Suplente", data=HOJE)
    h.rodar()
    h.api.status(990000505, situacao="Suplência", condicao="Suplente", data=HOJE)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    assert _so(r, "iniciado hoje") == ["1 suplente(s) fora do exercício com mandato iniciado hoje: não encerrado(s): zz-teste-bug050-hoje [camara 990000505]"]


def test_titular_licenciado_com_suplente_em_exercicio_nao_e_tocado(h):
    """(b) O titular licenciado e o suplente que o substitui seguem como estão; só o outro suplente (que saiu) é encerrado."""
    tit, sup, saiu = h.pessoa(990000511, "titular"), h.pessoa(990000512, "suplente"), h.pessoa(990000513, "saiu")
    h.api.status(990000511, situacao="Licença", condicao="Titular", data=ENTROU)
    h.api.status(990000512, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.api.status(990000513, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000513, situacao="Suplência", condicao="Suplente", data=SAIU)
    h.rodar()
    assert [(m["role"], m["status"], m["started_on"], m["ends_on"]) for m in h.mandatos(tit)] == [("titular", "licenciado", START, END)]
    assert [(m["role"], m["status"], m["started_on"], m["ends_on"]) for m in h.mandatos(sup)] == [("suplente_em_exercicio", "em_exercicio", ENTROU, END)]
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(saiu)] == [("encerrado", SAIU)]


def test_suplente_em_exercicio_com_detalhe_ambiguo_nao_e_encerrado(h):
    """O detalhe /deputados/{id} dá LookupError (identidade ambígua): o run rejeita a linha, mas não encerra o mandato."""
    pid = h.pessoa(990000514, "ambiguo")
    h.api.status(990000514, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.falha.add(990000514)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    assert r.rows_rejected == 1 and not r.partial_why


def test_suplente_que_volta_abre_mandato_novo_sem_sobrepor(h):
    """(c) Saiu em SAIU e voltou depois: o encerrado fica no histórico e o novo mandato começa na volta."""
    pid = h.pessoa(990000521, "volta")
    volta = SAIU + timedelta(days=2)
    h.api.status(990000521, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000521, situacao="Suplência", condicao="Suplente", data=SAIU)
    h.rodar()
    h.api.status(990000521, situacao="Exercício", condicao="Suplente", data=volta)
    h.rodar()
    assert [(m["status"], m["started_on"], m["ends_on"]) for m in h.mandatos(pid)] == [
        ("encerrado", ENTROU, SAIU), ("em_exercicio", volta, END)]


@pytest.mark.parametrize("data_volta", [ENTROU, None], ids=["data-velha", "sem-data"])
def test_volta_com_data_velha_ou_sem_data_comeca_no_fim_do_encerrado(h, data_volta):
    """(c) A fonte devolve a data antiga (ou nenhuma: início = início da legislatura) na volta: não reabre o encerrado com
    fim no passado, não sobrepõe e não derruba o run; o novo começa no fim do encerrado ([) encosta)."""
    pid = h.pessoa(990000522, f"volta-{data_volta or 'sem-data'}")
    h.api.status(990000522, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000522, situacao="Suplência", condicao="Suplente", data=SAIU)
    h.rodar()
    h.api.status(990000522, situacao="Exercício", condicao="Suplente", data=data_volta)
    h.rodar()
    ms = h.mandatos(pid)
    assert [(m["status"], m["started_on"], m["ends_on"]) for m in ms] == [("encerrado", ENTROU, SAIU), ("em_exercicio", SAIU, END)]
    h.rodar()  # o run seguinte reaproveita o aberto, não cria terceiro
    assert len(h.mandatos(pid)) == 2


@pytest.mark.parametrize("caso", ["completa", "vazia", "limit"])
def test_suplente_ausente_da_listagem_nunca_e_encerrado_e_anota(h, caso):
    """(d) A listagem da legislatura traz todo mundo que passou por ela: ausência é anomalia da fonte, não saída.
    Nada muda, em nenhum formato de listagem, e o run anota quem está aberto e ausente."""
    a, b = h.pessoa(990000541, f"ausente-{caso}-a"), h.pessoa(990000542, f"ausente-{caso}-b")
    for dep in (990000541, 990000542):
        h.api.status(dep, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    if caso == "completa":
        h.api.listing.remove(990000542)
        r = h.rodar()
    elif caso == "vazia":
        h.api.listing.clear()
        r = h.rodar()
    else:
        r = h.rodar(limit=1)
    for pid in (a, b):
        assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    nota = _so(r, "ausente(s) da listagem")
    assert len(nota) == 1
    assert "suplente(s) com mandato aberto ausente(s) da listagem da legislatura: não encerrado(s): " in nota[0]
    assert f"zz-teste-bug050-ausente-{caso}-b [camara 990000542]" in nota[0]
    assert not _so(r, "(fora de rows_upserted)")


def _saem(h, n: int, tag: str) -> list[str]:
    deps = [990000600 + i for i in range(n)]
    pids = [h.pessoa(d, f"teto-{tag}-{i}") for i, d in enumerate(deps)]
    for d in deps:
        h.api.status(d, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    for d in deps:
        h.api.status(d, situacao="Suplência", condicao="Suplente", data=SAIU)
    return pids


def test_teto_no_limite_encerra_todos(h):
    pids = _saem(h, cd.MAX_CLOSE, "no-limite")
    r = h.rodar()
    assert all([m["status"] for m in h.mandatos(p)] == ["encerrado"] for p in pids)
    assert not r.partial_why
    assert r.notes[0].startswith(f"{cd.MAX_CLOSE} suplente(s) fora do exercício encerrado(s)")


def test_teto_estourado_nao_encerra_ninguem_e_marca_parcial(h):
    pids = _saem(h, cd.MAX_CLOSE + 1, "acima")
    r = h.rodar()
    assert all([(m["status"], m["ends_on"]) for m in h.mandatos(p)] == [("em_exercicio", END)] for p in pids)
    assert len(r.partial_why) == 1
    assert r.partial_why[0].startswith(f"{cd.MAX_CLOSE + 1} suplentes a encerrar acima do teto de {cd.MAX_CLOSE}: nenhum encerrado; conferir a fonte: ")
    assert not _so(r, "(fora de rows_upserted)")


def test_falha_no_encerramento_preserva_o_upsert_e_marca_parcial(h):
    """Isolamento: exceção dentro de close_suplentes desfaz só o savepoint dele; o upsert do run fica e o run fecha parcial."""
    novo, saiu = h.pessoa(990000551, "falha-novo"), h.pessoa(990000552, "falha-saiu")
    h.api.status(990000552, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000551, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.api.status(990000552, situacao="Suplência", condicao="Suplente", data=SAIU)
    orig = cd.close_suplentes

    def quebra(conn, *a, **kw):
        orig(conn, *a, **kw)  # chega a gravar o encerramento...
        conn.execute("select 1/0")  # ...e falha depois: o savepoint desfaz

    h.mp.setattr(cd, "close_suplentes", quebra)
    r = h.rodar()
    assert [m["status"] for m in h.mandatos(novo)] == ["em_exercicio"]  # upsert do mesmo run preservado
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(saiu)] == [("em_exercicio", END)]  # nada encerrado
    assert len(r.partial_why) == 1
    assert r.partial_why[0].startswith("encerramento de suplentes (BUG-050) falhou, nenhum encerrado: DivisionByZero")
    assert not _so(r, "(fora de rows_upserted)")  # a nota dos encerramentos desfeitos não fica
