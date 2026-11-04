/** Bloco de código que quebra linha em vez de rolar (390 px sem rolagem horizontal; sem região rolável para o axe cobrar foco). */
export function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</figcaption>
      <pre className="m-0 whitespace-pre-wrap rounded-sm border border-border bg-surface-sunken p-3 font-mono text-sm text-fg [overflow-wrap:anywhere]">
        <code>{children}</code>
      </pre>
    </figure>
  );
}
