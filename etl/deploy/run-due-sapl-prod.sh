#!/usr/bin/env bash
# Chamado pelo launchd (launchd-sapl-prod.sh): roda SÓ o SAPL das câmaras (sapl.todas) contra o banco de produção.
# A URI de escrita vem do Keychain neste instante e vai só para o ambiente do processo filho: não existe em plist, arquivo, argv nem log
# (o log passa por um filtro que troca a URI e a senha por marcadores caso algum erro as imprima).
# run-due normal: sem --force, respeita carimbo (20 h), lock de sessão (próprio: etl.scheduler.sapl, não disputa o do Actions, que exclui esta tarefa;
# o lock por dataset de cada câmara continua valendo contra run manual) e ETL_DEADLINE_MIN.
# Variáveis para teste: CIVICO_KEYCHAIN_SERVICE, CIVICO_ETL_PYTHON, CIVICO_SAPL_LOG, CIVICO_SAPL_STATE.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE="${CIVICO_KEYCHAIN_SERVICE:-civico-etl-prod}"
PY="${CIVICO_ETL_PYTHON:-$ROOT/etl/.venv/bin/python}"
LOG="${CIVICO_SAPL_LOG:-$HOME/Library/Logs/civico-etl-sapl.log}"
MAX_LOG=$((5 * 1024 * 1024))
mkdir -p "$(dirname "$LOG")"
# rotação simples: um arquivo anterior (.1) e o corrente
if [[ -f "$LOG" && "$(stat -f %z "$LOG")" -gt "$MAX_LOG" ]]; then mv -f "$LOG" "$LOG.1"; fi
exec >>"$LOG" 2>&1
echo "== $(date '+%Y-%m-%d %H:%M:%S') run-due sapl.todas (prod)"

URI="$(security find-generic-password -s "$SERVICE" -a ETL_DATABASE_URL -w 2>/dev/null)" || { echo "sem a URI no Keychain (serviço $SERVICE); rode launchd-sapl-prod.sh install" >&2; exit 1; }
[[ "$URI" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || { echo "o item do Keychain não parece uma URI postgres://" >&2; exit 1; }
[[ -x "$PY" ]] || { echo "falta $PY (cd etl && python3 -m venv .venv && .venv/bin/pip install -e .)" >&2; exit 1; }

export ETL_DATABASE_URL="$URI"
unset URI
if HOOK="$(security find-generic-password -s "$SERVICE" -a ETL_ALERT_WEBHOOK -w 2>/dev/null)"; then export ETL_ALERT_WEBHOOK="$HOOK"; fi  # opcional
unset HOOK
export ETL_TASKS_INCLUDE=sapl.todas
export ETL_DEADLINE_MIN="${ETL_DEADLINE_MIN:-200}"
export ETL_STATE_DIR="${CIVICO_SAPL_STATE:-$HOME/Library/Application Support/civico-etl-sapl}"
mkdir -p "$ETL_STATE_DIR"

cd "$ROOT/etl"
set +e
"$PY" -m civico_etl.cli run-due 2>&1 | awk '
  BEGIN { u = ENVIRON["ETL_DATABASE_URL"]; p = u; sub(/^[^:]*:\/\/[^:]*:/, "", p); sub(/@.*/, "", p); if (p == u) p = "" }
  { l = $0
    if (length(u)) while ((i = index(l, u)) > 0) l = substr(l, 1, i - 1) "<URI>" substr(l, i + length(u))
    if (length(p) > 3) while ((i = index(l, p)) > 0) l = substr(l, 1, i - 1) "<senha>" substr(l, i + length(p))
    print l; fflush() }'
rc=${PIPESTATUS[0]}
echo "== fim (exit $rc)"
exit "$rc"
