"""BUG-019: presidente contado duas vezes porque o ETL lia …_BRASIL.csv (que já contém o …_BR.csv) junto com o …_BR.csv."""

from __future__ import annotations

import io
import zipfile

import pytest

from civico_etl.jobs.checks import CHECKS
from civico_etl.jobs.tse_bug019 import classify
from civico_etl.jobs.tse_votos_contas import aggregate_finance, aggregate_votes
from civico_etl.remotezip import pick_members

VOT_COLS = ["SQ_CANDIDATO", "NR_TURNO", "QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS", "SG_UF", "NM_MUNICIPIO", "CD_CARGO", "DS_SITUACAO_CASSACAO"]
# presidente (BR) e governador (AC), como o TSE publica: o BRASIL é a concatenação das UFs com o BR
PRES = [["280001607829", "2", "100", "100", "AC", "RIO BRANCO", "1", "#NULO"], ["280001607829", "2", "50", "50", "SP", "SÃO PAULO", "1", "#NULO"]]
GOV = [["010001", "1", "70", "70", "AC", "RIO BRANCO", "3", "#NULO"]]


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


def _votacao(with_brasil: bool = True) -> zipfile.ZipFile:
    p = "votacao_candidato_munzona_2022"
    files = {f"{p}_AC.csv": _csv(VOT_COLS, GOV), f"{p}_BR.csv": _csv(VOT_COLS, PRES), "leiame.pdf": b"%PDF"}
    if with_brasil:
        files[f"{p}_BRASIL.csv"] = _csv(VOT_COLS, GOV + PRES)
    return _zip(files)


def test_pick_members_le_so_o_brasil_quando_existe():
    z = _votacao()
    assert [i.filename for i in pick_members(z, "votacao_candidato_munzona_2022")] == ["votacao_candidato_munzona_2022_BRASIL.csv"]


def test_pick_members_sem_brasil_le_ufs_e_br():
    z = _votacao(with_brasil=False)
    assert sorted(i.filename for i in pick_members(z, "votacao_candidato_munzona_2022")) == [
        "votacao_candidato_munzona_2022_AC.csv", "votacao_candidato_munzona_2022_BR.csv"]


@pytest.mark.parametrize("with_brasil", [True, False])
def test_presidente_contado_uma_vez(with_brasil):
    z = _votacao(with_brasil)
    va = aggregate_votes(z, pick_members(z, "votacao_candidato_munzona_2022"), {"280001607829", "010001"})
    assert va.agg[("280001607829", 2)] == 150  # era 300 com BRASIL + BR
    assert va.agg[("010001", 1)] == 70
    assert va.by_place[("280001607829", 2, "AC", "RIO BRANCO")] == 100
    assert va.by_place[("280001607829", 2, "SP", "SÃO PAULO")] == 50


def test_dinheiro_do_presidente_contado_uma_vez():
    rc = ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA"]
    dc = ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA", "DS_ORIGEM_DESPESA"]
    rec_br, rec_ac = [["280001607829", "P1", "1000,50", "Recursos de partido político"]], [["010001", "P2", "10,00", "Recursos de pessoas físicas"]]
    des_br, des_ac = [["P1", "400,25", "Passagem Aérea"]], [["P2", "3,00", "Materiais de expediente"]]
    files = {}
    for kind, cols, br, ac in (("receitas_candidatos_2022", rc, rec_br, rec_ac), ("despesas_pagas_candidatos_2022", dc, des_br, des_ac)):
        files[f"{kind}_BR.csv"], files[f"{kind}_AC.csv"], files[f"{kind}_BRASIL.csv"] = _csv(cols, br), _csv(cols, ac), _csv(cols, ac + br)
    z = _zip(files)
    fa = aggregate_finance(z, pick_members(z, "receitas_candidatos_2022"), pick_members(z, "despesas_pagas_candidatos_2022"), {"280001607829", "010001"})
    assert fa.raised["280001607829"] == 100050 and fa.spent["280001607829"] == 40025
    assert fa.by_cat[("280001607829", "receita", "Recursos de partido político")] == 100050
    assert fa.raised["010001"] == 1000


def test_classify_so_corrige_dobro_exato():
    assert classify(120_691_998, 60_345_999) == "dobro"
    assert classify(60_345_999, 60_345_999) == "ok"  # idempotente
    assert classify(0, 0) == "ok"
    assert classify(25_663_849_802, 12_865_349_914) == "divergente"  # fonte mudou desde a carga: não toca
    assert classify(None, 10) == "divergente"


def _check_presidente() -> str:
    return next(q for name, q in CHECKS if name.startswith("presidente:"))


def test_invariante_presidente_verde_e_pega_o_dobro(conn):
    q = _check_presidente()
    if not conn.execute("""select 1 from candidacies c join contests ct on ct.id = c.contest_id join offices o on o.id = ct.office_id
                           join elections e on e.id = c.election_id where o.slug = 'presidente' and e.year = 2022 and c.votes > 0 limit 1""").fetchone():
        pytest.skip("sem votos de presidente 2022 no banco")
    assert list(conn.execute(q).fetchone().values())[0] == 0
    # simula o BUG-019 numa transação desfeita: dobrar o presidente de 2022 tem de quebrar o invariante
    with pytest.raises(_Rollback), conn.transaction():
        conn.execute("""update candidacies c set votes = c.votes * 2 from contests ct, offices o, elections e
                        where ct.id = c.contest_id and o.id = ct.office_id and e.id = c.election_id
                          and o.slug = 'presidente' and e.year = 2022 and c.votes is not null""")
        assert list(conn.execute(q).fetchone().values())[0] > 0
        raise _Rollback


class _Rollback(Exception):
    pass
