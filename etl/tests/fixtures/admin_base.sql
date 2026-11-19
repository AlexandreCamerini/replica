-- FABRICADO. Complemento de fixtures/base.sql para rodar o recorte do SAPL (sapl.ales + um município) sem rede.
-- Nada daqui é dado do IBGE: as cinco Assembleias repetem a forma de jobs/ibge_places.py (kind 'assembleia', name 'Assembleia Legislativa de <UF>',
-- adapter 'none', sem open_data_url) sobre as UFs que o base.sql já cria; o município (IBGE 1190099, "Município Fabricado (teste)", UF RO) e a Câmara
-- dele são inventados. O código 1190099 não existe no IBGE (RO vai de 1100015 a 1101807) nem em web/public/geo/uf/*.json.
-- Idempotente (on conflict do nothing). Desfazer: admin_fixtures.limpar_base().
insert into legislative_bodies (kind, place_id, name, adapter, open_data_url)
select 'assembleia', p.id, 'Assembleia Legislativa de ' || p.name, 'none', null
from places p
where p.kind = 'uf' and p.uf in ('RO', 'AC', 'AM', 'PI', 'PB')
on conflict do nothing;

insert into places (ibge_code, kind, name, slug, uf, parent_id)
select '1190099', 'municipio', 'Município Fabricado (teste)', 'municipio-fabricado-teste-ro', 'RO', p.id
from places p where p.ibge_code = '11'
on conflict do nothing;

insert into legislative_bodies (kind, place_id, name, adapter, open_data_url)
select 'camara_municipal', p.id, 'Câmara Municipal de Município Fabricado (teste)', 'none', null
from places p where p.ibge_code = '1190099'
on conflict do nothing;
