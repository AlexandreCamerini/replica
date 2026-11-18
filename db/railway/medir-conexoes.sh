#!/usr/bin/env bash
# Medições do ensaio (runbook-railway.md §2, S4 e S13), SÓ LEITURA no cluster: nada é gravado no banco.
# Uso:
#   bash db/railway/medir-conexoes.sh amostrar [--db civico_ensaio] [--intervalo 5] [--saida conexoes.csv]
#        amostra pg_stat_activity do cluster inteiro até Ctrl-C (ou SIGTERM); no fim imprime o pico por database/usuário,
#        o pico total do cluster e o max_connections. Deixe rodando num terminal durante login, e2e e run-due.
#   bash db/railway/medir-conexoes.sh disco marcar ARQ [--db civico_ensaio]     # antes do run-due
#   bash db/railway/medir-conexoes.sh disco comparar ARQ [--db civico_ensaio]   # depois: crescimento do database e WAL gerado
#   bash db/railway/medir-conexoes.sh resumo conexoes.csv [--db civico_ensaio]  # refaz o resumo de um CSV já gravado
# Entrada: DESTINO_URL (superusuário do cluster), senão Railway CLI (como railway-copy.sh). Senha só no .pgpass 0600 temporário.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib-uri.sh"
CMD="${1:-}"; shift || true
SUB=""; ARQ=""
if [[ "$CMD" == disco ]]; then SUB="${1:?disco marcar|comparar ARQ}"; ARQ="${2:?disco $SUB ARQ}"; shift 2; fi
if [[ "$CMD" == resumo ]]; then ARQ="${1:?resumo ARQ.csv}"; shift; fi
DB=civico_ensaio; INTERVALO=5; SAIDA="conexoes-$(date +%F-%H%M).csv"
while [[ $# -gt 0 ]]; do case "$1" in
  --db) DB="$2"; shift ;; --intervalo) INTERVALO="$2"; shift ;; --saida) SAIDA="$2"; shift ;;
  *) echo "opção desconhecida: $1" >&2; exit 2 ;; esac; shift; done
[[ "$CMD" =~ ^(amostrar|disco|resumo)$ ]] || { sed -n '2,11p' "$0"; exit 2; }
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "--db inválido" >&2; exit 2; }
[[ "$INTERVALO" =~ ^[0-9]+$ && "$INTERVALO" -ge 1 ]] || { echo "--intervalo inválido" >&2; exit 2; }

resumo() { # resumo CSV  (colunas: ts,datname,usename,n,total_cluster,max_connections)
  python3 -I - "$1" "$DB" <<'PY'
import csv, sys, collections
f, db = sys.argv[1], sys.argv[2]
pico = collections.Counter(); quando = {}; tot = {}; maxc = "?"; amostras = set(); por_ts_db = collections.Counter()
for r in csv.reader(open(f)):
    if len(r) != 6 or r[0] == "ts": continue
    ts, d, u, n, t, m = r[0], r[1], r[2], int(r[3]), int(r[4]), r[5]
    amostras.add(ts); maxc = m; tot[ts] = t
    if n > pico[(d, u)]: pico[(d, u)] = n; quando[(d, u)] = ts
    if d == db: por_ts_db[ts] += n
if not amostras: print("sem amostras"); sys.exit(0)
ts_ord = sorted(amostras)
print(f"amostras: {len(amostras)} de {ts_ord[0]} a {ts_ord[-1]}")
print(f"max_connections: {maxc}")
pt = max(tot.items(), key=lambda kv: kv[1]); print(f"pico do cluster (client backends): {pt[1]} em {pt[0]}")
if por_ts_db:
    pd = max(por_ts_db.items(), key=lambda kv: kv[1]); print(f"pico do database {db}: {pd[1]} em {pd[0]}")
else: print(f"pico do database {db}: 0")
print("pico por database/usuário:")
for (d, u), n in sorted(pico.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f"  {d or '-':<20} {u or '-':<16} {n:>4}  ({quando[(d, u)]})")
PY
}
if [[ "$CMD" == resumo ]]; then resumo "$ARQ"; exit 0; fi

if [[ -z "${DESTINO_URL:-}" ]]; then
  command -v railway >/dev/null || { echo "railway CLI não encontrado e DESTINO_URL não definida" >&2; exit 1; }
  VARS="$(railway variables --service "${RAILWAY_PG_SERVICE:-Postgres}" --kv)" || { echo "railway variables falhou" >&2; exit 1; }
  DESTINO_URL="$(grep -E '^DATABASE_PUBLIC_URL=' <<<"$VARS" | head -1 | cut -d= -f2- || true)"; unset VARS
  [[ -n "$DESTINO_URL" ]] || { echo "sem DATABASE_PUBLIC_URL" >&2; exit 1; }
fi
PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/civico-med.XXXXXX")"; chmod 700 "$PGDIR"
FULL="$(secure "$(uri setdb "$DESTINO_URL" "$DB")")"; unset DESTINO_URL
uri pgpass "$FULL" > "$PGDIR/pgpass"; chmod 600 "$PGDIR/pgpass"; export PGPASSFILE="$PGDIR/pgpass"
CONN="$(uri nopass "$FULL")"; unset FULL
Q=(-X -v ON_ERROR_STOP=1 -At -F ,)
[[ "$(psql "$CONN" "${Q[@]}" -c 'select current_database()')" == "$DB" ]] || { echo "não conectei em $DB" >&2; exit 1; }

if [[ "$CMD" == disco ]]; then
  trap 'rm -rf "$PGDIR"' EXIT
  # tamanho do database e posição do WAL (o WAL é do cluster inteiro: o delta inclui o que as outras apps gravarem no intervalo)
  LEIT="$(psql "$CONN" "${Q[@]}" -c "select now(), pg_database_size(current_database()), pg_current_wal_lsn(), (select coalesce(sum(size),0) from pg_ls_waldir())")"
  if [[ "$SUB" == marcar ]]; then echo "$LEIT" > "$ARQ"; echo "marcado em $ARQ: $LEIT"; exit 0; fi
  [[ -r "$ARQ" ]] || { echo "sem $ARQ (rode disco marcar antes)" >&2; exit 1; }
  IFS=, read -r T0 S0 L0 W0 < "$ARQ"; IFS=, read -r T1 S1 L1 W1 <<<"$LEIT"
  psql "$CONN" "${Q[@]}" -F ' ' -c "select 'intervalo: ' || ('$T1'::timestamptz - '$T0'::timestamptz)::text,
    E'\ndatabase $DB: ' || pg_size_pretty($S0::bigint) || ' -> ' || pg_size_pretty($S1::bigint) || ' (delta ' || pg_size_pretty(($S1 - $S0)::bigint) || ')',
    E'\nWAL gerado no cluster: ' || pg_size_pretty(pg_wal_lsn_diff('$L1', '$L0')::bigint),
    E'\npg_wal em disco: ' || pg_size_pretty($W0::bigint) || ' -> ' || pg_size_pretty($W1::bigint)"
  exit 0
fi

# ---- amostrar ----------------------------------------------------------------------------------------------------------------------
echo "ts,datname,usename,n,total_cluster,max_connections" > "$SAIDA"
fim() { trap - INT TERM EXIT; rm -rf "$PGDIR"; echo; echo "== resumo ($SAIDA)"; resumo "$SAIDA"; exit 0; }
trap fim INT TERM EXIT
echo "amostrando a cada ${INTERVALO}s em $SAIDA (Ctrl-C para parar e ver o pico; a conexão do amostrador não entra na conta)"
while :; do
  psql "$CONN" "${Q[@]}" -c "
    with a as (select datname, usename from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid())
    select to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), coalesce(datname, '-'), coalesce(usename, '-'), count(*),
           (select count(*) from a), current_setting('max_connections')
      from a group by 2, 3" >> "$SAIDA" 2>/dev/null || echo "$(date '+%T') amostra falhou (rede?); sigo" >&2
  sleep "$INTERVALO"
done
