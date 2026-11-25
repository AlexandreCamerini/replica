#!/usr/bin/env python3
"""Confere o placar por UF de uma votação nominal da Câmara no banco contra a fonte oficial (Dados Abertos da Câmara).

v1, NÃO EXECUTADA no sandbox (sem rede para a fonte nem acesso ao banco). Rodar no terminal do dono.

Uso:
  export DATABASE_URL='<url somente leitura do civico_ensaio>'   # nunca colar em chat nem em arquivo
  python3 etl/deploy/conferir-votos-camara.py            # a votação nominal mais recente com votos no banco
  python3 etl/deploy/conferir-votos-camara.py <source_key>  # uma votação específica

Critério de aceite: totais por tipo de voto e placar por UF idênticos (diferença 0) entre banco e fonte.
Saída: 0 = confere; 1 = divergência (lista abaixo); 2 = não deu para conferir (erro de leitura, sem comparar).
Só lê. Não escreve no banco, não imprime a URL do banco.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request
from collections import Counter
from urllib.parse import quote

API = "https://dadosabertos.camara.leg.br/api/v2"
# tipoVoto da fonte -> value do banco (votes.value)
TIPO = {"Sim": "sim", "Não": "nao", "Abstenção": "abstencao", "Obstrução": "obstrucao", "Artigo 17": "art17"}


def psql(sql: str) -> list[list[str]]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL não definida (ver o cabeçalho do arquivo)", file=sys.stderr)
        sys.exit(2)
    r = subprocess.run(["psql", url, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    if r.returncode != 0:
        print("erro no banco:", r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "?", file=sys.stderr)
        sys.exit(2)
    return [ln.split("\t") for ln in r.stdout.splitlines() if ln.strip()]


def get(url: str) -> dict:
    for tentativa in range(3):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "conferencia-de-dados/1.0"})
            with urllib.request.urlopen(req, timeout=30) as f:
                return json.load(f)
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:  # pedido recusado: repetir não adianta; mostra o motivo que a fonte deu
                corpo = e.read().decode("utf-8", "replace").strip().replace("\n", " ")[:300]
                print(f"fonte recusou o pedido ({url}): HTTP {e.code} {corpo}", file=sys.stderr)
                sys.exit(2)
            if tentativa == 2:
                print(f"fonte indisponível ({url.split('?')[0]}): {e}", file=sys.stderr)
                sys.exit(2)
            time.sleep(2 * (tentativa + 1))
        except (urllib.error.URLError, TimeoutError) as e:
            if tentativa == 2:
                print(f"fonte indisponível ({url.split('?')[0]}): {e}", file=sys.stderr)
                sys.exit(2)
            time.sleep(2 * (tentativa + 1))
    raise AssertionError


def main() -> int:
    chave = sys.argv[1] if len(sys.argv) > 1 else None
    if not chave:
        rows = psql("""select e.source_key from voting_events e join legislative_bodies b on b.id = e.body_id
                       where b.kind = 'camara_deputados' and e.is_nominal and exists (select 1 from votes v where v.voting_event_id = e.id)
                       order by e.occurred_at desc limit 1""")
        if not rows:
            print("nenhuma votação nominal da Câmara com votos no banco"); return 2
        chave = rows[0][0]
    print(f"votação (source_key): {chave}")

    # --- banco: totais por valor e placar por UF, com a MESMA regra de UF do site (mandato na casa que cobre a data da votação)
    esc = chave.replace("'", "''")
    tot_db = Counter({v: int(n) for v, n in psql(f"""select v.value, count(*) from votes v join voting_events e on e.id = v.voting_event_id
                                                     join legislative_bodies b on b.id = e.body_id
                                                     where b.kind = 'camara_deputados' and e.source_key = '{esc}' group by 1""")})
    uf_db: Counter = Counter()
    for uf, val, n in psql(f"""
        select coalesce(pl.uf, '??'), v.value, count(*)
        from votes v join voting_events e on e.id = v.voting_event_id join legislative_bodies b on b.id = e.body_id
        join people p on p.id = v.person_id
        left join lateral (select pl.uf from mandates m join places pl on pl.id = m.place_id
                           where m.person_id = p.id
                             and (m.body_id = e.body_id or (m.body_id is null and m.office_id = (select id from offices where slug = 'deputado_federal')))
                             and m.started_on <= ((e.occurred_at at time zone 'America/Sao_Paulo')::date)
                             and (m.ends_on is null or m.ends_on > ((e.occurred_at at time zone 'America/Sao_Paulo')::date))
                           order by (m.body_id is not null) desc, m.started_on desc limit 1) pl on true
        where b.kind = 'camara_deputados' and e.source_key = '{esc}' group by 1, 2"""):
        uf_db[(uf, val)] = int(n)

    # --- fonte oficial: /votacoes/{id}/votos (paginado)
    tot_fonte: Counter = Counter()
    uf_fonte: Counter = Counter()
    # sem `itens`/`pagina` no primeiro pedido (a fonte respondeu 400 a esses parâmetros neste endpoint); se vier link `next`, segue por ele
    url = f"{API}/votacoes/{quote(chave, safe='')}/votos"
    for _ in range(200):
        d = get(url)
        itens = d.get("dados", [])
        for it in itens:
            val = TIPO.get(it.get("tipoVoto", ""))
            if val is None:
                print(f"tipoVoto não mapeado na fonte: {it.get('tipoVoto')!r}", file=sys.stderr); return 2
            tot_fonte[val] += 1
            uf_fonte[((it.get("deputado_") or {}).get("siglaUf") or "??", val)] += 1
        prox = next((l.get("href") for l in d.get("links", []) if l.get("rel") == "next"), None)
        if not prox or not itens or prox == url:
            break
        url = prox
    else:
        print("mais de 200 páginas de votos: abortando por segurança", file=sys.stderr); return 2

    # o banco guarda `nao_votou` (quem não registrou voto); a fonte só publica quem votou: fica fora da comparação
    tot_db.pop("nao_votou", None)
    for k in [k for k in uf_db if k[1] == "nao_votou"]:
        del uf_db[k]

    div = []
    for v in sorted(set(tot_db) | set(tot_fonte)):
        if tot_db[v] != tot_fonte[v]:
            div.append(f"total {v}: banco {tot_db[v]} × fonte {tot_fonte[v]}")
    for k in sorted(set(uf_db) | set(uf_fonte)):
        if uf_db[k] != uf_fonte[k]:
            div.append(f"UF {k[0]} {k[1]}: banco {uf_db[k]} × fonte {uf_fonte[k]}")
    print(f"banco: {dict(tot_db)}\nfonte: {dict(tot_fonte)}")
    if div:
        sem_uf = sem_uf_explica(tot_db, tot_fonte, uf_db, uf_fonte)
        if sem_uf is not None:
            # totais idênticos e a única diferença por UF é voto que o banco não consegue pôr em estado (pessoa sem mandato na data): é
            # lacuna de cadastro, não de contagem, e o site já a mostra ("N registros sem estado identificado"). Não é o DIVERGE de dado.
            quem = [r[0] for r in psql(f"""
                select p.display_name from votes v join voting_events e on e.id = v.voting_event_id join legislative_bodies b on b.id = e.body_id
                join people p on p.id = v.person_id
                where b.kind = 'camara_deputados' and e.source_key = '{esc}' and v.value <> 'nao_votou'
                  and not exists (select 1 from mandates m join places pl on pl.id = m.place_id
                                  where m.person_id = p.id
                                    and (m.body_id = e.body_id or (m.body_id is null and m.office_id = (select id from offices where slug = 'deputado_federal')))
                                    and m.started_on <= ((e.occurred_at at time zone 'America/Sao_Paulo')::date)
                                    and (m.ends_on is null or m.ends_on > ((e.occurred_at at time zone 'America/Sao_Paulo')::date)))
                order by 1""")]
            print(f"CONFERE COM RESSALVA: totais idênticos; {sum(sem_uf.values())} voto(s) sem estado identificado no banco ({dict(sem_uf)}), "
                  f"que a fonte põe em estado: {', '.join(quem) or '?'}. Causa: pessoa sem mandato na data da votação (ETL). "
                  f"Nenhuma outra UF diverge.")
            return 0
        print(f"DIVERGE em {len(div)} pontos:"); [print("  -", x) for x in div[:40]]; return 1
    print(f"CONFERE: {sum(tot_fonte.values())} votos, {len({k[0] for k in uf_fonte})} UFs, diferença 0")
    return 0


def sem_uf_explica(tot_db: Counter, tot_fonte: Counter, uf_db: Counter, uf_fonte: Counter) -> dict[str, int] | None:
    """Devolve {valor: n} quando TODA a diferença por UF é voto do banco em `??` que a fonte põe em um estado; senão None.
    Exige totais idênticos, nenhum `??` na fonte e nenhuma UF com mais votos no banco do que na fonte."""
    if any(tot_db[v] != tot_fonte[v] for v in set(tot_db) | set(tot_fonte)):
        return None
    if any(k[0] == "??" for k in uf_fonte):
        return None
    falta: Counter = Counter()  # valor -> votos que a fonte tem a mais, por UF, do que o banco
    for k in set(uf_db) | set(uf_fonte):
        if k[0] == "??":
            continue
        d = uf_fonte[k] - uf_db[k]
        if d < 0:
            return None
        falta[k[1]] += d
    sem = {k[1]: n for k, n in uf_db.items() if k[0] == "??" and n}
    return sem if sem and {v: n for v, n in falta.items() if n} == sem else None


if __name__ == "__main__":
    sys.exit(main())
