"use client";

import { clsx } from "clsx";
import Image from "next/image";
import { Check, CircleSlash, HelpCircle, Info, Minus, Plus, X } from "lucide-react";
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from "react-aria-components";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("pt-BR");

/** null = a fonte não publica. Nunca vira zero. */
export type Maybe<T> = T | null;

export function NotPublished() {
  return (
    <span aria-label="não publicado pela fonte" title="A fonte oficial não publica este dado">
      —
    </span>
  );
}

export function formatValue(v: Maybe<number>, kind: "money" | "count" | "percent") {
  if (v === null) return <NotPublished />;
  if (kind === "money") return brl.format(v / 100);
  if (kind === "percent") return `${Math.round(v)}%`;
  return int.format(v);
}

export function BigNumber({ value, caption, live }: { value: Maybe<number>; caption: string; live?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-live={live ? "polite" : undefined} className="font-display text-hero tabular text-fg">
        {formatValue(value, "count")}
      </span>
      <span className="max-w-[28ch] text-base text-muted">{caption}</span>
    </div>
  );
}

export function StatTile({
  value,
  kind,
  label,
  sub,
  help,
  ceiling,
  stale,
}: {
  value: Maybe<number>;
  kind: "money" | "count" | "percent";
  label: string;
  sub?: string;
  help?: string;
  ceiling?: boolean;
  stale?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-sm border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-xl tabular text-fg">
          {ceiling && value !== null && <span className="mr-1 text-sm font-semibold text-muted">até</span>}
          {formatValue(value, kind)}
        </span>
        {help && (
          <DialogTrigger>
            <AriaButton
              aria-label={`Sobre: ${label}`}
              className="grid size-8 shrink-0 place-items-center rounded-pill text-muted outline-none data-[hovered]:bg-surface-sunken data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus"
            >
              <HelpCircle aria-hidden className="size-4" />
            </AriaButton>
            <Popover className="max-w-72 rounded-md border border-border bg-surface p-3 text-sm text-fg shadow-pop">
              <Dialog className="outline-none">{help}</Dialog>
            </Popover>
          </DialogTrigger>
        )}
      </div>
      <span className="text-sm font-semibold text-fg">{label}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
      {stale && (
        <span className="mt-1 w-fit rounded-pill bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">
          dados de {stale}
        </span>
      )}
    </div>
  );
}

type VoteValue = "sim" | "nao" | "abstencao" | "obstrucao" | "art17" | "nao_votou" | "aprovado" | "rejeitado";
const voteMeta: Record<VoteValue, { label: string; Icon: typeof Check; muted?: boolean }> = {
  sim: { label: "Sim", Icon: Check },
  nao: { label: "Não", Icon: X },
  abstencao: { label: "Abstenção", Icon: CircleSlash },
  obstrucao: { label: "Obstrução", Icon: CircleSlash },
  art17: { label: "Art. 17", Icon: Minus, muted: true },
  nao_votou: { label: "Não votou", Icon: Minus, muted: true },
  aprovado: { label: "Aprovado", Icon: Check },
  rejeitado: { label: "Rejeitado", Icon: X },
};

/** Neutro de propósito: Sim não é "bom", Não não é "ruim". Palavra sempre visível. */
export function VoteBadge({ value }: { value: VoteValue }) {
  const { label, Icon, muted } = voteMeta[value];
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 rounded-pill border border-border bg-surface-sunken px-2.5 text-xs font-semibold",
        muted ? "text-muted" : "text-fg",
      )}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function TopicTag({ children, href }: { children: React.ReactNode; href?: string }) {
  const cls =
    "inline-flex h-6 items-center rounded-pill bg-accent-soft px-2.5 text-xs font-semibold text-accent-text outline-none focus-visible:outline-2 focus-visible:outline-focus";
  return href ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function BarBreakdown({ caption, rows }: { caption: string; rows: { label: string; cents: number }[] }) {
  const total = rows.reduce((s, r) => s + r.cents, 0) || 1;
  const max = Math.max(...rows.map((r) => r.cents), 1);
  return (
    <table className="w-full border-separate border-spacing-y-2 text-sm">
      <caption className="mb-1 text-left text-sm font-semibold text-fg">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Categoria</th>
          <th scope="col">Valor</th>
          <th scope="col">Parte do total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" className="w-2/5 pr-3 text-left font-normal text-fg">
              {r.label}
            </th>
            <td className="w-full">
              <div aria-hidden className="h-2 rounded-xs bg-surface-sunken">
                <div className="h-2 rounded-xs bg-accent" style={{ width: `${(r.cents / max) * 100}%` }} />
              </div>
            </td>
            <td className="pl-3 text-right whitespace-nowrap tabular text-fg">{brl.format(r.cents / 100)}</td>
            <td className="pl-2 text-right tabular text-xs text-muted">{Math.round((r.cents / total) * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SourceFooter({
  source,
  href,
  updatedAt,
  stale,
}: {
  source: string;
  href: string;
  updatedAt: string; // ISO
  stale?: boolean;
}) {
  const d = new Date(updatedAt);
  return (
    <footer className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted">
      <span>
        Fonte:{" "}
        <a href={href} className="underline underline-offset-2 hover:text-fg">
          {source}
        </a>
      </span>
      <span aria-hidden>·</span>
      <span>
        atualizado em <time dateTime={updatedAt}>{d.toLocaleDateString("pt-BR")}</time>
      </span>
      {stale && (
        <span className="rounded-pill bg-warning-soft px-2 py-0.5 font-sans font-semibold text-warning">
          pode estar desatualizado
        </span>
      )}
    </footer>
  );
}

export function MissingDataNote({ items }: { items: { what: string; why: string }[] }) {
  return (
    <section aria-labelledby="missing-title" className="rounded-md bg-warning-soft p-4 text-sm text-fg">
      <h3 id="missing-title" className="mb-2 flex items-center gap-2 font-semibold">
        <Info aria-hidden className="size-4 text-warning" />
        {items.length} {items.length === 1 ? "dado ainda não está" : "dados ainda não estão"} aqui
      </h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((i) => (
          <li key={i.what}>
            <span className="font-semibold">{i.what}:</span> {i.why}
          </li>
        ))}
      </ul>
      <a href="/ajudar" className="mt-3 inline-block font-semibold text-fg underline underline-offset-2">
        Sabe onde esse dado é publicado? Conte para a gente
      </a>
    </section>
  );
}

export function PersonCard({
  name,
  office,
  uf,
  party,
  photo,
  href,
  comparing,
  compareFull,
  onToggleCompare,
}: {
  name: string;
  office: string;
  uf: string;
  party: string;
  photo?: string;
  href: string;
  comparing?: boolean;
  compareFull?: boolean;
  onToggleCompare?: () => void;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-md border bg-surface p-3 transition-colors",
        comparing ? "border-accent" : "border-border hover:border-border-input",
      )}
    >
      {photo ? (
        <Image src={photo} alt="" width={56} height={56} className="size-14 shrink-0 rounded-sm object-cover" />
      ) : (
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-sm bg-surface-sunken font-display text-xl text-muted">
          {initials}
        </span>
      )}
      <a href={href} className="min-w-0 flex-1 rounded-xs outline-none focus-visible:outline-2 focus-visible:outline-focus">
        <span className="block truncate font-semibold text-fg">{name}</span>
        <span className="block truncate text-sm text-muted">
          {office} · {uf} · {party}
        </span>
      </a>
      {onToggleCompare && (
        <AriaButton
          onPress={onToggleCompare}
          isDisabled={!comparing && compareFull}
          aria-label={comparing ? `Tirar ${name} da comparação` : `Comparar ${name}`}
          className={clsx(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-pill border-[1.5px] px-2.5 text-xs font-semibold outline-none",
            "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus data-[disabled]:opacity-50",
            comparing ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg data-[hovered]:border-border-input",
          )}
        >
          {comparing ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
          {comparing ? "Comparando" : "Comparar"}
        </AriaButton>
      )}
    </div>
  );
}
