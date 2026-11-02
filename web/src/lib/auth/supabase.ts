import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { AuthProvider } from "./types";

// Produção: Supabase Auth com OTP por e-mail e CAPTCHA nativo (Turnstile). Sessão em cookies http-only geridos pelo @supabase/ssr.
// O SMTP do Supabase aponta para o Resend (configuração no painel do projeto do usuário).
function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias com AUTH_PROVIDER=supabase");
  return { url, anon };
}

async function client() {
  const { url, anon } = env();
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: true });
        } catch {
          // chamado de um Server Component: o middleware renova a sessão
        }
      },
    },
  });
}

export const supabaseAuth: AuthProvider = {
  name: "supabase",
  async sendCode(email, captchaToken) {
    const sb = await client();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken: captchaToken ?? undefined } });
    if (!error) return { ok: true };
    if (error.status === 429) return { ok: false, reason: "rate_limited" };
    if (/captcha/i.test(error.message)) return { ok: false, reason: "captcha" };
    console.error("[auth:supabase] sendCode", error.status, error.message);
    return { ok: false, reason: "unavailable" };
  },
  async verifyCode(email, code) {
    const sb = await client();
    const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.user) {
      if (error?.status === 429) return { ok: false, reason: "too_many" };
      if (error && /expired/i.test(error.message)) return { ok: false, reason: "expired" };
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, user: { id: data.user.id, email: data.user.email ?? email } };
  },
  async getUser() {
    const sb = await client();
    const { data } = await sb.auth.getUser(); // valida o token no servidor do Auth; não confia só no cookie
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  },
  async signOut() {
    const sb = await client();
    await sb.auth.signOut({ scope: "global" }); // sai de todos os aparelhos
  },
  async deleteUser(id) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY é obrigatória para apagar conta");
    const admin = createClient(env().url, key, { auth: { persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
    await supabaseAuth.signOut().catch(() => {});
  },
};
