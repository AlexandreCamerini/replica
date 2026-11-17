import assert from "node:assert/strict";
import { test } from "node:test";
import { decidirAcesso } from "../admin/guarda-regra.ts";

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
