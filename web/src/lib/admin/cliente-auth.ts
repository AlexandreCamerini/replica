import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { OPCOES_SSR_DA_CENTRAL, opcoesDeCookieDaCentral } from "./cabecalhos.ts";

// Client do Supabase Auth da CENTRAL (só modo produção), com os cookies da requisição. Próprio de lib/admin: não reaproveita lib/auth/supabase.ts porque aquele grava cookie
// `SameSite=Lax` e o `signInWithOtp` dele cria conta para qualquer e-mail (`shouldCreateUser: true`); a central não pode dar conta a quem não é admin.
// O navegador nunca fala com o Supabase: todas as chamadas são do servidor (middleware, layout, páginas, server actions).

function ambiente(): { url: string; anon: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias no modo produção da central");
  return { url, anon };
}

export async function clienteAuthDaCentral() {
  const { url, anon } = ambiente();
  const store = await cookies();
  return createServerClient(url, anon, {
    cookieOptions: OPCOES_SSR_DA_CENTRAL, // nome próprio do cookie de sessão da central (A10), o mesmo do middleware
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          // host-only, SameSite=Strict, Secure, HttpOnly, path /admin (a mesma regra do middleware)
          for (const { name, value, options } of lista) store.set(name, value, opcoesDeCookieDaCentral(options));
        } catch {
          // chamado de um Server Component: quem renova a sessão é o middleware
        }
      },
    },
  });
}
