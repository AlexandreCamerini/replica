import Link from "next/link";
import { askSourceHref } from "@/components/profile/ask-source";
import type { CouncilSite, MissingDataset, Place } from "@/lib/data";
import { date } from "@/lib/format";

// Como a situação aparece em palavras (nunca só cor). Texto do motivo vem de data_coverage.
const STATUS: Record<MissingDataset["status"], string> = {
  desconhecido: "Ainda não conferimos",
  carregando: "Em carga",
  so_portal: "Só no portal",
  nao_publica: "Não é publicado",
  no_site: "No site",
};

/**
 * U03. Bloco único "O que não está aqui, e por quê" da cidade. Uma linha por dado, em ordem alfabética de rótulo,
 * com o motivo e a data da conferência; no fim, o site da câmara quando o banco o conhece. Sem item, o bloco some.
 */
export function CityGaps({ place, items, site }: { place: Place; items: MissingDataset[]; site: CouncilSite | null }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const checked = sorted.map((i) => i.checkedOn).filter((x): x is string => !!x).sort().at(-1);
  return (
    <section aria-labelledby="falta-h" className="border border-border bg-surface p-4 md:p-6" data-testid="o-que-nao-esta-aqui">
      <h2 id="falta-h" className="font-serif text-[24px] leading-tight font-medium text-fg">
        O que não está aqui, e por quê
      </h2>
      <p className="mt-1 text-sm text-muted">
        O que falta para {place.name}, com o motivo de cada um.
        {checked && (
          <>
            {" "}
            Conferido em <time dateTime={checked}>{date(checked)}</time>.
          </>
        )}
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-border">
        {sorted.map((i) => (
          <li key={`${i.dataset}-${i.label}`} className="flex flex-col gap-1 py-3 text-sm" data-dataset={i.dataset} data-status={i.status}>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-fg">{i.label}</span>
              <span className="lbl">{STATUS[i.status]}</span>
            </p>
            <p className="text-fg">
              <span aria-hidden>— </span>
              {i.reason}.
            </p>
            {i.evidenceUrl && !i.evidenceUrl.includes("{") && (
              <a href={i.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-fg underline underline-offset-2">
                Ver onde conferimos<span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-border pt-3 text-sm text-fg" data-testid="site-da-camara">
        {site?.url ? (
          <p>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
              Site da câmara municipal<span className="sr-only"> (abre em nova aba)</span>
            </a>
          </p>
        ) : (
          <>
            <p>
              O site da câmara não está no nosso cadastro.
              {site?.note && <> {site.note.charAt(0).toUpperCase() + site.note.slice(1)}{site.note.endsWith(".") ? "" : "."}</>}
            </p>
            <p>
              <Link
                href={`${askSourceHref(undefined, place.ibge)}&bloco=camara`}
                className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
              >
                Sabe qual é? Mande o endereço.
              </Link>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
