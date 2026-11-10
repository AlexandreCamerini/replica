-- D14/D18: população residente estimada (IBGE, agregado 6579) por lugar. Base do teto de subsídio de vereador
-- (CF art. 29 VI, faixas de população) e do "moradores" da página da cidade. null = IBGE não publicou.
alter table places add column population integer check (population >= 0);
alter table places add column population_year smallint;
