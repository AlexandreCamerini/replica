// Contrato de autenticação por código no e-mail (sem senha). Supabase (produção até o corte) ou `pg` (Postgres próprio); adaptador local só em desenvolvimento.

export type SessionUser = { id: string; email: string };

export type SendResult = { ok: true } | { ok: false; reason: "rate_limited" | "captcha" | "unavailable" };
export type VerifyResult = { ok: true; user: SessionUser } | { ok: false; reason: "invalid" | "expired" | "too_many" | "unavailable" };

export interface AuthProvider {
  readonly name: "supabase" | "dev" | "pg";
  /** Sempre "ok" para e-mail válido, exista conta ou não (não revela cadastro). */
  sendCode(email: string, captchaToken: string | null): Promise<SendResult>;
  verifyCode(email: string, code: string): Promise<VerifyResult>;
  getUser(): Promise<SessionUser | null>;
  signOut(): Promise<void>;
  /** Apaga o usuário no provedor; profiles/follows/digests caem em cascata (LGPD). */
  deleteUser(id: string): Promise<void>;
}
