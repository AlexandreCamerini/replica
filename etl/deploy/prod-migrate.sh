#!/usr/bin/env bash
# Aplica as migrações pendentes de db/migrations/ no banco de PRODUÇÃO.
# Pede a URI de escrita com entrada oculta; ela só vai para o ambiente do migrate.sh.
#   Supabase: Session pooler, usuário postgres.  Railway (depois do corte): URI do role civico_etl no database do Segue o Voto.
# Fora do local acrescenta sslmode=require se faltar. Em host que não é Supabase as migrações rodam com `SET ROLE civico_etl`
# (MIGRATE_ROLE troca o role; MIGRATE_ROLE= vazio desliga), para os objetos novos nascerem com o dono certo.
# Uso: bash etl/deploy/prod-migrate.sh
#      MIGRATE_ATE=0143 bash etl/deploy/prod-migrate.sh   # aplica só as pendentes até a 0143 (inclusive); as seguintes ficam para depois
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
command -v psql >/dev/null || { echo "psql não encontrado"; exit 1; }
echo "Cole a URI de escrita da produção (Supabase: postgres://postgres.<ref>:...@...pooler.supabase.com:5432/postgres; Railway: postgres://civico_etl:...@host:porta/<database>). Nada será exibido."
read -r -s PROD_URL; echo
[[ "$PROD_URL" =~ ^postgres(ql)?:// ]] || { echo "Não começa com postgres://. Abortado."; exit 1; }
[[ "$PROD_URL" =~ @(localhost|127\.0\.0\.1)[:/] ]] && { echo "É um banco local. Abortado."; exit 1; }
if [[ "$PROD_URL" != *sslmode=* ]]; then
  if [[ "$PROD_URL" == *\?* ]]; then PROD_URL="$PROD_URL&sslmode=require"; else PROD_URL="$PROD_URL?sslmode=require"; fi
fi
if [[ "$PROD_URL" =~ supabase\.(co|com)[:/] ]]; then ROLE=""; else ROLE="${MIGRATE_ROLE-civico_etl}"; fi
[[ -z "$ROLE" ]] || { export PGOPTIONS="${PGOPTIONS:-} -c role=$ROLE"; echo "Migrações como role $ROLE (host que não é Supabase)."; }
ATE="${MIGRATE_ATE:-}"
[[ -z "$ATE" || "$ATE" =~ ^[0-9]{4}$ ]] || { echo "MIGRATE_ATE tem de ser 4 dígitos (ex.: 0143). Abortado."; exit 1; }
echo "Pendentes em produção${ATE:+ (até a $ATE; as seguintes ficam pendentes)}:"
comm -23 <(ls "$ROOT/db/migrations" | sort) <(psql "$PROD_URL" -X -At -c "select filename from schema_migrations" | sort) \
  | { if [[ -n "$ATE" ]]; then awk -v ate="$ATE" 'substr($0,1,4) <= ate'; else cat; fi; } | sed 's/^/  /'
read -r -p "Aplicar agora? [y/N] " ok; [[ "$ok" == [yY] ]] || { echo "Nada aplicado."; exit 0; }
DATABASE_URL="$PROD_URL" MIGRATE_ATE="$ATE" "$ROOT/db/migrate.sh"
unset PROD_URL
echo "Pronto."
