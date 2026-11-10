# Backend: Postgres + ETL das fontes oficiais

Estado em 2026-11-02. Camada real ligada ao app (`DATA_SOURCE=pg`), ETL rodado contra Postgres 16 local com os dados oficiais de verdade. Supabase, auth, e-mail e jobs agendados ainda são configuração do usuário (R2).

## O que existe

| peça | onde | estado |
| --- | --- | --- |
| migrações | `db/migrations/0001_init.sql` (64 tabelas), `0002_merge_person.sql` | aplicadas por `db/migrate.sh` (checksum por arquivo; migração publicada não se edita) |
| Postgres local | `db/pg-local.sh start` → `postgres://postgres@localhost:54329/civico`; `--local` aplica o stub do Supabase (roles, `auth.uid()`) e dá login ao `web_reader` | ok |
| camada de dados do app | `web/src/lib/data/pg.ts` implementa o contrato `DataSource`; `index.ts` escolhe por `DATA_SOURCE` | 0 mudanças em tela; produção sem `DATA_SOURCE=pg` falha de propósito |
| ETL | `etl/` (Python 3.12+, httpx, psycopg, DuckDB), `civico-etl <job>` | seed, ibge.places, tse.candidatos, camara.diario, senado.diario, identity.dedupe, derive.stats |
| agendamento | `.github/workflows/etl-pauta.yml` (30 em 30 min seg–sex 08–22h, 3 em 3 h no fim de semana) e `etl-rascunho.yml` (seg–sex 08:30 e 14:30, limite 10); local: `etl/agenda/agendar-local.sh` (launchd, só banco local) | workflows inertes até: merge na main + secrets `ETL_DATABASE_URL`, `ANTHROPIC_API_KEY` |
| revalidação | `POST /api/revalidate` com Bearer `REVALIDATE_SECRET`; o `derive.stats` chama se `REVALIDATE_URL` existir | ok |

Desvio do baseline: `postgres` (postgres.js) em vez de Drizzle. O schema é SQL escrito à mão e validado; um query builder viraria segunda fonte de verdade sem ganho. Tagged templates dão parametrização segura.

## Carga verificada (local, 2026-11-02)

| fonte | dataset | linhas | tempo |
| --- | --- | --- | --- |
| IBGE | 1 país, 5 regiões, 27 UFs, 5.571 municípios; 5.600 casas legislativas | 11.204 | 1 s |
| TSE 2022 | eleitos: 1.707 candidaturas, 1.655 mandatos (513 + 27 + 27 + 27 + 1.059 + 2, bate com as cadeiras), bens | 4.930 | 1 s |
| TSE 2024 | eleitos: 69.510 candidaturas, 69.310 mandatos municipais, bens | 126.587 | 39 s |
| TSE 2026 | eleitos aguardando posse: 1.710 candidaturas, 1.682 mandatos | 5.034 | 3 s |
| Câmara | 882 deputados da legislatura (detalhe por pessoa), 540 mandatos; 2025+2026: 3.437 votações do Plenário (555 nominais), 224 mil votos, 4,1 mil orientações; 38,9 mil proposições com autoria e tema; 306 mil lançamentos da cota | — | ~3 min |
| Senado | 81 em exercício + afastados da legislatura; 2025+2026: 24 votações nominais abertas, 1,8 mil votos | — | ~1 min |
| derivado | `person_period_stats` 217 mil linhas (carreira + ano), `data_coverage` 33,5 mil linhas padrão, `attendance` 96,5 mil | — | 5 s |

Build 5 (2026-11-03): TSE 2012–2026 `--all` (ligado ao diretório), Câmara 2019–2026 (votos, cota, presença oficial, propostas com emendas, equipe), Senado 2019–2026 (votações, autorias, CEAPS, filiações), população IBGE 2026 e tetos. Números e tempos em `build-log.md` › "build 5 · dados".

Resultado (R0): 71.017 pessoas no cargo, 1.682 aguardando posse. 513 deputados em exercício (487 titulares + 26 suplentes) e 81 senadores (70 + 11): as contas fecham com as cadeiras.

## Regras publicadas (o que o usuário precisa saber para confiar no número)

- **Presença** (D30/D31): oficial. Câmara: lista de presença das Sessões Deliberativas do Plenário (`eventosPresencaDeputados` + `eventos`, órgão PLEN, encerradas). Presente = está na lista; ausente = estava em exercício na hora da sessão (períodos do `/deputados/{id}/historico`) e não está na lista; fora do exercício não entra no total. Ausência justificada conta como ausência (o dado aberto não traz a justificativa). Senado: não publica presença por senador → null ("—"). Presença derivada de voto não existe mais.
- **Fidelidade ao partido**: votos sim/não iguais à orientação do partido na data do voto, só nas votações em que houve orientação.
- **Temas**: os 32 temas oficiais da Câmara (`proposicoesTemas`) caem em 17 temas do produto por regra fixa (`etl/civico_etl/jobs/seed.py`, `rule_version 1`). Senado não classifica matérias no mesmo formato: votos do Senado ficam sem tema.
- **Salário**: Decreto Legislativo 7/2022 (deputados, senadores, presidente, vice), escalonado 2023/2024/2025. Cargos estaduais e municipais: teto constitucional só quando a casa publicar; até lá "—".
- **Partido mostrado** (D32): linha do tempo. Observações datadas: Câmara `/historico` (cada registro tem partido e data), Senado `/filiacoes` (data de filiação), candidaturas do TSE (data do 1º turno). O partido de hoje = a observação mais recente; no mesmo dia, a casa vence o TSE. `party_memberships` é reconstruída a cada `derive.stats`; o app lê `person_current_party`. Partidos: renomeações viram alias (PMDB→MDB, PR→PL…); fusões não são fundidas.
- **Vacância estadual e municipal** (D33): governador/prefeito candidato a outro cargo numa eleição geral renuncia 6 meses antes do 1º turno (CF art. 14 §6); o vice assume (mandato de titular novo) e a vaga de vice fica vazia; vice que concorreu a terceiro cargo também sai (o interino, presidente da casa, não está em fonte nenhuma). Posse em cargo incompatível encerra o anterior na data da posse (dep. estadual eleito prefeito). Cassação publicada pelo TSE na votação → `cassado`. Licença, morte e cassação pela casa estadual/municipal: sem fonte nacional aberta.
- **Diretório** (D34): só quem tem mandato atual ou a tomar posse vira crachá. Candidaturas derrotadas e eleições anteriores (TSE 2018–2026, `--all`) e atividade da Câmara de 2019–2022 só se ligam a quem já está no diretório.
- **Salário** (D37): subsídio federal pelo Decreto Legislativo 7/2022. Teto constitucional (`is_ceiling`): dep. estadual/distrital = 75% do federal (CF art. 27 §2º, 32 §3º); vereador = 20% a 75% do estadual pela população IBGE do município (CF art. 29 VI). Governador e prefeito: lei local, "—".
- **Campanha** (D36): total arrecadado (`VR_RECEITA`) e pago (`VR_PAGTO_DESPESA`); origem e destino agregados por categoria oficial do TSE em `campaign_finance_entries`. Nenhum doador nem fornecedor é gravado.
- **Mais votados na cidade** (D35): `candidacy_place_votes` (votos por município, cargos estaduais e federais, 2018/2022/2026) só das candidaturas do diretório: o ranking é entre quem tem crachá.
- **Eleição suplementar**: o mandato começa na data da eleição (aproximação da posse) e encerra, nessa data, os mandatos regulares da mesma disputa, inclusive o da mesma pessoa reeleita; exceto senador (vaga única entre três). 82 disputas em 2024/2026.
- **Status do mandato**: TSE cria (em exercício / aguardando posse); a casa é dona do status depois. Câmara: "Não Eleito" + "Vacância" = perdeu o mandato (ex.: cassação) → `encerrado`; eleito que a Câmara não lista na legislatura → `encerrado` (não tomou posse). Senado: lista por legislatura traz a causa do afastamento (REN → `renunciou`, AFO → `licenciado`).
- **Identidade**: id da fonte → título de eleitor → nome civil + nascimento → cadeira (cargo + lugar) + nome parlamentar igual ou mesmo nascimento → fila manual. Nunca por nome sozinho. Duplicata já publicada é fundida por `merge_person()` com redirect 308 do slug antigo (13 fusões na primeira carga: TSE e Câmara divergem em nome civil e até em data de nascimento).
- **Votos do Senado** (D39): `/votacao?dataInicio&dataFim` traz todas as votações nominais do Plenário (2026: 62; 2025: 128). Secreta entra como evento sem voto individual (a fonte só diz "Votou"). Matérias de autoria: `/senador/{cod}/autorias` (carreira inteira). Cota: CEAPS (`adm-dadosabertos /senadores/despesas_ceaps/{ano}`) 2019–2026.
- **Equipe de gabinete** (D40): secretários parlamentares da Câmara (`funcionarios.csv`), nome e nível; salário null (o arquivo não traz). Senado não carregado.
- **`null` nunca vira 0**: casa sem adapter de dados abertos → estatística `null` e lista de "faltam N dados" por `data_coverage`.

## Invariantes (`civico-etl check`, exit 1 se quebrar)

carreira = total direto da fonte e ≥ soma dos anos; nenhum zero em ano sem carga da fonte; ≤ 513 deputados e ≤ 81 senadores em exercício; um titular de Executivo por lugar; exatamente 1 prefeito titular em exercício por município, salvo `PREFEITO_EXCECOES` com motivo (D92); nenhuma sobreposição de mandato; nenhuma duplicata TSE × casa na mesma cadeira; voto só em evento nominal; presença ≤ total; stamp da Câmara/Senado com menos de 48 h e do TSE com menos de 60 dias. Roda ao fim de `all` e no `replica-test`.

## Contrato de job (todos)

advisory lock por dataset → linha em `ingest_runs` → pula se o checksum da entrada não mudou (`--force` ignora) → COPY em tabela temporária + `INSERT … ON CONFLICT (chave natural)` → `dataset_stamps` → `derive.stats` → `/api/revalidate`. Fonte fora do ar: run `failed`, dado anterior fica no ar com o stamp antigo. Run que gravou mas reteve algo fecha `partial` (`Run.partial`): carimba, alerta na agenda, não é base de skip e a tarefa volta a rodar no intervalo de nova tentativa. Notas vão em `ingest_runs.notes`; `error` só tem erro ou o motivo do partial. Nada é apagado.

```bash
db/pg-local.sh start && DATABASE_URL=$(db/pg-local.sh url) db/migrate.sh --local
cd etl && uv venv .venv && uv pip install -p .venv/bin/python -e .
export ETL_DATABASE_URL=postgres://postgres@localhost:54329/civico
civico-etl seed && civico-etl ibge.places
civico-etl tse.candidatos --all --year 2018 --year 2020 --year 2022 --year 2024 --year 2026   # derrotados só se ligam a quem está no diretório
civico-etl ibge.populacao                                           # população IBGE + tetos de vereador (seed)
civico-etl camara.diario --year 2019 … --year 2026                  # --limit 40 em desenvolvimento; anos < 2023 não criam pessoa
civico-etl camara.presenca --year 2019 … --year 2026                # presença oficial (sessões deliberativas)
civico-etl camara.equipe                                            # secretários parlamentares
civico-etl senado.diario --year 2019 … --year 2026                  # votações, autorias, filiações, CEAPS
civico-etl tse.votos --year 2018 … --year 2026 && civico-etl tse.contas --year 2018 … --year 2026
```

## Auth e escrita (R2, construído em 2026-11-02)

- `web/src/lib/auth/`: contrato `AuthProvider`. `supabase.ts` (produção: `signInWithOtp` com `captchaToken`, `verifyOtp`, `getUser` validado no servidor, `signOut` global, apagar via admin API) e `dev.ts` (local: código de 6 números com hash e sal, 10 min, 5 tentativas, 3 envios/h por e-mail, sessão em cookie http-only assinado com HMAC; o "e-mail" vai para `.local/mail/`). `AUTH_PROVIDER=dev` recusa produção.
- O e-mail entre as duas etapas fica num cookie http-only de 15 min restrito a `/entrar`, nunca na URL. `volta` validado com `^/(?![/\\])`.
- Escrita: role `web_writer` (migração 0003), conexão separada (`DATABASE_WRITE_URL`). Operações de usuário rodam em transação com `role authenticated` + `request.jwt.claim.sub`, então as policies `own_*` valem também no servidor. Testado: B não vê nem escreve os follows de A; o writer não lê `votes`.
- Funções de leitura do usuário ficam fora do arquivo `"use server"` (todo export de lá vira endpoint chamável).
- Sugestões: zod, Turnstile (falha fechado em produção sem chave), honeypot, 5 por hora por IP com hash e sal diário.
- Falta: envio do resumo por e-mail (job `app.digest` + Resend), descadastro por link (RFC 8058), anonimização das sugestões após 12 meses. Supabase e Resend dependem de contas suas.

## Auth, e-mail, pagamentos

- Pagamentos: não há (produto não comercial). Nenhuma peça de Stripe.
- Auth (R2): Supabase Auth, OTP por e-mail, CAPTCHA nativo (Turnstile), sessão em cookie http-only. Políticas de `profiles`/`follows` já estão na migração 0001 e foram testadas com dois usuários no replica-architect. Apagar conta apaga tudo (cascata de `auth.users`).
- E-mail (R2): Resend como SMTP do Supabase Auth e para o digest; `List-Unsubscribe` one-click (POST) já desenhado na arquitetura.

## Checklist de segurança

- [x] segredos só em env: `.env*` no `.gitignore`; `.env.example` sem valores; nada chega ao bundle (`server-only` em `pg.ts`; `DATABASE_URL` só no servidor)
- [x] input validado no servidor em toda rota (`/api/places`, `/api/people/*`, `/api/compare/agreement`, `/api/revalidate`: tamanho, regex, enum; inválido = 400)
- [x] autorização em toda leitura: o app conecta como `web_reader` (só `select` nas tabelas públicas via RLS). Testado: `anon` nega tudo; `web_reader` lê `people` (71 mil) e NÃO lê `person_external_ids` nem escreve em `sources`
- [x] rate limit em auth e envio: Supabase Auth (3/h por e-mail) + Turnstile; dev: 3 códigos/h e 5 tentativas; sugestões 5/h por IP. WAF do Vercel no deploy
- [x] webhook/callback verifica segredo: `/api/revalidate` compara Bearer em tempo constante
- [x] uploads: não há upload de usuário; fotos só por URL oficial (Câmara/Senado), espelhamento no R2
- [x] nenhum dado de usuário em URL ou log (o termo de busca não vai para analytics; logs do ETL têm só ids públicos)
- [x] `npm audit --omit=dev`: 2 avisos, ambos no `next` 15.5.28 (moderado no próprio Next; alto no `postcss` interno, só em build e só sobre CSS do próprio repo). Correção exige Next 16.x (major): fica para o R2, antes do deploy
- [ ] política de privacidade listando processadores (Vercel, Supabase, Resend, Fly): R2, no `/sobre`

## Dívida e riscos registrados

- Emendas parlamentares: bloqueadas (chave do Portal da Transparência; decisão D04 da rodada). `amendments` vazia.
- ALESP e demais Assembleias, câmaras municipais: fora deste lote (presença, propostas, cota, salário pago).
- Governador e prefeito: salário depende de lei local; sem seed.
- Senado: sem presença (não publica); equipe dos senadores não carregada; 8 suplentes em exercício não têm candidatura própria (o TSE registra suplente na chapa do titular; o cargo "suplente de senador" não existe em `offices`).
- "Mais votados na cidade" só entre quem tem crachá (D35).
- Siglas reutilizadas por partidos diferentes (PL 1985 ≠ PL 2006) estão numa linha só.
- Filiação vinda do TSE tem a data da eleição, não a da filiação real.
- Vacância: licença e morte de deputado estadual, vereador e prefeito não têm fonte aberta nacional; o contador conta a cadeira do titular até lá.
- `people` sem foto espelhada: só a URL oficial; o espelhamento com limite de 200 KB entra no R2.
- Desempenho em dev: lista de uma capital com 200 pessoas leva ~1 s de query (view `person_current_party` por linha). Índice ou materialização no R1.

Desvio do baseline (jobs): pauta e rascunho rodam em GitHub Actions, não em Fly Machines. São jobs leves (HTTP + uma chamada de API, ~4 s a pauta), sem DuckDB nem arquivo de GB, e não exigem infra nova. O que se paga: o cron do GitHub atrasa minutos e pode pular disparo (a janela de 30 min absorve), e o banco precisa aceitar conexão de fora (Supabase aceita). Fly continua o lugar dos jobs pesados (TSE).
