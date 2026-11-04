export type NavItem = { href: string; label: string; release?: string };

// v1 "No seu bolso" (canvas, artboard E): quatro itens, todos existem. Nenhum link para fase futura nem para página em construção.
export const PRIMARY: NavItem[] = [
  { href: "/", label: "Entrada" },
  { href: "/pauta", label: "Pauta" },
  { href: "/como-escolhemos", label: "Como escolhemos" },
  { href: "/acervo", label: "Acervo" },
];

// Rodapé: só o que existe. /sobre e /dados-abertos ainda são páginas em construção e ficam fora.
export const MORE: NavItem[] = [{ href: "/correcoes", label: "Correções" }];
