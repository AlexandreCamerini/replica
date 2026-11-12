"""BUG-053: quem entra no diretório por uma carga recente (D07) fica sem as candidaturas das eleições antigas do próprio título.
O passo `historico` do identity.repairs carrega essas linhas, uma a uma, pelo loader do TSE, só quando o resolve (todas as
travas de identidade) casa a linha na pessoa do título.

Tudo sintético (títulos, SQ, UE, município e pessoas fictícios), numa transação desfeita, sem supor banco vazio: o universo
real do banco é filtrado para os títulos do teste. A fonte é um CSV em tmp_path (sem cache nem rede). Funções novas são
importadas dentro dos testes, para que na main falhem por asserção ou import, não na coleta."""

from __future__ import annotations

import functools
from datetime import date

import pytest

from civico_etl.jobs import repairs
from civico_etl.jobs.checks_identity import IDENTITY_CHECKS

CHECK = next(q for n, q in IDENTITY_CHECKS if "título com linha ELEITO na fonte e pessoa sem candidatura eleita" in n)
UE = "99053"
NM_UE = "TESTE BUG-053 A"
T_DUDU = "999990530011"   # vereador novo de 2024; histórico 2012 (eleito), 2016 (eleito), 2020 (suplente)
T_MARIA = "999990530022"  # o TSE repete o título dela na linha de outra pessoa (2016)
T_ANA = "999990530033"    # título em 2 SQ da mesma eleição com nomes diferentes (shared_title)
T_EXTRA = ("999990530044", "999990530055")  # teto
T_VELHO = "999990530066"  # já tem histórico (2016 no banco): a suplência de 2012 que falta é backlog do BUG-047, não entra
TITLES = {T_DUDU, T_MARIA, T_ANA, *T_EXTRA, T_VELHO}
HELD = {2012: "07/10/2012", 2014: "05/10/2014", 2016: "02/10/2016", 2020: "15/11/2020", 2024: "06/10/2024"}


def _src(year: int, sq: str, titulo: str, nome: str, nasc: str, sit: str, *, cargo: str = "13", ue: str = UE, nm_ue: str = NM_UE,
         nr: str = "12345") -> dict:
    return {
        "ANO_ELEICAO": str(year), "NM_TIPO_ELEICAO": "ELEIÇÃO ORDINÁRIA", "NR_TURNO": "1", "DT_ELEICAO": HELD[year], "SG_UF": "MG",
        "SG_UE": ue, "NM_UE": nm_ue, "CD_CARGO": cargo, "SQ_CANDIDATO": sq, "NR_CANDIDATO": nr, "NM_CANDIDATO": nome.upper(),
        "NM_URNA_CANDIDATO": nome.split()[0].upper(), "NR_PARTIDO": None, "SG_PARTIDO": None, "NM_PARTIDO": None, "NM_COLIGACAO": None,
        "SG_UF_NASCIMENTO": "MG", "NM_MUNICIPIO_NASCIMENTO": None, "DT_NASCIMENTO": nasc, "NR_TITULO_ELEITORAL_CANDIDATO": titulo,
        "CD_GENERO": "2", "DS_GRAU_INSTRUCAO": None, "DS_SIT_TOT_TURNO": sit, "DS_DETALHE_SITUACAO_CAND": "DEFERIDO",
    }


SOURCE = [
    _src(2012, "990530000112", T_DUDU, "Dudu Teste da Silva", "01/01/1980", "ELEITO POR QP"),
    _src(2016, "990530000116", T_DUDU, "Dudu Teste da Silva", "01/01/1980", "ELEITO"),
    _src(2020, "990530000120", T_DUDU, "Dudu Teste da Silva", "01/01/1980", "SUPLENTE"),
    _src(2012, "990530000612", T_VELHO, "Velho Historico Teste", "08/08/1958", "SUPLENTE", nr="33333"),
    # BUG-041: o título da Maria na linha de outra pessoa (outro nome, outro nascimento)
    _src(2016, "990530000216", T_MARIA, "Jose Carlos Pereira Teste", "03/03/1960", "ELEITO"),
    # BUG-044: o título da Ana em 2 SQ da mesma eleição com primeiros nomes diferentes
    _src(2016, "990530000316", T_ANA, "Ana Lucia Ferreira Teste", "04/04/1970", "ELEITO", nr="45678"),
    _src(2016, "990530000317", T_ANA, "Marta Ferreira Teste", "05/05/1950", "NÃO ELEITO", nr="45679"),
    _src(2016, "990530000416", T_EXTRA[0], "Beto Extra Teste", "06/06/1966", "ELEITO", nr="11111"),
    _src(2016, "990530000516", T_EXTRA[1], "Caio Extra Teste", "07/07/1967", "ELEITO", nr="22222"),
]


def _write_csv(rows: list[dict], path) -> None:
    """CSV como o consulta_cand transcodificado pelo loader (UTF-8, ';', aspas). Local ao teste: não depende do código novo."""
    import csv

    cols = list(rows[0])
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", quotechar='"')
        w.writerow(cols)
        for x in rows:
            w.writerow(["" if x[c] is None else x[c] for c in cols])


@pytest.fixture
def fonte(tmp_path):
    by_year: dict[int, list[dict]] = {}
    for x in SOURCE:
        by_year.setdefault(int(x["ANO_ELEICAO"]), []).append(x)
    files = {}
    for y, rows in by_year.items():
        p = tmp_path / f"consulta_cand_{y}_BRASIL.utf8.csv"
        _write_csv(rows, p)
        files[y] = [p]
    return lambda year: files.get(year, [])


def _titles_source(titles):
    from civico_etl.jobs.tse_candidatos import title_rows

    return title_rows(SOURCE, set(titles) & TITLES)


def _universe(conn):
    return [u for u in repairs._history_universe(conn) if u["titulo"] in TITLES]


def _setup(conn) -> dict[str, str]:
    """Município de teste, as pessoas do diretório (cada uma com o título e a candidatura eleita de 2024, como quem a carga de
    2024 acabou de criar) e candidaturas não eleitas de 2016 e 2020 de outra pessoa (esses anos foram carregados com --all ali)."""
    place = str(conn.execute("""insert into places (ibge_code, kind, name, slug, uf) values ('9905301', 'municipio', 'Teste BUG-053 A',
                                'teste-bug-053-a', 'MG') returning id""").fetchone()["id"])
    office = str(conn.execute("select id from offices where slug = 'vereador'").fetchone()["id"])

    def contest(year: int, held: date) -> tuple[str, str]:
        el = conn.execute("""insert into elections (kind, year, round, held_on) values ('municipal', %s, 1, %s)
                             on conflict (kind, year, round, held_on) do update set kind = excluded.kind returning id""", (year, held)).fetchone()["id"]
        ct = conn.execute("""insert into contests (election_id, office_id, place_id) values (%s, %s, %s)
                             on conflict (election_id, office_id, place_id) do update set place_id = excluded.place_id returning id""",
                          (el, office, place)).fetchone()["id"]
        return str(el), str(ct)

    el24, ct24 = contest(2024, date(2024, 10, 6))
    el20, ct20 = contest(2020, date(2020, 11, 15))
    el16, ct16 = contest(2016, date(2016, 10, 2))
    out = {"place": place}

    def person(slug: str, civil: str, birth: date, titulo: str | None, sq24: str | None) -> str:
        pid = str(conn.execute("insert into people (slug, display_name, civil_name, birth_date) values (%s, %s, %s, %s) returning id",
                               (slug, civil.split()[0], civil, birth)).fetchone()["id"])
        if titulo:
            conn.execute("""insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence)
                            select %s, id, %s, 'exact_id', 1.0 from sources where slug = 'tse-titulo'""", (pid, titulo))
        if sq24:
            cid = conn.execute("""insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name, result, currency)
                                  values (%s, %s, %s, %s, 'Teste', 'eleito', 'BRL') returning id""", (ct24, el24, pid, sq24)).fetchone()["id"]
            conn.execute("""insert into mandates (person_id, office_id, place_id, candidacy_id, status, started_on, ends_on, status_source, elected_by)
                            values (%s, %s, %s, %s, 'em_exercicio', '2025-01-01', '2029-01-01', 'tse', 'TSE 2024')""", (pid, office, place, cid))
        return pid

    out["dudu"] = person("teste-bug053-dudu", "Dudu Teste da Silva", date(1980, 1, 1), T_DUDU, "990530002024")
    out["maria"] = person("teste-bug053-maria", "Maria Aparecida Souza Teste", date(1975, 2, 2), T_MARIA, "990530002224")
    out["ana"] = person("teste-bug053-ana", "Ana Lucia Ferreira Teste", date(1970, 4, 4), T_ANA, "990530002324")
    out["beto"] = person("teste-bug053-beto", "Beto Extra Teste", date(1966, 6, 6), T_EXTRA[0], "990530002424")
    out["caio"] = person("teste-bug053-caio", "Caio Extra Teste", date(1967, 7, 7), T_EXTRA[1], "990530002524")
    out["velho"] = person("teste-bug053-velho", "Velho Historico Teste", date(1958, 8, 8), T_VELHO, "990530002624")
    conn.execute("""insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name, result, currency)
                    values (%s, %s, %s, '990530000616', 'Velho', 'nao_eleito', 'BRL')""", (ct16, el16, out["velho"]))
    q = person("teste-bug053-outro", "Outro Candidato Teste", date(1990, 9, 9), None, None)
    for el, ct, sq in ((el20, ct20, "990530009920"), (el16, ct16, "990530009916")):
        conn.execute("""insert into candidacies (contest_id, election_id, person_id, tse_sequencial, ballot_name, result, currency)
                        values (%s, %s, %s, %s, 'Outro', 'nao_eleito', 'BRL')""", (ct, el, q, sq))
    out["outro"] = q
    return out


def _cands(conn, pid: str) -> dict[int, tuple[str, str | None]]:
    return {r["year"]: (r["tse_sequencial"], r["result"]) for r in conn.execute(
        """select e.year, c.tse_sequencial, c.result from candidacies c join elections e on e.id = c.election_id
           where c.person_id = %s""", (pid,))}


def _steps(fonte):
    """Os passos reais de repairs.STEPS, com a fonte do teste e sem commit."""
    when = lambda y: date(2026, 11, 12)  # noqa: E731
    kw = {"titulos": dict(source=_titles_source, commit=False),
          "historico": dict(paths=fonte, bens=lambda y: [], universe=_universe, commit=False),
          "mandatos_tse": dict(published_on=when, commit=False)}
    return tuple((n, functools.partial(f, **kw.get(n, {}))) for n, f in repairs.STEPS)


def _sync(conn, fonte, **kw):
    return repairs.sync_history(conn, apply=True, paths=fonte, bens=lambda y: [], universe=_universe, commit=False, **kw)


def test_pessoa_nova_ganha_o_historico_do_proprio_titulo(conn, fonte, monkeypatch):
    """Pelos passos da rotina: o check do BUG-039 acusa as linhas ELEITO (dudu 2012 e 2016) depois de `titulos` e zera depois
    do identity.repairs. 2020 (suplente) entra também, porque a pessoa não tem histórico nenhum."""
    with conn.transaction(force_rollback=True):
        base = conn.execute(CHECK).fetchone()["count"]
        ids = _setup(conn)
        monkeypatch.setattr(repairs, "STEPS", _steps(fonte))
        repairs.sync_titles(conn, apply=True, source=_titles_source, commit=False)
        # o bug: título com linha ELEITO e pessoa sem a candidatura (dudu 2012 e 2016, beto, caio, e as 2 linhas recusadas)
        assert conn.execute(CHECK).fetchone()["count"] == base + 6
        assert conn.execute(CHECK + " and t.titulo = %s", (T_DUDU,)).fetchone()["count"] == 2
        people_before = conn.execute("select count(*) n from people").fetchone()["n"]
        outro_before = conn.execute("select * from candidacies where person_id = %s", (ids["outro"],)).fetchall()

        res = repairs.run_identity_repairs(conn, apply=True)

        # zera para quem casou; as 2 linhas ELEITO recusadas (título de outra pessoa) seguem acusadas: decisão humana, não do reparo
        assert conn.execute(CHECK).fetchone()["count"] == base + 2
        assert conn.execute(CHECK + " and t.titulo = any(%s)", ([T_DUDU, *T_EXTRA],)).fetchone()["count"] == 0
        assert res.get("historico") == 5  # dudu 2012/2016/2020 + beto + caio (maria e ana recusadas)
        assert _cands(conn, ids["dudu"]) == {2024: ("990530002024", "eleito"), 2020: ("990530000120", "suplente"),
                                             2016: ("990530000116", "eleito"), 2012: ("990530000112", "eleito_qp")}
        ms = {(r["started_on"], r["status"]) for r in conn.execute("select started_on, status from mandates where person_id = %s", (ids["dudu"],))}
        assert ms == {(date(2025, 1, 1), "em_exercicio"), (date(2017, 1, 1), "encerrado"), (date(2013, 1, 1), "encerrado")}
        keys = {r["external_id"] for r in conn.execute(
            """select external_id from person_external_ids x join sources s on s.id = x.source_id and s.slug = 'tse' where person_id = %s""",
            (ids["dudu"],))}
        assert keys == {f"2012:{UE}:990530000112", "2016:990530000116", "2020:990530000120"}  # 2012 com a UE (D224)
        assert conn.execute("select count(*) n from people").fetchone()["n"] == people_before  # não cria pessoa
        assert conn.execute("select * from candidacies where person_id = %s", (ids["outro"],)).fetchall() == outro_before
        logged = {(r["table_name"], r["action"]) for r in conn.execute(
            "select table_name, action from identity_split_log where bug = 'BUG-053' and person_id = %s", (ids["dudu"],))}
        assert logged == {("candidacies", "criado"), ("mandates", "criado"), ("person_external_ids", "criado")}
        n_log = conn.execute("select count(*) n from identity_split_log where bug = 'BUG-053' and person_id = %s and table_name = 'candidacies'",
                             (ids["dudu"],)).fetchone()["n"]
        assert n_log == 3


def test_linha_de_outra_pessoa_e_recusada(conn, fonte):
    """Título repetido pelo TSE (BUG-041/044, PR #27): a linha de 2016 com o título da Maria é de outra pessoa, e o título da
    Ana aparece em 2 SQ da mesma eleição com primeiros nomes diferentes. Nenhuma entra na pessoa; vão para a nota."""
    with conn.transaction(force_rollback=True):
        ids = _setup(conn)
        repairs.sync_titles(conn, apply=True, source=_titles_source, commit=False)
        plan = repairs.plan_history(conn, paths=fonte, universe=_universe)
        rec = {(i["titulo"], i["sq"]): i["why"] for i in plan["recusadas"]}
        assert "título repetido" in rec[(T_MARIA, "990530000216")]
        assert "título repetido" in rec[(T_ANA, "990530000316")]
        assert (T_ANA, "990530000317") in rec  # a outra linha do mesmo título também não prova nada
        assert not {(i["titulo"], i["sq"]) for i in plan["aceitas"]} & set(rec)
        assert plan["fora"][repairs.FORA_COM_HISTORICO] == 1  # suplência de 2012 de quem já tem 2016 no banco
        people_before = conn.execute("select count(*) n from people").fetchone()["n"]
        queue_before = conn.execute("select count(*) n from identity_match_queue").fetchone()["n"]
        _sync(conn, fonte)
        assert set(_cands(conn, ids["maria"])) == {2024}
        assert set(_cands(conn, ids["ana"])) == {2024}
        assert conn.execute("select count(*) n from people").fetchone()["n"] == people_before
        assert conn.execute("select count(*) n from identity_match_queue").fetchone()["n"] == queue_before
        assert not conn.execute("select 1 from candidacies where tse_sequencial in ('990530000216', '990530000316', '990530000317')").fetchone()


def test_loader_recusa_dono_divergente(conn, fonte):
    """Segunda trava, no loader: mesmo que a classificação aceite, a linha cujo resolve não cai no dono esperado não entra."""
    from civico_etl.db import Run
    from civico_etl.jobs.tse_candidatos import _load_year

    with conn.transaction(force_rollback=True):
        ids = _setup(conn)
        repairs.sync_titles(conn, apply=True, source=_titles_source, commit=False)
        r = Run(conn, "teste", "tse-titulo")
        _load_year(conn, r, 2016, None, None, None, False, cand_paths=fonte(2016), only={(UE, "990530000216")}, bug="BUG-053",
                   owners={(UE, "990530000216"): ids["maria"]})
        assert set(_cands(conn, ids["maria"])) == {2024}
        assert r.rows_rejected == 1 and any("histórico do título recusado" in n for n in r.notes)


def _snapshot(conn, ids: dict[str, str]) -> dict:
    pids = [ids[k] for k in ("dudu", "maria", "ana", "beto", "caio", "velho", "outro")]
    q = {
        "candidacies": "select id::text k, xmin::text v from candidacies where person_id = any(%s::uuid[])",
        "mandates": "select id::text k, xmin::text v from mandates where person_id = any(%s::uuid[])",
        "ext": "select id::text k, xmin::text v from person_external_ids where person_id = any(%s::uuid[])",
        "split": "select id::text k, xmin::text v from identity_split_log where person_id = any(%s::uuid[])",
    }
    out = {name: sorted((r["k"], r["v"]) for r in conn.execute(sql, (pids,))) for name, sql in q.items()}
    out["titulos"] = sorted((r["k"], r["v"]) for r in conn.execute(
        "select titulo || year || ue || tse_sequencial k, xmin::text v from tse_titulo_candidatura where titulo = any(%s)", (sorted(TITLES),)))
    out["elections"] = sorted((r["k"], r["v"]) for r in conn.execute(
        "select id::text k, xmin::text v from elections where year in (2012, 2016, 2020)"))
    out["people"] = conn.execute("select count(*) n from people").fetchone()["n"]
    out["queue"] = conn.execute("select count(*) n from identity_match_queue").fetchone()["n"]
    return out


def test_idempotente_nem_updated_at(conn, fonte):
    """Segunda execução, com as recusadas ainda no universo: 0 e nenhuma linha regravada (xmin igual, num savepoint próprio)."""
    with conn.transaction(force_rollback=True):
        ids = _setup(conn)
        repairs.sync_titles(conn, apply=True, source=_titles_source, commit=False)
        with conn.transaction():
            assert _sync(conn, fonte) == 5
        before = _snapshot(conn, ids)
        with conn.transaction():
            assert _sync(conn, fonte) == 0
            assert repairs.sync_history(conn, apply=False, paths=fonte, universe=_universe, commit=False) == 0
        assert _snapshot(conn, ids) == before
        assert len(repairs.plan_history(conn, paths=fonte, universe=_universe)["recusadas"]) == 3  # seguem só na nota


def test_teto_por_grupo_e_run_parcial(conn, fonte):
    """Teto de 1: o 1º grupo (pessoa, ano) com eleito entra inteiro, o resto fica para a próxima e o run fecha partial."""
    from civico_etl.db import Run

    with conn.transaction(force_rollback=True):
        ids = _setup(conn)
        repairs.sync_titles(conn, apply=True, source=_titles_source, commit=False)
        assert repairs.sync_history(conn, apply=False, paths=fonte, universe=_universe, cap=1, commit=False) == 1
        r = Run(conn, repairs.HISTORY_DATASET, "tse-titulo")
        plan = repairs.plan_history(conn, paths=fonte, universe=_universe)
        assert repairs.apply_history(conn, r, plan, cap=1, bens=lambda y: [], commit=False) == 1
        assert r.partial_why and "teto de 1" in r.partial_why[0]
        got = [k for k in ("dudu", "beto", "caio") if len(_cands(conn, ids[k])) > 1]
        assert len(got) == 1
        r2 = Run(conn, repairs.HISTORY_DATASET, "tse-titulo")
        assert repairs.apply_history(conn, r2, repairs.plan_history(conn, paths=fonte, universe=_universe), cap=1, bens=lambda y: [],
                                     commit=False) == 1  # a próxima execução retoma
        r3 = Run(conn, repairs.HISTORY_DATASET, "tse-titulo")
        assert repairs.apply_history(conn, r3, repairs.plan_history(conn, paths=fonte, universe=_universe), cap=200, bens=lambda y: [],
                                     commit=False) == 3
        assert not r3.partial_why
        assert {k: len(_cands(conn, ids[k])) for k in ("dudu", "beto", "caio")} == {"dudu": 4, "beto": 2, "caio": 2}


def test_teto_nao_parte_o_grupo():
    items = [{"person_id": "p1", "year": 2016, "result": "ELEITO", "sq": "1"}, {"person_id": "p1", "year": 2016, "result": "#NULO#", "sq": "2"},
             {"person_id": "p2", "year": 2012, "result": "SUPLENTE", "sq": "3"}, {"person_id": "p3", "year": 2012, "result": "ELEITO", "sq": "4"}]
    take, rest = repairs._cap_groups(items, 1)
    assert {i["sq"] for i in take} == {"1", "2"} and {i["sq"] for i in rest} == {"3", "4"}
    take, rest = repairs._cap_groups(items, 3)
    assert {i["sq"] for i in take} == {"1", "2", "4"} and {i["sq"] for i in rest} == {"3"}  # eleito antes de suplente


def test_passo_na_ordem_da_rotina():
    names = [n for n, _ in repairs.STEPS]
    assert names.index("historico") == names.index("titulos") + 1
    assert repairs.HISTORY_CAP == 200
