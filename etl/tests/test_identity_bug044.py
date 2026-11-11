"""BUG-044: título repetido pelo TSE na linha de outra pessoa com UM token de nome em comum ("Silva", "Maria", sobrenome de
família ou de etnia) ainda casava pelo título. A regra do D240 só recusava com nascimento diferente E nenhum token em comum.

Os nomes e nascimentos vêm do bug (dado público do TSE); onde o bug dá só o ano, o dia é sintético. Todos os títulos são
fictícios (prefixo 99990044). Os testes de banco criam tudo numa transação desfeita e não supõem banco vazio.
Os símbolos novos são importados dentro dos testes: sem a correção, cada teste falha na asserção ou no import dele, não na
coleta do arquivo."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from civico_etl.identity import PersonResolver, names_compatible

# (linha da fonte, nascimento) x (pessoa que já tem o título, nascimento). Um token em comum em cada par.
PARES = [
    (("GENILDE DOS SANTOS SILVA", date(1972, 10, 22)), ("Renata Emily da Silva Corrêa", date(1985, 6, 27))),  # Cruzeiro do Sul/AC: "silva"
    (("MARIA ISABEL DE SA MAMEDIR", date(1943, 1, 1)), ("Silvana Maria da Rocha Marques", date(1970, 1, 1))),  # Paty do Alferes/RJ: "maria"
    (("SARAH MAGALHAES URBIETA", date(1984, 12, 14)), ("Djalmiro Alves Urbieta Filho", date(1984, 12, 4))),  # Itumbiara/GO: "urbieta"
    (("KOTSARIO PEDRO KANAMARI", date(1999, 1, 1)), ("Daora Kanamari", date(1982, 1, 1))),  # Itamarati/AM: "kanamari"
]
TIT = "999900440001"


def _ids(conn):
    src = {r["slug"]: r["id"] for r in conn.execute("select slug, id from sources where slug in ('tse', 'tse-titulo')")}
    if len(src) < 2:
        pytest.skip("fontes do TSE não semeadas (civico-etl seed)")
    return src


def _person(conn, slug: str, civil: str, display: str, birth: date, titulo: str | None) -> str:
    pid = str(conn.execute("insert into people (slug, display_name, civil_name, birth_date) values (%s, %s, %s, %s) returning id",
                           (slug, display, civil, birth)).fetchone()["id"])
    if titulo:
        conn.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                        values (%s, (select id from sources where slug = 'tse-titulo'), %s, 'exact_id', 1)""", (pid, titulo))
    return pid


# ---------- regra pura ----------

@pytest.mark.parametrize("linha,pessoa", PARES)
def test_os_4_pares_do_bug_sao_de_outra_pessoa(linha, pessoa):
    from civico_etl.identity import title_row_foreign

    (nome, nasc), (pnome, pnasc) = linha, pessoa
    assert names_compatible(nome, pnome, None)  # o D240 casava: há um token em comum
    assert title_row_foreign(nome, nasc, pnome, None, pnasc)
    assert title_row_foreign(pnome, pnasc, nome, None, nasc)  # e nos dois sentidos


def test_dr_auri_continua_casando_com_o_hifen():
    from civico_etl.identity import first_name, title_row_foreign

    # linha de 2012: "AURI-WULANGE", nascimento com o mês trocado; a pessoa é "Auri Wulange Ribeiro Jorge" / "Dr Auri"
    assert first_name("AURI-WULANGE RIBEIRO JORGE") == "auri"
    assert not title_row_foreign("AURI-WULANGE RIBEIRO JORGE", date(1973, 6, 23), "Auri Wulange Ribeiro Jorge", "Dr Auri", date(1973, 7, 23))


@pytest.mark.parametrize("linha,pessoa", [
    ("TERESINHA MOREIRA", "Terezinha Moreira"),  # s/z (1 edição)
    ("HIDELMAR VIANA DA SILVA", "Hildemar Viana da Silva"),  # letras trocadas (2 edições)
    ("EDMAR FELIPPI", "Edemar Felippi"),  # letra a menos
    ("LUIS CARLOS CARNEIRO FROTA", "Luiz Carlos Carneiro Frota"),
    ("JOSÉ CARLOS PINHEIRO DOS SANTOS", "Jose Carlos Pinheiro dos Santos"),  # acento
    ("JAIME DOMINGO TAFFAREL", "Jaime Domingos Taffarel"),  # primeiro nome igual, sobrenome com grafia
])
def test_mesma_pessoa_com_grafia_variante_e_digito_errado_casa(linha, pessoa):
    """Aceite (c): grafia variante do nome e nascimento com um dígito errado (12 x 13) continuam casando pelo título."""
    from civico_etl.identity import title_row_foreign

    assert not title_row_foreign(linha, date(1961, 11, 12), pessoa, None, date(1961, 11, 13))


@pytest.mark.parametrize("linha,pessoa", [
    ("PAULO PEREIRA DA SILVA", "Paula Pereira da Silva"),  # troca a/o: irmão e irmã, não grafia
    ("JOAO PEREIRA DA SILVA", "José Santos da Silva"),  # 2 edições no primeiro nome, resto diferente
    ("ERIKA SANTOS LIMA", "Erivaldo Santos Lima"),  # primeiro nome a mais de 2 edições, mesmo sobrenome
])
def test_limite_primeiro_nome_perto_sem_o_resto_nao_casa(linha, pessoa):
    """Limite documentado da regra nova: perto no primeiro nome sem o resto do nome igual, ou a troca a/o, não casa."""
    from civico_etl.identity import title_row_foreign

    assert names_compatible(linha, pessoa, None)  # o D240 casava
    assert title_row_foreign(linha, date(1970, 1, 1), pessoa, None, date(1980, 1, 1))


def test_limite_irmaos_com_sobrenome_inteiro_igual_ainda_casam():
    """Limite conhecido (documentado em first_name_match): José x João com o sobrenome inteiro igual e nascimento diferente
    não se distingue de uma grafia. A regra nova não separa este caso; nada aqui fica pior que no D240."""
    from civico_etl.identity import title_row_foreign

    assert not title_row_foreign("JOAO PEREIRA DA SILVA", date(1975, 1, 1), "José Pereira da Silva", None, date(1960, 1, 1))


def test_regra_nova_contem_a_do_d240():
    """Tudo o que o D240 recusava, a regra nova recusa (Virginia x Willya, Manoel Juvenil x José Carlos)."""
    from civico_etl.identity import title_row_foreign

    for linha, nasc, pessoa, pnasc in [("VIRGINIA PEREIRA DE OLIVEIRA", date(1993, 8, 26), "Willya José da Silva", date(1972, 4, 20)),
                                       ("MANOEL JUVENIL PEREIRA DE SOUSA", date(1983, 11, 30), "José Carlos Pinheiro dos Santos", date(1974, 8, 30))]:
        assert not names_compatible(linha, pessoa, None) and title_row_foreign(linha, nasc, pessoa, None, pnasc)
    # nascimento igual: não é decidido por esta regra (a linha da mesma pessoa com nome social, D240)
    assert not title_row_foreign("ERIKA SANTOS HILTON", date(1992, 1, 1), "Erik Santos", None, date(1992, 1, 1))


def test_nomes_diferentes_na_mesma_eleicao():
    from civico_etl.identity import names_differ

    assert names_differ("MARIA ISABEL DE SA MAMEDIR", "SILVANA MARIA DA ROCHA MARQUES")
    assert names_differ("NEI DE PAULA", "JUCINEI ANTONIO DE PAULA")
    # registro substituído da mesma pessoa com grafia variante (2012): não é "nome diferente"
    assert not names_differ("LUIZ MARCELO CAMERON", "LUIS MARCELO COMERON")


# ---------- resolve, contra o banco (transação desfeita) ----------

@pytest.mark.parametrize("linha,pessoa", PARES)
def test_resolve_nao_casa_pelo_titulo_com_um_token_em_comum(conn, linha, pessoa):
    _ids(conn)
    (nome, nasc), (pnome, pnasc) = linha, pessoa
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-dono", pnome, pnome, pnasc, TIT)
        pr = PersonResolver(conn)
        m = pr.resolve(source="tse", external_id="2099:440001", titulo=TIT, civil_name=nome, birth_date=nasc, uf="AC", year=2099)
        assert m.person_id != pid and m.title_foreign
        assert not any(e[2] == TIT and e[0] != pid for e in pr._pending_ext)  # o título não vai para ninguém mais


def test_resolve_mesma_pessoa_com_grafia_e_digito_casa_pelo_titulo(conn):
    _ids(conn)
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-terezinha", "Terezinha Moreira", "Terezinha", date(1961, 11, 13), TIT)
        auri = _person(conn, "teste-bug044-auri", "Auri Wulange Ribeiro Jorge", "Dr Auri", date(1973, 7, 23), "999900440002")
        pr = PersonResolver(conn)
        m = pr.resolve(source="tse", external_id="2099:440002", titulo=TIT, civil_name="TERESINHA MOREIRA", birth_date=date(1961, 11, 12), uf="SP", year=2099)
        assert (m.person_id, m.method, m.title_foreign) == (pid, "exact_id", False)
        m = pr.resolve(source="tse", external_id="2099:440003", titulo="999900440002", civil_name="AURI-WULANGE RIBEIRO JORGE",
                       birth_date=date(1973, 6, 23), uf="SP", year=2099)
        assert (m.person_id, m.method, m.title_foreign) == (auri, "exact_id", False)


def test_resolve_titulo_em_2_sq_da_mesma_eleicao_nao_prova_nenhuma_linha(conn):
    """Paty do Alferes/RJ 2012: o mesmo título em 2 SQ da eleição ordinária, Maria Isabel (1943) e Silvana Maria (1970).
    Nem a linha da própria Silvana, com o nascimento dela, casa pelo título: o título não prova nada naquele ano."""
    _ids(conn)
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 2, 21), TIT)
        conn.execute(
            """insert into tse_titulo_candidatura (titulo, year, ue, tse_sequencial, kind, civil_name, birth_date) values
               (%s, 2012, '99001', '99000440001', 'ordinaria', 'MARIA ISABEL DE SA MAMEDIR', '1943-08-31'),
               (%s, 2012, '99001', '99000440002', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-02-21'),
               (%s, 2016, '99001', '99000440003', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-02-21')""", (TIT, TIT, TIT))
        pr = PersonResolver(conn)
        assert pr.shared_title(TIT, 2012) and not pr.shared_title(TIT, 2016)
        m = pr.resolve(source="tse", external_id="2012:99001:99000440002", titulo=TIT, civil_name="SILVANA MARIA DA ROCHA MARQUES",
                       birth_date=date(1970, 2, 21), uf="RJ", year=2012)
        assert m.method != "exact_id" and m.title_foreign
        # em 2016 o título aparece uma vez só: casa
        m = pr.resolve(source="tse", external_id="2016:99000440003", titulo=TIT, civil_name="SILVANA MARIA DA ROCHA MARQUES",
                       birth_date=date(1970, 2, 21), uf="RJ", year=2016)
        assert (m.person_id, m.method) == (pid, "exact_id")


def test_resolve_titulo_em_2_sq_vindo_da_carga(conn):
    """O ano ainda não está em tse_titulo_candidatura: as linhas da própria carga (note_title_rows) bastam."""
    from civico_etl.jobs.tse_candidatos import title_rows

    _ids(conn)
    rows = [dict(ANO_ELEICAO="2098", SG_UE="99001", SQ_CANDIDATO=sq, SG_UF="RJ", CD_CARGO="13", NR_TITULO_ELEITORAL_CANDIDATO=TIT,
                 NM_TIPO_ELEICAO="ELEIÇÃO ORDINÁRIA", NR_TURNO="1", DS_SIT_TOT_TURNO=res, NM_CANDIDATO=nome, DT_NASCIMENTO=nasc, NR_CANDIDATO="1")
            for sq, nome, nasc, res in [("99000440004", "MARIA ISABEL DE SA MAMEDIR", "31/08/1943", "ELEITO"),
                                        ("99000440005", "SILVANA MARIA DA ROCHA MARQUES", "21/02/1970", "NÃO ELEITO")]]
    with conn.transaction(force_rollback=True):
        _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 2, 21), TIT)
        pr = PersonResolver(conn)
        assert not pr.shared_title(TIT, 2098)
        pr.note_title_rows(title_rows(rows, None))
        m = pr.resolve(source="tse", external_id="2098:99000440004", titulo=TIT, civil_name="MARIA ISABEL DE SA MAMEDIR",
                       birth_date=date(1943, 8, 31), uf="RJ", year=2098)
        assert m.method != "exact_id" and m.title_foreign


def test_carga_so_de_eleitos_le_o_2o_sq_do_titulo(tmp_path: Path):
    """A carga padrão filtra eleitos; o SQ não eleito com o mesmo título tem de chegar ao resolve (BUG-044)."""
    from civico_etl.jobs.tse_candidatos import COLS, title_source_rows

    linhas = [{**{c: "" for c in COLS}, "NR_TITULO_ELEITORAL_CANDIDATO": t, "SQ_CANDIDATO": sq, "DS_SIT_TOT_TURNO": res, "NR_TURNO": "1"}
              for t, sq, res in [(TIT, "1", "ELEITO"), (TIT, "2", "NÃO ELEITO"), ("999900440009", "3", "NÃO ELEITO")]]
    p = tmp_path / "consulta_cand_2098_RJ.utf8.csv"
    p.write_text("\n".join([";".join(f'"{c}"' for c in COLS)] + [";".join(f'"{x[c]}"' for c in COLS) for x in linhas]) + "\n", encoding="utf-8")
    where = "where DS_SIT_TOT_TURNO in ('ELEITO','ELEITO POR QP','ELEITO POR MÉDIA') or (NR_TURNO = '1' and DS_SIT_TOT_TURNO = '2º TURNO')"
    got = title_source_rows([p], where, [])
    assert sorted(x["SQ_CANDIDATO"] for x in got) == ["1", "2"]  # o 2º SQ do título, não eleito; o título alheio fica fora
    assert title_source_rows([p], "", linhas) is linhas  # --all: as linhas da carga já são todas


# ---------- check (D240 alinhado à regra nova) ----------

def _cand(conn, pid: str, year: int, sq: str, kind: str = "municipal") -> str:
    place = conn.execute("""insert into places (ibge_code, kind, name, slug, uf) values ('9904400', 'municipio', 'Teste BUG-044', 'teste-bug-044', 'AC')
                            on conflict (ibge_code) do update set name = excluded.name returning id""").fetchone()["id"]
    el = conn.execute("""insert into elections (kind, year, round, held_on) values (%s, %s, 1, %s)
                         on conflict (kind, year, round, held_on) do update set kind = excluded.kind returning id""",
                      (kind, year, date(year, 10, 1))).fetchone()["id"]
    ct = conn.execute("""insert into contests (election_id, office_id, place_id) values (%s, (select id from offices where slug = 'vereador'), %s)
                         on conflict (election_id, office_id, place_id) do update set place_id = excluded.place_id returning id""", (el, place)).fetchone()["id"]
    return str(conn.execute("""insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name)
                               values (%s, %s, %s, %s, 'Teste') returning id""", (ct, el, pid, sq)).fetchone()["id"])


def test_check_pega_o_titulo_repetido_com_um_token_que_o_d240_nao_ve(conn):
    from civico_etl.jobs.checks_identity import IDENTITY_CHECKS, IDENTITY_PY_CHECKS, bug044_offenders

    d240 = next(q for n, q in IDENTITY_CHECKS if "outro nascimento e nome civil" in n)
    novo = next(fn for n, fn in IDENTITY_PY_CHECKS if "BUG-044" in n)
    _ids(conn)
    with conn.transaction(force_rollback=True):
        antes_d240, antes = list(conn.execute(d240).fetchone().values())[0], novo(conn)
        # Renata tem o título; a candidatura de 2024 cuja linha da fonte é da Genilde ficou nela
        pid = _person(conn, "teste-bug044-renata", "Renata Emily da Silva Corrêa", "Renata", date(1985, 6, 27), TIT)
        _cand(conn, pid, 2096, "99000440010")
        conn.execute("""insert into tse_titulo_candidatura (titulo, year, ue, tse_sequencial, kind, civil_name, birth_date)
                        values (%s, 2096, '99044', '99000440010', 'ordinaria', 'GENILDE DOS SANTOS SILVA', '1972-10-22')""", (TIT,))
        assert list(conn.execute(d240).fetchone().values())[0] == antes_d240  # o D240 não vê: "silva" em comum
        assert novo(conn) == antes + 1
        assert "99000440010" in {r["tse_sequencial"] for r in bug044_offenders(conn)}


def test_check_pega_a_linha_alheia_do_titulo_em_2_sq_mesmo_com_nascimento_igual(conn):
    from civico_etl.jobs.checks_identity import IDENTITY_PY_CHECKS

    novo = next(fn for n, fn in IDENTITY_PY_CHECKS if "BUG-044" in n)
    _ids(conn)
    with conn.transaction(force_rollback=True):
        antes = novo(conn)
        pid = _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 2, 21), TIT)
        _cand(conn, pid, 2095, "99000440011")  # a da Silvana: certa
        conn.execute(
            """insert into tse_titulo_candidatura (titulo, year, ue, tse_sequencial, kind, civil_name, birth_date) values
               (%s, 2095, '99044', '99000440011', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-02-21'),
               (%s, 2095, '99045', '99000440012', 'ordinaria', 'MARIA ISABEL DE SA MAMEDIR', '1970-02-21')""", (TIT, TIT))
        assert novo(conn) == antes  # a linha da própria pessoa não dispara
        # a candidatura passa a ser a da linha da Maria Isabel (nascimento igual, por hipótese), na Silvana: errada
        conn.execute("update candidacies set tse_sequencial = '99000440012' where person_id = %s", (pid,))
        assert novo(conn) == antes + 1
