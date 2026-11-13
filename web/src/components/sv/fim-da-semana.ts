// Último dia da semana da pauta, em dd/mm/aaaa. Puro: sem JSX, sem dado.
// `weekEnds` é exclusivo (o primeiro instante da semana seguinte): o último dia é o anterior. Semana ausente ou data
// inválida (pg.ts devolve "" sem linha de semana) dá null: a tela omite o "até …", nunca quebra nem inventa a data.
import { fmtDate } from "./fmt.ts";

export function ultimoDiaDaSemana(weekEnds: string | null | undefined): string | null {
  if (!weekEnds) return null;
  const t = new Date(weekEnds).getTime();
  if (!Number.isFinite(t)) return null;
  return fmtDate(new Date(t - 12 * 3600 * 1000).toISOString());
}
