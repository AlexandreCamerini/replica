# Verificação de segurança independente: fase F3 da central (`5148ddd..HEAD`)

Data: 17/11/2026. Verificador: Opus, sem participação na construção. Objeto: `git diff 5148ddd..HEAD` (8 commits, HEAD `bac5340`).

## 0. Método e o que foi rodado

- Leitura: middleware, `guarda-regra.ts`, `guarda.ts`, `sessao.ts`, `entrada.ts`, `cliente-auth.ts`, `cabecalhos.ts`, `prazo.ts`, `db.ts`, `consultas.ts` (escrita), as rotas de API, o layout e as páginas de entrada; migração `0156`, policies da `0153`/`0155`; `rede_segura.py`, `decisoes.py`, `executor.py` (diff), `cli.py` (diff), `http.py`, `jobs/sapl.py`; `Dockerfile`, `.dockerignore`, `executor-container.md`; critérios reescritos e `sem-rede-externa.mjs`.
- Ambiente de ataque próprio, todo em 127.0.0.1, em `$TMPDIR` (scratchpad `h/`):
  - proxy TLS para o Postgres local, para o modo produção (`sslmode=require`) chegar ao banco `admin_coleta_c7`;
  - GoTrue falso servindo `/auth/v1/user`;
  - cookies `sb-127-auth-token` montados à mão (aal1/aal2, e-mail, `sub`);
  - `next start` (build existente em `web/.next`, que já contém o `comPrazo`) com `ADMIN_CENTRAL=producao VERCEL_ENV=production AUTH_PROVIDER=supabase`.
  - É a primeira vez que o caminho POSITIVO do modo produção foi exercitado: sessão válida, admin, aal2, gravação.
- Seed em `admin_coleta_c7` (descartável): `admin@x.test` (com `user_id`), `semuid@x.test` (sem `user_id`), `inativo@x.test` (inativo). Ficaram lá, junto com 1 pedido de rodada e 2 pedidos de decisão de teste.
- Testes:
  - os 6 arquivos do ETL indicados: 179 passaram;
  - `npm run test:unit`: 224 passaram.
  - `sem-navegador.mjs` não foi rodado; a evidência commitada não foi tocada.
  - `git status` limpo ao fim; processos encerrados.

## 1. Veredito por garantia

| G | Veredito | Resumo |
| --- | --- | --- |
| G1 Acesso em produção | NÃO ATENDE (para F4) / ATENDE no recorte `/admin` | Dentro de `/admin`, a matriz de identidade está correta e provada. O mesmo deploy, porém, serve o site público inteiro na origem `admin.segueovoto.com.br`, sem CSP/XFO (achado A1). |
| G2 Modo local | ATENDE | Regras de antes intactas, mais `ADMIN_LOCAL_EMAIL` ativo. O 503/500 só ocorre no ramo local e já depois da central liberada. |
| G3 Identidade e escrita | ATENDE COM RESSALVA | `por` descartado; `por_email`/`por_user_id`/`por_nome` vêm da sessão e da tabela (provado no banco); gatilho e grants ok. Ressalvas A6, A7, A8. |
| G4 CSRF e cabeçalhos | ATENDE COM RESSALVA | CSRF estrito provado (9 variações); cabeçalhos em 200, 404, 307, 405, API. Faltam em 308 e no 500 do TRACE; Turnstile na CSP de toda página da central; site público na mesma origem anula parte disso (A1). |
| G5 Anti-SSRF | NÃO ATENDE (efetividade) | A checagem na decisão está bem feita, mas o coletor segue redirecionamento (`http.py:82`): um host público que responde 302 para `http://169.254.169.254/` passa sem rebinding (A2). |
| G6 Site público sem regressão | ATENDE | Fora dos arquivos da central nada mudou; o matcher do middleware construído cobre só `/admin`; página pública sem cabeçalhos da central. |
| G7 Container | ATENDE COM RESSALVA | Sem segredo na imagem, `USER etl`, `.env*` excluído, `ADMIN_COLETA_AGENTES` fora do padrão. SIGTERM: decisão atômica (decide+aplica+finaliza numa transação). Ressalva: sem init como PID 1 (A11). Imagem nunca construída. |
| G8 Critérios e provas | ATENDE COM RESSALVA | As provas medem o que declaram para o caminho negativo. O positivo (sessão admin aal2) não existe nas provas; a afirmação "Turnstile só na entrada" é falsa para a CSP (A5); TRACE segue pendente de decisão do dono (decisão 5). |

## 2. Achados

### A1. BLOQUEIA (F4): o site público inteiro responde na origem da central

- Severidade: bloqueia a F4.
- Onde:
  - desenho (seção 2.2 da reavaliação: "segundo projeto Vercel do mesmo repo");
  - `web/src/middleware.ts:17`: matcher só `/admin`, e nada barra o resto no projeto admin.
- Evidência: `next start` em modo produção simulado, Host `admin.segueovoto.com.br`.

  | Rota | Status | CSP | X-Frame-Options |
  | --- | --- | --- | --- |
  | `GET /` | 200 | ausente | ausente |
  | `/entrar` | 200 | ausente | ausente |
  | `/api/me` | 200 | ausente | ausente |
  | `/conta` | 307 | ausente | ausente |
  | `/api/places` | 400 | ausente | ausente |

  - `/api/me` com o cookie de sessão da central devolve `{"signedIn":true}`: o código público lê o mesmo cookie `sb-<ref>-auth-token`.
  - Uma server action PÚBLICA (`sendCode`, id `609f…`) foi executada com `POST /admin/entrar`: o roteamento de action é por id, não por página.
- Cenário:
  - qualquer XSS ou injeção numa página pública fica, no projeto admin, na MESMA origem da central;
  - `fetch('/admin/api/decisoes', {method:'POST', headers:{'content-type':'application/json'}})` sai com `Origin` e `Sec-Fetch-Site: same-origin` corretos;
  - o navegador manda os cookies `path=/admin` + `Strict`;
  - resultado: decisão em nome do admin logado. CSRF estrito, `Strict` e `path=/admin` não protegem contra a mesma origem.
  - O login público (`shouldCreateUser: true`, cookie `Lax`, `path=/`) também roda nesse host, com o mesmo nome de cookie da central.
- Correção sugerida, escolher uma:
  - (a) no projeto admin, responder 404 a tudo fora de `/admin` e `/_next/static` na borda, por regra do Vercel Firewall ou `vercel.json` só do projeto admin;
  - (b) separação em build: a alternativa por `pageExtensions` da AC-22, que também resolve o TRACE;
  - (c) middleware com matcher amplo que, só com `ADMIN_CENTRAL=producao`, devolve 404 fora de `/admin`. Isso põe middleware no site público e exige reprovar G6.
  - Critério de aceite: com Host `admin.`, `GET /`, `/entrar` e `/api/me` → 404; `POST /admin/entrar` com id de action pública → recusado.

### A2. CORRIGIR (bloqueia o anti-SSRF de fato): redirecionamento contorna `url_publica`

- Severidade: corrigir.
- Onde: `etl/civico_etl/http.py:82` (`follow_redirects=True` no cliente compartilhado).
- Caminho: `jobs/sapl.py:151` `_get` → `H.fetch_json` → `_fetch` → `client()`, o mesmo cliente. O `robots.txt` (`assembleias.allowed`) também passa por ele.
- Cenário:
  - um admin (ou uma sessão de admin roubada, ou um admin enganado por evidência maliciosa) corrige `base_url` para `https://host-publico.exemplo`;
  - a decisão passa: o host resolve para IP público;
  - na rodada, o host responde `302 Location: http://169.254.169.254/latest/meta-data/` ou `http://127.0.0.1:5432/`;
  - o httpx segue, inclusive de https para http e para link-local;
  - o JSON devolvido entra no fluxo de coleta. Não é SSRF cego.
- O limite declarado (rebinding) não cobre isto.
- Correção:
  - no coletor SAPL, `follow_redirects=False` com tratamento manual, OU um transporte httpx que revalide cada destino (esquema https, IP resolvido público) a cada salto e na conexão. Isto também fecha o rebinding: resolver uma vez, conectar no IP conferido com SNI/Host do nome.
  - Teste: um servidor falso que redireciona para 127.0.0.1 tem de fazer a busca falhar.

### A3. CORRIGIR: enumeração de admins por tempo e abuso de envio, nas actions de entrada

- Severidade: corrigir.
- Onde:
  - `web/src/lib/admin/entrada.ts:35-40`: `signInWithOtp` só é aguardado se `adminAtivo(email)`;
  - `entrada.ts:59-61`: `verifyOtp` só para admin.
- Cenário:
  - a resposta é neutra, mas a latência não: para admin há uma ida ao Supabase (centenas de ms), para os demais só uma consulta local;
  - medindo `enviarCodigo` com e-mails candidatos, separa-se admin de não admin.
  - Não há limite de ritmo na aplicação. O limite do Supabase por IP vê o IP do servidor da Vercel, então um abusador consome a cota de todos e pode travar o login do admin real.
- Limite desta verificação: medida ao vivo não conclusiva. Minha codificação manual do corpo da action não chegou ao campo `email`; o achado vem da leitura do código, e o desvio é estrutural.
- Correção:
  - responder antes da chamada ao provedor, disparando `signInWithOtp` com `after()` do Next, ou igualar o tempo com um piso fixo;
  - limite de ritmo por IP e por e-mail na action (tabela ou KV);
  - Turnstile verificado no servidor antes de qualquer consulta a `adm_admins`.

### A4. CORRIGIR: `confirmarFator` aceita `fatorId` não verificado mesmo com fator verificado existente

- Severidade: corrigir.
- Onde: `entrada.ts:107-111`.
- Cenário:
  - quem tem só a caixa de e-mail do admin (aal1) e um fator `unverified` criado direto na API do GoTrue (o anon key é público e o token é do próprio usuário) manda esse `fatorId`;
  - `challengeAndVerify` nele sobe para aal2 sem o autenticador do admin.
  - Se o GoTrue exige aal2 para cadastrar fator novo quando já há um verificado, o ataque morre ali. Isso não foi verificável aqui (seção 4).
- Correção: se `lista.totp.length > 0`, ignorar `fatorId` e usar só o fator verificado; aceitar `fatorId` apenas quando não há nenhum verificado.
- Registrar também, como risco de desenho (anotar): o primeiro cadastro de TOTP é confiança no primeiro uso. Entre incluir alguém em `adm_admins` e ele cadastrar o fator, quem tiver a caixa de e-mail cadastra o próprio TOTP. Mitigar com `ativo=false` até o cadastro acompanhado, ou cadastro feito pelo dono.

### A5. CORRIGIR: Turnstile na CSP de todas as páginas da central, não só na entrada

- Severidade: corrigir.
- Onde: `web/src/lib/admin/cabecalhos.ts:33,40-41` (depende só do modo).
- Evidência: `GET /admin/fila` como admin aal2 tem `script-src … challenges.cloudflare.com`, `connect-src … challenges.cloudflare.com` e `frame-src challenges.cloudflare.com`.
- O critério 23-produção diz "só nas páginas de entrada", e a prova só confere a CSP de `/admin/entrar`. A prova passa sem medir o resto, porque o caminho positivo não existe nela.
- Correção: `politicaCsp` recebe `entrada: boolean` (o middleware já calcula `ehEntrada`); fora da entrada, sem o host. Teste com página de dados.

### A6. ANOTAR: o gatilho `adm_pedido_identidade` falha aberto por nome de papel

- Severidade: anotar.
- Onde: `db/migrations/0156_admin_admins.sql:113`: `if current_user <> 'admin_central' then return new`.
- Cenário: se em produção a conexão usar um papel de login membro de `admin_central` (padrão comum para rotacionar senha), as policies `to admin_central` valem por herança, mas o gatilho não age. Pedido sem `por_email`, sem ritmo, `por_nome` livre.
- Hoje o plano (reavaliação 2.5) é logar como `admin_central`, então não há furo atual.
- Correção: inverter, isentando explicitamente os papéis do dono e do ETL, ou usar `pg_has_role(current_user, 'admin_central', 'member')`. Anotar no runbook da F4: o login tem de ser o próprio `admin_central`.

### A7. ANOTAR: executor confere admin por `email OR nome`; `nome` não é único

- Severidade: anotar.
- Onde: `etl/civico_etl/admin/executor.py` (`_decisao`, a consulta de `MOTIVO_SEM_ADMIN`).
- Cenário: pedido da central de um admin desativado antes da execução passa se outro admin ativo tem o mesmo `nome`.
- Correção: com `por_email` não nulo, conferir só por e-mail; o nome só vale para pedido da CLI. Ou `unique` em `adm_admins.nome`. A CLI já recusa nome ambíguo; o executor não.

### A8. ANOTAR (pré-requisito da F4): admin sem `user_id` aceita qualquer `por_user_id`

- Severidade: anotar.
- Evidência: `semuid@x.test` com `sub` arbitrário obteve 200 e gravou pedido com `por_user_id=4444…`.
- Combinado a troca de e-mail no Supabase, isso vira tomada de identidade.
- Correção: cadastrar `user_id` de todos antes da F4, ou gravar o `user_id` no primeiro login aal2 (pelo dono) e tornar a coluna obrigatória depois.

### A9. ANOTAR: cabeçalhos de segurança ausentes em 308 e no 500 do TRACE

- Severidade: anotar.
- Evidência:
  - `/admin/fila/` e `//admin/fila` → 308 sem CSP/XFO (o redirecionamento de barra do Next roda antes do middleware);
  - `TRACE /admin/fila` → 500 sem nenhum dos três cabeçalhos.
- Sem corpo e sem dado. Mas "em TODA resposta da central" (G4) não vale para essas duas.
- O TRACE continua aberto para a internet (decisão 5).

### A10. ANOTAR: plantio de cookie a partir de `www` e colisão de nome

- Severidade: anotar.
- Como acontece:
  - os cookies da central e do site têm o mesmo nome (`sb-<ref>-auth-token`);
  - um XSS em `www` pode gravar cookie `domain=.segueovoto.com.br; path=/admin/...` com a sessão do atacante; o caminho mais longo é enviado primeiro.
- Efeito: a central lê a sessão do atacante, que não é admin. Dá 404 (negação de serviço) e confusão de sessão, não escalada.
- Correção: nome de cookie próprio da central (`cookieOptions.name` do `@supabase/ssr`).

### A11. ANOTAR: container sem init

- Severidade: anotar.
- Onde: `etl/Dockerfile:37`. O `civico-etl` é o PID 1 (forma exec), sem `tini`/`--init`.
- Efeito: netos órfãos de subprocessos da rodada não são colhidos (zumbis) e não recebem o SIGTERM.
- Verificado: o estado do pedido é consistente.
  - Decisão: `decidir` + `aplicar` + `_finalizar('concluido')` estão numa única transação.
  - O sinal antes do commit faz rollback e grava `interrompido`.
  - O sinal depois do commit faz `_finalizar` virar no-op (`where status='em_execucao'`).
  - Nenhuma decisão fica meio aplicada.
- Correção: `tini` como ENTRYPOINT ou `--init` documentado.

### A12. ANOTAR: forma octal de IPv4

- Severidade: anotar.
- Evidência: `url_publica('https://0177.0.0.1/')` devolve `None` no Mac, porque o `getaddrinfo` do macOS dá `177.0.0.1`. O glibc daria `127.0.0.1`.
- Sem impacto hoje: o httpx recusa esse host (`InvalidURL: Invalid IPv4 address`), conferido.
- Correção barata: recusar host todo numérico ou hex que não seja um IPv4 canônico de quatro octetos.
- Outros casos conferidos:
  - recusados: NAT64 `64:ff9b::/96`, `::127.0.0.1`, IPv4 mapeado, `fe80::%zona`, userinfo e `\@`, porta ≠ 443, vários IPs com um privado;
  - `0x7f.1` e `2130706433` resolvem para loopback e são recusados.

### A13. ANOTAR: actions públicas executáveis em caminhos `/admin/*`

- Severidade: anotar.
- Evidência: `POST /admin/entrar` com `Next-Action` de `sendCode` público executou o código de `(v1)/conta`.
- Em `/admin/<dados>`, com sessão de admin, `signOut`/`toggleFollow`/`deleteAccount` rodariam com os cookies da central.
- Para disparar isso no navegador do admin, um terceiro precisa passar pela checagem de origem das actions do Next (confirmada: Origin cruzado → "Invalid Server Actions request") e pelo `Strict`.
- Resolve junto com A1, opção (b).

## 3. O que foi confirmado como correto (com evidência)

### G1, identidade, ao vivo em modo produção simulado

| Caso | Página | API |
| --- | --- | --- |
| sem cookie | 404 | 404 |
| admin aal2 | 200 | 200 |
| admin com e-mail em maiúsculas | 200 | 200 |
| admin aal1 | 307 → `/admin/entrar/fator` | 404 |
| `user_id` diferente | 404 | 404 |
| não admin aal2 | 404 | 404 |
| inativo | 404 | 404 |
| e-mail não confirmado | 404 | 404 |
| token recusado pelo GoTrue | 404 | 404 |

- `cache()` do React: 40 requisições concorrentes alternando admin e não admin; nenhum vazamento (admin sempre 200, não admin sempre 404).

### G1, ataques à trava, todos 404

- `x-admin-entrada: 1` injetado;
- `x-middleware-request-x-admin-entrada` + `x-middleware-override-headers`;
- `x-middleware-subrequest` (as duas formas);
- Host `admin.segueovoto.com.br.`, `:8443`, `*.vercel.app`, `evil`;
- `X-Forwarded-Host`/`Forwarded` forjados;
- `/adm%69n/fila`, `/admin/../admin/fila`, `/admin%2ffila`, `/admin/entrar/../fila`, `/admin/entrar/%2e%2e/fila`, `/admin/entrar%2f..%2ffila`, `/admin/entrar/x`;
- `/admin/entrar/fator` sem sessão ou não admin; `?_rsc=1`.
- `/ADMIN/fila` cai no 404 público (não casa rota).
- `/admin` com Host `www` → 404.

### G1, outros

- O middleware em `runtime: nodejs` com `next/server.js` funciona no `next start` real.
- Prazo: a rejeição de `comPrazo` cai no `catch` e fecha, nos dois lugares (`middleware.ts:66-71`, `sessao.ts:50-54`). Não há caminho em que o prazo estourado libere.
- O nível aal é lido do `access_token` da mesma sessão que `getUser()` acabou de validar no servidor; não dá para forjar `aal2` sem assinatura.

### G3, ao vivo

- `POST /admin/api/pedidos` com campo `por` → 400.
- `POST /admin/api/decisoes` com `por: "Fulano Forjado"` grava `por_nome='Admin Um'`, `por_email='admin@x.test'`, `por_user_id=1111…` (lido no banco).
- `admin_central` só insere com `status='na_fila'` e `criado_em` dentro de ±5 s do relógio (0153/0155), então não fura o ritmo com data falsa.
- `adm_admins` e o log não têm grant de escrita para ninguém além do dono; o log recusa `update`/`delete`.
- `chave_idem` da decisão usa `por_nome` da tabela, o mesmo que o gatilho grava e o executor recalcula.
- A CLI `decidir --por` exige admin ativo único.

### G4, ao vivo

- CSRF: as variações abaixo dão 403; `https://admin.segueovoto.com.br:443` normalizado é aceito.
  - sem `Origin`;
  - sem `Sec-Fetch-Site`;
  - `text/plain`;
  - `Origin` `http:`, `null`, `www`;
  - `Sec-Fetch-Site: same-site`.
- Métodos sem uso → 405 com admin, 404 sem sessão.
- Nonce: 16 de 17 `<script>` levam o nonce da resposta; o único sem nonce é o script de tema, coberto pelo hash.
- `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`.
- Nenhuma renovação de cookie no caminho testado. Não foi possível ver as opções de `Set-Cookie` emitidas: o GoTrue falso não renova (seção 4).

### G6

- `git diff --stat -- web` fora de `(admin)`, `lib/admin`, `components/admin*`, `admin.css`, `middleware.ts`, `e2e-admin` e testes da central: vazio.
- Matcher no `functions-config-manifest.json`: só `/admin`.
- Página pública em `www` sem os cabeçalhos da central.

## 4. Não verificado, e por quê

- Comportamento do GoTrue real (só Supabase real prova):
  - se cadastrar fator novo com fator verificado exige aal2 (decide A4);
  - se `challengeAndVerify` num fator `unverified` de outra sessão aal1 é aceito;
  - limites de ritmo de `/otp` e `/verify`;
  - captcha;
  - `shouldCreateUser:false` respeitado.
- Medida ao vivo do tempo de `enviarCodigo`/`verificarCodigo`: a codificação manual da action não entregou os campos; A3 vem do código.
- Opções reais do `Set-Cookie` (`Strict`, `HttpOnly`, `Secure`, `path=/admin`, host-only) numa renovação. A função `opcoesDeCookieDaCentral` foi lida, não observada em resposta.
- O widget Turnstile real: o build não tem a chave pública. Sem ela, se o captcha estiver ligado no projeto Supabase compartilhado, o `signInWithOtp` da central falha em silêncio (resposta neutra) e o admin não recebe código. Conferir a chave no build do projeto admin.
- O build e a execução da imagem Docker: o daemon não responde no sandbox.
- O alias `*.vercel.app` real, `VERCEL_ENV` real e as regras de borda da Vercel (relevantes para A1).

## 5. Ordem sugerida

1. A1, antes da F4.
2. A2, antes de qualquer decisão de `base_url` executada pelo container.
3. A3, A4 e A5, na F3 ou antes da F4.
4. Anotados (A6 a A13), no runbook da F4.
5. TRACE: decisão 5 do dono.
