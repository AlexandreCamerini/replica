"""R9 (lote C): entradas de catálogo e adaptadores de ibge.places, ibge.populacao, ibge.malhas, governos.indicadores e receita.arrecadacao.

Sem banco, sem rede, sem skip/xfail. Os adaptadores são chamados direto (ou via `descrever` com um dublê de conexão só leitura).
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
from datetime import date
from pathlib import Path

from civico_etl import http as H
from civico_etl import schedule as S
from civico_etl.catalogo import COMANDOS, Classe, Recorte, comando
from civico_etl.catalogo import adaptadores_c, coletores_c, contrato
from civico_etl.catalogo.coletores_c import COLETORES_C

ETL = Path(__file__).resolve().parents[1]
DATA = date(2026, 10, 4)
ESPERADOS = ("ibge.places", "ibge.populacao", "ibge.malhas", "governos.indicadores", "receita.arrecadacao")
_ADAPTADORES_C = adaptadores_c  # importado acima: registra os adaptadores em contrato.ADAPTADORES


class _ConnSoLeitura:
    """Dublê de conexão: só aceita SELECT sobre places e devolve as UFs dadas."""

    def __init__(self, ufs: list[str]):
        self.ufs = ufs
        self.sqls: list[str] = []

    def execute(self, sql, params=None):
        self.sqls.append(" ".join(sql.split()))
        assert sql.lstrip().lower().startswith("select") and "places" in sql, sql[:80]

        class _R:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

        return _R([{"ibge_code": u} for u in self.ufs])


class _ClienteQueFalha:
    def __getattr__(self, nome):
        raise AssertionError(f"adaptador tocou o cliente HTTP ({nome})")


def _coletor(cid: str):
    return next(c for c in COLETORES_C if c.id == cid)


# ---------------------------------------------------------------- forma do catálogo


def test_os_cinco_ids_estao_no_lote_e_so_eles():
    assert tuple(c.id for c in COLETORES_C) == ESPERADOS
    assert len({c.id for c in COLETORES_C}) == len(COLETORES_C) == 5


def test_cada_coletor_aponta_de_volta_para_o_comando_da_cli_e_a_tarefa():
    tarefas = {t.name: t for t in S.TASKS}
    cmds = {c.nome: c for c in COMANDOS}
    for c in COLETORES_C:
        assert c.comandos == (c.id,) and c.tarefas == (c.id,)
        cmd = cmds[c.id]
        assert cmd.classe is Classe.COLETOR and cmd.coletor == c.id
        assert cmd.encadeia == c.encadeados, c.id
        assert c.id in tarefas, f"tarefa {c.id} fora de schedule.TASKS"
        assert tarefas[c.id].argv(DATA)[0] == c.id
        assert comando(c.id).coletor == c.id


def test_recortes_nao_aceitos_do_lote_sao_os_padroes_e_nenhum_aceito():
    for c in COLETORES_C:
        assert c.recortes_aceitos == ()
        assert set(c.recortes_nao_aceitos) == {"ano", "uf", "casa", "ibge"}, c.id


def test_valores_declarados_conferem_com_o_que_o_codigo_confirma():
    lugares = _coletor("ibge.places")
    assert lugares.fontes[0].slug == "ibge" and lugares.fontes[0].origem == "seed"
    assert lugares.tabelas == ("places", "legislative_bodies") and lugares.ausentes.politica == "nao_apaga"
    assert lugares.caracterizado is True and lugares.territorio == "municipio"

    pop = _coletor("ibge.populacao")
    assert pop.encadeados == ("seed",) and pop.entradas.tipo == "dinamicas" and pop.entradas.depende_de
    assert pop.tabelas == ("places",) and pop.caracterizado is True

    malhas = _coletor("ibge.malhas")
    assert malhas.tabelas == () and malhas.territorio == "nenhuma" and malhas.entradas.tipo == "dinamicas"
    assert malhas.caracterizado is False and malhas.ausentes.politica == "nao_apaga"

    gov = _coletor("governos.indicadores")
    assert {f.slug: f.origem for f in gov.fontes} == {"ibge-sidra": "migracao", "bcb-sgs": "migracao"}
    assert gov.datasets == ("governos.indicadores", "governos.bcb") and gov.entradas.urls == ()
    assert gov.entradas.tipo == "dinamicas" and gov.entradas.depende_de and gov.territorio == "pais"

    rec = _coletor("receita.arrecadacao")
    assert rec.fontes[0].slug == "receita-federal" and rec.fontes[0].origem == "migracao"
    assert rec.acesso == ("arquivo",) and rec.entradas.tipo == "estaticas" and rec.territorio == "uf"
    assert rec.tabelas == ("w4_tax_revenue",) and rec.caracterizado is True

    for c in COLETORES_C:
        assert c.env is None and c.tentativas_registradas is True and c.orquestradores
        assert set(c.modos) == {"descobrir", "recoletar", "reprocessar"}
        assert c.modos["descobrir"].suporta is False and c.modos["recoletar"].suporta and c.modos["reprocessar"].suporta


def test_nenhum_do_lote_esta_excluido_do_run_due_do_github():
    texto = (ETL.parent / ".github" / "workflows" / "etl.yml").read_text(encoding="utf-8")
    for c in COLETORES_C:
        assert f'ETL_TASKS_EXCLUDE: "{c.id}"' not in texto


# ---------------------------------------------------------------- adaptadores


def test_adaptadores_do_lote_estao_registrados():
    assert set(ESPERADOS) <= set(contrato.ADAPTADORES)


def test_adaptador_devolve_argv_so_com_o_comando_e_o_nao_suportado_vazio():
    for c in COLETORES_C:
        plano = contrato.ADAPTADORES[c.id](c, Recorte(), None, DATA)
        comando_, argv, urls, estimativa, obs, recusa = plano
        assert comando_ == c.id and argv == [c.id] and recusa == "", c.id
        assert isinstance(urls, tuple) and isinstance(estimativa, bool) and isinstance(obs, str)


def test_estimativa_segue_o_tipo_da_entrada():
    for c in COLETORES_C:
        _, _, _, estimativa, _, _ = contrato.ADAPTADORES[c.id](c, Recorte(), None, DATA)
        assert estimativa is (c.entradas.tipo == "dinamicas"), c.id


def test_urls_estaticas_saem_do_catalogo_sem_rede():
    for cid in ("ibge.places", "receita.arrecadacao"):
        c = _coletor(cid)
        _, _, urls, _, _, _ = contrato.ADAPTADORES[cid](c, Recorte(), None, DATA)
        assert urls == c.entradas.urls and urls


def test_malhas_sem_conn_devolve_so_a_do_pais_e_com_conn_concretiza_por_uf():
    c = _coletor("ibge.malhas")
    _, _, sem, _, _, _ = contrato.ADAPTADORES["ibge.malhas"](c, Recorte(), None, DATA)
    assert sem == c.entradas.urls and len(sem) == 1 and "paises/BR" in sem[0]
    conn = _ConnSoLeitura(["11", "35"])
    _, _, com, _, obs, _ = contrato.ADAPTADORES["ibge.malhas"](c, Recorte(), conn, DATA)
    assert com[0] == sem[0]
    assert "malhas/estados/11?" in com[1] and "malhas/estados/35?" in com[2] and len(com) == 3
    assert "2 UFs lidas do banco" in obs and len(conn.sqls) == 1


def test_governos_devolve_urls_vazias_e_observacao_com_depende_de_e_ano_de_execucao():
    c = _coletor("governos.indicadores")
    _, _, urls, estimativa, obs, _ = contrato.ADAPTADORES["governos.indicadores"](c, Recorte(), None, DATA)
    assert urls == () and estimativa is True
    assert c.entradas.depende_de in obs and "ano de execução" in obs


def test_populacao_observacao_repete_depende_de():
    c = _coletor("ibge.populacao")
    _, _, urls, _, obs, _ = contrato.ADAPTADORES["ibge.populacao"](c, Recorte(), None, DATA)
    assert urls == c.entradas.urls and c.entradas.depende_de in obs


def test_modo_reprocessar_acrescenta_a_nota_do_modelo():
    for c in COLETORES_C:
        _, _, _, _, obs, _ = contrato.ADAPTADORES[c.id](c, Recorte(modo="reprocessar"), None, DATA)
        if c.id == "ibge.malhas":  # abre run sem checksum (ibge_malhas.py:66): a nota "pula por checksum" seria falsa; vale a nota própria
            assert contrato._NOTA_REPROCESSAR not in obs and "sempre regrava os arquivos de malha" in obs
        else:
            assert contrato._NOTA_REPROCESSAR in obs, c.id


def test_nao_suportado_recusa_recorte_do_lote():
    for c in COLETORES_C:
        motivo = contrato._nao_suportado(c, Recorte(ufs=("SP",)))
        assert motivo, c.id
        assert "'uf'" in motivo
        assert contrato._nao_suportado(c, Recorte()) == ""


def test_adaptadores_sem_rede_com_conn_so_leitura(monkeypatch):
    # descrever() só enxerga COLETORES (coletores.py), que ainda não inclui o lote C: chama-se o adaptador direto
    def sem_socket(*a, **k):
        raise AssertionError("adaptador criou socket")

    monkeypatch.setattr(H, "_client", _ClienteQueFalha())
    monkeypatch.setattr(socket, "socket", sem_socket)
    monkeypatch.setattr(socket, "create_connection", sem_socket)
    conn = _ConnSoLeitura(["35"])
    for c in COLETORES_C:
        plano = contrato.ADAPTADORES[c.id](c, Recorte(modo="reprocessar"), conn, DATA)
        assert plano[1] == [c.id] and plano[5] == ""
    urls = contrato.ADAPTADORES["ibge.malhas"](_coletor("ibge.malhas"), Recorte(), conn, DATA)[2]
    assert urls[1].endswith("estados/35?formato=application/vnd.geo%2Bjson&intrarregiao=municipio&qualidade=minima")


def test_importar_o_lote_nao_importa_job_nem_cli():
    codigo = """
import sys, json
antes = set(sys.modules)
import civico_etl.catalogo.adaptadores_c
import civico_etl.catalogo.coletores_c
novos = sorted(m for m in sys.modules if m not in antes)
print(json.dumps(novos))
"""
    p = subprocess.run([sys.executable, "-c", codigo], cwd=ETL, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    novos = json.loads(p.stdout.strip().splitlines()[-1])
    assert not [m for m in novos if m.startswith("civico_etl.jobs") or m == "civico_etl.cli"]
