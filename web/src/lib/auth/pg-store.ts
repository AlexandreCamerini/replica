import type postgres from "postgres";
import { MAX_ATTEMPTS, MAX_SENDS_GLOBAL_PER_HOUR, MAX_SENDS_PER_HOUR, type PgStore } from "./pg-core.ts";

// Persistência do provedor `pg` (schema login, migração 0143; usuários em auth.users). Sem server-only: testável com um Postgres local.
export function pgStore(sql: postgres.Sql): PgStore {
  return {
    async issueCode(email, codeHash, nonceHash, nowMs) {
      const now = new Date(nowMs);
      // teto do site inteiro na última hora (todas as contas); a tabela só guarda o último dia, então a contagem é pequena
      const [g] = await sql`select count(*)::int as n from login.codes, unnest(sent_at) t where t > ${now}::timestamptz - interval '1 hour'`;
      if (Number(g.n) >= MAX_SENDS_GLOBAL_PER_HOUR) return "global";
      // LGPD: linha de e-mail que já não serve (código vencido há mais de um dia, fora da janela do limite) não fica guardada.
      // Antes do insert: se falhar, o código pendente do e-mail continua valendo.
      await sql`delete from login.codes where email <> ${email} and expires_at < ${now}::timestamptz - interval '1 day'`;
      const rows = await sql`
        insert into login.codes (email, code_hash, nonce_hash, expires_at, attempts, sent_at)
        values (${email}, ${codeHash}, ${nonceHash}, ${now}::timestamptz + interval '10 minutes', 0, array[${now}::timestamptz])
        on conflict (email) do update set
          code_hash = excluded.code_hash, nonce_hash = excluded.nonce_hash, expires_at = excluded.expires_at, attempts = 0,
          sent_at = array(select t from unnest(login.codes.sent_at) t where t > ${now}::timestamptz - interval '1 hour') || ${now}::timestamptz
        where (select count(*) from unnest(login.codes.sent_at) t where t > ${now}::timestamptz - interval '1 hour') < ${MAX_SENDS_PER_HOUR}
        returning 1`;
      return rows.length > 0 ? "ok" : "email";
    },
    async takeAttempt(email, nonceHash) {
      const [r] = await sql`
        update login.codes set attempts = attempts + 1
        where email = ${email} and nonce_hash = ${nonceHash} and nonce_hash <> '' and attempts < ${MAX_ATTEMPTS}
        returning code_hash, expires_at`;
      if (r) return { codeHash: String(r.code_hash), expiresAtMs: new Date(r.expires_at as string).getTime() };
      const [e] = await sql`select 1 as x from login.codes where email = ${email} and nonce_hash = ${nonceHash} and nonce_hash <> ''`;
      return e ? "too_many" : null;
    },
    async consumeCode(email, codeHash, nowMs) {
      const rows = await sql`
        update login.codes set code_hash = '', expires_at = ${new Date(nowMs)}::timestamptz
        where email = ${email} and code_hash = ${codeHash} and code_hash <> ''
        returning 1`;
      return rows.length > 0;
    },
    async upsertUser(email) {
      const [u] = await sql`
        insert into auth.users (id, email) values (gen_random_uuid(), ${email})
        on conflict (email) do update set email = excluded.email returning id`;
      return String(u.id);
    },
    async findUser(id) {
      const [r] = await sql`
        select u.id, u.email, extract(epoch from date_trunc('second', s.valido_desde))::bigint as valid_from
        from auth.users u left join login.sessoes_validas_desde s on s.user_id = u.id
        where u.id = ${id}::uuid`;
      return r ? { id: String(r.id), email: String(r.email), validFromSec: r.valid_from === null ? null : Number(r.valid_from) } : null;
    },
    async invalidateSessions(id, nowMs) {
      await sql`
        insert into login.sessoes_validas_desde (user_id, valido_desde) values (${id}::uuid, ${new Date(nowMs)}::timestamptz)
        on conflict (user_id) do update set valido_desde = greatest(login.sessoes_validas_desde.valido_desde, excluded.valido_desde)`;
    },
    async deleteUser(id, nowMs) {
      await sql.begin(async (tx) => {
        await tx`
          insert into login.sessoes_validas_desde (user_id, valido_desde) values (${id}::uuid, ${new Date(nowMs)}::timestamptz)
          on conflict (user_id) do update set valido_desde = greatest(login.sessoes_validas_desde.valido_desde, excluded.valido_desde)`;
        await tx`delete from login.codes where email = (select email from auth.users where id = ${id}::uuid)`; // LGPD
        await tx`delete from auth.users where id = ${id}::uuid`;
      });
    },
  };
}
