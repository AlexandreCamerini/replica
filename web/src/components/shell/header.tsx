"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/misc";
import { dateTime } from "@/lib/pauta";
import { PRIMARY } from "./nav-items";

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Cabeçalho do jornal: marca em Newsreader, nav em chips retos, "Pauta lida em" sempre à vista. */
export function AppHeader({ readAt }: { readAt: string | null }) {
  const path = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-40 border-b border-fg bg-surface">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-4 md:px-6">
        <Link href="/no-seu-bolso" className="mr-auto font-serif text-[24px] font-semibold tracking-tight text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
          Segue o Voto
        </Link>
        <p className="lbl hidden sm:block">
          {readAt ? (
            <>
              Pauta lida em <time dateTime={readAt}>{dateTime(readAt)}</time>
            </>
          ) : (
            "Pauta ainda não lida"
          )}
        </p>
        <ThemeToggle />
      </div>
      <nav aria-label="Principal" className="mx-auto max-w-[1320px] border-t border-border px-2 md:px-4">
        <ul className="flex items-center gap-1 overflow-x-auto py-1.5 [scrollbar-width:none]">
          {PRIMARY.map((i) => {
            const active = isActive(path, i.href);
            return (
              <li key={i.href} className="shrink-0">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "inline-flex h-9 items-center border px-3 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus",
                    active ? "border-fg bg-surface-inverse text-on-inverse" : "border-transparent text-fg hover:border-fg",
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
