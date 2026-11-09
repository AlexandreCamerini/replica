#!/usr/bin/env bash
# Corrige as variáveis de ambiente do projeto `replica` na Vercel depois do incidente de 08/11/2026:
#   - DATABASE_URL perdeu o ambiente Production (ficou só em Preview); o deploy de produção quebrava no build.
#   - DATABASE_WRITE_URL ganhou Preview por engano; preview não escreve.
#   - Preview estava em DATA_SOURCE=demo + ALLOW_DEMO_DATA=1; o pedido é preview com dados reais (leitura).
#
# Estado final:
#   Production: DATA_SOURCE=pg, DATABASE_URL, DATABASE_WRITE_URL
#   Preview:    DATA_SOURCE=pg, DATABASE_URL (mesma conexão de leitura, usuário web_reader)
#
# Pede a URL de leitura uma vez, sem eco (a CLI não consegue copiar um Secret já gravado). Nada é impresso.
# Uso: bash etl/deploy/vercel-env-fix.sh            # aplica e refaz os deploys
#      bash etl/deploy/vercel-env-fix.sh --dry-run  # só mostra o que faria
set -euo pipefail

SCOPE="alexandrecamerini"
PROJECT="replica"
PREVIEW_BRANCH="claude/design-consent-63af20"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1

vs() { npx --yes vercel "$@" --scope "$SCOPE"; }                 # comandos de conta/deploy
v() { npx --yes vercel "$@" --scope "$SCOPE" --project "$PROJECT"; }  # comandos de env (checkout não linkado)
run() { if (( DRY )); then echo "[dry-run] $*"; else "$@"; fi; }

command -v npx >/dev/null || { echo "npx não encontrado (instale Node)"; exit 1; }
vs whoami >/dev/null 2>&1 || { echo "Faça login antes: npx vercel login"; exit 1; }

DB_URL="${DB_URL:-}"   # pode vir do ambiente (vercel-preview-prod-db.sh); senão, pede
if (( ! DRY )) && [[ -z "$DB_URL" ]]; then
  echo "Cole a DATABASE_URL de leitura (postgres://web_reader:...). Nada será exibido."
  read -r -s DB_URL; echo
fi
if (( ! DRY )); then
  [[ "$DB_URL" =~ ^postgres(ql)?:// ]] || { echo "Não parece uma URL postgres://. Abortado."; exit 1; }
  [[ "$DB_URL" == *web_reader* ]] || echo "Aviso: a URL não usa o usuário web_reader; o preview teria mais permissão que o necessário."
fi

echo "1/5 DATABASE_URL: Production e Preview"
run v env rm DATABASE_URL production --yes >/dev/null 2>&1 || true
run v env rm DATABASE_URL preview --yes >/dev/null 2>&1 || true
if (( ! DRY )); then
  # --yes evita o prompt "Git branch?" do Preview (que engolia o valor); uma chamada cobre os dois ambientes
  printf '%s' "$DB_URL" | v env add DATABASE_URL --environment production,preview --sensitive --yes >/dev/null
fi

echo "2/5 DATABASE_WRITE_URL: só Production"
run v env rm DATABASE_WRITE_URL preview --yes >/dev/null 2>&1 || true

echo "3/5 Preview: DATA_SOURCE=pg, sem ALLOW_DEMO_DATA"
run v env rm DATA_SOURCE preview --yes >/dev/null 2>&1 || true
run v env rm ALLOW_DEMO_DATA preview --yes >/dev/null 2>&1 || true
if (( ! DRY )); then printf 'pg' | v env add DATA_SOURCE --environment preview --no-sensitive --yes >/dev/null; fi
unset DB_URL

echo "4/5 Conferência"
v env ls 2>/dev/null | grep -E "^ (DATA_SOURCE|DATABASE_URL|DATABASE_WRITE_URL|ALLOW_DEMO_DATA) " | awk '{$2="";$3=""; print}'

echo "5/5 Deploys"
if (( ! DRY )); then
  PREV=$(vs ls "$PROJECT" 2>/dev/null | grep -E 'Ready +Preview' | grep -oE 'https://replica-[a-z0-9]+-[a-z0-9]+\.vercel\.app' | head -1)
  [[ -n "$PREV" ]] && vs redeploy "$PREV" >/dev/null && echo "preview refeito: https://replica-git-${PREVIEW_BRANCH//\//-}-${SCOPE}.vercel.app"
  PROD=$(vs ls "$PROJECT" --prod 2>/dev/null | grep -oE 'https://replica-[a-z0-9]+-[a-z0-9]+\.vercel\.app' | head -1)
  [[ -n "$PROD" ]] && vs redeploy "$PROD" >/dev/null && echo "produção refeita a partir de $PROD"
fi
echo "Pronto. Preview exige login da Vercel na primeira abertura."
