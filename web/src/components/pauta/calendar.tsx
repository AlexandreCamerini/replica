import Link from "next/link";
import type { PautaEntry, PautaRead } from "@/lib/data";
import { bodyName, dateTime, dayKey } from "@/lib/pauta";
import { ConsultedAgo } from "./consulted-ago";

// U10: calendário do mês com o número de itens de plenário por dia (os mesmos que a lista abaixo),
// a próxima sessão, "consultado há N min" e o estado de erro do v1 quando a leitura falhou (events_failed > 0).
const TZ = "America/Sao_Paulo";
const WEEKDAYS = [["dom", "domingo"], ["seg", "segunda"], ["ter", "terça"], ["qua", "quarta"], ["qui", "quinta"], ["sex", "sexta"], ["sáb", "sábado"]] as const;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nextSessionLabel(iso: string) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  const hm = p.minute === "00" ? `${p.hour}h` : `${p.hour}h${p.minute}`;
  return `${String(p.weekday).replace(".", "")} ${p.day}/${p.month}, ${hm}`;
}

export function PautaCalendar({
  weekKeys,
  entries,
  reads,
  readAt,
  now = new Date(),
}: {
  /** chaves de dia (AAAA-MM-DD) que a lista abaixo mostra por dia; as outras apontam para "Depois desta semana" */
  weekKeys: string[];
  entries: PautaEntry[];
  reads: Record<"camara" | "senado", PautaRead>;
  readAt: string | null;
  now?: Date;
}) {
  const today = dayKey(now.toISOString());
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const count = new Map<string, number>();
  for (const e of entries) count.set(dayKey(e.scheduledFor), (count.get(dayKey(e.scheduledFor)) ?? 0) + 1);
  const upcoming = entries.map((e) => e.scheduledFor).filter((s) => new Date(s).getTime() >= now.getTime()).sort()[0] ?? null;
  const failed = (["camara", "senado"] as const).filter((b) => reads[b].failed > 0);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <section aria-labelledby="calendario-h" className="mb-8 max-w-3xl" data-testid="pauta-calendario">
      <h2 id="calendario-h" className="lbl mb-2 font-sans">
        Calendário · {MONTHS[m - 1]} de {y}
      </h2>

      {failed.map((b) => (
        <div key={b} role="alert" data-testid={`pauta-erro-${b}`} className="mb-3 flex flex-col gap-2 border border-danger bg-danger-soft px-3 py-3 text-sm text-fg">
          <p>
            <span className="stamp mr-3 text-danger">Erro de leitura</span>
            Não conseguimos ler a pauta {b === "camara" ? "da Câmara" : "do Senado"}. Última leitura: {reads[b].readAt ? dateTime(reads[b].readAt!) : "nenhuma"}.
          </p>
          <p className="text-muted">
            {reads[b].failed} de {reads[b].total} {reads[b].total === 1 ? "reunião" : "reuniões"} não carregaram; os números abaixo podem ser maiores.
          </p>
          <Link href="/pauta" prefetch={false} className="inline-flex h-11 w-fit items-center border border-fg bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus">
            Tentar de novo
          </Link>
        </div>
      ))}

      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg">
        <span data-testid="proxima-sessao">
          {upcoming ? (
            <>
              Próxima sessão: <strong className="tabular font-semibold">{nextSessionLabel(upcoming)}</strong>
            </>
          ) : (
            "Nenhuma sessão marcada a partir de agora."
          )}
        </span>
        {readAt && (
          <span className="text-muted">
            <ConsultedAgo readAt={readAt} fallback={`lida em ${dateTime(readAt)}`} />
          </span>
        )}
      </p>

      <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Itens na pauta por dia, ${MONTHS[m - 1]} de ${y}`}>
        {WEEKDAYS.map(([s, l]) => (
          <abbr key={s} title={l} className="lbl text-center no-underline">
            {s}
          </abbr>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`v${i}`} aria-hidden />;
          const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const n = count.get(key) ?? 0;
          const base = "flex min-h-11 flex-col items-center justify-center border px-1 py-1 text-sm tabular";
          const isToday = key === today;
          if (!n)
            return (
              <span key={key} className={`${base} border-border text-muted ${isToday ? "border-fg text-fg" : ""}`} aria-label={`${d} de ${MONTHS[m - 1]}: nada na pauta`} data-day={key} data-n={0}>
                {d}
              </span>
            );
          return (
            <Link
              key={key}
              href={weekKeys.includes(key) ? `#dia-${key}` : "#depois"}
              className={`${base} border-fg bg-surface text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus ${isToday ? "border-2" : ""}`}
              data-day={key}
              data-n={n}
            >
              <span aria-hidden className="text-xs leading-none">{d}</span>
              <span aria-hidden className="disp text-[20px] leading-none">{n}</span>
              <span className="sr-only">{`${d} de ${MONTHS[m - 1]}: ${n} ${n === 1 ? "item" : "itens"} na pauta`}</span>
            </Link>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted" data-testid="pauta-leituras">
        Leitura: {(["camara", "senado"] as const).map((b) => `${bodyName(b)} ${reads[b].total} ${reads[b].total === 1 ? "reunião lida" : "reuniões lidas"}, ${reads[b].failed} sem carregar`).join(" · ")}. Conta só o plenário.
      </p>
    </section>
  );
}
