# Parity: clone cívico × Politicômetro

> **Atualização (build 2, 2026-11-02):** geral **58,7** (features **65,3**, layout 32,4). Must-haves **17 de 17**. Entraram: votos e dinheiro de campanha do TSE (2022/2024/2026), mapa com malhas do IBGE e drill-down até município, S09 Congresso (hemiciclo + votações nominais), S10 detalhe de votação, crachá com o nome como título e resumo do ano. Suíte e2e: 41 de 41 (1 S4 aberto: BUG-009). **Veredito agora: ainda não entregável pelo critério da skill** (feature score < 80), mas sem must-have faltando e sem S1/S2 aberto. O layout caiu um pouco: as capturas do original são JPEG de 400 px e o clone mudou de hierarquia no crachá; a nota de layout é ruído, não regressão de função. O texto abaixo é a rodada anterior, mantido como histórico.

Build: a42f7d0 (+ esta rodada)  Date: 2026-11-02  Env: clone com dados reais em `localhost:3101`; capturas do original em `replica/screens/` (referência, fora do git).

Paridade aqui é **fazer o mesmo trabalho**, não parecer igual. A cor e a marca mudam de propósito antes do lançamento.

## Placar

| | nota | como foi medido |
| --- | --- | --- |
| **Geral** | **52,7 / 100** | `parity.py --visual` (features + layout) |
| Features | 57,1 / 100 | 47 features pontuadas (must ×3, should ×2, could ×1; parcial vale metade; 5 `skip` fora) |
| Must-haves | 15 de 17 | 2 parciais: tiles do crachá (votos e campanha ainda "—") e mapa (grade por UF, sem contorno nem nível cidade) |
| Layout | 35,3 / 100 | 7 telas, mapa de bordas em grade, só células com conteúdo |

**Veredito: não entregável.** Dois must-haves parciais. Nenhum S1 ou S2 aberto (`bugs.md`: 7 corrigidos, 1 S3 intermitente aberto). Feature score abaixo de 80.

## Layout por tela

Viewport: 800×600 (o original foi capturado no painel do navegador nessa largura, em JPEG de 400×300) e 390×844 no celular. Diffs em `replica/diffs/S*.png` (vermelho = região diferente, em pixels do original). As imagens de diff contêm a captura do original e ficam fora do git, como `replica/screens/`; só os `.json` com as notas entram.

| tela | nota | veredito | por que difere (estrutura, não cor) |
| --- | --- | --- | --- |
| S01 home | 40,9 | diferente | original: contadores + mapa SVG do Brasil + abas de camada; clone: contador + busca + grade de UFs + A–Z. A hierarquia (contador em cima, mapa no meio, diretório embaixo) é a mesma; o mapa em grade ocupa outra área |
| S05 crachá | 39,6 | diferente | original: nome gigante centralizado num cartão, badges de eleição abaixo; clone: avatar + nome à esquerda, fatos em linha. A ordem cabeçalho → mandatos → tiles é igual; a linha de 4 tiles bate |
| S05 crachá celular escuro | 30,7 | diferente | mesma causa; no celular o original empilha o nome em 2 linhas e os tiles em 1 coluna, o clone em 2 colunas |
| S06 busca de lugar | 31,8 | diferente | o original foi capturado com a lista aberta sobre a página escura e 2 opções; o clone com 10 opções (lista mais alta). Campo, rótulo e exemplos estão no mesmo lugar |
| S07 representantes | 27,9 | diferente | a captura do original está rolada até "Comparar lado a lado" (meio da página); a do clone é o topo. Não comparável; refazer no mesmo scroll |
| S08 comparar | 34,0 | diferente | original: campo de busca + "Na cidade · Campinas" com cartões; clone: campo + presets. Estrutura próxima, altura diferente |
| S09 congresso | 42,4 | diferente | o clone é stub (R2). Nota alta por coincidência de cabeçalho; ignorar |

Leitura honesta: as notas baixas vêm de três coisas. (1) O crachá do clone usa cabeçalho à esquerda com avatar; o original centraliza o nome como título de página. É a maior diferença de hierarquia e vale alinhar (o nome é o que o usuário procura). (2) As capturas do original são JPEG de 400 px; o mapa de bordas pega ruído de compressão. (3) Duas capturas estão em estados diferentes (S07 rolada, S06 com lista menor). Nada disso muda o veredito: a feature score é o que decide.

## Faltando, em ordem de construção

Must (fecham o "não entregável"):
1. Crachá: votos recebidos e dinheiro de campanha ("—" hoje). ETL `tse.candidatos --votes` (550 MB por eleição) e prestação de contas do TSE.
2. Mapa do Brasil com contorno IBGE e drill-down região → UF → cidade (hoje: grade por UF + lista).

Should (R2), na ordem do `architecture.md`:
3. Monitorar com login por código no e-mail (S20, S21, F05): Supabase Auth, Turnstile, Resend. Exige contas suas.
4. Congresso: hemiciclo, agenda, pauta e votações (S09) + detalhe de votação com placar e orientação por partido (S10). Os dados já estão no banco (`voting_events`, `party_orientations`).
5. Reportar erro e sugestão (S25, F08).
6. Metodologia e fontes (S22) e matriz de quem publica dados (S23). `data_coverage` já existe.
7. Busca global no header (S03): `/api/people/search` + `/api/places` já existem; falta a UI.
8. Crachá: resumo do ano (temas e fidelidade já calculados em `person_period_stats`), leis que viraram projeto, emendas, campanhas, comissões/falas/viagens/equipe, custo e contato.
9. Comparar: lista de divergências (hoje só o % por par).
10. Card OG para compartilhar (S28).

Could (R5): partidos, governos, planos, eleições, STF, impostos, educativo, mais vistos, MCP, camadas do mapa.

## Comportamento por fluxo

| fluxo | original faz | clone faz | decisão |
| --- | --- | --- | --- |
| F01 achar quem me representa | 3 cliques prometidos: campo, cidade, pessoa. Homônimos com UF | 3 ações (digitar, Enter, Enter) com teclado; homônimos com UF; sem JS cai em `?q=` e lista as cidades; cidade grande primeiro na lista | manter; **fix no original que não existe**: funciona sem JavaScript |
| F02 mapa | SVG com região → UF → cidade, Esc volta, camadas | grade de UFs (1 toque = estado), lista por região e A–Z de cidades | fix: contorno IBGE + nível cidade (must parcial) |
| F03 ler o crachá | seletor de ano, filtros de propostas (ano/tema/tipo/autoria + busca), votos com tema, gastos por categoria e fornecedor | igual, com os filtros na URL (link compartilhável, funciona sem JS); "—" com motivo em vez de 0; fontes e data em todo bloco; presença com regra publicada | manter; fix: seções R2 do crachá |
| F04 comparar | 2–5 pessoas, URL `?p=`, "votaram igual?" com divergências | 2–5 pessoas, URL `?p=`, bandeja persistente, "votaram igual?" só com % por par, "—" quando não se aplica | fix: lista de divergências; legenda separando "não publica" de "não se aplica" |
| F05 monitorar | e-mail → código → volta → feed | link "Acompanhar" leva a stub `/entrar?volta=` (R2); `volta` já validado contra redirect aberto | fix: R2 |
| F06 compartilhar | card de imagem + WhatsApp | copiar link / Web Share + WhatsApp com texto e URL | fix: imagem OG |
| F07 congresso | hemiciclo, agenda, pauta, votações | stub | fix: R2 (dados prontos) |
| F08 reportar erro | formulário com tipo, texto, nome, e-mail | link para stub `/sugestoes?tipo=erro&p=` | fix: R2 |
| neutralidade | listas A–Z, sem nota; mas usa cor de partido no hemiciclo | listas A–Z (testado), badges Sim/Não com a mesma cor (testado), cadeiras neutras (testado), sem vocabulário de avaliação (testado) | manter; **fix no original**: hemiciclo sem cor de partido, coerente com a própria metodologia |
| dado ausente | "—", "teto do salário", "faltam N dados · por quê" | igual, e com `null` garantido no banco (`check`) e por ano carregado | manter |

Onde o clone já é melhor que o original: funciona sem JavaScript nos fluxos F01 e F03; todo filtro vive na URL; hemiciclo e badges sem cor que codifique partido ou juízo; regra de presença publicada; invariantes do dado checadas a cada carga.

## Próximos cinco

1. ETL de votos por candidato e prestação de contas do TSE (fecha o must do crachá).
2. Mapa com contorno IBGE e nível cidade (fecha o must da home).
3. Congresso S09 + S10 sobre os dados já carregados (should de maior valor com menor custo).
4. Crachá: cabeçalho com o nome como título de página (maior diferença de hierarquia) e seção "resumo do ano" com os temas e a fidelidade já calculados.
5. Monitorar (S20/S21) assim que houver projeto Supabase e Resend seus.

Depois: `/replica-build` para os itens 1–4; `/replica-entrepreneur` só quando a feature score passar de 80.
