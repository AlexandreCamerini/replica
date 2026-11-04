import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { RelationshipDiagram } from "@/components/cargos/relationship-diagram";
import { CF_URL, OFFICES, RELATIONS, type Office } from "@/content/cargos";

export const metadata: Metadata = {
  title: "Entenda os cargos",
  description: "O que faz cada cargo eletivo, o que pode e não pode, por quanto tempo, como é eleito e quem fiscaliza, com o artigo da Constituição.",
};

const link = "font-semibold text-accent-text underline underline-offset-2";

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-fg">{title}</h4>
      <ul className="ml-5 flex list-disc flex-col gap-1 text-sm text-fg">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function OfficeCard({ o }: { o: Office }) {
  return (
    <section id={o.slug} aria-labelledby={`${o.slug}-h`} className="scroll-mt-32 rounded-sm border border-border bg-surface p-4 md:p-5">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {o.sphere} · {o.kind === "eletivo" ? "Cargo eletivo" : "Cargo nomeado, não eletivo"}
      </p>
      <h3 id={`${o.slug}-h`} className="font-display text-2xl text-fg">
        {o.name}
      </h3>
      <p className="mt-2 max-w-[68ch] text-base text-fg">{o.summary}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <List title="O que faz" items={o.does} />
        <List title="O que pode" items={o.can} />
        <List title="O que não pode" items={o.cannot} />
        <List title="Quem fiscaliza" items={o.oversight} />
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-3 text-sm md:grid-cols-2">
        <div>
          <dt className="font-semibold text-fg">Mandato</dt>
          <dd className="text-fg">{o.term}</dd>
        </div>
        <div>
          <dt className="font-semibold text-fg">Como é {o.kind === "eletivo" ? "eleito" : "escolhido"}</dt>
          <dd className="text-fg">{o.how}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-muted">
        Base: Constituição Federal,{" "}
        <a href={CF_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {o.refs.join("; ")}
        </a>
        .
        {o.terms && (
          <>
            {" "}
            No dicionário:{" "}
            {o.terms.map((t, i) => (
              <span key={t.slug}>
                {i > 0 && ", "}
                <Link href={`/dicionario#termo-${t.slug}`} className={link}>
                  {t.label}
                </Link>
              </span>
            ))}
            .
          </>
        )}
      </p>
    </section>
  );
}

export default function Page() {
  return (
    <Container>
      <PageHeader
        title="Entenda os cargos"
        lead="O que cada cargo faz, o que pode e não pode, quanto dura, como se chega a ele e quem o fiscaliza. O texto é nosso e cada ponto traz o artigo da Constituição."
      />
      <nav aria-label="Cargos" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          {OFFICES.map((o) => (
            <li key={o.slug}>
              <a
                href={`#${o.slug}`}
                className="inline-flex min-h-9 items-center rounded-pill bg-surface-sunken px-3 text-sm font-semibold text-fg outline-none hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus"
              >
                {o.name.split(" e ")[0]}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section id="quem-faz-o-que" aria-labelledby="rel-h" className="mb-10 scroll-mt-32">
        <h2 id="rel-h" className="mb-2 font-display text-2xl text-fg">
          Quem faz o quê com quem
        </h2>
        <p className="mb-4 max-w-[68ch] text-base text-fg">
          Os poderes foram desenhados para que um limite o outro. O desenho mostra o essencial; a lista logo abaixo traz todas as
          relações, com o artigo.
        </p>
        <RelationshipDiagram />
        <h3 className="mb-2 mt-6 font-display text-xl text-fg">Em lista</h3>
        <ol className="flex flex-col gap-2">
          {RELATIONS.map((r) => (
            <li key={r.who + r.does + r.whom} className="rounded-sm border border-border bg-surface p-3 text-sm">
              <p className="text-base text-fg">
                <strong>{r.who}</strong> {r.does} <strong>{r.whom}</strong>
              </p>
              <p className="text-fg">{r.how}</p>
              <p className="text-muted">
                Base:{" "}
                <a href={CF_URL} target="_blank" rel="noopener noreferrer" className={link}>
                  CF, {r.ref}
                </a>
              </p>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col gap-6">
        <h2 className="font-display text-2xl text-fg">Os cargos, um a um</h2>
        {OFFICES.map((o) => (
          <OfficeCard key={o.slug} o={o} />
        ))}
      </div>

      <p className="mt-8 max-w-[68ch] text-sm text-muted">
        Este resumo explica o que a Constituição de 1988 diz e não substitui a leitura da lei. Estados e municípios têm constituições
        e leis orgânicas próprias, que podem acrescentar regras dentro dos limites federais. Dúvida sobre um termo? Veja o{" "}
        <Link href="/dicionario" className={link}>
          Dicionário
        </Link>
        . Achou um erro?{" "}
        <Link href="/sugestoes?tipo=erro" className={link}>
          Avise
        </Link>
        .
      </p>
    </Container>
  );
}
