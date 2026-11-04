"""BUG-038: o identity.resolve casava pessoas do TSE por nome civil + nascimento no diretório inteiro, sem lugar, e anexava o
título de eleitor da outra pessoa. BUG-039: o registro substituído (INAPTO) ficava no lugar do eleito da mesma disputa."""

from __future__ import annotations

from datetime import date

import pytest

from civico_etl.identity import PersonResolver
from civico_etl.jobs.checks_identity import IDENTITY_CHECKS
from civico_etl.jobs.tse_candidatos import registration_rank, title_rows

FUSION_CHECK = next(q for n, q in IDENTITY_CHECKS if "dois títulos de eleitor" in n)
ELECTED_CHECK = next(q for n, q in IDENTITY_CHECKS if "linha ELEITO na fonte" in n)
REPOLHINHO = dict(civil_name="Jose Antonio da Silva", birth_date=date(1963, 5, 20))


def _n(conn, q: str) -> int:
    return list(conn.execute(q).fetchone().values())[0]


def test_posto_do_registro():
    assert registration_rank("eleito_qp") > registration_rank("suplente") > registration_rank(None)
    assert registration_rank("nao_eleito") > registration_rank("indeferido") == registration_rank("renuncia") == 0


def test_linhas_de_titulo_ignoram_2o_turno_e_consulta_popular():
    base = dict(ANO_ELEICAO="2024", SG_UE="71072", SQ_CANDIDATO="1", SG_UF="SP", CD_CARGO="11", NR_TITULO_ELEITORAL_CANDIDATO="0123")
    rows = [base | dict(NM_TIPO_ELEICAO="ELEIÇÃO ORDINÁRIA", NR_TURNO="1", DS_SIT_TOT_TURNO="2º TURNO"),
            base | dict(NM_TIPO_ELEICAO="ELEIÇÃO ORDINÁRIA", NR_TURNO="2", DS_SIT_TOT_TURNO="ELEITO"),
            base | dict(NM_TIPO_ELEICAO="CONSULTA POPULAR", NR_TURNO="1", SQ_CANDIDATO="2", DS_SIT_TOT_TURNO="")]
    out = title_rows(rows, {"0123"})
    assert out == [("0123", 2024, "71072", "1", "ordinaria", "SP", "prefeito", "2º TURNO")]
    assert title_rows(rows, {"999"}) == []


def _people(conn, *slugs):
    got = {r["slug"]: r["id"] for r in conn.execute("select slug, id::text from people where slug = any(%s)", (list(slugs),))}
    if len(got) < len(slugs):
        pytest.skip(f"pessoas do BUG-038 não estão neste banco: {set(slugs) - set(got)}")
    return got


def test_resolve_titulo_diferente_nunca_casa(conn):
    """Só lê: o resolve acumula vínculos em memória, e nada é gravado sem flush."""
    ids = _people(conn, "repolhinho", "antonios-coiffeur")
    pr = PersonResolver(conn)
    # título que ninguém tem, linha do Acre: os dois homônimos têm outro título e nenhum lugar em comum -> outra pessoa
    m = pr.resolve(source="tse", external_id="2099:1", titulo="000000000191", uf="AC", birth_uf="AC", **REPOLHINHO)
    assert m.method == "new" and m.person_id is None
    # título que ninguém tem, linha do RS: o de Rio Grande tem outro título no mesmo lugar (pode ser reemissão) -> fila
    m = pr.resolve(source="tse", external_id="2099:2", titulo="000000000272", uf="RS", **REPOLHINHO)
    assert m.method == "queued" and m.person_id is None
    # sem título na linha: casa só com lugar em comum, e só se for um
    m = pr.resolve(source="tse", external_id="2099:3", uf="RS", **REPOLHINHO)
    assert m.person_id == ids["repolhinho"] and m.method == "name_birth"
    m = pr.resolve(source="tse", external_id="2099:4", uf="SP", birth_uf="SP", **REPOLHINHO)
    assert m.method == "queued"
    # o título do maranhense está na pessoa dele: casa pelo título, nunca com o crachá de Rio Grande
    m = pr.resolve(source="tse", external_id="2099:5", titulo="000597921198", uf="MA", **REPOLHINHO)
    assert m.person_id == ids["antonios-coiffeur"] and m.method == "exact_id"


def test_banco_separados(conn):
    ids = _people(conn, "repolhinho", "malufao", "cida-da-saude-rn", "ze-galinha", "divino-pa")
    titles = {r["slug"]: r["t"] for r in conn.execute(
        """select p.slug, array_agg(x.external_id order by 1) t from people p join person_external_ids x on x.person_id = p.id
           join sources s on s.id = x.source_id and s.slug = 'tse-titulo' where p.id = any(%s::uuid[]) group by 1""", (list(ids.values()),))}
    assert titles["repolhinho"] == ["009924220418"]
    assert titles["malufao"] == ["165845370167"]
    assert titles["cida-da-saude-rn"] == ["228178420183"]
    places = {r["slug"]: r["ufs"] for r in conn.execute(
        """select p.slug, array_agg(distinct pl.uf) ufs from people p join candidacies c on c.person_id = p.id join contests ct on ct.id = c.contest_id
           join places pl on pl.id = ct.place_id where p.id = any(%s::uuid[]) group by 1""", (list(ids.values()),))}
    assert places["repolhinho"] == ["RS"] and places["malufao"] == ["SP"]
    ze = conn.execute("""select count(*) n from candidacies c join people p on p.id = c.person_id
                         where p.slug = 'ze-galinha' and c.ballot_name = 'Piqueno'""").fetchone()["n"]
    assert ze == 0
    d = conn.execute("""select c.tse_sequencial, c.result, m.started_on from candidacies c join people p on p.id = c.person_id
                        join elections e on e.id = c.election_id left join mandates m on m.candidacy_id = c.id
                        where p.slug = 'divino-pa' and e.year = 2012""").fetchall()
    assert [(r["tse_sequencial"], r["result"], str(r["started_on"])) for r in d] == [("140000021364", "eleito_qp", "2013-01-01")]


def test_check_pega_fusao_de_titulos(conn):
    ids = _people(conn, "repolhinho")
    with conn.transaction(force_rollback=True):
        assert _n(conn, FUSION_CHECK) == 0
        conn.execute("""update person_external_ids set person_id = %s where external_id = '000597921198'
                        and source_id = (select id from sources where slug = 'tse-titulo')""", (ids["repolhinho"],))
        assert _n(conn, FUSION_CHECK) == 1


def test_check_pega_eleito_sem_candidatura(conn):
    _people(conn, "divino-pa")
    with conn.transaction(force_rollback=True):
        assert _n(conn, ELECTED_CHECK) == 0
        conn.execute("""delete from mandates where candidacy_id in (select c.id from candidacies c join people p on p.id = c.person_id
                        where p.slug = 'divino-pa' and c.tse_sequencial = '140000021364')""")
        conn.execute("""update candidacies set result = null where tse_sequencial = '140000021364'
                        and person_id = (select id from people where slug = 'divino-pa')""")
        assert _n(conn, ELECTED_CHECK) == 1
