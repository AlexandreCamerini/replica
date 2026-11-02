import "server-only";
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { writer } from "@/lib/db/writer";
import type { AuthProvider, SessionUser } from "./types";

// Adaptador LOCAL: código de 6 dígitos com hash, 10 min de validade, 5 tentativas, 3 envios por hora por e-mail.
// O "e-mail" vai para .local/mail/ e para o log do servidor. Recusa rodar em produção.
const COOKIE = "sessao";
const MAX_AGE = 30 * 24 * 3600;
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET (16+ caracteres) é obrigatório para o login local");
  return s;
};
const hash = (s: string) => createHash("sha256").update(`${secret()}:${s}`).digest("hex");
const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

function encode(u: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
function decode(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof d.id !== "string" || typeof d.email !== "string" || d.exp < Date.now() / 1000) return null;
    return { id: d.id, email: d.email };
  } catch {
    return null;
  }
}

async function deliver(email: string, code: string) {
  const dir = join(process.cwd(), "..", ".local", "mail");
  await mkdir(dir, { recursive: true });
  const body = `Para: ${email}\nAssunto: Seu código de acesso\n\nSeu código é ${code}. Vale por 10 minutos.\nSe não foi você, ignore esta mensagem.\n`;
  await writeFile(join(dir, `${Date.now()}-${email.replace(/[^a-z0-9@._-]/gi, "_")}.txt`), body);
  console.info(`[auth:dev] código para ${email}: ${code}`);
}

export const devAuth: AuthProvider = {
  name: "dev",
  async sendCode(email) {
    const sql = writer();
    const now = new Date();
    const [row] = await sql`select sent_at from devauth.codes where email = ${email}`;
    const recent = ((row?.sent_at as Date[] | undefined) ?? []).filter((d) => now.getTime() - new Date(d).getTime() < 3600_000);
    if (recent.length >= 3) return { ok: false, reason: "rate_limited" };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sql`
      insert into devauth.codes (email, code_hash, expires_at, attempts, sent_at)
      values (${email}, ${hash(code)}, now() + interval '10 minutes', 0, ${[...recent, now]})
      on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`;
    await deliver(email, code);
    return { ok: true };
  },
  async verifyCode(email, code) {
    const sql = writer();
    const [row] = await sql`select code_hash, expires_at, attempts from devauth.codes where email = ${email}`;
    if (!row) return { ok: false, reason: "invalid" };
    if (Number(row.attempts) >= 5) return { ok: false, reason: "too_many" };
    if (new Date(row.expires_at as string) < new Date()) return { ok: false, reason: "expired" };
    const good = String(row.code_hash);
    const given = hash(code);
    if (!timingSafeEqual(Buffer.from(given), Buffer.from(good))) {
      await sql`update devauth.codes set attempts = attempts + 1 where email = ${email}`;
      return { ok: false, reason: "invalid" };
    }
    await sql`delete from devauth.codes where email = ${email}`;
    const [u] = await sql`
      insert into auth.users (id, email) values (${randomUUID()}, ${email})
      on conflict (email) do update set email = excluded.email returning id`;
    const user = { id: String(u.id), email };
    (await cookies()).set(COOKIE, encode(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
    return { ok: true, user };
  },
  async getUser() {
    return decode((await cookies()).get(COOKIE)?.value);
  },
  async signOut() {
    (await cookies()).delete(COOKIE);
  },
  async deleteUser(id) {
    await writer()`delete from auth.users where id = ${id}::uuid`;
    (await cookies()).delete(COOKIE);
  },
};
