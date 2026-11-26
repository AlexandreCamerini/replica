"""F4 do roteiro do eleitor: a subconsulta de orientação da bancada que o SITE usa roda no Postgres e devolve a bancada certa.

`web/src/lib/data/pg.ts` importa `server-only` e não roda fora do Next, então este teste LÊ o texto das duas subconsultas `orient` do arquivo
(`getRecentLawVotesForPeople`, alias `x`, e `listVotes`, aliases `e` e `v`) e as executa pelo psycopg num cenário montado e revertido (nada
persiste). Se o site mudar a consulta, o teste roda a nova; se a tirar, ele acusa.

Casos: orientação do próprio partido; partido liberado; partido dentro de um bloco (via `bloc_members`); partido E bloco (o partido vale);
governo (nunca é a bancada da pessoa); bloco do qual o partido NÃO é membro; voto sem partido. O que não tem orientação ligada devolve null:
a tela mostra a lacuna, nunca um chute.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

PG_TS = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "data" / "pg.ts"


def _subconsultas() -> tuple[str, str]:
    ts = PG_TS.read_text(encoding="utf-8")
    achadas = re.findall(r"\(select jsonb_build_object\('valor'.*?limit 1\) as orient", ts, flags=re.S)
    assert len(achadas) == 2, "pg.ts deve ter a subconsulta de orientação em getRecentLawVotesForPeople e em listVotes"
    # ordem do arquivo: getRecentLawVotesForPeople (alias x) vem antes de listVotes (aliases e e v)
    return achadas[0], achadas[1]


def _partido(c, sigla: str):
    return c.execute("insert into parties (acronym, name, valid_from) values (%s, %s, '2000-01-01') returning id", (sigla, f"Partido {sigla}")).fetchone()["id"]


def _cenario(c):
    lugar = c.execute("select p.id from places p where not exists (select 1 from legislative_bodies b where b.place_id = p.id) limit 1").fetchone()
    if not lugar:
        pytest.skip("nenhum lugar livre no banco de teste para criar a casa do cenário")
    casa = c.execute("insert into legislative_bodies (kind, place_id, name) values ('camara_municipal', %s, 'Casa de teste F4') returning id", (lugar["id"],)).fetchone()["id"]
    ev = c.execute(
        "insert into voting_events (body_id, occurred_at, kind, is_nominal, description, source_key) values (%s, now(), 'texto', true, 'Votação de teste F4', 'tf4') returning id",
        (casa,),
    ).fetchone()["id"]
    p = {k: _partido(c, f"TF4{k}") for k in "ABCDEFG"}

    def ator(kind: str, party, label: str) -> str:
        return c.execute("insert into orientation_actors (kind, party_id, label, body_id) values (%s, %s, %s, %s) returning id", (kind, party, label, casa)).fetchone()["id"]

    def orienta(actor, valor: str) -> None:
        c.execute("insert into party_orientations (voting_event_id, actor_id, orientation) values (%s, %s, %s)", (ev, actor, valor))

    orienta(ator("partido", p["A"], "TF4A"), "sim")  # A orientou Sim
    orienta(ator("partido", p["B"], "TF4B"), "liberado")  # B liberou
    bloco_cd = ator("bloco", None, "Bloco TF4C, TF4D")
    orienta(bloco_cd, "nao")  # bloco de C e D orientou Não
    for pid in (p["C"], p["D"]):
        c.execute("insert into bloc_members (actor_id, party_id) values (%s, %s)", (bloco_cd, pid))
    orienta(ator("partido", p["D"], "TF4D"), "abstencao")  # D também tem orientação própria: o partido vale mais que o bloco
    orienta(ator("governo", None, "Governo"), "sim")  # governo: nunca é a bancada da pessoa
    bloco_f = ator("bloco", None, "Bloco TF4F")
    orienta(bloco_f, "sim")  # bloco do qual E e G NÃO são membros (F não tem membros)

    pessoas: dict[str, str] = {}
    for nome, partido in [("a", p["A"]), ("b", p["B"]), ("c", p["C"]), ("d", p["D"]), ("e", p["E"]), ("g", p["G"]), ("semp", None)]:
        pid = c.execute("insert into people (slug, display_name) values (%s, %s) returning id", (f"tf4-{nome}", f"Pessoa TF4 {nome}")).fetchone()["id"]
        c.execute("insert into votes (voting_event_id, person_id, party_id, value) values (%s, %s, %s, 'sim')", (ev, pid, partido))
        pessoas[nome] = pid
    return ev, pessoas


ESPERADO = {
    "a": {"valor": "sim", "quem": "TF4A", "tipo": "partido"},
    "b": {"valor": "liberado", "quem": "TF4B", "tipo": "partido"},
    "c": {"valor": "nao", "quem": "Bloco TF4C, TF4D", "tipo": "bloco"},
    "d": {"valor": "abstencao", "quem": "TF4D", "tipo": "partido"},  # partido E bloco: vale o partido
    "e": None,  # só há orientação de governo e de um bloco do qual não é membro
    "g": None,
    "semp": None,  # voto sem partido: sem chute
}


def _por_pessoa(c, sql: str, ev):
    linhas = c.execute(sql, (ev,)).fetchall()
    assert len(linhas) == 7, "uma linha por voto (a subconsulta nunca duplica nem some com a linha)"
    return {r["slug"].removeprefix("tf4-"): r["orient"] for r in linhas}


def test_a_subconsulta_de_getrecentlawvotesforpeople_devolve_a_bancada_certa(rw):
    sub_x, _ = _subconsultas()
    ev, _ = _cenario(rw)
    sql = f"""select pe.slug, {sub_x}
              from (select v.person_id, v.party_id, e.id from votes v join voting_events e on e.id = v.voting_event_id where e.id = %s) x
              join people pe on pe.id = x.person_id"""
    assert _por_pessoa(rw, sql, ev) == ESPERADO


def test_a_subconsulta_de_listvotes_devolve_a_bancada_certa(rw):
    _, sub_lista = _subconsultas()
    ev, _ = _cenario(rw)
    sql = f"""select pe.slug, {sub_lista}
              from votes v join voting_events e on e.id = v.voting_event_id join people pe on pe.id = v.person_id
              where e.id = %s"""
    assert _por_pessoa(rw, sql, ev) == ESPERADO


def test_nenhuma_orientacao_de_governo_maioria_minoria_ou_oposicao_vira_bancada(rw):
    """Se só houver orientação de governo (ou maioria, minoria, oposição) na votação, a pessoa fica sem orientação (lacuna), nunca com a do governo."""
    _, sub_lista = _subconsultas()
    ev, _ = _cenario(rw)
    casa = rw.execute("select body_id from voting_events where id = %s", (ev,)).fetchone()["body_id"]
    for kind in ["maioria", "minoria", "oposicao"]:
        ator = rw.execute("insert into orientation_actors (kind, party_id, label, body_id) values (%s, null, %s, %s) returning id", (kind, f"Ator {kind}", casa)).fetchone()["id"]
        rw.execute("insert into party_orientations (voting_event_id, actor_id, orientation) values (%s, %s, 'nao')", (ev, ator))
    sql = f"""select pe.slug, {sub_lista}
              from votes v join voting_events e on e.id = v.voting_event_id join people pe on pe.id = v.person_id
              where e.id = %s"""
    assert _por_pessoa(rw, sql, ev)["e"] is None
