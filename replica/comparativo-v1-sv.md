# Comparativo das duas versões do site público: `(v1)` "No seu bolso" x `(sv)` (raiz desde a D316)

Data: 21/11/2026. Base: `origin/main` em `c6eac57`. Só leitura de código; nenhum número de produção foi conferido (o Postgres local não tem dado real).

Pergunta do dono: qual é a melhor forma de informar o eleitor sobre (a) movimentações e atuação, (b) gastos, (c) impacto das decisões na vida dele.

Premissa declarada: "v1" é `web/src/app/(v1)`, o desenho anterior, que segue no ar (D316). "sv" é `web/src/app/(sv)`, a Direção 2. Caminhos abaixo são relativos a `web/src/`. Toda referência `arquivo:linha` foi aberta e conferida; as que o plano de trabalho trazia e estavam erradas estão na seção 6.

## 1. Matriz: dimensão x versão

### (a) Movimentações e atuação

| Dimensão | v1 | sv |
|---|---|---|
| Acompanhar sem conta | Não. O acompanhamento depende de conta: `app/(v1)/conta/page.tsx` lê `myFollows(user.id)`. Há `app/(v1)/quem-votei/page.tsx` ("Como votou quem você escolheu", sobre as votações curadas), que não é feed de atividade. | Sim. Cookie `sv_sigo`, até 12 pessoas (D316, D317), `app/(sv)/acompanhando/page.tsx:13-25`. Sem conta e sem banco. |
| Feed de "o que fizeram por último" | Não existe. | `components/sv/escolhidos/quadro.tsx:270-290` (`Recentes`): mais recente primeiro, com tipo, esfera e fonte; falha de leitura e feed vazio são lacunas diferentes. |
| Quadro por pessoa acompanhada | Não. | `quadro.tsx:170-192` (`QuadroEscolhido`): presença, votos, gastos, patrimônio e propostas; nota fixa de que "ainda não temos esse dado" não quer dizer que a pessoa não fez nada. |
| Aviso ativo de movimentação | Só a preferência. `components/account/forms.tsx:128` ("Resumo por e-mail": diário, semanal, desligado) grava em `profiles.digest` (`lib/account.ts:104-111`). Não achei no repositório código que envie o resumo (busca por `digest_deliveries`, `sendDigest` e `Resend` só encontra login, provisão de roles e testes). Tratar como não confirmado, provavelmente inexistente. | Não. Nenhum aviso; o eleitor precisa abrir `/acompanhando`. |
| Página da pessoa: forma | Escala: `app/(v1)/p/[slug]/page.tsx` compõe Proposals, Votes, Expenses, Laws, Committees, Staff, Speeches (`:462-468`), Amendments (`:492`) e custo (`:499`). Seções por tema, título nominal. | Perguntas como título (`app/(sv)/pessoa/[slug]/page.tsx`): p1 presença (`:339`), p2 gastos (`:361`), p4 votos (`:420`), p5 salário (`:438`), p8 emendas (`:512`), p10 comissões (`:564`), p11 promessas (`:600`). Cada resposta traz fonte e data de leitura; sem dado, lacuna nomeada. |
| Janela de tempo da atuação | "desde AAAA" por número (D50): `app/(v1)/p/[slug]/page.tsx:103-109` calcula o primeiro ano com dado de cada número em `getYearlyStats`. Há seletor de ano (`yearParam`). | Um ano: o corrente e, se estiver vazio, o anterior (`app/(sv)/pessoa/[slug]/page.tsx:107-118`). Não há visão do mandato. |
| Presença | Em `Votes` e no quadro de números. | Grade de sessões (`components/sv/pessoa/presenca.tsx`), com o mesmo recorte de um ano. |
| Discursos | `Speeches` (`components/profile/sections.tsx:498`). | Ausente: nenhuma ocorrência de `listSpeeches` ou "discurso" em `app/(sv)` e `components/sv`. |
| Viagens oficiais | Declaradas como não carregadas: `app/(v1)/p/[slug]/page.tsx:510-512` ("Viagens oficiais ... nenhuma viagem está no site"). | Ausente, sem aviso. O ETL não tem escritor de viagens. |
| Votação: leitura geográfica | Mapa IBGE em SVG, o estado enche até o % de Sim: `components/votos/mapa-brasil.tsx:23-73`. Dado estático curado de 6 votações (`lib/votacoes.ts:1-3`, `data/votacoes.json`). | Sem mapa. `app/(sv)/votacao/[id]/page.tsx:168-195`: pergunta "Como votou cada estado?" e uma fileira de siglas (`nav.sv-ufs`, `:186-192`); o placar só aparece depois do clique (`PlacarDaUf`, `:30-47`). O dado é ao vivo (`ev.porUf`, `lib/data/types.ts:285-299`). |
| Ordem das UFs | Lista de estados ordenada por número de cadeiras, maior primeiro: `app/(v1)/ja-decidido/page.tsx:77`. É ordenação por tamanho. | Ordem alfabética de sigla; "nunca por tamanho" está no tipo (`lib/data/types.ts:295`, comentário de `PlacarPorUf`). |
| Base do percentual | Sim / (Sim + Não + abstenção), arredondado para baixo: `lib/votacoes.ts:37-39`. Nota de rodapé honesta sobre 14 UFs com até 10 deputados (`ja-decidido/page.tsx:92-96`). | Não calcula percentual. Mostra contagem por voto e "N registros, de C cadeiras" (`votacao/[id]/page.tsx:37-47`), e diz que menos registros que cadeiras não é ausência. |

### (b) Gastos

| Dimensão | v1 | sv |
|---|---|---|
| Gasto do gabinete/cota | `Expenses` (`components/profile/sections.tsx:244`), por ano escolhido ou "desde AAAA". | p2 (`app/(sv)/pessoa/[slug]/page.tsx:361-390`): um valor em reais, de um ano, com tabela por categoria A–Z; link "Ver nota por nota" para `/pessoa/[slug]/gastos`. |
| Nota a nota | Dentro de `Expenses`. | `app/(sv)/pessoa/[slug]/gastos/page.tsx`: seletor de ano (`getActiveYears`, `:52-54`) e filtro por categoria. Navega por ano; nunca totaliza o mandato. |
| Custo do mandato (salário + cota) | `MandateCost` (`sections.tsx:602-706`): salário mensal, salário recebido no período (série do subsídio, `getSalaryAccrued`, `lib/data/pg.ts:938`), gasto da cota, e "Soma do que está carregado". Cada item com o ato legal, e "—" com motivo onde não há valor. Chamado em `app/(v1)/p/[slug]/page.tsx:499-508`. | Ausente. |
| Salário | Mensal, acumulado no período e reajuste futuro marcado como "ainda não vale" (`sections.tsx:643`). | Só o valor mensal bruto, com fonte (`app/(sv)/pessoa/[slug]/page.tsx:438-472`); "até" quando é teto. Sem acumulado. |
| Emendas | `Amendments` (`sections.tsx:905`), todos os anos, com empenhado, liquidado e pago por emenda. | p8 (`page.tsx:512-517`, `vmEmendas` em `components/sv/pessoa/secoes.tsx:230-246`): só o ano mais recente com emenda, só as da UF da pessoa, pago e empenhado somados. As de fora da UF viram uma contagem. |
| Correção pela inflação | IPCA no patrimônio (`components/profile/ipca.ts`, `sections.tsx:307-360`). Não corrige gasto. | Nenhuma. |
| Equipe do gabinete | `Staff` (`sections.tsx:960`). | p6 e `/pessoa/[slug]/equipe`. |
| Gasto em contexto (por mês, por categoria no mandato, vs. algo) | Não. | Não. |
| Janela honesta | "desde AAAA" por número, mas o título de `career` mistura mandatos anteriores (ver seção 5). | Um ano, dito na tela ("em 2026"). Honesto e curto. |

### (c) Impacto das decisões na vida do eleitor

| Dimensão | v1 | sv |
|---|---|---|
| Contador "o que mexe no seu bolso" | `app/(v1)/no-seu-bolso/page.tsx:29-41`: número grande (propostas sobre dinheiro, trabalho e benefícios na pauta da semana), com "Dizemos o que acontece, nunca se é bom ou ruim". É uma classificação por tema, igual para todo mundo. | `/decisoes` e a pergunta "O que mexe comigo?" (`app/(sv)/decisoes/page.tsx:31`, h1 "O que mexe comigo?"). Lista por pergunta, a partir de "O que está marcado para ser decidido?"; sem contador. |
| "O que muda para mim" | `app/(v1)/proposta/[key]/page.tsx:143-148`: "Quem recebe", "Quem paga", "O que muda para quem mora no Brasil". Antes da resposta conferida: texto de espera (`:161-165`). | `app/(sv)/decisao/[key]/page.tsx:242-274`: "O que muda para mim?" com "Hoje" e "Se aprovado". Sem resposta conferida: aviso único que nomeia o que falta (`:242-250`). |
| Dinheiro e quem paga | `proposta/[key]/page.tsx:150-154`: "O dinheiro entra, sai ou é dividido?" e "Estimativa de impacto oficial". | `decisao/[key]/page.tsx:285-310`: "Quem é afetado?", "Quanto muda na conta?", "Quem paga?". Paridade de campos com a v1. |
| Estado de "ainda não conferido" | Uma frase só, e com texto desatualizado: `proposta/[key]/page.tsx:163` diz "Uma pessoa confere cada resposta ... antes de publicar", o que a D293 revogou (verificação agêntica no lugar da revisão humana). | Lacuna nomeada, com o que falta e o caminho para o texto oficial. Mais honesto. |
| "Hoje" (a situação atual) | Não tem. | Sempre lacuna: `decisao/[key]/page.tsx:256-259` escreve "Ainda não conseguimos conferir como é hoje" mesmo no ramo com resposta. A metade "Hoje / Se aprovado" nunca fecha. |
| Ligação com quem o eleitor escolheu | Não. `/quem-votei` é página à parte, sobre as votações curadas. | "Como votou quem eu elegi?" (`decisao/[key]/page.tsx:362-395`): para cada pessoa marcada, o voto nessa proposta. É atuação de quem ele escolheu, não impacto na vida dele. |
| Impacto personalizado (renda, cidade, ocupação) | Não. | Não. Nenhuma das duas tem entrada do eleitor que mude o texto. |
| Publicação de respostas | Respostas dependem do mesmo pipeline. | A publicação por agentes segue desligada (D293, D300, D324 "fora desta fase"); a maioria das decisões cai no ramo "aguardando". |

## 2. O que cada versão faz melhor

v1:
- Custo do mandato consolidado: é o único lugar que soma salário e cota (`sections.tsx:602-706`), com o ato legal e "—" onde falta.
- Salário acumulado no período, com a série de reajustes e o reajuste futuro fora da soma.
- Emendas de todos os anos, com os três estágios (empenhado, liquidado, pago).
- Mapa de votação: o estado que enche é a única leitura do país inteiro de uma vez. Tem equivalente em lista (`ja-decidido/page.tsx:73-91`) e alvos de 44 px.
- "Desde AAAA" por número (D50): o leitor sabe de quando é cada total.
- Contador semanal de propostas que mexem no bolso: uma entrada simples para o eleitor distraído.

sv:
- Acompanhar sem conta, com feed cronológico e fonte em cada linha (`quadro.tsx:270-290`). A v1 exige conta e não tem feed.
- Pergunta como título, e prova (fonte e data) junto de cada resposta. É a regra de leitura que sustenta a neutralidade.
- Lacuna honesta: falha de leitura, "sem cobertura" e "sem dado" são estados diferentes, nunca zero.
- Decisão sem resposta conferida: um aviso único em vez de caixas vazias (D324, item 8).
- Neutralidade estrutural: listas A–Z, UFs em ordem alfabética, sem nota nem ranking (D82, U04).
- Ligação decisão x escolhidos (`decisao/[key]/page.tsx:362-395`), que a v1 não tem.
- a11y e e2e: `e2e/d324-fase1.spec.ts` cobre axe, reflow, alvo de 44 px e ordem do DOM.

## 3. O que nenhuma das duas faz

1. Impacto personalizado. Nenhuma pergunta ao eleitor (faixa de renda, cidade, ocupação, filhos) para dizer o que muda para ele. "O que muda para mim?" é um título que promete o que a tela não entrega. A v1 diz "para quem mora no Brasil".
2. Gasto em contexto. Gasto nunca aparece ao lado de algo que o torne legível: por mês, por categoria acumulada no mandato, ou em relação ao teto da cota (o teto está "não carregado" na v1, `sections.tsx:662`). Um número de gasto sem unidade de comparação não informa. A comparação com a média da casa está proibida (seção 5); o que falta é o que não é ranking: o teto legal, a série mensal e o acumulado do mandato.
3. Aviso de movimentação. A v1 tem a preferência de e-mail sem remetente confirmado; a sv não tem nada. Quem acompanha 12 pessoas precisa lembrar de abrir a tela.
4. Total do mandato com janela honesta. Não existe "gasto no mandato": `person_period_stats.career` soma tudo o que está carregado, inclusive mandatos anteriores, e `mandate_periods` não é lida pelo web (nenhuma ocorrência em `lib`, `app` ou `components`).
5. Viagens oficiais e, na sv, discursos.

## 4. Veredito

1. sv é a base de navegação e de movimentação. Acompanhar sem conta, feed com fonte, pergunta como título e lacuna honesta são o que a v1 não tem e não ganha com remendo. Não portar o desenho da v1 para a sv.
2. Trazer da v1, em forma de resposta à pergunta e não de seção: o custo do mandato (salário + cota, com "desde AAAA" e os meses que ficaram fora), o salário acumulado, as emendas de todos os anos (hoje a sv mostra só um ano e só a UF da pessoa) e o mapa de votos.
3. Mapa: portar o SVG, mudando três coisas que a v1 faz mal por critério da D316 e da neutralidade: enchimento em tinta (não em cor de voto); lista equivalente em ordem alfabética (não por cadeiras, ver `ja-decidido/page.tsx:77`); base do percentual escrita na legenda ("X de Y registrados").
4. Impacto na vida: lacuna honesta até a publicação agêntica (D324, D300). Hoje a sv é mais honesta que a v1 ao tratar a ausência da resposta, e a v1 tem copy defasada (`proposta/[key]/page.tsx:163`). Não construir personalização agora: sem resposta conferida por proposta, ela só reorganizaria lacunas. Registrar como decisão futura do dono.
5. Aviso de movimentação não entra nesta entrega. Exige canal (e-mail ou push), identidade e consentimento, que a sv decidiu não ter (D316, D317). Fica como pendência, não como lacuna escondida.

## 5. Restrições de design que valem

- D316: a sv é a raiz; a v1 continua no ar com aviso. Nada novo na v1.
- D324: pergunta como título, quadro no topo da pessoa com quatro respostas, fonte e data em cada resposta, lacuna nomeada. "Como afeta minha vida" fora desta fase.
- D325 a D327: navegação à vista, partido e estado como filtro, contagem de pessoas (não de marcações).
- D331: lista de pessoas só depois do filtro.
- D82 e U04 (`replica/decisions.md:62` e `:626`): toda lista A–Z ou por data; resumo "sem média nem comparação com outros (seria ranking implícito)". Só valores absolutos.
- D50: "carreira" é "desde AAAA" por número.
- D293: verificação agêntica no lugar da revisão humana; a copy não pode dizer que uma pessoa confere.
- `design/v1/DIRECAO.md`: uma única cor de quantidade (`--tint`); `--ok`, `--warn`, `--err` só para estado do sistema, "nunca para voto ou tema" (`:14-15`); raio 0, sem sombra, alvo de 44 px, contraste 4,5:1 (`:22-23`); estado do mapa sem animação (`:46`).
- Voto nunca por cor: forma e padrão (sim cheio, não hachurado, abstenção pontilhado; `--hach`, `--pont` em `styles/sv.css:16-17`).
- Sem busca no cabeçalho (decisão de shell). "—" e nunca 0 onde a fonte não carregou. Sem "beneficia" nem "polêmica".
- Cuidados de dado: janela `max(início do mandato, primeiro ano carregado)`, nunca "total do mandato" quando o mandato começou antes do primeiro ano carregado; discursos e comissões só como contagem quando a cobertura do conjunto confirmar (o derive grava essas contagens condicionadas a `votes_src`).

## 6. Referências do plano que estavam erradas (corrigidas aqui)

| Plano dizia | Código mostra |
|---|---|
| `mapa-brasil.tsx:23-67` (SVG) e `:70-87` (zoom) | `MapaBrasil` é `:23-73`; `EstadoZoom` é `:78-86`. |
| `(sv)/votacao/[id]/page.tsx:30-54` é "o placar por UF em lista" | `:30-47` é `PlacarDaUf`, o placar de uma UF só. A "lista" por UF é `nav.sv-ufs` em `:186-192`, dentro do quadro `vt-3` (`:168-195`): siglas sem número. |
| `sv.css:13-14` para `--hach` e `--pont` | `:16` e `:17`. |
| `sv.css:8-11` para os tokens sob `.sv` | `:10-13`. |
| "Na sv faltam o custo do mandato, discursos e viagens" | Confere para custo, discursos e viagens. Mas o salário mensal e as emendas existem na sv (p5 `:438-472`, p8 `:512-517`), em forma menor: sem acumulado, e emendas só do ano mais recente e da UF da pessoa. |
| "O sv trata melhor a ausência de resposta" (impacto) | Vale para o aviso único; mas "Hoje" é lacuna fixa no código (`decisao/[key]/page.tsx:256-259`), mesmo com resposta conferida. |
| "Aviso de movimentação: nenhuma das duas faz" | A v1 tem a preferência "Resumo por e-mail" (`forms.tsx:128`, `account.ts:104-111`). Remetente não encontrado no repositório; nenhuma das duas entrega o aviso hoje. |

Confirmado sem alteração: `lib/votacoes.ts:39-45` (`pct`, `pctText`, `fora`), `components/profile/sections.tsx:602` (`MandateCost`), `lib/data/pg.ts` (`getMandates` 636, `getPeopleCoverage` 793, `getYearlyStats` 868, `getPresenceByMonth` 881, `getSalaryAccrued` 938, `listAmendmentsByPerson` 1006, `listExpenses` 1106, `getCommittees` 1426, `listSpeeches` 1434), `components/sv/casco.tsx:3-10` (imports de CSS por tela), `lib/data/types.ts:285-299`.

## 7. Achados que mudam o trabalho seguinte

1. A v1 ordena os estados por número de cadeiras (`ja-decidido/page.tsx:77`). Portar o mapa e a lista sem corrigir isso reintroduz ordenação por tamanho, que a sv proíbe.
2. A sv já tem salário e emendas, só que menores. O trabalho de "trazer da v1" é mais ampliar a janela e somar do que criar blocos novos; o que é novo de verdade é o custo do mandato e o mapa.
3. O resumo por e-mail da v1 é uma preferência sem remetente confirmado: não dá para usar como argumento de que a v1 avisa o eleitor.
4. Copy defasada na v1 (`proposta/[key]/page.tsx:163`) contradiz a D293. Não é escopo desta entrega; fica registrada.
