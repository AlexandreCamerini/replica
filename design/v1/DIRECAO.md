# Direção — quem·representa · "No seu bolso" · produto completo

## Conceito
Um jornal de papel que conta, sem opinião, o que Brasília decide e que mexe no bolso. Em 5 s a pessoa vê: um número grande (quantas propostas mexem no bolso nas próximas semanas), uma frase do seu estado, e o mapa do Brasil em que cada estado "enche" até o % de Sim. Uma cor só; o voto é padrão (cheio, hachura, pontilhado, vazio), nunca cor.
Plataforma: web responsiva · Device mínimo: Moto G 4G, 390 px · Modo: uso semanal, chega pelo WhatsApp.

## Tokens (usar EXATAMENTE; tema claro é o padrão)
```
--paper:#f3efe6  fundo da página (com grade de 24px rgba(28,34,38,.045))
--sheet:#fbf9f4  fundo de "prancha" (cartão com borda dupla)
--ink:#1c2226    texto e traço
--rule:#bdb6a6   linhas finas
--muted:#545a5e  texto secundário (sobre sheet 6.9:1)
--tint:#9a9d9b   única cor de quantidade (preenchimento de estado/barra); texto sobre tint: ink (4.6:1)
--ok:#1f6f4a / --warn:#8a5a00 / --err:#9b2c2c  só estado do sistema (pauta desatualizada, texto fora do ar). Nunca para voto ou tema.
tema escuro (prop tema=escuro): --paper:#121518 --sheet:#1a1e22 --ink:#ebe6dc --rule:#4a4f54 --muted:#a8a397 --tint:#6e7270
```
Fontes (um único `<link>` Google Fonts css2): Newsreader (display e títulos, opsz 6..72, 400/500/600) · IBM Plex Sans 400/500/600 (corpo) · IBM Plex Mono 400/500/600 (rótulos, datas, códigos) · Barlow Condensed 600/700 (números grandes).
Link: `https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;family=Barlow+Condensed:wght@600;700&amp;display=swap`

Escala: display 56–80 (Newsreader 500, lh 1.0) · h1 32–40 · h2 24–30 · corpo 15–16 lh 1.5 · rótulo `.lbl` mono 11px uppercase letter-spacing .08em muted · números `.disp` Barlow Condensed 700, lh .9.
Espaço: 4 8 12 16 18 24 32 40 64. Raio: 0 (tudo reto; nada arredondado, exceto círculo quando for círculo). Sombra: nenhuma. Elevação = borda dupla (`.plate`: border 1px ink + outline 1px ink offset 5px).
Alvo de toque ≥ 44 px em todo controle. Contraste ≥ 4.5:1 inclusive rótulos cinza.

## Componentes (copiar as classes de `project/Main.dc.html`, que é a referência viva)
- `.plate` prancha com borda dupla · `.lbl` rótulo mono · `.serif` · `.mono` · `.disp`
- `.btn` (44px, borda ink, sheet) e `.btn.main` (ink sobre paper)
- `.chip` seletor (borda rule; `.on` = borda ink + inset) · `.crumb` trilha (Brasil › Estado › Nome)
- `.sq` quadradinho 14px com padrão de voto: `.vS` cheio ink · `.vN` hachura 45° · `.vA` pontilhado · `.vX` vazio
- `.bar` barra única de 513 cadeiras (ink = Sim, hachura = Não, vazio = fora)
- selo `.stamp` (mono uppercase, borda 1.5px, levemente rotacionado −2°) para "APROVADA NA CÂMARA", "AGUARDANDO REVISÃO", "REVISADO POR PESSOA 04/11", "EXEMPLO ILUSTRATIVO"
- `.money` pílula com borda ink: "Mexe com dinheiro: <o quê>" · `.ttag` tema (fundo paper, borda rule)
- figura de citação `.quote`: fundo paper, borda esquerda 2px ink, mono "Texto oficial · p. N" + blockquote serif itálico
- cabeçalho: marca `quem·representa` (Newsreader 600 24px) · nav: Já decidido · Vem aí · Quem eu votei · Como escolhemos · Correções · à direita mono "Pauta lida em 05/11/2026, 00:02"
- rodapé: mono 11px: fonte (Câmara dos Deputados, Senado Federal · cadeiras: TSE), "Temas lidos por IA, aguardando revisão por pessoa", link Correções.

## Interações-assinatura (3, e só estas)
1. **Contador do bolso** na Entrada: número grande "N propostas podem mexer no seu bolso até 19/11" com a lista logo abaixo. Nada de contagem regressiva.
2. **Estado que enche**: no mapa, cada estado enche de baixo para cima até o % de Sim (já feito em Main.dc.html; reutilize o SVG/gradiente). Drill-down Brasil › estado › deputado.
3. **Trilha sempre visível** em qualquer nível, e troca de votação sem perder o nível.

## Motion (mínimo; só transform/opacity; `prefers-reduced-motion` desliga tudo)
| Elemento | Técnica | Duração | Reduzido |
|---|---|---|---|
| Troca de nível (mapa→estado) | opacity 0→1 no painel novo | 180ms ease-out | nenhum |
| Estado enchendo | nenhuma animação (é estático: honestidade antes de espetáculo) | — | — |
| Hover em botão/estado | box-shadow 0 0 0 2px ink | 0 | — |

## Estados de produto (desenhar onde couber; nunca inventar número)
Vazio ("Nenhuma proposta mexe no bolso nesta semana"), Carregando (skeleton nas dimensões finais, sem texto), Erro ("Não conseguimos ler a pauta da Câmara. Última leitura: 05/11, 00:02", botão Tentar de novo), Pauta desatualizada (selo --warn), Texto oficial fora do ar (selo --err), Aguardando revisão (selo neutro), Revisado por pessoa (selo com data), Saiu da pauta, Reunião cancelada, Votada, Virou lei.

## Copy (regras do brief, inegociáveis)
PT-BR, frases ≤ 15 palavras. Proibido: beneficia, prejudica, polêmica, ataque, conquista, retrocesso, avanço, defendeu, condenou, traiu, cumpriu, pior, "bom/ruim". Jargão traduzido na primeira vez (PL = projeto de lei; MPV = medida provisória; relator = quem sugere a versão final; plenário = todos os deputados juntos). Nunca inventar número, data ou nome: o que não existe vira `[N]`, `[dd/mm]` ou selo EXEMPLO ILUSTRATIVO. Toda afirmação sobre o que a proposta faz vem com trecho citado do texto oficial ou "O texto não diz".

## Dados reais
Estão em `/private/tmp/claude-501/-Users-acamerini-replica--claude-worktrees-design-consent-63af20/dfc1f244-4e89-4019-828d-459f69ba0092/scratchpad/BRIEF-propostas.md` (pauta de 05/11 com 13 itens + MPV 1379/2026, PL 79/2020 com respostas revisadas e trechos, cadeiras por UF). As 6 votações nominais já decididas, com os 513 deputados, estão em `project/dados.js` (`window.QR`).
"Mexe com dinheiro" na pauta de 05/11: só PL 79/2020 e PL 2374/2023 (2 itens). Logo o contador do bolso é **2** nesta semana; a MPV 1379/2026 ainda é "tema pendente".

## Formato do artboard (.dc.html) — regras que quebram em silêncio
Mesmo formato de `project/Main.dc.html`. Esqueleto: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>…</title><script src="./support.js"></script></head><body><x-dc><helmet><link fonts…><style>body{margin:0} …</style></helmet> <div class="root">…</div> </x-dc><script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":W,"height":H}}'>class Component extends DCLogic { renderVals(){ return {…}; } }</script></body></html>`.
- `{{x}}` só busca pontuada em `renderVals()`; sem expressão. Eventos `onClick="{{fn}}"`. Loops `<sc-for list="{{xs}}" as="x" hint-placeholder-count="3">`, condição `<sc-if value="{{c}}" hint-placeholder-val="{{true}}">`.
- Estado em `this.state` via `constructor(p){super(p); this.state={…}}` e `setState`. JS clássico, sem import. Dados constantes no topo do script.
- Toda UI é markup; nunca innerHTML/appendChild/window.X; nada de `<iframe>`, imagem externa ou emoji; ícones = SVG inline de traço com `aria-hidden="true"`.
- `<button>`, `<a href>`, `<label>+<input>` reais. `aria-label` em botão só com ícone.
- Computador = PÁGINA fluida: root sem largura fixa, `max-width: 1320px; margin: 0 auto; padding: 0 24px`; precisa funcionar a 390 px (flex-wrap, grid com `minmax(0,1fr)`, tabelas em caixa com overflow-x). `$preview` 1440 × altura do conteúdo.
- Celular = root FIXO `width: 390px`, altura conforme conteúdo. `$preview` 390 × altura.
- Links entre telas: `<a href="NomeDaTela.dc.html">`. Nomes das telas do produto: EntradaDesktop, EntradaCelular, PautaDesktop, PautaCelular, PropostaDesktop, PropostaCelular, JaDecididoDesktop, JaDecididoCelular, QuemVoteiDesktop, QuemVoteiCelular, ComoEscolhemos, Correcoes.
- Um único tweak em `data-props`: `"tema":{"editor":"enum","options":["claro","escuro"],"default":"claro"}`; em `renderVals` devolva `theme: (this.props.tema ?? 'claro') === 'escuro' ? 't-dark' : 't-light'` e use `class="root {{theme}}"` com os dois blocos de variáveis em `<helmet><style>`.
- Escreva cada arquivo com a ferramenta Write (um arquivo por chamada). Não abra navegador, não rode build. Pode rodar `node` para testar a lógica.
