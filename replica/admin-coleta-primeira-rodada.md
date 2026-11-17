# Primeira rodada do módulo de administração de coleta (passos 1 a 9)

SIMULADO: todas as respostas do SAPL desta rodada são fabricadas (etl/tests/fixtures/sapl_ale); nenhum número abaixo foi lido da fonte.

Para reexecutar tudo (recria o banco local `admin_coleta_r1`, que é o único que o roteiro apaga, e regrava os arquivos de evidência):

```bash
bash replica/prompts/evidencias/primeira-rodada.sh
```

Cada número deste relatório vem de uma saída gravada em `replica/prompts/evidencias/` (prefixo `primeira-rodada-`); os identificadores mudam a cada execução e os números não. O roteiro (passos 1 a 9, 16 etapas internas numeradas de 00 a 15) foi executado duas vezes seguidas, ambas com código 0 e `resultado: tudo passou`; os números das duas execuções coincidem (as ids e os horários mudam). Os identificadores citados abaixo são os da última execução, que é a que está nos arquivos de evidência.

Refeita com o código final: migrações 0150 a 0153, executor (`admin executor`), pedidos e decisões da central (0153), `candidata`, e a central do `web/` no `next start` local. Este relato substitui o anterior, que cobria só os passos 1 a 5 e foi feito antes das migrações 0152 e 0153 (ver "Diferenças em relação ao relato anterior").

Correspondência entre os passos do prompt e as etapas do roteiro (os arquivos de evidência levam o número da etapa):

| passo do prompt | etapa do roteiro | arquivos |
|---|---|---|
| 1 prévia e rodada | 02, 03 (e 00, 01) | `-02-*`, `-03-*` |
| 2 campo que mudou, decisão aplicada | 04, 05 | `-04-*`, `-05-*` |
| 3 candidato pendente, pergunta em aberto | 06 | `-06-*` |
| 4 mesma rodada pelo identificador | 07 | `-07-*` |
| 5 reprocessar sem rede | 08 | `-08-*` |
| (fechamento dos passos 1 a 5) | 09 | `-09-*` |
| município com Câmara no SAPL (preparo do 6) | 10 | `-10-*` |
| 6 mapa, pendência do município | 11 | `-11-*` |
| 7 recoletar, executor, ficha e contagem | 12 | `-12-*` |
| 8 parecer de IA (ensaio) | 13 | `-13-*` |
| 9 decisão pela central, conferida pela CLI | 14, 15 | `-14-*`, `-15-*` |

## Como foi feita e o que ela é

- Banco: `admin_coleta_r1`, recriado do zero pelo roteiro (migrações, seed, `base.sql` e `admin_base.sql`). Não é o banco da suíte (`admin_coleta`) nem o `civico`.
- Recorte: Assembleias Legislativas com SAPL, tarefa `sapl.ales`, coletor `sapl.assembleias`, fonte `sapl-ale`, cinco casas: RO, AC, AM, PI, PB.
- Respostas: fabricadas, cenários `v1` e `v2` de `etl/tests/fixtures/sapl_ale`, servidas pelo lançador `etl/tests/simulado.py` (a CLI real roda sobre um transporte fabricado; a primeira linha de toda saída diz SIMULADO e o relatório de cada rodada abre com o aviso, lido do resultado gravado na própria rodada). Nenhuma requisição de rede foi feita.
- Quem decide e aplica é uma pessoa pela CLI, com o nome literal `Operador de Ensaio (SIMULADO)`. Nenhuma decisão de agentes: o roteiro só chama `decidir`, que não tem opção de agentes, e confere que o banco tem 0 decisões de agentes (primeira-rodada-05-conferencias.txt).
- O cache de HTTP é um diretório novo a cada execução (`$TMPDIR/admin-r1-cache`), passado ao lançador em todos os passos, para o cache atravessar os passos.
- Passos 6 a 9: pela API HTTP da central (`next start` local, role `admin_central`, sem navegador: o Playwright não abre no sandbox, AC-05), por `node web/e2e-admin/sem-navegador.mjs --sem-build --fluxo --banco admin_coleta_r1`, chamado pelo roteiro depois de um `next build` feito só se `web/.next` não tem as rotas `/admin` ou tem fonte mais nova que o BUILD_ID (nas execuções registradas o build existente foi reaproveitado). A central só grava PEDIDOS; quem executa é `admin executor --uma-vez`, sobre as mesmas respostas fabricadas (cenário v2).
- Banco preparado: 42 migrações aplicadas (0150 a 0153 entre elas), 5 Assembleias em `legislative_bodies`, zero rodada, zero casa SAPL, zero run (primeira-rodada-00-preparo.txt).

## A primeira rodada REAL, com rede

Os mesmos subcomandos, sem o lançador, num banco local com a carga real. Antes, as Assembleias precisam estar em `legislative_bodies` (`civico-etl ibge.places`, que usa rede). A carga real das cinco casas pode levar até 2 h (timeout da tarefa `sapl.ales` na agenda).

```bash
cd etl
export DATABASE_URL=<URL do banco local com a carga real> ETL_DATABASE_URL=<a mesma URL>
uv run --frozen civico-etl ibge.places        # usa rede; só se as Assembleias ainda não estão em legislative_bodies
uv run --frozen civico-etl admin previa --coletor sapl.assembleias --uf RO --uf AC --uf AM --uf PI --uf PB
uv run --frozen civico-etl admin rodada abrir --coletor sapl.assembleias --uf RO --uf AC --uf AM --uf PI --uf PB --executar
uv run --frozen civico-etl admin relatorio <id da rodada>
uv run --frozen civico-etl admin fila
uv run --frozen civico-etl admin candidata
```

A releitura forçada do passo 2 (`--forcar-url` em `rodada abrir`) só faz sentido na segunda rodada, depois de algum tempo; a lista de URLs sai da prévia (`admin previa --json`, campo `urls_entrada`).

## Passo 1: prévia do recorte e rodada (SIMULADO, cenário v1)

Comandos: `admin previa --coletor sapl.assembleias --uf RO --uf AC --uf AM --uf PI --uf PB` (primeira-rodada-02-previa.txt e .json) e `admin rodada abrir --coletor sapl.assembleias --uf RO --uf AC --uf AM --uf PI --uf PB --executar` (primeira-rodada-03-rodada-v1.txt; detalhe da rodada em primeira-rodada-03-rodada-v1-ver.json; relatório em primeira-rodada-03-relatorio-v1.txt, `-ids.txt` e .json).

- Prévia: 10 URLs de entrada firmes e 0 condicionais (robots.txt e /api/ de cada casa), 5 registros elegíveis (as cinco Assembleias), nenhuma URL em cache. A lista é marcada incompleta (`lista_completa = false`): só estão as URLs conhecidas antes da leitura. A estimativa de URLs a consultar na prévia é 10, marcada como estimativa; a prévia não pediu nenhuma URL ao transporte.
- Rodada `a6d5ad44-69b7-40f9-b026-6ee4a18ebe83`: status concluida. URLs tentadas 79 de 79: lidas 77 de 79, reaproveitadas 0 de 79, com falha 2 de 79 (robots 1, erro 1). URLs de entrada tentadas 10 de 10; declaradas e não tentadas 0 de 10. O lançador registrou 82 URLs pedidas ao transporte fabricado, contra 79 URLs distintas tentadas; primeira-rodada-03-rodada-v1.txt registra 4 linhas de retentativa da /api/ de PB, que responde 500 no cenário v1.
- Critério 3: as URLs de entrada da prévia são exatamente as URLs de entrada tentadas (primeira-rodada-03-conferencias.txt).
- Registros elegíveis alcançados: 3 de 5 (vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:3). Não alcançados: vinculo_sapl:4, vinculo_sapl:5 (PI: última falha por robots; PB: última falha por erro).
- Revisão: 0 de 0 campos com proposta. Primeira rodada sobre banco vazio: tudo é primeiro preenchimento, 37 no total (10 de vinculo_sapl, 27 de cobertura), e nenhuma proposta (0 novas).
- Antes da rodada, `admin inventario` (primeira-rodada-01-inventario.txt e .json) lista o coletor `sapl.assembleias` como `nunca_carregado`.

Limite: o inventário e a prévia não dizem nada sobre o que a fonte real tem; só o que o código e o banco declaram.

## Passo 2: um campo que mudou, com decisão registrada e aplicada (SIMULADO)

Comandos: segunda rodada sobre o cenário `v2` com releitura forçada (10 URLs: robots.txt e /api/ das cinco casas, pegas da prévia JSON, primeira-rodada-04-previa-v2.json); depois `admin fila`, `admin candidata`, e a decisão. Arquivos: primeira-rodada-04-rodada-v2.txt, primeira-rodada-04-relatorio-v2.*, primeira-rodada-04-fila.*, primeira-rodada-04-candidata.*, primeira-rodada-05-decidir-pb.txt, primeira-rodada-05-pendencia-pb.*, primeira-rodada-05-conferencia-sql.txt.

A rodada `bcc333b0-d1ba-45c0-b5b8-0bb81e68e06e` (v2, `--forcar-url` nas 10 URLs de entrada das casas) terminou concluida. A mudança só aparece com a releitura forçada, porque robots.txt e /api/ ficam em cache por um dia. Resultado: 33 de 33 URLs tentadas, lidas 25 de 33, reaproveitadas 6 de 33, com falha 2 de 33 (robots 2: a /api/ de AM e a de PI, barradas pelo robots.txt). O lançador registrou 31 URLs pedidas ao transporte fabricado.

Propostas novas: 2; campos inalterados: 35 (resultado gravado na rodada, primeira-rodada-04-rodada-v2-ver.json). Pendências abertas, ambas do tipo mudança, classe vinculo_sapl, campo status:

| Casa | registro (`sapl_houses.id`) | pendência | vigente na leitura | candidato | evidência (URL, hash, lida em) |
|---|---|---|---|---|---|
| PB | 5 | `f6c52562-3834-4ca0-865e-d15bde04bca8` | fora_do_ar | ok | https://sapl.al.pb.leg.br/api/, c7296d22537b, 2026-11-17T09:58:03Z |
| AM | 3 | `7105ac18-15cb-48aa-9b1c-9552f6dc3c3b` | ok | robots_bloqueia | https://sapl.al.am.leg.br/robots.txt, ab75d28a39d3, 2026-11-17T09:58:03Z |

A rodada v2 não gerou proposta de cobertura: 9 linhas de cobertura são primeiro preenchimento (PB, carregada pela primeira vez) e `reason_sem_proposta` é 0. A rodada v2 tentou só 2 URLs de RO (robots.txt e /api/), nenhuma de matéria: as casas já carregadas na v1 ficam fora da fila de carga por 6 dias (STALE_DAYS, decisão AC-10), então a matéria nova de RO do cenário v2 não foi lida e a cobertura de RO não mudou (primeira-rodada-04-relatorio-v2-ids.txt). O roteiro não envelhece `loaded_at` de propósito: não há comando da CLI para isso.

Decisão (pessoa, `Operador de Ensaio (SIMULADO)`): `admin decidir f6c52562-3834-4ca0-865e-d15bde04bca8 --acao aprovar --por "Operador de Ensaio (SIMULADO)" --justificativa "a /api/ da casa voltou a responder na leitura de 2026-11-17 (resposta fabricada, cenário v2); ver evidência da proposta" --aplicar`. Decisão `8f3338d2-8c4c-459c-8996-8a5d20158d2c`, aplicada em 2026-11-17T09:58:06Z. Conferência em SQL (primeira-rodada-05-conferencia-sql.txt):

```
-- sapl_houses.status de PB
 id | uf | status |         base_url          
----+----+--------+---------------------------
  5 | PB | ok     | https://sapl.al.pb.leg.br
(1 linha)

-- adm_overrides do campo
                  id                  |    classe    | registro_chave | campo  | valor | suprimir | vigente |              decisao_id              
--------------------------------------+--------------+----------------+--------+-------+----------+---------+--------------------------------------
 a627b847-588b-45a5-bcb2-a961c933788c | vinculo_sapl | 5              | status | "ok"  | f        | t       | 8f3338d2-8c4c-459c-8996-8a5d20158d2c
(1 linha)

-- adm_pendencias
                  id                  |    classe    | registro_chave | campo  |  tipo   |  status  | reaberta 
--------------------------------------+--------------+----------------+--------+---------+----------+----------
 f6c52562-3834-4ca0-865e-d15bde04bca8 | vinculo_sapl | 5              | status | mudanca | decidida | f
(1 linha)
```

A aplicação escreveu um override vigente em `adm_overrides` e atualizou `sapl_houses` (id 5). Como o job já tinha gravado `ok` na tabela quando sondou a v2, o valor anterior e o novo são o mesmo (`ok` para `ok`) e por isso `corrections` não ganhou linha: a saída do comando diz `sem corrections (o valor anterior é igual ao novo)`. `corrections` tem 0 linhas depois do passo.

Limite: o override fixa o status de PB em `ok` a partir de agora; se a casa voltar a falhar, pelo desenho da migração 0151 a tabela continua em `ok` e o job anota o que tentou gravar em `adm_overrides` (`tentou_valor`). Esta rodada não exercitou esse caso; vale saber antes de aprovar uma mudança que o job já gravou.

## Passo 3: um candidato que ficou pendente, com a pergunta em aberto (SIMULADO)

Comandos: `admin pendencia 7105ac18-15cb-48aa-9b1c-9552f6dc3c3b` (primeira-rodada-06-pendencia-am.txt e .json) e `admin parecer --pendencia 7105ac18-15cb-48aa-9b1c-9552f6dc3c3b` (primeira-rodada-06-parecer-am.txt). Nada foi decidido.

- Registro: 3 (Assembleia Legislativa de Amazonas · Amazonas/AM), classe vinculo_sapl, campo status, tipo mudanca. Território uf 13. Vence em 2026-11-24; cobertura do recorte 60%.
- Pergunta em aberto: "O status do SAPL desta casa mudou de 'ok' para 'robots_bloqueia'?"
- Valor vigente: robots_bloqueia (o job já gravou o novo status na tabela, sem override). Candidato: robots_bloqueia. Evidência: https://sapl.al.am.leg.br/robots.txt, hash ab75d28a39d3, lida em 2026-11-17T09:58:03Z; trecho: robots.txt de https://sapl.al.am.leg.br/robots.txt lido; o job considerou https://sapl.al.am.leg.br/api/ bloqu...
- O parecer saiu marcado ENSAIO e SIMULADO (motor de ensaio local, sem chamada a modelo, 0 URLs pedidas): o parecer não aplica nada. Depois dele, o status de AM na tabela continua robots_bloqueia, a pendência continua aberta, e decisões, overrides e `corrections` têm as mesmas contagens de antes; as tabelas de domínio e de revisão têm as mesmas linhas e hashes antes e depois (primeira-rodada-06-estado-antes.txt e primeira-rodada-06-estado-depois.txt, primeira-rodada-06-conferencia-sql.txt). A única linha nova é a do próprio parecer em `adm_pareceres` (1).

Limite: o parecer de ensaio local é uma regra fixa do código, não uma leitura de modelo; ele serve para ver o formato e a trava (nada é aplicado), não para avaliar qualidade de parecer.

## Passo 4: a mesma rodada de novo, pelo identificador (SIMULADO)

Comando: `admin rodada repetir bcc333b0-d1ba-45c0-b5b8-0bb81e68e06e` com o mesmo cenário (v2) e o mesmo cache. Arquivos: primeira-rodada-07-repetir.txt, primeira-rodada-07-relatorio-repeticao.* , primeira-rodada-07-estado-antes.txt, primeira-rodada-07-estado-depois.txt, primeira-rodada-07-conferencia-sql.txt.

- Rodada `738e7b35-fcf5-437a-8844-a873e0ba9c32`, repete `bcc333b0-d1ba-45c0-b5b8-0bb81e68e06e`, status concluida. URLs tentadas 10 de 10: lidas 0 de 10, reaproveitadas 8 de 10, com falha 2 de 10 (robots 2: a /api/ de AM e a de PI, barradas pelo robots.txt já em cache). 0 URLs pedidas ao transporte.
- Zero linha nova (contagens antes e depois, mesmas): adm_propostas 2, adm_pendencias 2, adm_pendencia_propostas 2, adm_vinculos 17, sapl_houses 5, data_coverage 12; as demais tabelas sapl_* também iguais (primeira-rodada-07-estado-antes.txt e primeira-rodada-07-estado-depois.txt).
- Duplicata por chave natural: nenhuma em `sapl_houses` (place_id), nas oito tabelas `sapl_*` e nos vínculos vigentes de `adm_vinculos` (classe, registro, url_sha); a consulta está em primeira-rodada-07-conferencia-sql.txt.
- A repetição não criou proposta nem pendência: `admin relatorio` da repetição tem 0 de 0 campos com proposta, porque as propostas da rodada de origem continuam ligadas a ela.

O que é relido de verdade: a repetição reaproveita o cache e não pediu nenhuma URL ao transporte. Ela tentou só 10 URLs (as de entrada), contra 33 da rodada de origem. Na rodada de origem, 25 das 33 URLs eram de PB (as 2 de entrada mais 23 da primeira carga da casa); a repetição não as refaz porque PB agora está carregada há menos de 6 dias e fica fora da fila de carga (decisão AC-10). Isto é o comportamento do coletor, não uma falha da repetição.

Limite: no passo 4 a economia de rede é provada nas URLs de entrada; a carga de matérias não é refeita por repetição enquanto a casa estiver dentro do prazo de recarga.

## Passo 5: reprocessamento sem rede do bruto salvo (SIMULADO)

Comandos: `admin previa --coletor sapl.assembleias --modo reprocessar` nas cinco UFs e nas UFs completas, e `admin rodada abrir --coletor sapl.assembleias --modo reprocessar --uf ... --executar`. Arquivos: primeira-rodada-08-previa-reprocessar-cinco.*, primeira-rodada-08-previa-reprocessar-completas.*, primeira-rodada-08-rodada-reprocessar.txt, primeira-rodada-08-relatorio-reprocessar.*, primeira-rodada-08-rodada-cinco-recusada.txt, primeira-rodada-08-estado-antes.txt, primeira-rodada-08-estado-depois.txt, primeira-rodada-08-conferencia-sql.txt.

- A prévia de reprocessamento das cinco UFs lista o que falta no cache: https://sapl.al.pi.leg.br/api/ (a /api/ de PI nunca foi pedida, porque o robots.txt a bloqueia). As UFs com todas as URLs de entrada em cache, segundo a própria prévia: RO AC AM PB. A /api/ de PB está no cache porque a leitura da v2 a gravou.
- Rodada `84852c78-51b0-4d66-bddf-f7342a1d9995` (UFs RO AC AM PB): status concluida. URLs tentadas 8 de 8: lidas 0 de 8, reaproveitadas 7 de 8, com falha 1 de 8 (robots 1: a /api/ de AM, barrada pelo robots.txt em cache; não vai à rede). 0 URLs pedidas ao transporte.
- Tabelas de domínio idênticas antes e depois (linhas e hash, sem os carimbos `checked_at`, `updated_at`, `created_at`, `checked_on`, que a sondagem refaz):

| tabela | linhas antes | linhas depois | hash antes | hash depois |
|---|---|---|---|---|
| sapl_parlamentares | 16 | 16 | 9f89ef2b | 9f89ef2b |
| sapl_mandatos | 12 | 12 | ff85bca3 | ff85bca3 |
| sapl_materias | 15 | 15 | 8879fd36 | 8879fd36 |
| sapl_autorias | 19 | 19 | 7131cf0b | 7131cf0b |
| sapl_sessoes | 8 | 8 | 7704f4f9 | 7704f4f9 |
| sapl_presencas | 20 | 20 | aada076f | aada076f |
| sapl_votos | 20 | 20 | 08ccfcaa | 08ccfcaa |
| sapl_cursors | 16 | 16 | 515582ad | 515582ad |
| sapl_houses | 5 | 5 | abb4ebb8 | abb4ebb8 |
| data_coverage | 12 | 12 | d8cf28ca | d8cf28ca |

- A rodada das cinco UFs em reprocessar foi recusada (`4db8747c-584b-4e29-bc74-9afee3998185`): status falhou, o coletor não rodou, e a mensagem lista `faltam no cache https://sapl.al.pi.leg.br/api/` (primeira-rodada-08-rodada-cinco-recusada.txt). A rodada falhada fica gravada em `adm_rodadas`.

Limite, sem maquiagem (decisão AC-10): nas Assembleias, reprocessar refaz sem rede a sondagem (status e cobertura) a partir do cache; a carga de matérias só é refeita para casa fora do prazo de recarga de 6 dias. Por isso as tabelas `sapl_*` não mudam nesta prova. O reprocessamento não demonstra que as tabelas de matérias, autorias, sessões e votos sejam reconstruíveis do bruto; demonstra que a sondagem é. Reprocessar a carga exigiria um argumento novo no job, que está fora do escopo desta entrega.

## Passo 6: mapa, município e pendência (SIMULADO)

Premissa de município, resolvida sem inventar nada: o prompt manda acrescentar um município com Câmara Municipal no SAPL. A fixture fabricada de câmara municipal já existe (`etl/tests/fixtures/sapl_ale`, hosts `.invalid`, página de registro do Interlegis fabricada; o município IBGE 1190099, "Município Fabricado (teste)", UF RO, vem de `admin_base.sql`). O roteiro a reaproveitou: nenhum HTML de site real foi escrito. Etapa 10 (primeira-rodada-10-*), com a CLI real sobre o transporte fabricado:

- `admin previa --coletor sapl.camaras --ibge 1190099 --modo descobrir`: 1 URL de entrada firme (a página do registro), 1 registro elegível, fora do cache (primeira-rodada-10-previa-municipio.txt).
- Rodada v1 (`admin rodada abrir --coletor sapl.camaras --ibge 1190099 --modo descobrir --executar`): concluida, 3 URLs lidas de 3, 2 vínculos criados, 0 propostas, 2 primeiros preenchimentos; a casa nasce com `base_url` `https://sapl.camara-fabricada.invalid`, status ok (primeira-rodada-10-rodada-municipio-v1.txt).
- Rodada v2 com releitura forçada da página do registro (`--forcar-url`, a URL sai da prévia v2): concluida, 3 de 3 lidas, 1 proposta nova, 1 campo pendente. O registro passou a apontar para `https://sapl.camara-fabricada-nova.invalid`. Pendência aberta: vinculo_sapl, campo `base_url`, tipo mudanca, território municipio 1190099, evidência da página do registro (hash 5d4482e291d4 na última execução), vence em 2026-11-24, cobertura do recorte 100% (primeira-rodada-10-relatorio-municipio-v2.*, primeira-rodada-10-fila.*, primeira-rodada-10-conferencia-sql.txt). A fila passa a ter 2 pendências abertas: a de AM (status) e a do município (`base_url`).

Passo 6 pela central (`GET /admin/api/estado` e `GET /admin/api/fila?classe=vinculo_sapl`; primeira-rodada-11-passo6-mapa-e-pendencia.txt): o mapa devolve 18 fichas no total (as cinco UFs somam 18; a regra de ficha da central não é recomposta aqui, e `adm_vinculos` tem 15 registros de cobertura e 6 de vínculo vigentes no banco) e, por UF (código IBGE de 2 dígitos), 11 (RO): 5, 12 (AC): 4, 13 (AM): 4, 22 (PI): 1, 25 (PB): 4. A API da fila responde 200 com as 2 pendências. A pendência escolhida pelo fluxo é a de MUNICÍPIO: "Câmara Municipal de Município Fabricado (teste)", campo `base_url`, território municipio 1190099. O fluxo não cai para a UF (a conferência do roteiro exige a ausência do aviso PREMISSA).

Limite: o mapa da API só tem contagem por UF. O fluxo mede a UF que contém o município ("o mapa do país conta 5 ficha(s) na UF 11 do território municipio 1190099") e avisa que a contagem do próprio município não é medida sem navegador. A contagem por município na tela e a abertura de UF e município no mapa NÃO foram provadas aqui: isso é do Playwright (critérios 16, 21 e 26), que não roda no sandbox (AC-05).

## Passo 7: recoletar fichas pendentes, executor, ficha e contagem (SIMULADO)

Pela central: `POST /admin/api/pedidos` com `{tipo: recoleta, parametros: {classe: vinculo_sapl, territorio: {ibge: 1190099, nivel: municipio}}}` respondeu 200 com `novo: true` (um pedido, na fila); a central não executa nada. Depois `admin executor --uma-vez` (cenário v2): o pedido terminou `concluido` e abriu e executou a rodada `cce8f599` (id da última execução), do coletor `sapl.camaras`, modo recoletar, recorte `ibges 1190099` (primeira-rodada-12-passo7-recoleta.txt, -12-conferencia-sql.txt, -12-rodada-recoleta-ver.json).

- Relatório da rodada de recoleta (primeira-rodada-12-relatorio-recoleta.* e `-ids.txt`): 24 URLs tentadas de 24, lidas 23, reaproveitadas 1, com falha 0 (a casa tem a carga completa lida pela primeira vez, na v2); 0 campos com proposta, 0 propostas novas, 2 campos inalterados.
- Resultado na ficha: a pendência do mesmo registro e campo continua aberta e na fila, com o mesmo id (o fluxo confere). A recoleta não a decide nem a fecha; só relê.
- Contagem do território: NÃO provada (ver o limite do passo 6). O que há é a contagem de fichas por UF do mapa antes da recoleta (RO 5); o fluxo não relê a contagem depois nem mede a consulta periódica de 5 s sem recarregar (critério 21).

## Passo 8: parecer de IA para a ficha (SIMULADO, ensaio local)

`POST /admin/api/pedidos` com `{tipo: parecer, parametros: {pendencia_id}}` para a pendência do município: 200, `novo: true`; o executor gravou o pedido como `concluido` (primeira-rodada-13-passo8-parecer.txt, -13-conferencia-sql.txt).

- `adm_pareceres` tem 2 linhas no fim, ambas `modelo ensaio-local`, `modo ensaio`, `simulado = true` (a de AM do passo 3 e a do município); nenhuma com `simulado` falso. É o motor de ensaio local: nenhuma chamada a modelo, nenhuma chave de agentes ligada.
- Nada foi aplicado: o fluxo confere, e o SQL confirma, que `adm_overrides` (1, o de PB) e `corrections` (0) não mudaram do começo ao fim do fluxo; não existe decisão no banco antes do pedido de decisão do passo 9.

Limite (igual ao do passo 3): o parecer de ensaio é regra fixa; não avalia qualidade de parecer de IA.

## Passo 9: decidir pela central e conferir pela CLI (SIMULADO)

`POST /admin/api/decisoes` com `{acao: aprovar, por: "Operador de Ensaio (SIMULADO)", justificativa, aplicar: false}` para a pendência do município respondeu 200, `novo: true`. Antes do executor não existe decisão em `adm_decisoes` (a central só gravou o pedido em `adm_pedidos_decisao`, AC-19). Depois de `admin executor --uma-vez`: pedido `concluido`, com `decisao_id` preenchido (primeira-rodada-14-passo9-decisao.txt, -14-conferencia-sql.txt, -14-pendencia-municipio.*).

- Pela CLI (`admin pendencia <id> --json`): exatamente 1 decisão, `aprovar`, por `pessoa`, nome `Operador de Ensaio (SIMULADO)`, `aplicada = false`; a pendência ficou `decidida`. O SQL em `adm_decisoes` mostra a mesma linha e a justificativa exatamente como pedida pela API.
- Aprovar sem aplicar: `adm_overrides` continua em 1 linha (o de PB) e `corrections` em 0. Decisões no banco: 2 (PB, passo 2, aplicada; município, passo 9, não aplicada), 0 de agentes. A fila de pedidos (`adm_pedidos` e `adm_pedidos_decisao`) terminou sem pedido ativo.
- Fechamento (etapa 15): a fila de pendências abertas tem 1 (AM; a do município saiu da fila ao ser decidida); `admin vinculos --registro vinculo_sapl:20` mostra 3 vínculos do município (2 vigentes: o do registro oficial, com evidência e última tentativa `lida`, e o `descoberta_automatica` do endereço novo; o endereço antigo ficou não vigente) (primeira-rodada-15-vinculos-municipio.*); `civico-etl check` depois do fluxo quebra as mesmas 6 invariantes do passo 09 (primeira-rodada-15-check-conferencia.txt).

Limite: a decisão pela central foi pelo API; clicar na tela e a atualização da contagem do território sem recarregar não foram exercitados (AC-05).

## Relatório da rodada

Origem: `admin relatorio <id>` (primeira-rodada-03-relatorio-v1.*, primeira-rodada-04-relatorio-v2.*, primeira-rodada-07-relatorio-repeticao.*, primeira-rodada-08-relatorio-reprocessar.*, primeira-rodada-09-relatorio-v2-final.*). Todas as colunas são SIMULADO (v1 e v2). O painel de coleta e o de revisão nunca são somados. A coluna v2 (depois da decisão) é a mesma rodada v2 relida depois do passo 2.

| | Passo 1: v1 | Passo 2: v2 (logo depois) | Passo 2: v2 (depois da decisão) | Passo 4: repetição da v2 | Passo 5: reprocessar |
|---|---|---|---|---|---|
| Rodada | `a6d5ad44` | `bcc333b0` | `bcc333b0` | `738e7b35` | `84852c78` |
| Status | concluida | concluida | concluida | concluida | concluida |
| URLs tentadas | 79 de 79 | 33 de 33 | 33 de 33 | 10 de 10 | 8 de 8 |
| URLs lidas | 77 de 79 | 25 de 33 | 25 de 33 | 0 de 10 | 0 de 8 |
| URLs reaproveitadas | 0 de 79 | 6 de 33 | 6 de 33 | 8 de 10 | 7 de 8 |
| URLs com falha | 2 de 79 (robots 1, erro 1) | 2 de 33 (robots 2) | 2 de 33 (robots 2) | 2 de 10 (robots 2) | 1 de 8 (robots 1) |
| URLs de entrada tentadas | 10 de 10 | 10 de 10 | 10 de 10 | 10 de 10 | 8 de 8 |
| Registros elegíveis alcançados | 3 de 5 | 3 de 5 | 3 de 5 | 3 de 5 | 3 de 4 |
| Registros alcançados (ids) | vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:3 | vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:5 | vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:5 | vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:5 | vinculo_sapl:1, vinculo_sapl:2, vinculo_sapl:5 |
| Campos com proposta | 0 de 0 | 2 de 2 | 2 de 2 | 0 de 0 | 0 de 0 |
| Campos confirmados | 0 de 0 (pela fonte 0 de 0; por decisão 0 de 0) | 0 de 2 (pela fonte 0 de 2; por decisão 0 de 2) | 1 de 2 (pela fonte 0 de 2; por decisão 1 de 2) | 0 de 0 (pela fonte 0 de 0; por decisão 0 de 0) | 0 de 0 (pela fonte 0 de 0; por decisão 0 de 0) |
| Campos conflitantes | 0 de 0 | 0 de 2 | 0 de 2 | 0 de 0 | 0 de 0 |
| Campos pendentes | 0 de 0 (nenhum) | 2 de 2 (vinculo_sapl:3:status, vinculo_sapl:5:status) | 1 de 2 (vinculo_sapl:3:status) | 0 de 0 (nenhum) | 0 de 0 (nenhum) |
| Registros alterados | 0 de 0 (nenhum) | 0 de 2 (nenhum) | 1 de 2 (vinculo_sapl:5) | 0 de 0 (nenhum) | 0 de 0 (nenhum) |
| Decisões ligadas | 0 de 0 | 0 de 2 | 1 de 2 | 0 de 0 | 0 de 0 |
| Pendências reabertas | 0 de 0 | 0 de 2 | 0 de 1 | 0 de 0 | 0 de 0 |

Identificadores completos das URLs de cada total: `primeira-rodada-*-relatorio*-ids.txt` (tabela) e os `.json` (lista inteira). "Registro" é `classe:registro_chave`; no vinculo_sapl a chave é `sapl_houses.id` (1 = RO, 2 = AC, 3 = AM, 4 = PI, 5 = PB, conforme os rótulos em primeira-rodada-09-vinculos-sapl-ale.json).

A repetição e o reprocessar tentam só as URLs de entrada (10 e 8), porque não refazem a carga de matérias; por isso as colunas deles não são comparáveis em volume com as da v1 e da v2 (ver passos 4 e 5). As colunas da v2 são a mesma rodada lida em dois momentos.

## Edição candidata

Comando novo desta entrega: `admin candidata [--rodada ID ...] [--json]` (só leitura; `etl/civico_etl/admin/candidata.py`). Arquivos: primeira-rodada-04-candidata.* (depois da rodada v2), primeira-rodada-09-candidata.* (final, todas as rodadas), primeira-rodada-09-candidata-rodada-v2.* (só as propostas da rodada v2).

A edição é a diferença entre a base vigente (lida na hora, da tabela de domínio) e o que as propostas dizem, por registro e campo, com a evidência de cada candidato, mais as pendências restantes na ordem da fila. Diferença já aplicada vai para a seção `aplicadas`, porque depois de aplicada o candidato já é o vigente. Uma exceção declarada no código: campo com pendência aberta cujo candidato já é o vigente (o job gravou o novo valor direto na tabela e a mudança espera decisão) entra em `diferenças` com `ja_e_o_vigente`, e a diferença é contra o valor que a tabela tinha na leitura.

| total | logo depois da rodada v2 | final (todas as rodadas) |
|---|---|---|
| campos com proposta | 2 de 2 | 2 de 2 |
| diferenças | 2 de 2 | 1 de 2 |
| pendentes | 2 de 2 | 1 de 1 |
| conflitantes | 0 de 2 | 0 de 1 |
| decididas e não aplicadas | 0 de 2 | 0 de 1 |
| descartadas | 0 de 2 | 0 de 1 |
| aplicadas | 0 de 2 | 1 de 2 |
| confirmados pela fonte | 0 de 2 | 0 de 2 |
| sem diferença por decisão | 0 de 2 | 1 de 2 |
| pendências restantes | 2 de 2 | 1 de 1 |

Diferenças finais (SIMULADO):

| classe | registro | campo | vigente agora | candidato | situação | evidência |
|---|---|---|---|---|---|---|
| vinculo_sapl | 3 (Assembleia Legislativa de Amazonas · Amazonas/AM) | status | robots_bloqueia | robots_bloqueia (já é o vigente; na leitura: ok) | pendente | https://sapl.al.am.leg.br/robots.txt, hash ab75d28a39d3, lida 2026-11-17T09:58:03Z |

Aplicadas:

| classe | registro | campo | antes | depois | decisão | evidência |
|---|---|---|---|---|---|---|
| vinculo_sapl | 5 (Assembleia Legislativa de Paraíba · Paraíba/PB) | status | fora_do_ar | ok | aprovar por Operador de Ensaio (SIMULADO) em 2026-11-17T09:58:06Z (`8f3338d2-8c4c-459c-8996-8a5d20158d2c`) | https://sapl.al.pb.leg.br/api/, hash c7296d22537b |

O "antes" de uma aplicada é o valor vigente registrado na proposta no instante da leitura (`fora_do_ar`); a aplicação em si guardou `ok` para `ok` (ver passo 2), porque o job já tinha gravado o novo valor. O arquivo completo com trecho, bloco, data declarada pela fonte e rodada de cada candidato é primeira-rodada-09-candidata.json.

## Fila priorizada

`admin fila` no fim (primeira-rodada-09-fila.txt e .json): ordem classe, tipo, vencimento, cobertura do recorte e id; nunca por pessoa, partido ou popularidade. 1 pendência aberta:

| # | pendência | classe | registro | campo | tipo | vence | cobertura do recorte | pergunta |
|---|---|---|---|---|---|---|---|---|
| 1 | `7105ac18-15cb-48aa-9b1c-9552f6dc3c3b` | vinculo_sapl | 3 (Assembleia Legislativa de Amazonas · Amazonas/AM) | status | mudanca | 2026-11-24 | 60% | O status do SAPL desta casa mudou de 'ok' para 'robots_bloqueia'? |

Para a próxima pessoa: decidir a pendência de AM (`admin decidir 7105ac18-15cb-48aa-9b1c-9552f6dc3c3b --acao aprovar|corrigir|descartar|pedir_confirmacao ...`), com a evidência acima (o robots.txt de AM passou a bloquear a /api/). Antes da decisão de PB a fila tinha 2 pendências (primeira-rodada-04-fila.txt).

## Critério 14: `civico-etl check`

Medido contra a linha de base (decisão AC-07): no banco só migrado o `check` já sai com código 1 por 5 invariantes que dependem de carga real. Saídas: primeira-rodada-00-check-antes.txt (antes de qualquer rodada, 6 invariantes quebradas), primeira-rodada-09-check.txt e primeira-rodada-09-check-conferencia.txt (depois).

Invariantes quebradas depois da rodada:

- UF: exatamente 1 governador titular em exercício (salvo exceção listada com motivo) (25)
- UF: governador e vice em exercício = lista conferida na fonte oficial (GOVERNO_POR_UF), e vaga com motivo (54)
- cota: amostra fixa de deputados e anos = total da Câmara (±0,5%) (20)
- câmara: exatamente 513 em exercício, todos com partido vigente (513)
- município: exatamente 1 prefeito titular em exercício (salvo exceção listada com motivo) (1)
- senado: exatamente 81 em exercício, todos com partido vigente (81)

As 5 da linha de base: câmara 513, senado 81, cota, governador titular e governador/vice. A sexta, `município: exatamente 1 prefeito titular em exercício`, não é da linha de base: ela é causada por `admin_base.sql`, que cria o município fabricado 1190099 sem prefeito. Ela já estava quebrada ANTES da rodada (mesmo conjunto de invariantes quebradas no passo 00 e no passo 09, conferido pelo roteiro), então não é efeito da rodada, mas o critério como medido ('nenhuma invariante quebrada além das cinco') NÃO fica estritamente atendido neste banco. O roteiro tolera exatamente essa invariante, e só ela, depois de conferir que o único município do banco é o 1190099, e imprime a ressalva no resumo. A decisão de manter o município fabricado neste banco (a fase da central o usa) ou de tirá-lo é do orquestrador.

## Diferenças em relação ao relato anterior

O relato anterior foi feito antes das migrações 0152 (endurece a central/executor) e 0153 (pedidos de decisão, role da central) e cobria só os passos 1 a 5.

- Banco: 42 migrações aplicadas (eram 40: 0152 e 0153 entram). A rodada continua num `admin_coleta_r1` recriado do zero.
- Passos 1 a 5: os NÚMEROS não mudaram (URLs tentadas, lidas, reaproveitadas, falhas, propostas, pendências, contagens e hashes por tabela, edição candidata, fila); só mudaram ids e horários. O roteiro refeito não encontrou diferença de comportamento nesses passos com a 0152 e a 0153.
- Novo: etapa 10 (município fabricado, `sapl.camaras`, v1 e v2) e etapas 11 a 15 (passos 6 a 9 pela central, com executor), mais a conferência de que o `check` depois do fluxo quebra as mesmas invariantes de antes.
- Novo no roteiro: o aviso explícito de que a contagem do território de município não é medida (item "Limite" do passo 6), e o filtro do ruído `failed to copy trust settings` do uv nas partes do fluxo (a saída bruta fica em primeira-rodada-11-fluxo-central-bruto.txt).
- Sem mudança: a ressalva do critério 14 (a sexta invariante do `check`, por causa do município fabricado de `admin_base.sql`) continua. O município agora também foi lido por rodadas, e o `check` seguiu igual.

## O que esta rodada não prova

- Nada do que está acima foi lido do SAPL de nenhuma casa. Os nomes, números e textos das respostas são inventados; os cenários v1 e v2 foram desenhados para exercitar mudança de status, bloqueio por robots.txt e leitura bem-sucedida depois de falha. A frequência, o tamanho e os erros de uma carga real não estão representados.
- `sapl.camaras` foi exercitada só sobre a fixture fabricada de UM município (1190099, hosts `.invalid`). Não representa o registro real do Interlegis, a variedade de SAPL das câmaras nem o volume (centenas de hosts).
- Passos 6 a 9 foram pela API HTTP da central, não pela tela: não há clique, captura de tela, abertura de UF e município no mapa, nem a medida da consulta periódica de 5 s (critérios 21 e 26, Playwright, AC-05). A contagem do território de município não foi lida por este roteiro (ver passos 6 e 7).
- O fluxo da central usa o cenário v2 inteiro e o mesmo cache das etapas anteriores: a recoleta do município releu 24 URLs porque a carga completa da casa nova ainda não existia, não por efeito da pendência.
- Os pareceres dos passos 3 e 8 foram de ensaio local (regra fixa, sem modelo). Não há avaliação da qualidade de um parecer de IA nem do verificador.
- Nenhuma decisão de agentes existe no banco (conferido: 0 decisões de agentes, também depois do passo 9); as decisões dos passos 2 e 9 são de uma pessoa fictícia, só para o ensaio. O comportamento com as duas chaves dos agentes ligadas não foi exercitado.
- A rodada não exerce decisões `corrigir`, `descartar` e `pedir_confirmacao` pela CLI; elas são cobertas por testes (`etl/tests/test_admin_candidata.py` reproduz em processo a sequência com corrigir aplicado, aprovar, descartar, corrigir sem aplicar e duas fontes divergentes).
- A rodada v2 não gera proposta de cobertura (as casas carregadas na v1 ficam fora da fila de recarga por 6 dias), então a classe `cobertura` do proponente só aparece como primeiro preenchimento.
- Reprocessar e repetir não refazem a carga de matérias dentro do prazo de 6 dias (passos 4 e 5), e por isso nada aqui prova reconstrução das tabelas `sapl_*` a partir do bruto.
- A comparação entre duas execuções cobre os números do relatório, da edição candidata e das contagens; hashes de tabela não são comparados entre execuções porque as tabelas guardam horários da própria execução.

## Achados da execução (para o orquestrador)

1. `check` com a sexta invariante quebrada por causa do município fabricado de `admin_base.sql` (seção do critério 14; saídas em primeira-rodada-00-check-antes.txt e primeira-rodada-09-check.txt).
2. No passo 2, `decidir --acao aprovar --aplicar` numa mudança que o job já tinha gravado na tabela (PB) produziu `aplicada: vinculo_sapl:5:status  'ok' -> 'ok'`, sem linha em `corrections` (`sem corrections (o valor anterior é igual ao novo)`) e com um override vigente que passa a fixar o campo (primeira-rodada-05-decidir-pb.txt, primeira-rodada-05-conferencia-sql.txt). Mesmo assim o relatório da rodada v2 conta `registros alterados 1 de 2`, e a seção `aplicadas` da edição candidata mostra `fora_do_ar -> ok`, valor que vem da proposta (vigente na leitura) e não da aplicação. Não classifico isto como defeito nem como desenho: a decisão é do orquestrador.
3. O relatório de uma rodada, lido depois da decisão, muda (`registros alterados` de 0 para 1, `confirmados` de 0 para 1): por desenho, o painel de revisão é calculado na hora. Por isso há duas colunas da rodada v2 na tabela.
4. O fluxo da central (`sem-navegador.mjs --fluxo`) passava sem medir nada para território de município (imprimia `undefined`). Corrigido pelo orquestrador: agora mede a contagem da UF que contém o município e avisa que a do município só o Playwright prova. A rodada final foi refeita depois da correção.
5. O pedido de parecer feito pela central grava `adm_pedidos.rodada_id` nulo (o parecer não abre rodada) e a recoleta do município releu a carga inteira da casa nova (24 URLs): comportamento esperado do coletor, só registro.
