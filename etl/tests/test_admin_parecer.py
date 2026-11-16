"""FABRICADO. Parte B (B4): parecer de IA em modo ENSAIO e o critério de segurança 22 ("pedido de parecer com as duas chaves desligadas não altera nenhuma tabela de domínio").

Sem rede, sem skip. Nenhum teste faz chamada a modelo: o cliente é falso e `anthropic.Anthropic` é trocado por uma função que falha se alguém o instanciar (o módulo confere, ao fim de
cada teste, que isso não aconteceu); `socket.socket.connect` também falha. Quase tudo roda no banco isolado numa transação que reverte; o que passa pela CLI real (que abre a própria
conexão e comita) grava com commit e é desfeito em `finally` (`session_replication_role = replica`, a técnica de test_admin_migracao.py). Nada é gravado no banco da suíte.
"""

from __future__ import annotations

import json
import socket
from types import SimpleNamespace

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row
from test_admin_propostas import AGORA, H, P, iso, m  # noqa: F401  (fixtures iso e m)
from test_admin_vinculos import IBGE, desfazer, mundo

from civico_etl import cli
from civico_etl.admin import cli as admin_cli
from civico_etl.admin import parecer as PA
from civico_etl.admin import pendencias as pen
from civico_etl.admin import propostas as PR
from civico_etl.admin.saida import ErroAdmin
from civico_etl.util import sha256_text

SUITE = ("adm_pareceres", "adm_pedidos", "adm_decisoes", "adm_overrides", "adm_pendencias", "adm_rodadas", "pipeline_switches", "sapl_houses", "data_coverage", "mandate_contacts",
         "identity_match_queue", "people", "corrections")
CHAVE_BANCO = "admin_coleta_agentes"
VAR = "ADMIN_COLETA_AGENTES"
# o parecer só escreve em `adm_pareceres`; toda outra tabela de `public` tem de ficar idêntica, `adm_pedidos` inclusive (`gerar` nunca a toca: o pedido, quando existe, é criado antes do retrato)
ESCRITAS_DO_PARECER = ("adm_pareceres",)


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


def compactar_decisoes(url: str) -> None:
    """Os testes deste módulo gravam e revertem muitas linhas de `adm_decisoes`; as linhas mortas deixam o banco isolado (da sessão inteira) com a ordem física (`ctid`) diferente da de inserção,
    e `test_admin_decisoes.py::test_aplicar_pendentes_aplica_em_ordem_de_criacao...` ordena por `ctid`. Compacta a tabela (vazia) ao fim do módulo para não passar esse ruído adiante."""
    with psycopg.connect(url, autocommit=True) as c:
        c.execute("vacuum full adm_decisoes")


@pytest.fixture(scope="module", autouse=True)
def suite_intacta(banco_isolado):
    antes = _contagens(database_url())
    yield
    compactar_decisoes(banco_isolado)
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


@pytest.fixture(autouse=True)
def sem_rede(monkeypatch):
    """Nenhuma chamada real: `anthropic.Anthropic` e `socket.socket.connect` falham se tocados. A variável da chave da API e as duas chaves começam ausentes."""
    import anthropic

    tentativas: list[str] = []

    def proibido(*a, **k):
        tentativas.append("anthropic.Anthropic")
        raise AssertionError("anthropic.Anthropic foi instanciado em teste")

    def sem_socket(self, *a, **k):
        tentativas.append("socket.connect")
        raise AssertionError("conexão de rede em teste")

    monkeypatch.setattr(anthropic, "Anthropic", proibido)
    monkeypatch.setattr(socket.socket, "connect", sem_socket)
    for v in (VAR, PA.VARIAVEL_CHAVE_API, "VERIFICACAO_AGENTICA"):
        monkeypatch.delenv(v, raising=False)
    yield tentativas
    assert tentativas == [], f"tentativa de rede em teste: {tentativas}"


# ------------------------------------------------------------------ apoio


def n(c, tabela: str, onde: str = "true", *p) -> int:
    return c.execute(f"select count(*) as n from {tabela} where {onde}", p or None).fetchone()["n"]  # noqa: S608


def retrato(c, excluir: tuple[str, ...] = ESCRITAS_DO_PARECER) -> dict[str, tuple[int, str]]:
    """TODAS as tabelas do schema `public` menos `excluir`: (contagem, hash de todas as linhas ordenadas)."""
    tabelas = [r["tablename"] for r in c.execute("select tablename from pg_tables where schemaname = 'public' order by 1").fetchall()]
    out = {}
    for t in tabelas:
        if t in excluir:
            continue
        r = c.execute(f"select count(*) as n, md5(coalesce(string_agg(x::text, '' order by x::text), '')) as h from public.\"{t}\" x").fetchone()  # noqa: S608 (nomes de pg_tables)
        out[t] = (r["n"], r["h"])
    return out


def tabelas_do_retrato(c, excluir: tuple[str, ...] = ESCRITAS_DO_PARECER) -> tuple[list[str], list[str]]:
    todas = [r["tablename"] for r in c.execute("select tablename from pg_tables where schemaname = 'public' order by 1").fetchall()]
    return [t for t in todas if t not in excluir], [t for t in todas if t in excluir]


def quatro(c, mm: dict, rod: str | None = None) -> dict[str, str]:
    """Uma pendência aberta de cada uma das quatro classes (as propostas levam `rodada_id` quando `rod` é dado)."""
    kw = {"rodada_id": rod} if rod else {}
    reg = lambda p: PR.registrar(c, p, agora=AGORA).pendencia_id  # noqa: E731
    return {
        "vinculo_sapl": reg(P(mm, valor_candidato="fora_do_ar", conteudo_sha256=H("pa"), **kw)),
        "cobertura": reg(P(mm, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="status", valor_candidato="so_portal", conteudo_sha256=H("pb"), url="https://cob.example/x", **kw)),
        "contato_mandato": reg(P(mm, classe="contato_mandato", registro_chave=str(mm["man"]), campo="email:vereador@cidade-teste.example", valor_candidato="outro@cidade-teste.example",
                                 bloco="<li id=v1>", conteudo_sha256=H("pc"), url="https://c.example/v1", **kw)),
        "identidade": reg(P(mm, classe="identidade", registro_chave=str(mm["q"]), campo="status", valor_candidato="rejeitado", conteudo_sha256=H("pd"), url="https://i.example/x", **kw)),
    }


def rodada(c) -> str:
    return str(c.execute("insert into adm_rodadas (coletor, modo, status) values ('sapl.assembleias', 'recoletar', 'concluida') returning id").fetchone()["id"])


def liga_chaves(c, monkeypatch, *, variavel: bool, linha: bool) -> None:
    if variavel:
        monkeypatch.setenv(VAR, "on")
    else:
        monkeypatch.delenv(VAR, raising=False)
    if linha:
        c.execute("insert into pipeline_switches (name, value, note) values (%s, 'on', 'teste B4') on conflict (name) do update set value = 'on'", (CHAVE_BANCO,))
    else:
        c.execute("delete from pipeline_switches where name = %s", (CHAVE_BANCO,))


class Falso:
    """Cliente falso da API de mensagens: devolve o `texto` dado e guarda as chamadas. Nunca toca a rede."""

    def __init__(self, texto: str | None = None, *, stop: str = "end_turn", erro: Exception | None = None):
        self.texto, self.stop, self.erro, self.chamadas = texto, stop, erro, []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.chamadas.append(kw)
        if self.erro:
            raise self.erro
        return SimpleNamespace(stop_reason=self.stop, content=[SimpleNamespace(type="text", text=self.texto)])


def resposta(campo: str, **item) -> str:
    base = {"campo": campo, "proposta": None, "trecho": None, "url": None, "falta_confirmar": None}
    return json.dumps({"campos": [{**base, **item}]})


# ------------------------------------------------------------------ 8 e 9. critério 22: o retrato completo


def test_o_retrato_cobre_todas_as_tabelas_de_public_menos_as_que_o_parecer_escreve(iso):
    comparadas, excluidas = tabelas_do_retrato(iso)
    print("COMPARADAS:", ", ".join(comparadas), "| EXCLUÍDAS:", ", ".join(excluidas))
    assert excluidas == ["adm_pareceres"] and "adm_pedidos" in comparadas and len(comparadas) > 60
    for t in ("adm_decisoes", "adm_overrides", "adm_pendencias", "adm_propostas", "adm_vinculos", "corrections", "sapl_houses", "data_coverage", "mandate_contacts", "identity_match_queue",
              "people", "person_external_ids", "pipeline_switches", "adm_rodadas", "places", "mandates"):
        assert t in comparadas, t
    assert set(retrato(iso)) == set(comparadas)


def test_controle_negativo_o_retrato_enxerga_uma_escrita_em_qualquer_tabela_de_dominio(iso, m):
    antes = retrato(iso)
    iso.execute("update sapl_houses set note = coalesce(note, '') || 'x' where id = %s", (m["h_cam"],))
    depois = retrato(iso)
    assert [t for t in antes if depois[t] != antes[t]] == ["sapl_houses"]


CENARIOS = [("duas desligadas", False, False), ("variável ligada, linha desligada", True, False), ("linha ligada, variável desligada", False, True),
            ("as duas ligadas (o parecer em si nunca aplica)", True, True)]


@pytest.mark.parametrize("nome,variavel,linha", CENARIOS, ids=[c[0] for c in CENARIOS])
def test_critério_22_gerar_nao_altera_nenhuma_tabela_de_dominio(iso, m, monkeypatch, nome, variavel, linha):
    rod = rodada(iso)
    ids = quatro(iso, m, rod)
    liga_chaves(iso, monkeypatch, variavel=variavel, linha=linha)
    status0 = iso.execute("select id, status from adm_pendencias order by id").fetchall()
    # (a) UMA pendência
    antes = retrato(iso)
    p1 = PA.gerar(iso, ids["vinculo_sapl"])
    assert retrato(iso) == antes
    assert n(iso, "adm_pareceres") == 1 and (p1["modo"], p1["simulado"], p1["modelo"], p1["versao_verificador"]) == ("ensaio", True, "ensaio-local", PA.VERSAO_VERIFICADOR)
    r = iso.execute("select * from adm_pareceres").fetchone()
    assert (r["modo"], r["simulado"], str(r["pendencia_id"])) == ("ensaio", True, ids["vinculo_sapl"]) and r["entrada"] == p1["entrada"] and r["saida"] == p1["saida"]
    # (b) a RODADA inteira: um parecer por pendência aberta, na ordem da fila
    antes = retrato(iso)
    lote = PA.gerar_da_rodada(iso, rod)
    assert retrato(iso) == antes
    assert [x["pendencia_id"] for x in lote] == [i["id"] for i in pen.fila(iso)] == [ids[c] for c in ("vinculo_sapl", "cobertura", "contato_mandato", "identidade")]
    assert n(iso, "adm_pareceres") == 5 and all(x["modo"] == "ensaio" and x["simulado"] for x in lote)
    assert [n(iso, "adm_pareceres", "pendencia_id = %s", i) for i in ids.values()] == [2, 1, 1, 1]
    # nenhuma decisão, nenhuma pendência mudou de estado
    assert n(iso, "adm_decisoes") == 0 and n(iso, "adm_overrides") == 0 and n(iso, "corrections") == 0
    assert iso.execute("select id, status from adm_pendencias order by id").fetchall() == status0 and {s["status"] for s in status0} == {"aberta"}


def test_gerar_com_pedido_guarda_o_pedido_no_parecer_e_nao_toca_adm_pedidos(iso, m):
    ids = quatro(iso, m)
    ped = str(iso.execute("insert into adm_pedidos (tipo, chave_idem) values ('parecer', 'p1') returning id").fetchone()["id"])
    antes = retrato(iso)
    PA.gerar(iso, ids["cobertura"], pedido_id=ped)
    assert retrato(iso) == antes and str(iso.execute("select pedido_id from adm_pareceres").fetchone()["pedido_id"]) == ped
    assert iso.execute("select status from adm_pedidos").fetchone()["status"] == "na_fila"  # gerar não mexe no pedido


def test_gerar_recusa_pendencia_inexistente_e_motor_sem_identidade_sem_gravar(iso, m):
    quatro(iso, m)
    antes = retrato(iso, excluir=())
    with pytest.raises(ErroAdmin):
        PA.gerar(iso, "00000000-0000-0000-0000-000000000000")
    with pytest.raises(ErroAdmin):
        PA.gerar(iso, "não-é-uuid")
    with pytest.raises(ErroAdmin):
        PA.gerar(iso, iso.execute("select id from adm_pendencias limit 1").fetchone()["id"], motor=lambda e: {"campos": []})  # motor sem `modelo`/`simulado`
    with pytest.raises(ErroAdmin):
        PA.gerar_da_rodada(iso, "00000000-0000-0000-0000-000000000000")
    assert retrato(iso, excluir=()) == antes


# ------------------------------------------------------------------ 10. pela CLI real


@pytest.fixture
def mundo_commit(banco_isolado, monkeypatch):
    """O `mundo` e as quatro pendências (de uma rodada) gravados com commit, apontando o ambiente para o banco isolado; desfeito em `finally`."""
    url = banco_isolado
    for k in ("ETL_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.setenv(k, url)
    c = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    c.execute("set search_path = public, extensions")
    c.execute("set timezone = 'UTC'")
    assert n(c, "adm_pareceres") == 0 and n(c, "adm_decisoes") == 0 and n(c, "adm_pendencias") == 0 and n(c, "pipeline_switches") == 0  # o banco isolado parte limpo
    mm = mundo(c)
    rod = rodada(c)
    ids = quatro(c, mm, rod)
    c.commit()
    try:
        yield url, c, mm, rod, ids
    finally:
        c.rollback()
        with c.transaction():
            c.execute("set local session_replication_role = replica")  # pula a trava que impede apagar decisão; o banco é isolado
            for t in ("adm_pareceres", "adm_overrides", "adm_decisoes", "adm_pendencia_propostas", "adm_propostas", "adm_pendencias", "adm_rodadas"):
                c.execute(f"delete from {t}")  # noqa: S608
            c.execute("delete from pipeline_switches where name = %s", (CHAVE_BANCO,))
        c.commit()
        desfazer(c, mm)
        c.close()


def _cli(capsys, *argv: str) -> tuple[int, str, str]:
    capsys.readouterr()
    rc = cli.main(["admin", *argv])
    o = capsys.readouterr()
    return rc, o.out, o.err


def _retrato_externo(url: str) -> dict:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        c.execute("set search_path = public, extensions")
        return retrato(c)


def test_cli_parecer_de_uma_pendencia_e_de_uma_rodada_nao_altera_nada(mundo_commit, capsys, monkeypatch):
    url, c, mm, rod, ids = mundo_commit
    antes = _retrato_externo(url)
    # --pendencia --json
    rc, out, err = _cli(capsys, "parecer", "--pendencia", ids["vinculo_sapl"], "--json")
    assert rc == 0, err
    doc = json.loads(out)
    assert doc["modo"] == "ensaio" and len(doc["pareceres"]) == 1
    p = doc["pareceres"][0]
    assert (p["modo"], p["simulado"], p["modelo"], p["pendencia_id"]) == ("ensaio", True, "ensaio-local", ids["vinculo_sapl"])
    assert p["saida"]["campos"] == [{"campo": "status", "proposta": "fora_do_ar", "trecho": "$.status == 'fora_do_ar'", "url": "https://a.example/api/"}]
    assert _retrato_externo(url) == antes and n(c, "adm_pareceres") == 1
    # --pendencia em texto: as duas primeiras linhas
    rc, out, err = _cli(capsys, "parecer", "--pendencia", ids["cobertura"])
    assert rc == 0, err
    linhas = out.splitlines()
    assert linhas[0] == "ENSAIO: parecer não aplica nada" and linhas[1] == "SIMULADO: motor de ensaio local, sem chamada a modelo" and "so_portal" in out
    # --rodada
    rc, out, err = _cli(capsys, "parecer", "--rodada", rod)
    assert rc == 0, err
    assert out.splitlines()[:2] == ["ENSAIO: parecer não aplica nada", "SIMULADO: motor de ensaio local, sem chamada a modelo"] and "4 pareceres gravados" in out
    assert _retrato_externo(url) == antes and n(c, "adm_pareceres") == 6 and n(c, "adm_decisoes") == 0 and n(c, "adm_overrides") == 0
    assert n(c, "adm_pendencias", "status = 'aberta'") == 4
    # as duas chaves ligadas (variável e linha): o subcomando continua sem aplicar nada
    c.execute("insert into pipeline_switches (name, value, note) values (%s, 'on', 'teste B4')", (CHAVE_BANCO,))
    c.commit()
    antes_chaves = _retrato_externo(url)
    monkeypatch.setenv(VAR, "on")
    rc, out, err = _cli(capsys, "parecer", "--rodada", rod, "--json")
    assert rc == 0, err
    assert _retrato_externo(url) == antes_chaves and n(c, "adm_decisoes") == 0 and n(c, "adm_pareceres") == 10


def test_cli_real_sem_a_variavel_da_chave_da_api_cai_no_motor_local_e_diz_por_que(mundo_commit, capsys, sem_rede):
    url, c, mm, rod, ids = mundo_commit
    antes = _retrato_externo(url)
    rc, out, err = _cli(capsys, "parecer", "--pendencia", ids["identidade"], "--real", "--json")
    assert rc == 0, err
    p = json.loads(out)["pareceres"][0]
    assert p["simulado"] is True and p["modelo"] == "ensaio-local" and PA.VARIAVEL_CHAVE_API in p["saida"]["motor"]["nota"]
    rc, out, err = _cli(capsys, "parecer", "--pendencia", ids["identidade"], "--real")
    assert rc == 0 and out.splitlines()[1].startswith("SIMULADO: motor de ensaio local") and "motivo do motor" in out and f"motor local no lugar do modelo: a variável {PA.VARIAVEL_CHAVE_API}" in out
    assert _retrato_externo(url) == antes and sem_rede == []


def test_cli_codigos_de_saida(mundo_commit, capsys):
    url, c, mm, rod, ids = mundo_commit
    assert _cli(capsys, "parecer")[0] == 2
    rc, _, err = _cli(capsys, "parecer", "--pendencia", ids["cobertura"], "--rodada", rod)
    assert rc == 2 and "exatamente um" in err
    assert _cli(capsys, "parecer", "--pendencia", "não-é-uuid")[0] == 1
    assert _cli(capsys, "parecer", "--pendencia", "00000000-0000-0000-0000-000000000000")[0] == 1
    assert _cli(capsys, "parecer", "--rodada", "00000000-0000-0000-0000-000000000000")[0] == 1
    assert _cli(capsys, "parecer", "--aplicar", ids["cobertura"])[0] == 2  # não existe opção que aplique
    assert n(c, "adm_pareceres") == 0


def test_o_subcomando_parecer_nao_tem_opcao_que_aplique_e_a_cli_nao_chama_aplicar_por_agentes():
    p = admin_cli._parser()
    sub = next(a for a in p._actions if getattr(a, "choices", None) and "parecer" in a.choices).choices["parecer"]
    opcoes = {o for a in sub._actions for o in a.option_strings}
    assert opcoes == {"-h", "--help", "--json", "--pendencia", "--rodada", "--real"}
    import inspect

    assert "aplicar_por_agentes" not in inspect.getsource(admin_cli) and "aplicar_por_agentes" not in inspect.getsource(cli)


# ------------------------------------------------------------------ 11. motor local


def _entrada(iso, pid: str) -> dict:
    return PA.montar_entrada(iso, pid)


def _afirmado_esta_na_entrada(entrada: dict, saida: dict) -> None:
    candidatos = [x["valor_candidato"] for x in entrada["propostas"]]
    trechos = [x["trecho"] for x in entrada["propostas"]]
    urls = {x["url"] for x in entrada["propostas"]}
    for c in saida["campos"]:
        assert c["campo"] == entrada["pendencia"]["campo"]
        if "proposta" in c:
            assert c["proposta"] in candidatos and c["trecho"] in trechos and c["url"] in urls and "falta_confirmar" not in c
        else:
            assert set(c) == {"campo", "falta_confirmar"} and c["falta_confirmar"].strip()


def test_motor_local_candidato_unico_com_conteudo_devolve_a_proposta_com_o_trecho(iso, m):
    ids = quatro(iso, m)
    esperado = {"vinculo_sapl": ("status", "fora_do_ar", "$.status == 'fora_do_ar'", "https://a.example/api/"),
                "cobertura": ("status", "so_portal", "$.status == 'fora_do_ar'", "https://cob.example/x"),
                "contato_mandato": ("email:vereador@cidade-teste.example", "outro@cidade-teste.example", "$.status == 'fora_do_ar'", "https://c.example/v1"),
                "identidade": ("status", "rejeitado", "$.status == 'fora_do_ar'", "https://i.example/x")}
    for classe, pid in ids.items():
        e = _entrada(iso, pid)
        s = PA.motor_ensaio_local(e)
        campo, valor, trecho, url = esperado[classe]
        assert s["campos"] == [{"campo": campo, "proposta": valor, "trecho": trecho, "url": url}], classe
        _afirmado_esta_na_entrada(e, s)
    assert (PA.motor_ensaio_local.modelo, PA.motor_ensaio_local.simulado) == ("ensaio-local", True)


def test_motor_local_divergencia_vira_falta_confirmar_com_valores_e_urls(iso, m):
    ids = quatro(iso, m)
    PR.registrar(iso, P(m, valor_candidato="sem_api", conteudo_sha256=H("outra"), url="https://b.example/api/", trecho="$.status == 'sem_api'"), agora=AGORA)
    e = _entrada(iso, ids["vinculo_sapl"])
    s = PA.motor_ensaio_local(e)
    (c,) = s["campos"]
    assert set(c) == {"campo", "falta_confirmar"} and c["falta_confirmar"].startswith("as fontes divergem:") and c["falta_confirmar"].endswith("é preciso decidir qual vale")
    assert all(x in c["falta_confirmar"] for x in ("'fora_do_ar'", "'sem_api'", "https://a.example/api/", "https://b.example/api/"))
    _afirmado_esta_na_entrada(e, s)


def test_motor_local_so_falha_de_leitura_vira_falta_confirmar_sem_conteudo(iso, m):
    falha = "sem conteúdo lido: tentativa falha/timeout (HTTP sem resposta) em 2026-11-14T10:00:00Z; o hash é do registro da tentativa (URL, resultado, motivo e status), não de conteúdo da fonte"
    pid = PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("falha"), trecho=falha), agora=AGORA).pendencia_id
    e = _entrada(iso, pid)
    s = PA.motor_ensaio_local(e)
    (c,) = s["campos"]
    assert set(c) == {"campo", "falta_confirmar"} and "não há conteúdo lido" in c["falta_confirmar"] and "https://a.example/api/" in c["falta_confirmar"]
    _afirmado_esta_na_entrada(e, s)
    # uma leitura com conteúdo, depois da falha, na mesma URL: vale a mais recente (com conteúdo)
    PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("ok"), lida_em=AGORA, trecho="$.status == 'fora_do_ar' (lido)"), agora=AGORA)
    s2 = PA.motor_ensaio_local(_entrada(iso, pid))
    assert s2["campos"][0]["trecho"] == "$.status == 'fora_do_ar' (lido)"


def test_motor_local_sem_proposta_vira_falta_confirmar_nao_ha_evidencia(iso, m):
    ids = quatro(iso, m)
    iso.execute("delete from adm_pendencia_propostas where pendencia_id = %s", (ids["cobertura"],))
    e = _entrada(iso, ids["cobertura"])
    assert e["propostas"] == [] and e["evidencias"] == []
    s = PA.motor_ensaio_local(e)
    assert s["campos"] == [{"campo": "status", "falta_confirmar": "não há evidência: nenhuma proposta ligada a esta pendência"}]


def test_motor_local_nao_inventa_e_so_reorganiza_o_que_esta_na_entrada(iso, m):
    ids = quatro(iso, m)
    for pid in ids.values():
        e = _entrada(iso, pid)
        s = PA.motor_ensaio_local(e)
        assert s == PA.motor_ensaio_local(json.loads(json.dumps(e)))  # determinístico
        _afirmado_esta_na_entrada(e, s)
        for c in s["campos"]:  # nada além dos campos conhecidos
            assert set(c) <= {"campo", "proposta", "trecho", "url", "falta_confirmar"}


# ------------------------------------------------------------------ 12. isolamento da entrada


def test_a_entrada_de_uma_pendencia_nao_contem_nada_da_outra(iso, m):
    a = PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("iso-a"), url="https://alfa-unico.example/api/", trecho="TRECHO-ALFA-UNICO"), agora=AGORA).pendencia_id
    b = PR.registrar(iso, P(m, registro_chave=str(m["h_ale"]), valor_candidato="sem_api", conteudo_sha256=H("iso-b"), url="https://beta-unico.example/api/", trecho="TRECHO-BETA-UNICO"),
                     agora=AGORA).pendencia_id
    c = PR.registrar(iso, P(m, classe="contato_mandato", registro_chave=str(m["man"]), campo="novo:email:gama-unico@cidade-teste.example", valor_candidato="gama-unico@cidade-teste.example",
                            bloco="<li id=gama>", conteudo_sha256=H("iso-c"), url="https://gama-unico.example/v", trecho="TRECHO-GAMA-UNICO"), agora=AGORA).pendencia_id
    for url, sha in (("https://alfa-unico.example/api/", "ea"), ("https://beta-unico.example/api/", "eb"), ("https://gama-unico.example/v", "ec")):
        iso.execute("insert into adm_evidencias (url_sha, url, conteudo_sha256, lida_em) values (%s, %s, %s, %s)", (sha256_text(url), url, H(sha), AGORA))
    marcas = {a: "alfa", b: "beta", c: "gama"}
    for pid, mine in marcas.items():
        e = _entrada(iso, pid)
        txt = json.dumps(e, ensure_ascii=False).lower()
        assert set(e) == {"pendencia", "valor_vigente", "propostas", "evidencias"}
        assert e["pendencia"]["id"] == pid and {x["url"] for x in e["propostas"]} == {x["url"] for x in e["evidencias"]} and len(e["propostas"]) == 1
        assert f"{mine}-unico" in txt
        for outro, marca in marcas.items():
            if outro != pid:
                assert f"{marca}-unico" not in txt, (mine, marca)
                assert outro not in txt and H(f"iso-{marca[0]}") not in txt
    # a entrada só tem o registro da pendência: o vigente é o do registro e o hash/URL de outro registro não aparece
    # valores e chaves: estruturalmente (sem colisão de substring com ids inteiros) e por texto
    ea, eb = _entrada(iso, a), _entrada(iso, b)
    assert {x["valor_candidato"] for x in ea["propostas"]} == {"fora_do_ar"} and {x["valor_candidato"] for x in eb["propostas"]} == {"sem_api"}
    assert ea["pendencia"]["registro_chave"] == str(m["h_cam"]) and eb["pendencia"]["registro_chave"] == str(m["h_ale"]) and str(m["h_cam"]) != str(m["h_ale"])
    assert "sem_api" not in json.dumps(ea) and "fora_do_ar" not in json.dumps(eb) and "gama-unico" not in json.dumps(ea) + json.dumps(eb)
    assert _entrada(iso, a)["valor_vigente"] == "ok" and _entrada(iso, a)["pendencia"]["registro_chave"] == str(m["h_cam"])


def test_entrada_de_identidade_traz_o_registro_bruto_e_a_pessoa_candidata_por_id_e_nada_mais(iso, m):
    iso.execute("update identity_match_queue set raw = %s::jsonb where id = %s", (json.dumps({"nome": "Fulano da Fonte"}), str(m["q"])))
    pid = quatro(iso, m)["identidade"]
    e = _entrada(iso, pid)
    assert e["registro_bruto"] == {"fonte": "camara", "external_id": "EXT-ADM-1", "raw": {"nome": "Fulano da Fonte"}, "pessoa_candidata_id": None}
    assert "registro_bruto" not in _entrada(iso, quatro(iso, m)["cobertura"])


# ------------------------------------------------------------------ 13. motor de modelo com cliente falso


def _pend(iso, m):
    pid = PR.registrar(iso, P(m, valor_candidato="fora_do_ar", conteudo_sha256=H("mm")), agora=AGORA).pendencia_id
    return pid, _entrada(iso, pid)


def test_motor_modelo_resposta_correta_e_aceita_e_a_chamada_e_uma_so(iso, m):
    pid, e = _pend(iso, m)
    falso = Falso(resposta("status", proposta="fora_do_ar", trecho="status == 'fora_do_ar'", url="https://a.example/api/"))  # o trecho é substring do trecho da entrada
    motor = PA.motor_modelo(falso, "modelo-falso")
    antes = retrato(iso)
    p = PA.gerar(iso, pid, motor=motor)
    assert retrato(iso) == antes
    assert p["simulado"] is False and p["modelo"] == "modelo-falso" and p["modo"] == "ensaio"
    assert p["saida"]["campos"] == [{"campo": "status", "proposta": "fora_do_ar", "trecho": "status == 'fora_do_ar'", "url": "https://a.example/api/"}]
    assert len(falso.chamadas) == 1
    ch = falso.chamadas[0]
    assert ch["model"] == "modelo-falso" and "nunca complete" in ch["system"].lower() and "$.status == 'fora_do_ar'" in ch["messages"][0]["content"]
    assert n(iso, "adm_pareceres", "not simulado") == 1 and p["saida"]["motor"] == {"modelo": "modelo-falso", "simulado": False, "nota": None}


@pytest.mark.parametrize("nome,item", [
    ("trecho inventado", dict(proposta="fora_do_ar", trecho="a página diz que está fora do ar", url="https://a.example/api/")),
    ("valor que não é candidato", dict(proposta="nao_publica", trecho="status == 'fora_do_ar'", url="https://a.example/api/")),
    ("url que não é da pendência", dict(proposta="fora_do_ar", trecho="status == 'fora_do_ar'", url="https://inventada.example/")),
    ("trecho vazio", dict(proposta="fora_do_ar", trecho="", url="https://a.example/api/")),
    ("proposta e falta_confirmar juntas", dict(proposta="fora_do_ar", trecho="status == 'fora_do_ar'", url="https://a.example/api/", falta_confirmar="talvez")),
])
def test_motor_modelo_o_que_nao_esta_nas_evidencias_vira_falta_confirmar_com_o_motivo(iso, m, nome, item):
    pid, e = _pend(iso, m)
    s = PA.motor_modelo(Falso(resposta("status", **item)), "modelo-falso")(e)
    (c,) = s["campos"]
    assert set(c) == {"campo", "falta_confirmar"} and c["falta_confirmar"].startswith("o parecer citou algo que não está nas evidências"), nome
    _afirmado_esta_na_entrada(e, s)


def test_motor_modelo_falta_confirmar_do_modelo_e_mantida_e_respostas_ruins_nunca_viram_proposta(iso, m):
    pid, e = _pend(iso, m)
    mantida = PA.motor_modelo(Falso(resposta("status", falta_confirmar="falta confirmar a data da leitura")), "x")(e)
    assert mantida["campos"] == [{"campo": "status", "falta_confirmar": "falta confirmar a data da leitura"}]
    for falso in (Falso("não é json"), Falso("[]"), Falso(json.dumps({"campos": []})), Falso(json.dumps({"campos": [{"campo": "outro", "proposta": "x", "trecho": "y", "url": "z", "falta_confirmar": None}]})),
                  Falso(resposta("status"), stop="max_tokens"), Falso(erro=RuntimeError("API fora do ar")), Falso(resposta("status", proposta="fora_do_ar"), stop="refusal")):
        s = PA.motor_modelo(falso, "x")(e)
        assert len(s["campos"]) == 1 and "proposta" not in s["campos"][0] and s["campos"][0]["falta_confirmar"].strip()
        _afirmado_esta_na_entrada(e, s)


def test_o_modelo_padrao_e_o_que_o_pipeline_de_respostas_usa_hoje():
    from civico_etl import verification as V

    assert PA.motor_modelo(Falso("{}")).modelo == V.MODELS["juiz"]


def test_teto_de_pareceres_reais_com_20_gravados_o_21_cai_no_motor_local(iso, m):
    pid, e = _pend(iso, m)
    fabricas: list[int] = []
    falso = Falso(resposta("status", proposta="fora_do_ar", trecho="status == 'fora_do_ar'", url="https://a.example/api/"))

    def fabrica():
        fabricas.append(1)
        return falso

    amb = {PA.VARIAVEL_CHAVE_API: "chave-de-teste"}
    assert PA.TETO_PARECERES_REAIS == 20
    for i in range(19):
        iso.execute("insert into adm_pareceres (pendencia_id, modelo, versao_verificador, entrada, saida, modo, simulado) values (%s, 'modelo-falso', 1, '{}'::jsonb, '{}'::jsonb, 'ensaio', false)", (pid,))
    # 19 gravados: o 20º ainda é real
    motor = PA.escolher_motor(iso, real=True, ambiente=amb, fabrica_cliente=fabrica, modelo="modelo-falso")
    assert motor.simulado is False and fabricas == [1]
    PA.gerar(iso, pid, motor=motor)
    assert n(iso, "adm_pareceres", "not simulado") == 20 and len(falso.chamadas) == 1
    # 20 gravados: o 21º cai no motor local, sem criar cliente, e diz por quê
    fabricas.clear()
    motor = PA.escolher_motor(iso, real=True, ambiente=amb, fabrica_cliente=fabrica, modelo="modelo-falso")
    assert motor.simulado is True and motor.modelo == "ensaio-local" and "teto de 20" in motor.nota and fabricas == []
    p = PA.gerar(iso, pid, motor=motor)
    assert p["simulado"] is True and "teto de 20" in p["saida"]["motor"]["nota"] and len(falso.chamadas) == 1 and n(iso, "adm_pareceres", "not simulado") == 20


def test_o_teto_vale_dentro_de_uma_rodada_e_o_cliente_e_criado_uma_vez(iso, m):
    rod = rodada(iso)
    ids = quatro(iso, m, rod)
    for i in range(18):
        iso.execute("insert into adm_pareceres (pendencia_id, modelo, versao_verificador, entrada, saida, modo, simulado) values (%s, 'modelo-falso', 1, '{}'::jsonb, '{}'::jsonb, 'ensaio', false)",
                    (ids["cobertura"],))
    fabricas: list[int] = []
    falso = Falso(resposta("status", falta_confirmar="falta confirmar"))
    lote = PA.gerar_da_rodada(iso, rod, real=True, ambiente={PA.VARIAVEL_CHAVE_API: "chave-de-teste"}, fabrica_cliente=lambda: fabricas.append(1) or falso, modelo="modelo-falso")
    assert [x["simulado"] for x in lote] == [False, False, True, True]  # 18 + 2 reais = 20; as duas últimas caem no local
    assert len(falso.chamadas) == 2 and fabricas == [1] and n(iso, "adm_pareceres", "not simulado") == 20
    assert all("teto de 20" in x["saida"]["motor"]["nota"] for x in lote[2:])


def test_sem_a_variavel_da_chave_ou_sem_real_nunca_cria_cliente(iso, m):
    pid, _ = _pend(iso, m)
    fabricas: list[int] = []
    for real, amb, trecho in ((False, {PA.VARIAVEL_CHAVE_API: "x"}, "--real não foi pedida"), (True, {}, PA.VARIAVEL_CHAVE_API), (True, {PA.VARIAVEL_CHAVE_API: ""}, PA.VARIAVEL_CHAVE_API)):
        motor = PA.escolher_motor(iso, real=real, ambiente=amb, fabrica_cliente=lambda: fabricas.append(1))
        assert motor.simulado is True and trecho in motor.nota
    # fábrica que falha: cai no local, sem erro
    motor = PA.escolher_motor(iso, real=True, ambiente={PA.VARIAVEL_CHAVE_API: "x"}, fabrica_cliente=lambda: (_ for _ in ()).throw(RuntimeError("sem cliente")))
    assert motor.simulado is True and "cliente da API" in motor.nota and fabricas == []


def test_nenhuma_chamada_de_rede_nem_cliente_real_em_todo_o_modulo(sem_rede):
    import anthropic

    with pytest.raises(AssertionError):
        anthropic.Anthropic()
    sem_rede.clear()  # a tentativa acima foi o próprio teste do alarme
    assert sem_rede == []
