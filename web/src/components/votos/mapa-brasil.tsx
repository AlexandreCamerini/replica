import Link from "next/link";
import mapa from "@/data/mapa-br.json";
import { NAMES, SEATS, type Counts, pct, pctText } from "@/lib/votacoes";

// Mapa oficial do Brasil (malhas IBGE, 886 × 827) em que cada estado "enche", de baixo para cima, até o % de Sim.
// Sem bolhas e sem quadradinhos. Uma cor só (tint). Cada estado é um link: funciona sem JS e escala com a tela.
const M = mapa as unknown as {
  w: number;
  h: number;
  paths: Record<string, string>;
  box: Record<string, [number, number, number, number]>;
  /** [x, y, w, h, etiqueta com linha?, x do ponto no mapa, y do ponto no mapa] */
  lab: Record<string, [number, number, number, number, number, number, number]>;
};

const grad = (id: string, off: number) => (
  <linearGradient key={id} id={id} x1="0" y1="1" x2="0" y2="0">
    <stop offset={`${off}%`} stopColor="var(--tint)" />
    <stop offset={`${off}%`} stopColor="var(--surface)" />
  </linearGradient>
);

export function MapaBrasil({ byUf, hrefFor }: { byUf: Record<string, Counts>; hrefFor: (uf: string) => string }) {
  const ufs = Object.keys(M.paths);
  return (
    <svg viewBox={`0 0 ${M.w} ${M.h}`} className="h-auto w-full" role="group" aria-label="Mapa oficial do Brasil. Toque num estado para ver quem votou.">
      <defs>{ufs.map((u) => grad(`g-${u}`, pct(byUf[u]) ?? 0))}</defs>
      {ufs.map((u) => (
        <path key={u} d={M.paths[u]} fill={`url(#g-${u})`} stroke="var(--text)" strokeWidth={0.8} strokeLinejoin="round" />
      ))}
      {ufs.map((u) => {
        const l = M.lab[u];
        if (!l || !l[4]) return null;
        const tx = l[0] > l[5] ? l[0] : l[0] + l[2];
        return <path key={`ld-${u}`} d={`M${l[5]} ${l[6]}L${tx} ${l[1] + l[3] / 2}`} stroke="var(--text)" strokeWidth={1} fill="none" />;
      })}
      {ufs.map((u) => {
        const l = M.lab[u];
        if (!l) return null;
        const c = byUf[u];
        const co = !!l[4];
        const cx = l[0] + l[2] / 2;
        const cy = l[1] + l[3] / 2;
        // nome acessível vem do texto visível (sigla e % Sim); o resto vai como descrição (axe: label-content-name-mismatch)
        const desc = `${NAMES[u]}, ${SEATS[u]} deputados: ${c[0]} Sim, ${c[1]} Não, ${c[2]} abstenção. Abrir o estado.`;
        return (
          <Link key={`lb-${u}`} href={hrefFor(u)} aria-describedby={`uf-desc-${u}`} className="group outline-none">
            <desc id={`uf-desc-${u}`}>{desc}</desc>
            <rect x={l[0]} y={l[1]} width={co ? l[2] + 8 : l[2]} height={l[3]} fill={co ? "var(--surface)" : "transparent"} stroke={co ? "var(--text)" : "transparent"} strokeWidth={1} className="group-hover:stroke-[var(--text)] group-hover:[stroke-width:2] group-focus-visible:stroke-[var(--focus)] group-focus-visible:[stroke-width:3]" />
            {co ? (
              <>
                <rect x={l[0] + 6} y={cy - 7} width={16} height={14} fill="var(--tint)" stroke="var(--text)" strokeWidth={1.5} />
                <text x={l[0] + 27} y={cy + 4.5} fontFamily="var(--ds-font-mono)" fontSize={12} fontWeight={600} fill="var(--text)">
                  {u}
                </text>
                <text x={l[0] + 47} y={cy + 5.5} fontFamily="var(--ds-font-display)" fontSize={15} fontWeight={700} fill="var(--text)">
                  {pctText(c)}
                </text>
              </>
            ) : (
              <>
                <text x={cx} y={cy - 3} textAnchor="middle" fontFamily="var(--ds-font-mono)" fontSize={12.5} fontWeight={600} fill="var(--text)" className="group-hover:underline">
                  {u}
                </text>
                <text x={cx} y={cy + 15} textAnchor="middle" fontFamily="var(--ds-font-display)" fontSize={17} fontWeight={700} fill="var(--text)">
                  {pctText(c)}
                </text>
              </>
            )}
          </Link>
        );
      })}
    </svg>
  );
}

/** O contorno de um estado, ampliado, enchendo do mesmo jeito. */
export function EstadoZoom({ uf, c, className = "" }: { uf: string; c: Counts; className?: string }) {
  const b = M.box[uf];
  const m = Math.max(b[2], b[3]) * 0.08;
  const vb = `${b[0] - m} ${b[1] - m} ${b[2] + 2 * m} ${b[3] + 2 * m}`;
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden="true">
      <defs>{grad(`g-zoom-${uf}`, pct(c) ?? 0)}</defs>
      <path d={M.paths[uf]} fill={`url(#g-zoom-${uf})`} stroke="var(--text)" strokeWidth={0.8} strokeLinejoin="round" />
    </svg>
  );
}
