// Linguagem de estados da D2 (HANDOFF-DIRECAO-2.md §6): a única fonte destas frases. Nenhuma tela escreve outra versão.
// Sem JSX e sem dado: pode ser importado por server e client component.
import type { AnswerState, CoverageStatus, EstadoCobertura, VerifiedBy } from "@/lib/data";
import { fmtDate, fmtDayMonthAno } from "./fmt";

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
 * agentes: "Conferido com o texto oficial por agentes de IA em <data>"; pessoa: "Revisado por pessoa em <data>";
 * não registrado: "Conferido com o texto oficial em <data>", sem dizer por quem.
 * Data: no v1 sempre dd/mm/aaaa (como era antes); na Direção 2, dd/mm no ano corrente e dd/mm/aaaa em outro ano.
 */
export const conferidoEm = (iso: string | null | undefined, por: VerifiedBy | undefined = null, formato: "v1" | "v2" = "v2") => {
  const quando = formato === "v1" ? fmtDate(iso) : fmtDayMonthAno(iso);
  return por === "agentes"
    ? `Conferido com o texto oficial por agentes de IA em ${quando}`
    : por === "pessoa"
      ? `Revisado por pessoa em ${quando}`
      : `Conferido com o texto oficial em ${quando}`;
};

/** Frase de um campo sem afirmação. Falha fechada: só `nao_diz` diz que o texto não trata; o resto é "não conferido". */
export const fraseSemAfirmacao = (state: AnswerState) => (state === "nao_diz" ? AFIRMACAO.naoDiz : AFIRMACAO.naoConferido);

/** Dado que a fonte ainda não entregou, por `CoverageStatus`. `no_site` = lido: não há frase de status. */
export const COBERTURA: Record<Exclude<CoverageStatus, "no_site">, string> = {
  carregando: "Estamos carregando. Ainda não temos esse dado.",
  so_portal: "Está só no portal oficial. Ainda não lemos.",
  nao_publica: "A fonte não publica.",
  desconhecido: "Ainda não temos esse dado.",
};

/**
 * Estado de cobertura por pessoa (`CoberturaConjunto.estado`, lib/data/cobertura.ts). `lido` não tem frase de lacuna: a tela
 * mostra o dado ou, sem registro, `naoHaNaLeitura`. Cada frase diz o que o banco sabe, nada além.
 */
export const ESTADO_COBERTURA: Record<Exclude<EstadoCobertura, "lido">, string> = {
  sem_fonte: "A fonte não publica.",
  fonte_sem_adaptador: "Está só no portal oficial. Ainda não lemos.",
  nao_carregado: "Ainda não carregamos esse dado.",
  carregado_fora_da_pagina: "Já carregamos, mas esta página ainda não mostra esse dado.",
  nao_conferido: "Ainda não conferimos se a fonte publica.",
  nao_se_aplica: "Este cargo não tem esse dado.",
  fora_do_mandato: "Fora do exercício do mandato.",
};
/** Conjunto lido e sem registro: "não há" com a data da leitura (sem data: diz que não está registrada). */
export const naoHaNaLeitura = (oQue: string, lidoEm: string | null) =>
  `Nenhum registro de ${oQue} ${lidoEm ? `na leitura de ${fmtDate(lidoEm)}` : "na fonte lida (data da leitura não registrada)"}.`;

/** Leitura que falhou (exceção da fonte): lacuna nomeada, distinta de "não há" e de "ainda não temos esse dado". */
export const FALHOU_LEITURA = "Não conseguimos ler esta fonte agora.";

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
  regra: "Cada resposta diz quem conferiu e quando. Votos, presença e gastos vêm da fonte oficial, com a data da leitura quando a fonte a registra.",
  /** Decisão de proposta ainda sem resposta publicada */
  semResposta: "Esta proposta ainda não tem resposta publicada.",
  verConferido: "Ver o que foi conferido",
  apontarErro: "Apontar um erro",
} as const;

/** Destinos do selo. "Apontar um erro" é o mesmo destino que a Direção 2 já usava no rodapé. */
export const SELO_HREF = { verConferido: "/como-funciona", apontarErro: "/como-funciona#correcoes" } as const;

/** "Já vale?": três estados, cada um com forma própria (círculo cheio, tracejado, cortado). */
export type JaValeEstado = "ja" | "ainda" | "nao";
export const JA_VALE: Record<JaValeEstado, { frase: string; legenda: string }> = {
  ja: { frase: "Já vale.", legenda: "já vale" },
  ainda: { frase: "Ainda não vale.", legenda: "ainda não vale" },
  nao: { frase: "Não passou.", legenda: "não passou" },
};
