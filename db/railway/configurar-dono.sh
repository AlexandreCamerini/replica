#!/usr/bin/env bash
# Configura o que é responsabilidade do dono antes do ensaio (runbook-railway.md §1). Interativo, idempotente, nada de segredo em argv.
#   1) roles do Segue o Voto no Railway: LOGIN + senha gerada (depois do bootstrap; o bootstrap os cria NOLOGIN)
#   2) 0143 no Supabase (prod-migrate.sh) e Resend/SESSION_SECRET na Vercel (config-producao.sh com AUTH_PROVIDER_ALVO=pg)
# NÃO troca AUTH_PROVIDER, DATABASE_URL nem secrets do ETL: isso é o passo 5 e 7 do corte (runbook §7).
# Senhas geradas vão para $HOME/.config/segueovoto/railway-roles.env (0600, fora do repositório): mova para o gerenciador de senhas.
# Uso: bash db/railway/configurar-dono.sh [--db civico_ensaio] [--etapa roles|supabase|vercel|tudo]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=civico_ensaio; ETAPA=tudo
while [[ $# -gt 0 ]]; do case "$1" in --db) DB="$2"; shift ;; --etapa) ETAPA="$2"; shift ;; *) echo "opção desconhecida: $1" >&2; exit 2 ;; esac; shift; done
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "--db inválido" >&2; exit 2; }
case "$DB" in postgres|railway|template0|template1) echo "recuso o database $DB" >&2; exit 2 ;; esac
[[ -t 0 ]] || { echo "Rode num terminal interativo." >&2; exit 1; }
ask_yes() { local a; read -r -p "$1 [s/N] " a; [[ "$a" == [sSyY] ]]; }
OUT="$HOME/.config/segueovoto/railway-roles.env"

etapa_roles() {
  echo "== 1/3 Roles no Railway (database $DB)"
  command -v railway >/dev/null && command -v psql >/dev/null && command -v openssl >/dev/null || { echo "faltam railway, psql ou openssl" >&2; exit 1; }
  local vars url
  vars="$(railway variables --service "${RAILWAY_PG_SERVICE:-Postgres}" --kv)" || { echo "railway login/link feitos?" >&2; exit 1; }
  url="$(grep -E '^DATABASE_PUBLIC_URL=' <<<"$vars" | head -1 | cut -d= -f2- || true)"; unset vars
  [[ "$url" =~ ^postgres(ql)?://.*@([^:/]+):([0-9]+)/ ]] || { echo "DATABASE_PUBLIC_URL ausente ou inesperada" >&2; exit 1; }
  local host="${BASH_REMATCH[2]}" port="${BASH_REMATCH[3]}"
  export PGSSLMODE=require
  # superusuário do cluster: a URI entra só no ambiente do psql (nunca em argv)
  adm() { PGDATABASE="$DB" psql "$url" -X -v ON_ERROR_STOP=1 -At "$@"; }
  adm -c "select 1" >/dev/null || { echo "não conectei ao database $DB. Rode antes o railway-copy.sh/bootstrap.sql." >&2; exit 1; }
  [[ "$(adm -c "select shobj_description(oid,'pg_database') from pg_database where datname = current_database()")" == segueovoto ]] \
    || { echo "o database $DB não tem a marca segueovoto: rode o bootstrap.sql primeiro. Nada alterado." >&2; exit 1; }
  mkdir -p "$(dirname "$OUT")"; chmod 700 "$(dirname "$OUT")"; touch "$OUT"; chmod 600 "$OUT"
  local r pw
  for r in web_reader web_writer civico_etl; do
    if grep -q "^${r}_URL=" "$OUT" && ! ask_yes "$r já tem senha guardada. Gerar outra?"; then continue; fi
    pw="$(openssl rand -hex 24)"
    # senha por stdin: não aparece em argv
    printf "alter role %s login password '%s'\n" "$r" "$pw" | adm >/dev/null
    grep -v "^${r}_URL=" "$OUT" > "$OUT.tmp" || true; mv "$OUT.tmp" "$OUT"; chmod 600 "$OUT"
    printf '%s_URL=postgres://%s:%s@%s:%s/%s?sslmode=require\n' "$r" "$r" "$pw" "$host" "$port" "$DB" >> "$OUT"
    echo "   $r: LOGIN ok, URI gravada em $OUT"
  done
  unset pw url
  echo "   admin_central fica NOLOGIN (só quando a Central admin for ligada)."
  if ask_yes "Há pooler à frente do Railway?"; then
    read -r -p "   Role do pooler: " pr; [[ "$pr" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && echo "   use: bash db/railway/railway-copy.sh --pooler-role $pr ..." || echo "   nome inválido, ignorado"
  fi
  echo "   Confira: statement_timeout por role (3s, 8s):"
  for r in web_reader web_writer; do
    u="$(grep "^${r}_URL=" "$OUT" | cut -d= -f2-)"; printf '   %s: ' "$r"; psql "$u" -X -At -c "show statement_timeout" || true
  done
}

etapa_supabase() {
  echo "== 2/3 Migração 0143 no Supabase (prod-migrate.sh; ele lista as pendentes e pede confirmação)"
  ask_yes "Aplicar agora?" && bash "$ROOT/etl/deploy/prod-migrate.sh" || echo "   pulado: sem a 0143 o diff do verify mostra login.* só no destino."
}

etapa_vercel() {
  echo "== 3/3 Vercel: Resend, remetente e SESSION_SECRET por ambiente (config-producao.sh, alvo pg)"
  echo "   Antes: domínio do remetente verificado no Resend e chave com permissão só de envio."
  ask_yes "Rodar o assistente agora?" && AUTH_PROVIDER_ALVO=pg bash "$ROOT/etl/deploy/config-producao.sh" || echo "   pulado."
}

case "$ETAPA" in
  roles) etapa_roles ;; supabase) etapa_supabase ;; vercel) etapa_vercel ;;
  tudo) etapa_roles; etapa_supabase; etapa_vercel ;;
  *) echo "etapa inválida: $ETAPA" >&2; exit 2 ;;
esac
echo; echo "Feito. Pendente do corte (não é daqui): AUTH_PROVIDER=pg, DATABASE_URL/DATABASE_WRITE_URL, ETL_DATABASE_URL e Keychain (runbook §7)."
