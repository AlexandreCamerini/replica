// Orientação oficial da bancada ao lado do voto (F4 do roteiro do eleitor, eixo A, pergunta 5). Puro, para o teste unitário.
//
// Só o fato que a fonte registra, em duas frases lado a lado com o voto: o que a bancada orientou e o que a pessoa votou. Não há conta
// nem rótulo de divergência ("contra o partido", "rebelde", percentual de alinhamento): a regra é a da D82 e da D342, sem ranking
// implícito. Quando a bancada liberou o voto, a frase diz isso e nada mais: não há orientação com a qual comparar.
import type { OrientacaoDaBancada } from "../../lib/data/types.ts";

const VALOR: Record<OrientacaoDaBancada["valor"], string> = {
  sim: "Sim",
  nao: "Não",
  abstencao: "Abstenção",
  obstrucao: "Obstrução",
  liberado: "liberou",
};

/**
 * Frase da orientação. `null`/`undefined`: não conseguimos ligar uma orientação da fonte ao partido da pessoa nesta votação (lacuna nomeada,
 * nunca "sem orientação"): a fonte pode ter orientado por bloco ou federação, e `bloc_members` ainda não tem escritor no ETL. A frase não afirma
 * que a fonte não registrou.
 */
export function fraseOrientacao(o: OrientacaoDaBancada | null | undefined): string {
  if (!o) return "Orientação da bancada: não identificada para este partido nesta votação.";
  if (o.valor === "liberado") return o.tipo === "bloco" ? `${o.quem} liberou a bancada.` : `A bancada do ${o.quem} foi liberada.`;
  return o.tipo === "bloco" ? `${o.quem} orientou ${VALOR[o.valor]}.` : `A bancada do ${o.quem} orientou ${VALOR[o.valor]}.`;
}
