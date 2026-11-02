export type NavItem = { href: string; label: string; release?: string };

// Ordem pelo uso: o loop principal primeiro, depois os módulos.
export const PRIMARY: NavItem[] = [
  { href: "/", label: "Início" },
  { href: "/representantes", label: "Minha cidade" },
  { href: "/quem", label: "Quem é quem" },
  { href: "/comparar", label: "Comparar" },
  { href: "/congresso", label: "Congresso", release: "R2" },
  { href: "/partidos", label: "Partidos", release: "R5" },
  { href: "/governos", label: "Governos", release: "R5" },
  { href: "/eleicoes", label: "Eleições", release: "R5" },
];

export const MORE: NavItem[] = [
  { href: "/stf", label: "STF", release: "R5" },
  { href: "/impostos", label: "Impostos", release: "R5" },
  { href: "/propostas", label: "Planos de governo", release: "R5" },
  { href: "/mais-vistos", label: "Mais vistos", release: "R5" },
  { href: "/cargos", label: "Entenda os cargos", release: "R5" },
  { href: "/dicionario", label: "Dicionário", release: "R5" },
  { href: "/dados-abertos", label: "Quem publica dados", release: "R2" },
  { href: "/sobre", label: "Como funciona", release: "R2" },
  { href: "/atualizacoes", label: "Novidades", release: "R2" },
  { href: "/ajudar", label: "Como ajudar", release: "R5" },
  { href: "/mcp", label: "Assistente (MCP)", release: "R5" },
];
