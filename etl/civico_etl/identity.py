"""Casamento de identidade entre fontes. O pior erro do produto é mostrar os votos de uma pessoa no crachá de outra.

Ordem (architecture.md › Identidade):
  1. id oficial já conhecido na fonte (person_external_ids)          -> exact_id, 1.0
  2. título de eleitor publicado pelo TSE (fonte 'tse-titulo')        -> exact_id, 1.0
  3. nome civil + data de nascimento, casamento único                 -> name_birth, 0.95
  4. nome civil + nascimento + UF de nascimento, único                -> name_birth_place, 0.9
  Abaixo disso (ambíguo): vai para identity_match_queue e NÃO cria vínculo. Sem nenhum candidato: pessoa nova.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

import psycopg

from .util import fold, slugify

log = logging.getLogger("etl.identity")


@dataclass
class Match:
    person_id: str | None
    method: str  # exact_id | name_birth | name_birth_place | new | queued
    confidence: float


class PersonResolver:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.sources: dict[str, str] = {r["slug"]: str(r["id"]) for r in conn.execute("select slug, id from sources")}
        self.external: dict[tuple[str, str], str] = {}
        self.by_name_birth: dict[tuple[str, date | None], set[str]] = defaultdict(set)
        self.birth_uf: dict[str, str | None] = {}
        self.slugs: set[str] = set()
        for r in conn.execute("select person_id, source_id, external_id from person_external_ids"):
            self.external[(str(r["source_id"]), r["external_id"])] = str(r["person_id"])
        for r in conn.execute(
            """select p.id, p.slug, p.display_name, p.civil_name, p.birth_date, b.uf
               from people p left join places b on b.id = p.birthplace_place_id"""
        ):
            pid = str(r["id"])
            self.slugs.add(r["slug"])
            self.birth_uf[pid] = r["uf"]
            for n in {fold(r["civil_name"]), fold(r["display_name"])}:
                if n:
                    self.by_name_birth[(n, r["birth_date"])].add(pid)
        for r in conn.execute("select old_slug from person_slug_redirects"):
            self.slugs.add(r["old_slug"])
        self._pending_ext: list[tuple[str, str, str, str, float]] = []
        self._pending_queue: list[tuple[str, str, str, str | None, float | None]] = []

    # ---- consulta ----
    def by_external(self, source: str, external_id: str) -> str | None:
        return self.external.get((self.sources[source], external_id))

    def resolve(
        self,
        *,
        source: str,
        external_id: str,
        civil_name: str | None,
        birth_date: date | None,
        birth_uf: str | None = None,
        titulo: str | None = None,
        raw: dict[str, Any] | None = None,
        seat: tuple[str, str] | None = None,
        display_name: str | None = None,
    ) -> Match:
        pid = self.by_external(source, external_id)
        if pid:
            return Match(pid, "exact_id", 1.0)
        if titulo:
            pid = self.by_external("tse-titulo", titulo)
            if pid:
                self.link(pid, source, external_id, "exact_id", 1.0)
                return Match(pid, "exact_id", 1.0)
        if civil_name and birth_date and len(self.by_name_birth.get((fold(civil_name), birth_date), set())) == 1:
            # nome civil + nascimento único vence a cadeira (mais específico)
            pid = next(iter(self.by_name_birth[(fold(civil_name), birth_date)]))
            self.link(pid, source, external_id, "name_birth", 0.95)
            if titulo:
                self.link(pid, "tse-titulo", titulo, "exact_id", 1.0)
            return Match(pid, "name_birth", 0.95)
        if seat and (display_name or birth_date):
            # cadeira conhecida (cargo + lugar): nome parlamentar igual ou mesmo nascimento entre quem já tem mandato nela
            office_id, place_id = seat
            rows = self.conn.execute(
                """select distinct p.id, p.display_name, p.birth_date from mandates m join people p on p.id = m.person_id
                   where m.office_id = %s and m.place_id = %s and m.started_on >= current_date - interval '9 years'""",
                (office_id, place_id),
            ).fetchall()
            key = re.sub(r"[^a-z0-9]", "", fold(display_name)) if display_name else None
            hits = {str(r["id"]) for r in rows if (key and re.sub(r"[^a-z0-9]", "", fold(r["display_name"])) == key) or (birth_date and r["birth_date"] == birth_date)}
            if len(hits) == 1:
                pid = next(iter(hits))
                self.link(pid, source, external_id, "name_birth_place", 0.9)
                if titulo:
                    self.link(pid, "tse-titulo", titulo, "exact_id", 1.0)
                return Match(pid, "name_birth_place", 0.9)
        if civil_name and birth_date:
            cands = self.by_name_birth.get((fold(civil_name), birth_date), set())
            if len(cands) == 1:
                pid = next(iter(cands))
                self.link(pid, source, external_id, "name_birth", 0.95)
                if titulo:
                    self.link(pid, "tse-titulo", titulo, "exact_id", 1.0)
                return Match(pid, "name_birth", 0.95)
            if len(cands) > 1 and birth_uf:
                narrowed = {c for c in cands if self.birth_uf.get(c) == birth_uf}
                if len(narrowed) == 1:
                    pid = next(iter(narrowed))
                    self.link(pid, source, external_id, "name_birth_place", 0.9)
                    return Match(pid, "name_birth_place", 0.9)
            if cands:
                self._pending_queue.append((self.sources[source], external_id, json.dumps(raw or {}, ensure_ascii=False, default=str), next(iter(cands)), 0.5))
                return Match(None, "queued", 0.5)
        return Match(None, "new", 0.0)

    # ---- escrita ----
    def link(self, person_id: str, source: str, external_id: str, method: str, confidence: float) -> None:
        key = (self.sources[source], external_id)
        if key in self.external:
            return
        self.external[key] = person_id
        self._pending_ext.append((person_id, self.sources[source], external_id, method, confidence))

    def alloc_slug(self, display_name: str, *hints: str | None) -> str:
        """nome -> nome-uf -> nome-cargo-uf -> nome-uf-2... Publicado, nunca muda (redirect cuida do resto)."""
        base = slugify(display_name)
        cands = [base]
        acc = base
        for h in hints:
            if h:
                acc = f"{acc}-{slugify(h)}"
                cands.append(acc)
        for c in cands:
            if c not in self.slugs:
                self.slugs.add(c)
                return c
        n = 2
        while f"{cands[-1]}-{n}" in self.slugs:
            n += 1
        s = f"{cands[-1]}-{n}"
        self.slugs.add(s)
        return s

    def create(
        self,
        *,
        display_name: str,
        civil_name: str | None,
        gender: str | None,
        birth_date: date | None,
        birthplace_place_id: str | None,
        education: str | None,
        slug_hints: tuple[str | None, ...] = (),
        source: str,
        external_id: str,
        titulo: str | None = None,
        photo_source_url: str | None = None,
    ) -> str:
        slug = self.alloc_slug(display_name, *slug_hints)
        row = self.conn.execute(
            """insert into people (slug, display_name, civil_name, gender, birth_date, birthplace_place_id, education, photo_source_url)
               values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
            (slug, display_name, civil_name, gender, birth_date, birthplace_place_id, education, photo_source_url),
        ).fetchone()
        pid = str(row["id"])
        self.birth_uf[pid] = None
        for n in {fold(civil_name), fold(display_name)}:
            if n:
                self.by_name_birth[(n, birth_date)].add(pid)
        self.link(pid, source, external_id, "exact_id", 1.0)
        if titulo:
            self.link(pid, "tse-titulo", titulo, "exact_id", 1.0)
        return pid

    def flush(self) -> tuple[int, int]:
        """Grava vínculos e fila acumulados. Chame antes do commit."""
        from .db import upsert

        n_ext = len(self._pending_ext)
        if self._pending_ext:
            upsert(
                self.conn,
                "person_external_ids",
                ["person_id", "source_id", "external_id", "match_method", "match_confidence"],
                self._pending_ext,
                ["source_id", "external_id"],
                update=[],
            )
            self._pending_ext = []
        n_q = len(self._pending_queue)
        if self._pending_queue:
            upsert(
                self.conn,
                "identity_match_queue",
                ["source_id", "external_id", "raw", "candidate_person_id", "confidence"],
                self._pending_queue,
                ["source_id", "external_id"],
                update=["raw", "candidate_person_id", "confidence"],
                where="identity_match_queue.status = 'pendente'",
            )
            self._pending_queue = []
        if n_q:
            log.warning("%d casamentos ambíguos foram para identity_match_queue", n_q)
        return n_ext, n_q
