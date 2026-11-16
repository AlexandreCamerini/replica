"""R7: forma do catálogo (civico_etl.catalogo) e do contrato comum de coletor. Sem banco, sem rede.

Cobre R1 (modelo declarativo), R3 (descrever/executar) e R4 (classe de cada arquivo) na parte entregue nesta tarefa: o modelo, os 48
comandos e as quatro primeiras entradas (camara.equipe, sapl.camaras, camara.diario, camara.noturna). As demais entradas e os testes de
cobertura total (R-5, R-7) são das tarefas seguintes.
"""

from __future__ import annotations

import ast
import json
import socket
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest
from test_orquestradores import comandos_da_cli

from civico_etl import http as H
from civico_etl import schedule as S
from civico_etl.catalogo import (
    ARQUIVOS, COLETORES, COLETORES_PENDENTES, COMANDOS, MISTOS, Ausentes, Classe, Coletor, Comando, Entradas, Fonte, Modo, Recorte, coletor, comando,
    descrever, executar, por_comando, por_tarefa, runner_subprocesso,
)
from civico_etl.catalogo import contrato
from civico_etl.catalogo.modelo import ACESSOS, MODOS

ETL = Path(__file__).resolve().parents[1]
PKG = ETL / "civico_etl"
QUATRO = ("camara.equipe", "sapl.camaras", "camara.diario", "camara.noturna")
HOJE = date(2026, 11, 15)


# ---------------------------------------------------------------- utilitários


def _constante(arquivo: str, nome: str):
    """Valor literal de uma constante de módulo, lido por AST (sem importar o job: sapl.py altera http.RATE no import)."""
    tree = ast.parse((PKG / arquivo).read_text(encoding="utf-8"))
    for n in tree.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            return ast.literal_eval(n.value)
    raise AssertionError(f"{nome} não encontrado em {arquivo}")


def _flags(arquivo: str) -> set[str]:
    tree = ast.parse((PKG / arquivo).read_text(encoding="utf-8"))
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_argument":
            for a in n.args:
                if isinstance(a, ast.Constant) and isinstance(a.value, str):
                    out.add(a.value if a.value.startswith("--") else "key" if a.value == "key" else "")
    out.discard("")
    return out


PARSER_ARQUIVO = {"cli": "cli.py", "ale_cli": "jobs/ale_cli.py", "sapl": "jobs/sapl.py", "sancoes": "jobs/sancoes.py",
                  "transparencia": "transparencia.py", "schedule": "schedule.py"}


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class ConnFalsa:
    """Dublê de conexão só de leitura: devolve as linhas da primeira chave que aparece no SQL."""

    def __init__(self, respostas: dict[str, list[dict]]):
        self.respostas = respostas
        self.sqls: list[str] = []

    def execute(self, sql, params=None):
        self.sqls.append(" ".join(sql.split()))
        for chave, rows in self.respostas.items():
            if chave in sql:
                return _Res(rows)
        raise AssertionError(f"consulta inesperada: {sql[:120]}")


# ---------------------------------------------------------------- importar não tem efeito colateral


def test_importar_o_catalogo_nao_importa_job_nem_altera_http_rate():
    codigo = """
import json, sys
from datetime import date
import civico_etl.http as H
antes_rate, antes_mods = H.RATE, set(sys.modules)
import civico_etl.catalogo as k
for cid in ("camara.equipe", "sapl.camaras", "camara.diario", "camara.noturna"):
    k.descrever(cid, k.Recorte(), hoje=date(2026, 11, 15))
    k.executar(cid, k.Recorte(), runner=lambda argv: 0)
novos = sorted(m for m in sys.modules if m not in antes_mods)
print(json.dumps({"rate_igual": H.RATE == antes_rate, "novos": novos}))
"""
    p = subprocess.run([sys.executable, "-c", codigo], cwd=ETL, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    assert r["rate_igual"]
    proibidos = [m for m in r["novos"] if m.startswith("civico_etl.jobs") or m in ("civico_etl.cli", "civico_etl.schedule", "civico_etl.db")]
    assert proibidos == []
    assert "civico_etl.catalogo.contrato" in r["novos"]


def test_contrato_nao_referencia_job_nem_funcao_run():
    tree = ast.parse((PKG / "catalogo" / "contrato.py").read_text(encoding="utf-8"))
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            assert "jobs" not in (n.module or "").split(".") and "jobs" not in [a.name for a in n.names], f"importa job: {ast.dump(n)}"
        if isinstance(n, ast.Import):
            assert not any(".jobs" in a.name for a in n.names)
        if isinstance(n, ast.Name):
            assert not n.id.startswith("run_") or n.id == "run_due", f"referência a {n.id}"
        if isinstance(n, ast.Attribute):
            assert not n.attr.startswith("run_"), f"referência a {n.attr}"
    # o único import da CLI fica dentro de função (não no topo)
    topo = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    assert not any("cli" in ast.dump(n) for n in topo)


# ---------------------------------------------------------------- R4: classe de cada arquivo


def test_todo_arquivo_de_jobs_tem_classe_e_arquivos_nao_cita_o_que_nao_existe():
    em_disco = {f"jobs/{p.name}" for p in (PKG / "jobs").glob("*.py") if p.name != "__init__.py"} | {"transparencia.py", "remotezip.py"}
    assert em_disco - set(ARQUIVOS) == set(), "arquivo sem classe"
    assert set(ARQUIVOS) - em_disco == set(), "ARQUIVOS cita arquivo inexistente"
    assert all(isinstance(c, Classe) for c in ARQUIVOS.values())
    assert set(MISTOS) <= set(ARQUIVOS) and all(MISTOS.values())


def test_classes_conhecidas_da_tabela_0_1():
    assert ARQUIVOS["jobs/assembleias.py"] is Classe.BIBLIOTECA
    assert ARQUIVOS["jobs/ale_cli.py"] is Classe.DESPACHANTE
    assert ARQUIVOS["jobs/repairs.py"] is Classe.ROTINA_DE_AGENDA
    assert ARQUIVOS["jobs/senado_extras.py"] is Classe.COLETOR
    assert ARQUIVOS["remotezip.py"] is Classe.BIBLIOTECA
    assert {c for c in ARQUIVOS.values()} <= set(Classe) - {Classe.MANUTENCAO}  # manutenção é comando inline, não arquivo


# ---------------------------------------------------------------- comandos


def test_comandos_sao_exatamente_os_da_cli():
    nomes = [c.nome for c in COMANDOS]
    assert len(nomes) == len(set(nomes)) == 48
    assert set(nomes) == comandos_da_cli()


def test_cada_comando_tem_modulo_parser_e_flags_reais():
    for c in COMANDOS:
        assert (PKG / c.modulo).is_file(), f"{c.nome}: módulo {c.modulo} não existe"
        if c.parser == "inline":
            continue
        reais = _flags(PARSER_ARQUIVO[c.parser])
        assert set(c.argumentos) <= reais, f"{c.nome}: {set(c.argumentos) - reais} não existe no parser {c.parser}"
    nomes = {c.nome for c in COMANDOS}
    for c in COMANDOS:
        assert set(c.encadeia) <= nomes


def test_classe_coletor_tem_id_de_coletor_e_o_resto_nao():
    for c in COMANDOS:
        assert (c.coletor is not None) == (c.classe is Classe.COLETOR)
    assert sum(1 for c in COMANDOS if c.classe is Classe.COLETOR) == 28
    assert comando("purge-raw").classe is Classe.MANUTENCAO and comando("purge-raw").parser == "inline"
    assert comando("transparencia.ping").classe is Classe.CHECAGEM
    assert comando("ale.cobertura").classe is Classe.DESPACHANTE


def test_pendentes_sao_os_ids_citados_sem_entrada():
    citados = {c.coletor for c in COMANDOS if c.coletor}
    ids = {c.id for c in COLETORES}
    assert COLETORES_PENDENTES == citados - ids
    assert not (COLETORES_PENDENTES & ids)
    assert set(QUATRO) <= ids  # desde a integração dos lotes, o catálogo tem todos os coletores


def test_encadeia_dos_comandos_do_parser_principal():
    esperado = {
        "ibge.populacao": ("seed",), "tse.candidatos": ("derive.stats",), "tse.votos": ("derive.stats",), "tse.contas": ("derive.stats",),
        "camara.diario": ("identity.dedupe", "derive.stats"), "senado.diario": ("identity.dedupe", "derive.stats"),
        "camara.presenca": ("derive.stats",), "parlamento.extras": ("derive.stats",), "identity.dedupe": ("derive.stats",),
    }
    for c in COMANDOS:
        if c.parser == "cli" and c.nome not in ("all",):
            assert c.encadeia == esperado.get(c.nome, ()), c.nome


def test_flags_das_tarefas_estao_nos_argumentos_do_comando():
    nomes = {c.nome for c in COMANDOS}
    for t in S.TASKS:
        argv = t.argv(HOJE)
        assert argv[0] in nomes, t.name
        flags = {a for a in argv[1:] if a.startswith("--")}
        assert flags <= set(comando(argv[0]).argumentos), f"{t.name}: {flags - set(comando(argv[0]).argumentos)}"


# ---------------------------------------------------------------- coletores


def test_coletores_passam_na_validacao_e_apontam_de_volta():
    assert len({c.id for c in COLETORES}) == len(COLETORES)
    tarefas = {t.name: t for t in S.TASKS}
    for c in COLETORES:
        assert isinstance(c, Coletor)
        for m in c.modulos:
            assert (PKG / m).is_file(), f"{c.id}: {m}"
        for n in c.comandos:
            cmd = comando(n)
            assert cmd.classe is Classe.COLETOR and cmd.coletor == c.id
            assert cmd.encadeia == c.encadeados, f"{c.id}/{n}"
            assert por_comando(n) is c
        for tn in c.tarefas:
            assert tn in tarefas, f"tarefa {tn} fora de schedule.TASKS"
            t = tarefas[tn]
            assert t.argv(HOJE)[0] in c.comandos
            assert t.needs_env == c.env
            if t.source:
                assert t.source in {f.slug for f in c.fontes}
            assert por_tarefa(tn) is c
        assert set(c.modos) == set(MODOS)
        assert coletor(c.id) is c


def test_valores_do_catalogo_conferem_com_o_codigo():
    assert contrato._REGISTRO_SAPL == _constante("jobs/sapl.py", "REGISTRY")
    assert contrato._PAGINA_SAPL == _constante("jobs/sapl.py", "PAGE")
    api, files = _constante("jobs/camara_diario.py", "API"), _constante("jobs/camara_diario.py", "FILES")
    assert api == "https://dadosabertos.camara.leg.br/api/v2" and files == "https://dadosabertos.camara.leg.br/arquivos"
    assert coletor("camara.equipe").entradas.urls == (_constante("jobs/camara_equipe.py", "URL"),)
    assert _constante("jobs/camara_diario.py", "COTA_API_FROM") == 2025
    assert coletor("sapl.camaras").entradas.urls == (_constante("jobs/sapl.py", "REGISTRY"),)
    for u in coletor("camara.noturna").entradas.urls:
        assert u.startswith(files) and "{ano}" in u


def test_exemplos_do_plano_nos_valores_que_o_codigo_confirma():
    eq = coletor("camara.equipe")
    assert eq.ausentes.politica == "apaga" and eq.territorio == "nenhuma" and eq.encadeados == ()
    assert eq.modos["descobrir"].suporta is False and eq.modos["recoletar"].suporta
    sc = coletor("sapl.camaras")
    assert sc.comandos == ("sapl.descobrir", "sapl.carregar", "sapl.todas") and sc.tarefas == ("sapl.todas",)
    assert sc.modos["reprocessar"].suporta is False and sc.modos["reprocessar"].motivo
    assert "uf" in sc.recortes_nao_aceitos and set(sc.recortes_aceitos) == {"ibge", "escopo"}
    assert sc.ausentes.politica == "nao_apaga"
    cd = coletor("camara.diario")
    assert cd.ausentes.politica == "apaga_com_guarda" and cd.ausentes.guarda and cd.encadeados == ("identity.dedupe", "derive.stats")
    assert cd.entradas.tipo == "dinamicas" and cd.entradas.depende_de
    cn = coletor("camara.noturna")
    assert cn.entradas.tipo == "estaticas" and cn.encadeados == () and "parties" in cn.tabelas


def test_acesso_so_usa_valores_fechados():
    assert all(set(c.acesso) <= set(ACESSOS) for c in COLETORES)


def test_acessores_de_nome_levantam_keyerror_para_o_que_nao_tem_entrada():
    for nome in ("nao.existe", "tse.votos.inventado"):  # integrado: tse.votos agora tem entrada; o que protege é o id sem entrada
        with pytest.raises(KeyError):
            coletor(nome)
    assert coletor("tse.votos").id == "tse.votos"
    with pytest.raises(KeyError):
        por_comando("nao.existe")
    with pytest.raises(KeyError):
        por_tarefa("nao.existe")
    with pytest.raises(KeyError):
        comando("nao.existe")


def _coletor_valido(**mudancas) -> Coletor:
    base = coletor("camara.equipe")
    campos = {f: getattr(base, f) for f in Coletor.__dataclass_fields__}
    campos.update(mudancas)
    return Coletor(**campos)


def test_validacao_recusa_valores_fora_do_modelo():
    with pytest.raises(ValueError):
        Modo(False, "")
    with pytest.raises(ValueError):
        Ausentes("apaga_com_guarda", "")
    with pytest.raises(ValueError):
        Ausentes("outra")
    with pytest.raises(ValueError):
        Entradas("dinamicas", urls=("https://x",), depende_de="")
    with pytest.raises(ValueError):
        Entradas("estaticas", urls=())
    with pytest.raises(ValueError):
        Fonte("camara", "inventada")
    with pytest.raises(ValueError):
        Comando("x", Classe.COLETOR, "cli.py", "cli", (), (), None)
    with pytest.raises(ValueError):
        Comando("x", Classe.CHECAGEM, "cli.py", "cli", (), (), "algum")
    with pytest.raises(ValueError):
        Comando("x", Classe.CHECAGEM, "cli.py", "outro", (), (), None)
    with pytest.raises(ValueError):
        Comando("x", Classe.CHECAGEM, "cli.py", "cli", ("force",), (), None)
    _coletor_valido()  # a base passa
    for mudanca in (
        {"territorio": "mundo"}, {"env": "chave_minuscula"}, {"modos": {"descobrir": Modo(True)}}, {"acesso": ("ftp",)}, {"acesso": ()},
        {"comandos": ()}, {"fontes": ()}, {"datasets": ()}, {"recortes_nao_aceitos": ("ano", "uf", "casa")},  # falta declarar ibge
        {"recortes_aceitos": ("ano",)},  # ano aceito e não aceito
        {"caracterizado": "sim"}, {"tentativas_registradas": None}, {"orquestradores": "etl.yml"},
    ):
        with pytest.raises(ValueError):
            _coletor_valido(**mudanca)


# ---------------------------------------------------------------- recorte


def test_recorte_normaliza_e_valida():
    r = Recorte(anos=[2025, 2025, 2024], ufs=["sp"], ibges=["3550308"], extras={"escopo": "todas"})
    assert r.anos == (2025, 2024) and r.ufs == ("SP",) and r.extras["escopo"] == "todas"
    with pytest.raises(TypeError):
        r.extras["x"] = "y"  # type: ignore[index]
    for ruim in ({"anos": (1800,)}, {"ufs": ("SPP",)}, {"ibges": ("355030",)}, {"ibges": (3550308,)}, {"modo": "voar"}, {"extras": {"a": 1}}):
        with pytest.raises(ValueError):
            Recorte(**ruim)


# ---------------------------------------------------------------- descrever


def test_descrever_camara_equipe():
    d = descrever("camara.equipe", hoje=HOJE)
    assert d.argv == ["camara.equipe"] and d.comando == "camara.equipe" and d.nao_suportado == ""
    assert d.urls_entrada == ("https://dadosabertos.camara.leg.br/arquivos/funcionarios/csv/funcionarios.csv",)
    assert d.entradas_tipo == "estaticas" and d.estimativa is False
    # reprocessar: mesmo argv; a observação deixa a questão do modo sem rede à vista
    r = descrever("camara.equipe", Recorte(modo="reprocessar"))
    assert r.argv == d.argv and r.nao_suportado == "" and "ETL_HTTP_OFFLINE" in r.observacao


@pytest.mark.parametrize("recorte,fala", [
    (Recorte(ufs=("SP",)), "'uf'"), (Recorte(anos=(2025,)), "'ano'"), (Recorte(casas=("camara",)), "'casa'"), (Recorte(ibges=("3550308",)), "'ibge'"),
    (Recorte(extras={"escopo": "todas"}), "'escopo'"),
])
def test_camara_equipe_recorte_nao_aceito(recorte, fala):
    d = descrever("camara.equipe", recorte)
    assert fala in d.nao_suportado and d.argv == [] and d.urls_entrada == ()


def test_camara_equipe_modo_descobrir_nao_suportado_com_o_motivo_do_catalogo():
    d = descrever("camara.equipe", Recorte(modo="descobrir"))
    assert coletor("camara.equipe").modos["descobrir"].motivo in d.nao_suportado


def test_descrever_camara_noturna_anos_vem_da_data():
    d = descrever("camara.noturna", hoje=date(2026, 11, 15))  # 12/11 a 15/11: só 2026
    assert d.argv == ["camara.noturna"] and len(d.urls_entrada) == 4 and all("2026" in u for u in d.urls_entrada)
    assert d.estimativa is False and d.entradas_tipo == "estaticas"
    virada = descrever("camara.noturna", hoje=date(2026, 1, 2))  # 30/12/2025 a 02/01/2026
    assert len(virada.urls_entrada) == 8 and any("votacoes-2025.csv" in u for u in virada.urls_entrada) and any("votacoes-2026.csv" in u for u in virada.urls_entrada)
    assert "ano" in descrever("camara.noturna", Recorte(anos=(2025,))).nao_suportado
    assert "fonte única" in descrever("camara.noturna", Recorte(modo="descobrir")).nao_suportado


def test_descrever_camara_diario():
    padrao = descrever("camara.diario", hoje=HOJE)
    assert padrao.argv == ["camara.diario"]  # sem --year: o padrão [ano-1, ano] é da CLI
    assert padrao.estimativa is True and padrao.entradas_tipo == "dinamicas"
    esperado = {f"https://dadosabertos.camara.leg.br/arquivos/votacoes/csv/votacoes-{a}.csv" for a in (2025, 2026)}
    assert esperado <= set(padrao.urls_entrada)
    assert "https://www.camara.leg.br/cotas/Ano-2025.csv.zip" in padrao.urls_entrada
    assert not any("{" in u for u in padrao.urls_entrada)
    assert "{leg}" in padrao.observacao and "deputados.csv" in padrao.observacao
    d = descrever("camara.diario", Recorte(anos=(2025, 2024)), hoje=HOJE)
    assert d.argv == ["camara.diario", "--year", "2025", "--year", "2024"]
    assert all(("2025" in u or "2024" in u) and "2026" not in u for u in d.urls_entrada if "csv" in u or "zip" in u)
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("x",)), Recorte(extras={"limit": "5"})):
        assert descrever("camara.diario", ruim).nao_suportado
    assert descrever("camara.diario", Recorte(modo="reprocessar")).argv == ["camara.diario"]


def test_camara_diario_com_conn_acrescenta_detalhe_dos_deputados_do_banco():
    conn = ConnFalsa({"person_external_ids": [{"external_id": "204554"}, {"external_id": "160976"}]})
    d = descrever("camara.diario", conn=conn, hoje=HOJE)
    assert "https://dadosabertos.camara.leg.br/api/v2/deputados/204554" in d.urls_entrada
    assert "mandato aberto no banco" in d.observacao and len(conn.sqls) == 1 and conn.sqls[0].lstrip().lower().startswith("select")


def test_descrever_sapl_camaras_comandos_e_argv():
    d = descrever("sapl.camaras", Recorte(modo="descobrir", ibges=("3550308", "3304557")))
    assert d.comando == "sapl.descobrir" and d.argv == ["sapl.descobrir", "--ibge", "3550308", "--ibge", "3304557"]
    assert d.estimativa is True and d.entradas_tipo == "dinamicas" and d.urls_entrada == ("https://www12.senado.leg.br/interlegis/orgaosatendidos",)
    c = descrever("sapl.camaras", Recorte(ibges=("3550308",)))
    assert c.comando == "sapl.carregar" and c.argv == ["sapl.carregar", "--ibge", "3550308"] and c.urls_entrada == ()
    assert "sapl_houses" in c.observacao
    assert descrever("sapl.camaras").argv == ["sapl.carregar"]  # escopo padrão da CLI: capitais
    t = descrever("sapl.camaras", Recorte(extras={"escopo": "todas"}))
    assert t.argv == ["sapl.carregar", "--escopo", "todas"] and t.nao_suportado == ""
    assert descrever("sapl.camaras", Recorte(modo="descobrir", extras={"escopo": "capitais"})).argv == ["sapl.descobrir", "--escopo", "capitais"]


def test_sapl_camaras_nao_suportados():
    r = descrever("sapl.camaras", Recorte(modo="reprocessar"))
    assert coletor("sapl.camaras").modos["reprocessar"].motivo in r.nao_suportado and r.argv == []
    u = descrever("sapl.camaras", Recorte(ufs=("SP",)))
    assert "--uf" in u.nao_suportado and "sapl.ales" in u.nao_suportado  # o parser aceita e o comando ignora
    assert descrever("sapl.camaras", Recorte(anos=(2025,))).nao_suportado
    assert descrever("sapl.camaras", Recorte(casas=("camara",))).nao_suportado
    assert "inválido" in descrever("sapl.camaras", Recorte(extras={"escopo": "mundo"})).nao_suportado
    assert "ignorado" in descrever("sapl.camaras", Recorte(ibges=("3550308",), extras={"escopo": "todas"})).nao_suportado
    assert "'lote'" in descrever("sapl.camaras", Recorte(extras={"lote": "5"})).nao_suportado  # argumento próprio fora do contrato


def test_sapl_camaras_com_conn_concretiza_so_o_que_o_banco_sabe():
    conn = ConnFalsa({"from places": [{"ibge_code": "3550308", "name": "São Paulo", "uf": "SP"}]})
    d = descrever("sapl.camaras", Recorte(modo="descobrir", ibges=("3550308", "9999999")), conn=conn)
    assert d.urls_entrada == ("https://www12.senado.leg.br/interlegis/orgaosatendidos?uf=SP&municipio=S%C3%A3o%20Paulo",)
    assert "9999999" in d.observacao
    casas = ConnFalsa({"sapl_houses": [{"ibge_code": "3550308", "base_url": "https://sapl.sp.example", "status": "ok"},
                                       {"ibge_code": "3304557", "base_url": "https://sapl.rj.example", "status": "sem_api"}]})
    c = descrever("sapl.camaras", Recorte(ibges=("3550308", "3304557", "1100205")), conn=casas)
    assert c.urls_entrada == ("https://sapl.sp.example/api/parlamentares/legislatura/?page_size=100&page=1",)
    assert "3304557" in c.observacao and "1100205" in c.observacao and c.estimativa is True
    muitas = descrever("sapl.camaras", Recorte(ibges=tuple(f"{1100000 + i}" for i in range(11))))
    assert "no máximo 10" in muitas.observacao  # truncamento silencioso do sapl.carregar sem --max/--lote


def test_coletor_sem_adaptador_e_id_desconhecido(monkeypatch):
    monkeypatch.delitem(contrato.ADAPTADORES, "camara.equipe")
    assert descrever("camara.equipe").nao_suportado == "adaptador ainda não escrito"
    with pytest.raises(ValueError):
        executar("camara.equipe", runner=lambda a: 0)
    with pytest.raises(KeyError):
        descrever("id.inventado")  # integrado: tse.votos tem entrada; id sem entrada continua KeyError


def test_adaptadores_das_quatro_entradas_estao_registrados():
    assert set(QUATRO) <= set(contrato.ADAPTADORES)


# ---------------------------------------------------------------- sem rede


class _ClienteQueFalha:
    def __getattr__(self, nome):
        raise AssertionError(f"descrever tocou o cliente HTTP ({nome})")


def test_descrever_nao_faz_rede(monkeypatch):
    def sem_socket(*a, **k):
        raise AssertionError("descrever criou um socket")

    monkeypatch.setattr(H, "_client", _ClienteQueFalha())
    monkeypatch.setattr(socket, "socket", sem_socket)
    monkeypatch.setattr(socket, "create_connection", sem_socket)
    conn = ConnFalsa({"person_external_ids": [{"external_id": "1"}], "from places": [{"ibge_code": "3550308", "name": "São Paulo", "uf": "SP"}],
                      "sapl_houses": [{"ibge_code": "3550308", "base_url": "https://sapl.sp.example", "status": "ok"}]})
    pedidos = [
        ("camara.equipe", Recorte()), ("camara.equipe", Recorte(ufs=("SP",))), ("camara.noturna", Recorte()), ("camara.diario", Recorte(anos=(2024, 2025))),
        ("sapl.camaras", Recorte(modo="descobrir", ibges=("3550308",))), ("sapl.camaras", Recorte(ibges=("3550308",))), ("sapl.camaras", Recorte(modo="reprocessar")),
    ]
    for cid, rec in pedidos:
        descrever(cid, rec, hoje=HOJE)
        descrever(cid, rec, conn=conn, hoje=HOJE)
    with pytest.raises(AssertionError):  # o cerco funciona: tocar o cliente falha
        H.client().get("https://example.invalid")


# ---------------------------------------------------------------- executar


def test_executar_entrega_ao_runner_o_mesmo_argv_de_descrever():
    visto: list[list[str]] = []

    def runner(argv):
        visto.append(argv)
        return 7

    casos = [("camara.equipe", Recorte()), ("camara.noturna", Recorte()), ("camara.diario", Recorte(anos=(2025,))),
             ("sapl.camaras", Recorte(modo="descobrir", ibges=("3550308",))), ("sapl.camaras", Recorte(extras={"escopo": "todas"}))]
    for cid, rec in casos:
        assert executar(cid, rec, runner=runner) == 7
        assert visto[-1] == descrever(cid, rec).argv
    assert len(visto) == len(casos)


def test_executar_recusa_o_nao_suportado_sem_chamar_o_runner():
    chamadas: list[list[str]] = []
    for cid, rec in [("camara.equipe", Recorte(ufs=("SP",))), ("sapl.camaras", Recorte(modo="reprocessar")), ("camara.diario", Recorte(ibges=("3550308",)))]:
        with pytest.raises(ValueError):
            executar(cid, rec, runner=lambda a: chamadas.append(a) or 0)
    assert chamadas == []


def test_runner_padrao_e_o_main_da_cli_e_systemexit_vira_codigo(monkeypatch):
    import civico_etl.cli as cli

    visto: list[list[str]] = []
    monkeypatch.setattr(cli, "main", lambda argv=None: visto.append(argv) or 0)
    assert executar("camara.equipe") == 0 and visto == [["camara.equipe"]]

    def sai(argv=None):
        raise SystemExit(2)

    monkeypatch.setattr(cli, "main", sai)
    assert executar("camara.equipe") == 2


def test_runner_em_processo_traduz_systemexit_e_imprime_a_mensagem_em_stderr(monkeypatch, capsys):
    """Como o interpretador num processo real: SystemExit("texto") sai com código 1 e o texto em stderr; SystemExit(n) devolve n; SystemExit(None), 0."""
    from civico_etl import cli

    def main_que_sai(valor):
        def main(argv=None):
            raise SystemExit(valor)

        return main

    msg = "outro run de camara.equipe em andamento (advisory lock)"
    monkeypatch.setattr(cli, "main", main_que_sai(msg))
    capsys.readouterr()
    assert executar("camara.equipe") == 1
    saida = capsys.readouterr()
    assert msg in saida.err and saida.out == ""
    monkeypatch.setattr(cli, "main", main_que_sai(3))
    assert executar("camara.equipe") == 3
    assert capsys.readouterr().err == ""
    monkeypatch.setattr(cli, "main", main_que_sai(None))
    assert executar("camara.equipe") == 0
    assert capsys.readouterr().err == ""


def test_runner_subprocesso_roda_a_cli_e_devolve_o_codigo():
    # --help e job inválido saem no argparse, antes de abrir o banco
    assert runner_subprocesso(["--help"], env={"ETL_LOG": "WARNING"}, timeout_s=120) == 0
    assert runner_subprocesso(["nao.existe"], timeout_s=120) == 2
    assert runner_subprocesso(["--help"], timeout_s=0.001) == 124
