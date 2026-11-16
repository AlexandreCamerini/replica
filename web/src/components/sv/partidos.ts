// Filtro por partido na escolha de político (D328). Puro: sem JSX, sem dado, para valer em teste.
// Regra do dono (16/11/2026): na hora de escolher em quem votou, o partido é sempre um dos filtros, e a lista de pessoas
// só aparece depois que o eleitor filtra. Partido é palavra no filtro: nunca cor, nunca ordem de mérito (lista A–Z).

export type PartidoOpcao = { id: string; acronym: string; name: string };

const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * O partido pedido no endereço (`partido=<id>`), conferido contra a lista lida. Fora da lista, fora do padrão, repetido
 * (array) ou sem lista lida: null. Nunca chega à consulta um valor que não veio da própria lista.
 */
export function escolherPartido(raw: unknown, lista: readonly PartidoOpcao[] | null): PartidoOpcao | null {
  if (typeof raw !== "string" || !ID.test(raw) || !lista) return null;
  return lista.find((p) => p.id === raw) ?? null;
}

/** Lista para o campo: em ordem alfabética da sigla, sem repetição de id. */
export function opcoesDePartido(lista: readonly PartidoOpcao[]): PartidoOpcao[] {
  const vistos = new Set<string>();
  return lista.filter((p) => !vistos.has(p.id) && !!vistos.add(p.id)).sort((a, b) => a.acronym.localeCompare(b.acronym, "pt-BR"));
}

/** "PT (Partido dos Trabalhadores)"; só a sigla quando o nome é igual a ela ou falta. */
export const rotuloPartido = (p: PartidoOpcao) => (p.name && p.name !== p.acronym ? `${p.acronym} (${p.name})` : p.acronym);
