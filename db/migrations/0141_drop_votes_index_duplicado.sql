-- Índice duplicado em votes: 0001 criou (person_id, voting_event_id) sem nome e 0003 criou o mesmo com o nome votes_person_recent.
-- Em produção (2026-11-10): votes_person_recent com 26.690 leituras, votes_person_id_voting_event_id_idx com 0; 70 MB cada, definição idêntica.
-- Fica o de nome explícito. Cada escrita em votes pagava os dois.
drop index if exists votes_person_id_voting_event_id_idx;
