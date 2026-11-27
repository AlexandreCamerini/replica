// robots.txt e sitemap.xml do site público (plano de go-live, item 0.6). Módulo PURO: recebe o ambiente, para o teste rodar sem Next.
// Só indexa quando SITE_URL é uma origem https válida (produção, em www.segueovoto.com.br). Sem ela (Preview, desenvolvimento, CI),
// robots.txt manda não indexar nada: os aliases *.vercel.app de Preview não entram em buscador.
// O sitemap lista só páginas fixas e públicas; páginas pessoais (ajustes, acompanhando, começar, conta, entrar) ficam de fora,
// coerente com o noindex que elas mesmas declaram. Páginas por pessoa, votação e tema ficam para depois (são dezenas de milhares).

type Ambiente = Record<string, string | undefined>;

export type Robots = { rules: { userAgent: string; allow?: string; disallow?: string | string[] }[]; sitemap?: string };
export type EntradaSitemap = { url: string; changeFrequency: "daily" | "weekly" | "monthly"; priority: number };

/** Caminhos que nunca entram em buscador, mesmo em produção. */
// D359: `/p/` (perfil do desenho anterior, 71 mil páginas dinâmicas que já apontam `canonical` para `/pessoa/`), `/sugestoes`, `/cidades/` e `/no-seu-bolso` eram a porta de entrada das rajadas de robôs no banco.
export const FORA_DO_BUSCADOR = ["/api/", "/ajustes", "/acompanhando", "/comecar", "/conta", "/entrar", "/design", "/p/", "/sugestoes", "/cidades/", "/no-seu-bolso"] as const;

/** `true` para hosts de alias da Vercel (produção e Preview): o site nunca é indexado ali. */
export const ehHostVercelApp = (host: string | null | undefined): boolean => /\.vercel\.app$/i.test((host ?? "").split(":")[0].trim());

/** Páginas fixas e públicas do sitemap, com a frequência com que mudam. */
export const PAGINAS_DO_SITEMAP: readonly { caminho: string; changeFrequency: EntradaSitemap["changeFrequency"]; priority: number }[] = [
  { caminho: "/", changeFrequency: "daily", priority: 1 },
  { caminho: "/pessoas", changeFrequency: "daily", priority: 0.9 },
  { caminho: "/votacoes", changeFrequency: "daily", priority: 0.9 },
  { caminho: "/decisoes", changeFrequency: "daily", priority: 0.8 },
  { caminho: "/temas", changeFrequency: "weekly", priority: 0.7 },
  { caminho: "/como-funciona", changeFrequency: "monthly", priority: 0.6 },
  { caminho: "/sobre", changeFrequency: "monthly", priority: 0.4 },
  { caminho: "/dados-abertos", changeFrequency: "monthly", priority: 0.4 },
];

/** A origem pública do site (`https://host`, sem barra no fim), ou `null` se SITE_URL não serve para indexar. */
export function origemPublica(env: Ambiente): string | null {
  const v = env.SITE_URL?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.hostname === "" || u.hostname === "localhost") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function robots(env: Ambiente, host?: string | null): Robots {
  const origem = origemPublica(env);
  if (!origem || ehHostVercelApp(host)) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...FORA_DO_BUSCADOR] }],
    sitemap: `${origem}/sitemap.xml`,
  };
}

/** Sem origem pública, o sitemap sai vazio (não anuncia URL de Preview nem de desenvolvimento). */
export function sitemap(env: Ambiente): EntradaSitemap[] {
  const origem = origemPublica(env);
  if (!origem) return [];
  return PAGINAS_DO_SITEMAP.map((p) => ({ url: `${origem}${p.caminho === "/" ? "" : p.caminho}`, changeFrequency: p.changeFrequency, priority: p.priority }));
}
