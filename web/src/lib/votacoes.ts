import votacoes from "@/data/votacoes.json";

// Já decidido: 6 votações nominais da Câmara sobre dinheiro público, com o voto dos 513 deputados (design/v1, dados.js).
// Fonte: Câmara dos Deputados, dados abertos (votacoesVotos). Só quem registrou voto é nomeado: a Câmara não publica ausência.
// Tudo aqui é puro e roda no servidor; as telas recebem só o que mostram.

export type VoteKey = "S" | "N" | "A" | "P";
export type VoteKeyOrNone = VoteKey | "X";
/** [Sim, Não, abstenção, presidia, não registrou] */
export type Counts = [number, number, number, number, number];
export type Deputy = { id: number; name: string; party: string; uf: string; v: VoteKey };
export type Vote = { id: string; label: string; date: string; what: string; total: Counts; uf: Record<string, Counts>; dep: Deputy[] };

const D = votacoes as unknown as { votes: Vote[]; seats: Record<string, number>; names: Record<string, string>; de: Record<string, string> };
export const VOTES: Vote[] = D.votes;
export const SEATS = D.seats;
export const NAMES = D.names;
/** "do", "da", "de": a preposição muda com o nome do estado. */
export const DE = D.de;
export const UFS = Object.keys(SEATS).sort();
export const CAMARA_SEATS = 513;

export const VOTE_LABEL: Record<VoteKeyOrNone, string> = {
  S: "Votou Sim",
  N: "Votou Não",
  A: "Abstenção",
  P: "Presidia a sessão",
  X: "Sem voto registrado",
};

export const isUf = (s: string | undefined): s is string => !!s && s in SEATS;
export const voteIndex = (v: string | undefined) => {
  const i = Number(v ?? 0);
  return Number.isInteger(i) && i >= 0 && i < VOTES.length ? i : 0;
};

const voted = (c: Counts) => c[0] + c[1] + c[2];
/** % de Sim só entre quem votou (Sim, Não ou abstenção). null = ninguém votou. */
export const pct = (c: Counts) => (voted(c) ? Math.floor((c[0] / voted(c)) * 100) : null);
export const pctText = (c: Counts) => {
  const p = pct(c);
  return p === null ? "–" : `${p}%`;
};
/** "Fora" = não registrou voto + presidia a sessão. */
export const fora = (c: Counts) => c[3] + c[4];

export const nk = (n: number, um: string, vs: string) => (n === 1 ? `1 ${um}` : `${n} ${vs}`);

/** A frase do estado, com os números e nada mais. */
export function stateSentence(uf: string, c: Counts) {
  const p: string[] = [];
  if (c[0]) p.push(nk(c[0], "votou Sim", "votaram Sim"));
  if (c[1]) p.push(nk(c[1], "votou Não", "votaram Não"));
  if (c[2]) p.push(nk(c[2], "se absteve", "se abstiveram"));
  if (c[4]) p.push(nk(c[4], "não registrou voto", "não registraram voto"));
  if (c[3]) p.push("1 presidia a sessão");
  const j = p.length > 1 ? `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}` : (p[0] ?? "");
  return `Dos ${SEATS[uf]} deputados federais ${DE[uf]} ${NAMES[uf]}, ${j}.${c[1] ? "" : " Nenhum votou Não."}`;
}

export const GROUPS: { k: VoteKey; um: string; vs: string }[] = [
  { k: "S", um: "votou Sim", vs: "votaram Sim" },
  { k: "N", um: "votou Não", vs: "votaram Não" },
  { k: "A", um: "se absteve", vs: "se abstiveram" },
  { k: "P", um: "presidia a sessão", vs: "presidiam a sessão" },
];

/** Deputados de um estado numa votação, agrupados por como votaram (só grupos com alguém). */
export function groupsOf(vote: Vote, uf: string) {
  const deps = vote.dep.filter((d) => d.uf === uf);
  return GROUPS.map((g) => ({ ...g, list: deps.filter((d) => d.v === g.k).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }))
    .filter((g) => g.list.length)
    .map((g) => ({ ...g, title: nk(g.list.length, g.um, g.vs) }));
}

/** Quem é a pessoa, pela votação mais recente em que registrou voto. */
export function findDeputy(id: number): Omit<Deputy, "v"> | null {
  for (const v of VOTES) {
    const d = v.dep.find((x) => x.id === id);
    if (d) return { id: d.id, name: d.name, party: d.party, uf: d.uf };
  }
  return null;
}

/** Como a pessoa votou em cada uma das 6 votações. X = sem voto registrado naquela. */
export const history = (id: number) =>
  VOTES.map((v, i) => {
    const d = v.dep.find((x) => x.id === id);
    return { i, vote: v, k: (d ? d.v : "X") as VoteKeyOrNone };
  });

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Todas as pessoas de um estado que registraram voto em alguma das 6 votações, em ordem alfabética. */
export function deputiesOf(uf: string, q?: string): Omit<Deputy, "v">[] {
  const seen = new Map<number, Omit<Deputy, "v">>();
  for (const v of VOTES) for (const d of v.dep) if (d.uf === uf && !seen.has(d.id)) seen.set(d.id, { id: d.id, name: d.name, party: d.party, uf: d.uf });
  const f = q ? fold(q.trim()) : "";
  return [...seen.values()].filter((d) => !f || fold(d.name).includes(f) || fold(d.party) === f).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export const camaraUrl = (id: number) => `https://www.camara.leg.br/deputados/${id}`;

/** Endereço de um nível do Já decidido. Sem JS, cada toque é um link comum. */
export function jaDecididoHref(v: number, uf?: string | null, dep?: number | null) {
  const q = new URLSearchParams();
  if (v) q.set("v", String(v));
  if (uf) q.set("uf", uf);
  if (dep) q.set("dep", String(dep));
  const s = q.toString();
  return `/ja-decidido${s ? `?${s}` : ""}`;
}
