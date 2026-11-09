-- catálogo D03: CEIS e CNEP (CGU) pela API do Portal da Transparência, ao lado do TCU (0033). Aditiva.
-- Só pessoa física entra (é a única que casa com `people`). CPF/CNPJ/NIS da fonte NÃO são gravados (D131).
-- Em CEIS/CNEP a UF do DTO é a do órgão sancionador (orgaoSancionador.siglaUf), não a do sancionado: `uf` guarda essa UF e
-- `body_sphere` diz o que ela vale. O casamento por UF só vale para órgão estadual ou municipal (jobs/sancoes.py).
alter table sanctions drop constraint sanctions_source_check;
alter table sanctions add constraint sanctions_source_check check (source in ('tcu_inabilitados','cgu_ceis','cgu_cnep'));
alter table sanctions
  add column sanction_kind text,            -- tipoSancao.descricaoResumida
  add column body text,                     -- orgaoSancionador.nome
  add column body_sphere text,              -- orgaoSancionador.esfera (Federal, Estadual, Municipal)
  add column fine_cents bigint;             -- CNEP: valorMulta
