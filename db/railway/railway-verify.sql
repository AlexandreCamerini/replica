-- Conferência da cópia Supabase -> Railway. Rode nos DOIS lados e compare:
--   psql "$ORIGEM"  -X -At -f db/railway/railway-verify.sql > origem.txt
--   psql "$DESTINO" -X -At -f db/railway/railway-verify.sql > destino.txt
--   diff origem.txt destino.txt          # vazio = cópia idêntica nos itens abaixo
-- Seção "ambiente" (só faz sentido no destino, nunca entra no diff):
--   psql "$DESTINO" -X -At -v ambiente=on -f db/railway/railway-verify.sql
-- Use -At (sem cabeçalho nem alinhamento). Saída sem database, host nem data: comparável por diff. Contagens EXATAS (count(*)), não estimativas.
\set QUIET on
\if :{?ambiente}
\else
  \set ambiente off
\endif
-- search_path fixo: a definição de índice/policy sai igual nos dois lados mesmo que o database tenha search_path próprio
set search_path = pg_catalog;

\if :ambiente
  select '== ambiente ==';
  select 'config ' || coalesce(r.rolname, '(database)') || ' ' || s.setconfig::text
    from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole
   where s.setdatabase = (select oid from pg_database where datname = current_database()) order by 1;
  select 'datacl ' || coalesce(datacl::text, '(padrão: PUBLIC com CONNECT e TEMP)') from pg_database where datname = current_database();
  select 'public_pode_conectar ' || (datacl is null or exists (select 1 from aclexplode(datacl) a where a.grantee = 0 and a.privilege_type = 'CONNECT')) from pg_database where datname = current_database();
  select 'dono_do_database ' || datdba::regrole from pg_database where datname = current_database();
  select 'objetos_de_public_com_outro_dono ' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relowner <> 'civico_etl'::regrole;
\else
  select '== tabelas (contagem exata) ==';
  select format('%s.%s %s', n.nspname, c.relname,
                (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'login') and c.relkind in ('r', 'p') order by 1;
  select '== auth.users ==';
  select 'auth.users ' || count(*) from auth.users;
  select '== objetos ==';
  select 'indices ' || count(*) || ' ' || coalesce(md5(string_agg(schemaname || '.' || indexname || ':' || indexdef, E'\n' order by schemaname, indexname)), '-')
    from pg_indexes where schemaname in ('public', 'login');
  select 'policies ' || count(*) || ' ' || coalesce(md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\n' order by schemaname, tablename, policyname)), '-')
    from pg_policies where schemaname in ('public', 'login');
  select 'funcoes ' || count(*)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'login') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  select 'views ' || count(*) from pg_views where schemaname in ('public', 'login');
  select 'views_materializadas ' || count(*) from pg_matviews where schemaname in ('public', 'login');
  select 'triggers ' || count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'login') and not t.tgisinternal;
  select 'sequences ' || count(*) from pg_sequences where schemaname in ('public', 'login');
\endif
