"use client";

import { usePathname } from "next/navigation";

/** O shell atual (cabeçalho, rodapé, faixa de demonstração) some no protótipo novo, que vive em /v2 e traz o próprio. */
export function LegacyOnly({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  if (path === "/v2" || path.startsWith("/v2/")) return null;
  return <>{children}</>;
}
