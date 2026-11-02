#!/usr/bin/env bash
# Aplica db/migrations/*.sql em ordem, uma vez cada, numa transação por arquivo.
# Uso: DATABASE_URL=postgres://... db/migrate.sh [--local]   (--local aplica antes o stub do Supabase)
# Falha se um arquivo já aplicado mudou (checksum): migração publicada não se edita, cria-se outra.
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
cd "$(dirname "$0")"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)
if [[ "${1:-}" == "--local" ]]; then "${PSQL[@]}" -f local/0000_supabase_stub.sql; fi
"${PSQL[@]}" -c "create table if not exists schema_migrations (filename text primary key, sha256 text not null, applied_at timestamptz not null default now())"
for f in migrations/*.sql; do
  name=$(basename "$f")
  sum=$(shasum -a 256 "$f" | cut -d' ' -f1)
  applied=$("${PSQL[@]}" -At -c "select sha256 from schema_migrations where filename = '$name'")
  if [[ -n "$applied" ]]; then
    [[ "$applied" == "$sum" ]] || { echo "ERRO: $name mudou depois de aplicada ($applied ≠ $sum)" >&2; exit 1; }
    continue
  fi
  echo "aplicando $name"
  "${PSQL[@]}" --single-transaction -f "$f" -c "insert into schema_migrations (filename, sha256) values ('$name', '$sum')"
done
if [[ "${1:-}" == "--local" ]]; then for f in local/post_*.sql; do [[ -f "$f" ]] && "${PSQL[@]}" -f "$f"; done; fi
echo "ok: $("${PSQL[@]}" -At -c 'select count(*) from schema_migrations') migração(ões) aplicada(s)"
