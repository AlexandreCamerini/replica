// Linguagem de estados da D2 (HANDOFF-DIRECAO-2.md §6): a única fonte destas frases. Nenhuma tela escreve outra versão.
// Sem JSX e sem dado: pode ser importado por server e client component.
import type { AnswerState, CoverageStatus, VerifiedBy } from "@/lib/data";
import { fmtDayMonth } from "./fmt";

/** Afirmação (resposta de uma proposta), três estados do contrato + proposta ainda sem respostas publicadas. */
export const AFIRMACAO = {
  /** `nao_conferido`: padrão; nunca afirma nada sobre a lei. */
  naoConferido: "Ainda não conseguimos conferir esta resposta.",
  /** `nao_diz`: só com `estado` gravado e o contraditor confirmando. `diz:false` de linha antiga é `nao_conferido`. */
  naoDiz: "O texto oficial não trata disso.",
  /** proposta sem `answers` publicadas. */
  aguardando: "Aguardando conferência",
} as const;

/**
 * Quem conferiu uma resposta publicada, pela coluna `verified_by` (v1 e v2 usam esta frase; nenhuma tela escreve outra).
 * agentes: "Conferido com o texto oficial por agentes de IA em dd/mm"; pessoa: "Revisado por pessoa em dd/mm";
 * não registrado: "Conferido com o texto oficial em dd/mm", sem dizer por quem.
 */
export const conferidoEm = (iso: string | null | undefined, por: VerifiedBy | undefined = null) =>
  por === "agentes"
    ? `Conferido com o texto oficial por agentes de IA em ${fmtDayMonth(iso)}`
    : por === "pessoa"
      ? `Revisado por pessoa em ${fmtDayMonth(iso)}`
      : `Conferido com o texto oficial em ${fmtDayMonth(iso)}`;

/** Frase de um campo sem afirmação. Falha fechada: só `nao_diz` diz que o texto não trata; o resto é "não conferido". */
export const fraseSemAfirmacao = (state: AnswerState) => (state === "nao_diz" ? AFIRMACAO.naoDiz : AFIRMACAO.naoConferido);

/** Dado que a fonte ainda não entregou, por `CoverageStatus`. `no_site` = lido: não há frase de status. */
export const COBERTURA: Record<Exclude<CoverageStatus, "no_site">, string> = {
  carregando: "Estamos carregando. Ainda não temos esse dado.",
  so_portal: "Está só no portal oficial. Ainda não lemos.",
  nao_publica: "A fonte não publica.",
  desconhecido: "Ainda não temos esse dado.",
};

/** Sem status vindo do contrato: esta frase, sempre com a fonte nomeada ao lado. Nunca "0". */
export const SEM_DADO = "Ainda não temos esse dado.";

/** Frase de cobertura. `no_site` devolve null (o dado foi lido: mostre o dado). Sem status: `SEM_DADO`. */
export function fraseCobertura(status: CoverageStatus | null | undefined): string | null {
  if (status === "no_site") return null;
  return status ? COBERTURA[status] : SEM_DADO;
}

/**
 * Selo "Quem conferiu isso?" e rodapé. Quem conferiu só é dito quando a página tem uma resposta publicada, e pela frase de
 * `conferidoEm` (agentes / pessoa / só a data). Votos, presença e gastos são dado oficial bruto: ninguém os "conferiu".
 */
export const SELO = {
  pergunta: "Quem conferiu isso?",
  /** regra que vale em qualquer página (rodapé, description e selo de página sem uma resposta própria): não afirma quem conferiu */
  regra: "Cada resposta diz quem conferiu e quando. Votos, presença e gastos vêm da fonte oficial, com data.",
  /** Decisão de proposta ainda sem resposta publicada */
  semResposta: "Esta proposta ainda não tem resposta publicada.",
  verConferido: "Ver o que foi conferido",
  apontarErro: "Apontar um erro",
} as const;

/** Destinos do selo. "Apontar um erro" é o mesmo destino que o /v2 já usava no rodapé. */
export const SELO_HREF = { verConferido: "/v2/como-funciona", apontarErro: "/v2/como-funciona#correcoes" } as const;

/** "Já vale?": três estados, cada um com forma própria (círculo cheio, tracejado, cortado). */
export type JaValeEstado = "ja" | "ainda" | "nao";
export const JA_VALE: Record<JaValeEstado, { frase: string; legenda: string }> = {
  ja: { frase: "Já vale.", legenda: "já vale" },
  ainda: { frase: "Ainda não vale.", legenda: "ainda não vale" },
  nao: { frase: "Não passou.", legenda: "não passou" },
};
