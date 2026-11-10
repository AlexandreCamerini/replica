-- BUG-041 / BUG-043 (D240-D243): tse_titulo_candidatura passa a guardar, por linha da fonte, o nome civil, o nascimento e o
-- número na urna. Com isso viram check SQL duas classes que antes só a fonte mostrava:
--   1. o TSE repete o título de uma pessoa na linha de outra (Virginia Pereira de Oliveira 2012 com o título de Willya José da
--      Silva): candidatura cuja linha tem nascimento diferente e nome civil sem token em comum com a pessoa (D237 deixa de ser
--      limitação);
--   2. registro substituído: na mesma disputa (ano, tipo, UE, cargo, número, título) a fonte tem um registro de posto maior
--      que o que está no banco (BUG-043).
-- Tabela interna do ETL (sem grant para web_reader), como na 0065.
alter table tse_titulo_candidatura
  add column if not exists civil_name    text,   -- NM_CANDIDATO
  add column if not exists birth_date    date,   -- DT_NASCIMENTO
  add column if not exists ballot_number int;    -- NR_CANDIDATO

-- tokens significativos do nome (sem acento, minúsculo, sem partículas nem sufixos de parentesco). Espelha
-- civico_etl.identity.name_tokens.
create or replace function identity_name_tokens(text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct t order by t), '{}')
  from regexp_split_to_table(lower(coalesce(f_unaccent($1), '')), '[^a-z0-9]+') t
  where length(t) >= 2
    and t <> all (array['de', 'da', 'do', 'das', 'dos', 'e', 'd', 'filho', 'filha', 'neto', 'neta', 'junior', 'jr',
                        'sobrinho', 'segundo', 'terceiro'])
$$;

-- posto do registro (civico_etl.jobs.tse_candidatos.registration_rank) pelo DS_SIT_TOT_TURNO cru da fonte
create or replace function tse_registration_rank(text) returns int
language sql immutable parallel safe as $$
  select case when upper(trim($1)) in ('ELEITO', 'ELEITO POR QP', 'ELEITO POR MÉDIA') then 2
              when upper(trim($1)) in ('SUPLENTE', 'NÃO ELEITO', '2º TURNO') then 1
              else 0 end
$$;
