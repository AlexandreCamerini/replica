// Cabeçalhos de segurança e opções de cookie da central (AC-23). Módulo PURO (sem `server-only`, sem Next): o middleware e o `node --test` o importam.
// Aplicados pelo middleware em TODA resposta de /admin (inclusive os 404), e só nelas: o site público não tem middleware e nada daqui vale para ele.
//
// CSP, fonte por fonte (e por quê):
//   default-src 'self'      tudo o que não tem diretiva própria só vem da própria origem.
//   script-src              'self' (chunks do Next) + 'nonce-<por requisição>' (os scripts inline do Next: o Next lê o nonce do cabeçalho CSP DA REQUISIÇÃO e o põe neles;
//                           a página é dinâmica, o que o nonce exige) + o hash do script do tema do layout raiz (app/layout.tsx, `themeScript`), que é inline, não leva nonce e
//                           não pode ser editado por esta tarefa. Com nonce na política, 'unsafe-inline' seria ignorado; por isso o hash. Um teste confere o hash contra o texto
//                           real do layout. 'unsafe-eval' SÓ em desenvolvimento (o React o usa para reconstruir pilhas); nunca em produção.
//                           Em produção, challenges.cloudflare.com: o Turnstile da página de entrada (o mesmo componente do site).
//   style-src 'self' 'unsafe-inline'   atributo `style=` e <style> inline não aceitam nonce no CSP2/3 sem custo alto; o ganho de um CSS inline injetado é pequeno perto do script
//                           e esta é a única diretiva afrouxada. Alternativa (nonce em todo estilo) exige mexer nos componentes, fora do escopo.
//   img-src 'self' data:    `data:` é o QR do cadastro do fator (o Supabase devolve o QR como SVG em data URI).
//   font-src 'self'         as fontes do Fontsource são empacotadas.
//   connect-src 'self'      o navegador só fala com a própria central (fetch de /admin/api e RSC). O Supabase Auth é chamado SÓ pelo servidor (server actions); por isso a URL do
//                           Supabase NÃO está na política. Em produção, challenges.cloudflare.com também (o Turnstile faz requisição da própria página).
//   frame-src               só em produção: challenges.cloudflare.com (o iframe do Turnstile). Fora disso, 'none'.
//   frame-ancestors 'none'  ninguém enquadra a central (clickjacking: as ações disparam num clique).
//   base-uri 'none'; form-action 'self'; object-src 'none'
// Hosts sem esquema de propósito: valem para https e mantêm este arquivo sem URL absoluta (o teste de código da central proíbe).

import type { ModoCentral } from "./guarda-regra.ts";

/** sha256 (base64) do `themeScript` de src/app/layout.tsx. Se o layout mudar, o teste admin-cabecalhos "hash do tema" quebra. */
export const HASH_SCRIPT_TEMA = "sha256-opRjTqQ1E5eUpc4SE9v3YoU5wuVpgtqT7zsobCj245Q=";
export const HOST_TURNSTILE = "challenges.cloudflare.com";

export type EntradaCabecalhos = { modo: ModoCentral | null; nonce: string; desenvolvimento?: boolean };

/** O valor do cabeçalho Content-Security-Policy da central. */
export function politicaCsp({ modo, nonce, desenvolvimento = false }: EntradaCabecalhos): string {
  const producao = modo === "producao";
  const script = ["'self'", `'nonce-${nonce}'`, `'${HASH_SCRIPT_TEMA}'`, ...(desenvolvimento ? ["'unsafe-eval'"] : []), ...(producao ? [HOST_TURNSTILE] : [])];
  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${producao ? ` ${HOST_TURNSTILE}` : ""}`,
    `frame-src ${producao ? HOST_TURNSTILE : "'none'"}`,
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
export const ehEntrada = (pathname: string): boolean => pathname === CAMINHO_ENTRADA || pathname.startsWith(`${CAMINHO_ENTRADA}/`);
export const ehEntradaSemSessao = (pathname: string): boolean => pathname === CAMINHO_ENTRADA;

type OpcoesCookie = { name?: string; domain?: string; path?: string; maxAge?: number; expires?: Date; httpOnly?: boolean; secure?: boolean; sameSite?: boolean | "lax" | "strict" | "none" };

/**
 * Opções dos cookies de sessão da central: host-only (sem `domain`: nunca `.segueovoto.com.br`, que vazaria a sessão para o site), `SameSite=Strict`, `Secure`, `HttpOnly`,
 * `path=/admin`. Preserva só a validade (`maxAge`/`expires`), que é o que o Supabase decide.
 */
export function opcoesDeCookieDaCentral(o: OpcoesCookie = {}): { path: string; httpOnly: true; secure: true; sameSite: "strict"; maxAge?: number; expires?: Date } {
  return { path: "/admin", httpOnly: true, secure: true, sameSite: "strict", ...(o.maxAge !== undefined ? { maxAge: o.maxAge } : {}), ...(o.expires !== undefined ? { expires: o.expires } : {}) };
}
