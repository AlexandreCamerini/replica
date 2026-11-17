import type { NextConfig } from "next";

// Projeto Vercel da central (admin.segueovoto.com.br): `ADMIN_CENTRAL=producao` no BUILD (variável que só existe nesse projeto; o projeto do site não tem nenhuma `ADMIN_*`).
// Nele, o deploy contém o site público inteiro (mesmo repo), e a central não pode dividir origem com ele (achados A1, A9, A13 da verificação F3):
//   - rewrite `beforeFiles`: todo caminho fora de /admin, /_next/static, /geo/br.json e /geo/uf/NN.json (malhas que a central lê) e /favicon.ico vai para um caminho que não existe -> 404 do Next, sem renderizar página pública e sem
//     executar server action pública (o roteamento de action é pelo caminho de destino). Roda antes de páginas, rotas de API e arquivos de /public.
//   - `skipTrailingSlashRedirect`: sem o 308 de barra final (que sai antes de qualquer cabeçalho); a barra final passa pelo middleware.
//   - cabeçalhos em TODA rota (`/:path*`), para cobrir as respostas que não passam pelo middleware (404 do rewrite, estáticos, malhas): X-Frame-Options, Referrer-Policy e uma CSP mínima só com
//     `frame-ancestors 'none'`. A CSP completa (com nonce) continua do middleware nas rotas da central; o navegador aplica as duas políticas, e a soma não restringe nada além do que o
//     middleware já impõe (frame-ancestors 'none' é idêntico nas duas).
// Sem `ADMIN_CENTRAL=producao` o objeto devolvido é exatamente o de antes (site, dev, CI, central local).

export const MODO_PRODUCAO_DA_CENTRAL = "producao";
/** Caminhos que o projeto admin continua servindo: a central, os estáticos do build (/_next/static; /_next/data e /_next/image não: a central não os usa e /_next/image é um proxy de imagens), as malhas que existem de fato (/geo/br.json e /geo/uf/<código IBGE das 27 UFs>.json: um /geo/<outro> iria ao not-found público de 22 KB) e o favicon. Tudo o mais vai ao 404. */
export const FORA_DA_CENTRAL = "/:caminho((?!admin(?:/|$)|_next/static/|geo/br\\.json$|geo/uf/(?:1[1-7]|2[1-9]|3[1-3]|35|4[1-3]|5[0-3])\\.json$|favicon\\.ico$).*)";
/**
 * Destino que não existe como página, rota nem arquivo E que o Next responde sem renderizar nada: `/_next/static/*` inexistente vai ao servidor de estáticos, que responde 404 com o corpo
 * "Not Found" (9 B). Qualquer outro destino inexistente (inclusive `/_next/x`) cai no `not-found.tsx` do site e renderiza a página pública de 404 (~22 KB, com o layout do site).
 */
export const DESTINO_404 = "/_next/static/admin-central-fora-do-escopo";
export const CSP_MINIMA = "frame-ancestors 'none'";

export function configuracao(env: Record<string, string | undefined>): NextConfig {
  const base: NextConfig = {
    // os testes e2e sobem um servidor próprio sem colidir com o dev server (mesma pasta .next quebra as rotas)
    distDir: env.NEXT_DIST_DIR || ".next",
    images: { remotePatterns: [{ protocol: "https", hostname: "www.camara.leg.br" }, { protocol: "http", hostname: "www.senado.leg.br" }] },
  };
  if (env.ADMIN_CENTRAL !== MODO_PRODUCAO_DA_CENTRAL) return base;
  return {
    ...base,
    // A9: o redirecionamento 308 de barra final do Next roda ANTES dos cabeçalhos do config e do middleware (a resposta sai sem CSP/XFO). Sem ele, `/admin/fila/` é servido como `/admin/fila`,
    // passa pelo middleware (guarda, sessão e cabeçalhos completos) e nenhuma resposta da central sai sem cabeçalho. Só no projeto admin.
    skipTrailingSlashRedirect: true,
    // N1 (reverificação F3): sem isto o Next compara rotas e rewrites sem distinguir maiúsculas; a exceção `admin|_next/static/` do rewrite casava `/ADMIN` e `/_NEXT/STATIC/x`,
    // que escapavam do rewrite e do middleware e serviam o not-found público. Com rotas sensíveis à caixa, `/ADMIN` cai no rewrite (404 de 9 B). Só no projeto admin.
    experimental: { ...(base.experimental ?? {}), caseSensitiveRoutes: true },
    async rewrites() {
      return { beforeFiles: [{ source: FORA_DA_CENTRAL, destination: DESTINO_404 }], afterFiles: [], fallback: [] };
    },
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Referrer-Policy", value: "same-origin" },
            { key: "Content-Security-Policy", value: CSP_MINIMA },
          ],
        },
      ];
    },
  };
}

export default configuracao(process.env);
