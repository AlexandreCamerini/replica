-- D293: verificação agêntica no lugar da revisão humana (replica/verificacao-agentica.md, v2).
-- A Regra 3 passa a ser: a IA rascunha, agentes independentes conferem, o público vê o estado e quem conferiu.
-- Esta migração só abre o caminho no banco. Quem publica continua sendo a CLI: `civico-etl revisar` (pessoa) ou
-- `civico-etl verificar` (agentes), e este último só publica com DUAS chaves: VERIFICACAO_AGENTICA=on no ambiente
-- e a linha 'verificacao_agentica' = 'on' em pipeline_switches (que esta migração cria vazia).
--
--   rascunho   -> publicado | reprovado | barrado
--   publicado  -> substituido | retirado
--   reprovado, barrado, substituido, retirado: finais
--
-- barrado  = não passou na verificação por agentes (distinto de reprovado, que é decisão de pessoa ou troca de rascunho).
-- retirado = estava no ar e saiu, com motivo público. Antes não havia como despublicar sem publicar outra versão.
--
-- Pode rodar de novo sem quebrar. Requer que `civico-etl revisar` já seja a versão que grava verified_by = 'pessoa'.

alter table answer_drafts
  add column if not exists verification jsonb,       -- relatório: por campo, veredito de cada agente, modelo que atendeu
  add column if not exists verifier_version int,     -- versão do conjunto de prompts (verification.VERIFIER_VERSION)
  add column if not exists verified_by text,
  add column if not exists withdrawn_note text;      -- motivo público da retirada

-- O que já estava publicado foi conferido por pessoa. Sem mexer em updated_at: nada do que o público lê mudou.
alter table answer_drafts disable trigger set_updated_at;
update answer_drafts set verified_by = 'pessoa' where status in ('publicado', 'substituido') and verified_by is null;
alter table answer_drafts enable trigger set_updated_at;

alter table answer_drafts drop constraint if exists answer_drafts_status_check;
alter table answer_drafts add constraint answer_drafts_status_check
  check (status in ('rascunho', 'publicado', 'reprovado', 'substituido', 'barrado', 'retirado'));
alter table answer_drafts drop constraint if exists answer_drafts_verified_by_check;
alter table answer_drafts add constraint answer_drafts_verified_by_check
  check (verified_by in ('agentes', 'pessoa'));
alter table answer_drafts drop constraint if exists answer_drafts_withdrawn_note_check;
alter table answer_drafts add constraint answer_drafts_withdrawn_note_check
  check (status <> 'retirado' or withdrawn_note is not null);
-- tudo o que o público pode ler diz quem conferiu
alter table answer_drafts drop constraint if exists answer_drafts_public_verified_check;
alter table answer_drafts add constraint answer_drafts_public_verified_check
  check (status not in ('publicado', 'substituido', 'retirado') or verified_by is not null);
-- quem publicou ou barrou por agentes deixou o relatório
alter table answer_drafts drop constraint if exists answer_drafts_agent_report_check;
alter table answer_drafts add constraint answer_drafts_agent_report_check
  check (verified_by is distinct from 'agentes' or (verification is not null and verifier_version is not null));

create or replace function answer_drafts_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' then
      raise exception 'answer_drafts: nova linha só entra como rascunho (veio %)', new.status;
    end if;
    return new;
  end if;
  -- Depois de sair de 'rascunho', nada do que o público lê ou do que explica a publicação muda:
  -- respostas, avisos, fonte, relatório de verificação, quem conferiu, notas e de quem a linha é correção.
  if old.status <> 'rascunho' and (new.answers is distinct from old.answers or new.checks is distinct from old.checks
      or new.source_url is distinct from old.source_url or new.source_sha256 is distinct from old.source_sha256
      or new.verification is distinct from old.verification or new.verifier_version is distinct from old.verifier_version
      or new.verified_by is distinct from old.verified_by or new.reviewer is distinct from old.reviewer
      or new.reviewed_at is distinct from old.reviewed_at or new.correction_note is distinct from old.correction_note
      or new.review_note is distinct from old.review_note or new.replaces_id is distinct from old.replaces_id) then
    raise exception 'answer_drafts: % não pode ter respostas, notas nem verificação alteradas; publique uma correção', old.status;
  end if;
  -- o motivo da retirada entra junto com a retirada e não muda depois
  if new.withdrawn_note is distinct from old.withdrawn_note and not (old.status = 'publicado' and new.status = 'retirado') then
    raise exception 'answer_drafts: o motivo da retirada só é gravado no ato de retirar';
  end if;
  if new.status is distinct from old.status and not (
      (old.status = 'rascunho' and new.status in ('publicado', 'reprovado', 'barrado'))
      or (old.status = 'publicado' and new.status in ('substituido', 'retirado'))) then
    raise exception 'answer_drafts: transição % -> % não permitida', old.status, new.status;
  end if;
  return new;
end $$;

-- A segunda chave das automações que publicam sozinhas. Vazia = tudo desligado. Só o dono do banco escreve aqui.
create table if not exists pipeline_switches (
  name text primary key,
  value text not null,
  note text not null,                       -- quem ligou e com base em quê (ex.: "avaliação de 2026-12-01, decisions.md D2xx")
  set_at timestamptz not null default now()
);
alter table pipeline_switches enable row level security;

-- O público passa a poder ler também a linha retirada: a página precisa dizer que saiu e por quê.
-- Rascunho, reprovado e barrado continuam invisíveis para o site.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'web_reader') then
    alter policy public_read on answer_drafts using (status in ('publicado', 'substituido', 'retirado'));
  end if;
end $$;

create index if not exists answer_drafts_verif_idx on answer_drafts (status, verifier_version);
