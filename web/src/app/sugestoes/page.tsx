import type { Metadata } from "next";
import { SuggestionForm } from "@/components/account/forms";
import { Container, PageHeader } from "@/components/page/page-header";
import { data } from "@/lib/data";

export const metadata: Metadata = { title: "Sugerir ou corrigir" };

type SP = Promise<{ tipo?: string; p?: string; de?: string }>;
const TIPO: Record<string, string> = { erro: "algo_errado", falta: "informacao_faltando", fonte: "fonte_de_dados", ideia: "ideia" };

/** S25: ideia, dado que falta, erro ou fonte. "Reportar erro" no crachá chega aqui com a pessoa preenchida. */
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const slug = sp.p && /^[a-z0-9-]{1,120}$/.test(sp.p) ? sp.p : undefined;
  const person = slug ? await data.getPerson(slug) : null;
  return (
    <Container>
      <PageHeader
        title="Sugerir ou corrigir"
        lead="Viu um número errado, sabe onde um dado é publicado ou tem uma ideia? Conte aqui. Correções com fonte oficial entram no site com data e motivo."
      />
      <SuggestionForm
        kind={sp.tipo ? TIPO[sp.tipo] : undefined}
        person={person?.person.slug}
        personName={person?.person.displayName}
        page={person ? `/p/${person.person.slug}` : undefined}
      />
    </Container>
  );
}
