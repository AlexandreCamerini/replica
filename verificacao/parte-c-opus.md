# Verificação independente da Parte C: central de administração (G1 a G4)

Verificador: Opus, contexto limpo, sem participação na construção. Data: 2026-11-17. Branch `claude/hopeful-lewin-176541`, HEAD `fa2b4bb`; Parte C de `1a0c0e9` a `fa2b4bb`.
Build verificado: `web/.next` (BUILD_ID de 06:40). Nenhum arquivo em `web/src` é mais novo que o build.

## Resumo

| Garantia | Veredito | Achados (severidade) |
| --- | --- | --- |
| G1: central fechada = 404 em tudo, inalcançável pelo público | NÃO ATENDE, pela letra do critério. Com a central fechada não vaza dado nenhum e não há escrita. | G1-1 requisição RSC responde 200 (bloqueia o critério 15); G1-2 OPTIONS e TRACE não dão 404 (bloqueia o critério 15); G1-3 `?host=` na ADMIN_DATABASE_URL fura a checagem de banco local (corrigir); G1-4 com a central ligada, GET sem checagem de Host (DNS rebinding) (corrigir); G1-5 o 404 entrega o título "Central de coleta" (anotar); G1-6 os chunks JS da central são servidos com a central fechada (anotar) |
| G2: com as chaves desligadas, nada da central vira escrita de agentes | ATENDE COM RESSALVA | G2-1 o teste do critério 22 não detecta volta ao motor real (anotar); G2-2 a decisão de pessoa pela tela escreve em domínio e aceita qualquer URL http(s) como `base_url`, que o coletor depois busca (anotar, é do desenho); G2-3 `unir` não fica preso ao par da pendência (anotar, hoje inalcançável); G2-4 `por_nome` livre aceita "agentes" e isso vai para `identity_match_queue.resolved_by` (anotar) |
| G3: nenhuma requisição sai para host externo | ATENDE COM RESSALVA | G1-3 também conta aqui: com `?host=`, o servidor da central conecta num host externo (corrigir); a prova de navegador (`rede.spec.ts`) não rodou, e o que rodou é varredura estática mais HTML (anotar) |
| G4: grants mínimos do `admin_central` | ATENDE COM RESSALVA | G4-1 a policy de insert não limita `criado_em`, `chave_idem`, `id` nem `parametros`: dá para furar a fila e a idempotência (corrigir); G4-2 o login vale para o cluster inteiro, com `trust` no pg_hba, e tem CONNECT e TEMP em todo banco, `civico` incluído (anotar); G4-3 o role troca a própria senha (anotar); G4-4 o comentário diz "onze tabelas" e a lista tem doze (anotar) |

G1-1 e G1-2 bloqueiam o critério 15. Ele está escrito como "toda rota responde 404, inclusive método que a rota não usa", e os dois o contradizem: o critério não pode ser declarado cumprido. Eles não bloqueiam o uso local: com a central fechada não vaza dado e não há escrita. O corpo RSC completo de `/admin`, `/admin/fila`, `/admin/rodadas` e `/admin/ficha/...` foi conferido: 0 `adm-`, 0 `data-estado`, 0 `/admin/api/`, 0 URL de fonte, 0 pendência. Os demais achados são "corrigir" ou "anotar".

---

## G1. Central fechada responde 404; nada alcançável pelo público

### O que tentei

- Os quatro pontos de guarda: layout, route handlers, `consultas.ts`, `db.ts`.
- `decidirAcesso` com `ADMIN_CENTRAL` valendo "1 ", "true", "01" e "", e com `VERCEL=""` e `VERCEL_ENV=""`. A regra é igualdade exata e `!== undefined`: todos negam.
- Busca no grupo por `generateMetadata`, `generateStaticParams`, `revalidate`, `unstable_cache`, `lib/data`, server actions e `sqlAdmin` fora de `lib/admin`: nenhum.
- O build: `prerender-manifest` sem `/admin` e nenhum `.html`/`.rsc` estático da central.
- Rodei `sem-navegador.mjs --sem-build`: passou, 98 ok e 0 falhas.
- Subi `next start` meu, sem `ADMIN_CENTRAL` e depois com `VERCEL=1`. Com curl, sondei:
  - variações de caminho: maiúsculas, `%61dmin`, `%2F`, `//admin`, `/./`, `/../`, `;x`, `_next/data`, `.rsc`, `.txt`;
  - todos os métodos;
  - `RSC: 1` (incluindo os cabeçalhos de prefetch);
  - POST com `Next-Action`;
  - `robots.txt` e `sitemap.xml`;
  - links para `/admin` em `/`, `/como-funciona`, `/dados-abertos` e `/quem`.
- Com a central ligada no `admin_coleta_c7`: cabeçalho `Host` forjado em GET e POST; POST com origem cruzada, `text/plain`, `Origin: null` e `Sec-Fetch-Site: cross-site`; preflight de CORS.
- A interpretação da URL do banco: a guarda usa o `URL` do WHATWG; o pool usa o parser do postgres.js 4.0.0.

### Evidência

Central fechada (sem `ADMIN_CENTRAL`), `next start` na porta 38711/38712:

```
GET  /admin                                        404
-H "RSC: 1" /admin?_rsc=abc                        200   <-- G1-1
-H "RSC: 1" /admin/fila?_rsc=z                     200   <-- G1-1
-H "RSC: 1" /nao-existe?_rsc=z                     404   (comparação)
OPTIONS /admin            400 | OPTIONS /nao-existe 404   <-- G1-2
TRACE /admin/api/estado   500 | TRACE /nao-existe   404   <-- G1-2 (log: "'TRACE' HTTP method is unsupported" em route.js)
POST /admin (Next-Action falso) 404; PUT/PATCH/DELETE/HEAD nas APIs 404; variações de caminho todas 404 (//admin = 308 -> /admin)
robots.txt 404, sitemap.xml 404, nenhum href="/admin" nas páginas públicas sondadas
```

Com `VERCEL=1` (porta 38715): RSC de `/admin/rodadas` responde 200. `/_next/static/chunks/app/(admin)/admin/page-9b687509b7e972c3.js` responde 200. O HTML do 404 de `/admin` traz no payload `"title",{"children":"Central de coleta"}` e o robots `noindex, nofollow, nocache`. O 404 de uma rota inexistente traz `Não consta · Segue o Voto`.

Guarda contra postgres.js (`node --experimental-strip-types`, sem conectar):

```
postgres://admin_central:x@localhost:54329/admin_coleta?host=db.remoto.example.com   guarda=true  host efetivo=["db.remoto.example.com"] porta 5432
postgres://admin_central:x@127.0.0.1:54329/admin_coleta?host=10.0.0.5&port=5432       guarda=true  host efetivo=["10.0.0.5"]
```

Central ligada (porta 38713): o GET com `Host: evil.example.com` ou `Host: rebind.attacker.test` em `/admin/api/estado`, `/admin/api/fila` e `/admin/ficha/...` responde **200**. Os POST com Host, Origin, `Sec-Fetch-Site` ou content-type indevidos respondem 403. O preflight responde 405, sem `Access-Control-*`.

### Achados

**G1-1 (bloqueia o critério 15; não bloqueia o uso local). A requisição RSC de qualquer página da central responde HTTP 200 com a central fechada.**
- Onde: `web/src/app/(admin)/layout.tsx:21`. O `notFound()` no layout vira "árvore de not-found" dentro de um flight 200.
- Cenário: `curl -H 'RSC: 1' https://<produção>/admin?_rsc=1` devolve 200 com `Content-Type: text/x-component`, em vez de 404. O corpo não traz dados do banco, porque a guarda corre antes das consultas. Conferi o corpo inteiro com `VERCEL=1`, de 9 a 10 KB por página: 0 `adm-`, 0 `data-estado`, 0 `/admin/api/`, 0 `leg.br`, 0 "pendência"; uma ocorrência de "Central de coleta", que é o título. Mas traz:
  - a árvore `(admin)/admin/__PAGE__`;
  - o caminho do chunk `static/chunks/app/(admin)/admin/page-*.js`;
  - o CSS da central.
- Por que importa: contradiz "TODA rota responde 404 (status)". A prova do roteiro não pega isso: `varrer` só faz GET e POST simples.
- Correção, em ordem de força:
  1. tirar o grupo `(admin)` do build de produção, gerando a rota só quando `ADMIN_CENTRAL=1` no build (passo de build ou `pageExtensions` condicional);
  2. ou um `middleware.ts` com `matcher: ['/admin/:path*']` que devolve `new Response(null, {status: 404})` quando a regra pura `decidirAcesso(process.env)` nega. A regra só usa `URL` e strings, então roda no Edge padrão. Com a variável ausente em tempo de execução, nega: falha fechada. Não conferi se o runtime nodejs de middleware é estável no Next 15.5.28 instalado; não dependa dele. O matcher restrito não toca o site público.
- Em qualquer caso, acrescentar à prova o cabeçalho `RSC: 1` e os de prefetch.

**G1-2 (bloqueia o critério 15; impacto baixo, só revela que a rota existe). Métodos que a rota não usa não dão 404.**
- Onde: as páginas do grupo (OPTIONS dá 400) e `web/src/app/(admin)/admin/api/*/route.ts` (TRACE dá 500; métodos desconhecidos dão 400).
- Cenário: `OPTIONS /admin` dá 400 e `OPTIONS /nao-existe` dá 404. `TRACE /admin/api/estado` dá 500 e `TRACE /nao-existe` dá 404. A existência da rota aparece pela diferença.
- A prova `sem-navegador.mjs` passa sem medir isso: ela só considera "método não usado" os stubs exportados, e só bate GET e POST.
- Correção: o middleware do G1-1 resolve os dois. Sem middleware, OPTIONS em página e TRACE não têm como ser guardados no App Router.

**G1-3 (corrigir). A checagem de "banco local" lê a URL de um jeito e o pool conecta de outro.**
- Onde: `web/src/lib/admin/guarda-regra.ts:22-29` checa `new URL(url).hostname`. `web/src/lib/admin/db.ts:18` passa a URL ao postgres.js, que usa `query.host` antes do host da URL (`node_modules/postgres/src/index.js:578`).
- Cenário: `ADMIN_DATABASE_URL=postgres://u@localhost/db?host=banco.remoto` libera a central e conecta no remoto. Basta um erro de configuração para a central passar a ler e gravar num banco não local. É também uma requisição de saída do servidor (G3).
- Correção, uma das três:
  - em `decidirAcesso`, recusar URL com parâmetro `host`, `hostaddr` ou `port`;
  - ou montar o pool com `host` e `port` explícitos tirados do `URL` já checado;
  - ou validar `postgres(url).options.host` todo contra a lista local.
- Acrescentar o caso a `admin-guarda.test.ts`, que hoje não o cobre.

**G1-4 (corrigir). Com a central ligada, GET e páginas não conferem o `Host`.**
- Onde: `recusarOrigemExterna` só é chamada nos POST (`api/pedidos/route.ts:13` e `api/decisoes/route.ts:13`). O layout e os GET não a chamam.
- Cenário: DNS rebinding. Um site que o dono abra no navegador, com o domínio apontando para 127.0.0.1, lê na mesma origem:
  - `/admin/api/estado`, `/admin/api/fila` e `/admin/api/ficha/...`;
  - pendências, evidências, `identity_match_queue` (inclusive `raw`), rodadas e `cache_dir`.
- Escrita não sai, porque o POST confere o Host. Só leitura.
- Correção: conferir o Host (`localhost`, `127.0.0.1`, `[::1]`) dentro de `exigirAdmin` e `exigirAdminApi` (via `headers()`), ou no middleware do G1-1.

**G1-5 (anotar). O 404 da central se distingue do 404 comum.** O metadata do layout `(admin)` sai mesmo com o `notFound()`: título "Central de coleta" no payload e robots `noindex, nofollow, nocache`. Isso confirma a rota a quem sonda. Some com o G1-1 (opção 1 ou middleware).

**G1-6 (anotar). Os chunks de cliente da central entram em todo build e são servidos com a central fechada.** Exemplo: `/_next/static/chunks/app/(admin)/admin/page-9b687509b7e972c3.js` responde 200 com `VERCEL=1`. É código, não dado. Some com a opção 1 do G1-1.

O que está correto:
- o 404 do HTML vem no status;
- não há `loading.tsx`, Suspense nem template no grupo;
- toda função de `consultas.ts` chama a guarda antes;
- o pool é criado sob demanda;
- não há server action;
- não há geração estática;
- `VERCEL=""` bloqueia;
- não há link público, sitemap nem robots apontando para a central.

---

## G2. Com as chaves dos agentes desligadas, nada que parte da central vira escrita de agentes

Limite do que se pode afirmar: a central **altera tabela de domínio, por desenho**, em dois caminhos.
- Pedido de rodada ou recoleta: o executor roda coletores do catálogo, que gravam domínio (Parte A).
- Decisão de pessoa com `aplicar`: `aplicar.aplicar` grava domínio, e `corrections` quando cabe.

A garantia verificável é mais estreita:
- (i) o parecer é só ensaio e não escreve fora de `adm_pareceres`;
- (ii) a decisão pela tela é sempre `pessoa`;
- (iii) nenhum parâmetro do pedido liga chave, escolhe motor, injeta argv ou env, ou escolhe coletor fora do catálogo.

Os três valem.

### O que tentei

- Li inteiros `executor.py`, `decisoes.py` e `aplicar.py`.
- Li as partes de `rodadas.py` (`_abrir`, `abrir`, `executar`, `repetir`, `_runner`), `parecer.py` (`gerar`, `escolher_motor`, `aplicar_por_agentes`) e `catalogo/contrato.py` (`Recorte`, `_nao_suportado`, `_sapl_camaras`).
- Segui cada campo:
  - `extras`: só chaves de `recortes_aceitos`; `escopo` validado contra `capitais` ou `todas`; `casas` não é aceito por nenhum coletor;
  - `forcar_urls`: na recoleta, a evidência é filtrada pelas URLs de entrada da prévia, e `_abrir` valida de novo;
  - `repetir`: reabre com o coletor e o recorte gravados na rodada de origem; não herda `forcar_urls`;
  - `aplicar=true` com ação que não aplica: falha no executor e no `aplicar`;
  - `por_tipo`: não existe na tabela; o executor passa `'pessoa'` fixo;
  - `env_extra`: o executor não o passa, e `rodadas.executar` recusa a variável da chave.
- Corrida entre dois executores: `for update skip locked`, mais `update ... where status='em_execucao'`, mais a decisão no mesmo savepoint que a finalização (`_Perdido`).
- Pedido `em_execucao` reaproveitado: o índice parcial inclui `em_execucao`; o órfão é liberado em 120 s.
- POST com corpos malformados na central ligada (porta 38713).
- `pytest` dos três arquivos indicados; `npm run test:unit`; o critério 22 do `sem-navegador.mjs`.
- Mutação: uma volta ao motor real escrita para escapar do teste textual (só raciocínio e chamada da função; ver abaixo).
- Busquei se algum coletor do catálogo, ou passo encadeado depois da carga, chama modelo: grep por `verificar`, `rascunho`, `anthropic` e `VERIFICACAO_AGENTICA` em `catalogo/*.py`, `cli.py` e `jobs/`.
  - Os 24 coletores do catálogo (`COLETORES`) não incluem `rascunho`, `verificar` nem `revisar`. Esses só rodam como `job` explícito da CLI (`cli.py:231-245`), e nenhum job de coleta os encadeia. `anthropic` só aparece em `admin/parecer.py`, `jobs/rascunho.py` e `jobs/verificar.py`.
  - Logo, nenhum pedido da central chega a chamada de modelo pelo executor.
  - Escrita de domínio encadeada que existe, por desenho da Parte A: `camara.diario` e `senado.diario` rodam `run_dedupe`, que chama `merge_person` (`cli.py:219-222`, `jobs/identity_dedupe.py:48`). Um pedido de rodada desses coletores, feito pela tela, une pessoas pelo critério do job, não por decisão.

### Evidência

```
cd etl && DATABASE_URL=...admin_coleta ... uv run --frozen pytest -q tests/test_admin_pedidos.py tests/test_admin_grants.py tests/test_admin_chaves.py
82 passed in 25.58s
cd web && npm run test:unit  ->  tests 168, pass 168, fail 0
sem-navegador.mjs, critério 22:
  [pedido gravado pela central] retrato depois idêntico em 102 tabelas (contagem e md5 do conteúdo ordenado)
  nenhuma decisão, override ou correction nova (0|0|0|0 -> 0|0|0|3) ; adm_pareceres ganhou 3 linha(s), todas simulado = true
POST central ligada:
  {"pendencia_id":..,"acao":"aprovar",...,"por_tipo":"agentes"}  -> 400 (campo não aceito)
  {"acao":"descartar","aplicar":true}                            -> 400
  {"tipo":"rodada","parametros":{"coletor":"../../etc"}}          -> 400
  {"tipo":"rodada","parametros":{"coletor":"sapl.camaras","recorte":{"extras":{"escopo":"--force"}}}} -> 200 (gravado; o adaptador recusa na execução: "escopo inválido")
escolher_motor(None, real=True, ambiente={})  ->  modelo ensaio-local, simulado True, nota "motor local no lugar do modelo: a variável ANTHROPIC_API_KEY não está no ambiente"
```

### Achados

**G2-1 (anotar). O teste do critério 22 não pega uma volta ao motor real.**
- Onde: a fixture `_sem_rede_nem_modelo` em `etl/tests/test_admin_pedidos.py:53-72` apaga `ANTHROPIC_API_KEY`. Sem a chave, `escolher_motor(real=True)` cai em silêncio no motor local, com `modelo='ensaio-local'` e `simulado=True`, que é exatamente o que o teste afirma (`:375`, `:386`).
- Cenário: mudar `executor.py:557` para `motor=getattr(par, "escolher_" + "motor")(conn, real=bool(1))` passa no teste dinâmico. Também escapa do teste textual (`:621`), que procura `"escolher_motor"` e `"real=True"`. Em produção, com a chave no ambiente do executor, isso chamaria o modelo.
- O código atual está certo (`motor=par.motor_ensaio_local`). O defeito é de prova.
- Não rodei a mutação na suíte: o comando com `PYTHONPATH` para a cópia mutada foi negado pela permissão. A conclusão vem da leitura e da chamada direta acima.
- Correção:
  - na fixture, pôr `ANTHROPIC_API_KEY="sk-teste-falsa"` (o `anthropic.Anthropic` já está trocado por um que falha);
  - ou afirmar que `saida.motor.nota` é nula ou não diz "no lugar do modelo".

**G2-2 (anotar, é do desenho, igual à CLI). A decisão de pessoa pela tela escreve em domínio sem autenticação.**
- O `base_url` corrigido só precisa ser http(s) com host (`etl/civico_etl/admin/classes.py:47-48,143`).
- Cenário: quem alcança a central local, no mesmo processo, sem login (C4 o adia) e com `por` livre, pode aplicar `corrigir base_url = http://169.254.169.254/` numa Câmara. A próxima carga do `sapl.carregar` busca essa URL.
- O CSRF e o rebinding de POST estão fechados (G1-4 só cobre GET). Fica registrado como risco do caminho de pessoa.
- Sugestão, para depois: limitar o host de `base_url` e `evidence_url` (domínio `.leg.br`, `.gov.br` ou lista) em `valida_candidato`.

**G2-3 (anotar, hoje inalcançável). `unir` aceita quaisquer duas pessoas existentes.**
- Onde: `decisoes.py:_unir` e `aplicar.py:_duplicata` não amarram `de` e `para` ao par da pendência de duplicata.
- Hoje nenhum código cria pendência `tipo='duplicata'` (`proponentes.py:644`).
- Se um dia criar, a tela poderá unir pessoas arbitrárias via `merge_person`.
- Correção: derivar o par do registro da pendência e recusar outro.

**G2-4 (anotar). `por_nome` é texto livre.** Aceita "agentes", e isso vai para `identity_match_queue.resolved_by` (`aplicar.py:254`). `adm_decisoes.decidido_por_tipo` continua `pessoa`, então a trilha principal não engana; o campo do domínio, sim. Sugestão: recusar nomes reservados.

---

## G3. Nenhuma requisição da central sai para host externo

### O que tentei

- Busca no fonte de `(admin)`, `lib/admin`, `components/admin` e `admin.css` por URL absoluta, `fetch`, `<img>`, `<link>`, `<script>`, `@import`, `url(`, WebSocket, `import()` e `next/image`. Os quatro `fetch` são relativos: `/admin/api/*` e `/geo/*.json`.
- Os imports da central não saem de `lib/admin` e `components/admin`. A exceção é o layout raiz, com fontes Fontsource locais e `globals.css` só com `@import` local.
- O servidor: os route handlers e `consultas.ts` só usam postgres.js; não há `fetch` no servidor.
- Rodei `sem-rede-externa.mjs --sem-build`: passou.
- As URLs de evidência (`sapl.al.*.leg.br`) aparecem como texto, nunca em `href` ou `src`.

### Evidência

```
sem-rede-externa.mjs: "nenhum <script src>, <link href>, <a href>, <img>, ... externo em N páginas"; 4 fetch, todos relativos; RESULTADO: tudo passou
URLs absolutas no HTML/recursos: só namespaces XML, textos de erro do React/Next, casos de teste do polyfill core-js, licença Tailwind e URLs SAPL como texto
```

### Achados

- O G1-3 vale aqui: com `?host=`, o processo da central conecta num host externo. É o único caminho de saída do servidor que encontrei. Corrigir.
- (anotar) A prova executada é estática mais HTML, não observação de rede. O critério 23 pede um teste ponta a ponta que falhe em qualquer requisição externa. Esse teste existe (`web/e2e-admin/rede.spec.ts`), está correto pela leitura, mas não rodou (Playwright fora do sandbox, AC-05). O roteiro estático depende de uma lista de exceções escrita à mão e não vê requisições montadas em tempo de execução. Hoje não há nenhuma, porque os `fetch` são resolvidos no fonte.

---

## G4. Grants do role `admin_central` (migração 0153), conferidos no banco

### O que tentei

Como superusuário, no `admin_coleta_c7`:
- `pg_roles`, `pg_auth_members`, `information_schema.role_table_grants` e `column_privileges` (do `admin_central` e de PUBLIC);
- funções `SECURITY DEFINER`, gatilhos das duas tabelas de pedido, `pg_policies`;
- privilégio de schema, `pg_default_acl` e `datacl`.

Como `admin_central` (login local), no `admin_coleta_c7`, tentei a bateria abaixo.

### Evidência

```
rolsuper f | rolcreaterole f | rolcreatedb f | rolreplication f | rolbypassrls f | membership: nenhuma (nos dois sentidos)
grants: SELECT em 12 adm_* + 12 de domínio; INSERT só em adm_pedidos e adm_pedidos_decisao; nenhum grant a PUBLIC em tabela; pg_default_acl vazio
SECURITY DEFINER no banco: 0 funções. Gatilhos em adm_pedidos/adm_pedidos_decisao: só *_guard (before update)
schemas: CREATE em nenhum; USAGE em public e extensions
update/delete/truncate adm_pedidos(_decisao)         -> permission denied
insert status concluido / em_execucao / rodada_id / decisao_id -> new row violates row-level security policy
insert adm_decisoes/adm_overrides/pipeline_switches/corrections/adm_pareceres/adm_rodadas/sapl_houses -> permission denied
select people/pipeline_switches/corrections/profiles/follows/person_external_ids/pg_authid -> permission denied
set role postgres/web_writer/web_reader; set session authorization -> permission denied
merge_person -> permission denied; adm_pedidos_guard() -> só como gatilho
create table public.x / create schema / create function -> permission denied ; create temp table -> OK (TEMP de PUBLIC)
copy ... to program / to file; pg_read_file; lo_import -> permission denied
alter role ... superuser/bypassrls; grant admin_central to postgres -> permission denied
alter role admin_central password 'x' -> ALTER ROLE   (G4-3; restaurei para 'admin_central' na hora e conferi o login)
create extension dblink -> permission denied
```

Inserção aceita pela policy, dentro de `begin ... rollback`:
- `adm_pedidos` com `criado_em='1970-01-01'`, `chave_idem='qualquer-coisa'` e `id` escolhido;
- um segundo pedido igual com outra `chave_idem`;
- `adm_pedidos_decisao` com `por_nome='agentes'` e `criado_em='1970-01-01'`.

Autenticação: `PGPASSWORD=errada` conecta por socket e por TCP em localhost (`trust`). `has_database_privilege('admin_central','civico','connect'|'temp')` dá `t|t`; `datacl` de `civico`, `admin_coleta*` e `postgres` é nulo, ou seja, o padrão (CONNECT e TEMP para PUBLIC).

### Achados

**G4-1 (corrigir). A policy de insert deixa o cliente escolher `criado_em`, `chave_idem`, `id` e `parametros`.**
- Onde: `db/migrations/0153_admin_central.sql:132-137`.
- Cenários:
  - `criado_em` no passado põe o pedido na frente da fila (`SQL_CANDIDATOS` ordena por `criado_em`) e liga em falso o aviso "executor parado" (`fila_velha`);
  - `chave_idem` arbitrária fura o critério 20 na camada do banco: dois pedidos de rodada iguais em curso;
  - `parametros` livre é revalidado pelo executor, então o impacto se limita ao que o catálogo aceita.
- A central em si grava certo; o furo é para qualquer cliente do role, que com `trust` é qualquer processo local.
- Correção, respeitando a restrição 4 (nenhuma migração existente se altera) e a 3c (nenhuma asserção existente muda):
  - numa migração NOVA (`0154`), trocar a policy `admin_central_insere` por uma que também exija `criado_em` entre `now() - interval '5 seconds'` e `now() + interval '5 seconds'` (ou `id` e `criado_em` iguais ao default, conferidos por gatilho `before insert`);
  - no executor, recalcular `chave_idem(tipo, normalizar(parametros))` e recusar, como `falhou`, o pedido cuja chave diverge.
- O grant por coluna (`grant insert (tipo, parametros, chave_idem)`) NÃO serve: quebra `test_matriz_de_colunas_exata_e_sem_grant_por_coluna`.

**G4-2 (anotar). Login no cluster inteiro.**
- O `post_0003` dá `login` com senha de desenvolvimento a um role que existe em todo o cluster.
- Com o `pg_hba` em `trust`, a senha nem é conferida.
- O role tem CONNECT e TEMP em todo banco do cluster, `civico` (a cópia de trabalho do dono) incluído. Lá ele enxerga o que estiver concedido a PUBLIC, e os grants da 0153, se ela tiver sido aplicada lá. Não conectei ao `civico` (proibido).
- Correção: `revoke connect on database civico, postgres from public` não cabe nesta entrega. Basta documentar a ressalva em `post_0003` e acrescentar, num teste NOVO, a conferência de `has_database_privilege` em outros bancos.

**G4-3 (anotar). O role pode trocar a própria senha (`alter role admin_central password ...`).** É padrão do Postgres e não amplia privilégio. Sob `trust` é irrelevante. Fica registrado porque eu o fiz durante a verificação e restaurei.

**G4-4 (anotar).** `0153_admin_central.sql:14` diz "onze tabelas de domínio", mas o laço da linha 124 lista doze (`sapl_houses`, `data_coverage`, `mandate_contacts`, `mandates`, `places`, `legislative_bodies`, `offices`, `identity_match_queue`, `sources`, `ingest_runs`, `dataset_stamps`, `etl_schedule_attempts`). A matriz do teste bate com o banco; o erro é do comentário. Pela restrição 4, a 0153 não se edita: fica só o registro.

**Observação (anotar).** O role lê `identity_match_queue.raw`, o registro bruto da fonte. Se ele trouxer dado pessoal, ele vaza pelo G1-4. Não consegui conferir o conteúdo: a tabela está vazia no `admin_coleta`.

---

## Crítica dos roteiros de prova

- `sem-navegador.mjs`, critério 15:
  - `varrer` só faz GET (páginas) e GET/POST (API). Não manda `RSC: 1`, não manda OPTIONS em página, não manda TRACE nem método desconhecido.
  - O teste "métodos que a rota não usa também respondem 404" só cobre o que tem stub exportado. Por isso passa sem medir G1-1 e G1-2.
  - Não testa `ADMIN_DATABASE_URL` com `?host=`.
  - O resto mede de verdade: o retrato do 22 cobre 102 tabelas por contagem e md5, e o 19 compara campo a campo.
- `sem-rede-externa.mjs`: é coerente, mas é análise estática mais HTML (ver G3).
- Efeito colateral: `sem-navegador.mjs` reescreve o arquivo versionado `replica/prompts/evidencias/central-sem-navegador.txt` a cada execução (data e ids). Depois de rodar, restaurei o conteúdo do HEAD com `git show HEAD:<arquivo> > <arquivo>`, sem comando git que mude estado. `git status` voltou a mostrar só os dois não rastreados que já existiam.
- O `pytest` indicado (`DATABASE_URL=.../admin_coleta`) roda contra `admin_coleta`. Rodei como instruído. A própria suíte afirma que "o banco da suíte" não muda (`test_admin_pedidos.py:50`).

## O que não consegui verificar

- Navegador e Playwright (`rede.spec.ts`, `central-desligada.spec.ts`, critérios 21 e 26): não abrem no sandbox (AC-05).
- A mutação do G2-1 rodando na suíte: o comando com `PYTHONPATH` para a cópia mutada foi negado pela permissão. A conclusão vem da leitura e da chamada direta de `escolher_motor`.
- O que `admin_central` lê no banco `civico`: proibido tocar.
- O comportamento na Vercel de verdade: só simulei com `VERCEL=1` num `next start` local, sem tocar produção.
- O conteúdo real de `identity_match_queue.raw`: a tabela está vazia nos bancos permitidos.
- Execução real de coletor por pedido da central (rede externa): só no modo simulado do roteiro.
