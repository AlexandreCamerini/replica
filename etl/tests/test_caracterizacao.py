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
