# Arquitetura de integração

Estado em 2026-11-02; disponibilidade das fontes sondada em 2026-11-03 (§2.4). Complementa [`architecture.md`](architecture.md) (stack, schema, rotas) e [`backend.md`](backend.md) (o que foi carregado).
Escopo deste documento: tudo que cruza a fronteira do repositório. São três grupos: fontes oficiais que entram, serviços de plataforma de que o app depende e superfícies que o app expõe a terceiros.

Premissas declaradas:
- Só fontes oficiais e públicas, com as chaves do próprio projeto. Nada do Politicômetro, nem endpoint privado visível no navegador (recon.md, "fora de escopo").
- Um banco (Postgres/Supabase), uma camada de leitura (`web/src/lib/data`), um processo de ETL (`etl/`). Nenhuma fila ou broker: o banco é o ponto de integração entre ETL e app.
- Neutralidade (Res. TSE 23.610/2019) vale para toda superfície exposta, inclusive MCP: nada de ranking, nota ou recomendação.

## 1. Mapa de contexto

```
                 ┌──────────────── FONTES OFICIAIS (pull, sem webhook) ────────────────┐
                 │ IBGE · TSE (CDN zip) · Câmara (API v2 + arquivos) · Senado (API)    │
                 │ Transparência (API c/ chave) · Receita · SIDRA · BCB SGS · STF       │
                 │ ALEs (adapter por UF) · SAPL/Interlegis (câmaras municipais)         │
                 └───────────────────────────────┬─────────────────────────────────────┘
                                                 │ httpx: cache em disco, GET condicional,
                                                 │ 5 req/s por host, retry exponencial
                                                 ▼
  ┌──────────── ETL (Python 3.12, Fly) ───────────────────────────────────────────────┐
  │ supercronic → civico-etl <job>                                                     │
  │ run(): advisory lock → ingest_runs → checksum → COPY staging → upsert → stamp      │
  │ identity.dedupe → derive.stats → POST /api/revalidate                              │
  └───────────────┬──────────────────────────────────────────────────┬─────────────────┘
                  │ conexão direta (sessão, 5432), role etl_writer   │ HTTPS + Bearer
                  ▼                                                  ▼
  ┌──────── Supabase ────────────────┐                ┌──────── Vercel (Next.js) ───────────┐
  │ Postgres 16 (RLS, Data API off)  │◄── pooler ─────│ lib/data (web_reader, prepare:false)│
  │ Auth OTP (+Turnstile nativo)     │   transação    │ RSC · /api/* · /api/mcp · OG        │
  │ Storage (fotos espelhadas)       │◄───────────────│ server actions (auth, follow, F08)  │
  └──────────────┬───────────────────┘                │ Vercel Cron (digest, rollup)        │
                 │ SMTP                                └───┬───────────────┬────────────────┘
                 ▼                                         │               │
  ┌──────── Resend ──────────────┐   webhook (Svix) ──────┘               ▼
  │ OTP + digest + List-Unsub    │                          consumidores: navegador, WhatsApp
  └──────────────────────────────┘                          (link + OG), clientes MCP
```

## 2. Inventário

Legenda de estado: **ok** = código no repo e carga verificada; **parcial** = existe com lacuna conhecida; **R*n*** = release planejada, sem código.

### 2.1 Entrada: fontes oficiais

| fonte | protocolo / formato | auth | cadência | volume por run | licença | job | estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IBGE Localidades | REST JSON (`/api/v1/localidades/estados`, `/municipios?view=nivelado`) | nenhuma | anual + manual | ~5,6 mil linhas, 1 s | CC BY 4.0 | `ibge.places` | ok |
| IBGE Malhas v3 | REST GeoJSON (`/api/v3/malhas`) | nenhuma | manual (muda com criação de município) | 28 arquivos SVG/JSON | CC BY 4.0 | `ibge.malhas` | ok: escreve em `web/public/geo/`, não no banco; o artefato entra no repo e no build |
| TSE Dados Abertos | zip no CDN (`cdn.tse.jus.br/estatistica/sead/odsele/…`), CSV latin-1, `;` | nenhuma | semanal em ano eleitoral, mensal fora | consulta_cand e bem_candidato: dezenas de MB por ano; votação por município: ~550 MB por eleição | ODbL / LAI | `tse.candidatos`, `tse.votos`, `tse.contas` | ok para eleitos: votos e contas lidos por HTTP Range (`remotezip.py`), só o CSV necessário do zip, com o CRC32 do membro como checksum; candidaturas não eleitas só com `--all` |
| TSE divulgação (apuração) | JSON público da divulgação de resultados | nenhuma | dia de eleição, 1 min | pequeno, muitas chamadas | LAI | `tse.apuracao` | R5 |
| Câmara API v2 | REST JSON paginado (`links rel=next`, `itens` ≤ 100) | nenhuma | diária 06:00 | 882 detalhes de deputado | CC0 | `camara.diario` | ok |
| Câmara + Senado extras | REST JSON (`/deputados/{id}/orgaos`, `/discursos`; `/senador/{cod}/comissoes`, `/discursos`) | nenhuma | diária | contato, comissões e resumo de discursos dos em exercício | CC0 / LAI | `parlamento.extras` | ok |
| Câmara arquivos | CSV/JSON anuais (`/arquivos/votacoes*`, `/proposicoes*`, cota em `camara.leg.br/cotas/Ano-AAAA.csv.zip`) | nenhuma | diária (reprocessa o ano corrente) | 224 mil votos, 38,9 mil proposições, 306 mil lançamentos da cota em ~3 min | CC0 | `camara.diario` | ok |
| Câmara agenda | REST JSON (`/eventos`) | nenhuma | 15 min, seg–sex 08–22h | pequeno | CC0 | `camara.agenda` | R2 |
| Senado Dados Abertos | REST JSON (`/senador/lista/atual`, `/senador/lista/legislatura/{n}`, `/senador/{cod}/votacoes`) | nenhuma | diária | 81 + afastados, 1,8 mil votos | LAI | `senado.diario` | parcial: votação secreta devolve "Votou"; só abertas entram (ver §6) |
| Senado agenda | REST JSON | nenhuma | 15 min | pequeno | LAI | `senado.agenda` | R2 |
| Portal da Transparência | REST JSON | header `chave-api-dados` (cadastro gov.br) | diária 03:00 (emendas), mensal (cartão) | emendas: dezenas de mil por ano | LAI | `transparencia.emendas`, `.cartao` | R2 / R5 |
| Receita (arrecadação) | planilha/CSV em dados.gov.br | nenhuma | mensal, dia 5; a fonte publica com ~3 meses de atraso | pequeno | LAI | `receita.arrecadacao` | R5 |
| IBGE SIDRA · BCB SGS | REST JSON (`apisidra.ibge.gov.br`, `api.bcb.gov.br/dados/serie/bcdata.sgs.{n}/dados`) | nenhuma | mensal | pequeno | CC BY / LAI | `indicadores` | R5 |
| STF | **sem API oficial documentada**; painéis e downloads do portal de transparência | nenhuma | diária 07:00 | pequeno | LAI | `stf` | R5, bloqueado (ver §8) |
| ALEs | heterogêneo: API, CSV, PDF, nada | varia | diária, só UF com adapter | varia | varia | `ale.<uf>` | R3 |
| SAPL / Interlegis | REST do SAPL 3.x (`/api/…`, Django REST) | nenhuma | noturno, lotes rotativos de ~200 câmaras | varia | LAI | `sapl.<ibge>` | R4 |
| Fotos oficiais | URL da Câmara/Senado; TSE caso a caso | nenhuma | junto do job da casa | ~2 GB espelhados | verificar por fonte | dentro do job da casa | parcial: só URL, sem espelho |

### 2.2 Plataforma: serviços de que o app depende

| serviço | uso | direção / protocolo | credencial | onde fica | estado |
| --- | --- | --- | --- | --- | --- |
| Supabase Postgres | banco único | ETL: conexão direta (modo sessão, 5432). Web: pooler em modo transação (6543), `prepare:false` | ETL: role `etl_writer` (a criar). Web: `web_reader` (leitura) e `web_writer` (`DATABASE_WRITE_URL`, migração 0003, escrita de usuário em transação com `role authenticated`) | env do Fly / env da Vercel | local ok; Supabase R2 |
| Supabase Auth | OTP por e-mail, sessão em cookie | server action → Auth API | anon key + verificação de CAPTCHA no Auth | env da Vercel | código pronto (`web/src/lib/auth/`, contrato `AuthProvider`; provedor `dev` local, `supabase` em produção); falta a conta |
| Supabase Storage | fotos espelhadas, ≤ 200 KB | ETL → Storage API | service key, **só no Fly** | env do Fly | R2 |
| Resend | SMTP do Auth + digest | saída: SMTP/API. Entrada: webhook `email.bounced`/`email.complained` assinado (Svix) | API key + signing secret | env da Vercel / painel do Supabase | R2 |
| Cloudflare Turnstile | CAPTCHA em OTP, sugestões e follow anônimo | navegador → widget; servidor → `siteverify` | site key (pública) + secret | env da Vercel / painel do Supabase | código pronto em sugestões (`web/src/lib/captcha.ts`, fail-closed em produção sem chave); falta a chave |
| Vercel | hosting, WAF, Cron, cache de dados (ISR) | — | — | — | local ok; deploy R0 |
| Fly | ETL agendado | — | `ETL_DATABASE_URL`, `REVALIDATE_*`, `TRANSPARENCIA_API_KEY`, `SUPABASE_SERVICE_KEY` | secrets do Fly | R0/R2 |
| Sentry | erros do app e do ETL | SDK | DSN | env | R2 |

### 2.3 Saída: superfícies que o app expõe

| superfície | consumidor | contrato | proteção | estado |
| --- | --- | --- | --- | --- |
| páginas RSC | navegador, crawler | HTML; `<SourceFooter>` com fonte + data em todo bloco | WAF | ok: dado em cache com tags; HTML dinâmico onde há `searchParams` (§7.1) |
| `/api/places`, `/api/people/*`, `/api/compare/agreement` | front próprio (autocomplete, "ver mais") | JSON; input validado (tamanho, regex, enum); 400 se inválido | WAF | ok |
| `/api/revalidate` | ETL | `POST {tags[] ≤ 5000}`, Bearer em tempo constante | segredo compartilhado | ok: invalida `data`; tags finas disponíveis (§7.1) |
| `/api/og/p/[slug]` | WhatsApp, redes | PNG 1200×630, cache de 1 dia | CDN | R2 |
| `/api/mcp` | assistentes de IA (clientes MCP) | streamable HTTP, JSON-RPC, 10 ferramentas só de leitura; todo item com `fonte` + `atualizado_em` | 30/min por IP no WAF; sem ferramenta de escrita | R5 |
| `/api/beacon`, `/api/live`, `/api/trending` | o próprio front | 204 / JSON `s-maxage=30` | WAF 60/min, descarte de hash com mais de 30 entidades por hora | R5 |
| `/descadastrar` | cliente de e-mail | RFC 8058: o POST descadastra, o GET só mostra o botão | token HMAC | R2 |
| `/dados-abertos` | público | lê `data_coverage` + `dataset_stamps` | — | R2 |

### 2.4 Sondagem de disponibilidade (2026-11-03)

Método: um GET por endpoint, com os mesmos caminhos dos jobs. Nos arquivos grandes, `Range: bytes=0-0`, que devolve o tamanho total sem baixar. Conferido: a fonte responde, publica o ano esperado e aceita Range onde o job depende disso. Não conferido: a carga em si. Saída via proxy do sandbox, então "sem resposta" pode ser host errado ou DNS.

| fonte | endpoint sondado | HTTP | o que voltou | veredito |
| --- | --- | --- | --- | --- |
| IBGE localidades | `/api/v1/localidades/{estados,municipios}` | 200 | JSON; municípios 2,4 MB | disponível |
| IBGE malhas v3 | `/api/v3/malhas/paises/BR?intrarregiao=UF` | 200 | GeoJSON 98 KB | disponível |
| TSE candidaturas e bens 2026 | `consulta_cand_2026.zip`, `bem_candidato_2026.zip` | 206 | 3,3 MB e 3,8 MB; 30 membros, 23,9 MB de CSV por UF | disponível |
| TSE votos por município 2026 | `votacao_candidato_munzona_2026.zip` | 206 | 446 MB, Range aceito | disponível |
| TSE prestação de contas 2026 | `prestacao_de_contas_eleitorais_candidatos_2026.zip` | 206 | 362 MB; eleição de outubro, ainda em consolidação | disponível |
| TSE arquivos 2024 | `consulta_cand`, `munzona`, `prestacao` | 206 | 65 MB, 48 MB, 1,3 GB | disponível |
| Câmara API v2 | `/deputados`, `/deputados/{id}/discursos` | 200 | JSON paginado | disponível |
| Câmara arquivos 2026 | `votacoesVotos-2026.csv`, `proposicoes-2026.csv`, `cotas/Ano-2026.csv.zip` | 206 | 17,6 MB, 41,3 MB, 4,5 MB; cabeçalho do CSV de votos igual ao esperado | disponível |
| Câmara agenda | `/api/v2/eventos` | 200 | JSON | disponível para o R2 |
| Senado | `/senador/lista/atual.json`, `/senador/{cod}/votacoes.json` | 200 | JSON; votações por senador leva 1,5 s | disponível |
| Senado agenda | `/plenario/agenda/mes/{AAAAMMDD}.json` | 200 | JSON 39 KB | disponível para o R2 |
| Portal da Transparência | `/api-de-dados/emendas` | 401 | API ativa; recusa sem `chave-api-dados` | precisa de chave (cadastro gov.br) |
| SIDRA, BCB SGS | `apisidra /t/1737`, `bcdata.sgs.433` | 200 | JSON | disponível para o R5 |
| Receita | página do conjunto em dados.gov.br | 200 | HTML; arquivo não baixado | não conferido |
| TSE divulgação | `resultados.tse.jus.br/oficial/comum/config/ele-c.json` | 200 | índice com 2026 federal e estadual, 1º e 2º turnos (6257–6260) | disponível para o R5 |
| STF | `transparencia.stf.jus.br`, Corte Aberta | 403 / 200 | raiz recusa mesmo com UA de navegador; Corte Aberta é painel HTML | sem API; bloqueio de §8 mantido |
| ALEs | ALMG `/ws/deputados/em_exercicio`, ALESP `/dados-abertos` | 200 | ALMG JSON; ALESP página de downloads | heterogêneo, adapter por UF |
| SAPL | `/api/` em 6 câmaras | 2× 200, 503, 3× sem resposta | Campinas e Acre devolvem JSON | 2 de 6; cobertura do adapter genérico será parcial |
| Fotos oficiais | Câmara `bandep/{id}.jpg`, Senado `fotos-oficiais` | 200 | 48 KB e 233 KB | disponível; a do Senado passa de 200 KB |

Achados que mudam o ETL:
- **O TSE regrava os zips todo dia.** O `Last-Modified` é de hoje até nos arquivos de 2024, e o `ETag` é do tipo tamanho-mtime (`"3db6430-65f587ae1d637"`), então muda junto. O GET condicional de `http.py` não evita download nenhum no TSE.
  - `tse.votos` e `tse.contas` leem por Range e usam o CRC32 do membro como checksum: não baixam o zip e só reprocessam se o conteúdo mudou. Critério certo.
  - `tse.candidatos` baixa o zip inteiro por `http.py` e usa o sha256 do corpo. Custa 65 MB por ano por run, e reprocessa à toa se a regravação mudar bytes sem mudar dado (não verificado). Corrigir: passar para `remotezip` + CRC32 dos membros, como os outros dois.
- **Os dados de 2026 já estão publicados.** `tse.candidatos` e `tse.votos` podem carregar 2026 agora; prestação de contas deve ser recarregada semanalmente até a consolidação.
- **Foto do Senado acima do teto.** O espelho no Storage (R2) precisa redimensionar, não só copiar.
- **Transparência:** o cadastro da chave é o pré-requisito do passo 6 de §11.

## 3. Contrato de integração por fonte

Toda fonte nova precisa preencher esta ficha antes de ganhar job. É o critério de aceite para o adapter entrar no `cli.py`.

| campo | exemplo (Câmara · votos) |
| --- | --- |
| `sources.slug` e licença | `camara` · CC0 |
| URL e formato | `/arquivos/votacoesVotos/csv/votacoesVotos-{ano}.csv`, `;`, UTF-8 |
| unidade de checksum | arquivo anual (sha256 do corpo) |
| chave natural → tabela | `(voting_event_id, person_id)` → `votes` (unique) |
| chave de identidade | `idDeputado` → `person_external_ids(source='camara')` |
| fato sem identidade resolvida | não entra no crachá: staging sem `person_id` + `identity_match_queue` |
| `null` × 0 | campo ausente fica `null`, nunca 0 |
| tags a invalidar | `person:<id>` dos afetados + `dataset:camara.votos` |
| SLO de frescor | stamp com menos de 48 h (invariante do `check`) |
| quebra conhecida | voto em evento não nominal → rejeitado (invariante) |

## 4. Padrões transversais (já no código)

1. **Cliente HTTP único** (`etl/civico_etl/http.py`):
   - cache em disco por URL e GET condicional (`ETag`/`If-Modified-Since`);
   - throttle por host (`ETL_RATE_LIMIT`, padrão 5 req/s);
   - retry com backoff exponencial (2, 4, 8, 16 s com `retries=4`; teto de 60 s) em erro HTTP e de transporte;
   - 404 vira `FileNotFoundError` ("ainda não publicado") e não é tratado como falha transitória;
   - furo: outros 4xx (400, 401, 403) também entram no retry, via `raise_for_status()`. Uma chave inválida da Transparência gastaria 30 s em retentativas inúteis. Corrigir antes do R2: só 408, 429 e 5xx são transitórios;
   - User-Agent identificado.
2. **Contrato de run** (`db.run`):
   - `pg_try_advisory_lock(hashtext(dataset))`: dois runs do mesmo dataset não coexistem;
   - linha em `ingest_runs`, com skip se o checksum da entrada for igual ao do último run `succeeded`;
   - commit atômico, `dataset_stamps` atualizado só no sucesso;
   - na falha: rollback, run `failed` com o erro e o dado anterior intacto.
3. **Upsert em lote:** `COPY` para tabela temporária, `DISTINCT ON` da chave, depois `INSERT … ON CONFLICT DO UPDATE`. Reprocessar é idempotente.
4. **Identidade em cascata** (`identity.py`, `identity_dedupe.py`):
   - ordem: id da fonte → título de eleitor → nome civil + nascimento → cadeira + nome parlamentar ou nascimento → fila manual;
   - nunca casa por nome sozinho;
   - duplicata publicada vira `merge_person()` com redirect 308.
5. **Proveniência na leitura:** `sources` + `dataset_stamps` alimentam o rodapé "Fonte · atualizado em" de todo bloco e o `/dados-abertos`.
6. **Invariantes pós-carga** (`civico-etl check`, exit 1): contagem de cadeiras, sobreposição de mandatos, presença ≤ total, frescor de stamp. São o gate de qualquer run agendado.

## 5. Orquestração e deploy do ETL

Decisão: **uma Fly Machine pequena, sempre ligada, com `supercronic`** executando `civico-etl <job>`, mais um **Fly Volume** montado em `ETL_CACHE_DIR`.

| opção | ganho | custo | onde quebra |
| --- | --- | --- | --- |
| **supercronic numa machine sempre ligada + volume** (escolhida) | cron com granularidade de minuto (a apuração precisa de 1 min, a agenda de 15 min); o cache de ETag e os zips do TSE persistem entre runs | ~US$ 5–10/mês ligada o tempo todo; um único ponto de execução | se a machine cai, nada roda. Mitigação: alerta de stamp vencido (§9) e restart automático do Fly |
| Fly scheduled machines (`--schedule`) | paga só o tempo de run | granularidade só hourly/daily/weekly/monthly; sem volume persistente entre execuções sem gambiarra | agenda de 15 min e apuração de 1 min não cabem |
| GitHub Actions cron | grátis, logs prontos | cron mínimo de 5 min e sem garantia de horário; 6 h de limite por job; sem cache persistente | dia de eleição; TSE com GB por run |
| Vercel Cron + route handler | já está no stack | 300–800 s de limite e memória de serverless | o TSE não cabe (motivo do ETL estar fora da Vercel) |

Regras de operação:
- **Conexão do ETL:** sempre direta, em modo sessão (porta 5432 ou o pooler em modo sessão), nunca pelo pooler em modo transação. O advisory lock é de sessão e o `COPY` usa tabela temporária. Pelo pooler em modo transação, o lock "vaza" entre clientes e a temp table some entre statements.
- **Role do ETL:** `etl_writer` com login, `insert/update/select` nas tabelas de dados e `bypassrls`, sem `superuser`. Não usar o usuário `postgres` do Supabase em runtime. Criar na migração 0005 (0003 e 0004 já são do `web_writer` e de `authenticated`).
- **Volume:** 50 GB. O TSE completo (votos por município de 5 eleições) passa de 3 GB comprimido, e o cache guarda o corpo inteiro.
- **Janela:** jobs pesados (TSE, Transparência) de madrugada, quando a fonte tem mais folga e o banco tem menos leitura.
- **Concorrência:** um processo por job. O advisory lock já impede sobreposição do mesmo dataset; datasets diferentes podem rodar juntos.

Crontab inicial (UTC; Brasília = UTC−3):

```cron
0 9 * * *        civico-etl camara.diario && civico-etl senado.diario && civico-etl check
*/15 11-23 * * 1-5  civico-etl camara.agenda; civico-etl senado.agenda          # R2
0 6 * * *        civico-etl transparencia.emendas                               # R2
0 5 * * 1        civico-etl tse.candidatos                                      # semanal em ano eleitoral
0 10 1 1 *       civico-etl ibge.places
0 12 * * 0       civico-etl audit.coverage                                      # R2
```

## 6. Modos de falha e degradação

| falha | detecção | comportamento | quem vê o quê |
| --- | --- | --- | --- |
| fonte fora do ar ou 5xx persistente | retries esgotados → run `failed` | dado anterior continua no ar; stamp não avança | rodapé mostra a data antiga; `/dados-abertos` marca o atraso |
| fonte muda o formato (coluna renomeada) | exceção no parse → `failed`; ou pico de `rows_rejected` | rollback do run inteiro, nada parcial | alerta (§9); usuário não vê mudança |
| arquivo ainda não publicado (404) | `FileNotFoundError` | o job pula o ano/dataset sem falhar o run | "faltam N dados · por quê" via `data_coverage` |
| fonte publica dado incoerente (presença > total, voto em evento não nominal) | `check` / constraint | linha rejeitada ou run falha no `check` | nada publicado errado |
| casamento de identidade abaixo de 0,9 | `identity_match_queue` | fato fica em staging, fora do crachá | crachá mostra menos, nunca a pessoa errada |
| Senado marca votação como secreta | regra no job | só votações abertas entram | regra publicada em `/sobre` |
| revalidação falha | warning no log do ETL (erro de transporte ou status ≠ 200) | o dado novo aparece no vencimento do TTL | atraso de até 1 h (dado) ou 10 min (home) |
| Supabase fora | erro na camada de dados | página de erro com retry; nada de fallback para o fake em produção (`index.ts` lança) | erro explícito, nunca dado de demonstração |
| Resend recusa ou dá bounce | webhook | `profiles.digest = 'off'` | usuário para de receber; reativa no perfil |
| Turnstile fora | `siteverify` com erro | fail-closed: OTP e sugestão recusam | mensagem "tente em instantes" |

## 7. Lacunas entre desenho e código (por prioridade)

### 7.1 Revalidação ligada nas duas pontas (resolvido em 2026-11-02)

- **Antes:** o ETL invalidava a tag `data`, mas nenhuma leitura do app registrava tag.
  - A home e a barra "Dados oficiais conferidos em…" do layout eram geradas no build e ficavam congeladas até o próximo deploy.
  - As páginas com `searchParams` iam ao Postgres a cada requisição.
- **Agora:**
  - **Cache de dados:** `web/src/lib/data/index.ts` envolve toda leitura em `unstable_cache`, só com `DATA_SOURCE=pg`. Os argumentos entram na chave e o TTL é de 1 h. As tags são:
    - `data`, em toda leitura;
    - `ds:<método>`;
    - `person:<id>`, nas leituras por pessoa e em `getAgreement`;
    - `place:<ibge>`, em `getPlace`, `getRepresentatives` e `getCoverage`.
  - **Páginas:** a home tem `revalidate = 600`. As páginas estáticas herdam o TTL de 1 h da barra do layout (`next build` mostra `Revalidate 10m` e `1h`).
  - **ETL:** continua enviando só `data`, uma invalidação global por run. Uma resposta diferente de 200 agora gera warning.
- **Aceite verificado** (build de produção, `next start` contra o Postgres local com a carga real):
  - **Cache:** a 1ª requisição ao crachá fez 10 transações no banco; a 2ª fez 0 (baseline ocioso descontado).
  - **Revalidação:** `ibge.places --force` sozinho não muda nada, porque o crachá segue servindo o stamp em cache. Depois de `derive.stats` com `REVALIDATE_URL`, crachá e home passam a mostrar o stamp novo, sem redeploy.
  - **Segredo errado:** a revalidação devolve 401.
  - **E2E contra dado real**, refeito sobre a `main` com auth (build de produção, `E2E_PG=1`):
    - 39 passaram;
    - F01-E1 falha porque espera 4 "Bom Jesus" do dataset demo, e o IBGE tem 10. É dado, não código;
    - os 4 fluxos de conta falham em `next start` por desenho: Turnstile fecha sem chave e o login local é só de dev. Em `next dev` com o mesmo código, passam.
- **Residual, por decisão:**
  - **Invalidação global.** Com cadência diária, uma invalidação global por run custa um miss por chave depois de cada ETL, o que é aceitável.
    - Tags por pessoa ficam para quando entrarem jobs de 15 min (agenda), que não devem esfriar o cache inteiro.
    - Nesse momento, o ETL envia `person:<id>` dos ids tocados no upsert, em lotes de até 5000.
  - **HTML do crachá e de `/representantes` não vai para a CDN.** Essas páginas leem `searchParams` (filtros), então o HTML é renderizado por requisição na função da Vercel. O dado já não vai ao banco.
    - Para servir o HTML pela CDN, os filtros precisam sair da URL da página, por exemplo para a API paginada que já existe.
    - Antes do pico de eleição, medir o custo de função.
  - **O build exige banco acessível**, porque a home é pré-renderizada. Na Vercel isso significa `DATABASE_URL` disponível no ambiente de build.

### 7.2 Autenticação do `/api/revalidate` diverge do desenho

- **Desenho:** HMAC no header com janela de 5 min. **Código:** Bearer comparado em tempo constante.
- **Avaliação:** o impacto de um replay é forçar invalidação de cache, ou seja, carga no banco e nada de vazamento.
- **Decisão:** manter Bearer sobre TLS e adicionar regra de WAF (10/min por IP nessa rota). O doc de arquitetura foi corrigido.
- **Quando reabrir:** se a rota passar a aceitar outra coisa além de tags.

### 7.3 ETL sem role própria nem conexão definida para o Supabase

O código lê `ETL_DATABASE_URL` sem restrição, e a mensagem de `db.py` ainda manda usar `service_role`. No Supabase essa role é `nologin` e existe para o PostgREST, não para conexão direta. Ver §5: migração 0005 com `etl_writer` e documentação da URL de sessão.

### 7.4 Cache do ETL em disco local

`etl/.cache` some em machine efêmera. O checksum ainda evita reprocessar via `ingest_runs`, mas o download é refeito: vários GB por run do TSE. Resolvido pelo volume de §5.

### 7.5 Lacunas de dado já registradas

Ver `backend.md`, "Dívida": siglas reutilizadas, `mandate_periods` vazio, fotos sem espelho. Votos por candidato e prestação de contas do TSE já carregam para eleitos (`tse.votos`, `tse.contas`).

## 8. Riscos de integração

1. **Mudança silenciosa de formato nas fontes.** O TSE muda colunas entre eleições e a Câmara já mudou nomes de arquivo. Mitigações:
   - parse por nome de coluna, nunca por posição;
   - teste de contrato por fonte: um fixture pequeno de cada arquivo/endpoint no repo, rodado em CI;
   - alerta quando `rows_rejected / rows_upserted` passa de 1%.
2. **STF sem API oficial.** A regra "só API oficial e pública" deixa duas opções: download publicado pelo próprio STF (painéis "Corte Aberta"/transparência) ou cortar o módulo. Raspar HTML do portal fica fora. Decidir no R5. Até lá, S15 é stub.
3. **Cobertura estadual e municipal.** ALEs e câmaras sem dado aberto são a regra, não a exceção. O adapter SAPL genérico cobre só quem roda SAPL 3.x com API exposta. Todo o resto vira `data_coverage` honesto.
4. **Limites do Portal da Transparência.** O limite por minuto é mais alto de madrugada (confirmar os números na documentação da chave antes do R2). Com cerca de 600 parlamentares × N páginas, cabe numa janela noturna a 1 req/s.
5. **Dia de eleição.** A apuração a cada 1 min pelo JSON público do TSE é a integração de maior carga dos dois lados:
   - a CDN absorve o tráfego dos usuários com `s-maxage=10`;
   - o banco recebe só um writer;
   - ensaio obrigatório com o JSON de 2024 antes de 2026 (já passou) ou 2028.

## 9. Observabilidade

| sinal | fonte | alerta |
| --- | --- | --- |
| run `failed` | `ingest_runs.status` | imediato, por e-mail ou Sentry cron monitor |
| stamp vencido (Câmara/Senado > 48 h, TSE > 60 dias) | `dataset_stamps` + `civico-etl check` | diário |
| taxa de rejeição > 1% | `ingest_runs.rows_rejected / rows_upserted` | por run |
| fila de identidade crescendo | `count(identity_match_queue where status='pending')` | semanal, priorizada por eleitos |
| revalidação com status ≠ 200 | log do ETL | por run |
| erro 5xx no app | Sentry + Vercel | padrão |

Cada job agendado faz check-in no Sentry Cron Monitor: início, sucesso e falha. A ausência de check-in também alerta, o que cobre "a machine caiu e nada rodou".

## 10. Segurança da integração

- **Segredos:** só em secrets do Fly e env da Vercel. A service key do Supabase existe **só** no Fly. A Vercel não tem credencial de escrita no banco, exceto pelas server actions de `profiles`/`follows`/`suggestions`, que conectam como `web_writer` e rodam cada operação em transação com `role authenticated` + `request.jwt.claim.sub` (RLS do usuário vale).
- **Menor privilégio:**
  - `web_reader`: só `select` nas tabelas públicas (RLS testada);
  - `etl_writer`: sem DDL;
  - migrações rodam com o owner, no CI, nunca no runtime.
- **Entrada de fonte é dado não confiável:**
  - zips descompactados em diretório próprio e lidos pelo DuckDB, sem executar nada;
  - limite de tamanho por arquivo (corta o download acima de 2 GB);
  - texto da fonte nunca é renderizado como HTML.
- **Webhooks de entrada:** Resend verificado pela assinatura Svix; a rota rejeita timestamp com mais de 5 min.
- **MCP:**
  - ferramentas só de leitura, sobre a mesma camada `lib/data`;
  - sem SQL livre e sem parâmetro que vire ordenação por métrica;
  - rate limit no WAF;
  - toda resposta carrega fonte e data.

## 11. Ordem de execução

| passo | release | entrega | aceite |
| --- | --- | --- | --- |
| 1 | R0 | ~~fix de revalidação (§7.1)~~ feito | aceite de §7.1 verificado em 2026-11-02 |
| 2 | R0 | migração 0005 `etl_writer` + doc da URL de sessão | `civico-etl all` roda com `etl_writer`; `etl_writer` não consegue `create table` |
| 3 | R0 | Dockerfile do ETL + `fly.toml` + volume + supercronic + Sentry Cron | dois dias seguidos de `camara.diario` agendado com stamp avançando e check-in verde |
| 4 | R0 | Supabase + Vercel ligados (migrar, `web_reader` com senha, pooler) | aceite do R0 de `architecture.md` num deploy real |
| 5 | R1 | testes de contrato por fonte no CI (fixtures) | renomear uma coluna no fixture faz o teste falhar |
| 6 | R2 | Transparência (chave), agendas, Resend + Turnstile + Auth | sugestão sem token Turnstile → 400; bounce → `digest='off'` |
| 7 | R2 | espelho de fotos no Storage | crachá carrega a foto do domínio próprio, ≤ 200 KB |
| 8 | R5 | MCP, apuração, Receita/SIDRA/BCB; decisão sobre o STF | cliente MCP lista 10 ferramentas; ensaio de apuração com JSON de 2024 |
