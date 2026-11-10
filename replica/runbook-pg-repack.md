# Runbook: devolver o disco inchado em produção (pg_repack)

Estado: **não executado**. Nada aqui roda sem a decisão do dono. Medições feitas no banco de desenvolvimento em 2026-11-10; produção precisa ser remedida (passo 0).

## Por que
Antes das correções `1820597`, `25d93fa` e `46194ce` (PR #18) o ETL reescrevia linhas iguais. As correções param o inchaço novo, mas não devolvem o já alocado:

| Objeto | Tamanho no dev | Esperado | Folga estimada |
|---|---|---|---|
| `person_period_stats` (heap) | 916 MB | ~110 MB | ~800 MB |
| `party_memberships` (índices) | 229 MB | ~40 MB | ~190 MB |
| `expenses` (heap) | 951 MB | ~500 MB | ~450 MB |

Total recuperável estimado: cerca de 1,4 GB de 5,6 GB. O disco de produção foi aumentado a 16 GB em 08/11/2026 (restore D252); o ganho é folga de disco e cache, não desempenho de consulta.

## Pré-requisitos (todos devem ser verdadeiros)
1. Passo 0 abaixo mostra inchaço real em produção. Se for menor que 30% do heap, **pare**: não vale a janela.
2. Espaço livre no disco ≥ 2× o tamanho da maior tabela repackeada (tabela + índices). Para `expenses` (~1,5 GB com índices): ≥ 3 GB livres.
3. Backup/PITR do Supabase confirmado no painel.
4. Nenhum job do ETL rodando (ver `ingest_runs` com status `running`) e o cron do ETL pausado durante a janela.
5. `pg_repack` versão ≥ 1.5.2 disponível (https://supabase.com/docs/guides/database/extensions/pg_repack). Alternativa sem extensão: `VACUUM FULL`, que trava a tabela inteira (ver fim).

## Passo 0: medir (somente leitura, qualquer hora)
```sql
create extension if not exists pgstattuple with schema extensions;
select 'person_period_stats' t, table_len/1048576 mb, round(dead_tuple_percent+free_percent) pct_inchaco from extensions.pgstattuple('person_period_stats')
union all select 'expenses', table_len/1048576, round(dead_tuple_percent+free_percent) from extensions.pgstattuple('expenses');
select i.indexrelid::regclass, pg_size_pretty(pg_relation_size(i.indexrelid)), s.avg_leaf_density, s.leaf_fragmentation
from pg_index i, lateral extensions.pgstatindex(i.indexrelid::regclass) s where i.indrelid = 'party_memberships'::regclass;
select pg_size_pretty(pg_database_size(current_database()));
```
Remover a extensão auxiliar depois (`drop extension pgstattuple`). Rodar como `postgres`; `web_reader` não tem permissão.

## Janela
- Duração estimada: 2 a 10 minutos por tabela; o `pg_repack` só toma bloqueio exclusivo no início e no fim (troca de arquivo). Leituras do site continuam, escritas do ETL ficam pausadas.
- Quando: fora do horário do cron do ETL (ver `.github/workflows`), idealmente madrugada de dia útil.
- O site continua lendo (RLS e `web_reader` não são afetados). Rodar depois do próximo `derive.stats` bem-sucedido, para não repackear dados que a próxima carga já mudaria.

## Execução (ordem: menor risco primeiro)
Conexão: URL **direta** (porta 5432), não o pooler em modo transação. Usuário `postgres`. Não colar a URL no chat nem em log.
```bash
pg_repack -k --no-order -h <host> -p 5432 -U postgres -d postgres --table=public.person_period_stats
pg_repack -k --no-order -h <host> -p 5432 -U postgres -d postgres --table=public.party_memberships
pg_repack -k --no-order -h <host> -p 5432 -U postgres -d postgres --table=public.expenses
```
`-k` é obrigatório no Supabase (sem superusuário). Uma tabela por vez; ao fim de cada uma, conferir o tamanho (passo de verificação) antes da próxima. Se qualquer passo falhar, `pg_repack` desfaz sozinho; mesmo assim apagar sobra: `select repack.repack_drop('public.<tabela>')` se o log pedir.

Só índices (menos pesado): `pg_repack -k --only-indexes --table=public.party_memberships`.

## Verificação (aceite)
1. Tamanho de cada tabela caiu para perto do esperado da tabela acima (±30%).
2. Contagem de linhas igual à de antes (`select count(*)` guardado antes).
3. `civico-etl check` sem invariantes novos falhando.
4. Páginas `/`, uma página de político e `/comparar` respondem 200 e mostram dados.
5. Cron do ETL reativado e uma execução de `derive.stats` completa sem erro.

## Reversão
O `pg_repack` não altera dados; falha no meio desfaz sozinha. Se o resultado estiver errado (contagem diferente), restaurar do PITR do Supabase para o instante anterior à janela.

## Alternativa: VACUUM FULL (se o `pg_repack` não estiver disponível)
`vacuum (full, analyze) public.person_period_stats;` toma `ACCESS EXCLUSIVE`: o site para de ler a tabela durante a execução (uns 30 s a 2 min para `person_period_stats`, mais para `expenses`). Só com o site em modo manutenção ou com a tabela fora do caminho crítico. Usar apenas para `person_period_stats`, a menor.

## O que este runbook não cobre
- Cortar índices sem uso (`proposals_summary_trgm`, 81 MB, 0 leituras **no dev**): decidir só com `pg_stat_user_indexes` de produção.
- Mudar a estratégia de carga de `expenses` (apaga e recarrega por janela, 4,3 mi de deletes). É a causa do inchaço dela e merece desenho próprio.
