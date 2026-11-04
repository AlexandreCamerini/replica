import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
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
    <Container className="max-w-3xl">
      <PageHeader title="Correções" lead="Toda resposta corrigida aparece aqui, com data e motivo." />
      {rows.length === 0 ? (
        <p className="text-base text-fg">Nenhuma correção publicada até agora.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {rows.map((c) => (
            <li key={`${c.key}-${c.correctedAt}`} className="border-t border-border pt-4">
              <p className="font-mono text-xs uppercase tracking-wide text-muted">Corrigido em {date(c.correctedAt)}</p>
              <h2 className="text-lg font-semibold text-fg">
                <Link href={`/proposta/${c.key}`} className="underline underline-offset-2">
                  {c.label}
                </Link>
              </h2>
              <p className="text-base text-fg">Motivo: {c.note}</p>
              <dl className="mt-2 flex flex-col gap-2 text-sm">
                {c.changed.map((x) => (
                  <div key={x.field}>
                    <dt className="font-semibold text-fg">{FIELD[x.field]}</dt>
                    <dd className="text-muted">Antes dizia: {said(x.before)}</dd>
                    <dd className="text-fg">Agora diz: {said(x.after)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-sm text-muted">
        <Link href="/como-escolhemos#revisao" className="text-accent-text underline underline-offset-2">
          Como revisamos
        </Link>
      </p>
    </Container>
  );
}
