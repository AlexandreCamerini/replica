// Texto de "Você acompanha N pessoas" (D327). Arquivo sem dependência de servidor nem de React, para o teste unitário.
import { FOLLOW_MAX } from "./follow-shared.ts";

/** O texto da contagem. Uma frase por caso, sem número inventado. */
export function fraseMarcados({ guardadas, pessoas }: { guardadas: number; pessoas: number | null }): string {
  if (guardadas === 0) return "Você ainda não marcou ninguém. Toque em “Votei nesta pessoa” para acompanhar o que ela faz.";
  const cheio = guardadas >= FOLLOW_MAX;
  const ocupadas = ` As ${FOLLOW_MAX} marcações deste navegador estão ocupadas:`;
  // a leitura falhou: não dá para dizer quantas das marcações são pessoas que existem; o número fica de fora
  if (pessoas === null) return `Não conseguimos conferir agora quantas pessoas você acompanha.${cheio ? `${ocupadas} tire alguém para incluir.` : ` Cabem até ${FOLLOW_MAX}.`}`;
  const fora = guardadas - pessoas;
  // com marcação que não entra na conta, a saída é tirar essas (o botão vem logo abaixo da frase), não "tirar alguém"
  const limite = cheio ? `${ocupadas} tire as que não entram na conta para abrir lugar.` : ` Cabem até ${FOLLOW_MAX}.`;
  if (fora <= 0) return cheio ? `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.` : pessoas === 1 ? `Você acompanha 1 pessoa. Cabem até ${FOLLOW_MAX}.` : `Você acompanha ${pessoas} pessoas. Cabem até ${FOLLOW_MAX}.`;
  const sobra = fora === 1 ? "Outra marcação guardada não entra na conta: é de pessoa que não aparece mais nos dados ou repete alguém." : `Outras ${fora} marcações guardadas não entram na conta: são de pessoas que não aparecem mais nos dados ou repetem alguém.`;
  if (pessoas === 0) return `${guardadas === 1 ? "A pessoa que você marcou não aparece" : `Nenhuma das ${guardadas} pessoas que você marcou aparece`} nos dados de hoje.${limite}`;
  return `${pessoas === 1 ? "Você acompanha 1 pessoa." : `Você acompanha ${pessoas} pessoas.`}${limite} ${sobra}`;
}
