"""civico-etl identity.repairs [--apply]: os reparos de identidade que a rotina ainda precisa rodar depois das cargas (D245).

Chamado depois de `tse.candidatos` e de `camara.diario`/`senado.diario` (que já rodam `identity.dedupe`). Sem --apply é
dry-run: conta o que mudaria e não grava. Cada passo é idempotente (segunda execução = 0 mudanças) e não-destrutivo (só insere
ou atualiza; nunca apaga fato).

Ordem (fixa; um passo só lê o que os anteriores deixaram):
  1. `titulos`: tse_titulo_candidatura (migrações 0065/0066) com TODAS as linhas do consulta_cand 2012–2026 de cada título do
     diretório. O loader só grava as linhas que lê (o ano e as UFs da carga; só eleitos no modo padrão) e só dos títulos que
     conhece naquele momento: um título que entra na carga de 2024 não ganha as linhas de 2012, já carregado. Os checks do
     BUG-038/039/041/043 e o `reissue` do resolve (BUG-042: dois títulos na mesma eleição são duas pessoas) leem essa tabela.
     Antes, só o `--apply` do identity.fix038/fix041 a completava.
  2. `mandatos_tse`: mandato de vereador, prefeito ou vice cuja única fonte é a candidatura do TSE (`status_source = 'tse'`)
     e cuja candidatura a fonte rebaixou para NÃO ELEITO ou suplente (retotalização) sai do exercício: `encerrado`, com
     `ends_on` na data em que o TSE publicou o arquivo revisto e o motivo em `vacancy_note`. Nada é apagado; a linha anterior
     vai inteira para identity_split_log (BUG-049). Se a Câmara Municipal confirma o vereador no SAPL (parlamentar casado com
     mandato da legislatura em curso), a casa vence e o mandato fica. Roda depois de `titulos` porque lê o resultado já
     gravado pela carga. Fica aqui, e não no loader, porque cruza duas fontes (TSE e SAPL) que carregam em horas diferentes, e o
     loader no modo padrão (só eleitos) nem lê a linha rebaixada (D251).

Os seis reparos de uma vez só (D245). Nenhum entra na rotina: a regra de cada um está na carga, e o `check` (checks_identity e
o invariante de presidente do D168) acusa se o defeito voltar. Os jobs continuam no cli para resposta a incidente.
  - tse.fix019 (presidente 2x): `remotezip.pick_members` lê só o …_BRASIL.csv (D165). Legado.
  - tse.fix032 (SQ sem o ano): a chave é `tse_key(ano, SQ)` (D210); o classify do fix032 dá 0 numa carga do zero. Legado.
  - tse.fix035 (2012 ANO:UE:SQ): `tse_key` exige a UE em 2012 (D224); rekey e restore dão 0. Legado.
  - identity.fix033 (+ .devolver): resolve com `seat_match` e trava do id único (D221). O identity.dedupe ainda fundia na
    mesma cadeira por "nascimento igual OU nome parlamentar igual" (Eli Corrêa x Geninho, ambos de 13/01/1976): passou a exigir
    nascimento igual E token do nome civil em comum (D245). Legado.
  - identity.fix038 (nome + nascimento sem lugar): `corroborate` no resolve (D235); lista curada de 11 casos. Legado.
  - identity.fix041 (BUG-041/042/043): `foreign_row`, `reissue` e `registration_rank` no resolve/loader (D240–D242). O passo 1
    dele (preencher tse_titulo_candidatura) não estava na carga: é o passo `titulos` acima. O resto é legado.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from typing import Any

import psycopg

from ..util import chunked

log = logging.getLogger("etl.repairs")

TITLE_COLS = ["titulo", "year", "ue", "tse_sequencial", "kind", "uf", "cargo", "result", "civil_name", "birth_date", "ballot_number"]
BATCH = 20000


def _source_title_rows(titles: set[str]) -> list[tuple]:
    """Linhas de tse_titulo_candidatura dos títulos pedidos, lidas do consulta_cand de todos os anos (cache do ETL)."""
    from .identity_bug038 import source_by_titles
    from .tse_candidatos import title_rows

    return title_rows(source_by_titles(titles), titles)


def sync_titles(conn: psycopg.Connection, *, apply: bool, source: Callable[[set[str]], Iterable[tuple]] = _source_title_rows,
                commit: bool = True) -> int:
    """Passo `titulos`. Devolve quantas linhas mudam (novas ou com alguma coluna diferente da fonte). Linha do banco que a fonte
    não tem mais fica (não-destrutivo) e só sai no log. `commit=False`: não fecha a transação por lote (testes)."""
    titles = {r["external_id"] for r in conn.execute(
        "select x.external_id from person_external_ids x join sources s on s.id = x.source_id where s.slug = 'tse-titulo'")}
    if not titles:
        return 0
    have: dict[tuple, tuple] = {}
    for r in conn.execute(f"select {', '.join(TITLE_COLS)} from tse_titulo_candidatura where titulo = any(%s)", (sorted(titles),)):
        v = tuple(r[c] for c in TITLE_COLS)
        have[v[:4]] = v
    want: dict[tuple, tuple] = {}
    for v in source(titles):
        want[tuple(v[:4])] = tuple(v)
    diff = [v for k, v in want.items() if have.get(k) != v]
    orphans = len(set(have) - set(want))
    log.info("titulos: %d títulos, %d linhas na fonte, %d no banco, %d a gravar%s", len(titles), len(want), len(have), len(diff),
             f", {orphans} só no banco (ficam)" if orphans else "")
    if not apply or not diff:
        return len(diff)
    n = 0
    for chunk in chunked(diff, BATCH):
        cur = conn.cursor()
        cur.execute("drop table if exists tmp_titulos")
        cur.execute("create temp table tmp_titulos (like tse_titulo_candidatura including defaults) on commit drop")
        with cur.copy(f"copy tmp_titulos ({', '.join(TITLE_COLS)}) from stdin") as cp:
            for v in chunk:
                cp.write_row(v)
        upd = ", ".join(f"{c} = excluded.{c}" for c in TITLE_COLS[4:])
        dist = " or ".join(f"t.{c} is distinct from excluded.{c}" for c in TITLE_COLS[4:])
        cur.execute(
            f"""insert into tse_titulo_candidatura as t ({', '.join(TITLE_COLS)})
                select {', '.join(TITLE_COLS)} from tmp_titulos
                on conflict (titulo, year, ue, tse_sequencial) do update set {upd}, updated_at = now() where {dist}""")
        n += cur.rowcount
        if commit:
            conn.commit()  # lotes curtos: o dev server lê o banco
    return n


DEMOTE_OFFICES = ("vereador", "prefeito", "vice_prefeito")
DEMOTE_RESULTS = ("nao_eleito", "suplente")
BUG_049 = "BUG-049"

_DEMOTE_SQL = """
select m.*, c.result, c.tse_sequencial, e.year, e.kind as election_kind, ct.place_id as contest_place, o.slug as office
from mandates m join candidacies c on c.id = m.candidacy_id join elections e on e.id = c.election_id
join contests ct on ct.id = c.contest_id join offices o on o.id = m.office_id
where m.status_source = 'tse' and m.status in ('em_exercicio', 'eleito_aguardando_posse')
  and o.slug = any(%(offices)s) and c.result = any(%(results)s)
"""
# a casa confirma: parlamentar do SAPL casado com a pessoa, na câmara do município, com mandato que não acabou
_SAPL_CONFIRMA = """
select 1 from sapl_parlamentares sp join sapl_houses h on h.id = sp.house_id
join sapl_mandatos sm on sm.house_id = sp.house_id and sm.parlamentar_sapl_id = sp.sapl_id
where sp.person_id = %(person)s and sp.match_status = 'casado' and h.place_id = %(place)s
  and (sm.ended_on is null or sm.ended_on > current_date) and (sm.started_on is null or sm.started_on <= current_date)
limit 1
"""


def _published_on(year: int):
    """Data em que o TSE publicou o consulta_cand do ano que está no cache (Last-Modified); sem cache, hoje."""
    import json
    from datetime import date
    from email.utils import parsedate_to_datetime

    from ..http import _paths
    from .tse_candidatos import BASE

    _, meta = _paths(f"{BASE}/consulta_cand/consulta_cand_{year}.zip")
    try:
        lm = json.loads(meta.read_text()).get("last_modified")
        return parsedate_to_datetime(lm).date() if lm else date.today()
    except (OSError, ValueError, TypeError):
        return date.today()


def demote_tse_mandates(conn: psycopg.Connection, *, apply: bool, published_on: Callable[[int], Any] = _published_on,
                        commit: bool = True) -> int:
    """Passo `mandatos_tse` (BUG-049). Devolve quantos mandatos saem do exercício."""
    import json

    rows = conn.execute(_DEMOTE_SQL, {"offices": list(DEMOTE_OFFICES), "results": list(DEMOTE_RESULTS)}).fetchall()
    n = kept = waiting = 0
    for m in rows:
        if conn.execute(_SAPL_CONFIRMA, {"person": m["person_id"], "place": m["place_id"]}).fetchone():
            kept += 1
            log.info("mandatos_tse: %s fica: a Câmara Municipal confirma no SAPL (a casa vence)", m["id"])
            continue
        when = published_on(m["year"])
        if when <= m["started_on"]:
            # rebaixado antes da posse: não há data de fim válida (ends_on > started_on); relata e não mexe
            waiting += 1
            log.error("mandatos_tse: %s rebaixado antes da posse (%s); decidir à mão", m["id"], m["started_on"])
            continue
        when = min(when, m["ends_on"])
        note = (f"retotalização do TSE publicada em {when:%d/%m/%Y}: a candidatura de {m['year']} (SQ {m['tse_sequencial']}) passou a "
                f"{'NÃO ELEITO' if m['result'] == 'nao_eleito' else 'SUPLENTE'} no consulta_cand; o mandato sai do exercício (D251)")
        n += 1
        log.info("mandatos_tse: %s %s -> encerrado em %s", m["id"], m["office"], when)
        if not apply:
            continue
        raw = {k: v for k, v in m.items() if k not in ("result", "tse_sequencial", "year", "election_kind", "contest_place", "office")}
        conn.execute(
            """insert into identity_split_log (bug, source, external_id, person_id, table_name, action, row_key, raw, note)
               values (%s, 'tse', %s, %s, 'mandates', 'alterado', %s, %s, %s)
               on conflict (bug, source, external_id, table_name, row_key) do nothing""",
            (BUG_049, f"{m['year']}:{m['tse_sequencial']}", m["person_id"], str(m["id"]), json.dumps(raw, default=str, ensure_ascii=False), note))
        conn.execute(
            """update mandates set status = 'encerrado', ends_on = %s, vacancy_note = %s, updated_at = now()
               where id = %s and status in ('em_exercicio', 'eleito_aguardando_posse') and status_source = 'tse'""",
            (when, note, m["id"]))
    if apply and commit:
        conn.commit()
    if kept or waiting:
        log.info("mandatos_tse: %d mantidos pelo SAPL, %d rebaixados antes da posse (não mexidos)", kept, waiting)
    return n


# ordem fixa da rotina: (nome, passo). Novo passo entra aqui, com a justificativa no docstring do módulo e uma decisão.
STEPS: tuple[tuple[str, Callable[..., int]], ...] = (
    ("titulos", sync_titles),
    ("mandatos_tse", demote_tse_mandates),
)


def run_identity_repairs(conn: psycopg.Connection, *, apply: bool) -> dict[str, int]:
    """Roda os passos de STEPS em ordem. Devolve {passo: mudanças} (dry-run: as que seriam gravadas). Falha num passo
    interrompe os seguintes (eles leem o resultado do anterior) e propaga a exceção; o que o passo já gravou fica (lotes com
    commit, cada um idempotente), e a próxima execução retoma."""
    out: dict[str, int] = {}
    for name, step in STEPS:
        try:
            out[name] = int(step(conn, apply=apply))
        except Exception:
            conn.rollback()
            log.exception("identity.repairs: passo %s falhou; os seguintes não rodaram", name)
            raise
        log.info("identity.repairs %s (%s): %d mudança(s)", name, "aplicado" if apply else "dry-run", out[name])
    return out


def legacy() -> dict[str, Any]:
    """Os reparos de uma vez só e onde a regra deles vive agora (D245). Só documentação para quem chama."""
    return {
        "tse.fix019": "remotezip.pick_members (D165)",
        "tse.fix032": "tse_candidatos.tse_key ANO:SQ (D210)",
        "tse.fix035": "tse_candidatos.tse_key 2012 ANO:UE:SQ (D224)",
        "identity.fix033": "identity.seat_match/_free (D221) + identity_dedupe.PAIRS_SQL (D245)",
        "identity.fix038": "identity.corroborate (D235)",
        "identity.fix041": "identity.foreign_row/reissue, tse_candidatos.registration_rank (D240-D242); passo 1 -> 'titulos'",
    }
