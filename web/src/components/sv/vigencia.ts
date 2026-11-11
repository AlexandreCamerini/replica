// "Já vale?" e "o que falta", por tipo de proposta; e o momento da reunião, por status da pauta. Puro: sem JSX, sem dado.
// Única fonte destas frases: Decisão, Início (Esta semana) e Temas usam daqui. Nunca afirma etapa que o tipo não tem.
import type { PautaStatus } from "../../lib/data/types.ts";
import type { JaValeEstado } from "./estados.ts";
import { fmtDate } from "./fmt.ts";

export type Vigencia = {
  /** forma do círculo em <JaVale> */
  estado: JaValeEstado;
  /** frase grande ao lado do círculo */
  frase: string;
  /** linha de apoio, logo abaixo */
  explicacao: string;
  /** "Falta: …" (sem o rótulo) */
  falta: string;
};

/** Medida provisória e projeto de lei de conversão: já valem desde a publicação, até o Congresso decidir. */
const MEDIDA = new Set(["MPV", "PLV"]);
/** Sem sanção: emenda à Constituição e decreto legislativo são promulgados pelo Congresso. */
const PROMULGA_CONGRESSO = new Set(["PEC", "PDL"]);
/** Resoluções de uma Casa só: sem sanção e sem a outra Casa. */
const RESOLUCAO = new Set(["PRC", "PRS", "PR"]);
/** Projetos de lei: passam pela sanção do presidente. */
const LEI = new Set(["PL", "PLP", "PLS", "PLC", "PLN"]);

export function vigenciaDe(type: string): Vigencia {
  const t = (type ?? "").trim().toUpperCase();
  if (MEDIDA.has(t))
    return {
      estado: "ja",
      frase: "Já vale, por enquanto.",
      explicacao: "É uma medida provisória: vale desde a publicação e perde a validade se o Congresso não aprovar no prazo.",
      falta: "O Congresso votar dentro do prazo. Se não aprovar, ela deixa de valer.",
    };
  if (PROMULGA_CONGRESSO.has(t))
    return {
      estado: "ainda",
      frase: "Ainda não vale.",
      explicacao: "É uma proposta. Ainda não vale.",
      falta: "Depois ainda pode passar pelo plenário e pela outra Casa do Congresso. Não vai à sanção do presidente: só vale depois da promulgação pelo Congresso.",
    };
  if (RESOLUCAO.has(t))
    return {
      estado: "ainda",
      frase: "Ainda não vale.",
      explicacao: "É uma proposta. Ainda não vale.",
      falta: "Depois ainda pode passar pelo plenário. Não vai à sanção do presidente: só vale depois da promulgação.",
    };
  if (LEI.has(t))
    return {
      estado: "ainda",
      frase: "Ainda não vale.",
      explicacao: "É uma proposta. Ainda não é lei.",
      falta: "Depois ainda pode passar pelo plenário e pela outra Casa do Congresso, e pela sanção do presidente. Só então vale.",
    };
  return {
    estado: "ainda",
    frase: "Ainda não vale.",
    explicacao: "É uma proposta. Ainda não vale.",
    falta: "Ainda há etapas antes de valer. A ficha da proposta, na Casa, mostra quais.",
  };
}

/**
 * Frase da reunião conforme o status da pauta. Só `na_pauta` fala no presente; o resto diz o que a leitura mostrou.
 * `reuniao` é a data já formatada da reunião em que a proposta foi vista ("quarta, 11/11").
 */
export function reuniaoTexto(status: PautaStatus, reuniao: string): { presente: boolean; frase: string } {
  switch (status.kind) {
    case "saiu":
      return { presente: false, frase: `Estava marcada para ${reuniao} e saiu da pauta em ${fmtDate(status.at)}.` };
    case "reuniao_cancelada":
      return { presente: false, frase: `A reunião de ${reuniao} foi cancelada.` };
    case "reuniao_encerrada":
      return { presente: false, frase: `A reunião de ${reuniao} foi encerrada. O resultado ainda não consta.` };
    case "sem_leitura":
      return { presente: false, frase: `Estava marcada para ${reuniao}. Não aparece na última leitura da pauta.` };
    default:
      return { presente: true, frase: `A reunião é ${reuniao}.` };
  }
}
