"""SIMULADO. Resolvedor de DNS falso para as provas sem navegador (web/e2e-admin/comum.mjs o põe no PYTHONPATH dos processos do ETL).

Por que existe: desde a F3-T1 (AC-23/AC-24) a decisão que grava `base_url` resolve o host e recusa o que não resolve só para IP público (etl/civico_etl/admin/rede_segura.py). As
fixtures do ensaio usam hosts `.invalid` (RFC 2606), que nunca resolvem, então a decisão do passo 9 da primeira rodada falharia fechada num ensaio sem rede. Aqui, e só aqui,
`socket.getaddrinfo` devolve um IP PÚBLICO fixo (93.184.216.34, documentação) para nomes terminados em `.invalid`; o resto vai ao resolvedor de verdade.
Nenhuma conexão é aberta por isto: as respostas HTTP do ensaio são fabricadas (etl/tests/simulado.py). O arquivo não entra em nenhum processo de produção nem do site.
"""

import socket

_real = socket.getaddrinfo
_IP_FALSO = "93.184.216.34"


def _getaddrinfo(host, port, *args, **kwargs):
    if isinstance(host, str) and host.lower().rstrip(".").endswith(".invalid"):
        return _real(_IP_FALSO, port, *args, **kwargs)
    return _real(host, port, *args, **kwargs)


socket.getaddrinfo = _getaddrinfo
