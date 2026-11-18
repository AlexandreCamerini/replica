#!/usr/bin/env bash
# Preview da Vercel apontando para o database de ENSAIO, com variáveis de escopo SÓ NA BRANCH de ensaio (Preview + git branch).
# As variáveis gerais do Preview (que servem a todos os previews) e as de Production NÃO são tocadas: a variável com branch
# vence a geral só nos deploys dessa branch. "Restaurar" = remover as variáveis da branch.
# Uso:
#   bash db/railway/preview-ensaio.sh listar    BRANCH   # o que existe hoje em Preview (nomes, escopo; valor só dos não secretos)
#   bash db/railway/preview-ensaio.sh aplicar   BRANCH   # grava as variáveis da branch (pede o que é segredo, oculto)
#   bash db/railway/preview-ensaio.sh restaurar BRANCH   # remove as variáveis da branch (lista antes e depois)
# Entradas: ~/.config/segueovoto/railway-roles.env (URIs web_reader/web_writer do civico_ensaio, gerado por configurar-dono.sh).
# Turnstile: usa as chaves de TESTE públicas da Cloudflare (sempre passam) só nesta branch, porque o hostname *.vercel.app do
# preview não está na lista da chave real. O Turnstile real já foi validado em produção (10/11/2026); aqui se testa o login pg.
set -euo pipefail
SCOPE="alexandrecamerini"; PROJECT="replica"
CMD="${1:-}"; BR="${2:-}"
[[ "$CMD" =~ ^(listar|aplicar|restaurar)$ && -n "$BR" ]] || { sed -n '4,8p' "$0"; exit 2; }
[[ "$BR" == *ensaio* ]] || { echo "recuso: a branch precisa ter 'ensaio' no nome (é só para o ensaio)" >&2; exit 2; }
[[ "$BR" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "branch inválida" >&2; exit 2; }
v() { npx --yes vercel "$@" --scope "$SCOPE" --project "$PROJECT"; }
VARS=(DATA_SOURCE DATABASE_URL DATABASE_WRITE_URL AUTH_PROVIDER SESSION_SECRET RESEND_API_KEY AUTH_EMAIL_FROM PG_POOL_MAX PG_WRITE_POOL_MAX
      NEXT_PUBLIC_TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY)

listar() {
  echo "== Variáveis de Preview hoje (vercel env ls preview; valores cifrados não aparecem)"
  v env ls --environment preview 2>&1 | grep -E "$(IFS='|'; echo "${VARS[*]}")|name|Environments" || true
  echo "== da branch $BR:"; v env ls --environment preview --git-branch "$BR" 2>&1 | grep -E "$(IFS='|'; echo "${VARS[*]}")" || echo "   (nenhuma)"
}

case "$CMD" in
  listar) listar ;;
  restaurar)
    listar
    for n in "${VARS[@]}"; do v env rm "$n" --environment preview --git-branch "$BR" --yes >/dev/null 2>&1 && echo "   removida $n ($BR)" || true; done
    echo "== depois:"; v env ls --environment preview --git-branch "$BR" 2>&1 | grep -E "$(IFS='|'; echo "${VARS[*]}")" || echo "   nenhuma variável da branch $BR: restaurado" ;;
  aplicar)
    ROLES="$HOME/.config/segueovoto/railway-roles.env"
    [[ -r "$ROLES" ]] || { echo "falta $ROLES" >&2; exit 1; }
    RD="$(grep '^web_reader_URL=' "$ROLES" | cut -d= -f2-)"; WR="$(grep '^web_writer_URL=' "$ROLES" | cut -d= -f2-)"
    [[ "$RD" == *"/civico_ensaio?"* && "$WR" == *"/civico_ensaio?"* ]] || { echo "as URIs não apontam para civico_ensaio: recuso" >&2; exit 1; }
    [[ "$RD" == postgres://web_reader:* && "$WR" == postgres://web_writer:* ]] || { echo "URIs com role inesperado" >&2; exit 1; }
    # colagem: o terminal pode embrulhar o texto em ESC[200~ ... ESC[201~ (bracketed paste) e trazer espaço/CR; limpa antes de validar
    limpa() { local x="$1"; x="${x//$'\e[200~'/}"; x="${x//$'\e[201~'/}"; x="${x//$'\r'/}"; x="${x#"${x%%[![:space:]]*}"}"; x="${x%"${x##*[![:space:]]}"}"; printf '%s' "$x"; }
    printf '\e[?2004l'
    read -r -s -p "RESEND_API_KEY (re_..., oculta): " RESEND; echo; RESEND="$(limpa "$RESEND")"
    [[ "$RESEND" == re_* ]] || { echo "esperado re_... (recebi ${#RESEND} caracteres; o valor não é exibido)" >&2; exit 1; }
    read -r -p "AUTH_EMAIL_FROM (remetente verificado no Resend): " FROM; FROM="$(limpa "$FROM")"; [[ "$FROM" == *@* ]] || { echo "sem @" >&2; exit 1; }
    listar
    read -r -p "Gravar as variáveis acima SÓ na branch $BR (Preview)? Digite 'sim': " ok; [[ "$ok" == sim ]] || { echo "nada alterado"; exit 1; }
    put() { # put NOME VALOR sensitive|plain
      v env rm "$1" --environment preview --git-branch "$BR" --yes >/dev/null 2>&1 || true
      if [[ "$3" == sensitive ]]; then printf '%s' "$2" | v env add "$1" --environment preview --git-branch "$BR" --sensitive --yes >/dev/null
      else printf '%s' "$2" | v env add "$1" --environment preview --git-branch "$BR" --no-sensitive --yes >/dev/null; fi
      echo "   $1 ok"
    }
    put DATA_SOURCE pg plain
    put DATABASE_URL "$RD" sensitive
    put DATABASE_WRITE_URL "$WR" sensitive
    put AUTH_PROVIDER pg plain
    put SESSION_SECRET "$(openssl rand -hex 32)" sensitive
    put RESEND_API_KEY "$RESEND" sensitive
    put AUTH_EMAIL_FROM "$FROM" plain
    put PG_POOL_MAX 2 plain
    put PG_WRITE_POOL_MAX 1 plain
    put NEXT_PUBLIC_TURNSTILE_SITE_KEY 1x00000000000000000000AA plain
    put TURNSTILE_SECRET_KEY 1x0000000000000000000000000000000AA plain
    unset RD WR RESEND
    echo "== depois:"; v env ls --environment preview --git-branch "$BR" 2>&1 | grep -E "$(IFS='|'; echo "${VARS[*]}")" || true
    echo "Agora faça o push da branch $BR (o deploy de preview lê estas variáveis no build)." ;;
esac
