import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { data } from "@/lib/data";
import { date } from "@/lib/format";

export async function DataFreshnessBar() {
  const at = await data.latestRefresh();
  return (
    <div className="border-b border-border bg-surface-sunken">
      <p className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-2 px-4 py-1.5 text-xs text-muted md:px-6">
        <span>
          Dados oficiais conferidos em <time dateTime={at}>{date(at)}</time>
        </span>
        <span aria-hidden>·</span>
        <Link href="/sobre#atualizacao" className="font-semibold text-fg underline underline-offset-2">
          Como atualizamos
        </Link>
      </p>
    </div>
  );
}

/** Some quando a camada real entra. Deixa claro que nada aqui é sobre pessoa real. */
export function DemoBanner() {
  if (!data.isDemo) return null;
  return (
    <div role="note" className="bg-warning-soft">
      <p className="mx-auto flex max-w-[1200px] items-start gap-2 px-4 py-2 text-sm text-fg md:px-6">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          <strong>Versão de demonstração.</strong> Pessoas, partidos e números são fictícios. Lugares e número de cadeiras são reais.
        </span>
      </p>
    </div>
  );
}
