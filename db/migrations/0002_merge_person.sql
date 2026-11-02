-- merge_person(from, to): funde duas linhas de people sem perder fato nenhum e deixa redirect do slug antigo.
-- Uso: casamento de identidade que criou duplicata (TSE x Câmara com nome civil/nascimento divergentes).
-- Regras:
--   * mandatos com a mesma chave natural (cargo, lugar, posse): fica o do destino; herda status da casa (status_source <> 'tse').
--   * demais tabelas que apontam para people: move; linha que colide com unicidade/exclusão no destino é descartada
--     (já existe lá, por construção do ETL idempotente).
--   * campos vazios do destino são completados com os da origem; o slug da origem vira redirect 308.
-- Só service_role/owner executa: nenhum grant para web_reader.

create or replace function merge_person(p_from uuid, p_to uuid) returns void
language plpgsql as $$
declare
  r record;
  fk record;
begin
  if p_from = p_to then return; end if;
  perform 1 from people where id = p_to for update;
  if not found then raise exception 'merge_person: destino % não existe', p_to; end if;
  perform 1 from people where id = p_from for update;
  if not found then raise exception 'merge_person: origem % não existe', p_from; end if;

  -- 1) mandatos com a mesma chave natural
  for r in
    select f.id as from_id, t.id as to_id
    from mandates f
    join mandates t on t.person_id = p_to and t.office_id = f.office_id and t.place_id = f.place_id and t.started_on = f.started_on
    where f.person_id = p_from
  loop
    update mandates t
       set status = f.status, status_source = f.status_source, role = f.role,
           body_id = coalesce(f.body_id, t.body_id), candidacy_id = coalesce(t.candidacy_id, f.candidacy_id), updated_at = now()
      from mandates f
     where t.id = r.to_id and f.id = r.from_id and f.status_source <> 'tse';
    begin
      update mandate_periods set mandate_id = r.to_id where mandate_id = r.from_id;
    exception when unique_violation or exclusion_violation then
      delete from mandate_periods where mandate_id = r.from_id;
    end;
    update mandate_contacts set mandate_id = r.to_id where mandate_id = r.from_id;
    delete from mandates where id = r.from_id;
  end loop;

  -- 2) todas as FKs para people (menos o redirect, tratado abaixo)
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'people'::regclass and c.conrelid <> 'person_slug_redirects'::regclass
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col) using p_to, p_from;
    exception when unique_violation or exclusion_violation then
      for r in execute format('select ctid as t from %s where %I = $1', fk.tbl, fk.col) using p_from loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col) using p_to, r.t;
        exception when unique_violation or exclusion_violation then
          execute format('delete from %s where ctid = $1', fk.tbl) using r.t;
        end;
      end loop;
    end;
  end loop;

  -- 3) redirect e campos complementares
  insert into person_slug_redirects (old_slug, person_id)
    select slug, p_to from people where id = p_from
    on conflict (old_slug) do update set person_id = excluded.person_id;
  update person_slug_redirects set person_id = p_to where person_id = p_from;
  update people t
     set civil_name = coalesce(t.civil_name, f.civil_name), birth_date = coalesce(t.birth_date, f.birth_date),
         gender = coalesce(t.gender, f.gender), birthplace_place_id = coalesce(t.birthplace_place_id, f.birthplace_place_id),
         education = coalesce(t.education, f.education), photo_source_url = coalesce(t.photo_source_url, f.photo_source_url),
         photo_license = coalesce(t.photo_license, f.photo_license), photo_path = coalesce(t.photo_path, f.photo_path), updated_at = now()
    from people f where t.id = p_to and f.id = p_from;
  delete from people where id = p_from;
end
$$;

revoke all on function merge_person(uuid, uuid) from public;
