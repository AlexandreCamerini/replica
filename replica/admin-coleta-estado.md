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
- `next build` nas condições do CI: código 0. Conjunto ponta a ponta público: não roda nesta sessão (AC-05).
- `civico-etl check` no `admin_coleta` (migração + seed + `base.sql`): código 1, 5 invariantes quebradas por falta de carga real: "câmara: exatamente 513 em exercício", "senado: exatamente 81 em exercício", "cota: amostra fixa", "UF: exatamente 1 governador titular", "UF: governador e vice em exercício = lista conferida". Saída em `linha-de-base/base-check.txt`. Critério 14 é medido contra isso (AC-07).

## Fase e tarefas

- Plano: `replica/admin-coleta-plano.md`, versão final no commit `ce1316a` (AC-06).
- Decisões: `replica/admin-coleta-decisoes.md`, AC-01 a AC-07. `replica/decisions.md` ainda sem entrada nova (último número existente: D323). Última migração existente: `0142`; nenhuma criada.
- Fase: R. Subagentes da fase: 4 de 16 (R1 a R3 foram retomadas depois da parada por limite de uso, sem novo lançamento).

| Tarefa | Modelo | Situação | Reprovações | Commit |
| --- | --- | --- | --- | --- |
| R1 retratos da agenda (R-3) | Haiku | aceita | 0 | `2d4591b` |
| R2 retrato do plano e códigos de saída (R-6, R-8) | Sonnet | aceita | 0 | `1ae2c68` |
| R3 orquestradores (R-4) | Sonnet | aceita | 0 | `91e67f4` |
| R4 banco isolado e caracterização de `camara.equipe` | Sonnet | em voo: `etl/tests/{banco_isolado,caracterizacao,test_caracterizacao}.py`, `etl/tests/retratos/camara_equipe.json` | 0 | |

- Suíte depois de R1 a R3: `789 passed, 33 skipped, 4 xfailed`.
- Critérios com teste passando: R-3, R-4, R-6, R-8. Os demais, não avaliados.

## Próximo passo

1. Conferir e commitar R4; depois R5 (Haiku) e R6 (Sonnet), em série.
2. R7 a R11 (catálogo, contrato, testes, documentação) e o verificador da Parte R.
3. Seguir o plano, seção 7.
