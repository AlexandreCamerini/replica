import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { BrazilMap } from "@/components/map/brazil-map";
import { PlaceSearch } from "@/components/people/place-search";
import { BigNumber, SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import { REGIONS, UF_ROWS } from "@/lib/data/reference";
import { COMPARE_RANGE } from "@/lib/compare";
import { count } from "@/lib/format";

export const metadata: Metadata = { title: "Acervo", description: "Quem ocupa cargo eletivo, do vereador ao presidente, com dados oficiais." };

// D12: páginas que já existem e funcionam. Partidos, Governos e Eleições ficam fora: ainda estão em construção.
const PAGES = [
  { href: "/representantes", label: "Quem representa sua cidade", lead: "Do vereador ao presidente, a partir da sua cidade." },
  { href: "/quem", label: "Quem é quem", lead: "Busca por nome, cargo, partido ou estado." },
  { href: "/comparar", label: "Comparar", lead: `${COMPARE_RANGE} lado a lado.` },
  { href: "/congresso", label: "Congresso", lead: "Votações do plenário da Câmara e do Senado." },
];

export default async function Acervo() {
  const [counters, munis, stamp] = await Promise.all([data.getCounters(), data.listMunicipalities(), data.getStamp("tse.candidatos")]);
  const byLetter = new Map<string, typeof munis>();
  for (const m of munis) {
    const l = m.name.normalize("NFD").replace(/[^A-Za-z]/g, "")[0]?.toUpperCase() ?? "#";
    byLetter.set(l, [...(byLetter.get(l) ?? []), m]);
  }
  return (
    <Container>
      <PageHeader title="Acervo" lead="O que já mostramos sobre quem ocupa cargo eletivo, com dados oficiais." />
      <nav aria-label="Páginas do acervo" className="mb-10">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PAGES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="flex h-full flex-col gap-1 rounded-md border border-border bg-surface p-4 outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="font-semibold text-fg">{p.label}</span>
                <span className="text-sm text-muted">{p.lead}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="hero-h" className="grid gap-8 py-4 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div className="flex flex-col gap-6">
          <h2 id="hero-h" className="sr-only">
            Quem representa você
          </h2>
          <BigNumber value={counters.total} caption="pessoas no cargo hoje, da câmara da sua cidade a Brasília" />
          <div className="max-w-xl">
            <PlaceSearch label="Onde você mora?" />
          </div>
        </div>
        <ul className="grid grid-cols-3 gap-2">
          {(["municipal", "estadual", "federal"] as const).map((lvl) => (
            <li key={lvl} className="flex flex-col rounded-md border border-border bg-surface p-3">
              <span className="font-display text-xl tabular text-fg">{count(counters.byLevel[lvl])}</span>
              <span className="text-xs text-muted">{lvl === "municipal" ? "nas cidades" : lvl === "estadual" ? "nos estados" : "em Brasília"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cargos-h" className="mt-6">
        <h2 id="cargos-h" className="sr-only">
          Pessoas por cargo
        </h2>
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {counters.byOffice.map((o) => (
            <li key={o.office} className="shrink-0">
              <Link
                href={`/quem?cargo=${o.office}`}
                className="inline-flex h-9 items-center gap-2 rounded-pill bg-surface-sunken px-3 text-sm text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                {o.label} <span className="font-semibold tabular">{count(o.count)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} dataset={stamp.dataset} />
      </section>

      <section id="mapa" aria-labelledby="mapa-h" className="mt-10 grid scroll-mt-28 gap-8 md:grid-cols-2">
        <div>
          <h2 id="mapa-h" className="mb-1 text-xl text-fg">
            Pelo mapa
          </h2>
          <p className="mb-4 text-sm text-muted">Toque num estado para ver os municípios, e num município para ver quem representa quem mora lá.</p>
          <BrazilMap />
        </div>
        <div>
          <h2 className="mb-3 text-xl text-fg">Por região</h2>
          <div className="flex flex-col gap-4">
            {REGIONS.map((r) => (
              <div key={r.ibge}>
                <h3 className="mb-1.5 text-sm font-semibold text-fg">{r.name}</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {UF_ROWS.filter((u) => u[3] === r.ibge)
                    .sort((a, b) => a[2].localeCompare(b[2], "pt-BR"))
                    .map(([, uf, name]) => (
                      <li key={uf}>
                        <Link href={`/representantes?uf=${uf}`} className="text-sm text-accent-text underline underline-offset-2">
                          {name}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="az-h" className="mt-10">
        <h2 id="az-h" className="mb-1 text-xl text-fg">
          Cidades de A a Z
        </h2>
        <p className="mb-4 text-sm text-muted">
          {count(munis.length)} {munis.length === 1 ? "cidade" : "cidades"}
          {data.isDemo ? " nesta versão de demonstração." : ". Escolha a letra."}
        </p>
        {/* poucas cidades (demo): lista inteira; com as 5.570, só o índice e uma página por letra */}
        {munis.length <= 80 ? (
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...byLetter.entries()].map(([l, ms]) => (
              <div key={l} className="flex gap-3">
                <dt className="w-5 font-display text-lg text-muted">{l}</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1">
                  {ms.map((m) => (
                    <Link key={m.ibge} href={`/representantes?cidade=${m.ibge}`} className="text-sm text-fg underline-offset-2 hover:underline">
                      {m.name} <span className="text-muted">{m.uf}</span>
                    </Link>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <nav aria-label="Cidades por letra">
            <ul className="flex flex-wrap gap-2">
              {[...byLetter.entries()].map(([l, ms]) => (
                <li key={l}>
                  <Link
                    href={`/cidades/${l.toLowerCase()}`}
                    className="inline-flex h-11 min-w-11 flex-col items-center justify-center rounded-sm border border-border bg-surface px-2 outline-none hover:border-border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="font-display text-lg leading-none text-fg">{l}</span>
                    <span className="text-[length:var(--ds-text-xs)] leading-none tabular text-muted">{count(ms.length)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </section>
    </Container>
  );
}
