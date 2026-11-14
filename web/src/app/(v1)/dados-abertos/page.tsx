import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page/page-header";
import { CoverageSearch } from "@/components/people/coverage-search";
import { cellView } from "@/lib/coverage";
import { data } from "@/lib/data";
import { count, date } from "@/lib/format";

export const metadata: Metadata = {
  title: "Quem publica dados",
  description: "Em quantas cidades de cada estado cada tipo de dado já está no site, e o que falta.",
};

type SP = Promise<{ cidade?: string; q?: string }>;
const link = "font-semibold text-accent-text underline underline-offset-2";

const STATUS_TEXT: Record<string, string> = {
  carregando: "o órgão publica; a carga está na fila",
  so_portal: "só no portal do órgão, sem formato aberto que dê para carregar",
  nao_publica: "o órgão não publica",
  desconhecido: "ainda não conferimos",
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  let city = null;
  if (sp.cidade !== undefined) {
    if (!/^\d{7}$/.test(sp.cidade)) notFound();
    city = await data.getPlace(sp.cidade);
    if (city?.kind !== "municipio") notFound();
  }
  const q = sp.q?.trim().slice(0, 60);
  const results = !city && q && q.length >= 2 ? (await data.searchPlaces(q, 20)).filter((p) => p.kind === "municipio") : null;
  const [m, cityCoverage, ufs] = await Promise.all([data.getCoverageMatrix(), city ? data.getCoverage(city) : Promise.resolve([]), data.listUfs()]);
  // W3-A: Assembleias Legislativas (nível estadual), A–Z pelo nome do estado
  const assemblies = (await Promise.all(ufs.filter((u) => u.uf).map((u) => data.getAssembly(u.uf!)))).filter((a) => a !== null);
  const ufName = new Map(ufs.map((u) => [u.uf, u.name]));
  const byName = (a: { uf: string }, b: { uf: string }) => (ufName.get(a.uf) ?? a.uf).localeCompare(ufName.get(b.uf) ?? b.uf, "pt-BR");
  const readAss = assemblies.filter((a) => a.read).sort(byName);
  const unreadAss = assemblies.filter((a) => !a.read).sort(byName);

  return (
    <Container>
      <PageHeader
        title="Quem publica dados"
        lead="Nem toda prefeitura e câmara publica o que faz em formato aberto. Aqui está, estado por estado, em quantas cidades cada tipo de dado já está no site."
      />

      <section aria-labelledby="cidade-h" className="mb-8 rounded-md border border-border bg-surface p-4">
        <h2 id="cidade-h" className="sr-only">Buscar uma cidade</h2>
        <div className="max-w-xl">
          <CoverageSearch />
          <noscript>
          <form action="/dados-abertos" method="get" className="mt-3 flex gap-2">
            <label htmlFor="cov-q" className="sr-only">Nome da cidade</label>
            <input id="cov-q" name="q" defaultValue={q} placeholder="Nome da cidade" className="h-10 flex-1 rounded-sm border-[1.5px] border-border-input bg-surface px-3 text-sm text-fg" />
            <button className="h-10 rounded-pill border-[1.5px] border-border-input px-4 text-sm font-semibold text-fg">Buscar</button>
          </form>
          </noscript>
        </div>
        {results && (
          <div className="mt-4" aria-live="polite">
            <p className="mb-2 text-sm text-fg">{results.length ? `Cidades com “${q}”` : `Nenhuma cidade com “${q}”. Tente sem acento ou só o começo.`}</p>
            <ul className="flex flex-wrap gap-2">
              {results.map((p) => (
                <li key={p.ibge}>
                  <Link href={`/dados-abertos?cidade=${p.ibge}#cidade`} className="inline-flex h-9 items-center rounded-pill border-[1.5px] border-border-input px-3 text-sm font-semibold text-fg">
                    {p.name} · {p.uf}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {city && (
          <div id="cidade" className="mt-4 scroll-mt-32" data-testid="quadro-cidade">
            <h3 className="mb-2 text-lg font-semibold text-fg">
              {city.name} · {city.uf}
            </h3>
            {cityCoverage.length ? (
              <ul className="flex flex-col gap-1.5 text-sm text-fg">
                {cityCoverage.map((c) => (
                  <li key={c.dataset + c.label}>
                    <span className="font-semibold">{c.label}:</span> <span aria-hidden>—</span> {STATUS_TEXT[c.status] ?? c.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhum dado desta cidade está marcado como faltando.</p>
            )}
            <p className="mt-3 text-sm">
              <Link href={`/representantes?cidade=${city.ibge}`} className={link}>
                Ver quem representa {city.name}
              </Link>
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="matriz-h">
        <h2 id="matriz-h" className="mb-1 font-display text-2xl text-fg">Cidades com o dado no site, por estado</h2>
        <p className="mb-3 max-w-[68ch] text-sm text-muted">
          Cada número é a parte das cidades do estado em que o dado já está no site. “—” quer dizer que ainda não conferimos nenhuma cidade do estado:
          não é zero e não é “não publica”.{" "}
          {m.checkedOn && <>Última conferência: <time dateTime={m.checkedOn}>{date(m.checkedOn)}</time>. </>}
          Fonte: nossa conferência de cada órgão, com o link de evidência em cada cidade.
        </p>
        <div role="region" aria-label="Matriz de cobertura por estado" tabIndex={0} className="relative overflow-x-auto rounded-md border border-border outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm" data-testid="matriz">
            <caption className="sr-only">Porcentagem de cidades com o dado no site, por estado e tipo de dado</caption>
            <thead className="bg-surface-sunken text-xs text-muted">
              <tr>
                <th scope="col" className="sticky left-0 bg-surface-sunken px-3 py-2 font-semibold">Estado</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Cidades</th>
                {m.datasets.map((d) => (
                  <th key={d.key} scope="col" className="px-3 py-2 text-right font-semibold">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...m.rows, { uf: "BR", name: "Brasil", cities: m.total.cities, cells: m.total.cells }].map((r) => (
                <tr key={r.uf} data-uf={r.uf} className={`border-t border-border ${r.uf === "BR" ? "bg-surface-sunken font-semibold" : ""}`}>
                  <th scope="row" className="sticky left-0 bg-surface px-3 py-2 font-semibold text-fg">{r.name}</th>
                  <td className="tabular px-3 py-2 text-right text-fg">{count(r.cities)}</td>
                  {m.datasets.map((d) => {
                    const v = cellView(r.cells[d.key], r.cities);
                    return (
                      <td key={d.key} data-dataset={d.key} data-cities={v.cities} data-checked={v.checked} data-no-site={v.noSite} className="tabular px-3 py-2 text-right text-fg">
                        {v.pct === null ? (
                          <span title={`${d.label}: ainda não conferimos as cidades de ${r.name}`}>
                            <span aria-hidden>—</span>
                            <span className="sr-only">ainda não conferido</span>
                          </span>
                        ) : (
                          <>
                            {v.pct}%<span className="block text-xs font-normal text-muted">{count(v.checked)} conferidas</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ale-h" className="mt-10" data-testid="assembleias">
        <h2 id="ale-h" className="mb-1 font-display text-2xl text-fg">Assembleias Legislativas</h2>
        <p className="mb-3 max-w-[68ch] text-sm text-muted">
          Deputados estaduais: o que cada Assembleia publica em dado aberto e o que o site já lê. {count(readAss.length)} de {count(assemblies.length)} casas lidas.
        </p>
        <ul className="grid gap-3 md:grid-cols-2">
          {readAss.map((a) => (
            <li key={a.uf} data-uf={a.uf} className="rounded-md border border-border bg-surface p-4">
              <h3 className="text-base font-semibold text-fg">{a.houseName}</h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-fg">
                {a.items.map((it) => (
                  <li key={it.dataset} data-dataset={it.dataset} data-status={it.status}>
                    <span className="font-semibold">{it.label}:</span>{" "}
                    {it.status === "no_site" ? (
                      <>no site{it.refreshedAt && <span className="text-muted"> · carga de {date(it.refreshedAt)}</span>}</>
                    ) : (
                      <>
                        <span aria-hidden>—</span> {it.reason}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {a.source && (
                <p className="mt-2 font-mono text-xs text-muted">
                  Fonte:{" "}
                  <a href={a.source.url} className="underline underline-offset-2 hover:text-fg">
                    {a.source.name}
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
        {unreadAss.length > 0 && (
          <p className="mt-3 max-w-[68ch] text-sm text-fg" data-testid="assembleias-nao-lidas">
            <span className="font-semibold">Ainda não lidas ({count(unreadAss.length)}):</span> {unreadAss.map((a) => ufName.get(a.uf) ?? a.uf).join(", ")}. Nos
            crachás dos deputados destes estados, presença, votos, propostas e verbas aparecem como “—”, com o motivo.
          </p>
        )}
      </section>

      <section aria-labelledby="cta-h" className="mt-8 flex max-w-[68ch] flex-col items-start gap-2 rounded-md bg-accent-soft p-5">
        <h2 id="cta-h" className="text-lg font-semibold text-fg">A sua cidade publica e não aparece aqui?</h2>
        <p className="text-sm text-fg">Mande o endereço de onde o dado é publicado. Conferimos, e se for aberto e oficial, entra na fila de carga.</p>
        <Link href="/sugestoes?tipo=dado" className="inline-flex h-10 items-center rounded-pill bg-accent px-5 text-sm font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Indicar onde o dado é publicado
        </Link>
      </section>
    </Container>
  );
}
