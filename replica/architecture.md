# Architecture: clone cívico (rebuild das features do Politicômetro)

Escopo: completo (decisão do usuário em 2026-11-01), faseado em releases R0–R6.
Entrada: `recon.md` (S01–S28, F01–F08) e `features.csv` (17 must, 17 should, 13 could, 5 skip).
Princípio: o produto é um **pipeline de dados oficiais com uma vitrine**. A vitrine é simples. O risco está no ETL, na identidade das pessoas e na cobertura.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 15 (App Router) + TypeScript | RSC com cache de dados por tag (`unstable_cache` na camada `lib/data`): 71 mil crachás sem ir ao banco a cada visita, invalidados quando o ETL termina (ver `integration.md` §7.1) |
| styling | Tailwind + tokens do replica-design | padrão; tema claro/escuro por CSS variables |
| mobile | nenhum app nativo; PWA | o original é só web e o público chega pelo link no WhatsApp |
| database | Postgres no Supabase (Pro + compute Medium) | um banco só com auth OTP, Storage e RLS. Volume estimado de 40–80 GB no escopo completo, acima do plano free |
| acesso a dados | `postgres` (postgres.js), sem ORM | SQL escrito à mão é a fonte de verdade; tagged templates parametrizam. Drizzle seria segundo schema sem ganho (desvio registrado em `backend.md`) |
| auth | Supabase Auth, OTP por e-mail | é exatamente o fluxo do original (S20: "não tem senha") |
| payments | nenhum | produto não comercial. Doação, se vier, é link externo |
| email | Resend (SMTP do Supabase Auth + digests) | um provedor para OTP e digest, com webhooks de bounce e complaint |
| ETL | Python 3.12 + DuckDB/polars em Fly Machines agendadas | arquivos do TSE são CSV latin-1 de vários GB. DuckDB lê zip em processo; função serverless estoura tempo e memória. Custo: uma segunda linguagem no repo |
| jobs do app | Vercel Cron → route handlers | só tarefas leves: digest, rollup de analytics, retenção |
| search | Postgres `pg_trgm` + `unaccent` | 71 mil pessoas + 5.570 cidades cabem com folga. Algolia não paga o custo |
| files | Supabase Storage | fotos oficiais espelhadas (~2 GB) |
| OG / card | `next/og` em route handler com cache de CDN | "Compartilhar card" sem render manual |
| tempo real | polling de JSON com `s-maxage` de 10–30 s | 88 pessoas simultâneas não pedem websocket. CDN absorve pico de dia de eleição |
| proteção | Cloudflare Turnstile + rate limit do Vercel WAF | formulários públicos e beacon |
| analytics | beacon próprio → `page_views` | "Mais vistos" (S17) é feature pública, então precisa de dado próprio e sem PII |
| MCP | `/api/mcp` (streamable HTTP, só leitura) sobre a mesma camada de dados | o original só anuncia o MCP (S27). Aqui sai quase de graça |
| TTS | Web Speech API no cliente | "Ouvir esta página" sem backend |
| hosting | Vercel (web) + Fly (ETL) + Supabase (dados) | todos gerenciados. Fly existe só porque o ETL não cabe em serverless |
| observabilidade | Sentry + painel de `ingest_runs` | o que quebra aqui é a fonte, não o app |

Uma camada de dados (`lib/data/*.ts`, funções de leitura tipadas) atende páginas RSC, `/api/*` e MCP. Nenhuma query fica fora dela.

Integrações (fontes oficiais, serviços de plataforma, superfícies expostas, orquestração do ETL, falhas e lacunas): [`integration.md`](integration.md).

## Schema

Arquivo: [`schema.sql`](schema.sql). Tables: **64** + 1 view, indexes: 208. Validado em Postgres 16 local com stub de `auth`, incluindo os testes de regressão da revisão independente.

Access rules: **RLS + Data API desligada.**

- O Next.js lê pelo pooler Postgres como o role `web_reader`, que tem `select` e a policy `public_read` só nas tabelas públicas.
- A Data API (PostgREST) do Supabase fica desligada para o schema `public`, então a anon key não varre `votes` e `expenses`.
- O ETL escreve com `service_role`.
- O único dado com dono é `profiles`/`follows`, gravado por server action e protegido também por policy de `auth.uid()`, como defesa em profundidade.
- `suggestions`, `page_views`, `ingest_runs`, `digest_deliveries`, `person_external_ids` e `identity_match_queue` não têm policy nem grant: só o servidor lê e escreve.

Extensões ficam no schema `extensions`, padrão do Supabase.

| grupo | tabelas |
| --- | --- |
| proveniência | sources, ingest_runs, dataset_stamps |
| dimensões | places (chave IBGE), parties, party_aliases, offices, legislative_bodies, topics |
| pessoas | people, person_slug_redirects, person_external_ids, identity_match_queue, party_memberships, view person_current_party |
| eleições | elections, contests, candidacies, candidacy_place_votes, campaign_finance_entries, asset_declarations, asset_items, gov_plan_excerpts, live_count_snapshots |
| mandato | mandates, mandate_periods, mandate_contacts, salaries |
| legislativo | laws, proposals, proposal_authors, proposal_topics, sessions, session_agenda_items, attendance, voting_events, orientation_actors, bloc_members, party_orientations, votes, speeches, speech_topics, committees, committee_memberships |
| dinheiro | expenses, amendments, trips, staff_members |
| derivados | person_period_stats, data_coverage, activity_events |
| governos/STF/impostos | government_terms, yearly_indicators, corporate_card_expenses, tax_revenues, stf_ministers, stf_cases, stf_case_events |
| usuário | profiles, follows, digest_deliveries, suggestions, corrections |
| analytics | page_views, page_view_hourly |

Restrições que o recon pediu, garantidas no banco e testadas:

| regra | mecanismo | teste |
| --- | --- | --- |
| mesma pessoa não tem dois mandatos sobrepostos no mesmo cargo; reeleito com posse no dia seguinte passa | `exclude using gist (person_id, office_id, daterange '[)')` | sobreposto falhou, adjacente passou |
| upsert idempotente de mandato (TSE e Câmara mandam o mesmo) | `unique mandate_key (person_id, office_id, place_id, started_on)`; toda tabela com exclusão também tem chave única | 2 cargas → 1 linha |
| suplente que entra e sai, titular licenciado que volta | `mandate_periods` com exclusão por mandato; `mandates.status` é o cache do período atual | licença e retorno passaram; sobreposição falhou |
| presidente interino ou em exercício | `government_terms.role`; exclusão separada para titular e para interino/em exercício | Temer interino passou; dois titulares falharam |
| uma candidatura por pessoa por eleição (turno) | `unique (person_id, election_id)` + FK composta `(contest_id, election_id)` | dois cargos falhou; turno incoerente falhou |
| sigla e número de partido reutilizados (PL 1985 ≠ PL 2006) | `parties.valid_from/valid_to` com exclusão por sigla; aliases com vigência e sem fundir sucessoras | ok |
| partido atual depois da janela partidária | view `person_current_party` sobre `party_memberships` | ok |
| orientação de Governo, Maioria, Oposição e blocos | `orientation_actors` + `bloc_members` | aplicado |
| apagar ou fundir pessoa não leva fatos junto | FKs de fatos `on delete restrict`; procedimento `merge_person(from, to)` move vínculos e cria redirect (escrever em R0) | delete com fatos falhou |
| casamento de identidade abaixo de 0,9 não aparece no crachá | o fato fica em staging sem `person_id`; o candidato vai para `identity_match_queue` | aplicado |
| correção publicada e auditável (direito de resposta) | `corrections` com antes/depois, fonte e sugestão de origem | aplicado |
| uma filiação partidária por vez; troca no mesmo dia passa | exclusão em `party_memberships` | ok |
| um chefe de Executivo por lugar por vez | exclusão em `government_terms` | aplicado |
| presença coerente; `null` significa "fonte não publica" e nunca vira 0 | `check (presence_present <= presence_total)` + colunas nullable | incoerente falhou |
| um voto por pessoa por votação, uma presença por sessão | `unique` | aplicado |
| ETL idempotente | chave natural única em toda tabela-fato (`source_key` ou composta) → `on conflict do update` | aplicado |
| listas A–Z com acento certo ("Álvaro, Ana, Beto, Zé") | collation ICU `pt_br` nas colunas de nome | ok |
| busca sem acento | índice GIN trigram sobre `f_unaccent(lower(nome))` | "alvaro" achou "Álvaro" |
| usuário só vê e altera os próprios follows | RLS | user1 viu 0 follows de user2; insert cruzado bloqueado |
| anon não lê nada; servidor lê o público, mas não os casamentos | grants + policies para `web_reader` | anon negado; `person_external_ids` negado |
| no máximo 200 monitorados por conta | trigger `follows_limit` | 201º falhou |
| apagar conta apaga tudo (LGPD) | `profiles → auth.users on delete cascade`, follows e digests em cascata | aplicado |

Desvio consciente do padrão da skill: tabelas-fato de alto volume usam `bigint identity` em vez de `uuid` (votes, attendance, expenses, campaign_finance_entries, candidacy_place_votes, speeches, activity_events, page_views, corporate_card_expenses). Com dezenas de milhões de linhas, o índice cai pela metade.

## API

A maioria das leituras é RSC no servidor, sem endpoint. Os `/api/*` existem para paginação no cliente ("Ver mais N"), autocomplete, OG, MCP e o ETL.

### F01 Quem representa a minha cidade (S01, S06, S07, S05)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/` | home: contadores, mapa, diretório A–Z | anyone | — | RSC (ISR 10 min) | F01 F02 |
| GET `/representantes` | busca de lugar e diagrama de níveis | anyone | — | RSC estático | F01 |
| GET `/api/places?q=` | autocomplete de cidade/UF, homônimos com UF | anyone | `q` de 2 a 60 caracteres, sem acento | `[{ibge, name, uf, kind}]` ≤ 10 | F01 |
| GET `/representantes?cidade=<ibge>` / `?uf=<sigla>` | todos no cargo por nível + dados faltantes | anyone | IBGE de 7 dígitos ou UF válida; inválido → 404 | RSC dinâmico, dado em cache (tag `place:<ibge>`) | F01 |
| GET `/p/[slug]` | crachá | anyone | slug; se antigo → 308 via `person_slug_redirects` | RSC dinâmico, dado em cache (tag `person:<id>`) | F01 F03 |

### F02 Mapa (S01)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/api/map/[layer]?place=` | dados da camada (quem governa, contas, escolas, obras, repasses, votações) | anyone | layer na lista fixa; place = IBGE | `{place, items[], stamp}` | F02 |

### F03 Ler o crachá (S05, S10)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/api/people/[slug]/proposals` | propostas paginadas | anyone | `year?, topic?, type=lei\|pedido?, role?, q?, cursor` | `{items, nextCursor, counts}` | F03 |
| GET `/api/people/[slug]/votes` | votos paginados | anyone | `year?, topic?, value?, q?, cursor` | idem | F03 |
| GET `/api/people/[slug]/expenses` | gastos paginados com link da nota | anyone | `year, category?, cursor` | idem | F03 |
| GET `/api/people/[slug]/speeches` | falas | anyone | `year?, topic?, cursor` | idem | F03 |
| GET `/votacoes/[id]` | detalhe: placar, orientação por partido, votos | anyone | uuid | RSC | F03 F07 |

### F04 Comparar (S08)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/comparar?p=a,b,c` | tabela lado a lado | anyone | 2–5 slugs distintos (excedente ignorado, inválido removido com aviso) | RSC | F04 |
| GET `/api/compare/agreement?p=&period=` | "votaram igual?" + divergências | anyone | 2–5 slugs, `period=career\|YYYY` | `{pairs:[{a,b,same,total}], diffs[]}` | F04 |

### F05 Monitorar (S20, S21)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| action `sendOtp` | envia código | anyone; **CAPTCHA nativo do Supabase Auth (Turnstile) ligado**, para que chamar `/auth/v1/otp` direto com a anon key também exija token; rate limit do Auth em 3/h por e-mail e 30/h por IP | e-mail válido | `ok` (sempre, sem revelar se a conta existe) | F05 |
| action `verifyOtp` | cria sessão e profile com consentimento | anyone | e-mail + código de 6 dígitos | redirect para `volta`, validado com `^/(?![/\\])` (bloqueia `//evil.com` e `/\evil.com`); inválido → `/` | F05 |
| action `follow` / `unfollow` | monitorar ou deixar de monitorar | authenticated | `personId` | `ok \| follow_limit_reached` | F05 |
| GET `/acompanhando` | feed de `activity_events` dos seguidos | authenticated | `cursor` | RSC dinâmico | F05 |
| action `updateDigest` | frequência do digest | authenticated | `daily\|weekly\|off` | ok | F05 |
| action `deleteAccount` | apaga conta e dados (LGPD) | authenticated | confirmação | redirect `/` | F05 |
| POST `/descadastrar?t=` | one-click unsubscribe (RFC 8058 `List-Unsubscribe-Post`) | quem tem o token HMAC | token | 200 | F05 |
| GET `/descadastrar?t=` | página com botão de confirmar; GET nunca descadastra (scanners de link) | quem tem o token | token | página | F05 |

### F06 Compartilhar (S28)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/api/og/p/[slug]` | PNG 1200×630 do crachá | anyone | slug | image/png, cache 1 dia, tag `person:<id>` | F06 |

### F07 Congresso (S09, S10)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET `/congresso` | hemiciclo, agenda, pauta, votações | anyone | `ano?` | RSC (ISR 5 min) | F07 |
| GET `/api/congress/status` | sessão agora / próxima | anyone | — | JSON, `s-maxage=60` | F07 |
| GET `/api/congress/votes` | lista paginada | anyone | `house?, year?, q?, cursor` | idem | F07 |

### F08 Sugestão / erro (S25)

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| action `submitSuggestion` | grava sugestão ou reporte de erro | anyone, Turnstile, 5/h por IP | kind, body (5–5000), nome, e-mail, cidade?, personId?, pagePath | ok / erros de campo | F08 |

### Módulos (S11–S19, S27)

| method path | does | who | input | output |
| --- | --- | --- | --- | --- |
| GET `/quem` | diretório filtrável | anyone | `cargo?, uf?, partido?, q?, letra?` | RSC |
| GET `/partidos`, `/partidos/[sigla]` | espectro, bancadas, alinhamento | anyone | `uf?` | RSC |
| GET `/governos`, `/governos/[id]` | mandatos e indicadores | anyone | `esfera`, até 4 ids | RSC |
| GET `/propostas` | planos de governo lado a lado | anyone | disputa, até 4 candidaturas, tema | RSC |
| GET `/eleicoes`, `/eleicoes/[ano]/[lugar]` | resultados | anyone | — | RSC |
| GET `/api/elections/[contestId]/live` | apuração ao vivo | anyone | — | JSON, `s-maxage=10` |
| GET `/stf`, `/stf/[classe]/[numero]` | pauta, processos | anyone | `q?` | RSC |
| GET `/impostos` | arrecadação federal | anyone | `ano` | RSC |
| GET `/mais-vistos`, GET `/api/trending` | ranking de audiência (nunca de político) | anyone | janela `24h\|total` | RSC + JSON `s-maxage=30` |
| GET `/api/live` | pessoas agora (visitantes únicos em 5 min) e total de visitas | anyone | — | JSON `s-maxage=30` |
| POST `/api/beacon` | registra page view; o ranking conta `visitors` (hash único por entidade e hora), não `views` | anyone, WAF 60/min por IP | `{path, entityKind?, entityKey?}` | 204 |
| POST `/api/mcp` | ferramentas MCP só de leitura: buscar_politico, ver_politico, listar_votos, listar_propostas, listar_discursos, listar_gastos, quem_me_representa, eleicoes, arrecadacao_federal, comparar_politicos | anyone, 30/min por IP | JSON-RPC | resultado + fonte + data em todo item |
| GET `/cargos`, `/dicionario`, `/sobre`, `/dados-abertos`, `/ajudar`, `/atualizacoes` | conteúdo (MDX no repo; `/dados-abertos` lê `data_coverage`) | anyone | — | estático |

Interno:

| method path | does | who | input |
| --- | --- | --- | --- |
| POST `/api/revalidate` | invalida tags após um run do ETL | ETL, Bearer `REVALIDATE_SECRET` comparado em tempo constante + WAF 10/min (ver `integration.md` §7.2) | `{tags[] ≤ 5000}` |

Webhooks in: Resend `email.bounced` / `email.complained` → `profiles.digest = 'off'`. Nenhum webhook das fontes, porque nenhuma fonte oficial oferece.
Webhooks out: nenhum.

### Jobs

Horário de Brasília (America/Sao_Paulo); o cron é configurado em UTC.

| job | onde | schedule | o que faz |
| --- | --- | --- | --- |
| `etl.ibge.places` | Fly | anual + manual | regiões, UFs e municípios |
| `etl.tse.candidatos` | Fly | semanal em ano eleitoral, mensal fora | candidaturas, bens, prestação de contas, planos de governo, resultados, votos por município |
| `etl.tse.apuracao` | Fly | dia de eleição, a cada 1 min das 17h às 23h | `live_count_snapshots` a partir da divulgação oficial |
| `etl.camara.diario` | Fly | diário 06:00 | deputados, mandatos, sessões, presença, votações, orientações, proposições, cota, discursos, comissões |
| `etl.camara.agenda` | Fly | a cada 15 min, seg–sex 08–22h | agenda, status de sessão, pauta |
| `etl.senado.diario` / `.agenda` | Fly | idem | senadores, votações nominais, matérias, agenda |
| `etl.transparencia.emendas` | Fly | diário 03:00 (fora do horário de limite) | emendas por autor, destino e ação |
| `etl.transparencia.cartao` | Fly | mensal | cartão corporativo |
| `etl.receita.arrecadacao` | Fly | mensal, dia 5 | `tax_revenues` |
| `etl.indicadores` | Fly | mensal | IBGE SIDRA e BCB SGS → `yearly_indicators` |
| `etl.stf` | Fly | diário 07:00 | pauta e andamento dos processos do Plenário |
| `etl.ale.<uf>` | Fly | diário, só UFs com adapter | presença, votos, propostas, gastos estaduais |
| `etl.sapl.<ibge>` | Fly | noturno, lotes rotativos de ~200 câmaras | câmaras municipais com SAPL |
| `derive.stats` | Fly | ao fim de cada ETL de fatos, só pessoas afetadas | `person_period_stats`, temas (regra versionada), `activity_events`, depois `/api/revalidate` |
| `audit.coverage` | Fly | semanal | recalcula `data_coverage` e alerta stamp vencido |
| `app.pageviews.rollup` | Vercel Cron | a cada 5 min | `page_views` → `page_view_hourly` |
| `app.pageviews.retention` | Vercel Cron | diário 04:00 | apaga `page_views` com mais de 7 dias |
| `app.digest` | Vercel Cron | diário 08:00 (daily) e segunda 08:00 (weekly) | e-mail com eventos dos seguidos, idempotente por `digest_deliveries` |
| `app.suggestions.anonymize` | Vercel Cron | mensal | anonimiza e-mail e nome das sugestões resolvidas há mais de 12 meses |

Todo job de ETL segue o mesmo contrato:

1. Pega um `pg_advisory_lock` por dataset.
2. Grava uma linha em `ingest_runs`.
3. Pula o run se o checksum da entrada não mudou.
4. Carrega numa tabela de staging e faz upsert pela chave natural.
5. Atualiza `dataset_stamps`.
6. Chama `derive.stats` e depois revalida.

Se a fonte falhar, o dado anterior fica no ar com o stamp antigo e nunca é apagado.

## The parts that bite

- **Time zones:** o Brasil tem 4 fusos e teve horário de verão até 2019, e os dados históricos o carregam. Instantes ficam em `timestamptz`, renderizados em America/Sao_Paulo pelo tz database, nunca por offset fixo. Datas civis (posse, nota fiscal, sessão sem hora) são `date`, porque converter fuso nelas desloca o dia.
- **Idempotência:** chave natural em toda tabela-fato; checksum por entrada; `digest_deliveries unique(user_id, window_start)` com idempotency key no Resend; revalidação por tag é idempotente.
- **Races:** dois runs do mesmo dataset são evitados com advisory lock. O limite de 200 follows é "soft" sob inserts simultâneos, o que é aceitável. Para evitar tempestade de revalidação, as tags são agrupadas e enviadas no fim do run, até 5000 por chamada.
- **Rate limits (fontes):** a Câmara e o Senado não documentam limite. Usar 5 req/s e preferir os arquivos anuais em lote à API por item. O Portal da Transparência exige chave e limita por minuto, por isso o job roda de madrugada, quando o limite é maior. O TSE é download de arquivo, sem limite, mas com vários GB por eleição.
- **Rate limits (nossos):** regras do WAF por rota; Turnstile em tudo que envia e-mail ou grava texto, inclusive no Supabase Auth. A Data API desligada fecha a varredura via anon key.
- **Manipulação do "Mais vistos":** o beacon é aberto. O ranking usa visitantes únicos por entidade e hora, descarta `visitor_hash` com mais de 30 entidades/hora, e o S17 mostra audiência, nunca avaliação. Isso mantém a neutralidade mesmo sob ataque.
- **Identidade:** o CPF não é público. O casamento segue esta ordem: ID oficial da casa ↔ `SQ_CANDIDATO`/título publicado pelo TSE, depois nome civil + nascimento, depois nome + nascimento + município. Abaixo de 0,9 de confiança vai para fila manual e não aparece no crachá. Um casamento errado mostra os votos de uma pessoa no perfil de outra, que é o pior erro possível do produto.
- **Volume de pessoas:** as candidaturas de 1994 a 2026 passam de 2 milhões, e `people` inclui não eleitos (S14 lista todos os candidatos). Sem CPF, o casamento entre eleições cria duplicatas. Mitigações:
  - ISR só pré-gera os eleitos; o resto é gerado sob demanda.
  - O sitemap é dividido em índices.
  - Casamento entre eleições pelo título de eleitor quando o TSE publica, e por nome + nascimento + UF quando não; duplicata vira `merge_person`.
- **Homônimos e slugs:** o recon mostrou "Quinha, Prefeita · BA" e "Quinha, Prefeito · BA". O slug segue a ordem nome → nome-uf → nome-cargo-uf → sufixo numérico. Uma vez publicado, nunca muda: troca de nome gera `person_slug_redirects`.
- **Normalização de partido:** "PCdoB", "PC do B" e "PCDOB" aparecem no original como três partidos no filtro. `party_aliases` (com vigência) resolve isso antes de qualquer insert, e nunca funde sucessoras: PL 1985 e PL 2006 continuam distintos.
- **Partido mostrado:** o partido atual vem de `person_current_party`, não de `mandates.party_id` (que é o partido na posse). Voto histórico usa `votes.party_id`, o partido na data do voto.
- **Volume:** `candidacy_place_votes` é a maior tabela (candidatos × 5.570 municípios). Guardar só os candidatos a deputado federal/estadual e senador com pelo menos 1% dos votos válidos no município, ou os 20 primeiros. O detalhe completo fica no TSE, com link. Os votos da Câmara desde 2003 somam alguns milhões de linhas; a cota, outros milhões. Particionar só se `votes` passar de 50 milhões.
- **Busca:** trigram com limite de 10 resultados e ordenação por similaridade, com desempate A–Z. O mesmo índice atende o autocomplete. O termo nunca vai para a URL de analytics.
- **Tempo real:** só polling de JSON cacheado na CDN. "Pessoas agora" conta visitantes únicos dos últimos 5 minutos em `page_views`, uma consulta a cada 30 s cacheada, não por visitante.
- **Pico de eleição:** crachás e páginas de lugar via ISR na CDN; o JSON de apuração é servido com `s-maxage=10`, então o banco recebe uma leitura a cada 10 s, não uma por visitante.
- **Degradação (feature, não exceção):** `null` sempre aparece como "—" com o motivo de `data_coverage`, e nunca como zero. Um stamp vencido (Câmara > 48 h, TSE > 30 dias em ano eleitoral) mostra aviso no bloco.
- **Neutralidade como código:**
  - Teste de lint no data layer: nenhuma lista pública ordena por métrica de desempenho, o padrão é `order by name collate pt_br`.
  - Nenhum componente mapeia partido para "bom/ruim".
  - Ferramentas MCP com instrução fixa: devolvem dado e fonte, recusam recomendação de voto.
  - Base: Res. TSE 23.610/2019.
  - O original usa cor de partido no hemiciclo e diz "nunca partido" na metodologia. É uma contradição a resolver no replica-design: sugiro cor neutra por espectro, ou nenhuma.
- **E-mail:** SPF/DKIM/DMARC no domínio próprio; SMTP do Supabase Auth apontado para o Resend; `List-Unsubscribe` one-click no digest; bounce desliga o digest.
- **LGPD:** dado de agente público tem base legal de interesse público e transparência. `page_views` sem IP (hash com sal diário). Conta apagada em cascata. Sugestões anonimizadas em 12 meses. Equipe de gabinete (nome e salário de servidor) só como a casa publica.
- **Fotos e licenças:** só fotos oficiais com licença de reuso (Câmara e Senado publicam; TSE: verificar caso a caso). Sem licença, mostra iniciais.
- **Arquivos:** fotos limitadas a 200 KB e redimensionadas no ETL; nenhum upload de usuário.
- **Offline:** PWA guarda os últimos crachás visitados (could).
- **Multi-tenancy:** não se aplica.

## Build order

Estimativa para uma pessoa orquestrando agentes. R3 e R4 são cauda longa e não têm prazo fechado.

### R0 Vertical slice (~3 semanas)

O loop F01 de ponta a ponta, feio.

- **Screens:** S06, S07, S05 (só cabeçalho, mandatos e tiles do TSE).
- **Tables:** sources, ingest_runs, dataset_stamps, places, parties, party_aliases, offices, legislative_bodies, people, person_slug_redirects, person_external_ids, identity_match_queue, party_memberships, mandates, mandate_periods, elections, contests, candidacies, asset_declarations, person_period_stats; `merge_person()`.
- **Routes:** `/representantes`, `/representantes?cidade=`, `/p/[slug]`, `/api/places`, `/api/revalidate`.
- **Jobs:** `etl.ibge.places`, `etl.tse.candidatos` (só eleitos 2022/2024/2026, todos os cargos), `etl.camara.diario` (só deputados), `etl.senado.diario` (só senadores).
- **Aceite:** digitar "Campinas" → escolher SP → ver os 206 nomes por nível → abrir um crachá com fonte e data, em 3 cliques, num deploy na Vercel.

### R1 Must-haves (~6 semanas)

As 17 linhas `must` do `features.csv`.

- **Screens:** S01 (contadores, mapa, A–Z), S04, S05 (propostas, votos, gastos, patrimônio, estado degradado), S08, SourceFooter global.
- **Tables:** + salaries, topics, proposals, proposal_authors, proposal_topics, laws, sessions, attendance, voting_events, orientation_actors, bloc_members, party_orientations, votes, expenses, asset_items, data_coverage.
- **Routes:** `/`, `/quem`, `/comparar`, `/api/people/[slug]/{proposals,votes,expenses}`, `/api/compare/agreement` (aqui só a base de dados).
- **Jobs:** ETL completo de Câmara e Senado, `derive.stats`, `audit.coverage`.
- **Aceite:** todo deputado federal e senador com crachá completo; os ~70 mil estaduais/municipais com crachá do TSE e "faltam N dados · por quê"; teste de neutralidade verde.

### R2 Should-haves (~6 semanas)

- **Screens:** S03, S09, S10, S20, S21, S22, S23, S25, S28; seções restantes do S05 (resumo do ano, leis, emendas, campanhas, presença, comissões, falas, viagens, equipe, custo, contato).
- **Tables:** + campaign_finance_entries, amendments, speeches, speech_topics, committees, committee_memberships, trips, staff_members, session_agenda_items, mandate_contacts, profiles, follows, digest_deliveries, activity_events, suggestions, corrections.
- **Routes:** busca global, OG, congresso, auth, follow, digest, sugestões, descadastro.
- **Jobs:** `.agenda` da Câmara e do Senado, `etl.transparencia.emendas`, `app.digest`, `app.suggestions.anonymize`.

### R3 Nível estadual (~4–8 semanas, varia por UF)

- **Escopo:** adapters `ale_custom` por Assembleia com dado aberto, mais a CLDF; governadores.
- **Ordem:** UFs por população × qualidade da fonte.
- **Aceite:** UF sem adapter mostra cobertura honesta, nunca lista vazia.

### R4 Nível municipal (contínuo)

- **Escopo:** adapter SAPL genérico (Interlegis), fila de fontes vinda de `suggestions.kind = 'fonte_de_dados'`, salário do prefeito via TCEs quando aberto.
- **Meta inicial:** capitais + municípios acima de 200 mil habitantes.

### R5 Could-haves (~8 semanas)

- **Screens:** S11, S12, S13, S14 (+ apuração ao vivo), S15, S16, S17, S18, S19, S27, TTS, camadas do mapa.
- **Tables:** + government_terms, yearly_indicators, corporate_card_expenses, tax_revenues, stf_*, gov_plan_excerpts, live_count_snapshots, page_views, page_view_hourly.
- **Fora do schema atual:** as camadas Escolas (INEP), Obras e Contas (SICONFI) do mapa exigem tabelas próprias. O schema será estendido quando a camada for escopada.

### R6 Fixes

Fixes do replica-entrepreneur, quando ele rodar.

## Riscos principais

1. **ETL multi-fonte como operação contínua.** São mais de 15 fontes com formatos, cadências e quebras próprias. O custo real é de manutenção, não de construção. Mitigação: contrato único de job, `ingest_runs` observável, dado antigo nunca apagado.
2. **Resolução de identidade.** Um casamento errado atribui votos ou gastos à pessoa errada, com risco jurídico e de credibilidade. Com mais de 2 milhões de candidaturas sem CPF, a fila manual pode explodir. Mitigação: limiar de 0,9, `identity_match_queue`, `merge_person()` com redirect, `corrections` públicas, "Reportar erro" em todo crachá. Priorizar a fila pelos eleitos.
3. **Cobertura estadual e municipal.** 27 Assembleias e 5.570 câmaras heterogêneas. Mitigação: `data_coverage` como produto, adapter SAPL genérico, crowdsourcing de fontes.

Custo de infra estimado no escopo completo: Supabase Pro + compute Medium (~US$ 85/mês), Vercel Pro (US$ 20/mês por membro), Fly Machines agendadas (~US$ 10–30/mês) e Resend (free até 3 mil e-mails/mês). Fica na ordem de US$ 150/mês antes de tráfego relevante.
