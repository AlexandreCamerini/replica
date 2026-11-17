import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { middleware } from "../../middleware.ts";
import { cabecalhosDeSeguranca, CABECALHO_NONCE, HASH_SCRIPT_TEMA, MARCA_ENTRADA, opcoesDeCookieDaCentral, politicaCsp } from "../admin/cabecalhos.ts";

// F3-T2 (AC-23): cabeçalhos de segurança só nas rotas da central, em toda resposta; CSP; opções de cookie; middleware com NextRequest fabricado (sem Supabase, sem rede).

const LOCAL = "postgres://admin_central@localhost:5432/civico";
const NA_CENTRAL = ["content-security-policy", "x-frame-options", "referrer-policy"];

/** Roda `fn` com o ambiente trocado (o middleware lê process.env a cada requisição) e restaura depois. */
async function comEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  const chaves = ["ADMIN_CENTRAL", "ADMIN_DATABASE_URL", "VERCEL", "VERCEL_ENV", "AUTH_PROVIDER", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  for (const k of chaves) antes[k] = process.env[k];
  for (const k of chaves) delete process.env[k];
  Object.assign(process.env, Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)));
  try {
    return await fn();
  } finally {
    for (const k of chaves) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}
const pedido = (path: string, host: string, extra: Record<string, string> = {}, metodo = "GET") => new NextRequest(`http://${host}${path}`, { method: metodo, headers: { host, ...extra } });

test("política CSP: as quatro diretivas obrigatórias e default-src 'self', sem 'unsafe-inline' nem 'unsafe-eval' em script", () => {
  for (const modo of ["local", "producao", null] as const) {
    const csp = politicaCsp({ modo, nonce: "abc" });
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"]) assert.ok(csp.split("; ").includes(d), `${modo}: falta ${d}`);
    const script = csp.split("; ").find((x) => x.startsWith("script-src "))!;
    assert.ok(script.includes("'nonce-abc'") && script.includes("'self'"), script);
    assert.ok(!script.includes("unsafe-inline") && !script.includes("unsafe-eval") && !script.includes("strict-dynamic"), script);
    assert.ok(!/\*|data:|blob:/.test(script), script);
  }
});

test("política CSP: Turnstile (e só ele) liberado em produção; nada externo no modo local; Supabase nunca (o navegador não fala com ele)", () => {
  const local = politicaCsp({ modo: "local", nonce: "n" });
  // F3-C1 (A5): o Turnstile só vale nas páginas de entrada; este teste passou a pedir `paginaDeEntrada: true` (antes o host entrava em toda página da central em produção)
  const prod = politicaCsp({ modo: "producao", nonce: "n", paginaDeEntrada: true });
  assert.ok(!local.includes("cloudflare") && local.includes("frame-src 'none'"));
  assert.ok(prod.includes("script-src") && /script-src [^;]*challenges\.cloudflare\.com/.test(prod));
  assert.ok(/frame-src challenges\.cloudflare\.com(;|$)/.test(prod) && /connect-src 'self' challenges\.cloudflare\.com/.test(prod));
  for (const csp of [local, prod]) assert.ok(!/supabase/i.test(csp), "o Supabase só é chamado pelo servidor");
  assert.ok(prod.includes("img-src 'self' data:"), "o QR do fator é um data URI");
  assert.ok(politicaCsp({ modo: "local", nonce: "n", desenvolvimento: true }).includes("'unsafe-eval'"));
  assert.ok(!politicaCsp({ modo: "producao", nonce: "n", desenvolvimento: false }).includes("'unsafe-eval'"));
});

test("hash do tema: HASH_SCRIPT_TEMA é o sha256 do themeScript real de src/app/layout.tsx (se o layout mudar, este teste avisa)", () => {
  const fonte = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  const m = fonte.match(/const themeScript = `([^`]*)`;/);
  assert.ok(m, "themeScript não encontrado em app/layout.tsx");
  assert.equal(`sha256-${createHash("sha256").update(m![1], "utf8").digest("base64")}`, HASH_SCRIPT_TEMA);
});

test("cabeçalhos de segurança: os três, com os valores exatos", () => {
  const h = cabecalhosDeSeguranca({ modo: "local", nonce: "n" });
  assert.deepEqual(Object.keys(h).sort(), ["Content-Security-Policy", "Referrer-Policy", "X-Frame-Options"]);
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["Referrer-Policy"], "same-origin");
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("cookies da central: host-only, Strict, Secure, HttpOnly, path /admin; domain nunca; só a validade passa", () => {
  const o = opcoesDeCookieDaCentral({ domain: ".segueovoto.com.br", sameSite: "lax", secure: false, httpOnly: false, path: "/", maxAge: 400 });
  assert.deepEqual(o, { path: "/admin", httpOnly: true, secure: true, sameSite: "strict", maxAge: 400 });
  assert.ok(!("domain" in o));
  assert.deepEqual(opcoesDeCookieDaCentral(), { path: "/admin", httpOnly: true, secure: true, sameSite: "strict" });
});

test("middleware: central FECHADA responde 404 sem corpo e COM os cabeçalhos de segurança", async () => {
  await comEnv({}, async () => {
    for (const [path, metodo] of [["/admin", "GET"], ["/admin/fila", "GET"], ["/admin/api/pedidos", "POST"], ["/admin/entrar", "GET"]] as const) {
      const r = await middleware(pedido(path, "localhost:3000", {}, metodo));
      assert.equal(r.status, 404, path);
      for (const h of NA_CENTRAL) assert.ok(r.headers.get(h), `${path}: falta ${h}`);
      assert.match(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
      assert.equal(r.headers.get("x-frame-options"), "DENY");
      assert.equal(r.headers.get("referrer-policy"), "same-origin");
    }
  });
});

test("middleware: modo local LIBERADO passa e põe os cabeçalhos; Host que não é local = 404 com cabeçalhos", async () => {
  await comEnv({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: LOCAL }, async () => {
    const ok = await middleware(pedido("/admin/fila", "localhost:3000"));
    assert.notEqual(ok.status, 404);
    assert.equal(ok.headers.get("x-middleware-next"), "1");
    for (const h of NA_CENTRAL) assert.ok(ok.headers.get(h), `falta ${h}`);
    const csp = ok.headers.get("content-security-policy")!;
    assert.match(csp, /frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'$/);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    assert.ok(nonce.length >= 16);
    // o nonce e a CSP seguem como cabeçalhos da REQUISIÇÃO (é de lá que o Next tira o nonce dos scripts dele)
    const reenviados = ok.headers.get("x-middleware-override-headers") ?? "";
    assert.ok(reenviados.split(",").includes("content-security-policy") && reenviados.split(",").includes(CABECALHO_NONCE));
    assert.equal(ok.headers.get(`x-middleware-request-${CABECALHO_NONCE}`), nonce);
    // cada requisição, um nonce novo
    const outro = await middleware(pedido("/admin/fila", "localhost:3000"));
    assert.notEqual(/'nonce-([^']+)'/.exec(outro.headers.get("content-security-policy")!)![1], nonce);
    // Host errado
    for (const host of ["evil.example.com", "admin.segueovoto.com.br"]) {
      const r = await middleware(pedido("/admin/fila", host));
      assert.equal(r.status, 404, host);
      for (const h of NA_CENTRAL) assert.ok(r.headers.get(h), `${host}: falta ${h}`);
    }
  });
});

test("middleware: a marca de entrada que o cliente manda é APAGADA (só o middleware a põe) e não existe no modo local", async () => {
  await comEnv({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: LOCAL }, async () => {
    for (const path of ["/admin/fila", "/admin/entrar", "/admin/entrar/fator"]) {
      const r = await middleware(pedido(path, "localhost:3000", { [MARCA_ENTRADA]: "1", [CABECALHO_NONCE]: "falso" }));
      assert.equal(r.status, 200, path);
      const reenviados = (r.headers.get("x-middleware-override-headers") ?? "").split(",");
      assert.ok(!reenviados.includes(MARCA_ENTRADA), `${path}: a marca do cliente passou`);
      assert.notEqual(r.headers.get(`x-middleware-request-${CABECALHO_NONCE}`), "falso", "o nonce do cliente passou");
    }
  });
});

test("middleware: modo produção sem Supabase configurado fecha (404 com cabeçalhos); Host certo é exigido antes de qualquer coisa", async () => {
  const prod = { ADMIN_CENTRAL: "producao", VERCEL_ENV: "production", AUTH_PROVIDER: "supabase", ADMIN_DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/d?sslmode=require" };
  await comEnv(prod, async () => {
    const semSupabase = await middleware(pedido("/admin/entrar", "admin.segueovoto.com.br"));
    assert.equal(semSupabase.status, 404);
    assert.match(semSupabase.headers.get("content-security-policy")!, /challenges\.cloudflare\.com/);
    for (const host of ["localhost:3000", "replica.vercel.app", "admin.segueovoto.com.br:3000", "www.segueovoto.com.br"]) {
      const r = await middleware(pedido("/admin/entrar", host));
      assert.equal(r.status, 404, host);
      assert.equal(r.headers.get("x-frame-options"), "DENY");
    }
  });
  // produção com Preview (VERCEL_ENV=preview): fechada
  await comEnv({ ...prod, VERCEL_ENV: "preview" }, async () => {
    assert.equal((await middleware(pedido("/admin/entrar", "admin.segueovoto.com.br"))).status, 404);
  });
});

test("middleware, produção, SEM sessão (sem cookie: o Supabase nem sai para a rede): só /admin/entrar responde, com a marca; todo o resto é 404; a marca do cliente nunca vale", async () => {
  const prod = {
    ADMIN_CENTRAL: "producao",
    VERCEL_ENV: "production",
    AUTH_PROVIDER: "supabase",
    ADMIN_DATABASE_URL: "postgres://u:p@db.exemplo.com:5432/d?sslmode=require",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-falsa",
  };
  await comEnv(prod, async () => {
    const entrar = await middleware(pedido("/admin/entrar", "admin.segueovoto.com.br"));
    assert.equal(entrar.status, 200);
    assert.equal(entrar.headers.get(`x-middleware-request-${MARCA_ENTRADA}`), "1", "a página de entrada recebe a marca");
    for (const h of NA_CENTRAL) assert.ok(entrar.headers.get(h), `falta ${h}`);
    assert.match(entrar.headers.get("content-security-policy")!, /script-src [^;]*challenges\.cloudflare\.com/);
    for (const path of ["/admin", "/admin/fila", "/admin/entrar/fator", "/admin/entrar/outra", "/admin/entrar/", "/admin/api/estado", "/admin/api/pedidos"]) {
      const r = await middleware(pedido(path, "admin.segueovoto.com.br", { [MARCA_ENTRADA]: "1" }, path.endsWith("pedidos") ? "POST" : "GET"));
      assert.equal(r.status, 404, path);
      assert.equal(r.headers.get("x-frame-options"), "DENY", path);
    }
  });
});

test("o middleware só cobre /admin e roda em Node; nada do site público importa dele nem ele do site público", async () => {
  const { config } = await import("../../middleware.ts");
  assert.deepEqual(config.matcher, ["/admin", "/admin/:path*"]);
  assert.equal(config.runtime, "nodejs");
  const fonte = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
  for (const m of fonte.matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(["@supabase/ssr", "next/server.js"].includes(m[1]) || /^\.\/lib\/admin\/(guarda-regra|cabecalhos|prazo)\.ts$/.test(m[1]), `middleware importa ${m[1]}`);
});

test("comPrazo: promessa que não termina falha no prazo; a que termina antes passa", async () => {
  const { comPrazo } = await import("../admin/prazo.ts");
  const inicio = Date.now();
  await assert.rejects(comPrazo(new Promise(() => {}), 50), /prazo/);
  assert.ok(Date.now() - inicio < 1000);
  assert.equal(await comPrazo(Promise.resolve(7), 50), 7);
});
