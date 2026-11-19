import "server-only";
import { HOST_CENTRAL_PRODUCAO } from "./guarda-regra.ts";

// As DUAS saídas de rede da central (D335), e só elas: o e-mail do código de entrada (API HTTP do Resend) e a conferência do Turnstile (Cloudflare).
// Antes da D335 quem fazia as duas era o Supabase Auth; com o login próprio, é o servidor da central. Nenhum outro arquivo da central fala para fora
// (o teste admin-guarda-codigo confere: `fetch` só aqui, só para estes dois endereços). Nunca chamado pelo navegador nem no modo local (que não tem login).
// Variáveis do projeto da central: RESEND_API_KEY, AUTH_EMAIL_FROM, TURNSTILE_SECRET_KEY.

const URL_RESEND = "https://api.resend.com/emails";
const URL_TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Envia o código de entrada. `false` em qualquer falha (variável ausente, resposta não 2xx, prazo de 8 s); só o status vai ao log. */
export async function enviarCodigoPorEmail(para: string, codigo: string): Promise<boolean> {
  const chave = process.env.RESEND_API_KEY;
  const de = process.env.AUTH_EMAIL_FROM;
  if (!chave || !de) {
    console.error("[admin] entrada: RESEND_API_KEY e AUTH_EMAIL_FROM são obrigatórias para enviar o código");
    return false;
  }
  try {
    const r = await fetch(URL_RESEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: de,
        to: [para],
        subject: "Código de entrada da central",
        text: `Seu código é ${codigo}. Vale por 10 minutos.\nSe não foi você, ignore esta mensagem e avise o responsável pela central.\n`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("[admin] entrada: Resend respondeu", r.status);
    return r.ok;
  } catch (e) {
    console.error("[admin] entrada: Resend falhou", e instanceof Error ? e.name : typeof e);
    return false;
  }
}

/** Confere o token do Turnstile (uso único). Falha FECHADA: sem chave, sem token, erro de rede, prazo de 5 s ou token resolvido em OUTRO host (um token do site público não vale na central) = `false`. */
export async function captchaOk(token: string): Promise<boolean> {
  const segredo = process.env.TURNSTILE_SECRET_KEY;
  if (!segredo || token === "") return false;
  try {
    const r = await fetch(URL_TURNSTILE, { method: "POST", body: new URLSearchParams({ secret: segredo, response: token }), signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { success?: boolean; hostname?: string };
    return j.success === true && j.hostname === HOST_CENTRAL_PRODUCAO;
  } catch {
    return false;
  }
}
