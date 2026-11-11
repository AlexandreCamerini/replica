// Regra única do placar de uma votação (Início "Já rolou" e Decisão). Puro: sem JSX, sem dado.
// Votação sem votos individuais nunca vira placar de zeros: vira lacuna com o motivo.
import type { VoteValue } from "../../lib/data/types.ts";

type Ev = { isSecret?: boolean; openNoVotes?: boolean; isNominal?: boolean; counts: Record<VoteValue, number> };

export type PlacarDe =
  | { kind: "placar"; sim: number; nao: number; abs: number; sem: number; obstrucao: number; total: number }
  /** `motivo` null: sem motivo publicado; a tela usa a lacuna padrão ("Ainda não temos esse dado.") com a fonte. */
  | { kind: "lacuna"; motivo: string | null };

export const PLACAR_MOTIVO = {
  secreta: "Votação secreta: a fonte não publica o voto de cada pessoa.",
  semVotos: "A fonte diz que a votação foi aberta, mas não publicou o voto de cada pessoa.",
} as const;

export function placarDe(ev: Ev): PlacarDe {
  if (ev.isSecret) return { kind: "lacuna", motivo: PLACAR_MOTIVO.secreta };
  if (ev.openNoVotes) return { kind: "lacuna", motivo: PLACAR_MOTIVO.semVotos };
  const c = ev.counts ?? ({} as Record<VoteValue, number>);
  const n = (v: VoteValue) => (Number.isFinite(c[v]) ? Math.max(0, c[v]) : 0);
  const total = (Object.keys(c) as VoteValue[]).reduce((s, v) => s + n(v), 0);
  if (!ev.isNominal || total === 0) return { kind: "lacuna", motivo: null };
  // "Sem voto" soma quem não registrou voto e quem presidia; obstrução é ato deliberado e sai numa nota própria
  return { kind: "placar", sim: n("sim"), nao: n("nao"), abs: n("abstencao"), sem: n("nao_votou") + n("art17"), obstrucao: n("obstrucao"), total };
}
