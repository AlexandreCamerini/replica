// URL canônica para compartilhar: a da página, sem parâmetros de rastreio e sem âncora.
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|twclid|ttclid|igshid|igsh|mc_cid|mc_eid|_ga|_gl|ref|ref_src|source|si|s)$/i;

export function canonicalUrl(origin: string, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const k of [...params.keys()]) if (TRACKING.test(k)) params.delete(k);
  const qs = params.toString();
  return `${origin}${pathname}${qs ? `?${qs}` : ""}`;
}
