# Backend: Postgres + ETL das fontes oficiais

Estado em 2026-11-02. Camada real ligada ao app (`DATA_SOURCE=pg`), ETL rodado contra Postgres 16 local com os dados oficiais de verdade. Supabase, auth, e-mail e jobs agendados ainda são configuração do usuário (R2).

## O que existe

| peça | onde | estado |
| --- | --- | --- |
| migrações | `db/migrations/0001_init.sql` (64 tabelas), `0002_merge_person.sql` | aplicadas por `db/migrate.sh` (checksum por arquivo; migração publicada não se edita) |
| Postgres local | `db/pg-local.sh start` → `postgres://postgres@localhost:54329/civico`; `--local` aplica o stub do Supabase (roles, `auth.uid()`) e dá login ao `web_reader` | ok |
| camada de dados do app | `web/src/lib/data/pg.ts` implementa o contrato `DataSource`; `index.ts` escolhe por `DATA_SOURCE` | 0 mudanças em tela; produção sem `DATA_SOURCE=pg` falha de propósito |
| ETL | `etl/` (Python 3.12+, httpx, psycopg, DuckDB), `civico-etl <job>` | seed, ibge.places, tse.candidatos, camara.diario, senado.diario, identity.dedupe, derive.stats |
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

Resultado: 71.017 pessoas no cargo, 1.682 aguardando posse. 513 deputados em exercício (487 titulares + 26 suplentes) e 81 senadores (70 + 11): as contas fecham com as cadeiras.

## Regras publicadas (o que o usuário precisa saber para confiar no número)

- **Presença**: derivada. Sessão = evento do Plenário com votação nominal. Presente = registrou voto (inclusive abstenção, obstrução e art. 17). Ausente = tinha mandato e não votou. "Fora do exercício" = mandato hoje não está em exercício (a fonte não publica o histórico de licenças, então é aproximação). Vale para Câmara e Senado.
- **Fidelidade ao partido**: votos sim/não iguais à orientação do partido na data do voto, só nas votações em que houve orientação.
- **Temas**: os 32 temas oficiais da Câmara (`proposicoesTemas`) caem em 17 temas do produto por regra fixa (`etl/civico_etl/jobs/seed.py`, `rule_version 1`). Senado não classifica matérias no mesmo formato: votos do Senado ficam sem tema.
- **Salário**: Decreto Legislativo 7/2022 (deputados, senadores, presidente, vice), escalonado 2023/2024/2025. Cargos estaduais e municipais: teto constitucional só quando a casa publicar; até lá "—".
- **Partido mostrado**: filiação atual segundo a casa (`party_memberships` com `from_on` = início da legislatura, aproximação) ou, na falta, o partido na posse (TSE). Partidos: renomeações viram alias (PMDB→MDB, PR→PL…); fusões não são fundidas.
- **Eleição suplementar**: o mandato começa na data da eleição (aproximação da posse) e encerra, nessa data, os mandatos regulares da mesma disputa, inclusive o da mesma pessoa reeleita; exceto senador (vaga única entre três). 82 disputas em 2024/2026.
- **Status do mandato**: TSE cria (em exercício / aguardando posse); a casa é dona do status depois. Câmara: "Não Eleito" + "Vacância" = perdeu o mandato (ex.: cassação) → `encerrado`; eleito que a Câmara não lista na legislatura → `encerrado` (não tomou posse). Senado: lista por legislatura traz a causa do afastamento (REN → `renunciou`, AFO → `licenciado`).
- **Identidade**: id da fonte → título de eleitor → nome civil + nascimento → cadeira (cargo + lugar) + nome parlamentar igual ou mesmo nascimento → fila manual. Nunca por nome sozinho. Duplicata já publicada é fundida por `merge_person()` com redirect 308 do slug antigo (13 fusões na primeira carga: TSE e Câmara divergem em nome civil e até em data de nascimento).
- **Votos do Senado**: a API por senador marca como secretas 77 de 93 votações de 2025 e devolve "Votou"; só votações abertas entram. Conferir com `/plenario/lista/votacao` no R2.
- **`null` nunca vira 0**: casa sem adapter de dados abertos → estatística `null` e lista de "faltam N dados" por `data_coverage`.

## Invariantes (`civico-etl check`, exit 1 se quebrar)

carreira = soma dos anos; nenhum zero em ano sem carga da fonte; ≤ 513 deputados e ≤ 81 senadores em exercício; um titular de Executivo por lugar; nenhuma sobreposição de mandato; nenhuma duplicata TSE × casa na mesma cadeira; voto só em evento nominal; presença ≤ total; stamp da Câmara/Senado com menos de 48 h e do TSE com menos de 60 dias. Roda ao fim de `all` e no `replica-test`.

## Contrato de job (todos)

advisory lock por dataset → linha em `ingest_runs` → pula se o checksum da entrada não mudou (`--force` ignora) → COPY em tabela temporária + `INSERT … ON CONFLICT (chave natural)` → `dataset_stamps` → `derive.stats` → `/api/revalidate`. Fonte fora do ar: run `failed`, dado anterior fica no ar com o stamp antigo. Nada é apagado.

```bash
db/pg-local.sh start && DATABASE_URL=$(db/pg-local.sh url) db/migrate.sh --local
cd etl && uv venv .venv && uv pip install -p .venv/bin/python -e .
export ETL_DATABASE_URL=postgres://postgres@localhost:54329/civico
civico-etl seed && civico-etl ibge.places
civico-etl tse.candidatos --year 2022 --year 2024 --year 2026      # --all para todas as candidaturas; --votes para votos por candidato (550 MB/eleição)
civico-etl camara.diario --year 2025 --year 2026                    # --limit 40 em desenvolvimento
civico-etl senado.diario --year 2025 --year 2026
```

## Auth, e-mail, pagamentos

- Pagamentos: não há (produto não comercial). Nenhuma peça de Stripe.
- Auth (R2): Supabase Auth, OTP por e-mail, CAPTCHA nativo (Turnstile), sessão em cookie http-only. Políticas de `profiles`/`follows` já estão na migração 0001 e foram testadas com dois usuários no replica-architect. Apagar conta apaga tudo (cascata de `auth.users`).
- E-mail (R2): Resend como SMTP do Supabase Auth e para o digest; `List-Unsubscribe` one-click (POST) já desenhado na arquitetura.

## Checklist de segurança

- [x] segredos só em env: `.env*` no `.gitignore`; `.env.example` sem valores; nada chega ao bundle (`server-only` em `pg.ts`; `DATABASE_URL` só no servidor)
- [x] input validado no servidor em toda rota (`/api/places`, `/api/people/*`, `/api/compare/agreement`, `/api/revalidate`: tamanho, regex, enum; inválido = 400)
- [x] autorização em toda leitura: o app conecta como `web_reader` (só `select` nas tabelas públicas via RLS). Testado: `anon` nega tudo; `web_reader` lê `people` (71 mil) e NÃO lê `person_external_ids` nem escreve em `sources`
- [ ] rate limit em auth e envio de e-mail: R2 (Turnstile + WAF)
- [x] webhook/callback verifica segredo: `/api/revalidate` compara Bearer em tempo constante
- [x] uploads: não há upload de usuário; fotos só por URL oficial (Câmara/Senado), espelhamento no R2
- [x] nenhum dado de usuário em URL ou log (o termo de busca não vai para analytics; logs do ETL têm só ids públicos)
- [x] `npm audit --omit=dev`: 2 avisos, ambos no `next` 15.5.28 (moderado no próprio Next; alto no `postcss` interno, só em build e só sobre CSS do próprio repo). Correção exige Next 16.x (major): fica para o R2, antes do deploy
- [ ] política de privacidade listando processadores (Vercel, Supabase, Resend, Fly): R2, no `/sobre`

## Dívida e riscos registrados

- `candidacies.votes` vazio: o TSE publica votos por candidato num arquivo de 550 MB por eleição (`--votes`); não rodou nesta carga. Crachá mostra "—" em "votos recebidos".
- Prestação de contas de campanha (`raised/spent`) não carregada (arquivo separado do TSE): "—".
- Siglas reutilizadas por partidos diferentes (PL 1985 ≠ PL 2006) estão numa linha só.
- Posse de suplente aproximada pela data do último status na Câmara; `mandate_periods` (licenças) ainda não é preenchida.
- `person_current_party.from_on` = início da legislatura, não a data real da filiação.
- Senado 2025: só 16 votações abertas pela API por senador (ver regra acima).
- `people` sem foto espelhada: só a URL oficial; o espelhamento com limite de 200 KB entra no R2.
- Desempenho em dev: lista de uma capital com 200 pessoas leva ~1 s de query (view `person_current_party` por linha). Índice ou materialização no R1.
