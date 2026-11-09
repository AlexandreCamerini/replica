import { clsx } from "clsx";
import Link from "next/link";
import { CAMARA_SEATS, VOTES, VOTE_LABEL, type Counts, type VoteKeyOrNone, jaDecididoHref } from "@/lib/votacoes";

/** Quadradinho de voto: cheio = Sim, hachura = Não, pontilhado = abstenção, vazio = sem voto. Nunca cor. */
export function Sq({ k, className = "" }: { k: VoteKeyOrNone; className?: string }) {
  return <i aria-hidden className={clsx("sq", k === "S" && "vS", k === "N" && "vN", k === "A" && "vA", (k === "P" || k === "X") && "vX", className)} />;
}

export function VotoLegenda() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg" aria-label="Legenda do voto">
      {(["S", "N", "A", "X"] as VoteKeyOrNone[]).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <Sq k={k} /> {k === "S" ? "Sim" : k === "N" ? "Não" : k === "A" ? "Abstenção" : "Sem voto"}
        </li>
      ))}
    </ul>
  );
}

/** Uma barra só: tinta = Sim, hachura = Não, vazio = fora. */
export function Barra({ c, total, label }: { c: Counts; total: number; label: string }) {
  const w = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  return (
    <figure className="flex flex-col gap-1">
      <span
        aria-hidden
        className="block h-[22px] border border-fg"
        style={{
          background: `linear-gradient(90deg,var(--text) 0 ${w(c[0])},transparent ${w(c[0])}),repeating-linear-gradient(45deg,var(--text) 0 1.3px,var(--surface) 0 3.4px)`,
          backgroundSize: `100% 100%, calc(${w(c[0])} + ${w(c[1])}) 100%`,
          backgroundRepeat: "no-repeat",
          backgroundColor: "var(--surface)",
        }}
      />
      <figcaption className="lbl">{label}</figcaption>
    </figure>
  );
}

export const Barra513 = ({ c }: { c: Counts }) => (
  <Barra c={c} total={CAMARA_SEATS} label={`513 cadeiras${c[3] ? " · 1 deputado presidia a sessão e não vota" : ""}`} />
);

/** Seletor das 6 votações. Trocar a votação mantém o nível (estado ou deputado). */
export function VotacaoChips({ v, uf, dep }: { v: number; uf?: string | null; dep?: number | null }) {
  return (
    <nav aria-label="Votação">
      <ul className="flex flex-wrap gap-2">
        {VOTES.map((x, i) => (
          <li key={x.id}>
            <Link
              href={jaDecididoHref(i, uf, dep)}
              aria-current={i === v ? "true" : undefined}
              className={clsx(
                "inline-flex min-h-11 flex-col justify-center border px-3 py-1.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                i === v ? "border-fg bg-surface shadow-[inset_0_0_0_1px_var(--text)]" : "border-border bg-surface hover:border-fg",
              )}
            >
              <span className="font-mono text-xs font-semibold text-fg">{x.label}</span>
              <span className="lbl">{x.date}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Trilha Brasil › Estado › Nome, sempre visível. */
export function Trilha({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Você está em">
      <ol className="flex flex-wrap items-center gap-1.5 text-[15px]">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-muted">›</span>}
            {it.href ? (
              <Link href={it.href} className="inline-flex min-h-11 items-center px-1 font-medium text-muted underline underline-offset-[3px] hover:text-fg">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 items-center px-1 font-semibold text-fg">
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const votoTexto = (k: VoteKeyOrNone) => VOTE_LABEL[k];
