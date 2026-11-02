import "server-only";

// Turnstile (Cloudflare). Sem chave: passa em desenvolvimento, FALHA FECHADO em produção.
export async function verifyCaptcha(token: string | null, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    return Boolean(((await r.json()) as { success?: boolean }).success);
  } catch {
    return false;
  }
}
