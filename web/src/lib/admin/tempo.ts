// Datas da central em horário de Brasília, com tempo relativo (funções puras; `Intl` com fuso fixo, igual no servidor e no navegador).
// O tempo relativo é calculado contra um `agora` DADO (o relógio do banco que o payload traz, ou o instante da requisição na página): nunca `Date.now()` dentro de um render de cliente,
// senão o HTML do servidor e a hidratação divergem. Sem `agora`, só a data absoluta.
// `textoData` (UTC) de estado-tela.ts continua existindo para o que já o usa; a tela passa a usar estas.

const FUSO = "America/Sao_Paulo";

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function paraData(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(typeof v === "number" || typeof v === "string" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "HH:MM" em Brasília ("sem hora" se a data é inválida). */
export function horaBrasilia(v: unknown): string {
  const d = paraData(v);
  return d ? fmtHora.format(d) : "sem hora";
}

/** "17/11/2026 07:30" em Brasília. Nulo: "sem data"; inválido: "data inválida". */
export function dataBrasilia(v: unknown): string {
  if (v === null || v === undefined || v === "") return "sem data";
  const d = paraData(v);
  return d ? `${fmtData.format(d)} ${fmtHora.format(d)}` : "data inválida";
}

/** "há 3 min", "há 2 h", "há 4 dias", "agora há pouco" (< 10 s), "em 3 min" (futuro). Sem base ou data inválida: "". */
export function tempoRelativo(v: unknown, agora: unknown): string {
  const d = paraData(v);
  const base = paraData(agora);
  if (!d || !base) return "";
  const s = Math.round((base.getTime() - d.getTime()) / 1000);
  const abs = Math.abs(s);
  const futuro = s < 0;
  const un = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  let txt: string;
  if (abs < 10) return "agora há pouco";
  if (abs < 60) txt = `${abs} s`;
  else if (abs < 3600) txt = `${Math.floor(abs / 60)} min`;
  else if (abs < 86400) txt = `${Math.floor(abs / 3600)} h`;
  else txt = un(Math.floor(abs / 86400), "dia", "dias");
  return futuro ? `em ${txt}` : `há ${txt}`;
}

/** "17/11/2026 07:30 (há 3 min)"; sem `agora`, só a data. */
export function dataComRelativo(v: unknown, agora?: unknown): string {
  const abs = dataBrasilia(v);
  const rel = agora === undefined ? "" : tempoRelativo(v, agora);
  return rel ? `${abs} (${rel})` : abs;
}

/** Segundos entre dois instantes (base - v), ou null. */
export function segundosDesde(v: unknown, agora: unknown): number | null {
  const d = paraData(v);
  const base = paraData(agora);
  return d && base ? Math.max(0, Math.round((base.getTime() - d.getTime()) / 1000)) : null;
}
