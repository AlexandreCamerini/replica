"""BUG-041: título repetido pelo TSE na linha de outra pessoa. BUG-042: título reemitido no mesmo município com outra grafia.
BUG-043: registro substituído que ficou no lugar do válido. D240-D243."""

from __future__ import annotations

from datetime import date

import pytest

from civico_etl.identity import PersonResolver, edit_distance, names_compatible, phonetic
from civico_etl.jobs.checks_identity import IDENTITY_CHECKS
from civico_etl.jobs.tse_candidatos import title_rows

FOREIGN_CHECK = next(q for n, q in IDENTITY_CHECKS if "outro nascimento e nome civil" in n)
RANK_CHECK = next(q for n, q in IDENTITY_CHECKS if "posto maior na fonte" in n)


def _n(conn, q: str) -> int:
    return list(conn.execute(q).fetchone().values())[0]


def test_nome_compativel():
    assert not names_compatible("VIRGINIA PEREIRA DE OLIVEIRA", "Willya José da Silva", "Willya do Rampa")
    assert names_compatible("TERESINHA MOREIRA", "Terezinha Moreira", None)  # grafia: 'moreira' em comum
    assert names_compatible("BENNIO AUGUSTO ROSA", "Bennio Augusto", "Benny Briolly")


def test_fonetica_separa_grafia_de_outro_nome():
    assert phonetic("ELOISA SARAIVA CARDOSO REIS") == phonetic("Eloiza Saraiva Cardoso Reis")
    assert phonetic("NELSON GASPERIM JUNIOR") == phonetic("Nelson Gasperin Junior")
    # gêmeos e nomes diferentes a 2 edições continuam diferentes
    for a, b in [("Marcos Pereira da Silva", "Marcio Pereira da Silva"), ("Evaldo Ferreira da Costa", "Evandro Ferreira da Costa"),
                 ("Kassâmio Leal Paraíba", "Kassio Leal Paraíba")]:
        assert edit_distance(a.lower(), b.lower()) <= 2 and phonetic(a) != phonetic(b)
    assert edit_distance("abc", "xyzw") == 3


def test_linha_de_titulo_guarda_nome_nascimento_numero():
    row = dict(ANO_ELEICAO="2012", SG_UE="92835", SQ_CANDIDATO="90000003345", SG_UF="GO", CD_CARGO="13", NR_TITULO_ELEITORAL_CANDIDATO="025677851031",
               NM_TIPO_ELEICAO="ELEIÇÃO ORDINÁRIA", NR_TURNO="1", DS_SIT_TOT_TURNO="#NULO#", NM_CANDIDATO="VIRGINIA PEREIRA DE OLIVEIRA",
               DT_NASCIMENTO="26/08/1993", NR_CANDIDATO="14222")
    assert title_rows([row], None) == [("025677851031", 2012, "92835", "90000003345", "ordinaria", "GO", "vereador", "#NULO#",
                                        "VIRGINIA PEREIRA DE OLIVEIRA", date(1993, 8, 26), 14222)]


def _people(conn, *slugs):
    got = {r["slug"]: r["id"] for r in conn.execute("select slug, id::text from people where slug = any(%s)", (list(slugs),))}
    if len(got) < len(slugs):
        pytest.skip(f"pessoas do BUG-041/042 não estão neste banco: {set(slugs) - set(got)}")
    return got


def _place(conn, uf: str, name: str) -> str:
    return str(conn.execute("select id from places where kind = 'municipio' and uf = %s and name = %s", (uf, name)).fetchone()["id"])


def test_resolve_titulo_repetido_nao_casa(conn):
    """Só lê: nada é gravado sem flush."""
    ids = _people(conn, "willya-do-rampa")
    pr = PersonResolver(conn)
    m = pr.resolve(source="tse", external_id="2099:41", titulo="025677851031", civil_name="Virginia Pereira de Oliveira",
                   birth_date=date(1993, 8, 26), uf="GO", year=2099)
    assert m.person_id != ids["willya-do-rampa"] and m.title_foreign
    # a linha dele, com o mesmo título e outro nascimento digitado, continua casando (nome compatível)
    m = pr.resolve(source="tse", external_id="2099:42", titulo="025677851031", civil_name="Willya Jose da Silva",
                   birth_date=date(1972, 4, 21), uf="GO", year=2099)
    assert m.person_id == ids["willya-do-rampa"] and m.method == "exact_id" and not m.title_foreign


def test_resolve_reemissao_no_mesmo_municipio(conn):
    ids = _people(conn, "eloisa-cardoso", "mano-sc")
    pr = PersonResolver(conn)
    sericita = _place(conn, "MG", "Sericita")
    m = pr.resolve(source="tse", external_id="2099:43", titulo="000000000191", civil_name="Eloisa Saraiva Cardoso Reis",
                   birth_date=date(1966, 1, 20), uf="MG", place_id=sericita, year=2099)
    assert m.person_id == ids["eloisa-cardoso"] and m.method == "name_birth_place" and "reemitido" in (m.why or "")
    # mesma grafia, outro município da mesma UF: fila
    m = pr.resolve(source="tse", external_id="2099:44", titulo="000000000272", civil_name="Eloisa Saraiva Cardoso Reis",
                   birth_date=date(1966, 1, 20), uf="MG", place_id=_place(conn, "MG", "Ponte Nova"), year=2099)
    assert m.method == "queued"
    # gêmeos? Marcos x Márcio Pereira da Silva, Araranguá, mesmo nascimento: não funde, vai para a fila
    m = pr.resolve(source="tse", external_id="2099:45", titulo="000000000353", civil_name="Marcos Pereira da Silva",
                   birth_date=date(1981, 1, 18), uf="SC", place_id=_place(conn, "SC", "Araranguá"), year=2099)
    assert m.method == "queued" and m.person_id is None


def test_titulo_nao_divulgavel_nao_e_id(conn):
    pr = PersonResolver(conn)
    m = pr.resolve(source="tse", external_id="2099:46", titulo="-4", civil_name="Ninguem de Teste Nenhum", birth_date=date(1901, 1, 1), uf="SP")
    assert m.method == "new" and not any(e[1] == pr.sources["tse-titulo"] for e in pr._pending_ext)


def test_banco_separado_e_recuperado(conn):
    _people(conn, "willya-do-rampa", "eloisa-cardoso", "peixe-sc", "veter-martins")
    rows = {r["slug"]: r for r in conn.execute(
        """select p.slug, array_agg(e.year || ':' || coalesce(c.result, '-') order by e.year) ys from people p
           join candidacies c on c.person_id = p.id join elections e on e.id = c.election_id
           where p.slug in ('willya-do-rampa', 'eloisa-cardoso', 'peixe-sc', 'veter-martins') group by 1""")}
    assert not any(y.startswith("2012") for y in rows["willya-do-rampa"]["ys"])
    assert "2016:eleito_qp" in rows["eloisa-cardoso"]["ys"]
    assert "2012:eleito" in rows["peixe-sc"]["ys"]
    assert "2014:nao_eleito" in rows["veter-martins"]["ys"]
    v = conn.execute("""select p.slug, p.civil_name from candidacies c join people p on p.id = c.person_id
                        where c.tse_sequencial = '90000003345'""").fetchone()
    assert v["civil_name"] == "Virginia Pereira de Oliveira" and v["slug"] != "willya-do-rampa"


def test_checks_pegam_as_classes(conn):
    _people(conn, "willya-do-rampa", "veter-martins")
    with conn.transaction(force_rollback=True):
        assert _n(conn, FOREIGN_CHECK) == 0
        conn.execute("""update candidacies set person_id = (select id from people where slug = 'willya-do-rampa')
                        where tse_sequencial = '90000003345'""")
        assert _n(conn, FOREIGN_CHECK) == 1
    with conn.transaction(force_rollback=True):
        assert _n(conn, RANK_CHECK) == 0
        # o banco volta a ter o #NULO# de 2014 no lugar do NÃO ELEITO (90000001316)
        conn.execute("""update candidacies set tse_sequencial = '90000000567' where tse_sequencial = '90000001316'
                        and person_id = (select id from people where slug = 'veter-martins')""")
        assert _n(conn, RANK_CHECK) == 1
