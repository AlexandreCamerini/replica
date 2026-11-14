import type { Metadata } from "next";
import Link from "next/link";
import { DemoBanner } from "@/components/shell/bars";
import { CompareProvider } from "@/components/shell/compare";
import { AppFooter } from "@/components/shell/footer";
import { AppHeader } from "@/components/shell/header";
import { data } from "@/lib/data";

// Desenho anterior (design/v1/DIRECAO.md). Desde a D316 a entrada do site é a Direção 2; estas páginas seguem no ar no
// endereço de sempre enquanto a Direção 2 não cobre o que elas mostram (lista na D309). A antiga entrada (/) está em
// /no-seu-bolso e o antigo /acompanhando (conta) em /conta.
export const metadata: Metadata = {
  description: "O que estão decidindo em Brasília que mexe no seu bolso, com o texto oficial e sem opinião.",
};

export default async function V1Layout({ children }: { children: React.ReactNode }) {
  // "Pauta lida em" fica no cabeçalho de toda página (Regra 2): a hora da leitura nunca sai de vista.
  const readAt = await data.getPautaOverview().then((o) => o.week.readAt, () => null);
  return (
    <>
      <a href="#conteudo" className="sr-only z-50 bg-surface-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      <CompareProvider>
        <DemoBanner />
        <aside aria-label="Desenho anterior" className="border-b border-border bg-surface-sunken">
          <p className="mx-auto max-w-[1320px] px-4 py-2 text-sm text-fg md:px-6">
            Esta página é do desenho anterior do Segue o Voto.{" "}
            <Link href="/" className="font-semibold underline underline-offset-2">
              Ir para a página inicial nova
            </Link>
          </p>
        </aside>
        <AppHeader readAt={readAt} />
        <main id="conteudo" tabIndex={-1} className="pb-16 outline-none">
          {children}
        </main>
        <AppFooter />
      </CompareProvider>
    </>
  );
}
