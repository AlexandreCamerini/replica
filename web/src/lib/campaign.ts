import type { Candidacy } from "@/lib/data/types";

export type Campaign = { year: number; raisedCents: number | null; spentCents: number | null };

/**
 * Uma campanha por ano de eleição. O TSE publica a prestação de contas por campanha, e o banco repete o mesmo
 * total nas candidaturas de 1º e 2º turno (decisão D44): somar por candidatura dobraria quem foi ao 2º turno
 * (Tarcísio 2022 viraria R$ 77 mi em vez de R$ 38,6 mi). Ordem: ano mais recente primeiro.
 */
export function campaignsByYear(cands: Pick<Candidacy, "year" | "raisedCents" | "spentCents">[]): Campaign[] {
  const by = new Map<number, Campaign>();
  for (const c of cands) {
    const cur = by.get(c.year);
    if (!cur) by.set(c.year, { year: c.year, raisedCents: c.raisedCents, spentCents: c.spentCents });
    else {
      // mesmo ano, outro turno: o valor é o mesmo; fica o que não é nulo
      cur.raisedCents ??= c.raisedCents;
      cur.spentCents ??= c.spentCents;
    }
  }
  return [...by.values()].sort((a, b) => b.year - a.year);
}

/** Soma das campanhas com valor publicado. null quando nenhuma tem (nunca 0 por falta de dado). */
export function campaignTotals(cands: Pick<Candidacy, "year" | "raisedCents" | "spentCents">[]) {
  const all = campaignsByYear(cands);
  const raised = all.filter((c) => c.raisedCents !== null);
  const spent = all.filter((c) => c.spentCents !== null);
  return {
    years: raised.map((c) => c.year).sort((a, b) => a - b),
    raisedCents: raised.length ? raised.reduce((s, c) => s + c.raisedCents!, 0) : null,
    spentCents: spent.length ? spent.reduce((s, c) => s + c.spentCents!, 0) : null,
  };
}

/** "2022" · "2022 e 2026" · "2018, 2022 e 2026" */
export const joinYears = (ys: number[]) => (ys.length <= 1 ? ys.join("") : `${ys.slice(0, -1).join(", ")} e ${ys[ys.length - 1]}`);
