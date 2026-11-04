"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/misc";
import { PRIMARY } from "./nav-items";

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function AppHeader() {
  const path = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 md:px-6">
        <Link href="/" className="mr-auto rounded-xs font-display text-xl font-bold tracking-tight text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
          quem<span className="text-accent-text">·</span>representa
        </Link>
        <ThemeToggle />
      </div>
      <nav aria-label="Principal" className="mx-auto max-w-[1200px] px-2 md:px-4">
        <ul className="flex items-center gap-1 overflow-x-auto pb-2 [scrollbar-width:none]">
          {PRIMARY.map((i) => {
            const active = isActive(path, i.href);
            return (
              <li key={i.href} className="shrink-0">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "inline-flex h-9 items-center rounded-pill px-2.5 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus sm:px-3",
                    active ? "bg-surface-inverse text-on-inverse" : "text-muted hover:bg-surface-sunken hover:text-fg",
                  )}
                >
                  {i.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
