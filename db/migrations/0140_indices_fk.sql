-- Índices de apoio a chaves estrangeiras sem índice (auditoria de 2026-11-10 no banco de desenvolvimento).
-- Só entram os que custam: candidacies (183 mil linhas) e party_observations.party_id. Ganho medido em candidacies: 1,3 ms -> 0,04 ms por consulta (contest+election), +3,4 MB.
-- Fora de propósito: laws, agenda_events, sapl_houses, pauta_reads e answer_drafts.replaces_id têm poucas linhas ou são vazias; o índice só custaria escrita.
create index if not exists candidacies_contest_election_idx on candidacies (contest_id, election_id);
create index if not exists party_observations_party_id_idx on party_observations (party_id);
