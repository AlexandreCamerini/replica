import type { DataSourceW4, ElectionContest, IndicatorKey, YearIndicators } from "./types-w4";

// Demonstração determinística da onda W4 (nomes e números fictícios, só para o desenvolvimento e o e2e sem banco).
const indicators: YearIndicators[] = [];
for (let y = 1996; y <= 2025; y++) {
  const values: YearIndicators["values"] = { pib_variacao: ((y * 7) % 90) / 10 - 2, ipca_acumulado: ((y * 13) % 120) / 10 };
  if (y >= 1999) values.selic_meta_fim_ano = 2 + ((y * 11) % 200) / 10;
  if (y >= 2012) values.desemprego_media = 6 + ((y * 3) % 70) / 10;
  indicators.push({ year: y, values });
}

const UF_NAMES: Record<string, string> = { AC: "Acre", MG: "Minas Gerais", SP: "São Paulo", RJ: "Rio de Janeiro" };

const contest = (uf: string, name: string): ElectionContest => ({
  office: "governador",
  label: "Governador",
  round: 1,
  placeIbge: uf === "SP" ? "35" : uf === "MG" ? "31" : "99",
  placeName: name,
  uf,
  elected: 1,
  candidates: [
    { slug: "fulana-demo", name: "Fulana Demo", number: 11, party: "AAA", result: "eleito", votes: 5_000_000 },
    { slug: "beltrano-demo", name: "Beltrano Demo", number: 22, party: "BBB", result: "nao_eleito", votes: 3_000_000 },
    { slug: "ciclana-demo", name: "Ciclana Demo", number: 33, party: "CCC", result: "nao_eleito", votes: null },
  ],
});

export const fakeW4: DataSourceW4 = {
  async listElectionYears() {
    return [
      { year: 2024, kind: "municipal", rounds: [1, 2] },
      { year: 2022, kind: "geral", rounds: [1, 2] },
    ];
  },
  async getElectionOverview(year) {
    return year === 2022
      ? [
          { office: "presidente", label: "Presidente", round: 1, contests: 1, candidacies: 3, elected: 0 },
          { office: "presidente", label: "Presidente", round: 2, contests: 1, candidacies: 2, elected: 1 },
          { office: "governador", label: "Governador", round: 1, contests: 27, candidacies: 70, elected: 15 },
        ]
      : [{ office: "prefeito", label: "Prefeito", round: 1, contests: 5569, candidacies: 9000, elected: 5477 }];
  },
  async listElectionContests(f) {
    if (f.office === "presidente") {
      const c = { ...contest("BR", "Brasil"), office: "presidente" as const, label: "Presidente", placeIbge: "BR", uf: null };
      return { items: [c], total: 1 };
    }
    if (f.office !== "governador") return { items: [], total: 0 };
    const all = [contest("MG", "Minas Gerais"), contest("SP", "São Paulo")];
    const items = f.uf ? all.filter((c) => c.uf === f.uf) : all;
    return { items, total: items.length };
  },
  async listYearlyIndicators() {
    return {
      rows: indicators,
      refs: (["pib_variacao", "ipca_acumulado", "selic_meta_fim_ano", "desemprego_media"] as IndicatorKey[]).map((key) => ({ key, unit: "%", seriesRefs: ["demonstração"] })),
    };
  },
  async listTaxYears() {
    return { years: [2024, 2023], lastMonth: { 2024: 12, 2023: 12 } };
  },
  async getTaxByUf() {
    return Object.entries(UF_NAMES)
      .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
      .map(([uf, ufName], i) => ({ uf, ufName, totalCents: (i + 1) * 100_000_000_000 }));
  },
  async getTaxByMonth() {
    return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalCents: (i + 1) * 10_000_000_000 }));
  },
  async getTaxLines() {
    return [
      { tax: "COFINS - DEMAIS", totalCents: 30_000_000_000 },
      { tax: "IRPJ - DEMAIS EMPRESAS", totalCents: 20_000_000_000 },
    ];
  },
  async listPartyRows() {
    return {
      rows: [
        { id: "a", acronym: "AAA", name: "Partido A (demonstração)", number: 11, seatsCamara: 40, seatsSenado: 5, alignment: [{ gov: "lula", n: 100, same: 60 }] },
        { id: "b", acronym: "BBB", name: "Partido B (demonstração)", number: 22, seatsCamara: 3, seatsSenado: 0, alignment: [{ gov: "lula", n: 8, same: 4 }] },
      ],
      windows: [{ gov: "lula", firstYear: 2023, lastYear: 2025, votings: 150 }],
    };
  },
};
