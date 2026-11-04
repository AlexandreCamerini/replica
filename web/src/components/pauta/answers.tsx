import type { AnswerClaim } from "@/lib/data";
import { date } from "@/lib/format";

/** Selo neutro da Regra 3: diz que uma pessoa conferiu, não que a proposta é boa. */
export function ReviewedBadge({ at }: { at: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-pill bg-surface-inverse px-2.5 text-xs font-semibold text-on-inverse">
      Revisado por pessoa em {date(at)}
    </span>
  );
}

const DIRECTION: Record<NonNullable<AnswerClaim["direction"]>, string> = {
  entra: "Entra: o governo passa a arrecadar.",
  sai: "Sai: o governo passa a gastar ou deixa de arrecadar.",
  dividido: "É dividido entre órgãos, fundos ou governos.",
  nao_diz: "",
};

/** Uma afirmação com o trecho do texto oficial ao lado (expansível). Sem trecho: "O texto não diz". */
export function Claim({ claim, sourceUrl, title }: { claim: AnswerClaim; sourceUrl: string; title?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {title && <h3 className="text-sm font-semibold text-muted">{title}</h3>}
      {claim.says ? (
        <>
          {claim.direction && claim.direction !== "nao_diz" && <p className="font-semibold text-fg">{DIRECTION[claim.direction]}</p>}
          <p className="text-fg">{claim.text}</p>
          <details className="group text-sm">
            <summary className="cursor-pointer text-accent-text underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <span className="group-open:hidden">Ver trecho do texto oficial</span>
              <span className="hidden group-open:inline">Esconder trecho</span>
            </summary>
            <figure className="mt-2 rounded-md border-l-4 border-border bg-surface-sunken px-3 py-2">
              <figcaption className="mb-1 font-mono text-xs uppercase tracking-wide text-muted">
                Texto oficial ·{" "}
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {claim.page > 0 ? `p. ${claim.page}` : "inteiro teor"}
                </a>
              </figcaption>
              <blockquote className="text-fg">&quot;{claim.quote}&quot;</blockquote>
            </figure>
          </details>
        </>
      ) : (
        <>
          <p className="text-fg">O texto não diz.</p>
          <p className="text-sm text-muted">Nenhum trecho do texto oficial responde isso.</p>
        </>
      )}
    </div>
  );
}
