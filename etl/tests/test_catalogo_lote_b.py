"""R8b: lote B do catálogo (senado.diario, senado.noturna, senado.secretas, agenda.congresso, pauta, parlamento.extras, camara.presenca).

Sem rede. O lote ainda não está ligado em `COLETORES`: os adaptadores são chamados direto (`ADAPTADORES[id](coletor, recorte, conn, hoje)`) e a recusa
pelo catálogo vem de `contrato._nao_suportado`. A única leitura de banco é a da fixture `conn` (somente SELECT).
"""

from __future__ import annotations

import ast
import json
import re
import socket
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from civico_etl import http as H
from civico_etl import schedule as S
from civico_etl.catalogo import ARQUIVOS, COLETORES, COLETORES_PENDENTES, COMANDOS, Classe, Coletor, Recorte, comando
from civico_etl.catalogo import adaptadores_b, contrato
from civico_etl.catalogo.adaptadores_b import _janelas_agenda, _meses
from civico_etl.catalogo.coletores_b import COLETORES_B
from civico_etl.catalogo.modelo import MODOS

ETL = Path(__file__).resolve().parents[1]
PKG = ETL / "civico_etl"
HOJE = date(2026, 11, 15)
IDS = ("senado.diario", "senado.noturna", "senado.secretas", "agenda.congresso", "pauta", "parlamento.extras", "camara.presenca")
POR_ID = {c.id: c for c in COLETORES_B}
# comando -> (módulos que o catálogo declara). Arquivo de cada módulo conferido em ARQUIVOS (classe COLETOR).
MODULOS_DOS_JOBS = {"senado.diario": ("jobs/senado_diario.py", "jobs/senado_extras.py"), "senado.noturna": ("jobs/senado_diario.py",),
                    "senado.secretas": ("jobs/senado_diario.py",), "agenda.congresso": ("jobs/agenda_congresso.py",), "pauta": ("jobs/pauta.py",),
                    "parlamento.extras": ("jobs/parlamento_extras.py",), "camara.presenca": ("jobs/camara_presenca.py",)}


def plano(cid: str, recorte: Recorte | None = None, conn=None, hoje: date | None = HOJE):
    """Chama o adaptador direto: (comando, argv, urls, estimativa, observacao, nao_suportado)."""
    return contrato.ADAPTADORES[cid](POR_ID[cid], recorte or Recorte(), conn, hoje)


def recusa(cid: str, recorte: Recorte) -> str:
    """Motivo da recusa pelo catálogo (modo ou recorte não aceito) ou, se o catálogo aceita, pelo próprio adaptador."""
    return contrato._nao_suportado(POR_ID[cid], recorte) or plano(cid, recorte)[5]


def _fonte(arquivo: str) -> str:
    return (PKG / arquivo).read_text(encoding="utf-8")


def _constante(arquivo: str, nome: str):
    """Valor literal de uma constante de módulo, lido por AST (sem importar o job)."""
    for n in ast.parse(_fonte(arquivo)).body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            return ast.literal_eval(n.value)
    raise AssertionError(f"{nome} não encontrado em {arquivo}")


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class ConnFalsa:
    """Dublê de conexão só de leitura: devolve as linhas da primeira chave que aparece no SQL e recusa qualquer escrita."""

    def __init__(self, respostas: dict[str, list[dict]]):
        self.respostas = respostas
        self.sqls: list[str] = []

    def execute(self, sql, params=None):
        self.sqls.append(" ".join(sql.split()))
        assert sql.lstrip().lower().startswith("select"), f"escrita no banco: {sql[:80]}"
        for chave, rows in self.respostas.items():
            if chave in sql:
                return _Res(rows)
        raise AssertionError(f"consulta inesperada: {sql[:120]}")


# ---------------------------------------------------------------- forma e validação do modelo


def test_sete_entradas_passam_na_validacao_do_modelo():
    assert tuple(c.id for c in COLETORES_B) == IDS
    for c in COLETORES_B:
        assert isinstance(c, Coletor) and set(c.modos) == set(MODOS)
    # a validação roda no __post_init__: reconstruir a partir dos campos falha se algum valor estiver fora do modelo
    for c in COLETORES_B:
        Coletor(**{f: getattr(c, f) for f in Coletor.__dataclass_fields__})
    for c in COLETORES_B:
        for m in c.modulos:
            assert (PKG / m).is_file(), f"{c.id}: {m}"
            assert ARQUIVOS[m] is Classe.COLETOR
        assert c.modulos == MODULOS_DOS_JOBS[c.id]


def test_ids_comandos_e_tarefas_nao_colidem_com_o_catalogo_atual_nem_entre_si():
    # antes da integração o lote não está em COLETORES; depois dela, as entradas de lá têm de ser exatamente as daqui
    for c in COLETORES:
        if c.id in IDS:
            assert c == POR_ID[c.id]
    outros = [c for c in COLETORES if c.id not in IDS]
    comandos = [n for c in COLETORES_B for n in c.comandos]
    tarefas = [t for c in COLETORES_B for t in c.tarefas]
    assert len(set(comandos)) == len(comandos) and len(set(tarefas)) == len(tarefas)
    assert not {n for c in outros for n in c.comandos} & set(comandos)
    assert not {t for c in outros for t in c.tarefas} & set(tarefas)
    assert set(IDS) <= COLETORES_PENDENTES | {c.id for c in COLETORES}  # hoje pendentes; depois da integração passam a ter entrada


def test_comandos_batem_com_comandos_py():
    for c in COLETORES_B:
        assert c.comandos == (c.id,)  # neste lote o id é o nome do comando
        for n in c.comandos:
            cmd = comando(n)
            assert cmd.classe is Classe.COLETOR and cmd.coletor == c.id
            assert cmd.encadeia == c.encadeados, f"{c.id}/{n}"
            assert cmd.modulo in c.modulos
    assert {c.nome for c in COMANDOS if c.coletor in IDS} == set(IDS)
    assert POR_ID["senado.diario"].encadeados == ("identity.dedupe", "derive.stats")
    assert POR_ID["parlamento.extras"].encadeados == POR_ID["camara.presenca"].encadeados == ("derive.stats",)
    for cid in ("senado.noturna", "senado.secretas", "agenda.congresso", "pauta"):
        assert POR_ID[cid].encadeados == ()


def test_encadeamento_e_argumentos_conferem_com_a_cli_por_ast():
    """cli.py: o bloco de cada job lê só os argumentos declarados e as condições de dedupe/derive citam exatamente os comandos esperados."""
    src = _fonte("cli.py")
    tree = ast.parse(src)
    lidos: dict[str, set[str]] = {}
    for n in ast.walk(tree):
        if not (isinstance(n, ast.If) and isinstance(n.test, ast.Compare)):
            continue
        t = n.test
        nomes = set()
        if isinstance(t.left, ast.Attribute) and t.left.attr == "job" and t.comparators:
            comp = t.comparators[0]
            if isinstance(comp, ast.Constant):
                nomes = {comp.value}
            elif isinstance(comp, ast.Tuple):
                nomes = {e.value for e in comp.elts if isinstance(e, ast.Constant)}
        if len(nomes) == 0 or "all" in nomes and len(nomes) == 1:
            continue
        attrs = {a.attr for a in ast.walk(ast.Module(body=n.body, type_ignores=[])) if isinstance(a, ast.Attribute) and isinstance(a.value, ast.Name) and a.value.id == "a"}
        for nome in nomes:
            lidos.setdefault(nome, set()).update(attrs)
    flag = {"year": "--year", "limit": "--limit", "force": "--force"}
    for cid in IDS:
        esperado = set(comando(cid).argumentos)
        lido = {flag[a] for a in lidos.get(cid, set()) if a in flag}
        assert lido == esperado, f"{cid}: o bloco da CLI lê {lido}, comandos.py declara {esperado}"
    # cli.py:214 (identity.dedupe) e :218 (derive.stats)
    dedupe = re.search(r'if a\.job in \("identity\.dedupe", "all", ([^)]*)\):', src)
    assert dedupe and {x.strip().strip('"') for x in dedupe.group(1).split(",")} == {"camara.diario", "senado.diario"}
    derive = re.search(r'or a\.job in \(([^)]*)\):\s*\n\s*from \.jobs\.derive_stats', src)
    derivam = {x.strip().strip('"') for x in derive.group(1).split(",")}
    assert {"senado.diario", "camara.presenca", "parlamento.extras"} <= derivam
    assert not derivam & {"senado.noturna", "senado.secretas", "agenda.congresso", "pauta"}


def test_cada_tarefa_citada_existe_e_confere_com_o_comando():
    tarefas = {t.name: t for t in S.TASKS}
    for c in COLETORES_B:
        for tn in c.tarefas:
            assert tn in tarefas, f"{tn} fora de schedule.TASKS"
            t = tarefas[tn]
            argv = t.argv(HOJE)
            assert argv[0] in c.comandos and argv[0] == tn
            assert t.needs_env == c.env
            if t.source:
                assert t.source in {f.slug for f in c.fontes}
            flags = {a for a in argv[1:] if a.startswith("--")}
            assert flags <= set(comando(argv[0]).argumentos), f"{tn}: {flags - set(comando(argv[0]).argumentos)}"
            # prefixos de dataset da tarefa = prefixos literais dos datasets do coletor
            prefixos = {d.split("{")[0] for d in c.datasets}
            for p in t.families(HOJE):
                assert any(x.startswith(p) or p.startswith(x) for x in prefixos), f"{tn}: prefixo {p!r} sem dataset em {c.datasets}"
    assert [t for t in COLETORES_B if t.id == "pauta"][0].tarefas == ()
    assert not [t.name for t in S.TASKS if t.argv(HOJE)[0] == "pauta"]  # fora do run-due


def test_orquestradores_conferem_com_os_arquivos():
    raiz = ETL.parent
    etl_yml = (raiz / ".github/workflows/etl.yml").read_text(encoding="utf-8")
    pauta_yml = (raiz / ".github/workflows/etl-pauta.yml").read_text(encoding="utf-8")
    agendar = (raiz / "etl/agenda/agendar-local.sh").read_text(encoding="utf-8")
    run_due_local = (raiz / "etl/deploy/run-due-local.sh").read_text(encoding="utf-8")
    assert "run-due" in etl_yml and 'ETL_TASKS_EXCLUDE: "sapl.todas"' in etl_yml  # só tira o sapl.todas: as seis tarefas do lote rodam
    assert "civico_etl.cli run-due" in run_due_local and "ETL_TASKS" not in run_due_local  # sem filtro: roda todas as TASKS
    assert "civico-etl pauta" in pauta_yml and "civico-etl pauta" in agendar
    for c in COLETORES_B:
        if c.id == "pauta":
            assert c.orquestradores == ("etl-pauta.yml:pauta", "agendar-local.sh:pauta")
        else:
            assert c.orquestradores == ("etl.yml:run-due", "launchd-local:run-due")
            assert c.tarefas  # quem está no run-due tem tarefa
    lin = agendar.splitlines()[66]  # agendar-local.sh:67
    assert "write_plist pauta" in lin
    assert 'run: uv run --frozen civico-etl pauta' in pauta_yml.splitlines()[60]  # etl-pauta.yml:61


def test_datasets_e_fontes_conferem_com_as_chamadas_a_db_run():
    """Os datasets e as fontes do catálogo = o 2º e o 3º argumentos das chamadas `run(conn, dataset, fonte, ...)` dos módulos do job."""
    for c in COLETORES_B:
        achados_ds: set[str] = set()
        achados_fonte: set[str] = set()
        for m in c.modulos:
            for n in ast.walk(ast.parse(_fonte(m))):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "run" and len(n.args) >= 3:
                    ds, fonte = n.args[1], n.args[2]
                    if isinstance(ds, ast.Constant):
                        achados_ds.add(ds.value)
                    else:
                        achados_ds.add("".join(p.value if isinstance(p, ast.Constant) else "{}" for p in ds.values))
                    achados_fonte.add(fonte.value)
        # run_senado_noturna e run_secretas moram no mesmo arquivo de run_senado: cada coletor fica só com os seus datasets
        catalogo = {re.sub(r"\{[^}]*\}", "{}", d) for d in c.datasets}
        achados = {re.sub(r"\{[^}]*\}", "{}", d) for d in achados_ds}
        if c.id in ("senado.noturna", "senado.secretas"):
            assert catalogo <= achados, c.id
        elif c.id == "senado.diario":
            assert catalogo <= achados and achados - catalogo == {"senado.secretas.{}", "senado.noturna.{}"}, (achados - catalogo)
        else:
            assert achados == catalogo, (c.id, achados, catalogo)
        slugs = {f.slug for f in c.fontes}
        assert achados_fonte <= slugs, (c.id, achados_fonte, slugs)
        if c.id in ("agenda.congresso", "pauta"):
            assert achados_fonte == slugs == {"camara", "senado"}


def test_constantes_de_url_conferem_com_o_codigo():
    from civico_etl.catalogo import coletores_b as B

    assert B.SEN_API == _constante("jobs/senado_diario.py", "API") == _constante("jobs/senado_extras.py", "API") == _constante("jobs/agenda_congresso.py", "SENADO")
    assert B.SEN_API == _constante("jobs/pauta.py", "SENADO") == _constante("jobs/parlamento_extras.py", "SENADO")
    assert B.SEN_ADM == _constante("jobs/senado_extras.py", "ADM")
    assert B.CAM_API == _constante("jobs/agenda_congresso.py", "CAMARA") == _constante("jobs/pauta.py", "CAMARA") == _constante("jobs/camara_presenca.py", "API")
    assert B.CAM_API == _constante("jobs/parlamento_extras.py", "CAMARA")
    assert B.CAM_FILES == _constante("jobs/camara_presenca.py", "FILES")
    assert f"idOrgao={_constante('jobs/agenda_congresso.py', 'PLEN_CAMARA')}&" in B.URL_AGENDA_CAMARA
    assert adaptadores_b._JANELA_PAUTA_DIAS == _constante("jobs/pauta.py", "WINDOW_DAYS")
    assert re.search(r"def run_senado_noturna\(conn[^)]*days: int = %d\b" % adaptadores_b._JANELA_NOTURNA_DIAS, _fonte("jobs/senado_diario.py"))
    assert f"range({adaptadores_b._PRIMEIRO_ANO_SECRETAS}, today.year + 1)" in _fonte("cli.py")
    # as rotas montadas pelos jobs têm a forma das URLs do catálogo
    assert 'f"{API}/votacao?dataInicio={year}-01-01&dataFim={end.isoformat()}"' in _fonte("jobs/senado_diario.py")
    assert 'f"{API}/votacao?dataInicio={(since or date(year, 1, 1)).isoformat()}&dataFim={end.isoformat()}"' in _fonte("jobs/senado_diario.py")
    assert 'f"{ADM}/senadores/despesas_ceaps/{year}"' in _fonte("jobs/senado_extras.py")
    assert 'f"{SENADO}/plenario/agenda/mes/{m:%Y%m%d}.json"' in _fonte("jobs/agenda_congresso.py")
    assert 'f"{CAMARA}/eventos?idOrgao={PLEN_CAMARA}&dataInicio={a}&dataFim={b}&itens=100"' in _fonte("jobs/agenda_congresso.py")
    assert 'f"{CAMARA}/eventos?dataInicio={start}&dataFim={end}&itens=100&ordem=ASC&ordenarPor=dataHoraInicio"' in _fonte("jobs/pauta.py")
    assert 'f"{SENADO}/comissao/agenda/{start:%Y%m%d}/{end:%Y%m%d}.json"' in _fonte("jobs/pauta.py")
    for nome in ("eventos/csv/eventos", "eventosOrgaos/csv/eventosOrgaos", "eventosPresencaDeputados/csv/eventosPresencaDeputados"):
        assert f'f"{{FILES}}/{nome}-{{year}}.csv"' in _fonte("jobs/camara_presenca.py")
    assert 'f"{API}/deputados?idLegislatura={leg}&itens=100&ordem=ASC&ordenarPor=nome"' in _fonte("jobs/camara_presenca.py")


def test_delete_de_cada_coletor_esta_na_linha_citada_e_nao_ha_outros():
    def linha(arquivo: str, n: int) -> str:
        return _fonte(arquivo).splitlines()[n - 1]

    assert "delete from attendance" in linha("jobs/senado_extras.py", 33)
    assert "delete from agenda_items" in linha("jobs/agenda_congresso.py", 190)
    assert "delete from attendance" in linha("jobs/camara_presenca.py", 154)
    assert "delete from mandate_contacts" in linha("jobs/parlamento_extras.py", 125)
    for arq, n in (("jobs/senado_extras.py", 1), ("jobs/agenda_congresso.py", 1), ("jobs/camara_presenca.py", 1), ("jobs/parlamento_extras.py", 1),
                   ("jobs/senado_diario.py", 0), ("jobs/pauta.py", 0)):
        assert len(re.findall(r"delete from", _fonte(arq), flags=re.I)) == n, arq
    politica = {c.id: c.ausentes.politica for c in COLETORES_B}
    assert politica == {"senado.diario": "apaga", "senado.noturna": "nao_apaga", "senado.secretas": "nao_apaga", "agenda.congresso": "apaga_com_guarda",
                        "pauta": "nao_apaga", "parlamento.extras": "apaga_com_guarda", "camara.presenca": "apaga_com_guarda"}
    for cid, arq, n in (("senado.diario", "senado_extras.py", 33), ("agenda.congresso", "agenda_congresso.py", 190), ("camara.presenca", "camara_presenca.py", 154),
                        ("parlamento.extras", "parlamento_extras.py", 125)):
        citacoes = [(int(a), int(b or a)) for a, b in re.findall(rf"{re.escape(arq)}:(\d+)(?:-(\d+))?", POR_ID[cid].ausentes.guarda)]
        assert any(a <= n <= b for a, b in citacoes), (cid, citacoes)  # a linha do delete está numa das citações da guarda


def test_tentativas_registradas_conferem_com_o_fonte():
    for c in COLETORES_B:
        assert c.tentativas_registradas is True
        for m in c.modulos:
            src = _fonte(m)
            for proibido in ("api_json", "remotezip", "urllib", "requests", "subprocess", "client("):
                assert proibido not in src, f"{m}: usa {proibido}"
            for i, ln in enumerate(src.splitlines(), 1):
                if "httpx." in ln:
                    assert ln.lstrip().startswith("except") or "# noqa" in ln, f"{m}:{i}: httpx fora de except: {ln.strip()}"
            assert re.search(r"from \.\.http import [^\n]*(fetch|fetch_json|paginate_camara)", src), m


def test_caracterizado_so_onde_ha_teste_que_chama_o_job():
    assert {c.id for c in COLETORES_B if c.caracterizado} == {"parlamento.extras"}
    src = _fonte("../tests/test_caracterizacao.py")
    assert 'rodar_cli(["parlamento.extras", "--year", "2025"]' in src
    # nenhum teste existente chama o run_* dos outros seis (só funções puras)
    chamadas = ("run_senado(", "run_senado_noturna(", "run_secretas(", "run_agenda(", "run_pauta(", "run_presenca(")
    for t in sorted((ETL / "tests").glob("test_*.py")):
        if t.name.startswith("test_catalogo_"):
            continue
        texto = t.read_text(encoding="utf-8")
        for ch in chamadas:
            assert ch not in texto, f"{t.name} chama {ch}: marque caracterizado=True e cite o teste"
        for cid in ("senado.diario", "senado.noturna", "senado.secretas", "agenda.congresso", "camara.presenca"):
            assert f'rodar_cli(["{cid}"' not in texto
        assert 'rodar_cli(["pauta"' not in texto


def test_importar_os_modulos_do_lote_nao_importa_job_nem_cli():
    codigo = """
import json, sys
import civico_etl.http as H
antes_rate, antes_mods = H.RATE, set(sys.modules)
import civico_etl.catalogo.coletores_b, civico_etl.catalogo.adaptadores_b
novos = sorted(m for m in sys.modules if m not in antes_mods)
print(json.dumps({"rate_igual": H.RATE == antes_rate, "novos": novos}))
"""
    p = subprocess.run([sys.executable, "-c", codigo], cwd=ETL, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    assert r["rate_igual"]
    assert [m for m in r["novos"] if m.startswith("civico_etl.jobs") or m in ("civico_etl.cli", "civico_etl.schedule", "civico_etl.db")] == []
    assert "civico_etl.catalogo.adaptadores_b" in r["novos"]
    for n in ast.walk(ast.parse(_fonte("catalogo/adaptadores_b.py"))):
        if isinstance(n, ast.ImportFrom):
            assert "jobs" not in (n.module or "").split(".") and "cli" not in (n.module or "").split(".")
        if isinstance(n, ast.Name):
            assert not n.id.startswith("run_"), n.id


def test_modos_e_recortes_declarados():
    for c in COLETORES_B:
        assert c.modos["recoletar"].suporta
        assert not c.modos["descobrir"].suporta and c.modos["descobrir"].motivo
        assert set(c.recortes_aceitos) | set(c.recortes_nao_aceitos) >= {"ano", "uf", "casa", "ibge"}
    assert POR_ID["pauta"].modos["reprocessar"].suporta is False and POR_ID["pauta"].modos["reprocessar"].motivo
    assert all(POR_ID[i].modos["reprocessar"].suporta for i in IDS if i != "pauta")
    assert {i for i in IDS if "ano" in POR_ID[i].recortes_aceitos} == {"senado.diario", "senado.secretas", "agenda.congresso", "parlamento.extras", "camara.presenca"}
    assert POR_ID["senado.noturna"].entradas.tipo == POR_ID["senado.secretas"].entradas.tipo == "estaticas"
    assert {POR_ID[i].entradas.tipo for i in ("senado.diario", "agenda.congresso", "pauta", "parlamento.extras", "camara.presenca")} == {"dinamicas"}
    assert all(c.env is None and c.territorio == "pais" for c in COLETORES_B)


# ---------------------------------------------------------------- regras de data copiadas do job (conferidas contra o job)


def test_janela_e_meses_da_agenda_igualam_os_do_job():
    from civico_etl.jobs.agenda_congresso import months, window

    for dia in (date(2026, 11, 15), date(2026, 1, 15), date(2026, 12, 31), date(2026, 1, 31), date(2026, 3, 31), date(2024, 2, 29), date(2026, 10, 1)):
        for anos in ([], [2025], [2026, 2024]):
            assert _janelas_agenda(dia, anos) == window(dia, anos or None), (dia, anos)
    assert _meses(date(2025, 11, 1), date(2026, 2, 28)) == months(date(2025, 11, 1), date(2026, 2, 28))


# ---------------------------------------------------------------- adaptadores: argv e URLs


def test_legislaturas_do_ano_igualam_as_do_job():
    from civico_etl.jobs.camara_presenca import LEG_START, _legs_for_year

    assert adaptadores_b._INICIO_LEGISLATURA == LEG_START
    for ano in range(2015, 2036):
        assert adaptadores_b._legislaturas_do_ano(ano) == _legs_for_year(ano), ano
    janeiro = plano("camara.presenca", Recorte(anos=(2023,)))[2]
    assert [u.split("idLegislatura=")[1][:2] for u in janeiro if "idLegislatura" in u] == ["57", "56"]  # janeiro ainda é da legislatura anterior


def test_orquestradores_literais_igualam_os_de_coletores_py():
    from civico_etl.catalogo import coletores, coletores_b

    assert coletores_b._ORQ_ACTIONS == coletores._ORQ_ACTIONS and coletores_b._ORQ_LOCAL == coletores._ORQ_LOCAL


def test_adaptadores_do_lote_estao_registrados():
    assert set(IDS) <= set(contrato.ADAPTADORES)


def test_senado_diario():
    c, argv, urls, est, obs, nao = plano("senado.diario")
    assert (c, argv, nao) == ("senado.diario", ["senado.diario"], "") and est is True
    assert urls == ("https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json",
                    "https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2025-01-01&dataFim=2025-12-31",
                    "https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2026-01-01&dataFim=2026-11-15",
                    "https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025",
                    "https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2026")
    assert "anos padrão da CLI ([2025, 2026])" in obs and "{cod}" in obs
    um = plano("senado.diario", Recorte(anos=(2025,)))
    assert um[1] == ["senado.diario", "--year", "2025"] and len(um[2]) == 3 and not any("2026" in u for u in um[2])
    dois = plano("senado.diario", Recorte(anos=(2025, 2024)))
    assert dois[1] == ["senado.diario", "--year", "2025", "--year", "2024"] and any("despesas_ceaps/2024" in u for u in dois[2])
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("senado",)), Recorte(extras={"limit": "5"}), Recorte(modo="descobrir")):
        assert recusa("senado.diario", ruim)
    assert "'uf'" in recusa("senado.diario", Recorte(ufs=("SP",)))
    assert plano("senado.diario", Recorte(modo="reprocessar"))[1] == ["senado.diario"]


def test_senado_noturna():
    c, argv, urls, est, obs, nao = plano("senado.noturna")
    assert (c, argv, nao, est) == ("senado.noturna", ["senado.noturna"], "", False)
    assert urls == ("https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2026-11-12&dataFim=2026-11-15",)
    assert "Brasília" in obs
    virada = plano("senado.noturna", hoje=date(2026, 1, 2))
    assert virada[2] == ("https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2025-12-30&dataFim=2025-12-31",
                         "https://legis.senado.leg.br/dadosabertos/votacao?dataInicio=2026-01-01&dataFim=2026-01-02")
    assert plano("senado.noturna", Recorte(modo="reprocessar"))[1] == ["senado.noturna"]
    for ruim in (Recorte(anos=(2025,)), Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("senado",)), Recorte(modo="descobrir")):
        assert recusa("senado.noturna", ruim)
    assert "'ano'" in recusa("senado.noturna", Recorte(anos=(2025,)))


def test_senado_secretas():
    c, argv, urls, est, obs, nao = plano("senado.secretas")
    assert (c, argv, nao, est) == ("senado.secretas", ["senado.secretas"], "", False)
    assert len(urls) == 8 and urls[0].endswith("dataInicio=2019-01-01&dataFim=2019-12-31") and urls[-1].endswith("dataInicio=2026-01-01&dataFim=2026-11-15")
    assert "2019..2026" in obs and "--year 2026" in obs  # padrão da CLI x o que a tarefa roda
    um = plano("senado.secretas", Recorte(anos=(2026,)))
    assert um[1] == ["senado.secretas", "--year", "2026"] and len(um[2]) == 1
    dois = plano("senado.secretas", Recorte(anos=(2025, 2026)))
    assert dois[1] == ["senado.secretas", "--year", "2025", "--year", "2026"] and len(dois[2]) == 2
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("senado",)), Recorte(modo="descobrir")):
        assert recusa("senado.secretas", ruim)


def test_agenda_congresso():
    c, argv, urls, est, obs, nao = plano("agenda.congresso")
    assert (c, argv, nao, est) == ("agenda.congresso", ["agenda.congresso"], "", True)
    assert urls == ("https://dadosabertos.camara.leg.br/api/v2/eventos?idOrgao=180&dataInicio=2026-10-01&dataFim=2026-12-31&itens=100",
                    "https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261001.json",
                    "https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261101.json",
                    "https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261201.json")
    assert "2026-10-01 a 2026-12-31" in obs
    um = plano("agenda.congresso", Recorte(anos=(2025,)))
    assert um[1] == ["agenda.congresso", "--year", "2025"] and len(um[2]) == 1 + 12 and um[2][0].endswith("dataInicio=2025-01-01&dataFim=2025-12-31&itens=100")
    dois = plano("agenda.congresso", Recorte(anos=(2025, 2026)))
    assert dois[1] == ["agenda.congresso", "--year", "2025", "--year", "2026"] and len(dois[2]) == 2 * 13
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("camara",)), Recorte(modo="descobrir")):
        assert recusa("agenda.congresso", ruim)


def test_pauta():
    c, argv, urls, est, obs, nao = plano("pauta")
    assert (c, argv, nao, est) == ("pauta", ["pauta"], "", True)
    assert urls == ("https://dadosabertos.camara.leg.br/api/v2/eventos?dataInicio=2026-11-15&dataFim=2026-11-29&itens=100&ordem=ASC&ordenarPor=dataHoraInicio",
                    "https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261101.json",
                    "https://legis.senado.leg.br/dadosabertos/comissao/agenda/20261115/20261129.json")
    assert "run-due" in obs
    virada = plano("pauta", hoje=date(2026, 11, 25))  # a janela cruza o mês
    assert [u for u in virada[2] if "agenda/mes" in u] == ["https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261101.json",
                                                           "https://legis.senado.leg.br/dadosabertos/plenario/agenda/mes/20261201.json"]
    for ruim in (Recorte(anos=(2025,)), Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("camara",)), Recorte(modo="descobrir"), Recorte(modo="reprocessar")):
        assert recusa("pauta", ruim)
    assert "reprocessar" in recusa("pauta", Recorte(modo="reprocessar")) and POR_ID["pauta"].modos["reprocessar"].motivo in recusa("pauta", Recorte(modo="reprocessar"))


def test_parlamento_extras():
    c, argv, urls, est, obs, nao = plano("parlamento.extras")
    assert (c, argv, nao, est) == ("parlamento.extras", ["parlamento.extras"], "", True)
    assert urls == ("https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json",) and "1/1/2025" in obs
    um = plano("parlamento.extras", Recorte(anos=(2025,)))
    assert um[1] == ["parlamento.extras", "--year", "2025"] and um[5] == ""
    # só o MENOR --year vale (cli.py:213): 2 ou mais anos são recusados pelo adaptador, não pelo catálogo (ano é aceito)
    assert contrato._nao_suportado(POR_ID["parlamento.extras"], Recorte(anos=(2025, 2024))) == ""
    dois = plano("parlamento.extras", Recorte(anos=(2025, 2024)))
    assert dois[1] == [] and dois[2] == () and "menor" in dois[5] and "cli.py:213" in dois[5] and "2024" in dois[5]
    assert plano("parlamento.extras", Recorte(anos=(2023, 2024, 2025)))[5]
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("senado",)), Recorte(modo="descobrir")):
        assert recusa("parlamento.extras", ruim)


def test_camara_presenca():
    c, argv, urls, est, obs, nao = plano("camara.presenca")
    assert (c, argv, nao, est) == ("camara.presenca", ["camara.presenca"], "", True)
    base = "https://dadosabertos.camara.leg.br/arquivos"
    csv = tuple(f"{base}/{d}/csv/{d}-{a}.csv" for d in ("eventos", "eventosOrgaos", "eventosPresencaDeputados") for a in (2025, 2026))
    assert urls == (*csv, "https://dadosabertos.camara.leg.br/api/v2/deputados?idLegislatura=57&itens=100&ordem=ASC&ordenarPor=nome")
    assert "legislaturas [57]" in obs and "anos padrão da CLI ([2025, 2026])" in obs and not any("{" in u for u in urls)
    um = plano("camara.presenca", Recorte(anos=(2025,)))
    assert um[1] == ["camara.presenca", "--year", "2025"] and len(um[2]) == 3 + 1
    dois = plano("camara.presenca", Recorte(anos=(2025, 2024)))
    assert dois[1] == ["camara.presenca", "--year", "2025", "--year", "2024"] and len(dois[2]) == 6 + 1
    for ruim in (Recorte(ufs=("SP",)), Recorte(ibges=("3550308",)), Recorte(casas=("camara",)), Recorte(modo="descobrir")):
        assert recusa("camara.presenca", ruim)
    assert plano("camara.presenca", Recorte(modo="reprocessar"))[1] == ["camara.presenca"]


def test_argv_das_tarefas_e_o_do_adaptador_no_recorte_da_tarefa():
    tarefas = {t.name: t for t in S.TASKS}
    for cid in ("senado.diario", "senado.noturna", "agenda.congresso", "parlamento.extras", "camara.presenca"):
        assert plano(cid)[1] == tarefas[cid].argv(HOJE), cid
    assert tarefas["senado.secretas"].argv(HOJE) == plano("senado.secretas", Recorte(anos=(HOJE.year,)))[1]


def test_reprocessar_mantem_o_argv_de_recoletar_e_deixa_a_nota():
    for cid in IDS:
        if cid == "pauta":
            continue
        rec, rep = plano(cid), plano(cid, Recorte(modo="reprocessar"))
        assert rep[1] == rec[1] and rep[2] == rec[2] and "reprocessar" in rep[4] and "reprocessar" not in rec[4], cid


# ---------------------------------------------------------------- com conn (somente leitura)


def test_senado_diario_com_conn_concretiza_os_senadores_do_banco():
    conn = ConnFalsa({"person_external_ids": [{"external_id": "5012"}, {"external_id": "6331"}]})
    urls = plano("senado.diario", conn=conn)[2]
    assert "https://legis.senado.leg.br/dadosabertos/senador/5012.json" in urls and "https://legis.senado.leg.br/dadosabertos/senador/6331/autorias.json" in urls
    assert "https://legis.senado.leg.br/dadosabertos/senador/5012/filiacoes.json" in urls and len(urls) == 5 + 6
    assert "2 senadores com mandato em exercício" in plano("senado.diario", conn=conn)[4] and len(conn.sqls) == 2


def test_parlamento_extras_com_conn_concretiza_deputados_e_senadores():
    conn = ConnFalsa({"legislative_bodies": [{"kind": "camara_deputados", "external_id": "204554"}, {"kind": "senado", "external_id": "5012"}]})
    c, argv, urls, est, obs, nao = plano("parlamento.extras", Recorte(anos=(2025,)), conn=conn)
    assert argv == ["parlamento.extras", "--year", "2025"] and est is True
    assert urls == ("https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json",
                    "https://dadosabertos.camara.leg.br/api/v2/deputados/204554",
                    "https://dadosabertos.camara.leg.br/api/v2/deputados/204554/orgaos?dataInicio=2025-01-01&itens=100",
                    "https://dadosabertos.camara.leg.br/api/v2/deputados/204554/discursos?dataInicio=2025-01-01&dataFim=2026-11-15&itens=100&ordenarPor=dataHoraInicio&ordem=DESC",
                    "https://legis.senado.leg.br/dadosabertos/senador/5012/comissoes.json",
                    "https://legis.senado.leg.br/dadosabertos/senador/5012/discursos.json?dataInicio=20250101&dataFim=20261115")
    assert "1 deputados e 1 senadores" in obs
    so_deputado = plano("parlamento.extras", conn=ConnFalsa({"legislative_bodies": [{"kind": "camara_deputados", "external_id": "1"}]}))[2]
    assert not any("senado" in u for u in so_deputado) and "dataInicio=2025-01-01" in so_deputado[1]  # sem senador, a lista do Senado não é lida


def test_adaptadores_leem_o_banco_de_verdade_so_com_select(conn):
    """Valida o SQL dos adaptadores contra o esquema real (banco da suíte), só com SELECT, sem concluir nada sobre o conteúdo."""
    for cid, rec in (("senado.diario", Recorte()), ("parlamento.extras", Recorte(anos=(2025,))), ("camara.presenca", Recorte())):
        c, argv, urls, est, obs, nao = plano(cid, rec, conn=conn)
        assert argv[0] == cid and nao == "" and isinstance(urls, tuple) and all(isinstance(u, str) and u for u in urls)
    assert conn.execute("select count(*) as n from mandates").fetchone()["n"] >= 0  # a conexão da fixture continua utilizável


# ---------------------------------------------------------------- sem rede


class _ClienteQueFalha:
    def __getattr__(self, nome):
        raise AssertionError(f"o adaptador tocou o cliente HTTP ({nome})")


def test_adaptadores_nao_fazem_rede(monkeypatch):
    def sem_socket(*a, **k):
        raise AssertionError("o adaptador criou um socket")

    monkeypatch.setattr(H, "_client", _ClienteQueFalha())
    monkeypatch.setattr(socket, "socket", sem_socket)
    monkeypatch.setattr(socket, "create_connection", sem_socket)
    conn = ConnFalsa({"legislative_bodies": [{"kind": "camara_deputados", "external_id": "2"}, {"kind": "senado", "external_id": "3"}],
                      "person_external_ids": [{"external_id": "1"}]})  # a consulta do parlamento.extras também cita person_external_ids: a chave mais específica vem primeiro
    recortes = (Recorte(), Recorte(anos=(2025,)), Recorte(anos=(2025, 2024)), Recorte(modo="reprocessar"), Recorte(ufs=("SP",)), Recorte(modo="descobrir"))
    for cid in IDS:
        for rec in recortes:
            plano(cid, rec)
            plano(cid, rec, conn=conn)
            plano(cid, rec, hoje=None)
            contrato._nao_suportado(POR_ID[cid], rec)
    assert all(s.lstrip().lower().startswith("select") for s in conn.sqls)
    with pytest.raises(AssertionError):  # o cerco funciona: tocar o cliente falha
        H.client().get("https://example.invalid")


def test_camara_presenca_com_modelo_de_url_nao_expandido_levanta_runtimeerror_e_nao_assert():
    """Era `assert not pendentes` (some com `python -O`). Um modelo com placeholder que o adaptador não expande tem de falhar sempre, nomeando o coletor."""
    import dataclasses

    from civico_etl.catalogo import Entradas

    c = POR_ID["camara.presenca"]
    ruim = dataclasses.replace(c, entradas=Entradas(c.entradas.tipo, urls=(*c.entradas.urls, "https://exemplo.invalid/{xyz}/{ano}.csv"), depende_de=c.entradas.depende_de))
    with pytest.raises(RuntimeError, match=r"camara\.presenca.*\{xyz\}"):
        contrato.ADAPTADORES["camara.presenca"](ruim, Recorte(), None, HOJE)
