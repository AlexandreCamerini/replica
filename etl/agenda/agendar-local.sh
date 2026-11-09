#!/usr/bin/env bash
# Agenda os jobs no Mac (launchd) contra o banco local, enquanto não há banco hospedado.
# Em produção quem agenda é .github/workflows/etl-*.yml; este script é para o ambiente local.
#
#   ETL_DATABASE_URL=postgres://postgres@localhost:54339/civico etl/agenda/agendar-local.sh instalar            # só pauta
#   ETL_DATABASE_URL=... etl/agenda/agendar-local.sh instalar --com-rascunho                                    # + rascunho (custa API)
#   etl/agenda/agendar-local.sh status
#   etl/agenda/agendar-local.sh remover
#
# pauta: a cada 30 min. rascunho: seg–sex 08:30 e 14:30, no máximo RASCUNHO_LIMITE chamadas (padrão 10).
# O Mac dormindo pula o disparo; o launchd roda o perdido ao acordar. Logs em etl/.agenda-logs/.
set -euo pipefail

ETL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$ETL_DIR/.agenda-logs"
PREFIX="br.civico.etl"

plist() { echo "$AGENTS/$PREFIX.$1.plist"; }
xml() { local s="${1//&/&amp;}"; s="${s//</&lt;}"; printf '%s' "${s//>/&gt;}"; }

write_plist() { # nome, comando, bloco de agenda
  local name="$1" cmd url when="$3"
  cmd="$(xml "$2")"
  url="$(xml "$ETL_DATABASE_URL")"
  cat >"$(plist "$name")" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PREFIX.$name</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>$cmd</string></array>
  <key>WorkingDirectory</key><string>$ETL_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ETL_DATABASE_URL</key><string>$url</string>
    <key>RASCUNHO_MODEL</key><string>${RASCUNHO_MODEL:-}</string>
  </dict>
  $when
  <key>StandardOutPath</key><string>$LOGS/$name.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$name.log</string>
</dict>
</plist>
EOF
  plutil -lint "$(plist "$name")" >/dev/null
  launchctl bootout "gui/$(id -u)/$PREFIX.$name" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$(plist "$name")"
  echo "agendado: $PREFIX.$name"
}

cal() { # dia-da-semana hora minuto
  echo "<dict><key>Weekday</key><integer>$1</integer><key>Hour</key><integer>$2</integer><key>Minute</key><integer>$3</integer></dict>"
}

case "${1:-}" in
  instalar)
    : "${ETL_DATABASE_URL:?defina ETL_DATABASE_URL (ex. postgres://postgres@localhost:54339/civico)}"
    case "$ETL_DATABASE_URL" in
      *localhost*|*127.0.0.1*) ;;
      *) echo "recusado: este agendador é só para banco local; produção usa os workflows do GitHub" >&2; exit 2 ;;
    esac
    command -v uv >/dev/null || { echo "uv não encontrado no PATH" >&2; exit 2; }
    limit="${RASCUNHO_LIMITE:-10}"
    [[ "$limit" =~ ^[0-9]+$ ]] && (( limit >= 1 && limit <= 50 )) || { echo "RASCUNHO_LIMITE entre 1 e 50" >&2; exit 2; }
    mkdir -p "$AGENTS" "$LOGS"
    write_plist pauta "date; uv run --frozen civico-etl pauta" "<key>StartInterval</key><integer>1800</integer><key>RunAtLoad</key><true/>"
    if [[ "${2:-}" == "--com-rascunho" ]]; then
      when="<key>StartCalendarInterval</key><array>"
      for d in 1 2 3 4 5; do when+="$(cal "$d" 8 30)$(cal "$d" 14 30)"; done
      when+="</array>"
      write_plist rascunho "date; uv run --frozen civico-etl rascunho --limit $limit && uv run --frozen civico-etl revisar" "$when"
    fi
    ;;
  status)
    launchctl list | grep "$PREFIX" || echo "nada agendado"
    for f in "$LOGS"/*.log; do [[ -f "$f" ]] && { echo "--- $f"; tail -5 "$f"; }; done
    ;;
  remover)
    for name in pauta rascunho; do
      launchctl bootout "gui/$(id -u)/$PREFIX.$name" 2>/dev/null && echo "removido: $PREFIX.$name" || true
      rm -f "$(plist "$name")"
    done
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
