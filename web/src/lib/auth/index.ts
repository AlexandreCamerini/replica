import "server-only";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { AuthProvider } from "./types";

// AUTH_PROVIDER=supabase em produção (obrigatório). "dev" só fora de produção: código vai para .local/mail.
export async function auth(): Promise<AuthProvider> {
  const p = process.env.AUTH_PROVIDER ?? (process.env.NODE_ENV === "production" ? "supabase" : "dev");
  if (p === "supabase") return (await import("./supabase")).supabaseAuth;
  if (p === "dev") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "1") throw new Error("AUTH_PROVIDER=dev não roda em produção");
    return (await import("./dev")).devAuth;
  }
  throw new Error(`AUTH_PROVIDER desconhecido: ${p}`);
}

export async function currentUser() {
  // Lê os cookies antes de qualquer atalho: a página que pergunta pela sessão é dinâmica mesmo sem Supabase configurado
  await cookies();
  // Supabase ainda não configurado (demo, build): visitante anônimo, sem ruído no log
  const provider = process.env.AUTH_PROVIDER ?? (process.env.NODE_ENV === "production" ? "supabase" : "dev");
  if (provider === "supabase" && !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    return await (await auth()).getUser();
  } catch (e) {
    unstable_rethrow(e); // erros internos do Next (uso dinâmico no build, redirect, notFound) não são falha do provedor
    console.error("[auth] getUser", e);
    return null; // falha do provedor = visitante anônimo; nenhuma página pública quebra por isso
  }
}

/** `volta` só aceita caminho interno: começa com "/" e não com "//" ou "/\" (bloqueia redirect aberto). */
export function safeReturn(v: unknown): string {
  return typeof v === "string" && /^\/(?![/\\])[^\s]*$/.test(v) && v.length <= 300 ? v : "/";
}

export type { SessionUser } from "./types";
