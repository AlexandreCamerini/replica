# Parity: clone cívico × Politicômetro

Rodada: diff detalhado contra o original ao vivo (politicometro.org, lido em 2026-11-02 ~22h). Build do clone: f03f5b6 (build 4). Rodadas anteriores estão no histórico do git deste arquivo.

Premissas desta rodada:
- O original foi lido pelo HTML servido (SSR) de 22 rotas + crachá real (`/p/adriana-ventura`), cidade (`/representantes?cidade=3509502`, Campinas) e comparar (`?p=adriana-ventura,baleia-rossi`). Nada foi raspado para dentro do clone; só a estrutura e a lista de funções.
- O clone foi lido pelo código (`web/src/app`, `components`, `etl/civico_etl/jobs`). Não subi o clone nem o Postgres neste worktree, então **o layout não foi recapturado**: a nota de layout é a da rodada anterior (mesmas imagens). A nota de feature é a que decide e foi refeita.

## Placar

| | nota | antes | por que mudou |
| --- | --- | --- | --- |
| **Geral** | **56,4 / 100** | 58,7 | features caiu, layout igual |
| Features | **62,4 / 100** | 73,5 | 13 features do original que não estavam na matriz entraram (todas `no` ou `partial`). O clone não regrediu: o alvo cresceu e o recon tinha pontos cegos |
| Must-haves | 17 de 17 | 17 de 17 | — |
| Layout | 32,4 / 100 | 32,4 | não recapturado (ver premissas) |

Para chegar a 80 faltam **20,6 pontos** de feature (≈ 12 shoulds `no` → `yes`).

**Veredito: não entregável.** Nenhum must faltando e nenhum S1/S2 aberto, mas feature score 62,4 < 80.

## O que o diff achou que o recon não tinha

| achado no original | onde | clone hoje | peso |
| --- | --- | --- | --- |
| Dados de **deputados estaduais** de 29 Assembleias (presença, votos, propostas, verbas), semanal | `/atualizacoes` | só TSE | should |
| Dados de **vereadores** de 937 Câmaras Municipais com SAPL, um site por vez, releitura a cada 7–14 dias | `/atualizacoes` | só TSE | should |
| **Como atualizamos**: tabela fonte × o que traz × frequência × última carga, rotina com horários, "fora do prazo", "o que a rotina nunca faz" | `/atualizacoes` | stub | should |
| **Direito de resposta** no fim de todo crachá, ao lado de "Reportar erro" | crachá | não existe | should |
| **Presença em gráfico**, "2026 em números" e **ano a ano** (8 anos, da presença à cota) | crachá | não existe (dado está em `person_period_stats`) | should |
| **Deputados mais votados na cidade** (federal e estadual, 2022) | `/representantes?cidade=` | não existe (votos por município já carregados) | should |
| **Em que votaram diferente**, filtrado por tema (400 pautas, 16 temas), "Mostrar mais" | comparar | só % por par | should (já partial) |
| **Equipe do gabinete** com nome e salário (14 pessoas · R$ 115 mil/mês) | crachá | "entra na próxima fase" | should (já partial) |
| Campanha: **de onde veio** (fundo partidário, partido, PF, coletivo) e **com o que gastou**, por eleição | crachá | só totais | should (já partial) |
| Salário acumulado "recebeu desde 02/2019 em 94 meses" | crachá tile | não | could |
| "Como cobrar" + dados civis | crachá | escolaridade sim, "como cobrar" não | could |
| Copiar link e WhatsApp no topo de toda página | header | só no crachá | could |
| Onboarding de 3 passos | 1ª visita | `OnboardingDialog` existe, só usado em `/design` | could |
| Sanções TCU/CGU; salários de prefeito/vereador via Tribunais de Contas; contas dos estados (Tesouro) | `/atualizacoes` | não | could |
| Como ajudar (mandar dado da cidade, avisar erro, espalhar, apoiar) | `/ajudar` | stub | could |

Matriz atualizada em `features.csv` (linhas com "diff 2026-11-02" nas notas).

## Comportamento por fluxo

| fluxo | original faz | clone faz | decisão |
| --- | --- | --- | --- |
| F01 achar quem me representa | campo → cidade → pessoa; cidade traz ações, mais votados na cidade e "nenhum destes dados de X está no site" | igual, sem JS funciona; falta "mais votados" | fix: mais votados (W1) |
| F02 mapa | malha IBGE, região → UF → cidade, Esc volta, 6 camadas | igual sem as camadas | manter; camadas só em W4 |
| F03 ler o crachá | ~25 blocos, cada um recolhível com resumo no título ("Como votou · 52 sim · 61 não") | ~15 blocos; filtros na URL; "—" com motivo | fix: presença/ano a ano, direito de resposta (W1); campanha detalhada e equipe (W2) |
| F04 comparar | "Votaram igual?" + lista de divergências com filtro por tema | só % por par | fix (W1) |
| F05 monitorar | e-mail → código → feed; "receber atualizações por e-mail ou WhatsApp" | e-mail → código → feed; sem envio do resumo | fix: Resend + descadastro (W3, precisa de conta sua) |
| F06 compartilhar | card pronto para Instagram/WhatsApp; WhatsApp e copiar link no topo de toda página | Web Share + WhatsApp só no crachá; sem imagem | fix: OG (W2), topo (W1) |
| F07 congresso | abas "sendo votado" / "virou lei", agenda com pauta das 16h, sessão ao vivo | hemiciclo + votações nominais + S10 | fix: aba "virou lei" sobre `laws` já carregado (W2); agenda exige ETL (W3) |
| F08 reportar erro | Reportar erro + **Direito de resposta** no crachá; sugestão geral | Reportar erro → S25 | fix: direito de resposta (W1) |
| frescor do dado | "Atualizado 02/11, 22:02" no topo + página com última carga por fonte e "fora do prazo" | barra global com data; página stub | fix: S24 (W1) |
| neutralidade | hemiciclo **na cor do partido**; `/partidos` ordena por pesquisa de especialistas; `/mais-vistos` mostra "em alta" | cadeiras neutras, A–Z, testado | **manter o clone**: é a vantagem; se fizer partidos/mais vistos, sem ordem por popularidade nem por régua ideológica |

## Plano de complemento

Ordem por pontos ganhos ÷ custo. Cada onda fecha com `parity.py` + suíte e2e verde. Estimativa de nota acumulada ao fim de cada onda.

### W1 · dado já está no banco, só tela (+15,4 → 77,8)

| # | item | ganho | critério de aceite |
| --- | --- | --- | --- |
| 1 | S22 Metodologia e fontes (`/sobre`) | +1,7 | texto próprio com âncoras: neutralidade, regra de presença, "—" vs 0, identidade entre fontes, privacidade (`#s-priv`), direito de resposta; links de todo rodapé resolvem |
| 2 | S24 Como atualizamos (`/atualizacoes`) | +1,7 | tabela por fonte lida de `data_coverage`/proveniência: o que traz, frequência, última carga; "fora do prazo" calculado (última carga > frequência); teste com fonte atrasada artificial |
| 3 | S23 Quem publica (`/dados-abertos`) | +1,7 | matriz UF × tipo de dado com % de cidades; busca de cidade; CTA para S25 `tipo=dado`; números batem com `data_coverage` (teste) |
| 4 | Direito de resposta no crachá | +1,7 | link no fim de todo crachá → S25 com `tipo=resposta&p=slug`; mensagem guardada com pessoa e data; política de resposta descrita em S22 |
| 5 | Presença em gráfico + "ano em números" + ano a ano | +1,7 | um gráfico de presença por mês do ano selecionado; tabela ano × (presença, propostas, votos, cota); Senado mostra "—" na presença com motivo; acessível (tabela por trás do gráfico) |
| 6 | Mais votados na cidade (S07) | +1,7 | top 5 federal e top 5 estadual da última eleição geral, votos no município, ligando ao crachá; cidade sem dado → "—" com motivo |
| 7 | Busca global no header (S03) | +1,7 | combobox único "político, cidade, estado ou cargo" com grupos; sem JS cai em `/quem?nome=` ; teclado completo; usa `/api/people/search` + `/api/places` |
| 8 | Comparar: em que votaram diferente | +0,9 | lista das votações em que o par divergiu, com filtro por tema e "mostrar mais"; filtro na URL; 2–5 pessoas = divergência por par escolhido |
| 9 | Copiar link + WhatsApp no topo | +0,9 | em toda página, com a URL canônica (sem parâmetros de rastreio) |
| 10 | Salário acumulado no crachá | +0,9 | soma do valor pago desde a posse, meses no cargo; "—" se a casa não publica valor pago |
| 11 | Onboarding ligado + "Como cobrar" | +0,8 | `OnboardingDialog` na 1ª visita (cookie, sem storage obrigatório, "Pular"); "Como cobrar" = contato oficial + ouvidoria da casa |

### W2 · parciais que viram `yes` (+4,3 → 82,1, entregável; simulado com `features.csv`, sem contar o item 15)

| # | item | ganho | critério de aceite |
| --- | --- | --- | --- |
| 12 | Card OG do crachá (S28) | +0,9 | `opengraph-image` por slug, 1200×630, nome, cargo, partido, 4 números com fonte; sem foto não licenciada |
| 13 | Campanha: origem e gastos | +0,9 | por eleição, receitas por origem e despesas por categoria (TSE prestação de contas, já baixada); nunca nome de pessoa física doadora |
| 14 | Equipe do gabinete + viagens | +0,9 | Câmara (secretários parlamentares) e Senado (missões); se a casa não publica, "—" com motivo |
| 15 | Congresso: aba "o que virou lei" | 0 (continua partial até a agenda da W3) | leis por data a partir de `laws`; a agenda fica para W3 |
| 16 | Entenda os cargos (S18) e Dicionário (S19) | +1,8 | texto próprio, cada item com artigo da Constituição ou fonte oficial |

### W3 · dado novo ou conta sua (+8,4)

| # | item | bloqueio |
| --- | --- | --- |
| 17 | ETL Assembleias Legislativas (deputados estaduais) | 27 fontes heterogêneas; começar por SP, MG, RJ, RS (maioria da população) e as que usam SAPL |
| 18 | ETL SAPL das Câmaras Municipais | crawler educado (1 site por vez, respeitar intervalo), descoberta das 900+ instâncias; maior custo do plano |
| 19 | Emendas parlamentares | chave do Portal da Transparência (sua) |
| 20 | Resumo por e-mail + descadastro (F05) | Resend + domínio (seus) |
| 21 | Agenda/pauta do Congresso e sessão ao vivo | ETL de pauta (16h) |
| 22 | Sanções TCU/CGU; salários via Tribunais de Contas | fontes novas |

### W4 · could de área inteira (só depois de entregável)

Partidos (com critério de espectro público e citável, ou sem espectro), Governos, Planos de governo, Eleições, STF, Impostômetro, Mais vistos, MCP, camadas do mapa, Como ajudar. MCP é o melhor candidato a diferencial: o original ainda diz "em breve".

## Riscos

- **W3 é o fosso do original.** As 937 câmaras SAPL + 29 Assembleias são o que ele tem de mais difícil de copiar. Sem isso o clone é bom em federal e raso em municipal, que é justamente onde o usuário mora. Chegar a 80 com W1+W2 é possível sem tocar nisso; o veredito "entregável" fica tecnicamente correto e estrategicamente fraco.
- Layout desta rodada não foi medido. Recapturar no mesmo viewport e estado (1440×900 e 390×844, PNG, não JPEG de 400 px) com o clone em `localhost:3101` antes do próximo diff.
- `features.csv` agora tem 60 linhas pontuadas; o original continua crescendo (changelog diário). Refazer este diff a cada onda, não só no fim.

## Próximos cinco

1. S24 Como atualizamos + S22 Metodologia (dado e texto prontos; fecham a área `confianca`).
2. Presença/ano a ano + salário acumulado no crachá (`person_period_stats`).
3. Mais votados na cidade (votos por município já carregados).
4. Busca global no header.
5. Direito de resposta + divergências no Comparar.

Depois: `/replica-build` com W1 inteira; rerodar `/replica-diff` com layout recapturado.
