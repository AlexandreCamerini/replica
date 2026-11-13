// Equipe do gabinete só em agregado (catálogo 08/11, "Não adaptar": nome de assessor é dado de terceiro, pessoa física;
// LGPD). Daqui não sai nome de ninguém: só quantos, por função (como a fonte escreve) e quanto, quando a fonte traz salário.
import type { StaffMember } from "@/lib/data";

export const SEM_FUNCAO = "Função não informada pela fonte";

export type VmEquipe = {
  total: number;
  /** funções em ordem alfabética (nunca por contagem); `n` > 0 sempre */
  funcoes: { funcao: string; n: number }[];
  /** soma do salário mensal publicado; null = nenhuma linha com salário (lacuna, nunca R$ 0) */
  somaMensal: number | null;
  /** pessoas sem salário publicado, quando há soma parcial */
  semSalario: number;
  /** data da lista (a mais recente entre as linhas), ISO */
  dataLista: string | null;
};

export function vmEquipe(rows: StaffMember[]): VmEquipe | null {
  if (rows.length === 0) return null;
  const porFuncao = new Map<string, number>();
  for (const r of rows) {
    const f = r.role?.trim() || SEM_FUNCAO;
    porFuncao.set(f, (porFuncao.get(f) ?? 0) + 1);
  }
  const funcoes = [...porFuncao]
    .map(([funcao, n]) => ({ funcao, n }))
    .sort((a, b) => (a.funcao === SEM_FUNCAO ? 1 : b.funcao === SEM_FUNCAO ? -1 : a.funcao.localeCompare(b.funcao, "pt-BR", { numeric: true })));
  const pagos = rows.filter((r) => r.monthlySalaryCents !== null);
  const datas = rows.map((r) => r.asOf).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d));
  return {
    total: rows.length,
    funcoes,
    somaMensal: pagos.length > 0 ? pagos.reduce((s, r) => s + (r.monthlySalaryCents ?? 0), 0) : null,
    semSalario: pagos.length > 0 ? rows.length - pagos.length : 0,
    dataLista: datas.sort().at(-1) ?? null,
  };
}
