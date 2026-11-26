// F6 do roteiro do eleitor: a frase de resultado de uma votação na lista ("Aprovada, com 312 Sim e 144 Não."). Módulo puro.
// Só diz o que a fonte publicou: o resultado (aprovado/rejeitado) e o placar Sim/Não do total, SEMPRE rotulado (sem convenção de ordem dos números,
// que o leitor poderia ler ao contrário numa votação rejeitada). Sem placar, sem soma nossa, sem comparação, sem "por maioria": a frase não afirma quórum.
import type { VotingEventSummary } from "@/lib/data/types";

export type ParaResultado = Pick<VotingEventSummary, "result" | "isSecret" | "placarFonte">;

const nf = new Intl.NumberFormat("pt-BR");

/**
 * "Aprovada, com 312 Sim e 144 Não." / "Rejeitada, com 144 Sim e 312 Não." com placar publicado (o zero publicado é dado).
 * Sem placar (secreta ou não publicado): só "Aprovada." / "Rejeitada.". Resultado ausente: "Resultado não publicado pela fonte.".
 */
export function fraseResultado(v: ParaResultado): string {
  if (!v.result) return "Resultado não publicado pela fonte.";
  const palavra = v.result === "aprovado" ? "Aprovada" : "Rejeitada";
  if (v.isSecret) return `${palavra}.`;
  const { sim, nao } = v.placarFonte;
  if (sim === null || nao === null) return `${palavra}.`;
  return `${palavra}, com ${nf.format(sim)} Sim e ${nf.format(nao)} Não.`;
}
