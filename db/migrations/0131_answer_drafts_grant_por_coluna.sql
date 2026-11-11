-- D293: o site só precisa do que a página pública mostra. O relatório de verificação (rascunho do modelo, vereditos, prova de
-- leitura), as notas internas, o custo e o hash da fonte ficam só para quem escreve. Antes, web_reader lia as 26 colunas.
-- Colunas que o site lê hoje (pg.ts): id, body_id, prop_*, reviewed_at, answers, source_url, correction_note, replaces_id, status;
-- mais verified_by e withdrawn_note, que a 0130 criou para a página dizer quem conferiu e por que saiu do ar.
-- A linha continua filtrada pela policy public_read (publicado, substituido, retirado).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'web_reader') then
    revoke select on answer_drafts from web_reader;
    grant select (id, body_id, prop_type, prop_number, prop_year, status, answers, source_url, reviewed_at,
                  correction_note, replaces_id, verified_by, withdrawn_note, created_at, updated_at) on answer_drafts to web_reader;
  end if;
end $$;
