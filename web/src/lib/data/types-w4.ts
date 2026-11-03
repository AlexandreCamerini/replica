// W4: contrato das rotas /eleicoes, /governos, /impostos e /partidos. Arquivo à parte para não colidir com types.ts.
import type { ElectionResult, OfficeSlug } from "./types";

// ---- /eleicoes (S14) ----
export type ElectionYear = { year: number; kind: "geral" | "municipal"; rounds: number[] };

/** Uma linha do panorama nacional: cargo × turno. Contagens são do que está carregado, não do que a Justiça Eleitoral registrou. */
export type ElectionOfficeSummary = { office: OfficeSlug; label: string; round: number; contests: number; candidacies: number; elected: number };

export type ElectionCandidate = {
  slug: string; // crachá
  name: string;
  number: number | null;
  party: string;
  result: ElectionResult | null;
  /** null = não carregado, ou não confiável (presidente: BUG-019) */
  votes: number | null;
};

export type ElectionContest = {
  office: OfficeSlug;
  label: string;
  round: number;
  placeIbge: string;
  placeName: string;
  uf: string | null;
  candidates: ElectionCandidate[];
  elected: number;
};

export type ElectionContestFilter = { year: number; office: OfficeSlug; uf?: string; ibge?: string; round?: number; offset?: number; limit?: number };

// ---- /governos (S12) ----
export type IndicatorKey = "pib_variacao" | "ipca_acumulado" | "selic_meta_fim_ano" | "desemprego_media";
export type YearIndicators = { year: number; values: Partial<Record<IndicatorKey, number>> };
export type IndicatorMeta = { key: IndicatorKey; unit: string; seriesRefs: string[] };

// ---- /impostos (S16) ----
export type TaxByUf = { uf: string; ufName: string; totalCents: number };
export type TaxMonth = { month: number; totalCents: number };
export type TaxLine = { tax: string; totalCents: number };

// ---- /partidos (S11) ----
export type PartyRow = {
  id: string;
  acronym: string;
  name: string;
  number: number | null;
  seatsCamara: number;
  seatsSenado: number;
  /** por governo: quantas votações com orientação (sim/não) do governo e do partido ao mesmo tempo, e em quantas coincidiram */
  alignment: { gov: "bolsonaro" | "lula"; n: number; same: number }[];
};
export type PartyAlignmentWindow = { gov: "bolsonaro" | "lula"; firstYear: number; lastYear: number; votings: number };

export interface DataSourceW4 {
  listElectionYears(): Promise<ElectionYear[]>;
  getElectionOverview(year: number): Promise<ElectionOfficeSummary[]>;
  /** Sem uf/ibge: uma entrada por disputa (uma por UF). Com ibge (município) ou uf: só aquele lugar, com candidaturas. */
  listElectionContests(f: ElectionContestFilter): Promise<{ items: ElectionContest[]; total: number }>;
  listYearlyIndicators(): Promise<{ rows: YearIndicators[]; refs: IndicatorMeta[] }>;
  listTaxYears(): Promise<{ years: number[]; lastMonth: Record<number, number> }>;
  getTaxByUf(year: number): Promise<TaxByUf[]>;
  getTaxByMonth(year: number, uf?: string): Promise<TaxMonth[]>;
  getTaxLines(year: number, uf?: string): Promise<TaxLine[]>;
  listPartyRows(): Promise<{ rows: PartyRow[]; windows: PartyAlignmentWindow[] }>;
}
