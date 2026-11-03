"""BUG-032: identidade casada pelo SQ_CANDIDATO sem o ano. O TSE reaproveita o SQ entre eleições (2012, 2014, 2016)."""

from __future__ import annotations

import inspect
from datetime import date

from civico_etl.jobs import tse_candidatos
from civico_etl.jobs.checks_identity import IDENTITY_CHECKS
from civico_etl.jobs.tse_bug032 import Pessoa, Src, find_owner, norm_titulo, same_person
from civico_etl.jobs.tse_candidatos import tse_key

ROBERTO = Pessoa({"31415252232"}, {"roberto maia cidade filho", "roberto cidade"}, date(1983, 1, 1))
# a linha da fonte de 2012 com o mesmo SQ 40000001600 é de outra pessoa (nome de urna "Dinelci", Fonte Boa)
DINELCI = Src("99887766554", "dinelci de souza", date(1970, 5, 5), "DINELCI", "FONTE BOA/AM")


def test_chave_tse_tem_o_ano():
    assert tse_key(2012, "40000001600") == "2012:40000001600"
    assert tse_key(2016, "40000001600") != tse_key(2012, "40000001600")


def test_loader_usa_a_chave_com_ano():
    src = inspect.getsource(tse_candidatos._load_year)
    assert 'external_id=sq' not in src
    assert src.count("external_id=tse_key(year, sq)") == 2  # resolve e create


def test_mesmo_sq_outra_pessoa_nao_casa():
    assert same_person(DINELCI, ROBERTO) is None


def test_prova_por_titulo_ou_nome_nascimento():
    assert same_person(Src(norm_titulo("031415252232"), "x", None, "", ""), ROBERTO) == "titulo"  # zero à esquerda não importa
    # título trocado (transferência), mesmo nome civil e nascimento: é a mesma pessoa
    assert same_person(Src("11112222333", "roberto maia cidade filho", date(1983, 1, 1), "", ""), ROBERTO) == "nome_nasc"
    # mesmo nome, outro nascimento: não
    assert same_person(Src("11112222333", "roberto maia cidade filho", date(1984, 1, 1), "", ""), ROBERTO) is None


def test_titulo_nao_divulgavel_nao_e_prova():
    assert norm_titulo("-4") is None and norm_titulo("#NULO#") is None and norm_titulo("") is None
    assert norm_titulo("023976801422") == "23976801422"


def test_dono_ambiguo_nao_casa():
    by_nb = {("maria da silva", date(1960, 1, 1)): {"a", "b"}}
    assert find_owner(Src(None, "maria da silva", date(1960, 1, 1), "", ""), {}, by_nb, "z") == (None, "ambiguo")
    assert find_owner(Src(None, "maria da silva", date(1961, 1, 1), "", ""), {}, by_nb, "z") == (None, "sem_pessoa")
    assert find_owner(Src("123456789", "", None, "", ""), {"123456789": {"p"}}, {}, "z") == ("p", "titulo")
    # a pessoa errada não é candidata a dona
    assert find_owner(Src("123456789", "", None, "", ""), {"123456789": {"z"}}, {}, "z") == (None, "sem_pessoa")


def test_banco_roberto_cidade_sem_candidatura_de_2012(conn):
    rows = conn.execute(
        """select e.year, c.ballot_name from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
           where p.slug = 'roberto-cidade'""").fetchall()
    if not rows:
        import pytest

        pytest.skip("roberto-cidade não está neste banco")
    assert all(r["year"] != 2012 for r in rows)
    assert all(r["ballot_name"] != "Dinelci" for r in rows)


def test_banco_invariantes_de_identidade(conn):
    for name, q in IDENTITY_CHECKS:
        n = list(conn.execute(q).fetchone().values())[0]
        assert n == 0, name
