import Link from "next/link";
import { ThemeToggle } from "@/components/ui/misc";
import { MORE, PRIMARY } from "./nav-items";

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-fg bg-surface">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 md:grid-cols-[2fr_1fr_1fr] md:px-6">
        <div className="flex flex-col gap-3">
          <p className="font-serif text-[24px] font-semibold text-fg">Segue o Voto</p>
          <p className="max-w-[48ch] text-sm text-muted">
            Mostramos o que Brasília decide sobre dinheiro, trabalho e benefícios, com o texto oficial. Não dizemos se uma proposta é boa
            ou ruim.
          </p>
          <p className="lbl">Fonte: Câmara dos Deputados, Senado Federal · cadeiras: TSE · malhas: IBGE</p>
          <p className="lbl">Temas lidos por IA, aguardando revisão por pessoa</p>
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
