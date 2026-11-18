#!/usr/bin/env bash
# Valida o ensaio (runbook-railway.md §2) sem escrever nada de dado: só leitura, mais testes que se desfazem sozinhos.
# Uso:
#   bash db/railway/ensaio-validar.sh snapshot ANTES.txt    # ANTES da cópia: foto do que é de outras apps no cluster
#   bash db/railway/ensaio-validar.sh validar [--db civico_ensaio] [--antes ANTES.txt] [--roles ~/.config/segueovoto/railway-roles.env]
# Entradas: ORIGEM_URL (senão pergunta oculto), DESTINO_URL (senão Railway CLI, como o railway-copy.sh).
# Saída: PASS/FAIL por checagem e resumo (tempos de consulta, conexões, tamanho). Exit 1 se algum FAIL.
# Senhas nunca em argv: ficam num .pgpass 0600 temporário.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/lib-uri.sh"
CMD="${1:-}"; shift || true
DB=civico_ensaio; ANTES=""; ROLES="$HOME/.config/segueovoto/railway-roles.env"; SNAPFILE=""
if [[ "$CMD" == snapshot ]]; then SNAPFILE="${1:?uso: snapshot ARQUIVO}"; shift; fi
while [[ $# -gt 0 ]]; do case "$1" in --db) DB="$2"; shift ;; --antes) ANTES="$2"; shift ;; --roles) ROLES="$2"; shift ;; *) echo "opção desconhecida: $1" >&2; exit 2 ;; esac; shift; done
[[ "$CMD" == snapshot || "$CMD" == validar ]] || { sed -n '2,9p' "$0"; exit 2; }
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "--db inválido" >&2; exit 2; }
case "$DB" in postgres|railway|template0|template1) echo "recuso o database $DB" >&2; exit 2 ;; esac
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/civico-val.XXXXXX")"; chmod 700 "$PGDIR"; trap 'rm -rf "$PGDIR"' EXIT
: > "$PGDIR/pgpass"; chmod 600 "$PGDIR/pgpass"; export PGPASSFILE="$PGDIR/pgpass"
addpass() { uri pgpass "$1" >> "$PGDIR/pgpass"; }

if [[ -z "${DESTINO_URL:-}" ]]; then
  command -v railway >/dev/null || { echo "railway CLI não encontrado e DESTINO_URL não definida" >&2; exit 1; }
  VARS="$(railway variables --service "${RAILWAY_PG_SERVICE:-Postgres}" --kv)" || { echo "railway variables falhou" >&2; exit 1; }
  DESTINO_URL="$(grep -E '^DATABASE_PUBLIC_URL=' <<<"$VARS" | head -1 | cut -d= -f2- || true)"; unset VARS
  [[ -n "$DESTINO_URL" ]] || { echo "sem DATABASE_PUBLIC_URL" >&2; exit 1; }
fi
ADMIN_FULL="$(secure "$(uri setdb "$DESTINO_URL" postgres)")"; DEST_FULL="$(secure "$(uri setdb "$DESTINO_URL" "$DB")")"
addpass "$ADMIN_FULL"; ADMIN="$(uri nopass "$ADMIN_FULL")"; DEST="$(uri nopass "$DEST_FULL")"; unset DESTINO_URL ADMIN_FULL DEST_FULL
Q=(-X -v ON_ERROR_STOP=1 -At)

# ---- foto do que NÃO é do Segue o Voto no cluster -----------------------------------------------------------------------------
snapshot() {
  psql "$ADMIN" "${Q[@]}" -c "
    with nossos(n) as (values ('anon'),('authenticated'),('service_role'),('web_reader'),('web_writer'),('admin_central'),('civico_etl'))
    select 'role ' || rolname || ' super=' || rolsuper || ' login=' || rolcanlogin || ' inherit=' || rolinherit || ' createrole=' || rolcreaterole || ' createdb=' || rolcreatedb || ' repl=' || rolreplication || ' bypass=' || rolbypassrls || ' conn=' || rolconnlimit
      from pg_roles where rolname !~ '^pg_' and rolname not in (select n from nossos)
    union all
    select 'membro ' || r.rolname || ' <- ' || m.rolname from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
      where r.rolname not in (select n from nossos) and m.rolname not in (select n from nossos)
    union all
    select 'config ' || d.datname || ' ' || coalesce(r.rolname, '-') || ' ' || s.setconfig::text
      from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase left join pg_roles r on r.oid = s.setrole
      where d.datname <> '$DB' and (r.rolname is null or r.rolname not in (select n from nossos))
    union all
    select 'database ' || datname || ' dono=' || datdba::regrole || ' acl=' || coalesce(datacl::text, '-') from pg_database where datname <> '$DB'
    order by 1"
}
if [[ "$CMD" == snapshot ]]; then snapshot > "$SNAPFILE"; echo "snapshot gravado em $SNAPFILE ($(wc -l < "$SNAPFILE" | tr -d ' ') linhas)"; exit 0; fi

# ---- validar ----------------------------------------------------------------------------------------------------------------------------
FAILS=0
ok() { printf '  PASS  %s\n' "$1"; }
no() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { local desc="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else no "$desc"; fi; }

echo "== 1. outras apps intactas"
if [[ -n "$ANTES" ]]; then
  snapshot > "$PGDIR/depois.txt"
  if diff -u "$ANTES" "$PGDIR/depois.txt" > "$PGDIR/snap.diff"; then ok "roles, membros, configs e datacl de outras apps idênticos ao snapshot de antes"
  else no "o cluster mudou fora do Segue o Voto:"; sed 's/^/        /' "$PGDIR/snap.diff"; fi
else echo "  (pulado: sem --antes; rode 'snapshot' antes da cópia da próxima vez)"; fi

echo "== 2. origem x destino (railway-verify.sql)"
if [[ -z "${ORIGEM_URL:-}" ]]; then echo "Cole a URI de LEITURA do Supabase (oculta)."; read -r -s ORIGEM_URL; echo; fi
OF="$(secure "$ORIGEM_URL")"; addpass "$OF"; ORIG="$(uri nopass "$OF")"; unset ORIGEM_URL OF
psql "$ORIG" "${Q[@]}" -f "$HERE/railway-verify.sql" > "$PGDIR/o.txt"
psql "$DEST" "${Q[@]}" -f "$HERE/railway-verify.sql" > "$PGDIR/d.txt"
if diff "$PGDIR/o.txt" "$PGDIR/d.txt" > "$PGDIR/v.diff"; then ok "diff vazio ($(wc -l < "$PGDIR/o.txt" | tr -d ' ') linhas: contagens exatas, índices, policies, RLS, grants)"
else no "diff origem x destino não vazio (a tabela divergente é a 94ª do runbook §5):"; sed 's/^/        /' "$PGDIR/v.diff" | head -30; fi

echo "== 3. ambiente do destino"
AMB="$(psql "$DEST" "${Q[@]}" -v ambiente=on -f "$HERE/railway-verify.sql")"
grep -q '^public_pode_conectar false' <<<"$AMB" && ok "PUBLIC sem CONNECT" || no "PUBLIC ainda conecta"
grep -E '^datacl' <<<"$AMB" | grep -Eq '(^|[{,])=' && no "datacl tem entrada de PUBLIC" || ok "datacl sem PUBLIC"
grep -q '^dono_do_database civico_etl' <<<"$AMB" && ok "dono do database = civico_etl" || no "dono do database errado"
grep -q '^objetos_de_public_com_outro_dono 0$' <<<"$AMB" && ok "0 objetos de public com outro dono" || no "há objetos de public com dono diferente de civico_etl"
grep -q '^config (database).*search_path' <<<"$AMB" && ok "search_path do database" || no "sem search_path do database"
grep -q '^config web_reader.*statement_timeout=3s' <<<"$AMB" && ok "web_reader statement_timeout 3s" || no "web_reader sem statement_timeout 3s"
grep -q '^config web_writer.*statement_timeout=8s' <<<"$AMB" && ok "web_writer statement_timeout 8s" || no "web_writer sem statement_timeout 8s"
[[ "$(grep -c 'idle_in_transaction_session_timeout' <<<"$AMB")" -ge 2 ]] && ok "idle_in_transaction nos dois roles" || no "falta idle_in_transaction_session_timeout"
[[ "$(psql "$DEST" "${Q[@]}" -c "select shobj_description(oid,'pg_database') from pg_database where datname = current_database()")" == segueovoto ]] && ok "database marcado segueovoto" || no "database sem a marca"
check "0143 registrada em schema_migrations" test "$(psql "$DEST" "${Q[@]}" -c "select count(*) from schema_migrations where filename like '0143_%'")" = 1
check "extensões em extensions (5)" test "$(psql "$DEST" "${Q[@]}" -c "select count(*) from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'extensions' and e.extname in ('uuid-ossp','unaccent','pgcrypto','btree_gist','pg_trgm')")" = 5
check "nenhum role do Segue o Voto é superusuário" test "$(psql "$DEST" "${Q[@]}" -c "select count(*) from pg_roles where rolsuper and rolname in ('anon','authenticated','service_role','web_reader','web_writer','admin_central','civico_etl')")" = 0

echo "== 4. conexão e privilégios por role (precisa de $ROLES; gerado por configurar-dono.sh)"
if [[ -r "$ROLES" ]]; then
  ru() { grep "^$1_URL=" "$ROLES" | head -1 | cut -d= -f2-; }
  for r in web_reader web_writer civico_etl; do u="$(ru $r)"; [[ -n "$u" ]] && addpass "$u"; done
  RD="$(uri nopass "$(ru web_reader)")"; WR="$(uri nopass "$(ru web_writer)")"; ET="$(uri nopass "$(ru civico_etl)")"
  S() { psql "$1" "${Q[@]}" -c "$2"; }
  # saída de resultado sem as marcas de comando (BEGIN/SET/ROLLBACK); erro capturado à parte (sem SIGPIPE de grep -q com pipefail)
  val() { local o; o="$(S "$1" "$2" 2>&1 || true)"; grep -Ev '^(BEGIN|SET|ROLLBACK|COMMIT)$' <<<"$o" | tail -1 || true; }
  err() { S "$1" "$2" 2>&1 || true; }
  check "web_reader conecta e lê (people)" S "$RD" "select count(*) from people"
  [[ "$(val "$RD" "show statement_timeout")" == 3s ]] && ok "web_reader enxerga statement_timeout=3s" || no "web_reader sem 3s na sessão"
  T0=$SECONDS; O="$(err "$RD" "select pg_sleep(5)")"; grep -Eqi 'statement timeout|tempo limite|tempo de espera' <<<"$O" && ok "web_reader: consulta de 5s é cancelada pelo timeout ($((SECONDS - T0))s)" || no "web_reader: pg_sleep(5) não foi cancelada: $O"
  O="$(err "$RD" "insert into sources (id) values (gen_random_uuid())")"; grep -Eqi 'permission denied|permiss' <<<"$O" && ok "web_reader não escreve" || no "web_reader não recebeu 'permission denied' ao inserir em sources: $O"
  O="$(err "$RD" "select 1 from login.codes limit 1")"; grep -Eqi 'permission denied|permiss' <<<"$O" && ok "web_reader não enxerga o schema login" || no "web_reader alcança login.*: $O"
  [[ "$(val "$WR" "show statement_timeout")" == 8s ]] && ok "web_writer enxerga statement_timeout=8s" || no "web_writer sem 8s na sessão"
  check "web_writer lê/escreve login.codes (rollback)" S "$WR" "begin; insert into login.codes (email, code_hash, expires_at) values ('validar@invalido.test','x',now()); delete from login.codes where email = 'validar@invalido.test'; rollback"
  [[ "$(val "$WR" "begin; set local role authenticated; select set_config('request.jwt.claim.sub','11111111-2222-4333-8444-555555555555',true); select auth.uid(); rollback")" == 11111111-2222-4333-8444-555555555555 ]] && ok "web_writer vira authenticated e auth.uid() devolve o sub" || no "set role authenticated / auth.uid() falhou"
  [[ "$(val "$WR" "begin; set local role authenticated; select count(*) from profiles; rollback")" == 0 ]] && ok "RLS: authenticated sem sub não vê perfis de ninguém" || no "RLS de profiles não filtrou"
  check "civico_etl cria e apaga tabela em public (é dono)" S "$ET" "create table public.__validar (x int); drop table public.__validar"
else echo "  (pulado: $ROLES não existe; rode configurar-dono.sh --etapa roles)"; fi

echo "== 5. tamanho, conexões e tempo (para o runbook §2)"
psql "$DEST" "${Q[@]}" -c "select 'tamanho do database: ' || pg_size_pretty(pg_database_size(current_database()))" -c "select 'tamanho de public: ' || pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','m')"
psql "$ADMIN" "${Q[@]}" -c "select 'conexões no cluster: ' || count(*) || ' de max_connections=' || current_setting('max_connections') from pg_stat_activity where backend_type = 'client backend'" -c "select '  por database: ' || coalesce(datname,'-') || '=' || count(*) from pg_stat_activity where backend_type = 'client backend' group by datname order by 1"
for q in "select count(*) from people" "select count(*) from votes"; do T0=$(date +%s%N 2>/dev/null || echo 0); psql "$DEST" "${Q[@]}" -c "$q" >/dev/null; echo "  consulta fria: $q -> $(( ($(date +%s%N 2>/dev/null || echo 0) - T0) / 1000000 )) ms (compare com o limite de 3s do reader)"; done

echo; if (( FAILS )); then echo "RESULTADO: $FAILS checagem(ns) FALHARAM. Não siga para o corte."; exit 1; else echo "RESULTADO: tudo PASS."; fi
