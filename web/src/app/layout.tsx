import type { Metadata } from "next";
import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { DataFreshnessBar, DemoBanner } from "@/components/shell/bars";
import { CompareProvider } from "@/components/shell/compare";
import { AppFooter } from "@/components/shell/footer";
import { AppHeader } from "@/components/shell/header";

// next/font sobrescreve as variáveis do tokens.css com a família hospedada + fallback métrico
const sans = Inter({ variable: "--ds-font-sans", subsets: ["latin"], display: "swap" });
const display = Barlow_Condensed({
  variable: "--ds-font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({ variable: "--ds-font-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Quem representa você", template: "%s · quem·representa" },
  description: "Quem está no cargo por você, do vereador ao presidente, com dados oficiais.",
};

// aplica o tema salvo antes da primeira pintura (sem piscar)
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-sm bg-surface-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Pular para o conteúdo
        </a>
        <CompareProvider>
          <DemoBanner />
          <AppHeader />
          <DataFreshnessBar />
          <main id="conteudo" tabIndex={-1} className="pb-16 outline-none">
            {children}
          </main>
          <AppFooter />
        </CompareProvider>
      </body>
    </html>
  );
}
