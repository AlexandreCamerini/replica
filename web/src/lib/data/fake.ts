import {
  EXPENSE_CATEGORIES,
  MUNICIPALITY_ROWS,
  OFFICES,
  PLURAL,
  SOURCES,
  TOPICS,
  UF_ROWS,
  buildPlaces,
  fold,
  officeBySlug,
  slugify,
  stateSeats,
  topicName,
} from "./reference";
import type {
  Agreement,
  Candidacy,
  DataSource,
  ElectionResult,
  Expense,
  Level,
  CoverageStatus,
  Mandate,
  MandateStatus,
  MissingDataset,
  OfficeSlug,
  Officeholder,
  Page,
  Party,
  Person,
  PersonVote,
  Place,
  Proposal,
  RepresentativeGroup,
  VoteValue,
  VotingEvent,
  VotingEventDetail,
  VotingEventSummary,
  ActivityItem,
} from "./types";

import { houseName } from "./assembleias";

// Camada de dados de DEMONSTRAÇÃO. Pessoas, partidos e números são fictícios e determinísticos (mesma seed, mesmo resultado).
// Lugares e tamanhos de bancada são reais. Trocar por pg.ts não muda nenhuma tela: o contrato é DataSource.

const TODAY = "2026-11-02";
const CURRENT_YEAR = 2026;

// ---------- PRNG determinístico ----------
function seedOf(s: string) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
type Rng = () => number;
function rng(seed: string): Rng {
  let a = seedOf(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length)];
const between = (r: Rng, min: number, max: number) => Math.floor(min + r() * (max - min + 1));
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ---------- nomes fictícios ----------
const FIRST_F = ["Ana", "Beatriz", "Camila", "Daniela", "Elisa", "Fernanda", "Gabriela", "Helena", "Isabel", "Joana", "Larissa", "Marta", "Natália", "Olívia", "Patrícia", "Renata", "Sílvia", "Tereza", "Vânia", "Yara", "Lúcia", "Rosana", "Cíntia", "Débora"];
const FIRST_M = ["André", "Bruno", "Carlos", "Diego", "Eduardo", "Fábio", "Gustavo", "Henrique", "Igor", "João", "Leandro", "Marcelo", "Nelson", "Otávio", "Paulo", "Rafael", "Sérgio", "Tiago", "Vítor", "Wagner", "Rogério", "Caio", "Álvaro", "Davi"];
const LAST = ["Almeida", "Barros", "Cardoso", "Dias", "Esteves", "Freitas", "Gomes", "Holanda", "Lacerda", "Machado", "Nogueira", "Pacheco", "Queiroz", "Rezende", "Siqueira", "Teixeira", "Valente", "Xavier", "Moura", "Brandão", "Coutinho", "Fontes", "Leal", "Pires", "Sampaio", "Toledo", "Vasques", "Aguiar", "Bezerra", "Campos"];
const EDUCATION = ["Superior completo", "Superior completo", "Ensino médio completo", "Pós-graduação", "Superior incompleto"];

const PARTIES: Party[] = [
  { id: "aur", acronym: "AUR", name: "Partido Aurora" },
  { id: "bri", acronym: "BRI", name: "Partido Brisa" },
  { id: "cer", acronym: "CER", name: "Partido Cerrado" },
  { id: "del", acronym: "DEL", name: "Partido Delta" },
  { id: "ens", acronym: "ENS", name: "Partido Enseada" },
  { id: "far", acronym: "FAR", name: "Partido Farol" },
  { id: "gar", acronym: "GAR", name: "Partido Garoa" },
  { id: "hor", acronym: "HOR", name: "Partido Horizonte" },
];
const partyById = Object.fromEntries(PARTIES.map((p) => [p.id, p])) as Record<string, Party>;

// ---------- montagem do acervo ----------
type Store = {
  places: Place[];
  placeByIbge: Map<string, Place>;
  people: Person[];
  personById: Map<string, Person>;
  personBySlug: Map<string, Person>;
  redirects: Map<string, string>;
  mandates: Mandate[];
  mandatesByPerson: Map<string, Mandate[]>;
  candidaciesByPerson: Map<string, Candidacy[]>;
  partyOf: Map<string, string>;
  vereadoresOf: Map<string, number>;
};

type Term = { start: string; end: string; status: MandateStatus };
const LEG_TERM: Term = { start: "2023-02-01", end: "2027-02-01", status: "em_exercicio" };
const LEG_NEXT: Term = { start: "2027-02-01", end: "2031-02-01", status: "eleito_aguardando_posse" };
const LEG_PREV: Term = { start: "2019-02-01", end: "2023-02-01", status: "encerrado" };

function build(): Store {
  const places = buildPlaces();
  const s: Store = {
    places,
    placeByIbge: new Map(places.map((p) => [p.ibge, p])),
    people: [],
    personById: new Map(),
    personBySlug: new Map(),
    redirects: new Map(),
    mandates: [],
    mandatesByPerson: new Map(),
    candidaciesByPerson: new Map(),
    partyOf: new Map(),
    vereadoresOf: new Map(MUNICIPALITY_ROWS.map((m) => [m[0], m[3]])),
  };
  const ufIbge = Object.fromEntries(UF_ROWS.map((u) => [u[1], u[0]]));
  const munisOf = (uf: string) => MUNICIPALITY_ROWS.filter((m) => m[2] === uf).map((m) => m[0]);

  const addPerson = (key: string, uf: string | null, forcedName?: string): Person => {
    const r = rng(`person:${key}`);
    const roll = r();
    // nome forçado (caso de borda) é feminino; o resto sorteia
    const gender: "f" | "m" = forcedName || roll < 0.36 ? "f" : "m";
    const first = pick(r, gender === "f" ? FIRST_F : FIRST_M);
    const l1 = pick(r, LAST);
    let l2 = pick(r, LAST);
    if (l2 === l1) l2 = LAST[(LAST.indexOf(l1) + 7) % LAST.length];
    const displayName = forcedName ?? `${first} ${l2}`;
    let slug = slugify(displayName);
    if (s.personBySlug.has(slug)) slug = `${slug}-${(uf ?? "br").toLowerCase()}`;
    for (let n = 2; s.personBySlug.has(slug); n++) slug = `${slugify(displayName)}-${(uf ?? "br").toLowerCase()}-${n}`;
    const birthYear = between(r, 1952, 1996);
    const munis = uf ? munisOf(uf) : [];
    const p: Person = {
      id: `p${s.people.length + 1}`,
      slug,
      displayName,
      civilName: forcedName ?? `${first} ${l1} ${l2}`,
      gender,
      birthDate: r() < 0.97 ? iso(birthYear, between(r, 1, 12), between(r, 1, 28)) : null,
      birthplaceIbge: munis.length && r() < 0.5 ? pick(r, munis) : uf ? ufIbge[uf] : null,
      education: pick(r, EDUCATION),
    };
    s.people.push(p);
    s.personById.set(p.id, p);
    s.personBySlug.set(p.slug, p);
    // partido: alguns partidos maiores, sem significado
    s.partyOf.set(p.id, PARTIES[Math.min(PARTIES.length - 1, Math.floor(r() ** 1.6 * PARTIES.length))].id);
    return p;
  };

  const addMandate = (p: Person, office: OfficeSlug, placeIbge: string, t: Term) => {
    const m: Mandate = {
      id: `m${s.mandates.length + 1}`,
      personId: p.id,
      office,
      placeIbge,
      partyId: s.partyOf.get(p.id)!,
      status: t.status,
      startedOn: t.start,
      endsOn: t.end,
      statusSource: "tse",
    };
    s.mandates.push(m);
    const list = s.mandatesByPerson.get(p.id) ?? [];
    list.push(m);
    s.mandatesByPerson.set(p.id, list);
  };

  const VOTES_RANGE: Record<OfficeSlug, [number, number]> = {
    presidente: [48_000_000, 62_000_000],
    vice_presidente: [48_000_000, 62_000_000],
    governador: [800_000, 12_000_000],
    vice_governador: [800_000, 12_000_000],
    senador: [600_000, 9_000_000],
    deputado_federal: [40_000, 900_000],
    deputado_estadual: [18_000, 320_000],
    deputado_distrital: [12_000, 90_000],
    prefeito: [8_000, 3_400_000],
    vice_prefeito: [8_000, 3_400_000],
    vereador: [900, 120_000],
  };
  const addCandidacy = (p: Person, year: number, office: OfficeSlug, placeIbge: string, result: ElectionResult, r: Rng, assetsBase: { v: number }) => {
    const [vmin, vmax] = VOTES_RANGE[office];
    const won = result.startsWith("eleito");
    const votes = Math.round((vmin + r() ** 2 * (vmax - vmin)) * (won ? 1 : 0.35));
    assetsBase.v = Math.round(assetsBase.v * (1 + r() * 0.5));
    const raised = Math.round((votes * (2 + r() * 8)) * 100);
    const c: Candidacy = {
      year,
      office,
      placeIbge,
      partyId: s.partyOf.get(p.id)!,
      result,
      votes,
      raisedCents: r() < 0.95 ? raised : null,
      spentCents: r() < 0.95 ? Math.round(raised * (0.8 + r() * 0.19)) : null,
      assetsCents: r() < 0.93 ? assetsBase.v : null,
    };
    const list = s.candidaciesByPerson.get(p.id) ?? [];
    list.push(c);
    s.candidaciesByPerson.set(p.id, list);
  };

  const seat = (key: string, office: OfficeSlug, placeIbge: string, uf: string | null, plan: { term: Term; next?: Term; prevChance?: number; nextChance?: number; elected: number; nextYear: number; prevYear: number }, forcedName?: string) => {
    const p = addPerson(key, uf, forcedName);
    const r = rng(`career:${key}`);
    const assets = { v: between(r, 3, 400) * 1_000_000 }; // centavos: R$ 30 mil a R$ 4 mi
    if (plan.prevChance && r() < plan.prevChance) {
      addCandidacy(p, plan.prevYear, office, placeIbge, "eleito", r, assets);
      if (office === "deputado_federal" || office === "deputado_estadual" || office === "deputado_distrital")
        addMandate(p, office, placeIbge, LEG_PREV);
    }
    addCandidacy(p, plan.elected, office, placeIbge, pick(r, ["eleito", "eleito", "eleito_qp", "eleito_media"] as const), r, assets);
    addMandate(p, office, placeIbge, plan.term);
    if (plan.next && plan.nextChance) {
      const roll = r();
      if (roll < plan.nextChance) {
        addCandidacy(p, plan.nextYear, office, placeIbge, "eleito", r, assets);
        addMandate(p, office, placeIbge, plan.next);
      } else if (roll < plan.nextChance + 0.2) {
        addCandidacy(p, plan.nextYear, office, placeIbge, pick(r, ["suplente", "nao_eleito"] as const), r, assets);
      }
    }
    return p;
  };

  // federal
  const exec = (start: string, end: string): Term => ({ start, end, status: "em_exercicio" });
  seat("presidente", "presidente", "BR", null, { term: exec("2023-01-01", "2027-01-05"), next: { start: "2027-01-05", end: "2031-01-05", status: "eleito_aguardando_posse" }, nextChance: 0.5, elected: 2022, nextYear: 2026, prevYear: 2018 });
  seat("vice", "vice_presidente", "BR", null, { term: exec("2023-01-01", "2027-01-05"), elected: 2022, nextYear: 2026, prevYear: 2018 });

  for (const [ibge, uf, , , federal] of UF_ROWS) {
    seat(`gov:${uf}`, "governador", ibge, uf, { term: exec("2023-01-01", "2027-01-06"), next: { start: "2027-01-06", end: "2031-01-06", status: "eleito_aguardando_posse" }, nextChance: 0.4, elected: 2022, nextYear: 2026, prevYear: 2018 });
    seat(`vgov:${uf}`, "vice_governador", ibge, uf, { term: exec("2023-01-01", "2027-01-06"), elected: 2022, nextYear: 2026, prevYear: 2018 });
    for (let i = 0; i < 3; i++) {
      // 2018 elegeu 2/3 (mandato até 2027); 2022 elegeu 1/3 (até 2031)
      const old = i < 2;
      seat(`sen:${uf}:${i}`, "senador", ibge, uf, old
        ? { term: { start: "2019-02-01", end: "2027-02-01", status: "em_exercicio" }, next: { start: "2027-02-01", end: "2035-02-01", status: "eleito_aguardando_posse" }, nextChance: 0.35, elected: 2018, nextYear: 2026, prevYear: 2010 }
        : { term: { start: "2023-02-01", end: "2031-02-01", status: "em_exercicio" }, elected: 2022, nextYear: 2030, prevYear: 2014 });
    }
    for (let i = 0; i < federal; i++)
      seat(`dep:${uf}:${i}`, "deputado_federal", ibge, uf, { term: LEG_TERM, next: LEG_NEXT, nextChance: 0.6, prevChance: 0.45, elected: 2022, nextYear: 2026, prevYear: 2018 });
    const stateOffice: OfficeSlug = uf === "DF" ? "deputado_distrital" : "deputado_estadual";
    const nState = uf === "DF" ? 24 : stateSeats(federal);
    for (let i = 0; i < nState; i++)
      seat(`est:${uf}:${i}`, stateOffice, ibge, uf, { term: LEG_TERM, next: LEG_NEXT, nextChance: 0.55, prevChance: 0.4, elected: 2022, nextYear: 2026, prevYear: 2018 });
  }

  // municipal (2025–2028)
  const mun: Term = { start: "2025-01-01", end: "2029-01-01", status: "em_exercicio" };
  for (const [ibge, , uf, nVer] of MUNICIPALITY_ROWS) {
    seat(`pref:${ibge}`, "prefeito", ibge, uf, { term: mun, prevChance: 0.3, elected: 2024, nextYear: 2028, prevYear: 2020 });
    seat(`vpref:${ibge}`, "vice_prefeito", ibge, uf, { term: mun, elected: 2024, nextYear: 2028, prevYear: 2020 });
    for (let i = 0; i < nVer; i++)
      seat(`ver:${ibge}:${i}`, "vereador", ibge, uf, { term: mun, prevChance: 0.4, elected: 2024, nextYear: 2028, prevYear: 2020 },
        // caso de borda deliberado: nome longo
        ibge === "3509502" && i === 0 ? "Maria Aparecida dos Santos Albuquerque de Vasconcelos Filha" : undefined);
  }

  // slug antigo de demonstração: /p/slug-antigo-demo → 308 para o atual
  const firstFed = s.mandates.find((m) => m.office === "deputado_federal")!;
  s.redirects.set("slug-antigo-demo", s.personById.get(firstFed.personId)!.slug);
  return s;
}

const g = globalThis as unknown as { __demoStore?: Store };
const store = () => (g.__demoStore ??= build());

// ---------- helpers ----------
function placeLabel(ibge: string) {
  const p = store().placeByIbge.get(ibge);
  if (!p) return "";
  if (p.kind === "municipio") return `${p.name} · ${p.uf}`;
  return p.name;
}
function officeName(slug: OfficeSlug, gender: "f" | "m") {
  const o = officeBySlug[slug];
  return gender === "f" ? o.nameF : o.nameM;
}
function holder(m: Mandate): Officeholder {
  const person = store().personById.get(m.personId)!;
  return { person, mandate: m, party: partyById[m.partyId], officeName: officeName(m.office, person.gender), placeLabel: placeLabel(m.placeIbge) };
}
const byName = (a: Officeholder, b: Officeholder) => a.person.displayName.localeCompare(b.person.displayName, "pt-BR");
const current = () => store().mandates.filter((m) => m.status === "em_exercicio");
function page<T>(all: T[], cursor: string | undefined, limit: number): Page<T> {
  const off = Math.max(0, Number(cursor) || 0);
  const items = all.slice(off, off + limit);
  return { items, nextCursor: off + limit < all.length ? String(off + limit) : null, total: all.length };
}
const yearOf = (d: string) => Number(d.slice(0, 4));
const LEGISLATIVE: OfficeSlug[] = ["senador", "deputado_federal", "deputado_estadual", "deputado_distrital", "vereador"];
const WITH_FULL_DATA: OfficeSlug[] = ["deputado_federal", "senador"];

function mainMandate(personId: string) {
  const ms = store().mandatesByPerson.get(personId) ?? [];
  return ms.find((m) => m.status === "em_exercicio") ?? ms[ms.length - 1];
}
function bodyOf(office: OfficeSlug): "camara" | "senado" | null {
  return office === "deputado_federal" ? "camara" : office === "senador" ? "senado" : null;
}
function mandateYears(personId: string, office?: OfficeSlug) {
  const ys = new Set<number>();
  for (const m of store().mandatesByPerson.get(personId) ?? []) {
    if (office && m.office !== office) continue;
    if (m.status === "eleito_aguardando_posse") continue;
    const end = Math.min(yearOf(m.endsOn), CURRENT_YEAR);
    for (let y = yearOf(m.startedOn); y <= end; y++) ys.add(y);
  }
  return [...ys].sort((a, b) => b - a);
}
function inMandate(personId: string, office: OfficeSlug, date: string) {
  return (store().mandatesByPerson.get(personId) ?? []).some(
    (m) => m.office === office && m.status !== "eleito_aguardando_posse" && date >= m.startedOn && date < m.endsOn && date <= TODAY,
  );
}

// ---------- cobertura (o que falta e por quê) ----------
const REASONS = {
  so_portal: "aparece no portal do órgão, mas não em dados abertos que dê para carregar",
  nao_publica: "o órgão não publica esse dado",
  carregando: "o órgão publica; a carga está na fila",
  desconhecido: "ainda não conferimos se o órgão publica",
} as const;
const DATASET_LABEL = {
  salario: "Salário pago",
  presenca: "Presença em sessões",
  votos: "Votos em plenário",
  propostas: "Propostas apresentadas",
  gastos_gabinete: "Gastos do gabinete",
  patrimonio: "Patrimônio",
} as const;
function coverageFor(placeIbge: string): MissingDataset[] {
  const p = store().placeByIbge.get(placeIbge);
  if (!p || p.kind === "pais") return [];
  const r = rng(`cov:${placeIbge}`);
  const mk = (dataset: keyof typeof DATASET_LABEL, status: keyof typeof REASONS): MissingDataset => ({ dataset, label: DATASET_LABEL[dataset], status, reason: REASONS[status] });
  if (p.kind === "uf")
    return [mk("presenca", "carregando"), mk("votos", "carregando"), mk("propostas", "carregando"), mk("gastos_gabinete", pick(r, ["so_portal", "carregando"] as const))];
  const out = [
    mk("salario", pick(r, ["so_portal", "nao_publica", "so_portal"] as const)),
    mk("presenca", pick(r, ["nao_publica", "carregando", "desconhecido"] as const)),
    mk("votos", pick(r, ["nao_publica", "carregando", "so_portal"] as const)),
    mk("propostas", pick(r, ["carregando", "so_portal"] as const)),
    mk("gastos_gabinete", pick(r, ["nao_publica", "so_portal"] as const)),
  ];
  // capitais grandes publicam mais
  const big = (store().vereadoresOf.get(placeIbge) ?? 0) >= 41;
  return big ? out.filter((_, i) => i !== 3 && i !== 0) : out;
}

// ---------- produção legislativa (só Câmara e Senado têm dados completos no demo) ----------
const SUBJECTS = ["prazos de atendimento", "transparência de contratos", "acesso em municípios pequenos", "regras de fiscalização", "dados abertos", "fontes de financiamento", "formação de profissionais", "metas anuais", "proteção de dados pessoais", "compras públicas"];
const LAW_TYPES = ["PL", "PL", "PL", "PLP", "PEC"];
const ASK_TYPES = ["REQ", "INC", "RIC"];
const proposalsCache = new Map<string, Proposal[]>();
function proposalsOf(personId: string): Proposal[] {
  const hit = proposalsCache.get(personId);
  if (hit) return hit;
  const m = mainMandate(personId);
  const out: Proposal[] = [];
  if (m && WITH_FULL_DATA.includes(m.office)) {
    const r = rng(`prop:${personId}`);
    for (const y of mandateYears(personId, m.office)) {
      const n = between(r, 2, 14);
      for (let i = 0; i < n; i++) {
        const law = r() < 0.55;
        const type = law ? pick(r, LAW_TYPES) : pick(r, ASK_TYPES);
        const t1 = pick(r, TOPICS).slug;
        const topics = r() < 0.3 ? [t1, pick(r, TOPICS).slug].filter((v, i2, a) => a.indexOf(v) === i2) : [t1];
        const month = y === CURRENT_YEAR ? between(r, 1, 10) : between(r, 1, 12);
        out.push({
          id: `${personId}-pr${out.length}`,
          type,
          number: between(r, 100, 5999),
          year: y,
          summary: law
            ? `Altera regras de ${topicName[t1].toLowerCase()} para tratar de ${pick(r, SUBJECTS)}.`
            : `Pede informações ao Executivo sobre ${pick(r, SUBJECTS)} na área de ${topicName[t1].toLowerCase()}.`,
          topics,
          role: r() < 0.7 ? "autor" : "coautor",
          canBecomeLaw: law,
          status: law ? pick(r, ["Em tramitação", "Em tramitação", "Aguardando parecer", "Arquivada", "Virou lei"]) : pick(r, ["Respondido", "Aguardando resposta", "Arquivado"]),
          presentedOn: iso(y, month, between(r, 1, 28)),
          url: m.office === "senador" ? SOURCES.senado.url : SOURCES.camara.url,
        });
      }
    }
    out.sort((a, b) => b.presentedOn.localeCompare(a.presentedOn));
  }
  proposalsCache.set(personId, out);
  return out;
}

const eventsCache = new Map<"camara" | "senado", { events: VotingEvent[]; byPerson: Map<string, PersonVote[]> }>();
function votesOfBody(body: "camara" | "senado") {
  const hit = eventsCache.get(body);
  if (hit) return hit;
  const office: OfficeSlug = body === "camara" ? "deputado_federal" : "senador";
  const r = rng(`events:${body}`);
  const events: VotingEvent[] = [];
  for (let y = 2019; y <= CURRENT_YEAR; y++) {
    for (let i = 0; i < 40; i++) {
      const topic = pick(r, TOPICS).slug;
      const month = y === CURRENT_YEAR ? between(r, 2, 10) : between(r, 2, 12);
      events.push({
        id: `${body}-v${y}-${i}`,
        body,
        occurredAt: `${iso(y, month, between(r, 1, 28))}T${String(between(r, 14, 22)).padStart(2, "0")}:00:00-03:00`,
        description: `${pick(r, LAW_TYPES)} ${between(r, 100, 5999)}/${y - between(r, 0, 3)}: ${pick(r, ["texto principal", "destaque", "urgência", "emenda"])} sobre ${pick(r, SUBJECTS)}`,
        topic,
        result: "aprovado",
        yes: 0,
        no: 0,
      });
    }
  }
  const members = [...new Set(store().mandates.filter((m) => m.office === office).map((m) => m.personId))];
  const byPerson = new Map<string, PersonVote[]>();
  for (const ev of events) {
    const date = ev.occurredAt.slice(0, 10);
    if (date > TODAY) continue;
    let yes = 0;
    let no = 0;
    for (const pid of members) {
      if (!inMandate(pid, office, date)) continue;
      const party = store().partyOf.get(pid)!;
      const orient: VoteValue = rng(`ori:${ev.id}:${party}`)() < 0.6 ? "sim" : "nao";
      const x = rng(`vote:${ev.id}:${pid}`)();
      const value: VoteValue =
        x < 0.06 ? "nao_votou" : x < 0.08 ? "abstencao" : x < 0.09 ? "obstrucao" : x < 0.86 ? orient : orient === "sim" ? "nao" : "sim";
      if (value === "sim") yes++;
      if (value === "nao") no++;
      const list = byPerson.get(pid) ?? [];
      list.push({ event: ev, value, partyId: party });
      byPerson.set(pid, list);
    }
    ev.yes = yes;
    ev.no = no;
    ev.result = yes > no ? "aprovado" : "rejeitado";
  }
  for (const list of byPerson.values()) list.sort((a, b) => b.event.occurredAt.localeCompare(a.event.occurredAt));
  const v = { events, byPerson };
  eventsCache.set(body, v);
  return v;
}
function votesOf(personId: string): PersonVote[] {
  const m = mainMandate(personId);
  const body = m && bodyOf(m.office);
  return body ? votesOfBody(body).byPerson.get(personId) ?? [] : [];
}

const SUPPLIER_A = ["Gráfica", "Auto Posto", "Comunicação", "Locadora", "Hotel", "Consultoria", "Restaurante", "Telecom", "Agência"];
const SUPPLIER_B = ["Horizonte", "Central", "do Vale", "Planalto", "Atlântico", "Serra Azul", "Bandeirante", "Litoral", "Primavera"];
const expensesCache = new Map<string, Expense[]>();
function expensesOf(personId: string): Expense[] {
  const hit = expensesCache.get(personId);
  if (hit) return hit;
  const m = mainMandate(personId);
  const out: Expense[] = [];
  if (m && WITH_FULL_DATA.includes(m.office)) {
    const r = rng(`exp:${personId}`);
    for (const y of mandateYears(personId, m.office)) {
      const lastMonth = y === CURRENT_YEAR ? 10 : 12;
      for (let mo = 1; mo <= lastMonth; mo++) {
        if (!inMandate(personId, m.office, iso(y, mo, 15))) continue;
        const n = between(r, 2, 6);
        for (let i = 0; i < n; i++) {
          const cat = EXPENSE_CATEGORIES[Math.min(EXPENSE_CATEGORIES.length - 1, Math.floor(r() ** 1.4 * EXPENSE_CATEGORIES.length))];
          out.push({
            id: `${personId}-e${out.length}`,
            occurredOn: iso(y, mo, between(r, 1, 28)),
            category: cat,
            supplier: `${pick(r, SUPPLIER_A)} ${pick(r, SUPPLIER_B)} Ltda`,
            amountCents: r() < 0.02 ? -between(r, 5_000, 80_000) : between(r, 15_000, 2_500_000),
            receiptUrl: null,
          });
        }
      }
    }
    out.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  }
  expensesCache.set(personId, out);
  return out;
}

// salário: federais e estaduais publicam valor; municipais, só o teto constitucional no demo
const SALARY: Partial<Record<OfficeSlug, number>> = {
  presidente: 4_636_619,
  vice_presidente: 4_636_619,
  senador: 4_636_619,
  deputado_federal: 4_636_619,
  governador: 3_546_222,
  vice_governador: 3_190_000,
  deputado_estadual: 3_477_464,
  deputado_distrital: 3_477_464,
};
function salaryFor(m: Mandate): { cents: number | null; ceiling: boolean } {
  const v = SALARY[m.office];
  if (v) return { cents: v, ceiling: false };
  if (m.office === "vereador") {
    const pct = (store().vereadoresOf.get(m.placeIbge) ?? 9) >= 33 ? 0.75 : 0.3;
    return { cents: Math.round(3_477_464 * pct), ceiling: true };
  }
  if (m.office === "prefeito" || m.office === "vice_prefeito") return { cents: 4_636_619, ceiling: true };
  return { cents: null, ceiling: false };
}

// ---------- implementação ----------
export const fakeSource: DataSource = {
  isDemo: true,

  async searchPlaces(q, limit = 10) {
    const f = fold(q);
    if (f.length < 2) return [];
    const ps = store().places.filter((p) => (p.kind === "municipio" || p.kind === "uf") && (fold(p.name).startsWith(f) || fold(p.name).includes(` ${f}`) || p.uf?.toLowerCase() === f));
    return ps
      .sort((a, b) => Number(!fold(a.name).startsWith(f)) - Number(!fold(b.name).startsWith(f)) || a.name.localeCompare(b.name, "pt-BR") || (a.uf ?? "").localeCompare(b.uf ?? ""))
      .slice(0, limit);
  },
  async getPlace(ibge) {
    return store().placeByIbge.get(ibge) ?? null;
  },
  async getPlaceByUf(uf) {
    return store().places.find((p) => p.kind === "uf" && p.uf === uf.toUpperCase()) ?? null;
  },
  async listUfs() {
    return store().places.filter((p) => p.kind === "uf").sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  },
  async listMunicipalities(uf) {
    return store()
      .places.filter((p) => p.kind === "municipio" && (!uf || p.uf === uf))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || (a.uf ?? "").localeCompare(b.uf ?? ""));
  },

  async getRepresentatives(place) {
    const uf = place.uf;
    const ufPlace = uf ? store().places.find((p) => p.kind === "uf" && p.uf === uf) : null;
    const groups: RepresentativeGroup[] = [];
    const add = (key: string, offices: OfficeSlug[], ibge: string | undefined, level: Level, title: string) => {
      if (!ibge) return;
      const people = current()
        .filter((m) => offices.includes(m.office) && m.placeIbge === ibge)
        .map(holder)
        .sort((a, b) => offices.indexOf(a.mandate.office) - offices.indexOf(b.mandate.office) || byName(a, b));
      if (people.length) groups.push({ key, title, level, where: placeLabel(ibge), people });
    };
    if (place.kind === "municipio") {
      add("prefeitura", ["prefeito", "vice_prefeito"], place.ibge, "municipal", PLURAL.prefeito);
      add("vereadores", ["vereador"], place.ibge, "municipal", PLURAL.vereador);
    }
    add("governo", ["governador", "vice_governador"], ufPlace?.ibge, "estadual", PLURAL.governador);
    add("assembleia", ["deputado_estadual", "deputado_distrital"], ufPlace?.ibge, "estadual", uf === "DF" ? PLURAL.deputado_distrital : PLURAL.deputado_estadual);
    add("senado", ["senador"], ufPlace?.ibge, "federal", PLURAL.senador);
    add("camara", ["deputado_federal"], ufPlace?.ibge, "federal", PLURAL.deputado_federal);
    add("presidencia", ["presidente", "vice_presidente"], "BR", "federal", PLURAL.presidente);
    return groups;
  },
  async getCoverage(place) {
    return coverageFor(place.ibge);
  },
  async getTopVotedInPlace() {
    return null; // a demo não simula votos por município
  },
  async getCityCouncil() {
    return null; // a demo não simula Câmaras Municipais
  },
  async getAssembly(uf) {
    // a demo não simula Assembleias: toda casa aparece como não lida, com o motivo (nunca número inventado)
    const u = uf.toUpperCase();
    if (!UF_ROWS.some((r) => r[1] === u)) return null;
    const why = "dados de demonstração: Assembleias não são simuladas";
    const items = (["presenca", "votos", "propostas", "gastos_gabinete"] as const).map((d) => ({
      dataset: d,
      label: { presenca: "Presença no plenário", votos: "Votos no plenário", propostas: "Propostas apresentadas", gastos_gabinete: "Verba de gabinete" }[d],
      status: "desconhecido" as const,
      reason: why,
      evidenceUrl: null,
      checkedOn: null,
      refreshedAt: null,
      stampDataset: null,
    }));
    return { uf: u, houseName: houseName(u), read: false, source: null, items };
  },
  async getCounters() {
    const byLevel: Record<Level, number> = { federal: 0, estadual: 0, municipal: 0 };
    const byOffice = new Map<OfficeSlug, number>();
    for (const m of current()) {
      byLevel[officeBySlug[m.office].level]++;
      byOffice.set(m.office, (byOffice.get(m.office) ?? 0) + 1);
    }
    return {
      total: byLevel.federal + byLevel.estadual + byLevel.municipal,
      byLevel,
      byOffice: OFFICES.filter((o) => byOffice.has(o.slug)).map((o) => ({ office: o.slug, label: PLURAL[o.slug], count: byOffice.get(o.slug)! })),
    };
  },
  async listParties() {
    return [...PARTIES].sort((a, b) => a.acronym.localeCompare(b.acronym));
  },
  async listOffices() {
    return OFFICES;
  },

  async listPeople(f) {
    const q = f.q ? fold(f.q) : "";
    const all = current()
      .map(holder)
      .filter((h) => {
        if (f.office && h.mandate.office !== f.office) return false;
        if (f.party && h.party.id !== f.party) return false;
        if (f.uf) {
          const p = store().placeByIbge.get(h.mandate.placeIbge);
          if (p?.uf !== f.uf.toUpperCase()) return false;
        }
        const name = fold(h.person.displayName);
        if (f.letter && !name.startsWith(f.letter.toLowerCase())) return false;
        if (q && !name.includes(q) && !fold(h.person.civilName).includes(q)) return false;
        return true;
      })
      .sort(byName);
    return page(all, f.cursor, Math.min(f.limit ?? 60, 200));
  },
  async searchPeople(q, limit = 8) {
    const f = fold(q);
    if (f.length < 2) return [];
    return current()
      .map(holder)
      .filter((h) => fold(h.person.displayName).split(" ").some((w) => w.startsWith(f)) || fold(h.person.displayName).startsWith(f))
      .sort(byName)
      .slice(0, limit);
  },
  async getPerson(slug) {
    const s = store();
    const to = s.redirects.get(slug);
    if (to) return { person: s.personBySlug.get(to)!, redirectTo: to };
    const person = s.personBySlug.get(slug);
    return person ? { person } : null;
  },
  async getMandates(personId) {
    const person = store().personById.get(personId)!;
    const rank: Record<MandateStatus, number> = { em_exercicio: 0, eleito_aguardando_posse: 1, licenciado: 2, afastado: 2, encerrado: 3, renunciou: 3, cassado: 3 };
    return (store().mandatesByPerson.get(personId) ?? [])
      .map((m) => ({ ...m, party: partyById[m.partyId], officeName: officeName(m.office, person.gender), placeLabel: placeLabel(m.placeIbge) }))
      .sort((a, b) => rank[a.status] - rank[b.status] || b.startedOn.localeCompare(a.startedOn));
  },
  async getCandidacies(personId) {
    const person = store().personById.get(personId)!;
    return (store().candidaciesByPerson.get(personId) ?? [])
      .map((c) => ({ ...c, party: partyById[c.partyId], officeName: officeName(c.office, person.gender), placeLabel: placeLabel(c.placeIbge) }))
      .sort((a, b) => b.year - a.year);
  },
  async getStats(personId, period) {
    const m = mainMandate(personId);
    const year = period === "career" ? null : Number(period);
    const inPeriod = (d: string) => year === null || yearOf(d) === year;
    const legislative = !!m && LEGISLATIVE.includes(m.office);
    const full = !!m && WITH_FULL_DATA.includes(m.office);
    const missing: MissingDataset[] = [];
    if (m && legislative && !full) {
      const ufIbge = store().placeByIbge.get(m.placeIbge);
      missing.push(...coverageFor(m.office === "vereador" ? m.placeIbge : (ufIbge?.ibge ?? m.placeIbge)));
    }
    if (m?.office === "senador")
      missing.push({ dataset: "presenca", label: DATASET_LABEL.presenca, status: "nao_publica", reason: "o Senado não publica presença por sessão deliberativa no mesmo formato da Câmara" });
    const isMissing = (d: string) => missing.some((x) => x.dataset === d);

    const props = proposalsOf(personId).filter((p) => inPeriod(p.presentedOn));
    const votes = votesOf(personId).filter((v) => inPeriod(v.event.occurredAt));
    const exps = expensesOf(personId).filter((e) => inPeriod(e.occurredOn));
    let presencePresent: number | null = null;
    let presenceTotal: number | null = null;
    if (m?.office === "deputado_federal") {
      presenceTotal = votes.length ? new Set(votes.map((v) => v.event.occurredAt.slice(0, 10))).size : 0;
      presencePresent = votes.length ? new Set(votes.filter((v) => v.value !== "nao_votou").map((v) => v.event.occurredAt.slice(0, 10))).size : 0;
    }
    const topicCount = new Map<string, number>();
    for (const p of props) for (const t of p.topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    const sal = m ? salaryFor(m) : { cents: null, ceiling: false };
    return {
      period,
      presencePresent,
      presenceTotal,
      proposalsPrincipal: full ? props.filter((p) => p.role === "autor").length : null,
      proposalsCosigned: full ? props.filter((p) => p.role === "coautor").length : null,
      votesRegistered: full ? votes.filter((v) => v.value !== "nao_votou").length : null,
      expensesCents: full ? exps.reduce((s, e) => s + e.amountCents, 0) : null,
      salaryMonthlyCents: isMissing("salario") && !sal.ceiling ? null : sal.cents,
      salaryIsCeiling: sal.ceiling,
      topTopics: [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic, count]) => ({ topic, count })),
      // a demo não guarda a orientação de cada bancada: sem dado, nunca um número inventado
      partyAligned: null,
      partyAlignmentTotal: null,
      missing,
    };
  },
  async getActiveYears(personId) {
    return mandateYears(personId);
  },
  async getPresenceByMonth(personId, year) {
    const out: { month: number; present: number; total: number }[] = [];
    for (const v of votesOf(personId)) {
      if (yearOf(v.event.occurredAt) !== year) continue;
      const m = Number(v.event.occurredAt.slice(5, 7));
      const row = out.find((x) => x.month === m) ?? (out.push({ month: m, present: 0, total: 0 }), out[out.length - 1]);
      row.total++;
      if (v.value !== "nao_votou") row.present++;
    }
    return out.sort((a, b) => a.month - b.month);
  },
  async getSalaryAccrued() {
    return null; // a demo não guarda a série histórica do subsídio
  },
  async getCampaignFinance() {
    return []; // a demo não simula a prestação de contas por categoria
  },
  async listStaff() {
    return []; // a demo não inventa nome de servidor
  },
  async countSecretVotes() {
    return 0; // a demo não simula votação secreta
  },
  async getYearlyStats(personId) {
    const years = [...mandateYears(personId)].sort((a, b) => a - b);
    return Promise.all(
      years.map(async (y) => {
        const st = await fakeSource.getStats(personId, String(y) as `${number}`);
        return { year: y, presencePresent: st.presencePresent, presenceTotal: st.presenceTotal, proposalsPrincipal: st.proposalsPrincipal, proposalsCosigned: st.proposalsCosigned, votesRegistered: st.votesRegistered, expensesCents: st.expensesCents };
      }),
    );
  },

  async listProposals(personId, f) {
    const q = f.q ? fold(f.q) : "";
    const all = proposalsOf(personId).filter(
      (p) =>
        (!f.year || p.year === f.year) &&
        (!f.topic || p.topics.includes(f.topic)) &&
        (!f.type || (f.type === "emenda" ? false : (f.type === "lei") === p.canBecomeLaw)) &&
        (!f.role || p.role === f.role) &&
        (!q || fold(p.summary).includes(q) || `${p.type} ${p.number}`.toLowerCase().includes(q)),
    );
    return page(all, f.cursor, f.limit ?? 20);
  },
  async listVotes(personId, f) {
    const q = f.q ? fold(f.q) : "";
    const all = votesOf(personId).filter(
      (v) =>
        (!f.year || yearOf(v.event.occurredAt) === f.year) &&
        (!f.topic || v.event.topic === f.topic) &&
        (!f.value || v.value === f.value) &&
        (!q || fold(v.event.description).includes(q)),
    );
    return page(all, f.cursor, f.limit ?? 20);
  },
  async listExpenses(personId, f) {
    const inYear = expensesOf(personId).filter((e) => !f.year || yearOf(e.occurredOn) === f.year);
    const cats = new Map<string, number>();
    for (const e of inYear) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amountCents);
    const all = inYear.filter((e) => !f.category || e.category === f.category);
    return {
      ...page(all, f.cursor, f.limit ?? 20),
      byCategory: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([label, cents]) => ({ label, cents })),
    };
  },
  async getAgreement(personIds, period) {
    const out: Agreement[] = [];
    const maps = personIds.map((id) => {
      const mp = new Map<string, VoteValue>();
      for (const v of votesOf(id)) if (period === "career" || yearOf(v.event.occurredAt) === period) mp.set(v.event.id, v.value);
      return mp;
    });
    const counted = (v: VoteValue) => v === "sim" || v === "nao" || v === "abstencao" || v === "obstrucao";
    for (let i = 0; i < personIds.length; i++)
      for (let j = i + 1; j < personIds.length; j++) {
        let same = 0;
        let total = 0;
        for (const [ev, va] of maps[i]) {
          const vb = maps[j].get(ev);
          if (!vb || !counted(va) || !counted(vb)) continue;
          total++;
          if (va === vb) same++;
        }
        out.push({ a: personIds[i], b: personIds[j], same, total });
      }
    return out;
  },
  async listDisagreements(a, b, f) {
    const va = new Map(votesOf(a).map((v) => [v.event.id, v]));
    const ok = (x: string) => ["sim", "nao", "abstencao", "obstrucao"].includes(x);
    const all = votesOf(b)
      .filter((v) => va.has(v.event.id) && ok(v.value) && ok(va.get(v.event.id)!.value) && v.value !== va.get(v.event.id)!.value && (!f.year || yearOf(v.event.occurredAt) === f.year))
      .map((v) => ({ event: { ...v.event, proposalLabel: null }, a: va.get(v.event.id)!.value, b: v.value }));
    const topics = new Map<string, number>();
    for (const d of all) if (d.event.topic) topics.set(d.event.topic, (topics.get(d.event.topic) ?? 0) + 1);
    const items = all.filter((d) => !f.topic || d.event.topic === f.topic);
    return { ...page(items, undefined, f.limit ?? 20), topics: [...topics].map(([slug, count]) => ({ slug, count })).sort((x, y) => x.slug.localeCompare(y.slug)) };
  },
  async listTopics() {
    return TOPICS;
  },
  async getChamber(body) {
    const office: OfficeSlug = body === "senado" ? "senador" : "deputado_federal";
    return current()
      .filter((m) => m.office === office)
      .map(holder)
      .sort((a, b) => a.party.acronym.localeCompare(b.party.acronym) || byName(a, b))
      .map((h) => ({ slug: h.person.slug, name: h.person.displayName, party: h.party.acronym, uf: store().placeByIbge.get(h.mandate.placeIbge)?.uf ?? null }));
  },
  async listVotingEvents(f) {
    const { events } = votesOfBody(f.body);
    const q = f.q ? fold(f.q) : "";
    const all = events
      .filter((e) => e.occurredAt.slice(0, 10) <= TODAY && (e.yes || e.no))
      .filter((e) => (!f.year || yearOf(e.occurredAt) === f.year) && (!f.result || e.result === f.result) && (!q || fold(e.description).includes(q)))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const years = [...new Set(events.map((e) => yearOf(e.occurredAt)))].filter((y) => y <= CURRENT_YEAR).sort((a, b) => b - a);
    const toSummary = (e: VotingEvent): VotingEventSummary => ({ ...e, isNominal: true, proposal: null });
    return { ...page(all.map(toSummary), f.cursor, Math.min(f.limit ?? 30, 100)), years };
  },
  async getVotingEvent(id) {
    const body = id.startsWith("senado") ? "senado" : id.startsWith("camara") ? "camara" : null;
    if (!body) return null;
    const { events, byPerson } = votesOfBody(body);
    const ev = events.find((e) => e.id === id);
    if (!ev) return null;
    const counts = { sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0 } as Record<VoteValue, number>;
    const votes: VotingEventDetail["votes"] = [];
    const parties = new Map<string, VotingEventDetail["byParty"][number]>();
    for (const [pid, list] of byPerson) {
      const v = list.find((x) => x.event.id === id);
      if (!v) continue;
      const person = store().personById.get(pid)!;
      const party = partyById[v.partyId].acronym;
      counts[v.value]++;
      votes.push({ slug: person.slug, name: person.displayName, party, uf: store().placeByIbge.get(mainMandate(pid)!.placeIbge)?.uf ?? null, value: v.value });
      const p = parties.get(party) ?? { party, counts: {}, total: 0 };
      p.counts[v.value] = (p.counts[v.value] ?? 0) + 1;
      p.total++;
      parties.set(party, p);
    }
    votes.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return {
      ...ev,
      isNominal: true,
      proposal: null,
      counts,
      orientations: PARTIES.map((p) => ({ label: p.acronym, kind: "partido" as const, value: (rng(`ori:${id}:${p.id}`)() < 0.6 ? "sim" : "nao") as "sim" | "nao" })),
      byParty: [...parties.values()].sort((a, b) => a.party.localeCompare(b.party, "pt-BR")),
      votes,
    };
  },
  async getActivity(personIds, limit = 60) {
    const out: ActivityItem[] = [];
    for (const id of personIds) {
      const p = store().personById.get(id);
      if (!p) continue;
      for (const v of votesOf(id).slice(0, 15))
        out.push({ personSlug: p.slug, personName: p.displayName, kind: "voto", occurredAt: v.event.occurredAt, title: v.event.description, detail: v.value, href: `/votacoes/${v.event.id}` });
      for (const pr of proposalsOf(id).slice(0, 5))
        out.push({ personSlug: p.slug, personName: p.displayName, kind: "proposta", occurredAt: pr.presentedOn, title: `${pr.type} ${pr.number}/${pr.year}`, detail: pr.summary, href: `/p/${p.slug}#propostas` });
    }
    return out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  },
  // a demonstração não inventa leis, comissões, discursos nem contatos: seções aparecem vazias, com o motivo
  async getLaws() {
    return [];
  },
  async listLaws() {
    return { items: [], nextCursor: null, total: 0, years: [] }; // a demo não simula leis
  },
  async getCommittees() {
    return [];
  },
  async listSpeeches() {
    return { items: [], nextCursor: null, total: 0 };
  },
  async listStampYears(prefix) {
    return prefix.startsWith("tse") ? [2018, 2020, 2022, 2024, 2026] : [2023, 2024, 2025, 2026];
  },
  async getContacts() {
    return [];
  },
  async getStamp(dataset) {
    const src = dataset.startsWith("camara") ? SOURCES.camara : dataset.startsWith("senado") ? SOURCES.senado : dataset.startsWith("ibge") ? SOURCES.ibge : SOURCES.tse;
    const refreshedAt = dataset.startsWith("camara") || dataset.startsWith("senado") ? "2026-11-01T06:10:00-03:00" : dataset.startsWith("ibge") ? "2026-01-15T03:00:00-03:00" : "2026-10-31T05:40:00-03:00";
    return { dataset, source: src.name, sourceUrl: src.url, refreshedAt };
  },
  async listSourceStatus() {
    const mk = (slug: keyof typeof SOURCES, datasets: string[]) => {
      const refreshedAt = slug === "ibge" ? "2026-01-15T03:00:00-03:00" : slug === "tse" ? "2026-10-31T05:40:00-03:00" : "2026-11-01T06:10:00-03:00";
      return { slug, name: SOURCES[slug].name, url: SOURCES[slug].url, datasets: datasets.map((dataset) => ({ dataset, refreshedAt })), lastRefreshedAt: refreshedAt };
    };
    return [mk("camara", ["camara.deputados", "camara.votacoes.2026"]), mk("ibge", ["ibge.places"]), mk("senado", ["senado.senadores", "senado.votacoes.2026"]), mk("tse", ["tse.candidatos.2024"])];
  },
  async getCoverageMatrix() {
    const keys = ["salario", "presenca", "votos", "propostas", "gastos_gabinete"] as const;
    const rows = UF_ROWS.map((u) => ({ uf: u[1], name: u[2], cities: 0, cells: {} as Record<string, Partial<Record<CoverageStatus, number>>> })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const byUf = new Map(rows.map((r) => [r.uf, r]));
    const total = { cities: 0, cells: {} as Record<string, Partial<Record<CoverageStatus, number>>> };
    for (const m of MUNICIPALITY_ROWS) {
      const row = byUf.get(m[2]);
      if (!row) continue;
      row.cities++;
      total.cities++;
      const present = new Map(coverageFor(m[0]).map((c) => [c.dataset, c.status]));
      for (const k of keys) {
        const st: CoverageStatus = present.get(k) ?? "no_site";
        row.cells[k] = { ...row.cells[k], [st]: (row.cells[k]?.[st] ?? 0) + 1 };
        total.cells[k] = { ...total.cells[k], [st]: (total.cells[k]?.[st] ?? 0) + 1 };
      }
    }
    return { datasets: keys.map((k) => ({ key: k, label: DATASET_LABEL[k] })), rows, total, checkedOn: "2026-11-01" };
  },
  async latestRefresh() {
    return "2026-11-01T06:10:00-03:00";
  },
};
