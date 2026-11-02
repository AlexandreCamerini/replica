import { Construction } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "./page-header";

/** Tela no inventário (recon S-ID) que ainda não foi construída. Diz quando entra, não finge conteúdo. */
export function StubPage({ id, title, purpose, release }: { id: string; title: string; purpose: string; release: string }) {
  return (
    <>
      <PageHeader title={title} lead={purpose} />
      <section className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border-input bg-surface p-6">
        <Construction aria-hidden className="size-6 text-muted" />
        <p className="text-base text-fg">Esta seção ainda está sendo construída.</p>
        <p className="font-mono text-xs text-muted">
          {id} · entra no {release}
        </p>
        <Link href="/representantes" className="text-sm font-semibold text-accent-text underline underline-offset-2">
          Enquanto isso, veja quem representa a sua cidade
        </Link>
      </section>
    </>
  );
}
