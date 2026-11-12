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
  2. `historico` (BUG-053): quem entra no diretório por uma carga recente (D07: só eleito com mandato atual cria pessoa) ganha
     as candidaturas das eleições antigas do próprio título, que a carga daquele ano não trouxe porque a pessoa ainda não
     existia. Universo: linha de `tse_titulo_candidatura` (gravada pelo passo 1) de um ano em que a pessoa do título não tem
     candidatura nenhuma. A linha é classificada antes, sem gravar, pelo mesmo `PersonResolver` da carga (todas as travas:
     `title_row_foreign`, `first_name_match`, `shared_title`, geração/14 anos, chave `tse` de outra pessoa): só entra a que
     casa na pessoa do título; a recusada fica na nota do run e no log, nunca na pessoa, e não consome o teto. A aceita é
     carregada pelo loader (`_load_year(only=, owners=)`), que refaz o resolve e rejeita o que não casar no dono esperado; nunca
     cria pessoa nem mexe em candidatura existente (linha cuja (ano, SQ) já está no banco fica de fora). Situação: ELEITO e
     2º TURNO sempre (é o que o check do BUG-039 cobra); as outras (suplente, não eleito, #NULO#, INAPTO) só para quem não tem
     candidatura nenhuma antes da mais antiga das 2 eleições ordinárias mais recentes (`history_cutoff`: em 2026, 2024), isto
     é, quem entrou pela carga do ciclo em curso e ainda não tem histórico. Quem já tem histórico e não tem a não eleita de um
     ano é o backlog do BUG-047 (2012 carregado em ordem crescente, antes de a pessoa existir): 3.439 linhas no banco local,
     carga em massa, decisão do dono, não deste reparo. Fora: eleição suplementar (a carga dela encerra e apaga mandatos da
     cadeira; D241) e cargo sem mandato próprio (suplente de senador). Teto de HISTORY_CAP candidaturas e HISTORY_BUDGET_S segundos por run, por grupo (pessoa, ano): o resto fica
     para a próxima e o run `identity.repairs.historico` fecha `partial`. Cada candidatura, mandato, bem e chave criados vão
     para identity_split_log (bug BUG-053, ação 'criado'), que é o roteiro da reversão. Votos e contas desses anos não entram.
  3. `mandatos_tse`: mandato de vereador, prefeito ou vice cuja única fonte é a candidatura do TSE (`status_source = 'tse'`)
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


# ---------- passo `historico` (BUG-053) ----------

HISTORY_CAP = 200  # candidaturas por run; o resto fica para a próxima (run partial). Não é carga em massa.
HISTORY_BUDGET_S = 30 * 60  # tempo de carga por run; o identity.repairs inteiro tem 2 h na agenda (schedule.py)
HISTORY_DATASET = "identity.repairs.historico"
BUG_053 = "BUG-053"
# situações que a carga padrão (só eleitos) também lê: entram sempre
ALWAYS_LOADED = {"ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA", "2º TURNO"}
STATE_OFFICES = {"governador", "vice_governador", "senador", "deputado_federal", "deputado_estadual", "deputado_distrital"}

_HISTORY_SQL = """
select t.titulo, t.year, t.ue, t.tse_sequencial, t.kind, t.cargo, t.result, x.person_id::text as person_id
from tse_titulo_candidatura t join person_external_ids x on x.external_id = t.titulo
join sources s on s.id = x.source_id and s.slug = 'tse-titulo'
where not exists (select 1 from candidacies c join elections e on e.id = c.election_id
                  where c.person_id = x.person_id and e.year = t.year)
"""


FORA_COM_HISTORICO = "não eleita de quem já tem histórico carregado (backlog do BUG-047, fora do reparo)"


def history_cutoff(conn: psycopg.Connection) -> int:
    """Ano da mais antiga das 2 eleições ordinárias mais recentes do banco (em 2026: 2024, a municipal; a geral é 2026). Quem não
    tem candidatura antes dele entrou no diretório pela carga do ciclo em curso e ainda não tem histórico nenhum."""
    ys = [r["year"] for r in conn.execute(
        "select distinct year from elections where kind in ('municipal', 'geral') order by year desc limit 2")]
    return min(ys) if ys else 0


def _history_universe(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """Linhas do título de cada pessoa do diretório em anos em que ela não tem candidatura nenhuma."""
    return [dict(r) for r in conn.execute(_HISTORY_SQL)]


def _source_paths_year(year: int):
    from .tse_bug032 import _source_paths

    return _source_paths(year)  # cache do ETL; sem cache, baixa pelo mesmo cliente HTTP (http.fetch)


def _bens_paths_year(year: int):
    from .identity_bug041 import bens_paths

    return bens_paths(year)  # só cache: sem o arquivo de bens, a candidatura entra sem bens (nota no run)


def _title_source(paths, titles: set[str]) -> list[dict[str, Any]]:
    """Todas as linhas (os dois turnos, todas as situações) do arquivo do ano com um dos títulos: é o que o `shared_title` precisa
    para ver o 2º SQ do mesmo título na mesma eleição."""
    import duckdb

    from .tse_candidatos import COLS

    con = duckdb.connect()
    con.execute("create table want (t varchar)")
    con.executemany("insert into want values (?)", [(t,) for t in sorted(titles)])
    out: list[dict[str, Any]] = []
    for p in paths:
        rel = con.read_csv(str(p), delimiter=";", header=True, quotechar='"', all_varchar=True)
        con.register("t", rel)
        sel = ", ".join(c if c in rel.columns else f"NULL as {c}" for c in COLS)
        out.extend(dict(zip(COLS, r)) for r in con.execute(
            f"select {sel} from t where trim(NR_TITULO_ELEITORAL_CANDIDATO) in (select t from want)").fetchall())
        con.unregister("t")
    return out


def plan_history(conn: psycopg.Connection, *, paths: Callable[[int], Any] = _source_paths_year,
                 universe: Callable[[psycopg.Connection], list[dict[str, Any]]] = _history_universe) -> dict[str, Any]:
    """Classifica o universo do passo `historico` sem gravar nada. Devolve aceitas (casam na pessoa do título pelo resolve da
    carga), recusadas (com motivo) e fora (contagem por motivo), mais as linhas da fonte por ano para a carga."""
    from collections import Counter, defaultdict

    from ..identity import PersonResolver
    from ..util import nz, parse_date, titlecase_pt
    from .tse_candidatos import CARGO, muni_index, title_rows, tse_key

    plan: dict[str, Any] = {"universo": Counter(), "fora": Counter(), "aceitas": [], "recusadas": [], "src": {}}
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for u in universe(conn):
        plan["universo"][(u["year"], u["result"] or "-")] += 1
        if u["kind"] != "ordinaria":
            plan["fora"]["eleição suplementar"] += 1
        elif u["cargo"] not in CARGO.values():
            plan["fora"]["cargo sem mandato próprio"] += 1
        else:
            by_year[u["year"]].append(u)
    if not by_year:
        return plan

    # quem já tem histórico carregado (candidatura antes das 2 eleições ordinárias mais recentes) só ganha a linha eleita: o resto
    # do histórico dessas pessoas é o backlog do BUG-047 (2012 carregado antes de elas existirem), carga em massa e não reparo
    cutoff = history_cutoff(conn)
    persons = sorted({u["person_id"] for us in by_year.values() for u in us})
    with_history = {str(r["person_id"]) for r in conn.execute(
        """select distinct c.person_id from candidacies c join elections e on e.id = c.election_id
           where c.person_id = any(%s::uuid[]) and e.year < %s
             -- o que este passo já carregou não conta: senão o teto (ou um ano que voltou atrás) tiraria o resto do histórico
             and not exists (select 1 from identity_split_log l where l.bug = %s and l.table_name = 'candidacies'
                             and l.row_key = c.id::text)""", (persons, cutoff, BUG_053))}
    plan["cutoff"] = cutoff
    for y in list(by_year):
        keep = []
        for u in by_year[y]:
            if (u["result"] or "") not in ALWAYS_LOADED and u["person_id"] in with_history:
                plan["fora"][FORA_COM_HISTORICO] += 1
            else:
                keep.append(u)
        by_year[y] = keep
        if not keep:
            del by_year[y]
    if not by_year:
        return plan

    years = sorted(by_year)
    places = {r["ibge_code"]: str(r["id"]) for r in conn.execute("select ibge_code, id from places")}
    by_uf = {r["uf"]: str(r["id"]) for r in conn.execute("select uf, id from places where kind = 'uf'")}
    muni_lookup = muni_index(conn)
    taken = {(r["year"], r["tse_sequencial"]) for r in conn.execute(
        "select e.year, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id where e.year = any(%s)", (years,))}
    pr = PersonResolver(conn)
    try:
        for year in sorted(by_year, reverse=True):
            us = by_year[year]
            src = _title_source(paths(year), {u["titulo"] for u in us})
            plan["src"][year] = src
            pr.note_title_rows(title_rows(src, None))  # como a carga: o 2º SQ do título no mesmo ano tira a prova do título
            first: dict[tuple[str, str], dict[str, Any]] = {}
            for x in src:
                k = ((x["SG_UE"] or "").strip(), (x["SQ_CANDIDATO"] or "").strip())
                if k not in first or (x["NR_TURNO"] or "1") == "1":
                    first[k] = x
            for u in us:
                x = first.get((u["ue"], u["tse_sequencial"]))
                item = {"year": year, "ue": u["ue"], "sq": u["tse_sequencial"], "titulo": u["titulo"], "person_id": u["person_id"],
                        "result": u["result"], "cargo": u["cargo"]}
                if x is None:
                    plan["fora"]["sem a linha na fonte"] += 1
                    continue
                office = u["cargo"]
                if office in ("presidente", "vice_presidente"):
                    place = places.get("BR")
                elif office in STATE_OFFICES:
                    place = by_uf.get((x["SG_UE"] or "").strip().upper())
                else:
                    place = muni_lookup((x["SG_UF"] or "").strip().upper(), x["NM_UE"])
                civil, birth = titlecase_pt(x["NM_CANDIDATO"]), parse_date(x["DT_NASCIMENTO"])
                item.update(civil=civil, birth=birth)
                if not place:
                    plan["recusadas"].append({**item, "why": "lugar sem correspondência no IBGE"})
                    continue
                if (year, u["tse_sequencial"]) in taken:
                    plan["recusadas"].append({**item, "why": f"candidatura {year} SQ {u['tse_sequencial']} já está no banco (noutra pessoa); não mexe"})
                    continue
                titulo = nz(x["NR_TITULO_ELEITORAL_CANDIDATO"])
                m = pr.resolve(source="tse", external_id=tse_key(year, u["tse_sequencial"], u["ue"]), civil_name=civil, birth_date=birth,
                               birth_uf=(nz(x["SG_UF_NASCIMENTO"]) or "").upper() or None, titulo=titulo if titulo and titulo.isdigit() else None,
                               uf=x["SG_UF"], place_id=place, year=year)
                if m.title_foreign:
                    why = "título repetido pelo TSE: a linha é de outra pessoa (ou o título está em 2 SQ da eleição com nomes diferentes)"
                elif m.method == "queued":
                    why = "o resolve manda para a fila"
                elif m.person_id != u["person_id"]:
                    why = f"o resolve casa noutra pessoa ({m.person_id}, {m.method})" if m.person_id else "o resolve não casa em ninguém"
                else:
                    plan["aceitas"].append(item)
                    continue
                plan["recusadas"].append({**item, "why": why})
    finally:
        pr._pending_ext, pr._pending_queue = [], []  # classificação: nada do resolve é gravado
    return plan


def _cap_groups(items: list[dict[str, Any]], cap: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Corta no teto por grupo (pessoa, ano), nunca no meio: registro substituído e válido do mesmo título e ano entram juntos.
    Grupos com linha eleita primeiro (zeram o check do BUG-039), depois do ano mais novo para o mais antigo."""
    from collections import defaultdict

    groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for it in items:
        groups[(it["person_id"], it["year"])].append(it)
    order = sorted(groups, key=lambda k: (not any((i["result"] or "") in ALWAYS_LOADED for i in groups[k]), -k[1], k[0]))
    take: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for k in order:
        g = groups[k]
        if rest or (take and len(take) + len(g) > cap):
            rest.extend(g)
        else:
            take.extend(g)
    return take, rest


def _write_history_csv(rows: list[dict[str, Any]], path) -> None:
    import csv

    from .tse_candidatos import COLS

    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter=";", quotechar='"', quoting=csv.QUOTE_MINIMAL)
        w.writerow(COLS)
        for x in rows:
            w.writerow(["" if x.get(c) is None else x[c] for c in COLS])


def _log_created(conn: psycopg.Connection, items: list[dict[str, Any]], year: int, keys_before: set[str]) -> dict[str, int]:
    """Tudo o que a carga criou para os grupos do ano vai para identity_split_log (BUG-053, 'criado'). Devolve as contagens."""
    import json

    from .tse_candidatos import tse_key

    n = {"candidacies": 0, "mandates": 0, "asset_declarations": 0, "person_external_ids": 0}

    def put(table: str, ext: str, pid: str, key: str, raw: dict[str, Any], note: str) -> None:
        conn.execute(
            """insert into identity_split_log (bug, source, external_id, person_id, table_name, action, row_key, raw, note)
               values (%s, 'tse', %s, %s, %s, 'criado', %s, %s, %s) on conflict (bug, source, external_id, table_name, row_key) do nothing""",
            (BUG_053, ext, pid, table, key, json.dumps(raw, default=str, ensure_ascii=False), note))
        n[table] += 1

    tse = conn.execute("select id from sources where slug = 'tse'").fetchone()["id"]
    for pid in sorted({i["person_id"] for i in items}):
        mine = [i for i in items if i["person_id"] == pid]
        titulo = mine[0]["titulo"]
        note = f"histórico do título {titulo}: candidatura de {year} carregada para quem entrou no diretório depois (BUG-053)"
        for c in conn.execute("""select c.* from candidacies c join elections e on e.id = c.election_id
                                 where c.person_id = %s and e.year = %s""", (pid, year)).fetchall():
            ext = f"{year}:{c['tse_sequencial']}"
            put("candidacies", ext, pid, str(c["id"]), dict(c), note)
            for m in conn.execute("select * from mandates where candidacy_id = %s", (c["id"],)).fetchall():
                put("mandates", ext, pid, str(m["id"]), dict(m), note)
            for a in conn.execute("select * from asset_declarations where candidacy_id = %s", (c["id"],)).fetchall():
                put("asset_declarations", ext, pid, str(a["id"]), dict(a), note)
        for i in mine:
            key = tse_key(year, i["sq"], i["ue"])
            if key in keys_before:
                continue
            for x in conn.execute("select * from person_external_ids where source_id = %s and external_id = %s and person_id = %s",
                                  (tse, key, pid)).fetchall():
                put("person_external_ids", key, pid, str(x["id"]), dict(x), note)
    return n


def apply_history(conn: psycopg.Connection, r: Any, plan: dict[str, Any], *, cap: int = HISTORY_CAP, budget_s: float = HISTORY_BUDGET_S,
                  bens: Callable[[int], Any] = _bens_paths_year, commit: bool = True) -> int:
    """Carrega as aceitas do plano (até o teto), um ano por transação (savepoint quando já há uma aberta). Devolve quantas
    candidaturas entraram. Grupo aceito que a carga não pôs no dono: o ano volta atrás inteiro e o run fica partial."""
    import tempfile
    import time
    from collections import defaultdict
    from pathlib import Path

    from .tse_candidatos import _load_year, tse_key

    take, rest = _cap_groups(plan["aceitas"], cap)
    if rest:
        r.partial(f"historico: teto de {cap} candidaturas por run; {len(rest)} aceita(s) ficam para a próxima execução")
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for it in take:
        by_year[it["year"]].append(it)
    t0 = time.monotonic()
    loaded = 0
    tse = conn.execute("select id from sources where slug = 'tse'").fetchone()["id"]
    for year in sorted(by_year, reverse=True):
        items = by_year[year]
        if time.monotonic() - t0 > budget_s:
            left = sum(len(v) for y, v in by_year.items() if y <= year)
            r.partial(f"historico: tempo de {budget_s:.0f}s esgotado; {left} aceita(s) de {year} para trás ficam para a próxima execução")
            break
        titles = {i["titulo"] for i in items}
        rows = [x for x in plan["src"][year] if (x["NR_TITULO_ELEITORAL_CANDIDATO"] or "").strip() in titles]
        only = {(i["ue"], i["sq"]) for i in items}
        owners = {(i["ue"], i["sq"]): i["person_id"] for i in items}
        keys = [tse_key(year, i["sq"], i["ue"]) for i in items]
        keys_before = {x["external_id"] for x in conn.execute(
            "select external_id from person_external_ids where source_id = %s and external_id = any(%s)", (tse, keys))}
        bp = list(bens(year) or [])
        with tempfile.TemporaryDirectory() as d:
            csv_path = Path(d) / f"historico_{year}.csv"
            _write_history_csv(rows, csv_path)
            try:
                with conn.transaction():
                    _load_year(conn, r, year, None, None, None, False, cand_paths=[csv_path], bens_paths=bp or None, only=only,
                               bug=BUG_053, owners=owners)
                    got = {(str(c["person_id"]), c["tse_sequencial"]) for c in conn.execute(
                        """select c.person_id, c.tse_sequencial from candidacies c join elections e on e.id = c.election_id
                           where e.year = %s and c.tse_sequencial = any(%s)""", (year, sorted({i["sq"] for i in items})))}
                    wrong = [i for i in items if any(s == i["sq"] and p != i["person_id"] for p, s in got)]
                    empty = sorted({i["person_id"] for i in items} - {p for p, _ in got})
                    # a chave tse de uma linha aceita ligada a outra pessoa (ramo de nome do resolve) também desfaz o ano
                    own = {tse_key(year, i["sq"], i["ue"]): i["person_id"] for i in items}
                    wrong += [{"sq": x["external_id"]} for x in conn.execute(
                        "select external_id, person_id::text p from person_external_ids where source_id = %s and external_id = any(%s)",
                        (tse, keys)) if x["p"] != own[x["external_id"]]]
                    if wrong or empty:
                        raise _HistoryMismatch(wrong, empty)
                    n = _log_created(conn, items, year, keys_before)
            except _HistoryMismatch as e:
                log.error("historico %d: a carga divergiu da classificação (%s); o ano voltou atrás", year, e)
                r.partial(f"historico {year}: a carga divergiu da classificação ({e}); nada do ano entrou")
                continue
        if commit:
            conn.commit()
        loaded += n["candidacies"]
        r.note(f"historico {year}: {n['candidacies']} candidatura(s), {n['mandates']} mandato(s), {n['asset_declarations']} declaração(ões) "
               f"de bens e {n['person_external_ids']} chave(s) tse criadas (identity_split_log {BUG_053})"
               + ("" if bp else "; bens do ano fora do cache: não carregados"))
        log.info("historico %d: %s", year, n)
    if loaded:
        r.note(f"historico: votos e contas de campanha das {loaded} candidatura(s) carregadas não entram neste passo (tse.votos/tse.contas)")
    return loaded


class _HistoryMismatch(Exception):
    def __init__(self, wrong: list[dict[str, Any]], empty: list[str]):
        super().__init__(f"{len(wrong)} linha(s) noutra pessoa, {len(empty)} pessoa(s) sem candidatura")


def _log_plan(plan: dict[str, Any], cap: int) -> None:
    uni = sum(plan["universo"].values())
    log.info("historico: universo %d linha(s) de título sem candidatura da pessoa no ano; fora %s; aceitas %d; recusadas %d; teto %d",
             uni, dict(plan["fora"]), len(plan["aceitas"]), len(plan["recusadas"]), cap)
    for (y, res), n in sorted(plan["universo"].items()):
        log.info("historico: universo %d %s: %d", y, res, n)
    for i in plan["recusadas"]:
        log.info("historico: recusada %s %s SQ %s título %s '%s' %s -> pessoa %s: %s", i["year"], i["ue"], i["sq"], i["titulo"], i.get("civil"),
                 i.get("birth"), i["person_id"], i["why"])


def sync_history(conn: psycopg.Connection, *, apply: bool, paths: Callable[[int], Any] = _source_paths_year,
                 bens: Callable[[int], Any] = _bens_paths_year, universe: Callable[[psycopg.Connection], list[dict[str, Any]]] = _history_universe,
                 cap: int = HISTORY_CAP, budget_s: float = HISTORY_BUDGET_S, commit: bool = True) -> int:
    """Passo `historico` (BUG-053). Dry-run: quantas candidaturas entrariam nesta execução (até o teto). Com --apply: quantas
    entraram. A carga abre o run `identity.repairs.historico` (fonte tse-titulo, para não carimbar o frescor do TSE) só quando há
    o que carregar; `commit=False` (testes): sem run em ingest_runs, nada é confirmado."""
    from ..db import Run, run

    plan = plan_history(conn, paths=paths, universe=universe)
    _log_plan(plan, cap)
    if not apply or not plan["aceitas"]:
        return len(_cap_groups(plan["aceitas"], cap)[0])
    if not commit:
        return apply_history(conn, Run(conn, HISTORY_DATASET, "tse-titulo"), plan, cap=cap, budget_s=budget_s, bens=bens, commit=False)
    with run(conn, HISTORY_DATASET, "tse-titulo") as r:
        r.read(sum(plan["universo"].values()))
        for i in plan["recusadas"][:20]:
            r.note(f"recusada {i['year']} SQ {i['sq']} '{i.get('civil')}' {i.get('birth')}: {i['why']}")
        if len(plan["recusadas"]) > 20:
            r.note(f"... e mais {len(plan['recusadas']) - 20} recusada(s) (log do job)")
        return apply_history(conn, r, plan, cap=cap, budget_s=budget_s, bens=bens, commit=True)


# ordem fixa da rotina: (nome, passo). Novo passo entra aqui, com a justificativa no docstring do módulo e uma decisão.
STEPS: tuple[tuple[str, Callable[..., int]], ...] = (
    ("titulos", sync_titles),
    ("historico", sync_history),
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
