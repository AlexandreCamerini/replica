"""R-5: catálogo completo, nos dois sentidos (comandos, tarefas, ambiente, prazos, fontes, datasets, classes).

Critério: "todo comando de coleta da CLI tem entrada; toda tarefa de `TASKS` aponta para uma entrada; toda fonte citada existe em `sources`
depois do `seed`; a paridade de `MAX_AGE_H` com `web/src/lib/sources.ts` continua passando."

AC-04 (decisão registrada, não reaberta): "toda fonte existe em `sources` depois do seed" é impossível como escrita para as fontes criadas pelo
próprio job (`sapl-ale`, `alesp`, `alemg`: o job faz o upsert na primeira execução). O teste confere NO BANCO as fontes de origem "seed" e
"migracao" e, para as de origem "job", confere por leitura do texto do módulo (sem importá-lo) que o slug é criado lá. A origem declarada
também é conferida contra o texto de jobs/seed.py (AST) e de db/migrations/*.sql.

Sem rede, sem skip/xfail. O banco (fixture `conn`, só leitura) é usado apenas em test_fontes_de_seed_e_migracao_existem_em_sources.
"""

from __future__ import annotations

import ast
import re
from collections import Counter
from datetime import date
from pathlib import Path

import pytest
from test_orquestradores import comandos_da_cli

from civico_etl import schedule as S
from civico_etl.catalogo import ARQUIVOS, COLETORES, COLETORES_PENDENTES, COMANDOS, Classe, comando, coletor

ETL = Path(__file__).resolve().parents[1]
PKG = ETL / "civico_etl"
MIGRATIONS = ETL.parent / "db" / "migrations"
DATAS = (date(2026, 10, 4), date(2027, 3, 10))
POR_TAREFA = {t: c for c in COLETORES for t in c.tarefas}

# Coletores sem tarefa em schedule.TASKS, e por quê. Qualquer outro sem tarefa derruba o teste.
SEM_TAREFA = {
    "pauta": "`civico-etl pauta` roda fora da agenda (cli.py: 'rodar várias vezes ao dia'); não há Task('pauta') em schedule.TASKS",
}

# Chaves de MAX_AGE_H que NÃO são fonte de nenhum coletor, com o motivo. Hoje: nenhuma (todas são fonte de algum coletor).
MAX_AGE_SEM_COLETOR: dict[str, str] = {}

# Coletor.modulos pode apontar para COLETOR ou BIBLIOTECA. Exceção explícita: o despachante ale_cli.py é o módulo que `ale.custom` aciona
# (Comando ale.todas tem modulo jobs/ale_cli.py), então só ele pode listar um arquivo DESPACHANTE.
CLASSES_DE_MODULO = {Classe.COLETOR, Classe.BIBLIOTECA}
EXCECOES_DE_MODULO = {("ale.custom", "jobs/ale_cli.py"): Classe.DESPACHANTE}

# Evidência, por texto do módulo, de que o job cria a linha em `sources` (origem "job"). Cada item: (arquivo, regex que prova que o slug é
# esse literal, regex que prova que o job faz upsert em `sources` com ele). Um slug de origem "job" novo sem entrada aqui derruba o teste.
EVIDENCIA_JOB = {
    "alesp": (("jobs/alesp.py", r'Assembly\("SP", "alesp"'), ("jobs/assembleias.py", r'upsert\(conn, "sources",.*\[\(a\.source_slug,')),
    "alemg": (("jobs/almg.py", r'Assembly\("MG", "alemg"'), ("jobs/assembleias.py", r'upsert\(conn, "sources",.*\[\(a\.source_slug,')),
    "sapl-ale": (("jobs/sapl.py", r'^ALE_SOURCE = "sapl-ale"$'), ("jobs/sapl.py", r'upsert\(conn, "sources",.*\n\s*\[\(ALE_SOURCE,')),
}


def _texto(rel: str) -> str:
    return (PKG / rel).read_text(encoding="utf-8")


def _tarefas() -> dict[str, S.Task]:
    return {t.name: t for t in S.TASKS}


# ---------------------------------------------------------------- 1. comandos


def test_comandos_do_catalogo_sao_exatamente_os_da_cli():
    na_cli = comandos_da_cli()
    nos_comandos = {c.nome for c in COMANDOS}
    assert nos_comandos == na_cli, (sorted(na_cli - nos_comandos), sorted(nos_comandos - na_cli))
    assert len(COMANDOS) == len(na_cli) == 48


def test_todo_comando_de_coleta_tem_coletor_que_o_lista():
    por_id = {c.id: c for c in COLETORES}
    assert len(por_id) == len(COLETORES)  # id único
    for cmd in COMANDOS:
        if cmd.classe is Classe.COLETOR:
            assert cmd.coletor, cmd.nome
            assert cmd.coletor in por_id, f"{cmd.nome}: coletor {cmd.coletor!r} sem entrada em COLETORES"
            assert cmd.nome in por_id[cmd.coletor].comandos, f"{cmd.nome} não está em {cmd.coletor}.comandos"
            assert cmd.modulo in por_id[cmd.coletor].modulos, f"{cmd.nome}: {cmd.modulo} fora de {cmd.coletor}.modulos"
        else:
            assert cmd.coletor is None, f"{cmd.nome} ({cmd.classe.value}) não pode apontar coletor"


def test_cada_comando_de_coleta_esta_em_exatamente_um_coletor_e_nada_sobra():
    coleta = {c.nome for c in COMANDOS if c.classe is Classe.COLETOR}
    contagem = Counter(n for c in COLETORES for n in c.comandos)
    assert set(contagem) == coleta, (sorted(set(contagem) - coleta), sorted(coleta - set(contagem)))
    assert all(v == 1 for v in contagem.values()), {k: v for k, v in contagem.items() if v != 1}
    for c in COLETORES:  # o que o coletor lista, o comando devolve
        for n in c.comandos:
            assert comando(n).coletor == c.id
            assert comando(n).encadeia == c.encadeados, f"{n}: encadeia {comando(n).encadeia} x encadeados {c.encadeados}"
    assert len(coleta) == 28 and len(COLETORES) == 24
    assert COLETORES_PENDENTES == frozenset()


# ---------------------------------------------------------------- 2. tarefas


def test_toda_tarefa_de_tasks_esta_em_exatamente_um_coletor_e_nada_sobra():
    nomes = [t.name for t in S.TASKS]
    contagem = Counter(n for c in COLETORES for n in c.tarefas)
    assert set(contagem) == set(nomes), (sorted(set(nomes) - set(contagem)), sorted(set(contagem) - set(nomes)))
    assert all(v == 1 for v in contagem.values()), {k: v for k, v in contagem.items() if v != 1}
    assert len(nomes) == 23


def test_coletores_sem_tarefa_sao_so_os_esperados():
    sem = {c.id for c in COLETORES if not c.tarefas}
    assert sem == set(SEM_TAREFA), sem
    assert "pauta" not in _tarefas()  # a justificativa continua verdadeira


@pytest.mark.parametrize("dia", DATAS)
def test_argv_de_cada_tarefa_comeca_por_comando_do_coletor_e_so_usa_flags_do_comando(dia):
    for t in S.TASKS:
        c = POR_TAREFA[t.name]
        argv = t.argv(dia)
        assert argv[0] in c.comandos, f"{t.name}: {argv[0]!r} fora de {c.id}.comandos {c.comandos}"
        validas = set(comando(argv[0]).argumentos)
        flags = [a for a in argv[1:] if a.startswith("--")]
        assert set(flags) <= validas, f"{t.name}: flags {sorted(set(flags) - validas)} fora de Comando({argv[0]}).argumentos {sorted(validas)}"


# ---------------------------------------------------------------- 3. ambiente


def test_needs_env_da_tarefa_igual_ao_env_do_coletor():
    for t in S.TASKS:
        assert t.needs_env == POR_TAREFA[t.name].env, t.name
    assert {t.name for t in S.TASKS if t.needs_env} == {"transparencia.emendas", "sancoes.cgu"}


def test_source_env_bate_com_o_env_dos_coletores_da_fonte():
    achadas = set()
    for c in COLETORES:
        for f in c.fontes:
            if f.slug in S.SOURCE_ENV:
                achadas.add(f.slug)
                assert c.env == S.SOURCE_ENV[f.slug], f"{c.id}/{f.slug}: env {c.env!r} x SOURCE_ENV {S.SOURCE_ENV[f.slug]!r}"
    assert achadas == set(S.SOURCE_ENV)  # toda fonte com chave tem coletor que a cita


# ---------------------------------------------------------------- 4. prazos


def test_toda_chave_de_max_age_e_fonte_de_algum_coletor():
    fontes = {f.slug for c in COLETORES for f in c.fontes}
    sem = {k for k in S.MAX_AGE_H if k not in fontes}
    assert sem == set(MAX_AGE_SEM_COLETOR), f"chaves de MAX_AGE_H sem coletor e sem justificativa: {sorted(sem - set(MAX_AGE_SEM_COLETOR))}"
    assert not set(MAX_AGE_SEM_COLETOR) & fontes  # exceção obsoleta


def test_source_da_tarefa_esta_nas_fontes_do_coletor():
    com_source = [t for t in S.TASKS if t.source]
    assert {t.name for t in com_source} == {"sapl.ales", "sapl.todas"}
    for t in com_source:
        assert t.source in {f.slug for f in POR_TAREFA[t.name].fontes}, t.name
        assert t.source in S.MAX_AGE_H, t.name


def test_paridade_de_max_age_com_sources_ts_tem_teste_proprio():
    """A paridade MAX_AGE_H x web/src/lib/sources.ts é de test_schedule.py. Este teste só impede que o critério fique órfão se ele sumir."""
    arvore = ast.parse((ETL / "tests" / "test_schedule.py").read_text(encoding="utf-8"))
    fn = next((n for n in ast.walk(arvore) if isinstance(n, ast.FunctionDef) and n.name == "test_max_age_igual_ao_site"), None)
    assert fn is not None, "test_schedule.py::test_max_age_igual_ao_site foi removido ou renomeado"
    corpo = ast.unparse(fn)
    assert "MAX_AGE_H" in corpo and "sources.ts" in corpo


# ---------------------------------------------------------------- 5. fontes (AC-04)


def _slugs_do_seed() -> set[str]:
    arvore = ast.parse(_texto("jobs/seed.py"))
    achados: set[str] = set()
    for n in arvore.body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ("SOURCES", "SALARY_NORMS") for t in n.targets):
            achados |= {linha[0] for linha in ast.literal_eval(n.value)}
    return achados


def _slugs_das_migracoes() -> set[str]:
    achados: set[str] = set()
    for sql in sorted(MIGRATIONS.glob("*.sql")):
        texto = sql.read_text(encoding="utf-8")
        for bloco in re.findall(r"insert\s+into\s+sources\s*\([^)]*\)\s*values(.*?)(?:on\s+conflict|;)", texto, flags=re.S | re.I):
            achados |= set(re.findall(r"^\s*\(\s*'([a-z0-9-]+)'\s*,", bloco, flags=re.M))
    return achados


def _fontes_por_origem() -> dict[str, set[str]]:
    r: dict[str, set[str]] = {"seed": set(), "migracao": set(), "job": set()}
    for c in COLETORES:
        for f in c.fontes:
            r[f.origem].add(f.slug)
    return r


def test_origem_declarada_confere_com_o_texto_do_seed_e_das_migracoes():
    por = _fontes_por_origem()
    seed, migracoes = _slugs_do_seed(), _slugs_das_migracoes()
    assert por["seed"] <= seed, f"origem 'seed' que o seed.py não cria: {sorted(por['seed'] - seed)}"
    assert por["migracao"] <= migracoes, f"origem 'migracao' que nenhuma migração insere: {sorted(por['migracao'] - migracoes)}"
    assert not por["job"] & (seed | migracoes), f"origem 'job' mas o slug já nasce no seed/migração: {sorted(por['job'] & (seed | migracoes))}"
    # a mesma fonte não pode ter origens diferentes em coletores diferentes
    origens: dict[str, set[str]] = {}
    for c in COLETORES:
        for f in c.fontes:
            origens.setdefault(f.slug, set()).add(f.origem)
    assert all(len(v) == 1 for v in origens.values()), {k: v for k, v in origens.items() if len(v) > 1}


def test_fontes_de_seed_e_migracao_existem_em_sources(conn):
    por = _fontes_por_origem()
    no_banco = {r["slug"] for r in conn.execute("select slug from sources")}
    esperadas = por["seed"] | por["migracao"]
    assert esperadas, "nenhuma fonte de seed/migração no catálogo?"
    assert esperadas <= no_banco, f"fontes do catálogo ausentes de sources depois do seed: {sorted(esperadas - no_banco)}"


def test_fontes_de_origem_job_sao_criadas_pelo_codigo_do_coletor():
    """AC-04: não exige a linha no banco; exige que o módulo do coletor crie o slug (leitura de texto, o job não é importado)."""
    por = _fontes_por_origem()["job"]
    assert por == set(EVIDENCIA_JOB), f"slug de origem 'job' sem evidência (ou evidência obsoleta): {sorted(por ^ set(EVIDENCIA_JOB))}"
    modulos_do_coletor = {f.slug: c.modulos for c in COLETORES for f in c.fontes if f.origem == "job"}
    for slug, ((arq_slug, re_slug), (arq_upsert, re_upsert)) in EVIDENCIA_JOB.items():
        assert re.search(re_slug, _texto(arq_slug), flags=re.M), f"{slug}: literal não encontrado em {arq_slug}"
        assert re.search(re_upsert, _texto(arq_upsert), flags=re.S), f"{slug}: upsert em sources não encontrado em {arq_upsert}"
        assert arq_slug in modulos_do_coletor[slug] and arq_upsert in modulos_do_coletor[slug], f"{slug}: evidência fora de Coletor.modulos"


# ---------------------------------------------------------------- 6. datasets


def _casa(familia: str, padrao: str) -> bool:
    """`familia` é um prefixo de `dataset` (Task.families); `padrao` tem {ano}, {ibge}, {uf}, ... como curinga."""
    if padrao.split("{")[0].startswith(familia):
        return True
    regex = re.sub(r"\\\{[^}]*\\\}", r"[^.]+", re.escape(padrao))
    return re.fullmatch(regex, familia) is not None


def test_cada_familia_de_cada_tarefa_casa_com_um_padrao_de_dataset_do_coletor():
    sem: list[str] = []
    for t in S.TASKS:
        c = POR_TAREFA[t.name]
        for dia in DATAS:
            for familia in t.families(dia):
                if not any(_casa(familia, p) for p in c.datasets):
                    sem.append(f"{t.name} [{dia}]: {familia!r} x {c.datasets}")
    assert not sem, sem


def test_casa_distingue_o_que_casa_do_que_nao_casa():
    assert _casa("camara.votacoes.", "camara.votacoes.{ano}") and _casa("tse.votos.2024", "tse.votos.{ano}")
    assert not _casa("camara.votacoes.", "senado.votacoes.{ano}") and not _casa("tse.votos.20x4", "tse.votos.{ano}x")


# ---------------------------------------------------------------- 7. classes dos módulos


def test_modulos_do_coletor_existem_e_tem_classe_coletor_ou_biblioteca():
    for c in COLETORES:
        for m in c.modulos:
            assert (PKG / m).is_file(), f"{c.id}: {m} não existe"
            classe = ARQUIVOS[m]
            esperada = EXCECOES_DE_MODULO.get((c.id, m))
            if esperada is not None:
                assert classe is esperada, f"{c.id}: {m} é {classe}, a exceção declara {esperada}"
            else:
                assert classe in CLASSES_DE_MODULO, f"{c.id}: {m} é {classe.value}; só COLETOR/BIBLIOTECA (exceções: {sorted(EXCECOES_DE_MODULO)})"
    usadas = {(c.id, m) for c in COLETORES for m in c.modulos}
    assert set(EXCECOES_DE_MODULO) <= usadas  # exceção obsoleta


def test_coletor_acessor_devolve_o_mesmo_objeto():
    assert all(coletor(c.id) is c for c in COLETORES)
