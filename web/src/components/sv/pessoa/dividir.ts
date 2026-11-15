// Parte uma lista em "as primeiras n" e "o resto", na ordem em que veio. Puro: sem JSX, sem dado.
// Usado onde a tela mostra um começo e guarda o resto num <details> (comissões da Pessoa, D324): nada some, só dobra.

/** `[primeiras, resto]`. `n` que não é inteiro positivo: nada nas primeiras, tudo no resto (a lista nunca perde item). */
export function dividir<T>(lista: readonly T[], n: number): [T[], T[]] {
  const k = Number.isInteger(n) && n > 0 ? n : 0;
  return [lista.slice(0, k), lista.slice(k)];
}
