#!/usr/bin/env bash
# Helpers de URI compartilhados por railway-copy.sh e ensaio-validar.sh (a URI com senha só passa por ambiente, nunca por argv).
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

