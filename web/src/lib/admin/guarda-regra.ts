// Regra pura da guarda de acesso da central (plano, seção 4a). A guarda real só chama `decidirAcesso` e responde 404.
// Ordem de verificação (a primeira que vale bloqueia):
//   1. ADMIN_CENTRAL diferente de "1" (valor exato)
//   2. VERCEL definida (qualquer valor, inclusive vazio)
//   3. VERCEL_ENV definida (idem)
//   4. ADMIN_DATABASE_URL ausente ou vazia
//   5. ADMIN_DATABASE_URL malformada
//   6. host fora de localhost, 127.0.0.1, ::1
// NODE_ENV não entra: `next start` local roda com production.

export type DecisaoAcesso = { liberada: boolean; motivo: string };

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1"]);

export function decidirAcesso(env: Record<string, string | undefined>): DecisaoAcesso {
  const nega = (motivo: string): DecisaoAcesso => ({ liberada: false, motivo });
  if (env.ADMIN_CENTRAL !== "1") return nega("ADMIN_CENTRAL não é 1");
  if (env.VERCEL !== undefined) return nega("VERCEL definida");
  if (env.VERCEL_ENV !== undefined) return nega("VERCEL_ENV definida");
  const url = env.ADMIN_DATABASE_URL;
  if (url === undefined || url.trim() === "") return nega("ADMIN_DATABASE_URL ausente");
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return nega("ADMIN_DATABASE_URL malformada");
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!HOSTS_LOCAIS.has(host)) return nega("host de ADMIN_DATABASE_URL não é local");
  return { liberada: true, motivo: "ligada, fora da Vercel, banco local" };
}
