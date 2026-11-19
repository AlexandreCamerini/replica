-- Administração de coleta, B6: endurecimento da segunda chave e do override de contato (replica/admin-coleta-decisoes.md, AC-15, AC-16 e AC-17).
--
-- O que faz (tudo no escopo do módulo; nenhuma função, tabela ou coluna fora dele é alterada):
--   1. `adm_decisoes_guard` (criada na 0150) refeita: lê `public.pipeline_switches` com o esquema qualificado e tem `search_path` fixo na definição. Antes, uma tabela
--      temporária de mesmo nome, com a linha `on`, ligava a segunda chave (o esquema temporário é procurado antes de `public` quando o nome não é qualificado). O que bloqueia a sombra é a
--      QUALIFICAÇÃO `public.`; o `set search_path = pg_catalog, public` não exclui o esquema temporário da busca de tabelas e vale como defesa para funções e operadores.
--      Corpo idêntico ao da 0150; só mudam o esquema na leitura e a cláusula `set search_path`.
--   2. Função nova `adm_exige_chave_agentes` e gatilhos `adm_exige_chave_agentes` em `adm_overrides` e `adm_vinculos` (`before insert or update of decisao_id`): o guard acima confere a
--      MARCA `aplicada` da decisão, não o EFEITO. Com estes gatilhos, linha cuja `decisao_id` aponta para decisão de `agentes` só entra se a linha `admin_coleta_agentes = 'on'`
--      existir em `public.pipeline_switches`. Decisão de pessoa e linha sem `decisao_id` passam. (O `update of decisao_id` fecha a porta de religar uma linha existente a uma decisão de agentes.)
--   3. Função nova `adm_reaponta_override_contato` e gatilho `adm_reaponta_override` em `mandate_contacts` (`after update of mandate_id`, por linha): quando `merge_person` move os
--      contatos do mandato A para o mandato B (`update mandate_contacts set mandate_id = r.to_id where mandate_id = r.from_id`, 0002) e apaga A, os overrides VIGENTES da classe
--      `contato_mandato` com `registro_chave = A` passam a `registro_chave = B`; havendo override vigente do MESMO campo em B, o de A fica `vigente = false` (o de B prevalece) em vez de violar
--      `adm_overrides_vigente_uq`. É idempotente: o gatilho é por linha, mas só o primeiro contato movido de A encontra overrides com a chave A; os seguintes não encontram nada. `merge_person` NÃO é tocada.
--      LIMITE DECLARADO (AC-16): se o mandato A não tem nenhuma linha de contato na hora da fusão, nada dispara e o override fica órfão (`registro_chave` de um mandato que não existe mais).
--
-- É aditiva: três funções (uma refeita, duas novas) e três gatilhos novos. Não cria tabela nem coluna, não cria role, não cria policy, não concede nada; a RLS das tabelas `adm_*` não muda.
-- Sessão com `session_replication_role = replica` pula gatilho (como nas 0150 e 0151); o papel do ETL é dono das tabelas e pode desligar gatilho (risco residual (d) da AC-15, sem correção aqui).
--
-- As funções `adm_override_sapl_houses`, `adm_override_data_coverage` e `adm_override_mandate_contacts` (0150/0151) NÃO foram refeitas: não decidem nenhuma chave e continuam como estão.
-- Para desfazer: `drop trigger adm_exige_chave_agentes on adm_overrides;` (idem em `adm_vinculos`), `drop trigger adm_reaponta_override on mandate_contacts;`, as duas funções novas, e
-- `create or replace` de `adm_decisoes_guard` com o corpo da 0150.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

-- =====================================================================
-- 1. adm_decisoes_guard: esquema qualificado e search_path fixo
-- =====================================================================
create or replace function adm_decisoes_guard() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'adm_decisoes: a decisão é trilha e não se apaga';
  end if;
  if tg_op = 'INSERT' then
    if new.aplicada or new.aplicada_em is not null then
      raise exception 'adm_decisoes: a decisão entra não aplicada; quem aplica marca depois';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - 'aplicada' - 'aplicada_em') is distinct from (to_jsonb(old) - 'aplicada' - 'aplicada_em') then
    raise exception 'adm_decisoes: a decisão não se altera (só aplicada e aplicada_em); registre outra decisão';
  end if;
  if old.aplicada and (not new.aplicada or new.aplicada_em is distinct from old.aplicada_em) then
    raise exception 'adm_decisoes: decisão já aplicada não volta atrás';
  end if;
  if not old.aplicada and new.aplicada then
    if new.decidido_por_tipo = 'agentes' and not exists (
        select 1 from public.pipeline_switches where name = 'admin_coleta_agentes' and value = 'on') then
      raise exception 'adm_decisoes: decisão de agentes só se aplica com public.pipeline_switches.admin_coleta_agentes = on';
    end if;
    new.aplicada_em := coalesce(new.aplicada_em, now());
  elsif not new.aplicada and new.aplicada_em is not null then
    raise exception 'adm_decisoes: aplicada_em só junto com aplicada = true';
  end if;
  return new;
end $$;

-- =====================================================================
-- 2. O efeito de uma decisão de agentes também exige a segunda chave
-- =====================================================================
create or replace function adm_exige_chave_agentes() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.decisao_id is null then
    return new;
  end if;
  -- falha FECHADA: só passa a decisão que se prova de pessoa (se a linha da decisão não for visível ao papel que grava, não passa) ou a linha `on`
  if exists (select 1 from public.adm_decisoes where id = new.decisao_id and decidido_por_tipo = 'pessoa') then
    return new;
  end if;
  if exists (select 1 from public.pipeline_switches where name = 'admin_coleta_agentes' and value = 'on') then
    return new;
  end if;
  raise exception '%: linha de decisão de agentes só entra com public.pipeline_switches.admin_coleta_agentes = on', tg_table_name;
end $$;
drop trigger if exists adm_exige_chave_agentes on adm_overrides;
create trigger adm_exige_chave_agentes before insert or update of decisao_id on adm_overrides for each row execute function adm_exige_chave_agentes();
drop trigger if exists adm_exige_chave_agentes on adm_vinculos;
create trigger adm_exige_chave_agentes before insert or update of decisao_id on adm_vinculos for each row execute function adm_exige_chave_agentes();

-- =====================================================================
-- 3. A fusão de pessoas leva o override de contato junto com os contatos
-- =====================================================================
create or replace function adm_reaponta_override_contato() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare o record;
begin
  if old.mandate_id is not distinct from new.mandate_id then
    return new;                            -- `update of mandate_id` dispara também quando a coluna está na lista e não muda
  end if;
  for o in select id, campo from public.adm_overrides
           where vigente and classe = 'contato_mandato' and registro_chave = old.mandate_id::text
           for update
  loop
    if exists (select 1 from public.adm_overrides
               where vigente and classe = 'contato_mandato' and registro_chave = new.mandate_id::text and campo = o.campo) then
      update public.adm_overrides set vigente = false where id = o.id;        -- o override do mandato de destino prevalece
    else
      update public.adm_overrides set registro_chave = new.mandate_id::text where id = o.id;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists adm_reaponta_override on mandate_contacts;
create trigger adm_reaponta_override after update of mandate_id on mandate_contacts for each row execute function adm_reaponta_override_contato();
