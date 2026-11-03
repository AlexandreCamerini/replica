import Link from "next/link";

/** “—” com o motivo para quem usa leitor de tela e no title (hover). Nunca um 0 no lugar de dado ausente. */
export function Dash({ why }: { why: string }) {
  return (
    <span title={why} className="text-muted">
      <span aria-hidden>—</span>
      <span className="sr-only">{why}</span>
    </span>
  );
}

/** Chip-link do servidor (funciona sem JavaScript; o estado vive na URL). */
export function LinkChip({ href, current, children }: { href: string; current?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "true" : undefined}
      className={`inline-flex h-8 shrink-0 items-center rounded-pill border-[1.5px] px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
        current ? "border-surface-inverse bg-surface-inverse text-on-inverse" : "border-border bg-surface text-fg hover:border-border-input"
      }`}
    >
      {children}
    </Link>
  );
}

/** Região rolável só para a tabela (a página não rola na horizontal). Focável para quem navega por teclado. */
export function TableRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto rounded-md border border-border outline-none focus-visible:outline-2 focus-visible:outline-focus">
      {children}
    </div>
  );
}

export function Notice({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <aside id={id} className="rounded-md border border-border bg-surface-sunken p-4 text-sm text-fg">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-muted">{children}</div>
    </aside>
  );
}

export const UF_LIST = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
