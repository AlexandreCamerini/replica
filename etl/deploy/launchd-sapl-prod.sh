#!/usr/bin/env bash
# SAPL das câmaras no Mac do dono contra a PRODUÇÃO (D274): launchd chama, de hora em hora, run-due-sapl-prod.sh, que roda só `sapl.todas`.
# Uso: etl/deploy/launchd-sapl-prod.sh install [--keep-uri] | uninstall [--purge-secret] | status | run-now | print-plist
#
# A URI de escrita de produção NUNCA passa por argv, plist, arquivo ou log:
#   install  -> `security add-generic-password -w` SEM valor: o próprio `security` pede a URI no terminal, oculta, e grava no Keychain de login
#               (serviço civico-etl-prod, conta ETL_DATABASE_URL). Este script não a vê entrar.
#   run      -> o wrapper lê do Keychain no momento da execução e exporta só para o processo filho.
# O plist (org.civico.etl.sapl-prod) só tem caminhos e horário. Diferente do launchd-install.sh (Postgres local, URL em texto claro no plist, D250),
# este script não pode repetir isso: produção só pelo Keychain.
# Use a conexão direta ou o pooler em modo SESSÃO do Supabase (nunca :6543, modo transação: os locks de sessão não valem). O role é o de escrita do ETL.
# Item opcional: conta ETL_ALERT_WEBHOOK no mesmo serviço (security add-generic-password -U -s civico-etl-prod -a ETL_ALERT_WEBHOOK -w).
# O Mac precisa estar ligado; launchd roda o disparo perdido quando ele acorda. Instale do checkout que vai continuar existindo (o plist guarda o caminho).
# Log: ~/Library/Logs/civico-etl-sapl.log (rotação em 5 MB, 1 arquivo anterior). Último resumo da agenda: ~/Library/Application Support/civico-etl-sapl/last-run.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=org.civico.etl.sapl-prod
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE="${CIVICO_KEYCHAIN_SERVICE:-civico-etl-prod}"
ACCOUNT=ETL_DATABASE_URL
LOG="$HOME/Library/Logs/civico-etl-sapl.log"
WRAP="$ROOT/etl/deploy/run-due-sapl-prod.sh"
xml() { local v=${1//&/&amp;}; v=${v//</&lt;}; v=${v//>/&gt;}; printf '%s' "$v"; }

uri_problem() {  # $1 = URI (argumento de função, não de processo). Imprime o problema, ou nada se estiver ok.
  [[ "$1" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || { echo "não é uma URI postgres://…"; return; }
  [[ "$1" =~ :6543(/|\?|$) || "$1" == *pgbouncer=true* ]] && { echo "porta 6543 (pooler em modo transação): use a conexão direta ou o pooler em modo sessão"; return; }
  [[ "$1" == *@*  ]] || echo "sem usuário e senha (user:senha@host)"
}
have_item() { security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; }
masked() {  # postgres://user:***@host:porta/banco: nunca a senha
  local u; u="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)" || return 1
  printf '%s' "$u" | sed -E 's#^([^:]*://[^:@/]*)(:[^@]*)?@#\1:***@#'
}
plist() {
  cat <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$(xml "$ROOT/etl")</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>$(xml "$WRAP")</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Minute</key><integer>47</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml "$HOME/Library/Logs/civico-etl-sapl.launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$HOME/Library/Logs/civico-etl-sapl.launchd.log")</string>
</dict></plist>
PL
}

case "${1:-status}" in
  install)
    [[ -x "$ROOT/etl/.venv/bin/python" ]] || { echo "falta etl/.venv (cd etl && python3 -m venv .venv && .venv/bin/pip install -e .)" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    if [[ "${2:-}" != "--keep-uri" ]]; then
      [[ -t 0 && -t 1 ]] || { echo "rode num terminal: o security pede a URI ali, oculta" >&2; exit 1; }
      if have_item; then
        read -r -p "já existe uma URI no Keychain ($SERVICE). Substituir? [s/N] " ans
        [[ "$ans" =~ ^[sS]$ ]] || { echo "mantida; use install --keep-uri para só reinstalar o plist"; exit 1; }
      fi
      echo "Cole a URI de ESCRITA do banco de produção (postgres://usuario:senha@host:5432/postgres) quando o security pedir; ela não aparece na tela."
      security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w
    fi
    have_item || { echo "sem a URI no Keychain ($SERVICE)" >&2; exit 1; }
    uri="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"
    why="$(uri_problem "$uri")"; unset uri
    if [[ -n "$why" ]]; then
      security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1 || true
      echo "URI recusada e removida do Keychain: $why" >&2; exit 1
    fi
    plist > "$PLIST"; chmod 600 "$PLIST"
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "instalado: $LABEL, de hora em hora (minuto 47); log em $LOG"
    echo "confira com: $0 status   |   primeira execução agora: $0 run-now" ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"
    if [[ "${2:-}" == "--purge-secret" ]]; then security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1 && echo "URI removida do Keychain"; fi
    echo "removido (a URI continua no Keychain; use uninstall --purge-secret para apagá-la)" ;;
  status)
    echo "launchd:  $(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "^\s*(state|last exit code|runs) =" | tr -s ' ' | paste -sd ';' - || true)"
    [[ -f "$PLIST" ]] || echo "plist:    não instalado"
    if have_item; then
      echo "keychain: URI presente ($SERVICE) → $(masked)"
      u="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"; why="$(uri_problem "$u")"; unset u
      [[ -z "$why" ]] || echo "          PROBLEMA: $why"
    else
      echo "keychain: SEM a URI ($SERVICE); rode install"
    fi
    echo "log:      $LOG"; [[ -f "$LOG" ]] && tail -n 5 "$LOG" | sed 's/^/          /' || true ;;
  run-now) launchctl kickstart "gui/$(id -u)/$LABEL"; echo "disparado; acompanhe com: tail -f $LOG" ;;
  print-plist) plist ;;
  *) echo "uso: $0 install [--keep-uri] | uninstall [--purge-secret] | status | run-now | print-plist" >&2; exit 2 ;;
esac
