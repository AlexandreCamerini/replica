#!/usr/bin/env bash
# Copia o Supabase (origem, só leitura) para um database do Postgres central do Railway (destino).
# Dump de `public` (+ `login`, se existir) -> preparação -> bootstrap -> auth.users -> restore como civico_etl -> ANALYZE.
#
# Uso:  bash db/railway/railway-copy.sh [--refazer] [--db NOME] [--sim] [--pooler-role ROLE] [--criar-roles-do-dump] [--manter-dump DIR]
#   --refazer       apaga SÓ o database de destino (--db), recria e roda o bootstrap.sql antes do restore
#   --db NOME       database de destino no cluster (padrão: civico)
#   --sim           não pede a confirmação digitada (uso não interativo: ensaio local)
#   --pooler-role   role do pooler que também precisa de CONNECT (repassado ao bootstrap.sql)
#   --criar-roles-do-dump  cria NOLOGIN, com a marca 'segueovoto:dump', os roles citados nos GRANTs do dump que não existam no destino
#                   (sem a opção, role desconhecido aborta a cópia antes de tocar no destino)
#   --manter-dump DIR      guarda o dump em DIR (padrão: pasta temporária, apagada ao fim)
# Entradas (nada é impresso nem gravado em arquivo):
#   ORIGEM_URL   URI do Supabase; sem a variável, pergunta com entrada oculta (como prod-migrate.sh)
#   DESTINO_URL  URI do cluster central; sem a variável, lê do Railway CLI (railway variables --kv do serviço $RAILWAY_PG_SERVICE,
#                padrão "Postgres": DATABASE_PUBLIC_URL, senão DATABASE_URL). A URI aponta para qualquer database do cluster:
#                o database de destino é sempre o de --db.
# Nunca toca na origem além de leitura. Toda conexão fora do local usa sslmode=require.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/db/railway"
DB=civico; REFAZER=0; SIM=0; POOLER=""; CRIAR_ROLES=0; KEEP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --refazer) REFAZER=1 ;;
    --sim) SIM=1 ;;
    --db) DB="${2:?--db precisa de um nome}"; shift ;;
    --pooler-role) POOLER="${2:?--pooler-role precisa de um role}"; shift ;;
    --criar-roles-do-dump) CRIAR_ROLES=1 ;;
    --manter-dump) KEEP="${2:?--manter-dump precisa de um diretório}"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
  shift
done
for c in psql pg_dump pg_restore vacuumdb python3; do command -v "$c" >/dev/null || { echo "$c não encontrado" >&2; exit 1; }; done
[[ "$DB" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "--db inválido: $DB" >&2; exit 2; }
case "$DB" in postgres|railway|template0|template1) echo "Recuso '$DB' como destino: use um database próprio do Segue o Voto." >&2; exit 2 ;; esac

# ---- URLs --------------------------------------------------------------------------------------------------------------------
# uri_parts: imprime host, porta, banco; uri_set_db: troca o banco; uri_ssl: acrescenta sslmode=require fora do local.
uri() { URI_IN="$2" python3 -I - "$1" "${3:-}" <<'PY'  # a URI (com senha) vai por ambiente, nunca por argv
import sys, re
from urllib.parse import parse_qsl, urlencode, unquote
import os
op, url = sys.argv[1], os.environ["URI_IN"]
# Parser próprio: a senha pode ter '@', ':' ou '/' sem escape (o urlsplit quebra e ainda imprime pedaço da senha no erro).
class U: pass
u = U()
m = re.match(r"^([a-z]+)://(.*)$", url.strip(), re.S)
if not m:
    print("URI inválida (esperado postgres://...)", file=sys.stderr); sys.exit(3)
u.scheme, rest = m.group(1), m.group(2)
rest, _, u.query = rest.partition("?")
if "@" in rest:
    userinfo, _, rest = rest.rpartition("@")
    u.username, _, pw = userinfo.partition(":")
    u.password = pw if _ else None
else:
    u.username = u.password = None
hostport, slash, tail = rest.partition("/")
u.path = slash + tail
mh = re.match(r"^(\[[^\]]+\]|[^:]*)(?::(\d+))?$", hostport)
if not mh:
    print("URI inválida: host/porta ilegíveis", file=sys.stderr); sys.exit(3)
u.hostname = mh.group(1).strip("[]") or None
u.port = int(mh.group(2)) if mh.group(2) else None
u.netloc = hostport
q = dict(parse_qsl(u.query, keep_blank_values=True))
host = q.get("host") or u.hostname or ""
local = host in ("localhost", "127.0.0.1", "::1", "") or host.startswith("/")
if op == "host": print(host or "(socket)")
elif op == "local": print("1" if local else "0")
elif op == "key": print(f"{host}:{u.port or q.get('port') or 5432}/{u.path.lstrip('/')}")
elif op == "db": print(u.path.lstrip("/"))
elif op == "nopass":
    netloc = (u.username + "@" if u.username else "") + (f"[{u.hostname}]" if u.hostname and ":" in u.hostname else (u.hostname or "")) + (f":{u.port}" if u.port else "")
    print(f"{u.scheme}://{netloc}{u.path}" + ("?" + u.query if u.query else ""))
elif op == "pgpass":
    if u.password:
        esc = lambda x: x.replace("\\", "\\\\").replace(":", "\\:")
        print(":".join([esc(host), esc(str(u.port or q.get("port") or 5432)), "*", esc(unquote(u.username or "")), esc(unquote(u.password) if re.search(r"%[0-9A-Fa-f]{2}", u.password) else u.password)]))
elif op in ("setdb", "ssl"):
    path = u.path
    if op == "setdb": path = "/" + sys.argv[2]
    if op == "ssl" and not local and "sslmode" not in q: q["sslmode"] = "require"
    print(f"{u.scheme}://" + (u.username + (":" + u.password if u.password is not None else "") + "@" if u.username else "") + f"{u.netloc}{path}" + ("?" + urlencode(q) if q else ""))
PY
}
is_local() { [[ "$(uri local "$1")" == 1 ]]; }
secure() { uri ssl "$1"; }

if [[ -z "${ORIGEM_URL:-}" ]]; then
  echo "Cole a URI de LEITURA do Supabase (postgres://...). Nada será exibido."
  read -r -s ORIGEM_URL; echo
fi
[[ "$ORIGEM_URL" =~ ^postgres(ql)?:// ]] || { echo "ORIGEM_URL não começa com postgres://. Abortado." >&2; exit 1; }
if [[ -z "${DESTINO_URL:-}" ]]; then
  command -v railway >/dev/null || { echo "railway CLI não encontrado e DESTINO_URL não definida" >&2; exit 1; }
  VARS="$(railway variables --service "${RAILWAY_PG_SERVICE:-Postgres}" --kv)" || { echo "railway variables falhou (railway login / railway link feitos?)" >&2; exit 1; }
  DESTINO_URL="$(grep -E '^DATABASE_PUBLIC_URL=' <<<"$VARS" | head -1 | cut -d= -f2- || true)"
  [[ -n "$DESTINO_URL" ]] || DESTINO_URL="$(grep -E '^DATABASE_URL=' <<<"$VARS" | head -1 | cut -d= -f2- || true)"
  unset VARS
  [[ -n "$DESTINO_URL" ]] || { echo "Railway CLI não devolveu DATABASE_PUBLIC_URL nem DATABASE_URL" >&2; exit 1; }
fi
[[ "$DESTINO_URL" =~ ^postgres(ql)?:// ]] || { echo "DESTINO_URL não começa com postgres://. Abortado." >&2; exit 1; }

ORIGEM_FULL="$(secure "$ORIGEM_URL")"
ADMIN_FULL="$(secure "$(uri setdb "$DESTINO_URL" postgres)")"   # manutenção: criar/apagar database
DESTINO_FULL="$(secure "$(uri setdb "$DESTINO_URL" "$DB")")"
[[ "$(uri key "$ORIGEM_FULL")" != "$(uri key "$DESTINO_FULL")" ]] || { echo "Origem e destino são o mesmo database. Abortado." >&2; exit 1; }
if [[ $SIM == 1 ]] && ! is_local "$DESTINO_FULL"; then echo "--sim (sem confirmação digitada) só vale com destino local. Abortado." >&2; exit 2; fi
# Senhas nunca vão para argv (ps mostra): ficam num .pgpass 0600 e as URIs seguem sem senha.
PGDIR="$(mktemp -d "${TMPDIR:-/tmp}/civico-pg.XXXXXX")"; chmod 700 "$PGDIR"
{ uri pgpass "$ORIGEM_FULL"; uri pgpass "$DESTINO_FULL"; } > "$PGDIR/pgpass"; chmod 600 "$PGDIR/pgpass"
export PGPASSFILE="$PGDIR/pgpass"
ORIGEM="$(uri nopass "$ORIGEM_FULL")"; ADMIN="$(uri nopass "$ADMIN_FULL")"; DESTINO="$(uri nopass "$DESTINO_FULL")"
unset ORIGEM_URL DESTINO_URL ORIGEM_FULL ADMIN_FULL DESTINO_FULL
Q=(-X -v ON_ERROR_STOP=1 -At)
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"   # sem NOTICE de "já existe" no meio da saída
echo "Origem : $(uri host "$ORIGEM") (database $(uri db "$ORIGEM"))"
echo "Destino: $(uri host "$DESTINO") (database $DB)$([[ $REFAZER == 1 ]] && echo '  [--refazer: o database será apagado e recriado]')"

# ---- etapas com tempo -----------------------------------------------------------------------------------------------------------
T_START=$SECONDS; T_STEP=$SECONDS; STEP=""; SUMMARY=()
etapa() { STEP="$1"; T_STEP=$SECONDS; echo; echo "== $STEP"; }
fim() { local d=$((SECONDS - T_STEP)); SUMMARY+=("$(printf '%5ds  %s' "$d" "$STEP")"); echo "   ($STEP: ${d}s)"; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/civico-copy.XXXXXX")"; [[ -n "$KEEP" ]] && { install -d -m 700 "$KEEP"; WORK="$KEEP"; }
cleanup() { rm -rf "$PGDIR"; [[ -z "$KEEP" ]] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT
confirmar() { # confirmar "mensagem" valor_esperado
  [[ $SIM == 1 ]] && return 0
  read -r -p "$1 Digite '$2' para continuar: " ans; [[ "$ans" == "$2" ]] || { echo "Nada alterado."; exit 1; }
}

# ---- 1. pré-checagens ---------------------------------------------------------------------------------------------------------------
etapa "pré-checagens (versões, origem sem escritores)"
SRV="$(psql "$ORIGEM" "${Q[@]}" -c 'show server_version_num')"
DUMP_MAJOR="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
(( DUMP_MAJOR >= SRV / 10000 )) || { echo "pg_dump $DUMP_MAJOR é mais velho que o servidor de origem (${SRV:0:2}). Instale o cliente ${SRV:0:2}+ (brew install postgresql@${SRV:0:2})." >&2; exit 1; }
# escritores conhecidos: roles do site e do ETL, qualquer sessão com trava consultiva (a agenda do ETL segura uma) e application_name do ETL
WRITERS="$(psql "$ORIGEM" "${Q[@]}" -F ' | ' -c "
  select 'pid ' || a.pid || ' role=' || coalesce(a.usename, '?') || ' app=' || coalesce(nullif(a.application_name, ''), '-') || ' estado=' || coalesce(a.state, '?') || ' desde=' || to_char(coalesce(a.state_change, a.backend_start), 'HH24:MI:SS')
    from pg_stat_activity a
   where a.datname = current_database() and a.pid <> pg_backend_pid()
     and (a.usename in ('web_writer', 'web_reader', 'admin_central', 'civico_etl')
          or a.application_name ilike '%civico%'
          or a.pid in (select l.pid from pg_locks l where l.locktype = 'advisory' and l.granted))
   order by a.pid")"
if [[ -n "$WRITERS" ]]; then
  echo "Há conexões de escritores conhecidos (site/ETL) na origem. Pause os escritores (runbook-railway.md) e rode de novo:" >&2
  sed 's/^/  /' <<<"$WRITERS" >&2
  exit 1
fi
echo "   origem sem escritores conhecidos conectados"
fim

# ---- 2. dump ----------------------------------------------------------------------------------------------------------------------------
etapa "dump (formato custom, sem dono)"
HAS_LOGIN="$(psql "$ORIGEM" "${Q[@]}" -c "select exists (select 1 from pg_namespace where nspname = 'login')")"
SCHEMAS=(-n public); [[ "$HAS_LOGIN" == t ]] && SCHEMAS+=(-n login)
pg_dump "$ORIGEM" -Fc "${SCHEMAS[@]}" --no-owner -f "$WORK/dump.custom"
echo "   $(du -h "$WORK/dump.custom" | cut -f1) (schemas: ${SCHEMAS[*]//-n /})"
fim

# ---- 3. roles citados no dump ------------------------------------------------------------------------------------------------------------
etapa "roles citados nos GRANTs do dump"
pg_restore -f - "$WORK/dump.custom" | python3 -I -c '
import re, sys
roles = set()
for line in sys.stdin:
    if re.match(r"(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b", line):
        roles.update(m.strip("\"") for m in re.findall(r"\b(?:TO|FROM)\s+(\"[^\"]+\"|[A-Za-z_][\w$]*)", line))
print("\n".join(sorted(r for r in roles if r.upper() != "PUBLIC")))' > "$WORK/roles.txt"
MISSING=()
while IFS= read -r r; do
  [[ -n "$r" ]] || continue
  [[ "$r" =~ ^(anon|authenticated|service_role|web_reader|web_writer|admin_central|civico_etl)$ ]] && continue  # o bootstrap cria
  [[ "$r" =~ ^[A-Za-z_][A-Za-z0-9_$]*$ ]] || { echo "nome de role inesperado no dump: $r" >&2; exit 1; }
  [[ "$(psql "$ADMIN" "${Q[@]}" -c "select exists (select 1 from pg_roles where rolname = '$r')")" == t ]] || MISSING+=("$r")
done < "$WORK/roles.txt"
if (( ${#MISSING[@]} )); then
  if [[ $CRIAR_ROLES == 1 ]]; then echo "   serão criados NOLOGIN (marca segueovoto:dump): ${MISSING[*]}"
  else echo "O dump cita roles que não existem no destino e não são do Segue o Voto: ${MISSING[*]}" >&2
       echo "Revise (são de outra app ou do Supabase?). Se forem só dono/grantee do Supabase, rode com --criar-roles-do-dump." >&2; exit 1; fi
else echo "   todos os roles citados existem ou são criados pelo bootstrap"; fi
fim

# ---- 4. destino ----------------------------------------------------------------------------------------------------------------------------
etapa "destino: database e bootstrap"
EXISTS="$(psql "$ADMIN" "${Q[@]}" -c "select exists (select 1 from pg_database where datname = '$DB')")"
if [[ $REFAZER == 1 ]]; then
  confirmar "ATENÇÃO: vou APAGAR o database '$DB' do cluster (e só ele)." "$DB"
  if [[ "$EXISTS" == t ]]; then
    MARCA="$(psql "$ADMIN" "${Q[@]}" -c "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '$DB'")"
    [[ "$MARCA" == segueovoto ]] || { echo "O database '$DB' existe sem a marca 'segueovoto': pode ser de outra app. Recuso apagar. Nada alterado." >&2; exit 1; }
    psql "$ADMIN" "${Q[@]}" -c "drop database \"$DB\" with (force)"
  fi
  EXISTS=f
fi
if [[ "$EXISTS" != t ]]; then psql "$ADMIN" "${Q[@]}" -c "create database \"$DB\"" -c "comment on database \"$DB\" is 'segueovoto'"  # marca já na criação: falha no bootstrap não deixa sobra sem dono
else
  N="$(psql "$DESTINO" "${Q[@]}" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','login') and c.relkind in ('r','p')")"
  [[ "$N" == 0 ]] || confirmar "O database '$DB' já tem $N tabela(s) em public/login: serão APAGADAS antes do restore." "$DB"
fi
for r in "${MISSING[@]:-}"; do
  [[ -n "$r" ]] || continue
  [[ "$r" =~ ^[A-Za-z_][A-Za-z0-9_$]*$ ]] || { echo "nome de role inesperado no dump: $r" >&2; exit 1; }
  psql "$ADMIN" "${Q[@]}" -q -c "create role \"$r\" nologin" -c "comment on role \"$r\" is 'segueovoto:dump'"
done
BOOT=(psql "$DESTINO" -X -q -v ON_ERROR_STOP=1)
[[ -n "$POOLER" ]] && BOOT+=(-v "pooler_role=$POOLER")
"${BOOT[@]}" -f "$HERE/bootstrap.sql"
# o dump traz o próprio CREATE SCHEMA public: sai o vazio daqui (o bootstrap roda de novo depois do restore e refaz dono e grants)
psql "$DESTINO" "${Q[@]}" -q -c "drop schema if exists public cascade" -c "drop schema if exists login cascade"
fim

# ---- 5. auth.users ---------------------------------------------------------------------------------------------------------------------------
etapa "auth.users (id, email, created_at) para o stub"
psql "$DESTINO" "${Q[@]}" -q -c "truncate auth.users"
psql "$ORIGEM" "${Q[@]}" -c "copy (select id, email, created_at from auth.users order by id) to stdout" \
  | psql "$DESTINO" "${Q[@]}" -q -c "copy auth.users (id, email, created_at) from stdin"
echo "   origem $(psql "$ORIGEM" "${Q[@]}" -c 'select count(*) from auth.users') / destino $(psql "$DESTINO" "${Q[@]}" -c 'select count(*) from auth.users') usuário(s)"
fim

# ---- 6. restore -------------------------------------------------------------------------------------------------------------------------------
etapa "restore (--single-transaction --exit-on-error --role=civico_etl) + bootstrap de novo"
# ALTER DEFAULT PRIVILEGES FOR ROLE postgres/supabase_admin (Supabase) não é nosso e o civico_etl não pode executá-lo: fora da lista do restore
pg_restore -l "$WORK/dump.custom" | grep -v ' DEFAULT ACL ' > "$WORK/restore.list"
echo "   $(pg_restore -l "$WORK/dump.custom" | grep -c ' DEFAULT ACL ') entrada(s) DEFAULT ACL do dump ignoradas"
pg_restore --single-transaction --exit-on-error --role=civico_etl --no-owner -L "$WORK/restore.list" -d "$DESTINO" "$WORK/dump.custom"
if [[ "$HAS_LOGIN" != t ]]; then
  echo "   AVISO: a origem não tem o schema login (migração 0143 ainda não aplicada lá): criado no destino a partir do arquivo da migração." >&2
  psql "$DESTINO" -X -q -v ON_ERROR_STOP=1 -c "set role civico_etl" -f "$ROOT/db/migrations/0143_login_pg.sql"
fi
"${BOOT[@]}" -f "$HERE/bootstrap.sql"   # reaplica dono e grants do schema public criado pelo restore
fim

# ---- 7. analyze --------------------------------------------------------------------------------------------------------------------------------
etapa "ANALYZE (estatísticas do planner; o restore não traz)"
vacuumdb --analyze-only --dbname="$DESTINO"
fim

echo; echo "Tempos:"; printf '  %s\n' "${SUMMARY[@]}"; echo "  $(printf '%5ds  total' $((SECONDS - T_START)))"
echo
echo "Confira com: psql <origem>  -X -At -f db/railway/railway-verify.sql > origem.txt"
echo "             psql <destino> -X -At -f db/railway/railway-verify.sql > destino.txt   (e diff origem.txt destino.txt)"
echo "             psql <destino> -X -At -v ambiente=on -f db/railway/railway-verify.sql"
