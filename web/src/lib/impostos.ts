// /impostos (U15): helpers puros, sem dependência da camada de dados (pg.ts e fake.ts entregam o mesmo formato).

/** Estados em ordem alfabética pelo nome (A–Z, pt-BR). Nunca ordena por valor: Res. TSE 23.610, sem ranking por métrica. */
export function sortUfsAZ<T extends { ufName: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.ufName.localeCompare(b.ufName, "pt-BR"));
}

/** Tributos em ordem alfabética pelo nome que a Receita usa. */
export function sortTaxesAZ<T extends { tax: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.tax.localeCompare(b.tax, "pt-BR"));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

// Ordem importa: o primeiro padrão que casar vale. Texto factual, sem juízo; só tributos que a Receita publica no arquivo.
const RULES: [RegExp, string][] = [
  [/^IRPF\b/, "Imposto de renda pago por pessoas físicas sobre rendimentos, como salários, aluguéis e ganho de capital."],
  [/^IRPJ\b/, "Imposto de renda pago por empresas sobre o lucro."],
  [/^IRRF\b/, "Imposto de renda retido na fonte: quem paga o rendimento desconta e repassa à União."],
  [/^CSLL\b/, "Contribuição sobre o lucro das empresas, que financia a seguridade social."],
  [/^COFINS\b/, "Contribuição sobre a receita ou o faturamento das empresas, que financia a seguridade social."],
  [/PIS\/?PASEP/, "Contribuição sobre a receita das empresas que financia o seguro-desemprego e o abono salarial."],
  [/^IPI\b/, "Imposto sobre produtos industrializados, cobrado na saída da fábrica ou na importação."],
  [/^IOF\b|OPERACOES FINANCEIRAS/, "Imposto sobre operações financeiras: crédito, câmbio, seguros e títulos."],
  [/IMPORTACAO/, "Imposto cobrado sobre mercadorias que entram no país."],
  [/EXPORTACAO/, "Imposto cobrado sobre mercadorias que saem do país."],
  [/^ITR\b|TERRITORIAL RURAL/, "Imposto sobre a propriedade de imóveis rurais."],
  [/^CIDE\b/, "Contribuição cobrada sobre combustíveis e usada em transporte e meio ambiente, conforme a lei."],
  [/PREVIDENCIARIA/, "Contribuições de empregadores e trabalhadores para a Previdência Social (INSS)."],
  [/^C?PSS\b|^CPSSS\b|SERVIDOR|SERV\. PUBLICO/, "Contribuição de servidores públicos federais para o próprio regime de previdência."],
  [/OUTROS ORGAOS/, "Receitas de outros órgãos federais que a Receita arrecada junto e repassa."],
  [/^OUTRAS RECEITAS|^DEMAIS RECEITAS/, "Receitas que a Receita agrupa fora das categorias acima."],
];

/** Uma linha em linguagem simples para o tributo, ou null se o nome não for reconhecido (a página não inventa descrição). */
export function taxBlurb(name: string): string | null {
  const n = norm(name);
  for (const [re, text] of RULES) if (re.test(n)) return text;
  return null;
}
