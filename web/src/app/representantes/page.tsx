import { Building2, Landmark, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page/page-header";
import { HolderGrid } from "@/components/people/holder-card";
import { PlaceSearch } from "@/components/people/place-search";
import { MissingDataNote, SourceFooter } from "@/components/ui/data";
import { data, type Place, type PlaceTopVoted, type Stamp } from "@/lib/data";
import { count, date } from "@/lib/format";

type SP = Promise<{ cidade?: string; uf?: string; q?: string }>;

async function resolvePlace(sp: Awaited<SP>): Promise<Place | null | undefined> {
  if (sp.cidade !== undefined) {
    if (!/^\d{7}$/.test(sp.cidade)) return null;
    const p = await data.getPlace(sp.cidade);
    return p?.kind === "municipio" ? p : null;
  }
  if (sp.uf !== undefined) {
    if (!/^[A-Za-z]{2}$/.test(sp.uf)) return null;
    return data.getPlaceByUf(sp.uf);
  }
  return undefined; // sem lugar: tela de busca
}

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const place = await resolvePlace(await searchParams);
  if (!place) return { title: "Quem me representa" };
  const label = place.kind === "municipio" ? `${place.name} (${place.uf})` : place.name;
  return { title: `Quem representa ${label}`, description: `Todas as pessoas no cargo que representam ${label}, com dados oficiais.` };
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const place = await resolvePlace(sp);
  if (place === null) notFound();
  if (place === undefined) return <PickPlace q={sp.q?.slice(0, 60)} />;
  return <PlaceRepresentatives place={place} />;
}

const EXAMPLES = [
  { label: "Campinas · SP", href: "/representantes?cidade=3509502" },
  { label: "Salvador · BA", href: "/representantes?cidade=2927408" },
  { label: "Bom Jesus (4 cidades)", href: "/representantes?q=Bom+Jesus" },
  { label: "Minas Gerais", href: "/representantes?uf=MG" },
  { label: "Distrito Federal", href: "/representantes?uf=DF" },
];

async function PickPlace({ q }: { q?: string }) {
  // sem JS (ou vindo de um link), a busca cai aqui e lista as cidades com o mesmo nome, sempre com a UF
  const results = q && q.trim().length >= 2 ? await data.searchPlaces(q, 20) : null;
  const levels = [
    { Icon: MapPin, where: "Na sua cidade", who: "Prefeito, vice e vereadores", when: "eleitos em 2024" },
    { Icon: Building2, where: "No seu estado", who: "Governador, vice e deputados estaduais", when: "eleitos em 2022" },
    { Icon: Landmark, where: "Em Brasília", who: "3 senadores do estado, deputados federais e presidente", when: "eleitos em 2018 e 2022" },
  ];
  return (
    <Container>
      <PageHeader title="Quem me representa?" lead="Diga onde você mora e veja todas as pessoas eleitas que respondem por esse lugar, da câmara da cidade à Presidência." />
      <div className="max-w-xl">
        <PlaceSearch />
      </div>
      {results && (
        <section aria-labelledby="resultados" className="mt-6">
          <h2 id="resultados" className="mb-2 text-lg text-fg">
            {results.length ? `Lugares com “${q}”` : `Nenhum lugar com “${q}”`}
          </h2>
          {results.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {results.map((p) => (
                <li key={p.ibge}>
                  <Chip href={p.kind === "uf" ? `/representantes?uf=${p.uf}` : `/representantes?cidade=${p.ibge}`}>
                    {p.kind === "uf" ? `${p.name} (estado)` : `${p.name} · ${p.uf}`}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Tente sem acento ou só o começo do nome.</p>
          )}
        </section>
      )}
      <nav aria-label="Exemplos" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <li key={e.href}>
              <Link
                href={e.href}
                className="inline-flex h-8 items-center rounded-pill border-[1.5px] border-border bg-surface px-3 text-sm font-semibold text-fg outline-none hover:border-border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-labelledby="niveis" className="mt-10">
        <h2 id="niveis" className="mb-3 text-lg text-fg">
          Três níveis, uma lista
        </h2>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {levels.map(({ Icon, where, who, when }) => (
            <li key={where} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
              <Icon aria-hidden className="size-5 text-accent-text" />
              <span className="font-semibold text-fg">{where}</span>
              <span className="text-sm text-fg">{who}</span>
              <span className="text-xs text-muted">{when}</span>
            </li>
          ))}
        </ol>
      </section>
    </Container>
  );
}

const VISIBLE = 12;

async function PlaceRepresentatives({ place }: { place: Place }) {
  const [groups, missing, stamp, munis, top, votesStamp, popStamp] = await Promise.all([
    data.getRepresentatives(place),
    data.getCoverage(place),
    data.getStamp("tse.candidatos"),
    place.kind === "uf" ? data.listMunicipalities(place.uf!) : Promise.resolve([]),
    place.kind === "municipio" ? data.getTopVotedInPlace(place.ibge, 5) : Promise.resolve(null),
    data.getStamp("tse.votos"),
    data.getStamp("ibge.populacao"),
  ]);
  const total = groups.reduce((s, g) => s + g.people.length, 0);
  const isCity = place.kind === "municipio";
  const title = isCity ? `${place.name} · ${place.uf}` : place.name;
  return (
    <Container>
      <PageHeader
        title={title}
        crumbs={[
          { href: "/representantes", label: "Quem me representa" },
          ...(isCity ? [{ href: `/representantes?uf=${place.uf}`, label: place.uf! }] : []),
        ]}
        lead={
          <>
            <strong className="text-fg">{count(total)} pessoas</strong> no cargo respondem por quem mora {isCity ? "nesta cidade" : "neste estado"}
            {isCity ? ", do vereador ao presidente." : ", do deputado estadual ao presidente."}
            {isCity && place.population != null && (
              <span className="mt-1 block text-sm" data-testid="populacao">
                {count(place.population)} moradores, segundo a estimativa do IBGE (carregada em {date(popStamp.refreshedAt)}).
              </span>
            )}
          </>
        }
      >
        <ul className="mt-2 flex flex-wrap gap-2">
          {isCity && (
            <li>
              <Chip href={`/representantes?uf=${place.uf}`}>Ver o estado inteiro</Chip>
            </li>
          )}
          <li>
            <Chip href={`/acervo?mapa=${place.uf}#mapa`}>Ver no mapa</Chip>
          </li>
          <li>
            <Chip href="/eleicoes">Eleições</Chip>
          </li>
        </ul>
      </PageHeader>

      {/* pular direto para um nível: lista longa no celular */}
      <nav aria-label="Níveis nesta página" className="mb-6">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {groups.map((g) => (
            <li key={g.key} className="shrink-0">
              <a href={`#${g.key}`} className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-surface-sunken px-3 text-sm text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                {g.title} <span className="tabular text-muted">{g.seats ? `${g.people.length} de ${g.seats.total}` : g.people.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {missing.length > 0 && (
        <div className="mb-8">
          <MissingDataNote items={missing.map((m) => ({ what: m.label, why: m.reason }))} />
        </div>
      )}

      <div className="flex flex-col gap-10">
        {groups.map((g) => {
          const head = g.people.slice(0, VISIBLE);
          const rest = g.people.slice(VISIBLE);
          return (
            <section key={g.key} id={g.key} aria-labelledby={`${g.key}-h`} className="scroll-mt-28">
              <h2 id={`${g.key}-h`} className="mb-1 flex items-baseline gap-2 text-xl text-fg">
                {g.title}
                <span className="text-base tabular text-muted">{g.seats ? `${g.people.length} de ${g.seats.total} cadeiras carregadas` : g.people.length}</span>
              </h2>
              <p className="mb-3 text-sm text-muted">{levelNote(g.level, g.where)}</p>
              {g.seats && (
                <p className="mb-3 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-muted" data-testid="cadeiras">
                  <span aria-hidden>—</span> {count(g.seats.total - g.seats.loaded)} {g.seats.total - g.seats.loaded === 1 ? "cadeira não está" : "cadeiras não estão"} aqui: {g.seats.why}.
                </p>
              )}
              {g.gaps?.map((x) => (
                <p key={x.what} className="mb-3 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-muted" data-testid="lacuna">
                  <span className="font-semibold text-fg">{x.what}:</span> <span aria-hidden>—</span> {x.why}.
                </p>
              ))}
              <HolderGrid people={head} />
              {rest.length > 0 && (
                <details className="group mt-2">
                  <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus group-open:mb-2">
                    <span className="group-open:hidden">Ver os outros {rest.length}</span>
                    <span className="hidden group-open:inline">Mostrar menos</span>
                  </summary>
                  <HolderGrid people={rest} />
                </details>
              )}
            </section>
          );
        })}
      </div>

      {isCity && <TopVoted place={place} top={top} stamp={votesStamp} />}

      {munis.length > 0 && (
        <section aria-labelledby="cidades" className="mt-10">
          <h2 id="cidades" className="mb-3 text-xl text-fg">
            Cidades de {place.name} nesta versão
          </h2>
          <ul className="flex flex-wrap gap-2">
            {munis.map((m) => (
              <li key={m.ibge}>
                <Chip href={`/representantes?cidade=${m.ibge}`}>{m.name}</Chip>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}

const ELECTED = new Set(["eleito", "eleito_qp", "eleito_media"]);

/** W1 item 6: mais votados no município. Ordem = votos na urna (é o dado pedido), nunca nota ou adjetivo. */
function TopVoted({ place, top, stamp }: { place: Place; top: PlaceTopVoted | null; stamp: Stamp }) {
  return (
    <section aria-labelledby="mais-votados-h" id="mais-votados" className="mt-10 scroll-mt-28 rounded-md border border-border bg-surface p-4 md:p-6">
      <h2 id="mais-votados-h" className="text-xl text-fg">
        Mais votados em {place.name}
        {top ? ` · eleição de ${top.year}` : ""}
      </h2>
      {!top ? (
        <p className="mt-2 rounded-sm bg-surface-sunken px-4 py-3 text-sm text-muted">
          <span aria-label="não carregado">—</span> Os votos por cidade desta eleição ainda não foram carregados para {place.name}.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Votos que cada candidatura recebeu dentro da cidade no 1º turno, entre quem tem crachá no site (quem tem ou já teve mandato). Candidaturas sem
            crachá ainda não entram, por isso a lista pode pular alguém bem votado aqui.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            {top.groups.map((g) => (
              <div key={g.office}>
                <h3 className="mb-2 text-base font-semibold text-fg">{g.label}</h3>
                <ol className="flex flex-col divide-y divide-border" data-testid={`mais-votados-${g.office}`}>
                  {g.items.map((it, i) => (
                    <li key={it.slug} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-4 shrink-0 text-right tabular text-muted">{i + 1}</span>
                        <span className="min-w-0">
                          <Link href={`/p/${it.slug}`} className="font-semibold text-fg underline-offset-2 hover:underline">
                            {it.name}
                          </Link>{" "}
                          <span className="text-xs text-muted">
                            {it.party}
                            {it.result && ELECTED.has(it.result) ? ` · ${it.gender === "f" ? "eleita" : "eleito"}` : it.result === "suplente" ? " · suplente" : ""}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 tabular text-fg">{count(it.votes)} votos</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      )}
      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </section>
  );
}

function levelNote(level: string, where: string) {
  if (level === "municipal") return `Câmara e prefeitura de ${where}.`;
  if (level === "estadual") return `Eleitos por todo o estado (${where}).`;
  return where === "Brasil" ? "Eleitos pelo país inteiro." : `Representam ${where} em Brasília.`;
}

function Chip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center rounded-pill border-[1.5px] border-border bg-surface px-3 text-sm font-semibold text-fg outline-none hover:border-border-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {children}
    </Link>
  );
}
