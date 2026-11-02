-- Escrita do app (server actions) com o menor privilégio possível.
-- web_writer: conecta pelo pooler; só escreve dado de usuário e sugestões. Toda operação de usuário roda numa
-- transação com `set local role authenticated` + `request.jwt.claim(s)` = id da sessão verificada, para que as
-- policies de dono (own_*) valham também aqui: defesa em profundidade além da checagem no código.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'web_writer') then
    create role web_writer nologin;
  end if;
end $$;
grant usage on schema public, extensions to web_writer;
grant authenticated to web_writer;

-- dono: só pelas policies own_* (via role authenticated)
grant select, insert, update, delete on profiles to authenticated;
grant select, insert, delete on follows to authenticated;
grant select on people to authenticated;
create policy public_read_auth on people for select to authenticated using (true);

-- sugestões: insert anônimo pelo servidor; leitura só de (ip_hash, created_at) para o limite por hora
grant insert on suggestions to web_writer;
grant select (ip_hash, created_at) on suggestions to web_writer;
create policy server_insert on suggestions for insert to web_writer with check (status = 'nova');
create policy server_rate on suggestions for select to web_writer using (created_at > now() - interval '1 day');

-- digest: o job do app grava entregas; descadastro desliga o digest pelo token
grant select, insert, update on digest_deliveries to web_writer;
create policy server_digest on digest_deliveries for all to web_writer using (true) with check (true);
grant select (id, digest), update (digest, updated_at) on profiles to web_writer;
create policy server_unsubscribe on profiles for update to web_writer using (true) with check (digest in ('daily','weekly','off'));
create policy server_profile_read on profiles for select to web_writer using (true);

-- feed de novidades
create index if not exists votes_person_recent on votes (person_id, voting_event_id);
