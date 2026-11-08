#!/usr/bin/env bash
# Preview da Vercel com dados reais, sem precisar lembrar a senha do web_reader:
#   1. pede a URI de conexão do Supabase (Connect → Session pooler, porta 5432), entrada oculta;
#   2. testa a conexão com psql;
#   3. redefine a senha do role web_reader com um valor aleatório (nada é impresso nem gravado em disco);
#   4. monta a URL de leitura com o mesmo host/porta/banco e o usuário web_reader;
#   5. chama vercel-env-fix.sh, que grava DATABASE_URL em Production e Preview, volta o Preview para
#      DATA_SOURCE=pg e refaz os deploys.
# Efeito colateral: a produção no ar usa a senha antiga do web_reader e fica sem banco até o redeploy
# (passo 5) terminar, em geral 1 a 2 minutos. O ETL (ETL_DATABASE_URL, outro usuário) não é afetado.
# Uso: bash etl/deploy/vercel-preview-prod-db.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v psql >/dev/null || { echo "psql não encontrado (brew install libpq ou postgresql)"; exit 1; }
command -v openssl >/dev/null || { echo "openssl não encontrado"; exit 1; }

echo "Supabase → projeto de produção → Connect → Connection String → Session pooler (porta 5432)."
echo "Troque [YOUR-PASSWORD] pela senha do banco e cole aqui. Nada será exibido."
read -r -s ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "Não começa com postgres://. Abortado."; exit 1; }
[[ "$ADMIN_URL" == *YOUR-PASSWORD* ]] && { echo "Ainda tem [YOUR-PASSWORD]. Abortado."; exit 1; }
[[ "$ADMIN_URL" =~ @(localhost|127\.0\.0\.1)[:/] ]] && { echo "É um banco local, não a produção. Abortado."; exit 1; }

echo "Testando a conexão..."
psql "$ADMIN_URL" -X -q -At -c "select current_user || ' @ ' || current_database()" \
  || { echo "Não conectou. Confira a URI e a senha."; exit 1; }
psql "$ADMIN_URL" -X -q -At -c "select 1 from pg_roles where rolname = 'web_reader'" | grep -q 1 \
  || { echo "O role web_reader não existe neste banco. Abortado."; exit 1; }

# senha nova: 32 caracteres alfanuméricos (sem símbolo, para não precisar escapar na URL)
NEWPW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
echo "Redefinindo a senha do web_reader..."
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -v pw="$NEWPW" -c "alter role web_reader with login password :'pw'" >/dev/null

# monta a URL de leitura a partir da URI admin: mesmo host, porta e banco; usuário web_reader
# (no pooler do Supabase o usuário leva o sufixo do projeto: postgres.<ref> → web_reader.<ref>)
read -r HOSTPART USERPART <<<"$(python3 -I - "$ADMIN_URL" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
host = u.hostname or ""
port = f":{u.port}" if u.port else ""
path = u.path or "/postgres"
q = f"?{u.query}" if u.query else ""
user = u.username or "postgres"
ref = user.split(".", 1)[1] if "." in user else ""
reader = f"web_reader.{ref}" if ref else "web_reader"
print(f"{host}{port}{path}{q}", reader)
PY
)"
DB_URL="postgresql://${USERPART}:${NEWPW}@${HOSTPART}"
unset ADMIN_URL NEWPW

echo "Testando a conexão de leitura..."
psql "$DB_URL" -X -q -At -c "select count(*) from pg_tables where schemaname = 'public'" >/dev/null \
  || { echo "A URL de leitura não conectou. A senha foi trocada, mas nada foi gravado na Vercel."; exit 1; }

echo "Gravando na Vercel e refazendo os deploys..."
DB_URL="$DB_URL" bash "$HERE/vercel-env-fix.sh"
