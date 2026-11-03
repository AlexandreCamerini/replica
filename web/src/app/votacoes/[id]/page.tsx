import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page/page-header";
import { LinkChip, hrefWith, type Params } from "@/components/profile/ui";
import { SourceFooter, TopicTag, VoteBadge } from "@/components/ui/data";
import { data, type VoteValue } from "@/lib/data";
import { count, date } from "@/lib/format";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Params> };

const VALUES: { v: VoteValue; label: string }[] = [
  { v: "sim", label: "Sim" },
  { v: "nao", label: "Não" },
  { v: "abstencao", label: "Abstenção" },
  { v: "obstrucao", label: "Obstrução" },
  { v: "art17", label: "Art. 17" },
  { v: "nao_votou", label: "Não votou" },
];
const ORIENT: Record<string, string> = { sim: "Sim", nao: "Não", abstencao: "Abstenção", obstrucao: "Obstrução", liberado: "Liberou a bancada" };
const ACTOR: Record<string, string> = { governo: "Governo", maioria: "Maioria", minoria: "Minoria", oposicao: "Oposição" };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ev = await data.getVotingEvent((await params).id);
  if (!ev) return { title: "Votação não encontrada" };
  return { title: ev.proposal ? `Votação · ${ev.proposal.label}` : "Votação", description: ev.description.slice(0, 200) };
}

/** S10: placar, orientação das bancadas e voto de cada pessoa. Partidos em ordem alfabética, cores neutras. */
export default async function Page({ params, searchParams }: Props) {
  const id = (await params).id;
  const ev = await data.getVotingEvent(id);
  if (!ev) notFound();
  const sp = await searchParams;
  const filter = VALUES.some((x) => x.v === sp.voto) ? (sp.voto as VoteValue) : undefined;
  const [topics, stamp] = await Promise.all([data.listTopics(), data.getStamp(`${ev.body}.votacoes`)]);
  const topicName = Object.fromEntries(topics.map((t) => [t.slug, t.name]));
  const base = `/votacoes/${ev.id}`;
  const total = Object.values(ev.counts).reduce((s, n) => s + n, 0);
  const shown = filter ? ev.votes.filter((v) => v.value === filter) : ev.votes;
  const house = ev.body === "senado" ? "Senado Federal" : "Câmara dos Deputados";
  // governo/maioria/minoria/oposição de um lado; partidos e blocos (siglas como a casa publica) do outro
  const blocs = ev.orientations.filter((o) => o.kind in ACTOR);
  const parties = ev.orientations.filter((o) => !(o.kind in ACTOR));

  return (
    <Container>
      <PageHeader
        title={ev.proposal ? ev.proposal.label : "Votação nominal"}
        crumbs={[{ href: ev.body === "senado" ? "/congresso?casa=senado" : "/congresso", label: "Congresso" }]}
        lead={ev.proposal?.summary || ev.description}
      >
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          {ev.result && <VoteBadge value={ev.result} />}
          <span>{house}</span>
          <span aria-hidden>·</span>
          <time dateTime={ev.occurredAt}>{date(ev.occurredAt)}</time>
          {ev.topic && topicName[ev.topic] && <TopicTag>{topicName[ev.topic]}</TopicTag>}
          {ev.proposal?.url && (
            <a href={ev.proposal.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-text underline underline-offset-2">
              ver a proposta no site oficial <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only">(abre em nova aba)</span>
            </a>
          )}
        </div>
      </PageHeader>

      {ev.proposal && <p className="mb-6 max-w-[70ch] text-sm text-fg">O que foi votado: {ev.description}</p>}

      <section aria-labelledby="placar-h" className="mb-8">
        <h2 id="placar-h" className="mb-3 text-xl text-fg">
          Placar
        </h2>
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {VALUES.map(({ v, label }) => (
            <div key={v} className="flex flex-col rounded-md border border-border bg-surface p-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-display text-xl tabular text-fg">{count(ev.counts[v])}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">{count(total)} pessoas com registro nesta votação. Ausência não aparece como voto.</p>
      </section>

      {ev.orientations.length > 0 && (
        <section aria-labelledby="orientacao-h" className="mb-8">
          <h2 id="orientacao-h" className="mb-1 text-xl text-fg">
            Como cada bancada orientou
          </h2>
          <p className="mb-3 text-sm text-muted">Orientação é o voto que o líder pede à bancada. Não é o voto de ninguém.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              { title: "Governo, maioria, minoria e oposição", rows: blocs, label: (l: string, k: string) => ACTOR[k] ?? l },
              { title: "Partidos e blocos", rows: parties, label: (l: string) => l },
            ]
              .filter((g) => g.rows.length)
              .map((g) => (
                <table key={g.title} className="w-full text-sm">
                  <caption className="mb-1 text-left text-xs font-semibold text-muted">{g.title}</caption>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Bancada</th>
                      <th scope="col">Orientação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((o) => (
                      <tr key={o.label} className="border-b border-border last:border-0">
                        <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg">
                          {g.label(o.label, o.kind)}
                        </th>
                        <td className="py-1.5 text-right font-semibold text-fg">{ORIENT[o.value] ?? o.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </div>
        </section>
      )}

      {ev.byParty.length > 0 && (
        <section aria-labelledby="partidos-h" className="mb-8">
          <h2 id="partidos-h" className="mb-3 text-xl text-fg">
            Votos por partido
          </h2>
          <div tabIndex={0} role="region" aria-label="Tabela de votos por partido, rolável" className="relative overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-focus">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-semibold">Partido (no dia)</th>
                  {VALUES.map(({ v, label }) => (
                    <th key={v} scope="col" className="py-2 pr-3 text-right font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ev.byParty.map((p) => (
                  <tr key={p.party} className="border-b border-border last:border-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-fg">
                      {p.party}
                    </th>
                    {VALUES.map(({ v }) => (
                      <td key={v} className="py-1.5 pr-3 text-right tabular text-fg">
                        {p.counts[v] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="pessoas-h" id="pessoas" className="scroll-mt-28">
        <h2 id="pessoas-h" className="mb-3 flex items-baseline gap-2 text-xl text-fg">
          Voto de cada pessoa <span className="text-base font-normal tabular text-muted">{count(shown.length)}</span>
        </h2>
        <nav aria-label="Filtrar por voto" className="mb-3">
          <ul className="flex flex-wrap gap-2">
            <li>
              <LinkChip href={hrefWith(base, {}, {}, "pessoas")} active={!filter}>
                Todos
              </LinkChip>
            </li>
            {VALUES.filter(({ v }) => ev.counts[v] > 0).map(({ v, label }) => (
              <li key={v}>
                <LinkChip href={hrefWith(base, {}, { voto: v }, "pessoas")} active={filter === v}>
                  {label} <span className="ml-1 tabular opacity-80">{ev.counts[v]}</span>
                </LinkChip>
              </li>
            ))}
          </ul>
        </nav>
        {shown.length === 0 ? (
          <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted">Ninguém com esse voto.</p>
        ) : (
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((v) => (
              <li key={v.slug} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  <Link href={`/p/${v.slug}`} className="text-fg underline-offset-2 hover:underline">
                    {v.name}
                  </Link>{" "}
                  <span className="text-xs text-muted">
                    {v.party}
                    {v.uf ? ` · ${v.uf}` : ""}
                  </span>
                </span>
                <VoteBadge value={v.value} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}
