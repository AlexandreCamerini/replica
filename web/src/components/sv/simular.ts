// Simulação de falha de leitura, para testar os estados de erro do /v2 (mesmo padrão de `?simular=erro` na /pauta).
// Só a demonstração lê o parâmetro: com a fonte real (DATA_SOURCE=pg), `simulacao()` devolve sempre null.
import "server-only";
import { data } from "@/lib/data";

/**
 * `erro`: as leituras que a página embrulha com `lerOuFalhar` falham (pessoas, respostas, representantes…).
 * `erro_dados`: em Escolhidos, a pessoa é lida, mas cada conjunto dela (presença, votos, gastos…) e a atividade falham.
 * `camara_nao_lida`: a pauta da Câmara volta sem leitura (`readAt` null), pela opção da fonte demo.
 */
export type Simulacao = "erro" | "erro_dados" | "camara_nao_lida" | null;

export function simulacao(raw: string | string[] | undefined): Simulacao {
  if (!data.isDemo || typeof raw !== "string") return null;
  return raw === "erro" || raw === "erro_dados" || raw === "camara_nao_lida" ? raw : null;
}

/** Com `falhar`, a leitura nem é feita e a promessa é rejeitada, como uma falha real da fonte. */
export function lerOuFalhar<T>(falhar: boolean, ler: () => Promise<T>): Promise<T> {
  return falhar ? Promise.reject(new Error("falha de leitura simulada (demonstração)")) : ler();
}
