"""R-2: testes de caracterização de coletores, um caso por comando. Rodam o comando pela CLI sobre entrada FABRICADA, num banco
isolado (nunca o da suíte), e comparam as tabelas de destino com o retrato versionado em etl/tests/retratos/.

Coletor cuja entrada não dá para fabricar com fidelidade (zip do TSE lido por faixa) fica declarado "sem caracterização" e não é tocado por dentro.
"""

from __future__ import annotations

import hashlib
from datetime import date

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
