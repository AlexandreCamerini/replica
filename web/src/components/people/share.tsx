"use client";

import { Check, Link2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Web Share quando existe; senão copia o link. WhatsApp sempre como link direto. */
export function ShareButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // usuário cancelou o share sheet: nada a fazer
    }
  };
  return (
    <>
      <Button size="sm" variant="secondary" onPress={share} icon={copied ? <Check aria-hidden className="size-4" /> : <Share2 aria-hidden className="size-4" />}>
        {copied ? "Link copiado" : "Compartilhar"}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Link copiado" : ""}
      </span>
    </>
  );
}

export function WhatsAppLink({ text, path }: { text: string; path: string }) {
  // a origem só existe no cliente; sem JS o link aponta para o WhatsApp só com o texto
  const [href, setHref] = useState(`https://wa.me/?text=${encodeURIComponent(text)}`);
  useEffect(() => setHref(`https://wa.me/?text=${encodeURIComponent(`${text} ${location.origin}${path}`)}`), [text, path]);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-pill border-[1.5px] border-border-input bg-surface px-3 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Link2 aria-hidden className="size-4" />
      WhatsApp
    </a>
  );
}
