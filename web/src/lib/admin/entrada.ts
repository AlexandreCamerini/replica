import "server-only";
import { cookies } from "next/headers";
import { gravarSessao, loginDaCentral, sessaoDoCookie } from "./login.ts";
import { captchaOk } from "./provedores.ts";
import { NONCE, novoNonce } from "./sessao-cookie.ts";
import { adminAtivo, resolverOperador } from "./sessao.ts";
import { completarAte, PISO_ENTRADA_MS, RELOGIO_REAL, responderNoPiso, type Relogio } from "./tempo-minimo.ts";

// Lógica da entrada da central (e-mail -> código -> fator TOTP), só modo produção. Login PRÓPRIO em Postgres (D335; login-core.ts): nenhum provedor de identidade externo.
// NÃO são server actions: o Next roteia action pelo ID e não pelo caminho, então uma action sob /admin/* poderia ser invocada por qualquer caminho da central, e uma action PÚBLICA
// também (A1/A13). Aqui são funções chamadas por route handlers de /admin/api/entrar (subcaminhos) (JSON, mesma origem, guarda própria da entrada na primeira instrução de cada rota).
// Regras:
//   - Quem não é admin ativo NUNCA recebe código e NUNCA ganha sessão: a central não cria conta (quem é admin está em `adm_admins`, escrita só pelo dono do banco). A resposta é a
//     mesma para admin, não admin e e-mail inexistente; captcha recusado, limite de envios e falha do e-mail também viram a mesma resposta neutra. Só o log do servidor sabe.
//   - A3: a LATÊNCIA também é a mesma: `enviarCodigo` responde sempre no piso fixo (PISO_ENTRADA_MS), e o trabalho (captcha, banco, e-mail), só para admin, corre em paralelo e
//     termina em `after()`; `verificarCodigo` completa até o mesmo piso. Limite de ritmo por e-mail no banco (0157): 3 envios por hora, 5 tentativas por código.
//   - Cada rota de fator exige sessão de admin ativo (`resolverOperador`), em vez de confiar no caminho por onde chegou. O fator é do e-mail DA SESSÃO, nunca do corpo.

export type Resultado = { status: number; corpo: Record<string, unknown>; pendente?: Promise<void> };

// E-mail e nonce entre as duas etapas (`email|nonce`): httpOnly, host-only, Strict, só em /admin. Não é assinado e não precisa: o nonce é aleatório, o banco guarda só o hash dele, e o
// código só confere (e a tentativa só conta) para o nonce de quem pediu. Quem monta este cookie à mão com o e-mail de um admin não gasta as tentativas dele nem ganha palpite.
const COOKIE_EMAIL = "adm_entrar_email";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

const emailDe = (v: unknown): string | null => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};
const textoDe = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const logErro = (onde: string, e: unknown): void => console.error(`[admin] entrada ${onde}:`, e && typeof e === "object" && "status" in e ? String((e as { status: unknown }).status) : e instanceof Error ? e.name : typeof e);

/** Etapa 1: e-mail (e Turnstile) -> código por e-mail, se for admin ativo. Sempre responde o mesmo (`proximo` = etapa do código), sempre no piso de tempo. */
export async function enviarCodigo(corpo: Record<string, unknown>, relogio: Relogio = RELOGIO_REAL): Promise<Resultado> {
  const email = emailDe(corpo.email);
  if (!email) return completarAte(PISO_ENTRADA_MS, async () => ({ status: 400, corpo: { erro: "Confira o e-mail: falta algo no endereço." } }), relogio);
  const token = textoDe(corpo.turnstile, 4096);
  const nonce = novoNonce();
  (await cookies()).set(COOKIE_EMAIL, `${email}|${nonce}`, { httpOnly: true, sameSite: "strict", secure: true, path: "/admin", maxAge: 15 * 60 });
  const { pendente } = await responderNoPiso(
    PISO_ENTRADA_MS,
    async () => {
      try {
        // captcha só para admin: o token é de uso único e a resposta é a mesma de qualquer jeito; quem não é admin não gasta chamada externa nem toca o banco de códigos
        if ((await adminAtivo(email)) && (await captchaOk(token))) {
          if (!(await loginDaCentral().enviarCodigo(email, nonce))) console.error("[admin] entrada sendCode: limite de envios ou falha do e-mail");
        }
      } catch (e) {
        logErro("sendCode", e);
      }
    },
    relogio,
  );
  return { status: 200, corpo: { proximo: "/admin/entrar?etapa=codigo" }, pendente };
}

/** Etapa 2: o código de 6 números. Para não admin, a resposta é a mesma de código errado, no mesmo tempo. Com sucesso, a sessão de nível 1 (só e-mail, 15 min) vai para o cookie e segue para o fator. */
export async function verificarCodigo(corpo: Record<string, unknown>, relogio: Relogio = RELOGIO_REAL): Promise<Resultado> {
  return completarAte(
    PISO_ENTRADA_MS,
    async (): Promise<Resultado> => {
      const jar = await cookies();
      const [emailCru, nonce = ""] = (jar.get(COOKIE_EMAIL)?.value ?? "").split("|");
      const email = emailDe(emailCru);
      if (!email) return { status: 400, corpo: { erro: "O pedido de código expirou. Peça um novo." } };
      const codigo = textoDe(corpo.code, 64).replace(/\D/g, "");
      if (codigo.length !== 6) return { status: 400, corpo: { erro: "O código tem 6 números." } };
      const invalido: Resultado = { status: 400, corpo: { erro: "Código errado ou vencido. Confira o último e-mail ou peça um novo." } };
      try {
        if (!(await adminAtivo(email))) return invalido;
        if (!NONCE.test(nonce) || (await loginDaCentral().verificarCodigo(email, nonce, codigo)) !== "ok") return invalido;
        await gravarSessao(email, 1); // nível 1: só abre o cadastro ou a verificação do fator
      } catch (e) {
        logErro("verifyCode", e);
        return invalido;
      }
      jar.delete({ name: COOKIE_EMAIL, path: "/admin" });
      return { status: 200, corpo: { proximo: "/admin/entrar/fator" } };
    },
    relogio,
  );
}

const NAO_ENCONTRADO: Resultado = { status: 404, corpo: {} };
const ERRO_PREPARO = "Não foi possível preparar o cadastro agora. Tente de novo.";

/** Sessão de admin ativo que ainda NÃO passou pelo fator (nível 1): devolve o e-mail DA SESSÃO. Nível 2 já vai para a central; qualquer outra coisa = 404. */
async function sessaoParaFator(): Promise<{ email: string } | { barrado: Resultado }> {
  const r = await resolverOperador();
  if (r.ok) return { barrado: { status: 200, corpo: { proximo: "/admin" } } };
  if (r.destino !== "fator") return { barrado: NAO_ENCONTRADO };
  const s = await sessaoDoCookie();
  return s ? { email: s.email } : { barrado: NAO_ENCONTRADO };
}

/** A página do fator mostra o cadastro ou a verificação? `true` = o e-mail da sessão já tem fator verificado. Só para sessão de nível 1 de admin ativo; senão `null`. */
export async function fatorJaCadastrado(): Promise<boolean | null> {
  const s = await sessaoParaFator();
  if ("barrado" in s) return null;
  return loginDaCentral().temFatorVerificado(s.email);
}

/** Cadastro do TOTP, passo 1: cria o segredo (nunca na renderização, para recarregar a página não trocar o segredo) e o devolve uma vez, em texto e como link `otpauth:`. */
export async function iniciarCadastroFator(): Promise<Resultado> {
  const s = await sessaoParaFator();
  if ("barrado" in s) return s.barrado;
  try {
    const novo = await loginDaCentral().iniciarCadastro(s.email);
    if (!novo) return { status: 409, corpo: { erro: "Já existe um autenticador cadastrado. Use o código dele." } };
    return { status: 200, corpo: { segredo: novo.segredo, uri: novo.uri } };
  } catch (e) {
    logErro("enroll", e);
    return { status: 503, corpo: { erro: ERRO_PREPARO } };
  }
}

/**
 * Cadastro do TOTP, passo 2, e verificação do fator já cadastrado: o mesmo código de 6 números, conferido contra o fator do e-mail DA SESSÃO (nada do corpo escolhe o fator: A4).
 * Com sucesso a sessão sobe para o nível 2. Limite: 5 tentativas a cada 15 min por e-mail; o mesmo código não vale duas vezes.
 */
export async function confirmarFator(corpo: Record<string, unknown>): Promise<Resultado> {
  const s = await sessaoParaFator();
  if ("barrado" in s) return s.barrado;
  const codigo = textoDe(corpo.code, 64).replace(/\D/g, "");
  if (codigo.length !== 6) return { status: 400, corpo: { erro: "O código tem 6 números." } };
  try {
    const r = await loginDaCentral().confirmarFator(s.email, codigo);
    if (r === "sem_fator") return { status: 400, corpo: { erro: "Autenticador não encontrado. Recarregue a página." } };
    if (r === "muitas") return { status: 429, corpo: { erro: "Muitas tentativas. Espere 15 minutos e tente de novo." } };
    if (r !== "ok") return { status: 400, corpo: { erro: "Código errado ou vencido. Espere o próximo código do aplicativo e tente de novo." } };
    await gravarSessao(s.email, 2);
  } catch (e) {
    logErro("verifyFactor", e);
    return { status: 503, corpo: { erro: "Não foi possível verificar agora. Tente de novo." } };
  }
  return { status: 200, corpo: { proximo: "/admin" } };
}
