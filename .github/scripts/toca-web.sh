#!/usr/bin/env bash
# Decide se o e2e do web precisa rodar neste run do ci (D323). Imprime "true" ou "false".
#
# Roda quando a mudança toca web/, mcp/src, o próprio ci.yml ou esta pasta. Na dúvida, roda: qualquer erro ao achar a base
# ou ao ler o diff devolve "true". Pular o e2e nunca pode ser o resultado de uma falha deste script.
#
# Uso: toca-web.sh <evento> [sha-anterior]
#   pull_request: o checkout é o commit de merge da PR; a base é o primeiro pai (HEAD^1). Sem segundo pai, roda.
#   push:         compara com o commit anterior do push (github.event.before), buscado aqui com profundidade 1.
set -u

evento="${1:-}"
antes="${2:-}"
base=""

case "$evento" in
  pull_request)
    if git rev-parse -q --verify 'HEAD^2' >/dev/null 2>&1; then base='HEAD^1'; fi
    ;;
  push)
    # 40 hexadecimais e não o SHA nulo (ramo recém-criado)
    if printf '%s' "$antes" | grep -qE '^[0-9a-f]{40}$' && [ "$antes" != "0000000000000000000000000000000000000000" ]; then
      if git cat-file -e "${antes}^{commit}" 2>/dev/null || git fetch -q --depth=1 origin "$antes" 2>/dev/null; then base="$antes"; fi
    fi
    ;;
esac

if [ -z "$base" ]; then echo true; exit 0; fi
# Pathspec em vez de ler nomes: caminho com acento ou aspas sai escapado no --name-only e escaparia de um grep.
# --no-renames: mover arquivo para fora de web/ conta como mudança em web/. Saída 0 = não toca; 1 = toca; outra = erro, roda.
# CAMINHOS é o que o e2e lê: web/ inteiro e mcp/src (b6-mcp-ajudar.spec.ts confere as ferramentas em mcp/src/server.ts).
CAMINHOS=(web mcp/src .github/workflows/ci.yml .github/scripts)
git diff --no-renames --quiet "$base" HEAD -- "${CAMINHOS[@]}" 2>/dev/null
case $? in
  0) echo false ;;
  *) echo true ;;
esac
