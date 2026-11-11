"""Casamento de identidade entre fontes. O pior erro do produto é mostrar os votos de uma pessoa no crachá de outra.

Ordem (architecture.md › Identidade):
  1. id oficial já conhecido na fonte (person_external_ids)          -> exact_id, 1.0
  2. título de eleitor publicado pelo TSE (fonte 'tse-titulo')        -> exact_id, 1.0
  3. nome civil + data de nascimento, casamento único                 -> name_birth, 0.95
  4. nome civil + nascimento + UF de nascimento, único                -> name_birth_place, 0.9
  4b. cadeira conhecida (cargo + lugar, quem teve mandato nela): exige o MESMO nascimento E algum token do nome civil em
      comum (BUG-033, D221). Nome parlamentar igual não basta (pai e filho: Átila Lira, João Carlos Bacelar) e nascimento
      igual também não (Eli Corrêa Filho x Geninho Zuliani, ambos de 13/01/1976 na bancada de SP).
  Abaixo disso (ambíguo): vai para identity_match_queue e NÃO cria vínculo. Sem nenhum candidato: pessoa nova.
  Fontes com um id por pessoa (Câmara, Senado): quem já tem outro id da mesma fonte não é candidato a casar (D221).
  Título de eleitor é id forte (BUG-038, D235): nos ramos de nome (3, 4 e 4b), quem já tem um título diferente do da linha
  nunca casa (vai para a fila). E nome civil + nascimento só casa com lugar em comum: a UF da linha (ou a de nascimento) tem
  de estar na trajetória da pessoa (UF de mandato, candidatura ou nascimento). Sem isso, fila. Antes bastava o nome + nascimento
  únicos no diretório inteiro, e dois "José Antonio da Silva, 20/05/1963" (São Luís e Rio Grande) viraram uma pessoa.
  Título repetido pelo TSE (BUG-041, D240): o TSE às vezes põe na linha de uma pessoa o título de outra (Virginia Pereira de
  Oliveira 2012 com o título de Willya José da Silva). Título igual com nascimento diferente E nome civil sem nenhum token em
  comum com a pessoa não casa: a linha segue sem título pelos outros ramos (pessoa nova ou fora do diretório, D34).
  BUG-044: um token em comum não basta (Silva, Maria, sobrenome de família ou de etnia). Com nascimento diferente, o primeiro
  nome tem de bater (igual, ou grafia a até 2 edições com o resto do nome igual; `first_name_match`). E o título que aparece
  em 2 SQ da mesma eleição com primeiros nomes diferentes não prova nenhuma linha daquele ano (`shared_title`).
  Título reemitido (BUG-042, D241): título desconhecido, MESMO município (a pessoa tem mandato ou candidatura nele), MESMO
  nascimento e nome civil a no máximo 2 edições, com as diferenças só de grafia (s/z, m/n final, y/i, letra dobrada, h mudo):
  casa, e o log diz por quê. Mais fraco que isso (outra grafia que não é só fonética, só a mesma UF, nascimento diferente no
  mesmo município, ou os dois títulos na mesma eleição): fila. Gêmeos no mesmo município existem (Marcos x Márcio Pereira da
  Silva, Araranguá, 18/01/1981) e ficam na fila, não fundidos.
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


# a casa publica um id por pessoa: uma pessoa do diretório com dois ids da Câmara (ou do Senado) é fusão de duas pessoas
SINGLE_ID_SOURCES = {"camara", "senado"}
# partículas e sufixos de parentesco não identificam ninguém ("Filho" é justamente o que separa pai e filho)
NAME_STOP = {"de", "da", "do", "das", "dos", "e", "d", "filho", "filha", "neto", "neta", "junior", "jr", "sobrinho", "segundo", "terceiro"}


def name_tokens(name: str | None) -> set[str]:
    """Tokens significativos do nome civil, sem acento e sem partículas."""
    return {t for t in re.split(r"[^a-z0-9]+", fold(name)) if len(t) >= 2 and t not in NAME_STOP}


def names_compatible(civil_name: str | None, person_civil: str | None, person_display: str | None) -> bool:
    """Nome civil da linha compatível com a pessoa: algum token significativo em comum (BUG-041). Grafia, nome social e
    casamento quase sempre mantêm um token; Virginia Pereira de Oliveira x Willya José da Silva não tem nenhum."""
    return bool(name_tokens(civil_name) & (name_tokens(person_civil) | name_tokens(person_display)))


def first_name(name: str | None) -> str | None:
    """Primeiro nome, sem acento e em minúsculas. Hífen, ponto e espaço separam (BUG-044): "AURI-WULANGE RIBEIRO" -> "auri",
    para bater com "Auri Wulange Ribeiro" da mesma pessoa."""
    return next((t for t in re.split(r"[^a-z0-9]+", fold(name)) if t), None)


def _rest_jaccard(a: str | None, b: str | None) -> float:
    """Jaccard dos tokens significativos do nome sem o primeiro nome."""
    fa, fb = first_name(a), first_name(b)
    ta, tb = name_tokens(a) - {fa}, name_tokens(b) - {fb}
    return len(ta & tb) / len(ta | tb) if ta | tb else 0.0


def first_name_match(civil_name: str | None, person_civil: str | None, person_display: str | None) -> bool:
    """O primeiro nome da linha bate com o da pessoa (BUG-044):
    - igual ao primeiro nome civil ou ao de exibição;
    - ou a 1 ou 2 edições do primeiro nome CIVIL, com o resto do nome quase igual (Jaccard >= 0,5 dos outros tokens):
      Teresinha x Terezinha, Luis x Luiz, Edmar x Edemar, letras trocadas a 2 edições (sobrenomes iguais). Sem o resto,
      José x João Santos "da Silva" (2 edições) casariam. A troca a/o no fim (Paulo x Paula) nunca é grafia. O nome de
      exibição só vale igual: "Dr Auri", "Zé", "Di" são curtos demais para distância de edição.
    Limite: irmãos com o mesmo sobrenome inteiro e primeiros nomes a até 2 edições (José x João Pereira da Silva) ainda
    casam se o TSE repetir o título de um na linha do outro; a regra não tem como separá-los de uma grafia.
    Não pega outra pessoa com o mesmo sobrenome: Genilde x Renata Silva, Djalmiro x Sarah Urbieta, Daora x Kotsario
    Kanamari, Maria Isabel x Silvana Maria."""
    f = first_name(civil_name)
    if not f:
        return False
    fc, fd = first_name(person_civil), first_name(person_display)
    if f in (fc, fd):
        return True
    return bool(fc) and edit_distance(f, fc) <= 2 and not _gender_flip(f, fc) and _rest_jaccard(civil_name, person_civil) >= 0.5


def _gender_flip(a: str, b: str) -> bool:
    """Paulo x Paula, Maria x Mário, Antônio x Antônia: 1 edição, mas é o nome do irmão ou da irmã, não grafia (BUG-044)."""
    return len(a) == len(b) and a[:-1] == b[:-1] and {a[-1], b[-1]} == {"a", "o"}


def title_row_foreign(civil_name: str | None, birth_date: date | None, person_civil: str | None, person_display: str | None,
                      person_birth: date | None) -> bool:
    """A linha com o título da pessoa é de outra pessoa (BUG-041, D240; BUG-044). Só com nascimento diferente (os dois
    publicados): é outra pessoa se o nome civil não tem nenhum token em comum com a pessoa (D240) OU se o primeiro nome não
    bate a até 2 edições (BUG-044: um "Silva", "Maria" ou sobrenome de família em comum não prova nada). A regra nova contém
    a do D240: nunca casa o que o D240 recusava. Nascimento igual não é decidido aqui (ver PersonResolver.shared_title)."""
    if not (birth_date and person_birth and civil_name) or birth_date == person_birth:
        return False
    return not names_compatible(civil_name, person_civil, person_display) or not first_name_match(civil_name, person_civil, person_display)


def names_differ(a: str | None, b: str | None) -> bool:
    """Dois nomes civis da fonte com o mesmo título na mesma eleição são de pessoas diferentes: primeiros nomes a mais de 2
    edições (BUG-044). Registro substituído da mesma pessoa com grafia variante não conta (Luiz x Luis e um sobrenome
    com uma letra trocada, mesmo nascimento, 2012): aqui o critério é mais frouxo que o de `first_name_match` de propósito, porque
    cada linha ainda passa por `title_row_foreign` contra a pessoa."""
    fa, fb = first_name(a), first_name(b)
    return bool(fa and fb) and edit_distance(fa, fb) > 2


def election_key(kind: str | None, ue: str | None) -> tuple[str, str]:
    """"Mesma eleição" dentro do ano de um título: a ordinária é uma só; cada suplementar é a da sua UE."""
    return (kind or "", "" if kind == "ordinaria" else (ue or "").strip())


def edit_distance(a: str, b: str, limit: int = 2) -> int:
    """Levenshtein com corte: devolve limit + 1 assim que passar do limite."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        if min(cur) > limit:
            return limit + 1
        prev = cur
    return prev[-1]


_PHON = [(r"ph", "f"), (r"th", "t"), (r"y", "i"), (r"w", "v"), (r"k", "c"), (r"z", "s"), (r"m\b", "n"), (r"m(?=[^aeiou ])", "n"),
         (r"(?<![cln])h", ""), (r"([a-z])\1+", r"\1")]


def phonetic(name: str | None) -> str:
    """Forma fonética do nome para a reemissão (BUG-042): ELOISA = Eloiza, GASPERIM = Gasperin, Willian = Wiliam.
    Marcos x Márcio, Evaldo x Evandro e Kassâmio x Kassio continuam diferentes."""
    s = re.sub(r"[^a-z ]", "", fold(name))
    for pat, rep in _PHON:
        s = re.sub(pat, rep, s)
    return re.sub(r"\s+", " ", s).strip()


def seat_match(civil_name: str | None, birth_date: date | None, person_civil: str | None, person_display: str | None, person_birth: date | None) -> bool:
    """Ramo da cadeira (BUG-033): mesma data de nascimento E algum token do nome civil em comum. Sem os dois, não é prova."""
    if not (civil_name and birth_date and person_birth) or birth_date != person_birth:
        return False
    return bool(name_tokens(civil_name) & (name_tokens(person_civil) | name_tokens(person_display)))


@dataclass
class Match:
    person_id: str | None
    method: str  # exact_id | name_birth | name_birth_place | new | queued
    confidence: float
    title_foreign: bool = False  # o título da linha é de outra pessoa (BUG-041): quem cria a pessoa não anexa o título
    why: str | None = None  # motivo do casamento quando não é óbvio (reemissão de título, BUG-042)


class PersonResolver:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self.sources: dict[str, str] = {r["slug"]: str(r["id"]) for r in conn.execute("select slug, id from sources")}
        self.external: dict[tuple[str, str], str] = {}
        self.by_name_birth: dict[tuple[str, date | None], set[str]] = defaultdict(set)
        self.birth_uf: dict[str, str | None] = {}
        self.slugs: set[str] = set()
        self.titles: dict[str, set[str]] = defaultdict(set)  # pessoa -> títulos de eleitor (BUG-038)
        self.ufs: dict[str, set[str]] = defaultdict(set)  # pessoa -> UFs da trajetória (mandatos e candidaturas)
        self.single_src = {sid for slug, sid in self.sources.items() if slug in SINGLE_ID_SOURCES}
        self.holds: dict[str, set[str]] = defaultdict(set)  # pessoa -> fontes de id único em que ela já tem id
        for r in conn.execute("select person_id, source_id, external_id from person_external_ids"):
            self.external[(str(r["source_id"]), r["external_id"])] = str(r["person_id"])
            if str(r["source_id"]) in self.single_src:
                self.holds[str(r["person_id"])].add(str(r["source_id"]))
            if str(r["source_id"]) == self.sources.get("tse-titulo"):
                self.titles[str(r["person_id"])].add(r["external_id"])
        self.place_uf: dict[str, str | None] = {}
        self.muni_places: set[str] = set()
        for r in conn.execute("select id, uf, kind from places"):
            self.place_uf[str(r["id"])] = r["uf"]
            if r["kind"] == "municipio":
                self.muni_places.add(str(r["id"]))
        # pessoa -> municípios da trajetória (mandato ou candidatura) e o inverso, para a reemissão de título (BUG-042)
        self.places: dict[str, set[str]] = defaultdict(set)
        self.place_people: dict[str, set[str]] = defaultdict(set)
        for r in conn.execute(
            """select m.person_id, m.place_id from mandates m union
               select c.person_id, ct.place_id from candidacies c join contests ct on ct.id = c.contest_id"""
        ):
            if str(r["place_id"]) in self.muni_places:
                self.places[str(r["person_id"])].add(str(r["place_id"]))
                self.place_people[str(r["place_id"])].add(str(r["person_id"]))
        # pessoa -> anos de eleição ordinária em que algum título dela concorre (tse_titulo_candidatura): dois títulos na mesma
        # eleição são duas pessoas, nunca reemissão
        self.title_years: dict[str, set[int]] = defaultdict(set)
        tit_owner = {t: p for p, ts in self.titles.items() for t in ts}
        # (título, ano) -> eleição -> SQ -> nome civil da linha: o mesmo título em 2 SQ da mesma eleição com nomes diferentes
        # é título repetido pelo TSE, e nenhuma linha desse título nesse ano casa pelo título (BUG-044)
        self.title_rows: dict[tuple[str, int], dict[tuple[str, str], dict[str, str | None]]] = defaultdict(lambda: defaultdict(dict))
        for r in conn.execute("select titulo, year, ue, tse_sequencial, kind, civil_name from tse_titulo_candidatura"):
            if r["kind"] == "ordinaria" and r["titulo"] in tit_owner:
                self.title_years[tit_owner[r["titulo"]]].add(r["year"])
            self.title_rows[(r["titulo"], r["year"])][election_key(r["kind"], r["ue"])][r["tse_sequencial"]] = r["civil_name"]
        self.info: dict[str, tuple[str | None, str | None, date | None]] = {}  # pessoa -> (nome civil, nome de exibição, nascimento)
        self.by_birth: dict[date, set[str]] = defaultdict(set)
        for r in conn.execute(
            """select m.person_id, pl.uf from mandates m join places pl on pl.id = m.place_id where pl.uf is not null
               union select c.person_id, pl.uf from candidacies c join contests ct on ct.id = c.contest_id join places pl on pl.id = ct.place_id
               where pl.uf is not null"""
        ):
            self.ufs[str(r["person_id"])].add(r["uf"])
        for r in conn.execute(
            """select p.id, p.slug, p.display_name, p.civil_name, p.birth_date, b.uf
               from people p left join places b on b.id = p.birthplace_place_id"""
        ):
            pid = str(r["id"])
            self.slugs.add(r["slug"])
            self.birth_uf[pid] = r["uf"]
            self.info[pid] = (r["civil_name"], r["display_name"], r["birth_date"])
            if r["birth_date"]:
                self.by_birth[r["birth_date"]].add(pid)
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

    def _free(self, cands: set[str], source: str) -> set[str]:
        """Tira quem já tem outro id desta fonte, se ela publica um id por pessoa."""
        sid = self.sources[source]
        if sid not in self.single_src:
            return set(cands)
        return {c for c in cands if sid not in self.holds.get(c, ())}

    def free(self, cands: set[str], source: str) -> set[str]:
        """Público: a trava do id único (D221) para quem casa por fora do resolve (ex.: nome de urna em camara_diario)."""
        return self._free(cands, source)

    def title_conflict(self, pid: str, titulo: str | None) -> bool:
        """A linha traz um título e a pessoa já tem outro: são pessoas diferentes (BUG-038). Reemissão de título existe, mas
        não dá para provar pelo nome; vai para a fila."""
        return bool(titulo) and bool(self.titles.get(pid)) and titulo not in self.titles[pid]

    def same_place(self, pid: str, uf: str | None, birth_uf: str | None) -> bool:
        """Lugar em comum entre a linha e a pessoa: UF da linha ou de nascimento na trajetória (mandato, candidatura, nascimento)."""
        mine = self.ufs.get(pid, set()) | ({self.birth_uf[pid]} if self.birth_uf.get(pid) else set())
        return bool({u for u in (uf, birth_uf) if u} & mine)

    def foreign_row(self, pid: str, civil_name: str | None, birth_date: date | None) -> bool:
        """A linha com o título da pessoa é de outra pessoa (BUG-041, BUG-044): nascimento diferente e o nome não prova a
        mesma pessoa (nenhum token em comum, ou primeiro nome a mais de 2 edições). `title_row_foreign`."""
        civ, disp, birth = self.info.get(pid, (None, None, None))
        return title_row_foreign(civil_name, birth_date, civ, disp, birth)

    def note_title_rows(self, trows: list[tuple]) -> None:
        """Linhas da carga (tuplas de tse_candidatos.title_rows) para `shared_title`: a carga pode trazer o ano antes de o
        passo `titulos` gravar as linhas em tse_titulo_candidatura."""
        for t in trows:
            titulo, year, ue, sq, kind, civil = t[0], t[1], t[2], t[3], t[4], t[8]
            self.title_rows[(titulo, year)][election_key(kind, ue)].setdefault(sq, civil)

    def shared_title(self, titulo: str | None, year: int | None) -> bool:
        """O título aparece em 2 SQ da mesma eleição do ano com nomes de pessoas diferentes (Paty do Alferes/RJ 2012: Maria
        Isabel de Sá Mamedir, 1943, e Silvana Maria da Rocha Marques, 1970). Ninguém concorre duas vezes na mesma eleição com
        outro nome: o título não prova nenhuma das linhas desse ano, nem a da pessoa (BUG-044)."""
        if not (titulo and year):
            return False
        for by_sq in self.title_rows.get((titulo, year), {}).values():
            names = [n for n in by_sq.values() if n]
            if any(names_differ(a, b) for i, a in enumerate(names) for b in names[i + 1:]):
                return True
        return False

    def reissue(self, titulo: str | None, civil_name: str | None, birth_date: date | None, place_id: str | None, year: int | None,
                uf: str | None = None, birth_uf: str | None = None) -> tuple[set[str], set[str], dict[str, str]]:
        """Título reemitido (BUG-042, D241). Devolve (casáveis, fila, motivo por pessoa).
        Casável: mesmo município da trajetória, mesmo nascimento, nome civil a <= 2 edições e igual na forma fonética.
        Fila: nome a <= 2 edições com mesmo nascimento fora disso, com lugar em comum (UF) ou sem título na pessoa, ou mesmo
        município com o mesmo nome civil e outro nascimento. Título diferente sem lugar em comum é outra pessoa (D235).
        Nenhum dos dois quando um título da pessoa concorre na mesma eleição da linha: aí são duas pessoas (Jairo Stupp 1967 e
        1970 em Aurora/SC 2012; Kássio e Kassâmio Leal Paraíba em Inhuma/PI 2016)."""
        ok: set[str] = set()
        weak: set[str] = set()
        why: dict[str, str] = {}
        if not civil_name:
            return ok, weak, why
        name, ph = fold(civil_name), None
        muni = str(place_id) if place_id and str(place_id) in self.muni_places else None
        def same_election(pid: str) -> bool:
            # a linha tem título e um título da pessoa concorre na mesma eleição: são duas pessoas (gêmeos, homônimos), nem fila
            return bool(titulo and year and year in self.title_years.get(pid, ()))

        if birth_date:
            for pid in self.by_birth.get(birth_date, ()):
                if titulo and titulo in self.titles.get(pid, ()) or same_election(pid):
                    continue
                pciv = self.info[pid][0]
                d = edit_distance(name, fold(pciv))
                if d > 2:
                    continue
                ph = ph or phonetic(civil_name)
                if muni and muni in self.places.get(pid, ()) and phonetic(pciv) == ph:
                    ok.add(pid)
                    why[pid] = (f"título {titulo} reemitido: mesmo município, mesmo nascimento ({birth_date}) e nome civil "
                                f"'{civil_name}' x '{pciv}' a {d} edição(ões), só de grafia (BUG-042, D241)")
                elif self.same_place(pid, uf, birth_uf) or not self.titles.get(pid):
                    weak.add(pid)
        if muni:
            # mesmo município e mesmo nome civil, outro nascimento (Marcos do Santa Clara, 1988 x 1986): fila
            for pid in self.place_people.get(muni, ()):
                pciv, _, pb = self.info.get(pid, (None, None, None))
                if pid not in ok and pb != birth_date and pciv and fold(pciv) == name and not same_election(pid):
                    weak.add(pid)
        return ok, weak - ok, why

    def corroborate(self, cands: set[str], titulo: str | None, uf: str | None, birth_uf: str | None) -> tuple[set[str], set[str]]:
        """Separa os candidatos por nome + nascimento em (casáveis, ambíguos); o resto é outra pessoa.
        Casável: sem título em conflito e com lugar em comum. Ambíguo (fila): título diferente no mesmo lugar (pode ser título
        reemitido) ou sem título em conflito e sem lugar em comum. Título diferente e lugar nenhum em comum: outra pessoa."""
        ok, amb = set(), set()
        for c in cands:
            conflict, near = self.title_conflict(c, titulo), self.same_place(c, uf, birth_uf)
            if near and not conflict:
                ok.add(c)
            elif near or not conflict:
                amb.add(c)
        return ok, amb

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
        uf: str | None = None,
        place_id: str | None = None,
        year: int | None = None,
    ) -> Match:
        pid = self.by_external(source, external_id)
        if pid:
            return Match(pid, "exact_id", 1.0)
        foreign = False
        # '-4' (não divulgável) e outras sentinelas do TSE não são título: ligariam todas essas linhas à mesma pessoa
        titulo = titulo if titulo and re.fullmatch(r"\d{6,}", titulo.strip()) else None
        if titulo:
            pid = self.by_external("tse-titulo", titulo)
            shared = bool(pid) and self.shared_title(titulo, year)
            if pid and (shared or self.foreign_row(pid, civil_name, birth_date)):
                # BUG-041 (D240) e BUG-044: o TSE repetiu nesta linha o título da pessoa; a linha é de outra pessoa, ou o título
                # está em 2 SQ da mesma eleição com nomes diferentes e não prova nenhuma. Segue sem o título pelos outros ramos.
                c, _, b = self.info[pid]
                log.warning("título %s repetido pelo TSE%s: linha '%s' (%s) x pessoa '%s' (%s); não casa pelo título (%s %s)",
                            titulo, " em 2 SQ da mesma eleição" if shared else "", civil_name, birth_date, c, b, source, external_id)
                foreign, titulo = True, None
            elif pid:
                self.link(pid, source, external_id, "exact_id", 1.0)
                return Match(pid, "exact_id", 1.0)
        m = self._resolve_names(source=source, external_id=external_id, civil_name=civil_name, birth_date=birth_date, birth_uf=birth_uf,
                                titulo=titulo, raw=raw, seat=seat, uf=uf, place_id=place_id, year=year)
        m.title_foreign = foreign
        return m

    def _resolve_names(self, *, source: str, external_id: str, civil_name: str | None, birth_date: date | None, birth_uf: str | None,
                       titulo: str | None, raw: dict[str, Any] | None, seat: tuple[str, str] | None, uf: str | None,
                       place_id: str | None, year: int | None) -> Match:
        uf = (uf or (self.place_uf.get(str(seat[1])) if seat else None) or "").upper() or None
        if uf == "BR":
            uf = None
        nb_all = self.by_name_birth.get((fold(civil_name), birth_date), set()) if civil_name and birth_date else set()
        nb, blocked = self.corroborate(self._free(nb_all, source), titulo, uf, birth_uf)
        blocked |= nb_all - self._free(nb_all, source)  # já tem outro id da casa (D221): fila
        if len(nb) == 1:
            # nome civil + nascimento único, sem título em conflito e com lugar em comum: vence a cadeira (mais específico)
            pid = next(iter(nb))
            self._link_name(pid, source, external_id, titulo, uf, "name_birth", 0.95)
            return Match(pid, "name_birth", 0.95)
        if seat and civil_name and birth_date:
            # cadeira conhecida (cargo + lugar), entre quem já tem mandato nela: mesmo nascimento E token do nome civil em comum
            # (D221). Antes bastava nome parlamentar igual OU nascimento igual, e isso fundiu pai com filho e dois colegas de bancada.
            office_id, place_id = seat
            rows = self.conn.execute(
                """select distinct p.id, p.display_name, p.civil_name, p.birth_date from mandates m join people p on p.id = m.person_id
                   where m.office_id = %s and m.place_id = %s and m.started_on >= current_date - interval '9 years'""",
                (office_id, place_id),
            ).fetchall()
            hits = self._free({str(r["id"]) for r in rows if seat_match(civil_name, birth_date, r["civil_name"], r["display_name"], r["birth_date"])}, source)
            # a cadeira já é lugar em comum: título diferente aqui pode ser reemissão, vai para a fila
            blocked |= {h for h in hits if self.title_conflict(h, titulo)}
            hits = {h for h in hits if not self.title_conflict(h, titulo)}
            if len(hits) > 1:  # ambíguo não funde
                self._pending_queue.append((self.sources[source], external_id, json.dumps(raw or {}, ensure_ascii=False, default=str), None, 0.5))
                return Match(None, "queued", 0.5)
            if len(hits) == 1:
                pid = next(iter(hits))
                self._link_name(pid, source, external_id, titulo, uf, "name_birth_place", 0.9)
                return Match(pid, "name_birth_place", 0.9)
        # título reemitido no mesmo município (BUG-042, D241): casa se for um só e nada mais forte estiver na fila
        ok, weak, why = self.reissue(titulo, civil_name, birth_date, place_id, year, uf, birth_uf) if source == "tse" else (set(), set(), {})
        if len(ok) == 1 and not nb and not (blocked - ok):
            pid = next(iter(ok))
            self._link_name(pid, source, external_id, titulo, uf, "name_birth_place", 0.9)
            if place_id and str(place_id) in self.muni_places:
                self.places[pid].add(str(place_id))
            log.info("casou por reemissão de título: %s -> pessoa %s: %s", external_id, pid, why[pid])
            return Match(pid, "name_birth_place", 0.9, why=why[pid])
        blocked |= ok | weak
        # mais de um casável, ou só ambíguos (título diferente no mesmo lugar, sem lugar em comum, ou já com outro id da casa,
        # ou grafia parecida sem a prova da reemissão): fila. Não funde nem cria um homônimo (D221, D235, D241).
        held = nb or blocked
        if held:
            self._pending_queue.append((self.sources[source], external_id, json.dumps(raw or {}, ensure_ascii=False, default=str), sorted(held)[0], 0.5))
            return Match(None, "queued", 0.5)
        return Match(None, "new", 0.0)

    # ---- escrita ----
    def _link_name(self, pid: str, source: str, external_id: str, titulo: str | None, uf: str | None, method: str, conf: float) -> None:
        self.link(pid, source, external_id, method, conf)
        if titulo:
            self.link(pid, "tse-titulo", titulo, "exact_id", 1.0)
        if uf:
            self.ufs[pid].add(uf)

    def link(self, person_id: str, source: str, external_id: str, method: str, confidence: float) -> None:
        key = (self.sources[source], external_id)
        if key in self.external:
            return
        self.external[key] = person_id
        if key[0] in self.single_src:
            self.holds[person_id].add(key[0])
        if source == "tse-titulo":
            self.titles[person_id].add(external_id)
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
        uf: str | None = None,
        place_id: str | None = None,
    ) -> str:
        slug = self.alloc_slug(display_name, *slug_hints)
        row = self.conn.execute(
            """insert into people (slug, display_name, civil_name, gender, birth_date, birthplace_place_id, education, photo_source_url)
               values (%s, %s, %s, %s, %s, %s, %s, %s) returning id""",
            (slug, display_name, civil_name, gender, birth_date, birthplace_place_id, education, photo_source_url),
        ).fetchone()
        pid = str(row["id"])
        self.birth_uf[pid] = self.place_uf.get(str(birthplace_place_id)) if birthplace_place_id else None
        if uf and uf.upper() != "BR":
            self.ufs[pid].add(uf.upper())
        self.info[pid] = (civil_name, display_name, birth_date)
        if birth_date:
            self.by_birth[birth_date].add(pid)
        if place_id and str(place_id) in self.muni_places:
            self.places[pid].add(str(place_id))
            self.place_people[str(place_id)].add(pid)
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
