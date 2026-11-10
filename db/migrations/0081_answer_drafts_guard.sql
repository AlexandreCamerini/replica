-- Trava no banco para a Regra 3 (revisão independente de 04/11/2026): a CLI já confere tudo, mas um UPDATE direto
-- não pode reescrever o que o público leu nem pular a revisão.
--   rascunho   -> publicado | reprovado      (único caminho até o público)
--   publicado  -> substituido                (correção; a nova versão nasce como rascunho e é publicada pela CLI)
--   reprovado, substituido: finais
-- Depois de sair de 'rascunho', respostas, avisos e fonte não mudam. Inserção só como 'rascunho'.
create or replace function answer_drafts_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' then
      raise exception 'answer_drafts: nova linha só entra como rascunho (veio %)', new.status;
    end if;
    return new;
  end if;
  if old.status <> 'rascunho' and (new.answers is distinct from old.answers or new.checks is distinct from old.checks
      or new.source_url is distinct from old.source_url or new.source_sha256 is distinct from old.source_sha256) then
    raise exception 'answer_drafts: % não pode ter respostas alteradas; publique uma correção', old.status;
  end if;
  if new.status is distinct from old.status and not (
      (old.status = 'rascunho' and new.status in ('publicado', 'reprovado'))
      or (old.status = 'publicado' and new.status = 'substituido')) then
    raise exception 'answer_drafts: transição % -> % não permitida', old.status, new.status;
  end if;
  return new;
end $$;

create trigger answer_drafts_guard before insert or update on answer_drafts for each row execute function answer_drafts_guard();
