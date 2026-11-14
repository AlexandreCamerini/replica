"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Seção de cada rota da Direção 2: dentro de uma decisão, "O que mexe comigo?" continua marcado; o mesmo para tema, votação e pessoa. */
const SECAO: Record<string, string> = {
  "": "/",
  acompanhando: "/acompanhando",
  decisoes: "/decisoes",
  decisao: "/decisoes",
  temas: "/temas",
  tema: "/temas",
  ajustes: "/ajustes",
  votacoes: "/votacoes",
  votacao: "/votacoes",
  pessoas: "/pessoas",
  pessoa: "/pessoas",
  "como-funciona": "/como-funciona",
};

/**
 * Link de navegação com aria-current: "page" na própria página, "true" dentro da seção (ex.: uma decisão sob "O que mexe comigo?").
 * É client só para ler o caminho; o HTML sai correto do servidor e funciona sem JavaScript.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  const secao = SECAO[path.split("/")[1] ?? ""] ?? null;
  const current = path === href ? "page" : secao === href ? "true" : undefined;
  return (
    <Link href={href} aria-current={current}>
      {children}
    </Link>
  );
}
