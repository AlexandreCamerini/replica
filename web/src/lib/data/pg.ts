import "server-only";
import postgres from "postgres";
import type {
  Agreement,
  Candidacy,
  DataSource,
  Expense,
  Level,
  Mandate,
  MissingDataset,
  OfficeSlug,
  Officeholder,
  Page,
  Party,
  PeriodStats,
  Person,
  PersonVote,
  Place,
  Proposal,
  RepresentativeGroup,
  Stamp,
  VoteValue,
  VotingEventDetail,
  VotingEventSummary,
  ActivityItem,
} from "./types";

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
const toDataset = (d: string): MissingDataset["dataset"] =>
  (d.startsWith("salario") ? "salario" : (["presenca", "votos", "propostas", "gastos_gabinete", "patrimonio"].includes(d) ? d : "propostas")) as MissingDataset["dataset"];

type Row = Record<string, unknown>;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
const isoTs = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d ?? ""));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function place(r: Row): Place {
  return { ibge: String(r.ibge_code), kind: r.kind as Place["kind"], name: String(r.name), slug: String(r.slug), uf: (r.uf as string | null) ?? null, region: (r.region as string | null) ?? null };
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
  };
}

// partido mostrado = filiação atual (person_current_party) ou, na falta, o partido na posse
const HOLDER_SELECT = sql`
  select p.id, p.slug, p.display_name, p.civil_name, p.gender, p.birth_date, p.education, b.ibge_code as birthplace_ibge,
         m.id as mandate_id, o.slug as office, o.name_m, o.name_f, o.level, m.status, m.started_on, m.ends_on, m.status_source,
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

function summary(r: Row, body: "camara" | "senado"): VotingEventSummary {
  return {
    id: String(r.id),
    body,
    occurredAt: isoTs(r.occurred_at),
    description: String(r.description),
    topic: (r.topic as string | null) ?? null,
    result: (r.result as "aprovado" | "rejeitado" | null) ?? null,
    yes: Number(r.yes_count ?? 0),
    no: Number(r.no_count ?? 0),
    isNominal: Boolean(r.is_nominal),
    proposal: r.type ? { label: `${r.type} ${r.number}/${r.year}`, summary: String(r.summary_official ?? ""), url: (r.url as string | null) ?? null } : null,
  };
}

export const pgSource: DataSource = {
  isDemo: false,

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
    const [r] = await sql`select ibge_code, kind, name, slug, uf, null as region from places where ibge_code = ${ibge}`;
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
    for (const g of GROUPS) {
      if (g.level === "municipal" && pl.kind !== "municipio") continue;
      const people = rows
        .filter((r) => g.offices.includes(r.office as OfficeSlug) && (g.level === "federal" && g.key === "presidencia" ? r.place_ibge === "BR" : g.level === "municipal" ? r.place_ibge === pl.ibge : r.place_kind === "uf"))
        .sort((a, b) => g.offices.indexOf(a.office as OfficeSlug) - g.offices.indexOf(b.office as OfficeSlug))
        .map(holder);
      if (people.length) groups.push({ key: g.key, title: g.title(pl.uf), level: g.level, where: people[0].placeLabel, people });
    }
    return groups;
  },
  async getCoverage(pl) {
    const rows = await sql`select dataset, status, reason from data_coverage dc join places p on p.id = dc.place_id where p.ibge_code = ${pl.ibge} and dc.status <> 'no_site' order by dataset`;
    return rows.map((r) => ({ dataset: toDataset(String(r.dataset)), label: DATASET_LABEL[String(r.dataset)] ?? String(r.dataset), status: r.status as MissingDataset["status"], reason: String(r.reason) }));
  },
  async getCounters() {
    const rows = await sql`select o.slug, o.level, count(*)::int as n from mandates m join offices o on o.id = m.office_id where m.status = 'em_exercicio' group by 1, 2 order by min(o.slug)`;
    const byLevel: Record<Level, number> = { federal: 0, estadual: 0, municipal: 0 };
    const order = Object.keys(PLURAL) as OfficeSlug[];
    const byOffice = rows
      .map((r) => ({ office: r.slug as OfficeSlug, label: PLURAL[r.slug as OfficeSlug], count: Number(r.n) }))
      .sort((a, b) => order.indexOf(a.office) - order.indexOf(b.office));
    for (const r of rows) byLevel[r.level as Level] += Number(r.n);
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
      order by case m.status when 'em_exercicio' then 0 when 'eleito_aguardando_posse' then 1 when 'licenciado' then 2 else 3 end, m.started_on desc`;
    return rows.map((r) => ({ ...mandate(r), party: party(r), officeName: officeName(r), placeLabel: placeLabel(r) }));
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
    return rows.map((r) => ({
      year: Number(r.year),
      office: r.office as OfficeSlug,
      placeIbge: String(r.place_ibge),
      partyId: String(r.party_id ?? ""),
      result: (r.result as Candidacy["result"]) ?? "nao_eleito",
      votes: num(r.votes),
      raisedCents: num(r.raised_cents),
      spentCents: num(r.spent_cents),
      assetsCents: num(r.assets),
      party: party(r),
      officeName: officeName(r),
      placeLabel: placeLabel(r),
    }));
  },
  async getStats(personId, period) {
    const [s] = await sql`select * from person_period_stats where person_id = ${personId}::uuid and period = ${period}`;
    const [m] = await sql`
      select o.slug as office, o.level, m.place_id, pl.kind as place_kind, pl.parent_id, m.started_on, sa.amount_cents, sa.is_ceiling
      from mandates m join offices o on o.id = m.office_id join places pl on pl.id = m.place_id
      left join lateral (select amount_cents, is_ceiling from salaries s where s.office_id = m.office_id and (s.place_id = m.place_id or s.place_id is null) and s.valid_from <= current_date order by s.place_id nulls last, s.valid_from desc limit 1) sa on true
      where m.person_id = ${personId}::uuid and m.status <> 'eleito_aguardando_posse'
      order by case m.status when 'em_exercicio' then 0 else 1 end, m.started_on desc limit 1`;
    const missing: MissingDataset[] = [];
    if (m && m.level === "federal") {
      // o que o ETL federal ainda não carrega para esta casa (ex.: proposições e CEAPS do Senado): vem do derive.stats
      const FEDERAL_REASON: Record<string, string> = {
        propostas: "a carga das matérias de autoria no Senado entra na próxima fase",
        gastos_gabinete: "a carga da CEAPS (cota do Senado) entra na próxima fase",
        presenca: "ainda não carregado para esta casa",
        votos: "ainda não carregado para esta casa",
      };
      for (const d of (s?.missing_datasets as string[] | undefined) ?? [])
        missing.push({ dataset: toDataset(d), label: DATASET_LABEL[d] ?? d, status: "carregando", reason: FEDERAL_REASON[d] ?? "carga pendente" });
    }
    if (m && m.level !== "federal") {
      // cobertura do lugar: UF para deputados estaduais, município para vereadores/prefeitos
      const cov = await sql`select dataset, status, reason from data_coverage where place_id = ${m.place_id as string}::uuid and status <> 'no_site' order by dataset`;
      const relevant = cov.filter((c) => (m.level === "estadual" ? !String(c.dataset).includes("prefeito") && !String(c.dataset).includes("vereador") : !String(c.dataset).includes("estaduais")));
      missing.push(...relevant.map((c) => ({ dataset: toDataset(String(c.dataset)), label: DATASET_LABEL[String(c.dataset)] ?? String(c.dataset), status: c.status as MissingDataset["status"], reason: String(c.reason) })));
    }
    const topics = (s?.top_topics as { topic_slug: string; proposals: number }[] | undefined) ?? [];
    return {
      period,
      presencePresent: num(s?.presence_present),
      presenceTotal: num(s?.presence_total),
      proposalsPrincipal: num(s?.proposals_principal),
      proposalsCosigned: num(s?.proposals_cosigned),
      votesRegistered: num(s?.votes_registered),
      expensesCents: num(s?.expenses_cents),
      salaryMonthlyCents: num(m?.amount_cents),
      salaryIsCeiling: Boolean(m?.is_ceiling),
      topTopics: topics.map((t) => ({ topic: t.topic_slug, count: Number(t.proposals) })),
      partyAligned: num(s?.party_aligned),
      partyAlignmentTotal: num(s?.party_alignment_total),
      missing,
    } satisfies PeriodStats;
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
      ${f.type ? sql`and p.can_become_law = ${f.type === "lei"}` : sql``}
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
        status: String(r.status ?? "Em tramitação"),
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
    const where = sql`v.person_id = ${personId}::uuid and e.is_nominal
      ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
      ${f.value ? sql`and v.value = ${f.value}` : sql``}
      ${f.topic ? sql`and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id and t.slug = ${f.topic})` : sql``}
      ${q ? sql`and f_unaccent(lower(e.description)) like '%' || f_unaccent(lower(${q})) || '%'` : sql``}`;
    const [{ n }] = await sql`select count(*)::int as n from votes v join voting_events e on e.id = v.voting_event_id where ${where}`;
    const rows = await sql`
      select e.id, b.kind as body, e.occurred_at, e.result, e.yes_count, e.no_count, v.value, v.party_id,
             -- a Câmara publica só o placar na descrição; a proposição votada dá o assunto
             case when pr.id is not null then pr.type || ' ' || pr.number || '/' || pr.year || ' — ' || left(pr.summary_official, 220) || ' · ' || e.description else e.description end as description,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      from votes v join voting_events e on e.id = v.voting_event_id join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
      where ${where}
      order by e.occurred_at desc limit ${limit} offset ${offset}`;
    return page(
      rows.map<PersonVote>((r) => ({
        event: {
          id: String(r.id),
          body: r.body === "senado" ? "senado" : "camara",
          occurredAt: isoTs(r.occurred_at),
          description: String(r.description),
          topic: (r.topic as string | null) ?? null,
          result: (r.result as "aprovado" | "rejeitado" | null) ?? null,
          yes: Number(r.yes_count ?? 0),
          no: Number(r.no_count ?? 0),
        },
        value: r.value as VoteValue,
        partyId: String(r.party_id ?? ""),
      })),
      Number(n),
      offset,
      limit,
    );
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
    const where = sql`b.kind = ${kind} and e.is_nominal
      ${f.year ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${f.year}` : sql``}
      ${f.result ? sql`and e.result = ${f.result}` : sql``}
      ${q ? sql`and (f_unaccent(lower(e.description)) like '%' || f_unaccent(lower(${q})) || '%' or f_unaccent(lower(coalesce(pr.summary_official, ''))) like '%' || f_unaccent(lower(${q})) || '%' or lower(coalesce(pr.type || ' ' || pr.number, '')) like '%' || lower(${q}) || '%')` : sql``}`;
    const from = sql`from voting_events e join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id`;
    const [{ n }] = await sql`select count(*)::int as n ${from} where ${where}`;
    const rows = await sql`
      select e.id, e.occurred_at, e.description, e.result, e.yes_count, e.no_count, e.is_nominal,
             pr.type, pr.number, pr.year, pr.summary_official, pr.url,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      ${from} where ${where} order by e.occurred_at desc, e.id limit ${limit} offset ${offset}`;
    const years = await sql`select distinct extract(year from e.occurred_at at time zone 'America/Sao_Paulo')::int as y
      from voting_events e join legislative_bodies b on b.id = e.body_id where b.kind = ${kind} and e.is_nominal order by 1 desc`;
    return { ...page(rows.map((r) => summary(r, f.body)), Number(n), offset, limit), years: years.map((y) => Number(y.y)) };
  },
  async getVotingEvent(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const [r] = await sql`
      select e.id, e.occurred_at, e.description, e.result, e.yes_count, e.no_count, e.is_nominal, b.kind as body,
             pr.type, pr.number, pr.year, pr.summary_official, pr.url,
             (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
      from voting_events e join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
      where e.id = ${id}::uuid`;
    if (!r) return null;
    const votes = await sql`
      select p.slug, p.display_name, coalesce(pa.acronym, '—') as party, pl.uf, v.value
      from votes v join people p on p.id = v.person_id
      left join parties pa on pa.id = v.party_id
      left join lateral (select pl.uf from mandates m join places pl on pl.id = m.place_id where m.person_id = p.id order by m.started_on desc limit 1) pl on true
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
    return {
      ...summary(r, r.body === "senado" ? "senado" : "camara"),
      counts,
      orientations: orientations.map((o) => ({ label: String(o.label), kind: o.kind as VotingEventDetail["orientations"][number]["kind"], value: o.orientation as VotingEventDetail["orientations"][number]["value"] })),
      // partidos em ordem alfabética: nunca por tamanho nem por "fidelidade"
      byParty: [...parties.values()].sort((a, b) => a.party.localeCompare(b.party, "pt-BR")),
      votes: votes.map((v) => ({ slug: String(v.slug), name: String(v.display_name), party: String(v.party), uf: (v.uf as string | null) ?? null, value: v.value as VoteValue })),
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
  async latestRefresh() {
    const [r] = await sql`select max(refreshed_at) as at from dataset_stamps`;
    return r?.at ? isoTs(r.at) : new Date(0).toISOString();
  },
};
