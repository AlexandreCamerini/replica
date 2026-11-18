import assert from "node:assert/strict";
import { test } from "node:test";
import { decidirAcesso, HOST_CENTRAL_PRODUCAO, hostDeRequisicaoPermitido, origemRecusada, type EntradaCsrf } from "../admin/guarda-regra.ts";

// F3-T2 (AC-23): os dois modos da trava, o Host por modo e o CSRF estrito. Tudo puro; nenhum teste toca banco nem rede.

const LOCAL = "postgres://admin_central@localhost:5432/civico";
const REMOTO = "postgres://admin_central:senha@db.exemplo.com:5432/civico?sslmode=require";
const producao = (extra: Record<string, string | undefined> = {}) => ({
  ADMIN_CENTRAL: "producao",
  VERCEL_ENV: "production",
  VERCEL: "1",
  AUTH_PROVIDER: "pg",
  SESSION_SECRET: "s".repeat(48),
  ADMIN_DATABASE_URL: REMOTO,
  ...extra,
});

test("modo local: devolve modo `local` e continua liberando como antes", () => {
  const d = decidirAcesso({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: LOCAL });
  assert.equal(d.liberada, true);
  assert.equal(d.modo, "local");
});

test("fechada: modo nulo, com motivo", () => {
  for (const env of [{}, { ADMIN_CENTRAL: "0" }, { ADMIN_CENTRAL: "Producao" }, { ADMIN_CENTRAL: "production" }, { ADMIN_CENTRAL: "producao " }, { ADMIN_CENTRAL: "true" }]) {
    const d = decidirAcesso({ ...producao(), ...env, ADMIN_CENTRAL: (env as { ADMIN_CENTRAL?: string }).ADMIN_CENTRAL });
    assert.equal(d.liberada, false, JSON.stringify(env));
    assert.equal(d.modo, null);
    assert.ok(d.motivo.length > 0);
  }
});

test("modo produção correto libera, com modo `producao` (VERCEL definida não bloqueia aqui)", () => {
  const d = decidirAcesso(producao());
  assert.equal(d.liberada, true);
  assert.equal(d.modo, "producao");
  for (const m of ["require", "verify-ca", "verify-full"]) assert.equal(decidirAcesso(producao({ ADMIN_DATABASE_URL: `postgres://u:p@db.exemplo.com/d?sslmode=${m}` })).liberada, true, m);
  assert.equal(decidirAcesso(producao({ ADMIN_DATABASE_URL: "postgresql://u:p@[2001:db8::1]:6543/d?application_name=x&sslmode=require" })).liberada, true);
});

test("modo produção fecha: sem VERCEL_ENV=production, com AUTH_PROVIDER diferente de pg, sem SESSION_SECRET de 32+, sem sslmode ou com sslmode fraco", () => {
  for (const v of [undefined, "", "preview", "development", "Production", "production "]) assert.equal(decidirAcesso(producao({ VERCEL_ENV: v })).liberada, false, `VERCEL_ENV=${String(v)}`);
  for (const v of [undefined, "", "dev", "supabase", "PG", "pg "]) assert.equal(decidirAcesso(producao({ AUTH_PROVIDER: v })).liberada, false, `AUTH_PROVIDER=${String(v)}`);
  for (const v of [undefined, "", "curto", "x".repeat(31)]) assert.equal(decidirAcesso(producao({ SESSION_SECRET: v })).liberada, false, `SESSION_SECRET de ${String(v).length}`);
  assert.equal(decidirAcesso(producao({ SESSION_SECRET: "x".repeat(32) })).liberada, true);
  for (const u of [
    undefined,
    "",
    "postgres://u:p@db.exemplo.com/d",
    "postgres://u:p@db.exemplo.com/d?sslmode=disable",
    "postgres://u:p@db.exemplo.com/d?sslmode=prefer",
    "postgres://u:p@db.exemplo.com/d?sslmode=allow",
    "postgres://u:p@db.exemplo.com/d?sslmode=",
    "postgres://u:p@db.exemplo.com/d?sslmode=require&sslmode=disable", // o driver fica com o ÚLTIMO
    "postgres://u:p@db.exemplo.com/d?sslmode=disable&sslmode=require",
    "postgres://u:p@db.exemplo.com/d?ssl=true",
  ])
    assert.equal(decidirAcesso(producao({ ADMIN_DATABASE_URL: u })).liberada, false, String(u));
});

test("modo produção mantém as recusas da URL do banco (#, espaço, controle, vírgula, host na query, protocolo, host vazio)", () => {
  for (const u of [
    "postgres://u@db.exemplo.com#@outro.exemplo.com/d?sslmode=require",
    "postgres://u@db.exemplo.com/d?sslmode=require#x",
    "postgres://u@db.exemplo.com/d?sslmode=require ",
    "postgres://u@db.exemplo.com/d?sslmode=require\n",
    "postgres://u@db.exemplo.com,outro.exemplo.com/d?sslmode=require",
    "postgres://u@db.exemplo.com/d?sslmode=require&host=outro.exemplo.com",
    "postgres://u@db.exemplo.com/d?sslmode=require&hostaddr=10.0.0.5",
    "postgres://u@db.exemplo.com/d?sslmode=require&service=x",
    "postgres://u@db.exemplo.com/d?sslmode=require&HOST=x",
    "https://u@db.exemplo.com/d?sslmode=require",
    "mysql://u@db.exemplo.com/d?sslmode=require",
    "postgres:///d?sslmode=require",
    "postgres://u@/d?sslmode=require",
  ])
    assert.equal(decidirAcesso(producao({ ADMIN_DATABASE_URL: u })).liberada, false, u);
});

test("o modo local não aceita o que é do modo produção, e vice-versa", () => {
  assert.equal(decidirAcesso({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: REMOTO }).liberada, false); // banco remoto no modo local
  assert.equal(decidirAcesso({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: LOCAL, VERCEL: "1", VERCEL_ENV: "production" }).liberada, false);
  assert.equal(decidirAcesso(producao({ ADMIN_DATABASE_URL: `${LOCAL}?sslmode=require` })).liberada, true); // host local com TLS também é URL válida em produção: o que importa é o Host da requisição
});

test("hostDeRequisicaoPermitido: local = o de sempre; produção = exatamente admin.segueovoto.com.br, sem porta ou com 443", () => {
  assert.equal(HOST_CENTRAL_PRODUCAO, "admin.segueovoto.com.br");
  for (const h of ["localhost", "localhost:3000", "127.0.0.1:38713", "[::1]:3000"]) assert.equal(hostDeRequisicaoPermitido(h, "local"), true, h);
  for (const h of ["admin.segueovoto.com.br", "ADMIN.segueovoto.com.br", "admin.segueovoto.com.br:443", " admin.segueovoto.com.br "]) assert.equal(hostDeRequisicaoPermitido(h, "producao"), true, h);
  for (const h of [
    null,
    undefined,
    "",
    "localhost",
    "localhost:3000",
    "admin.segueovoto.com.br:3000",
    "admin.segueovoto.com.br:80",
    "admin.segueovoto.com.br.",
    "admin.segueovoto.com.br.evil.example.com",
    "evil.admin.segueovoto.com.br",
    "www.segueovoto.com.br",
    "segueovoto.com.br",
    "replica-virid-sigma.vercel.app",
    "replica-admin-git-main-x.vercel.app",
    "admin.segueovoto.com.br@evil.example.com",
    "admin.segueovoto.com.br/x",
    "admin.segueovoto.com.br, evil.example.com",
  ])
    assert.equal(hostDeRequisicaoPermitido(h, "producao"), false, String(h));
  for (const h of ["admin.segueovoto.com.br", "admin.segueovoto.com.br:443"]) assert.equal(hostDeRequisicaoPermitido(h, "local"), false, `local não aceita ${h}`);
  assert.equal(hostDeRequisicaoPermitido("localhost", null), false);
  assert.equal(hostDeRequisicaoPermitido("admin.segueovoto.com.br", null), false);
});

// ---------------------------------------------------------------------------------------------------------------------------- CSRF

const certoLocal: EntradaCsrf = { modo: "local", host: "localhost:3000", origin: "http://localhost:3000", secFetchSite: "same-origin", contentType: "application/json" };
const certoProd: EntradaCsrf = { modo: "producao", host: "admin.segueovoto.com.br", origin: ["https:", "", "admin.segueovoto.com.br"].join("/"), secFetchSite: "same-origin", contentType: "application/json; charset=utf-8" };

test("CSRF: a requisição certa passa nos dois modos", () => {
  assert.equal(origemRecusada(certoLocal), false);
  assert.equal(origemRecusada(certoProd), false);
  assert.equal(origemRecusada({ ...certoLocal, host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080" }), false);
});

test("CSRF: sem Origin, sem Sec-Fetch-Site, cross-site, same-site, none, Origin com outra porta, outro host ou outro esquema, sem JSON: recusa (403)", () => {
  for (const modo of [certoLocal, certoProd]) {
    assert.equal(origemRecusada({ ...modo, origin: null }), true, "sem Origin");
    assert.equal(origemRecusada({ ...modo, secFetchSite: null }), true, "sem Sec-Fetch-Site");
    for (const v of ["cross-site", "same-site", "none", "", "SAME-ORIGIN-ish"]) assert.equal(origemRecusada({ ...modo, secFetchSite: v }), true, `Sec-Fetch-Site=${v}`);
    assert.equal(origemRecusada({ ...modo, origin: "null" }), true, "Origin: null");
    assert.equal(origemRecusada({ ...modo, origin: "não é url" }), true);
    assert.equal(origemRecusada({ ...modo, origin: `${modo.origin}/x` }), true, "Origin com caminho");
    assert.equal(origemRecusada({ ...modo, contentType: "text/plain" }), true);
    assert.equal(origemRecusada({ ...modo, contentType: "multipart/form-data; boundary=x" }), true);
    assert.equal(origemRecusada({ ...modo, contentType: null }), true);
  }
  assert.equal(origemRecusada({ ...certoLocal, origin: "http://localhost:3001" }), true, "outra porta");
  assert.equal(origemRecusada({ ...certoLocal, origin: "http://localhost" }), true, "sem porta, Host com porta");
  assert.equal(origemRecusada({ ...certoLocal, origin: "http://evil.example.com:3000" }), true);
  assert.equal(origemRecusada({ ...certoLocal, origin: "https://localhost:3000" }), true, "outro esquema");
  assert.equal(origemRecusada({ ...certoLocal, host: "evil.example.com", origin: "http://evil.example.com" }), true, "Host que não é local");
  assert.equal(origemRecusada({ ...certoProd, origin: ["http:", "", "admin.segueovoto.com.br"].join("/") }), true, "produção só aceita https");
  assert.equal(origemRecusada({ ...certoProd, origin: ["https:", "", "admin.segueovoto.com.br:8443"].join("/") }), true, "outra porta em produção");
  assert.equal(origemRecusada({ ...certoProd, origin: ["https:", "", "www.segueovoto.com.br"].join("/") }), true, "o site www é outra origem");
  assert.equal(origemRecusada({ ...certoProd, origin: ["https:", "", "replica.vercel.app"].join("/") }), true);
  assert.equal(origemRecusada({ ...certoProd, host: "replica.vercel.app", origin: ["https:", "", "replica.vercel.app"].join("/") }), true, "alias vercel.app");
  assert.equal(origemRecusada({ ...certoProd, modo: null }), true, "central fechada");
});

test("CSRF: a action de página (sem exigir JSON) mantém Origin e Sec-Fetch-Site; só o content-type deixa de valer", () => {
  assert.equal(origemRecusada({ ...certoProd, contentType: "multipart/form-data; boundary=x", exigirJson: false }), false);
  assert.equal(origemRecusada({ ...certoProd, contentType: null, exigirJson: false }), false);
  assert.equal(origemRecusada({ ...certoProd, origin: null, exigirJson: false }), true);
  assert.equal(origemRecusada({ ...certoProd, secFetchSite: "same-site", exigirJson: false }), true);
});
