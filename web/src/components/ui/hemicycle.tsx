"use client";

import { useMemo, useState } from "react";

export type Seat = { id: string; name: string; party: string; uf: string };

/**
 * Hemiciclo neutro: cadeira cinza (seat); partido escolhido acende (seat-active + anel).
 * Cor nunca codifica partido. A tabela de bancadas é a alternativa textual obrigatória.
 */
export function Hemicycle({ seats, title }: { seats: Seat[]; title: string }) {
  const [party, setParty] = useState<string | null>(null);
  const parties = useMemo(() => {
    const m = new Map<string, number>();
    seats.forEach((s) => m.set(s.party, (m.get(s.party) ?? 0) + 1));
    return [...m].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  }, [seats]);

  const pts = useMemo(() => layout(seats.length), [seats.length]);
  const active = party ? seats.filter((s) => s.party === party).length : 0;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm font-semibold text-fg">{title}</figcaption>
      <div role="group" aria-label="Destacar partido" className="flex flex-wrap gap-2">
        <PartyButton label="Nenhum" checked={party === null} onClick={() => setParty(null)} />
        {parties.map(([p, n]) => (
          <PartyButton key={p} label={`${p} · ${n}`} checked={party === p} onClick={() => setParty(p)} />
        ))}
      </div>
      <svg viewBox="0 0 200 104" className="w-full max-w-xl" role="img" aria-label={`${seats.length} cadeiras${party ? `, ${active} de ${party} destacadas` : ""}`}>
        {pts.map(([x, y], i) => {
          const s = seats[i];
          const on = party !== null && s.party === party;
          return (
            <circle
              key={s.id}
              cx={x}
              cy={y}
              r={on ? 3.1 : 2.6}
              fill={on ? "var(--seat-active)" : "var(--seat)"}
              stroke={on ? "var(--surface)" : "none"}
              strokeWidth={on ? 0.9 : 0}
            >
              <title>{`${s.name} · ${s.party} · ${s.uf}`}</title>
            </circle>
          );
        })}
      </svg>
      <p aria-live="polite" className="text-sm text-muted">
        {party ? `${active} cadeiras de ${party}` : `${seats.length} cadeiras`}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-fg">Ver bancadas em tabela</summary>
        <table className="mt-2 w-full max-w-xs text-left">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1">Partido</th>
              <th scope="col" className="py-1 text-right">Cadeiras</th>
            </tr>
          </thead>
          <tbody>
            {parties.map(([p, n]) => (
              <tr key={p} className="border-t border-border">
                <th scope="row" className="py-1 font-normal">{p}</th>
                <td className="py-1 text-right tabular">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function PartyButton({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className={
        "h-8 rounded-pill border-[1.5px] px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
        (checked ? "border-surface-inverse bg-surface-inverse text-on-inverse" : "border-border bg-surface text-fg hover:border-border-input")
      }
    >
      {label}
    </button>
  );
}

/** Distribui n cadeiras em fileiras concêntricas de um semicírculo. */
function layout(n: number): [number, number][] {
  const rows = Math.max(3, Math.round(Math.sqrt(n / 4)));
  const radii = Array.from({ length: rows }, (_, r) => 40 + (r * 56) / Math.max(rows - 1, 1));
  const total = radii.reduce((s, r) => s + r, 0);
  const counts = radii.map((r) => Math.round((n * r) / total));
  counts[rows - 1] += n - counts.reduce((s, c) => s + c, 0);
  const pts: { a: number; p: [number, number] }[] = [];
  radii.forEach((r, i) => {
    const c = counts[i];
    for (let k = 0; k < c; k++) {
      const a = Math.PI - (Math.PI * (k + 0.5)) / c;
      // arredonda: Math.cos/sin variam na última casa entre Node e navegador (hydration mismatch)
      pts.push({ a, p: [round2(100 + r * Math.cos(a)), round2(100 - r * Math.sin(a))] });
    }
  });
  // ordena por ângulo para a ordem esquerda → direita valer entre fileiras
  return pts.sort((x, y) => y.a - x.a).map((x) => x.p);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
