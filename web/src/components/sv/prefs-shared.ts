// Preferências do leitor (D2 §0.3): UF e esferas. Funções puras, sem Next: valem no servidor, no cliente e em teste.
// Nunca há UF padrão: sem cookie válido, o estado é "sem estado escolhido" (uf = null).
export const UF_COOKIE = "sv_uf";
export const ESFERAS_COOKIE = "sv_esferas";
export const PREFS_MAX_AGE = 60 * 60 * 24 * 365;

/** Texto obrigatório onde a escolha é feita. */
export const COOKIE_TEXTO = "A escolha fica guardada num cookie neste navegador. O servidor lê esse cookie para montar a página. Não criamos conta.";

/** Federal (Câmara e Senado) é sempre ligado e não entra aqui. Estadual: ligado por padrão. Municipal: desligado por padrão. */
export type Esferas = { estadual: boolean; municipal: boolean; cidade: string | null };
export const ESFERAS_PADRAO: Readonly<Esferas> = Object.freeze({ estadual: true, municipal: false, cidade: null });

export type Prefs = {
  /** null = sem estado escolhido */
  uf: { sigla: string; nome: string; ibge: string } | null;
  esferas: Esferas;
  /** true quando não há cookie de esferas e valem os padrões */
  esferasPadrao: boolean;
  /**
   * true quando há cookie de UF, mas a lista de UFs não pôde ser lida: `uf` fica null e a tela diz que não conseguiu
   * ler, em vez de convidar a "Escolha seu estado" quem já escolheu.
   */
  ufFalhou?: boolean;
};

const SIGLA = /^[A-Z]{2}$/;
const CIDADE = /^\d{7}$/;

/** Sigla do cookie, validada contra a lista de UFs do contrato (`data.listUfs()`). Inválida ou ausente: null. */
export function parseUf(raw: string | string[] | null | undefined, validas: readonly string[]): string | null {
  // só string: `?uf=SP&uf=RJ` chega como array e é ignorado (nunca lança)
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return SIGLA.test(s) && validas.includes(s) ? s : null;
}

/** Cidade IBGE de 7 dígitos; o prefixo de 2 dígitos tem de ser o da UF quando ele é conhecido. */
export function parseCidade(raw: string | null | undefined, ufIbge?: string | null): string | null {
  const s = (raw ?? "").trim();
  if (!CIDADE.test(s)) return null;
  if (ufIbge && /^\d{2}$/.test(ufIbge) && !s.startsWith(ufIbge)) return null;
  return s;
}

/**
 * Cookie de esferas: "e1.m0" ou "e1.m1.c3509502". O desligado é explícito (e0/m0): cookie ausente = padrão, não "tudo desligado".
 * Malformado: padrão.
 */
export function parseEsferas(raw: string | null | undefined): Esferas | null {
  if (!raw) return null;
  let v: string;
  try {
    v = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  const m = /^e([01])\.m([01])(?:\.c(\d{7}))?$/.exec(v);
  if (!m) return null;
  return { estadual: m[1] === "1", municipal: m[2] === "1", cidade: m[3] ?? null };
}

export function serializeEsferas(e: Esferas): string {
  const c = e.cidade && CIDADE.test(e.cidade) ? `.c${e.cidade}` : "";
  return `e${e.estadual ? 1 : 0}.m${e.municipal ? 1 : 0}${c}`;
}

/** Destino de volta depois de gravar: só caminhos do /v2, sem "//" (sem redirecionamento aberto). */
export function voltarSeguro(raw: unknown, padrao = "/v2/ajustes"): string {
  if (typeof raw !== "string") return padrao;
  const s = raw.trim();
  if (!/^\/v2(?:[/?#]|$)/.test(s) || s.includes("//") || s.includes("\\") || /[\u0000-\u001f]/.test(s)) return padrao;
  return s;
}
