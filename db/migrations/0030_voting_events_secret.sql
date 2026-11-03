-- W3-B / D123: votação secreta vem da fonte, não de "evento sem voto individual" (D55).
-- Senado: campo `votacaoSecreta` ('S'/'N') do /dadosabertos/votacao. Câmara: a API não publica o campo -> null ("fonte não informa").
-- Coluna nullable sem default: só metadado no catálogo (sem reescrever a tabela); lock_timeout evita fila atrás de leitura longa.
set local lock_timeout = '5s';
alter table voting_events add column is_secret boolean;
comment on column voting_events.is_secret is 'true = votação secreta segundo a fonte (Senado: votacaoSecreta = S); false = aberta; null = fonte não informa';
