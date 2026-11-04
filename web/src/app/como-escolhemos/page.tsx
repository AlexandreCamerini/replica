import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { data } from "@/lib/data";
import { date } from "@/lib/format";

export const metadata: Metadata = {
  title: "Como escolhemos",
  description: "As regras fixas e públicas que decidem quais propostas aparecem e como as respostas são escritas.",
};
export const revalidate = 3600;

// O que mudou em cada versão. A regra em si vem do banco (pocket_rules); esta nota é o motivo, escrito por pessoa.
const CHANGES: Record<number, string> = {
  1: "Primeira versão.",
  2: '"crédito" virou "linha de crédito". Sozinho, trazia verba passada entre ministérios.',
};

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-28 flex-col gap-3">
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

export default async function ComoEscolhemos() {
  const rules = await data.listPocketRules();
  const r = rules[0];
  return (
    <Container className="max-w-3xl">
      <header className="mb-8 flex flex-col gap-3">
        {r && (
          <p className="font-mono text-xs uppercase tracking-wide text-muted">
            Regras · versão {r.version} · publicada em {date(r.publishedOn)}
          </p>
        )}
        <h1 className="font-display text-display text-fg">Como escolhemos o que aparece aqui</h1>
        <p className="text-base text-muted">Usamos regras fixas e públicas. Ninguém escolhe proposta por gosto.</p>
      </header>

      <div className="flex flex-col gap-10 text-base text-fg">
        <Section title="1. O que entra">
          <p>
            <strong>Na Câmara</strong>, entra a proposta que a própria Câmara classificou em um destes temas, e cujo resumo oficial tem uma das
            palavras da lista abaixo:
          </p>
          <ul className="list-disc pl-5">{r?.themes.map((t) => <li key={t}>{t}</li>)}</ul>
          <p>
            <strong>No Senado</strong>, entra a proposta cujo resumo oficial tem uma destas palavras:
          </p>
          <p className="rounded-md bg-surface-sunken p-3 font-mono text-sm">{r?.terms.join(", ")}</p>
          <p className="text-sm text-muted">O Senado não classifica propostas por tema. Por isso, lá a lista de palavras pode deixar alguma de fora.</p>
        </Section>

        <Section title="2. O que o número conta">
          <ol className="list-decimal pl-5">
            <li>Propostas que passam pela regra 1.</li>
            <li>Marcadas para votação no plenário da Câmara ou do Senado nesta semana, de segunda a domingo.</li>
            <li>As que estão em comissão aparecem à parte, fora do número: comissão é uma etapa.</li>
          </ol>
          <p>Uma proposta conta uma vez, mesmo que esteja em duas pautas.</p>
          <p>A hora da última leitura da pauta aparece junto do número.</p>
          <p>
            Se parte da pauta não carregar, o número aparece como &quot;pelo menos&quot;. Se uma proposta sair de uma reunião que ainda vai
            acontecer, ela aparece em &quot;Saíram da pauta&quot; por 14 dias.
          </p>
        </Section>

        <Section id="revisao" title="3. Como escrevemos as respostas">
          <ol className="list-decimal pl-5">
            <li>Uma IA lê o texto oficial e escreve um rascunho.</li>
            <li>Cada frase leva o trecho do texto que a sustenta.</li>
            <li>Uma pessoa confere frase por frase antes de publicar.</li>
            <li>Sem trecho que sustente, escrevemos &quot;O texto não diz&quot;.</li>
          </ol>
          <p>Enquanto ninguém revisou, a página mostra só o resumo oficial e o texto oficial.</p>
        </Section>

        <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
          <h2 className="text-xl font-semibold text-fg">O que nunca fazemos</h2>
          <ul className="list-disc pl-5">
            <li>Dizer se uma proposta é boa ou ruim.</li>
            <li>Mostrar número que não está no texto oficial.</li>
            <li>Sugerir mensagem para você mandar a alguém.</li>
            <li>Usar cor para indicar lado.</li>
          </ul>
        </section>

        <Section title="Versões das regras">
          <ul className="flex flex-col gap-2">
            {rules.map((v) => (
              <li key={v.version}>
                <strong>Versão {v.version}</strong> · {date(v.publishedOn)} · {CHANGES[v.version] ?? "Sem nota de mudança."}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">Quando uma regra muda, a versão anterior continua aqui, com a data.</p>
          <Link href="/correcoes" className="font-semibold text-accent-text underline underline-offset-2">
            Ver todas as correções
          </Link>
        </Section>
      </div>
    </Container>
  );
}
