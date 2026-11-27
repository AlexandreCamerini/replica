# Lente de conteúdo — Segue o Voto (demo, leitura 26/11/2026)
Método: curl em 14 rotas, texto extraído, conferido contra PROIBIDOS de v2-d2-aceite.spec.ts. Resultado: nenhuma das 7 frases proibidas aparece em nenhuma rota. Todas as rotas têm banner "Exemplo ilustrativo". Rotas com "Leitura das fontes": todas exceto /ajustes, /como-funciona e /comecar (as duas últimas listam datas por fonte; /comecar e /ajustes não mostram dado de fonte). Não verifiquei: modo de leitor logado, /pessoa de outros cargos, /decisao/*, /votacao/*, /tema/*.

## Achados

C01 | alta | mensuravel | /pessoa/helena-siqueira (cartão "Foi trabalhar?" e seção "1 Foi trabalhar?")
Trecho: "Foi trabalhar? Esteve em 33 das 37 sessões de votação de 2026." e "Faltou a 4 sessões: 0 com justificativa e 4 sem."
Problema: (a) pergunta e verbo "Faltou" insinuam culpa (regra: sem 'faltou'); (b) a própria página diz "Presença — sem dado: O Senado não publica a lista de presença por senador", mas aqui afirma presença/falta e "sem justificativa" a partir de votações nominais. Ausência de voto nominal não é falta, e a fonte usada não traz justificativa. Contradição interna na mesma página.
Critério: regex /Faltou|Foi trabalhar/ ausente; "presença" só aparece com dado de presença da fonte.

C02 | alta | mensuravel | /pessoa/helena-siqueira, /votos
Trecho: perfil "144 votos nominais no mandato"; "122 votos nominais em leis"; /votos "Mostrando 1 a 50 de 122" + "38 votações de procedimento estão escondidas".
Problema: 122 + 38 = 160, não 144. Três números para "votos" sem reconciliação. Número sem conta fechada.
Critério: total do mandato = votos em leis + procedimento escondidos.

C03 | alta | mensuravel | /pessoa/helena-siqueira (resposta rápida "Quanto gasta?")
Trecho: "R$ 487 mil em 2026."
Problema: ano parcial apresentado como se fosse o ano (dados até 10/2026; nov/dez "Sem nota"). Na resposta rápida e no topo da seção não diz "de janeiro a outubro". Idem "33 das 37 sessões de votação de 2026" (só fev–out). Arredondamento "mil" sem o valor exato no cartão.
Critério: todo total de ano corrente traz o intervalo de meses.

C04 | alta | mensuravel | /pessoa/helena-siqueira e /mandato
Trecho: "Ficou fora da soma:" seguido apenas de "A soma cobre de 02/2023 a 10/2026... Salário e cota fora desse intervalo não entram."
Problema: título promete lista do que ficou fora; o item é uma regra de intervalo, não uma lacuna nomeada. Não diz que nov/2026 e o salário de 11/2026 ficam fora. Salário (45 meses × 46.366,19 = 2.086.478,55) é calculado, não lido mês a mês, e a página diz "Soma do que está carregado" sem avisar que o salário é multiplicação do valor atual.
Critério: lacuna nomeada com mês e rubrica; salário marcado como "valor mensal × meses".

C05 | media | mensuravel | /pessoa/helena-siqueira ("5 Quanto recebe?") e /mandato
Trecho: "Fonte: Decreto Legislativo nº 172/2022 (demonstração). Data da carga não registrada." com link para https://www2.camara.leg.br/
Problema: link da fonte do salário de uma senadora leva à home da Câmara, não ao decreto nem ao Senado. Link a lugar errado. Também "Quanto recebe? R$ 46.366,19 por mês, antes dos descontos" sem data de referência do valor.
Critério: href da fonte do salário de senador aponta para domínio senado.leg.br ou texto do decreto.

C06 | media | mensuravel | /pessoa/helena-siqueira/gastos (notas)
Trecho: "16/10/2026 · Telefonia / Restaurante do Vale Ltda / R$ 2.155,64"; "14/10/2026 · Passagens aéreas / Hotel Central Ltda"; "19/09/2026 · Telefonia / Consultoria Litoral Ltda".
Problema: categoria e fornecedor incoerentes (restaurante em telefonia, hotel em passagens). Mesmo marcado como exemplo, o leitor lê como indício de irregularidade que o site nunca afirmou. Também: "O link leva ao documento oficial quando a fonte o publica" mas nenhuma nota tem link nem diz que não há.
Critério: dados de demonstração com fornecedor compatível com a categoria; cada nota com link ou "sem documento publicado".

C07 | media | mensuravel | /pessoa/helena-siqueira/votos
Trecho: "Sim / PL 4861/2024... / A bancada do ENS orientou Não."; "A bancada do ENS foi liberada."; "Obstrução"
Problema: "orientou", "foi liberada", "bancada" e "Obstrução" sem explicação nessa tela (só o placar explica Obstrução em /). Mostrar voto contra a orientação do partido, sem explicar, empurra leitura de "traiu o partido" (juízo implícito). "Sem voto: Não é voto contra" está bem; falta equivalente para Obstrução e Abstenção.
Critério: cada termo do voto e da orientação com definição em até 1 clique/linha; bancada só com dado da fonte.

C08 | media | mensuravel | /pessoa/helena-siqueira
Trecho: "Votos 144 votos nominais no mandato... Propostas 17 propostas como autora principal e 7 em coautoria" vs "Votos, propostas e presença são somados por ano inteiro."
Problema: frase diz que somas são "por ano inteiro", mas 2026 está incompleto e o mandato é desde 2023. Rótulo ambíguo/incorreto sobre o que foi somado.
Critério: texto de método bate com o período exibido.

C09 | media | mensuravel | /pessoa/helena-siqueira ("Quanto custou?", mandato "Quanto custou o mandato?")
Trecho: "R$ 4.456.958,04 de salário e cota."
Problema: "cota" aparece sem definição aqui e "Gastos do gabinete" aparece nas linhas abaixo; o mesmo dinheiro tem três nomes (cota, gastos do gabinete, verba pública para despesas do mandato). "custou" soma salário (remuneração) com reembolso de despesas num só número, o que o leitor lê como "custo da pessoa" e dá base para comparação informal entre pessoas.
Critério: um único termo para a verba, definido uma vez; salário e despesas nunca somados em manchete.

C10 | media | mensuravel | /pessoa/helena-siqueira/mandato
Trecho: "Em ordem cronológica. “—” é mês sem nota na fonte... não quer dizer que nada foi gasto." e "Leitura das fontes: 01/11/2026, 06:10:00."
Problema: explica um "—" que não existe na tabela (nenhum mês sem nota); formato de hora com segundos difere do resto do site ("06:10"). Inconsistência de formato.
Critério: nota condicional só se houver "—"; um formato de data/hora.

C11 | media | mensuravel | /decisoes, / e /temas
Trecho: "Quarta, 25/11, no plenário da Câmara, em regime de urgência... Já vale? Ainda não vale." (hoje é 26/11)
Problema: sessão de plenário de ontem listada em "O que está marcado para ser decidido?" e "O que vai ao plenário até 29/11/2026?" com "Ainda não vale". Afirma estado sem ter conferido o resultado da sessão que já ocorreu. Deveria dizer "sessão já ocorreu; resultado ainda não lido".
Critério: item com data < data da leitura não usa "Ainda não vale" sem fonte do resultado.

C12 | media | mensuravel | /votacoes e /
Trecho: "PEC 5571/2025: emenda sobre formação de profissionais / Aprovada, com 249 Sim e 213 Não."
Problema: o resultado "Aprovada" é afirmado pelo site; 249 Sim não alcança o quórum de PEC (308), embora seja "emenda". O site não explica a regra de maioria por tipo; "Aprovada/Rejeitada" parece inferido do placar, não da fonte. Texto que afirma o que não foi conferido.
Critério: "Aprovada/Rejeitada" vem do campo da fonte, ou é omitido.

C13 | media | mensuravel | / , /decisoes, /temas
Trecho: link "Altera o Decreto-Lei nº 1.305, de 8 de janeiro de 1974, e as Leis nºs 5.461, de 25 de junho de 1968, 5.989, de 17 de dezembro de 1973, 7.573, de 23 d… →"
Problema: ementa cortada no meio ("23 d…") dentro do link; 34 palavras (>30); ilegível para leigo e sem versão simples quando "Aguardando conferência". Idem "Inclui na Lei nº 12.933... pessoas com d…".
Critério: nenhum texto truncado no meio de palavra; título em ≤30 palavras ou "resumo oficial longo, ver abaixo".

C14 | media | mensuravel | / , /temas, /decisoes
Trecho: "comissão CPASF", "comissão CDC", "PL 79/2020 ( lei comum )", "Termo na ementa: "contribuição"", "regime de urgência", "plenário", "Esfera", "destaque", "texto principal", "PLP", "PEC".
Problema: siglas de comissão sem nome por extenso (CPASF, CDC); "ementa", "regime de urgência", "esfera", "destaque", "texto principal", "PLP/PEC/PL" sem glossário na tela. Fora do nível 8º ano.
Critério: toda sigla/termo técnico com expansão na primeira ocorrência da página ou tooltip/ link para glossário.

C15 | media | mensuravel | /temas
Trecho: "Termo na ementa: "tributo"" (PL 9999/2026), "Termo na ementa: "benefício"" (PL 4567/2024)
Problema: mostra a palavra que fez a proposta entrar na regra, mas "benefício" em "benefício da meia-entrada" e "contribuição" aparecem como se fossem o assunto. A regra de seleção por palavra-chave (/como-funciona) é um viés editorial (só dinheiro, trabalho e benefícios) que o leitor pode confundir com "o que o Congresso está fazendo". Aviso "Acompanhamos só..." existe, mas não diz o critério na mesma tela.
Critério: aviso de seleção com 1 linha do critério ("dinheiro, trabalho e benefícios") ao lado da lista.

C16 | media | mensuravel | / (Já rolou, "Sem voto 7" etc.) e /votacoes
Trecho: "Sem voto soma quem não registrou voto e quem presidia a sessão." mas só aparece em 1 de 4 blocos; "Obstrução: 6 . É um registro próprio da Casa e não entra nas quatro linhas acima."
Problema: o aviso de "Sem voto" só aparece no último bloco do Senado; blocos da Câmara têm outra explicação. "Registro próprio da Casa" é jargão. Fala "Sem voto 7" no Senado de 81 sem dizer quantos presidiam.
Critério: nota de "Sem voto" junto de cada placar ou na legenda fixa.

C17 | media | gosto | Todas as rotas (navegação e títulos)
Trecho: nav "Meus escolhidos" / título "O que meus escolhidos estão fazendo?" / "Em quem eu votei" / botão "Votei nesta pessoa: acompanhar" / link "Escolher em quem votei"; nav "Pessoas" / título "Quem está no cargo?" / âncora "Quem me representa?".
Problema: 3 nomes para a lista marcada e 3 para a lista de cargos. Também "pessoa" vs "Senadora/Deputado" vs "parlamentar" (usado só em "emendas parlamentares"). Inconsistência de termos.
Critério (parcial mensurável): glossário único de rótulos de navegação = título da página = texto do botão.

C18 | media | mensuravel | /acompanhando
Trecho: "cada uma ganha um quadro aqui, com as mesmas cinco perguntas."
Problema: a página da pessoa tem "Quatro respostas rápidas" + 13 perguntas numeradas; "cinco" não bate com nada visível. Promessa verificável falsa.
Critério: número citado = número de perguntas do quadro.

C19 | media | mensuravel | / e /como-funciona
Trecho: "Conferido com o texto oficial por agentes de IA em 26/11." (home, PL 9999/2026) vs como-funciona "Quando a conferência foi feita por agentes, nenhuma pessoa leu a explicação antes de publicarmos."
Problema: a home afirma "conferido com o texto oficial" sem dizer que nenhuma pessoa leu; o aviso só está em outra página. O rodapé obrigatório evita citar "agentes de IA", mas o cartão a cita; mensagem inconsistente. Risco de leitor entender "conferido" como validado por pessoa.
Critério: todo selo de conferência por IA traz, na mesma tela, "nenhuma pessoa leu" ou link direto para a regra.

C20 | media | mensuravel | /
Trecho: "Câmara dos Deputados : 196 entram, 196 saem e 317 continuam, entre 513 cadeiras. Senado Federal : 32 entram, 32 saem e 49 continuam, entre 81 cadeiras." Fonte: TSE (eleitos de 2026).
Problema: o bloco está sob "Exemplo ilustrativo", mas não é pessoa/partido fictício e pode ser lido como dado real do TSE. Em 2026 se renova 2/3 do Senado (54 de 81), não 32; não confirmei na fonte, mas o número destoa da regra constitucional. Se for real, está errado; se fictício, a etiqueta é fraca.
Critério: número conferido contra TSE antes de sair da demo.

C21 | baixa | mensuravel | /como-funciona
Trecho: "Versão 2, publicada em 03/11/2026. Versão 1, publicada em 03/11/2026."; "IBGE · Localidades... lida em 15/01/2026, 03:00."
Problema: duas versões da regra no mesmo dia (sem motivo da mudança); versão 1 lista sem dizer o que mudou, apesar de "com data e motivo". Fonte IBGE com leitura de 10 meses atrás, sem aviso de defasagem.
Critério: cada versão com data e motivo; fontes com mais de N dias marcadas.

C22 | baixa | mensuravel | /como-funciona
Trecho: "No Senado, que não classifica por tema, as que têm no resumo uma destas palavras: tributo, imposto, alíquota, contribuição, salário, benefício, aposentadoria, pensão, tarifa, preço, juros, linha de crédito, FGTS, renda, dívida" (33 palavras) e "Na Câmara, as que a própria Casa classificou em: ..." (31 palavras)
Problema: frases >30 palavras com lista corrida; o leitor não vê que a regra é diferente por Casa (Câmara por tema, Senado por palavra, o que gera cobertura desigual entre as Casas, sem aviso).
Critério: frases ≤30 palavras; aviso de cobertura desigual.

C23 | baixa | mensuravel | /pessoa/helena-siqueira e /equipe
Trecho: "Quem trabalha no gabinete é terceiro ao mandato, pessoa física." / "Por isso mostramos só quantos são, em que funções e quanto custam, nunca o nome de cada um."
Problema: "terceiro ao mandato, pessoa física" é jargão jurídico; a promessa "mostramos... quanto custam" é feita numa página que diz que o dado não foi carregado (tempo verbal de promessa sem condicional). Pergunta "1 Quantas pessoas trabalham no gabinete?" já na pessoa ("6 Quem trabalha no gabinete?").
Critério: texto em linguagem comum; promessa condicionada a dado existente.

C24 | baixa | mensuravel | /pessoa/helena-siqueira
Trecho: "8 Mandou dinheiro para São Paulo?" e "Quanto custou?", "Foi trabalhar?"
Problema: rótulos de pergunta em tom coloquial acusatório/ambíguo ("Mandou dinheiro" para quem? emendas a municípios, não à "cidade"); sem unidade. "O patrimônio declarado mudou?" já traz o aviso "Aumento não quer dizer irregularidade", bom, mas o aviso só existe nele; os de gasto/emenda/trabalho não têm equivalente.
Critério: rótulo neutro com objeto explícito ("Emendas parlamentares destinadas a SP").

C25 | baixa | gosto | /votacoes (mapa) e /
Trecho: "Como votou cada estado na votação mais recente com voto por estado?"; "Mato Grosso do Sul ... (100%)"; "O percentual é arredondado para baixo."
Problema: percentual por estado ordena/compara bancadas por cor-enchimento; não é comparação entre pessoas, mas aproxima de ranking visual de estados. 3 de 8 = "37%" (arredonda para baixo, mas 37,5 lido como 38 pelo leitor). Texto de método longo (>40 palavras, bloco único) antes da lista.
Critério: método em frases ≤30 palavras; decidir se mapa fica em ordem alfabética (está) sem escala de cor.

## Pontos conformes (verificados)
- Nenhuma ocorrência de PROIBIDOS, incluindo "só neste aparelho".
- Rodapé de verificação presente em todas as rotas; texto igual ao exigido no spec.
- Lacunas nomeadas ("Ainda não carregamos", "A fonte não publica"); sem "R$ 0" nem "0" para lacuna (exceto contagens reais como "Abstenção: 0" em placar, que é dado).
- Soma R$ 4.456.958,04 = 2.086.478,55 + 2.370.479,49; categorias de 2026 somam R$ 487.309,54; meses de 2026 conferem com 43 notas; 200 votações de /temas = soma dos 17 assuntos.
