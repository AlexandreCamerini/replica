# Reverificação de segurança: correções da F3 (`6423ef8`, `ab3ebb5`)

Data: 17/11/2026. Reverificador independente (Opus). Objeto: os achados A1 a A13 de `verificacao/f3-opus.md` e o que AC-28 diz ter feito. Tudo conferido no código e rodando; nada aceito por relato.

## 0. Método e ambiente

- Build NOVO do projeto admin a partir do HEAD `ab3ebb5`: `ADMIN_CENTRAL=producao NEXT_DIST_DIR=.next-reverif2 next build` (compilou; `web/tsconfig.json` restaurado do HEAD em seguida). Os ataques HTTP rodaram contra esse build, não contra o `.next-admin-prod` da equipe.
- Infra própria em `$TMPDIR/rv`, tudo em 127.0.0.1:
  - Supabase falso que registra cada requisição (`/auth/v1/user`, `/otp`, `/verify`, `/factors/*`), com atraso configurável;
  - proxy TLS para o Postgres (responde `S` ao SSLRequest), para `sslmode=require` chegar a `admin_coleta_c7`;
  - sessões montadas à mão no cookie `sb-admin-central-auth-token` (JWT com `aal1`/`aal2`, fatores verificados e não verificados).
- Seed em `admin_coleta_c7`: `admin@x.test` (com `user_id`) e `semfator@x.test`. Ficaram lá.
- `next start` com `ADMIN_CENTRAL=producao VERCEL_ENV=production AUTH_PROVIDER=supabase`, Host `admin.segueovoto.com.br`.
- ETL: script próprio com sockets reais (servidor que redireciona, servidor "interno", backend que registra onde o socket conecta de fato).
- Regressão:
  - `sem-navegador.mjs --sem-build`: rc 0, 264 ok, 0 falha. Avisos: só o TRACE e dois limites de navegador. A evidência foi restaurada do HEAD.
  - `npm run test:unit`: 235 passaram.
  - ETL (`test_sapl`, `test_assembleias`, `test_http_fetch`, `test_http_rede_segura`, `test_admin_rede_segura`): 126 passaram, 1 pulado (`ale.sp ainda não rodou`, que não tem relação com a correção).
- `git status` ao fim: nenhum arquivo rastreado alterado. Sobrou a pasta não rastreada `web/.next-reverif2/`: a remoção foi negada pela permissão; apague à mão.

## 1. Itens de aceite obrigatórios da A1

### (a) Actions públicas no build admin: PASSA

- Os 10 ids de action do `server-reference-manifest.json` do build foram enviados assim:
  - caminhos: `/`, `/admin`, `/admin/fila`, `/admin/entrar`, `/entrar`, `/conta` e `/admin/api/entrar/codigo`;
  - corpos: `text/plain`, multipart e urlencoded;
  - sem cookie e com cookie de admin `aal2`.
- Também foi enviado o formulário sem JS: multipart com `$ACTION_ID_<id>` no corpo e sem `Next-Action`.
- Total: 490 pedidos. Todos deram 404 com corpo de no máximo 9 B. O Supabase falso recebeu 0 chamadas.
- As actions não rodam nem pelos desvios de caixa (seção 3, N1): `/ADMIN`, `/Admin/fila`, `/ADMIN/entrar`, `/_NEXT/STATIC/x`, `/_Next/static/x` → 404 `{}`, 0 chamadas ao provedor.
- Prova principal, estrutural: a resposta é o 404 de 9 B do servidor de estáticos (destino do rewrite) ou o 404 de 0 B do middleware. As duas saem antes de qualquer código da aplicação, e não dependem de o corpo chegar ao campo `email`.
- Controle positivo do mesmo roteiro, no build do site (`.next`, sem `ADMIN_*`): `POST /conta` com `Next-Action` = id de `signOut`, `text/plain`, corpo `[]`. Resposta 303 `text/x-component` com `x-action-redirect: /no-seu-bolso;push`: a action executou. Portanto o roteiro dispara actions, e os 404 no build admin são recusa de fato.

### (b) Superfície pública com Host `admin.`: REPROVADO (por N1)

`/ADMIN`, `/aDmin`, `/Admin/fila` e `/_NEXT/STATIC/x` servem o `not-found` público na origem da central, que é o que o item proíbe. O resto passa.

- Respondem 404 de 9 B ("Not Found"), com XFO e CSP mínima:
  - `/`, `/entrar`, `/conta`, `/api/me`, `/api/places`;
  - `/_next/data/<BUILD_ID>/index.json`;
  - `/_next/image?url=…` (local e camara.leg.br);
  - as rotas OG `/p/x/opengraph-image` e `/proposta/x/opengraph-image` (e a variante com hash);
  - `/robots.txt`, `/sitemap.xml`, `/_not-found`, `/nao-existe`;
  - os arquivos de `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`);
  - `/geo/uf/99.json`, `/geo/`;
  - o próprio destino `/_next/static/admin-central-fora-do-escopo`;
  - HEAD, OPTIONS, PUT, DELETE, PATCH e TRACE em `/` e `/api/me`, e as requisições RSC.
- Servidos, como previsto: `/geo/br.json`, `/geo/uf/35.json` (também com `?x=1`) e `/favicon.ico`.
- Ataques ao regex `FORA_DA_CENTRAL`:

  | Entrada | Resultado |
  | --- | --- |
  | `/adminx`, `/admin-x`, `/%2561dmin`, `/./entrar` | 404 de 9 B |
  | `/_next/static/../../entrar`, `/_next/static/..%2F..%2Fentrar`, `/_next/static%2F..%2F..%2Fentrar`, `/_next/static/chunks/../../../conta` | 404 de 9 B |
  | `/geo/br.json/../../entrar`, `/geo/uf/35.json%2F..%2F..%2Fentrar`, `/favicon.ico/..%2Fentrar`, `/geo/uf/35.json/../../../file.svg` | 404 de 9 B |
  | `/admin%2Ffila`, `/admin%2F..%2Fconta`, `/admin/../entrar`, `/admin/..%2Fentrar`, `/%61dmin/fila`, `/admin.json`, `/admin.rsc` | 404 sem corpo, pelo middleware |
  | `/ADMIN`, `/aDmin`, `/ADMIN/fila`, `/Admin/fila`, `/_NEXT/STATIC/x` | FURO: 404 com a página `not-found` PÚBLICA (22,7 KB, layout e navegação do site, 19 `<script>` do bundle público, só a CSP mínima). Ver N1. |
  | `//admin`, `//admin/fila`, `///entrar`, `/admin/fila//` | 308 sem cabeçalhos, corpo de 6 a 12 B, sem conteúdo (N3) |

### (c) Build do site sem `ADMIN_*` igual em comportamento: PASSA

- Comparei `.next-base` (build anterior às correções) com `.next` (site, 13:17, ANTERIOR ao commit `ab3ebb5` de 13:23, portanto não é rigorosamente o HEAD) e com o meu `.next-reverif2` (build fresco do HEAD no modo admin).
- As actions públicas, comparadas por arquivo, nome, workers e layer, são as mesmas em `.next-base` e `.next-reverif2`. São as mesmas também nos dois tipos de build, então a prova vale para o site no HEAD.
- Config efetivo (`required-server-files.json` → `config`):
  - `.next-base` contra `.next`: só `distDir` difere (efeito de `NEXT_DIST_DIR`);
  - `.next-base` contra o admin: `distDir`, `skipTrailingSlashRedirect` e `_originalRewrites`;
  - `experimental` idêntico (inclusive `caseSensitiveRoutes: false`).
- Não construí o site no HEAD exato. A diferença de código entre 13:17 e o commit não foi medida.
- Rotas: as mesmas 76 mais as 4 `/admin/api/entrar/*`.
- Rewrites vazios, `headers` vazio, `redirects` `['/:path+/']` igual (o 308 de barra final continua no site), matcher do middleware idêntico (`/admin`, `/admin/:path*`).
- Actions públicas: o id muda a cada build (hash do build), então comparei por arquivo, nome exportado, workers e layer. As 10 públicas são idênticas antes e depois, e idênticas entre site e admin. As 4 de `lib/admin/entrada.ts` sumiram.
- `configuracao({})` devolve `{distDir, images}` com os mesmos valores do `next.config.ts` de `5148ddd`/`bac5340`.

## 2. Achados A1 a A13

| Achado | Estado | Prova |
| --- | --- | --- |
| A1 site público na origem da central | NÃO FECHADO (bloqueia a F4 até N1) | (a) e (c) passam; (b) reprovado por N1; N2 é pré-condição da F4. |
| A2 redirecionamento contorna o anti-SSRF | CORRIGIDO | Ver abaixo. |
| A3 enumeração por tempo | PARCIAL | `codigo` corrigido; `verificar` vaza com provedor lento (N4). |
| A4 fator `unverified` com verificado existente | CORRIGIDO | Ver abaixo. |
| A5 Turnstile na CSP de toda a central | CORRIGIDO | Ver abaixo. |
| A6 gatilho por nome de papel | ABERTO (anotado) | `0156` sem mudança; a regra do runbook continua necessária. |
| A7 executor confere admin por nome | CORRIGIDO | Com `por_email`, só e-mail; sem ele, só nome (`executor.py`, diff de `6423ef8`); teste novo em `test_admin_pedidos.py`. |
| A8 admin sem `user_id` | ABERTO (anotado) | Pré-requisito da F4, sem mudança. |
| A9 cabeçalhos em 308 e TRACE | PARCIAL | Ver abaixo. |
| A10 colisão de nome de cookie | CORRIGIDO | Ver abaixo. |
| A11 container sem init | CORRIGIDO NO CÓDIGO | `ENTRYPOINT ["tini","--","civico-etl"]`, `tini` via apt. Imagem não construída (sem daemon Docker). |
| A12 IPv4 não canônico | CORRIGIDO | `0`, `127.1`, `2130706433`, `0x7f000001` recusados no gancho; `127.0.0.1.` não resolve aqui e, se resolver, o backend confere o IP resolvido. |
| A13 actions públicas em `/admin/*` | CORRIGIDO | Item (a). |

### Rotas `/admin/api/entrar/*` (nenhuma server action roda na central)

- CSRF no `codigo`:
  - sem Origin, Origin `www`, `text/plain`, `Sec-Fetch-Site: same-site` e sem `Sec-Fetch-Site` → 403;
  - Host `x.vercel.app` → 404;
  - o provedor não foi chamado em nenhum desses casos.
- Tempo do `codigo`: 1508 a 1532 ms para admin, não admin e inexistente, com provedor de 50 ms e de 2,5 s. Corrigido.
- Conta para não admin:
  - não admin e inexistente: 0 requisições a `/otp` e `/verify`;
  - admin: corpo do `/otp` com `create_user:false` e `captcha_token`.
- Fator:
  - `iniciar`/`confirmar` sem sessão → 404; de não admin → 404;
  - `confirmar` já em `aal2` → 200 `{proximo:"/admin"}`.
- Middleware: qualquer `Next-Action` ou POST multipart/urlencoded → 404, inclusive com sessão de admin (item 1(a)).
- Não admin com sessão válida recebe 404 com um corpo de 14,8 KB (página "Não consta", 2 hrefs, sem layout público). Antes, o mesmo teste dava 0 B só porque o build antigo lia outro nome de cookie e barrava no middleware. Não é regressão.

### A2: CORRIGIDO

Prova com sockets reais. O IP público falso é desviado para um servidor local que responde 302; um servidor "interno" conta os acessos.

| Destino do 302 | Resultado |
| --- | --- |
| `http://127.0.0.1:porta` | `DestinoInterno`, 0 acesso ao interno |
| `169.254.169.254` | `DestinoInterno`, 0 acesso |
| `[::1]`, `[0:0:0:0:0:0:0:1]` | `DestinoInterno`, 0 acesso |
| `[::ffff:127.0.0.1]`, `[::ffff:7f00:1]` | `DestinoInterno`, 0 acesso |
| nome com IP público e privado | `DestinoInterno`, 0 acesso |
| nome que resolve para `::1`, para v4 mapeado ou para NAT64 | `DestinoInterno`, 0 acesso |
| CGNAT `100.64.0.1`, ULA `fd00::1` | `DestinoInterno`, 0 acesso |
| rebinding (1ª resolução pública, 2ª 127.0.0.1) | passa no gancho, barrado pelo `_BackendSeguro` |
| rebinding direto no 1º salto | barrado pelo `_BackendSeguro` |

- Controle positivo: o socket conecta no IP CONFERIDO (`93.184.216.34`, registrado no backend), não no nome.
- Coletores legítimos: os testes de caracterização passam.

### A4: CORRIGIDO

- Sessão `aal1` de admin com fator `fv` verificado e `fu` não verificado, enviando `fatorId=fu`: o provedor só recebeu `/factors/fv/challenge` e `/factors/fv/verify`.
- Sem fator verificado (primeiro cadastro): `fu3` é usado. É o TOFU, limite registrado.
- `iniciar` com fator verificado → 409; não admin → 404; sem sessão → 404.

### A5: CORRIGIDO

- `/admin` e `/admin/fila` como admin `aal2`: a CSP não cita `challenges.cloudflare.com`.
- `/admin/entrar` cita.

### A9: PARCIAL

- Com sessão de admin, `/admin/fila/`, `/admin/` e `/admin/api/fila/` → 200 com a CSP completa (com nonce): a barra final passa pelo middleware.
- Sem sessão, as mesmas → 404 sem corpo e com CSP completa. Não abre caminho sem middleware.
- O 404 do rewrite tem XFO e CSP mínima.
- Continuam sem cabeçalho:
  - o 308 de barra dupla (`//admin`, `/admin/fila//`; N3);
  - o 500 do TRACE (seção 4).

### A10: CORRIGIDO

- Sessão de admin `aal2` no cookie `sb-127-auth-token` ou `sb-<ref>-auth-token` → 404.
- Cookie da central de não admin mais cookie do site de admin → 404.
- A central só lê `sb-admin-central-auth-token`.

## 3. Achados novos

### N1. BLOQUEIA (F4): caminhos em maiúsculas escapam do rewrite e renderizam o `not-found` público (reprova A1(b))

- Onde:
  - `web/next.config.ts:16`, `FORA_DA_CENTRAL`;
  - `web/next.config.ts:33-34`, rewrite sem `experimental.caseSensitiveRoutes`.
- Por quê:
  - `caseSensitiveRoutes` é `false` por padrão (`next/dist/server/config-shared.js:148`);
  - `buildCustomRoute(..., sensitive: caseSensitive)` compila o regex do rewrite com flag `i` (`router-utils/filesystem.js:94-109`; no build, `caseSensitive: false` vai ao `routes-manifest`);
  - com `i`, a exceção `(?!admin(?:/|$)|_next/static/|…)` também casa `ADMIN`, `Admin` e `_NEXT/STATIC/`, e o caminho NÃO é reescrito;
  - o middleware (matcher sensível a caixa) não roda, e o roteador do app não acha rota;
  - resultado: o `not-found.tsx` do site, 22,7 KB.
- Cenário:
  - `GET https://admin.segueovoto.com.br/ADMIN` (ou `/Admin/x`, `/_NEXT/STATIC/x`) serve HTML do site na origem da central;
  - leva os links de navegação pública e 19 scripts do bundle público, com só `frame-ancestors 'none'` (sem `script-src`).
  - Não executa action (conferido: 404 `{}`, 0 chamada ao provedor) e não mostra dado.
  - Mas é exatamente a "página pública/not-found" que o aceite exige fora. Qualquer defeito de cliente do layout público (hoje ou futuro) roda na origem da central.
- Correção, uma linha no ramo do projeto admin: `experimental: { caseSensitiveRoutes: true }`.
  - Com isso `/ADMIN` deixa de casar a exceção e vai ao 404 de 9 B.
  - O Vercel recebe `caseSensitive: true` pelo `routes-manifest`.
  - Teste: `/ADMIN`, `/aDmin/fila`, `/_NEXT/STATIC/x` → 404 de no máximo 9 B; `/admin/fila` continua 200 para admin.
  - Alternativa: listar as variantes no regex com classes `[aA]…`; frágil.

### N2. CORRIGIR antes da F4 (risco, não verificável aqui): o 404 "de 9 B" é comportamento do `next start`, não da Vercel

- Onde: `web/next.config.ts:22` (`DESTINO_404 = /_next/static/admin-central-fora-do-escopo`).
- O comentário admite que o 404 limpo depende de o servidor de estáticos do Next responder "Not Found". Na Vercel, `/_next/static/*` é servido pela CDN; um arquivo inexistente cai na rota de erro da plataforma, que em App Router costuma ser a página `/_not-found`/404 do próprio app, ou seja, o `not-found` público.
- Ninguém provou o comportamento na borda real.
- Não reabre a execução de action (N1 mostra que a action em rota inexistente dá 404), mas pode reabrir o vazamento de página pública da A1(b) em produção.
- Correção:
  - (i) provar num Preview do projeto admin (o Preview tem a central fechada, mas o rewrite e o 404 já valem), com `curl -i` nas mesmas sondas da seção 1(b);
  - e/ou (ii) defesa na borda, independente do Next: regra do Vercel Firewall no projeto admin, "caminho NÃO começa com `/admin` nem `/_next/static/` e não é `/geo/br.json`, `/geo/uf/*.json`, `/favicon.ico` → deny".
  - A regra (ii) também fecha N1 e N3, e permite bloquear TRACE (seção 4).

### N3. ANOTAR: 308 de normalização de barra dupla sem cabeçalhos

- Evidência:
  - `//admin`, `//admin/fila`, `///entrar` e `/admin/fila//` → 308 (`Location` com uma barra só), corpo de 6 a 12 B, sem CSP/XFO/Referrer-Policy;
  - o destino depois do 308 é tratado normalmente (rewrite ou middleware).
- É o redirecionamento de barras repetidas do roteador do Next, que roda antes de `headers()`. O `skipTrailingSlashRedirect` não o cobre.
- Sem conteúdo e sem dado. Fecha com a regra de borda de N2(ii), se quiserem "toda resposta com cabeçalho".

### N4. CORRIGIR: `verificar` ainda vaza admin por tempo quando o provedor passa de 1,5 s, e queima tentativas de OTP do admin

- Onde: `web/src/lib/admin/entrada.ts:61-84` (`verificarCodigo` usa `completarAte`, que só garante o mínimo).
- Evidência (Supabase falso):

  | Provedor | Admin | Não admin e inexistente |
  | --- | --- | --- |
  | 50 ms | 1510 a 1516 ms | 1508 a 1532 ms (iguais) |
  | 2,5 s | 2518 ms | 1508 a 1509 ms |

- O cookie `adm_entrar_email` que habilita `verificar` é dado por `codigo` para QUALQUER e-mail, então o atacante escolhe o e-mail a testar.
- Efeitos:
  - (1) com o Supabase lento (pico, incidente), dá para enumerar admins;
  - (2) cada `verificar` com código aleatório para e-mail de admin chega ao `/verify` real e consome o limite de ritmo do Supabase, que vê o IP da Vercel. Isso trava o login do admin legítimo (o limite de ritmo da aplicação continua ausente, e a AC-28 o registra).
- Correção:
  - envolver `verifyOtp` num prazo menor que o piso, ou subir o piso de `verificar` (ex.: 3 s) e cortar com `comPrazo(piso - margem)`;
  - estourou = "código inválido" no piso, para a latência nunca passar do piso.
  - Para (2): limite por e-mail/IP fora do banco (KV/Edge Config) ou Turnstile verificado no servidor antes de `verifyOtp`.
- Severidade: corrigir, não bloqueia. A resposta é neutra e o vazamento exige provedor lento.

### N5. ANOTAR: a correção da A2 desliga silenciosamente o proxy do ambiente (o texto da AC-28 está errado)

- Onde: `etl/civico_etl/http.py:153-160` (`_novo_cliente` passa `transport=` explícito).
- No httpx 0.28, `allow_env_proxies = trust_env and transport is None`. Com `transport` explícito, `HTTP(S)_PROXY` é IGNORADO.
- Provado: com `HTTP_PROXY`/`HTTPS_PROXY` apontando para um proxy local, `_mounts` = `{}` e o proxy recebeu 0 requisições. A conexão foi direta e o `_BackendSeguro` barrou o interno.
- Segurança: fica mais estrito, não mais frouxo.
- Mas:
  - (i) o docstring (`http.py:88`, `:143`) e a AC-28 ("com proxy, só o gancho") descrevem um comportamento que não existe;
  - (ii) é mudança de comportamento para todo coletor: um ambiente que dependa de proxy de saída quebra na rede.
- Correção: ajustar o texto. Se um dia houver proxy, tratar explicitamente (montar o proxy com o backend seguro ou recusar).
- Sem uso de proxy hoje no repositório (`git grep`).

### N6. ANOTAR: Turnstile não é verificado no servidor da central

- O token vai ao Supabase como `captcha_token` (visto no corpo do `/otp`: `gotrue_meta_security.captcha_token`). Só vale se o captcha estiver ligado no projeto Supabase.
- Sem isso, `codigo` dispara e-mail de OTP ao admin sem limite da aplicação (incômodo, e consumo da cota de e-mail).
- Correção:
  - conferir no runbook da F4 que o captcha está ligado no Supabase;
  - ou verificar o token no servidor (`siteverify`) antes de `adminAtivo`.

## 4. TRACE (500 sem cabeçalhos em `/admin/*` no projeto admin)

- Medido no build admin, com e sem sessão: `TRACE /admin/fila` → 500, página de erro genérica do Next (2140 B), sem CSP, XFO ou Referrer-Policy. Nem os `headers()` do config entram.
- Fora de `/admin` o TRACE já dá 404 de 9 B com cabeçalhos (o rewrite age antes).
- Risco para a internet: baixo.
  - Não ecoa a requisição (não é XST: o corpo não reflete cabeçalho nem cookie, e navegadores não enviam TRACE).
  - Não executa código da central e não mostra dado.
  - Revela só que `/admin/*` é tratado de forma diferente, o que o 404 com CSP completa já revela.
  - A falta de XFO num 500 sem conteúdo interativo não habilita clickjacking útil.
  - Classifico ANOTAR, não bloqueia.
- Correção simples que a equipe não considerou: não precisa de servidor custom. Uma regra do Vercel Firewall (ou WAF) no projeto admin: "método TRACE ou TRACK → deny" (403/404 na borda, antes da função).
  - Custa uma regra de configuração e fecha o caso na internet.
  - A mesma regra de borda de N2(ii) pode carregar isso.
  - Muitos CDNs já recusam TRACE na borda; não verifiquei o comportamento da Vercel.

## 5. O que NÃO foi verificado

- Comportamento real na Vercel: rotas da CDN para o destino do rewrite (N2), caixa de caminho na borda, TRACE na borda, `VERCEL_ENV` real.
- GoTrue real: se cadastrar fator novo com fator verificado exige `aal2`, captcha, limites de `/otp` e `/verify`. Meus fatores e respostas são falsos.
- Opções reais de `Set-Cookie` numa renovação de sessão (o Supabase falso não renova).
- A correção de N1 (`caseSensitiveRoutes`): não a apliquei nem a construí. A recomendação vem da leitura de `filesystem.js`/`build/index.js` do Next 15.5.28; precisa de build e teste.
- Imagem Docker (`tini`): sem daemon.
- Banco depois dos ataques de action: o servidor dos ataques de action apontava para um banco inalcançável e o provedor recebeu 0 chamadas; no `admin_coleta_c7`, `adm_pedidos`=4 e `adm_pedidos_decisao`=1 antes e depois da rodada positiva.
