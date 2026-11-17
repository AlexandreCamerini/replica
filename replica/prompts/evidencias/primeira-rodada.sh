#!/usr/bin/env bash
# SIMULADO. Primeira rodada do módulo de administração de coleta, passos 1 a 9, de ponta a ponta, SEM REDE.
#
# O que faz: recria o banco local `admin_coleta_r1` (o único que este roteiro apaga), aplica migrações, seed, base.sql e admin_base.sql e roda a CLI REAL
# (`civico-etl admin ...`) pelo lançador etl/tests/simulado.py, que serve respostas FABRICADAS do SAPL (etl/tests/fixtures/sapl_ale, cenários v1 e v2).
# Nenhum número gerado aqui foi lido de uma fonte: tudo é SIMULADO. Cada comando grava a saída (stdout e stderr juntos) em
# replica/prompts/evidencias/primeira-rodada-<nn>-<nome>.txt (e a versão --json em .json, que é só o documento: o lançador imprime a linha SIMULADO antes dele e o roteiro a tira);
# as conferências de cada passo vão para primeira-rodada-<nn>-conferencias.txt. O roteiro FALHA (código diferente de 0) no primeiro passo que falhar ou conferência que não bater.
#
# Passos do roteiro (o prompt numera 1 a 9; a correspondência está no relato replica/admin-coleta-primeira-rodada.md):
#         00 preparo | 01 inventário | 02 prévia | 03 rodada v1 e relatório | 04 mudança (v2, releitura forçada) | 05 passo 2: decisão aplicada | 06 passo 3: pendência em aberto
#         | 07 passo 4: a mesma rodada pelo identificador | 08 passo 5: reprocessar sem rede | 09 fechamento (fila, edição candidata, check)
#         | 10 município fabricado 1190099 (sapl.camaras, v1 e v2) | 11 a 14 = passos 6 a 9 do prompt, PELA CENTRAL (node web/e2e-admin/sem-navegador.mjs --fluxo, API HTTP do next start local):
#         11 passo 6 mapa e pendência | 12 passo 7 recoleta e executor | 13 passo 8 parecer de ensaio | 14 passo 9 decisão pela central e conferência pela CLI | 15 fechamento (check depois do fluxo)
#
# Como rodar (qualquer diretório; precisa de psql 16, uv, python3 e o servidor local em localhost:54329, que este roteiro NÃO liga nem desliga):
#   bash replica/prompts/evidencias/primeira-rodada.sh
# O nome do banco é literal aqui: o roteiro NÃO aceita URL de fora e recusa rodar se DATABASE_URL ou ETL_DATABASE_URL apontarem para outro banco.
# O banco `admin_coleta_r1` FICA como está no fim (a fase seguinte, da central, o usa). Ele é recriado do zero a cada execução. Nunca toca em `civico` nem em `admin_coleta`.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
ETL="$RAIZ/etl"
EV="$AQUI"
[ -f "$ETL/tests/simulado.py" ] || { echo "ERRO: não achei $ETL/tests/simulado.py (raiz do repositório: $RAIZ)" >&2; exit 2; }

[ -d /opt/homebrew/opt/postgresql@16/bin ] && PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export PATH
export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/uv-cache}"

R1=postgres://postgres@localhost:54329/admin_coleta_r1
MANUT=postgres://postgres@localhost:54329/postgres
for v in DATABASE_URL ETL_DATABASE_URL; do
  if [ -n "${!v:-}" ] && [ "${!v}" != "$R1" ]; then
    echo "ERRO: $v aponta para outro banco; este roteiro só roda contra $R1 e não aceita URL de fora" >&2
    exit 2
  fi
done
export DATABASE_URL=postgres://postgres@localhost:54329/admin_coleta_r1
export ETL_DATABASE_URL=postgres://postgres@localhost:54329/admin_coleta_r1

CACHE="${TMPDIR:-/tmp}/admin-r1-cache"
case "$CACHE" in */admin-r1-cache) ;; *) echo "ERRO: diretório de cache inesperado: $CACHE" >&2; exit 2 ;; esac
OPERADOR="Operador de Ensaio (SIMULADO)"
UFS=(RO AC AM PI PB)
UFARGS=(--uf RO --uf AC --uf AM --uf PI --uf PB)
TAB_DOM="sapl_parlamentares sapl_mandatos sapl_materias sapl_autorias sapl_sessoes sapl_presencas sapl_votos sapl_cursors sapl_houses data_coverage"
TAB_ADM="adm_vinculos adm_propostas adm_pendencias adm_pendencia_propostas"

PASSOS="00-preparo 01-inventario 02-previa 03-rodada-v1 04-mudanca-v2 05-decisao-aplicada 06-pendencia-aberta 07-repetir 08-reprocessar 09-fechamento 10-municipio 11-passo6-mapa 12-passo7-recoleta 13-passo8-parecer 14-passo9-decisao 15-fechamento-central"
declare -a FEITOS=()
ATUAL=""
CONF=/dev/null
RESSALVAS=""

# ---------------------------------------------------------------- resumo e passos

resumo() {
  local rc=$1 p ok
  echo
  echo "SIMULADO: resumo da primeira rodada (respostas fabricadas; nada foi lido da fonte)"
  for p in $PASSOS; do
    ok="não executado"
    for f in "${FEITOS[@]:-}"; do [ "$f" = "$p" ] && ok="ok"; done
    [ "$p" = "$ATUAL" ] && [ "$rc" -ne 0 ] && ok="FALHOU"
    printf '  %-24s %s\n' "$p" "$ok"
  done
  [ -n "$RESSALVAS" ] && printf '%s\n' "$RESSALVAS"
  if [ "$rc" -eq 0 ]; then echo "resultado: tudo passou"; else echo "resultado: FALHOU (código $rc)"; fi
}
# trava contra duas execuções ao mesmo tempo (o roteiro recria o banco): se uma execução anterior foi morta à força, apague o diretório da trava
TRAVA="${TMPDIR:-/tmp}/admin-r1.trava"
mkdir "$TRAVA" 2>/dev/null || { echo "ERRO: outra execução está em andamento (ou foi morta à força): apague $TRAVA se tiver certeza de que não há outra" >&2; exit 2; }
trap 'rc=$?; trap - EXIT; rmdir "$TRAVA" 2>/dev/null || true; resumo $rc; exit $rc' EXIT

passo() {
  [ -n "$ATUAL" ] && FEITOS+=("$ATUAL")
  ATUAL="$1"
  CONF="$EV/primeira-rodada-${1%%-*}-conferencias.txt"
  { echo "SIMULADO: conferências do passo $1 (respostas fabricadas)"; } > "$CONF"
  echo
  echo "== passo $1"
}
fecha_ultimo() { [ -n "$ATUAL" ] && FEITOS+=("$ATUAL"); ATUAL=""; }

conf() { # conf "descrição" comando...   : registra [ok] ou [FALHOU] e falha o roteiro
  local desc="$1"; shift
  if "$@"; then echo "  [ok] $desc" | tee -a "$CONF"; else echo "  [FALHOU] $desc" | tee -a "$CONF"; return 1; fi
}
nota() { echo "  $*" | tee -a "$CONF"; }

# ---------------------------------------------------------------- execução

L() { # L cenario args-da-cli...   : a CLI real sobre respostas fabricadas, mesmo cache em todos os passos
  local cen="$1"; shift
  ( cd "$ETL" && uv run --frozen python tests/simulado.py --cenario "$cen" --cache-dir "$CACHE" -- "$@" )
}
ev() { # ev nome cenario args...   : grava stdout+stderr; devolve o código do comando
  local nome="$1" cen="$2"; shift 2
  local rc=0
  L "$cen" "$@" > "$EV/primeira-rodada-$nome.txt" 2>&1 || rc=$?
  echo "  gravado primeira-rodada-$nome.txt (código $rc)"
  return $rc
}
evj() { # evj nome cenario args...   : versão --json (só o documento; tira a linha SIMULADO do lançador)
  local nome="$1" cen="$2"; shift 2
  local rc=0 bruto="$EV/.bruto.$$"
  L "$cen" "$@" --json > "$bruto" 2> "$bruto.err" || rc=$?
  if [ "$(head -n 1 "$bruto" | cut -c1-9)" != "SIMULADO:" ]; then echo "ERRO: a primeira linha do stdout não é a marca SIMULADO ($nome)" >&2; cat "$bruto.err" >&2; rm -f "$bruto" "$bruto.err"; return 1; fi
  tail -n +2 "$bruto" > "$EV/primeira-rodada-$nome.json"
  rm -f "$bruto" "$bruto.err"
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$EV/primeira-rodada-$nome.json" || { echo "ERRO: $nome.json não é JSON" >&2; return 1; }
  echo "  gravado primeira-rodada-$nome.json (código $rc)"
  return $rc
}
sql() { psql "$R1" -X -q -At -c "$1"; }
sqlt() { psql "$R1" -X -q -P pager=off -c "$1"; }
id_da_rodada() { awk '$1=="rodada"{print $2; exit}' "$1"; }
J() { echo "$EV/primeira-rodada-$1.json"; }
T() { echo "$EV/primeira-rodada-$1.txt"; }

snapshot() { # snapshot arquivo tabelas...   : contagem e hash por tabela (linha inteira, sem os carimbos que a sondagem refaz: checked_at, updated_at, created_at, checked_on)
  local arq="$1" t; shift
  { echo "SIMULADO. tabela|linhas|hash (md5 das linhas em JSON, sem checked_at, updated_at, created_at, checked_on)"
    for t in "$@"; do
      psql "$R1" -X -q -At -F '|' -c "select '$t', count(*), md5(coalesce(string_agg(x::text, ',' order by x::text), '')) from (select to_jsonb(t) - 'checked_at' - 'updated_at' - 'created_at' - 'checked_on' as x from $t t) s"
    done; } > "$arq"
}
casa_id() { sql "select h.id from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = '$1'"; }

# pendência (id) do campo `status` de uma casa na fila JSON
pend_de() { # pend_de fila.json casa_id
  python3 - "$1" "$2" <<'PY'
import json, sys
fila = json.load(open(sys.argv[1]))
a = [p for p in fila if p["classe"] == "vinculo_sapl" and p["campo"] == "status" and p["registro_chave"] == sys.argv[2]]
if len(a) != 1:
    sys.exit(f"esperava exatamente 1 pendência vinculo_sapl/status da casa {sys.argv[2]}, achei {len(a)}")
print(a[0]["id"])
PY
}

# ================================================================ 00 preparo
passo 00-preparo
rm -f "$EV"/primeira-rodada-[0-9]* "$EV"/.bruto.*
psql "$MANUT" -X -q -At -c "select 1" > /dev/null || { echo "ERRO: o servidor local (localhost:54329) não responde; este roteiro não o liga" >&2; exit 2; }
psql "$MANUT" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists admin_coleta_r1 with (force)" -c "create database admin_coleta_r1"
conf "o banco conectado é admin_coleta_r1" test "$(sql 'select current_database()')" = "admin_coleta_r1"
( cd "$RAIZ" && db/migrate.sh --local ) > "$(T 00-migrar)" 2>&1
( cd "$ETL" && uv run --frozen civico-etl seed ) > "$(T 00-seed)" 2>&1
psql "$R1" -X -q -v ON_ERROR_STOP=1 -f "$ETL/tests/fixtures/base.sql" > "$(T 00-base-sql)" 2>&1
psql "$R1" -X -q -v ON_ERROR_STOP=1 -f "$ETL/tests/fixtures/admin_base.sql" > "$(T 00-admin-base-sql)" 2>&1
rm -rf "$CACHE"; mkdir -p "$CACHE"
{ echo "SIMULADO. preparo do banco admin_coleta_r1 (recriado do zero)"
  sqlt "select current_database() as banco, version() as versao"
  sqlt "select count(*) as migracoes_aplicadas from schema_migrations"
  sqlt "select p.uf, lb.name, lb.kind from legislative_bodies lb join places p on p.id = lb.place_id where lb.kind = 'assembleia' and p.uf in ('RO','AC','AM','PI','PB') order by p.uf"
  sqlt "select (select count(*) from sapl_houses) as sapl_houses, (select count(*) from adm_rodadas) as adm_rodadas, (select count(*) from ingest_runs) as ingest_runs, (select count(*) from places where kind = 'municipio') as municipios"
  echo "cache de HTTP (apagado e recriado): $CACHE"
} > "$(T 00-preparo)" 2>&1
cat "$(T 00-preparo)" | sed 's/^/    /'
conf "as cinco Assembleias estão em legislative_bodies" test "$(sql "select count(*) from legislative_bodies lb join places p on p.id = lb.place_id where lb.kind = 'assembleia' and p.uf in ('RO','AC','AM','PI','PB')")" = "5"
conf "banco sem rodada, sem casa SAPL e sem run (zero conhecido)" test "$(sql 'select (select count(*) from adm_rodadas) + (select count(*) from sapl_houses) + (select count(*) from ingest_runs)')" = "0"
nota "migrações aplicadas: $(sql 'select count(*) from schema_migrations')"
# linha de base do check NESTE banco, antes de qualquer rodada
ev 00-check-antes v1 check || true
nota "invariantes quebradas antes da rodada (check, linhas FALHOU): $(grep -c 'FALHOU' "$(T 00-check-antes)" || true)"

# ================================================================ 01 inventário
passo 01-inventario
ev 01-inventario v1 admin inventario
evj 01-inventario v1 admin inventario
conf "o inventário lista o coletor sapl.assembleias" grep -q 'sapl.assembleias' "$(T 01-inventario)"

# ================================================================ 02 prévia do recorte
passo 02-previa
ev 02-previa v1 admin previa --coletor sapl.assembleias "${UFARGS[@]}"
evj 02-previa v1 admin previa --coletor sapl.assembleias "${UFARGS[@]}"
conf "a prévia lista 10 URLs de entrada firmes (robots.txt e /api/ das cinco casas), nenhuma em cache" python3 - "$(J 02-previa)" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
assert p["n_urls_entrada"] == 10 and p["n_urls_condicionais"] == 0, (p["n_urls_entrada"], p["n_urls_condicionais"])
assert all(i["cache"]["estado"] == "fora_do_cache" for i in p["urls_entrada"])
assert p["registros_elegiveis"]["valor"] == 5 and p["nao_suportado"] is None and p["comando"] == "sapl.ales"
PY
conf "a prévia não pediu nenhuma URL ao transporte (sem rede)" grep -q 'SIMULADO: 0 URLs pedidas' "$(T 02-previa)"

# ================================================================ 03 rodada sobre v1
passo 03-rodada-v1
ev 03-rodada-v1 v1 admin rodada abrir --coletor sapl.assembleias "${UFARGS[@]}" --executar
R_V1="$(id_da_rodada "$(T 03-rodada-v1)")"
[ -n "$R_V1" ] || { echo "ERRO: não achei o id da rodada em $(T 03-rodada-v1)" >&2; exit 1; }
nota "rodada v1: $R_V1"
evj 03-rodada-v1-ver v1 admin rodada ver "$R_V1"
ev 03-relatorio-v1 v1 admin relatorio "$R_V1"
ev 03-relatorio-v1-ids v1 admin relatorio "$R_V1" --ids
evj 03-relatorio-v1 v1 admin relatorio "$R_V1"
conf "a rodada v1 terminou concluida" grep -q '^status *concluida' "$(T 03-rodada-v1)"
conf "o relatório abre com o aviso SIMULADO e o JSON traz simulado=v1" python3 - "$(T 03-relatorio-v1)" "$(J 03-relatorio-v1)" <<'PY'
import json, sys
linhas = open(sys.argv[1]).read().splitlines()  # stdout e stderr juntos: a linha do lançador vem primeiro e o relatório traz o aviso dele
assert linhas[0].startswith("SIMULADO: respostas fabricadas de etl/tests/fixtures/sapl_ale/v1")
assert any(l.startswith("SIMULADO: respostas fabricadas (cenário v1); nenhum número abaixo foi lido da fonte") for l in linhas), linhas[:6]
assert json.load(open(sys.argv[2]))["simulado"] == "v1"
PY
conf "critério 3: as URLs de entrada da prévia são as URLs de entrada tentadas" python3 - "$(J 02-previa)" "$(J 03-relatorio-v1)" <<'PY'
import json, sys
previa = {i["url"] for i in json.load(open(sys.argv[1]))["urls_entrada"] if not i["condicional"]}
r = json.load(open(sys.argv[2]))["coleta"]["urls_entrada"]
tentadas = {i["url"] for i in r["tentadas"]["ids"]}
print("  previa:", len(previa), "tentadas:", len(tentadas), "declaradas_nao_tentadas:", r["declaradas_nao_tentadas"]["valor"], "de", r["declaradas_nao_tentadas"]["de"])
assert previa == tentadas and r["declaradas_nao_tentadas"]["valor"] == 0
PY
conf "primeira rodada sobre banco vazio: nenhuma proposta (tudo é primeiro preenchimento)" python3 - "$(J 03-relatorio-v1)" "$(J 03-rodada-v1-ver)" <<'PY'
import json, sys
rev = json.load(open(sys.argv[1]))["revisao"]
assert rev["campos_com_proposta"]["valor"] == 0 and rev["campos_com_proposta"]["de"] == 0
res = json.load(open(sys.argv[2]))["resultado"]["propostas"]
print("  primeiros preenchimentos:", res["primeiros_preenchimentos"], res["primeiros_preenchimentos_por_classe"])
assert res["novas"] == 0
PY

# ================================================================ 04 a mudança: v2 com releitura forçada
passo 04-mudanca-v2
evj 04-previa-v2 v2 admin previa --coletor sapl.assembleias "${UFARGS[@]}"
declare -a FORCA=()
while IFS= read -r u; do FORCA+=(--forcar-url "$u"); done < <(python3 - "$(J 04-previa-v2)" <<'PY'
import json, sys
for i in json.load(open(sys.argv[1]))["urls_entrada"]:
    if i["url"].endswith("/robots.txt") or i["url"].endswith("/api/"):
        print(i["url"])
PY
)
nota "URLs com releitura forçada (robots.txt e /api/ das casas): $(( ${#FORCA[@]} / 2 ))"
ev 04-rodada-v2 v2 admin rodada abrir --coletor sapl.assembleias "${UFARGS[@]}" "${FORCA[@]}" --executar
R_V2="$(id_da_rodada "$(T 04-rodada-v2)")"
[ -n "$R_V2" ] || { echo "ERRO: não achei o id da rodada v2" >&2; exit 1; }
nota "rodada v2: $R_V2"
evj 04-rodada-v2-ver v2 admin rodada ver "$R_V2"
ev 04-relatorio-v2 v2 admin relatorio "$R_V2"
ev 04-relatorio-v2-ids v2 admin relatorio "$R_V2" --ids
evj 04-relatorio-v2 v2 admin relatorio "$R_V2"
ev 04-fila v2 admin fila
evj 04-fila v2 admin fila
ev 04-candidata v2 admin candidata
evj 04-candidata v2 admin candidata
ID_PB="$(casa_id PB)"; ID_AM="$(casa_id AM)"
nota "sapl_houses.id: PB=$ID_PB AM=$ID_AM"
PEND_PB="$(pend_de "$(J 04-fila)" "$ID_PB")"
PEND_AM="$(pend_de "$(J 04-fila)" "$ID_AM")"
nota "pendência do status de PB: $PEND_PB; de AM: $PEND_AM"
conf "a rodada v2 terminou concluida e o relatório é SIMULADO (v2)" python3 - "$(T 04-rodada-v2)" "$(J 04-relatorio-v2)" <<'PY'
import json, sys
assert any(l.split()[:2] == ["status", "concluida"] for l in open(sys.argv[1]))
assert json.load(open(sys.argv[2]))["simulado"] == "v2"
PY
conf "pendência aberta de PB: status fora_do_ar -> ok, com evidência (URL, trecho, hash, leitura)" python3 - "$(J 04-fila)" "$ID_PB" <<'PY'
import json, sys
p = [x for x in json.load(open(sys.argv[1])) if x["registro_chave"] == sys.argv[2] and x["campo"] == "status"][0]
pr = p["propostas"][0]
print("  PB:", pr["valor_vigente_na_leitura"], "->", pr["valor_candidato"], pr["url"], pr["conteudo_sha256"][:12], pr["lida_em"])
assert (pr["valor_vigente_na_leitura"], pr["valor_candidato"]) == ("fora_do_ar", "ok") and pr["url"].endswith("/api/") and pr["trecho"] and len(pr["conteudo_sha256"]) == 64 and pr["lida_em"]
assert p["tipo"] == "mudanca" and p["pergunta"].endswith("?")
PY
conf "pendência aberta de AM: status ok -> robots_bloqueia, com evidência do robots.txt" python3 - "$(J 04-fila)" "$ID_AM" <<'PY'
import json, sys
p = [x for x in json.load(open(sys.argv[1])) if x["registro_chave"] == sys.argv[2] and x["campo"] == "status"][0]
pr = p["propostas"][0]
print("  AM:", pr["valor_vigente_na_leitura"], "->", pr["valor_candidato"], pr["url"], pr["conteudo_sha256"][:12], pr["lida_em"])
assert (pr["valor_vigente_na_leitura"], pr["valor_candidato"]) == ("ok", "robots_bloqueia") and pr["url"].endswith("/robots.txt") and pr["trecho"] and len(pr["conteudo_sha256"]) == 64
PY
conf "a edição candidata traz as duas diferenças pendentes (PB e AM) e a marca SIMULADO" python3 - "$(J 04-candidata)" "$ID_PB" "$ID_AM" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
assert c["simulado"] == ["v1", "v2"]  # as duas rodadas do banco são simuladas (cenários v1 e v2)
d = {(x["registro_chave"], x["campo"]): x["situacao"] for x in c["diferencas"] if x["classe"] == "vinculo_sapl"}
assert d.get((sys.argv[2], "status")) == "pendente" and d.get((sys.argv[3], "status")) == "pendente", d
print("  totais:", {k: f'{v["valor"]} de {v["de"]}' for k, v in c["totais"].items()})
PY
nota "pendências abertas por classe (informativo): $(python3 -c "
import json,collections,sys
c=collections.Counter(p['classe']+'/'+p['campo'] for p in json.load(open(sys.argv[1])))
print(dict(c))" "$(J 04-fila)")"

# ================================================================ 05 passo 2: um campo que mudou, com decisão registrada e aplicada
passo 05-decisao-aplicada
DATA_LIDA="$(python3 - "$(J 04-fila)" "$ID_PB" <<'PY'
import json, sys
p = [x for x in json.load(open(sys.argv[1])) if x["registro_chave"] == sys.argv[2] and x["campo"] == "status"][0]
print(p["propostas"][0]["lida_em"][:10])
PY
)"
ev 05-decidir-pb v2 admin decidir "$PEND_PB" --acao aprovar --por "$OPERADOR" \
  --justificativa "a /api/ da casa voltou a responder na leitura de $DATA_LIDA (resposta fabricada, cenário v2); ver evidência da proposta" --aplicar
ev 05-pendencia-pb v2 admin pendencia "$PEND_PB"
evj 05-pendencia-pb v2 admin pendencia "$PEND_PB"
{ echo "SIMULADO. conferência em SQL do passo 2 (banco admin_coleta_r1)"
  echo "-- sapl_houses.status de PB"
  sqlt "select h.id, p.uf, h.status, h.base_url from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' and p.uf = 'PB'"
  echo "-- adm_overrides do campo"
  sqlt "select id, classe, registro_chave, campo, valor, suprimir, vigente, decisao_id from adm_overrides where registro_chave = '$ID_PB'"
  echo "-- adm_decisoes da pendência"
  sqlt "select id, pendencia_id, acao, decidido_por_tipo, decidido_por_nome, aplicada, aplicada_em, justificativa from adm_decisoes where pendencia_id = '$PEND_PB'"
  echo "-- adm_pendencias"
  sqlt "select id, classe, registro_chave, campo, tipo, status, reaberta from adm_pendencias where id = '$PEND_PB'"
  echo "-- corrections (linhas: $(sql 'select count(*) from corrections'))"
  sqlt "select * from corrections"
  echo "-- motivo dado pelo resultado da aplicação (saída do comando decidir):"
  grep -E '^(aplicada|escreveu|corrections|sem corrections|observação)' "$(T 05-decidir-pb)" || true
} > "$(T 05-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 05-conferencia-sql)"
conf "a decisão foi gravada como aplicada, por pessoa, com o nome literal" test "$(sql "select acao || '|' || decidido_por_tipo || '|' || decidido_por_nome || '|' || aplicada from adm_decisoes where pendencia_id = '$PEND_PB'")" = "aprovar|pessoa|$OPERADOR|true"
conf "a pendência de PB ficou decidida e sapl_houses.status de PB é ok" test "$(sql "select (select status from adm_pendencias where id = '$PEND_PB') || '|' || (select status from sapl_houses where id = $ID_PB)")" = "decidida|ok"
conf "a saída do decidir diz o que escreveu e o que houve com corrections" grep -qE '^(corrections|sem corrections)' "$(T 05-decidir-pb)"
conf "só uma decisão existe no banco (a de PB); nenhuma decisão de agentes" test "$(sql "select count(*) || '|' || count(*) filter (where decidido_por_tipo = 'agentes') from adm_decisoes")" = "1|0"

# ================================================================ 06 passo 3: candidato pendente, pergunta em aberto
passo 06-pendencia-aberta
snapshot "$(T 06-estado-antes)" $TAB_DOM $TAB_ADM
N_DEC="$(sql 'select count(*) from adm_decisoes')"; N_OVR="$(sql 'select count(*) from adm_overrides')"; N_COR="$(sql 'select count(*) from corrections')"
ev 06-pendencia-am v2 admin pendencia "$PEND_AM"
evj 06-pendencia-am v2 admin pendencia "$PEND_AM"
ev 06-parecer-am v2 admin parecer --pendencia "$PEND_AM"
snapshot "$(T 06-estado-depois)" $TAB_DOM $TAB_ADM
{ echo "SIMULADO. nada foi aplicado pelo parecer de ensaio"
  sqlt "select p.uf, h.status from sapl_houses h join places p on p.id = h.place_id where p.kind = 'uf' order by p.uf"
  sqlt "select id, campo, tipo, status, pergunta from adm_pendencias where id = '$PEND_AM'"
  sqlt "select (select count(*) from adm_decisoes) as decisoes, (select count(*) from adm_overrides) as overrides, (select count(*) from corrections) as corrections, (select count(*) from adm_pareceres) as pareceres"
} > "$(T 06-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 06-conferencia-sql)"
conf "a pergunta da pendência de AM está em aberto e termina em ?" python3 - "$(J 06-pendencia-am)" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
print("  pergunta:", p["pergunta"])
print("  vigente:", p["valor_vigente"], "| candidato:", p["propostas"][0]["valor_candidato"], "| evidência:", p["propostas"][0]["url"], p["propostas"][0]["conteudo_sha256"][:12])
assert p["status"] == "aberta" and p["pergunta"].endswith("?") and p["decisoes"] == []
PY
conf "o parecer saiu marcado ENSAIO e SIMULADO" grep -q 'ENSAIO: parecer não aplica nada' "$(T 06-parecer-am)"
conf "o parecer é do motor local simulado (sem chamada a modelo)" grep -q 'SIMULADO: motor de ensaio local' "$(T 06-parecer-am)"
conf "nada foi aplicado: status de AM, pendência aberta, decisões, overrides e corrections iguais" test "$(sql "select (select status from sapl_houses where id = $ID_AM) || '|' || (select status from adm_pendencias where id = '$PEND_AM') || '|' || (select count(*) from adm_decisoes) || '|' || (select count(*) from adm_overrides) || '|' || (select count(*) from corrections)")" = "robots_bloqueia|aberta|$N_DEC|$N_OVR|$N_COR"
conf "as tabelas de domínio e de revisão têm as mesmas linhas e hashes antes e depois do parecer" diff -q "$(T 06-estado-antes)" "$(T 06-estado-depois)"

# ================================================================ 07 passo 4: a mesma rodada de novo, pelo identificador
passo 07-repetir
snapshot "$(T 07-estado-antes)" $TAB_DOM $TAB_ADM
{ echo "SIMULADO. rodada $R_V2 (v2), repetida pelo identificador com o mesmo cenário e o mesmo cache"; } > "$(T 07-cabecalho)"
ev 07-repetir v2 admin rodada repetir "$R_V2"
R_REP="$(awk '$1=="rodada"{print $2; exit}' "$(T 07-repetir)")"
[ -n "$R_REP" ] && [ "$R_REP" != "$R_V2" ] || { echo "ERRO: a repetição não gerou uma rodada nova" >&2; exit 1; }
nota "rodada repetida: $R_REP (repete $R_V2)"
snapshot "$(T 07-estado-depois)" $TAB_DOM $TAB_ADM
ev 07-relatorio-repeticao v2 admin relatorio "$R_REP"
ev 07-relatorio-repeticao-ids v2 admin relatorio "$R_REP" --ids
evj 07-relatorio-repeticao v2 admin relatorio "$R_REP"
{ echo "SIMULADO. tentativas da repetição por resultado"
  sqlt "select resultado, motivo, count(*) as n from adm_tentativas where rodada_id = '$R_REP' group by 1, 2 order by 1, 2"
  echo "SIMULADO. duplicatas por chave natural (esperado: nenhuma linha em cada consulta)"
  for par in "sapl_houses|place_id" "sapl_parlamentares|house_id, sapl_id" "sapl_mandatos|house_id, sapl_id" "sapl_materias|house_id, sapl_id" "sapl_autorias|house_id, materia_sapl_id, autor_sapl_id" "sapl_sessoes|house_id, sapl_id" "sapl_presencas|house_id, sessao_sapl_id, parlamentar_sapl_id" "sapl_votos|house_id, sapl_id" "sapl_cursors|house_id, entity"; do
    t="${par%%|*}"; k="${par#*|}"
    echo "-- $t por ($k): $(sql "select count(*) from (select $k from $t group by $k having count(*) > 1) d") duplicatas"
  done
  echo "-- adm_vinculos vigentes por (classe, registro_chave, url_sha): $(sql "select count(*) from (select 1 from adm_vinculos where vigente group by classe, registro_chave, url_sha having count(*) > 1) d") duplicatas"
} > "$(T 07-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 07-conferencia-sql)"
python3 - "$(J 07-relatorio-repeticao)" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["coleta"]
print("  repetição: tentadas", c["urls_tentadas"]["valor"], "| lidas", c["urls_lidas"]["valor"], "| reaproveitadas", c["urls_reaproveitadas"]["valor"], "| com falha", c["urls_com_falha"]["valor"])
PY
conf "a repetição terminou concluida e repete a rodada v2" grep -q "^repete *$R_V2" "$(T 07-repetir)"
conf "tentativas reaproveitadas > 0 (cache atravessou os passos)" python3 - "$(J 07-relatorio-repeticao)" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))["coleta"]
assert c["urls_reaproveitadas"]["valor"] > 0, c["urls_reaproveitadas"]
PY
conf "zero linha nova em adm_propostas, adm_pendencias, adm_pendencia_propostas, adm_vinculos, sapl_*, sapl_houses e data_coverage (contagens iguais)" test "$(cut -d'|' -f1,2 "$(T 07-estado-antes)")" = "$(cut -d'|' -f1,2 "$(T 07-estado-depois)")"
conf "nenhuma duplicata por chave natural" test "$(grep -c ' 0 duplicatas' "$(T 07-conferencia-sql)")" = "10"
conf "a repetição não criou proposta nem pendência" python3 - "$(J 07-relatorio-repeticao)" "$(T 07-estado-antes)" "$(T 07-estado-depois)" <<'PY'
import sys
def n(a, t):
    for l in open(a):
        if l.startswith(t + "|"): return int(l.split("|")[1])
for t in ("adm_propostas", "adm_pendencias", "adm_pendencia_propostas", "adm_vinculos"):
    a, d = n(sys.argv[2], t), n(sys.argv[3], t)
    print(f"  {t}: {a} -> {d}")
    assert a == d
PY

# ================================================================ 08 passo 5: reprocessamento sem rede do bruto salvo
passo 08-reprocessar
ev 08-previa-reprocessar-cinco v2 admin previa --coletor sapl.assembleias --modo reprocessar "${UFARGS[@]}" || true
evj 08-previa-reprocessar-cinco v2 admin previa --coletor sapl.assembleias --modo reprocessar "${UFARGS[@]}" || true
declare -a COMPLETAS=()
while IFS= read -r uf; do COMPLETAS+=("$uf"); done < <(python3 - "$(J 08-previa-reprocessar-cinco)" <<'PY'
import json, re, sys
p = json.load(open(sys.argv[1]))
faltam = set(p.get("faltam_no_cache") or []) | set(p.get("condicionais_fora_do_cache") or [])
por_uf = {}
for i in p["urls_entrada"]:
    uf = re.match(r"https://sapl\.al\.([a-z]{2})\.leg\.br/", i["url"]).group(1).upper()
    por_uf.setdefault(uf, []).append(i["url"])
for uf in ("RO", "AC", "AM", "PI", "PB"):
    if uf in por_uf and not any(u in faltam for u in por_uf[uf]):
        print(uf)
PY
)
nota "UFs com TODAS as URLs de entrada no cache (segundo a prévia): ${COMPLETAS[*]:-nenhuma}"
[ "${#COMPLETAS[@]}" -gt 0 ] || { echo "ERRO: nenhuma UF com as URLs de entrada completas no cache" >&2; exit 1; }
UFARGS_OK=(); for uf in "${COMPLETAS[@]}"; do UFARGS_OK+=(--uf "$uf"); done
ev 08-previa-reprocessar-completas v2 admin previa --coletor sapl.assembleias --modo reprocessar "${UFARGS_OK[@]}"
evj 08-previa-reprocessar-completas v2 admin previa --coletor sapl.assembleias --modo reprocessar "${UFARGS_OK[@]}"
conf "a prévia das UFs completas não tem URL faltando no cache" python3 - "$(J 08-previa-reprocessar-completas)" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
assert p["faltam_no_cache"] == [] and p["a_consultar"]["valor"] == 0, (p["faltam_no_cache"], p["a_consultar"])
PY
snapshot "$(T 08-estado-antes)" $TAB_DOM $TAB_ADM
ev 08-rodada-reprocessar v2 admin rodada abrir --coletor sapl.assembleias --modo reprocessar "${UFARGS_OK[@]}" --executar
R_REPROC="$(id_da_rodada "$(T 08-rodada-reprocessar)")"
[ -n "$R_REPROC" ] || { echo "ERRO: não achei o id da rodada de reprocessamento" >&2; exit 1; }
nota "rodada de reprocessamento: $R_REPROC"
snapshot "$(T 08-estado-depois)" $TAB_DOM $TAB_ADM
evj 08-rodada-reprocessar-ver v2 admin rodada ver "$R_REPROC"
ev 08-relatorio-reprocessar v2 admin relatorio "$R_REPROC"
ev 08-relatorio-reprocessar-ids v2 admin relatorio "$R_REPROC" --ids
evj 08-relatorio-reprocessar v2 admin relatorio "$R_REPROC"
{ echo "SIMULADO. tentativas do reprocessamento por resultado"
  sqlt "select resultado, motivo, count(*) as n from adm_tentativas where rodada_id = '$R_REPROC' group by 1, 2 order by 1, 2"
} > "$(T 08-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 08-conferencia-sql)"
# o limite: a rodada das cinco UFs é recusada porque faltam URLs no cache (a mensagem fica gravada)
ev 08-rodada-cinco-recusada v2 admin rodada abrir --coletor sapl.assembleias --modo reprocessar "${UFARGS[@]}" --executar || true
conf "a rodada de reprocessamento terminou concluida" grep -q '^status *concluida' "$(T 08-rodada-reprocessar)"
conf "nenhuma requisição ao transporte: 0 URLs pedidas" grep -q 'SIMULADO: 0 URLs pedidas' "$(T 08-rodada-reprocessar)"
{ echo "SIMULADO. tentativas do reprocessamento que NÃO são reaproveitada (esperado: só falha por robots, que não vai à rede)"
  sqlt "select resultado, motivo, entrada, url from adm_tentativas where rodada_id = '$R_REPROC' and resultado <> 'reaproveitada' order by url"
} >> "$(T 08-conferencia-sql)" 2>&1
tail -n 6 "$(T 08-conferencia-sql)" | sed 's/^/    /'
conf "nenhuma tentativa foi lida; as demais são reaproveitada, salvo a /api/ barrada pelo robots.txt já em cache (falha por robots, sem rede)" test "$(sql "select count(*) filter (where resultado = 'lida') || '|' || (count(*) filter (where resultado = 'reaproveitada') > 0) || '|' || count(*) filter (where resultado not in ('lida', 'reaproveitada') and not (resultado = 'falha' and motivo = 'robots')) from adm_tentativas where rodada_id = '$R_REPROC'")" = "0|true|0"
conf "tabelas de domínio idênticas (contagem e hash) antes e depois do reprocessamento" python3 - "$(T 08-estado-antes)" "$(T 08-estado-depois)" <<'PY'
import sys
def ler(a):
    return {l.split("|")[0]: l.rstrip("\n").split("|")[1:] for l in open(a) if "|" in l and not l.startswith("SIMULADO")}
a, d = ler(sys.argv[1]), ler(sys.argv[2])
dom = [t for t in a if t.startswith("sapl_") or t == "data_coverage"]
for t in dom:
    print(f"  {t}: {a[t][0]} linhas, hash {a[t][1][:8]} -> {d[t][0]} linhas, hash {d[t][1][:8]}")
assert all(a[t] == d[t] for t in dom), [t for t in dom if a[t] != d[t]]
PY
conf "a rodada das cinco UFs em reprocessar foi recusada: falhou, sem rodar o coletor, e lista o que falta no cache" python3 - "$(T 08-rodada-cinco-recusada)" <<'PY'
import sys
t = open(sys.argv[1]).read()
assert "status" in t and "falhou" in t and "faltam no cache" in t, t[-800:]
PY

# ================================================================ 09 fechamento
passo 09-fechamento
ev 09-fila v2 admin fila
evj 09-fila v2 admin fila
ev 09-candidata v2 admin candidata
evj 09-candidata v2 admin candidata
ev 09-inventario v2 admin inventario
evj 09-inventario v2 admin inventario
ev 09-rodada-listar v2 admin rodada listar
evj 09-rodada-listar v2 admin rodada listar
ev 09-vinculos-sapl-ale v2 admin vinculos --fonte sapl-ale
evj 09-vinculos-sapl-ale v2 admin vinculos --fonte sapl-ale
ev 09-relatorio-v2-final v2 admin relatorio "$R_V2"
evj 09-relatorio-v2-final v2 admin relatorio "$R_V2"
ev 09-candidata-rodada-v2 v2 admin candidata --rodada "$R_V2"
evj 09-candidata-rodada-v2 v2 admin candidata --rodada "$R_V2"
ev 09-check v2 check || true
conf "o relatório da rodada v2, depois da decisão: 1 registro alterado de 2, 1 campo pendente (AM) e 1 confirmado por decisão (PB)" python3 - "$(J 09-relatorio-v2-final)" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["revisao"]
v = lambda k: f'{r[k]["valor"]} de {r[k]["de"]}'
print("  registros_alterados:", v("registros_alterados"), "| pendentes:", v("pendentes"), "| confirmados:", v("confirmados"), "| decisoes:", v("decisoes"), "| campos_com_proposta:", v("campos_com_proposta"))
assert (r["registros_alterados"]["valor"], r["registros_alterados"]["de"]) == (1, 2)
assert (r["pendentes"]["valor"], r["confirmados"]["valor"], r["campos_com_proposta"]["valor"]) == (1, 1, 2)
PY
conf "a edição candidata restrita à rodada v2 tem os mesmos 2 campos com proposta e a marca SIMULADO (v2)" python3 - "$(J 09-candidata-rodada-v2)" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
assert c["simulado"] == ["v2"] and c["totais"]["campos_com_proposta"]["valor"] == 2 and len(c["aplicadas"]) == 1 and len(c["pendencias_restantes"]) == 1
PY
conf "a fila final traz a pendência de AM (aberta) e não traz a de PB (decidida)" python3 - "$(J 09-fila)" "$PEND_AM" "$PEND_PB" <<'PY'
import json, sys
ids = [p["id"] for p in json.load(open(sys.argv[1]))]
print("  pendências abertas:", len(ids))
assert sys.argv[2] in ids and sys.argv[3] not in ids
PY
conf "a edição candidata final tem PB em aplicadas e AM pendente, SIMULADA" python3 - "$(J 09-candidata)" "$ID_PB" "$ID_AM" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
assert c["simulado"] == ["v1", "v2"]  # as duas rodadas do banco são simuladas (cenários v1 e v2)
ap = {(x["registro_chave"], x["campo"]): x for x in c["aplicadas"]}
a = ap[(sys.argv[2], "status")]
print("  PB aplicada:", a["valor_anterior"], "->", a["valor_novo"], "|", a["decisao"]["por_nome"])
assert a["decisao"]["aplicada"] and a["decisao"]["por_nome"] == "Operador de Ensaio (SIMULADO)"
d = {(x["registro_chave"], x["campo"]): x["situacao"] for x in c["diferencas"]}
assert d[(sys.argv[3], "status")] == "pendente"
print("  totais:", {k: f'{v["valor"]} de {v["de"]}' for k, v in c["totais"].items()})
PY
# critério 14: o check já saía com código 1 por 5 invariantes que dependem de carga real; mede-se que nenhuma outra quebrou
python3 - "$(T 09-check)" "$(T 00-check-antes)" > "$(T 09-check-conferencia)" <<'PY' || true
import re, sys
def falhas(a):
    return sorted({re.sub(r"^\S+ \S+ etl\.check ERROR FALHOU: ", "", l.strip()) for l in open(a) if "FALHOU:" in l})
agora, antes = falhas(sys.argv[1]), falhas(sys.argv[2])
BASE = ("câmara: exatamente 513 em exercício", "senado: exatamente 81 em exercício", "cota: amostra fixa", "UF: exatamente 1 governador titular", "UF: governador e vice em exercício = lista conferida")
print("SIMULADO. critério 14: invariantes quebradas depois da rodada (banco admin_coleta_r1)")
for f in agora: print("  -", f)
base = [f for f in agora if any(f.startswith(b) for b in BASE)]
extras = [f for f in agora if f not in base]
print(f"da linha de base (carga real): {len(base)} de {len(BASE)}")
print(f"além da linha de base: {len(extras)}")
for f in extras: print("  +", f)
print("iguais às de ANTES da rodada (passo 00):", "sim" if agora == antes else "NÃO")
print("RESULTADO:", "BASE_COMPLETA" if len(base) == len(BASE) else "BASE_INCOMPLETA", "EXTRAS=" + str(len(extras)), "IGUAL_ANTES=" + ("sim" if agora == antes else "nao"))
PY
sed 's/^/    /' "$(T 09-check-conferencia)"
conf "as 5 invariantes da linha de base seguem quebradas (carga real ausente) e nada foi quebrado pela rodada (mesmo conjunto de antes)" grep -qE 'RESULTADO: BASE_COMPLETA EXTRAS=[0-9]+ IGUAL_ANTES=sim' "$(T 09-check-conferencia)"
EXTRAS_N="$(sed -n 's/^RESULTADO: .* EXTRAS=\([0-9]*\) .*/\1/p' "$(T 09-check-conferencia)")"
if [ "$EXTRAS_N" != "0" ]; then
  # as invariantes extras só são toleradas se forem exatamente o município fabricado de admin_base.sql (sem prefeito); qualquer outra coisa falha o roteiro
  conf "a única invariante extra é 'município: exatamente 1 prefeito' e vem do município fabricado de admin_base.sql" python3 - "$(T 09-check-conferencia)" "$(sql "select count(*) || '|' || coalesce(min(ibge_code), '') from places where kind = 'municipio'")" <<'PY'
import sys
extras = [l[4:].strip() for l in open(sys.argv[1]) if l.startswith("  + ")]
assert len(extras) == 1 and extras[0].startswith("município: exatamente 1 prefeito titular em exercício") and extras[0].rstrip().endswith("(1)"), extras
assert sys.argv[2] == "1|1190099", sys.argv[2]  # o único município do banco é o fabricado
PY
  RESSALVAS="  RESSALVA critério 14: além das 5 invariantes da linha de base, 'município: exatamente 1 prefeito titular' (1) está quebrada ANTES e DEPOIS da rodada, porque admin_base.sql cria o município fabricado 1190099 sem prefeito; não é efeito da rodada"
  nota "RESSALVA: invariante extra explicada pelo município fabricado (também presente antes da rodada)"
fi

# ================================================================ 10 município: sapl.camaras sobre a fixture fabricada (IBGE 1190099)
# O prompt manda acrescentar um município com Câmara Municipal no SAPL. A fixture fabricada existe (etl/tests/fixtures/sapl_ale, hosts .invalid, registro Interlegis
# fabricado): v1 descobre a casa, v2 muda o base_url dela no registro. Nenhum HTML de site real. O município 1190099 vem de admin_base.sql.
passo 10-municipio
MUN=1190099
ev 10-previa-municipio v1 admin previa --coletor sapl.camaras --ibge "$MUN" --modo descobrir
evj 10-previa-municipio v1 admin previa --coletor sapl.camaras --ibge "$MUN" --modo descobrir
ev 10-rodada-municipio-v1 v1 admin rodada abrir --coletor sapl.camaras --ibge "$MUN" --modo descobrir --executar
R_M1="$(id_da_rodada "$(T 10-rodada-municipio-v1)")"
[ -n "$R_M1" ] || { echo "ERRO: não achei o id da rodada do município (v1)" >&2; exit 1; }
nota "rodada do município v1: $R_M1"
evj 10-rodada-municipio-v1-ver v1 admin rodada ver "$R_M1"
evj 10-previa-municipio-v2 v2 admin previa --coletor sapl.camaras --ibge "$MUN" --modo descobrir
URL_REG="$(python3 - "$(J 10-previa-municipio-v2)" <<'PY'
import json, sys
u = [i["url"] for i in json.load(open(sys.argv[1]))["urls_entrada"] if "orgaosatendidos" in i["url"]]
assert len(u) == 1, u
print(u[0])
PY
)"
nota "URL do registro (releitura forçada na v2): $URL_REG"
ev 10-rodada-municipio-v2 v2 admin rodada abrir --coletor sapl.camaras --ibge "$MUN" --modo descobrir --forcar-url "$URL_REG" --executar
R_M2="$(id_da_rodada "$(T 10-rodada-municipio-v2)")"
[ -n "$R_M2" ] || { echo "ERRO: não achei o id da rodada do município (v2)" >&2; exit 1; }
nota "rodada do município v2: $R_M2"
evj 10-rodada-municipio-v2-ver v2 admin rodada ver "$R_M2"
ev 10-relatorio-municipio-v2 v2 admin relatorio "$R_M2"
evj 10-relatorio-municipio-v2 v2 admin relatorio "$R_M2"
ev 10-fila v2 admin fila --classe vinculo_sapl
evj 10-fila v2 admin fila --classe vinculo_sapl
{ echo "SIMULADO. município fabricado $MUN no banco admin_coleta_r1"
  sqlt "select h.id, p.ibge_code, p.name, h.base_url, h.status from sapl_houses h join places p on p.id = h.place_id where p.ibge_code = '$MUN'"
  sqlt "select id, classe, registro_chave, campo, tipo, status from adm_pendencias where status = 'aberta' order by classe, registro_chave, campo"
} > "$(T 10-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 10-conferencia-sql)"
ID_MUN="$(sql "select h.id from sapl_houses h join places p on p.id = h.place_id where p.ibge_code = '$MUN'")"
conf "as duas rodadas do município terminaram concluida" test "$(sql "select string_agg(status, ',' order by status) from adm_rodadas where id in ('$R_M1', '$R_M2')")" = "concluida,concluida"
conf "a casa do município está na v2 (base_url do registro novo) e há exatamente 1 pendência aberta de município (vinculo_sapl/base_url, mudança), com evidência" python3 - "$(J 10-fila)" "$ID_MUN" "$(sql "select base_url from sapl_houses where id = $ID_MUN")" <<'PY'
import json, sys
fila = json.load(open(sys.argv[1]))
m = [p for p in fila if p["registro_chave"] == sys.argv[2] and p["classe"] == "vinculo_sapl"]
print("  pendência do município:", [(p["campo"], p["tipo"], p["propostas"][0]["valor_vigente_na_leitura"], "->", p["propostas"][0]["valor_candidato"]) for p in m], "| base_url na tabela:", sys.argv[3])
assert sys.argv[3] == "https://sapl.camara-fabricada-nova.invalid"
assert len(m) == 1 and m[0]["campo"] == "base_url" and m[0]["tipo"] == "mudanca" and m[0]["territorio"]["nivel"] == "municipio", m
pr = m[0]["propostas"][0]
assert pr["trecho"] and len(pr["conteudo_sha256"]) == 64 and pr["lida_em"] and "orgaosatendidos" in pr["url"]
PY
conf "a pendência de AM (UF) continua aberta ao lado da do município" python3 - "$(J 10-fila)" "$PEND_AM" <<'PY'
import json, sys
assert sys.argv[2] in [p["id"] for p in json.load(open(sys.argv[1]))]
PY

# ================================================================ 11 a 14: passos 6 a 9 do prompt, pela central (API HTTP do next start local, executor da CLI sobre respostas fabricadas, cenário v2)
# sem-navegador.mjs --fluxo NÃO recria nada: opera em admin_coleta_r1 (nome conferido por ele e por comum.mjs) e exige fila de pedidos vazia no começo.
passo 11-passo6-mapa
command -v node > /dev/null || { echo "ERRO: node não está no PATH" >&2; exit 2; }
# build da central: reaproveita web/.next se ele tem as rotas /admin e nenhum arquivo de web/src, package.json ou next.config é mais novo que o BUILD_ID; senão um `next build` nas condições do CI (fonte demo, sem ADMIN_*, sem banco)
build_ok() {
  [ -f "$RAIZ/web/.next/BUILD_ID" ] && grep -q '/admin' "$RAIZ/web/.next/app-path-routes-manifest.json" 2> /dev/null \
    && [ -z "$(find "$RAIZ/web/src" "$RAIZ/web/package.json" "$RAIZ/web/next.config.ts" -newer "$RAIZ/web/.next/BUILD_ID" -type f 2> /dev/null | head -n 1)" ]
}
if build_ok; then
  nota "build: reaproveitado web/.next (tem as rotas /admin e nada em web/src é mais novo que o BUILD_ID)"
else
  nota "build: web/.next ausente ou velho; rodando next build (fonte demo, sem ADMIN_*, sem banco)"
  ( cd "$RAIZ/web" && env -u DATABASE_URL -u ETL_DATABASE_URL DATA_SOURCE=demo ALLOW_DEMO_DATA=1 NEXT_TELEMETRY_DISABLED=1 timeout 480 node node_modules/next/dist/bin/next build ) > "$(T 11-build)" 2>&1 || { tail -n 20 "$(T 11-build)" >&2; exit 1; }
  conf "o build terminou e a central está nele" build_ok
fi
FLUXO_BRUTO="$EV/.fluxo.$$"
rc=0
( cd "$RAIZ/web" && timeout 540 node e2e-admin/sem-navegador.mjs --sem-build --fluxo --banco admin_coleta_r1 ) > "$FLUXO_BRUTO" 2>&1 || rc=$?
cp "$FLUXO_BRUTO" "$(T 11-fluxo-central-bruto)"; rm -f "$FLUXO_BRUTO"
echo "  gravado primeira-rodada-11-fluxo-central-bruto.txt (código $rc)"
# divide a saída do fluxo nos quatro passos do prompt: 11 = seção 1 (mapa e pendência), 12 = seção 2 (recoleta), 13 = seção 3 (parecer), 14 = seções 4 e 5 (decisão; conferência pela CLI e SQL)
python3 - "$(T 11-fluxo-central-bruto)" "$EV" <<'PY'
import re, sys
linhas = open(sys.argv[1]).read().splitlines()
alvo = {"1": "11-passo6-mapa-e-pendencia", "2": "12-passo7-recoleta", "3": "13-passo8-parecer", "4": "14-passo9-decisao", "5": "14-passo9-decisao"}
partes, atual, pre = {}, None, []
for l in linhas:
    if l.startswith("ERROR: failed to copy trust settings"):  # ruído do uv no macOS (certificados do sistema), repetido a cada chamada da CLI; fica só no arquivo bruto
        continue
    m = re.match(r"== passo (\d): ", l)
    if m:
        atual = alvo[m.group(1)]
        partes.setdefault(atual, []).append(l)
    elif atual is None:
        pre.append(l)
    elif l.startswith("RESULTADO:"):
        break
    else:
        partes[atual].append(l)
for nome, ls in partes.items():
    with open(f"{sys.argv[2]}/primeira-rodada-{nome}.txt", "w") as f:
        f.write("SIMULADO. Parte da saída de `node web/e2e-admin/sem-navegador.mjs --sem-build --fluxo --banco admin_coleta_r1` (API HTTP da central; executor da CLI sobre respostas fabricadas, cenário v2). Nada foi lido de fonte real.\n")
        if nome.startswith("11-"): f.write("\n".join(pre) + "\n")
        f.write("\n".join(ls) + "\n")
PY
[ "$rc" -eq 0 ] || { echo "ERRO: sem-navegador.mjs --fluxo saiu com código $rc (saída em $(T 11-fluxo-central-bruto))" >&2; tail -n 25 "$(T 11-fluxo-central-bruto)" >&2; exit 1; }
conf "o fluxo da central terminou com RESULTADO: tudo passou e nenhuma linha FALHOU" bash -c "grep -q '^RESULTADO: tudo passou' '$(T 11-fluxo-central-bruto)' && ! grep -q '^FALHOU' '$(T 11-fluxo-central-bruto)'"
conf "premissa: o fluxo operou sobre uma pendência de MUNICÍPIO (1190099), sem o aviso PREMISSA de cair para a UF" bash -c "grep -q 'pendência escolhida: .*território municipio $MUN' '$(T 11-fluxo-central-bruto)' && ! grep -q 'PREMISSA' '$(T 11-fluxo-central-bruto)'"
nota "passo 6 (mapa e pendência): $(grep -m1 'pendência escolhida' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
nota "passo 6 (contagem no mapa): $(grep -m1 'o mapa conta' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
nota "LIMITE: /admin/api/estado só traz a contagem por UF (porUf); para município o fluxo mede a UF que o contém e avisa que a contagem do próprio município não é medida. A contagem do município na tela NÃO foi provada por este roteiro (critérios 16 e 21 são do Playwright, que não roda no sandbox, AC-05)"

passo 12-passo7-recoleta
nota "$(grep -m1 'POST recoleta' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
nota "$(grep -m1 'executor (--uma-vez até esvaziar): recoleta' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
nota "$(grep -m1 'a recoleta abriu e executou' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
RODADA_RECOLETA="$(sql "select rodada_id from adm_pedidos where tipo = 'recoleta' order by criado_em desc limit 1")"
[ -n "$RODADA_RECOLETA" ] || { echo "ERRO: o pedido de recoleta não ligou rodada" >&2; exit 1; }
ev 12-relatorio-recoleta v2 admin relatorio "$RODADA_RECOLETA"
ev 12-relatorio-recoleta-ids v2 admin relatorio "$RODADA_RECOLETA" --ids
evj 12-relatorio-recoleta v2 admin relatorio "$RODADA_RECOLETA"
evj 12-rodada-recoleta-ver v2 admin rodada ver "$RODADA_RECOLETA"
{ echo "SIMULADO. pedidos da central e rodada da recoleta (banco admin_coleta_r1)"
  sqlt "select tipo, status, rodada_id, parametros from adm_pedidos order by criado_em"
  sqlt "select id, coletor, modo, status, recorte from adm_rodadas where id = '$RODADA_RECOLETA'"
  sqlt "select resultado, motivo, count(*) as n from adm_tentativas where rodada_id = '$RODADA_RECOLETA' group by 1, 2 order by 1, 2"
} > "$(T 12-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 12-conferencia-sql)"
conf "a recoleta pela central abriu uma rodada concluida do coletor sapl.camaras sobre o município" test "$(sql "select coletor || '|' || status || '|' || (recorte->'ibges')::text from adm_rodadas where id = '$RODADA_RECOLETA'")" = 'sapl.camaras|concluida|["1190099"]'
conf "a pendência do município continua aberta e na fila, com o mesmo registro e campo (conferido pelo fluxo)" grep -q 'a pendência do mesmo registro e campo continua na fila' "$(T 11-fluxo-central-bruto)"

passo 13-passo8-parecer
nota "$(grep -m1 'POST parecer' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
{ echo "SIMULADO. pareceres no banco admin_coleta_r1 (motor de ensaio local; nenhuma chamada a modelo). Lido DEPOIS do fluxo inteiro: as contagens de decisoes incluem a do passo 9"
  sqlt "select id, pendencia_id, modelo, modo, simulado, criada_em from adm_pareceres order by criada_em"
  sqlt "select (select count(*) from adm_decisoes) as decisoes, (select count(*) from adm_overrides) as overrides, (select count(*) from corrections) as corrections"
} > "$(T 13-conferencia-sql)" 2>&1 || { echo "ERRO: consulta de pareceres falhou" >&2; cat "$(T 13-conferencia-sql)" >&2; exit 1; }
sed 's/^/    /' "$(T 13-conferencia-sql)"
conf "o parecer da central foi gravado com simulado = true (conferido pelo fluxo) e todo parecer do banco é simulado" bash -c "grep -q 'o parecer foi gravado em adm_pareceres com simulado = true' '$(T 11-fluxo-central-bruto)'"
conf "nenhum parecer real: todos simulado = true" test "$(sql "select count(*) from adm_pareceres where simulado is not true")" = "0"

passo 14-passo9-decisao
nota "$(grep -m1 'POST decisão' "$(T 11-fluxo-central-bruto)" | sed 's/^ *ok *//')"
PEND_MUN="$(sql "select pendencia_id from adm_decisoes d join adm_pendencias p on p.id = d.pendencia_id where p.registro_chave = '$ID_MUN' and p.classe = 'vinculo_sapl' and decidido_por_nome = '$OPERADOR'")"
[ -n "$PEND_MUN" ] || { echo "ERRO: não achei a decisão do município no banco" >&2; exit 1; }
nota "pendência decidida pela central: $PEND_MUN"
ev 14-pendencia-municipio v2 admin pendencia "$PEND_MUN"
evj 14-pendencia-municipio v2 admin pendencia "$PEND_MUN"
{ echo "SIMULADO. conferência em SQL do passo 9 (a decisão pedida pela central, lida no banco)"
  sqlt "select id, pendencia_id, acao, decidido_por_tipo, decidido_por_nome, aplicada, justificativa from adm_decisoes where pendencia_id = '$PEND_MUN'"
  sqlt "select id, classe, registro_chave, campo, tipo, status from adm_pendencias where id = '$PEND_MUN'"
  sqlt "select tipo, status, rodada_id from adm_pedidos order by criado_em"
  sqlt "select acao, por_nome, aplicar, status, decisao_id from adm_pedidos_decisao order by criado_em"
  sqlt "select (select count(*) from adm_decisoes) as decisoes, (select count(*) from adm_decisoes where decidido_por_tipo = 'agentes') as de_agentes, (select count(*) from adm_overrides) as overrides, (select count(*) from corrections) as corrections"
} > "$(T 14-conferencia-sql)" 2>&1
sed 's/^/    /' "$(T 14-conferencia-sql)"
conf "a decisão do passo 9 está no banco como aprovar|pessoa|nome|aplicada=false e é a mesma que a CLI mostra (admin pendencia)" python3 - "$(J 14-pendencia-municipio)" "$OPERADOR" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
d = p["decisoes"]
assert len(d) == 1, d
x = d[0]
por_t = x.get("decidido_por_tipo") or x.get("por_tipo") or (x.get("por") or {}).get("tipo")
por_n = x.get("decidido_por_nome") or x.get("por_nome") or (x.get("por") or {}).get("nome")
print("  CLI:", x["acao"], por_t, por_n, "aplicada=", x["aplicada"], "| pendência:", p["status"])
assert (x["acao"], por_t, por_n, x["aplicada"]) == ("aprovar", "pessoa", sys.argv[2], False)
PY
conf "o fluxo conferiu a decisão pela CLI e pelo SQL (passo 5 do fluxo) e a fila de pedidos terminou vazia" bash -c "grep -q 'CLI: acao=aprovar, por tipo=pessoa' '$(T 11-fluxo-central-bruto)' && grep -q 'fila de pedidos vazia no fim' '$(T 11-fluxo-central-bruto)'"
conf "nenhuma decisão de agentes e a aplicação não foi pedida: overrides e corrections não ganharam linha com o pedido da central" bash -c "grep -q 'sem aplicação: adm_overrides' '$(T 11-fluxo-central-bruto)'"
conf "o banco tem 2 decisões (PB do passo 2, município do passo 9), 0 de agentes, 1 override (o de PB) e 0 corrections" test "$(sql "select (select count(*) from adm_decisoes) || '|' || (select count(*) from adm_decisoes where decidido_por_tipo = 'agentes') || '|' || (select count(*) from adm_overrides) || '|' || (select count(*) from corrections)")" = "2|0|1|0"

# ================================================================ 15 fechamento do fluxo da central: check e fila
passo 15-fechamento-central
ev 15-check v2 check || true
ev 15-fila v2 admin fila
evj 15-fila v2 admin fila
ev 15-vinculos-municipio v2 admin vinculos --registro "vinculo_sapl:$ID_MUN"
evj 15-vinculos-municipio v2 admin vinculos --registro "vinculo_sapl:$ID_MUN"
python3 - "$(T 15-check)" "$(T 09-check)" > "$(T 15-check-conferencia)" <<'PY' || true
import re, sys
def falhas(a):
    return sorted({re.sub(r"^\S+ \S+ etl\.check ERROR FALHOU: ", "", l.strip()) for l in open(a) if "FALHOU:" in l})
agora, antes = falhas(sys.argv[1]), falhas(sys.argv[2])
print("SIMULADO. invariantes quebradas depois do fluxo da central (banco admin_coleta_r1) contra as do passo 09")
for f in agora: print("  -", f)
print("iguais às do passo 09:", "sim" if agora == antes else "NÃO")
print("RESULTADO:", "IGUAL_PASSO_09=" + ("sim" if agora == antes else "nao"))
PY
sed 's/^/    /' "$(T 15-check-conferencia)"
conf "o check depois do fluxo da central quebra as mesmas invariantes que no passo 09 (o município e a recoleta não quebraram nada novo)" grep -q 'RESULTADO: IGUAL_PASSO_09=sim' "$(T 15-check-conferencia)"
conf "a fila final tem a pendência de AM e não tem a do município (decidida)" python3 - "$(J 15-fila)" "$PEND_AM" "$PEND_MUN" <<'PY'
import json, sys
ids = [p["id"] for p in json.load(open(sys.argv[1]))]
print("  pendências abertas:", len(ids))
assert sys.argv[2] in ids and sys.argv[3] not in ids, ids
PY
fecha_ultimo
