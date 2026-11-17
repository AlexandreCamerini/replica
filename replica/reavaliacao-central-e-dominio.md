# Reavaliação da central de coleta e publicação em www.segueovoto.com.br

Data: 17/11/2026. Objeto: a central de administração de coleta entregue no branch `claude/hopeful-lewin-176541` (63 commits locais, HEAD `5148ddd`), e o que o site público precisa para ir ao domínio próprio.

Pedido do dono: reavaliar UX, UI e arquitetura; a central deve ser acessada de qualquer lugar, não de uma máquina local; o site vai para `www.segueovoto.com.br`.

## 0. Como foi feito e o que não foi visto

- Três revisões independentes, só leitura, sobre o código: UX (Sonnet), UI (Sonnet), arquitetura e publicação (Opus). Os achados centrais de cada uma foram reconferidos no código por mim; os que reconferi levam a marca ✔.
- O documento passou por um verificador independente (Opus), que conferiu as afirmações no código e achou 14 problemas: uma fase faltando no plano, dois riscos omitidos, uma afirmação errada sobre os grants e referências de linha erradas. Todos foram corrigidos nesta versão.
- Ninguém viu a central renderizada. O build não roda no sandbox desta sessão, e a execução que a construiu também nunca abriu um navegador. Tudo o que depende de tela está marcado INFERIDO.
- Nenhum painel foi consultado (Vercel, Supabase, registro.br). O que depende deles está marcado INCERTO.

## 1. Veredito

A central é sólida por baixo e fraca por cima.

- **Por baixo, o desenho aguenta ir para a internet.** A tela nunca escreve no domínio: só grava pedidos, com um papel de banco (`admin_central`) que só insere em tabelas de pedido. Ele lê bastante, porém: todas as tabelas `adm_*` e 12 tabelas de domínio, entre elas `identity_match_queue`, `mandate_contacts` e `mandates` (`0153_admin_central.sql:100-105`), o que inclui dado possivelmente pessoal (B7). O executor é durável (trava por linha, batimento, limpeza de órfãos). Isso se mantém.
- **A camada de acesso foi feita para nunca sair da máquina** e tem de ser invertida, não remendada: a trava recusa Vercel, exige banco local e Host local, e não há login. "Quem decidiu" é texto livre.
- **A tela não está pronta para operar.** Depois da primeira rodada não há como abrir outra pela tela; nenhuma ação atualiza a página; ações com efeito não pedem confirmação; o estado mais crítico (executor parado) tem a mesma aparência do mais banal; o mapa usa faixas que o olho não separa.

Recomendação: **não publicar a central como está.** Primeiro levar a entrega atual ao GitHub e ao CI, depois o domínio do site, depois as migrações, e só então a central com login, num subdomínio próprio. O plano está na seção 6.

## 2. Arquitetura

### 2.1 O que vira bloqueante quando a central fica na internet

| # | Risco | Evidência | Por que bloqueia |
| --- | --- | --- | --- |
| B1 | Sem login; "quem decidiu" é texto livre (`por`), que ainda entra na chave de idempotência | campo em `form-decisao.tsx:58-59`; chave em `lib/admin/sql.ts:42` ✔ | Sem identidade não há auditoria nem responsabilização |
| B2 | Trava de acesso só local: recusa `VERCEL`, exige banco e Host locais | `guarda-regra.ts:19-45`, `middleware.ts:11` ✔ | Na Vercel responde 404 por desenho; precisa ser invertida, e os testes do critério 15 reescritos |
| B3 | `base_url` corrigido pela tela aceita qualquer http(s), inclusive endereço interno, que o executor depois busca com credencial de produção | relato, seção 8 (AC-21) | SSRF a partir da internet |
| B4 | Qualquer e-mail vira usuário autenticado no Supabase | `supabase.ts:37` (`shouldCreateUser: true`) ✔ | "Logado" não pode significar "admin" |
| B5 | Não existe middleware de renovação de sessão do Supabase; o comentário diz que existe | `supabase.ts:26` ✔; `main` sem `middleware.ts` ✔ | Sessão de admin cai de forma intermitente (INCERTO, mas é o padrão do `@supabase/ssr`) |
| B6 | Sem cabeçalhos de segurança: nenhuma CSP nem `X-Frame-Options` (`next.config.ts` sem `headers()`), e as ações disparam num clique (`botao-pedido.tsx:31`) | verificador | Clickjacking: uma página que enquadre a central (um XSS em `www`, que é same-site) faz o admin logado clicar em "Repetir rodada" sem ver. Correção: `frame-ancestors 'none'` e `X-Frame-Options: DENY` no projeto admin |
| B7 | O papel da central lê `identity_match_queue.raw` | relato, seção 8 | Possível dado pessoal exposto: escopo LGPD |
| B8 | Nada foi provado em navegador; o conjunto público (809 testes) nunca rodou com o `middleware.ts` novo | relato, seções 2 e 7 | Risco direto no site público |

Endurecimento, não bloqueante: a checagem de origem aceita POST sem `Origin` e sem `Sec-Fetch-Site` (`guarda.ts:35-38` ✔). Hoje isso não abre CSRF pelo navegador, porque a mesma checagem exige `content-type: application/json` (`guarda.ts:47` ✔): esse tipo força preflight de CORS, que a central não responde. Vale exigir os dois cabeçalhos mesmo assim, para não depender de uma defesa só.

### 2.2 Onde publicar a central

| Opção | Ganha | Paga | Onde quebra |
| --- | --- | --- | --- |
| (a) Mesma app e projeto Vercel do site, `/admin` com login | Custo zero, um deploy | A credencial da central fica no runtime do site público; mesma sessão e mesmos cookies | Um XSS ou SSRF no site alcança a central; Preview usa o mesmo banco de produção |
| **(b) `admin.segueovoto.com.br`, segundo projeto Vercel do mesmo repo** | Segredo e cookie separados (o site não tem nenhuma variável `ADMIN_*` e a trava 404 continua valendo lá); deploy e rollback independentes | Dois builds por push (mitigável por caminho), mais um hostname no Supabase e no Turnstile | O alias `*.vercel.app` do projeto também responde: a trava tem de exigir Host `admin.segueovoto.com.br` |
| (c) App fora da Vercel, atrás de Cloudflare Access ou Tunnel | Duas barreiras; central e executor no mesmo host | Uma VM sempre ligada, patch, monitoração; DNS no Cloudflare | Host caiu, central caiu; no Mac do dono vira "só com o Mac ligado", o que contradiz o pedido |

**Recomendo (b).** (a) não compensa a economia, porque junta a credencial da central à superfície pública. (c) só compensa se o executor já for ganhar uma VM própria (2.4); nesse caso, servir a central da mesma VM via Tunnel é a opção mais forte. Cloudflare Access na frente de (b) fica como endurecimento opcional.

### 2.3 Login e autorização

- Mesmo Supabase Auth e mesmo código por e-mail do site. No projeto admin, middleware com `updateSession` no `/admin/:path*`, e depois a trava.
- Lista de admins em tabela própria (`adm_admins`, com log só de acréscimo), escrita só pelo dono do banco. Não usar só `app_metadata` do Supabase, que só se audita pelo painel.
- MFA obrigatório (TOTP, nível `aal2`). Código por e-mail sozinho é um fator só: a posse da caixa de e-mail.
- Não admin, ou admin sem MFA: 404, como hoje.
- Identidade: migração nova grava `por_user_id` e `por_email` da sessão; o servidor ignora `por` do corpo; um gatilho exige que o usuário conste ativo em `adm_admins`. Limite honesto: isso prova "o servidor afirmou", não "o usuário provou"; identidade inforjável no banco exige escrita por RPC com o JWT do usuário (v2).
- CSRF estrito: manter a exigência de JSON; acrescentar `Origin` presente e igual à origem fixa da central, `Sec-Fetch-Site: same-origin` obrigatório, cookies host-only com `SameSite=Strict`.
- Cabeçalhos de segurança no projeto admin: CSP com `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`.
- Critérios da entrega que deixam de valer como escritos e precisam ser reescritos, não só o 15: o 23 ("nenhuma requisição sai de `localhost`") quebra com o login, que carrega o Turnstile (`components/account/turnstile.tsx:7`) e fala com o Supabase Auth; vira uma lista explícita de hosts permitidos. O 9 (duas chaves) deve ser reconferido com o executor fora da máquina local.
- Rate limit por usuário na própria inserção (sem infra nova); regra na borda da Vercel se o plano permitir (INCERTO).
- Anti-SSRF no executor, não na tela: só https, resolver DNS e recusar IP privado, link-local e loopback.
- A CLI (`admin decidir --por`) continua sem autenticação; fechar exigindo que `--por` conste em `adm_admins`.

### 2.4 Executor de pedidos

A tela só grava pedidos; sem executor rodando, todo botão vira "executor parado". Hoje ele só roda à mão, num terminal local.

| Opção | Clique → início | Custo | Onde quebra |
| --- | --- | --- | --- |
| **Worker contínuo num container pequeno** (mesma imagem e `uv.lock` do ETL, reinício automático) | ~2 s | ~US$ 5-10/mês (INCERTO) | Mais um host com a credencial de escrita do ETL; alguns portais SAPL podem bloquear IP de datacenter (INCERTO) |
| GitHub Actions agendado | 5 min no mínimo; atraso de 85 min já observado | Minutos do Actions | A tela fica quase sempre em "executor parado" |
| Mac via launchd | ~2 s | Zero | Mac desligado, central inútil |
| Função agendada (Vercel Cron, Edge) | — | — | Inviável: executor é Python e uma rodada SAPL leva horas |

**Recomendo o worker contínuo**, com o Actions de hora em hora como reserva que drena a fila se o batimento vencer. A tela deve mostrar a promessa real ("início em até ~5 s") e trocar "Suba o executor local" por um estado operacional ("executor visto há X min").

Cuidado de concorrência: rodada da central e `run-due` no mesmo dataset não corrompem (cada um tem sua trava), mas um dos dois falha com "outro run em andamento". O worker deve evitar a janela do `run-due`, ou o `run-due` tolerar essa falha.

### 2.5 Banco de produção

- Produção está em `0120` mais aplicações à mão. Faltam `0130`, os dois `0131`, `0140` a `0142` e `0150` a `0155`. O runbook cobre quatro delas.
- **Passo zero:** reconciliar `schema_migrations` com o que já foi aplicado à mão. `db/migrate.sh` não tem como marcar uma migração como aplicada nem parar num número; migração aplicada à mão sem registro é reexecutada.
- Gatilhos e RLS sem policy nas tabelas do ETL: provavelmente não quebram, porque o ETL usa o dono das tabelas. Conferir antes, com a URI do ETL e com a do Mac:

```sql
select current_user;
select tablename, tableowner from pg_tables where tablename in ('sapl_houses','data_coverage','mandate_contacts');
select rolname, rolbypassrls from pg_roles where rolname = current_user;
```

- `admin_central` em produção: senha aleatória longa definida fora de migração, `connection limit 5`, `statement_timeout` no papel. Não há `pg_hba` no Supabase gerenciado; a barreira real é senha mais grants mínimos. O papel pode trocar a própria senha, e o Postgres não impede: mitigar com rotação.

## 3. UX

Os cinco que mais custam, em ordem:

1. **Abrir rodada nova só existe enquanto não há nenhuma rodada.** O formulário vive dentro do bloco de "vazio" ✔. Depois da primeira, só "Repetir" ou a CLI. Correção: ação fixa "Abrir rodada" em `/admin/rodadas`, com lista de coletores do catálogo em vez de campo livre.
2. **Nenhuma ação atualiza a tela** ✔. Depois de decidir, o formulário continua preenchido e o histórico não muda; o operador não sabe se foi e reenvia. Correção: atualizar a página no sucesso, limpar o formulário, levar o foco à mensagem e mostrar o status do pedido (na fila, em execução, aplicado, erro).
3. **Ações com efeito não pedem confirmação.** "Aplicar" é um checkbox discreto ao lado de "Pedir decisão"; "Repetir rodada", "Recoletar" e "Abrir rodada" disparam coleta externa num clique. A recoleta vem com a classe pré-selecionada. Correção: resumo antes de enviar (campo, valor atual, valor novo, escopo e número de fichas) e botão que diz o efeito ("Aprovar e aplicar").
4. **A home é um monitor de coleta, e a tarefa diária é decidir pendências.** O total de pendências por classe já é buscado (`consultas.ts:512`) e nunca aparece. Correção: home com "N pendências abertas por classe", estado do executor e rodada em curso numa faixa, e o mapa abaixo.
5. **Erros e textos falam a língua do sistema.** "Estado 35" em vez de São Paulo; ids de banco, UUIDs e status crus; "suba o executor local" para quem está fora da máquina; qualquer falha de rede, sessão ou servidor aparece como "Não foi possível ler o banco" e apaga a região inteira, piscando a cada 5 s (INFERIDO). Correção: tabela de rótulos (UF e município pelo nome, que as malhas já trazem), mensagem por tipo de falha com a próxima ação, manter o último dado com "atualização falhou às HH:MM".

Outros que importam:
- Fila: corte silencioso em 200, sem filtro por UF, vencidas ou reabertas, e sem "próxima pendência" depois de decidir.
- Ficha: valor atual e proposto em texto corrido; deveria ser "Hoje / Proposta" lado a lado, com a evidência recolhida.
- Busca do mapa navega a cada tecla: digitar "Pará" sai antes de chegar a "Paraná".
- Datas em UTC cru; mostrar horário de Brasília e tempo relativo.
- Região viva com polling de 5 s pode ser anunciada sem parar por leitor de tela (INFERIDO).
- Com login: "Decidindo como {nome}" no lugar do campo "Por"; sessão expirada no meio de uma decisão preserva o rascunho e oferece entrar de novo; duas pessoas na mesma pendência veem "decidido por X há N min" e o servidor recusa a segunda.

## 4. UI

Direção: **ferramenta interna, na mesma família visual do site.** Manter papel, tinta, raio 0, borda dupla e a tipografia; assumir densidade (tabelas, números monoespaçados, rótulos) e as cores de estado de sistema que o design v1 já tem (no `DIRECAO.md` são `--warn` e `--err`; no código, `--warning` e `--danger`, em `styles/tokens.css`).

Desvio herdado do site, fora da central: o `--tint` do código é `#858885` (`globals.css:18`, via `--seat`), não o `#9a9d9b` que o `DIRECAO.md:14` fechou. Daí a tinta sobre o preenchimento cheio ficar em 4,48:1, abaixo do 4,6:1 que a direção promete. Vale decidir qual dos dois vale, para o site e para a central. Uma faixa fixa "INTERNO" no topo evita que uma captura seja confundida com o site.

Os cinco que mais custam:

1. **Estado de sistema sem tratamento visual.** O CSS da central não tem nenhuma regra para `data-estado` ✔: "executor parado", "erro de banco" e "nenhuma rodada" saem com a mesma moldura. Correção: selo com palavra e barra em `--warning`/`--danger` nos estados críticos; estado normal rebaixado.
2. **O mapa fica abaixo da dobra na home**, depois de título, alternador, ajuda, executor, rodada e painéis. O alternador Coleta/Revisão muda só o mapa e está longe dele. Correção: faixa de estado, depois mapa com legenda e alternador, depois painéis.
3. **As faixas de contagem não se distinguem.** Opacidades 0,25/0,45/0,7/1 ✔ sobre um `--tint` de `#858885` dão contraste contra o papel de 1,28 a 3,12:1, com 1,2 a 1,5:1 entre faixas vizinhas; uma UF com 1 ficha parece igual a uma com 0. A fronteira é traçada na cor do papel. Correção: faixas 0,35/0,6/0,8/1; contorno fino em tinta entre territórios; número escrito ao lado do território ou na lista, não só no `aria-label`. Cuidado ao tratar o 0: o contorno reforçado em tinta já marca o padrão "vazio" (território com fichas e sem tentativa, `mapa-admin.tsx:207,221` e `admin.css:49`); o 0 precisa de outro sinal, como o "0" escrito, para não ficar igual a "N fichas sem tentativa".
4. **Hachura e pontilhado somem em tela pequena** (INFERIDO): o padrão é definido em unidades do desenho, e a 390 px o ponto vira menos de 1 px. Correção: padrão com tamanho fixo em px de tela, separado da contagem (o estado vai pelo padrão com opacidade fixa, a contagem por texto). **Mantém-se o ponto como retângulo:** a revisão de UI sugeriu `<circle>`, o que contraria a decisão fechada do design v1 e o critério 24; descartado.
5. **Fila, registros e rodadas são parágrafos, não tabelas.** Sem cabeçalho, sem números alinhados, 4 a 6 linhas por pendência. Correção: `<table>` com cabeçalho fixo, colunas Classe, Campo, Tipo, Vence, Cobertura, números tabulares, rolagem horizontal em 390 px.

Outros:
- Valores crus de fonte e espaçamento fora da escala, e cores de reserva que não batem com os tokens (`admin.css:5-10`). Usar `--ds-*` e as classes do v1 (`.chip`, `.lbl`, `.disp`, `.stamp`, `.plate`).
- Navegação e filtros são links sublinhados; deveriam ser `.chip`.
- Tracejado usado para erro e botão desabilitado colide com o pontilhado que no mapa significa "em andamento".
- Aviso "Parecer é ensaio" ocupa um bloco inteiro na ficha; vira selo.
- Nenhum par de texto falha contraste AA. Falham as faixas do mapa como fronteira, e tinta sobre o preenchimento cheio fica em 4,48:1 no claro e 3,92:1 no escuro.

## 5. Site público e o domínio

O site em si não precisa de redesenho para mudar de domínio. Precisa de configuração, e de um cuidado: hoje ele não tem `middleware.ts`, e a entrega acrescenta um.

Passos do dono:
1. Confirmar que `segueovoto.com.br` está registrado no registro.br em seu nome (INCERTO).
2. DNS: apex e `www` com os valores que o painel da Vercel indicar (Project → Domains). Se for usar Cloudflare Access na central, delegar os NS ao Cloudflare com `www` em DNS-only.
3. Vercel: `www.segueovoto.com.br` como primário; `segueovoto.com.br` e `replica-virid-sigma.vercel.app` com redirecionamento 308 para `www`.

O que muda junto:

| Item | Onde | Mudança |
| --- | --- | --- |
| `SITE_URL` | variável de produção na Vercel | `https://www.segueovoto.com.br`; alimenta `metadataBase`, canonical e `og:image` (`layout.tsx:28`) |
| URL fixa no script de configuração | `etl/deploy/config-producao.sh:202` ✔ | trocar o padrão `replica-virid-sigma.vercel.app`; a instrução de Redirect URLs (`:376`) deriva dela e precisa ganhar `admin.` |
| Vigia de fontes | `.github/workflows/vigia.yml:26` ✔ | gravar a variável `VIGIA_URL` com o domínio novo; o `curl` não segue redirecionamento e quebra com o 308 |
| `REVALIDATE_URL` | secret do GitHub (`etl.yml`, `etl-pauta.yml`) | se apontar para o vercel.app (o valor é INCERTO), a revalidação para em silêncio com o 308: `derive_stats.py:525` faz `httpx.post` sem seguir redirecionamento e só registra um aviso. Trocar antes do 308 |
| Supabase Auth | painel | Site URL e Redirect URLs com `www` e `admin.` |
| Turnstile | painel Cloudflare | acrescentar `www`, `admin.` e o apex; manter o vercel.app durante a transição |
| Cookies de sessão | — | todos os usuários logados no vercel.app perdem a sessão na troca (esperado). Não usar `domain=.segueovoto.com.br`, que vazaria a sessão do site para `admin.` |
| E-mail | painel do remetente | SPF, DKIM e DMARC se o remetente passar a ser `@segueovoto.com.br` (INCERTO qual é hoje) |

Não há sitemap nem robots no site hoje; vale criar depois da troca.

## 6. Plano em fases

| Fase | O quê | Critério de aceite | Afeta produção | Ação do dono |
| --- | --- | --- | --- | --- |
| F0 · Base | Push dos 63 commits; PR; resolver o conflito de numeração em `replica/decisions.md`; rodar o Playwright fora do sandbox | CI verde (suíte ETL dentro dos 15 min do job; 809 testes públicos passando com o `middleware.ts`); capturas do critério 26 commitadas | Não | Push, PR, Playwright |
| F1 · Domínio | `REVALIDATE_URL` e `VIGIA_URL` primeiro (os dois quebram com o 308); registro.br, DNS, Vercel, 308; `SITE_URL` e novo deploy (a metadata só muda com deploy); Supabase, Turnstile; correção de `config-producao.sh` | `curl -sI https://segueovoto.com.br` devolve 308 para `www`, idem o vercel.app; canonical e `og:image` com o domínio novo; login por código funciona em `www`; vigia verde; a próxima carga do ETL revalida sem aviso de redirecionamento no log | Sim (reversível, menos as sessões perdidas) | Painéis |
| F2 · Migrações | Janela, ETL pausado, ponto de restauração anotado; reconciliar `schema_migrations`; estender o runbook; aplicar `0130..0142`, depois `0150..0155`, por arquivo com `psql` mais o registro em `schema_migrations`, como o runbook já faz (`db/migrate.sh` aplica tudo o que estiver pendente, sem parar num número); consultas da seção 2.5 | `max(filename)` = `0155…`; um `run-due` completo sem erro; `anon` sem acesso a `adm_*`; páginas-chave do site com 200 | Sim (`0130` só se desfaz por restauração) | Tudo |
| F3 · Login e correções da central | Código: migração `0156+` (`adm_admins`, identidade da sessão), middleware com renovação, MFA, trava invertida, CSRF, cabeçalhos de segurança, rate limit, anti-SSRF, CLI exigindo `--por` em `adm_admins`; reescrita dos critérios 15 e 23; as 5 de UX e as 5 de UI | Não admin logado → 404; admin sem MFA → página de cadastro do fator; POST sem `Origin` → 403; `por` do corpo ignorado; `base_url` interno → pedido falha; `curl -I` mostra `frame-ancestors 'none'`; site público sem regressão: conjunto e2e público passando e mesmos status HTTP nas páginas-chave | Não, até F4 | Revisar o PR |
| F4 · Projeto `admin.` | Janela e ETL pausado: aplicar `0156+` em produção; publicar executor e CLI novos; depois projeto Vercel novo, variáveis só em Production, senha do `admin_central`, DNS de `admin.`, proteção no alias vercel.app | `max(filename)` = a última `0156+`; deslogado → 404; alias vercel.app do projeto → 404; projeto do site sem `ADMIN_*`; no máximo 5 conexões do `admin_central` | Sim | Migração, Vercel, DNS, senha |
| F5 · Executor contínuo | Container com reinício automático; Actions como reserva; texto da tela com a promessa real | Pedido → em execução em até 10 s; contagem na tela em até 10 s depois da gravação; container morto → pedido interrompido em até 120 s, e a tela acusa | Sim (escreve no domínio) | Host e credencial |

Irreversíveis ou de efeito permanente: `0130` (só restauração desfaz); migração aplicada não se edita; texto de justificativa publicado em `corrections`; sessões perdidas na troca de domínio; e a primeira decisão aplicada de verdade pelo executor. Fazer a primeira rodada real com um operador e uma UF.

F3 é do tamanho das fases anteriores e deve rodar no mesmo esquema (orquestrador, construtores, verificador de segurança independente). As correções de UX e UI podem começar antes, em paralelo a F1 e F2, porque não tocam produção.

## 7. Decisões que são do dono

1. Onde publicar a central: (b) subdomínio em projeto Vercel separado (recomendado), (a) mesma app, ou (c) fora da Vercel.
2. Onde roda o executor: container contínuo (recomendado, custo mensal e mais um host com credencial de escrita) ou Actions agendado (sem custo novo, mas a promessa vira "início em até alguns minutos").
3. Quem são os admins e se MFA é obrigatório (recomendado: sim).
4. Se `segueovoto.com.br` já está registrado, e onde fica o DNS (registro.br ou Cloudflare).
5. Se a exceção de `TRACE` (AC-22) continua valendo com a central na internet.
