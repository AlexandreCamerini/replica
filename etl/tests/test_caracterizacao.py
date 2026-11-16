"""R-2: testes de caracterização de coletores, um caso por comando. Rodam o comando pela CLI sobre entrada FABRICADA, num banco
isolado (nunca o da suíte), e comparam as tabelas de destino com o retrato versionado em etl/tests/retratos/.

Coletor cuja entrada não dá para fabricar com fidelidade (zip do TSE lido por faixa) fica declarado "sem caracterização" e não é tocado por dentro.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from urllib.parse import unquote

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from caracterizacao import MARCA, Tabela, compara_com_retrato, retrato_tabelas, rodar_cli
from conftest import database_url
from psycopg.rows import dict_row

from civico_etl.jobs.camara_equipe import URL as EQUIPE_URL

# ---------------------------------------------------------------- camara.equipe

CSV_CAB = "ponto;nome;cargo;grupo;uriLotacao\n"
# FABRICADO. Ramos: dois gabinetes (90001, 90002); cargo vazio; grupo que não é "Secretário Parlamentar"; lotação que não é de deputado;
# deputado fora do diretório (99999 vira nota). O arquivo real é maior e tem mais colunas; o job só lê estas cinco.
CSV_1 = CSV_CAB + "\n".join(
    [
        "1001;MARIA DA SILVA SOUZA;SP12;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1002;JOSÉ DE OLIVEIRA;SP05;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90002",
        "1003;ANA PAULA LIMA;;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1004;CARLOS ALBERTO PINTO;SP08;Assessor Técnico;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1005;PEDRO SANTOS;SP01;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/orgaos/1234",
        "1006;LUIZA FERREIRA;SP03;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/99999",
    ]
) + "\n"
# rodada 2: o 1002 saiu do gabinete 90002; o 1001 mudou de nível; o 1007 entrou
CSV_2 = CSV_CAB + "\n".join(
    [
        "1001;MARIA DA SILVA SOUZA;SP14;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1003;ANA PAULA LIMA;;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1004;CARLOS ALBERTO PINTO;SP08;Assessor Técnico;https://dadosabertos.camara.leg.br/api/v2/deputados/90001",
        "1007;RAFAEL DE SOUZA E SILVA;SP02;Secretário Parlamentar;https://dadosabertos.camara.leg.br/api/v2/deputados/90002",
    ]
) + "\n"

TABELAS = {
    "staff_members": Tabela(
        ordem="source_key",
        fk={"person_id": ("people", "id", "slug")},
        # as_of = date.today() da carga (data de execução, não da fonte): conferido à parte no teste
        ignorar=("as_of",),
    ),
}
RUNS = {
    "ingest_runs": Tabela(
        ordem="started_at, created_at",
        colunas=("dataset", "status", "input_checksum", "rows_upserted", "rows_rejected", "rows_read", "rows_deleted", "error", "notes", "source_id"),
        fk={"source_id": ("sources", "id", "slug")},
        onde="dataset = 'camara.equipe'",
    ),
    "dataset_stamps": Tabela(ordem="dataset", fk={"source_id": ("sources", "id", "slug")}, onde="dataset = 'camara.equipe'"),
}
CONTADAS = ("staff_members", "ingest_runs", "dataset_stamps", "people")


def _contagens(c) -> dict[str, int]:
    return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in CONTADAS}


def _preparar(url: str) -> None:
    """Estado mínimo no banco isolado: 2 pessoas fabricadas com id externo da Câmara. Limpa antes (idempotente) para o caso partir do mesmo estado."""
    _limpar(url)
    with psycopg.connect(url, row_factory=dict_row) as c:
        src = c.execute("select id from sources where slug = 'camara'").fetchone()["id"]
        for slug, nome, ext in (("fab-deputada-a", "Deputada Fabricada A", "90001"), ("fab-deputado-b", "Deputado Fabricado B", "90002")):
            pid = c.execute("insert into people (slug, display_name) values (%s, %s) returning id", (slug, nome)).fetchone()["id"]
            c.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, %s, 'exact_id', 1)", (pid, src, ext))


def _limpar(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("delete from staff_members where source_key like 'camara:%'")
        c.execute("delete from dataset_stamps where dataset = 'camara.equipe'")
        c.execute("delete from ingest_runs where dataset = 'camara.equipe'")
        c.execute("delete from people where slug like 'fab-%'")  # person_external_ids cai em cascata


def test_camara_equipe(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `camara.equipe` (secretários parlamentares por gabinete) em 3 rodadas: carga, saída de um secretário (o job é retrato: apaga), entrada inalterada (SkipUnchanged)."""
    iso = banco_isolado
    assert iso != database_url() and iso.rsplit("/", 1)[-1].startswith(database_url().rsplit("/", 1)[-1] + "_iso_")
    antes = _contagens(conn)  # banco da suíte: nada do que segue pode tocá-lo
    chamadas: list[str] = []
    corpo: dict[str, bytes] = {}

    def respostas(req):
        chamadas.append(str(req.url))
        if str(req.url) != EQUIPE_URL:
            raise AssertionError(f"URL não prevista: {req.url}")
        return 200, {"content-type": "text/csv"}, corpo["csv"]

    def rodada(csv: str) -> int:
        corpo["csv"] = b"\xef\xbb\xbf" + csv.encode("utf-8")  # BOM, como o arquivo real (o job lê utf-8-sig)
        return rodar_cli(["camara.equipe"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    _preparar(iso)
    try:
        d0 = date.today()
        assert rodada(CSV_1) == 0
        r1 = retrato_tabelas(iso, TABELAS)
        runs1 = retrato_tabelas(iso, RUNS)
        assert {r["as_of"] for r in _as_of(iso)} <= {d0.isoformat(), date.today().isoformat()}  # as_of = dia da carga

        assert rodada(CSV_2) == 0
        r2 = retrato_tabelas(iso, TABELAS)
        assert "camara:1002" not in {r["source_key"] for r in r2["staff_members"]}  # quem saiu é APAGADO
        assert "camara:1002" in {r["source_key"] for r in r1["staff_members"]}

        assert rodada(CSV_2) == 0  # mesma entrada: SkipUnchanged capturada dentro do job, saída 0
        r3 = retrato_tabelas(iso, TABELAS)
        runs3 = retrato_tabelas(iso, RUNS)
        assert r3 == r2
        assert len(chamadas) == 3 and set(chamadas) == {EQUIPE_URL}

        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            ultimo = c.execute("select id, status from ingest_runs where dataset = 'camara.equipe' order by started_at desc, created_at desc limit 1").fetchone()
            stamp = c.execute("select last_run_id from dataset_stamps where dataset = 'camara.equipe'").fetchone()
        assert ultimo["status"] == "skipped_unchanged" and stamp["last_run_id"] == ultimo["id"]  # entrada igual também carimba

        compara_com_retrato(
            "camara_equipe",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (CSV pequeno, 2 deputados fabricados); as_of, run_id e horários ignorados; person_id trocado pelo slug",
                "csv_1_sha256": hashlib.sha256(corpo_de(CSV_1)).hexdigest(),
                "csv_2_sha256": hashlib.sha256(corpo_de(CSV_2)).hexdigest(),
                "rodada_1_carga": {**r1, "runs_ate_aqui": runs1},
                "rodada_2_saiu_um_secretario": r2,
                "rodada_3_entrada_inalterada": {**r3, "runs_ate_aqui": runs3},
            },
        )
    finally:
        _limpar(iso)

    assert _contagens(conn) == antes  # nada foi gravado em `admin_coleta`


def corpo_de(csv: str) -> bytes:
    return b"\xef\xbb\xbf" + csv.encode("utf-8")


def _as_of(url: str):
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return [{"as_of": r["as_of"].isoformat()} for r in c.execute("select distinct as_of from staff_members")]


# ---------------------------------------------------------------- R5: receita.arrecadacao, ibge.places, ibge.populacao, governos.indicadores
# Mesmo padrão de camara.equipe. Toda entrada é FABRICADA e o transporte HTTP é falso. Cada teste confere o banco isolado antes e depois.

R5_FOTO = {
    "places": Tabela(ordem="ibge_code", fk={"parent_id": ("places", "id", "ibge_code")}),
    # ordem pela chave natural do lugar (ibge_code): há homônimos (duas "Câmara Municipal de Nova Esperança"), então `name` sozinho empata
    "legislative_bodies": Tabela(
        ordem="kind, name, (select p.ibge_code from places p where p.id = legislative_bodies.place_id)",
        fk={"place_id": ("places", "id", "ibge_code")},
    ),
    "salaries": Tabela(
        ordem="valid_from",
        onde="place_id is not null",
        fk={"office_id": ("offices", "id", "slug"), "place_id": ("places", "id", "ibge_code"), "source_id": ("sources", "id", "slug")},
    ),
    "w4_tax_revenue": Tabela(ordem="year, month, uf, tax"),
    "w4_yearly_indicators": Tabela(ordem="indicator, year", fk={"source_id": ("sources", "id", "slug")}),
    "ingest_runs": Tabela(ordem="started_at, created_at", fk={"source_id": ("sources", "id", "slug")}),
    "dataset_stamps": Tabela(ordem="dataset", fk={"source_id": ("sources", "id", "slug")}),
}


def _r5_foto(url: str) -> dict:
    """Retrato integral do banco isolado nas tabelas que os quatro coletores podem tocar (usado para provar a volta ao estado inicial)."""
    return retrato_tabelas(url, R5_FOTO)


def _r5_contagens(c) -> dict[str, int]:
    return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in R5_FOTO}


def _r5_conta_url(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return _r5_contagens(c)


def _r5_runs(url: str, datasets: tuple[str, ...]) -> dict:
    nomes = ", ".join(f"'{d}'" for d in datasets)
    return retrato_tabelas(
        url,
        {
            "ingest_runs": Tabela(ordem="started_at, created_at", fk={"source_id": ("sources", "id", "slug")}, onde=f"dataset in ({nomes})"),
            "dataset_stamps": Tabela(ordem="dataset", fk={"source_id": ("sources", "id", "slug")}, onde=f"dataset in ({nomes})"),
        },
    )


def _r5_ultimo(url: str, dataset: str):
    """(último run do dataset, last_run_id do carimbo)."""
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        run_ = c.execute("select id, status from ingest_runs where dataset = %s order by started_at desc, created_at desc limit 1", (dataset,)).fetchone()
        stamp = c.execute("select last_run_id from dataset_stamps where dataset = %s", (dataset,)).fetchone()
    return run_, stamp["last_run_id"]


def _r5_apagar(url: str, datasets: tuple[str, ...], tabelas: tuple[str, ...] = ()) -> None:
    """Limpeza no banco ISOLADO: carimbos antes de runs (ordem de FK), depois as tabelas de destino inteiras (o teste afirma que estavam vazias)."""
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("delete from dataset_stamps where dataset = any(%s)", (list(datasets),))
        c.execute("delete from ingest_runs where dataset = any(%s)", (list(datasets),))
        for t in tabelas:
            c.execute(f"delete from {t}")


def _r5_corpo(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


# ---- receita.arrecadacao

# FABRICADO. Colunas: ano;mês;UF; COFINS; COFINS - DEMAIS; IRPJ. Cobre: ano anterior a 2013 (não gravado); vírgula decimal; ponto de milhar
# (91.155.798); célula vazia (não vira zero); linha com todas as células vazias; 6 meses de 2023 (faz a checagem de escala rodar).
# NÃO cobre: a regra de pai e filhos com valor (vira SystemExit antes do run); valor ilegível (ValueError antes do run).
CSV_RECEITA = (
    "\n".join(
        [
            "Ano;Mês;UF;COFINS;COFINS - DEMAIS;IRPJ",
            "2012;janeiro;SP;100,00;;50,00",
            "2023;janeiro;SP;133165371,2;;55000000,5",
            "2023;fevereiro;SP;;120000000,0;54000000,0",
            "2023;março;SP;131000000,0;;53000000,0",
            "2023;abril;SP;;118000000,0;",
            "2023;maio;SP;129000000,0;;52000000,0",
            "2023;junho;SP;;91.155.798;50000000,0",
            "2023;janeiro;RJ;30000000,0;;20000000,0",
            "2023;fevereiro;RJ;;28000000,0;19000000,0",
            "2023;março;RJ;29000000,0;;20500000,0",
            "2023;abril;RJ;;27000000,0;",
            "2023;maio;RJ;;;",
            "2023;junho;RJ;28000000,0;;19500000,0",
        ]
    )
    + "\n"
)


def test_receita_arrecadacao(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `receita.arrecadacao` (arrecadação federal por UF, mês e tributo) com 2 UFs, 6 meses de 2023, um ano anterior
    a 2013 (não gravado), vírgula decimal, ponto de milhar e células vazias. Duas rodadas com a mesma entrada: carga e entrada inalterada
    (SkipUnchanged, 2ª rodada sai do cache de HTTP, sem chamada)."""
    from civico_etl.jobs.receita_arrecadacao import URL as RECEITA_URL

    iso = banco_isolado
    antes = _r5_contagens(conn)  # banco da suíte: nada do que segue pode tocá-lo
    antes_iso = _r5_foto(iso)
    antes_iso_n = _r5_conta_url(iso)
    corpo = CSV_RECEITA.encode("latin-1")  # o arquivo real é latin-1 (o job lê latin-1)
    chamadas: list[str] = []

    def respostas(req):
        chamadas.append(str(req.url))
        if str(req.url) != RECEITA_URL:
            raise AssertionError(f"URL não prevista: {req.url}")
        return 200, {"content-type": "text/csv"}, corpo

    def rodada() -> int:
        return rodar_cli(["receita.arrecadacao"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    tab = {"w4_tax_revenue": R5_FOTO["w4_tax_revenue"]}
    try:
        assert rodada() == 0
        assert _r5_ultimo(iso, "receita.arrecadacao")[0]["status"] == "succeeded"
        r1 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("receita.arrecadacao",))}

        assert rodada() == 0
        r2 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("receita.arrecadacao",))}
        assert r2["w4_tax_revenue"] == r1["w4_tax_revenue"]  # entrada inalterada: mesma tabela
        assert len(chamadas) == 1  # a 2ª rodada veio do cache (max_age de 1 dia), sem tocar o transporte
        run_, stamp = _r5_ultimo(iso, "receita.arrecadacao")
        assert run_["status"] == "skipped_unchanged" and stamp == run_["id"]  # entrada igual também carimba

        compara_com_retrato(
            "receita_arrecadacao",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (CSV latin-1 pequeno, 2 UFs, 6 meses de 2023); run_id, horários e created/updated ignorados",
                "csv_sha256": hashlib.sha256(corpo).hexdigest(),
                "chamadas_rodada_1": 1,
                "rodada_1_carga": r1,
                "rodada_2_entrada_inalterada": r2,
            },
        )
    finally:
        _r5_apagar(iso, ("receita.arrecadacao",), ("w4_tax_revenue",))

    assert _r5_foto(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_conta_url(iso) == antes_iso_n
    assert _r5_contagens(conn) == antes  # nada foi gravado em `admin_coleta`


# ---- ibge.places

R5_ESTADOS = [  # FABRICADO no formato de /estados; id, nome, sigla e região iguais aos de base.sql
    {"id": 11, "sigla": "RO", "nome": "Rondônia", "regiao": {"id": 1, "sigla": "N", "nome": "Norte"}},
    {"id": 35, "sigla": "SP", "nome": "São Paulo", "regiao": {"id": 3, "sigla": "SE", "nome": "Sudeste"}},
    {"id": 53, "sigla": "DF", "nome": "Distrito Federal", "regiao": {"id": 5, "sigla": "CO", "nome": "Centro-Oeste"}},
]
# FABRICADO no formato de /municipios?view=nivelado. Códigos 3550308, 3509502 e 1100015 são de municípios reais; 1100098 e 1100106 são
# fabricados e têm o mesmo nome na mesma UF, para cobrir o sufixo de slug pelo código.
R5_MUNIS = [
    {"municipio-id": 3550308, "municipio-nome": "São Paulo", "UF-id": 35, "UF-sigla": "SP"},
    {"municipio-id": 3509502, "municipio-nome": "Campinas", "UF-id": 35, "UF-sigla": "SP"},
    {"municipio-id": 1100015, "municipio-nome": "Alta Floresta D'Oeste", "UF-id": 11, "UF-sigla": "RO"},
    {"municipio-id": 1100098, "municipio-nome": "Nova Esperança", "UF-id": 11, "UF-sigla": "RO"},
    {"municipio-id": 1100106, "municipio-nome": "Nova Esperança", "UF-id": 11, "UF-sigla": "RO"},
]


def test_ibge_places(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `ibge.places` (país, regiões, UFs, municípios e casas legislativas) com 3 UFs (RO, SP e DF, que cobre a câmara
    legislativa do DF) e 5 municípios, dois deles homônimos na mesma UF. Duas rodadas com a mesma entrada: carga e entrada inalterada
    (SkipUnchanged). No fim, os municípios e as casas municipais criados são apagados e o banco isolado volta ao estado inicial."""
    from civico_etl.jobs.ibge_places import API as LOCAL_API

    iso = banco_isolado
    antes = _r5_contagens(conn)
    antes_iso = _r5_foto(iso)
    antes_iso_n = _r5_conta_url(iso)
    urls = {
        f"{LOCAL_API}/estados?orderBy=nome": R5_ESTADOS,
        f"{LOCAL_API}/municipios?view=nivelado&orderBy=nome": R5_MUNIS,
    }
    chamadas: list[str] = []

    def respostas(req):
        chamadas.append(str(req.url))
        if str(req.url) not in urls:
            raise AssertionError(f"URL não prevista: {req.url}")
        return 200, {"content-type": "application/json"}, _r5_corpo(urls[str(req.url)])

    def rodada() -> int:
        return rodar_cli(["ibge.places"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    tab = {"places": R5_FOTO["places"], "legislative_bodies": R5_FOTO["legislative_bodies"]}
    try:
        assert rodada() == 0
        assert _r5_ultimo(iso, "ibge.places")[0]["status"] == "succeeded"
        r1 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("ibge.places",))}
        assert _r5_conta_url(iso)["places"] == antes_iso_n["places"] + 5  # os 5 municípios; UFs e regiões já existiam na base

        assert rodada() == 0
        r2 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("ibge.places",))}
        assert r2["places"] == r1["places"] and r2["legislative_bodies"] == r1["legislative_bodies"]
        run_, stamp = _r5_ultimo(iso, "ibge.places")
        assert run_["status"] == "skipped_unchanged" and stamp == run_["id"]
        assert len(chamadas) == 4  # sem cache de dia: cada rodada baixa as 2 URLs de novo (2 + 2)

        compara_com_retrato(
            "ibge_places",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (3 UFs, 3 regiões, 5 municípios, 1 homônimo); id e created/updated ignorados; parent_id e place_id trocados pelo ibge_code",
                "estados_sha256": hashlib.sha256(_r5_corpo(R5_ESTADOS)).hexdigest(),
                "municipios_sha256": hashlib.sha256(_r5_corpo(R5_MUNIS)).hexdigest(),
                "rodada_1_carga": r1,
                "rodada_2_entrada_inalterada": r2,
            },
        )
    finally:
        with psycopg.connect(iso, autocommit=True) as c:
            c.execute("delete from legislative_bodies where kind in ('assembleia', 'camara_municipal', 'camara_legislativa_df')")
            c.execute("delete from places where kind = 'municipio'")
        _r5_apagar(iso, ("ibge.places",))

    with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
        assert c.execute("select count(*) as n from places where kind = 'municipio'").fetchone()["n"] == 0  # nenhum município sobra
    assert _r5_foto(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_conta_url(iso) == antes_iso_n
    assert _r5_contagens(conn) == antes  # nada foi gravado em `admin_coleta`


# ---- ibge.populacao (encadeia run_seed depois da carga)

R5_POP_PERIODOS = [{"id": 2024}, {"id": 2025}]
# FABRICADO. N6 traz: um valor não numérico ("...", vira "1 município sem estimativa"); um código que não existe no banco (é ignorado).
R5_POP = {
    "N1[all]": [{"localidade": {"id": "1", "nome": "Brasil"}, "serie": {"2025": "212000000"}}],
    "N3[all]": [
        {"localidade": {"id": "35", "nome": "São Paulo"}, "serie": {"2025": "46000000"}},
        {"localidade": {"id": "11", "nome": "Rondônia"}, "serie": {"2025": "1800000"}},
    ],
    "N6[all]": [
        {"localidade": {"id": "3550308", "nome": "São Paulo"}, "serie": {"2025": "11451000"}},
        {"localidade": {"id": "1100015", "nome": "Alta Floresta D'Oeste"}, "serie": {"2025": "..."}},
        {"localidade": {"id": "9999999", "nome": "Inexistente"}, "serie": {"2025": "1000"}},
    ],
}


def test_ibge_populacao(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `ibge.populacao` (população estimada por país, UF e município) e o passo encadeado `run_seed`, que grava os tetos
    de vereador em `salaries` para os municípios que têm população. Os dois municípios são inseridos direto no banco isolado (não por
    ibge.places). Duas rodadas com a mesma entrada: carga e entrada inalterada (a carga é pulada; o seed roda de novo). No fim, os municípios,
    os tetos e as populações das linhas base voltam ao estado inicial."""
    from civico_etl.jobs.ibge_populacao import API as POP_API

    iso = banco_isolado
    antes = _r5_contagens(conn)
    antes_iso = _r5_foto(iso)
    antes_iso_n = _r5_conta_url(iso)
    chamadas: list[str] = []

    def resposta_json(req):
        path = unquote(req.url.path)
        if path == "/api/v3/agregados/6579/periodos":
            return R5_POP_PERIODOS
        if path == "/api/v3/agregados/6579/periodos/2025/variaveis/9324":
            nivel = req.url.params.get("localidades")
            if nivel not in R5_POP:
                raise AssertionError(f"populacao: localidades não previstas: {nivel}")
            return [{"resultados": [{"series": R5_POP[nivel]}]}]
        raise AssertionError(f"URL não prevista: {req.url}")

    def respostas(req):
        chamadas.append(str(req.url))
        return 200, {"content-type": "application/json"}, _r5_corpo(resposta_json(req))

    def rodada() -> int:
        return rodar_cli(["ibge.populacao"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    tab = {
        "places": Tabela(
            ordem="ibge_code",
            fk={"parent_id": ("places", "id", "ibge_code")},
            onde="ibge_code in ('BR', '11', '35') or kind = 'municipio'",
        ),
        "salaries": R5_FOTO["salaries"],
    }
    with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
        antes_pop = {r["ibge_code"]: (r["population"], r["population_year"]) for r in c.execute("select ibge_code, population, population_year from places").fetchall()}
        # municípios de base para o teste (inseridos direto; o teste afirma que não havia nenhum antes)
        assert c.execute("select count(*) as n from places where kind = 'municipio'").fetchone()["n"] == 0
        c.execute(
            """insert into places (ibge_code, kind, name, slug, uf, parent_id)
               select v.ibge_code, 'municipio', v.nome, v.slug, v.uf, p.id
               from (values ('3550308', 'São Paulo', 'sao-paulo-sp', 'SP', '35'),
                            ('1100015', 'Alta Floresta D''Oeste', 'alta-floresta-doeste-ro', 'RO', '11')) as v(ibge_code, nome, slug, uf, pai)
               join places p on p.ibge_code = v.pai"""
        )

    try:
        assert rodada() == 0
        assert _r5_ultimo(iso, "ibge.populacao")[0]["status"] == "succeeded"
        r1 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("ibge.populacao",))}
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            notas = c.execute("select notes from ingest_runs where dataset = 'ibge.populacao' order by started_at desc, created_at desc limit 1").fetchone()["notes"]
            sp_teto = c.execute(
                "select count(*) as n from salaries s join places p on p.id = s.place_id where p.ibge_code = '3550308'"
            ).fetchone()["n"]
            ro_teto = c.execute(
                "select count(*) as n from salaries s join places p on p.id = s.place_id where p.ibge_code = '1100015'"
            ).fetchone()["n"]
        assert notas == "1 municípios sem estimativa de 2025"
        assert sp_teto > 0 and ro_teto == 0  # o seed encadeado põe teto só onde há população

        assert rodada() == 0
        r2 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, ("ibge.populacao",))}
        assert r2["places"] == r1["places"] and r2["salaries"] == r1["salaries"]
        run_, stamp = _r5_ultimo(iso, "ibge.populacao")
        assert run_["status"] == "skipped_unchanged" and stamp == run_["id"]
        assert len(chamadas) == 4  # 1 de periodos + 3 de variáveis, na 1ª rodada; a 2ª veio do cache de 1 dia

        compara_com_retrato(
            "ibge_populacao",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (BR, 2 UFs, 2 municípios inseridos no banco isolado, 1 valor '...' e 1 código inexistente); run_id e horários ignorados; parent_id e office/place/source trocados por chave natural",
                "rodada_1_carga": r1,
                "rodada_2_entrada_inalterada": r2,
            },
        )
    finally:
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            c.execute("delete from salaries where place_id in (select id from places where kind = 'municipio')")
            c.execute("delete from places where kind = 'municipio'")
            for codigo, (pop, ano) in antes_pop.items():
                c.execute("update places set population = %s, population_year = %s where ibge_code = %s", (pop, ano, codigo))
        _r5_apagar(iso, ("ibge.populacao",))

    assert _r5_foto(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_conta_url(iso) == antes_iso_n
    assert _r5_contagens(conn) == antes  # nada foi gravado em `admin_coleta`


# ---- governos.indicadores

# Séries FABRICADAS: (primeiro ano, último ano, sufixo do período, classificação ou None, série devolvida).
# Séries devolvem só alguns períodos (o job grava o que vem). "..", em 6784 2023, é ignorado e ativa o fallback do 4º trimestre.
R5_SIDRA = {
    ("6784", "9810"): (1996, 2025, "", None, {"2021": "4.8", "2022": "3.0", "2023": ".."}),
    ("5932", "6562"): (1997, 2025, "04", "11255[90707]", {"202204": "2.2", "202304": "2.9", "202404": "3.4"}),
    ("1737", "2265"): (1980, 2025, "12", None, {"202112": "10.06", "202212": "5.79", "202312": "4.62"}),
    ("10379", "4099"): (2012, 2025, "", "2[6794]", {"2023": "8.0", "2024": "6.6"}),
}


def _r5_sgs(ano: int) -> list[dict]:
    """Selic meta (SGS 432) em dezembro. 2022 tem duas observações (a última, 29/12, é 13,75). 2023 não tem observação."""
    if ano == 2022:
        return [{"data": "01/12/2022", "valor": "13.25"}, {"data": "29/12/2022", "valor": "13.75"}]
    if ano == 2023:
        return []
    return [{"data": f"31/12/{ano}", "valor": "10.50"}]


def test_governos_indicadores(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `governos.indicadores` (PIB, IPCA, Selic e desocupação, por ano) com séries fabricadas de IBGE/SIDRA e BCB/SGS.
    A data de hoje é fixada em 15/11/2026 (as URLs e o checksum dependem do ano corrente). Cobre: fallback do PIB pelo 4º trimestre com nota,
    valor '..' ignorado, Selic com duas observações em dezembro (vale a última) e um ano sem observação (nota). Duas rodadas com a mesma entrada:
    carga e entrada inalterada. Não cobre: a validação dos valores conhecidos (passa aqui; a falha vira SystemExit antes do run)."""
    import civico_etl.jobs.governos_indicadores as gov
    from datetime import date as _date

    class _Hoje(_date):
        @classmethod
        def today(cls):
            return _date(2026, 11, 15)

    monkeypatch.setattr(gov, "date", _Hoje)  # fixa o ano corrente do job

    iso = banco_isolado
    antes = _r5_contagens(conn)
    antes_iso = _r5_foto(iso)
    antes_iso_n = _r5_conta_url(iso)
    chamadas: list[str] = []

    def resposta(req):
        path = unquote(req.url.path)
        if req.url.host == "api.bcb.gov.br":
            if path != "/dados/serie/bcdata.sgs.432/dados":
                raise AssertionError(f"governos: URL BCB não prevista: {req.url}")
            ini, fim = req.url.params.get("dataInicial"), req.url.params.get("dataFinal")
            ano = int(ini[-4:])
            if not (1999 <= ano <= 2025) or ini != f"01/12/{ano}" or fim != f"31/12/{ano}":
                raise AssertionError(f"governos: janela SGS não prevista: {ini}..{fim}")
            return _r5_sgs(ano)
        if req.url.host == "servicodados.ibge.gov.br":
            m = re.fullmatch(r"/api/v3/agregados/(\d+)/periodos/([^/]+)/variaveis/(\d+)", path)
            if not m or (m.group(1), m.group(3)) not in R5_SIDRA:
                raise AssertionError(f"governos: URL IBGE não prevista: {req.url}")
            tabela, periodos, var = m.groups()
            primeiro, ultimo, suf, classif, serie = R5_SIDRA[(tabela, var)]
            if periodos != "|".join(f"{y}{suf}" for y in range(primeiro, ultimo + 1)):
                raise AssertionError(f"governos: períodos não previstos em {tabela}: {periodos}")
            if req.url.params.get("classificacao") != classif or req.url.params.get("localidades") != "N1[all]":
                raise AssertionError(f"governos: parâmetros não previstos em {tabela}: {req.url.query}")
            return [{"resultados": [{"series": [{"localidade": {"id": "1", "nome": "Brasil"}, "serie": serie}]}]}]
        raise AssertionError(f"governos: host não previsto: {req.url}")

    def respostas(req):
        chamadas.append(str(req.url))
        return 200, {"content-type": "application/json"}, _r5_corpo(resposta(req))

    def rodada() -> int:
        return rodar_cli(["governos.indicadores"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    tab = {"w4_yearly_indicators": R5_FOTO["w4_yearly_indicators"]}
    datasets = ("governos.indicadores", "governos.bcb")
    try:
        assert rodada() == 0
        run1, stamp_ind1 = _r5_ultimo(iso, "governos.indicadores")
        assert run1["status"] == "succeeded" and stamp_ind1 == run1["id"]
        assert _r5_bcb_stamp(iso) == run1["id"]  # a carga carimba as duas fontes com o mesmo run
        r1 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, datasets)}
        assert len(chamadas) == 31  # 4 SIDRA + 27 SGS (1999 a 2025)
        assert r1["w4_yearly_indicators"]  # há linhas gravadas
        assert _r5_checksum(iso).startswith("2026:")  # o checksum carrega o ano fixado

        assert rodada() == 0
        r2 = {**retrato_tabelas(iso, tab), **_r5_runs(iso, datasets)}
        assert r2["w4_yearly_indicators"] == r1["w4_yearly_indicators"]
        assert len(chamadas) == 31  # 2ª rodada veio do cache: nenhuma chamada nova
        run2, stamp_ind2 = _r5_ultimo(iso, "governos.indicadores")
        assert run2["status"] == "skipped_unchanged" and stamp_ind2 == run2["id"]
        # ACHADO (caracterizado, não corrigido): o skip não carimba governos.bcb; o carimbo continua no run 1
        assert _r5_bcb_stamp(iso) == run1["id"]

        compara_com_retrato(
            "governos_indicadores",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (séries SIDRA e SGS curtas); data fixada em 2026-11-15; run_id e horários ignorados",
                "chamadas_total": 31,
                "rodada_1_carga": r1,
                "rodada_2_entrada_inalterada": r2,
            },
        )
    finally:
        _r5_apagar(iso, datasets, ("w4_yearly_indicators",))

    assert _r5_foto(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_conta_url(iso) == antes_iso_n
    assert _r5_contagens(conn) == antes  # nada foi gravado em `admin_coleta`


def _r5_bcb_stamp(url: str):
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return c.execute("select last_run_id from dataset_stamps where dataset = 'governos.bcb'").fetchone()["last_run_id"]


def _r5_checksum(url: str) -> str:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return c.execute("select input_checksum from ingest_runs where dataset = 'governos.indicadores' order by started_at desc, created_at desc limit 1").fetchone()["input_checksum"]


# ---------------------------------------------------------------- R6: parlamento.extras e ale.cobertura
# Mesmo padrão. Entrada FABRICADA, transporte HTTP falso, banco isolado. Nenhuma requisição de rede: nem a de revalidação do derive.stats.

EX_DATASET = ("parlamento.extras",)
EX_TABELAS = {
    "committees": Tabela(
        ordem="source_key, (select b.kind from legislative_bodies b where b.id = committees.body_id)",
        fk={"body_id": ("legislative_bodies", "id", "kind")},
    ),
    "committee_memberships": Tabela(
        # as comissões fabricadas têm source_key distinto entre as duas casas, então source_key identifica a comissão
        ordem="(select c.source_key from committees c where c.id = committee_memberships.committee_id), (select p.slug from people p where p.id = person_id), role, from_on",
        fk={"committee_id": ("committees", "id", "source_key"), "person_id": ("people", "id", "slug")},
    ),
    "speeches": Tabela(
        ordem="source_key, (select b.kind from legislative_bodies b where b.id = speeches.body_id)",
        fk={"person_id": ("people", "id", "slug"), "body_id": ("legislative_bodies", "id", "kind")},
    ),
}
EX_CONTADAS = (
    "people", "person_external_ids", "mandates", "mandate_contacts", "committees", "committee_memberships", "speeches",
    "person_period_stats", "data_coverage", "places", "legislative_bodies", "ingest_runs", "dataset_stamps",
)
EX_SINCE, EX_HOJE = "2025-01-01", "2026-11-15"  # --year 2025 fixa `since`; a data de hoje do job é fixada à parte
EX_A, EX_B, EX_C = "90101", "90102", "5801"  # id externo: deputada A e deputado B (Câmara), senador C (Senado)
EX_PESSOAS = (
    # slug, nome, fonte do id externo, id externo, casa, cargo
    ("fab-extras-dep-a", "Deputada Fabricada Extras A", "camara", EX_A, "camara_deputados", "deputado_federal"),
    ("fab-extras-dep-b", "Deputado Fabricado Extras B", "camara", EX_B, "camara_deputados", "deputado_federal"),
    ("fab-extras-sen-c", "Senador Fabricado Extras C", "senado", EX_C, "senado", "senador"),
)


def _ex_conta(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in EX_CONTADAS}


def _ex_contatos(url: str) -> list[dict]:
    """mandate_contacts por pessoa (slug), fonte (slug) e conteúdo: o mandato não tem chave natural própria, mas cada pessoa fabricada tem um só."""
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return [
            dict(r)
            for r in c.execute(
                """select p.slug as pessoa, s.slug as fonte, k.kind, k.value
                   from mandate_contacts k join mandates m on m.id = k.mandate_id join people p on p.id = m.person_id join sources s on s.id = k.source_id
                   order by p.slug, s.slug, k.kind, k.value"""
            ).fetchall()
        ]


def _ex_limpar(url: str) -> None:
    """Devolve o banco isolado ao estado inicial (o teste afirma que estas tabelas estavam vazias antes)."""
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("delete from speeches where person_id in (select id from people where slug like 'fab-extras-%')")
        c.execute("delete from committee_memberships where person_id in (select id from people where slug like 'fab-extras-%')")
        c.execute("delete from committees where body_id in (select id from legislative_bodies where kind in ('camara_deputados', 'senado'))")
        c.execute("delete from mandates where person_id in (select id from people where slug like 'fab-extras-%')")  # mandate_contacts cai em cascata
        c.execute("delete from data_coverage")  # só o derive.stats encadeado grava aqui neste caso
        c.execute("delete from dataset_stamps where dataset = 'parlamento.extras'")
        c.execute("delete from ingest_runs where dataset = 'parlamento.extras'")
        c.execute("delete from people where slug like 'fab-extras-%'")  # person_external_ids e person_period_stats caem em cascata


def _ex_preparar(url: str) -> dict[str, str]:
    """2 deputados federais e 1 senador em exercício (pessoa, id externo da fonte, mandato). Devolve slug -> id do mandato."""
    _ex_limpar(url)
    out: dict[str, str] = {}
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        place = c.execute("select id from places where ibge_code = 'BR'").fetchone()["id"]
        for slug, nome, fonte, ext, casa, cargo in EX_PESSOAS:
            src = c.execute("select id from sources where slug = %s", (fonte,)).fetchone()["id"]
            body = c.execute("select id from legislative_bodies where kind = %s", (casa,)).fetchone()["id"]
            office = c.execute("select id from offices where slug = %s", (cargo,)).fetchone()["id"]
            pid = c.execute("insert into people (slug, display_name) values (%s, %s) returning id", (slug, nome)).fetchone()["id"]
            c.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, %s, 'exact_id', 1)", (pid, src, ext))
            out[slug] = str(
                c.execute(
                    """insert into mandates (person_id, office_id, place_id, body_id, role, status, started_on, ends_on, status_source)
                       values (%s, %s, %s, %s, 'titular', 'em_exercicio', '2023-02-01', '2027-02-01', %s) returning id""",
                    (pid, office, place, body, fonte),
                ).fetchone()["id"]
            )
    return out


def _ex_entrada(r: int, cam: str, sen: str) -> dict[str, object]:
    """URL completa -> corpo JSON. FABRICADO, no formato das APIs da Câmara (dadosabertos v2) e do Senado (dadosabertos). r = rodada (1 ou 2; a 3 repete a 2)."""
    orgaos = f"?dataInicio={EX_SINCE}&itens=100"
    disc_cam = f"?dataInicio={EX_SINCE}&dataFim={EX_HOJE}&itens=100&ordenarPor=dataHoraInicio&ordem=DESC"
    longo = "Texto fabricado de transcrição do discurso. " * 20  # > 400 caracteres: o resumo é cortado em 400
    u: dict[str, object] = {}
    # ---- Câmara: deputada A (gabinete completo, 6 redes sociais, 2 páginas de órgãos, 3 discursos) e deputado B
    if r == 1:
        gab_a = {"email": "Dep.Fab.A@Camara.leg.br", "telefone": "3215-5101", "sala": "501", "predio": "4", "andar": "5"}
        redes = ["https://www.instagram.com/fabA", "https://twitter.com/fabA", "https://www.facebook.com/fabA", "https://youtube.com/fabA", "https://tiktok.com/@fabA", "https://t.me/fabA"]
        site = "https://fabricado-a.example.org"
    else:  # rodada 2: o e-mail mudou; saíram gabinete, site e cinco redes
        gab_a = {"email": "dep.fab.a.novo@camara.leg.br", "telefone": "3215-5101"}
        redes = ["https://www.instagram.com/fabA"]
        site = None
    u[f"{cam}/deputados/{EX_A}"] = {"dados": {"ultimoStatus": {"gabinete": gab_a}, "urlWebsite": site, "redeSocial": redes}}
    ccjc = {"idOrgao": 2001, "siglaOrgao": "CCJC", "nomePublicacao": "Comissão de Constituição e Justiça e de Cidadania", "titulo": "Titular", "dataInicio": "2025-03-10T00:00"}
    if r == 2:
        ccjc = {**ccjc, "nomePublicacao": "Comissão de Constituição e Justiça (nome novo)", "dataFim": "2025-12-31T00:00"}
    pag1: dict[str, object] = {"dados": [ccjc], "links": [{"rel": "self", "href": f"{cam}/deputados/{EX_A}/orgaos{orgaos}"}]}
    if r == 1:  # só a rodada 1 tem 2ª página (cobre o link rel=next); o 2002 não vem mais na rodada 2 e continua no banco
        pag1["links"].append({"rel": "next", "href": f"{cam}/deputados/{EX_A}/orgaos{orgaos}&pagina=2"})
        u[f"{cam}/deputados/{EX_A}/orgaos{orgaos}&pagina=2"] = {"dados": [{"idOrgao": 2002, "siglaOrgao": None, "nomeOrgao": "Comissão Fabricada de Saúde", "dataFim": "2025-12-31T00:00"}], "links": []}
    u[f"{cam}/deputados/{EX_A}/orgaos{orgaos}"] = pag1
    d1 = {"dataHoraInicio": "2025-05-06T14:30", "tipoDiscurso": "Pronunciamento", "sumario": "<p>Sumário&nbsp;fabricado</p>", "urlTexto": "https://fab.example/texto/1"}
    if r == 2:
        d1 = {**d1, "sumario": "Sumário fabricado revisado", "urlTexto": "https://fab.example/texto/1-revisado"}
    d3 = {"dataHoraInicio": "2025-06-01T09:00", "tipoDiscurso": "Breve Comunicação", "transcricao": longo, "urlVideo": "https://fab.example/video/2"}
    discursos_a = [d1, {"dataHoraInicio": None, "tipoDiscurso": "Sem hora"}] + ([d3] if r == 1 else [])  # o sem hora é descartado; o d3 some na rodada 2 e continua no banco
    u[f"{cam}/deputados/{EX_A}/discursos{disc_cam}"] = {"dados": discursos_a, "links": []}
    # deputado B: rodada 1 só e-mail; rodada 2 sem nenhum contato; mesma comissão 2001 (uma só linha em committees); discurso só com o tipo
    gab_b = {"email": "Dep.Fab.B@Camara.leg.br"} if r == 1 else {}
    u[f"{cam}/deputados/{EX_B}"] = {"dados": {"ultimoStatus": {"gabinete": gab_b}}}
    # o nome da comissão compartilhada é o mesmo nos dois deputados em cada rodada: a ordem de leitura dos mandatos não tem ORDER BY e o último vence
    u[f"{cam}/deputados/{EX_B}/orgaos{orgaos}"] = {"dados": [{**ccjc, "titulo": "Suplente", "dataInicio": "2025-04-01", "dataFim": None}], "links": []}
    u[f"{cam}/deputados/{EX_B}/discursos{disc_cam}"] = {"dados": [{"dataHoraInicio": "2025-07-01T10:00", "tipoDiscurso": "Breves Comunicações"}], "links": []}
    # ---- Senado: lista atual (com um senador que não está no banco), comissões e discursos do senador C
    ident = {"CodigoParlamentar": EX_C, "EmailParlamentar": "Sen.Fab.C@Senado.leg.br" if r == 1 else "sen.fab.c.novo@senado.leg.br",
             "Telefones": {"Telefone": [{"NumeroTelefone": "3303-5801", "IndicadorFax": "Não"}, {"NumeroTelefone": "3303-9999", "IndicadorFax": "Sim"}]}}
    if r == 1:
        ident["UrlPaginaParlamentar"] = "https://www25.senado.leg.br/web/senadores/senador/-/perfil/5801"
    outro = {"CodigoParlamentar": "5999", "EmailParlamentar": "fora.do.banco@senado.leg.br"}
    u[f"{sen}/senador/lista/atual.json"] = {"ListaParlamentarEmExercicio": {"Parlamentares": {"Parlamentar": [{"IdentificacaoParlamentar": outro}, {"IdentificacaoParlamentar": ident}]}}}
    cct = {"IdentificacaoComissao": {"CodigoComissao": "3001", "SiglaComissao": "CCT", "NomeComissao": "Comissão Fabricada de Ciência"}, "DescricaoParticipacao": "Titular", "DataInicio": "2025-02-05"}
    if r == 2:
        cct = {**cct, "IdentificacaoComissao": {**cct["IdentificacaoComissao"], "NomeComissao": "Comissão Fabricada de Ciência (nome novo)"}, "DataFim": "2025-10-01"}
    comissoes = [
        cct,
        {"IdentificacaoComissao": {"CodigoComissao": "3999", "SiglaComissao": "ANT", "NomeComissao": "Comissão antiga"}, "DataInicio": "2019-01-01"},  # anterior a since - 4 anos: ignorada
        {"IdentificacaoComissao": {"SiglaComissao": "SEM", "NomeComissao": "Sem código"}, "DataInicio": "2025-01-01"},  # sem código: ignorada
        {"IdentificacaoComissao": {"CodigoComissao": "3002", "SiglaComissao": None, "NomeComissao": None}, "DataInicio": "2022-03-01", "DataFim": "2024-12-31"},  # nome = código; papel "Membro"
    ]
    u[f"{sen}/senador/{EX_C}/comissoes.json"] = {"MembroComissaoParlamentar": {"Parlamentar": {"MembroComissoes": {"Comissao": comissoes}}}}
    p1 = {"DataPronunciamento": "2025-06-10", "TipoUsoPalavra": {"Descricao": "Discurso"}, "TextoResumo": "<p>Resumo&nbsp;fabricado do senador</p>", "UrlTexto": "https://fab.example/senado/9001", "CodigoPronunciamento": 9001}
    if r == 2:
        p1 = {**p1, "TextoResumo": "Resumo fabricado revisado"}
    pron = [p1, {"TipoUsoPalavra": {"Descricao": "Sem data"}, "CodigoPronunciamento": 9003}, {"DataPronunciamento": "11/06/2025", "CodigoPronunciamento": 9002}]
    u[f"{sen}/senador/{EX_C}/discursos.json?dataInicio=20250101&dataFim=20261115"] = {"DiscursosParlamentar": {"Parlamentar": {"Pronunciamentos": {"Pronunciamento": pron}}}}
    return u


def test_parlamento_extras(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `parlamento.extras` (contato, comissões e discursos de parlamentares em exercício) com 2 deputados federais e 1 senador
    fabricados, em 3 rodadas. Rodada 1: carga. Antes da rodada 2, 5 contatos entram à mão no banco isolado para caracterizar o DELETE de
    mandate_contacts; rodada 2: entrada que muda e tira contatos, comissões e discursos. Rodada 3: entrada idêntica à 2. O job abre run SEM checksum:
    não existe "entrada inalterada" (todo run fecha `succeeded`). O comando encadeia derive.stats depois da carga (gravador que chama a função real);
    o POST de revalidação do derive.stats é neutralizado (sem variável de ambiente e com httpx.post que falha o teste). Cada rodada usa um
    cache de HTTP próprio (o job lê com max_age de 1 dia: a mesma pasta serviria a rodada 1 de novo). Não cobre: parlamentar cuja fonte devolve 404
    (vira rejeição), 2º senador, deputado com mais de 100 órgãos por página além da paginação por link."""
    import civico_etl.jobs.derive_stats as ds
    import civico_etl.jobs.parlamento_extras as pe

    class _Hoje(date):
        @classmethod
        def today(cls):
            return date(2026, 11, 15)

    monkeypatch.setattr(pe, "date", _Hoje)  # fixa a data de hoje do job (dataFim das URLs)

    iso = banco_isolado
    assert iso != database_url() and iso.rsplit("/", 1)[-1].startswith(database_url().rsplit("/", 1)[-1] + "_iso_")
    antes_conn = {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in EX_CONTADAS}
    antes_iso = _ex_conta(iso)
    antes_iso_foto = _r5_foto(iso)
    for t in ("people", "mandates", "mandate_contacts", "committees", "committee_memberships", "speeches", "person_period_stats", "data_coverage"):
        assert antes_iso[t] == 0, f"banco isolado deveria partir sem linhas em {t}"

    # nada de rede: sem variável de revalidação e com o POST do derive.stats falhando o teste se for chamado
    monkeypatch.delenv("REVALIDATE_URL", raising=False)
    monkeypatch.delenv("REVALIDATE_SECRET", raising=False)

    def _sem_post(*a, **k):
        raise AssertionError(f"POST de revalidação não pode acontecer no teste: {a} {k}")

    monkeypatch.setattr(ds.httpx, "post", _sem_post)

    derives: list[dict] = []
    derive_real = ds.run_derive

    def derive_gravador(c):
        ultimo = c.execute("select status from ingest_runs where dataset = 'parlamento.extras' order by started_at desc, created_at desc limit 1").fetchone()
        derives.append({
            "run_ja_fechado": ultimo["status"],
            "contatos_ja_gravados": c.execute("select count(*) as n from mandate_contacts").fetchone()["n"],
            "discursos_ja_gravados": c.execute("select count(*) as n from speeches").fetchone()["n"],
        })
        return derive_real(c)

    monkeypatch.setattr(ds, "run_derive", derive_gravador)

    chamadas: list[str] = []
    estado = {"entrada": {}}

    def respostas(req):
        url = str(req.url)
        chamadas.append(url)
        if url not in estado["entrada"]:
            raise AssertionError(f"URL não prevista: {url}")
        return 200, {"content-type": "application/json"}, _r5_corpo(estado["entrada"][url])

    def rodada(r: int, pasta: str) -> tuple[int, list[str]]:
        estado["entrada"] = _ex_entrada(r, pe.CAMARA, pe.SENADO)
        (tmp_path / pasta).mkdir()
        n0 = len(chamadas)
        cod = rodar_cli(["parlamento.extras", "--year", "2025"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path / pasta)
        return cod, chamadas[n0:]

    def estado_banco() -> dict:
        return {"mandate_contacts": _ex_contatos(iso), **retrato_tabelas(iso, EX_TABELAS)}

    def vals(contatos, pessoa, fonte=None):
        return {(c["fonte"], c["kind"], c["value"]) for c in contatos if c["pessoa"] == pessoa and (fonte is None or c["fonte"] == fonte)}

    mand = _ex_preparar(iso)
    try:
        # ---------------- rodada 1: carga
        cod, urls1 = rodada(1, "r1")
        assert cod == 0
        assert len(urls1) == len(set(urls1)) == 10  # A: deputado, órgãos, órgãos pág. 2, discursos; B: 3; Senado: lista, comissões e discursos de C
        r1 = estado_banco()
        runs1 = _r5_runs(iso, EX_DATASET)
        run1, stamp1 = _r5_ultimo(iso, "parlamento.extras")
        assert run1["status"] == "succeeded" and stamp1 == run1["id"]
        c1 = r1["mandate_contacts"]
        assert len(vals(c1, "fab-extras-dep-a")) == 10 and vals(c1, "fab-extras-dep-b") == {("camara", "email", "dep.fab.b@camara.leg.br")}
        assert ("camara", "gabinete", "Câmara dos Deputados, anexo 4, 5º andar, gabinete 501") in vals(c1, "fab-extras-dep-a")
        assert ("camara", "outra_rede", "https://t.me/fabA") in vals(c1, "fab-extras-dep-a") and ("camara", "x", "https://twitter.com/fabA") in vals(c1, "fab-extras-dep-a")
        assert vals(c1, "fab-extras-sen-c") == {  # fax não entra; e-mail em minúsculas; só o telefone sem fax
            ("senado", "email", "sen.fab.c@senado.leg.br"), ("senado", "telefone", "(61) 3303-5801"),
            ("senado", "site", "https://www25.senado.leg.br/web/senadores/senador/-/perfil/5801")}
        assert {c["source_key"] for c in r1["committees"]} == {"2001", "2002", "3001", "3002"}  # a 3999 (antiga) e a sem código ficaram de fora
        assert len(r1["speeches"]) == 2 + 1 + 2  # A: 2 (o sem hora é descartado), B: 1, C: 2 (o sem data é descartado)
        # encadeamento: o comando rodou derive.stats UMA vez, depois do run fechado e da carga gravada
        assert derives == [{"run_ja_fechado": "succeeded", "contatos_ja_gravados": len(c1), "discursos_ja_gravados": 5}]
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            stats = {r["slug"] for r in c.execute("select p.slug from person_period_stats s join people p on p.id = s.person_id where s.period = 'career'").fetchall()}
            cobertura = c.execute("select count(*) as n from data_coverage").fetchone()["n"]
        assert stats == {"fab-extras-dep-a", "fab-extras-dep-b", "fab-extras-sen-c"}  # efeito observável do derive: carreira de cada parlamentar
        assert cobertura == 27 * 5  # e a cobertura padrão das 27 UFs (5 datasets cada); nenhum município no banco

        # ---------------- contatos à mão, antes da rodada 2
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            src = {r["slug"]: r["id"] for r in c.execute("select slug, id from sources where slug in ('camara', 'senado', 'tse')").fetchall()}
            for pessoa, fonte, kind, valor in (
                ("fab-extras-dep-a", "camara", "email", "manual-i-camara@fab.example"),  # (i) camara, mandato que TERÁ contato na rodada 2
                ("fab-extras-dep-a", "tse", "site", "https://manual-ii-tse.fab.example"),  # (ii) outra fonte, no mesmo mandato
                ("fab-extras-dep-b", "camara", "site", "https://manual-iii-camara.fab.example"),  # (iii) camara, mandato que NÃO terá contato
                ("fab-extras-sen-c", "camara", "site", "https://manual-iv-camara-no-senador.fab.example"),  # (iv) fonte camara num mandato do Senado
                ("fab-extras-dep-a", "senado", "site", "https://manual-v-senado-no-deputado.fab.example"),  # (v) fonte senado num mandato da Câmara
            ):
                c.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, %s, %s, %s)", (mand[pessoa], kind, valor, src[fonte]))
        c_mao = _ex_contatos(iso)
        assert len(c_mao) == len(c1) + 5

        # ---------------- rodada 2: a entrada muda
        cod, urls2 = rodada(2, "r2")
        assert cod == 0
        r2 = estado_banco()
        runs2 = _r5_runs(iso, EX_DATASET)
        c2 = r2["mandate_contacts"]
        # DELETE de mandate_contacts (parlamento_extras.py:125): por mandato COM contato na entrada e por fonte camara OU senado (qualquer casa)
        a = vals(c2, "fab-extras-dep-a")
        assert ("camara", "email", "manual-i-camara@fab.example") not in a  # (i) APAGADO: fonte camara, mandato com contato novo
        assert ("tse", "site", "https://manual-ii-tse.fab.example") in a  # (ii) SOBREVIVE: outra fonte
        assert ("camara", "email", "dep.fab.a.novo@camara.leg.br") in a and ("camara", "email", "dep.fab.a@camara.leg.br") not in a  # o de rodada 1 também foi apagado
        assert a == {("camara", "email", "dep.fab.a.novo@camara.leg.br"), ("camara", "telefone", "(61) 3215-5101"), ("camara", "instagram", "https://www.instagram.com/fabA"),
                     ("tse", "site", "https://manual-ii-tse.fab.example")}
        assert ("senado", "site", "https://manual-v-senado-no-deputado.fab.example") not in a  # (v) APAGADO: o delete vale para camara E senado em qualquer mandato
        assert vals(c2, "fab-extras-dep-b") == {("camara", "email", "dep.fab.b@camara.leg.br"), ("camara", "site", "https://manual-iii-camara.fab.example")}  # (iii) SOBREVIVE (e o da rodada 1 também)
        assert vals(c2, "fab-extras-sen-c") == {("senado", "email", "sen.fab.c.novo@senado.leg.br"), ("senado", "telefone", "(61) 3303-5801")}  # (iv) APAGADO; o site da rodada 1 saiu
        # sem apagar por fora: comissões e discursos que sumiram da entrada continuam; o que mudou foi atualizado
        assert {c["source_key"] for c in r2["committees"]} == {"2001", "2002", "3001", "3002"}
        assert {c["name"] for c in r2["committees"] if c["source_key"] == "2001"} == {"Comissão de Constituição e Justiça (nome novo)"}  # name é atualizado
        assert {c["name"] for c in r2["committees"] if c["source_key"] == "3001"} == {"Comissão Fabricada de Ciência (nome novo)"}
        assert len(r2["speeches"]) == 5
        assert any(s["summary"] == "Pronunciamento: Sumário fabricado revisado" and s["url"].endswith("1-revisado") for s in r2["speeches"])
        assert any(s["summary"] and s["summary"].startswith("Breve Comunicação: Texto fabricado") for s in r2["speeches"])  # o discurso que saiu da entrada continua
        a_cc = [m for m in r2["committee_memberships"] if m["person_id"] == "fab-extras-dep-a" and m["committee_id"] == "2001"]
        assert [m["to_on"] for m in a_cc] == ["2025-12-31"]  # to_on é atualizado; role e from_on são a chave
        assert derives[1:] == [{"run_ja_fechado": "succeeded", "contatos_ja_gravados": len(c2), "discursos_ja_gravados": 5}]
        run2, stamp2 = _r5_ultimo(iso, "parlamento.extras")
        assert run2["id"] != run1["id"] and run2["status"] == "succeeded" and stamp2 == run2["id"]

        # ---------------- rodada 3: entrada idêntica à 2
        cod, urls3 = rodada(2, "r3")
        assert cod == 0
        r3 = estado_banco()
        runs3 = _r5_runs(iso, EX_DATASET)
        assert r3 == r2  # tabelas idênticas
        assert sorted(urls3) == sorted(urls2)  # lê tudo de novo (cache próprio): nenhuma URL fora das previstas
        run3, stamp3 = _r5_ultimo(iso, "parlamento.extras")
        assert run3["id"] not in (run1["id"], run2["id"]) and run3["status"] == "succeeded" and stamp3 == run3["id"]  # sem checksum: nunca skipped_unchanged
        assert [r["status"] for r in runs3["ingest_runs"]] == ["succeeded"] * 3
        assert len(derives) == 3 and derives[2] == derives[1]

        compara_com_retrato(
            "parlamento_extras",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (2 deputados, 1 senador; 3 rodadas; 5 contatos à mão antes da rodada 2); data do job fixada em 2026-11-15 e --year 2025; "
                         "run_id e horários ignorados; mandate_id, person_id, committee_id e body_id trocados por slug, source_key e kind",
                "urls_rodada_1": sorted(urls1),
                "urls_rodada_2": sorted(urls2),
                "urls_rodada_3": sorted(urls3),
                "derive_stats_encadeado": derives,
                "rodada_1_carga": {**r1, **runs1},
                "rodada_2_contatos_logo_apos_inserir_a_mao": c_mao,
                "rodada_2_entrada_mudou": {**r2, **runs2},
                "rodada_3_entrada_identica": {**r3, **runs3},
            },
        )
    finally:
        _ex_limpar(iso)

    assert _ex_conta(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_foto(iso) == antes_iso_foto
    with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
        assert c.execute("select count(*) as n from places where kind = 'municipio'").fetchone()["n"] == 0
        assert c.execute("select count(*) as n from people where slug like 'fab-%'").fetchone()["n"] == 0
    assert {t: conn.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in EX_CONTADAS} == antes_conn  # nada foi gravado em `admin_coleta`


# ---- ale.cobertura (só reescreve motivos em data_coverage; não usa rede, não abre run e não roda derive.stats)

ALE_FIXO = "2026-01-01"  # checked_on das linhas preparadas; o que a função reescreve passa a ter a data de execução
ALE_MUN = "9999990"  # ibge_code do município fabricado


def _ale_linhas() -> list[tuple[str, str, str, str, str | None]]:
    """(UF ou ibge_code do município, dataset, status, motivo, url de evidência). FABRICADO. O rótulo de cada ramo está no comentário."""
    from civico_etl.jobs.assembleias import _OLD_DEFAULTS as OLD, VERIFIED_UNREAD, not_read_reason

    rj = VERIFIED_UNREAD["RJ"]["presenca"]  # (status, motivo, url) conferido do RJ
    return [
        ("BA", "presenca", "carregando", OLD[0], None),  # texto-padrão antigo 1 -> reescrito para o motivo atual da UF
        ("BA", "votos", "carregando", OLD[1], None),  # texto-padrão antigo 2 -> reescrito
        ("BA", "propostas", "carregando", OLD[2], None),  # texto-padrão antigo 3 -> reescrito
        ("BA", "gastos_gabinete", "desconhecido", not_read_reason("BA"), None),  # já é o motivo atual: nada a fazer
        ("AM", "presenca", "carregando", "conferido à mão: a Assembleia do Amazonas publica só em PDF", "https://exemplo.fabricado/am"),  # motivo diferente: preservado
        ("AM", "votos", "desconhecido", rj[1], None),  # motivo de OUTRA UF conferida (RJ) numa UF sem conferência -> reescrito para o da UF
        ("AM", "propostas", "carregando", OLD[0], None),  # reescrito
        ("RJ", "presenca", "carregando", OLD[1], None),  # UF conferida sem leitor: vira o texto verificado (status e evidência também)
        ("RJ", "votos", "desconhecido", rj[1], rj[2]),  # já é o texto verificado: nada a fazer
        ("RJ", "propostas", "carregando", "texto conferido à mão do RJ", None),  # motivo diferente: preservado
        ("RJ", "gastos_gabinete", "carregando", OLD[0], None),  # UF conferida: vira so_portal com o motivo e a evidência verificados
        ("RJ", "salario_deputados_estaduais", "desconhecido", OLD[1], None),  # dataset fora da lista: intocado
        ("RS", "presenca", "carregando", not_read_reason("RS"), None),  # motivo atual da UF, mas há texto verificado diferente: vira o verificado
        ("SP", "presenca", "carregando", OLD[0], None),  # Assembleia com leitor (adapter ale_custom): intocada
        ("MG", "propostas", "carregando", OLD[2], None),  # idem
        ("DF", "presenca", "carregando", OLD[1], None),  # Câmara Legislativa do DF sem leitor: reescrito com o nome do DF
        ("PR", "presenca", "carregando", OLD[0], None),  # UF sem casa cadastrada em legislative_bodies: intocada (o join exclui)
        (ALE_MUN, "presenca", "desconhecido", OLD[1], None),  # município: intocado
    ]


def _ale_estado(url: str) -> dict:
    """data_coverage como retrato (place_id -> ibge_code); checked_on de hoje vira o rótulo `<hoje>`; mais id/updated_at para provar que nada foi regravado."""
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        c.execute("set timezone = 'UTC'")
        hoje = c.execute("select current_date as d").fetchone()["d"].isoformat()
    t = {"data_coverage": Tabela(ordem="dataset, (select p.ibge_code from places p where p.id = data_coverage.place_id)", fk={"place_id": ("places", "id", "ibge_code")})}
    linhas = retrato_tabelas(url, t)["data_coverage"]
    for r in linhas:
        if r["checked_on"] == hoje:
            r["checked_on"] = "<hoje>"
        else:
            assert r["checked_on"] == ALE_FIXO, r  # nenhuma outra data pode aparecer
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        marcas = {(r["place"], r["dataset"]): (str(r["id"]), r["updated_at"].isoformat()) for r in c.execute(
            "select p.ibge_code as place, d.dataset, d.id, d.updated_at from data_coverage d join places p on p.id = d.place_id").fetchall()}
    return {"linhas": linhas, "marcas": marcas}


def test_ale_cobertura(banco_isolado, conn, monkeypatch, tmp_path):
    """FABRICADO: caracteriza `ale.cobertura` (reescreve em data_coverage o motivo padrão das UFs ainda não lidas) sobre linhas de UF e de um
    município fabricado, criadas direto no banco isolado junto com as casas legislativas (assembleia, Câmara do DF e uma câmara municipal). Sem rede
    (qualquer chamada falha o teste), sem run em ingest_runs e sem derive.stats (a lista de UFs a carregar fica vazia). Duas rodadas com a mesma
    entrada: a 1ª reescreve 9 linhas; a 2ª não muda nada (nem o updated_at). Não cobre: ale.sp e ale.mg (adaptadores, outro caso)."""
    import civico_etl.jobs.derive_stats as ds

    iso = banco_isolado
    antes = _r5_contagens(conn)
    antes_iso = _r5_foto(iso)
    antes_iso_n = _r5_conta_url(iso)
    with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
        for t, onde in (("data_coverage", "true"), ("legislative_bodies", "kind in ('assembleia', 'camara_legislativa_df', 'camara_municipal')"), ("places", "kind = 'municipio'")):
            assert c.execute(f"select count(*) as n from {t} where {onde}").fetchone()["n"] == 0, f"banco isolado deveria partir sem linhas em {t}"

    chamadas: list[str] = []

    def respostas(req):
        chamadas.append(str(req.url))
        raise AssertionError(f"ale.cobertura não usa rede: {req.url}")

    derives: list[int] = []
    derive_real = ds.run_derive

    def derive_gravador(c):
        derives.append(1)
        return derive_real(c)

    monkeypatch.setattr(ds, "run_derive", derive_gravador)

    def rodada() -> int:
        return rodar_cli(["ale.cobertura"], url_banco=iso, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path)

    linhas = _ale_linhas()
    adapters = {"SP": "ale_custom", "MG": "ale_custom"}  # as demais Assembleias não têm leitor
    try:
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            c.execute(
                "insert into places (ibge_code, kind, name, slug, uf, parent_id) select %s, 'municipio', 'Município Fabricado', 'municipio-fabricado-ba', 'BA', id from places where ibge_code = '29'",
                (ALE_MUN,),
            )
            for uf in ("SP", "MG", "BA", "AM", "RJ", "RS"):
                c.execute(
                    "insert into legislative_bodies (kind, place_id, name, adapter) select 'assembleia', id, %s, %s from places where kind = 'uf' and uf = %s",
                    (f"Assembleia Fabricada {uf}", adapters.get(uf, "none"), uf),
                )
            c.execute("insert into legislative_bodies (kind, place_id, name, adapter) select 'camara_legislativa_df', id, 'Câmara Legislativa Fabricada', 'none' from places where kind = 'uf' and uf = 'DF'")
            c.execute("insert into legislative_bodies (kind, place_id, name, adapter) select 'camara_municipal', id, 'Câmara Municipal Fabricada', 'none' from places where ibge_code = %s", (ALE_MUN,))
            for chave, dataset, status, motivo, evidencia in linhas:
                c.execute(
                    """insert into data_coverage (place_id, dataset, status, reason, evidence_url, checked_on)
                       select id, %s, %s, %s, %s, %s from places where (kind = 'uf' and uf = %s) or ibge_code = %s""",
                    (dataset, status, motivo, evidencia, ALE_FIXO, chave, chave),
                )
        e0 = _ale_estado(iso)
        assert len(e0["linhas"]) == len(linhas) == 18

        assert rodada() == 0
        assert chamadas == [] and derives == []  # sem rede e sem derive.stats
        e1 = _ale_estado(iso)
        antes_por = {(r["place_id"], r["dataset"]): r for r in e0["linhas"]}
        depois_por = {(r["place_id"], r["dataset"]): r for r in e1["linhas"]}
        assert antes_por.keys() == depois_por.keys()
        alteradas = {k for k in antes_por if antes_por[k] != depois_por[k]}
        assert alteradas == {
            ("29", "presenca"), ("29", "votos"), ("29", "propostas"),  # BA: 3 textos-padrão antigos
            ("13", "votos"), ("13", "propostas"),  # AM: motivo de outra UF e texto antigo
            ("33", "presenca"), ("33", "gastos_gabinete"),  # RJ: viram o texto verificado
            ("43", "presenca"),  # RS: do motivo atual para o verificado
            ("53", "presenca"),  # DF: nome da Câmara Legislativa
        }
        intactas = set(antes_por) - alteradas
        assert {("29", "gastos_gabinete"), ("13", "presenca"), ("33", "votos"), ("33", "propostas"), ("33", "salario_deputados_estaduais"),
                ("35", "presenca"), ("31", "propostas"), ("41", "presenca"), (ALE_MUN, "presenca")} == intactas
        for k in intactas:  # linhas intocadas: nem campo nem id nem updated_at mudaram
            assert e1["marcas"][k] == e0["marcas"][k]
        for k in alteradas:  # mesmo registro (id igual), regravado hoje
            assert e1["marcas"][k][0] == e0["marcas"][k][0] and e1["marcas"][k][1] != e0["marcas"][k][1] and depois_por[k]["checked_on"] == "<hoje>"
        # pontos de atenção do real: o reescrito de BA/AM/DF só troca o motivo (status e evidência ficam); RJ e RS trocam status e evidência
        assert depois_por[("29", "presenca")]["status"] == "carregando" and depois_por[("29", "presenca")]["reason"] == "a Assembleia Legislativa da Bahia ainda não é lida pelo site"
        assert depois_por[("13", "votos")]["status"] == "desconhecido" and depois_por[("13", "votos")]["reason"] == "a Assembleia Legislativa do Amazonas ainda não é lida pelo site"
        assert depois_por[("53", "presenca")]["reason"] == "a Câmara Legislativa do Distrito Federal ainda não é lida pelo site"
        assert depois_por[("33", "gastos_gabinete")]["status"] == "so_portal" and depois_por[("33", "presenca")]["status"] == "desconhecido"
        assert depois_por[("43", "presenca")]["evidence_url"] == "https://ww4.al.rs.gov.br/"
        assert depois_por[("13", "presenca")]["reason"].startswith("conferido à mão") and depois_por[("33", "propostas")]["reason"] == "texto conferido à mão do RJ"

        assert rodada() == 0  # idempotente
        assert chamadas == [] and derives == []
        e2 = _ale_estado(iso)
        assert e2 == e1  # nem as linhas nem id/updated_at mudaram
        with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
            assert c.execute("select count(*) as n from ingest_runs where dataset like 'ale%'").fetchone()["n"] == 0  # nenhum run aberto

        compara_com_retrato(
            "ale_cobertura",
            {
                "_origem": MARCA,
                "_nota": "entrada FABRICADA (18 linhas de data_coverage em 7 UFs e 1 município fabricado; casas legislativas fabricadas); id, updated_at e horários ignorados; "
                         "place_id trocado pelo ibge_code; checked_on de hoje vira <hoje>",
                "antes": e0["linhas"],
                "rodada_1": e1["linhas"],
                "rodada_2_idempotente": e2["linhas"],
                "alteradas_na_rodada_1": sorted(f"{p}/{d}" for p, d in alteradas),
            },
        )
    finally:
        with psycopg.connect(iso, autocommit=True) as c:
            c.execute("delete from data_coverage")
            c.execute("delete from legislative_bodies where kind in ('assembleia', 'camara_legislativa_df', 'camara_municipal')")
            c.execute("delete from places where kind = 'municipio'")

    with psycopg.connect(iso, row_factory=dict_row, autocommit=True) as c:
        assert c.execute("select count(*) as n from places where kind = 'municipio'").fetchone()["n"] == 0
    assert _r5_foto(iso) == antes_iso  # banco isolado de volta ao estado inicial
    assert _r5_conta_url(iso) == antes_iso_n
    assert _r5_contagens(conn) == antes  # nada foi gravado em `admin_coleta`
