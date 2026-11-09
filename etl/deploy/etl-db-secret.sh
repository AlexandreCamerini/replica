#!/usr/bin/env bash
# Regrava o secret ETL_DATABASE_URL do GitHub com a URI de escrita da produção (a mesma do prod-migrate.sh).
# A URI é lida oculta e vai ao gh por stdin: nunca em argv, arquivo, histórico ou tela.
# O ETL passa a URI direto ao libpq: '@' dentro da senha precisa virar %40 (':' pode ficar).
set -euo pipefail
REPO="${REPO:-AlexandreCamerini/replica}"
printf 'Cole a URI de escrita da produção e tecle Enter (nada será exibido): '
IFS= read -rs URI; echo
URI="${URI//[$'\r\n\t ']/}"
case "$URI" in
  postgres://*|postgresql://*) ;;
  *) echo "Não parece uma URI postgres:// — nada foi gravado." >&2; exit 1 ;;
esac
at_count=$(printf %s "$URI" | tr -cd '@' | wc -c | tr -d ' ')
if [ "$at_count" -gt 1 ]; then
  echo "A URI tem $at_count '@': troque cada '@' da SENHA por %40 e rode de novo. Nada foi gravado." >&2
  exit 1
fi
printf %s "$URI" | gh secret set ETL_DATABASE_URL --repo "$REPO"
unset URI
gh secret list --repo "$REPO" | grep ETL_DATABASE_URL
