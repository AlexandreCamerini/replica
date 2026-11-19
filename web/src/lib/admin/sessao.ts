import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { sqlAdmin } from "./db.ts";
import { decidirAcesso } from "./guarda-regra.ts";
import { fatorDesde, sessaoDoCookie } from "./login.ts";
import { SQL_ADMIN_ATIVO } from "./sql.ts";

// Identidade do operador da central (AC-23). Função única `operadorAtual()`; ninguém mais diz "quem é" (o `por` do corpo é ignorado).
//   Modo local:    ADMIN_LOCAL_EMAIL (obrigatória; sem ela, 404) procurado como admin ATIVO em `adm_admins` pelo pool da central. Sem login nem MFA.
//   Modo produção: sessão própria da central (cookie assinado, D335) de nível 2 (e-mail + TOTP), e-mail ativo em `adm_admins`, fator verificado em `login.central_fatores`
//                  e sessão emitida DEPOIS da verificação do fator atual (trocar o fator derruba as sessões antigas). Qualquer falta = 404.
//                  Exceção: sessão de admin ativo no nível 1 (só e-mail) vai para o cadastro/verificação do fator (/admin/entrar/fator).
// Falha de banco = 404 (fecha), com só o código no log.

export type Operador = { userId: string | null; email: string; nome: string };
export type Resolucao = { ok: true; operador: Operador } | { ok: false; destino: "404" | "fator" | "banco" };

type LinhaAdmin = { email: string; nome: string; user_id: string | null; ativo: boolean };
const NEGADO: Resolucao = { ok: false, destino: "404" };

export async function adminAtivo(email: string): Promise<LinhaAdmin | null> {
  const linhas = (await sqlAdmin().unsafe(SQL_ADMIN_ATIVO, [email])) as unknown as LinhaAdmin[];
  const l = linhas[0];
  return l && l.ativo === true && typeof l.nome === "string" && l.nome.trim() !== "" ? l : null;
}

/** Resolve o operador sem lançar nem redirecionar (rotas de API usam isto e respondem 404). Uma vez por requisição renderizada (React `cache`). */
export const resolverOperador = cache(async (): Promise<Resolucao> => {
  const acesso = decidirAcesso(process.env);
  try {
    if (!acesso.liberada) return NEGADO;
    if (acesso.modo === "local") {
      const email = process.env.ADMIN_LOCAL_EMAIL?.trim().toLowerCase();
      if (!email) return NEGADO;
      const a = await adminAtivo(email);
      return a ? { ok: true, operador: { userId: a.user_id, email: a.email.toLowerCase(), nome: a.nome } } : NEGADO;
    }
    const sessao = await sessaoDoCookie();
    if (!sessao) return NEGADO;
    const a = await adminAtivo(sessao.email);
    if (!a) return NEGADO;
    if (sessao.nivel !== 2) return { ok: false, destino: "fator" };
    // nível 2 só vale com o fator atual verificado e sessão emitida depois dele e de `sessoes_desde`: fator apagado, trocado ou sessões revogadas pelo dono = sessões anteriores caem
    const desde = await fatorDesde(sessao.email);
    if (desde === null || sessao.iat < desde) return NEGADO;
    return { ok: true, operador: { userId: a.user_id, email: a.email.toLowerCase(), nome: a.nome } };
  } catch (e) {
    console.error("[admin] identidade:", e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.name : typeof e);
    // Modo local: a única falha possível é o banco (não há login); dizer "banco" em vez de 404, que a tela leria como "sessão expirou".
    // Modo produção: qualquer falha fecha com 404 (não se sabe se quem pede é admin).
    return acesso.modo === "local" ? { ok: false, destino: "banco" } : NEGADO;
  }
});

/** O operador desta requisição; senão `notFound()` (404) ou, com sessão de admin sem MFA, redireciona ao cadastro do fator. */
export async function operadorAtual(): Promise<Operador> {
  const r = await resolverOperador();
  if (r.ok) return r.operador;
  if (r.destino === "fator") redirect("/admin/entrar/fator");
  if (r.destino === "banco") throw new Error("central local: o banco não respondeu ao conferir o operador");
  notFound();
}
