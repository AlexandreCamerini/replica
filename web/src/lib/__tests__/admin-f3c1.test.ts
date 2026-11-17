import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { configuracao, CSP_MINIMA, DESTINO_404, FORA_DA_CENTRAL } from "../../../next.config.ts";
import { middleware } from "../../middleware.ts";
import { cabecalhosDeSeguranca, ehEntradaSemSessao, ehPaginaDeEntrada, NOME_COOKIE_SESSAO, OPCOES_SSR_DA_CENTRAL, politicaCsp } from "../admin/cabecalhos.ts";
import { escolherFator } from "../admin/escolha-fator.ts";
import { completarAte, PISO_ENTRADA_MS, responderNoPiso, type Relogio } from "../admin/tempo-minimo.ts";

// F3-C1: A1/A9/A13 (next.config do projeto admin + nenhuma server action na central), A3 (tempo mínimo), A4 (fator), A5 (Turnstile só na entrada), A10 (cookie próprio).

const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp/index.js") as { pathToRegexp: (s: string) => RegExp };

test("next.config: sem ADMIN_CENTRAL=producao devolve exatamente o objeto de sempre (site, dev, CI, central local)", () => {
  const esperado = {
    distDir: ".next",
    images: { remotePatterns: [{ protocol: "https", hostname: "www.camara.leg.br" }, { protocol: "http", hostname: "www.senado.leg.br" }] },
  };
  for (const env of [{}, { ADMIN_CENTRAL: "1" }, { ADMIN_CENTRAL: "" }, { ADMIN_CENTRAL: "PRODUCAO" }, { VERCEL_ENV: "production" }, { ADMIN_DATABASE_URL: "x" }]) assert.deepEqual(configuracao(env), esperado, JSON.stringify(env));
  assert.equal(configuracao({}).rewrites, undefined);
  assert.equal(configuracao({}).headers, undefined);
  assert.equal(configuracao({ NEXT_DIST_DIR: ".next-x" }).distDir, ".next-x");
});

test("next.config: com ADMIN_CENTRAL=producao acrescenta SÓ rewrites, headers e skipTrailingSlashRedirect; o resto é idêntico", async () => {
  const site = configuracao({});
  const adm = configuracao({ ADMIN_CENTRAL: "producao" });
  const { rewrites, headers, skipTrailingSlashRedirect, ...resto } = adm;
  assert.equal(skipTrailingSlashRedirect, true, "o 308 de barra final sai antes dos cabeçalhos: no projeto admin a barra passa pelo middleware");
  assert.deepEqual(resto, site);
  const rw = await rewrites!();
  assert.ok(!Array.isArray(rw));
  assert.deepEqual(rw, { beforeFiles: [{ source: FORA_DA_CENTRAL, destination: DESTINO_404 }], afterFiles: [], fallback: [] });
  const h = await headers!();
  assert.equal(h.length, 1);
  assert.equal(h[0].source, "/:path*");
  const mapa = Object.fromEntries(h[0].headers.map((x) => [x.key, x.value]));
  assert.deepEqual(mapa, { "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Content-Security-Policy": "frame-ancestors 'none'" });
  assert.equal(CSP_MINIMA, "frame-ancestors 'none'");
});

test("rewrite: caminho público de exemplo vai ao 404; /admin, /admin/x, /_next/static, /geo e /favicon.ico ficam", () => {
  const re = pathToRegexp(FORA_DA_CENTRAL);
  const vai = ["/geo/nao-existe.json", "/geo/uf/99.json", "/geo/uf/35.json.x", "/geo/br.json/x", "/geo/uf/", "/", "/entrar", "/conta", "/api/me", "/api/places", "/pessoas", "/p/fulano/opengraph-image", "/votacao/1", "/v2/x", "/administrador", "/admin-x", "/adminx/y", "/geo", "/geo-x/a.json", "/_nextx/a", "/_next/data/x.json", "/_next/image", "/_next/admin-central-fora-do-escopo", "/favicon.icox", "/favicon.ico/x", "/public/robots.txt", "/robots.txt", "/sitemap.xml", "/file.svg"];
  const fica = [...readdirSync(new URL("../../../public/geo/uf", import.meta.url)).map((f) => `/geo/uf/${f}`), "/admin", "/admin/", "/admin/x", "/admin/api/estado", "/admin/entrar", "/_next/static/x", "/_next/static/chunks/a.js", "/geo/br.json", "/favicon.ico"];
  for (const p of vai) assert.ok(re.test(p), `${p} devia ir ao 404`);
  for (const p of fica) assert.ok(!re.test(p), `${p} devia continuar`);
  // o destino fica sob /_next/static (servidor de estáticos: 404 de 9 B, sem renderizar o not-found do site) e nunca casa o próprio rewrite (sem laço)
  assert.ok(DESTINO_404.startsWith("/_next/static/"));
  assert.ok(!re.test(DESTINO_404));
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
  Object.assign(process.env, { ADMIN_CENTRAL: "producao", VERCEL_ENV: "production", AUTH_PROVIDER: "supabase", ADMIN_DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/d?sslmode=require", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" });
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

test("cookie de sessão da central: nome próprio, igual no middleware e no cliente, distinto do cookie do site", () => {
  assert.equal(OPCOES_SSR_DA_CENTRAL.name, NOME_COOKIE_SESSAO);
  assert.match(NOME_COOKIE_SESSAO, /^sb-admin-central-/);
  assert.ok(!/^sb-[a-z0-9]{20}-auth-token$/.test(NOME_COOKIE_SESSAO));
  const mw = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
  const cli = readFileSync(new URL("../admin/cliente-auth.ts", import.meta.url), "utf8");
  for (const [n, src] of [["middleware", mw], ["cliente-auth", cli]] as const) {
    assert.match(src, /createServerClient\(url, anon, \{\s*cookieOptions: OPCOES_SSR_DA_CENTRAL,/, `${n}: createServerClient sem cookieOptions da central`);
    assert.match(src, /import \{[^}]*\bOPCOES_SSR_DA_CENTRAL\b[^}]*\} from "\.\/lib\/admin\/cabecalhos\.ts"|import \{[^}]*\bOPCOES_SSR_DA_CENTRAL\b[^}]*\} from "\.\/cabecalhos\.ts"/, `${n}: não importa do mesmo módulo`);
  }
  // o site público não importa o nome da central
  const site = readFileSync(new URL("../auth/supabase.ts", import.meta.url), "utf8");
  assert.ok(!site.includes("OPCOES_SSR_DA_CENTRAL") && !site.includes(NOME_COOKIE_SESSAO));
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

test("fator (A4): com fator verificado, o fatorId do cliente é ignorado; unverified só no primeiro cadastro", () => {
  const v = { id: "v1", factor_type: "totp", status: "verified" };
  const u = { id: "u1", factor_type: "totp", status: "unverified" };
  const fone = { id: "p1", factor_type: "phone", status: "verified" };
  assert.equal(escolherFator([v, u], "u1")?.id, "v1", "id de unverified com verificado na conta: ignora o pedido");
  assert.equal(escolherFator([u, v], "u1")?.id, "v1");
  assert.equal(escolherFator([v], "")?.id, "v1");
  assert.equal(escolherFator([v], "qualquer")?.id, "v1");
  assert.equal(escolherFator([u], "u1")?.id, "u1", "primeiro cadastro");
  assert.equal(escolherFator([u], "outro"), undefined);
  assert.equal(escolherFator([u], ""), undefined);
  assert.equal(escolherFator([fone, u], "p1"), undefined, "só TOTP");
  assert.equal(escolherFator([], "x"), undefined);
});
