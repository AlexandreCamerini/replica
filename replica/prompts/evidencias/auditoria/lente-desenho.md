# Lente de DESENHO — Segue o Voto (somente leitura)

Método: CSS lido por inteiro (web/src/styles/sv*.css), HTML de 14 rotas via curl em localhost:3100, grep nos componentes. Nada renderizado em navegador: onde a conclusão vem da cascata e não de medição visual, está dito.

Premissa a declarar: o código implementa a "Direção 2" (Bricolage Grotesque, --papel/--tinta, --agora/--vida), não os tokens de design/v1/DIRECAO.md (Newsreader/IBM Plex/Barlow, --tint única). Achado D14 trata disso; os demais avaliam consistência interna.

## ALTA

D01 | mensuravel | h1 tem 5 tamanhos diferentes, e na Início e em /temas é menor que o h2
- sv.css:114 `.sv-folio h1` 14px/18px (celular), 16px (≥900): usado em / e /temas (h1 dentro de `.sv-folio sv-gh`).
- sv.css:115 `.sv-folio--dom h1` 21px → 38px: /pessoas, /votacoes, /decisoes, /como-funciona, /comecar.
- sv-pessoa.css:5 `.sv-cab h1` 26px → 36px: as 5 rotas de pessoa.
- sv.css:120 `.sv-topq h1` 28px → 46px: /acompanhando, /ajustes.
- Na Início o h1 "O que está rolando?" (14px) é menor que o h2 "Esta semana" (`.sv-th` 22px, sv-inicio.css) e que a resposta do quadro (23px). A página não tem título dominante no celular.
- Critério de teste: h1 computado ≥ 21px a 390px em todas as rotas, e h1 ≥ h2 em toda página.

D02 | mensuravel | `.sv-vl` definido para dois componentes diferentes
- sv-inicio.css:117-119 `.sv-vl` = lista (ul) de votos de um escolhido (usado em components/sv/inicio/escolhidos.tsx:188).
- sv.css:487-500 `.sv .sv-vl` = item (li) de uma votação em lista (components/sv/votacao-item.tsx:36), com `border-top`, `padding:8px 0 10px` e, a ≥900px, `display:grid; grid-template-columns:2fr 7fr 3fr` + `.sv-vl>*{grid-column:2}`.
- Especificidade (0,2,0) vence (0,1,0): o `ul.sv-vl` do cartão do escolhido na Início ganha régua, padding e, no desktop, grade de 3 colunas com todos os filhos na coluna 2 (os `li` ficam espremidos em 7/12). Não consegui ver renderizado porque a Início de demonstração não tem escolhidos; a conclusão é da cascata.
- Correção: renomear um dos dois (ex.: `.sv-ivt` para a lista da Início).

D03 | mensuravel | `.sv-esc__n` / `.sv-esc__c` com dois dono-componentes e tamanhos conflitantes
- sv-inicio.css:112 `.sv-esc__n` 19px (24px em 123, ≥900) para o cartão da Início.
- sv-escolhidos.css:9 `.sv .sv-esc__n` 24px (34px em :31, ≥900) para o cabeçalho em /acompanhando.
- Os dois CSS são carregados juntos (casco.tsx:5-6); o seletor mais específico vence: o nome no cartão da Início sai com 24px/34px, não 19px/24px como o CSS da própria tela declara. O mesmo vale para `.sv-esc__c` (inicio 14/15px vs escolhidos 15px) e `.sv-esc__id`.
- Mesma raiz de D02: namespaces BEM reutilizados entre telas.

D04 | mensuravel | Link "← Voltar a Nome" das rotas da pessoa herda estilo de outra tela
- sv-decisao.css:39 `.sv-vt{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1.5px solid}` (global, sem prefixo `.sv`) é da tela Decisão.
- HTML real: `<p class="sv-vt sv-vt--sub"><span>←</span> Voltar a <a>Helena Siqueira</a></p>` em /pessoa/helena-siqueira/{votos,gastos,mandato,equipe} (components/sv/pessoa/sub.tsx:11) e `<p class="sv-vt">` em pessoa/[slug]/page.tsx:284.
- sv-pessoa.css:58 `.sv-vt--sub` só define display:flex/wrap/align-items; não reseta `flex-direction:column`, nem a régua nem a margem. Resultado esperado: seta, texto e link empilhados em coluna e uma linha de 1.5px acima do link. Verificar em navegador (conclusão da cascata).

D05 | mensuravel | Alvo de toque de 24px em link de votação
- sv-escolhidos.css:18 `.sv .sv-esc__vv-t a{...min-height:24px}`; usado em components/sv/escolhidos/quadro.tsx:112 (link para cada votação, em /acompanhando e no painel de escolhidos). Regra de produto: ≥44px. Os demais links do sistema usam 44px.

## MÉDIA

D06 | mensuravel | O título de seção (h2 "pergunta") é o texto de menor peso visual da página
- sv.css:157 `.sv-p` (todos os h2 dos quadros): 15px/600, `font-stretch:84%`, cor --tinta2; 16px só ≥900. O corpo `.sv-t` é 16px (19px no quadro dom) em tinta cheia.
- Em /pessoa/helena-siqueira são 21 h2 `.sv-p`; o leitor escaneia títulos que são mais fracos que o parágrafo abaixo. Na Início, convive com `.sv-th` (22px/800) para "Esta semana", "Já rolou", "Vai rolar": dois estilos de h2 na mesma tela.
- Intencional na D2 (a resposta é o destaque), mas não bate com o critério "h2 ≥ corpo". Teste: font-size h2 ≥ corpo.

D07 | mensuravel | Texto que carrega lacuna, legenda e data em 13px
- sv-inicio.css:140 `.sv-d__nada` 13px/84% condensado: "Nada do que acompanhamos está marcado no Congresso para amanhã." É o estado vazio do dia; lacuna nomeada num tamanho menor que o corpo.
- sv.css:229 `.sv-leg` 13px: legenda "já vale / ainda não vale / não passou" (chave de leitura dos símbolos da semana).
- sv-pessoa.css:67 `.sv-votos__q` 13px: data de cada voto. sv-pessoa.css:33 `.sv-pr__l` 13px (meses).
- Contagem: dos 280 `font-size:Npx` nos sv*.css, 26 são 13px, 37 são 14px, 40 são 15px (106 abaixo de 16px).

D08 | mensuravel | Proveniência e aviso de demonstração em 13px
- sv.css:188-190 `.sv-prova`, `.sv-fonte`, `.sv-nota` 13px; sv.css:108 `.sv-demo` 13px ("Versão de demonstração... números são fictícios"); sv-inicio.css `.sv-lemos` 13px.
- "Quem leu, quando e de onde" é o diferencial do produto e fica no menor corpo da página. Sugestão de critério: 14px mínimo para proveniência, 16px no aviso de demonstração.

D09 | mensuravel | Navegação principal em 14px no celular, 21px no desktop
- sv.css:64 `.sv .sv-nv a` 14px/600/90% condensado, 4 colunas iguais (390px → ~97px por item; "Meus escolhidos" quebra em duas linhas); sv.css:80 sobe para 21px a ≥900. Salto de 1,5x e menor texto interativo do site justamente na navegação.

D10 | mensuravel | Botões: mesmos desenhos em classes diferentes; controles outlined com tamanhos diferentes
- `.sv-btn` (sv.css:408: 16px/800, min-height 48, padding 0 18, fundo tinta) e `.sv-enviar` (sv.css:285: 16px/800, min-height 48, padding 0 18, fundo tinta): visualmente idênticos, duas classes, JS/TSX escolhe uma ou outra.
- Outlined: `.sv-follow` 15px/44px (sv.css ~420), `.sv-facil` 16px/44px (sv.css:85), `.sv-ent a` 16px/44px (sv-inicio.css:78), `.sv-escopo a` 16px (sv-pessoa.css:99), `.sv-ufs a` 16px (sv-votacao.css:5): 15 vs 16px sem motivo.
- Raio: `.sv-chk input` border-radius:6px e `::after` 3px (sv.css:272-273) contra raio 0 em todo o resto (inclusive no DIRECAO.md).

D11 | mensuravel | Tabelas `.sv-gm` (e `.sv-g`) duplicadas com valores divergentes
- sv-pessoa.css:50-54 e sv-mandato.css:20-27 definem `.sv .sv-gm`: padding 4px 0 e `td{padding-right:10px}` num; 5px 0 e `td{padding-left:8px}` + `.sv-gm__n` no outro. Mesma especificidade; vale a ordem de importação (sv-mandato.css não está no casco, é importado por componente), então o ritmo da mesma tabela muda conforme a rota que carrega primeiro.
- Critério: um único bloco `.sv-gm`.

D12 | mensuravel | Lacuna tem 4 tratamentos visuais e 5 redações
- Visual: caixa tracejada 2px (`.sv-lac__liso`), texto cru de 13px (`.sv-d__nada`), parágrafo de 15px (`.sv-resto`), quadro tracejado inteiro (`.sv-quadro--lacuna`).
- Redação no HTML: "Ainda não carregamos esse dado." / "Ainda não temos esse dado." (/pessoa/helena-siqueira, 6 ocorrências) / "Sem nota neste mês" (/gastos) / "A fonte não publicou o placar total desta votação." (/votacoes) / "Nada do que acompanhamos está marcado..." (/).
- Nenhuma mostra zero no lugar de lacuna (ponto a favor). Critério: um componente de lacuna com texto parametrizado por motivo.

D13 | mensuravel | Numeração e estilo dos h2 mudam entre telas
- /pessoa/helena-siqueira: 4 h2 sem número, "Como foi 2026?", depois 1 a 13 numerados, depois 2 sem número: duas numerações na mesma página, 21 h2.
- "Quem conferiu isso?" numerado em /pessoas (3), /votacoes (4), /decisoes (4); sem número em /pessoa/*, /votos, /equipe, /acompanhando, /ajustes.
- /ajustes: primeiro h2 é `.sv-sub` (16px/700), os demais `.sv-p`; /acompanhando tem h2 "Você ainda não marcou ninguém." no mesmo estilo de pergunta.

D14 | gosto (com parte mensuravel) | Duas cores de destaque e tokens diferentes do DIRECAO.md
- sv.css:6 `--agora:#8A4A2E` (terracota) e `--vida:#0B3F4D` (azul-petróleo), usados em: data do fólio, fio do bloco "Esta semana", coluna "Hoje" (fundo `--agora-luz`), "O que muda:", número do quadro 3, "Se aprovado". Regra de produto e DIRECAO.md: uma cor só (--tint) e --ok/--warn/--err só para estado do sistema.
- Contraste ok (agora/papel 5,85:1; tinta2/papel 7,88:1; vida/papel 9,9:1).
- Tipografia e tokens: Bricolage Grotesque variável (DIRECAO: Newsreader + IBM Plex Sans/Mono + Barlow Condensed); --papel #F2EEE5 vs #f3efe6; --tinta #141414 vs #1c2226; sem `.plate` de borda dupla (borda sólida 3px), sem `.crumb`/`.stamp`. A D2 é decisão posterior documentada no cabeçalho de sv.css; o que fica é decidir se a regra "uma cor" vale com duas.

## BAIXA

D15 | mensuravel | CSS morto: ~33 classes sem uso em src/ nem nas 18 rotas renderizadas
- sv-band, sv-cols, sv-grid, sv-hero, sv-impact, sv-input, sv-kick, sv-kind, sv-lado, sv-lead, sv-more, sv-mt-3/4/5, sv-muda, sv-name, sv-narrow, sv-wide, sv-place, sv-qa, sv-quem, sv-quote, sv-tag, sv-title, sv-gloss, sv-checks, sv-cont2, sv-c4/c6/c8, sv-gg/gi/gw (sv.css §legado, linhas ~305-440, e §13). Variantes dinâmicas (`sv-a--*`, `sv-quadro--*`, `sv-m--*`, `sv-vf--*`) conferidas e não contam como mortas.
- Remover reduz sv.css (39KB) e tira a ilusão de que há um sistema de texto com `.sv-hero/.sv-title`.

D16 | mensuravel | Duas implementações do glifo de voto e componentes legados com peso 300 em corpo pequeno
- `.sv-m` 16px (sv.css:214, ui.tsx Forma) vs `.sv-mark` 15px (sv.css ~380, `VoteMark` em ui.tsx:127-135). `VoteMark` dá `mark:""` para Obstrução, Presidia e Sem voto (ui.tsx:121-123): três estados com o mesmo quadrado vazio, distintos só pela palavra.
- Peso 300 em texto de 13–14.5px: `.sv-voterow small` 13px (sv.css:367), `.sv-item small` 13px (403), `.sv-quote` 14px (412), `.sv-bar>span` (371); tamanhos fora da escala: 14.5px (`.sv-voterow div`, `.sv-notice p`), 15.5px (`.sv-item>div`). Usados por followed.tsx/follow.tsx e telas legadas (not-found, /no-seu-bolso).

D17 | gosto | Data de hoje some no celular
- sv.css:116 `.sv-so-larga{display:none}` abaixo de 900px; na Início a data ("quinta, 26/11/2026", classe `sv-agora`) só aparece no desktop. No celular o único ancoramento de data é o intervalo "23 a 29 de novembro" no h2.

D18 | mensuravel | Título de proposta truncado no meio da palavra
- components/sv/inicio/semana.tsx:16 `clip(..., 150)`; HTML de /: "…, 5.989, de 17 de dezembro de 1973, 7.573, de 23 d…" no título 21px (`.sv-dec--1 .sv-dec__t`) de PL 79/2020 (ementa jurídica de 150+ caracteres). A ementa fica ilegível como título; truncar na fronteira de palavra ou usar `plain` quando existir.

D19 | gosto | Rodapé público aponta para o desenho antigo
- components/sv/shell.tsx:96 "Páginas do desenho anterior" → /no-seu-bolso, no rodapé de todas as telas, entre links do produto novo.

D20 | gosto | `font-stretch` 84–88% em texto de 13–15px
- `.sv-p`, `.sv-esf`, `.sv-q4__i dt`, `.sv-d__nada`, `.sv-prova`, `.sv-votos__q` usam estreitamento de 84–88% em corpo pequeno e cinza (--tinta2). Soma-se a D07/D08: o texto mais importante para conferência é pequeno, cinza e condensado.

D21 | mensuravel | Token inexistente com fallback
- `var(--s4,16px)` em sv-aviso.css:3 e sv-decisoes.css:14: `--s4` não está definido em nenhum arquivo sv*.css, tokens.css nem tailwind-theme.css (grep). Só o fallback funciona; trocar por valor literal ou definir a escala de espaço (o DIRECAO lista 4 8 12 16 18 24 32 40 64, mas o CSS usa 2,3,4,5,6,7,8,9,10,12,14,18,22... px soltos).

D22 | mensuravel | Escala de espaçamento e tamanhos sem sistema
- 27 valores distintos de `font-size` (13, 14, 14.5, 15, 15.5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 32, 34, 36, 38, 40, 44, 46, 56) no sv*.css; respostas `.sv-a` com 7 variantes (20, 21, 23, 25, 30, 34 + clamps). A mesma "resposta" aparece em 19/20/21/23/25px conforme a tela (`.sv-a--fala`, `--m`, `--r`, `.sv-nc__l .sv-a`, `.sv-pm__b .sv-a`). Critério: ≤ 8 degraus tipográficos nomeados.

Sem achado (verificado): tabelas de placar (`.sv-cont`, 4 linhas, 2 colunas) cabem em 320px; filtros e links principais têm 44px; mapa documenta a exceção do dono; sem barras que ranqueiem pessoas (a barra de gastos é por categoria da mesma pessoa).
