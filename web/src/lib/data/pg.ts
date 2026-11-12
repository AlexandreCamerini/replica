import "server-only";
import postgres from "postgres";
import { houseName, notReadReason } from "./assembleias";
import { UF_ROWS, stateSeats } from "./reference";
import type {
  AttendanceGrid,
  AttendanceState,
  ChamberTransition,
  TransitionSeat,
  AssemblyDataset,
  VoteKind,
  LatestRecord,
  SalaryStep,
  AssemblyInfo,
  CityCouncilInfo,
  Agreement,
  Disagreement,
  Candidacy,
  DataSource,
  Expense,
  Level,
  Mandate,
  MandateStatus,
  MissingDataset,
  OfficeSlug,
  Officeholder,
  Page,
  Party,
  PeriodStats,
  PlaceTopVoted,
  CampaignFinance,
  CampaignOrigin,
  Amendment,
  StaffMember,
  SalaryAccrued,
  YearStats,
  Person,
  PersonVote,
  Place,
  Proposal,
  RepresentativeGroup,
  Stamp,
  SourceStatus,
  CoverageMatrix,
  CoverageStatus,
  VoteValue,
  VotingEventDetail,
  VotingEventSummary,
  ActivityItem,
  CommitteeItem,
  ContactItem,
  LawItem,
  AgendaEvent,
  AgendaItem,
  AgendaView,
  LawListItem,
  SpeechItem,
  PautaEntry,
  PautaOverview,
  PautaProposal,
  PautaStatus,
  PocketRule,
  AnswerClaim,
  AnswerField,
  Correction,
  PublishedAnswers,
  VerifiedBy,
} from "./types";
import { ANSWER_FIELDS, CAMPAIGN_ORIGINS } from "./types";
import { label, parseProposalKey, proposalKey, termLabel, uniqueByKey } from "../pauta";
import { pgW4 } from "./pg-w4";
import { placarPorUf } from "./cadeiras";
import { lista } from "./lista";
import { FAMILIAS_CARIMBO, coberturaDe, type CarimboFonte } from "./cobertura";
import { claimsFrom, plainOf } from "../answer-claims";

// Implementação Postgres do contrato DataSource. Lê como `web_reader` (só select nas tabelas públicas; RLS).
// Nenhuma query fora daqui. Listas públicas ordenam por nome (collation pt_br), nunca por métrica: regra de neutralidade.

// um pool por processo, mesmo com hot reload em dev
const g = globalThis as unknown as { __pgPool?: ReturnType<typeof postgres> };
const sql = (g.__pgPool ??= postgres(process.env.DATABASE_URL ?? "", {
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false, // pooler do Supabase em modo transação não suporta prepared statements
  transform: { undefined: null },
}));

const PLURAL: Record<OfficeSlug, string> = {
  presidente: "Presidência",
  vice_presidente: "Vice-presidência",
  senador: "Senado",
  deputado_federal: "Deputados federais",
  governador: "Governo do estado",
  vice_governador: "Vice-governo",
  deputado_estadual: "Deputados estaduais",
  deputado_distrital: "Deputados distritais",
  prefeito: "Prefeitura",
  vice_prefeito: "Vice-prefeitura",
  vereador: "Vereadores",
};
const GROUPS: { key: string; offices: OfficeSlug[]; level: Level; title: (uf: string | null) => string }[] = [
  { key: "prefeitura", offices: ["prefeito", "vice_prefeito"], level: "municipal", title: () => PLURAL.prefeito },
  { key: "vereadores", offices: ["vereador"], level: "municipal", title: () => PLURAL.vereador },
  { key: "governo", offices: ["governador", "vice_governador"], level: "estadual", title: () => PLURAL.governador },
  { key: "assembleia", offices: ["deputado_estadual", "deputado_distrital"], level: "estadual", title: (uf) => (uf === "DF" ? PLURAL.deputado_distrital : PLURAL.deputado_estadual) },
  { key: "senado", offices: ["senador"], level: "federal", title: () => PLURAL.senador },
  { key: "camara", offices: ["deputado_federal"], level: "federal", title: () => PLURAL.deputado_federal },
  { key: "presidencia", offices: ["presidente", "vice_presidente"], level: "federal", title: () => PLURAL.presidente },
];
/** Cadeiras da Assembleia (CF art. 27: 3 × federais até 12; acima, 36 + excedente). DF: a Câmara Legislativa tem 24. */
function stateSeatsOf(uf: string): number | null {
  const row = UF_ROWS.find((r) => r[1] === uf);
  return row ? stateSeats(row[4]) : null;
}
const SEATS_WHY = "a fonte oficial traz quem está em exercício; suplentes que assumiram vagas ainda não estão todos carregados";
const GAP_STATUS: Record<string, string> = {
  renunciou: "renunciou",
  cassado: "foi cassado",
  falecido: "faleceu",
  afastado: "está afastado",
};
const OFFICE_LABEL: Record<string, string> = { governador: "Governo do estado", vice_governador: "Vice-governo" };
const dmy = (d: string) => d.split("-").reverse().join("/");
/** Governador e vice de uma UF sem mandato em exercício: o cargo aparece como “—”, com o motivo tirado do último mandato (BUG-024). */
async function executiveGaps(uf: string): Promise<{ office: OfficeSlug; what: string; why: string }[]> {
  const rows = await sql`
    select o.slug as office, m.status, m.started_on, m.ends_on, m.vacancy_note
    from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
    where pl.kind = 'uf' and pl.uf = ${uf} and o.slug in ('governador', 'vice_governador')
    order by m.started_on desc`;
  const out: { office: OfficeSlug; what: string; why: string }[] = [];
  for (const office of ["governador", "vice_governador"] as OfficeSlug[]) {
    const mine = rows.filter((r) => r.office === office);
    if (mine.some((r) => r.status === "em_exercicio")) continue;
    const last = mine.find((r) => r.status !== "eleito_aguardando_posse" && r.status !== "em_exercicio");
    const waiting = mine.find((r) => r.status === "eleito_aguardando_posse");
    const bits: string[] = [];
    if (last) bits.push(`o último ${office === "governador" ? "titular" : "vice"} ${GAP_STATUS[String(last.status)] ?? "deixou o cargo"}${last.ends_on ? ` em ${dmy(iso(last.ends_on))}` : ""}`);
    if (waiting) bits.push(`há eleito aguardando posse${waiting.started_on ? ` em ${dmy(iso(waiting.started_on))}` : ""}`);
    // D202: motivo conferido na fonte (interino de outro Poder, vaga), no lugar do genérico
    bits.push(last?.vacancy_note ? String(last.vacancy_note) : "a fonte (TSE) não publica quem exerce o cargo agora");
    out.push({ office, what: OFFICE_LABEL[office], why: bits.join("; ") });
  }
  return out;
}
const DATASET_LABEL: Record<string, string> = {
  salario: "Salário pago",
  salario_prefeito: "Salário do prefeito",
  salario_vereadores: "Salário dos vereadores",
  salario_deputados_estaduais: "Salário dos deputados estaduais",
  presenca: "Presença em sessões",
  votos: "Votos em plenário",
  propostas: "Propostas apresentadas",
  gastos_gabinete: "Gastos do gabinete",
  patrimonio: "Patrimônio",
  discursos: "Discursos",
  equipe: "Equipe do gabinete",
  emendas: "Emendas",
  comissoes: "Comissões",
  viagens: "Viagens",
  contato: "Contato",
};
const EXECUTIVE = new Set<OfficeSlug>(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
// o que cada cargo fora do federal tem de dado próprio (chaves de data_coverage)
const LEG = ["presenca", "votos", "propostas", "gastos_gabinete"];
const OWN_DATASETS: Partial<Record<OfficeSlug, string[]>> = {
  deputado_estadual: [...LEG, "salario_deputados_estaduais"],
  deputado_distrital: [...LEG, "salario_deputados_estaduais"],
  vereador: [...LEG, "salario_vereadores"],
  prefeito: ["salario_prefeito"],
  vice_prefeito: ["salario_prefeito"],
  governador: [],
  vice_governador: [],
};
/** Emendas (D38): tipo próprio, não viram lei sozinhas; na tela, rótulo "emenda". */
export const EMENDA_TYPES = ["EMC", "EMP", "EMR", "ESB"];
const toDataset = (d: string): MissingDataset["dataset"] =>
  (d.startsWith("salario") ? "salario" : (["presenca", "votos", "propostas", "gastos_gabinete", "patrimonio"].includes(d) ? d : "propostas")) as MissingDataset["dataset"];

type Row = Record<string, unknown>;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
const isoTs = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? ""));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function place(r: Row): Place {
  return {
    ibge: String(r.ibge_code),
    kind: r.kind as Place["kind"],
    name: String(r.name),
    slug: String(r.slug),
    uf: (r.uf as string | null) ?? null,
    region: (r.region as string | null) ?? null,
    population: r.population === undefined ? undefined : num(r.population),
  };
}
function person(r: Row): Person {
  return {
    id: String(r.id),
    slug: String(r.slug),
    displayName: String(r.display_name),
    civilName: String(r.civil_name ?? r.display_name),
    gender: (r.gender as "f" | "m") ?? "m",
    birthDate: r.birth_date ? iso(r.birth_date) : null,
    birthplaceIbge: (r.birthplace_ibge as string | null) ?? null,
    education: (r.education as string | null) ?? null,
  };
}
const AMENDMENT_SELECT = sql`
  select a.year, a.kind, a.kind_label, a.area, a.author_label, pp.slug as author_slug, pl.ibge_code, pl.name as place_name, pl.uf as place_uf,
         a.locality_label, a.place_note, a.committed_cents, a.liquidated_cents, a.paid_cents
  from amendments a left join places pl on pl.id = a.beneficiary_place_id left join people pp on pp.id = a.person_id`;
function amendmentRow(r: Row): Amendment {
  return {
    year: Number(r.year), kind: r.kind as Amendment["kind"], kindLabel: (r.kind_label as string | null) ?? null, area: (r.area as string | null) ?? null,
    authorLabel: String(r.author_label), authorSlug: (r.author_slug as string | null) ?? null,
    place: r.ibge_code ? { ibge: String(r.ibge_code), name: String(r.place_name), uf: (r.place_uf as string | null) ?? null } : null,
    localityLabel: (r.locality_label as string | null) ?? null, placeNote: (r.place_note as string | null) ?? null,
    committedCents: r.committed_cents == null ? null : Number(r.committed_cents), liquidatedCents: r.liquidated_cents == null ? null : Number(r.liquidated_cents), paidCents: r.paid_cents == null ? null : Number(r.paid_cents),
  };
}

function candidacyRow(r: Row) {
  return {
    year: Number(r.year),
    office: r.office as OfficeSlug,
    placeIbge: String(r.place_ibge),
    partyId: String(r.party_id ?? ""),
    result: (r.result as Candidacy["result"]) ?? null,
    votes: num(r.votes),
    raisedCents: num(r.raised_cents),
    spentCents: num(r.spent_cents),
    assetsCents: num(r.assets),
    party: party(r),
    officeName: officeName(r),
    placeLabel: placeLabel(r),
  };
}
const lawRow = (r: Row): LawItem => ({ number: String(r.number), sanctionedOn: iso(r.sanctioned_on), summary: String(r.summary), url: (r.url as string | null) ?? null, proposal: String(r.proposal), role: r.role === "principal" ? "autor" : "coautor" });
function gridFrom(year: number, sessions: AttendanceGrid["sessions"]): AttendanceGrid {
  const n = (st: AttendanceState) => sessions.filter((x) => x.state === st).length;
  const present = n("presente"), absent = n("ausente"), justified = n("ausencia_justificada");
  return { year, sessions, present, absent, justified, outside: n("fora_do_exercicio"), total: present + absent + justified };
}
function personVoteRow(r: Row): PersonVote {
  return {
    event: {
      id: String(r.id),
      body: r.body === "senado" ? "senado" : "camara",
      kind: r.kind as VoteKind,
      occurredAt: isoTs(r.occurred_at),
      description: String(r.description),
      topic: (r.topic as string | null) ?? null,
      result: (r.result as "aprovado" | "rejeitado" | null) ?? null,
      yes: Number(r.yes_count ?? 0),
      no: Number(r.no_count ?? 0),
    },
    value: r.value as VoteValue,
    partyId: String(r.party_id ?? ""),
  };
}

function officeName(r: Row) {
  return String(r.gender === "f" ? r.name_f : r.name_m);
}
function placeLabel(r: Row) {
  return r.place_kind === "municipio" ? `${r.place_name} · ${r.place_uf}` : String(r.place_name);
}
function party(r: Row, prefix = "party_"): Party {
  return { id: String(r[`${prefix}id`] ?? ""), acronym: String(r[`${prefix}acronym`] ?? "—"), name: String(r[`${prefix}name`] ?? "sem partido") };
}
function holder(r: Row): Officeholder {
  return { person: person(r), mandate: mandate(r), party: party(r), officeName: officeName(r), placeLabel: placeLabel(r) };
}
function mandate(r: Row): Mandate {
  return {
    id: String(r.mandate_id),
    personId: String(r.id),
    office: r.office as OfficeSlug,
    placeIbge: String(r.place_ibge),
    partyId: String(r.party_id ?? ""),
    status: r.status as Mandate["status"],
    startedOn: iso(r.started_on),
    endsOn: iso(r.ends_on),
    statusSource: String(r.status_source),
    electedBy: (r.elected_by as string | null) ?? null,
  };
}

// partido mostrado = filiação atual (person_current_party) ou, na falta, o partido na posse
const HOLDER_SELECT = sql`
  select p.id, p.slug, p.display_name, p.civil_name, p.gender, p.birth_date, p.education, b.ibge_code as birthplace_ibge,
         m.id as mandate_id, o.slug as office, o.name_m, o.name_f, o.level, m.status, m.started_on, m.ends_on, m.status_source, m.elected_by,
         pl.ibge_code as place_ibge, pl.name as place_name, pl.kind as place_kind, pl.uf as place_uf,
         coalesce(cp.party_id, m.party_id) as party_id, pa.acronym as party_acronym, pa.name as party_name
  from mandates m
  join people p on p.id = m.person_id
  join offices o on o.id = m.office_id
  join places pl on pl.id = m.place_id
  left join places b on b.id = p.birthplace_place_id
  left join person_current_party cp on cp.person_id = p.id
  left join parties pa on pa.id = coalesce(cp.party_id, m.party_id)`;

function page<T>(items: T[], total: number, offset: number, limit: number): Page<T> {
  return { items, nextCursor: offset + limit < total ? String(offset + limit) : null, total };
}
const off = (cursor?: string) => Math.max(0, Number(cursor) || 0);
/** Página de uma proposta: até 5 votações e 20 autores, sempre com o total (Lista). */
const MAX_VOTACOES = 5;
const MAX_AUTORES = 20;
/** ids de pessoa válidos, sem repetição (lotes): o que não é uuid nem chega ao banco. */
const uuids = (ids: string[]) => [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)))].slice(0, 200);
/** Agrupa linhas por pessoa, garantindo uma entrada (vazia) para cada id pedido. */
function porPessoa<T>(ids: string[], rows: Row[], f: (r: Row) => T): Record<string, T[]> {
  const out: Record<string, T[]> = Object.fromEntries(ids.map((id) => [id, [] as T[]]));
  for (const r of rows) out[String(r.person_id)]?.push(f(r));
  return out;
}
/** U11: voting_events.kind que é procedimento, não texto de lei. Lista de bloqueio: kind novo ou "outro" continua aparecendo. */
const PROCEDURAL_KINDS = ["requerimento", "urgencia"];

function summary(r: Row, body: "camara" | "senado"): VotingEventSummary {
  return {
    id: String(r.id),
    body,
    occurredAt: isoTs(r.occurred_at),
    description: String(r.description),
    ...(r.kind ? { kind: r.kind as VoteKind } : {}),
    topic: (r.topic as string | null) ?? null,
    result: (r.result as "aprovado" | "rejeitado" | null) ?? null,
    yes: Number(r.yes_count ?? 0),
    no: Number(r.no_count ?? 0),
    isNominal: Boolean(r.is_nominal),
    // D55 trocada pela D123: secreta é o que a fonte marca; null (Câmara não informa) não vira rótulo nenhum
    isSecret: r.is_secret === true,
    openNoVotes: r.is_secret === false && r.has_votes === false,
    proposal: r.type ? { label: `${r.type} ${r.number}/${r.year}`, summary: String(r.summary_official ?? ""), url: (r.url as string | null) ?? null } : null,
  };
}

export const pgSource: DataSource = {
  isDemo: false,
  ...pgW4,

  async searchPlaces(q, limit = 10) {
    const f = q.trim();
    if (f.length < 2) return [];
    // ordem: nome exato, depois prefixo, estado antes de cidade, cidade maior (cadeiras na câmara) antes da menor, A–Z.
    // Sem isso "campi" põe Campinas (SP) em 9º, atrás de cidades pequenas, fora da área visível da lista no celular.
    const rows = await sql`
      select p.ibge_code, p.kind, p.name, p.slug, p.uf, r.ibge_code as region
      from places p
      left join places r on r.id = (case when p.kind = 'municipio' then (select parent_id from places u where u.id = p.parent_id) else p.parent_id end)
      left join lateral (
        select count(*)::int as n from mandates m join offices o on o.id = m.office_id
        where m.place_id = p.id and o.slug = 'vereador' and m.status = 'em_exercicio') sz on true
      where p.kind in ('municipio','uf') and (f_unaccent(lower(p.name)) like f_unaccent(lower(${f})) || '%' or f_unaccent(lower(p.name)) like '% ' || f_unaccent(lower(${f})) || '%' or lower(p.uf) = lower(${f}))
      order by (f_unaccent(lower(p.name)) = f_unaccent(lower(${f}))) desc,
               (f_unaccent(lower(p.name)) like f_unaccent(lower(${f})) || '%') desc,
               p.kind desc, coalesce(sz.n, 0) desc, p.name collate pt_br, p.uf
      limit ${Math.min(limit, 20)}`;
    return rows.map(place);
  },
  async getPlace(ibge) {
    const [r] = await sql`select ibge_code, kind, name, slug, uf, null as region, population from places where ibge_code = ${ibge}`;
    return r ? place(r) : null;
  },
  async getPlaceByUf(uf) {
    const [r] = await sql`select ibge_code, kind, name, slug, uf, null as region from places where kind = 'uf' and uf = ${uf.toUpperCase()}`;
    return r ? place(r) : null;
  },
  async listUfs() {
    return (await sql`select ibge_code, kind, name, slug, uf, null as region from places where kind = 'uf' order by name collate pt_br`).map(place);
  },
  async listMunicipalities(uf) {
    return (
      await sql`select ibge_code, kind, name, slug, uf, null as region from places where kind = 'municipio' ${uf ? sql`and uf = ${uf}` : sql``} order by name collate pt_br, uf`
    ).map(place);
  },

  async getRepresentatives(pl) {
    const rows = await sql`${HOLDER_SELECT}
      where m.status = 'em_exercicio' and (
        pl.ibge_code = 'BR'
        or (pl.kind = 'uf' and pl.uf = ${pl.uf})
        ${pl.kind === "municipio" ? sql`or pl.ibge_code = ${pl.ibge}` : sql``})
      order by p.display_name collate pt_br`;
    const groups: RepresentativeGroup[] = [];
    const missingExec = pl.uf ? await executiveGaps(pl.uf) : [];
    for (const g of GROUPS) {
      if (g.level === "municipal" && pl.kind !== "municipio") continue;
      const people = rows
        .filter((r) => g.offices.includes(r.office as OfficeSlug) && (g.level === "federal" && g.key === "presidencia" ? r.place_ibge === "BR" : g.level === "municipal" ? r.place_ibge === pl.ibge : r.place_kind === "uf"))
        .sort((a, b) => g.offices.indexOf(a.office as OfficeSlug) - g.offices.indexOf(b.office as OfficeSlug))
        .map(holder);
      const gaps = g.key === "governo" ? missingExec.filter((x) => g.offices.includes(x.office)).map(({ what, why }) => ({ what, why })) : undefined;
      const total = g.key === "assembleia" && pl.uf ? stateSeatsOf(pl.uf) : null;
      const seats = total != null && people.length < total ? { loaded: people.length, total, why: SEATS_WHY } : undefined;
      if (people.length || gaps?.length || seats) {
        groups.push({ key: g.key, title: g.title(pl.uf), level: g.level, where: people[0]?.placeLabel ?? pl.uf ?? "", people, ...(gaps?.length ? { gaps } : {}), ...(seats ? { seats } : {}) });
      }
    }
    return groups;
  },
  async getCoverage(pl) {
    const rows = await sql`select dataset, status, reason, evidence_url, checked_on from data_coverage dc join places p on p.id = dc.place_id where p.ibge_code = ${pl.ibge} and dc.status <> 'no_site' order by dataset`;
    return rows.map((r) => ({
      dataset: toDataset(String(r.dataset)),
      label: DATASET_LABEL[String(r.dataset)] ?? String(r.dataset),
      status: r.status as MissingDataset["status"],
      reason: String(r.reason),
      evidenceUrl: (r.evidence_url as string | null) ?? null,
      checkedOn: r.checked_on ? iso(r.checked_on) : null,
    }));
  },
  async getCouncilSite(ibge) {
    const [h] = await sql`
      select h.status, h.base_url, h.note
      from sapl_houses h join places p on p.id = h.place_id
      where p.ibge_code = ${ibge}`;
    if (!h) return null;
    return { url: h.status === "ok" && h.base_url ? String(h.base_url) : null, note: h.status === "ok" ? null : ((h.note as string | null) ?? null) };
  },
  async getAssembly(uf) {
    const [b] = await sql`
      select b.adapter, b.place_id, coalesce(s.slug, case when b.adapter = 'sapl' then 'sapl-ale' end) as slug,
             coalesce(s.name, case when b.adapter = 'sapl' then 'SAPL da Assembleia Legislativa' end) as source_name,
             coalesce(s.url, b.open_data_url) as source_url, h.loaded_at as sapl_loaded_at
      from legislative_bodies b join places p on p.id = b.place_id
      left join sources s on b.adapter = 'ale_custom' and s.url = b.open_data_url
      left join sapl_houses h on b.adapter = 'sapl' and h.place_id = b.place_id and h.status = 'ok'
      where p.kind = 'uf' and p.uf = ${uf.toUpperCase()} and b.kind in ('assembleia', 'camara_legislativa_df') limit 1`;
    if (!b) return null;
    const viaSapl = b.adapter === "sapl" && !!b.sapl_loaded_at; // D09: Assembleia lida pelo SAPL (sapl_*); um carimbo só, o da carga da casa
    const read = (b.adapter === "ale_custom" && !!b.slug) || viaSapl;
    const cov = await sql`select dataset, status, reason, evidence_url, checked_on from data_coverage where place_id = ${b.place_id as string}::uuid and dataset in ('presenca', 'votos', 'propostas', 'gastos_gabinete')`;
    const STAMP: Partial<Record<AssemblyDataset, string>> = { propostas: "proposicoes", gastos_gabinete: "despesas", presenca: "presenca", votos: "votacoes" };
    const stamps = read && !viaSapl
      ? await sql`select split_part(dataset, '.', 2) as kind, max(refreshed_at) as at from dataset_stamps where dataset like ${String(b.slug) + ".%"} group by 1`
      : [];
    const at = new Map(stamps.map((r) => [String(r.kind), isoTs(r.at)]));
    const byDs = new Map(cov.map((c) => [String(c.dataset), c]));
    const order: AssemblyDataset[] = ["presenca", "votos", "propostas", "gastos_gabinete"];
    const LABEL: Record<AssemblyDataset, string> = { presenca: "Presença no plenário", votos: "Votos no plenário", propostas: "Propostas apresentadas", gastos_gabinete: "Verba de gabinete" };
    const u = uf.toUpperCase();
    return {
      uf: u,
      houseName: houseName(u),
      read,
      source: read ? { name: String(b.source_name), url: String(b.source_url) } : null,
      items: order.map((d) => {
        const c = byDs.get(d);
        const kind = STAMP[d]!;
        const refreshedAt = viaSapl ? isoTs(b.sapl_loaded_at) : read ? (at.get(kind) ?? null) : null;
        // só conta como lido o que tem carimbo; sem carga, "no_site" não vale (o motivo explica)
        const status = (c?.status as AssemblyInfo["items"][number]["status"]) ?? "desconhecido";
        return {
          dataset: d,
          label: LABEL[d],
          status: status === "no_site" && !refreshedAt ? "carregando" : status,
          reason: c ? String(c.reason) : notReadReason(u),
          evidenceUrl: (c?.evidence_url as string | null) ?? null,
          checkedOn: c?.checked_on ? iso(c.checked_on) : null,
          refreshedAt,
          stampDataset: read && refreshedAt ? `${String(b.slug)}.${kind}` : null,
        };
      }),
    } satisfies AssemblyInfo;
  },
  async getCityCouncil(personId) {
    const [sp] = await sql`
      select sp.house_id, sp.sapl_id, h.base_url, h.legislature_number, h.legislature_start, h.legislature_end, h.loaded_at, pl.name as city, pl.uf, pl.kind as place_kind
      from sapl_parlamentares sp join sapl_houses h on h.id = sp.house_id join places pl on pl.id = h.place_id
      where sp.person_id = ${personId}::uuid and sp.match_status = 'casado' and h.status = 'ok' and h.loaded_at is not null
      order by h.loaded_at desc limit 1`;
    if (!sp) return null;
    const house = Number(sp.house_id), pid = Number(sp.sapl_id);
    const [m] = await sql`select count(*)::int as n, count(*) filter (where a.primeiro_autor)::int as p from sapl_autorias a join sapl_materias mt on mt.house_id = a.house_id and mt.sapl_id = a.materia_sapl_id where a.house_id = ${house} and a.parlamentar_sapl_id = ${pid}`;
    const items = await sql`
      select mt.type_sigla, mt.number, mt.year, mt.presented_on, mt.summary, mt.url, coalesce(a.primeiro_autor, false) as principal
      from sapl_autorias a join sapl_materias mt on mt.house_id = a.house_id and mt.sapl_id = a.materia_sapl_id
      where a.house_id = ${house} and a.parlamentar_sapl_id = ${pid}
      order by mt.presented_on desc nulls last, mt.year desc, mt.number desc limit 10`;
    const [pr] = await sql`select count(distinct p.sessao_sapl_id)::int as n, min(s.starts_on) as a, max(s.starts_on) as b from sapl_presencas p join sapl_sessoes s on s.house_id = p.house_id and s.sapl_id = p.sessao_sapl_id where p.house_id = ${house} and p.parlamentar_sapl_id = ${pid}`;
    const [hv] = await sql`select exists (select 1 from sapl_votos where house_id = ${house}) as any`;
    let votes: CityCouncilInfo["votes"] = null;
    if (hv?.any) {
      const by = await sql`select voto, count(*)::int as n from sapl_votos where house_id = ${house} and parlamentar_sapl_id = ${pid} group by 1 order by 1`;
      const last = await sql`select voted_at, voto, description from sapl_votos where house_id = ${house} and parlamentar_sapl_id = ${pid} order by voted_at desc nulls last, sapl_id desc limit 10`;
      votes = {
        total: by.reduce((a, r) => a + Number(r.n), 0),
        byValue: by.map((r) => ({ label: String(r.voto), n: Number(r.n) })),
        items: last.map((r) => ({ votedAt: r.voted_at ? isoTs(r.voted_at) : null, value: String(r.voto), description: (r.description as string | null) ?? null })),
      };
    }
    return {
      house: sp.place_kind === "uf" ? "assembleia" : "camara_municipal",
      city: String(sp.city),
      uf: String(sp.uf),
      baseUrl: String(sp.base_url),
      legislature: num(sp.legislature_number),
      legislatureStart: sp.legislature_start ? iso(sp.legislature_start) : null,
      legislatureEnd: sp.legislature_end ? iso(sp.legislature_end) : null,
      loadedAt: isoTs(sp.loaded_at),
      materias: {
        total: Number(m?.n ?? 0),
        principal: Number(m?.p ?? 0),
        items: items.map((r) => ({ type: String(r.type_sigla), number: Number(r.number), year: Number(r.year), presentedOn: r.presented_on ? iso(r.presented_on) : null, summary: String(r.summary), url: String(r.url), principal: Boolean(r.principal) })),
      },
      presence: { sessions: Number(pr?.n ?? 0), first: pr?.a ? iso(pr.a) : null, last: pr?.b ? iso(pr.b) : null },
      votes,
    } satisfies CityCouncilInfo;
  },
  async getTopVotedInPlace(ibge, limit = 5) {
    const [pl] = await sql`select id, uf from places where ibge_code = ${ibge} and kind = 'municipio'`;
    if (!pl) return null;
    // última eleição geral com voto por município carregado para esta cidade (1º turno: é onde deputado se elege)
    const [y] = await sql`
      select max(e.year)::int as year from candidacy_place_votes cpv
      join candidacies c on c.id = cpv.candidacy_id join elections e on e.id = c.election_id
      where cpv.place_id = ${pl.id as string}::uuid and e.kind = 'geral' and e.round = 1`;
    if (!y?.year) return null;
    const offices: OfficeSlug[] = ["deputado_federal", pl.uf === "DF" ? "deputado_distrital" : "deputado_estadual"];
    const out: PlaceTopVoted = { year: Number(y.year), groups: [] };
    for (const office of offices) {
      // ordem por votos é o próprio dado pedido (resultado da urna), com desempate A–Z; a tela diz que é "entre quem tem crachá" (D35)
      const rows = await sql`
        select p.slug, p.display_name, p.gender, coalesce(pa.acronym, '—') as party, cpv.votes, c.result
        from candidacy_place_votes cpv
        join candidacies c on c.id = cpv.candidacy_id
        join elections e on e.id = c.election_id and e.kind = 'geral' and e.round = 1 and e.year = ${out.year}
        join contests ct on ct.id = c.contest_id join offices o on o.id = ct.office_id and o.slug = ${office}
        join people p on p.id = c.person_id
        left join parties pa on pa.id = c.party_id
        where cpv.place_id = ${pl.id as string}::uuid
        order by cpv.votes desc, p.display_name collate pt_br limit ${Math.min(limit, 20)}`;
      if (rows.length)
        out.groups.push({
          office,
          label: PLURAL[office],
          items: rows.map((r) => ({ slug: String(r.slug), name: String(r.display_name), gender: r.gender === "f" ? "f" : "m", party: String(r.party), votes: Number(r.votes), result: (r.result as Candidacy["result"] | null) ?? null })),
        });
    }
    return out.groups.length ? out : null;
  },
  async getCounters() {
    const rows = await sql`select o.slug, o.level, count(*)::int as n from mandates m join offices o on o.id = m.office_id where m.status = 'em_exercicio' group by 1, 2 order by min(o.slug)`;
    const byLevel: Record<Level, number> = { federal: 0, estadual: 0, municipal: 0 };
    const order = Object.keys(PLURAL) as OfficeSlug[];
    const byOffice: { office: OfficeSlug; label: string; count: number; expected?: number; why?: string }[] = rows
      .map((r) => ({ office: r.slug as OfficeSlug, label: PLURAL[r.slug as OfficeSlug], count: Number(r.n) }))
      .sort((a, b) => order.indexOf(a.office) - order.indexOf(b.office));
    for (const r of rows) byLevel[r.level as Level] += Number(r.n);
    // “—” com motivo: cargo com menos gente em exercício do que lugares (BUG-024, BUG-025). Nunca omitir a diferença.
    const lack = await sql`
      select o.slug as office, array_agg(distinct pl.uf order by pl.uf) filter (where pl.uf is not null) as ufs
      from offices o cross join places pl
      where pl.kind = 'uf' and o.slug in ('governador', 'vice_governador')
        and not exists (select 1 from mandates m where m.office_id = o.id and m.place_id = pl.id and m.status = 'em_exercicio')
      group by 1`;
    const seatsExpected = {
      deputado_estadual: UF_ROWS.filter((r) => r[1] !== "DF").reduce((s, r) => s + stateSeats(r[4]), 0),
      deputado_distrital: stateSeats(UF_ROWS.find((r) => r[1] === "DF")![4]),
    };
    for (const b of byOffice) {
      const missing = lack.find((l) => l.office === b.office);
      if (missing && (missing.ufs as string[]).length) {
        const ufs = missing.ufs as string[];
        b.expected = 27;
        b.why = `${ufs.join(", ")} sem ${b.office === "governador" ? "governador" : "vice-governador"} em exercício na fonte`;
      } else if (b.office === "deputado_estadual" || b.office === "deputado_distrital") {
        const exp = seatsExpected[b.office];
        if (b.count < exp) {
          b.expected = exp;
          b.why = `${exp - b.count} cadeiras sem titular ou suplente em exercício carregado; ${SEATS_WHY}`;
        }
      }
    }
    return { total: byLevel.federal + byLevel.estadual + byLevel.municipal, byLevel, byOffice };
  },
  async listParties() {
    return (await sql`select distinct pa.id, pa.acronym, pa.name from parties pa join mandates m on m.party_id = pa.id and m.status = 'em_exercicio' order by pa.acronym`).map((r) => party(r, ""));
  },
  async listOffices() {
    const order = Object.keys(PLURAL) as OfficeSlug[];
    return (await sql`select slug, name_m, name_f, level from offices`)
      .map((r) => ({ slug: r.slug as OfficeSlug, nameM: String(r.name_m), nameF: String(r.name_f), level: r.level as Level, order: order.indexOf(r.slug as OfficeSlug) }))
      .sort((a, b) => a.order - b.order);
  },

  async listPeople(f) {
    const limit = Math.min(f.limit ?? 60, 200);
    const offset = off(f.cursor);
    const q = f.q?.trim();
    const where = sql`
      m.status = 'em_exercicio'
      ${f.office ? sql`and o.slug = ${f.office}` : sql``}
      ${f.uf ? sql`and pl.uf = ${f.uf.toUpperCase()}` : sql``}
      ${f.party ? sql`and coalesce(cp.party_id, m.party_id) = ${f.party}::uuid` : sql``}
      ${f.letter ? sql`and f_unaccent(lower(p.display_name)) like ${f.letter.toLowerCase()} || '%'` : sql``}
      ${q ? sql`and (f_unaccent(lower(p.display_name)) like '%' || f_unaccent(lower(${q})) || '%' or f_unaccent(lower(p.civil_name)) like '%' || f_unaccent(lower(${q})) || '%')` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from mandates m join people p on p.id = m.person_id join offices o on o.id = m.office_id join places pl on pl.id = m.place_id left join person_current_party cp on cp.person_id = p.id where ${where}`;
    const rows = await sql`${HOLDER_SELECT} where ${where} order by p.display_name collate pt_br, p.id limit ${limit} offset ${offset}`;
    return page(rows.map(holder), Number(n), offset, limit);
  },
  async searchPeople(q, limit = 8) {
    const f = q.trim();
    if (f.length < 2) return [];
    const rows = await sql`${HOLDER_SELECT}
      where m.status = 'em_exercicio' and (f_unaccent(lower(p.display_name)) like f_unaccent(lower(${f})) || '%' or f_unaccent(lower(p.display_name)) like '% ' || f_unaccent(lower(${f})) || '%')
      order by p.display_name collate pt_br limit ${Math.min(limit, 20)}`;
    return rows.map(holder);
  },
  async getPerson(slug) {
    const [r] = await sql`select p.id, p.slug, p.display_name, p.civil_name, p.gender, p.birth_date, p.education, b.ibge_code as birthplace_ibge
      from people p left join places b on b.id = p.birthplace_place_id where p.slug = ${slug}`;
    if (r) return { person: person(r) };
    const [red] = await sql`select p.id, p.slug, p.display_name, p.civil_name, p.gender, p.birth_date, p.education, b.ibge_code as birthplace_ibge
      from person_slug_redirects s join people p on p.id = s.person_id left join places b on b.id = p.birthplace_place_id where s.old_slug = ${slug}`;
    return red ? { person: person(red), redirectTo: String(red.slug) } : null;
  },
  async getMandates(personId) {
    const rows = await sql`${HOLDER_SELECT} where p.id = ${personId}::uuid
      order by case m.status when 'em_exercicio' then 0 when 'eleito_aguardando_posse' then 1 when 'licenciado' then 2 when 'afastado' then 2 else 3 end, m.started_on desc`;
    return rows.map((r) => ({ ...mandate(r), party: party(r), officeName: officeName(r), placeLabel: placeLabel(r) }));
  },
  // D220: fonte do partido vigente. Lê party_memberships via person_current_party (web_reader não lê party_observations).
  // Quem está em exercício na Câmara/Senado tem o partido da casa (D182); senão, candidatura do TSE na mesma data; senão, sem fonte.
  async getPartyProvenance(personId) {
    const [r] = await sql`
      select cp.from_on,
        (select case b.kind when 'camara_deputados' then 'camara' else 'senado' end
           from mandates m join legislative_bodies b on b.id = m.body_id
          where m.person_id = cp.person_id and m.status = 'em_exercicio' and b.kind in ('camara_deputados', 'senado')
          order by m.started_on desc limit 1) as house,
        (select e.year from candidacies c join elections e on e.id = c.election_id
          where c.person_id = cp.person_id and c.party_id = cp.party_id and e.held_on = cp.from_on
          order by e.year desc limit 1) as tse_year
      from person_current_party cp where cp.person_id = ${personId}::uuid`;
    if (!r) return { kind: "none", reason: "sem filiação registrada nas fontes" };
    const since = iso(r.from_on);
    if (!since) return { kind: "none", reason: "sem data de filiação" };
    if (r.house === "camara" || r.house === "senado") return { kind: r.house, since };
    if (r.tse_year != null) return { kind: "tse", since, electionYear: Number(r.tse_year) };
    return { kind: "none", reason: "fonte da filiação não identificada" };
  },
  async getCandidacies(personId) {
    const rows = await sql`
      select e.year, o.slug as office, p.gender, o.name_m, o.name_f, pl.ibge_code as place_ibge, pl.name as place_name, pl.kind as place_kind, pl.uf as place_uf,
             c.party_id, pa.acronym as party_acronym, pa.name as party_name, c.result, c.votes, c.raised_cents, c.spent_cents, ad.total_cents as assets
      from candidacies c
      join people p on p.id = c.person_id
      join contests ct on ct.id = c.contest_id
      join elections e on e.id = c.election_id
      join offices o on o.id = ct.office_id
      join places pl on pl.id = ct.place_id
      left join parties pa on pa.id = c.party_id
      left join asset_declarations ad on ad.candidacy_id = c.id
      where c.person_id = ${personId}::uuid
      order by e.year desc, e.round desc`;
    return rows.map(candidacyRow);
  },
  async getStats(personId, period) {
    return (await statsForPeople([personId], period))[personId];
  },
  async getStatsForPeople(personIds, period) {
    return statsForPeople(personIds, period);
  },

  // ---------- lotes (Escolhidos): uma consulta por conjunto, qualquer que seja o número de pessoas ----------
  async getPeopleBySlugs(slugs) {
    const pedidos = [...new Set(slugs.filter((s) => /^[a-z0-9-]{1,120}$/.test(s)))].slice(0, 200);
    if (!pedidos.length) return { encontradas: [], naoEncontradas: [] };
    const rows = await sql`
      select q.slug as asked, p.id, p.slug, p.display_name, p.civil_name, p.gender, p.birth_date, p.education, b.ibge_code as birthplace_ibge
      from unnest(${pedidos}::text[]) q(slug)
      join lateral (
        select p.* from people p where p.slug = q.slug
        union all
        select p.* from person_slug_redirects s join people p on p.id = s.person_id where s.old_slug = q.slug and not exists (select 1 from people x where x.slug = q.slug)
        limit 1) p on true
      left join places b on b.id = p.birthplace_place_id`;
    const by = new Map(rows.map((r) => [String(r.asked), person(r)]));
    return {
      encontradas: pedidos.flatMap((s) => (by.has(s) ? [{ slug: s, person: by.get(s)! }] : [])),
      naoEncontradas: pedidos.filter((s) => !by.has(s)),
    };
  },
  async getMandatesForPeople(personIds) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const rows = await sql`${HOLDER_SELECT} where p.id = any(${ids}::uuid[])
      order by p.id, case m.status when 'em_exercicio' then 0 when 'eleito_aguardando_posse' then 1 when 'licenciado' then 2 when 'afastado' then 2 else 3 end, m.started_on desc`;
    return porPessoa(ids, rows.map((r) => ({ ...r, person_id: r.id })), (r) => ({ ...mandate(r), party: party(r), officeName: officeName(r), placeLabel: placeLabel(r) }));
  },
  async getCandidaciesForPeople(personIds) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const rows = await sql`
      select c.person_id, e.year, o.slug as office, p.gender, o.name_m, o.name_f, pl.ibge_code as place_ibge, pl.name as place_name, pl.kind as place_kind, pl.uf as place_uf,
             c.party_id, pa.acronym as party_acronym, pa.name as party_name, c.result, c.votes, c.raised_cents, c.spent_cents, ad.total_cents as assets
      from candidacies c
      join people p on p.id = c.person_id
      join contests ct on ct.id = c.contest_id
      join elections e on e.id = c.election_id
      join offices o on o.id = ct.office_id
      join places pl on pl.id = ct.place_id
      left join parties pa on pa.id = c.party_id
      left join asset_declarations ad on ad.candidacy_id = c.id
      where c.person_id = any(${ids}::uuid[])
      order by c.person_id, e.year desc, e.round desc`;
    return porPessoa(ids, rows, candidacyRow);
  },
  async getLawsForPeople(personIds) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const rows = await sql`
      select pa.person_id, l.number, l.sanctioned_on, l.summary, l.url, pr.type || ' ' || pr.number || '/' || pr.year as proposal, pa.role
      from proposal_authors pa join proposals pr on pr.id = pa.proposal_id join laws l on l.id = pr.became_law_id
      where pa.person_id = any(${ids}::uuid[]) and pa.role in ('principal','coautoria')
      order by pa.person_id, l.sanctioned_on desc`;
    return porPessoa(ids, rows, lawRow);
  },
  async getAttendanceGridForPeople(personIds, year) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const rows = await sql`
      select a.person_id, (s.starts_at at time zone 'America/Sao_Paulo')::date as d, a.status
      from attendance a join sessions s on s.id = a.session_id
      where a.person_id = any(${ids}::uuid[]) and s.is_deliberative
        and s.starts_at >= make_timestamptz(${year}, 1, 1, 0, 0, 0, 'America/Sao_Paulo') and s.starts_at < make_timestamptz(${year + 1}, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
      order by a.person_id, s.starts_at, s.id`;
    const sessoes = porPessoa(ids, rows, (r) => ({ date: iso(r.d), state: String(r.status) as AttendanceState }));
    return Object.fromEntries(ids.map((id) => [id, gridFrom(year, sessoes[id])]));
  },
  async getRecentLawVotesForPeople(personIds, limit) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const n = Math.max(1, Math.min(limit, 20));
    // mesmo recorte de listVotes(scope "lei"): nominal, sem requerimento e urgência; total e página por pessoa numa consulta
    const rows = await sql`
      with base as (
        select v.person_id, v.value, v.party_id, e.id, e.kind, e.occurred_at, e.result, e.yes_count, e.no_count, e.description, e.proposal_id, e.body_id,
               row_number() over (partition by v.person_id order by e.occurred_at desc, e.id) as rn,
               count(*) over (partition by v.person_id) as total
        from votes v join voting_events e on e.id = v.voting_event_id
        where v.person_id = any(${ids}::uuid[]) and e.is_nominal and e.kind <> all(${PROCEDURAL_KINDS}::text[])
      )
      select x.person_id, x.total, x.id, x.kind, b.kind as body, x.occurred_at, x.result, x.yes_count, x.no_count, x.value, x.party_id,
             case when pr.id is not null then pr.type || ' ' || pr.number || '/' || pr.year || ' — ' || left(pr.summary_official, 220) || ' · ' || x.description else x.description end as description,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = x.proposal_id order by t.slug limit 1) as topic
      from base x join legislative_bodies b on b.id = x.body_id left join proposals pr on pr.id = x.proposal_id
      where x.rn <= ${n}
      order by x.person_id, x.rn`;
    const itens = porPessoa(ids, rows, personVoteRow);
    const total = new Map(rows.map((r) => [String(r.person_id), Number(r.total)]));
    return Object.fromEntries(ids.map((id) => [id, { items: itens[id], total: total.get(id) ?? 0 }]));
  },
  async getExpensesByCategoryForPeople(personIds, year) {
    const ids = uuids(personIds);
    if (!ids.length) return {};
    const rows = await sql`
      select person_id, category as label, sum(amount_cents)::bigint as cents from expenses
      where person_id = any(${ids}::uuid[]) and occurred_on >= make_date(${year}, 1, 1) and occurred_on < make_date(${year + 1}, 1, 1)
      group by 1, 2 order by 1, 3 desc`;
    return porPessoa(ids, rows, (r) => ({ label: String(r.label), cents: Number(r.cents) }));
  },
  async getPlaces(ibges) {
    const cod = [...new Set(ibges.filter((c) => /^[0-9A-Z]{1,7}$/.test(c)))].slice(0, 200);
    if (!cod.length) return [];
    return (await sql`select ibge_code, kind, name, slug, uf, null as region, population from places where ibge_code = any(${cod}::text[]) order by ibge_code`).map(place);
  },

  // ---------- cobertura por pessoa (regra em cobertura.ts) ----------
  async getPeopleCoverage(personIds) {
    const ids = uuids(personIds);
    if (!ids.length) return [];
    const [mands, faltas, carimbos, sapl, emendasCasadas, comCandidatura] = await Promise.all([
      // mandato principal: a mesma ordem de getMandates + mandatoPrincipal (em exercício, aguardando posse, o resto)
      sql`
        select distinct on (m.person_id) m.person_id, o.slug as office, m.status, m.place_id, pl.kind as place_kind, pl.uf, pl.name as place_name
        from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
        where m.person_id = any(${ids}::uuid[])
        order by m.person_id, case m.status when 'em_exercicio' then 0 when 'eleito_aguardando_posse' then 1 when 'licenciado' then 2 when 'afastado' then 2 else 3 end, m.started_on desc`,
      sql`select person_id, missing_datasets from person_period_stats where person_id = any(${ids}::uuid[]) and period = 'career'`,
      // carimbo mais novo de cada família: dataset igual ao prefixo ou começando por "prefixo." (nunca o fallback por fonte de getStamp)
      sql`
        select f.prefix, max(ds.refreshed_at) as at,
               (array_agg(s.name order by ds.refreshed_at desc))[1] as name, (array_agg(s.url order by ds.refreshed_at desc))[1] as url
        from unnest(${FAMILIAS_CARIMBO}::text[]) f(prefix)
        join dataset_stamps ds on ds.dataset = f.prefix or ds.dataset like f.prefix || '.%'
        join sources s on s.id = ds.source_id
        group by f.prefix`,
      sql`
        select distinct on (sp.person_id) sp.person_id, h.loaded_at, h.base_url, src.name as source_name
        from sapl_parlamentares sp join sapl_houses h on h.id = sp.house_id
        left join sources src on src.slug = 'sapl'
        where sp.person_id = any(${ids}::uuid[]) and sp.match_status = 'casado' and h.status = 'ok' and h.loaded_at is not null
        order by sp.person_id, h.loaded_at desc`,
      // emendas casadas POR PESSOA: uma emenda casada no banco não diz nada de quem não casou; sem linha ligada a ela,
      // a carga existe, mas lista vazia não quer dizer "não há"
      sql`select distinct person_id from amendments where person_id = any(${ids}::uuid[])`,
      // candidatura do TSE ligada à pessoa: sem ela, o carimbo de tse.candidatos não sustenta "nenhum bem declarado"
      sql`select distinct person_id from candidacies where person_id = any(${ids}::uuid[])`,
    ]);
    const emendaOf = new Set(emendasCasadas.map((r) => String(r.person_id)));
    const candOf = new Set(comCandidatura.map((r) => String(r.person_id)));
    const SEM_VINCULO_EMENDAS = { emendas: "As emendas do Portal da Transparência foram carregadas, mas nenhuma está ligada a esta pessoa como autora." };
    const lugares = [...new Set(mands.filter((m) => m.office === "vereador").map((m) => String(m.place_id)))];
    const ufsAsm = [...new Set(mands.filter((m) => m.office === "deputado_estadual" || m.office === "deputado_distrital").map((m) => String(m.uf ?? "")).filter(Boolean))];
    const [cov, asms] = await Promise.all([
      lugares.length ? sql`select place_id, dataset, status, reason, evidence_url from data_coverage where place_id = any(${lugares}::uuid[])` : Promise.resolve([] as Row[]),
      // Assembleia: uma leitura por UF distinta (no máximo 27), não por pessoa
      // falha de leitura lança (o chamador tem o .catch e não afirma estado), em vez de virar "não conferido" no cache
      Promise.all(ufsAsm.map(async (uf) => [uf, await pgSource.getAssembly(uf)] as const)),
    ]);
    const asmOf = new Map(asms);
    const carimbo: Record<string, CarimboFonte | null> = Object.fromEntries(
      carimbos.map((r) => [String(r.prefix), { nome: String(r.name), url: (r.url as string | null) ?? null, em: isoTs(r.at) }]),
    );
    const mOf = new Map(mands.map((m) => [String(m.person_id), m]));
    const fOf = new Map(faltas.map((f) => [String(f.person_id), (f.missing_datasets as string[] | null) ?? []]));
    const sOf = new Map(sapl.map((s) => [String(s.person_id), s]));
    return ids.map((id) => {
      const m = mOf.get(id);
      const office = (m?.office as OfficeSlug | undefined) ?? null;
      const s = sOf.get(id);
      const casa = !m ? null : office === "vereador" ? `Câmara Municipal de ${m.place_name} (${m.uf})` : office === "deputado_estadual" || office === "deputado_distrital" ? houseName(String(m.uf)) : null;
      return {
        personId: id,
        conjuntos: coberturaDe({
          office,
          status: (m?.status as MandateStatus | undefined) ?? null,
          faltaFederal: fOf.get(id) ?? null,
          coberturaLugar: m
            ? cov
                .filter((c) => String(c.place_id) === String(m.place_id))
                .map((c) => ({ dataset: String(c.dataset), status: c.status as CoverageStatus, reason: String(c.reason), evidenceUrl: (c.evidence_url as string | null) ?? null }))
            : [],
          carimbos: carimbo,
          assembleia: m && (office === "deputado_estadual" || office === "deputado_distrital") ? (asmOf.get(String(m.uf)) ?? null) : null,
          sapl: s ? { nome: String(s.source_name ?? "SAPL da Câmara Municipal"), url: (s.base_url as string | null) ?? null, em: isoTs(s.loaded_at) } : null,
          casa,
          semVinculo: emendaOf.has(id) ? undefined : SEM_VINCULO_EMENDAS,
          temCandidatura: candOf.has(id),
        }),
      };
    });
  },
  async getYearlyStats(personId) {
    const rows = await sql`select period::int as y, s.* from person_period_stats s where person_id = ${personId}::uuid and period <> 'career' order by 1`;
    const missing = (r: Row, d: string) => ((r.missing_datasets as string[] | null) ?? []).includes(d);
    return rows.map<YearStats>((r) => ({
      year: Number(r.y),
      presencePresent: missing(r, "presenca") ? null : num(r.presence_present),
      presenceTotal: missing(r, "presenca") ? null : num(r.presence_total),
      proposalsPrincipal: missing(r, "propostas") ? null : num(r.proposals_principal),
      proposalsCosigned: missing(r, "propostas") ? null : num(r.proposals_cosigned),
      votesRegistered: missing(r, "votos") ? null : num(r.votes_registered),
      expensesCents: missing(r, "gastos_gabinete") ? null : num(r.expenses_cents),
    }));
  },
  async getPresenceByMonth(personId, year) {
    const rows = await sql`
      select extract(month from s.starts_at at time zone 'America/Sao_Paulo')::int as m,
             count(*) filter (where a.status = 'presente')::int as present,
             count(*) filter (where a.status in ('presente', 'ausente', 'ausencia_justificada'))::int as total
      from attendance a join sessions s on s.id = a.session_id
      where a.person_id = ${personId}::uuid and s.is_deliberative
        and s.starts_at >= make_timestamptz(${year}, 1, 1, 0, 0, 0, 'America/Sao_Paulo') and s.starts_at < make_timestamptz(${year + 1}, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
      group by 1 having count(*) filter (where a.status in ('presente', 'ausente', 'ausencia_justificada')) > 0 order by 1`;
    return rows.map((r) => ({ month: Number(r.m), present: Number(r.present), total: Number(r.total) }));
  },
  async getAttendanceGrid(personId, year) {
    const rows = await sql`
      select (s.starts_at at time zone 'America/Sao_Paulo')::date as d, a.status
      from attendance a join sessions s on s.id = a.session_id
      where a.person_id = ${personId}::uuid and s.is_deliberative
        and s.starts_at >= make_timestamptz(${year}, 1, 1, 0, 0, 0, 'America/Sao_Paulo') and s.starts_at < make_timestamptz(${year + 1}, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
      order by s.starts_at, s.id`;
    return gridFrom(year, rows.map((r) => ({ date: iso(r.d), state: String(r.status) as AttendanceState })));
  },
  async getChamberTransition(body) {
    const kind = body === "senado" ? "senado" : "camara_deputados";
    const capacity = body === "senado" ? 81 : 513;
    // uma linha por pessoa: o mandato em exercício (hoje) e/ou o eleito aguardando posse (fev/2027)
    const rows = await sql`
      select p.slug, p.display_name, pl.uf,
             bool_or(m.status = 'em_exercicio') as holds,
             bool_or(m.status = 'em_exercicio' and m.ends_on > date '2027-02-01') as term_goes_on,
             bool_or(m.status = 'eleito_aguardando_posse') as waits
      from mandates m
      join legislative_bodies b on b.id = m.body_id and b.kind = ${kind}
      join people p on p.id = m.person_id
      join places pl on pl.id = m.place_id
      where m.status in ('em_exercicio', 'eleito_aguardando_posse')
      group by p.id, p.slug, p.display_name, pl.uf
      order by p.display_name collate pt_br, p.slug`;
    const loaded = rows.some((r) => r.waits);
    const seat = (r: (typeof rows)[number], change: TransitionSeat["change"]): TransitionSeat => ({ id: String(r.slug), name: String(r.display_name), uf: (r.uf as string | null) ?? null, change });
    const holders = rows.filter((r) => r.holds);
    const stays = (r: (typeof rows)[number]) => Boolean(r.term_goes_on || r.waits);
    const continuing = holders.filter(stays).map((r) => seat(r, "continua"));
    const leaving = holders.filter((r) => !stays(r)).map((r) => seat(r, "sai"));
    const entering = rows.filter((r) => r.waits && !r.holds).map((r) => seat(r, "entra"));
    const today = (loaded ? [...continuing, ...leaving] : holders.map((r) => seat(r, "continua"))).slice(0, capacity);
    const next = [...continuing, ...entering].slice(0, capacity);
    return {
      capacity,
      loaded,
      today,
      next,
      continua: continuing.length,
      entra: entering.length,
      sai: leaving.length,
      pending: Math.max(0, capacity - next.length),
      extra: Math.max(0, holders.length - capacity),
    } satisfies ChamberTransition;
  },
  async getSalaryAccrued(personId, year) {
    // mês a mês, em todos os mandatos já exercidos; o valor de cada mês é o subsídio vigente no 1º dia dele.
    // Mês sem valor carregado (antes do primeiro valid_from) conta no tempo de cargo, não na soma.
    const [r] = await sql`
      with ms as (
        select m.office_id, m.place_id, gs::date as mo
        from mandates m,
             generate_series(date_trunc('month', m.started_on), date_trunc('month', least(m.ends_on - 1, current_date)), interval '1 month') gs
        where m.person_id = ${personId}::uuid and m.status <> 'eleito_aguardando_posse'
          ${year ? sql`and extract(year from gs) = ${year}` : sql``}
      )
      select count(*)::int as months, count(sa.amount_cents)::int as covered, sum(sa.amount_cents)::bigint as cents,
             min(mo) as first, min(mo) filter (where sa.amount_cents is not null) as covered_from
      from ms
      left join lateral (select amount_cents from salaries s where s.office_id = ms.office_id and (s.place_id = ms.place_id or s.place_id is null)
                         and s.valid_from <= ms.mo and not s.is_ceiling order by s.place_id nulls last, s.valid_from desc limit 1) sa on true`;
    if (!r || !r.covered) return null;
    return { cents: Number(r.cents), months: Number(r.months), coveredMonths: Number(r.covered), firstMonth: iso(r.first), coveredFrom: r.covered_from ? iso(r.covered_from) : null } satisfies SalaryAccrued;
  },
  async getCampaignFinance(personId) {
    // uma candidatura por ano (a que tem lançamentos; o 2º turno não repete a conta: D44); categorias com soma 0 saem (ex.: "#NULO")
    const rows = await sql`
      with per as (
        select c.id, e.year, o.slug as office, p.gender, o.name_m, o.name_f, pl.name as place_name, pl.kind as place_kind, pl.uf as place_uf,
               (select count(*) from campaign_finance_entries f where f.candidacy_id = c.id) as n
        from candidacies c join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id
        join offices o on o.id = ct.office_id join places pl on pl.id = ct.place_id join people p on p.id = c.person_id
        where c.person_id = ${personId}::uuid
      ), pick as (
        select distinct on (year) * from per where n > 0 order by year, n desc
      )
      select pick.year, pick.office, pick.gender, pick.name_m, pick.name_f, pick.place_name, pick.place_kind, pick.place_uf,
             f.direction, f.category, sum(f.amount_cents)::bigint as cents
      from pick join campaign_finance_entries f on f.candidacy_id = pick.id
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
      having sum(f.amount_cents) <> 0
      order by pick.year desc, f.direction, cents desc, f.category`;
    const by = new Map<number, CampaignFinance>();
    for (const r of rows) {
      const y = Number(r.year);
      const cur = by.get(y) ?? { year: y, officeName: officeName(r), placeLabel: placeLabel(r), income: [], spending: [], origins: [], donors: [] };
      (r.direction === "receita" ? cur.income : cur.spending).push({ label: String(r.category), cents: Number(r.cents) });
      by.set(y, cur);
    }
    if (by.size) {
      // catálogo D11: a mesma candidatura escolhida acima (a de mais lançamentos no ano)
      const pick = await sql`
        with per as (
          select c.id, e.year, (select count(*) from campaign_finance_entries f where f.candidacy_id = c.id) as n
          from candidacies c join elections e on e.id = c.election_id where c.person_id = ${personId}::uuid
        ), pick as (select distinct on (year) id, year from per where n > 0 order by year, n desc)
        select pick.year, 'o' as t, o.origin as a, null::text as b, o.amount_cents::bigint as cents
          from pick join campaign_finance_by_origin o on o.candidacy_id = pick.id
        union all
        select pick.year, 'd', d.donor_kind, d.donor_name, sum(d.amount_cents)::bigint
          from pick join campaign_finance_donors d on d.candidacy_id = pick.id group by 1, 2, 3, 4
        order by 1, 2, 5 desc, 4`;
      for (const r of pick) {
        const cur = by.get(Number(r.year));
        if (!cur) continue;
        if (r.t === "o") cur.origins.push({ origin: r.a as CampaignOrigin, cents: Number(r.cents) });
        else cur.donors.push({ kind: r.a as "partido" | "pessoa_juridica", name: String(r.b), cents: Number(r.cents) });
      }
      const order = new Map(CAMPAIGN_ORIGINS.map((o, i) => [o.origin, i]));
      for (const c of by.values()) c.origins.sort((a, b) => (order.get(a.origin) ?? 99) - (order.get(b.origin) ?? 99));
    }
    return [...by.values()].sort((a, b) => b.year - a.year);
  },
  async listAmendmentsByPerson(personId) {
    const rows = await sql`${AMENDMENT_SELECT} where a.person_id = ${personId}::uuid
      order by a.year desc, coalesce(pl.name, a.locality_label, '') collate pt_br, a.area collate pt_br nulls last, a.source_key`;
    return rows.map(amendmentRow);
  },
  async listAmendmentsToPlace(ibge) {
    const rows = await sql`${AMENDMENT_SELECT} where pl.ibge_code = ${ibge}
      order by a.year desc, a.author_label collate pt_br, a.area collate pt_br nulls last, a.source_key`;
    return rows.map(amendmentRow);
  },
  async listStaff(personId) {
    const rows = await sql`select name, role, monthly_salary_cents, as_of from staff_members where person_id = ${personId}::uuid order by name collate pt_br`;
    return rows.map<StaffMember>((r) => ({ name: String(r.name), role: (r.role as string | null) ?? null, monthlySalaryCents: num(r.monthly_salary_cents), asOf: iso(r.as_of) }));
  },
  async countSecretVotes(personId, year) {
    const [r] = await sql`
      select count(*)::int as n
      from voting_events e join legislative_bodies b on b.id = e.body_id and b.kind = 'senado'
      where e.is_nominal and e.is_secret is true
        and exists (select 1 from mandates m join offices o on o.id = m.office_id and o.slug = 'senador'
                    where m.person_id = ${personId}::uuid and m.status <> 'eleito_aguardando_posse'
                      and (e.occurred_at at time zone 'America/Sao_Paulo')::date >= m.started_on and (e.occurred_at at time zone 'America/Sao_Paulo')::date < m.ends_on)
        ${year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${year}` : sql``}`;
    return Number(r?.n ?? 0);
  },
  async getActiveYears(personId) {
    const rows = await sql`select distinct y::int as y from mandates m,
      generate_series(extract(year from m.started_on)::int, least(extract(year from m.ends_on - 1)::int, extract(year from current_date)::int)) y
      where m.person_id = ${personId}::uuid and m.status <> 'eleito_aguardando_posse' order by 1 desc`;
    return rows.map((r) => Number(r.y));
  },

  async listProposals(personId, f) {
    const limit = Math.min(f.limit ?? 20, 500);
    const offset = off(f.cursor);
    const q = f.q?.trim();
    const where = sql`pa.person_id = ${personId}::uuid
      ${f.year ? sql`and p.year = ${f.year}` : sql``}
      ${f.type === "lei" ? sql`and p.can_become_law` : f.type === "pedido" ? sql`and not p.can_become_law and p.type <> all(${EMENDA_TYPES}::text[])` : f.type === "emenda" ? sql`and p.type = any(${EMENDA_TYPES}::text[])` : sql``}
      ${f.role ? sql`and (pa.role = 'principal') = ${f.role === "autor"}` : sql``}
      ${f.topic ? sql`and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = p.id and t.slug = ${f.topic})` : sql``}
      ${q ? sql`and (f_unaccent(lower(p.summary_official)) like '%' || f_unaccent(lower(${q})) || '%' or lower(p.type || ' ' || p.number) like '%' || lower(${q}) || '%')` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from proposal_authors pa join proposals p on p.id = pa.proposal_id where ${where}`;
    const rows = await sql`
      select p.id, p.type, p.number, p.year, p.summary_official, p.can_become_law, p.status, p.presented_on, p.url, pa.role,
             coalesce((select array_agg(t.slug order by t.slug) from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = p.id), '{}') as topics
      from proposal_authors pa join proposals p on p.id = pa.proposal_id
      where ${where}
      order by p.presented_on desc nulls last, p.year desc, p.number desc limit ${limit} offset ${offset}`;
    return page(
      rows.map<Proposal>((r) => ({
        id: String(r.id),
        type: String(r.type),
        number: Number(r.number),
        year: Number(r.year),
        summary: String(r.summary_official),
        topics: (r.topics as string[]) ?? [],
        role: r.role === "principal" ? "autor" : "coautor",
        canBecomeLaw: Boolean(r.can_become_law),
        // sem situação na fonte lida (ALESP, parte da Câmara e do Senado): não presume "em tramitação"
        status: r.status ? String(r.status) : "situação não carregada",
        presentedOn: r.presented_on ? iso(r.presented_on) : `${r.year}-01-01`,
        url: String(r.url ?? ""),
      })),
      Number(n),
      offset,
      limit,
    );
  },
  async listVotes(personId, f) {
    const limit = Math.min(f.limit ?? 20, 500);
    const offset = off(f.cursor);
    const q = f.q?.trim();
    const base = sql`v.person_id = ${personId}::uuid and e.is_nominal
      ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
      ${f.value ? sql`and v.value = ${f.value}` : sql``}
      ${f.topic ? sql`and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id and t.slug = ${f.topic})` : sql``}
      ${q ? sql`and f_unaccent(lower(e.description)) like '%' || f_unaccent(lower(${q})) || '%'` : sql``}`;
    const lei = f.scope === "lei";
    const where = lei ? sql`${base} and e.kind <> all(${PROCEDURAL_KINDS}::text[])` : base;
    const [{ n }] = await sql`select count(*)::int as n from votes v join voting_events e on e.id = v.voting_event_id where ${where}`;
    const hidden = lei ? Number((await sql`select count(*)::int as n from votes v join voting_events e on e.id = v.voting_event_id where ${base} and e.kind = any(${PROCEDURAL_KINDS}::text[])`)[0].n) : 0;
    const rows = await sql`
      select e.id, e.kind, b.kind as body, e.occurred_at, e.result, e.yes_count, e.no_count, v.value, v.party_id,
             -- a Câmara publica só o placar na descrição; a proposição votada dá o assunto
             case when pr.id is not null then pr.type || ' ' || pr.number || '/' || pr.year || ' — ' || left(pr.summary_official, 220) || ' · ' || e.description else e.description end as description,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      from votes v join voting_events e on e.id = v.voting_event_id join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
      where ${where}
      order by e.occurred_at desc limit ${limit} offset ${offset}`;
    return {
      ...page(
        rows.map(personVoteRow),
        Number(n),
        offset,
        limit,
      ),
      hidden,
    };
  },
  async listExpenses(personId, f) {
    const limit = Math.min(f.limit ?? 20, 500);
    const offset = off(f.cursor);
    const base = sql`person_id = ${personId}::uuid ${f.year ? sql`and extract(year from occurred_on) = ${f.year}` : sql``}`;
    const cats = await sql`select category as label, sum(amount_cents)::bigint as cents from expenses where ${base} group by 1 order by 2 desc`;
    const where = sql`${base} ${f.category ? sql`and category = ${f.category}` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from expenses where ${where}`;
    const rows = await sql`select id, occurred_on, category, supplier_name, amount_cents, receipt_url from expenses where ${where} order by occurred_on desc, id desc limit ${limit} offset ${offset}`;
    return {
      ...page(
        rows.map<Expense>((r) => ({ id: String(r.id), occurredOn: iso(r.occurred_on), category: String(r.category), supplier: String(r.supplier_name ?? "—"), amountCents: Number(r.amount_cents), receiptUrl: (r.receipt_url as string | null) ?? null })),
        Number(n),
        offset,
        limit,
      ),
      byCategory: cats.map((c) => ({ label: String(c.label), cents: Number(c.cents) })),
    };
  },
  async getAgreement(personIds, period) {
    const out: Agreement[] = [];
    for (let i = 0; i < personIds.length; i++)
      for (let j = i + 1; j < personIds.length; j++) {
        const [r] = await sql`
          select count(*)::int as total, count(*) filter (where a.value = b.value)::int as same
          from votes a join votes b on b.voting_event_id = a.voting_event_id and b.person_id = ${personIds[j]}::uuid
          join voting_events e on e.id = a.voting_event_id
          where a.person_id = ${personIds[i]}::uuid
            and a.value in ('sim','nao','abstencao','obstrucao') and b.value in ('sim','nao','abstencao','obstrucao')
            ${period !== "career" ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${period}` : sql``}`;
        out.push({ a: personIds[i], b: personIds[j], same: Number(r.same), total: Number(r.total) });
      }
    return out;
  },
  async listDisagreements(a, b, f) {
    const limit = Math.min(f.limit ?? 20, 400);
    const base = sql`
      from votes va join votes vb on vb.voting_event_id = va.voting_event_id and vb.person_id = ${b}::uuid
      join voting_events e on e.id = va.voting_event_id
      where va.person_id = ${a}::uuid
        and va.value in ('sim','nao','abstencao','obstrucao') and vb.value in ('sim','nao','abstencao','obstrucao') and va.value <> vb.value
        ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}`;
    const topicFilter = f.topic ? sql`and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id and t.slug = ${f.topic})` : sql``;
    const [{ n }] = await sql`select count(*)::int as n ${base} ${topicFilter}`;
    const list = await sql`
      select e.id, bd.kind as body, e.occurred_at, e.description, e.result, e.yes_count, e.no_count, va.value as va, vb.value as vb,
             case when pr.id is not null then pr.type || ' ' || pr.number || '/' || pr.year end as label, pr.summary_official,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      from votes va join votes vb on vb.voting_event_id = va.voting_event_id and vb.person_id = ${b}::uuid
      join voting_events e on e.id = va.voting_event_id
      join legislative_bodies bd on bd.id = e.body_id
      left join proposals pr on pr.id = e.proposal_id
      where va.person_id = ${a}::uuid
        and va.value in ('sim','nao','abstencao','obstrucao') and vb.value in ('sim','nao','abstencao','obstrucao') and va.value <> vb.value
        ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
        ${topicFilter}
      order by e.occurred_at desc, e.id limit ${limit}`;
    const tc = await sql`
      select t.slug, count(distinct e.id)::int as n
      from votes va join votes vb on vb.voting_event_id = va.voting_event_id and vb.person_id = ${b}::uuid
      join voting_events e on e.id = va.voting_event_id
      join proposal_topics pt on pt.proposal_id = e.proposal_id join topics t on t.id = pt.topic_id
      where va.person_id = ${a}::uuid
        and va.value in ('sim','nao','abstencao','obstrucao') and vb.value in ('sim','nao','abstencao','obstrucao') and va.value <> vb.value
        ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
      group by 1 order by 1`;
    return {
      ...page(
        list.map<Disagreement>((r) => ({
          event: {
            id: String(r.id),
            body: r.body === "senado" ? "senado" : "camara",
            occurredAt: isoTs(r.occurred_at),
            description: r.summary_official ? String(r.summary_official) : String(r.description),
            topic: (r.topic as string | null) ?? null,
            result: (r.result as "aprovado" | "rejeitado" | null) ?? null,
            yes: Number(r.yes_count ?? 0),
            no: Number(r.no_count ?? 0),
            proposalLabel: (r.label as string | null) ?? null,
          },
          a: r.va as VoteValue,
          b: r.vb as VoteValue,
        })),
        Number(n),
        0,
        limit,
      ),
      topics: tc.map((t) => ({ slug: String(t.slug), count: Number(t.n) })),
    };
  },
  async listTopics() {
    return (await sql`select slug, name from topics order by name collate pt_br`).map((r) => ({ slug: String(r.slug), name: String(r.name) }));
  },
  async getChamber(body) {
    const kind = body === "senado" ? "senado" : "camara_deputados";
    const rows = await sql`
      select p.slug, p.display_name, coalesce(pa.acronym, '—') as party, pl.uf
      from mandates m
      join legislative_bodies b on b.id = m.body_id and b.kind = ${kind}
      join people p on p.id = m.person_id
      join places pl on pl.id = m.place_id
      left join person_current_party cp on cp.person_id = p.id
      left join parties pa on pa.id = coalesce(cp.party_id, m.party_id)
      where m.status = 'em_exercicio'
      order by pa.acronym, p.display_name collate pt_br`;
    return rows.map((r) => ({ slug: String(r.slug), name: String(r.display_name), party: String(r.party), uf: (r.uf as string | null) ?? null }));
  },
  async listVotingEvents(f) {
    const kind = f.body === "senado" ? "senado" : "camara_deputados";
    const limit = Math.min(f.limit ?? 30, 100);
    const offset = off(f.cursor);
    const q = f.q?.trim();
    const base = sql`b.kind = ${kind} and e.is_nominal
      ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
      ${f.result ? sql`and e.result = ${f.result}` : sql``}
      ${q ? sql`and (f_unaccent(lower(e.description)) like '%' || f_unaccent(lower(${q})) || '%' or f_unaccent(lower(coalesce(pr.summary_official, ''))) like '%' || f_unaccent(lower(${q})) || '%' or lower(coalesce(pr.type || ' ' || pr.number, '')) like '%' || lower(${q}) || '%')` : sql``}`;
    const lei = f.scope === "lei";
    const where = lei ? sql`${base} and e.kind <> all(${PROCEDURAL_KINDS}::text[])` : base;
    const from = sql`from voting_events e join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id`;
    const [{ n }] = await sql`select count(*)::int as n ${from} where ${where}`;
    const hidden = lei ? Number((await sql`select count(*)::int as n ${from} where ${base} and e.kind = any(${PROCEDURAL_KINDS}::text[])`)[0].n) : 0;
    const rows = await sql`
      select e.id, e.kind, e.occurred_at, e.description, e.result, e.yes_count, e.no_count, e.is_nominal, e.is_secret,
             exists (select 1 from votes v where v.voting_event_id = e.id) as has_votes,
             pr.type, pr.number, pr.year, pr.summary_official, pr.url,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      ${from} where ${where} order by e.occurred_at desc, e.id limit ${limit} offset ${offset}`;
    const years = await sql`select distinct extract(year from e.occurred_at at time zone 'America/Sao_Paulo')::int as y
      from voting_events e join legislative_bodies b on b.id = e.body_id where b.kind = ${kind} and e.is_nominal order by 1 desc`;
    return { ...page(rows.map((r) => summary(r, f.body)), Number(n), offset, limit), years: years.map((y) => Number(y.y)), hidden };
  },
  async getVotingEvent(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const [r] = await sql`
      select e.id, e.kind, e.occurred_at, e.description, e.result, e.yes_count, e.no_count, e.is_nominal, e.is_secret, b.kind as body,
             e.body_id, ((e.occurred_at at time zone 'America/Sao_Paulo')::date)::text as occurred_on,
             exists (select 1 from votes v where v.voting_event_id = e.id) as has_votes,
             pr.type, pr.number, pr.year, pr.summary_official, pr.url,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      from voting_events e join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
      where e.id = ${id}::uuid`;
    if (!r) return null;
    // uf = a do mandato da pessoa NESTA casa que COBRE a data da votação (placar por UF). Sem esse mandato: null ("sem
    // estado identificado"), nunca a UF de um mandato que não cobre a data nem a de outro cargo.
    // uf_atual = a do mandato mais recente de qualquer cargo (sigla de identificação do v1, como na main); não vai ao placar.
    const votes = await sql`
      select p.slug, p.display_name, coalesce(pa.acronym, '—') as party, pl.uf, ua.uf as uf_atual, v.value
      from votes v join people p on p.id = v.person_id
      left join parties pa on pa.id = v.party_id
      left join lateral (
        select pl.uf from mandates m join places pl on pl.id = m.place_id
        where m.person_id = p.id and m.body_id = ${r.body_id as string}::uuid
          and m.started_on <= ${r.occurred_on as string}::date and (m.ends_on is null or m.ends_on > ${r.occurred_on as string}::date)
        order by m.started_on desc limit 1) pl on true
      left join lateral (
        select pl2.uf from mandates m2 join places pl2 on pl2.id = m2.place_id where m2.person_id = p.id order by m2.started_on desc limit 1) ua on true
      where v.voting_event_id = ${id}::uuid
      order by p.display_name collate pt_br`;
    const orientations = await sql`
      select oa.label, oa.kind, po.orientation from party_orientations po join orientation_actors oa on oa.id = po.actor_id
      where po.voting_event_id = ${id}::uuid
      order by case oa.kind when 'governo' then 0 when 'maioria' then 1 when 'minoria' then 2 when 'oposicao' then 3 when 'partido' then 4 else 5 end, oa.label`;
    const counts = { sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0 } as Record<VoteValue, number>;
    const parties = new Map<string, { party: string; counts: Partial<Record<VoteValue, number>>; total: number }>();
    for (const v of votes) {
      const val = v.value as VoteValue;
      counts[val]++;
      const p = parties.get(String(v.party)) ?? { party: String(v.party), counts: {}, total: 0 };
      p.counts[val] = (p.counts[val] ?? 0) + 1;
      p.total++;
      parties.set(String(v.party), p);
    }
    const sum = summary(r, r.body === "senado" ? "senado" : "camara");
    return {
      ...sum,
      porUf: placarPorUf(sum, votes.map((v) => ({ uf: (v.uf as string | null) ?? null, value: v.value as VoteValue, name: String(v.display_name) }))),
      counts,
      orientations: orientations.map((o) => ({ label: String(o.label), kind: o.kind as VotingEventDetail["orientations"][number]["kind"], value: o.orientation as VotingEventDetail["orientations"][number]["value"] })),
      // partidos em ordem alfabética: nunca por tamanho nem por "fidelidade"
      byParty: [...parties.values()].sort((a, b) => a.party.localeCompare(b.party, "pt-BR")),
      votes: votes.map((v) => ({ slug: String(v.slug), name: String(v.display_name), party: String(v.party), uf: (v.uf as string | null) ?? null, ufAtual: (v.uf_atual as string | null) ?? null, value: v.value as VoteValue })),
    } satisfies VotingEventDetail;
  },
  async getActivity(personIds, limit = 60) {
    if (!personIds.length) return [];
    const ids = personIds.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 200);
    const VOTE: Record<string, string> = { sim: "Sim", nao: "Não", abstencao: "Abstenção", obstrucao: "Obstrução", art17: "Art. 17", nao_votou: "Não votou" };
    const rows = await sql`
      (select p.slug, p.display_name, 'voto' as kind, e.occurred_at as at, coalesce(pr.type || ' ' || pr.number || '/' || pr.year, 'Votação nominal') as title,
              v.value as detail, '/votacoes/' || e.id as href
         from votes v join voting_events e on e.id = v.voting_event_id join people p on p.id = v.person_id left join proposals pr on pr.id = e.proposal_id
        where v.person_id = any(${ids}::uuid[]) and e.occurred_at > now() - interval '120 days'
        order by e.occurred_at desc limit ${limit})
      union all
      (select p.slug, p.display_name, 'proposta', coalesce(pr.presented_on::timestamptz, make_date(pr.year, 1, 1)::timestamptz), pr.type || ' ' || pr.number || '/' || pr.year,
              left(pr.summary_official, 200), coalesce(pr.url, '/p/' || p.slug)
         from proposal_authors pa join proposals pr on pr.id = pa.proposal_id join people p on p.id = pa.person_id
        where pa.person_id = any(${ids}::uuid[]) and pr.presented_on > current_date - 120
        order by pr.presented_on desc limit ${limit})
      union all
      (select p.slug, p.display_name, 'gasto', x.occurred_on::timestamptz, x.category, (x.amount_cents)::text, '/p/' || p.slug || '#gastos'
         from expenses x join people p on p.id = x.person_id
        where x.person_id = any(${ids}::uuid[]) and x.occurred_on > current_date - 60
        order by x.occurred_on desc limit ${limit})
      order by at desc limit ${limit}`;
    return rows.map<ActivityItem>((r) => ({
      personSlug: String(r.slug),
      personName: String(r.display_name),
      kind: r.kind as ActivityItem["kind"],
      occurredAt: isoTs(r.at),
      title: String(r.title),
      detail: r.kind === "voto" ? (VOTE[String(r.detail)] ?? String(r.detail)) : r.kind === "gasto" ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(r.detail) / 100) : (r.detail as string | null),
      href: String(r.href),
    }));
  },
  async getLaws(personId) {
    const rows = await sql`
      select l.number, l.sanctioned_on, l.summary, l.url, pr.type || ' ' || pr.number || '/' || pr.year as proposal, pa.role
      from proposal_authors pa join proposals pr on pr.id = pa.proposal_id join laws l on l.id = pr.became_law_id
      where pa.person_id = ${personId}::uuid and pa.role in ('principal','coautoria')
      order by l.sanctioned_on desc`;
    return rows.map(lawRow);
  },
  async getAgenda(f) {
    const limit = Math.min(f.limit ?? 10, 50);
    const kind = f.body === "senado" ? "senado" : "camara_deputados";
    const from = sql`from agenda_events e join legislative_bodies b on b.id = e.body_id and b.kind = ${kind}
      where e.starts_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')`;
    const [{ n }] = await sql`select count(*)::int as n ${from}`;
    const evs = await sql`select e.id, e.house, e.starts_at, e.kind, e.title, e.status, e.location, e.official_url ${from} order by e.starts_at, e.id limit ${limit}`;
    const ids = evs.map((e) => String(e.id));
    const items = ids.length
      ? await sql`
          select i.agenda_event_id, i.position, i.proposal_type, i.proposal_number, i.proposal_year, i.title, i.summary, i.regime, i.rapporteur, i.outcome_text,
                 pr.url as proposal_url,
                 (select ve.id from voting_events ve where ve.proposal_id = i.proposal_id and ve.is_nominal order by ve.occurred_at desc limit 1) as voting_event_id
          from agenda_items i left join proposals pr on pr.id = i.proposal_id
          where i.agenda_event_id = any(${ids}::bigint[]) order by i.agenda_event_id, i.position`
      : [];
    const by = new Map<string, AgendaItem[]>();
    for (const r of items) {
      const arr = by.get(String(r.agenda_event_id)) ?? [];
      const clean = (v: unknown) => {
        const t = typeof v === "string" ? v.trim() : "";
        return t && t !== "-" ? t : null;
      };
      arr.push({
        position: Number(r.position),
        label: r.proposal_type && r.proposal_number ? `${r.proposal_type} ${r.proposal_number}/${r.proposal_year}` : null,
        title: String(r.title),
        summary: clean(r.summary),
        regime: clean(r.regime),
        rapporteur: clean(r.rapporteur),
        outcome: clean(r.outcome_text),
        proposalUrl: typeof r.proposal_url === "string" && /^https?:\/\//.test(r.proposal_url) ? r.proposal_url : null,
        votingEventId: r.voting_event_id ? String(r.voting_event_id) : null,
      });
      by.set(String(r.agenda_event_id), arr);
    }
    const events = evs.map<AgendaEvent>((e) => {
      const all = by.get(String(e.id)) ?? [];
      const url = typeof e.official_url === "string" && /^https?:\/\//.test(e.official_url) ? e.official_url : null;
      return {
        id: String(e.id),
        house: e.house as AgendaEvent["house"],
        startsAt: isoTs(e.starts_at),
        kind: String(e.kind),
        title: (e.title as string | null)?.trim() || null,
        status: String(e.status),
        location: (e.location as string | null)?.trim() || null,
        officialUrl: url,
        items: all.slice(0, 40),
        itemsTotal: all.length,
      };
    });
    const [st] = await sql`
      select s.name, s.url, max(ds.refreshed_at) as at
      from dataset_stamps ds join sources s on s.id = ds.source_id
      where ds.dataset like ${(f.body === "senado" ? "agenda.senado" : "agenda.camara") + ".%"} group by s.name, s.url order by max(ds.refreshed_at) desc limit 1`;
    return { events, total: Number(n), source: st ? { name: String(st.name), url: String(st.url), refreshedAt: isoTs(st.at) } : null } satisfies AgendaView;
  },
  async listLaws(f) {
    const limit = Math.min(f.limit ?? 30, 200);
    const offset = off(f.cursor);
    const where = sql`l.sphere = 'federal' ${f.year ? sql`and extract(year from l.sanctioned_on) = ${f.year}` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from laws l where ${where}`;
    const rows = await sql`
      select l.number, l.sanctioned_on, l.summary, l.url, pr.type || ' ' || pr.number || '/' || pr.year as proposal, pr.url as proposal_url,
             coalesce((select json_agg(json_build_object('slug', p.slug, 'name', p.display_name) order by p.display_name collate pt_br)
                       from proposal_authors pa join people p on p.id = pa.person_id where pa.proposal_id = pr.id and pa.role = 'principal'), '[]') as authors
      from laws l left join lateral (select * from proposals x where x.became_law_id = l.id order by x.presented_on nulls last limit 1) pr on true
      where ${where}
      order by l.sanctioned_on desc, l.number limit ${limit} offset ${offset}`;
    const years = await sql`select distinct extract(year from sanctioned_on)::int as y from laws where sphere = 'federal' order by 1 desc`;
    return {
      ...page(
        rows.map<LawListItem>((r) => {
          const authors = (r.authors as { slug: string; name: string }[]) ?? [];
          return {
            number: String(r.number),
            sanctionedOn: iso(r.sanctioned_on),
            summary: String(r.summary),
            url: (r.url as string | null) ?? null,
            proposal: (r.proposal as string | null) ?? null,
            proposalUrl: (r.proposal_url as string | null) ?? null,
            authors: authors.slice(0, 3),
            moreAuthors: Math.max(0, authors.length - 3),
          };
        }),
        Number(n),
        offset,
        limit,
      ),
      years: years.map((y) => Number(y.y)),
    };
  },
  async getCommittees(personId) {
    const rows = await sql`
      select c.acronym, c.name, cm.role, cm.from_on, cm.to_on, b.kind
      from committee_memberships cm join committees c on c.id = cm.committee_id join legislative_bodies b on b.id = c.body_id
      where cm.person_id = ${personId}::uuid
      order by (cm.to_on is null or cm.to_on >= current_date) desc, cm.from_on desc, c.name collate pt_br`;
    return rows.map<CommitteeItem>((r) => ({ acronym: (r.acronym as string | null) ?? null, name: String(r.name), role: String(r.role), from: iso(r.from_on), to: r.to_on ? iso(r.to_on) : null, body: r.kind === "senado" ? "senado" : "camara" }));
  },
  async listSpeeches(personId, f) {
    const limit = Math.min(f.limit ?? 10, 200);
    const offset = off(f.cursor);
    const where = sql`person_id = ${personId}::uuid ${f.year ? sql`and extract(year from occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from speeches where ${where}`;
    const rows = await sql`select id, occurred_at, summary, url from speeches where ${where} order by occurred_at desc, id desc limit ${limit} offset ${offset}`;
    return page(rows.map<SpeechItem>((r) => ({ id: String(r.id), occurredAt: isoTs(r.occurred_at), summary: (r.summary as string | null) ?? null, url: (r.url as string | null) ?? null })), Number(n), offset, limit);
  },
  async getContacts(personId) {
    const rows = await sql`
      select mc.kind, mc.value from mandate_contacts mc join mandates m on m.id = mc.mandate_id
      where m.person_id = ${personId}::uuid and m.status = 'em_exercicio'
      order by array_position(array['email','telefone','gabinete','site','instagram','facebook','x','youtube','tiktok','outra_rede'], mc.kind), mc.value`;
    return rows.map<ContactItem>((r) => ({ kind: r.kind as ContactItem["kind"], value: String(r.value) }));
  },
  async getStamp(dataset) {
    // casa com prefixo (camara.votacoes -> camara.*) e cai para o último run da fonte
    const src = dataset.split(".")[0];
    const [r] = await sql`
      select ds.dataset, s.name, s.url, ds.refreshed_at
      from dataset_stamps ds join sources s on s.id = ds.source_id
      where ds.dataset = ${dataset} or ds.dataset like ${src + ".%"} or s.slug = ${src}
      order by (ds.dataset = ${dataset}) desc, ds.refreshed_at desc limit 1`;
    if (!r) return { dataset, source: "Fonte oficial", sourceUrl: "/sobre#fontes", refreshedAt: new Date(0).toISOString() } satisfies Stamp;
    return { dataset: String(r.dataset), source: String(r.name), sourceUrl: String(r.url), refreshedAt: isoTs(r.refreshed_at) };
  },
  async getSalarySources(office) {
    // `at` (v1, "atualizado em"): com o upsert condicional do seed, max(updated_at) é quando o valor mudou, não quando foi
    // conferido. `loaded`: carimbo da carga da mesma fonte em dataset_stamps; hoje o seed (etl/civico_etl/jobs/seed.py) não
    // carimba, então vem null e a tela diz que a data não está registrada, em vez de inventar uma.
    const rows = await sql`
      select so.name, so.url, max(s.updated_at) as at,
             (select max(ds.refreshed_at) from dataset_stamps ds where ds.source_id = so.id) as loaded
      from salaries s join offices o on o.id = s.office_id join sources so on so.id = s.source_id
      where o.slug = ${office} group by so.id, so.name, so.url order by min(s.valid_from)`;
    return rows.map((r) => ({ name: String(r.name), url: String(r.url), updatedAt: isoTs(r.at), loadedAt: r.loaded ? isoTs(r.loaded) : null }));
  },
  async listStampYears(prefix) {
    const rows = await sql`select distinct right(dataset, 4)::int as y from dataset_stamps where dataset like ${prefix + ".%"} and right(dataset, 4) ~ '^[0-9]{4}$' order by 1`;
    return rows.map((r) => Number(r.y));
  },
  async listSourceStatus() {
    const rows = await sql`
      select s.slug, s.name, s.url, ds.dataset, ds.refreshed_at
      from sources s join dataset_stamps ds on ds.source_id = s.id
      order by s.name collate pt_br, ds.dataset`;
    const by = new Map<string, SourceStatus>();
    for (const r of rows) {
      const slug = String(r.slug);
      const cur = by.get(slug) ?? { slug, name: String(r.name), url: String(r.url), datasets: [], lastRefreshedAt: null };
      const at = isoTs(r.refreshed_at);
      cur.datasets.push({ dataset: String(r.dataset), refreshedAt: at });
      // leitura noturna (.noturna.) não conta: só registra o diário parado se o diário parou (mesma régua de health.ts)
      if (!String(r.dataset).includes(".noturna.") && (!cur.lastRefreshedAt || at > cur.lastRefreshedAt)) cur.lastRefreshedAt = at;
      by.set(slug, cur);
    }
    return [...by.values()];
  },
  async getCoverageMatrix() {
    const rows = await sql`
      select p.uf, dc.dataset, dc.status, count(*)::int as n, max(dc.checked_on) as checked
      from data_coverage dc join places p on p.id = dc.place_id
      where p.kind = 'municipio'
      group by 1, 2, 3`;
    const ufs = await sql`select p.uf, p.name, (select count(*)::int from places m where m.kind = 'municipio' and m.uf = p.uf) as cities from places p where p.kind = 'uf' order by p.name collate pt_br`;
    const keys = [...new Set(rows.map((r) => String(r.dataset)))].sort((a, b) => Object.keys(DATASET_LABEL).indexOf(a) - Object.keys(DATASET_LABEL).indexOf(b));
    const out: CoverageMatrix = {
      datasets: keys.map((k) => ({ key: k, label: DATASET_LABEL[k] ?? k })),
      rows: ufs.map((u) => ({ uf: String(u.uf), name: String(u.name), cities: Number(u.cities), cells: {} })),
      total: { cities: 0, cells: {} },
      checkedOn: null,
    };
    out.total.cities = out.rows.reduce((a, r) => a + r.cities, 0);
    const byUf = new Map(out.rows.map((r) => [r.uf, r]));
    for (const r of rows) {
      const row = byUf.get(String(r.uf));
      if (!row) continue;
      const d = String(r.dataset), st = r.status as CoverageStatus, n = Number(r.n);
      (row.cells[d] ??= {})[st] = n;
      const t = (out.total.cells[d] ??= {});
      t[st] = (t[st] ?? 0) + n;
      const c = r.checked ? String(r.checked instanceof Date ? r.checked.toISOString() : r.checked).slice(0, 10) : null;
      if (c && (!out.checkedOn || c > out.checkedOn)) out.checkedOn = c;
    }
    return out;
  },
  async getLatestRecord(personId) {
    // o mesmo recorte que o crachá mostra: voto nominal, proposta de autoria (qualquer papel) e gasto; data futura não vale
    const [[v], [p], [g]] = await Promise.all([
      sql`select (max(e.occurred_at) at time zone 'America/Sao_Paulo')::date as on_ from votes v join voting_events e on e.id = v.voting_event_id where v.person_id = ${personId}::uuid and e.is_nominal and e.occurred_at <= now()`,
      sql`select max(p.presented_on) as on_ from proposal_authors pa join proposals p on p.id = pa.proposal_id where pa.person_id = ${personId}::uuid and p.presented_on <= current_date`,
      // assembleias e câmaras lançam o gasto no dia 1 do mês (a fonte dá o mês): nelas só o mês é fato
      sql`select x.occurred_on as on_, b.kind not in ('camara_deputados', 'senado') as month_only
          from expenses x join legislative_bodies b on b.id = x.body_id
          where x.person_id = ${personId}::uuid and x.occurred_on <= current_date order by x.occurred_on desc limit 1`,
    ]);
    const found: LatestRecord[] = [];
    if (v?.on_) found.push({ kind: "votacao", on: iso(v.on_) });
    if (p?.on_) found.push({ kind: "proposta", on: iso(p.on_) });
    if (g?.on_) found.push({ kind: "gasto", on: iso(g.on_), ...(g.month_only ? { monthOnly: true } : {}) });
    return found.sort((x, y) => y.on.localeCompare(x.on))[0] ?? null;
  },
  async getSalarySchedule(office, placeIbge) {
    const rows = await sql`
      select s.valid_from, s.amount_cents, s.is_ceiling, so.name, so.url
      from salaries s join offices o on o.id = s.office_id join sources so on so.id = s.source_id
      left join places pl on pl.id = s.place_id
      where o.slug = ${office} and (s.place_id is null or pl.ibge_code = ${placeIbge})
      order by s.valid_from, s.place_id nulls first`;
    return rows.map<SalaryStep>((r) => ({ validFrom: iso(r.valid_from), amountCents: Number(r.amount_cents), isCeiling: Boolean(r.is_ceiling), source: { name: String(r.name), url: String(r.url) } }));
  },
  async latestRefresh() {
    const [r] = await sql`select max(refreshed_at) as at from dataset_stamps`;
    return r?.at ? isoTs(r.at) : new Date(0).toISOString();
  },

  async getPautaOverview() {
    const terms = await ruleTerms();
    const [wk] = await sql`select total, at_least, read_at, week_starts, week_ends from pocket_week_count`;
    const rows = await sql`select p.*, b.kind as body_kind from pauta_bolso p join legislative_bodies b on b.id = p.body_id order by p.scheduled_for`;
    const reads = await sql`
      select distinct on (r.body_id) b.kind, r.read_at, r.events_failed, r.events_total
      from pauta_reads r join legislative_bodies b on b.id = r.body_id order by r.body_id, r.read_at desc`;
    const exits = await sql`
      with rule as (select * from pocket_rules order by version desc limit 1)
      select e.*, b.kind as body_kind,
             substring(f_unaccent(lower(coalesce(e.summary_official, ''))) from r.term_pattern) as matched_term,
             (select array_agg(distinct th) from pauta_items i, unnest(i.official_themes) th, topics t
               where i.body_id = e.body_id and (i.prop_type, i.prop_number, i.prop_year) = (e.prop_type, e.prop_number, e.prop_year)
                 and t.slug = any (r.topic_slugs) and th = any (t.keywords)) as matched_themes
      from pauta_exits e join legislative_bodies b on b.id = e.body_id cross join rule r
      where e.outcome = 'saiu_da_pauta'
      order by e.decided_at desc`;
    const week = {
      total: Number(wk?.total ?? 0),
      atLeast: Boolean(wk?.at_least),
      readAt: wk?.read_at ? isoTs(wk.read_at) : null,
      weekStarts: isoTs(wk?.week_starts),
      weekEnds: isoTs(wk?.week_ends),
    };
    const published = await sql`
      select a.id, b.kind, a.prop_type, a.prop_number, a.prop_year, a.reviewed_at, a.answers
      from answer_drafts a join legislative_bodies b on b.id = a.body_id where a.status = 'publicado'`;
    const pub = new Map(published.map((p) => [proposalKey(p.kind === "senado" ? "senado" : "camara", String(p.prop_type), Number(p.prop_number), Number(p.prop_year)), p]));
    const quem = await verifiedByOf(published.map((p) => String(p.id)));
    const withReview = <T extends PautaEntry>(e: T): T => {
      const p = pub.get(e.key);
      if (!p) return e;
      return { ...e, reviewedAt: isoTs(p.reviewed_at), plain: plainOf(p.answers), verifiedBy: quem.get(String(p.id)) ?? null };
    };
    const all = rows.map((r) => withReview(pautaEntry(r, terms)));
    const inWeek = (e: PautaEntry) => e.scheduledFor >= week.weekStarts && e.scheduledFor < week.weekEnds;
    const read = (kind: string) => {
      const r = reads.find((x) => x.kind === kind);
      return { readAt: r ? isoTs(r.read_at) : null, failed: Number(r?.events_failed ?? 0), total: Number(r?.events_total ?? 0) };
    };
    return {
      week,
      plenary: uniqueByKey(all.filter((e) => e.stage === "plenario" && inWeek(e))),
      later: uniqueByKey(all.filter((e) => e.stage === "plenario" && e.scheduledFor >= week.weekEnds)),
      committees: uniqueByKey(all.filter((e) => e.stage === "comissao")),
      exits: uniqueByKey(
        exits
          .filter((r) => r.matched_term && (r.body_kind === "senado" || r.matched_themes))
          .map((r) => withReview({ ...pautaEntry(r, terms), leftAt: isoTs(r.decided_at) })),
      ),
      reads: { camara: read("camara_deputados"), senado: read("senado") },
    } satisfies PautaOverview;
  },

  async getPautaProposal(key) {
    const k = parseProposalKey(key);
    if (!k) return null;
    const kind = k.body === "camara" ? "camara_deputados" : "senado";
    const terms = await ruleTerms();
    // a leitura mais recente em que a proposta apareceu, com o motivo calculado pela regra vigente
    const [last] = await sql`
      with rule as (select * from pocket_rules order by version desc limit 1)
      select i.*, b.kind as body_kind, r.read_at as item_read_at,
             substring(f_unaccent(lower(coalesce(i.summary_official, ''))) from rule.term_pattern) as matched_term,
             (select array_agg(distinct th) from unnest(i.official_themes) th, topics t
               where t.slug = any (rule.topic_slugs) and th = any (t.keywords)) as matched_themes
      from pauta_items i join pauta_reads r on r.id = i.read_id join legislative_bodies b on b.id = i.body_id cross join rule
      where b.kind = ${kind} and i.prop_type = ${k.type} and i.prop_number = ${k.number} and i.prop_year = ${k.year}
      order by r.read_at desc, i.scheduled_for limit 1`;
    if (!last || !last.matched_term || (k.body === "camara" && !last.matched_themes)) return null;
    const entry = pautaEntry(last, terms);
    const current = await sql`
      select c.*, b.kind as body_kind, i.proposal_url from pauta_current c join legislative_bodies b on b.id = c.body_id
      join pauta_items i on i.id = c.id
      where b.kind = ${kind} and c.prop_type = ${k.type} and c.prop_number = ${k.number} and c.prop_year = ${k.year}
      order by c.scheduled_for`;
    let status: PautaStatus = { kind: "na_pauta" };
    if (current.length === 0) {
      const [x] = await sql`
        select e.outcome, e.decided_at, e.last_seen_at from pauta_exits e join legislative_bodies b on b.id = e.body_id
        where b.kind = ${kind} and e.prop_type = ${k.type} and e.prop_number = ${k.number} and e.prop_year = ${k.year}
        order by e.scheduled_for desc limit 1`;
      const o = x?.outcome as string | undefined;
      status =
        o === "saiu_da_pauta" ? { kind: "saiu", at: isoTs(x!.decided_at) }
        : o === "reuniao_encerrada" ? { kind: "reuniao_encerrada", at: isoTs(x!.decided_at) }
        : o === "reuniao_cancelada" ? { kind: "reuniao_cancelada", at: isoTs(x!.decided_at) }
        : { kind: "sem_leitura", lastSeenAt: isoTs(last.item_read_at) };
    }
    const [readRow] = await sql`
      select r.read_at from pauta_reads r join legislative_bodies b on b.id = r.body_id where b.kind = ${kind} order by r.read_at desc limit 1`;
    const [prop] = await sql`
      select p.id, p.presented_on, p.url from proposals p join legislative_bodies b on b.id = p.body_id
      where b.kind = ${kind} and p.type = ${k.type} and p.number = ${k.number} and p.year = ${k.year}`;
    // página + total na mesma consulta (count(*) over ()): sem N+1. Autoria principal primeiro (o papel é dito na tela),
    // depois nome em ordem alfabética; votações da mais recente para a mais antiga, id como desempate estável.
    const authors = prop
      ? await sql`
          select pe.slug, pe.display_name, a.role, count(*) over () as total from proposal_authors a join people pe on pe.id = a.person_id
          where a.proposal_id = ${prop.id}::uuid and a.role in ('principal', 'coautoria')
          order by (a.role = 'principal') desc, pe.display_name collate pt_br, pe.slug limit ${MAX_AUTORES}`
      : [];
    // campo legado `authors` (v1 /proposta): a ordem e o corte da main (ordem de assinatura), sem mudar o que o v1 mostra
    const authorsLegado = prop
      ? await sql`
          select pe.slug, pe.display_name, a.role from proposal_authors a join people pe on pe.id = a.person_id
          where a.proposal_id = ${prop.id}::uuid and a.role in ('principal', 'coautoria')
          order by (a.role = 'principal') desc, a.sign_order nulls last, pe.display_name collate pt_br limit 20`
      : [];
    const votes = prop
      ? await sql`
          select id, occurred_at, description, result, yes_count, no_count, count(*) over () as total from voting_events
          where proposal_id = ${prop.id}::uuid order by occurred_at desc, id limit ${MAX_VOTACOES}`
      : [];
    const autores = lista(
      authors.map((a) => ({ slug: String(a.slug), name: String(a.display_name), role: a.role as "principal" | "coautoria" })),
      Number(authors[0]?.total ?? 0),
    );
    const votacoes = lista(
      votes.map((v) => ({
        id: String(v.id),
        occurredAt: isoTs(v.occurred_at),
        description: String(v.description),
        result: (v.result as string | null) ?? null,
        yes: v.yes_count as number | null,
        no: v.no_count as number | null,
      })),
      Number(votes[0]?.total ?? 0),
    );
    const [pubRow] = await sql`
      select a.id, a.answers, a.reviewed_at, a.source_url, a.correction_note, prev.answers as prev_answers
      from answer_drafts a join legislative_bodies b on b.id = a.body_id
      left join answer_drafts prev on prev.id = a.replaces_id
      where b.kind = ${kind} and a.prop_type = ${k.type} and a.prop_number = ${k.number} and a.prop_year = ${k.year} and a.status = 'publicado'`;
    const quemConferiu = pubRow ? ((await verifiedByOf([String(pubRow.id)])).get(String(pubRow.id)) ?? null) : null;
    const answers: PublishedAnswers | null = pubRow
      ? {
          reviewedAt: isoTs(pubRow.reviewed_at),
          verifiedBy: quemConferiu,
          sourceUrl: String(pubRow.source_url),
          fields: claims(pubRow.answers),
          correction: pubRow.prev_answers
            ? { correctedAt: isoTs(pubRow.reviewed_at), note: String(pubRow.correction_note), previous: claims(pubRow.prev_answers) }
            : null,
        }
      : null;
    return {
      entry: answers?.fields.o_que_propoe.says
        ? { ...entry, reviewedAt: answers.reviewedAt, plain: answers.fields.o_que_propoe.text, verifiedBy: answers.verifiedBy }
        : entry,
      answers,
      status,
      schedule: current.map((r) => pautaEntry(r, terms)),
      readAt: readRow ? isoTs(readRow.read_at) : null,
      fichaUrl: (current[0]?.proposal_url as string | null) ?? (last.proposal_url as string | null) ?? (prop?.url as string | null) ?? null,
      presentedOn: prop?.presented_on ? iso(prop.presented_on) : null,
      authors: authorsLegado.map((a) => ({ slug: String(a.slug), name: String(a.display_name), role: a.role as "principal" | "coautoria" })),
      votes: votacoes.itens,
      autores,
      votacoes,
    } satisfies PautaProposal;
  },

  async listCorrections() {
    const rows = await sql`
      select b.kind, a.prop_type, a.prop_number, a.prop_year, a.reviewed_at, a.correction_note, a.answers, prev.answers as prev_answers
      from answer_drafts a join answer_drafts prev on prev.id = a.replaces_id join legislative_bodies b on b.id = a.body_id
      where a.status in ('publicado', 'substituido') order by a.reviewed_at desc limit 200`;
    return rows.map<Correction>((r) => {
      const after = claims(r.answers);
      const before = claims(r.prev_answers);
      const e = { type: String(r.prop_type), number: Number(r.prop_number), year: Number(r.prop_year) };
      return {
        key: proposalKey(r.kind === "senado" ? "senado" : "camara", e.type, e.number, e.year),
        label: label(e),
        correctedAt: isoTs(r.reviewed_at),
        note: String(r.correction_note),
        changed: ANSWER_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => ({ field: f, before: before[f], after: after[f] })),
      };
    });
  },
  async listPocketRules() {
    const rows = await sql`
      select r.version, r.terms, r.published_on,
             (select array_agg(distinct th order by th) from topics t, unnest(t.keywords) th where t.slug = any (r.topic_slugs)) as themes
      from pocket_rules r order by r.version desc`;
    return rows.map<PocketRule>((r) => ({
      version: Number(r.version),
      themes: (r.themes as string[] | null) ?? [],
      terms: r.terms as string[],
      publishedOn: iso(r.published_on),
    }));
  },
};

/**
 * Estatísticas de várias pessoas num período, em três consultas fixas (person_period_stats, mandato com salário vigente,
 * data_coverage dos lugares fora do federal). Mesma regra que getStats sempre teve; `getStats` é o lote de uma pessoa só.
 */
async function statsForPeople(personIds: string[], period: PeriodStats["period"]): Promise<Record<string, PeriodStats>> {
  const ids = uuids(personIds);
  if (!ids.length) return {};
  const [stats, mands] = await Promise.all([
    sql`select * from person_period_stats where person_id = any(${ids}::uuid[]) and period = ${period}`,
    sql`
      select distinct on (m.person_id) m.person_id, o.slug as office, o.level, m.place_id, pl.kind as place_kind, pl.parent_id, m.started_on, sa.amount_cents, sa.is_ceiling
      from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
      left join lateral (select amount_cents, is_ceiling from salaries s where s.office_id = m.office_id and (s.place_id = m.place_id or s.place_id is null) and s.valid_from <= current_date order by s.place_id nulls last, s.valid_from desc limit 1) sa on true
      where m.person_id = any(${ids}::uuid[]) and m.status <> 'eleito_aguardando_posse'
      order by m.person_id, case m.status when 'em_exercicio' then 0 else 1 end, m.started_on desc`,
  ]);
  const placeIds = [...new Set(mands.filter((m) => m.level !== "federal").map((m) => String(m.place_id)))];
  const covs = placeIds.length
    ? await sql`select place_id, dataset, status, reason from data_coverage where place_id = any(${placeIds}::uuid[]) and status <> 'no_site' order by dataset`
    : [];
  const sOf = new Map(stats.map((s) => [String(s.person_id), s]));
  const mOf = new Map(mands.map((m) => [String(m.person_id), m]));
  const out: Record<string, PeriodStats> = {};
  for (const id of ids) {
    const m = mOf.get(id);
    out[id] = statsFrom(period, sOf.get(id), m, m ? covs.filter((c) => String(c.place_id) === String(m.place_id)) : []);
  }
  return out;
}

function statsFrom(period: PeriodStats["period"], s: Row | undefined, m: Row | undefined, cov: Row[]): PeriodStats {
    const missing: MissingDataset[] = [];
    const executive = !!m && EXECUTIVE.has(m.office as OfficeSlug);
    if (m && m.level === "federal" && !executive) {
      // o que o ETL federal ainda não carrega para esta casa (ex.: proposições e CEAPS do Senado): vem do derive.stats
      const FEDERAL_REASON: Record<string, string> = {
        propostas: "a carga das matérias de autoria no Senado entra na próxima fase",
        gastos_gabinete: "a carga da CEAPS (cota do Senado) entra na próxima fase",
        presenca: "o Senado não publica a lista de presença por senador",
        votos: "ainda não carregado para esta casa",
      };
      for (const d of (s?.missing_datasets as string[] | undefined) ?? [])
        missing.push({ dataset: toDataset(d), label: DATASET_LABEL[d] ?? d, status: "carregando", reason: FEDERAL_REASON[d] ?? "carga pendente" });
    }
    if (m && m.level !== "federal") {
      // cobertura do lugar (UF ou município), filtrada pelo que ESTE cargo tem: Executivo não tem presença, votos,
      // propostas nem cota de gabinete; cada cargo só vê a pendência do próprio salário (D04 da auditoria de dados)
      const own = OWN_DATASETS[m.office as OfficeSlug] ?? [];
      missing.push(
        ...cov
          .filter((c) => own.includes(String(c.dataset)))
          .map((c) => ({ dataset: toDataset(String(c.dataset)), label: DATASET_LABEL[String(c.dataset)] ?? String(c.dataset), status: c.status as MissingDataset["status"], reason: String(c.reason) })),
      );
      if ((m.office === "governador" || m.office === "vice_governador") && m.amount_cents == null)
        missing.push({ dataset: "salario", label: "Salário", status: "desconhecido", reason: "fixado por lei de cada estado; ainda não conferimos a lei deste estado" });
    }
    // dado que consta como faltando nunca aparece como número (0 de "não carregado" vira "—")
    const gone = new Set(missing.map((x) => x.dataset));
    const keep = (d: MissingDataset["dataset"], v: number | null) => (gone.has(d) ? null : v);
    // teto (is_ceiling) e "não conferido" nunca juntos: com valor de salário (pago ou teto) na tela, a pendência de salário sai da lista
    if (m?.amount_cents != null) for (let i = missing.length - 1; i >= 0; i--) if (missing[i].dataset === "salario") missing.splice(i, 1);
    const topics = (s?.top_topics as { topic_slug: string; proposals: number }[] | undefined) ?? [];
    return {
      period,
      presencePresent: keep("presenca", num(s?.presence_present)),
      presenceTotal: keep("presenca", num(s?.presence_total)),
      proposalsPrincipal: keep("propostas", num(s?.proposals_principal)),
      proposalsCosigned: keep("propostas", num(s?.proposals_cosigned)),
      votesRegistered: keep("votos", num(s?.votes_registered)),
      expensesCents: keep("gastos_gabinete", num(s?.expenses_cents)),
      salaryMonthlyCents: num(m?.amount_cents),
      salaryIsCeiling: Boolean(m?.is_ceiling),
      topTopics: topics.map((t) => ({ topic: t.topic_slug, count: Number(t.proposals) })),
      partyAligned: num(s?.party_aligned),
      partyAlignmentTotal: num(s?.party_alignment_total),
      missing,
    } satisfies PeriodStats;
}

async function ruleTerms(): Promise<string[]> {
  const [r] = await sql`select terms from pocket_rules order by version desc limit 1`;
  return (r?.terms as string[] | undefined) ?? [];
}

function pautaEntry(r: Record<string, unknown>, terms: string[]): PautaEntry {
  const body = r.body_kind === "senado" ? "senado" : "camara";
  const themes = (r.matched_themes as string[] | null) ?? null;
  return {
    key: proposalKey(body, String(r.prop_type), Number(r.prop_number), Number(r.prop_year)),
    body,
    type: String(r.prop_type),
    number: Number(r.prop_number),
    year: Number(r.prop_year),
    summary: (r.summary_official as string | null) ?? null,
    stage: r.stage === "plenario" ? "plenario" : "comissao",
    committee: (r.committee as string | null) ?? null,
    scheduledFor: isoTs(r.scheduled_for),
    regime: (r.regime as string | null) ?? null,
    rapporteur: (r.rapporteur as string | null) ?? null,
    reason: { theme: body === "camara" && themes?.length ? [...themes].sort((a, b) => a.localeCompare(b, "pt-BR"))[0] : null, term: termLabel(String(r.matched_term ?? ""), terms) },
  };
}

/** JSON do rascunho (campos em português, como o ETL grava) para o tipo da tela. Regras dos três estados: lib/answer-claims.ts. */
const claims = (raw: unknown): Record<AnswerField, AnswerClaim> => claimsFrom(raw);
/** Valor de `answer_drafts.verified_by` fora do domínio: null (não registrado). */
const verifiedBy = (v: unknown): VerifiedBy => (v === "agentes" || v === "pessoa" ? v : null);

/**
 * Quem conferiu cada resposta (`answer_drafts.verified_by`, migração 0130), numa consulta à parte e tolerante:
 * sem a 0130 a coluna não existe (42703) e a consulta falha; aí todos ficam null ("Conferido com o texto oficial", sem
 * dizer por quem) e a página segue. Não usa `to_jsonb(a)`: com a 0131 o web_reader só lê colunas listadas, e a linha
 * inteira daria "permission denied" e derrubaria a pauta.
 */
async function verifiedByOf(ids: string[]): Promise<Map<string, VerifiedBy>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await sql`select id, verified_by from answer_drafts where id = any (${ids}::uuid[])`;
    return new Map(rows.map((r) => [String(r.id), verifiedBy(r.verified_by)]));
  } catch (e) {
    // esperado: coluna inexistente (sem a 0130, 42703) ou sem grant na coluna (42501). Qualquer outro erro é registrado.
    // Nos dois casos a página degrada igual: sem dizer quem conferiu (null), nunca afirmando por quem.
    const code = (e as { code?: unknown } | null)?.code;
    if (code !== "42703" && code !== "42501") console.error("verifiedByOf: leitura de answer_drafts.verified_by falhou", e);
    return new Map();
  }
}
