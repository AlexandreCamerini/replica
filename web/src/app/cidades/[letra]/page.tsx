import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page/page-header";
import { LinkChip } from "@/components/profile/ui";
import { SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import { count } from "@/lib/format";

type Props = { params: Promise<{ letra: string }> };
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const first = (name: string) => name.normalize("NFD").replace(/[^A-Za-z]/g, "")[0]?.toLowerCase() ?? "";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = (await params).letra;
  return { title: LETTERS.includes(l) ? `Cidades com ${l.toUpperCase()}` : "Cidades" };
}

/** Índice A–Z das 5.570 cidades (S01 › AZDirectory), uma letra por página, agrupado por estado. */
export default async function Page({ params }: Props) {
  const l = (await params).letra;
  if (!LETTERS.includes(l)) notFound();
  const [munis, ufs, stamp] = await Promise.all([data.listMunicipalities(), data.listUfs(), data.getStamp("ibge.places")]);
  const here = munis.filter((m) => first(m.name) === l);
  const ufName = Object.fromEntries(ufs.map((u) => [u.uf, u.name]));
  const byUf = new Map<string, typeof here>();
  for (const m of here) byUf.set(m.uf!, [...(byUf.get(m.uf!) ?? []), m]);
  const groups = [...byUf.entries()].sort((a, b) => ufName[a[0]].localeCompare(ufName[b[0]], "pt-BR"));
  const present = new Set(munis.map((m) => first(m.name)));
  return (
    <Container>
      <PageHeader
        title={`Cidades com ${l.toUpperCase()}`}
        crumbs={[{ href: "/", label: "Início" }]}
        lead={`${count(here.length)} ${here.length === 1 ? "cidade" : "cidades"}, por estado. Escolha uma para ver quem representa quem mora lá.`}
      />
      <nav aria-label="Outras letras" className="mb-6">
        <ul className="flex flex-wrap gap-1">
          {LETTERS.filter((x) => present.has(x)).map((x) => (
            <li key={x}>
              <LinkChip href={`/cidades/${x}`} active={x === l} scroll>
                <span className="w-3 text-center uppercase">{x}</span>
              </LinkChip>
            </li>
          ))}
        </ul>
      </nav>
      {here.length === 0 ? (
        <p className="rounded-md bg-surface-sunken px-4 py-10 text-center text-sm text-muted">Nenhuma cidade começa com essa letra.</p>
      ) : (
        <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
          {groups.map(([uf, ms]) => (
            <section key={uf} aria-labelledby={`uf-${uf}`} className="mb-6 break-inside-avoid">
              <h2 id={`uf-${uf}`} className="mb-1.5 text-sm font-semibold text-muted">
                {ufName[uf]} <span className="tabular">({ms.length})</span>
              </h2>
              <ul className="flex flex-col gap-1">
                {ms.map((m) => (
                  <li key={m.ibge}>
                    {/* <a> simples: centenas de links, sem prefetch nem payload de componente cliente */}
                    <a href={`/representantes?cidade=${m.ibge}`} className="text-sm text-fg underline-offset-2 hover:underline">
                      {m.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}
