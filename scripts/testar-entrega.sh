#!/usr/bin/env bash
# Teste da resolução de conflito de registro de entregar-fatia.sh, num repositório descartável (não toca no projeto, não usa rede).
# Uso: scripts/testar-entrega.sh   (sai com 0 se tudo passou)
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-entrega.sh
. "$AQUI/lib-entrega.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/entrega-teste.XXXXXX")"; trap 'rm -rf "$T"' EXIT
FALHAS=0
ok() { echo "  ok: $1"; }
falha() { echo "  FALHOU: $1"; FALHAS=$((FALHAS+1)); }
novo_repo() { rm -rf "$T/r"; git init -q -b main "$T/r"; git -C "$T/r" config user.email t@t; git -C "$T/r" config user.name t; mkdir -p "$T/r/replica"; printf 'base\n' > "$T/r/replica/decisions.md"; git -C "$T/r" add -A; git -C "$T/r" commit -qm base; }

echo "1. duas fatias que acrescentam ao fim do registro: o conflito é resolvido mantendo os dois lados"
novo_repo; R="$T/r"
git -C "$R" switch -qc f3; printf 'D346 linha 1\nD346 linha 2\n' >> "$R/replica/decisions.md"; git -C "$R" commit -qam f3
git -C "$R" switch -qc f4; printf 'D347 linha 1\n' >> "$R/replica/decisions.md"; git -C "$R" commit -qam f4; F4="$(git -C "$R" rev-parse HEAD)"
git -C "$R" switch -q main; git -C "$R" switch -qc entrega
git -C "$R" cherry-pick "$F4" >/dev/null 2>&1 && falha "esperava conflito" || ok "o cherry-pick de f4 sobre o main sem f3 deu conflito"
resolve_conflitos_de_registro "$R" && ok "função devolveu 0" || falha "função devolveu 1"
git -C "$R" -c core.editor=true cherry-pick --continue >/dev/null 2>&1 && ok "cherry-pick --continue concluiu" || falha "cherry-pick --continue falhou"
grep -q 'D347 linha 1' "$R/replica/decisions.md" && ok "a decisão da fatia está no arquivo" || falha "a decisão da fatia sumiu"
grep -q -e '^<<<<<<<' -e '^=======$' -e '^>>>>>>>' "$R/replica/decisions.md" && falha "sobrou marcador de conflito" || ok "sem marcador de conflito"
grep -q '^base$' "$R/replica/decisions.md" && ok "o texto de antes continua" || falha "o texto de antes sumiu"

echo "2. conflito em outro arquivo: não resolve e não mexe em nada"
novo_repo; R="$T/r"; printf 'codigo\n' > "$R/a.txt"; git -C "$R" add -A; git -C "$R" commit -qm a
git -C "$R" switch -qc x; printf 'x\n' >> "$R/a.txt"; printf 'D1\n' >> "$R/replica/decisions.md"; git -C "$R" commit -qam x; X="$(git -C "$R" rev-parse HEAD)"
git -C "$R" switch -q main; printf 'y\n' >> "$R/a.txt"; printf 'Z\n' >> "$R/replica/decisions.md"; git -C "$R" commit -qam y
git -C "$R" switch -qc e2; git -C "$R" reset -q --hard HEAD~1
printf 'y\n' >> "$R/a.txt"; git -C "$R" commit -qam y2
git -C "$R" cherry-pick "$X" >/dev/null 2>&1 && falha "esperava conflito em a.txt" || ok "conflito em a.txt"
resolve_conflitos_de_registro "$R" && falha "resolveu um conflito que não era só de registro" || ok "a função recusou (devolveu 1)"
git -C "$R" cherry-pick --abort >/dev/null 2>&1

echo "3. sem conflito nenhum: a função devolve 1"
novo_repo; resolve_conflitos_de_registro "$T/r" && falha "devolveu 0 sem conflito" || ok "devolveu 1"

[ "$FALHAS" = 0 ] && { echo "tudo passou"; exit 0; } || { echo "$FALHAS falha(s)"; exit 1; }
