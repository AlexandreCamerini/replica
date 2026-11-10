# Design v1 · oficial · 06/11/2026

Versão fechada do produto "No seu bolso" (quem·representa), aprovada para levar ao app em `web/`.

- Canvas publicado: https://claude.ai/artifact/7YimAtmaMg92xTGRweB2au (versão rotulada "v1 oficial")
- `DIRECAO.md`: direção de arte (tokens, componentes, interações-assinatura, motion, estados, regras de copy)
- `pranchas/`: as 13 pranchas em `.dc.html` + `dados.js` (6 votações nominais, 513 deputados, mapa IBGE) + `canvas.json`
  - Computador: EntradaDesktop, PautaDesktop, PropostaDesktop, JaDecididoDesktop, QuemVoteiDesktop, ComoEscolhemos, Correcoes
  - Celular: EntradaCelular, PautaCelular, PropostaCelular, JaDecididoCelular, QuemVoteiCelular
  - DirecaoArte: tokens, tipografia, componentes, padrões de voto, estados, critérios de aceite

## Decisões fechadas
1. Mapa oficial do IBGE, sem bolhas e sem quadradinhos: o estado enche de baixo para cima até o % de Sim.
2. Nenhuma cor para voto ou partido: cheio = Sim, hachura = Não, pontilhado = abstenção, vazio = sem voto.
3. Uma cor de quantidade (`--tint`); verde/âmbar/vermelho só para estado do sistema. Tema escuro: ok/warn/err = #5fc48f / #e0a53a / #e08080.
4. % de Sim conta só quem votou (S+N+A); "fora" = não registrou + presidia.
5. Raio 0, sem sombra, borda dupla como elevação, grade de 24 px.

## O que é desenho, não dado
Botões de WhatsApp, gabinete e Acompanhar; pauta de 12/11 e 19/11 ("[N] itens"); formulário de Correções.

## Pendências conhecidas
- Nav do celular em QuemVoteiCelular quebra em duas linhas (as outras telas usam botão Menu).
- Telas de computador não foram verificadas a 390 px (as de celular foram).
- Select de UF em PropostaDesktop sem onChange.
