"""identity.dedupe: funde duplicatas óbvias de pessoa criadas por divergência entre fontes.

Regra (publicada): mesma cadeira (cargo + lugar + data de posse), uma linha vinda do TSE e outra da casa, mesma data de
nascimento E algum token do nome civil em comum (identity_name_tokens, o mesmo `seat_match` do resolve; D221, D245). Fica a
linha mais antiga; a outra vira redirect. Qualquer outro caso continua em identity_match_queue para decisão humana.
Antes bastava nome parlamentar igual OU nascimento igual, a mesma regra que o D221 tirou do resolve depois do BUG-033: Eli
Corrêa Filho (160532) e Geninho Zuliani, ambos de 13/01/1976 e deputados por SP desde 01/02/2019, seriam fundidos aqui de novo
se chegassem separados (um só pelo TSE, outro só pela Câmara), porque o dedupe roda depois de toda carga da Câmara e do Senado
(D245). O que pago: pessoa da casa sem nascimento, ou com nascimento diferente do TSE, não funde mais aqui (fica duplicada até
a fila/humano); hoje são 0 pares no banco pelas duas regras.
"""

from __future__ import annotations

import logging

import psycopg

log = logging.getLogger("etl.dedupe")

PAIRS_SQL = """
with cand as (
  select a.id as keep, b.id as drop_, a.display_name as an, b.display_name as bn
  from mandates ma
  join people a on a.id = ma.person_id
  join mandates mb on mb.office_id = ma.office_id and mb.place_id = ma.place_id and mb.started_on = ma.started_on and mb.person_id <> ma.person_id
  join people b on b.id = mb.person_id
  where ma.status_source = 'tse' and mb.status_source <> 'tse'
    and a.created_at <= b.created_at
    and a.birth_date is not null and a.birth_date = b.birth_date
    and identity_name_tokens(a.civil_name) && (identity_name_tokens(b.civil_name) || identity_name_tokens(b.display_name))
    and not exists (select 1 from person_external_ids e join sources s on s.id = e.source_id where e.person_id = a.id and s.slug = mb.status_source)
    and not exists (select 1 from person_external_ids e join sources s on s.id = e.source_id where e.person_id = b.id and s.slug = 'tse')
)
select distinct keep, drop_, an, bn from cand
"""


def run_dedupe(conn: psycopg.Connection) -> int:
    pairs = conn.execute(PAIRS_SQL).fetchall()
    # uma origem só pode ser fundida uma vez
    seen: set[str] = set()
    n = 0
    for p in pairs:
        if str(p["drop_"]) in seen or str(p["keep"]) in seen:
            continue
        seen.add(str(p["drop_"]))
        conn.execute("select merge_person(%s, %s)", (p["drop_"], p["keep"]))
        log.info("fundido: %r -> %r", p["bn"], p["an"])
        n += 1
    conn.commit()
    log.info("identity.dedupe: %d fusões", n)
    return n
