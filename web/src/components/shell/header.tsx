"use client";

import { clsx } from "clsx";
import { Bell, ChevronDown, LogIn, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { ThemeToggle } from "@/components/ui/misc";
import { GlobalSearch, type OfficeOption } from "./global-search";
import { MORE, PRIMARY } from "./nav-items";

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

export function AppHeader({ offices }: { offices: OfficeOption[] }) {
  const path = usePathname() ?? "/";
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((d) => setSignedIn(Boolean(d.signedIn)))
      .catch(() => {});
  }, [path]);
  const iconLink =
    "inline-flex h-10 items-center gap-2 rounded-pill px-3 text-sm font-semibold text-fg outline-none hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex min-h-14 max-w-[1200px] flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 md:flex-nowrap md:px-6 md:py-0">
        <Link href="/" className="mr-auto rounded-xs font-display md:mr-0 text-xl font-bold tracking-tight text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
          quem<span className="text-accent-text">·</span>representa
        </Link>
        <div className="order-last w-full md:order-none md:mx-2 md:max-w-md md:flex-1">
          <GlobalSearch offices={offices} />
        </div>
        <Link href="/sugestoes" className={clsx(iconLink, "hidden md:inline-flex")}>
          <MessageSquarePlus aria-hidden className="size-4" />
          Sugerir
        </Link>
        {signedIn ? (
          <Link href="/acompanhando" className={iconLink}>
            <Bell aria-hidden className="size-4" />
            <span className="hidden sm:inline">Acompanhando</span>
            <span className="sr-only sm:hidden">Acompanhando</span>
          </Link>
        ) : (
          <Link href={`/entrar?volta=${encodeURIComponent(path)}`} className={iconLink}>
            <LogIn aria-hidden className="size-4" />
            <span className="hidden sm:inline">Entrar</span>
            <span className="sr-only sm:hidden">Entrar</span>
          </Link>
        )}
        <div className="hidden md:block">
          <ThemeToggle />
        </div>
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
                    "inline-flex h-9 items-center rounded-pill px-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus",
                    active ? "bg-surface-inverse text-on-inverse" : "text-muted hover:bg-surface-sunken hover:text-fg",
                  )}
                >
                  {i.label}
                </Link>
              </li>
            );
          })}
          <li className="shrink-0">
            <MenuTrigger>
              <AriaButton className="inline-flex h-9 items-center gap-1 rounded-pill px-3 text-sm font-semibold text-muted outline-none data-[hovered]:bg-surface-sunken data-[hovered]:text-fg data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus">
                Mais <ChevronDown aria-hidden className="size-4" />
              </AriaButton>
              <Popover placement="bottom end" className="min-w-56 rounded-md border border-border bg-surface p-1 shadow-pop">
                <Menu className="outline-none" aria-label="Mais seções">
                  {MORE.map((i) => (
                    <MenuItem
                      key={i.href}
                      href={i.href}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-sm px-3 py-2 text-sm text-fg outline-none data-[focused]:bg-accent-soft"
                    >
                      {i.label}
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </MenuTrigger>
          </li>
        </ul>
      </nav>
    </header>
  );
}
