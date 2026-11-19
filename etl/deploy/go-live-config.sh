#!/usr/bin/env bash
# Go-live de www.segueovoto.com.br: o que falta configurar fora do repositório, por API, com confirmação antes de cada escrita.
#
#   bash etl/deploy/go-live-config.sh              # as três etapas
#   bash etl/deploy/go-live-config.sh --diagnostico # só a etapa 1 (não escreve nada)
#
# Etapas:
#   1. Diagnóstico do DNS e do HTTPS do SEU lado. Compara o resolvedor do seu Mac com o Google e a Cloudflare (DNS sobre HTTPS).
#      Se só o seu falha, é cache (do Mac, do roteador ou do provedor de internet), não o site. Oferece limpar o cache do Mac (pede sudo).
#   2. Supabase Auth (projeto bigdata): Site URL = https://www.segueovoto.com.br e o www/apex nas Redirect URLs.
#      Usa a API de gestão do Supabase com um token pessoal (supabase.com/dashboard/account/tokens).
#   3. Turnstile (Cloudflare): acrescenta www.segueovoto.com.br e segueovoto.com.br aos hostnames do widget de produção.
#      Usa um token da Cloudflare com a permissão "Account > Turnstile > Edit".
#
# Segurança: tokens digitados com eco desligado, passados ao curl pela entrada padrão (nunca em argv nem em arquivo) e
# esquecidos no fim. Cada escrita mostra o antes e o depois e só acontece com "s". Nada é apagado: as listas só ganham itens.
# Volta: a etapa 2 imprime o Site URL anterior; a etapa 3 só acrescenta hostnames (remover é no painel da Cloudflare).
set -euo pipefail

DOMINIO="segueovoto.com.br"
WWW="www.$DOMINIO"
SITE="https://$WWW"
SUPABASE_REF="${SUPABASE_REF:-slbowraanqdvebrnegvk}"

if [[ -t 1 ]]; then B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; G=$'\e[32m'; Y=$'\e[33m'; E=$'\e[31m'; else B=; D=; R=; G=; Y=; E=; fi
etapa() { printf '\n%s▸ %s%s\n' "$B" "$1" "$R"; }
ok()    { printf '  %s✓%s %s\n' "$G" "$R" "$1"; }
aviso() { printf '  %s⚠ %s%s\n' "$Y" "$1" "$R"; }
falha() { printf '  %s✗ %s%s\n' "$E" "$1" "$R"; }
nota()  { printf '  %s%s%s\n' "$D" "$1" "$R"; }
sim()   { local r=""; printf '  %s? %s [s/N] %s' "$Y" "$1" "$R"; read -r r || true; [[ "$r" =~ ^[sSyY] ]]; }
segredo() { local v=""; printf '  %s%s%s ' "$B" "$1" "$R"; read -rs v || true; printf '\n'; printf -v "$2" '%s' "$v"; }
abrir() { nota "abra: $1"; command -v open >/dev/null 2>&1 && open "$1" >/dev/null 2>&1 || true; }

for c in curl python3 dig; do command -v "$c" >/dev/null || { falha "$c não encontrado"; exit 1; }; done

# api METODO URL TOKEN [JSON]: chamada autenticada; o token vai pela entrada padrão do curl (-K -), nunca em argv.
api() {
  local metodo="$1" url="$2" token="$3" corpo="${4:-}"
  local cfg="header = \"Authorization: Bearer $token\""
  if [[ -n "$corpo" ]]; then
    printf '%s\nheader = "Content-Type: application/json"\ndata = %s\n' "$cfg" "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$corpo")" \
      | curl -sS -m 30 -X "$metodo" -K - -w '\n%{http_code}' "$url"
  else
    printf '%s\n' "$cfg" | curl -sS -m 30 -X "$metodo" -K - -w '\n%{http_code}' "$url"
  fi
}
corpo_de() { sed '$d' <<<"$1"; }
status_de() { tail -n1 <<<"$1"; }

# ─── 1. Diagnóstico ───────────────────────────────────────────────────────────────────────────────────────────────────
diagnostico() {
  etapa "1/3 · DNS e HTTPS do seu lado"
  local local_www doh_google doh_cf
  local_www="$(dig +short A "$WWW" 2>/dev/null | tr '\n' ' ')"
  doh_google="$(curl -sS -m 10 "https://dns.google/resolve?name=$WWW&type=A" 2>/dev/null | python3 -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer",[]) if a.get("type")==1))' 2>/dev/null || true)"
  doh_cf="$(curl -sS -m 10 -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$WWW&type=A" 2>/dev/null | python3 -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer",[]) if a.get("type")==1))' 2>/dev/null || true)"
  nota "seu Mac:    ${local_www:-(nada)}"
  nota "Google:     ${doh_google:-(nada)}"
  nota "Cloudflare: ${doh_cf:-(nada)}"
  local codigo
  codigo="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$SITE/" 2>/dev/null || true)"
  if [[ -n "$doh_google$doh_cf" && -z "$local_www" ]]; then
    falha "O domínio já resolve na internet, mas não no seu Mac: é cache de DNS (do Mac, do roteador ou do provedor)."
    nota "O provedor guarda a resposta antiga (domínio sem endereço) até o prazo vencer, em geral algumas horas."
    if sim "Limpar o cache de DNS do Mac agora? (pede a sua senha de administrador do Mac)"; then
      sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder && ok "cache do Mac limpo"
      local depois; depois="$(dig +short A "$WWW" 2>/dev/null | tr '\n' ' ')"
      if [[ -n "$depois" ]]; then ok "agora o Mac resolve: $depois"; else
        aviso "o Mac ainda não resolve: o cache é do roteador ou do provedor. Opções: esperar, reiniciar o roteador, ou usar 1.1.1.1/8.8.8.8 em Ajustes do Sistema > Rede > Detalhes > DNS."
      fi
    fi
  elif [[ -z "$doh_google$doh_cf" ]]; then
    falha "Nem o Google nem a Cloudflare resolvem $WWW: o problema não é cache. Confira os servidores DNS no registro.br (ns1/ns2.vercel-dns.com)."
  else
    ok "$WWW resolve no seu Mac e na internet"
  fi
  case "$codigo" in
    200) ok "$SITE/ responde 200 (HTTPS válido)" ;;
    000) falha "$SITE/ não conecta daqui (DNS ou certificado). Se o DNS do Mac falhou acima, é isso." ;;
    *)   aviso "$SITE/ respondeu $codigo" ;;
  esac
  codigo="$(curl -sS -m 20 -o /dev/null -w '%{http_code} %{redirect_url}' "https://$DOMINIO/" 2>/dev/null || true)"
  [[ "$codigo" == "308 $SITE/" ]] && ok "https://$DOMINIO/ redireciona para o www" || aviso "https://$DOMINIO/ respondeu: ${codigo:-nada}"
}

# ─── 2. Supabase Auth ─────────────────────────────────────────────────────────────────────────────────────────────────
# lista_redirect "atual" -> nova lista separada por vírgula, com o www e o apex, sem repetir e sem tirar nada
lista_redirect() {
  python3 - "$1" "$SITE" "https://$DOMINIO" <<'PY'
import sys
atual = [x.strip() for x in sys.argv[1].split(",") if x.strip()]
for base in sys.argv[2:]:
    for item in (base + "/**",):
        if item not in atual:
            atual.append(item)
print(",".join(atual))
PY
}

supabase() {
  etapa "2/3 · Supabase Auth: Site URL e Redirect URLs"
  nota "Crie um token pessoal em Supabase > Account > Access Tokens (nome: go-live; pode apagar depois)."
  abrir "https://supabase.com/dashboard/account/tokens"
  local token=""; segredo "Cole o token do Supabase (não aparece na tela):" token
  [[ -n "$token" ]] || { aviso "sem token: etapa pulada"; return 0; }
  local r; r="$(api GET "https://api.supabase.com/v1/projects/$SUPABASE_REF/config/auth" "$token")"
  if [[ "$(status_de "$r")" != 200 ]]; then falha "Supabase respondeu $(status_de "$r"): $(corpo_de "$r" | head -c 200)"; token=""; return 1; fi
  local site_atual lista_atual nova
  site_atual="$(corpo_de "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("site_url") or "")')"
  lista_atual="$(corpo_de "$r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uri_allow_list") or "")')"
  nova="$(lista_redirect "$lista_atual")"
  nota "Site URL atual:      ${site_atual:-(vazio)}"
  nota "Site URL novo:       $SITE"
  nota "Redirect URLs atual: ${lista_atual:-(vazio)}"
  nota "Redirect URLs nova:  $nova"
  if [[ "$site_atual" == "$SITE" && "$lista_atual" == "$nova" ]]; then ok "já está certo"; token=""; return 0; fi
  if sim "Gravar no Supabase?"; then
    local corpo; corpo="$(python3 -c 'import json,sys; print(json.dumps({"site_url": sys.argv[1], "uri_allow_list": sys.argv[2]}))' "$SITE" "$nova")"
    r="$(api PATCH "https://api.supabase.com/v1/projects/$SUPABASE_REF/config/auth" "$token" "$corpo")"
    if [[ "$(status_de "$r")" == 200 ]]; then ok "Supabase Auth atualizado (volta: Site URL anterior era ${site_atual:-vazio})"; else falha "Supabase respondeu $(status_de "$r"): $(corpo_de "$r" | head -c 200)"; fi
  fi
  token=""
}

# ─── 3. Turnstile ─────────────────────────────────────────────────────────────────────────────────────────────────────
# corpo_widget "json do widget" -> corpo do PUT com os hostnames acrescentados e os campos editáveis preservados
corpo_widget() {
  python3 - "$1" "$WWW" "$DOMINIO" <<'PY'
import json, sys
w = json.loads(sys.argv[1])
dominios = list(w.get("domains") or [])
for d in sys.argv[2:]:
    if d not in dominios:
        dominios.append(d)
editaveis = ("name", "mode", "bot_fight_mode", "clearance_level", "ephemeral_id", "offlabel", "region")
corpo = {k: w[k] for k in editaveis if k in w}
corpo["domains"] = dominios
print(json.dumps(corpo))
PY
}

turnstile() {
  etapa "3/3 · Turnstile: hostnames do domínio no widget"
  nota "Crie um token em Cloudflare > My Profile > API Tokens > Create Custom Token, com a permissão Account > Turnstile > Edit."
  abrir "https://dash.cloudflare.com/profile/api-tokens"
  local token=""; segredo "Cole o token da Cloudflare (não aparece na tela):" token
  [[ -n "$token" ]] || { aviso "sem token: etapa pulada"; return 0; }
  local r contas conta
  r="$(api GET "https://api.cloudflare.com/client/v4/accounts?per_page=50" "$token")"
  [[ "$(status_de "$r")" == 200 ]] || { falha "Cloudflare respondeu $(status_de "$r"): $(corpo_de "$r" | head -c 200)"; token=""; return 1; }
  contas="$(corpo_de "$r" | python3 -c 'import json,sys; [print(a["id"], a["name"]) for a in json.load(sys.stdin)["result"]]')"
  if [[ "$(wc -l <<<"$contas")" -gt 1 ]]; then nota "contas:"; nl -w2 -s'. ' <<<"$contas" | sed 's/^/    /'; local n; printf '  conta (número): '; read -r n; conta="$(sed -n "${n}p" <<<"$contas" | cut -d' ' -f1)"; else conta="$(cut -d' ' -f1 <<<"$contas")"; fi
  [[ -n "$conta" ]] || { falha "nenhuma conta"; token=""; return 1; }
  r="$(api GET "https://api.cloudflare.com/client/v4/accounts/$conta/challenges/widgets?per_page=50" "$token")"
  [[ "$(status_de "$r")" == 200 ]] || { falha "Cloudflare respondeu $(status_de "$r"): $(corpo_de "$r" | head -c 200)"; token=""; return 1; }
  local widgets; widgets="$(corpo_de "$r" | python3 -c 'import json,sys; [print(w["sitekey"], w["name"], ",".join(w.get("domains") or [])) for w in json.load(sys.stdin)["result"]]')"
  [[ -n "$widgets" ]] || { falha "nenhum widget Turnstile nesta conta"; token=""; return 1; }
  nota "widgets (site key, nome, hostnames):"; nl -w2 -s'. ' <<<"$widgets" | sed 's/^/    /'
  nota "Use o de produção do Segue o Voto (a site key pública é a do NEXT_PUBLIC_TURNSTILE_SITE_KEY de Production na Vercel)."
  local n; printf '  widget (número): '; read -r n
  local sitekey; sitekey="$(sed -n "${n}p" <<<"$widgets" | cut -d' ' -f1)"
  [[ -n "$sitekey" ]] || { falha "escolha inválida"; token=""; return 1; }
  r="$(api GET "https://api.cloudflare.com/client/v4/accounts/$conta/challenges/widgets/$sitekey" "$token")"
  [[ "$(status_de "$r")" == 200 ]] || { falha "Cloudflare respondeu $(status_de "$r")"; token=""; return 1; }
  local atual corpo
  atual="$(corpo_de "$r" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["result"]))')"
  corpo="$(corpo_widget "$atual")"
  nota "hostnames atuais: $(python3 -c 'import json,sys; print(", ".join(json.loads(sys.argv[1]).get("domains") or []))' "$atual")"
  nota "hostnames novos:  $(python3 -c 'import json,sys; print(", ".join(json.loads(sys.argv[1])["domains"]))' "$corpo")"
  if [[ "$(python3 -c 'import json,sys; print(sorted(json.loads(sys.argv[1]).get("domains") or [])==sorted(json.loads(sys.argv[2])["domains"]))' "$atual" "$corpo")" == True ]]; then ok "já está certo"; token=""; return 0; fi
  if sim "Gravar no widget?"; then
    r="$(api PUT "https://api.cloudflare.com/client/v4/accounts/$conta/challenges/widgets/$sitekey" "$token" "$corpo")"
    if [[ "$(status_de "$r")" == 200 ]]; then ok "Turnstile atualizado"; else falha "Cloudflare respondeu $(status_de "$r"): $(corpo_de "$r" | head -c 300)"; fi
  fi
  token=""
}

[[ "${GOLIVE_SO_FUNCOES:-}" == 1 ]] && return 0 2>/dev/null
printf '%sGo-live de %s%s\n' "$B" "$WWW" "$R"
diagnostico
[[ "${1:-}" == "--diagnostico" ]] && exit 0
supabase || true
turnstile || true
etapa "Fim"
nota "Teste o login em $SITE/entrar (código por e-mail). Se o widget anti-robô não carregar, a etapa 3 não foi gravada."
