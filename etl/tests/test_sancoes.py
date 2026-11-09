"""Item 5 da W3-B: sanções do TCU (D130–D132)."""

from __future__ import annotations

from datetime import date

from civico_etl.jobs.sancoes import norm_name, parse_tcu

AMOSTRA = {"nome": "ABDALA GOMES SANTOS", "cpf": "215.805.453-00", "processo": "026.615/2020-7", "deliberacao": "AC-000738/2022-PL",
           "data_transito_julgado": "2022-07-16T03:00:00Z", "data_final": "2027-07-16T03:00:00Z", "data_acordao": "2022-04-06T17:30:00Z",
           "uf": "MA", "municipio": "SANTA INES"}


def test_cpf_nunca_e_gravado():
    (row,) = parse_tcu([AMOSTRA])
    assert "215.805.453-00" not in repr(row) and "cpf" not in row
    assert row["final_on"] == date(2022, 7, 16) and row["ends_on"] == date(2027, 7, 16)
    assert row["uf"] == "MA" and row["source_key"] == "026.615/2020-7|AC-000738/2022-PL|abdala gomes santos"


def test_nome_normalizado():
    assert norm_name("  José  da Silva-Souza ") == "jose da silva souza"


def test_vinculo_so_com_metodo(conn):
    r = conn.execute("select count(*) as n from sanctions where person_id is not null and (match_method is null or match_confidence < 0.9)").fetchone()
    assert r["n"] == 0


# ---- catálogo D03: CGU (CEIS/CNEP). Nomes de campo do CeisDTO/CnepDTO do OpenAPI v3 (08/11/2026); os valores são suposição (sem chave, sem resposta real).

import pytest

from civico_etl.jobs.sancoes import CGU_SOURCES, match, parse_cgu

CEIS_PF = {"id": 123, "dataReferencia": "01/11/2026", "dataInicioSancao": "01/03/2024", "dataFimSancao": "01/03/2026", "dataPublicacaoSancao": "05/03/2024",
           "tipoSancao": {"descricaoResumida": "Impedimento de licitar", "descricaoPortal": "x"}, "fundamentacao": [{"codigo": "L8666", "descricao": "Lei 8.666/93 art. 87"}],
           "orgaoSancionador": {"nome": "Prefeitura de Exemplo", "siglaUf": "sp", "poder": "Executivo", "esfera": "Municipal"},
           "sancionado": {"nome": "ZZQX ALFA BRAVO CHARLIE", "codigoFormatado": "123.456.789-00"},
           "pessoa": {"id": 9, "cpfFormatado": "123.456.789-00", "cnpjFormatado": "", "numeroInscricaoSocial": "12345678901", "nome": "ZZQX ALFA BRAVO CHARLIE", "tipo": "Pessoa Física"},
           "numeroProcesso": "1/2024", "linkPublicacao": "http://x"}
CNEP_PJ = {"id": 7, "sancionado": {"nome": "EMPRESA SA", "codigoFormatado": "12.345.678/0001-90"}, "pessoa": {"cnpjFormatado": "12.345.678/0001-90", "tipo": "Pessoa Jurídica"},
           "orgaoSancionador": {"nome": "CGU", "siglaUf": "DF", "esfera": "Federal"}, "valorMulta": "1.000,00"}


def test_cgu_so_pessoa_fisica_e_nunca_grava_documento():
    rows, skipped = parse_cgu([CEIS_PF, CNEP_PJ, {"id": 8, "sancionado": {"nome": "SEM TIPO"}, "pessoa": {}}], "ceis")
    assert len(rows) == 1 and skipped == {"pj": 1, "indefinido": 1, "sem_nome": 0}
    (r,) = rows
    blob = repr(r)
    for secreto in ("123.456.789", "12345678901", "cpf", "codigoFormatado", "12.345.678"):
        assert secreto not in blob
    assert r["source"] == "cgu_ceis" and r["source_key"] == "123" and r["uf"] == "SP" and r["body_sphere"] == "Municipal"
    assert (r["decided_on"], r["final_on"], r["ends_on"]) == (date(2024, 3, 5), date(2024, 3, 1), date(2026, 3, 1))
    assert r["fine_cents"] is None and r["decision"] == "Lei 8.666/93 art. 87"


def test_cnep_traz_multa():
    pf = {**CEIS_PF, "id": 5, "valorMulta": "2.500,50"}
    (r,) = parse_cgu([pf], "cnep")[0]
    assert r["source"] == "cgu_cnep" and r["fine_cents"] == 250050


def test_cgu_tipo_ausente_usa_so_a_presenca_de_cpf_como_pista():
    it = {**CEIS_PF, "pessoa": {"cpfFormatado": "***.123.456-**", "cnpjFormatado": ""}}
    assert len(parse_cgu([it], "ceis")[0]) == 1
    it2 = {**CEIS_PF, "pessoa": {"cpfFormatado": "", "cnpjFormatado": "12.345.678/0001-90"}}
    assert parse_cgu([it2], "ceis")[0] == []


def _cgu_row(conn, key, name, uf, sphere, source="cgu_ceis"):
    conn.execute("insert into sanctions (source, source_key, name, uf, source_url, body_sphere) values (%s, %s, %s, %s, 'https://teste', %s)", (source, key, name, uf, sphere))


def _person(conn, civil, uf):
    n = conn.execute("select count(*) as n from people where slug like 'zz-teste-%'").fetchone()["n"]
    pid = conn.execute("insert into people (slug, display_name, civil_name) values (%s, %s, %s) returning id", (f"zz-teste-{n}-" + civil.replace(" ", "-"), civil, civil)).fetchone()["id"]
    office = conn.execute("select id from offices where slug = 'governador'").fetchone()["id"]
    place = conn.execute("select id from places where kind = 'uf' and uf = %s", (uf,)).fetchone()["id"]
    conn.execute("insert into mandates (person_id, office_id, place_id, status, started_on, ends_on, status_source) values (%s, %s, %s, 'em_exercicio', '2023-01-01', '2027-01-01', 'teste')", (pid, office, place))
    return pid


def test_cgu_casamento_conservador_com_motivo_em_todo_nao_vinculo(conn):
    with conn.transaction(force_rollback=True):
        ana = _person(conn, "zzqx ana bravo", "SP")
        _person(conn, "zzqx dois homonimo", "SP")
        _person(conn, "zzqx dois homonimo", "SP")
        _person(conn, "zzqx outra uf", "RJ")
        _person(conn, "zzqx curto", "SP")
        _cgu_row(conn, "1", "ZZQX ANA BRAVO", "SP", "Estadual")            # casa
        _cgu_row(conn, "2", "ZZQX ANA BRAVO", "SP", "Federal")             # órgão federal: UF não identifica a pessoa
        _cgu_row(conn, "3", "ZZQX ANA BRAVO", "SP", None)                  # esfera desconhecida
        _cgu_row(conn, "4", "ZZQX DOIS HOMONIMO", "SP", "Municipal")       # 2 pessoas
        _cgu_row(conn, "5", "ZZQX OUTRA UF", "SP", "Estadual")             # nome único, mas outra UF
        _cgu_row(conn, "6", "ZZQX NINGUEM AQUI", "SP", "Estadual")         # ninguém no banco
        _cgu_row(conn, "7", "ZZQX CURTO", "SP", "Estadual")                # menos de 3 palavras
        stats = match(conn, "cgu_ceis")
        got = {r["source_key"]: r for r in conn.execute("select * from sanctions where source = 'cgu_ceis'")}
        assert got["1"]["person_id"] == ana and got["1"]["match_method"] == "nome_civil_uf" and float(got["1"]["match_confidence"]) == 0.9
        for k in "234567":
            assert got[k]["person_id"] is None and got[k]["match_method"] is None, k
        assert "federal" in got["2"]["match_note"] and "federal" in got["3"]["match_note"]
        assert "mais de uma pessoa" in got["4"]["match_note"] and "sem mandato ou candidatura na UF" in got["5"]["match_note"]
        assert "nenhuma pessoa" in got["6"]["match_note"] and "menos de 3 palavras" in got["7"]["match_note"]
        assert all(r["person_id"] or r["match_note"] for r in got.values())  # motivo para cada não-vínculo
        # com a carga real no banco, match() recasa também as linhas reais: conta contra o que ficou ligado, não contra 1
        assert stats["casado"] == sum(1 for r in got.values() if r["person_id"]) and got["1"]["person_id"] == ana
        # invariantes do jobs/checks.py ficam verdes nesse estado e quebram se alguém ligar órgão federal
        from civico_etl.jobs.checks import CHECKS

        q = dict(CHECKS)["sanções CGU: vínculo com órgão federal, ou não-vínculo sem motivo gravado"]
        assert list(conn.execute(q).fetchone().values())[0] == 0
        conn.execute("update sanctions set person_id = %s, match_method = 'nome_civil_uf', match_confidence = 0.9 where source_key = '2' and source = 'cgu_ceis'", (ana,))
        assert list(conn.execute(q).fetchone().values())[0] == 1


# ---- S2-1 / S2-2: run_cgu com trava contra leitura truncada e filtro LGPD (pessoa física sem correspondente em `people` não é gravada) ----

import logging
from contextlib import contextmanager

from civico_etl import db as D
from civico_etl.jobs import sancoes as S
from civico_etl.transparencia import PageRead


@contextmanager
def _fake_run(conn, dataset, source, **kw):
    r = D.Run(conn, dataset, source)
    yield r
    _fake_run.last = r


def _cgu_item(i, nome):
    return {"id": i, "pessoa": {"tipo": "Pessoa Física"}, "sancionado": {"nome": nome}, "orgaoSancionador": {"siglaUf": "SP", "esfera": "Estadual", "nome": "ORGAO"}}


def _run_cgu(conn, monkeypatch, items, truncated=False, kind="cnep"):
    monkeypatch.setattr(S, "run", _fake_run)

    def pages(k, state):
        state.truncated, state.note = truncated, ("página 3 vazia" if truncated else None)
        return [items]

    return S.run_cgu(conn, kinds=(kind,), pages=pages)[kind]


def _stored(conn, source="cgu_cnep"):
    return {r["source_key"] for r in conn.execute("select source_key from sanctions where source = %s", (source,))}


def _need_empty(conn, source="cgu_cnep"):
    if conn.execute("select count(*) as n from sanctions where source = %s", (source,)).fetchone()["n"]:
        pytest.skip(f"{source} já tem linhas no banco local; o teste assume a fonte vazia")


def test_cgu_lgpd_so_grava_pessoa_fisica_com_correspondente_e_log_nunca_leva_nome(conn, monkeypatch, caplog):
    with conn.transaction(force_rollback=True):
        _need_empty(conn)
        _person(conn, "zzqx ana bravo", "SP")
        with caplog.at_level(logging.DEBUG):
            stats = _run_cgu(conn, monkeypatch, [_cgu_item(1, "ZZQX Ana Bravo"), _cgu_item(2, "ZZQX CIDADAO COMUM SEM PESSOA"), _cgu_item(3, "ZZQX OUTRO ANONIMO")])
        assert _stored(conn) == {"1"}
        assert stats["lista"] == 1 and stats["sem_pessoa_lgpd"] == 2
        assert "LGPD" in " ".join(_fake_run.last.notes) and "2 pessoas físicas" in " ".join(_fake_run.last.notes)
        for nome in ("CIDADAO", "ANONIMO", "ANA BRAVO", "cidadao", "anonimo"):
            assert nome not in caplog.text and nome not in " ".join(_fake_run.last.notes)


def test_cgu_proximo_run_remove_pf_sem_vinculo_gravada_antes_respeitando_a_trava(conn, monkeypatch):
    with conn.transaction(force_rollback=True):
        _need_empty(conn)
        _person(conn, "zzqx ana bravo", "SP")
        _cgu_row(conn, "1", "ZZQX ANA BRAVO", "SP", "Estadual", source="cgu_cnep")
        _cgu_row(conn, "2", "ZZQX CIDADAO ANTIGO", "SP", "Estadual", source="cgu_cnep")  # gravada por carga sem filtro
        _run_cgu(conn, monkeypatch, [_cgu_item(1, "ZZQX ANA BRAVO"), _cgu_item(2, "ZZQX CIDADAO ANTIGO")])  # lidas 2 >= metade de 2 gravadas
        assert _stored(conn) == {"1"}
        assert "não têm correspondente" in " ".join(_fake_run.last.notes)


def test_cgu_trava_usa_a_contagem_de_antes_do_upsert(conn, monkeypatch):
    # 3 gravadas, 1 lida: a fórmula antiga (contagem depois do upsert) deixava apagar; a nova exige lida*2 >= gravada-antes
    with conn.transaction(force_rollback=True):
        _need_empty(conn)
        _person(conn, "zzqx ana bravo", "SP")
        for k in ("a", "b", "c"):
            _cgu_row(conn, k, "ZZQX ANA BRAVO", "SP", "Estadual", source="cgu_cnep")
        _run_cgu(conn, monkeypatch, [_cgu_item(9, "ZZQX ANA BRAVO")])
        assert _stored(conn) == {"a", "b", "c", "9"}
        assert "nada apagado" in " ".join(_fake_run.last.notes)


def test_cgu_leitura_truncada_nunca_apaga(conn, monkeypatch):
    with conn.transaction(force_rollback=True):
        _need_empty(conn)
        _person(conn, "zzqx ana bravo", "SP")
        _cgu_row(conn, "velha", "ZZQX ANA BRAVO", "SP", "Estadual", source="cgu_cnep")
        _run_cgu(conn, monkeypatch, [_cgu_item(1, "ZZQX ANA BRAVO")], truncated=True)  # 1*2 >= 1: só a marca de truncada segura
        assert _stored(conn) == {"velha", "1"}
        assert "truncada" in " ".join(_fake_run.last.notes)


def test_tcu_log_do_casamento_nao_leva_nome(conn, caplog):
    with conn.transaction(force_rollback=True):
        conn.execute("insert into sanctions (source, source_key, name, uf, source_url) values ('tcu_inabilitados', 'zz-1', 'ZZQX FULANO SEM PESSOA AQUI', 'SP', 'https://t')")
        with caplog.at_level(logging.DEBUG):
            S.match(conn, "tcu_inabilitados")
        assert "FULANO" not in caplog.text and "fulano" not in caplog.text.lower()
