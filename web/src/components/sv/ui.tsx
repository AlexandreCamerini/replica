import Link from "next/link";
import type { ReactNode } from "react";
import type { VoteValue } from "@/lib/data";

// Componentes do sistema Segue o Voto. As classes vêm de src/styles/sv.css; a regra de uso de cada um está no design system.

export function Label({ children }: { children: ReactNode }) {
  return <p className="sv-label">{children}</p>;
}

/** Linha de lista com régua. `on` marca um valor afirmativo (peso 800). */
export function Row({ href, label, value, on }: { href?: string; label: ReactNode; value?: ReactNode; on?: boolean }) {
  const inner = (
    <>
      {label}
      {value !== undefined && <span className={on ? "is-on" : undefined}>{value}</span>}
    </>
  );
  return href ? (
    <Link className="sv-row" href={href}>
      {inner}
    </Link>
  ) : (
    <div className="sv-row">{inner}</div>
  );
}

/** Item de lista com título, linha de apoio e um valor à direita. */
export function Item({ href, title, note, value, on }: { href?: string; title: ReactNode; note?: ReactNode; value?: ReactNode; on?: boolean }) {
  const inner = (
    <>
      <div>
        {title}
        {note && <small>{note}</small>}
      </div>
      {value !== undefined && <span className={on ? "is-on" : undefined}>{value}</span>}
    </>
  );
  return href ? (
    <Link className="sv-item" href={href}>
      {inner}
    </Link>
  ) : (
    <div className="sv-item">{inner}</div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="sv-list">{children}</div>;
}

/** Lacuna declarada: o que a fonte não publica ou ainda não foi carregado. Nunca vira zero. */
export function Gap({ children }: { children: ReactNode }) {
  return <p className="sv-gap">{children}</p>;
}

export function Section({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div className="sv-sec" style={first ? { marginTop: 0 } : undefined}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Bloco de destaque: a única superfície escura da tela. */
export function Block({ href, label, title, children, bleed, className }: { href?: string; label: string; title: ReactNode; children?: ReactNode; bleed?: boolean; className?: string }) {
  const cls = ["sv-block", bleed ? "is-bleed" : "", className ?? ""].filter(Boolean).join(" ");
  const inner = (
    <>
      <Label>{label}</Label>
      <h2>{title}</h2>
      {children}
    </>
  );
  return href ? (
    <Link className={cls} href={href}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Notice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sv-notice" role="status">
      <Label>{label}</Label>
      <p>{children}</p>
    </div>
  );
}

export function Src({ children }: { children: ReactNode }) {
  return <p className="sv-src">{children}</p>;
}

const STEPS = ["proposta", "comissão", "plenário", "senado", "sanção", "em vigor"] as const;

/** Linha de vida da decisão. `now` é o índice da etapa atual (0 a 5). */
export function Steps({ now }: { now: number }) {
  return (
    <ul className="sv-steps" aria-label={`Etapa ${now + 1} de ${STEPS.length}: ${STEPS[now]}`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < now ? "is-done" : i === now ? "is-now" : undefined}>
          {s}
        </li>
      ))}
    </ul>
  );
}

// Voto é forma mais palavra, nunca cor. Obstrução e "presidia" são registros próprios da Casa: levam a forma vazia e a palavra exata.
const VOTE: Record<VoteValue, { word: string; mark: string; weight: string }> = {
  sim: { word: "Sim", mark: "is-sim", weight: "is-sim" },
  nao: { word: "Não", mark: "is-nao", weight: "is-nao" },
  abstencao: { word: "Abstenção", mark: "is-abs", weight: "is-nao" },
  obstrucao: { word: "Obstrução", mark: "", weight: "is-nao" },
  art17: { word: "Presidia", mark: "", weight: "is-sem" },
  nao_votou: { word: "Sem voto", mark: "", weight: "is-sem" },
};

export const voteWord = (v: VoteValue) => VOTE[v].word;

export function VoteMark({ value }: { value: VoteValue }) {
  const v = VOTE[value];
  return (
    <span className={`sv-vote ${v.weight}`}>
      <i className={`sv-mark ${v.mark}`} aria-hidden="true" />
      {v.word}
    </span>
  );
}

/** Uma barra do placar. A largura é a parcela de `total`. */
export function Bar({ label, kind, weight, n, total }: { label: string; kind?: "is-sim" | "is-nao" | "is-abs"; weight: number; n: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0;
  return (
    <div className="sv-bar">
      <b style={{ fontWeight: weight }}>{label}</b>
      <div className="sv-track">{kind && n > 0 && <i className={kind} style={{ width: `${pct}%` }} />}</div>
      <span>{n}</span>
    </div>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="sv-tabs" aria-label="Seções">
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
