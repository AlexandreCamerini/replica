import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { EstadoZoom, MapaBrasil } from "@/components/votos/mapa-brasil";
import { Barra, Barra513, Sq, Trilha, VotacaoChips, VotoLegenda, votoTexto } from "@/components/votos/ui";
import { NAMES, SEATS, UFS, VOTES, camaraUrl, findDeputy, fora, groupsOf, history, isUf, jaDecididoHref, nk, pctText, stateSentence, voteIndex } from "@/lib/votacoes";

export const metadata: Metadata = {
  title: "Já decidido",
  description: "Como os 513 deputados votaram nas decisões sobre dinheiro público, estado por estado, nome por nome.",
};

type Props = { searchParams: Promise<{ v?: string; uf?: string; dep?: string }> };

/** Três níveis num endereço só: Brasil › estado › deputado. Cada toque é um link; trocar a votação mantém o nível. */
export default async function JaDecidido({ searchParams }: Props) {
  const sp = await searchParams;
  const v = voteIndex(sp.v);
  const V = VOTES[v];
  const uf = isUf(sp.uf) ? sp.uf : null;
  const depId = uf && /^\d{1,7}$/.test(sp.dep ?? "") ? Number(sp.dep) : null;
  const dep = depId ? findDeputy(depId) : null;
  const lvl = dep ? 2 : uf ? 1 : 0;
  const t = V.total;

  return (
    <Container className="max-w-[1320px]">
      <header className="mb-4 flex flex-col gap-3">
        <p className="lbl">Já decidido · Câmara dos Deputados · 6 votações nominais sobre dinheiro público</p>
        <h1 className="font-serif text-[32px] leading-[1.1] font-medium text-fg md:text-[40px]">Como os deputados votaram</h1>
        <p className="max-w-[70ch] text-base text-muted">
          Sim é cheio, Não é hachurado, abstenção é pontilhado, sem voto é vazio. Nenhuma cor diz lado. Toque num estado, depois num nome.
        </p>
      </header>

      <VotacaoChips v={v} uf={uf} dep={depId} />

      <div className="mt-4 grid gap-7 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start">
        <section className="plate min-w-0" aria-live="polite">
          <div className="px-4 pt-4 pb-3">
            <Trilha
              items={
                lvl === 0
                  ? [{ label: "Brasil" }]
                  : lvl === 1
                    ? [{ label: "Brasil", href: jaDecididoHref(v) }, { label: NAMES[uf!] }]
                    : [{ label: "Brasil", href: jaDecididoHref(v) }, { label: NAMES[uf!], href: jaDecididoHref(v, uf) }, { label: dep!.name }]
              }
            />
          </div>

          {lvl === 0 && (
            <>
              <div className="flex flex-col gap-1.5 px-4 pb-3">
                <span className="lbl">
                  Nível 1 de 3 · Brasil · {V.label} · {V.date}
                </span>
                <h2 className="font-serif text-[28px] leading-[1.1] font-medium text-fg">{V.what}</h2>
                <p className="text-[15px] text-muted">Cada estado enche, de baixo para cima, até a parte dos deputados que votou Sim.</p>
              </div>
              <div className="px-2">
                <MapaBrasil byUf={V.uf} hrefFor={(u) => jaDecididoHref(v, u)} />
              </div>
              <nav aria-label="Estados" className="border-t border-border px-4 py-3">
                <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-9">
                  {[...UFS].sort((a, b) => SEATS[b] - SEATS[a] || a.localeCompare(b)).map((u) => (
                    <li key={u}>
                      <Link
                        href={jaDecididoHref(v, u)}
                        aria-label={`${NAMES[u]}, ${pctText(V.uf[u])} de Sim`}
                        className="flex min-h-11 flex-col items-center justify-center border border-border bg-surface px-1 py-1 outline-none hover:border-fg focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        <span className="font-mono text-xs font-semibold text-fg">{u}</span>
                        <span className="font-display text-base font-bold text-fg">{pctText(V.uf[u])}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <p className="border-t border-border px-4 py-2.5 font-mono text-xs text-muted">
                % calculado só entre quem votou (Sim, Não ou abstenção). 14 estados têm até 10 deputados: neles, 1 voto muda o % em 10 pontos ou
                mais.
              </p>
            </>
          )}

          {lvl === 1 && uf && (
            <>
              <div className="grid gap-4 px-4 pb-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start">
                <EstadoZoom uf={uf} c={V.uf[uf]} className="mx-auto h-[180px] w-full max-w-[200px]" />
                <div className="flex flex-col gap-2">
                  <span className="lbl">
                    Nível 2 de 3 · {NAMES[uf]} · {V.label} · {V.date}
                  </span>
                  <p className="flex items-baseline gap-2">
                    <span className="font-display text-[56px] leading-none font-bold text-fg">{pctText(V.uf[uf])}</span>
                    <span className="text-sm text-muted">de Sim entre quem votou</span>
                  </p>
                  <p className="font-serif text-[22px] leading-snug text-fg">{stateSentence(uf, V.uf[uf])}</p>
                  <Barra c={V.uf[uf]} total={SEATS[uf]} label={`${V.uf[uf][0]} Sim · ${V.uf[uf][1]} Não · ${V.uf[uf][2]} abstenção · ${fora(V.uf[uf])} fora`} />
                </div>
              </div>
              <div className="flex flex-col gap-5 border-t border-border px-4 py-4">
                {groupsOf(V, uf).map((g) => (
                  <section key={g.k} aria-labelledby={`g-${g.k}`}>
                    <h3 id={`g-${g.k}`} className="mb-2 flex items-center gap-2 font-sans text-sm font-semibold text-fg">
                      <Sq k={g.k} /> {g.title}
                    </h3>
                    <ul className="grid gap-x-4 sm:grid-cols-2">
                      {g.list.map((d) => (
                        <li key={d.id}>
                          <Link
                            href={jaDecididoHref(v, uf, d.id)}
                            className="flex min-h-11 items-center justify-between gap-2 border-b border-border text-sm text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                          >
                            <span className="min-w-0 truncate">{d.name}</span>
                            <span className="font-mono text-xs text-muted">{d.party}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {V.uf[uf][4] > 0 && (
                  <p className="text-sm text-muted">
                    <Sq k="X" className="mr-1.5" />
                    {nk(V.uf[uf][4], "não registrou voto", "não registraram voto")}. A Câmara publica só quem votou; não nomeamos ausência.
                  </p>
                )}
              </div>
            </>
          )}

          {lvl === 2 && uf && dep && (
            <>
              <div className="flex flex-col gap-2 px-4 pb-4">
                <span className="lbl">
                  Nível 3 de 3 · {dep.name} · {dep.party} · {uf}
                </span>
                <h2 className="font-serif text-[28px] leading-[1.1] font-medium text-fg">{dep.name}</h2>
                <p className="flex items-center gap-2 text-base text-fg">
                  <Sq k={history(dep.id)[v].k} /> {votoTexto(history(dep.id)[v].k)} em {V.label}, {V.date}
                </p>
                <p className="text-[15px] text-muted">{V.what}</p>
                <a href={camaraUrl(dep.id)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-fg underline underline-offset-2">
                  Página oficial na Câmara
                </a>
              </div>
              <div className="border-t border-border px-4 py-3">
                <h3 className="lbl mb-2">Nas 6 votações sobre dinheiro público</h3>
                <ol>
                  {history(dep.id).map((h) => (
                    <li
                      key={h.vote.id}
                      className={`grid min-h-[52px] items-center gap-3 border-t border-border py-2 sm:grid-cols-[130px_minmax(0,1fr)_170px] ${h.i === v ? "bg-bg -mx-4 px-4" : ""}`}
                    >
                      <Link href={jaDecididoHref(h.i, uf, dep.id)} className="font-mono text-xs font-semibold text-fg underline-offset-2 hover:underline">
                        {h.vote.label}
                        <span className="block font-normal text-muted">{h.vote.date}</span>
                      </Link>
                      <span className="text-sm text-fg">{h.vote.what}</span>
                      <span className="flex items-center gap-2 text-sm text-fg">
                        <Sq k={h.k} /> {votoTexto(h.k)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="plate flex flex-col gap-3 p-4" aria-labelledby="placar-h">
            <h2 id="placar-h" className="lbl font-sans">
              Placar da Câmara · {V.label} · {V.date}
            </h2>
            <p className="font-serif text-[20px] leading-snug text-fg">{V.what}</p>
            <dl className="grid grid-cols-4 gap-2">
              {[
                ["Sim", t[0], "S"],
                ["Não", t[1], "N"],
                ["Abst.", t[2], "A"],
                ["Fora", fora(t), "X"],
              ].map(([l, n, k]) => (
                <div key={String(l)} className="flex flex-col gap-1">
                  <dt className="flex items-center gap-1.5 text-xs text-muted">
                    <Sq k={k as "S"} /> {l}
                  </dt>
                  <dd className="font-display text-[36px] leading-none font-bold text-fg tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <Barra513 c={t} />
            <VotoLegenda />
          </section>
          <section className="plate flex flex-col gap-2 p-4 text-sm text-muted">
            <h2 className="lbl font-sans">Sobre estes dados</h2>
            <p>Fonte: Câmara dos Deputados, dados abertos (votações nominais). Cadeiras por estado: TSE. Malhas: IBGE (CC BY 4.0).</p>
            <p>&quot;Fora&quot; soma quem não registrou voto e quem presidia a sessão. Só quem votou é nomeado.</p>
            <Link href="/como-escolhemos" className="font-medium text-fg underline underline-offset-2">
              Como escolhemos e como mostramos
            </Link>
          </section>
        </aside>
      </div>
    </Container>
  );
}
