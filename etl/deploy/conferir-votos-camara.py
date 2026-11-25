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
                       where b.kind = 'camara' and e.is_nominal and exists (select 1 from votes v where v.voting_event_id = e.id)
                       order by e.occurred_at desc limit 1""")
        if not rows:
            print("nenhuma votação nominal da Câmara com votos no banco"); return 2
        chave = rows[0][0]
    print(f"votação (source_key): {chave}")

    # --- banco: totais por valor e placar por UF, com a MESMA regra de UF do site (mandato na casa que cobre a data da votação)
    esc = chave.replace("'", "''")
    tot_db = Counter({v: int(n) for v, n in psql(f"""select v.value, count(*) from votes v join voting_events e on e.id = v.voting_event_id
                                                     join legislative_bodies b on b.id = e.body_id
                                                     where b.kind = 'camara' and e.source_key = '{esc}' group by 1""")})
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
        where b.kind = 'camara' and e.source_key = '{esc}' group by 1, 2"""):
        uf_db[(uf, val)] = int(n)

    # --- fonte oficial: /votacoes/{id}/votos (paginado)
    tot_fonte: Counter = Counter()
    uf_fonte: Counter = Counter()
    pagina = 1
    while True:
        d = get(f"{API}/votacoes/{chave}/votos?itens=100&pagina={pagina}")
        itens = d.get("dados", [])
        for it in itens:
            val = TIPO.get(it.get("tipoVoto", ""))
            if val is None:
                print(f"tipoVoto não mapeado na fonte: {it.get('tipoVoto')!r}", file=sys.stderr); return 2
            tot_fonte[val] += 1
            uf_fonte[((it.get("deputado_") or {}).get("siglaUf") or "??", val)] += 1
        if not any(l.get("rel") == "next" for l in d.get("links", [])) or not itens:
            break
        pagina += 1

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
        print(f"DIVERGE em {len(div)} pontos:"); [print("  -", x) for x in div[:40]]; return 1
    print(f"CONFERE: {sum(tot_fonte.values())} votos, {len({k[0] for k in uf_fonte})} UFs, diferença 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
