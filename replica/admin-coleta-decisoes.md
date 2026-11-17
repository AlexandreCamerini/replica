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

## AC-18 · Reverificação do critério 9: atende

- Data e fase: 2026-11-16, fim da fase B.
- Verificador: Opus de contexto limpo, diferente do primeiro (`verificacao/parte-b-opus-v2.md`). Rodou os testes do módulo e quatro mutações em memória (todas detectadas). Veredito: o critério 9 ATENDE. A porta `ambiente=` saiu; a segunda chave é lida qualificada (`public.pipeline_switches`) no código e nos dois gatilhos que decidem sobre agentes; o portão vem antes de qualquer escrita; o tipo da decisão é fechado no banco.
- Achado aceito e corrigido por mim: `rodadas.executar(env_extra=...)` punha valores em `os.environ` durante a execução em processo, e poderia carregar a variável da primeira chave. Nenhum caminho de produção passa `env_extra`, e a segunda chave continuava exigida, então não era furo do critério. Mesmo assim `executar` passa a recusar a variável em `env_extra`, antes de usar o banco. Teste `test_N2_env_extra_nao_pode_ligar_a_chave_dos_agentes`.
- Declaração (d) da AC-15 completada: a primeira chave só existe no processo Python. Com a linha `on` em `pipeline_switches`, um `update` comum feito com o papel do ETL marca decisão de agentes como aplicada sem a variável e sem desligar gatilho. A chave do banco não é fronteira contra quem tem o papel do ETL.
- Riscos residuais anotados, sem correção nesta entrega: o efeito das classes identidade e duplicata não tem guarda própria no banco (só passa por `aplicar`, que confere as chaves); as funções `adm_override_*` da `0150`/`0151` leem `adm_overrides` sem esquema (não decidem sobre agentes); o gatilho de fusão move override que nasceu de decisão de agentes sem reconferir a chave (só transporta um efeito que nasceu com a chave ligada); `adm_pareceres` é mutável; o teste de assinatura não pegaria um parâmetro novo de nome não suspeito nem uma global inativa.
- Contagem da fase B: 10 subagentes de um teto de 16 (B1, B2, B3a, B3b, B4, B5, B6, um verificador Sonnet, dois verificadores Opus). Retomadas por decisão de desenho: B3a duas vezes, B3b uma, A6 e R9 antes. Nenhuma subiu de modelo.
- Critérios com teste passando ao fim da fase B: 4, 5, 7, 8, 9, 10, 11, 12, 13, 22. Critério 14 pelo substituto da AC-17. Suíte: 1.300 passando, os mesmos 33 pulos e 4 xfail da linha de base.

## AC-19 · A decisão pela tela é um pedido; o role da central só insere pedidos

- Data e fase: 2026-11-17, fase C, tarefa C1.
- Em jogo: a especificação dá ao role da central "escrita só nas tabelas de pedidos e de decisões". Uma linha inserida pela tela direto em `adm_decisoes` pularia a validação de `decisoes.decidir` (justificativa, candidato único, domínio do valor) e a mudança de estado da pendência, e a trilha de decisão não se apaga.
- Escolha: tabela nova `adm_pedidos_decisao` (migração `0153`), que o executor da CLI consome com `decisoes.decidir` e, se pedido, `aplicar.aplicar`, sempre como pessoa. O role `admin_central` lê as tabelas `adm_*` e doze tabelas de domínio, e insere SÓ em `adm_pedidos` e `adm_pedidos_decisao`, com policy que só aceita pedido na fila. Mais estrito que a especificação. `adm_pedidos` não foi alterada (seu `check` de tipo não admite decisão, e mudar `check` não é aditivo).
- `people`: nenhum grant. O rótulo de identidade vem de `identity_match_queue` e `sources`.
- `extensions`: o role recebe `usage` no schema (como o `web_reader`), porque a leitura de `places` passa por índice com função de `extensions`.
- Login local: `db/local/post_0003_admin_central.sql`, senha de desenvolvimento, só local. Role é do cluster: o `admin_central` com login existe agora no cluster local inteiro, inclusive para o banco `civico` do mesmo servidor, mas sem nenhum grant nele.
- Incidente de execução, sem relação com a migração: a primeira suíte depois da `0153` passou de 10 minutos e dois arquivos pareceram presos. Isolados, passaram (`test_admin_chaves.py` 16 em 53 s; `test_admin_candidata.py` 9 em 8 s), e a suíte inteira passou depois com 1.329 testes, os mesmos 33 pulos e 4 xfail, em 13 minutos. A lentidão é dos bancos isolados criados por arquivo de teste, cada um aplicando 42 migrações; o tempo da suíte subiu com o número de arquivos que os usam.
- Materializa: commit da C1. Desfazer: `drop owned by admin_central; drop role admin_central; drop table adm_pedidos_decisao;` e `git revert`.

## AC-20 · Forma única dos pedidos e da `chave_idem`: a do executor; quatro leituras do executor aceitas

- Data e fase: 2026-11-17, fase C, depois de C2 e C4 (construídas em paralelo, cada uma com a sua forma de parâmetros).
- Escolha: a forma canônica é a de `executor.normalizar` e `executor.chave_idem` (etl/civico_etl/admin/executor.py), com `VETORES_DE_OURO`. A central (`validarPedido`, `chaveIdemDecisao` em web/src/lib/admin/sql.ts) passa a produzir os mesmos parâmetros normalizados e a mesma chave, e o teste `admin-sql.test.ts` confere os vetores de ouro e que eles continuam em `executor.py`. Motivo: dois cliques, um pela tela e outro pela CLI, têm de dar um pedido só (critério 20), e o executor recusaria a forma achatada que a C4 tinha inventado.
- Testes da própria C4 (commit `859bd4a`, desta entrega) ajustados para a forma nova: `validarPedido` e a chave da decisão. Nenhum teste anterior à entrega mudou (R-1).
- Leituras do executor aceitas: (1) `aplicar` entra na chave da decisão: "só decidir" e "decidir e aplicar" são pedidos diferentes; (2) rodada `interrompida` faz o pedido terminar `interrompido`; (3) a recoleta só força a releitura das URLs de evidência que são entrada da prévia (`rodadas.abrir` recusa as outras); as de fora ficam no `andamento`, com o motivo; (4) decisão e aplicação na mesma transação do `concluido`, como `admin decidir --aplicar`.
- Perguntas abertas do construtor, decididas: recoleta de `contato_mandato` roda `parlamento.extras` sem recorte territorial (o coletor só aceita ano), e o `andamento` diz isso; não se recusa o nível município, porque é o único caminho de releitura dessa classe. "Executor parado" segue a regra literal do plano (fila com mais de 60 s ou batimento com mais de 120 s), e a consulta expõe `executor_ocupado` para a tela dizer "ocupado com uma rodada longa" em vez de só alarmar. `recuperar` com a trava tomada deixa o pedido `interrompido`, com o motivo em `erro`, e a rodada `em_andamento` até a trava soltar.
- Banco órfão: o primeiro `pytest` da C2 apagou `admin_coleta_iso_2009`, que era órfão (PID morto) de uma rodada de teste anterior desta entrega; a fixture `banco_isolado` apaga esses bancos por desenho. Não é banco do dono.
- Desfazer: `git revert` do commit desta conciliação.
- Achado da suíte inteira depois da C2 (`1 failed, 1365 passed, 33 skipped, 4 xfailed`): o teste de segurança do critério 9 (`test_admin_chaves.py::test_A`) pegou `executor._despachar(p: dict)` e `_decisao(p: dict)` no caminho transitivo até `chaves_dos_agentes`: mapeamento como parâmetro é por onde um valor de chave poderia entrar. Correção no executor, teste intacto: as duas funções recebem só `tabela` e `pedido_id` e releem a linha `em_execucao` do banco.

## AC-21 · Achados do verificador Opus da Parte C e correções

- Data e fase: 2026-11-17, fim da fase C. Relatório: `verificacao/parte-c-opus.md`.
- G1 (critério 15) NÃO ATENDIA: com a central fechada, a requisição RSC das páginas respondia 200 (sem dado: o `notFound()` do layout não muda o status do payload RSC), `OPTIONS` 400 e `TRACE` 500. Correção: `web/src/middleware.ts`, com matcher só `/admin` e `/admin/:path*` e runtime nodejs, importando só a regra pura `guarda-regra.ts`; responde 404 a qualquer método antes de qualquer renderização. O site público não passa pelo middleware (matcher no manifesto `functions-config-manifest.json`). É arquivo novo; nenhuma rota, componente ou estilo público mudou.
- Ressalva aceita, a reverificar: `TRACE` em `/admin/*` responde 500 (página de erro genérica, sem dado), porque o adaptador de middleware do Next 15.5 monta um `Request` do Node, que recusa o método TRACE antes de a função rodar; o mesmo vale no runtime edge. Revela que a rota existe, o que os chunks JS servidos também revelam; não expõe dado nem grava nada. Na Vercel o pedido nem chegaria (a central só sobe local). Corrigir exigiria servidor custom ou proxy na frente, fora do escopo. A prova mede o caso à parte e exige o 500 com a mensagem exata do Next.
- G1-4: com a central ligada, GET com `Host` externo respondia 200 (leitura por DNS rebinding). Correção: o middleware exige Host local (função pura `hostDeRequisicaoLocal`, também usada pelos POST).
- G1-3: `ADMIN_DATABASE_URL=postgres://u@localhost/db?host=remoto` passava na guarda e o driver conectava no remoto. Correção: `decidirAcesso` nega query `host`/`hostaddr`/`service`, vírgula no authority e protocolo que não seja postgres.
- G4-1: a policy de insert deixava o cliente escolher `criado_em` (furar a fila, falso "executor parado") e `chave_idem` (furar "dois cliques = um pedido" no banco). Correção: migração `0154` aditiva com policy RESTRICTIVE `admin_central_criado_agora` (janela de 5 s) nas duas tabelas de pedido; o executor recalcula a `chave_idem` e termina `falhou` o pedido divergente sem executar nada. `id` escolhido pelo cliente fica: é uuid único e não ordena nada.
- G2-1: as fixtures dos testes do critério 22 apagavam a chave da API de modelo, e uma volta ao motor real cairia em silêncio no motor local. Correção: chave falsa no ambiente e construtor do cliente real trocado por um que registra e falha; o teardown exige zero tentativas.
- Asserções desta entrega estendidas (nenhuma anterior à entrega): o conjunto exato de policies do `admin_central` ganhou a policy nova; um teste de pedido inválido passou a calcular a chave sobre os parâmetros normalizados; um teste de parecer sem chave passou a apagar a chave que a fixture agora define.
- Anotados, sem correção nesta entrega: `base_url` corrigido por pessoa aceita qualquer http(s), inclusive endereço interno, que o coletor depois busca; `por_nome="agentes"` é aceito como texto; o login local do `admin_central` vale para o cluster inteiro e o `pg_hba` local está em `trust`; o role pode trocar a própria senha; o comentário da `0153` diz "onze" tabelas e lista doze; os chunks JS da central são servidos com ela fechada (código, sem dado); `OPTIONS /` público responde 400 (fora do escopo).
- Desfazer: `git revert` do commit; `drop policy admin_central_criado_agora on adm_pedidos; drop policy admin_central_criado_agora on adm_pedidos_decisao;`.

## AC-22 · Reverificação da Parte C: N1 e N2 corrigidos; TRACE vai ao dono

- Data e fase: 2026-11-17, fim da fase C. Relatório: `verificacao/parte-c-opus-v2.md` (Opus de contexto limpo, diferente do primeiro).
- Confirmados corrigidos: G1-1 (RSC), G1-4 (Host, inclusive `X-Forwarded-Host`, `Forwarded` e `x-middleware-subrequest`), G1-5 (título no 404), G2-1 (a mutação de volta ao motor real deixa o teste vermelho). Ambiente lido em tempo de execução nos dois sentidos; site público com status e tamanho idênticos com a central ligada e desligada. G2 (critérios 22 e 9) ATENDE.
- N1 (corrigido aqui): a guarda cortava a URL do banco em `#` e o driver não; `postgres://u@localhost#@remoto/db` passava e conectava no remoto. Agora `decidirAcesso` recusa `#`, espaço e caractere de controle e lê o host também do jeito do driver; `sqlAdmin()` confere `sql.options.host`/`path` antes da primeira consulta. Teste compara guarda e driver em toda URL aceita.
- N2 (corrigido aqui): a policy da `0154` usa `now()` (início da transação); transação longa com o default retroagia `criado_em`. Migração `0155` aditiva com policy RESTRICTIVE pelo `clock_timestamp()`; teste com transação de 6 s recusada e de 0,2 s aceita.
- Anotados: N3 (o JSON canônico do TypeScript e o do Python divergem para `valor` com notação exponencial ou caractere fora do BMP: a decisão `corrigir` com esse valor falha por chave divergente, sem efeito); N4 (pedido forjado pela central com a chave de um legítimo ocupa a chave e o executor o falha: negação de serviço local); N5 (dois cabeçalhos Host, local primeiro: o Node fica com o primeiro; navegador não manda).
- TRACE: 500 em `/admin/*` com a central fechada (sem dado; só revela o prefixo, que os chunks JS também revelam). Pela letra, o critério 15 não fecha. O reverificador julga aceitável SÓ com aprovação explícita do dono e aponta a alternativa: sufixo `.admin.tsx` nos arquivos do grupo e do middleware, com `pageExtensions` só incluindo `admin.tsx` quando `ADMIN_CENTRAL=1` no build (builds de CI, Preview e produção ficam sem rota nem middleware da central). Essa alternativa mexe no `next.config.ts` compartilhado e renomeia todos os arquivos da central. Decisão do dono (item 6 da lista de parada). A prova sem navegador registra o caso como EXCEÇÃO pendente.
- Decisão do dono, 2026-11-17, na sessão: "Aceitar exceção". O critério 15 fica como passou, com a exceção de `TRACE` em `/admin/*` (500 sem dado em vez de 404), pelo motivo acima. A alternativa por `pageExtensions` não foi feita.

## AC-23 · Fase F3: central preparada para `admin.segueovoto.com.br`, com login; contrato entre as tarefas

- Data: 2026-11-17. Origem: pedido da sessão de origem, com aprovação do dono ("Sim, siga assim"), sobre `replica/reavaliacao-central-e-dominio.md` (copiado para este branch). Escopo: F3 (código) e a preparação de código de F5. Nada em produção. Teto da fase: 20 subagentes.
- Decisões do dono que valem como premissa: central num segundo projeto Vercel do mesmo repo, em `admin.segueovoto.com.br`; login pelo Supabase Auth do site, tabela `adm_admins` e MFA TOTP obrigatório; executor como worker contínuo num container; site em `www.segueovoto.com.br`.
- Trava em dois modos explícitos, escolhidos por `ADMIN_CENTRAL`:
  - `ADMIN_CENTRAL=1`, modo local: as regras de hoje (fora da Vercel, banco e Host locais). Identidade: `ADMIN_LOCAL_EMAIL`, que tem de constar ativo em `adm_admins` (o banco confere). Sem login nem MFA.
  - `ADMIN_CENTRAL=producao`, modo produção: exige `VERCEL_ENV=production` (Preview fica 404), Host exatamente `admin.segueovoto.com.br` (valor fixo no código, não em variável), `AUTH_PROVIDER=supabase`, `ADMIN_DATABASE_URL` postgres com qualquer host e `sslmode=require` ou mais forte; e, por requisição, sessão do Supabase válida (`getUser`), nível `aal2` (MFA) e e-mail ativo em `adm_admins`. Falta de qualquer um: 404. Exceção: admin logado com `aal1` vai para a página de cadastro ou verificação do fator.
  - Qualquer outro valor: 404, como hoje.
- Banco (migração `0156`, aditiva): `adm_admins` (e-mail único, nome, `user_id` opcional, ativo, datas) e `adm_admins_log` só de acréscimo, por gatilho, ambas escritas só pelo dono do banco; `por_user_id` e `por_email` em `adm_pedidos` e `adm_pedidos_decisao`; gatilho `before insert` nas duas tabelas que, para o role `admin_central`, exige `por_email` de admin ativo (e `por_user_id` igual quando o admin tem `user_id`), grava `por_nome` (na decisão) com o nome da tabela de admins, ignorando o que veio, e recusa mais de 20 pedidos do mesmo admin em 60 s; `select` em `adm_admins` para o `admin_central`; o `admin_central` deixa de ler `identity_match_queue.raw` (a tela não usa: `select` por coluna no lugar do `select` da tabela).
- CLI: `admin decidir --por` passa a exigir e-mail ou nome de admin ativo em `adm_admins`; o nome gravado é o da tabela.
- Anti-SSRF: decisão que grava `base_url` só aceita `https`, com host que resolve só para IP público (recusa privado, loopback, link-local, multicast, reservado); conferido em `decisoes.decidir` (CLI e executor). Limite: a resolução é no momento da decisão; a busca posterior do coletor não é alterada (restrição 8).
- Identidade na tela: `por` do corpo é ignorado; o servidor usa a sessão (produção) ou `ADMIN_LOCAL_EMAIL` (local). Função única `operadorAtual()` em `web/src/lib/admin/sessao.ts`, que devolve `{ userId: string | null; email: string; nome: string }` ou lança 404.
- CSRF: além do JSON, `Origin` presente e igual à origem da central e `Sec-Fetch-Site: same-origin` obrigatórios. Cabeçalhos só nas rotas da central (middleware): `Content-Security-Policy` com `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`. Middleware: `updateSession` do `@supabase/ssr` só no matcher `/admin`; o site público continua sem middleware.
- Ordem: T1 banco e ETL, T2 acesso no `web/` e T4 container rodam em paralelo (arquivos disjuntos); T3 UX e UI depois da T2; T5 critérios 15, 23 e 9 reescritos e provas; verificador Opus de segurança no fim.

## AC-24 · F3-T1 aceita; o executor exige admin em todo pedido de decisão

- Data: 2026-11-17. Migração `0156` lida por inteiro e aplicada em `admin_coleta` (44 → 45 migrações; o `post_0004` cria o admin local `operador.local@segueovoto.invalid`).
- Furo fechado pelo orquestrador: `admin pedido decidir --por` grava o pedido pelo role do dono, onde o gatilho `adm_pedido_identidade` não age, e o executor aceitaria qualquer nome como "pessoa". Agora o executor (`_decisao`) só registra decisão se o pedido traz `por_email` de admin ativo ou `por_nome` igual ao nome de um admin ativo; senão `falhou` com o motivo. Teste `test_pedido_de_decisao_gravado_pela_cli_com_nome_que_nao_e_admin_falha_sem_decidir`.
- Asserções desta entrega estendidas pela T1 (registro): conjunto de gatilhos das tabelas de pedido ganhou `adm_pedido_identidade`; matrizes de grants passaram a esperar `select` por coluna em `identity_match_queue` sem `raw`; fixtures cadastram os admins cujos nomes os testes já usavam; `por_nome` em branco inserido pelo `admin_central` deixou de dar `CheckViolation` porque o gatilho o sobrescreve com o nome da tabela (o `check` segue provado para o dono). Testes de `base_url` passaram a usar um DNS falso, porque a decisão agora resolve o host.
- Limites anotados: admin sem `user_id` aceita qualquer `por_user_id` (em produção, cadastrar o `user_id`); o limite de 20 pedidos em 60 s conta linhas confirmadas e duas transações simultâneas podem passar juntas por poucas linhas; o dono do banco pode burlar os gatilhos (`session_replication_role`) e truncar o log; a resolução DNS anti-SSRF é no momento da decisão, não na busca do coletor.

## AC-25 · F3-T2 aceita: acesso em dois modos, login com MFA e cabeçalhos

- Data: 2026-11-17. Middleware, regra dos modos e identidade lidos por inteiro. `web/`: 195 testes unitários, eslint e tsc sem erro, `next build` do CI com o middleware só nos matchers da central.
- Desenho conforme a AC-23, com estes pontos decididos pela tarefa e aceitos:
  - páginas de entrada `/admin/entrar` (e-mail e código) e `/admin/entrar/fator` (TOTP), só no modo produção, com client próprio da central (`shouldCreateUser: false`: quem não é admin não ganha conta pela central) e resposta neutra (não revela se o e-mail é admin);
  - o layout do grupo envolve as páginas de entrada: o middleware põe o cabeçalho de requisição `x-admin-entrada` só nelas, e apaga o que o cliente mandar com esse nome; o layout usa `exigirAdminOuEntrada()`, que só pula a checagem de admin com essa marca; cada página de entrada se protege sozinha;
  - CSP com nonce por requisição e um hash para o script de tema do layout raiz (que não leva nonce e não pode ser editado); `style-src 'unsafe-inline'` é a única diretiva afrouxada; Turnstile só em produção; o navegador não fala com o Supabase (tudo é server action);
  - cookies da central host-only, `SameSite=Strict`, `Secure`, `HttpOnly`, `path=/admin`: abrir a central por link externo mostra 404 até a próxima navegação (efeito do `Strict`);
  - erro 54000 do gatilho de ritmo vira 429 com `Retry-After: 60`; 42501 vira 403;
  - chave de idempotência da decisão calculada com o nome do admin em `adm_admins`, o mesmo que o gatilho grava e o executor recalcula.
- Asserções desta entrega estendidas: a guarda no teste de código passou à forma `await` (mais estrita); o teste de `validarDecisao` deixou de exigir `por` (o campo agora é descartado) e passou a provar que qualquer `por` é descartado; o vetor de ouro da decisão passa o nome explícito.
- Não provado: nada foi exercitado com Supabase real (login, código, TOTP, `aal2`, renovação de cookie, Turnstile); os cabeçalhos foram provados com requisição fabricada, não com `curl -I` num servidor. `sslmode=require` no driver `postgres` não valida a cadeia do certificado; exigir `verify-full` em produção é decisão do dono.
- `.gitignore` ganha `web/.next-admin/` (pasta do build da config do Playwright da central).

## AC-26 · F3-T3 aceita: correções de UX e UI da central

- Data: 2026-11-17. 223 testes unitários do `web/` (28 novos), eslint e tsc sem erro, build do CI ok, nenhum `<circle>` no código da central. Nada foi visto renderizado; as specs do Playwright só foram listadas (49).
- Feitas as cinco de UX e as cinco de UI da reavaliação, mais "Decidindo como {nome}" e o executor como estado operacional ("visto há X", promessa de início em até ~5 s com o executor ativo). Abrir rodada usa a lista do catálogo, gerada do Python em `web/src/lib/admin/catalogo.json` e conferida contra ele por teste. O 0 do mapa ganha o "0" escrito, distinto do contorno reforçado do padrão "vazio". Padrões de estado com tamanho fixo em px de tela; ponto continua retângulo.
- Decisões da tarefa aceitas: faixa "INTERNO" por CSS (`.admin-central::before`), sem tocar no layout; "visto há X" é o último sinal entre os pedidos recentes, porque o executor só bate enquanto executa um pedido (fila vazia sem pedido recente mostra "sem sinal registrado"); "~5 s" é o pior caso observável (laço de 2 s, tela de 5 s); a contagem "N fichas" da recoleta usa a mesma igualdade de território do executor e limita a 1000 itens da fila ("N ou mais"); o nome do município é lido das malhas em disco e cai para o código IBGE se a malha não estiver no runtime (garantir na Vercel exigiria `outputFileTracingIncludes` no `next.config`, fora do escopo).
- Specs do Playwright desta entrega ajustadas à tela nova (recoleta com revisão, decisão sem "Por", ordem de Tab, falha 503), com testes novos acrescentados; nenhum teste unitário anterior alterado.
- Ficou de fora: filtros da fila por UF, vencidas e reabertas; "próxima pendência"; "Hoje / Proposta" lado a lado; busca do mapa que navega a cada tecla; aviso de duas pessoas na mesma pendência; o desvio de `--tint` (decisão do dono).

## AC-27 · F3-T5 aceita; dois defeitos da prova corrigidos pelo orquestrador

- Data: 2026-11-17. Critérios 15, 23 e 9 reescritos para produção em `replica/admin-coleta-criterios-producao.md`. Provas: `sem-navegador.mjs` (com o modo produção simulado, CSRF estrito, `por` ignorado, cabeçalhos em resposta real e ausentes no site público, admin desativado, limite de ritmo), `sem-rede-externa.mjs` (só `challenges.cloudflare.com`, e só na entrada), primeira rodada duas vezes no modo local.
- Defeito 1, corrigido: com o provedor de login fora do ar, cada requisição com cookie esperava ~25 s (backoff do supabase-js, sem prazo) antes do 404; `/admin/entrar`, ~51 s. Agora `comPrazo` (4 s, `web/src/lib/admin/prazo.ts`, módulo puro que o middleware pode importar) envolve `getUser` e o nível de MFA no middleware e na sessão; estourado, conta como falha e fecha com 404. A prova passou de aviso para verificação: o conjunto em paralelo leva 8 s.
- Defeito 2, corrigido: no modo local, banco inalcançável dava 404, que a tela lia como "sessão expirou". Agora a identidade distingue falha de banco no modo local: API 503 "Não foi possível ler o banco", página 500. No modo produção, qualquer falha continua fechando com 404.
- Aceitos como estão: admin desativado recebe 404 na API (a guarda o barra antes do gatilho; fecha); a decisão de `base_url` resolve o DNS mesmo sem aplicar (é o desenho do anti-SSRF), e por isso a primeira rodada sem rede usa um DNS falso só nos processos do ETL das provas (`web/e2e-admin/dns-falso/sitecustomize.py`).
- TRACE: continua 500 em `/admin/*` também no modo produção simulado. A exceção da AC-22 foi aprovada para a central local; para a internet é a decisão 5 da seção 7 da reavaliação, aberta.

## AC-28 · Verificador Opus da F3: dois bloqueios e três correções; o que mudou

- Data: 2026-11-17. Relatório: `verificacao/f3-opus.md`. Dentro de `/admin`, trava, identidade e CSRF provados ao vivo pelo verificador (sessão Supabase falsa, aal1/aal2, admin, não admin, inativo, 40 requisições concorrentes sem vazamento do `cache()`).
- A1 (bloqueava a F4): o projeto admin serviria o site público inteiro na mesma origem da central, e o site leria o cookie dela. Correção: `web/next.config.ts` passa a ser `configuracao(env)`; com `ADMIN_CENTRAL=producao` NO BUILD (só o projeto admin a tem), um rewrite `beforeFiles` leva tudo fora de `/admin`, `/_next/static`, das 28 malhas `/geo` e do favicon a um 404 de 9 B sem página pública; `headers()` põe `X-Frame-Options`, `Referrer-Policy` e `frame-ancestors 'none'` em toda resposta; `skipTrailingSlashRedirect` (o 308 de barra final saía sem cabeçalho). Sem a variável o objeto é o de antes (teste). Server action é roteada pelo id, não pelo caminho: por isso NENHUMA server action roda na central (o middleware dá 404 a qualquer `Next-Action` e a POST de formulário), e as quatro actions da entrada viraram rotas de API (`/admin/api/entrar/*`, com CSRF como os outros POST). Prova: os 10 ids de action pública em `/`, `/admin`, `/admin/fila`, `/admin/entrar` → 404 sem efeito; com controle positivo no build do site.
- Alternativa considerada e não feita: separação em build por `pageExtensions`. Tiraria o código da central do bundle do projeto do site, mas renomeia a central inteira, exige layout raiz próprio e arrisca o build público; não resolveria o TRACE no host da central (o middleware de `/admin` continua lá).
- Build do site: mesmas rotas mais as 4 `/admin/api/entrar/*` (404 pela trava); mesmas 10 actions públicas (arquivo, nome e workers); os route handlers passaram de 179 para 190 B por efeito do webpack, sem mudança de código público.
- A2 (bloqueava): o anti-SSRF caía num redirecionamento. Correção no `http.py` comum: gancho por requisição (cada salto) e backend de rede que resolve, confere todos os IPs e conecta no IP conferido (fecha também o rebinding; SNI e Host seguem o nome). Desligável só por `ETL_REDE_SEGURA=0`. Ponto frágil anotado: troca um campo privado do transporte (`_pool._network_backend`); versões travadas no `uv.lock`; com proxy, só o gancho.
- A3: envio de código com tempo fixo de 1,5 s para admin e não admin (medido 1512–1514 ms); limite de ritmo fica no Supabase. A4: com fator TOTP verificado, o `fatorId` do cliente é ignorado; o primeiro cadastro é confiança no primeiro uso (limite). A5: Turnstile só na CSP das páginas de entrada. A7: admin conferido só pelo e-mail quando o pedido traz e-mail. A9: cabeçalhos também no 404 do rewrite. A10: cookie da central `sb-admin-central-auth-token`. A11: `tini` como PID 1. A12: IP numérico não canônico recusado.
- Anotados: A6 (o login de produção tem de ser o próprio `admin_central`, não um membro dele: o gatilho compara `current_user`), A8 (cadastrar o `user_id` de cada admin antes da F4), TRACE (500 sem cabeçalhos; decisão 5 aberta).

## AC-29 · TRACE na central na internet: exceção aceita pelo dono, a conferir na F4; A1 passa à separação no build

- Data: 2026-11-17. Decisão do dono, nas palavras dele, relayed pela sessão de origem: "Aceito, confere na F4". A exceção de `TRACE` (500 em `/admin/*`, sem dado) vale também para a central em `admin.segueovoto.com.br`, desde que a resposta não traga dado. Na F4, conferir contra o deploy real da Vercel com `curl -X TRACE -sI https://admin.segueovoto.com.br/admin` e anotar o resultado no runbook (passo incluído na seção de passos do dono). Se a separação no build levar o `TRACE` a 404, registrar e a exceção deixa de ser necessária.
- A1 muda de desenho: o reverificador da F3 (`verificacao/f3-opus-v2.md`) achou o segundo vazamento do filtro por caminho (N1: `/ADMIN`, `/_NEXT/STATIC/x` escapavam do rewrite, que o Next avalia sem distinguir caixa, e do middleware, cujo matcher distingue), depois do vazamento das actions por id. Filtro por caminho num build que contém o site público tende a seguir vazando por variações. Decisão: separar no build por `pageExtensions`; o build do projeto admin não terá nenhuma página, rota nem metadado público, e o build do site não terá a central nem middleware. Isso substitui o rewrite da AC-28 e o remendo de caixa no matcher (a prova do remendo foi rodada e fica registrada, mas o desenho final é a separação).
