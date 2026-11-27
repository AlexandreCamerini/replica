import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { configuracao, CSP_MINIMA, EXTENSOES_DA_CENTRAL } from "../../../next.config.ts";
import { middleware } from "../../middleware.admin.ts";
import { cabecalhosDeSeguranca, ehEntradaSemSessao, ehPaginaDeEntrada, NOME_COOKIE_SESSAO, politicaCsp } from "../admin/cabecalhos.ts";
import { completarAte, PISO_ENTRADA_MS, responderNoPiso, type Relogio } from "../admin/tempo-minimo.ts";

// F3-C1: A1/A9/A13 (next.config do projeto admin + nenhuma server action na central), A3 (tempo mínimo), A4 (fator), A5 (Turnstile só na entrada), A10 (cookie próprio).

const SITE = {
  distDir: ".next",
  images: { remotePatterns: [{ protocol: "https", hostname: "www.camara.leg.br" }, { protocol: "http", hostname: "www.senado.leg.br" }] },
};

test("next.config, build do SITE: sem ADMIN_CENTRAL (ou com valor que não é 1/producao) devolve EXATAMENTE o objeto do ponto de partida da fase (5148ddd: distDir e images)", () => {
  for (const env of [{}, { ADMIN_CENTRAL: "" }, { ADMIN_CENTRAL: "PRODUCAO" }, { ADMIN_CENTRAL: "0" }, { VERCEL_ENV: "production" }, { ADMIN_DATABASE_URL: "x" }]) {
    const { headers, ...resto } = configuracao(env);
    assert.deepEqual(resto, SITE, JSON.stringify(env));
    assert.equal(typeof headers, "function", "D359: único acréscimo ao site, o noindex dos hosts *.vercel.app");
  }
  for (const k of ["rewrites", "pageExtensions", "experimental", "skipTrailingSlashRedirect"] as const) assert.equal(configuracao({})[k], undefined, k);
  assert.equal(configuracao({ NEXT_DIST_DIR: ".next-x" }).distDir, ".next-x");
});

test("next.config, build da CENTRAL (ADMIN_CENTRAL=1 ou producao): pageExtensions só `admin.*`; acrescenta SÓ pageExtensions, headers e skipTrailingSlashRedirect; sem rewrite e sem remendo de caixa", async () => {
  assert.deepEqual([...EXTENSOES_DA_CENTRAL], ["admin.tsx", "admin.ts"]);
  for (const modo of ["1", "producao"]) {
    const adm = configuracao({ ADMIN_CENTRAL: modo });
    const { pageExtensions, headers, skipTrailingSlashRedirect, ...resto } = adm;
    assert.deepEqual(pageExtensions, ["admin.tsx", "admin.ts"], modo);
    assert.equal(skipTrailingSlashRedirect, true, "o 308 de barra final sai antes dos cabeçalhos: na central a barra passa pelo middleware");
    assert.deepEqual(resto, SITE, modo);
    const h = await headers!();
    assert.equal(h.length, 1);
    assert.equal(h[0].source, "/:path*");
    assert.deepEqual(Object.fromEntries(h[0].headers.map((x) => [x.key, x.value])), { "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Content-Security-Policy": "frame-ancestors 'none'" }, modo);
  }
  assert.equal(CSP_MINIMA, "frame-ancestors 'none'");
  assert.equal(configuracao({ ADMIN_CENTRAL: "1", NEXT_DIST_DIR: ".next-admin-prod" }).distDir, ".next-admin-prod");
  // nenhuma extensão da central é aceita pelas extensões padrão do site (tsx, ts, jsx, js): `page.admin.tsx` não é página do site
  const padrao = ["tsx", "ts", "jsx", "js"];
  for (const ext of EXTENSOES_DA_CENTRAL) for (const arq of ["page", "route", "layout", "not-found", "middleware"]) assert.ok(!padrao.some((p) => `${arq}.${ext}` === `${arq}.${p}`), `${arq}.${ext}`);
  for (const arq of ["page.admin.tsx", "route.admin.ts", "layout.admin.tsx", "not-found.admin.tsx", "middleware.admin.ts"]) {
    assert.ok(!new RegExp(`^(?:page|route|layout|not-found|middleware)\\.(?:${padrao.join("|")})$`).test(arq), `${arq} entraria no build do site`);
    assert.ok(new RegExp(`^(?:page|route|layout|not-found|middleware)\\.(?:${EXTENSOES_DA_CENTRAL.join("|")})$`).test(arq), `${arq} não entra no build da central`);
  }
});

test("middleware, build da central: só /admin, /admin/* (sensível à caixa), /_next/static/* e as 28 malhas passam; o resto é 404 com cabeçalhos, em qualquer modo", async () => {
  const { ehEstaticoDaCentral, CODIGOS_UF_DA_MALHA, SVG_DE_PUBLIC } = await import("../admin/guarda-regra.ts");
  assert.deepEqual([...CODIGOS_UF_DA_MALHA], readdirSync(new URL("../../../public/geo/uf", import.meta.url)).map((f) => f.replace(".json", "")).sort(), "a lista de UFs é a pasta public/geo/uf");
  for (const p of ["/_next/static/chunks/a.js", "/_next/static/css/b.css", "/geo/br.json", "/geo/uf/35.json", "/geo/uf/11.json", ...SVG_DE_PUBLIC, "/favicon.ico", "/_next/static/chunks/app/(admin)/admin/ficha/%5Bclasse%5D/%5Bchave%5D/page.admin-8047949e9aa51f57.js"]) assert.equal(ehEstaticoDaCentral(p), true, p);
  // tudo o que existe em public/ é servido (malhas e SVG) e nada mais: a lista é a pasta
  const emPublic = readdirSync(new URL("../../../public", import.meta.url), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `/${(e.parentPath + "/" + e.name).split("/public/")[1]}`).sort();
  assert.deepEqual(emPublic, ["/geo/br.json", ...CODIGOS_UF_DA_MALHA.map((c) => `/geo/uf/${c}.json`), ...SVG_DE_PUBLIC].sort(), "public/ == o que a central serve");
  for (const p of emPublic) assert.equal(ehEstaticoDaCentral(p), true, p);
  for (const p of ["/", "/admin", "/_next/image", "/_next/data/x/y.json", "/_next/static", "/_next/x", "/_NEXT/STATIC/x", "/_next/static/../../etc", "/_next/static/%2e%2e/a", "/_next/static/%2F/x", "/_next/static/%5Cx", "/_next/static/%5B%2e%2e/x", "/_next/static//x", "/geo/uf/99.json", "/geo/uf/35.json/x", "/GEO/br.json", "/geo/br.json/", "/geo/", "/FILE.svg", "/file.svg/x", "/FAVICON.ICO", "/favicon.ico/x", "/icon", "/robots.txt", "/administrador", "/admin-x", "/adminx/y", "/geo/uf/35.json.x", "/geo/br.json/x", "/geo/uf/", "/favicon.icox", "/_nextx/a", "/conta", "/v2/x", "/public/robots.txt"]) assert.equal(ehEstaticoDaCentral(p), false, p);
  const salvo = { ...process.env };
  const H = "admin.segueovoto.com.br";
  const pede = (path: string, extra: Record<string, string> = {}, metodo = "GET") => middleware(new NextRequest(`http://${H}${path}`, { method: metodo, headers: { host: H, ...extra } }));
  Object.assign(process.env, { ADMIN_CENTRAL: "producao", VERCEL_ENV: "production", AUTH_PROVIDER: "pg", SESSION_SECRET: "s".repeat(48), ADMIN_DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/d?sslmode=require" });
  try {
    for (const p of ["/", "/entrar", "/pessoas", "/api/me", "/ADMIN", "/aDmin/fila", "/_NEXT/STATIC/x", "//admin", "/admin%2Ffila", "/%61dmin", "/_next/image", "/_next/data/x/y.json", "/icon", "/opengraph-image", "/p/x/opengraph-image", "/manifest.webmanifest", "/robots.txt", "/sitemap.xml", "/geo/uf/99.json", "/administrador", "/admin-x", "/adminx/y", "/geo/uf/35.json.x", "/geo/br.json/x", "/geo/uf/", "/favicon.icox", "/_nextx/a", "/conta", "/v2/x", "/FILE.svg"]) {
      const r = await pede(p);
      assert.equal(r.status, 404, p);
      assert.equal(r.headers.get("x-frame-options"), "DENY", p);
      assert.equal(await r.text(), "", `${p}: corpo`);
    }
    // estático: passa SEM sessão (a entrada carrega os chunks antes de ter sessão), com cabeçalhos; com Next-Action ou POST de formulário, 404
    for (const p of ["/_next/static/chunks/a.js", "/_next/static/chunks/app/(admin)/admin/uf/%5Buf%5D/page.admin-b.js", "/geo/br.json", "/geo/uf/35.json", "/file.svg", "/favicon.ico"]) {
      const r = await pede(p);
      assert.equal(r.headers.get("x-middleware-next"), "1", p);
      assert.equal(r.headers.get("x-frame-options"), "DENY", p);
      assert.equal((await pede(p, { "next-action": "x" }, "POST")).status, 404, `action ${p}`);
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in salvo)) delete process.env[k];
    Object.assign(process.env, salvo);
  }
  // central fechada: nem os estáticos
  const fechada = await pede("/_next/static/chunks/a.js");
  assert.equal(fechada.status, 404);
  assert.equal(fechada.headers.get("x-frame-options"), "DENY");
});

test("CSP: Turnstile só nas páginas de entrada, em produção; demais páginas da central, API e modo local sem o host", () => {
  const com = politicaCsp({ modo: "producao", nonce: "n", paginaDeEntrada: true });
  assert.match(com, /script-src [^;]*challenges\.cloudflare\.com/);
  assert.match(com, /connect-src 'self' challenges\.cloudflare\.com/);
  assert.match(com, /frame-src challenges\.cloudflare\.com/);
  for (const e of [{ modo: "producao" as const }, { modo: "producao" as const, paginaDeEntrada: false }, { modo: "local" as const, paginaDeEntrada: true }, { modo: null, paginaDeEntrada: true }]) {
    const csp = politicaCsp({ ...e, nonce: "n" });
    assert.ok(!csp.includes("cloudflare"), JSON.stringify(e));
    assert.ok(csp.includes("frame-src 'none'") && csp.includes("connect-src 'self';"), JSON.stringify(e));
  }
  assert.ok(cabecalhosDeSeguranca({ modo: "producao", nonce: "n", paginaDeEntrada: true })["Content-Security-Policy"].includes("cloudflare"));
  assert.ok(!cabecalhosDeSeguranca({ modo: "producao", nonce: "n" })["Content-Security-Policy"].includes("cloudflare"));
  assert.equal(ehPaginaDeEntrada("/admin/entrar"), true);
  assert.equal(ehPaginaDeEntrada("/admin/entrar/fator"), true);
  for (const p of ["/admin", "/admin/fila", "/admin/api/entrar/codigo", "/admin/entrarx"]) assert.equal(ehPaginaDeEntrada(p), false, p);
});

test("middleware: CSP com Turnstile só em /admin/entrar e /admin/entrar/fator (resposta real do middleware)", async () => {
  const salvo = { ...process.env };
  Object.assign(process.env, { ADMIN_CENTRAL: "producao", VERCEL_ENV: "production", AUTH_PROVIDER: "pg", SESSION_SECRET: "s".repeat(48), ADMIN_DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/d?sslmode=require" });
  const H = "admin.segueovoto.com.br";
  const pede = (path: string, extra: Record<string, string> = {}, metodo = "GET") => middleware(new NextRequest(`http://${H}${path}`, { method: metodo, headers: { host: H, ...extra } }));
  try {
    assert.match((await pede("/admin/entrar")).headers.get("content-security-policy")!, /challenges\.cloudflare\.com/);
    // as demais respostas da central (404 sem sessão, inclusive de uma página de dados e de API) não citam o Turnstile
    for (const p of ["/admin", "/admin/fila", "/admin/api/estado", "/admin/entrar/fator"]) {
      const r = await pede(p);
      assert.equal(r.status, 404, p);
      const csp = r.headers.get("content-security-policy")!;
      // /admin/entrar/fator é página de entrada: leva o host mesmo no 404 (o middleware decide pelo caminho, não pelo resultado)
      assert.equal(csp.includes("cloudflare"), p === "/admin/entrar/fator", p);
    }
    // nenhuma server action na central: Next-Action (qualquer caminho, qualquer método) e POST de formulário = 404, antes até da sessão, com os cabeçalhos
    for (const p of ["/admin", "/admin/fila", "/admin/entrar", "/admin/api/entrar/codigo"]) {
      for (const [m, cab] of [["POST", { "next-action": "60416afe3fe7" }], ["GET", { "next-action": "x" }], ["POST", { "next-action": "x", "content-type": "text/plain;charset=UTF-8" }], ["POST", { "content-type": "multipart/form-data; boundary=x" }], ["POST", { "content-type": "application/x-www-form-urlencoded" }]] as const) {
        const r = await pede(p, { ...cab }, m);
        assert.equal(r.status, 404, `${m} ${p} ${JSON.stringify(cab)}`);
        assert.equal(r.headers.get("x-frame-options"), "DENY");
      }
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in salvo)) delete process.env[k];
    Object.assign(process.env, salvo);
  }
});

test("entrada sem sessão: só a página (qualquer método) e as APIs de pedir e verificar código (só POST); fator e o resto exigem sessão", () => {
  assert.equal(ehEntradaSemSessao("/admin/entrar"), true);
  assert.equal(ehEntradaSemSessao("/admin/entrar", "POST"), true);
  for (const p of ["/admin/api/entrar/codigo", "/admin/api/entrar/verificar"]) {
    assert.equal(ehEntradaSemSessao(p, "POST"), true, p);
    for (const m of ["GET", "PUT", "DELETE", "HEAD", "OPTIONS"]) assert.equal(ehEntradaSemSessao(p, m), false, `${m} ${p}`);
  }
  for (const p of ["/admin/api/entrar/fator/iniciar", "/admin/api/entrar/fator/confirmar", "/admin/entrar/fator", "/admin/api/entrar", "/admin/api/pedidos"]) assert.equal(ehEntradaSemSessao(p, "POST"), false, p);
});

test("cookie de sessão da central (D335): nome próprio com prefixo __Secure-, o mesmo no middleware e em login.ts, distinto dos cookies do site", () => {
  assert.equal(NOME_COOKIE_SESSAO, "__Secure-adm-sessao");
  assert.ok(!/^sb-|^__Host-sessao$|^sessao$/.test(NOME_COOKIE_SESSAO));
  const mw = readFileSync(new URL("../../middleware.admin.ts", import.meta.url), "utf8");
  const login = readFileSync(new URL("../admin/login.ts", import.meta.url), "utf8");
  assert.match(mw, /import \{[^}]*\bNOME_COOKIE_SESSAO\b[^}]*\} from "\.\/lib\/admin\/cabecalhos\.ts"/);
  assert.match(mw, /lerSessao\(process\.env, req\.cookies\.get\(NOME_COOKIE_SESSAO\)\?\.value, Date\.now\(\)\)/);
  assert.match(login, /import \{[^}]*\bNOME_COOKIE_SESSAO\b[^}]*\} from "\.\/cabecalhos\.ts"/);
  // toda gravação do cookie de sessão passa pelas opções da central (host-only, Strict, Secure, HttpOnly, path /admin)
  const gravacoes = [...login.matchAll(/\.set\(NOME_COOKIE_SESSAO,[^\n]*/g)].map((m) => m[0]);
  assert.equal(gravacoes.length, 2, "gravarSessao e sair (0158), e nenhuma outra");
  assert.match(gravacoes[0], /opcoesDeCookieDaCentral\(\{ maxAge: maxAgeS \}\)/);
  assert.match(gravacoes[1], /NOME_COOKIE_SESSAO, "", opcoesDeCookieDaCentral\(\{ maxAge: 0 \}\)\)/, "sair apaga com as mesmas opções (host-only, Strict, Secure, path /admin)");
  // o site público não importa o nome da central, e a central não importa o provedor do site
  for (const f of ["../auth/supabase.ts", "../auth/pg.ts", "../auth/pg-core.ts"]) assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes(NOME_COOKIE_SESSAO), f);
  assert.ok(!/lib\/auth|@supabase/.test(login) && !/lib\/auth|@supabase/.test(mw));
});

/** Relógio virtual: `dormir` avança o tempo na hora, sem esperar de verdade. */
function relogioVirtual(): Relogio & { t: number } {
  const r = { t: 0, agora: () => r.t, dormir: async (ms: number) => { r.t += ms; } };
  return r;
}

test("tempo mínimo: o mesmo piso para trabalho rápido, médio e lento-mas-menor-que-o-piso; só passa do piso quando o trabalho passa", async () => {
  for (const custo of [0, 5, 400, 1499]) {
    const r = relogioVirtual();
    const v = await completarAte(PISO_ENTRADA_MS, async () => { r.t += custo; return "ok"; }, r);
    assert.equal(v, "ok");
    assert.equal(r.t, PISO_ENTRADA_MS, `custo ${custo}`);
  }
  const lento = relogioVirtual();
  await completarAte(PISO_ENTRADA_MS, async () => { lento.t += 2500; }, lento);
  assert.equal(lento.t, 2500, "trabalho acima do piso não ganha espera extra");
  const falha = relogioVirtual();
  await assert.rejects(completarAte(PISO_ENTRADA_MS, async () => { falha.t += 10; throw new Error("x"); }, falha), /x/);
  assert.equal(falha.t, PISO_ENTRADA_MS, "falha também espera o piso");
});

test("tempo mínimo: responderNoPiso responde sempre no piso, com o trabalho feito ou não, e entrega o trabalho em `pendente` (nunca rejeita)", async () => {
  // admin (trabalho com ida ao provedor) e não admin (sem trabalho) levam o MESMO tempo, e o trabalho lento não atrasa a resposta
  const tempos: number[] = [];
  for (const trabalho of [async () => undefined, async () => { throw new Error("provedor"); }]) {
    const r = relogioVirtual();
    const { pendente } = await responderNoPiso(PISO_ENTRADA_MS, trabalho, r);
    await pendente;
    tempos.push(r.t);
  }
  assert.deepEqual(tempos, [PISO_ENTRADA_MS, PISO_ENTRADA_MS]);
  let terminou = false;
  const r = relogioVirtual();
  const { pendente } = await responderNoPiso(PISO_ENTRADA_MS, () => new Promise<void>((ok) => setTimeout(() => { terminou = true; ok(); }, 20)), r);
  assert.equal(r.t, PISO_ENTRADA_MS);
  assert.equal(terminou, false, "a resposta não esperou o provedor");
  await pendente;
  assert.equal(terminou, true);
});

test("fator (A4, D335): nada do corpo escolhe o fator; ele é sempre o do e-mail da sessão", () => {
  const src = readFileSync(new URL("../admin/entrada.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/fatorId|corpo\.email\b[\s\S]*confirmarFator\(/.test(src.slice(src.indexOf("export async function iniciarCadastroFator"))), "as rotas de fator não leem identificador do corpo");
  assert.match(src, /loginDaCentral\(\)\.iniciarCadastro\(s\.email\)/);
  assert.match(src, /loginDaCentral\(\)\.confirmarFator\(s\.email, codigo\)/);
  assert.match(src, /await gravarSessao\(s\.email, 2\);/);
  // o nível 2 só é gravado em UM lugar, depois de o fator conferir; o nível 1, só depois de o código de e-mail conferir
  assert.equal([...src.matchAll(/gravarSessao\([^)]*, 2\)/g)].length, 1);
  assert.equal([...src.matchAll(/gravarSessao\([^)]*, 1\)/g)].length, 1);
  assert.equal([...src.matchAll(/gravarSessao\(/g)].length, 2);
  const form = readFileSync(new URL("../../components/admin-entrada/formularios.tsx", import.meta.url), "utf8");
  assert.ok(!/fatorId/.test(form));
});

test("D359: o site manda X-Robots-Tag noindex só para hosts *.vercel.app, e nenhum outro cabeçalho", async () => {
  const regras = await configuracao({}).headers!();
  assert.equal(regras.length, 1);
  assert.deepEqual(regras[0].headers, [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
  const host = new RegExp(`^${(regras[0].has as { value: string }[])[0].value}$`);
  assert.ok(host.test("replica-virid-sigma.vercel.app") && host.test("replica-git-x-sementedev.vercel.app"));
  assert.ok(!host.test("www.segueovoto.com.br") && !host.test("admin.segueovoto.com.br") && !host.test("vercel.app.evil.com"));
});
