// Visão consolidada do mandato (D50): a janela, o "desde AAAA", a lacuna no lugar do zero e a soma de salário + cota.
// Puro: sem banco, sem JSX. Importável pelos testes (node --test): imports com extensão e só de tipo.
//
// Regras que este módulo carrega:
//  - A janela do mandato é [max(início do mandato, 1º de janeiro do primeiro ano com dado carregado), fim ou hoje].
//  - Quando o mandato começou antes do primeiro ano carregado, a janela é "truncada": a tela NUNCA diz "total do mandato",
//    diz "no que está carregado desde AAAA".
//  - Sem dado = null (a tela escreve "—" e o motivo). Zero só quando a fonte foi lida e o resultado é zero.
//  - Nada aqui ordena por valor, calcula média ou compara com outra pessoa.
import type { CommitteeItem, MandateSpend, SalaryAccrued, YearStats } from "./data/types.ts";

const ISO = /^\d{4}-\d{2}-\d{2}/;
const anoDe = (iso: string) => Number(iso.slice(0, 4));
const pt = (a: string, b: string) => a.localeCompare(b, "pt-BR");
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export type Janela = {
  /** primeiro dia da janela (ISO): o início do mandato ou 1º de janeiro do primeiro ano carregado, o que vier depois */
  inicio: string;
  /** último dia do mandato já terminado (ISO); null = em curso, vale até hoje */
  fim: string | null;
  /** ano que a tela escreve em "desde AAAA" */
  desdeAno: number;
  /** o mandato começou antes do primeiro ano carregado: o que se soma é parte do mandato, e a tela diz isso */
  truncada: boolean;
  /** ano do início do mandato (a tela compara com o ano em que cada número começa) */
  anoInicioMandato: number;
  /** primeiro ano com dado carregado (null = nenhum dado de gasto carregado) */
  primeiroAnoCarregado: number | null;
};

/**
 * Janela de um mandato sobre um conjunto que só existe a partir de um ano (o primeiro ano com nota carregada).
 * `fim` só vale se o mandato já terminou antes de hoje; mandato em curso fica com fim null.
 */
export function janelaMandato(e: { inicio: string; fim?: string | null; primeiraNotaEm: string | null; hojeIso: string }): Janela | null {
  if (!ISO.test(e.inicio)) return null;
  const inicioMandato = e.inicio.slice(0, 10);
  const primeiro = e.primeiraNotaEm && ISO.test(e.primeiraNotaEm) ? anoDe(e.primeiraNotaEm) : null;
  const corte = primeiro === null ? null : `${primeiro}-01-01`;
  const truncada = corte !== null && corte > inicioMandato;
  const fim = e.fim && ISO.test(e.fim) && e.fim.slice(0, 10) < e.hojeIso ? e.fim.slice(0, 10) : null;
  return {
    inicio: truncada && corte ? corte : inicioMandato,
    fim,
    desdeAno: truncada && primeiro !== null ? primeiro : anoDe(inicioMandato),
    truncada,
    anoInicioMandato: anoDe(inicioMandato),
    primeiroAnoCarregado: primeiro,
  };
}

/**
 * Quanto do mandato o número cobre, em palavras. `desdeAno` = primeiro ano com dado DAQUELE número (D50: cada número diz o
 * seu). Mandato inteiro só quando o dado começa no ano da posse ou antes; senão, "no que está carregado desde AAAA".
 */
export function frasePeriodo(desdeAno: number, j: Pick<Janela, "anoInicioMandato" | "truncada">): string {
  return j.truncada || desdeAno > j.anoInicioMandato ? `no que está carregado desde ${desdeAno}` : `no mandato, desde ${desdeAno}`;
}

/** Meses "AAAA-MM" de a até b, inclusive. Entrada inválida ou invertida = lista vazia. */
export function mesesEntre(a: string, b: string): string[] {
  const ok = /^\d{4}-\d{2}$/;
  if (!ok.test(a) || !ok.test(b) || a > b) return [];
  const out: string[] = [];
  let [y, m] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  while (y < yb || (y === yb && m <= mb)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type VmGastoMandato = {
  janela: Janela;
  /** soma das notas na janela, como a fonte publica (estorno negativo entra) */
  totalCents: number;
  notas: number;
  /** categoria como a fonte escreve, em ordem A–Z. Nunca por valor. */
  categorias: { label: string; cents: number; notas: number }[];
  /** do primeiro ao último mês com nota, em ordem cronológica; `cents` null = mês sem nota na fonte (a tela escreve "—", nunca R$ 0) */
  meses: { mes: string; cents: number | null; notas: number }[];
  /** quantos meses entre o primeiro e o último com nota não têm nota nenhuma */
  mesesSemNota: number;
  /** a tabela mostra estorno (valor negativo) */
  temEstorno: boolean;
};

/** Gasto do mandato em tabelas. Sem nota na janela = null: lacuna, nunca R$ 0. */
export function vmGastoMandato(spend: MandateSpend, janela: Janela): VmGastoMandato | null {
  if (spend.notas === 0 || spend.porCategoria.length === 0) return null;
  const porMes = new Map(spend.porMes.map((m) => [m.mes, m]));
  const chaves = [...porMes.keys()].sort();
  const meses = chaves.length === 0 ? [] : mesesEntre(chaves[0], chaves[chaves.length - 1]).map((mes) => ({ mes, cents: porMes.get(mes)?.cents ?? null, notas: porMes.get(mes)?.notas ?? 0 }));
  const categorias = [...spend.porCategoria].sort((a, b) => pt(a.label, b.label));
  return {
    janela,
    totalCents: spend.totalCents,
    notas: spend.notas,
    categorias,
    meses,
    mesesSemNota: meses.filter((m) => m.cents === null).length,
    temEstorno: categorias.some((c) => c.cents < 0) || meses.some((m) => (m.cents ?? 0) < 0),
  };
}

export type CustoMandato =
  | {
      estado: "soma";
      totalCents: number;
      salarioCents: number;
      cotaCents: number;
      /** o que ficou de fora da soma, uma frase por item */
      fora: string[];
    }
  | {
      estado: "sem_soma";
      salarioCents: number | null;
      cotaCents: number | null;
      /** quais das duas partes falta */
      faltam: ("salário" | "cota")[];
      fora: string[];
    };

const mm = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Salário + cota. Só soma quando as DUAS existem, e diz o que ficou de fora: os meses sem valor de salário carregado e os
 * meses do intervalo sem nota de cota. Uma parte só nunca vira "total": aparece sozinha, a outra como lacuna.
 */
export function custoMandato(e: { salario: SalaryAccrued | null; cotaCents: number | null; mesesSemNotaCota: number }): CustoMandato {
  const { salario } = e;
  const fora: string[] = [];
  if (salario && salario.coveredMonths < salario.months) {
    const n = salario.months - salario.coveredMonths;
    fora.push(`${n} ${plural(n, "mês", "meses")} sem valor de salário carregado${salario.coveredFrom ? `, antes de ${mm(salario.coveredFrom)}` : ""}.`);
  }
  if (e.cotaCents !== null && e.mesesSemNotaCota > 0) {
    fora.push(`${e.mesesSemNotaCota} ${plural(e.mesesSemNotaCota, "mês", "meses")} sem nota de cota na fonte, entre o primeiro e o último com nota.`);
  }
  if (salario && e.cotaCents !== null) return { estado: "soma", totalCents: salario.cents + e.cotaCents, salarioCents: salario.cents, cotaCents: e.cotaCents, fora };
  const faltam: ("salário" | "cota")[] = [];
  if (!salario) faltam.push("salário");
  if (e.cotaCents === null) faltam.push("cota");
  return { estado: "sem_soma", salarioCents: salario?.cents ?? null, cotaCents: e.cotaCents, faltam, fora };
}

type CampoAnual = keyof Pick<YearStats, "presencePresent" | "presenceTotal" | "proposalsPrincipal" | "proposalsCosigned" | "votesRegistered" | "expensesCents">;

/**
 * Soma de um número anual (person_period_stats por ano) dos anos que a janela cobre. Ano com `null` (fonte não carregada)
 * não entra e não vira zero. `desde` = primeiro ano em que HÁ valor, não o primeiro ano da janela. Nenhum ano com valor = null.
 */
export function somaAnual(rows: readonly YearStats[], campo: CampoAnual, anoMin: number, anoMax: number): { valor: number; desde: number; ate: number } | null {
  const com = rows.filter((r) => r.year >= anoMin && r.year <= anoMax && r[campo] !== null);
  if (com.length === 0) return null;
  return { valor: com.reduce((s, r) => s + (r[campo] ?? 0), 0), desde: Math.min(...com.map((r) => r.year)), ate: Math.max(...com.map((r) => r.year)) };
}

/** Comissões que se sobrepõem à janela, em ordem A–Z (nunca por data ou tamanho). */
export function comissoesNaJanela(lista: readonly CommitteeItem[], inicio: string, fim: string | null): CommitteeItem[] {
  return lista
    .filter((c) => (c.to === null || c.to >= inicio) && (fim === null || c.from <= fim))
    .sort((a, b) => pt(a.name, b.name) || pt(a.role, b.role) || a.from.localeCompare(b.from));
}
