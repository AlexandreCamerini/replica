// Quando um clique num link começa uma troca de página que vale avisar (D330). Puro, para o teste unitário.
// O aviso "Carregando a página…" só aparece para navegação que troca o conteúdo desta aba: outro endereço do próprio site.

export type Clique = {
  /** href resolvido do link (absoluto) */
  href: string;
  /** endereço atual (absoluto) */
  atual: string;
  target?: string | null;
  download?: boolean;
  /** botão do mouse: 0 = principal */
  botao?: number;
  /** ctrl, cmd, shift ou alt apertados: o navegador abre em outra aba ou janela, ou baixa */
  comTecla?: boolean;
};

export function trocaDePagina(c: Clique): boolean {
  // O clique é visto na captura (antes do link do Next, que o cancela para trocar a página sem recarregar): daqui não dá
  // para saber se outro código vai desistir da navegação. Nesse caso o aviso some sozinho no teto de tempo.
  if (c.comTecla || (c.botao ?? 0) !== 0 || c.download) return false;
  if (c.target && c.target !== "_self") return false;
  let destino: URL, aqui: URL;
  try {
    destino = new URL(c.href);
    aqui = new URL(c.atual);
  } catch {
    return false;
  }
  if (destino.protocol !== "http:" && destino.protocol !== "https:") return false; // mailto:, tel:…
  if (destino.origin !== aqui.origin) return false; // outro site: o navegador mostra o carregamento dele
  // mesmo endereço (ou só a âncora mudou): nada é carregado
  return destino.pathname !== aqui.pathname || destino.search !== aqui.search;
}
