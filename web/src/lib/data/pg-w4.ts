import "server-only";
import postgres from "postgres";
import type { ElectionResult, OfficeSlug } from "./types";
import type { DataSourceW4, ElectionCandidate, IndicatorKey, PartyRow, TaxLine, YearIndicators } from "./types-w4";

// Consultas da onda W4. Mesmo pool de pg.ts (um por processo). Listas ordenam por nome (A–Z), nunca por métrica;
// a única exceção é a ordem por votos dentro de uma disputa, que é o próprio resultado da urna.
const g = globalThis as unknown as { __pgPool?: ReturnType<typeof postgres> };
const sql = (g.__pgPool ??= postgres(process.env.DATABASE_URL ?? "", {
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  transform: { undefined: null },
}));

const OFFICE_LABEL: Partial<Record<OfficeSlug, string>> = {
  presidente: "Presidente",
  governador: "Governador",
  senador: "Senador",
  deputado_federal: "Deputado federal",
  deputado_estadual: "Deputado estadual",
  deputado_distrital: "Deputado distrital",
  prefeito: "Prefeito",
  vereador: "Vereador",
};
const OFFICE_ORDER = Object.keys(OFFICE_LABEL) as OfficeSlug[];
export const ELECTION_OFFICES = OFFICE_ORDER;

/** BUG-017: o ETL de votos somou `_BRASIL.csv` e `_BR.csv`, e a eleição presidencial está nos dois: voto de presidente fica em dobro no banco.
 *  Até a recarga, o app não mostra voto de presidente (nem o de vice). Os demais cargos foram conferidos (ex.: Boulos, dep. federal 2022 = 1.001.472). */
const VOTES_UNRELIABLE = new Set<OfficeSlug>(["presidente", "vice_presidente"]);

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export const pgW4: DataSourceW4 = {
  async listElectionYears() {
    const rows = await sql`select year::int as year, kind, array_agg(distinct round order by round) as rounds from elections where kind in ('geral','municipal') group by 1, 2 order by 1 desc`;
    return rows.map((r) => ({ year: Number(r.year), kind: r.kind as "geral" | "municipal", rounds: (r.rounds as number[]).map(Number) }));
  },
  async getElectionOverview(year) {
    const rows = await sql`
      select o.slug, e.round::int as round, count(distinct ct.id)::int as contests, count(c.id)::int as cands,
             count(c.id) filter (where c.result like 'eleito%')::int as elected
      from elections e
      join contests ct on ct.election_id = e.id
      join offices o on o.id = ct.office_id and o.slug = any(${OFFICE_ORDER as string[]})
      left join candidacies c on c.contest_id = ct.id
      where e.year = ${year} and e.kind in ('geral','municipal')
      group by 1, 2`;
    return rows
      .map((r) => ({ office: r.slug as OfficeSlug, label: OFFICE_LABEL[r.slug as OfficeSlug] ?? String(r.slug), round: Number(r.round), contests: Number(r.contests), candidacies: Number(r.cands), elected: Number(r.elected) }))
      .sort((a, b) => OFFICE_ORDER.indexOf(a.office) - OFFICE_ORDER.indexOf(b.office) || a.round - b.round);
  },
  async listElectionContests(f) {
    const limit = Math.min(f.limit ?? 60, 200);
    const offset = f.offset ?? 0;
    const place = f.ibge ? sql`and pl.ibge_code = ${f.ibge}` : f.uf ? sql`and pl.uf = ${f.uf}` : sql``;
    const round = f.round ? sql`and e.round = ${f.round}` : sql``;
    const base = sql`from contests ct join elections e on e.id = ct.election_id join offices o on o.id = ct.office_id join places pl on pl.id = ct.place_id
      where e.year = ${f.year} and o.slug = ${f.office} and e.kind in ('geral','municipal') ${place} ${round}`;
    const [{ n }] = await sql`select count(*)::int as n ${base}`;
    const contests = await sql`
      select ct.id, e.round::int as round, pl.ibge_code, pl.name, pl.uf ${base}
      order by e.round, pl.name collate pt_br limit ${limit} offset ${offset}`;
    if (!contests.length) return { items: [], total: Number(n) };
    const ids = contests.map((c) => String(c.id));
    const cands = await sql`
      select c.contest_id, p.slug, c.ballot_name, c.ballot_number, coalesce(pa.acronym, '—') as party, c.result, c.votes
      from candidacies c join people p on p.id = c.person_id left join parties pa on pa.id = c.party_id
      where c.contest_id = any(${ids}::uuid[])
      order by c.votes desc nulls last, c.ballot_name collate pt_br`;
    const by = new Map<string, ElectionCandidate[]>();
    for (const c of cands) {
      const arr = by.get(String(c.contest_id)) ?? [];
      arr.push({
        slug: String(c.slug),
        name: String(c.ballot_name),
        number: c.ballot_number == null ? null : Number(c.ballot_number),
        party: String(c.party),
        result: (c.result as ElectionResult | null) ?? null,
        votes: VOTES_UNRELIABLE.has(f.office) || c.votes == null ? null : Number(c.votes),
      });
      by.set(String(c.contest_id), arr);
    }
    return {
      total: Number(n),
      items: contests.map((c) => {
        const cs = by.get(String(c.id)) ?? [];
        return {
          office: f.office,
          label: OFFICE_LABEL[f.office] ?? f.office,
          round: Number(c.round),
          placeIbge: String(c.ibge_code),
          placeName: String(c.name),
          uf: (c.uf as string | null) ?? null,
          candidates: cs,
          elected: cs.filter((x) => x.result?.startsWith("eleito")).length,
        };
      }),
    };
  },

  async listYearlyIndicators() {
    const rows = await sql`select indicator, year::int as year, value::float8 as value, series_ref from w4_yearly_indicators order by year`;
    const byYear = new Map<number, YearIndicators>();
    const refs = new Map<string, Set<string>>();
    for (const r of rows) {
      const y = Number(r.year);
      const e = byYear.get(y) ?? { year: y, values: {} };
      e.values[r.indicator as IndicatorKey] = Number(r.value);
      byYear.set(y, e);
      const s = refs.get(String(r.indicator)) ?? new Set();
      s.add(String(r.series_ref));
      refs.set(String(r.indicator), s);
    }
    return {
      rows: [...byYear.values()].sort((a, b) => a.year - b.year),
      refs: [...refs.entries()].map(([k, v]) => ({ key: k as IndicatorKey, unit: "", seriesRefs: [...v].sort() })),
    };
  },

  async listTaxYears() {
    const rows = await sql`select year::int as year, max(month)::int as last from w4_tax_revenue group by 1 order by 1 desc`;
    return { years: rows.map((r) => Number(r.year)), lastMonth: Object.fromEntries(rows.map((r) => [Number(r.year), Number(r.last)])) };
  },
  async getTaxByUf(year) {
    const rows = await sql`
      select t.uf, coalesce(p.name, t.uf) as name, sum(t.amount_cents)::bigint as total
      from w4_tax_revenue t left join places p on p.kind = 'uf' and p.uf = t.uf
      where t.year = ${year} group by 1, 2 order by coalesce(p.name, t.uf) collate pt_br`;
    return rows.map((r) => ({ uf: String(r.uf), ufName: String(r.name), totalCents: Number(r.total) }));
  },
  async getTaxByMonth(year, uf) {
    const rows = await sql`select month::int as month, sum(amount_cents)::bigint as total from w4_tax_revenue where year = ${year} ${uf ? sql`and uf = ${uf}` : sql``} group by 1 order by 1`;
    return rows.map((r) => ({ month: Number(r.month), totalCents: Number(r.total) }));
  },
  async getTaxLines(year, uf) {
    const rows = await sql`select tax, sum(amount_cents)::bigint as total from w4_tax_revenue where year = ${year} ${uf ? sql`and uf = ${uf}` : sql``} group by tax order by tax collate pt_br`;
    return rows.map((r): TaxLine => ({ tax: String(r.tax), totalCents: Number(r.total) }));
  },

  async listPartyRows() {
    const parties = await sql`
      select pa.id, pa.acronym, pa.name, pa.tse_number
      from parties pa
      where pa.valid_to is null and exists (select 1 from mandates m where m.party_id = pa.id and m.status = 'em_exercicio')
      order by pa.acronym collate pt_br`;
    // cadeiras: a mesma regra do hemiciclo (partido atual da pessoa; senão o do mandato)
    const seats = await sql`
      select coalesce(cp.party_id, m.party_id) as party_id, b.kind, count(*)::int as n
      from mandates m join legislative_bodies b on b.id = m.body_id and b.kind in ('camara_deputados','senado')
      left join person_current_party cp on cp.person_id = m.person_id
      where m.status = 'em_exercicio' group by 1, 2`;
    // alinhamento: votações em que o governo e o partido deram orientação sim/não; coincidiu = mesma orientação. Governo pelo ano da votação.
    const align = await sql`
      with gov as (
        select distinct po.voting_event_id as ve, po.orientation as g
        from party_orientations po join orientation_actors a on a.id = po.actor_id and a.kind = 'governo'
        where po.orientation in ('sim','nao')),
      par as (
        select distinct a.party_id, po.voting_event_id as ve, po.orientation as o
        from party_orientations po join orientation_actors a on a.id = po.actor_id and a.kind = 'partido' and a.party_id is not null
        where po.orientation in ('sim','nao'))
      select par.party_id, case when ve.occurred_at < '2023-01-01' then 'bolsonaro' else 'lula' end as gov,
             count(*)::int as n, count(*) filter (where par.o = gov.g)::int as same
      from par join gov on gov.ve = par.ve join voting_events ve on ve.id = par.ve
      group by 1, 2`;
    const wins = await sql`
      select case when ve.occurred_at < '2023-01-01' then 'bolsonaro' else 'lula' end as gov,
             min(extract(year from ve.occurred_at))::int as first, max(extract(year from ve.occurred_at))::int as last, count(distinct ve.id)::int as n
      from party_orientations po join orientation_actors a on a.id = po.actor_id and a.kind = 'governo' join voting_events ve on ve.id = po.voting_event_id
      where po.orientation in ('sim','nao') group by 1 order by 2`;
    const rows: PartyRow[] = parties.map((p) => {
      const mine = seats.filter((s) => String(s.party_id) === String(p.id));
      return {
        id: String(p.id),
        acronym: String(p.acronym),
        name: String(p.name),
        number: p.tse_number == null ? null : Number(p.tse_number),
        seatsCamara: Number(mine.find((s) => s.kind === "camara_deputados")?.n ?? 0),
        seatsSenado: Number(mine.find((s) => s.kind === "senado")?.n ?? 0),
        alignment: align.filter((a) => String(a.party_id) === String(p.id)).map((a) => ({ gov: a.gov as "bolsonaro" | "lula", n: Number(a.n), same: Number(a.same) })),
      };
    });
    return { rows, windows: wins.map((w) => ({ gov: w.gov as "bolsonaro" | "lula", firstYear: Number(w.first), lastYear: Number(w.last), votings: Number(w.n) })) };
  },
};
