// Ordem alfabética de nomes de pessoas (D329). Puro: serve ao servidor, à demonstração e ao teste unitário.
//
// O nome é o que a fonte traz, e a tela não o corrige. Mas alguns chegam com um sinal na frente da primeira letra (em
// produção, em 16/11/2026: "´`vando do Caroá" e "´rondiney Topógrafo", com acento agudo e crase soltos). Sinal vem antes
// de letra na ordem do alfabeto, e esses nomes abriam a lista nacional, antes do "A". Para ordenar, os sinais do começo
// não contam: "´rondiney" fica entre os nomes com R. O nome mostrado continua o da fonte.
//
// A lista de sinais é explícita, e é a mesma no `ltrim` do ORDER BY de listPeople (pg.ts), que decide o que entra em cada
// página. Classe de caracteres do banco ("não é letra") depende da configuração de idioma dele e poderia comer o "Á".

/** Sinais ignorados no começo do nome, só para ordenar: espaço, acentos soltos, aspas, pontuação e símbolos. */
export const SINAIS_INICIAIS = " \t\u00a0´`^~¨¯¸\u0300\u0301\u0302\u0303\u0304\u0308\u0327'\"“”‘’«».,;:!?·()[]{}*_#@&/\\|<>+=%$-–—";

/** O nome sem os sinais do começo, em forma composta (NFC). Nome feito só de sinais fica como veio. */
export function chaveDeOrdem(nome: string): string {
  const n = nome.normalize("NFC");
  let i = 0;
  while (i < n.length && SINAIS_INICIAIS.includes(n[i])) i++;
  return i < n.length ? n.slice(i) : n;
}

const alfabeto = new Intl.Collator("pt-BR");

/**
 * Compara dois nomes para lista alfabética: acento não separa ("Álvaro" fica com os "A", composto ou decomposto), sinal no
 * começo não conta. Empate na chave (o mesmo nome com e sem sinal) cai no nome como veio, para a ordem ser sempre a mesma.
 */
export function compararNomes(a: string, b: string): number {
  return alfabeto.compare(chaveDeOrdem(a), chaveDeOrdem(b)) || alfabeto.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
