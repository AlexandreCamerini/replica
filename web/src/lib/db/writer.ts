import "server-only";
import postgres from "postgres";

// Conexão de escrita (role web_writer). Separada da de leitura: o leitor não escreve, o escritor não lê dado público.
const g = globalThis as unknown as { __pgWriter?: ReturnType<typeof postgres> };
export function writer() {
  const url = process.env.DATABASE_WRITE_URL;
  if (!url) throw new Error("DATABASE_WRITE_URL não definida (role web_writer)");
  return (g.__pgWriter ??= postgres(url, { max: Number(process.env.PG_WRITE_POOL_MAX ?? 5), idle_timeout: 20, connect_timeout: 10, prepare: false }));
}

/**
 * Executa como o usuário da sessão: `authenticated` + claim `sub`, para que as policies own_* do Postgres valham
 * (defesa em profundidade). Use para tudo que lê ou escreve dado de usuário.
 */
export async function asUser<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error("id de usuário inválido");
  return (await writer().begin(async (sql) => {
    await sql`select set_config('role', 'authenticated', true)`;
    await sql`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    return fn(sql);
  })) as T;
}
