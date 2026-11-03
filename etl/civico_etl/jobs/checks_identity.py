"""Invariantes de identidade (BUG-032, D212; BUG-033 e BUG-035, D223 e D225). Separado de checks.py para não disputar o arquivo; checks.run_checks chama
run_identity_checks e soma as falhas.

O SQ_CANDIDATO do TSE só é único dentro da eleição, e o TSE reaproveita os números entre anos. A chave da pessoa no TSE é
(ano, SQ), e em 2012, (ano, UE, SQ): o arquivo de 2012 repete o SQ entre a eleição ordinária e as suplementares (BUG-035). Duas candidaturas de anos diferentes só são da mesma pessoa com prova da fonte (título de eleitor ou nome civil +
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
        "identidade: chave do TSE em person_external_ids fora do formato (ANO:SQ; em 2012, ANO:UE:SQ, D224)",
        """select count(*) from person_external_ids e join sources s on s.id = e.source_id
           where s.slug = 'tse' and not (case when e.external_id like '2012:%%' then e.external_id ~ '^2012:[0-9A-Z]+:[0-9]+$'
                                             else e.external_id ~ '^[0-9]{4}:[0-9]+$' end)""",
    ),
    (
        "identidade: chave ANO:SQ do TSE ligada a uma pessoa e a candidatura desse ano e SQ a outra",
        """select count(*) from person_external_ids x join sources s on s.id = x.source_id and s.slug = 'tse'
           join elections e on e.year = split_part(x.external_id, ':', 1)::int
           join candidacies c on c.election_id = e.id and c.tse_sequencial = split_part(x.external_id, ':', 2)
           where x.external_id ~ '^[0-9]{4}:[0-9]+$' and c.person_id <> x.person_id""",
    ),
    (
        # 2012: o SQ se repete entre ordinária e suplementar (BUG-035); a chave ANO:UE:SQ tem de ser de quem tem uma candidatura com o SQ
        "identidade: chave 2012:UE:SQ do TSE de uma pessoa sem candidatura de 2012 com esse SQ (que existe noutra pessoa)",
        """select count(*) from person_external_ids x join sources s on s.id = x.source_id and s.slug = 'tse'
           where x.external_id ~ '^2012:[0-9A-Z]+:[0-9]+$'
             and exists (select 1 from candidacies c join elections e on e.id = c.election_id
                         where e.year = 2012 and c.tse_sequencial = split_part(x.external_id, ':', 3))
             and not exists (select 1 from candidacies c join elections e on e.id = c.election_id
                             where e.year = 2012 and c.tse_sequencial = split_part(x.external_id, ':', 3) and c.person_id = x.person_id)""",
    ),
    (
        "identidade: candidatura do TSE sem a chave ANO:SQ (2012: ANO:UE:SQ) na própria pessoa",
        """select count(*) from candidacies c join elections e on e.id = c.election_id
           where not exists (select 1 from person_external_ids x join sources s on s.id = x.source_id and s.slug = 'tse'
                             where x.person_id = c.person_id
                               and (x.external_id = e.year || ':' || c.tse_sequencial
                                    or (e.year = 2012 and x.external_id like '2012:%%:' || c.tse_sequencial)))""",
    ),
    (
        # sintoma do BUG-035: as duas linhas de um SQ repetido de 2012 (municípios diferentes) na mesma pessoa
        "identidade: mesma pessoa com duas candidaturas do mesmo ano e SQ em municípios diferentes",
        """select count(*) from (select c.person_id, e.year, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
                                join contests ct on ct.id = c.contest_id
                                group by 1, 2, 3 having count(distinct ct.place_id) > 1) x""",
    ),
    (
        # BUG-033: a Câmara e o Senado publicam um id por pessoa; dois ids na mesma pessoa é fusão de duas pessoas
        "identidade: pessoa com mais de um id da Câmara ou do Senado",
        """select count(*) from (select e.person_id, s.slug from person_external_ids e join sources s on s.id = e.source_id
                                where s.slug in ('camara', 'senado') group by 1, 2 having count(*) > 1) x""",
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
