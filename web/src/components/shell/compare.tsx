"use client";

import { ArrowRight, Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { clsx } from "clsx";
import { COMPARE_MAX } from "@/lib/compare";

export { COMPARE_MAX };
type Picked = { slug: string; name: string };
type Ctx = { picked: Picked[]; has: (slug: string) => boolean; toggle: (p: Picked) => void; clear: () => void; full: boolean };

const CompareCtx = createContext<Ctx | null>(null);
const KEY = "compare";

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(raw)) setPicked(raw.filter((x) => typeof x?.slug === "string" && typeof x?.name === "string").slice(0, COMPARE_MAX));
    } catch {}
  }, []);
  const save = (next: Picked[]) => {
    setPicked(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  const toggle = useCallback(
    (p: Picked) =>
      setPicked((cur) => {
        const next = cur.some((x) => x.slug === p.slug) ? cur.filter((x) => x.slug !== p.slug) : cur.length >= COMPARE_MAX ? cur : [...cur, p];
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      }),
    [],
  );
  const value = useMemo<Ctx>(
    () => ({ picked, has: (s) => picked.some((x) => x.slug === s), toggle, clear: () => save([]), full: picked.length >= COMPARE_MAX }),
    [picked, toggle],
  );
  return (
    <CompareCtx.Provider value={value}>
      {children}
      <CompareTray />
    </CompareCtx.Provider>
  );
}

export function useCompare() {
  const c = useContext(CompareCtx);
  if (!c) throw new Error("useCompare fora do CompareProvider");
  return c;
}

export function CompareToggle({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const { has, toggle, full } = useCompare();
  const on = has(slug);
  return (
    <AriaButton
      onPress={() => toggle({ slug, name })}
      isDisabled={!on && full}
      aria-pressed={on}
      aria-label={on ? `Tirar ${name} da comparação` : full ? `Comparação cheia (máximo ${COMPARE_MAX})` : `Comparar ${name}`}
      className={clsx(
        "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-pill border-[1.5px] px-2.5 text-xs font-semibold outline-none before:absolute before:-inset-1.5",
        "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus data-[disabled]:opacity-50",
        on ? "border-accent bg-accent-soft text-accent-text" : "border-border text-fg data-[hovered]:border-border-input",
        className,
      )}
    >
      {on ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
      {on ? "Comparando" : "Comparar"}
    </AriaButton>
  );
}

function CompareTray() {
  const c = useContext(CompareCtx)!;
  if (!c.picked.length) return null;
  const href = `/comparar?p=${c.picked.map((p) => p.slug).join(",")}`;
  return (
    <aside aria-label="Comparação" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-pop">
      <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-2.5 md:px-6">
        <p className="shrink-0 text-sm font-semibold text-fg" aria-live="polite">
          {c.picked.length} de {COMPARE_MAX}
        </p>
        <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {c.picked.map((p) => (
            <li key={p.slug} className="flex h-8 shrink-0 items-center gap-1 rounded-pill bg-surface-sunken pr-1 pl-3 text-xs font-semibold text-fg">
              <span className="max-w-[16ch] truncate">{p.name}</span>
              <AriaButton
                aria-label={`Tirar ${p.name}`}
                onPress={() => c.toggle(p)}
                className="grid size-6 place-items-center rounded-pill text-muted outline-none data-[hovered]:bg-surface data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus"
              >
                <X aria-hidden className="size-3.5" />
              </AriaButton>
            </li>
          ))}
        </ul>
        {c.picked.length >= 2 ? (
          <Link
            href={href}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-pill bg-accent px-4 text-sm font-semibold text-on-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Comparar <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-muted">escolha mais 1</span>
        )}
      </div>
    </aside>
  );
}
