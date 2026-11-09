"""D291: o check de carimbo vencido olha a família do dataset (ano/mês tirado), não cada ano passado."""
from civico_etl.jobs.checks import CHECKS

NAME = "stamp vencido: Câmara/Senado há mais de 48 h, TSE há mais de 60 dias (carimbo mais novo de cada família de dataset)"


def _count(conn):
    return list(conn.execute(dict(CHECKS)[NAME]).fetchone().values())[0]


def test_ano_passado_nao_vence_familia_velha_vence(conn):
    with conn.transaction(force_rollback=True):
        conn.execute("update dataset_stamps set refreshed_at = now()")  # tudo em dia
        src = conn.execute("select id from sources where slug = 'camara'").fetchone()["id"]
        conn.execute(
            "insert into dataset_stamps (dataset, source_id, refreshed_at) values"
            " ('camara.testefam.2019', %(s)s, now() - interval '400 days'),"
            " ('camara.testefam.2026', %(s)s, now()),"
            " ('camara.testeagenda.20190101-20191231', %(s)s, now() - interval '400 days'),"
            " ('camara.noturna.testefam.2026', %(s)s, now() - interval '60 hours')",
            {"s": src},
        )
        # 2019 velho com 2026 em dia não vence; família só com período velho vence (1); noturna fica fora
        assert _count(conn) == 1
        conn.execute("insert into dataset_stamps (dataset, source_id, refreshed_at) values ('camara.testeagenda.20260101-20261231', %s, now())", (src,))
        assert _count(conn) == 0
        conn.execute("update dataset_stamps set refreshed_at = now() - interval '49 hours' where dataset = 'camara.testefam.2026'")
        assert _count(conn) == 1  # o mais novo da família passou de 48 h
