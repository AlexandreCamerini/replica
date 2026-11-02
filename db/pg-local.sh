#!/usr/bin/env bash
# Postgres 16 local para desenvolvimento. Dados em .local/pg (fora do git), socket curto em /tmp/claude/pgs.
# Uso: db/pg-local.sh start|stop|status|url
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local/pg"; SOCK=/tmp/claude/pgs; PORT=54329
PGBIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"; [[ -x "$PGBIN/pg_ctl" ]] || PGBIN="$(dirname "$(command -v pg_ctl)")"
export LC_ALL=C LANG=C
case "${1:-status}" in
  start)
    mkdir -p "$SOCK"
    if [[ ! -f "$DATA/PG_VERSION" ]]; then
      mkdir -p "$DATA"; "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale-provider=icu --icu-locale=pt-BR >/dev/null
    fi
    if "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      echo "já em execução" >&2
    else
      "$PGBIN/pg_ctl" -D "$DATA" -l "$ROOT/.local/pg.log" -o "-p $PORT -k $SOCK -c listen_addresses=localhost" -w start >/dev/null
    fi
    "$PGBIN/psql" -h "$SOCK" -p $PORT -U postgres -XAtc "select 1 from pg_database where datname='civico'" | grep -q 1 \
      || "$PGBIN/createdb" -h "$SOCK" -p $PORT -U postgres civico
    echo "postgres://postgres@localhost:$PORT/civico" ;;
  stop) "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  status) "$PGBIN/pg_ctl" -D "$DATA" status || true ;;
  url) echo "postgres://postgres@localhost:$PORT/civico" ;;
esac
