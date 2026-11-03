"""Invariantes de identidade (BUG-032, D212). Separado de checks.py para não disputar o arquivo; checks.run_checks chama
run_identity_checks e soma as falhas.

O SQ_CANDIDATO do TSE só é único dentro da eleição, e o TSE reaproveita os números entre anos. A chave da pessoa no TSE é
(ano, SQ) e duas candidaturas de anos diferentes só são da mesma pessoa com prova da fonte (título de eleitor ou nome civil +
nascimento), registrada em identity_repair_log por civico-etl tse.fix032.
"""

from __future__ import annotations

import logging

import psycopg

log = logging.getLogger("etl.check")

IDENTITY_CHECKS: list[tuple[str, str]] = [
    (
        "identidade: mesma pessoa com o mesmo SQ_CANDIDATO em anos diferentes sem prova da fonte (título ou nome + nascimento)",
        """with x as (select c.person_id, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
                      group by 1, 2 having count(distinct e.year) > 1)
           select count(*) from candidacies c join x on x.person_id = c.person_id and x.tse_sequencial = c.tse_sequencial
           where not exists (select 1 from identity_repair_log l
                             where l.candidacy_id = c.id and l.to_person_id = c.person_id
                               and l.action in ('confirmado', 'religado') and l.basis in ('titulo', 'nome_nasc'))""",
    ),
    (
        "identidade: chave do TSE em person_external_ids sem o ano (tem de ser ANO:SQ_CANDIDATO)",
        """select count(*) from person_external_ids e join sources s on s.id = e.source_id
           where s.slug = 'tse' and e.external_id !~ '^[0-9]{4}:[0-9]+$'""",
    ),
    (
        "identidade: chave ANO:SQ do TSE ligada a uma pessoa e a candidatura desse ano e SQ a outra",
        """select count(*) from person_external_ids x join sources s on s.id = x.source_id and s.slug = 'tse'
           join elections e on e.year = split_part(x.external_id, ':', 1)::int
           join candidacies c on c.election_id = e.id and c.tse_sequencial = split_part(x.external_id, ':', 2)
           where x.external_id ~ '^[0-9]{4}:[0-9]+$' and c.person_id <> x.person_id""",
    ),
]


def run_identity_checks(conn: psycopg.Connection) -> int:
    failed = 0
    for name, q in IDENTITY_CHECKS:
        n = list(conn.execute(q).fetchone().values())[0]
        if n:
            failed += 1
            log.error("FALHOU: %s (%s)", name, n)
        else:
            log.info("ok: %s", name)
    return failed
