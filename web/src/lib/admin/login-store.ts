import type postgres from "postgres";
import type { LoginStore } from "./login-core.ts";

// Persistência do login da central (schema login, migração 0157), pelo pool do `admin_central`. Sem server-only: testável com um Postgres local.
// Cada método é uma instrução SQL: os limites (envios por hora, tentativas, passo já usado) são decididos pelo banco, não por ler e depois gravar.
export function loginStore(sql: postgres.Sql): LoginStore {
  return {
    async emitirCodigo(email, hash, nonceHash, agoraMs) {
      const agora = new Date(agoraMs);
      const linhas = await sql`
        insert into login.central_codigos (email, code_hash, nonce_hash, expires_at, attempts, sent_at)
        values (${email}, ${hash}, ${nonceHash}, ${agora}::timestamptz + interval '10 minutes', 0, array[${agora}::timestamptz])
        on conflict (email) do update set
          code_hash = excluded.code_hash, nonce_hash = excluded.nonce_hash, expires_at = excluded.expires_at, attempts = 0,
          sent_at = array(select t from unnest(login.central_codigos.sent_at) t where t > ${agora}::timestamptz - interval '1 hour') || ${agora}::timestamptz
        where (select count(*) from unnest(login.central_codigos.sent_at) t where t > ${agora}::timestamptz - interval '1 hour') < 3
        returning 1`;
      return linhas.length > 0;
    },
    async tentarCodigo(email, nonceHash) {
      const [r] = await sql`
        update login.central_codigos set attempts = attempts + 1
        where email = ${email} and nonce_hash = ${nonceHash} and nonce_hash <> '' and attempts < 5
        returning code_hash, expires_at`;
      return r ? { hash: String(r.code_hash), expiraMs: new Date(r.expires_at as string).getTime() } : null;
    },
    async consumirCodigo(email, hash, agoraMs) {
      const linhas = await sql`
        update login.central_codigos set code_hash = '', expires_at = ${new Date(agoraMs)}::timestamptz
        where email = ${email} and code_hash = ${hash} and code_hash <> ''
        returning 1`;
      return linhas.length > 0;
    },
    async fator(email) {
      const [r] = await sql`select segredo_cifrado, verificado_em is not null as verificado, ultimo_passo from login.central_fatores where email = ${email}`;
      return r ? { segredoCifrado: String(r.segredo_cifrado), verificado: r.verificado === true, ultimoPasso: r.ultimo_passo === null ? null : Number(r.ultimo_passo) } : null;
    },
    async gravarFatorNovo(email, segredoCifrado, agoraMs) {
      const agora = new Date(agoraMs);
      // As tentativas NÃO zeram ao recomeçar o cadastro: senão cada recomeço daria cinco palpites novos.
      const linhas = await sql`
        insert into login.central_fatores (email, segredo_cifrado, criado_em) values (${email}, ${segredoCifrado}, ${agora}::timestamptz)
        on conflict (email) do update set segredo_cifrado = excluded.segredo_cifrado, criado_em = excluded.criado_em, ultimo_passo = null
        where login.central_fatores.verificado_em is null
        returning 1`;
      return linhas.length > 0;
    },
    async tentarFator(email, agoraMs) {
      const agora = new Date(agoraMs);
      const linhas = await sql`
        update login.central_fatores set
          tentativas = case when tentativas_desde is null or tentativas_desde <= ${agora}::timestamptz - interval '15 minutes' then 1 else tentativas + 1 end,
          tentativas_desde = case when tentativas_desde is null or tentativas_desde <= ${agora}::timestamptz - interval '15 minutes' then ${agora}::timestamptz else tentativas_desde end
        where email = ${email}
          and (tentativas_desde is null or tentativas_desde <= ${agora}::timestamptz - interval '15 minutes' or tentativas < 5)
        returning 1`;
      return linhas.length > 0;
    },
    async aceitarPasso(email, segredoCifrado, passo, agoraMs) {
      const linhas = await sql`
        update login.central_fatores set
          ultimo_passo = ${passo}, verificado_em = coalesce(verificado_em, ${new Date(agoraMs)}::timestamptz), tentativas = 0, tentativas_desde = null
        where email = ${email} and segredo_cifrado = ${segredoCifrado} and (ultimo_passo is null or ultimo_passo < ${passo})
        returning 1`;
      return linhas.length > 0;
    },
  };
}

/** Início de validade das sessões de nível 2 do e-mail: o maior entre o instante em que o fator atual foi verificado e `sessoes_desde` (revogação pelo dono), em epoch (s, arredondado PARA CIMA: uma sessão do mesmo segundo da revogação não vale); `null` = sem fator verificado. */
export async function fatorVerificadoDesde(sql: postgres.Sql, email: string): Promise<number | null> {
  const [r] = await sql`select greatest(extract(epoch from date_trunc('second', verificado_em))::bigint, coalesce(ceil(extract(epoch from sessoes_desde))::bigint, 0)) as desde from login.central_fatores where email = ${email} and verificado_em is not null`;
  return r ? Number(r.desde) : null;
}

/** "Sair" (0158): as sessões de nível 2 do e-mail, em qualquer aparelho, deixam de valer a partir de agora. Sem fator cadastrado não há o que revogar (nível 1 vence em 15 min). */
export async function revogarSessoes(sql: postgres.Sql, email: string): Promise<void> {
  await sql`update login.central_fatores set sessoes_desde = clock_timestamp() where email = ${email}`;
}
