import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { AboutData, PautaCard, ReadStamp } from "@/components/pauta/ui";
import { AtalhoQuemVotei } from "@/components/votos/lembrar";
import { MapaBrasil } from "@/components/votos/mapa-brasil";
import { Barra513, Sq } from "@/components/votos/ui";
import { data } from "@/lib/data";
import { count } from "@/lib/format";
import { dayShort, weekLastDay } from "@/lib/pauta";
import { VOTES, fora, jaDecididoHref } from "@/lib/votacoes";

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
  const V = VOTES[0];
  return (
    <Container className="max-w-[1320px]">
      {/* Interação-assinatura 1: o contador do bolso. Número grande, frase curta, a lista logo abaixo. */}
      <section aria-labelledby="numero-h" className="grid gap-6 py-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
        <h1 id="numero-h" className="flex flex-col gap-2">
          <span className="lbl">No seu bolso · plenário da Câmara e do Senado · até {until}</span>
          {o.week.atLeast && <span className="font-mono text-sm text-muted">Pelo menos</span>}
          <span className="font-display text-hero text-fg tabular">{count(n)}</span>
          <span className="font-serif text-[28px] leading-[1.15] font-medium text-fg text-balance md:text-[36px]">
            {n === 1 ? "proposta pode mexer no que você paga ou recebe" : "propostas podem mexer no que você paga ou recebe"} nesta semana.
          </span>
        </h1>
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted">
            Contamos propostas sobre dinheiro, trabalho e benefícios marcadas para votação no plenário até {until}. Dizemos o que acontece, nunca se
            é bom ou ruim.
          </p>
          <ReadStamp readAt={o.week.readAt} reads={o.reads} />
        </div>
      </section>

      <section aria-labelledby="proximas-h" className="mt-8">
        <h2 id="proximas-h" className="lbl mb-3 font-sans">
          As próximas
        </h2>
        {n === 0 ? (
          <p className="plate p-4 font-serif text-[19px] text-fg">Nenhuma proposta mexe no bolso nesta semana. A pauta foi lida; não há item deste tipo até {until}.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {o.plenary.slice(0, 3).map((e) => (
              <PautaCard key={e.key} e={e} />
            ))}
          </ul>
        )}
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href="/pauta" className="inline-flex min-h-11 items-center border border-fg bg-surface px-4 font-semibold text-fg hover:bg-surface-sunken">
            Ver tudo o que vem aí ({count(n)})
          </Link>
          {o.committees.length > 0 && (
            <Link href="/pauta#comissoes" className="inline-flex min-h-11 items-center text-fg underline underline-offset-2">
              {o.committees.length === 1 ? "1 proposta andando nas comissões" : `${count(o.committees.length)} propostas andando nas comissões`}
            </Link>
          )}
        </p>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        {/* Interação-assinatura 2: o estado que enche. */}
        <section aria-labelledby="decidido-h" className="plate flex flex-col gap-3 p-4">
          <h2 id="decidido-h" className="lbl font-sans">
            Já decidido · {V.label} · {V.date}
          </h2>
          <p className="font-serif text-[22px] leading-snug text-fg">{V.what}</p>
          <div className="px-2">
            <MapaBrasil byUf={V.uf} hrefFor={(u) => jaDecididoHref(0, u)} />
          </div>
          <dl className="grid grid-cols-4 gap-2">
            {[
              ["Sim", V.total[0], "S"],
              ["Não", V.total[1], "N"],
              ["Abst.", V.total[2], "A"],
              ["Fora", fora(V.total), "X"],
            ].map(([l, k2, k]) => (
              <div key={String(l)} className="flex flex-col gap-1">
                <dt className="flex items-center gap-1.5 text-xs text-muted">
                  <Sq k={k as "S"} /> {l}
                </dt>
                <dd className="font-display text-[32px] leading-none font-bold text-fg tabular">{k2}</dd>
              </div>
            ))}
          </dl>
          <Barra513 c={V.total} />
          <p className="text-sm text-muted">Cada estado enche até o % de Sim. Toque num estado para ver quem votou, nome por nome.</p>
          <Link href="/ja-decidido" className="inline-flex min-h-11 w-fit items-center border border-fg bg-surface px-4 text-sm font-semibold text-fg hover:bg-surface-sunken">
            Ver as 6 votações
          </Link>
        </section>

        <section aria-labelledby="votei-h" className="plate flex flex-col gap-3 p-4">
          <h2 id="votei-h" className="lbl font-sans">
            Quem eu votei
          </h2>
          <p className="font-serif text-[22px] leading-snug text-fg">Escolha a pessoa em quem votou e veja como ela votou nas 6 decisões sobre dinheiro público.</p>
          <p className="text-sm text-muted">A escolha fica só no seu aparelho. Nada vai para o servidor.</p>
          <AtalhoQuemVotei />
        </section>
      </div>

      <AboutData readAt={o.week.readAt} />
    </Container>
  );
}
