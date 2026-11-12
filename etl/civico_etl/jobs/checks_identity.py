"""Invariantes de identidade (BUG-032, D212; BUG-033 e BUG-035, D223 e D225; BUG-038 e BUG-039, D237 e D238; BUG-041 e BUG-043, D240 e D242; BUG-044). Separado de checks.py para não disputar o arquivo; checks.run_checks chama
run_identity_checks e soma as falhas. IDENTITY_CHECKS são SQL; IDENTITY_PY_CHECKS precisam da regra de nome do resolve (BUG-044).

O SQ_CANDIDATO do TSE só é único dentro da eleição, e o TSE reaproveita os números entre anos. A chave da pessoa no TSE é
(ano, SQ), e em 2012, (ano, UE, SQ): o arquivo de 2012 repete o SQ entre a eleição ordinária e as suplementares (BUG-035). Duas candidaturas de anos diferentes só são da mesma pessoa com prova da fonte (título de eleitor ou nome civil +
nascimento), registrada em identity_repair_log por civico-etl tse.fix032.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

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
    (
        # BUG-038: ninguém concorre em dois municípios na mesma eleição. Dois títulos da mesma pessoa que aparecem na fonte na
        # mesma eleição ordinária, em UEs diferentes, são duas pessoas fundidas (tse_titulo_candidatura, migração 0065).
        # Título reemitido no mesmo município (18 casos legítimos) não dispara: a UE é a mesma ou o ano é outro.
        "identidade: pessoa com dois títulos de eleitor que concorrem na mesma eleição em municípios diferentes",
        """select count(distinct x1.person_id) from person_external_ids x1 join sources s on s.id = x1.source_id and s.slug = 'tse-titulo'
           join person_external_ids x2 on x2.person_id = x1.person_id and x2.source_id = x1.source_id and x2.external_id > x1.external_id
           join tse_titulo_candidatura a on a.titulo = x1.external_id and a.kind = 'ordinaria'
           join tse_titulo_candidatura b on b.titulo = x2.external_id and b.kind = 'ordinaria' and b.year = a.year and b.ue <> a.ue""",
    ),
    (
        # BUG-039 (e BUG-036): quem a fonte dá como eleito numa eleição ordinária tem a candidatura eleita desse ano no crachá. Pega
        # o registro substituído que ficou no lugar do eleito (Divino/PA, 2012) e a eleição antiga que não foi carregada.
        # Fora: suplente de senador (cargo sem mandato próprio, não carregado; fica com o código cru do TSE).
        "identidade: título com linha ELEITO na fonte e pessoa sem candidatura eleita nesse ano",
        """select count(*) from tse_titulo_candidatura t join person_external_ids x on x.external_id = t.titulo
           join sources s on s.id = x.source_id and s.slug = 'tse-titulo'
           where t.kind = 'ordinaria' and t.result in ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') and t.cargo !~ '^[0-9]+$'
             and not exists (select 1 from candidacies c join elections e on e.id = c.election_id
                             where c.person_id = x.person_id and e.year = t.year and c.result in ('eleito', 'eleito_qp', 'eleito_media'))""",
    ),
    (
        # BUG-041 (D240): o TSE repete o título de uma pessoa na linha de outra. Candidatura cuja linha da fonte (pelo título da
        # pessoa, ano e SQ) tem nascimento diferente E nome civil sem nenhum token em comum com a pessoa é de outra pessoa.
        # Só um dos dois divergente é digitação, nome social ou casamento (1.594 nascimentos e 6 nomes no banco) e não dispara.
        "identidade: candidatura cuja linha da fonte tem outro nascimento e nome civil sem token em comum com a pessoa",
        """select count(distinct c.id) from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
           join person_external_ids x on x.person_id = p.id join sources s on s.id = x.source_id and s.slug = 'tse-titulo'
           join tse_titulo_candidatura t on t.titulo = x.external_id and t.year = e.year and t.tse_sequencial = c.tse_sequencial
           where t.birth_date is not null and p.birth_date is not null and t.birth_date <> p.birth_date
             and not (identity_name_tokens(t.civil_name) && (identity_name_tokens(p.civil_name) || identity_name_tokens(p.display_name)))""",
    ),
    (
        # BUG-043 (D242): registro substituído. Na mesma disputa (ano, tipo, UE, cargo, número e título) a fonte tem um registro
        # de posto maior (eleito > foi à urna > INAPTO/#NULO#) que a pessoa não tem no banco. Estende o check do D238 a quem não
        # foi eleito. As suplementares com os 2 registros no banco (Reverificação 3) não disparam: os 2 estão na pessoa.
        "identidade: registro substituído no banco com registro de posto maior na fonte para a mesma disputa e número",
        """select count(distinct c.id) from candidacies c join elections e on e.id = c.election_id
           join person_external_ids x on x.person_id = c.person_id join sources s on s.id = x.source_id and s.slug = 'tse-titulo'
           join tse_titulo_candidatura a on a.titulo = x.external_id and a.year = e.year and a.tse_sequencial = c.tse_sequencial
           join tse_titulo_candidatura b on b.titulo = a.titulo and b.year = a.year and b.ue = a.ue and b.kind = a.kind
                and b.cargo = a.cargo and b.ballot_number = a.ballot_number and b.tse_sequencial <> a.tse_sequencial
           where tse_registration_rank(b.result) > tse_registration_rank(a.result)
             and not exists (select 1 from candidacies c2 join elections e2 on e2.id = c2.election_id
                             where c2.person_id = c.person_id and e2.year = b.year and c2.tse_sequencial = b.tse_sequencial)""",
    ),
]


# BUG-044: candidaturas cuja linha da fonte (pelo título da pessoa, ano e SQ) pode ser de outra pessoa: nascimento diferente,
# ou o título em 2+ SQ da mesma eleição (a ordinária do ano, ou a suplementar da mesma UE). A decisão final é em Python
# (`bug044_offenders`), com a mesma regra do resolve: o SQL não tem distância de edição sem extensão nova.
BUG044_SQL = """
select c.id::text candidacy_id, p.slug, e.year, c.tse_sequencial, p.civil_name p_civil, p.display_name p_display, p.birth_date p_birth,
       t.civil_name, t.birth_date,
       array(select t2.civil_name from tse_titulo_candidatura t2
             where t2.titulo = t.titulo and t2.year = t.year and t2.kind = t.kind and (t.kind = 'ordinaria' or t2.ue = t.ue)
               and t2.tse_sequencial <> t.tse_sequencial and t2.civil_name is not null) others
from candidacies c join elections e on e.id = c.election_id join people p on p.id = c.person_id
join person_external_ids x on x.person_id = p.id join sources s on s.id = x.source_id and s.slug = 'tse-titulo'
join tse_titulo_candidatura t on t.titulo = x.external_id and t.year = e.year and t.tse_sequencial = c.tse_sequencial
where (t.birth_date is not null and p.birth_date is not null and t.birth_date <> p.birth_date)
   or exists (select 1 from tse_titulo_candidatura t2
              where t2.titulo = t.titulo and t2.year = t.year and t2.kind = t.kind and (t.kind = 'ordinaria' or t2.ue = t.ue)
                and t2.tse_sequencial <> t.tse_sequencial)
"""


def bug044_offenders(conn: psycopg.Connection) -> list[dict]:
    """Candidaturas na pessoa errada pela regra do BUG-044 (identity.title_row_foreign e shared_title), a mesma do resolve:
    (a) nascimento diferente e a linha não prova a pessoa: nome civil vazio, nenhum token em comum (D240), primeiro nome que
    não bate (`first_name_match`: igual com um token do resto em comum, ou grafia sem troca de gênero e com o resto igual) ou
    sufixo de geração diferente a 14 anos ou mais (pai e filho); ou (b) o título está em 2 SQ da mesma eleição com nomes de
    pessoas diferentes e o nome da linha não é o da pessoa. Contém o check do D240: tudo o que ele acusa, este acusa (o D240
    é o ramo "nenhum token em comum" de (a), com a mesma seleção de linhas)."""
    from ..identity import first_name_match, names_differ, title_row_foreign

    out = []
    for r in conn.execute(BUG044_SQL):
        if title_row_foreign(r["civil_name"], r["birth_date"], r["p_civil"], r["p_display"], r["p_birth"]):
            out.append({**r, "motivo": "nascimento diferente e nome de outra pessoa"})
        elif any(names_differ(r["civil_name"], o) for o in r["others"]) and not first_name_match(r["civil_name"], r["p_civil"], r["p_display"]):
            out.append({**r, "motivo": "título em 2 SQ da mesma eleição, linha com o nome de outra pessoa"})
    return out


# checks que precisam de Python (regra de nome do resolve); cada um devolve a contagem de falhas
IDENTITY_PY_CHECKS: list[tuple[str, Callable[[psycopg.Connection], int]]] = [
    (
        "identidade: candidatura cuja linha da fonte é de outra pessoa pelo título repetido (BUG-044: outro nascimento e outro "
        "primeiro nome, ou o título em 2 SQ da mesma eleição)",
        lambda conn: len({r["candidacy_id"] for r in bug044_offenders(conn)}),
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
    for name, fn in IDENTITY_PY_CHECKS:
        n = fn(conn)
        if n:
            failed += 1
            log.error("FALHOU: %s (%s)", name, n)
        else:
            log.info("ok: %s", name)
    return failed
