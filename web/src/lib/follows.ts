import "server-only";
import { asUser } from "@/lib/db/writer";

// Leituras do usuário. Fora do arquivo "use server": toda função exportada de lá vira endpoint chamável pelo cliente.
export async function isFollowing(userId: string, personId: string) {
  const [r] = await asUser(userId, (sql) => sql`select 1 from follows where user_id = ${userId} and person_id = ${personId}`);
  return Boolean(r);
}

export async function myFollows(userId: string) {
  return asUser(userId, async (sql) => {
    const [profile] = await sql`select digest from profiles where id = ${userId}`;
    const rows = await sql`select p.id, p.slug, p.display_name from follows f join people p on p.id = f.person_id where f.user_id = ${userId} order by p.display_name collate pt_br`;
    return { digest: (profile?.digest as "daily" | "weekly" | "off" | undefined) ?? null, people: rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.display_name) })) };
  });
}
