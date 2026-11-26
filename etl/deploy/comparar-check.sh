#!/usr/bin/env bash
# Compara o `civico-etl check` do código ANTIGO com o do código NOVO, os dois contra o MESMO banco, para separar as
# invariantes que já quebravam antes (dado real) das que o D338 introduziu.
#
# v1, NÃO EXECUTADA (o sandbox do agente não tem acesso ao banco). Só lê: `check` não escreve no banco.
#
# Uso (no terminal do dono, na raiz do repositório):
#   export ETL_DATABASE_URL='<url do civico_ensaio>'     # nunca colar em chat nem em arquivo
#   bash etl/deploy/comparar-check.sh [REF_ANTIGO] [REF_NOVO]
#   padrão: REF_ANTIGO=c6eac57 (produção atual, main)  REF_NOVO=ensaio/d338-passkey
#
# Critério de aceite: o conjunto de invariantes FALHOU no novo é igual ao do antigo (ou menor).
# Saída: 0 = nenhuma invariante nova quebrada; 1 = o novo quebra algo que o antigo não quebrava; 2 = não deu para comparar.
# Limite: o código antigo roda sobre o banco já migrado pelo D338 (migrações aditivas, exceto 0160). Se o `check` antigo
# falhar com erro de SQL (não com FALHOU), o relatório diz isso e a comparação não vale.
set -uo pipefail

ANTIGO="${1:-c6eac57}"
NOVO="${2:-ensaio/d338-passkey}"
[ -n "${ETL_DATABASE_URL:-}${DATABASE_URL:-}" ] || { echo "defina ETL_DATABASE_URL (ver o cabeçalho)" >&2; exit 2; }
command -v uv >/dev/null || { echo "uv não encontrado" >&2; exit 2; }
git rev-parse --verify -q "$ANTIGO^{commit}" >/dev/null || { echo "ref inexistente: $ANTIGO" >&2; exit 2; }
git rev-parse --verify -q "$NOVO^{commit}" >/dev/null || { echo "ref inexistente: $NOVO" >&2; exit 2; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cmpcheck.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

rodar() { # $1 = ref, $2 = rótulo
  local d="$TMP/$2"; mkdir -p "$d"
  git archive "$1" etl | tar -x -C "$d"
  ( cd "$d/etl" && ETL_CODE_VERSION="cmp-$2" uv run --quiet civico-etl check ) >"$TMP/$2.log" 2>&1
  echo $? >"$TMP/$2.exit"
  # "FALHOU: <nome> (<n>)": nome da invariante e contagem; o resto do log (horário, ok:) é ruído
  grep -o 'FALHOU: .*' "$TMP/$2.log" | sort >"$TMP/$2.falhas"
}

echo "antigo: $ANTIGO ($(git rev-parse --short "$ANTIGO"))"; rodar "$ANTIGO" antigo
echo "novo:   $NOVO ($(git rev-parse --short "$NOVO"))";    rodar "$NOVO" novo

for r in antigo novo; do
  if grep -q -E 'Traceback|UndefinedTable|UndefinedColumn|psycopg\..*Error' "$TMP/$r.log"; then
    echo "ERRO de execução no $r (não é invariante); últimas linhas:" >&2; tail -8 "$TMP/$r.log" >&2; exit 2
  fi
done

echo; echo "invariantes quebradas: antigo $(wc -l <"$TMP/antigo.falhas" | tr -d ' ') · novo $(wc -l <"$TMP/novo.falhas" | tr -d ' ')"
echo; echo "== só no NOVO (introduzidas) =="; comm -13 "$TMP/antigo.falhas" "$TMP/novo.falhas"
echo; echo "== só no ANTIGO (corrigidas) =="; comm -23 "$TMP/antigo.falhas" "$TMP/novo.falhas"
echo; echo "== nos DOIS (já quebravam antes: dado real, não é do D338) =="; comm -12 "$TMP/antigo.falhas" "$TMP/novo.falhas"

[ -z "$(comm -13 "$TMP/antigo.falhas" "$TMP/novo.falhas")" ] && { echo; echo "CONFERE: nenhuma invariante nova"; exit 0; }
echo; echo "DIVERGE: o novo quebra invariante que o antigo não quebrava"; exit 1
