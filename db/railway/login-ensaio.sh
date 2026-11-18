#!/usr/bin/env bash
# Ensaio do login pg: sobe o site NO SEU MAC (next dev, porta 3200) contra o database civico_ensaio do Railway, com AUTH_PROVIDER=pg.
# Não altera Vercel, GitHub nem Supabase; só lê as URIs de ~/.config/segueovoto/railway-roles.env (gerado por configurar-dono.sh).
# Uso: bash db/railway/login-ensaio.sh
# Pede (oculto) a chave do Resend e o remetente; SESSION_SECRET é gerado na hora e some ao parar o servidor.
# Roteiro manual depois de subir (http://localhost:3200/entrar):
#   1. e-mail inexistente e existente: mesma tela; o código chega pelo Resend (sem Turnstile em dev: passa)
#   2. código errado 5x, depois o certo => "tentativas demais"; peça novo código e entre
#   3. 4º pedido de código na hora => "muitos códigos"
#   4. seguir uma pessoa, sair, entrar de novo (o follow continua), apagar a conta (some de auth.users, profiles e follows)
#   5. conferir no psql do ensaio: select count(*) from auth.users; select * from login.sessoes_validas_desde;
# Em dev o cookie se chama `sessao` e não é Secure (localhost). O __Host- e o Secure só valem em produção (testar no preview da Vercel).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROLES="${ROLES:-$HOME/.config/segueovoto/railway-roles.env}"
[[ -r "$ROLES" ]] || { echo "falta $ROLES: rode configurar-dono.sh --etapa roles" >&2; exit 1; }
[[ -t 0 ]] || { echo "rode num terminal interativo" >&2; exit 1; }
command -v openssl >/dev/null && command -v npm >/dev/null || { echo "faltam openssl ou npm" >&2; exit 1; }
[[ -d "$ROOT/web/node_modules" ]] || { echo "rode antes: cd web && npm ci" >&2; exit 1; }
get() { grep "^$1_URL=" "$ROLES" | head -1 | cut -d= -f2-; }
RD="$(get web_reader)"; WR="$(get web_writer)"
[[ "$RD" == *civico_ensaio* && "$WR" == *civico_ensaio* ]] || { echo "as URIs do arquivo não apontam para civico_ensaio: recuso (este ensaio não toca em outro database)" >&2; exit 1; }
read -r -s -p "Chave do Resend (re_..., oculta): " RESEND_API_KEY; echo
[[ "$RESEND_API_KEY" == re_* ]] || { echo "esperado re_..." >&2; exit 1; }
read -r -p "Remetente (AUTH_EMAIL_FROM, domínio verificado no Resend): " AUTH_EMAIL_FROM
[[ "$AUTH_EMAIL_FROM" == *@* ]] || { echo "remetente sem @" >&2; exit 1; }
export RESEND_API_KEY AUTH_EMAIL_FROM
export DATA_SOURCE=pg AUTH_PROVIDER=pg DATABASE_URL="$RD" DATABASE_WRITE_URL="$WR" PG_POOL_MAX=2 PG_WRITE_POOL_MAX=1
export SESSION_SECRET="$(openssl rand -hex 32)"
unset TURNSTILE_SECRET_KEY RD WR
echo "Subindo em http://localhost:3200 (Ctrl-C para parar). Roteiro: cabeçalho de $0"
cd "$ROOT/web" && exec npx next dev -p 3200
