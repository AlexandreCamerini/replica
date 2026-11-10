import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";

export const metadata: Metadata = {
  title: "Como ajudar",
  description: "Quatro jeitos de ajudar a cobrir mais cidades: mandar o dado da sua, avisar um erro, espalhar e receber as atualizações.",
};

const link = "font-semibold text-accent-text underline underline-offset-2";
const cta = "inline-flex min-h-11 items-center rounded-pill bg-accent px-5 text-sm font-semibold text-on-accent outline-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const WAYS: { id: string; title: string; body: React.ReactNode; href: string; action: string }[] = [
  {
    id: "dado",
    title: "Mande o dado da sua cidade",
    body: (
      <>
        O que mais falta são os dados das câmaras municipais e das prefeituras: presença, votos, salários e gastos. Se você sabe em que
        endereço oficial um órgão publica algum deles, ou tem o contato de quem cuida disso, conte. Um link para a página do órgão já ajuda.
        Veja antes o que falta na sua cidade em{" "}
        <Link href="/dados-abertos" className={link}>
          Quem publica dados
        </Link>
        .
      </>
    ),
    href: "/sugestoes?tipo=dado",
    action: "Mandar um dado",
  },
  {
    id: "erro",
    title: "Avise quando algo estiver errado",
    body: (
      <>
        Um número que não bate com a fonte, um partido desatualizado, um nome trocado: avise e, se puder, cole o link da fonte oficial.
        Correção com fonte entra no site com data e motivo. Se a correção é sobre você ou sobre alguém que você representa, o caminho é o{" "}
        <Link href="/sobre#s-resposta" className={link}>
          direito de resposta
        </Link>
        .
      </>
    ),
    href: "/sugestoes?tipo=erro",
    action: "Avisar um erro",
  },
  {
    id: "espalhar",
    title: "Mostre a quem importa",
    body: (
      <>
        O site serve para qualquer pessoa descobrir quem a representa e o que essa gente faz no cargo. Mande o endereço da página da sua
        cidade para quem mora lá: grupo da família, associação de bairro, sala de aula. As páginas públicas têm botão para copiar o link.
      </>
    ),
    href: "/representantes",
    action: "Achar quem representa a sua cidade",
  },
  {
    id: "atualizacoes",
    title: "Receba as atualizações",
    body: (
      <>
        Entre com o seu e-mail (sem senha), escolha quem acompanhar e receba um resumo do que mudou.
      </>
    ),
    href: "/entrar",
    action: "Entrar",
  },
];

export default function Page() {
  return (
    <Container>
      <PageHeader
        title="Como ajudar"
        lead="O site cresce cidade por cidade, e cada cidade depende de alguém que sabe onde o dado está publicado. Estes são os jeitos de ajudar, do mais simples ao mais constante."
      />

      <div className="flex max-w-[68ch] flex-col gap-4">
        <ol className="flex flex-col gap-4">
          {WAYS.map((w, i) => (
            <li key={w.id}>
              <section id={w.id} aria-labelledby={`${w.id}-h`} className="scroll-mt-32 rounded-sm border border-border bg-surface p-4 md:p-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Jeito {i + 1}</p>
                <h2 id={`${w.id}-h`} className="font-display text-2xl text-fg">
                  {w.title}
                </h2>
                <p className="mt-2 text-base text-fg">{w.body}</p>
                <p className="mt-3">
                  <Link href={w.href} className={cta}>
                    {w.action}
                  </Link>
                </p>
              </section>
            </li>
          ))}
        </ol>

        <section id="apoio" aria-labelledby="apoio-h" className="scroll-mt-32 rounded-sm border border-border bg-surface-sunken p-4 md:p-5">
          <h2 id="apoio-h" className="font-display text-2xl text-fg">
            Apoio financeiro
          </h2>
          <dl className="mt-2 grid grid-cols-1 gap-2 text-base text-fg">
            <div>
              <dt className="text-sm font-semibold text-muted">Como apoiar</dt>
              <dd>—</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-muted">Motivo</dt>
              <dd>
                Ainda não há um meio de apoio definido; quem decide o canal e como prestar contas é o responsável pelo site. Enquanto isso, nenhuma
                página daqui pede dinheiro, e desconfie de quem pedir em nome do site.
              </dd>
            </div>
          </dl>
        </section>

        <p className="text-sm text-muted">
          Programa e quer usar os dados no seu assistente de IA? Veja{" "}
          <Link href="/mcp" className={link}>
            o servidor MCP
          </Link>
          . Para entender de onde vêm os números, leia{" "}
          <Link href="/sobre#fontes" className={link}>
            Metodologia e fontes
          </Link>
          .
        </p>
      </div>
    </Container>
  );
}
