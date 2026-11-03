-- W4 · /governos (S12) e /impostos (S16): tabelas próprias da onda, públicas para leitura.
-- Por que `w4_*` e não `yearly_indicators`/`tax_revenues` (vazias desde a 0001): aquelas ficaram presas a `place_id`/`uf char(2)` e a um
-- `tax` sem unidade nem definição; aqui o indicador carrega a definição por extenso (a página publica a regra) e a unidade explícita.
-- Reuso futuro: se alguém quiser unificar, copiar daqui para lá é um insert-select.

-- fontes novas (idempotente)
insert into sources (slug, name, url, license) values
  ('ibge-sidra', 'IBGE · SIDRA (Contas Nacionais, IPCA, PNAD Contínua)', 'https://sidra.ibge.gov.br/', 'CC BY 4.0'),
  ('bcb-sgs', 'Banco Central do Brasil · Sistema Gerenciador de Séries Temporais (SGS)', 'https://www3.bcb.gov.br/sgspub/', 'Dados abertos (BCB)'),
  ('receita-federal', 'Receita Federal · Arrecadação das Receitas Federais (dados abertos)', 'https://www.gov.br/receitafederal/dados/arrecadacao-estado.csv', 'CC BY 4.0')
on conflict (slug) do nothing;

-- um valor por indicador e ano, no Brasil (escopo nacional; não há dado por UF nesta onda)
create table w4_yearly_indicators (
  indicator text not null check (indicator in ('pib_variacao', 'ipca_acumulado', 'selic_meta_fim_ano', 'desemprego_media')),
  year smallint not null check (year between 1900 and 2100),
  value numeric not null,
  unit text not null,
  source_id uuid not null references sources(id) on delete restrict,
  series_ref text not null,                 -- tabela SIDRA / código SGS usado, para auditoria
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (indicator, year)
);
create index on w4_yearly_indicators (source_id);

-- arrecadação federal: um valor por ano, mês, UF e tributo (valor nominal em centavos de real; sem correção)
create table w4_tax_revenue (
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  uf char(2) not null,
  tax text not null,                        -- nome da coluna da Receita, sem alterar
  amount_cents bigint not null,
  updated_at timestamptz not null default now(),
  primary key (year, month, uf, tax)
);

alter table w4_yearly_indicators enable row level security;
alter table w4_tax_revenue enable row level security;
grant select on w4_yearly_indicators, w4_tax_revenue to web_reader;
create policy public_read on w4_yearly_indicators for select to web_reader using (true);
create policy public_read on w4_tax_revenue for select to web_reader using (true);
