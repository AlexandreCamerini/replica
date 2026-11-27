#!/usr/bin/env bash
# D357: quando a senha do web_reader não é conhecida. Redefine a senha e grava a URL de leitura do site já no pooler em
# MODO TRANSAÇÃO (porta 6543), pelo vercel-pooler-transacao.sh (testa a conexão, grava, refaz e promove o deploy).
#
#   1. pede a URI admin do Supabase (Connect > Connection String > Session pooler, usuário postgres.<ref>, senha do banco);
#   2. testa a conexão admin na 5432 e na 6543 (o mesmo host serve os dois modos) e confere que o role web_reader existe;
#      se algo falhar aqui, nada mudou;
#   3. grava a URL nova e refaz o deploy sem promover; depois redefine a senha (aleatória, nada impresso), testa e promove;
#   4. monta a URL de leitura: mesmo host, porta 6543, usuário web_reader.<ref>;
#   5. chama vercel-pooler-transacao.sh com essa URL.
# Efeito: o site só fica sem banco entre a troca de senha e a promoção do deploy novo (segundos), porque o deploy no ar
# usa a senha antiga. O ETL (civico_etl) e a central (admin_central) não usam o web_reader.
# Uso: bash etl/deploy/vercel-pooler-transacao-nova-senha.sh
set -euo pipefail
# PORTA_ALVO=5432: grava a URL do modo sessão em vez do modo transação (D357).
export PORTA_ALVO="${PORTA_ALVO:-5432}"   # padrão 5432: a 6543 travou o site (D357)
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v psql >/dev/null || { echo "psql não encontrado (brew install libpq). Abortado, nada mudou."; exit 1; }
command -v openssl >/dev/null || { echo "openssl não encontrado. Abortado, nada mudou."; exit 1; }
command -v npx >/dev/null || { echo "npx não encontrado (instale Node). Abortado, nada mudou."; exit 1; }
npx --yes vercel whoami --scope "${VERCEL_SCOPE:-sementedev}" >/dev/null 2>&1 || { echo "Faça login antes: npx vercel login. Abortado, nada mudou."; exit 1; }

echo "Supabase > projeto bigdata > Connect > Connection String > Session pooler (porta 5432)."
echo "Troque [YOUR-PASSWORD] pela senha do banco e cole aqui. Nada será exibido."
read -r -s ADMIN_URL; echo
[[ "$ADMIN_URL" =~ ^postgres(ql)?:// ]] || { echo "Não começa com postgres://. Abortado, nada mudou."; exit 1; }
[[ "$ADMIN_URL" == *YOUR-PASSWORD* ]] && { echo "Ainda tem [YOUR-PASSWORD]. Abortado, nada mudou."; exit 1; }

# partes sem urlsplit: a senha pode ter ':' ou '@' sem escape
REST="${ADMIN_URL#*://}"; HOSTPART="${REST##*@}"; CREDS="${REST%@*}"; ADMIN_USER="${CREDS%%:*}"
HOSTPORT="${HOSTPART%%/*}"; HOST="${HOSTPORT%:*}"; TAIL="${HOSTPART#"$HOSTPORT"}"   # TAIL = /banco?query
[[ "$HOST" == *pooler.supabase.com ]] || { echo "Host não é o pooler do Supabase. Abortado, nada mudou."; exit 1; }
[[ "$ADMIN_USER" == postgres.* ]] || { echo "Usuário não é postgres.<ref> (o da URI do Supabase). Abortado, nada mudou."; exit 1; }
REF="${ADMIN_USER#postgres.}"
ADMIN_6543="postgresql://${CREDS}@${HOST}:6543${TAIL}"

echo "Testando a conexão admin (5432 e 6543)..."
[[ "$(PGCONNECT_TIMEOUT=15 psql "$ADMIN_URL" -X -q -At -c 'select 1' 2>/dev/null)" == "1" ]] || { echo "A URI admin não conectou na 5432. Abortado, nada mudou."; exit 1; }
[[ "$(PGCONNECT_TIMEOUT=15 psql "$ADMIN_6543" -X -q -At -c 'select 1' 2>/dev/null)" == "1" ]] || { echo "O pooler em modo transação (6543) não respondeu. Abortado, nada mudou."; exit 1; }
[[ "$(psql "$ADMIN_URL" -X -q -At -c "select 1 from pg_roles where rolname = 'web_reader'" 2>/dev/null)" == "1" ]] || { echo "O role web_reader não existe neste banco. Abortado, nada mudou."; exit 1; }
unset ADMIN_6543

# senha nova: 32 caracteres alfanuméricos (nada a escapar na URL)
NEWPW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32)"
[[ ${#NEWPW} -eq 32 ]] || { echo "Falhou ao gerar a senha. Abortado, nada mudou."; exit 1; }
DB_URL="postgresql://web_reader.${REF}:${NEWPW}@${HOST}:${PORTA_ALVO}${TAIL}?sslmode=require"

# Ordem para a queda durar segundos: (a) grava a URL e refaz o deploy SEM promover (depois do rollback a Vercel não põe
# no ar sozinha; o site segue no deploy antigo, que funciona); (b) troca a senha; (c) testa como web_reader na 6543;
# (d) promove. Falha em (a) não derruba nada.
echo "Gravando a URL na Vercel e refazendo o deploy (ainda sem pôr no ar; o site segue funcionando)..."
SAIDA=$(DB_URL="$DB_URL" SO_PREPARAR=1 bash "$HERE/vercel-pooler-transacao.sh") || { echo "$SAIDA" | grep -v -i 'postgres' ; echo "Falhou antes de trocar a senha: o site segue no ar. A DATABASE_URL pode ter sido gravada; não promova nenhum deploy novo."; exit 1; }
NOVO=$(printf '%s\n' "$SAIDA" | sed -n 's/^deploy novo: //p' | tail -1)
[[ "$NOVO" =~ ^https://replica-[a-z0-9]+-[a-z0-9]+\.vercel\.app$ ]] || { echo "Não achei o deploy novo. Senha não trocada; o site segue no ar. Não promova nenhum deploy novo."; exit 1; }
echo "Deploy novo pronto: $NOVO"

echo "Redefinindo a senha do web_reader (a partir daqui o site fica sem banco até a promoção, segundos)..."
# -c não interpola variáveis; com -f - (stdin) o :'pw' vira literal escapado
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -v pw="$NEWPW" -f - <<<"alter role web_reader with login password :'pw';" >/dev/null \
  || { echo "A troca de senha falhou: nada mudou no ar. Não promova $NOVO."; exit 1; }
unset ADMIN_URL NEWPW CREDS REST

echo "Testando a conexão de leitura na ${PORTA_ALVO}..."
quem=""
for tentativa in 1 2 3 4 5 6; do
  quem=$(PGCONNECT_TIMEOUT=15 psql "$DB_URL" -X -q -At -c 'select current_user' 2>/dev/null) || quem=""
  [[ "$quem" == "web_reader" ]] && break
  sleep 10   # o pooler pode levar alguns segundos para trocar a senha em cache
done
unset DB_URL
if [[ "$quem" != "web_reader" ]]; then
  echo "ATENÇÃO: a senha já foi trocada e a URL nova não conectou. O site está sem banco. Rode este script de novo."
  exit 1
fi

echo "Promovendo $NOVO..."
PROMO=$(npx --yes vercel promote "$NOVO" --scope "${VERCEL_SCOPE:-sementedev}" --yes 2>&1) || {
  # sem rollback ativo, o redeploy já entra no ar sozinho e a promoção responde 409: é o estado desejado
  if [[ "$PROMO" == *"already the current production deployment"* ]]; then echo "$NOVO já é o deploy de produção."
  else echo "ATENÇÃO: a promoção falhou e o site está sem banco. Promova $NOVO pelo painel da Vercel (Deployments > Promote)."; exit 1; fi
}
echo "Pronto: produção em $NOVO, lendo pelo pooler na porta $PORTA_ALVO."
