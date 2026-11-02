"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth, currentUser, safeReturn } from "@/lib/auth";
import { verifyCaptcha } from "@/lib/captcha";
import { data } from "@/lib/data";
import { asUser, writer } from "@/lib/db/writer";

// Server actions de conta, acompanhamento e sugestões. Toda entrada é validada aqui (zod); nada confia no cliente.
export type FormState = { ok?: boolean; error?: string; fields?: Record<string, string> };

const OTP_COOKIE = "otp_email"; // e-mail entre as duas etapas: cookie http-only, nunca na URL
const email = z.string().trim().toLowerCase().max(254).email("Confira o e-mail: falta algo no endereço.");

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function sendCode(_: FormState, form: FormData): Promise<FormState> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields: { email: String(form.get("email") ?? "") } };
  if (form.get("consent") !== "on") return { error: "Para receber o código, marque que concorda com o uso do e-mail.", fields: { email: parsed.data } };
  if (!(await verifyCaptcha(form.get("cf-turnstile-response") as string | null, await clientIp())))
    return { error: "Não deu para confirmar que você não é um robô. Tente de novo.", fields: { email: parsed.data } };
  const r = await (await auth()).sendCode(parsed.data, (form.get("cf-turnstile-response") as string | null) ?? null);
  if (!r.ok) {
    const msg = r.reason === "rate_limited" ? "Muitos códigos pedidos para este e-mail. Espere alguns minutos." : r.reason === "captcha" ? "A verificação anti-robô falhou. Tente de novo." : "O envio está fora do ar agora. Tente de novo em instantes.";
    return { error: msg, fields: { email: parsed.data } };
  }
  const jar = await cookies();
  jar.set(OTP_COOKIE, parsed.data, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/entrar", maxAge: 15 * 60 });
  const volta = safeReturn(form.get("volta"));
  const seguir = String(form.get("seguir") ?? "");
  redirect(`/entrar?etapa=codigo&volta=${encodeURIComponent(volta)}${/^[a-z0-9-]{1,120}$/.test(seguir) ? `&seguir=${seguir}` : ""}`);
}

export async function verifyCode(_: FormState, form: FormData): Promise<FormState> {
  const jar = await cookies();
  const addr = jar.get(OTP_COOKIE)?.value;
  if (!addr) return { error: "O pedido de código expirou. Peça um novo." };
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "O código tem 6 números." };
  const r = await (await auth()).verifyCode(addr, code);
  if (!r.ok) {
    const msg = r.reason === "expired" ? "Esse código venceu. Peça um novo." : r.reason === "too_many" ? "Tentativas demais. Peça um novo código." : r.reason === "unavailable" ? "O login está fora do ar agora." : "Código errado. Confira o último e-mail que mandamos.";
    return { error: msg };
  }
  jar.delete({ name: OTP_COOKIE, path: "/entrar" });
  await asUser(r.user.id, (sql) => sql`insert into profiles (id, consented_at) values (${r.user.id}, now()) on conflict (id) do nothing`);
  const seguir = String(form.get("seguir") ?? "");
  if (/^[a-z0-9-]{1,120}$/.test(seguir)) await followSlug(r.user.id, seguir).catch(() => {});
  redirect(safeReturn(form.get("volta")));
}

export async function signOut() {
  await (await auth()).signOut();
  redirect("/");
}

async function followSlug(userId: string, slug: string) {
  const p = await data.getPerson(slug);
  if (!p) throw new Error("pessoa não encontrada");
  await asUser(userId, (sql) => sql`insert into follows (user_id, person_id) values (${userId}, ${p.person.id}) on conflict (user_id, person_id) do nothing`);
  return p.person;
}

export async function toggleFollow(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  const slug = String(form.get("slug") ?? "");
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return { error: "Pessoa inválida." };
  if (!user) redirect(`/entrar?volta=${encodeURIComponent(`/p/${slug}`)}&seguir=${slug}`);
  const p = await data.getPerson(slug);
  if (!p) return { error: "Pessoa não encontrada." };
  try {
    if (form.get("acao") === "parar") await asUser(user.id, (sql) => sql`delete from follows where user_id = ${user.id} and person_id = ${p.person.id}`);
    else await followSlug(user.id, slug);
  } catch (e) {
    if (String((e as Error).message).includes("follow_limit_reached")) return { error: "Você já acompanha 200 pessoas, o máximo. Deixe de acompanhar alguém primeiro." };
    console.error("[follow]", e);
    return { error: "Não deu para salvar agora. Tente de novo." };
  }
  revalidatePath(`/p/${slug}`);
  revalidatePath("/acompanhando");
  return { ok: true };
}

export async function updateDigest(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/entrar?volta=/acompanhando");
  const v = z.enum(["daily", "weekly", "off"]).safeParse(form.get("digest"));
  if (!v.success) return { error: "Escolha uma das opções." };
  await asUser(user.id, (sql) => sql`update profiles set digest = ${v.data}, updated_at = now() where id = ${user.id}`);
  revalidatePath("/acompanhando");
  return { ok: true };
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  if (String(form.get("confirmar") ?? "").trim().toUpperCase() !== "APAGAR") return { error: "Digite APAGAR para confirmar." };
  await (await auth()).deleteUser(user.id); // profiles, follows e digests caem em cascata
  redirect("/?conta=apagada");
}

// ---------- sugestões (S25) ----------
const suggestion = z.object({
  kind: z.enum(["ideia", "informacao_faltando", "algo_errado", "fonte_de_dados", "outro"], { message: "Escolha o tipo da mensagem." }),
  body: z.string().trim().min(5, "Escreva pelo menos 5 caracteres.").max(5000, "No máximo 5.000 caracteres."),
  name: z.string().trim().min(1, "Diga como podemos chamar você.").max(120),
  email,
  city: z.string().trim().max(120).optional().transform((v) => v || null),
  person: z.string().regex(/^[a-z0-9-]{1,120}$/).optional().or(z.literal("")),
  page: z.string().max(300).optional(),
});

export async function submitSuggestion(_: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(["kind", "body", "name", "email", "city", "person", "page"].map((k) => [k, String(form.get(k) ?? "")]));
  const fields = { ...raw };
  if (String(form.get("website") ?? "")) return { ok: true }; // honeypot: robô preencheu o campo invisível
  const parsed = suggestion.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };
  const ip = await clientIp();
  if (!(await verifyCaptcha(form.get("cf-turnstile-response") as string | null, ip))) return { error: "Não deu para confirmar que você não é um robô.", fields };
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = createHash("sha256").update(`${process.env.SESSION_SECRET ?? "sal"}:${day}:${ip ?? "?"}`).digest("hex");
  const sql = writer();
  const [{ n }] = await sql`select count(*)::int as n from suggestions where ip_hash = ${ipHash} and created_at > now() - interval '1 hour'`;
  if (Number(n) >= 5) return { error: "Recebemos várias mensagens daqui na última hora. Tente mais tarde.", fields };
  const person = parsed.data.person ? await data.getPerson(parsed.data.person) : null;
  const page = parsed.data.page && /^\/(?![/\\])/.test(parsed.data.page) ? parsed.data.page : null;
  await sql`insert into suggestions (kind, body, name, email, city, person_id, page_path, ip_hash)
            values (${parsed.data.kind}, ${parsed.data.body}, ${parsed.data.name}, ${parsed.data.email}, ${parsed.data.city}, ${person?.person.id ?? null}, ${page}, ${ipHash})`;
  return { ok: true };
}
