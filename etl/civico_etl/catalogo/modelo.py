"""Modelo declarativo do catálogo (Parte R, R1 e R4): comando, coletor, classe.

Só biblioteca padrão. Nada aqui (nem em nenhum módulo do pacote) importa `civico_etl.jobs.*`: importar o catálogo não pode ter efeito
colateral (`jobs/sapl.py:57` e `jobs/assembleias.py:39` alteram `http.RATE` no import).

Convenção de `Coletor.tabelas`: tabelas de dado que o job escreve. As tabelas de contabilidade de `db.run` (`ingest_runs`,
`dataset_stamps`) ficam de fora; `ingest_runs` só aparece onde o job escreve nela por conta própria (sapl.py:424).

Valor desconhecido fica explícito (campo vazio com `depende_de`/motivo), nunca preenchido por suposição.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Mapping


class Classe(Enum):
    COLETOR = "coletor"
    BIBLIOTECA = "biblioteca"
    DESPACHANTE = "despachante"
    DERIVACAO = "derivacao"
    CHECAGEM = "checagem"
    ROTINA_DE_AGENDA = "rotina_de_agenda"
    REPARO_PONTUAL = "reparo_pontual"
    SEED = "seed"
    FLUXO_DE_IA = "fluxo_de_ia"
    MANUTENCAO = "manutencao"


PARSERS = ("cli", "ale_cli", "sapl", "sancoes", "transparencia", "schedule", "inline")
ORIGENS_FONTE = ("seed", "migracao", "job")
TIPOS_ENTRADA = ("estaticas", "dinamicas")
POLITICAS_AUSENTES = ("nao_apaga", "apaga", "apaga_com_guarda")
TERRITORIOS = ("pais", "uf", "municipio", "nenhuma")
ACESSOS = ("api", "arquivo", "zip_remoto_por_faixa", "pagina")
MODOS = ("descobrir", "recoletar", "reprocessar")
# recortes que o catálogo obriga a declarar (aceito ou não aceito) em todo coletor; outros nomes (ex.: "escopo") entram só onde existem
RECORTES_PADRAO = ("ano", "uf", "casa", "ibge")

_RE_ENV = re.compile(r"^[A-Z][A-Z0-9_]*$")


def _texto(valor: object, campo: str) -> None:
    if not isinstance(valor, str) or not valor.strip():
        raise ValueError(f"{campo}: texto não vazio obrigatório (veio {valor!r})")


def _tupla_de_texto(valor: object, campo: str, *, obrigatoria: bool) -> None:
    if not isinstance(valor, tuple):
        raise ValueError(f"{campo}: tupla obrigatória (veio {type(valor).__name__})")
    if obrigatoria and not valor:
        raise ValueError(f"{campo}: não pode ser vazio")
    for v in valor:
        _texto(v, campo)
    if len(set(valor)) != len(valor):
        raise ValueError(f"{campo}: valores repetidos em {valor!r}")


@dataclass(frozen=True)
class Fonte:
    slug: str
    origem: str  # onde a linha de `sources` nasce: seed (jobs/seed.py), migracao (db/migrations) ou job (o próprio coletor faz upsert)

    def __post_init__(self) -> None:
        _texto(self.slug, "Fonte.slug")
        if self.origem not in ORIGENS_FONTE:
            raise ValueError(f"Fonte({self.slug}).origem inválida: {self.origem!r}; esperado um de {ORIGENS_FONTE}")


@dataclass(frozen=True)
class Entradas:
    """URLs de entrada. `estaticas`: listáveis sem rede (podem ter `{ano}`, expandido pelo recorte). `dinamicas`: dependem de uma
    leitura anterior; `urls` traz só as conhecidas sem ler nada e `depende_de` diz do que o resto depende."""

    tipo: str
    urls: tuple[str, ...] = ()
    depende_de: str = ""

    def __post_init__(self) -> None:
        if self.tipo not in TIPOS_ENTRADA:
            raise ValueError(f"Entradas.tipo inválido: {self.tipo!r}; esperado um de {TIPOS_ENTRADA}")
        _tupla_de_texto(self.urls, "Entradas.urls", obrigatoria=self.tipo == "estaticas")
        if self.tipo == "dinamicas":
            _texto(self.depende_de, "Entradas.depende_de (obrigatório em entrada dinâmica)")
        elif self.depende_de:
            raise ValueError("Entradas estáticas não têm depende_de")


@dataclass(frozen=True)
class Ausentes:
    """O que o coletor faz com o que não veio na leitura."""

    politica: str
    guarda: str = ""

    def __post_init__(self) -> None:
        if self.politica not in POLITICAS_AUSENTES:
            raise ValueError(f"Ausentes.politica inválida: {self.politica!r}; esperado um de {POLITICAS_AUSENTES}")
        if self.politica == "apaga_com_guarda":
            _texto(self.guarda, "Ausentes.guarda (obrigatória em apaga_com_guarda)")


@dataclass(frozen=True)
class Modo:
    """`suporta=False` exige o motivo. `suporta=True` pode trazer uma observação (ex.: o comando que realiza o modo)."""

    suporta: bool
    motivo: str = ""

    def __post_init__(self) -> None:
        if not isinstance(self.suporta, bool):
            raise ValueError("Modo.suporta: bool obrigatório")
        if not self.suporta:
            _texto(self.motivo, "Modo.motivo (modo não suportado exige motivo)")


@dataclass(frozen=True)
class Comando:
    """O que a CLI aceita. `argumentos` = flags (e posicional `key`) que o comando efetivamente lê; `encadeia` = passos que a CLI
    roda depois da carga, em ordem; `coletor` = id do coletor que ele aciona (None se não é de coleta)."""

    nome: str
    classe: Classe
    modulo: str  # módulo que faz o trabalho, relativo a civico_etl/ (ex.: "jobs/camara_equipe.py")
    parser: str
    argumentos: tuple[str, ...]
    encadeia: tuple[str, ...]
    coletor: str | None

    def __post_init__(self) -> None:
        _texto(self.nome, "Comando.nome")
        if not isinstance(self.classe, Classe):
            raise ValueError(f"Comando({self.nome}).classe: esperado Classe")
        _texto(self.modulo, f"Comando({self.nome}).modulo")
        if self.parser not in PARSERS:
            raise ValueError(f"Comando({self.nome}).parser inválido: {self.parser!r}; esperado um de {PARSERS}")
        _tupla_de_texto(self.argumentos, f"Comando({self.nome}).argumentos", obrigatoria=False)
        for a in self.argumentos:
            if not (a.startswith("--") or a == "key"):
                raise ValueError(f"Comando({self.nome}).argumentos: {a!r} não é flag (--x) nem o posicional key")
        _tupla_de_texto(self.encadeia, f"Comando({self.nome}).encadeia", obrigatoria=False)
        if (self.classe is Classe.COLETOR) != (self.coletor is not None):
            raise ValueError(f"Comando({self.nome}): coletor é obrigatório se e só se a classe é COLETOR")
        if self.coletor is not None:
            _texto(self.coletor, f"Comando({self.nome}).coletor")


@dataclass(frozen=True)
class Coletor:
    id: str
    modulos: tuple[str, ...]
    comandos: tuple[str, ...]
    tarefas: tuple[str, ...]  # nomes em schedule.TASKS (o catálogo só referencia; não duplica argv nem prefixes)
    fontes: tuple[Fonte, ...]
    datasets: tuple[str, ...]  # padrões ({ano}, {ibge}) dos `dataset` que o coletor grava em ingest_runs/dataset_stamps
    acesso: tuple[str, ...]  # subconjunto de ACESSOS
    entradas: Entradas
    recortes_aceitos: tuple[str, ...]
    recortes_nao_aceitos: tuple[str, ...]
    tabelas: tuple[str, ...]
    territorio: str
    ausentes: Ausentes
    encadeados: tuple[str, ...]  # passos que a CLI roda depois, ao ser acionado pelos comandos (conferido por teste em R-7)
    orquestradores: tuple[str, ...]
    env: str | None  # só o NOME da variável de ambiente exigida
    modos: Mapping[str, Modo]
    caracterizado: bool  # há teste que chama a função de entrada do coletor (run_*/main), mesmo com dublê
    tentativas_registradas: bool  # False para o que lê por remotezip ou http.api_json (não passam por http.fetch)

    def __post_init__(self) -> None:
        _texto(self.id, "Coletor.id")
        i = f"Coletor({self.id})"
        _tupla_de_texto(self.modulos, f"{i}.modulos", obrigatoria=True)
        _tupla_de_texto(self.comandos, f"{i}.comandos", obrigatoria=True)
        _tupla_de_texto(self.tarefas, f"{i}.tarefas", obrigatoria=False)
        if not isinstance(self.fontes, tuple) or not self.fontes or not all(isinstance(f, Fonte) for f in self.fontes):
            raise ValueError(f"{i}.fontes: tupla não vazia de Fonte")
        if len({f.slug for f in self.fontes}) != len(self.fontes):
            raise ValueError(f"{i}.fontes: slug repetido")
        _tupla_de_texto(self.datasets, f"{i}.datasets", obrigatoria=True)
        _tupla_de_texto(self.acesso, f"{i}.acesso", obrigatoria=True)
        fora = [a for a in self.acesso if a not in ACESSOS]
        if fora:
            raise ValueError(f"{i}.acesso: {fora} fora de {ACESSOS}")
        if not isinstance(self.entradas, Entradas):
            raise ValueError(f"{i}.entradas: esperado Entradas")
        _tupla_de_texto(self.recortes_aceitos, f"{i}.recortes_aceitos", obrigatoria=False)
        _tupla_de_texto(self.recortes_nao_aceitos, f"{i}.recortes_nao_aceitos", obrigatoria=False)
        if set(self.recortes_aceitos) & set(self.recortes_nao_aceitos):
            raise ValueError(f"{i}: recorte declarado como aceito e não aceito ao mesmo tempo")
        faltam = [r for r in RECORTES_PADRAO if r not in self.recortes_aceitos and r not in self.recortes_nao_aceitos]
        if faltam:
            raise ValueError(f"{i}: recortes sem declaração (aceito ou não aceito): {faltam}")
        _tupla_de_texto(self.tabelas, f"{i}.tabelas", obrigatoria=False)
        if self.territorio not in TERRITORIOS:
            raise ValueError(f"{i}.territorio inválido: {self.territorio!r}; esperado um de {TERRITORIOS}")
        if not isinstance(self.ausentes, Ausentes):
            raise ValueError(f"{i}.ausentes: esperado Ausentes")
        _tupla_de_texto(self.encadeados, f"{i}.encadeados", obrigatoria=False)
        _tupla_de_texto(self.orquestradores, f"{i}.orquestradores", obrigatoria=False)
        if self.env is not None and not (isinstance(self.env, str) and _RE_ENV.match(self.env)):
            raise ValueError(f"{i}.env: só o nome da variável (MAIÚSCULAS_COM_SUBLINHADO) ou None; veio {self.env!r}")
        if not isinstance(self.modos, Mapping) or set(self.modos) != set(MODOS):
            raise ValueError(f"{i}.modos: exatamente as chaves {MODOS}")
        if not all(isinstance(m, Modo) for m in self.modos.values()):
            raise ValueError(f"{i}.modos: valores têm de ser Modo")
        object.__setattr__(self, "modos", MappingProxyType(dict(self.modos)))
        if not isinstance(self.caracterizado, bool) or not isinstance(self.tentativas_registradas, bool):
            raise ValueError(f"{i}: caracterizado e tentativas_registradas são bool")


# ---------------------------------------------------------------- R4: classe de cada arquivo

# Chave: caminho relativo a etl/civico_etl/. Conferido contra o disco por test_catalogo_forma.py.
ARQUIVOS: dict[str, Classe] = {
    # coletores
    "jobs/agenda_congresso.py": Classe.COLETOR,
    "jobs/alesp.py": Classe.COLETOR,
    "jobs/almg.py": Classe.COLETOR,
    "jobs/camara_diario.py": Classe.COLETOR,
    "jobs/camara_equipe.py": Classe.COLETOR,
    "jobs/camara_presenca.py": Classe.COLETOR,
    "jobs/governos_indicadores.py": Classe.COLETOR,
    "jobs/ibge_malhas.py": Classe.COLETOR,
    "jobs/ibge_places.py": Classe.COLETOR,
    "jobs/ibge_populacao.py": Classe.COLETOR,
    "jobs/parlamento_extras.py": Classe.COLETOR,
    "jobs/pauta.py": Classe.COLETOR,
    "jobs/receita_arrecadacao.py": Classe.COLETOR,
    "jobs/sancoes.py": Classe.COLETOR,
    "jobs/sapl.py": Classe.COLETOR,
    "jobs/senado_diario.py": Classe.COLETOR,
    "jobs/senado_extras.py": Classe.COLETOR,
    "jobs/transparencia_emendas.py": Classe.COLETOR,
    "jobs/tse_candidatos.py": Classe.COLETOR,
    "jobs/tse_votos_contas.py": Classe.COLETOR,
    # bibliotecas
    "jobs/assembleias.py": Classe.BIBLIOTECA,
    "transparencia.py": Classe.BIBLIOTECA,
    "remotezip.py": Classe.BIBLIOTECA,
    # despachante
    "jobs/ale_cli.py": Classe.DESPACHANTE,
    # derivações
    "jobs/derive_stats.py": Classe.DERIVACAO,
    "jobs/identity_dedupe.py": Classe.DERIVACAO,
    # checagens
    "jobs/checks.py": Classe.CHECAGEM,
    "jobs/checks_identity.py": Classe.CHECAGEM,
    # rotina de agenda
    "jobs/repairs.py": Classe.ROTINA_DE_AGENDA,
    # reparos pontuais
    "jobs/identity_bug033.py": Classe.REPARO_PONTUAL,
    "jobs/identity_bug038.py": Classe.REPARO_PONTUAL,
    "jobs/identity_bug041.py": Classe.REPARO_PONTUAL,
    "jobs/tse_bug019.py": Classe.REPARO_PONTUAL,
    "jobs/tse_bug032.py": Classe.REPARO_PONTUAL,
    "jobs/tse_bug035.py": Classe.REPARO_PONTUAL,
    # seed
    "jobs/seed.py": Classe.SEED,
    # fluxo de IA
    "jobs/rascunho.py": Classe.FLUXO_DE_IA,
    "jobs/revisar.py": Classe.FLUXO_DE_IA,
    "jobs/verificar.py": Classe.FLUXO_DE_IA,
}

# Casos mistos (o que o arquivo faz além da sua classe). `purge-raw` (classe MANUTENCAO) é inline em cli.py: não é arquivo, está em COMANDOS.
MISTOS: dict[str, str] = {
    "jobs/governos_indicadores.py": "carimba dataset_stamps à mão",
    "jobs/ibge_malhas.py": "grava arquivo, não tabela",
    "jobs/camara_diario.py": "exporta helpers usados por outros módulos",
    "jobs/camara_presenca.py": "exporta helpers usados por outros módulos",
    "jobs/tse_candidatos.py": "exporta helpers usados por outros módulos",
    "jobs/tse_votos_contas.py": "exporta helpers usados por outros módulos",
    "jobs/sapl.py": "parser e despacho próprios (main); fila e descoberta internas; altera http.RATE no import (sapl.py:57)",
    "jobs/sancoes.py": "parser e despacho próprios (main); troca http.RATE por CRAWL_DELAY durante a leitura do TCU (sancoes.py:77-87)",
    "jobs/senado_extras.py": "sem comando próprio; acionado por senado.diario",
    "jobs/assembleias.py": "biblioteca que também escreve (despesas, proposições, cobertura, fila de identidade) a serviço de alesp/almg; "
                           "`allowed` é o robots.txt comum (usado por sapl.py); altera http.RATE no import (assembleias.py:39)",
    "transparencia.py": "cliente da API, mais despacho (main) e checagem (ping)",
    "jobs/repairs.py": "importa funções dos reparos pontuais 032, 038 e 041 como biblioteca (repairs.py:72, :235, :244)",
    "jobs/tse_bug032.py": "importado por repairs.py como biblioteca",
    "jobs/identity_bug038.py": "importado por repairs.py como biblioteca",
    "jobs/identity_bug041.py": "importado por repairs.py como biblioteca",
}
