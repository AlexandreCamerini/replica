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
- Materializa: seção 2 do plano; migração `0150` (fase A).
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
