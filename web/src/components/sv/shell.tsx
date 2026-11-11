"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/v2", label: "Início", note: "Quem decide por você, a partir da sua cidade" },
  { href: "/v2/temas", label: "Temas", note: "A visão de conjunto: o que o Congresso decide em cada assunto" },
  { href: "/v2/decisoes", label: "Decisões", note: "O que está em pauta e o que ainda é proposta" },
  { href: "/v2/votacoes", label: "Votações", note: "Como cada pessoa votou, nome por nome" },
  { href: "/v2/pessoas", label: "Pessoas", note: "Quem ocupa cada cargo e o que fez nele" },
  { href: "/v2/como-funciona", label: "Como funciona", note: "De onde vem cada informação, as regras e as correções" },
] as const;

// "Decisões" continua marcada dentro de uma decisão; o mesmo para votação e pessoa.
const SECTION: Record<string, string> = { decisao: "/v2/decisoes", votacao: "/v2/votacoes", pessoa: "/v2/pessoas", tema: "/v2/temas", acompanhando: "/v2" };

function activeHref(path: string): string {
  const seg = path.split("/")[2] ?? "";
  if (!seg) return "/v2";
  return SECTION[seg] ?? `/v2/${seg}`;
}

export function SvHeader() {
  const path = usePathname() ?? "/v2";
  const [open, setOpen] = useState(false);
  const current = activeHref(path);

  // trocar de página fecha o menu
  useEffect(() => setOpen(false), [path]);

  return (
    <>
      <header className="sv-head">
        <div className="sv-wrap">
          <Link className="sv-wm" href="/v2">
            Segue o Voto
          </Link>
          <nav className="sv-nav" aria-label="Principal">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={n.href === current ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <button className="sv-menubtn" type="button" aria-expanded={open} aria-controls="sv-menu" onClick={() => setOpen((o) => !o)}>
            {open ? "Fechar" : "Menu"}
          </button>
        </div>
      </header>
      <nav className={open ? "sv-menu is-open" : "sv-menu"} id="sv-menu" aria-label="Menu">
        <div className="sv-wrap">
          {NAV.map((n, i) => (
            <Link key={n.href} href={n.href} aria-current={n.href === current ? "page" : undefined} style={i === NAV.length - 1 ? { borderBottom: "1px solid var(--on-block)" } : undefined}>
              {n.label}
              <small>{n.note}</small>
            </Link>
          ))}
        </div>
      </nav>
    </>
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
