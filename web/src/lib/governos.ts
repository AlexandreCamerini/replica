// Mandatos presidenciais desde 1985. Texto próprio. Datas de posse e fim conforme os registros da Presidência da República e do TSE;
// conferidas com uma segunda lista pública (não foi possível abrir o site do Planalto de dentro do ambiente de build: ver decisions.md D14x).
// Data sem hora: o dia vale por inteiro. `end` é o dia em que o mandato terminou (exclusivo para a conta do ano).

export type PresidentialTerm = {
  slug: string;
  name: string;
  start: string; // AAAA-MM-DD
  end: string | null; // null = em curso
  /** o que muda no meio do período (interino, impeachment, renúncia) */
  note: string;
  /** como chegou ao cargo */
  how: string;
};

export const TERMS: PresidentialTerm[] = [
  {
    slug: "sarney",
    name: "José Sarney",
    start: "1985-03-15",
    end: "1990-03-15",
    how: "Vice na chapa de Tancredo Neves, eleito pelo Colégio Eleitoral em janeiro de 1985.",
    note: "Tancredo Neves adoeceu na véspera da posse e morreu em 21/04/1985; Sarney assumiu em 15/03/1985 e permaneceu até o fim do período.",
  },
  {
    slug: "collor",
    name: "Fernando Collor",
    start: "1990-03-15",
    end: "1992-12-29",
    how: "Eleito em 1989, primeira eleição direta para presidente desde 1960.",
    note: "Afastado pelo Senado em 02/10/1992, ao abrir o processo de impeachment; renunciou em 29/12/1992, dia do julgamento.",
  },
  {
    slug: "itamar",
    name: "Itamar Franco",
    start: "1992-12-29",
    end: "1995-01-01",
    how: "Vice na chapa de Collor.",
    note: "Exerceu a Presidência desde 02/10/1992 (afastamento de Collor) e passou a titular em 29/12/1992.",
  },
  {
    slug: "fhc",
    name: "Fernando Henrique Cardoso",
    start: "1995-01-01",
    end: "2003-01-01",
    how: "Eleito em 1994 e reeleito em 1998.",
    note: "Dois mandatos completos.",
  },
  {
    slug: "lula-1",
    name: "Luiz Inácio Lula da Silva",
    start: "2003-01-01",
    end: "2011-01-01",
    how: "Eleito em 2002 e reeleito em 2006.",
    note: "Dois mandatos completos.",
  },
  {
    slug: "dilma",
    name: "Dilma Rousseff",
    start: "2011-01-01",
    end: "2016-08-31",
    how: "Eleita em 2010 e reeleita em 2014.",
    note: "Afastada pelo Senado em 12/05/2016, ao abrir o processo de impeachment; o Senado decidiu pela perda do cargo em 31/08/2016.",
  },
  {
    slug: "temer",
    name: "Michel Temer",
    start: "2016-08-31",
    end: "2019-01-01",
    how: "Vice na chapa de Dilma Rousseff.",
    note: "Exerceu a Presidência desde 12/05/2016 (afastamento de Dilma) e passou a titular em 31/08/2016.",
  },
  {
    slug: "bolsonaro",
    name: "Jair Bolsonaro",
    start: "2019-01-01",
    end: "2023-01-01",
    how: "Eleito em 2018.",
    note: "Um mandato completo.",
  },
  {
    slug: "lula-2",
    name: "Luiz Inácio Lula da Silva",
    start: "2023-01-01",
    end: null,
    how: "Eleito em 2022.",
    note: "Mandato em curso.",
  },
];

/** Presidentes que ocuparam o cargo em algum dia do ano (por nome, na ordem em que assumiram). */
export function presidentsOfYear(year: number): PresidentialTerm[] {
  const a = `${year}-01-01`;
  const b = `${year + 1}-01-01`;
  return TERMS.filter((t) => t.start < b && (t.end === null || t.end > a));
}

export function isPartialYear(t: PresidentialTerm, year: number): boolean {
  return t.start > `${year}-01-01` || (t.end !== null && t.end < `${year + 1}-01-01`);
}
