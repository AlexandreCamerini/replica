#!/usr/bin/env bash
# D354: troca a DATABASE_URL de leitura do site (a variável que cobre Production) para o pooler do Supabase em MODO TRANSAÇÃO (porta 6543).
#
# Por quê: em modo sessão (5432) o pooler tem pool_size 15 no total, e cada instância da função da Vercel segura até
# PG_POOL_MAX (10) conexões por 20 s; duas instâncias quentes esgotam o pool e toda leitura sem cache falha
# (EMAXCONNSESSION, D353). Em modo transação a conexão volta ao pool a cada transação. O código já usa prepare:false,
# que o modo transação exige (integration.md previa a web na 6543). O ETL continua em modo sessão: não é tocado aqui.
#
# Só mexe na DATABASE_URL que cobre Production, com `vercel env update` (troca o valor no lugar, sem janela sem URL; no CLI 65
# o `env rm NOME production` posicional pode apagar a variável de todos os ambientes). Essa variável também cobre o Preview
# geral, que passa junto para o modo transação (mesmo usuário de leitura). A DATABASE_URL própria da branch do ensaio do
# Railway (Preview, git-branch) não é tocada. DATABASE_WRITE_URL e PG_POOL_MAX ficam como estão.
# Pede a URL uma vez, sem eco; nada do segredo é impresso nem gravado em disco.
# Uso: bash etl/deploy/vercel-pooler-transacao.sh            # aplica e refaz o deploy de produção
#      bash etl/deploy/vercel-pooler-transacao.sh --dry-run  # só mostra o que faria
set -euo pipefail

SCOPE="${VERCEL_SCOPE:-sementedev}"   # o projeto está no time sementedev (os scripts antigos usam alexandrecamerini)
PROJECT="replica"
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1

vs() { npx --yes vercel "$@" --scope "$SCOPE"; }
v()  { npx --yes vercel "$@" --scope "$SCOPE" --project "$PROJECT"; }
run() { if (( DRY )); then echo "[dry-run] $*"; else "$@"; fi; }

command -v npx >/dev/null || { echo "npx não encontrado (instale Node)"; exit 1; }
vs whoami >/dev/null 2>&1 || { echo "Faça login antes: npx vercel login"; exit 1; }
v env ls >/dev/null 2>&1 || { echo "Projeto $PROJECT não encontrado no escopo $SCOPE. Abortado, nada mudou."; exit 1; }

DB_URL=""
if (( ! DRY )); then
  echo "Cole a URL do pooler em MODO TRANSAÇÃO, usuário web_reader (Supabase > Connect > Transaction pooler, porta 6543)."
  echo "Nada será exibido."
  read -r -s DB_URL; echo
  # validação sem imprimir a URL: esquema, usuário, host do pooler e porta 6543
  [[ "$DB_URL" =~ ^postgres(ql)?:// ]] || { echo "Não parece uma URL postgres://. Abortado, nada mudou."; exit 1; }
  rest="${DB_URL#*://}"; cred="${rest%@*}"; hostpart="${rest##*@}"   # a senha pode ter ':' (rpartition no '@')
  user="${cred%%:*}"; hostport="${hostpart%%/*}"; host="${hostport%:*}"; port="${hostport##*:}"
  [[ "$user" == web_reader* ]] || { echo "Usuário não é web_reader. Abortado, nada mudou."; exit 1; }
  [[ "$host" == *pooler.supabase.com ]] || { echo "Host não é o pooler do Supabase (*.pooler.supabase.com). Abortado, nada mudou."; exit 1; }
  [[ "$port" == "6543" ]] || { echo "Porta $port: o modo transação é a 6543 (5432 é o modo sessão). Abortado, nada mudou."; exit 1; }
  [[ "$DB_URL" == *sslmode=* ]] || { if [[ "$DB_URL" == *\?* ]]; then DB_URL="$DB_URL&sslmode=require"; else DB_URL="$DB_URL?sslmode=require"; fi; }
  unset rest cred hostpart user hostport host port
fi

echo "1/3 DATABASE_URL (a que cobre Production) -> pooler em modo transação"
if (( DRY )); then echo "[dry-run] vercel env update DATABASE_URL --environment production --sensitive --yes (valor por stdin)"
else printf '%s' "$DB_URL" | v env update DATABASE_URL --environment production --sensitive --yes >/dev/null
fi
unset DB_URL

echo "2/3 Conferência (só nomes e ambientes)"
v env ls 2>/dev/null | grep -E "^ (DATABASE_URL|DATABASE_WRITE_URL|PG_POOL_MAX) " | awk '{$2="";$3=""; print}' || true

echo "3/3 Deploy de produção"
if (( ! DRY )); then
  PROD=$(vs ls "$PROJECT" --prod 2>/dev/null | grep -oE 'https://replica-[a-z0-9]+-[a-z0-9]+\.vercel\.app' | head -1)
  if [[ -n "$PROD" ]]; then vs redeploy "$PROD" >/dev/null && echo "produção refeita a partir de $PROD"
  else echo "Não achei o deploy de produção: refaça pelo painel da Vercel (Deployments > Redeploy)."; fi
fi
echo "Pronto. Para voltar ao modo sessão: troque a DATABASE_URL pelo painel da Vercel pela URL da porta 5432 e refaça o deploy."
