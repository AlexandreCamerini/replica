-- Central: dívidas da D335 (plano de go-live, Fase 7, item 7.3). A parte do site (nonce do código de e-mail) está na 0144, que vai antes, no Supabase.
--
-- O que faz:
--   1. Central: "sair" revoga de verdade. O gatilho `central_fator_protege` (0157) passa a deixar o `admin_central` ADIANTAR `sessoes_desde` até o relógio
--      do banco (nunca atrasar, nunca para o futuro). A rota /admin/api/sair usa isso: as sessões de nível 2 da pessoa, em qualquer aparelho, deixam de valer.
--   2. Central: desativar revoga. Gatilho `adm_admins_revoga` em `adm_admins`: quando o admin ativo é desativado, apagado ou troca de e-mail, grava
--      `sessoes_desde = clock_timestamp()` no fator do e-mail ANTIGO. Antes, `ativo = false` só suspendia: reativado (ou recadastrado), um cookie no prazo voltava a valer.
--      O dono precisa desativar com um role que possa atualizar `login.central_fatores` (o dono da tabela ou superusuário); outro role faz a desativação inteira falhar (fecha).
--
-- Limite declarado: o gatilho do fator não amarra QUEM adianta `sessoes_desde` de quem. Quem tiver a credencial do `admin_central` derruba as sessões de qualquer
-- admin (é negação de serviço, não escalada); a aplicação só revoga as do próprio operador. O comentário de coluna da 0157 ("Só o dono do banco grava") fica desatualizado
-- e é refeito abaixo.
--
-- É aditiva: uma função refeita (mesma assinatura e mesmo gatilho), uma função e um gatilho novos. Nenhum grant novo.
-- Para desfazer: `drop trigger adm_admins_revoga on adm_admins; drop function adm_admins_revoga();`
--   e `create or replace` de `login.central_fator_protege` com o corpo da 0157.
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md (vai junto com a 0157, no Railway, depois do corte).


create or replace function login.central_fator_protege() returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  v_livre boolean;
begin
  -- lista do que pode: só o dono da tabela e superusuário passam sem regra (não depende do nome do role da central)
  select pg_catalog.pg_get_userbyid(c.relowner) = current_user or (select r.rolsuper from pg_catalog.pg_roles r where r.rolname = current_user)
    into v_livre from pg_catalog.pg_class c where c.oid = tg_relid;
  if v_livre then
    return new;
  end if;
  if new.ultimo_passo is not null and new.ultimo_passo > pg_catalog.floor(extract(epoch from pg_catalog.clock_timestamp()) / 30)::bigint + 4 then
    raise exception 'ultimo_passo além do relógio' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.verificado_em is not null or new.ultimo_passo is not null or new.sessoes_desde is not null then
      raise exception 'fator nasce não verificado' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.email is distinct from old.email then
    raise exception 'email não muda pela central' using errcode = '42501';
  end if;
  -- "sair": sessoes_desde só anda para a frente, e no máximo até o relógio do banco (com folga de 5 s)
  if new.sessoes_desde is distinct from old.sessoes_desde then
    if new.sessoes_desde is null
       or (old.sessoes_desde is not null and new.sessoes_desde < old.sessoes_desde)
       or new.sessoes_desde > pg_catalog.clock_timestamp() + interval '5 seconds' then
      raise exception 'sessoes_desde só avança até agora pela central' using errcode = '42501';
    end if;
  end if;
  if old.verificado_em is null then
    return new;  -- fator ainda não verificado: o cadastro pode recomeçar ou concluir
  end if;
  if new.segredo_cifrado is distinct from old.segredo_cifrado or new.verificado_em is distinct from old.verificado_em then
    raise exception 'fator verificado não se altera pela central' using errcode = '42501';
  end if;
  if new.ultimo_passo is null or (old.ultimo_passo is not null and new.ultimo_passo < old.ultimo_passo) then
    raise exception 'ultimo_passo não anda para trás' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function adm_admins_revoga() returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' or (old.ativo and (not new.ativo or new.email is distinct from old.email)) then
    -- greatest e coalesce são construções da linguagem, não funções: não levam esquema
    update login.central_fatores set sessoes_desde = greatest(coalesce(sessoes_desde, '-infinity'::timestamptz), pg_catalog.clock_timestamp())
     where email = old.email;
  end if;
  return null;
end $$;
drop trigger if exists adm_admins_revoga on adm_admins;
create trigger adm_admins_revoga after update of ativo, email or delete on adm_admins for each row execute function adm_admins_revoga();

comment on column login.central_fatores.sessoes_desde is 'Sessões de nível 2 emitidas antes deste instante não valem. O dono do banco grava livremente; a central só adianta até agora ("sair", 0158).';
