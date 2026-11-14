import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/page/page-header";
import { data } from "@/lib/data";
import { date } from "@/lib/format";
import { ageLabel, freshness, NOT_YET, SOURCE_META } from "@/lib/sources";

export const metadata: Metadata = {
  title: "Como atualizamos",
  description: "Cada fonte oficial, o que ela traz, de quanto em quanto tempo lemos e quando foi a última carga.",
};
export const dynamic = "force-dynamic"; // “fora do prazo” depende da hora de agora

const time = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function Page() {
  const sources = await data.listSourceStatus();
  const now = Date.now();
  const rows = sources.map((s) => {
    const meta = SOURCE_META[s.slug];
    return { s, meta, f: meta ? freshness(s.lastRefreshedAt, meta.maxAgeHours, now) : null };
  });
  const late = rows.filter((r) => r.f?.state === "fora_do_prazo").length;

  return (
    <Container>
      <PageHeader
        title="Como atualizamos"
        lead="Cada fonte é lida no seu ritmo. Aqui está o que cada uma traz, de quanto em quanto tempo esperamos ler, e quando foi a última vez de verdade."
      />

      <p role="status" className="mb-4 text-sm text-fg" data-testid="resumo-prazo">
        {late === 0 ? "Todas as fontes carregadas estão dentro do prazo esperado." : `${late} de ${rows.length} fontes estão fora do prazo esperado.`}
      </p>

      <div role="region" aria-label="Fontes e última carga" tabIndex={0} className="relative overflow-x-auto rounded-md border border-border outline-none focus-visible:outline-2 focus-visible:outline-focus">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm" data-testid="tabela-fontes">
          <caption className="sr-only">Fontes oficiais, o que trazem, frequência esperada, última carga e situação</caption>
          <thead className="bg-surface-sunken text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Fonte</th>
              <th scope="col" className="px-3 py-2 font-semibold">O que traz</th>
              <th scope="col" className="px-3 py-2 font-semibold">Frequência esperada</th>
              <th scope="col" className="px-3 py-2 font-semibold">Última carga</th>
              <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, meta, f }) => (
              <tr key={s.slug} data-source={s.slug} data-last={s.lastRefreshedAt ?? ""} data-max-hours={meta?.maxAgeHours ?? ""} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-3 font-semibold text-fg">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">
                    {s.name}
                  </a>
                  <details className="mt-1 text-xs font-normal text-muted">
                    <summary className="cursor-pointer rounded-xs outline-none focus-visible:outline-2 focus-visible:outline-focus">{s.datasets.length} conjuntos</summary>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {s.datasets.map((d) => (
                        <li key={d.dataset}>
                          <code className="font-mono">{d.dataset}</code> · {time(d.refreshedAt)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </th>
                <td className="px-3 py-3 text-fg">{meta?.brings ?? <Dash why="sem descrição cadastrada" />}</td>
                <td className="px-3 py-3 text-fg">{meta?.cadence ?? <Dash why="sem cadência definida" />}</td>
                <td className="px-3 py-3 text-fg">
                  {s.lastRefreshedAt ? (
                    <>
                      <time dateTime={s.lastRefreshedAt}>{time(s.lastRefreshedAt)}</time>
                      {f?.ageHours != null && <span className="block text-xs text-muted">{ageLabel(f.ageHours)}</span>}
                    </>
                  ) : (
                    <Dash why="nenhuma carga ainda" />
                  )}
                </td>
                <td className="px-3 py-3">
                  <Badge state={f?.state ?? "sem_carga"} />
                </td>
              </tr>
            ))}
            {NOT_YET.map((n) => (
              <tr key={n.name} className="border-t border-border align-top" data-source="pendente">
                <th scope="row" className="px-3 py-3 font-semibold text-fg">{n.name}</th>
                <td className="px-3 py-3 text-fg">{n.brings}</td>
                <td className="px-3 py-3"><Dash why="ainda não lemos esta fonte" /></td>
                <td className="px-3 py-3"><Dash why="sem carga" /></td>
                <td className="px-3 py-3">
                  <Badge state="pendente" />
                  <span className="mt-1 block text-xs text-muted">{n.why}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Horários em Brasília. “Fora do prazo” quer dizer que a última carga é mais antiga que a frequência da coluna ao lado; o dado
        anterior continua no ar com a data dele. Quais cidades publicam o quê está em{" "}
        <Link href="/dados-abertos" className="font-semibold text-accent-text underline underline-offset-2">
          Quem publica dados
        </Link>
        .
      </p>

      <section aria-labelledby="rotina-h" className="mt-10 max-w-[68ch]">
        <h2 id="rotina-h" className="mb-3 font-display text-2xl text-fg">A rotina</h2>
        <ol className="ml-5 flex list-decimal flex-col gap-2 text-base text-fg">
          <li>Para cada fonte, a rotina primeiro compara a entrada com a da última leitura. Se nada mudou, anota a data e para.</li>
          <li>Se mudou, carrega para uma área de espera, confere se as contas fecham (cadeiras, mandatos que não se sobrepõem, presença que não passa do total) e só então grava.</li>
          <li>Depois de gravar, recalcula os totais derivados e pede ao site para renovar as páginas afetadas.</li>
          <li>Se a fonte estiver fora do ar, a leitura falha, o dado anterior fica no ar com a data antiga e a tabela acima passa a mostrar “fora do prazo”.</li>
        </ol>
        <p className="mt-3 text-sm text-muted">
          Nesta versão a rotina ainda é disparada à mão pela equipe; o agendamento diário entra com a publicação. É por isso que a tabela
          pode mostrar atraso: ela diz o que de fato aconteceu, não o que planejamos.
        </p>
      </section>

      <section aria-labelledby="nunca-h" className="mt-10 max-w-[68ch]">
        <h2 id="nunca-h" className="mb-3 font-display text-2xl text-fg">O que a rotina nunca faz</h2>
        <ul className="ml-5 flex list-disc flex-col gap-2 text-base text-fg">
          <li>Nunca apaga um dado antigo porque a fonte ficou fora do ar.</li>
          <li>Nunca troca um dado que a fonte não publica por zero ou por estimativa: fica “—”, com o motivo.</li>
          <li>Nunca junta duas pessoas só porque os nomes se parecem; na dúvida, mantém separadas e põe na fila de revisão.</li>
          <li>Nunca muda um número por pedido de alguém, sem uma fonte oficial que o sustente; toda correção é publicada com data e motivo.</li>
          <li>Nunca lê página de rede social, nem dado de fonte sem base legal clara, nem informação privada de ninguém.</li>
          <li>Nunca ordena, pontua ou marca ninguém como melhor ou pior.</li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Os critérios completos estão em{" "}
          <Link href="/sobre" className="font-semibold text-accent-text underline underline-offset-2">
            Metodologia e fontes
          </Link>
          . Última carga geral: {date(rows.map((r) => r.s.lastRefreshedAt ?? "").sort().at(-1) || new Date(0).toISOString())}.
        </p>
      </section>
    </Container>
  );
}

function Dash({ why }: { why: string }) {
  return (
    <span title={why} className="text-muted">
      <span aria-hidden>—</span>
      <span className="sr-only">{why}</span>
    </span>
  );
}

function Badge({ state }: { state: "no_prazo" | "fora_do_prazo" | "sem_carga" | "pendente" }) {
  const cfg = {
    no_prazo: { Icon: CheckCircle2, label: "No prazo", cls: "bg-success-soft text-fg" },
    fora_do_prazo: { Icon: CircleAlert, label: "Fora do prazo", cls: "bg-warning-soft text-fg" },
    sem_carga: { Icon: CircleDashed, label: "Sem carga", cls: "bg-surface-sunken text-fg" },
    pendente: { Icon: CircleDashed, label: "Ainda não lemos", cls: "bg-surface-sunken text-fg" },
  }[state];
  return (
    <span data-state={state} className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${cfg.cls}`}>
      <cfg.Icon aria-hidden className="size-3.5" />
      {cfg.label}
    </span>
  );
}
