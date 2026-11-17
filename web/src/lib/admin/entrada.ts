import "server-only";
import { cookies } from "next/headers";
import { clienteAuthDaCentral } from "./cliente-auth.ts";
import { escolherFator } from "./escolha-fator.ts";
import { adminAtivo, resolverOperador } from "./sessao.ts";
import { completarAte, PISO_ENTRADA_MS, RELOGIO_REAL, responderNoPiso, type Relogio } from "./tempo-minimo.ts";

// Lógica da entrada da central (e-mail -> código -> fator TOTP), só modo produção. NÃO são server actions: o Next roteia action pelo ID e não pelo caminho, então uma action sob /admin/*
// poderia ser invocada por qualquer caminho da central, e uma action PÚBLICA também (A1/A13). Aqui são funções chamadas por route handlers de /admin/api/entrar (subcaminhos) (JSON, mesma origem,
// guarda própria da entrada na primeira instrução de cada rota). O navegador nunca fala com o Supabase: tudo passa por aqui.
// Regras:
//   - Quem não é admin ativo NUNCA recebe código e NUNCA cria conta (`shouldCreateUser: false`; e o código nem é pedido ao Supabase). A resposta é a mesma para admin, não admin e
//     e-mail inexistente; erro do provedor (captcha, ritmo) também vira a mesma resposta neutra. Só o log do servidor sabe.
//   - A3: a LATÊNCIA também é a mesma: `enviarCodigo` responde sempre no piso fixo (PISO_ENTRADA_MS), e a ida ao provedor, só para admin, corre em paralelo e termina em `after()`;
//     `verificarCodigo` completa até o mesmo piso. Limite de ritmo por IP e por e-mail: fica no Supabase (o da aplicação exigiria escrita em banco, que o role da central não tem).
//   - Cada rota de fator exige sessão de admin ativo (`resolverOperador`), em vez de confiar no caminho por onde chegou.

export type Resultado = { status: number; corpo: Record<string, unknown>; pendente?: Promise<void> };

const COOKIE_EMAIL = "adm_entrar_email"; // e-mail entre as duas etapas: httpOnly, host-only, Strict, só em /admin
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
  (await cookies()).set(COOKIE_EMAIL, email, { httpOnly: true, sameSite: "strict", secure: true, path: "/admin", maxAge: 15 * 60 });
  const { pendente } = await responderNoPiso(
    PISO_ENTRADA_MS,
    async () => {
      try {
        if (await adminAtivo(email)) {
          const sb = await clienteAuthDaCentral();
          const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken: token !== "" ? token : undefined } });
          if (error) logErro("sendCode", error);
        }
      } catch (e) {
        logErro("sendCode", e);
      }
    },
    relogio,
  );
  return { status: 200, corpo: { proximo: "/admin/entrar?etapa=codigo" }, pendente };
}

/** Etapa 2: o código de 6 números. Para não admin, a resposta é a mesma de código errado, no mesmo tempo. Com sucesso, a sessão (aal1) vai para os cookies e segue para o fator. */
export async function verificarCodigo(corpo: Record<string, unknown>, relogio: Relogio = RELOGIO_REAL): Promise<Resultado> {
  return completarAte(
    PISO_ENTRADA_MS,
    async (): Promise<Resultado> => {
      const jar = await cookies();
      const email = jar.get(COOKIE_EMAIL)?.value;
      if (!email) return { status: 400, corpo: { erro: "O pedido de código expirou. Peça um novo." } };
      const codigo = textoDe(corpo.code, 64).replace(/\D/g, "");
      if (codigo.length !== 6) return { status: 400, corpo: { erro: "O código tem 6 números." } };
      const invalido: Resultado = { status: 400, corpo: { erro: "Código errado ou vencido. Confira o último e-mail ou peça um novo." } };
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
      return { status: 200, corpo: { proximo: "/admin/entrar/fator" } };
    },
    relogio,
  );
}

const NAO_ENCONTRADO: Resultado = { status: 404, corpo: {} };
const ERRO_PREPARO = "Não foi possível preparar o cadastro agora. Tente de novo.";

/** Sessão de admin ativo que ainda NÃO está em aal2. `null` = pode seguir; aal2 já vai para a central; qualquer outra coisa = 404. */
async function sessaoParaFator(): Promise<Resultado | null> {
  const r = await resolverOperador();
  if (r.ok) return { status: 200, corpo: { proximo: "/admin" } };
  return r.destino === "fator" ? null : NAO_ENCONTRADO;
}

/** Cadastro do TOTP, passo 1: cria o fator (nunca na renderização, para não acumular fatores) e devolve o QR e o segredo. */
export async function iniciarCadastroFator(): Promise<Resultado> {
  const barrado = await sessaoParaFator();
  if (barrado) return barrado;
  try {
    const sb = await clienteAuthDaCentral();
    const { data: lista, error: erroLista } = await sb.auth.mfa.listFactors();
    if (erroLista || !lista) return { status: 503, corpo: { erro: ERRO_PREPARO } };
    if (lista.totp.length > 0) return { status: 409, corpo: { erro: "Já existe um autenticador cadastrado. Use o código dele." } };
    for (const f of lista.all) if (f.factor_type === "totp" && f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id }); // sobras de tentativas anteriores
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `central-${Date.now()}`, issuer: "Segue o Voto (central)" });
    if (error || !data) return { status: 503, corpo: { erro: ERRO_PREPARO } };
    return { status: 200, corpo: { fatorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret } };
  } catch (e) {
    logErro("enroll", e);
    return { status: 503, corpo: { erro: ERRO_PREPARO } };
  }
}

/**
 * Cadastro do TOTP, passo 2, e verificação do fator já cadastrado. Com fator VERIFICADO na conta, o `fatorId` recebido é ignorado (A4: `escolherFator`); `unverified` só vale no primeiro
 * cadastro. Com sucesso a sessão sobe para aal2.
 */
export async function confirmarFator(corpo: Record<string, unknown>): Promise<Resultado> {
  const barrado = await sessaoParaFator();
  if (barrado) return barrado;
  const codigo = textoDe(corpo.code, 64).replace(/\D/g, "");
  if (codigo.length !== 6) return { status: 400, corpo: { erro: "O código tem 6 números." } };
  try {
    const sb = await clienteAuthDaCentral();
    const { data: lista } = await sb.auth.mfa.listFactors();
    const fator = escolherFator(lista?.all ?? [], textoDe(corpo.fatorId, 128));
    if (!fator) return { status: 400, corpo: { erro: "Autenticador não encontrado. Recarregue a página." } };
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo });
    if (error) return { status: 400, corpo: { erro: "Código errado ou vencido. Espere o próximo código do aplicativo e tente de novo." } };
  } catch (e) {
    logErro("verifyFactor", e);
    return { status: 503, corpo: { erro: "Não foi possível verificar agora. Tente de novo." } };
  }
  return { status: 200, corpo: { proximo: "/admin" } };
}
