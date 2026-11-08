import type { CoverageCounts } from "@/lib/data/types";

/**
 * Leitura de uma célula da matriz UF × dado (S23).
 * - cities: municípios da UF; noSite: com o dado no site; checked: já conferidos (tudo que não é "desconhecido").
 * - pct só existe se ao menos uma cidade foi conferida; senão a célula é "—" (não conferido ≠ 0%).
 */
export function cellView(c: CoverageCounts | undefined, cities: number) {
  const unknown = c?.desconhecido ?? 0;
  const counted = Object.values(c ?? {}).reduce((a, n) => a + (n ?? 0), 0);
  const checked = Math.max(0, Math.min(cities, counted) - unknown); // cidade sem linha na tabela conta como não conferida
  const noSite = c?.no_site ?? 0;
  return { cities, checked, noSite, pct: checked > 0 && cities > 0 ? Math.round((noSite / cities) * 100) : null };
}
