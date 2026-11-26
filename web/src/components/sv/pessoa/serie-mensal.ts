// F7 do roteiro do eleitor: série mensal do gasto da própria pessoa e teto legal da cota. Módulo puro.
// Regras: nunca compara pessoas; mês sem nota é "sem nota" (lacuna), nunca R$ 0; a série só aparece se fecha com o total do ano.

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

export type LinhaMes = { mes: string; nome: string; cents: number | null; notas: number };
export type SerieMensal = { ano: number; linhas: LinhaMes[]; totalCents: number };

/**
 * Monta os 12 meses do ano. `porMes` vem de `getMandateSpend` (mês "AAAA-MM", cronológico). Mês de outro ano é ignorado.
 * Devolve null quando a soma dos meses não bate com `totalAnoCents` (a série não fecha com o total por categoria: melhor não mostrar do que mostrar torto).
 */
export function serieMensal(porMes: readonly { mes: string; cents: number; notas: number }[], ano: number, totalAnoCents: number): SerieMensal | null {
  const mapa = new Map(porMes.filter((m) => m.mes.startsWith(`${ano}-`)).map((m) => [m.mes, m] as const));
  const linhas = MESES.map<LinhaMes>((nome, i) => {
    const chave = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const m = mapa.get(chave);
    return { mes: chave, nome, cents: m ? m.cents : null, notas: m ? m.notas : 0 };
  });
  const total = linhas.reduce((s, l) => s + (l.cents ?? 0), 0);
  if (total !== totalAnoCents) return null;
  return { ano, linhas, totalCents: total };
}

/**
 * Teto legal da cota por UF e vigência. CONJUNTO AINDA NÃO CARREGADO: o dado só entra depois de conferido contra a fonte oficial
 * (amostra de 10 deputados de UFs diferentes). Cada item: { uf, de, ate|null, cents, fonte, lidoEm }.
 */
export type TetoCota = { uf: string; de: string; ate: string | null; cents: number; fonte: string; lidoEm: string };
export const TETOS_COTA: readonly TetoCota[] = [];

export type TetoDe = { estado: "lido"; teto: TetoCota } | { estado: "nao_carregado"; motivo: string };

/** Teto vigente numa data (AAAA-MM-DD) para uma UF. Sem item que cubra a data: lacuna nomeada, nunca um valor suposto. */
export function tetoDe(uf: string | null, data: string, tabela: readonly TetoCota[] = TETOS_COTA): TetoDe {
  if (!uf) return { estado: "nao_carregado", motivo: "A UF do mandato não está no cadastro." };
  const t = tabela.find((x) => x.uf === uf && x.de <= data && (x.ate === null || data <= x.ate));
  return t ? { estado: "lido", teto: t } : { estado: "nao_carregado", motivo: "O teto da cota para esta UF e esta data ainda não foi carregado e conferido com a Câmara." };
}
