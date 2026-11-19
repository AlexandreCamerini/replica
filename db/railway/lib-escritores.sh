# Checagem de escritores na origem por ATIVIDADE (de `auth`, só `users`: é a única tabela copiada; sessões e tokens que o GoTrue grava num refresh não importam)
#, não por nome de role (runbook-railway §8, ponto a; plano autônomo, etapa 7).
# A checagem por nome (railway-copy.sh) não via o GoTrue do Supabase (supabase_auth_admin), nem um ETL que conecta como `postgres`
# sem application_name. Esta mede as escritas de verdade: soma inserções, atualizações e remoções de `pg_stat_user_tables` nos
# schemas do Segue o Voto (public, auth, login) em dois instantes, separados por JANELA segundos. Se a soma andou, alguém escreveu.
# Limite: as estatísticas contam só transação CONCLUÍDA, e o backend publica a contagem com atraso de até ~10 s (até 60 s sob disputa).
# Escritor que commitou pouco antes da janela, ou que ficou parado mais de 15 s entre lotes, pode passar. Por isso a checagem por nome
# (com transação de escrita aberta de qualquer role) vem antes desta, e a pausa dos escritores do runbook §3 é a barreira principal.
# Uso: source lib-escritores.sh; escritas_na_janela "$URL" 15   -> imprime o número de linhas escritas na janela (0 = parado)

escritas_na_janela() {
  local url="$1" janela="${2:-15}" a b
  [[ "$janela" =~ ^[0-9]+$ ]] || { echo "janela inválida: $janela" >&2; return 2; }
  local q="select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_user_tables where schemaname in ('public', 'login') or (schemaname = 'auth' and relname = 'users')"
  # cada psql é uma sessão nova: as estatísticas lidas são as publicadas até ali
  a="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "$q" | tail -1)" || return 1
  sleep "$janela"
  b="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "$q" | tail -1)" || return 1
  echo $(( b - a ))
}
