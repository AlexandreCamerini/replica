"""BUG-052 e BUG-051: decisão da linha de mandato de um deputado listado pela Câmara (`mandato_da_camara`, pura), e D321: a API da
cota é consultada antes de o arquivo anual ser gravado, e a cota de um ano que falha não tira o ano seguinte do ciclo.

Sem banco: a função de mandato recebe dados simples; `_expenses` e `run_camara` rodam com dublês de conexão, de `run` e de rede.
Os casos com a exclusão `no_overlapping_mandate` de verdade estão em test_camara_suplente_saiu.py (precisam de Postgres)."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from civico_etl.jobs import camara_diario as cd

START, END = cd.LEGISLATURES[57]
ANTES = cd.LEGISLATURES[56]
ENTROU, SAIU = date(2026, 7, 9), date(2026, 11, 6)


def m(**kw):
    base = dict(titular_na_fonte=False, em_exercicio=True, data=None, start=START, end=END, aqui=[], fora=[])
    return cd.mandato_da_camara(**{**base, **kw})


def test_titular_eleito_usa_o_inicio_da_legislatura():
    assert m(titular_na_fonte=True) == ("gravar", "titular", START)  # sem linha nenhuma ainda
    assert m(titular_na_fonte=True, aqui=[(START, END, "titular")]) == ("gravar", "titular", START)  # linha do TSE
    # mandato da legislatura anterior termina no dia em que esta começa: não cruza
    assert m(titular_na_fonte=True, aqui=[(ANTES[0], ANTES[1], "titular")]) == ("gravar", "titular", START)
    # cassado: a Câmara diz "Não Eleito", mas o TSE gravou o titular no início; segue sendo aquele mandato, mesmo fora do exercício
    assert m(em_exercicio=False, aqui=[(START, END, "titular")]) == ("gravar", "titular", START)


def test_bug052_suplente_efetivado_reaproveita_o_mandato_aberto_em_vez_de_inserir_por_cima():
    # antes: inseria (START, END) por cima de (ENTROU, END) e a exclusão derrubava a carga inteira
    assert m(titular_na_fonte=True, aqui=[(ENTROU, END, "suplente_em_exercicio")]) == ("gravar", "titular", ENTROU)
    # dois mandatos abertos não deveriam existir; se existirem, vale o mais antigo (mesma regra do suplente)
    assert m(titular_na_fonte=True, aqui=[(ENTROU, END, "suplente_em_exercicio"), (date(2025, 3, 1), SAIU, "suplente_em_exercicio")])[2] == ENTROU


def test_bug052_efetivado_depois_de_um_mandato_encerrado_comeca_no_fim_dele_ou_na_data_da_fonte():
    fechado = [(ENTROU, SAIU, "suplente_em_exercicio")]
    assert m(titular_na_fonte=True, aqui=fechado) == ("gravar", "titular", SAIU)  # sem data na fonte
    assert m(titular_na_fonte=True, aqui=fechado, data=date(2026, 8, 1)) == ("gravar", "titular", SAIU)  # data dentro do encerrado
    assert m(titular_na_fonte=True, aqui=fechado, data=date(2026, 12, 1)) == ("gravar", "titular", date(2026, 12, 1))
    # o que sai nunca cruza o que já existe
    for data in (None, date(2026, 8, 1), date(2026, 12, 1)):
        _, _, ini = m(titular_na_fonte=True, aqui=fechado, data=data)
        assert not any(s < END and e > ini for s, e, _ in fechado)


def test_bug052_mandato_em_outra_uf_no_periodo_e_recusado_sem_derrubar_a_carga():
    assert m(titular_na_fonte=True, fora=[(START, END)])[0] == "recusar"
    assert m(titular_na_fonte=True, fora=[(ENTROU, SAIU)])[0] == "recusar"
    assert m(data=ENTROU, fora=[(date(2026, 9, 1), END)])[0] == "recusar"  # suplente também
    # outra UF em outra legislatura, ou encerrado antes de este começar: não cruza
    assert m(titular_na_fonte=True, fora=[(ANTES[0], ANTES[1])]) == ("gravar", "titular", START)
    assert m(data=date(2026, 12, 1), fora=[(ENTROU, SAIU)]) == ("gravar", "suplente_em_exercicio", date(2026, 12, 1))


def test_bug051_suplente_do_primeiro_dia_nao_vira_titular():
    primeiro_dia = [(START, END, "suplente_em_exercicio")]
    # segue suplente, na mesma chave (antes: any(s == start) fazia dele titular no run seguinte)
    assert m(data=START, aqui=primeiro_dia) == ("gravar", "suplente_em_exercicio", START)
    assert m(data=None, aqui=primeiro_dia) == ("gravar", "suplente_em_exercicio", START)
    # e quando sai do exercício entra no caminho do encerramento com data (close_suplentes), não no do titular
    assert m(em_exercicio=False, data=SAIU, aqui=primeiro_dia) == ("saiu", None, None)
    # se a própria Câmara passar a chamá-lo de Titular (efetivado), a linha do 1º dia vira titular
    assert m(titular_na_fonte=True, aqui=primeiro_dia) == ("gravar", "titular", START)


def test_suplente_do_primeiro_dia_ja_encerrado_que_volta_ganha_linha_nova():
    """A linha (início da legislatura, X) encerrada não é reaberta com fim no passado: fica como histórico."""
    encerrado = [(START, SAIU, "suplente_em_exercicio")]
    volta = date(2026, 12, 1)
    assert m(titular_na_fonte=True, data=volta, aqui=encerrado) == ("gravar", "titular", volta)
    assert m(titular_na_fonte=True, data=None, aqui=encerrado) == ("gravar", "titular", SAIU)
    assert m(data=volta, aqui=encerrado) == ("gravar", "suplente_em_exercicio", volta)
    # a linha do 1º dia ainda ABERTA é a própria: reaproveita
    assert m(titular_na_fonte=True, aqui=[(START, END, "suplente_em_exercicio")]) == ("gravar", "titular", START)


def test_efetivado_que_a_fonte_volta_a_chamar_de_suplente_sai_pelo_caminho_do_encerramento():
    efetivado = [(ENTROU, END, "titular")]  # linha de suplente que virou titular num run anterior (início depois do da legislatura)
    assert m(em_exercicio=False, data=SAIU, aqui=efetivado) == ("saiu", None, None)  # close_suplentes alcança titular com início tardio
    assert m(em_exercicio=True, data=ENTROU, aqui=efetivado) == ("gravar", "suplente_em_exercicio", ENTROU)  # voltou a suplente, em exercício


def test_outra_uf_so_recusa_quando_haveria_insert():
    # a chave já existe nesta UF: o upsert só atualiza, e a linha já convive com a de fora (não há o que estourar)
    aqui = [(START, date(2024, 1, 1), "titular")]
    fora = [(date(2024, 1, 1), date(2025, 1, 1))]
    assert m(titular_na_fonte=True, aqui=aqui, fora=fora) == ("gravar", "titular", START)
    # sem a chave: haveria insert por cima do período de fora
    assert m(titular_na_fonte=True, fora=[(START, END)])[0] == "recusar"


def test_suplente_segue_as_regras_de_antes():
    assert m(em_exercicio=False, data=SAIU) == ("saiu", None, None)
    assert m(data=ENTROU) == ("gravar", "suplente_em_exercicio", ENTROU)
    assert m(data=None) == ("gravar", "suplente_em_exercicio", START)
    assert m(data=date(2020, 1, 1)) == ("gravar", "suplente_em_exercicio", START)  # data anterior à legislatura
    assert m(data=date(2026, 12, 1), aqui=[(ENTROU, END, "suplente_em_exercicio")])[2] == ENTROU  # reaproveita o aberto
    assert m(data=ENTROU, aqui=[(ENTROU, SAIU, "suplente_em_exercicio")])[2] == SAIU  # volta: começa no fim do encerrado
    assert m(data=date(2026, 12, 1), aqui=[(ENTROU, SAIU, "suplente_em_exercicio")])[2] == date(2026, 12, 1)


def test_mandato_encerrado_que_vai_ate_o_fim_da_legislatura_e_o_aberto_reaproveitado():
    # fim = fim da legislatura conta como "aberto" (a chave é reaproveitada): nunca devolve início >= fim
    for kw in (dict(titular_na_fonte=True), dict(data=ENTROU)):
        oque, _, ini = m(aqui=[(ENTROU, END, "suplente_em_exercicio")], **kw)
        assert oque == "gravar" and ini < END


# ---------------------------------------------------------------- D321: cota, API antes do arquivo


class FakeConn:
    def __init__(self, deps):
        self.deps, self.sql, self.commits, self.rollbacks = deps, [], 0, 0

    def execute(self, sql, params=None):
        self.sql.append(" ".join(sql.split()))
        return iter(self.deps) if "person_external_ids" in sql else iter([])

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


@pytest.fixture
def cota(monkeypatch):
    abertos: list[str] = []

    @contextmanager
    def fake_run(c, dataset, source, **kw):
        abertos.append(dataset)
        yield SimpleNamespace(notes=[], add=lambda n: None, reject=lambda *a: None)

    monkeypatch.setattr(cd, "run", fake_run)
    monkeypatch.setattr(cd, "fetch", lambda url, **kw: SimpleNamespace(checksum="x", path="/nao/existe.zip"))
    conn = FakeConn([{"external_id": "111", "person_id": "p1"}, {"external_id": "222", "person_id": "p2"}])
    return SimpleNamespace(conn=conn, abertos=abertos, mp=monkeypatch)


def test_api_da_cota_sem_resposta_de_um_deputado_falha_antes_de_abrir_o_run_do_arquivo(cota):
    def pag(url, **kw):
        if "/deputados/222/" in url:
            raise httpx.ConnectTimeout("sem resposta")
        return iter([{"codDocumento": 1}])

    cota.mp.setattr(cd, "paginate_camara", pag)
    with pytest.raises(RuntimeError, match=r"sem resposta para 1 deputado\(s\) em 2026: \['222'\]"):
        cd._expenses(cota.conn, SimpleNamespace(), 2026, force=False)
    # só o run que registra a falha; o do arquivo (camara.despesas.2026) nem abriu, então nada foi gravado nem carimbado
    assert cota.abertos == ["camara.despesasapi.2026"]
    assert not [q for q in cota.conn.sql if q.lower().startswith(("insert", "update", "delete"))]


def test_api_da_cota_e_lida_inteira_antes_do_arquivo(cota):
    ordem: list[str] = []
    cota.mp.setattr(cd, "paginate_camara", lambda url, **kw: (ordem.append("api"), iter([]))[1])

    @contextmanager
    def run_que_para(c, dataset, source, **kw):
        ordem.append(f"run:{dataset}")
        raise cd.SkipUnchanged(dataset)
        yield  # pragma: no cover

    cota.mp.setattr(cd, "run", run_que_para)
    visto = {}
    cota.mp.setattr(cd, "_expenses_api", lambda conn, ctx, year, api: visto.update(api=api))
    cd._expenses(cota.conn, SimpleNamespace(), 2026, force=False)
    # 2 deputados x 1 legislatura no ano: toda a rede acontece antes do primeiro run
    assert ordem == ["api", "api", "run:camara.despesas.2026"]
    assert sorted(visto["api"]) == [("p1", "111"), ("p2", "222")]  # arquivo igual (skip): o complemento roda mesmo assim, como antes
    assert cota.conn.commits == 1  # a transação da leitura fecha antes da rede


def test_ano_anterior_a_api_nao_consulta_a_api(cota):
    cota.mp.setattr(cd, "paginate_camara", lambda url, **kw: pytest.fail("não deveria consultar a API"))

    @contextmanager
    def pula(c, dataset, source, **kw):
        raise cd.SkipUnchanged(dataset)
        yield  # pragma: no cover

    cota.mp.setattr(cd, "run", pula)
    cota.mp.setattr(cd, "_expenses_api", lambda *a: pytest.fail("não deveria gravar complemento"))
    cd._expenses(cota.conn, SimpleNamespace(), cd.COTA_API_FROM - 1, force=False)


def test_cota_de_um_ano_que_falha_nao_tira_o_ano_seguinte_do_ciclo(monkeypatch):
    feito: list[str] = []
    monkeypatch.setattr(cd, "_Ctx", lambda conn: SimpleNamespace())
    monkeypatch.setattr(cd, "_deputies", lambda *a: feito.append("deputados"))
    monkeypatch.setattr(cd, "link_past_roster", lambda *a: None)
    monkeypatch.setattr(cd, "_votes", lambda conn, ctx, y, force: feito.append(f"votos:{y}"))
    monkeypatch.setattr(cd, "_proposals", lambda conn, ctx, y, force: feito.append(f"proposicoes:{y}"))

    def cota(conn, ctx, y, force):
        feito.append(f"cota:{y}")
        if y == 2025:
            raise RuntimeError("API da cota sem resposta para 1 deputado(s) em 2025")

    monkeypatch.setattr(cd, "_expenses", cota)
    conn = FakeConn([])
    with pytest.raises(RuntimeError, match="cota da Câmara falhou em 2025: RuntimeError: API da cota sem resposta"):
        cd.run_camara(conn, years=[2025, 2026], limit=None, expenses=True, force=False)
    assert feito == ["deputados", "votos:2025", "proposicoes:2025", "cota:2025", "votos:2026", "proposicoes:2026", "cota:2026"]
    assert conn.rollbacks == 1
    # sem falha: não levanta
    monkeypatch.setattr(cd, "_expenses", lambda *a: None)
    cd.run_camara(FakeConn([]), years=[2026], limit=None, expenses=True, force=False)


def test_corpo_invalido_ou_erro_de_disco_na_api_da_cota_tambem_fica_registrado_como_falha(cota):
    def pag(url, **kw):
        if "/deputados/111/" in url:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")  # HTTP 200 com corpo que não é JSON
        raise OSError("cache em disco")

    cota.mp.setattr(cd, "paginate_camara", pag)
    with pytest.raises(RuntimeError, match=r"sem resposta para 2 deputado\(s\) em 2026"):
        cd._expenses(cota.conn, SimpleNamespace(), 2026, force=False)
    assert cota.abertos == ["camara.despesasapi.2026"]  # a falha fica em ingest_runs; o arquivo não abriu


def _item(doc, v):
    return {"codDocumento": doc, "valorDocumento": v, "valorGlosa": 0, "valorLiquido": v, "dataDocumento": "2026-02-03", "ano": 2026, "mes": 2,
            "tipoDespesa": "PASSAGEM AÉREA - SIGEPA", "numDocumento": "n", "nomeFornecedor": "x", "cnpjCpfFornecedor": "1", "urlDocumento": None,
            "parcela": 0, "numRessarcimento": "", "codLote": 1}


def test_complemento_da_api_grava_so_o_que_o_arquivo_nao_traz_com_chave_estavel(cota):
    class Conn(FakeConn):
        def execute(self, sql, params=None):
            if "from expenses" in sql:
                return iter([{"source_key": "cota2026:111:D1:h", "amount_cents": 1000}])
            return super().execute(sql, params)

    gravado = {}
    cota.mp.setattr(cd, "_write_year", lambda conn, body, prefix, rows: gravado.update(prefix=prefix, rows=rows) or len(rows))
    # p1 tem dois ids da Câmara; D1 já está no arquivo; U1 aparece duas vezes idêntico (sufixo de desempate na chave)
    api = {("p1", "222"): [_item("U2", 7.0)], ("p1", "111"): [_item("D1", 10.0), _item("U1", 5.0), _item("U1", 5.0)], ("p0", "333"): [_item("U3", 3.0)]}
    cd._expenses_api(Conn([]), SimpleNamespace(body="B"), 2026, api)
    assert cota.abertos == ["camara.despesasapi.2026"]
    assert gravado["prefix"] == "cotaapi2026"
    rows = gravado["rows"]
    chaves = [r[-1] for r in rows]
    assert [(r[0], r[-1].split(":")[1], r[-1].split(":")[2]) for r in rows] == [("p0", "333", "U3"), ("p1", "111", "U1"), ("p1", "111", "U1"), ("p1", "222", "U2")]
    assert len(set(chaves)) == 4 and all(k.startswith("cotaapi2026:") for k in chaves)  # D1 ficou de fora; os dois U1 não colidem
    assert [r[6] for r in rows] == [300, 500, 500, 700] and {r[1] for r in rows} == {"B"}
    # a mesma entrada dá as mesmas chaves (o prune do run seguinte depende disso)
    cd._expenses_api(Conn([]), SimpleNamespace(body="B"), 2026, dict(reversed(list(api.items()))))
    assert [r[-1] for r in gravado["rows"]] == chaves


def _so_cota(monkeypatch, cota):
    monkeypatch.setattr(cd, "_Ctx", lambda conn: SimpleNamespace())
    for nome in ("_deputies", "link_past_roster", "_votes", "_proposals"):
        monkeypatch.setattr(cd, nome, lambda *a: None)
    monkeypatch.setattr(cd, "_expenses", cota)


def test_dois_anos_de_cota_falhando_saem_os_dois_na_mensagem(monkeypatch):
    def cota(conn, ctx, y, force):
        raise RuntimeError(f"API fora em {y}")

    _so_cota(monkeypatch, cota)
    conn = FakeConn([])
    with pytest.raises(RuntimeError, match=r"falhou em 2025: RuntimeError: API fora em 2025; 2026: RuntimeError: API fora em 2026"):
        cd.run_camara(conn, years=[2025, 2026], limit=None, expenses=True, force=False)
    assert conn.rollbacks == 2


def test_conexao_caida_depois_da_falha_da_cota_nao_perde_o_motivo(monkeypatch):
    class Caida(FakeConn):
        def rollback(self):
            raise ConnectionError("server closed the connection")

    def cota(conn, ctx, y, force):
        raise RuntimeError(f"API fora em {y}")

    _so_cota(monkeypatch, cota)
    with pytest.raises(RuntimeError, match=r"falhou em 2025: RuntimeError: API fora em 2025; e a conexão não voltou \(ConnectionError\)"):
        cd.run_camara(Caida([]), years=[2025, 2026], limit=None, expenses=True, force=False)


def test_trava_de_outro_run_nao_e_engolida_pelo_isolamento_por_ano(monkeypatch):
    def cota(conn, ctx, y, force):
        raise SystemExit("outro run em andamento")

    _so_cota(monkeypatch, cota)
    with pytest.raises(SystemExit):
        cd.run_camara(FakeConn([]), years=[2025, 2026], limit=None, expenses=True, force=False)
