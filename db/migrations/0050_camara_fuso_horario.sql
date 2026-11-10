-- BUG-017 / D160: a Câmara publica hora de Brasília sem fuso; o ETL (conexão em UTC) gravava o relógio local como UTC.
-- Corrige o que já foi gravado: reinterpreta o relógio gravado como America/Sao_Paulo (acerta o horário de verão de 2019).
-- Roda uma vez (db/migrate.sh) e só nas linhas da Câmara dos Deputados; Senado e agenda_events já estavam certos
-- (Senado só tem data; agenda_events grava com fuso). Sem o job corrigido, rodar isto de novo desloca de novo: não reaplicar à mão.
update sessions t set starts_at = (t.starts_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'camara_deputados';
update voting_events t set occurred_at = (t.occurred_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'camara_deputados';
update speeches t set occurred_at = (t.occurred_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'camara_deputados';
-- Senado: a fonte só dá a data e o ETL gravava meia-noite UTC (= 21:00 do dia anterior em Brasília; o front mostrava o dia anterior).
-- Passa a meia-noite de Brasília. Só linhas ainda em 00:00 UTC (as da Câmara acima não entram: filtro por casa).
update sessions t set starts_at = (t.starts_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'senado' and (t.starts_at at time zone 'UTC')::time = '00:00';
update voting_events t set occurred_at = (t.occurred_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'senado' and (t.occurred_at at time zone 'UTC')::time = '00:00';
update speeches t set occurred_at = (t.occurred_at at time zone 'UTC') at time zone 'America/Sao_Paulo'
  from legislative_bodies b where b.id = t.body_id and b.kind = 'senado' and (t.occurred_at at time zone 'UTC')::time = '00:00';
