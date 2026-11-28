import "server-only";
import postgres from "postgres";
import { centralLiberada, decidirAcesso, HOSTS_LOCAIS, SSLMODES_ACEITOS } from "./guarda-regra.ts";

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
    // Quem usa a central é uma pessoa só, mas cada instância serverless abre o próprio pool no MESMO banco do site (Supabase, max_connections 60). Pool pequeno e ocioso curto
    // devolvem a conexão logo: em 28/11/2026 uma rajada de instâncias esgotou o banco (SQLSTATE 53300) e a conferência de identidade virou 404 no login.
    max: 2,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "admin_central", statement_timeout: 20000 },
  });
  // Defesa em profundidade (achado N1): confere o host que o DRIVER vai usar, não só o que a guarda leu da URL. Nada conectou ainda (o driver é preguiçoso).
  // Modo local: só host local. Modo produção: qualquer host, mas o driver tem de ter exatamente UM host (sem socket, sem lista) e TLS (`ssl` require, verify-ca ou verify-full).
  const modo = decidirAcesso(process.env).modo;
  const hosts = (sql.options.host as unknown as (string | null)[] | undefined) ?? [];
  const tira = (h: string): string => h.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const hostsOk =
    modo === "local"
      ? hosts.length > 0 && hosts.every((h) => typeof h === "string" && HOSTS_LOCAIS.has(tira(h)))
      : modo === "producao" && hosts.length === 1 && typeof hosts[0] === "string" && hosts[0] !== "" && SSLMODES_ACEITOS.includes(String(sql.options.ssl));
  if (sql.options.path || !hostsOk) {
    void sql.end({ timeout: 0 });
    throw new Error(modo === "producao" ? "ADMIN_DATABASE_URL: host ou TLS não aceito" : "ADMIN_DATABASE_URL aponta para host não local");
  }
  return (g.__pgAdminCentral = sql);
}
