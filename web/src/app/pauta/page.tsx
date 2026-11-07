import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { AboutData, PautaCard, ReadStamp, where } from "@/components/pauta/ui";
import { data, type Body, type PautaEntry } from "@/lib/data";
import { count } from "@/lib/format";
import { dateTime, dayKey, dayLong, dayShort, weekLastDay } from "@/lib/pauta";

export const metadata: Metadata = {
  title: "Vem aí",
  description: "Propostas sobre dinheiro, trabalho e benefícios marcadas na Câmara e no Senado, por dia.",
};
export const revalidate = 600;

type Props = { searchParams: Promise<{ casa?: string }> };

function byDay(rows: PautaEntry[]) {
  const days = new Map<string, PautaEntry[]>();
  for (const r of rows) days.set(dayKey(r.scheduledFor), [...(days.get(dayKey(r.scheduledFor)) ?? []), r]);
  return [...days.values()];
}

const STAMPS: [string, string][] = [
  ["Aguardando revisão", "a IA leu o texto; nenhuma pessoa conferiu ainda. A página mostra só o resumo e o texto oficial."],
  ["Revisado por pessoa dd/mm", "uma pessoa conferiu frase por frase, com o trecho do texto oficial ao lado."],
  ["Pauta desatualizada", "a última leitura da pauta tem mais de 24 horas."],
  ["Leitura incompleta", "parte da pauta não carregou; o número aparece como \"pelo menos\"."],
];

export default async function Pauta({ searchParams }: Props) {
  const { casa } = await searchParams;
  const body: Body | null = casa === "camara" || casa === "senado" ? casa : null;
  const o = await data.getPautaOverview();
  const only = <T extends PautaEntry>(rows: T[]) => (body ? rows.filter((r) => r.body === body) : rows);
  const plenary = only(o.plenary);
  const until = dayShort(weekLastDay(o.week.weekEnds));
  const tabs: { href: string; label: string; n: number; on: boolean }[] = [
    { href: "/pauta", label: "Todas", n: o.plenary.length, on: !body },
    { href: "/pauta?casa=camara", label: "Câmara", n: o.plenary.filter((r) => r.body === "camara").length, on: body === "camara" },
    { href: "/pauta?casa=senado", label: "Senado", n: o.plenary.filter((r) => r.body === "senado").length, on: body === "senado" },
  ];
  return (
    <Container className="max-w-[1320px]">
      <header className="mb-6 flex max-w-3xl flex-col gap-3">
        <p className="lbl">Vem aí · a pauta · plenário até {until}</p>
        <h1 className="font-serif text-[32px] leading-[1.1] font-medium text-fg md:text-[40px]">
          {o.week.atLeast && "Pelo menos "}
          {count(o.week.total)} no plenário nesta semana
        </h1>
        <p className="text-base text-muted">Propostas sobre dinheiro, trabalho e benefícios marcadas para votação no plenário até {until}.</p>
        <ReadStamp readAt={o.week.readAt} reads={o.reads} />
      </header>

      <nav aria-label="Filtrar por Casa" className="mb-6">
        <ul className="flex gap-2">
          {tabs.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={t.on ? "page" : undefined}
                className={clsx(
                  "inline-flex h-11 items-center border px-4 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus",
                  t.on ? "border-fg bg-surface-inverse text-on-inverse" : "border-border bg-surface text-fg hover:border-fg",
                )}
              >
                {t.label} · {count(t.n)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="semana-h">
        <h2 id="semana-h" className="sr-only">
          No plenário nesta semana
        </h2>
        {plenary.length === 0 ? (
          <p className="plate p-4 font-serif text-[19px] text-fg">Nenhuma proposta deste tipo na pauta do plenário até {until}.</p>
        ) : (
          byDay(plenary).map((day) => (
            <div key={day[0].key} className="mb-6">
              <h3 className="lbl mb-2 font-sans">{dayLong(day[0].scheduledFor)}</h3>
              <ul className="grid gap-3 md:grid-cols-2">
                {day.map((e) => (
                  <PautaCard key={e.key} e={e} showDay={false} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {only(o.later).length > 0 && (
        <Section id="depois" title="Depois desta semana" note="Marcadas no plenário nos próximos 14 dias. Não entram no número desta semana.">
          {only(o.later).map((e) => (
            <PautaCard key={e.key} e={e} />
          ))}
        </Section>
      )}

      {only(o.committees).length > 0 && (
        <Section id="comissoes" title="Andando nas comissões" note="Não entram no número. Uma comissão é uma etapa; a decisão final costuma vir depois.">
          {only(o.committees).map((e) => (
            <PautaCard key={e.key} e={e} />
          ))}
        </Section>
      )}

      {only(o.exits).length > 0 && (
        <Section id="sairam" title="Saíram da pauta" note="Não entram no número. Ficam aqui por 14 dias.">
          {only(o.exits).map((e) => (
            <PautaCard
              key={e.key}
              e={e}
              note={`${where(e)}, estava em ${dayShort(e.scheduledFor)}. Saiu da pauta lida em ${dateTime(e.leftAt)}. A fonte não informa o motivo.`}
            />
          ))}
        </Section>
      )}

      <section aria-labelledby="selos-h" className="mt-10 scroll-mt-28">
        <h2 id="selos-h" className="lbl mb-2 font-sans">
          O que os selos dizem
        </h2>
        <dl className="grid gap-3 md:grid-cols-2">
          {STAMPS.map(([s, t]) => (
            <div key={s} className="flex flex-col gap-2 border-t border-border pt-3">
              <dt>
                <span className="stamp">{s}</span>
              </dt>
              <dd className="text-sm text-muted">{t}</dd>
            </div>
          ))}
        </dl>
      </section>

      <AboutData readAt={o.week.readAt} />
    </Container>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-28">
      <h2 id={`${id}-h`} className="font-serif text-[24px] font-medium text-fg">
        {title}
      </h2>
      <p className="mb-3 text-sm text-muted">{note}</p>
      <ul className="grid gap-3 md:grid-cols-2">{children}</ul>
    </section>
  );
}
