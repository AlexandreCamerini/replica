import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { clienteAuthDaCentral } from "./cliente-auth.ts";
import { sqlAdmin } from "./db.ts";
import { decidirAcesso } from "./guarda-regra.ts";
import { SQL_ADMIN_ATIVO } from "./sql.ts";

// Identidade do operador da central (AC-23). Função única `operadorAtual()`; ninguém mais diz "quem é" (o `por` do corpo é ignorado).
//   Modo local:    ADMIN_LOCAL_EMAIL (obrigatória; sem ela, 404) procurado como admin ATIVO em `adm_admins` pelo pool da central. Sem login nem MFA.
//   Modo produção: usuário do Supabase (`getUser`, que valida o token no servidor do Auth), nível aal2 (MFA TOTP), e-mail ativo em `adm_admins` (e `user_id` igual, se a linha o tem).
//                  Qualquer falta = 404. Exceção: sessão de admin ativo com aal1 vai para o cadastro/verificação do fator (/admin/entrar/fator).
// Falha de banco ou do provedor = 404 (fecha), com só o código no log.

export type Operador = { userId: string | null; email: string; nome: string };
export type Resolucao = { ok: true; operador: Operador } | { ok: false; destino: "404" | "fator" };

type LinhaAdmin = { email: string; nome: string; user_id: string | null; ativo: boolean };
const NEGADO: Resolucao = { ok: false, destino: "404" };

export async function adminAtivo(email: string): Promise<LinhaAdmin | null> {
  const linhas = (await sqlAdmin().unsafe(SQL_ADMIN_ATIVO, [email])) as unknown as LinhaAdmin[];
  const l = linhas[0];
  return l && l.ativo === true && typeof l.nome === "string" && l.nome.trim() !== "" ? l : null;
}

/** Resolve o operador sem lançar nem redirecionar (rotas de API usam isto e respondem 404). Uma vez por requisição renderizada (React `cache`). */
export const resolverOperador = cache(async (): Promise<Resolucao> => {
  try {
    const acesso = decidirAcesso(process.env);
    if (!acesso.liberada) return NEGADO;
    if (acesso.modo === "local") {
      const email = process.env.ADMIN_LOCAL_EMAIL?.trim().toLowerCase();
      if (!email) return NEGADO;
      const a = await adminAtivo(email);
      return a ? { ok: true, operador: { userId: a.user_id, email: a.email.toLowerCase(), nome: a.nome } } : NEGADO;
    }
    const sb = await clienteAuthDaCentral();
    const { data, error } = await sb.auth.getUser(); // antes do aal: o nível vem de um token já validado
    const u = data.user;
    if (error || !u || !u.email || !u.email_confirmed_at) return NEGADO;
    const a = await adminAtivo(u.email.toLowerCase());
    if (!a) return NEGADO;
    if (a.user_id !== null && a.user_id !== u.id) return NEGADO;
    const { data: nivel, error: erroNivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (erroNivel || !nivel) return NEGADO;
    if (nivel.currentLevel !== "aal2") return { ok: false, destino: "fator" };
    return { ok: true, operador: { userId: u.id, email: a.email.toLowerCase(), nome: a.nome } };
  } catch (e) {
    console.error("[admin] identidade:", e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.name : typeof e);
    return NEGADO;
  }
});

/** O operador desta requisição; senão `notFound()` (404) ou, com sessão de admin sem MFA, redireciona ao cadastro do fator. */
export async function operadorAtual(): Promise<Operador> {
  const r = await resolverOperador();
  if (r.ok) return r.operador;
  if (r.destino === "fator") redirect("/admin/entrar/fator");
  notFound();
}
