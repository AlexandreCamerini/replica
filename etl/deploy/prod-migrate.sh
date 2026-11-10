#!/usr/bin/env bash
# Aplica as migrações pendentes de db/migrations/ no banco de PRODUÇÃO.
# Pede a URI de escrita (Session pooler, usuário postgres) com entrada oculta; ela só vai para o ambiente do migrate.sh.
# Uso: bash etl/deploy/prod-migrate.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
command -v psql >/dev/null || { echo "psql não encontrado"; exit 1; }
echo "Cole a URI de escrita da produção (postgres://postgres.<ref>:...@...pooler.supabase.com:5432/postgres). Nada será exibido."
read -r -s PROD_URL; echo
[[ "$PROD_URL" =~ ^postgres(ql)?:// ]] || { echo "Não começa com postgres://. Abortado."; exit 1; }
[[ "$PROD_URL" =~ @(localhost|127\.0\.0\.1)[:/] ]] && { echo "É um banco local. Abortado."; exit 1; }
echo "Pendentes em produção:"
comm -23 <(ls "$ROOT/db/migrations" | sort) <(psql "$PROD_URL" -X -At -c "select filename from schema_migrations" | sort) | sed 's/^/  /'
read -r -p "Aplicar agora? [y/N] " ok; [[ "$ok" == [yY] ]] || { echo "Nada aplicado."; exit 0; }
DATABASE_URL="$PROD_URL" "$ROOT/db/migrate.sh"
unset PROD_URL
echo "Pronto."
