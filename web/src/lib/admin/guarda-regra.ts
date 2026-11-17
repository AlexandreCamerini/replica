// Regra pura da guarda de acesso da central (plano, seção 4a; AC-23). A guarda real só chama `decidirAcesso` e responde 404.
// Dois modos, escolhidos por ADMIN_CENTRAL (valor exato; qualquer outro = fechada):
//
//   MODO LOCAL (`ADMIN_CENTRAL=1`): as regras de sempre. Ordem de verificação (a primeira que vale bloqueia):
//     1. VERCEL definida (qualquer valor, inclusive vazio)
//     2. VERCEL_ENV definida (idem)
//     3. ADMIN_DATABASE_URL ausente, vazia ou malformada
//     4. host fora de localhost, 127.0.0.1, ::1
//     5. protocolo diferente de postgres:/postgresql:, vírgula no authority (vários hosts) ou parâmetro de query `host`, `hostaddr`, `service`
//        (o driver `postgres` usa o `host` da query antes do host da URL: a checagem do hostname sozinha não basta)
//   MODO PRODUÇÃO (`ADMIN_CENTRAL=producao`): a central no projeto Vercel próprio, em HOST_CENTRAL_PRODUCAO.
//     1. VERCEL_ENV exatamente "production" (Preview e Development ficam fechados)
//     2. AUTH_PROVIDER exatamente "supabase" (o provedor "dev" nunca autentica a central)
//     3. ADMIN_DATABASE_URL postgres válida, com as MESMAS recusas do modo local (`#`, espaço, controle, vírgula, host/hostaddr/service na query), em qualquer host,
//        com `sslmode` único e igual a require, verify-ca ou verify-full
//   Sessão do Supabase, aal2 e lista de admins são conferidos por requisição (lib/admin/sessao.ts), não aqui.
// NODE_ENV não entra: `next start` local roda com production.

export type ModoCentral = "local" | "producao";
/** `modo` é nulo quando a central está fechada. */
export type DecisaoAcesso = { liberada: boolean; motivo: string; modo: ModoCentral | null };

export const HOSTS_LOCAIS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);
/** Host público da central em produção. Constante no código, não em variável: o alias *.vercel.app do projeto não pode abrir a central. */
export const HOST_CENTRAL_PRODUCAO = "admin.segueovoto.com.br";
export const SSLMODES_ACEITOS: readonly string[] = ["require", "verify-ca", "verify-full"];

type UrlBanco = { ok: true; host: string; sslmodes: string[] } | { ok: false; motivo: string };

/** Leitura comum da URL do banco nos dois modos: formato, caracteres, protocolo, vários hosts, query de host. O host devolvido é o do driver, conferido contra o da URL. */
function lerUrlDoBanco(url: string | undefined): UrlBanco {
  const nega = (motivo: string): UrlBanco => ({ ok: false, motivo });
  if (url === undefined || url.trim() === "") return nega("ADMIN_DATABASE_URL ausente");
  // `#`, espaço e caractere de controle: o driver `postgres` corta a URL só em `/` e `?` (não em `#`), então `localhost#@remoto` conectaria no remoto (achado N1).
  if (/[#\s\u0000-\u001f\u007f]/.test(url)) return nega("ADMIN_DATABASE_URL com caractere não aceito");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return nega("ADMIN_DATABASE_URL malformada");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return nega("ADMIN_DATABASE_URL com protocolo que não é postgres");
  const authority = url.trim().replace(/^[^:]*:\/\//, "").split(/[/?]/)[0] ?? "";
  if (authority.slice(authority.lastIndexOf("@") + 1).includes(",")) return nega("ADMIN_DATABASE_URL com mais de um host");
  for (const k of u.searchParams.keys()) {
    if (["host", "hostaddr", "service"].includes(k.toLowerCase())) return nega("ADMIN_DATABASE_URL com host na query");
  }
  const tira = (h: string): string => (h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h);
  const host = tira(u.hostname.toLowerCase());
  // Segunda leitura, do jeito do driver (node_modules/postgres/src/index.js, parseUrl): authority até o primeiro `/` ou `?`, host depois do último `@`.
  const hostDriver = tira(authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "").toLowerCase());
  if (host === "" || hostDriver === "" || host !== hostDriver) return nega("ADMIN_DATABASE_URL: host lido de dois jeitos diferentes");
  return { ok: true, host, sslmodes: u.searchParams.getAll("sslmode") };
}

export function decidirAcesso(env: Record<string, string | undefined>): DecisaoAcesso {
  const nega = (motivo: string): DecisaoAcesso => ({ liberada: false, motivo, modo: null });
  if (env.ADMIN_CENTRAL === "1") {
    if (env.VERCEL !== undefined) return nega("VERCEL definida");
    if (env.VERCEL_ENV !== undefined) return nega("VERCEL_ENV definida");
    const l = lerUrlDoBanco(env.ADMIN_DATABASE_URL);
    if (!l.ok) return nega(l.motivo);
    if (!HOSTS_LOCAIS.has(l.host)) return nega("host de ADMIN_DATABASE_URL não é local");
    return { liberada: true, motivo: "ligada, fora da Vercel, banco local", modo: "local" };
  }
  if (env.ADMIN_CENTRAL === "producao") {
    if (env.VERCEL_ENV !== "production") return nega("modo produção exige VERCEL_ENV=production");
    if (env.AUTH_PROVIDER !== "supabase") return nega("modo produção exige AUTH_PROVIDER=supabase");
    const l = lerUrlDoBanco(env.ADMIN_DATABASE_URL);
    if (!l.ok) return nega(l.motivo);
    if (l.sslmodes.length !== 1 || !SSLMODES_ACEITOS.includes(l.sslmodes[0])) return nega("ADMIN_DATABASE_URL sem sslmode require, verify-ca ou verify-full (um só)");
    return { liberada: true, motivo: "modo produção: Vercel production, Supabase Auth, banco com TLS", modo: "producao" };
  }
  return nega("ADMIN_CENTRAL não é 1 nem producao");
}

/** A central está liberada neste processo, em algum dos dois modos? Lê o ambiente a cada chamada. (Aqui, e não em guarda.ts, para db.ts e sessao.ts não formarem ciclo com ela.) */
export function centralLiberada(): boolean {
  return decidirAcesso(process.env).liberada;
}

/**
 * O cabeçalho Host da requisição é local? (`localhost`, `127.0.0.1`, `[::1]`, com ou sem porta, qualquer caixa.) Barra DNS rebinding: um nome externo que
 * resolve para 127.0.0.1 chega aqui com o Host do atacante. Ausente ou vazio = não é local.
 */
export function hostDeRequisicaoLocal(host: string | null | undefined): boolean {
  if (host === null || host === undefined) return false;
  const m = host.trim().toLowerCase().match(/^(\[[0-9a-f:.]+\]|[^:\[\]]+)(?::\d+)?$/);
  if (m === null) return false;
  const nome = m[1].startsWith("[") ? m[1].slice(1, -1) : m[1];
  return HOSTS_LOCAIS.has(nome);
}

/**
 * O cabeçalho Host da requisição é o da central neste modo? Local: `localhost`, `127.0.0.1`, `[::1]`, com ou sem porta. Produção: exatamente HOST_CENTRAL_PRODUCAO,
 * sem porta ou com 443, qualquer caixa, sem ponto final. Modo nulo (central fechada) = não. Barra DNS rebinding e o alias *.vercel.app.
 */
export function hostDeRequisicaoPermitido(host: string | null | undefined, modo: ModoCentral | null): boolean {
  if (modo === "local") return hostDeRequisicaoLocal(host);
  if (modo !== "producao" || host === null || host === undefined) return false;
  const h = host.trim().toLowerCase();
  return h === HOST_CENTRAL_PRODUCAO || h === `${HOST_CENTRAL_PRODUCAO}:443`;
}

export type EntradaCsrf = {
  modo: ModoCentral | null;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
  /** Falso só nas server actions das páginas de entrada (o corpo delas é multipart, e o CSRF do próprio Next já as cobre); padrão: verdadeiro. */
  exigirJson?: boolean;
};

/**
 * POST da central: recusa (true) tudo o que não for a própria página, em JSON. Exige (os dois, nos dois modos): `Origin` PRESENTE e igual à origem da central, `Sec-Fetch-Site`
 * PRESENTE e `same-origin`, e `content-type: application/json` (que força preflight de CORS). Ausente = recusa. Origem da central: local = http no Host da requisição
 * (porta inclusive: Origin com outra porta é outra origem); produção = https no HOST_CENTRAL_PRODUCAO (sem porta ou 443).
 */
export function origemRecusada(e: EntradaCsrf): boolean {
  if (!hostDeRequisicaoPermitido(e.host, e.modo)) return true;
  if (e.secFetchSite === null || e.secFetchSite.trim().toLowerCase() !== "same-origin") return true;
  if (e.origin === null) return true;
  let o: URL;
  try {
    o = new URL(e.origin);
  } catch {
    return true;
  }
  if (o.username !== "" || o.password !== "" || o.pathname !== "/" || o.search !== "" || o.hash !== "") return true;
  if (e.modo === "producao") {
    if (o.protocol !== "https:" || (o.host !== HOST_CENTRAL_PRODUCAO && o.host !== `${HOST_CENTRAL_PRODUCAO}:443`)) return true;
    if (o.port !== "") return true; // o WHATWG URL já tira a 443 padrão; qualquer porta que sobre é outra origem
  } else if (o.protocol !== "http:" || o.host.toLowerCase() !== (e.host ?? "").trim().toLowerCase()) return true;
  return e.exigirJson === false ? false : !(e.contentType ?? "").toLowerCase().startsWith("application/json");
}

/** Códigos IBGE das 27 UFs: as únicas malhas `/geo/uf/<código>.json` que existem em public/ (um teste confere contra a pasta). */
export const CODIGOS_UF_DA_MALHA = ["11", "12", "13", "14", "15", "16", "17", "21", "22", "23", "24", "25", "26", "27", "28", "29", "31", "32", "33", "35", "41", "42", "43", "50", "51", "52", "53"] as const;
const MALHA_UF = new RegExp(`^/geo/uf/(?:${CODIGOS_UF_DA_MALHA.join("|")})\\.json$`);
/** `/favicon.ico` (metadado estático do site, `src/app/favicon.ico`, que o Next incorpora ao build da central e que as páginas da central referenciam num `<link rel="icon">`): ícone binário, sem HTML. Exceção declarada. */
export const FAVICON = "/favicon.ico";
/** Os cinco SVG do modelo do Next que estão em public/ (sem texto nem marca do site; conferido: nenhum tem HTML). Um teste confere esta lista contra a pasta (junto com as malhas): arquivo novo em public/ é 404 até entrar aqui. */
export const SVG_DE_PUBLIC = ["/file.svg", "/globe.svg", "/next.svg", "/vercel.svg", "/window.svg"] as const;
/**
 * Arquivos estáticos que o build da central serve além de /admin (AC-29), por comparação EXATA e sensível à caixa: `/_next/static/*` (chunks e CSS do build; sem `..`, barras repetidas nem `%` além dos colchetes `%5B` e `%5D` das rotas dinâmicas), `/geo/br.json`,
 * as 27 malhas de UF, os cinco SVG de public/ e o favicon. Tudo o mais é 404 no middleware (inclusive o proxy de imagens do Next e `/_next/data`).
 */
export function ehEstaticoDaCentral(pathname: string): boolean {
  if (pathname.startsWith("/_next/static/")) return !/\.\.|%(?!5[BD])|\/{2}/.test(pathname); // `%5B`/`%5D`: colchetes das rotas dinâmicas (`[classe]`) nos nomes dos chunks; qualquer outro `%` é recusado
  return pathname === "/geo/br.json" || MALHA_UF.test(pathname) || pathname === FAVICON || (SVG_DE_PUBLIC as readonly string[]).includes(pathname);
}
