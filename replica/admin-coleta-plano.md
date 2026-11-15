# Admin de coleta · plano

Plano exigido por `replica/prompts/admin-coleta-enriquecimento.md`. Escrito depois de cinco levantamentos de leitura sobre o commit `39ee3ec` (relatórios na pasta de notas da sessão, subpasta `levantamento/`). Onde este plano e o código divergirem, vale o código, e a divergência vira entrada em `replica/admin-coleta-decisoes.md`.

Convenções:
- Caminhos relativos à raiz do repositório.
- "Banco" é sempre `postgres://postgres@localhost:54329/admin_coleta`, com `DATABASE_URL` e `ETL_DATABASE_URL` como prefixo de cada comando e `select current_database()` conferido antes.
- Todo comando de pronto leva também `PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"`, `UV_CACHE_DIR="$TMPDIR/uv-cache"` e `npm_config_cache="$TMPDIR/npm-cache"`. Abaixo eles aparecem abreviados como `[amb]`.
- `[suite]` = `cd etl && [amb] uv run --frozen pytest -q -rs`. "Passa" = nenhuma falha nem pulo além da linha de base de `replica/admin-coleta-estado.md` (767 passam, 33 pulam, 4 xfail).

## 0. Parte R: reorganização

### 0.1 Inventário e classes

Classe de cada arquivo (confirmada no código; a coluna "misto" diz o que mais o arquivo faz).

| Arquivo | Classe | Misto |
| --- | --- | --- |
| `jobs/agenda_congresso.py`, `alesp.py`, `almg.py`, `camara_equipe.py`, `ibge_places.py`, `ibge_populacao.py`, `ibge_malhas.py`, `parlamento_extras.py`, `pauta.py`, `receita_arrecadacao.py`, `senado_diario.py`, `transparencia_emendas.py`, `governos_indicadores.py` | coletor | `governos_indicadores` carimba `dataset_stamps` à mão; `ibge_malhas` grava arquivo, não tabela |
| `jobs/camara_diario.py`, `camara_presenca.py`, `tse_candidatos.py`, `tse_votos_contas.py` | coletor | exportam helpers usados por outros módulos |
| `jobs/sapl.py`, `jobs/sancoes.py` | coletor | parser e despacho próprios; `sapl.py` tem fila e descoberta internas e altera `http.RATE` no import |
| `jobs/senado_extras.py` | coletor | sem comando próprio; acionado por `senado.diario` |
| `jobs/assembleias.py` | biblioteca | escreve (despesas, proposições, cobertura, fila de identidade) a serviço de `alesp`/`almg`; `allowed` é o robots.txt comum |
| `transparencia.py` | biblioteca | cliente da API, mais despacho (`main`) e checagem (`ping`) |
| `remotezip.py` | biblioteca | |
| `jobs/ale_cli.py` | despachante | |
| `jobs/derive_stats.py`, `jobs/identity_dedupe.py` | derivação | |
| `jobs/checks.py`, `jobs/checks_identity.py` | checagem | |
| `jobs/repairs.py` | rotina de agenda | importa os reparos pontuais como biblioteca |
| `jobs/identity_bug033.py`, `identity_bug038.py`, `identity_bug041.py`, `tse_bug019.py`, `tse_bug032.py`, `tse_bug035.py` | reparo pontual | 038, 041 e 032 são importados por `repairs.py` |
| `jobs/seed.py` | seed | |
| `jobs/rascunho.py`, `revisar.py`, `verificar.py` | fluxo de IA | |
| `purge-raw` (inline em `cli.py`) | manutenção | não é arquivo |

Comandos que entram no catálogo de coletores (28; com os 20 de fora são os 48 da CLI): `ibge.places`, `ibge.populacao`, `ibge.malhas`, `tse.candidatos`, `tse.votos`, `tse.contas`, `camara.diario`, `camara.noturna`, `camara.presenca`, `camara.equipe`, `senado.diario`, `senado.noturna`, `senado.secretas`, `agenda.congresso`, `parlamento.extras`, `pauta`, `ale.sp`, `ale.mg`, `ale.todas`, `sapl.descobrir`, `sapl.carregar`, `sapl.todas`, `sapl.ales`, `sancoes.tcu`, `sancoes.cgu`, `transparencia.emendas`, `governos.indicadores`, `receita.arrecadacao`. (`ale.cobertura` é despacho sem coleta; `transparencia.ping` é checagem. Ficam no catálogo de comandos, não no de coletores.)

Tarefas (as 23 de `schedule.TASKS`, todas apontam para um coletor): `senado.noturna`, `camara.noturna`, `ibge.places`, `ibge.populacao`, `ibge.malhas`, `tse.candidatos.recentes`, `tse.votos`, `tse.contas`, `camara.diario`, `camara.presenca`, `camara.equipe`, `senado.diario`, `senado.secretas`, `agenda.congresso`, `parlamento.extras`, `ale.todas`, `sapl.ales`, `sapl.todas`, `sancoes.tcu`, `transparencia.emendas`, `sancoes.cgu`, `receita.arrecadacao`, `governos.indicadores`.

Comandos fora do catálogo de coletores, classificados no catálogo de comandos: `seed`, `check`, `run-due`, `all`, `purge-raw`, `derive.stats`, `identity.dedupe`, `identity.repairs`, `identity.fix033`, `identity.fix033.devolver`, `identity.fix038`, `identity.fix041`, `tse.fix019`, `tse.fix032`, `tse.fix035`, `rascunho`, `revisar`, `verificar`, `ale.cobertura`, `transparencia.ping`.

### 0.2 Forma do catálogo e do contrato

Pacote novo `etl/civico_etl/catalogo/` (dentro de `civico_etl`, único pacote empacotado):

- `modelo.py`: dataclasses congeladas.
  - `Comando(nome, classe, modulo, parser, argumentos, encadeia, sai_com)`: o que a CLI aceita. `parser` diz qual parser o reconhece (`cli`, `ale_cli`, `sapl`, `sancoes`, `transparencia`, `schedule`, `inline`). `encadeia` é a lista ordenada dos passos seguintes.
  - `Coletor(id, modulos, comandos, tarefas, fontes, datasets, acesso, entradas, recortes_aceitos, recortes_nao_aceitos, tabelas, territorio, ausentes, encadeados, orquestradores, env, modos, caracterizado)`. `entradas` é `Entradas(tipo="estaticas"|"dinamicas", urls=(...), depende_de="...")`. `ausentes` é `Ausentes(politica="nao_apaga"|"apaga"|"apaga_com_guarda", guarda="...")`. `modos` é um dicionário `{"descobrir"|"recoletar"|"reprocessar": Modo(suporta: bool, motivo: str)}`.
  - `Classe` (enum com as dez classes) e `ARQUIVOS: dict[str, Classe]` com todo arquivo de 0.1.
- `comandos.py`: `COMANDOS: tuple[Comando, ...]`, todos os comandos da CLI.
- `coletores.py`: `COLETORES: tuple[Coletor, ...]`.
- `contrato.py`: o contrato comum, atendido por fora.
  - `descrever(coletor_id, recorte) -> Descricao(argv, urls_entrada, entradas_tipo, estimativa, nao_suportado)`. Sem rede e sem banco para URL estática; para dinâmica pode ler o banco (ex.: `sapl_houses`), nunca a rede.
  - `executar(coletor_id, recorte, *, runner=None) -> int`. O `runner` padrão é `civico_etl.cli.main(argv)`: o mesmo despacho da CLI, com os passos encadeados. O executor de administração passa um `runner` de subprocesso (`python -m civico_etl.cli`, como `schedule._run_cli`), para isolar o estado global de `http.RATE`. Nunca chama `run_*` direto.
  - Recorte que o comando não aceita hoje: `descrever` devolve `nao_suportado` com o motivo; `executar` recusa com `ValueError`. Nenhum argumento novo em job.

Exemplo simples, `camara.equipe` (URL em `jobs/camara_equipe.py:25`, delete em `:52`):

```python
Coletor(
    id="camara.equipe", modulos=("jobs/camara_equipe.py",),
    comandos=("camara.equipe",), tarefas=("camara.equipe",),
    fontes=("camara",), datasets=("camara.equipe",),
    acesso="arquivo",
    entradas=Entradas("estaticas", urls=("https://dadosabertos.camara.leg.br/arquivos/funcionarios/csv/funcionarios.csv",), depende_de=""),
    recortes_aceitos=(), recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
    tabelas=("staff_members",), territorio="nenhuma",
    ausentes=Ausentes("apaga", guarda="retrato: apaga todo staff_members com source_key 'camara:%' que não veio no arquivo; sem guarda de arquivo vazio"),
    encadeados=(),
    orquestradores=("etl.yml:run-due", "launchd-local:run-due", "agendar-local"),
    env=None,
    modos={"descobrir": Modo(False, "arquivo único, não há o que descobrir"),
           "recoletar": Modo(True, ""), "reprocessar": Modo(True, "")},
    caracterizado=True,
)
```

Exemplo irregular, `sapl.todas`. O módulo `jobs/sapl.py` tem dois coletores: `sapl.camaras` (abaixo) e `sapl.assembleias` (comando e tarefa `sapl.ales`, fonte `sapl-ale`).

```python
Coletor(
    id="sapl.camaras", modulos=("jobs/sapl.py", "jobs/assembleias.py"),
    comandos=("sapl.descobrir", "sapl.carregar", "sapl.todas"), tarefas=("sapl.todas",),
    fontes=("sapl",), datasets=("sapl.descoberta", "sapl.{ibge}"),
    acesso="api",
    entradas=Entradas("dinamicas", urls=("https://www12.senado.leg.br/interlegis/orgaosatendidos",),
                      depende_de="registro do Interlegis e sapl_houses (base_url de cada casa); as páginas seguintes da API só aparecem na leitura"),
    recortes_aceitos=("ibge", "uf", "escopo"), recortes_nao_aceitos=("ano", "casa"),
    tabelas=("sapl_houses", "sapl_cursors", "sapl_parlamentares", "sapl_mandatos", "sapl_materias",
             "sapl_autorias", "sapl_sessoes", "sapl_presencas", "sapl_votos", "data_coverage", "ingest_runs"),
    territorio="municipio",
    ausentes=Ausentes("nao_apaga", guarda=""),
    encadeados=(),
    orquestradores=("launchd-mac:run-due-sapl-prod",),
    env=None,
    modos={"descobrir": Modo(True, "sapl.descobrir"), "recoletar": Modo(True, "sapl.carregar"),
           "reprocessar": Modo(False, "a carga é incremental por cursor: reler o cache não reproduz a rodada")},
    caracterizado=True,  # etl/tests/test_sapl.py
)
```

Exemplo com efeitos encadeados: `camara.diario` e `camara.noturna`, dois coletores no mesmo arquivo. `API = https://dadosabertos.camara.leg.br/api/v2` e `FILES = https://dadosabertos.camara.leg.br/arquivos` (`jobs/camara_diario.py:34-35`).

```python
Coletor(
    id="camara.diario", modulos=("jobs/camara_diario.py",),
    comandos=("camara.diario",), tarefas=("camara.diario",),
    fontes=("camara",),
    datasets=("camara.deputados", "camara.votacoes.{ano}", "camara.proposicoes.{ano}", "camara.despesas.{ano}", "camara.despesasapi.{ano}"),
    acesso="api+arquivo",
    entradas=Entradas("dinamicas", urls=(
        "{FILES}/deputados/csv/deputados.csv",
        "{API}/deputados?idLegislatura={leg}&itens=100&ordem=ASC&ordenarPor=nome",
        "{FILES}/votacoes/csv/votacoes-{ano}.csv", "{FILES}/votacoesVotos/csv/votacoesVotos-{ano}.csv",
        "{FILES}/votacoesOrientacoes/csv/votacoesOrientacoes-{ano}.csv", "{FILES}/votacoesProposicoes/csv/votacoesProposicoes-{ano}.csv",
        "{FILES}/proposicoes/csv/proposicoes-{ano}.csv", "{FILES}/proposicoesAutores/csv/proposicoesAutores-{ano}.csv",
        "{FILES}/proposicoesTemas/csv/proposicoesTemas-{ano}.csv",
        "https://www.camara.leg.br/cotas/Ano-{ano}.csv.zip"),
        depende_de="detalhe de cada deputado ({API}/deputados/{id}) e despesas por deputado ({API}/deputados/{id}/despesas) saem da lista de deputados; paginação por cursor"),
    recortes_aceitos=("ano",), recortes_nao_aceitos=("uf", "casa", "ibge"),
    tabelas=("sessions", "mandates", "party_observations", "proposals", "voting_events", "votes", "orientation_actors",
             "party_orientations", "laws", "proposal_authors", "proposal_topics", "expenses",
             "people", "person_external_ids", "identity_match_queue", "parties", "party_aliases"),
    territorio="pais",
    ausentes=Ausentes("apaga_com_guarda", guarda="expenses: apaga só chaves do mesmo prefixo e ano que o arquivo não trouxe (camara_diario.py:898) e chaves de formato antigo (:953); o resto não apaga"),
    encadeados=("identity.dedupe", "derive.stats"),
    orquestradores=("etl.yml:run-due", "launchd-local:run-due", "agendar-local"),
    env=None,
    modos={"descobrir": Modo(False, "fonte única"), "recoletar": Modo(True, ""),
           "reprocessar": Modo(True, "desde que o cache tenha todas as URLs de entrada")},
    caracterizado=True,  # etl/tests/test_camara_*.py, test_cota.py
)
Coletor(
    id="camara.noturna", modulos=("jobs/camara_diario.py",),
    comandos=("camara.noturna",), tarefas=("camara.noturna",),
    fontes=("camara",), datasets=("camara.noturna.{ano}",),
    acesso="arquivo",
    entradas=Entradas("estaticas", urls=(
        "{FILES}/votacoes/csv/votacoes-{ano}.csv", "{FILES}/votacoesVotos/csv/votacoesVotos-{ano}.csv",
        "{FILES}/votacoesOrientacoes/csv/votacoesOrientacoes-{ano}.csv", "{FILES}/votacoesProposicoes/csv/votacoesProposicoes-{ano}.csv"),
        depende_de=""),
    recortes_aceitos=(), recortes_nao_aceitos=("ano", "uf", "casa", "ibge"),
    tabelas=("sessions", "proposals", "voting_events", "votes", "orientation_actors", "party_orientations"),
    territorio="pais",
    ausentes=Ausentes("nao_apaga", guarda=""),
    encadeados=(),  # a CLI não encadeia; na agenda, derive.stats roda depois porque derives=False
    orquestradores=("etl.yml:run-due", "launchd-local:run-due"),
    env=None,
    modos={"descobrir": Modo(False, "fonte única"), "recoletar": Modo(True, ""), "reprocessar": Modo(True, "")},
    caracterizado=True,
)
```
Os valores de `tabelas`, `ausentes` e `orquestradores` de cada entrada são conferidos no código pelo construtor e, para `encadeados`, por teste (R-7).

### 0.3 Relação com `TASKS`, `MAX_AGE_H`, `SOURCE_ENV` e os parsers

Decisão: **manter e conferir por teste; não derivar.** `schedule.py`, `cli.py` e os parsers de `ale_cli.py`, `sapl.py`, `sancoes.py` e `transparencia.py` não são editados na Parte R.

Motivos:
- `argv` e `prefixes` de `Task` são funções da data. Derivá-los de um catálogo declarativo exigiria pôr as mesmas funções no catálogo: a duplicação muda de arquivo e a ordem de `TASKS` (que é ordem de execução) passa a depender de outro módulo.
- O Mac roda `run-due` e pode ficar em versão antiga (D274). Mexer em `schedule.py` é o ponto de maior risco da restrição 5a e não rende nada à central.
- O despacho da CLI é uma sequência de `if` cuja ordem é a ordem do `all`. Derivá-lo é reescrever o despacho.

Conferência por teste (`etl/tests/test_catalogo.py`), nos dois sentidos:
- os nomes de comando são extraídos do código por AST, avaliando a expressão de `choices` no namespace do módulo (em `ale_cli.py` ela é uma compreensão de lista sobre `ADAPTERS`) (`choices` de `cli.py`, de `ale_cli.py`, `sapl.py`, `sancoes.py`, `transparencia.py`, `schedule.py`, mais os dois comandos inline `purge-raw` e `run-due`) e têm de ser iguais ao conjunto de `COMANDOS`;
- todo comando de classe coletor aparece em exatamente um `Coletor`; toda tarefa de `TASKS` aparece em exatamente um `Coletor` e seu `argv(data)[0]` é um comando desse coletor;
- `Task.needs_env` e `SOURCE_ENV` batem com `Coletor.env`; toda fonte de `Coletor.fontes` com prazo tem chave em `MAX_AGE_H`; `Task.source` bate com as fontes do coletor;
- `Comando.encadeia` é conferido contra o comportamento (R-7), não contra texto.

### 0.4 Estrutura de pastas

| Opção | Ganho | Custo | Onde quebra |
| --- | --- | --- | --- |
| (a) só catálogo e adaptadores, sem mover arquivo | zero risco para 5a; nenhum import de teste muda; mapa "de → para" vazio para arquivo | a pasta `jobs/` continua misturada; a separação é declarada, não física | nada quebra; a classificação pode envelhecer, e por isso um teste exige que todo arquivo de `jobs/` tenha classe |
| (b) mover por classe em subpacotes, com alias em `sys.modules` | separação física | 57 `monkeypatch.setattr` em módulos de `jobs/` dependem do objeto do módulo: cada alias precisa de teste de identidade. `ibge_malhas.py` resolve a saída por `Path(__file__).parents[3]` e passaria a gravar no lugar errado, sem erro. `test_camara_fuso.py` e `test_camara_starts_at.py` leem arquivos de job pelo caminho. `sapl.py` e `assembleias.py` alteram `http.RATE` no import: mudar a ordem de import muda a taxa de requisição do processo | os testes que leem arquivo por caminho (exigiriam mudar mais que linha de import); `fluxo_confere.py` (glob sem recursão deixa de ver os jobs, sem falhar); ~133 citações de caminho em `fluxo-de-dados.md` |
| (c) mover sem alias | o mesmo de (b), sem a camada de alias | tudo de (b), mais: todo import externo quebra | `evals/`, `schedule.py` (import de `jobs.repairs`), Mac em versão antiga em qualquer chamada cruzada |

Decisão: **(a)**. A reorganização é o catálogo, o contrato e a classificação declarada. Nenhum arquivo muda de lugar. R4 admite isso expressamente. Vira `AC-02` e entrada em `replica/decisions.md`.

### 0.5 Prova de que o comportamento não mudou

Na Parte R nenhum arquivo existente de `etl/civico_etl/` é editado: só o pacote novo `catalogo/` e testes. Isso torna R-9 verificável por `git diff --stat 39ee3ec..<fim de R> -- etl/civico_etl` (só arquivos novos em `catalogo/`).

| Critério | Prova |
| --- | --- |
| R-1 | `[suite]`; `git diff 39ee3ec..HEAD -- etl/tests` não altera arquivo existente (só acrescenta). Nenhum módulo movido, logo nenhum alias a provar |
| R-2 | `etl/tests/test_caracterizacao.py` com retratos em `etl/tests/retratos/*.json`, gerados sobre o código de `39ee3ec` e commitados antes de qualquer outra tarefa. Ver lista abaixo |
| R-3 | `etl/tests/test_retrato_agenda.py` contra `etl/tests/retratos/agenda.json` (todos os campos de `Task`, `argv` e `families` para 2026-10-04 e 2027-03-10, `MAX_AGE_H`, `SOURCE_ENV`) |
| R-4 | `etl/tests/test_orquestradores.py`: extrai nomes de `.github/workflows/*.yml`, `etl/deploy/*.sh`, `etl/agenda/*.sh` e confere contra os comandos extraídos da CLI por AST e contra `TASKS` |
| R-5 | `etl/tests/test_catalogo.py` (0.3). Fontes: cada `Coletor.fontes` traz o slug e de onde ele nasce (`seed`, `migracao` ou `job`). O teste confere no banco, depois do seed, as de origem `seed` e `migracao` (`ibge-sidra`, `bcb-sgs`, `receita-federal` vêm da 0040). As de origem `job` (`sapl-ale` em `sapl.py:650`; `alesp` e `alemg` em `assembleias.py:320`) não existem depois do seed: o teste confere, por leitura do código-fonte do módulo, que o slug é criado lá. O critério R-5 como escrito ("toda fonte existe em `sources` depois do seed") é impossível para essas três; vira `AC-04` e o original sai como "substituído" no relato. A paridade de `test_schedule.py` segue na suíte |
| R-6 | `etl/tests/test_retrato_plano.py`: `schedule.plan()` com `now` fixo, filtros fixos e carimbos fabricados, contra `etl/tests/retratos/plano.json` |
| R-7 | `etl/tests/test_contrato_cadeia.py`: troca `run_camara`, `run_senado`, `run_dedupe`, `run_derive` por gravadores e compara a sequência via `cli.main([...])` e via `contrato.executar(...)`, em dois cenários: carga normal e `SkipUnchanged` levantada pelo job |
| R-8 | `etl/tests/test_codigos_saida.py`: `cli.main(["check"])` com invariante quebrada devolve 1; `schedule.main` com alerta devolve 2 |
| R-9 | o `git diff --stat` acima |
| R-10 | `python3 -I replica/tools/fluxo_confere.py`: os mesmos 7 problemas da linha de base, nenhum novo |

Divergência conhecida entre o prompt e o código, a caracterizar e registrar em `replica/bugs.md` sem corrigir: o critério R-7 fala em "entrada inalterada interrompe a cadeia". No código, todo `run_*` que passa `input_checksum` captura `SkipUnchanged` por dentro (os que não passam, como `run_extras`, `run_malhas` e `run_pauta`, nunca a levantam), então `camara.diario` sem mudança ainda roda `identity.dedupe` e `derive.stats`; o `except` de `cli.py` só atua se a exceção escapar. O teste fixa o comportamento real nos dois cenários.

Caracterização (R-2). Regra: nenhum coletor é tocado por dentro na Parte R, então a obrigação de R-2 só nasce para o que for tocado depois. Mesmo assim, caracterizo os que o módulo de administração vai acionar ou envolver e cuja entrada é barata de fabricar.

Lista confirmada (levantamento 03 e conferência do verificador por `grep` de imports em `etl/tests`): doze módulos de coleta não são importados por teste nenhum.

| Módulo | Situação hoje | Decisão |
| --- | --- | --- |
| `camara_equipe` | sem import; só guarda estática que lê o arquivo como texto | caracterizar pela CLI |
| `receita_arrecadacao` | sem teste | caracterizar pela CLI |
| `ibge_places` | sem teste | caracterizar pela CLI |
| `ibge_populacao` | sem teste | caracterizar pela CLI |
| `governos_indicadores` | sem teste | caracterizar pela CLI (a entrada fabricada traz os 4 valores `KNOWN`) |
| `parlamento_extras` | sem import; só guarda estática | caracterizar pela CLI (a Parte B depende do delete de `mandate_contacts`) |
| `ale_cli` | sem teste | caracterizar `ale.cobertura` (caminho sem rede) |
| `almg` | sem import; só strings em `test_assembleias.py` | "sem caracterização": não tocado por dentro |
| `alesp` | idem | "sem caracterização": não tocado |
| `camara_presenca` | sem import; só guarda estática | "sem caracterização": não tocado |
| `senado_extras` | sem teste | "sem caracterização": não tocado |
| `ibge_malhas` | sem teste; grava em `web/public/geo` | "sem caracterização": não tocado |

Fora dessa lista: `tse_candidatos`, `tse_votos_contas` e `tse_bug019` têm teste, mas o caminho de zip remoto por faixa (`remotezip`) fica "sem caracterização" e não é tocado. `identity_bug033/038/041` não têm teste do job, são reparo pontual, estão fora do catálogo de coletores e não são tocados.

Isolamento. Os testes de caracterização e os `test_admin_*` que precisam de commit de verdade não usam o banco da suíte. Uma fixture de sessão (`etl/tests/banco_isolado.py`) cria um banco próprio (`<banco da suíte>_iso_<pid>`), aplica `db/migrate.sh --local`, roda o seed e `base.sql`, aponta `ETL_DATABASE_URL` para ele durante o teste e o apaga no fim (em `finally`). Motivos: `db.run` grava `ingest_runs` e `dataset_stamps` com commit, e um município fabricado no banco da suíte faria os testes hoje pulados por "banco sem carga" rodarem e falharem. Se a criação do banco falhar, o teste falha; não pula. O comando roda pela CLI (`cli.main`) e as tabelas de destino são comparadas com o retrato, ignorando `id`, `created_at`, `updated_at`, `run_id`, `last_run_id` e horários de execução.

### 0.6 O que não será reorganizado

- Nenhum arquivo muda de pasta (0.4).
- `schedule.py`, `cli.py` e os quatro parsers próprios não mudam na Parte R (0.3). `cli.py` ganha um único desvio aditivo na Parte A (`admin`).
- O campo `Task.derives`, que tem dois sentidos, fica como está: mudar é correção, fora desta entrega.
- As escritas fora de `db.run` (`sapl.py:424`, `governos_indicadores.py:97`, `repairs.py`) ficam como estão; o catálogo as declara.
- Nenhuma lacuna da seção 10 de `fluxo-de-dados.md` é consertada, exceto dar executor a `identity_match_queue` (10.7), que é a classe 4 da Parte B.

## 1. Modelo de dados novo

Migração `db/migrations/0150_admin_coleta.sql` (tabelas das Partes A e B) e `0151_admin_central.sql` (role, policies, visões; Parte C). O número é conferido com `ls db/migrations` na hora. Todas as tabelas com prefixo `adm_`, RLS ligada, sem policy pública.

| Tabela | Para quê | Chave e pontos principais |
| --- | --- | --- |
| `adm_rodadas` | rodada com identificador e parâmetros, repetível | `id uuid`; `coletor`, `modo` (`descobrir`, `recoletar`, `reprocessar`), `argv jsonb`, `recorte jsonb`, `previa jsonb`, `repete_id` (rodada de origem), `so_pendencias bool`, `forcar_urls jsonb`, `status`, `invocation` (liga a `ingest_runs.invocation`), `cache_dir`, `iniciada_em`, `finalizada_em` |
| `adm_tentativas` | uma linha por tentativa de URL | `rodada_id`, `url`, `url_sha`, `host`, `tentada_em`, `resultado` (`lida`, `reaproveitada`, `falha`), `http_status`, `motivo` (`bloqueio`, `robots`, `expiracao`, `erro`, `sem_conteudo`), `conteudo_sha256`, `bytes`, `entrada bool` |
| `adm_evidencias` | última evidência válida por URL | PK `url_sha`; `url`, `conteudo_sha256`, `lida_em`, `fonte_declarada_em`, `rodada_id`. Só é regravada por leitura bem-sucedida: falha não a toca |
| `adm_vinculos` | URL ou fonte ↔ registro, com origem e histórico | `classe`, `registro_chave`, `fonte_slug`, `url`, `url_sha`, `origem` (`registro_oficial`, `descoberta_automatica`, `correcao_manual`), `vigente`, `substitui_id`, `rodada_id`, `decisao_id`. Único parcial em (`classe`, `registro_chave`, `url_sha`) onde `vigente` |
| `adm_propostas` | valor candidato com evidência | `classe`, `registro_chave`, `campo`, `valor_vigente jsonb`, `valor_candidato jsonb`, `url`, `trecho`, `conteudo_sha256`, `lida_em`, `fonte_declarada_em`, `alcance` (`registro`, `regra`), `regra_criterio`, `regra_ids jsonb`, `fonte_slug`, `rodada_id`, `chave_idem` única. `url`, `trecho` e `conteudo_sha256` `not null` com `check` de não vazio |
| `adm_pendencias` | uma por (classe, registro, campo) | `pergunta`, `tipo` (`mudanca`, `divergencia`, `duplicata`, `confirmacao`), `status` (`aberta`, `decidida`), `reaberta bool`, `motivo_reabertura` (`evidencia_mudou`, `registro_mudou`), `evidencia_sha`, `vigente_sha`, `vence_em`, `cobertura_recorte numeric`. Única em (`classe`, `registro_chave`, `campo`) |
| `adm_pendencia_propostas` | propostas de uma pendência | (`pendencia_id`, `proposta_id`) |
| `adm_decisoes` | trilha de decisão, só acréscimo | `pendencia_id`, `acao` (`aprovar`, `corrigir`, `descartar`, `pedir_confirmacao`), `decidido_por_tipo` (`pessoa`, `agentes`), `decidido_por_nome`, `relatorio`, `versao_verificador`, `justificativa not null`, `campos_afetados jsonb`, `valor jsonb`, `aplicada bool`, `aplicada_em`, `criada_em` |
| `adm_overrides` | valor que a decisão fixou, por (classe, registro, campo) | `valor jsonb`, `suprimir bool`, `decisao_id`, `vigente`. Lida pelos gatilhos do item 2 |
| `adm_pareceres` | parecer de IA guardado | `pendencia_id`, `pedido_id`, `modelo`, `versao_verificador`, `entrada jsonb`, `saida jsonb`, `modo` (`ensaio`), `simulado bool` |
| `adm_pedidos` | fila entre a tela e o executor | `tipo` (`rodada`, `recoleta`, `parecer`), `parametros jsonb`, `chave_idem`, `status`, `criado_em`, `iniciado_em`, `batimento_em`, `finalizado_em`, `rodada_id`, `andamento jsonb`, `erro`. Único parcial em `chave_idem` onde `status in ('na_fila','em_execucao')` |

Estados e transições, travados por gatilho (padrão de `answer_drafts_guard`):
- Rodada: `aberta → em_andamento → concluida | interrompida | falhou`. `interrompida` pode voltar a `em_andamento` (repetição pelo mesmo id). Terminal não volta.
- Pendência: `aberta → decidida`; `decidida → aberta` só com `reaberta = true` e `motivo_reabertura` preenchido.
- Decisão: linha imutável, exceto `aplicada` e `aplicada_em`, que só passam de falso para verdadeiro. Decisão com `decidido_por_tipo = 'agentes'` só recebe `aplicada = true` se existir linha `admin_coleta_agentes = 'on'` em `pipeline_switches` (segunda chave conferida também no banco).
- Pedido: `na_fila → em_execucao → concluido | falhou | interrompido`.

Reaproveitado sem alteração de coluna: `sources`, `ingest_runs` (ligado à rodada por `invocation`), `dataset_stamps`, `etl_schedule_attempts`, `sapl_houses`, `data_coverage`, `mandate_contacts`, `identity_match_queue`, `person_external_ids`, `merge_person`, `pipeline_switches`, `corrections`. O que as tabelas existentes ganham: gatilhos (item 2) e policies de leitura para o role da central (4a). Nenhuma coluna existente muda.

Classes de campo (Parte B):

| Classe | Significado | Fonte aceita | Revalidação | Chave estável |
| --- | --- | --- | --- | --- |
| `vinculo_sapl` | `sapl_houses.base_url` e `status`: em que endereço a casa publica o SAPL e se ele responde | registro do Interlegis; resposta de `/api/` da própria instalação; `robots.txt` | 7 dias (igual à re-sondagem de `to_discover`) | `sapl_houses.id` |
| `cobertura` | `data_coverage.status`, `reason`, `evidence_url`: o que o site diz ter ou não ter de um lugar | a página ou API da própria casa que comprova o estado | 8 dias (prazo de `sapl` e `sapl-ale` em `MAX_AGE_H`) | `places.ibge_code` + `dataset` |
| `contato_mandato` | `mandate_contacts`: canal oficial do mandato | página ou API oficial da casa, no bloco do parlamentar | 7 dias (intervalo de `parlamento.extras`) | `mandates.id` |
| `identidade` | `identity_match_queue`: se o registro da fonte é a pessoa candidata | o registro da fonte (`raw`) e os identificadores de `person_external_ids` | sem prazo: reabre quando `raw` ou o candidato muda | `identity_match_queue.id`, com `people.id` do candidato |

## 2. Como uma decisão aprovada sobrevive à carga seguinte

Confirmado no código (levantamento 02):

| Classe | Quem regrava | Quando | A correção manual some? |
| --- | --- | --- | --- |
| `sapl_houses` de Assembleia | `sapl.py:672` (`discover_ales`) | toda execução de `sapl.ales` (20 h) | sim: `base_url`, `status`, `note` |
| `sapl_houses` de Câmara | `sapl.py:362` (`discover`) | casa sem linha, ou `fora_do_ar`/`sem_api` há mais de 7 dias, ou `--ibge` explícito | só nesses casos |
| `data_coverage` | `sapl.py:639` e `:422`, `assembleias.py:338` e `:376`/`:378` (update direto) | a cada recarga da casa; a cada 48 h sem legislatura; a cada `ale.todas` | sim, para `propostas`, `presenca`, `votos` com SAPL ou ALE; os outros datasets sobrevivem |
| `data_coverage` | `derive_stats.py:476` (`COVERAGE_SQL`, `on conflict do nothing`) | todo `derive.stats`, encadeado em 9 comandos e na agenda; propõe cerca de 33 mil linhas | não: nunca sobrescreve, só recria linha apagada |
| `mandate_contacts` | `parlamento_extras.py:125` (delete) e `:126` (insert sem atualização) | a cada 7 dias, para mandatos com contato na rodada e fonte `camara`/`senado` | sim: o delete apaga todo contato dessas fontes do mandato |
| `identity_match_queue` | `identity.py:592`, `assembleias.py:292`, só enquanto `pendente` | toda carga | não |

Opções para as classes em que some:

| Opção | Ganho | Custo | Onde quebra |
| --- | --- | --- | --- |
| (a) override lido pelo job antes do upsert | explícito no código do coletor | edita `sapl.py`, `assembleias.py` e `parlamento_extras.py` por dentro, contra a regra de zero mudança em coletor; Mac em versão antiga ignora o override e apaga a correção | qualquer coletor novo que esqueça de consultar |
| (b) gravar na tabela e travar a chave para o job | valor fica na tabela que o site lê | a trava também é código dentro do job: mesmos custos de (a) | idem |
| (c) não gravar; corrigir só o vínculo de fonte | nenhuma camada nova | não serve quando a fonte está certa e o valor lido está errado, nem para `data_coverage.reason`, que é texto do próprio job | `ALE_SAPL` é dicionário fixo no código: não há vínculo a corrigir para Assembleia |
| (d) override imposto pelo banco: gatilho `before insert or update` nas três tabelas, que lê `adm_overrides` | zero edição em coletor; vale para o Mac em versão antiga e para qualquer coletor futuro; sem linha em `adm_overrides`, o resultado gravado é idêntico ao de hoje | o gatilho dispara por linha proposta, inclusive nas cerca de 33 mil de `derive.stats` que caem em `do nothing`: uma busca por índice em tabela pequena por linha. A1 mede esse custo (inserção de 33 mil linhas com e sem gatilho) e o número vai para a decisão. A regra fica no banco, longe do código do job | sessão com `session_replication_role = replica` pula gatilho; produção precisa da migração antes da primeira decisão; override com valor que fere um `check` da tabela derrubaria a rodada do job |

Decisão: **(d)**, com (c) como complemento quando o erro é o vínculo. Vira `AC-03` e entrada em `replica/decisions.md`.

Detalhe por tabela:
- `sapl_houses`, `data_coverage`: gatilho `before insert or update`. Se há override vigente para (registro, campo), `NEW.campo := valor do override`. O job continua rodando e gravando o resto da linha.
- `mandate_contacts`: a correção aprovada é uma linha com `source_id` de uma fonte própria (`curadoria`, inserida em `sources` pela migração), que o delete de `parlamento_extras` não alcança (ele filtra `camara`/`senado`). Valor descartado: override com `suprimir = true`, e gatilho `before insert` devolve `NULL` para (mandato, tipo, valor) suprimido. Não há gatilho de delete: cancelar delete em cascata de mandato quebraria a integridade referencial.
- `identity_match_queue`: sem gatilho. O executor da decisão grava `status`, `resolved_by`, `resolved_at`; em "aceito", cria o vínculo em `person_external_ids`. Unir pessoas, só por `merge_person`, em decisão própria do tipo `duplicata`.

Limites e cuidados do desenho:
- O valor de um override é validado contra os `check` da tabela de destino no momento da decisão (a aplicação faz o `update` real dentro da transação da decisão; se falhar, a decisão não é marcada aplicada e nenhum override é gravado). Assim um override inválido nunca chega a existir.
- `sapl_houses.base_url` de Assembleia: `discover_ales` sonda o endereço de `ALE_SAPL`, fixo no código. Um override de `base_url` desacoplaria o endereço guardado do endereço sondado. Por isso, para Assembleia só `status` aceita override; divergência de `base_url` abre pendência do tipo `confirmacao`, e a aprovação grava o vínculo em `adm_vinculos` com origem `correcao_manual`, sem reescrever `sapl_houses`. Trocar o endereço sondado é mudar `ALE_SAPL`, fora desta entrega.
- Corrigir um contato são duas linhas em `adm_overrides` na mesma decisão: suprimir o valor antigo e inserir o novo com a fonte `curadoria`.
- Restrição 4: o gatilho é o ponto mais discutível da entrega. Fica registrado em `AC-03` com a alternativa (a) descrita e o comando para remover (`drop trigger`).

Prova: critério 11, um teste por classe que aplica a decisão, roda de novo o job de origem pela CLI sobre entrada fabricada e confere o valor.

## 3. Quando uma mudança aplicada vira linha em `corrections`

`corrections` é pública e hoje não tem escritor nem leitor no código (a página `/como-funciona` lê `answer_drafts`). Regra:

- **Vira linha** quando as três condições valem: a decisão foi aplicada; ela trocou um valor que já existia (não é primeiro preenchimento); e o campo tem leitor no site público. Leitores confirmados: `data_coverage` (`getCoverage`, `getAssembly`), `sapl_houses.status` de Assembleia (`getAssembly`), `mandate_contacts` (o construtor confirma o leitor em `pg.ts`).
- **Não vira** em: descarte; pedido de confirmação; decisão de identidade (não troca valor publicado; a união, se houver, já tem trilha própria); primeiro preenchimento; campo sem leitor no site (caso de `sapl_houses.base_url` de Assembleia, a confirmar).
- Se o DDL de `corrections` exigir coluna que a decisão não tem como preencher com verdade, não grava e a divergência vira decisão registrada.

## 4. Interface

### 4.1 CLI

`civico-etl admin <subcomando>`, saída em tabela e `--json`. Um desvio novo em `cli.py` (`args[0] == "admin"` → `civico_etl.admin.cli.main`), antes do argparse, como os de `ale.` e `sapl.`. Código em `etl/civico_etl/admin/`.

| Subcomando | Faz |
| --- | --- |
| `inventario [--coletor X]` | fonte, datasets, tarefa, intervalo, orquestrador, último run, última tentativa, frescor, estado |
| `vinculos --url U \| --fonte F \| --registro CLASSE:CHAVE` | os dois sentidos do vínculo, com origem e histórico |
| `previa --coletor X [recorte] --modo M` | recorte, registros elegíveis, URLs de entrada únicas, quantas serão consultadas depois de cache; sem rede; estimativas marcadas |
| `rodada abrir ...`, `rodada executar ID`, `rodada repetir ID [--pendencias] [--forcar-url U]` | abre, executa e repete rodada |
| `relatorio ID` | coleta e revisão separadas, com denominador e IDs |
| `fila [--classe C]`, `pendencia ID` | fila na ordem da restrição 7; detalhe com evidência |
| `decidir ID --acao A --por NOME --justificativa T [--valor V]` | grava decisão de pessoa |
| `aplicar [--decisao ID]` | aplica decisões de pessoa pendentes de aplicação |
| `parecer --pendencia ID \| --rodada ID` | gera parecer em ensaio |
| `candidata [--rodada ID]` | edição candidata: diferenças por ID e campo, com evidência, e pendências restantes |
| `executor [--uma-vez] [--intervalo S]` | consome `adm_pedidos` |

Reprocessamento sem rede: **cache em disco de `http.fetch`**, não a cópia do bruto. Motivo: o cache é indexado por URL e é o que os coletores leem; a cópia do `rawstore` não alimenta `fetch`, e usá-la exigiria um caminho de leitura novo. As rodadas usam o cache comum do ETL (um diretório por rodada perderia ETag e reaproveitamento entre rodadas); `adm_rodadas.cache_dir` registra qual foi. Reprocessar é rodar o mesmo comando com o modo sem rede, depois de o executor conferir que todas as URLs de entrada estão no cache; faltando alguma, recusa antes de rodar.

Mudanças em `etl/civico_etl/http.py` (infraestrutura com teste próprio, não coletor), todas desligadas por padrão e sem efeito sem a variável:
- `ETL_ATTEMPT_LOG=<arquivo>`: `fetch` acrescenta uma linha JSON por tentativa (URL, horário, status, hash, e o desfecho: `cache_fresco`, `revalidada_304`, `baixada` ou `falha` com o motivo). Uma linha por `write` em arquivo aberto com `O_APPEND`, para valer com `--workers`. O executor importa o arquivo para `adm_tentativas`; `cache_fresco` e `revalidada_304` entram como `reaproveitada`. Sobrevive à morte do subprocesso.
- `ETL_HTTP_OFFLINE=1`: `fetch` serve só do cache, qualquer que seja a idade. URL ausente levanta `SemRedeSemCache`, que herda de `BaseException`. Motivo: `sapl.py:355` e `:668` transformam qualquer `Exception` em `fora_do_ar` ou `sem_api`; com `BaseException` o processo aborta com código 1 e nenhum status falso é gravado.
- `ETL_HTTP_REFETCH=<arquivo>`: URLs listadas ignoram o cache nesta execução.

Limites declarados do registro de tentativas:
- Bloqueio por robots.txt acontece em `assembleias.allowed`, antes de `fetch`: o executor registra essa tentativa a partir de `sapl_houses.status = 'robots_bloqueia'` depois da rodada. Para coletores fora do SAPL, bloqueio por robots não aparece.
- `remotezip.py` (zip do TSE por faixa) e `http.api_json` (Portal da Transparência) não passam por `fetch`: os coletores que os usam têm `tentativas_registradas = False` no catálogo, e a prévia e o relatório dizem "tentativas não registradas" em vez de zero.

Evidência em página de diretório (Parte B): uma proposta de `contato_mandato` só é aceita se o `trecho` for um caminho (JSON pointer ou seletor) dentro do bloco do próprio parlamentar; o proponente recebe o bloco já delimitado e rejeita evidência fora dele. Contato de rodapé é da Casa e não vira proposta de mandato.

### 4.2 Central: rotas e telas

Grupo `web/src/app/(admin)/`, URLs sob `/admin`. Sem `loading.tsx` no grupo. O mapa e as listas são renderizados no servidor; a atualização periódica é de um componente cliente.

| Rota | O que aparece, em ordem | O que cada ação grava |
| --- | --- | --- |
| `/admin` | alternância Coleta \| Revisão; dois painéis separados com totais e denominadores, cada total é link para a lista; mapa do Brasil com contagem por UF (número escrito e preenchimento em `--tint`); linha "sem território" com contagem; busca de município e de registro; aviso de executor parado, se houver | "Abrir rodada" grava `adm_pedidos` (tipo `rodada`) |
| `/admin?uf=XX` | o mesmo, com o mapa da UF por município; linha "da UF, sem município" com contagem; Esc ou link volta ao Brasil | idem |
| `/admin/registros?uf=&municipio=&classe=&motivo=` | "Ver registros": lista de fichas do território, incluindo as sem ponto no mapa, cada uma com o motivo (alcance nacional, território não resolvido, vínculo corrigido aguardando validação) e a marca "aproximada" para ficha de UF | "Recoletar fichas pendentes" grava `adm_pedidos` (tipo `recoleta`, com território e classe) |
| `/admin/ficha/[classe]/[chave]` | identificação e território; por campo: valor vigente, candidatos, evidência (URL, trecho, datas, hash); pendências com a pergunta; pareceres; histórico de decisões | "Aprovar", "Corrigir", "Descartar", "Pedir confirmação" gravam `adm_decisoes` (pessoa, justificativa obrigatória); "Pedir parecer" grava `adm_pedidos` (tipo `parecer`) |
| `/admin/fila` | pendências na ordem da restrição 7, reabertas marcadas com o motivo | nenhuma (leva à ficha) |
| `/admin/rodadas` e `/admin/rodadas/[id]` | lista de rodadas; na rodada: parâmetros, andamento, tentativas com motivo de falha, fichas alcançadas, e por campo o valor recuperado, a fonte e o que falta confirmar | "Repetir", "Repetir só pendências", "Parecer das pendentes" gravam `adm_pedidos` |
| `/admin/api/estado`, `/admin/api/pedidos`, `/admin/api/decisoes` | JSON para a consulta periódica (intervalo fixo de 5 s) e para gravar pedido e decisão | os mesmos acima |

Estados de tela (C5). "Carregando" não usa `loading.tsx`: é o estado inicial das regiões vivas do componente cliente até a primeira resposta da consulta periódica; o conteúdo renderizado no servidor já está na página.

| Estado | Quando | O que a tela mostra | Prova |
| --- | --- | --- | --- |
| vazio | nenhuma rodada em `adm_rodadas` | "Nenhuma rodada ainda", com o comando e o botão para abrir a primeira | `sem-navegador.mjs` com banco sem rodada |
| carregando | antes da primeira resposta da consulta periódica | marca textual "atualizando" nas regiões vivas (`aria-busy`) | spec Playwright; HTML inicial conferido em `sem-navegador.mjs` |
| erro de leitura do banco | a consulta falha | aviso "Não foi possível ler o banco", sem números | `sem-navegador.mjs` com `ADMIN_DATABASE_URL` local de porta fechada |
| rodada em andamento | `adm_rodadas.status = 'em_andamento'` | andamento e contadores parciais, marcados como parciais | `sem-navegador.mjs` com fixture |
| rodada interrompida | `status = 'interrompida'` | aviso e ação "Repetir" | idem |
| território sem ficha | UF ou município com contagem zero | território vazio (sem preenchimento) e o texto "0 fichas" | idem |
| ficha sem evidência válida | nenhuma linha em `adm_evidencias` para os vínculos da ficha | "Sem evidência válida", com a última falha e o motivo | idem |
| executor parado | regra de 4.3 | aviso com o tempo de espera | idem |

Ordem da fila (restrição 7): classe do campo, tipo de pendência, `vence_em`, `cobertura_recorte`, e `id` como desempate. Nenhuma coluna de pessoa ou partido participa; o critério 13 testa a consulta.

### 4.3 Pedidos e executor (C3)

- A tela só insere em `adm_pedidos` e `adm_decisoes`. O executor (`civico-etl admin executor`) consome.
- Idempotência: `chave_idem` = hash de (tipo, parâmetros normalizados). O índice único parcial recusa segundo pedido igual enquanto o primeiro está `na_fila` ou `em_execucao`; a API devolve o pedido existente.
- O executor pega um pedido com `for update skip locked`, marca `em_execucao`, atualiza `batimento_em` a cada 15 s e `andamento` a cada etapa.
- Executor morto no meio: pedido `em_execucao` com `batimento_em` mais velho que 120 s é marcado `interrompido` pelo próximo executor que subir, e a rodada dele vira `interrompida`. Nada é desfeito: o que já foi gravado fica, e repetir a rodada é idempotente (critério 5).
- Executor parado: existe pedido `na_fila` há mais de 60 s, ou `em_execucao` com `batimento_em` mais velho que 120 s. A tela mostra o aviso com o tempo de espera. O segundo caso continua ocupando a `chave_idem` até um executor subir e marcá-lo `interrompido`: a API devolve o pedido existente com esse estado, e a tela diz que ele está parado.
- O executor valida `parametros` contra o catálogo (coletor, modo e recorte declarados como suportados) e recusa o que não bater, marcando o pedido `falhou` com o motivo. A tela nunca passa argv.
- Decisão de pessoa gravada pela tela é aplicada pelo executor (ou por `admin aplicar`). Decisão de agentes só se aplica com as duas chaves.

Duas chaves dos agentes, próprias deste módulo e desligadas: variável `ADMIN_COLETA_AGENTES=on` e linha `admin_coleta_agentes = 'on'` em `pipeline_switches`. Não reuso o par `VERIFICACAO_AGENTICA`: ligar a verificação de respostas não pode ligar a aplicação de campos. A migração não insere a linha (ausente é desligado).

Parecer de IA: recebe só as evidências vinculadas à ficha, devolve proposta por campo com o trecho, ou "falta confirmar X". Sem chave de API no ambiente, o parecer é gerado por um motor de ensaio local e gravado com `simulado = true`. Chamada real só com chave presente e `--real`; teto de 20 chamadas na entrega.

## 4a. Acesso da central

- Variáveis: `ADMIN_CENTRAL=1` liga; `ADMIN_DATABASE_URL` é a URL do role da central.
- A guarda (`web/src/lib/admin/guarda.ts`, chamada no `layout.tsx` do grupo antes de qualquer Suspense, e no início de cada route handler) responde 404 se qualquer uma destas for verdadeira: `ADMIN_CENTRAL` diferente de `1`; `VERCEL` definida; `VERCEL_ENV` definida; `ADMIN_DATABASE_URL` ausente; host de `ADMIN_DATABASE_URL` fora de `localhost`, `127.0.0.1`, `::1`.
- A mesma guarda é chamada dentro de cada função de `web/src/lib/admin/consultas.ts`, antes de abrir conexão: layout e página renderizam em paralelo, e a página não pode consultar o banco quando o layout responde 404. O host é normalizado antes da comparação (`[::1]` vira `::1`).
- Brecha residual, declarada: um túnel local para um banco de produção, ou uma hospedagem que não defina `VERCEL`, passam pela guarda se alguém ligar `ADMIN_CENTRAL` de propósito. Publicar com login e papel de admin é o que fecha isso, e fica para depois.
- `NODE_ENV=production` sozinho não bloqueia: `next start` local roda assim, e os testes dependem dele. O que impede a subida a produção por engano é a soma: a Vercel sempre define `VERCEL`; e uma URL de banco de produção nunca tem host local. A trava de `DATA_SOURCE` em `lib/data/index.ts` não é usada nem alterada.
- Role `admin_central`, criado na migração `0151` com `if not exists` e `nologin`, sem senha. Login e senha locais em `db/local/post_0003_admin_central.sql`, idempotente (`alter role`), porque `migrate.sh --local` o roda toda vez.
- Grants: `select` nas tabelas `adm_*` e nas de domínio que a central lê (`sapl_houses`, `data_coverage`, `mandate_contacts`, `mandates`, `people`, `places`, `legislative_bodies`, `identity_match_queue`, `sources`, `ingest_runs`, `dataset_stamps`, `etl_schedule_attempts`); `insert` só em `adm_pedidos` e `adm_decisoes`. Sem `update` e sem `delete` em nada.
- Policies só para `admin_central`: leitura nas tabelas acima; inserção em `adm_decisoes` com `check (decidido_por_tipo = 'pessoa' and aplicada = false)`; inserção em `adm_pedidos` com `check (status = 'na_fila')`.
- Pool próprio em `web/src/lib/admin/db.ts`, criado sob demanda dentro de função, com `server-only`. Não importa `lib/data/pg.ts` nem `lib/db/writer.ts`. Driver: `postgres`, que já é dependência do site. Nenhuma dependência de execução nova.
- `noindex` por `metadata.robots` no layout do grupo; título com `title.absolute`. A central não entra em menu, rodapé nem sitemap (o site não tem sitemap).

## 4b. Território

Confirmado no schema: `sapl_houses.place_id → places.id`; `data_coverage.place_id → places.id`; `mandate_contacts.mandate_id → mandates.id → mandates.place_id`. A tabela do item C0 vale como escrita.

Identidade: **só em "Ver registros"**, com o motivo "território não resolvido". `identity_match_queue` não tem lugar; o único caminho passa por `candidate_person_id`, que é o suspeito escolhido por `sorted(held)[0]` e pode ser nulo. Pôr a ficha no mapa pelo mandato do suspeito seria afirmar um território que a fonte não deu.

## 4c. Testes ponta a ponta da central

Fato do ambiente: o Playwright não roda nesta sessão. Não há navegador do Playwright instalado, e o Chrome do sistema não lança dentro do sandbox (`Failed to create a ProcessSingleton`). Conduta do prompt: não contornar. Consequência, assumida desde já:

- Os specs e a configuração são escritos e entregues: `web/e2e-admin/*.spec.ts` e `web/playwright.admin.config.ts` (porta 3210, `NEXT_DIST_DIR=.next-admin`, `DATA_SOURCE=demo`, `ALLOW_DEMO_DATA=1`, `ADMIN_CENTRAL=1`, `ADMIN_DATABASE_URL` local). O `webServer` da configuração sobe `next build && next start`. O `globalSetup` carrega a fixture no banco. O executor é chamado pelos próprios testes, uma execução por passo (`civico-etl admin executor --uma-vez`), para o tempo ser determinístico. `web/playwright.config.ts` e `web/e2e/` não são tocados.
- Critérios 21 e 26 saem como "não executado", com o comando exato para o dono.
- Prova sem navegador, executada aqui: `web/e2e-admin/sem-navegador.mjs` (Node puro, sem dependência). Ele sobe `next start` (o bind em porta local foi provado nesta sessão), faz as requisições por `fetch` e confere status e HTML. Cobre 15 (status 404 por rota, nos dois casos), 19 (os números dos dois painéis, lidos do HTML renderizado, contra `civico-etl admin relatorio --json`), 20, 22, 24, os estados de tela de 4.2 e, para o 23, a varredura do HTML servido em busca de URL absoluta fora de `localhost`. Por isso o mapa, os painéis e as listas são renderizados no servidor.
- Critério 23, parte estática: `web/e2e-admin/sem-rede-externa.mjs` varre `web/src/app/(admin)`, `web/src/components/admin`, `web/src/lib/admin` e `web/src/styles/admin.css` atrás de URL absoluta, `fetch` para fora, e recurso remoto em `<link>`, `<script>` e `url()` de CSS. Falha com código 1 se achar.
- Critério 25: `next build` nas condições do CI roda aqui (linha de base: passa). O conjunto ponta a ponta público não roda aqui pelo mesmo motivo. A conduta do prompt só prevê "não executado" para 21 e 26, então o 25 sai como **"não atendido"** na parte de execução, com decisão registrada (`AC-05`), o critério substituto (`git diff --stat 39ee3ec..HEAD -- web/e2e web/playwright.config.ts` vazio, mais o build do CI passando) e o comando para o dono rodar.
- As páginas da central são `force-dynamic` (herdado do layout raiz) e o pool é criado sob demanda: o build não toca banco. Prova: o `next build` do CI reproduzido sem `ADMIN_*`.

## 5. Registro de tentativas por URL

**Tabela nova** (`adm_tentativas`), não extensão do manifesto de `rawstore`. Motivos:
- o `rawstore` é desligado por padrão e seu manifesto descreve blobs guardados; tentativa que falha não tem blob;
- volume: uma rodada de `sapl.todas` passa por centenas de hosts e, com paginação, chega a dezenas de milhares de requisições. A tabela é estreita, indexada por `rodada_id` e por (`url_sha`, `tentada_em desc`), e a última evidência válida fica em `adm_evidencias` (uma linha por URL), então consultar "a evidência vigente" não varre tentativas;
- as tentativas chegam por arquivo de log (`ETL_ATTEMPT_LOG`) e entram em lote, sem custo por requisição no coletor.

## 6. Arquivos e testes por critério

Criar:
- `etl/civico_etl/catalogo/{__init__,modelo,comandos,coletores,contrato}.py`
- `etl/civico_etl/admin/{__init__,cli,inventario,vinculos,rodadas,tentativas,relatorio,propostas,pendencias,decisoes,aplicar,parecer,executor,classes}.py`
- `db/migrations/0150_admin_coleta.sql`, `db/migrations/0151_admin_central.sql`, `db/local/post_0003_admin_central.sql`
- `etl/tests/retratos/*.json`, `etl/tests/fixtures/sapl_ale/*` (respostas fabricadas), `etl/tests/fixtures/admin_base.sql`, `etl/tests/banco_isolado.py`, `etl/tests/caracterizacao.py`, `etl/tests/admin_fixtures.py`
- `etl/tests/test_{retrato_agenda,retrato_plano,orquestradores,catalogo,contrato_cadeia,codigos_saida,caracterizacao}.py`
- `etl/tests/test_admin_{migracao,previa,rodada,tentativas,propostas,decisoes,chaves,sobrevive,leitor,fila,parecer,pedidos,relatorio}.py`
- `web/src/app/(admin)/layout.tsx` e as rotas de 4.2; `web/src/components/admin/*`; `web/src/styles/admin.css`; `web/src/lib/admin/{guarda,db,consultas,agregacao,tipos}.ts`
- `web/src/lib/__tests__/admin-agregacao.test.ts`, `web/src/lib/__tests__/admin-guarda.test.ts`
- `web/e2e-admin/*.spec.ts`, `web/e2e-admin/sem-navegador.mjs`, `web/e2e-admin/sem-rede-externa.mjs`, `web/playwright.admin.config.ts`
- `replica/admin-coleta.md`, `replica/admin-coleta-decisoes.md`, `replica/prompts/evidencias/`

Tocar (existentes): `etl/civico_etl/cli.py` (um desvio), `etl/civico_etl/http.py` (três variáveis de 4.1), `replica/fluxo-de-dados.md`, `replica/decisions.md`, `replica/bugs.md`, `.gitignore` (`web/.next-admin/`). `replica/tools/fluxo_confere.py` só se R-10 exigir.

Os testes novos criam a própria base (as cinco Assembleias, um município com Câmara): o `ci.yml` não pode ser editado para carregar fixture. Os que fazem commit usam o banco isolado de 0.5; os demais rodam na transação revertida da fixture `conn`. Nenhum grava município no banco da suíte.

`fluxo_confere.py` exige que toda tabela viva e todo `route.ts` estejam citados em `replica/fluxo-de-dados.md`. Por isso a tarefa que cria tabela (A1, C1) e a que cria rota (C4) editam esse documento no mesmo commit, e R-10 é rodado ao fim de cada uma.

| Critério | Teste ou prova |
| --- | --- |
| R-1 a R-10 | tabela de 0.5 |
| 1 | `test_admin_migracao.py`: cria banco `admin_coleta_zero`, aplica `db/migrate.sh --local` duas vezes, apaga o banco que criou |
| 2 | `[suite]` e leitura da lista `-rs` |
| 3 | `test_admin_previa.py`: cliente HTTP que falha se chamado; contagem de URLs de entrada igual à da rodada; estimativas marcadas |
| 4 | `test_admin_rodada.py::test_repetir` |
| 5 | `test_admin_rodada.py::test_interrompida` |
| 6 | `test_admin_tentativas.py` (403, robots, timeout, corpo vazio) |
| 7 | `test_admin_propostas.py::test_divergencia` |
| 8 | `test_admin_propostas.py::test_reabre` |
| 9 | `test_admin_chaves.py`: as quatro combinações das duas chaves, pela função e direto no banco |
| 10 | `test_admin_propostas.py::test_recusa` (validador e `check` do banco) |
| 11 | `test_admin_sobrevive.py`, um caso por classe |
| 12 | `test_admin_leitor.py`: SQL de `getAssembly` copiado, com arquivo e linha |
| 13 | `test_admin_fila.py`: a consulta de ordenação não referencia coluna de pessoa nem de partido, e a ordem não muda quando esses atributos mudam |
| 14 | `[amb] uv run --frozen civico-etl check` |
| 15 | `sem-navegador.mjs` (status por rota, sem variável e com `VERCEL`/`VERCEL_ENV`), `admin-guarda.test.ts`, spec Playwright |
| 16, 17, 18 | `admin-agregacao.test.ts` |
| 19 | `sem-navegador.mjs` compara os números dos dois painéis no HTML renderizado, e os de `/admin/api/estado`, com `civico-etl admin relatorio --json` |
| 20 | `test_admin_pedidos.py` (índice) e `sem-navegador.mjs` (dois POST) |
| 21 | spec Playwright; não executado aqui |
| 22 | `test_admin_parecer.py` (retrato das tabelas de domínio antes e depois) e `sem-navegador.mjs` |
| 23 | `node web/e2e-admin/sem-rede-externa.mjs` (estática), varredura do HTML servido em `sem-navegador.mjs`, e spec Playwright (não executado aqui) |
| 24 | `sem-navegador.mjs` (HTML sem `<circle`, cada território com nome e contagem em texto) e spec Playwright |
| 25 | `next build` nas condições do CI; `git diff` vazio em `web/e2e` e `web/playwright.config.ts`; execução do conjunto público: não atendida aqui (4c) |
| 26 | spec Playwright de capturas; não executado aqui |

## 7. Tarefas delegáveis

Regras: o orquestrador desenha, escreve o briefing, confere e commita. Construção em paralelo só com arquivos disjuntos. A suíte roda em série.

Abreviações nos comandos de pronto: `PT <arquivos>` = `cd etl && [amb] uv run --frozen pytest -q <arquivos>`; `[suite]` como definido no topo; `[web]` = `cd web && npx eslint src && npx tsc --noEmit && npm run test:unit`; `[build]` = `cd web && DATA_SOURCE=demo ALLOW_DEMO_DATA=1 NEXT_TELEMETRY_DISABLED=1 npx next build`; `[fluxo]` = `python3 -I replica/tools/fluxo_confere.py` com os mesmos 7 problemas da linha de base.

### Fase R (teto: 16 subagentes)

| Tarefa | Modelo | Arquivos | Comando de pronto | Depende |
| --- | --- | --- | --- | --- |
| R1 retratos da agenda (R-3) | Haiku | `etl/tests/test_retrato_agenda.py`, `etl/tests/retratos/agenda.json` | `PT tests/test_retrato_agenda.py` | nada |
| R2 retrato do plano e códigos de saída (R-6, R-8) | Sonnet | `etl/tests/test_retrato_plano.py`, `etl/tests/retratos/plano.json`, `etl/tests/test_codigos_saida.py` | `PT tests/test_retrato_plano.py tests/test_codigos_saida.py` | nada |
| R3 orquestradores (R-4) | Sonnet | `etl/tests/test_orquestradores.py` | `PT tests/test_orquestradores.py` | nada |
| R4 banco isolado, infraestrutura de caracterização e `camara.equipe` (R-2) | Sonnet | `etl/tests/banco_isolado.py`, `etl/tests/caracterizacao.py`, `etl/tests/test_caracterizacao.py`, `etl/tests/retratos/camara_equipe.json` | `PT tests/test_caracterizacao.py` e `[suite]` | nada |
| R5 caracterização dos simples: `receita.arrecadacao`, `ibge.places`, `ibge.populacao`, `governos.indicadores` | Haiku | `etl/tests/test_caracterizacao.py`, `etl/tests/retratos/{receita_arrecadacao,ibge_places,ibge_populacao,governos_indicadores}.json` | `PT tests/test_caracterizacao.py` e `[suite]` | R4 |
| R6 caracterização de `parlamento.extras` e `ale.cobertura` | Sonnet | `etl/tests/test_caracterizacao.py`, `etl/tests/retratos/{parlamento_extras,ale_cobertura}.json` | `PT tests/test_caracterizacao.py` e `[suite]` | R5 |
| R7 catálogo: modelo, contrato, os três exemplos e o teste de forma | Sonnet | `etl/civico_etl/catalogo/{__init__,modelo,comandos,coletores,contrato}.py`, `etl/tests/test_catalogo_forma.py` | `PT tests/test_catalogo_forma.py` | R1 a R6 commitados |
| R8 entradas irregulares do catálogo (TSE, sanções, transparência, ALE, SAPL das Assembleias, Senado) | Sonnet | `etl/civico_etl/catalogo/{coletores,comandos}.py` | `PT tests/test_catalogo_forma.py` | R7 |
| R9 entradas simples restantes | Haiku | `etl/civico_etl/catalogo/{coletores,comandos}.py` | `PT tests/test_catalogo_forma.py` | R8 |
| R10 testes do catálogo e da cadeia (R-5, R-7) | Sonnet | `etl/tests/test_catalogo.py`, `etl/tests/test_contrato_cadeia.py` | `PT tests/test_catalogo.py tests/test_contrato_cadeia.py` e `[suite]` | R9 |
| R11 documentação e R-10 | Haiku | `replica/admin-coleta.md`, `replica/fluxo-de-dados.md`, `replica/bugs.md` | `[fluxo]` | R10 |
| Verificador da Parte R | Sonnet | só leitura; grava `verificacao/parte-r.md` na pasta de notas | o arquivo existe e traz veredito por critério R-7 e R-9 | R11 |

Dependência dura: R1 a R6 saem do código de `39ee3ec` e são commitados antes de R7.

### Fase A (teto: 14)

| Tarefa | Modelo | Arquivos | Comando de pronto | Depende |
| --- | --- | --- | --- | --- |
| A1 migração 0150, medição do gatilho e citação das tabelas no fluxo | Sonnet | `db/migrations/0150_admin_coleta.sql`, `etl/tests/test_admin_migracao.py`, `replica/fluxo-de-dados.md` | `PT tests/test_admin_migracao.py`, `[suite]`, `[fluxo]` | fase R |
| A2 variáveis de `http.py` e importação de tentativas | Sonnet | `etl/civico_etl/http.py`, `etl/civico_etl/admin/{__init__,tentativas}.py`, `etl/tests/test_admin_tentativas.py` | `PT tests/test_admin_tentativas.py tests/test_http_fetch.py` e `[suite]` | A1 |
| A3 CLI `admin`, inventário e vínculos | Sonnet | `etl/civico_etl/cli.py`, `etl/civico_etl/admin/{cli,inventario,vinculos}.py`, `etl/tests/test_admin_inventario.py` | `PT tests/test_admin_inventario.py tests/test_orquestradores.py tests/test_catalogo.py` e `cd etl && [amb] uv run --frozen civico-etl admin inventario --json` com código 0 | A2 |
| A4 fixture SAPL das Assembleias e de uma Câmara | Sonnet | `etl/tests/fixtures/sapl_ale/*`, `etl/tests/fixtures/admin_base.sql`, `etl/tests/admin_fixtures.py`, `etl/tests/test_admin_fixture_sapl.py` | `PT tests/test_admin_fixture_sapl.py` | A2 |
| A5 prévia, rodada, repetição, reprocessamento | Sonnet | `etl/civico_etl/admin/{rodadas,cli}.py`, `etl/tests/test_admin_previa.py`, `etl/tests/test_admin_rodada.py` | `PT tests/test_admin_previa.py tests/test_admin_rodada.py` e `[suite]` | A3, A4 |
| A6 relatório | Sonnet | `etl/civico_etl/admin/{relatorio,cli}.py`, `etl/tests/test_admin_relatorio.py` | `PT tests/test_admin_relatorio.py` e `[suite]` | A5 |

A3 e A4 tocam arquivos disjuntos e podem rodar em paralelo; A4 recebe um banco próprio (`admin_coleta_2`).

### Fase B (teto: 16)

| Tarefa | Modelo | Arquivos | Comando de pronto | Depende |
| --- | --- | --- | --- | --- |
| B1 propostas, pendências, reabertura, fila | Sonnet | `etl/civico_etl/admin/{propostas,pendencias,classes,cli}.py`, `etl/tests/test_admin_propostas.py`, `etl/tests/test_admin_fila.py` | `PT tests/test_admin_propostas.py tests/test_admin_fila.py` e `[suite]` | fase A |
| B2 decisões, aplicação, overrides, `corrections` | Sonnet | `etl/civico_etl/admin/{decisoes,aplicar,cli}.py`, `etl/tests/test_admin_decisoes.py`, `etl/tests/test_admin_sobrevive.py`, `etl/tests/test_admin_leitor.py` | `PT tests/test_admin_decisoes.py tests/test_admin_sobrevive.py tests/test_admin_leitor.py` e `[suite]` | B1 |
| B3 proponentes por classe e executor da fila de identidade | Sonnet | `etl/civico_etl/admin/{classes,aplicar,rodadas}.py`, `etl/tests/test_admin_classes.py` | `PT tests/test_admin_classes.py` e `[suite]` | B2 |
| B4 duas chaves e parecer em ensaio | Sonnet | `etl/civico_etl/admin/{parecer,cli}.py`, `etl/tests/test_admin_chaves.py`, `etl/tests/test_admin_parecer.py` | `PT tests/test_admin_chaves.py tests/test_admin_parecer.py` e `[suite]` | B3 |
| B5 primeira rodada, passos 1 a 5, e relatório | Sonnet | `replica/admin-coleta-primeira-rodada.md`, `replica/prompts/evidencias/primeira-rodada-*.txt` | `cd etl && [amb] uv run --frozen civico-etl admin relatorio <id> --json` com código 0, `cd etl && [amb] uv run --frozen civico-etl check` com código 0, e `[suite]` | B4 |
| Verificador de 4, 5 e 11 | Sonnet | só leitura; grava `verificacao/parte-b-sonnet.md` | o arquivo existe com veredito por critério | B5 |
| Verificador de 9 | Opus | só leitura; grava `verificacao/parte-b-opus.md` | idem | B5 |

### Fase C (teto: 20)

| Tarefa | Modelo | Arquivos | Comando de pronto | Depende |
| --- | --- | --- | --- | --- |
| C1 migração 0151, login local e citação no fluxo | Sonnet | `db/migrations/0151_admin_central.sql`, `db/local/post_0003_admin_central.sql`, `etl/tests/test_admin_grants.py`, `replica/fluxo-de-dados.md` | `PT tests/test_admin_grants.py tests/test_admin_migracao.py`, `[suite]`, `[fluxo]` | fase B |
| C2 executor de pedidos | Sonnet | `etl/civico_etl/admin/{executor,cli}.py`, `etl/tests/test_admin_pedidos.py` | `PT tests/test_admin_pedidos.py` e `[suite]` | C1 |
| C3 dados e agregação pura | Sonnet | `web/src/lib/admin/*`, `web/src/lib/__tests__/admin-agregacao.test.ts`, `web/src/lib/__tests__/admin-guarda.test.ts` | `[web]` | C1 |
| C4 layout, guarda, rotas de API e citação das rotas no fluxo | Sonnet | `web/src/app/(admin)/layout.tsx`, `web/src/app/(admin)/admin/api/**`, `replica/fluxo-de-dados.md` | `[web]`, `[build]`, `[fluxo]` | C3 |
| C5 mapa e estilos | Sonnet | `web/src/components/admin/mapa*.tsx`, `web/src/styles/admin.css` | `[web]` | C3 |
| C6 páginas: painéis, fila, registros, ficha, rodadas, estados de tela | Sonnet | `web/src/app/(admin)/admin/**` (fora `api`), `web/src/components/admin/*` (fora `mapa*`) | `[web]` e `[build]` | C4, C5 |
| C7 provas sem navegador | Sonnet | `web/e2e-admin/sem-navegador.mjs`, `web/e2e-admin/sem-rede-externa.mjs` | `node web/e2e-admin/sem-navegador.mjs` e `node web/e2e-admin/sem-rede-externa.mjs`, ambos com código 0 | C2, C6 |
| C8 specs e configuração do Playwright | Sonnet | `web/e2e-admin/*.spec.ts`, `web/playwright.admin.config.ts`, `.gitignore` | `cd web && npx tsc --noEmit` e `cd web && npx playwright test -c playwright.admin.config.ts --list` com código 0 | C6 |
| C9 primeira rodada, passos 6 a 9, pela API da central | Sonnet | `replica/admin-coleta-primeira-rodada.md`, `replica/prompts/evidencias/primeira-rodada-central-*.txt` | `node web/e2e-admin/sem-navegador.mjs --fluxo` com código 0 e `cd etl && [amb] uv run --frozen civico-etl admin pendencia <id> --json` mostrando a mesma decisão gravada pela API | C7 |
| C10 documentação final | Haiku | `replica/admin-coleta.md`, `replica/fluxo-de-dados.md` | `[fluxo]` | C9 |
| Verificador da Parte C | Opus | só leitura; grava `verificacao/parte-c.md` | o arquivo existe com veredito para 15, 22, 23 e grants | C10 |

C4 e C5 tocam arquivos disjuntos e podem rodar em paralelo. C2 (Python) pode rodar em paralelo a C3.

Teto por fase (construção, retentativas e verificação somadas): R 16, A 14, B 16, C 20. Estouro acima de 50% é parada (item 4).

## 8. Premissas

| # | Premissa | Se estiver errada |
| --- | --- | --- |
| P1 | A sessão roda em Fable 5.2, não em Opus; mantenho o papel de orquestrador | nada muda no plano |
| P2 | Rede: o sandbox nega saída por padrão. A primeira rodada usa respostas do SAPL fabricadas e sai marcada SIMULADO, item por item. Não peço exceção por host: a carga real das cinco Assembleias leva até 2 h e grava volume alto | o dono roda os mesmos comandos com rede; o relatório traz o comando |
| P3 | Playwright não roda nesta sessão (4c): 21 e 26 "não executado"; 15, 19, 20, 22, 23, 24 por prova sem navegador | se o dono instalar o navegador e rodar fora do sandbox, os specs entregues cobrem 21 e 26 |
| P4 | Gatilho em tabela existente é mudança aditiva (não altera coluna nem dado; sem linha em `adm_overrides` nada muda) | se o dono considerar não aditiva, a alternativa é a opção (a) do item 2, que edita três coletores |
| P5 | Uma fonte nova `curadoria` em `sources`, inserida pela migração, não fere a restrição 5a (nenhum slug existente muda) | sem ela, a correção de contato não sobrevive ao delete de `parlamento_extras` |
| P6 | Par de chaves próprio (`ADMIN_COLETA_AGENTES`, `admin_coleta_agentes`), no mesmo desenho da D293, em vez de reusar o par da verificação de respostas | reusar é trocar duas constantes |
| P7 | O banco `admin_coleta` e o servidor foram criados pelo dono: não apago, não recrio, não paro. Banco "do zero" do critério 1 é outro, criado e apagado pelo teste | sem permissão de `createdb`, o critério 1 vira "não executado" |
| P8 | `corrections` sem leitor nem escritor hoje: grava-se conforme o item 3, só no banco local | se a tabela tiver uso planejado diferente, a escrita é um ponto único em `admin/aplicar.py` |
| P9 | Mudar `http.py` com três variáveis desligadas por padrão é adaptar por fora (infraestrutura, com teste), não mexer em coletor | a alternativa é um `runner` que embrulha `fetch` em processo, sem subprocesso, perdendo o isolamento de `http.RATE` |
| P10 | Parecer de IA sem chave no ambiente: motor de ensaio local, marcado `simulado` | com chave e `--real`, até 20 chamadas |
