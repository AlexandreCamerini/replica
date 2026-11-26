#!/usr/bin/env bash
# Entrega várias fatias em sequência, uma PR por fatia, chamando scripts/entregar-fatia.sh para cada linha do arquivo de lote.
# Uma fatia que falha (conflito, CI vermelho) não para o lote: o resumo no fim diz o que aconteceu com cada uma.
#
# Uso:  scripts/entregar-lote.sh <arquivo-do-lote> [--mesclar-baixo-risco]
#
# Arquivo do lote: uma fatia por linha, campos separados por TAB; linhas vazias e as que começam com # são ignoradas:
#   <commit> <branch> <título> <arquivo-do-corpo> <risco>
# <risco> é "baixo" (não toca dado novo, banco, segredo nem dado pessoal) ou "alto".
#
# --mesclar-baixo-risco: o dono autoriza mesclar, uma a uma, as fatias de risco "baixo" cujos checks passarem. Sem a flag NUNCA mescla.
# As fatias são independentes e cada uma parte do main atual: uma fatia que depende de outra ainda não mesclada pode dar conflito
# (o script aborta o cherry-pick, não envia nada e diz isso no resumo).
# Variáveis: as mesmas de entregar-fatia.sh (ENTREGA_WT, ENTREGA_REPO, ENTREGA_SAIDA, ENTREGA_SECO).
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ $# -ge 1 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }
LOTE="$1"; shift
MESCLAR_BAIXO=0
for f in "$@"; do
  case "$f" in
    --mesclar-baixo-risco) MESCLAR_BAIXO=1 ;;
    --force|-f) echo "erro: este script não força nada" >&2; exit 64 ;;
    *) echo "erro: opção desconhecida: $f" >&2; exit 64 ;;
  esac
done
[ -s "$LOTE" ] || { echo "erro: arquivo de lote ausente ou vazio: $LOTE" >&2; exit 66; }

# valida o lote inteiro antes de entregar a primeira fatia
N=0; ERROS=0
while IFS=$'\t' read -r commit branch titulo corpo risco _resto; do
  case "$commit" in ''|\#*) continue ;; esac
  N=$((N+1))
  [ -n "${branch:-}" ] && [ -n "${titulo:-}" ] && [ -n "${corpo:-}" ] || { echo "linha $N: faltam campos (commit, branch, título, corpo, risco)" >&2; ERROS=$((ERROS+1)); continue; }
  case "${risco:-}" in baixo|alto) ;; *) echo "linha $N ($branch): risco deve ser 'baixo' ou 'alto'" >&2; ERROS=$((ERROS+1)) ;; esac
  [ -s "$corpo" ] || { echo "linha $N ($branch): corpo da PR não encontrado: $corpo" >&2; ERROS=$((ERROS+1)); }
done < "$LOTE"
[ "$ERROS" = 0 ] || { echo "lote inválido: $ERROS problema(s). Nada foi entregue." >&2; exit 65; }
[ "$N" -gt 0 ] || { echo "lote sem fatias." >&2; exit 65; }

RESUMO=""
while IFS=$'\t' read -r commit branch titulo corpo risco _resto; do
  case "$commit" in ''|\#*) continue ;; esac
  echo; echo "=== $branch ($risco risco) ==="
  FLAGS=()
  [ "$risco" = baixo ] && FLAGS+=(--baixo-risco)
  [ "$risco" = baixo ] && [ "$MESCLAR_BAIXO" = 1 ] && FLAGS+=(--mesclar)
  "$AQUI/entregar-fatia.sh" "$commit" "$branch" "$titulo" "$corpo" "${FLAGS[@]+"${FLAGS[@]}"}"
  RC=$?
  case "$RC" in 0) R="ok" ;; 3) R="conflito (nada enviado)" ;; 4) R="push falhou" ;; 5) R="PR não abriu" ;; 6) R="verde, mas o merge falhou" ;; 7) R="CI vermelho" ;; *) R="erro $RC" ;; esac
  RESUMO="$RESUMO\n  $branch: $R"
done < "$LOTE"

echo; echo "=== resumo do lote ==="; printf "%b\n" "$RESUMO"
echo "Resultados detalhados em ${ENTREGA_SAIDA:-<worktree>/.entrega}/"
