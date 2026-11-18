#!/usr/bin/env bash
# Backup lógico diário do database do Segue o Voto no Railway, no Mac do dono (runbook-railway.md §6).
# O backup do Railway é do volume inteiro e restauraria também mydata, mcp e semente-id: este é o seguro só do Segue o Voto.
# Uso: bash db/railway/backup-launchd.sh install | uninstall [--purge-secret] | status | run-now | run | print-plist
#   install  -> pede a URI no próprio `security` (oculta; não passa por argv, plist, arquivo ou log), grava no Keychain
#               (serviço civico-backup, conta BACKUP_DATABASE_URL) e instala o agente org.civico.backup.railway às 03:20, todo dia.
#               Use a URI do role civico_etl no database de produção (precisa ler tudo). Dump com pg_dump >= versão do servidor: o Railway é 18 (brew install postgresql@18).
#   run      -> o que o launchd chama: dump -Fc --no-owner, confere com pg_restore --list, rotação (7 diários + 4 domingos), alerta.
# Saída: ~/Backups/segueovoto/civico-AAAA-MM-DD.dump (pasta 0700, arquivos 0600). Log: ~/Library/Logs/civico-backup.log.
# Falha (dump quebrado, pouco disco, cliente velho) avisa pelo webhook ETL_ALERT_WEBHOOK do Keychain civico-etl-prod, se existir.
# O Mac precisa estar ligado às 03:20 ou ao acordar (launchd roda o disparo perdido). Guarde uma cópia semanal FORA da máquina.
# Testes locais: BACKUP_DATABASE_URL e BACKUP_DIR no ambiente dispensam o Keychain.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=org.civico.backup.railway
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE="${CIVICO_BACKUP_KEYCHAIN_SERVICE:-civico-backup}"; ACCOUNT=BACKUP_DATABASE_URL
DIR="${BACKUP_DIR:-$HOME/Backups/segueovoto}"
LOG="${BACKUP_LOG:-$HOME/Library/Logs/civico-backup.log}"
xml() { local v=${1//&/&amp;}; v=${v//</&lt;}; v=${v//>/&gt;}; printf '%s' "$v"; }

plist() {
  cat <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>$(xml "$HERE/backup-launchd.sh")</string><string>run</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>20</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(xml "$HOME/Library/Logs/civico-backup.launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$HOME/Library/Logs/civico-backup.launchd.log")</string>
</dict></plist>
PL
}
have_item() { security find-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; }

run_backup() {
  mkdir -p "$DIR" "$(dirname "$LOG")"; chmod 700 "$DIR"
  if [[ -f "$LOG" && "$(stat -f %z "$LOG")" -gt $((5 * 1024 * 1024)) ]]; then mv -f "$LOG" "$LOG.1"; fi
  exec >>"$LOG" 2>&1
  echo "== $(date '+%Y-%m-%d %H:%M:%S') backup"
  local HOOK; HOOK="$(security find-generic-password -s civico-etl-prod -a ETL_ALERT_WEBHOOK -w 2>/dev/null || true)"
  [[ "$HOOK" =~ ^https://[^[:space:]\"\\]+$ ]] || HOOK=""
  die() { echo "ERRO: $1" >&2; [[ -n "$HOOK" ]] && printf 'url = "%s"\n' "$HOOK" | curl -sS -m 15 -K - -H 'Content-Type: application/json' -d "{\"text\": \"backup Segue o Voto (Mac): $1\"}" >/dev/null 2>&1; exit 1; }
  local URI="${BACKUP_DATABASE_URL:-}"
  [[ -n "$URI" ]] || URI="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w 2>/dev/null)" || die "sem a URI no Keychain ($SERVICE); rode backup-launchd.sh install"
  [[ "$URI" =~ ^postgres(ql)?:// ]] || die "o item do Keychain não parece uma URI postgres://"
  source "$HERE/lib-uri.sh"
  PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/civico-bkp.XXXXXX")"; chmod 700 "$PGDIR"; trap "rm -rf '$PGDIR'" EXIT
  local FULL; FULL="$(secure "$URI")"; unset URI
  uri pgpass "$FULL" > "$PGDIR/pgpass"; chmod 600 "$PGDIR/pgpass"; export PGPASSFILE="$PGDIR/pgpass"
  local TARGET; TARGET="$(uri nopass "$FULL")"; unset FULL
  command -v pg_dump >/dev/null && command -v pg_restore >/dev/null || die "pg_dump/pg_restore não encontrados (brew install postgresql@18)"
  local SRV DUMPV; SRV="$(psql "$TARGET" -X -At -c 'show server_version_num' 2>&1)" || die "não conectou ao banco: ${SRV:0:200}"
  DUMPV="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
  (( DUMPV >= SRV / 10000 )) || die "pg_dump $DUMPV é mais velho que o servidor (${SRV:0:2}); brew install postgresql@${SRV:0:2}"
  # disco: pelo menos 2x o último dump (ou 5 GB se ainda não há)
  local LAST NEED FREE; LAST="$(ls -t "$DIR"/civico-*.dump 2>/dev/null | head -1 || true)"
  NEED=$(( 5 * 1024 * 1024 )); [[ -n "$LAST" ]] && NEED=$(( 2 * $(stat -f %z "$LAST") / 1024 ))
  FREE="$(df -k "$DIR" | awk 'NR==2 {print $4}')"
  (( FREE > NEED )) || die "pouco disco em $DIR: livre ${FREE} KB, preciso de ~${NEED} KB"
  local OUT="$DIR/civico-$(date +%F).dump" TMP="$DIR/.civico-parcial.dump"
  local T0=$SECONDS; rm -f "$TMP"
  pg_dump "$TARGET" -Fc --no-owner -f "$TMP" || { rm -f "$TMP"; die "pg_dump falhou"; }
  pg_restore --list "$TMP" > "$PGDIR/toc.txt" || { rm -f "$TMP"; die "o dump gerado não abre (pg_restore --list falhou)"; }
  local NT; NT="$(grep -c ' TABLE DATA ' "$PGDIR/toc.txt" || true)"
  (( NT >= 50 )) || { rm -f "$TMP"; die "o dump tem só $NT tabelas com dados (esperado 90+); não substitui o anterior"; }
  chmod 600 "$TMP"; mv -f "$TMP" "$OUT"
  echo "ok: $OUT ($(du -h "$OUT" | cut -f1), $NT tabelas, $((SECONDS - T0))s)"; date +%s > "$DIR/.ultimo-ok"
  # rotação: 7 dias de diários; domingos ficam 28 dias
  find "$DIR" -name 'civico-*.dump' -mtime +7 | while read -r f; do
    d="${f##*civico-}"; d="${d%.dump}"
    if [[ "$(date -j -f %F "$d" +%u 2>/dev/null || echo 0)" == 7 && -n "$(find "$f" -mtime -29)" ]]; then continue; fi
    rm -f "$f" && echo "removido (rotação): $f"
  done
}

case "${1:-status}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$DIR"; chmod 700 "$DIR"
    [[ -t 0 && -t 1 ]] || { echo "rode num terminal: o security pede a URI ali, oculta" >&2; exit 1; }
    if have_item && [[ "${2:-}" == "--keep-uri" ]]; then echo "mantendo a URI do Keychain"; else
      echo "Cole a URI do role civico_etl no database de produção (postgres://civico_etl:...@host:porta/civico?sslmode=require) quando o security pedir; ela não é exibida."
      security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w
    fi
    u="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"
    [[ "$u" =~ ^postgres(ql)?://[^[:space:]]+@ ]] || { security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1; echo "URI recusada e removida do Keychain: precisa ser postgres://usuario:senha@host/banco" >&2; exit 1; }
    unset u
    plist > "$PLIST"; chmod 600 "$PLIST"; plutil -lint "$PLIST" >/dev/null
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "instalado: $LABEL, todo dia às 03:20; backups em $DIR; log em $LOG"
    echo "teste agora: bash $0 run-now   |   acompanhe: tail -f $LOG" ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"
    [[ "${2:-}" == "--purge-secret" ]] && security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null 2>&1 && echo "URI removida do Keychain"
    echo "removido (os dumps em $DIR ficam)" ;;
  status)
    echo "launchd:  $(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "^\s*(state|last exit code|runs) =" | tr -s ' ' | paste -sd ';' - || true)"
    [[ -f "$PLIST" ]] || echo "plist:    não instalado"
    have_item && echo "keychain: URI presente ($SERVICE)" || echo "keychain: SEM a URI ($SERVICE); rode install"
    if [[ -f "$DIR/.ultimo-ok" ]]; then echo "último ok: $(date -r "$(cat "$DIR/.ultimo-ok")" '+%F %T') ($(( ($(date +%s) - $(cat "$DIR/.ultimo-ok")) / 3600 ))h atrás)"; else echo "último ok: nenhum"; fi
    ls -lh "$DIR"/civico-*.dump 2>/dev/null | awk '{print "          " $5 "  " $9}' | tail -8 || true
    [[ -f "$LOG" ]] && tail -n 4 "$LOG" | sed 's/^/          /' || true ;;
  run-now) launchctl kickstart "gui/$(id -u)/$LABEL"; echo "disparado; acompanhe com: tail -f $LOG" ;;
  run) run_backup ;;
  print-plist) plist ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
