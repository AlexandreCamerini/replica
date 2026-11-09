-- Regra 3 (canvas "No seu bolso", artboard D): a IA rascunha, uma pessoa aprova, o público vê o estado.
-- Um rascunho é uma linha; publicar não copia nada, só muda o status. Correção = novo rascunho publicado que
-- substitui o anterior (replaces_id + correction_note), e o anterior vira 'substituido': nada some sem rastro.

create table answer_drafts (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references legislative_bodies(id) on delete restrict,
  prop_type text not null,
  prop_number int not null,
  prop_year smallint not null,
  source_url text not null,                 -- PDF do inteiro teor lido pelo modelo
  source_sha256 text not null,              -- o mesmo PDF não é rascunhado duas vezes na mesma versão do prompt
  source_pages int not null,
  model text not null,
  prompt_version int not null,
  answers jsonb not null,                   -- {campo: {diz, frase, trecho, pagina}}; dinheiro tem também "direcao"
  checks jsonb not null default '{}',       -- {campo: ["trecho_nao_encontrado", ...]}: validação automática
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'reprovado', 'substituido')),
  reviewer text,
  reviewed_at timestamptz,
  review_note text,                         -- motivo da reprovação
  replaces_id uuid references answer_drafts(id) on delete restrict,
  correction_note text,                     -- motivo da correção, público em /correcoes
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'publicado' or (reviewer is not null and reviewed_at is not null)),
  check (replaces_id is null or correction_note is not null)
);
create index on answer_drafts (body_id, prop_type, prop_number, prop_year, created_at desc);
-- no máximo uma versão publicada por proposta
create unique index answer_drafts_one_published on answer_drafts (body_id, prop_type, prop_number, prop_year) where status = 'publicado';
create trigger set_updated_at before update on answer_drafts for each row execute function set_updated_at();

-- O público lê só o que uma pessoa aprovou (e o histórico de correções). Rascunho e reprovado nunca saem do banco.
alter table answer_drafts enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'web_reader') then
    grant select on answer_drafts to web_reader;
    create policy public_read on answer_drafts for select to web_reader using (status in ('publicado', 'substituido'));
  end if;
end $$;
