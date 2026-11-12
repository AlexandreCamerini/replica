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
export type VotingEventSummary = VotingEvent & {
  proposal: { label: string; summary: string; url: string | null } | null;
  isNominal: boolean;
  isSecret?: boolean;
  openNoVotes?: boolean;
  /**
   * Placar total como a fonte publicou (voting_events.yes_count / no_count): null = a fonte não publicou; 0 = publicou zero.
   * `yes`/`no` de VotingEvent fundem os dois em 0 e não servem para dizer "a fonte publicou".
   */
  placarFonte: { sim: number | null; nao: number | null };
};
export type OrientationValue = "sim" | "nao" | "abstencao" | "obstrucao" | "liberado";
export type VotingEventDetail = VotingEventSummary & {
  counts: Record<VoteValue, number>;
  orientations: { label: string; kind: "partido" | "bloco" | "governo" | "maioria" | "minoria" | "oposicao"; value: OrientationValue }[];
  byParty: { party: string; counts: Partial<Record<VoteValue, number>>; total: number }[];
  /**
   * `uf`: UF do mandato da pessoa NESTA casa que COBRE a data da votação (null = sem esse mandato carregado; nunca a UF de
   * outro mandato ou cargo). É a UF do placar por UF.
   * `ufAtual`: UF do mandato mais recente da pessoa, de qualquer cargo (a sigla de identificação da lista do v1). Não é a
   * UF na data e não entra no placar.
   */
  votes: { slug: string; name: string; party: string; uf: string | null; ufAtual: string | null; value: VoteValue }[];
  /** Placar por UF com as cadeiras legais da UF; lacuna quando não há voto individual. */
  porUf: PlacarPorUf;
};
/** Placar de uma UF numa votação: contagem por voto, como a fonte publicou, e as cadeiras da UF fixadas em lei (cadeiras.ts). */
export type PlacarUf = { uf: string; cadeiras: number; contagem: Record<VoteValue, number>; registros: number };
/**
 * Placar por UF (cadeiras.ts `placarPorUf`). `placar`: uma linha por UF da casa, em ordem alfabética de sigla (nunca por
 * tamanho); `semUf` = registros de quem não tem mandato nesta casa que cubra a data da votação (a UF não é identificada,
 * não é inventada), `semUfNomes` os nomes deles em ordem alfabética e `motivoSemUf` a frase do motivo.
 * `lacuna`: a votação não tem voto individual (secreta, aberta sem voto publicado ou só o placar total), ou
 * `semMandatos`: há voto individual, mas mais de LIMITE_SEM_UF dos registros ficariam sem UF (legislatura não carregada).
 * Registros abaixo das cadeiras não é ausência: a fonte publica só quem teve registro.
 */
export type PlacarPorUf =
  | { kind: "placar"; casa: Body; ufs: PlacarUf[]; semUf: number; semUfNomes: string[]; motivoSemUf: string; fonteCadeiras: string }
  | { kind: "lacuna"; motivo: string; semMandatos?: true };
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
  reviewedAt?: string | null; // respostas conferidas e publicadas (quem conferiu: `verifiedBy`)
  plain?: string | null; // "o que propõe", só no estado `diz`; no lugar da ementa nos cartões
  verifiedBy?: VerifiedBy; // quem conferiu as respostas publicadas; ausente/null = não registrado
};
/** U08: estado de uma sessão deliberativa para a pessoa. `fora_do_exercicio` não é falta e não entra no denominador. */
export type AttendanceState = "presente" | "ausente" | "ausencia_justificada" | "fora_do_exercicio";
export type AttendanceSession = { date: string; state: AttendanceState };
export type AttendanceGrid = { year: number; sessions: AttendanceSession[]; present: number; absent: number; justified: number; outside: number; total: number };

/** U09: o que acontece com cada cadeira na posse de 1º/02/2027. */
export type SeatChange = "continua" | "entra" | "sai";
export type TransitionSeat = { id: string; name: string; uf: string | null; change: SeatChange };
export type ChamberTransition = {
  capacity: number;
  /** false = os eleitos de 2026 do TSE ainda não foram carregados para esta casa: não dá para dizer quem sai. */
  loaded: boolean;
  /** quem ocupa a cadeira hoje (continua + sai), no máximo `capacity` */
  today: TransitionSeat[];
  /** quem ocupa a cadeira a partir de fev/2027 (continua + entra) */
  next: TransitionSeat[];
  continua: number;
  entra: number;
  sai: number;
  /** cadeiras de fev/2027 sem eleito carregado (capacity - next.length) */
  pending: number;
  /** mandatos em exercício além das cadeiras (fonte com duplicidade) */
  extra: number;
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
export type PautaAuthor = { slug: string; name: string; role: "principal" | "coautoria" };
/** Uma página de uma lista e o total que a fonte tem. `truncado` = há mais itens do que os devolvidos (total > itens.length). */
export type Lista<T> = { itens: T[]; total: number; truncado: boolean };
export type PautaProposal = {
  entry: PautaEntry;
  status: PautaStatus;
  schedule: PautaEntry[]; // onde está na última leitura (pode estar em mais de uma reunião)
  readAt: string | null;
  fichaUrl: string | null;
  presentedOn: string | null;
  /**
   * @deprecated o v1 (/proposta) ainda lê: autoria principal primeiro, depois ordem de assinatura (sign_order), até 20,
   * como na main. NÃO são os itens de `autores` (que seguem nome em ordem alfabética); sem o total.
   */
  authors: PautaAuthor[];
  /** @deprecated o v1 (/proposta) ainda lê: mesmos itens de `votacoes.itens`, sem o total. */
  votes: PautaVote[];
  /** Autoria principal e coautoria: autoria principal primeiro, depois nome em ordem alfabética; até 20 e o total. */
  autores: Lista<PautaAuthor>;
  /** Votações da proposta, da mais recente para a mais antiga; até 5 e o total. */
  votacoes: Lista<PautaVote>;
  answers: PublishedAnswers | null;
};
// Regra 3: respostas rascunhadas por IA, publicadas só depois de conferidas (por pessoa ou por agentes: `verifiedBy`).
export const ANSWER_FIELDS = ["o_que_propoe", "quem_recebe", "quem_paga", "o_que_muda", "dinheiro", "estimativa_impacto"] as const;
export type AnswerField = (typeof ANSWER_FIELDS)[number];
/** Três estados por campo (etl/civico_etl/verification.py): `diz` = frase conferida contra o trecho; `nao_diz` = o texto
 *  não trata do ponto (só com `estado` gravado; `diz:false` de linha antiga vira `nao_conferido`, lib/answer-claims.ts);
 *  `nao_conferido` = não afirma nada sobre a lei. */
export type AnswerState = "diz" | "nao_diz" | "nao_conferido";
/** `says` é mantido por compatibilidade e vale sempre `state === "diz"`. Fora de `diz`, `text` e `quote` vêm vazios. */
export type AnswerClaim = { state: AnswerState; says: boolean; text: string; quote: string; page: number; direction?: "entra" | "sai" | "dividido" | "nao_diz" };
/** Quem conferiu uma resposta publicada (answer_drafts.verified_by, migração 0130). null = coluna ausente ou vazia. */
export type VerifiedBy = "agentes" | "pessoa" | null;
export type PublishedAnswers = {
  reviewedAt: string;
  verifiedBy: VerifiedBy;
  sourceUrl: string;
  fields: Record<AnswerField, AnswerClaim>;
  correction: { correctedAt: string; note: string; previous: Record<AnswerField, AnswerClaim> } | null;
};
export type Correction = { key: string; label: string; correctedAt: string; note: string; changed: { field: AnswerField; before: AnswerClaim; after: AnswerClaim }[] };
export type PocketRule = { version: number; themes: string[]; terms: string[]; publishedOn: string };

// ---------- Cobertura por pessoa (cobertura.ts) ----------
/** Os conjuntos que a Pessoa e os Escolhidos mostram. */
export const CONJUNTOS_PESSOA = ["presenca", "votos", "gastos", "patrimonio", "propostas", "leis", "equipe", "comissoes", "emendas"] as const;
export type ConjuntoPessoa = (typeof CONJUNTOS_PESSOA)[number];
/**
 * O que o banco sabe de um conjunto para uma pessoa. Só estados que o dado sustenta:
 * - `lido`: há carimbo de carga da fonte da casa (dataset_stamps; SAPL: loaded_at). Lista vazia aqui é "não há", não lacuna.
 * - `sem_fonte`: a fonte oficial não publica (data_coverage `nao_publica`; Senado não publica presença por senador).
 * - `fonte_sem_adaptador`: está só no portal oficial, sem dado aberto que o ETL leia (data_coverage `so_portal`).
 * - `nao_carregado`: a fonte publica ou pode publicar, mas não carregamos (data_coverage `carregando`, `no_site` sem carimbo,
 *   `missing_datasets` do derive.stats, ou conjunto que o ETL não lê para este cargo).
 * - `nao_conferido`: ainda não conferimos se a fonte publica (data_coverage `desconhecido` ou sem linha).
 * - `nao_se_aplica`: o cargo não tem esse conjunto (Executivo não vota em plenário nem tem cota de gabinete).
 * - `carregado_fora_da_pagina`: o dado foi carregado (há carga: SAPL da câmara ou da Assembleia), mas as leituras desta
 *   página (presença, votos, propostas) ainda não o usam. Não é "não há" nem "não carregamos".
 * - `fora_do_mandato`: o mandato principal não está em exercício (aguardando posse, licenciado, afastado, encerrado…):
 *   a leitura de presença, votos, gastos, equipe e comissões cobre o exercício do cargo.
 */
export const ESTADOS_COBERTURA = ["lido", "sem_fonte", "fonte_sem_adaptador", "nao_carregado", "carregado_fora_da_pagina", "nao_conferido", "nao_se_aplica", "fora_do_mandato"] as const;
export type EstadoCobertura = (typeof ESTADOS_COBERTURA)[number];
export type CoberturaConjunto = {
  conjunto: ConjuntoPessoa;
  estado: EstadoCobertura;
  /** frase curta, legível, do porquê do estado (vem do banco quando ele tem: data_coverage.reason) */
  motivo: string;
  /** de onde vem o dado (lido) ou a página que sustenta o motivo (lacuna); null = não há */
  fonte: { nome: string; url: string | null } | null;
  /** data da última carga (ISO), só em `lido`; null = sem carimbo */
  lidoEm: string | null;
};
export type CoberturaPessoa = { personId: string; conjuntos: CoberturaConjunto[] };

// ---------- Leituras em lote (Escolhidos) ----------
/** `encontradas` na ordem dos slugs pedidos, já resolvido o redirecionamento de slug antigo; `naoEncontradas` = slugs que a fonte não conhece. */
export type PessoasPorSlug = { encontradas: { slug: string; person: Person }[]; naoEncontradas: string[] };
/** Votos de lei (scope "lei") mais recentes de cada pessoa e o total. */
export type VotosRecentes = { items: PersonVote[]; total: number };
/** Lote por id de pessoa: objeto simples (passa pelo cache como JSON). Pessoa sem linha = conjunto vazio para ela. */
export type PorPessoa<T> = Record<string, T>;

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
  /** U08: uma entrada por sessão deliberativa do ano, em ordem de data. total = presentes + ausentes + justificadas (fora do exercício não entra). */
  getAttendanceGrid(personId: string, year: number): Promise<AttendanceGrid>;
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
  /** U09: composição de hoje e de fev/2027, sem partido: só continua / entra / sai. */
  getChamberTransition(body: Body): Promise<ChamberTransition>;
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
  /**
   * Normas que fixam o salário do cargo (decreto legislativo ou Constituição). Vazio = sem salário carregado.
   * `updatedAt` (v1): quando o valor gravado mudou pela última vez (max(salaries.updated_at)), não quando foi conferido.
   * `loadedAt`: carimbo da carga da fonte da norma (dataset_stamps da mesma fonte); null = a carga não registra carimbo.
   */
  getSalarySources(office: OfficeSlug): Promise<{ name: string; url: string; updatedAt: string; loadedAt: string | null }[]>;
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
  /**
   * `simulate` só é lido pela fonte de demonstração: "erro" = a leitura da Câmara falhou em parte das reuniões;
   * "camara_nao_lida" = a pauta da Câmara ainda não foi lida (`readAt` null, sem itens da Câmara).
   */
  getPautaOverview(opts?: { simulate?: "erro" | "camara_nao_lida" }): Promise<PautaOverview>;
  getPautaProposal(key: string): Promise<PautaProposal | null>;
  listPocketRules(): Promise<PocketRule[]>;
  listCorrections(): Promise<Correction[]>;
  listSourceStatus(): Promise<SourceStatus[]>;
  getCoverageMatrix(): Promise<CoverageMatrix>;

  // ---------- cobertura por pessoa ----------
  /** Um leitor só, por pessoa: para cada conjunto de CONJUNTOS_PESSOA, estado, motivo, fonte e data da última carga. Ordem dos ids pedidos. */
  getPeopleCoverage(personIds: string[]): Promise<CoberturaPessoa[]>;

  // ---------- leituras em lote (número constante de consultas; cada uma lança ao falhar, o chamador decide a lacuna) ----------
  getPeopleBySlugs(slugs: string[]): Promise<PessoasPorSlug>;
  getMandatesForPeople(personIds: string[]): Promise<PorPessoa<Awaited<ReturnType<DataSource["getMandates"]>>>>;
  getCandidaciesForPeople(personIds: string[]): Promise<PorPessoa<Awaited<ReturnType<DataSource["getCandidacies"]>>>>;
  getLawsForPeople(personIds: string[]): Promise<PorPessoa<LawItem[]>>;
  getStatsForPeople(personIds: string[], period: PeriodStats["period"]): Promise<PorPessoa<PeriodStats>>;
  getAttendanceGridForPeople(personIds: string[], year: number): Promise<PorPessoa<AttendanceGrid>>;
  /** Os `limit` votos mais recentes de cada pessoa no recorte "lei" (sem requerimento e urgência) e o total. */
  getRecentLawVotesForPeople(personIds: string[], limit: number): Promise<PorPessoa<VotosRecentes>>;
  /** Gasto do ano por categoria (mesma soma de `listExpenses(...).byCategory`). */
  getExpensesByCategoryForPeople(personIds: string[], year: number): Promise<PorPessoa<{ label: string; cents: number }[]>>;
  getPlaces(ibges: string[]): Promise<Place[]>;
}
