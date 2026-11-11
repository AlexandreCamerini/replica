// Datas do Início no fuso de Brasília (o servidor roda em UTC). Chave de dia = "aaaa-mm-dd".
const TZ = "America/Sao_Paulo";
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const WD = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long" });
const MO = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" });

/** Dia (em Brasília) de um instante ISO, de uma data sem hora ou de um Date. Inválido: null. */
export function dayKey(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string" && DAY.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : keyFmt.format(d);
}

const utc = (key: string) => {
  const m = DAY.exec(key)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
};

export const hojeKey = () => dayKey(new Date()) as string;
export const addDays = (key: string, n: number) => new Date(utc(key).getTime() + n * 86400e3).toISOString().slice(0, 10);
/** "terça", "sábado": sem "-feira". */
export const weekday = (key: string) => WD.format(utc(key)).replace("-feira", "");
export const dayNum = (key: string) => Number(key.slice(8));
/** Segunda-feira da semana de `key`. */
export const mondayOf = (key: string) => addDays(key, -((utc(key).getUTCDay() + 6) % 7));

const dd = (key: string) => (dayNum(key) === 1 ? "1º" : String(dayNum(key)));
const month = (key: string) => MO.format(utc(key));

/** "3 de setembro de 2026" */
export const fmtLong = (key: string) => `${dd(key)} de ${month(key)} de ${key.slice(0, 4)}`;
/** "terça, 10/11/2026" */
export const fmtFolio = (key: string) => `${weekday(key)}, ${key.slice(8)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
/** "9 a 15 de novembro" ou "30 de novembro a 6 de dezembro" */
export const fmtRange = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${dd(a)} a ${dd(b)} de ${month(b)}` : `${dd(a)} de ${month(a)} a ${dd(b)} de ${month(b)}`);
/** "quarta, 11/11" */
export const fmtDiaMes = (key: string) => `${weekday(key)}, ${key.slice(8)}/${key.slice(5, 7)}`;
