import { createHmac, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238 sobre o HOTP da RFC 4226): SHA-1, passo de 30 s, 6 dígitos. É o que os aplicativos autenticadores implementam por padrão. Módulo PURO.
// Sem biblioteca: são ~40 linhas sobre node:crypto, conferidas contra os vetores das duas RFCs (teste admin-login).

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PASSO_S = 30;
export const DIGITOS = 6;
/** Passos aceitos para trás e para a frente do relógio do servidor (relógio do telefone adiantado ou atrasado em até 30 s, e o tempo de digitar). */
export const JANELA = 1;

export function paraBase32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

/** `null` se houver caractere fora do alfabeto (espaços, hífens e `=` são ignorados; a caixa não importa). */
export function deBase32(texto: string): Buffer | null {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, "");
  if (limpo === "") return null;
  const bytes: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) return null;
    valor = ((valor << 5) | i) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(segredo: Uint8Array, contador: number, digitos: number = DIGITOS): string {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(contador));
  const h = createHmac("sha1", segredo).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digitos).padStart(digitos, "0");
}

export const passoDe = (agoraMs: number): number => Math.floor(agoraMs / 1000 / PASSO_S);

/**
 * Confere o código contra os passos da janela e devolve o passo aceito, ou `null`. Só vale passo MAIOR que `ultimoPasso` (o mesmo código não entra duas vezes).
 * Compara os três candidatos sempre, em tempo constante: o tempo de resposta não diz qual passo casou nem se algum casou.
 */
export function conferirTotp(segredo: Uint8Array, codigo: string, agoraMs: number, ultimoPasso: number | null): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const dado = Buffer.from(codigo);
  const atual = passoDe(agoraMs);
  let aceito: number | null = null;
  for (let d = -JANELA; d <= JANELA; d++) {
    const passo = atual + d;
    const igual = timingSafeEqual(Buffer.from(hotp(segredo, passo)), dado);
    if (igual && (ultimoPasso === null || passo > ultimoPasso) && aceito === null) aceito = passo;
  }
  return aceito;
}

/** URI que o aplicativo autenticador lê (por QR ou por link no próprio aparelho). */
export function uriOtpauth(segredoBase32: string, conta: string, emissor: string): string {
  const rotulo = `${encodeURIComponent(emissor)}:${encodeURIComponent(conta)}`;
  return `otpauth://totp/${rotulo}?secret=${segredoBase32}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASSO_S}`;
}
