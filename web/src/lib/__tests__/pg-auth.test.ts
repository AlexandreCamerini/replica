import assert from "node:assert/strict";
import { test } from "node:test";
import { captchaPresente, cookieName, createPgAuth, MAX_ATTEMPTS, MAX_SENDS_GLOBAL_PER_HOUR, MAX_SENDS_PER_HOUR, type CodeRow, type PgDeps, type PgStore } from "../auth/pg-core.ts";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres!";
const UID = "11111111-2222-4333-8444-555555555555";
const T0 = Date.parse("2026-11-17T12:00:00.500Z");

// Banco em memória com a mesma semântica das operações atômicas de pg-store.ts.
function memStore() {
  const codes = new Map<string, { codeHash: string; nonceHash: string; expiresAtMs: number; attempts: number; sent: number[] }>();
  const users = new Map<string, { id: string; email: string }>();
  const valid = new Map<string, number>(); // epoch em ms, como valido_desde
  const store: PgStore = {
    async issueCode(email, codeHash, nonceHash, nowMs) {
      const global = [...codes.values()].reduce((n, c) => n + c.sent.filter((t) => t > nowMs - 3600_000).length, 0);
      if (global >= MAX_SENDS_GLOBAL_PER_HOUR) return false;
      const cur = codes.get(email);
      const recent = (cur?.sent ?? []).filter((t) => t > nowMs - 3600_000);
      if (recent.length >= MAX_SENDS_PER_HOUR) return false;
      codes.set(email, { codeHash, nonceHash, expiresAtMs: nowMs + 600_000, attempts: 0, sent: [...recent, nowMs] });
      return true;
    },
    async takeAttempt(email, nonceHash): Promise<CodeRow | "too_many" | null> {
      const c = codes.get(email);
      if (!c || c.nonceHash !== nonceHash || c.nonceHash === "") return null;
      if (c.attempts >= MAX_ATTEMPTS) return "too_many";
      c.attempts++;
      return { codeHash: c.codeHash, expiresAtMs: c.expiresAtMs };
    },
    async consumeCode(email, codeHash) {
      const c = codes.get(email);
      if (!c || c.codeHash !== codeHash || c.codeHash === "") return false;
      c.codeHash = ""; // mantém sent: o limite por hora não zera
      return true;
    },
    async upsertUser(email) {
      for (const u of users.values()) if (u.email === email) return u.id;
      users.set(UID, { id: UID, email });
      return UID;
    },
    async findUser(id) {
      const u = users.get(id);
      if (!u) return null;
      const v = valid.get(id);
      return { ...u, validFromSec: v === undefined ? null : Math.floor(v / 1000) }; // date_trunc('second')
    },
    async invalidateSessions(id, nowMs) {
      valid.set(id, Math.max(valid.get(id) ?? 0, nowMs));
    },
    async deleteUser(id, nowMs) {
      valid.set(id, nowMs);
      users.delete(id);
    },
  };
  return { store, codes, users, valid };
}

function setup(over: Partial<PgDeps> = {}, env: Record<string, string | undefined> = { SESSION_SECRET: SECRET, NODE_ENV: "production" }) {
  const clock = { t: T0 };
  const mem = memStore();
  const mails: { to: string; code: string }[] = [];
  const jar = { value: undefined as string | undefined };
  const nonce = { value: undefined as string | undefined };
  const deps: PgDeps = {
    store: mem.store,
    env,
    now: () => clock.t,
    captcha: async () => true,
    sendMail: async (to, code) => (mails.push({ to, code }), true),
    cookie: { get: () => jar.value, set: (v) => void (jar.value = v), clear: () => void (jar.value = undefined) },
    nonce: { get: () => nonce.value, set: (v) => void (nonce.value = v), clear: () => void (nonce.value = undefined) },
    ...over,
  };
  return { auth: createPgAuth(deps), clock, mem, mails, jar, nonce };
}
const login = async (s: ReturnType<typeof setup>, email = "a@b.com") => {
  await s.auth.sendCode(email, "tok");
  return s.auth.verifyCode(email, s.mails.at(-1)!.code);
};

test("e-mail inexistente e existente recebem a mesma resposta e o mesmo e-mail", async () => {
  const s = setup();
  await login(s, "existe@x.com"); // cria a conta
  const novo = await s.auth.sendCode("nao-existe@x.com", "tok");
  const velho = await s.auth.sendCode("existe@x.com", "tok");
  assert.deepEqual(novo, { ok: true });
  assert.deepEqual(velho, novo);
  assert.equal(s.mails.length, 3);
  // e verificar um e-mail sem código pedido é "invalid", igual a código errado
  assert.deepEqual(await s.auth.verifyCode("ninguem@x.com", "000000"), { ok: false, reason: "invalid" });
});

test("4º envio na mesma hora é rate_limited; passada a hora, volta a enviar", async () => {
  const s = setup();
  for (let i = 0; i < 3; i++) assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: true });
  assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: false, reason: "rate_limited" });
  assert.equal(s.mails.length, 3);
  s.clock.t += 3600_001;
  assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: true });
});

test("código expirado após 10 min; dentro do prazo vale", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  s.clock.t += 600_001;
  assert.deepEqual(await s.auth.verifyCode("a@b.com", s.mails[0].code), { ok: false, reason: "expired" });
  const t = setup();
  await t.auth.sendCode("a@b.com", "tok");
  t.clock.t += 599_000;
  assert.equal((await t.auth.verifyCode("a@b.com", t.mails[0].code)).ok, true);
});

test("5 tentativas erradas; a 6ª é too_many, mesmo com o código certo", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  const certo = s.mails[0].code;
  const errado = certo === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.deepEqual(await s.auth.verifyCode("a@b.com", errado), { ok: false, reason: "invalid" });
  assert.deepEqual(await s.auth.verifyCode("a@b.com", errado), { ok: false, reason: "too_many" });
  assert.deepEqual(await s.auth.verifyCode("a@b.com", certo), { ok: false, reason: "too_many" });
  assert.equal(s.jar.value, undefined);
});

test("código só vale uma vez, e um login bem-sucedido não zera o limite de envios", async () => {
  const s = setup();
  assert.equal((await login(s)).ok, true);
  assert.deepEqual(await s.auth.verifyCode("a@b.com", s.mails[0].code), { ok: false, reason: "invalid" });
  await s.auth.sendCode("a@b.com", "tok");
  await s.auth.sendCode("a@b.com", "tok");
  assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: false, reason: "rate_limited" }); // 1 do login + 2 = 3
});

test("o código só vale no navegador que o pediu: sem o nonce, nem o código certo entra, e a tentativa não gasta as do dono", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  const certo = s.mails[0].code;
  assert.match(s.nonce.value ?? "", /^[0-9a-f]{32}$/);
  const doDono = s.nonce.value;
  for (const outro of [undefined, "", "x".repeat(32), "b".repeat(32)]) {
    s.nonce.value = outro;
    for (let i = 0; i < 10; i++) assert.deepEqual(await s.auth.verifyCode("a@b.com", certo), { ok: false, reason: "invalid" }, String(outro));
  }
  assert.equal(s.mem.codes.get("a@b.com")!.attempts, 0, "tentativas de outro navegador não contaram");
  assert.ok(!JSON.stringify([...s.mem.codes]).includes(doDono!), "o banco guarda o hash do nonce, nunca o nonce");
  s.nonce.value = doDono;
  assert.equal((await s.auth.verifyCode("a@b.com", certo)).ok, true);
  assert.equal(s.nonce.value, undefined, "o nonce sai depois do login");
});

test("pedir de novo troca o nonce: o código antigo, mesmo certo, não entra no navegador novo", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  const velho = s.mails[0].code;
  await s.auth.sendCode("a@b.com", "tok");
  if (s.mails[1].code !== velho) assert.deepEqual(await s.auth.verifyCode("a@b.com", velho), { ok: false, reason: "invalid" });
  assert.equal((await s.auth.verifyCode("a@b.com", s.mails[1].code)).ok, true);
});

test("consumo atômico: se outro pedido consumiu o código entre conferir e consumir, não entra", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  const original = s.mem.store.consumeCode.bind(s.mem.store);
  let primeira = true;
  s.mem.store.consumeCode = async (email, hash, agora) => {
    if (primeira) {
      primeira = false;
      await original(email, hash, agora); // a outra requisição chegou antes
    }
    return original(email, hash, agora);
  };
  assert.deepEqual(await s.auth.verifyCode("a@b.com", s.mails[0].code), { ok: false, reason: "invalid" });
  assert.equal(s.jar.value, undefined, "nenhuma sessão foi gravada");
});

test("teto do site: passado MAX_SENDS_GLOBAL_PER_HOUR envios na hora, qualquer e-mail recebe rate_limited", async () => {
  const s = setup();
  for (let i = 0; i < MAX_SENDS_GLOBAL_PER_HOUR; i++) assert.deepEqual(await s.auth.sendCode(`p${i}@x.com`, "tok"), { ok: true });
  assert.deepEqual(await s.auth.sendCode("outra@x.com", "tok"), { ok: false, reason: "rate_limited" });
  s.clock.t += 3600_000 + 1;
  assert.deepEqual(await s.auth.sendCode("outra@x.com", "tok"), { ok: true });
});

test("captcha ausente ou recusado em produção falha, antes de gravar ou enviar", async () => {
  const s = setup({ captcha: async (t) => t !== null });
  assert.deepEqual(await s.auth.sendCode("a@b.com", null), { ok: false, reason: "captcha" });
  assert.equal(s.mails.length, 0);
  assert.equal(s.mem.codes.size, 0);
});

test("o código não vai em claro para o banco e o hash depende do e-mail", async () => {
  const s = setup();
  await s.auth.sendCode("a@b.com", "tok");
  const row = s.mem.codes.get("a@b.com")!;
  assert.notEqual(row.codeHash, s.mails[0].code);
  assert.match(row.codeHash, /^[0-9a-f]{64}$/);
});

test("cookie: sessão válida volta o usuário; adulterado é rejeitado", async () => {
  const s = setup();
  assert.equal((await login(s)).ok, true);
  assert.deepEqual(await s.auth.getUser(), { id: UID, email: "a@b.com" });
  const good = s.jar.value!;
  const [payload, sig] = good.split(".");
  // payload trocado (outro id), assinatura antiga
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), id: "99999999-2222-4333-8444-555555555555" })).toString("base64url");
  for (const bad of [`${forged}.${sig}`, `${payload}.${sig.slice(0, -2)}AA`, `${payload}`, "", "a.b.c", `${good}.x`]) {
    s.jar.value = bad;
    assert.equal(await s.auth.getUser(), null, bad);
  }
  // outro segredo não valida o cookie
  const other = setup({}, { SESSION_SECRET: "outro-segredo-com-mais-de-32-caracteres!!", NODE_ENV: "production" });
  other.mem.users.set(UID, { id: UID, email: "a@b.com" });
  other.jar.value = good;
  assert.equal(await other.auth.getUser(), null);
});

test("cookie expira em 30 dias", async () => {
  const s = setup();
  await login(s);
  s.clock.t += 30 * 24 * 3600_000 + 1000;
  assert.equal(await s.auth.getUser(), null);
});

test("cookie emitido antes de sessoes_validas_desde é rejeitado; do mesmo segundo, depois, é aceito", async () => {
  const s = setup();
  await login(s); // iat = 12:00:00 (T0 tem 500 ms)
  const antigo = s.jar.value!;
  // revogação 2 s depois: o cookie antigo cai
  s.clock.t = T0 + 2000;
  s.mem.valid.set(UID, s.clock.t);
  s.jar.value = antigo;
  assert.equal(await s.auth.getUser(), null);
  // novo login no mesmo segundo da revogação (iat == valido_desde truncado): aceito
  s.clock.t = T0 + 2300;
  s.mem.valid.set(UID, T0 + 2100); // valido_desde 12:00:02.600 → 12:00:02
  await login(s);
  assert.deepEqual(await s.auth.getUser(), { id: UID, email: "a@b.com" });
  // e o cookie do segundo anterior continua recusado
  s.jar.value = antigo;
  assert.equal(await s.auth.getUser(), null);
});

test("signOut revoga todos os aparelhos; deleteUser revoga e apaga", async () => {
  const s = setup();
  await login(s);
  const aparelhoA = s.jar.value!;
  s.clock.t += 5000;
  await login(s, "a@b.com").catch(() => {}); // segundo aparelho
  const aparelhoB = s.jar.value!;
  s.clock.t += 5000;
  await s.auth.signOut();
  assert.equal(s.jar.value, undefined);
  for (const c of [aparelhoA, aparelhoB]) {
    s.jar.value = c;
    assert.equal(await s.auth.getUser(), null);
  }
  const d = setup();
  await login(d);
  await d.auth.deleteUser(UID);
  assert.equal(d.mem.users.size, 0);
  assert.ok(d.mem.valid.has(UID));
  assert.equal(d.jar.value, undefined);
});

test("SESSION_SECRET curto ou ausente: o provedor recusa em vez de assinar fraco", async () => {
  const s = setup({}, { SESSION_SECRET: "curto", NODE_ENV: "production" });
  assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: false, reason: "unavailable" });
  assert.equal(s.mails.length, 0);
  assert.equal(await s.auth.getUser(), null);
});

test("falha no envio do e-mail vira unavailable; nome do cookie com __Host- só em produção", async () => {
  const s = setup({ sendMail: async () => false });
  assert.deepEqual(await s.auth.sendCode("a@b.com", "tok"), { ok: false, reason: "unavailable" });
  assert.equal(cookieName({ NODE_ENV: "production" }), "__Host-sessao");
  assert.equal(cookieName({ NODE_ENV: "development" }), "sessao");
});

test("captchaPresente: produção sem chave ou sem token falha fechada; fora de produção passa", () => {
  const prod = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "k" };
  assert.equal(captchaPresente("tok", prod), true);
  assert.equal(captchaPresente(null, prod), false);
  assert.equal(captchaPresente("", prod), false);
  assert.equal(captchaPresente("tok", { NODE_ENV: "production" }), false); // chave ausente: falha fechada
  assert.equal(captchaPresente(null, { NODE_ENV: "development" }), true);
});
