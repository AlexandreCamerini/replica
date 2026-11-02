const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export const money = (cents: number, exact = false) => (exact ? brl2 : brl0).format(cents / 100);
export const moneyCompact = (cents: number) => `R$ ${compact.format(cents / 100)}`;
export const count = (n: number) => int.format(n);
export const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
export const monthYear = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00-03:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });

export function age(birth: string | null, today = new Date()) {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  let a = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) a--;
  return a;
}

export const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
