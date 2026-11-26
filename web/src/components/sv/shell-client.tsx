"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { alternarFacil } from "./facil-actions";

/** Seção de cada rota da Direção 2: dentro de uma decisão, o link "O que mexe comigo?" (rodapé) continua marcado; no topo, votação e pessoa marcam "Votações" e "Pessoas". */
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
 * Link de navegação com aria-current: "page" na própria página, "true" dentro da seção (ex.: uma votação sob "Votações" no topo, ou uma decisão sob "O que mexe comigo?" no rodapé).
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

/**
 * Botão "Aa" do modo leitura fácil, no topo de toda página. Formulário com a ação do servidor: funciona sem JavaScript (volta ao caminho
 * da página, sem a consulta); com JavaScript, no envio ele troca o destino por caminho + consulta + âncora de onde o leitor está.
 * `aria-pressed` diz o estado e o nome acessível é fixo ("Aa, leitura fácil", começa com o texto visível): trocar o nome junto com o estado faria o leitor de
 * tela dizer "desligar a leitura fácil, pressionado", uma dupla negação.
 */
const CHAVE_ANCORA = "sv_facil_ancora";

export function BotaoFacil({ ligada }: { ligada: boolean }) {
  const caminho = (usePathname() ?? "/") || "/";
  // O redirecionamento da ação volta à mesma página, mas o roteador do Next descarta o #fragmento: guardamos o dele (só para esta aba, sessionStorage) e o devolvemos quando a página volta.
  useEffect(() => {
    let h = "";
    try {
      h = window.sessionStorage.getItem(CHAVE_ANCORA) ?? "";
    } catch {
      h = "";
    }
    if (!h) return;
    // o Next grava a URL nova depois da renderização: tenta de novo por até ~1 s, até o fragmento voltar
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      if (window.location.hash === h) n = 99;
      else if (!window.location.hash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${h}`);
        document.getElementById(decodeURIComponent(h.slice(1)))?.scrollIntoView();
        n = 99;
      }
      if (n >= 10) {
        window.clearInterval(t);
        try {
          window.sessionStorage.removeItem(CHAVE_ANCORA);
        } catch {
          // sem armazenamento: nada a limpar
        }
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [ligada]);
  return (
    <form
      action={alternarFacil}
      className="sv-facil-f"
      onSubmit={(e) => {
        try {
          window.sessionStorage.setItem(CHAVE_ANCORA, window.location.hash);
        } catch {
          // sem armazenamento: a página volta sem o fragmento
        }
        const campo = e.currentTarget.elements.namedItem("voltar");
        if (campo instanceof HTMLInputElement) campo.value = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      }}
    >
      <input type="hidden" name="voltar" value={caminho} />
      <input type="hidden" name="ligar" value={ligada ? "0" : "1"} />
      <button type="submit" className="sv-facil" aria-pressed={ligada} aria-label="Aa, leitura fácil" title="Leitura fácil: letra maior e contraste forte">
        Aa
      </button>
    </form>
  );
}
