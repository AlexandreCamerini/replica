// Tipos de domínio. Espelham replica/schema.sql; a implementação real (Postgres) devolve as mesmas formas.

export type Level = "federal" | "estadual" | "municipal";

export type OfficeSlug =
  | "presidente"
  | "vice_presidente"
  | "senador"
  | "deputado_federal"
  | "governador"
  | "vice_governador"
  | "deputado_estadual"
  | "deputado_distrital"
  | "prefeito"
  | "vice_prefeito"
  | "vereador";

export type Office = { slug: OfficeSlug; nameM: string; nameF: string; level: Level; order: number };

export type PlaceKind = "pais" | "regiao" | "uf" | "municipio";
export type Place = {
  ibge: string;
  kind: PlaceKind;
  name: string;
  slug: string;
  uf: string | null;
  region: string | null;
};

export type Party = { id: string; acronym: string; name: string };

export type MandateStatus = "em_exercicio" | "eleito_aguardando_posse" | "licenciado" | "encerrado";
export type Mandate = {
  id: string;
  personId: string;
  office: OfficeSlug;
  placeIbge: string;
  partyId: string;
  status: MandateStatus;
  startedOn: string; // ISO date
  endsOn: string;
  statusSource: string;
};

export type ElectionResult = "eleito" | "eleito_qp" | "eleito_media" | "suplente" | "nao_eleito";
export type Candidacy = {
  year: number;
  office: OfficeSlug;
  placeIbge: string;
  partyId: string;
  result: ElectionResult;
  votes: number;
  raisedCents: number | null;
  spentCents: number | null;
  assetsCents: number | null;
};

export type Person = {
  id: string;
  slug: string;
  displayName: string;
  civilName: string;
  gender: "f" | "m";
  birthDate: string | null;
  birthplaceIbge: string | null;
  education: string | null;
};

/** Stats de um período. null = a fonte não publica (mostra "—", nunca 0). */
export type PeriodStats = {
  period: "career" | `${number}`;
  presencePresent: number | null;
  presenceTotal: number | null;
  proposalsPrincipal: number | null;
  proposalsCosigned: number | null;
  votesRegistered: number | null;
  expensesCents: number | null;
  salaryMonthlyCents: number | null;
  salaryIsCeiling: boolean;
  topTopics: { topic: string; count: number }[];
  missing: MissingDataset[];
};

export type Dataset =
  | "salario"
  | "presenca"
  | "votos"
  | "propostas"
  | "gastos_gabinete"
  | "patrimonio";

export type CoverageStatus = "no_site" | "carregando" | "so_portal" | "nao_publica" | "desconhecido";
export type MissingDataset = { dataset: Dataset; label: string; status: CoverageStatus; reason: string };

export type Topic = { slug: string; name: string };

export type Proposal = {
  id: string;
  type: string;
  number: number;
  year: number;
  summary: string;
  topics: string[];
  role: "autor" | "coautor";
  canBecomeLaw: boolean;
  status: string;
  presentedOn: string;
  url: string;
};

export type VoteValue = "sim" | "nao" | "abstencao" | "obstrucao" | "art17" | "nao_votou";
export type VotingEvent = {
  id: string;
  body: "camara" | "senado";
  occurredAt: string;
  description: string;
  topic: string;
  result: "aprovado" | "rejeitado";
  yes: number;
  no: number;
};
export type PersonVote = { event: VotingEvent; value: VoteValue; partyId: string };

export type Expense = {
  id: string;
  occurredOn: string;
  category: string;
  supplier: string;
  amountCents: number;
  receiptUrl: string | null;
};

export type Stamp = { dataset: string; source: string; sourceUrl: string; refreshedAt: string };

export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** Uma pessoa no cargo, já com o que a lista precisa (cartão). */
export type Officeholder = {
  person: Person;
  mandate: Mandate;
  party: Party;
  officeName: string;
  placeLabel: string;
};

export type RepresentativeGroup = {
  key: string;
  title: string;
  level: Level;
  where: string;
  people: Officeholder[];
};

export type PeopleFilter = {
  q?: string;
  office?: OfficeSlug;
  uf?: string;
  party?: string;
  letter?: string;
  cursor?: string;
  limit?: number;
};

export type ProposalFilter = { year?: number; topic?: string; type?: "lei" | "pedido"; role?: "autor" | "coautor"; q?: string; cursor?: string; limit?: number };
export type VoteFilter = { year?: number; topic?: string; value?: VoteValue; q?: string; cursor?: string; limit?: number };
export type ExpenseFilter = { year?: number; category?: string; cursor?: string; limit?: number };

export type Agreement = { a: string; b: string; same: number; total: number };

/** Contrato da camada de dados. A versão fake e a Postgres implementam isto; nenhuma tela importa a implementação. */
export interface DataSource {
  readonly isDemo: boolean;
  searchPlaces(q: string, limit?: number): Promise<Place[]>;
  getPlace(ibge: string): Promise<Place | null>;
  getPlaceByUf(uf: string): Promise<Place | null>;
  listUfs(): Promise<Place[]>;
  listMunicipalities(uf?: string): Promise<Place[]>;
  getRepresentatives(place: Place): Promise<RepresentativeGroup[]>;
  getCoverage(place: Place): Promise<MissingDataset[]>;
  getCounters(): Promise<{ total: number; byLevel: Record<Level, number>; byOffice: { office: OfficeSlug; label: string; count: number }[] }>;
  listParties(): Promise<Party[]>;
  listOffices(): Promise<Office[]>;
  listPeople(f: PeopleFilter): Promise<Page<Officeholder>>;
  searchPeople(q: string, limit?: number): Promise<Officeholder[]>;
  getPerson(slug: string): Promise<{ person: Person; redirectTo?: string } | null>;
  getMandates(personId: string): Promise<(Mandate & { party: Party; officeName: string; placeLabel: string })[]>;
  getCandidacies(personId: string): Promise<(Candidacy & { party: Party; officeName: string; placeLabel: string })[]>;
  getStats(personId: string, period: PeriodStats["period"]): Promise<PeriodStats>;
  getActiveYears(personId: string): Promise<number[]>;
  listProposals(personId: string, f: ProposalFilter): Promise<Page<Proposal>>;
  listVotes(personId: string, f: VoteFilter): Promise<Page<PersonVote>>;
  listExpenses(personId: string, f: ExpenseFilter): Promise<Page<Expense> & { byCategory: { label: string; cents: number }[] }>;
  getAgreement(personIds: string[], period: "career" | number): Promise<Agreement[]>;
  listTopics(): Promise<Topic[]>;
  getStamp(dataset: string): Promise<Stamp>;
  latestRefresh(): Promise<string>;
}
