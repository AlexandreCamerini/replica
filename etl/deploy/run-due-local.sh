#!/usr/bin/env bash
# Chamado pelo launchd (launchd-install.sh): sobe o Postgres local se for ele o banco e estiver parado, depois roda run-due.
# Os dados do Postgres local vivem no checkout principal (.local/pg), não na worktree: usa o pg-local.sh de lá.
# Sem dados lá, sai com erro em vez de deixar o pg-local.sh criar um banco vazio na mesma porta.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN="$(cd "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
PG="$MAIN/db/pg-local.sh"
echo "== $(date '+%Y-%m-%d %H:%M:%S') run-due ($ROOT)"
if [[ -x "$PG" && "${ETL_DATABASE_URL:-}" == "$("$PG" url)" ]] && ! "$PG" status >/dev/null 2>&1; then
  [[ -f "$MAIN/.local/pg/PG_VERSION" ]] || { echo "Postgres local parado e sem dados em $MAIN/.local/pg; não crio banco vazio" >&2; exit 1; }
  echo "Postgres local parado; subindo"
  "$PG" start >/dev/null
fi
cd "$ROOT/etl"
exec "$ROOT/etl/.venv/bin/python" -m civico_etl.cli run-due "$@"
