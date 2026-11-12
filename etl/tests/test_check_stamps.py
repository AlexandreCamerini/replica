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


# BUG-055: camara.equipe e parlamento.extras são semanais (schedule.TASKS, 7 * D). A régua de 48 h dava "vencido" do 3º ao
# 7º dia de toda semana. Agora a família vence na cadência da tarefa + folga; as diárias continuam em 48 h.
def _stamp(conn, src, dataset, age):
    conn.execute("delete from dataset_stamps where dataset = %s", (dataset,))
    conn.execute("insert into dataset_stamps (dataset, source_id, refreshed_at) values (%s, %s, now() - %s::interval)", (dataset, src, age))


def test_tarefa_semanal_vence_pela_cadencia_diaria_em_48h(conn):
    with conn.transaction(force_rollback=True):
        conn.execute("update dataset_stamps set refreshed_at = now()")  # tudo em dia
        src = conn.execute("select id from sources where slug = 'camara'").fetchone()["id"]
        _stamp(conn, src, "camara.equipe", "72 hours")
        _stamp(conn, src, "parlamento.extras", "6 days")
        assert _count(conn) == 0  # semanal com 3 e 6 dias: em dia
        _stamp(conn, src, "camara.equipe", "7 days 49 hours")
        assert _count(conn) == 1  # passou da cadência + folga
        _stamp(conn, src, "camara.equipe", "0 hours")
        _stamp(conn, src, "camara.despesas.2026", "49 hours")
        assert _count(conn) == 1  # diária: 48 h, como antes


def test_regua_vem_da_cadencia_da_tarefa():
    from civico_etl import schedule
    from civico_etl.jobs.checks import STAMP_DIARIO_H, STAMP_FOLGA_H, stamp_regua_h

    regua = stamp_regua_h()
    por_nome = {t.name: t for t in schedule.TASKS}
    assert regua["camara.equipe"] == por_nome["camara.equipe"].every_h + STAMP_FOLGA_H == 7 * 24 + 48
    assert regua["parlamento.extras"] == por_nome["parlamento.extras"].every_h + STAMP_FOLGA_H
    # nenhuma família diária ganha régua própria (votações, deputados, proposições, despesas, presença, Senado)
    for t in schedule.TASKS:
        if t.every_h <= STAMP_DIARIO_H and not callable(t.prefixes):
            assert not any(p in regua for p in t.prefixes), t.name
