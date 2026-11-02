# Componentes

Fonte: o inventário de componentes de `recon.md` + o que faltou lá (foco, carregando, erro, vazio).
Tokens: `tokens.json` → `tokens.css` e `tailwind-theme.css` (gerados por `build-tokens.mjs`).
Classes usam papéis (`bg-surface text-muted border-border`), nunca hex.
Base acessível: React Aria Components (combobox, dialog, tabs, select, toggle, tooltip). Ícones: Lucide (ISC).
Primitivas em `web/src/components/ui/`, vitrine em `/design`.

Regras transversais:
- **Foco:** `focus-visible` mostra um anel de 2px em `focus`, com offset de 2px. Nunca `outline: none` sem substituto.
- **Alvo de toque:** pelo menos 44×44 px (`layout.tap-min`). Chip de 32 px visual tem área de toque estendida por padding.
- **Números:** `tabular-nums`. Valor não publicado é "—" com `aria-label="não publicado pela fonte"`, nunca 0.
- **Neutralidade:**
  - Cor não codifica partido, espectro nem avaliação.
  - Sim/Não/Aprovado/Rejeitado usam ícone + palavra, em tom neutro.
  - `success`/`danger`/`warning` são só para estado de sistema.
- **Movimento:** `motion.base` 200 ms para hover/estado; `motion.enter` 420 ms para bloco entrando. Tudo cai para 0 com `prefers-reduced-motion`.
- **Texto:** toda copy é nossa. Os rótulos abaixo são provisórios e mudam no replica-brand.

---

## Button
```
variants  primary (bg accent / on-accent), secondary (surface + borda border-input), ghost (sem borda), inverse (surface-inverse / on-inverse), danger (só ações destrutivas de conta)
sizes     sm 32px, md 40px, lg 48px; formato pílula (radius pill); ícone opcional à esquerda
states    default, hover (fundo 8% mais escuro via color-mix), pressed, focus-visible (anel 2px focus), disabled (opacity .5, cursor not-allowed, aria-disabled), loading (spinner + rótulo mantido, aria-busy)
tokens    font sm/600, padding-x space-6 (md), border control 1.5px
a11y      <button> real (RAC Button); link que parece botão é <a>; loading não troca o texto lido pelo leitor
used on   S02, S05 (Monitorar, Compartilhar), S08, S20, S25, header
```

## Chip / SegmentedTabs
```
variants  filter chip (toggle), tab pill (seleção única), action chip (link: "Ver no mapa")
sizes     sm 32px visual / 44px de toque
states    default (surface + borda border), hover, selected (surface-inverse / on-inverse — o padrão invertido do original), focus-visible, disabled
overflow  linha rolável horizontal com botões ‹ › que aparecem só quando há overflow; gradiente de fade nas bordas; rolagem por teclado com setas
a11y      SegmentedTabs com renderPanel = RAC Tabs (role=tablist + tabpanel, setas, Home/End); sem painel cai para ToggleButtonGroup (aba sem painel deixa aria-controls quebrado — achado do axe); links quando navega
used on   S01 (camadas), S04 (cargos), S05 (anos), S09, S12, S14, S15, S16, S17, S19
```

## Combobox (busca)
```
variants  lugar (cidade/UF: "Campinas · SP", "São Paulo · estado"), pessoa (nome · cargo · UF), global (grupos: Pessoas, Lugares, Cargos)
states    vazio (exemplos clicáveis abaixo), digitando (debounce 150ms, min 2 chars), carregando (spinner no campo, lista mantém anterior), resultados, sem resultado ("Nada com esse nome. Tente sem acento ou só o começo."), erro de rede ("Não deu para buscar agora." + tentar de novo)
tokens    campo h48 radius pill, borda border-input, ícone lupa muted; popover surface + shadow pop, radius md; opção ativa = accent-soft + barra interna 3px focus (surface-sunken sozinho some no escuro)
keyboard  ↓/↑ navega, Enter escolhe, Esc fecha e depois limpa, Tab sai sem escolher
a11y      RAC ComboBox (role=combobox, aria-expanded, aria-activedescendant); contagem anunciada em live region ("5 resultados"); homônimos sempre com UF
used on   S01, S03, S06, S07, S08, S14, S23
```

## Select
```
variants  estado, partido, ano
states    default, open, selected, focus-visible, disabled
a11y      RAC Select (listbox), opção "todos" primeiro, depois A–Z pt-BR
used on   S04, S05, S11
```

## BigNumber (HeroCounter)
```
variants  hero (font display, text-hero, 800, com legenda abaixo), inline (display text-display)
states    estático, ao vivo (atualiza a cada 30s; transição de número sem animação de contagem se reduced-motion), carregando (skeleton com largura do último valor)
a11y      número + legenda num só nó lido ("70.800 pessoas no cargo hoje"); ao vivo usa aria-live="polite" só no contador, não na página
used on   S01, S05, S09, S15, S16, S17
```

## StatTile
```
variants  dinheiro, contagem, percentual, teto (valor estimado, rótulo "teto" explícito)
anatomy   valor (display xl, tabular-nums) / legenda (sm muted) / subtexto (xs muted) / botão "?" com explicação
states    preenchido, "—" não publicado (motivo no "?"), carregando (skeleton), desatualizado (selo warning "dados de dd/mm")
tokens    surface, radius sm, borda border, padding space-6
a11y      "?" é RAC Tooltip/Popover acionável por teclado; valor monetário lido por extenso via Intl ("46 mil reais")
used on   S05, S08
```

## PersonCard
```
variants  compacto (nome · cargo · UF · partido em texto), com foto (avatar 56px; sem foto licenciada → iniciais sobre surface-sunken), com "+ Comparar"
states    default, hover (borda border-input), focus-visible, selecionado p/ comparar (borda accent + ícone check), comparador cheio (botão desabilitado com motivo "máximo 5")
a11y      card inteiro é um <a> para o crachá; "+ Comparar" é botão separado (não aninhado no link); cargo flexionado (Vereadora/Vereador) vem do dado
used on   S01, S04, S07, S09
```

## BrazilMap
```
variants  regiões (5 tons region-*), UFs, choropleth (escala sequencial de accent, só para valores — arrecadação), cidade destacada
states    default, hover/focus (contorno 2px focus), selecionado (contorno 3px fg), drill-down (região → UF → cidade, Esc volta um nível)
a11y      SVG com role=group; cada UF é <a>/<button> focável com aria-label "Bahia, Nordeste"; lista textual equivalente sempre visível abaixo (RegionList) — o mapa nunca é o único caminho
fonte     geometria de svg-maps (CC BY 4.0) com atribuição no rodapé; desenho dos estilos é nosso
used on   S01, S16
```

## Hemicycle
```
variants  Câmara (513), Senado (81), Assembleia (n)
states    nenhum filtro (todas as cadeiras seat), partido escolhido (cadeiras do partido seat-active + anel; demais seat), hover/focus numa cadeira (tooltip nome · partido · UF)
regra     cor NÃO codifica partido. Ordem das cadeiras segue o critério publicado em /sobre; a cor só destaca a seleção do usuário
a11y      filtro de partido = botões com aria-pressed (não role=radio sem setas); tabela alternativa "Bancadas" sempre disponível; contagem do filtro em live region; coordenadas arredondadas a 2 casas (Math.cos/sin divergem entre Node e navegador → hydration mismatch)
used on   S09, S11
```

## Timeline (ano › mês › dia)
```
variants  votos, leis, propostas, mandatos, falas
anatomy   cabeçalho de ano (sticky), mês (xs uppercase muted), item com data (mono xs), corpo e rodapé de referência ("PL 3228/2026")
states    colapsado ("Ver mais N"), carregando mais (botão loading), fim da lista, vazio ("Nenhum registro neste ano." + link para o ano anterior com dado)
a11y      <ol> por ano; "Ver mais" move foco para o primeiro item novo
used on   S05, S09
```

## VoteBadge
```
variants  voto: Sim (ícone check), Não (ícone x), Abstenção (ícone circle-slash), Obstrução, Art. 17, Não votou (ícone minus, texto muted); resultado: Aprovado, Rejeitado
tokens    todos em surface-sunken + text, borda border; NUNCA verde/vermelho (decisão de neutralidade — o original usa)
a11y      a palavra é sempre visível; ícone aria-hidden
used on   S05, S08, S09, S10
```

## TopicTag
```
variants  17 temas (regra por palavra-chave publicada)
tokens    accent-soft / accent-text, radius pill, xs/600
a11y      quando filtrável, é um link para o filtro; texto completo no title não é necessário (rótulo curto é o próprio tema)
used on   S05, S09
```

## BarBreakdown
```
variants  horizontal com valor à direita (gastos por categoria, emendas por área, origem de campanha)
tokens    trilho surface-sunken, barra accent, rótulo sm, valor sm tabular-nums
states    preenchido, vazio, "outros" agregando cauda (>8 itens)
a11y      é uma <table> estilizada (categoria, valor, %); barra aria-hidden
used on   S05, S12, S16
```

## CompareTable
```
anatomy   cabeçalho sticky com foto + nome (2–5 colunas), grupos de linhas (Quem é, Eleições, Patrimônio, Atividade), primeira coluna sticky no mobile
states    preenchido, célula "—" (motivo em nota de rodapé), não se aplica ao cargo ("não se aplica"), carregando coluna nova
a11y      <table> real com <th scope>; remover pessoa = botão com aria-label "Remover Fulano da comparação"; ordem das colunas = ordem de escolha (sem ranking)
used on   S08
```

## CalendarMonth
```
variants  agenda do Plenário (Câmara/Senado), agenda do STF
anatomy   grade 7 colunas; dia com número de votações (badge) e contorno se sessão marcada
states    hoje (anel focus), selecionado (surface-inverse), sem eventos, mês sem dados
a11y      RAC Calendar (grid, setas, PageUp/Down troca mês); cada dia tem aria-label com contagem ("3 de novembro, 1 sessão marcada")
used on   S09, S15
```

## SourceFooter
```
anatomy   "Fonte: <nome com link> · atualizado em dd/mm/aaaa" em mono xs muted; opcional "como contamos" (link)
states    em dia, desatualizado (selo warning "pode estar desatualizado" quando passa do SLA do dataset), fonte fora do ar (texto "última atualização confirmada em …")
a11y      é <footer> do bloco; datas em <time datetime>
used on   todo bloco de dados
```

## MissingDataNote
```
anatomy   lista "– Dado: não está no site · motivo" + link "como ajudar a trazer"
tokens    warning-soft / text, ícone info, radius md
a11y      título do bloco "N dados faltam para este lugar"; cada motivo é texto, não só ícone
used on   S05, S07, S23
```

## Dialog / Toast
```
variants  modal (onboarding, confirmação de apagar conta), sheet inferior no mobile (compartilhar), toast (dica contextual, erro de envio)
states    aberto, fechando, fechado; toast some em 6s exceto erro (fica até fechar)
a11y      RAC Modal/Dialog: foco preso, Esc fecha, foco volta ao gatilho; onboarding só na 1ª visita, com "Pular" visível e sem bloquear rolagem de leitor de tela; toast em role=status (erro em role=alert)
used on   S02, S05, S08
```

## ListenButton
```
states    parado, lendo (ícone pausa, rótulo "Pausar leitura"), indisponível (navegador sem speechSynthesis → botão some, não fica desabilitado)
a11y      aria-pressed; lê só o <main>, pt-BR
used on   todas
```

## ThemeToggle
```
variants  sistema, claro, escuro (ciclo ou menu)
a11y      RAC ToggleButtonGroup; escolha salva em localStorage e aplicada antes da pintura (script inline) para não piscar
used on   header
```

## Form (EmailInput, OTPInput, Textarea, ChoiceChips)
```
states    vazio, preenchendo, inválido (mensagem abaixo em danger, aria-invalid, aria-describedby), enviando (botão loading), enviado (painel success-soft), erro de servidor (alert danger-soft com tentar de novo), limitado ("Muitas tentativas. Tente em 10 min.")
OTP       6 campos ou 1 campo com inputmode=numeric autocomplete=one-time-code; colar preenche tudo
a11y      label visível sempre (não placeholder); erro anunciado; Turnstile com alternativa acessível
used on   S20, S25
```

## ShareButton
```
variants  card (abre Web Share API com a imagem OG), copiar link (toast "Link copiado"), WhatsApp (link wa.me com texto nosso)
states    default, compartilhando, copiado, sem Web Share (cai para menu copiar/WhatsApp)
used on   S05, header
```

## AppHeader / BottomNav (shell, medido no original)
```
desktop   header de 2 linhas (~112px): logo + busca + entrar + utilitários; nav em pílulas rolável; barra fina "Dados atualizados em … · como atualizamos"
mobile    header 56px (logo, entrar, compartilhar) + BottomNav fixa 64px com 5 destinos e ação central "Minha cidade" (lugar). Respeita safe-area-inset-bottom
states    item ativo (surface-inverse), foco, rolagem esconde a barra de atualização
a11y      <nav aria-label="Principal">, aria-current="page", link "Pular para o conteúdo" como primeiro foco
used on   todas
```

## Skeleton / EmptyState / ErrorState (faltavam no recon)
```
Skeleton    blocos surface-sunken com pulso 1.2s (sem pulso em reduced-motion); preserva a altura final para não pular layout
EmptyState  ícone + frase + próxima ação ("Ninguém com esse filtro. Limpar filtros")
ErrorState  "Não conseguimos carregar este bloco." + tentar de novo; o resto da página continua (erro é por bloco, não por página)
```

---

## Estado da implementação (v0)

Construídas em `web/src/components/ui/` e exibidas em `/design`: Button, SegmentedTabs, FilterChips, PlaceCombobox, BigNumber, StatTile, VoteBadge, TopicTag, BarBreakdown, SourceFooter, MissingDataNote, PersonCard, Hemicycle, ThemeToggle, ListenButton, EmailField, OnboardingDialog, Skeleton.

Ainda só especificados (entram junto da tela que os usa): BrazilMap (S01), CalendarMonth (S09, S15), CompareTable (S08), Timeline (S05), Select, Toast, ShareButton, AppHeader/BottomNav, OTPInput, EmptyState/ErrorState.

Verificação:
- `npm run contrast`: 64 pares, 0 falhas AA.
- axe-core 4.10 em `/design`: 0 violações (WCAG 2.2 A/AA + best practices), nos temas claro e escuro.
- Sem rolagem horizontal em 375 px.
- `tsc` e `eslint` limpos.
