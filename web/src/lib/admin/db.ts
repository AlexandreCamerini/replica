import "server-only";
import postgres from "postgres";
import { centralLiberada } from "./guarda.ts";

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
  return (g.__pgAdminCentral ??= postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "admin_central", statement_timeout: 20000 },
  }));
}
