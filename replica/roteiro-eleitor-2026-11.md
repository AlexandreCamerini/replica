# Roteiro: o site como ferramenta do eleitor (entrevista de 25/11/2026)

Origem: entrevista de decisão com o dono, 25/11/2026, sobre como tornar o site mais intuitivo, fácil e interessante para o eleitor seguir o que os políticos fazem, gastam, custam e votam, e a rotina das casas. Base lida: `DECISIONS.md`, `replica/comparativo-v1-sv.md`, `replica/backlog-execucao-2026-11.md`, `replica/features.csv`, `replica/data-diff.md`, `web/src/app/(sv)/page.tsx`, `web/src/components/sv/shell.tsx`, `web/src/components/sv/escolhidos/quadro.tsx`, `db/migrations/0001_init.sql` e `0076_pauta.sql`. Não li `replica/design/` nem as rotas `pessoa`, `votacao` e `decisao` por inteiro: cada fatia confere o que toca.

Este arquivo é um roteiro de decisão. Nada foi construído, nenhuma decisão foi renumerada e nenhum dado foi coletado. Os números D344 em diante abaixo são propostas: quem registrar em `replica/decisions.md` atribui o número real.

## 1. Regras que valem para tudo

- Fato com fonte e data, nunca juízo. Sem ranking, média, nota nem comparação entre pessoas ou casas (D82, D342). Sem comparação de uma casa com ela mesma em outro mês.
- Lacuna nomeada onde o dado falta ou está velho, nunca zero nem "nada em pauta". Falha de leitura é diferente de "sem dado".
- O texto nunca diz que uma pessoa confere as respostas (D293).
- Voto nunca por cor. Uma só cor de quantidade. Alvo de 44 px (exceção D343 só para o SVG do mapa). Listas A–Z ou por data, nunca por tamanho.
- Dado que o eleitor informa fica no aparelho, exceto o que ele entregar ao assinar o resumo por e-mail.

## 2. Decisões por eixo

### Eixo A: seguir o político

| Id | DECIDIDO |
|---|---|
| A1 | Quem tem escolhidos abre a home pelo que mudou com eles desde a última visita. Quem não tem abre pelo convite de `/comecar`. A data da última visita fica só no navegador. |
| A2 | O feed "desde a última visita" agrupa por pessoa e por tipo, em contagem com link para o detalhe ("votou em 6 votações, apresentou 2 propostas, teve 31 gastos registrados desde 12/11"). O valor em reais acompanha a contagem de gastos. |
| A3 | Resumo semanal por e-mail, opcional: o eleitor informa o e-mail, confirma por link e não cria conta. Mesmo texto do feed agrupado. Cancelamento em um clique. E-mail e lista de escolhidos ficam no servidor. |
| A4 | Gasto ganha escala sem comparar pessoas, em duas fatias: (1) teto legal da cota ao lado do valor, só Câmara no começo; (2) série mensal da própria pessoa. |
| A5 | Em cada votação da pessoa, o voto aparece ao lado da orientação oficial da bancada. Sem soma, percentual nem "alinhamento". `liberado` aparece como "o partido liberou a bancada". |

ABERTO do eixo A:
- A1: a D316/D317 (sem conta, sem cadastro) precisa registrar que a data fica só no aparelho e nunca vai ao servidor.
- A2: regra para pessoa com 1 só evento (contar ou listar) e limite de pessoas antes de recolher.
- A3: revisar a D316/D317 (o "sem cadastro" deixa de valer para quem assina); consentimento explícito e política de privacidade (LGPD) com exclusão a pedido; domínio verificado no Resend (B8 e B9 do backlog, ainda pendentes); o texto nunca recomenda voto.
- A4: o teto varia por UF e por vigência; conjunto de dados novo (não existe hoje), verificado contra a fonte oficial antes de ir ao ar; fonte e data na tela; lacuna nomeada onde o teto não estiver carregado.
- A5: conferir se o site já lê `party_orientations` e `orientation_actors` (o ETL da Câmara já grava); como o Senado registra liderança; regra de exibição para orientação por bloco ou governo.

### Eixo B: "isso me afeta?"

| Id | DECIDIDO |
|---|---|
| B1 | A D339 é reaberta só no ponto "filtro por tema escolhido". O eleitor escolhe temas oficiais; o site filtra e ordena a pauta e as votações. Cada proposta mostra estado de checagem visível ("texto lido", "estimativa oficial de impacto disponível", "efeito na vida ainda não conferido"). Nenhum efeito personalizado por renda, cidade ou ocupação até a barra da §10 da verificação agêntica. |
| B2 | Em duas etapas: agora, ementa oficial mais glossário determinístico das leis e termos citados, começando pelas leis mais citadas na pauta, com lacuna nomeada onde a lei ainda não estiver no glossário; depois, resumo em linguagem simples escrito por agente, só quando a verificação agêntica passar a barra da §10. |
| B3 | O destino de uma votação aparece só para o que virou lei (número, data de sanção, resumo, link). `proposals.status` passa por tabela curada de termos oficiais; o que não for reconhecido aparece com o texto original e a fonte. Linha completa do caminho só quando houver dado de etapas de tramitação. |

ABERTO do eixo B:
- B1: registrar a reabertura parcial da D339 em `replica/decisions.md`, com o escopo exato; o tema escolhido só vai ao servidor para quem assinou o e-mail; cobertura de tema do Senado e das casas estaduais não conferida (sem tema oficial aparece "sem tema oficial", nunca classificado por nós).
- B2: o glossário precisa de dono, fonte e data de leitura de cada verbete e rotina de atualização. `proposals.summary_plain` ("reescrita determinística") pode ser a base; não vi se está preenchido nem a cobertura.
- B3: a tabela de status precisa de dono e de teste que acuse termo novo da fonte; "virou lei" nunca leva adjetivo.

### Eixo C: a rotina das casas

| Id | DECIDIDO |
|---|---|
| C1 | O custo da casa aparece em duas medidas lado a lado, com a diferença nomeada: o orçamento oficial no ano (dotação e valor pago, cada um com fonte e data) e a soma do que já ligamos a parlamentares (salários mais cota). Sem divisão por habitante. Só Câmara e Senado; casas estaduais e municipais com lacuna nomeada. |
| C2 | O planejamento olha só para o que a casa agendou, nunca projeção nossa. A pauta da semana vem filtrada pelos temas do eleitor, com data e casa, e mostra a pauta das comissões. Cada item traz a data da leitura. Pauta velha aparece em aviso destacado no topo, com a data da última leitura. |
| C3 | A visão da casa é a lista de votações em ordem cronológica, filtrada pelos temas do eleitor, com uma frase de resultado por votação ("Aprovada por 312 a 144"). Sem contagem do período, sem comparação com outro mês nem entre casas. Nota fixa no topo: "só votações com registro de voto por pessoa". |

ABERTO do eixo C:
- C1: a dotação orçamentária não está no banco; coleta nova, fonte oficial conferida e verificação contra ela antes de ir ao ar; a tela diz sempre qual valor mostra (dotação ou pago); o texto da diferença é escrito para não sugerir desvio.
- C2: o limite de horas para a pauta ser "velha" precisa ser escrito e testado depois de olhar o ritmo real da coleta; proposta só em comissão diz isso em linguagem simples.
- C3: a nota tem de ficar visível sem rolar, inclusive no celular.

### Eixo D: navegação e primeira visita

| Id | DECIDIDO |
|---|---|
| D1 | A primeira tela oferece três entradas por intenção: "Quem me representa?", "O que está em votação?" e "Quanto custa?". O convite de dois passos continua logo abaixo. O cookie de estado é respeitado. "Quanto custa?" abre o custo da casa. |
| D2 | O menu fixo passa a ter cinco destinos curtos, sem rolagem: "Início", "Meus escolhidos", "Votações", "Pessoas" e "Custo". "Temas" e "O que mexe comigo?" viram o filtro por tema dentro de "Votações". O resto vai para o rodapé. As D325 a D327 são revisadas só no ponto do menu. |

ABERTO do eixo D:
- D1: "Quanto custa?" não vai ao ar antes do dado do C1; sem ele a entrada some. Registrar que as entradas por intenção são navegação e não onboarding (compatível com a decisão de 07/11/2026). Layout testado a 390 px.
- D2: `/decisoes`, `/temas` e `/ajustes` continuam abrindo (redirecionamento); "Custo" só aparece com o dado do C1 (sem ele o menu tem quatro destinos); o estado escolhido continua visível no cabeçalho com "trocar estado".
- Critérios gerais do eixo: nenhum rótulo de menu com mais de duas palavras; texto em nível de leitura simples; layout a 390 px sem rolagem horizontal.

### Eixo E: ideias

| # | Ideia | Veredito |
|---|---|---|
| 1 | "Seu estado esta semana": como votaram os deputados do estado nas votações da semana, lista A–Z com a orientação da bancada | APROVADA |
| 2 | Calendário da pauta (.ics) dos temas escolhidos, sem e-mail nem conta | APROVADA |
| 3 | "Mudou a representação do meu estado": troca de partido, suplente assumindo, vaga aberta, em ordem de data | APROVADA (herda a lacuna dos suplentes: BUG-050/052; exemplo: Paulo Soares e José Carlos Araujo na votação 2236186-60) |
| 4 | Cartão para compartilhar, com a base escrita ("X de Y registrados") e a data | APROVADA, **só depois do resumo por e-mail**; reabre a decisão de 07/11 contra a barra de compartilhar |
| 5 | Emendas por destino (municípios do estado) | DESCARTADA por ora: só seria segura com ordenação A–Z e agregação que não existe; vira ranking de municípios se vier ordenada por valor |
| 6 | Modo leitura fácil (texto simples, contraste maior, ligável em um toque) | APROVADA |
| 7 | Discursos (trecho e link) | DESCARTADA por ora: a escolha do trecho é editorial e o risco de citação fora de contexto é alto; não há dado na sv |

## 3. Descartado, com o motivo

- Divisão do custo da casa por habitante: indicador comparável entre casas, vira ranking (D342).
- Contagem de votações do período e comparação com o mês anterior: vira indicador de produtividade e engana em mês de recesso.
- Percentual de alinhamento com o partido: voto vira nota.
- Projeção do que "deve" ir a plenário: previsão política; se errar, o site afirmou o falso.
- Resumo em linguagem simples escrito por agente agora: erro com selo de oficial; só depois da barra da §10.
- Efeito personalizado por renda, cidade ou ocupação: só com resposta conferida por proposta, que não temos.
- Barra de menu inferior no celular: o site tem a regra de menu sempre visível e sem JavaScript essencial.

## 4. Ordem de construção, em fatias pequenas

Cada fatia tem critério de aceite verificável. Fatia que depende de dado novo não vai ao ar antes do dado conferido contra a fonte. Antes de cada fatia: ler o arquivo que ela toca e registrar a decisão em `replica/decisions.md`.

| Fatia | O quê | Depende de | Critério de aceite |
|---|---|---|---|
| F1 | Menu de cinco destinos, com redirecionamento de `/decisoes`, `/temas` e `/ajustes` e UF no cabeçalho (D2) | nada | a 390 px o menu não rola na horizontal; as três rotas antigas respondem (redirecionamento) e o link do e-mail antigo abre; axe sem violações; e2e do shell atualizado |
| F2 | Home por escolhidos com "desde a última visita" e feed agrupado (A1, A2); convite quando não há escolhidos | nada | com cookie de escolhidos e data de visita a home abre pelo feed agrupado, com contagem e valor em reais; sem escolhidos abre pelo convite; teste de rede prova que a data não sai do navegador |
| F3 | Entradas por intenção na home (D1), sem "Quanto custa?" | F2 | duas entradas aparecem a 390 px acima da dobra junto com o convite; o cookie de estado é respeitado; "Quanto custa?" não existe no HTML |
| F4 | Voto com orientação da bancada (A5) e "Seu estado esta semana" (ideia 1) | conferir leitura de `party_orientations` | cada voto mostra a orientação oficial ou lacuna nomeada; `liberado` aparece como "liberou a bancada"; lista A–Z; sem soma nem percentual (teste de texto proibido) |
| F5 | Filtro por tema escolhido, estado de checagem por proposta e calendário .ics (B1, C2 parcial, ideia 2) | F1 (o filtro mora em "Votações") | o tema escolhido filtra pauta e votações; cada proposta mostra um dos três estados de checagem; o .ics lista só a pauta dos temas escolhidos, com data de leitura; sem tema oficial aparece "sem tema oficial" |
| F6 | Pauta de comissões, aviso de pauta velha e lista da casa com frase de resultado e nota fixa (C2, C3) | F5; limite de horas definido | pauta com leitura velha mostra o aviso no topo com a data; comissão diz "não é votação de plenário"; a nota "só votações com registro de voto por pessoa" está visível sem rolar a 390 px; teste falha se a nota sair da primeira tela |
| F7 | Teto da cota (Câmara) e série mensal (A4) | coleta do teto por UF e vigência, conferida contra a fonte | para uma amostra de 10 deputados de UFs diferentes, o teto do site bate com a fonte oficial; onde não carregado, lacuna nomeada; série mensal fecha com a soma por ano |
| F8 | Glossário determinístico das leis mais citadas (B2) | decidir dono e fonte | as 20 leis mais citadas na pauta têm verbete com fonte e data; lei fora do glossário mostra lacuna nomeada; nenhum texto gerado por agente |
| F9 | Destino das leis e tabela curada de status (B3) | tabela de status | proposta com `became_law_id` mostra número, sanção, resumo e link; status fora da tabela mostra o texto original com a fonte; teste acusa termo novo |
| F10 | Custo da casa (Câmara e Senado) e entrada "Quanto custa?" mais o destino "Custo" no menu (C1, D1, D2) | coleta da dotação, conferida contra a fonte | dotação e pago de um ano batem com a fonte oficial; a tela diz qual mostra; a frase da diferença não sugere desvio; sem o dado, entrada e menu não existem |
| F11 | "Mudou a representação do meu estado" (ideia 3) | cobertura de suplentes (BUG-050/052) | fatos datados de troca, suplência e vaga; onde o cadastro falha, lacuna nomeada |
| F12 | Modo leitura fácil (ideia 6) | nada | um toque liga e desliga; contraste e tamanho medidos; preferência guardada no aparelho |
| F13 | Resumo semanal por e-mail (A3) e, depois, cartão de compartilhar (ideia 4) | e-mail e central no ar (B8 e B9), D316/D317 revisadas, consentimento e política de privacidade | assinatura com confirmação por link e cancelamento em um clique; exclusão do e-mail a pedido; o texto passa pela regra de neutralidade; o cartão leva a base escrita e a data |

Fatias F1 a F4 e F12 podem andar em paralelo (não tocam os mesmos arquivos). F5 depende da F1. F6 depende da F5. F10 e F13 são as que carregam dado novo ou dado pessoal, e por isso ficam por último.

## 5. Riscos que continuam abertos

- Três dados novos que não existem hoje: teto da cota por UF e vigência (F7), dotação orçamentária das casas (F10) e o glossário curado (F8). Nenhum vai ao ar sem conferência contra a fonte.
- O e-mail muda a promessa de "sem cadastro". Revisão da D316/D317 e política de privacidade antes da F13.
- O tema escolhido é dado de interesse: no servidor só para quem assinou o e-mail.
- Cobertura de tema, orientação e orçamento para o Senado e as casas estaduais não foi conferida. Onde faltar, lacuna nomeada.
- Pendências herdadas da entrega do mapa: placar do Senado e cota total não conferidos contra a fonte; decisão sobre a lista de 44 px em `/votacoes` (D343) aberta; mandatos de suplentes no ETL.
