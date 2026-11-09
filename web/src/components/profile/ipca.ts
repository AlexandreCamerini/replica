import type { YearIndicators } from "@/lib/data";

/**
 * U13. Correção pelo IPCA anual (acumulado de dezembro a dezembro, w4_yearly_indicators.ipca_acumulado, em %).
 * Convenção: um valor declarado no ano Y é refeito em reais de dez/L, onde L é o último ano da série, compondo (1 + IPCA) dos anos Y+1 a L.
 * O resto do ano Y fica de fora (a série é anual). Sem ano no meio da série, não há correção (null): nunca se preenche o buraco.
 * Y >= L: fator 1 (ainda não há IPCA fechado depois da declaração).
 */
export type Ipca = { lastYear: number; byYear: Map<number, number> };

export function ipcaOf(rows: YearIndicators[]): Ipca | null {
  const byYear = new Map<number, number>();
  for (const r of rows) {
    const v = r.values.ipca_acumulado;
    if (typeof v === "number" && Number.isFinite(v)) byYear.set(r.year, v);
  }
  if (byYear.size === 0) return null;
  return { lastYear: Math.max(...byYear.keys()), byYear };
}

export function ipcaFactor(fromYear: number, ipca: Ipca): number | null {
  if (fromYear >= ipca.lastYear) return 1;
  let f = 1;
  for (let y = fromYear + 1; y <= ipca.lastYear; y++) {
    const p = ipca.byYear.get(y);
    if (p === undefined) return null;
    f *= 1 + p / 100;
  }
  return f;
}

/** Valor em centavos refeito em reais de dez/lastYear. null = série sem algum ano do intervalo. */
export function correctCents(cents: number, fromYear: number, ipca: Ipca): number | null {
  const f = ipcaFactor(fromYear, ipca);
  return f === null ? null : Math.round(cents * f);
}
