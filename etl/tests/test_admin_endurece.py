"""FABRICADO. B6: endurecimento da Parte B (AC-15, AC-16, AC-17). Migração `0152_admin_coleta_endurece.sql`.

  A  critério 9, porta de serviço: nenhuma função do caminho de aplicação por agentes aceita parâmetro que substitua a variável de ambiente (inspeção das assinaturas).
  B  critério 9, sombreamento: tabela temporária `pg_temp.pipeline_switches` com a linha `on` NÃO liga a segunda chave, pelo código nem pelo gatilho `adm_decisoes_guard`.
  C  critério 9, o efeito sem a marca: `adm_overrides` e `adm_vinculos` recusam linha de decisão de agentes sem a linha `on`; decisão de pessoa e linha sem `decisao_id` passam.
  D  critério 5, rodada presa em `em_andamento`: BaseException depois do coletor, trava de sessão do executor, `admin rodada recuperar`.
  E  critério 11, contato e fusão de pessoas: `merge_person` REAL (não alterada) + gatilho `adm_reaponta_override`; e o limite declarado (mandato sem contato na fusão).
  G  hash da tentativa de falha: todo HTTP 5xx é o mesmo desfecho.

Sem rede, sem skip. A, B, C e G rodam em transações do banco isolado que revertem. D e E gravam com commit SÓ no banco isolado da fixture `banco_isolado` e desfazem em `finally`.
Nada é gravado no banco da suíte (contagens antes e depois, no módulo importado `_suite_intacta` de test_admin_rodada, mais o guarda deste módulo).
"""

from __future__ import annotations

import ast
import inspect
import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import admin_fixtures as AF
import psycopg
import pytest
from banco_isolado import banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from caracterizacao import rodar_cli
from conftest import database_url
from psycopg import errors as pe
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from test_admin_chaves import _pareceres, agentes, pessoa, poe  # noqa: F401
from test_admin_decisoes import prop_status
from test_admin_parecer import VAR, sem_rede  # noqa: F401  (sem_rede é autouse)
from test_admin_propostas import AGORA, H, P, decidir, iso, m  # noqa: F401  (fixtures iso e m)
from test_admin_rodada import (  # noqa: F401  (fixtures: banco da suíte intacto, ambiente do coletor, base do SAPL, conexão e cache)
    _ambiente, _suite_intacta, cache, contagens, cx, dominio, n, sapl_base, sem_duplicata_por_chave_natural)
from test_admin_sobrevive import conectar, decidir_e_aplicar, limpar_decisoes, propor
from test_caracterizacao import _ex_contatos, _ex_entrada, _ex_limpar, _ex_preparar

import civico_etl.admin as ADMIN_PKG
from civico_etl import cli
from civico_etl.admin import aplicar as APL
from civico_etl.admin import parecer as PA
from civico_etl.admin import propostas as PR
from civico_etl.admin import proponentes as PRO
from civico_etl.admin import rodadas as R
from civico_etl.admin.aplicar import ChavesDesligadas
from civico_etl.admin.saida import ErroAdmin
from civico_etl.catalogo.contrato import Recorte

SUITE = ("pipeline_switches", "adm_decisoes", "adm_overrides", "adm_vinculos", "adm_rodadas", "mandate_contacts", "mandates", "people")


def _contagens_suite() -> dict[str, int]:
    with psycopg.connect(database_url(), row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in SUITE}  # noqa: S608 (nomes fixos)


@pytest.fixture(scope="module", autouse=True)
def _suite_intacta_b6():
    antes = _contagens_suite()
    yield
    assert _contagens_suite() == antes, "o banco da suíte mudou"


# ------------------------------------------------------------------ A. nenhuma porta de serviço (critério 9)


ADMIN_DIR = Path(inspect.getsourcefile(ADMIN_PKG)).parent
NOMES_SUSPEITOS = ("ambiente", "environ", "env", "amb")


def _chamadores_transitivos(raiz: str) -> dict[str, set[str]]:
    """Todas as funções de `civico_etl/admin/*.py` que chamam `raiz` direta ou indiretamente (por nome simples ou atributo). {arquivo: {nome da função}}."""
    funcoes: list[tuple[str, str, set[str]]] = []
    for f in sorted(ADMIN_DIR.glob("*.py")):
        for no in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)):
                chamadas = {getattr(c.func, "attr", None) or getattr(c.func, "id", None) for c in ast.walk(no) if isinstance(c, ast.Call)}
                funcoes.append((f.stem, no.name, {x for x in chamadas if x}))
    alvo = {raiz}
    achadas: dict[str, set[str]] = {}
    mudou = True
    while mudou:
        mudou = False
        for arq, nome, chamadas in funcoes:
            if chamadas & alvo and nome not in alvo:
                alvo.add(nome)
                achadas.setdefault(arq, set()).add(nome)
                mudou = True
    return achadas


def test_A_nenhuma_funcao_do_caminho_das_chaves_aceita_parametro_que_substitua_a_variavel():
    import importlib

    esperadas = {"chaves_dos_agentes": ["conn"], "aplicar": ["conn", "decisao_id"], "aplicar_pendentes": ["conn", "decisao_id"]}
    for nome, params in esperadas.items():
        assert list(inspect.signature(getattr(APL, nome)).parameters) == params, nome
    assert list(inspect.signature(PA.aplicar_por_agentes).parameters) == ["conn", "parecer_id"]
    # tudo em civico_etl/admin que chama `chaves_dos_agentes`, direta ou indiretamente: assinatura sem nome suspeito, sem *args/**kwargs e sem Mapping/dict
    achadas = _chamadores_transitivos("chaves_dos_agentes")
    assert {"aplicar", "aplicar_pendentes", "aplicar_por_agentes"} <= {f for fs in achadas.values() for f in fs}
    verificadas = []
    for arq, nomes in achadas.items():
        mod = importlib.import_module(f"civico_etl.admin.{arq}")
        for nome in nomes:
            fn = getattr(mod, nome, None)
            if fn is None:  # função aninhada ou método: confere pela AST abaixo
                continue
            for p in inspect.signature(fn).parameters.values():
                assert p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL), (arq, nome, p)
                assert not any(s in p.name.lower() for s in NOMES_SUSPEITOS), (arq, nome, p.name)
                assert "Mapping" not in str(p.annotation) and "dict" not in str(p.annotation).lower(), (arq, nome, p)
            verificadas.append(f"{arq}.{nome}")
    assert {"aplicar.aplicar", "aplicar.aplicar_pendentes", "parecer.aplicar_por_agentes"} <= set(verificadas), verificadas
    # a CLI não tem opção que carregue o ambiente das chaves, e nenhum arquivo do pacote lê a variável das chaves de outro lugar que não `chaves_dos_agentes`
    opcoes = [c.args[0].value for c in ast.walk(ast.parse((ADMIN_DIR / "cli.py").read_text(encoding="utf-8")))
              if isinstance(c, ast.Call) and getattr(c.func, "attr", None) == "add_argument" and c.args and isinstance(c.args[0], ast.Constant)]
    assert opcoes and not [o for o in opcoes if any(s in o.lower() for s in ("amb", "env"))], opcoes
    leitores = [f.name for f in sorted(ADMIN_DIR.glob("*.py")) if "ADMIN_COLETA_AGENTES" in f.read_text(encoding="utf-8").replace('VARIAVEL = "ADMIN_COLETA_AGENTES"', "")
                and f.name not in ("aplicar.py", "parecer.py", "cli.py")]
    assert leitores == []
    # e `escolher_motor`/`gerar_da_rodada` (que ainda têm `ambiente`) são só a PRESENÇA da chave da API: não chamam `chaves_dos_agentes` nem as funções que aplicam
    for nome in ("escolher_motor", "gerar_da_rodada"):
        assert nome not in {f for fs in achadas.values() for f in fs}, nome


# ------------------------------------------------------------------ B. sombreamento por tabela temporária (critério 9)


def _temp_com_a_linha_on(iso) -> None:
    iso.execute("create temp table pipeline_switches (like public.pipeline_switches including defaults)")
    iso.execute("insert into pg_temp.pipeline_switches (name, value, note) values ('admin_coleta_agentes', 'on', 'sombra B6')")


def test_B_tabela_temporaria_com_a_linha_on_nao_liga_a_segunda_chave_nem_no_codigo_nem_no_gatilho(iso, m, monkeypatch):
    d = agentes(iso, prop_status(iso, m, "fora_do_ar"))
    real, _, _ = _pareceres(iso, m)
    poe(iso, monkeypatch, "on", "ausente")  # variável on; linha real ausente
    monkeypatch.setenv(VAR, "on")
    with iso.transaction(force_rollback=True):
        _temp_com_a_linha_on(iso)
        # controle: a consulta SEM esquema enxerga a temporária (é exatamente o que o `search_path` padrão faria); a real continua sem a linha
        assert iso.execute("select count(*) as n from pipeline_switches where name = 'admin_coleta_agentes' and value = 'on'").fetchone()["n"] == 1
        assert iso.execute("select count(*) as n from public.pipeline_switches where name = 'admin_coleta_agentes'").fetchone()["n"] == 0
        # código
        assert APL.chaves_dos_agentes(iso) == {"variavel": True, "linha": False, "ligadas": False}
        with iso.transaction(force_rollback=True), pytest.raises(ChavesDesligadas):
            APL.aplicar(iso, d["id"])
        with iso.transaction(force_rollback=True), pytest.raises(ChavesDesligadas):
            PA.aplicar_por_agentes(iso, real["id"])
        # gatilho (sem passar pelo código): a marca `aplicada` de decisão de agentes é recusada
        with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
            with iso.transaction():
                iso.execute("update adm_decisoes set aplicada = true where id = %s", (d["id"],))
        assert iso.execute("select aplicada from adm_decisoes where id = %s", (d["id"],)).fetchone()["aplicada"] is False
    # o `search_path` da função do gatilho está fixo na definição (migração 0152) e a leitura é qualificada
    cfg, corpo = iso.execute("select proconfig, prosrc from pg_proc where proname = 'adm_decisoes_guard'").fetchone().values()
    assert cfg == ["search_path=pg_catalog, public"] and "public.pipeline_switches" in corpo and "from pipeline_switches" not in corpo


def test_B_a_linha_real_continua_ligando_o_gatilho(iso, m, monkeypatch):
    """Contra-prova de que a correção não fechou demais: com a linha na tabela real, o gatilho deixa passar e o código aplica."""
    d = agentes(iso, prop_status(iso, m, "fora_do_ar"))
    poe(iso, monkeypatch, "on", "on")
    APL.aplicar(iso, d["id"])
    assert iso.execute("select aplicada from adm_decisoes where id = %s", (d["id"],)).fetchone()["aplicada"] is True


def test_B_todas_as_leituras_de_pipeline_switches_no_codigo_do_modulo_sao_qualificadas():
    import re

    for f in sorted(ADMIN_DIR.glob("*.py")):
        for no in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(no, ast.Constant) and isinstance(no.value, str) and re.search(r"\b(from|join|into|update)\s+pipeline_switches\b", no.value, re.I):
                raise AssertionError(f"{f.name}: leitura de pipeline_switches sem o esquema `public.`: {no.value[:80]!r}")


# ------------------------------------------------------------------ C. o efeito de uma decisão de agentes também exige a segunda chave


def _override(iso, chave: str, decisao_id: Any) -> None:
    iso.execute("insert into adm_overrides (classe, registro_chave, campo, valor, decisao_id) values ('vinculo_sapl', %s, 'status', %s, %s)", (chave, Jsonb("ok"), decisao_id))


def _vinculo(iso, chave: str, decisao_id: Any) -> None:
    iso.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem, decisao_id) values ('vinculo_sapl', %s, %s, %s, 'correcao_manual', %s)",
                (chave, f"https://{chave}.example/x", H(chave), decisao_id))


@pytest.mark.parametrize("escreve", [_override, _vinculo], ids=["adm_overrides", "adm_vinculos"])
def test_C_linha_de_decisao_de_agentes_exige_a_linha_on_e_as_outras_situacoes_passam(iso, m, escreve):
    da = agentes(iso, prop_status(iso, m, "fora_do_ar", sha="c1"))
    dp = pessoa(iso, prop_status(iso, m, "robots_bloqueia", sha="c2"))
    # 1. decisão de agentes, linha ausente: recusa (e depois com a linha em 'off')
    for estado in (None, "off"):
        iso.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
        if estado:
            iso.execute("insert into pipeline_switches (name, value, note) values ('admin_coleta_agentes', %s, 'teste B6')", (estado,))
        with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
            with iso.transaction():
                escreve(iso, "ag-1", da["id"])
    # 2. decisão de agentes, linha `on` na tabela REAL: passa
    iso.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
    iso.execute("insert into pipeline_switches (name, value, note) values ('admin_coleta_agentes', 'on', 'teste B6')")
    escreve(iso, "ag-2", da["id"])
    # 3. decisão de pessoa: passa sem a linha
    iso.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
    escreve(iso, "pe-1", dp["id"])
    # 4. decisão de agentes, linha só na tabela TEMPORÁRIA (sombra): recusa
    with iso.transaction(force_rollback=True):
        _temp_com_a_linha_on(iso)
        with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
            with iso.transaction():
                escreve(iso, "ag-3", da["id"])
    tabela = "adm_overrides" if escreve is _override else "adm_vinculos"
    assert [r["registro_chave"] for r in iso.execute(f"select registro_chave from {tabela} where registro_chave in ('ag-1', 'ag-2', 'ag-3', 'pe-1') order by 1").fetchall()] == ["ag-2", "pe-1"]  # noqa: S608


def test_C_vinculo_sem_decisao_id_passa_sem_a_linha_e_religar_a_decisao_de_agentes_e_recusado(iso, m):
    da = agentes(iso, prop_status(iso, m, "fora_do_ar", sha="c3"))
    iso.execute("delete from pipeline_switches where name = 'admin_coleta_agentes'")
    iso.execute("insert into adm_vinculos (classe, registro_chave, url, url_sha, origem) values ('vinculo_sapl', 'sem-dec', 'https://sem-dec.example/x', %s, 'descoberta_automatica')", (H("sem-dec"),))
    with pytest.raises(pe.RaiseException, match="admin_coleta_agentes"):
        with iso.transaction():
            iso.execute("update adm_vinculos set decisao_id = %s where registro_chave = 'sem-dec'", (da["id"],))
    iso.execute("update adm_vinculos set vigente = false where registro_chave = 'sem-dec'")  # o que a sincronização faz: não toca em decisao_id, passa


def test_C_o_gatilho_tem_search_path_fixo_e_so_olha_o_esquema_public(iso):
    cfg, corpo = iso.execute("select proconfig, prosrc from pg_proc where proname = 'adm_exige_chave_agentes'").fetchone().values()
    assert cfg == ["search_path=pg_catalog, public"] and "public.pipeline_switches" in corpo and "public.adm_decisoes" in corpo
    assert {r["tgrelid"] for r in iso.execute("select tgrelid::regclass::text as tgrelid from pg_trigger where tgname = 'adm_exige_chave_agentes'").fetchall()} == {"adm_overrides", "adm_vinculos"}


# ------------------------------------------------------------------ D. critério 5: rodada presa em em_andamento


def _trava_livre(url: str, rid: str) -> bool:
    """Outra conexão tenta tomar (e solta) a trava de sessão da rodada: True = ninguém a segura."""
    a, b = R.chave_da_trava(rid)
    with psycopg.connect(url, autocommit=True) as o:
        ok = o.execute("select pg_try_advisory_lock(%s::int, %s::int)", (a, b)).fetchone()[0]
        if ok:
            o.execute("select pg_advisory_unlock(%s::int, %s::int)", (a, b))
        return bool(ok)


def _status(url: str, rid: str) -> str:
    with psycopg.connect(url, autocommit=True) as o:
        return o.execute("select status from adm_rodadas where id = %s", (rid,)).fetchone()[0]


def _abrir(cx, mp, cache: Path, cenario: str = "v1") -> tuple[str, Any]:
    t = AF.instalar(mp, cenario, cache)
    rid = R.abrir(cx, "sapl.assembleias", Recorte(ufs=AF.UFS))
    cx.commit()
    return rid, t


def test_D1_keyboardinterrupt_depois_do_coletor_leva_a_interrompida_e_sai_e_a_repeticao_nao_duplica(cx, monkeypatch, cache, sapl_base):
    rid, t = _abrir(cx, monkeypatch, cache)
    original = R._propor

    def ctrl_c(*a, **k):
        raise KeyboardInterrupt("ctrl-c depois do coletor")

    monkeypatch.setattr(R, "_propor", ctrl_c)
    with pytest.raises(KeyboardInterrupt):
        R.executar(cx, rid)
    cx.rollback()
    row = cx.execute("select status, finalizada_em, previa from adm_rodadas where id = %s", (rid,)).fetchone()
    assert row["status"] == "interrompida" and row["finalizada_em"] is not None
    res = row["previa"]["resultado"]
    assert res["status"] == "interrompida" and "KeyboardInterrupt" in res["erro_execucao"] and "ctrl-c" in res["interrupcao"] and res["execucao"] == 1
    assert _trava_livre(sapl_base, rid)  # a trava saiu junto
    antes = contagens(cx)
    assert n(cx, "select count(*) as n from adm_tentativas where rodada_id = %s", rid) > 0  # o que o coletor leu foi importado antes da interrupção
    monkeypatch.setattr(R, "_propor", original)
    rep = R.repetir(cx, rid)
    assert rep["status"] == "concluida" and rep["rodada_id"] == rid and rep["execucao"] == 2
    cx.rollback()
    sem_duplicata_por_chave_natural(cx)
    assert contagens(cx) == antes  # as mesmas linhas, os mesmos ids: nada duplicou
    assert t.nao_previstos == []


def test_D1_excecao_comum_depois_do_coletor_vira_resultado_interrompida_sem_levantar(cx, monkeypatch, cache, sapl_base):
    rid, _ = _abrir(cx, monkeypatch, cache)

    def quebra(*a, **k):
        raise RuntimeError("falha inesperada no proponente")

    monkeypatch.setattr(R, "_propor", quebra)
    res = R.executar(cx, rid)
    assert res["status"] == "interrompida" and "RuntimeError" in res["erro_execucao"] and _status(sapl_base, rid) == "interrompida" and _trava_livre(sapl_base, rid)


def test_D2_a_trava_fica_tomada_durante_a_execucao_e_recuperar_recusa_enquanto_ela_esta_tomada(cx, monkeypatch, cache, sapl_base, capsys):
    rid, _ = _abrir(cx, monkeypatch, cache)
    original = R._propor
    visto: dict[str, Any] = {}

    def espia(*a, **k):
        visto["status"] = _status(sapl_base, rid)
        visto["trava_livre"] = _trava_livre(sapl_base, rid)
        visto["rc_recuperar"] = cli.main(["admin", "rodada", "recuperar", rid])  # outro processo (outra conexão): recusa
        visto["status_depois"] = _status(sapl_base, rid)
        return original(*a, **k)

    monkeypatch.setattr(R, "_propor", espia)
    res = R.executar(cx, rid)
    assert res["status"] == "concluida"
    assert visto == {"status": "em_andamento", "trava_livre": False, "rc_recuperar": 1, "status_depois": "em_andamento"}
    assert "a rodada está sendo executada por outro processo" in capsys.readouterr().err
    assert _trava_livre(sapl_base, rid) and _status(sapl_base, rid) == "concluida"


def test_D2_a_chave_da_trava_e_deterministica_de_dois_inteiros_de_32_bits_com_espaco_proprio():
    a, b = R.chave_da_trava("11111111-1111-1111-1111-111111111111")
    assert (a, b) == R.chave_da_trava("11111111-1111-1111-1111-111111111111") and a == R.NAMESPACE_TRAVA
    assert -2**31 <= a < 2**31 and -2**31 <= b < 2**31 and R.chave_da_trava("22222222-2222-2222-2222-222222222222") != (a, b)


def test_D3_rodada_deixada_em_andamento_a_mao_e_recuperada_e_depois_repetida_sem_duplicata(cx, monkeypatch, cache, sapl_base, capsys):
    """Simula o processo morto: `_interromper` não consegue gravar (como num kill -9) e a rodada fica `em_andamento`. A trava, porém, some com a sessão do executor."""
    rid, t = _abrir(cx, monkeypatch, cache)
    original, original_interromper = R._propor, R._interromper
    monkeypatch.setattr(R, "_interromper", lambda *a, **k: None)
    monkeypatch.setattr(R, "_propor", lambda *a, **k: (_ for _ in ()).throw(KeyboardInterrupt("kill")))
    with pytest.raises(KeyboardInterrupt):
        R.executar(cx, rid)
    cx.rollback()
    assert _status(sapl_base, rid) == "em_andamento" and _trava_livre(sapl_base, rid)
    antes = contagens(cx)
    # `executar` e `repetir` recusam enquanto está em andamento (o motivo do achado)
    with pytest.raises(ErroAdmin, match="em_andamento"):
        R.executar(cx, rid)
    cx.rollback()
    with pytest.raises(ErroAdmin, match="em_andamento"):
        R.repetir(cx, rid)
    cx.rollback()
    monkeypatch.setattr(R, "_interromper", original_interromper)
    monkeypatch.setattr(R, "_propor", original)
    assert cli.main(["admin", "rodada", "recuperar", rid]) == 0
    out = capsys.readouterr().out
    assert "interrompida" in out and "executor ausente (recuperada em" in out
    assert "o coletor não rodou" not in out and "rodada recuperada" in out  # restrição 6: o código de saída desconhecido diz o motivo certo
    # `rodada ver` e `relatorio` leem o resultado gravado pela recuperação (que não traz início nem tentativas): não podem quebrar
    assert cli.main(["admin", "rodada", "ver", rid]) == 0 and "executor ausente" in capsys.readouterr().out
    assert cli.main(["admin", "relatorio", rid]) == 0 and capsys.readouterr().out
    cx.rollback()
    row = cx.execute("select status, finalizada_em, previa from adm_rodadas where id = %s", (rid,)).fetchone()
    assert row["status"] == "interrompida" and row["finalizada_em"] is not None
    assert row["previa"]["resultado"]["motivo"].startswith("executor ausente (recuperada em ") and row["previa"]["resultado"]["recuperada"] is True and len(row["previa"]["execucoes"]) == 1
    rep = R.repetir(cx, rid)
    assert rep["status"] == "concluida" and rep["rodada_id"] == rid and rep["execucao"] == 2
    cx.rollback()
    sem_duplicata_por_chave_natural(cx)
    assert contagens(cx) == antes and t.nao_previstos == []


def test_D3_recuperar_importa_o_log_de_tentativas_da_execucao_se_o_arquivo_existe(cx, monkeypatch, cache, sapl_base):
    rid, _ = _abrir(cx, monkeypatch, cache)
    cx.execute("update adm_rodadas set status = 'em_andamento' where id = %s", (rid,))
    cx.commit()
    pasta = cache.parent / "admin-rodadas"
    pasta.mkdir(parents=True, exist_ok=True)
    linha = {"url": "https://sapl.exemplo.fabricado/api/", "desfecho": "baixada", "ts": "2026-11-16T10:00:00+00:00", "sha256": H("corpo"), "http_status": 200, "bytes": 5}
    (pasta / f"{rid}-1.jsonl").write_text(json.dumps(linha) + "\n", encoding="utf-8")
    r = R.recuperar(cx, rid, agora=datetime(2026, 11, 16, 12, 30, tzinfo=timezone.utc))
    assert r["status"] == "interrompida" and r["motivo"] == "executor ausente (recuperada em 2026-11-16 12:30Z)" and r["logs_importados"] == [f"{rid}-1.jsonl"]
    assert n(cx, "select count(*) as n from adm_tentativas where rodada_id = %s", rid) == 1 and _status(sapl_base, rid) == "interrompida"
    assert _trava_livre(sapl_base, rid)


def test_D3_recuperar_recusa_com_a_trava_tomada_por_outra_conexao_e_em_outro_estado(cx, monkeypatch, cache, sapl_base, capsys):
    rid, _ = _abrir(cx, monkeypatch, cache)
    # estado aberta: recusa, com o estado na mensagem
    assert cli.main(["admin", "rodada", "recuperar", rid]) == 1
    assert "aberta" in capsys.readouterr().err
    cx.execute("update adm_rodadas set status = 'em_andamento' where id = %s", (rid,))
    cx.commit()
    a, b = R.chave_da_trava(rid)
    with psycopg.connect(sapl_base, autocommit=True) as outro:  # o "executor vivo": outra sessão segurando a trava
        assert outro.execute("select pg_try_advisory_lock(%s::int, %s::int)", (a, b)).fetchone()[0] is True
        assert cli.main(["admin", "rodada", "recuperar", rid]) == 1
        assert "a rodada está sendo executada por outro processo" in capsys.readouterr().err
        with pytest.raises(ErroAdmin, match="outro processo"):
            R.recuperar(cx, rid)
        cx.rollback()
        assert _status(sapl_base, rid) == "em_andamento"  # nada mudou
    # a sessão que segurava a trava terminou: agora recupera
    assert cli.main(["admin", "rodada", "recuperar", rid]) == 0
    assert _status(sapl_base, rid) == "interrompida"
    # e rodada em estado final (concluída) também recusa
    cx.execute("update adm_rodadas set status = 'em_andamento' where id = %s", (rid,))
    cx.execute("update adm_rodadas set status = 'falhou' where id = %s", (rid,))
    cx.commit()
    assert cli.main(["admin", "rodada", "recuperar", rid]) == 1
    assert "falhou" in capsys.readouterr().err


# ------------------------------------------------------------------ E. critério 11: contato e fusão de pessoas (merge_person REAL, não alterada)


class _Hoje(date):
    @classmethod
    def today(cls):
        return date(2026, 11, 15)


def _fusao(banco: str, monkeypatch, tmp_path, *, gatilho: bool, mandato_sem_contato: bool) -> dict[str, Any]:
    """Cenário: deputada A (mandato com 10 contatos pelo job `parlamento.extras`), supressão do e-mail antigo por decisão de pessoa, uma pessoa duplicada B com mandato de mesma chave
    natural, `select merge_person(A, B)` de verdade, e o job de novo com a MESMA entrada (que ainda traz o e-mail suprimido). Devolve o que importa para as asserções."""
    import civico_etl.jobs.derive_stats as ds
    import civico_etl.jobs.parlamento_extras as pex

    monkeypatch.setattr(pex, "date", _Hoje)
    monkeypatch.setattr(ds, "run_derive", lambda c: None)
    entrada = _ex_entrada(1, pex.CAMARA, pex.SENADO)

    def respostas(req):
        u = str(req.url)
        if u not in entrada:
            raise AssertionError(f"URL não prevista: {u}")
        return 200, {"content-type": "application/json"}, json.dumps(entrada[u], ensure_ascii=False).encode()

    def job(pasta: str) -> int:
        (tmp_path / pasta).mkdir()
        return rodar_cli(["parlamento.extras", "--year", "2025"], url_banco=banco, respostas=respostas, monkeypatch=monkeypatch, tmp_path=tmp_path / pasta)

    def contatos(slug: str) -> set[tuple[str, str, str]]:
        return {(x["fonte"], x["kind"], x["value"]) for x in _ex_contatos(banco) if x["pessoa"] == slug}

    velho = ("camara", "email", "dep.fab.a@camara.leg.br")
    novo_email = "deputada.a.correto@camara.leg.br"
    limpar_decisoes(banco)
    mand = _ex_preparar(banco)
    c = conectar(banco)
    out: dict[str, Any] = {"velho": velho, "novo_email": novo_email}
    try:
        if not gatilho:
            c.execute("alter table mandate_contacts disable trigger adm_reaponta_override")
            c.commit()
        assert job("r1") == 0
        mid_a = mand["fab-extras-dep-a"]
        assert velho in contatos("fab-extras-dep-a")
        pid = propor(c, "contato_mandato", mid_a, f"email:{velho[2]}", novo_email, "https://exemplo.fabricado/camara/dep-a", "fu1", bloco="<div id=dep-a>")
        decidir_e_aplicar(c, pid, "aprovar", justificativa="a página da deputada mostra outro e-mail")
        assert velho not in contatos("fab-extras-dep-a") and ("curadoria", "email", novo_email) in contatos("fab-extras-dep-a")
        ov = c.execute("select id, registro_chave, suprimir, vigente from adm_overrides where classe = 'contato_mandato'").fetchone()
        assert ov["registro_chave"] == mid_a and ov["suprimir"] and ov["vigente"]
        # pessoa duplicada B, com um mandato de MESMA chave natural (cargo, lugar, posse) que o de A
        a_id = c.execute("select person_id from mandates where id = %s", (mid_a,)).fetchone()["person_id"]
        b_id = c.execute("insert into people (slug, display_name) values ('fab-extras-dup-b', 'Duplicata Fabricada B') returning id").fetchone()["id"]
        mid_b = str(c.execute(
            "insert into mandates (person_id, office_id, place_id, body_id, role, status, started_on, ends_on, status_source) "
            "select %s, office_id, place_id, body_id, role, status, started_on, ends_on, status_source from mandates where id = %s returning id", (b_id, mid_a)).fetchone()["id"])
        if mandato_sem_contato:
            c.execute("delete from mandate_contacts where mandate_id = %s", (mid_a,))  # nenhum contato em A na hora da fusão (limite declarado, AC-16)
        c.commit()
        c.execute("select merge_person(%s::uuid, %s::uuid)", (a_id, b_id))  # a função REAL
        c.commit()
        out["mid_a"], out["mid_b"] = mid_a, mid_b
        out["mandato_a_existe"] = c.execute("select count(*) as n from mandates where id = %s", (mid_a,)).fetchone()["n"] == 1
        out["override_depois_da_fusao"] = dict(c.execute("select registro_chave, vigente from adm_overrides where id = %s", (ov["id"],)).fetchone())
        out["contatos_b_depois_da_fusao"] = contatos("fab-extras-dup-b")
        assert job("r2") == 0  # entrada idêntica: ainda traz o e-mail suprimido, agora para o mandato que sobrou
        out["contatos_b"] = contatos("fab-extras-dup-b")
        out["ids_externos_b"] = c.execute("select count(*) as n from person_external_ids where person_id = %s", (b_id,)).fetchone()["n"]
        return out
    finally:
        c.rollback()
        c.execute("alter table mandate_contacts enable trigger adm_reaponta_override")
        c.commit()
        c.close()
        with psycopg.connect(banco, autocommit=True) as lim:
            lim.execute("delete from person_slug_redirects where old_slug like 'fab-extras-%'")
        limpar_decisoes(banco)
        _ex_limpar(banco)


def test_E_o_valor_suprimido_nao_volta_depois_de_merge_person_real_e_nova_rodada_de_parlamento_extras(banco_isolado, monkeypatch, tmp_path):
    r = _fusao(banco_isolado, monkeypatch, tmp_path, gatilho=True, mandato_sem_contato=False)
    assert r["mandato_a_existe"] is False and r["ids_externos_b"] >= 1  # a fusão apagou o mandato de A e moveu o id externo para B: o job reconhece B
    assert r["override_depois_da_fusao"] == {"registro_chave": r["mid_b"], "vigente": True}  # o gatilho reapontou a supressão para o mandato que sobrou
    assert r["velho"] not in r["contatos_b_depois_da_fusao"] and ("curadoria", "email", r["novo_email"]) in r["contatos_b_depois_da_fusao"]
    assert r["velho"] not in r["contatos_b"]  # o job tentou inserir o valor suprimido em B e o gatilho de override descartou
    assert ("curadoria", "email", r["novo_email"]) in r["contatos_b"]
    assert any(x[0] == "camara" for x in r["contatos_b"])  # e o resto do que o job traz para a deputada foi regravado em B (não é um teste vazio)


def test_E_controle_sem_o_gatilho_o_valor_suprimido_volta(banco_isolado, monkeypatch, tmp_path):
    """Prova de que o que protege é o gatilho novo: com ele desligado, o mesmo cenário traz o e-mail suprimido de volta no mandato que sobrou."""
    r = _fusao(banco_isolado, monkeypatch, tmp_path, gatilho=False, mandato_sem_contato=False)
    assert r["override_depois_da_fusao"]["registro_chave"] == r["mid_a"]  # órfão: aponta para um mandato que não existe mais
    assert r["velho"] in r["contatos_b"]


def test_E_limite_declarado_mandato_de_origem_sem_nenhum_contato_na_fusao_deixa_o_override_orfao_e_o_valor_volta(banco_isolado, monkeypatch, tmp_path):
    """AC-16: se o mandato A não tem nenhuma linha de contato quando `merge_person` roda, o `update mandate_contacts set mandate_id` não toca linha alguma, o gatilho não dispara
    e o override continua apontando para o mandato apagado. O comportamento real, fixado: o valor suprimido pode voltar no mandato que sobrou."""
    r = _fusao(banco_isolado, monkeypatch, tmp_path, gatilho=True, mandato_sem_contato=True)
    assert r["mandato_a_existe"] is False
    assert r["override_depois_da_fusao"] == {"registro_chave": r["mid_a"], "vigente": True}  # órfão
    assert r["velho"] in r["contatos_b"]


def test_E_gatilho_reaponta_uma_vez_por_par_resolve_colisao_e_ignora_update_sem_troca_de_mandato(iso, m):
    """Direto no gatilho, com duas linhas de contato movidas na MESMA instrução e override vigente do mesmo campo no destino."""
    a = str(m["man"])
    outra = iso.execute("insert into people (slug, display_name) values ('zt-b6-destino', 'Destino B6') returning id").fetchone()["id"]
    b = str(iso.execute("insert into mandates (person_id, office_id, place_id, body_id, role, status, started_on, ends_on, status_source) "
                        "select %s, office_id, place_id, body_id, role, status, started_on, ends_on, status_source from mandates where id = %s returning id", (outra, a)).fetchone()["id"])
    dec = pessoa_decisao(iso, m)
    src = iso.execute("select id from sources where slug = 'curadoria'").fetchone()["id"]
    for k, v in (("email", "x1@cidade-teste.example"), ("email", "x2@cidade-teste.example")):
        iso.execute("insert into mandate_contacts (mandate_id, kind, value, source_id) values (%s, %s, %s, %s)", (a, k, v, src))

    def ov(chave: str, campo: str) -> None:
        iso.execute("insert into adm_overrides (classe, registro_chave, campo, suprimir, decisao_id) values ('contato_mandato', %s, %s, true, %s)", (chave, campo, dec))

    ov(a, "email:sup1@cidade-teste.example")  # só em A: vai para B
    ov(a, "email:sup2@cidade-teste.example")  # em A e em B: o de B prevalece
    ov(b, "email:sup2@cidade-teste.example")
    iso.execute("update mandate_contacts set mandate_id = mandate_id where mandate_id = %s", (a,))  # coluna na lista, mas sem troca: nada muda
    assert {(r["registro_chave"], r["campo"], r["vigente"]) for r in iso.execute("select registro_chave, campo, vigente from adm_overrides where classe = 'contato_mandato'").fetchall()} == {
        (a, "email:sup1@cidade-teste.example", True), (a, "email:sup2@cidade-teste.example", True), (b, "email:sup2@cidade-teste.example", True)}
    iso.execute("update mandate_contacts set mandate_id = %s where mandate_id = %s", (b, a))  # duas linhas, uma instrução
    estado = {(r["registro_chave"], r["campo"], r["vigente"]) for r in iso.execute("select registro_chave, campo, vigente from adm_overrides where classe = 'contato_mandato'").fetchall()}
    assert estado == {(b, "email:sup1@cidade-teste.example", True), (a, "email:sup2@cidade-teste.example", False), (b, "email:sup2@cidade-teste.example", True)}


def pessoa_decisao(iso, m) -> str:
    """Decisão de pessoa qualquer (as linhas de override exigem `decisao_id`); só em transação que reverte."""
    d = pessoa(iso, prop_status(iso, m, "fora_do_ar", sha="e1"))
    return d["id"]


# ------------------------------------------------------------------ G. hash da tentativa de falha: todo 5xx é o mesmo desfecho


def _hash_da_falha(iso, http: int | None, motivo: str = "erro", url: str = "https://a.example/api/") -> tuple[str, str]:
    rid = iso.execute("insert into adm_rodadas (coletor, modo) values ('sapl.assembleias', 'recoletar') returning id").fetchone()["id"]
    iso.execute("insert into adm_tentativas (rodada_id, url, url_sha, resultado, http_status, motivo) values (%s, %s, %s, 'falha', %s, %s)", (rid, url, H(url), http, motivo))
    e = PRO._da_tentativa(iso, str(rid), None, url, "x")
    return e.sha, e.trecho


def test_G_todo_5xx_e_o_mesmo_hash_e_outros_status_continuam_distintos(iso):
    h500, t500 = _hash_da_falha(iso, 500)
    h502, _ = _hash_da_falha(iso, 502)
    h503, t503 = _hash_da_falha(iso, 503)
    h599, _ = _hash_da_falha(iso, 599)
    assert h500 == h502 == h503 == h599
    assert "(HTTP 500)" in t500 and "(HTTP 503)" in t503  # o trecho continua dizendo o status exato
    h403, _ = _hash_da_falha(iso, 403, "bloqueio")
    h404, _ = _hash_da_falha(iso, 404)
    h600, _ = _hash_da_falha(iso, 600)
    h499, _ = _hash_da_falha(iso, 499)
    sem, _ = _hash_da_falha(iso, None, "expiracao")
    assert len({h500, h403, h404, h600, h499, sem}) == 6 and _hash_da_falha(iso, 403, "erro")[0] != _hash_da_falha(iso, 403, "bloqueio")[0]


def test_G_500_depois_503_repete_a_proposta_sem_reabrir_e_500_depois_403_cria_proposta_nova_e_reabre(iso, m):
    chave = str(m["h_cam"])
    h500, t500 = _hash_da_falha(iso, 500)
    h503, t503 = _hash_da_falha(iso, 503)
    h403, t403 = _hash_da_falha(iso, 403, "bloqueio")
    r1 = PR.registrar(iso, P(m, conteudo_sha256=h500, trecho=t500), agora=AGORA)
    assert r1.nova and r1.pendencia_acao == "criada"
    decidir(iso, r1.pendencia_id)
    antes = iso.execute("select status, reaberta, evidencia_sha from adm_pendencias where id = %s", (r1.pendencia_id,)).fetchone()
    assert antes["status"] == "decidida"
    # 500 -> 503: a mesma chave de idempotência (o hash é o mesmo): proposta repetida, pendência decidida intacta
    r2 = PR.registrar(iso, P(m, conteudo_sha256=h503, trecho=t503), agora=AGORA)
    assert r2.nova is False and r2.proposta_id == r1.proposta_id
    assert iso.execute("select status, reaberta, evidencia_sha from adm_pendencias where id = %s", (r1.pendencia_id,)).fetchone() == antes
    # 500 -> 403: hash novo, proposta nova, a pendência decidida reabre
    r3 = PR.registrar(iso, P(m, conteudo_sha256=h403, trecho=t403), agora=AGORA)
    assert r3.nova is True and r3.proposta_id != r1.proposta_id
    depois = iso.execute("select status, reaberta, motivo_reabertura from adm_pendencias where id = %s", (r1.pendencia_id,)).fetchone()
    assert (depois["status"], depois["reaberta"], depois["motivo_reabertura"]) == ("aberta", True, "evidencia_mudou") and chave


def test_N2_env_extra_nao_pode_ligar_a_chave_dos_agentes():
    """AC-18: `rodadas.executar(env_extra=...)` recusa a variável da primeira chave antes de qualquer coisa (o teste não precisa de banco)."""
    import pytest as _pt
    from civico_etl.admin import rodadas as _R
    from civico_etl.admin.saida import ErroAdmin as _Erro
    with _pt.raises(_Erro, match="primeira chave dos agentes"):
        _R.executar(None, "x", env_extra={"ADMIN_COLETA_AGENTES": "on"})  # conn None: a recusa vem antes de qualquer uso do banco
