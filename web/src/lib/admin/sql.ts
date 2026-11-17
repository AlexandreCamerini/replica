// SQL da central de administração (Parte C). Módulo PURO: sem `server-only`, sem Next, sem banco. Importável pelo `node --test`.
//
// Três blocos:
//   1. constantes COPIADAS LITERALMENTE do ETL (relatorio.py e pendencias.py), com SÓ a sintaxe de parâmetro trocada (`%(nome)s` -> `$n`).
//      É o que garante o critério 19 (painel = relatório da CLI): o teste admin-sql.test.ts extrai a constante do Python e exige igualdade.
//      Para atualizar uma delas, mude no ETL e regenere aqui; nunca edite o texto à mão.
//   2. consultas PRÓPRIAS da central, que não existem no ETL (fichas por território, executor, rodadas, ficha com histórico).
//   3. inserção de pedido: a central SÓ escreve em `adm_pedidos` e `adm_pedidos_decisao` (decisão AC-19; migração 0153).
//
// `chave_idem` dos pedidos: a MESMA de etl/civico_etl/admin/executor.py (`chave_idem`; o teste admin-sql.test.ts confere os VETORES_DE_OURO de lá):
//   sha256 hex (UTF-8) do JSON CANÔNICO (chaves ordenadas em todos os níveis, sem espaços, texto não ASCII sem escape; igual a
//   `classes.canonico` do ETL: sort_keys, ensure_ascii=False, separators=(",", ":")) de
//     - adm_pedidos:         {"tipo": <tipo>, "parametros": <parametros normalizados como em executor.normalizar>}
//     - adm_pedidos_decisao: {"tipo": "decisao", "parametros": {"pendencia_id", "acao", "valor", "por_nome", "aplicar"}}  (`valor` ausente = null; justificativa fica FORA)
//   Dois pedidos iguais enquanto o primeiro está na_fila/em_execucao dão o mesmo id (índice único parcial da tabela + `where not exists` abaixo).
//
// Parâmetros ($1, $2...) sempre com cast explícito: o driver manda tipo desconhecido e o Postgres infere pelo cast. Lista de valores vai
// como texto JSON (`$n::text::jsonb`), nunca como array do driver. NUNCA `$n::jsonb` direto: com postgres.js e `prepare: false` o texto JSON
// vira um jsonb ESCALAR de texto (dupla codificação; defeito D1 da prova C7) e o executor recusa o pedido.
import { createHash } from "node:crypto";

/** JSON canônico: chaves ordenadas em todos os níveis, sem espaços. Não aceita `undefined`, função nem número não finito. */
export function jsonCanonico(v: unknown): string {
  return JSON.stringify(ordenar(v));
}

function ordenar(v: unknown): unknown {
  if (v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new TypeError("valor não serializável no JSON canônico");
  if (typeof v === "number" && !Number.isFinite(v)) throw new TypeError("número não finito no JSON canônico");
  if (Array.isArray(v)) return v.map(ordenar);
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, ordenar(o[k])]));
  }
  return v;
}

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export const chaveIdemPedido = (tipo: string, parametros: unknown): string => sha256(jsonCanonico({ tipo, parametros }));

export const chaveIdemDecisao = (d: { pendencia_id: string; acao: string; valor: unknown; por_nome: string; aplicar: boolean }): string =>
  sha256(jsonCanonico({ tipo: "decisao", parametros: { pendencia_id: d.pendencia_id, acao: d.acao, valor: d.valor === undefined ? null : d.valor, por_nome: d.por_nome, aplicar: d.aplicar } }));

// ============================================================================================================================
// PARTE 1: constantes COPIADAS do ETL (critério 19). Só a sintaxe de parâmetro mudou (`%(nome)s` -> `$n`). Não edite à mão: o teste
// admin-sql.test.ts extrai a constante do Python (ast), troca o parâmetro e exige igualdade (espaço normalizado).
// ============================================================================================================================

// Python: SQL_URLS_TENTADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_TENTADAS = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc)
select url_sha, url from ultima order by url_sha
`;

// Python: SQL_URLS_LIDAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_LIDAS = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc)
select url_sha, url from ultima where resultado = 'lida' order by url_sha
`;

// Python: SQL_URLS_REAPROVEITADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_REAPROVEITADAS = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc)
select url_sha, url from ultima where resultado = 'reaproveitada' order by url_sha
`;

// Python: SQL_URLS_COM_FALHA (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_COM_FALHA = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc)
select url_sha, url, motivo from ultima where resultado = 'falha' order by url_sha
`;

// Python: SQL_URLS_ENTRADA_DECLARADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_ENTRADA_DECLARADAS = `with declaradas as (
  select distinct encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha, x.item->>'url' as url
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'urls_entrada') = 'array' then r.previa->'urls_entrada' else '[]'::jsonb end) as x(item)
  where r.id = $1::uuid and coalesce(jsonb_typeof(x.item->'condicional'), 'null') = 'null')
select url_sha, url from declaradas order by url_sha
`;

// Python: SQL_URLS_ENTRADA_TENTADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_ENTRADA_TENTADAS = `select distinct on (t.url_sha) t.url_sha, t.url from adm_tentativas t where t.rodada_id = $1::uuid and t.entrada order by t.url_sha, t.tentada_em desc, t.id desc
`;

// Python: SQL_URLS_ENTRADA_NAO_TENTADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_URLS_ENTRADA_NAO_TENTADAS = `with declaradas as (
  select distinct encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha, x.item->>'url' as url
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'urls_entrada') = 'array' then r.previa->'urls_entrada' else '[]'::jsonb end) as x(item)
  where r.id = $1::uuid and coalesce(jsonb_typeof(x.item->'condicional'), 'null') = 'null')
select d.url_sha, d.url from declaradas d
where not exists (select 1 from adm_tentativas t where t.rodada_id = $1::uuid and t.entrada and t.url_sha = d.url_sha) order by d.url_sha
`;

// Python: SQL_REGISTROS_ELEGIVEIS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_REGISTROS_ELEGIVEIS = `with elegiveis as (
  select r.previa->'registros_elegiveis'->>'classe' as classe,
         coalesce(x.item->>'sapl_houses_id', x.item->>'mandate_id',
                  (select h.id::text from sapl_houses h join places p on p.id = h.place_id
                    where (x.item->>'uf' is not null and p.kind = 'uf' and p.uf = x.item->>'uf')
                       or (x.item->>'ibge' is not null and p.ibge_code = x.item->>'ibge')
                    order by h.id limit 1)) as registro_chave,
         coalesce(x.item->>'uf', x.item->>'ibge', x.item->>'sapl_houses_id', x.item->>'rotulo', x.item->>'mandate_id') as rotulo,
         x.item->>'url' as url,
         encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'registros_elegiveis'->'chaves') = 'array' then r.previa->'registros_elegiveis'->'chaves' else '[]'::jsonb end) as x(item)
  where r.id = $1::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number')
select classe, registro_chave, rotulo from elegiveis order by classe, registro_chave nulls last, rotulo
`;

// Python: SQL_REGISTROS_ALCANCADOS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_REGISTROS_ALCANCADOS = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc),
elegiveis as (
  select r.previa->'registros_elegiveis'->>'classe' as classe,
         coalesce(x.item->>'sapl_houses_id', x.item->>'mandate_id',
                  (select h.id::text from sapl_houses h join places p on p.id = h.place_id
                    where (x.item->>'uf' is not null and p.kind = 'uf' and p.uf = x.item->>'uf')
                       or (x.item->>'ibge' is not null and p.ibge_code = x.item->>'ibge')
                    order by h.id limit 1)) as registro_chave,
         coalesce(x.item->>'uf', x.item->>'ibge', x.item->>'sapl_houses_id', x.item->>'rotulo', x.item->>'mandate_id') as rotulo,
         x.item->>'url' as url,
         encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'registros_elegiveis'->'chaves') = 'array' then r.previa->'registros_elegiveis'->'chaves' else '[]'::jsonb end) as x(item)
  where r.id = $1::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number'),
casam as (
  select v.classe, v.registro_chave, u.url_sha, u.url, u.resultado, u.motivo, u.tentada_em
  from adm_vinculos v
  join ultima u on u.url = v.url or left(u.url, length(rtrim(v.url, '/')) + 1) = rtrim(v.url, '/') || '/'
  where v.vigente and split_part(regexp_replace(u.url, '^[A-Za-z]+://[^/]+', ''), '?', 1) <> '/robots.txt'),
alcancados as (
  select distinct c.classe, c.registro_chave
  from casam c
  where c.resultado in ('lida', 'reaproveitada')
    and (not exists (select 1 from adm_rodadas r where r.id = $1::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number')
         or exists (select 1 from elegiveis e where e.classe = c.classe and e.registro_chave = c.registro_chave and e.url is null))
  union
  select e.classe, e.registro_chave
  from elegiveis e join ultima u on u.url_sha = e.url_sha
  where e.url is not null and u.resultado in ('lida', 'reaproveitada'))
select classe, registro_chave from alcancados order by classe, registro_chave
`;

// Python: SQL_REGISTROS_NAO_ALCANCADOS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_REGISTROS_NAO_ALCANCADOS = `with ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = $1::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc),
elegiveis as (
  select r.previa->'registros_elegiveis'->>'classe' as classe,
         coalesce(x.item->>'sapl_houses_id', x.item->>'mandate_id',
                  (select h.id::text from sapl_houses h join places p on p.id = h.place_id
                    where (x.item->>'uf' is not null and p.kind = 'uf' and p.uf = x.item->>'uf')
                       or (x.item->>'ibge' is not null and p.ibge_code = x.item->>'ibge')
                    order by h.id limit 1)) as registro_chave,
         coalesce(x.item->>'uf', x.item->>'ibge', x.item->>'sapl_houses_id', x.item->>'rotulo', x.item->>'mandate_id') as rotulo,
         x.item->>'url' as url,
         encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'registros_elegiveis'->'chaves') = 'array' then r.previa->'registros_elegiveis'->'chaves' else '[]'::jsonb end) as x(item)
  where r.id = $1::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number'),
casam as (
  select v.classe, v.registro_chave, u.url_sha, u.url, u.resultado, u.motivo, u.tentada_em
  from adm_vinculos v
  join ultima u on u.url = v.url or left(u.url, length(rtrim(v.url, '/')) + 1) = rtrim(v.url, '/') || '/'
  where v.vigente and split_part(regexp_replace(u.url, '^[A-Za-z]+://[^/]+', ''), '?', 1) <> '/robots.txt'),
alcancados as (
  select distinct c.classe, c.registro_chave
  from casam c
  where c.resultado in ('lida', 'reaproveitada')
    and (not exists (select 1 from adm_rodadas r where r.id = $1::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number')
         or exists (select 1 from elegiveis e where e.classe = c.classe and e.registro_chave = c.registro_chave and e.url is null))
  union
  select e.classe, e.registro_chave
  from elegiveis e join ultima u on u.url_sha = e.url_sha
  where e.url is not null and u.resultado in ('lida', 'reaproveitada'))
select e.classe, e.registro_chave, e.rotulo,
  case when e.registro_chave is null then case when e.classe = 'vinculo_sapl' then 'registro ainda não existe no banco (casa não registrada)' else 'registro ainda não existe no banco' end
       when e.url is not null and not exists (select 1 from ultima u where u.url_sha = e.url_sha) then 'URL do registro não tentada nesta rodada'
       when e.url is not null then 'URL do registro tentada na rodada, nenhuma leitura'
       when not exists (select 1 from adm_vinculos v where v.vigente and v.classe = e.classe and v.registro_chave = e.registro_chave) then 'sem vínculo vigente com URL'
       when not exists (select 1 from casam c where c.classe = e.classe and c.registro_chave = e.registro_chave) then 'nenhuma URL do registro foi tentada nesta rodada'
       else 'URLs do registro tentadas na rodada, nenhuma lida nem reaproveitada' end as situacao,
  case when e.url is not null then (select u.motivo from ultima u where u.url_sha = e.url_sha and u.resultado = 'falha')
       else (select c.motivo from casam c where c.classe = e.classe and c.registro_chave = e.registro_chave and c.resultado = 'falha'
              order by c.tentada_em desc, c.url_sha limit 1) end as motivo_falha
from elegiveis e
where not exists (select 1 from alcancados a where a.classe = e.classe and a.registro_chave = e.registro_chave)
order by e.classe, e.registro_chave nulls last, e.rotulo
`;

// Python: SQL_CAMPOS_COM_PROPOSTA (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_COM_PROPOSTA = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid)
select classe, registro_chave, campo from campos order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_SITUACAO (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_SITUACAO = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo, situacao, origem, reaberta, motivo_reabertura from sit order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_CONFLITANTES (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_CONFLITANTES = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo from sit where situacao = 'conflitante' order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_PENDENTES (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_PENDENTES = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo from sit where situacao = 'pendente' order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_SEM_PENDENCIA (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_SEM_PENDENCIA = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo from sit where origem = 'sem_pendencia_aberta' order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_CONFIRMADOS_PELA_FONTE (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_CONFIRMADOS_PELA_FONTE = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo from sit where origem = 'pela_fonte' order by classe, registro_chave, campo
`;

// Python: SQL_CAMPOS_CONFIRMADOS_POR_DECISAO (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_CAMPOS_CONFIRMADOS_POR_DECISAO = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo from sit where origem = 'por_decisao' order by classe, registro_chave, campo
`;

// Python: SQL_PENDENCIAS_REABERTAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_PENDENCIAS_REABERTAS = `with campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = $1::uuid),
sit as (
  select c.classe, c.registro_chave, c.campo, p.reaberta, p.motivo_reabertura,
         case when p.status = 'aberta' and p.tipo = 'divergencia' then 'conflitante'
              when p.status = 'aberta' then 'pendente'
              when p.status = 'decidida' then 'confirmado'
              when f.confirma then 'confirmado'
              else 'pendente' end as situacao,
         case when p.status = 'aberta' then 'pendencia_aberta'
              when p.status = 'decidida' then 'por_decisao'
              when f.confirma then 'pela_fonte'
              else 'sem_pendencia_aberta' end as origem
  from campos c
  left join adm_pendencias p on p.classe = c.classe and p.registro_chave = c.registro_chave and p.campo = c.campo
  cross join lateral (select not exists (select 1 from adm_propostas q
                                          where q.rodada_id = $1::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)
select classe, registro_chave, campo, motivo_reabertura from sit where situacao in ('conflitante', 'pendente') and reaberta order by classe, registro_chave, campo
`;

// Python: SQL_REGISTROS_COM_PROPOSTA (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_REGISTROS_COM_PROPOSTA = `select distinct classe, registro_chave from adm_propostas where rodada_id = $1::uuid order by classe, registro_chave
`;

// Python: SQL_REGISTROS_ALTERADOS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_REGISTROS_ALTERADOS = `select distinct pr.classe, pr.registro_chave
from adm_decisoes d
join adm_pendencia_propostas pp on pp.pendencia_id = d.pendencia_id
join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = $1::uuid
where d.acao in ('aprovar', 'corrigir') and d.aplicada
order by pr.classe, pr.registro_chave
`;

// Python: SQL_PENDENCIAS_LIGADAS (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_PENDENCIAS_LIGADAS = `select distinct pp.pendencia_id::text as id
from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = $1::uuid
order by 1
`;

// Python: SQL_DECISOES (etl/civico_etl/admin/relatorio.py); parâmetros: $1=rodada
export const SQL_DECISOES = `select d.id::text as id, d.acao, d.decidido_por_tipo, d.aplicada
from adm_decisoes d
where exists (select 1 from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = $1::uuid where pp.pendencia_id = d.pendencia_id)
order by d.id::text
`;

// Python: SQL_FILA (etl/civico_etl/admin/pendencias.py); parâmetros: $1=classe, $2=limite
export const SQL_FILA = `select id, classe, registro_chave, campo, tipo, pergunta, reaberta, motivo_reabertura, evidencia_sha, vigente_sha, vence_em, cobertura_recorte, criada_em
from adm_pendencias
where status = 'aberta' and ($1::text is null or classe = $1::text)
order by array_position(array['vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade']::text[], classe),
         array_position(array['divergencia', 'mudanca', 'duplicata', 'confirmacao']::text[], tipo),
         vence_em asc nulls last,
         cobertura_recorte asc nulls last,
         id
limit $2
`;

/** Tabela de paridade lida pelo teste: nome Python, arquivo de origem, parâmetros nomeados na ordem de `$1..$n` e a constante daqui. */
export const COPIADAS_DO_ETL: ReadonlyArray<{ python: string; arquivo: string; params: readonly string[]; sql: string }> = [
  { python: "SQL_URLS_TENTADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_TENTADAS },
  { python: "SQL_URLS_LIDAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_LIDAS },
  { python: "SQL_URLS_REAPROVEITADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_REAPROVEITADAS },
  { python: "SQL_URLS_COM_FALHA", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_COM_FALHA },
  { python: "SQL_URLS_ENTRADA_DECLARADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_ENTRADA_DECLARADAS },
  { python: "SQL_URLS_ENTRADA_TENTADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_ENTRADA_TENTADAS },
  { python: "SQL_URLS_ENTRADA_NAO_TENTADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_URLS_ENTRADA_NAO_TENTADAS },
  { python: "SQL_REGISTROS_ELEGIVEIS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_REGISTROS_ELEGIVEIS },
  { python: "SQL_REGISTROS_ALCANCADOS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_REGISTROS_ALCANCADOS },
  { python: "SQL_REGISTROS_NAO_ALCANCADOS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_REGISTROS_NAO_ALCANCADOS },
  { python: "SQL_CAMPOS_COM_PROPOSTA", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_COM_PROPOSTA },
  { python: "SQL_CAMPOS_SITUACAO", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_SITUACAO },
  { python: "SQL_CAMPOS_CONFLITANTES", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_CONFLITANTES },
  { python: "SQL_CAMPOS_PENDENTES", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_PENDENTES },
  { python: "SQL_CAMPOS_SEM_PENDENCIA", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_SEM_PENDENCIA },
  { python: "SQL_CAMPOS_CONFIRMADOS_PELA_FONTE", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_CONFIRMADOS_PELA_FONTE },
  { python: "SQL_CAMPOS_CONFIRMADOS_POR_DECISAO", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_CAMPOS_CONFIRMADOS_POR_DECISAO },
  { python: "SQL_PENDENCIAS_REABERTAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_PENDENCIAS_REABERTAS },
  { python: "SQL_REGISTROS_COM_PROPOSTA", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_REGISTROS_COM_PROPOSTA },
  { python: "SQL_REGISTROS_ALTERADOS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_REGISTROS_ALTERADOS },
  { python: "SQL_PENDENCIAS_LIGADAS", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_PENDENCIAS_LIGADAS },
  { python: "SQL_DECISOES", arquivo: "etl/civico_etl/admin/relatorio.py", params: ["rodada"], sql: SQL_DECISOES },
  { python: "SQL_FILA", arquivo: "etl/civico_etl/admin/pendencias.py", params: ["classe", "limite"], sql: SQL_FILA },
];

// ============================================================================================================================
// PARTE 2: consultas PRÓPRIAS da central (não existem no ETL). Só leitura.
// ============================================================================================================================

const ORDEM_CLASSES_SQL = "array['vinculo_sapl', 'cobertura', 'contato_mandato', 'identidade']::text[]";

// Ficha = um registro de uma das quatro classes, pela chave estável, com o território resolvido pela MESMA regra de etl/civico_etl/admin/classes.py:
//   vinculo_sapl:    chave sapl_houses.id; lugar = places da casa (`_sapl_territorio`); rótulo de vinculos._rotulos
//   cobertura:       chave <ibge_code>:<dataset>; lugar = places da linha de data_coverage (`_cob_territorio`). Linha cujo lugar não tem ibge_code não tem chave: fica de fora (o ETL também não a endereça)
//   contato_mandato: chave mandates.id; lugar = places do mandato (`_contato_territorio`)
//   identidade:      chave identity_match_queue.id; NUNCA tem território (`_ident_territorio`): ibge_code e kind vêm nulos
// A tradução (ibge_code, kind) -> território (município, UF, país; outro kind ou ibge_code vazio = sem território) é de `_territorio_de` e fica em consultas.ts.
// Uma linha por classe+chave; duplicata de chave (mesmo ibge:dataset em dois lugares) é unificada, e o conflito apontado, por agregacao.ts.
// Nada aqui lê nome de pessoa, partido ou voto; as fontes vêm de adm_vinculos vigentes (só o slug).
const FICHAS_BASE = `select 'vinculo_sapl'::text as classe, h.id::text as chave,
         coalesce(b.name, 'casa sem órgão cadastrado') || ' · ' || p.name || '/' || coalesce(p.uf, '?') as rotulo, p.ibge_code, p.kind
  from sapl_houses h join places p on p.id = h.place_id left join legislative_bodies b on b.id = h.body_id
  union all
  select 'cobertura'::text, p.ibge_code || ':' || c.dataset,
         'cobertura ' || c.dataset || ' · ' || p.name || '/' || coalesce(p.uf, '?'), p.ibge_code, p.kind
  from data_coverage c join places p on p.id = c.place_id where p.ibge_code is not null
  union all
  select 'contato_mandato'::text, m.id::text,
         'mandato ' || o.slug || ' · ' || coalesce(b.name, 'casa não cadastrada') || ' · ' || p.name || '/' || coalesce(p.uf, '?'), p.ibge_code, p.kind
  from mandates m join offices o on o.id = m.office_id join places p on p.id = m.place_id left join legislative_bodies b on b.id = m.body_id
  union all
  select 'identidade'::text, q.id::text,
         'fila de identidade · ' || s.slug || ' · ' || q.external_id || ' (' || q.status || ')', null::text, null::text
  from identity_match_queue q join sources s on s.id = q.source_id`;

const FICHAS_COM_FONTES = (filtro: string): string => `select f.classe, f.chave, f.rotulo, f.ibge_code, f.kind, fo.fontes
from (${FICHAS_BASE}) f
left join lateral (select coalesce(array_agg(distinct v.fonte_slug order by v.fonte_slug) filter (where v.fonte_slug is not null), '{}'::text[]) as fontes
                   from adm_vinculos v where v.vigente and v.classe = f.classe and v.registro_chave = f.chave) fo on true
${filtro}order by array_position(${ORDEM_CLASSES_SQL}, f.classe), f.chave
`;

/** Todas as fichas das quatro classes (alimenta agregacao.ts). Sem parâmetro. Ordem fixa: classe, chave. */
export const SQL_FICHAS = FICHAS_COM_FONTES("");
/** Uma ficha pela classe ($1) e pela chave ($2). */
export const SQL_FICHA_BASE = FICHAS_COM_FONTES("where f.classe = $1::text and f.chave = $2::text\n");
/** Fichas de uma lista de pares: $1 = JSON `[{"classe": "...", "chave": "..."}]` (rótulo e território dos itens da fila, sem N consultas). */
export const SQL_FICHAS_POR_CHAVES = FICHAS_COM_FONTES(
  "where (f.classe, f.chave) in (select x.classe, x.chave from jsonb_to_recordset($1::text::jsonb) as x(classe text, chave text))\n",
);

// Propostas ligadas às pendências da fila ($1 = JSON `["uuid", ...]`). Mesma leitura de `_itens` em etl/civico_etl/admin/pendencias.py (consulta inline lá, constante aqui).
export const SQL_FILA_PROPOSTAS = `select pp.pendencia_id::text as pendencia_id, pr.id::text as id, pr.classe, pr.registro_chave, pr.campo, pr.valor_vigente, pr.valor_candidato,
       pr.url, pr.trecho, pr.bloco, pr.conteudo_sha256, pr.lida_em, pr.fonte_declarada_em, pr.fonte_slug, pr.rodada_id::text as rodada_id, pr.alcance, pr.regra_criterio, pr.regra_ids, pr.criada_em
from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id
where pp.pendencia_id in (select x::uuid from jsonb_array_elements_text($1::text::jsonb) as x)
order by pr.lida_em nulls first, pr.criada_em, pr.id
`;

// Valor vigente AGORA, por classe, lido da tabela de domínio (nunca da proposta): espelha `_sapl_vigente`, `_cob_vigente`, `_contato_vigente`, `_ident_vigente`.
export const SQL_VIGENTE_SAPL = `select h.base_url, h.status from sapl_houses h where h.id = $1::bigint
`;
export const SQL_VIGENTE_COBERTURA = `select c.status, c.reason, c.evidence_url from data_coverage c join places p on p.id = c.place_id where p.ibge_code = $1::text and c.dataset = $2::text
`;
export const SQL_VIGENTE_CONTATOS = `select kind, value from mandate_contacts where mandate_id = $1::uuid order by kind, value
`;
export const SQL_VIGENTE_IDENTIDADE = `select status from identity_match_queue where id = $1::uuid
`;

// Ficha com histórico: classe ($1) e chave ($2).
export const SQL_FICHA_PENDENCIAS = `select id::text as id, campo, tipo, pergunta, status, reaberta, motivo_reabertura, evidencia_sha, vigente_sha, vence_em, cobertura_recorte::float8 as cobertura_recorte, criada_em
from adm_pendencias where classe = $1::text and registro_chave = $2::text order by campo, id
`;
export const SQL_FICHA_PROPOSTAS = `select pr.id::text as id, pr.campo, pr.valor_vigente, pr.valor_candidato, pr.url, pr.trecho, pr.bloco, pr.conteudo_sha256, pr.lida_em, pr.fonte_declarada_em,
       pr.fonte_slug, pr.rodada_id::text as rodada_id, pr.alcance, pr.regra_criterio, pr.regra_ids, pr.criada_em,
       (select coalesce(array_agg(pp.pendencia_id::text order by pp.pendencia_id), '{}'::text[]) from adm_pendencia_propostas pp where pp.proposta_id = pr.id) as pendencias
from adm_propostas pr where pr.classe = $1::text and pr.registro_chave = $2::text
order by pr.campo, pr.lida_em nulls first, pr.criada_em, pr.id
`;
export const SQL_FICHA_DECISOES = `select d.id::text as id, d.pendencia_id::text as pendencia_id, p.campo, d.acao, d.decidido_por_tipo, d.decidido_por_nome, d.justificativa, d.valor, d.campos_afetados,
       d.aplicada, d.aplicada_em, d.criada_em
from adm_decisoes d join adm_pendencias p on p.id = d.pendencia_id
where p.classe = $1::text and p.registro_chave = $2::text order by d.criada_em, d.id
`;
export const SQL_FICHA_PARECERES = `select a.id::text as id, a.pendencia_id::text as pendencia_id, p.campo, a.modelo, a.versao_verificador, a.saida, a.modo, a.simulado, a.criada_em
from adm_pareceres a join adm_pendencias p on p.id = a.pendencia_id
where p.classe = $1::text and p.registro_chave = $2::text order by a.criada_em, a.id
`;
export const SQL_FICHA_PEDIDOS_DECISAO = `select pd.id::text as id, pd.pendencia_id::text as pendencia_id, p.campo, pd.acao, pd.por_nome, pd.justificativa, pd.valor, pd.aplicar, pd.status, pd.erro,
       pd.decisao_id::text as decisao_id, pd.criado_em, pd.finalizado_em
from adm_pedidos_decisao pd join adm_pendencias p on p.id = pd.pendencia_id
where p.classe = $1::text and p.registro_chave = $2::text order by pd.criado_em desc, pd.id
`;

// Rodadas. A lista traz as últimas $1 (inteiro). O cabeçalho ($1 = uuid) traz o que o relatório precisa: recorte, prévia congelada, status.
export const SQL_RODADAS = `select r.id::text as id, r.coletor, r.modo, r.status, r.so_pendencias, r.repete_id::text as repete_id, r.iniciada_em, r.finalizada_em,
       (select count(*) from adm_tentativas t where t.rodada_id = r.id)::int as tentativas
from adm_rodadas r order by r.iniciada_em desc, r.id limit $1::int
`;
export const SQL_RODADA = `select r.id::text as id, r.coletor, r.modo, r.argv, r.recorte, r.previa, r.status, r.so_pendencias, r.forcar_urls, r.repete_id::text as repete_id, r.invocation,
       r.iniciada_em, r.finalizada_em
from adm_rodadas r where r.id = $1::uuid
`;
/** Pedidos (da fila da tela) ligados a uma rodada ($1 = uuid): andamento e erro do executor. */
export const SQL_RODADA_PEDIDOS = `select id::text as id, tipo, status, criado_em, iniciado_em, batimento_em, finalizado_em, andamento, erro from adm_pedidos where rodada_id = $1::uuid order by criado_em, id
`;

// Estado do executor, o que a tela consulta a cada 5 s. As idades vêm do relógio do BANCO (now()), não do navegador.
// Parado (plano, seção 4a): pedido na_fila há mais de 60 s, ou em_execucao com batimento mais velho que 120 s. A regra fica em consultas.ts.
export const SQL_EXECUTOR_ESTADO = `select count(*) filter (where status = 'na_fila')::int as na_fila,
       count(*) filter (where status = 'em_execucao')::int as em_execucao,
       extract(epoch from now() - min(criado_em) filter (where status = 'na_fila'))::float8 as fila_mais_antiga_s,
       extract(epoch from now() - min(coalesce(batimento_em, iniciado_em)) filter (where status = 'em_execucao'))::float8 as batimento_mais_antigo_s,
       extract(epoch from now() - max(batimento_em) filter (where status = 'em_execucao'))::float8 as ultimo_batimento_s,
       now() as agora
from (select status, criado_em, iniciado_em, batimento_em from adm_pedidos
      union all select status, criado_em, iniciado_em, batimento_em from adm_pedidos_decisao) p
`;
/** Pedidos mais recentes das duas filas, $1 = limite. */
export const SQL_PEDIDOS_RECENTES = `select origem, id, tipo, status, criado_em, iniciado_em, batimento_em, finalizado_em, rodada_id, andamento, erro
from (select 'pedido'::text as origem, id::text as id, tipo, status, criado_em, iniciado_em, batimento_em, finalizado_em, rodada_id::text as rodada_id, andamento, erro from adm_pedidos
      union all
      select 'decisao'::text, id::text, acao, status, criado_em, iniciado_em, batimento_em, finalizado_em, null::text, null::jsonb, erro from adm_pedidos_decisao) p
order by criado_em desc, id limit $1::int
`;
/** Rodadas ainda não terminadas (aberta, em_andamento). */
export const SQL_RODADAS_EM_CURSO = `select id::text as id, coletor, modo, status, iniciada_em from adm_rodadas where status in ('aberta', 'em_andamento') order by iniciada_em desc, id
`;
/** Pendências abertas por classe (contagem, não ordem; a ordem da fila é SQL_FILA). */
export const SQL_PENDENCIAS_ABERTAS_POR_CLASSE = `select classe, count(*)::int as total from adm_pendencias where status = 'aberta' group by classe
`;

// ============================================================================================================================
// PARTE 3: pedidos. A ÚNICA escrita da central. `insert ... where not exists` e, se o segundo pedido igual chegou antes de o primeiro sair da fila, `select` do existente
// (o role não tem `update`; a corrida entre dois insert simultâneos cai no índice único parcial: o chamador trata o erro 23505 e lê o existente).
// ============================================================================================================================

/** $1 tipo, $2 parametros (JSON), $3 chave_idem. Devolve o id novo, ou nenhuma linha se já há pedido ativo com a chave. */
export const SQL_PEDIDO_INSERIR = `insert into adm_pedidos (tipo, parametros, chave_idem)
select $1::text, $2::text::jsonb, $3::text
where not exists (select 1 from adm_pedidos where chave_idem = $3::text and status in ('na_fila', 'em_execucao'))
returning id::text as id
`;
/** $1 chave_idem. O pedido ativo (na_fila ou em_execucao) com a chave. */
export const SQL_PEDIDO_EXISTENTE = `select id::text as id from adm_pedidos where chave_idem = $1::text and status in ('na_fila', 'em_execucao') order by criado_em desc, id limit 1
`;
/** $1 pendencia_id, $2 acao, $3 por_nome, $4 justificativa, $5 valor (JSON ou nulo), $6 aplicar, $7 chave_idem. */
export const SQL_PEDIDO_DECISAO_INSERIR = `insert into adm_pedidos_decisao (pendencia_id, acao, por_nome, justificativa, valor, aplicar, chave_idem)
select $1::uuid, $2::text, $3::text, $4::text, $5::text::jsonb, $6::boolean, $7::text
where not exists (select 1 from adm_pedidos_decisao where chave_idem = $7::text and status in ('na_fila', 'em_execucao'))
returning id::text as id
`;
/** $1 chave_idem. */
export const SQL_PEDIDO_DECISAO_EXISTENTE = `select id::text as id from adm_pedidos_decisao where chave_idem = $1::text and status in ('na_fila', 'em_execucao') order by criado_em desc, id limit 1
`;

/** Toda consulta própria da central (parte 2 e 3), para o teste conferir que nenhuma escreve fora dos dois pedidos. As copiadas estão em COPIADAS_DO_ETL. */
export const CONSULTAS_PROPRIAS: Readonly<Record<string, string>> = {
  SQL_FICHAS, SQL_FICHA_BASE, SQL_FICHAS_POR_CHAVES, SQL_FILA_PROPOSTAS, SQL_VIGENTE_SAPL, SQL_VIGENTE_COBERTURA, SQL_VIGENTE_CONTATOS, SQL_VIGENTE_IDENTIDADE,
  SQL_FICHA_PENDENCIAS, SQL_FICHA_PROPOSTAS, SQL_FICHA_DECISOES, SQL_FICHA_PARECERES, SQL_FICHA_PEDIDOS_DECISAO, SQL_RODADAS, SQL_RODADA, SQL_RODADA_PEDIDOS, SQL_EXECUTOR_ESTADO,
  SQL_PEDIDOS_RECENTES, SQL_RODADAS_EM_CURSO, SQL_PENDENCIAS_ABERTAS_POR_CLASSE, SQL_PEDIDO_INSERIR, SQL_PEDIDO_EXISTENTE, SQL_PEDIDO_DECISAO_INSERIR, SQL_PEDIDO_DECISAO_EXISTENTE,
};

// ============================================================================================================================
// PARTE 4: validação do pedido (pura). A tela nunca passa argv: o pedido leva só parâmetros estruturados e pequenos, que o EXECUTOR
// valida de novo contra o catálogo (plano, seção 4a). Aqui se recusa o que não tem a forma; o que passa sai NORMALIZADO (listas ordenadas e sem
// repetição, uuid em minúsculas), porque a `chave_idem` é calculada sobre os parâmetros normalizados.
// Forma dos parâmetros: a de `executor.normalizar` (etl/civico_etl/admin/executor.py), saída idêntica byte a byte para a chave bater:
//   rodada:  { coletor, modo?, recorte?: { anos?, ufs?, casas?, ibges?, extras? } } -> { coletor, modo (padrão recoletar), recorte: { anos, ufs, casas, ibges, extras } }
//            ou { repetir, so_pendencias? } -> { repetir, so_pendencias (padrão false) }
//   recoleta:{ classe, territorio: { ibge, nivel: "municipio" | "uf" | "pais" } }   (os dois obrigatórios; identidade não tem território)
//   parecer: { pendencia_id } OU { rodada_id }
// ============================================================================================================================

/** Pedido inválido: a mensagem é do domínio (nunca detalhe técnico) e pode ir para a tela. */
export class ErroPedidoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPedidoInvalido";
  }
}

export const TIPOS_PEDIDO = ["rodada", "recoleta", "parecer"] as const;
export type TipoPedido = (typeof TIPOS_PEDIDO)[number];
export const MODOS_RODADA = ["descobrir", "recoletar", "reprocessar"] as const;
export const ACOES_DECISAO = ["aprovar", "corrigir", "descartar", "pedir_confirmacao"] as const;
export type AcaoDecisao = (typeof ACOES_DECISAO)[number];
const CLASSES_VALIDAS: readonly string[] = ["vinculo_sapl", "cobertura", "contato_mandato", "identidade"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

const invalido = (m: string): never => {
  throw new ErroPedidoInvalido(m);
};
const objeto = (x: unknown, onde: string): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : invalido(`${onde} tem de ser um objeto`);
const soChaves = (o: Record<string, unknown>, permitidas: readonly string[], onde: string): void => {
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) invalido(`${onde}: campo não aceito: ${k}`);
};
const texto = (x: unknown, nome: string, max: number, padrao?: RegExp): string => {
  if (typeof x !== "string" || x.trim() === "" || x !== x.trim() || x.length > max) return invalido(`${nome} tem de ser texto não vazio, sem espaço nas pontas, de até ${max} caracteres`);
  if (padrao && !padrao.test(x)) return invalido(`${nome} fora do formato`);
  return x;
};
const lista = <T extends string | number>(x: unknown, nome: string, max: number, item: (v: unknown) => T): T[] => {
  if (!Array.isArray(x) || x.length > max) return invalido(`${nome} tem de ser uma lista de até ${max} itens`);
  return [...new Set(x.map(item))].sort() as T[];
};

export function validarPedido(tipo: unknown, parametros: unknown): { tipo: TipoPedido; parametros: Record<string, unknown> } {
  if (typeof tipo !== "string" || !(TIPOS_PEDIDO as readonly string[]).includes(tipo)) return invalido("tipo de pedido inválido (esperado rodada, recoleta ou parecer)");
  const p = objeto(parametros ?? {}, "parametros");
  const out: Record<string, unknown> = {};
  if (tipo === "rodada") {
    soChaves(p, ["coletor", "modo", "recorte", "repetir", "so_pendencias"], "rodada");
    if (p.repetir !== undefined) {
      if (p.coletor !== undefined || p.recorte !== undefined || p.modo !== undefined) invalido("repetir não se combina com coletor, modo nem recorte");
      out.repetir = ehUuid(p.repetir) ? p.repetir.toLowerCase() : invalido("repetir tem de ser o uuid de uma rodada");
      if (p.so_pendencias !== undefined && typeof p.so_pendencias !== "boolean") invalido("so_pendencias tem de ser verdadeiro ou falso");
      out.so_pendencias = p.so_pendencias === true;
    } else {
      if (p.so_pendencias !== undefined) invalido("so_pendencias só vale com repetir");
      out.coletor = texto(p.coletor, "coletor", 80, /^[A-Za-z0-9_.-]+$/);
      const modo = p.modo === undefined ? "recoletar" : p.modo;
      if (!(MODOS_RODADA as readonly unknown[]).includes(modo)) invalido("modo inválido (esperado descobrir, recoletar ou reprocessar)");
      out.modo = modo;
      const r = objeto(p.recorte ?? {}, "recorte");
      soChaves(r, ["anos", "ufs", "casas", "ibges", "extras"], "recorte");
      const anos = lista(r.anos ?? [], "anos", 20, (v) => (Number.isInteger(v) && (v as number) >= 1900 && (v as number) <= 2100 ? (v as number) : invalido("ano fora de 1900..2100")));
      anos.sort((x, y) => x - y);
      const extras = objeto(r.extras ?? {}, "extras");
      if (Object.keys(extras).length > 20) invalido("extras: no máximo 20 itens");
      out.recorte = {
        anos,
        ufs: lista(r.ufs ?? [], "ufs", 27, (v) => texto(v, "uf", 2, /^[A-Z]{2}$/)),
        casas: lista(r.casas ?? [], "casas", 50, (v) => texto(v, "casa", 80)),
        ibges: lista(r.ibges ?? [], "ibges", 100, (v) => texto(v, "ibge", 7, /^\d{7}$/)),
        extras: Object.fromEntries(Object.keys(extras).sort().map((k) => [texto(k, "chave de extras", 40, /^[A-Za-z0-9_]+$/), texto(extras[k], `extras.${k}`, 200)])),
      };
    }
  } else if (tipo === "recoleta") {
    soChaves(p, ["classe", "territorio"], "recoleta");
    out.classe = typeof p.classe === "string" && CLASSES_VALIDAS.includes(p.classe) ? p.classe : invalido("classe inválida");
    if (p.classe === "identidade") invalido("identidade não tem território: não há recoleta por território para ela");
    const t = objeto(p.territorio, "territorio");
    soChaves(t, ["nivel", "ibge"], "territorio");
    if (t.nivel !== "uf" && t.nivel !== "municipio" && t.nivel !== "pais") invalido("nivel do território inválido (esperado municipio, uf ou pais)");
    const ibge = texto(t.ibge, "ibge", 7, /^[A-Za-z0-9]+$/);
    if (t.nivel === "uf" && ibge.length !== 2) invalido("ibge de UF tem 2 dígitos");
    if (t.nivel === "municipio" && ibge.length !== 7) invalido("ibge de município tem 7 dígitos");
    out.territorio = { ibge, nivel: t.nivel };
  } else {
    soChaves(p, ["pendencia_id", "rodada_id"], "parecer");
    if ((p.pendencia_id === undefined) === (p.rodada_id === undefined)) invalido("parecer exige pendencia_id ou rodada_id (um só)");
    const k = p.pendencia_id !== undefined ? "pendencia_id" : "rodada_id";
    out[k] = ehUuid(p[k]) ? (p[k] as string).toLowerCase() : invalido(`${k} tem de ser um uuid`);
  }
  return { tipo: tipo as TipoPedido, parametros: out };
}

export type DecisaoValidada = { pendencia_id: string; acao: AcaoDecisao; por_nome: string; justificativa: string; valor: unknown; aplicar: boolean };

/** Corpo de POST /admin/api/decisoes: { pendencia_id, acao, por, justificativa, valor?, aplicar? }. `por` e `justificativa` não vazios. */
export function validarDecisao(corpo: unknown): DecisaoValidada {
  const c = objeto(corpo, "corpo");
  soChaves(c, ["pendencia_id", "acao", "por", "justificativa", "valor", "aplicar"], "decisão");
  if (!ehUuid(c.pendencia_id)) invalido("pendencia_id tem de ser um uuid");
  if (typeof c.acao !== "string" || !(ACOES_DECISAO as readonly string[]).includes(c.acao)) return invalido("acao inválida (esperado aprovar, corrigir, descartar ou pedir_confirmacao)");
  const acao = c.acao as AcaoDecisao;
  if (typeof c.por !== "string" || c.por.trim() === "") invalido("informe quem decide (por)");
  if (typeof c.justificativa !== "string" || c.justificativa.trim() === "") invalido("a justificativa é obrigatória");
  const por_nome = (c.por as string).trim();
  const justificativa = (c.justificativa as string).trim();
  if (por_nome.length > 120) invalido("por: no máximo 120 caracteres");
  if (justificativa.length > 4000) invalido("justificativa: no máximo 4000 caracteres");
  if (acao === "corrigir" && c.valor === undefined) invalido("corrigir exige o valor");
  if (c.valor !== undefined && jsonCanonico(c.valor).length > 8000) invalido("valor grande demais");
  if (c.aplicar !== undefined && typeof c.aplicar !== "boolean") invalido("aplicar tem de ser verdadeiro ou falso");
  if (c.aplicar === true && acao !== "aprovar" && acao !== "corrigir") invalido("só aprovar e corrigir se aplicam");
  return { pendencia_id: (c.pendencia_id as string).toLowerCase(), acao, por_nome, justificativa, valor: c.valor, aplicar: c.aplicar === true };
}
