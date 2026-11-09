import type { Body, PautaEntry } from "./data/types";

// Regras de texto da pauta "No seu bolso": endereço da proposta, tradução de sigla, quem decide e datas.
// Tudo aqui é puro; as telas e as duas fontes de dados (pg, fake) usam as mesmas funções.

const TZ = "America/Sao_Paulo";

export const proposalKey = (body: Body, type: string, number: number, year: number) => `${body}-${type.toLowerCase()}-${number}-${year}`;

export function parseProposalKey(key: string): { body: Body; type: string; number: number; year: number } | null {
  const m = /^(camara|senado)-([a-z]{2,4})-(\d{1,6})-(\d{4})$/.exec(key);
  if (!m) return null;
  return { body: m[1] as Body, type: m[2].toUpperCase(), number: Number(m[3]), year: Number(m[4]) };
}

export const label = (e: Pick<PautaEntry, "type" | "number" | "year">) => `${e.type} ${e.number}/${e.year}`;
export const bodyName = (b: Body) => (b === "camara" ? "Câmara" : "Senado");
/** "da Câmara" / "do Senado": a preposição muda com o gênero. */
export const ofBody = (b: Body) => (b === "camara" ? "da Câmara" : "do Senado");
export const bodyFullName = (b: Body) => (b === "camara" ? "Câmara dos Deputados" : "Senado Federal");

/** A sigla nunca aparece sozinha (Regra editorial, glossário). */
export const TYPE_NAME: Record<string, string> = {
  PL: "lei comum",
  PLP: "lei complementar",
  PEC: "mudança na Constituição",
  MPV: "medida provisória",
  PLV: "lei vinda de medida provisória",
  PDL: "decreto do Congresso",
};
export const typeName = (t: string) => TYPE_NAME[t] ?? "proposta";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** O regex da regra devolve o radical que casou ("contribuic"); a tela mostra o termo público ("contribuição"). */
export function termLabel(stem: string, terms: string[]): string {
  const f = fold(stem);
  return terms.find((t) => fold(t).startsWith(f) || f.startsWith(fold(t))) ?? (f.startsWith("pensoes") ? "pensão" : stem);
}

export function reasonText(e: Pick<PautaEntry, "reason" | "body">): string {
  if (e.reason.theme) return `Tema oficial da Câmara: ${e.reason.theme}. Termo na ementa: "${e.reason.term}".`;
  return `Termo na ementa: "${e.reason.term}".`;
}

/** Quem decide e quantos votos precisa. Números do regimento, não da proposta. */
export function deciders(e: Pick<PautaEntry, "body" | "type" | "stage" | "committee">): { who: string; needs: string } {
  if (e.stage === "comissao") {
    return {
      who: `Os membros da comissão${e.committee ? ` ${e.committee}` : ""}, na ${bodyName(e.body)}.`,
      needs: "Uma comissão é uma etapa. A decisão final costuma vir depois.",
    };
  }
  const camara = e.body === "camara";
  const who = camara ? "Os 513 deputados, no plenário da Câmara." : "Os 81 senadores, no plenário do Senado.";
  if (e.type === "PEC") return { who, needs: camara ? "Precisa de 308 votos, em duas votações." : "Precisa de 49 votos, em duas votações." };
  if (e.type === "PLP") return { who, needs: camara ? "Precisa de 257 votos, por ser lei complementar." : "Precisa de 41 votos, por ser lei complementar." };
  return { who, needs: "Precisa da maioria de quem está presente." };
}

/** Só o regime de urgência muda algo para quem lê; o resto é detalhe de regimento e não vai para a tela. */
export const isUrgent = (regime: string | null) => Boolean(regime && /urg[êe]ncia/i.test(regime));

export const dayLong = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit" }).replace(/^./, (c) => c.toUpperCase());
export const dayShort = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", ",");
export const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
/** Chave do dia em Brasília, para agrupar a lista. */
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });

/** Último dia da semana corrente (week_ends é a segunda seguinte, exclusiva). */
export const weekLastDay = (weekEnds: string) => new Date(new Date(weekEnds).getTime() - 12 * 3600 * 1000).toISOString();

/** Leitura com mais de 24 h: aviso de sistema (Regra 2). */
export const isStale = (readAt: string | null, now = Date.now()) => !readAt || now - new Date(readAt).getTime() > 24 * 3600 * 1000;

/** Uma proposta conta uma vez, mesmo em duas reuniões: fica a mais cedo. */
export function uniqueByKey<T extends PautaEntry>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const prev = seen.get(r.key);
    if (!prev || r.scheduledFor < prev.scheduledFor) seen.set(r.key, r);
  }
  return [...seen.values()].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.key.localeCompare(b.key));
}
