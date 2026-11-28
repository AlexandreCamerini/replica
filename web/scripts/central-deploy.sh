#!/usr/bin/env bash
# Publica a CENTRAL (projeto Vercel `segueovoto-admin`, admin.segueovoto.com.br) a partir de um commit do Git.
#
# Por que existe: o projeto da central NÃO está ligado ao Git (push na main não a publica) e NÃO tem build próprio. Um `vercel deploy` da raiz do repositório, ou de `web/`
# sem o `vercel.json` abaixo, termina em segundos e responde 404 da plataforma em todas as rotas. Em 28/11/2026 isso derrubou o login por alguns minutos.
# O build certo é `next build && node scripts/manifestos-rotas-central.mjs` (o Next 15.5 não emite o manifesto de cliente dos route handlers do build `.admin.*`
# e o builder da Vercel exige). Este script monta uma CÓPIA LIMPA de web/ (só o que está commitado), grava esse vercel.json (no lugar do do site, que tem o cron do
# vigia e daria 404 toda noite), liga a cópia ao projeto certo e publica. NÃO mexe em variável de ambiente, em domínio nem no projeto `replica` (o site).
#
# Uso:   bash web/scripts/central-deploy.sh [--seco]      (da raiz do repositório, em terminal interativo)
#   REF=<commit-ish>   o que publicar (padrão: origin/main, depois de `git fetch origin main`)
#   --seco             monta e confere a cópia, e PARA antes de qualquer chamada à Vercel (serve de teste)
# Depois de um `vercel rollback`, a Vercel deixa de apontar deploys novos para o domínio sozinha: o script pergunta se promove, depois de testar o deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCOPE="${VERCEL_SCOPE:-sementedev}"
PROJECT="${PROJECT:-segueovoto-admin}"
DOMINIO="admin.segueovoto.com.br"
REF="${REF:-origin/main}"
SECO=0
[[ "${1:-}" == "--seco" ]] && SECO=1
[[ $# -le 1 && ( $# -eq 0 || "$1" == "--seco" ) ]] || { echo "uso: bash $0 [--seco]" >&2; exit 2; }

die() { echo "erro: $*" >&2; exit 1; }
ask_yes() { local a; read -r -p "$1 [s/N] " a; [[ "$a" == [sSyY] ]]; }

[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "PROJECT inválido"
[[ "$PROJECT" != replica ]] || die "recuso: 'replica' é o projeto do site"
[[ -t 0 ]] || die "rode num terminal interativo"
command -v git >/dev/null && command -v tar >/dev/null && command -v python3 >/dev/null && command -v curl >/dev/null || die "faltam git, tar, python3 ou curl"
if [[ "$SECO" == 0 ]]; then command -v vercel >/dev/null || die "falta o vercel CLI (npm i -g vercel; vercel login)"; fi

[[ "$REF" != origin/main ]] || git -C "$ROOT" fetch origin main
git -C "$ROOT" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || die "REF não encontrado: $REF"
SHA="$(git -C "$ROOT" rev-parse --short "$REF")"
echo "== central: publicar $REF ($SHA) em $PROJECT, escopo $SCOPE$([[ "$SECO" == 1 ]] && echo ' (SECO: sem chamar a Vercel)')"

COPIA="$(mktemp -d "${TMPDIR:-/tmp}/central-web.XXXXXX")"
trap 'rm -rf "$COPIA"' EXIT
git -C "$ROOT" archive "$REF" web | tar -x -C "$COPIA" --strip-components 1
[[ -f "$COPIA/scripts/manifestos-rotas-central.mjs" ]] || die "o commit $SHA não tem web/scripts/manifestos-rotas-central.mjs"
[[ -f "$COPIA/next.config.ts" && -f "$COPIA/package.json" ]] || die "a cópia não parece o web/ do projeto"
printf '{\n  "$schema": "https://openapi.vercel.sh/vercel.json",\n  "framework": "nextjs",\n  "buildCommand": "next build && node scripts/manifestos-rotas-central.mjs"\n}\n' > "$COPIA/vercel.json"
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["framework"]=="nextjs" and d["buildCommand"]=="next build && node scripts/manifestos-rotas-central.mjs", d' "$COPIA/vercel.json" || die "vercel.json gravado de forma errada"
[[ ! -e "$COPIA/.vercel" && -z "$(find "$COPIA" -name '.env*' -not -name '.env.example' -print -quit)" ]] || die "a cópia trouxe .vercel ou .env: abortado"
echo "   cópia limpa de web/ montada ($(find "$COPIA" -type f | wc -l | tr -d ' ') arquivos), com o vercel.json da central"
[[ "$SECO" == 0 ]] || { echo "   seco: parei aqui"; exit 0; }

cd "$COPIA"
vercel link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null
NOME="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("projectName",""))' "$COPIA/.vercel/project.json")"
[[ "$NOME" == "$PROJECT" ]] || die "o link da cópia aponta para '$NOME', não para $PROJECT: abortado"
echo "   ligada a $PROJECT"
echo "   AVISO: o deploy usa o ambiente de Production do projeto (ADMIN_CENTRAL, ADMIN_DATABASE_URL, SESSION_SECRET...). Migração que o código novo exige tem de estar APLICADA no banco da central antes."
ask_yes "   Publicar $SHA agora?" || exit 0

URL="$(vercel deploy --prod --scope "$SCOPE" | grep -Eo 'https://[a-z0-9-]+-sementedev\.vercel\.app' | tail -1)"
[[ -n "$URL" ]] || die "não consegui ler a URL do deploy; veja a saída do vercel"
echo "   deploy pronto: $URL"
echo "== teste do deploy (a URL por deploy tem Deployment Protection: vale só o vercel curl)"
if vercel curl /admin/entrar --deployment "$URL" --scope "$SCOPE" 2>&1 | grep -q -i -E 'type="email"|name="email"'; then echo "   /admin/entrar: formulário de e-mail presente"; else die "o deploy não devolveu a página de entrada: NÃO promova (provável build sem o buildCommand: o log deve dizer 'Detected Next.js version')"; fi

ask_yes "   Promover $URL a produção de $DOMINIO?" || { echo "   não promovido: o domínio segue no deploy anterior"; exit 0; }
vercel promote "$URL" --scope "$SCOPE"
printf '   %s/admin/entrar -> ' "$DOMINIO"; curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMINIO/admin/entrar"
echo "   Falta o teste de login (Turnstile + e-mail): peça um código em https://$DOMINIO/admin/entrar."
echo "   Para voltar ao deploy anterior: vercel ls --prod --scope $SCOPE, escolha o anterior e rode  vercel promote <url> --scope $SCOPE"
