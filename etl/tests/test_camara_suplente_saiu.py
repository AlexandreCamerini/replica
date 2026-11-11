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
    monkeypatch.setattr(cd, "paginate_camara", lambda url, **kw: iter([{"id": i} for i in api.listing]))
    monkeypatch.setattr(cd, "fetch_json", lambda url, **kw: {"dados": api.dados[int(url.rstrip("/").rsplit("/", 1)[-1])]})

    class H:
        pass

    x = H()
    x.api, x.runs, x.conn = api, runs, conn
    pids: dict[str, str] = {}
    src = conn.execute("select id from sources where slug = 'camara'").fetchone()["id"]

    def pessoa(dep: int, tag: str) -> str:
        pid = str(conn.execute("insert into people (slug, display_name) values (%s, %s) returning id",
                               (f"zz-teste-bug050-{tag}", f"Teste BUG-050 {tag}")).fetchone()["id"])
        conn.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, %s, 'exact_id', 1)",
                     (pid, src, str(dep)))
        pids[str(dep)] = pid
        return pid

    def rodar(limit: int | None = None) -> Run:
        ctx = cd._Ctx(conn)
        ctx.ensure = lambda d, create=True: pids[str(d["id"])]
        cd._deputies(conn, ctx, LEG, limit, force=False)
        return runs[-1]

    def mandatos(pid: str) -> list[dict]:
        return conn.execute("select role, status, status_source, started_on, ends_on from mandates where person_id = %s order by started_on", (pid,)).fetchall()

    x.pessoa, x.rodar, x.mandatos = pessoa, rodar, mandatos
    with pytest.raises(_Rollback):
        with conn.transaction():
            yield x
            raise _Rollback


def _completa(monkeypatch, n: int = 1) -> None:
    """Listagem pequena conta como completa: a trava real (MIN_LISTING) fica para o teste da trava."""
    monkeypatch.setattr(cd, "MIN_LISTING", n)


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
    assert any("zz-teste-bug050-a" in n for n in r.notes)

    h.rodar()  # idempotente: o fim não anda no run seguinte
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("encerrado", SAIU)]


def test_suplente_sem_data_na_fonte_encerra_hoje_e_anota(h):
    pid = h.pessoa(990000502, "sem-data")
    h.api.status(990000502, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000502, situacao="Suplência", condicao="Suplente", data=None)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("encerrado", date.today())]
    assert any("sem data na Câmara" in n for n in r.notes)


def test_data_da_fonte_fora_do_intervalo_e_presa_ao_mandato(h):
    """Data da fonte antes do início vira started_on + 1 (check ends_on > started_on); depois de hoje vira hoje."""
    antes, depois = h.pessoa(990000503, "antes"), h.pessoa(990000504, "depois")
    for dep in (990000503, 990000504):
        h.api.status(dep, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000503, situacao="Fim de Mandato", condicao="Suplente", data=ENTROU - timedelta(days=30))
    h.api.status(990000504, situacao="Suplência", condicao="Suplente", data=date.today() + timedelta(days=30))
    h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(antes)] == [("encerrado", ENTROU + timedelta(days=1))]
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(depois)] == [("encerrado", date.today())]


def test_mandato_que_comecou_hoje_nao_e_encerrado_e_anota(h):
    """started_on + 1 e "nunca depois de hoje" não cabem juntos: não mexe e deixa nota no run."""
    pid = h.pessoa(990000505, "hoje")
    h.api.status(990000505, situacao="Exercício", condicao="Suplente", data=date.today())
    h.rodar()
    h.api.status(990000505, situacao="Suplência", condicao="Suplente", data=date.today())
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    assert any("não encerrado" in n for n in r.notes)


def test_titular_licenciado_com_suplente_em_exercicio_nao_e_tocado(h, monkeypatch):
    """(b) O titular licenciado e o suplente que o substitui seguem como estão; só o outro suplente (que saiu) é encerrado."""
    _completa(monkeypatch)
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


def test_volta_com_data_dentro_do_mandato_encerrado_comeca_no_fim_dele(h):
    """(c) A fonte devolve a data antiga na volta: não reabre o encerrado com fim no passado; o novo começa no fim dele ([) encosta)."""
    pid = h.pessoa(990000522, "volta-data-velha")
    h.api.status(990000522, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.status(990000522, situacao="Suplência", condicao="Suplente", data=SAIU)
    h.rodar()
    h.api.status(990000522, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    ms = h.mandatos(pid)
    assert [(m["status"], m["started_on"], m["ends_on"]) for m in ms] == [("encerrado", ENTROU, SAIU), ("em_exercicio", SAIU, END)]
    h.rodar()  # o run seguinte reaproveita o aberto, não cria terceiro
    assert len(h.mandatos(pid)) == 2


def test_suplente_ausente_da_listagem_completa_e_encerrado(h, monkeypatch):
    """Controle positivo da trava: listagem completa sem o suplente -> encerrado com a data de hoje e nota."""
    _completa(monkeypatch)
    fica, sumiu = h.pessoa(990000531, "fica"), h.pessoa(990000532, "sumiu")
    for dep in (990000531, 990000532):
        h.api.status(dep, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    h.api.listing.remove(990000532)
    r = h.rodar()
    assert [(m["status"], m["ends_on"]) for m in h.mandatos(sumiu)] == [("encerrado", date.today())]
    assert [m["status"] for m in h.mandatos(fica)] == ["em_exercicio"]
    assert any("zz-teste-bug050-sumiu" in n and "ausente" in n for n in r.notes)


@pytest.mark.parametrize("caso", ["vazia", "truncada", "limit"])
def test_listagem_vazia_ou_truncada_nao_encerra_ninguem(h, caso):
    """(d) Trava: listagem vazia, abaixo de MIN_LISTING ou cortada por limit não prova que o suplente saiu."""
    a, b = h.pessoa(990000541, f"trava-{caso}-a"), h.pessoa(990000542, f"trava-{caso}-b")
    for dep in (990000541, 990000542):
        h.api.status(dep, situacao="Exercício", condicao="Suplente", data=ENTROU)
    h.rodar()
    if caso == "vazia":
        h.api.listing.clear()
        r = h.rodar()
    elif caso == "truncada":
        h.api.listing.remove(990000542)  # 1 id, muito abaixo das 513 cadeiras
        r = h.rodar()
    else:
        r = h.rodar(limit=1)
    for pid in (a, b):
        assert [(m["status"], m["ends_on"]) for m in h.mandatos(pid)] == [("em_exercicio", END)]
    assert any("listagem incompleta" in n for n in r.notes)
