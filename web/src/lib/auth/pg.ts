import "server-only";
import { cookies } from "next/headers";
import { writer } from "@/lib/db/writer";
import { captchaPresente, cookieName, createPgAuth } from "./pg-core";
import { pgStore } from "./pg-store";
import type { AuthProvider } from "./types";

// Produção pós-Supabase: AUTH_PROVIDER=pg. Código de 6 dígitos por e-mail (API HTTP do Resend, sem SDK), usuários em auth.users
// (schema próprio do Postgres central), códigos em login.codes, sessão em cookie `__Host-sessao` assinado com SESSION_SECRET.
// Variáveis: SESSION_SECRET (32+), RESEND_API_KEY, AUTH_EMAIL_FROM, TURNSTILE_SECRET_KEY, DATABASE_WRITE_URL.

async function sendMail(to: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!key || !from) {
    console.error("[auth:pg] RESEND_API_KEY e AUTH_EMAIL_FROM são obrigatórias para enviar o código");
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Seu código de acesso",
        text: `Seu código é ${code}. Vale por 10 minutos.\nSe não foi você, ignore esta mensagem.\n`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("[auth:pg] Resend respondeu", r.status);
    return r.ok;
  } catch (e) {
    console.error("[auth:pg] Resend falhou", e instanceof Error ? e.message : e);
    return false;
  }
}

// Os cookies do Next são assíncronos; o núcleo é síncrono. Cada chamada do provedor resolve o jar antes e o entrega pronto.
export async function pgAuth(): Promise<AuthProvider> {
  const jar = await cookies();
  const name = cookieName(process.env);
  const secure = process.env.NODE_ENV === "production";
  return createPgAuth({
    store: pgStore(writer()),
    env: process.env,
    now: () => Date.now(),
    captcha: async (token) => captchaPresente(token, process.env), // o Turnstile em si é verificado em account.ts (token de uso único; ver pg-core.ts)
    sendMail,
    cookie: {
      get: () => jar.get(name)?.value,
      set: (value, maxAge) => jar.set(name, value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge }),
      clear: () => jar.delete({ name, path: "/" }),
    },
  });
}
