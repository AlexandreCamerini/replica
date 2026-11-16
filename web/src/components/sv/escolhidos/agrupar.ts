// "O que fizeram por último?": junta as linhas que a tela escreveria iguais (D328).
// Puro (sem servidor nem React), para o teste unitário.
//
// A linha de um voto diz a pessoa, o dia, o voto e a proposta. Numa mesma sessão a mesma proposta costuma ter várias
// votações nominais (texto-base, destaques, turnos de uma PEC): são eventos diferentes na fonte, que a tela escrevia com a
// mesma frase, uma embaixo da outra. O mesmo vale para dois gastos da mesma categoria, no mesmo dia e de mesmo valor.
// Aqui cada grupo vira uma linha só, que diz quantos registros são e leva a cada votação.
import { fmtDate } from "../fmt.ts";

/** O que o agrupamento precisa de um item de atividade (`ActivityItem`, de lib/data/types). */
export type Ato = { personSlug: string; personName: string; kind: "voto" | "proposta" | "gasto"; occurredAt: string; title: string; detail: string | null; href: string };

/** Título que a fonte real dá ao voto de uma votação sem proposta ligada (pg.ts, getActivity). */
export const VOTACAO_SEM_PROPOSTA = "Votação nominal";

/**
 * Gasto e proposta têm dia, não hora. A fonte real entrega o dia como meia-noite em UTC, que em Brasília é a noite da
 * véspera: a tela mostrava 14/10 para um gasto de 15/10 (conferido na página de gastos da pessoa). Meia-noite UTC exata
 * num gasto ou numa proposta é dia sem hora, e volta a ser só o dia. Voto tem hora de verdade e não muda.
 */
export function comDiaCerto<T extends Ato>(item: T): T {
  return item.kind !== "voto" && /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(item.occurredAt) ? { ...item, occurredAt: item.occurredAt.slice(0, 10) } : item;
}

export type AtoAgrupado<T extends Ato = Ato> = {
  item: T;
  /** a leitura parou neste dia: pode haver mais registros iguais que não foram lidos, e a contagem é um mínimo */
  aoMenos: boolean;
  /** quantos registros da fonte esta linha representa (1 = linha comum) */
  vezes: number;
  /** destinos distintos, do mais antigo ao mais recente (as votações de um grupo de votos) */
  hrefs: string[];
};

/**
 * Mantém a ordem de chegada (mais recente primeiro): o grupo fica na posição do seu item mais recente.
 * - O mesmo registro lido duas vezes (voto ou proposta com o mesmo destino) conta uma vez.
 * - Votos: conta votações distintas (destinos distintos). Votos diferentes na mesma proposta (Sim numa, Não noutra) não
 *   se juntam: são linhas diferentes de verdade.
 * - Gastos: a fonte não dá um endereço por gasto; cada registro conta.
 * O dia é o que a tela mostra (fuso de Brasília), não o do carimbo em UTC.
 * `lidos`: o teto da leitura. Se a lista veio cheia, registros mais antigos ficaram de fora; os grupos do dia do último
 * item lido podem estar incompletos e saem com `aoMenos`. Os dias mais recentes que ele foram lidos inteiros.
 */
export function agruparAtos<T extends Ato>(itens: readonly T[], lidos = Infinity): AtoAgrupado<T>[] {
  const diaDoCorte = itens.length > 0 && itens.length >= lidos ? fmtDate(itens[itens.length - 1].occurredAt) : null;
  const grupos = new Map<string, Omit<AtoAgrupado<T>, "aoMenos"> & { registros: number }>();
  for (const item of itens) {
    const chave = JSON.stringify([item.personSlug, item.kind, fmtDate(item.occurredAt), item.title, item.detail]);
    const g = grupos.get(chave);
    if (!g) {
      grupos.set(chave, { item, vezes: 1, hrefs: [item.href], registros: 1 });
      continue;
    }
    g.registros++;
    if (!g.hrefs.includes(item.href)) g.hrefs.unshift(item.href); // chegam do mais recente ao mais antigo
    g.vezes = item.kind === "gasto" ? g.registros : item.kind === "voto" ? g.hrefs.length : 1;
  }
  return [...grupos.values()].map(({ item, vezes, hrefs }) => ({ item, vezes, hrefs, aoMenos: fmtDate(item.occurredAt) === diaDoCorte }));
}
