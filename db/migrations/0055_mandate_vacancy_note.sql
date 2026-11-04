-- BUG-031 / D202: motivo da vaga no executivo, com fonte, quando quem exerce o cargo não é pessoa do diretório
-- (interino de outro Poder: presidente do TJ ou da Assembleia) ou a fonte oficial não confirma quem exerce.
-- Fica no último mandato que deixou o cargo; o app mostra "—" com este texto no lugar do motivo genérico.
alter table mandates add column if not exists vacancy_note text;
comment on column mandates.vacancy_note is 'motivo da vaga (com fonte) mostrado no lugar de quem exerce o cargo; preenchido pela lista curada EXECUTIVO_FORA_DO_TSE';
