// Quem a pessoa acompanha fica num cookie deste navegador: uma lista de slugs, sem conta e sem gravação em banco.
// O servidor lê o cookie só para montar a página; a escolha não é registrada.
export const FOLLOW_COOKIE = "sv_sigo";
export const FOLLOW_MAX = 12;

const SLUG = /^[a-z0-9-]{1,120}$/;

export function parseFollows(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const s of decodeURIComponent(raw).split(".")) if (SLUG.test(s)) seen.add(s);
  return [...seen].slice(0, FOLLOW_MAX);
}

export const serializeFollows = (slugs: string[]) => slugs.slice(0, FOLLOW_MAX).join(".");
