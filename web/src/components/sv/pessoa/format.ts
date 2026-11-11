// Formatação e leitura segura da tela Pessoa (D2). Sem JSX. Datas no fuso de Brasília, como o resto do /v2.
import { fmtDate } from "@/components/sv/fmt";
import type { CoverageStatus, MissingDataset, Stamp } from "@/lib/data";

const NBSP = " ";

/** Valor exato em reais, com centavos: "R$ 6.200,45". Para tabelas. */
export function brl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\s/g, NBSP);
}

/** Valor curto para frases: "R$ 420 mil", "R$ 2,4 milhões". Abaixo de mil, o valor exato. */
export function brlCurto(cents: number): string {
  const reais = Math.abs(cents) / 100;
  const sinal = cents < 0 ? "-" : "";
  if (reais >= 1e6) {
    const m = Math.round((reais / 1e6) * 10) / 10;
    return `${sinal}R$${NBSP}${String(m).replace(".", ",")}${NBSP}${m === 1 ? "milhão" : "milhões"}`;
  }
  if (reais >= 1e3) {
    const k = reais < 1e4 ? Math.round((reais / 1e3) * 10) / 10 : Math.round(reais / 1e3);
    return `${sinal}R$${NBSP}${String(k).replace(".", ",")}${NBSP}mil`;
  }
  return sinal + brl(Math.abs(cents));
}

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
export const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"] as const;

/** Hoje no fuso de Brasília. */
export function hojeBR(): { ano: number; mes: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { ano: g("year"), mes: g("month"), dia: g("day") };
}

/** "mm/aaaa" de uma data ISO. */
export function mesAno(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[1]}` : "—";
}

export function listaE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** Resultado de uma leitura que pode falhar: a falha vira lacuna na tela, nunca erro de página nem zero. */
export type Leitura<T> = { ok: true; v: T } | { ok: false };
export async function ler<T>(p: Promise<T>): Promise<Leitura<T>> {
  try {
    return { ok: true, v: await p };
  } catch {
    return { ok: false };
  }
}

/** Carimbo sem data real (a camada de dados devolve a época zero quando não há carimbo). */
const semData = (s: Stamp) => new Date(s.refreshedAt).getFullYear() < 2000;

/**
 * "Câmara dos Deputados, cota parlamentar, lida em 09/11/2026". Carimbo sem data: diz que a data não está registrada.
 * Sem carimbo: se o dado apareceu (`casaComDado`, o nome da casa do mandato), cita essa casa com "data da leitura não
 * registrada"; "ainda não lemos nenhuma fonte…" só quando não há dado.
 */
export function fonteTexto(rotulo: string, s: Stamp | null, casaComDado?: string | null): string {
  if (!s) return casaComDado ? `${casaComDado}, ${rotulo}, data da leitura não registrada` : `ainda não lemos nenhuma fonte de ${rotulo} para este cargo`;
  return semData(s) ? `${s.source}, ${rotulo}, data da leitura não registrada` : `${s.source}, ${rotulo}, lida em ${fmtDate(s.refreshedAt)}`;
}

/** Status que vale para a lacuna: o do contrato quando existe e não é "lido"; senão nenhum (frase padrão). */
export function statusLacuna(missing: MissingDataset[], dataset: MissingDataset["dataset"]): { status: CoverageStatus | null; motivo: string | null } {
  const m = missing.find((x) => x.dataset === dataset);
  if (!m) return { status: null, motivo: null };
  return { status: m.status === "no_site" ? null : m.status, motivo: m.status === "no_site" ? null : m.reason };
}
