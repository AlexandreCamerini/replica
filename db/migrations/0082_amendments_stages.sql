-- catálogo D02: emendas parlamentares do Portal da Transparência (API de dados, /emendas). Aditiva: a tabela nasceu na 0001, vazia.
-- Faltava o estágio "liquidado", o rótulo do tipo como a fonte escreve, a localidade crua e o motivo do (não) vínculo.
-- Estágios em centavos (empenhado >= liquidado >= pago em condições normais; invariante "pago <= empenhado" em jobs/checks.py).
-- Valor que a fonte não publica fica NULL, nunca 0 (BUG-002): por isso committed/paid deixam de ser NOT NULL.
-- A API só devolve texto para a localidade ("CIDADE - UF"): não existe código IBGE na resposta (OpenAPI v3, ConsultaEmendasDTO).
-- O vínculo com município é por nome + UF, só município inequívoco; o resto fica sem place com `place_note`.
alter table amendments alter column committed_cents drop not null;
alter table amendments alter column committed_cents drop default;
alter table amendments alter column paid_cents drop not null;
alter table amendments alter column paid_cents drop default;

alter table amendments
  add column liquidated_cents bigint,
  add column resto_inscrito_cents bigint,
  add column resto_cancelado_cents bigint,
  add column resto_pago_cents bigint,
  add column api_code text,                 -- codigoEmenda
  add column number text,                   -- numeroEmenda
  add column kind_label text,               -- tipoEmenda como a fonte escreve
  add column subfunction text,              -- `area` guarda a função
  add column locality_label text,           -- localidadeDoGasto como a fonte escreve
  add column beneficiary_uf char(2),
  add column place_note text,               -- por que não há município (nacional, estadual, multimunicipal, nome ambíguo...)
  add column match_method text check (match_method in ('nome_parlamentar_mandato')),
  add column match_confidence numeric(4,3) check (match_confidence between 0 and 1),
  add column match_note text;               -- motivo do vínculo ou do não-vínculo, sempre preenchido pelo job

alter table amendments drop constraint amendments_kind_check;
alter table amendments add constraint amendments_kind_check
  check (kind in ('individual','individual_pix','bancada','comissao','relator','outro'));

create index on amendments (api_code);

-- Fontes novas (catálogo D02 e D03). A produção não roda o seed: sem a linha, db.run() encerra com "source não existe".
insert into sources (slug, name, url, license) values
  ('transparencia', 'Portal da Transparência · API de dados (emendas parlamentares)', 'https://portaldatransparencia.gov.br/api-de-dados', 'Decreto 8.777/2016'),
  ('cgu', 'CGU · CEIS e CNEP (Portal da Transparência)', 'https://portaldatransparencia.gov.br/sancoes', 'Decreto 8.777/2016')
on conflict (slug) do nothing;
