// Quem a pessoa acompanha fica num cookie deste navegador: uma lista de slugs, sem conta e sem gravação em banco.
// O servidor lê o cookie só para montar a página; a escolha não é registrada.
export const FOLLOW_COOKIE = "sv_sigo";
export const FOLLOW_MAX = 12;
/**
 * Caminho do cookie. Era "/v2" enquanto a Direção 2 era protótipo; com ela na raiz (D316) o cookie vale no site inteiro.
 * Pessoas em quem o leitor diz ter votado são dado sensível: o cookie é só deste navegador e nenhuma rota o grava em banco.
 */
export const FOLLOW_PATH = "/";
/** Caminho antigo (protótipo): a rota /v2 junta essa lista à da raiz e apaga a cópia que ficou lá. */
export const FOLLOW_PATH_ANTIGO = "/v2";

const SLUG = /^[a-z0-9-]{1,120}$/;

export function parseFollows(raw: string | undefined | null): string[] {
  if (!raw || typeof raw !== "string") return [];
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return []; // cookie malformado (ex.: "%E0"): lista vazia, nunca erro 500
  }
  const seen = new Set<string>();
  for (const s of decoded.split(".")) if (SLUG.test(s)) seen.add(s);
  return [...seen].slice(0, FOLLOW_MAX);
}

export const serializeFollows = (slugs: string[]) => slugs.slice(0, FOLLOW_MAX).join(".");
