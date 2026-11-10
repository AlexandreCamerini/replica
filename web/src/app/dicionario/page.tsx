import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { THEMES, TERMS } from "@/content/dicionario";

export const metadata: Metadata = {
  title: "Dicionário",
  description: "Termos da política em linguagem simples, com a fonte oficial de cada um.",
};

const link = "font-semibold text-accent-text underline underline-offset-2";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 80);
  const temaRaw = first(sp.tema);
  const tema = THEMES.find((t) => t.id === temaRaw)?.id ?? "";
  const nq = norm(q);

  const list = TERMS.filter((t) => (!tema || t.tema === tema) && (!nq || norm(t.termo).includes(nq) || norm(t.def).includes(nq)));
  const counts = Object.fromEntries(THEMES.map((th) => [th.id, TERMS.filter((t) => t.tema === th.id).length]));
  const byLetter = new Map<string, typeof list>();
  for (const t of list) {
    const L = norm(t.termo)[0]!.toUpperCase();
    byLetter.set(L, [...(byLetter.get(L) ?? []), t]);
  }
  const themeHref = (id: string) => {
    const p = new URLSearchParams();
    if (id) p.set("tema", id);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/dicionario?${s}` : "/dicionario";
  };

  return (
    <Container>
      <PageHeader
        title="Dicionário"
        lead="Os termos da política em linguagem simples. Cada um traz a fonte oficial, para você conferir."
      />

      <form action="/dicionario" method="get" role="search" aria-label="Procurar no dicionário" className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="dic-q" className="text-sm font-semibold text-fg">
            Procurar um termo
          </label>
          <input
            id="dic-q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={80}
            autoComplete="off"
            placeholder="Por exemplo: veto, quórum"
            className="min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dic-tema" className="text-sm font-semibold text-fg">
            Tema
          </label>
          <select
            id="dic-tema"
            name="tema"
            defaultValue={tema}
            className="min-h-11 rounded-sm border border-border bg-surface px-3 text-base text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            <option value="">Todos</option>
            {THEMES.map((th) => (
              <option key={th.id} value={th.id}>
                {th.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-sm bg-accent px-5 text-base font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Procurar no dicionário
        </button>
      </form>

      <nav aria-label="Filtrar por tema" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {[{ id: "", label: "Todos" }, ...THEMES].map((th) => {
            const on = th.id === tema;
            return (
              <li key={th.id || "todos"}>
                <Link
                  href={themeHref(th.id)}
                  aria-current={on ? "true" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-pill px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus ${
                    on ? "bg-accent text-on-accent" : "bg-surface-sunken text-fg hover:bg-accent-soft"
                  }`}
                >
                  {th.label}
                  <span className="ml-1 font-normal opacity-80">({th.id ? counts[th.id] : TERMS.length})</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Índice de A a Z" className="mb-6">
        <ul className="flex flex-wrap gap-1">
          {LETTERS.map((L) => (
            <li key={L}>
              {byLetter.has(L) ? (
                <a
                  href={`#letra-${L}`}
                  className="inline-flex size-9 items-center justify-center rounded-sm bg-surface-sunken text-sm font-semibold text-fg outline-none hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus"
                >
                  {L}
                </a>
              ) : (
                <span aria-hidden className="inline-flex size-9 items-center justify-center text-sm text-muted">
                  {L}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <p role="status" className="mb-4 text-sm text-muted">
        {list.length === 0
          ? "Nenhum termo encontrado."
          : `${list.length} ${list.length === 1 ? "termo" : "termos"}${tema ? ` em “${THEMES.find((t) => t.id === tema)!.label}”` : ""}${q ? ` para “${q}”` : ""}.`}{" "}
        {(q || tema) && (
          <Link href="/dicionario" className={link}>
            Limpar filtros
          </Link>
        )}
      </p>

      {list.length === 0 ? (
        <p className="max-w-[60ch] rounded-sm border border-border bg-surface p-4 text-base text-fg">
          Não achamos esse termo. Tente uma palavra mais curta, sem acento, ou escolha um tema. Falta um termo?{" "}
          <Link href="/sugestoes?tipo=ideia" className={link}>
            Sugira
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {THEMES.filter((th) => list.some((t) => t.tema === th.id)).map((th) => (
            <section key={th.id} id={`tema-${th.id}`} aria-labelledby={`tema-${th.id}-h`} className="scroll-mt-32">
              <h2 id={`tema-${th.id}-h`} className="mb-3 border-b border-border pb-2 font-display text-2xl text-fg">
                {th.label}
              </h2>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {list
                  .filter((t) => t.tema === th.id)
                  .map((t) => (
                    <li key={t.slug} id={`termo-${t.slug}`} className="scroll-mt-32 min-w-0 rounded-sm border border-border bg-surface p-4 target:border-accent target:ring-2 target:ring-focus">
                      <h3 className="font-display text-lg text-fg [overflow-wrap:anywhere]">{t.termo}</h3>
                      <p className="mt-1 text-base text-fg">{t.def}</p>
                      <p className="mt-2 text-sm text-muted">
                        Fonte:{" "}
                        <a href={t.source.href} target="_blank" rel="noopener noreferrer" className={link}>
                          {t.source.label}
                        </a>
                      </p>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <section id="indice" aria-labelledby="indice-h" className="mt-10 scroll-mt-32 border-t border-border pt-6">
          <h2 id="indice-h" className="mb-3 font-display text-2xl text-fg">
            Índice de A a Z
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...byLetter.entries()].map(([L, ts]) => (
              <div key={L} id={`letra-${L}`} className="scroll-mt-32">
                <h3 className="text-lg font-bold text-fg">{L}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {ts.map((t) => (
                    <li key={t.slug}>
                      <a href={`#termo-${t.slug}`} className={link}>
                        {t.termo}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 max-w-[68ch] text-sm text-muted">
        As definições são resumos nossos, escritos para quem não é do ramo; o texto da lei é o que vale. Quer ver os cargos?{" "}
        <Link href="/cargos" className={link}>
          Entenda os cargos
        </Link>
        .
      </p>
    </Container>
  );
}
