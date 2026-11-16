"""Catálogo declarativo de comandos e coletores do ETL (Parte R do plano de admin de coleta).

Importar este pacote não importa nenhum módulo de `civico_etl.jobs` e não altera `civico_etl.http.RATE`.
"""

from .comandos import COLETORES_PENDENTES, COMANDOS, comando
from .coletores import COLETORES, coletor, por_comando, por_tarefa
from .contrato import Descricao, Recorte, descrever, executar, runner_subprocesso
from . import contrato as _contrato
from . import adaptadores_a as _adaptadores_a, adaptadores_b as _adaptadores_b, adaptadores_c as _adaptadores_c  # noqa: F401  (registram os adaptadores)

_contrato._EXPLICACOES.update(_adaptadores_a.EXPLICACOES_A)
from .modelo import ARQUIVOS, MISTOS, Ausentes, Classe, Coletor, Comando, Entradas, Fonte, Modo

__all__ = [
    "ARQUIVOS", "MISTOS", "COMANDOS", "COLETORES", "COLETORES_PENDENTES",
    "Ausentes", "Classe", "Coletor", "Comando", "Entradas", "Fonte", "Modo",
    "Descricao", "Recorte", "comando", "coletor", "por_comando", "por_tarefa",
    "descrever", "executar", "runner_subprocesso",
]
