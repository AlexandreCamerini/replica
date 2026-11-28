import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Sessão própria da central (D335): cookie assinado com HMAC-SHA256, sem provedor externo e sem ida ao banco para LER (o middleware confere assinatura e validade;
// admin ativo, fator verificado e início da sessão são conferidos por requisição em sessao.ts). Módulo PURO: o middleware e o `node --test` o importam.
//
// Dois níveis, no mesmo cookie:
//   1 = provou o e-mail (código de 6 números). Vale 15 min e só abre o cadastro ou a verificação do segundo fator.
//   2 = provou também o segundo fator (TOTP). Vale 12 h, sem renovação: vencido, entra de novo.
// Sem renovação deslizante de propósito: é o que dispensa estado de sessão no banco. Revogar antes do prazo (0158): "Sair" na central, `ativo = false`
// em adm_admins, ou o dono apaga o fator. Limite: `iat` vem do relógio da aplicação e `sessoes_desde` do banco; relógios muito fora de sincronia deixam passar a diferença.

export type NivelSessao = 1 | 2;
export type SessaoCentral = { email: string; nivel: NivelSessao; iat: number };
export const VALIDADE_S: Record<NivelSessao, number> = { 1: 15 * 60, 2: 12 * 3600 };

type Ambiente = Record<string, string | undefined>;

/** O SESSION_SECRET serve à central? (32+ caracteres; a guarda fecha a central sem ele.) */
export const segredoDeSessaoOk = (env: Ambiente): boolean => typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32;

/** Chave por uso, derivada do SESSION_SECRET: assinatura do cookie, hash do código e cifra do segredo TOTP nunca compartilham chave. */
export function chaveDaCentral(env: Ambiente, uso: "cookie" | "codigo" | "fator" | "origem"): Buffer {
  if (!segredoDeSessaoOk(env)) throw new Error("SESSION_SECRET (32+ caracteres) é obrigatório no modo produção da central");
  return createHmac("sha256", env.SESSION_SECRET as string).update(`central:${uso}`).digest();
}

const assinar = (env: Ambiente, corpo: string): string => createHmac("sha256", chaveDaCentral(env, "cookie")).update(corpo).digest("base64url");
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function assinarSessao(env: Ambiente, email: string, nivel: NivelSessao, agoraMs: number): { valor: string; maxAgeS: number } {
  const iat = Math.floor(agoraMs / 1000);
  const maxAgeS = VALIDADE_S[nivel];
  const corpo = Buffer.from(JSON.stringify({ e: email, n: nivel, iat, exp: iat + maxAgeS })).toString("base64url");
  return { valor: `${corpo}.${assinar(env, corpo)}`, maxAgeS };
}

/** `null` para cookie ausente, malformado, com assinatura errada, vencido, emitido no futuro ou com validade maior que a do nível. Nunca lança por causa do cookie. */
export function lerSessao(env: Ambiente, valor: string | undefined, agoraMs: number): SessaoCentral | null {
  if (!valor || valor.length > 1024) return null;
  const partes = valor.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;
  const esperada = Buffer.from(assinar(env, partes[0]));
  const dada = Buffer.from(partes[1]);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return null;
  try {
    const x = JSON.parse(Buffer.from(partes[0], "base64url").toString()) as Record<string, unknown>;
    const agora = agoraMs / 1000;
    if (typeof x.e !== "string" || x.e !== x.e.toLowerCase() || !EMAIL.test(x.e)) return null;
    if (x.n !== 1 && x.n !== 2) return null;
    if (!Number.isInteger(x.iat) || !Number.isInteger(x.exp)) return null;
    const iat = x.iat as number;
    const exp = x.exp as number;
    if (exp <= agora || iat > agora + 60 || exp - iat !== VALIDADE_S[x.n]) return null;
    return { email: x.e, nivel: x.n, iat };
  } catch {
    return null;
  }
}

/** Hash do código de e-mail (o banco nunca guarda o código). O nonce do navegador que pediu entra no hash: o código só confere para quem o pediu. */
export const hashDoCodigo = (env: Ambiente, email: string, nonce: string, codigo: string): string =>
  createHmac("sha256", chaveDaCentral(env, "codigo")).update(`${email}:${nonce}:${codigo}`).digest("hex");
/** O que o banco guarda do nonce (nunca o nonce): quem lê o banco não consegue montar o cookie da etapa. */
export const hashDoNonce = (env: Ambiente, nonce: string): string => createHmac("sha256", chaveDaCentral(env, "codigo")).update(`nonce:${nonce}`).digest("hex");
/** O que o banco guarda da origem do pedido (nunca o IP): orçamento de envios por origem (migração 0159). Sem IP legível, todos caem no mesmo balde "desconhecida". */
export const hashDaOrigem = (env: Ambiente, ip: string): string => createHmac("sha256", chaveDaCentral(env, "origem")).update(`ip:${ip.trim() || "desconhecida"}`).digest("hex");
export const novoNonce = (): string => randomBytes(16).toString("hex");
export const NONCE = /^[0-9a-f]{32}$/;

/** Cifra o segredo TOTP para o banco (AES-256-GCM; o e-mail entra como dado autenticado: o segredo de um admin não serve na linha de outro). */
export function cifrarSegredo(env: Ambiente, email: string, segredo: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chaveDaCentral(env, "fator"), iv);
  c.setAAD(Buffer.from(email));
  const corpo = Buffer.concat([c.update(segredo), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corpo]).toString("base64url");
}

/** `null` se o texto não abre com esta chave e este e-mail (segredo trocado, linha copiada de outro admin, SESSION_SECRET diferente). */
export function decifrarSegredo(env: Ambiente, email: string, cifrado: string): Buffer | null {
  try {
    const b = Buffer.from(cifrado, "base64url");
    if (b.length < 12 + 16 + 1) return null;
    const d = createDecipheriv("aes-256-gcm", chaveDaCentral(env, "fator"), b.subarray(0, 12));
    d.setAAD(Buffer.from(email));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}
