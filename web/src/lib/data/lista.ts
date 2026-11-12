// Página de uma lista com o total que a fonte tem (contrato `Lista<T>`). Puro, importável pelos testes.
import type { Lista } from "./types.ts";

/** `total` vem da mesma consulta (count(*) over ()); nunca menor que a página. `truncado` = há mais do que o devolvido. */
export function lista<T>(itens: T[], total: number): Lista<T> {
  const t = Number.isFinite(total) ? Math.max(total, itens.length) : itens.length;
  return { itens, total: t, truncado: t > itens.length };
}
