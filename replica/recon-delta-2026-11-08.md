# Recon delta: politicometro.org em 08/11/2026 × recon de 01/11

Escopo: arquitetura de dados, ETL e UX. É evidência para [`catalogo-2026-11-08.md`](catalogo-2026-11-08.md), onde estão as escolhas.

Método:
- Páginas públicas, lidas em velocidade humana, sem login e sem bundles JS.
- 2 passadas independentes: dados (21 URLs) e UX (28 URLs, desktop e 390 px).
- Nenhum dado do original foi copiado. Isto descreve o que o site **mostra**; o "como" é inferência quando marcado.

Limites:
- `/atualizacoes` não é changelog. Virou "Como atualizamos", com frescor e rotina. Não há como datar novidades contra 01/11, então "novo" significa "não constava do recon de 01/11".
- Não testei:
  - card de compartilhar aberto;
  - TTS;
  - filtros do hemiciclo;
  - página dos EUA;
  - conteúdo do bloco de emendas (só o título apareceu).

## 1. Escala e cobertura que o original declara hoje

| item | 01/11 (nosso recon) | 08/11 (original) | nós hoje |
| --- | --- | --- | --- |
| câmaras municipais | 937 | 965 fontes na rotina, 857 com presença e votos | 30 (SAPL) |
| Assembleias | 29 fontes | 30 fontes; 8 de 27 ALEs sem atividade | 2 (ALESP, ALMG) |
| cidades com algum dado | — | 1.714 de 5.569 (31%) | — |
| salário de vereador / prefeito | — | 966 / 826 cidades (via TCEs) | teto constitucional |
| países | Brasil | Brasil, Espanha (71,2 mil políticos) e EUA (8,6 mil) no ar; FR, UK e IT "em breve" | Brasil |

## 2. ETL: rotina declarada (horário de Brasília, servidor no Brasil)

| quando | o que |
| --- | --- |
| 04h diário | Câmara, Senado e STF (presença, propostas, falas, votos, comissões, cota, viagens, julgamentos), ALEs abertas, sanções TCU e CGU, Receita, fotos |
| 00h30, ter–sáb | segunda leitura do Congresso (pega o resultado da sessão da noite) |
| 16h diário | pauta de Câmara, Senado e STF |
| 21h diário | segunda leitura do STF |
| 05h–00h | ALEs e câmaras SAPL, uma por vez; cada câmara é relida a cada 7–14 dias, a mais antiga primeiro |
| dia 5 do mês | Tesouro (contas dos estados) e salários de prefeitos e vereadores pelos TCEs |
| anual / por eleição / quando a lei muda | PIB e população, quem governou / TSE / salários e verbas por cargo |

Operação:
- Falha: nova tentativa minutos depois e outra às 11h. Se persistir, a equipe é avisada.
- Um **vigia externo** confere todo dia.
- Na falha, o dado anterior fica com a data dele. O selo "fora do prazo previsto" aparece quando a carga é mais velha que a frequência.
- Espanha: servidor em Madrid, porque há fontes que só respondem de dentro do país. Guarda **cópia datada de cada arquivo baixado**.
- Selo por bloco: data do dado, data de publicação e **próxima publicação esperada**.

Privacidade:
- Não grava CPF, título nem endereço.
- CPF e título entram só como hash com sal, para ligar bases.
- Não grava nome de pessoa física que doou ou recebeu dinheiro.
- Não junta pessoas só pelo nome.
- Processos em andamento entram à mão, com documento oficial.

## 3. Datasets novos ou ampliados (contra 01/11)

| fonte | o que aparece | nós |
| --- | --- | --- |
| STF | pauta presencial e Plenário Virtual por sessão, 471 julgados, 104 parados, 11 cadeiras com vaga, audiências | `/stf` é stub (R5) |
| CGU (CEIS/CNEP) | sanções ligadas por CPF/registro | bloqueado: WAF no download; a API exige chave (D130) |
| Tesouro (SICONFI) | contas dos estados, mensal | não temos |
| TCEs | salário pago a prefeito e vereador | não temos (NOT_YET em `sources.ts`) |
| Portal da Transparência | emendas (bloco no crachá) e cartão da Presidência por presidente, % em sigilo | não temos: falta a chave |
| ALEs | GO (votos 2023+, verba 2013+), SP (despesas, proposituras), SC/MS (verba), RN (presença, com buraco na API da ALE); RO, AC, AM, PI e PB por SAPL | ALESP e ALMG |
| TSE | planos de governo 2026 (22.118, trecho literal, até 4 lado a lado); arquivo da apuração ao vivo de 25/10; contas com tipo de fonte e % dinheiro público | candidaturas, bens, votos, contas (totais); sem planos |
| Câmara | custo do mandato a partir do Ato da Mesa 43/2009 (posse 2027); equipe de gabinete com nomes e datas | equipe (`camara.equipe`); custo aproximado |
| IBGE/Ipeadata/BCB/Presidência | `/governos` com marcos legislativos por mandato | indicadores SIDRA e BCB |

Não existe: `/api` (404), `/emendas` (404), download ou licença em `/dados-abertos`. Este último virou diagnóstico de "quem publica e quem não publica". O MCP continua "em breve", sem endpoint, com 9 a 10 ferramentas listadas.

## 4. Métodos derivados declarados

- **Sem IA.** "Não usamos inteligência artificial nem opinião". Os temas saem de 17 categorias por palavra-chave sobre ementa e sumário, com a lista pública. Na Espanha: "sin textos escritos por inteligencia artificial".
  - Contraste com o nosso produto: a pauta usa IA para rascunhar e uma pessoa aprova antes de publicar (Regra 3, migrações 0080/0081).
- **Presença.** Conta só sessão deliberativa encerrada, dentro do exercício. Fora do exercício aparece em cinza e não vira falta. O Senado não tem presença.
- **Governismo (`/partidos`).** Mede igualdade com a orientação do governo em 1.148 votações e classifica em contra (< 1/3), divide ou com (> 2/3), **por deputado**.
- **Espectro.** Usa Bolognesi, Ribeiro e Codato (2023), com cortes 4,49/5,5.
- **Alinhamento ao partido.** "Votou igual em 41 de 50 (82%)".
- **Em alta.** Pessoas na última hora divididas pela média do dia, com k ≥ 3.
- **Inconsistência.** `/sobre` diz que não cobre votos por candidato, mas `/eleicoes` mostra.

## 5. UX: padrões novos ou refinados (resumo; a ficha de cada um está no catálogo)

Linha "registro mais recente" no topo do crachá · lacuna que pede ajuda · bloco por cidade "nenhum destes dados está no site, e por quê" · resumo do ano em frases · temas com chip para as propostas · alinhamento ao partido · comparar com divergências por tema · glossário recolhível no ponto de uso · custo do mandato com base legal · equipe de gabinete em linha do tempo · composição das campanhas · patrimônio com variação · trajetória com troca de partido e derrotas · grade de presença por sessão · barra âncora de seções · barra inferior no celular com "+" · WhatsApp e copiar link no topo · hemiciclo Hoje / fev-2027 · agenda em calendário com "consultado há N min" · votações "só o que muda lei" · STF por antiguidade e quem indicou · matriz "quem faz o quê com quem" · impostômetro com aviso didático · mais vistos com k=3 e "em alta" · seletor de países e fila de espera · exemplos clicáveis na busca de cidade.

## 6. Contradições do original que valem como alerta para nós

1. **Neutralidade parcial.** `/sobre` diz "cores nunca indicam partido". Ao mesmo tempo, `/congresso` e `/eleicoes` colorem por partido, e `/partidos` classifica pessoas em espectro e governismo.
2. **Popularidade como ordenação.** Aparece em "em alta", "pessoas agora" e "partido mais olhado".
3. **Privacidade.** O site promete não gravar nome de pessoa física que recebeu dinheiro, mas o crachá lista os assessores por nome.
4. **Percentual sem ressalva.** "-48% de patrimônio" e "82%" circulam sem a ressalva quando o número é recortado para o WhatsApp.
5. **Celular.** A home no celular é só a seleção de país. Há um carrossel de doação antes do conteúdo do crachá.

## URLs

Dados: `/atualizacoes` `/sobre` `/dados-abertos` `/mcp` `/` `/congresso` `/eleicoes` `/stf` `/impostos` `/governos` `/partidos` `/propostas` `/mais-vistos` `/p/tabata-amaral` `/p/fernanda-souto` `/cargos` `/mundo` `/es/sobre` `/dicionario` · 404: `/api` `/emendas`.

UX: além das de dados, `/br` `/quem` `/representantes` `/representantes?cidade=3509502` `/comparar?p=astronauta-marcos-pontes,giordano,mara-gabrilli` `/entrar` `/acompanhando` `/sugestoes` `/ajudar`.
