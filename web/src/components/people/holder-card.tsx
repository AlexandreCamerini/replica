import Link from "next/link";
import { CompareToggle } from "@/components/shell/compare";
import type { Officeholder } from "@/lib/data";

export function initials(name: string) {
  return name
    .split(" ")
    .filter((w) => w.length > 2 || /^[A-ZÁÉÍÓÚ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
}

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={
        size === "lg"
          ? "grid size-20 shrink-0 place-items-center rounded-md bg-surface-sunken font-display text-display text-muted md:size-24"
          : "grid size-12 shrink-0 place-items-center rounded-sm bg-surface-sunken font-display text-lg text-muted"
      }
    >
      {initials(name)}
    </span>
  );
}

/** Cartão de pessoa no cargo. Link no nome (alvo grande), comparar separado. */
export function HolderCard({ h, showPlace = false }: { h: Officeholder; showPlace?: boolean }) {
  return (
    <li className="relative flex items-center gap-3 rounded-md border border-border bg-surface p-3 transition-colors hover:border-border-input">
      <Avatar name={h.person.displayName} />
      <div className="min-w-0 flex-1">
        <Link
          href={`/p/${h.person.slug}`}
          title={h.person.displayName}
          className="block truncate font-semibold text-fg outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-focus"
        >
          {h.person.displayName}
        </Link>
        <span className="block truncate text-sm text-muted">
          {h.officeName}
          {showPlace && ` · ${h.placeLabel}`} · {h.party.acronym}
        </span>
      </div>
      <CompareToggle slug={h.person.slug} name={h.person.displayName} className="z-10" />
    </li>
  );
}

export function HolderGrid({ people, showPlace }: { people: Officeholder[]; showPlace?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {people.map((h) => (
        <HolderCard key={h.mandate.id} h={h} showPlace={showPlace} />
      ))}
    </ul>
  );
}
