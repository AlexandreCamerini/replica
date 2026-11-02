"""identity.dedupe: funde duplicatas óbvias de pessoa criadas por divergência entre fontes.

Regra (publicada): mesma cadeira (cargo + lugar + data de posse), uma linha vinda do TSE e outra da casa,
e nome parlamentar igual (sem acento/pontuação) OU mesma data de nascimento. Fica a linha mais antiga; a outra
vira redirect. Qualquer outro caso continua em identity_match_queue para decisão humana.
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
    and (regexp_replace(f_unaccent(lower(a.display_name)), '[^a-z0-9]', '', 'g') = regexp_replace(f_unaccent(lower(b.display_name)), '[^a-z0-9]', '', 'g')
         or (a.birth_date is not null and a.birth_date = b.birth_date))
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
