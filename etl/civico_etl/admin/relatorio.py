"""Relatório de uma rodada de coleta (A6): `civico-etl admin relatorio ID [--json] [--ids]`.

Dois painéis, dois objetos de primeiro nível (`coleta` e `revisao`), NUNCA somados: uma leitura 100% bem-sucedida pode deixar todos os campos
pendentes, e o documento mostra os dois lados sem nenhum número que os una. A central web (fase posterior) lê ESTES números: o critério 19 exige
que o painel dela seja igual ao desta CLI para a mesma rodada. Por isso cada total é UMA consulta SQL nomeada (constantes `SQL_*` abaixo), que
recebe o parâmetro nomeado `%(rodada)s` (uuid, em texto) e devolve as linhas que compõem o total; o Python só conta, ordena os identificadores e
monta o objeto. As consultas não dependem de `search_path` (tabelas do schema padrão) nem de recurso exclusivo do psycopg além do `%(nome)s`.

Todo total é `{"valor": N, "de": D, "ids": [...]}` (a lista inteira vai no JSON). Valor que não se calcula é `null` com `motivo`; denominador
desconhecido é `null` com `motivo_de`; nunca zero no lugar de desconhecido. Identificadores: URL = `{"url_sha": ..., "url": ...}`; registro =
`classe:registro_chave`; campo = `classe:registro_chave:campo`; decisão = o id (uuid). Nenhuma lista é ordenada por pessoa ou partido (nem existe
coluna que permita): URLs por `url_sha`, registros e campos por classe e chave.

PAINEL COLETA (`adm_rodadas`, `adm_tentativas` e `adm_vinculos`; não lê nada da revisão. ÚNICA exceção: a resolução da chave de um elegível sem chave
na prévia lê `sapl_houses` e `places`, tabelas de domínio, não de revisão: `registros_elegiveis` e `registros_alcancados` mudam se essas tabelas mudam)
- `urls_tentadas`: URLs distintas (`url_sha`) em `adm_tentativas` da rodada. Denominador (de = valor) dos três seguintes.
- `urls_lidas` / `urls_reaproveitadas` / `urls_com_falha`: URLs distintas cuja ÚLTIMA tentativa na rodada tem `resultado` = lida / reaproveitada /
  falha (a última é a de maior `tentada_em`). Disjuntas: somam `urls_tentadas`; se não somarem, o relatório levanta `ErroAdmin`. `urls_com_falha`
  traz `por_motivo` (bloqueio, robots, expiracao, erro, sem_conteudo; cada um com de = urls_com_falha).
- `urls_entrada.declaradas`: URLs de entrada FIRMES da prévia congelada (`previa.urls_entrada` sem `condicional`; `previa.n_urls_entrada`).
  `.tentadas`: URLs distintas com `entrada = true` na rodada (de = declaradas; pode passar de `declaradas` se houve entrada condicional).
  `.declaradas_nao_tentadas`: declaradas sem tentativa de entrada na rodada.
- `registros_elegiveis`: a lista de chaves da prévia (`previa.registros_elegiveis`). Chave nula na prévia (casa ainda não registrada na abertura)
  resolve-se, na hora da leitura, pela UF ou IBGE do item em `sapl_houses`; se ainda não existe, o item fica sem chave (`classe:~sem_registro(rotulo)`).
- `registros_alcancados`: elegível que traz `url` PRÓPRIA na prévia (contato_mandato: o documento que o job lê para o mandato) é ALCANÇADO quando a ÚLTIMA tentativa dessa URL
  na rodada é `lida` ou `reaproveitada`; senão traz o motivo da última falha dela, ou "URL do registro não tentada nesta rodada". Elegível SEM `url` (SAPL): um registro é ALCANÇADO quando existe na rodada uma URL cuja ÚLTIMA tentativa é `lida` ou `reaproveitada` e que (a) é igual
  à URL de um vínculo VIGENTE do registro, ou (b) começa com a URL do vínculo (normalizada sem barra final) seguida de `/`; fica de fora a URL cujo caminho é
  `/robots.txt` (ler só o robots.txt não é alcançar o registro). Restrito aos elegíveis quando a prévia tem a lista (de = `registros_elegiveis`); sem lista,
  de = null com `motivo_de` e nada é restrito. `registros_elegiveis_nao_alcancados` lista os demais, cada um com `situacao` e `motivo_falha` (motivo da
  última falha entre as URLs dele na rodada que casam pela mesma regra; PI -> robots, PB -> erro na rodada v1).
- coletor com `tentativas_registradas = False` (ou fora do catálogo): todo total de URL e de alcance sai `null` com o motivo.

PAINEL REVISÃO (só `adm_propostas`, `adm_pendencias`, `adm_pendencia_propostas`, `adm_decisoes`; não lê nada da coleta)
- unidade: o CAMPO (`classe`, `registro_chave`, `campo`). `campos_com_proposta`: campos com ao menos uma proposta com `rodada_id` = rodada
  (denominador dos três seguintes). Cada campo cai em EXATAMENTE uma situação, nesta ordem (há no máximo uma pendência por campo: unique da tabela):
  1. `conflitantes`: pendência `aberta` do tipo `divergencia`;
  2. `pendentes`: pendência `aberta` de outro tipo (mudanca, duplicata, confirmacao); ENTRAM TAMBÉM aqui (submotivo `sem_pendencia_aberta`) os campos sem
     nenhuma pendência cuja proposta da rodada não confirma o vigente (candidato diferente do vigente, ou vigente nulo): nada decidiu nem
     confirmou, e chamá-los de confirmados seria afirmar sem base (restrição 6);
  3. `confirmados`: o resto, em dois sub-totais: `pela_fonte` (sem pendência; TODAS as propostas da rodada têm candidato igual ao vigente, e o vigente
     não é nulo) e `por_decisao` (a pendência do campo está `decidida`, qualquer que tenha sido a ação, inclusive descartar).
  As três somam `campos_com_proposta`; se não somarem, `ErroAdmin`.
- `pendencias_reabertas`: dos conflitantes e pendentes, os com `reaberta = true` (de = conflitantes + pendentes), com `por_motivo`.
- `registros_alterados` (rótulo em tabela: "registros com decisão aplicada (aprovar ou corrigir)"): registros com ao menos uma decisão `aprovar` ou `corrigir` com `aplicada = true`,
  ligada (por `adm_pendencia_propostas`) a proposta da rodada; de = registros distintos com proposta na rodada. NÃO quer dizer "registros cujo valor na tabela mudou": inclui aprovar
  uma mudança que o job JÁ gravou (o valor da tabela não troca, mas a decisão grava override e FIXA o valor; AC-17). A chave do JSON continua `registros_alterados`.
- `decisoes`: decisões ligadas a propostas da rodada (de = pendências ligadas a propostas da rodada: são unidades diferentes, o `de` só diz sobre
  quantas pendências elas incidem), com `por_acao`, `por_decidido_por_tipo`, `aplicadas` e `nao_aplicadas` (cada fatia com de = decisões).
- rodada sem proposta: tudo 0 de 0 e `mensagem` = "nenhuma proposta registrada nesta rodada" (zero conhecido, não desconhecido).

`simulado`: o lançador `etl/tests/simulado.py` define `ADMIN_SIMULADO=<cenário>`; `rodadas.executar` grava o valor em `previa.resultado.simulado` (nulo se a
variável não existe ou é vazia). O relatório lê a marca do resultado GRAVADO na rodada, nunca do ambiente de quem consulta; rodada sem o campo -> `simulado: null`.
Com marca, a tabela começa com "SIMULADO: respostas fabricadas (cenário <nome>); nenhum número abaixo foi lido da fonte" e o JSON traz `simulado` no primeiro nível.

Limite conhecido: as consultas rodam em sequência na mesma transação (READ COMMITTED); numa rodada ainda em andamento os totais podem refletir
instantes diferentes e a verificação de soma pode acusar erro. O relatório é para rodada terminada.
"""

from __future__ import annotations

from typing import Any

from ..catalogo import coletor as _coletor_do_catalogo
from .rodadas import _carregar
from .saida import ErroAdmin, lista_chave_valor

LIMITE_TEXTO = 20
SEM_TENTATIVAS = "tentativas não registradas para este coletor"
SEM_PROPOSTA = "nenhuma proposta registrada nesta rodada"
MOTIVOS_FALHA = ("bloqueio", "robots", "expiracao", "erro", "sem_conteudo")


def _com(ctes: tuple[str, ...], final: str) -> str:
    return "with " + ",\n".join(ctes) + "\n" + final.strip() + "\n"


# ---------------------------------------------------------------------------------------------------------------------------- coleta: fragmentos

# CTE `ultima`: uma linha por URL (url_sha) da rodada, a da última tentativa (maior tentada_em; id desempata) com resultado, motivo, entrada e host.
_ULTIMA = r"""ultima as (
  select distinct on (t.url_sha) t.url_sha, t.url, t.host, t.resultado, t.motivo, t.entrada, t.tentada_em
  from adm_tentativas t where t.rodada_id = %(rodada)s::uuid
  order by t.url_sha, t.tentada_em desc, t.id desc)"""

# CTE `declaradas`: URLs de entrada firmes da prévia congelada da rodada (sem `condicional`), com o sha calculado como `util.sha256_text` (sha256 hex de UTF-8).
_DECLARADAS = r"""declaradas as (
  select distinct encode(sha256(convert_to(x.item->>'url', 'UTF8')), 'hex') as url_sha, x.item->>'url' as url
  from adm_rodadas r
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.previa->'urls_entrada') = 'array' then r.previa->'urls_entrada' else '[]'::jsonb end) as x(item)
  where r.id = %(rodada)s::uuid and coalesce(jsonb_typeof(x.item->'condicional'), 'null') = 'null')"""

# CTE `elegiveis`: uma linha por chave da lista `previa.registros_elegiveis.chaves` (nenhuma se a prévia não tem a lista: valor nulo). `url` = a URL PRÓPRIA do registro, quando a prévia a traz
# (contato_mandato: o documento que o job lê para o mandato). `registro_chave` = `sapl_houses_id` ou `mandate_id` da prévia ou, se nulo, a casa de `sapl_houses` da UF (`uf`) ou do município (`ibge`) do item; nulo se ela ainda não existe.
_ELEGIVEIS = r"""elegiveis as (
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
  where r.id = %(rodada)s::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number')"""

# CTE `casam`: pares (vínculo VIGENTE, última tentativa da URL na rodada) em que a URL é igual à do vínculo ou começa com a URL do vínculo (sem barra final) seguida
# de `/`; a URL cujo caminho (sem a query) é `/robots.txt` fica de fora (ler só o robots.txt não é alcançar o registro). Comparação por `left`, sem `like`.
_CASAM = r"""casam as (
  select v.classe, v.registro_chave, u.url_sha, u.url, u.resultado, u.motivo, u.tentada_em
  from adm_vinculos v
  join ultima u on u.url = v.url or left(u.url, length(rtrim(v.url, '/')) + 1) = rtrim(v.url, '/') || '/'
  where v.vigente and split_part(regexp_replace(u.url, '^[A-Za-z]+://[^/]+', ''), '?', 1) <> '/robots.txt')"""

# CTE `alcancados`: (1) elegível que traz `url` própria: alcançado se a ÚLTIMA tentativa dessa URL na rodada é lida ou reaproveitada; (2) os demais (sem `url`, ex.: SAPL): registros com ao menos
# uma URL casada pelo vínculo cuja última tentativa foi lida ou reaproveitada; restritos aos elegíveis quando a prévia tem a lista.
_ALCANCADOS = r"""alcancados as (
  select distinct c.classe, c.registro_chave
  from casam c
  where c.resultado in ('lida', 'reaproveitada')
    and (not exists (select 1 from adm_rodadas r where r.id = %(rodada)s::uuid and jsonb_typeof(r.previa->'registros_elegiveis'->'valor') = 'number')
         or exists (select 1 from elegiveis e where e.classe = c.classe and e.registro_chave = c.registro_chave and e.url is null))
  union
  select e.classe, e.registro_chave
  from elegiveis e join ultima u on u.url_sha = e.url_sha
  where e.url is not null and u.resultado in ('lida', 'reaproveitada'))"""

# ---------------------------------------------------------------------------------------------------------------------------- coleta: totais

# URLs distintas tentadas na rodada (url_sha, url). Denominador dos três seguintes.
SQL_URLS_TENTADAS = _com((_ULTIMA,), "select url_sha, url from ultima order by url_sha")
# URLs cuja última tentativa na rodada foi `lida`.
SQL_URLS_LIDAS = _com((_ULTIMA,), "select url_sha, url from ultima where resultado = 'lida' order by url_sha")
# URLs cuja última tentativa na rodada foi `reaproveitada` (veio do cache).
SQL_URLS_REAPROVEITADAS = _com((_ULTIMA,), "select url_sha, url from ultima where resultado = 'reaproveitada' order by url_sha")
# URLs cuja última tentativa na rodada foi `falha`, com o motivo (bloqueio, robots, expiracao, erro, sem_conteudo).
SQL_URLS_COM_FALHA = _com((_ULTIMA,), "select url_sha, url, motivo from ultima where resultado = 'falha' order by url_sha")
# URLs de entrada FIRMES declaradas na prévia congelada da rodada (url_sha calculado no SQL).
SQL_URLS_ENTRADA_DECLARADAS = _com((_DECLARADAS,), "select url_sha, url from declaradas order by url_sha")
# URLs distintas tentadas com `entrada = true` na rodada.
SQL_URLS_ENTRADA_TENTADAS = (
    "select distinct on (t.url_sha) t.url_sha, t.url from adm_tentativas t where t.rodada_id = %(rodada)s::uuid and t.entrada order by t.url_sha, t.tentada_em desc, t.id desc\n")
# URLs de entrada declaradas sem nenhuma tentativa de entrada na rodada.
SQL_URLS_ENTRADA_NAO_TENTADAS = _com((_DECLARADAS,), """select d.url_sha, d.url from declaradas d
where not exists (select 1 from adm_tentativas t where t.rodada_id = %(rodada)s::uuid and t.entrada and t.url_sha = d.url_sha) order by d.url_sha""")
# Registros elegíveis da prévia (classe, registro_chave resolvido ou nulo, rotulo). Vazio se a prévia não tem a lista.
SQL_REGISTROS_ELEGIVEIS = _com((_ELEGIVEIS,), "select classe, registro_chave, rotulo from elegiveis order by classe, registro_chave nulls last, rotulo")
# Registros alcançados: vínculo vigente cuja URL teve última tentativa lida/reaproveitada na rodada (restrito aos elegíveis quando há lista).
SQL_REGISTROS_ALCANCADOS = _com((_ULTIMA, _ELEGIVEIS, _CASAM, _ALCANCADOS), "select classe, registro_chave from alcancados order by classe, registro_chave")
# Elegíveis NÃO alcançados, com a situação e o motivo da última falha entre as URLs do registro na rodada que casam pela mesma regra (se houver).
SQL_REGISTROS_NAO_ALCANCADOS = _com((_ULTIMA, _ELEGIVEIS, _CASAM, _ALCANCADOS), r"""select e.classe, e.registro_chave, e.rotulo,
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
order by e.classe, e.registro_chave nulls last, e.rotulo""")

# ---------------------------------------------------------------------------------------------------------------------------- revisão: fragmentos

# CTE `campos`: campos distintos com proposta da rodada. CTE `sit`: um por campo, com a situação (conflitante | pendente | confirmado), a origem
# (pendencia_aberta | sem_pendencia_aberta | pela_fonte | por_decisao) e, se há pendência, `reaberta` e `motivo_reabertura`. No máximo uma pendência por
# campo (unique classe, registro_chave, campo).
_CAMPOS = r"""campos as (
  select distinct classe, registro_chave, campo from adm_propostas where rodada_id = %(rodada)s::uuid)"""
_SIT = r"""sit as (
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
                                          where q.rodada_id = %(rodada)s::uuid and q.classe = c.classe and q.registro_chave = c.registro_chave and q.campo = c.campo
                                            and (q.valor_vigente is null or q.valor_candidato is distinct from q.valor_vigente)) as confirma) f)"""

# ---------------------------------------------------------------------------------------------------------------------------- revisão: totais

_CAMPO_COLS = "select classe, registro_chave, campo from sit"
# Campos distintos com ao menos uma proposta da rodada. Denominador dos três seguintes.
SQL_CAMPOS_COM_PROPOSTA = _com((_CAMPOS,), "select classe, registro_chave, campo from campos order by classe, registro_chave, campo")
# Todos os campos com proposta da rodada e a situação de cada um (conflitante | pendente | confirmado), a origem e a reabertura.
SQL_CAMPOS_SITUACAO = _com((_CAMPOS, _SIT), "select classe, registro_chave, campo, situacao, origem, reaberta, motivo_reabertura from sit order by classe, registro_chave, campo")
# Campos conflitantes: pendência aberta do tipo divergencia.
SQL_CAMPOS_CONFLITANTES = _com((_CAMPOS, _SIT), _CAMPO_COLS + " where situacao = 'conflitante' order by classe, registro_chave, campo")
# Campos pendentes: pendência aberta de outro tipo, ou sem pendência e sem confirmação do vigente pela fonte.
SQL_CAMPOS_PENDENTES = _com((_CAMPOS, _SIT), _CAMPO_COLS + " where situacao = 'pendente' order by classe, registro_chave, campo")
# Subconjunto de pendentes: sem nenhuma pendência e com proposta que não confirma o vigente (submotivo `sem_pendencia_aberta`).
SQL_CAMPOS_SEM_PENDENCIA = _com((_CAMPOS, _SIT), _CAMPO_COLS + " where origem = 'sem_pendencia_aberta' order by classe, registro_chave, campo")
# Campos confirmados pela fonte: sem pendência e todas as propostas da rodada com candidato igual ao vigente (não nulo).
SQL_CAMPOS_CONFIRMADOS_PELA_FONTE = _com((_CAMPOS, _SIT), _CAMPO_COLS + " where origem = 'pela_fonte' order by classe, registro_chave, campo")
# Campos confirmados por decisão: a pendência do campo está decidida.
SQL_CAMPOS_CONFIRMADOS_POR_DECISAO = _com((_CAMPOS, _SIT), _CAMPO_COLS + " where origem = 'por_decisao' order by classe, registro_chave, campo")
# Campos conflitantes ou pendentes cuja pendência é reaberta, com o motivo da reabertura.
SQL_PENDENCIAS_REABERTAS = _com((_CAMPOS, _SIT), "select classe, registro_chave, campo, motivo_reabertura from sit where situacao in ('conflitante', 'pendente') and reaberta order by classe, registro_chave, campo")
# Registros distintos (classe, registro_chave) com proposta da rodada. Denominador de registros_alterados.
SQL_REGISTROS_COM_PROPOSTA = "select distinct classe, registro_chave from adm_propostas where rodada_id = %(rodada)s::uuid order by classe, registro_chave\n"
# Registros com decisão aprovar/corrigir aplicada ligada a proposta da rodada.
SQL_REGISTROS_ALTERADOS = r"""select distinct pr.classe, pr.registro_chave
from adm_decisoes d
join adm_pendencia_propostas pp on pp.pendencia_id = d.pendencia_id
join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = %(rodada)s::uuid
where d.acao in ('aprovar', 'corrigir') and d.aplicada
order by pr.classe, pr.registro_chave
"""
# Pendências ligadas a propostas da rodada (denominador de `decisoes`).
SQL_PENDENCIAS_LIGADAS = r"""select distinct pp.pendencia_id::text as id
from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = %(rodada)s::uuid
order by 1
"""
# Decisões ligadas (por adm_pendencia_propostas) a propostas da rodada: id, acao, decidido_por_tipo, aplicada.
SQL_DECISOES = r"""select d.id::text as id, d.acao, d.decidido_por_tipo, d.aplicada
from adm_decisoes d
where exists (select 1 from adm_pendencia_propostas pp join adm_propostas pr on pr.id = pp.proposta_id and pr.rodada_id = %(rodada)s::uuid where pp.pendencia_id = d.pendencia_id)
order by d.id::text
"""

CONSULTAS = {k: v for k, v in sorted(globals().items()) if k.startswith("SQL_")}


# ---------------------------------------------------------------------------------------------------------------------------- montagem


def _rows(conn: Any, sql: str, rid: str) -> list[dict[str, Any]]:
    return conn.execute(sql, {"rodada": rid}).fetchall()


def _total(ids: list[Any], de: int | None, **extra: Any) -> dict[str, Any]:
    return {"valor": len(ids), "de": de, "ids": ids, **extra}


def _nulo(motivo: str) -> dict[str, Any]:
    return {"valor": None, "de": None, "ids": None, "motivo": motivo}


def _urls(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    return sorted(({"url_sha": r["url_sha"], "url": r["url"]} for r in rows), key=lambda x: x["url_sha"])


def _reg(r: dict[str, Any]) -> str:
    return f"{r['classe']}:{r['registro_chave']}" if r["registro_chave"] is not None else f"{r['classe']}:~sem_registro({r['rotulo']})"


def _campo(r: dict[str, Any]) -> str:
    return f"{r['classe']}:{r['registro_chave']}:{r['campo']}"


def _tentativas_registradas(coletor_id: str) -> tuple[bool | None, str | None]:
    try:
        return bool(_coletor_do_catalogo(coletor_id).tentativas_registradas), None
    except KeyError:
        return None, f"coletor {coletor_id!r} fora do catálogo: não se sabe se registra tentativas"


def _painel_coleta(conn: Any, rid: str, rod: dict[str, Any]) -> dict[str, Any]:
    registra, porque = _tentativas_registradas(rod["coletor"])
    motivo = SEM_TENTATIVAS if registra is False else porque
    pv = rod["previa"] or {}
    declaradas = _urls(_rows(conn, SQL_URLS_ENTRADA_DECLARADAS, rid)) if isinstance(pv.get("urls_entrada"), list) else None
    out: dict[str, Any] = {}
    n_decl = len(declaradas) if declaradas is not None else None
    sem_prev = "a prévia da rodada não lista URLs de entrada (coletor sem lista de entrada conhecida)"
    if motivo:
        out["urls_tentadas"] = _nulo(motivo)
        out["urls_lidas"] = _nulo(motivo)
        out["urls_reaproveitadas"] = _nulo(motivo)
        out["urls_com_falha"] = {**_nulo(motivo), "por_motivo": None}
        out["urls_entrada"] = {"declaradas": _total(declaradas, n_decl) if declaradas is not None else _nulo(sem_prev), "tentadas": _nulo(motivo), "declaradas_nao_tentadas": _nulo(motivo)}
        out["registros_elegiveis"] = _nulo(motivo)
        out["registros_alcancados"] = _nulo(motivo)
        out["registros_elegiveis_nao_alcancados"] = {**_nulo(motivo), "itens": None}
        return out
    tent = _urls(_rows(conn, SQL_URLS_TENTADAS, rid))
    n = len(tent)
    lidas, reap = _urls(_rows(conn, SQL_URLS_LIDAS, rid)), _urls(_rows(conn, SQL_URLS_REAPROVEITADAS, rid))
    falha_rows = _rows(conn, SQL_URLS_COM_FALHA, rid)
    falhas = sorted(({"url_sha": r["url_sha"], "url": r["url"], "motivo": r["motivo"]} for r in falha_rows), key=lambda x: x["url_sha"])
    if len(lidas) + len(reap) + len(falhas) != n:
        raise ErroAdmin(f"invariante violada na rodada {rid}: lidas ({len(lidas)}) + reaproveitadas ({len(reap)}) + com falha ({len(falhas)}) != tentadas ({n})")
    por_motivo = {m: _total([{"url_sha": f["url_sha"], "url": f["url"]} for f in falhas if f["motivo"] == m], len(falhas)) for m in MOTIVOS_FALHA}
    if sum(t["valor"] for t in por_motivo.values()) != len(falhas):
        raise ErroAdmin(f"invariante violada na rodada {rid}: falhas por motivo não somam as falhas")
    out["urls_tentadas"] = _total(tent, n)
    out["urls_lidas"] = _total(lidas, n)
    out["urls_reaproveitadas"] = _total(reap, n)
    out["urls_com_falha"] = {**_total([{"url_sha": f["url_sha"], "url": f["url"]} for f in falhas], n), "por_motivo": por_motivo}
    et = _urls(_rows(conn, SQL_URLS_ENTRADA_TENTADAS, rid))
    if declaradas is None:
        out["urls_entrada"] = {"declaradas": _nulo(sem_prev), "tentadas": _total(et, None, motivo_de=sem_prev), "declaradas_nao_tentadas": _nulo(sem_prev)}
    else:
        out["urls_entrada"] = {"declaradas": _total(declaradas, n_decl), "tentadas": _total(et, n_decl), "declaradas_nao_tentadas": _total(_urls(_rows(conn, SQL_URLS_ENTRADA_NAO_TENTADAS, rid)), n_decl)}
    eleg = _rows(conn, SQL_REGISTROS_ELEGIVEIS, rid)
    el = pv.get("registros_elegiveis") or {}
    tem_lista = isinstance(el.get("valor"), int)
    motivo_de = None if tem_lista else (el.get("motivo") or "a prévia da rodada não tem a lista de registros elegíveis")
    alc = _rows(conn, SQL_REGISTROS_ALCANCADOS, rid)
    out["registros_elegiveis"] = _total(sorted(_reg(r) for r in eleg), len(eleg), **({} if tem_lista else {"motivo_de": motivo_de}))
    out["registros_alcancados"] = _total(sorted(_reg(r) for r in alc), len(eleg) if tem_lista else None, **({} if tem_lista else {"motivo_de": motivo_de}))
    nao = _rows(conn, SQL_REGISTROS_NAO_ALCANCADOS, rid)
    itens = sorted(({"id": _reg(r), "rotulo": r["rotulo"], "situacao": r["situacao"], "motivo_falha": r["motivo_falha"]} for r in nao), key=lambda x: x["id"])
    out["registros_elegiveis_nao_alcancados"] = {**_total([i["id"] for i in itens], len(eleg) if tem_lista else None, **({} if tem_lista else {"motivo_de": motivo_de})), "itens": itens}
    return out


def _fatias(dec: list[dict[str, Any]], chave: str) -> dict[str, dict[str, Any]]:
    return {v: _total(sorted(d["id"] for d in dec if d[chave] == v), len(dec)) for v in sorted({d[chave] for d in dec})}


def _painel_revisao(conn: Any, rid: str) -> dict[str, Any]:
    campos = [_campo(r) for r in _rows(conn, SQL_CAMPOS_COM_PROPOSTA, rid)]
    n = len(campos)

    def ids(sql: str) -> list[str]:
        return sorted(_campo(r) for r in _rows(conn, sql, rid))

    conf, pend = ids(SQL_CAMPOS_CONFLITANTES), ids(SQL_CAMPOS_PENDENTES)
    pela, dec_c = ids(SQL_CAMPOS_CONFIRMADOS_PELA_FONTE), ids(SQL_CAMPOS_CONFIRMADOS_POR_DECISAO)
    sem_pend = ids(SQL_CAMPOS_SEM_PENDENCIA)
    if len(conf) + len(pend) + len(pela) + len(dec_c) != n or len(set(conf) | set(pend) | set(pela) | set(dec_c)) != n:
        raise ErroAdmin(f"invariante violada na rodada {rid}: conflitantes ({len(conf)}) + pendentes ({len(pend)}) + confirmados ({len(pela) + len(dec_c)}) != campos com proposta ({n})")
    reab_rows = _rows(conn, SQL_PENDENCIAS_REABERTAS, rid)
    reab = sorted(_campo(r) for r in reab_rows)
    n_abertas = len(conf) + len(pend)
    motivos = sorted({r["motivo_reabertura"] for r in reab_rows})
    por_motivo = {m: _total(sorted(_campo(r) for r in reab_rows if r["motivo_reabertura"] == m), n_abertas) for m in motivos}
    regs_prop = [f"{r['classe']}:{r['registro_chave']}" for r in _rows(conn, SQL_REGISTROS_COM_PROPOSTA, rid)]
    alt = sorted(f"{r['classe']}:{r['registro_chave']}" for r in _rows(conn, SQL_REGISTROS_ALTERADOS, rid))
    pend_lig = [r["id"] for r in _rows(conn, SQL_PENDENCIAS_LIGADAS, rid)]
    dec = _rows(conn, SQL_DECISOES, rid)
    out: dict[str, Any] = {
        "campos_com_proposta": _total(campos, n),
        "conflitantes": _total(conf, n),
        "pendentes": {**_total(pend, n), "sem_pendencia_aberta": _total(sem_pend, n)},
        "confirmados": {**_total(sorted([*pela, *dec_c]), n), "pela_fonte": _total(pela, n), "por_decisao": _total(dec_c, n)},
        "pendencias_reabertas": {**_total(reab, n_abertas), "por_motivo": por_motivo},
        "registros_com_proposta": _total(sorted(regs_prop), len(regs_prop)),
        "registros_alterados": _total(alt, len(regs_prop)),
        "decisoes": {**_total(sorted(d["id"] for d in dec), len(pend_lig)), "por_acao": _fatias(dec, "acao"), "por_decidido_por_tipo": _fatias(dec, "decidido_por_tipo"),
                     "aplicadas": _total(sorted(d["id"] for d in dec if d["aplicada"]), len(dec)), "nao_aplicadas": _total(sorted(d["id"] for d in dec if not d["aplicada"]), len(dec))},
        "pendencias_ligadas": _total(pend_lig, len(pend_lig)),
        "mensagem": SEM_PROPOSTA if n == 0 else None,
    }
    return out


def relatorio(conn: Any, rodada_id: Any) -> dict[str, Any]:
    """Relatório da rodada (só leitura). `ErroAdmin` se a rodada não existe ou se uma invariante de soma falha."""
    rod = _carregar(conn, rodada_id)
    rid = str(rod["id"])
    sim = ((rod["previa"] or {}).get("resultado") or {}).get("simulado") or None
    return {
        "simulado": sim,
        "rodada": {"id": rid, "coletor": rod["coletor"], "modo": rod["modo"], "recorte": rod["recorte"], "status": rod["status"], "iniciada_em": rod["iniciada_em"],
                   "finalizada_em": rod["finalizada_em"], "repete_id": str(rod["repete_id"]) if rod["repete_id"] else None},
        "coleta": _painel_coleta(conn, rid, rod),
        "revisao": _painel_revisao(conn, rid),
    }


# ---------------------------------------------------------------------------------------------------------------------------- texto


def _rotulo_id(i: Any) -> str:
    return f"{i['url']}  ({i['url_sha'][:12]})" if isinstance(i, dict) else str(i)


def _fmt(t: dict[str, Any]) -> str:
    if t["valor"] is None:
        return f"desconhecido: {t.get('motivo')}"
    de = f"{t['de']}" if t["de"] is not None else f"desconhecido: {t.get('motivo_de')}"
    return f"{t['valor']} de {de}"


def _lista(t: dict[str, Any], ids: bool, recuo: str = "        ") -> list[str]:
    lista = t.get("ids") or []
    corte = lista if ids else lista[:LIMITE_TEXTO]
    out = [f"{recuo}- {_rotulo_id(i)}" for i in corte]
    if len(lista) > len(corte):
        out.append(f"{recuo}  e mais {len(lista) - len(corte)}")
    return out


def _bloco(linhas: list[tuple[str, dict[str, Any]]], ids: bool) -> list[str]:
    w = max(len(r) for r, _ in linhas)
    out: list[str] = []
    for rot, t in linhas:
        out.append(f"  {rot.ljust(w)}  {_fmt(t)}")
        out += _lista(t, ids)
    return out


def texto_relatorio(doc: dict[str, Any], *, ids: bool = False) -> str:
    """Tabela de terminal: cabeçalho, painel da coleta e painel da revisão, separados; todo total como "N de D"; até 20 ids por total, depois "e mais N" (`ids=True` lista tudo)."""
    r, c, v = doc["rodada"], doc["coleta"], doc["revisao"]
    cab = lista_chave_valor([("rodada", r["id"]), ("coletor", r["coletor"]), ("modo", r["modo"]), ("recorte", r["recorte"]), ("status", r["status"]),
                             ("início", r["iniciada_em"]), ("fim", r["finalizada_em"] or "ainda não terminou"), ("repete", r["repete_id"] or "-")])
    out = ([f"SIMULADO: respostas fabricadas (cenário {doc['simulado']}); nenhum número abaixo foi lido da fonte", ""] if doc.get("simulado") else [])
    out += [cab, "", "COLETA (leitura das URLs; não diz nada sobre revisão)"]
    fal = c["urls_com_falha"]
    ue = c["urls_entrada"]
    linhas = [("URLs tentadas", c["urls_tentadas"]), ("  lidas", c["urls_lidas"]), ("  reaproveitadas", c["urls_reaproveitadas"]), ("  com falha", fal)]
    for m, t in (fal.get("por_motivo") or {}).items():
        if t["valor"]:
            linhas.append((f"    falha: {m}", t))
    linhas += [("URLs de entrada declaradas", ue["declaradas"]), ("  tentadas", ue["tentadas"]), ("  declaradas e não tentadas", ue["declaradas_nao_tentadas"]),
               ("Registros elegíveis", c["registros_elegiveis"]), ("Registros alcançados", c["registros_alcancados"])]
    out += _bloco(linhas, ids)
    na = c["registros_elegiveis_nao_alcancados"]
    out.append(f"  {'Elegíveis não alcançados'}  {_fmt(na)}")
    for i in (na.get("itens") or [])[: None if ids else LIMITE_TEXTO]:
        extra = f"; última falha: {i['motivo_falha']}" if i["motivo_falha"] else ""
        out.append(f"        - {i['id']}  {i['situacao']}{extra}")
    if na.get("itens") and not ids and len(na["itens"]) > LIMITE_TEXTO:
        out.append(f"          e mais {len(na['itens']) - LIMITE_TEXTO}")
    out += ["", "REVISÃO (campos com proposta; não diz nada sobre leitura de URL)"]
    if v["mensagem"]:
        out.append(f"  {v['mensagem']}")
    pend, conf = v["pendentes"], v["confirmados"]
    linhas = [("Campos com proposta", v["campos_com_proposta"]), ("  confirmados", conf), ("    pela fonte", conf["pela_fonte"]), ("    por decisão", conf["por_decisao"]),
              ("  conflitantes", v["conflitantes"]), ("  pendentes", pend), ("    sem pendência aberta", pend["sem_pendencia_aberta"]),
              ("Pendências reabertas", v["pendencias_reabertas"])]
    for m, t in v["pendencias_reabertas"]["por_motivo"].items():
        linhas.append((f"    motivo: {m}", t))
    linhas += [("Registros com proposta", v["registros_com_proposta"]), ("Registros com decisão aplicada (aprovar ou corrigir)", v["registros_alterados"]), ("Decisões", v["decisoes"]),
               ("  aplicadas", v["decisoes"]["aplicadas"]), ("  não aplicadas", v["decisoes"]["nao_aplicadas"])]
    for k, rot in (("por_acao", "ação"), ("por_decidido_por_tipo", "por")):
        for nome, t in v["decisoes"][k].items():
            linhas.append((f"    {rot}: {nome}", t))
    out += _bloco(linhas, ids)
    return "\n".join(out)
