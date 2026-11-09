"use client";

import { useMemo, useState } from "react";
import { layout } from "@/components/ui/hemicycle";
import type { ChamberTransition, SeatChange } from "@/lib/data";

// U09: hemiciclo "Hoje" × "A partir de fev/2027". Sem partido e sem cor: o padrão diz só
// continua (cheio) · entra (hachura) · sai (pontilhado) · sem eleito carregado (vazio).
type Mode = "hoje" | "fev2027";
type Kind = SeatChange | "vazio";
const CLS: Record<Kind, string> = { continua: "vS", entra: "vN", sai: "vA", vazio: "vX" };
const WORD: Record<Kind, string> = { continua: "continua", entra: "entra", sai: "sai", vazio: "sem eleito carregado" };
const MANY: Record<Kind, string> = { continua: "continuam", entra: "entram", sai: "saem", vazio: "sem eleito carregado" };

export function ChamberTransitionView({ t, title }: { t: ChamberTransition; title: string }) {
  const [mode, setMode] = useState<Mode>("hoje");
  const seats = useMemo<{ id: string; name: string; uf: string | null; kind: Kind }[]>(() => {
    const list = (mode === "hoje" ? t.today : t.next).map((s) => ({ id: s.id, name: s.name, uf: s.uf, kind: (mode === "hoje" && !t.loaded ? "continua" : s.change) as Kind }));
    const blanks = Array.from({ length: Math.max(0, t.capacity - list.length) }, (_, i) => ({ id: `vazio-${i}`, name: "", uf: null, kind: "vazio" as Kind }));
    return [...list, ...blanks];
  }, [mode, t]);
  const pts = useMemo(() => layout(t.capacity), [t.capacity]);
  const R = t.capacity > 200 ? 1.75 : 2.6;
  const n = (k: Kind) => seats.filter((s) => s.kind === k).length;
  const kinds: Kind[] = mode === "hoje" ? (t.loaded ? ["continua", "sai"] : ["continua"]) : ["continua", "entra", ...(n("vazio") > 0 ? (["vazio"] as Kind[]) : [])];
  const summary = `${seats.length} cadeiras: ${kinds.map((k) => `${n(k)} ${MANY[k]}`).join(", ")}`;

  return (
    <figure className="flex flex-col gap-3" data-testid="hemiciclo-posse">
      <figcaption className="text-sm font-semibold text-fg">{title}</figcaption>
      <div role="group" aria-label="Quando" className="flex flex-wrap gap-2">
        <ModeChip on={mode === "hoje"} onClick={() => setMode("hoje")}>Hoje</ModeChip>
        <ModeChip on={mode === "fev2027"} disabled={!t.loaded} onClick={() => setMode("fev2027")}>A partir de fev/2027</ModeChip>
      </div>
      {!t.loaded && <p className="text-sm text-muted" data-testid="posse-nao-carregada">Os eleitos de 2026 ainda não foram carregados do TSE; por isso não dá para dizer quem sai.</p>}
      <svg viewBox="0 0 200 104" className="w-full max-w-xl" role="img" aria-label={summary} data-testid="hemiciclo-posse-svg">
        <defs>
          <pattern id={`hach-${t.capacity}`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="2" fill="var(--surface)" />
            <rect width="0.9" height="2" fill="var(--text)" />
          </pattern>
        </defs>
        {pts.map(([x, y], i) => {
          const s = seats[i];
          if (!s) return null;
          const fill = s.kind === "continua" ? "var(--text)" : s.kind === "entra" ? `url(#hach-${t.capacity})` : "var(--surface)";
          return (
            <circle key={s.id} data-kind={s.kind} cx={x} cy={y} r={R} fill={fill} stroke="var(--text)" strokeWidth={s.kind === "vazio" ? 0.3 : 0.5} strokeDasharray={s.kind === "sai" ? "0.5 0.7" : undefined}>
              <title>{s.name ? `${s.name}${s.uf ? ` · ${s.uf}` : ""} · ${WORD[s.kind]}` : WORD[s.kind]}</title>
            </circle>
          );
        })}
      </svg>
      <p aria-live="polite" className="text-sm text-fg" data-testid="posse-resumo">
        {summary}
      </p>
      <ul role="list" aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {kinds.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className={`sq ${CLS[k]}`} /> {WORD[k]} · <span className="tabular">{n(k)}</span>
          </li>
        ))}
      </ul>
      {t.extra > 0 && <p className="text-xs text-muted">A fonte lista {t.extra} {t.extra === 1 ? "mandato" : "mandatos"} além das {t.capacity} cadeiras; mostramos só {t.capacity}.</p>}
      <p className="text-xs text-muted">Entra: eleito em 2026 que toma posse em 1º de fevereiro de 2027. Sem partido: este desenho mostra só quem fica e quem muda.</p>
    </figure>
  );
}

function ModeChip({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex h-11 items-center border px-4 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-muted " +
        (on ? "border-fg bg-surface-inverse text-on-inverse" : "border-border bg-surface text-fg hover:border-fg")
      }
    >
      {children}
    </button>
  );
}
