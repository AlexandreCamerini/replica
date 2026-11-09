"""catálogo D02: emendas do Portal da Transparência. Fixtures no formato do ConsultaEmendasDTO (OpenAPI v3, 08/11/2026): os NOMES dos campos
são reais; os VALORES (tipoEmenda, localidadeDoGasto, formato dos números) são SUPOSIÇÃO, nunca vistos numa resposta real (sem chave)."""

from __future__ import annotations

from datetime import date

import pytest

from civico_etl.jobs import transparencia_emendas as E
from civico_etl.jobs.transparencia_emendas import PeopleIndex

ITEM = {"codigoEmenda": "202443250001", "ano": 2024, "tipoEmenda": "Emenda Individual - Transferências com Finalidade Definida",
        "autor": "ANA SOUZA", "nomeAutor": "ANA SOUZA", "numeroEmenda": "43250001", "localidadeDoGasto": "CAMPINAS - SP",
        "funcao": "Saúde", "subfuncao": "Atenção Básica", "valorEmpenhado": "1.000.000,00", "valorLiquidado": "600.000,50",
        "valorPago": "400.000,25", "valorRestoInscrito": "0,00", "valorRestoCancelado": "0,00", "valorRestoPago": "10,00"}


def test_parse_campos_e_estagios():
    p = E.parse_emenda(ITEM)
    assert p["committed"] == 100_000_000 and p["liquidated"] == 60_000_050 and p["paid"] == 40_000_025
    assert p["resto_pago"] == 1000 and p["paid"] != p["resto_pago"]  # valorPago nunca é o resto pago
    assert p["kind"] == "individual" and p["code"] == "202443250001" and p["year"] == 2024
    assert p["source_key"] == "tr:202443250001|campinas - sp|saude|atencao basica"


def test_valor_ausente_fica_none_nunca_zero():
    p = E.parse_emenda({**ITEM, "valorPago": "", "valorLiquidado": None})
    assert p["paid"] is None and p["liquidated"] is None and p["committed"] == 100_000_000


def test_sem_codigo_ou_ano_rejeita():
    assert E.parse_emenda({**ITEM, "codigoEmenda": ""}) is None
    assert E.parse_emenda({**ITEM, "ano": "2024"}) is None


@pytest.mark.parametrize("tipo,kind", [
    ("Emenda Individual - Transferências com Finalidade Definida", "individual"),
    ("Emenda Individual - Transferências Especiais", "individual_pix"),
    ("Emenda de Bancada", "bancada"), ("Emenda de Comissão", "comissao"), ("Emenda de Relator-Geral", "relator"), ("Coisa Nova", "outro"), (None, "outro")])
def test_tipo_da_emenda(tipo, kind):
    assert E.kind_of(tipo) == kind


def test_localidade():
    assert E.parse_locality("CAMPINAS - SP") == ("campinas", "SP", None)
    assert E.parse_locality("MUNICÍPIO DE São José - sc")[:2] == ("sao jose", "SC")
    for raw in ("NACIONAL", "MÚLTIPLO", "", None, "EXTERIOR"):
        name, uf, note = E.parse_locality(raw)
        assert name is None and note
    assert E.parse_locality("ESTADO DE SÃO PAULO - SP") == (None, "SP", "gasto de esfera estadual, sem município")


def test_repetida_idêntica_descarta_e_mesma_chave_soma():
    a = E.parse_emenda(ITEM)
    b = E.parse_emenda({**ITEM, "valorEmpenhado": "500,00", "valorPago": "100,00"})
    rows, dup, summed = E.merge_rows([a, dict(a), b])
    assert dup == 1 and summed == 1 and len(rows) == 1
    assert rows[0]["committed"] == 100_000_000 + 50_000 and rows[0]["paid"] == 40_000_025 + 10_000


IDX = PeopleIndex(
    by_name={"ana souza": ["p-ana"], "joao lima": ["p-j1", "p-j2"], "carlos rocha": ["p-carlos"], "maria sem mandato": ["p-m"]},
    federal={"p-ana": [(date(2023, 2, 1), date(2027, 2, 1))], "p-j1": [(date(2023, 2, 1), date(2027, 2, 1))], "p-carlos": [(date(2015, 2, 1), date(2019, 2, 1))]},
)


def test_casamento_conservador():
    ok = E.match_author("ANA SOUZA", "individual", 2024, IDX)
    assert ok[0] == "p-ana" and ok[1] == 0.9
    assert E.match_author("Deputada Federal Ana Souza", "individual_pix", 2024, IDX)[0] == "p-ana"  # título removido, mesmo nome
    for name, kind, why in [
        ("JOÃO LIMA", "individual", "homônimo"),
        ("CARLOS ROCHA", "individual", "não tem mandato"),  # nome único, mandato de outra legislatura
        ("MARIA SEM MANDATO", "individual", "não tem mandato"),
        ("FULANO DESCONHECIDO", "individual", "nenhuma pessoa"),
        ("", "individual", "sem nome"),
        ("ANA SOUZA", "bancada", "bancada"),
        ("ANA SOUZA", "comissao", "comiss"),
        ("ANA SOUZA", "relator", "relator"),
    ]:
        pid, conf, note = E.match_author(name, kind, 2024, IDX)
        assert pid is None and conf is None and why in note.lower(), (name, kind, note)


def test_mandato_precisa_cobrir_o_ano_da_emenda():
    assert E.match_author("CARLOS ROCHA", "individual", 2018, IDX)[0] == "p-carlos"
    assert E.match_author("CARLOS ROCHA", "individual", 2024, IDX)[0] is None


def test_build_rows_motivo_em_todo_nao_vinculo():
    p = E.merge_rows([E.parse_emenda(ITEM), E.parse_emenda({**ITEM, "codigoEmenda": "9", "nomeAutor": "NINGUEM", "localidadeDoGasto": "NACIONAL"})])[0]
    rows, stats = E.build_rows(p, IDX, lambda uf, name: "place-campinas" if (uf, name) == ("SP", "campinas") else None)
    cols = E.COLS
    by = {r[cols.index("api_code")]: dict(zip(cols, r)) for r in rows}
    ok, no = by["202443250001"], by["9"]
    assert ok["person_id"] == "p-ana" and ok["beneficiary_place_id"] == "place-campinas" and ok["match_method"] == E.MATCH_METHOD
    assert no["person_id"] is None and no["match_method"] is None and no["match_note"] and no["place_note"]
    assert stats == {"com_pessoa": 1, "sem_pessoa": 1, "com_municipio": 1, "sem_municipio": 1}


def test_municipio_sem_correspondencia_unica_ganha_motivo():
    p = E.merge_rows([E.parse_emenda(ITEM)])[0]
    rows, _ = E.build_rows(p, IDX, lambda uf, name: None)
    d = dict(zip(E.COLS, rows[0]))
    assert d["beneficiary_place_id"] is None and "sem correspondência única" in d["place_note"] and d["beneficiary_uf"] == "SP"


# ---- banco (dentro de transação revertida: nenhuma linha de teste fica no banco real)

def test_upsert_idempotente_e_invariante(conn):
    from civico_etl.db import upsert
    from civico_etl.jobs.checks import CHECKS

    check = dict(CHECKS)["emendas: pago maior que empenhado"]
    vinculo = dict(CHECKS)["emendas: vínculo com pessoa sem método de casamento, ou emenda de bancada/comissão/relator ligada a uma pessoa"]
    items = [ITEM, {**ITEM, "codigoEmenda": "2", "nomeAutor": "Bancada de São Paulo", "tipoEmenda": "Emenda de Bancada", "localidadeDoGasto": "NACIONAL"}]
    rows, _ = E.build_rows(E.merge_rows([E.parse_emenda(i) for i in items])[0], PeopleIndex(), lambda uf, n: None)
    with conn.transaction(force_rollback=True):
        before = conn.execute("select count(*) as n from amendments").fetchone()["n"]
        upsert(conn, "amendments", E.COLS, rows, ["source_key"])
        upsert(conn, "amendments", E.COLS, rows, ["source_key"])  # 2ª carga: mesma chave, sem duplicar
        assert conn.execute("select count(*) as n from amendments").fetchone()["n"] == before + 2
        row = conn.execute("select * from amendments where api_code = '202443250001'").fetchone()
        assert (row["committed_cents"], row["liquidated_cents"], row["paid_cents"]) == (100_000_000, 60_000_050, 40_000_025)
        assert list(conn.execute(check).fetchone().values())[0] == 0
        assert list(conn.execute(vinculo).fetchone().values())[0] == 0
        # pago > empenhado quebra a invariante
        conn.execute("update amendments set paid_cents = committed_cents + 1 where api_code = '202443250001'")
        assert list(conn.execute(check).fetchone().values())[0] == 1
        # emenda de bancada ligada a uma pessoa quebra a outra
        pid = conn.execute("select id from people limit 1").fetchone()["id"]
        conn.execute("update amendments set person_id = %s where api_code = '2'", (pid,))
        assert list(conn.execute(vinculo).fetchone().values())[0] >= 1
    assert conn.execute("select count(*) as n from amendments").fetchone()["n"] == before


def test_ano_sem_mudanca_nao_interrompe_os_anos_seguintes(monkeypatch):
    """Regressão: SkipUnchanged de um ano (checksum igual) não pode escapar do laço; 2024 e 2025 ainda têm de ser lidos."""
    from contextlib import contextmanager

    from civico_etl.db import SkipUnchanged

    visto: list[str] = []

    @contextmanager
    def fake_run(conn, dataset, source, **kw):
        visto.append(dataset)
        if dataset.endswith(".2023"):
            raise SkipUnchanged(dataset)
        raise RuntimeError("parou aqui de propósito: 2024 chegou a abrir o run")
        yield  # pragma: no cover

    monkeypatch.setattr(E, "run", fake_run)
    with pytest.raises(RuntimeError, match="2024 chegou"):
        E.run_emendas(None, years=[2023, 2024, 2025], pages=lambda y: [[]])
    assert visto == ["transparencia.emendas.2023", "transparencia.emendas.2024"]


# ---- S3-6: soma só dentro da mesma página; repetição entre páginas aborta o ano ----

def test_soma_so_na_mesma_pagina_e_entre_paginas_aborta():
    a = E.parse_emenda(ITEM)
    b = E.parse_emenda({**ITEM, "valorEmpenhado": "500,00", "valorPago": "100,00"})
    rows, dup, summed = E.merge_rows([dict(a, _page=0), dict(b, _page=0)])
    assert summed == 1 and rows[0]["committed"] == 100_000_000 + 50_000 and "_page" not in rows[0]
    # mesma chave, valores diferentes, páginas diferentes = paginação deslocada: nada de somar
    with pytest.raises(E.ShiftedPages, match="páginas diferentes"):
        E.merge_rows([dict(a, _page=0), dict(b, _page=1)])
    # item idêntico em outra página continua sendo só repetição (descartada, não somada)
    rows, dup, summed = E.merge_rows([dict(a, _page=0), dict(a, _page=1)])
    assert dup == 1 and summed == 0 and rows[0]["committed"] == 100_000_000


def test_ano_com_paginacao_deslocada_nao_grava_e_os_outros_anos_seguem(monkeypatch):
    from contextlib import contextmanager

    from civico_etl import db as D

    abertos, gravados = [], []

    @contextmanager
    def fake_run(conn, dataset, source, **kw):
        abertos.append(dataset)
        yield D.Run(conn, dataset, source)

    monkeypatch.setattr(E, "run", fake_run)
    monkeypatch.setattr(E, "upsert", lambda *a, **k: gravados.append(a) or [])
    monkeypatch.setattr(E.PeopleIndex, "load", classmethod(lambda cls, conn: PeopleIndex()))
    monkeypatch.setattr(E, "_place_lookup", lambda conn: (lambda uf, n: None))

    class Conn:
        def execute(self, *a, **k):
            class R:
                def fetchone(self_):
                    return {"n": 0}
            return R()

    b = {**ITEM, "valorEmpenhado": "500,00"}
    deslocado = {2023: [[ITEM], [b]], 2024: [[ITEM, {**ITEM, "codigoEmenda": "9"}]]}
    with pytest.raises(E.ShiftedPages, match="2023"):
        E.run_emendas(Conn(), years=[2023, 2024], pages=lambda y: deslocado[y])
    assert abertos == ["transparencia.emendas.2023", "transparencia.emendas.2024"]  # 2024 seguiu
    assert len(gravados) == 1  # só 2024 gravou
