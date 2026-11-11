"""BUG-048: votação e contas do TSE casavam a candidatura só pelo SQ (e turno). Em 2012 o SQ se repete entre a eleição
ordinária de um município e a suplementar de outro (BUG-035, 91 duplas): as duas candidaturas recebiam a soma das duas.
Correção: nos anos de SQ_COM_UE a chave é (SG_UE, SQ), e a candidatura do banco é a da chave tse ANO:UE:SQ da própria pessoa.
Fora de SQ_COM_UE (2014+), tudo fica igual: o teste de caracterização de 2022/2024 passa no main e neste branch.

Tudo sintético (SQ, UE, lugares e pessoas fictícios), numa transação desfeita, sem supor banco vazio. Funções novas são
importadas dentro dos testes."""

from __future__ import annotations

import io
import types
import zipfile
from datetime import date

import pytest

from civico_etl.remotezip import pick_members

SQ = "99000480001"
VOT_COLS = ["SQ_CANDIDATO", "NR_TURNO", "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS", "SG_UF", "NM_MUNICIPIO", "CD_CARGO",
            "DS_SITUACAO_CASSACAO", "SG_UE"]
REC_COLS = ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA", "DS_FONTE_RECEITA", "NR_CPF_CNPJ_DOADOR",
            "NM_DOADOR", "NM_DOADOR_RFB", "SG_PARTIDO_DOADOR", "SG_UE"]
DES_COLS = ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA", "DS_ORIGEM_DESPESA"]


def _csv(cols: list[str], rows_: list[list[str]]) -> bytes:
    lines = [";".join(f'"{c}"' for c in cols)] + [";".join(f'"{v}"' for v in r) for r in rows_]
    return ("\n".join(lines) + "\n").encode("latin-1")


def _zip(files: dict[str, bytes]) -> zipfile.ZipFile:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as w:
        for name, data in files.items():
            w.writestr(name, data)
    buf.seek(0)
    return zipfile.ZipFile(buf)


def _setup(conn, year: int, ues: list[tuple[str, str, str]], sq_by_ue: dict[str, str]) -> dict[str, str]:
    """Uma pessoa e uma candidatura (vereador) por UE, cada uma com a chave tse do ano e um mandato em exercício.
    `ues`: (UE, tipo de eleição, sufixo). Devolve UE -> candidatura."""
    from civico_etl.jobs.tse_candidatos import tse_key

    out = {}
    for ue, kind, suf in ues:
        place = conn.execute("""insert into places (ibge_code, kind, name, slug, uf) values (%s, 'municipio', %s, %s, 'AC') returning id""",
                             (f"99048{suf}", f"Teste BUG-048 {suf}", f"teste-bug-048-{suf}")).fetchone()["id"]
        el = conn.execute("""insert into elections (kind, year, round, held_on) values (%s, %s, 1, %s)
                             on conflict (kind, year, round, held_on) do update set kind = excluded.kind returning id""",
                          (kind, year, date(year + (1 if kind == "suplementar" else 0), 10, 7))).fetchone()["id"]
        ct = conn.execute("""insert into contests (election_id, office_id, place_id) values (%s, (select id from offices where slug = 'vereador'), %s)
                             returning id""", (el, place)).fetchone()["id"]
        pid = conn.execute("insert into people (slug, display_name) values (%s, %s) returning id", (f"teste-bug048-{year}-{suf}", f"Teste {suf}")).fetchone()["id"]
        conn.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                        values (%s, (select id from sources where slug = 'tse'), %s, 'exact_id', 1)""", (pid, tse_key(year, sq_by_ue[ue], ue)))
        cid = conn.execute("""insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name, result)
                              values (%s, %s, %s, %s, 'Teste', 'eleito') returning id""", (ct, el, pid, sq_by_ue[ue])).fetchone()["id"]
        conn.execute("""insert into mandates (person_id, office_id, place_id, status, started_on, ends_on, status_source, candidacy_id)
                        values (%s, (select id from offices where slug = 'vereador'), %s, 'em_exercicio', '2013-01-01', '2099-01-01', 'tse', %s)""",
                     (pid, place, cid))
        out[ue] = str(cid)
    return out


def _votacao(year: int, linhas: list[list[str]]) -> zipfile.ZipFile:
    return _zip({f"votacao_candidato_munzona_{year}_AC.csv": _csv(VOT_COLS, linhas)})


def _contas(year: int, rec: list[list[str]], des: list[list[str]]) -> zipfile.ZipFile:
    return _zip({f"receitas_candidatos_{year}_AC.csv": _csv(REC_COLS, rec), f"despesas_pagas_candidatos_{year}_AC.csv": _csv(DES_COLS, des)})


def _state(conn, cids: dict[str, str]) -> dict[str, tuple]:
    out = {}
    for ue, cid in cids.items():
        c = conn.execute("select votes, raised_cents, spent_cents from candidacies where id = %s", (cid,)).fetchone()
        m = conn.execute("select status from mandates where candidacy_id = %s", (cid,)).fetchone()
        fe = conn.execute("select source_key, amount_cents from campaign_finance_entries where candidacy_id = %s order by 1", (cid,)).fetchall()
        fo = conn.execute("select source_key, amount_cents from campaign_finance_by_origin where candidacy_id = %s order by 1", (cid,)).fetchall()
        out[ue] = (c["votes"], c["raised_cents"], c["spent_cents"], m["status"],
                   tuple((x["source_key"], x["amount_cents"]) for x in fe), tuple((x["source_key"], x["amount_cents"]) for x in fo))
    return out


def _need(conn):
    if not conn.execute("select 1 from sources where slug = 'tse'").fetchone():
        pytest.skip("fontes não semeadas (civico-etl seed)")


def test_2012_mesmo_sq_em_duas_ues_cada_candidatura_recebe_so_o_seu(conn):
    """A ordinária de um município e a suplementar de outro, com o mesmo SQ: votos, cassação, receita, despesa, categorias e
    origens de cada uma são só os da sua UE."""
    _need(conn)
    with conn.transaction(force_rollback=True):
        cids = _setup(conn, 2012, [("99481", "municipal", "1"), ("99482", "suplementar", "2")], {"99481": SQ, "99482": SQ})
        _run_votes_compat(conn, 2012, _votacao(2012, [
            [SQ, "1", "", "100", "AC", "MUNICIPIO UM", "13", "#NULO", "99481"],
            [SQ, "1", "", "20", "AC", "MUNICIPIO UM", "13", "#NULO", "99481"],
            [SQ, "1", "", "7", "AC", "MUNICIPIO DOIS", "13", "CASSADO", "99482"],
        ]))
        _run_finance_compat(conn, 2012, _contas(2012, [
            [SQ, "P1", "1000,00", "Recursos de partido político", "FUNDO ESPECIAL", "", "Direção Nacional", "", "PX", "99481"],
            [SQ, "P2", "30,00", "Recursos de pessoas físicas", "OUTROS RECURSOS", "", "", "", "", "99482"],
        ], [["P1", "400,00", "Publicidade"], ["P2", "5,00", "Combustível"]]))
        s = _state(conn, cids)
        um, dois = s["99481"], s["99482"]
        assert um[:4] == (120, 100000, 40000, "em_exercicio")  # antes: 127 votos e 103.000 de receita nas duas
        assert dois[:4] == (7, 3000, 500, "cassado")  # só a candidatura da UE com a cassação
        assert all(k.startswith(f"tse:2012:99481:{SQ}:") for k, _ in um[4] + um[5])
        assert all(k.startswith(f"tse:2012:99482:{SQ}:") for k, _ in dois[4] + dois[5])
        assert sum(v for k, v in um[5]) == 100000 and sum(v for k, v in dois[5]) == 3000


def test_2012_linha_sem_ue_nao_grava(conn):
    """Layout de 2012 sem SG_UE (não conferido na fonte): na dúvida não grava, em vez de cair no SQ puro."""
    _need(conn)
    with conn.transaction(force_rollback=True):
        cids = _setup(conn, 2012, [("99481", "municipal", "1"), ("99482", "suplementar", "2")], {"99481": SQ, "99482": SQ})
        _run_votes_compat(conn, 2012, _votacao(2012, [[SQ, "1", "", "100", "AC", "MUNICIPIO UM", "13", "#NULO", ""]]))
        s = _state(conn, cids)
        assert s["99481"][0] is None and s["99482"][0] is None


@pytest.mark.parametrize("year", [2022, 2024])
def test_fora_de_sq_com_ue_nada_muda(conn, year):
    """Caracterização (equivalência): fora de SQ_COM_UE a chave é o SQ, o SG_UE é ignorado e os source_key são os de sempre.
    Este teste passa igual no main (sem BUG-048) e neste branch."""
    _need(conn)
    sq2 = "99000480002"
    with conn.transaction(force_rollback=True):
        cids = _setup(conn, year, [("99483", "municipal", "3"), ("99484", "municipal", "4")], {"99483": SQ, "99484": sq2})
        _run_votes_compat(conn, year, _votacao(year, [
            [SQ, "1", "90", "100", "AC", "MUNICIPIO TRES", "13", "#NULO", "99483"],
            [SQ, "1", "10", "10", "AC", "MUNICIPIO TRES", "13", "#NULO", "OUTRA"],  # UE diferente: fora de 2012 não importa
            [sq2, "1", "5", "5", "AC", "MUNICIPIO QUATRO", "13", "CASSADO", "99484"],
        ]))
        _run_finance_compat(conn, year, _contas(year, [
            [SQ, "P1", "1000,00", "Recursos de partido político", "FUNDO ESPECIAL", "", "Direção Nacional", "", "PX", "99483"],
            [sq2, "P2", "30,00", "Recursos de pessoas físicas", "OUTROS RECURSOS", "", "", "", "", "99484"],
        ], [["P1", "400,00", "Publicidade"], ["P2", "5,00", "Combustível"]]))
        s = _state(conn, cids)
        assert s["99483"] == (100, 100000, 40000, "em_exercicio",
                              ((f"tse:{year}:{SQ}:despesa:Publicidade", 40000), (f"tse:{year}:{SQ}:receita:Recursos de partido político", 100000)),
                              ((f"tse:{year}:{SQ}:fefc", 100000),))
        assert s["99484"] == (5, 3000, 500, "cassado",
                              ((f"tse:{year}:{sq2}:despesa:Combustível", 500), (f"tse:{year}:{sq2}:receita:Recursos de pessoas físicas", 3000)),
                              ((f"tse:{year}:{sq2}:pessoa_fisica", 3000),))


def _kw(fn, year: int) -> dict:
    """`year=` só onde a função aceita (no main ela não aceita): o mesmo teste roda nas duas versões."""
    import inspect

    return {"year": year} if "year" in inspect.signature(fn).parameters else {}


def _run_votes_compat(conn, year: int, z) -> None:
    from civico_etl.jobs import tse_votos_contas as tv

    r = types.SimpleNamespace(notes=[], reject=lambda n, *_: None, add=lambda n: None)
    va = tv.aggregate_votes(z, pick_members(z, f"votacao_candidato_munzona_{year}"), tv._known(conn, year), **_kw(tv.aggregate_votes, year))
    tv._apply(conn, year, "votes", va.agg, by_round=True)
    tv._place_votes(conn, r, year, va.by_place)
    tv._mark_cassados(conn, year, va.cassados)


def _run_finance_compat(conn, year: int, z) -> None:
    from civico_etl.jobs import tse_votos_contas as tv

    r = types.SimpleNamespace(notes=[])
    fa = tv.aggregate_finance(z, pick_members(z, f"receitas_candidatos_{year}"), pick_members(z, f"despesas_pagas_candidatos_{year}"),
                              tv._known(conn, year), **_kw(tv.aggregate_finance, year))
    tv._apply(conn, year, "raised_cents", fa.raised, by_round=False)
    tv._apply(conn, year, "spent_cents", fa.spent, by_round=False)
    tv._finance_entries(conn, year, fa.by_cat)
    tv._origin_entries(conn, year, fa, r)


def _patch_loader(monkeypatch, tc, p):
    monkeypatch.setattr(tc, "fetch", lambda url: types.SimpleNamespace(path=p, checksum="x"))
    monkeypatch.setattr(tc, "_extract", lambda *a, **k: [p])

    class _Run:
        def __enter__(self):
            return types.SimpleNamespace(add=lambda n: None)

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(tc, "run", lambda *a, **k: _Run())


def _votacao_csv(tmp_path, year: int, linhas: list[tuple[str, str, str]]):
    p = tmp_path / f"votacao_candidato_munzona_{year}_AC.utf8.csv"
    p.write_text("\n".join(['"SQ_CANDIDATO";"NR_TURNO";"QT_VOTOS_NOMINAIS";"SG_UE"'] + [f'"{sq}";"1";"{v}";"{ue}"' for sq, v, ue in linhas]) + "\n",
                 encoding="utf-8")
    return p


def test_load_votes_do_loader_em_2012_por_ue(conn, tmp_path, monkeypatch):
    """tse_candidatos._load_votes (--with-votes): mesma regra por (UE, SQ) em 2012."""
    from civico_etl.jobs import tse_candidatos as tc

    _need(conn)
    _patch_loader(monkeypatch, tc, _votacao_csv(tmp_path, 2012, [(SQ, "100", "99481"), (SQ, "7", "99482")]))
    with conn.transaction(force_rollback=True):
        cids = _setup(conn, 2012, [("99481", "municipal", "1"), ("99482", "suplementar", "2")], {"99481": SQ, "99482": SQ})
        tc._load_votes(conn, 2012, None, True)
        s = _state(conn, cids)
        assert (s["99481"][0], s["99482"][0]) == (100, 7)  # antes: 107 nas duas


@pytest.mark.parametrize("year", [2022, 2024])
def test_load_votes_do_loader_fora_de_sq_com_ue_nada_muda(conn, tmp_path, monkeypatch, year):
    """Caracterização do loader: fora de SQ_COM_UE soma por SQ e ignora o SG_UE. Passa igual no main e neste branch."""
    from civico_etl.jobs import tse_candidatos as tc

    _need(conn)
    sq2 = "99000480002"
    _patch_loader(monkeypatch, tc, _votacao_csv(tmp_path, year, [(SQ, "100", "99483"), (SQ, "10", "OUTRA"), (sq2, "5", "99484")]))
    with conn.transaction(force_rollback=True):
        cids = _setup(conn, year, [("99483", "municipal", "3"), ("99484", "municipal", "4")], {"99483": SQ, "99484": sq2})
        tc._load_votes(conn, year, None, True)
        s = _state(conn, cids)
        assert (s["99483"][0], s["99484"][0]) == (110, 5)
