-- Direito de resposta (S25 com tipo=resposta): mesma tabela das sugestões, tipo próprio.
-- A pessoa vem em person_id e a data em created_at; a regra "resposta exige pessoa" vive no app
-- (um CHECK aqui quebraria o ON DELETE SET NULL de people).
alter table suggestions drop constraint suggestions_kind_check;
alter table suggestions add constraint suggestions_kind_check
  check (kind in ('ideia','informacao_faltando','algo_errado','fonte_de_dados','outro','direito_resposta'));
create index suggestions_resposta_idx on suggestions (person_id, created_at desc) where kind = 'direito_resposta';
