// Formatação do protótipo Segue o Voto. Datas sempre no fuso de Brasília (BUG-017): o servidor roda em UTC.
const TZ = "America/Sao_Paulo";

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** dd/mm/aaaa. Data sem hora ("2026-11-11") não passa por Date: viraria o dia anterior em Brasília. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = DAY_ONLY.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

/** dd/mm/aaaa, hh:mm */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** "quarta, 11/11" */
export function fmtWeekday(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = DAY_ONLY.exec(iso);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const wd = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long" }).format(d).replace("-feira", "");
  const dm = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
  return `${wd}, ${dm}`;
}

export const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

export const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** "PL 3775/2025" */
export const billLabel = (e: { type: string; number: number; year: number }) => `${e.type} ${e.number}/${e.year}`;

export const BODY_NAME = { camara: "Câmara dos Deputados", senado: "Senado Federal" } as const;

/** dd/mm, no fuso de Brasília (selo "Conferido … em dd/mm"). */
export function fmtDayMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = DAY_ONLY.exec(iso);
  if (m) return `${m[3]}/${m[2]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
}
