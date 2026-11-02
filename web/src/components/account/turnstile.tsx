"use client";

import Script from "next/script";

/** Widget anti-robô. Sem chave pública configurada, não renderiza nada (o servidor decide se aceita). */
export function Turnstile() {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!key) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={key} data-language="pt-br" data-theme="auto" />
    </>
  );
}
