import Link from "next/link";
import { ThemeToggle } from "@/components/ui/misc";
import { MORE, PRIMARY } from "./nav-items";

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-10 md:grid-cols-[2fr_1fr_1fr] md:px-6">
        <div className="flex flex-col gap-3">
          <p className="font-display text-xl font-bold text-fg">quem·representa</p>
          <p className="max-w-[48ch] text-sm text-muted">
            Mostramos o que os órgãos públicos publicam sobre quem ocupa cargo eletivo. Não damos nota, não fazemos ranking e não
            recomendamos voto.
          </p>
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Seções">
          <ul className="flex flex-col gap-2 text-sm">
            {PRIMARY.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="text-fg underline-offset-2 hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Mais">
          <ul className="flex flex-col gap-2 text-sm">
            {MORE.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="text-fg underline-offset-2 hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
