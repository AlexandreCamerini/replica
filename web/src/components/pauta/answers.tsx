import { conferidoEm } from "@/components/sv/estados";
import type { AnswerClaim, VerifiedBy } from "@/lib/data";

/** Selo neutro da Regra 3: diz quem conferiu a resposta publicada (`verifiedBy`), não que a proposta é boa. Frase única em sv/estados. */
export function ReviewedBadge({ at, by }: { at: string; by?: VerifiedBy }) {
  return <span className="stamp">{conferidoEm(at, by ?? null, "v1")}</span>;
}

const DIRECTION: Record<NonNullable<AnswerClaim["direction"]>, string> = {
  entra: "Entra: o governo passa a arrecadar.",
  sai: "Sai: o governo passa a gastar ou deixa de arrecadar.",
  dividido: "É dividido entre órgãos, fundos ou governos.",
  nao_diz: "",
};

/** Uma afirmação com o trecho do texto oficial ao lado (expansível). "O texto não diz" só no estado `nao_diz`; `nao_conferido` não afirma nada. */
export function Claim({ claim, sourceUrl, title }: { claim: AnswerClaim; sourceUrl: string; title?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {title && <h3 className="font-sans text-sm font-semibold text-muted">{title}</h3>}
      {claim.says ? (
        <>
          {claim.direction && claim.direction !== "nao_diz" && <p className="font-semibold text-fg">{DIRECTION[claim.direction]}</p>}
          <p className="font-serif text-[19px] leading-snug text-fg">{claim.text}</p>
          <details className="group text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center border border-fg bg-surface px-3 text-sm font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
              <span className="group-open:hidden">Ver o trecho</span>
              <span className="hidden group-open:inline">Esconder o trecho</span>
            </summary>
            <figure className="mt-2 border-l-2 border-fg bg-bg px-3 py-2">
              <figcaption className="lbl mb-1">
                Texto oficial ·{" "}
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {claim.page > 0 ? `p. ${claim.page}` : "inteiro teor"}
                </a>
              </figcaption>
              <blockquote className="font-serif text-base italic text-fg">&quot;{claim.quote}&quot;</blockquote>
            </figure>
          </details>
        </>
      ) : claim.state === "nao_diz" ? (
        <>
          <p className="font-serif text-[19px] leading-snug text-fg">O texto não diz.</p>
          <p className="text-sm text-muted">Nenhum trecho do texto oficial responde isso.</p>
        </>
      ) : (
        // nao_conferido: não afirma nada sobre a lei
        <p className="font-serif text-[19px] leading-snug text-fg">Ainda não conseguimos conferir esta resposta.</p>
      )}
    </div>
  );
}
