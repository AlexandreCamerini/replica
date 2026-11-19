// Estado operacional do executor para a tela (funções puras). Fonte: o que /admin/api/estado já traz (executor + pedidosRecentes, com o relógio do banco em `agora`).
// O executor só grava batimento enquanto executa um pedido: com a fila vazia não há batimento. Por isso "visto há X" usa o ÚLTIMO SINAL registrado nos pedidos recentes
// (batimento, fim ou início do pedido mais recente), e diz "sem sinal registrado" quando não há nenhum nos 20 pedidos mais recentes. Nada é inventado.
import { dataBrasilia, paraData, segundosDesde, tempoRelativo } from "./tempo.ts";

export type PedidoRecente = { iniciado_em?: unknown; batimento_em?: unknown; finalizado_em?: unknown; criado_em?: unknown };

/** Instante do último sinal do executor (o mais recente entre batimento, fim e início), ou null. */
export function ultimoSinal(pedidos: readonly PedidoRecente[] | null | undefined): Date | null {
  let melhor: Date | null = null;
  for (const p of pedidos ?? []) {
    for (const v of [p.batimento_em, p.finalizado_em, p.iniciado_em]) {
      const d = paraData(v);
      if (d && (!melhor || d.getTime() > melhor.getTime())) melhor = d;
    }
  }
  return melhor;
}

/** A promessa da tela: o laço do executor consulta a fila a cada 2 s (padrão da CLI e do container) e a tela atualiza a cada 5 s. */
export const PROMESSA_EXECUTOR = "Com o executor ativo, um pedido começa em até ~5 s.";

export type ResumoExecutor = {
  /** "Executor visto há 12 s (17/11/2026 07:30)" ou "Sem sinal registrado do executor nos pedidos recentes" */
  visto: string;
  /** "Último sinal há 12 s" no estado parado, ou o mesmo "visto" */
  segundosDesdeSinal: number | null;
  promessa: string;
};

export function resumoDoExecutor(pedidos: readonly PedidoRecente[] | null | undefined, agora: unknown): ResumoExecutor {
  const sinal = ultimoSinal(pedidos);
  if (!sinal) return { visto: "Sem sinal registrado do executor nos pedidos recentes", segundosDesdeSinal: null, promessa: PROMESSA_EXECUTOR };
  const rel = tempoRelativo(sinal, agora);
  const quando = rel === "" ? dataBrasilia(sinal) : `${rel} (${dataBrasilia(sinal)})`;
  return { visto: `Executor visto ${quando}`, segundosDesdeSinal: segundosDesde(sinal, agora), promessa: PROMESSA_EXECUTOR };
}
