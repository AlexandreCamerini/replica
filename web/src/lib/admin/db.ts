import "server-only";
import postgres from "postgres";
import { centralLiberada } from "./guarda.ts";
import { HOSTS_LOCAIS } from "./guarda-regra.ts";

// Pool PRÓPRIO da central (role `admin_central`, URL em ADMIN_DATABASE_URL). Nem `web_reader`, nem `web_writer`, nem o dono do banco.
// Não importa lib/data/pg.ts nem lib/db/writer.ts. Criado SOB DEMANDA, dentro da função: o `next build` do CI roda sem as variáveis e não pode tocar banco.
// O postgres.js é preguiçoso (só conecta na primeira consulta), mas mesmo assim nada é criado na importação do módulo.
type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __pgAdminCentral?: Sql };

export function sqlAdmin(): Sql {
  // defesa em profundidade: a guarda já barrou na camada de cima; aqui nem o pool se cria com a central fechada
  if (!centralLiberada()) throw new Error("central fechada");
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error("ADMIN_DATABASE_URL ausente");
  if (g.__pgAdminCentral) return g.__pgAdminCentral;
  const sql = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "admin_central", statement_timeout: 20000 },
  });
  // Defesa em profundidade (achado N1): confere o host que o DRIVER vai usar, não só o que a guarda leu da URL. Nada conectou ainda (o driver é preguiçoso).
  const hosts = (sql.options.host as unknown as (string | null)[] | undefined) ?? [];
  if (sql.options.path || hosts.length === 0 || !hosts.every((h) => typeof h === "string" && HOSTS_LOCAIS.has(h.toLowerCase().replace(/^\[(.*)\]$/, "$1")))) {
    void sql.end({ timeout: 0 });
    throw new Error("ADMIN_DATABASE_URL aponta para host não local");
  }
  return (g.__pgAdminCentral = sql);
}
