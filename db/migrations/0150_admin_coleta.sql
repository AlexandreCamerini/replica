-- Administração de coleta (replica/admin-coleta.md; desenho em replica/admin-coleta-plano.md, seções 1 e 2): modelo de dados das Partes A e B.
--
-- O que é: onze tabelas `adm_*` (rodadas, tentativas por URL, evidências, vínculos, propostas, pendências, decisões,
-- overrides, pareceres e pedidos), os gatilhos de estado que travam as transições (padrão de `answer_drafts_guard`, 0130)
-- e os gatilhos de override (opção (d) do plano) em `sapl_houses`, `data_coverage` e `mandate_contacts`.
-- Também insere a fonte `curadoria` em `sources` (usada por contatos corrigidos à mão; o delete de `parlamento_extras` só alcança `camara` e `senado`).
--
-- É aditiva: tabelas, funções, gatilhos e uma linha em `sources`. Nenhuma coluna existente muda e nenhuma migração anterior é tocada.
-- O que NÃO faz: não cria role (o role da central é da 0151), não concede nada a ninguém, não cria policy
-- (RLS ligada e sem policy: só o dono do banco enxerga; as policies de leitura da central são da 0151),
-- não insere linha em `pipeline_switches` (sem a linha `admin_coleta_agentes = 'on'`, decisão de agentes não se aplica).
--
-- Override sem linha em `adm_overrides` não muda nada: o resultado gravado é idêntico ao de antes desta migração.
-- Para remover o mecanismo: `drop trigger adm_override on sapl_houses;` (idem em `data_coverage` e `mandate_contacts`).
-- Sessão com `session_replication_role = replica` pula gatilho: o override não vale nela.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

-- =====================================================================
-- 1. Tabelas
-- =====================================================================

-- Chave estável do registro (`registro_chave`, texto) e nome do `campo`, por classe:
--   vinculo_sapl    registro_chave = sapl_houses.id::text                          campo = base_url | status
--   cobertura       registro_chave = <places.ibge_code>:<data_coverage.dataset>     campo = status | reason | evidence_url
--   contato_mandato registro_chave = mandates.id::text                              campo = <kind>:<value> de mandate_contacts (ex.: email:fulano@camara.leg.br)
--   identidade      registro_chave = identity_match_queue.id::text                  campo = nome livre do que se decide (ex.: status)

create table adm_rodadas (
  id uuid primary key default gen_random_uuid(),
  coletor text not null check (btrim(coletor) <> ''),
  modo text not null check (modo in ('descobrir', 'recoletar', 'reprocessar')),
  argv jsonb,
  recorte jsonb,
  previa jsonb,
  repete_id uuid references adm_rodadas(id) on delete set null,   -- rodada de origem, quando é repetição
  so_pendencias boolean not null default false,
  forcar_urls jsonb,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'interrompida', 'falhou')),
  invocation text,                         -- liga a ingest_runs.invocation
  cache_dir text,
  iniciada_em timestamptz not null default now(),
  finalizada_em timestamptz
);
create index adm_rodadas_repete_idx on adm_rodadas (repete_id) where repete_id is not null;
create index adm_rodadas_invocation_idx on adm_rodadas (invocation) where invocation is not null;

create table adm_tentativas (
  id uuid primary key default gen_random_uuid(),
  rodada_id uuid not null references adm_rodadas(id) on delete cascade,
  url text not null check (btrim(url) <> ''),
  url_sha text not null check (btrim(url_sha) <> ''),
  host text,
  tentada_em timestamptz not null default now(),
  resultado text not null check (resultado in ('lida', 'reaproveitada', 'falha')),
  http_status int,
  motivo text check (motivo in ('bloqueio', 'robots', 'expiracao', 'erro', 'sem_conteudo')),
  conteudo_sha256 text,
  bytes bigint,
  entrada boolean not null default false,  -- URL de entrada da rodada (as demais foram seguidas a partir dela)
  constraint adm_tentativas_motivo_falha_check check ((resultado = 'falha') = (motivo is not null))
);
create index adm_tentativas_rodada_idx on adm_tentativas (rodada_id);
create index adm_tentativas_url_idx on adm_tentativas (url_sha, tentada_em desc);

create table adm_evidencias (
  url_sha text primary key,
  url text not null check (btrim(url) <> ''),
  conteudo_sha256 text not null check (btrim(conteudo_sha256) <> ''),
  lida_em timestamptz not null,
  fonte_declarada_em timestamptz,          -- data que a própria fonte declara; nula = a fonte não declara
  rodada_id uuid references adm_rodadas(id) on delete set null
);
comment on table adm_evidencias is 'Última evidência válida por URL. Só é regravada por leitura bem-sucedida: falha (adm_tentativas) não a toca.';

create table adm_pedidos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('rodada', 'recoleta', 'parecer')),
  parametros jsonb not null default '{}'::jsonb,
  chave_idem text not null check (btrim(chave_idem) <> ''),
  status text not null default 'na_fila' check (status in ('na_fila', 'em_execucao', 'concluido', 'falhou', 'interrompido')),
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  batimento_em timestamptz,
  finalizado_em timestamptz,
  rodada_id uuid references adm_rodadas(id) on delete set null,
  andamento jsonb,
  erro text
);
-- segundo pedido igual só entra depois de o primeiro terminar
create unique index adm_pedidos_idem_uq on adm_pedidos (chave_idem) where status in ('na_fila', 'em_execucao');
create index adm_pedidos_ativos_idx on adm_pedidos (criado_em) where status in ('na_fila', 'em_execucao');
create index adm_pedidos_rodada_idx on adm_pedidos (rodada_id) where rodada_id is not null;

create table adm_pendencias (
  id uuid primary key default gen_random_uuid(),
  classe text not null check (classe in ('vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade')),
  registro_chave text not null check (btrim(registro_chave) <> ''),
  campo text not null check (btrim(campo) <> ''),
  pergunta text not null check (btrim(pergunta) <> ''),
  tipo text not null check (tipo in ('mudanca', 'divergencia', 'duplicata', 'confirmacao')),
  status text not null default 'aberta' check (status in ('aberta', 'decidida')),
  reaberta boolean not null default false,
  motivo_reabertura text check (motivo_reabertura in ('evidencia_mudou', 'registro_mudou')),
  evidencia_sha text,
  vigente_sha text,
  vence_em timestamptz,
  cobertura_recorte numeric,
  criada_em timestamptz not null default now(),
  constraint adm_pendencias_reaberta_check check (not reaberta or motivo_reabertura is not null),
  constraint adm_pendencias_chave_uq unique (classe, registro_chave, campo)
);
-- Ordem da fila (restrição 7): classe do campo, tipo de pendência, vencimento, cobertura do recorte. Nunca por pessoa, partido ou popularidade;
-- esta tabela não tem coluna que permitiria. `id` desempata de forma estável.
create index adm_pendencias_fila_idx on adm_pendencias (classe, tipo, vence_em, cobertura_recorte, id) where status = 'aberta';

create table adm_propostas (
  id uuid primary key default gen_random_uuid(),
  classe text not null check (classe in ('vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade')),
  registro_chave text not null check (btrim(registro_chave) <> ''),
  campo text not null check (btrim(campo) <> ''),
  valor_vigente jsonb,                     -- nulo = não havia valor, ou não foi lido
  valor_candidato jsonb,
  url text not null check (btrim(url) <> ''),
  trecho text not null check (btrim(trecho) <> ''),
  conteudo_sha256 text not null check (btrim(conteudo_sha256) <> '' and conteudo_sha256 ~ '^[0-9a-fA-F]{64}$'),
  lida_em timestamptz,
  fonte_declarada_em timestamptz,
  alcance text not null default 'registro' check (alcance in ('registro', 'regra')),
  regra_criterio text,
  regra_ids jsonb,
  fonte_slug text,
  bloco text,                              -- delimitador do bloco do registro na página, quando a evidência vem de diretório
  rodada_id uuid references adm_rodadas(id) on delete set null,
  chave_idem text not null check (btrim(chave_idem) <> ''),
  criada_em timestamptz not null default now(),
  constraint adm_propostas_idem_uq unique (chave_idem),
  constraint adm_propostas_regra_check check (alcance <> 'regra' or (regra_criterio is not null and btrim(regra_criterio) <> '' and regra_ids is not null))
);
create index adm_propostas_registro_idx on adm_propostas (classe, registro_chave, campo);
create index adm_propostas_rodada_idx on adm_propostas (rodada_id) where rodada_id is not null;

create table adm_pendencia_propostas (
  pendencia_id uuid not null references adm_pendencias(id) on delete cascade,
  proposta_id uuid not null references adm_propostas(id) on delete cascade,
  primary key (pendencia_id, proposta_id)
);
create index adm_pendencia_propostas_proposta_idx on adm_pendencia_propostas (proposta_id);

create table adm_decisoes (
  id uuid primary key default gen_random_uuid(),
  pendencia_id uuid not null references adm_pendencias(id) on delete restrict,
  acao text not null check (acao in ('aprovar', 'corrigir', 'descartar', 'pedir_confirmacao')),
  decidido_por_tipo text not null check (decidido_por_tipo in ('pessoa', 'agentes')),
  decidido_por_nome text,
  relatorio jsonb,
  versao_verificador int,
  justificativa text not null check (btrim(justificativa) <> ''),
  campos_afetados jsonb,
  valor jsonb,
  aplicada boolean not null default false,
  aplicada_em timestamptz,
  criada_em timestamptz not null default now(),
  constraint adm_decisoes_pessoa_check check (decidido_por_tipo <> 'pessoa' or (decidido_por_nome is not null and btrim(decidido_por_nome) <> '')),
  constraint adm_decisoes_agentes_check check (decidido_por_tipo <> 'agentes' or (relatorio is not null and versao_verificador is not null)),
  constraint adm_decisoes_aplicada_check check (not aplicada or aplicada_em is not null)
);
create index adm_decisoes_pendencia_idx on adm_decisoes (pendencia_id, criada_em desc);
create index adm_decisoes_nao_aplicadas_idx on adm_decisoes (criada_em) where not aplicada;

create table adm_vinculos (
  id uuid primary key default gen_random_uuid(),
  classe text not null check (classe in ('vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade')),
  registro_chave text not null check (btrim(registro_chave) <> ''),
  fonte_slug text,
  url text not null check (btrim(url) <> ''),
  url_sha text not null check (btrim(url_sha) <> ''),
  origem text not null check (origem in ('registro_oficial', 'descoberta_automatica', 'correcao_manual')),
  vigente boolean not null default true,
  substitui_id uuid references adm_vinculos(id) on delete set null,
  rodada_id uuid references adm_rodadas(id) on delete set null,
  decisao_id uuid references adm_decisoes(id) on delete restrict,
  criada_em timestamptz not null default now()
);
create unique index adm_vinculos_vigente_uq on adm_vinculos (classe, registro_chave, url_sha) where vigente;

create table adm_overrides (
  id uuid primary key default gen_random_uuid(),
  classe text not null check (classe in ('vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade')),
  registro_chave text not null check (btrim(registro_chave) <> ''),
  campo text not null check (btrim(campo) <> ''),
  valor jsonb,                             -- jsonb 'null' = gravar NULL; SQL NULL só com suprimir
  suprimir boolean not null default false,
  decisao_id uuid not null references adm_decisoes(id) on delete restrict,
  vigente boolean not null default true,
  criada_em timestamptz not null default now(),
  constraint adm_overrides_valor_check check (suprimir or valor is not null)
);
create unique index adm_overrides_vigente_uq on adm_overrides (classe, registro_chave, campo) where vigente;
-- Serve à saída antecipada dos gatilhos (seção 4): "existe algum override vigente desta classe?" sem ler a tabela.
create index adm_overrides_vigente_classe_idx on adm_overrides (classe, suprimir) where vigente;
create index adm_overrides_decisao_idx on adm_overrides (decisao_id);

create table adm_pareceres (
  id uuid primary key default gen_random_uuid(),
  pendencia_id uuid not null references adm_pendencias(id) on delete cascade,
  pedido_id uuid references adm_pedidos(id) on delete set null,
  modelo text not null check (btrim(modelo) <> ''),
  versao_verificador int,
  entrada jsonb,
  saida jsonb,
  modo text not null check (modo = 'ensaio'),      -- nesta entrega só o motor de ensaio local
  simulado boolean not null,
  criada_em timestamptz not null default now()
);
create index adm_pareceres_pendencia_idx on adm_pareceres (pendencia_id);

comment on column adm_pendencias.registro_chave is 'Chave estável do registro. vinculo_sapl: sapl_houses.id; cobertura: <ibge_code>:<dataset> (ex.: 3509502:presenca); contato_mandato: mandates.id; identidade: identity_match_queue.id. Sempre em texto.';
comment on column adm_propostas.registro_chave is 'Chave estável do registro. vinculo_sapl: sapl_houses.id; cobertura: <ibge_code>:<dataset>; contato_mandato: mandates.id; identidade: identity_match_queue.id. Sempre em texto.';
comment on column adm_vinculos.registro_chave is 'Chave estável do registro. vinculo_sapl: sapl_houses.id; cobertura: <ibge_code>:<dataset>; contato_mandato: mandates.id; identidade: identity_match_queue.id. Sempre em texto.';
comment on column adm_overrides.registro_chave is 'Chave estável do registro. vinculo_sapl: sapl_houses.id; cobertura: <ibge_code>:<dataset>; contato_mandato: mandates.id; identidade: identity_match_queue.id. Sempre em texto.';
comment on column adm_overrides.campo is 'vinculo_sapl: base_url ou status. cobertura: status, reason ou evidence_url. contato_mandato: <kind>:<value> do contato suprimido (ex.: email:fulano@camara.leg.br; value como está em mandate_contacts, sem normalizar). identidade: livre.';
comment on column adm_pendencias.campo is 'Mesma codificação de adm_overrides.campo.';
comment on column adm_propostas.campo is 'Mesma codificação de adm_overrides.campo.';

-- =====================================================================
-- 2. RLS: ligada em todas, sem policy e sem grant (as policies da central são da 0151)
-- =====================================================================
alter table adm_rodadas enable row level security;
alter table adm_tentativas enable row level security;
alter table adm_evidencias enable row level security;
alter table adm_vinculos enable row level security;
alter table adm_propostas enable row level security;
alter table adm_pendencias enable row level security;
alter table adm_pendencia_propostas enable row level security;
alter table adm_decisoes enable row level security;
alter table adm_overrides enable row level security;
alter table adm_pareceres enable row level security;
alter table adm_pedidos enable row level security;

-- A 0001 concede select a web_reader por um laço sobre as tabelas que existiam NAQUELE momento (não há alter default privileges),
-- então estas tabelas nascem sem grant. No Supabase, porém, os privilégios padrão do schema public podem conceder a anon e
-- authenticated: o revoke explícito torna o resultado o mesmo em qualquer ambiente. Só toca em role que existe.
do $$
declare r text; t text;
begin
  foreach r in array array['web_reader', 'web_writer', 'anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'adm\_%' loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
    end if;
  end loop;
end $$;

-- =====================================================================
-- 3. Gatilhos de estado (padrão de answer_drafts_guard, 0130)
-- =====================================================================

-- rodada: aberta -> em_andamento -> concluida | interrompida | falhou; interrompida -> em_andamento; concluida e falhou são finais
create or replace function adm_rodadas_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
      (old.status = 'aberta' and new.status = 'em_andamento')
      or (old.status = 'em_andamento' and new.status in ('concluida', 'interrompida', 'falhou'))
      or (old.status = 'interrompida' and new.status = 'em_andamento')) then
    raise exception 'adm_rodadas: transição % -> % não permitida', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists adm_rodadas_guard on adm_rodadas;
create trigger adm_rodadas_guard before update on adm_rodadas for each row execute function adm_rodadas_guard();

-- pendência: aberta -> decidida; decidida -> aberta só com reaberta = true e motivo_reabertura preenchido
create or replace function adm_pendencias_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'aberta' and new.status = 'decidida' then
      return new;
    elsif old.status = 'decidida' and new.status = 'aberta' then
      if new.reaberta is not true or new.motivo_reabertura is null then
        raise exception 'adm_pendencias: reabrir pendência decidida exige reaberta = true e motivo_reabertura';
      end if;
    else
      raise exception 'adm_pendencias: transição % -> % não permitida', old.status, new.status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists adm_pendencias_guard on adm_pendencias;
create trigger adm_pendencias_guard before update on adm_pendencias for each row execute function adm_pendencias_guard();

-- decisão: trilha só de acréscimo. Muda apenas `aplicada` (falso -> verdadeiro) e `aplicada_em`; não se apaga.
-- Segunda chave: decisão de agentes só é aplicada com pipeline_switches.admin_coleta_agentes = 'on' (a variável ADMIN_COLETA_AGENTES é a primeira, no código).
create or replace function adm_decisoes_guard() returns trigger language plpgsql as $$
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
        select 1 from pipeline_switches where name = 'admin_coleta_agentes' and value = 'on') then
      raise exception 'adm_decisoes: decisão de agentes só se aplica com pipeline_switches.admin_coleta_agentes = on';
    end if;
    new.aplicada_em := coalesce(new.aplicada_em, now());
  elsif not new.aplicada and new.aplicada_em is not null then
    raise exception 'adm_decisoes: aplicada_em só junto com aplicada = true';
  end if;
  return new;
end $$;
drop trigger if exists adm_decisoes_guard on adm_decisoes;
create trigger adm_decisoes_guard before insert or update or delete on adm_decisoes for each row execute function adm_decisoes_guard();

-- pedido: na_fila -> em_execucao -> concluido | falhou | interrompido; concluido, falhou e interrompido são finais
create or replace function adm_pedidos_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and not (
      (old.status = 'na_fila' and new.status = 'em_execucao')
      or (old.status = 'em_execucao' and new.status in ('concluido', 'falhou', 'interrompido'))) then
    raise exception 'adm_pedidos: transição % -> % não permitida', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists adm_pedidos_guard on adm_pedidos;
create trigger adm_pedidos_guard before update on adm_pedidos for each row execute function adm_pedidos_guard();

-- =====================================================================
-- 4. Gatilhos de override (opção (d) do plano) em tabelas existentes
-- =====================================================================
-- Todos começam por um `exists` no índice parcial adm_overrides_vigente_classe_idx: sem override vigente da classe, a função devolve
-- a linha sem outro custo (nem join com `places`). Isso importa porque o gatilho dispara por linha PROPOSTA, inclusive nas ~33 mil de
-- derive_stats que caem em `on conflict do nothing`. Rodam com o privilégio de quem grava (o ETL, dono do banco): não são security definer.
-- No `on conflict do update`, o gatilho de insert vê o id ainda não existente; quem vale é o de update, que vê a linha existente.

-- 4a. sapl_houses: base_url e status (classe vinculo_sapl; registro_chave = id)
create or replace function adm_override_sapl_houses() returns trigger language plpgsql as $$
declare o record;
begin
  if not exists (select 1 from adm_overrides where vigente and classe = 'vinculo_sapl' and not suprimir) then
    return new;
  end if;
  if new.id is null then
    return new;                            -- insert sem id: não há override possível para uma linha que ainda não existe
  end if;
  for o in select campo, valor from adm_overrides
           where vigente and not suprimir and classe = 'vinculo_sapl' and registro_chave = new.id::text and campo in ('base_url', 'status')
  loop
    if o.campo = 'base_url' then
      new.base_url := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    else
      new.status := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists adm_override on sapl_houses;
create trigger adm_override before insert or update of base_url, status on sapl_houses for each row execute function adm_override_sapl_houses();

-- 4b. data_coverage: status, reason e evidence_url (classe cobertura; registro_chave = <places.ibge_code>:<dataset>)
create or replace function adm_override_data_coverage() returns trigger language plpgsql as $$
declare o record; v_chave text;
begin
  if not exists (select 1 from adm_overrides where vigente and classe = 'cobertura' and not suprimir) then
    return new;
  end if;
  select p.ibge_code || ':' || new.dataset into v_chave from places p where p.id = new.place_id and p.ibge_code is not null;
  if v_chave is null then
    return new;                            -- lugar sem ibge_code não tem chave de override
  end if;
  for o in select campo, valor from adm_overrides
           where vigente and not suprimir and classe = 'cobertura' and registro_chave = v_chave and campo in ('status', 'reason', 'evidence_url')
  loop
    if o.campo = 'status' then
      new.status := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    elsif o.campo = 'reason' then
      new.reason := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    else
      new.evidence_url := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists adm_override on data_coverage;
create trigger adm_override before insert or update of status, reason, evidence_url on data_coverage for each row execute function adm_override_data_coverage();

-- 4c. mandate_contacts: insert de contato suprimido não cria linha (classe contato_mandato; registro_chave = mandate_id;
-- campo = <kind>:<value>). Sem gatilho de delete: cancelar o delete em cascata de mandato quebraria a integridade referencial.
-- Corrigir um contato = suprimir o valor antigo + inserir o novo com a fonte `curadoria` (duas linhas na mesma decisão).
create or replace function adm_override_mandate_contacts() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from adm_overrides where vigente and classe = 'contato_mandato' and suprimir) then
    return new;
  end if;
  if exists (select 1 from adm_overrides
             where vigente and suprimir and classe = 'contato_mandato'
               and registro_chave = new.mandate_id::text and campo = new.kind || ':' || new.value) then
    return null;                           -- descarta o insert
  end if;
  return new;
end $$;
drop trigger if exists adm_override on mandate_contacts;
create trigger adm_override before insert on mandate_contacts for each row execute function adm_override_mandate_contacts();

-- =====================================================================
-- 5. Fonte `curadoria`
-- =====================================================================
-- Contatos corrigidos à mão ganham esta fonte; o delete de parlamento_extras só filtra `camara` e `senado`. A url aponta para o
-- documento do módulo no repositório: não há site externo que sirva de origem, e é isso que a fonte é (decisão registrada, não dado de terceiro).
insert into sources (slug, name, url, license) values
  ('curadoria', 'Curadoria · decisões registradas na administração de coleta', 'replica/admin-coleta.md', 'Registro interno do projeto (sem dado de terceiros)')
on conflict (slug) do nothing;
