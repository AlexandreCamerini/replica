-- Sonda da migração 0130 (gatilho, constraints, RLS). Roda numa transação com rollback; ver D293.
-- Uso: psql "$DATABASE_URL" -X -q -t -f db/tests/0130_probe.sql | grep -c FALHA   (esperado: 0; 19 linhas PASSA)
\set ON_ERROR_STOP on
begin;
create temp table res(caso text, ok boolean, detalhe text) on commit drop;
insert into places(kind,name,slug) values ('pais','T','t-probe');
insert into legislative_bodies(kind,place_id,name) select 'camara_deputados', id, 'T' from places where slug='t-probe';
create or replace function pg_temp.mk(st text default 'rascunho', vb text default null, ver jsonb default null, vv int default null,
   rev text default null, rat timestamptz default null, wn text default null) returns uuid language plpgsql as $f$
declare i uuid := gen_random_uuid(); begin
  insert into answer_drafts(id, body_id, prop_type, prop_number, prop_year, source_url, source_sha256, source_pages, model, prompt_version, answers)
  values (i, (select id from legislative_bodies limit 1), 'PL', (random()*1e6)::int, 2026, 'u', 's', 1, 'm', 1, '{"a":1}');
  return i; end $f$;
create or replace function pg_temp.expect_fail(caso text, sql text) returns void language plpgsql as $f$
begin
  begin execute sql; insert into res values (caso, false, 'deveria falhar e passou');
  exception when others then insert into res values (caso, true, sqlerrm); end; end $f$;
create or replace function pg_temp.expect_ok(caso text, sql text) returns void language plpgsql as $f$
begin
  begin execute sql; insert into res values (caso, true, 'ok');
  exception when others then insert into res values (caso, false, sqlerrm); end; end $f$;

-- INSERT só como rascunho
select pg_temp.expect_fail('insert direto como publicado', $$insert into answer_drafts(body_id,prop_type,prop_number,prop_year,source_url,source_sha256,source_pages,model,prompt_version,answers,status,reviewer,reviewed_at,verified_by) select id,'PL',1,2026,'u','s',1,'m',1,'{}','publicado','x',now(),'pessoa' from legislative_bodies limit 1$$);
-- ciclo agentes feliz
create temp table t(id uuid); insert into t select pg_temp.mk();
select pg_temp.expect_fail('publicar por agentes sem relatório', format($$update answer_drafts set status='publicado', reviewer='agentes', reviewed_at=now(), verified_by='agentes' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('publicar sem verified_by', format($$update answer_drafts set status='publicado', reviewer='x', reviewed_at=now() where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('verified_by inválido', format($$update answer_drafts set verified_by='robo' where id='%s'$$, (select id from t)));
select pg_temp.expect_ok('publicar por agentes com relatório', format($$update answer_drafts set status='publicado', reviewer='agentes', reviewed_at=now(), verified_by='agentes', verification='{"r":1}', verifier_version=1 where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('alterar answers depois de publicado', format($$update answer_drafts set answers='{"x":2}' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('alterar verification depois de publicado', format($$update answer_drafts set verification='{"r":2}' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('alterar verified_by depois de publicado', format($$update answer_drafts set verified_by='pessoa' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('retirar sem motivo', format($$update answer_drafts set status='retirado' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('gravar withdrawn_note sem retirar', format($$update answer_drafts set withdrawn_note='x' where id='%s'$$, (select id from t)));
select pg_temp.expect_ok('retirar com motivo', format($$update answer_drafts set status='retirado', withdrawn_note='erro factual' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('retirado é final', format($$update answer_drafts set status='publicado' where id='%s'$$, (select id from t)));
select pg_temp.expect_fail('mudar motivo da retirada', format($$update answer_drafts set withdrawn_note='outro' where id='%s'$$, (select id from t)));
-- barrado
insert into t select pg_temp.mk();
select pg_temp.expect_ok('barrar rascunho', format($$update answer_drafts set status='barrado', verified_by='agentes', verification='{"b":1}', verifier_version=1 where id='%s'$$, (select id from t offset 1)));
select pg_temp.expect_fail('barrado é final', format($$update answer_drafts set status='publicado', reviewer='x', reviewed_at=now() where id='%s'$$, (select id from t offset 1)));
-- rascunho -> retirado proibido
insert into t select pg_temp.mk();
select pg_temp.expect_fail('rascunho direto a retirado', format($$update answer_drafts set status='retirado', withdrawn_note='x', verified_by='pessoa' where id='%s'$$, (select id from t offset 2)));
-- pessoa continua publicando
insert into t select pg_temp.mk();
select pg_temp.expect_ok('publicar por pessoa', format($$update answer_drafts set status='publicado', reviewer='ana', reviewed_at=now(), verified_by='pessoa' where id='%s'$$, (select id from t offset 3)));
-- updated_at: trigger religado?
select pg_temp.expect_ok('trigger set_updated_at habilitado', $$select 1 from pg_trigger where tgname='set_updated_at' and tgrelid='answer_drafts'::regclass and tgenabled='O' having count(*)=1$$);
-- RLS
select pg_temp.expect_ok('pipeline_switches com RLS', $$select 1 from pg_class where relname='pipeline_switches' and relrowsecurity having count(*)=1$$);
select caso, case when ok then 'PASSA' else 'FALHA' end as r, detalhe from res order by 2 desc, 1;
rollback;
