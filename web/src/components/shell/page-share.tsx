"use client";

import { Check, Link2, MessageCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canonicalUrl } from "@/lib/share";

// páginas com compartilhamento próprio (crachá) ou privadas (conta): a barra global não aparece
const SKIP = /^\/(p\/|entrar|conta)/;

const btn =
  "inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs font-semibold text-fg outline-none hover:bg-surface hover:underline focus-visible:outline-2 focus-visible:outline-focus";

/** Copiar o link e mandar pelo WhatsApp, no topo de toda página. Usa a URL canônica (sem rastreio). */
export function PageShare() {
  const path = usePathname() ?? "/";
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  // a origem e a query só existem no navegador; sem JS não há botão de copiar, só o WhatsApp com o texto
  useEffect(() => {
    setUrl(canonicalUrl(location.origin, location.pathname, location.search));
    setState("idle");
  }, [path]);

  if (SKIP.test(path)) return null;
  const text = "Quem representa você, com dados oficiais:";
  const wa = `https://wa.me/?text=${encodeURIComponent(url ? `${text} ${url}` : text)}`;

  const copy = async () => {
    const u = canonicalUrl(location.origin, location.pathname, location.search);
    try {
      await navigator.clipboard.writeText(u);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };

  return (
    <span className="ml-auto flex items-center gap-1" data-testid="page-share">
      <button type="button" onClick={copy} className={btn}>
        {state === "copied" ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}
        {state === "copied" ? "Link copiado" : "Copiar link"}
      </button>
      <a href={wa} target="_blank" rel="noopener noreferrer" className={btn}>
        <MessageCircle aria-hidden className="size-3.5" />
        WhatsApp
        <span className="sr-only"> (abre em outra aba)</span>
      </a>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Link copiado" : state === "failed" ? "Não deu para copiar; copie o endereço do navegador" : ""}
      </span>
    </span>
  );
}
