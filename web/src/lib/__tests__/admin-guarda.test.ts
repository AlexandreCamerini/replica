import assert from "node:assert/strict";
import { test } from "node:test";
import { decidirAcesso, hostDeRequisicaoLocal } from "../admin/guarda-regra.ts";

const LOCAL = "postgres://admin_central@localhost:5432/civico";
const ligada = (extra: Record<string, string | undefined> = {}) => ({ ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: LOCAL, ...extra });

test("ligada com URL local libera", () => {
  assert.equal(decidirAcesso(ligada()).liberada, true);
  assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: "postgres://u:p@127.0.0.1:5432/d" })).liberada, true);
  assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: "postgres://u:p@[::1]:5432/d" })).liberada, true);
});

test("sem ADMIN_CENTRAL, ou com valor diferente de 1, bloqueia (404)", () => {
  assert.equal(decidirAcesso({ ADMIN_DATABASE_URL: LOCAL }).liberada, false);
  for (const v of ["true", "yes", "0", "", "1 ", " 1", "01"]) assert.equal(decidirAcesso(ligada({ ADMIN_CENTRAL: v })).liberada, false, `ADMIN_CENTRAL=${JSON.stringify(v)}`);
});

test("VERCEL ou VERCEL_ENV definida bloqueia, mesmo ligada e com URL local", () => {
  for (const v of ["1", ""]) assert.equal(decidirAcesso(ligada({ VERCEL: v })).liberada, false, `VERCEL=${JSON.stringify(v)}`);
  for (const v of ["preview", "production", "development", ""]) assert.equal(decidirAcesso(ligada({ VERCEL_ENV: v })).liberada, false, `VERCEL_ENV=${JSON.stringify(v)}`);
});

test("ADMIN_DATABASE_URL ausente, vazia, malformada ou remota bloqueia", () => {
  assert.equal(decidirAcesso({ ADMIN_CENTRAL: "1" }).liberada, false);
  for (const u of [
    "",
    "não é url",
    "postgres://u:p@db.example.com:5432/d",
    "postgres://u:p@localhost.example.com:5432/d",
    "postgres://u:p@mylocalhost:5432/d",
    "postgres://u:p@10.0.0.5:5432/d",
    "postgres://u:p@192.168.1.10:5432/d",
    "postgres://u:p@127.0.0.1.example.com:5432/d",
  ])
    assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: u })).liberada, false, u);
});

test("NODE_ENV=production sozinho não bloqueia", () => {
  assert.equal(decidirAcesso(ligada({ NODE_ENV: "production" })).liberada, true);
});

test("a decisão sempre traz motivo", () => {
  assert.ok(decidirAcesso({}).motivo.length > 0);
  assert.ok(decidirAcesso(ligada()).motivo.length > 0);
});

test("G1-3: URL com host na query, vários hosts ou protocolo estranho bloqueia, mesmo com o host da URL local", () => {
  for (const u of [
    "postgres://u@localhost/db?host=banco.remoto",
    "postgres://u@localhost/db?HOST=banco.remoto",
    "postgres://u@localhost/db?Host=127.0.0.1",
    "postgres://u@localhost/db?hostaddr=10.0.0.5",
    "postgres://u@localhost/db?HostAddr=10.0.0.5",
    "postgres://u@localhost/db?service=remoto",
    "postgres://u@localhost/db?sslmode=disable&host=banco.remoto",
    "postgres://u@localhost,banco.remoto:5432/db",
    "postgres://u@localhost:5432,banco.remoto:5432/db",
    "postgres://u@127.0.0.1,10.0.0.5/db",
    "http://u@localhost:5432/db",
    "mysql://u@localhost:3306/db",
    "file://localhost/db",
  ])
    assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: u })).liberada, false, u);
  for (const u of ["postgresql://u@localhost:5432/db", "postgres://u:p@localhost/db?sslmode=disable&application_name=central", "postgres://u:p%2C1@localhost/db"])
    assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: u })).liberada, true, u);
});

test("G1-4: Host de requisição só local (localhost, 127.0.0.1, [::1]), com ou sem porta", () => {
  for (const h of ["localhost", "localhost:3000", "LocalHost:8080", "127.0.0.1", "127.0.0.1:38713", "[::1]", "[::1]:3000", " localhost "]) assert.equal(hostDeRequisicaoLocal(h), true, h);
  for (const h of [null, undefined, "", "evil.example.com", "evil.example.com:3000", "localhost.evil.example.com", "127.0.0.1.evil.example.com", "mylocalhost", "10.0.0.5", "[::2]", "::1", "localhost:abc", "localhost:3000:1", "[::1", "a@localhost", "localhost/x"])
    assert.equal(hostDeRequisicaoLocal(h), false, String(h));
});

// Achado N1 (reverificador): a guarda cortava a URL em `#`, o driver não; `localhost#@remoto` passava e conectava no remoto.
test("N1: `#`, espaço e controle na URL bloqueiam; a guarda e o driver concordam sobre o host em toda URL aceita", async () => {
  for (const u of [
    "postgres://u@localhost#@remoto.example.com/db",
    "postgres://u@localhost:54329#@203.0.113.7:54329/db",
    "postgres://u@localhost#,remoto/db",
    "postgres://u@localhost/db#x",
    "postgres://u@local host/db",
    "postgres://u@localhost/db\n",
    "postgres://u@localhost\t/db",
    "postgres://u@localhost/db\u0000",
  ])
    assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: u })).liberada, false, JSON.stringify(u));
  const { default: postgres } = await import("postgres");
  const aceitas = [LOCAL, "postgres://u:p@127.0.0.1:5432/d", "postgres://u:p@[::1]:5432/d", "postgresql://u@localhost:5432/db", "postgres://u:p@localhost/db?sslmode=disable&application_name=central", "postgres://u:p%2C1@localhost/db", "postgres://u:p%40x@localhost/db"];
  for (const u of aceitas) {
    assert.equal(decidirAcesso(ligada({ ADMIN_DATABASE_URL: u })).liberada, true, u);
    const sql = postgres(u, { max: 1 });
    const hosts = sql.options.host as unknown as string[];
    assert.ok(!sql.options.path && hosts.length > 0 && hosts.every((h) => ["localhost", "127.0.0.1", "::1"].includes(h.toLowerCase())), `${u} -> driver ${JSON.stringify(hosts)}`);
    await sql.end({ timeout: 0 });
  }
});
