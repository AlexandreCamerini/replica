"""Partidos: uma linha por sigla canônica; renomeações viram aliases; fusões e incorporações NÃO são fundidas.

Ex.: PMDB→MDB, PR→PL, PRB→REPUBLICANOS são a mesma pessoa jurídica (alias). PSL+DEM→UNIÃO, PTB+PATRIOTA→PRD,
PROS→SOLIDARIEDADE, PSC→PODE são incorporações: os extintos continuam como partidos próprios na história.
Limitação registrada (R0): siglas reutilizadas por partidos diferentes (PL 1985 ≠ PL 2006) ficam numa linha só.
"""

from __future__ import annotations

from datetime import date

import psycopg

from .util import party_key

VALID_FROM = date(1979, 12, 20)  # Lei 6.767: volta do pluripartidarismo; vigência mínima comum a todos

# chave normalizada do nome antigo -> chave do nome atual (só renomeações)
RENAMES = {
    "PMDB": "MDB",
    "PTN": "PODE",
    "PODEMOS": "PODE",
    "PRB": "REPUBLICANOS",
    "PR": "PL",
    "PPS": "CIDADANIA",
    "PEN": "PATRIOTA",
    "PATRI": "PATRIOTA",
    "PTDOB": "AVANTE",
    "PSDC": "DC",
    "SD": "SOLIDARIEDADE",
    "PTC": "AGIR",
    "PMN": "MOBILIZA",
    "PROGRESSISTAS": "PP",
}
# grafia canônica quando a fonte varia ("PC do B" no TSE, "PCdoB" na Câmara)
CANON = {"PCDOB": "PCdoB", "PTDOB": "PTdoB", "UNIAO": "UNIÃO"}


class PartyResolver:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.by_key: dict[str, str] = {}
        self.aliases: set[str] = set()
        for r in conn.execute("select id, acronym from parties"):
            self.by_key[party_key(r["acronym"])] = str(r["id"])
        for r in conn.execute("select alias from party_aliases"):
            self.aliases.add(r["alias"])

    def get(self, sigla: str | None, name: str | None = None, number: str | int | None = None) -> str | None:
        if not sigla or sigla.strip() in {"", "#NULO#", "NA"}:
            return None
        raw = sigla.strip()
        key = party_key(raw)
        key = RENAMES.get(key, key)
        pid = self.by_key.get(key)
        if pid is None:
            acronym = CANON.get(key, raw if party_key(raw) == key else key)
            tse_number = int(number) if number and str(number).strip().isdigit() else None
            row = self.conn.execute(
                """insert into parties (acronym, name, tse_number, valid_from) values (%s, %s, %s, %s)
                   on conflict (acronym, valid_from) do update set name = coalesce(parties.name, excluded.name)
                   returning id""",
                (acronym, (name or acronym).strip(), tse_number, VALID_FROM),
            ).fetchone()
            pid = str(row["id"])
            self.by_key[key] = pid
        elif number and str(number).strip().isdigit():
            self.conn.execute("update parties set tse_number = coalesce(tse_number, %s) where id = %s", (int(number), pid))
        if party_key(raw) != key or raw not in self.aliases and party_key(raw) == key and raw != CANON.get(key, raw):
            self._alias(raw, pid)
        return pid

    def _alias(self, alias: str, pid: str) -> None:
        if alias in self.aliases:
            return
        self.conn.execute(
            """insert into party_aliases (alias, party_id, valid_from)
               select %s, %s, %s where not exists (select 1 from party_aliases where alias = %s)""",
            (alias, pid, VALID_FROM, alias),
        )
        self.aliases.add(alias)
