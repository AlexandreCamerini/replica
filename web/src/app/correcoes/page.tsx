import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { data, type AnswerClaim, type AnswerField } from "@/lib/data";
import { date } from "@/lib/format";

export const metadata: Metadata = { title: "Correções", description: "Toda resposta corrigida, com data e motivo." };
export const revalidate = 600;

const FIELD: Record<AnswerField, string> = {
  o_que_propoe: "O que propõe",
  quem_recebe: "Quem recebe algo",
  quem_paga: "Quem paga",
  o_que_muda: "O que muda",
  dinheiro: "O dinheiro entra, sai ou é dividido",
  estimativa_impacto: "Estimativa de impacto oficial",
};
const said = (c: AnswerClaim) => (c.says ? c.text : "O texto não diz.");

// Nada é apagado sem rastro: cada correção mostra o que dizia antes, o que diz agora e o motivo.
export default async function Correcoes() {
  const rows = await data.listCorrections();
  return (
    <Container className="max-w-[880px]">
      <header className="mb-6 flex flex-col gap-3">
        <p className="lbl">Correções · registro público</p>
        <h1 className="font-serif text-[32px] leading-[1.1] font-medium text-fg md:text-[40px]">Correções</h1>
        <p className="text-base text-muted">Toda resposta corrigida aparece aqui, com data e motivo. Nada é apagado sem rastro.</p>
      </header>
      {rows.length === 0 ? (
        <p className="plate p-4 font-serif text-[19px] text-fg">Nenhuma correção publicada até agora.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {rows.map((c) => (
            <li key={`${c.key}-${c.correctedAt}`} className="border-t border-fg pt-4">
              <p className="lbl">Corrigido em {date(c.correctedAt)}</p>
              <h2 className="font-mono text-lg font-semibold text-fg">
                <Link href={`/proposta/${c.key}`} className="underline underline-offset-2">
                  {c.label}
                </Link>
              </h2>
              <p className="text-base text-fg">Motivo: {c.note}</p>
              <dl className="mt-2 flex flex-col gap-2 text-sm">
                {c.changed.map((x) => (
                  <div key={x.field}>
                    <dt className="font-semibold text-fg">{FIELD[x.field]}</dt>
                    <dd className="text-muted">
                      Antes dizia: <s>{said(x.before)}</s>
                    </dd>
                    <dd className="text-fg">Agora diz: {said(x.after)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="erro-h" className="plate mt-10 flex flex-col gap-3 p-4">
        <h2 id="erro-h" className="font-serif text-[24px] leading-tight font-medium text-fg">
          Viu um erro?
        </h2>
        <p className="text-base text-fg">Diga qual proposta, qual frase e o que o texto oficial diz. Conferimos e, se for erro, corrigimos aqui com data e motivo.</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/sugestoes" className="inline-flex min-h-11 items-center border border-fg bg-surface-inverse px-4 font-semibold text-on-inverse">
            Apontar um erro
          </Link>
          <Link href="/como-escolhemos#revisao" className="inline-flex min-h-11 items-center text-fg underline underline-offset-2">
            Como revisamos
          </Link>
        </p>
      </section>
    </Container>
  );
}
