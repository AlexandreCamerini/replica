import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { VotoLegenda } from "@/components/votos/ui";
import { data } from "@/lib/data";
import { date } from "@/lib/format";

export const metadata: Metadata = {
  title: "Como escolhemos",
  description: "As regras fixas e públicas que decidem quais propostas aparecem, como as respostas são escritas e como mostramos o voto.",
};
// O que mudou em cada versão. A regra em si vem do banco (pocket_rules); esta nota é o motivo, escrito por pessoa.
const CHANGES: Record<number, string> = {
  1: "Primeira versão.",
  2: '"crédito" virou "linha de crédito". Sozinho, trazia verba passada entre ministérios.',
};

// Palavras que nunca aparecem numa frase nossa. Ficam riscadas aqui de propósito: é a lista do que não fazemos.
const FORBIDDEN = ["defendeu", "condenou", "traiu", "cumpriu", "pior", "beneficia", "prejudica", "polêmica", "ataque", "conquista", "retrocesso", "avanço", "bom", "ruim"];

const STAMPS: [string, string][] = [
  ["Aguardando revisão", "Ainda não há resposta conferida. A página mostra só o resumo e o texto oficial."],
  ["Revisado por pessoa em dd/mm/aaaa", "Uma pessoa conferiu frase por frase, com o trecho do texto oficial ao lado."],
  ["Conferido com o texto oficial por agentes de IA em dd/mm/aaaa", "Agentes de IA conferiram frase por frase contra o trecho do texto oficial. Nenhuma pessoa revisou."],
  ["Conferido com o texto oficial em dd/mm/aaaa", "A frase foi conferida contra o trecho do texto oficial. O registro não diz se por pessoa ou por agentes de IA."],
  ["Aprovada na Câmara", "A Câmara votou e aprovou. Ainda pode mudar no Senado."],
  ["Saiu da pauta", "Estava marcada e saiu. A fonte não informa o motivo."],
  ["Pauta desatualizada", "A última leitura da pauta tem mais de 24 horas."],
  ["Exemplo ilustrativo", "Número ou data que ainda não existe. Nunca é dado real."],
];

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-28 flex-col gap-3 border-t border-fg pt-5">
      <h2 className="font-serif text-[24px] leading-tight font-medium text-fg">{title}</h2>
      {children}
    </section>
  );
}

export default async function ComoEscolhemos() {
  const rules = await data.listPocketRules();
  const r = rules[0];
  return (
    <Container className="max-w-[880px]">
      <header className="mb-8 flex flex-col gap-3">
        {r && (
          <p className="lbl">
            Regras · versão {r.version} · publicada em {date(r.publishedOn)}
          </p>
        )}
        <h1 className="font-serif text-[32px] leading-[1.1] font-medium text-fg md:text-[40px]">Como escolhemos e como mostramos</h1>
        <p className="text-base text-muted">Usamos regras fixas e públicas. Ninguém escolhe proposta por gosto, e nenhuma cor diz lado.</p>
      </header>

      <div className="flex flex-col gap-8 text-base text-fg">
        <Section title="1. O que entra">
          <p>
            <strong>Na Câmara</strong>, entra a proposta que a própria Câmara classificou em um destes temas, e cujo resumo oficial tem uma das
            palavras da lista abaixo:
          </p>
          <ul className="list-disc pl-5">{r?.themes.map((t) => <li key={t}>{t}</li>)}</ul>
          <p>
            <strong>No Senado</strong>, entra a proposta cujo resumo oficial tem uma destas palavras:
          </p>
          <p className="border border-border bg-surface p-3 font-mono text-sm">{r?.terms.join(", ")}</p>
          <p className="text-sm text-muted">O Senado não classifica propostas por tema. Por isso, lá a lista de palavras pode deixar alguma de fora.</p>
        </Section>

        <Section title="2. O que o número conta">
          <ol className="list-decimal pl-5">
            <li>Propostas que passam pela regra 1.</li>
            <li>Marcadas para votação no plenário da Câmara ou do Senado nesta semana, de segunda a domingo.</li>
            <li>As que estão em comissão aparecem à parte, fora do número: comissão é uma etapa.</li>
          </ol>
          <p>Uma proposta conta uma vez, mesmo que esteja em duas pautas.</p>
          <p>A hora da última leitura da pauta aparece junto do número e no alto de toda página.</p>
          <p>
            Se parte da pauta não carregar, o número aparece como &quot;pelo menos&quot;. Se uma proposta sair de uma reunião que ainda vai
            acontecer, ela aparece em &quot;Saíram da pauta&quot; por 14 dias.
          </p>
        </Section>

        <Section id="revisao" title="3. Como escrevemos as respostas">
          <ol className="list-decimal pl-5">
            <li>Uma IA lê o texto oficial e escreve um rascunho.</li>
            <li>Cada frase leva o trecho do texto que a sustenta.</li>
            <li>Antes de publicar, cada frase é conferida contra o trecho: por pessoa ou por agentes de IA. Cada resposta diz qual.</li>
            <li>Sem trecho que sustente, escrevemos &quot;Ainda não conseguimos conferir esta resposta&quot;. &quot;O texto não diz&quot; só aparece quando o texto não trata do ponto.</li>
          </ol>
          <p>Enquanto nada foi conferido, a página mostra só o resumo oficial e o texto oficial. Frases curtas, de até 15 palavras.</p>
        </Section>

        <Section id="voto" title="4. Como mostramos o voto">
          <p>O voto é um padrão, nunca uma cor. Partido aparece só em sigla. No mapa, cada estado enche até o % de Sim entre quem votou.</p>
          <VotoLegenda />
          <p className="text-sm text-muted">
            &quot;Fora&quot; soma quem não registrou voto e quem presidia a sessão. A Câmara publica só quem votou: não nomeamos ausência.
          </p>
        </Section>

        <Section id="votos-lei" title="Quais votações aparecem">
          <p>Por padrão, mostramos só o que muda lei.</p>
          <p>Isso inclui a votação do texto e a de destaque, que decide um trecho.</p>
          <p>Escondemos requerimento, que é um pedido de procedimento, e pedido de urgência. O chip &quot;Tudo&quot; mostra também esses.</p>
          <p className="text-sm text-muted">
            O critério é o tipo que a Casa dá à votação: texto, destaque, urgência ou requerimento. Votação sem tipo claro não é escondida.
            Nas listas de votos, a contagem escondida aparece ao lado do chip.
          </p>
        </Section>

        <Section id="selos" title="5. O que os selos dizem">
          <dl className="grid gap-3 sm:grid-cols-2">
            {STAMPS.map(([s, t]) => (
              <div key={s} className="flex flex-col gap-2 border-t border-border pt-3">
                <dt>
                  <span className="stamp">{s}</span>
                </dt>
                <dd className="text-sm text-muted">{t}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <section className="plate flex flex-col gap-3 p-4">
          <h2 className="font-serif text-[24px] leading-tight font-medium text-fg">O que nunca fazemos</h2>
          <ul className="list-disc pl-5">
            <li>Dizer se uma proposta é boa ou ruim.</li>
            <li>Mostrar número que não está no texto oficial.</li>
            <li>Sugerir mensagem para você mandar a alguém.</li>
            <li>Usar cor para indicar lado, voto ou partido.</li>
          </ul>
          <p className="text-sm text-muted">Palavras que não entram em nenhuma frase nossa:</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm text-muted" aria-label="Palavras proibidas, riscadas">
            {FORBIDDEN.map((w) => (
              <s key={w}>{w}</s>
            ))}
          </p>
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
          <Link href="/correcoes" className="font-medium text-fg underline underline-offset-2">
            Ver todas as correções
          </Link>
        </Section>
      </div>
    </Container>
  );
}
