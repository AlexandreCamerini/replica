-- Medição somente leitura para decidir o pg_repack (replica/runbook-pg-repack.md, passo 0).
-- Só consulta catálogos e estatísticas; não cria extensão nem escreve nada. Rodar no SQL Editor do Supabase.

-- 1) Tamanho do banco e das maiores tabelas, com bytes por linha viva (inchaço aparece como bytes/linha muito acima do esperado)
select pg_size_pretty(pg_database_size(current_database())) as banco;

select c.relname,
       pg_size_pretty(pg_relation_size(c.oid))       as heap,
       pg_size_pretty(pg_indexes_size(c.oid))        as indices,
       s.n_live_tup                                  as linhas_vivas,
       round(pg_relation_size(c.oid)::numeric / greatest(s.n_live_tup, 1)) as bytes_por_linha,
       s.n_dead_tup                                  as mortas,
       s.n_tup_upd                                   as updates,
       s.n_tup_hot_upd                               as updates_hot,
       s.n_tup_ins                                   as inserts,
       s.n_tup_del                                   as deletes
from pg_class c join pg_stat_user_tables s on s.relid = c.oid
where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
order by pg_total_relation_size(c.oid) desc limit 15;

-- 2) Índices grandes e quantas vezes foram lidos (idx_scan = 0 só vale como evidência com semanas de estatística)
select s.relname, s.indexrelname, pg_size_pretty(pg_relation_size(s.indexrelid)) as tam, s.idx_scan
from pg_stat_user_indexes s join pg_index i using (indexrelid)
where not i.indisunique and not i.indisprimary and pg_relation_size(s.indexrelid) > 5 * 1024 * 1024
order by pg_relation_size(s.indexrelid) desc limit 15;

-- 3) Desde quando as estatísticas valem (se foi zerado no restore de 08/11/2026, idx_scan e updates só cobrem desde então)
select stats_reset from pg_stat_database where datname = current_database();

-- 4) Consultas mais lentas (só funciona se pg_stat_statements estiver ligada; senão devolve erro e pode ser ignorada)
select calls, round(mean_exec_time::numeric, 1) as ms_medio, round(total_exec_time::numeric / 1000) as seg_total, left(query, 110) as consulta
from pg_stat_statements order by total_exec_time desc limit 10;

-- 5) Espaço livre: confira no painel do Supabase (Database > Disk). O pg_repack exige 2x o tamanho da maior tabela com índices.
