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

export type ElectionResult = "eleito" | "eleito_qp" | "eleito_media" | "suplente" | "nao_eleito" | "segundo_turno" | "indeferido" | "renuncia";
export type Candidacy = {
  year: number;
  office: OfficeSlug;
  placeIbge: string;
  partyId: string;
  result: ElectionResult;
  votes: number | null; // null = votação por candidato ainda não carregada (nunca 0)
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
  /** votos sim/não iguais à orientação do partido / votações em que o partido orientou sim ou não; null = sem dado */
  partyAligned: number | null;
  partyAlignmentTotal: number | null;
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
  topic: string | null;
  result: "aprovado" | "rejeitado" | null;
  yes: number;
  no: number;
};
export type PersonVote = { event: VotingEvent; value: VoteValue; partyId: string };

export type Body = "camara" | "senado";
export type VotingEventSummary = VotingEvent & { proposal: { label: string; summary: string; url: string | null } | null; isNominal: boolean };
export type OrientationValue = "sim" | "nao" | "abstencao" | "obstrucao" | "liberado";
export type VotingEventDetail = VotingEventSummary & {
  counts: Record<VoteValue, number>;
  orientations: { label: string; kind: "partido" | "bloco" | "governo" | "maioria" | "minoria" | "oposicao"; value: OrientationValue }[];
  byParty: { party: string; counts: Partial<Record<VoteValue, number>>; total: number }[];
  votes: { slug: string; name: string; party: string; uf: string | null; value: VoteValue }[];
};
export type ActivityItem = {
  personSlug: string;
  personName: string;
  kind: "voto" | "proposta" | "gasto";
  occurredAt: string;
  title: string;
  detail: string | null;
  href: string;
};

export type LawItem = { number: string; sanctionedOn: string; summary: string; url: string | null; proposal: string; role: "autor" | "coautor" };
export type CommitteeItem = { acronym: string | null; name: string; role: string; from: string; to: string | null; body: Body };
export type SpeechItem = { id: string; occurredAt: string; summary: string | null; url: string | null };
export type ContactItem = { kind: "email" | "telefone" | "gabinete" | "site" | "instagram" | "facebook" | "x" | "youtube" | "tiktok" | "outra_rede"; value: string };

export type VotingEventFilter = { body: Body; year?: number; q?: string; result?: "aprovado" | "rejeitado"; cursor?: string; limit?: number };

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

// Pauta "No seu bolso" (db/migrations/0005, 0007). O motivo de entrada sai da regra vigente, nunca de escolha manual.
export type PautaStage = "plenario" | "comissao";
export type PautaReason = { theme: string | null; term: string };
export type PautaEntry = {
  key: string; // camara-pl-79-2020: o endereço da proposta
  body: Body;
  type: string;
  number: number;
  year: number;
  summary: string | null;
  stage: PautaStage;
  committee: string | null;
  scheduledFor: string; // ISO
  regime: string | null;
  rapporteur: string | null;
  reason: PautaReason;
  reviewedAt?: string | null; // respostas revisadas por pessoa e publicadas
  plain?: string | null; // "o que propõe", revisado; no lugar da ementa nos cartões
};
export type PautaRead = { readAt: string | null; failed: number; total: number };
export type PocketWeek = { total: number; atLeast: boolean; readAt: string | null; weekStarts: string; weekEnds: string };
export type PautaOverview = {
  week: PocketWeek;
  plenary: PautaEntry[]; // conta no número: plenário nesta semana
  later: PautaEntry[]; // plenário depois desta semana, dentro dos 14 dias
  committees: PautaEntry[];
  exits: (PautaEntry & { leftAt: string })[];
  reads: Record<Body, PautaRead>;
};
export type PautaStatus =
  | { kind: "na_pauta" }
  | { kind: "saiu"; at: string }
  | { kind: "reuniao_encerrada"; at: string }
  | { kind: "reuniao_cancelada"; at: string }
  | { kind: "sem_leitura"; lastSeenAt: string };
export type PautaVote = { id: string; occurredAt: string; description: string; result: string | null; yes: number | null; no: number | null };
export type PautaProposal = {
  entry: PautaEntry;
  status: PautaStatus;
  schedule: PautaEntry[]; // onde está na última leitura (pode estar em mais de uma reunião)
  readAt: string | null;
  fichaUrl: string | null;
  presentedOn: string | null;
  authors: { slug: string; name: string; role: "principal" | "coautoria" }[];
  votes: PautaVote[];
  answers: PublishedAnswers | null;
};
// Regra 3: respostas rascunhadas por IA, publicadas só depois de revisão humana (db/migrations/0009).
export const ANSWER_FIELDS = ["o_que_propoe", "quem_recebe", "quem_paga", "o_que_muda", "dinheiro", "estimativa_impacto"] as const;
export type AnswerField = (typeof ANSWER_FIELDS)[number];
export type AnswerClaim = { says: boolean; text: string; quote: string; page: number; direction?: "entra" | "sai" | "dividido" | "nao_diz" };
export type PublishedAnswers = {
  reviewedAt: string;
  sourceUrl: string;
  fields: Record<AnswerField, AnswerClaim>;
  correction: { correctedAt: string; note: string; previous: Record<AnswerField, AnswerClaim> } | null;
};
export type Correction = { key: string; label: string; correctedAt: string; note: string; changed: { field: AnswerField; before: AnswerClaim; after: AnswerClaim }[] };
export type PocketRule = { version: number; themes: string[]; terms: string[]; publishedOn: string };

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
  /** Pessoas em exercício numa casa, para o hemiciclo (ordem: partido A–Z, depois nome). */
  getChamber(body: Body): Promise<{ slug: string; name: string; party: string; uf: string | null }[]>;
  listVotingEvents(f: VotingEventFilter): Promise<Page<VotingEventSummary> & { years: number[] }>;
  getVotingEvent(id: string): Promise<VotingEventDetail | null>;
  /** Novidades de várias pessoas (feed de quem a pessoa acompanha), mais recentes primeiro. */
  getActivity(personIds: string[], limit?: number): Promise<ActivityItem[]>;
  getLaws(personId: string): Promise<LawItem[]>;
  getCommittees(personId: string): Promise<CommitteeItem[]>;
  listSpeeches(personId: string, f: { year?: number; cursor?: string; limit?: number }): Promise<Page<SpeechItem>>;
  getContacts(personId: string): Promise<ContactItem[]>;
  getStamp(dataset: string): Promise<Stamp>;
  latestRefresh(): Promise<string>;
  // R3 · pauta
  getPautaOverview(): Promise<PautaOverview>;
  getPautaProposal(key: string): Promise<PautaProposal | null>;
  listPocketRules(): Promise<PocketRule[]>;
  listCorrections(): Promise<Correction[]>;
}
