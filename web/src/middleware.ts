// Guarda da central na borda da requisição (critério 15; AC-23). Roda ANTES do roteador do Next, para QUALQUER método e qualquer requisição, inclusive RSC e prefetch:
//   1. central fechada -> 404 sem corpo;  2. Host fora do permitido do modo (local: localhost; produção: admin.segueovoto.com.br) -> 404;
//   3. modo produção: `updateSession` do @supabase/ssr (renova o token e regrava os cookies) e `getUser()`; sem usuário -> 404, EXCETO a página de e-mail e código (/admin/entrar).
// Em TODA resposta (inclusive os 404) entram os cabeçalhos de segurança (CSP com nonce, X-Frame-Options, Referrer-Policy). O site público não passa por aqui: o matcher cobre só /admin.
// (`next/server.js` com extensão: o `node --test` só resolve assim, e o webpack do Next aceita igual.)
// Só módulos puros entram aqui (guarda-regra.ts, cabecalhos.ts): nada do site público, nada de `server-only`, nada de sessao.ts/guarda.ts. A identidade fina (e-mail na lista de
// admins, aal2) é de lib/admin/sessao.ts, por requisição, no layout, nas páginas, nas rotas e nas consultas; aqui só se confere que há SESSÃO.
//
// Marca de entrada: as duas páginas de /admin/entrar são renderizadas dentro do layout da central, que exige admin. O middleware põe o cabeçalho de REQUISIÇÃO `x-admin-entrada`
// só nessas páginas (e só em modo produção, com Host certo) e APAGA o que o cliente mandar com esse nome; o layout só pula a checagem de admin quando a marca existe.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server.js";
import { cabecalhosDeSeguranca, CABECALHO_NONCE, ehEntrada, ehEntradaSemSessao, MARCA_ENTRADA, opcoesDeCookieDaCentral } from "./lib/admin/cabecalhos.ts";
import { decidirAcesso, hostDeRequisicaoPermitido } from "./lib/admin/guarda-regra.ts";
import { comPrazo } from "./lib/admin/prazo.ts";

export const config = { matcher: ["/admin", "/admin/:path*"], runtime: "nodejs" };

const novoNonce = (): string => btoa(crypto.randomUUID());

export async function middleware(req: NextRequest): Promise<Response> {
  const acesso = decidirAcesso(process.env);
  const nonce = novoNonce();
  const seguranca = cabecalhosDeSeguranca({ modo: acesso.modo, nonce, desenvolvimento: process.env.NODE_ENV !== "production" });
  const comSeguranca = <R extends Response>(r: R): R => {
    for (const [k, v] of Object.entries(seguranca)) r.headers.set(k, v);
    return r;
  };
  const negar = (): Response => comSeguranca(new Response(null, { status: 404 }));

  if (!acesso.liberada) return negar();
  if (!hostDeRequisicaoPermitido(req.headers.get("host"), acesso.modo)) return negar();

  const { pathname } = req.nextUrl;
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
  if (!temUsuario && !ehEntradaSemSessao(pathname)) return negar();
  return comSeguranca(resposta); // `resposta` é a última criada (a de `setAll`, se houve renovação de sessão)
}
