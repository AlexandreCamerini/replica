import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeleteAccountForm, DigestForm } from "@/components/account/forms";
import { Container, PageHeader } from "@/components/page/page-header";
import { signOut } from "@/lib/account";
import { currentUser } from "@/lib/auth";
import { data } from "@/lib/data";
import { myFollows } from "@/lib/follows";
import { date } from "@/lib/format";

export const metadata: Metadata = { title: "Acompanhando", robots: { index: false } };

const KIND: Record<string, string> = { voto: "votou", proposta: "apresentou", gasto: "gasto do gabinete" };

/** S21: novidades de quem a pessoa acompanha (votos, propostas e gastos dos últimos meses), preferências e conta. */
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/entrar?volta=/acompanhando");
  const { digest, people } = await myFollows(user.id);
  const feed = await data.getActivity(people.map((p) => p.id), 60);
  return (
    <Container>
      <PageHeader title="Acompanhando" lead={`Conectado como ${user.email}.`} />
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="novidades-h">
          <h2 id="novidades-h" className="mb-3 text-xl text-fg">
            Novidades
          </h2>
          {people.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-input bg-surface p-6 text-sm text-fg">
              <p className="font-semibold">Você ainda não acompanha ninguém.</p>
              <p className="mt-1 text-muted">Abra o crachá de alguém e toque em “Acompanhar”. As novidades aparecem aqui.</p>
              <Link href="/representantes" className="mt-3 inline-block font-semibold text-accent-text underline underline-offset-2">
                Ver quem representa a sua cidade
              </Link>
            </div>
          ) : feed.length === 0 ? (
            <p className="rounded-md bg-surface-sunken px-4 py-6 text-sm text-muted">Nada novo nos últimos meses para quem você acompanha. Quem tem câmara sem dado aberto só aparece quando a fonte publicar.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
              {feed.map((a, i) => (
                <li key={`${a.href}-${a.personSlug}-${i}`} className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="text-xs text-muted">
                    <time dateTime={a.occurredAt}>{date(a.occurredAt)}</time> ·{" "}
                    <Link href={`/p/${a.personSlug}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                      {a.personName}
                    </Link>{" "}
                    {KIND[a.kind]}
                    {a.kind === "voto" && a.detail ? ` “${a.detail}”` : ""}
                  </span>
                  <Link href={a.href} className="text-sm text-fg underline-offset-2 hover:underline">
                    {a.title}
                    {a.kind !== "voto" && a.detail ? ` — ${a.detail}` : ""}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
        <aside className="flex flex-col gap-6">
          <section aria-labelledby="pessoas-h" className="rounded-md border border-border bg-surface p-4">
            <h2 id="pessoas-h" className="mb-2 text-lg text-fg">
              Quem eu acompanho <span className="text-sm tabular text-muted">{people.length} de 200</span>
            </h2>
            {people.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/p/${p.slug}`} className="text-fg underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ninguém ainda.</p>
            )}
          </section>
          <section aria-labelledby="email-h" className="rounded-md border border-border bg-surface p-4">
            <h2 id="email-h" className="sr-only">
              E-mail
            </h2>
            <DigestForm value={digest ?? "weekly"} />
          </section>
          <section aria-labelledby="conta-h" className="rounded-md border border-border bg-surface p-4">
            <h2 id="conta-h" className="mb-2 text-lg text-fg">
              Conta
            </h2>
            <form action={signOut} className="mb-4">
              <button type="submit" className="inline-flex h-10 items-center rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus">
                Sair de todos os aparelhos
              </button>
            </form>
            <DeleteAccountForm />
          </section>
        </aside>
      </div>
    </Container>
  );
}
