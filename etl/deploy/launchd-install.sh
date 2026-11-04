#!/usr/bin/env bash
# Agenda local do ETL (D250) no macOS: launchd chama `civico-etl run-due` de hora em hora; run-due decide o que venceu.
# Uso: etl/deploy/launchd-install.sh install|uninstall|status|logs
# Banco: ETL_DATABASE_URL do ambiente, senão o Postgres local (db/pg-local.sh url). Alerta: ETL_ALERT_WEBHOOK opcional.
# O Mac precisa estar ligado; launchd roda a chamada perdida quando ele acorda. Produção: .github/workflows/etl.yml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=org.civico.etl
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$ROOT/etl/.state/run-due.log"
URL="${ETL_DATABASE_URL:-$("$ROOT/db/pg-local.sh" url)}"
case "${1:-status}" in
  install)
    [[ -x "$ROOT/etl/.venv/bin/python" ]] || { echo "falta etl/.venv (cd etl && python3 -m venv .venv && .venv/bin/pip install -e .)" >&2; exit 1; }
    mkdir -p "$ROOT/etl/.state" "$(dirname "$PLIST")"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT/etl</string>
  <key>ProgramArguments</key><array>
    <string>$ROOT/etl/.venv/bin/python</string><string>-m</string><string>civico_etl.cli</string><string>run-due</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>ETL_DATABASE_URL</key><string>$URL</string>
    ${ETL_ALERT_WEBHOOK:+<key>ETL_ALERT_WEBHOOK</key><string>$ETL_ALERT_WEBHOOK</string>}
  </dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "instalado: $LABEL de hora em hora; log em $LOG; último resumo em etl/.state/last-run.json" ;;
  uninstall) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "removido" ;;
  status) launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|last exit|runs" || echo "não instalado" ;;
  logs) tail -n 80 "$LOG" ;;
esac
