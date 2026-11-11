import { fakeW4 } from "./fake-w4";
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
  AnswerClaim,
  AssemblyInfo,
  PublishedAnswers,
  Agreement,
  Candidacy,
  DataSource,
  ElectionResult,
  Expense,
  Level,
  CoverageStatus,
  Mandate,
  MandateStatus,
  SeatChange,
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
  VoteKind,
  LatestRecord,
  VotingEventDetail,
  VotingEventSummary,
  ActivityItem,
  PautaEntry,
  PautaProposal,
  VerifiedBy,
} from "./types";
import { parseProposalKey, uniqueByKey } from "../pauta";
import { placarPorUf } from "./cadeiras";
import { lista } from "./lista";
import { coberturaDe, type CarimboFonte, type EntradaCobertura } from "./cobertura";

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

  // U09: eleitos novos de 2026 que ocupam as cadeiras de quem não se reelegeu (só Câmara e Senado; pessoas novas, sem tocar o sorteio das demais)
  const reelected = new Set(s.mandates.filter((m) => m.status === "eleito_aguardando_posse").map((m) => m.personId));
  for (const m of s.mandates.filter((x) => x.status === "em_exercicio" && (x.office === "deputado_federal" || x.office === "senador") && x.endsOn <= "2027-02-01" && !reelected.has(x.personId))) {
    const uf = s.placeByIbge.get(m.placeIbge)?.uf ?? null;
    const novo = addPerson(`entrante:${m.id}`, uf);
    addCandidacy(novo, 2026, m.office, m.placeIbge, "eleito", rng(`entrante:${m.id}`), { v: 100_000_000 });
    addMandate(novo, m.office, m.placeIbge, { start: "2027-02-01", end: m.office === "senador" ? "2035-02-01" : "2031-02-01", status: "eleito_aguardando_posse" });
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
      const what = pick(r, ["texto principal", "destaque", "urgência", "emenda"] as const);
      const kind: VoteKind = what === "destaque" ? "destaque" : what === "urgência" ? "urgencia" : "texto";
      events.push({
        id: `${body}-v${y}-${i}`,
        body,
        kind,
        occurredAt: `${iso(y, month, between(r, 1, 28))}T${String(between(r, 14, 22)).padStart(2, "0")}:00:00-03:00`,
        description: `${pick(r, LAW_TYPES)} ${between(r, 100, 5999)}/${y - between(r, 0, 3)}: ${what} sobre ${pick(r, SUBJECTS)}`,
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

// ---------- cobertura por pessoa (demonstração) ----------
// Só as famílias de carga que a demonstração simula têm carimbo: equipe, comissões e emendas não são inventadas, então
// aparecem como "não carregado". Senador: o Senado não publica presença. Assembleias: não simuladas ("não conferido").
const CARIMBOS_DEMO: Record<string, CarimboFonte> = Object.fromEntries(
  [
    ...["camara.presenca", "camara.votacoes", "camara.despesas", "camara.proposicoes"].map((f) => [f, { nome: SOURCES.camara.name, url: SOURCES.camara.url, em: "2026-11-01T06:10:00-03:00" }] as const),
    ...["senado.votacoes", "senado.despesas", "senado.autorias"].map((f) => [f, { nome: SOURCES.senado.name, url: SOURCES.senado.url, em: "2026-11-01T06:10:00-03:00" }] as const),
    ["tse.candidatos", { nome: SOURCES.tse.name, url: SOURCES.tse.url, em: "2026-10-31T05:40:00-03:00" }] as const,
  ],
);
const asmDemo = (uf: string): AssemblyInfo => ({
  uf,
  houseName: houseName(uf),
  read: false,
  source: null,
  items: (["presenca", "votos", "propostas", "gastos_gabinete"] as const).map((d) => ({
    dataset: d,
    label: { presenca: "Presença no plenário", votos: "Votos no plenário", propostas: "Propostas apresentadas", gastos_gabinete: "Verba de gabinete" }[d],
    status: "desconhecido" as const,
    reason: "dados de demonstração: Assembleias não são simuladas",
    evidenceUrl: null,
    checkedOn: null,
    refreshedAt: null,
    stampDataset: null,
  })),
});
function entradaDemo(personId: string): EntradaCobertura {
  const m = mainMandate(personId);
  const place = m ? store().placeByIbge.get(m.placeIbge) : undefined;
  const uf = place?.uf ?? null;
  const estadual = m?.office === "deputado_estadual" || m?.office === "deputado_distrital";
  return {
    office: m?.office ?? null,
    status: m?.status ?? null,
    faltaFederal: m?.office === "senador" ? ["presenca"] : m?.office === "deputado_federal" ? [] : null,
    coberturaLugar: m?.office === "vereador" ? coverageFor(m.placeIbge).map((c) => ({ dataset: c.dataset, status: c.status, reason: c.reason, evidenceUrl: null })) : [],
    carimbos: CARIMBOS_DEMO,
    assembleia: estadual && uf ? asmDemo(uf) : null,
    sapl: null,
    casa: m?.office === "vereador" && place ? `Câmara Municipal de ${place.name} (${uf})` : estadual && uf ? houseName(uf) : null,
  };
}

// ---------- implementação ----------
export const fakeSource: DataSource = {
  isDemo: true,
  ...fakeW4,

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
  async getCouncilSite() {
    return null; // a demo não simula Câmaras Municipais
  },
  async getLatestRecord(personId) {
    const on = [
      ...votesOf(personId).map<LatestRecord>((v) => ({ kind: "votacao", on: v.event.occurredAt.slice(0, 10) })),
      ...proposalsOf(personId).map<LatestRecord>((p) => ({ kind: "proposta", on: p.presentedOn })),
      ...expensesOf(personId).map<LatestRecord>((e) => ({ kind: "gasto", on: e.occurredOn })),
    ].filter((r) => r.on <= TODAY);
    return on.sort((a, b) => b.on.localeCompare(a.on))[0] ?? null;
  },
  async getSalarySchedule(office) {
    const v = SALARY[office];
    return v ? [{ validFrom: "2025-02-01", amountCents: v, isCeiling: false, source: { name: "Decreto Legislativo nº 172/2022 (demonstração)", url: "https://www2.camara.leg.br/" } }] : [];
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
    return asmDemo(u);
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
  async getPartyProvenance(personId) {
    const m = mainMandate(personId);
    if (!m) return { kind: "none", reason: "sem filiação registrada nas fontes" };
    if (m.office === "deputado_federal") return { kind: "camara", since: m.startedOn };
    if (m.office === "senador") return { kind: "senado", since: m.startedOn };
    return { kind: "tse", since: m.startedOn, electionYear: Number(m.startedOn.slice(0, 4)) - 1 };
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
  async getAttendanceGrid(personId, year) {
    // a demo não guarda a lista de presença: cada dia com votação nominal é uma sessão (presente se votou)
    const byDay = new Map<string, boolean>();
    for (const v of votesOf(personId)) {
      const d = v.event.occurredAt.slice(0, 10);
      if (yearOf(d) !== year) continue;
      byDay.set(d, (byDay.get(d) ?? false) || v.value !== "nao_votou");
    }
    const sessions = [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, here]) => ({ date, state: here ? ("presente" as const) : ("ausente" as const) }));
    const present = sessions.filter((x) => x.state === "presente").length;
    return { year, sessions, present, absent: sessions.length - present, justified: 0, outside: 0, total: sessions.length };
  },
  async getChamberTransition(body) {
    const office: OfficeSlug = body === "senado" ? "senador" : "deputado_federal";
    const capacity = body === "senado" ? 81 : 513;
    const ufOf = (m: Mandate) => store().placeByIbge.get(m.placeIbge)?.uf ?? null;
    const seatOf = (m: Mandate, change: SeatChange) => {
      const p = store().personById.get(m.personId)!;
      return { id: p.slug, name: p.displayName, uf: ufOf(m), change };
    };
    const byNm = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR");
    const holders = current().filter((m) => m.office === office);
    const waiting = store().mandates.filter((m) => m.office === office && m.status === "eleito_aguardando_posse");
    const waitingIds = new Set(waiting.map((m) => m.personId));
    const holderIds = new Set(holders.map((m) => m.personId));
    const stays = (m: Mandate) => waitingIds.has(m.personId) || m.endsOn > "2027-02-01";
    const continuing = holders.filter(stays).map((m) => seatOf(m, "continua")).sort(byNm);
    const leaving = holders.filter((m) => !stays(m)).map((m) => seatOf(m, "sai")).sort(byNm);
    const entering = waiting.filter((m) => !holderIds.has(m.personId)).map((m) => seatOf(m, "entra")).sort(byNm);
    return {
      capacity,
      loaded: waiting.length > 0,
      today: [...continuing, ...leaving].slice(0, capacity),
      next: [...continuing, ...entering].slice(0, capacity),
      continua: continuing.length,
      entra: entering.length,
      sai: leaving.length,
      pending: Math.max(0, capacity - continuing.length - entering.length),
      extra: Math.max(0, holders.length - capacity),
    };
  },
  async getSalaryAccrued() {
    return null; // a demo não guarda a série histórica do subsídio
  },
  async getCampaignFinance() {
    return []; // a demo não simula a prestação de contas por categoria
  },
  async listAmendmentsByPerson() {
    return []; // a demo não inventa emenda (catálogo D02)
  },
  async listAmendmentsToPlace() {
    return [];
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
    const base = votesOf(personId).filter(
      (v) =>
        (!f.year || yearOf(v.event.occurredAt) === f.year) &&
        (!f.topic || v.event.topic === f.topic) &&
        (!f.value || v.value === f.value) &&
        (!q || fold(v.event.description).includes(q)),
    );
    const procedural = (v: PersonVote) => v.event.kind === "requerimento" || v.event.kind === "urgencia";
    const all = f.scope === "lei" ? base.filter((v) => !procedural(v)) : base;
    return { ...page(all, f.cursor, f.limit ?? 20), hidden: f.scope === "lei" ? base.length - all.length : 0 };
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
    const base = events
      .filter((e) => e.occurredAt.slice(0, 10) <= TODAY && (e.yes || e.no))
      .filter((e) => (!f.year || yearOf(e.occurredAt) === f.year) && (!f.result || e.result === f.result) && (!q || fold(e.description).includes(q)))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const all = f.scope === "lei" ? base.filter((e) => e.kind !== "requerimento" && e.kind !== "urgencia") : base;
    const years = [...new Set(events.map((e) => yearOf(e.occurredAt)))].filter((y) => y <= CURRENT_YEAR).sort((a, b) => b - a);
    const toSummary = (e: VotingEvent): VotingEventSummary => ({ ...e, isNominal: true, proposal: null });
    return { ...page(all.map(toSummary), f.cursor, Math.min(f.limit ?? 30, 100)), years, hidden: base.length - all.length };
  },
  async getVotingEvent(id) {
    if (id === DEMO_VOTACAO_SEM_VOTOS) return demoVotacaoSemVotos();
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
      porUf: placarPorUf(ev, votes),
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
  async getAgenda() {
    return { events: [], total: 0, source: null }; // a demo não simula agenda
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
  async getSalarySources() {
    // como no banco real hoje: o seed das normas não carimba a carga (loadedAt null)
    return [{ name: "Decreto Legislativo nº 172/2022 (demonstração)", url: "https://www2.camara.leg.br/", updatedAt: "2026-11-01T06:10:00-03:00", loadedAt: null }];
  },
  async listStampYears(prefix) {
    if (prefix.startsWith("transparencia") || prefix.startsWith("sancoes")) return []; // a demo não finge carga sem chave (D253)
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

  // Pauta: dois itens reais da leitura de 04/11/2026, com datas movidas para a semana corrente.
  async getPautaOverview(opts) {
    const { starts, ends, readAt } = demoWeek();
    // simulate "erro": a leitura da Câmara falhou em 2 das 9 reuniões (events_failed > 0)
    const camaraFailed = opts?.simulate === "erro" ? 2 : 0;
    // como no pg.ts (`withReview`): item com respostas publicadas leva `reviewedAt`, `verifiedBy` e o título simples só em `diz`
    const a = demoAnswers();
    // simulate "camara_nao_lida": a pauta da Câmara não foi lida (sem leitura e sem itens da Câmara)
    const semCamara = opts?.simulate === "camara_nao_lida";
    const all = demoPauta().filter((e) => !semCamara || e.body !== "camara").map((e) =>
      e.key === DEMO_ANSWERED_KEY ? { ...e, reviewedAt: a.reviewedAt, verifiedBy: a.verifiedBy, plain: a.fields.o_que_propoe.says ? a.fields.o_que_propoe.text : null } : e,
    );
    return {
      week: { total: all.filter((e) => e.stage === "plenario").length, atLeast: false, readAt, weekStarts: starts, weekEnds: ends },
      plenary: uniqueByKey(all.filter((e) => e.stage === "plenario")),
      later: [],
      committees: uniqueByKey(all.filter((e) => e.stage === "comissao")),
      exits: [],
      reads: { camara: semCamara ? { readAt: null, failed: 0, total: 0 } : { readAt, failed: camaraFailed, total: 9 }, senado: { readAt, failed: 0, total: 12 } },
    };
  },
  async getPautaProposal(key) {
    if (!parseProposalKey(key)) return null;
    const entry = [...demoPauta(), ...demoForaDaSemana()].find((e) => e.key === key);
    if (!entry) return null;
    const answers = entry.key === DEMO_ANSWERED_KEY ? demoAnswers() : entry.key in DEMO_QUEM_CONFERIU ? demoAnswers(DEMO_QUEM_CONFERIU[entry.key]) : null;
    const vazia = lista([], 0);
    const { autores, votacoes } = entry.key === DEMO_MUITAS_KEY ? demoMuitas() : { autores: vazia, votacoes: vazia };
    return {
      // como no pg.ts: com "o que propõe" conferido, a frase vira o título simples
      entry: answers?.fields.o_que_propoe.says
        ? { ...entry, reviewedAt: answers.reviewedAt, plain: answers.fields.o_que_propoe.text, verifiedBy: answers.verifiedBy }
        : entry,
      status: { kind: "na_pauta" },
      schedule: [entry],
      readAt: demoWeek().readAt,
      fichaUrl: null,
      presentedOn: null,
      authors: autores.itens,
      votes: votacoes.itens,
      autores,
      votacoes,
      answers,
    };
  },
  async listCorrections() {
    return [];
  },

  // ---------- cobertura por pessoa: a mesma regra do banco (cobertura.ts), com entradas da demonstração ----------
  async getPeopleCoverage(personIds) {
    return personIds.filter((id, i, a) => store().personById.has(id) && a.indexOf(id) === i).map((id) => ({ personId: id, conjuntos: coberturaDe(entradaDemo(id)) }));
  },

  // ---------- lotes: a demonstração é memória, então o lote é o laço sobre a leitura de uma pessoa ----------
  async getPeopleBySlugs(slugs) {
    const pedidos = [...new Set(slugs)];
    const encontradas: { slug: string; person: Person }[] = [];
    const naoEncontradas: string[] = [];
    for (const slug of pedidos) {
      const r = await fakeSource.getPerson(slug);
      if (r) encontradas.push({ slug, person: r.person });
      else naoEncontradas.push(slug);
    }
    return { encontradas, naoEncontradas };
  },
  async getMandatesForPeople(ids) {
    return Object.fromEntries(await Promise.all(ids.filter((id) => store().personById.has(id)).map(async (id) => [id, await fakeSource.getMandates(id)] as const)));
  },
  async getCandidaciesForPeople(ids) {
    return Object.fromEntries(await Promise.all(ids.filter((id) => store().personById.has(id)).map(async (id) => [id, await fakeSource.getCandidacies(id)] as const)));
  },
  async getLawsForPeople(ids) {
    return Object.fromEntries(ids.map((id) => [id, []]));
  },
  async getStatsForPeople(ids, period) {
    return Object.fromEntries(await Promise.all(ids.filter((id) => store().personById.has(id)).map(async (id) => [id, await fakeSource.getStats(id, period)] as const)));
  },
  async getAttendanceGridForPeople(ids, year) {
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await fakeSource.getAttendanceGrid(id, year)] as const)));
  },
  async getRecentLawVotesForPeople(ids, limit) {
    return Object.fromEntries(
      await Promise.all(
        ids.map(async (id) => {
          const p = await fakeSource.listVotes(id, { scope: "lei", limit });
          return [id, { items: p.items, total: p.total }] as const;
        }),
      ),
    );
  },
  async getExpensesByCategoryForPeople(ids, year) {
    return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await fakeSource.listExpenses(id, { year, limit: 1 })).byCategory] as const)));
  },
  async getPlaces(ibges) {
    return [...new Set(ibges)].flatMap((c) => store().placeByIbge.get(c) ?? []);
  },
  async listPocketRules() {
    const terms = ["tributo", "imposto", "alíquota", "contribuição", "salário", "benefício", "aposentadoria", "pensão", "tarifa", "preço", "juros"];
    const themes = [
      "Direito e Defesa do Consumidor",
      "Economia",
      "Finanças Públicas e Orçamento",
      "Indústria, Comércio e Serviços",
      "Previdência e Assistência Social",
      "Trabalho e Emprego",
    ];
    return [
      { version: 2, themes, terms: [...terms, "linha de crédito", "FGTS", "renda", "dívida"], publishedOn: "2026-11-03" },
      { version: 1, themes, terms: [...terms, "crédito", "FGTS", "renda", "dívida"], publishedOn: "2026-11-03" },
    ];
  },
};

function demoWeek() {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7; // segunda = 0
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow, 3)); // 00:00 em Brasília
  return {
    starts: start.toISOString(),
    ends: new Date(start.getTime() + 7 * 86400e3).toISOString(),
    readAt: new Date(now.getTime() - 40 * 60e3).toISOString(),
    at: (day: number, hour: number) => new Date(start.getTime() + day * 86400e3 + hour * 3600e3).toISOString(),
  };
}

/** Proposta sintética (número fora do usado pela Câmara) com respostas publicadas nos três estados. As outras duas seguem sem respostas. */
export const DEMO_ANSWERED_KEY = "camara-pl-9999-2026";

/**
 * Propostas sintéticas fora da pauta da semana (só `getPautaProposal` as acha), para testar quem conferiu: uma revisada
 * por pessoa (como o que a migração 0130 marcou) e outra publicada sem registro de quem conferiu (`verified_by` null).
 */
export const DEMO_QUEM_CONFERIU: Record<string, VerifiedBy> = { "camara-pl-9998-2026": "pessoa", "camara-pl-9997-2026": null };

function demoForaDaSemana(): PautaEntry[] {
  const { at } = demoWeek();
  // 9996 = DEMO_MUITAS_KEY (mais de 5 votações e de 20 autores), sem respostas publicadas
  return [9998, 9997, 9996].map((number) => ({
    key: `camara-pl-${number}-2026`,
    body: "camara",
    type: "PL",
    number,
    year: 2026,
    summary: "Exemplo ilustrativo da demonstração: dispõe sobre a discriminação dos tributos na fatura de energia elétrica residencial.",
    stage: "comissao",
    committee: "CDC",
    scheduledFor: at(-7, 14),
    regime: "Ordinário (Art. 151, III, RICD)",
    rapporteur: null,
    reason: { theme: "Direito e Defesa do Consumidor", term: "tributo" },
  }));
}

// Exemplo ilustrativo: frases e trechos inventados para a demonstração, não são de nenhum texto oficial.
function demoAnswers(verifiedBy: VerifiedBy = "agentes"): PublishedAnswers {
  const diz = (text: string, quote: string, page: number): AnswerClaim => ({ state: "diz", says: true, text, quote, page });
  const vazio = (state: "nao_diz" | "nao_conferido"): AnswerClaim => ({ state, says: false, text: "", quote: "", page: 0 });
  return {
    reviewedAt: demoWeek().readAt,
    verifiedBy,
    sourceUrl: "https://www.camara.leg.br/",
    fields: {
      o_que_propoe: diz("Obriga a conta de luz a mostrar, em linha própria, quanto do valor é imposto.", "a fatura discriminará, em campo próprio, o valor dos tributos incidentes", 1),
      quem_recebe: diz("Quem paga conta de luz em casa passa a ver o imposto separado do consumo.", "aplica-se às unidades consumidoras residenciais", 1),
      quem_paga: vazio("nao_conferido"),
      o_que_muda: diz("A mudança é na forma de mostrar a conta, não no valor cobrado.", "sem alteração das tarifas homologadas", 2),
      dinheiro: { ...vazio("nao_diz"), direction: "nao_diz" },
      estimativa_impacto: vazio("nao_conferido"),
    },
    correction: null,
  };
}

function demoPauta(): PautaEntry[] {
  const { at } = demoWeek();
  return [
    {
      key: "camara-pl-79-2020",
      body: "camara",
      type: "PL",
      number: 79,
      year: 2020,
      summary:
        "Altera o Decreto-Lei nº 1.305, de 8 de janeiro de 1974, e as Leis nºs 5.461, de 25 de junho de 1968, 5.989, de 17 de dezembro de 1973, 7.573, de 23 de dezembro de 1986, 8.706, de 14 de setembro de 1993, e 12.462, de 4 de agosto de 2011, além de dar outras providências, para dispor sobre a destinação das contribuições sociais compulsórias das empresas do setor de transporte aéreo e portuário, incluindo aquelas relativas à contratação do trabalhador portuário avulso (TPA).",
      stage: "plenario",
      committee: null,
      scheduledFor: at(2, 13.9),
      regime: "Urgência (Art. 155, RICD)",
      rapporteur: "Arthur Oliveira Maia",
      reason: { theme: "Indústria, Comércio e Serviços", term: "contribuição" },
    },
    {
      key: "camara-pl-4567-2024",
      body: "camara",
      type: "PL",
      number: 4567,
      year: 2024,
      summary:
        "Inclui na Lei nº 12.933, de 26 de dezembro de 2023, que “dispõe sobre o benefício do pagamento de meia-entrada para estudantes, idosos, pessoas com deficiência e jovens de 15 a 29 anos comprovadamente carentes em espetáculos artístico-culturais e esportivos”, gratuidade para crianças menores de três anos.",
      stage: "comissao",
      committee: "CPASF",
      scheduledFor: at(2, 14),
      regime: "Ordinário (Art. 151, III, RICD)",
      rapporteur: "Nely Aquino",
      reason: { theme: "Indústria, Comércio e Serviços", term: "benefício" },
    },
    {
      key: DEMO_ANSWERED_KEY,
      body: "camara",
      type: "PL",
      number: 9999,
      year: 2026,
      summary: "Exemplo ilustrativo da demonstração: dispõe sobre a discriminação dos tributos na fatura de energia elétrica residencial.",
      stage: "comissao",
      committee: "CDC",
      scheduledFor: at(3, 14),
      regime: "Ordinário (Art. 151, III, RICD)",
      rapporteur: null,
      reason: { theme: "Direito e Defesa do Consumidor", term: "tributo" },
    },
  ];
}

// ---------- casos de borda da demonstração (fora do sorteio do acervo; chaves exportadas para os testes) ----------

/** Votação nominal da Câmara sem voto individual publicado: o placar e o placar por UF viram lacuna. */
export const DEMO_VOTACAO_SEM_VOTOS = "camara-demo-sem-votos";
function demoVotacaoSemVotos(): VotingEventDetail {
  const ev = {
    id: DEMO_VOTACAO_SEM_VOTOS,
    body: "camara" as const,
    kind: "texto" as const,
    occurredAt: "2026-03-10T18:00:00-03:00",
    description: "Exemplo ilustrativo da demonstração: votação nominal sem o voto de cada pessoa publicado",
    topic: null,
    result: "aprovado" as const,
    yes: 0,
    no: 0,
    isNominal: true,
    proposal: null,
  };
  return { ...ev, counts: { sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0 }, orientations: [], byParty: [], votes: [], porUf: placarPorUf(ev, []) };
}

/** Proposta sintética fora da pauta da semana com mais de 5 votações e mais de 20 autores: a tela diz "5 de 7" e "20 de 23". */
export const DEMO_MUITAS_KEY = "camara-pl-9996-2026";
export const DEMO_MUITAS = { votacoes: 7, autores: 23 } as const;
function demoMuitas(): { autores: PautaProposal["autores"]; votacoes: PautaProposal["votacoes"] } {
  const autores = current()
    .filter((m) => m.office === "deputado_federal")
    .map(holder)
    .sort(byName)
    .slice(0, DEMO_MUITAS.autores)
    .map((h, i) => ({ slug: h.person.slug, name: h.person.displayName, role: (i === 0 ? "principal" : "coautoria") as "principal" | "coautoria" }))
    .sort((a, b) => Number(b.role === "principal") - Number(a.role === "principal") || a.name.localeCompare(b.name, "pt-BR"));
  const evs = votesOfBody("camara")
    .events.filter((e) => e.occurredAt.slice(0, 10) <= TODAY && (e.yes || e.no))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, DEMO_MUITAS.votacoes - 1);
  const votacoes = [...evs, demoVotacaoSemVotos()]
    .map((e) => ({ id: e.id, occurredAt: e.occurredAt, description: e.description, result: e.result, yes: e.yes, no: e.no }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  return {
    autores: lista(autores.slice(0, 20), autores.length),
    votacoes: lista(votacoes.slice(0, 5), votacoes.length),
  };
}
