"""FABRICADO. Parte B (B1): fila de pendências e critério 13 (a ordenação nunca usa atributo de pessoa ou partido).

Sem rede, sem skip. Tudo é fabricado no banco isolado, dentro de uma transação que reverte (o gatilho de `adm_decisoes` proíbe apagar decisão). Nada é gravado no
banco da suíte: o módulo compara as contagens de antes e depois.
"""

from __future__ import annotations

import inspect
import re
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row
from test_admin_propostas import AGORA, H, P, _contagens, decidir, iso, m  # noqa: F401  (fixtures iso e m)
from test_admin_vinculos import IBGE

from civico_etl.admin import pendencias as PEN
from civico_etl.admin import propostas as PR
from civico_etl.admin.saida import ErroAdmin

RC = {"vinculo_sapl": 0, "cobertura": 1, "contato_mandato": 2, "identidade": 3}  # a ordem do plano, escrita à mão (não importada)
RT = {"divergencia": 0, "mudanca": 1, "duplicata": 2, "confirmacao": 3}
D = [AGORA + timedelta(days=n) for n in (1, 3, 9)]
VAZIO = datetime.min.replace(tzinfo=timezone.utc)


@pytest.fixture(scope="module", autouse=True)
def suite_intacta():
    antes = _contagens(database_url())
    yield
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


def inserir(c, classe: str, chave: str, campo: str, tipo: str, vence, cob, *, status: str = "aberta", pid=None) -> str:
    pid = pid or str(uuid.uuid4())
    c.execute("insert into adm_pendencias (id, classe, registro_chave, campo, pergunta, tipo, status, vence_em, cobertura_recorte) values (%s, %s, %s, %s, 'pergunta?', %s, %s, %s, %s)",
              (pid, classe, chave, campo, tipo, status, vence, cob))
    return pid


def chave_falsa(classe: str, i: int) -> str:
    return {"vinculo_sapl": str(900000 + i), "cobertura": f"ZZ{i}:presenca"}.get(classe) or str(uuid.uuid4())


def fabricar(c) -> dict[str, dict]:
    """16 pendências abertas (4 classes x 4 tipos) com vencimento e cobertura variados, inclusive nulos e empates, e duas decididas (fora da fila)."""
    vences = [None, D[0], D[1], D[2]]
    cobs = [None, 0.1, 0.5, 0.9]
    meta: dict[str, dict] = {}
    i = 0
    for classe in ("identidade", "contato_mandato", "cobertura", "vinculo_sapl"):  # inserção fora de ordem de propósito
        for tipo in ("confirmacao", "duplicata", "mudanca", "divergencia"):
            vence, cob = vences[(i * 3) % 4], cobs[(i * 5 + 1) % 4]
            pid = inserir(c, classe, chave_falsa(classe, i), "status" if classe != "contato_mandato" else f"email:{i}@x", tipo, vence, cob)
            meta[pid] = {"classe": classe, "tipo": tipo, "vence": vence, "cob": cob}
            i += 1
    for k in range(3):  # empates totais: só o id desempata
        pid = inserir(c, "cobertura", f"ZZ{100 + k}:presenca", "reason", "mudanca", D[1], 0.5)
        meta[pid] = {"classe": "cobertura", "tipo": "mudanca", "vence": D[1], "cob": 0.5}
    inserir(c, "vinculo_sapl", "900500", "status", "divergencia", D[0], 0.0, status="decidida")
    inserir(c, "identidade", str(uuid.uuid4()), "status", "divergencia", None, None, status="decidida")
    return meta


def esperada(meta: dict[str, dict]) -> list[str]:
    def chave(pid: str):
        x = meta[pid]
        return (RC[x["classe"]], RT[x["tipo"]], x["vence"] is None, x["vence"] or VAZIO, x["cob"] is None, x["cob"] or 0.0, pid)

    return sorted(meta, key=chave)


# ------------------------------------------------------------------ critério 13: ordem


def test_criterio_13_ordem_exata_classe_tipo_vencimento_cobertura_id(iso):
    meta = fabricar(iso)
    itens = PEN.fila(iso)
    assert [i["id"] for i in itens] == esperada(meta)
    assert [i["posicao"] for i in itens] == list(range(1, len(meta) + 1)) and len(itens) == 19  # as duas decididas não entram
    classes = [i["classe"] for i in itens]
    assert classes == sorted(classes, key=RC.get) and classes[0] == "vinculo_sapl" and classes[-1] == "identidade"  # não é alfabética
    for classe in RC:
        tipos = [i["tipo"] for i in itens if i["classe"] == classe]
        assert tipos == sorted(tipos, key=RT.get)
    por_grupo: dict[tuple, list] = {}
    for i in itens:
        por_grupo.setdefault((i["classe"], i["tipo"]), []).append(i)
    assert all(len(g) == 1 for k, g in por_grupo.items() if k != ("cobertura", "mudanca")) and len(por_grupo[("cobertura", "mudanca")]) >= 4
    # filtro por classe e limite cortam DEPOIS da ordenação
    so_cob = PEN.fila(iso, classe="cobertura")
    assert [i["id"] for i in so_cob] == [p for p in esperada(meta) if meta[p]["classe"] == "cobertura"]
    assert [i["id"] for i in PEN.fila(iso, limite=5)] == esperada(meta)[:5]
    assert [i["id"] for i in PEN.fila(iso, classe="identidade", limite=2)] == [p for p in esperada(meta) if meta[p]["classe"] == "identidade"][:2]
    for kw in (dict(classe="pessoa"), dict(limite=0), dict(limite=-1), dict(limite="3")):
        with pytest.raises(ErroAdmin):
            PEN.fila(iso, **kw)


def test_ordem_com_vencimento_e_cobertura_nulos_vai_por_ultimo_em_cada_grupo(iso):
    a = inserir(iso, "contato_mandato", str(uuid.uuid4()), "email:a@x", "mudanca", None, None)
    b = inserir(iso, "contato_mandato", str(uuid.uuid4()), "email:b@x", "mudanca", None, 0.2)
    c = inserir(iso, "contato_mandato", str(uuid.uuid4()), "email:c@x", "mudanca", D[2], None)
    d = inserir(iso, "contato_mandato", str(uuid.uuid4()), "email:d@x", "mudanca", D[2], 0.8)
    e = inserir(iso, "contato_mandato", str(uuid.uuid4()), "email:e@x", "mudanca", D[0], 0.9)
    assert [i["id"] for i in PEN.fila(iso)] == [e, d, c, b, a]
    assert PEN.fila(iso)[-1]["desconhecidos"]["vence_em"] and PEN.fila(iso)[-1]["desconhecidos"]["cobertura_recorte"]  # o nulo diz o motivo


# ------------------------------------------------------------------ critério 13: prova estrutural


PROIBIDOS = ("people", "person", "parties", "party", "mandates", "votes", "name", "slug", "popular", "followers", "count(")
PERMITIDOS_NO_ORDER_BY = {"classe", "tipo", "vence_em", "cobertura_recorte", "id"}
SINTAXE = {"array_position", "array", "text", "asc", "nulls", "last"}


def test_criterio_13_sql_da_fila_nao_cita_pessoa_partido_mandato_voto_nem_popularidade():
    sql = PEN.SQL_FILA.lower()
    achados = [p for p in PROIBIDOS if p in sql]
    assert achados == [], f"SQL_FILA cita {achados}"
    assert re.findall(r"\bfrom\s+(\w+)", sql) == ["adm_pendencias"] and "join" not in sql and "select *" not in sql
    ordem = re.search(r"order by(.*?)\blimit\b", sql, re.S).group(1)
    sem_literais = re.sub(r"'[^']*'", "", ordem)
    ident = set(re.findall(r"[a-z_]+", sem_literais))
    assert ident - SINTAXE == PERMITIDOS_NO_ORDER_BY, ident
    assert re.findall(r"'([a-z_]+)'", ordem) == ["vinculo_sapl", "cobertura", "contato_mandato", "identidade", "divergencia", "mudanca", "duplicata", "confirmacao"]
    assert "vence_em asc nulls last" in ordem and "cobertura_recorte asc nulls last" in ordem
    # a ordenação não é refeita em Python depois do SQL
    for f in (PEN.fila, PEN._itens):
        src = inspect.getsource(f)
        assert "sorted(" not in src and ".sort(" not in src and ".reverse(" not in src, f.__name__
    assert "order by" not in inspect.getsource(PEN.fila).lower()
    # o único `order by` do enriquecimento ordena as PROPOSTAS dentro de uma pendência (por leitura), nunca a fila
    clausulas = re.findall(r"order by ([^\"]*)\"", inspect.getsource(PEN._itens).lower())
    assert clausulas == ["pr.lida_em nulls first, pr.criada_em, pr.id"]


# ------------------------------------------------------------------ critério 13: prova comportamental


def _pessoa_partido_mandato(c, m, i: int) -> dict:
    pessoa = c.execute("insert into people (slug, display_name, civil_name, gender, birth_date) values (%s, %s, %s, 'f', %s) returning id",
                       (f"zf-pessoa-{i}", f"Pessoa Fila {i}", f"Civil {i}", f"19{60 + i}-01-01")).fetchone()["id"]
    partido = c.execute("insert into parties (acronym, name, tse_number, valid_from, spectrum, spectrum_order) values (%s, %s, %s, '2000-01-01', 'centro', %s) returning id",
                        (f"ZF{i}", f"Partido Fila {i}", 10 + i, i)).fetchone()["id"]
    off = c.execute("select id from offices where slug = 'vereador'").fetchone()["id"]
    man = c.execute(
        "insert into mandates (person_id, office_id, place_id, body_id, party_id, role, status, started_on, ends_on, status_source) values (%s, %s, %s, %s, %s, 'titular', 'em_exercicio', "
        "'2025-01-01', '2028-12-31', 'teste') returning id", (pessoa, off, m["muni"], m["b_cam"], partido)).fetchone()["id"]
    return {"pessoa": pessoa, "partido": partido, "man": str(man)}


def test_criterio_13_atributos_de_pessoa_e_partido_e_a_troca_de_quem_esta_ligado_a_que_nao_mudam_a_ordem(iso, m):
    pp = [_pessoa_partido_mandato(iso, m, i) for i in (1, 2, 3)]
    camara = iso.execute("select id from sources where slug = 'camara'").fetchone()["id"]
    filas = [str(iso.execute("insert into identity_match_queue (source_id, external_id, raw, candidate_person_id, confidence, status) values (%s, %s, '{}'::jsonb, %s, %s, 'pendente') returning id",
                             (camara, f"EXT-FILA-{i}", pp[i]["pessoa"], 0.9 - 0.4 * i)).fetchone()["id"]) for i in (0, 1)]
    iso.execute("insert into person_external_ids (person_id, source_id, external_id, match_method, match_confidence) values (%s, %s, 'XID-1', 'exact_id', 0.95)", (pp[0]["pessoa"], camara))
    # classe, tipo, vence, cobertura: as quatro posições dependem só disso
    ids = [
        inserir(iso, "contato_mandato", pp[0]["man"], "email:a@x", "mudanca", D[2], 0.5),
        inserir(iso, "contato_mandato", pp[1]["man"], "email:b@x", "divergencia", D[1], None),
        inserir(iso, "contato_mandato", pp[2]["man"], "email:c@x", "confirmacao", None, 0.2),
        inserir(iso, "identidade", filas[0], "status", "mudanca", D[0], 0.9),
        inserir(iso, "identidade", filas[1], "nota", "mudanca", D[0], 0.1),
    ]

    def estado():
        return [(i["id"], i["classe"], i["tipo"], i["vence_em"], i["cobertura_recorte"]) for i in PEN.fila(iso)]

    antes = estado()
    assert [x[0] for x in antes] == [ids[1], ids[0], ids[2], ids[4], ids[3]]  # contato: divergencia, mudanca, confirmacao; identidade: cobertura 0.1 antes de 0.9
    rotulos_antes = {i["id"]: i["rotulo"] for i in PEN.fila(iso)}

    # 1) mudam os atributos: nome, slug, partido (sigla, nome, número, ordem no hemiciclo) e toda coluna numérica ou de data de people, parties, mandates e da fila de identidade
    #    (people e mandates não têm coluna numérica; as numéricas estão em parties, identity_match_queue e person_external_ids)
    for i, x in enumerate(pp):
        iso.execute("update people set display_name = %s, slug = %s, civil_name = 'Outro', gender = 'm', birth_date = '1950-05-05', education = 'doutorado' where id = %s",
                    (f"ZZ Nome Trocado {9 - i}", f"zf-trocado-{9 - i}", x["pessoa"]))
        iso.execute("update parties set acronym = %s, name = %s, tse_number = %s, spectrum = 'direita', spectrum_order = %s, president_name = 'Fulano' where id = %s",
                    (f"ZX{9 - i}", f"Partido Trocado {9 - i}", 90 - i, 50 - i, x["partido"]))
        iso.execute("update mandates set started_on = '2021-02-02', ends_on = '2030-01-01', status = 'licenciado', role = 'suplente_em_exercicio' where id = %s", (x["man"],))
    iso.execute("update identity_match_queue set confidence = 1 - confidence, status = 'aceito' where id = any(%s::uuid[])", (filas,))
    iso.execute("update person_external_ids set match_confidence = 0.01")
    assert estado() == antes
    assert [i["id"] for i in PEN.fila(iso)] == [x[0] for x in antes]

    # 2) troca quem está ligado a que (rodízio dos mandatos e troca dos itens da fila), com classe, tipo, vencimento e cobertura de cada pendência intactos
    iso.execute("update adm_pendencias set registro_chave = %s where id = %s", (pp[1]["man"], ids[0]))
    iso.execute("update adm_pendencias set registro_chave = %s where id = %s", (pp[2]["man"], ids[1]))
    iso.execute("update adm_pendencias set registro_chave = %s where id = %s", (pp[0]["man"], ids[2]))
    iso.execute("update adm_pendencias set registro_chave = %s where id = %s", (filas[1], ids[3]))
    iso.execute("update adm_pendencias set registro_chave = %s where id = %s", (filas[0], ids[4]))
    depois = estado()
    assert depois == antes
    assert {i["id"]: i["rotulo"] for i in PEN.fila(iso)} != rotulos_antes  # os rótulos (e as ligações) mudaram; a ordem não
    assert [(x[1], x[2], x[3], x[4]) for x in depois] == [(x[1], x[2], x[3], x[4]) for x in antes]


def test_criterio_13_o_plano_de_execucao_nao_toca_tabela_de_pessoa_partido_ou_mandato(iso):
    for params in ({"classe": None, "limite": None}, {"classe": "identidade", "limite": 10}):
        plano = "\n".join(r["QUERY PLAN"] for r in iso.execute("explain " + PEN.SQL_FILA, params).fetchall()).lower()
        assert "adm_pendencias" in plano
        for proibido in ("people", "parties", "mandates", "person", "party", "votes"):
            assert proibido not in plano, plano
    plano_sem_seq = ""
    iso.execute("set local enable_seqscan = off")
    plano_sem_seq = "\n".join(r["QUERY PLAN"] for r in iso.execute("explain " + PEN.SQL_FILA, {"classe": None, "limite": None}).fetchall()).lower()
    assert "adm_pendencias" in plano_sem_seq and "people" not in plano_sem_seq


# ------------------------------------------------------------------ conteúdo dos itens e do detalhe


def test_item_da_fila_traz_rotulo_territorio_vigente_de_agora_e_as_propostas_com_evidencia(iso, m):
    r = PR.registrar(iso, P(m, bloco=None, fonte_slug="sapl", fonte_declarada_em=AGORA - timedelta(days=5), trecho="$.status"), agora=AGORA)
    cont = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="novo:email", valor_candidato="n@cidade-teste.example", bloco="<li id=v1>",
                               url="https://c.example/v", conteudo_sha256=H("c")), agora=AGORA)
    ident = PR.registrar(iso, P(m, classe="identidade", registro_chave=str(m["q"]), campo="status", valor_candidato="aceito", url="https://i.example/x", conteudo_sha256=H("i")), agora=AGORA)
    itens = {i["id"]: i for i in PEN.fila(iso)}
    assert list(itens) == [r.pendencia_id, cont.pendencia_id, ident.pendencia_id]  # vinculo_sapl, contato_mandato, identidade
    a = itens[r.pendencia_id]
    assert a["rotulo"].startswith("Câmara Municipal de Cidade Teste") and a["territorio"] == {"ibge_code": IBGE, "nivel": "municipio"} and a["valor_vigente"] == "ok"
    assert a["pergunta"].endswith("?") and a["reaberta"] is False and a["motivo_reabertura"] is None and a["vence_em"] == AGORA + timedelta(days=7)
    pr = a["propostas"][0]
    assert (pr["valor_candidato"], pr["url"], pr["trecho"], pr["conteudo_sha256"], pr["fonte_slug"], pr["fonte_declarada_em"]) == ("fora_do_ar", "https://a.example/api/", "$.status", H("a1"), "sapl", AGORA - timedelta(days=5))
    assert pr["lida_em"] == AGORA - timedelta(days=1) and pr["bloco"] is None and pr["rodada_id"] is None and pr["alcance"] == "registro"
    assert itens[cont.pendencia_id]["propostas"][0]["bloco"] == "<li id=v1>" and itens[cont.pendencia_id]["valor_vigente"] is None
    i = itens[ident.pendencia_id]
    assert i["territorio"] is None and "território" in i["desconhecidos"]["territorio"] and i["valor_vigente"] == "pendente" and i["vence_em"] is None
    assert "Pessoa Teste" not in str(itens)  # nenhum nome de pessoa nos itens
    iso.execute("update sapl_houses set status = 'sem_api' where id = %s", (m["h_cam"],))
    assert PEN.fila(iso, classe="vinculo_sapl")[0]["valor_vigente"] == "sem_api"  # o vigente é lido AGORA, não o da proposta


def test_detalhe_traz_decisoes_so_leitura_e_historico_em_ordem_de_leitura(iso, m):
    # leitura antiga da mesma URL que confirma o vigente (sem pendência, portanto fora da pendência) e leitura nova que difere
    PR.registrar(iso, P(m, valor_candidato="ok", conteudo_sha256=H("v1"), lida_em=AGORA - timedelta(days=3)), agora=AGORA)
    r = PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("v2"), lida_em=AGORA - timedelta(days=1)), agora=AGORA)
    d = PEN.detalhe(iso, r.pendencia_id)
    assert d["status"] == "aberta" and d["decisoes"] == [] and len(d["propostas"]) == 1 and "posicao" not in d
    assert [h["valor_candidato"] for h in d["historico"]] == ["ok", "fora_do_ar"] and [h["ligada_a_esta_pendencia"] for h in d["historico"]] == [False, True]
    decidir(iso, r.pendencia_id)
    d = PEN.detalhe(iso, r.pendencia_id)
    assert d["status"] == "decidida" and [(x["acao"], x["decidido_por_tipo"], x["justificativa"], x["aplicada"]) for x in d["decisoes"]] == [("aprovar", "pessoa", "conferi na página", False)]
    assert iso.execute("select count(*) as n from adm_decisoes").fetchone()["n"] == 1  # a leitura não grava
    assert PEN.fila(iso) == []  # decidida sai da fila
    for ruim in ("xyz", str(uuid.uuid4())):
        with pytest.raises(ErroAdmin):
            PEN.detalhe(iso, ruim)
    texto = PEN.texto_detalhe(d)
    assert "propostas ligadas" in texto and "aprovar" in texto and PEN.texto_fila([]) == "nenhuma pendência aberta"
