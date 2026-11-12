"""BUG-044: título repetido pelo TSE na linha de outra pessoa com UM token de nome em comum ("Silva", "Maria", sobrenome de
família ou de etnia) ainda casava pelo título. A regra do D240 só recusava com nascimento diferente E nenhum token em comum.

Só o que está na entrada BUG-044 de replica/bugs.md (dado público do TSE): os nomes dos 4 pares, o nascimento de Genilde e
Renata, os anos de Maria Isabel, Silvana, Daora e Kotsario (com dia 1º) e o trecho "AURI-WULANGE". Djalmiro e Sarah têm
nascimento sintético (o bug não publica). Todo o resto (grafia, irmãos, pai e filho, D240) usa nomes e datas inventados.
Todos os títulos são fictícios (prefixo 99990044); nenhum CPF. Os testes de banco criam tudo numa transação desfeita e não supõem banco vazio.
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
    (("SARAH MAGALHAES URBIETA", date(1950, 3, 3)), ("Djalmiro Alves Urbieta Filho", date(1940, 4, 4))),  # nascimentos sintéticos  # Itumbiara/GO: "urbieta"
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

    # a linha traz "AURI-WULANGE" com o mês do nascimento trocado; sobrenomes e datas sintéticos
    assert first_name("AURI-WULANGE TESTE SINTETICO") == "auri"
    assert not title_row_foreign("AURI-WULANGE TESTE SINTETICO", date(1970, 6, 1), "Auri Wulange Teste Sintetico", "Dr Auri", date(1970, 7, 1))


@pytest.mark.parametrize("linha,pessoa", [
    ("TERESINHA ALVES TESTE", "Terezinha Alves Teste"),  # s/z (1 edição)
    ("GIDELMAR VIANA TESTE", "Gildemar Viana Teste"),  # letras trocadas (2 edições)
    ("EDMAR FICTICIO", "Edemar Ficticio"),  # letra a menos
    ("LUIS CARLOS SINTETICO", "Luiz Carlos Sintetico"),
    ("JOSÉ CARLOS EXEMPLO DOS SANTOS", "Jose Carlos Exemplo dos Santos"),  # acento
    ("FICTOR DOMINGO TESTEIRO", "Fictor Domingos Testeiro"),  # primeiro nome igual, sobrenome com grafia
])
def test_mesma_pessoa_com_grafia_variante_e_digito_errado_casa(linha, pessoa):
    """Aceite (c): grafia variante do nome e nascimento com um dígito errado (12 x 13) continuam casando pelo título."""
    from civico_etl.identity import title_row_foreign

    assert not title_row_foreign(linha, date(1961, 11, 12), pessoa, None, date(1961, 11, 13))


@pytest.mark.parametrize("linha,pessoa", [
    # A1: só um dos dois primeiros nomes termina em "a" (irmão e irmã), com o sobrenome inteiro igual
    ("CARLOS PEREIRA TESTE", "Carla Pereira Teste"), ("JOAO PEREIRA TESTE", "Joana Pereira Teste"),
    ("GABRIEL PEREIRA TESTE", "Gabriela Pereira Teste"), ("DANIEL PEREIRA TESTE", "Daniela Pereira Teste"),
    ("LUIZ PEREIRA TESTE", "Luiza Pereira Teste"), ("MARCOS PEREIRA TESTE", "Marcia Pereira Teste"),
    ("LUCAS PEREIRA TESTE", "Lucia Pereira Teste"), ("MARCIO PEREIRA TESTE", "Marcia Pereira Teste"),
    ("MARIO PEREIRA TESTE", "Maria Pereira Teste"), ("ADRIANO PEREIRA TESTE", "Adriana Pereira Teste"),
    ("PAULO PEREIRA TESTE", "Paula Pereira Teste"),
    # A1: 5 letras ou menos aceitam só 1 edição (José x João são 2)
    ("JOAO PEREIRA DA SILVA", "José Pereira da Silva"),
    # primeiro nome perto, resto diferente; e primeiro nome a mais de 2 edições com o mesmo sobrenome
    ("JOAO PEREIRA DA SILVA", "José Santos da Silva"), ("ERIKA TESTE LIMA", "Erivaldo Teste Lima"),
    # A2: primeiro nome igual, nenhum token do resto em comum
    ("MARIA FICTICIA SOUZA", "Maria José Oliveira"),
    ("MARIA", "Maria José Oliveira"),  # A2: só o primeiro nome na linha, nada do resto para conferir
])
def test_nome_proximo_que_e_de_outra_pessoa_nao_casa(linha, pessoa):
    """Nascimento diferente e nomes que o D240 casava (um token em comum): a regra nova recusa."""
    from civico_etl.identity import title_row_foreign

    assert names_compatible(linha, pessoa, None)  # o D240 casava
    assert title_row_foreign(linha, date(1970, 1, 1), pessoa, None, date(1980, 1, 1))


@pytest.mark.parametrize("linha,pessoa", [
    ("MARIA FICTICIA SOUSA", "Maria Ficticia Souza"),  # A2: 1 edição por token do resto (s/z)
    ("MARIA FICTICIA SOUZA", "Maria Ficticia Oliveira Souza"),  # sobrenome a mais
    ("ANA PAULA FELIPE", "Ana Paula Filipe"),  # i/e no sobrenome
    ("FICTILDO CAMARELI", "Fictildo Teste Camarelli"),  # letra dobrada
])
def test_primeiro_nome_igual_com_um_token_do_resto_casa(linha, pessoa):
    from civico_etl.identity import title_row_foreign

    assert not title_row_foreign(linha, date(1970, 1, 1), pessoa, None, date(1970, 1, 2))


def test_pai_e_filho_homonimos_nao_casam_digitacao_casa():
    """A3: sufixo de geração diferente e 14 anos ou mais de diferença: pai e filho. Com menos, é digitação."""
    from civico_etl.identity import title_row_foreign

    pai, filho = "José Teste da Silva", "JOSE TESTE DA SILVA FILHO"
    assert title_row_foreign(filho, date(1990, 5, 1), pai, None, date(1960, 5, 1))
    assert title_row_foreign("JOSE TESTE DA SILVA JUNIOR", date(1990, 5, 1), "José Teste da Silva Neto", None, date(1960, 5, 1))
    assert title_row_foreign("JOSE TESTE DA SILVA", date(1960, 5, 1), "José Teste da Silva Filho", None, date(1976, 5, 1))
    assert title_row_foreign("JOSE TESTE DA SILVA SOBRINHO", date(1995, 5, 1), "José Teste da Silva", None, date(1960, 5, 1))
    assert title_row_foreign("JOSE TESTE DA SILVA SEGUNDO", date(1995, 5, 1), "José Teste da Silva", None, date(1981, 5, 1))  # 14 anos
    assert not title_row_foreign("JOSE TESTE DA SILVA SEGUNDO", date(1995, 5, 1), "José Teste da Silva", None, date(1982, 5, 2))  # 13 anos
    assert not title_row_foreign(filho, date(1961, 5, 1), pai, None, date(1960, 5, 1))  # 1 ano: digitação (sufixo esquecido)
    assert not title_row_foreign("JOSE TESTE DA SILVA JR", date(1990, 5, 1), "José Teste da Silva Júnior", None, date(1960, 5, 1))  # mesmo sufixo
    assert not title_row_foreign(filho, date(1990, 5, 1), "José Teste da Silva Filho", None, date(1960, 5, 1))  # mesmo sufixo


def test_linha_sem_nome_civil_e_nascimento_diferente_nao_casa():
    """A7: sem nome civil não há como conferir; com nascimento diferente, recusa. Com o mesmo nascimento, não é decidido aqui."""
    from civico_etl.identity import title_row_foreign

    assert title_row_foreign(None, date(1970, 1, 1), "Fulano Teste", None, date(1971, 1, 1))
    assert title_row_foreign("  ", date(1970, 1, 1), "Fulano Teste", None, date(1971, 1, 1))
    assert not title_row_foreign(None, date(1970, 1, 1), "Fulano Teste", None, date(1970, 1, 1))


@pytest.mark.xfail(strict=True, reason="Dívida BUG-044: com o MESMO nascimento a regra do título não olha o nome. Gêmeos ou "
                   "irmãos de mesmo nascimento com primeiros nomes a até 2 edições (Marcos x Márcio) e o título repetido "
                   "casam. Não estendido de propósito: dividiria quem mudou de nome civil (nome social, casamento).")
def test_divida_gemeos_com_mesmo_nascimento():
    from civico_etl.identity import title_row_foreign

    assert title_row_foreign("MARCOS PEREIRA TESTE", date(1990, 3, 3), "Marcio Pereira Teste", None, date(1990, 3, 3))


def test_regra_nova_contem_a_do_d240():
    """Tudo o que o D240 recusava (nenhum token em comum, como nos casos do BUG-041 e do BUG-038), a regra nova recusa."""
    from civico_etl.identity import title_row_foreign

    for linha, nasc, pessoa, pnasc in [("FULANA TEIXEIRA DE OLIVEIRA", date(1993, 3, 3), "Beltrano José Souza", date(1972, 4, 4)),
                                       ("CICLANO JUVENTINO DE SOUSA", date(1983, 5, 5), "José Carlos Exemplo dos Santos", date(1974, 1, 1))]:
        assert not names_compatible(linha, pessoa, None) and title_row_foreign(linha, nasc, pessoa, None, pnasc)
    # nascimento igual: não é decidido por esta regra (a linha da mesma pessoa com nome social, D240)
    assert not title_row_foreign("ERIKA FICTICIA TESTE", date(1992, 1, 1), "Erik Testeiro", None, date(1992, 1, 1))


def test_nomes_diferentes_na_mesma_eleicao():
    from civico_etl.identity import names_differ

    assert names_differ("MARIA ISABEL DE SA MAMEDIR", "SILVANA MARIA DA ROCHA MARQUES")
    assert names_differ("NEI TESTE DE PAULA", "JUCINEI TESTE DE PAULA")
    # registro substituído da mesma pessoa com grafia variante: não é "nome diferente"
    assert not names_differ("LUIZ FICTOR TESTEIRO", "LUIS FICTOR TESTEIRRO")


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


@pytest.mark.parametrize("linha,nasc,pessoa,pnasc", [
    ("CARLOS PEREIRA TESTE", date(1975, 1, 1), "Carla Pereira Teste", date(1972, 1, 1)),  # A1: irmão e irmã
    ("JOAO PEREIRA TESTE", date(1975, 1, 1), "José Pereira Teste", date(1972, 1, 1)),  # A1: 2 edições com 4 letras
    ("MARIA FICTICIA SOUZA", date(1975, 1, 1), "Maria José Oliveira", date(1972, 1, 1)),  # A2: nada do resto em comum
    ("JOSE TESTE DA SILVA FILHO", date(1990, 5, 1), "José Teste da Silva", date(1960, 5, 1)),  # A3: pai e filho
    (None, date(1975, 1, 1), "Fulano Teste", date(1972, 1, 1)),  # A7: linha sem nome civil
])
def test_resolve_nao_casa_pelo_titulo_regras_da_revisao(conn, linha, nasc, pessoa, pnasc):
    """A1, A2, A3 e A7 pelo resolve (existe no main: sem a correção, falha pela asserção, não pelo import)."""
    _ids(conn)
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-dono", pessoa, pessoa, pnasc, TIT)
        pr = PersonResolver(conn)
        m = pr.resolve(source="tse", external_id="2099:440004", titulo=TIT, civil_name=linha, birth_date=nasc, uf="AC", year=2099)
        assert m.person_id != pid and m.method != "exact_id"


def test_resolve_mesma_pessoa_com_grafia_e_digito_casa_pelo_titulo(conn):
    _ids(conn)
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-terezinha", "Terezinha Alves Teste", "Terezinha", date(1961, 11, 13), TIT)
        auri = _person(conn, "teste-bug044-auri", "Auri Wulange Teste Sintetico", "Dr Auri", date(1970, 7, 1), "999900440002")
        pr = PersonResolver(conn)
        m = pr.resolve(source="tse", external_id="2099:440002", titulo=TIT, civil_name="TERESINHA ALVES TESTE", birth_date=date(1961, 11, 12), uf="SP", year=2099)
        assert (m.person_id, m.method, m.title_foreign) == (pid, "exact_id", False)
        m = pr.resolve(source="tse", external_id="2099:440003", titulo="999900440002", civil_name="AURI-WULANGE TESTE SINTETICO",
                       birth_date=date(1970, 6, 1), uf="SP", year=2099)
        assert (m.person_id, m.method, m.title_foreign) == (auri, "exact_id", False)


def test_resolve_titulo_em_2_sq_da_mesma_eleicao_nao_prova_nenhuma_linha(conn):
    """Paty do Alferes/RJ 2012: o mesmo título em 2 SQ da eleição ordinária, Maria Isabel (1943) e Silvana Maria (1970).
    Nem a linha da própria Silvana, com o nascimento dela, casa pelo título: o título não prova nada naquele ano."""
    _ids(conn)
    with conn.transaction(force_rollback=True):
        pid = _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 1, 1), TIT)
        conn.execute(
            """insert into tse_titulo_candidatura (titulo, year, ue, tse_sequencial, kind, civil_name, birth_date) values
               (%s, 2012, '99001', '99000440001', 'ordinaria', 'MARIA ISABEL DE SA MAMEDIR', '1943-01-01'),
               (%s, 2012, '99001', '99000440002', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-01-01'),
               (%s, 2016, '99001', '99000440003', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-01-01')""", (TIT, TIT, TIT))
        pr = PersonResolver(conn)
        assert pr.shared_title(TIT, 2012) and not pr.shared_title(TIT, 2016)
        m = pr.resolve(source="tse", external_id="2012:99001:99000440002", titulo=TIT, civil_name="SILVANA MARIA DA ROCHA MARQUES",
                       birth_date=date(1970, 1, 1), uf="RJ", year=2012)
        assert m.method != "exact_id" and m.title_foreign
        # em 2016 o título aparece uma vez só: casa
        m = pr.resolve(source="tse", external_id="2016:99000440003", titulo=TIT, civil_name="SILVANA MARIA DA ROCHA MARQUES",
                       birth_date=date(1970, 1, 1), uf="RJ", year=2016)
        assert (m.person_id, m.method) == (pid, "exact_id")


def test_resolve_titulo_em_2_sq_vindo_da_carga(conn):
    """O ano ainda não está em tse_titulo_candidatura: as linhas da própria carga (note_title_rows) bastam."""
    from civico_etl.jobs.tse_candidatos import title_rows

    _ids(conn)
    rows = [dict(ANO_ELEICAO="2098", SG_UE="99001", SQ_CANDIDATO=sq, SG_UF="RJ", CD_CARGO="13", NR_TITULO_ELEITORAL_CANDIDATO=TIT,
                 NM_TIPO_ELEICAO="ELEIÇÃO ORDINÁRIA", NR_TURNO="1", DS_SIT_TOT_TURNO=res, NM_CANDIDATO=nome, DT_NASCIMENTO=nasc, NR_CANDIDATO="1")
            for sq, nome, nasc, res in [("99000440004", "MARIA ISABEL DE SA MAMEDIR", "01/01/1943", "ELEITO"),
                                        ("99000440005", "SILVANA MARIA DA ROCHA MARQUES", "01/01/1970", "NÃO ELEITO")]]
    with conn.transaction(force_rollback=True):
        _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 1, 1), TIT)
        pr = PersonResolver(conn)
        assert not pr.shared_title(TIT, 2098)
        pr.note_title_rows(title_rows(rows, None))
        m = pr.resolve(source="tse", external_id="2098:99000440004", titulo=TIT, civil_name="MARIA ISABEL DE SA MAMEDIR",
                       birth_date=date(1943, 1, 1), uf="RJ", year=2098)
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
        pid = _person(conn, "teste-bug044-silvana", "Silvana Maria da Rocha Marques", "Silvana", date(1970, 1, 1), TIT)
        _cand(conn, pid, 2095, "99000440011")  # a da Silvana: certa
        conn.execute(
            """insert into tse_titulo_candidatura (titulo, year, ue, tse_sequencial, kind, civil_name, birth_date) values
               (%s, 2095, '99044', '99000440011', 'ordinaria', 'SILVANA MARIA DA ROCHA MARQUES', '1970-01-01'),
               (%s, 2095, '99045', '99000440012', 'ordinaria', 'MARIA ISABEL DE SA MAMEDIR', '1970-01-01')""", (TIT, TIT))
        assert novo(conn) == antes  # a linha da própria pessoa não dispara
        # a candidatura passa a ser a da linha da Maria Isabel (nascimento igual, por hipótese), na Silvana: errada
        conn.execute("update candidacies set tse_sequencial = '99000440012' where person_id = %s", (pid,))
        assert novo(conn) == antes + 1
