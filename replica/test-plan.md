# Test plan: clone cívico

Build: e07184b → esta rodada (commit do replica-test)  Date: 2026-11-02  Env: local, dados de demonstração determinísticos (`DATA_SOURCE=demo`, porta 3200) e passada manual com dados reais (`E2E_BASE_URL=http://localhost:3101`).

Regra: testa-se o clone. Nenhum teste toca o site original.

Como rodar:

```bash
cd web && PLAYWRIGHT_BROWSERS_PATH=../.local/pw-browsers npx playwright test            # demo, sobe o servidor sozinho
cd web && E2E_BASE_URL=http://localhost:3101 PLAYWRIGHT_BROWSERS_PATH=../.local/pw-browsers npx playwright test   # dados reais
```

Toda spec falha em erro de console, resposta 5xx e violação do axe nas telas visitadas (`e2e/fixtures.ts`).

Resultado da rodada final (build de produção, 2 workers): 38 casos automatizados, 34 passaram de primeira, 3 passaram na repetição (navegação por link sob carga: F01-E6 mobile, F02-H1, F02-E1), 1 corrigido no teste e verificado (F03-H1). Invariantes do banco (`civico-etl check`): 10 de 10. Nenhum S1 aberto.

| case | flow | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- | --- |
| F01-H1 | eleitor acha quem o representa | happy | /representantes → digita "campi" → escolhe "Campinas · SP" → abre o 1º crachá | S07 com 206 pessoas por nível; S05 com nome, cargo, mandatos, números com fonte | e2e | passou |
| F01-H2 | | happy, só teclado | Tab até a busca, digita, ↓, Enter, Tab até a pessoa, Enter | 3 ações; foco visível em cada passo | e2e | passou |
| F01-E1 | | edge: homônimos | digita "bom jesus" | 4 opções, cada uma com a UF | e2e | passou |
| F01-E2 | | edge: entrada vazia / 1 letra | foca e digita "c" | nenhuma lista; sem requisição com erro | e2e | passou |
| F01-E3 | | edge: entrada muito longa (80 caracteres) | cola 80 letras | sem 5xx; mensagem de "nenhum lugar" ou pedido para encurtar | e2e | passou |
| F01-E4 | | edge: acento | digita "sao" | acha "São Paulo" e "São Luís"… | e2e | passou |
| F01-E5 | | edge: sem JavaScript (link direto) | /representantes?q=Bom+Jesus | lista das 4 cidades com UF, servidor renderiza | e2e | passou |
| F01-E6 | | edge: largura 390 px | fluxo inteiro no celular | sem rolagem horizontal; alvos ≥ 44 px | e2e @mobile | passou (flaky sob carga: 1 repetição) |
| F01-E7 | | edge: voltar e atualizar no meio | S07 → S05 → voltar → F5 | S07 volta com a mesma cidade (estado na URL) | e2e | passou |
| F01-N1 | | negative: IBGE inválido | /representantes?cidade=123 | 404 com página própria | e2e | passou |
| F01-N2 | | negative: UF inválida | /representantes?uf=ZZ | 404 | e2e | passou |
| F01-N3 | | negative: slug inexistente | /p/nao-existe | 404; slug antigo → 308 para o novo | e2e | passou |
| F02-H1 | navegar pelo mapa | happy | / → toca "SP" no mapa → Campinas na lista de cidades | S07 da UF; depois da cidade | e2e | passou (flaky sob carga: 1 repetição) |
| F02-H2 | | happy, teclado | Tab até o quadrado "São Paulo", Enter | S07 da UF | e2e | passou |
| F02-E1 | | edge: região e A–Z | link "Minas Gerais" por região; "Campinas SP" no A–Z | S07 correspondente | e2e | passou (flaky sob carga: 1 repetição) |
| F02-E2 | | edge: drill-down até cidade no mapa, Esc volta nível | — | **não construído** (grade por UF; contorno IBGE no R1+) | manual | pendente |
| F03-H1 | ler o crachá a fundo | happy | S05 de deputado federal → ano → filtra propostas por tema → abre link oficial → votos → gastos | números mudam com o ano; listas filtram; link oficial abre em nova aba com `rel=noopener` | e2e | passou (após corrigir o teste) |
| F03-H2 | | happy | "Ver mais N" em propostas | lista cresce; URL guarda o estado | e2e | passou |
| F03-E1 | | edge: pessoa sem casa carregada (vereador) | S05 de vereador | tiles "—" com motivo, nunca "0"; lista "faltam N dados"; teto do salário com "até" | e2e | passou |
| F03-E2 | | edge: nome com 60 caracteres | S05 da vereadora de nome longo | quebra de linha, sem corte, sem overflow | e2e @mobile | passou |
| F03-E3 | | edge: filtros combinados preservados | tema + voto + categoria na mesma URL | cada formulário mantém os outros | e2e | passou |
| F03-E4 | | edge: tema claro/escuro | S05 nos dois temas | axe 0 violações nos dois | e2e | passou (1 falha intermitente: hidratação, ver bugs.md) |
| F03-E5 | | edge: ano sem mandato | ?ano=1999 | ignora e mostra carreira | e2e | passou |
| F03-E6 | | edge: fontes | todo bloco de dados | "Fonte: … · atualizado em …" presente | e2e | passou |
| F03-N1 | | negative: parâmetros inválidos nas APIs do crachá | year=abc, cursor=-1, value=x, limit=999 | 400 com lista de erros; nunca 500 | e2e | passou |
| F04-H1 | comparar | happy | S07 → "Comparar" em 2 pessoas → bandeja "2 de 5" → Comparar | S08 com as duas colunas, grupos de linhas e "Votaram igual?" | e2e | passou |
| F04-H2 | | happy | adicionar 3ª pessoa pelo campo; tirar uma pela coluna | URL ?p= acompanha; tabela muda | e2e | passou (após corrigir o teste) |
| F04-E1 | | edge: 6ª pessoa | 6 slugs na URL; 5 marcadas e tentar a 6ª | aviso "limite é 5"; botão desabilitado com rótulo explicando | e2e | passou |
| F04-E2 | | edge: slug inválido e repetido na URL | ?p=a,a,nao-existe,b | repetido some; inválido removido com aviso; 2 válidas comparam | e2e | passou |
| F04-E3 | | edge: cargos diferentes | vereador x deputado | "—" no que não se aplica, sem erro | e2e | passou |
| F04-E4 | | edge: pessoas sem votação em comum | mesmo caso | "Nenhuma votação em comum" | e2e | passou |
| F04-E5 | | edge: seleção persiste | marca 2, F5, abre outra página | bandeja continua (localStorage) | e2e | passou |
| F04-E6 | | edge: só 1 pessoa | ?p=a | mensagem para adicionar mais uma + sugestões | e2e | passou |
| F05-H1 | monitorar | happy | S05 → "Acompanhar" → e-mail → código → volta → feed → preferências → deixar de acompanhar → apagar conta | volta ao crachá já acompanhando; feed com novidades; conta apagada some | e2e (E2E_PG) | passou |
| F05-E2 | | edge: segunda pessoa e volta maliciosa | dois usuários; `volta=//evil` | B não vê nada de A; redireciona para / | e2e (E2E_PG) + SQL | passou |
| F05-E1 | | edge: redirect `volta` malicioso | /entrar?volta=javascript:alert(1) e //evil | nunca vira link/redirect; hoje a tela é stub | e2e | passou |
| F05-N1 | | negative: código errado, e-mail inválido, 4º envio na hora | mensagens claras, sem revelar cadastro | e2e (E2E_PG) | passou |
| F06-H1 | compartilhar | happy | S05 → "Compartilhar" | sem Web Share: copia o link e avisa "Link copiado" (também para leitor de tela) | e2e | passou |
| F06-H2 | | happy | link "WhatsApp" | `https://wa.me/?text=` com nome e URL do crachá; nova aba com `rel=noopener` | e2e | passou |
| F06-E1 | | edge: card OG | /api/og/p/slug | **não construído** (R2) | manual | pendente |
| F07-H1 | acompanhar o Congresso | happy | /congresso | **não construído** (R2): stub com S09 e release | e2e (stub) | passou (stub) |
| F08-H1 | reportar erro / sugestão | happy | S05 → "Reportar erro" | leva a /sugestoes com tipo e pessoa na URL (stub R2) | e2e (stub) | passou (stub) |
| F08-N1 | | negative: mensagem curta, honeypot, 5/h por IP | erro de campo; robô recebe "ok" sem gravar | e2e (E2E_PG) | passou (curta); honeypot e limite cobertos no código |
| S04-H1 | diretório | happy | /quem → cargo + UF + letra + nome | lista filtra; contagem certa; paginação | e2e | passou |
| S04-E1 | | edge: filtro inválido | ?partido=xxx&letra=9 | ignorado sem erro | e2e | passou |
| S04-E2 | | edge: nenhum resultado | ?nome=zzzz | mensagem clara + "limpar filtros" | e2e | passou |
| SH-H1 | shell | happy | skip link, menu "Mais" por teclado, tema persiste após F5, aria-current na navegação | — | e2e | passou |
| SH-E1 | | edge: rota desconhecida | /xyz | 404 com navegação | e2e | passou |
| SH-E2 | | edge: largura 390 em /, S07, S05, S08 | — | sem rolagem horizontal | e2e @mobile | passou |
| NEU-1 | neutralidade | regra | /quem e S07 | ordem alfabética pt-BR, nunca por métrica | e2e | passou |
| NEU-2 | | regra | badges "Sim" e "Não" | mesma cor de fundo (nenhuma codifica bom/ruim) | e2e | passou |
| NEU-3 | | regra | hemiciclo (/design) | cadeiras com a mesma cor para todo partido | e2e | passou |
| NEU-4 | | regra | texto de /, S07, S05, S08 | sem "ranking", "nota", "melhor", "pior", "recomend" | e2e | passou |
| NUL-1 | null nunca vira 0 | regra | S05 de vereador e tile de votos recebidos com dado real | "—" com motivo; "0" só quando a fonte publica 0 | e2e + manual | passou (e2e) + corrigido no dado real (BUG-002) |
| API-1 | contratos | regra | /api/places, /api/people/*, /api/compare/agreement, /api/revalidate | validação (400), 401 sem segredo, 404 em slug, cache headers | e2e | passou |
| MAN-1 | dados reais | manual | home, Campinas, crachá de deputado, comparar, tema escuro, em 3101 | números plausíveis, fontes e datas certas | manual | passou (BUG-001, 002, 005, 007 achados e corrigidos) |
| MAN-2 | TTS | manual | "Ouvir a página" | começa a falar e o botão vira "Pausar"; some sem suporte | manual | passou |
