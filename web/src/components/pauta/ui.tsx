import Link from "next/link";
import type { PautaEntry, PautaRead } from "@/lib/data";
import { bodyName, dateTime, dayShort, isStale, label, reasonText, typeName } from "@/lib/pauta";

/** Estado de revisão da Regra 3. Enquanto não houver revisão, a página mostra só o resumo e o texto oficial. */
export function ReviewBadge() {
  return (
    <span className="inline-flex h-6 items-center rounded-pill bg-surface-sunken px-2.5 text-xs font-semibold text-muted">Aguardando revisão</span>
  );
}

export function where(e: Pick<PautaEntry, "body" | "stage" | "committee">) {
  return e.stage === "plenario" ? `${bodyName(e.body)} · Plenário` : `${bodyName(e.body)} · Comissão${e.committee ? ` ${e.committee}` : ""}`;
}

/** Um item da pauta. Sem resumo revisado ainda: o texto mostrado é o resumo oficial (ementa), rotulado. */
export function PautaCard({ e, note, showDay = true }: { e: PautaEntry; note?: string; showDay?: boolean }) {
  return (
    <li className="rounded-md border border-border bg-surface">
      <Link
        href={`/proposta/${e.key}`}
        className="flex flex-col gap-2 rounded-md p-4 outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="font-mono text-xs uppercase tracking-wide text-muted">
          {where(e)}
          {showDay && ` · ${dayShort(e.scheduledFor)}`}
        </span>
        <span className="text-base font-semibold text-fg">
          {label(e)} <span className="font-normal text-muted">· {typeName(e.type)}</span>
        </span>
        <span className="line-clamp-3 text-sm text-fg">
          <span className="text-muted">Resumo oficial: </span>
          {e.summary ?? "A pauta da comissão não traz o resumo oficial."}
        </span>
        <span className="text-xs text-muted">{reasonText(e)}</span>
        {note ? <span className="text-sm text-fg">{note}</span> : <ReviewBadge />}
      </Link>
    </li>
  );
}

/** "Pauta lida em" sempre junto do número (Regra 2), com os avisos de sistema de leitura velha ou incompleta. */
export function ReadStamp({ readAt, reads }: { readAt: string | null; reads: Record<"camara" | "senado", PautaRead> }) {
  const failed = reads.camara.failed + reads.senado.failed;
  const stale = isStale(readAt);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted">
        {readAt ? (
          <>
            Pauta lida em <time dateTime={readAt}>{dateTime(readAt)}</time>
          </>
        ) : (
          "A pauta ainda não foi lida."
        )}
        {" · "}
        <Link href="/como-escolhemos" className="underline underline-offset-2 hover:text-fg">
          Como escolhemos
        </Link>
      </p>
      {stale && readAt && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-fg">
          Pauta não atualizada desde {dateTime(readAt)}.
        </p>
      )}
      {failed > 0 && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-fg">
          {failed === 1 ? "1 pauta não carregou" : `${failed} pautas não carregaram`}. O número pode ser maior. Tentamos de novo na próxima leitura.
        </p>
      )}
    </div>
  );
}

export function AboutData({ readAt, extra }: { readAt: string | null; extra?: React.ReactNode }) {
  return (
    <section id="sobre-os-dados" aria-labelledby="sobre-h" className="mt-10 scroll-mt-28 border-t border-border pt-6">
      <h2 id="sobre-h" className="mb-2 text-lg font-semibold text-fg">
        Sobre estes dados
      </h2>
      <p className="max-w-[65ch] text-sm text-muted">
        Fonte: Câmara dos Deputados e Senado Federal, dados abertos.
        {readAt && <> Pauta lida em {dateTime(readAt)}.</>} O Senado não classifica propostas por tema; lá usamos uma lista pública de termos.
      </p>
      {extra}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/como-escolhemos" className="font-semibold text-accent-text underline underline-offset-2">
          Como escolhemos e como revisamos
        </Link>
        <Link href="/correcoes" className="font-semibold text-accent-text underline underline-offset-2">
          Correções
        </Link>
      </p>
    </section>
  );
}
