import { ExternalLink } from "lucide-react";
import { Section } from "@/components/profile/ui";
import { SourceFooter } from "@/components/ui/data";
import { data, type AssemblyItem, type PeriodStats } from "@/lib/data";
import { count, date, money } from "@/lib/format";

// W3-A: bloco "Na Assembleia" do crachá de deputado estadual/distrital. Um item por dado (presença, votos, propostas,
// verba), cada um com o número ou "—" e o motivo, e a fonte com data. Sem cor, nota ou ordem por desempenho.

const sentence = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}${t.endsWith(".") ? "" : "."}`;

/** since: rótulo do período de cada número ("desde 2023", "em 2025"): cada casa começa a carga num ano diferente. */
export async function Assembly({ uf, stats, periodLabel, f, since }: { uf: string; stats: PeriodStats; periodLabel: string; f: boolean; since?: Partial<Record<AssemblyItem["dataset"], string>> }) {
  const info = await data.getAssembly(uf);
  if (!info) return null;
  const value = (it: AssemblyItem): string | null => {
    if (it.status !== "no_site") return null;
    if (it.dataset === "propostas" && stats.proposalsPrincipal !== null)
      return `${count(stats.proposalsPrincipal)} como ${f ? "autora" : "autor"} · ${count(stats.proposalsCosigned ?? 0)} como ${f ? "coautora" : "coautor"}`;
    if (it.dataset === "gastos_gabinete" && stats.expensesCents !== null) return money(stats.expensesCents);
    if (it.dataset === "presenca" && stats.presenceTotal) return `${count(stats.presencePresent ?? 0)} de ${count(stats.presenceTotal)} sessões`;
    if (it.dataset === "votos" && stats.votesRegistered !== null) return count(stats.votesRegistered);
    return null;
  };
  return (
    <Section
      id="assembleia"
      title={`Na ${info.houseName}`}
      intro={
        info.read
          ? `O que a casa publica em dado aberto sobre o mandato. Onde aparece “—”, o motivo está ao lado.`
          : `O site ainda não lê os dados abertos desta casa. Nada abaixo é zero: é dado que não carregamos.`
      }
    >
      <ul className="flex flex-col divide-y divide-border" data-testid="assembleia-itens" data-read={info.read ? "1" : "0"}>
        {info.items.map((it) => {
          const v = value(it);
          return (
            <li key={it.dataset} className="flex flex-col gap-1 py-3" data-dataset={it.dataset} data-status={it.status}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-semibold text-fg">
                  {it.label}
                  {v && since?.[it.dataset] && <span className="ml-1 font-normal text-muted">{since[it.dataset]}</span>}
                </h3>
                <p className="text-base tabular text-fg" data-testid="assembleia-valor">
                  {v ?? (
                    <span aria-label="não carregado" title={it.reason}>
                      —
                    </span>
                  )}
                </p>
              </div>
              <p className="text-sm text-muted">
                {v
                  ? sentence(it.reason)
                  : it.status === "no_site"
                    ? `sem dado carregado ${periodLabel}: a carga desta casa começa em outro ano ou não traz lançamento deste mandato.`
                    : sentence(it.reason)}
              </p>
              {it.refreshedAt && info.source ? (
                <SourceFooter source={info.source.name} href={info.source.url} updatedAt={it.refreshedAt} />
              ) : (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted">
                  {it.checkedOn ? <span>conferido em {date(it.checkedOn)}</span> : <span>sem carga</span>}
                  {it.evidenceUrl && !it.evidenceUrl.includes("{") && (
                    <>
                      <span aria-hidden>·</span>
                      <a href={it.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-fg">
                        onde conferimos <ExternalLink aria-hidden className="size-3" />
                        <span className="sr-only">(abre em nova aba)</span>
                      </a>
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Carimbo de um conjunto lido (para os blocos de lista reaproveitados). */
export function stampOf(items: AssemblyItem[], d: AssemblyItem["dataset"]): string | null {
  return items.find((i) => i.dataset === d)?.stampDataset ?? null;
}
