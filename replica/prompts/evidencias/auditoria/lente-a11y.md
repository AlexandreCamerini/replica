# Lente A11y (WCAG 2.2 AA) — Segue o Voto

Método: leitura de web/src/styles/sv*.css, tokens, componentes e HTML renderizado de 17 rotas (curl em localhost:3100). Sem navegador, sem edição. Itens marcados "não verificado" dependem de renderização real.
Raiz dos CSS: /Users/acamerini/replica/.claude/worktrees/pacote-d-congresso-51c417/web/src/styles (sv.css = SV.css abaixo).

## Resultado geral
Nenhum achado de severidade ALTA (nenhuma falha A/AA que bloqueie tarefa). 0 alta, 4 média, 8 baixa. A base é sólida; os achados são bordas.

## Contraste calculado (WCAG, luminância relativa)
Tokens em sv.css:11-12: papel #F2EEE5, tinta #141414, tinta2 #4A4844, agora #8A4A2E, agora-luz #EFDDD0, vida #0B3F4D, vida-luz #D9E8E6.
- tinta/papel 15,91 · tinta2/papel 7,88 · agora/papel 5,85 · vida/papel 9,90
- agora/agora-luz 5,14 · vida/vida-luz 9,08 · tinta2/agora-luz 6,92 · tinta2/vida-luz 7,23
- Pior caso de texto: 5,14 (mínimo 4,5). Todo texto passa. Bordas/formas de voto em tinta (15,91) passam 1.4.11. Não há par de cor reprovado.

## Verificado e OK (não reabrir)
- h1 único em todas as 17 rotas; sem salto de nível (h1>h2>h3); lang="pt-BR"; viewport sem user-scalable.
- Skip link primeiro no DOM, alvo main#sv-conteudo tabindex=-1; "Pular o mapa" existe.
- Landmarks: banner, nav com aria-label, main, footer; 0 ids duplicados nas rotas lidas.
- Tabelas de dados com caption + th scope (col/row) em /, /pessoa, /gastos, /mandato, /votacoes, /votacao.
- Todo input/select tem label for= ou aria-label (script sobre 16 páginas); aria-label dos botões começa pelo texto visível (follow, Aa, 2.5.3 ok); calendário .ics contém o texto visível.
- Foco: outline 3px tinta com offset em a/button/summary/input/select (sv.css:33); único outline:none é main (programático) e rótulos do mapa tabindex=-1 aria-hidden.
- prefers-reduced-motion cobre .sv * (sv.css:36); sem animação própria.
- Alvos: nav 44px (56px desktop), botões 44-48px, links de lista 44px; scroll-padding p/ aviso fixo (2.4.11).
- Voto/já vale/presença: forma + palavra, nunca só cor. Regiões ao vivo (role=status) em envio, contagem de marcados, carregando.

## MÉDIA

### A11Y-01 · Título e h1 idênticos em todas as /votacao/[id] · 2.4.2 / 2.4.6 · mensuravel
- Evidência: `<title>Como foi esta votação? · Segue o Voto</title>` em /votacao/camara-v2026-14 e /votacao/camara-v2026-15 (idêntico). h1 igual. A proposta só aparece no h2/quadro 1 ("O que foi votado?").
- Efeito: aba, histórico, lista de páginas do leitor de tela e resultado de busca indistintos. /decisao tem título específico (PL 9999/2026) mas h1 genérico igual para todas ("O que estão decidindo que mexe comigo?"); a linha com o assunto (.sv-so-larga) é display:none abaixo de 900px (sv.css:116), então no celular o h1 também não identifica.
- Correção direta: título = "<proposta> · Votação de <data>" (como /decisao já faz).

### A11Y-02 · Nenhum suporte a forced-colors (Windows Alto Contraste) · 1.4.1 / 1.4.11 · mensuravel
- Evidência: grep por forced-color|prefers-contrast em sv*.css = 0 ocorrências. Marcas dependem de background-color, que o modo força para Canvas: .sv-m--sim (sv.css:215), .sv-vf--ja (:223), checkmark do checkbox `.sv-chk input:checked::after{background:tinta}` (:273), barras de presença `.sv-pr__ms i`/.sv-pk (sv-pessoa.css:32), barra de gastos .sv-g__b i.
- Efeito: em alto contraste, o checkbox marcado parece desmarcado e o gráfico "Foi trabalhar?" some (só resta o aria-label do role=img). "Sim" fica idêntico a "Sem voto" na forma (a palavra ao lado preserva a informação).
- Correção: `@media (forced-colors:active){...}` com border/outline ou `forced-color-adjust:none` nessas marcas, e SVG inline para o check.

### A11Y-03 · Botão de marcar muda o nome E usa aria-pressed · 4.1.2 (prática APG) · mensuravel
- Evidência: pessoas-lista.tsx:25-28 e follow.tsx:15-16: `aria-pressed={on}` com rótulo "Votei nesta pessoa" ↔ "Você acompanha". O próprio shell-client.tsx:42 documenta que trocar nome + aria-pressed é o antipadrão (dupla negação) e fixa o nome do botão "Aa".
- Efeito: leitor diz "Você acompanha: Álvaro, botão alternado, pressionado": a ação (desmarcar) não fica clara; inconsistente com o critério já adotado no Aa.
- Correção: nome fixo ("Votei nesta pessoa: <nome>") + aria-pressed, ou sem aria-pressed e com nome-de-ação.

### A11Y-04 · thead/caption escondidos com position:absolute · 1.3.1 (risco de tecnologia assistiva) · mensuravel (regra) / não verificado (efeito)
- Evidência: `<thead class="sv-vh">` em /votacao (placar) e /mandato; `.sv .sv-vh{position:absolute;width:1px;height:1px;...}` (sv.css:35). position:absolute torna o thead display:block, o que historicamente faz VoiceOver/Safari perder a semântica de tabela.
- Efeito possível: placar e tabelas de gasto lidos como texto solto no Safari. Não verificado sem VoiceOver.
- Correção: esconder só o conteúdo dos th (span.sv-vh dentro) ou aplicar o recorte em th/caption, não no thead.

## BAIXA

### A11Y-05 · Listas com list-style:none · 1.3.1 (Safari/VoiceOver) · mensuravel (regra) / não verificado (efeito)
- sv.css:28 `.sv :where(ul,ol){list-style:none}` em todas as listas (menu, pessoas, votos, passos de /comecar). Safari remove papel de lista; sem `role="list"` o leitor não anuncia "lista de N itens". Correção: role="list" nos ul/ol relevantes.

### A11Y-06 · Mapa: três representações redundantes e 27 paradas de Tab · 2.4.1 / ruído · mensuravel
- Evidência (/votacoes, /votacao): 27 `<a class="sv-mv__a" aria-label="AC: 75% Sim, 6 de 8 registrados" aria-describedby="mv-d-AC">` + `<desc>` repetindo o dado + `<title>` por path + nav.sv-ufs com 27 links ("AC", "AL"...) + tabela `.sv-vh` com 27 linhas. Mesma informação 3x; HTML de /votacoes = 790 KB.
- "Pular o mapa" mitiga o Tab. Link da lista é só a sigla ("AC"): nome fraco fora de contexto (2.4.4 passa por contexto da nav "Estado").
- Alvo dos estados pequenos no SVG < 24px (2.5.8) é coberto pela exceção "equivalente na mesma página" (lista de 44px); registrado pelo dono em sv-mapa.css:5. Foco do `<a>` dentro do SVG: não verificado se o outline CSS desenha em todos os navegadores.

### A11Y-07 · Tamanhos em px ignoram a fonte-base do usuário · 1.4.4 (prática) · mensuravel
- sv.css:21 `.sv{font-size:16px}` e todos os tamanhos em px (13-34px); só sv-aviso.css usa rem. Zoom de navegador funciona (passa 1.4.4); preferência "tamanho de fonte padrão" do navegador/SO não escala o texto. O modo Aa (zoom:1.2) é paliativo manual.

### A11Y-08 · Alvo de 24px no link "votação N" dos escolhidos · 2.5.8 passa, 2.5.5/regra própria falha · mensuravel
- sv-escolhidos.css:18 `.sv-esc__vv-t a{min-height:24px}` (exato no mínimo AA). O restante do site usa 44px e o aceite D2 diz 44px. Links vizinhos "votação 1, votação 2" separados por vírgula.

### A11Y-09 · Campo obrigatório sem indicação visível · 3.3.2 · mensuravel
- /comecar: `<select id="cm-uf" required>` com label "Estado" sem marca de obrigatório; só o aviso nativo do navegador. Baixo porque há "Pular este passo" e a primeira opção é "Escolha um estado".

### A11Y-10 · Homônimos e "Apontar um erro" com destinos diferentes · 2.4.4 · mensuravel
- /votacao?uf=SP: dois links "Igor Brandão" (/pessoa/igor-brandao-sp, /pessoa/igor-brandao); o partido (HOR vs CER) fica fora do link. /como-funciona: "Apontar um erro" vai a /como-funciona#correcoes (rodapé) e a /sugestoes (botão). Passa por contexto; ruim em lista de links.

### A11Y-11 · Erro de rota sem gestão de foco · 4.1.3 · mensuravel
- (sv)/error.tsx: troca o conteúdo por h1 + botão "Tentar de novo" sem role=alert nem foco; usuário de leitor de tela não é avisado. Cenário raro (rede de segurança).

### A11Y-12 · Uma região role=status vazia por linha de pessoa · ruído/performance · mensuravel
- /pessoas?uf=SP&cargo=deputado_federal: 60 `<span class="sv-envio" role="status">` (um por linha) + `p[role=status]` de contagem. Funcional; custa árvore de acessibilidade e, em alguns leitores, anúncios duplicados quando só uma muda.

## GOSTO (não são falhas WCAG)
- G1 · Hierarquia visual invertida na Home: `.sv-folio h1{font-size:14px}` (celular) / 16px (desktop) (sv.css:114,129) contra h2 de 22-24px (sv-inicio.css:132) e respostas de 23-30px. O h1 é o menor título da página.
- G2 · Informação só no desktop: `.sv-so-larga{display:none}` abaixo de 900px esconde a data da Home e a linha de assunto da Decisão (sv.css:116).
- G3 · Texto de proveniência pequeno e condensado: fonte/prova/nota/esfera/etiqueta em 13px com font-stretch 84-88% (sv.css:188-196,444). Passa contraste (7,88); a "fonte" é o diferencial do produto e é o texto mais difícil de ler.
- G4 · Títulos numerados "1Foi trabalhar?": span.sv-n dentro do h2 entra no nome acessível ("1 Foi trabalhar?" ou "1Foi" conforme o leitor); numeração vazada no nome da section (aria-labelledby). h3 do dia: "quinta 26Hoje" pode concatenar. Não verificado em leitor.
- G5 · Landmark em excesso: /pessoa tem 21 `section[aria-labelledby]` (cada um vira region), + forms com aria-label (/ajustes, /gastos). Guia ARIA pede parcimônia.
- G6 · `::selection` global (globals.css:~52) usa accent-soft #e3ddcf sobre papel #F2EEE5 (contraste 1,2): seleção quase invisível no claro.
- G7 · Fieldset de /votacoes: legend oculta "Assuntos, em ordem alfabética" difere do h3 visível "Assuntos que importam para você".

## Não verificado (exige navegador/leitor)
Quebra a 320px dos rótulos do menu de 4 colunas com 14px (overflow-wrap:anywhere impede estouro, mas pode partir "escolhidos" no meio); outline em `<a>` dentro de SVG; thead absoluto em VoiceOver; leitura de "quinta 26Hoje"; comportamento de zoom:1.2 (Aa) em Firefox antigo.
