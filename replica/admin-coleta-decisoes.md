# Admin de coleta · registro de decisões

Decisões tomadas sem consulta ao dono, uma entrada por decisão. Formato: o que estava em jogo, opções, escolha, motivo, o que a materializa, como desfazer.

## AC-01 · Postgres e sandbox: servidor do dono, banco dedicado, sem contorno

- Data e fase: 2026-11-15, preparo.
- Em jogo: o sandbox da sessão nega `shmget`, então o Postgres não sobe por comando meu; e negava conexão e bind local.
- Opções: (a) parar e pedir ao dono; (b) usar o terminal do dono ou outro caminho fora do sandbox; (c) trocar o banco por um embutido.
- Escolha: (a). O dono subiu o servidor a partir deste worktree, criou `admin_coleta` e aplicou `sandbox.network.allowLocalBinding` com o script `liberar-sandbox-local.sh`.
- Motivo: (b) é contornar a restrição; (c) invalidaria a suíte como prova.
- Consequências: nunca rodo `db/pg-local.sh start|stop`; servidor caído é parada (item 5). Não apago nem recrio `admin_coleta`. O script fica no worktree, sem rastreio, e não entra em commit.
- Materializa: `replica/admin-coleta-estado.md` (commit `8dbe595`).
- Desfazer: `liberar-sandbox-local.sh --desfazer` (passo do dono) restaura a configuração do sandbox.

## AC-02 · Parte R: catálogo e contrato, sem mover arquivo

- Data e fase: 2026-11-15, plano (item 0).
- Em jogo: como separar coletor, biblioteca, despachante e as outras classes em `etl/civico_etl/jobs/`.
- Opções: (a) só catálogo e adaptadores, classificação declarada; (b) mover por classe com alias em `sys.modules`; (c) mover sem alias.
- Escolha: (a). `schedule.py`, `cli.py` e os parsers próprios não são editados na Parte R; o catálogo é conferido contra eles por teste, não derivado.
- Motivo: 57 `monkeypatch.setattr` atingem o objeto do módulo do job; `ibge_malhas.py` resolve a saída por `Path(__file__).parents[3]`; dois testes leem arquivos de job por caminho; `sapl.py` e `assembleias.py` alteram `http.RATE` no import; `fluxo_confere.py` lista `jobs/*.py` sem recursão; o Mac pode rodar versão antiga (D274). Mover custa mais do que rende, e a restrição 5a não admite risco.
- Materializa: seção 0 de `replica/admin-coleta-plano.md` (commit `08ba9ad`); o código virá na fase R.
- Desfazer: `git revert` dos commits da fase R remove o pacote `catalogo/` e os testes; nada mais depende dele até a fase A.

## AC-03 · Decisão aprovada sobrevive por gatilho no banco

- Data e fase: 2026-11-15, plano (item 2).
- Em jogo: `sapl_houses` e `data_coverage` são regravadas a cada carga, e `parlamento_extras` apaga os contatos antes de inserir. A correção manual some.
- Opções: (a) override lido pelo job antes do upsert; (b) gravar na tabela e travar a chave no job; (c) corrigir só o vínculo de fonte; (d) override imposto por gatilho `before insert or update`, lendo `adm_overrides`.
- Escolha: (d), com (c) quando o erro é o vínculo. Para contato: linha com fonte própria `curadoria`, que o delete do job não alcança, e supressão do valor descartado por gatilho `before insert`.
- Motivo: (a) e (b) editam três coletores por dentro e não valem para o Mac em versão antiga. (d) não toca coletor e, sem linha em `adm_overrides`, grava o mesmo que hoje.
- Risco assumido: é o ponto mais discutível contra a restrição 4 ("só aditiva"). O gatilho não altera coluna nem dado existente, mas passa a reescrever valor de job em tabela existente quando há override. O custo por linha é medido na tarefa A1.
- Materializa: seção 2 do plano; migração `db/migrations/0150_admin_coleta.sql` (commit da tarefa A1); D326 em `replica/decisions.md`.
- Custo medido na A1 (33 mil linhas de `data_coverage`, `on conflict do nothing`, melhor de 3): sem override, 49 ms sem gatilho e 115 ms com gatilho quando as linhas já existem (o caso de `derive.stats`), e 288 ms contra 337 ms com linhas novas; com um override vigente de cobertura, 268 ms e 533 ms.
- Limite achado na A1: o gatilho roda com o privilégio de quem grava e lê `adm_overrides`. Hoje só o dono do banco grava nessas três tabelas. Um role sem leitura em `adm_overrides` que passe a gravar nelas faria o gatilho falhar.
- Desfazer: `drop trigger` nas três tabelas e `git revert` da migração. Migração já aplicada no banco local não volta só com o revert.

## AC-04 · Critério R-5 substituído na parte das fontes

- Data e fase: 2026-11-15, plano.
- Em jogo: R-5 exige que "toda fonte citada existe em `sources` depois do seed". Três fontes (`sapl-ale`, `alesp`, `alemg`) são criadas pelo próprio job (`sapl.py:650`, `assembleias.py:320`), não pelo seed nem por migração.
- Opções: (a) semear essas fontes (muda `seed.py` e o que o job grava: fora da reorganização); (b) conferir as de origem `seed` e `migracao` no banco e as de origem `job` no código.
- Escolha: (b).
- Motivo: o critério como escrito é impossível sem mudar comportamento.
- Consequência: R-5 sai como "substituído" no relato, com o original "não atendido" nessa parte.
- Materializa: seção 0.5 do plano; `etl/tests/test_catalogo.py` (fase R).
- Desfazer: não se aplica (é critério de teste).

## AC-05 · Playwright não roda nesta sessão: critérios 21 e 26 não executados, 25 não atendido na execução

- Data e fase: 2026-11-15, plano (4c).
- Em jogo: não há navegador do Playwright instalado, e o Chrome do sistema não lança dentro do sandbox (`Failed to create a ProcessSingleton`).
- Opções: (a) baixar navegador e tentar; (b) seguir a conduta do prompt: entregar os testes escritos, o comando para o dono, e provar os critérios de segurança sem navegador.
- Escolha: (b).
- Motivo: o prompt manda não contornar. Baixar executável e tentar outro navegador é contornar.
- Consequências: 21 e 26 "não executado". O 25 depende do conjunto ponta a ponta público, que também não roda: sai como "não atendido" na parte de execução, com o critério substituto (`git diff` vazio em `web/e2e` e `web/playwright.config.ts`, mais `next build` do CI passando). 15, 19, 20, 22, 23 e 24 têm prova por `next start` e requisição HTTP, sem navegador.
- Materializa: seção 4c do plano.
- Desfazer: não se aplica. O dono roda `cd web && npx playwright install chromium chromium-headless-shell && npx playwright test && npx playwright test -c playwright.admin.config.ts` fora do sandbox.

## AC-06 · Plano segue depois de duas reprovações, com os achados corrigidos

- Data e fase: 2026-11-15, plano.
- Em jogo: o primeiro verificador reprovou o plano (4 bloqueantes, 14 não bloqueantes). Corrigi e reverifiquei com outro agente, que reprovou de novo: comando de pronto não executável nas linhas dos verificadores e na tarefa C9, e três furos no modo sem rede (`robots.txt` com 404 não entra no cache; exceção fora de `Exception` deixava o run `running`; a entrada fabricada não chegava ao subprocesso). Nenhum achado apontou violação de restrição crítica.
- Opções: (a) terceira verificação; (b) corrigir os achados e seguir, como o prompt determina ("corrija e reverifique uma vez").
- Escolha: (b). Todos os achados bloqueantes e não bloqueantes das duas rodadas foram corrigidos no plano; nenhuma objeção foi mantida.
- Objeção registrada sem mudança de desenho, citada do segundo verificador: "Os gatilhos em tabelas existentes não são 'tabelas e colunas novas': o plano os declara aditivos (P4/AC-03) e deixa a alternativa (a). Fica como risco de interpretação." Mantida como risco em AC-03; o verificador não a classificou como violação.
- Limite: a versão final do plano não foi lida por verificador independente. O verificador da Parte R é o primeiro a conferir o que ela mudou.
- Materializa: `replica/admin-coleta-plano.md`; relatórios em `verificacao/plano-v1.md` e `verificacao/plano-v2.md`, na pasta de notas da sessão.
- Desfazer: não se aplica.

## AC-07 · Critério 14 medido contra a linha de base do `check`

- Data e fase: 2026-11-15, fase R.
- Em jogo: o critério 14 diz "`civico-etl check` continua passando no banco local". No banco preparado como o prompt manda (migração, seed, `base.sql`), o `check` já sai com código 1 antes de qualquer mudança: 5 invariantes dependem de carga real (513 deputados, 81 senadores, amostra da cota, governadores).
- Opções: (a) carregar dado real para o `check` passar (rede e horas de carga, fora do recorte); (b) medir "nenhuma invariante quebrada além das 5 da linha de base".
- Escolha: (b).
- Motivo: o critério como escrito é impossível neste banco; a intenção é não quebrar invariante nova.
- Consequência: no relato, o critério 14 original sai como "não atendido" e o substituto ao lado, com a lista das 5.
- Materializa: `replica/admin-coleta-estado.md`; saída em `linha-de-base/base-check.txt`, na pasta de notas.
- Desfazer: não se aplica.

## AC-08 · Fim da fase R: achados dos verificadores e o que não foi corrigido

- Data e fase: 2026-11-15, fim da fase R.
- Verificação: Sonnet de contexto limpo sobre `git diff 39ee3ec..2743a74` (relatório `verificacao/parte-r.md`); correções no commit `3758712`; reverificação única por outro Sonnet, só leitura (`verificacao/parte-r-v2.md`).
- Veredito dos dois: a reorganização não mudou comportamento. Nenhum arquivo de `etl/civico_etl/` fora de `catalogo/` foi tocado, nenhum teste que já existia foi alterado, e nenhum módulo de produção importa `catalogo`.
- Corrigido: referências erradas do BUG-056; teste de entrada inalterada com `db.run` real (para `ibge.populacao`); linha de `PAGE` e a explicação de `--ibge` em `sapl.ales`; `assert` trocado por `RuntimeError`; mensagem de `SystemExit` no runner em processo; decisão renumerada de D324 para D325, porque o `main` já tem uma D324.
- Não corrigido, por decisão:
  - R-7 fica "parcial" se lido ao pé da letra. A frase "entrada inalterada interrompe a cadeia" é falsa no código (BUG-056); o teste fixa o comportamento real. Para `camara.diario` e `senado.diario` a prova de entrada inalterada usa gravadores; com `db.run` real, só `ibge.populacao`. Fabricar a entrada inteira desses dois comandos custa mais do que rende nesta entrega.
  - O catálogo repete URLs, tabelas e sete consultas de leitura que espelham a seleção dos jobs, e nenhum teste pega URL ou tabela declarada errada. Declarado na D325.
  - 15 dos 24 coletores seguem sem teste que chame a função de entrada. O catálogo marca cada um (`caracterizado`), e nenhum deles foi tocado por dentro.
  - `banco_isolado` supõe um processo de teste por servidor Postgres (usa o PID no nome do banco).
- SQL novo da fase R, para o critério R-9 (só leitura, dentro de `descrever` e só quando recebe conexão): `catalogo/contrato.py` (deputados com mandato aberto; municípios por código; casas do SAPL por código), `catalogo/adaptadores_a.py` (casas do SAPL das Assembleias), `catalogo/adaptadores_b.py` (duas consultas de parlamentares em exercício), `catalogo/adaptadores_c.py` (UFs). Nenhum SQL de domínio, parser ou regra de identidade foi alterado.
- Contagem da fase R: 16 subagentes de um teto de 16 (11 de construção, 1 de correção, 2 verificadores, e R1 a R3 retomadas depois de um limite de uso, sem novo lançamento). Haiku: R1, R5, R9, R11. Sonnet: as demais. Nenhuma tarefa reprovada; nenhuma subiu de modelo. A R9 (Haiku) devolveu duas perguntas antes de escrever. O orquestrador fez a integração dos três lotes e quatro ajustes de comentário.
- Desfazer: `git revert` dos commits `2d4591b` a `3758712`.

## AC-09 · Incidente: duas rodadas de teste de um subagente caíram no banco `civico`

- Data e fase: 2026-11-15, fase A, tarefa A2.
- O que houve: o subagente da A2 montou o prefixo de banco numa variável de shell (`env $E ...`). No zsh a variável não é separada em palavras, então `ETL_DATABASE_URL` não chegou ao processo e `etl/tests/conftest.py` caiu no padrão `.../civico`. Duas rodadas de pytest (dois arquivos e a suíte inteira) rodaram contra `civico`. O próprio subagente percebeu pela saída (`database=civico`, `UndefinedTable`) e relatou.
- Regra violada: restrição 3a ("NUNCA rode a suíte contra um banco que você não criou"; "Nunca o banco `civico`").
- Dano conferido por mim, só com leitura do catálogo do Postgres: o `civico` deste cluster é o banco vazio que `db/pg-local.sh start` cria no worktree. Tem 0 tabelas no schema `public` e 8,0 MB, o mesmo tamanho do banco `postgres` vazio. Não havia dado para apagar, e nada ficou gravado. A fixture de banco isolado criou e apagou um `civico_iso_<pid>`; não sobrou banco.
- Por que não parei: a lista de parada, item 2, trata de ação a fazer; esta já tinha acontecido, o banco atingido estava vazio e não há o que desfazer. Fica relatado aqui e no relato final. Se este cluster não fosse novo, o `civico` seria a cópia de trabalho do dono e o caso seria de parada.
- Correção de conduta: daqui em diante todo briefing diz, por extenso, que o prefixo de banco é escrito literalmente em cada linha de comando, sem variável de shell intermediária, e que a primeira linha da saída do pytest (`database=`) tem de ser conferida antes de seguir.
- Desfazer: não se aplica.

## AC-10 · Reprocessar nas Assembleias do SAPL refaz a sondagem, não a carga

- Data e fase: 2026-11-15, fase A, tarefa A5.
- Em jogo: o passo 5 da primeira rodada pede "reprocessamento sem rede do bruto salvo" no recorte das Assembleias. A tarefa A4 fixou por teste como `sapl.ales` se comporta: `robots.txt` e `/api/` ficam em cache por um dia; casa `ok` carregada há menos de 6 dias fica fora da fila de recarga; `--full` não força recarga; `--ibge` refaz a fila com todas as casas `ok`, por efeito colateral do parser; as consultas incrementais levam a data do dia na URL.
- Opções: (a) declarar `reprocessar` não suportado, como o catálogo dizia; (b) forçar a recarga com `--ibge`, explorando o efeito colateral; (c) suportar com o limite escrito: sem rede, refaz a sondagem (status e cobertura) a partir do cache, e a carga só é refeita para casa fora do prazo de recarga.
- Escolha: (c). O catálogo passa a declarar o modo com esse limite no motivo.
- Motivo: (a) deixaria o passo 5 sem execução; (b) apoia o módulo num comportamento que ninguém desenhou e que `sapl.descobrir` nem documenta. (c) diz a verdade sobre o que o material salvo permite reproduzir.
- Consequência: no relato, o passo 5 da primeira rodada é marcado com esse limite. Reprocessar a carga de matérias de uma casa exigiria um argumento novo no job, que a Parte R proíbe.
- Materializa: `etl/civico_etl/catalogo/coletores_a.py` e `adaptadores_a.py` (tarefa A5).
- Desfazer: `git revert` do commit da A5 devolve o modo a "não suportado".

## AC-11 · Fim da fase A: segundo incidente de escrita, definição de "registro alcançado" e contagem

- Data e fase: 2026-11-16, fim da fase A.
- Segundo incidente (tarefa A6): um teste exploratório do subagente importou fixtures com `from ... import *`, que não traz nomes iniciados por `_`, e o coletor rodou duas vezes direto no banco da suíte (`admin_coleta`), sem rede. Gravou 2 linhas em `ingest_runs`, 1 em `dataset_stamps` e a fonte `sapl-ale`. O subagente apagou essas linhas por id e relatou. Conferi depois: `ingest_runs`, `dataset_stamps`, `adm_rodadas`, `sapl_houses` e `data_coverage` com 0 linhas, `sources` com 18 (as 17 do seed e migrações mais `curadoria`), suíte passando e `check` com as mesmas 5 invariantes da linha de base. O banco atingido é o dedicado a este trabalho; não é o `civico`. Fica registrado porque a regra era não gravar linha de teste nele.
- Definição corrigida no relatório: "registro alcançado" não pode exigir URL idêntica entre vínculo e tentativa, porque o vínculo é o endereço-base da casa e as tentativas são páginas dentro dele. Vale: a rodada leu (ou reaproveitou) alguma URL igual ao vínculo vigente do registro ou dentro dele, sem contar `robots.txt`. O erro era do briefing.
- Marca SIMULADO: o lançador `etl/tests/simulado.py` define `ADMIN_SIMULADO`; a rodada grava o cenário no próprio resultado; o relatório lê da rodada, não do ambiente de quem consulta.
- Fase A sem verificador próprio: o prompt prevê verificação independente ao fim das Partes R, B e C. Os critérios 4 e 5 da fase A são alvo do verificador da Parte B.
- Contagem da fase A: 6 subagentes de um teto de 14 (A1 a A6, todos Sonnet). A6 foi retomada uma vez para corrigir a definição acima e a marca SIMULADO; conto como uma reprovação por defeito do briefing. Nenhuma subiu de modelo. O orquestrador fez três ajustes pequenos: URL da fonte `curadoria` na migração antes de aplicá-la, um teste da A3 que fixava o conjunto exato de subcomandos, e `etl/admin-rodadas/` no `.gitignore`.
- Critérios com teste passando ao fim da fase A: 1, 3, 4 (vínculos, tabelas de domínio e tentativas; propostas entram na fase B), 5, 6. Critério 2: suíte com 1.119 passando, os mesmos 33 pulos e 4 xfail da linha de base, nenhum teste novo pulado.
- Desfazer: `git revert` dos commits `068e2c6` a este; a migração `0150` já aplicada no banco local não volta só com o revert.

## AC-12 · Como a rodada propõe mudança, e o gatilho passa a anotar o que o job tentou gravar

- Data e fase: 2026-11-16, fase B, tarefas B2 e B3a.
- Em jogo: o job do SAPL grava direto em `sapl_houses` e `data_coverage`. O módulo não pode impedir nem editar o job. De onde sai a proposta de mudança, e como uma pendência decidida reabre quando a fonte volta a divergir do valor decidido.
- Opções para a origem da proposta: (a) reinterpretar a resposta da fonte dentro do módulo, repetindo a regra do job; (b) comparar o registro antes e depois da execução do coletor.
- Escolha: (b). Campo sem override: a proposta registra a mudança que o job já fez (valor de antes, valor de depois, evidência da rodada), e a pendência pergunta se procede. Registro que não existia antes é primeiro preenchimento, não proposta.
- Opções para o campo com override: (a) aceitar que o valor tentado pelo job se perde; (b) migração nova `0151` em que o gatilho anota no override o último valor que o job tentou gravar quando ele difere do decidido.
- Escolha: (b). Sem isso, um valor decidido nunca mais seria confrontado com a fonte.
- Motivo: (a) da primeira escolha duplicaria regra de coletor, o que a restrição 5 proíbe; (b) usa só o que o job efetivamente gravou.
- Consequência: a migração `0151` é a segunda deste trabalho; a do role da central passa a ser `0152`. A `0151` troca duas funções criadas na `0150` por `create or replace`, sem editar o arquivo da `0150`.
- Decisões menores da B2, mantidas:
  - `aprovar` com fontes divergentes é recusado: a pessoa usa `corrigir` com o valor escolhido. O sistema não escolhe.
  - `corrections` (tabela pública, hoje sem leitor no site) recebe linha só quando a decisão aplicada troca um valor que já existia, o campo tem leitor no site e há proposta com URL de fonte para o valor decidido. O campo `reason` recebe a justificativa escrita por quem decidiu. Ponto para o dono: esse texto vai para uma tabela pública.
  - Contato que já existe com fonte `camara` ou `senado` e é aprovado como está não troca de fonte. Se a casa parar de publicar, ele some na carga seguinte. Trocar a fonte para `curadoria` perderia a proveniência.
  - Valor de contato suprimido não volta: não há decisão que levante a supressão.
  - Correção de premissa do prompt: `sapl_houses.base_url` tem leitor no site (`getCityCouncil` e `getPeopleCoverage` em `web/src/lib/data/pg.ts`). Só `getAssembly` não a lê.
- Materializa: commits `565c687` (B2) e o da B3a; `db/migrations/0151_admin_coleta_colisoes.sql`.
- Desfazer: `git revert` desses commits. A `0151` aplicada no banco local não volta só com o revert: `alter table adm_overrides drop column tentou_valor, drop column tentou_em, drop column tentou_vezes` e reaplicar as duas funções da `0150`.

## AC-13 · Proponentes: o que a rodada propõe, o que não propõe, e a duplicata de pessoa

- Data e fase: 2026-11-16, fase B, tarefas B3a e B3b.
- Divergência anotada fora de uma rodada: o proponente considera todo override vigente cujo valor tentado pelo job difere do decidido, qualquer que seja a data da anotação, desde que a rodada tenha uma tentativa que sustente a proposta. Em produção o job agendado roda antes de alguém abrir rodada, e exigir anotação feita dentro da rodada deixaria esse caso sem proposta.
- Evidência de leitura que falhou: o hash é o do registro da tentativa (URL, resultado, motivo e status HTTP), sem o horário. Com o horário, uma falha que persiste reabriria a pendência decidida a cada rodada. O briefing original mandava incluir o horário; estava errado.
- `cobertura.reason` não é proposto sozinho: o texto é gerado pelo job e embute contagens que mudam a cada carga. Só entra junto com mudança de `status` ou `evidence_url` da mesma linha. Proposta manual pela CLI continua valendo.
- Contato do mandato: valor que apareceu vira proposta (`novo:<tipo>:<valor>`); valor que sumiu não vira proposta (o módulo não propõe ausência) e fica contado no resumo da rodada; valor suprimido por decisão que a fonte voltou a trazer não é conferido, porque o gatilho descarta a inserção sem registro e conferir exigiria repetir o parser do job.
- Comportamento a conhecer: descartar a pendência de um contato novo não remove o contato que o job já inseriu. Ele continua na tabela e público. Para tirar, a decisão é `corrigir` com remoção, que hoje só vale para o campo de contato existente.
- Identidade: cada item pendente da fila com candidato vira proposta `aceito`, com o registro bruto e o candidato como evidência (os dois entram no hash, para a pendência reabrir se o job trocar o candidato). Item sem candidato não vira proposta. O módulo nunca decide que um registro é de alguém.
- Duplicata de pessoa: NÃO há abertura automática de pendência. A única regra existente (`identity_dedupe.PAIRS_SQL`) já é unida sozinha pelo `run_dedupe`, encadeado em `camara.diario`, `senado.diario` e `all`. Detectar outros pares exigiria regra de identidade nova, que a restrição 8 proíbe. O modelo também não comporta: a chave da classe é uma linha da fila, e um par de pessoas não é. A aplicação por `merge_person` depois de decisão existe e é testada com pendência fabricada. No relato, o item "possível duplicata: registre indícios e vínculo proposto" sai como entregue em parte.
- Materializa: commits `ab55781` (B3a) e `538be3a` (B3b).
- Desfazer: `git revert` desses commits.

## AC-14 · Troca do modelo do orquestrador para Opus

- Data e fase: 2026-11-16, fase B, durante a tarefa B5.
- O que houve: o dono trocou o modelo da sessão para Opus 5.5 e pediu para usar o modelo agêntico definido no prompt (orquestrador em Opus; construção em Sonnet e Haiku; verificador de segurança em Opus de contexto limpo).
- Até o commit `50f96af` (B4) o orquestrador rodou em Fable 5.2, o que foi dito no primeiro relato. As decisões, briefings e conferências anteriores ficam como estão; nada foi refeito por causa da troca.
- Desfazer: não se aplica.

## AC-15 · Verificação da Parte B: o critério 9 falhou na letra; correções decididas

- Data e fase: 2026-11-16, fase B.
- Verificadores (só leitura, sem rodar teste, porque a B5 usava o servidor): Opus de contexto limpo para o critério 9 (`verificacao/parte-b-opus.md`) e Sonnet para 4, 5 e 11 (`verificacao/parte-b-sonnet.md`), sobre `git diff 4cc924b..50f96af`.
- Critério 9 (segurança), achado que o quebra na letra: `aplicar.aplicar`, `aplicar_pendentes`, `parecer.aplicar_por_agentes` e `chaves_dos_agentes` aceitam o parâmetro público `ambiente=`, que SUBSTITUI a variável de ambiente. Com a variável real desligada e a linha do banco ligada, `aplicar(..., ambiente={"ADMIN_COLETA_AGENTES": "on"})` aplica decisão de agentes. Nenhum subcomando passa o parâmetro, mas o critério não admite porta de serviço. Correção decidida: o parâmetro sai; os testes passam a usar o ambiente real com `monkeypatch`.
- Critério 9, riscos residuais a corrigir agora: (a) `pipeline_switches` aparece sem esquema no código e no gatilho, e uma tabela temporária de mesmo nome na sessão ligaria a segunda chave; correção: `public.pipeline_switches` e `search_path` fixo nas funções; (b) o gatilho guarda a marca `aplicada`, não o efeito: `adm_overrides` e `adm_vinculos` aceitam linha de decisão de agentes sem a chave do banco; correção: gatilho de inserção nas duas que exige a linha `on` para decisão de agentes.
- Critério 9, riscos residuais declarados, sem correção nesta entrega: (c) um agente de IA pode rodar `admin decidir --por <nome> --aplicar` como "pessoa": a CLI não autentica quem decide. A própria primeira rodada simulada usa esse caminho, com o nome "Operador de Ensaio (SIMULADO)". O que fecha isso é publicar a central com login e papel por pessoa, que está fora desta entrega; (d) o papel do ETL é dono das tabelas e pode desligar gatilho ou gravar em `pipeline_switches`. A chave do banco não é fronteira contra quem tem o papel do ETL.
- Critério 5, achado que o quebra: rodada que perde o processo depois de entrar em `em_andamento` (exceção fora de `Exception` depois do coletor, `kill -9`, queda) fica nesse estado para sempre, e `executar` e `repetir` recusam. Correção decidida: capturar `BaseException` no restante da execução e criar `admin rodada recuperar`, que só move para `interrompida` uma rodada cujo executor comprovadamente não está vivo (trava consultiva por rodada, tomada pelo executor).
- Critério 11, achado que o quebra: o override de contato é chaveado pelo id do mandato, e `merge_person` move os contatos e apaga o mandato de origem, deixando a supressão apontando para um id inexistente; o valor suprimido volta no mandato que sobrou. Correção decidida (revista, ver AC-16): NÃO se mexe em `merge_person`; um gatilho novo em `mandate_contacts` reaponta os overrides quando a fusão move os contatos de um mandato para outro. Mandato apagado pelo TSE leva o contato `curadoria` por cascata: o registro deixou de existir; declarado, sem correção.
- Testes fracos apontados e a reforçar: sobrevivência de `base_url` e de `status` de Câmara pelo job real (`sapl.descobrir`); comparação do "outro recorte intacto" no critério 5 estendida a cobertura, vínculos, propostas e tentativas. O teste de identidade chama as funções de escrita da fila do job (`PersonResolver.flush`, `AssemblyMatcher`), não o job inteiro; declarado como limite do critério 11 para essa classe.
- Ajuste menor aceito: no hash da evidência de falha, todo HTTP 5xx conta como o mesmo desfecho, para oscilação 500/502/503 não reabrir pendência decidida.
- Consequência na numeração: a migração de endurecimento passa a ser `0152`; a do role da central, `0153`.
- Materializa: a tarefa B6, depois da B5 (as duas tocam `admin/cli.py`).

## AC-16 · A correção do critério 11 não altera `merge_person`

- Data e fase: 2026-11-16, fase B, antes da tarefa B6.
- Em jogo: a AC-15 decidia refazer `merge_person` por `create or replace` numa migração nova. A sessão de origem apontou, e eu concordo, que isso troca o comportamento de uma função que o ETL inteiro usa: não é migração aditiva (restrição 4), cai no item 2 da lista de parada e mexe em regra de identidade (restrição 8). Era decisão errada minha.
- Opções: (a) refazer `merge_person` (descartada pelo motivo acima); (b) chavear o override de contato por algo que sobreviva à fusão (descartada: a chave natural do mandato sem a pessoa, cargo + lugar + início, não é única entre parlamentares da mesma UF); (c) gatilho novo `after update of mandate_id on mandate_contacts`: quando a fusão move os contatos do mandato A para o B (`merge_person` faz exatamente esse update antes de apagar A), os overrides vigentes de contato de A passam para B; havendo override vigente do mesmo campo em B, o de A fica não vigente.
- Escolha: (c). É aditiva no mesmo sentido dos gatilhos da `0150` (AC-03): nenhuma função existente muda.
- Limite declarado: se o mandato de origem não tinha nenhuma linha de contato na hora da fusão (todos os valores dele estavam suprimidos e nenhum outro contato existia), o gatilho não dispara e o override fica órfão; o valor suprimido pode voltar no mandato que sobrou. Raro: `parlamento.extras` grava todos os contatos do mandato juntos.
- Materializa: migração `0152` da tarefa B6.

## AC-17 · Primeira rodada simulada: três desvios aceitos e um rótulo a esclarecer

- Data e fase: 2026-11-16, fase B, tarefa B5.
- Critério 14 no banco da primeira rodada: aparece uma sexta invariante quebrada ("município: exatamente 1 prefeito titular"), causada pelo município fabricado que `etl/tests/fixtures/admin_base.sql` cria sem prefeito. Ela já está quebrada antes de qualquer rodada, e o conjunto de invariantes quebradas é idêntico antes e depois. Escolha: manter o município (a fase da central o usa) e medir o critério 14 como "o conjunto de invariantes quebradas não muda com a rodada" (AC-07 revisada). No relato, o critério 14 literal sai "não atendido"; o substituto, atendido, com os dois arquivos de evidência.
- Passo 5: no reprocessamento sem rede, a `/api/` de AM sai como falha por robots, decidida pelo `robots.txt` em cache, sem rede. A conferência aceita "zero lidas; as demais reaproveitadas, salvo falha por robots". Aceito.
- Edição candidata: campo com pendência aberta cujo candidato já é o valor da tabela (o job gravou antes da decisão) entra em `diferencas`, marcado `ja_e_o_vigente`, com a diferença contra o valor da leitura. Sem isso, a pendência de AM sumiria da edição candidata. Aceito.
- Rótulo "registros alterados" do relatório: aprovar uma mudança que o job já gravou (PB, `fora_do_ar` para `ok`) não troca o valor da tabela, mas grava override e conta como registro alterado. A contagem está certa pelo desenho (a decisão fixou o valor novo); o rótulo é que precisa dizer isso. A correção do texto do relatório e da edição candidata vai na B6.
- O roteiro ganhou uma trava contra execuções simultâneas, depois de duas execuções concorrentes no banco `admin_coleta_r1`. A evidência final vem de duas execuções limpas e em sequência.
- Materializa: commit da B5.
