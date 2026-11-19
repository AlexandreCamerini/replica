# Reverificação da Parte C: correções do C11 (commit 51463d1)

- Reverificador: Opus, independente, contexto limpo. Data: 2026-11-17.
- Branch `claude/hopeful-lewin-176541`, HEAD `51463d1`. Build `web/.next` de 07:29, com o middleware; nenhum arquivo de `web/src` é mais novo que ele.
- Base da comparação: relatório `verificacao/parte-c-opus.md`, decisão AC-21, diff `git show 51463d1` e prompt `replica/prompts/admin-coleta-enriquecimento.md` (Parte C).

## Resumo

| Garantia | Veredito | O que pesa |
| --- | --- | --- |
| G1, critério 15 | NÃO ATENDE pela letra, só por TRACE | Com a central fechada, todo método responde 404 em toda rota, exceto TRACE, que dá 500 em qualquer `/admin*` (o C11 estendeu o 500 às páginas). O risco é desprezível: é aceitável como exceção SE o dono a aprovar (ver o julgamento abaixo). O AC-21 se autoaprovou; esta reverificação não repete a aprovação. O ambiente é lido em tempo de execução, conferido nos dois sentidos. O site público não muda. |
| G1-4 e G1-3, Host e URL do banco | NÃO ATENDE (só por G1-3) | G1-4 está corrigido. G1-3 está corrigido só em parte: `postgres://u@localhost#@remoto/db` passa na guarda e o driver conecta em `remoto` (achado N1). |
| G2, critérios 22 e 9 | ATENDE | O teste mata o mutante do G2-1. `test_A` está verde. A nova checagem de `chave_idem` não deixa pedido preso. Há dois efeitos colaterais, de severidade "anotar" (N3 e N4). |
| G4, grants | ATENDE COM RESSALVA | A 0154 é só aditiva e os grants não mudaram. Mas a janela usa `now()`, que é o início da transação: uma transação longa retroage `criado_em` sem limite (N2). |
| G3, critério 23 | ATENDE COM RESSALVA | O middleware não faz saída. O furo N1 deixa o servidor da central conectar num host externo se a configuração estiver errada. |

## Achados do primeiro verificador

| Achado | Situação | Prova |
| --- | --- | --- |
| G1-1, RSC respondia 200 | corrigido | Central fechada. Status 404 com corpo vazio em todos estes casos: `RSC: 1` com `?_rsc=`, prefetch, `Next-Router-Segment-Prefetch` em `/admin.segments/_tree.segment.rsc` e `/admin/fila.segments/...`, `/admin.rsc`, `/admin/fila.rsc`, `_next/data/x/admin.json`. Também nas variações `%61dmin`, `%2561dmin`, `admin%2Ffila`, `/admin/x/../fila`, `/admin/./fila`, `/x/../admin`, `/ADMIN`, `/admin;x`, `%00`, `%20`, `%09`. Com a central LIGADA, essas mesmas variações dão 404 (o roteador não as leva à central): o middleware não deixa caminho codificado chegar ao layout. `//admin` e `/admin/` dão 308 para `/admin`, que dá 404 (normalização do Next, anterior ao middleware). |
| G1-2, OPTIONS 400 e TRACE 500 | parcialmente corrigido | OPTIONS, HEAD, PUT, DELETE, PROPFIND e POST com `Next-Action` dão 404. TRACE continua 500 em `/admin`, `/admin/fila`, `/admin/api/estado` e também em `/admin/zzz-inexistente`. TRACK dá 400, igual a `/zzz`, então não distingue. CONNECT fecha o socket, comportamento do Node para qualquer caminho. |
| G1-3, `?host=` na URL do banco | parcialmente corrigido | A query (`host`, `HOST`, `%68ost`, `ho%73t`, `hostaddr`, `service`), a vírgula, `?host=/tmp`, `%2Ftmp`, `localhost@remoto`, `a@b@remoto`, `::ffff:7f00:1`, `0.0.0.0`, `127.1` e `localhost.` são recusados ou não são local. **O fragmento `#` passa:** ver N1. |
| G1-4, Host sem checagem nos GET | corrigido | Central ligada. Status 404 para Host `evil.example.com`, `localhost.`, `127.0.0.1.`, `0.0.0.0`, `127.1`, `[::ffff:127.0.0.1]`, `localhost, evil` e `localhost:3000<TAB>evil`. Vale para GET, GET com RSC, POST, OPTIONS e HEAD. Host evil somado a `X-Forwarded-Host: localhost`, `Forwarded: host=localhost`, `x-middleware-subrequest` (as duas formas do CVE-2025-29927), `x-middleware-prefetch` ou `x-invoke-path`: também 404. HTTP/1.0 sem Host: 404. |
| G1-5, título do 404 | corrigido nas rotas do matcher | O 404 sai sem corpo. |
| G1-6, chunks JS servidos | não corrigido | Estava como "anotar". Está fora do matcher, por construção. |
| G2-1, teste do 22 cego ao motor real | corrigido | Rodei uma mutação em memória, sem tocar o repositório: um plugin de pytest em `$TMPDIR` reescreve `executor._parecer` para `motor=getattr(par, "escolher_" + "motor")(conn, real=bool(1))`. `test_criterio_22_...` fica vermelho: `1 passed, 1 error`, rc=1, `assert vistos == []` com 4× `parecer._cliente_real`. Sem a mutação, passa. Nota: a falha sai no teardown, porque `escolher_motor` engole a exceção e cai no motor local. Basta para ficar vermelho. |
| G4-1, policy deixava escolher `criado_em` e `chave_idem` | parcialmente corrigido | Explícito `-6 s`, `+10 min`, `'2000-01-01'`, `-infinity` e `NULL`: recusados. `default` e `now()-4 s`: aceitos. **Transação longa:** `begin; select pg_sleep(7); insert ... (default)` é aceita com `criado_em` 7 s no passado. Ver N2. `chave_idem` forjada: o executor falha o pedido sem efeito, e os testes novos passam. |
| G4-2, G4-3, G4-4, G2-2, G2-3, G2-4 (todos "anotar") | sem mudança | Continuam como anotados no AC-21. |

## Julgamento da ressalva de TRACE

Medido com a central fechada:

| Requisição | Status |
| --- | --- |
| TRACE em qualquer `/admin*`, inclusive inexistente | 500 genérico, 2140 bytes, sem dado nem título da central |
| TRACE `/zzz` | 404 |
| TRACE `/` e `/decisoes` (páginas públicas tratam TRACE como GET) | 200 |
| TRACE `/api/places` (route handler público) | 500, o mesmo |

**Pela letra, o critério 15 não está cumprido para o método TRACE.** O critério diz "toda rota responde 404", e TRACE em `/admin` se distingue de `/zzz`.

**Julgo a ressalva aceitável como exceção registrada, não como cumprimento.** Ela não derruba o objetivo do critério:
- nenhum navegador emite TRACE (a especificação do `fetch` o proíbe), então os vetores do modelo de ameaça (DNS rebinding, CSRF) não o alcançam;
- não sai dado nem há escrita;
- a única informação é "o prefixo `/admin` é tratado", e os chunks JS públicos (G1-6, já aceito como anotar) entregam isso;
- o mesmo 500 aparece em route handler público.

Isso exige três coisas:
- o dono aceitar a exceção explicitamente;
- `sem-navegador.mjs` não marcar `ok`. Hoje ele converte a violação em aprovação (`limite && every 500`). Deve registrar como EXCEÇÃO, à parte do `ok`;
- o AC-21 corrigir uma imprecisão. Por inferência, o middleware piorou TRACE nas PÁGINAS:
  - sem middleware, uma página trata TRACE como GET (é o que TRACE `/` = 200 mostra), e o `notFound()` do layout daria 404;
  - antes do C11, o verificador 1 só viu 500 nas APIs;
  - agora as 13 rotas, e qualquer `/admin/*`, dão 500.
  - Não pude medir o build anterior; isto é inferência.

**Existe uma correção simples no App Router** que a equipe não adotou para TRACE (o verificador 1 a chamou de opção 1): exclusão em tempo de build.
- Como funciona:
  - renomear os arquivos do grupo `(admin)` para `*.admin.tsx`/`*.admin.ts`, e o middleware para `middleware.admin.ts`;
  - no `next.config.ts`, `pageExtensions` passa a ser `["tsx","ts","jsx","js"]`, mais `["admin.tsx","admin.ts"]` só quando `ADMIN_CENTRAL=1` no build.
- Sem servidor custom e sem dependência nova. Não toca no site público: a lista padrão continua.
- Resultado: todo build sem a variável (produção, Preview e CI) não tem rota nem middleware da central, e TRACE dá o mesmo 404 de `/zzz`. G1-5 e G1-6 também somem.
- Custos:
  1. Só resolve builds sem a variável. Um build local feito com ela e servido sem ela continua com TRACE 500.
  2. É renomeação estrutural, e testes e roteiros citam caminhos.
  3. Premissa confirmada no código do Next 15.5.28: a detecção do middleware no build usa `pageExtensions` (`node_modules/next/dist/build/index.js:546`, ``new RegExp(`^${MIDDLEWARE_FILENAME}\\.(?:${config.pageExtensions.join('|')})$`)``). Logo, `middleware.admin.ts` fica fora do build sem a variável. Medi só a leitura do código; não fiz o build com a renomeação, porque exigiria alterar o repositório.
- A premissa testável vale: TRACE em caminho fora do matcher (`/zzz`) dá 404.
- Dentro do middleware não há saída: o 500 sai antes da função. `redirects` e `headers` do `next.config` não casam por método.

## Achados novos

**N1 (corrigir; derruba G1-3 e é ressalva de G3). O fragmento `#` faz a guarda e o driver lerem hosts diferentes.**
- Onde: `web/src/lib/admin/guarda-regra.ts:29-34`. A guarda usa `new URL(url).hostname` e corta o authority em `[/?#]`. O driver (`web/node_modules/postgres/src/index.js:550-565`) corta só em `[/?]` e usa o último `@`.
- Prova, com `postgres(url).options` e sem conectar:

  | URL | guarda | host efetivo do driver |
  | --- | --- | --- |
  | `postgres://u@localhost#@remoto.example.com/db` | true | `["remoto.example.com"]` |
  | `postgres://u@localhost:54329#@remoto.example.com:5432/admin_coleta` | true | `["remoto.example.com"]`, porta 5432 |
  | `postgres://u@localhost#,remoto/db` | true | `["localhost#","remoto"]` (ao repor uma conexão, o pool passa ao próximo host: `pool.js:510`, `(c.index + 1) % options.host.length`) |

- Ponta a ponta: subi `next start` com `ADMIN_DATABASE_URL=postgres://admin_central:admin_central@localhost:54329#@203.0.113.7:54329/admin_coleta_c7` (TEST-NET, não roteável).
  - `/admin` deu 200: a central liberada.
  - `/admin/api/estado` deu 503: o pool tentou o host remoto, não o local.
- Cenário: erro de configuração, ou cópia de URL com `#`. A central lê e grava num banco não local, e o servidor faz conexão de saída.
- Casos menores que a guarda aceita e não levam a host remoto (o driver tenta um nome que não resolve): `localhost<TAB>`, espaço inicial, `LOCALHOST`.
- Correção (uma das duas, melhor as duas):
  - (a) em `decidirAcesso`, recusar `#`, espaço e caractere de controle na URL e calcular o authority como o driver;
  - (b) em `db.ts`, depois de `postgres(url, ...)` e antes da primeira consulta, exigir que `sql.options.host` tenha só hosts locais e que `sql.options.path` seja falso. Assim o próprio driver é a fonte da verdade.
- Acrescentar os três casos a `admin-guarda.test.ts`.

**N2 (corrigir, impacto baixo). A janela da 0154 usa `now()`, que é o início da transação.**
- Onde: `db/migrations/0154_admin_central_criado_em.sql:29-32`.
- Prova, como `admin_central` no `admin_coleta_c7`: `begin; select pg_sleep(7); insert into adm_pedidos (tipo, chave_idem) values ('rodada','g4-sleep')` foi aceito com `criado_em` 7 s atrás. Nada limita esse tempo:
  - `rolconfig` vazio;
  - `idle_in_transaction_session_timeout = 0`;
  - `statement_timeout = 0`.
- Cenário: um cliente local segura uma transação por N minutos e insere com `default`. O pedido entra no banco já velho:
  - fura a fila contra tudo o que entrou nesse intervalo;
  - acende "executor parado" (`fila_velha`) se N for maior que o limite;
  - reabre parte do G4-1.
- Correção: nova migração (a restrição 4 proíbe editar a 0154) que recria a policy com `clock_timestamp()` nos dois limites. O default `now()` de uma transação curta continua dentro da janela.
- O uso legítimo NÃO quebra:
  - a central insere em transação curta com `default`: `SQL_PEDIDO_INSERIR` e `SQL_PEDIDO_DECISAO_INSERIR` não mandam `criado_em`;
  - `sem-navegador.mjs` passou inteiro, inclusive o fluxo da central.
- Fica ainda, para anotar: o cliente escolhe `criado_em` dentro de ±5 s.

**N3 (anotar; regressão de disponibilidade introduzida pelo C11). O JSON canônico do TS e o do Python divergem em casos-limite de `valor`.**
- Onde: `web/src/lib/admin/sql.ts:23-42` (`JSON.stringify` e `.sort()` por unidade UTF-16) e `etl/civico_etl/admin/executor.py:140-142,237-242` (`json.dumps` e ordenação por code point, depois da volta pelo jsonb).
- Prova, por diferença com a volta pelo jsonb:

  | `valor` | TS | Python | Resultado |
  | --- | --- | --- | --- |
  | `1e21` | `1e+21` | `1000000000000000000000` | DIFERE |
  | `1.5e-7` | `1.5e-7` | `1.5e-07` | DIFERE |
  | `{"￿":1,"😀":2}` | ordem UTF-16 | ordem por code point | DIFERE |
  | textos, inteiros, `1.5`, objetos ASCII, acentos | | | IGUAL |

- Cenário: uma decisão legítima `corrigir` com esses valores, que antes do C11 executava, agora falha com "chave_idem não confere com os parâmetros".
- Correção: no executor de decisão, comparar com a chave recalculada sobre `jsonb` normalizado dos dois lados. Ou validar `valor` na central: só texto, ou objeto de textos com chave ASCII.

**N4 (anotar; por leitura, não executado). Ocupação da chave: um pedido forjado engole o legítimo.**
- Um cliente com o role grava o pedido A com parâmetros X e a `chave_idem` que um pedido legítimo Y terá.
- Quando o dono pede Y, o `where not exists` da central devolve o id de A ("dois cliques = um pedido").
- O executor falha A por chave divergente, e Y nunca entra na fila.
- É só negação de serviço, e exige processo local com o role (`trust`).
- Correção: na central, ao achar pedido existente, conferir que os parâmetros dele são os mesmos. Ou deixar documentado.

**N5 (anotar). Host duplicado.**
- `Host: localhost` seguido de `Host: evil.example.com`, em socket cru, dá 200: o Node fica com o primeiro.
- Navegador não manda Host duplo, então o rebinding não alcança. Registro só para constar.

## O que mais conferi

- **Site público inalterado.** Central fechada contra ligada, com status e tamanho idênticos:
  - `/` 200;
  - `/?_rsc` 200;
  - `/decisoes` 200;
  - `/decisoes?_rsc` 200;
  - `/pessoa/zzz-nao-existe` 404;
  - `/api/places` 400;
  - `/api/health/fontes` 503;
  - `/administracao` e `/admin-x` 404.

  Nenhum cabeçalho `x-middleware-*`. O matcher do manifesto (`functions-config-manifest.json`) só casa `/admin` e `/admin/...`, com as variantes `.rsc` e `.segments`.
- **Middleware.** Importa só `guarda-regra.ts`. O bundle `.next/server/middleware.js` não importa o driver `postgres` nem `server-only`: a única ocorrência de "postgres" é o literal de protocolo da regra (`"postgres:"!==c.protocol`). Os dois `fetch(` são do runtime do Next. Nenhuma saída de rede.
- **Ambiente lido em tempo de execução.**
  - Fiz um build NOVO em `web/.next-reverif` COM `ADMIN_CENTRAL=1` e `ADMIN_DATABASE_URL`. No bundle, `"1"!==a.ADMIN_CENTRAL` lê o objeto `process.env`; nada foi embutido.
  - `next start` desse build:

    | Ambiente ao subir | `/admin`, `/admin/fila?_rsc`, `/admin/api/estado` |
    | --- | --- |
    | sem variáveis | 404 |
    | com as variáveis + `VERCEL=1` | 404 |
    | com as variáveis + `VERCEL_ENV=production` | 404 |
    | com as variáveis (controle) | 200 |

  - No sentido contrário: o build `web/.next` (o do roteiro), subido com as variáveis, libera (200).
- **Testes.**
  - `pytest` dos cinco arquivos indicados: 143 passed, inclusive `test_admin_chaves.py::test_A` e os testes novos do C11.
  - `npm run test:unit`: 170 pass, 0 fail.
  - `sem-navegador.mjs --sem-build`: tudo passou. Ver a crítica abaixo.
  - `sem-rede-externa.mjs --sem-build`: tudo passou.
- **Executor (G2).**
  - A chave recalculada falha antes de qualquer efeito, e `executar_um` finaliza o pedido como `falhou`.
  - Parâmetro que não normaliza cai no próprio tipo, que normaliza de novo e falha.
  - Exceção inesperada vira `falhou` pelo `except Exception`.
  - `BaseException` vira `interrompido`.
  - Nenhum caminho deixa o pedido preso em `em_execucao`. Se o processo morrer, o órfão é liberado em 120 s.
  - A decisão continua `por_tipo="pessoa"` fixo.
- **Grants.**
  - A matriz `information_schema.role_table_grants` do `admin_central` tem md5 idêntico em `admin_coleta_r1` (sem a 0154), `admin_coleta_c7` e `admin_coleta`: 26 linhas.
  - A 0154 só cria duas policies.

## Crítica dos roteiros

- `sem-navegador.mjs:309-314` aceita TRACE 500 como `ok` quando o log traz a mensagem do Next. Isso transforma a violação da letra em aprovação. Deveria sair como EXCEÇÃO, com contagem à parte.
- `criterio15Host` (`:326-346`) só manda GET com Host ruim. Eu medi RSC, POST, OPTIONS e HEAD: todos dão 404. Vale acrescentar.
- `admin-guarda.test.ts` não tem caso com `#`: é por isso que N1 passou.

## O que não consegui verificar ou deixei pendente

- O TRACE nas páginas ANTES do C11 (404, que eu inferi): não havia build anterior, e não criei worktree.
- O build com a renomeação para `*.admin.*`: confirmei a premissa só no código (`build/index.js:546`).
- O comportamento da Vercel com TRACE.
- O roteiro Playwright (fora do sandbox, AC-05).
- O banco `civico`: não toquei, por instrução.
- **Sobras no disco que não consegui apagar.** O `rm` foi negado pela permissão, e não contornei. Peço que o chamador apague:
  - `web/.reverif-url.mts`: cópia acidental do meu script de comparação de URL, não rastreada;
  - `web/.next-reverif/`: o build de teste, não rastreado.
- **Arquivos restaurados ao HEAD** com `git show HEAD:<arq> > <arq>`:
  - `replica/prompts/evidencias/central-sem-navegador.txt`, que o roteiro regravou;
  - `web/tsconfig.json`, que o `next build` alterou (acrescentou `.next-reverif/types/**/*.ts` e reordenou a lista).

  `git status` mostra só as sobras acima e os dois não rastreados que já existiam.
- A senha do `admin_central` não foi alterada. Os `next start` que subi foram parados pelo `parar()` do `comum.mjs`, em grupo de processos.
