"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Seção de cada rota do /v2: dentro de uma decisão, "O que mexe comigo?" continua marcado; o mesmo para tema, votação e pessoa. */
const SECAO: Record<string, string> = {
  "": "/v2",
  acompanhando: "/v2/acompanhando",
  decisoes: "/v2/decisoes",
  decisao: "/v2/decisoes",
  temas: "/v2/temas",
  tema: "/v2/temas",
  ajustes: "/v2/ajustes",
  votacoes: "/v2/votacoes",
  votacao: "/v2/votacoes",
  pessoas: "/v2/pessoas",
  pessoa: "/v2/pessoas",
  "como-funciona": "/v2/como-funciona",
};

/**
 * Link de navegação com aria-current: "page" na própria página, "true" dentro da seção (ex.: uma decisão sob "O que mexe comigo?").
 * É client só para ler o caminho; o HTML sai correto do servidor e funciona sem JavaScript.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = (usePathname() ?? "/v2").replace(/\/+$/, "") || "/";
  const secao = SECAO[path.split("/")[2] ?? ""] ?? null;
  const current = path === href ? "page" : secao === href ? "true" : undefined;
  return (
    <Link href={href} aria-current={current}>
      {children}
    </Link>
  );
}
