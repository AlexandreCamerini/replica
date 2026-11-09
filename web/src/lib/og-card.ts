// U17 (D281): o card de compartilhar nunca leva número sem fonte, data e ressalva.
// O recorte é o vetor de distorção no WhatsApp: "R$ 1,2 mi" sem "teto, não gasto" vira acusação. Por isso o tipo exige a ressalva
// e `assertCard` derruba a geração (e o teste) se faltar fonte, data ou ressalva. Sem ressalva, o número não entra no card.

export type CardFact = { value: string; label: string; source: string; caveat: string };
export type Card = { facts: CardFact[]; asOf: string };

export class CardError extends Error {}

/** Lança se algum número do card estiver sem fonte ou ressalva, ou se o card estiver sem data. Texto vazio ou só espaço não vale. */
export function assertCard(card: Card): Card {
  const blank = (s: string | undefined | null) => !s || !s.trim();
  if (blank(card.asOf)) throw new CardError("card sem data");
  for (const f of card.facts) {
    if (blank(f.value) || blank(f.label)) throw new CardError("número sem rótulo");
    if (blank(f.source)) throw new CardError(`"${f.label}" sem fonte`);
    if (blank(f.caveat)) throw new CardError(`"${f.label}" sem ressalva`);
  }
  return card;
}

/** Filtra os fatos que ainda não têm ressalva: eles saem do card em vez de sair sem ela. */
export function onlyWithCaveat<T extends Omit<CardFact, "caveat"> & { caveat?: string | null }>(facts: (T | null)[]): CardFact[] {
  return facts.filter((f): f is T & { caveat: string } => !!f && !!f.caveat?.trim()) as CardFact[];
}

// Ressalvas por tipo de número. Texto curto: tem que caber no card de 255 px.
export const CAVEAT = {
  salaryCeiling: "teto, não gasto",
  salary: "bruto, sem correção pela inflação",
  salaryAccrued: "soma nominal, sem correção pela inflação",
  presence: "só sessões deliberativas",
  proposals: "autoria, não aprovação",
  votes: "votos na eleição citada",
  assets: "declarado, sem correção pela inflação",
  raised: "arrecadado, não gasto",
  schedule: "previsão da pauta, pode mudar",
} as const;
