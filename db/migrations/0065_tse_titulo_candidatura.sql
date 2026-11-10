-- BUG-038 / D235-D237: o identity.resolve fundia pessoas do TSE por nome civil + nascimento sem lugar e anexava o título de
-- eleitor da outra pessoa. Duas coisas novas:
--   1. identity_split_log ganha as ações 'movido' (o fato muda de pessoa, não sai) e 'criado' (pessoa criada para receber os
--      fatos separados), usadas por civico-etl identity.fix038.
--   2. tse_titulo_candidatura: cada linha do consulta_cand (ano, UE, SQ) de um título de eleitor que está no diretório, com
--      cargo e resultado. Serve aos checks que precisam da fonte e não só do que foi carregado:
--        - pessoa com dois títulos que aparecem na mesma eleição ordinária em municípios diferentes (fusão, BUG-038);
--        - título com linha ELEITO na eleição ordinária de 2012 e pessoa sem candidatura eleita de 2012 (BUG-039).
--      O título de eleitor é dado da fonte (TSE), mas não é publicado pelo site: tabela interna, sem grant para web_reader.
alter table identity_split_log drop constraint if exists identity_split_log_action_check;
alter table identity_split_log add constraint identity_split_log_action_check
  check (action in ('removido', 'alterado', 'movido', 'criado'));

create table if not exists tse_titulo_candidatura (
  titulo         text not null,                -- NR_TITULO_ELEITORAL_CANDIDATO como o TSE publica (com zeros à esquerda)
  year           int not null,
  ue             text not null,                -- SG_UE (município ou UF)
  tse_sequencial text not null,
  kind           text not null check (kind in ('ordinaria', 'suplementar')),
  uf             text,
  cargo          text,                         -- cargo pelo CD_CARGO (slug de offices; código cru se não mapeado)
  result         text,                         -- DS_SIT_TOT_TURNO
  updated_at     timestamptz not null default now(),
  primary key (titulo, year, ue, tse_sequencial)
);
create index if not exists tse_titulo_candidatura_year_idx on tse_titulo_candidatura (year, titulo);
alter table tse_titulo_candidatura enable row level security;  -- interna do ETL: sem grant para web_reader
