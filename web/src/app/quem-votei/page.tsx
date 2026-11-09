import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { Esquecer, Lembrar } from "@/components/votos/lembrar";
import { EstadoZoom } from "@/components/votos/mapa-brasil";
import { Sq, VotoLegenda, votoTexto } from "@/components/votos/ui";
import { NAMES, SEATS, UFS, VOTES, camaraUrl, deputiesOf, findDeputy, history, isUf, jaDecididoHref, pctText } from "@/lib/votacoes";

export const metadata: Metadata = {
  title: "Quem eu votei",
  description: "Escolha a pessoa em quem votou e veja como ela votou nas 6 decisões sobre dinheiro público.",
};

type Props = { searchParams: Promise<{ uf?: string; q?: string; dep?: string }> };

const Passo = ({ n, title, on }: { n: number; title: string; on: boolean }) => (
  <li className={`flex items-center gap-2 border px-3 py-1.5 text-sm ${on ? "border-fg bg-surface-inverse text-on-inverse" : "border-border text-muted"}`}>
    <span className="font-mono text-xs">{n}</span> {title}
  </li>
);

/** Três passos num endereço só: estado › nome › painel. Sem JS tudo funciona; a memória da escolha é só do aparelho. */
export default async function QuemVotei({ searchParams }: Props) {
  const sp = await searchParams;
  const uf = isUf(sp.uf) ? sp.uf : null;
  const q = sp.q?.trim().slice(0, 60) || "";
  const depId = uf && /^\d{1,7}$/.test(sp.dep ?? "") ? Number(sp.dep) : null;
  const dep = depId ? findDeputy(depId) : null;
  const step = dep ? 3 : uf ? 2 : 1;
  const list = uf ? deputiesOf(uf, q) : [];

  return (
    <Container className="max-w-[1320px]">
      <header className="mb-4 flex flex-col gap-3">
        <p className="lbl">Quem eu votei · deputado federal · 6 votações sobre dinheiro público</p>
        <h1 className="font-serif text-[32px] leading-[1.1] font-medium text-fg md:text-[40px]">Como votou quem você escolheu</h1>
        <p className="max-w-[70ch] text-base text-muted">
          Só quem registrou voto em alguma das 6 votações aparece na lista. A Câmara não publica ausência, e não nomeamos quem não votou.
        </p>
      </header>

      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Passos">
        <Passo n={1} title="Estado" on={step === 1} />
        <Passo n={2} title="Nome" on={step === 2} />
        <Passo n={3} title="Painel" on={step === 3} />
      </ol>

      {step === 1 && (
        <section className="plate p-4" aria-labelledby="p1">
          <h2 id="p1" className="mb-3 font-sans text-base font-semibold text-fg">
            1. Em que estado você votou?
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
            {UFS.map((u) => (
              <li key={u}>
                <Link
                  href={`/quem-votei?uf=${u}`}
                  className="flex min-h-11 flex-col items-center justify-center border border-border bg-surface px-1 py-1 outline-none hover:border-fg focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="font-mono text-xs font-semibold text-fg">{u}</span>
                  <span className="text-xs text-muted">{SEATS[u]} cadeiras</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 2 && uf && (
        <section className="plate p-4" aria-labelledby="p2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="p2" className="font-sans text-base font-semibold text-fg">
              2. Quem você escolheu em {NAMES[uf]}?
            </h2>
            <Link href="/quem-votei" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
              Trocar o estado
            </Link>
          </div>
          <form action="/quem-votei" className="mb-3 flex flex-wrap gap-2">
            <input type="hidden" name="uf" value={uf} />
            <label className="sr-only" htmlFor="q">
              Nome ou partido
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={60}
              placeholder="Nome ou sigla do partido"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 border border-fg bg-surface px-3 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <button type="submit" className="h-11 border border-fg bg-surface-inverse px-4 text-sm font-semibold text-on-inverse">
              Buscar
            </button>
          </form>
          <p className="mb-2 text-sm text-muted" aria-live="polite">
            {list.length === 0 ? "Ninguém com esse nome registrou voto." : list.length === 1 ? "1 pessoa" : `${list.length} pessoas`}
            {q && (
              <>
                {" "}
                ·{" "}
                <Link href={`/quem-votei?uf=${uf}`} className="underline underline-offset-2">
                  limpar a busca
                </Link>
              </>
            )}
          </p>
          <ul className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/quem-votei?uf=${uf}&dep=${d.id}`}
                  className="flex min-h-11 items-center justify-between gap-2 border-b border-border text-sm text-fg outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="min-w-0 truncate">{d.name}</span>
                  <span className="font-mono text-xs text-muted">{d.party}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 3 && uf && dep && (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          <section className="plate" aria-labelledby="p3">
            <div className="flex flex-col gap-2 px-4 pt-4 pb-4">
              <span className="lbl">
                3. Painel · {dep.party} · {NAMES[uf]}
              </span>
              <h2 id="p3" className="font-serif text-[28px] leading-[1.1] font-medium text-fg">
                {dep.name}
              </h2>
              <Lembrar dep={dep} href={`/quem-votei?uf=${uf}&dep=${dep.id}`} />
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={camaraUrl(dep.id)} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline underline-offset-2">
                  Página oficial na Câmara
                </a>
                <Link href={`/quem-votei?uf=${uf}`} className="text-muted underline underline-offset-2 hover:text-fg">
                  Trocar a pessoa
                </Link>
                <Esquecer />
              </p>
            </div>
            <div className="border-t border-border px-4 py-3">
              <h3 className="lbl mb-2">Nas 6 votações sobre dinheiro público</h3>
              <ol>
                {history(dep.id).map((h) => (
                  <li key={h.vote.id} className="grid min-h-[52px] items-center gap-3 border-t border-border py-2 sm:grid-cols-[130px_minmax(0,1fr)_170px]">
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
              <div className="mt-3">
                <VotoLegenda />
              </div>
            </div>
          </section>

          <aside className="plate flex flex-col gap-3 p-4" aria-labelledby="estado-h">
            <h2 id="estado-h" className="lbl font-sans">
              E o estado · {NAMES[uf]} · {SEATS[uf]} cadeiras
            </h2>
            <EstadoZoom uf={uf} c={VOTES[0].uf[uf]} className="mx-auto h-[140px] w-full max-w-[180px]" />
            <ul className="flex flex-col">
              {VOTES.map((x, i) => (
                <li key={x.id} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm">
                  <Link href={jaDecididoHref(i, uf)} className="font-mono text-xs font-semibold text-fg underline-offset-2 hover:underline">
                    {x.label}
                  </Link>
                  <span className="font-display text-lg font-bold text-fg tabular">{pctText(x.uf[uf])}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">% de Sim entre quem votou, em cada votação. O contorno enche pela primeira.</p>
          </aside>
        </div>
      )}
    </Container>
  );
}
