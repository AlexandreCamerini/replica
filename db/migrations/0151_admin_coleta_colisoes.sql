-- Administração de coleta, B3a: colisões entre o job e o override (replica/admin-coleta-plano.md, seção 2, opção (d)).
--
-- O que faz: o gatilho de override da 0150 repõe o valor decidido e o valor que o job tentou gravar se perde. Esta migração faz o gatilho ANOTAR, no próprio
-- override, o último valor que o job tentou gravar quando ele difere do decidido (`tentou_valor`, `tentou_em`, `tentou_vezes`). A rodada de coleta lê a anotação
-- (etl/civico_etl/admin/proponentes.py) e propõe a mudança com evidência; a pendência decidida reabre pela regra de hash que já existe.
--
-- É aditiva: três colunas em `adm_overrides` (nula, nula, inteiro com default 0) e `create or replace` das duas funções de gatilho criadas na 0150
-- (`adm_override_sapl_houses`, `adm_override_data_coverage`). A 0150 NÃO é editada e os gatilhos (`adm_override`) não são recriados: a função nova vale no mesmo gatilho.
-- Não cria role, não cria policy, não concede nada; a RLS de `adm_overrides` (ligada na 0150, sem policy) não muda.
--
-- Sem linha em `adm_overrides` para a classe, nada muda: a primeira instrução das duas funções é a mesma saída antecipada da 0150, e o que o job grava continua idêntico.
-- Com override, o valor gravado na tabela de domínio é o mesmo da 0150 (o decidido); a única diferença visível é a anotação.
--
-- REGRAS DA ANOTAÇÃO (as três valem para sapl_houses.base_url|status e data_coverage.status|reason|evidence_url):
--   1. valor que chega DIFERENTE do decidido e DIFERENTE do já anotado: grava `tentou_valor` (jsonb; o texto 'null' = o job tentou gravar NULL), `tentou_em = now()` e
--      `tentou_vezes + 1`. Valor igual ao já anotado não regrava (o derive.stats propõe dezenas de milhares de linhas idênticas por execução).
--   2. valor que chega IGUAL ao decidido, havendo anotação: `tentou_valor = null` (a fonte voltou a concordar; `tentou_vezes` e `tentou_em` ficam). Só limpa se a anotação é
--      de uma transação anterior (`tentou_em < now()`): na mesma instrução de upsert o INSERT e o UPDATE passam pela função e a anotação recém-feita não pode ser desfeita.
--   3. `insert ... on conflict`: o gatilho de INSERT roda ANTES do conflito e não sabe se ele cai em `do update` (a linha existente é reescrita) ou `do nothing`
--      (derive_stats.py, COVERAGE_SQL: a linha proposta é descartada, não é "o job tentou gravar"). Decisão: quando o INSERT é de uma chave que JÁ EXISTE e tem override,
--      a função devolve a linha como veio, sem impor e sem anotar. Se o conflito é `do update`, o gatilho de UPDATE vê o valor que chegou (`excluded` sem imposição) e
--      anota e impõe; se é `do nothing`, nada acontece (e o valor decidido continua na tabela, que não foi tocada). Só o UPDATE e o INSERT que CRIA a linha anotam.
--      Consequência para o `do update ... where (colunas) is distinct from (excluded.colunas)` de db.upsert: para uma linha com override o `excluded` agora é o valor
--      que chegou (antes era o decidido), então a linha é reescrita quando o que chegou difere do decidido; o resultado gravado é o mesmo da 0150.
--   Limite: um upsert que não altera nenhuma coluna (o `where` do upsert falha) não dispara o UPDATE e portanto não limpa a anotação (regra 2); na prática
--   `checked_at` (sapl_houses) e `checked_on` (data_coverage) mudam a cada rodada. A rodada só considera anotação com `tentou_em` dentro da própria execução.
--   Outro limite: um `update` direto que lista só UMA das colunas do gatilho (ex.: `set base_url = ...`) enxerga as demais com o valor atual da linha (= o decidido) e, por
--   isso, limpa a anotação delas (regra 2). Nenhum job faz isso hoje (os dois escritores usam `db.upsert`, que lista todas as colunas, ou `update` de colunas fora da lista).
--
-- Sessão com `session_replication_role = replica` pula gatilho: o override e a anotação não valem nela (como na 0150).
-- Para desfazer: restaure as funções da 0150 (`create or replace` com o corpo de lá); as colunas novas podem ficar.
--
-- Aplicar em produção é passo do dono: replica/runbook-migracoes-producao.md

alter table adm_overrides
  add column tentou_valor jsonb,
  add column tentou_em timestamptz,
  add column tentou_vezes integer not null default 0;

comment on column adm_overrides.tentou_valor is 'Último valor que o job tentou gravar no campo e que difere de `valor` (anotado pelo gatilho; jsonb ''null'' = o job tentou gravar NULL). Nulo = o job nunca divergiu ou voltou a concordar.';
comment on column adm_overrides.tentou_em is 'Início da transação do job que anotou `tentou_valor` (now() do gatilho).';
comment on column adm_overrides.tentou_vezes is 'Quantas vezes `tentou_valor` mudou desde a criação do override (não conta o mesmo valor repetido).';

-- sapl_houses: base_url e status (classe vinculo_sapl; registro_chave = id)
create or replace function adm_override_sapl_houses() returns trigger language plpgsql as $$
declare o record; v_chegou jsonb; v_visto boolean := false;
begin
  if not exists (select 1 from adm_overrides where vigente and classe = 'vinculo_sapl' and not suprimir) then
    return new;
  end if;
  if new.id is null then
    return new;                            -- insert sem id: não há override possível para uma linha que ainda não existe
  end if;
  for o in select id, campo, valor, tentou_valor, tentou_em from adm_overrides
           where vigente and not suprimir and classe = 'vinculo_sapl' and registro_chave = new.id::text and campo in ('base_url', 'status')
  loop
    if not v_visto then
      v_visto := true;
      if tg_op = 'INSERT' and exists (select 1 from sapl_houses where place_id = new.place_id) then
        return new;                        -- chave que já existe: o conflito decide (do update -> gatilho de UPDATE; do nothing -> nada). Ver regra 3 no cabeçalho.
      end if;
    end if;
    v_chegou := coalesce(case when o.campo = 'base_url' then to_jsonb(new.base_url) else to_jsonb(new.status) end, 'null'::jsonb);
    if v_chegou is distinct from o.valor then
      if o.tentou_valor is distinct from v_chegou then
        update adm_overrides set tentou_valor = v_chegou, tentou_em = now(), tentou_vezes = tentou_vezes + 1 where id = o.id;
      end if;
    elsif o.tentou_valor is not null and coalesce(o.tentou_em, '-infinity'::timestamptz) < now() then
      update adm_overrides set tentou_valor = null where id = o.id;
    end if;
    if o.campo = 'base_url' then
      new.base_url := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    else
      new.status := case when jsonb_typeof(o.valor) = 'null' then null else o.valor #>> '{}' end;
    end if;
  end loop;
  return new;
end $$;

-- data_coverage: status, reason e evidence_url (classe cobertura; registro_chave = <places.ibge_code>:<dataset>)
create or replace function adm_override_data_coverage() returns trigger language plpgsql as $$
declare o record; v_chave text; v_chegou jsonb; v_visto boolean := false;
begin
  if not exists (select 1 from adm_overrides where vigente and classe = 'cobertura' and not suprimir) then
    return new;
  end if;
  select p.ibge_code || ':' || new.dataset into v_chave from places p where p.id = new.place_id and p.ibge_code is not null;
  if v_chave is null then
    return new;                            -- lugar sem ibge_code não tem chave de override
  end if;
  for o in select id, campo, valor, tentou_valor, tentou_em from adm_overrides
           where vigente and not suprimir and classe = 'cobertura' and registro_chave = v_chave and campo in ('status', 'reason', 'evidence_url')
  loop
    if not v_visto then
      v_visto := true;
      if tg_op = 'INSERT' and exists (select 1 from data_coverage where place_id = new.place_id and dataset = new.dataset) then
        return new;                        -- chave que já existe: o conflito decide (do update -> gatilho de UPDATE; do nothing -> nada). Ver regra 3 no cabeçalho.
      end if;
    end if;
    v_chegou := coalesce(case o.campo when 'status' then to_jsonb(new.status) when 'reason' then to_jsonb(new.reason) else to_jsonb(new.evidence_url) end, 'null'::jsonb);
    if v_chegou is distinct from o.valor then
      if o.tentou_valor is distinct from v_chegou then
        update adm_overrides set tentou_valor = v_chegou, tentou_em = now(), tentou_vezes = tentou_vezes + 1 where id = o.id;
      end if;
    elsif o.tentou_valor is not null and coalesce(o.tentou_em, '-infinity'::timestamptz) < now() then
      update adm_overrides set tentou_valor = null where id = o.id;
    end if;
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
