import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { CodeStep, EmailStep } from "@/components/account/forms";
import { Container, PageHeader } from "@/components/page/page-header";
import { currentUser, safeReturn } from "@/lib/auth";
import { signOut } from "@/lib/account";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

type SP = Promise<{ volta?: string; etapa?: string; seguir?: string }>;

/** S20: e-mail → código de 6 números → volta para onde estava. Sem senha. */
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const volta = safeReturn(sp.volta);
  const seguir = sp.seguir && /^[a-z0-9-]{1,120}$/.test(sp.seguir) ? sp.seguir : undefined;
  const user = await currentUser();
  if (user)
    return (
      <Container>
        <PageHeader title="Você já entrou" lead={`Conectado como ${user.email}.`} />
        <div className="flex flex-wrap gap-3">
          <Link href="/acompanhando" className="inline-flex h-11 items-center rounded-pill bg-accent px-5 font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Ver quem eu acompanho
          </Link>
          <form action={signOut}>
            <button type="submit" className="inline-flex h-11 items-center rounded-pill border-[1.5px] border-border-input bg-surface px-5 font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus">
              Sair
            </button>
          </form>
        </div>
      </Container>
    );
  const pending = (await cookies()).get("otp_email")?.value;
  const codeStep = sp.etapa === "codigo" && pending;
  return (
    <Container>
      <PageHeader
        title={codeStep ? "Confira seu e-mail" : "Entrar"}
        lead={
          codeStep
            ? `Mandamos um código para ${pending}. Ele vale por 10 minutos.`
            : seguir
              ? "Entre com seu e-mail para acompanhar esta pessoa e receber as novidades dela."
              : "Acompanhe quem representa você e receba um resumo do que mudou. Sem senha: mandamos um código por e-mail."
        }
      />
      {codeStep ? <CodeStep volta={volta} seguir={seguir} /> : <EmailStep volta={volta} seguir={seguir} />}
      {codeStep && (
        <p className="mt-4 text-sm text-muted">
          Não chegou? Olhe o spam ou{" "}
          <Link href={`/entrar?volta=${encodeURIComponent(volta)}${seguir ? `&seguir=${seguir}` : ""}`} className="font-semibold text-accent-text underline underline-offset-2">
            peça outro código
          </Link>
          .
        </p>
      )}
    </Container>
  );
}
