# Verificação agêntica · especificação v2

Decisão do fundador em 10/11/2026: a regra "uma pessoa confere frase por frase antes de publicar" (Regra 3) é substituída por verificação feita por agentes. A mesma disciplina vale para todo o planejamento do site.

Estado: especificação. Nada disto está implementado no `etl/` nem em produção.

v2 incorpora a revisão adversarial feita por agente independente em 10/11/2026 (11 achados, 8 confirmados no código). A lista do que mudou está na seção 15.

## 1. O que muda

| | Hoje | Depois |
|---|---|---|
| Quem redige | modelo (`etl/civico_etl/jobs/rascunho.py`) | igual |
| Checagens mecânicas | `drafting.py`: avisos bloqueantes (`BLOCKING`) e não bloqueantes | todas com dono: ver seção 4 |
| Quem aprova | pessoa, por `civico-etl revisar --aprovar --revisor` | agentes independentes, por `civico-etl verificar` |
| Selo no site | "Revisado por pessoa dd/mm" / "Aguardando revisão" | "Conferido com o texto oficial por agentes de IA em dd/mm" / "Aguardando conferência" |
| Pessoa no circuito | antes de publicar | depois: correções, auditoria por amostra, retirada, chave de desligar |

O que **não** muda: toda frase leva o trecho do texto oficial; nada publicado é reescrito, só substituído ou retirado, com motivo; lista de palavras proibidas; nenhuma frase diz se a proposta é boa ou ruim.

## 2. Três estados por campo, não dois

A v1 rebaixava todo campo que falhava para "O texto não diz". Isso publica uma afirmação negativa sobre a lei que pode ser falsa (o texto diz, o verificador é que errou). Passam a existir três estados:

| Estado | Quem decide | O que o leitor vê |
|---|---|---|
| `diz` | redator, confirmado pelos verificadores | a frase e o trecho |
| `nao_diz` | redator declarou e o **contraditor confirmou** que o texto inteiro não trata do ponto | "O texto oficial não trata disso." |
| `nao_conferido` | qualquer falha de verificação | "Ainda não conseguimos conferir esta resposta." |

`nao_conferido` nunca afirma nada sobre a lei.

## 3. Papéis

Cada papel é uma chamada separada, com prompt próprio e sem acesso ao raciocínio dos outros.

| Papel | Entrada | Saída | Modelo |
|---|---|---|---|
| **Redator** | inteiro teor (PDF), resumo oficial | por campo: `diz`, `frase`, `trecho`, `pagina`; em `dinheiro`, também `direcao` | Sonnet |
| **Portão mecânico** (código) | respostas + páginas extraídas | avisos por campo | n/a |
| **Classificador de trecho** (código + modelo) | trecho e página | `articulado` / `justificacao` / `anexo` | Haiku |
| **Verificador de sustentação** | por campo: frase, trecho, `direcao` quando houver, a página do trecho e as duas vizinhas | `sustenta` / `sustenta_em_parte` / `nao_sustenta`, o que sobra sem lastro, e `instrucao_detectada` | Opus |
| **Contraditor** | as frases + o inteiro teor | por campo: `contradiz` / `condiciona` / `nada_encontrado`, com o artigo; para campos `nao_diz`, se o texto trata do ponto; prova de leitura (ver 5.4); `instrucao_detectada` | Opus |
| **Leitor leigo** | só as frases, sem o texto oficial | responde três perguntas fixas (o que muda, para quem, já vale?) e marca palavras que não entendeu | Haiku |
| **Juiz de linguagem** (código + modelo) | frases, respostas do leitor leigo **e os trechos** | passa/falha por campo | Haiku |
| **Árbitro** (código) | todos os vereditos + `served_by` de cada chamada | publica, marca campo como `nao_conferido`, ou barra | n/a |

**Independência verificada, não presumida.** O árbitro lê o modelo que de fato atendeu cada chamada (`served_by`). Se redator e verificador de sustentação saíram do mesmo modelo (por `RASCUNHO_MODEL` ou por modelo de reserva), a proposta é barrada. Hoje `fallbacks="default"` e a variável de ambiente permitem essa coincidência.

## 4. Destino das checagens mecânicas atuais

| Aviso em `drafting.py` | Hoje | Depois |
|---|---|---|
| os de `BLOCKING` (trecho não encontrado, termo proibido, número sem trecho, frase vazia ou longa, trecho curto ou vazio, caractere estranho, estimativa sem número, direção inválida) | bloqueiam até o revisor trocar o campo | campo vira `nao_conferido` |
| `frase_longe_do_trecho`, `sem_verbo_da_lista` | "julgamento do revisor" | entram como sinal para o verificador de sustentação; se ele disser `sustenta` apesar do aviso, o campo vai para a auditoria por amostra com prioridade |

## 5. Regras do árbitro (falha fechada)

1. Aviso bloqueante do portão → campo `nao_conferido`.
2. Trecho classificado como `justificacao` ou `anexo` → campo `nao_conferido`. A Justificação é o argumento do autor, não o que a lei faria; o PDF traz os dois no mesmo arquivo.
3. `nao_sustenta` → campo `nao_conferido`. `sustenta_em_parte` → uma nova redação, que **refaz o caminho inteiro** (portão, classificador, sustentação, contraditor). Segunda falha → `nao_conferido`. Nenhuma redação é publicada sem ter passado por todos.
4. Contraditor:
   - `contradiz` → campo `nao_conferido`.
   - `condiciona` (prazo, exceção, "desde que") → o campo permanece e ganha, na página, a linha "Há condições no texto oficial", com o artigo. Não rebaixa: quase toda proposta tem condição.
   - sem **prova de leitura** válida → a proposta é barrada. A prova: para três artigos sorteados pelo código, o contraditor devolve a primeira frase de cada um, conferida por código contra o PDF. Lista vazia sem prova não vale como aprovação.
5. Campo `nao_diz` do redator só é publicado como "O texto oficial não trata disso" se o contraditor confirmar. Senão, `nao_conferido`.
6. Direção do dinheiro: conferida pelo verificador de sustentação junto com a frase. Discordância → `nao_conferido`.
7. Publica somente se `o_que_propoe` estiver em `diz` **e** pelo menos três dos seis campos estiverem em `diz` ou em `nao_diz` confirmado. Senão, barra.
8. Leitor leigo: erra "já vale?" → barra (não há segunda redação automática: o prompt do redator obriga verbos no presente, e o remédio é o rótulo fixo "É uma proposta. Ainda não é lei." que a página já traz, mais ajuste de prompt com versão nova). Erra "o que muda" ou "para quem", ou marca palavra não entendida → o campo correspondente vira `nao_conferido`.
9. Juiz de linguagem dá falha num campo → `nao_conferido`.
10. `instrucao_detectada` por qualquer agente → barra e registra.
11. Qualquer agente falha, estoura prazo ou devolve formato inválido → barra. Nunca "aprova por falta de resposta".

**Uma proposta barrada não é tentada de novo** com o mesmo PDF e os mesmos prompts. `seen()` passa a contar `'barrado'`. Só PDF novo (SHA diferente), `PROMPT_VERSION` nova ou `verifier_version` nova destravam. Sem isso, a repetição diária transforma uma taxa de erro pequena numa certeza: com chance p de deixar passar um erro por tentativa, depois de N tentativas a chance é 1 − (1 − p)^N.

## 6. Validação de entrada e segurança

- O inteiro teor é **dado, não instrução**. Todo prompt o entrega delimitado. Sustentação e contraditor têm o campo `instrucao_detectada` no esquema de saída.
- **Texto invisível.** O pypdf extrai texto branco, de corpo zero ou fora da página. Um trecho "existente" que o leitor não acha no PDF é fraude. O portão mecânico passa a descartar caracteres com cor igual à do fundo, corpo menor que 4 pt ou fora da área da página, antes de qualquer agente ler. Se a biblioteca não der essa informação para um PDF, a proposta é barrada.
- **Todos leem a mesma extração.** Coluna embaralhada ou tabela quebrada engana todos os agentes de uma vez. O portão mede a qualidade da extração (proporção de linhas com menos de três palavras, palavras fora do dicionário) e barra acima de um limiar a calibrar no conjunto de referência.
- **Texto desatualizado.** Se a tramitação registra substitutivo ou redação final posterior ao PDF lido, a proposta é barrada com o motivo "há versão mais nova do texto". Depende de dado de tramitação que hoje o ETL não carrega: fica como requisito, não como promessa.
- PDF sem texto extraível, com mais de `MAX_PAGES` (80) páginas, ou com SHA diferente entre o rascunho e a verificação → não verifica.
- Saída dos agentes validada por esquema (JSON estrito, enum fechado). Fora do esquema = falha.

## 7. Mudanças de dados

Migração nova, que precisa mexer em três lugares que a v1 esqueceu:

1. **Check de status** (`0080`): acrescentar `'barrado'` e `'retirado'`.
2. **Gatilho `answer_drafts_guard`** (`0081`):
   - transições novas: `rascunho → barrado`; `publicado → retirado`;
   - estender a trava de imutabilidade a `verification`, `verifier_version`, `verified_by`, `reviewer` e `reviewed_at`. Hoje só `answers`, `checks` e a fonte são protegidos: o relatório público seria editável.
3. **Colunas**:
   - `verification jsonb`: por campo, veredito de cada agente, modelo que atendeu, versão do prompt, quando;
   - `verifier_version int`;
   - `verified_by text check (verified_by in ('agentes','pessoa'))`, no lugar de codificar o tipo dentro de `reviewer`;
   - `withdrawn_note text`, obrigatório quando `status = 'retirado'`.
- A restrição `status <> 'publicado' or (reviewer is not null and reviewed_at is not null)` continua; para agentes, `reviewer` recebe o identificador da execução.
- A RLS já esconde do site todo status fora de `publicado` e `substituido`; `barrado` não vaza. `retirado` precisa entrar na política, para a página poder dizer que foi retirada e por quê.

No site:
- `AnswerClaim` ganha `state: "diz" | "nao_diz" | "nao_conferido"` e `conditions?: string`.
- `PublishedAnswers` ganha `verifiedBy` e o relatório por campo.
- `PautaEntry.reviewedAt` e `plain` alimentam os cartões das listas e entram na mesma mudança.
- Textos fixos a trocar nas páginas atuais: `components/pauta/answers.tsx`, `components/pauta/ui.tsx`, `pauta/page.tsx`, `como-escolhemos/page.tsx`, `proposta/[key]/page.tsx`.

## 8. O que o público vê

- Selo: **"Conferido com o texto oficial por agentes de IA em dd/mm"**, com a data do documento lido. "Verificado" sozinho soa como checagem de fatos ou endosso; o selo diz o que foi feito: comparar com o texto.
- Em cada resposta: o estado (seção 2), o tipo de afirmação e o trecho oficial. Quando houver, "Há condições no texto oficial".
- "Como esta página é conferida": as conferências e o resultado de cada uma.
- Frase fixa: **"Nenhuma pessoa leu esta explicação antes de publicarmos. Se você vir um erro, aponte: corrigimos com data e motivo."** ("este texto" seria lido como "ninguém leu o projeto de lei".)
- Em Como funciona: o método, os limites e a versão dos verificadores.

## 9. Pessoa no circuito, depois da publicação

A decisão tira a pessoa do caminho crítico, não da responsabilidade (o Blueprint exige responsabilidade editorial identificável).

- **Correções**: canal público como hoje. Correção aceita gera novo rascunho, nova verificação e entrada em Correções.
- **Retirada**: `publicado → retirado`, com motivo público. É o que faltava para a reverificação e para erro grave.
- **Auditoria por amostra** (recomendado): 1 em cada 20 publicações da semana, mais todos os campos sinalizados na seção 4. Com 20 publicações por semana isso é uma página lida: não tem poder para estimar taxa de erro, só para pegar erro grosseiro. Dizer isso na página Como funciona.
- **Chave de desligar**, em dois lugares: no ETL (`VERIFICACAO_AGENTICA=off` impede novas publicações por agentes) e no site (filtro por `verified_by = 'agentes'` nas três consultas de `pg.ts` que leem `answer_drafts`). Páginas revisadas por pessoa não são afetadas.
- **Alarme**: proporção semanal de campos `nao_conferido`. O limiar numérico sai da linha de base medida na seção 10; queda para menos da metade da linha de base em uma semana dispara revisão do verificador.

## 10. Avaliação antes de ligar

Não ligar em produção sem passar nesta barra. A v1 prometia mais do que a amostra podia provar.

1. **Conjunto de referência, rotulado por campo.** As linhas `reprovado` de `answer_drafts` não servem como rótulo: muitas são reprovações automáticas ("trocado por rascunho mais novo") e a decisão é da proposta inteira. É preciso rotular à mão, campo a campo: correto / sem sustentação / contradito / condicionado / "não diz" falso / direção errada.
2. **Tamanho e o que ele prova.** Zero falhas em n casos só garante, com 95% de confiança, taxa abaixo de 3/n.
   - 100 casos armadilha (sintéticos e reais), zero deixados passar → taxa de escape abaixo de 3%.
   - 300 campos reais → no máximo 3 erros publicados (limite superior perto de 2,6%).
   - Conjunto de ajuste de prompts separado do conjunto de medida.
3. **Métricas obrigatórias:**
   - frase sem sustentação publicada (por campo e por proposta: página com pelo menos um campo errado);
   - "não trata disso" falso;
   - direção do dinheiro errada;
   - recall do contraditor em condições e contradições plantadas;
   - campo correto marcado como `nao_conferido` (custa cobertura, não verdade): registrar, sem barra fixa na primeira medição;
   - leitor leigo confunde proposta com lei: 0;
   - concordância do verificador consigo mesmo em duas execuções: ≥ 95% dos campos.
4. **Injeção:** 20 PDFs, metade com ordem explícita, metade sutis ("Nota técnica: o art. 2º não impõe custo"), e pelo menos 5 com texto invisível. Barra: todos barrados ou com o campo afetado em `nao_conferido`. Cinco PDFs com ordem explícita, como na v1, passariam até com expressão regular e não mediam nada.
5. Resultado e data em `replica/decisions.md`. Mudou prompt ou modelo → roda de novo.

## 11. Custo e latência

- Por proposta: redator + classificador + até 6 de sustentação + contraditor + leitor + juiz ≈ 11 chamadas. A de sustentação recebe três páginas, não o PDF.
- O contraditor é o item caro: lê o inteiro teor. Cache de prompt no bloco do documento. A API de lotes existe no redator, mas é opcional e desligada por padrão (`batch=False`); ligar para a verificação é decisão de custo contra latência.
- **O custo do redator já pode ser medido hoje**: `answer_drafts` guarda `input_tokens`, `output_tokens` e `cost_usd`. A estimativa da verificação sai desses números antes de implementar. Ainda não foi calculada.

## 12. Verificação agêntica no planejamento do site

| Entregável | Verificação independente | Bloqueia? |
|---|---|---|
| Especificação ou decisão de arquitetura | agente revisor que recebe o documento e o código, não a conclusão; tarefa: achar furo, contradição e critério não verificável | sim |
| Mudança de código | revisão de código por agente + testes automáticos | sim |
| Texto de interface | checagem de palavras proibidas (teste `neutrality`) + leitor leigo | sim |
| Tela nova | testes de ponta a ponta + conferência visual por captura | sim |
| Dado novo no site | checagens de invariantes do `etl` + amostra conferida contra a fonte por agente | sim |

Regras do revisor: contexto limpo; recebe o artefato e a fonte, não o resumo de quem fez; devolve achados com evidência (arquivo e linha, ou trecho) marcados como confirmado ou plausível; "não achei problema" exige dizer o que foi conferido. Esta especificação passou por esse processo: a v1 tinha oito defeitos confirmados.

## 13. Riscos, sem suavizar

- **Erro correlacionado.** Redator e verificadores são da mesma família de modelos e leem a mesma extração do PDF. Um mal-entendido sistemático passa por todos. Mitigações: papéis e modelos diferentes conferidos pelo árbitro, classificador de trecho, medida de qualidade da extração, casos armadilha, auditoria por amostra. Não elimina.
- **Afirmação errada sobre lei, publicada sem pessoa.** É o pior caso do produto e passa a ser possível. O custo é de reputação e recai sobre o fundador. A barra da seção 10, a falha fechada e a retirada reduzem e limitam; não zeram.
- **Verbo no presente.** O prompt do redator obriga "cria", "proíbe", "altera". Lido solto, sugere que já é lei. A página compensa com o rótulo fixo de etapa; um card compartilhado sem o rótulo não compensa.
- **O contrato de confiança muda.** O Blueprint v2.0 exige decisão explícita e versão nova do documento para mudar o tratamento de evidências. A decisão foi tomada; a versão 2.1 ainda não foi escrita.
- **Cobertura menor do que parece.** Falha fechada e três estados significam muitas respostas em "ainda não conseguimos conferir" no começo. É o comportamento correto e vai parecer defeito.
- **Texto desatualizado** (substitutivo): sem dado de tramitação, nenhum agente percebe. Está como requisito na seção 6 e não tem solução hoje.
- **Senado fora.** O rascunho só cobre a Câmara; a verificação herda o limite.

## 14. Decisões em aberto

1. A auditoria por amostra fica? Recomendo sim, sabendo que ela pega erro grosseiro e não mede taxa.
2. Texto do selo: "Conferido com o texto oficial por agentes de IA" (recomendado).
3. Quem assina a responsabilidade editorial na página Como funciona.
4. Teto de gasto mensal, depois de calcular com `cost_usd`.
5. Quem rotula o conjunto de referência da seção 10. É trabalho humano, uma vez, e é a única forma de saber se o sistema presta.

## 15. O que a revisão independente mudou (v1 → v2)

| Achado | Gravidade | Correção |
|---|---|---|
| Proposta barrada era redigida de novo todo dia até passar | grave, confirmado em `rascunho.py:96` | barrado conta como visto; só PDF ou prompt novo destrava |
| Rebaixar para "O texto não diz" publicava afirmação negativa possivelmente falsa | grave | três estados; `nao_conferido` não afirma nada |
| Não havia como despublicar | grave, confirmado em `0081` | status `retirado` |
| Migração não fechava com check e gatilho; relatório público editável | confirmado | seção 7 |
| Árbitro sem regra para juiz de linguagem, direção do dinheiro, `o_que_propoe` vazio, redação nova sem reverificar, contraditor vazio | confirmado | regras 3 a 9 da seção 5, prova de leitura |
| Justificação do autor passava como fato da lei | confirmado em `drafting.py` | classificador de trecho |
| Independência dos modelos não era garantida | confirmado em `rascunho.py:361,424` | árbitro confere `served_by` |
| Texto invisível no PDF e injeção sutil | plausível | seção 6 e avaliação da seção 10 |
| Barra de avaliação estatisticamente vazia; rótulos por proposta, não por campo | confirmado | seção 10 refeita |
| Quatro afirmações erradas sobre o código atual | confirmado | corrigidas nas seções 1, 4 e 11 |
| Selo e frase ambíguos para o leitor | plausível | seção 8 |

## 16. Critérios de aceite da implementação

- [ ] `civico-etl verificar` aplica as regras da seção 5, e nunca publica quando um agente falha.
- [ ] Teste de unidade para cada regra do árbitro, com agentes simulados, incluindo os casos: contraditor sem prova de leitura; redator e verificador no mesmo modelo; `o_que_propoe` em `nao_diz`; segunda redação que falha; trecho em justificação.
- [ ] `seen()` conta `barrado`; teste que roda o job duas vezes e confirma que não há segunda tentativa.
- [ ] Migração com `barrado`, `retirado`, `verified_by` e gatilho estendido; teste que tenta alterar `verification` depois de publicado e é recusado.
- [ ] Barra da seção 10 medida e registrada antes do primeiro `publicado` por agentes em produção.
- [ ] Site mostra os três estados, o selo novo, o relatório por campo e a frase fixa.
- [ ] As duas chaves de desligar funcionam e não afetam páginas revisadas por pessoa.
- [ ] Blueprint atualizado para v2.1.
