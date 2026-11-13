// Data de leitura de um conjunto pelo carimbo da carga (getStamp). Puro: sem JSX, sem dado.
// Carimbo ausente ou com data zerada (época 0) não vira data: a tela diz que a data não está registrada.
import { fmtDate } from "./fmt.ts";

type Carimbo = { refreshedAt: string } | null | undefined;

/** ISO da leitura, ou null quando o carimbo não existe ou não tem data válida. */
export function lidoEm(s: Carimbo): string | null {
  if (!s?.refreshedAt) return null;
  const t = new Date(s.refreshedAt).getTime();
  return Number.isFinite(t) && t > 0 ? s.refreshedAt : null;
}

/** ", lida em dd/mm/aaaa" ou ", data da leitura não registrada", para emendar numa linha de fonte. */
export function fraseLida(s: Carimbo, genero: "a" | "as" = "a"): string {
  const iso = lidoEm(s);
  return iso ? `, lid${genero} em ${fmtDate(iso)}` : ", data da leitura não registrada";
}
