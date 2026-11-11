"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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

const KEY = "sv:cidade";

/** Guarda a cidade escolhida só no aparelho. Nada vai para o servidor. */
export function RememberPlace({ ibge }: { ibge: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(KEY, ibge);
    } catch {
      // armazenamento bloqueado: a cidade segue na URL
    }
  }, [ibge]);
  return null;
}

/** Na Entrada sem cidade, oferece voltar à última escolhida neste aparelho. */
export function LastPlace() {
  const [ibge, setIbge] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v && /^\d{7}$/.test(v)) setIbge(v);
    } catch {
      // sem armazenamento, sem atalho
    }
  }, []);
  if (!ibge) return null;
  return (
    <Link className="sv-more" href={`/v2?cidade=${ibge}`}>
      Voltar à última cidade que você escolheu
    </Link>
  );
}
