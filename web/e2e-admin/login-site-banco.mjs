// Prova do login do SITE (provedor `pg`, D336) contra um Postgres de verdade: o SQL de web/src/lib/auth/pg-store.ts, que o teste unitário
// (pg-auth.test.ts, persistência em memória) não alcança. Nonce no banco, tentativa de outro navegador sem efeito, linha antiga sem nonce,
// consumo atômico sob concorrência e teto global de envios.
//
// Uso (banco DESCARTÁVEL com as migrações até a 0144 ou mais; a prova escreve e apaga só as próprias linhas, e o teto global usa e-mails de prova):
//   LOGIN_PROVA_HOST=/tmp/claude/pgs LOGIN_PROVA_PORT=54329 LOGIN_PROVA_DB=<banco> node e2e-admin/login-site-banco.mjs
import assert from "node:assert/strict";
import postgres from "postgres";
import { createPgAuth, MAX_SENDS_GLOBAL_PER_HOUR } from "../src/lib/auth/pg-core.ts";
import { pgStore } from "../src/lib/auth/pg-store.ts";

const sql = postgres({ host: process.env.LOGIN_PROVA_HOST ?? "localhost", port: Number(process.env.LOGIN_PROVA_PORT ?? 5432), database: process.env.LOGIN_PROVA_DB, username: process.env.LOGIN_PROVA_USER ?? "postgres", max: 4, prepare: false, onnotice: () => {} });
const PREFIXO = `prova-site-${process.pid}-`;
const env = { SESSION_SECRET: "s".repeat(48), NODE_ENV: "production" };
let feitos = 0;
const passo = async (nome, fn) => {
  await fn();
  feitos++;
  console.log(`ok  ${nome}`);
};
function navegador() {
  const jar = { v: undefined };
  const nonce = { v: undefined };
  const mails = [];
  const auth = createPgAuth({
    store: pgStore(sql),
    env,
    now: () => Date.now(),
    captcha: async () => true,
    sendMail: async (_to, c) => (mails.push(c), true),
    cookie: { get: () => jar.v, set: (v) => (jar.v = v), clear: () => (jar.v = undefined) },
    nonce: { get: () => nonce.v, set: (v) => (nonce.v = v), clear: () => (nonce.v = undefined) },
  });
  return { auth, jar, nonce, mails };
}

try {
  const E = `${PREFIXO}a@x.com`;
  await passo("o banco guarda o hash do nonce, nunca o nonce; tentativa de outro navegador não conta nem compara", async () => {
    const dono = navegador();
    assert.deepEqual(await dono.auth.sendCode(E, "t"), { ok: true });
    const [l] = await sql`select nonce_hash, attempts from login.codes where email = ${E}`;
    assert.match(l.nonce_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(l.nonce_hash, dono.nonce.v);
    const outro = navegador();
    for (const n of [undefined, "", "b".repeat(32)]) {
      outro.nonce.v = n;
      for (let i = 0; i < 8; i++) assert.equal((await outro.auth.verifyCode(E, dono.mails[0])).ok, false);
    }
    const [d] = await sql`select attempts from login.codes where email = ${E}`;
    assert.equal(d.attempts, 0, "nenhuma tentativa de outro navegador foi contada");
  });

  await passo("duas verificações simultâneas com o código certo: só uma entra (where code_hash = ... no SQL)", async () => {
    const dono = navegador();
    await dono.auth.sendCode(`${PREFIXO}b@x.com`, "t");
    const r = await Promise.all([0, 1, 2].map(() => dono.auth.verifyCode(`${PREFIXO}b@x.com`, dono.mails[0])));
    assert.deepEqual(r.map((x) => x.ok).sort(), [false, false, true]);
  });

  await passo("linha antiga, de antes da 0144 (nonce_hash = ''), nunca verifica", async () => {
    const dono = navegador();
    const e = `${PREFIXO}c@x.com`;
    await dono.auth.sendCode(e, "t");
    await sql`update login.codes set nonce_hash = '' where email = ${e}`;
    assert.equal((await dono.auth.verifyCode(e, dono.mails[0])).ok, false);
    const [l] = await sql`select attempts, code_hash <> '' as vivo from login.codes where email = ${e}`;
    assert.deepEqual([l.attempts, l.vivo], [0, true], "nem conta tentativa nem consome");
  });

  await passo(`teto global: com ${MAX_SENDS_GLOBAL_PER_HOUR} envios na última hora no site, o próximo sai "unavailable" e nada é gravado`, async () => {
    const [{ n }] = await sql`select count(*)::int as n from login.codes, unnest(sent_at) t where t > now() - interval '1 hour'`;
    const faltam = Math.max(0, MAX_SENDS_GLOBAL_PER_HOUR - n);
    await sql`insert into login.codes (email, code_hash, nonce_hash, expires_at, sent_at)
              select ${PREFIXO} || 'g' || i || '@x.com', 'h', 'n', now() + interval '10 minutes', array[now()] from generate_series(1, ${faltam}) i`;
    const v = navegador();
    const e = `${PREFIXO}novo@x.com`;
    assert.deepEqual(await v.auth.sendCode(e, "t"), { ok: false, reason: "unavailable" });
    const [{ x }] = await sql`select count(*)::int as x from login.codes where email = ${e}`;
    assert.equal(x, 0);
    assert.equal(v.mails.length, 0, "nenhum e-mail saiu");
  });
  console.log(`\n${feitos} passos, todos ok`);
} finally {
  await sql`delete from login.codes where email like ${PREFIXO + "%"}`;
  await sql`delete from auth.users where email like ${PREFIXO + "%"}`;
  await sql.end({ timeout: 1 });
}
