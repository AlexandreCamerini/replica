# Critérios 9, 15 e 23 para a central na internet (F3-T5)

Origem: `replica/reavaliacao-central-e-dominio.md`, seção 2.3 (critérios 9, 15 e 23 deixam de valer como escritos) e linha F3 da seção 6; contrato em `replica/admin-coleta-decisoes.md` (AC-23 a AC-26). Os textos originais estão em `replica/prompts/admin-coleta-enriquecimento.md` (critérios 9, 15 e 23 da Parte C). Este arquivo os substitui para a central publicada em `admin.segueovoto.com.br`; o modo local continua provado como antes.

Nada aqui foi provado com Supabase real nem em navegador: a seção 5 lista o que só se prova assim. Os dois modos são os da AC-23, escolhidos por `ADMIN_CENTRAL` (valor exato): `1` (local) e `producao`. Qualquer outro valor, ou a variável ausente: central fechada.

## 1. Como rodar as provas

Tudo sai de `web/`, com `PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"` e o Postgres local em `localhost:54329`. Os bancos de ensaio são `admin_coleta_c7` e `admin_coleta_r1`; ambos são recriados pelos roteiros. As provas não usam rede externa: o Supabase do modo produção simulado é uma porta local fechada (ou um soquete local que derruba a conexão).

| Comando | O que prova |
| --- | --- |
| `cd web && node e2e-admin/sem-navegador.mjs` | critérios 15 (local e produção), 19, 20, 22, 24, estados de tela, CSRF, identidade, cabeçalhos, ritmo; recria `admin_coleta_c7`, roda `next build` (use `--sem-build` para reaproveitar `.next`) |
| `cd web && node e2e-admin/sem-rede-externa.mjs [--sem-build]` | critério 23 (local e produção) |
| `bash replica/prompts/evidencias/primeira-rodada.sh` | fluxo da primeira rodada, com `sem-navegador.mjs --fluxo` no modo local com o admin local |
| `cd etl && ETL_DATABASE_URL=postgres://postgres@localhost:54329/admin_coleta_c7 uv run --frozen pytest -q tests/test_admin_chaves.py tests/test_admin_endurece.py` | critério 9 |

## 2. Critério 9 (reconferido): as duas chaves dos agentes

Texto original: tentativa de aplicar por agentes com qualquer das duas chaves desligada falha fechada.

O que NÃO muda: a regra mora no ETL (`etl/civico_etl/admin/aplicar.py`, `chaves_dos_agentes`; gatilhos `adm_decisoes_guard` das migrações 0150 e 0152). Decisão de `agentes` só se aplica com a variável `ADMIN_COLETA_AGENTES=on` no ambiente do processo que aplica E a linha `admin_coleta_agentes = 'on'` em `public.pipeline_switches`. Não há parâmetro que substitua a variável. A central nunca cria decisão de agentes: o pedido de decisão é de pessoa (`por_nome` do admin) e o executor exige admin ativo (AC-24).

O que muda com o executor fora da máquina local (container, `etl/executor-container.md`):

1. O container tem a credencial de escrita do ETL (`ETL_DATABASE_URL`), não a do `admin_central`. Quem controla o container controla a primeira chave. A segunda chave é uma linha no banco que só o dono escreve (o `admin_central` não tem grant em `pipeline_switches`).
2. A primeira chave, `ADMIN_COLETA_AGENTES`, NÃO deve estar no ambiente do container. É o padrão da imagem e da documentação; passa a ser requisito de aceite: antes de cada publicação do executor, conferir que o ambiente do serviço não a define (`docker inspect` ou o painel do host).
3. A segunda chave continua no banco, em `pipeline_switches`. Ligá-la sozinha não basta: sem a variável, a decisão de agentes falha fechada; a variável sozinha, sem a linha, idem (testes `test_aplicar_por_agentes_a_variavel_ligada_nao_liga_a_linha_do_banco` e os da matriz das quatro combinações).
4. Decisões de agentes continuam exigindo as duas. Ligar as duas em produção é decisão do dono, fora desta fase.

Aceite (9-produção): com o executor no ambiente de produção, `ADMIN_COLETA_AGENTES` ausente do ambiente do container e `select value from pipeline_switches where name = 'admin_coleta_agentes'` ausente ou diferente de `on`; uma tentativa de aplicar por agentes falha fechada sem gravar. Prova sem produção: os testes de `etl/tests/test_admin_chaves.py` e `etl/tests/test_admin_endurece.py` (matriz das combinações de variável e linha, nenhuma tabela mudando, decisão não criada). O que só se prova no host real: que o ambiente do container não define a variável.

## 3. Critério 15: sem a variável, a central responde 404

### 15-local (como está provado hoje, `ADMIN_CENTRAL=1`)

Texto: sem a variável que liga a central, toda rota dela responde com status HTTP 404, inclusive as que têm estado de carregando. Com `VERCEL` ou `VERCEL_ENV` definida, idem, mesmo com a variável ligada. Com a central ligada, Host que não seja `localhost`, `127.0.0.1` ou `[::1]` também responde 404 (DNS rebinding). Há teste para todos os casos. Em modo local as páginas `/admin/entrar` e `/admin/entrar/fator` respondem 404 (só existem em produção).

Exceção aprovada (AC-22): `TRACE` em `/admin/*` responde 500 sem corpo da central, em vez de 404. É limite do adaptador de middleware do Next 15.5 (o `Request` do Node recusa `TRACE` antes da função do middleware). A prova a registra como EXCEÇÃO.

Comando: `cd web && node e2e-admin/sem-navegador.mjs` (seções "critério 15" e "critério 15 (G1-4)"). Aceite: nenhuma linha `FALHOU`; o 404 da central fechada leva os três cabeçalhos de segurança.

### 15-produção (`ADMIN_CENTRAL=producao`)

Texto: a central responde com status HTTP 404, sem corpo, em toda rota (páginas, RSC, prefetch, route handlers) e para todo método (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`), se qualquer uma destas for verdadeira:

- `ADMIN_CENTRAL` diferente de `producao`;
- `VERCEL_ENV` diferente de `production` (Preview e Development ficam fechados);
- `AUTH_PROVIDER` diferente de `supabase`;
- `ADMIN_DATABASE_URL` ausente, malformada, com `#`, espaço, controle, vários hosts ou `host`/`hostaddr`/`service` na query, ou sem um único `sslmode` igual a `require`, `verify-ca` ou `verify-full`;
- Host da requisição diferente de `admin.segueovoto.com.br` (sem porta ou `:443`, qualquer caixa): inclui `localhost`, `127.0.0.1`, o alias `*.vercel.app` do projeto e qualquer subdomínio parecido. `X-Forwarded-Host`, `Forwarded` e afins não valem;
- sem sessão válida do Supabase (`getUser()` valida o token no servidor do Auth), ou com o provedor fora do ar (falha do provedor = sem usuário = 404);
- usuário que não é admin ativo em `adm_admins`, ou admin com e-mail não confirmado, ou com `user_id` diferente do cadastrado;
- admin sem `aal2`: 404 em toda rota, exceto a do fator (abaixo).

Exceções, só estas duas:

1. `GET` em `/admin/entrar` (formulário de e-mail e código) com a sessão ausente, no Host certo e com o ambiente certo: 200. Conforme o código (`middleware.ts`: `ehEntradaSemSessao`; `entrar/page.tsx`), nos outros métodos o Next decide (a prova registra os status e exige que nenhum seja 5xx). Qualquer variável do ambiente errada ou Host errado: 404 também nesta rota.
2. `/admin/entrar/fator` para admin ativo com `aal1`: a guarda redireciona ao cadastro ou à verificação do fator. Sem sessão, essa rota é 404.

`TRACE`: a exceção do AC-22 foi aprovada pelo dono para a central local. O comportamento não mudou (500 sem corpo em `/admin/*`, também no modo produção simulado, por causa do Next). Para a central na internet a decisão 5 da seção 7 da reavaliação continua aberta: a prova registra a EXCEÇÃO e ela precisa de nova aprovação do dono antes da F4.

Comandos: `cd web && node e2e-admin/sem-navegador.mjs` (seções "critério 15 (modo produção, simulado)" e "modo produção simulado: provedor de autenticação fora do ar"). O servidor é `next start` com `ADMIN_CENTRAL=producao VERCEL_ENV=production AUTH_PROVIDER=supabase NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<porta fechada> NEXT_PUBLIC_SUPABASE_ANON_KEY=x ADMIN_DATABASE_URL=postgres://...@127.0.0.1:54329/admin_coleta_c7?sslmode=require`.

Aceite, verificado pela prova: Host `admin.segueovoto.com.br` sem cookie: 404 em toda rota e método, salvo `/admin/entrar`; Host `localhost`, `replica-x.vercel.app` e variações: 404 inclusive em `/admin/entrar`; `VERCEL_ENV=preview`, `AUTH_PROVIDER=dev`, sem `sslmode`, `sslmode=disable` e outras variações: 404 em toda rota; nenhuma requisição ao Supabase falso derruba o servidor, e provedor fora do ar (conexão derrubada ou resposta 500) = 404.

## 4. Critério 23: hosts permitidos

### 23-local (`ADMIN_CENTRAL=1`)

Texto: nenhuma requisição da central sai para host externo. A central só fala com a própria origem. Provado sem navegador por varredura do fonte (URL absoluta, `<script src>`, `<link href>`, `@import`, fontes, imagens, `fetch`) e do HTML e dos recursos de cada página com a central ligada. Teste ponta a ponta com navegador: `web/e2e-admin/rede.spec.ts` (Playwright, fora do sandbox).

Comando: `cd web && node e2e-admin/sem-rede-externa.mjs [--sem-build]`. Aceite: `RESULTADO: tudo passou`.

### 23-produção (`ADMIN_CENTRAL=producao`)

Texto: o navegador, na central publicada, só contacta estes hosts, e a CSP só os cita:

1. a própria origem da central (`admin.segueovoto.com.br`, `'self'` na CSP);
2. `challenges.cloudflare.com` (Turnstile), só nas páginas de entrada (`/admin/entrar`, `/admin/entrar/fator`): o chunk que carrega o widget só é referenciado por elas, e a CSP o cita só no modo produção;
3. do lado do servidor, o Supabase Auth do projeto (`NEXT_PUBLIC_SUPABASE_URL`). O navegador nunca fala com ele: toda chamada é do servidor (middleware, layout, server actions). A CSP não o cita.

Nada mais: nem fonte externa, nem CDN, nem analytics. No fonte da central, `challenges.cloudflare.com` só pode aparecer em `web/src/lib/admin/cabecalhos.ts` e no widget `web/src/components/account/turnstile.tsx`; nenhum literal de host do Supabase; nenhum arquivo da central importa `lib/captcha.ts` (o `siteverify` server-side da Cloudflare é do cadastro do site público; a entrada da central entrega o token ao Supabase Auth). Qualquer outro host no fonte, no HTML, nos chunks ou na CSP falha.

Comando: `cd web && node e2e-admin/sem-rede-externa.mjs [--sem-build]`, seções 1 (fonte) e 3 (modo produção simulado). Aceite: `RESULTADO: tudo passou`; CSP de `/admin/entrar` com um único host (`challenges.cloudflare.com`), `frame-ancestors 'none'` e sem `'unsafe-eval'`; as páginas de entrada, sem cookie de sessão, não abrem conexão com o Supabase.

## 5. Cabeçalhos e CSRF (verificações novas da fase)

Provados em resposta real (`fetch` com `redirect: "manual"`, o equivalente a `curl -I`): `Content-Security-Policy` com `frame-ancestors 'none'`, `X-Frame-Options: DENY` e `Referrer-Policy: same-origin` em página, rota de API e no 404 da central, nos dois modos; ausentes em página pública (`/`) e na malha pública. POST sem `Origin`, sem `Sec-Fetch-Site`, ou com `Sec-Fetch-Site` diferente de `same-origin`: 403, sem gravar. `por` do corpo ignorado: o pedido gravado leva o nome e o e-mail do admin da sessão. Admin desativado: nenhuma gravação. Limite de 20 pedidos por minuto por admin: o 21º responde 429 com `Retry-After: 60`.

## 6. O que só se prova com Supabase real e navegador

- Login por código de e-mail, TOTP, nível `aal2`, renovação de cookie (`updateSession`), `signInWithOtp` com `shouldCreateUser: false`, resposta neutra para e-mail que não é admin, `user_id` confirmado.
- O widget Turnstile carregando de fato (precisa da chave pública no build) e o Supabase verificando o token.
- Cookies `Secure`, `HttpOnly`, `SameSite=Strict`, `path=/admin` e host-only no navegador real; o efeito do `Strict` (abrir a central por link externo mostra 404 até a próxima navegação).
- Alias `*.vercel.app` do projeto Vercel real devolvendo 404 (a prova usa um Host forjado); Preview real fechado.
- `sslmode=require` no driver `postgres` não valida a cadeia do certificado: exigir `verify-full` é decisão do dono.
- Que o ambiente do container do executor não define `ADMIN_COLETA_AGENTES`.
