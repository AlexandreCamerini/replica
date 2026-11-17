"use server";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { clienteAuthDaCentral } from "./cliente-auth.ts";
import { acaoComOrigemExterna, exigirEntrada } from "./guarda.ts";
import { adminAtivo, resolverOperador } from "./sessao.ts";

// Server actions das páginas de entrada da central (/admin/entrar e /admin/entrar/fator), só modo produção. O navegador nunca fala com o Supabase: tudo passa por aqui.
// Regras:
//   - Toda action começa por `exigirEntrada()` (modo produção + marca do middleware) e pela checagem de origem (além do CSRF do próprio Next).
//   - Quem não é admin ativo NUNCA recebe código e NUNCA cria conta (`shouldCreateUser: false`; e o código nem é pedido ao Supabase). A resposta é a mesma para admin, não admin e
//     e-mail inexistente; erro do provedor (captcha, ritmo) também vira a mesma resposta neutra, porque seria um canal para descobrir quem é admin. Só o log do servidor sabe.
//   - Cada action de cadastro/verificação do fator exige sessão de admin ativo (`resolverOperador`), em vez de confiar no caminho por onde chegou.

export type EstadoEntrada = { erro?: string; email?: string };
export type EstadoFator = { erro?: string; fatorId?: string; qr?: string; segredo?: string };

const COOKIE_EMAIL = "adm_entrar_email"; // e-mail entre as duas etapas: httpOnly, host-only, Strict, só em /admin
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

const emailDe = (v: FormDataEntryValue | null): string | null => {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};
const logErro = (onde: string, e: unknown): void => console.error(`[admin] entrada ${onde}:`, e && typeof e === "object" && "status" in e ? String((e as { status: unknown }).status) : e instanceof Error ? e.name : typeof e);

/** Etapa 1: e-mail (e Turnstile) -> código por e-mail, se for admin ativo. Sempre avança para a etapa do código, com o mesmo texto. */
export async function enviarCodigo(_: EstadoEntrada, form: FormData): Promise<EstadoEntrada> {
  await exigirEntrada();
  if (await acaoComOrigemExterna()) notFound();
  const email = emailDe(form.get("email"));
  if (!email) return { erro: "Confira o e-mail: falta algo no endereço.", email: String(form.get("email") ?? "").slice(0, 254) };
  try {
    if (await adminAtivo(email)) {
      const sb = await clienteAuthDaCentral();
      const token = form.get("cf-turnstile-response");
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken: typeof token === "string" && token !== "" ? token : undefined } });
      if (error) logErro("sendCode", error);
    }
  } catch (e) {
    logErro("sendCode", e);
  }
  (await cookies()).set(COOKIE_EMAIL, email, { httpOnly: true, sameSite: "strict", secure: true, path: "/admin", maxAge: 15 * 60 });
  redirect("/admin/entrar?etapa=codigo");
}

/** Etapa 2: o código de 6 números. Para não admin, a resposta é a mesma de código errado. Com sucesso, a sessão (aal1) vai para os cookies e segue para o fator. */
export async function verificarCodigo(_: EstadoEntrada, form: FormData): Promise<EstadoEntrada> {
  await exigirEntrada();
  if (await acaoComOrigemExterna()) notFound();
  const jar = await cookies();
  const email = jar.get(COOKIE_EMAIL)?.value;
  if (!email) return { erro: "O pedido de código expirou. Peça um novo." };
  const codigo = String(form.get("code") ?? "").replace(/\D/g, "");
  if (codigo.length !== 6) return { erro: "O código tem 6 números." };
  const invalido = { erro: "Código errado ou vencido. Confira o último e-mail ou peça um novo." };
  try {
    if (!(await adminAtivo(email))) return invalido;
    const sb = await clienteAuthDaCentral();
    const { data, error } = await sb.auth.verifyOtp({ email, token: codigo, type: "email" });
    if (error || !data.user) return invalido;
  } catch (e) {
    logErro("verifyCode", e);
    return invalido;
  }
  jar.delete({ name: COOKIE_EMAIL, path: "/admin" });
  redirect("/admin/entrar/fator");
}

/** Sessão de admin ativo que ainda NÃO está em aal2; qualquer outra coisa = 404 (aal2 já não precisa disto: vai para a central). */
async function sessaoParaFator(): Promise<void> {
  await exigirEntrada();
  if (await acaoComOrigemExterna()) notFound();
  const r = await resolverOperador();
  if (r.ok) redirect("/admin");
  if (r.destino !== "fator") notFound();
}

/** Cadastro do TOTP, passo 1: cria o fator (a partir de uma action, nunca na renderização, para não acumular fatores) e devolve o QR e o segredo. */
export async function iniciarCadastroFator(): Promise<EstadoFator> {
  await sessaoParaFator();
  try {
    const sb = await clienteAuthDaCentral();
    const { data: lista, error: erroLista } = await sb.auth.mfa.listFactors();
    if (erroLista || !lista) return { erro: "Não foi possível preparar o cadastro agora. Tente de novo." };
    if (lista.totp.length > 0) return { erro: "Já existe um autenticador cadastrado. Use o código dele." };
    for (const f of lista.all) if (f.factor_type === "totp" && f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id }); // sobras de tentativas anteriores
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `central-${Date.now()}`, issuer: "Segue o Voto (central)" });
    if (error || !data) return { erro: "Não foi possível preparar o cadastro agora. Tente de novo." };
    return { fatorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret };
  } catch (e) {
    logErro("enroll", e);
    return { erro: "Não foi possível preparar o cadastro agora. Tente de novo." };
  }
}

/** Cadastro do TOTP, passo 2, e verificação do fator já cadastrado: o código de 6 números do aplicativo. Com sucesso a sessão sobe para aal2 e segue para a central. */
export async function confirmarFator(_: EstadoFator, form: FormData): Promise<EstadoFator> {
  await sessaoParaFator();
  const codigo = String(form.get("code") ?? "").replace(/\D/g, "");
  const estado = (erro: string): EstadoFator => ({ erro, fatorId: String(form.get("fatorId") ?? "") || undefined, qr: String(form.get("qr") ?? "") || undefined, segredo: String(form.get("segredo") ?? "") || undefined });
  if (codigo.length !== 6) return estado("O código tem 6 números.");
  try {
    const sb = await clienteAuthDaCentral();
    const { data: lista } = await sb.auth.mfa.listFactors();
    const pedido = String(form.get("fatorId") ?? "");
    // o fator vem da lista do próprio usuário (o Supabase também confere): um id de fora da lista não vale
    const fator = lista?.all.find((f) => f.factor_type === "totp" && (pedido !== "" ? f.id === pedido : f.status === "verified"));
    if (!fator) return estado("Autenticador não encontrado. Recarregue a página.");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
    if (error) return estado("Código errado ou vencido. Espere o próximo código do aplicativo e tente de novo.");
  } catch (e) {
    logErro("verifyFactor", e);
    return estado("Não foi possível verificar agora. Tente de novo.");
  }
  redirect("/admin");
}
