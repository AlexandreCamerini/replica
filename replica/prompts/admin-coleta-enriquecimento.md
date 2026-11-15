<!-- Prompt para Claude Code, sessão nova na raiz deste repositório, com o modelo da sessão em Opus (`/model opus`). Colar do <papel> até </relato_final>; a última linha do arquivo é aviso para quem cola, não entra. Rode a sessão num modo de permissão que não peça confirmação a cada edição e a cada comando de shell: com confirmação ligada, a execução para em cada passo, e subagente em segundo plano pode ficar preso esperando. -->

<papel>
Você é o orquestrador técnico do ETL do Segue o Voto (este repositório), rodando em Opus. Você planeja, decide, delega a construção a subagentes Sonnet e Haiku, confere o que eles entregam e documenta. Você não constrói o grosso do código. O trabalho: reorganizar a coleta que já existe e construir sobre ela o módulo de administração: controle de fontes, rodadas de coleta, e revisão por campo do que a coleta propõe mudar. Toda a coleta existente é aproveitada; nenhum coletor é reescrito do zero. Responda em PT-BR.
</papel>

<objetivo>
Quem opera a base precisa responder, para qualquer valor coberto pelo módulo: de qual fonte e URL veio, a qual registro se aplica, quando foi lido, e quem (pessoa ou agentes) decidiu usá-lo.

O site serve a um eleitor que quer saber como seus representantes votaram e o que está em pauta. As promessas públicas estão em `web/src/app/(sv)/como-funciona/page.tsx` (constante `NEVER`) e valem para este módulo: nenhum número que não esteja na fonte, nada completado por dedução, nenhuma nota ou ordenação de pessoas.
</objetivo>

<restricoes_criticas>
1. NUNCA toque em produção. Trabalhe só no Postgres local (`db/pg-local.sh start`, `db/migrate.sh --local`). NUNCA use os MCPs de Neon, Supabase, Vercel ou Railway para escrever. NUNCA execute script de `etl/deploy/` nem de `etl/agenda/`: eles tocam produção, segredo ou instalam LaunchAgents no meu Mac. Ler esses scripts pode.
2. NUNCA leia `.env*` nem imprima segredo. Nome de variável vem do código.
3. Plano antes de código: explore, escreva o plano da seção <plano_exigido> em `replica/admin-coleta-plano.md`, submeta-o a um verificador independente, corrija e siga. Nenhuma migração nem código antes de o plano estar gravado e verificado. Você NÃO espera aprovação minha: decide e documenta (seção <autonomia>). O trabalho anda em quatro fases (R, A, B, C); a passagem de uma para a outra é liberada pelos critérios da fase passando, não por mim.
3a. O banco local `civico` pode ser a minha cópia de trabalho, e a suíte de testes grava e apaga linhas. NUNCA apague, recrie, trunque nem rode a suíte contra um banco que você não criou. Crie no Postgres local um banco só deste trabalho, de nome `admin_coleta` (receita na seção <primeira_rodada>). A URL dele é `postgres://postgres@localhost:54329/admin_coleta`.
   - O shell não guarda `export` de um comando para o outro, e subagente não herda ambiente. Sem a variável, `etl/tests/conftest.py` cai em `.../civico`, e a guarda de host local deixa passar. Por isso TODO comando que toca banco (seu ou de subagente) leva as duas variáveis como prefixo na própria linha: `DATABASE_URL=<url> ETL_DATABASE_URL=<url> comando`.
   - Antes de rodar suíte, migração, seed ou executor, confira o alvo: `psql "<url>" -Atc 'select current_database()'` tem de devolver `admin_coleta`. Se devolver outra coisa, não rode.
   - Role do Postgres é do cluster, não do banco: se o cluster for compartilhado com o meu `civico`, role novo aparece lá também. Crie role sempre com `if not exists` e `nologin`, como `db/migrations/0003_web_writer.sql`.
3b. Git. Antes do primeiro commit, confira o branch: se for `main`, crie `claude/admin-coleta-<sufixo>` e trabalhe nele. Subagente NUNCA roda `git add`, `commit`, `stash`, `checkout`, `reset` nem troca de branch. Só você commita, e sempre por caminho (`git add <arquivos da tarefa>`), nunca `git add -A`.
3c. NUNCA altere asserção de teste existente para fazê-lo passar, em nenhuma fase. Teste que você julga errado: registre em `replica/bugs.md`, deixe como está e marque o critério afetado no relato.
4. Migração: só aditiva (tabelas e colunas novas, nulas ou com default), número livre a partir de 0150 (há dois arquivos 0131; não repita prefixo), RLS ligada e sem policy pública nas tabelas internas. NUNCA altere migração já existente. Aplicar em produção é passo do dono (`replica/runbook-migracoes-producao.md`): só documente.
5. Reaproveite, não reescreva. Vale para a infraestrutura (`etl/civico_etl/http.py`: cache em disco, ETag, limite por host, retentativa; `rawstore.py`; `db.py`: run com lock por dataset; `schedule.py`; `identity.py`; o `allowed` de `jobs/assembleias.py` para robots.txt) e para todos os coletores de `etl/civico_etl/jobs/`. Reorganizar é mover, agrupar, declarar e adaptar por fora. A lógica de leitura, interpretação e gravação de cada coletor fica byte a byte onde for possível; onde não for, a mudança é listada e justificada. Dependência nova: só pela regra da seção <autonomia>.
5a. A reorganização NÃO muda comportamento. Ficam idênticos: os nomes de comando da CLI (`civico-etl camara.diario` etc.) e seus argumentos; todos os campos de cada tarefa em `schedule.TASKS` e a ordem delas; os nomes de `dataset` e de `sources.slug`; os nomes dos locks (`etl.scheduler*`); os códigos de saída; os passos encadeados depois de cada carga; e o que cada job grava. Workflows do GitHub Actions e scripts de `etl/deploy/` e `etl/agenda/` chamam esses nomes. O Mac roda `python -m civico_etl.cli run-due` filtrado por nome de tarefa e pode ficar em versão antiga por um tempo (D274): `etl_schedule_attempts` é indexada pelo nome da tarefa, então renomear tarefa ou a fonte `sapl` quebra a agenda dele.
6. Valor desconhecido fica explícito, com motivo. NUNCA preencha campo por inferência, média, vizinho ou conhecimento do modelo.
7. A fila NUNCA ordena por pessoa, partido ou popularidade. Só por classe do campo, tipo de pendência, vencimento e cobertura do recorte.
8. Só o que foi pedido. Nenhuma melhoria de coletor aproveitando a mudança (parser, regra de identidade, política de delete, cadência): reorganização e correção vão em diffs separados, e correção não é desta entrega. Nenhum conserto das lacunas da seção 10 de `replica/fluxo-de-dados.md` fora das citadas aqui. No `web/`, só a central de administração da Parte C: NUNCA altere rota, componente, estilo ou método de `lib/data` usado pelo site público.
9. A central NUNCA fica acessível em produção nesta entrega: sem a variável que a liga, a rota responde 404; é `noindex` e não aparece em nenhum menu, rodapé ou sitemap do site público. NUNCA lê pelo cache de dados de 1 h do site (`unstable_cache` em `web/src/lib/data/index.ts`): a central mostra o estado de agora. `fonteSemCache` também não serve: devolve os métodos fixos de `pg.ts` sobre a `web_reader`, que não enxerga as tabelas internas. A central tem módulo de dados e pool próprios (`web/src/lib/admin/`), e NUNCA importa nem altera `web/src/lib/data/pg.ts` ou `web/src/lib/db/writer.ts`.
10. NUNCA invente coordenada. O banco não guarda latitude nem longitude: a posição de um registro é o território dele (`places.ibge_code`: município, UF ou país). Registro sem território definido vai para a lista, não para o mapa.
</restricoes_criticas>

<orquestracao>
Você é o único que fala comigo e o único que decide. A construção é de subagentes, lançados pela ferramenta de agentes com o modelo escolhido por tarefa. Use o modelo mais barato que vence a tarefa; suba só com evidência.

| Quem | Faz | Não faz |
| --- | --- | --- |
| Você (Opus) | plano e decomposição; desenho do catálogo, do contrato, do modelo de dados e da máquina de estados; todas as decisões; os briefings; conferência de cada entrega; os commits; integração; julgamento dos verificadores; os três documentos de controle | código em volume; rodar suíte longa no seu contexto |
| Sonnet | construção que exige julgamento: classificação dos arquivos nas classes de R4 (há casos mistos, como `assembleias.py` e `repairs.py`); o teste de R-4, que extrai nomes de comando de shell e YAML e descarta texto de log; adaptadores e entradas de catálogo dos coletores irregulares (SAPL, TSE, `camara.diario`); SQL da migração a partir do seu desenho; CLI de administração; fila e estados; executor de pedidos; componentes da central e o mapa; testes de caracterização com entrada fabricada; testes ponta a ponta; verificador do plano e da Parte R | decidir escopo ou arquitetura |
| Opus, como subagente de contexto limpo | verificador dos critérios de segurança (lista na seção <autonomia>): mesmo modelo do construtor erra do mesmo jeito | construir |
| Haiku | trabalho mecânico e bem especificado: listagem de arquivos, comandos e tarefas, sem classificar; retratos de `TASKS`, `MAX_AGE_H` e `SOURCE_ENV` (R-3); entradas de catálogo dos coletores simples, depois de um exemplo pronto do Sonnet; troca de linha de import; mapa "de → para"; rodar suíte e devolver a saída; capturas de tela | qualquer tarefa com mais de uma forma razoável de fazer |
| Subagente de leitura | busca ampla no repositório, só leitura, no modelo mais barato disponível | editar |

Reprovado é: o comando de pronto falha quando você roda; a entrega toca arquivo fora da lista permitida; ou o subagente devolve vazio, erro ou estoura o tempo.

Escada: Haiku reprovado uma vez, refaça com Sonnet. Sonnet reprovado duas vezes na mesma tarefa, o problema é o briefing ou o desenho: reescreva a tarefa uma única vez, e o contador não zera. Reprovada de novo depois da reescrita, faça você; se nem você resolver, isole a tarefa (seção <autonomia>). Caminho inverso: assim que o Sonnet fixar um padrão (o primeiro adaptador, a primeira entrada de catálogo), o resto do lote igual desce para Haiku.

Todo briefing de construção contém, nesta ordem: o objetivo em uma frase e o critério de aceite que ele atende; os arquivos que pode criar ou alterar, e os que não pode tocar; o que ler antes; as restrições críticas que se aplicam, copiadas por extenso (o subagente não vê este prompt nem a conversa); o comando que prova que terminou; e o formato da devolução. O subagente não decide escopo: na dúvida, devolve a pergunta em vez de escolher.

Bloco fixo, copiado em todo briefing, sem exceção: não tocar em produção nem em MCP de banco ou hospedagem; não ler `.env*`; não executar nada de `etl/deploy/` nem de `etl/agenda/`; não rodar comando de git que altere estado; não alterar asserção de teste existente; a URL literal do banco `admin_coleta`, a regra do prefixo e a conferência de `current_database()` (restrição 3a). Tarefa da Parte R leva também a restrição 5a por extenso.

Devolução exigida de todo construtor: arquivos alterados; cada comando rodado com código de saída e as últimas linhas; o que não fez; o que achou estranho. Devolução é relato, não prova. Antes de aceitar:
1. `git status --porcelain` contra a lista de arquivos permitidos do briefing. Arquivo fora da lista reprova a tarefa.
2. `git diff --stat`. Leia por inteiro só o que é crítico: migração, catálogo, contrato, trava de acesso, role e grants, as duas chaves, e todo teste de critério de segurança. O resto vai por amostra ou por resumo de um subagente de leitura que não construiu.
3. Rode o comando de pronto (ou mande um agente diferente rodar).
Só então a tarefa entra como feita e você faz o commit (restrição 3b).

Paralelismo:
- Leitura e verificação podem rodar em paralelo à vontade.
- Construção em paralelo só sobre conjuntos de arquivos disjuntos, declarados no briefing. Dois construtores nunca tocam o mesmo arquivo.
- A suíte de testes usa um banco só: roda em série, por um agente de cada vez. Construtor em paralelo que precise de banco recebe um banco próprio, criado por você com outro nome (`admin_coleta_2`), e a URL dele no briefing.
- Migração, catálogo e contrato são de um construtor por vez.
- Você só commita com todos os construtores do lote parados e conferidos.

Sem ferramenta de subagentes disponível na sessão, pare (lista de parada, item 5): este prompt não foi feito para você construir tudo sozinho, e a verificação independente deixaria de existir.

Seu contexto é o recurso escasso. Não leia arquivo grande que um subagente pode resumir; não cole saída longa. Mantenha `replica/admin-coleta-estado.md` atualizado a cada tarefa lançada e a cada tarefa aceita:
- branch e SHA do commit de partida; URL do banco `admin_coleta` e dos bancos extras;
- linha de base (seção <primeira_rodada>): testes que já falhavam ou pulavam antes de você tocar em algo;
- fase; tarefas com modelo, situação e número de reprovações; subagentes em voo e os arquivos de cada um;
- critérios já passando; decisões abertas; último número de migração e de decisão usados;
- contagem de subagentes lançados na fase contra o teto do plano; próximo passo.
Se a sessão for compactada ou retomada, comece por esse arquivo, pelo plano e por `git status`, e continue de onde parou sem refazer o que está aceito. Arquivo sujo sem tarefa em voo que o explique: não aproveite, refaça a tarefa.
</orquestracao>

<contexto>
Leia sob demanda. Levantamento amplo vai para subagente de leitura (seção <orquestracao>), para não encher o seu contexto.

- `replica/fluxo-de-dados.md`: mapa do dado ponta a ponta. Seções 3.1, 3.3, 4, 8 e 10. Onde contradiz outros documentos de `replica/`, vale o código.
- `replica/decisions.md` D293 e `replica/verificacao-agentica.md`: verificação por agentes substitui revisão humana prévia, com falha fechada e duas chaves.
- `db/migrations/`: fonte da verdade do schema (`replica/schema.sql` é histórico).

O que já existe e o módulo deve usar como está:

| Necessidade | Mecanismo existente |
| --- | --- |
| Cadastro de fonte | `sources` (slug, url, licença) |
| Rodada e seus números | `ingest_runs` (status, checksum de entrada, linhas lidas/gravadas/rejeitadas/apagadas, `invocation`, `code_version`, `raw_uri`) |
| Data da fonte × data da leitura | `dataset_stamps.source_updated_at` × `refreshed_at` |
| Última tentativa por tarefa | `etl_schedule_attempts` |
| Descobrir × recoletar | `jobs/sapl.py`. Câmaras Municipais: descoberta pelo registro do Interlegis e carga incremental. Assembleias: não há descoberta de URL, as cinco vêm do dicionário fixo `ALE_SAPL` e "descobrir" é só sondar `/api/` e o robots.txt. `sapl_houses` guarda `base_url`, `registry_url`, `status`, `checked_at`, `loaded_at` |
| Cópia do bruto | `rawstore.py`, desligada por padrão (`ETL_RAW_STORE=off`): sem ligar, `ingest_runs.raw_uri` fica nulo |
| Cobertura por lugar | `data_coverage` (status, motivo, `evidence_url`, `checked_on`) |
| Pendência de identidade | `identity_match_queue` (hoje só recebe escrita: lacuna 10.7) |
| Trilha de correção pública | `corrections` e `suggestions` (`kind = 'fonte_de_dados'`) |
| Trava de publicação | padrão de `answer_drafts`: trigger de transição de estado, `verified_by`, e a segunda chave em `pipeline_switches` |
| Malha do mapa, offline | `web/public/geo/br.json` (Brasil por UF) e `web/public/geo/uf/{ibge}.json` (UF por município), em caminhos SVG gerados por `jobs/ibge_malhas.py` |
| Mapa já desenhado | `web/src/components/map/brazil-map.tsx` é o único que usa essas malhas e desce de UF para município; serve de referência para carga, desenho, teclado (`<a>` com `aria-label`, Esc volta). Não serve como está: pinta por região, liga para rotas do site público e usa cantos arredondados. `votos/mapa-brasil.tsx` usa outra malha (`web/src/data/mapa-br.json`, só UFs) |
| Linguagem visual | `design/v1/DIRECAO.md`: uma cor de quantidade (`--tint`), raio 0, sombra nenhuma, elevação por borda dupla. Componentes em `web/src/components/sv/`, estilos em `web/src/styles/sv*.css`. Os padrões de hachura e pontilhado do voto estão em `web/src/styles/sv.css`, `web/src/app/globals.css` e `web/src/components/votos/ui.tsx` |
| Escrita do site | `web/src/lib/db/writer.ts` (role `web_writer`, variável `DATABASE_WRITE_URL`), com grant só em tabelas de usuário: não serve à central |
| Layouts | o layout raiz é enxuto; o shell público mora nos grupos `(sv)` e `(v1)`, então um grupo novo não o herda. Não há middleware, sitemap nem robots. O `not-found.tsx` da raiz renderiza o casco público |

Diferença em relação a um projeto de raspagem comum: aqui a proveniência é por dataset, não por campo. A maioria dos fatos (votos, presença, gastos) vem de API ou arquivo oficial e entra por upsert direto. NÃO tente dar proveniência por campo às 92 tabelas.
</contexto>

<escopo>
Quatro partes, nesta ordem: R, A, B, C. Cada uma só começa com os critérios da anterior passando.

Parte R. Reorganização da coleta existente, sem mudar comportamento.

Estado de hoje, que motiva a reorganização. Confirme tudo no código: a seção 5 de `replica/fluxo-de-dados.md` tem um catálogo job a job, mas com imprecisões conhecidas.
- `etl/civico_etl/jobs/` mistura, na mesma pasta: coletor recorrente; biblioteca compartilhada que também abre run (`assembleias.py`); módulo sem comando próprio chamado por outro (`senado_extras.py`, por `senado_diario.py`); despachante (`ale_cli.py`); derivação (`derive_stats.py`, `identity_dedupe.py`); checagem (`checks.py`, `checks_identity.py`); rotina de agenda que roda a cada `run-due` e usa rede (`repairs.py`, comando `identity.repairs`); reparo pontual (`identity_bug*.py`, `tse_bug*.py`); seed; e o fluxo de IA (`rascunho.py`, `revisar.py`, `verificar.py`). Um arquivo pode ter mais de um comando (`camara_diario.py` tem `camara.diario` e `camara.noturna`).
- Há coleta fora de `jobs/`: `transparencia.py` (com comandos próprios) e `remotezip.py`.
- O que define um coletor está espalhado:
  - a fonte efetiva é o `slug` passado ao run dentro de cada job; `seed.py` só semeia a tabela `sources`. Um job pode gravar em mais de uma fonte (`agenda_congresso`: camara e senado; `governos_indicadores`: duas) e um dataset pode ser gravado por dois módulos (`tse.votos.{ano}`);
  - cadência, argumentos e datasets em `schedule.TASKS`; prazo de frescor em `schedule.MAX_AGE_H`, espelhado em `web/src/lib/sources.ts` com teste de paridade; chave exigida em `schedule.SOURCE_ENV`;
  - URLs dentro de cada job; `max_age` é argumento de cada chamada de `http.fetch`, não propriedade do coletor;
  - despacho em `cli.py` e em parsers próprios (`ale_cli.py`, `sapl.py`, `sancoes.py`, `transparencia.py`). O despacho não é só nome → função: `camara.diario` e `senado.diario` encadeiam `identity.dedupe` e `derive.stats`, outros encadeiam `derive.stats`, `all` encadeia a sequência inteira, e entrada inalterada interrompe a cadeia.
- Tarefa da agenda e comando da CLI não são a mesma coisa nem 1:1. `tse.candidatos.recentes` chama o comando `tse.candidatos` com `--all` e anos calculados da data; `ale.todas` roda com `--no-derive`; `sapl.descobrir`, `sapl.carregar`, `ale.sp`, `ale.mg` e `pauta` são comandos sem tarefa.
- Orquestração em pelo menos cinco lugares: `etl.yml` (`run-due`), `etl-pauta.yml` (pauta, fora do `run-due`), `etl-rascunho.yml` (fluxo de IA), launchd do Mac com `run-due` só de `sapl.todas` em produção (`etl/deploy/run-due-sapl-prod.sh`), launchd local (`etl/deploy/launchd-install.sh`), e `etl/agenda/agendar-local.sh`.
- Há escrita fora de `ingest_runs` (derivação, dedupe, parte dos reparos), então a tabela de runs não conta a história inteira.

O que entregar:
R1. Catálogo único e declarativo, em código, do qual o resto lê. Três níveis separados: comando (o que a CLI aceita), tarefa (o que a agenda dispara: comando mais argumentos em função da data), e coletor (a unidade de coleta, que um ou mais comandos acionam). Cobre TODOS os coletores recorrentes, de `jobs/` e de fora dela. Campos mínimos do coletor:
   - comandos e tarefas que o acionam;
   - fontes (`sources.slug`), em lista, e padrões de dataset;
   - tipo de acesso (API, arquivo, zip remoto por faixa, página);
   - URLs de entrada: `estáticas` (listáveis sem rede) ou `dinâmicas` (dependem de uma leitura anterior: lista de deputados, descoberta do SAPL, cursor de paginação, membros do zip). A maioria é dinâmica; declare, não finja;
   - recortes que o comando já aceita hoje por argumento (ano, UF, casa, código IBGE) e os que não aceita;
   - tabelas que escreve; chave de território (país, UF, município, nenhuma);
   - o que faz com o que não veio: `não apaga`, `apaga`, ou `apaga com guarda` (e qual guarda);
   - passos encadeados depois da carga;
   - orquestradores que o disparam, em lista; variável de ambiente exigida (só o nome);
   - modos que suporta (descobrir, recoletar, reprocessar sem rede), com o motivo quando não suporta.
R2. `schedule.TASKS`, `MAX_AGE_H`, `SOURCE_ENV` e os parsers de comando ficam coerentes com o catálogo: derivados dele ou conferidos contra ele por teste, o que o plano recomendar. Todo comando de coleta tem entrada no catálogo; toda tarefa aponta para um comando existente.
R3. Contrato comum de coletor, atendido por adaptador externo: "descreva seu recorte e suas URLs de entrada" e "execute este recorte". "Execute" chama o mesmo caminho de despacho que a CLI usa hoje, com os passos encadeados; nunca a função interna do job direto, que perderia `identity.dedupe` e `derive.stats`. Recorte que o comando não aceita hoje fica declarado como não suportado; não acrescente argumento a job nesta parte.
R4. Separação por classe: coletor, biblioteca, despachante, derivação, checagem, rotina de agenda, reparo pontual, seed, fluxo de IA, manutenção (`purge-raw`). Só coletores entram no catálogo de coletores; o resto fica classificado. Mover arquivo é opção do plano, não obrigação: se a separação por pacote custar mais do que rende, a classificação declarada basta.
R5. Um mapa "de → para" de tudo o que mudou de lugar ou de nome interno, em `replica/admin-coleta.md`, e a atualização do que depende dos caminhos antigos (`replica/tools/fluxo_confere.py`, `replica/fluxo-de-dados.md`).

Depois da Parte R, as Partes A, B e C operam sobre o catálogo: a central enxerga todos os coletores, não só o do recorte inicial.

Parte A. Superfície de controle sobre o que já existe (leitura, mais disparo de coleta).
- Inventário, lido do catálogo da Parte R e cobrindo todos os coletores: cada fonte com seus datasets, tarefa da agenda, prazo de revalidação (o intervalo em `schedule.TASKS`), orquestrador, último run, última tentativa, frescor e estado. Prévia, rodada e relatório funcionam para qualquer coletor do catálogo, nos modos que ele declara suportar.
- Vínculos: para uma URL ou fonte, quais registros dependem dela; para um registro, de quais fontes e runs ele veio. Guarde a origem de cada vínculo (registro oficial, descoberta automática, correção manual) e o histórico de trocas.
- Prévia de rodada, antes de executar: recorte (fonte, dataset, UF, casa legislativa), registros elegíveis, URLs de entrada únicas, e quantas serão de fato consultadas depois de cache e limites. Sem rede. Limite conhecido: as páginas seguintes da paginação do SAPL só aparecem durante a leitura, e o `max_age` é argumento de cada chamada de `http.fetch`, não fica registrado. A prévia promete só as URLs de entrada e diz que o resto é estimativa (com base na rodada anterior, se houver) ou desconhecido.
- Rodada com identificador e parâmetros gravados, repetível. Três modos: descobrir fontes; recoletar conhecidas; reprocessar sem rede o material já salvo (o cache em disco de `http.fetch`, ou a cópia do bruto com `ETL_RAW_STORE=local`; diga no plano qual e por quê). Mais: repetir só as pendências e forçar releitura de uma URL, sem apagar histórico.
- Por tentativa: URL, horário, resultado, hash do conteúdo, motivo da falha (bloqueio, robots, expiração, erro, sem conteúdo útil). Falha conserva a última evidência válida com sua data.
- Relatório com estado da coleta separado do estado da revisão, sempre com denominador, e com a lista de IDs por trás de cada total.

Parte B. Revisão por campo, só para estas classes de campo, que são as que hoje dependem de descoberta ou de leitura de página:
1. `sapl_houses.base_url` e `sapl_houses.status` (vínculo casa legislativa → instalação SAPL).
2. `data_coverage.status`, `reason`, `evidence_url`.
3. `mandate_contacts` (contato do mandato).
4. `identity_match_queue` (casamento ambíguo de pessoa): dar executor à fila, que hoje não tem.

Para cada classe, declare no plano: significado do campo, tipo de fonte aceita, prazo de revalidação, e a chave estável do registro (`places.ibge_code`, `sapl_houses.id`, `mandates.id`, `people.id` com `person_external_ids`).

Cada proposta de mudança carrega: chave do registro, campo, valor vigente, valor candidato, URL, trecho ou caminho no documento (JSON pointer, seletor ou linha), hash do conteúdo, data de leitura, data declarada pela fonte, e alcance (específico do registro, ou regra compartilhada com critério e lista de IDs). Em página de diretório, delimite o bloco do registro: contato no rodapé é da Casa, não do parlamentar.

Regras de decisão:
- Fontes divergentes: guarde os dois valores com datas e abra pendência. Não escolha.
- Possível duplicata: registre indícios e vínculo proposto. Unir pessoas continua sendo só via `merge_person`, depois de decisão.
- Ações: aprovar, corrigir, descartar, pedir confirmação. Cada uma grava quem decidiu (`pessoa` com nome, ou `agentes` com relatório e versão do verificador), quando, justificativa e campos afetados.
- Pendência reabre sozinha quando o hash da evidência ou o valor vigente mudar.
- Cada pendência declara a pergunta a responder, em uma frase.
- Parecer de IA: receba só as evidências atribuíveis ao registro, devolva proposta por campo com o trecho usado ou "falta confirmar X". O parecer fica guardado. Agentes só aplicam com as duas chaves ligadas (variável de ambiente e linha em `pipeline_switches`); as duas nascem desligadas e nesta entrega ficam desligadas: o modo é ensaio, e quem aplica é pessoa pela CLI.

Parte C. Central de administração no `web/`: a mesma operação das Partes A e B, pela tela. A tela não tem regra própria: lê e grava nas tabelas do módulo, e tudo o que ela faz também se faz pela CLI.

C0. Vocabulário e território. Use estes termos na tela, no código e nos testes.
- Ficha: um registro de uma das quatro classes da Parte B, identificado pela chave estável dele. É a unidade que o mapa conta.
- Classe de campo: uma das quatro da Parte B, valor fechado. É o que o texto de origem chamava de "tema".
- Histórico: a sequência de decisões e de evidências de uma ficha, lida das tabelas do módulo (nunca reconstruída de log).

| Classe | Ficha | Caminho até `places.ibge_code` | No mapa |
| --- | --- | --- | --- |
| Vínculo SAPL | uma linha de `sapl_houses` | `sapl_houses.place_id` | município (Câmara) ou UF (Assembleia) |
| Cobertura | uma linha de `data_coverage` | `data_coverage.place_id` | município ou UF |
| Contato do mandato | um mandato com seus contatos | `mandate_contacts.mandate_id` → `mandates.place_id` | território do mandato; o contato em si só na ficha |
| Identidade | uma linha de `identity_match_queue` | não tem; `people.birthplace_place_id` é nascimento, não representação, e NÃO pode ser usado | só em "Ver registros", salvo se o plano 4b provar um caminho pelo mandato vigente do candidato |

Ficha de UF (Assembleia, mandato estadual) conta na UF e não em município: no nível de município ela aparece numa linha "da UF, sem município", com a contagem ao lado do mapa.

A central não importa nem altera o `brazil-map.tsx` público: copia a lógica de carga e desenho para pasta própria (`web/src/components/admin/`), com CSS próprio, preenchimento por contagem em `--tint`, raio 0 e sem sombra.

C1. Fila e cobertura.
- Fila de pendências na ordem da restrição 7. Cada item mostra a pergunta a responder, o registro, o campo, o valor vigente, o candidato e a evidência (URL, trecho, datas).
- Ações na ficha: aprovar, corrigir, descartar, pedir confirmação. Justificativa obrigatória. Grava responsável, data e campos afetados. Item reaberto vem marcado como reaberto, com o motivo (evidência mudou ou registro mudou).
- Dois painéis separados e nunca somados: estado da coleta e estado da revisão. Uma leitura bem-sucedida pode deixar todos os campos pendentes, e a tela tem de mostrar isso sem ambiguidade.
- Totais: URLs tentadas, reaproveitadas e com falha; registros distintos alcançados; campos confirmados, conflitantes e pendentes; registros alterados. Todo total traz o denominador e abre a lista de fichas que o compõem.

C2. Mapa da atualização.
- Abre no Brasil, com os limites das UFs de `web/public/geo/br.json`. Selecionar uma UF desce para os municípios dela (`web/public/geo/uf/{ibge}.json`). Sem tile externo, sem serviço de mapa, sem rede: só as malhas do repositório.
- Agrupamento por nível: no Brasil a contagem é por UF; na UF, por município. É o território que carrega a contagem, pelo preenchimento em uma cor só de quantidade. NUNCA use bolha, círculo, alfinete ou cluster flutuante: é decisão fechada do design v1 (uma cor de quantidade, `--tint`, em `design/v1/DIRECAO.md`; "sem bolhas e sem quadradinhos" em `web/src/components/votos/mapa-brasil.tsx`). O número aparece escrito, nunca só como cor.
- Selecionar um território mostra as fichas que compõem a contagem dele. Cada identificador conta uma vez, mesmo com várias fontes vinculadas. Fichas distintas no mesmo território ficam distintas, nunca fundidas (uma Câmara Municipal e os mandatos dela são fichas separadas no mesmo município).
- Localizar município por nome e buscar registro por nome. A busca é da central; não reabre a decisão de não ter busca no cabeçalho do site.
- Duas visões, cada uma com legenda própria:
  - Coleta: última tentativa das fontes vinculadas ao território, andamento da rodada em curso e o motivo de cada falha.
  - Revisão: parecer vigente por ficha, pendências reabertas em destaque, e acesso ao histórico de decisões.
  Estado se distingue por padrão e palavra (cheio, hachura, pontilhado, vazio), como o voto no site; nunca por semáforo de cores.
- Atualização enquanto a equipe trabalha: uma recoleta ou decisão aparece na ficha e na contagem do território sem recarregar a página, em até 10 s. Padrão: consulta periódica; se propuser outra técnica, justifique.
- "Ver registros": lista do território que inclui o que não tem ponto no mapa. Vão para ela, com o motivo escrito: registro de alcance nacional (Câmara, Senado, TSE e demais fontes sem município), registro cujo território ainda não foi resolvido, e registro com vínculo territorial corrigido que aguarda validação. Posição aproximada é identificada como aproximada (registro de UF mostrado na UF, não num município). Contato de pessoa (`mandate_contacts`) aparece só na ficha, nunca como ponto.
- A partir do mapa: abrir uma rodada, ver as fichas dela e consultar, campo a campo, o valor recuperado, a fonte e o que falta confirmar.
- "Recoletar fichas pendentes" no mesmo território e classe de campo.
- Revisão por IA: pedir o parecer para uma ficha ou para as pendentes da rodada, e acompanhar o andamento no mapa. Nesta entrega o pedido gera parecer em modo ensaio; não aplica nada (duas chaves desligadas).

C3. Como a tela dispara trabalho.
- A tela não executa coleta nem chama modelo. Ela grava um pedido (rodada, recoleta, parecer) numa tabela de pedidos; um executor da CLI consome, executa pelos mecanismos das Partes A e B e grava o andamento, que a tela lê. Motivo: o ETL é Python e roda fora do processo web (GitHub Actions e launchd).
- Pedido é idempotente: repetir o clique não abre segunda rodada igual em curso.

C4. Acesso.
- Padrão desta entrega: só local. Rota em grupo próprio do App Router, ligada por variável de ambiente, 404 sem ela.
- A trava fica no `layout.tsx` do grupo, antes de qualquer Suspense ou `loading.tsx`: com stream já iniciado, `notFound()` pode sair com status 200. O teste confere o status HTTP, não o texto da página. O 404 mostrar o casco público é aceito.
- A central recusa subir se `VERCEL` ou `VERCEL_ENV` estiver definida, qualquer que seja a variável que a liga.
- Banco: role próprio da central, criado na migração com `if not exists` e `nologin`, sem senha no arquivo (login e senha locais vão num `db/local/post_*.sql` novo, como `post_0001_roles.sql`), com leitura das tabelas internas do módulo e escrita só nas tabelas de pedidos e de decisões; URL em variável própria. Nem `web_reader`, nem `web_writer`, nem o dono do banco.
- Publicar a central com login e papel de admin fica para depois: documente o que falta, não implemente.

C5. Estados de tela, todos obrigatórios: vazio (nenhuma rodada ainda), carregando, erro de leitura do banco, rodada em andamento, rodada interrompida, território sem ficha, ficha sem evidência válida, e executor parado (pedido na fila há mais tempo que o limite, com o aviso dizendo isso). Teclado e leitor de tela: cada território do mapa é alcançável e tem nome e contagem em texto; a lista de "Ver registros" é o equivalente acessível do mapa.

Fora de escopo: publicar a central em produção, papel de admin no banco ou no Supabase Auth, role próprio do ETL (lacuna 10.2), trava de arquivo vazio (10.3), `check` bloqueante (10.1), qualquer fonte nova, geocodificação de endereço, biblioteca de mapa nova, qualquer mudança no site público.
</escopo>

<plano_exigido>
Grave em `replica/admin-coleta-plano.md` antes de qualquer código. Onde o texto abaixo pede para comparar e recomendar, compare, DECIDA e registre a decisão com o motivo. Um verificador independente (Sonnet, só leitura, sem ver o seu raciocínio) tenta derrubar o plano. Ele recebe o plano, o repositório e, copiadas por extenso, as seções <restricoes_criticas>, <escopo> e <criterios_de_aceite>. O plano está reprovado se violar restrição crítica, deixar critério de aceite sem teste previsto, ou tiver tarefa sem comando de pronto. Corrija e reverifique uma vez, com outro agente. Objeção que você decidir manter vira entrada no registro de decisões, com a objeção citada; se ela apontar violação de restrição crítica, você não pode mantê-la.

0. Reorganização (Parte R):
   - Inventário de todos os arquivos de `etl/civico_etl/jobs/`, mais `transparencia.py` e `remotezip.py`, com a classe de cada um, e a lista dos comandos e das tarefas que entram no catálogo.
   - Forma do catálogo e do contrato de coletor, com três exemplos preenchidos: um simples (`camara.equipe`), o mais irregular (`sapl.todas`), e um com efeitos encadeados (`camara.diario`, com `camara.noturna` no mesmo arquivo).
   - Como o catálogo se relaciona com `TASKS`, `MAX_AGE_H`, `SOURCE_ENV` e os parsers de argumento espalhados (`cli.py`, `ale_cli.py`, `sapl.py`, `sancoes.py`, `transparencia.py`): derivar, ou manter e conferir por teste. Recomende, sabendo que `argv` e `prefixes` são funções da data.
   - Estrutura de pastas proposta, ao lado da atual. Compare ao menos: (a) só catálogo e adaptadores, sem mover arquivo; (b) mover por classe em subpacotes, com alias em `sys.modules` no caminho antigo; (c) mover sem alias. Para cada uma: ganho, custo, e onde quebra (os `monkeypatch` dos testes, workflows, scripts de `etl/deploy/`, `replica/tools/fluxo_confere.py`, Mac com versão antiga). Tudo fica dentro do pacote `civico_etl` (o `pyproject.toml` só empacota ele). Recomende.
   - Como vai provar que o comportamento não mudou (critérios R-1 a R-10), e a lista confirmada dos coletores sem teste.
   - O que NÃO vai reorganizar e por quê.
1. Modelo de dados novo (tabelas, chaves, estados e transições), e o que reaproveita das tabelas existentes sem alterá-las.
2. Como uma decisão aprovada sobrevive à carga seguinte. O risco não é igual nas quatro classes; confirme no código e tabele job a job. Ponto de partida: `sapl_houses` e `data_coverage` são regravadas a cada run (a sondagem das casas e os `set_coverage` de `jobs/sapl.py` e `jobs/assembleias.py`), então a correção manual some; `mandate_contacts` entra por upsert sem atualização, e o risco ali é o delete que antecede a carga em `jobs/parlamento_extras.py`; `identity_match_queue` só é atualizada enquanto `pendente`, então a decisão já sobrevive. Para as classes em que a correção some, compare ao menos: (a) camada de override lida pelo job antes do upsert; (b) gravar na tabela e travar a chave para o job; (c) não gravar, só corrigir o vínculo de fonte e deixar o job trazer o valor. Dê ganho, custo e onde quebra de cada uma, e recomende.
3. Quando uma mudança aplicada vira linha em `corrections` (que é pública) e quando não vira.
4. Interface: subcomando da CLI (`civico-etl admin ...`) com saída em tabela e `--json`, mais a central da Parte C. Diga quais telas e rotas a central terá, com um esboço em texto de cada uma (o que aparece, em que ordem, o que cada ação grava), e como a tabela de pedidos e o executor funcionam (C3): estados do pedido, o que acontece se o executor morrer no meio, e o limite que caracteriza executor parado.
4a. Acesso da central (C4): nome das variáveis, nome e grants do role, e por que isso não abre caminho para a central subir a produção por engano. A trava de `DATA_SOURCE` em `web/src/lib/data/index.ts` só protege a leitura do site; diga o que a central confere a mais (`VERCEL`, `VERCEL_ENV`, `NODE_ENV=production`).
4b. Território: confirme no schema a tabela do item C0 e decida a pendência de identidade (só "Ver registros", ou pelo mandato vigente do candidato, com o SQL).
4c. Testes ponta a ponta da central: a configuração atual do Playwright sobe o site com dados de demonstração e sem banco, e o CI roda assim. `web/playwright.config.ts` tem `testDir: "./e2e"` sem exclusão, então qualquer spec posto em `web/e2e/` entra no CI e falha lá. Os testes da central ficam em pasta e configuração próprias (`web/e2e-admin/` e `web/playwright.admin.config.ts`), sem editar a configuração pública. O `next build` do CI roda com fonte demo e sem a variável da central: as páginas da central são dinâmicas (`force-dynamic`) e não tocam banco em tempo de build; prove com o build do CI reproduzido localmente. Diga quem sobe o `next start` com a variável da central e a URL do banco local, e quem sobe o executor (por exemplo, `globalSetup`). O conjunto público não pode ser afetado nem ganhar teste pulado.
5. Registro de tentativas por URL: tabela nova ou extensão do manifesto de `rawstore`. Justifique pelo volume do SAPL das câmaras (centenas de hosts por rodada).
6. Lista de arquivos a criar e a tocar, e os testes de cada critério de aceite.
7. Decomposição em tarefas delegáveis, por fase: para cada uma, o modelo (Haiku ou Sonnet), os arquivos que pode tocar, o comando que prova que terminou, e de quais tarefas depende. Feche com o teto de subagentes por fase (construção, retentativas e verificação somadas).
8. Premissas que você assumiu no lugar de me perguntar, cada uma com o que muda se estiver errada. Só vira pergunta o que cair na lista de parada da seção <autonomia>.
</plano_exigido>

<primeira_rodada>
Recorte: as Assembleias Legislativas com SAPL (tarefa `sapl.ales`, fonte `sapl-ale`). É pequeno (cinco casas em `ALE_SAPL`: RO, AC, AM, PI, PB), não exige chave de API e já tem sondagem, robots.txt e carga incremental.

Preparo do banco (restrição 3a). `db/pg-local.sh` tem porta e socket fixos (54329, `/tmp/claude/pgs`), guarda os dados em `.local/pg` do checkout em que roda, só cria o banco `civico` e não tem subcomando para outro. Então:
1. Veja se já há servidor: `psql -h /tmp/claude/pgs -p 54329 -U postgres -Atc 'select 1'`. Respondeu: é o meu cluster, NÃO rode `start` nem `stop`, só crie o seu banco nele. Não respondeu: `db/pg-local.sh start` (num worktree isso inicia um cluster novo e vazio ali, com um `civico` vazio que é seu).
2. Crie o banco: `"$(brew --prefix postgresql@16)/bin/createdb" -h /tmp/claude/pgs -p 54329 -U postgres admin_coleta`. `db/migrate.sh` chama `psql` pelo `PATH`: se não estiver, prefixe `PATH="$(brew --prefix postgresql@16)/bin:$PATH"`.
3. Com o prefixo das duas variáveis em cada linha, na ordem do `.github/workflows/ci.yml`: `db/migrate.sh --local`; `civico-etl seed`; `etl/tests/fixtures/base.sql`.
4. Linha de base, antes de tocar em qualquer arquivo: rode a suíte do ETL (`uv run --frozen pytest -q -rs`), o `fluxo_confere.py` de R-10, e lint, tipos e unitários do `web/`. Guarde no arquivo de estado o SHA de partida e a lista do que já falha ou pula. "Passa inteiro" nos critérios quer dizer: nenhuma falha nem pulo além da linha de base.
Sem conseguir subir Postgres nem criar o banco, pare (lista de parada, item 5): quase todo critério depende dele, e a suíte sem banco só pula.

O passo 3 ainda não basta: `base.sql` só cria Câmara e Senado, e `sapl.ales` rejeita a UF que não tem Assembleia em `legislative_bodies`. Quem cria essas linhas é `ibge.places`, que usa rede. Rode `civico-etl ibge.places` ou, sem rede, crie uma fixture com as cinco Assembleias.

Rode de ponta a ponta no banco local:
1. Prévia do recorte, depois a rodada.
2. Um campo que mudou, com a decisão registrada e aplicada.
3. Um candidato que ficou pendente, com a pergunta em aberto.
4. A mesma rodada de novo, pelo identificador: mostre reaproveitamento de cache e zero linha duplicada.
5. Reprocessamento sem rede do bruto salvo.

Depois, pela central (Parte C), acrescente ao recorte um município com Câmara Municipal no SAPL (os comandos `sapl.descobrir --ibge` e `sapl.carregar` de `jobs/sapl.py` já aceitam um código) e valide o fluxo de tela:
6. No mapa, abra a UF e o município. Abra uma pendência dele, de vínculo SAPL ou de cobertura (são as classes com território de município).
7. Acione "Recoletar fichas pendentes", rode o executor e confira o resultado na ficha e na contagem do território, sem recarregar.
8. Peça o parecer de IA para essa ficha e acompanhe o andamento. Confirme que nada foi aplicado.
9. Decida a pendência pela tela e confira a mesma decisão pela CLI.

Se a rede estiver bloqueada no ambiente, grave respostas do SAPL como fixture nova em `etl/tests/fixtures/` (hoje a pasta só tem `base.sql`; não existe resposta gravada) e marque "SIMULADO" no relatório, item por item. Nunca apresente dado simulado como lido da fonte.
</primeira_rodada>

<criterios_de_aceite>
Cada item tem teste automatizado em `etl/tests/`, salvo indicação.

Parte R. Preparo: banco local como na primeira rodada. Sem rede: as entradas dos testes são fabricadas à mão e servidas por `httpx.MockTransport` sobre o cliente de `http.py` (modelo: `etl/tests/test_transparencia.py`) ou por `ETL_CACHE_DIR` pré-populado.

R-1. A suíte existente passa inteira depois da reorganização, sem alterar nenhuma asserção. Só é permitido mudar linha de import em teste, e cada uma aparece no mapa "de → para". Atenção: 86 chamadas de `monkeypatch.setattr` nos testes alteram atributos do objeto do módulo do job. Se um arquivo mudar de lugar com reexport por `from novo import *`, o patch cai no módulo de fachada e o teste passa sem testar nada. Para cada módulo movido, prove com um teste que o patch aplicado pelo caminho antigo atinge o código real (alias em `sys.modules`), ou não mova.
R-2. Teste de caracterização, escrito e passando ANTES de tocar em cada coletor que hoje não tem teste. Confirme a lista; ponto de partida: sem teste nenhum, `governos_indicadores`, `receita_arrecadacao`, `ibge_places`, `ibge_populacao`, `ibge_malhas`, `ale_cli`, `senado_extras`; só tangenciados, `camara_equipe`, `camara_presenca`, `parlamento_extras`, `almg`. O teste roda o comando pela CLI sobre entrada fabricada e compara as tabelas de destino com um retrato versionado, gravado no commit de partida. Colunas ignoradas na comparação: `id`, `created_at`, `updated_at`, e toda referência a run (`run_id`, `last_run_id`) e a horário de execução. Entrada fabricada é marcada como fabricada. Coletor cuja entrada não der para fabricar com fidelidade (zip do TSE lido por faixa) fica declarado como "sem caracterização" e NÃO é tocado por dentro.
R-3. Retrato completo de `schedule.TASKS`, gravado no commit de partida e comparado depois: todos os campos de `Task` (nome, ordem, `every_h`, `timeout_h`, `retry_h`, `window`, `people`, `needs_repairs`, `missing_ok`, `derives`, `source`, `needs_env`), mais o resultado de `argv(data)` e de `families(data)` para datas fixas (uma em ano eleitoral, uma fora). Mesmo retrato para `MAX_AGE_H` e `SOURCE_ENV`.
R-4. Todo comando e toda tarefa citados em `.github/workflows/*.yml`, `etl/deploy/*.sh` e `etl/agenda/*.sh` continuam existindo. O teste extrai os nomes desses arquivos (formas `civico-etl X`, `civico_etl.cli X`, e nomes de tarefa em `ETL_TASKS_INCLUDE` e `--only`), descarta texto de log, e confere contra a lista de comandos da CLI e contra `TASKS`, não contra o catálogo de coletores: `rascunho`, `revisar`, `seed`, `check` e `run-due` são comandos legítimos fora do catálogo.
R-5. Catálogo completo, nos dois sentidos: todo comando de coleta da CLI tem entrada; toda tarefa de `TASKS` aponta para uma entrada; toda fonte citada existe em `sources` depois do `seed`; a paridade de `MAX_AGE_H` com `web/src/lib/sources.ts` continua passando.
R-6. `schedule.plan()` com `now` fixo, `ETL_TASKS_INCLUDE` e `ETL_TASKS_EXCLUDE` fixos e o mesmo estado de carimbos dá o mesmo plano antes e depois (tarefas, ordem e motivo normalizado). Não compare a saída textual de `run-due --dry-run`: ela depende da hora.
R-7. Efeitos encadeados preservados: executar `camara.diario` e `senado.diario` pelo contrato do catálogo roda os mesmos passos seguintes que a CLI roda hoje (`identity.dedupe`, `derive.stats`), e uma entrada inalterada interrompe a cadeia do mesmo jeito. Teste que compara a sequência de passos pelos dois caminhos.
R-8. Códigos de saída: `check` com invariante quebrada e `run-due` com alerta devolvem o mesmo código de antes. Teste para os dois.
R-9. O diff da Parte R não contém mudança de SQL de domínio, de parser nem de regra de identidade. Se contiver, cada trecho está listado e justificado no relato.
R-10. `python3 -I replica/tools/fluxo_confere.py` não ganha falha nova. Rode antes de começar e guarde a saída: a ferramenta lista `jobs/*.py` sem recursão e pode já estar falhando; relate o antes e o depois.

Partes A e B.

1. Com `DATABASE_URL` apontando para o banco local, `db/migrate.sh --local` aplica do zero e uma segunda vez sem erro.
2. Com o banco preparado como na primeira rodada (migração, `seed`, `base.sql`), `cd etl && uv run --frozen pytest -q -rs` passa inteiro, incluindo os testes anteriores. Nenhum teste novo pode sair como pulado, por motivo nenhum: leia a lista do `-rs` e relate cada pulo.
3. Prévia não faz nenhuma requisição (teste com cliente HTTP que falha se chamado). O número de URLs de entrada da prévia é igual ao da rodada executada em seguida; o que a prévia deu como estimativa vem marcado como estimativa.
4. Repetir uma rodada pelo identificador: zero linha nova em propostas e vínculos; tentativas marcadas como reaproveitadas.
5. Rodada interrompida no meio e repetida: sem duplicata, e as linhas de outro recorte ficam intactas.
6. Falha de leitura (403, robots, timeout, corpo vazio) grava motivo e não apaga a última evidência válida.
7. Duas fontes com valores diferentes para o mesmo campo: uma pendência, dois valores, nenhum aplicado.
8. Mudança de hash da evidência reabre pendência já decidida.
9. Tentativa de aplicar por agentes com qualquer das duas chaves desligada falha fechada.
10. Proposta sem URL, sem trecho ou sem hash é recusada na entrada, antes da fila.
11. Decisão aplicada sobrevive a uma nova execução do job de origem (ponto 2 do plano).
12. Uma consulta real de quem consome a base devolve o valor novo. Para as Assembleias, o leitor é `getAssembly` em `web/src/lib/data/pg.ts`. Esse módulo importa `server-only` e não roda fora do Next: o teste executa, pelo psycopg, o SQL de `getAssembly` copiado, com comentário apontando arquivo e linha de origem. `listSourceStatus` não serve aqui (lê só `sources` e `dataset_stamps`), e `getCoverage` só cobre município. Se um campo corrigido não tiver leitor nenhum no site (caso provável de `sapl_houses.base_url` de Assembleia), diga isso no relatório em vez de inventar uma consulta.
13. Ordenação da fila: teste que prova que nenhum atributo de pessoa ou partido entra na chave de ordenação.
14. `civico-etl check` continua passando no banco local.

Parte C. Testes em `web/` (unitário em `web/src/lib/__tests__/`, ponta a ponta em `web/e2e-admin/` com configuração própria, nunca em `web/e2e/`), mais lint e checagem de tipos como em `.github/workflows/ci.yml`. Os unitários rodam com `node --test`, que não resolve o alias `@/`: a agregação fica em módulo puro, com imports relativos com extensão `.ts` e sem `server-only` (modelo: `web/src/lib/data/cobertura.ts`). Os ponta a ponta da central rodam como o plano 4c definiu; capturas em 390 px seguem a convenção de projeto móvel de `web/playwright.config.ts` (marca `@mobile`).

15. Sem a variável que liga a central, toda rota dela responde com status HTTP 404, inclusive as que têm estado de carregando. Com `VERCEL` ou `VERCEL_ENV` definida, idem, mesmo com a variável ligada. Há teste para os dois casos. Este critério não depende de navegador: se o Playwright não rodar, prove com `next start` e `curl -s -o /dev/null -w '%{http_code}'` em cada rota.
16. Para cada UF: soma dos municípios mais as fichas "da UF, sem município" é igual à contagem da UF. No país: soma das UFs mais as fichas sem território é igual ao total de fichas. Teste unitário sobre a função pura de agregação.
17. Uma ficha com duas fontes vinculadas conta uma vez; duas fichas no mesmo município contam duas.
18. Nenhuma ficha sem território aparece no mapa, e todas aparecem em "Ver registros" com o motivo.
19. Os números do painel de coleta e do painel de revisão são iguais aos do relatório da CLI para a mesma rodada.
20. Clicar duas vezes em "Recoletar fichas pendentes" gera um pedido só.
21. Ponta a ponta: o fluxo dos passos 6 a 9 da primeira rodada, com o executor rodando sobre fixture gravada. A consulta periódica tem intervalo fixo de 5 s. Medido a partir do instante em que o resultado é gravado no banco (não do clique), a contagem do território muda na tela em até 10 s, sem recarregar.
22. Pedido de parecer de IA com as duas chaves desligadas não altera nenhuma tabela de domínio (comparação antes e depois).
23. Nenhuma requisição da central sai para host externo (teste ponta a ponta que falha em qualquer requisição fora de `localhost`).
24. O markup do mapa não contém `<circle>` nem elemento de cluster, e cada território tem nome e contagem acessíveis em texto.
25. O conjunto ponta a ponta já existente do site público passa sem alteração de nenhum arquivo dele, `web/playwright.config.ts` incluído, e o `next build` nas condições do CI (fonte demo, sem a variável da central, sem banco) continua passando.
26. Uma captura de tela de cada visão (Coleta, Revisão, Ver registros, ficha) em `replica/prompts/evidencias/`, em 1440 px e 390 px de largura.
</criterios_de_aceite>

<entregaveis>
- Código e migração no branch de trabalho (restrição 3b), com um commit local por tarefa aceita (mensagem com a fase e o critério atendido). Sem push, sem PR, sem merge: isso é meu.
- `replica/admin-coleta-plano.md`, `replica/admin-coleta-decisoes.md` e `replica/admin-coleta-estado.md` (seções <plano_exigido>, <autonomia> e <orquestracao>).
- `replica/admin-coleta.md`: modelo, comandos, estados, como repetir uma rodada, como ligar a central e rodar o executor localmente, e os passos de produção que ficam para o dono (migração, e o que falta para publicar a central com login).
- A central da Parte C, com as capturas do critério 26.
- Relatório da primeira rodada: URLs tentadas, reaproveitadas e com falha; registros distintos alcançados; campos confirmados, conflitantes e pendentes; registros alterados. Com denominadores e IDs.
- A edição candidata: diferenças em relação à base vigente, por ID e campo, com evidência, mais as pendências restantes.
- A fila priorizada, pronta para a próxima pessoa continuar.
- Entradas novas em `replica/decisions.md` para as decisões de arquitetura (itens 0 e 2 do plano, no mínimo), como a seção <autonomia> define.
</entregaveis>

<verificacao_independente>
Quem verifica nunca é quem construiu. Recebe o intervalo de commits da fase (`git diff <sha inicial>..<sha final>`), os critérios por extenso, as restrições críticas e o bloco fixo de briefing; não recebe o resumo do construtor nem a sua conclusão. Não edita arquivo. Se rodar teste, é no banco `admin_coleta`, com a suíte parada para os demais.
- Ao fim da Parte R (Sonnet): procura mudança de comportamento escondida na reorganização (R-7 e R-9).
- Ao fim da Parte B: um Sonnet tenta quebrar os itens 4, 5 e 11; um Opus de contexto limpo tenta quebrar o item 9.
- Ao fim da Parte C (Opus de contexto limpo): tenta abrir a central com a trava ligada (item 15), fazer a tela aplicar algo com as chaves desligadas (item 22), achar requisição externa (item 23) e achar grant a mais no role da central.
Achado que procede: corrija e reverifique uma vez, com outro agente. Reprovado de novo: critério comum fica como "falhou" no relato e a tarefa é isolada; critério de segurança cai no item 6 da lista de parada. Registre o que foi achado, o que foi corrigido e o que você decidiu não corrigir, com o motivo. Achado sobre critério de segurança você não descarta sozinho: ou corrige, ou para.
</verificacao_independente>

<autonomia>
Regra geral: você decide e documenta. Parar para me perguntar custa mais do que uma decisão reversível errada. Não pare por ambiguidade, por escolha de desenho, por trade-off, nem ao fim de fase.

Toda decisão que eu poderia querer rever vai para `replica/admin-coleta-decisoes.md`, uma entrada por decisão: identificador local (`AC-01`, `AC-02`...), data, fase, o que estava em jogo, opções consideradas, escolha, motivo, os commits (SHA) e arquivos que a materializam, e como desfazer em forma de comando (`git revert <sha>`, mais o que não volta só com o revert, como migração já aplicada no banco local). As decisões de arquitetura (item 0 e item 2 do plano, no mínimo) ganham também entrada em `replica/decisions.md`, no formato das existentes e com referência ao `AC-NN`. Número de decisão e prefixo de migração: confira o último usado (`decisions.md` e `ls db/migrations`) na hora de escrever, não de memória. Outros branches podem pegar o mesmo número antes do merge; renumerar no merge é passo do dono, e fica dito no relato.

Critérios de segurança, para efeito desta seção: 9 (duas chaves, falha fechada), 15 (trava da central), 22 (parecer não aplica nada), 23 (nenhuma requisição externa), e os grants do role da central (C4). Para eles não existe "substituir", "não executado" nem "descartar achado": ou passam com prova, ou é o item 6 da lista de parada. Esta regra vence qualquer conduta abaixo.

Situações que antes pediriam parada e agora têm conduta definida:
- Coletor que só cabe no contrato comum mudando o que grava ou a ordem em que grava: não adapte à força. Declare o modo como não suportado no catálogo, registre e siga.
- Arquivo de coletor que precisa de mudança por dentro: o esperado é zero. Se for inevitável, só com teste de caracterização passando antes e depois, diff mínimo, e o trecho copiado na decisão. Sem caracterização possível, não toque.
- Teste de caracterização mostra comportamento diferente do documentado: registre em `replica/bugs.md`, caracterize o comportamento real e siga. Não corrija.
- Teste antigo quebra por causa alheia à sua mudança: prove com o commit de partida, registre e siga.
- Dependência nova: evite. No ETL e em `devDependencies` do `web/`, se o ganho for concreto, você decide, registra licença, tamanho e alternativa descartada. Dependência de execução no `web/` entra no pacote do site público: é o item 3 da lista de parada. Biblioteca de mapa e serviço externo continuam proibidos.
- Tabela existente: mudança aditiva por migração nova, você decide. Mudança não aditiva está na lista de parada.
- A central precisa de arquivo fora das pastas dela: criar arquivo novo, você decide; alterar arquivo do site público continua proibido.
- Playwright não abre porta local no ambiente: não contorne. Entregue os testes escritos, o comando exato para eu rodar, marque como "não executado" os critérios 21 e 26, e siga. Os critérios de segurança 15 e 23 ganham prova sem navegador (`curl` para o 15; para o 23, busca no código da central por URL absoluta, `fetch` para fora e recurso remoto em `<link>`, `<script>` e CSS), conferida pelo verificador da Parte C.
- Rede bloqueada: use entrada fabricada, marque SIMULADO e siga.
- Critério de aceite impossível como escrito: não enfraqueça em silêncio. Registre qual, por quê, o critério substituto que você adotou, e marque o original como "não atendido" no relato.
- Erro que não cede: siga a escada da seção <orquestracao>. Se nem você resolver em duas tentativas, registre o bloqueio, isole a tarefa e siga com o que não depende dela.

Lista de parada. Só nestes casos você para e me pergunta, com a pergunta em uma frase e a sua recomendação:
1. O trabalho só anda tocando em produção, em segredo ou em conta externa (restrições 1 e 2). Não há caminho alternativo a decidir: pare.
2. Ação destrutiva ou irreversível: mudança não aditiva de schema, alterar migração existente, apagar dado ou arquivo que o git não recupera, mexer em banco que você não criou, parar um servidor Postgres que você não subiu.
3. Reabrir decisão fechada do produto, ou mexer no que roda fora deste módulo: neutralidade (restrição 7), design v1, as duas chaves da verificação agêntica (D293), qualquer mudança visível no site público, dependência de execução nova no `web/`, e qualquer edição em `.github/workflows/`, `etl/deploy/` ou `etl/agenda/`. Se a reorganização só fecha editando um desses arquivos, o desenho está errado para esta entrega: escolha a opção que não exige (alias, não mover) antes de parar.
4. Gasto: mais de 20 chamadas à API de modelo pelo código do produto (o parecer de IA da Parte B) nesta entrega; qualquer serviço pago novo; ou o teto de subagentes de uma fase (item 7 do plano) estourado em mais de 50%. Dentro do limite, use o modelo mais barato que cumpre a tarefa. Sem chave no ambiente, simule e marque SIMULADO; não procure a chave.
5. Um bloqueio que impede todas as tarefas restantes ao mesmo tempo: sem Postgres local, sem ferramenta de subagentes, ou equivalente.
6. Um critério de segurança (lista acima) que não passa, não é atingível, ou tem achado de verificador que você não conseguiu corrigir.

Fora dessa lista, não pare. Push, PR, merge, deploy e migração em produção não são parada: simplesmente não são seus, e ficam listados no relato como passos do dono.
</autonomia>

<relato_final>
Uma tabela com todos os critérios (R-1 a R-10 e 1 a 26): passou, falhou, não executado, simulado ou substituído, com o comando e o trecho de saída que prova. Depois: as decisões tomadas sem me consultar, das mais difíceis de desfazer para as mais fáceis; os achados dos verificadores e o destino de cada um; quantas tarefas foram para Haiku, para Sonnet e quantas você mesmo fez, e quantas subiram de modelo, contra o teto do plano; a linha de base (o que já falhava antes); e os passos que ficam para o dono, incluindo renumerar migração ou decisão se o `main` tiver andado. Sem resumo otimista.
</relato_final>

This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm file paths, directories, and permissions match the actual project.
