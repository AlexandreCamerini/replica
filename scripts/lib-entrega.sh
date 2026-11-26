#!/usr/bin/env bash
# Funções de entregar-fatia.sh que merecem teste próprio (scripts/testar-entrega.sh).

# Arquivos de registro só de acréscimo: duas fatias que acrescentam ao fim deles dão conflito no mesmo trecho, e a resolução certa é manter os
# dois lados. Qualquer OUTRO arquivo em conflito não é resolvido aqui.
ARQUIVOS_DE_REGISTRO=("replica/decisions.md" "DECISIONS.md")

# resolve_conflitos_de_registro <worktree>: durante um cherry-pick em conflito, se os únicos arquivos em conflito são de registro, mantém os dois lados
# (remove só as linhas de marcador), faz `git add` e devolve 0. Se houver qualquer outro arquivo em conflito, não mexe em nada e devolve 1.
resolve_conflitos_de_registro() {
  local wt="$1" f ok r
  local em_conflito
  em_conflito="$(git -C "$wt" diff --name-only --diff-filter=U)"
  [ -n "$em_conflito" ] || return 1
  while IFS= read -r f; do
    ok=0
    for r in "${ARQUIVOS_DE_REGISTRO[@]}"; do [ "$f" = "$r" ] && ok=1; done
    [ "$ok" = 1 ] || return 1
  done <<< "$em_conflito"
  while IFS= read -r f; do
    # só as linhas de marcador saem; o texto dos dois lados fica, na ordem em que o git o escreveu
    grep -v -e '^<<<<<<< ' -e '^=======$' -e '^>>>>>>> ' "$wt/$f" > "$wt/$f.sem-marcador" || true
    mv "$wt/$f.sem-marcador" "$wt/$f"
    git -C "$wt" add -- "$f"
  done <<< "$em_conflito"
  return 0
}
