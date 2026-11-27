import type { NextConfig } from "next";

// DOIS BUILDS DISJUNTOS DO MESMO CÓDIGO (AC-29). Dois projetos Vercel: o site (`www`) e a central (`admin.segueovoto.com.br`, com `ADMIN_CENTRAL=producao` NO BUILD).
//   - Build do SITE (sem `ADMIN_CENTRAL` no build): extensões de página padrão do Next. Nenhum arquivo `*.admin.*` entra (páginas, rotas de API, layout, not-found, middleware): o site não tem
//     middleware e as rotas `/admin*` não existem. O objeto devolvido é EXATAMENTE o do ponto de partida da fase (distDir e images).
//   - Build da CENTRAL (`ADMIN_CENTRAL` = `1` (modo local) ou `producao`): `pageExtensions` só com `admin.tsx` e `admin.ts`. Nenhuma página, rota, layout, not-found, metadado nem server action
//     do site entra; o middleware é `src/middleware.admin.ts` (o Next o detecta pelas mesmas extensões) e cobre TUDO: o que não for rota da central, estático do build ou malha `/geo` dá 404.
//     Não há site para proteger neste build, então não há filtro por caminho que possa vazar por variação de caixa, `%2F`, barras, `/_next/image`, `/_next/data` etc.
// O `1` e o `producao` mudam só o que o middleware decide em tempo de execução (modos da AC-23); o build é o mesmo. Qualquer outro valor (inclusive vazio) = build do site.

export const MODO_PRODUCAO_DA_CENTRAL = "producao";
/** Extensões de página do build da central. Os arquivos da central são `page.admin.tsx`, `route.admin.ts`, `layout.admin.tsx`, `not-found.admin.tsx` e `middleware.admin.ts`. */
export const EXTENSOES_DA_CENTRAL = ["admin.tsx", "admin.ts"] as const;
export const CSP_MINIMA = "frame-ancestors 'none'";
/** `[Cc][Rr]...`: o `has` do Next usa regex sem flag, então a caixa vira classe de caracteres. */
const semCaixa = (palavra: string): string => [...palavra].map((c) => (/[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c)).join("");
/** D359: robôs de busca, de IA e de raspagem que se declaram no user agent (nenhum navegador comum traz estas palavras). */
export const ROBOS_DECLARADOS = ["bot", "crawl", "spider", "slurp", "scrap", "headless", "python-requests", "curl/", "wget", "go-http-client", "java/", "okhttp", "libwww", "httpclient", "meta-externalagent", "bytespider", "ahrefs", "semrush", "mj12"] as const;
/** Quem monta pré-visualização de link compartilhado (o card de WhatsApp, X, Telegram...) não é raspador: segue vendo `/p/`. */
export const PREVIEW_DE_LINK = ["facebookexternalhit", "whatsapp", "twitterbot", "telegrambot", "slackbot", "linkedinbot", "discordbot", "skypeuripreview"] as const;
export const UA_ROBO = `^(?!.*(${PREVIEW_DE_LINK.map(semCaixa).join("|")})).*(${ROBOS_DECLARADOS.map(semCaixa).join("|")}).*$`;

/** Host de aliases da Vercel (produção e Preview), onde o site não pode ser indexado. */
export const HOST_VERCEL_APP = ".*\\.vercel\\.app";

/** `true` quando o BUILD é o da central (`ADMIN_CENTRAL` = `1` ou `producao`). */
export const ehBuildDaCentral = (env: Record<string, string | undefined>): boolean => env.ADMIN_CENTRAL === "1" || env.ADMIN_CENTRAL === MODO_PRODUCAO_DA_CENTRAL;

export function configuracao(env: Record<string, string | undefined>): NextConfig {
  const base: NextConfig = {
    // os testes e2e sobem um servidor próprio sem colidir com o dev server (mesma pasta .next quebra as rotas)
    distDir: env.NEXT_DIST_DIR || ".next",
    images: { remotePatterns: [{ protocol: "https", hostname: "www.camara.leg.br" }, { protocol: "http", hostname: "www.senado.leg.br" }] },
  };
  // D359: redirects e headers são só do build do SITE; a central (abaixo) mantém o contrato anterior, sem redirect.
  if (!ehBuildDaCentral(env)) {
    return {
      ...base,
      // o mesmo site também responde em *.vercel.app (produção e Preview). Esses hosts nunca entram em buscador: noindex por cabeçalho, sem middleware (o site não tem).
      // Só o host decide; o www.segueovoto.com.br não casa. O robots.txt desses hosts também fecha tudo (src/lib/seo.ts).
      // D359 (custo zero): robô declarado que pede o perfil antigo ou /sugestoes é mandado ao destino canônico pelo roteador da Vercel, sem acionar função nem banco. Pessoas não são afetadas.
      async redirects() {
        const robo = [{ type: "header" as const, key: "user-agent", value: UA_ROBO }];
        return [
          { source: "/p/:slug", has: robo, destination: "/pessoa/:slug", permanent: true },
          { source: "/p/:slug/:resto*", has: robo, destination: "/pessoa/:slug", permanent: true },
          { source: "/sugestoes", has: robo, destination: "/", permanent: true },
        ];
      },
      async headers() {
        return [{ source: "/:path*", has: [{ type: "host", value: HOST_VERCEL_APP }], headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
      },
    };
  }
  return {
    ...base,
    pageExtensions: [...EXTENSOES_DA_CENTRAL],
    // O 308 de barra final do Next roda ANTES dos cabeçalhos do config e do middleware (a resposta sairia sem CSP/XFO). Sem ele, `/admin/fila/` chega ao middleware (guarda, sessão e cabeçalhos).
    skipTrailingSlashRedirect: true,
    // Cabeçalhos em TODA rota: X-Frame-Options, Referrer-Policy e uma CSP mínima só com `frame-ancestors 'none'` (a completa, com nonce, é do middleware; o navegador aplica as duas e frame-ancestors é idêntico).
    // MEDIDO na F3-C3: com o middleware cobrindo toda requisição, esta regra ficou REDUNDANTE (removida do routes-manifest, nenhuma resposta perdeu cabeçalho; as únicas respostas sem cabeçalho, o 308 de barras repetidas
    // e o 500 do TRACE, saem antes do middleware e do config, com ou sem esta regra). Mantida como defesa em profundidade; a retirada é decisão do orquestrador.
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
