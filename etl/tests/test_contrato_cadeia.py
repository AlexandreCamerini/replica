"""R-7: efeitos encadeados preservados pelo contrato do catálogo.

Critério: "executar `camara.diario` e `senado.diario` pelo contrato do catálogo roda os mesmos passos seguintes que a CLI roda hoje
(`identity.dedupe`, `derive.stats`), e uma entrada inalterada interrompe a cadeia do mesmo jeito."

Método: toda função `run_*` que `cli.main` (e `ale_cli.main`) importa dentro do despacho é trocada por um gravador que só registra o passo e
os kwargs (sem banco, sem rede); `db.connect` vira um dublê. Cada comando roda por dois caminhos, (i) `civico_etl.cli.main([comando])` e
(ii) `catalogo.executar(coletor, Recorte())` com o runner padrão (em processo), e as sequências têm de ser iguais entre si e iguais a
`[passo do comando] + Comando.encadeia`.

Entrada inalterada: o critério supõe que `SkipUnchanged` interrompe a cadeia. Na CLI de hoje isso só acontece se a exceção ESCAPAR do job.
Todo `run_*` que passa `input_checksum` captura `SkipUnchanged` por dentro (db.run + `except`), então `camara.diario` com entrada inalterada
AINDA roda `identity.dedupe` e `derive.stats` (cenário a, o comportamento real: o job volta normalmente). O `except db.SkipUnchanged: pass` de
cli.py só atua se o job deixar a exceção sair, e aí nada do que viria depois roda e o código de saída é 0 (cenário b). Os dois cenários são
fixados aqui, pelos dois caminhos. A frase do critério descreve só o cenário b.

Fora do teste do parser principal: `sapl.*`, `sancoes.*` e `transparencia.emendas` têm main e parser próprios (despachados antes do argparse
principal, cli.py:51-67) e não encadeiam nada (Comando.encadeia vazio); os `ale.*` têm `ale_cli.main`, que encadeia `run_derive`, e são
cobertos à parte (cenário a só: `ale_cli` não captura SkipUnchanged, e os jobs `run_alesp`/`run_almg` não deixam a exceção sair).
"""

from __future__ import annotations

import ast
import importlib
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from civico_etl import db
from civico_etl import http as H
from civico_etl.catalogo import COMANDOS, Classe, Recorte, comando, contrato, descrever, executar, runner_subprocesso

PKG = Path(__file__).resolve().parents[1] / "civico_etl"

# módulo curto . função -> passo (nome do comando/passo que a função realiza)
PASSOS = {
    "seed.run_seed": "seed",
    "ibge_places.run_places": "ibge.places",
    "ibge_populacao.run_populacao": "ibge.populacao",
    "ibge_malhas.run_malhas": "ibge.malhas",
    "tse_candidatos.run_tse": "tse.candidatos",
    "tse_votos_contas.run_votes": "tse.votos",
    "tse_votos_contas.run_finance": "tse.contas",
    "tse_bug019.run_fix": "tse.fix019",
    "tse_bug032.run_fix": "tse.fix032",
    "identity_bug033.run_fix": "identity.fix033",
    "identity_bug033.run_restore": "identity.fix033.devolver",
    "tse_bug035.run_fix": "tse.fix035",
    "identity_bug038.run_fix": "identity.fix038",
    "identity_bug041.run_fix": "identity.fix041",
    "repairs.run_identity_repairs": "identity.repairs",
    "camara_diario.run_camara": "camara.diario",
    "camara_diario.run_camara_noturna": "camara.noturna",
    "camara_presenca.run_presenca": "camara.presenca",
    "camara_equipe.run_equipe": "camara.equipe",
    "senado_diario.run_senado": "senado.diario",
    "senado_diario.run_senado_noturna": "senado.noturna",
    "senado_diario.run_secretas": "senado.secretas",
    "agenda_congresso.run_agenda": "agenda.congresso",
    "parlamento_extras.run_extras": "parlamento.extras",
    "identity_dedupe.run_dedupe": "identity.dedupe",
    "derive_stats.run_derive": "derive.stats",
    "pauta.run_pauta": "pauta",
    "rascunho.run_rascunho": "rascunho",
    "revisar.run_revisar": "revisar",
    "verificar.run_verificar": "verificar",
    "governos_indicadores.run_governos": "governos.indicadores",
    "receita_arrecadacao.run_arrecadacao": "receita.arrecadacao",
    "checks.run_checks": "check",
    # ale_cli.main
    "alesp.run_alesp": "ale.sp",
    "almg.run_almg": "ale.mg",
    "assembleias.reword_unread_coverage": "assembleias.cobertura",
}

CLI = [c for c in COMANDOS if c.parser == "cli" and c.classe is Classe.COLETOR]
ALE = [c for c in COMANDOS if c.parser == "ale_cli" and c.classe is Classe.COLETOR]


# ---------------------------------------------------------------- gravador


def _importadas(arquivo: str, funcao: str) -> set[tuple[str, str]]:
    """(módulo curto, função) de cada `from .jobs.X import run_Y` (ou reword_unread_coverage) dentro de `funcao`, lido por AST."""
    arvore = ast.parse((PKG / arquivo).read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(arvore) if isinstance(n, ast.FunctionDef) and n.name == funcao)
    achadas: set[tuple[str, str]] = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.ImportFrom) and n.level >= 1 and n.module:
            curto = n.module.split(".")[-1]
            for a in n.names:
                if a.name.startswith("run_") or a.name == "reword_unread_coverage":
                    achadas.add((curto, a.name))
    return achadas


class Gravador:
    def __init__(self) -> None:
        self.passos: list[tuple[str, dict]] = []
        self.levantar: dict[str, BaseException] = {}  # passo -> exceção que o gravador levanta

    @property
    def nomes(self) -> list[str]:
        return [p for p, _ in self.passos]

    def zerar(self) -> None:
        self.passos.clear()


class ConexaoFalsa:
    fechada = 0

    def close(self) -> None:
        type(self).fechada += 1


@pytest.fixture
def grav(monkeypatch):
    # assembleias.py altera http.RATE no import (assembleias.py:39): o monkeypatch devolve o valor original no fim do teste
    monkeypatch.setattr(H, "RATE", H.RATE)
    g = Gravador()
    descobertas = _importadas("cli.py", "main") | _importadas("jobs/ale_cli.py", "main")
    chaves = {f"{m}.{f}" for m, f in descobertas}
    assert chaves == set(PASSOS), f"run_* do despacho sem passo mapeado: {sorted(chaves - set(PASSOS))}; mapeados que sumiram: {sorted(set(PASSOS) - chaves)}"
    for chave, passo in PASSOS.items():
        curto, func = chave.split(".")
        modulo = importlib.import_module(f"civico_etl.jobs.{curto}")

        def rec(*args, _passo=passo, **kwargs):
            g.passos.append((_passo, kwargs))
            if _passo in g.levantar:
                raise g.levantar[_passo]
            if _passo == "assembleias.cobertura":
                return 0
            if _passo in ("ale.sp", "ale.mg"):
                return []
            return None

        monkeypatch.setattr(modulo, func, rec)
    ConexaoFalsa.fechada = 0
    monkeypatch.setattr(db, "connect", lambda *a, **k: ConexaoFalsa())
    return g


def _passos_da_cadeia(cmd) -> list[str]:
    return [cmd.nome, *cmd.encadeia]


def _executar_pelo_contrato(cmd, recorte: Recorte | None = None) -> int:
    return executar(cmd.coletor, recorte or Recorte())


# ---------------------------------------------------------------- 2. mesma sequência pelos dois caminhos


@pytest.mark.parametrize("cmd", CLI, ids=lambda c: c.nome)
def test_cadeia_igual_pela_cli_e_pelo_contrato_e_igual_ao_catalogo(grav, cmd):
    from civico_etl.cli import main

    assert descrever(cmd.coletor, Recorte()).argv == [cmd.nome]  # sem recorte, o contrato monta o mesmo argv de `civico-etl <comando>`
    assert main([cmd.nome]) == 0
    pela_cli = list(grav.passos)
    grav.zerar()
    assert _executar_pelo_contrato(cmd) == 0
    pelo_contrato = list(grav.passos)
    assert [p for p, _ in pelo_contrato] == [p for p, _ in pela_cli]
    assert pelo_contrato == pela_cli  # inclui os kwargs que cada job recebeu
    assert grav.nomes == _passos_da_cadeia(cmd), f"{cmd.nome}: {grav.nomes} x catálogo {_passos_da_cadeia(cmd)}"
    assert ConexaoFalsa.fechada == 2  # uma conexão por execução, fechada no finally


def test_cadeias_pedidas_no_criterio(grav):
    esperado = {
        "camara.diario": ["camara.diario", "identity.dedupe", "derive.stats"],
        "senado.diario": ["senado.diario", "identity.dedupe", "derive.stats"],
        "ibge.populacao": ["ibge.populacao", "seed"],
        "tse.candidatos": ["tse.candidatos", "derive.stats"],
        "tse.votos": ["tse.votos", "derive.stats"],
        "tse.contas": ["tse.contas", "derive.stats"],
        "camara.presenca": ["camara.presenca", "derive.stats"],
        "parlamento.extras": ["parlamento.extras", "derive.stats"],
        # sem encadeamento: a agenda roda derive.stats depois (Task.derives=False nas noturnas), não a CLI
        "camara.noturna": ["camara.noturna"], "senado.noturna": ["senado.noturna"], "senado.secretas": ["senado.secretas"],
        "camara.equipe": ["camara.equipe"], "agenda.congresso": ["agenda.congresso"], "pauta": ["pauta"], "ibge.places": ["ibge.places"],
        "ibge.malhas": ["ibge.malhas"], "governos.indicadores": ["governos.indicadores"], "receita.arrecadacao": ["receita.arrecadacao"],
    }
    assert set(esperado) == {c.nome for c in CLI}  # nenhum comando do parser principal fica de fora
    for nome, cadeia in esperado.items():
        grav.zerar()
        assert _executar_pelo_contrato(comando(nome)) == 0
        assert grav.nomes == cadeia, nome


# ---------------------------------------------------------------- 3. entrada inalterada


@pytest.mark.parametrize("cmd", CLI, ids=lambda c: c.nome)
def test_entrada_inalterada_a_job_volta_normalmente_e_a_cadeia_roda_inteira(grav, cmd):
    """Cenário (a), o real: o job captura SkipUnchanged por dentro e volta; os passos seguintes rodam, pelos dois caminhos."""
    from civico_etl.cli import main

    assert main([cmd.nome]) == 0
    pela_cli = grav.nomes[:]
    grav.zerar()
    assert _executar_pelo_contrato(cmd) == 0
    assert grav.nomes == pela_cli == _passos_da_cadeia(cmd)


@pytest.mark.parametrize("cmd", CLI, ids=lambda c: c.nome)
def test_entrada_inalterada_b_skipunchanged_que_escapa_do_job_interrompe_a_cadeia(grav, cmd):
    """Cenário (b), a frase do critério: SkipUnchanged escapa do job; nada do que viria depois roda; saída 0; igual pelos dois caminhos."""
    from civico_etl.cli import main

    grav.levantar[cmd.nome] = db.SkipUnchanged("entrada inalterada")
    assert main([cmd.nome]) == 0
    pela_cli = list(grav.passos)
    grav.zerar()
    assert _executar_pelo_contrato(cmd) == 0
    assert list(grav.passos) == pela_cli
    assert grav.nomes == [cmd.nome]  # só o próprio job; nem identity.dedupe, nem derive.stats, nem seed
    assert ConexaoFalsa.fechada == 2  # o finally fecha a conexão mesmo na interrupção


def test_skipunchanged_no_meio_da_cadeia_interrompe_so_o_que_vem_depois(grav):
    """Se o que escapa é o identity.dedupe (2º passo de camara.diario), derive.stats não roda, igual pelos dois caminhos."""
    from civico_etl.cli import main

    grav.levantar["identity.dedupe"] = db.SkipUnchanged("x")
    assert main(["camara.diario"]) == 0
    pela_cli = grav.nomes[:]
    grav.zerar()
    assert _executar_pelo_contrato(comando("camara.diario")) == 0
    assert grav.nomes == pela_cli == ["camara.diario", "identity.dedupe"]


# ---------------------------------------------------------------- ale.* (ale_cli.main encadeia run_derive)


@pytest.mark.parametrize("cmd", ALE, ids=lambda c: c.nome)
def test_ale_cadeia_igual_pela_cli_e_pelo_contrato(grav, cmd):
    from civico_etl.cli import main

    ufs = {"ale.sp": ("SP",), "ale.mg": ("MG",), "ale.todas": ()}[cmd.nome]
    recorte = Recorte(ufs=ufs)
    assert descrever(cmd.coletor, recorte).argv == [cmd.nome]
    assert main([cmd.nome]) == 0
    pela_cli = list(grav.passos)
    grav.zerar()
    assert executar(cmd.coletor, recorte) == 0
    assert list(grav.passos) == pela_cli
    carga = {"ale.sp": ["ale.sp"], "ale.mg": ["ale.mg"], "ale.todas": ["ale.sp", "ale.mg"]}[cmd.nome]
    # run_alesp/run_almg, depois reword_unread_coverage (sempre), depois os passos de Comando.encadeia (derive.stats)
    assert grav.nomes == [*carga, "assembleias.cobertura", *cmd.encadeia] and cmd.encadeia == ("derive.stats",)


# ---------------------------------------------------------------- 4. executar nunca chama job direto


def test_executar_nunca_chama_funcao_de_job_nem_abre_conexao(grav, monkeypatch):
    recebidos: list[list[str]] = []

    def runner_falso(argv: list[str]) -> int:
        recebidos.append(list(argv))
        return 7

    def sem_conexao(*a, **k):
        raise AssertionError("executar abriu conexão")

    monkeypatch.setattr(db, "connect", sem_conexao)
    for cmd in CLI:
        assert executar(cmd.coletor, Recorte(), runner=runner_falso) == 7
    assert recebidos == [[c.nome] for c in CLI]
    assert grav.passos == []  # nenhum gravador (nenhum run_*) foi acionado


def test_executar_com_recorte_nao_suportado_levanta_antes_de_qualquer_runner(grav):
    with pytest.raises(ValueError):
        executar("camara.equipe", Recorte(anos=(2025,)), runner=lambda a: pytest.fail("runner chamado"))
    assert grav.passos == []


# ---------------------------------------------------------------- 5. runner_subprocesso: só a montagem do comando


def test_runner_subprocesso_monta_python_m_cli_argv_sem_executar(monkeypatch):
    chamadas: list[tuple[list[str], dict]] = []

    def run_falso(cmd, **kw):
        chamadas.append((list(cmd), kw))
        return SimpleNamespace(returncode=3)

    monkeypatch.setattr(contrato, "subprocess", SimpleNamespace(run=run_falso, TimeoutExpired=subprocess.TimeoutExpired))
    import sys

    argv = descrever("camara.diario", Recorte(anos=(2025,))).argv
    assert argv == ["camara.diario", "--year", "2025"]
    assert runner_subprocesso(argv, env={"ETL_LOG": "WARNING"}, timeout_s=9) == 3
    cmd, kw = chamadas[0]
    assert cmd == [sys.executable, "-m", "civico_etl.cli", "camara.diario", "--year", "2025"]
    assert kw["timeout"] == 9 and kw["check"] is False and kw["env"]["ETL_LOG"] == "WARNING"
    assert runner_subprocesso(["derive.stats"]) == 3 and chamadas[1][1]["env"] is None  # sem env: herda o do processo

    def estoura(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 1)

    monkeypatch.setattr(contrato, "subprocess", SimpleNamespace(run=estoura, TimeoutExpired=subprocess.TimeoutExpired))
    assert runner_subprocesso(["derive.stats"], timeout_s=1) == 124


def test_executar_com_runner_subprocesso_entrega_o_argv_do_contrato(monkeypatch):
    chamadas: list[list[str]] = []
    monkeypatch.setattr(contrato, "subprocess", SimpleNamespace(run=lambda cmd, **kw: (chamadas.append(list(cmd)), SimpleNamespace(returncode=0))[1], TimeoutExpired=subprocess.TimeoutExpired))
    assert executar("senado.diario", Recorte(anos=(2024, 2025)), runner=runner_subprocesso) == 0
    assert chamadas[0][2:] == ["civico_etl.cli", "senado.diario", "--year", "2024", "--year", "2025"]
