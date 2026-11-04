import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { AboutData, PautaCard, ReadStamp } from "@/components/pauta/ui";
import { data } from "@/lib/data";
import { count } from "@/lib/format";
import { dayShort, weekLastDay } from "@/lib/pauta";

export const metadata: Metadata = {
  title: { absolute: "O que estão decidindo em Brasília que mexe no seu bolso" },
  description: "Propostas sobre dinheiro, trabalho e benefícios na pauta da Câmara e do Senado, com o texto oficial.",
};

// A pauta muda ao longo do dia: a página nunca fica parada mais que 10 minutos.
export const revalidate = 600;

export default async function Entrada() {
  const o = await data.getPautaOverview();
  const until = dayShort(weekLastDay(o.week.weekEnds));
  const n = o.week.total;
  return (
    <Container>
      <section aria-labelledby="numero-h" className="flex max-w-2xl flex-col gap-4 py-2">
        <h1 id="numero-h" className="flex flex-col gap-2">
          {o.week.atLeast && <span className="font-mono text-sm uppercase tracking-wide text-muted">Pelo menos</span>}
          <span className="font-display text-hero tabular text-fg">{count(n)}</span>
          <span className="text-xl text-fg text-balance">
            {n === 1 ? "proposta que mexe no bolso está" : "propostas que mexem no bolso estão"} na pauta do plenário nesta semana.
          </span>
        </h1>
        <p className="text-base text-muted">
          Contamos propostas sobre dinheiro, trabalho e benefícios marcadas para votação no plenário da Câmara e do Senado até {until}.
        </p>
        <ReadStamp readAt={o.week.readAt} reads={o.reads} />
      </section>

      <section aria-labelledby="proximas-h" className="mt-8">
        <h2 id="proximas-h" className="mb-3 text-xl font-semibold text-fg">
          As próximas
        </h2>
        {n === 0 ? (
          <p className="text-base text-fg">Nenhuma proposta deste tipo na pauta do plenário até {until}.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {o.plenary.slice(0, 3).map((e) => (
              <PautaCard key={e.key} e={e} />
            ))}
          </ul>
        )}
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href="/pauta" className="font-semibold text-accent-text underline underline-offset-2">
            Ver a pauta inteira ({count(n)})
          </Link>
          {o.committees.length > 0 && (
            <Link href="/pauta#comissoes" className="text-accent-text underline underline-offset-2">
              {o.committees.length === 1 ? "1 proposta andando nas comissões" : `${count(o.committees.length)} propostas andando nas comissões`}
            </Link>
          )}
        </p>
      </section>

      <AboutData readAt={o.week.readAt} />
    </Container>
  );
}
