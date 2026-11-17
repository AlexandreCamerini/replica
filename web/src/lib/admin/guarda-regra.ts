// Regra pura da guarda de acesso da central (plano, seção 4a). A guarda real só chama `decidirAcesso` e responde 404.
// Ordem de verificação (a primeira que vale bloqueia):
//   1. ADMIN_CENTRAL diferente de "1" (valor exato)
//   2. VERCEL definida (qualquer valor, inclusive vazio)
//   3. VERCEL_ENV definida (idem)
//   4. ADMIN_DATABASE_URL ausente ou vazia
//   5. ADMIN_DATABASE_URL malformada
//   6. host fora de localhost, 127.0.0.1, ::1
//   7. protocolo diferente de postgres:/postgresql:, vírgula no authority (vários hosts) ou parâmetro de query `host`, `hostaddr`, `service`
//      (o driver `postgres` usa o `host` da query antes do host da URL: a checagem do hostname sozinha não basta)
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
  let u: URL;
  try {
    u = new URL(url);
    host = u.hostname.toLowerCase();
  } catch {
    return nega("ADMIN_DATABASE_URL malformada");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return nega("ADMIN_DATABASE_URL com protocolo que não é postgres");
  const authority = url.trim().replace(/^[^:]*:\/\//, "").split(/[/?#]/)[0] ?? "";
  if (authority.slice(authority.lastIndexOf("@") + 1).includes(",")) return nega("ADMIN_DATABASE_URL com mais de um host");
  for (const k of u.searchParams.keys()) {
    if (["host", "hostaddr", "service"].includes(k.toLowerCase())) return nega("ADMIN_DATABASE_URL com host na query");
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!HOSTS_LOCAIS.has(host)) return nega("host de ADMIN_DATABASE_URL não é local");
  return { liberada: true, motivo: "ligada, fora da Vercel, banco local" };
}

/**
 * O cabeçalho Host da requisição é local? (`localhost`, `127.0.0.1`, `[::1]`, com ou sem porta, qualquer caixa.) Barra DNS rebinding: um nome externo que
 * resolve para 127.0.0.1 chega aqui com o Host do atacante. Ausente ou vazio = não é local.
 */
export function hostDeRequisicaoLocal(host: string | null | undefined): boolean {
  if (host === null || host === undefined) return false;
  const m = host.trim().toLowerCase().match(/^(\[[0-9a-f:.]+\]|[^:\[\]]+)(?::\d+)?$/);
  if (m === null) return false;
  const nome = m[1].startsWith("[") ? m[1].slice(1, -1) : m[1];
  return HOSTS_LOCAIS.has(nome);
}
