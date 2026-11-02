import type { Metadata } from "next";
import { Barlow_Condensed, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
  title: "Quem representa você",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
