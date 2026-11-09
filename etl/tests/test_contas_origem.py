"""catálogo D11: receitas de campanha por tipo de fonte. Combinações origem × fonte tiradas de receitas_candidatos_2022_AC.csv (TSE, 08/11/2026)."""

from __future__ import annotations

import io
import zipfile

import pytest

from civico_etl.jobs.tse_votos_contas import ORIGINS, aggregate_finance, bucket_receita, donor_of
from civico_etl.remotezip import pick_members

REC_COLS = ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA", "DS_FONTE_RECEITA", "NR_CPF_CNPJ_DOADOR", "NM_DOADOR", "NM_DOADOR_RFB", "SG_PARTIDO_DOADOR"]
DES_COLS = ["SQ_PRESTADOR_CONTAS", "VR_PAGTO_DESPESA", "DS_ORIGEM_DESPESA"]


def _csv(cols, rows_):
    lines = [";".join(f'"{c}"' for c in cols)] + [";".join(f'"{v}"' for v in r) for r in rows_]
    return ("\n".join(lines) + "\n").encode("latin-1")


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as w:
        for n, d in files.items():
            w.writestr(n, d)
    buf.seek(0)
    return zipfile.ZipFile(buf)


@pytest.mark.parametrize("origem,fonte,esperado", [
    ("Recursos de pessoas físicas", "OUTROS RECURSOS", "pessoa_fisica"),
    ("Recursos de partido político", "FUNDO ESPECIAL", "fefc"),
    ("Recursos de partido político", "FUNDO PARTIDARIO", "fundo_partidario"),
    ("Recursos de partido político", "OUTROS RECURSOS", "partido"),
    ("Recursos de outros candidatos", "FUNDO ESPECIAL", "fefc"),  # fundo público repassado por candidato continua sendo do fundo
    ("Recursos de outros candidatos", "OUTROS RECURSOS", "outros"),
    ("Recursos próprios", "OUTROS RECURSOS", "recursos_proprios"),
    ("Recursos de Financiamento Coletivo", "OUTROS RECURSOS", "financiamento_coletivo"),
    ("Rendimentos de aplicações financeiras", "FUNDO ESPECIAL", "fefc"),
    ("Recursos de origens não identificadas", "OUTROS RECURSOS", "outros"),
    ("#NULO", "#NULO", "outros"),
    ("Fundo Especial de Financiamento de Campanha", "", "fefc"),  # layout de 2018/2020: o fundo vem na própria origem
    ("Fundo Partidário", "", "fundo_partidario"),
    ("Doações pela Internet", "", "outros"),
    (None, None, "outros"),
    ("Origem que o TSE inventar amanhã", "FONTE NOVA", "outros"),
])
def test_bucket(origem, fonte, esperado):
    assert bucket_receita(origem, fonte) == esperado and esperado in ORIGINS


def test_doador_so_partido_ou_pj():
    assert donor_of("Recursos de partido político", "Direção Nacional", "44.551.496/0001-67", "UNIAO BRASIL", "UNIÃO") == ("partido", "UNIÃO · Direção Nacional", "44551496000167")
    assert donor_of("Recursos de partido político", "Diretório Estadual", "") == ("partido", "Diretório Estadual", None)
    assert donor_of("Recursos de origens não identificadas", "EMPRESA SA", "12345678000190", "EMPRESA SOCIEDADE ANONIMA") == ("pessoa_juridica", "EMPRESA SOCIEDADE ANONIMA", "12345678000190")
    # pessoa física: nunca, nem com nome e CPF preenchidos, nem com CNPJ de MEI na origem de pessoa física
    assert donor_of("Recursos de pessoas físicas", "JOSE DA SILVA", "123.456.789-00") is None
    assert donor_of("Recursos de pessoas físicas", "JOSE MEI", "12345678000190") is None
    assert donor_of("Recursos de outros candidatos", "MARIA CANDIDATA", "12345678901") is None
    assert donor_of("Recursos próprios", "O PRÓPRIO", "12345678000190") is None
    assert donor_of("Recursos de pessoas físicas", "", "") is None


def _zip_contas(rec_rows):
    p = "receitas_candidatos_2022"
    d = "despesas_pagas_candidatos_2022"
    return _zip({f"{p}_AC.csv": _csv(REC_COLS, rec_rows), f"{d}_AC.csv": _csv(DES_COLS, [["P1", "10,00", "Passagem"]])})


def test_soma_das_origens_e_o_total_e_pessoa_fisica_nao_vaza():
    pf_nome, pf_cpf = "JOSE DA SILVA SAURO", "123.456.789-00"
    rows = [
        ["S1", "P1", "100,10", "Recursos de pessoas físicas", "OUTROS RECURSOS", pf_cpf, pf_nome, "JOSE DA SILVA SAURO RFB", ""],
        ["S1", "P1", "200,00", "Recursos de partido político", "FUNDO ESPECIAL", "12.345.678/0001-90", "Direção Nacional", "PARTIDO X", "PX"],
        ["S1", "P1", "50,05", "Recursos de partido político", "FUNDO PARTIDARIO", "12.345.678/0001-90", "Direção Nacional", "PARTIDO X", "PX"],
        ["S1", "P1", "30,00", "Recursos de partido político", "OUTROS RECURSOS", "98.765.432/0001-10", "Direção Estadual", "PARTIDO X", "PX"],
        ["S1", "P1", "5,00", "Recursos próprios", "OUTROS RECURSOS", "111.222.333-44", "O CANDIDATO MESMO", "", ""],
        ["S1", "P1", "7,00", "Recursos de Financiamento Coletivo", "OUTROS RECURSOS", "555.666.777-88", "FULANO COLETIVO", "", ""],
        ["S1", "P1", "1,00", "Rendimentos de aplicações financeiras", "OUTROS RECURSOS", "", "", "", ""],
        ["S1", "P1", "0,01", "#NULO", "#NULO", "", "", "", ""],
        ["S2", "P3", "1,00", "Recursos de partido político", "OUTROS RECURSOS", "12.345.678/0001-90", "DIREÇÃO NACIONAL", "PARTIDO X", "PX"],
        ["S2", "P3", "2,00", "Recursos de partido político", "OUTROS RECURSOS", "12.345.678/0001-90", "Direção Nacional", "PARTIDO X", "PX"],
        ["S2", "P2", "40,00", "Recursos de pessoas físicas", "OUTROS RECURSOS", "999.888.777-66", "OUTRA PESSOA FISICA", "", ""],
        ["S9", "P9", "999,00", "Recursos de pessoas físicas", "OUTROS RECURSOS", "000.000.000-00", "FORA DO RECORTE", "", ""],  # candidatura fora de `want`
    ]
    z = _zip_contas(rows)
    fa = aggregate_finance(z, pick_members(z, "receitas_candidatos_2022"), pick_members(z, "despesas_pagas_candidatos_2022"), {"S1", "S2"})
    for sq in ("S1", "S2"):
        assert sum(v for (q, _), v in fa.by_origin.items() if q == sq) == fa.raised[sq]  # aceite catálogo D11: soma das origens = total arrecadado
    assert fa.raised["S1"] == 39316 and fa.by_origin[("S1", "fefc")] == 20000 and fa.by_origin[("S1", "fundo_partidario")] == 5005
    assert fa.by_origin[("S1", "pessoa_fisica")] == 10010 and fa.by_origin[("S1", "partido")] == 3000
    assert fa.by_origin[("S1", "outros")] == 101 and fa.origin_lines[("S1", "pessoa_fisica")] == 1
    # doadores nomeados: só partidos. Nenhum nome ou CPF de pessoa física em lugar nenhum do resultado
    assert {(k[2], fa.donor_label[k]) for k in fa.donors if k[0] == "S1"} == {("partido", "PX · Direção Nacional"), ("partido", "PX · Direção Estadual")}
    two = [(k, v) for k, v in fa.donors.items() if k[0] == "S2"]
    assert len(two) == 1 and two[0][1] == 300  # caixa diferente do mesmo órgão soma numa linha só (sem perder centavo no upsert)
    blob = repr(dict(fa.donors)) + repr(dict(fa.by_origin)) + repr(dict(fa.by_cat)) + repr(dict(fa.origin_lines))
    for secreto in ("JOSE DA SILVA", "SAURO", "123.456.789", "OUTRA PESSOA", "999.888", "O CANDIDATO", "FULANO COLETIVO", "FORA DO RECORTE", "111.222", "555.666"):
        assert secreto not in blob


def test_layout_antigo_sem_coluna_de_fonte_nao_quebra():
    cols = ["SQ_CANDIDATO", "SQ_PRESTADOR_CONTAS", "VR_RECEITA", "DS_ORIGEM_RECEITA"]  # fixture do BUG-019: sem fonte, doc, nome
    z = _zip({"receitas_candidatos_2022_AC.csv": _csv(cols, [["S1", "P1", "10,00", "Recursos de partido político"]]),
              "despesas_pagas_candidatos_2022_AC.csv": _csv(DES_COLS, [["P1", "1,00", "x"]])})
    fa = aggregate_finance(z, pick_members(z, "receitas_candidatos_2022"), pick_members(z, "despesas_pagas_candidatos_2022"), {"S1"})
    assert fa.by_origin[("S1", "partido")] == 1000 and not fa.donors


def test_check_soma_das_origens_no_banco(conn):
    from civico_etl.jobs.checks import CHECKS

    q = dict(CHECKS)["contas de campanha: soma das origens diferente do total arrecadado"]
    assert list(conn.execute(q).fetchone().values())[0] == 0
    with conn.transaction(force_rollback=True):
        c = conn.execute("select id from candidacies where raised_cents is not null limit 1").fetchone()
        if not c:
            pytest.skip("sem candidatura com receita no banco")
        conn.execute("insert into campaign_finance_by_origin (candidacy_id, origin, amount_cents, lines, source_key) values (%s, 'outros', 1, 1, 'teste:origem:1')", (c["id"],))
        # 1 centavo só não fecha com o total (a menos que o total seja 1): a invariante acusa
        n = list(conn.execute(q).fetchone().values())[0]
        assert n == (0 if conn.execute("select raised_cents from candidacies where id = %s", (c["id"],)).fetchone()["raised_cents"] == 1 else 1)


# ---- S4: CNPJ de campanha de candidato não é pessoa jurídica; doador agregado por documento ----

def test_cnpj_de_campanha_de_candidato_nao_vira_doador_nomeado():
    assert donor_of("Recursos de origens não identificadas", "ELEICAO 2022 FULANO DE TAL DEPUTADO", "12345678000190", "") is None
    assert donor_of("Recursos de origens não identificadas", "X", "12345678000190", "Eleição 2020 BELTRANO PREFEITO") is None
    assert donor_of("Recursos de origens não identificadas", "ELEIÇÃO 2018 CICLANO", "12345678000190") is None
    # empresa com nome parecido, mas fora do padrão "ELEICAO AAAA": continua pessoa jurídica
    assert donor_of("Recursos de origens não identificadas", "ELEICOES EVENTOS LTDA", "12345678000190") == ("pessoa_juridica", "ELEICOES EVENTOS LTDA", "12345678000190")


def test_origem_agrega_doador_por_cnpj_e_nao_perde_o_valor_do_candidato(conn):
    import types
    from civico_etl.jobs.tse_votos_contas import FinanceAgg, _origin_entries

    with conn.transaction(force_rollback=True):
        c = conn.execute("select c.id, c.tse_sequencial, e.year from candidacies c join elections e on e.id = c.election_id where c.tse_sequencial is not null limit 1").fetchone()
        if not c:
            pytest.skip("sem candidatura no banco")
        sq, year = c["tse_sequencial"], c["year"]
        if conn.execute("select 1 from campaign_finance_by_origin where source_key like %s limit 1", (f"tse:{year}:%",)).fetchone():
            pytest.skip("ano já tem origens gravadas no banco local")
        fa = FinanceAgg()
        fa.raised[sq] = 1000
        fa.by_origin[(sq, "outros")] = 1000
        fa.origin_lines[(sq, "outros")] = 3
        # mesmo CNPJ, razões sociais diferentes (RFB x doador): uma linha só, rótulo da maior parcela
        for nome, v in (("EMPRESA SOCIEDADE ANONIMA", 600), ("EMPRESA SA", 300)):
            k = (sq, "outros", "pessoa_juridica", nome.lower(), "12345678000190")
            fa.donors[k] += v
            fa.donor_label[k] = nome
        # CNPJ de campanha: donor_of devolve None, então nada entra em fa.donors; o valor segue na origem (100 dos 1000)
        r = types.SimpleNamespace(notes=[])
        _origin_entries(conn, year, fa, r)
        d = conn.execute("select donor_name, donor_doc, amount_cents from campaign_finance_donors where candidacy_id = %s and source_key like %s", (c["id"], f"tse:{year}:{sq}:%")).fetchall()
        assert len(d) == 1 and d[0]["amount_cents"] == 900 and d[0]["donor_name"] == "EMPRESA SOCIEDADE ANONIMA" and d[0]["donor_doc"] == "12345678000190"
        o = conn.execute("select amount_cents from campaign_finance_by_origin where candidacy_id = %s and origin = 'outros'", (c["id"],)).fetchall()
        assert [x["amount_cents"] for x in o] == [1000]
