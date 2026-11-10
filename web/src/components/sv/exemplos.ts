// Redação de demonstração para a seção "Como isso mexe com a sua vida".
// Só aparece na versão de demonstração, sempre com o aviso "Exemplo ilustrativo", e nunca com dados reais:
// em produção a seção usa apenas respostas que passaram pela verificação agêntica (replica/verificacao-agentica.md), com o trecho do texto oficial.

export type Kind = "texto" | "previsao" | "nao_sabemos";
export type ImpactAnswer = { q: string; a: string; kind: Kind; quote?: string };
export type ImpactExample = { title: string; oneLine: string; answers: ImpactAnswer[] };

export const KIND_LABEL: Record<Kind, string> = { texto: "Está no texto oficial", previsao: "É previsão", nao_sabemos: "Ainda não sabemos" };

export const EXEMPLOS: Record<string, ImpactExample> = {
  "camara-pl-4567-2024": {
    title: "Entrada gratuita para crianças de até dois anos em shows e jogos",
    oneLine: "O projeto propõe que crianças com menos de três anos não paguem ingresso em shows, teatro, cinema e eventos esportivos.",
    answers: [
      { q: "Quem é afetado?", a: "Famílias com crianças de até dois anos. E quem organiza shows, peças e jogos, que deixaria de cobrar esse ingresso.", kind: "texto", quote: "gratuidade para crianças menores de três anos" },
      { q: "O que muda na prática?", a: "Hoje a lei garante meia-entrada para estudantes, idosos, pessoas com deficiência e jovens de baixa renda. A proposta acrescenta a entrada gratuita para os pequenos.", kind: "texto", quote: "Inclui na Lei nº 12.933, de 26 de dezembro de 2023" },
      { q: "Quem paga a conta?", a: "O resumo oficial não diz quem cobre o custo do ingresso gratuito.", kind: "nao_sabemos" },
      { q: "Quando começaria a valer?", a: "Só depois de aprovada na Câmara e no Senado e assinada pelo presidente. Por enquanto, nada muda.", kind: "previsao" },
    ],
  },
  "camara-pl-79-2020": {
    title: "Novo destino para uma contribuição paga por empresas de portos e de aviação",
    oneLine: "O projeto muda para onde vai uma contribuição que empresas de transporte aéreo e de portos já pagam. Parte passaria a financiar a contratação de trabalhadores portuários avulsos.",
    answers: [
      { q: "Quem é afetado?", a: "Empresas de transporte aéreo e de portos, que pagam a contribuição. E trabalhadores portuários avulsos, que seriam contratados com esse dinheiro.", kind: "texto", quote: "contribuições sociais compulsórias das empresas do setor de transporte aéreo e portuário" },
      { q: "O que muda na prática?", a: "O texto trata do destino de um dinheiro que já é recolhido. Não cria cobrança nova para o cidadão.", kind: "texto", quote: "para dispor sobre a destinação das contribuições" },
      { q: "Quem paga a conta?", a: "As mesmas empresas que pagam hoje. O resumo oficial não diz se o valor muda.", kind: "nao_sabemos" },
      { q: "Quando começaria a valer?", a: "Só depois de aprovada na Câmara e no Senado e assinada pelo presidente. Por enquanto, nada muda.", kind: "previsao" },
    ],
  },
};

// Palavras difíceis que aparecem numa decisão. Texto próprio.
export const GLOSSARIO: { termo: string; def: string }[] = [
  { termo: "Proposta (PL, PLP, PEC, MPV)", def: "Um texto que alguém apresentou para virar lei. Enquanto não for aprovado e assinado, não vale." },
  { termo: "Comissão", def: "Grupo menor de parlamentares que analisa a proposta antes de todos votarem. É uma etapa, não a decisão final." },
  { termo: "Plenário", def: "Todos os deputados ou todos os senadores reunidos para votar." },
  { termo: "Relator", def: "O parlamentar que estuda a proposta e sugere a versão final do texto." },
  { termo: "Sanção", def: "A assinatura do presidente que transforma o texto aprovado em lei. Ele também pode vetar, ou seja, recusar." },
];
