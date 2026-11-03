import type { Metadata } from "next";
import { SuggestionForm } from "@/components/account/forms";
import { Container, PageHeader } from "@/components/page/page-header";
import { data } from "@/lib/data";

export const metadata: Metadata = { title: "Sugerir ou corrigir" };

type SP = Promise<{ tipo?: string; p?: string; de?: string }>;
const TIPO: Record<string, string> = { erro: "algo_errado", falta: "informacao_faltando", fonte: "fonte_de_dados", dado: "fonte_de_dados", ideia: "ideia", resposta: "direito_resposta" };

/** S25: ideia, dado que falta, erro ou fonte. "Reportar erro" no crachá chega aqui com a pessoa preenchida. */
export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const slug = sp.p && /^[a-z0-9-]{1,120}$/.test(sp.p) ? sp.p : undefined;
  const person = slug ? await data.getPerson(slug) : null;
  const resposta = sp.tipo === "resposta";
  return (
    <Container>
      <PageHeader
        title={resposta && person ? "Direito de resposta" : "Sugerir ou corrigir"}
        lead={
          resposta && person
            ? "Conte o que você contesta e, se puder, mande o link da fonte oficial. A mensagem fica guardada com a data e a página da pessoa. Como tratamos o pedido está em Metodologia e fontes."
            : "Viu um número errado, sabe onde um dado é publicado ou tem uma ideia? Conte aqui. Correções com fonte oficial entram no site com data e motivo."
        }
      />
      {resposta && !person && (
        <p className="mb-4 max-w-xl rounded-sm bg-warning-soft px-3 py-2 text-sm text-fg">
          O direito de resposta é sobre uma pessoa. Abra a página dela e use o link no fim, ou conte aqui o que está errado e quem é a pessoa.
        </p>
      )}
      <SuggestionForm
        kind={resposta && !person ? undefined : sp.tipo ? TIPO[sp.tipo] : undefined}
        person={person?.person.slug}
        personName={person?.person.displayName}
        page={person ? `/p/${person.person.slug}` : undefined}
      />
    </Container>
  );
}
