# Reverificação de segurança v3: estado final da F3 (`af1ac92`, separação no build da AC-30)

Data: 17/11/2026. Verificador independente (Opus), de contexto limpo. Tudo foi conferido em builds construídos por mim a partir do HEAD e rodando; nada foi aceito por relato.

## Veredito da garantia central: ATENDE

A garantia testada tem três partes:

1. nenhuma resposta da origem da central contém HTML do site público;
2. nenhuma server action do site roda nela;
3. o build do site não contém a central nem middleware.

As três partes estão provadas na estrutura dos builds e por HTTP, com controles positivos. Seguem quatro ressalvas, nenhuma bloqueante: V1, V2, N3 e TRACE (seção 4).

## 0. Método

### Builds frescos do HEAD `af1ac92`

Todos rodaram com `DATA_SOURCE=demo`, `ALLOW_DEMO_DATA=1` e sem `ADMIN_*` nem `VERCEL*` herdados. `web/tsconfig.json` foi restaurado do HEAD depois de cada build.

| Build | Variável no build | Pasta | Resultado |
| --- | --- | --- | --- |
| Site | nenhuma | `web/.next-v3-site` | rc 0 |
| Central, modo produção | `ADMIN_CENTRAL=producao` | `web/.next-v3-admin` | rc 0 |
| Central, modo local | `ADMIN_CENTRAL=1` | `web/.next-admin-local` | rc 0; sobrescreveu a pasta da equipe, que o git ignora |

### Infraestrutura, toda em 127.0.0.1, em `$TMPDIR/v3`

- Supabase falso que registra cada requisição.
- Proxy TLS para o Postgres (`sslmode=require`), apontando para `admin_coleta_c7`.
- Sessões montadas à mão no cookie `sb-admin-central-auth-token`.
- Admins de teste semeados em `admin_coleta_c7`: `admin@x.test` (com `user_id`) e `semfator@x.test`.
- `next start` com `ADMIN_CENTRAL=producao`, `VERCEL_ENV=production` e `AUTH_PROVIDER=supabase`, sempre com Host `admin.segueovoto.com.br`.
- Requisições por socket cru: o caminho vai byte a byte, sem normalização do cliente.

### Controles positivos (o ataque aborta se qualquer um falhar)

| Controle | Resultado |
| --- | --- |
| `/admin/fila` com cookie `aal2` | 200, 13,9 KB, "Central de coleta" no corpo, `/auth/v1/user` no log do provedor falso |
| `/admin/fila` sem cookie | 404, 0 B |
| Action `signOut` do site, `POST /conta` no build do site | a action executou: pilha `Object.signOut`, resposta 500 `text/x-component` porque faltam as variáveis do Supabase. O roteiro dispara actions de verdade, então os 404 na central são recusa. |

## 1. Build do site (garantia, parte 3): PASSA

### Estrutura

- O `next build` não lista `Middleware`.
- `server/middleware-manifest.json` está vazio e não existe `server/middleware.js`.
- `app-paths-manifest`: 61 rotas, nenhuma com `admin`.
- Diferença para `.next-base` (build anterior à fase): só as 15 rotas `/(admin)/*`, que saíram.
- `required-server-files.config`:
  - igual ao de `.next-base` (só `distDir` difere);
  - `pageExtensions` padrão;
  - sem `skipTrailingSlashRedirect`;
  - `headers` e `rewrites` vazios.
- Server actions: 10, iguais por nome e workers às do `.next` da equipe: `alternarEscolhido`, `salvarUf`, `salvarEsferas`, `signOut`, `submitSuggestion`, `sendCode`, `updateDigest`, `verifyCode`, `toggleFollow`, `deleteAccount`.

### Strings da central em `server/` e `static/`: zero ocorrência de cada uma

`adm_pedidos`, `Central de coleta`, `exigirAdmin`, `sb-admin-central-auth-token`, `x-admin-entrada`, `/admin/api/`, `admin_central`, `admin.segueovoto`, `adm_admins`, `operadorAtual`, `Decidindo como`.

### HTTP no build do site

- `/admin`, `/admin/fila`, `/admin/entrar`, `/admin/api/entrar/codigo`, `/admin/api/estado` e `/ADMIN`, com GET e POST: 404 do `not-found` público ("Não consta"), sem corpo da central e sem CSP.
- `/` → 200, sem CSP e sem XFO, como antes.

## 2. Build da central: estrutura

- `app-paths-manifest`: 19 rotas `/(admin)/admin/*`, mais `/_not-found` e `/favicon.ico/route`, num total de 21.
  - Nenhum metadado do site (`icon`, `opengraph-image`, `robots`, `sitemap`, `manifest`).
  - `pageExtensions` filtra os `.tsx`/`.ts` de metadado; o `favicon.ico` entra como metadado estático, e é a exceção declarada.
- `server-reference-manifest`: 0 actions.
- `server/middleware.js` existe, com runtime `nodejs` e matcher `/(.*)` em `functions-config-manifest.json`. O `middleware-manifest` está vazio e o build não imprime a linha `Middleware`. O middleware age: está provado por HTTP.
- Marcas do site em `static/`: zero para "Segue o Voto", "Não consta", "O que está rolando", `acompanhando`, `como-funciona`, `Casco`, `sv-pg`, "No seu bolso" e os nomes das 10 actions.
- Marcas em `server/`, todas da própria central ou de biblioteca:
  - "Segue o Voto" só como `issuer:"Segue o Voto (central)"` do TOTP;
  - `sendCode` só como rótulo de log da entrada;
  - `signOut` só dentro do `@supabase/auth-js`.
- O CSS da central não tem classe `sv-`: o Tailwind expurga as não usadas. Não há "CSS do site na central" a anotar.
- `.next-admin-prod` da equipe, que o `sem-navegador` usa, tem as mesmas rotas, o mesmo matcher e 0 actions que o meu build fresco.

## 3. Ataque obrigatório (garantia, partes 1 e 2): PASSA

### Volume

- 198 caminhos × 6 formas × 2 estados de sessão = 2376 requisições.
  - Formas: GET, HEAD, POST JSON com Origin certo, GET `RSC: 1`, GET `RSC: 1` + `Next-Router-Prefetch: 1`, e GET só com `Next-Router-Prefetch: 1`.
  - Sessão: sem cookie e com cookie de admin `aal2`.
- Tabela completa: `$TMPDIR/v3/ataque.tsv`. Ela não está no repositório.

### Caminhos testados, além dos obrigatórios

- Cada um dos 33 arquivos de `web/public/`.
- Unicode: `/ａｄｍｉｎ`, `/admın`, `/ADMİN`, zero-width, Kelvin.
- `\`, `%5C`, `%2e%2e`, `%2F`, `;`, `%00` e `%0d%0a`.
- Sufixos `.rsc`, `.txt`, `.json` e `.html`, e `index`.
- `/_next/data/<BUILD_ID>/…`, `/_next/image` local e externo, `/_next/static/../..`.
- Request-target absoluto e `*`.
- `//evil.com` e variantes.
- Travessia depois de passar o middleware com cookie: `/admin/..%2Fp%2Fx%2Fopengraph-image`, `/admin/%2e%2e/robots.txt`, `/admin/..%2F..%2Fsitemap.xml` e outros.

### Resultado

- Respostas com marca do site: 0.
  - Marcas procuradas: "Segue o Voto", "Não consta", `sv-pg`, `sv-folio`, "O que está rolando", `acompanhando`, `como-funciona`, `(sv)`, `(v1)`, `/v2/`, `Casco`, "No seu bolso".
- Respostas com HTML que não é da central: 72. Todas são o `_error` padrão do Next ("405: Method Not Allowed", 2597 B) a POST em arquivo estático (`/geo/*.json`, SVG, `_buildManifest.js`), com CSP com nonce e XFO. É página do framework, sem conteúdo do site.
- Distribuição de status: 404: 1498; 200: 439; 308: 252; 405: 78; 400: 60; 500: 43; 307: 6.
- Os 200 fora de `/admin` são só:
  - as 28 malhas `/geo`, os 5 SVG e `/favicon.ico`;
  - `_buildManifest.js`/`_ssgManifest.js` do próprio build;
  - `/_next/data/<BUILD_ID>/admin.json` com cookie `aal2`. O Next normaliza esse caminho para `/admin`: a página da central passa pelo middleware e pela guarda, e sem cookie dá 404 com 0 B.
- Os 400 são caminhos Unicode, recusados pelo parser do Node.
- Os 500 são o `*` (21 B "Internal Server Error") e o V1, abaixo.

### Server actions do site na central

- 1080 POST:
  - os 10 ids do build do site;
  - 12 caminhos: `/`, `/admin`, `/admin/fila`, `/admin/entrar`, `/admin/api/entrar/codigo`, `/entrar`, `/conta`, `/ADMIN`, `/_next/static/x`, `/geo/br.json`, `/favicon.ico`, `//admin`;
  - 4 tipos de corpo, com e sem cookie;
  - formulário sem JS com `$ACTION_ID_<id>`.
- Respostas:
  - todas 404 com 0 B;
  - exceto `//admin`, que dá 308 de 6 B para `/admin`; lá o middleware dá 404.
- Efeito:
  - chamadas ao provedor: 0;
  - banco (`adm_pedidos`/`adm_pedidos_decisao`/`adm_admins_log`): 4/1/5 antes e 4/1/5 depois.

### Tabela dos caminhos obrigatórios

Cada célula é status:bytes. "sem" é sem cookie; "aal2" é com cookie de admin `aal2`. Nenhuma linha contém HTML do site.

| Caminho | GET sem / aal2 | HEAD | POST sem / aal2 | RSC:1 sem / aal2 | RSC+Prefetch sem / aal2 | Prefetch só, sem / aal2 | Contém HTML do site? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/`, `/entrar`, `/pessoas`, `/api/me`, `/api/places` | 404:0 / 404:0 | 404 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | não |
| `/ADMIN`, `/aDmin/fila`, `/_NEXT/STATIC/x`, `/%61dmin`, `/admin%2Ffila`, `/admin/../entrar` | 404:0 / 404:0 | 404 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | não |
| `/_next/image?url=/x&w=64&q=75`, `/_next/data/x/y.json` | 404:0 / 404:0 | 404 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | não |
| `/icon`, `/icon.png`, `/apple-icon`, `/opengraph-image`, `/p/x/opengraph-image`, `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/geo/../` | 404:0 / 404:0 | 404 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | 404:0 / 404:0 | não |
| `//admin` | 308:6 / 308:6 → `/admin` | 308 | 308:6 / 308:6 | 308:6 / 308:6 | 308:6 / 308:6 | 308:6 / 308:6 | não |
| `/admin//fila` | 308:11 / 308:11 → `/admin/fila` | 308 | 308:11 / 308:11 | 308:11 / 308:11 | 308:11 / 308:11 | 308:11 / 308:11 | não |
| `/admin/fila/` | 404:0 / 200:13883 (central) | 404/200 | 404:0 / 200 (central) | 404:0 / 200:7349 | 404:0 / 200:207 | 404:0 / 500:5444 (V1) | não |
| `/./admin`, `/admin/./fila` | 404:0 / 404:~5270 (not-found da central) | 404 | 404:0 / 404 (central) | 404:0 / 404:2629 | 404:0 / 404:166 | 404:0 / 500 (V1) | não |
| `/admin?_rsc=1` | 404:0 / 200:29960 (central) | 404/200 | 404:0 / 200 (central) | 404:0 / 200:10801 | 404:0 / 200:185 | 404:0 / 500:5411 (V1) | não |
| `/favicon.ico` | 200:25931 | 200 | 405:18 | 200 | 200 | 200 | não |
| arquivos de `public/` (28 malhas, 5 SVG) | 200 (JSON/SVG) | 200 | 405:2597 (`_error` do Next) | 200 | 200 | 200 | não |

### Locations de todos os 308 e 307 observados

| Pedido | Location |
| --- | --- |
| `//admin` | `/admin` |
| `/admin//fila` | `/admin/fila` |
| `/\admin` | `/admin` |
| `/admin\fila` | `/admin/fila` |
| `//evil.com` | `/evil.com` |
| `///evil.com` | `/evil.com` |
| `/\evil.com` | `/evil.com` |
| `//admin.segueovoto.com.br@evil.com` | `/admin.segueovoto.com.br@evil.com` |
| `/admin//evil.com` | `/admin/evil.com` |
| `//` | `/` |

- Todas são relativas e de uma barra só. Pelo WHATWG URL, cada uma resolve na própria origem da central: não há open redirect pelo caminho.
- `/admin/entrar` com `aal2` → 307 para `/admin`.
- Exceção: o request-target absoluto (V2).

## 4. Regressões dentro de `/admin`, no build da central, com sessão simulada

### Trava por Host

- Dão 404 com 0 B:
  - `x.vercel.app`, `www.segueovoto.com.br`, `admin.segueovoto.com.br.` (com ponto final), `:8080`;
  - `x.vercel.app` com `X-Forwarded-Host: admin.segueovoto.com.br`;
  - Host `127.0.0.1:<porta>` (o padrão do cliente).
- Dão 200, como especificado: `admin.segueovoto.com.br:443` e `ADMIN.SEGUEOVOTO.COM.BR`.
- Modos e variáveis (Preview, `AUTH_PROVIDER=dev`, `sslmode`): cobertos pelo `sem-navegador` (seção 5).

### Identidade

| Caso | Página `/admin/fila` | API `/admin/api/estado` |
| --- | --- | --- |
| Admin `aal1` | 307 para `/admin/entrar/fator` | 404 |
| Não admin `aal2` | 404 | 404 |
| Admin desativado no banco (`ativo=false`) | 404 | `POST /admin/api/pedidos` → 404 |

- Os 404 de página trazem a casca de erro da central (7,2 KB), sem dado.
- Admin reativado depois do teste.

### CSRF

- `POST /admin/api/pedidos` com sessão `aal2` → 403 nestes casos:
  - sem Origin;
  - Origin `www`;
  - Origin `http://admin…`;
  - Origin `null`;
  - `text/plain`;
  - `Sec-Fetch-Site: same-site`.
- Contagem de `adm_pedidos`: 4 → 4.
- `/admin/api/entrar/codigo`: os mesmos 403; Host `vercel.app` dá 404; o provedor não é chamado.

### Cabeçalhos

Medidos no 200 de `/admin/fila` com `aal2`.

- A CSP tem:
  - `script-src 'self' 'nonce-…' 'sha256-opRjTqQ1E5eUpc4SE9v3YoU5wuVpgtqT7zsobCj245Q='`;
  - `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`;
  - nenhum `'unsafe-eval'`.
- O hash bate com o `themeScript` de `src/app/layout.admin.tsx` (recalculado do fonte). Ele é idêntico ao de `layout.tsx`.
- No HTML servido há 16 `<script>`: 8 externos, 7 inline com o nonce do cabeçalho e 1 inline coberto pelo hash. Nenhum fica sem cobertura.
- XFO `DENY` e `Referrer-Policy: same-origin` em toda resposta que passa pelo middleware, inclusive nos 404.

### Turnstile (A5)

- Ausente da CSP de `/admin` e de `/admin/fila`.
- Presente só em `/admin/entrar`.

### Cookies

- Só `sb-admin-central-auth-token` é lido:
  - `sb-127-auth-token` e `sb-<ref>-auth-token` com sessão de admin dão 404;
  - cookie da central de não admin mais cookie do site de admin dá 404.
- `adm_entrar_email`: `Path=/admin; Secure; HttpOnly; SameSite=strict; Max-Age=900`.

### Nenhuma server action

- 0 no build.
- `Next-Action` e POST multipart/urlencoded dão 404 no middleware, também com sessão.

### Entrada por rotas de API com tempo fixo (A3/N4)

| Provedor | `codigo` (admin, não admin e inexistente) | `verificar` |
| --- | --- | --- |
| 50 ms | 1508 a 1515 ms | 1506 a 1525 ms |
| 2,5 s | 1507 a 1521 ms | 1507 a 1531 ms (admin incluído) |

- Desvios na primeira rodada com provedor de 2,5 s: não admin `codigo`=1943 ms e `verificar`=3217 ms. Na rodada seguinte (n=6, duas vezes), o primeiro de cada lote de cada grupo ficou entre 1,7 e 2,3 s (aquecimento), e o resto entre 1,51 e 1,53 s.
- Os desvios caíram nos dois grupos ou só do lado do não admin. O admin ficou sempre em cerca de 1,51 s em `verificar`, então o tempo não denuncia quem é admin.
- Não admin e inexistente não geram nenhuma requisição ao provedor. O corpo do `/otp` do admin traz `create_user:false` e `captcha_token`.

### A4

- `aal1` com fator verificado `fv` mais `fatorId=fu`: o provedor só recebeu `/factors/fv/challenge` e `/factors/fv/verify`.
- Primeiro cadastro: `fu3` é usado (TOFU, limite já registrado).
- `iniciar` com fator verificado → 409; de não admin → 404.
- `confirmar` sem sessão → 404.

### 308 de barra

- `/admin/fila//` → 308, 12 B, Location `/admin/fila/`, mesma origem, sem CSP nem XFO (N3).
- `/admin/fila/` e `/admin/` com sessão → 200 com CSP completa.

### TRACE

- 500, 2140 B, em toda a origem (`/`, `/admin`, `/admin/fila`, `/entrar`), com e sem sessão.
- Corpo: o `_error` padrão do Next ("500: Internal Server Error"), sem marca do site.
- Não ecoa: o cabeçalho `x-eco` e o cookie enviados não aparecem no corpo.
- Sem CSP e sem XFO.
- O log confirma a causa: `TypeError: 'TRACE' HTTP method is unsupported` no adaptador do middleware.
- Fica dentro da exceção da AC-29, a conferir na F4.
- `TRACK` e métodos desconhecidos → 400 com 0 B. `CONNECT` → conexão fechada.
- `PUT`, `DELETE`, `PATCH` e `PROPFIND` em página da central com `aal2` → 200 com o HTML da página. É o comportamento do Next. Não há ação nem dado além do que um GET já mostra.

## 5. Modo local e testes

| Prova | Resultado |
| --- | --- |
| `node web/e2e-admin/sem-navegador.mjs --sem-build` | rc 0, 303 `ok`, 0 `FALHOU`, "RESULTADO: tudo passou" (120 s) |
| `npm run test:unit` (web) | 239 passaram, 0 falharam |
| ETL (`test_http_rede_segura`, `test_admin_rede_segura`, `test_admin_identidade`, `test_admin_pedidos`), com o prefixo literal | 158 passaram em 55,8 s |

- Builds usados pelo `sem-navegador`:
  - `.next-admin-local`: fresco, meu;
  - `.next` e `.next-admin-prod`: da equipe, conferidos iguais aos meus builds frescos em rotas e actions.
- Avisos do `sem-navegador`: só a exceção do TRACE e dois limites de navegador (critérios 24 e 20).
- A evidência regravada foi restaurada do HEAD.

## 6. Estado de A1 a A13 e N1 a N6

| Item | Estado | Prova |
| --- | --- | --- |
| A1 site público na origem da central | FECHADO | Seções 1 a 3: estrutura dos dois builds, 2376 requisições sem marca do site, controle positivo. |
| A2 anti-SSRF no redirecionamento | FECHADO (por teste) | `test_http_rede_segura` e `test_admin_rede_segura` passam. Não refiz a prova com sockets do v2. |
| A3 enumeração por tempo | FECHADO | Seção 4: `codigo` e `verificar` no piso de cerca de 1,51 s com provedor de 50 ms e de 2,5 s. |
| A4 fator não verificado | FECHADO | Seção 4. |
| A5 Turnstile na CSP | FECHADO | Seção 4. |
| A6 gatilho por nome de papel | ABERTO (anotado) | Sem mudança; regra de runbook. |
| A7 executor confere admin por e-mail | FECHADO (por teste) | `test_admin_pedidos` passa. |
| A8 admin sem `user_id` | ABERTO (anotado) | Pré-requisito da F4. |
| A9 cabeçalhos em toda resposta | PARCIAL (anotar) | Faltam no 308 de barra dupla (N3), no 500 do TRACE, no `*` e no 400 do parser (pré-middleware). O resto tem os cabeçalhos. |
| A10 cookie próprio | FECHADO | Seção 4. |
| A11 `tini` | CÓDIGO | Imagem não construída (sem Docker). |
| A12 IPv4 não canônico | FECHADO (por teste) | `test_admin_rede_segura` passa. |
| A13 actions públicas na central | FECHADO | 0 actions no build; 1080 POST com os ids do site → 404 com 0 B (ou 308 para `/admin`, onde dá 404); 0 chamada ao provedor; banco inalterado. |
| N1 maiúsculas escapam | FECHADO | `/ADMIN`, `/aDmin/fila` e `/_NEXT/STATIC/x` → 404 com 0 B em todas as formas, com e sem sessão. |
| N2 404 "de 9 B" depende do `next start` | FECHADO localmente; borda não verificada | O build da central não tem página do site. Qualquer 404 que chegue ao app é o not-found da central, e `/_next/static/x` inexistente dá 9 B "Not Found". Na Vercel, o pior caso é o not-found da central, não o do site. |
| N3 308 de barra dupla sem cabeçalhos | ABERTO (anotar) | Location sempre relativo e na mesma origem; `//evil.com` → `/evil.com`. Não é open redirect pelo caminho (ver V2). |
| N4 `verificar` por tempo e queima de tentativas | Tempo FECHADO; queima ABERTA (corrigir) | `comPrazo(PISO-400)` em `web/src/lib/admin/entrada.ts:70`, medido. Sem limite próprio por e-mail/IP: cada `verificar` com código aleatório para e-mail de admin ainda chega ao `/verify` real e consome o limite do Supabase. |
| N5 proxy ignorado | FECHADO | Docstring de `etl/civico_etl/http.py:88` e `:143` corrigida. |
| N6 Turnstile não verificado no servidor | ABERTO (anotar) | O token só vai ao Supabase como `captcha_token`: depende do captcha ligado no projeto Supabase. Conferir no runbook da F4. |

## 7. Achados novos

### V1. ANOTAR: GET com `Next-Router-Prefetch: 1` sem `RSC: 1` dá 500 em toda página da central

- Onde: o erro é `ReferenceError: location is not defined` no chunk interno do Next (`server/chunks/51.js`). A correção cabe em `web/src/middleware.admin.ts:56-62` (`proxima`) ou como regra nova junto da linha 51.
- Severidade: fica em anotar porque o 500 não traz dado nem marca do site e não muda estado. O 500 sai sem autenticação e grava exceção no log a cada requisição, e a correção é uma linha: recomendo fazer antes da F4.
- Cenário:
  - qualquer visitante, sem sessão, em `GET /admin/entrar` com só esse cabeçalho;
  - ou um admin `aal2` em qualquer página;
  - resposta: 500, cerca de 5,4 KB, casca de erro do Next com os chunks da central, CSP com nonce e XFO;
  - sem dado e sem marca do site;
  - cada requisição grava uma exceção no log. Ruído de log, e um gatilho barato de 500 para quem monitora erro.
- Navegadores não mandam esse par sozinho. O `sem-navegador` testa só RSC+Prefetch, que dá 200 ou 404.
- Correção: no middleware, `next-router-prefetch` presente e `rsc` ausente → apagar o cabeçalho da requisição (em `proxima()`) ou responder 404/204.
- Teste: `GET /admin/entrar` com só `Next-Router-Prefetch: 1` → diferente de 500.

### V2. ANOTAR: request-target absoluto gera Location cross-origin

- Onde: fora do repositório (normalização de barras do Next 15.5.28, antes do middleware). Correção na borda.
- Evidência:
  - `GET http://www.segueovoto.com.br/ HTTP/1.1` com Host `admin.segueovoto.com.br` → 308 com `Location: http:/www.segueovoto.com.br/`;
  - `new URL("http:/www.segueovoto.com.br/", "https://admin.segueovoto.com.br/admin")` resolve para `http://www.segueovoto.com.br/`, porque o esquema difere.
- Não é explorável por navegador: navegador não envia absolute-form a um servidor de origem, e a borda da Vercel normalmente reescreve a linha de requisição. Não verifiquei na Vercel.
- Correção, se quiserem fechar: regra de borda do projeto admin (Vercel Firewall), a mesma sugerida para TRACE e N3. Na F4, conferir com `curl --request-target 'http://evil.com/' https://admin.segueovoto.com.br`.

### V3. ANOTAR: métodos arbitrários renderizam a página

- `PUT`, `DELETE`, `PATCH` e `PROPFIND` com sessão `aal2` em `/admin` e `/admin/fila` → 200 com o HTML da página. É o comportamento do Next para páginas; não há escrita.
- Não fere a garantia. Se quiserem método fechado em página, recusar em `web/src/middleware.admin.ts`, junto da linha 51, o que não for GET ou HEAD fora de `/admin/api`.

## 8. O que NÃO foi verificado

- Comportamento na borda real da Vercel: TRACE, barras repetidas, request-target absoluto, caixa do caminho, `/_next/static` inexistente, `VERCEL_ENV` real e o alias `*.vercel.app`.
- GoTrue real: login, OTP, TOTP, `aal2`, captcha e renovação de cookie com `Set-Cookie` real. O Supabase falso não renova sessão.
- Prova de A2 e A12 com sockets reais: aceitei os testes do ETL, que passam, sem refazer a prova do v2.
- Imagem Docker (`tini`): sem daemon.
- A6 e A8: só estado documental.

## 9. Higiene

- `git status --short` ao fim: nenhum arquivo rastreado alterado.
  - `web/tsconfig.json` restaurado depois de cada build.
  - `replica/prompts/evidencias/central-sem-navegador.txt` restaurado do HEAD.
- Pastas não rastreadas deixadas: `web/.next-v3-site/` e `web/.next-v3-admin/`. `web/.next-admin-local/` foi reconstruída do HEAD.
- `admin_coleta_c7`: o `sem-navegador` o recriou, então os admins de teste semeados por mim sumiram junto. `admin_coleta` só foi lido pelos testes do ETL.
- Os `next start` que subi rodavam em grupo de processos próprio e foram mortos ao fim de cada roteiro.
- Sobrou `/private/tmp/claude-501/placeholder`, um arquivo de 2 B criado por engano, fora do repositório. A remoção foi negada pela permissão: apague à mão.
