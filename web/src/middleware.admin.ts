// Guarda da central na borda da requisição (critério 15; AC-23). Roda ANTES do roteador do Next, para QUALQUER método e qualquer requisição, inclusive RSC e prefetch:
//   1. central fechada -> 404 sem corpo;  2. Host fora do permitido do modo (local: localhost; produção: admin.segueovoto.com.br) -> 404;
//   3. modo produção: `updateSession` do @supabase/ssr (renova o token e regrava os cookies) e `getUser()`; sem usuário -> 404, EXCETO a página de e-mail e código (/admin/entrar).
// Em TODA resposta (inclusive os 404) entram os cabeçalhos de segurança (CSP com nonce, X-Frame-Options, Referrer-Policy). Este arquivo só existe no build da central (AC-29); o site público não tem middleware.
// (`next/server.js` com extensão: o `node --test` só resolve assim, e o webpack do Next aceita igual.)
// Só módulos puros entram aqui (guarda-regra.ts, cabecalhos.ts): nada do site público, nada de `server-only`, nada de sessao.ts/guarda.ts. A identidade fina (e-mail na lista de
// admins, aal2) é de lib/admin/sessao.ts, por requisição, no layout, nas páginas, nas rotas e nas consultas; aqui só se confere que há SESSÃO.
//
// Marca de entrada: as duas páginas de /admin/entrar são renderizadas dentro do layout da central, que exige admin. O middleware põe o cabeçalho de REQUISIÇÃO `x-admin-entrada`
// só nessas páginas (e só em modo produção, com Host certo) e APAGA o que o cliente mandar com esse nome; o layout só pula a checagem de admin quando a marca existe.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server.js";
import { cabecalhosDeSeguranca, CABECALHO_NONCE, ehEntrada, ehEntradaSemSessao, ehPaginaDeEntrada, MARCA_ENTRADA, OPCOES_SSR_DA_CENTRAL, opcoesDeCookieDaCentral } from "./lib/admin/cabecalhos.ts";
import { decidirAcesso, ehEstaticoDaCentral, hostDeRequisicaoPermitido } from "./lib/admin/guarda-regra.ts";
import { comPrazo } from "./lib/admin/prazo.ts";

// Matcher: TUDO, com `/(.*)` e não `/:path*` (este último não casa segmento vazio: `//admin` e `/admin//fila` escapariam do middleware). Este arquivo só existe no build da central (`middleware.admin.ts` + `pageExtensions` só com `.admin.*`; AC-29): não há site público neste build para proteger, então não há filtro por
// caminho no matcher, que vazaria por variação (caixa, `%2F`, barras, o proxy de imagens do Next, `/_next/data`, prefetch RSC, rotas de metadado). O que não for rota da central, estático do build ou malha
// `/geo` dá 404 aqui, com os cabeçalhos de segurança. O build do site não tem este arquivo (nem middleware algum).
export const config = {
  matcher: ["/(.*)"],
  runtime: "nodejs",
};

const novoNonce = (): string => btoa(crypto.randomUUID());
const ehPedidoDeAction = (req: NextRequest): boolean => {
  if (req.headers.has("next-action")) return true;
  const tipo = (req.headers.get("content-type") ?? "").toLowerCase();
  return req.method === "POST" && (tipo.startsWith("multipart/form-data") || tipo.startsWith("application/x-www-form-urlencoded"));
};

export async function middleware(req: NextRequest): Promise<Response> {
  const acesso = decidirAcesso(process.env);
  const nonce = novoNonce();
  const { pathname } = req.nextUrl;
  const seguranca = cabecalhosDeSeguranca({ modo: acesso.modo, nonce, desenvolvimento: process.env.NODE_ENV !== "production", paginaDeEntrada: ehPaginaDeEntrada(pathname) });
  const comSeguranca = <R extends Response>(r: R): R => {
    for (const [k, v] of Object.entries(seguranca)) r.headers.set(k, v);
    return r;
  };
  const negar = (): Response => comSeguranca(new Response(null, { status: 404 }));

  if (!acesso.liberada) return negar();
  if (!hostDeRequisicaoPermitido(req.headers.get("host"), acesso.modo)) return negar();
  // Só são da central: /admin, /admin/* (sensível à caixa: `/ADMIN` não é rota) e os arquivos estáticos que ela serve (/_next/static/*, as malhas /geo, os SVG de public/ e o favicon). Todo o resto (inclusive `/`, o proxy de imagens do Next,
  // `/_next/data`, `/icon`, `/robots.txt`, qualquer outro arquivo de /public) = 404 aqui, antes do roteador. Nenhuma server action roda sob os estáticos: a regra abaixo vale para os dois.
  const rotaDaCentral = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!rotaDaCentral && !ehEstaticoDaCentral(pathname)) return negar();
  // NENHUMA server action roda na central (A1/A13): o Next roteia a action pelo ID, não pelo caminho, então uma action PÚBLICA executaria sob qualquer /admin/*. Cabeçalho `Next-Action`
  // (fetch) ou POST de formulário (multipart/urlencoded: o envio sem JavaScript leva o id no corpo) = 404 antes de tudo. As rotas de API da central só aceitam JSON.
  if (ehPedidoDeAction(req)) return negar();
  // estático (sem sessão: o navegador carrega os chunks da página de entrada antes de ter sessão): passa, com os cabeçalhos
  if (!rotaDaCentral) return comSeguranca(NextResponse.next());
  // V3 (verificação v3): páginas da central só respondem GET e HEAD; os outros métodos só nas rotas de API, que tratam o próprio método.
  const ehApi = pathname === "/admin/api" || pathname.startsWith("/admin/api/");
  if (!ehApi && req.method !== "GET" && req.method !== "HEAD") return negar();
  // V1: `Next-Router-Prefetch` sem `RSC` derruba o renderizador do Next (500, exceção no log, sem autenticação); o navegador nunca manda um sem o outro.
  if (req.headers.has("next-router-prefetch") && !req.headers.has("rsc")) return negar();

  // Cabeçalhos da REQUISIÇÃO que o Next repassa às páginas: o CSP (de onde o Next tira o nonce dos seus scripts) e o nonce. A marca de entrada nunca vem do cliente.
  const proxima = (marcarEntrada: boolean): NextResponse => {
    const h = new Headers(req.headers);
    h.delete(MARCA_ENTRADA);
    h.set("Content-Security-Policy", seguranca["Content-Security-Policy"]);
    h.set(CABECALHO_NONCE, nonce);
    if (marcarEntrada) h.set(MARCA_ENTRADA, "1");
    return NextResponse.next({ request: { headers: h } });
  };

  if (acesso.modo === "local") return comSeguranca(proxima(false));

  // ---- modo produção
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return negar();
  const marcar = ehEntrada(pathname);
  let resposta = proxima(marcar);
  const supabase = createServerClient(url, anon, {
    cookieOptions: OPCOES_SSR_DA_CENTRAL,
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll(lista, cabecalhos) {
        // Padrão do @supabase/ssr: grava na requisição (para o RSC desta mesma passagem ver o token novo), refaz a resposta a partir dela e grava na resposta (para o navegador).
        for (const { name, value } of lista) req.cookies.set(name, value);
        resposta = proxima(marcar);
        for (const { name, value, options } of lista) resposta.cookies.set(name, value, opcoesDeCookieDaCentral(options));
        for (const [k, v] of Object.entries(cabecalhos ?? {})) resposta.headers.set(k, v);
      },
    },
  });
  let temUsuario = false;
  try {
    const { data, error } = await comPrazo(supabase.auth.getUser()); // valida o token no servidor do Auth; não confia só no cookie; com prazo (provedor fora do ar = 404 rápido)
    temUsuario = !error && !!data.user;
  } catch {
    temUsuario = false; // falha do provedor = sem usuário = 404 (fecha)
  }
  if (!temUsuario && !ehEntradaSemSessao(pathname, req.method)) return negar();
  return comSeguranca(resposta); // `resposta` é a última criada (a de `setAll`, se houve renovação de sessão)
}
