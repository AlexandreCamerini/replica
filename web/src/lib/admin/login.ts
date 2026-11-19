import "server-only";
import { cookies } from "next/headers";
import { NOME_COOKIE_SESSAO, opcoesDeCookieDaCentral } from "./cabecalhos.ts";
import { sqlAdmin } from "./db.ts";
import { criarLogin, type Login } from "./login-core.ts";
import { fatorVerificadoDesde, loginStore } from "./login-store.ts";
import { enviarCodigoPorEmail } from "./provedores.ts";
import { assinarSessao, lerSessao, type NivelSessao, type SessaoCentral } from "./sessao-cookie.ts";

// Liga o núcleo do login da central (login-core.ts) ao pool do `admin_central`, ao e-mail e aos cookies do Next. Só modo produção: o modo local não tem login.

export function loginDaCentral(): Login {
  return criarLogin({ store: loginStore(sqlAdmin()), env: process.env, agora: () => Date.now(), enviarEmail: enviarCodigoPorEmail });
}

/** A sessão do cookie desta requisição (assinatura e validade conferidas); `null` = sem sessão. Admin ativo e fator são de sessao.ts. */
export async function sessaoDoCookie(): Promise<SessaoCentral | null> {
  return lerSessao(process.env, (await cookies()).get(NOME_COOKIE_SESSAO)?.value, Date.now());
}

/** Grava o cookie de sessão no nível dado (host-only, Strict, Secure, HttpOnly, path /admin). Só route handler chama. */
export async function gravarSessao(email: string, nivel: NivelSessao): Promise<void> {
  const { valor, maxAgeS } = assinarSessao(process.env, email, nivel, Date.now());
  (await cookies()).set(NOME_COOKIE_SESSAO, valor, opcoesDeCookieDaCentral({ maxAge: maxAgeS }));
}

/** Desde quando (epoch, s) vale o fator verificado do e-mail; `null` = não há fator verificado. */
export async function fatorDesde(email: string): Promise<number | null> {
  return fatorVerificadoDesde(sqlAdmin(), email);
}
