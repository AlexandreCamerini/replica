import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/page/page-header";
import { AboutData, PautaCard, ReadStamp, where } from "@/components/pauta/ui";
import { data, type Body, type PautaEntry } from "@/lib/data";
import { count } from "@/lib/format";
import { dateTime, dayKey, dayLong, dayShort, weekLastDay } from "@/lib/pauta";

export const metadata: Metadata = {
  title: "Pauta",
  description: "Propostas sobre dinheiro, trabalho e benefícios marcadas na Câmara e no Senado, por dia.",
};
export const revalidate = 600;

type Props = { searchParams: Promise<{ casa?: string }> };

function byDay(rows: PautaEntry[]) {
  const days = new Map<string, PautaEntry[]>();
  for (const r of rows) days.set(dayKey(r.scheduledFor), [...(days.get(dayKey(r.scheduledFor)) ?? []), r]);
  return [...days.values()];
}

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
    <Container>
      <header className="mb-6 flex max-w-2xl flex-col gap-3">
        <h1 className="font-display text-display text-fg">
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
                  "inline-flex h-10 items-center rounded-pill px-4 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus",
                  t.on ? "bg-surface-inverse text-on-inverse" : "bg-surface-sunken text-fg hover:underline",
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
          <p className="text-base text-fg">Nenhuma proposta deste tipo na pauta do plenário até {until}.</p>
        ) : (
          byDay(plenary).map((day) => (
            <div key={day[0].key} className="mb-6">
              <h3 className="mb-2 text-lg font-semibold text-fg">{dayLong(day[0].scheduledFor)}</h3>
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

      <AboutData readAt={o.week.readAt} />
    </Container>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-28">
      <h2 id={`${id}-h`} className="text-xl font-semibold text-fg">
        {title}
      </h2>
      <p className="mb-3 text-sm text-muted">{note}</p>
      <ul className="grid gap-3 md:grid-cols-2">{children}</ul>
    </section>
  );
}
