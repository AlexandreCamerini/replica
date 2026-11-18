# Admin de coleta

O módulo de administração de coleta opera a coleta do ETL a partir de uma central de administração. Este documento é escrito por fases: nesta versão cobre a Parte R (reorganização da coleta). As demais partes entram em tarefas seguintes. O plano e as decisões estão em `replica/admin-coleta-plano.md` e `replica/admin-coleta-decisoes.md`.

## Parte R: reorganização da coleta

A Parte R separa no código os três níveis da coleta (comando, tarefa e coletor), declara a classe de cada arquivo do ETL e expõe um contrato comum de execução. Não muda comportamento. Continuam iguais os nomes de comando e seus argumentos, os campos de `schedule.TASKS` e a ordem dessas tarefas, os `dataset`, os `sources.slug`, os locks (`etl.scheduler*`), os códigos de saída, os passos encadeados depois de cada carga e as escritas de cada job (restrição 5a do plano).

### O que mudou

O pacote novo é `etl/civico_etl/catalogo/`, com onze arquivos:

- `__init__.py`: reexporta a API pública do pacote e importa os três lotes de adaptadores para que se registrem no contrato.
- `modelo.py`: classes congeladas `Comando`, `Coletor`, `Fonte`, `Entradas`, `Ausentes` e `Modo`, a enumeração `Classe`, e os dicionários `ARQUIVOS` e `MISTOS`. Cada campo é validado em `__post_init__`.
- `comandos.py`: `COMANDOS`, com os 48 nomes que a CLI aceita (módulo, parser, argumentos lidos, passos encadeados e coletor de cada um), e a busca `comando(nome)`.
- `coletores.py`: `COLETORES`, com os 4 coletores de origem e os 20 dos lotes A, B e C (24 ao todo), e as buscas `coletor`, `por_comando` e `por_tarefa`.
- `coletores_a.py`: 8 coletores do lote A: `tse.candidatos`, `tse.votos`, `tse.contas`, `sancoes.tcu`, `sancoes.cgu`, `transparencia.emendas`, `ale.custom` e `sapl.assembleias`. Os ids `ale.custom` e `sapl.assembleias` são propostos pelo código, porque o plano não os nomeia.
- `coletores_b.py`: 7 coletores do lote B: `senado.diario`, `senado.noturna`, `senado.secretas`, `agenda.congresso`, `pauta`, `parlamento.extras` e `camara.presenca`.
- `coletores_c.py`: 5 coletores do lote C: `ibge.places`, `ibge.populacao`, `ibge.malhas`, `governos.indicadores` e `receita.arrecadacao`.
- `contrato.py`: `descrever`, `executar`, `Recorte`, `Descricao`, `runner_subprocesso`, o registro `ADAPTADORES` com o decorador `adaptador`, e os adaptadores dos 4 coletores de origem (`camara.equipe`, `camara.diario`, `camara.noturna` e `sapl.camaras`).
- `adaptadores_a.py`, `adaptadores_b.py` e `adaptadores_c.py`: um adaptador por coletor de cada lote (8, 7 e 5). Cada um monta o argv que a CLI aceita para o recorte e as URLs de entrada.

Nenhum módulo do pacote importa `civico_etl.jobs` nem `civico_etl.cli` no nível do módulo. A CLI só é importada dentro do runner padrão de `executar`.

### Mapa de → para

Nenhum arquivo mudou de pasta nem de nome (AC-02). Desde o commit do plano (`08ba9ad`), `etl/civico_etl/` não tem linha removida, e nenhuma linha de import foi removida de `etl/tests/`. Abaixo, o que é novo.

| De | Para | Situação |
| --- | --- | --- |
| `etl/civico_etl/` (arquivos existentes) | mesmo caminho | nenhum arquivo mudou de pasta nem de nome; nenhuma linha de import de teste mudou |
| não existia | `etl/civico_etl/catalogo/__init__.py` | novo |
| não existia | `etl/civico_etl/catalogo/adaptadores_a.py` | novo |
| não existia | `etl/civico_etl/catalogo/adaptadores_b.py` | novo |
| não existia | `etl/civico_etl/catalogo/adaptadores_c.py` | novo |
| não existia | `etl/civico_etl/catalogo/coletores.py` | novo |
| não existia | `etl/civico_etl/catalogo/coletores_a.py` | novo |
| não existia | `etl/civico_etl/catalogo/coletores_b.py` | novo |
| não existia | `etl/civico_etl/catalogo/coletores_c.py` | novo |
| não existia | `etl/civico_etl/catalogo/comandos.py` | novo |
| não existia | `etl/civico_etl/catalogo/contrato.py` | novo |
| não existia | `etl/civico_etl/catalogo/modelo.py` | novo |
| não existia | `etl/tests/banco_isolado.py` | novo |
| não existia | `etl/tests/caracterizacao.py` | novo |
| não existia | `etl/tests/test_caracterizacao.py` | novo |
| não existia | `etl/tests/test_catalogo.py` | novo |
| não existia | `etl/tests/test_catalogo_forma.py` | novo |
| não existia | `etl/tests/test_catalogo_lote_a.py` | novo |
| não existia | `etl/tests/test_catalogo_lote_b.py` | novo |
| não existia | `etl/tests/test_catalogo_lote_c.py` | novo |
| não existia | `etl/tests/test_codigos_saida.py` | novo |
| não existia | `etl/tests/test_contrato_cadeia.py` | novo |
| não existia | `etl/tests/test_orquestradores.py` | novo |
| não existia | `etl/tests/test_retrato_agenda.py` | novo |
| não existia | `etl/tests/test_retrato_plano.py` | novo |
| não existia | `etl/tests/retratos/agenda.json` | novo |
| não existia | `etl/tests/retratos/ale_cobertura.json` | novo |
| não existia | `etl/tests/retratos/camara_equipe.json` | novo |
| não existia | `etl/tests/retratos/governos_indicadores.json` | novo |
| não existia | `etl/tests/retratos/ibge_places.json` | novo |
| não existia | `etl/tests/retratos/ibge_populacao.json` | novo |
| não existia | `etl/tests/retratos/parlamento_extras.json` | novo |
| não existia | `etl/tests/retratos/plano.json` | novo |
| não existia | `etl/tests/retratos/receita_arrecadacao.json` | novo |

### Os três níveis

Comando é o que a CLI aceita e o operador digita, por exemplo `civico-etl tse.candidatos`. Cada comando está em `COMANDOS`, com o parser que o reconhece (`cli`, `ale_cli`, `sapl`, `sancoes`, `transparencia`, `schedule` ou `inline`).

Tarefa é uma entrada de `schedule.TASKS`, a lista que o `run-due` executa dentro de uma janela de tempo. O catálogo referencia a tarefa pelo nome e não duplica o seu argv nem os seus prefixes. Por exemplo, a tarefa `tse.candidatos.recentes` (`schedule.py:185`) chama o comando `tse.candidatos` com `--all` e com os dois últimos anos. A coleta `pauta` não tem tarefa em `schedule.TASKS`: roda pelo workflow `etl-pauta.yml`.

Coletor é a unidade de coleta: lê as fontes, grava as tabelas e declara o que faz com o que não veio na leitura. Um coletor é acionado por um ou mais comandos e, em geral, por uma tarefa. Por exemplo, o coletor `tse.candidatos` é acionado pelo comando `tse.candidatos` e pela tarefa `tse.candidatos.recentes`. O coletor `sapl.camaras` tem três comandos (`sapl.descobrir`, `sapl.carregar` e `sapl.todas`).

### Classes dos arquivos

`ARQUIVOS` tem 39 entradas, uma por arquivo do ETL que a coleta usa, e todas existem em `etl/civico_etl/`. A classe é declarada no catálogo, não derivada do código. A coluna "Misto" traz o que o arquivo faz além da sua classe, a partir de `MISTOS`. O comando `purge-raw` também tem a classe `manutencao`, mas é inline em `cli.py`, não é arquivo, e por isso não está na tabela.

| Arquivo | Classe | Misto |
| --- | --- | --- |
| `jobs/agenda_congresso.py` | `coletor` |  |
| `jobs/alesp.py` | `coletor` |  |
| `jobs/almg.py` | `coletor` |  |
| `jobs/camara_diario.py` | `coletor` | exporta helpers usados por outros módulos |
| `jobs/camara_equipe.py` | `coletor` |  |
| `jobs/camara_presenca.py` | `coletor` | exporta helpers usados por outros módulos |
| `jobs/governos_indicadores.py` | `coletor` | carimba dataset_stamps à mão |
| `jobs/ibge_malhas.py` | `coletor` | grava arquivo, não tabela |
| `jobs/ibge_places.py` | `coletor` |  |
| `jobs/ibge_populacao.py` | `coletor` |  |
| `jobs/parlamento_extras.py` | `coletor` |  |
| `jobs/pauta.py` | `coletor` |  |
| `jobs/receita_arrecadacao.py` | `coletor` |  |
| `jobs/sancoes.py` | `coletor` | parser e despacho próprios (main); troca http.RATE por CRAWL_DELAY durante a leitura do TCU (sancoes.py:77-87) |
| `jobs/sapl.py` | `coletor` | parser e despacho próprios (main); fila e descoberta internas; altera http.RATE no import (sapl.py:57) |
| `jobs/senado_diario.py` | `coletor` |  |
| `jobs/senado_extras.py` | `coletor` | sem comando próprio; acionado por senado.diario |
| `jobs/transparencia_emendas.py` | `coletor` |  |
| `jobs/tse_candidatos.py` | `coletor` | exporta helpers usados por outros módulos |
| `jobs/tse_votos_contas.py` | `coletor` | exporta helpers usados por outros módulos |
| `jobs/assembleias.py` | `biblioteca` | biblioteca que também escreve (despesas, proposições, cobertura, fila de identidade) a serviço de alesp/almg; `allowed` é o robots.txt comum (usado por sapl.py); altera http.RATE no import (assembleias.py:39) |
| `transparencia.py` | `biblioteca` | cliente da API, mais despacho (main) e checagem (ping) |
| `remotezip.py` | `biblioteca` |  |
| `jobs/ale_cli.py` | `despachante` |  |
| `jobs/derive_stats.py` | `derivacao` |  |
| `jobs/identity_dedupe.py` | `derivacao` |  |
| `jobs/checks.py` | `checagem` |  |
| `jobs/checks_identity.py` | `checagem` |  |
| `jobs/repairs.py` | `rotina_de_agenda` | importa funções dos reparos pontuais 032, 038 e 041 como biblioteca (repairs.py:72, :235, :244) |
| `jobs/identity_bug033.py` | `reparo_pontual` |  |
| `jobs/identity_bug038.py` | `reparo_pontual` | importado por repairs.py como biblioteca |
| `jobs/identity_bug041.py` | `reparo_pontual` | importado por repairs.py como biblioteca |
| `jobs/tse_bug019.py` | `reparo_pontual` |  |
| `jobs/tse_bug032.py` | `reparo_pontual` | importado por repairs.py como biblioteca |
| `jobs/tse_bug035.py` | `reparo_pontual` |  |
| `jobs/seed.py` | `seed` |  |
| `jobs/rascunho.py` | `fluxo_de_ia` |  |
| `jobs/revisar.py` | `fluxo_de_ia` |  |
| `jobs/verificar.py` | `fluxo_de_ia` |  |

### Coletores

A tabela traz os 24 coletores de `COLETORES`. "O que faz com o que não veio" diz o que o coletor faz com o que não veio na leitura: `não apaga`, `apaga` ou `apaga com guarda`. A descrição da guarda está em `Ausentes.guarda`, no código. "Modos suportados" lista os modos `descobrir`, `recoletar` e `reprocessar` que o catálogo marca como suportados. "Caracterizado" é `sim` quando há teste que chama a função de entrada do coletor (`run_*` ou `main`), mesmo com dublês. São 9 de 24. Território é o nível mais fino ao qual a linha do dado se prende.

Sete coletores não suportam `reprocessar`, cada um pelo motivo registrado em `Modo.motivo`: a carga é incremental por cursor (`sapl.camaras`, `sapl.assembleias`), lê zip por faixa sem cópia em disco (`tse.votos`, `tse.contas`), não tem cache em disco (`sancoes.cgu`, `transparencia.emendas`), ou a leitura é uma consulta nova a cada rodada (`pauta`).

| Coletor | Comandos | Tarefa | Fontes (origem) | Território | O que faz com o que não veio | Modos suportados | Caracterizado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `camara.equipe` | `camara.equipe` | `camara.equipe` | `camara` (seed) | `nenhuma` | apaga | recoletar, reprocessar | sim |
| `sapl.camaras` | `sapl.descobrir`, `sapl.carregar`, `sapl.todas` | `sapl.todas` | `sapl` (seed) | `municipio` | não apaga | descobrir, recoletar | não |
| `camara.diario` | `camara.diario` | `camara.diario` | `camara` (seed) | `pais` | apaga com guarda | recoletar, reprocessar | sim |
| `camara.noturna` | `camara.noturna` | `camara.noturna` | `camara` (seed) | `pais` | não apaga | recoletar, reprocessar | não |
| `tse.candidatos` | `tse.candidatos` | `tse.candidatos.recentes` | `tse` (seed), `tse-titulo` (seed) | `municipio` | apaga com guarda | recoletar, reprocessar | não |
| `tse.votos` | `tse.votos` | `tse.votos` | `tse` (seed) | `municipio` | não apaga | recoletar | não |
| `tse.contas` | `tse.contas` | `tse.contas` | `tse` (seed) | `nenhuma` | apaga | recoletar | não |
| `sancoes.tcu` | `sancoes.tcu` | `sancoes.tcu` | `tcu` (seed) | `nenhuma` | apaga com guarda | recoletar, reprocessar | não |
| `sancoes.cgu` | `sancoes.cgu` | `sancoes.cgu` | `cgu` (migracao) | `nenhuma` | apaga com guarda | recoletar | sim |
| `transparencia.emendas` | `transparencia.emendas` | `transparencia.emendas` | `transparencia` (migracao) | `municipio` | não apaga | recoletar | sim |
| `ale.custom` | `ale.sp`, `ale.mg`, `ale.todas` | `ale.todas` | `alesp` (job), `alemg` (job) | `uf` | apaga | recoletar, reprocessar | não |
| `sapl.assembleias` | `sapl.ales` | `sapl.ales` | `sapl-ale` (job) | `uf` | não apaga | recoletar | não |
| `senado.diario` | `senado.diario` | `senado.diario` | `senado` (seed) | `pais` | apaga | recoletar, reprocessar | não |
| `senado.noturna` | `senado.noturna` | `senado.noturna` | `senado` (seed) | `pais` | não apaga | recoletar, reprocessar | não |
| `senado.secretas` | `senado.secretas` | `senado.secretas` | `senado` (seed) | `pais` | não apaga | recoletar, reprocessar | não |
| `agenda.congresso` | `agenda.congresso` | `agenda.congresso` | `camara` (seed), `senado` (seed) | `pais` | apaga com guarda | recoletar, reprocessar | não |
| `pauta` | `pauta` | nenhuma em `schedule.TASKS` (roda fora do `run-due`) | `camara` (seed), `senado` (seed) | `pais` | não apaga | recoletar | não |
| `parlamento.extras` | `parlamento.extras` | `parlamento.extras` | `camara` (seed), `senado` (seed) | `pais` | apaga com guarda | recoletar, reprocessar | sim |
| `camara.presenca` | `camara.presenca` | `camara.presenca` | `camara` (seed) | `pais` | apaga com guarda | recoletar, reprocessar | não |
| `ibge.places` | `ibge.places` | `ibge.places` | `ibge` (seed) | `municipio` | não apaga | recoletar, reprocessar | sim |
| `ibge.populacao` | `ibge.populacao` | `ibge.populacao` | `ibge` (seed) | `municipio` | não apaga | recoletar, reprocessar | sim |
| `ibge.malhas` | `ibge.malhas` | `ibge.malhas` | `ibge` (seed) | `nenhuma` | não apaga | recoletar, reprocessar | não |
| `governos.indicadores` | `governos.indicadores` | `governos.indicadores` | `ibge-sidra` (migracao), `bcb-sgs` (migracao) | `pais` | não apaga | recoletar, reprocessar | sim |
| `receita.arrecadacao` | `receita.arrecadacao` | `receita.arrecadacao` | `receita-federal` (migracao) | `uf` | não apaga | recoletar, reprocessar | sim |

### Contrato

`descrever(coletor_id, recorte)` devolve uma `Descricao`, com o comando, o argv, as URLs de entrada, o tipo de entrada (`estaticas` ou `dinamicas`), a indicação de estimativa e o motivo de recusa (`nao_suportado`). Não usa rede. Recebe `conn` opcional, usado só para leitura do banco. Um coletor sem adaptador devolve `nao_suportado`.

`executar(coletor_id, recorte, runner=None)` monta o mesmo argv de `descrever` e o entrega ao `runner`. Se o recorte não é suportado, levanta `ValueError`. O `runner` padrão é `civico_etl.cli.main`, chamado em processo, e `runner_subprocesso` roda `python -m civico_etl.cli` com o mesmo argv. Nos dois casos a execução passa pelo despacho da CLI, com os passos encadeados. Nenhum caminho chama uma função `run_*` de job diretamente. A ressalva é o parâmetro `runner`: quem passa outra função assume essa responsabilidade.

### O que não foi reorganizado e por quê

- Nenhum arquivo mudou de pasta (AC-02). Mover exigiria tratar 57 `monkeypatch.setattr` que atingem o objeto do módulo do job. Com o arquivo em outra pasta, `ibge_malhas.py` passaria a gravar no lugar errado sem erro, porque resolve a saída por `Path(__file__).parents[3]`. `sapl.py` e `assembleias.py` alteram `http.RATE` no import. Dois testes também leem arquivos de job pelo caminho.
- `schedule.py`, `cli.py` e os quatro parsers próprios não mudam. O catálogo é conferido contra eles por teste, não derivado: `argv` e `prefixes` são funções da data, e a ordem de `TASKS` é a ordem de execução.
- O campo `Task.derives`, que tem dois sentidos, fica como está. Mudar é correção, fora desta entrega.
- As escritas fora de `db.run` (`sapl.py`, `governos_indicadores.py`, `repairs.py`) ficam como estão. O catálogo as declara.
- As lacunas da seção 10 de `replica/fluxo-de-dados.md` não são corrigidas nesta parte.
- A caracterização achou cinco comportamentos que não foram corrigidos. Estão registrados em `replica/bugs.md` como BUG-056 a BUG-060.

### Como conferir

Suíte do ETL:

```bash
cd etl && DATABASE_URL=postgres://postgres@localhost:54329/admin_coleta ETL_DATABASE_URL=postgres://postgres@localhost:54329/admin_coleta uv run --frozen pytest -q -rs
```

Conferência do fluxo de dados, a partir da raiz do repositório:

```bash
python3 -I replica/tools/fluxo_confere.py
```

A saída esperada é a linha de base de sete problemas, anterior à Parte R, sem nenhum problema novo.

## Parte C: central de administração e executor

A Parte C põe uma central de administração sobre a coleta da Parte R e as partes A e B. A central é uma tela local, em `web/src/app/(admin)/`. Ela não coleta, não chama modelo e não aplica nada: cada ação grava um pedido em `adm_pedidos` ou `adm_pedidos_decisao` (decisão AC-19, `replica/admin-coleta-decisoes.md`). Quem consome o pedido é o executor da CLI, `civico-etl admin executor`, que usa os mecanismos que já existem (`rodadas`, `decisoes`, `aplicar`, `parecer`). O plano está em `replica/admin-coleta-plano.md`, seções 4a e 4.2 a 4.3.

Estado: a central tem dois modos, escolhidos por `ADMIN_CENTRAL`. O modo local (`1`) é o da entrega original, agora com identidade (`ADMIN_LOCAL_EMAIL`). O modo produção (`producao`, F3) está pronto em código para `admin.segueovoto.com.br`, com login por e-mail, MFA e lista de admins; nada dela está publicado nem foi exercitado com Supabase real. Os dois modos estão na subseção 6; os passos de produção do dono estão na subseção 5.

**Mudança de build (AC-29, F3-C3).** A central é um BUILD à parte do mesmo código: `ADMIN_CENTRAL` (`1` ou `producao`) tem de estar definida no build E na execução. Com ela, `next.config.ts` põe `pageExtensions: ["admin.tsx", "admin.ts"]`: só os arquivos `*.admin.*` entram (`page.admin.tsx`, `route.admin.ts`, `layout.admin.tsx`, `not-found.admin.tsx`, `src/middleware.admin.ts`) e nada do site. Sem a variável no build (o site, o CI, o projeto `www`), as extensões são as padrão: nenhum `*.admin.*` entra, as rotas `/admin*` não existem e o site não tem middleware. O build local da central usa a pasta `.next-admin-local` (`ADMIN_CENTRAL=1 NEXT_DIST_DIR=.next-admin-local npx next build`) e roda com a mesma variável; o build do site continua em `.next`. Quem rodava a central local sobre o build do site (variável só na execução) agora precisa desse build próprio, senão `/admin` dá 404.

### 1. Central de administração

**O que é.** Um grupo de rotas do Next.js (`web/src/app/(admin)/`) com seis páginas e seis route handlers em `web/src/app/(admin)/admin/api/`. A leitura vem de `web/src/lib/admin/consultas.ts`; a escrita, só de pedidos, por `web/src/lib/admin/sql.ts` e pelas consultas do pool próprio de `web/src/lib/admin/db.ts`. O pool usa o driver `postgres`, que já é dependência do site, e só é criado sob demanda. O módulo é `server-only` e não importa `lib/data/pg.ts` nem `lib/db/writer.ts`.

**Quando responde.** A guarda está em `web/src/lib/admin/guarda-regra.ts` (regra pura, `decidirAcesso`), em `web/src/lib/admin/guarda.ts` (ligação ao Next) e em `web/src/middleware.admin.ts` (borda da requisição; só existe no build da central e nele cobre toda requisição: o que não é `/admin*`, `/_next/static/*` ou as malhas `/geo` dá 404). Em todo método e em toda rota do grupo, páginas e handlers, ela responde 404 sem corpo quando a central está fechada. Modo local (`ADMIN_CENTRAL=1`), na ordem em que a regra testa:

- `VERCEL` definida (qualquer valor, inclusive vazio);
- `VERCEL_ENV` definida;
- `ADMIN_DATABASE_URL` ausente, vazia ou malformada;
- host de `ADMIN_DATABASE_URL` fora de `localhost`, `127.0.0.1` e `::1`;
- Host da requisição fora de `localhost`, `127.0.0.1` e `[::1]`;
- `ADMIN_LOCAL_EMAIL` ausente, ou que não é admin ativo em `adm_admins` (o banco confere).

`ADMIN_CENTRAL` com qualquer outro valor que não seja `1` ou `producao`, ou ausente: fechada. O modo produção e suas regras estão na subseção 6. `NODE_ENV` não entra na regra: `next start` local roda com `production`. A guarda não registra o valor de nenhuma variável nem o motivo da recusa. Ela é chamada no middleware, na primeira instrução de `web/src/app/(admin)/layout.tsx`, em cada handler, em cada função de `consultas.ts` e em `sqlAdmin()` (defesa em profundidade).

Brecha residual do modo local, declarada: quem liga `ADMIN_CENTRAL=1` de propósito, com um túnel para um banco de produção ou numa hospedagem que não defina `VERCEL`, passa pela guarda (a identidade é a variável `ADMIN_LOCAL_EMAIL`, sem login). Por isso o modo local nunca vai à internet: a central publicada usa o modo produção. O grupo tem `noindex` e não entra em menu, rodapé nem sitemap; o site público não tem link para ela.

**Como ligar (local).** Use um Postgres local. Os exemplos abaixo usam a porta `54329`, a da suíte. Não copie senhas para o repositório.

1. Migrações e role de login. A partir da raiz do repositório:

   ```bash
   DATABASE_URL=<URL local do banco> db/migrate.sh --local
   ```

   Aplica `db/migrations/*.sql` em ordem e, com `--local`, também `db/local/*.sql`. O role `admin_central` é criado sem senha (`nologin`) pela migração `db/migrations/0153_admin_central.sql`. O login local e a senha de desenvolvimento estão em `db/local/post_0003_admin_central.sql`; o script é idempotente e roda a cada `--local`. Leia o arquivo para a senha; ela não está neste documento.

2. Build da central, numa pasta própria e COM a variável no build (AC-29: o build do site, sem a variável, não tem a central):

   ```bash
   cd web && ADMIN_CENTRAL=1 NEXT_DIST_DIR=.next-admin-local npx next build
   ```

3. Servidor, com a URL do role `admin_central` no banco local (host local, sem valor padrão):

   ```bash
   cd web && ADMIN_CENTRAL=1 NEXT_DIST_DIR=.next-admin-local \
     ADMIN_LOCAL_EMAIL=operador.local@segueovoto.invalid \
     ADMIN_DATABASE_URL='postgres://admin_central:<senha local>@localhost:54329/<banco>' \
     npx next start -p 3000 -H 127.0.0.1
   ```

   `-H 127.0.0.1` restringe o servidor à máquina local. Sem ele, o processo pode aceitar conexão de outro host da rede. Não há login nem MFA no modo local: quem alcança a porta com `ADMIN_CENTRAL=1` e o Host local vê a central como o admin de `ADMIN_LOCAL_EMAIL`. Sem essa variável, ou se o e-mail não é de um admin ativo, tudo responde 404. O admin local de desenvolvimento (`operador.local@segueovoto.invalid`, nome "Operador local") é criado por `db/local/post_0004_admin_local.sql`, que `db/migrate.sh --local` roda; ele só existe em banco local.

4. Executor, em outro terminal, com a URL de escrita do ETL no mesmo banco (não é a do `admin_central`):

   ```bash
   cd etl && ETL_DATABASE_URL=<URL local com escrita do ETL> uv run civico-etl admin executor
   ```

   `db.connect()` lê `ETL_DATABASE_URL` e, na falta dela, `DATABASE_URL`.

**Páginas e o que mostram.** Todas são `force-dynamic`, herdado do layout raiz, e renderizadas no servidor.

| rota | o que mostra | ações |
| --- | --- | --- |
| `/admin` | "Central de coleta": painel de coleta e painel de revisão, em colunas separadas e nunca somados; mapa do país por estado; estado do executor | nova rodada (formulário do coletor, modo e recorte) |
| `/admin/uf/[uf]` | estado, por município: contagem de fichas, com a parcela da UF sem município; link para os registros do estado | "Recoletar fichas pendentes" da UF |
| `/admin/registros` | registros de um município, de uma UF ou do Brasil; posição aproximada marcada quando o registro é de UF | "Recoletar fichas pendentes" do território |
| `/admin/fila` | fila de pendências, com filtro por classe; cada item traz registro, campo e tipo | abre a ficha |
| `/admin/ficha/[classe]/[chave]` | ficha de um registro: propostas com URL e trecho, pareceres guardados e a pendência de cada campo | decisão por campo (formulário) e "Pedir parecer" (ensaio) |
| `/admin/rodadas` | lista de rodadas, com o estado de cada uma em `data-estado` | nova rodada (formulário do coletor, modo e recorte) |
| `/admin/rodadas/[id]` | painel vivo da rodada, com o relatório da rodada e o estado do executor | "Repetir rodada" e "Repetir só pendências" |

O painel de coleta e o de revisão têm números próprios. Ver `replica/admin-coleta-plano.md`, seção 4.2, para a regra de cada painel.

**Estados de tela.** Os nomes vêm de `web/src/lib/admin/estado-tela.ts` (`ESTADOS_TELA`) e aparecem no HTML:

- `carregando`, `vazio` (nenhuma rodada), `erro_leitura` (falha ao ler o banco);
- `executor_parado` e `executor_ok`;
- `rodada_em_andamento` (status `aberta` ou `em_andamento`), `rodada_interrompida`, `rodada_concluida`;
- `pedido_novo` e `pedido_existente` (resposta do envio: pedido gravado agora, ou igual em curso);
- `territorio_sem_ficha` e `territorio_com_ficha`;
- `ficha_sem_evidencia` e `ficha_com_evidencia`, pela ausência de proposta com URL e trecho válidos.

O mapa usa outros estados por território (`lida`, `falhou`, `em_andamento`, `sem_tentativa`, `decidida`, `reaberta`, `pendente`, `sem_pendencia`), definidos em `EstadoMapa`.

### 2. Pedidos e executor

**Regra.** Toda ação da tela é um pedido (AC-19). A central grava; o executor aplica. O role `admin_central` só tem `select` nas tabelas que a central lê e `insert` em `adm_pedidos` e `adm_pedidos_decisao`, com `criado_em` preso ao relógio do banco (migrações 0154 e 0155, AC-21 e AC-22). Não tem `update`, `delete` nem acesso a `people`, `pipeline_switches` ou `corrections` (migração `db/migrations/0153_admin_central.sql`).

**Endpoints de envio.** Ambos aceitam JSON de até 64 KiB, recusam campo fora do esperado e recusam origem externa (`recusarOrigemExterna`). Respondem `{ "id", "novo" }`.

- `POST /admin/api/pedidos`: `{ "tipo": "rodada" | "recoleta" | "parecer", "parametros": {...} }`. Grava em `adm_pedidos`.
- `POST /admin/api/decisoes`: `{ "pendencia_id", "acao", "por", "justificativa", "valor"?, "aplicar"? }`. `por` e `justificativa` não podem ser vazios. Grava em `adm_pedidos_decisao`, nunca em `adm_decisoes`.

Os demais handlers são leitura: `GET /admin/api/estado` (estado do executor e contagens do mapa), `GET /admin/api/fila?classe=&limite=` (limite de 1 a 1000, padrão 100), `GET /admin/api/ficha/[classe]/[chave]`, `GET /admin/api/relatorio/[rodada]`. Os métodos que a rota não usa respondem 404 com a central fechada, para não revelar a rota por um 405.

**Tipos e parâmetros (AC-20).** A forma canônica é a do executor (`normalizar` e `chave_idem` em `etl/civico_etl/admin/executor.py`). A central repete a mesma normalização em `web/src/lib/admin/sql.ts`.

- `rodada`: `{"coletor", "modo": "descobrir|recoletar|reprocessar", "recorte": {"anos", "ufs", "casas", "ibges", "extras"}}`, ou `{"repetir": "<uuid>", "so_pendencias": bool}`. Listas ordenadas, sem repetição.
- `recoleta`: `{"classe": "vinculo_sapl|cobertura|contato_mandato|identidade", "territorio": {"ibge", "nivel": "municipio|uf|pais"}}`. `ibge` é `places.ibge_code`: 7 dígitos no município, 2 na UF. A classe `identidade` não tem território e falha no executor.
- `parecer`: `{"pendencia_id"}` ou `{"rodada_id"}`, um só dos dois.
- decisão (tabela `adm_pedidos_decisao`, com `tipo` = `decisao` só para a chave): `{"pendencia_id", "acao", "valor", "por_nome", "aplicar"}`. A justificativa não entra na chave.

**Chave de idempotência.** `chave_idem` é o sha256 hexadecimal do JSON canônico (chaves ordenadas em todos os níveis, sem espaço, UTF-8 sem escape) de `{"tipo", "parametros"}`. Uma implementação em outra linguagem tem de produzir os mesmos bytes. Os vetores de ouro estão em `VETORES_DE_OURO` (`executor.py`), e `web/src/lib/__tests__/admin-sql.test.ts` confere os mesmos vetores contra a central. `aplicar` entra na chave da decisão: "só decidir" e "decidir e aplicar" são pedidos diferentes.

**Dois cliques, um pedido (critério 20).** A inserção usa `on conflict` sobre o índice único parcial `adm_pedidos_idem_uq`, que vale só para `na_fila` e `em_execucao`. Se já existe um pedido igual ativo, a resposta traz o existente com `novo = false`. Depois de `concluido`, `falhou` ou `interrompido`, o mesmo pedido pode entrar de novo. Se o pedido ativo termina entre a inserção e a leitura, a central repete a inserção até 3 vezes.

**Ciclo do pedido.** `na_fila` → `em_execucao` → `concluido` | `falhou` | `interrompido`. A transição é validada por gatilho. Um pedido recusado passa por `em_execucao` antes de `falhou`.

**Como o executor processa.**

1. Limpa órfãos. Pedido `em_execucao` cujo `batimento_em` (ou, sem ele, `iniciado_em`) é mais antigo que 120 s vira `interrompido` com erro "executor ausente". Se a rodada ligada ainda está `em_andamento`, ela vai a `interrompida` por `rodadas.recuperar`, que só age com a trava consultiva livre; com a trava tomada, o motivo vai para `erro` e a rodada fica `em_andamento` até a trava soltar.
2. Pega o pedido mais antigo das duas tabelas (`criado_em`, `id`), com `for update skip locked`, marca `em_execucao` e comita antes de qualquer trabalho. A ordem nunca usa pessoa, partido nem popularidade. Até 10 candidatos por tentativa.
3. Batimento. Uma thread com conexão própria, em autocommit, atualiza `batimento_em` a cada 15 s enquanto o pedido roda. A conexão própria é necessária porque o coletor bloqueia a thread principal e faz commit na conexão de trabalho.
4. Desfecho. O resultado grava `status`, `finalizado_em`, `erro`, `rodada_id` ou `decisao_id`, com `where status = 'em_execucao'`. Se outro executor já declarou o pedido `interrompido`, a gravação não faz nada e o resultado traz `finalizacao_perdida`.

Desfecho de rodada: `concluida` vira `concluido`; `falhou` vira `falhou` (erro é o motivo da rodada); `interrompida` vira `interrompido`, e a rodada é retomável por `rodada executar` ou `rodada repetir`.

Parâmetro inválido (coletor fora do catálogo, recorte não suportado, pendência inexistente, classe sem território, ação que não aplica com `aplicar`) vira `falhou` com o motivo, sem executar nada.

**Parecer.** O executor usa só o motor de ensaio local (`parecer.motor_ensaio_local`). Não passa `real`, não cria cliente de modelo e não lê a chave da API. Grava em `adm_pareceres`.

**Decisão.** Grava `decisoes.decidir(..., por_tipo='pessoa', por_nome=<nome do pedido>)`. Com `aplicar`, chama `aplicar.aplicar` na mesma transação, como `admin decidir --aplicar`: se a aplicação falha, a decisão também não fica. Nunca usa `por_tipo='agentes'`. Só `aprovar` e `corrigir` aplicam (`ACOES_QUE_APLICAM`).

**Executor parado.** `estado_dos_pedidos` marca `executor_parado` quando há pedido `na_fila` há mais de 60 s, ou `em_execucao` com batimento vencido (mais de 120 s). Quando há pedido `em_execucao` com batimento em dia e fila velha, a consulta traz `executor_ocupado = true`: é uma rodada longa, não um executor morto. A tela diz "ocupado" nesse caso.

**Como rodar.**

```bash
cd etl && uv run civico-etl admin executor               # laço; consulta a fila a cada 2 s quando vazia
cd etl && uv run civico-etl admin executor --uma-vez     # processa no máximo um pedido e sai
cd etl && uv run civico-etl admin executor --intervalo 5 # segundos entre consultas com a fila vazia
```

`--uma-vez` sai com código 1 se o pedido processado terminou `falhou` ou `interrompido`; sem pedido, sai com 0.

**`civico-etl admin pedido` (pela CLI, grava na mesma fila).**

```bash
civico-etl admin pedido rodada --coletor ID [--modo descobrir|recoletar|reprocessar] [--ano N] [--uf UF] [--casa X] [--ibge COD] [--extra CHAVE=VALOR]
civico-etl admin pedido rodada --repetir RODADA [--pendencias]
civico-etl admin pedido recoleta --classe vinculo_sapl|cobertura|contato_mandato|identidade --ibge COD --nivel municipio|uf|pais
civico-etl admin pedido parecer --pendencia ID | --rodada ID
civico-etl admin pedido decidir PENDENCIA --acao aprovar|corrigir|descartar|pedir_confirmacao --por NOME --justificativa TEXTO [--valor JSON] [--aplicar]
civico-etl admin pedido estado
```

Todas as ações aceitam `--json`. `pedido rodada` usa `recoletar` como modo padrão. A saída mostra `novo` ou `já existia (pedido igual em curso)`. `pedido estado` mostra contagens por estado, os pedidos ativos e se o executor está parado.

### 3. Como repetir uma rodada

Há três caminhos, e eles não são iguais:

- **Pela tela.** Em `/admin/rodadas/[id]`, "Repetir rodada" grava `{"tipo": "rodada", "parametros": {"repetir": <id>, "so_pendencias": false}}`; "Repetir só pendências" usa `so_pendencias: true`. O pedido vai para a fila e o executor o processa. A tela mostra `pedido_novo` ou `pedido_existente`.
- **Pela CLI, pela fila.** `civico-etl admin pedido rodada --repetir <id> [--pendencias]`, e depois o executor. Mesmo efeito da tela, com a mesma chave de idempotência.
- **Pela CLI, direta.** `civico-etl admin rodada repetir <id> [--pendencias] [--forcar-url URL]`. Executa na hora, sem passar pela fila. Uma rodada `interrompida` é reexecutada na mesma linha (mesmo id); `--pendencias` não se aplica a ela e dá erro.

### 4. Provas

Tudo sai de `web/`. As provas não usam chamada a modelo nem rede externa.

- `node e2e-admin/sem-navegador.mjs [--sem-build]`: sem navegador. Faz três `next build` (o do SITE em `.next`, sem nenhuma `ADMIN_*`; a central local em `.next-admin-local`; a central de produção em `.next-admin-prod`; ou reaproveita com `--sem-build`), sobe `next start` local, faz as requisições por `fetch` e confere status e HTML. Cobre os critérios 15 (modo local: 404 sem variável, com `VERCEL`, com `VERCEL_ENV` e com Host de fora; modo produção simulado: 404 sem sessão, com Host errado, com ambiente errado e com o provedor de login fora do ar), 19 (os números dos painéis contra `civico-etl admin relatorio --json`), 20 (dois POST iguais, um pedido), 22, 24, os estados de tela e, da F3, os cabeçalhos de segurança em resposta real, o CSRF estrito (POST sem `Origin` ou sem `Sec-Fetch-Site` = 403), o `por` do corpo ignorado, o admin desativado e o limite de 20 pedidos por minuto (429 com `Retry-After`). **Atenção:** o modo completo apaga e recria o banco `admin_coleta_c7`; não aponte para outro banco. As rodadas dele são simuladas (CLI real sobre respostas fabricadas de `etl/tests/fixtures/sapl_ale`).
- `node e2e-admin/sem-navegador.mjs --fluxo --banco admin_coleta_c7|admin_coleta_r1`: passos 6 a 9 da primeira rodada, pela API, no modo local com o admin local (a decisão do passo 9 sai como "Operador local"). Não recria o banco; opera no que recebe. Sobe o `next start` por conta própria (com a central ligada, no banco dado) e exige fila sem pedido ativo no começo: se houver, o teste recusa e pede para rodar o executor ou recriar o banco.
- `node e2e-admin/sem-rede-externa.mjs [--sem-build]`: critério 23. Varre o fonte de `web/src/app/(admin)`, `web/src/lib/admin`, `web/src/components/admin`, `web/src/components/admin-entrada`, `web/src/styles/admin.css`, `web/src/middleware.admin.ts` e o widget do Turnstile atrás de URL absoluta, host sem esquema, `fetch` para fora e recurso remoto em `link`, `script` e `url()`; só `challenges.cloudflare.com` é aceito, e só em `cabecalhos.ts` e no widget. Depois, com a central ligada num `next start` local, varre o HTML de cada página e os recursos que ele referencia e, no modo produção simulado, as páginas de entrada e a CSP. Reaproveita `admin_coleta_c7` se ele for da F3 e já tiver rodadas. Sai com 1 se achar host externo.
- Playwright da central: `web/playwright.admin.config.ts`, com as specs `web/e2e-admin/*.spec.ts` (`acessibilidade`, `acoes`, `capturas`, `central-desligada`, `estados`, `rede`). É configuração própria: o conjunto público (`web/playwright.config.ts`, `web/e2e/`) não a enxerga. O config não tem valor padrão para `ADMIN_DATABASE_URL` e falha sem ele. Portas 3310 (ligada) e 3311 (desligada). As capturas do critério 26 vão para `replica/prompts/evidencias/central-<visao>-<largura>.png`.

  O dono roda fora do sandbox (AC-05, `replica/admin-coleta-decisoes.md`), com o banco da primeira rodada (`bash replica/prompts/evidencias/primeira-rodada.sh`):

  ```bash
  cd web && ADMIN_CENTRAL=1 NEXT_DIST_DIR=.next-admin-local npx next build
  cd web && ADMIN_CENTRAL=1 NEXT_DIST_DIR=.next-admin-local ADMIN_DATABASE_URL='postgres://admin_central:<senha local>@localhost:54329/admin_coleta_r1' \
    npx playwright test -c playwright.admin.config.ts
  ```

  O critério 21 (contagem muda em até 10 s) exige o executor rodando em outro terminal; as specs não o sobem.

Estado de execução nesta entrega: o Playwright não roda no sandbox, e a prova de execução fica com o dono. Os critérios 21 e 26 estão como "não executado". O 25 (conjunto público) está como "não atendido" na parte de execução, com a verificação substituta descrita em `replica/admin-coleta-plano.md`, seção 4c.

### 5. Passos de produção do dono (não implementados nesta entrega)

Nada disto foi feito. Produção está na `0120_raw_copy.sql` segundo `replica/runbook-migracoes-producao.md`.

1. **Aplicar 0150 a 0156 em produção.** O runbook atual cobre só 0130, 0131, 0140 e 0141. Ele precisa ser estendido antes de qualquer aplicação. Ordem e risco de cada uma: ver os cabeçalhos das migrações e a seção 4.1 de `replica/fluxo-de-dados.md`. Antes da `0150`, conferir que o papel do ETL em produção é dono de `sapl_houses`, `data_coverage`, `mandate_contacts` e das `adm_*`, ou tem `BYPASSRLS` (os gatilhos não são `security definer`; a `0150` liga RLS sem policy). A `0142_drop_expenses_supplier_doc_idx.sql` está no ponto de partida e no `main`; em produção o índice já foi removido à mão (D314 em `replica/decisions.md`) e a migração consta pendente, virando no-op; o runbook deve cobri-la ou ser conferido contra ela.
2. **Publicar a central com login e papel de admin.** O código está pronto (F3; subseção 6): login por código de e-mail, MFA TOTP, lista `adm_admins`, identidade da sessão, CSRF estrito e cabeçalhos de segurança. Falta, e é do dono: aplicar a `0156` em produção (F4), criar o projeto Vercel `admin.` com as variáveis da subseção 6, cadastrar os admins, configurar Supabase e Turnstile, e o DNS. Antes da F4, nada da central roda em produção.
3. **Renumerar se o `main` andou.** As migrações 0150 a 0156, as decisões D333 e D334 de `replica/decisions.md` (D325 e D326 antes da junção com o `main` de 17/11/2026) e as AC-01 a AC-26 foram numeradas sobre a base desta branch. Se outra migração ou decisão entrar no `main` antes, renumere: migração publicada não se edita (`db/migrate.sh` falha por checksum), e a referência cruzada nos cabeçalhos e neste documento muda junto.

### 6. Central na internet (F3)

Contrato: `replica/admin-coleta-decisoes.md`, AC-23 a AC-26; plano da fase: `replica/reavaliacao-central-e-dominio.md`, seções 2.3 e 6. Nada disto está em produção.

**Os dois modos e suas variáveis.** `ADMIN_CENTRAL` com valor exato.

| | modo local (`1`) | modo produção (`producao`) |
| --- | --- | --- |
| Onde | máquina do desenvolvedor | segundo projeto Vercel do repositório, em `admin.segueovoto.com.br` |
| Ambiente | fora da Vercel: `VERCEL` e `VERCEL_ENV` não existem | `VERCEL_ENV=production` (Preview e Development ficam fechados) |
| Host aceito | `localhost`, `127.0.0.1`, `[::1]` | exatamente `admin.segueovoto.com.br` (constante no código; o alias `*.vercel.app` do projeto responde 404) |
| Banco | `ADMIN_DATABASE_URL` com host local | `ADMIN_DATABASE_URL` do role `admin_central`, qualquer host, com um único `sslmode` igual a `require`, `verify-ca` ou `verify-full` |
| Identidade | `ADMIN_LOCAL_EMAIL`, admin ativo em `adm_admins`; sem login | sessão do Supabase (`getUser`), nível `aal2` e e-mail ativo em `adm_admins` |
| Outras variáveis | nenhuma | `AUTH_PROVIDER=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |

O projeto do site (`www`) não pode ter nenhuma variável `ADMIN_*`. As variáveis do projeto `admin.` valem só em Production. Os critérios 15 e 23 de cada modo, e a reconferência do 9, estão em `replica/admin-coleta-criterios-producao.md`.

**Cadastrar e desativar admin.** Só o dono do banco, por SQL; nunca pela tela (o `admin_central` só lê `adm_admins`). Toda mudança fica em `adm_admins_log`, que só aceita acréscimo.

```sql
-- cadastrar (e-mail em minúsculas; user_id é o id do usuário em Authentication > Users do Supabase, quando já existe)
insert into adm_admins (email, nome, user_id) values ('pessoa@exemplo.com', 'Nome da Pessoa', '<uuid do Supabase>');
-- desativar (a pessoa passa a ter 404 em toda a central e os pedidos dela são recusados pelo gatilho)
update adm_admins set ativo = false where email = 'pessoa@exemplo.com';
-- reativar
update adm_admins set ativo = true where email = 'pessoa@exemplo.com';
```

Com `user_id` preenchido, o pedido só entra se a sessão trouxer o mesmo `user_id`. Admin sem `user_id` aceita qualquer `por_user_id`: em produção, cadastre o `user_id`. A CLI (`civico-etl admin decidir --por`) exige e-mail ou nome de admin ativo; o nome gravado é o da tabela.

**Login e MFA.** `/admin/entrar` (e-mail, Turnstile, código de 6 números por e-mail) e `/admin/entrar/fator` (cadastro ou verificação do TOTP). Quem não é admin ativo nunca recebe código nem cria conta (`shouldCreateUser: false`), e a resposta é a mesma para admin, não admin e e-mail inexistente. Admin com sessão `aal1` é levado ao fator; sem `aal2`, o resto da central responde 404. O navegador nunca fala com o Supabase: todas as chamadas são do servidor (middleware, layout, server actions).

**O que o dono configura no Supabase e no Turnstile.**

- Authentication, URL Configuration: Site URL do site (`https://www.segueovoto.com.br`) e, em Redirect URLs, `https://admin.segueovoto.com.br/**` além das do site.
- MFA TOTP habilitado no projeto; o modelo de e-mail do código (OTP) deve mostrar o código, não só o link.
- Proteção contra bots (CAPTCHA) do Supabase Auth ligada com o Turnstile: a central entrega o token ao Supabase, que o verifica.
- Turnstile (Cloudflare): `admin.segueovoto.com.br` na lista de hostnames da chave do widget.

**CSP e cookies.** O middleware (que no build da central roda em toda requisição) põe, em toda resposta da origem da central, inclusive os 404 e os estáticos que ele deixa passar: `Content-Security-Policy` com `frame-ancestors 'none'` e nonce por requisição (`challenges.cloudflare.com` só no modo produção; `'unsafe-eval'` só em desenvolvimento), `X-Frame-Options: DENY` e `Referrer-Policy: same-origin`. O site público não tem esses cabeçalhos (nem middleware). Cookies de sessão da central: host-only (nunca `domain=.segueovoto.com.br`), `Secure`, `HttpOnly`, `SameSite=Strict`, `path=/admin`. Efeito do `Strict`: abrir a central por um link de fora mostra 404 até a próxima navegação. POST da central exige `Content-Type: application/json`, `Origin` igual à origem da central e `Sec-Fetch-Site: same-origin`; ausente ou diferente = 403. O limite é de 20 pedidos por admin e por minuto (gatilho do banco; o 21º responde 429 com `Retry-After: 60`). O `por` do corpo é descartado: o pedido leva o admin da sessão.

**Executor em container.** `etl/executor-container.md` (imagem, variáveis, reinício, encerramento, reserva por GitHub Actions). O container leva a credencial de escrita do ETL e não pode ter `ADMIN_COLETA_AGENTES` no ambiente (critério 9, em `replica/admin-coleta-criterios-producao.md`).

**Falha do banco.** No modo local a identidade vem de `adm_admins`: com o banco inalcançável a guarda não acha admin e a central responde 404 (fecha), não `erro_leitura`. O estado `erro_leitura` e o 503 só ocorrem com o banco de pé e a leitura falhando.
