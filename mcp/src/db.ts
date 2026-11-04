import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/** URL local de desenvolvimento; em qualquer outro lugar, defina CIVICO_DATABASE_URL. */
export const DEFAULT_URL = "postgres://web_reader:web_reader@localhost:54329/civico";

/**
 * Cliente somente leitura. Três travas: (1) o usuário da URL precisa ser `web_reader`;
 * (2) a sessão abre com `default_transaction_read_only = on`; (3) `statement_timeout` por consulta.
 * Nunca escreva em stdout: no transporte stdio ele é o canal do protocolo (use console.error).
 */
export function connect(url = process.env.CIVICO_DATABASE_URL ?? DEFAULT_URL, timeoutMs = Number(process.env.CIVICO_QUERY_TIMEOUT_MS ?? 8000)): Sql {
  const user = decodeURIComponent(new URL(url).username);
  if (!/^web_reader(\.|$)/.test(user)) throw new Error("civico-mcp só aceita a role de leitura `web_reader` (a URL usa outra).");
  return postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    transform: { undefined: null },
    connection: { statement_timeout: timeoutMs, default_transaction_read_only: true, application_name: "civico-mcp" },
  });
}

/** Confere no servidor que a sessão é mesmo a role de leitura e não consegue escrever. */
export async function assertReadOnly(sql: Sql): Promise<void> {
  const [r] = await sql`select current_user as u, current_setting('transaction_read_only') as ro`;
  if (!/^web_reader/.test(String(r.u)) || r.ro !== "on") throw new Error(`sessão não é somente leitura (usuário ${r.u}, read_only=${r.ro})`);
}
