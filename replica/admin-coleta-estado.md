# Admin de coleta · estado da execução

Arquivo de retomada. Quem retoma lê este arquivo, `replica/admin-coleta-plano.md` e `git status`, nessa ordem.

## Partida

- Branch: `claude/hopeful-lewin-176541` (não é `main`; worktree em `.claude/worktrees/hopeful-lewin-176541`).
- SHA de partida: `39ee3ec64c989dcc5d02489f8eeb24e4c6a4d643` (merge do PR 49, que trouxe o prompt).
- Modelo do orquestrador: Fable 5.2, não Opus. O papel de orquestrador foi mantido.
- Banco: `postgres://postgres@localhost:54329/admin_coleta`. Bancos extras: nenhum ainda.

## Ambiente (fatos observados em 2026-11-15)

- O servidor Postgres foi iniciado pelo dono, no terminal dele, a partir deste worktree (`.local/pg` daqui). O sandbox da sessão nega `shmget`: eu não consigo iniciar nem reiniciar o servidor. Nunca rodar `db/pg-local.sh start|stop`. Servidor caído é parada (item 5).
- O banco `admin_coleta` foi criado pelo dono. Não apagar nem recriar. Banco "do zero" (critério 1) é outro, criado por mim, com outro nome.
- Conexão a `localhost:54329` e bind local só passaram a funcionar depois de o dono aplicar `sandbox.network.allowLocalBinding` em `/Users/acamerini/replica/.claude/settings.local.json` (script `liberar-sandbox-local.sh`, na raiz do worktree, sem rastreio; nunca commitar).
- `git status --porcelain` mostra sempre `?? liberar-sandbox-local.sh` e, no stderr, `.env.example: Operation not permitted`. Ruído conhecido.
- Saída de rede: `github.com` bloqueado (push e `gh` são do dono). `pypi.org` e `registry.npmjs.org` foram liberados por comando para instalar dependências já travadas em lockfile.
- Prefixos obrigatórios em comando de shell:
  - `PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"` (psql para `db/migrate.sh`);
  - `UV_CACHE_DIR="$TMPDIR/uv-cache"` (o cache padrão do uv não é gravável);
  - `npm_config_cache="$TMPDIR/npm-cache"`;
  - `DATABASE_URL=<url> ETL_DATABASE_URL=<url>` em todo comando que toca banco, depois de conferir `select current_database()`.
- Ordem de preparo do `admin_coleta`: `db/migrate.sh --local` (38 migrações), depois `base.sql` rodou uma vez ANTES do `seed` (o primeiro `uv run` falhou por cache), depois `seed`, depois `base.sql` de novo. Primeiro suspeito se a linha de base divergir do CI.

## Linha de base (antes de tocar em qualquer arquivo)

Saídas completas na pasta de notas da sessão, subpasta `linha-de-base/` (fora do repositório).

- ETL, `uv run --frozen pytest -q -rs`: `767 passed, 33 skipped, 4 xfailed`. Pulos, por arquivo:
  - `test_agenda.py:57` agenda não carregada; `test_assembleias.py:51` ale.sp ainda não rodou;
  - `test_contas_origem.py:119` e `:143` sem candidatura; `test_cota.py:60` e `:107` banco sem carga;
  - `test_governadores.py:32`, `:37`, `:46` banco sem carga;
  - `test_identity_bug032.py:63`; `test_identity_bug033.py:61`, `:79`, `:92`; `test_identity_bug035.py:56`, `:73`, `:87`;
  - `test_identity_bug038.py:41` (4 casos); `test_identity_bug041.py:49` (4 casos);
  - `test_identity_repairs.py:196`, `:210`, `:225` banco sem carga;
  - `test_launchd_sapl_prod.py:148` Keychain real; `test_partido_desempate.py:15` banco sem carga;
  - `test_salaries.py:53`; `test_senado_secretas.py:34` sem cache; `test_tse_bug019.py:95`; `test_upsert_condicional.py:89` banco sem carga.
- `python3 -I replica/tools/fluxo_confere.py`: código 1, 7 problemas preexistentes:
  - workflow não citado: `.github/workflows/verificacao-eval.yml`;
  - lib/data não citado: `cadeiras.ts`, `cobertura.ts`, `lista.ts`;
  - use server não citado: `web/src/app/(sv)/ajustes/actions.ts`;
  - caminho inexistente: `web/src/app/mcp/page.tsx:22-37` e `web/src/app/p/[slug]/opengraph-image.tsx:10-14`.
- `web/`: `npx eslint src` código 0; `npx tsc --noEmit` código 0; `npm run test:unit` 82 passam, 0 falham, 0 pulam.
- `next build` nas condições do CI e conjunto ponta a ponta público: ainda não rodados (próximo passo).

## Fase e tarefas

- `next build` nas condições do CI: passa (linha de base). Playwright não roda nesta sessão (AC-05).
- Plano: `replica/admin-coleta-plano.md`, versão final no commit `ce1316a`. Reprovado nas duas verificações; achados corrigidos; sem terceira verificação (AC-06). Relatórios em `verificacao/plano-v1.md` e `plano-v2.md`, na pasta de notas.
- Decisões: `replica/admin-coleta-decisoes.md`, AC-01 a AC-06. Último `AC-NN`: AC-06. `replica/decisions.md` ainda sem entrada nova (último número existente: D323). Última migração existente: `0142`; nenhuma criada.
- Fase: R, recém-iniciada. Nenhum código de produto escrito. Nenhum critério avaliado.
- Subagentes lançados: 8 antes das fases (1 consulta de sandbox, 5 levantamentos, 2 verificadores do plano); fase R: 3 de 16.

Tarefas da fase R em voo quando a sessão parou por limite de uso (2026-11-15). Nenhuma foi conferida nem commitada:

| Tarefa | Modelo | Arquivos permitidos | Situação |
| --- | --- | --- | --- |
| R1 retratos da agenda | Haiku | `etl/tests/test_retrato_agenda.py`, `etl/tests/retratos/agenda.json` | em voo, não conferida |
| R2 retrato do plano e códigos de saída | Sonnet | `etl/tests/test_retrato_plano.py`, `etl/tests/retratos/plano.json`, `etl/tests/test_codigos_saida.py` | em voo, não conferida |
| R3 orquestradores | Sonnet | `etl/tests/test_orquestradores.py` | em voo, não conferida |

Na retomada: esses arquivos podem existir no worktree, completos ou pela metade. Não aproveitar sem conferir: `git status --porcelain` contra a lista acima, ler o teste, rodar o comando de pronto do plano. Se a devolução do subagente não estiver disponível, refazer a tarefa.

## Próximo passo

1. Conferir e commitar R1, R2 e R3 (ou refazer).
2. R4 (banco isolado e caracterização de `camara.equipe`), depois R5 e R6; só então R7 em diante (catálogo).
3. Seguir o plano, seção 7.
