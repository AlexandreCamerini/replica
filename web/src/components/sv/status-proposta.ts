// F9 do roteiro do eleitor: tabela curada de situação de proposta. Módulo puro.
// A tabela traduz termos conhecidos para uma frase do eleitor; termo fora dela mostra o TEXTO ORIGINAL da fonte, nunca um palpite.
// Um teste (sv-status-proposta.test.ts) falha se o código passa a conhecer termo novo (ex.: lista da demonstração) sem entrada aqui.

export type StatusCurado = { chave: string; frase: string };

/** chave = texto da fonte sem acento, minúsculo, espaços normalizados. */
export const STATUS_CURADOS: readonly StatusCurado[] = [
  { chave: "em tramitacao", frase: "Em tramitação: ainda está sendo analisada." },
  { chave: "aguardando parecer", frase: "Aguardando parecer: espera a opinião técnica de uma comissão ou relator." },
  { chave: "arquivada", frase: "Arquivada: saiu da tramitação." },
  { chave: "arquivado", frase: "Arquivado: saiu da tramitação." },
  { chave: "virou lei", frase: "Virou lei." },
  { chave: "respondido", frase: "Respondido pelo órgão a que foi dirigido." },
  { chave: "aguardando resposta", frase: "Aguardando resposta do órgão a que foi dirigido." },
];

export const chaveStatus = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type StatusMostrado = { origem: "tabela"; frase: string; original: string } | { origem: "fonte"; original: string } | { origem: "ausente" };

/** Texto da fonte -> o que mostrar. Vazio/nulo = ausente (lacuna). Fora da tabela = o texto original, com a origem "fonte". */
export function statusDeProposta(texto: string | null | undefined): StatusMostrado {
  const original = (texto ?? "").trim();
  if (!original) return { origem: "ausente" };
  const c = STATUS_CURADOS.find((x) => x.chave === chaveStatus(original));
  return c ? { origem: "tabela", frase: c.frase, original } : { origem: "fonte", original };
}
