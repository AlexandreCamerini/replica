import Link from "next/link";

export function PageHeader({
  title,
  lead,
  crumbs,
  children,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  crumbs?: { href: string; label: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Você está em">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>›</span>}
                <Link href={c.href} className="underline-offset-2 hover:text-fg hover:underline">
                  {c.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1 className="font-display text-display text-balance text-fg">{title}</h1>
      {lead && <p className="max-w-[60ch] text-base text-muted">{lead}</p>}
      {children}
    </div>
  );
}

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8 ${className}`}>{children}</div>;
}
