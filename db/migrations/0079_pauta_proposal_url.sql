-- Link da ficha oficial da proposição em cada item de pauta. Na Câmara, official_url é a página do evento;
-- a página da proposta precisa do texto oficial sempre à vista, e a ficha leva ao inteiro teor.
-- Câmara: fichadetramitacao?idProposicao=<id>. Senado (plenário): página da matéria. Comissões do Senado: null
-- (o item da agenda não traz o código da matéria).
alter table pauta_items add column proposal_url text;
