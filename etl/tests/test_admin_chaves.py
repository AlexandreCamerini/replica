"""FABRICADO. Parte B (B4): critério de segurança 9 ("tentativa de aplicar por agentes com qualquer das duas chaves desligada falha fechada").

As duas chaves: variável de ambiente `ADMIN_COLETA_AGENTES=on` E linha `admin_coleta_agentes` com `value = 'on'` em `pipeline_switches`. Só a combinação (on, on) aplica; a comparação é EXATA,
em minúsculas, nas duas (código: `aplicar.chaves_dos_agentes`, `os.environ.get(...) == "on"` e `r["value"] == "on"`; banco: `adm_decisoes_guard`, `value = 'on'`).

Sem rede, sem skip, sem xfail. Todo o módulo roda no banco isolado, DENTRO de transações que revertem (cada combinação da matriz roda num savepoint com `force_rollback`): nada é gravado com
commit, então não há o que desfazer em `finally`; a variável de ambiente é desfeita pelo `monkeypatch` e a linha de `pipeline_switches` some junto com o rollback. Nada é gravado no banco da suíte
(o módulo compara as contagens antes e depois, inclusive `pipeline_switches`).
"""

from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path

import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg import errors as pe
from psycopg.rows import dict_row
from test_admin_decisoes import prop_cob, prop_contato, prop_ident, prop_status
from test_admin_parecer import CHAVE_BANCO, VAR, Falso, compactar_decisoes, resposta, retrato, sem_rede  # noqa: F401  (sem_rede é autouse)
from test_admin_propostas import AGORA, H, P, iso, m  # noqa: F401  (fixtures iso e m)

from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import parecer as PA
from civico_etl.admin import propostas as PR
from civico_etl.admin.aplicar import ChavesDesligadas
from civico_etl.admin.saida import ErroAdmin

SUITE = ("pipeline_switches", "adm_pareceres", "adm_decisoes", "adm_overrides", "adm_pendencias", "adm_vinculos", "corrections", "sapl_houses", "data_coverage", "mandate_contacts",
         "identity_match_queue", "person_external_ids", "people")
# o retrato do que um `aplicar` indevido poderia mexer (linhas inteiras, ordenadas)
TABELAS = ("adm_decisoes", "adm_overrides", "adm_vinculos", "adm_pendencias", "corrections", "sapl_houses", "data_coverage", "mandate_contacts", "identity_match_queue", "person_external_ids")
VARIAVEIS = {"ausente": None, "vazia": "", "off": "off", "0": "0", "ON": "ON", "on": "on"}
LINHAS = {"ausente": None, "off": "off", "ON": "ON", "vazio": "", "on": "on"}
LIGADA = ("on", "on")
CLASSES_APLICAVEIS = ("vinculo_sapl", "cobertura", "contato_mandato", "identidade")


def _contagens(url: str) -> dict[str, int]:
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


@pytest.fixture(scope="module", autouse=True)
def suite_intacta(banco_isolado):
    antes = _contagens(database_url())
    yield
    compactar_decisoes(banco_isolado)  # ver o docstring: a ordem física de `adm_decisoes` no banco isolado é compartilhada com test_admin_decisoes.py
    assert _contagens(database_url()) == antes, "o banco da suíte mudou"


def foto(c, tabelas: tuple[str, ...] = TABELAS) -> dict[str, list[str]]:
    """Linhas inteiras, ordenadas (não só contagem)."""
    return {t: [r["r"] for r in c.execute(f'select x::text as r from public."{t}" x order by r').fetchall()] for t in tabelas}  # noqa: S608 (nomes fixos)


def n(c, tabela: str, onde: str = "true", *p) -> int:
    return c.execute(f"select count(*) as n from {tabela} where {onde}", p or None).fetchone()["n"]  # noqa: S608


def poe(c, monkeypatch, var: str, linha: str) -> None:
    """Põe a variável e a linha nos valores dos rótulos de VARIAVEIS e LINHAS (`ausente` = não existe)."""
    if VARIAVEIS[var] is None:
        monkeypatch.delenv(VAR, raising=False)
    else:
        monkeypatch.setenv(VAR, VARIAVEIS[var])
    c.execute("delete from pipeline_switches where name = %s", (CHAVE_BANCO,))
    if LINHAS[linha] is not None:
        c.execute("insert into pipeline_switches (name, value, note) values (%s, %s, 'teste B4')", (CHAVE_BANCO, LINHAS[linha]))


def agentes(c, pid: str) -> dict:
    return DEC.decidir(c, pid, acao="aprovar", por_tipo="agentes", relatorio={"v": 1}, versao_verificador=1, justificativa="verificadores concordam")


def pessoa(c, pid: str) -> dict:
    return DEC.decidir(c, pid, acao="aprovar", por_tipo="pessoa", por_nome="Fulana de Teste", justificativa="conferi na página da casa")


def pendencia_da_classe(c, mm: dict, classe: str, sha: str = "k") -> str:
    if classe == "vinculo_sapl":
        return prop_status(c, mm, "fora_do_ar", sha="s" + sha)
    if classe == "cobertura":
        return prop_cob(c, mm, "status", "so_portal", sha="c" + sha)
    if classe == "contato_mandato":
        return prop_contato(c, mm, "novo:email:a@cidade-teste.example", "a@cidade-teste.example", sha="n" + sha)
    return prop_ident(c, mm, str(mm["q"]), "rejeitado", sha="i" + sha)


# ------------------------------------------------------------------ 1. a matriz das duas chaves


@pytest.mark.parametrize("classe", CLASSES_APLICAVEIS)
def test_matriz_so_variavel_on_e_linha_on_aplicam_e_todas_as_outras_falham_fechado_sem_mudar_nada(iso, m, monkeypatch, classe):
    d = agentes(iso, pendencia_da_classe(iso, m, classe))
    aplicaram = []
    for vn in VARIAVEIS:
        for ln in LINHAS:
            with iso.transaction(force_rollback=True):
                poe(iso, monkeypatch, vn, ln)
                assert APL.chaves_dos_agentes(iso)["ligadas"] is ((vn, ln) == LIGADA), (vn, ln)
                antes = foto(iso)
                if (vn, ln) == LIGADA:
                    r = APL.aplicar(iso, d["id"])
                    aplicaram.append((vn, ln))
                    assert r["decidido_por"] == "agentes" and r["classe"] == classe
                    assert iso.execute("select aplicada, aplicada_em from adm_decisoes where id = %s", (d["id"],)).fetchone()["aplicada"] is True
                    assert foto(iso) != antes
                else:
                    with pytest.raises(ChavesDesligadas):
                        APL.aplicar(iso, d["id"])
                    assert foto(iso) == antes, (vn, ln)  # NADA mudou: nem a decisão, nem override, nem tabela de domínio
                    assert iso.execute("select aplicada, aplicada_em from adm_decisoes where id = %s", (d["id"],)).fetchone() == {"aplicada": False, "aplicada_em": None}
    assert aplicaram == [LIGADA]
    assert len(VARIAVEIS) * len(LINHAS) == 30


def test_a_comparacao_e_exata_em_minusculas_nas_duas_chaves(iso, monkeypatch):
    # B6: `ambiente=` saiu; a variável é a real, posta com monkeypatch (mesmos valores e mesmas conclusões de antes)
    for v in ("ON", "On", "1", "true", "yes", " on", "on ", ""):
        iso.execute("delete from pipeline_switches where name = %s", (CHAVE_BANCO,))
        iso.execute("insert into pipeline_switches (name, value, note) values (%s, %s, 'teste B4')", (CHAVE_BANCO, v))
        monkeypatch.setenv(VAR, "on")
        assert APL.chaves_dos_agentes(iso) == {"variavel": True, "linha": False, "ligadas": False}, repr(v)
        monkeypatch.setenv(VAR, v)
        assert APL.chaves_dos_agentes(iso)["variavel"] is False, repr(v)
    iso.execute("update pipeline_switches set value = 'on' where name = %s", (CHAVE_BANCO,))
    monkeypatch.setenv(VAR, "on")
    assert APL.chaves_dos_agentes(iso)["ligadas"] is True
    monkeypatch.delenv(VAR, raising=False)
    assert APL.chaves_dos_agentes(iso)["ligadas"] is False
    src = inspect.getsource(APL.chaves_dos_agentes)  # as duas comparações do código, sem .lower()/.upper()/.strip()
    assert 'os.environ.get(VARIAVEL) == "on"' in src and 'r["value"] == "on"' in src and not re.search(r"\.(lower|upper|strip|casefold)\(", src)


# ------------------------------------------------------------------ 2. a segunda chave no BANCO, sem passar pelo código


def test_o_gatilho_do_banco_confere_a_segunda_chave_sem_o_codigo(iso, m, monkeypatch):
    monkeypatch.setenv(VAR, "on")  # a primeira chave ligada: o banco não a conhece
    d = agentes(iso, prop_status(iso, m, "fora_do_ar"))
    marca = "update adm_decisoes set aplicada = true where id = %s"
    for ln in ("ausente", "off", "ON", "vazio"):
        poe(iso, monkeypatch, "on", ln)
        with pytest.raises(pe.RaiseException, match="admin_coleta_agentes = on"):
            with iso.transaction():
                iso.execute(marca, (d["id"],))
        assert iso.execute("select aplicada, aplicada_em from adm_decisoes where id = %s", (d["id"],)).fetchone() == {"aplicada": False, "aplicada_em": None}
    poe(iso, monkeypatch, "on", "on")
    with iso.transaction(force_rollback=True):
        iso.execute(marca, (d["id"],))
        assert iso.execute("select aplicada, aplicada_em is not null as com_data from adm_decisoes where id = %s", (d["id"],)).fetchone() == {"aplicada": True, "com_data": True}
    # decisão de PESSOA passa sem a linha
    poe(iso, monkeypatch, "ausente", "ausente")
    dp = pessoa(iso, prop_cob(iso, m, "status", "so_portal"))
    with iso.transaction(force_rollback=True):
        iso.execute(marca, (dp["id"],))
        assert iso.execute("select aplicada from adm_decisoes where id = %s", (dp["id"],)).fetchone()["aplicada"] is True
    # a decisão já aplicada não volta atrás e a de agentes não nasce aplicada
    with pytest.raises(pe.RaiseException):
        with iso.transaction():
            iso.execute("insert into adm_decisoes (pendencia_id, acao, decidido_por_tipo, relatorio, versao_verificador, justificativa, aplicada) "
                        "select pendencia_id, acao, 'agentes', relatorio, versao_verificador, 'x', true from adm_decisoes where id = %s", (d["id"],))


# ------------------------------------------------------------------ 3. as chaves são lidas na hora


def test_as_chaves_sao_lidas_na_hora_nada_fica_em_cache(iso, m, monkeypatch):
    d1 = agentes(iso, prop_status(iso, m, "fora_do_ar"))
    d2 = agentes(iso, prop_cob(iso, m, "status", "so_portal"))
    d3 = agentes(iso, prop_cob(iso, m, "reason", "texto novo", sha="r"))
    poe(iso, monkeypatch, "on", "on")
    APL.aplicar(iso, d1["id"])
    assert iso.execute("select status from sapl_houses where id = %s", (m["h_cam"],)).fetchone()["status"] == "fora_do_ar"
    # desliga a linha: a segunda falha
    iso.execute("update pipeline_switches set value = 'off' where name = %s", (CHAVE_BANCO,))
    antes = foto(iso)
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d2["id"])
    assert foto(iso) == antes
    # religa a linha e desliga a variável: falha de novo
    iso.execute("update pipeline_switches set value = 'on' where name = %s", (CHAVE_BANCO,))
    monkeypatch.delenv(VAR)
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d2["id"])
    assert foto(iso) == antes
    # as duas de volta: aplica (sem recarregar módulo nenhum)
    monkeypatch.setenv(VAR, "on")
    APL.aplicar(iso, d2["id"])
    # variável trocada para `off` depois de aplicada a segunda: a terceira falha
    monkeypatch.setenv(VAR, "off")
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d3["id"])
    # nada de estado de módulo: nenhum cache na leitura das chaves
    src = inspect.getsource(APL)
    assert "lru_cache" not in src and "functools" not in src and "global " not in src


# ------------------------------------------------------------------ 4. aplicar_pendentes misto


def test_aplicar_pendentes_aplica_as_de_pessoa_e_bloqueia_as_de_agentes_dizendo_quais(iso, m, monkeypatch):
    p_pessoa1 = pessoa(iso, prop_status(iso, m, "fora_do_ar"))
    p_pessoa2 = pessoa(iso, prop_ident(iso, m, str(m["q"]), "rejeitado"))
    a_cob = agentes(iso, prop_cob(iso, m, "status", "so_portal"))
    a_ctt = agentes(iso, prop_contato(iso, m, "novo:email:a@cidade-teste.example", "a@cidade-teste.example", sha="n1"))
    esperado_bloqueadas = {str(a_cob["id"]), str(a_ctt["id"])}
    for var, linha in (("ausente", "ausente"), ("on", "ausente"), ("ausente", "on"), ("on", "off"), ("ON", "on")):
        with iso.transaction(force_rollback=True):
            poe(iso, monkeypatch, var, linha)
            lote = APL.aplicar_pendentes(iso)
            estados = {i["decisao_id"]: i["estado"] for i in lote}
            assert estados == {str(p_pessoa1["id"]): "aplicada", str(p_pessoa2["id"]): "aplicada", str(a_cob["id"]): "bloqueada_chaves", str(a_ctt["id"]): "bloqueada_chaves"}, (var, linha)
            assert {i["decisao_id"] for i in lote if i["estado"] == "bloqueada_chaves"} == esperado_bloqueadas and all(i["erro"] and i["resultado"] is None for i in lote if i["estado"] == "bloqueada_chaves")
            flags = {str(r["id"]): r["aplicada"] for r in iso.execute("select id, aplicada from adm_decisoes").fetchall()}
            assert flags == {str(p_pessoa1["id"]): True, str(p_pessoa2["id"]): True, str(a_cob["id"]): False, str(a_ctt["id"]): False}
            assert n(iso, "mandate_contacts", "value = 'a@cidade-teste.example'") == 0 and n(iso, "adm_overrides", "classe = 'cobertura'") == 0
    # as duas ligadas: o mesmo lote aplica tudo
    with iso.transaction(force_rollback=True):
        poe(iso, monkeypatch, "on", "on")
        assert {i["estado"] for i in APL.aplicar_pendentes(iso)} == {"aplicada"}


# ------------------------------------------------------------------ 5. parecer.aplicar_por_agentes


def _pareceres(iso, m):
    """(real com proposta validada, de ensaio local, real só com falta_confirmar), cada um de uma pendência."""
    p_real = prop_status(iso, m, "fora_do_ar")
    falso = Falso(resposta("status", proposta="fora_do_ar", trecho="$.status == 'fora_do_ar'", url="https://a.example/api/"))
    real = PA.gerar(iso, p_real, motor=PA.motor_modelo(falso, "modelo-falso"))
    local = PA.gerar(iso, prop_cob(iso, m, "status", "so_portal"))
    falso2 = Falso(resposta("status", proposta="rejeitado", trecho="frase que a fonte não traz", url="https://i.example/x"))
    ruim = PA.gerar(iso, prop_ident(iso, m, str(m["q"]), "rejeitado"), motor=PA.motor_modelo(falso2, "modelo-falso"))
    assert (real["simulado"], local["simulado"], ruim["simulado"]) == (False, True, False)
    assert real["saida"]["campos"][0]["proposta"] == "fora_do_ar" and "falta_confirmar" in ruim["saida"]["campos"][0] and len(falso.chamadas) == 1
    return real, local, ruim


def test_aplicar_por_agentes_com_qualquer_chave_desligada_levanta_antes_de_criar_a_decisao(iso, m, monkeypatch):
    real, local, ruim = _pareceres(iso, m)
    for vn in VARIAVEIS:
        for ln in LINHAS:
            if (vn, ln) == LIGADA:
                continue
            with iso.transaction(force_rollback=True):
                poe(iso, monkeypatch, vn, ln)
                antes, antes_todas = foto(iso), retrato(iso, excluir=())
                for p in (real, local, ruim):  # inclusive o parecer de ensaio local e o inexistente: a chave vem primeiro
                    with pytest.raises(ChavesDesligadas):
                        PA.aplicar_por_agentes(iso, p["id"])
                with pytest.raises(ChavesDesligadas):
                    PA.aplicar_por_agentes(iso, "00000000-0000-0000-0000-000000000000")
                assert foto(iso) == antes and n(iso, "adm_decisoes") == 0, (vn, ln)  # NEM a decisão foi criada
                assert retrato(iso, excluir=()) == antes_todas, (vn, ln)  # nenhuma tabela de `public` mudou, adm_pareceres inclusive


def test_aplicar_por_agentes_com_as_duas_ligadas_recusa_ensaio_e_falta_confirmar_e_aplica_so_o_real_validado(iso, m, monkeypatch):
    real, local, ruim = _pareceres(iso, m)
    poe(iso, monkeypatch, "on", "on")
    # parecer simulado (motor local): recusado, nada criado
    antes_todas = retrato(iso, excluir=())
    with pytest.raises(PA.ParecerRecusado, match="ensaio local não se aplica"):
        PA.aplicar_por_agentes(iso, local["id"])
    # parecer real, mas só com falta_confirmar (o modelo citou trecho inventado): nunca vira decisão
    with pytest.raises(PA.ParecerRecusado, match="nenhuma|não tem proposta validada"):
        PA.aplicar_por_agentes(iso, ruim["id"])
    with pytest.raises(ErroAdmin):
        PA.aplicar_por_agentes(iso, "00000000-0000-0000-0000-000000000000")
    assert retrato(iso, excluir=()) == antes_todas and n(iso, "adm_decisoes") == 0
    # parecer real adulterado no banco (valor que não é candidato): a validação refaz e recusa
    with iso.transaction(force_rollback=True):
        iso.execute("update adm_pareceres set saida = jsonb_set(saida, '{campos,0,proposta}', '\"nao_publica\"') where id = %s", (real["id"],))
        with pytest.raises(PA.ParecerRecusado):
            PA.aplicar_por_agentes(iso, real["id"])
        assert n(iso, "adm_decisoes") == 0
    # parecer real com proposta validada: decisão de agentes (relatório e versão), aplicada, override gravado
    r = PA.aplicar_por_agentes(iso, real["id"])
    d = iso.execute("select * from adm_decisoes where id = %s", (r["decisao_id"],)).fetchone()
    assert (d["decidido_por_tipo"], d["decidido_por_nome"], d["acao"], d["aplicada"], d["versao_verificador"]) == ("agentes", None, "aprovar", True, PA.VERSAO_VERIFICADOR) and d["aplicada_em"] is not None
    assert d["relatorio"]["parecer_id"] == real["id"] and d["relatorio"]["saida"]["campos"][0]["trecho"] == "$.status == 'fora_do_ar'" and d["justificativa"].strip() and d["campos_afetados"]
    assert n(iso, "adm_decisoes") == 1 and n(iso, "adm_overrides", "vigente and campo = 'status' and decisao_id = %s", d["id"]) == 1
    assert iso.execute("select status from sapl_houses where id = %s", (m["h_cam"],)).fetchone()["status"] == "fora_do_ar"
    assert iso.execute("select status from adm_pendencias where id = %s", (real["pendencia_id"],)).fetchone()["status"] == "decidida" and r["aplicacao"]["decidido_por"] == "agentes"
    # aplicar de novo o mesmo parecer: a pendência já está decidida, nada novo
    with pytest.raises(ErroAdmin):
        PA.aplicar_por_agentes(iso, real["id"])
    assert n(iso, "adm_decisoes") == 1


def test_aplicar_por_agentes_a_variavel_ligada_nao_liga_a_linha_do_banco(iso, m, monkeypatch):
    """B6: o parâmetro `ambiente=` saiu (ver test_admin_endurece.py). Aqui a VARIÁVEL real (monkeypatch) ligada nunca liga a linha de `pipeline_switches`: com a linha ausente continua falhando."""
    real, _, _ = _pareceres(iso, m)
    poe(iso, monkeypatch, "ausente", "ausente")
    monkeypatch.setenv(VAR, "on")
    antes = retrato(iso, excluir=())
    with pytest.raises(ChavesDesligadas):
        PA.aplicar_por_agentes(iso, real["id"])
    assert retrato(iso, excluir=()) == antes and n(iso, "adm_decisoes") == 0


# ------------------------------------------------------------------ 6. inspeção do código


def _funcao(modulo, nome: str) -> ast.FunctionDef:
    arvore = ast.parse(inspect.getsource(modulo))
    return next(f for f in ast.walk(arvore) if isinstance(f, ast.FunctionDef) and f.name == nome)


ESCRITA_SQL = re.compile(r"\b(insert|update|delete)\b|merge_person|\bfor update\b", re.I)
CHAMADAS_QUE_ESCREVEM = {"decidir", "aplicar", "_override", "_corrections", "_duplicata", "lidor", "_sapl", "_cobertura", "_contato", "_identidade", "propostas_registrar", "gerar"}


def _linhas_de_escrita(fn: ast.FunctionDef) -> list[tuple[int, str]]:
    """Toda chamada, no corpo da função, que escreve no banco ou abre savepoint (SQL de escrita em `.execute`, `.transaction()`, ou chamada a quem escreve)."""
    out = []
    for no in ast.walk(fn):
        if not isinstance(no, ast.Call):
            continue
        f = no.func
        nome = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else None
        if nome == "transaction":
            out.append((no.lineno, "savepoint"))
        elif nome == "execute" and no.args and ESCRITA_SQL.search(ast.unparse(no.args[0])):
            out.append((no.lineno, f"execute: {ast.unparse(no.args[0])[:60]}"))
        elif nome in CHAMADAS_QUE_ESCREVEM:
            kw = {k.arg: getattr(k.value, "value", None) for k in no.keywords}
            if nome == "_decisao" or kw.get("travar") is True:
                continue
            out.append((no.lineno, f"chama {nome}"))
    return sorted(out)


def _linha_da_chamada(fn: ast.FunctionDef, nome: str) -> int:
    return min(no.lineno for no in ast.walk(fn) if isinstance(no, ast.Call) and (getattr(no.func, "attr", None) == nome or getattr(no.func, "id", None) == nome))


def test_em_aplicar_a_conferencia_das_chaves_vem_antes_de_qualquer_escrita_ou_savepoint():
    fn = _funcao(APL, "aplicar")
    conf = _linha_da_chamada(fn, "chaves_dos_agentes")
    escritas = _linhas_de_escrita(fn)
    assert escritas, "a análise não achou nenhuma escrita em `aplicar`: o teste perdeu o alvo"
    assert all(l > conf for l, _ in escritas), (conf, escritas)
    # o ramo de agentes levanta ChavesDesligadas logo depois da conferência e antes da primeira escrita
    levanta = [no.lineno for no in ast.walk(fn) if isinstance(no, ast.Raise) and isinstance(no.exc, ast.Call) and getattr(no.exc.func, "id", None) == "ChavesDesligadas"]
    assert levanta and conf < levanta[0] < escritas[0][0]
    # e a conferência está dentro de `if d["decidido_por_tipo"] == "agentes"`
    ramo = next(no for no in ast.walk(fn) if isinstance(no, ast.If) and "agentes" in ast.unparse(no.test) and conf in range(no.lineno, no.end_lineno + 1))
    assert "decidido_por_tipo" in ast.unparse(ramo.test)


def test_em_aplicar_por_agentes_a_conferencia_das_chaves_e_a_primeira_instrucao():
    fn = _funcao(PA, "aplicar_por_agentes")
    corpo = [s for s in fn.body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]  # sem o docstring
    primeira = corpo[0]
    assert isinstance(primeira, ast.Assign) and "chaves_dos_agentes" in ast.unparse(primeira.value)
    conf = primeira.lineno
    escritas = _linhas_de_escrita(fn)
    assert escritas and all(l > conf for l, _ in escritas), (conf, escritas)
    segunda = corpo[1]  # a recusa vem logo depois, antes de qualquer outra instrução
    assert isinstance(segunda, ast.If) and any(isinstance(s, ast.Raise) and "ChavesDesligadas" in ast.unparse(s) for s in segunda.body)


def test_so_aplicar_py_marca_decisao_como_aplicada_em_todo_o_pacote():
    raiz = Path(inspect.getsourcefile(APL)).parent.parent  # civico_etl/
    achados: dict[str, int] = {}
    for f in sorted(raiz.rglob("*.py")):
        for no in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(no, ast.Constant) and isinstance(no.value, str) and (re.search(r"update\s+adm_decisoes\b", no.value, re.I) or re.search(r"\bset\b[^;]*\baplicada\s*=\s*(true|%s)", no.value, re.I)):
                achados[str(f.relative_to(raiz))] = achados.get(str(f.relative_to(raiz)), 0) + 1
    assert achados == {"admin/aplicar.py": 1}, achados
    # e nenhum arquivo de admin/ além de aplicar.py faz SQL de escrita em adm_decisoes (insert só em decisoes.py)
    for f in sorted((raiz / "admin").glob("*.py")):
        fonte = f.read_text(encoding="utf-8")
        for no in ast.walk(ast.parse(fonte)):
            if isinstance(no, ast.Constant) and isinstance(no.value, str) and re.search(r"\b(update|delete\s+from)\s+adm_decisoes\b", no.value, re.I):
                assert f.name == "aplicar.py", f.name


def test_o_unico_chamador_de_aplicar_por_agentes_e_o_teste():
    raiz = Path(inspect.getsourcefile(APL)).parent.parent
    chamadores = [str(f.relative_to(raiz)) for f in sorted(raiz.rglob("*.py")) if "aplicar_por_agentes(" in f.read_text(encoding="utf-8") and f.name != "parecer.py"]
    assert chamadores == []


# ------------------------------------------------------------------ 7. independência das chaves do pipeline de respostas


def test_as_chaves_do_pipeline_de_respostas_nao_ligam_as_deste_modulo(iso, m, monkeypatch):
    d = agentes(iso, prop_status(iso, m, "fora_do_ar"))
    real, _, _ = _pareceres(iso, m)
    monkeypatch.setenv("VERIFICACAO_AGENTICA", "on")
    iso.execute("insert into pipeline_switches (name, value, note) values ('verificacao_agentica', 'on', 'teste B4')")
    assert APL.chaves_dos_agentes(iso) == {"variavel": False, "linha": False, "ligadas": False}
    antes = retrato(iso, excluir=())
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d["id"])
    with pytest.raises(ChavesDesligadas):
        PA.aplicar_por_agentes(iso, real["id"])
    assert retrato(iso, excluir=()) == antes
    # cada uma das deste módulo sozinha, com as do pipeline de respostas ligadas: continua falhando
    monkeypatch.setenv(VAR, "on")
    assert APL.chaves_dos_agentes(iso)["ligadas"] is False
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d["id"])
    monkeypatch.delenv(VAR)
    iso.execute("insert into pipeline_switches (name, value, note) values (%s, 'on', 'teste B4')", (CHAVE_BANCO,))
    with pytest.raises(ChavesDesligadas):
        APL.aplicar(iso, d["id"])
    # o gatilho do banco também ignora a linha do outro pipeline
    iso.execute("delete from pipeline_switches where name = %s", (CHAVE_BANCO,))
    with pytest.raises(pe.RaiseException):
        with iso.transaction():
            iso.execute("update adm_decisoes set aplicada = true where id = %s", (d["id"],))
    # e os nomes são distintos nos dois módulos
    assert (APL.VARIAVEL, APL.CHAVE_BANCO) == ("ADMIN_COLETA_AGENTES", "admin_coleta_agentes")
