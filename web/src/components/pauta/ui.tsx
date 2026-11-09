import Link from "next/link";
import { ReviewedBadge } from "./answers";
import type { PautaEntry, PautaRead } from "@/lib/data";
import { bodyName, dateTime, dayShort, isStale, label, typeName } from "@/lib/pauta";

/** Estado de revisão da Regra 3. Enquanto não houver revisão, a página mostra só o resumo e o texto oficial. */
export function ReviewBadge() {
  return <span className="stamp text-muted">Aguardando revisão</span>;
}

export function where(e: Pick<PautaEntry, "body" | "stage" | "committee">) {
  return e.stage === "plenario" ? `${bodyName(e.body)} · Plenário` : `${bodyName(e.body)} · Comissão${e.committee ? ` ${e.committee}` : ""}`;
}

/** "Mexe com dinheiro: <o quê>": o termo da regra, nunca um juízo. */
export function MoneyTag({ e }: { e: Pick<PautaEntry, "reason"> }) {
  return (
    <span className="inline-flex min-h-7 items-center border border-fg bg-surface px-2 font-mono text-xs text-fg">
      Mexe com dinheiro: {e.reason.term}
    </span>
  );
}

export function ThemeTag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex min-h-7 items-center border border-border bg-bg px-2 font-mono text-xs text-muted">{children}</span>;
}

/** Um item da pauta. Sem resumo revisado ainda: o texto mostrado é o resumo oficial (ementa), rotulado. */
export function PautaCard({ e, note, showDay = true }: { e: PautaEntry; note?: string; showDay?: boolean }) {
  return (
    <li className="plate flex">
      <Link href={`/proposta/${e.key}`} className="flex w-full flex-col gap-2 p-4 outline-none hover:bg-bg focus-visible:outline-2 focus-visible:outline-focus">
        <span className="lbl">
          {where(e)}
          {showDay && ` · ${dayShort(e.scheduledFor)}`}
        </span>
        <span className="font-mono text-sm font-semibold text-fg">
          {label(e)} <span className="font-normal text-muted">· {typeName(e.type)}</span>
        </span>
        {e.plain ? (
          <span className="font-serif text-[19px] leading-snug text-fg">{e.plain}</span>
        ) : (
          <span className="line-clamp-3 text-sm text-fg">
            <span className="text-muted">Resumo oficial: </span>
            {e.summary ?? "A pauta da comissão não traz o resumo oficial."}
          </span>
        )}
        <span className="flex flex-wrap gap-1.5">
          <MoneyTag e={e} />
          {e.reason.theme && <ThemeTag>{e.reason.theme}</ThemeTag>}
        </span>
        {note && <span className="text-sm text-fg">{note}</span>}
        {!note && <span className="mt-1">{e.reviewedAt ? <ReviewedBadge at={e.reviewedAt} /> : <ReviewBadge />}</span>}
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
      <p className="lbl">
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
        <p role="status" className="flex flex-wrap items-center gap-3 border border-warning bg-warning-soft px-3 py-2 text-sm text-fg">
          <span className="stamp text-warning">Pauta desatualizada</span> Não atualizada desde {dateTime(readAt)}.
        </p>
      )}
      {failed > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-3 border border-danger bg-danger-soft px-3 py-2 text-sm text-fg">
          <span className="stamp text-danger">Leitura incompleta</span>
          {failed === 1 ? "1 pauta não carregou" : `${failed} pautas não carregaram`}. O número pode ser maior. Tentamos de novo na próxima leitura.
        </p>
      )}
    </div>
  );
}

export function AboutData({ readAt, extra }: { readAt: string | null; extra?: React.ReactNode }) {
  return (
    <section id="sobre-os-dados" aria-labelledby="sobre-h" className="mt-10 scroll-mt-28 border-t border-fg pt-6">
      <h2 id="sobre-h" className="lbl mb-2 font-sans">
        Sobre estes dados
      </h2>
      <p className="max-w-[65ch] text-sm text-muted">
        Fonte: Câmara dos Deputados e Senado Federal, dados abertos.
        {readAt && <> Pauta lida em {dateTime(readAt)}.</>} O Senado não classifica propostas por tema; lá usamos uma lista pública de termos.
      </p>
      {extra}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/como-escolhemos" className="font-medium text-fg underline underline-offset-2">
          Como escolhemos e como revisamos
        </Link>
        <Link href="/correcoes" className="font-medium text-fg underline underline-offset-2">
          Correções
        </Link>
      </p>
    </section>
  );
}
