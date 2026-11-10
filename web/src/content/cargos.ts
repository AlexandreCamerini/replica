// Texto próprio, escrito a partir da Constituição Federal de 1988 (CF). Nada aqui é cópia de outro site.
export const CF_URL = "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm";

export type Office = {
  slug: string;
  name: string;
  kind: "eletivo" | "nomeado";
  sphere: string;
  summary: string;
  does: string[];
  can: string[];
  cannot: string[];
  term: string;
  how: string;
  oversight: string[];
  refs: string[];
  /** Tópico do dicionário que explica melhor um termo-chave do cargo. */
  terms?: { slug: string; label: string }[];
};

export const OFFICES: Office[] = [
  {
    slug: "presidente",
    name: "Presidente e vice-presidente da República",
    kind: "eletivo",
    sphere: "Federal · Poder Executivo",
    summary: "Chefia o governo federal e o Estado brasileiro. O vice substitui o presidente em viagens, licenças e vacância.",
    does: [
      "Dirige a administração federal com a ajuda dos ministros de Estado (art. 84, II).",
      "Sanciona ou veta os projetos de lei aprovados pelo Congresso (art. 66 e art. 84, IV e V).",
      "Propõe a lei do orçamento e o plano plurianual (art. 84, XXIII) e comanda as Forças Armadas (art. 84, XIII).",
      "Nomeia ministros do STF, depois da aprovação do Senado (art. 101, parágrafo único), e representa o país nas relações com outros Estados (art. 84, VII).",
    ],
    can: [
      "Editar medida provisória, em caso de relevância e urgência. Ela vale por 60 dias, prorrogáveis por mais 60, e precisa ser votada pelo Congresso (art. 62).",
      "Propor leis ao Congresso (art. 61 e art. 84, III).",
      "Vetar um projeto, total ou parcialmente. O Congresso pode derrubar o veto pelo voto da maioria absoluta de cada casa (art. 66, §4º).",
    ],
    cannot: [
      "Ausentar-se do país por mais de 15 dias sem licença do Congresso (art. 83).",
      "Ser responsabilizado, durante o mandato, por atos alheios ao exercício das funções (art. 86, §4º).",
      "Ser preso por crime comum antes de haver sentença condenatória (art. 86, §3º).",
    ],
    term: "4 anos. Pode haver uma reeleição para o período seguinte (art. 82 e art. 14, §5º).",
    how: "Voto direto em todo o país. Vence quem tiver mais da metade dos votos válidos; se ninguém alcançar, há segundo turno entre os dois mais votados (art. 77). Idade mínima: 35 anos (art. 14, §3º, VI, a). O vice concorre na mesma chapa (art. 77, §1º).",
    oversight: [
      "Congresso Nacional, com o auxílio do Tribunal de Contas da União (art. 49, X, e art. 70 a 71).",
      "Câmara dos Deputados autoriza, por dois terços, o processo; o STF julga crimes comuns e o Senado julga crimes de responsabilidade (art. 51, I, art. 52, I, e art. 86).",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 76 a 86", "Art. 14, §3º e §5º"],
    terms: [
      { slug: "medida-provisoria", label: "Medida provisória" },
      { slug: "veto", label: "Veto" },
      { slug: "impeachment", label: "Impeachment" },
    ],
  },
  {
    slug: "senador",
    name: "Senador",
    kind: "eletivo",
    sphere: "Federal · Poder Legislativo",
    summary: "Representa o estado ou o Distrito Federal no Senado. Cada estado e o DF têm três senadores, qualquer que seja a população (art. 46, §1º).",
    does: [
      "Vota as leis federais junto com a Câmara. Projetos de lei, em geral, passam pelas duas casas (art. 65).",
      "Aprova ministros do STF, o presidente e diretores do Banco Central, embaixadores e outras autoridades (art. 52, III e IV, e art. 101).",
      "Processa e julga o presidente, o vice, ministros de Estado e ministros do STF em crime de responsabilidade (art. 52, I e II).",
      "Fixa limites para a dívida dos estados e municípios (art. 52, V a IX).",
    ],
    can: [
      "Apresentar projetos de lei, propostas de emenda à Constituição e requerer informações a ministros (art. 50, §2º, e art. 61).",
      "Participar de comissões, entre elas as parlamentares de inquérito (art. 58).",
      "Falar e votar com inviolabilidade por opiniões, palavras e votos no exercício do mandato (art. 53).",
    ],
    cannot: [
      "Ser preso, salvo em flagrante de crime inafiançável, e mesmo então a casa decide se mantém a prisão (art. 53, §2º).",
      "Firmar ou manter contrato com órgão público, nem aceitar cargo em empresa pública, a partir da diplomação (art. 54, I).",
      "Ser processado criminalmente fora do STF enquanto exerce o mandato (art. 53, §1º).",
    ],
    term: "8 anos. A cada 4 anos renova-se um terço ou dois terços da casa (art. 46, §2º).",
    how: "Voto direto, sistema majoritário: vence quem tiver mais votos no estado (art. 46). Cada senador tem dois suplentes eleitos junto (art. 46, §3º). Idade mínima: 35 anos (art. 14, §3º, VI, a).",
    oversight: [
      "Conselho de Ética e Corregedoria do Senado; a casa pode cassar o mandato (art. 55).",
      "STF, nos crimes comuns (art. 53, §1º).",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 46, 52 a 56", "Art. 14, §3º"],
    terms: [{ slug: "suplente", label: "Suplente" }, { slug: "cpi", label: "CPI" }],
  },
  {
    slug: "deputado-federal",
    name: "Deputado federal",
    kind: "eletivo",
    sphere: "Federal · Poder Legislativo",
    summary: "Representa a população do estado na Câmara dos Deputados. O número de vagas de cada estado é proporcional à população, com mínimo de 8 e máximo de 70 (art. 45, §1º).",
    does: [
      "Vota as leis federais e as emendas à Constituição.",
      "Autoriza, por dois terços, a abertura de processo contra o presidente, o vice e ministros de Estado (art. 51, I).",
      "Examina as contas do presidente que o Congresso deve receber a cada ano (art. 51, II).",
      "Elege a Mesa e as comissões da Câmara e dispõe sobre a própria organização (art. 51, III e IV).",
    ],
    can: [
      "Apresentar projetos de lei e propostas de emenda à Constituição (art. 61 e art. 60, I).",
      "Convocar ministros de Estado para prestar informações (art. 50).",
      "Votar com inviolabilidade por opiniões, palavras e votos no exercício do mandato (art. 53).",
    ],
    cannot: [
      "Ser preso, salvo em flagrante de crime inafiançável, e a casa decide se mantém a prisão (art. 53, §2º).",
      "Firmar contrato com órgão público a partir da diplomação (art. 54, I).",
      "Aceitar cargo ou função em empresa pública, ou ocupar cargo de que possa ser demitido livremente, a partir da posse (art. 54, II).",
    ],
    term: "4 anos, sem limite de reeleições.",
    how: "Voto direto, sistema proporcional. O voto vai ao candidato e ao partido ou federação; as vagas são distribuídas conforme os votos de cada partido (art. 45). Idade mínima: 21 anos (art. 14, §3º, VI, c). A Câmara tem 513 cadeiras, fixadas por lei complementar (art. 45, §1º).",
    oversight: [
      "Conselho de Ética da Câmara; a casa pode cassar o mandato (art. 55).",
      "STF, nos crimes comuns (art. 53, §1º).",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 44 a 47, 51, 53 a 56", "Art. 14, §3º"],
    terms: [{ slug: "sistema-proporcional", label: "Sistema proporcional" }, { slug: "quociente-eleitoral", label: "Quociente eleitoral" }],
  },
  {
    slug: "governador",
    name: "Governador e vice-governador",
    kind: "eletivo",
    sphere: "Estadual · Poder Executivo",
    summary: "Chefia o governo do estado ou do Distrito Federal. O vice o substitui quando for preciso.",
    does: [
      "Administra as áreas de competência do estado: o que a Constituição não reserva à União nem aos municípios (art. 25, §1º).",
      "Comanda as polícias civil, militar e o corpo de bombeiros militar do estado (art. 144, §6º).",
      "Sanciona ou veta as leis aprovadas pela Assembleia Legislativa, conforme a constituição estadual.",
      "Propõe o orçamento do estado (art. 165).",
    ],
    can: [
      "Propor leis à Assembleia, nos temas da constituição estadual, que seguem o modelo federal (art. 25).",
      "Organizar regiões metropolitanas, aglomerações urbanas e microrregiões por lei complementar estadual (art. 25, §3º).",
    ],
    cannot: [
      "Gastar acima do orçamento aprovado sem crédito autorizado em lei (art. 167, II).",
      "Ser julgado por crime comum fora do Superior Tribunal de Justiça enquanto no cargo (art. 105, I, a).",
      "Legislar sobre temas reservados à União, como direito penal e civil (art. 22).",
    ],
    term: "4 anos. Pode haver uma reeleição para o período seguinte (art. 28 e art. 14, §5º).",
    how: "Voto direto no estado. A regra é a mesma do presidente: maioria absoluta dos votos válidos, com segundo turno se for preciso (art. 28). Idade mínima: 30 anos (art. 14, §3º, VI, b).",
    oversight: [
      "Assembleia Legislativa, com o auxílio do Tribunal de Contas do estado (art. 75 e art. 70).",
      "STJ, nos crimes comuns (art. 105, I, a).",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 25, 28, 144, §6º", "Art. 105, I, a"],
    terms: [{ slug: "tribunal-de-contas", label: "Tribunal de Contas" }],
  },
  {
    slug: "deputado-estadual",
    name: "Deputado estadual e distrital",
    kind: "eletivo",
    sphere: "Estadual · Poder Legislativo",
    summary: "Representa a população na Assembleia Legislativa do estado; no Distrito Federal, na Câmara Legislativa. O número de cadeiras depende da bancada do estado na Câmara dos Deputados (art. 27).",
    does: [
      "Vota as leis estaduais e a constituição do estado (art. 25).",
      "Aprova o orçamento do estado e fiscaliza o uso do dinheiro, com o Tribunal de Contas (art. 70 e art. 75).",
      "Em geral, as regras de inviolabilidade, de impedimentos e de perda do mandato seguem as dos deputados federais (art. 27, §1º).",
    ],
    can: [
      "Apresentar projetos de lei sobre temas de competência do estado.",
      "Pedir informações ao governo estadual e criar comissões de inquérito, segundo a constituição do estado (art. 27, §1º, e art. 58, §3º).",
    ],
    cannot: [
      "Legislar sobre temas privativos da União, como direito penal e eleitoral (art. 22).",
      "Receber subsídio acima de 75% do que recebe um deputado federal (art. 27, §2º).",
      "Firmar contrato com órgão público a partir da diplomação (art. 54, aplicado pelo art. 27, §1º).",
    ],
    term: "4 anos, sem limite de reeleições (art. 27, §1º).",
    how: "Voto direto, sistema proporcional. O número de vagas é o triplo da bancada do estado na Câmara dos Deputados, até 12 deputados federais; acima disso, soma-se uma vaga por deputado federal que exceder (art. 27). Idade mínima: 21 anos (art. 14, §3º, VI, c).",
    oversight: [
      "Corregedoria e conselho de ética da própria casa, conforme o regimento.",
      "Tribunal de Justiça do estado, nos crimes comuns, conforme a constituição estadual.",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 27 e 32, §3º", "Art. 14, §3º"],
    terms: [{ slug: "sistema-proporcional", label: "Sistema proporcional" }],
  },
  {
    slug: "prefeito",
    name: "Prefeito e vice-prefeito",
    kind: "eletivo",
    sphere: "Municipal · Poder Executivo",
    summary: "Chefia o governo do município. O vice o substitui quando necessário.",
    does: [
      "Administra os serviços de interesse local: transporte coletivo, educação infantil e fundamental, saúde básica, uso do solo (art. 30).",
      "Sanciona ou veta as leis aprovadas pela Câmara Municipal, conforme a lei orgânica do município.",
      "Propõe o orçamento do município e presta contas dele (art. 165 e art. 31).",
    ],
    can: [
      "Propor leis à Câmara Municipal, em especial as do orçamento e as de organização da administração.",
      "Cobrar tributos municipais, como IPTU e ISS, nos limites da lei (art. 156).",
    ],
    cannot: [
      "Gastar acima do orçamento aprovado sem crédito autorizado em lei (art. 167, II).",
      "Ser julgado por crime comum fora do Tribunal de Justiça enquanto no cargo (art. 29, X).",
      "Ultrapassar o limite de despesa com pessoal e o de endividamento definidos na Lei de Responsabilidade Fiscal (Lei Complementar 101/2000).",
    ],
    term: "4 anos. Pode haver uma reeleição para o período seguinte (art. 29, I, e art. 14, §5º).",
    how: "Voto direto no município. Nos municípios com mais de 200 mil eleitores, exige-se a maioria absoluta dos votos válidos, com segundo turno se for preciso (art. 29, II). Nos demais, vence quem tiver mais votos. Idade mínima: 21 anos (art. 14, §3º, VI, c).",
    oversight: [
      "Câmara Municipal, com o auxílio do Tribunal de Contas do estado ou do município, onde existir (art. 31).",
      "Controle interno da própria prefeitura (art. 31, caput).",
      "Tribunal de Justiça, nos crimes comuns (art. 29, X).",
      "Eleitores, a cada eleição; qualquer cidadão, partido, associação ou sindicato pode questionar as contas do município durante 60 dias por ano (art. 31, §3º).",
    ],
    refs: ["Arts. 29 a 31", "Art. 14, §3º e §5º"],
    terms: [{ slug: "lei-de-responsabilidade-fiscal", label: "Lei de Responsabilidade Fiscal" }, { slug: "orcamento-publico", label: "Orçamento público" }],
  },
  {
    slug: "vereador",
    name: "Vereador",
    kind: "eletivo",
    sphere: "Municipal · Poder Legislativo",
    summary: "Representa a população do município na Câmara Municipal. O número de vereadores é proporcional à população, dentro de faixas fixadas pela Constituição (art. 29, IV).",
    does: [
      "Vota as leis do município, entre elas o orçamento, o plano diretor (nas cidades obrigadas a tê-lo) e os tributos locais.",
      "Fiscaliza o prefeito e a administração do município, com o auxílio do Tribunal de Contas (art. 31).",
      "Julga as contas anuais do prefeito, depois do parecer do Tribunal de Contas (art. 31, §2º).",
    ],
    can: [
      "Apresentar projetos de lei de interesse local e pedir informações à prefeitura.",
      "Falar e votar com inviolabilidade por opiniões, palavras e votos no exercício do mandato, dentro do município (art. 29, VIII).",
    ],
    cannot: [
      "Receber subsídio acima dos limites do art. 29, VI, que variam conforme a população do município e tomam como base o subsídio dos deputados estaduais.",
      "Firmar contrato com a prefeitura nem ocupar cargo de confiança nela (art. 29, IX, e art. 54, por simetria).",
      "Legislar sobre temas reservados à União ou ao estado.",
    ],
    term: "4 anos, sem limite de reeleições (art. 29, I).",
    how: "Voto direto, sistema proporcional. Idade mínima: 18 anos (art. 14, §3º, VI, d). O número de vagas vai de 9 a 55, conforme a população (art. 29, IV).",
    oversight: [
      "Corregedoria e comissão de ética da própria Câmara, conforme o regimento.",
      "Ministério Público e Justiça comum, nos crimes e nos atos de improbidade.",
      "Eleitores, a cada eleição.",
    ],
    refs: ["Arts. 29 a 31", "Art. 14, §3º"],
    terms: [{ slug: "sistema-proporcional", label: "Sistema proporcional" }],
  },
  {
    slug: "ministro-do-stf",
    name: "Ministro do Supremo Tribunal Federal",
    kind: "nomeado",
    sphere: "Federal · Poder Judiciário",
    summary: "Integra o tribunal que dá a palavra final sobre o que a Constituição permite ou proíbe. O STF tem 11 ministros (art. 101). Não é cargo eletivo.",
    does: [
      "Julga se leis e atos do poder público respeitam a Constituição (art. 102, I, a, e art. 102, III).",
      "Julga o presidente, o vice, deputados federais, senadores e ministros de Estado em crimes comuns (art. 102, I, b e c).",
      "Resolve conflitos entre a União e os estados ou entre os estados (art. 102, I, f).",
    ],
    can: [
      "Editar súmula vinculante, que obriga o Judiciário e a administração pública, por decisão de dois terços dos ministros (art. 103-A).",
      "Julgar ações diretas de inconstitucionalidade e de constitucionalidade (art. 102, I, a).",
      "Permanecer no cargo até os 75 anos, quando há aposentadoria compulsória (art. 40, §1º, II).",
    ],
    cannot: [
      "Exercer outro cargo ou função, salvo uma de magistério (art. 95, parágrafo único, I).",
      "Dedicar-se a atividade político-partidária (art. 95, parágrafo único, III).",
      "Perder o cargo, a não ser por sentença judicial definitiva ou por condenação do Senado em crime de responsabilidade (art. 95, I, e art. 52, II).",
    ],
    term: "Sem mandato fixo: vai até a aposentadoria compulsória aos 75 anos (art. 40, §1º, II).",
    how: "O presidente da República nomeia, e o Senado aprova o nome por maioria absoluta. Exige-se de 35 a 70 anos de idade, notável saber jurídico e reputação ilibada (art. 101).",
    oversight: [
      "Senado Federal, nos crimes de responsabilidade (art. 52, II).",
      "O Congresso pode mudar a lei e a Constituição, que é a base das decisões do STF (art. 60).",
    ],
    refs: ["Arts. 101 a 103-B", "Art. 95, parágrafo único"],
    terms: [{ slug: "supremo-tribunal-federal-stf", label: "Supremo Tribunal Federal (STF)" }, { slug: "sumula-vinculante", label: "Súmula vinculante" }],
  },
];

export type Relation = { who: string; does: string; whom: string; how: string; ref: string };

export const RELATIONS: Relation[] = [
  { who: "Eleitores", does: "elegem", whom: "presidente, governadores, prefeitos, senadores, deputados e vereadores", how: "Voto direto, secreto e com igual valor para todos.", ref: "art. 14" },
  { who: "Legislativo", does: "fiscaliza", whom: "Executivo", how: "Convoca ministros, pede informações, abre comissões de inquérito e julga as contas, com o auxílio dos Tribunais de Contas.", ref: "arts. 49, X, 50, 58, 70 e 71" },
  { who: "Executivo", does: "sanciona ou veta", whom: "projetos do Legislativo", how: "Sancionar transforma o projeto em lei; vetar o devolve ao Legislativo, que pode derrubar o veto por maioria absoluta.", ref: "art. 66" },
  { who: "Executivo", does: "nomeia", whom: "ministros do STF", how: "O presidente escolhe o nome; o Senado precisa aprovar.", ref: "art. 101, parágrafo único" },
  { who: "Senado", does: "aprova", whom: "indicados a cargos altos", how: "Ministros do STF, embaixadores, diretores do Banco Central e outras autoridades passam pela sabatina.", ref: "art. 52, III e IV" },
  { who: "Judiciário", does: "julga", whom: "leis e atos do Executivo e do Legislativo", how: "Declara se respeitam a Constituição; o STF dá a palavra final.", ref: "art. 102, I, a" },
  { who: "Judiciário", does: "julga", whom: "autoridades em crimes comuns", how: "O STF julga o presidente, deputados e senadores; o STJ julga governadores; o Tribunal de Justiça julga prefeitos.", ref: "arts. 102, I, 105, I, a, e 29, X" },
  { who: "Legislativo", does: "julga", whom: "presidente e ministros do STF em crimes de responsabilidade", how: "A Câmara autoriza por dois terços; o Senado julga e pode afastar do cargo.", ref: "arts. 51, I, 52, I e II, e 86" },
  { who: "Tribunais de Contas", does: "auxiliam", whom: "o Legislativo na fiscalização do dinheiro público", how: "Examinam as contas, dão parecer e podem apontar irregularidades e aplicar multas.", ref: "arts. 71 e 75" },
];
