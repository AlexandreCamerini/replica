#!/usr/bin/env bash
# Chamado pelo launchd (launchd-sapl-prod.sh): roda SÓ o SAPL das câmaras (sapl.todas) contra o banco de produção.
# A URI de escrita vem do Keychain neste instante e vai só para o ambiente do processo filho: não existe em plist, arquivo, argv nem log
# (o log passa por um filtro que troca a URI e a senha por marcadores caso algum erro as imprima).
# run-due normal: sem --force, respeita carimbo (20 h), lock de sessão (próprio: etl.scheduler.sapl, não disputa o do Actions, que exclui esta tarefa;
# o lock por dataset de cada câmara continua valendo contra run manual) e ETL_DEADLINE_MIN.
# Alerta: ETL_ALERT_WEBHOOK (Keychain, mesmo serviço) é OPCIONAL por compatibilidade: o launchd do dono roda este script do checkout dele, e exigir um item
# que ainda não existe no Keychain faria o SAPL parar (exit 78) assim que o checkout atualizasse. Sem o item o script avisa no log e segue rodando.
# Com o item: falha em pré-condição (URI, venv) dispara o webhook antes do Python, e o run-due recebe o webhook para os alertas dele. Esta tarefa não roda
# no Actions (D274); sem webhook, quem acusa a parada é o vigia do site (sapl, régua de 8 dias).
# Prazo (ETL_DEADLINE_MIN) = timeout da tarefa sapl.todas (schedule.py: 3 h = 180 min) + RESERVE_MIN (45) = 225. Conta: a tarefa pode gastar
# --orcamento-min 150 (não começa câmara nova depois disso) + até 25 min na câmara em curso (HOUSE_MAX_MIN) = 175 min < 180 min; com prazo menor,
# task_timeout_h corta o timeout (200 - 45 = 155 min) e a agenda mata a tarefa com exit 124 quando a fila passa de 150 min.
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

# O webhook vem do Keychain primeiro: as pré-condições abaixo usam-no para avisar. Nunca vai a argv nem a log (curl lê a URL por stdin).
HOOK="$(security find-generic-password -s "$SERVICE" -a ETL_ALERT_WEBHOOK -w 2>/dev/null)" || HOOK=""
json_esc() { local t="${1//\\/\\\\}"; printf '%s' "${t//\"/\\\"}"; } # escapa \ e " para JSON
alert() { # $1 = mensagem (escapada aqui); falha do alerta só vai ao log
  [[ -n "$HOOK" ]] || return 0
  printf 'url = "%s"\n' "$HOOK" | curl -sS -m 15 -K - -H 'Content-Type: application/json' -d "{\"text\": \"sapl.todas (prod, launchd): $(json_esc "$1")\"}" >/dev/null 2>&1 \
    || echo "webhook de alerta falhou ao enviar" >&2
}
die() { echo "$1" >&2; alert "$1"; exit 1; }
HOOK_RE='^https://[^[:space:]"\\]+$'
if [[ -n "$HOOK" && ! "$HOOK" =~ $HOOK_RE ]]; then
  HOOK="" # nunca sai por isso; o valor não é impresso
  echo "AVISO: ETL_ALERT_WEBHOOK com formato inválido; ignorado (esperado https://... sem espaço, aspas ou barra invertida). Falha deste run não será avisada; o vigia do site acusa em até 8 dias." >&2
elif [[ -z "$HOOK" ]]; then
  # Não é erro: segue rodando como antes. O valor do webhook nunca aparece aqui (nem existe).
  echo "AVISO: sem ETL_ALERT_WEBHOOK no Keychain: falha deste run não será avisada; o vigia do site acusa em até 8 dias. Para ativar o alerta: security add-generic-password -U -s $SERVICE -a ETL_ALERT_WEBHOOK -w" >&2
fi

URI="$(security find-generic-password -s "$SERVICE" -a ETL_DATABASE_URL -w 2>/dev/null)" || die "sem a URI no Keychain (serviço $SERVICE); rode launchd-sapl-prod.sh install"
[[ "$URI" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || die "o item do Keychain não parece uma URI postgres://"
[[ -x "$PY" ]] || die "falta $PY (cd etl && python3 -m venv .venv && .venv/bin/pip install -e .)"

export ETL_DATABASE_URL="$URI"
unset URI
if [[ -n "$HOOK" ]]; then export ETL_ALERT_WEBHOOK="$HOOK"; else unset ETL_ALERT_WEBHOOK; fi
export ETL_TASKS_INCLUDE=sapl.todas
export ETL_DEADLINE_MIN="${ETL_DEADLINE_MIN:-225}"
export ETL_STATE_DIR="${CIVICO_SAPL_STATE:-$HOME/Library/Application Support/civico-etl-sapl}"
mkdir -p "$ETL_STATE_DIR"

cd "$ROOT/etl"
set +e
"$PY" -m civico_etl.cli run-due 2>&1 | awk '
  BEGIN { u = ENVIRON["ETL_DATABASE_URL"]; w = ENVIRON["ETL_ALERT_WEBHOOK"]; p = u; sub(/^[^:]*:\/\/[^:]*:/, "", p); sub(/@.*/, "", p); if (p == u) p = "" }
  { l = $0
    if (length(u)) while ((i = index(l, u)) > 0) l = substr(l, 1, i - 1) "<URI>" substr(l, i + length(u))
    if (length(w)) while ((i = index(l, w)) > 0) l = substr(l, 1, i - 1) "<webhook>" substr(l, i + length(w))
    if (length(p) > 3) while ((i = index(l, p)) > 0) l = substr(l, 1, i - 1) "<senha>" substr(l, i + length(p))
    print l; fflush() }'
rc=${PIPESTATUS[0]}
if [[ "$rc" -ne 0 && "$rc" -ne 2 ]]; then alert "run-due saiu com exit $rc"; fi # exit 2: o próprio run-due já alertou
unset HOOK
echo "== fim (exit $rc)"
exit "$rc"
