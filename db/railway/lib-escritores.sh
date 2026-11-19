# Checagem de escritores na origem por ATIVIDADE, não por nome de role (runbook-railway §8, ponto a; plano autônomo, etapa 7).
# A checagem por nome (railway-copy.sh) não via o GoTrue do Supabase (supabase_auth_admin), nem um ETL que conecta como `postgres`
# sem application_name. Esta mede as escritas de verdade: soma inserções, atualizações e remoções de `pg_stat_user_tables` nos
# schemas do Segue o Voto (public, auth, login) em dois instantes, separados por JANELA segundos. Se a soma andou, alguém escreveu.
# As estatísticas do Postgres são acumuladas por transação concluída, então uma transação aberta e longa só aparece quando termina:
# por isso a checagem por nome continua antes desta.
# Uso: source lib-escritores.sh; escritas_na_janela "$URL" 15   -> imprime o número de linhas escritas na janela (0 = parado)

escritas_na_janela() {
  local url="$1" janela="${2:-15}" a b
  [[ "$janela" =~ ^[0-9]+$ ]] || { echo "janela inválida: $janela" >&2; return 2; }
  local q="select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_user_tables where schemaname in ('public', 'auth', 'login')"
  # pg_stat_clear_snapshot: dentro de uma sessão as estatísticas ficam congeladas; cada leitura é uma sessão nova, e a limpeza é por garantia
  a="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "select pg_stat_clear_snapshot()" -c "$q" | tail -1)" || return 1
  sleep "$janela"
  b="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "select pg_stat_clear_snapshot()" -c "$q" | tail -1)" || return 1
  echo $(( b - a ))
}
