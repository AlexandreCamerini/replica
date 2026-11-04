"""BUG-033: o ramo "cadeira" do identity.resolve fundia pessoas sem nome civil em comum (mesmo nascimento ou mesmo nome
parlamentar na bancada). Eli Corrêa Filho (Câmara 160532) caiu no crachá de Geninho Zuliani; Átila Lira e João Carlos Bacelar
pais caíram nos crachás dos filhos."""

from __future__ import annotations

from datetime import date

import pytest

from civico_etl.identity import PersonResolver, name_tokens, seat_match
from civico_etl.jobs.checks_identity import IDENTITY_CHECKS

TWO_IDS_CHECK = next(q for n, q in IDENTITY_CHECKS if "mais de um id da Câmara" in n)


def test_tokens_sem_particulas_nem_parentesco():
    assert name_tokens("João Carlos Paolilo Bacelar Filho") == {"joao", "carlos", "paolilo", "bacelar"}
    assert name_tokens("Átila de Melo Lira") == {"atila", "melo", "lira"}
    assert name_tokens(None) == set()


def test_mesmo_nascimento_sem_nome_em_comum_nao_casa():
    # Adriano Eli Corrêa x Eugenio José Zuliani: ambos de 13/01/1976, bancada de SP
    assert not seat_match("Adriano Eli Corrêa", date(1976, 1, 13), "Eugenio Jose Zuliani", "Geninho Zuliani", date(1976, 1, 13))


def test_pai_e_filho_nao_casam():
    # nome parlamentar igual e nomes civis parecidos, nascimento diferente
    assert not seat_match("Átila Freitas Lira", date(1947, 4, 7), "Átila de Melo Lira", "Átila Lira", date(1980, 4, 1))
    assert not seat_match("João Carlos Paolilo Bacelar", date(1941, 12, 3), "João Carlos Paolilo Bacelar Filho", "João Carlos Bacelar", date(1972, 10, 8))


def test_mesma_pessoa_casa():
    assert seat_match("Eugenio José Zuliani", date(1976, 1, 13), "Eugenio Jose Zuliani", None, date(1976, 1, 13))
    # o nome da casa pode vir abreviado: um token em comum basta, com o nascimento
    assert seat_match("Luis Eduardo Girão", date(1972, 9, 25), "Luis Eduardo Grangeiro Girão", None, date(1972, 9, 25))


def test_sem_nascimento_nao_e_prova():
    assert not seat_match("Eugenio José Zuliani", None, "Eugenio Jose Zuliani", None, date(1976, 1, 13))
    assert not seat_match("Eugenio José Zuliani", date(1976, 1, 13), "Eugenio Jose Zuliani", None, None)


def _seat(conn, slug: str):
    r = conn.execute(
        """select m.office_id::text o, m.place_id::text p from mandates m join people x on x.id = m.person_id
           join offices o on o.id = m.office_id where x.slug = %s and o.slug = 'deputado_federal' order by m.started_on desc limit 1""",
        (slug,)).fetchone()
    if not r:
        pytest.skip(f"{slug} sem mandato de deputado federal neste banco")
    return r["o"], r["p"]


def test_banco_resolve_nao_funde_de_novo(conn):
    """O resolve com os dados da API para os ids separados não devolve o crachá errado (só lê; nada é gravado sem flush)."""
    pr = PersonResolver(conn)
    geninho = conn.execute("select id::text from people where slug = 'geninho-sp'").fetchone()
    atila = conn.execute("select id::text from people where slug = 'atila'").fetchone()
    if not geninho or not atila:
        pytest.skip("crachás do BUG-033 não estão neste banco")
    m = pr.resolve(source="camara", external_id="160532", civil_name="Adriano Eli Corrêa", birth_date=date(1976, 1, 13), birth_uf="SP",
                   seat=_seat(conn, "geninho-sp"), display_name="Eli Corrêa Filho")
    assert m.person_id != geninho["id"]
    m = pr.resolve(source="camara", external_id="74459", civil_name="Átila Freitas Lira", birth_date=date(1947, 4, 7), birth_uf="PI",
                   seat=_seat(conn, "atila"), display_name="Átila Lira")
    assert m.person_id != atila["id"]
    # mesmo nome civil + nascimento de quem já tem outro id da Câmara: fila, não fusão
    m = pr.resolve(source="camara", external_id="999999999", civil_name="Átila de Melo Lira", birth_date=date(1980, 4, 1))
    assert m.method == "queued" and m.person_id is None


def test_banco_crachas_separados(conn):
    rows = {r["slug"]: r for r in conn.execute(
        """select p.slug, p.display_name, array_agg(e.external_id order by e.external_id) ids from people p
           join person_external_ids e on e.person_id = p.id join sources s on s.id = e.source_id and s.slug = 'camara'
           where p.slug in ('geninho-sp', 'atila', 'joao-carlos-bacelar') group by 1, 2""")}
    if len(rows) < 3:
        pytest.skip("crachás do BUG-033 não estão neste banco")
    assert rows["geninho-sp"]["ids"] == ["204527"] and rows["geninho-sp"]["display_name"] == "Geninho Zuliani"
    assert rows["atila"]["ids"] == ["123086"]
    assert rows["joao-carlos-bacelar"]["ids"] == ["141458"] and rows["joao-carlos-bacelar"]["display_name"] == "João Carlos Bacelar"
    # nenhuma cota do outro deputado ficou no crachá
    n = conn.execute("""select count(*) n from expenses x join people p on p.id = x.person_id
                        where (p.slug = 'geninho-sp' and x.source_key ~ ':160532:') or (p.slug = 'atila' and x.source_key ~ ':74459:')""").fetchone()["n"]
    assert n == 0


def test_check_pega_dois_ids_da_camara(conn):
    p = conn.execute("select id from people where slug = 'atila'").fetchone()
    if not p:
        pytest.skip("atila não está neste banco")
    with conn.transaction(force_rollback=True):
        assert list(conn.execute(TWO_IDS_CHECK).fetchone().values())[0] == 0
        conn.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                        select %s, id, '74459', 'name_birth_place', 0.9 from sources where slug = 'camara'
                        on conflict (source_id, external_id) do update set person_id = excluded.person_id""", (p["id"],))
        assert list(conn.execute(TWO_IDS_CHECK).fetchone().values())[0] == 1
