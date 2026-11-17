import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthProvider, SendResult, SessionUser, VerifyResult } from "./types";

// Núcleo do provedor `pg` (login por código no e-mail, sessão em cookie HMAC, tudo em Postgres próprio).
// Sem server-only nem next/headers: as dependências entram por `PgDeps`, para o teste unitário rodar sem Next, banco ou rede.
// pg.ts liga isto ao Resend, ao Postgres do writer e aos cookies do Next.

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_SENDS_PER_HOUR = 3;
export const MAX_ATTEMPTS = 5;
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

export type CodeRow = { codeHash: string; expiresAtMs: number };
/** Persistência. Cada método é uma operação atômica no banco (limites não podem depender de ler e depois gravar). */
export interface PgStore {
  /** Grava o código novo se o e-mail tem menos de MAX_SENDS_PER_HOUR envios na última hora; false = limite estourado. */
  issueCode(email: string, codeHash: string, nowMs: number): Promise<boolean>;
  /** Conta uma tentativa e devolve o código. "too_many" = já gastou as MAX_ATTEMPTS; null = não há código. */
  takeAttempt(email: string): Promise<CodeRow | "too_many" | null>;
  /** Invalida o código já usado mas guarda o histórico de envios (o limite por hora não zera com um login bem-sucedido). */
  consumeCode(email: string, nowMs: number): Promise<void>;
  /** Cria o usuário em auth.users se não existe; devolve o id. */
  upsertUser(email: string): Promise<string>;
  /** Usuário vivo + início de validade das sessões (epoch em segundos, truncado ao segundo no banco); null = usuário não existe. */
  findUser(id: string): Promise<{ id: string; email: string; validFromSec: number | null } | null>;
  /** Sessões emitidas antes de nowMs (no segundo) deixam de valer. */
  invalidateSessions(id: string, nowMs: number): Promise<void>;
  /** Grava a revogação e apaga o usuário na mesma transação; profiles/follows/digests caem em cascata. */
  deleteUser(id: string, nowMs: number): Promise<void>;
}

export type PgDeps = {
  store: PgStore;
  env: Record<string, string | undefined>;
  now: () => number;
  /** Retorna true se o desafio anti-robô passou. Em produção sem configuração tem de devolver false (falha fechada). */
  captcha: (token: string | null) => Promise<boolean>;
  sendMail: (to: string, code: string) => Promise<boolean>;
  cookie: { get(): string | undefined; set(value: string, maxAgeS: number): void; clear(): void };
  randomCode?: () => string;
};

export function cookieName(env: Record<string, string | undefined>) {
  return env.NODE_ENV === "production" ? "__Host-sessao" : "sessao";
}

/**
 * Anti-robô do provedor, SEM resgatar o token. Em produção o `sendCode` de account.ts já fez verifyCaptcha() antes de chamar o provedor,
 * e o token do Turnstile é de uso único: uma segunda chamada à verificação voltaria "timeout-or-duplicate" e derrubaria todo login
 * (é o mesmo motivo de o captcha do Supabase Auth estar desligado hoje). Aqui só se garante a falha fechada: produção sem chave
 * configurada ou sem token recusa, mesmo que alguém chame o provedor por outro caminho que não passe por account.ts.
 */
export function captchaPresente(token: string | null, env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "production") return true;
  return Boolean(env.TURNSTILE_SECRET_KEY) && Boolean(token);
}

export function sessionSecret(env: Record<string, string | undefined>): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET (32+ caracteres) é obrigatório com AUTH_PROVIDER=pg");
  return s;
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createPgAuth(d: PgDeps): AuthProvider {
  const secret = () => sessionSecret(d.env);
  // Separação de domínio: o hash do código e a assinatura do cookie nunca se confundem, mesmo com o mesmo segredo.
  const hashCode = (email: string, code: string) => createHash("sha256").update(`codigo:${secret()}:${email}:${code}`).digest("hex");
  const sign = (payload: string) => createHmac("sha256", secret()).update(`cookie:${payload}`).digest("base64url");

  function encode(id: string, nowMs: number) {
    const iat = Math.floor(nowMs / 1000);
    const payload = Buffer.from(JSON.stringify({ id, iat, exp: iat + SESSION_MAX_AGE_S })).toString("base64url");
    return `${payload}.${sign(payload)}`;
  }
  function decode(token: string | undefined): { id: string; iat: number } | null {
    if (!token) return null;
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    if (!safeEq(sig, sign(payload))) return null;
    try {
      const x = JSON.parse(Buffer.from(payload, "base64url").toString());
      if (typeof x.id !== "string" || !UUID.test(x.id) || !Number.isInteger(x.iat) || !Number.isInteger(x.exp)) return null;
      if (x.exp <= d.now() / 1000) return null;
      return { id: x.id, iat: x.iat };
    } catch {
      return null;
    }
  }

  return {
    name: "pg",
    async sendCode(email, captchaToken): Promise<SendResult> {
      if (!(await d.captcha(captchaToken))) return { ok: false, reason: "captcha" };
      try {
        sessionSecret(d.env);
        const code = (d.randomCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0")))();
        if (!(await d.store.issueCode(email, hashCode(email, code), d.now()))) return { ok: false, reason: "rate_limited" };
        // Mesma resposta exista conta ou não: o usuário só nasce em verifyCode.
        return (await d.sendMail(email, code)) ? { ok: true } : { ok: false, reason: "unavailable" };
      } catch (e) {
        console.error("[auth:pg] sendCode", e instanceof Error ? e.message : e);
        return { ok: false, reason: "unavailable" };
      }
    },
    async verifyCode(email, code): Promise<VerifyResult> {
      try {
        const row = await d.store.takeAttempt(email);
        if (row === "too_many") return { ok: false, reason: "too_many" };
        if (!row) return { ok: false, reason: "invalid" };
        if (row.expiresAtMs <= d.now()) return { ok: false, reason: "expired" };
        if (!safeEq(hashCode(email, code), row.codeHash)) return { ok: false, reason: "invalid" };
        await d.store.consumeCode(email, d.now());
        const id = await d.store.upsertUser(email);
        d.cookie.set(encode(id, d.now()), SESSION_MAX_AGE_S);
        return { ok: true, user: { id, email } };
      } catch (e) {
        console.error("[auth:pg] verifyCode", e instanceof Error ? e.message : e);
        return { ok: false, reason: "unavailable" };
      }
    },
    async getUser(): Promise<SessionUser | null> {
      const c = decode(d.cookie.get());
      if (!c) return null;
      const u = await d.store.findUser(c.id);
      if (!u) return null;
      // iat e valido_desde comparados no segundo: cookie emitido antes da revogação cai; o do mesmo segundo vale.
      if (u.validFromSec !== null && c.iat < u.validFromSec) return null;
      return { id: u.id, email: u.email };
    },
    async signOut() {
      const c = decode(d.cookie.get());
      d.cookie.clear();
      if (c) await d.store.invalidateSessions(c.id, d.now()); // todos os aparelhos
    },
    async deleteUser(id) {
      await d.store.deleteUser(id, d.now());
      d.cookie.clear();
    },
  };
}
