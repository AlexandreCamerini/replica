import type { DataSourceW4 } from "./types-w4";

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
  /** moradores (IBGE, estimativa do ano em populationYear); null/ausente = não carregado */
  population?: number | null;
};

/** Votos de uma candidatura num município (S07 "mais votados na cidade"). */
export type PlaceTopVoted = {
  year: number;
  groups: { office: OfficeSlug; label: string; items: { slug: string; name: string; gender: "f" | "m"; party: string; votes: number; result: ElectionResult | null }[] }[];
};

export type Party = { id: string; acronym: string; name: string };

export type MandateStatus = "em_exercicio" | "eleito_aguardando_posse" | "licenciado" | "afastado" | "encerrado" | "renunciou" | "cassado";
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
  /** como chegou ao cargo: "TSE 2022", ou "sucessão: vice assumiu (…)" quando o vice virou titular. Opcional na demo. */
  electedBy?: string | null;
};

export type ElectionResult = "eleito" | "eleito_qp" | "eleito_media" | "suplente" | "nao_eleito" | "segundo_turno" | "indeferido" | "renuncia";
export type Candidacy = {
  year: number;
  office: OfficeSlug;
  placeIbge: string;
  partyId: string;
  result: ElectionResult | null; // null = a fonte não publica resultado (#NULO#), mostrado como "Sem resultado publicado" (BUG-045)
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

/** Uma linha por ano com dado (S08 "ano a ano"). Mesma regra: null = a fonte não publica ou não carregou. */
export type YearStats = {
  year: number;
  presencePresent: number | null;
  presenceTotal: number | null;
  proposalsPrincipal: number | null;
  proposalsCosigned: number | null;
  votesRegistered: number | null;
  expensesCents: number | null;
};

/** Subsídio bruto somado mês a mês desde a posse (W1 item 10). Só com valor pago publicado (teto não entra). */
export type SalaryAccrued = { cents: number; months: number; coveredMonths: number; firstMonth: string; coveredFrom: string | null };

/** Prestação de contas de uma campanha, somada por categoria oficial do TSE. Nunca nome de doador (D36). */
export type CampaignFinance = {
  year: number;
  officeName: string;
  placeLabel: string;
  income: { label: string; cents: number }[];
  spending: { label: string; cents: number }[];
  /** Catálogo D11: receita por origem (fundo vence origem), na ordem fixa de CAMPAIGN_ORIGINS; vazio = origem não carregada. */
  origins: { origin: CampaignOrigin; cents: number }[];
  /** Só partido e pessoa jurídica têm nome; pessoa física nunca (D36). */
  donors: { name: string; kind: "partido" | "pessoa_juridica"; cents: number }[];
};
export type CampaignOrigin = "fefc" | "fundo_partidario" | "partido" | "pessoa_fisica" | "financiamento_coletivo" | "recursos_proprios" | "outros";
/** Ordem fixa de exibição (catálogo D11: a composição inteira, sem destacar a maior parte). */
export const CAMPAIGN_ORIGINS: { origin: CampaignOrigin; label: string; publicMoney: boolean }[] = [
  { origin: "fefc", label: "Fundo Eleitoral (FEFC)", publicMoney: true },
  { origin: "fundo_partidario", label: "Fundo Partidário", publicMoney: true },
  { origin: "partido", label: "Partido (outros recursos)", publicMoney: false },
  { origin: "pessoa_fisica", label: "Pessoas físicas", publicMoney: false },
  { origin: "financiamento_coletivo", label: "Financiamento coletivo", publicMoney: false },
  { origin: "recursos_proprios", label: "Recursos próprios", publicMoney: false },
  { origin: "outros", label: "Outros", publicMoney: false },
];

/** Catálogo D02: uma emenda parlamentar do Portal da Transparência, nos três estágios (empenhado, liquidado, pago). */
export type Amendment = {
  year: number;
  kind: "individual" | "individual_pix" | "bancada" | "comissao" | "relator" | "outro";
  kindLabel: string | null;
  area: string | null;
  authorLabel: string;
  authorSlug: string | null;
  /** destino: município casado (com link) ou o texto da fonte com o motivo de não haver município */
  place: { ibge: string; name: string; uf: string | null } | null;
  localityLabel: string | null;
  placeNote: string | null;
  /** null = a fonte não publicou o estágio (0082: "NULL, nunca 0"); a tela mostra "—" */
  committedCents: number | null;
  liquidatedCents: number | null;
  paidCents: number | null;
};

/** Equipe do gabinete (W2 item 14). Salário null = a fonte lida não traz (vira "—" com motivo). */
export type StaffMember = { name: string; role: string | null; monthlySalaryCents: number | null; asOf: string };

export type Dataset =
  | "salario"
  | "presenca"
  | "votos"
  | "propostas"
  | "gastos_gabinete"
  | "patrimonio";

export type CoverageStatus = "no_site" | "carregando" | "so_portal" | "nao_publica" | "desconhecido";
export type MissingDataset = {
  dataset: Dataset;
  label: string;
  status: CoverageStatus;
  reason: string;
  /** U03: página que sustenta o motivo (data_coverage.evidence_url); null/ausente = não há */
  evidenceUrl?: string | null;
  /** U03: quando conferimos (data_coverage.checked_on, ISO) */
  checkedOn?: string | null;
};
/** U03: o site da câmara municipal, quando o banco conhece um. `url` = SAPL lido da câmara; `note` = o que o registro do Interlegis diz de uma câmara sem SAPL. */
export type CouncilSite = { url: string | null; note: string | null };
/** U01: o fato mais recente da pessoa entre o que o crachá mostra (voto nominal, proposta de autoria, gasto). `on` = ISO date. */
export type LatestRecord = {
  kind: "votacao" | "proposta" | "gasto";
  on: string;
  /** a casa lança o gasto sempre no dia 1 do mês (ALESP, assembleias, câmaras): só o mês é fato, o dia não */
  monthOnly?: boolean;
};
/** U12: um degrau do subsídio (salaries). `validFrom` no futuro = reajuste previsto que ainda não vale. */
export type SalaryStep = { validFrom: string; amountCents: number; isCeiling: boolean; source: { name: string; url: string } };

export type Topic = { slug: string; name: string };

/** W3-A: o que o site lê da Assembleia de uma UF. Cada item tem status e motivo; "no_site" vem com a data da carga. */
export type AssemblyDataset = "presenca" | "votos" | "propostas" | "gastos_gabinete";
export type AssemblyItem = {
  dataset: AssemblyDataset;
  label: string;
  status: CoverageStatus;
  reason: string;
  evidenceUrl: string | null;
  checkedOn: string | null;
  /** carimbo da última carga deste conjunto (null = nunca carregado) */
  refreshedAt: string | null;
  /** prefixo do carimbo (ex.: "alesp.proposicoes"), para getStamp */
  stampDataset: string | null;
};
/** W3-A/B: Câmara Municipal lida pelo SAPL (tabelas sapl_*, D126–D129). Presença sem porcentagem: a fonte não publica o denominador. */
export type CityCouncilInfo = {
  /** D09: a mesma leitura serve a Assembleia Legislativa com SAPL (city = nome da UF) */
  house: "camara_municipal" | "assembleia";
  city: string;
  uf: string;
  baseUrl: string;
  legislature: number | null;
  legislatureStart: string | null;
  legislatureEnd: string | null;
  loadedAt: string;
  materias: { total: number; principal: number; items: { type: string; number: number; year: number; presentedOn: string | null; summary: string; url: string; principal: boolean }[] };
  presence: { sessions: number; first: string | null; last: string | null };
  /** null = o SAPL da câmara não tem voto nominal registrado na legislatura */
  votes: { total: number; byValue: { label: string; n: number }[]; items: { votedAt: string | null; value: string; description: string | null }[] } | null;
};
export type AssemblyInfo = {
  uf: string;
  houseName: string;
  /** a casa tem adaptador de dados abertos ligado */
  read: boolean;
  source: { name: string; url: string } | null;
  items: AssemblyItem[];
};

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
/** voting_events.kind: o que a votação decidiu. texto/destaque mudam o texto de uma proposta; urgência e requerimento são procedimento. */
export type VoteKind = "texto" | "destaque" | "urgencia" | "requerimento" | "outro";
/** U11: "lei" esconde requerimento e urgência (procedimento); "tudo" mostra todas. Ausente = tudo (contrato da API não muda). */
export type VoteScope = "lei" | "tudo";
export type VotingEvent = {
  id: string;
  body: "camara" | "senado";
  kind?: VoteKind;
  occurredAt: string;
  description: string;
  topic: string | null;
  result: "aprovado" | "rejeitado" | null;
  yes: number;
  no: number;
};
export type PersonVote = { event: VotingEvent; value: VoteValue; partyId: string };

export type Body = "camara" | "senado";
/** isSecret: a fonte marca a votação como secreta (`voting_events.is_secret`, D123); não é "não votou".
 *  openNoVotes: a fonte diz que foi aberta, mas não publicou o voto de cada pessoa. Fonte que não informa (Câmara) = os dois false. */
export type VotingEventSummary = VotingEvent & { proposal: { label: string; summary: string; url: string | null } | null; isNominal: boolean; isSecret?: boolean; openNoVotes?: boolean };
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
/** S09 aba "virou lei": norma publicada + a proposta de origem e os autores principais que têm crachá. */
/** S09 aba "agenda": sessões do Plenário já marcadas (`agenda_events`) e a pauta de cada uma (`agenda_items`). Texto de situação e regime como a fonte escreve. */
export type AgendaItem = {
  position: number;
  label: string | null; // "PL 6461/2019"
  title: string;
  summary: string | null;
  regime: string | null;
  rapporteur: string | null;
  outcome: string | null;
  proposalUrl: string | null; // página oficial da proposta, só se a proposta está carregada
  votingEventId: string | null; // votação nominal da mesma proposta, se houver
};
export type AgendaEvent = {
  id: string;
  house: "camara" | "senado" | "congresso";
  startsAt: string; // ISO com fuso
  kind: string;
  title: string | null;
  status: string;
  location: string | null;
  officialUrl: string | null;
  items: AgendaItem[];
  itemsTotal: number;
};
export type AgendaView = { events: AgendaEvent[]; total: number; source: { name: string; url: string; refreshedAt: string } | null };

export type LawListItem = { number: string; sanctionedOn: string; summary: string; url: string | null; proposal: string | null; proposalUrl: string | null; authors: { slug: string; name: string }[]; moreAuthors: number };
export type CommitteeItem = { acronym: string | null; name: string; role: string; from: string; to: string | null; body: Body };
export type SpeechItem = { id: string; occurredAt: string; summary: string | null; url: string | null };
export type ContactItem = { kind: "email" | "telefone" | "gabinete" | "site" | "instagram" | "facebook" | "x" | "youtube" | "tiktok" | "outra_rede"; value: string };

export type VotingEventFilter = { body: Body; year?: number; q?: string; result?: "aprovado" | "rejeitado"; scope?: VoteScope; cursor?: string; limit?: number };

export type Expense = {
  id: string;
  occurredOn: string;
  category: string;
  supplier: string;
  amountCents: number;
  receiptUrl: string | null;
};

export type Stamp = { dataset: string; source: string; sourceUrl: string; refreshedAt: string };

/** Uma fonte oficial e os carimbos de cada conjunto carregado dela (S24). Sem estado "no prazo": isso se calcula em lib/sources. */
export type SourceStatus = {
  slug: string;
  name: string;
  url: string;
  datasets: { dataset: string; refreshedAt: string }[];
  lastRefreshedAt: string | null;
};

/** Contagem de cidades por situação do dado, por UF e tipo de dado (S23). Só municípios; a UF não entra na conta. */
export type CoverageCounts = Partial<Record<CoverageStatus, number>>;
export type CoverageMatrix = {
  datasets: { key: string; label: string }[];
  rows: { uf: string; name: string; cities: number; cells: Record<string, CoverageCounts> }[];
  total: { cities: number; cells: Record<string, CoverageCounts> };
  checkedOn: string | null;
};

export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** De onde vem o partido vigente da pessoa e desde quando (BUG-022, D220). `since` = início da linha do tempo `party_memberships` nesse partido. */
export type PartyProvenance =
  | { kind: "camara" | "senado" | "tse"; since: string; electionYear?: number }
  | { kind: "none"; reason: string };

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
  /** Cargo do grupo sem ninguém em exercício na fonte: aparece como “—” com o motivo, nunca some (BUG-024). */
  gaps?: { what: string; why: string }[];
  /** Cadeiras da casa legislativa: carregadas contra as previstas na Constituição (BUG-025). */
  seats?: { loaded: number; total: number; why: string };
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

export type ProposalFilter = { year?: number; topic?: string; type?: "lei" | "pedido" | "emenda"; role?: "autor" | "coautor"; q?: string; cursor?: string; limit?: number };
export type VoteFilter = { year?: number; topic?: string; value?: VoteValue; q?: string; scope?: VoteScope; cursor?: string; limit?: number };
export type ExpenseFilter = { year?: number; category?: string; cursor?: string; limit?: number };

export type Agreement = { a: string; b: string; same: number; total: number };
/** Uma votação em que as duas pessoas registraram votos diferentes (comparar, W1 item 8). */
export type Disagreement = { event: VotingEvent & { proposalLabel: string | null }; a: VoteValue; b: VoteValue };

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
export interface DataSource extends DataSourceW4 {
  readonly isDemo: boolean;
  searchPlaces(q: string, limit?: number): Promise<Place[]>;
  getPlace(ibge: string): Promise<Place | null>;
  getPlaceByUf(uf: string): Promise<Place | null>;
  listUfs(): Promise<Place[]>;
  listMunicipalities(uf?: string): Promise<Place[]>;
  getRepresentatives(place: Place): Promise<RepresentativeGroup[]>;
  getCoverage(place: Place): Promise<MissingDataset[]>;
  /** W3-A: Assembleia Legislativa da UF (ou Câmara Legislativa do DF): fonte, o que é lido e o motivo de cada "—". null = UF inexistente. */
  getAssembly(uf: string): Promise<AssemblyInfo | null>;
  /** Vereador casado no SAPL da câmara (match_status = casado). null = câmara não lida pelo SAPL ou pessoa não casada. */
  getCityCouncil(personId: string): Promise<CityCouncilInfo | null>;
  /** Mais votados no município na última eleição geral com votos por município carregados (deputados federais e estaduais). null = sem dado. */
  getTopVotedInPlace(ibge: string, limit?: number): Promise<PlaceTopVoted | null>;
  getCounters(): Promise<{ total: number; byLevel: Record<Level, number>; byOffice: { office: OfficeSlug; label: string; count: number; expected?: number; why?: string }[] }>;
  listParties(): Promise<Party[]>;
  listOffices(): Promise<Office[]>;
  listPeople(f: PeopleFilter): Promise<Page<Officeholder>>;
  searchPeople(q: string, limit?: number): Promise<Officeholder[]>;
  getPerson(slug: string): Promise<{ person: Person; redirectTo?: string } | null>;
  getMandates(personId: string): Promise<(Mandate & { party: Party; officeName: string; placeLabel: string })[]>;
  getCandidacies(personId: string): Promise<(Candidacy & { party: Party; officeName: string; placeLabel: string })[]>;
  /** Fonte e data do partido vigente (person_current_party). `none` traz o motivo. */
  getPartyProvenance(personId: string): Promise<PartyProvenance>;
  getStats(personId: string, period: PeriodStats["period"]): Promise<PeriodStats>;
  getActiveYears(personId: string): Promise<number[]>;
  /** Estatísticas de cada ano carregado (sem "career"), do mais antigo ao mais recente. */
  getYearlyStats(personId: string): Promise<YearStats[]>;
  /** Votações que a fonte marca como secretas (is_secret = true) no período de exercício do senador. */
  countSecretVotes(personId: string, year?: number): Promise<number>;
  /** Uma entrada por ano de eleição (o 2º turno não repete), mais recente primeiro. */
  getCampaignFinance(personId: string): Promise<CampaignFinance[]>;
  /** Emendas de autoria da pessoa (catálogo D02), ano desc e destino A–Z. Nunca por valor. */
  listAmendmentsByPerson(personId: string): Promise<Amendment[]>;
  /** Emendas com destino no município (catálogo D02), ano desc e autor A–Z. */
  listAmendmentsToPlace(ibge: string): Promise<Amendment[]>;
  /** Equipe do gabinete, A–Z por nome. */
  listStaff(personId: string): Promise<StaffMember[]>;
  /** null = cargo sem valor pago publicado (teto ou nada). */
  getSalaryAccrued(personId: string, year?: number): Promise<SalaryAccrued | null>;
  /** Presença por mês num ano (sessões deliberativas da Câmara; fora do exercício não conta). Só meses com sessão. */
  getPresenceByMonth(personId: string, year: number): Promise<{ month: number; present: number; total: number }[]>;
  listProposals(personId: string, f: ProposalFilter): Promise<Page<Proposal>>;
  /** `hidden` = votos nominais que o `scope: "lei"` escondeu (0 quando scope é "tudo" ou ausente). */
  listVotes(personId: string, f: VoteFilter): Promise<Page<PersonVote> & { hidden: number }>;
  listExpenses(personId: string, f: ExpenseFilter): Promise<Page<Expense> & { byCategory: { label: string; cents: number }[] }>;
  getAgreement(personIds: string[], period: "career" | number): Promise<Agreement[]>;
  /** Votações em que a e b votaram diferente (sim/não/abstenção/obstrução), mais recentes primeiro; topics = temas com divergência e quantas. */
  listDisagreements(a: string, b: string, f: { year?: number; topic?: string; limit?: number }): Promise<Page<Disagreement> & { topics: { slug: string; count: number }[] }>;
  listTopics(): Promise<Topic[]>;
  /** Pessoas em exercício numa casa, para o hemiciclo (ordem: partido A–Z, depois nome). */
  getChamber(body: Body): Promise<{ slug: string; name: string; party: string; uf: string | null }[]>;
  listVotingEvents(f: VotingEventFilter): Promise<Page<VotingEventSummary> & { years: number[]; hidden: number }>;
  getVotingEvent(id: string): Promise<VotingEventDetail | null>;
  /** Novidades de várias pessoas (feed de quem a pessoa acompanha), mais recentes primeiro. */
  getActivity(personIds: string[], limit?: number): Promise<ActivityItem[]>;
  getLaws(personId: string): Promise<LawItem[]>;
  /** Leis federais por data de publicação (mais recente primeiro). */
  listLaws(f: { year?: number; cursor?: string; limit?: number }): Promise<Page<LawListItem> & { years: number[] }>;
  /** Próximas sessões do Plenário (a partir de hoje, horário de Brasília) e a pauta. `casa` senado inclui o Congresso Nacional. */
  getAgenda(f: { body: Body; limit?: number }): Promise<AgendaView>;
  getCommittees(personId: string): Promise<CommitteeItem[]>;
  listSpeeches(personId: string, f: { year?: number; cursor?: string; limit?: number }): Promise<Page<SpeechItem>>;
  getContacts(personId: string): Promise<ContactItem[]>;
  getStamp(dataset: string): Promise<Stamp>;
  /** Normas que fixam o salário do cargo (decreto legislativo ou Constituição), com a data da última carga. Vazio = sem salário carregado. */
  getSalarySources(office: OfficeSlug): Promise<{ name: string; url: string; updatedAt: string }[]>;
  /** Anos já carregados de um conjunto com carimbo por ano (ex.: "tse.contas" → [2018, 2020, …]), crescente. */
  listStampYears(prefix: string): Promise<number[]>;
  latestRefresh(): Promise<string>;
  /** U01: data do registro mais recente da pessoa (voto nominal, proposta de autoria ou gasto). null = nenhum registro carregado. */
  getLatestRecord(personId: string): Promise<LatestRecord | null>;
  /** U03: site da câmara municipal da cidade (SAPL lido) ou o que o registro diz de uma câmara sem SAPL. null = o banco não sabe nada da câmara. */
  getCouncilSite(ibge: string): Promise<CouncilSite | null>;
  /** U12: degraus do subsídio do cargo (no lugar, ou nacional), do mais antigo ao mais novo; inclui o teto constitucional marcado em `isCeiling`. */
  getSalarySchedule(office: OfficeSlug, placeIbge: string): Promise<SalaryStep[]>;
  // R3 · pauta
  getPautaOverview(): Promise<PautaOverview>;
  getPautaProposal(key: string): Promise<PautaProposal | null>;
  listPocketRules(): Promise<PocketRule[]>;
  listCorrections(): Promise<Correction[]>;
  listSourceStatus(): Promise<SourceStatus[]>;
  getCoverageMatrix(): Promise<CoverageMatrix>;
}
