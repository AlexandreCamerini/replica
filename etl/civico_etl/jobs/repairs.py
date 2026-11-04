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


# ordem fixa da rotina: (nome, passo). Novo passo entra aqui, com a justificativa no docstring do módulo e uma decisão.
STEPS: tuple[tuple[str, Callable[..., int]], ...] = (
    ("titulos", sync_titles),
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
