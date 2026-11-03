import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { Dash, LinkChip, Notice, qs, TableRegion, UF_LIST } from "@/components/page/w4";
import { SourceFooter } from "@/components/ui/data";
import { data } from "@/lib/data";
import type { ElectionContest, ElectionResult, OfficeSlug } from "@/lib/data";
import { count } from "@/lib/format";

export const metadata: Metadata = {
  title: "Eleições",
  description: "Resultados de eleições por lugar e por cargo: Brasil, estado e município, a partir dos votos do TSE já carregados.",
};
export const dynamic = "force-dynamic";

const RESULT: Record<ElectionResult, string> = {
  eleito: "Eleito",
  eleito_qp: "Eleito (quociente partidário)",
  eleito_media: "Eleito (por média)",
  suplente: "Suplente",
  nao_eleito: "Não eleito",
  segundo_turno: "Foi ao 2º turno",
  indeferido: "Candidatura indeferida",
  renuncia: "Renunciou",
};
const MAJORITARIAN = new Set<OfficeSlug>(["presidente", "governador", "senador", "prefeito"]);
const MUNICIPAL = new Set<OfficeSlug>(["prefeito", "vereador"]);
const PAGE = 60;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const years = await data.listElectionYears();
  const year = years.find((y) => y.year === Number(one(sp.ano)))?.year ?? years[0]?.year;
  const overview = year ? await data.getElectionOverview(year) : [];
  const offices = [...new Map(overview.map((o) => [o.office, o.label])).entries()];
  const cargoParam = one(sp.cargo);
  const office = offices.find(([slug]) => slug === cargoParam)?.[0] as OfficeSlug | undefined;
  const uf = UF_LIST.includes(one(sp.uf) ?? "") ? one(sp.uf) : undefined;
  const mun = /^\d{7}$/.test(one(sp.mun) ?? "") ? one(sp.mun) : undefined;
  const pg = Math.max(0, Number(one(sp.pg) ?? 0) || 0);
  const stamp = await data.getStamp("tse.votos");

  let contests: { items: ElectionContest[]; total: number } | null = null;
  const needsUf = office ? MUNICIPAL.has(office) && !uf && !mun : false;
  if (year && office && !needsUf) {
    contests = await data.listElectionContests({ year, office, uf, ibge: mun, offset: pg * PAGE, limit: mun || (uf && !MUNICIPAL.has(office)) ? 8 : PAGE });
  }
  const detail = Boolean(mun || (uf && !MUNICIPAL.has(office ?? "presidente")) || office === "presidente");
  const base = { ano: year, cargo: office };

  return (
    <Container>
      <PageHeader
        title="Eleições"
        lead="Quem disputou e quem venceu, por cargo e por lugar: do Brasil ao estado e ao município. O que está aqui é o que já carregamos dos dados abertos do TSE, e cada tela diz o que ficou de fora."
        crumbs={[{ href: "/eleicoes", label: "Eleições" }, ...(year ? [{ href: `/eleicoes${qs({ ano: year })}`, label: String(year) }] : [])]}
      />

      <nav aria-label="Ano da eleição" className="mb-4 flex flex-wrap gap-2" data-testid="anos">
        {years.map((y) => (
          <LinkChip key={y.year} href={`/eleicoes${qs({ ano: y.year })}`} current={y.year === year}>
            {y.year} · {y.kind === "geral" ? "geral" : "municipal"}
          </LinkChip>
        ))}
      </nav>

      <Notice title="Antes de ler os números" id="cobertura">
        <p>
          “Carregado” quer dizer: está no nosso banco. Guardamos as candidaturas de quem tem crachá (quem ocupa ou vai ocupar cargo hoje, mais os que disputaram
          segundo turno ou foram identificados por elas). Por isso a contagem de candidaturas é menor que a registrada pelo TSE, e uma disputa antiga pode mostrar
          o vencedor sem os derrotados. Nada aqui é apuração ao vivo.
        </p>
        <p>
          Voto de <strong>presidente</strong> fica em “—”: o arquivo do TSE chega com a eleição presidencial em dois pacotes e nossa carga somou os dois, dobrando o
          número. Até a recarga, preferimos não mostrar um total errado. Votos de 2012 a 2016 não estão carregados.
        </p>
      </Notice>

      <section aria-labelledby="pan-h" className="mt-8">
        <h2 id="pan-h" className="mb-3 font-display text-2xl text-fg">Panorama de {year}</h2>
        <TableRegion label={`Cargos disputados em ${year}`}>
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm" data-testid="panorama">
            <caption className="sr-only">Cargos e turnos de {year}, com as disputas, candidaturas e eleitos carregados</caption>
            <thead className="bg-surface-sunken text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Cargo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Turno</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Disputas</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Candidaturas carregadas</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Eleitos carregados</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((o) => (
                <tr key={`${o.office}-${o.round}`} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 font-semibold">
                    <Link href={`/eleicoes${qs({ ano: year, cargo: o.office })}`} className="text-accent-text underline underline-offset-2">{o.label}</Link>
                  </th>
                  <td className="px-3 py-2">{o.round}º</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(o.contests)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(o.candidacies)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{count(o.elected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </section>

      {office && (
        <section aria-labelledby="cargo-h" className="mt-10" data-testid="cargo">
          <h2 id="cargo-h" className="mb-1 font-display text-2xl text-fg">
            {offices.find(([s]) => s === office)?.[1]} · {year}
          </h2>

          {office !== "presidente" && (
            <nav aria-label="Estado" className="my-3 flex flex-wrap gap-1.5" data-testid="ufs">
              <LinkChip href={`/eleicoes${qs(base)}`} current={!uf && !mun}>Todos</LinkChip>
              {UF_LIST.map((u) => (
                <LinkChip key={u} href={`/eleicoes${qs({ ...base, uf: u })}`} current={u === uf}>{u}</LinkChip>
              ))}
            </nav>
          )}

          {needsUf && (
            <p className="rounded-md border border-dashed border-border-input p-4 text-sm text-muted" data-testid="escolha-uf">
              São mais de 5 mil municípios: escolha um estado para ver a lista dele.
            </p>
          )}

          {contests && contests.items.length === 0 && (
            <p className="text-sm text-muted">Nenhuma disputa carregada para este recorte.</p>
          )}

          {contests && contests.items.length > 0 && !detail && (
            <>
              <TableRegion label="Disputas">
                <table className="w-full min-w-[34rem] border-collapse text-left text-sm" data-testid="disputas">
                  <caption className="sr-only">Disputas em ordem alfabética do lugar</caption>
                  <thead className="bg-surface-sunken text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Lugar</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Turno</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Candidaturas carregadas</th>
                      <th scope="col" className="px-3 py-2 font-semibold">{MAJORITARIAN.has(office) ? "Eleito" : "Eleitos carregados"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contests.items.map((c) => (
                      <tr key={`${c.placeIbge}-${c.round}`} className="border-t border-border align-top">
                        <th scope="row" className="px-3 py-2 font-semibold">
                          <Link
                            href={`/eleicoes${qs(MUNICIPAL.has(office) ? { ...base, uf: c.uf, mun: c.placeIbge } : { ...base, uf: c.uf })}`}
                            className="text-accent-text underline underline-offset-2"
                          >
                            {c.placeName}
                          </Link>
                          {MUNICIPAL.has(office) && c.uf ? <span className="text-muted"> · {c.uf}</span> : null}
                        </th>
                        <td className="px-3 py-2">{c.round}º</td>
                        <td className="px-3 py-2 text-right tabular-nums">{count(c.candidates.length)}</td>
                        <td className="px-3 py-2">
                          {MAJORITARIAN.has(office) ? (
                            c.candidates.filter((x) => x.result?.startsWith("eleito")).map((x) => `${x.name} (${x.party})`).join(", ") || <Dash why="vencedor não carregado: o banco guarda candidaturas de quem tem crachá" />
                          ) : (
                            count(c.elected)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
              {contests.total > PAGE && (
                <p className="mt-3 flex items-center gap-3 text-sm">
                  <span className="text-muted">Lugares {pg * PAGE + 1}–{Math.min(contests.total, (pg + 1) * PAGE)} de {count(contests.total)}, em ordem alfabética.</span>
                  {pg > 0 && <Link className="font-semibold text-accent-text underline" href={`/eleicoes${qs({ ...base, uf, pg: pg - 1 || undefined })}`}>Anteriores</Link>}
                  {(pg + 1) * PAGE < contests.total && <Link className="font-semibold text-accent-text underline" href={`/eleicoes${qs({ ...base, uf, pg: pg + 1 })}`}>Próximos</Link>}
                </p>
              )}
            </>
          )}

          {contests && contests.items.length > 0 && detail &&
            contests.items.map((c) => (
              <article key={`${c.placeIbge}-${c.round}`} className="mt-6" data-testid="disputa">
                <h3 className="mb-2 text-lg font-semibold text-fg">
                  {c.placeName}
                  {c.uf && c.placeIbge.length === 7 ? ` · ${c.uf}` : ""} · {c.round}º turno
                </h3>
                <TableRegion label={`Candidaturas em ${c.placeName}, ${c.round}º turno`}>
                  <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                    <caption className="sr-only">Candidaturas carregadas, em ordem de votos quando há voto, depois pelo nome</caption>
                    <thead className="bg-surface-sunken text-xs text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">Candidato</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Nº</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Partido</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Resultado</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Votos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.candidates.map((x) => (
                        <tr key={x.slug} className="border-t border-border">
                          <th scope="row" className="px-3 py-2 font-semibold">
                            <Link href={`/p/${x.slug}`} className="text-accent-text underline underline-offset-2">{x.name}</Link>
                          </th>
                          <td className="px-3 py-2 tabular-nums">{x.number ?? <Dash why="número não carregado" />}</td>
                          <td className="px-3 py-2">{x.party}</td>
                          <td className="px-3 py-2">{x.result ? RESULT[x.result] : <Dash why="resultado não carregado" />}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {x.votes !== null ? count(x.votes) : <Dash why={office === "presidente" ? "voto de presidente suspenso até a recarga: o arquivo do TSE foi somado duas vezes" : "voto não carregado para esta eleição"} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableRegion>
                <p className="mt-2 text-xs text-muted">
                  {count(c.candidates.length)} candidaturas carregadas, {count(c.elected)} com resultado de eleito. Votos são absolutos: sem porcentagem, porque o total de votos válidos da disputa não está no banco.
                </p>
              </article>
            ))}
        </section>
      )}

      <SourceFooter source={stamp.source} href={stamp.sourceUrl} updatedAt={stamp.refreshedAt} />
    </Container>
  );
}
