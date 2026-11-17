import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MARCA_ENTRADA } from "./cabecalhos.ts";
import { centralLiberada, decidirAcesso, origemRecusada } from "./guarda-regra.ts";
import { operadorAtual, resolverOperador } from "./sessao.ts";

// Guarda de acesso da central (plano, seção 4a; AC-23). A REGRA é pura e mora em guarda-regra.ts (`decidirAcesso`, `origemRecusada`); aqui só se liga a regra ao Next.
// Pontos de entrada, todos chamam esta guarda ANTES de qualquer outra coisa e com `await` (sem o await, o `notFound()` vira promessa rejeitada solta e a página renderiza):
//   - layout.tsx do grupo (admin): `await exigirAdminOuEntrada()` na primeira instrução, antes de qualquer Suspense (com stream iniciado, `notFound()` pode sair com status 200);
//   - cada página e cada route handler: `await exigirAdmin()` / `await exigirAdminApi()` na primeira instrução;
//   - cada função de consultas.ts: `await exigirAdmin()` na primeira instrução (layout e página renderizam em paralelo: a página não pode consultar o banco se o layout responde 404);
//   - as duas páginas de /admin/entrar: `exigirEntrada()` / `exigirFator()` (únicas rotas sem sessão; ver o cabeçalho de middleware.ts);
//   - sqlAdmin() em db.ts: lança se a central estiver fechada (defesa em profundidade).
// `exigirAdmin` confere a central liberada e a identidade (`operadorAtual()`: sessão, aal2 e e-mail ativo em `adm_admins`; modo local: ADMIN_LOCAL_EMAIL). Não admin = 404.
// Nunca registra o valor de variável de ambiente nem o motivo da recusa: quem consulta o endpoint não aprende nada.

export { centralLiberada };

/** Página e função de consulta: central fechada, ou quem pede não é admin com MFA = `notFound()` (404); admin sem MFA = redireciona ao cadastro do fator. */
export async function exigirAdmin(): Promise<void> {
  if (!centralLiberada()) notFound();
  await operadorAtual();
}

/**
 * Só o layout do grupo: igual a `exigirAdmin()`, exceto que as páginas de /admin/entrar (marcadas pelo middleware, só em modo produção) não exigem admin: quem entra ainda não tem sessão.
 * Essas páginas se protegem sozinhas (`exigirEntrada`, `exigirFator`). Com a marca presente, ainda se exige a central liberada em modo produção.
 */
export async function exigirAdminOuEntrada(): Promise<void> {
  if (!centralLiberada()) notFound();
  if ((await headers()).get(MARCA_ENTRADA) === "1") {
    if (decidirAcesso(process.env).modo !== "producao") notFound();
    return;
  }
  await operadorAtual();
}

/** Route handler: `null` se liberada e admin com MFA; senão um 404 sem corpo (nunca redireciona: um fetch POST não segue 307). Use: `const negado = await exigirAdminApi(); if (negado) return negado;` */
export async function exigirAdminApi(): Promise<Response | null> {
  if (!centralLiberada()) return new Response(null, { status: 404 });
  const r = await resolverOperador();
  return r.ok ? null : new Response(null, { status: 404 });
}

/** Página /admin/entrar: só em modo produção e só com a marca do middleware (prova que o Host e a regra foram conferidos). Qualquer outra coisa = 404. */
export async function exigirEntrada(): Promise<void> {
  if (decidirAcesso(process.env).modo !== "producao") notFound();
  if ((await headers()).get(MARCA_ENTRADA) !== "1") notFound();
}

/**
 * POST da central: só aceita requisição feita pela própria página (mesma origem) e em JSON. Sem isto, qualquer site aberto no navegador do admin poderia gravar pedido com um POST
 * `text/plain` (que não exige preflight). Exige `Origin` e `Sec-Fetch-Site: same-origin` PRESENTES (ausente = 403) e o Host do modo. `null` = aceita; senão a resposta de recusa.
 * A regra é a função pura `origemRecusada` (guarda-regra.ts).
 */
export function recusarOrigemExterna(req: Request): Response | null {
  const recusado = origemRecusada({
    modo: decidirAcesso(process.env).modo,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    contentType: req.headers.get("content-type"),
  });
  return recusado ? new Response(JSON.stringify({ erro: "requisição recusada" }), { status: 403, headers: { "content-type": "application/json" } }) : null;
}

/**
 * Server action das páginas de entrada: o CSRF do Next já compara `Origin` com o Host; confere-se de novo, com a mesma regra dos POST da central (Origin e Sec-Fetch-Site presentes e
 * da própria central; sem exigir JSON, porque o corpo de uma action é multipart). `true` = recusar.
 */
export async function acaoComOrigemExterna(): Promise<boolean> {
  const h = await headers();
  return origemRecusada({
    modo: decidirAcesso(process.env).modo,
    host: h.get("host"),
    origin: h.get("origin"),
    secFetchSite: h.get("sec-fetch-site"),
    contentType: null,
    exigirJson: false,
  });
}
