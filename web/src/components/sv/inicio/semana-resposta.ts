// Estado da linha "O que muda" de um item de "Esta semana". Função pura (sem import): testada em src/lib/__tests__.
// Só diz "Aguardando conferência" de item SEM resposta publicada (`reviewedAt` vazio). Item com resposta publicada que
// não foi lido (acima do limite de leituras) ou cuja resposta não traz "o que muda" leva à página da decisão; leitura
// que falhou é dita como falha. Nenhum dos dois casos vira "aguardando".

/** Resultado da leitura da resposta de um item: ausente = não lido (fora do limite). */
export type LeituraResposta<T> = { ok: true; muda: T | null } | { ok: false };

export type EstadoResposta = "aguardando" | "falhou" | "na_pagina" | "lida";

export function estadoResposta<T>(reviewedAt: string | null | undefined, leitura: LeituraResposta<T> | undefined): EstadoResposta {
  if (!reviewedAt) return "aguardando";
  if (!leitura) return "na_pagina";
  if (!leitura.ok) return "falhou";
  return leitura.muda ? "lida" : "na_pagina";
}

export const FRASE_RESPOSTA = {
  falhou: "Não conseguimos ler esta resposta agora.",
  naPagina: "Ver a resposta publicada na página da decisão",
} as const;
