// Cabeçalhos de segurança e opções de cookie da central (AC-23). Módulo PURO (sem `server-only`, sem Next): o middleware e o `node --test` o importam.
// Aplicados pelo middleware em TODA resposta de /admin (inclusive os 404), e só nelas: o site público não tem middleware e nada daqui vale para ele.
//
// CSP, fonte por fonte (e por quê):
//   default-src 'self'      tudo o que não tem diretiva própria só vem da própria origem.
//   script-src              'self' (chunks do Next) + 'nonce-<por requisição>' (os scripts inline do Next: o Next lê o nonce do cabeçalho CSP DA REQUISIÇÃO e o põe neles;
//                           a página é dinâmica, o que o nonce exige) + o hash do script do tema do layout raiz da central (app/layout.admin.tsx, `themeScript`, texto idêntico ao do layout do site), que é inline e não leva nonce. Com nonce na política, 'unsafe-inline' seria ignorado; por isso o hash. Um teste confere o hash contra o texto
//                           real dos layouts. 'unsafe-eval' SÓ em desenvolvimento (o React o usa para reconstruir pilhas); nunca em produção.
//                           Em produção E só nas páginas de entrada, challenges.cloudflare.com: o Turnstile (o mesmo componente do site). As demais páginas da central não o citam.
//   style-src 'self' 'unsafe-inline'   atributo `style=` e <style> inline não aceitam nonce no CSP2/3 sem custo alto; o ganho de um CSS inline injetado é pequeno perto do script
//                           e esta é a única diretiva afrouxada. Alternativa (nonce em todo estilo) exige mexer nos componentes, fora do escopo.
//   img-src 'self' data:    `data:` é o QR do cadastro do fator (o Supabase devolve o QR como SVG em data URI).
//   font-src 'self'         as fontes do Fontsource são empacotadas.
//   connect-src 'self'      o navegador só fala com a própria central (fetch de /admin/api e RSC). O Supabase Auth é chamado SÓ pelo servidor (server actions); por isso a URL do
//                           Supabase NÃO está na política. Nas páginas de entrada em produção, challenges.cloudflare.com também (o Turnstile faz requisição da própria página).
//   frame-src               só nas páginas de entrada em produção: challenges.cloudflare.com (o iframe do Turnstile). Fora disso, 'none'.
//   frame-ancestors 'none'  ninguém enquadra a central (clickjacking: as ações disparam num clique).
//   base-uri 'none'; form-action 'self'; object-src 'none'
// Hosts sem esquema de propósito: valem para https e mantêm este arquivo sem URL absoluta (o teste de código da central proíbe).

import type { ModoCentral } from "./guarda-regra.ts";

/** sha256 (base64) do `themeScript` de src/app/layout.admin.tsx (e de src/app/layout.tsx, que tem o mesmo texto). Se um dos layouts mudar, o teste admin-cabecalhos "hash do tema" quebra. */
export const HASH_SCRIPT_TEMA = "sha256-opRjTqQ1E5eUpc4SE9v3YoU5wuVpgtqT7zsobCj245Q=";
export const HOST_TURNSTILE = "challenges.cloudflare.com";

export type EntradaCabecalhos = {
  modo: ModoCentral | null;
  nonce: string;
  desenvolvimento?: boolean;
  /** `true` só nas duas páginas de entrada (`/admin/entrar`, `/admin/entrar/fator`): é o único lugar onde o Turnstile carrega (A5). Ausente = false. */
  paginaDeEntrada?: boolean;
};

/** O valor do cabeçalho Content-Security-Policy da central. */
export function politicaCsp({ modo, nonce, desenvolvimento = false, paginaDeEntrada = false }: EntradaCabecalhos): string {
  const turnstile = modo === "producao" && paginaDeEntrada;
  const script = ["'self'", `'nonce-${nonce}'`, `'${HASH_SCRIPT_TEMA}'`, ...(desenvolvimento ? ["'unsafe-eval'"] : []), ...(turnstile ? [HOST_TURNSTILE] : [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${turnstile ? ` ${HOST_TURNSTILE}` : ""}`,
    `frame-src ${turnstile ? HOST_TURNSTILE : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** Os três cabeçalhos de segurança da central. */
export function cabecalhosDeSeguranca(e: EntradaCabecalhos): Record<string, string> {
  return {
    "Content-Security-Policy": politicaCsp(e),
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  };
}

/** Nome do cabeçalho de REQUISIÇÃO que só o middleware põe, nas duas páginas de entrada. Qualquer valor vindo do cliente é apagado antes. */
export const MARCA_ENTRADA = "x-admin-entrada";
/** Cabeçalho de requisição com o nonce (o layout e a página de entrada o leem para o script do Turnstile, se precisarem). */
export const CABECALHO_NONCE = "x-admin-nonce";

/** Caminho da central acessível SEM sessão (só a página de e-mail e código) e o que fica sob ele (o cadastro do fator exige sessão). */
export const CAMINHO_ENTRADA = "/admin/entrar";
/** As APIs da entrada (nenhuma server action roda na central: o roteamento de action é por id, e uma action pública executaria sob qualquer caminho /admin). */
export const CAMINHO_API_ENTRADA = "/admin/api/entrar";
/** As duas rotas de API da entrada que respondem SEM sessão (POST): pedir o código e verificá-lo. As de fator exigem sessão aal1. */
export const APIS_DE_ENTRADA_SEM_SESSAO = [`${CAMINHO_API_ENTRADA}/codigo`, `${CAMINHO_API_ENTRADA}/verificar`] as const;
const sob = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);
/** Marca de entrada (cabeçalho de requisição do middleware): páginas e APIs da entrada. */
export const ehEntrada = (pathname: string): boolean => sob(pathname, CAMINHO_ENTRADA) || sob(pathname, CAMINHO_API_ENTRADA);
/** Só as páginas de entrada: é aqui, e só aqui, que a CSP libera o Turnstile (A5). */
export const ehPaginaDeEntrada = (pathname: string): boolean => sob(pathname, CAMINHO_ENTRADA);
/** Passa pelo middleware sem sessão: a página de e-mail e código (qualquer método) e as duas APIs de pedir/verificar código (só POST). */
export const ehEntradaSemSessao = (pathname: string, metodo = "GET"): boolean =>
  pathname === CAMINHO_ENTRADA || (metodo.toUpperCase() === "POST" && (APIS_DE_ENTRADA_SEM_SESSAO as readonly string[]).includes(pathname));

/** Nome próprio do cookie de sessão da central (A10), distinto do `sb-<ref>-auth-token` do site: um cookie plantado pelo site, ou para o site, nunca é lido pela central. O mesmo no middleware e no cliente. */
export const NOME_COOKIE_SESSAO = "sb-admin-central-auth-token";
/** `cookieOptions` do `@supabase/ssr` da central (só o nome; o resto das opções é imposto por `opcoesDeCookieDaCentral` na gravação). */
export const OPCOES_SSR_DA_CENTRAL = { name: NOME_COOKIE_SESSAO } as const;

type OpcoesCookie = { name?: string; domain?: string; path?: string; maxAge?: number; expires?: Date; httpOnly?: boolean; secure?: boolean; sameSite?: boolean | "lax" | "strict" | "none" };

/**
 * Opções dos cookies de sessão da central: host-only (sem `domain`: nunca `.segueovoto.com.br`, que vazaria a sessão para o site), `SameSite=Strict`, `Secure`, `HttpOnly`,
 * `path=/admin`. Preserva só a validade (`maxAge`/`expires`), que é o que o Supabase decide.
 */
export function opcoesDeCookieDaCentral(o: OpcoesCookie = {}): { path: string; httpOnly: true; secure: true; sameSite: "strict"; maxAge?: number; expires?: Date } {
  return { path: "/admin", httpOnly: true, secure: true, sameSite: "strict", ...(o.maxAge !== undefined ? { maxAge: o.maxAge } : {}), ...(o.expires !== undefined ? { expires: o.expires } : {}) };
}
