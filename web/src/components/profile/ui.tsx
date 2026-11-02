import Link from "next/link";
import { clsx } from "clsx";

export type Params = Record<string, string | undefined>;

/** Monta a URL do crachá mantendo os filtros atuais e trocando só o que mudou. */
export function hrefWith(base: string, current: Params, patch: Params, hash?: string) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) sp.set(k, v);
  const s = sp.toString();
  return `${base}${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

export function LinkChip({ href, active, scroll = false, children }: { href: string; active?: boolean; scroll?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={scroll}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "inline-flex h-8 shrink-0 items-center rounded-pill border-[1.5px] px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        active ? "border-surface-inverse bg-surface-inverse text-on-inverse" : "border-border bg-surface text-fg hover:border-border-input",
      )}
    >
      {children}
    </Link>
  );
}

export function Section({ id, title, count, children, intro }: { id: string; title: string; count?: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 rounded-md border border-border bg-surface p-4 md:p-6">
      <h2 id={`${id}-h`} className="flex flex-wrap items-baseline gap-x-2 text-xl text-fg">
        {title}
        {count && <span className="text-base font-normal tabular text-muted">{count}</span>}
      </h2>
      {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-sm bg-surface-sunken px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export const fieldCls =
  "h-10 rounded-sm border-[1.5px] border-border-input bg-surface px-3 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function SelectField({ label, name, value, options }: { label: string; name: string; value?: string; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-fg">
      {label}
      <select name={name} defaultValue={value ?? ""} className={fieldCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MoreLink({ href, remaining }: { href: string; remaining: number }) {
  if (remaining <= 0) return null;
  return (
    <Link
      href={href}
      scroll={false}
      className="mt-3 inline-flex h-10 items-center rounded-pill border-[1.5px] border-border-input bg-surface px-4 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      Ver mais {Math.min(remaining, 20)} de {remaining}
    </Link>
  );
}
