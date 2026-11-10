"""BUG-035 e BUG-036: no consulta_cand_2012 o SQ_CANDIDATO se repete entre a eleição ordinária e as suplementares (91 SQ, cada
um de duas pessoas de municípios diferentes). A chave de 2012 passa a ser ANO:UE:SQ, e a linha da fonte de uma candidatura é a
do município da disputa."""

from __future__ import annotations

from datetime import date

import pytest

from civico_etl.jobs.checks_identity import IDENTITY_CHECKS
from civico_etl.jobs.tse_bug032 import Src
from civico_etl.jobs.tse_bug035 import Row, pick_row
from civico_etl.jobs.tse_candidatos import TSE_TO_IBGE, tse_key

DUP_CHECK = next(q for n, q in IDENTITY_CHECKS if "duas candidaturas do mesmo ano e SQ" in n)
# SQ 140000001581 em 2012: vereador suplente em Bom Jesus do Tocantins (ordinária) e prefeito eleito em Santa Maria do Pará
# (suplementar), duas pessoas
BJT = Row("140000001581", "04049", "place-bjt", "municipal", date(2012, 10, 7), "13",
          Src("25895861392", "junior do bacabal", None, "JUNIOR DO BACABAL", "BOM JESUS DO TOCANTINS/PA"), "SUPLENTE")
SMP = Row("140000001581", "05312", "place-smp", "suplementar", None, "11",
          Src("20007371309", "alcir costa da silva", None, "ALCIR COSTA", "SANTA MARIA DO PARÁ/PA"), "ELEITO")


def test_chave_2012_tem_a_ue():
    assert tse_key(2012, "140000001581", "05312") == "2012:05312:140000001581"
    assert tse_key(2012, "140000001581", "04049") != tse_key(2012, "140000001581", "05312")
    with pytest.raises(ValueError):
        tse_key(2012, "140000001581")
    assert tse_key(2016, "140000001581") == "2016:140000001581"  # fora de 2012, o SQ é único no arquivo


def test_linha_da_candidatura_e_a_do_municipio():
    assert pick_row([BJT, SMP], "place-smp") is SMP
    assert pick_row([BJT, SMP], "place-bjt") is BJT
    assert pick_row([BJT, SMP], "place-smp", "suplementar") is SMP
    assert pick_row([BJT, SMP], "place-smp", "municipal") is None  # tipo de eleição não bate: não chuta
    assert pick_row([BJT, SMP], "outro") is None
    assert pick_row([SMP], "qualquer") is SMP  # SQ único: basta o SQ


def test_grafias_de_2012_mapeadas_para_o_ibge():
    for k in [("RO", "machadinho do oeste"), ("CE", "itapage"), ("PE", "iguaraci"), ("BA", "quinjingue"), ("RN", "ares")]:
        assert k in TSE_TO_IBGE


def test_banco_candidaturas_restauradas(conn):
    """Alcir Costa (prefeito, suplementar de Santa Maria do Pará), Professor Wander (vice, Jundiaí do Sul) e Nei (vereador,
    Salesópolis) voltam a ter a candidatura de 2012 e o mandato."""
    rows = conn.execute(
        """select p.slug, c.result, e.kind, (select count(*) from mandates m where m.candidacy_id = c.id) mandatos
           from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
           where e.year = 2012 and (p.slug, c.tse_sequencial) in
             (('alcir-costa', '140000001581'), ('professor-wander-pr', '160000001562'), ('nei-do-ze-do-anisio', '250000004507'))""").fetchall()
    if not conn.execute("select 1 from people where slug = 'alcir-costa'").fetchone():
        pytest.skip("alcir-costa não está neste banco")
    got = {r["slug"]: r for r in rows}
    assert set(got) == {"alcir-costa", "professor-wander-pr", "nei-do-ze-do-anisio"}
    assert got["alcir-costa"]["kind"] == "suplementar" and got["alcir-costa"]["mandatos"] == 1
    assert got["nei-do-ze-do-anisio"]["kind"] == "municipal" and got["nei-do-ze-do-anisio"]["mandatos"] == 1
    assert got["professor-wander-pr"]["mandatos"] == 1
    # a segunda remoção do Nei (suplementar de Canas, SQ igual) é de outra pessoa e fica removida
    n = conn.execute("""select count(*) n from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
                        where p.slug = 'nei-do-ze-do-anisio' and e.year = 2012""").fetchone()["n"]
    assert n == 1


def test_banco_eleitos_de_2012_com_a_candidatura(conn):
    """BUG-036: exemplos da reverificação (vereador de Maceió, prefeita de Olho d'Água Grande, Corbélia, Domingos Mourão)."""
    slugs = ["davi-davino", "suzy-higino", "paulinho-zaquette", "lauro-bandeira"]
    have = {r["slug"] for r in conn.execute("select slug from people where slug = any(%s)", (slugs,))}
    if not have:
        pytest.skip("exemplos do BUG-036 não estão neste banco")
    com = {r["slug"] for r in conn.execute(
        """select distinct p.slug from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
           where e.year = 2012 and p.slug = any(%s) and c.result in ('eleito', 'eleito_qp', 'eleito_media')""", (slugs,))}
    assert com == have


def test_check_pega_as_duas_linhas_do_sq_na_mesma_pessoa(conn):
    """Sintoma do BUG-035: o reparo do BUG-032 tinha posto a candidatura de Mané da Ambulância (Salto do Itararé) em João
    Ardigo, dono da linha da suplementar de Rolândia com o mesmo SQ. Reproduz numa pessoa descartável (transação desfeita)."""
    ids = [r["id"] for r in conn.execute(
        """select c.id from candidacies c join elections e on e.id = c.election_id
           where e.year = 2012 and e.round = 1 and c.tse_sequencial = '160000001663'""").fetchall()]
    if len(ids) < 2:
        pytest.skip("as duas candidaturas do SQ 160000001663 não estão neste banco")
    with conn.transaction(force_rollback=True):
        assert list(conn.execute(DUP_CHECK).fetchone().values())[0] == 0
        pid = conn.execute("insert into people (slug, display_name) values ('teste-bug035-descartavel', 'Teste') returning id").fetchone()["id"]
        conn.execute("update candidacies set person_id = %s where id = any(%s)", (pid, ids))
        assert list(conn.execute(DUP_CHECK).fetchone().values())[0] == 1
