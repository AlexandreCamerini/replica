import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cifrarSegredo, decifrarSegredo, hashDoCodigo, hashDoNonce } from "./sessao-cookie.ts";
import { conferirTotp, paraBase32, uriOtpauth } from "./totp.ts";

// Núcleo do login próprio da central (D335): código por e-mail e segundo fator TOTP, tudo em Postgres. Módulo PURO: persistência, relógio e envio entram por `DepsLogin`,
// para o teste rodar sem Next, banco ou rede. login.ts liga isto ao pool da central, ao e-mail e aos cookies.
// Quem chama já conferiu que o e-mail é de admin ATIVO (entrada.ts): aqui não se decide quem é admin.

export const CODIGO_VALE_MS = 10 * 60_000;
export const ENVIOS_POR_HORA = 3;
export const TENTATIVAS_DO_CODIGO = 5;
/** Tentativas de TOTP por janela: com 3 códigos válidos em 1.000.000 a cada instante, 5 palpites a cada 15 min dão ~0,14% de acerto por dia de ataque contínuo. */
export const TENTATIVAS_DO_FATOR = 5;
export const JANELA_DO_FATOR_MS = 15 * 60_000;
export const EMISSOR = "Segue o Voto (central)";

export type LinhaFator = { segredoCifrado: string; verificado: boolean; ultimoPasso: number | null };

/** Persistência. Cada método é UMA operação atômica no banco: nenhum limite depende de ler e depois gravar. */
export interface LoginStore {
  /** Grava o código novo (e o hash do nonce de quem pediu) se o e-mail tem menos de ENVIOS_POR_HORA envios na última hora; false = limite estourado. */
  emitirCodigo(email: string, hash: string, nonceHash: string, agoraMs: number): Promise<boolean>;
  /** Conta uma tentativa e devolve o código, SÓ se o nonce é o de quem pediu. null = não há código para este nonce, ou as tentativas acabaram (quem não tem o nonce não gasta tentativa de ninguém). */
  tentarCodigo(email: string, nonceHash: string): Promise<{ hash: string; expiraMs: number } | null>;
  /** Invalida o código SE ainda for este (uso único também sob concorrência), guardando o histórico de envios. false = outro pedido já o consumiu ou trocou. */
  consumirCodigo(email: string, hash: string, agoraMs: number): Promise<boolean>;
  fator(email: string): Promise<LinhaFator | null>;
  /** Grava (ou regrava) o fator NÃO verificado. false = já existe fator verificado para o e-mail (nada muda). */
  gravarFatorNovo(email: string, segredoCifrado: string, agoraMs: number): Promise<boolean>;
  /** Conta uma tentativa de TOTP na janela. false = limite da janela estourado (a tentativa não vale). */
  tentarFator(email: string, agoraMs: number): Promise<boolean>;
  /** Aceita o passo se for maior que o último aceito E o segredo gravado ainda for o conferido; marca o fator como verificado (se ainda não era) e zera as tentativas. false = passo já usado ou segredo trocado no meio. */
  aceitarPasso(email: string, segredoCifrado: string, passo: number, agoraMs: number): Promise<boolean>;
}

export type DepsLogin = {
  store: LoginStore;
  env: Record<string, string | undefined>;
  agora: () => number;
  enviarEmail: (para: string, codigo: string) => Promise<boolean>;
  codigoAleatorio?: () => string;
  segredoAleatorio?: () => Uint8Array;
};

export type ResultadoCodigo = "ok" | "invalido";
export type ResultadoFator = "ok" | "invalido" | "muitas" | "sem_fator";

const igual = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function criarLogin(d: DepsLogin) {
  return {
    /** Emite e envia o código, amarrado ao nonce do navegador que pediu. `false` = limite por hora ou falha de envio (quem chama responde igual nos dois casos e para quem não é admin). */
    async enviarCodigo(email: string, nonce: string): Promise<boolean> {
      const codigo = (d.codigoAleatorio ?? (() => String(randomInt(0, 1_000_000)).padStart(6, "0")))();
      if (!(await d.store.emitirCodigo(email, hashDoCodigo(d.env, email, nonce, codigo), hashDoNonce(d.env, nonce), d.agora()))) return false;
      return d.enviarEmail(email, codigo);
    },

    /** Confere o código de e-mail. Vencido, errado, gasto, de outro navegador ou sem código: tudo "invalido" (a tela não distingue). */
    async verificarCodigo(email: string, nonce: string, codigo: string): Promise<ResultadoCodigo> {
      const linha = await d.store.tentarCodigo(email, hashDoNonce(d.env, nonce));
      if (linha === null) return "invalido";
      if (linha.expiraMs <= d.agora() || linha.hash === "") return "invalido";
      if (!igual(hashDoCodigo(d.env, email, nonce, codigo), linha.hash)) return "invalido";
      return (await d.store.consumirCodigo(email, linha.hash, d.agora())) ? "ok" : "invalido";
    },

    /** O e-mail já tem fator verificado? (Sem linha ou com fator pendente = false.) */
    async temFatorVerificado(email: string): Promise<boolean> {
      return (await d.store.fator(email))?.verificado === true;
    },

    /** Primeiro cadastro: cria o segredo e o devolve UMA vez. `null` = já há fator verificado (trocar é ato do dono do banco). */
    async iniciarCadastro(email: string): Promise<{ segredo: string; uri: string } | null> {
      const bruto = (d.segredoAleatorio ?? (() => randomBytes(20)))();
      if (!(await d.store.gravarFatorNovo(email, cifrarSegredo(d.env, email, bruto), d.agora()))) return null;
      const segredo = paraBase32(bruto);
      return { segredo, uri: uriOtpauth(segredo, email, EMISSOR) };
    },

    /** Confere o código do autenticador: conclui o cadastro pendente ou verifica o fator já cadastrado. A tentativa é contada ANTES de conferir. */
    async confirmarFator(email: string, codigo: string): Promise<ResultadoFator> {
      const f = await d.store.fator(email);
      if (!f) return "sem_fator";
      if (!(await d.store.tentarFator(email, d.agora()))) return "muitas";
      const segredo = decifrarSegredo(d.env, email, f.segredoCifrado);
      if (!segredo) return "invalido";
      const passo = conferirTotp(segredo, codigo, d.agora(), f.ultimoPasso);
      if (passo === null) return "invalido";
      return (await d.store.aceitarPasso(email, f.segredoCifrado, passo, d.agora())) ? "ok" : "invalido";
    },
  };
}

export type Login = ReturnType<typeof criarLogin>;
