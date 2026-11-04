"""BUG-031 / D202-D203: quem governa cada UF hoje bate com a lista conferida na fonte oficial; o check pega a regressão."""

from __future__ import annotations

from civico_etl.jobs.checks import CHECKS, GOVERNADOR_EXCECOES, GOVERNO_POR_UF
from civico_etl.jobs.derive_stats import EXECUTIVO_FORA_DO_TSE

UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split()


def _q(name_part: str) -> str:
    return next(q for n, q in CHECKS if name_part in n)


def _n(conn, q: str) -> int:
    return list(conn.execute(q).fetchone().values())[0]


def test_lista_conferida_cobre_as_27_ufs_com_fonte():
    assert sorted(GOVERNO_POR_UF) == UFS
    assert all(fonte.startswith("https://") for _, _, fonte in GOVERNO_POR_UF.values())
    # UF sem governador do diretório só com motivo listado
    assert {uf for uf, (g, _, _) in GOVERNO_POR_UF.items() if g is None} == set(GOVERNADOR_EXCECOES)


def test_lista_curada_tem_acao_e_fonte():
    for x in EXECUTIVO_FORA_DO_TSE:
        assert x["acao"] in {"posse", "saida", "inicio"}
        assert x["fonte"].startswith("https://")


def test_quem_governa_bate_com_a_lista(conn):
    assert _n(conn, _q("lista conferida na fonte oficial")) == 0
    assert _n(conn, _q("termina até hoje")) == 0


def test_df_rj_rr_nao_mostram_quem_saiu(conn):
    rows = conn.execute(
        """select pl.uf, p.slug from mandates m join offices o on o.id = m.office_id and o.slug = 'governador'
           join places pl on pl.id = m.place_id join people p on p.id = m.person_id
           where pl.uf in ('DF','RJ','RR') and m.status = 'em_exercicio' and m.started_on <= current_date and m.ends_on > current_date"""
    ).fetchall()
    assert {(r["uf"], r["slug"]) for r in rows} == {("DF", "celina-leao")}


def test_check_pega_governador_que_ja_saiu(conn):
    # regressão do BUG-031: Ibaneis de volta a "em exercício" tem de quebrar os dois invariantes (desfeito no fim)
    with conn.transaction(force_rollback=True):
        conn.execute(
            """update mandates m set status = 'em_exercicio', ends_on = '2027-01-06' from people p, offices o
               where p.id = m.person_id and p.slug = 'ibaneis-rocha' and o.id = m.office_id and o.slug = 'governador' and m.started_on = '2023-01-01'"""
        )
        conn.execute(
            """update mandates m set status = 'encerrado', ends_on = '2026-04-01' from people p, offices o
               where p.id = m.person_id and p.slug = 'celina-leao' and o.id = m.office_id and o.slug = 'governador' and m.started_on = '2026-03-30'"""
        )
        assert _n(conn, _q("lista conferida na fonte oficial")) > 0
        assert _n(conn, _q("termina até hoje")) == 0  # Celina encerrada em 01/04 já passou; Ibaneis volta em exercício
    with conn.transaction(force_rollback=True):
        conn.execute(
            """update mandates m set ends_on = '2027-01-06' from people p, offices o
               where p.id = m.person_id and p.slug = 'claudio-castro' and o.id = m.office_id and o.slug = 'governador' and m.started_on = '2023-01-01'"""
        )
        assert _n(conn, _q("termina até hoje")) > 0  # renunciou e o mandato "segue" até 2027
