#!/usr/bin/env bash
# Roda as duas conferências do ensaio (placar por UF da Câmara e `check` antigo x novo) numa só chamada, resolvendo a URL
# do banco sozinho. Existe porque colar a URL "na mão" falhou várias vezes (variável vazia, texto de comando no lugar da
# URL, aba de terminal diferente, `export NOME=` junto).
#
#   bash etl/deploy/conferir-ensaio.sh              # roda tudo
#   bash etl/deploy/conferir-ensaio.sh --selftest   # testa só a limpeza e a validação da URL, sem banco
#
# De onde vem a URL (a primeira que valer): ETL_DATABASE_URL, DATABASE_URL, a área de transferência (pbpaste) ou digitada
# (não aparece na tela). Limpa `export NOME=`, aspas e espaços. Só aceita postgres://, só a rede pública (não *.railway.internal) e
# só banco cujo nome contenha "ensaio" (nunca roda contra produção por engano). A URL fica só neste processo: não é gravada nem impressa.
# Só lê o banco. Saída: 0 = as duas conferências passaram; 1 = divergência em alguma; 2 = não deu para conferir.
set -uo pipefail

limpar() { # stdin -> stdout: tira `export NOME=`, aspas e espaços/quebras das pontas
  tr -d '\r' | sed -E "s/^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z_0-9]*=//; s/^[[:space:]\"']+//; s/[[:space:]\"']+\$//" | head -n1
}
valida() { # $1 = URL candidata; devolve 0 se é uma URL postgres de banco de ensaio na rede pública; imprime o motivo no stderr se não
  local u="$1" host db
  case "$u" in postgres://*|postgresql://*) ;; *) echo "não começa com postgres:// (${#u} caracteres; conteúdo não exibido)" >&2; return 1 ;; esac
  case "$u" in *[[:space:]]*) echo "tem espaço no meio (não é uma URL só)" >&2; return 1 ;; esac
  host="${u#*@}"; host="${host%%[:/?]*}"; db="${u##*/}"; db="${db%%\?*}"
  case "$host" in *.railway.internal|railway.internal) echo "host interno do Railway ($host): não resolve fora do Railway; use a URL pública (proxy.rlwy.net)" >&2; return 1 ;; esac
  case "$db" in *ensaio*) ;; *) echo "o banco se chama '$db', não 'ensaio': recuso por segurança (este script é só para o civico_ensaio)" >&2; return 1 ;; esac
  return 0
}

if [ "${1:-}" = "--selftest" ]; then
  falhas=0
  ok()  { valida "$(printf '%s' "$1" | limpar)" 2>/dev/null && echo "ok   aceita: ${2}" || { echo "FALHA devia aceitar: $2"; falhas=$((falhas+1)); }; }
  no()  { valida "$(printf '%s' "$1" | limpar)" 2>/dev/null && { echo "FALHA devia recusar: $2"; falhas=$((falhas+1)); } || echo "ok   recusa: ${2}"; }
  ok "postgresql://u:p@x.proxy.rlwy.net:1234/civico_ensaio" "URL pura"
  ok "export DATABASE_URL='postgresql://u:p@x.proxy.rlwy.net:1234/civico_ensaio'" "com export e aspas"
  ok "DATABASE_URL=\"postgres://u:p@h:5/civico_ensaio?sslmode=require\"" "NOME=\"...\" com query"
  ok "  postgresql://u:p@h:5/civico_ensaio  " "com espaços"
  no "cd /Users/x/y && python3 etl/deploy/conferir-votos-camara.py" "texto de comando"
  no "" "vazio"
  no "<url somente leitura do civico_ensaio>" "texto de exemplo"
  no "postgresql://u:p@db.railway.internal:5432/civico_ensaio" "host interno"
  no "postgresql://u:p@x.proxy.rlwy.net:1234/civico" "banco de produção"
  no "postgresql://u:p@x.proxy.rlwy.net:1234/railway" "banco sem 'ensaio'"
  [ "$falhas" -eq 0 ] && { echo "selftest: tudo ok"; exit 0; } || { echo "selftest: $falhas falha(s)"; exit 1; }
fi

command -v psql >/dev/null || { echo "psql não encontrado" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 não encontrado" >&2; exit 2; }
command -v uv >/dev/null || { echo "uv não encontrado" >&2; exit 2; }
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$RAIZ" || exit 2

URL=""
for origem in "env:${ETL_DATABASE_URL:-}" "env:${DATABASE_URL:-}" "clipboard:$(command -v pbpaste >/dev/null && pbpaste 2>/dev/null | head -c 2000)"; do
  nome="${origem%%:*}"; cand="$(printf '%s' "${origem#*:}" | limpar)"
  [ -n "$cand" ] || continue
  if valida "$cand" 2>"${TMPDIR:-/tmp}/.conferir-motivo.$$"; then URL="$cand"; echo "URL: vinda de $nome"; break; else echo "URL de $nome recusada: $(cat "${TMPDIR:-/tmp}/.conferir-motivo.$$")"; fi
done
rm -f "${TMPDIR:-/tmp}/.conferir-motivo.$$"
if [ -z "$URL" ]; then
  if { : </dev/tty >/dev/tty; } 2>/dev/null; then
    printf 'Cole a URL pública do civico_ensaio (Railway) e dê Enter (não aparece na tela): ' >/dev/tty
    IFS= read -rs cand </dev/tty; printf '\n' >/dev/tty
    cand="$(printf '%s' "$cand" | limpar)"
    valida "$cand" || { echo "URL recusada." >&2; exit 2; }
    URL="$cand"
  else
    echo "sem URL válida no ambiente nem na área de transferência, e sem terminal para digitar: copie a URL do Railway e rode de novo" >&2; exit 2
  fi
fi

export DATABASE_URL="$URL" ETL_DATABASE_URL="$URL" PGCONNECT_TIMEOUT=15
# mostra só host e banco (sem usuário nem senha) para você conferir que é o ensaio
alvo="${URL#*@}"; echo "alvo: ${alvo%%\?*}"
banco="$(psql "$URL" -X -A -t -c 'select current_database()' 2>&1)" || { echo "não conectei: $(printf '%s' "$banco" | tail -1 | sed -E 's#(postgres(ql)?://)[^@ ]*@#\1***@#g')" >&2; exit 2; }
echo "conectado em: $banco"
# o `check` do ETL roda com o Python do CI (3.12); o padrão do uv aqui pegou o 3.14
export UV_PYTHON="${UV_PYTHON:-3.12}"

rc=0
echo; echo "=== 1/2 · placar por UF da Câmara contra a fonte oficial ==="
python3 -I etl/deploy/conferir-votos-camara.py; r1=$?
echo; echo "=== 2/2 · civico-etl check: código antigo x novo ==="
bash etl/deploy/comparar-check.sh; r2=$?
echo; echo "resumo: votos da Câmara = $r1 · check antigo x novo = $r2   (0 confere · 1 diverge · 2 não conferiu)"
[ "$r1" -eq 2 ] || [ "$r2" -eq 2 ] && rc=2
[ "$rc" -eq 0 ] && { [ "$r1" -ne 0 ] || [ "$r2" -ne 0 ]; } && rc=1
exit "$rc"
