export type NavItem = { href: string; label: string; release?: string };

// Design v1 (design/v1): seis itens, todos existem. Nenhum link para fase futura nem para página em construção.
export const PRIMARY: NavItem[] = [
  { href: "/", label: "Entrada" },
  { href: "/pauta", label: "Vem aí" },
  { href: "/ja-decidido", label: "Já decidido" },
  { href: "/quem-votei", label: "Quem eu votei" },
  { href: "/como-escolhemos", label: "Como escolhemos" },
  { href: "/correcoes", label: "Correções" },
];

// Rodapé: só o que existe.
export const MORE: NavItem[] = [{ href: "/acervo", label: "Acervo" }];
