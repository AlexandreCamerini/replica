#!/usr/bin/env bash
# Entrega UMA fatia pronta (um commit) como PR contra o main: branch nova a partir de origin/main, cherry-pick, push, PR e espera do CI.
# Roda no Mac do dono (o sandbox da sessão não tem push nem gh). Idempotente: o que já foi feito é dito e pulado, nunca repetido nem forçado.
#
# Uso:
#   scripts/entregar-fatia.sh <commit> <branch> <título> <arquivo-do-corpo> [--baixo-risco] [--mesclar]
#
#   <commit>             sha do commit da fatia (existe no repositório; as worktrees compartilham os objetos)
#   <branch>             claude/<nome-da-fatia>
#   <título>             título da PR
#   <arquivo-do-corpo>   arquivo com o corpo da PR (caminho absoluto)
#   --baixo-risco        declara que a fatia não toca dado novo, banco, segredo nem dado pessoal
#   --mesclar            o dono autoriza mesclar ESTA fatia quando todos os checks passarem. Só vale junto com --baixo-risco.
#                        Sem as duas flags o script NUNCA mescla: mesclar em main publica no site.
#
# Variáveis (todas opcionais):
#   ENTREGA_WT      worktree onde rodar (padrão: a worktree agent-aba14ae6777618c89 do projeto)
#   ENTREGA_REPO    dono/repositório no GitHub (padrão: AlexandreCamerini/replica)
#   ENTREGA_SAIDA   pasta onde gravar o resultado, para a sessão ler (padrão: .entrega dentro da worktree)
#   ENTREGA_SECO=1  só mostra o que faria, sem mudar nada
#
# Não usa segredo, não usa --force, não apaga branch, não mexe em produção. Falha do CI não é erro do script: o resultado é gravado.
set -uo pipefail

WT="${ENTREGA_WT:-/Users/acamerini/replica/.claude/worktrees/agent-aba14ae6777618c89}"
REPO="${ENTREGA_REPO:-AlexandreCamerini/replica}"
SAIDA="${ENTREGA_SAIDA:-$WT/.entrega}"
SECO="${ENTREGA_SECO:-0}"

usa() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }
die() { echo "erro: $*" >&2; exit "${2:-1}"; }
exec 3>&1  # saída original: o modo seco escreve nela, mesmo quando o comando teria a saída redirecionada para o log
rode() { if [ "$SECO" = 1 ]; then echo "[seco] $*" >&3; return 0; fi; "$@"; }

[ $# -ge 4 ] || usa
COMMIT="$1"; BRANCH="$2"; TITULO="$3"; CORPO="$4"; shift 4
BAIXO=0; MESCLAR=0
for f in "$@"; do
  case "$f" in
    --baixo-risco) BAIXO=1 ;;
    --mesclar) MESCLAR=1 ;;
    --force|-f|--force-with-lease) die "este script não força nada" 64 ;;
    *) die "opção desconhecida: $f" 64 ;;
  esac
done

# --- validação das entradas (falha cedo, antes de tocar em qualquer coisa)
[ -d "$WT/.git" ] || [ -f "$WT/.git" ] || die "worktree não encontrada: $WT (use ENTREGA_WT)" 66
G() { git -C "$WT" "$@"; }
G cat-file -e "${COMMIT}^{commit}" 2>/dev/null || die "commit $COMMIT não existe neste repositório" 66
printf '%s' "$BRANCH" | grep -Eq '^claude/[a-z0-9][a-z0-9._-]{2,60}$' || die "branch deve ser claude/<nome-em-minúsculas>: $BRANCH" 64
[ -n "$TITULO" ] || die "título vazio" 64
[ -s "$CORPO" ] || die "arquivo do corpo ausente ou vazio: $CORPO" 66
[ "$MESCLAR" = 0 ] || [ "$BAIXO" = 1 ] || die "--mesclar só vale junto com --baixo-risco" 64
command -v gh >/dev/null || die "gh não encontrado" 69
mkdir -p "$SAIDA"
LOG="$SAIDA/${BRANCH//\//_}.txt"
{ echo "fatia: $BRANCH"; echo "commit: $COMMIT"; echo "início: $(date -u +%FT%TZ)"; } > "$LOG"
anota() { echo "$*" | tee -a "$LOG"; }

# worktree sem alteração em arquivo rastreado (o que não é rastreado, como web/.next-mi, não atrapalha)
[ -z "$(G status --porcelain --untracked-files=no)" ] || die "há alterações não commitadas na worktree: $WT" 73
# sem operação git pela metade
GD="$(G rev-parse --git-dir)"; case "$GD" in /*) ;; *) GD="$WT/$GD" ;; esac
[ ! -e "$GD/CHERRY_PICK_HEAD" ] || { anota "cherry-pick pela metade: limpando com --skip"; rode git -C "$WT" cherry-pick --skip || die "não consegui limpar o cherry-pick" 73; }

anota "1/5 atualizando main"
rode git -C "$WT" fetch origin main || die "fetch falhou" 69

REMOTA=0; G ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1 && REMOTA=1
LOCAL=0; G show-ref --verify --quiet "refs/heads/$BRANCH" && LOCAL=1

if [ "$REMOTA" = 1 ]; then
  anota "2/5 a branch $BRANCH já está no GitHub: pulando branch, cherry-pick e push"
else
  if [ "$LOCAL" = 1 ]; then
    anota "2/5 a branch $BRANCH já existe local: usando ela"
    rode git -C "$WT" switch "$BRANCH" || die "não consegui trocar para $BRANCH" 73
  else
    anota "2/5 criando $BRANCH a partir de origin/main"
    rode git -C "$WT" switch -c "$BRANCH" origin/main || die "não consegui criar $BRANCH" 73
  fi
  # o commit já está na branch? (cherry-pick repetido viraria vazio)
  if [ "$SECO" != 1 ] && G merge-base --is-ancestor "$COMMIT" HEAD 2>/dev/null; then
    anota "3/5 o commit já está na branch: pulando cherry-pick"
  else
    anota "3/5 cherry-pick de $COMMIT"
    if ! rode git -C "$WT" cherry-pick "$COMMIT" >>"$LOG" 2>&1; then
      if [ -e "$GD/CHERRY_PICK_HEAD" ] && [ -z "$(G diff --name-only --diff-filter=U)" ]; then
        anota "cherry-pick vazio (o conteúdo já está em main): pulando"; rode git -C "$WT" cherry-pick --skip >>"$LOG" 2>&1
      else
        rode git -C "$WT" cherry-pick --abort >>"$LOG" 2>&1
        anota "CONFLITO no cherry-pick de $COMMIT sobre o main atual. Nada foi enviado. Esta fatia precisa ser refeita sobre o main."
        echo "resultado: conflito" >> "$LOG"; exit 3
      fi
    fi
  fi
  anota "4/5 enviando a branch (sem force)"
  rode git -C "$WT" push -u origin "$BRANCH" >>"$LOG" 2>&1 || { anota "push falhou (ver $LOG)"; echo "resultado: push falhou" >> "$LOG"; exit 4; }
fi

# --- PR
NUM="$(gh pr list --repo "$REPO" --head "$BRANCH" --state all --json number -q '.[0].number' 2>/dev/null || true)"
if [ -n "$NUM" ]; then
  anota "5/5 a PR #$NUM já existe: seguindo para o CI"
else
  anota "5/5 abrindo a PR"
  if [ "$SECO" = 1 ]; then echo "[seco] gh pr create --repo $REPO --base main --head $BRANCH --title \"$TITULO\" --body-file $CORPO"; NUM=0
  else
    URL="$(gh pr create --repo "$REPO" --base main --head "$BRANCH" --title "$TITULO" --body-file "$CORPO" 2>>"$LOG")" || { anota "gh pr create falhou (ver $LOG)"; echo "resultado: pr falhou" >> "$LOG"; exit 5; }
    NUM="${URL##*/}"; anota "PR: $URL"
  fi
fi
echo "pr: $NUM" >> "$LOG"

# --- CI
if [ "$SECO" = 1 ]; then echo "[seco] gh pr checks $NUM --watch"; exit 0; fi
anota "esperando o CI da #$NUM (o web-e2e leva uns 10 minutos)"
gh pr checks "$NUM" --repo "$REPO" --watch >>"$LOG" 2>&1; RC=$?
if [ "$RC" = 0 ]; then
  anota "CI: todos os checks passaram"; echo "resultado: verde" >> "$LOG"
  if [ "$MESCLAR" = 1 ] && [ "$BAIXO" = 1 ]; then
    anota "mesclando a #$NUM (autorizado pelo dono com --baixo-risco --mesclar)"
    if gh pr merge "$NUM" --repo "$REPO" --merge >>"$LOG" 2>&1; then echo "resultado: mesclada" >> "$LOG"; else anota "merge falhou (ver $LOG)"; echo "resultado: merge falhou" >> "$LOG"; exit 6; fi
  else
    anota "NÃO mesclei: mesclar publica no site e é decisão do dono. Para mesclar: gh pr merge $NUM --repo $REPO --merge"
  fi
else
  anota "CI: algum check falhou (ver $LOG). Para a sessão ler o erro: gh run view --job <id> --repo $REPO --log-failed > $SAIDA/${BRANCH//\//_}.erro.txt"
  echo "resultado: vermelho" >> "$LOG"; exit 7
fi
