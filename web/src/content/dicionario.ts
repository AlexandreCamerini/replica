// Dicionário político. Definições escritas do zero, em linguagem simples; cada termo aponta a fonte oficial.
import { CF_URL } from "./cargos";

export type Source = { label: string; href: string };
export type Term = { slug: string; termo: string; tema: string; def: string; source: Source };

export const THEMES = [
  { id: "eleicoes", label: "Eleições" },
  { id: "poderes", label: "Poderes e cargos" },
  { id: "leis", label: "Como nasce uma lei" },
  { id: "dinheiro", label: "Dinheiro público" },
  { id: "controle", label: "Controle e fiscalização" },
  { id: "justica", label: "Justiça" },
  { id: "partidos", label: "Partidos e mandato" },
] as const;

const P = "https://www.planalto.gov.br/ccivil_03";
const cf = (art: string): Source => ({ label: `Constituição Federal, ${art}`, href: CF_URL });
const lei = (label: string, path: string): Source => ({ label, href: `${P}/${path}` });
const CAM: Source = { label: "Glossário da Câmara dos Deputados", href: "https://www2.camara.leg.br/glossario" };
const SEN: Source = { label: "Glossário Legislativo do Senado", href: "https://www12.senado.leg.br/noticias/glossario-legislativo" };
const STF: Source = { label: "Glossário do STF", href: "https://portal.stf.jus.br/glossario" };
const RISF: Source = { label: "Regimento Interno do Senado Federal", href: "https://www25.senado.leg.br/web/atividade/legislacao/regimento-interno" };
const LRF = lei("Lei de Responsabilidade Fiscal (LC 101/2000)", "leis/lcp/lcp101.htm");
const L9504 = lei("Lei das Eleições (Lei 9.504/1997)", "leis/l9504.htm");
const L9096 = lei("Lei dos Partidos Políticos (Lei 9.096/1995)", "leis/l9096.htm");
const CE = lei("Código Eleitoral (Lei 4.737/1965)", "leis/l4737compilado.htm");
const LC64 = lei("Lei de Inelegibilidades (LC 64/1990)", "leis/lcp/lcp64.htm");
const LC135 = lei("Lei da Ficha Limpa (LC 135/2010)", "leis/lcp/lcp135.htm");
const L1079 = lei("Lei dos Crimes de Responsabilidade (Lei 1.079/1950)", "leis/l1079.htm");
const L8429 = lei("Lei de Improbidade Administrativa (Lei 8.429/1992)", "leis/l8429.htm");
const L14133 = lei("Lei de Licitações (Lei 14.133/2021)", "_ato2019-2022/2021/lei/l14133.htm");
const LAI = lei("Lei de Acesso à Informação (Lei 12.527/2011)", "_ato2011-2014/2011/lei/l12527.htm");
const LC95 = lei("Lei Complementar 95/1998", "leis/lcp/lcp95.htm");

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const e = "eleicoes", p = "poderes", l = "leis", d = "dinheiro", c = "controle", j = "justica", pa = "partidos";

const RAW: [string, string, string, Source][] = [
  // Eleições
  ["Voto direto", e, "Modo de eleger em que cada eleitor escolhe quem vai ocupar o cargo, sem intermediários. É o caso de presidente, governador, prefeito, senador, deputado e vereador.", cf("art. 14, caput")],
  ["Voto facultativo", e, "Voto que a pessoa pode dar ou não. Vale para quem tem 16 ou 17 anos, mais de 70 anos e para analfabetos. Para os demais, entre 18 e 70, é obrigatório.", cf("art. 14, §1º")],
  ["Sistema majoritário", e, "Regra em que vence quem recebe mais votos. Vale para presidente, governador, prefeito e senador. Cada voto vai a uma pessoa, e só vence quem passa os demais.", cf("arts. 28, 29, II, e 46")],
  ["Sistema proporcional", e, "Regra usada para deputados e vereadores. As cadeiras são divididas entre os partidos e as federações de acordo com os votos que receberam; dentro de cada um, ficam os candidatos mais votados.", CE],
  ["Quociente eleitoral", e, "Número de votos que dá direito a uma cadeira. Calcula-se dividindo os votos válidos pelo número de vagas. O partido ou federação que não o alcança não ganha cadeira pela primeira distribuição.", CE],
  ["Quociente partidário", e, "Quantas cadeiras um partido ou federação ganha na primeira distribuição: divide-se o total de votos dele pelo quociente eleitoral e usa-se a parte inteira.", CE],
  ["Sobras eleitorais", e, "Cadeiras que restam depois da primeira distribuição. Elas são repartidas entre os partidos e federações que cumpriram as exigências mínimas de votos.", CE],
  ["Cláusula de desempenho", e, "Exigência de votação mínima para que um partido tenha acesso ao fundo partidário e ao tempo gratuito de rádio e TV. Também é chamada de cláusula de barreira.", cf("art. 17, §3º")],
  ["Federação partidária", e, "União de dois ou mais partidos para agir como um só partido, em toda a eleição e durante o mandato, por pelo menos quatro anos.", L9504],
  ["Segundo turno", e, "Nova votação entre os dois candidatos mais votados, quando nenhum alcançou mais da metade dos votos válidos. Vale para presidente, governador e prefeito de cidade com mais de 200 mil eleitores.", cf("arts. 28, 29, II, e 77")],
  ["Votos válidos", e, "Votos dados a candidatos ou a legendas. Os votos em branco e os nulos não entram nessa conta.", L9504],
  ["Voto em branco e voto nulo", e, "Voto em branco é o de quem não escolhe ninguém; nulo é o que não segue as regras da urna. Nenhum dos dois conta para eleger candidato.", CE],
  ["Registro de candidatura", e, "Pedido feito à Justiça Eleitoral por partido, federação ou candidato para poder concorrer. A Justiça confere se a pessoa cumpre as exigências antes de aceitá-lo.", L9504],
  ["Condição de elegibilidade", e, "Requisitos que a pessoa precisa cumprir para concorrer: nacionalidade brasileira, pleno exercício dos direitos políticos, alistamento eleitoral, domicílio na circunscrição, filiação partidária e idade mínima.", cf("art. 14, §3º")],
  ["Inelegibilidade", e, "Situação em que a pessoa não pode concorrer, por exemplo por ter sido condenada por certos crimes ou ter as contas rejeitadas, nos casos e prazos fixados em lei.", LC64],
  ["Ficha Limpa", e, "Lei que ampliou os casos de inelegibilidade, em especial para quem foi condenado por órgão colegiado ou renunciou para fugir de processo de cassação.", LC135],
  ["Diplomação", e, "Ato em que a Justiça Eleitoral confirma o resultado e entrega o diploma aos eleitos, depois de contados os votos.", CE],
  ["Domicílio eleitoral", e, "Cidade onde a pessoa está inscrita para votar. Para concorrer, é preciso ter domicílio na circunscrição onde será a eleição, no prazo que a lei fixa.", cf("art. 14, §3º, IV")],
  ["Justiça Eleitoral", e, "Ramo do Judiciário que organiza as eleições, registra candidaturas, apura votos e julga os casos eleitorais. É formada pelo TSE, pelos TREs, juízes e juntas eleitorais.", cf("arts. 118 a 121")],
  ["Pesquisa eleitoral", e, "Levantamento de intenção de voto. Precisa ser registrada na Justiça Eleitoral antes de divulgada, com a metodologia e o contratante.", L9504],
  ["Horário eleitoral gratuito", e, "Tempo que rádio e TV cedem, sem custo, a partidos e candidatos para propaganda. A divisão considera o tamanho das bancadas na Câmara.", L9504],
  ["Fundo eleitoral", e, "Dinheiro público reservado para financiar campanhas. É dividido entre os partidos segundo regras definidas em lei e pelo TSE.", L9504],
  ["Prestação de contas de campanha", e, "Relatório em que candidatos e partidos informam à Justiça Eleitoral quanto receberam e gastaram na campanha. A Justiça aprova ou rejeita.", L9504],
  ["Título de eleitor", e, "Documento que comprova a inscrição da pessoa na Justiça Eleitoral. Hoje há também a versão digital no aplicativo e-Título.", CE],
  ["Plebiscito", e, "Consulta ao povo antes de a lei ser feita, para saber se ele concorda com algo. Convocado pelo Congresso.", cf("art. 14, I")],
  ["Referendo", e, "Consulta ao povo depois de a lei ou o ato ter sido aprovado, para confirmar ou rejeitar. Convocado pelo Congresso.", cf("art. 14, II")],
  ["Iniciativa popular", e, "Direito de cidadãos proporem um projeto de lei, desde que reúnam assinaturas de pelo menos 1% dos eleitores do país, em cinco estados.", cf("art. 14, III, e art. 61, §2º")],
  ["Reeleição", e, "Nova eleição de quem ocupa cargo do Executivo (presidente, governador, prefeito) para o período seguinte. Só é permitida uma vez seguida.", cf("art. 14, §5º")],
  // Poderes e cargos
  ["Separação dos Poderes", p, "Divisão do poder do Estado em três partes independentes e harmônicas: Legislativo, Executivo e Judiciário, para que um limite o outro.", cf("art. 2º")],
  ["Poder Executivo", p, "Quem administra e executa as leis: presidente, governadores e prefeitos, com seus ministros e secretários.", cf("art. 76")],
  ["Poder Legislativo", p, "Quem faz as leis e fiscaliza o Executivo. Na União é o Congresso Nacional; nos estados, a Assembleia; nos municípios, a Câmara de Vereadores.", cf("art. 44")],
  ["Poder Judiciário", p, "Quem aplica a lei e resolve conflitos, de forma independente, por meio de juízes e tribunais.", cf("art. 92")],
  ["Pacto federativo", p, "Divisão de tarefas e de dinheiro entre União, estados, Distrito Federal e municípios, todos autônomos nos limites da Constituição.", cf("art. 18")],
  ["Congresso Nacional", p, "O Poder Legislativo da União. É formado por duas casas: a Câmara dos Deputados e o Senado Federal.", cf("art. 44")],
  ["Câmara dos Deputados", p, "Casa do Congresso que representa a população. Tem 513 deputados federais, eleitos pelo sistema proporcional.", cf("art. 45")],
  ["Senado Federal", p, "Casa do Congresso que representa os estados e o Distrito Federal. Tem três senadores por unidade da federação.", cf("art. 46")],
  ["Assembleia Legislativa", p, "Casa que faz as leis do estado e fiscaliza o governador. No Distrito Federal, chama-se Câmara Legislativa.", cf("art. 27")],
  ["Câmara Municipal", p, "Casa dos vereadores. Faz as leis do município e fiscaliza o prefeito.", cf("art. 29")],
  ["Ministro de Estado", p, "Auxiliar direto do presidente que comanda um ministério. É nomeado e demitido livremente pelo presidente.", cf("arts. 87 e 84, I")],
  ["Mandato", p, "Tempo durante o qual alguém eleito exerce o cargo em nome de quem o escolheu. É de 4 anos para a maioria dos cargos e 8 para senador.", cf("arts. 28, 29, 46 e 82")],
  ["Suplente", p, "Pessoa que assume a cadeira quando o titular se afasta ou perde o mandato. Na Câmara, é o candidato mais votado do partido que não se elegeu. No Senado, é eleito junto com o titular.", cf("art. 56, §1º, e art. 46, §3º")],
  ["Bancada", p, "Grupo de parlamentares ligados por partido, por estado ou por tema. A bancada de um partido define o peso dele nas comissões e no tempo de fala.", CAM],
  ["Mesa Diretora", p, "Grupo que dirige os trabalhos de uma casa legislativa: presidente, vice-presidentes e secretários. É eleita pelos parlamentares.", cf("art. 57, §4º")],
  ["Plenário", p, "Reunião de todos os parlamentares de uma casa para debater e votar. É onde ficam as decisões mais importantes.", CAM],
  ["Comissão", p, "Grupo menor de parlamentares que analisa projetos de um tema (saúde, educação...) antes de eles irem ao Plenário.", cf("art. 58")],
  ["Quórum", p, "Número mínimo de presentes ou de votos a favor exigido para uma sessão acontecer ou uma decisão valer.", SEN],
  ["Sessão deliberativa", p, "Sessão em que o Plenário vota matérias. Difere da sessão de debates, que só discute.", CAM],
  ["Líder partidário", p, "Parlamentar que representa a bancada do partido nas decisões da casa e orienta o voto dos colegas.", CAM],
  ["Oposição", p, "Parlamentares e partidos que não apoiam o governo e fiscalizam o Executivo. A palavra não é jurídica; o regimento usa “minoria” para o bloco que não está com a maioria.", CAM],
  ["Maioria absoluta", p, "Mais da metade de todos os membros de uma casa, estejam presentes ou não. Na Câmara, 257 de 513 votos.", cf("art. 47")],
  ["Maioria simples", p, "Mais da metade dos presentes na votação, desde que haja quórum. Quando a Constituição não exige outra regra, é a que vale.", cf("art. 47")],
  // Como nasce uma lei
  ["Projeto de lei", l, "Proposta de lei apresentada ao Legislativo. Se aprovada nas duas casas e sancionada, vira lei.", cf("art. 59")],
  ["Proposta de Emenda à Constituição (PEC)", l, "Proposta para mudar o texto da Constituição. Exige três quintos dos votos em cada casa, em dois turnos.", cf("art. 60")],
  ["Lei ordinária", l, "Lei comum, aprovada por maioria simples, que trata da maioria dos assuntos.", cf("art. 59, III")],
  ["Lei complementar", l, "Lei que detalha pontos da Constituição quando ela exige. Precisa de maioria absoluta nas duas casas.", cf("art. 69")],
  ["Medida provisória", l, "Ato do presidente com força de lei, usado em relevância e urgência. Vale por 60 dias, prorrogáveis por mais 60. Se o Congresso não a votar, perde a eficácia.", cf("art. 62")],
  ["Decreto", l, "Ato do chefe do Executivo que regulamenta uma lei ou trata da organização da administração. Não pode criar direitos nem obrigações que a lei não prevê.", cf("art. 84, IV e VI")],
  ["Decreto legislativo", l, "Norma do Congresso sobre temas que são só dele, como aprovar tratados internacionais. Não passa por sanção do presidente.", cf("art. 49")],
  ["Emenda", l, "Mudança proposta ao texto de um projeto durante a tramitação, para acrescentar, retirar ou alterar trechos.", CAM],
  ["Relator", l, "Parlamentar escolhido para estudar o projeto e escrever o parecer que será votado na comissão ou no Plenário.", CAM],
  ["Tramitação", l, "Caminho que uma proposta faz na casa legislativa: apresentação, comissões, Plenário e envio à outra casa ou à sanção.", CAM],
  ["Regime de urgência", l, "Regra que acelera a análise de uma proposta, dispensando alguns prazos. Precisa ser aprovada pela casa.", RISF],
  ["Votação nominal", l, "Votação em que o voto de cada parlamentar é registrado e fica público.", CAM],
  ["Votação simbólica", l, "Votação em que o presidente da sessão pede que quem é a favor permaneça sentado. Não registra o voto de cada um.", CAM],
  ["Requerimento", l, "Pedido feito por parlamentar à casa ou à Mesa, por exemplo para pedir informações ou pedir que um projeto vá a outra comissão.", CAM],
  ["Pauta", l, "Lista dos assuntos que a casa vai discutir e votar numa sessão. Quem decide a pauta é a Mesa, com os líderes.", CAM],
  ["Obstrução", l, "Estratégia de parlamentares que, para atrasar uma votação, deixam de votar, pedem a palavra ou usam outros instrumentos do regimento.", CAM],
  ["Sanção", l, "Concordância do chefe do Executivo com o projeto aprovado pelo Legislativo. Sancionado, ele vira lei.", cf("art. 66")],
  ["Veto", l, "Recusa total ou parcial, pelo chefe do Executivo, a um projeto aprovado pelo Legislativo, por considerá-lo inconstitucional ou contrário ao interesse público.", cf("art. 66, §1º")],
  ["Promulgação", l, "Ato que declara a lei pronta para valer. Depois dela vem a publicação no Diário Oficial.", cf("art. 66, §7º")],
  ["Iniciativa de lei", l, "Direito de apresentar um projeto. Em geral cabe a parlamentares, ao presidente, ao Judiciário e aos cidadãos; alguns temas são só do Executivo.", cf("art. 61")],
  ["Redação legislativa", l, "Regras para escrever leis com clareza e padrão, como numerar artigos e usar uma ementa.", LC95],
  // Dinheiro público
  ["Orçamento público", d, "Plano de quanto o governo espera arrecadar e como vai gastar num ano. É proposto pelo Executivo e votado pelo Legislativo.", cf("art. 165")],
  ["Plano plurianual (PPA)", d, "Lei que fixa as metas do governo para quatro anos. Orienta o orçamento de cada ano.", cf("art. 165, I")],
  ["Lei de Diretrizes Orçamentárias (LDO)", d, "Lei anual que define as prioridades e regras para o orçamento do ano seguinte.", cf("art. 165, II")],
  ["Lei Orçamentária Anual (LOA)", d, "Lei que autoriza as despesas e estima as receitas do ano. Sem ela, o governo não pode gastar.", cf("art. 165, III")],
  ["Emenda parlamentar", d, "Modificação do orçamento proposta por deputados e senadores para direcionar dinheiro a uma obra, serviço ou local.", cf("art. 166")],
  ["Receita pública", d, "Dinheiro que entra nos cofres do governo, principalmente por impostos, taxas e contribuições.", LRF],
  ["Despesa pública", d, "Dinheiro que o governo gasta em salários, serviços, obras, dívida e transferências.", LRF],
  ["Subsídio", d, "Forma de pagamento de parlamentares e outras autoridades em parcela única, sem gratificações ou adicionais.", cf("art. 39, §4º")],
  ["Cota parlamentar", d, "Valor mensal que a casa devolve ao parlamentar para despesas ligadas ao mandato, como passagens e escritório, mediante comprovação.", CAM],
  ["Dívida pública", d, "O que o governo deve a quem lhe emprestou dinheiro. O Senado fixa os limites para a União, os estados e os municípios.", cf("art. 52, VI a IX")],
  ["Lei de Responsabilidade Fiscal", d, "Lei que obriga governos a planejar os gastos, cumprir limites de despesa com pessoal e de dívida e informar o que fazem.", LRF],
  ["Licitação", d, "Processo em que o poder público escolhe, em concorrência aberta, quem vende ou presta serviço, para obter a melhor proposta com igualdade.", L14133],
  ["Contrato administrativo", d, "Acordo entre o poder público e uma empresa ou pessoa para obra, compra ou serviço, com regras próprias e prazo.", L14133],
  ["Imposto", d, "Tributo que a pessoa paga sem receber algo específico em troca. O dinheiro vai para o orçamento geral.", cf("arts. 145 e 150")],
  ["Transparência pública", d, "Dever dos governos de mostrar o que fazem e quanto gastam, em linguagem acessível e em formato aberto.", LAI],
  // Controle e fiscalização
  ["Tribunal de Contas", c, "Órgão que examina como o dinheiro público é gasto e dá parecer sobre as contas dos governos. Auxilia o Legislativo.", cf("arts. 71 e 75")],
  ["Controle externo", c, "Fiscalização feita por quem está fora do órgão fiscalizado: o Legislativo com o Tribunal de Contas.", cf("art. 70")],
  ["Controle interno", c, "Fiscalização que cada órgão público faz sobre si mesmo, para evitar erros e fraudes.", cf("art. 74")],
  ["Ministério Público", c, "Instituição que defende a lei, a ordem democrática e os interesses da sociedade. Pode investigar e acionar a Justiça.", cf("art. 127")],
  ["CPI", c, "Comissão Parlamentar de Inquérito. Grupo de parlamentares com poder de investigar um fato determinado e por tempo certo. Precisa do apoio de um terço dos membros da casa.", cf("art. 58, §3º")],
  ["Convocação de ministro", c, "Chamado do Congresso a um ministro para prestar informações. A ausência sem justificativa é crime de responsabilidade.", cf("art. 50")],
  ["Impeachment", c, "Processo político-jurídico para afastar autoridades que cometem crime de responsabilidade. Para o presidente, a Câmara autoriza e o Senado julga.", L1079],
  ["Crime de responsabilidade", c, "Infração política ou administrativa cometida por alta autoridade no exercício do cargo. A pena é a perda do cargo e a inabilitação para funções públicas.", L1079],
  ["Cassação de mandato", c, "Perda do mandato de parlamentar por decisão da própria casa ou da Justiça Eleitoral, nos casos previstos na Constituição.", cf("art. 55")],
  ["Quebra de decoro parlamentar", c, "Conduta incompatível com o cargo, como abuso de prerrogativas ou recebimento de vantagens indevidas. Pode levar à perda do mandato.", cf("art. 55, II e §1º")],
  ["Imunidade parlamentar", c, "Proteção ao parlamentar para votar e falar sem medo de processo, e para não ser preso, salvo em flagrante de crime inafiançável.", cf("art. 53")],
  ["Foro por prerrogativa de função", c, "Regra pela qual certas autoridades, como deputados e senadores, são julgadas por crimes comuns diretamente em tribunal superior. Também é chamada de foro privilegiado.", cf("art. 102, I, b")],
  ["Improbidade administrativa", c, "Ato de agente público que enriquece ilicitamente, causa prejuízo ao erário ou fere princípios da administração. Pode gerar perda do cargo e multa.", L8429],
  ["Lei de Acesso à Informação", c, "Lei que garante a qualquer pessoa o direito de pedir e receber informações dos órgãos públicos, sem precisar explicar o motivo.", LAI],
  ["Conselho de Ética", c, "Comissão da casa legislativa que analisa denúncias contra parlamentares por quebra de decoro e recomenda sanções.", CAM],
  // Justiça
  ["Supremo Tribunal Federal (STF)", j, "Mais alto tribunal do país. Guarda a Constituição e julga as ações que dizem respeito a ela. Tem 11 ministros.", cf("art. 101")],
  ["Superior Tribunal de Justiça (STJ)", j, "Tribunal que uniformiza a interpretação das leis federais. Julga governadores em crimes comuns.", cf("arts. 104 e 105")],
  ["Tribunal Superior Eleitoral (TSE)", j, "Mais alto tribunal da Justiça Eleitoral. Coordena as eleições nacionais e fixa as regras para elas, dentro da lei.", cf("art. 118")],
  ["Controle de constitucionalidade", j, "Verificação de que uma lei ou um ato respeita a Constituição. Se não respeita, pode ser anulado.", STF],
  ["Ação direta de inconstitucionalidade (ADI)", j, "Ação no STF para anular uma lei ou ato por contrariar a Constituição. Só certos órgãos e entidades podem propor.", cf("art. 102, I, a, e art. 103")],
  ["Súmula vinculante", j, "Entendimento do STF, aprovado por dois terços dos ministros, que passa a obrigar todo o Judiciário e a administração pública.", cf("art. 103-A")],
  ["Habeas corpus", j, "Ação para proteger a liberdade de ir e vir de alguém preso ou ameaçado de prisão ilegal.", cf("art. 5º, LXVIII")],
  ["Mandado de segurança", j, "Ação para proteger direito claro e comprovado que o poder público violou ou ameaça violar, quando não cabe habeas corpus.", cf("art. 5º, LXIX")],
  ["Liminar", j, "Decisão rápida, dada no começo do processo, para evitar dano enquanto o caso é analisado. Pode ser derrubada depois.", STF],
  ["Trânsito em julgado", j, "Momento em que uma decisão não admite mais recurso e se torna definitiva.", STF],
  ["Repercussão geral", j, "Exigência de que o caso discutido no STF tenha importância além das partes. O STF decide se um recurso a possui.", cf("art. 102, §3º")],
  ["Acórdão", j, "Decisão tomada por um grupo de juízes em tribunal, e não por um só.", STF],
  // Partidos e mandato
  ["Partido político", pa, "Associação de pessoas com ideias em comum que disputa eleições e participa do poder. É pessoa jurídica de direito privado e precisa ser registrada no TSE.", cf("art. 17")],
  ["Filiação partidária", pa, "Vínculo da pessoa com um partido. É condição para poder se candidatar e precisa existir antes da eleição, em prazo fixado em lei.", L9096],
  ["Fidelidade partidária", pa, "Ideia de que o mandato pertence ao partido: parlamentar eleito pelo sistema proporcional que sai do partido sem justa causa pode perder o cargo, conforme decisões do STF e do TSE.", STF],
  ["Janela partidária", pa, "Período em que deputados e vereadores podem trocar de partido sem perder o mandato, perto das eleições.", L9096],
  ["Fundo partidário", pa, "Dinheiro público repassado aos partidos para manter suas atividades. A divisão depende da votação que tiveram.", L9096],
  ["Coligação", pa, "Aliança de partidos para disputar eleição. Para deputado e vereador, está proibida desde 2020; para presidente, governador, prefeito e senador, continua permitida.", cf("art. 17, §1º")],
  ["Convenção partidária", pa, "Reunião em que o partido escolhe seus candidatos e define alianças. Acontece em prazo fixado pela lei eleitoral.", L9504],
  ["Prerrogativa", pa, "Direito ligado ao cargo, que existe para proteger o exercício da função, não a pessoa. É o caso da imunidade de parlamentares.", cf("art. 53")],
];

export const TERMS: Term[] = RAW.map(([termo, tema, def, source]) => ({ slug: slugify(termo), termo, tema, def, source })).sort((a, b) =>
  a.termo.localeCompare(b.termo, "pt-BR"),
);
