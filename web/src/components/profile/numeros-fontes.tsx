import { date } from "@/lib/format";

export type SourceLine = { label: string; source: string; href: string; updatedAt: string };

/** Fonte e data de cada número do bloco “Números” (regra de produto: fonte e data em todo bloco; BUG-026). */
export function NumerosFontes({ lines }: { lines: SourceLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 font-mono text-xs text-muted" data-testid="numeros-fontes" aria-label="Fontes dos números">
      {lines.map((l, i) => (
        <li key={`${i}-${l.label}`}>
          {l.label}: Fonte:{" "}
          <a href={l.href} className="underline underline-offset-2 hover:text-fg">
            {l.source}
          </a>{" "}
          · atualizado em <time dateTime={l.updatedAt}>{date(l.updatedAt)}</time>
        </li>
      ))}
    </ul>
  );
}
