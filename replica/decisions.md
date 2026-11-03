# Decisões da rodada noturna (2026-11-02 → 03)

Rodada autônoma autorizada pelo dono do projeto: diff full stack contra politicometro.org e correção por ondas (W1–W4 de `parity.md`), com escolha de modelo por tarefa e decisões registradas aqui. Formato: contexto → decisão → por quê → como reverter.

## Orquestração

- **D01 · orquestrador = sessão principal (Opus).** Builders são subagentes que rodam um de cada vez no mesmo worktree (`claude/replica-skill-diff-3e9942`); só agentes de leitura rodam em paralelo. Por quê: vários escritores no mesmo `pg.ts`/`types.ts`/`page.tsx` do crachá geram conflito; worktrees paralelos trocariam isso por merges noturnos sem revisão humana. Reverter: cada lote é um commit próprio.
- **D02 · modelos.** Sonnet para telas de texto e leitura/diff de dados; Opus para crachá, ETL e qualquer coisa que mexa em schema; Haiku não usado (nada aqui é volume repetitivo). Verificação final por agente independente que não escreveu o código.
- **D03 · ambiente.** Postgres local do checkout principal (`/Users/acamerini/replica/.local/pg`, dados reais) em `:54329`; clone em `localhost:3101` (`web-pg` do `launch.json`). `node_modules` instalado no worktree com cache npm em `$TMPDIR` (o `~/.npm` tem dono errado; não corrigido, exige sudo).
- **D04 · o que não será feito sem o dono.** Criar contas ou chaves (Portal da Transparência para emendas, Resend, Supabase de produção, Turnstile de produção), push, deploy, merge em `main`. Esses itens ficam `partial`/`no` com o bloqueio escrito.

## Diff full stack (dados)

- **D05 · ETL corrige antes da tela.** A auditoria (`data-diff.md`) achou 6 S1 de dado (presença derivada errada, "carreira" cobrindo só 2023–26, zero no lugar de "não carregado", partido desatualizado em 420 pessoas, contadores estaduais/municipais inflados, Executivo com lista de faltantes do Legislativo). Corrigir dado errado vem antes de feature nova: um agente Opus de ETL roda em paralelo ao W1a (arquivos disjuntos: `etl/`, `db/` × `web/`); as correções de tela (D02 rótulo de período, D03, D04) entram num lote de front logo depois do W1a.
- **D06 · o original não é a verdade.** Onde o clone segue a fonte oficial e o original diverge, fica o clone, com a regra publicada. Exemplo: Senado não publica presença por senador → "—", não um número derivado.
