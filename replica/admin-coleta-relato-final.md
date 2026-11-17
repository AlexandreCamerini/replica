# Admin de coleta · relato final (RASCUNHO, a conferir pelo verificador do relato)

Fonte de cada linha: o arquivo ou teste citado. Onde não há prova, está escrito "sem prova encontrada". Nada aqui foi lido de fonte real: toda rodada de coleta desta entrega é SIMULADA (respostas fabricadas em `etl/tests/fixtures/sapl_ale`).

## 1. Cabeçalho

| Campo | Valor |
| --- | --- |
| SHA de partida | `39ee3ec64c989dcc5d02489f8eeb24e4c6a4d643` (merge do PR 49) |
| HEAD | `9177692d66c615183c304862418e24e48dff44a1` |
| Branch | `claude/hopeful-lewin-176541` (worktree `.claude/worktrees/hopeful-lewin-176541`) |
| Data do fechamento | 2026-11-17 (evidências de `replica/prompts/evidencias/fechamento/` geradas às 08:29-08:30 -03) |
| Commits | 60 em `39ee3ec..HEAD` (`git log --oneline 39ee3ec..HEAD`) |
| Migrações novas | `0150` a `0155` (todas novas; nenhuma existente editada) |
| Push, PR, merge | nenhum (é do dono) |
| Sem rastreio no worktree | `liberar-sandbox-local.sh`, `web/.next-reverif/`, `web/.reverif-url.mts`, `web/playwright-report-admin/` |

Códigos de saída do fechamento (`fechamento/codigos.txt`): `unit=0 eslint=0 tsc=0 build=0 semnav=0 rede=0 r1a=0 r1b=0 fluxo=1`. O `fluxo=1` é a linha de base (item R-10).

## 2. Tabela de critérios

Legenda da situação: passou, falhou, não executado, simulado, substituído, passou com exceção. "Suíte" = `cd etl && uv run --frozen pytest -q -rs` no banco `admin_coleta`, saída final em `replica/prompts/evidencias/fechamento/suite-etl.txt`: `1374 passed, 33 skipped, 4 xfailed in 521.70s (0:08:41)`, exit 0. Linha de base da suíte: `767 passed, 33 skipped, 4 xfailed`.

Limite desta tabela para R-1 a R-9: o fechamento gravou só a suíte inteira, não uma saída por arquivo. A prova de cada R é o teste nomeado rodando dentro da suíte verde, mais a leitura dos verificadores da Parte R (`verificacao/parte-r.md` e `parte-r-v2.md`, na pasta de notas da sessão, fora do repositório). Não há saída isolada gravada por critério R.

### Parte R

| Critério | Situação | Comando | Prova | Observação |
| --- | --- | --- | --- | --- |
| R-1 | passou | Suíte; `git diff --name-status 39ee3ec..HEAD -- etl/tests web/src/lib/__tests__ web/e2e` | `1374 passed, 33 skipped, 4 xfailed`; o diff só tem linhas `A` (nenhum teste anterior à entrega alterado) | Nenhum módulo foi movido (AC-02), então não há "mapa de → para" nem alias em `sys.modules` a provar. O prompt cita 86 `monkeypatch.setattr`; a AC-02 e a D325 contam 57 (os que miram módulo de `jobs`). Contagens diferentes, nenhuma explicação registrada para a diferença |
| R-2 | passou, com 5 módulos declarados sem caracterização | Suíte | `etl/tests/test_caracterizacao.py`: `test_camara_equipe`, `test_receita_arrecadacao`, `test_ibge_places`, `test_ibge_populacao`, `test_governos_indicadores`, `test_parlamento_extras`, `test_ale_cobertura`; retratos em `etl/tests/retratos/*.json` (commit R4 `7fc21fa` a R6 `491fc5a`, antes do catálogo R7 `a1614da`) | Sem caracterização e não tocados por dentro: `ibge_malhas`, `senado_extras`, `camara_presenca`, `almg`, `alesp`. O prompt só admite essa declaração quando a entrada não dá para fabricar com fidelidade; o plano (seção 0.5) justifica por "não tocado", não por inviabilidade de fabricar. O verificador da Parte R deu "ATENDE (com ressalva)". 15 dos 24 coletores do catálogo seguem sem teste que chame a função de entrada (AC-08) |
| R-3 | passou | Suíte | `etl/tests/test_retrato_agenda.py::test_retrato_da_agenda_nao_mudou` e `::test_retrato_cobre_todos_os_campos_de_task` contra `retratos/agenda.json` | Verificador da Parte R: 4 mutações em memória, 4 detectadas |
| R-4 | passou | Suíte | `etl/tests/test_orquestradores.py::test_todo_comando_citado_existe_na_cli`, `::test_toda_tarefa_citada_existe_em_tasks`, `::test_nao_resolvidos_sao_exatamente_os_conhecidos` | Extrai 7 comandos e 1 tarefa (`sapl.todas`); o único não resolvido (`--only $ONLY`, `etl.yml:60`) está fixado no teste |
| R-5 | substituído (parte das fontes) e passou no resto | Suíte | `etl/tests/test_catalogo.py::test_comandos_do_catalogo_sao_exatamente_os_da_cli`, `::test_toda_tarefa_de_tasks_esta_em_exatamente_um_coletor_e_nada_sobra`, `::test_fontes_de_seed_e_migracao_existem_em_sources`, `::test_fontes_de_origem_job_sao_criadas_pelo_codigo_do_coletor`; paridade `MAX_AGE_H` x `sources.ts` por `test_schedule.py::test_max_age_igual_ao_site` (pré-existente) | AC-04: o critério como escrito ("toda fonte existe em `sources` depois do seed") é impossível para `sapl-ale`, `alesp` e `alemg`, que o próprio job cria (`sapl.py:650`, `assembleias.py:320`). O original sai "não atendido" nessa parte; o substituto confere seed e migração no banco e as três do job no código-fonte |
| R-6 | passou | Suíte | `etl/tests/test_retrato_plano.py::test_plano_igual_ao_retrato`, `::test_retrato_cobre_o_estado_variado` | `schedule.py` e `db.py` fora do diff; o teste é rede de proteção |
| R-7 | substituído (parcial ao pé da letra) | Suíte | `etl/tests/test_contrato_cadeia.py::test_cadeia_igual_pela_cli_e_pelo_contrato_e_igual_ao_catalogo`, `::test_cadeias_pedidas_no_criterio`, `::test_entrada_inalterada_real_db_run_pula_por_checksum_e_o_passo_encadeado_roda_pelos_dois_caminhos` | A paridade de passos entre CLI e contrato passou. A frase "entrada inalterada interrompe a cadeia" é falsa no código (BUG-056): todo `run_*` com `input_checksum` captura `SkipUnchanged` por dentro, então `camara.diario` sem mudança ainda roda `identity.dedupe` e `derive.stats`. O teste fixa o comportamento real. Com `db.run` real só `ibge.populacao`; em `camara.diario` e `senado.diario` a entrada inalterada usa gravadores (AC-08) |
| R-8 | passou | Suíte | `etl/tests/test_codigos_saida.py::test_check_com_invariante_quebrada_sai_1`, `::test_run_due_com_check_quebrado_sai_2`, `::test_run_due_com_tarefa_que_falha_sai_2` | |
| R-9 | passou | `git diff --name-status 39ee3ec..HEAD`; `git diff --stat 39ee3ec..2743a74 -- etl/civico_etl` | Na Parte R só entram arquivos novos em `etl/civico_etl/catalogo/` e testes; nenhum SQL de domínio, parser ou regra de identidade em arquivo existente | SQL novo (só `select`, dentro de `descrever`, só com conexão): `catalogo/contrato.py` (3), `adaptadores_a.py` (1), `adaptadores_b.py` (2), `adaptadores_c.py` (1), sete no total (AC-08). Fora da Parte R, `cli.py` (+5) e `http.py` (+130) mudam por desenho da fase A |
| R-10 | passou (sem falha nova) | `python3 -I replica/tools/fluxo_confere.py` | `fechamento/fluxo-confere.txt`: `FALHA: 7 problema(s)`, os mesmos 7 da linha de base (workflow `verificacao-eval.yml`; `cadeiras.ts`, `cobertura.ts`, `lista.ts`; `ajustes/actions.ts`; `mcp/page.tsx:22-37`; `p/[slug]/opengraph-image.tsx:10-14`) | Código 1 antes e depois |

### Partes A e B

| Critério | Situação | Comando | Prova | Observação |
| --- | --- | --- | --- | --- |
| 1 | passou | `etl/tests/test_admin_migracao.py::test_criterio_1_aplica_do_zero_e_uma_segunda_vez_sem_erro`; `bash replica/prompts/evidencias/primeira-rodada.sh` | `fechamento/migrar-segunda-vez-r1.txt`: `ok: 44 migração(ões) aplicada(s)` (segunda aplicação no `admin_coleta_r1`, exit 0) | A primeira rodada aplica as 44 do zero. Banco local, não produção |
| 2 | passou | Suíte | `1374 passed, 33 skipped, 4 xfailed`; `grep SKIPPED fechamento/suite-etl.txt` dá 33 linhas e nenhuma em arquivo `test_admin_*`, `test_catalogo*`, `test_retrato_*`, `test_caracterizacao`, `test_contrato_cadeia`, `test_codigos_saida` ou `test_orquestradores` | Os 33 pulos são os da linha de base (seção 6): "banco sem carga", "agenda não carregada" e afins. Nenhum pulo novo |
| 3 | passou | Suíte | `etl/tests/test_admin_previa.py::test_1_previa_sem_nenhuma_requisicao`, `::test_2_urls_de_entrada_da_previa_igual_a_da_rodada` | Estimativa marcada como estimativa: coberto por `test_3_previa_depois_da_rodada`, sem trecho de saída próprio gravado |
| 4 | passou, dentro da janela de frescor do cache | Suíte | `etl/tests/test_admin_rodada.py::test_8_repetir_nao_cria_linha_e_marca_reaproveitada`; `etl/tests/test_admin_propostas.py::test_criterio_4_repetir_a_mesma_proposta_cria_zero_linha_e_nao_altera_nada`; primeira rodada passo 4 (`primeira-rodada-07-*`) | Verificador Sonnet da Parte B: "reaproveitada" depende de `max_age` ou de 304; fora da janela e sem ETag a tentativa sai `lida` (achado C3, sem destino registrado) |
| 5 | passou, depois da correção AC-15 | Suíte | `etl/tests/test_admin_rodada.py::test_9_rodada_interrompida_e_repetida`; `etl/tests/test_admin_endurece.py::test_D1_keyboardinterrupt_depois_do_coletor_leva_a_interrompida_e_sai_e_a_repeticao_nao_duplica`, `::test_D3_rodada_deixada_em_andamento_a_mao_e_recuperada_e_depois_repetida_sem_duplicata` | O verificador Sonnet deu PARCIAL (rodada órfã em `em_andamento` não tinha retomada); corrigido na B6 (`ac43528`, `admin rodada recuperar`). Não houve reverificação independente do critério 5 depois da correção; só a do critério 9 |
| 6 | passou | Suíte | `etl/tests/test_admin_tentativas.py::test_criterio_6_falha_grava_motivo_e_nao_apaga_a_ultima_evidencia_valida` | 403, robots, timeout e corpo vazio com fixtures em `etl/tests/fixtures/sapl_ale/v1/_comum/` |
| 7 | passou | Suíte | `etl/tests/test_admin_propostas.py::test_criterio_7_duas_fontes_valores_diferentes_uma_pendencia_dois_valores_nenhum_aplicado` | |
| 8 | passou | Suíte | `etl/tests/test_admin_propostas.py::test_criterio_8_hash_da_evidencia_mudou_reabre_pendencia_ja_decidida` e `::test_criterio_8_mesmo_hash_e_mesmo_vigente_continua_decidida` | Hash da falha ignora o horário e agrupa todo 5xx (AC-13, AC-15) |
| 9 | passou, com ressalvas declaradas | Suíte | `etl/tests/test_admin_chaves.py::test_matriz_so_variavel_on_e_linha_on_aplicam_e_todas_as_outras_falham_fechado_sem_mudar_nada`, `::test_o_gatilho_do_banco_confere_a_segunda_chave_sem_o_codigo`; `etl/tests/test_admin_endurece.py::test_A_nenhuma_funcao_do_caminho_das_chaves_aceita_parametro_que_substitua_a_variavel`, `::test_N2_env_extra_nao_pode_ligar_a_chave_dos_agentes` | Primeiro verificador Opus: NÃO ATENDE (porta `ambiente=`). Corrigido em `ac43528` e `baeb07d`. Reverificador Opus: ATENDE, com 4 mutações em memória detectadas (AC-18). Riscos residuais na seção 8 |
| 10 | passou | Suíte | `etl/tests/test_admin_propostas.py::test_criterio_10_proposta_sem_evidencia_e_recusada_antes_da_fila_e_nada_e_gravado`, `::test_criterio_10_o_proprio_banco_tambem_recusa_o_insert_direto_sem_url_trecho_ou_hash` | |
| 11 | passou, com limite declarado | Suíte | `etl/tests/test_admin_sobrevive.py::test_8_status_de_assembleia_decidido_sobrevive_a_nova_rodada_de_sapl_ales`, `::test_9a_...`, `::test_9b_...`, `::test_10_contato_corrigido_e_contato_novo_sobrevivem_ao_delete_e_insert_de_parlamento_extras`, `::test_11_status_decidido_da_fila_de_identidade_nao_volta_a_pendente`; `etl/tests/test_admin_endurece.py::test_E_o_valor_suprimido_nao_volta_depois_de_merge_person_real_e_nova_rodada_de_parlamento_extras` | Verificador Sonnet: PARCIAL (override de contato chaveado em `mandates.id` não acompanha a fusão); corrigido por gatilho novo na `0152` (AC-16), sem alterar `merge_person`. Limites: mandato de origem sem nenhuma linha de contato na fusão deixa o override órfão; o teste de identidade chama as funções de escrita da fila, não o job inteiro (AC-13, AC-16). Teste de sobrevivência do `base_url` e do `status` de Câmara pelo `sapl.descobrir` real: sem prova encontrada em `test_admin_sobrevive.py`; só o nível do gatilho em `test_admin_migracao.py::test_0151_sapl_houses_anota_o_que_o_job_tentou_e_mantem_o_decidido` |
| 12 | passou | Suíte | `etl/tests/test_admin_leitor.py::test_getassembly_devolve_o_valor_novo_da_cobertura_depois_de_aplicar_a_decisao`, `::test_getassembly_devolve_o_valor_novo_do_status_da_casa_pelo_join_com_sapl_houses`, `::test_o_sql_copiado_ainda_bate_com_o_arquivo_do_site`, `::test_base_url_de_assembleia_nao_tem_leitor_em_getassembly_e_a_decisao_nao_toca_sapl_houses` | `sapl_houses.base_url` de Assembleia não tem leitor em `getAssembly`; tem em `getCityCouncil` e `getPeopleCoverage` (AC-12, corrige a premissa do prompt) |
| 13 | passou | Suíte | `etl/tests/test_admin_fila.py::test_criterio_13_sql_da_fila_nao_cita_pessoa_partido_mandato_voto_nem_popularidade`, `::test_criterio_13_atributos_de_pessoa_e_partido_e_a_troca_de_quem_esta_ligado_a_que_nao_mudam_a_ordem`, `::test_criterio_13_o_plano_de_execucao_nao_toca_tabela_de_pessoa_partido_ou_mandato` | |
| 14 | falhou (literal); substituído, atendido | `cd etl && uv run --frozen civico-etl check` no `admin_coleta` | `fechamento/check-admin-coleta.txt`: `etl.check ERROR 5 invariante(s) quebrada(s)`; as 5: câmara 513, senado 81, cota amostra fixa, UF 1 governador titular, UF governador e vice em exercício | Já falhava na linha de base com as mesmas 5 (dependem de carga real). Substituto (AC-07, AC-17): nenhuma invariante quebrada além dessas 5. Na primeira rodada, `admin_base.sql` cria o município fabricado 1190099 sem prefeito, o que quebra uma sexta ("município: exatamente 1 prefeito titular") antes e depois da rodada (`primeira-rodada-segunda-execucao.txt`: "RESSALVA critério 14"); o conjunto não muda com a rodada |

### Parte C

| Critério | Situação | Comando | Prova | Observação |
| --- | --- | --- | --- | --- |
| 15 | passou com exceção (TRACE) | `node web/e2e-admin/sem-navegador.mjs --sem-build`; `cd web && npm run test:unit` | `replica/prompts/evidencias/central-sem-navegador.txt`: `ok (a) sem ADMIN_CENTRAL: 13 requisições ... todas com status 404`; `ok (b) ADMIN_CENTRAL=1 e VERCEL=1: ...404`; `ok (c) ADMIN_CENTRAL=1 e VERCEL_ENV=preview: ...404`; `AVISO EXCEÇÃO ao critério 15 (aprovada pelo dono, AC-22): ... TRACE -> 13 de 13 rotas com 500 em vez de 404`; unitários `web/src/lib/__tests__/admin-guarda.test.ts` ("sem ADMIN_CENTRAL, ou com valor diferente de 1, bloqueia (404)", "VERCEL ou VERCEL_ENV definida bloqueia, mesmo ligada e com URL local") e `admin-guarda-codigo.test.ts` | Exceção aprovada pelo dono em 2026-11-17 com as palavras "Aceitar exceção" (AC-22): TRACE em `/admin/*` responde 500 genérico, sem dado, em vez de 404. A alternativa por `pageExtensions` não foi feita. Spec de navegador `web/e2e-admin/central-desligada.spec.ts`: não executada (AC-05). Mais 78 requisições extras por contexto (RSC, prefetch, OPTIONS, PUT, DELETE, HEAD) com 404. Simulado com `VERCEL=1` num `next start` local; comportamento real na Vercel não medido |
| 16 | passou | `cd web && npm run test:unit` | `fechamento/web-unit.txt`: `ℹ tests 171`, `ℹ pass 171`, `ℹ fail 0`; `admin-agregacao.test.ts`: "critério 16: conjunto fabricado, todas as UFs", "critério 16: propriedade com 400 fichas aleatórias (semente fixa)" | |
| 17 | passou | idem | `admin-agregacao.test.ts`: "critério 17: duas fontes = 1 ficha; Câmara e mandato no mesmo município = 2", "critério 17: mesma ficha com territórios diferentes vai a conflitos, não ao mapa" | |
| 18 | passou | idem | `admin-agregacao.test.ts`: "critério 18: sem território nunca no mapa; todas em Ver registros com motivo" | Conferido só na função pura e no HTML do servidor; renderização no navegador não executada |
| 19 | passou | `node web/e2e-admin/sem-navegador.mjs --sem-build` | `central-sem-navegador.txt`: `ok 19 [v2] painel coleta: JSON da API igual ao da CLI (15 totais; valor, de e ids iguais em 15)`, `ok 19 [v2] painel revisao: ... (14 totais ...)`, o mesmo para `[v1]`, e `ok 19 [v2] HTML de /admin?rodada= painel coleta: 15 totais escritos "V de D" e "Ver registros (n)", iguais aos da CLI` | Rodadas SIMULADAS. Compara a rodada v1 e a v2 do banco `admin_coleta_c7` |
| 20 | passou (banco, CLI e HTTP); a mensagem de tela só no navegador | Suíte; `sem-navegador.mjs` | `etl/tests/test_admin_pedidos.py::test_criterio_20_dois_cliques_na_recoleta_geram_um_pedido_so`, `::test_criterio_20_a_central_insere_como_admin_central_e_o_segundo_e_recusado`; `central-sem-navegador.txt`: `ok 2º POST igual: mesmo id e novo=false`, `ok select count(*) em adm_pedidos = 1 pedido (ativo, na_fila) para a chave`, `ok o mesmo pedido feito pela CLI ... devolve o MESMO id` | `AVISO 20/estado pedido_existente`: o `<p data-estado="pedido_existente">` só nasce no navegador; provados a resposta `novo:false` e a regra `estadoDoPedido`. Spec `acoes.spec.ts` não executada |
| 21 | não executado | `cd web && NEXT_DIST_DIR=.next-admin ADMIN_DATABASE_URL='postgres://admin_central:<senha local>@localhost:54329/admin_coleta_r1' npx playwright test -c playwright.admin.config.ts` (fora do sandbox, executor em outro terminal) | Sem prova de execução. Spec escrita: `web/e2e-admin/*.spec.ts`, `--list` com 43 testes | Playwright não abre no sandbox (AC-05). O fluxo dos passos 6 a 9 foi provado só pela API: `sem-navegador.mjs --fluxo` e `primeira-rodada.sh` (`primeira-rodada-segunda-execucao.txt`: `resultado: tudo passou`, SIMULADO). A medida de "até 10 s a partir da gravação, sem recarregar" NÃO foi feita |
| 22 | passou | Suíte; `sem-navegador.mjs` | `etl/tests/test_admin_parecer.py::test_critério_22_gerar_nao_altera_nenhuma_tabela_de_dominio`; `etl/tests/test_admin_pedidos.py::test_criterio_22_pedido_de_parecer_nao_altera_tabela_de_dominio`; `central-sem-navegador.txt`: `ok [pedido gravado pela central] retrato depois idêntico em 102 tabelas (contagem e md5 do conteúdo ordenado)`, `adm_pareceres ganhou 3 linha(s) e todas têm simulado = true` | Mutação do reverificador (volta ao motor real): teste fica vermelho (`1 passed, 1 error`); fixture com chave de API falsa (AC-21 G2-1, AC-22). Fora do alcance: a central altera domínio por desenho em rodada e em decisão de pessoa com `aplicar` (relatório Opus da Parte C, G2) |
| 23 | passou parcialmente | `node web/e2e-admin/sem-rede-externa.mjs`; `sem-navegador.mjs` | `fechamento/sem-rede-externa.txt`: `RESULTADO: tudo passou (3 s)` | Prova estática (fonte, HTML e chunks) mais lista de exceções escrita à mão; não observa requisição em execução. O teste de navegador que falha em qualquer requisição fora de `localhost` (`web/e2e-admin/rede.spec.ts`) não foi executado (AC-05). O furo de saída de servidor G1-3/N1 (URL do banco) foi corrigido |
| 24 | passou parcialmente | `sem-navegador.mjs` | `central-sem-navegador.txt`: `ok 24 HTML de /admin: nenhum <circle> e nenhum elemento de cluster`, `ok 24 fonte do mapa: cada território é um link com aria-label e <title> "<nome>: <contagem>"`, `rótulos que o componente monta ...: "RO: Rondônia: 4 fichas"`; `admin-mapa.test.ts` ("código-fonte do mapa: sem círculo, elipse, cluster, ...") | `AVISO 24 limite`: o mapa é componente de cliente e a malha `/geo/*.json` é buscada num `useEffect`; o HTML do servidor não traz os `<path>`. O rótulo renderizado de cada território só o Playwright prova (`acessibilidade.spec.ts`, não executado) |
| 25 | `next build` passou; conjunto ponta a ponta público não executado | `cd web && DATA_SOURCE=demo ALLOW_DEMO_DATA=1 NEXT_TELEMETRY_DISABLED=1 npx next build`; `git diff --name-status 39ee3ec..HEAD -- web/e2e web/playwright.config.ts`; `cd web && npx playwright test --list` | `fechamento/next-build-ci.txt`: exit 0, rotas `/admin` dinâmicas (`ƒ /admin`, `ƒ /admin/api/estado`); diff vazio em `web/e2e` e `web/playwright.config.ts`; `--list` público lista 809 testes | AC-05 e `admin-coleta.md` escrevem "não atendido" na parte de execução; aqui está como "não executado" com o substituto atendido. O conjunto público nunca foi rodado nesta sessão, nem na linha de base |
| 26 | não executado | Mesmo comando do 21 (`capturas.spec.ts`) | Nenhuma captura existe: não há `central-<visao>-<largura>.png` em `replica/prompts/evidencias/` | AC-05 |

### Resumo da tabela

- passou: R-3, R-4, R-6, R-8, R-9, R-10, 1, 2, 3, 6, 7, 8, 10, 12, 13, 16, 17, 22; com ressalva nomeada: R-1, R-2, 4, 5, 9, 11, 18, 19, 20.
- passou com exceção aprovada pelo dono: 15.
- substituído: R-5 (parte), R-7, 14 (o literal falhou).
- passou só em parte: 23, 24; o 25 tem build passando e conjunto público não executado.
- não executado: 21, 26.
- critérios sem nenhuma execução em navegador: 21, 24 (parte), 25 (parte), 26, mais as specs que apoiam 15, 20, 23.

## 3. Decisões tomadas sem consultar o dono, do mais difícil de desfazer ao mais fácil

Exceção ao "sem consultar": a do item 8 (TRACE) foi aprovada pelo dono; entra aqui porque o reverificador a deixou para ele.

1. Migrações `0150` a `0155` (AC-03, AC-12, AC-15, AC-16, AC-19, AC-21, AC-22). Migração aplicada em produção não se edita (`db/migrate.sh` falha por checksum). Nada foi aplicado em produção. Conteúdo:
   - `0150`: modelo `adm_*`, gatilhos de override em `sapl_houses`, `data_coverage` e `mandate_contacts` (AC-03). Em produção isso reescreve valor de job em tabela existente quando há override. É a leitura mais discutível da restrição 4 ("só aditiva"); o segundo verificador do plano a deixou como "risco de interpretação" e a alternativa (a) (override lido pelo job) foi descartada por editar três coletores. Custo medido na A1 com 33 mil linhas de `data_coverage`: 49 ms sem gatilho contra 115 ms com gatilho (linhas já existentes), 288 contra 337 ms (linhas novas). Fonte nova `curadoria` em `sources`.
   - `0151`: o gatilho passa a anotar em `adm_overrides` o último valor que o job tentou gravar (AC-12); troca duas funções da `0150` por `create or replace`.
   - `0152`: guard com `public.pipeline_switches` e `search_path` fixo; gatilhos que exigem a linha `on` para decisão de agentes em `adm_overrides` e `adm_vinculos`; gatilho em `mandate_contacts` que reaponta override na fusão de pessoa (AC-15, AC-16). `merge_person` não foi alterado.
   - `0153`: role `admin_central` (RLS, grants mínimos, `adm_pedidos_decisao`); `insert` só em `adm_pedidos` e `adm_pedidos_decisao` (AC-19). Mais estrito que a especificação.
   - `0154`, `0155`: policy RESTRICTIVE que limita `criado_em` a uma janela de 5 s, primeiro por `now()`, depois por `clock_timestamp()` (AC-21 G4-1, AC-22 N2).
   - Role é do cluster: o `admin_central` com login existe em todo o cluster local, incluindo o banco `civico` do mesmo servidor, sem grant nele; `pg_hba` local em `trust`; o role tem `CONNECT` e `TEMP` em todo banco do cluster (AC-19, G4-2).
2. Decisão pela tela é um pedido, nunca escrita direta; o executor decide como pessoa (AC-19) e a forma canônica do pedido e da `chave_idem` é a do executor Python, com vetores de ouro (AC-20). Leituras do executor aceitas: `aplicar` entra na chave da decisão; rodada `interrompida` termina o pedido `interrompido`; recoleta só força URLs que são entrada da prévia; decisão e aplicação na mesma transação. Recoleta de `contato_mandato` roda `parlamento.extras` sem recorte territorial.
3. `corrections` (tabela pública, hoje sem leitor no site) recebe linha quando a decisão aplicada troca um valor existente; o texto de `reason`, escrito por quem decide, vira público (AC-12). Contato aprovado como está não troca de fonte para `curadoria`; contato suprimido não volta; descartar a pendência de um contato novo não remove o contato que o job já inseriu.
4. `web/src/middleware.ts` novo (AC-21 G1-1, G1-4, G1-5): matcher só `/admin` e `/admin/:path*`, runtime nodejs, importa só a regra pura `guarda-regra.ts`; responde 404 a qualquer método e exige Host local. O reverificador mediu o site público com status e tamanho idênticos com a central ligada e desligada, sem cabeçalho `x-middleware-*`.
5. Catálogo declarativo e contrato comum sem mover nenhum arquivo do ETL (AC-02, D325). Substitui a reorganização por classe que o prompt sugeria; custo: o catálogo repete URLs, tabelas e 7 consultas de leitura que espelham os jobs, e nenhum teste pega URL ou tabela declarada errada (AC-08).
6. `etl/civico_etl/http.py` (+130) com `ETL_ATTEMPT_LOG`, `ETL_HTTP_OFFLINE`, `ETL_HTTP_REFETCH`, e `cli.py` (+5) com o subcomando `admin`; opt-in por variável, sem as variáveis o comportamento é o de antes (`test_admin_tentativas.py::test_sem_variaveis_nada_e_registrado_e_o_resultado_e_o_de_sempre`). Sem AC próprio; vem do plano, seção 4.1.
7. Regras de proposta (AC-12, AC-13): a origem da proposta é a comparação antes e depois do coletor; `aprovar` com fontes divergentes é recusado; hash da falha sem horário e com todo 5xx igual; `cobertura.reason` só entra junto com mudança de `status` ou `evidence_url`; duplicata de pessoa NÃO abre pendência automática (exigiria regra de identidade nova, restrição 8), então o item "possível duplicata: registre indícios e vínculo proposto" sai entregue em parte; a aplicação por `merge_person` depois de decisão existe e é testada com pendência fabricada. `reprocessar` das Assembleias do SAPL refaz a sondagem, não a carga (AC-10).
8. TRACE em `/admin/*` com a central fechada responde 500, não 404 (AC-21, AC-22). Aprovado pelo dono em 2026-11-17 ("Aceitar exceção"). Alternativa recusada: sufixo `.admin.tsx` e `pageExtensions` condicional ao `ADMIN_CENTRAL=1` no build, que mexeria no `next.config.ts` compartilhado e renomearia todos os arquivos da central.
9. Substituição e rebaixamento de critérios, por impossibilidade no ambiente: R-5 (AC-04), 14 (AC-07, AC-17), 21 e 26 não executados e 25 não executado (AC-05). AC-17 também aceita três desvios do roteiro (município fabricado sem prefeito; AM sai como falha por robots no reprocessamento; edição candidata mostra pendência cujo candidato já é o valor vigente) e esclarece o rótulo "registros alterados".
10. Ambiente e processo: Postgres local do dono, banco dedicado, sem contorno do sandbox (AC-01); plano seguiu depois de duas reprovações, sem terceira verificação (AC-06); orquestrador passou de Fable 5.2 para Opus 5.5 por decisão do dono (AC-14); definição de "registro alcançado" e marca SIMULADO (AC-11); lançador simulado grava o cenário na própria rodada.
11. Incidentes registrados (sem decisão de desfazer): AC-09 (duas rodadas de teste da A2 caíram no banco `civico`, vazio, 0 tabelas, sem dano; regra 3a violada por subagente, verificado por leitura do catálogo) e AC-11 (a A6 gravou 2 linhas em `ingest_runs`, 1 em `dataset_stamps` e a fonte `sapl-ale` no `admin_coleta`; apagadas por id e conferidas).

Fácil de desfazer: todo o resto é `git revert`. Migração aplicada no banco local não volta só com o revert (`drop trigger`, `drop policy`, `drop role` e `drop table` por AC-03, AC-12, AC-19 e AC-21).

## 4. Achados dos verificadores e destino de cada um

Os relatórios dos verificadores do plano e das Partes R e B estão na pasta de notas da sessão (`.../side-session-notes/local_6b965c3b-.../verificacao/`), fora do repositório. Os da Parte C estão em `verificacao/parte-c-opus.md` e `parte-c-opus-v2.md` dentro do worktree.

### Plano (dois verificadores, ambos REPROVARAM; AC-06)

| Achado | Destino |
| --- | --- |
| v1 B1 exemplos do catálogo incompletos, lista de coletores sem teste vaga | corrigido no plano (`08ba9ad`) |
| v1 B2 R-5 inexequível (3 fontes criadas pelo job) | corrigido: AC-04, R-5 substituído |
| v1 B3 tarefas sem comando de pronto | corrigido em parte em `08ba9ad`; resíduo nos verificadores e na C9 reaberto em v2 V1 e corrigido em `ce1316a` |
| v1 B4 escritor `derive_stats` faltava na tabela do item 2 | corrigido; custo do gatilho medido na A1 |
| v1 N1 a N6 (contagem 27/28, `SkipUnchanged`, gatilho, `http.py`, executor morto, estados de tela) | corrigidos no plano |
| v2 V1 verificadores e C9 sem comando executável | corrigido em `ce1316a` |
| v2 V2 três furos do modo offline (robots 404 sem cache, `BaseException` deixa o run `running`, fixture não chega ao subprocesso) | corrigido em `ce1316a` |
| v2 N12 bloco do registro sem coluna que guarde o delimitador (não auditável depois) | sem destino registrado |
| Objeção mantida (AC-06): gatilhos em tabelas existentes não são "tabelas e colunas novas" | anotado como risco em AC-03 |
| Versão final do plano | nenhum verificador a leu (AC-06) |

### Parte R (`parte-r.md`, `parte-r-v2.md`, Sonnet; correções em `3758712` e `97c7930`)

| Achado | Destino |
| --- | --- |
| 1 R-7 falso no código; BUG-056 com `except` errados | corrigido o texto do BUG-056 e adicionado teste com `db.run` real só para `ibge.populacao`; resto anotado (AC-08) |
| 2 D324 colide com o `main` | corrigido: renumerada para D325 em `97c7930` |
| 3 referências imprecisas (`_PAGINA_SAPL`, `--ibge`) | corrigido |
| 4 `assert` em código de produção do catálogo | corrigido: `RuntimeError`, com teste |
| 5 SELECTs e listas de URL e tabela duplicados, sem teste de fumaça | anotado (D325, AC-08); não corrigido |
| 6 `_runner_em_processo` descarta o texto do `SystemExit` | corrigido (texto em stderr) |
| 7 `banco_isolado` supõe um processo de teste por servidor | aceito (AC-08) |
| 8 testes fracos (`_casa`, orquestradores só veem 7 comandos, 15 de 24 sem caracterização) | anotado (AC-08); não corrigido |
| v2 N1 os 7 SELECTs de leitura não constavam no relato | listados na AC-08 |
| v2 N2 linha da R11 no estado cita D324 | sem destino registrado |
| v2 N3 "PR 50" na D325 não confirmado | sem destino registrado; o texto da D325 em `decisions.md` ainda cita "PR 50" |
| v2 N4 teste de entrada inalterada acoplado a helpers privados | sem destino registrado |
| v2 N5 critério R-7 continua com a frase falsa no plano | anotado no relato (R-7 acima) |

### Parte B (Sonnet para 4, 5 e 11; Opus para o 9; reverificação Opus do 9)

| Achado | Destino |
| --- | --- |
| Sonnet A1 rodada órfã em `em_andamento` para sempre (critério 5) | corrigido em `ac43528` (`BaseException`, `admin rodada recuperar`, trava consultiva) |
| Sonnet A2 override de contato não acompanha a fusão (critério 11) | corrigido em `ac43528` (AC-16, gatilho; `merge_person` intocado) |
| Sonnet B1 a B5 testes fracos (identidade, `reavaliar`, `base_url` de Câmara, recorte intacto) | AC-15 decidiu reforçar; B1 declarado como limite (AC-13); o teste do `sapl.descobrir` real não foi localizado |
| Sonnet C1 hash da falha com `http_status` | aceito e ajustado: todo 5xx conta como um desfecho (AC-15) |
| Sonnet C2, C3, C4 (chave sem tempo, "reaproveitada" depende de cache, cabeçalho da `0151`) | sem destino registrado |
| Opus 1 porta `ambiente=` quebra o critério 9 na letra | corrigido em `ac43528` |
| Opus 2 agente pode se passar por pessoa (`admin decidir --por <nome>`) | NÃO corrigido; risco residual (c) em AC-15; a primeira rodada simulada usa esse caminho |
| Opus 3 tabela temporária sombreia `pipeline_switches` | corrigido na `0152` |
| Opus v2 N1 a primeira chave só existe no processo Python | declaração (d) completada em AC-18; sem correção |
| Opus v2 N2 `env_extra` podia carregar a variável | corrigido em `baeb07d` (`test_N2_env_extra_nao_pode_ligar_a_chave_dos_agentes`) |
| Opus v2 achados 5 a 7 (efeito de identidade e duplicata sem guarda própria; lacunas de teste; `adm_pareceres` mutável) | anotados como risco residual (AC-18) |

### Parte C (Opus `parte-c-opus.md`, reverificação Opus `parte-c-opus-v2.md`)

| Achado | Destino |
| --- | --- |
| G1-1 RSC responde 200 com a central fechada | corrigido em `51463d1` (middleware); confirmado pelo reverificador |
| G1-2 OPTIONS 400 e TRACE 500 | OPTIONS corrigido; TRACE aceito como exceção pelo dono (AC-22) |
| G1-3 `?host=` na URL do banco | corrigido em `51463d1`; reverificador achou o fragmento `#` (N1), corrigido em `4f41947` |
| G1-4 Host não conferido nos GET | corrigido em `51463d1` |
| G1-5 título e robots do 404 da central | corrigido no matcher do middleware |
| G1-6 chunks JS da central servidos com ela fechada | anotado, não corrigido (código, sem dado) |
| G2-1 teste do 22 cego à volta ao motor real | corrigido em `51463d1`; mutação do reverificador deixa o teste vermelho |
| G2-2 `base_url` aceita qualquer http(s) | anotado, não corrigido |
| G2-3 `unir` não preso ao par da pendência | anotado, hoje inalcançável (nenhum código cria pendência `duplicata`) |
| G2-4 `por_nome="agentes"` aceito como texto | anotado, não corrigido |
| G4-1 policy deixa o cliente escolher `criado_em` e `chave_idem` | corrigido: `0154` e executor que recalcula a chave; janela por relógio na `0155` (N2) |
| G4-2 login do `admin_central` vale para o cluster inteiro, `trust` | anotado, não corrigido |
| G4-3 o role troca a própria senha | anotado |
| G4-4 comentário da `0153` diz "onze" e lista doze tabelas | anotado; a `0153` não se edita |
| G3 prova de rede é estática; `rede.spec.ts` não rodou | anotado (critério 23) |
| N1 (reverif.) `#` na URL do banco | corrigido em `4f41947` |
| N2 (reverif.) janela da `0154` usa `now()` | corrigido em `4f41947` (`0155`) |
| N3 JSON canônico TS e Python divergem para `valor` com notação exponencial ou fora do BMP | anotado, não corrigido; a decisão `corrigir` com esse valor falha por chave divergente |
| N4 pedido forjado ocupa a `chave_idem` do legítimo | anotado, não corrigido (negação de serviço local) |
| N5 dois cabeçalhos Host | anotado |
| Crítica: o roteiro aceitava TRACE 500 como `ok` | corrigido: sai como `AVISO EXCEÇÃO` à parte |

## 5. Contagem de subagentes, por modelo e por fase, contra o teto

| Fase | Teto | Usados | Haiku | Sonnet | Opus | Subiram de modelo |
| --- | --- | --- | --- | --- | --- | --- |
| R | 16 | 16 | 4 (R1, R5, R9, R11) | 12 | 0 | 0 |
| A | 14 | 6 | 0 | 6 (A1 a A6) | 0 | 0 |
| B | 16 | 10 | 0 | 8 (B1, B2, B3a, B3b, B4, B5, B6 e o verificador de 4, 5 e 11) | 2 (verificador do 9 e reverificador) | 0 |
| C | 20 | 15 | 1 (C10) | 11 (C1 a C9, C11, este rascunho) | 2 (verificador da Parte C e reverificador) | 0 |
| Total | 66 | 47 | 5 | 37 | 4 | 0 |

O 15 da fase C inclui este rascunho e um verificador do relato, ainda a lançar, de modelo não definido nas fontes (1 dos 47, fora das colunas de modelo). Todas as fases abaixo do teto; nenhuma passou de 50% acima dele (item 4 da lista de parada).

Inconsistência nas fontes: a AC-08 diz R "16 de 16 (11 de construção, 1 de correção, 2 verificadores)", o que soma 14. O 16 vem do estado e do prompt de fechamento; a soma da AC-08 não fecha. A divisão Haiku 4 e Sonnet 12 da fase R vem de "Haiku: R1, R5, R9, R11; Sonnet: as demais".

Retomadas: R1 a R3 (limite de uso, sem novo lançamento), A6 (uma vez, defeito do briefing), B3a (duas), B3b (uma). R9 devolveu duas perguntas antes de escrever. Nenhuma tarefa reprovada na R; nenhuma subiu de modelo em fase nenhuma.

O que o orquestrador fez ele mesmo (sem subagente):
- R: integração dos três lotes em `COLETORES` e quatro ajustes de comentário.
- A: três ajustes (URL da fonte `curadoria` na migração antes de aplicá-la, um teste da A3 que fixava o conjunto exato de subcomandos, `etl/admin-rodadas/` no `.gitignore`).
- B: ajuste do `env_extra` (`baeb07d`) e a correção das decisões AC-15 e AC-16.
- C: conciliação AC-20 (forma dos pedidos e da `chave_idem`, `c833d51`); correção D1 (jsonb duplamente codificado) e stubs 404 dos métodos não usados (dentro do commit da C7); correção do executor apontada pela suíte (`test_admin_chaves.py::test_A`, `4177751`); ajuste do `--fluxo` (checagem vazia de município); C12 (N1 guarda e pool contra o driver; N2 migração `0155`).

Modelo do orquestrador: Fable 5.2 até a B4 (`50f96af`), Opus 5.5 depois (AC-14).

## 6. Linha de base (o que já falhava ou já pulava antes da entrega)

Medida em `39ee3ec` com `admin_coleta` preparado (migração, `seed`, `base.sql`); saídas na pasta de notas, `linha-de-base/`.

| Item | Antes | Depois (HEAD `9177692`) |
| --- | --- | --- |
| Suíte do ETL | `767 passed, 33 skipped, 4 xfailed` | `1374 passed, 33 skipped, 4 xfailed in 521.70s`, exit 0 (607 testes a mais) |
| Pulos (33) | `test_agenda.py:57`; `test_assembleias.py:51`; `test_contas_origem.py:119`, `:143`; `test_cota.py:60`, `:107`; `test_governadores.py:32`, `:37`, `:46`; `test_identity_bug032.py:63`; `test_identity_bug033.py:61`, `:79`, `:92`; `test_identity_bug035.py:56`, `:73`, `:87`; `test_identity_bug038.py:41` (4); `test_identity_bug041.py:49` (4); `test_identity_repairs.py:196`, `:210`, `:225`; `test_launchd_sapl_prod.py:148`; `test_partido_desempate.py:15`; `test_salaries.py:53`; `test_senado_secretas.py:34`; `test_tse_bug019.py:95`; `test_upsert_condicional.py:89` | os mesmos 33, nenhum em teste novo |
| `civico-etl check` | código 1, 5 invariantes quebradas (câmara 513, senado 81, cota, UF governador titular, UF governador e vice) | código 1, as mesmas 5 |
| `python3 -I replica/tools/fluxo_confere.py` | código 1, 7 problemas | código 1, os mesmos 7 |
| web: `eslint src`, `tsc --noEmit` | 0 e 0 | 0 e 0 |
| web: `npm run test:unit` | 82 pass, 0 fail | 171 pass, 0 fail |
| `next build` nas condições do CI | código 0 | código 0, rotas `/admin` dinâmicas |
| Conjunto ponta a ponta público | não roda no sandbox | não roda no sandbox |

Diff `39ee3ec..HEAD`: nada em `.github/`, `etl/deploy`, `etl/agenda`, `web/src/lib/data`, `web/src/lib/db`, `web/package.json`, `web/next.config.ts`, `web/playwright.config.ts`, `web/e2e/`. No ETL fora de `admin/` e `catalogo/` só `cli.py` (+5) e `http.py` (+130). No web só a central (`app/(admin)`, `lib/admin`, `components/admin`, `styles/admin.css`, `middleware.ts`, `e2e-admin`, `playwright.admin.config.ts`, testes `admin-*`). Nenhum teste existente antes da entrega foi alterado.

## 7. Passos que ficam para o dono

1. Revisar e subir: `git push` da branch e abrir o PR (github.com está bloqueado no sandbox).
2. Renumerar se o `main` andou. Conferido na ref local `origin/main` (`0676b84`, 17 commits à frente de `39ee3ec`; a ref pode estar velha, `fetch` é do dono):
   - decisões: o `main` já tem D325 a D331 de outros assuntos (D325 "Pessoas e Votações à vista no celular", D326 "Topo do desktop", e seguintes). Esta entrega gravou D325 (catálogo) e D326 (gatilho de override) em `replica/decisions.md`, e as cita em `replica/admin-coleta-decisoes.md` e `replica/admin-coleta-estado.md`. Colisão certa: renumerar para a primeira livre depois da última do `main` (D332 em diante na ref local) e ajustar as duas referências.
   - migrações: na ref local o `main` não trouxe migração nova depois de `39ee3ec`; `0150` a `0155` seguem livres. Se outra branch ocupar o número, renumere antes de qualquer aplicação (migração publicada não se edita).
   - bugs: o `main` termina em BUG-055; BUG-056 a BUG-060 desta entrega não colidem na ref local.
3. Aplicar `0150` a `0155` em produção, depois de estender `replica/runbook-migracoes-producao.md`, que hoje só cobre `0130`, `0131`, `0140` e `0141` e diz que produção está em `0120_raw_copy.sql`. Pontos a tratar:
   - a `0142_drop_expenses_supplier_doc_idx.sql` já estava no ponto de partida e o `main` ainda não a tem; em produção ela consta pendente e vira no-op (`replica/decisions.md`, bloco da D314). O runbook deve cobri-la ou ser conferido contra ela;
   - `replica/admin-coleta.md` (seção 5) diz "0150 a 0153" e "AC-19 e AC-20": está defasado, a entrega vai até a `0155` e a AC-22. Corrigir antes de usar como roteiro;
   - ordem e risco por migração: itens 1 e 2 da seção 3 acima; gatilhos em tabelas existentes e role `admin_central` são o risco maior;
   - em produção, definir senha e `pg_hba` do `admin_central`: o login local de desenvolvimento (`db/local/post_0003_admin_central.sql`) é só local.
4. Rodar o Playwright fora do sandbox, para 21, 24 (rótulo renderizado), 25 e 26:
   - da pasta `web/`: `npx playwright install chromium chromium-headless-shell`;
   - conjunto público: `npx playwright test` (`--list` lista 809 testes);
   - central: `bash ../replica/prompts/evidencias/primeira-rodada.sh`, depois `NEXT_DIST_DIR=.next-admin npx next build`, depois `NEXT_DIST_DIR=.next-admin ADMIN_DATABASE_URL='postgres://admin_central:<senha local>@localhost:54329/admin_coleta_r1' npx playwright test -c playwright.admin.config.ts` (comando do topo de `web/playwright.admin.config.ts`);
   - o critério 21 exige o executor (`admin executor`) rodando em outro terminal; as specs não o sobem;
   - as capturas do 26 saem em `replica/prompts/evidencias/central-<visao>-<largura>.png`; commitar.
5. Primeira rodada real, com rede: a entrega só rodou a rodada SIMULADA. Nenhum número de coleta foi lido de fonte real.
6. `liberar-sandbox-local.sh --desfazer` para restaurar `sandbox.network.allowLocalBinding` (AC-01).
7. Apagar as sobras sem rastreio: `web/playwright-report-admin/`, `web/.next-reverif/`, `web/.reverif-url.mts` (a remoção foi negada aos agentes). `liberar-sandbox-local.sh` fica até o item 6.
8. Para publicar a central (não feito, não há nada pronto): autenticação do operador; papel de admin separado do usuário comum do site; auditoria de quem pediu (`por_nome` é texto livre, não identidade); hospedagem fora da Vercel pública ou proteção equivalente, porque a guarda depende de `VERCEL`, `VERCEL_ENV` e URL local, que um túnel ou deploy sem essas variáveis contorna; papel de banco por pessoa, com `decidido_por_nome = current_user` por gatilho (única correção que fecha o risco (c) da AC-15).
9. Decidir se a exceção de TRACE (AC-22) vale também para produção ou se faz a alternativa por `pageExtensions`.

## 8. Riscos residuais anotados, não corrigidos

AC-18 (critério 9, fim da Parte B):
- a primeira chave (`ADMIN_COLETA_AGENTES`) só existe no processo Python; com a linha `on` em `pipeline_switches`, um `update` comum com o papel do ETL marca decisão de agentes como aplicada sem a variável e sem desligar gatilho;
- o papel do ETL é dono das tabelas: pode desligar gatilho ou gravar em `pipeline_switches`; a chave do banco não é fronteira contra ele;
- um agente de IA pode rodar `admin decidir --por <nome> --aplicar` como "pessoa" (a CLI não autentica); a primeira rodada simulada usa esse caminho com "Operador de Ensaio (SIMULADO)";
- efeito das classes identidade e duplicata sem guarda própria no banco (só passa por `aplicar`);
- funções `adm_override_*` das `0150` e `0151` leem `adm_overrides` sem esquema (não decidem sobre agentes);
- o gatilho de fusão move override sem reconferir a chave;
- `adm_pareceres` é mutável;
- o teste de assinatura não pegaria um parâmetro novo de nome não suspeito nem uma global inativa.

AC-21 (anotados, sem correção):
- `base_url` corrigido por pessoa aceita qualquer http(s), inclusive endereço interno, que o coletor depois busca;
- `por_nome="agentes"` é aceito como texto e vai para `identity_match_queue.resolved_by`;
- login local do `admin_central` vale para o cluster inteiro, com `pg_hba` em `trust`; o role pode trocar a própria senha;
- comentário da `0153` diz "onze" tabelas e lista doze (a `0153` não se edita);
- chunks JS da central são servidos com ela fechada (código, sem dado);
- `OPTIONS /` público responde 400 (fora do escopo);
- o role lê `identity_match_queue.raw`; se houver dado pessoal, vaza pelo Host, hoje fechado.

AC-22:
- TRACE em `/admin/*` com a central fechada responde 500 e revela que o prefixo existe (exceção aprovada); o reverificador inferiu, sem medir, que antes do middleware as páginas davam 404 para TRACE;
- N3: a decisão `corrigir` com `valor` em notação exponencial ou fora do BMP falha por chave divergente, sem efeito;
- N4: pedido forjado com a chave de um legítimo ocupa a chave e o executor o falha (negação de serviço local);
- N5: dois cabeçalhos Host, o local primeiro: o Node fica com o primeiro; navegador não envia.

Outros, vindos das fontes:
- tempo da suíte: 521,70 s nesta máquina com os bancos isolados por arquivo de teste; a AC-19 registrou 13 minutos numa execução e o plano cita teto de 15 min para o job do CI. O tempo no CI não foi medido, e o `ci.yml` não foi alterado;
- R-7 (acima), 15 de 24 coletores sem teste que chame a entrada, cinco módulos sem caracterização;
- duplicata de pessoa: sem abertura automática de pendência (AC-13);
- 21, 26 e a parte de navegador de 20, 23, 24 e 25 dependem de execução que só o dono pode fazer; até lá a central não tem prova de comportamento em navegador;
- o relato da Parte B (critério 5) e a correção do critério 11 não passaram por reverificação independente própria; só o critério 9 teve segunda rodada;
- nenhum dado simulado deve ser lido como dado da fonte: SAPL fabricado, município `1190099` fabricado.
