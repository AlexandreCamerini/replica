# Build log

Uma linha por tela. Camada de dados = demo (`web/src/lib/data/fake.ts`, contrato `DataSource`): pessoas, partidos e números são fictícios e determinísticos; lugares (UFs, 12 capitais + Campinas) e tamanho das bancadas são reais. Trocar pela implementação Postgres não muda tela.

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| shell | 2026-11-02 | done | busca global (S03, R2) | stubs para as 19 telas fora do R0/R1, cada uma com S-ID e release; skip link, landmarks, bandeja de comparação persistente |
| S06 | 2026-11-02 | done | — | homônimos: sem JS a busca cai em `?q=` e lista as cidades com UF (Bom Jesus × 4) |
| S07 | 2026-11-02 | done | "mais votados na cidade" (R2) | grupos grandes (94 deputados estaduais em SP): 12 visíveis + `<details>` sem JS; atalhos por nível |
| S05 | 2026-11-02 | partial | seções R2 (resumo do ano, leis, emendas, campanhas detalhadas, comissões, falas, viagens, equipe, contato); link da nota fiscal; imagem OG | filtros de propostas, votos e gastos na URL coexistindo (cada form preserva os outros); presença só para Câmara, Senado "não publica"; gênero na flexão de cargo e resultado |
| S04 | 2026-11-02 | done | — | — |
| S08 | 2026-11-02 | partial | lista de divergências em "Votaram igual?" | cargos diferentes na mesma tabela: "—" por não aplicável vs não publicado ainda usam o mesmo símbolo |
| S01 | 2026-11-02 | partial | mapa com contorno IBGE (drill-down até cidade), camadas (R5), "ao vivo" | mapa real precisa da malha IBGE (CC BY 4.0) simplificada; ficou a grade por UF como alternativa acessível |

## Verificação desta rodada

- `tsc` e `eslint` limpos; `next build` ok.
- axe-core 4.10: 0 violações em S01, S04, S05, S06, S07 e S08, tema claro e escuro.
- 390 px: sem rolagem horizontal (tabelas largas rolam dentro de região focável).
- Só teclado: F01 completo (digitar cidade → Enter → Tab até a pessoa → Enter) = 3 ações.
- Rotas: slug antigo → 308; slug, IBGE ou UF inválidos → 404; APIs validam parâmetros e respondem 400.

## Dívida registrada

- "—" mistura "não publicado" com "não se aplica ao cargo" no S08. Separar em R2 com legenda.
- A camada demo gera votos com orientação por partido sorteada; a concordância entre pessoas é plausível, não real.
- Tabela de `features.csv`: o ETL (must) segue `no`, é o `/replica-backend`.

## 2026-11-02 · backend (replica-backend)

| ID | data | status | o que falta | o que foi mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| dados | 2026-11-02 | done | votos por candidato e prestação de contas do TSE (arquivos grandes, flags prontas); Supabase/auth/e-mail (R2) | identidade entre fontes: TSE e Câmara divergem em nome civil e até em data de nascimento para a mesma pessoa; precisou de regra por cadeira + `merge_person()`; Câmara marca cassado como "Não Eleito + Vacância" e suplente em exercício como "Não Eleito + Exercício"; a lista "atual" do Senado omite titulares afastados (lista por legislatura resolve); 16 municípios com grafia diferente entre TSE e IBGE |

Verificação: cadeiras batem (513 deputados, 81 senadores); RLS testada (anon nega, web_reader só lê público); rotas 404/400 nos inválidos; axe 0 violações no crachá com dado real; `npm audit` com 2 avisos no Next (registrados).
