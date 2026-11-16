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
