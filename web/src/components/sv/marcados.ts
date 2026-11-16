// Quantas das marcações do cookie `sv_sigo` são pessoas que existem hoje nos dados (dívida da D324, fechada na D327).
// O cookie guarda slugs; um slug pode ser de pessoa que deixou de existir, ou o endereço antigo de uma pessoa fundida a
// outra. A frase "Você acompanha N pessoas" conta pessoas, não slugs: a fonte resolve cada slug (inclusive o antigo) e a
// mesma pessoa só conta uma vez. O limite de 12 continua sendo de marcações guardadas, porque é o que o cookie comporta.
import "server-only";
import { data } from "@/lib/data";

export type Marcacoes = {
  /** marcações guardadas no cookie (é o que conta para o limite) */
  guardadas: number;
  /** pessoas distintas que existem nos dados; null = a leitura falhou e não dá para dizer */
  pessoas: number | null;
  /**
   * Slug atual da pessoa → os slugs do cookie que são ela (o atual, um antigo ou os dois). É por aqui que a linha da pessoa
   * aparece marcada quando o cookie só tem o endereço antigo, e que desmarcar tira todos. null = a leitura falhou.
   */
  porPessoa: Record<string, string[]> | null;
  /** slugs do cookie que não entram na conta: pessoa que não aparece mais nos dados, ou repetição de alguém já contado */
  sobrando: string[];
};

export async function contarMarcados(slugs: readonly string[], ler: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()): Promise<Marcacoes> {
  if (slugs.length === 0) return { guardadas: 0, pessoas: 0, porPessoa: {}, sobrando: [] };
  // ordenados: a mesma lista dá a mesma chave de cache, em qualquer ordem em que foi marcada (como em escolhidos/carregar.ts)
  const lidas = await ler(() => data.getPeopleBySlugs([...slugs].sort())).catch(() => null);
  if (!lidas) return { guardadas: slugs.length, pessoas: null, porPessoa: null, sobrando: [] };
  const porId = new Map<string, { atual: string; doCookie: string[] }>();
  for (const e of lidas.encontradas) {
    if (!slugs.includes(e.slug)) continue;
    const p = porId.get(e.person.id) ?? { atual: e.person.slug, doCookie: [] };
    p.doCookie.push(e.slug);
    porId.set(e.person.id, p);
  }
  const porPessoa: Record<string, string[]> = {};
  const contam = new Set<string>();
  for (const { atual, doCookie } of porId.values()) {
    porPessoa[atual] = doCookie;
    // de cada pessoa fica uma marcação: a do endereço atual, se estiver no cookie; senão, a primeira
    contam.add(doCookie.includes(atual) ? atual : doCookie[0]);
  }
  return { guardadas: slugs.length, pessoas: porId.size, porPessoa, sobrando: slugs.filter((s) => !contam.has(s)) };
}
